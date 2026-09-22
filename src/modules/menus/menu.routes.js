const router = require('express').Router();

const menuController = require('./menu.controller');
const { authenticate } = require('../../common/middleware/auth.middleware');
const { permissionMiddleware } = require('../../common/middleware/permission.middleware');

const canReadRoleMenus = permissionMiddleware('/roles', 'canRead');

router.use(authenticate);
router.use(canReadRoleMenus);

router.get('/list', menuController.listMenus);
router.get('/modules/list', menuController.listMenuModules);
router.get('/list-by-module/:module', menuController.listMenusByModule);

module.exports = router;
