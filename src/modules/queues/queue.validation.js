const { apiResponse } = require('../../common/utils/apiResponse');

const sendValidationError = (res, message) => {
  return apiResponse(res, {
    statusCode: 400,
    success: false,
    message,
    data: {},
    meta: {}
  });
};

const validateJobCardIdParam = (req, res, next) => {
  const id = Number(req.params.jobCardId);

  if (!Number.isInteger(id) || id <= 0) {
    return sendValidationError(res, 'Valid jobCardId is required');
  }

  return next();
};

const validateAssignmentIdParam = (req, res, next) => {
  const id = Number(req.params.assignmentId);

  if (!Number.isInteger(id) || id <= 0) {
    return sendValidationError(res, 'Valid assignmentId is required');
  }

  return next();
};

const validateAssignPayload = (req, res, next) => {
  const assignedUserId = Number(req.body && req.body.assignedUserId);
  const bayId = Number(req.body && req.body.bayId);

  if (!Number.isInteger(assignedUserId) || assignedUserId <= 0) {
    return sendValidationError(res, 'Valid assignedUserId is required');
  }

  if (!Number.isInteger(bayId) || bayId <= 0) {
    return sendValidationError(res, 'Valid bayId is required');
  }

  if (req.body.jobCardServiceIds !== undefined) {
    if (!Array.isArray(req.body.jobCardServiceIds) || req.body.jobCardServiceIds.length === 0) {
      return sendValidationError(res, 'jobCardServiceIds must be a non-empty array');
    }

    for (const serviceId of req.body.jobCardServiceIds) {
      const parsedServiceId = Number(serviceId);

      if (!Number.isInteger(parsedServiceId) || parsedServiceId <= 0) {
        return sendValidationError(res, 'Each jobCardServiceId must be a positive integer');
      }
    }
  }

  return next();
};

const validateStatusPayload = (req, res, next) => {
  const status = String((req.body && req.body.status) || '').trim().toUpperCase();

  if (!['IN_PROGRESS', 'COMPLETED'].includes(status)) {
    return sendValidationError(res, 'status must be IN_PROGRESS or COMPLETED');
  }

  return next();
};


module.exports = {
  validateJobCardIdParam,
  validateAssignmentIdParam,
  validateAssignPayload,
  validateStatusPayload
};
