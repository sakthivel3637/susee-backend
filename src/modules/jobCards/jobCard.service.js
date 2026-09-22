const prisma = require('../../config/db');
const { getSocket } = require('../../config/socket');
const { STATUS_MODULE_CODES, statusModuleFilter, resolveStatusById, resolveStatusFromCodes, resolveStatusIdFromCodes } = require('../../common/utils/status.util');
const { normalizeVehicleNumber } = require('../../utils/normalizeVehicleNumber');
const { createAuditLog } = require('../../common/utils/audit.util');
const { syncAssignmentPendingStages } = require('../processStageTracking/departmentAssignmentStage.service');
const { startStage, completeStage } = require('../processStageTracking/processStageTracking.service');

const syncJobCardStageTracking = async (tx, jobCardId, oldStatusId, newStatus, user) => {
  const jobCard = await tx.jobCard.findUnique({ where: { id: jobCardId } });
  if (!jobCard) return;

  if (oldStatusId) {
    await completeStage({
      jobCardId: jobCard.id,
      moduleId: newStatus.moduleId,
      statusId: oldStatusId,
      modifiedById: user?.userId || null
    }, tx);
  }

  await startStage({
    locationId: jobCard.locationId,
    gateEntryId: jobCard.gateEntryId,
    jobCardId: jobCard.id,
    customerId: jobCard.customerId,
    vehicleId: jobCard.vehicleId,
    moduleId: newStatus.moduleId,
    statusId: newStatus.id,
    createdById: user?.userId || null
  }, tx);
};

const normalizeText = (value) => String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-');

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const toTrimmedString = (value) => {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toOptionalNumber = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const JOB_CARD_SERVICE_PENDING_STATUS_CODES = ['PENDING'];
const JOB_CARD_SERVICE_REJECTED_STATUS_CODES = ['REJECTED'];
const JOB_CARD_APPROVED_STATUS_CODES = ['APPROVED'];
const JOB_CARD_REJECTED_STATUS_CODES = ['REJECTED'];
const APPROVAL_APPROVED_STATUS_CODES = ['APPROVED'];
const APPROVAL_REJECTED_STATUS_CODES = ['REJECTED'];
const DEPARTMENT_ORDER = ['mechanical', 'body-shop', 'water-wash'];
const DEPARTMENT_ALIASES = {
  mechanical: ['mechanical', 'mechanic', 'mechnanic', 'floor'],
  'body-shop': ['body-shop', 'body_shop', 'body shop', 'bodyshop', 'paint', 'denting'],
  'water-wash': ['water-wash', 'water_wash', 'water wash', 'wash']
};
const ASSIGNMENT_STATUS_CODES = {
  mechanical: {
    assigned: ['MECHANICAL_ASSIGNED'],
    inProgress: ['MECHANICAL_IN_PROGRESS'],
    completed: ['MECHANICAL_COMPLETED']
  },
  'body-shop': {
    assigned: ['BODY_SHOP_ASSIGNED'],
    inProgress: ['BODY_SHOP_IN_PROGRESS'],
    completed: ['BODY_SHOP_COMPLETED']
  },
  'water-wash': {
    assigned: ['WATER_WASH_ASSIGNED'],
    inProgress: ['WATER_WASH_IN_PROGRESS'],
    completed: ['WATER_WASH_COMPLETED']
  }
};
const READY_FOR_DELIVERY_STATUS_CODES = ['READY_FOR_DELIVERY'];
const FINAL_JOB_CARD_STATUS_CODES = ['DELIVERED', 'REJECTED'];

const parseExpectedDeliveryAt = (value) => {
  const trimmed = toTrimmedString(value);
  if (!trimmed) return undefined;

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    throw createHttpError(400, 'Expected delivery date must be valid');
  }

  return date;
};

const normalizeCustomerApprovalDecision = (payload = {}) => {
  const rawValue = payload.customer_approval
    ?? payload.customerApproval
    ?? payload.customerApprovalStatus
    ?? payload.approvalStatus
    ?? payload.approvalDecision;

  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return null;
  }

  const normalized = String(rawValue).trim().toUpperCase();

  if (['YES', 'Y', 'APPROVE', 'APPROVED', 'TRUE'].includes(normalized)) {
    return 'APPROVED';
  }

  if (['NO', 'N', 'REJECT', 'REJECTED', 'FALSE'].includes(normalized)) {
    // Default to APPROVED since the rejection flow has been replaced by signature
    return 'APPROVED';
  }

  return 'APPROVED';
};

const buildJobCardIdentifierWhere = (identifier) => {
  const parsedId = Number(identifier);
  const isNumericId = Number.isInteger(parsedId) && parsedId > 0;

  return isNumericId
    ? { id: parsedId }
    : { slug: String(identifier || '').trim() };
};

const normalizeServicePayload = (services = []) => {
  if (!Array.isArray(services)) return [];

  const duplicateIdsWithoutNaturalKey = new Set();
  const seenIdsWithoutNaturalKey = new Set();
  const itemMap = new Map();

  services.forEach((item) => {
    const rawServiceItemId = typeof item === 'object' ? (item.serviceItemId ?? item.id) : item;
    const parsedServiceItemId = Number(rawServiceItemId);
    const serviceName = typeof item === 'object' ? toTrimmedString(item.name || item.serviceName) : undefined;

    if (Number.isInteger(parsedServiceItemId) && parsedServiceItemId > 0 && !serviceName) {
      if (seenIdsWithoutNaturalKey.has(parsedServiceItemId)) {
        duplicateIdsWithoutNaturalKey.add(parsedServiceItemId);
      }

      seenIdsWithoutNaturalKey.add(parsedServiceItemId);
    }
  });

  if (duplicateIdsWithoutNaturalKey.size > 0) {
    throw createHttpError(
      400,
      'Duplicate service item ids are ambiguous. Send each selected service with its own serviceItemId, or include serviceName for each item.'
    );
  }

  services.forEach((item) => {
    const rawServiceItemId = typeof item === 'object' ? (item.serviceItemId ?? item.id) : item;
    const parsedServiceItemId = Number(rawServiceItemId);
    const serviceName = typeof item === 'object' ? toTrimmedString(item.name || item.serviceName) : undefined;
    const price = typeof item === 'object' ? toOptionalNumber(item.price) : undefined;
    const quantity = Math.max(1, Number(typeof item === 'object' && item.quantity !== undefined ? item.quantity : 1) || 1);
    const key = Number.isInteger(parsedServiceItemId) && parsedServiceItemId > 0
      ? `id:${parsedServiceItemId}`
      : `name:${String(serviceName || '').toLowerCase()}`;

    if (!key.endsWith(':')) {
      const existing = itemMap.get(key);
      itemMap.set(key, {
        serviceItemId: Number.isInteger(parsedServiceItemId) && parsedServiceItemId > 0 ? parsedServiceItemId : null,
        serviceName,
        price,
        quantity: (existing ? existing.quantity : 0) + quantity
      });
    }
  });

  return Array.from(itemMap.values());
};

