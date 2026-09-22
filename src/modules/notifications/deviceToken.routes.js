const router = require('express').Router();
const notificationController = require('./notification.controller');
const { authenticate } = require('../../common/middleware/auth.middleware');

router.use(authenticate);
router.post('/', notificationController.registerDeviceToken);
router.put('/', notificationController.removeDeviceToken);

module.exports = router;
