const router = require('express').Router();

const controller = require('./queue.controller');
const { authenticate } = require('../../common/middleware/auth.middleware');
const { permissionMiddleware } = require('../../common/middleware/permission.middleware');
const { validateAssignmentIdParam, validateAssignPayload, validateJobCardIdParam, validateStatusPayload } = require('./queue.validation');

const canReadMechanicalQueue = permissionMiddleware('/assign-mechanic', 'canRead');
const canReadBodyShopQueue = permissionMiddleware('/body-shop-assign-mechanic', 'canRead');
const canReadWaterWashQueue = permissionMiddleware('/water-wash-assign-member', 'canRead');
const canUpdateJobCards = permissionMiddleware('/job-cards', 'canUpdate');

router.use(authenticate);

router.get('/mechanical/list', canReadMechanicalQueue, controller.listMechanicalQueue);
router.get('/body-shop/list', canReadBodyShopQueue, controller.listBodyShopQueue);
router.get('/water-wash/list', canReadWaterWashQueue, controller.listWaterWashQueue);
router.post('/assign/:jobCardId', canUpdateJobCards, validateJobCardIdParam, validateAssignPayload, controller.assignWork);
router.put('/reassign/:jobCardId', canUpdateJobCards, validateJobCardIdParam, validateAssignPayload, controller.reassignWork);
router.patch('/status/:assignmentId', canUpdateJobCards, validateAssignmentIdParam, validateStatusPayload, controller.updateAssignmentStatus);


module.exports = router;
