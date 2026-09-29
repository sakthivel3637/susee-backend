const { listRequests } = require('../additionalWork/additionalWork.service');

const getMobileList = async (query, user) => {
  // Pass query to existing web service, filtering 'all' status
  const backendQuery = {
    ...query,
    status: query.status && query.status.toLowerCase() !== 'all' ? query.status : undefined
  };

  const [data, allData, pendingData, approvedData, rejectedData] = await Promise.all([
    listRequests(backendQuery, user),
    listRequests({ ...query, status: 'all', page: 1, limit: 1 }, user),
    listRequests({ ...query, status: 'PENDING', page: 1, limit: 1 }, user),
    listRequests({ ...query, status: 'APPROVED', page: 1, limit: 1 }, user),
    listRequests({ ...query, status: 'REJECTED', page: 1, limit: 1 }, user)
  ]);

  const counts = {
    ALL: allData.meta.total,
    PENDING: pendingData.meta.total,
    APPROVED: approvedData.meta.total,
    REJECTED: rejectedData.meta.total
  };
  
  // Format the output exactly as required by the mobile UI card
  const formattedRequests = data.requests.map(req => {
    // Determine the status from statusCode
    let statusFormatted = 'Pending';
    if (req.statusCode) {
       // Convert 'PENDING_APPROVAL' to 'Pending', etc.
       const code = req.statusCode.split('_')[0]; 
       statusFormatted = code.charAt(0).toUpperCase() + code.slice(1).toLowerCase();
    }

    return {
      id: req.id,
      awId: req.approvalCode || `AW${req.id}`,
      jobCardId: req.jobCardNo || '',
      status: statusFormatted,
      vehicleReg: req.vehicleNumber || '',
      customerName: req.customerName || 'Unknown',
      customerInitials: req.customerName ? req.customerName.charAt(0).toUpperCase() : 'U',
      requestedServices: (req.services || []).map(s => s.serviceName),
      estimatedCost: req.totalAmount || 0,
      date: req.requestedAt 
        ? new Date(req.requestedAt).toLocaleDateString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: true
          }) 
        : ''
    };
  });

  return {
    ...data,
    requests: formattedRequests,
    counts
  };
};

module.exports = { getMobileList };
