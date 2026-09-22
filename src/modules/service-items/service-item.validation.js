const { apiResponse } = require('../../common/utils/apiResponse');

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const isValidNonNegativeNumber = (value) => {
  if (value === undefined || value === null || value === '') {
    return true;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0;
};

const isValidNonNegativeInteger = (value) => {
  if (value === undefined || value === null || value === '') {
    return true;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0;
};

const validateIdParam = (req, res, next) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'Valid service item id is required',
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
      message: 'Valid service item id or slug is required',
      data: {},
      meta: {}
    });
  }

  return next();
};

const validateServiceItemPayload = (req, res, next) => {
  const { categoryId, name, basePrice, estimatedMinutes } = req.body || {};
  const parsedCategoryId = Number(categoryId);

  if (!Number.isInteger(parsedCategoryId) || parsedCategoryId <= 0) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'valid categoryId is required',
      data: {},
      meta: {}
    });
  }

  if (!isNonEmptyString(name)) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'service item name is required',
      data: {},
      meta: {}
    });
  }

  if (name.length > 50) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'service item name cannot exceed 50 characters',
      data: {},
      meta: {}
    });
  }

  if (name.length < 3) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'service item name must be at least 3 characters',
      data: {},
      meta: {}
    });
  }

  if (!isValidNonNegativeNumber(basePrice)) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'basePrice must be greater than or equal to 0',
      data: {},
      meta: {}
    });
  }

  if (basePrice !== undefined && basePrice !== null && basePrice !== '') {
    if (Number(basePrice) > 99999999.99) {
      return apiResponse(res, {
        statusCode: 400,
        success: false,
        message: 'basePrice cannot exceed 99999999.99',
        data: {},
        meta: {}
      });
    }
  }

  if (!isValidNonNegativeInteger(estimatedMinutes)) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'estimatedMinutes must be greater than or equal to 0',
      data: {},
      meta: {}
    });
  }

  if (estimatedMinutes !== undefined && estimatedMinutes !== null && estimatedMinutes !== '') {
    if (Number(estimatedMinutes) > 2147483647) {
      return apiResponse(res, {
        statusCode: 400,
        success: false,
        message: 'estimatedMinutes cannot exceed 2147483647',
        data: {},
        meta: {}
      });
    }
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
  validateServiceItemPayload,
  validateStatusPayload
};
