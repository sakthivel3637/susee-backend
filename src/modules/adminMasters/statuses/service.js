const {
  createAdminMasterService,
  ensureForeignKey,
  ensureUniqueComposite
} = require('../common');
const prisma = require('../../../config/db');
const { generateUniqueCode } = require('../../../common/utils/code.util');

const statusSelect = {
  id: true,
  moduleId: true,
  statusCode: true,
  statusName: true,
  slug: true,
  description: true,
  sortOrder: true,
  isFinal: true,
  isActive: true,
  createdById: true,
  modifiedById: true,
  createdAt: true,
  updatedAt: true,
  module: {
    select: {
      id: true,
      moduleName: true,
      moduleCode: true,
      slug: true
    }
  }
};

const baseService = createAdminMasterService({
  model: 'statusMaster',
  identifierField: 'slug',
  tableName: 'status_master',
  label: 'Status',
  select: statusSelect,
  fields: [
    { name: 'moduleId', type: 'int', required: true },
    { name: 'statusCode', type: 'string' },
    { name: 'statusName', type: 'string', required: true },
    { name: 'description', type: 'string' },
    { name: 'sortOrder', type: 'int' },
    { name: 'isFinal', type: 'boolean' },
    { name: 'isActive', type: 'boolean' }
  ],
  hasIsActive: true,
  hasCreatedById: true,
  hasModifiedById: true,
  slugFrom: 'statusName',
  searchFields: ['statusName', 'slug', 'statusCode', 'description', 'module.moduleName'],
  filterFields: ['moduleId'],
  orderBy: [
    { moduleId: 'asc' },
    { sortOrder: 'asc' },
    { id: 'asc' }
  ],
  validateRelations: async (data) => {
    await ensureForeignKey({ model: 'module', id: data.moduleId, label: 'moduleId' });
  },
  validateUnique: async (data, excludeId) => {
    await ensureUniqueComposite({
      model: 'statusMaster',
      fields: {
        moduleId: data.moduleId,
        statusName: data.statusName
      },
      label: 'Status name',
      excludeId
    });

    if (data.statusCode) {
      await ensureUniqueComposite({
        model: 'statusMaster',
        fields: {
          moduleId: data.moduleId,
          statusCode: data.statusCode
        },
        label: 'Status code',
        excludeId
      });
    }
  },
  recordName: (status) => status.statusName
});

const generateStatusCode = async () => {
  const latestStatus = await prisma.statusMaster.findFirst({
    where: {
      statusCode: { startsWith: 'STS' }
    },
    orderBy: { id: 'desc' },
    select: { statusCode: true }
  });

  return generateUniqueCode({
    prefix: 'STS',
    latestCode: latestStatus?.statusCode,
    existsCallback: async (code) => {
      const existing = await prisma.statusMaster.findFirst({
        where: { statusCode: code },
        select: { id: true }
      });
      return !!existing;
    }
  });
};

const createRecord = async (payload, actorUserId) => {
  const nextPayload = { ...payload };

  if (!nextPayload.statusCode) {
    nextPayload.statusCode = await generateStatusCode();
  }

  return baseService.createRecord(nextPayload, actorUserId);
};

module.exports = {
  ...baseService,
  createRecord
};