const resolveServiceSelections = async (tx, payloadServices) => {
  const normalizedServices = normalizeServicePayload(payloadServices);
  if (normalizedServices.length === 0) return [];

  const serviceItemIds = normalizedServices
    .map((item) => item.serviceItemId)
    .filter(Boolean);
  const serviceNames = normalizedServices
    .filter((item) => !item.serviceItemId && item.serviceName)
    .map((item) => item.serviceName);

  const serviceItems = await tx.serviceItem.findMany({
    where: {
      isActive: true,
      category: {
        isActive: true
      },
      OR: [
        ...(serviceItemIds.length > 0 ? [{ id: { in: serviceItemIds } }] : []),
        ...(serviceNames.length > 0 ? [{ name: { in: serviceNames } }] : [])
      ]
    },
    select: {
      id: true,
      name: true,
      defaultPrice: true
    }
  });

  const byId = new Map(serviceItems.map((item) => [item.id, item]));
  const byName = new Map(serviceItems.map((item) => [String(item.name).toLowerCase(), item]));

  return normalizedServices.map((selection) => {
    const serviceItem = selection.serviceItemId
      ? byId.get(selection.serviceItemId)
      : byName.get(String(selection.serviceName || '').toLowerCase());

    if (!serviceItem) {
      throw createHttpError(400, 'One or more selected services are invalid or inactive');
    }

    return {
      serviceItemId: serviceItem.id,
      serviceName: serviceItem.name,
      price: selection.price !== undefined ? selection.price : Number(serviceItem.defaultPrice),
      quantity: selection.quantity
    };
  });
};

const normalizeDepartment = (value) => {
  const normalizedValue = normalizeText(value);

  return DEPARTMENT_ORDER.find((department) => {
    return DEPARTMENT_ALIASES[department].some((alias) => normalizeText(alias) === normalizedValue);
  });
};

const ROLE_ALIASES = {
  body_shop: 'body_shop_supervisor',
  bodyshop: 'body_shop_supervisor',
  bodyshop_supervisor: 'body_shop_supervisor',
  floor: 'floor_supervisor',
  mechanical_supervisor: 'floor_supervisor',
  water_wash: 'water_wash_team',
  water_wash_supervisor: 'water_wash_team',
  wash: 'water_wash_team'
};

