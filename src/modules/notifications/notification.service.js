const prisma = require('../../config/db');
const { getSocket } = require('../../config/socket');

async function upsertDeviceToken(userId, { token, platform = null, deviceId = null }) {
  const normalizedDeviceId = String(deviceId || '').trim();

  if (normalizedDeviceId) {
    await prisma.userDeviceToken.updateMany({
      where: {
        deviceId: normalizedDeviceId,
        token: {
          not: token
        },
        isActive: true
      },
      data: {
        isActive: false,
        lastUsedAt: new Date()
      }
    });
  }

  return prisma.userDeviceToken.upsert({
    where: { token },
    update: {
      userId,
      platform,
      deviceId: normalizedDeviceId || null,
      isActive: true,
      lastUsedAt: new Date()
    },
    create: {
      userId,
      token,
      platform,
      deviceId: normalizedDeviceId || null,
      isActive: true,
      lastUsedAt: new Date()
    }
  });
}

/**
 * Get paginated notifications for a specific user.
 */
async function getUserNotifications(userId, limit = 20, offset = 0, unreadOnly = false) {
  const where = {
    userId,
    ...(unreadOnly ? { readAt: null } : {})
  };

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      include: {
        jobCard: {
          select: {
            slug: true,
            jobCardNo: true,
            vehicle: {
              select: {
                registrationNo: true
              }
            },
            customer: {
              select: {
                mobileNo: true,
                alternateMobileNo: true
              }
            }
          }
        },
        gateEntry: {
          select: {
            slug: true,
            gateEntryNo: true,
            entryType: true,
            vehicle: {
              select: {
                registrationNo: true
              }
            },
            customer: {
              select: {
                mobileNo: true,
                alternateMobileNo: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset
    }),
    prisma.notification.count({
      where
    })
  ]);

  const formattedNotifications = notifications.map((n) => ({
    ...n,
    isRead: Boolean(n.readAt)
  }));

  return { notifications: formattedNotifications, total };
}

async function countUnread(userId) {
  return prisma.notification.count({
    where: {
      userId,
      readAt: null
    }
  });
}

/**
 * Mark a single notification as read.
 */
async function markAsRead(userId, notificationId) {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId }
  });

  if (!notification || notification.userId !== userId) {
    const error = new Error('Notification not found or access denied');
    error.statusCode = 404;
    throw error;
  }

  const updated = await prisma.notification.update({
    where: { id: notificationId },
    data: { readAt: new Date() }
  });

  try {
    const unreadCount = await countUnread(userId);
    const io = getSocket();
    if (io) {
      io.to(`user:${userId}`).emit('notification-read', {
        notificationId: updated.id,
        jobCardId: updated.jobCardId,
        gateEntryId: updated.gateEntryId,
        processStageTrackingId: updated.processStageTrackingId,
        readAt: updated.readAt,
        unreadCount
      });
    }
  } catch (socketErr) {
    console.warn('Failed to emit notification-read socket event:', socketErr?.message);
  }

  return updated;
}

/**
 * Mark all notifications as read for a user.
 */
async function markAllAsRead(userId) {
  const result = await prisma.notification.updateMany({
    where: {
      userId,
      readAt: null
    },
    data: {
      readAt: new Date()
    }
  });

  try {
    const io = getSocket();
    if (io) {
      io.to(`user:${userId}`).emit('notification-read-all', {
        readAt: new Date(),
        unreadCount: 0
      });
    }
  } catch (socketErr) {
    console.warn('Failed to emit notification-read-all socket event:', socketErr?.message);
  }

  return result;
}

/**
 * Get active managers with their active device tokens.
 */
async function getManagersWithTokens() {
  return prisma.user.findMany({
    where: {
      role: {
        slug: 'manager'
      },
      isActive: true
    },
    include: {
      deviceTokens: {
        where: {
          isActive: true
        }
      }
    }
  });
}

/**
 * Deactivate a device token (e.g. if invalid or client logged out).
 * Supports deactivating by token or by deviceId.
 */
async function deactivateDeviceToken(token, deviceId = null) {
  const normalizedDeviceId = String(deviceId || '').trim();
  const where = normalizedDeviceId && !token
    ? { deviceId: normalizedDeviceId, isActive: true }
    : { token };

  return prisma.userDeviceToken.updateMany({
    where,
    data: {
      isActive: false,
      lastUsedAt: new Date()
    }
  });
}

/**
 * Create a new notification record in the database.
 */
async function createNotification(data) {
  return prisma.notification.create({
    data
  });
}

module.exports = {
  upsertDeviceToken,
  getUserNotifications,
  countUnread,
  markAsRead,
  markAllAsRead,
  getManagersWithTokens,
  deactivateDeviceToken,
  createNotification
};
