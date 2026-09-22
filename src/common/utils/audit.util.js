const crypto = require('crypto');
const { generateSlug, generateUniqueSlug } = require('./slug.util');

const serializeAuditValue = (value) => {
  if (value === undefined || value === null) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
};

const ensureAuditModule = async (
  tx,
  {
    moduleCode,
    moduleName,
    description = null,
    actorUserId = null
  }
) => {
  const normalizedModuleCode = String(moduleCode || '').trim();
  const normalizedModuleName = String(moduleName || normalizedModuleCode).trim();

  if (!normalizedModuleCode) {
    throw new Error('moduleCode is required for ensureAuditModule');
  }

  const existingModule = await tx.module.findUnique({
    where: { moduleCode: normalizedModuleCode },
    select: { id: true, moduleCode: true, moduleName: true, slug: true }
  });

  if (existingModule) {
    return existingModule;
  }

  const baseSlug = generateSlug(normalizedModuleCode || normalizedModuleName);
  const slug = await generateUniqueSlug(baseSlug, (candidateSlug) => {
    return tx.module.findFirst({
      where: { slug: candidateSlug },
      select: { id: true }
    });
  });

  return tx.module.create({
    data: {
      moduleCode: normalizedModuleCode,
      moduleName: normalizedModuleName,
      slug,
      description,
      createdById: actorUserId || null
    },
    select: { id: true, moduleCode: true, moduleName: true, slug: true }
  });
};

const createAuditLog = async (
  tx,
  {
    tableName,
    recordId,
    actionType,
    performedByUserId,
    recordName,
    comments,
    details = [],
    locationId = null
  }
) => {
  const data = {
    tableName,
    recordId: BigInt(recordId),
    actionType,
    recordName: recordName || null,
    transactionId: crypto.randomUUID(),
    comments: comments || null
  };

  if (performedByUserId) {
    data.performedBy = { connect: { id: performedByUserId } };
  } else {
    throw new Error('performedByUserId is required for createAuditLog');
  }

  if (locationId) {
    data.location = { connect: { id: locationId } };
  }

  if (details.length > 0) {
    data.details = {
      create: details.map((detail) => ({
        fieldName: detail.fieldName,
        oldValue: serializeAuditValue(detail.oldValue),
        newValue: serializeAuditValue(detail.newValue),
        dataType: detail.dataType || null
      }))
    };
  }

  return tx.auditLog.create({ data });
};

const buildChangeDetails = (oldRecord, newRecord, fields) => {
  return fields
    .filter((fieldName) => {
      // Ignore system fields
      if (['id', 'modifiedById', 'createdById', 'createdAt', 'updatedAt', 'passwordHash', 'deletedAt'].includes(fieldName)) {
        return false;
      }

      const oldVal = oldRecord[fieldName];
      const newVal = newRecord[fieldName];
      
      // If both are falsy (null, undefined, ''), treat as unchanged
      if (!oldVal && !newVal) return false;

      // Handle Dates
      if (oldVal instanceof Date || newVal instanceof Date) {
        const oldTime = oldVal ? new Date(oldVal).getTime() : 0;
        const newTime = newVal ? new Date(newVal).getTime() : 0;
        return oldTime !== newTime;
      }

      // Handle objects/arrays (including Prisma Decimal or JSON)
      if (typeof oldVal === 'object' || typeof newVal === 'object') {
        return JSON.stringify(oldVal) !== JSON.stringify(newVal);
      }

      // Robust primitive comparison
      return String(oldVal) !== String(newVal);
    })
    .map((fieldName) => ({
      fieldName,
      oldValue: oldRecord[fieldName],
      newValue: newRecord[fieldName],
      dataType: typeof newRecord[fieldName]
    }));
};

module.exports = {
  ensureAuditModule,
  createAuditLog,
  buildChangeDetails
};
