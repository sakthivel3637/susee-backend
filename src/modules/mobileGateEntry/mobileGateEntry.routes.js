const router = require('express').Router();

const controller = require('./mobileGateEntry.controller');
const { validateCreateGateEntryPayload, validateIdParam, validateRegistrationQuery } = require('./mobileGateEntry.validation');
const { authMiddleware } = require('../../common/middleware/auth.middleware');
const { permissionMiddleware } = require('../../common/middleware/permission.middleware');

const canReadGateEntries = permissionMiddleware('/gate-entry', 'canRead');
const canCreateGateEntries = permissionMiddleware('/gate-entry', 'canCreate');
const canUpdateGateEntries = permissionMiddleware('/gate-entry', 'canUpdate');
const canReadJobCards = permissionMiddleware('/job-cards', 'canRead');

router.use(authMiddleware);

router.get('/check-vehicle', canReadGateEntries, validateRegistrationQuery, controller.checkVehicle);
router.get('/history', canReadGateEntries, controller.history);
router.get('/active', canReadGateEntries, validateRegistrationQuery, controller.activeByVehicle);
router.post('/', canCreateGateEntries, validateCreateGateEntryPayload, controller.createGateEntry);
router.put('/exit/:id', canUpdateGateEntries, validateIdParam, controller.submitExit);

const crmRouter = require('express').Router();
crmRouter.use(authMiddleware);
crmRouter.get('/pending', canReadJobCards, controller.pendingCrmEntries);

module.exports = {
  mobileGateEntryRoutes: router,
  crmGateEntryRoutes: crmRouter
};
