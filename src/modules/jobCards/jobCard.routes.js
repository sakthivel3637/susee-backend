const router = require('express').Router();
const jobCardController = require('./jobCard.controller');
const additionalWorkRoutes = require('../additionalWork/additionalWork.routes');
const additionalWorkController = require('../additionalWork/additionalWork.controller');
const { authenticate } = require('../../common/middleware/auth.middleware');
const { permissionMiddleware } = require('../../common/middleware/permission.middleware');

const canReadJobCards = permissionMiddleware('/job-cards', 'canRead');
const canUpdateJobCards = permissionMiddleware('/job-cards', 'canUpdate');
const canReadAdditionalWork = permissionMiddleware(['/additional-work', '/body-shop-additional-work'], 'canRead');

router.use(authenticate);

router.get('/list', canReadJobCards, jobCardController.getJobCards);
router.get('/additional-work/list', canReadAdditionalWork, additionalWorkController.listRequests);
router.get('/statuses/list', canReadJobCards, jobCardController.getJobCardStatuses);
router.get('/service-statuses/list', canReadJobCards, jobCardController.getJobCardServiceStatuses);
router.get('/detail/:id', canReadJobCards, jobCardController.getJobCard);
router.post('/:id/services/:serviceId/postpone', canUpdateJobCards, jobCardController.postponeService);
router.post('/:id/services/:serviceId/resume', canUpdateJobCards, jobCardController.resumeService);
router.post('/:id/departments/:department/skip', canUpdateJobCards, jobCardController.skipDepartment);
router.put('/update/:id', canUpdateJobCards, jobCardController.updateJobCard);
router.use('/:jobCardId/additional-work', additionalWorkRoutes);

module.exports = router;
