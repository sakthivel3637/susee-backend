const { createAdminMasterController } = require('../common');
const service = require('./service');

module.exports = createAdminMasterController(service, 'serviceCenter', 'Service center', 'serviceCenters');
