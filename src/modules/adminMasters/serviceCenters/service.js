const { createAdminMasterService } = require('../common');
const prisma = require('../../../config/db');

const serviceCenterSelect = {
  id: true,
  serviceCenterCode: true,
  serviceCenterName: true,
  gstNumber: true,
  contactPhone: true,
  contactEmail: true,
  logoUrl: true,
  websiteUrl: true,
  tax: true,
  isActive: true,
  createdById: true,
  modifiedById: true,
  createdAt: true,
  updatedAt: true
};

const baseService = createAdminMasterService({
  model: 'serviceCenter',
  tableName: 'service_centers',
  label: 'Service center',
  select: serviceCenterSelect,
  fields: [
    { name: 'serviceCenterCode', type: 'string' },
    { name: 'serviceCenterName', type: 'string', required: true },
    { name: 'gstNumber', type: 'string', required: true },
    { name: 'contactPhone', type: 'string' },
    { name: 'contactEmail', type: 'string' },
    { name: 'logoUrl', type: 'string' },
    { name: 'websiteUrl', type: 'string' },
    { name: 'tax', type: 'string', required: true },
    { name: 'isActive', type: 'boolean' }
  ],
  hasIsActive: true,
  hasCreatedById: true,
  hasModifiedById: true,
  autoGenerateCode: true,
  uniqueFields: [
    { fieldName: 'serviceCenterCode', label: 'Service center code' },
    { fieldName: 'contactPhone', label: 'Contact number' },
    { fieldName: 'contactEmail', label: 'Email address' }
  ],
  searchFields: ['serviceCenterName', 'serviceCenterCode', 'contactPhone', 'contactEmail'],
  recordName: (serviceCenter) => serviceCenter.serviceCenterName
});

const ensureServiceCenterCanBeInactivated = async (serviceCenterId, isActive) => {
  if (isActive !== false) {
    return;
  }

  const locationCount = await prisma.location.count({
    where: { serviceCenterId }
  });

  if (locationCount > 0) {
    const error = new Error('Service center is already mapped with locations and cannot be inactivated');
    error.statusCode = 409;
    throw error;
  }
};

const updateRecord = async (id, payload, actorUserId) => {
  await ensureServiceCenterCanBeInactivated(Number(id), payload.isActive);
  return baseService.updateRecord(id, payload, actorUserId);
};

const updateStatus = async (id, payload, actorUserId) => {
  await ensureServiceCenterCanBeInactivated(Number(id), payload.isActive);
  return baseService.updateStatus(id, payload, actorUserId);
};

module.exports = {
  ...baseService,
  updateRecord,
  updateStatus
};
