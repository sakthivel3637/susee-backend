const { createAdminMasterService, ensureForeignKey, ensureUniqueComposite } = require('../common');
const prisma = require('../../../config/db');

const districtSelect = {
  id: true,
  stateId: true,
  districtName: true,
  slug: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  state: {
    select: {
      id: true,
      stateName: true,
      stateCode: true,
      slug: true
    }
  }
};

const baseService = createAdminMasterService({
  model: 'district',
  identifierField: 'slug',
  tableName: 'districts',
  label: 'District',
  select: districtSelect,
  fields: [
    { name: 'stateId', type: 'int', required: true },
    { name: 'districtName', type: 'string', required: true },
    { name: 'isActive', type: 'boolean' }
  ],
  hasIsActive: true,
  slugFrom: 'districtName',
  searchFields: ['districtName', 'state.stateName'],
  filterFields: ['stateId'],
  validateRelations: async (data) => {
    await ensureForeignKey({ model: 'state', id: data.stateId, label: 'stateId' });
  },
  validateUnique: async (data, excludeId) => {
    await ensureUniqueComposite({
      model: 'district',
      fields: {
        stateId: data.stateId,
        districtName: data.districtName
      },
      label: 'District name',
      excludeId
    });
  },
  recordName: (district) => district.districtName
});

const ensureDistrictCanBeInactivated = async (districtId, isActive) => {
  if (isActive !== false) {
    return;
  }

  const locationCount = await prisma.location.count({
    where: { districtId }
  });

  if (locationCount > 0) {
    const error = new Error('District is already mapped with location and cannot be inactivated');
    error.statusCode = 409;
    throw error;
  }
};

const updateRecord = async (id, payload, actorUserId) => {
  await ensureDistrictCanBeInactivated(Number(id), payload.isActive);
  return baseService.updateRecord(id, payload, actorUserId);
};

const updateStatus = async (id, payload, actorUserId) => {
  await ensureDistrictCanBeInactivated(Number(id), payload.isActive);
  return baseService.updateStatus(id, payload, actorUserId);
};

module.exports = {
  ...baseService,
  updateRecord,
  updateStatus
};
