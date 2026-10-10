const cron = require('node-cron');
const prisma = require('../config/db');
const { findStageTimeLimit } = require('../modules/processStageTracking/processStageTracking.service');
const { getSocket } = require('../config/socket');

let isRegistered = false;
let isProcessing = false;

const buildDelayMessage = (stage) => {
  const statusName = stage.status?.statusName || stage.status?.statusCode || 'Process stage';
  const vehicleNo = stage.vehicle?.registrationNo ? ` for ${stage.vehicle.registrationNo}` : '';
  const reference = stage.jobCard?.jobCardNo || stage.gateEntry?.gateEntryNo || `stage #${stage.id}`;

  return {
    title: `${statusName} delayed`,
    message: `${statusName}${vehicleNo} has exceeded its configured time limit. Reference: ${reference}.`
  };
};

const resolveRecipients = async (stage, limit) => {
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
        locationId: stage.locationId,
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

const shouldNotifyStage = (stage, limit, now) => {
  if (!limit || !limit.allowedMinutes || limit.allowedMinutes <= 0 || !stage.startedAt) {
    return false;
  }

  const dueAt = new Date(stage.startedAt.getTime() + (limit.allowedMinutes * 60 * 1000));
  return dueAt <= now;
};

async function runProcessStageDelayMonitorWorkflow() {
  console.info('[CRON START] Process Stage Delay Monitor Job');
  const startTime = Date.now();
  const now = new Date();
  let scannedCount = 0;
  let delayedCount = 0;
  let notificationsCreated = 0;
  let repeatEventsEmitted = 0;

  try {
    const activeStages = await prisma.processStageTracking.findMany({
      where: {
        stageStatus: { in: ['PENDING', 'DELAYED'] },
        completedAt: null
      },
      include: {
        status: true,
        module: true,
        gateEntry: {
          select: {
            id: true,
            gateEntryNo: true
          }
        },
        jobCard: {
          select: {
            id: true,
            jobCardNo: true,
            slug: true
          }
        },
        vehicle: {
          select: {
            registrationNo: true
          }
        }
      },
      orderBy: {
        startedAt: 'asc'
      },
      take: 200
    });

    scannedCount = activeStages.length;

    for (const stage of activeStages) {
      const limit = await findStageTimeLimit(prisma, {
        locationId: stage.locationId,
        moduleId: stage.moduleId,
        statusId: stage.statusId
      });

      if (!limit || !limit.allowedMinutes || limit.allowedMinutes <= 0 || !stage.startedAt) {
        continue;
      }

      // Ensure recipients are fetched
      const fullLimit = await prisma.stageTimeLimit.findUnique({
        where: { id: limit.id },
        include: { recipients: true }
      });
      Object.assign(limit, { recipients: fullLimit?.recipients || [] });

      const isFirstTime = !stage.isDelayNotified || !stage.lastNotifiedAt;
      const initialDueAt = new Date(stage.startedAt.getTime() + (limit.allowedMinutes * 60 * 1000));

      if (isFirstTime) {
        if (initialDueAt > now) {
          continue; // Initial SLA threshold not reached yet
        }
      } else {
        const repeatMinutes = limit.repeatIntervalMinutes || limit.allowedMinutes || 5;
        const repeatMs = repeatMinutes * 60 * 1000;
        const nextRepeatAt = new Date(new Date(stage.lastNotifiedAt).getTime() + repeatMs);

        if (nextRepeatAt > now) {
          continue; // Repeat interval threshold not reached yet
        }
      }

      const recipients = await resolveRecipients(stage, limit);

      if (recipients.length === 0) {
        console.warn(`[Process Stage Delay Monitor] Stage ${stage.id} delayed but no notification recipients are configured.`);
      }

      const notification = buildDelayMessage(stage);

      await prisma.$transaction(async (tx) => {
        await tx.processStageTracking.update({
          where: { id: stage.id },
          data: {
            stageStatus: 'DELAYED',
            isDelayNotified: true,
            delayNotifiedAt: stage.delayNotifiedAt || now,
            lastNotifiedAt: now,
            notificationCount: { increment: 1 }
          }
        });

        delayedCount++;
        const io = getSocket();

        if (isFirstTime) {
          if (recipients.length > 0) {
            await tx.notification.createMany({
              data: recipients.map((userId) => ({
                userId,
                title: notification.title,
                message: notification.message,
                type: 'DELAY_ALERT',
                locationId: stage.locationId,
                gateEntryId: stage.gateEntryId,
                jobCardId: stage.jobCardId,
                processStageTrackingId: stage.id,
                sentAt: null,
                retryCount: 0
              }))
            });
            notificationsCreated += recipients.length;
          }

          if (io) {
            recipients.forEach((userId) => {
              io.to(`user:${userId}`).emit('notification-created', {
                title: notification.title,
                message: notification.message,
                type: 'DELAY_ALERT',
                jobCardId: stage.jobCardId,
                jobCardSlug: stage.jobCard?.slug || null,
                processStageTrackingId: stage.id,
                statusCode: stage.status?.statusCode
              });
            });
          }
        } else {
          // Repeat alert: No DB insert! Emit Socket event for online popups
          if (io && recipients.length > 0) {
            recipients.forEach((userId) => {
              io.to(`user:${userId}`).emit('notification-repeat-popup', {
                title: notification.title,
                message: notification.message,
                type: 'DELAY_ALERT',
                jobCardId: stage.jobCardId,
                jobCardSlug: stage.jobCard?.slug || null,
                processStageTrackingId: stage.id,
                statusCode: stage.status?.statusCode
              });
            });
            repeatEventsEmitted += recipients.length;
          }
        }
      });
    }
  } catch (error) {
    console.error('[Process Stage Delay Monitor] Critical error:', error.message);
  } finally {
    const duration = Date.now() - startTime;
    console.info('[CRON END] Process Stage Delay Monitor Job');
    console.info(`- Active Stages Scanned: ${scannedCount}`);
    console.info(`- Stages Evaluated Delayed: ${delayedCount}`);
    console.info(`- Initial DB Notifications Created: ${notificationsCreated}`);
    console.info(`- Repeat Socket Popups Emitted: ${repeatEventsEmitted}`);
    console.info(`- Execution Time: ${duration} ms`);
  }
}

function startProcessStageDelayMonitorJob() {
  if (isRegistered) {
    console.info('[Process Stage Delay Monitor] Cron job already registered. Skipping registration.');
    return;
  }

  cron.schedule('*/1 * * * *', async () => {
    if (isProcessing) {
      console.warn('[Process Stage Delay Monitor] Previous execution is still active. Skipping run.');
      return;
    }

    try {
      isProcessing = true;
      await runProcessStageDelayMonitorWorkflow();
    } finally {
      isProcessing = false;
    }
  });

  isRegistered = true;
  console.info('[Process Stage Delay Monitor] Cron job registered successfully to run every minute.');
}

module.exports = {
  startProcessStageDelayMonitorJob,
  runProcessStageDelayMonitorWorkflow
};
