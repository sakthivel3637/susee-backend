const { createAdminMasterRoutes } = require('../common');
const controller = require('./controller');
const validation = require('./validation');

module.exports = createAdminMasterRoutes({
  controller,
  validation,
  menuPath: '/master-items'
});
