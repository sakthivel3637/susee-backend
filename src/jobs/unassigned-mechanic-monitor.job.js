const cron = require('node-cron');
const prisma = require('../config/db');
const { getSocket } = require('../config/socket');

/**
 * Unassigned Mechanic / Bay Monitor Job
 *
 * Watches for job cards that are sitting in the
 * MECHANICAL_ASSIGNMENT_PENDING or BODY_SHOP_ASSIGNMENT_PENDING queue
 * for more than 2 minutes without a mechanic/bay being assigned.
 *
 * When triggered it:
 *   1. Marks the ProcessStageTracking record as notified (one-time alert)
 *   2. Creates a DB notification for each recipient
 *   3. Emits a real-time socket event to each recipient
 *
 * Recipients: users with roles  managing-director | manager | floor-supervisor | admin
 * (all active users at the same location as the job card)
 */

let isRegistered = false;
let isProcessing = false;

const UNASSIGNED_ALERT_TYPE = 'UNASSIGNED_ALERT';
const ALERT_DELAY_MINUTES = 2;

// Role slugs that should receive the alert
const NOTIFY_ROLE_SLUGS = [
  'managing-director',
  'manager',
  'floor-supervisor',
  
];

// Status codes that represent "waiting for assignment"
const PENDING_ASSIGNMENT_STATUS_CODES = [
  'MECHANICAL_ASSIGNMENT_PENDING',
  'BODY_SHOP_ASSIGNMENT_PENDING'
];

/**
 * Resolve all user IDs at a given location that belong to any of the notify roles.
 */
const resolveRecipients = async (locationId) => {
  const roles = await prisma.role.findMany({
    where: {
      slug: { in: NOTIFY_ROLE_SLUGS },
      isActive: true
    },
    select: { id: true }
  });

  if (roles.length === 0) return [];

  const roleIds = roles.map((r) => r.id);

  const users = await prisma.user.findMany({
    where: {
      roleId: { in: roleIds },
      isActive: true,
      ...(locationId ? { locationId } : {})
    },
    select: { id: true }
  });

  return users.map((u) => u.id);
};

/**
 * Build a human-readable alert message for the given stage.
 */
const buildAlertMessage = (stage) => {
  const statusCode = stage.status?.statusCode || '';
  const department = statusCode.includes('BODY_SHOP') ? 'Body Shop' : 'Mechanical';
  const vehicleNo = stage.vehicle?.registrationNo
    ? ` for vehicle ${stage.vehicle.registrationNo}`
    : '';
  const reference = stage.jobCard?.jobCardNo || `job card #${stage.jobCardId}`;

  return {
    title: `${department} unassigned — Action required`,
    message: `Job card ${reference}${vehicleNo} has been waiting in the ${department} queue for more than ${ALERT_DELAY_MINUTES} minute${ALERT_DELAY_MINUTES !== 1 ? 's' : ''} without a mechanic or bay assigned.`
  };
};

async function runUnassignedMechanicMonitorWorkflow() {
  console.info('[CRON START] Unassigned Mechanic Monitor Job');
  const startTime = Date.now();
  const now = new Date();
  const thresholdDate = new Date(now.getTime() - ALERT_DELAY_MINUTES * 60 * 1000);

  let scannedCount = 0;
  let alertedCount = 0;
  let notificationsCreated = 0;

  try {
    // Find ProcessStageTracking entries for MECHANICAL_ASSIGNMENT_PENDING /
    // BODY_SHOP_ASSIGNMENT_PENDING that started more than 2 minutes ago
    // and have not yet been notified.
    const pendingStages = await prisma.processStageTracking.findMany({
      where: {
        stageStatus: 'PENDING',
        isDelayNotified: false,
        completedAt: null,
        startedAt: { lte: thresholdDate },
        status: {
          statusCode: { in: PENDING_ASSIGNMENT_STATUS_CODES }
        }
      },
      include: {
        status: {
          select: { statusCode: true, statusName: true }
        },
        jobCard: {
          select: {
            id: true,
            jobCardNo: true,
            slug: true,
            locationId: true
          }
        },
        vehicle: {
          select: { registrationNo: true }
        }
      },
      orderBy: { startedAt: 'asc' },
      take: 200
    });

    scannedCount = pendingStages.length;

    for (const stage of pendingStages) {
      const locationId = stage.locationId || stage.jobCard?.locationId;
      const recipients = await resolveRecipients(locationId);

      if (recipients.length === 0) {
        console.warn(
          `[Unassigned Mechanic Monitor] Stage ${stage.id} overdue but no recipients found for location ${locationId}.`
        );
      }

      const { title, message } = buildAlertMessage(stage);

      await prisma.$transaction(async (tx) => {
        // Lock the record — if another cron iteration already notified, skip.
        const locked = await tx.processStageTracking.updateMany({
          where: {
            id: stage.id,
            stageStatus: 'PENDING',
            isDelayNotified: false,
            completedAt: null
          },
          data: {
            isDelayNotified: true,
            delayNotifiedAt: now
          }
        });

        if (locked.count === 0) return; // Already handled by a concurrent run

        alertedCount++;

        if (recipients.length === 0) return;

        // Persist DB notifications
        await tx.notification.createMany({
          data: recipients.map((userId) => ({
            userId,
            title,
            message,
            type: UNASSIGNED_ALERT_TYPE,
            locationId: locationId || null,
            jobCardId: stage.jobCardId || null,
            processStageTrackingId: stage.id,
            sentAt: null,
            retryCount: 0
          }))
        });

        // Emit real-time socket events
        const io = getSocket();
        if (io) {
          recipients.forEach((userId) => {
            io.to(`user:${userId}`).emit('notification-created', {
              title,
              message,
              type: UNASSIGNED_ALERT_TYPE,
              jobCardId: stage.jobCardId || null,
              jobCardSlug: stage.jobCard?.slug || null,
              statusCode: stage.status?.statusCode || null
            });
          });
        }

        notificationsCreated += recipients.length;
      });
    }
  } catch (error) {
    console.error('[Unassigned Mechanic Monitor] Critical error:', error.message);
  } finally {
    const duration = Date.now() - startTime;
    console.info('[CRON END] Unassigned Mechanic Monitor Job');
    console.info(`- Stages Scanned: ${scannedCount}`);
    console.info(`- Alerts Sent: ${alertedCount}`);
    console.info(`- Notifications Created: ${notificationsCreated}`);
    console.info(`- Execution Time: ${duration} ms`);
  }
}

function startUnassignedMechanicMonitorJob() {
  if (isRegistered) {
    console.info('[Unassigned Mechanic Monitor] Cron job already registered. Skipping.');
    return;
  }

  cron.schedule('*/1 * * * *', async () => {
    if (isProcessing) {
      console.warn('[Unassigned Mechanic Monitor] Previous execution still active. Skipping run.');
      return;
    }

    try {
      isProcessing = true;
      await runUnassignedMechanicMonitorWorkflow();
    } finally {
      isProcessing = false;
    }
  });

  isRegistered = true;
  console.info('[Unassigned Mechanic Monitor] Cron job registered (runs every minute).');
}

module.exports = {
  startUnassignedMechanicMonitorJob,
  runUnassignedMechanicMonitorWorkflow
};
