const cron = require('node-cron');
const prisma = require('../config/db');
const { resolveStatus } = require('../common/utils/status.util');
const { STATUS_MODULE_CODES, JOB_CARD_STATUS_CODES } = require('../common/constants/status.constants');

let isRegistered = false;
let isProcessing = false;

const resolveRecipients = async (locationId, limit) => {
  const userIds = new Set();
  const roleIds = new Set();

  if (limit.recipients && Array.isArray(limit.recipients)) {
    limit.recipients.forEach(r => {
      if (r.userId) userIds.add(r.userId);
      if (r.roleId) roleIds.add(r.roleId);
    });
  }

  if (roleIds.size > 0) {
    const users = await prisma.user.findMany({
      where: {
        roleId: { in: Array.from(roleIds) },
        locationId: locationId,
        isActive: true
      },
      select: {
        id: true
      }
    });
    users.forEach(u => userIds.add(u.id));
  }

  return Array.from(userIds);
};

async function runJobCardDeliveryMonitorWorkflow() {
  console.info('[CRON START] Job Card Delivery Monitor Job');
  const startTime = Date.now();
  const now = new Date();
  let scannedCount = 0;
  let delayedCount = 0;
  let notificationsCreated = 0;

  try {
    // Resolve the DELIVERED status for the job-card module to get its integer ID and moduleId
    const deliveredStatus = await resolveStatus(
      prisma,
      STATUS_MODULE_CODES.JOB_CARD_STATUS,
      JOB_CARD_STATUS_CODES.DELIVERED
    );

    if (!deliveredStatus) {
      console.warn('[Delivery Monitor] DELIVERED status not found. Exiting.');
      return;
    }

    const deliveredStatusId = deliveredStatus.id;
    const moduleId = deliveredStatus.moduleId;

    // Get the base time limit configuration for delivery
    // (Assuming locationId = null for global config, or we can fetch all limits)
    // For simplicity, we fetch the global configuration (locationId = null)
    // If they configure it per location, we would need to fetch all limits and group the query.
    const limits = await prisma.stageTimeLimit.findMany({
      where: {
        moduleId: moduleId,
        statusId: deliveredStatusId,
        isActive: true
      },
      include: { recipients: true }
    });

    if (limits.length === 0) {
      console.info('[Delivery Monitor] No stage time limits configured for delivery. Exiting.');
      return;
    }

    // We might have global config (locationId = null) and location-specific configs.
    // Group job cards by limit to apply the correct buffer and recipients.
    for (const limit of limits) {
      const bufferMinutes = limit.allowedMinutes || 0;
      // expectedDeliveryAt + buffer <= now   ==>   expectedDeliveryAt <= now - buffer
      const thresholdDate = new Date(now.getTime() - (bufferMinutes * 60 * 1000));

      const pendingJobCards = await prisma.jobCard.findMany({
        where: {
          currentStatusId: { not: deliveredStatusId },
          isDeliveryDelayNotified: false,
          expectedDeliveryAt: { lte: thresholdDate, not: null },
          // Apply location filter if limit is location-specific
          ...(limit.locationId ? { locationId: limit.locationId } : {})
        },
        include: {
          customer: { select: { fullName: true } },
          vehicle: { select: { registrationNo: true } }
        }
      });

      scannedCount += pendingJobCards.length;

      for (const jobCard of pendingJobCards) {
        const recipients = await resolveRecipients(jobCard.locationId, limit);

        if (recipients.length === 0) {
          console.warn(`[Delivery Monitor] Job Card ${jobCard.jobCardNo} delivery delayed but no notification recipients are configured.`);
        }

        const title = `Delivery Delayed`;
        const message = `Delivery for Job Card ${jobCard.jobCardNo} (Vehicle: ${jobCard.vehicle?.registrationNo}) has exceeded its expected delivery date and buffer period.`;

        await prisma.$transaction(async (tx) => {
          const locked = await tx.jobCard.updateMany({
            where: {
              id: jobCard.id,
              isDeliveryDelayNotified: false
            },
            data: {
              isDeliveryDelayNotified: true,
              deliveryDelayNotifiedAt: now
            }
          });

          if (locked.count === 0) {
            return; // Already processed
          }

          delayedCount++;

          if (recipients.length > 0) {
            await tx.notification.createMany({
              data: recipients.map((userId) => ({
                userId,
                title: title,
                message: message,
                type: 'DELIVERY_DELAY_ALERT',
                locationId: jobCard.locationId,
                gateEntryId: jobCard.gateEntryId,
                jobCardId: jobCard.id,
                sentAt: null,
                retryCount: 0
              }))
            });

            notificationsCreated += recipients.length;
          }
        });
      }
    }
  } catch (error) {
    console.error('[Delivery Monitor] Critical error:', error.message);
  } finally {
    const duration = Date.now() - startTime;
    console.info('[CRON END] Job Card Delivery Monitor Job');
    console.info(`- Job Cards Scanned: ${scannedCount}`);
    console.info(`- Job Cards Marked Delayed: ${delayedCount}`);
    console.info(`- Notifications Created: ${notificationsCreated}`);
    console.info(`- Execution Time: ${duration} ms`);
  }
}

function startJobCardDeliveryMonitorJob() {
  if (isRegistered) {
    console.info('[Delivery Monitor] Cron job already registered. Skipping registration.');
    return;
  }

  cron.schedule('*/1 * * * *', async () => {
    if (isProcessing) {
      console.warn('[Delivery Monitor] Previous execution is still active. Skipping run.');
      return;
    }

    try {
      isProcessing = true;
      await runJobCardDeliveryMonitorWorkflow();
    } finally {
      isProcessing = false;
    }
  });

  isRegistered = true;
  console.info('[Delivery Monitor] Cron job registered successfully to run every minute.');
}

module.exports = {
  startJobCardDeliveryMonitorJob,
  runJobCardDeliveryMonitorWorkflow
};
