const { apiResponse } = require('../../common/utils/apiResponse');

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const sendValidationError = (res, message) => {
  return apiResponse(res, {
    statusCode: 400,
    success: false,
    message,
    data: {},
    meta: {}
  });
};

const validateIdParam = (req, res, next) => {
  const identifier = String(req.params.id || '').trim();

  if (!identifier) {
    return sendValidationError(res, 'Valid customer identifier is required');
  }

  const id = Number(identifier);
  if (!Number.isNaN(id)) {
    if (!Number.isInteger(id) || id <= 0) {
      return sendValidationError(res, 'Valid customer identifier is required');
    }
  }

  return next();
};

const validateCustomerPayload = (req, res, next) => {
  const { fullName, mobileNo, emailId } = req.body || {};

  if (!isNonEmptyString(fullName)) {
    return sendValidationError(res, 'fullName is required');
  }

  if (fullName.length > 50) {
    return sendValidationError(res, 'Customer Full Name cannot exceed 50 characters');
  }

  if (fullName.length < 3) {
    return sendValidationError(res, 'Customer Full Name must be at least 3 characters');
  }

  if (emailId) {
    if (emailId.length > 100) {
      return sendValidationError(res, 'emailId cannot exceed 100 characters');
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailId.trim())) {
      return sendValidationError(res, 'emailId must be valid');
    }
  }

  if (!isNonEmptyString(mobileNo)) {
    return sendValidationError(res, 'mobileNo is required');
  }

  if (mobileNo.length !== 10 || !/^\d+$/.test(mobileNo)) {
    return sendValidationError(res, 'Mobile Number must be exactly 10 digits');
  }

  if (!/^[6-9]/.test(mobileNo)) {
    return sendValidationError(res, 'Mobile Number must start with 6, 7, 8, or 9');
  }

  const { address } = req.body || {};
  if (address !== undefined && address !== null) {
    if (String(address).length > 200) {
      return sendValidationError(res, 'Address cannot exceed 200 characters');
    }
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
  validateCustomerPayload,
  validateStatusPayload
};
