const { apiResponse } = require('../../common/utils/apiResponse');

const isPositiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 2147483647;
};

const isOptionalPositiveInt = (value) => {
  return value === undefined || value === null || value === '' || isPositiveInt(value);
};

const sendValidationError = (res, message) => {
  return apiResponse(res, {
    statusCode: 400,
    success: false,
    message,
    data: {},
    meta: {}
  });
};

const isValidIdArray = (arr) => {
  if (!Array.isArray(arr)) return false;
  return arr.every(val => isPositiveInt(val));
};

const validateIdParam = (req, res, next) => {
  if (!isPositiveInt(req.params.id)) {
    return sendValidationError(res, 'Valid stage time limit id is required');
  }

  return next();
};

const validatePayload = (req, res, next) => {
  const {
    locationId,
    moduleId,
    statusId,
    stageCode,
    allowedMinutes,
    notifyRoleIds,
    notifyUserIds
  } = req.body || {};

  if (!isPositiveInt(moduleId)) {
    return sendValidationError(res, 'moduleId is required');
  }

  if (!isPositiveInt(statusId)) {
    return sendValidationError(res, 'statusId is required');
  }

  if (!String(stageCode || '').trim()) {
    return sendValidationError(res, 'stageCode is required');
  }

  if (!isPositiveInt(allowedMinutes)) {
    return sendValidationError(res, 'allowedMinutes must be a positive integer');
  }

  if (!isOptionalPositiveInt(locationId)) {
    return sendValidationError(res, 'locationId must be a positive integer');
  }

  const hasRoles = Array.isArray(notifyRoleIds) && notifyRoleIds.length > 0;
  const hasUsers = Array.isArray(notifyUserIds) && notifyUserIds.length > 0;

  if (hasRoles && !isValidIdArray(notifyRoleIds)) {
    return sendValidationError(res, 'notifyRoleIds must be an array of positive integers');
  }

  if (hasUsers && !isValidIdArray(notifyUserIds)) {
    return sendValidationError(res, 'notifyUserIds must be an array of positive integers');
  }

  if (!hasRoles && !hasUsers) {
    return sendValidationError(res, 'At least one notify role or notify user is required.');
  }

  return next();
};

const validateStatusPayload = (req, res, next) => {
  if (typeof (req.body || {}).isActive !== 'boolean') {
    return sendValidationError(res, 'isActive boolean is required');
  }

  return next();
};

module.exports = {
  validateIdParam,
  validatePayload,
  validateStatusPayload
};
