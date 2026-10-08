const queueService = require('../queues/queue.service');
const jobCardService = require('../jobCards/jobCard.service');

const getMobileList = async (query, user) => {
  const department = query.department === 'body-shop' ? 'body-shop' : 'mechanical';

  // Fetch data for the active tab
  const data = await queueService.listQueue(department, query, user);

  // Fetch counts for both tabs using lightweight limit
  const [mechanicalData, bodyShopData] = await Promise.all([
    queueService.listQueue('mechanical', { ...query, page: 1, limit: 1 }, user),
    queueService.listQueue('body-shop', { ...query, page: 1, limit: 1 }, user)
  ]);

  const counts = {
    mechanical: mechanicalData.meta.total,
    bodyShop: bodyShopData.meta.total
  };

  // Format exactly for mobile UI card
  const formattedRequests = data.queue.map(req => {
    const custName = req.customerName || 'Unknown';
    return {
      id: req.jobCardId,
      canSkip: Boolean(req.canSkip),
      jobCardNo: req.jobCardNo || '',
      vehicleNo: req.vehicleNo || '',
      customerName: custName,
      customerInitial: custName.charAt(0).toUpperCase(),
      departmentTag: department === 'body-shop' ? 'Body Shop' : 'Mechanical',
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

module.exports = {
  getMobileList,
  assignWork,
  skipDepartment
};
