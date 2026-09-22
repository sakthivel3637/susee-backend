const { apiResponse } = require('../../common/utils/apiResponse');

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const validateLogin = (req, res, next) => {
  const { emailId, password } = req.body || {};

  if (!isNonEmptyString(emailId)) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'emailId is required',
      data: {},
      meta: {}
    });
  }

  if (emailId.length > 100) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'emailId cannot exceed 100 characters',
      data: {},
      meta: {}
    });
  }

  if (!isNonEmptyString(password)) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'password is required',
      data: {},
      meta: {}
    });
  }

  return next();
};

const validateUpdateProfile = (req, res, next) => {
  const { fullName, emailId, mobileNo } = req.body || {};

  if (!isNonEmptyString(fullName)) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'fullName is required',
      data: {},
      meta: {}
    });
  }

  if (fullName.length > 50) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'Full Name must not exceed 50 characters',
      data: {},
      meta: {}
    });
  }

  if (fullName.length < 3) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'Full Name must be at least 3 characters',
      data: {},
      meta: {}
    });
  }

  if (!/^[a-zA-Z\s]+$/.test(fullName.trim())) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'Full Name must contain only letters and spaces',
      data: {},
      meta: {}
    });
  }


  if (!isNonEmptyString(emailId)) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'emailId is required',
      data: {},
      meta: {}
    });
  }

  if (emailId.length > 100) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'emailId cannot exceed 100 characters',
      data: {},
      meta: {}
    });
  }

  if (!isNonEmptyString(mobileNo)) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'mobileNo is required',
      data: {},
      meta: {}
    });
  }
  
  if (mobileNo.length !== 10 || !/^\d+$/.test(mobileNo)) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'Mobile Number must be exactly 10 digits',
      data: {},
      meta: {}
    });
  }

  if (!/^[6-9]/.test(mobileNo)) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'Mobile Number must start with 6, 7, 8, or 9',
      data: {},
      meta: {}
    });
  }

  return next();
};

const validateForgotPassword = (req, res, next) => {
  const { emailId } = req.body || {};

  if (!isNonEmptyString(emailId)) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'emailId is required',
      data: {},
      meta: {}
    });
  }

  if (emailId.length > 100) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'emailId cannot exceed 100 characters',
      data: {},
      meta: {}
    });
  }

  return next();
};

const validateResetPassword = (req, res, next) => {
  const { token, password, confirmPassword } = req.body || {};

  if (!isNonEmptyString(token)) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'token is required',
      data: {},
      meta: {}
    });
  }

  if (!isNonEmptyString(password)) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'password is required',
      data: {},
      meta: {}
    });
  }

  if (password !== confirmPassword) {
    return apiResponse(res, {
      statusCode: 400,
      success: false,
      message: 'passwords do not match',
      data: {},
      meta: {}
    });
  }

  return next();
};

module.exports = {
  validateLogin,
  validateUpdateProfile,
  validateForgotPassword,
  validateResetPassword
};
