const prisma = require('../../config/db');
const { getSocket } = require('../../config/socket');

const ACTIVE_STAGE_STATUSES = ['PENDING', 'DELAYED'];

const findStageTimeLimit = async (db, { locationId, moduleId, statusId }) => {
  const baseWhere = {
    moduleId,
    statusId,
    isActive: true
  };

  if (locationId) {
    const locationLimit = await db.stageTimeLimit.findFirst({
      where: {
        ...baseWhere,
        locationId
      }
    });

    if (locationLimit) {
      return locationLimit;
    }
  }

  return db.stageTimeLimit.findFirst({
    where: {
      ...baseWhere,
      locationId: null
    }
  });
};

const startStage = async ({
  locationId,
  gateEntryId = null,
  jobCardId = null,
  customerId,
  vehicleId,
  moduleId,
  statusId,
  createdById = null
}, db = prisma) => {
  console.info(`[startStage] Called: jobCardId=${jobCardId}, statusId=${statusId}, moduleId=${moduleId}, locationId=${locationId}`);

  const limit = await findStageTimeLimit(db, { locationId, moduleId, statusId });

  if (!limit) {
    console.warn(`[startStage] No stageTimeLimit found for statusId=${statusId}, moduleId=${moduleId}, locationId=${locationId}. No notification will be sent.`);
    return null;
  }

  console.info(`[startStage] stageTimeLimit found: id=${limit.id}, allowedMinutes=${limit.allowedMinutes}`);

  const newStage = await db.processStageTracking.create({
    data: {
      locationId,
      gateEntryId,
      jobCardId,
      customerId,
      vehicleId,
      moduleId,
      statusId,
      stageStatus: 'PENDING',
      startedAt: new Date(),
      completedAt: null,
      isDelayNotified: false,
      delayNotifiedAt: null,
      createdById
    },
    include: {
      status: true,
      jobCard: { select: { jobCardNo: true, slug: true } },
      gateEntry: { select: { gateEntryNo: true } },
      vehicle: { select: { registrationNo: true } }
    }
  });

  const fullLimit = await db.stageTimeLimit.findUnique({
    where: { id: limit.id },
    include: { recipients: true }
  });

  console.info(`[startStage] Recipients in limit: ${fullLimit?.recipients?.length || 0}`);

  if (fullLimit && fullLimit.recipients && fullLimit.recipients.length > 0) {
    const userIds = new Set();
    const roleIds = new Set();

    fullLimit.recipients.forEach(r => {
      if (r.userId) userIds.add(r.userId);
      if (r.roleId) roleIds.add(r.roleId);
    });

    console.info(`[startStage] Direct userIds: ${userIds.size}, roleIds: ${roleIds.size}`);

    if (roleIds.size > 0) {
      const users = await db.user.findMany({
        where: {
          roleId: { in: Array.from(roleIds) },
          locationId: newStage.locationId,
          isActive: true
        },
        select: { id: true }
      });
      users.forEach(u => userIds.add(u.id));
      console.info(`[startStage] Users resolved from roles: ${users.length}`);
    }

    const recipientsList = Array.from(userIds);
    console.info(`[startStage] Total recipients: ${recipientsList.length}`);

    if (recipientsList.length > 0) {
      const statusName = newStage.status?.statusName || newStage.status?.statusCode || 'Process stage';
      const vehicleNo = newStage.vehicle?.registrationNo ? ` for ${newStage.vehicle.registrationNo}` : '';
      const reference = newStage.jobCard?.jobCardNo || newStage.gateEntry?.gateEntryNo || `stage #${newStage.id}`;

      await db.notification.createMany({
        data: recipientsList.map((userId) => ({
          userId,
          title: `${statusName}`,
          message: `${statusName}${vehicleNo} has been started. Reference: ${reference}.`,
          type: 'START_ALERT',
          locationId: newStage.locationId,
          gateEntryId: newStage.gateEntryId,
          jobCardId: newStage.jobCardId,
          processStageTrackingId: newStage.id,
          sentAt: null,
          retryCount: 0
        }))
      });

      const io = getSocket();
      console.info(`[startStage] Socket io available: ${!!io}`);
      if (io) {
        recipientsList.forEach((userId) => {
          console.info(`[startStage] Emitting notification-created to user:${userId}`);
          io.to(`user:${userId}`).emit('notification-created', {
            title: `${statusName}`,
            message: `${statusName}${vehicleNo} has been started. Reference: ${reference}.`,
            type: 'START_ALERT',
            jobCardId: newStage.jobCardId,
            jobCardSlug: newStage.jobCard?.slug || null,
            processStageTrackingId: newStage.id
          });
        });
      }
    }
  }

  return newStage;
};

