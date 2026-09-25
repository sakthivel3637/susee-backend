const prisma = require('../../config/db');

const toDashboardBay = (bay) => bay
  ? {
    id: bay.id,
    bayName: bay.bayName,
    bayCode: bay.bayCode,
    bayType: bay.bayType,
    currentWorkAssignmentId: bay.currentWorkAssignmentId || null,
    availability: bay.currentWorkAssignmentId ? 'BUSY' : 'AVAILABLE'
  }
  : null;

const buildBayMapForJobCards = async (jobCards = []) => {
  const bayIds = Array.from(new Set(
    jobCards
      .flatMap((jobCard) => jobCard.workAssignments || [])
      .map((assignment) => assignment.bayId)
      .filter(Boolean)
  ));

  if (bayIds.length === 0) {
    return new Map();
  }

  const bays = await prisma.bay.findMany({
    where: {
      id: {
        in: bayIds
      }
    },
    select: {
      id: true,
      bayName: true,
      bayCode: true,
      bayType: true,
      currentWorkAssignmentId: true
    }
  });

  return new Map(bays.map((bay) => [bay.id, bay]));
};

const recentUserSelect = {
  id: true,
  fullName: true,
  slug: true,
  emailId: true,
  mobileNo: true,
  employeeCode: true,
  isActive: true,
  createdAt: true,
  role: {
    select: {
      id: true,
      name: true,
      slug: true
    }
  }
};

const getAdminDashboard = async ({ recentUserLimit = 5 } = {}) => {
  const [
    totalUsers,
    activeRoles,
    serviceItems,
    serviceCategories,
    recentUsers
  ] = await prisma.$transaction([
    prisma.user.count(),
    prisma.role.count({ where: { isActive: true } }),
    prisma.serviceItem.count(),
    prisma.serviceCategory.count(),
    prisma.user.findMany({
      select: recentUserSelect,
      orderBy: { createdAt: 'desc' },
      take: recentUserLimit
    })
  ]);

  return {
    summary: {
      totalUsers,
      activeRoles,
      serviceItems,
      serviceCategories
    },
    recentUsers
  };
};

const getDateRange = (timeframe) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let startDate = today;
  let endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  if (timeframe === 'this_week') {
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    startDate = new Date(now.getFullYear(), now.getMonth(), diff);
  } else if (timeframe === 'this_month') {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (timeframe === 'all_time') {
    startDate = new Date(2000, 0, 1); // Way in the past
  }

  return { startDate, endDate };
};

