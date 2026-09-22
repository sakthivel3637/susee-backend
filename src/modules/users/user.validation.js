const { apiResponse } = require('../../common/utils/apiResponse');

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const mobileRegex = /^[6-9]\d{9}$/;

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const isSlug = (value) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(value || '').trim());

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
  const identifier = req.params.id;
  const id = Number(identifier);

  if ((!Number.isInteger(id) || id <= 0) && !isSlug(identifier)) {
    return sendValidationError(res, 'Valid user identifier is required');
  }

  return next();
};

const validateUserPayload = ({ requirePassword = false } = {}) => {
  return (req, res, next) => {
    const { fullName, email, mobile, roleId, password, locationId, emergencyContact, address, dob } = req.body || {};
    const parsedRoleId = Number(roleId);
    const parsedLocationId = Number(locationId);

    if (!isNonEmptyString(fullName)) {
      return sendValidationError(res, 'fullName is required');
    }

    if (fullName.length > 50) {
      return sendValidationError(res, 'User Full Name cannot exceed 50 characters');
    }

    if (fullName.length < 3) {
      return sendValidationError(res, 'User Full Name must be at least 3 characters');
    }

    if (!isNonEmptyString(email)) {
      return sendValidationError(res, 'email is required');
    }

    if (email.length > 100) {
      return sendValidationError(res, 'email cannot exceed 100 characters');
    }

    if (!emailRegex.test(email.trim())) {
      return sendValidationError(res, 'email must be valid');
    }

    if (mobile) {
      const trimmedMobile = String(mobile).trim();
      if (trimmedMobile.length !== 10 || !/^\d+$/.test(trimmedMobile)) {
        return sendValidationError(res, 'mobile must be exactly 10 digits');
      }
      if (!/^[6-9]/.test(trimmedMobile)) {
        return sendValidationError(res, 'mobile must start with 6, 7, 8, or 9');
      }
    }

    if (emergencyContact) {
      const trimmedContact = String(emergencyContact).trim();
      if (trimmedContact.length !== 10 || !/^\d+$/.test(trimmedContact)) {
        return sendValidationError(res, 'emergencyContact must be exactly 10 digits');
      }
      if (!/^[6-9]/.test(trimmedContact)) {
        return sendValidationError(res, 'emergencyContact must start with 6, 7, 8, or 9');
      }
    }

    if (address !== undefined && address !== null) {
      if (String(address).length > 200) {
        return sendValidationError(res, 'Address cannot exceed 200 characters');
      }
    }

    if (dob) {
      const inputDate = new Date(dob);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (inputDate >= today) {
        return sendValidationError(res, 'Date of Birth must be in the past and cannot be today');
      }
    }

    if (!Number.isInteger(parsedRoleId) || parsedRoleId <= 0) {
      return sendValidationError(res, 'roleId is required');
    }

    if (locationId !== undefined && locationId !== null && locationId !== '' && (!Number.isInteger(parsedLocationId) || parsedLocationId <= 0)) {
      return sendValidationError(res, 'locationId must be valid');
    }

    if (requirePassword && !isNonEmptyString(password)) {
      return sendValidationError(res, 'password is required');
    }

    return next();
  };
};

const validatePasswordPayload = (req, res, next) => {
  const { password } = req.body || {};

  if (!isNonEmptyString(password)) {
    return sendValidationError(res, 'password is required');
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
  validateUserPayload,
  validatePasswordPayload,
  validateStatusPayload
};
