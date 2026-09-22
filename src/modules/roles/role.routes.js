const router = require('express').Router();

const roleController = require('./role.controller');
const { validateIdParam, validateRolePayload, validateStatusPayload } = require('./role.validation');
const { authenticate } = require('../../common/middleware/auth.middleware');
const { permissionMiddleware } = require('../../common/middleware/permission.middleware');

const canReadRoles = permissionMiddleware('/roles', 'canRead');
const canCreateRoles = permissionMiddleware('/roles', 'canCreate');
const canUpdateRoles = permissionMiddleware('/roles', 'canUpdate');
const canReadRolesOrUsers = permissionMiddleware({ menuPaths: ['/roles', '/users'], action: 'canRead' });

router.use(authenticate);

router.post('/create', canCreateRoles, validateRolePayload, roleController.createRole);
router.put('/update/:id', canUpdateRoles, validateIdParam, validateRolePayload, roleController.updateRole);
router.get('/list', canReadRolesOrUsers, roleController.listRoles);
router.get('/detail/:id', canReadRoles, validateIdParam, roleController.getRoleDetail);
router.patch('/status/:id', canUpdateRoles, validateIdParam, validateStatusPayload, roleController.updateRoleStatus);

module.exports = router;