const getMdDashboard = async ({ timeframe = 'today', locationId } = {}) => {
  const { startDate, endDate } = getDateRange(timeframe);
  const dateFilter = {
    createdAt: {
      gte: startDate,
      lt: endDate
    }
  };
  if (locationId) {
    dateFilter.locationId = locationId;
  }

  // 1. KPI Cards
  const totalVehicles = await prisma.vehicle.count({ where: dateFilter });
  const totalJobCards = await prisma.jobCard.count({ where: dateFilter });
  const revenueResult = await prisma.jobCard.aggregate({
    _sum: { finalAmount: true },
    where: dateFilter
  });
  const totalRevenue = revenueResult._sum.finalAmount || 0;

  const userWhere = locationId ? { locationId } : {};
  const totalUsers = await prisma.user.count({ where: userWhere });

  // 2. Daily Vehicle Entries - Last 7 Days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const gateEntryWhere = {
    entryTime: {
      gte: sevenDaysAgo
    }
  };
  if (locationId) {
    gateEntryWhere.locationId = locationId;
  }

  const recentGateEntries = await prisma.gateEntry.findMany({
    where: gateEntryWhere,
    select: {
      entryTime: true
    }
  });

  const dailyThroughput = Array(7).fill(0).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const fullDate = d.toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
    const dateStr = d.toLocaleDateString('en-US', { weekday: 'short' });
    return { fullDate, day: dateStr, count: 0 };
  });

  recentGateEntries.forEach(ge => {
    const geDate = ge.entryTime.toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
    const dayData = dailyThroughput.find(d => d.fullDate === geDate);
    if (dayData) {
      dayData.count++;
    }
  });

  const todayDate = new Date().toLocaleDateString('en-CA');
  dailyThroughput.forEach(d => {
    if (d.fullDate === todayDate) {
      d.day = 'Today';
    }
  });

  // 3. Status Mix
  const allStatuses = await prisma.statusMaster.findMany({
    where: { module: { moduleCode: 'job-card' } }
  });

  const statusCounts = await prisma.jobCard.groupBy({
    by: ['currentStatusId'],
    _count: true,
    where: dateFilter
  });

  const statusMix = statusCounts.map(sc => {
    const status = allStatuses.find(s => s.id === sc.currentStatusId);
    return {
      statusName: status ? status.statusName : 'Unknown',
      count: sc._count
    };
  }).filter(s => s.statusName !== 'Unknown');

  // 4. Department Performance (from WorkAssignments)
  const workAssignments = await prisma.workAssignment.findMany({
    where: dateFilter,
    include: {
      status: true,
      jobCardService: {
        include: {
          serviceItem: {
            include: {
              category: true
            }
          }
        }
      }
    }
  });

  const deptMap = {};
  workAssignments.forEach(wa => {
    const catName = wa.jobCardService?.serviceItem?.category?.name || 'Other';
    if (!deptMap[catName]) {
      deptMap[catName] = { department: catName, active: 0, queue: 0, done: 0, totalTime: 0, doneCount: 0 };
    }

    const statusCode = wa.status?.statusCode || '';
    if (statusCode.includes('ASSIGNED')) {
      deptMap[catName].queue++;
    } else if (statusCode.includes('IN_PROGRESS')) {
      deptMap[catName].active++;
    } else if (statusCode.includes('COMPLETED')) {
      deptMap[catName].done++;

      if (wa.startedAt && wa.completedAt) {
        const timeDiff = new Date(wa.completedAt).getTime() - new Date(wa.startedAt).getTime();
        deptMap[catName].totalTime += timeDiff;
        deptMap[catName].doneCount++;
      }
    }
  });

  const departmentPerformance = Object.values(deptMap).map(dept => {
    let avgTime = '0h';
    if (dept.doneCount > 0) {
      const avgMs = dept.totalTime / dept.doneCount;
      const avgHours = avgMs / (1000 * 60 * 60);
      if (avgHours < 1) {
        avgTime = Math.round(avgHours * 60) + 'm';
      } else {
        avgTime = avgHours.toFixed(1) + 'h';
      }
    }
    return {
      department: dept.department,
      active: dept.active,
      queue: dept.queue,
      done: dept.done,
      avgTime
    };
  });

  const jcCounts = await prisma.jobCard.groupBy({
    by: ['currentStatusId'],
    _count: true,
    where: dateFilter
  });
  let jcActive = 0, jcQueue = 0, jcDone = 0;
  jcCounts.forEach(jc => {
    const status = allStatuses.find(s => s.id === jc.currentStatusId);
    if (status) {
      if (status.isFinal || status.statusCode === 'DELIVERED') {
        jcDone += jc._count;
      } else if (status.statusCode.includes('ASSIGNED') || status.statusCode.includes('PENDING')) {
        jcQueue += jc._count;
      } else {
        jcActive += jc._count;
      }
    }
  });

  departmentPerformance.push({
    department: 'Job Card',
    active: jcActive,
    queue: jcQueue,
    done: jcDone,
    avgTime: '-'
  });

  // 5. Revenue Breakdown
  const jobCardServices = await prisma.jobCardService.findMany({
    where: {
      jobCard: dateFilter
    },
    include: {
      serviceItem: {
        include: {
          category: true
        }
      }
    }
  });

  const revenueMap = {};
  jobCardServices.forEach(jcs => {
    const catName = jcs.serviceItem?.category?.name || 'Other';
    if (!revenueMap[catName]) revenueMap[catName] = 0;
    revenueMap[catName] += Number(jcs.price) * (jcs.quantity || 1);
  });

  const revenueBreakdown = Object.keys(revenueMap).map(key => ({
    category: key,
    amount: revenueMap[key]
  }));

  return {
    kpis: {
      totalVehicles: { value: totalVehicles, comparison: '+3 vs yesterday' },
      totalJobCards: { value: totalJobCards, comparison: 'Active in system' },
      totalRevenue: { value: totalRevenue, comparison: '+12% vs avg' },
      totalUsers: { value: totalUsers, comparison: 'Manage platform users' }
    },
    dailyThroughput,
    statusMix,
    departmentPerformance,
    revenueBreakdown: {
      items: revenueBreakdown,
      todaysTotal: totalRevenue
    }
  };
};

