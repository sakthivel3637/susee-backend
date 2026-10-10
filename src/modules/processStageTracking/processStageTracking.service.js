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

  if (jobCardId) {
    const existingStage = await db.processStageTracking.findFirst({
      where: {
        jobCardId,
        statusId,
        stageStatus: {
          in: ACTIVE_STAGE_STATUSES
        }
      },
      include: {
        status: true,
        jobCard: { select: { jobCardNo: true, slug: true } },
        gateEntry: { select: { gateEntryNo: true } },
        vehicle: { select: { registrationNo: true } }
      }
    });

    if (existingStage) {
      return existingStage;
    }
  }

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

  // Start Alert notification removed upon request:
  // Notifications are now ONLY generated when stage schedule time limits expire (DELAY_ALERT).
  return newStage;
};

const completeStage = async ({
  gateEntryId = null,
  jobCardId = null,
  moduleId = null,
  statusId = null,
  modifiedById = null
}, db = prisma) => {
  const where = {
    ...(gateEntryId ? { gateEntryId } : {}),
    ...(jobCardId ? { OR: [{ jobCardId }, { jobCardId: null }] } : {}),
    ...(moduleId ? { moduleId } : {}),
    ...(statusId ? { statusId } : {}),
    stageStatus: {
      in: ACTIVE_STAGE_STATUSES
    }
  };

  const updatedStages = await db.processStageTracking.updateMany({
    where,
    data: {
      stageStatus: 'COMPLETED',
      completedAt: new Date(),
      ...(jobCardId ? { jobCardId } : {}),
      modifiedById
    }
  });

  try {
    const io = getSocket();
    if (io) {
      io.emit('stage-completed', { gateEntryId, jobCardId, moduleId, statusId });
    }
  } catch (socketErr) {
    console.warn('Failed to emit stage-completed socket event:', socketErr?.message);
  }

  return updatedStages;
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
