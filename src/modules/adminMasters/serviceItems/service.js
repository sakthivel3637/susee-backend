const {
  createAdminMasterService,
  ensureForeignKey,
  ensureUniqueComposite
} = require('../common');

const serviceItemSelect = {
  id: true,
  categoryId: true,
  name: true,
  slug: true,
  description: true,
  defaultPrice: true,
  estimatedMinutes: true,
  isActive: true,
  createdById: true,
  modifiedById: true,
  createdAt: true,
  updatedAt: true,
  category: {
    select: {
      id: true,
      name: true,
      slug: true
    }
  }
};

module.exports = createAdminMasterService({
  model: 'serviceItem',
  identifierField: 'slug',
  tableName: 'service_items',
  label: 'Service item',
  select: serviceItemSelect,
  fields: [
    { name: 'categoryId', type: 'int', required: true },
    { name: 'name', type: 'string', required: true },
    { name: 'description', type: 'string' },
    { name: 'defaultPrice', type: 'decimal', required: true },
    { name: 'estimatedMinutes', type: 'optionalInt' },
    { name: 'isActive', type: 'boolean' }
  ],
  hasIsActive: true,
  hasCreatedById: true,
  hasModifiedById: true,
  slugFrom: 'name',
  searchFields: ['name', 'slug', 'description', 'category.name'],
  filterFields: ['categoryId'],
  validateRelations: async (data) => {
    await ensureForeignKey({ model: 'serviceCategory', id: data.categoryId, label: 'categoryId' });
  },
  validateUnique: async (data, excludeId) => {
    await ensureUniqueComposite({
      model: 'serviceItem',
      fields: {
        categoryId: data.categoryId,
        name: data.name
      },
      label: 'Service Item Name under this Category Group',
      excludeId
    });
  },
  recordName: (serviceItem) => serviceItem.name
});