const getFloorSupervisorDashboard = async ({ locationId } = {}) => {
  const dateFilter = {};
  if (locationId) {
    dateFilter.locationId = locationId;
  }

  // Active Job Cards (not delivered/closed)
  const allJobCards = await prisma.jobCard.findMany({
    where: dateFilter,
    include: {
      customer: true,
      vehicle: {
        include: { brand: true }
      },
      currentStatus: true,
      workAssignments: {
        include: {
          assignedUser: true
        }
      },
      services: {
        include: {
          serviceItem: true
        }
      }
    },
    orderBy: {
      createdAt: 'desc'
    }
  });
  const bayMap = await buildBayMapForJobCards(allJobCards);

  let pendingCount = 0;
  let assignedCount = 0;
  let inProgressCount = 0;
  let completedCount = 0;

  const queue = allJobCards.map(jc => {
    let statusText = 'In Queue';
    let mechanicText = 'Unassigned';

    const statusCode = jc.currentStatus?.statusCode || '';

    // Classify into KPIs based on Job Card status or work assignments
    if (statusCode.includes('PENDING') || statusCode === 'GATE_ENTRY_CREATED' || statusCode === 'JOB_CARD_CREATED') {
      pendingCount++;
      statusText = 'In Queue';
    } else if (statusCode === 'APPROVAL_PENDING') {
      pendingCount++;
      statusText = 'Approval';
    } else if (statusCode.includes('ASSIGNED')) {
      assignedCount++;
      statusText = 'Assigned';
    } else if (statusCode.includes('IN_PROGRESS')) {
      inProgressCount++;
      statusText = 'In Progress';
    } else if (statusCode.includes('COMPLETED') || statusCode.includes('READY')) {
      completedCount++;
      statusText = 'Done';
    } else if (statusCode === 'DELIVERED') {
      // Delivered job cards might not show up in the active queue depending on req,
      // but let's count them as completed if they are retrieved.
      statusText = 'Delivered';
    }

    // Attempt to find mechanic from work assignments
    const assignment = jc.workAssignments && jc.workAssignments.length > 0 ? jc.workAssignments[0] : null;
    if (jc.workAssignments && jc.workAssignments.length > 0) {
      // Just pick the first assigned mechanic for display, or could join them
      mechanicText = assignment.assignedUser?.fullName || 'Unassigned';
    }
    const bay = assignment && assignment.bayId ? toDashboardBay(bayMap.get(assignment.bayId)) : null;

    // Format services
    const servicesList = jc.services?.map(s => s.serviceItem?.name).filter(Boolean).join(', ') || 'No Services';

    return {
      id: jc.id,
      slug: jc.slug || jc.jobCardNo,
      jobCardNo: jc.jobCardNo,
      vehicleNo: jc.vehicle?.registrationNo || 'N/A',
      customer: {
        name: jc.customer?.fullName || 'Unknown',
        phone: jc.customer?.mobileNo || 'N/A'
      },
      vehicleDetails: {
        model: `${jc.vehicle?.brand?.name || ''} ${jc.vehicle?.model || ''}`.trim() || 'Unknown',
        variant: `${jc.vehicle?.vehicleColor || ''} - ${jc.vehicle?.fuelType || ''}`.trim() || 'N/A'
      },
      services: servicesList,
      mechanic: mechanicText,
      bay,
      bayName: bay ? bay.bayName : null,
      status: statusText,
      delivery: jc.expectedDeliveryAt ? jc.expectedDeliveryAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : 'N/A'
    };
  });

  return {
    kpis: {
      pending: pendingCount,
      assigned: assignedCount,
      inProgress: inProgressCount,
      completed: completedCount
    },
    queue: queue.filter(q => q.status !== 'Delivered') // Filter out delivered from active queue
  };
};

