const { apiResponse } = require('../../common/utils/apiResponse');

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const validateIdParam = (req, res, next) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'Valid service category id is required',
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
      message: 'Valid service category id or slug is required',
      data: {},
      meta: {}
    });
  }

  return next();
};

const validateCategoryPayload = (req, res, next) => {
  const { name } = req.body || {};

  if (!isNonEmptyString(name)) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'category name is required',
      data: {},
      meta: {}
    });
  }

  if (name.length > 50) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'category name cannot exceed 50 characters',
      data: {},
      meta: {}
    });
  }

  if (name.length < 3) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'category name must be at least 3 characters',
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
  validateCategoryPayload,
  validateStatusPayload
};
