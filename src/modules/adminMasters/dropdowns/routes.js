const router = require('express').Router();

const controller = require('./controller');
const { validateOptionalPositiveInt, validateOptionalModuleCode } = require('./validation');
const { authMiddleware } = require('../../../common/middleware/auth.middleware');
const { permissionMiddleware } = require('../../../common/middleware/permission.middleware');

const canRead = permissionMiddleware({ menuPath: '/admin-dashboard', action: 'canRead' });

router.use(authMiddleware);

router.get('/states', controller.states);
router.get('/districts', validateOptionalPositiveInt('stateId'), controller.districts);
router.get('/service-categories', controller.serviceCategories);
router.get('/service-items', validateOptionalPositiveInt('categoryId'), controller.serviceItems);
router.get('/service-centers', controller.serviceCenters);
router.get('/locations', validateOptionalPositiveInt('serviceCenterId'), controller.locations);
router.get('/statuses', validateOptionalModuleCode, controller.statuses);

module.exports = router;
