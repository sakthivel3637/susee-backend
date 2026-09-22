const { apiResponse } = require('../../common/utils/apiResponse');
const queueService = require('./queue.service');

const listMechanicalQueue = async (req, res, next) => {
  try {
    const result = await queueService.listQueue('mechanical', req.query, req.user);

    return apiResponse(res, {
      message: 'Mechanical queue fetched successfully',
      data: result.queue,
      meta: result.meta
    });
  } catch (error) {
    return next(error);
  }
};

const listBodyShopQueue = async (req, res, next) => {
  try {
    const result = await queueService.listQueue('body-shop', req.query, req.user);

    return apiResponse(res, {
      message: 'Body shop queue fetched successfully',
      data: result.queue,
      meta: result.meta
    });
  } catch (error) {
    return next(error);
  }
};

const listWaterWashQueue = async (req, res, next) => {
  try {
    const result = await queueService.listQueue('water-wash', req.query, req.user);

    return apiResponse(res, {
      message: 'Water wash queue fetched successfully',
      data: result.queue,
      meta: result.meta
    });
  } catch (error) {
    return next(error);
  }
};

const assignWork = async (req, res, next) => {
  try {
    const data = await queueService.assignWork(req.params.jobCardId, req.body, req.user);

    return apiResponse(res, {
      statusCode: 201,
      message: 'Work assigned successfully',
      data
    });
  } catch (error) {
    return next(error);
  }
};

const reassignWork = async (req, res, next) => {
  try {
    const data = await queueService.reassignWork(req.params.jobCardId, req.body, req.user);

    return apiResponse(res, {
      message: 'Work reassigned successfully',
      data
    });
  } catch (error) {
    return next(error);
  }
};

const updateAssignmentStatus = async (req, res, next) => {
  try {
    const data = await queueService.updateAssignmentStatus(req.params.assignmentId, req.body, req.user);

    return apiResponse(res, {
      message: 'Work assignment status updated successfully',
      data
    });
  } catch (error) {
    return next(error);
  }
};



module.exports = {
  listMechanicalQueue,
  listBodyShopQueue,
  listWaterWashQueue,
  assignWork,
  reassignWork,
  updateAssignmentStatus
};
