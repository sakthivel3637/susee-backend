const { createAdminMasterService } = require('../common');
const { generateUniqueCode, CODE_CONFIG } = require('../../../common/utils/code.util');
const prisma = require('../../../config/db');

const stateSelect = {
  id: true,
  stateName: true,
  stateCode: true,
  slug: true,
  isActive: true,
  createdAt: true,
  updatedAt: true
};

const baseService = createAdminMasterService({
  model: 'state',
  identifierField: 'slug',
  tableName: 'states',
  label: 'State',
  select: stateSelect,
  fields: [
    { name: 'stateName', type: 'string', required: true },
    { name: 'stateCode', type: 'string' },
    { name: 'isActive', type: 'boolean' }
  ],
  hasIsActive: true,
  slugFrom: 'stateName',
  uniqueFields: [
    { fieldName: 'stateName', label: 'State name' },
    { fieldName: 'stateCode', label: 'State code' }
  ],
  searchFields: ['stateName', 'stateCode'],
  recordName: (state) => state.stateName
});

const ensureStateCanBeInactivated = async (stateId, isActive) => {
  if (isActive !== false) {
    return;
  }

  const districtCount = await prisma.district.count({
    where: { stateId }
  });

  if (districtCount > 0) {
    const error = new Error('State is already mapped with district and cannot be inactivated');
    error.statusCode = 409;
    throw error;
  }
};

const resolveStateId = async (identifier) => {
  const parsedId = Number(identifier);
  const isNumericId = Number.isInteger(parsedId) && parsedId > 0;

  if (isNumericId) {
    return parsedId;
  }

  const state = await prisma.state.findUnique({
    where: { slug: String(identifier).trim() },
    select: { id: true }
  });

  return state ? state.id : parsedId;
};

const createRecord = async (payload, actorUserId) => {
  if (!payload.stateCode) {
    const latestState = await prisma.state.findFirst({
      orderBy: { id: 'desc' },
      select: { stateCode: true }
    });
    
    payload.stateCode = await generateUniqueCode({
      prefix: CODE_CONFIG.state.prefix,
      latestCode: latestState?.stateCode,
      existsCallback: async (code) => {
        const existing = await prisma.state.findFirst({ where: { stateCode: code }, select: { id: true } });
        return !!existing;
      }
    });
  }
  return baseService.createRecord(payload, actorUserId);
};

const updateRecord = async (id, payload, actorUserId) => {
  await ensureStateCanBeInactivated(await resolveStateId(id), payload.isActive);
  return baseService.updateRecord(id, payload, actorUserId);
};

const updateStatus = async (id, payload, actorUserId) => {
  await ensureStateCanBeInactivated(Number(id), payload.isActive);
  return baseService.updateStatus(id, payload, actorUserId);
};

module.exports = {
  ...baseService,
  createRecord,
  updateRecord,
  updateStatus
};
