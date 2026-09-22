const router = require('express').Router();
const notificationController = require('./notification.controller');
const { authenticate } = require('../../common/middleware/auth.middleware');
const { permissionMiddleware } = require('../../common/middleware/permission.middleware');

const canReadNotifications = permissionMiddleware('/notifications', 'canRead');
const canUpdateNotifications = permissionMiddleware('/notifications', 'canUpdate');
const canCreateNotifications = permissionMiddleware('/notifications', 'canCreate');

router.use(authenticate);

router.get('/unread-count', canReadNotifications, notificationController.unreadCount);
router.get('/', canReadNotifications, notificationController.listNotifications);
router.patch('/read-all', canUpdateNotifications, notificationController.markAllNotificationsRead);
router.put('/read/:id', canReadNotifications, notificationController.markNotificationRead);
router.post('/test-manager', canCreateNotifications, notificationController.sendTestNotificationToManager);

module.exports = router;