const getManagerDashboard = async ({ locationId, page = 1, limit = 5 } = {}) => {
  const dateFilter = {};
  if (locationId) {
    dateFilter.locationId = locationId;
  }

  // Get today's bounds
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  // Fetch all active/recent job cards for this location
  const allJobCards = await prisma.jobCard.findMany({
    where: dateFilter,
    include: {
      customer: true,
      vehicle: true,
      currentStatus: true,
      workAssignments: {
        include: {
          status: true,
          assignedUser: true,
          jobCardService: {
            include: {
              serviceItem: {
                include: { category: true }
              }
            }
          }
        }
      },
      services: {
        include: {
          serviceItem: {
            include: { category: true }
          }
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  let totalTodayCount = 0;
  let completedTodayCount = 0;
  let jcPendingCount = 0;
  let delayedCount = 0;

  let gatePendingCount = 0;
  let mechActive = 0, mechWaiting = 0;
  let bodyActive = 0, bodyWaiting = 0;
  let completedPipelineCount = 0;

  const vehicles = allJobCards.map(jc => {
    const statusCode = jc.currentStatus?.statusCode || '';
    const statusName = jc.currentStatus?.statusName || 'Unknown';
    const isCreatedToday = jc.createdAt >= today && jc.createdAt < tomorrow;

    // KPI logic
    if (isCreatedToday) {
      totalTodayCount++;
    }
    if ((statusCode.includes('COMPLETED') || statusCode.includes('DELIVERED')) && jc.updatedAt >= today && jc.updatedAt < tomorrow) {
      completedTodayCount++;
    }
    if (statusCode.includes('PENDING') || statusCode === 'GATE_ENTRY_CREATED') {
      jcPendingCount++;
    }
    if (jc.expectedDeliveryAt && new Date(jc.expectedDeliveryAt) < now && !statusCode.includes('DELIVERED') && !statusCode.includes('COMPLETED')) {
      delayedCount++;
    }

    // Pipeline logic
    if (statusCode === 'GATE_ENTRY_CREATED' || statusCode === 'JOB_CARD_PENDING') {
      gatePendingCount++;
    } else if (statusCode.includes('COMPLETED') || statusCode === 'READY_FOR_DELIVERY' || statusCode === 'DELIVERED') {
      completedPipelineCount++;
    }

    let stageTone = 'info';
    let displayStage = statusName;

    if (statusCode.includes('MECHANICAL')) {
      if (statusCode.includes('IN_PROGRESS')) mechActive++;
      else if (statusCode.includes('ASSIGNED')) mechWaiting++;
      stageTone = 'warning';
      displayStage = 'Mechanical';
    } else if (statusCode.includes('BODY_SHOP')) {
      if (statusCode.includes('IN_PROGRESS')) bodyActive++;
      else if (statusCode.includes('ASSIGNED')) bodyWaiting++;
      stageTone = 'purple';
      displayStage = 'Body Shop';
    } else if (statusCode.includes('PENDING')) {
      stageTone = 'danger';
    } else if (statusCode.includes('COMPLETED') || statusCode.includes('DELIVERED')) {
      stageTone = 'success';
      displayStage = 'Completed';
    }

    // Extract technician (just pick the first active/assigned one)
    let technician = '';
    if (jc.workAssignments?.length > 0) {
      technician = jc.workAssignments[0].assignedUser?.fullName || '';
    }

    const servicesList = jc.services?.map(s => s.serviceItem?.name).filter(Boolean) || [];
    const serviceType = jc.services?.[0]?.serviceItem?.category?.name || 'General Service';

    let delivery = 'N/A';
    if (jc.expectedDeliveryAt) {
      delivery = jc.expectedDeliveryAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    }

    return {
      id: jc.jobCardNo || jc.id, // Prefer jobCardNo if available
      rawId: jc.id,
      slug: jc.slug || jc.jobCardNo,
      jobCardNo: jc.jobCardNo,
      vehicleNumber: jc.vehicle?.registrationNo || 'N/A',
      ownerName: jc.customer?.fullName || 'Unknown',
      ownerMobile: jc.customer?.mobileNo || 'N/A',
      serviceType,
      services: servicesList,
      status: statusCode,
      technician,
      estimatedCost: Number(jc.totalEstimate) || 0,
      createdAt: jc.createdAt,
      stage: displayStage,
      stageTone,
      delivery
    };
  });

  return {
    kpis: [
      { label: 'Total JC Today', value: totalTodayCount, color: '#12343B', iconBg: '#E9EEF1' },
      { label: 'JC Completed', value: completedTodayCount, color: '#22C7B8', iconBg: '#E8FAF8' },
      { label: 'JC Pending', value: jcPendingCount, color: '#D97706', iconBg: '#FFF4E5' },
      { label: 'JC Delayed', value: delayedCount, color: '#0EA5E9', iconBg: '#EAF8FF' },
    ],
    pipeline: [
      { label: 'Gate / JC Pending', value: gatePendingCount, meta: 'Awaiting job card', color: '#D97706', bg: '#FFF7ED' },
      { label: 'Mechanical', value: mechActive + mechWaiting, meta: `${mechActive} active - ${mechWaiting} waiting`, color: '#2563EB', bg: '#EFF6FF' },
      { label: 'Body Shop', value: bodyActive + bodyWaiting, meta: `${bodyActive} active - ${bodyWaiting} waiting`, color: '#7C3AED', bg: '#F5F3FF' },
      { label: 'Completed', value: completedPipelineCount, meta: 'Ready for delivery', color: '#059669', bg: '#ECFDF5' },
    ],
    vehicles: vehicles.slice((page - 1) * limit, page * limit),
    pagination: {
      total: vehicles.length,
      page,
      limit,
      totalPages: Math.ceil(vehicles.length / limit)
    }
  };
};

const getBodyShopDashboard = async ({ locationId } = {}) => {
  const dateFilter = {};
  if (locationId) {
    dateFilter.locationId = locationId;
  }

  // Active Job Cards (not delivered/closed)
  const allJobCards = await prisma.jobCard.findMany({
    where: dateFilter,
    include: {
      customer: true,
      vehicle: {
        include: { brand: true }
      },
      currentStatus: true,
      workAssignments: {
        include: {
          assignedUser: true
        }
      },
      services: {
        include: {
          serviceItem: {
            include: {
              category: true
            }
          }
        }
      }
    },
    orderBy: {
      createdAt: 'desc'
    }
  });
  const bayMap = await buildBayMapForJobCards(allJobCards);

  const isBodyShopService = (service) => {
    const catName = (service.serviceItem?.category?.name || '').toLowerCase();
    const catSlug = (service.serviceItem?.category?.slug || '').toLowerCase();
    const aliases = ['body-shop', 'body_shop', 'body shop', 'bodyshop', 'paint', 'denting'];
    return aliases.some(alias => catName.includes(alias) || catSlug.includes(alias));
  };

  // Filter for only job cards that have at least one body shop service
  const bodyShopJobCards = allJobCards.filter(jc =>
    jc.services?.some(isBodyShopService)
  );

  let pendingCount = 0;
  let assignedCount = 0;
  let inProgressCount = 0;
  let completedCount = 0;

  const queue = bodyShopJobCards.map(jc => {
    let statusText = 'In Queue';
    let mechanicText = 'Unassigned';

    const statusCode = jc.currentStatus?.statusCode || '';

    // Classify into KPIs based on Job Card status or work assignments
    if (statusCode.includes('PENDING') || statusCode === 'GATE_ENTRY_CREATED' || statusCode === 'JOB_CARD_CREATED') {
      pendingCount++;
      statusText = 'In Queue';
    } else if (statusCode === 'APPROVAL_PENDING') {
      pendingCount++;
      statusText = 'Approval';
    } else if (statusCode.includes('ASSIGNED')) {
      assignedCount++;
      statusText = 'Assigned';
    } else if (statusCode.includes('IN_PROGRESS')) {
      inProgressCount++;
      statusText = 'In Progress';
    } else if (statusCode.includes('COMPLETED') || statusCode.includes('READY')) {
      completedCount++;
      statusText = 'Done';
    } else if (statusCode === 'DELIVERED') {
      statusText = 'Delivered';
    }

    // Attempt to find mechanic from work assignments
    const assignment = jc.workAssignments && jc.workAssignments.length > 0 ? jc.workAssignments[0] : null;
    if (jc.workAssignments && jc.workAssignments.length > 0) {
      mechanicText = assignment.assignedUser?.fullName || 'Unassigned';
    }
    const bay = assignment && assignment.bayId ? toDashboardBay(bayMap.get(assignment.bayId)) : null;

    // Format services (only showing body shop services for clarity, or all?)
    const servicesList = jc.services
      ?.filter(isBodyShopService)
      .map(s => s.serviceItem?.name)
      .filter(Boolean)
      .join(', ') || 'No Services';

    return {
      id: jc.jobCardNo || jc.id,
      rawId: jc.id,
      slug: jc.slug || jc.jobCardNo,
      jobCardNo: jc.jobCardNo,
      vehicleNumber: jc.vehicle?.registrationNo || 'N/A',
      customerName: jc.customer?.fullName || 'Unknown',
      phone: jc.customer?.mobileNo || 'N/A',
      vehicleInfo: `${jc.vehicle?.brand?.name || ''} ${jc.vehicle?.model || ''}`.trim() || 'Unknown',
      vehicleSpec: `${jc.vehicle?.vehicleColor || ''} - ${jc.vehicle?.fuelType || ''}`.trim() || 'N/A',
      services: servicesList,
      mechanic: mechanicText,
      bay,
      bayName: bay ? bay.bayName : null,
      status: statusText,
      delivery: jc.expectedDeliveryAt ? jc.expectedDeliveryAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : 'N/A'
    };
  });

  return {
    kpis: {
      pending: pendingCount,
      assigned: assignedCount,
      inProgress: inProgressCount,
      completed: completedCount
    },
    queue: queue.filter(q => q.status !== 'Delivered') // Filter out delivered from active queue
  };
};

const getTvKioskDashboard = async ({ locationId } = {}) => {
  const dateFilter = {};
  if (locationId) {
    dateFilter.locationId = locationId;
  }

  const allJobCards = await prisma.jobCard.findMany({
    where: {
      ...dateFilter,
      currentStatus: {
        statusCode: {
          notIn: [
            'DELIVERED',
            'GATE_ENTRY_CREATED',
            'JOB_CARD_PENDING',
            'JOB_CARD_CREATED',
            'APPROVAL_PENDING',
            'APPROVED',
            'REJECTED'
          ]
        }
      }
    },
    include: {
      customer: true,
      vehicle: {
        include: { brand: true }
      },
      currentStatus: true
    },
    orderBy: {
      updatedAt: 'desc'
    }
  });

  const queue = allJobCards.map(jc => {
    const statusCode = jc.currentStatus?.statusCode || '';

    let column = 'MECHANICAL';
    if (statusCode === 'READY_FOR_DELIVERY' || statusCode.includes('DELIVERY')) {
      column = 'READY_FOR_DELIVERY';
    } else if (statusCode.includes('BODY_SHOP') || statusCode.includes('PAINT')) {
      column = 'BODY_SHOP';
    } else if (statusCode.includes('MECHANICAL')) {
      column = 'MECHANICAL';
    } else {
      // Fallback
      column = 'MECHANICAL';
    }

    const waitMinutes = Math.max(0, Math.floor((new Date().getTime() - new Date(jc.updatedAt).getTime()) / 60000));

    return {
      id: jc.jobCardNo || jc.id,
      rawId: jc.id,
      jobCardNo: jc.jobCardNo,
      vehicleNumber: jc.vehicle?.registrationNo || 'N/A',
      customerName: jc.customer?.fullName || 'Unknown',
      vehicleInfo: `${jc.vehicle?.brand?.name || ''} ${jc.vehicle?.model || ''}`.trim() || 'Unknown',
      status: statusCode,
      column,
      waitMinutes,
      updatedAt: jc.updatedAt
    };
  });

  return queue;
};

module.exports = {
  getAdminDashboard,
  getMdDashboard,
  getFloorSupervisorDashboard,
  getManagerDashboard,
  getBodyShopDashboard,
  getTvKioskDashboard
};
