const router = require('express').Router();

const authController = require('./auth.controller');
const { authMiddleware } = require('../../common/middleware/auth.middleware');
const { validateLogin, validateUpdateProfile, validateForgotPassword, validateResetPassword } = require('./auth.validation');

router.post('/login', validateLogin, authController.login);
router.get('/me', authMiddleware, authController.me);
router.put('/profile', authMiddleware, validateUpdateProfile, authController.updateProfile);
router.post('/forgot-password', validateForgotPassword, authController.forgotPassword);
router.post('/reset-password', validateResetPassword, authController.resetPassword);

module.exports = router;
