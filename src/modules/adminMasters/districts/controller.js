const { createAdminMasterController } = require('../common');
const service = require('./service');

module.exports = createAdminMasterController(service, 'district', 'District');
