const notificationService = require('./notification.service');
const { apiResponse } = require('../../common/utils/apiResponse');
const { admin } = require('../../config/firebase');

/**
 * Register user device token.
 */
async function registerDeviceToken(req, res, next) {
  try {
    const { token, platform = null, deviceId = null } = req.body;
    if (!token) {
      const error = new Error('Device token is required');
      error.statusCode = 400;
      throw error;
    }

    const userId = req.user.userId;
    const deviceToken = await notificationService.upsertDeviceToken(userId, { token, platform, deviceId });

    return apiResponse(res, {
      statusCode: 200,
      message: 'Device token registered successfully',
      data: deviceToken
    });
  } catch (error) {
    next(error);
  }
}

async function removeDeviceToken(req, res, next) {
  try {
    const { token, deviceId } = req.body;
    if (!token && !deviceId) {
      const error = new Error('Device token or deviceId is required');
      error.statusCode = 400;
      throw error;
    }

    await notificationService.deactivateDeviceToken(token, deviceId);

    return apiResponse(res, {
      statusCode: 200,
      message: 'Device token removed successfully'
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get notifications for logged-in user.
 */
async function listNotifications(req, res, next) {
  try {
    const userId = req.user.userId;
    const limit = parseInt(req.query.limit, 10) || 20;
    const page = parseInt(req.query.page, 10) || 1;
    const offset = (page - 1) * limit;
    const unreadOnly = String(req.query.unreadOnly || '').toLowerCase() === 'true';

    const { notifications, total } = await notificationService.getUserNotifications(userId, limit, offset, unreadOnly);

    return apiResponse(res, {
      statusCode: 200,
      message: 'Notifications retrieved successfully',
      data: {
        notifications,
        pagination: {
          total,
          limit,
          page,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    next(error);
  }
}

async function unreadCount(req, res, next) {
  try {
    const userId = req.user.userId;
    const count = await notificationService.countUnread(userId);

    return apiResponse(res, {
      statusCode: 200,
      message: 'Unread notification count retrieved successfully',
      data: { count }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Mark notification as read.
 */
async function markNotificationRead(req, res, next) {
  try {
    const userId = req.user.userId;
    const notificationId = parseInt(req.params.id, 10);

    if (isNaN(notificationId)) {
      const error = new Error('Invalid notification ID');
      error.statusCode = 400;
      throw error;
    }

    const updated = await notificationService.markAsRead(userId, notificationId);

    return apiResponse(res, {
      statusCode: 200,
      message: 'Notification marked as read',
      data: updated
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Mark all notifications as read.
 */
async function markAllNotificationsRead(req, res, next) {
  try {
    const userId = req.user.userId;
    await notificationService.markAllAsRead(userId);

    return apiResponse(res, {
      statusCode: 200,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Send test notification to managers.
 */
async function sendTestNotificationToManager(req, res, next) {
  try {
    const { title = 'Manager Test Push', message = 'This is a test notification for the Manager.', sendImmediate = false } = req.body;

    const managers = await notificationService.getManagersWithTokens();

    if (managers.length === 0) {
      return apiResponse(res, {
        statusCode: 404,
        success: false,
        message: 'No managers found in the database.'
      });
    }

    const results = [];

    for (const manager of managers) {
      if (sendImmediate) {
        // Send directly via FCM to testing active tokens
        const tokens = manager.deviceTokens.map(t => t.token);
        if (tokens.length === 0) {
          results.push({ userId: manager.id, name: manager.fullName, status: 'skipped', reason: 'No active device tokens' });
          continue;
        }

        const sendPromises = tokens.map(token => {
          const payload = {
            token,
            notification: { title, body: message },
            data: { test: 'true', type: 'TEST_PUSH' }
          };
          return admin.messaging().send(payload)
            .then(() => ({ token, success: true }))
            .catch(err => {
              // Deactivate stale token
              notificationService.deactivateDeviceToken(token);
              return { token, success: false, error: err.message };
            });
        });

        const tokenResults = await Promise.all(sendPromises);
        results.push({ userId: manager.id, name: manager.fullName, status: 'sent_direct', tokens: tokenResults });
      } else {
        // Create in database (background worker picks it up)
        const notification = await notificationService.createNotification({
          userId: manager.id,
          locationId: manager.locationId,
          title,
          message,
          type: 'TEST_PUSH',
          retryCount: 0
        });
        results.push({ userId: manager.id, name: manager.fullName, status: 'queued_in_db', notificationId: notification.id });
      }
    }

    return apiResponse(res, {
      statusCode: 200,
      message: sendImmediate ? 'Immediate test pushes processed' : 'Test notifications created in outbox',
      data: results
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  registerDeviceToken,
  removeDeviceToken,
  listNotifications,
  unreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  sendTestNotificationToManager
};
