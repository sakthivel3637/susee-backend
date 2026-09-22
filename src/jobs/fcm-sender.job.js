const cron = require('node-cron');
const prisma = require('../config/db');
const { admin } = require('../config/firebase');

let isRegistered = false;
let isProcessing = false;
const MAX_RETRY_COUNT = 3;

const isInvalidTokenError = (err) => {
  const message = String(err && err.message ? err.message : '');

  return err.code === 'messaging/registration-token-not-registered'
    || err.code === 'messaging/invalid-registration-token'
    || message.includes('registration-token-not-registered')
    || message.includes('invalid-registration-token')
    || message.includes('not a valid FCM registration token')
    || message.includes('invalid-argument');
};

const markNotificationFailure = async (notificationId, reason, retryCount) => {
  return prisma.notification.update({
    where: { id: notificationId },
    data: {
      failedAt: new Date(),
      failureReason: reason,
      retryCount
    }
  });
};

/**
 * Main workflow to send pending notifications via FCM.
 */
async function runFcmSenderWorkflow() {
  console.info('[CRON START] FCM Push Notification Sender Job');
  const startTime = Date.now();

  let processedCount = 0;
  let successCount = 0;
  let skippedCount = 0;

  try {
    // Check if Firebase is initialized
    if (!admin || admin.apps.length === 0) {
      console.warn('[FCM Sender Job] Firebase Admin SDK is not initialized. Skipping execution.');
      return;
    }

    // Query up to 100 notifications that are still retryable.
    const notifications = await prisma.notification.findMany({
      where: {
        sentAt: null,
        failedAt: null,
        retryCount: {
          lt: MAX_RETRY_COUNT
        }
      },
      include: {
        user: {
          include: {
            deviceTokens: {
              where: {
                isActive: true
              }
            }
          }
        }
      },
      take: 100
    });

    for (const notification of notifications) {
      processedCount++;
      const tokens = notification.user?.deviceTokens || [];

      if (tokens.length === 0) {
        console.warn(`[FCM Sender Job] Notification ${notification.id} skipped: User ${notification.userId} has no active device tokens.`);
        await markNotificationFailure(
          notification.id,
          'NO_ACTIVE_DEVICE_TOKEN',
          Math.min(notification.retryCount + 1, MAX_RETRY_COUNT)
        );
        skippedCount++;
        continue;
      }

      let sentAny = false;
      let temporaryFailureCount = 0;
      let invalidTokenCount = 0;
      let lastFailureReason = null;

      for (const tokenEntity of tokens) {
        try {
          const payload = {
            token: tokenEntity.token,
            notification: {
              title: notification.title,
              body: notification.message || ''
            },
            data: {
              notificationId: String(notification.id),
              gateEntryId: String(notification.gateEntryId || ''),
              jobCardId: String(notification.jobCardId || ''),
              processStageTrackingId: String(notification.processStageTrackingId || ''),
              type: notification.type || ''
            }
          };

          await admin.messaging().send(payload);
          sentAny = true;
        } catch (err) {
          console.error(`[FCM Sender Job] Failed to send push to token ID ${tokenEntity.id}:`, err.message);

          // Check if token is invalid or expired
          lastFailureReason = err.code || err.message || 'FCM_SEND_FAILED';

          if (isInvalidTokenError(err)) {
            invalidTokenCount++;
            console.info(`[FCM Sender Job] Deactivating invalid token ID ${tokenEntity.id}`);
            try {
              await prisma.userDeviceToken.update({
                where: { id: tokenEntity.id },
                data: { isActive: false }
              });
            } catch (updateErr) {
              console.error(`[FCM Sender Job] Failed to deactivate token ${tokenEntity.id}:`, updateErr.message);
            }
          } else {
            temporaryFailureCount++;
          }
        }
      }

      if (sentAny) {
        try {
          await prisma.notification.update({
            where: { id: notification.id },
            data: {
              sentAt: new Date(),
              failureReason: null
            }
          });
          successCount++;
        } catch (dbErr) {
          console.error(`[FCM Sender Job] Failed to update sentAt for Notification ${notification.id}:`, dbErr.message);
        }
        continue;
      }

      const nextRetryCount = notification.retryCount + 1;

      if (temporaryFailureCount === 0 && invalidTokenCount > 0) {
        await markNotificationFailure(notification.id, 'NO_DELIVERABLE_DEVICE_TOKEN', nextRetryCount);
        skippedCount++;
        continue;
      }

      if (nextRetryCount >= MAX_RETRY_COUNT) {
        await markNotificationFailure(notification.id, lastFailureReason || 'FCM_SEND_FAILED', nextRetryCount);
        skippedCount++;
        continue;
      }

      await prisma.notification.update({
        where: { id: notification.id },
        data: {
          retryCount: nextRetryCount,
          failureReason: lastFailureReason
        }
      });
    }
  } catch (error) {
    console.error('[FCM Sender Job] Critical error in background job:', error.message);
  } finally {
    const duration = Date.now() - startTime;
    console.info('[CRON END] FCM Push Notification Sender Job');
    console.info(`- Total Pending Notifications Evaluated: ${processedCount}`);
    console.info(`- Notifications Successfully Sent: ${successCount}`);
    console.info(`- Notifications Skipped (No Tokens): ${skippedCount}`);
    console.info(`- Execution Time: ${duration} ms`);
  }
}

/**
 * Initialize and register the cron job safely.
 */
function startFcmSenderJob() {
  if (isRegistered) {
    console.info('[FCM Sender Job] Cron job already registered. Skipping registration.');
    return;
  }

  // Schedule task to run every 30 seconds
  cron.schedule('*/30 * * * * *', async () => {
    if (isProcessing) {
      console.warn('[FCM Sender Job] Previous execution is still active. Skipping run to prevent overlaps.');
      return;
    }

    try {
      isProcessing = true;
      await runFcmSenderWorkflow();
    } finally {
      isProcessing = false;
    }
  });

  isRegistered = true;
  console.info('[FCM Sender Job] Cron job registered successfully to run every 30 seconds (*/30 * * * * *).');
}

module.exports = {
  startFcmSenderJob,
  runFcmSenderWorkflow
};
