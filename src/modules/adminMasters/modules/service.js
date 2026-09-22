const { createAdminMasterService } = require('../common');
const { generateUniqueCode, CODE_CONFIG } = require('../../../common/utils/code.util');
const prisma = require('../../../config/db');

const moduleSelect = {
  id: true,
  moduleName: true,
  moduleCode: true,
  slug: true,
  description: true,
  isActive: true,
  createdAt: true,
  updatedAt: true
};

const baseService = createAdminMasterService({
  model: 'module',
  identifierField: 'slug',
  tableName: 'modules',
  label: 'Module',
  select: moduleSelect,
  fields: [
    { name: 'moduleName', type: 'string', required: true },
    { name: 'moduleCode', type: 'string' },
    { name: 'description', type: 'string' },
    { name: 'isActive', type: 'boolean' }
  ],
  hasIsActive: true,
  slugFrom: 'moduleName',
  uniqueFields: [
    { fieldName: 'moduleName', label: 'Module name' },
    { fieldName: 'moduleCode', label: 'Module code' }
  ],
  searchFields: ['moduleName', 'moduleCode', 'description'],
  recordName: (mod) => mod.moduleName
});

const ensureModuleCanBeInactivated = async (moduleId, isActive) => {
  if (isActive !== false) {
    return;
  }

  const statusCount = await prisma.statusMaster.count({
    where: { moduleId }
  });

  if (statusCount > 0) {
    const error = new Error('Module is already mapped with statuses and cannot be inactivated');
    error.statusCode = 409;
    throw error;
  }
};

const resolveModuleId = async (identifier) => {
  const parsedId = Number(identifier);
  const isNumericId = Number.isInteger(parsedId) && parsedId > 0;

  if (isNumericId) {
    return parsedId;
  }

  const module = await prisma.module.findUnique({
    where: { slug: String(identifier).trim() },
    select: { id: true }
  });

  return module ? module.id : parsedId;
};

const createRecord = async (payload, actorUserId) => {
  if (!payload.moduleCode) {
    const latestModule = await prisma.module.findFirst({
      orderBy: { id: 'desc' },
      select: { moduleCode: true }
    });
    
    payload.moduleCode = await generateUniqueCode({
      prefix: CODE_CONFIG.module.prefix,
      latestCode: latestModule?.moduleCode,
      existsCallback: async (code) => {
        const existing = await prisma.module.findFirst({ where: { moduleCode: code }, select: { id: true } });
        return !!existing;
      }
    });
  }
  return baseService.createRecord(payload, actorUserId);
};

const updateRecord = async (id, payload, actorUserId) => {
  if (payload.isActive !== undefined) {
    await ensureModuleCanBeInactivated(await resolveModuleId(id), payload.isActive);
  }
  return baseService.updateRecord(id, payload, actorUserId);
};

const updateStatus = async (id, payload, actorUserId) => {
  await ensureModuleCanBeInactivated(Number(id), payload.isActive);
  return baseService.updateStatus(id, payload, actorUserId);
};

module.exports = {
  ...baseService,
  createRecord,
  updateRecord,
  updateStatus
};
