const queueService = require('../queues/queue.service');
const jobCardService = require('../jobCards/jobCard.service');

const getMobileList = async (query, user) => {
  let department = 'mechanical';
  if (query.department === 'body-shop') {
    department = 'body-shop';
  } else if (query.department === 'water-wash') {
    department = 'water-wash';
  }

  // Fetch data for the active tab
  const data = await queueService.listQueue(department, query, user);

  // Fetch counts for all tabs using lightweight limit
  const [mechanicalData, bodyShopData, waterWashData] = await Promise.all([
    queueService.listQueue('mechanical', { ...query, page: 1, limit: 1 }, user),
    queueService.listQueue('body-shop', { ...query, page: 1, limit: 1 }, user),
    queueService.listQueue('water-wash', { ...query, page: 1, limit: 1 }, user)
  ]);

  const counts = {
    mechanical: mechanicalData.meta.total,
    bodyShop: bodyShopData.meta.total,
    waterWash: waterWashData.meta.total
  };

  // Format exactly for mobile UI card
  const formattedRequests = data.queue.map(req => {
    const custName = req.customerName || 'Unknown';
    let deptTag = 'Mechanical';
    if (department === 'body-shop') deptTag = 'Body Shop';
    if (department === 'water-wash') deptTag = 'Water Wash';

    return {
      id: req.jobCardId,
      canSkip: Boolean(req.canSkip),
      isWaterWashInProgress: Boolean(req.isWaterWashInProgress),
      jobCardNo: req.jobCardNo || '',
      vehicleNo: req.vehicleNo || '',
      customerName: custName,
      customerInitial: custName.charAt(0).toUpperCase(),
      departmentTag: deptTag,
      waitTime: `${req.waitMinutes || 0} mins`,
      deliveryDate: req.expectedDeliveryAt ? new Date(req.expectedDeliveryAt).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
      }) : '',
      servicesRequired: (req.serviceNames || []).join(', ')
    };
  });

  return {
    success: true,
    message: 'Assign mechanic list fetched successfully',
    data: {
      requests: formattedRequests,
      counts,
      meta: data.meta
    }
  };
};

const assignWork = async (jobCardId, payload, user) => {
  const data = await queueService.assignWork(jobCardId, payload, user);
  return {
    success: true,
    message: 'Work assigned successfully',
    data
  };
};

const skipDepartment = async (jobCardId, department, reason, user) => {
  const data = await jobCardService.skipJobCardDepartment(jobCardId, department, reason, user);
  return {
    success: true,
    message: data.message || 'Department skipped successfully',
    data
  };
};

const startWaterWash = async (jobCardId, user) => {
  const data = await queueService.startWaterWashWork(jobCardId, user);
  return {
    success: true,
    message: data?.message || 'Water wash started successfully',
    data
  };
};

const completeWaterWash = async (jobCardId, user) => {
  const data = await queueService.completeWaterWashWork(jobCardId, user);
  return {
    success: true,
    message: data?.message || 'Water wash completed successfully',
    data
  };
};

module.exports = {
  getMobileList,
  assignWork,
  skipDepartment,
  startWaterWash,
  completeWaterWash
};
