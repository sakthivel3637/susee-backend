const { apiResponse } = require('../../common/utils/apiResponse');
const service = require('./stageTimeLimit.service');

const create = async (req, res, next) => {
  try {
    const schedule = await service.createStageTimeLimit(req.body, req.user);
    return apiResponse(res, {
      statusCode: 201,
      message: 'Stage alert schedule created successfully',
      data: { schedule }
    });
  } catch (error) {
    return next(error);
  }
};

const update = async (req, res, next) => {
  try {
    const schedule = await service.updateStageTimeLimit(req.params.id, req.body, req.user);
    return apiResponse(res, {
      message: 'Stage alert schedule updated successfully',
      data: { schedule }
    });
  } catch (error) {
    return next(error);
  }
};

const list = async (req, res, next) => {
  try {
    const { schedules, meta } = await service.listStageTimeLimits(req.query, req.user);
    return apiResponse(res, {
      message: 'Stage alert schedules fetched successfully',
      data: { schedules },
      meta
    });
  } catch (error) {
    return next(error);
  }
};

const detail = async (req, res, next) => {
  try {
    const schedule = await service.getStageTimeLimit(req.params.id, req.user);
    return apiResponse(res, {
      message: 'Stage alert schedule fetched successfully',
      data: { schedule }
    });
  } catch (error) {
    return next(error);
  }
};

const status = async (req, res, next) => {
  try {
    const schedule = await service.updateStageTimeLimitStatus(req.params.id, req.body, req.user);
    return apiResponse(res, {
      message: 'Stage alert schedule status updated successfully',
      data: { schedule }
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  create,
  update,
  list,
  detail,
  status
};
