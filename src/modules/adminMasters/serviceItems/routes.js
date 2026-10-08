const multer = require('multer');
const { createAdminMasterRoutes } = require('../common');
const controller = require('./controller');
const validation = require('./validation');
const { permissionMiddleware } = require('../../../common/middleware/permission.middleware');

const upload = multer({ storage: multer.memoryStorage() });
const canCreate = permissionMiddleware({ menuPath: '/master-items', action: 'canCreate' });

const router = createAdminMasterRoutes({
  controller,
  validation,
  menuPath: '/master-items'
});

router.get('/export-template', canCreate, controller.downloadTemplate);
router.post('/import', canCreate, upload.single('file'), controller.importItems);

module.exports = router;