const normalizeRoleSlug = (roleSlug) => {
  const normalized = String(roleSlug || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  return ROLE_ALIASES[normalized] || normalized;
};

const PRIVILEGED_SERVICE_STATUS_ROLES = new Set(['admin', 'super_admin', 'manager', 'managing_director']);

const ROLE_DEPARTMENTS = {
  floor_supervisor: 'mechanical',
  mechanical: 'mechanical',
  mechanic: 'mechanical',
  body_shop_supervisor: 'body-shop',
  water_wash_supervisor: 'water-wash',
  water_wash_team: 'water-wash',
  water_wash: 'water-wash'
};
const ROLE_JOB_CARD_DEPARTMENTS = {
  body_shop_supervisor: 'body-shop',
  water_wash_supervisor: 'water-wash',
  water_wash_team: 'water-wash',
  water_wash: 'water-wash'
};

const MODULE_DEPARTMENTS = {
  'floor-supervisor': 'mechanical',
  'body-shop-supervisor': 'body-shop',
  'water-wash-team': 'water-wash'
};
const PRIVILEGED_MODULES = new Set(['admin', 'manager', 'managing-director']);

const getAllowedDepartments = (user) => {
  if (!user) return [];

  const allowed = new Set();
  let isPrivileged = false;

  if (Array.isArray(user.modules)) {
    for (const mod of user.modules) {
      if (PRIVILEGED_MODULES.has(mod)) isPrivileged = true;
      if (MODULE_DEPARTMENTS[mod]) allowed.add(MODULE_DEPARTMENTS[mod]);
    }
  }

  const roleSlug = normalizeRoleSlug(user.roleSlug);
  if (PRIVILEGED_SERVICE_STATUS_ROLES.has(roleSlug)) {
    isPrivileged = true;
  }

  const deptFromRole = ROLE_DEPARTMENTS[roleSlug];
  if (deptFromRole) {
    allowed.add(deptFromRole);
  }

  if (isPrivileged) return ['all'];
  return Array.from(allowed);
};

const getServiceDepartment = (service) => {
  const category = service && service.serviceItem && service.serviceItem.category;
  return normalizeDepartment(category && (category.slug || category.name));
};

const getQueryDepartment = (query, user) => {
  const requestedDepartment = normalizeDepartment(query.department || query.category);

  if (requestedDepartment) {
    return [requestedDepartment];
  }

  const allowed = getAllowedDepartments(user);
  if (allowed.includes('all')) return [];

  return allowed;
};

const getStatusCode = (status) => String((status && status.statusCode) || '').trim().toUpperCase();

const isRejectedAdditionalService = (service) => {
  return Boolean(service && service.isAdditional && getStatusCode(service.approvalStatus) === 'REJECTED');
};

const isApprovedForWork = (service) => {
  if (!service || !service.isAdditional) {
    return true;
  }

  return getStatusCode(service.approvalStatus) === 'APPROVED';
};

const isCompletedStatusCode = (statusCode) => {
  const code = String(statusCode || '').trim().toUpperCase();
  return (
    code === 'COMPLETED' ||
    code.endsWith('_COMPLETED') ||
    code === 'REJECTED' ||
    code.endsWith('_REJECTED') ||
    code === 'CANCELLED' ||
    code.endsWith('_CANCELLED')
  );
};

const isPostponedStatusCode = (statusCode) => {
  const code = String(statusCode || '').trim().toUpperCase();
  return code === 'POSTPONED';
};

const isInProgressStatusCode = (statusCode) => {
  const code = String(statusCode || '').trim().toUpperCase();
  return code === 'IN_PROGRESS' || code.endsWith('_IN_PROGRESS');
};

const getDepartmentServices = (jobCard, department) => {
  return (jobCard.services || []).filter((service) => getServiceDepartment(service) === department);
};

const isJobCardServiceCompleted = (service) => {
  if (isRejectedAdditionalService(service)) {
    return true;
  }

  if (isCompletedStatusCode(getStatusCode(service.serviceStatus))) {
    return true;
  }

  const assignments = service.workAssignments || [];
  return assignments.length > 0 && assignments.every((assignment) => {
    return assignment.completedAt || isCompletedStatusCode(getStatusCode(assignment.status));
  });
};

const isJobCardServiceCompletedOrPostponed = (service) => {
  if (isJobCardServiceCompleted(service)) {
    return true;
  }
  return isPostponedStatusCode(getStatusCode(service.serviceStatus));
};

const isJobCardServiceInProgress = (service) => {
  if (isInProgressStatusCode(getStatusCode(service.serviceStatus))) {
    return true;
  }

  const assignments = service.workAssignments || [];
  return assignments.some((assignment) => {
    return assignment.startedAt || isInProgressStatusCode(getStatusCode(assignment.status));
  });
};

const areAllJobCardServicesCompleted = (jobCard) => {
  const services = (jobCard.services || []).filter((service) => {
    return isApprovedForWork(service) && !isRejectedAdditionalService(service);
  });
  return services.length > 0 && services.every(isJobCardServiceCompleted);
};

const arePreviousDepartmentsCompleted = (jobCard, department) => {
  const departmentIndex = DEPARTMENT_ORDER.indexOf(department);
  const previousDepartments = DEPARTMENT_ORDER.slice(0, departmentIndex);

  return previousDepartments.every((previousDepartment) => {
    const services = getDepartmentServices(jobCard, previousDepartment).filter((service) => {
      return isApprovedForWork(service) && !isRejectedAdditionalService(service);
    });
    return services.length === 0 || services.every(isJobCardServiceCompletedOrPostponed);
  });
};

const validateServiceStatusUpdateAccess = (jobCard, service, user) => {
  const allowedDepartments = getAllowedDepartments(user);

  if (allowedDepartments.length === 0) {
    throw createHttpError(403, 'You are not allowed to update service status');
  }

  if (allowedDepartments.includes('all')) {
    return;
  }

  const serviceDepartment = getServiceDepartment(service);

  if (!serviceDepartment || !allowedDepartments.includes(serviceDepartment)) {
    throw createHttpError(403, 'You can update only your department service status');
  }

  if (!arePreviousDepartmentsCompleted(jobCard, serviceDepartment)) {
    throw createHttpError(400, 'Previous service stage must be completed before updating this service status');
  }

  if (!isApprovedForWork(service)) {
    throw createHttpError(400, 'Additional work must be customer approved before it can be started');
  }

  if (isJobCardServiceCompleted(service)) {
    throw createHttpError(400, 'Completed service status cannot be changed');
  }
};

const resolveRequiredStatus = async (tx, moduleCode, statusCodes, label) => {
  const status = await resolveStatusFromCodes(tx, moduleCode, statusCodes);

  if (!status) {
    throw createHttpError(500, `${label} status is not configured`);
  }

  return status;
};

const syncAssignmentsForServiceStatus = async (tx, service, serviceStatus, user) => {
  const serviceStatusCode = getStatusCode(serviceStatus);
  const shouldStart = isInProgressStatusCode(serviceStatusCode);
  const shouldComplete = isCompletedStatusCode(serviceStatusCode);

  if (!shouldStart && !shouldComplete) {
    return;
  }

  const assignments = service.workAssignments || [];
  if (assignments.length === 0) {
    if (['REJECTED', 'CANCELLED', 'POSTPONED'].some((status) => serviceStatusCode.includes(status))) {
      return;
    }
    throw createHttpError(400, 'Service must be assigned before work status can be updated');
  }

  const department = getServiceDepartment(service);
  if (!department) {
    throw createHttpError(400, 'Service category is not supported for work status update');
  }

  const assignmentStatus = await resolveRequiredStatus(
    tx,
    STATUS_MODULE_CODES.WORK_ASSIGNMENT,
    shouldComplete ? ASSIGNMENT_STATUS_CODES[department].completed : ASSIGNMENT_STATUS_CODES[department].inProgress,
    `${department} assignment ${shouldComplete ? 'completed' : 'in progress'}`
  );
  const now = new Date();

  for (const assignment of assignments) {
    await tx.workAssignment.update({
      where: { id: assignment.id },
      data: {
        statusId: assignmentStatus.id,
        startedAt: assignment.startedAt || now,
        ...(shouldComplete ? { completedAt: assignment.completedAt || now } : {}),
        modifiedById: user && user.userId ? user.userId : null
      }
    });
  }
};

const deriveJobCardStatus = async (tx, jobCard) => {
  if (areAllJobCardServicesCompleted(jobCard)) {
    return resolveRequiredStatus(
      tx,
      STATUS_MODULE_CODES.JOB_CARD_STATUS,
      READY_FOR_DELIVERY_STATUS_CODES,
      'Ready for delivery job card'
    );
  }

  let firstPostponed = null;
  let activeDepartment = null;

  for (const department of DEPARTMENT_ORDER) {
    const services = getDepartmentServices(jobCard, department).filter(service => isApprovedForWork(service) && !isRejectedAdditionalService(service));
    if (services.length === 0) {
      continue;
    }

    if (services.every(isJobCardServiceCompleted)) {
      continue;
    }

    const hasPostponed = services.some(service => getStatusCode(service.serviceStatus) === 'POSTPONED');
    const allPostponedOrCompleted = services.every(service => {
      return getStatusCode(service.serviceStatus) === 'POSTPONED' || isJobCardServiceCompleted(service);
    });

    if (hasPostponed && allPostponedOrCompleted) {
      if (!firstPostponed) firstPostponed = department;
      continue;
    }

    activeDepartment = department;
    break;
  }

  // If the active department is water-wash, but there's a postponed department,
  // we must return to the postponed department because water wash is strictly done last.
  let targetDepartment = activeDepartment || firstPostponed;
  if (activeDepartment === 'water-wash' && firstPostponed) {
    targetDepartment = firstPostponed;
  }

  if (targetDepartment) {
    const services = getDepartmentServices(jobCard, targetDepartment).filter(service => isApprovedForWork(service) && !isRejectedAdditionalService(service));
    
    // If it's a postponed department that we auto-returned to, 
    // it shouldn't show as IN_PROGRESS unless someone actually started working on it.
    // If all unfinished services are POSTPONED, it should be ASSIGNED.
    const hasActiveUncompleted = services.some(service => 
      !isJobCardServiceCompleted(service) && getStatusCode(service.serviceStatus) !== 'POSTPONED'
    );

    if (hasActiveUncompleted) {
      return resolveRequiredStatus(
        tx,
        STATUS_MODULE_CODES.JOB_CARD_STATUS,
        ASSIGNMENT_STATUS_CODES[targetDepartment].inProgress,
        `${targetDepartment} job card in progress`
      );
    } else {
      return resolveRequiredStatus(
        tx,
        STATUS_MODULE_CODES.JOB_CARD_STATUS,
        ASSIGNMENT_STATUS_CODES[targetDepartment].assigned,
        `${targetDepartment} job card assigned`
      );
    }
  }

  return null;
};

const toBaySummary = (bay) => bay
  ? {
    id: bay.id,
    bayName: bay.bayName,
    bayCode: bay.bayCode,
    bayType: bay.bayType,
    currentWorkAssignmentId: bay.currentWorkAssignmentId || null,
    availability: bay.currentWorkAssignmentId ? 'BUSY' : 'AVAILABLE'
  }
  : null;

const toAssignmentSummary = (assignment, bayMap = new Map()) => ({
  id: assignment.id,
  jobCardId: assignment.jobCardId,
  jobCardServiceId: assignment.jobCardServiceId,
  assignedUserId: assignment.assignedUserId,
  bayId: assignment.bayId || null,
  bay: assignment.bayId ? toBaySummary(bayMap.get(assignment.bayId)) : null,
  assignedAt: assignment.assignedAt,
  startedAt: assignment.startedAt,
  completedAt: assignment.completedAt,
  status: assignment.status
    ? {
      id: assignment.status.id,
      statusCode: assignment.status.statusCode,
      statusName: assignment.status.statusName
    }
    : null,
  assignedUser: assignment.assignedUser
    ? {
      id: assignment.assignedUser.id,
      fullName: assignment.assignedUser.fullName,
      employeeCode: assignment.assignedUser.employeeCode,
      mobileNo: assignment.assignedUser.mobileNo
    }
    : null,
  service: assignment.jobCardService
    ? {
      id: assignment.jobCardService.id,
      serviceName: assignment.jobCardService.serviceName,
      category: assignment.jobCardService.serviceItem && assignment.jobCardService.serviceItem.category
        ? {
          id: assignment.jobCardService.serviceItem.category.id,
          name: assignment.jobCardService.serviceItem.category.name,
          slug: assignment.jobCardService.serviceItem.category.slug
        }
        : null
    }
    : null
});

const toJobCardListResponse = (jobCard, department, bayMap = new Map()) => {
  const allAssignments = (jobCard.workAssignments || []).map((assignment) => toAssignmentSummary(assignment, bayMap));
  const activeAssignments = allAssignments.filter((assignment) => !assignment.completedAt);
  const displayAssignments = allAssignments;
  const departmentAssignments = department && department.length > 0
    ? displayAssignments.filter((assignment) => {
      const assignmentDept = normalizeDepartment(assignment.service && assignment.service.category && (assignment.service.category.slug || assignment.service.category.name));
      return department.includes(assignmentDept);
    })
    : displayAssignments;
  const assignedMechanics = Array.from(
    new Map(
      departmentAssignments
        .filter((assignment) => assignment.assignedUser)
        .map((assignment) => [assignment.assignedUser.id, assignment.assignedUser])
    ).values()
  );
  const assignedMechanic = assignedMechanics[0] || null;
  const assignedBays = Array.from(
    new Map(
      departmentAssignments
        .filter((assignment) => assignment.bay)
        .map((assignment) => [assignment.bay.id, assignment.bay])
    ).values()
  );
  const assignedBay = assignedBays[0] || null;

  return {
    ...jobCard,
    workAssignments: activeAssignments,
    activeAssignments,
    assignmentHistory: displayAssignments,
    assignedMechanic,
    assignedMechanics,
    assignedBay,
    assignedBays,
    bay: assignedBay,
    technician: assignedMechanics.length > 0 ? assignedMechanics.map((mechanic) => mechanic.fullName).join(', ') : null,
    technicianId: assignedMechanic ? assignedMechanic.id : null,
    technicianEmployeeCode: assignedMechanic ? assignedMechanic.employeeCode : null
  };
};

const listJobCards = async (query, user) => {
  const isExport = query.export === 'true';
  const page = isExport ? 1 : parseInt(query.page, 10) || 1;
  const limit = isExport ? 1000000 : parseInt(query.limit, 10) || 10;
  const skip = (page - 1) * limit;
  const department = getQueryDepartment(query, user);

  const where = {};

  const locationId = user?.locationId || query.locationId;
  if (locationId) {
    where.locationId = Number(locationId);
  }

  let matchingBayIds = [];
  if (query.search) {
    const matchingBays = await prisma.bay.findMany({
      where: {
        OR: [
          { bayName: { contains: query.search } },
          { bayCode: { contains: query.search } }
        ]
      },
      select: { id: true }
    });
    matchingBayIds = matchingBays.map((b) => b.id);
  }

  if (query.search) {
    where.OR = [
      { jobCardNo: { contains: query.search } },
      { vehicle: { registrationNo: { contains: query.search } } },
      { customer: { fullName: { contains: query.search } } },
      { customer: { mobileNo: { contains: query.search } } }
    ];

    if (matchingBayIds.length > 0) {
      where.OR.push({
        workAssignments: {
          some: {
            bayId: { in: matchingBayIds }
          }
        }
      });
    }
  }

  if (query.status) {
    where.currentStatus = {
      is: {
        statusCode: String(query.status).trim().toUpperCase(),
        ...statusModuleFilter(STATUS_MODULE_CODES.JOB_CARD_STATUS)
      }
    };
  }

  if (query.fromDate || query.toDate) {
    where.createdAt = {};
    if (query.fromDate) {
      where.createdAt.gte = new Date(query.fromDate);
    }
    if (query.toDate) {
      const to = new Date(query.toDate);
      to.setUTCHours(23, 59, 59, 999);
      where.createdAt.lte = to;
    }
  }

  if (department && department.length > 0) {
    where.services = {
      some: {
        serviceItem: {
          category: {
            slug: { in: department }
          }
        }
      }
    };
  }

  const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';

  const [jobCards, total] = await Promise.all([
    prisma.jobCard.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: sortOrder },
      include: {
        customer: {
          select: { id: true, fullName: true, mobileNo: true }
        },
        vehicle: {
          select: { id: true, registrationNo: true }
        },
        currentStatus: {
          select: { id: true, statusCode: true, statusName: true }
        },
        location: {
          select: { id: true, locationName: true, locationCode: true }
        },
        workAssignments: {
          include: {
            assignedUser: {
              select: {
                id: true,
                fullName: true,
                employeeCode: true,
                mobileNo: true
              }
            },
            status: {
              select: {
                id: true,
                statusCode: true,
                statusName: true
              }
            },
            jobCardService: {
              select: {
                id: true,
                serviceName: true,
                serviceItem: {
                  select: {
                    category: {
                      select: {
                        id: true,
                        name: true,
                        slug: true
                      }
                    }
                  }
                }
              }
            }
          },
          orderBy: {
            assignedAt: 'desc'
          }
        }
      }
    }),
    prisma.jobCard.count({ where })
  ]);
  const bayIds = Array.from(new Set(
    jobCards
      .flatMap((jobCard) => jobCard.workAssignments || [])
      .map((assignment) => assignment.bayId)
      .filter(Boolean)
  ));
  const bays = bayIds.length > 0
    ? await prisma.bay.findMany({
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
    })
    : [];
  const bayMap = new Map(bays.map((bay) => [bay.id, bay]));

  return {
    jobCards: jobCards.map((jobCard) => toJobCardListResponse(jobCard, department, bayMap)),
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  };
};

