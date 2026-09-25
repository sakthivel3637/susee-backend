const router = require('express').Router();

const controller = require('./queue.controller');
const { authenticate } = require('../../common/middleware/auth.middleware');
const { permissionMiddleware } = require('../../common/middleware/permission.middleware');
const { validateAssignmentIdParam, validateAssignPayload, validateJobCardIdParam, validateStatusPayload } = require('./queue.validation');

const canReadQueue = permissionMiddleware({ menuPaths: ['/assign-mechanic', '/body-shop-assign-mechanic'], action: 'canRead' });
const canUpdateJobCards = permissionMiddleware({ menuPaths: ['/assign-mechanic', '/job-cards', '/body-shop-assign-mechanic'], action: 'canUpdate' });

router.use(authenticate);

router.get('/mechanical/list', canReadQueue, controller.listMechanicalQueue);
router.get('/body-shop/list', canReadQueue, controller.listBodyShopQueue);
router.post('/assign/:jobCardId', canUpdateJobCards, validateJobCardIdParam, validateAssignPayload, controller.assignWork);
router.put('/reassign/:jobCardId', canUpdateJobCards, validateJobCardIdParam, validateAssignPayload, controller.reassignWork);
router.patch('/status/:assignmentId', canUpdateJobCards, validateAssignmentIdParam, validateStatusPayload, controller.updateAssignmentStatus);


module.exports = router;
