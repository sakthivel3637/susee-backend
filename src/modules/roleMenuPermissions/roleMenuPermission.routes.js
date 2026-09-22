const router = require('express').Router({ mergeParams: true });

const roleMenuPermissionController = require('./roleMenuPermission.controller');
const { validateRoleIdParam, validateMenuIdParam, validatePermissionPayload } = require('./roleMenuPermission.validation');
const { authenticate } = require('../../common/middleware/auth.middleware');
const { permissionMiddleware } = require('../../common/middleware/permission.middleware');

const canReadRolePermissions = permissionMiddleware('/roles', 'canRead');
const canUpdateRolePermissions = permissionMiddleware('/roles', 'canUpdate');
const canDeleteRolePermissions = permissionMiddleware('/roles', 'canDelete');

router.use(authenticate);
router.use(validateRoleIdParam);

router.post('/save', canUpdateRolePermissions, validatePermissionPayload, roleMenuPermissionController.saveRoleMenuPermissions);
router.get('/list', canReadRolePermissions, roleMenuPermissionController.getRoleMenuPermissions);
router.put('/update', canUpdateRolePermissions, validatePermissionPayload, roleMenuPermissionController.updateRoleMenuPermissions);
router.delete('/delete/:menuId', canDeleteRolePermissions, validateMenuIdParam, roleMenuPermissionController.deleteRoleMenuPermission);

module.exports = router;