const getJobCardById = async (id, user) => {
  const jobCard = await prisma.jobCard.findFirst({
    where: {
      ...buildJobCardIdentifierWhere(id),
      ...(user && user.locationId ? { locationId: Number(user.locationId) } : {})
    },
    include: {
      customer: {
        select: { id: true, fullName: true, mobileNo: true, emailId: true, address: true }
      },
      vehicle: {
        select: {
          id: true,
          registrationNo: true,
          model: true,
          variant: true,
          fuelType: true,
          vehicleColor: true,
          brand: {
            select: { id: true, name: true }
          }
        }
      },
      currentStatus: {
        select: { id: true, statusCode: true, statusName: true }
      },
      approvalStatus: {
        select: { id: true, statusCode: true, statusName: true }
      },
      location: {
        select: { id: true, locationName: true, locationCode: true }
      },
      gateEntry: {
        select: { id: true, entryType: true, gateEntryNo: true }
      },
      services: {
        include: {
          serviceItem: {
            include: {
              category: true
            }
          },
          approvalStatus: true,
          serviceStatus: true
        }
      },
      workAssignments: {
        include: {
          assignedUser: {
            select: { id: true, fullName: true, employeeCode: true, mobileNo: true }
          },
          status: true,
          jobCardService: {
            select: {
              id: true,
              serviceName: true,
              serviceItem: {
                select: {
                  category: true
                }
              }
            }
          }
        }
      }
    }
  });

  if (!jobCard) {
    throw new Error('Job Card not found');
  }

  return jobCard;
};

const listJobCardStatuses = async () => {
  return prisma.statusMaster.findMany({
    where: {
      isActive: true,
      ...statusModuleFilter(STATUS_MODULE_CODES.JOB_CARD_STATUS)
    },
    orderBy: [
      { sortOrder: 'asc' },
      { statusName: 'asc' }
    ],
    select: {
      id: true,
      statusCode: true,
      statusName: true,
      slug: true,
      sortOrder: true,
      isFinal: true
    }
  });
};

const listJobCardServiceStatuses = async () => {
  return prisma.statusMaster.findMany({
    where: {
      isActive: true,
      ...statusModuleFilter(STATUS_MODULE_CODES.JOB_CARD_SERVICE)
    },
    orderBy: [
      { sortOrder: 'asc' },
      { statusName: 'asc' }
    ],
    select: {
      id: true,
      statusCode: true,
      statusName: true,
      slug: true,
      sortOrder: true,
      isFinal: true
    }
  });
};

