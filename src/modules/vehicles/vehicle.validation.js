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
    return sendValidationError(res, 'Valid vehicle identifier is required');
  }

  // It could be a slug or id, so we just check if it's not empty
  return next();
};

const validateVehiclePayload = (req, res, next) => {
  const { vehicleNumber, ownerName, mobile, brand, makeModel, status, fuelType } = req.body || {};

  if (!isNonEmptyString(vehicleNumber)) {
    return sendValidationError(res, 'Registration Number is required');
  }

  const vehicleRegex = /^[A-Z]{2}[-\s]?[0-9]{1,2}[-\s]?[A-Z]{1,3}[-\s]?[0-9]{4}$/i;
  if (!vehicleRegex.test(vehicleNumber.trim())) {
    return sendValidationError(res, 'Invalid Vehicle Number format (e.g., TN12AK8776 or MH 12 AB 1234)');
  }

  if (!brand) {
    return sendValidationError(res, 'Brand is required');
  }

  if (!isNonEmptyString(makeModel)) {
    return sendValidationError(res, 'Model is required');
  }

  if (!isNonEmptyString(fuelType)) {
    return sendValidationError(res, 'Fuel Type is required');
  }
  
  if (/^\d+$/.test(fuelType.trim()) || !/[a-zA-Z]/.test(fuelType.trim())) {
    return sendValidationError(res, 'Fuel Type must contain at least one letter and cannot be fully numeric');
  }

  if (!isNonEmptyString(status)) {
    return sendValidationError(res, 'Status is required');
  }
  
  if (status !== 'ACTIVE' && status !== 'INACTIVE') {
    return sendValidationError(res, 'Status must be ACTIVE or INACTIVE');
  }

  if (!isNonEmptyString(ownerName)) {
    return sendValidationError(res, 'Owner Name is required');
  }

  if (!isNonEmptyString(mobile)) {
    return sendValidationError(res, 'Mobile Number is required');
  }

  if (mobile.length !== 10 || !/^\d+$/.test(mobile)) {
    return sendValidationError(res, 'Mobile Number must be exactly 10 digits');
  }

  if (!/^[6-9]/.test(mobile)) {
    return sendValidationError(res, 'Mobile Number must start with 6, 7, 8, or 9');
  }

  return next();
};

module.exports = {
  validateIdParam,
  validateVehiclePayload
};
