const router = require('express').Router();
const controller = require('./mobileAssignMechanic.controller');
const { authenticate } = require('../../common/middleware/auth.middleware');

router.use(authenticate);

router.get('/list', controller.getMobileList);
router.post('/assign/:jobCardId', controller.assignWork);
router.post('/skip/:jobCardId/:department', controller.skipDepartment);

module.exports = router;
