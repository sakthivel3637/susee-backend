const router = require('express').Router();

const controller = require('./stageTimeLimit.controller');
const validation = require('./stageTimeLimit.validation');
const { authenticate } = require('../../common/middleware/auth.middleware');
const { permissionMiddleware } = require('../../common/middleware/permission.middleware');

const canRead = permissionMiddleware('/md-stage-schedules', 'canRead');
const canCreate = permissionMiddleware('/md-stage-schedules', 'canCreate');
const canUpdate = permissionMiddleware('/md-stage-schedules', 'canUpdate');

router.use(authenticate);

router.post('/create', canCreate, validation.validatePayload, controller.create);
router.put('/update/:id', canUpdate, validation.validateIdParam, validation.validatePayload, controller.update);
router.get('/list', canRead, controller.list);
router.get('/detail/:id', canRead, validation.validateIdParam, controller.detail);
router.patch('/status/:id', canUpdate, validation.validateIdParam, validation.validateStatusPayload, controller.status);

module.exports = router;
