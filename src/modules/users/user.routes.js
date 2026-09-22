const router = require('express').Router();

const userController = require('./user.controller');
const { validateIdParam, validateUserPayload, validatePasswordPayload, validateStatusPayload } = require('./user.validation');
const { authenticate } = require('../../common/middleware/auth.middleware');
const { permissionMiddleware } = require('../../common/middleware/permission.middleware');

const canReadUsers = permissionMiddleware('/users', 'canRead');
const canCreateUsers = permissionMiddleware('/users', 'canCreate');
const canUpdateUsers = permissionMiddleware('/users', 'canUpdate');

router.use(authenticate);

router.post('/create', canCreateUsers, validateUserPayload(), userController.createUser);
router.put('/update/:id', canUpdateUsers, validateIdParam, validateUserPayload(), userController.updateUser);
router.get('/mechanics/dropdown',userController.listMechanicDropdown);
router.get('/list', canReadUsers, userController.listUsers);
router.get('/detail/:id', canReadUsers, validateIdParam, userController.getUserDetail);
router.patch('/status/:id', canUpdateUsers, validateIdParam, validateStatusPayload, userController.updateUserStatus);
router.patch('/reset-password/:id', canUpdateUsers, validateIdParam, validatePasswordPayload, userController.resetUserPassword);

module.exports = router;
