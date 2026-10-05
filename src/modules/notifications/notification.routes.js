const router = require('express').Router();
const notificationController = require('./notification.controller');
const { authenticate } = require('../../common/middleware/auth.middleware');
const { permissionMiddleware } = require('../../common/middleware/permission.middleware');

// Only administrative actions need permission checks.
// Reading and marking personal notifications are always allowed for any authenticated user.
const canUpdateNotifications = permissionMiddleware('/notifications', 'canUpdate');
const canCreateNotifications = permissionMiddleware('/notifications', 'canCreate');

router.use(authenticate);

// Personal notification routes — open to ALL authenticated users (no role-based gate)
router.get('/unread-count', notificationController.unreadCount);
router.get('/', notificationController.listNotifications);
router.put('/read/:id', notificationController.markNotificationRead);

// Administrative actions — require permission
router.patch('/read-all', canUpdateNotifications, notificationController.markAllNotificationsRead);
router.post('/test-manager', canCreateNotifications, notificationController.sendTestNotificationToManager);

module.exports = router;
