const { apiResponse } = require('../../common/utils/apiResponse');
const service = require('./mobileJobCard.service');

const pendingQueue = async (req, res, next) => {
  try {
    const { entries, summary, meta } = await service.pendingQueue(req.query, req.user);
    return apiResponse(res, {
      message: 'Job card queue fetched successfully',
      data: {
        entries,
        summary
      },
      meta
    });
  } catch (error) {
    return next(error);
  }
};

const jobCardList = async (req, res, next) => {
  try {
    const { jobCards, summary, meta } = await service.jobCardList(req.query, req.user);
    return apiResponse(res, {
      message: 'Job card list fetched successfully',
      data: {
        jobCards,
        summary
      },
      meta
    });
  } catch (error) {
    return next(error);
  }
};

const queueDetail = async (req, res, next) => {
  try {
    const data = await service.queueDetail(req.params.id, req.user);
    return apiResponse(res, {
      message: 'Gate entry detail fetched successfully',
      data
    });
  } catch (error) {
    return next(error);
  }
};

const jobCardDetail = async (req, res, next) => {
  try {
    const data = await service.jobCardDetail(req.params.id, req.user);
    return apiResponse(res, {
      message: 'Job card detail fetched successfully',
      data
    });
  } catch (error) {
    return next(error);
  }
};

const createFromGateEntry = async (req, res, next) => {
  try {
    const data = await service.createFromGateEntry(req.body, req.user, req.files || []);
    return apiResponse(res, {
      statusCode: 201,
      message: 'Job card created successfully',
      data
    });
  } catch (error) {
    return next(error);
  }
};

const updateJobCard = async (req, res, next) => {
  try {
    const data = await service.updateFromMobile(req.params.id, req.body, req.user, req.files || []);
    return apiResponse(res, {
      message: 'Job card updated successfully',
      data
    });
  } catch (error) {
    return next(error);
  }
};

const lookupVehicle = async (req, res, next) => {
  try {
    const { vehicleNumber } = req.query;
    if (!vehicleNumber) {
      return apiResponse(res, {
        statusCode: 400,
        success: false,
        message: 'Vehicle number is required'
      });
    }

    const data = await service.lookupVehicleByNumber(vehicleNumber, req.user);
    
    return apiResponse(res, {
      message: data ? 'Vehicle data retrieved successfully' : 'Vehicle not found',
      data
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  pendingQueue,
  jobCardList,
  queueDetail,
  jobCardDetail,
  createFromGateEntry,
  updateJobCard,
  lookupVehicle
};
