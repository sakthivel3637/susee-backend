const { createAdminMasterController } = require('../common');
const statusMasterService = require('./service');

const statusMasterController = createAdminMasterController(
  statusMasterService,
  'statusMaster',
  'Status Master',
  'statusMasters'
);

module.exports = statusMasterController;
