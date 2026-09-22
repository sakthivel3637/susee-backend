const jobCardService = require('./jobCard.service');
const { apiResponse } = require('../../common/utils/apiResponse');
const { exportToExcel } = require('../../common/utils/excel.util');

const getJobCards = async (req, res, next) => {
  try {
    const result = await jobCardService.listJobCards(req.query, req.user);

    if (req.query.export === 'true') {
      const columns = [
        { header: 'Job Card Number', key: 'jobCardNo', width: 22 },
        { header: 'Vehicle Number', key: 'vehicleNumber', width: 20 },
        { header: 'Owner Name', key: 'ownerName', width: 25 },
        { header: 'Owner Mobile', key: 'ownerMobile', width: 18 },
        { header: 'Technician', key: 'technician', width: 25 },
        { header: 'Bay', key: 'bayName', width: 18 },
        { header: 'Estimate Cost', key: 'totalEstimate', width: 18 },
        { header: 'Status', key: 'status', width: 18 },
        { header: 'Created At', key: 'createdAt', width: 25 }
      ];

      // Format response data matching UI rendering
      const formattedData = result.jobCards.map(item => {
        return {
          jobCardNo: item.jobCardNo,
          vehicleNumber: item.vehicle?.registrationNo || '',
          ownerName: item.customer?.fullName || '',
          ownerMobile: item.customer?.mobileNo || '',
          technician: item.technician || (item.assignedMechanics?.length > 0 ? item.assignedMechanics.map(m => m.fullName).join(', ') : 'Unassigned'),
          bayName: item.bay?.bayName || item.bay?.bayCode || item.assignedBay?.bayName || item.assignedBay?.bayCode || 'Unassigned',
          totalEstimate: item.totalEstimate || 0,
          status: item.currentStatus?.statusCode || 'PENDING',
          createdAt: item.createdAt ? new Date(item.createdAt).toLocaleString() : ''
        };
      });

      return await exportToExcel(res, 'Job_Cards', 'Job Cards', columns, formattedData);
    }

    return apiResponse(res, {
      statusCode: 200,
      success: true,
      message: 'Job cards retrieved successfully',
      data: result.jobCards,
      meta: result.meta
    });
  } catch (error) {
    return next(error);
  }
};

const getJobCard = async (req, res, next) => {
  try {
    const jobCard = await jobCardService.getJobCardById(req.params.id, req.user);

    return apiResponse(res, {
      statusCode: 200,
      success: true,
      message: 'Job card retrieved successfully',
      data: jobCard
    });
  } catch (error) {
    if (error.message === 'Job Card not found' || error.message === 'Unauthorized to view this Job Card') {
      return apiResponse(res, {
        statusCode: 404,
        success: false,
        message: error.message
      });
    }
    return next(error);
  }
};

const getJobCardStatuses = async (req, res, next) => {
  try {
    const statuses = await jobCardService.listJobCardStatuses();

    return apiResponse(res, {
      statusCode: 200,
      success: true,
      message: 'Job card statuses retrieved successfully',
      data: statuses
    });
  } catch (error) {
    return next(error);
  }
};

const getJobCardServiceStatuses = async (req, res, next) => {
  try {
    const statuses = await jobCardService.listJobCardServiceStatuses();

    return apiResponse(res, {
      statusCode: 200,
      success: true,
      message: 'Job card service statuses retrieved successfully',
      data: statuses
    });
  } catch (error) {
    return next(error);
  }
};

const updateJobCard = async (req, res, next) => {
  try {
    const jobCard = await jobCardService.updateJobCard(req.params.id, req.body, req.user);

    return apiResponse(res, {
      statusCode: 200,
      success: true,
      message: 'Job card updated successfully',
      data: jobCard
    });
  } catch (error) {
    if (error.message === 'Job Card not found') {
      return apiResponse(res, {
        statusCode: 404,
        success: false,
        message: error.message,
        data: {},
        meta: {}
      });
    }
    return next(error);
  }
};

const postponeService = async (req, res, next) => {
  try {
    const { id, serviceId } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return apiResponse(res, { statusCode: 400, success: false, message: 'Reason is required for postponing' });
    }

    const jobCard = await jobCardService.postponeJobCardService(id, serviceId, reason, req.user);

    return apiResponse(res, {
      statusCode: 200,
      success: true,
      message: 'Service postponed successfully',
      data: jobCard
    });
  } catch (error) {
    if (error.message.includes('not found') || error.message.includes('Invalid')) {
      return apiResponse(res, { statusCode: 400, success: false, message: error.message });
    }
    return next(error);
  }
};

const resumeService = async (req, res, next) => {
  try {
    const { id, serviceId } = req.params;
    const { bayId, mechanicId } = req.body;

    if (!bayId || !mechanicId) {
      return apiResponse(res, { statusCode: 400, success: false, message: 'bayId and mechanicId are required to resume a service' });
    }

    const jobCard = await jobCardService.resumeJobCardService(id, serviceId, bayId, mechanicId, req.user);

    return apiResponse(res, {
      statusCode: 200,
      success: true,
      message: 'Service resumed and reassigned successfully',
      data: jobCard
    });
  } catch (error) {
    if (error.message.includes('not found') || error.message.includes('Invalid')) {
      return apiResponse(res, { statusCode: 400, success: false, message: error.message });
    }
    return next(error);
  }
};

const skipDepartment = async (req, res, next) => {
  try {
    const { id, department } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ success: false, message: 'Reason is required to skip a department' });
    }

    const result = await jobCardService.skipJobCardDepartment(id, department, reason, req.user);

    return res.status(200).json({
      success: true,
      message: result.message
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getJobCards,
  getJobCard,
  getJobCardStatuses,
  getJobCardServiceStatuses,
  updateJobCard,
  postponeService,
  resumeService,
  skipDepartment
};
