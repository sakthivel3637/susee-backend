const { createAdminMasterService } = require('../common');
const prisma = require('../../../config/db');

const serviceCategorySelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  isActive: true,
  createdById: true,
  modifiedById: true,
  createdAt: true,
  updatedAt: true
};

const baseService = createAdminMasterService({
  model: 'serviceCategory',
  identifierField: 'slug',
  tableName: 'service_categories',
  label: 'Service category',
  select: serviceCategorySelect,
  fields: [
    { name: 'name', type: 'string', required: true },
    { name: 'description', type: 'string' },
    { name: 'isActive', type: 'boolean' }
  ],
  hasIsActive: true,
  hasCreatedById: true,
  hasModifiedById: true,
  slugFrom: 'name',
  uniqueFields: [
    { fieldName: 'name', label: 'Category name' }
  ],
  searchFields: ['name', 'slug', 'description'],
  recordName: (category) => category.name
});

const ensureServiceCategoryCanBeInactivated = async (categoryId, isActive) => {
  if (isActive !== false) {
    return;
  }

  const itemCount = await prisma.serviceItem.count({
    where: { categoryId }
  });

  if (itemCount > 0) {
    const error = new Error('Service category is already mapped with service items and cannot be inactivated');
    error.statusCode = 409;
    throw error;
  }
};

const updateRecord = async (id, payload, actorUserId) => {
  await ensureServiceCategoryCanBeInactivated(Number(id), payload.isActive);
  return baseService.updateRecord(id, payload, actorUserId);
};

const updateStatus = async (id, payload, actorUserId) => {
  await ensureServiceCategoryCanBeInactivated(Number(id), payload.isActive);
  return baseService.updateStatus(id, payload, actorUserId);
};

module.exports = {
  ...baseService,
  updateRecord,
  updateStatus
};