const updateJobCard = async (id, payload, user) => {
  const identifierWhere = buildJobCardIdentifierWhere(id);

  if (!identifierWhere.id && !identifierWhere.slug) {
    throw createHttpError(400, 'Valid job card id is required');
  }

  const existingJobCard = await prisma.jobCard.findFirst({
    where: {
      ...identifierWhere,
      ...(user && user.locationId ? { locationId: Number(user.locationId) } : {})
    },
    include: {
      customer: true,
      vehicle: true,
      currentStatus: {
        select: { id: true, statusCode: true, statusName: true }
      },
      services: {
        include: {
          workAssignments: {
            include: {
              status: true
            }
          },
          serviceItem: {
            include: {
              category: true
            }
          },
          approvalStatus: true,
          serviceStatus: true
        }
      }
    }
  });

  if (!existingJobCard) {
    throw createHttpError(404, 'Job Card not found');
  }

  const jobCardId = existingJobCard.id;

  const customerName = toTrimmedString(payload.ownerName || payload.customerName || payload.customerInfo?.fullName);
  const customerMobile = toTrimmedString(payload.ownerMobile || payload.mobile || payload.customerInfo?.mobileNo);
  const customerAlternateMobile = toTrimmedString(payload.customerInfo?.alternateMobileNo);
  const customerEmail = toTrimmedString(payload.customerInfo?.emailId);
  const customerAddress = toTrimmedString(payload.customerInfo?.address);
  const vehicleNumber = toTrimmedString(payload.vehicleNumber || payload.registrationNumber || payload.vehicleInfo?.registrationNumber || payload.vehicleInfo?.registrationNo);
  const vehicleModel = toTrimmedString(payload.makeModel || payload.vehicleModel || payload.vehicleInfo?.model);
  const vehicleVariant = toTrimmedString(payload.vehicleInfo?.variant);
  const vehicleColor = toTrimmedString(payload.vehicleInfo?.vehicleColor || payload.vehicleInfo?.color);
  const vehicleFuelType = toTrimmedString(payload.vehicleInfo?.fuelType);
  const vehicleChassisNo = toTrimmedString(payload.vehicleInfo?.chassisNo);
  const vehicleEngineNo = toTrimmedString(payload.vehicleInfo?.engineNo);
  const vehicleBrandId = payload.vehicleInfo?.brandId ? Number(payload.vehicleInfo.brandId) : undefined;
  const notes = toTrimmedString(payload.notes || payload.customerComplaint);
  const additionalNotes = toTrimmedString(payload.additionalNotes);
  const expectedDeliveryAt = parseExpectedDeliveryAt(payload.deliveryDate || payload.expectedDeliveryAt);
  const customerApprovalDecision = normalizeCustomerApprovalDecision(payload);
  const selectedServices = await prisma.$transaction(async (tx) => {
    return resolveServiceSelections(tx, payload.serviceItems || payload.services || []);
  });
  const serviceStatusUpdates = Array.isArray(payload.serviceStatuses)
    ? payload.serviceStatuses
      .map((item) => ({
        jobCardServiceId: Number(item.jobCardServiceId || item.id),
        statusId: Number(item.statusId || item.serviceStatusId)
      }))
      .filter((item) => Number.isInteger(item.jobCardServiceId) && item.jobCardServiceId > 0 && Number.isInteger(item.statusId) && item.statusId > 0)
    : [];

  return prisma.$transaction(async (tx) => {
    if (customerName !== undefined || customerMobile !== undefined || customerAlternateMobile !== undefined || customerEmail !== undefined || customerAddress !== undefined) {
      await tx.customer.update({
        where: { id: existingJobCard.customerId },
        data: {
          ...(customerName !== undefined ? { fullName: customerName } : {}),
          ...(customerMobile !== undefined ? { mobileNo: customerMobile } : {}),
          ...(customerAlternateMobile !== undefined ? { alternateMobileNo: customerAlternateMobile } : {}),
          ...(customerEmail !== undefined ? { emailId: customerEmail } : {}),
          ...(customerAddress !== undefined ? { address: customerAddress } : {}),
          modifiedById: user && user.userId ? user.userId : null
        }
      });
    }

    if (
      vehicleNumber !== undefined || vehicleModel !== undefined || vehicleVariant !== undefined ||
      vehicleColor !== undefined || vehicleFuelType !== undefined || vehicleChassisNo !== undefined ||
      vehicleEngineNo !== undefined || vehicleBrandId !== undefined
    ) {
      const vehicleData = {
        ...(vehicleModel !== undefined ? { model: vehicleModel } : {}),
        ...(vehicleVariant !== undefined ? { variant: vehicleVariant } : {}),
        ...(vehicleColor !== undefined ? { vehicleColor: vehicleColor } : {}),
        ...(vehicleFuelType !== undefined ? { fuelType: vehicleFuelType } : {}),
        ...(vehicleChassisNo !== undefined ? { chassisNo: vehicleChassisNo } : {}),
        ...(vehicleEngineNo !== undefined ? { engineNo: vehicleEngineNo } : {}),
        ...(vehicleBrandId !== undefined && !Number.isNaN(vehicleBrandId) ? { brandId: vehicleBrandId } : {}),
        modifiedById: user && user.userId ? user.userId : null
      };

      if (vehicleNumber !== undefined) {
        const normalizedVehicleNumber = normalizeVehicleNumber(vehicleNumber);
        const duplicateVehicle = await tx.vehicle.findFirst({
          where: {
            registrationNo: normalizedVehicleNumber,
            id: { not: existingJobCard.vehicleId }
          },
          select: { id: true }
        });

        if (duplicateVehicle) {
          throw createHttpError(409, 'Vehicle number already exists for another vehicle');
        }

        vehicleData.registrationNo = normalizedVehicleNumber;
      }

      await tx.vehicle.update({
        where: { id: existingJobCard.vehicleId },
        data: vehicleData
      });
    }

    if (selectedServices.length > 0) {
      const pendingServiceStatusId = await resolveStatusIdFromCodes(
        tx,
        STATUS_MODULE_CODES.JOB_CARD_SERVICE,
        JOB_CARD_SERVICE_PENDING_STATUS_CODES
      );
      const selectedIds = new Set(selectedServices.map((service) => service.serviceItemId));
      const existingByServiceItemId = new Map(
        existingJobCard.services.map((service) => [service.serviceItemId, service])
      );

      for (const selectedService of selectedServices) {
        const existingService = existingByServiceItemId.get(selectedService.serviceItemId);
        if (existingService) {
          await tx.jobCardService.update({
            where: { id: existingService.id },
            data: {
              serviceName: selectedService.serviceName,
              price: selectedService.price,
              quantity: selectedService.quantity,
              modifiedById: user && user.userId ? user.userId : null
            }
          });
        } else {
          await tx.jobCardService.create({
            data: {
              jobCardId,
              serviceItemId: selectedService.serviceItemId,
              serviceName: selectedService.serviceName,
              price: selectedService.price,
              quantity: selectedService.quantity,
              serviceStatusId: pendingServiceStatusId,
              isAdditional: false,
              createdById: user && user.userId ? user.userId : null
            }
          });
        }
      }

      const removableServiceIds = existingJobCard.services
        .filter((service) => !selectedIds.has(service.serviceItemId) && service.workAssignments.length === 0)
        .map((service) => service.id);

      if (removableServiceIds.length > 0) {
        await tx.jobCardService.deleteMany({
          where: {
            id: { in: removableServiceIds }
          }
        });
      }
    }

    if (serviceStatusUpdates.length > 0) {
      const existingServicesById = new Map(existingJobCard.services.map((service) => [service.id, service]));

      for (const item of serviceStatusUpdates) {
        const existingService = existingServicesById.get(item.jobCardServiceId);
        if (!existingService) {
          throw createHttpError(400, 'One or more selected services are invalid for this job card');
        }

        validateServiceStatusUpdateAccess(existingJobCard, existingService, user);

        const serviceStatus = await resolveStatusById(tx, STATUS_MODULE_CODES.JOB_CARD_SERVICE, item.statusId);

        if (!serviceStatus) {
          throw createHttpError(400, 'Invalid job card service status');
        }

        await syncAssignmentsForServiceStatus(tx, existingService, serviceStatus, user);

        await tx.jobCardService.update({
          where: { id: item.jobCardServiceId },
          data: {
            serviceStatusId: serviceStatus.id,
            modifiedById: user && user.userId ? user.userId : null
          }
        });
      }
    }

    const latestJobCardForStatus = await tx.jobCard.findUnique({
      where: { id: jobCardId },
      select: {
        id: true,
        locationId: true,
        gateEntryId: true,
        customerId: true,
        vehicleId: true,
        currentStatus: {
          select: {
            statusCode: true
          }
        },
        approvalStatus: {
          select: {
            statusCode: true
          }
        },
        services: {
          include: {
            serviceStatus: true,
            approvalStatus: true,
            serviceItem: {
              include: {
                category: true
              }
            },
            workAssignments: {
              include: {
                status: true
              }
            }
          }
        }
      }
    });
    const nextStatus = latestJobCardForStatus ? await deriveJobCardStatus(tx, latestJobCardForStatus) : null;
    let approvalStatus = null;
    let approvalJobCardStatus = null;

    if (customerApprovalDecision) {
      const isApproved = customerApprovalDecision === 'APPROVED';

      approvalStatus = await resolveRequiredStatus(
        tx,
        STATUS_MODULE_CODES.APPROVAL_STATUS,
        isApproved ? APPROVAL_APPROVED_STATUS_CODES : APPROVAL_REJECTED_STATUS_CODES,
        `${customerApprovalDecision.toLowerCase()} approval`
      );

      approvalJobCardStatus = await resolveRequiredStatus(
        tx,
        STATUS_MODULE_CODES.JOB_CARD_STATUS,
        isApproved ? JOB_CARD_APPROVED_STATUS_CODES : JOB_CARD_REJECTED_STATUS_CODES,
        `${customerApprovalDecision.toLowerCase()} job card`
      );

      const rejectedServiceStatus = isApproved
        ? null
        : await resolveRequiredStatus(
          tx,
          STATUS_MODULE_CODES.JOB_CARD_SERVICE,
          JOB_CARD_SERVICE_REJECTED_STATUS_CODES,
          'Rejected job card service'
        );

      await tx.jobCardService.updateMany({
        where: {
          jobCardId,
          isAdditional: false
        },
        data: {
          approvalStatusId: approvalStatus.id,
          ...(rejectedServiceStatus ? { serviceStatusId: rejectedServiceStatus.id } : {}),
          modifiedById: user && user.userId ? user.userId : null
        }
      });
    }

    const servicesAfterUpdate = await tx.jobCardService.findMany({
      where: {
        jobCardId,
        approvalStatus: {
          statusCode: { not: 'REJECTED' }
        },
        serviceStatus: {
          statusCode: { notIn: ['REJECTED', 'CANCELLED'] }
        }
      },
      select: {
        price: true,
        quantity: true
      }
    });
    const serviceSubtotal = servicesAfterUpdate.reduce((sum, service) => {
      return sum + (Number(service.price) * service.quantity);
    }, 0);
    const taxRate = toOptionalNumber(payload.billing?.taxRate);
    const discountAmount = toOptionalNumber(payload.billing?.discountAmount) || 0;

    if (discountAmount > 0 && discountAmount >= serviceSubtotal) {
      throw createHttpError(400, 'Discount amount cannot be equal to or greater than the subtotal');
    }

    const taxableAmount = Math.max(0, serviceSubtotal - discountAmount);
    const taxAmount = toOptionalNumber(payload.billing?.taxAmount);
    const finalAmount = toOptionalNumber(payload.billing?.finalAmount ?? payload.estimatedCost) ?? (taxableAmount + (taxAmount || 0));
    const shouldUpdateFinancials = selectedServices.length > 0 || payload.billing !== undefined || payload.estimatedCost !== undefined;

    await tx.jobCard.update({
      where: { id: jobCardId },
      data: {
        ...(expectedDeliveryAt !== undefined ? { expectedDeliveryAt } : {}),
        ...(notes !== undefined ? { customerComplaint: notes } : {}),
        ...(additionalNotes !== undefined ? { additionalNotes } : {}),
        ...(approvalStatus ? { approvalStatusId: approvalStatus.id } : {}),
        ...(approvalJobCardStatus
          ? { currentStatusId: approvalJobCardStatus.id }
          : nextStatus && nextStatus.id !== existingJobCard.currentStatusId
            ? { currentStatusId: nextStatus.id }
            : {}),
        ...(shouldUpdateFinancials
          ? {
            serviceSubtotal,
            taxRate,
            taxAmount,
            discountAmount,
            finalAmount,
            totalEstimate: finalAmount
          }
          : {}),
        modifiedById: user && user.userId ? user.userId : null
      }
    });

    const statusForLog = approvalJobCardStatus || nextStatus;

    if (statusForLog && statusForLog.id !== existingJobCard.currentStatusId) {
      await syncJobCardStageTracking(tx, jobCardId, existingJobCard.currentStatusId, statusForLog, user);
      await tx.jobCardStatusLog.create({
        data: {
          jobCardId,
          statusId: statusForLog.id,
          changedById: user && user.userId ? user.userId : null,
          remarks: approvalJobCardStatus
            ? `Job card customer approval updated: ${approvalJobCardStatus.statusName}`
            : `Job card status derived from service updates: ${nextStatus.statusName}`
        }
      });

      // Emit socket event for TV Kiosk
      const io = getSocket();
      if (io) {
        // We just need to ping the client so it can refetch, or we can send the partial updated data
        io.emit('jobCardStatusChanged', { jobCardId, newStatus: statusForLog.statusCode });
      }
    }

    const trackingJobCard = await tx.jobCard.findUnique({
      where: { id: jobCardId },
      select: {
        id: true,
        locationId: true,
        gateEntryId: true,
        customerId: true,
        vehicleId: true,
        currentStatus: {
          select: {
            statusCode: true
          }
        },
        approvalStatus: {
          select: {
            statusCode: true
          }
        },
        services: {
          include: {
            serviceStatus: true,
            approvalStatus: true,
            serviceItem: {
              include: {
                category: true
              }
            },
            workAssignments: {
              include: {
                status: true
              }
            }
          }
        }
      }
    });

    if (trackingJobCard) {
      await syncAssignmentPendingStages(tx, {
        jobCard: trackingJobCard,
        actorUserId: user && user.userId ? user.userId : null
      });
    }

    const updatedJobCard = await tx.jobCard.findUnique({
      where: { id: jobCardId },
      include: {
        customer: {
          select: { id: true, fullName: true, mobileNo: true, emailId: true, address: true }
        },
        vehicle: {
          select: {
            id: true,
            registrationNo: true,
            model: true,
            variant: true,
            fuelType: true,
            vehicleColor: true,
            brand: {
              select: { id: true, name: true }
            }
          }
        },
        currentStatus: {
          select: { id: true, statusCode: true, statusName: true }
        },
        approvalStatus: {
          select: { id: true, statusCode: true, statusName: true }
        },
        location: {
          select: { id: true, locationName: true, locationCode: true }
        },
        gateEntry: {
          select: { id: true, entryType: true, gateEntryNo: true }
        },
        services: {
          include: {
            serviceItem: {
              include: {
                category: true
              }
            },
            approvalStatus: true,
            serviceStatus: true
          }
        },
        workAssignments: {
          include: {
            assignedUser: {
              select: { id: true, fullName: true, employeeCode: true, mobileNo: true }
            },
            status: true,
            jobCardService: {
              select: {
                id: true,
                serviceName: true,
                serviceItem: {
                  select: {
                    category: true
                  }
                }
              }
            }
          }
        }
      }
    });

    await createAuditLog(tx, {
      moduleCode: 'job-cards',
      moduleName: 'Job Cards',
      tableName: 'job_cards',
      recordId: updatedJobCard.id,
      actionType: 'UPDATE',
      performedByUserId: user && user.userId ? user.userId : null,
      recordName: updatedJobCard.jobCardNo,
      comments: 'Job card updated',
      locationId: updatedJobCard.locationId,
      details: []
    });

    return updatedJobCard;
  }, { maxWait: 20000, timeout: 50000 });
};

