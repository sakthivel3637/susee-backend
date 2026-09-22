const cron = require('node-cron');
const prisma = require('../config/db');
const { findStageTimeLimit } = require('../modules/processStageTracking/processStageTracking.service');

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

  try {
    const pendingStages = await prisma.processStageTracking.findMany({
      where: {
        stageStatus: 'PENDING',
        isDelayNotified: false,
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
            jobCardNo: true
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

    scannedCount = pendingStages.length;

    for (const stage of pendingStages) {
      const limit = await findStageTimeLimit(prisma, {
        locationId: stage.locationId,
        moduleId: stage.moduleId,
        statusId: stage.statusId
      });
      // Ensure recipients are fetched
      if (limit) {
        const fullLimit = await prisma.stageTimeLimit.findUnique({
          where: { id: limit.id },
          include: { recipients: true }
        });
        Object.assign(limit, { recipients: fullLimit?.recipients || [] });
      }

      if (!shouldNotifyStage(stage, limit, now)) {
        continue;
      }

      const recipients = await resolveRecipients(stage, limit);

      if (recipients.length === 0) {
        console.warn(`[Process Stage Delay Monitor] Stage ${stage.id} delayed but no notification recipients are configured.`);
      }

      const notification = buildDelayMessage(stage);

      await prisma.$transaction(async (tx) => {
        const locked = await tx.processStageTracking.updateMany({
          where: {
            id: stage.id,
            stageStatus: 'PENDING',
            isDelayNotified: false,
            completedAt: null
          },
          data: {
            stageStatus: 'DELAYED',
            isDelayNotified: true,
            delayNotifiedAt: now
          }
        });

        if (locked.count === 0) {
          return;
        }

        delayedCount++;

        if (recipients.length === 0) {
          return;
        }

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
      });
    }
  } catch (error) {
    console.error('[Process Stage Delay Monitor] Critical error:', error.message);
  } finally {
    const duration = Date.now() - startTime;
    console.info('[CRON END] Process Stage Delay Monitor Job');
    console.info(`- Pending Stages Scanned: ${scannedCount}`);
    console.info(`- Stages Marked Delayed: ${delayedCount}`);
    console.info(`- Notifications Created: ${notificationsCreated}`);
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
