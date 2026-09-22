const { createAdminMasterService, ensureUniqueComposite } = require('../common');

const statusMasterService = createAdminMasterService({
  model: 'statusMaster',
  tableName: 'status_master',
  label: 'Status Master',
  autoGenerateCode: true,
  codeConfig: { field: 'statusCode', prefix: 'STAT' },
  relations: [
    { fieldName: 'moduleId', model: 'module', label: 'Module' }
  ],
  uniqueFields: [
    { fieldName: 'statusCode', label: 'Status Code' }
  ],
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
  },
  select: {
    id: true,
    moduleId: true,
    statusCode: true,
    statusName: true,
    description: true,
    sortOrder: true,
    isFinal: true,
    isActive: true,
    createdAt: true,
    updatedAt: true,
    module: {
      select: {
        moduleName: true
      }
    }
  },
  searchFields: ['statusName', 'statusCode', 'description'],
  fields: [
    { name: 'moduleId', type: 'int', required: true },
    { name: 'statusName', type: 'string', required: true },
    { name: 'description', type: 'string' },
    { name: 'sortOrder', type: 'int' },
    { name: 'isFinal', type: 'boolean' },
    { name: 'isActive', type: 'boolean' }
  ],
  recordName: (status) => status.statusName
});

module.exports = statusMasterService;