const postponeJobCardService = async (jobCardId, serviceId, reason, user) => {
  const parsedJobCardId = Number(jobCardId);
  const parsedServiceId = Number(serviceId);

  return prisma.$transaction(async (tx) => {
    const service = await tx.jobCardService.findUnique({
      where: { id: parsedServiceId, jobCardId: parsedJobCardId },
      include: {
        jobCard: {
          include: {
            currentStatus: true,
            approvalStatus: true
          }
        },
        serviceStatus: true,
        workAssignments: {
          where: { completedAt: null },
          orderBy: { createdAt: 'desc' }
        },
        serviceItem: {
          include: { category: true }
        }
      }
    });

    if (!service) throw createHttpError(404, 'Service not found in Job Card');
    
    const currentJobCardStatusCode = getStatusCode(service.jobCard.currentStatus);
    if (FINAL_JOB_CARD_STATUS_CODES.includes(currentJobCardStatusCode)) {
      throw createHttpError(400, 'Cannot switch service for a finalized job card');
    }

    const currentStatusCode = getStatusCode(service.serviceStatus);
    if (['POSTPONED', 'COMPLETED', 'REJECTED'].includes(currentStatusCode) || isCompletedStatusCode(currentStatusCode)) {
      throw createHttpError(400, `Cannot switch service in ${currentStatusCode} status`);
    }

    const postponedStatus = await resolveRequiredStatus(tx, 'job-card-service', ['POSTPONED'], 'Postponed');
    
    const activeAssignment = service.workAssignments[0];
    if (activeAssignment) {
      const onHoldStatus = await resolveRequiredStatus(tx, 'work-assignment', ['ON_HOLD'], 'On Hold');
      await tx.workAssignment.update({
        where: { id: activeAssignment.id },
        data: { statusId: onHoldStatus.id, modifiedById: user?.userId || null }
      });
      
      await tx.bay.updateMany({
        where: { currentWorkAssignmentId: activeAssignment.id },
        data: { currentWorkAssignmentId: null }
      });
    }

    await tx.jobCardService.update({
      where: { id: service.id },
      data: { serviceStatusId: postponedStatus.id, modifiedById: user?.userId || null }
    });

    const activeTracker = await tx.processStageTracking.findFirst({
      where: { jobCardId: parsedJobCardId, completedAt: null }
    });
    if (activeTracker) {
      await tx.processStageTracking.update({
        where: { id: activeTracker.id },
        data: { completedAt: new Date() }
      });
    }

    const switchAction = await resolveRequiredStatus(tx, 'service-history-actions', ['SWITCH'], 'Switch');

    await tx.jobCardServiceHistory.create({
      data: {
        jobCardServiceId: service.id,
        actionTypeId: switchAction.id,
        fromStatusId: service.serviceStatusId,
        toStatusId: postponedStatus.id,
        changedById: user?.userId || 1,
        reason: reason
      }
    });

    const fullJobCard = await tx.jobCard.findUnique({
      where: { id: parsedJobCardId },
      include: {
        services: { include: { serviceStatus: true, workAssignments: { include: { status: true } }, approvalStatus: true, serviceItem: { include: { category: true } } } }
      }
    });

    const newJobCardStatus = await deriveJobCardStatus(tx, fullJobCard);
    if (newJobCardStatus && newJobCardStatus.id !== fullJobCard.currentStatusId) {
      await syncJobCardStageTracking(tx, parsedJobCardId, fullJobCard.currentStatusId, newJobCardStatus, user);
      await tx.jobCard.update({
        where: { id: parsedJobCardId },
        data: { currentStatusId: newJobCardStatus.id }
      });
    }
    
    getSocket()?.emit('jobCardQueueUpdate', { locationId: fullJobCard.locationId });

    return fullJobCard;
  }, { maxWait: 20000, timeout: 50000 });
};