const completeStage = async ({
  gateEntryId = null,
  jobCardId = null,
  moduleId,
  statusId,
  modifiedById = null
}, db = prisma) => {
  const stage = await db.processStageTracking.findFirst({
    where: {
      ...(gateEntryId ? { gateEntryId } : {}),
      ...(jobCardId ? { OR: [{ jobCardId }, { jobCardId: null }] } : {}),
      moduleId,
      statusId,
      stageStatus: {
        in: ACTIVE_STAGE_STATUSES
      }
    },
    orderBy: {
      startedAt: 'desc'
    }
  });

  if (!stage) {
    return null;
  }

  const updatedStage = await db.processStageTracking.update({
    where: { id: stage.id },
    data: {
      stageStatus: 'COMPLETED',
      completedAt: new Date(),
      ...(jobCardId ? { jobCardId } : {}),
      modifiedById
    },
    include: {
      status: true,
      jobCard: { select: { jobCardNo: true, slug: true } },
      gateEntry: { select: { gateEntryNo: true } },
      vehicle: { select: { registrationNo: true } }
    }
  });

  // Stage Schedules logic for completion notifications
  const limit = await findStageTimeLimit(db, {
    locationId: updatedStage.locationId,
    moduleId: updatedStage.moduleId,
    statusId: updatedStage.statusId
  });

  if (limit) {
    const fullLimit = await db.stageTimeLimit.findUnique({
      where: { id: limit.id },
      include: { recipients: true }
    });

    if (fullLimit && fullLimit.recipients && fullLimit.recipients.length > 0) {
      const userIds = new Set();
      const roleIds = new Set();

      fullLimit.recipients.forEach(r => {
        if (r.userId) userIds.add(r.userId);
        if (r.roleId) roleIds.add(r.roleId);
      });

      if (roleIds.size > 0) {
        const users = await db.user.findMany({
          where: {
            roleId: { in: Array.from(roleIds) },
            locationId: updatedStage.locationId,
            isActive: true
          },
          select: { id: true }
        });
        users.forEach(u => userIds.add(u.id));
      }

      const recipientsList = Array.from(userIds);
      if (recipientsList.length > 0) {
        const statusName = updatedStage.status?.statusName || updatedStage.status?.statusCode || 'Process stage';
        const vehicleNo = updatedStage.vehicle?.registrationNo ? ` for ${updatedStage.vehicle.registrationNo}` : '';
        const reference = updatedStage.jobCard?.jobCardNo || updatedStage.gateEntry?.gateEntryNo || `stage #${updatedStage.id}`;

        await db.notification.createMany({
          data: recipientsList.map((userId) => ({
            userId,
            title: `${statusName} Completed`,
            message: `${statusName}${vehicleNo} has been marked as completed. Reference: ${reference}.`,
            type: 'COMPLETION_ALERT',
            locationId: updatedStage.locationId,
            gateEntryId: updatedStage.gateEntryId,
            jobCardId: updatedStage.jobCardId,
            processStageTrackingId: updatedStage.id,
            sentAt: null,
            retryCount: 0
          }))
        });

        const io = getSocket();
        if (io) {
          recipientsList.forEach((userId) => {
            io.to(`user:${userId}`).emit('notification-created', {
              title: `${statusName} Completed`,
              message: `${statusName}${vehicleNo} has been marked as completed. Reference: ${reference}.`,
              type: 'COMPLETION_ALERT',
              jobCardId: updatedStage.jobCardId,
              jobCardSlug: updatedStage.jobCard?.slug || null,
              processStageTrackingId: updatedStage.id
            });
          });
        }
      }
    }
  }

  return updatedStage;
};

const cancelStage = async ({
  gateEntryId = null,
  jobCardId = null,
  moduleId,
  statusId,
  modifiedById = null
}, db = prisma) => {
  return db.processStageTracking.updateMany({
    where: {
      ...(gateEntryId ? { gateEntryId } : {}),
      ...(jobCardId ? { jobCardId } : {}),
      moduleId,
      statusId,
      stageStatus: {
        in: ACTIVE_STAGE_STATUSES
      }
    },
    data: {
      stageStatus: 'CANCELLED',
      completedAt: new Date(),
      modifiedById
    }
  });
};

const getCurrentStageByJobCard = async (jobCardId, db = prisma) => {
  return db.processStageTracking.findFirst({
    where: {
      jobCardId,
      stageStatus: {
        in: ACTIVE_STAGE_STATUSES
      }
    },
    include: {
      module: true,
      status: true
    },
    orderBy: {
      startedAt: 'desc'
    }
  });
};

const getCurrentStageByGateEntry = async (gateEntryId, db = prisma) => {
  return db.processStageTracking.findFirst({
    where: {
      gateEntryId,
      stageStatus: {
        in: ACTIVE_STAGE_STATUSES
      }
    },
    include: {
      module: true,
      status: true
    },
    orderBy: {
      startedAt: 'desc'
    }
  });
};

const skipStage = async ({
  locationId,
  gateEntryId = null,
  jobCardId = null,
  customerId,
  vehicleId,
  moduleId,
  statusId,
  modifiedById = null
}, db = prisma) => {
  const stage = await db.processStageTracking.findFirst({
    where: {
      ...(gateEntryId ? { gateEntryId } : {}),
      ...(jobCardId ? { OR: [{ jobCardId }, { jobCardId: null }] } : {}),
      moduleId,
      statusId,
      stageStatus: {
        in: ACTIVE_STAGE_STATUSES
      }
    },
    orderBy: {
      startedAt: 'desc'
    }
  });

  if (stage) {
    return db.processStageTracking.update({
      where: { id: stage.id },
      data: {
        stageStatus: 'SKIPPED',
        completedAt: new Date(),
        ...(jobCardId ? { jobCardId } : {}),
        modifiedById
      }
    });
  }

  return db.processStageTracking.create({
    data: {
      locationId,
      gateEntryId,
      jobCardId,
      customerId,
      vehicleId,
      moduleId,
      statusId,
      stageStatus: 'SKIPPED',
      startedAt: new Date(),
      completedAt: new Date(),
      isDelayNotified: false,
      delayNotifiedAt: null,
      createdById: modifiedById
    }
  });
};

module.exports = {
  findStageTimeLimit,
  startStage,
  completeStage,
  cancelStage,
  skipStage,
  getCurrentStageByJobCard,
  getCurrentStageByGateEntry
};
