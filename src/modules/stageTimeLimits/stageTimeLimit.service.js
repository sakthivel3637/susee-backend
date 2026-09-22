const prisma = require('../../config/db');
const { createAuditLog, buildChangeDetails } = require('../../common/utils/audit.util');

const STAGE_SCHEDULE_AUDIT_MODULE = {
  moduleCode: 'stage-schedules',
  moduleName: 'Stage Schedules'
};

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const parseBooleanFilter = (value) => {
  if (value === undefined || value === '') return undefined;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
};

const toNullableInt = (value) => {
  if (value === undefined || value === null || value === '') return null;
  return Number(value);
};

const includeDisplayRelations = {
  location: { select: { id: true, locationName: true } },
  module: { select: { id: true, moduleName: true, moduleCode: true } },
  status: { select: { id: true, statusName: true, statusCode: true } },
  recipients: {
    include: {
      role: { select: { id: true, name: true, slug: true } },
      user: { select: { id: true, fullName: true, emailId: true } }
    }
  }
};

const formatStageTimeLimit = (record) => {
  const roles = [];
  const users = [];

  if (record.recipients && Array.isArray(record.recipients)) {
    record.recipients.forEach(r => {
      if (r.role) roles.push(r.role);
      if (r.user) users.push(r.user);
    });
  }

  return {
    id: record.id,
    locationId: record.locationId,
    locationName: record.location ? record.location.locationName : 'All Locations',
    moduleId: record.moduleId,
    moduleName: record.module?.moduleName || null,
    moduleCode: record.module?.moduleCode || null,
    statusId: record.statusId,
    statusName: record.status?.statusName || null,
    statusCode: record.status?.statusCode || null,
    stageCode: record.stageCode,
    allowedMinutes: record.allowedMinutes,
    notifyRoles: roles,
    notifyRoleIds: roles.map(r => r.id),
    notifyUsers: users,
    notifyUserIds: users.map(u => u.id),
    isActive: record.isActive,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
};

const buildWhere = ({ search, isActive, moduleId, statusId, locationId }) => {
  const where = {};

  if (typeof isActive === 'boolean') where.isActive = isActive;
  if (moduleId) where.moduleId = moduleId;
  if (statusId) where.statusId = statusId;
  if (locationId !== undefined) where.locationId = locationId;

  if (search) {
    where.OR = [
      { stageCode: { contains: search } },
      { module: { moduleName: { contains: search } } },
      { status: { statusName: { contains: search } } },
      { location: { locationName: { contains: search } } },
      { recipients: { some: { role: { name: { contains: search } } } } },
      { recipients: { some: { user: { fullName: { contains: search } } } } }
    ];
  }

  return where;
};

const ensureForeignKeys = async (data, notifyRoleIds = [], notifyUserIds = []) => {
  const [module, status, location] = await Promise.all([
    prisma.module.findUnique({ where: { id: data.moduleId }, select: { id: true } }),
    prisma.statusMaster.findFirst({
      where: { id: data.statusId, moduleId: data.moduleId },
      select: { id: true, statusCode: true }
    }),
    data.locationId
      ? prisma.location.findUnique({ where: { id: data.locationId }, select: { id: true } })
      : Promise.resolve(null)
  ]);

  if (!module) throw createHttpError(400, 'moduleId must reference an existing module');
  if (!status) throw createHttpError(400, 'statusId must reference a status belonging to selected moduleId');
  if (data.locationId && !location) throw createHttpError(400, 'locationId must reference an existing location');

  if (notifyRoleIds.length > 0) {
    const roles = await prisma.role.findMany({ where: { id: { in: notifyRoleIds } } });
    if (roles.length !== notifyRoleIds.length) {
      throw createHttpError(400, 'One or more notifyRoleIds are invalid');
    }
  }

  if (notifyUserIds.length > 0) {
    const users = await prisma.user.findMany({ where: { id: { in: notifyUserIds } } });
    if (users.length !== notifyUserIds.length) {
      throw createHttpError(400, 'One or more notifyUserIds are invalid');
    }
  }

  return status;
};

const ensureUniqueRule = async (data, excludeId) => {
  const existing = await prisma.stageTimeLimit.findFirst({
    where: {
      locationId: data.locationId,
      moduleId: data.moduleId,
      statusId: data.statusId,
      ...(excludeId ? { id: { not: excludeId } } : {})
    },
    select: { id: true }
  });

  if (existing) {
    throw createHttpError(409, 'Stage alert schedule already exists for this location, module, and status');
  }
};

const normalizePayload = (payload, actor, isUpdate = false) => {
  return {
    locationId: actor && actor.locationId ? Number(actor.locationId) : null,
    moduleId: Number(payload.moduleId),
    statusId: Number(payload.statusId),
    stageCode: String(payload.stageCode || '').trim(),
    allowedMinutes: Number(payload.allowedMinutes),
    isActive: typeof payload.isActive === 'boolean' ? payload.isActive : true,
    ...(isUpdate ? { modifiedById: actor?.userId || null } : { createdById: actor?.userId || null })
  };
};

const resolveScopedLocationId = (actor, requestedLocationId) => {
  if (actor && actor.locationId) {
    return Number(actor.locationId);
  }

  return requestedLocationId;
};

const ensureRecordInScope = (record, actor) => {
  if (actor && actor.locationId && record.locationId !== Number(actor.locationId)) {
    throw createHttpError(404, 'Stage alert schedule not found');
  }
};

const listStageTimeLimits = async (query, actor) => {
  const page = parsePositiveInt(query.page, 1);
  const limit = parsePositiveInt(query.limit, 10);
  const search = query.search ? String(query.search).trim() : undefined;
  const isActive = parseBooleanFilter(query.isActive);
  const moduleId = parsePositiveInt(query.moduleId, undefined);
  const statusId = parsePositiveInt(query.statusId, undefined);
  const requestedLocationId = query.locationId === 'null'
    ? null
    : query.locationId
      ? parsePositiveInt(query.locationId, undefined)
      : undefined;
  const locationId = resolveScopedLocationId(actor, requestedLocationId);

  const where = buildWhere({ search, isActive, moduleId, statusId, locationId });
  const skip = (page - 1) * limit;

  const [records, total] = await prisma.$transaction([
    prisma.stageTimeLimit.findMany({
      where,
      include: includeDisplayRelations,
      orderBy: [{ moduleId: 'asc' }, { statusId: 'asc' }, { locationId: 'asc' }, { id: 'asc' }],
      skip,
      take: limit
    }),
    prisma.stageTimeLimit.count({ where })
  ]);

  return {
    schedules: records.map(formatStageTimeLimit),
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
};

const getStageTimeLimit = async (id, actor) => {
  const record = await prisma.stageTimeLimit.findUnique({
    where: { id: Number(id) },
    include: includeDisplayRelations
  });

  if (!record) {
    throw createHttpError(404, 'Stage alert schedule not found');
  }

  ensureRecordInScope(record, actor);

  return formatStageTimeLimit(record);
};

const createStageTimeLimit = async (payload, actor) => {
  const data = normalizePayload(payload, actor);
  const notifyRoleIds = Array.isArray(payload.notifyRoleIds) ? payload.notifyRoleIds : [];
  const notifyUserIds = Array.isArray(payload.notifyUserIds) ? payload.notifyUserIds : [];
  
  const status = await ensureForeignKeys(data, notifyRoleIds, notifyUserIds);

  if (data.stageCode !== status.statusCode) {
    throw createHttpError(400, 'stageCode must match selected status code');
  }

  await ensureUniqueRule(data);

  return prisma.$transaction(async (tx) => {
    const recipientsToCreate = [];
    notifyRoleIds.forEach(id => recipientsToCreate.push({ roleId: id }));
    notifyUserIds.forEach(id => recipientsToCreate.push({ userId: id }));

    const record = await tx.stageTimeLimit.create({
      data: {
        ...data,
        recipients: {
          create: recipientsToCreate
        }
      },
      include: includeDisplayRelations
    });

    if (actor && actor.userId) {
      await createAuditLog(tx, {
        ...STAGE_SCHEDULE_AUDIT_MODULE,
        tableName: 'stage_time_limits',
        recordId: record.id,
        actionType: 'CREATE',
        performedByUserId: actor.userId,
        recordName: `Schedule for ${record.stageCode}`,
        comments: 'Stage schedule created',
        locationId: record.locationId,
        details: [
          { fieldName: 'stageCode', oldValue: null, newValue: record.stageCode, dataType: 'string' },
          { fieldName: 'allowedMinutes', oldValue: null, newValue: record.allowedMinutes, dataType: 'number' }
        ]
      });
    }

    return formatStageTimeLimit(record);
  });
};

const updateStageTimeLimit = async (id, payload, actor) => {
  const recordId = Number(id);
  await getStageTimeLimit(recordId, actor);

  const data = normalizePayload(payload, actor, true);
  const notifyRoleIds = Array.isArray(payload.notifyRoleIds) ? payload.notifyRoleIds : [];
  const notifyUserIds = Array.isArray(payload.notifyUserIds) ? payload.notifyUserIds : [];

  const status = await ensureForeignKeys(data, notifyRoleIds, notifyUserIds);

  if (data.stageCode !== status.statusCode) {
    throw createHttpError(400, 'stageCode must match selected status code');
  }

  await ensureUniqueRule(data, recordId);

  return prisma.$transaction(async (tx) => {
    const currentRecord = await tx.stageTimeLimit.findUnique({
      where: { id: recordId }
    });

    await tx.stageTimeLimitRecipient.deleteMany({
      where: { stageTimeLimitId: recordId }
    });

    const recipientsToCreate = [];
    notifyRoleIds.forEach(id => recipientsToCreate.push({ roleId: id }));
    notifyUserIds.forEach(id => recipientsToCreate.push({ userId: id }));

    const record = await tx.stageTimeLimit.update({
      where: { id: recordId },
      data: {
        ...data,
        recipients: {
          create: recipientsToCreate
        }
      },
      include: includeDisplayRelations
    });

    if (actor && actor.userId) {
      await createAuditLog(tx, {
        ...STAGE_SCHEDULE_AUDIT_MODULE,
        tableName: 'stage_time_limits',
        recordId: record.id,
        actionType: 'UPDATE',
        performedByUserId: actor.userId,
        recordName: `Schedule for ${record.stageCode}`,
        comments: 'Stage schedule updated',
        locationId: record.locationId,
        details: buildChangeDetails(currentRecord, record, ['locationId', 'moduleId', 'statusId', 'stageCode', 'allowedMinutes', 'isActive'])
      });
    }

    return formatStageTimeLimit(record);
  });
};

const updateStageTimeLimitStatus = async (id, { isActive }, actor) => {
  const recordId = Number(id);
  await getStageTimeLimit(recordId, actor);

  return prisma.$transaction(async (tx) => {
    const currentRecord = await tx.stageTimeLimit.findUnique({
      where: { id: recordId }
    });

    const record = await tx.stageTimeLimit.update({
      where: { id: recordId },
      data: {
        isActive,
        modifiedById: actor?.userId || null
      },
      include: includeDisplayRelations
    });

    if (actor && actor.userId) {
      await createAuditLog(tx, {
        ...STAGE_SCHEDULE_AUDIT_MODULE,
        tableName: 'stage_time_limits',
        recordId: record.id,
        actionType: isActive ? 'ACTIVATE' : 'DEACTIVATE',
        performedByUserId: actor.userId,
        recordName: `Schedule for ${record.stageCode}`,
        comments: isActive ? 'Stage schedule activated' : 'Stage schedule deactivated',
        locationId: record.locationId,
        details: buildChangeDetails(currentRecord, record, ['isActive'])
      });
    }

    return formatStageTimeLimit(record);
  });
};

module.exports = {
  listStageTimeLimits,
  getStageTimeLimit,
  createStageTimeLimit,
  updateStageTimeLimit,
  updateStageTimeLimitStatus
};