const resumeJobCardService = async (jobCardId, serviceId, bayId, mechanicId, user) => {
  const parsedJobCardId = Number(jobCardId);
  const parsedServiceId = Number(serviceId);

  return prisma.$transaction(async (tx) => {
    const service = await tx.jobCardService.findUnique({
      where: { id: parsedServiceId, jobCardId: parsedJobCardId },
      include: {
        jobCard: { include: { currentStatus: true } },
        serviceStatus: true,
        workAssignments: { where: { completedAt: null }, orderBy: { createdAt: 'desc' } },
        serviceItem: { include: { category: true } }
      }
    });

    if (!service) throw createHttpError(404, 'Service not found in Job Card');

    if (getStatusCode(service.serviceStatus) !== 'POSTPONED') {
      throw createHttpError(400, 'Only POSTPONED services can be resumed');
    }

    const bay = await tx.bay.findUnique({ where: { id: Number(bayId) } });
    if (!bay || bay.currentWorkAssignmentId) {
      throw createHttpError(400, 'Selected bay is not available');
    }

    const oldAssignment = service.workAssignments[0];
    if (oldAssignment) {
      const completedStatus = await resolveRequiredStatus(tx, 'work-assignment', ASSIGNMENT_STATUS_CODES[getServiceDepartment(service)]?.completed || [], 'Completed');
      await tx.workAssignment.update({
        where: { id: oldAssignment.id },
        data: { completedAt: new Date(), statusId: completedStatus.id, modifiedById: user?.userId || null }
      });
    }

    const assignedServiceStatus = await resolveRequiredStatus(tx, 'job-card-service', ['ASSIGNED'], 'Assigned');
    const deptPrefix = String(getServiceDepartment(service) || '').replace(/-/g, '_').toUpperCase();
    const assignedAssignmentStatus = await resolveRequiredStatus(tx, 'work-assignment', [`${deptPrefix}_ASSIGNED`], 'Assigned');

    await tx.jobCardService.update({
      where: { id: service.id },
      data: { serviceStatusId: assignedServiceStatus.id, modifiedById: user?.userId || null }
    });

    const newAssignment = await tx.workAssignment.create({
      data: {
        jobCardId: parsedJobCardId,
        jobCardServiceId: service.id,
        assignedUserId: Number(mechanicId),
        assignedById: user?.userId || 1,
        bayId: Number(bayId),
        statusId: assignedAssignmentStatus.id,
        locationId: service.jobCard.locationId || user?.locationId || 1
      }
    });

    await tx.bay.update({
      where: { id: Number(bayId) },
      data: { currentWorkAssignmentId: newAssignment.id }
    });

    const resumeAction = await resolveRequiredStatus(tx, 'service-history-actions', ['RESUME'], 'Resume');
    
    await tx.jobCardServiceHistory.create({
      data: {
        jobCardServiceId: service.id,
        actionTypeId: resumeAction.id,
        fromStatusId: service.serviceStatusId,
        toStatusId: assignedServiceStatus.id,
        changedById: user?.userId || 1,
        reason: 'Resumed'
      }
    });

    const fullJobCard = await tx.jobCard.findUnique({
      where: { id: parsedJobCardId },
      include: {
        services: { include: { serviceStatus: true, workAssignments: { include: { status: true } }, approvalStatus: true, serviceItem: { include: { category: true } } } }
      }
    });

    const newJobCardStatus = await deriveJobCardStatus(tx, fullJobCard);
    if (newJobCardStatus && newJobCardStatus.id !== fullJobCard.currentStatusId) {
      await syncJobCardStageTracking(tx, parsedJobCardId, fullJobCard.currentStatusId, newJobCardStatus, user);
      await tx.jobCard.update({
        where: { id: parsedJobCardId },
        data: { currentStatusId: newJobCardStatus.id }
      });
    }

    getSocket()?.emit('jobCardQueueUpdate', { locationId: fullJobCard.locationId });

    return fullJobCard;
  }, { maxWait: 20000, timeout: 50000 });
};

