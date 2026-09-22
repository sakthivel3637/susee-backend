const { apiResponse } = require('../../common/utils/apiResponse');

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const slugRegex = /^[a-zA-Z0-9-]+$/; // Allow letters, numbers, and dashes for bayCode

const validateIdParam = (req, res, next) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'Valid bay id is required',
      data: {},
      meta: {}
    });
  }

  return next();
};

const validateIdentifierParam = (req, res, next) => {
  const identifier = String(req.params.id || '').trim();
  const numericIdentifier = Number(identifier);
  const isValidId = Number.isInteger(numericIdentifier) && numericIdentifier > 0;
  const isValidSlug = slugRegex.test(identifier);

  if (!isValidId && !isValidSlug) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'Valid bay id or code is required',
      data: {},
      meta: {}
    });
  }

  return next();
};

const validateBayPayload = (req, res, next) => {
  const { bayName, bayType } = req.body || {};

  if (!isNonEmptyString(bayName)) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'Bay name is required',
      data: {},
      meta: {}
    });
  }

  if (bayName.length > 50) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'Bay name cannot exceed 50 characters',
      data: {},
      meta: {}
    });
  }

  if (bayName.length < 3) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'Bay name must be at least 3 characters',
      data: {},
      meta: {}
    });
  }

  const validTypes = ['Mechanical', 'Body Shop', 'Water Wash'];
  if (!isNonEmptyString(bayType) || !validTypes.includes(bayType)) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'Valid bay type is required (Mechanical, Body Shop, Water Wash)',
      data: {},
      meta: {}
    });
  }

  return next();
};

const validateStatusPayload = (req, res, next) => {
  if (typeof (req.body || {}).isActive !== 'boolean') {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'isActive boolean is required',
      data: {},
      meta: {}
    });
  }

  return next();
};

module.exports = {
  validateIdParam,
  validateIdentifierParam,
  validateBayPayload,
  validateStatusPayload
};
