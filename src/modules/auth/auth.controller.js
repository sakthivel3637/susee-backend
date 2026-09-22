const { apiResponse } = require('../../common/utils/apiResponse');
const authService = require('./auth.service');

const login = async (req, res, next) => {
  try {
    const platform = req.headers['x-client-platform'] || 'web';
    const data = await authService.login(req.body, platform);

    return apiResponse(res, {
      message: 'Login successful',
      data
    });
  } catch (error) {
    return next(error);
  }
};

const me = async (req, res, next) => {
  try {
    const data = await authService.getCurrentUser(req.user.userId);

    return apiResponse(res, {
      message: 'Current user fetched successfully',
      data
    });
  } catch (error) {
    return next(error);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const data = await authService.updateProfile(req.user.userId, req.body);

    return apiResponse(res, {
      message: 'Profile updated successfully',
      data
    });
  } catch (error) {
    return next(error);
  }
};

const forgotPassword = async (req, res, next) => {
  try {
    await authService.forgotPassword(req.body.emailId);

    return apiResponse(res, {
      message: 'Password reset link sent to your email successfully.'
    });
  } catch (error) {
    return next(error);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    await authService.resetPassword(req.body.token, req.body.password);

    return apiResponse(res, {
      message: 'Password reset successfully.'
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  login,
  me,
  updateProfile,
  forgotPassword,
  resetPassword
};