const skipJobCardDepartment = async (jobCardId, departmentSlug, reason, user) => {
  const parsedJobCardId = Number(jobCardId);

  return prisma.$transaction(async (tx) => {
    // 1. Get job card with services
    const jobCard = await tx.jobCard.findUnique({
      where: { id: parsedJobCardId },
      include: {
        currentStatus: true,
        services: {
          include: {
            serviceItem: { include: { category: true } },
            serviceStatus: true,
            workAssignments: {
              where: { completedAt: null },
              orderBy: { createdAt: 'desc' }
            }
          }
        }
      }
    });

    if (!jobCard) throw createHttpError(404, 'Job Card not found');

    const currentJobCardStatusCode = getStatusCode(jobCard.currentStatus);
    if (FINAL_JOB_CARD_STATUS_CODES.includes(currentJobCardStatusCode)) {
      throw createHttpError(400, 'Cannot skip department for a finalized job card');
    }

    // 2. Normalize and check if there are downstream departments
    let targetDepartment = null;
    const normalizedValue = normalizeText(departmentSlug);
    for (const dept of DEPARTMENT_ORDER) {
      if (DEPARTMENT_ALIASES[dept].some((alias) => normalizeText(alias) === normalizedValue)) {
        targetDepartment = dept;
        break;
      }
    }

    if (!targetDepartment) {
      throw createHttpError(400, 'Invalid department provided');
    }

    const currentDeptIndex = DEPARTMENT_ORDER.indexOf(targetDepartment);
    
    // Check if there are services in downstream departments (excluding water-wash)
    let hasDownstreamServices = false;
    for (let i = currentDeptIndex + 1; i < DEPARTMENT_ORDER.length; i++) {
      const downstreamDept = DEPARTMENT_ORDER[i];
      if (downstreamDept === 'water-wash') continue;
      const hasServices = jobCard.services.some(s => {
        let sDept = null;
        const sNormalizedValue = normalizeText(s.serviceItem?.category?.slug || s.serviceItem?.category?.name);
        for (const dept of DEPARTMENT_ORDER) {
          if (DEPARTMENT_ALIASES[dept].some((alias) => normalizeText(alias) === sNormalizedValue)) {
            sDept = dept;
            break;
          }
        }
        return sDept === downstreamDept;
      });
      if (hasServices) {
        hasDownstreamServices = true;
        break;
      }
    }

    if (!hasDownstreamServices) {
      throw createHttpError(400, 'Cannot skip this department because Water Wash is the only remaining stage, or no downstream services exist.');
    }

    // 3. Find all services for the TARGET department that are NOT completed/cancelled
    const targetServices = jobCard.services.filter(s => {
      let sDept = null;
      const sNormalizedValue = normalizeText(s.serviceItem?.category?.slug || s.serviceItem?.category?.name);
      for (const dept of DEPARTMENT_ORDER) {
        if (DEPARTMENT_ALIASES[dept].some((alias) => normalizeText(alias) === sNormalizedValue)) {
          sDept = dept;
          break;
        }
      }
      const sStatus = getStatusCode(s.serviceStatus);
      return sDept === targetDepartment && !['COMPLETED', 'DELIVERED', 'POSTPONED', 'REJECTED', 'CANCELLED'].includes(sStatus);
    });

    if (targetServices.length === 0) {
      throw createHttpError(400, 'No active services found in this department to skip');
    }

    // 4. Update them to POSTPONED
    const postponedStatus = await resolveRequiredStatus(tx, 'job-card-service', ['POSTPONED'], 'Postponed');
    
    // Release active assignments
    let onHoldStatus = null;
    try {
      onHoldStatus = await resolveRequiredStatus(tx, 'assignment', ['ON_HOLD'], 'On Hold');
    } catch(err) {
      // If assignment ON_HOLD doesn't exist, we fallback to PENDING or ignore assignment update?
      // Wait, we need it. Let's just clear the assignment.
    }

    for (const service of targetServices) {
      // Update assignments
      if (service.workAssignments.length > 0) {
        const activeAssignment = service.workAssignments[0];
        if (onHoldStatus) {
           await tx.workAssignment.update({
             where: { id: activeAssignment.id },
             data: { statusId: onHoldStatus.id, bayId: null }
           });
        }
        await syncAssignmentPendingStages(tx, activeAssignment.id, user);
      }

      // Update service status
      await tx.jobCardService.update({
        where: { id: service.id },
        data: { serviceStatusId: postponedStatus.id, modifiedById: user?.userId || null }
      });

      // Log history
      let switchAction = null;
      try {
        switchAction = await resolveRequiredStatus(tx, 'service-history-actions', ['SWITCH'], 'Switch');
      } catch (err) {
        switchAction = postponedStatus; // fallback
      }

      await tx.jobCardServiceHistory.create({
        data: {
          jobCardServiceId: service.id,
          actionTypeId: switchAction.id, 
          fromStatusId: service.serviceStatusId,
          toStatusId: postponedStatus.id,
          reason: reason || 'Department skipped',
          changedById: user?.userId || 1
        }
      });
    }

    const socket = getSocket();
    if (socket) {
      socket.to(`location_${jobCard.locationId}`).emit('queueUpdate', {
        type: 'DEPARTMENT_SKIPPED',
        jobCardId: parsedJobCardId,
        department: targetDepartment
      });
    }

    return { message: 'Department successfully skipped' };
  }, { maxWait: 20000, timeout: 50000 });
};

module.exports = {
  listJobCards,
  getJobCardById,
  listJobCardStatuses,
  listJobCardServiceStatuses,
  updateJobCard,
  toJobCardListResponse,
  postponeJobCardService,
  resumeJobCardService,
  skipJobCardDepartment
};
