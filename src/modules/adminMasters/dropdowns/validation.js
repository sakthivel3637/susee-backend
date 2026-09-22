const { apiResponse } = require('../../../common/utils/apiResponse');

const validateOptionalPositiveInt = (fieldName) => (req, res, next) => {
  const value = req.query[fieldName];

  if (value === undefined || value === '') {
    return next();
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: `${fieldName} must be a valid id`,
      data: {},
      meta: {}
    });
  }

  return next();
};

const validateOptionalModuleCode = (req, res, next) => {
  const value = req.query.moduleCode;

  if (value === undefined || value === '') {
    return next();
  }

  const moduleCode = String(value).trim().toLowerCase();

  if (!/^[a-z0-9-]+$/.test(moduleCode)) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'moduleCode must be a valid module code',
      data: {},
      meta: {}
    });
  }

  req.query.moduleCode = moduleCode;
  return next();
};

module.exports = {
  validateOptionalPositiveInt,
  validateOptionalModuleCode
};
