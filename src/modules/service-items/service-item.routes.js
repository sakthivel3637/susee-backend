const router = require('express').Router();

const serviceItemController = require('./service-item.controller');
const { validateIdParam, validateIdentifierParam, validateServiceItemPayload, validateStatusPayload } = require('./service-item.validation');
const { authenticate } = require('../../common/middleware/auth.middleware');
const { permissionMiddleware } = require('../../common/middleware/permission.middleware');

const canReadItems = permissionMiddleware('/master-items', 'canRead');
const canCreateItems = permissionMiddleware('/master-items', 'canCreate');
const canUpdateItems = permissionMiddleware('/master-items', 'canUpdate');

router.use(authenticate);

router.post('/create', canCreateItems, validateServiceItemPayload, serviceItemController.createServiceItem);
router.put('/update/:id', canUpdateItems, validateIdentifierParam, validateServiceItemPayload, serviceItemController.updateServiceItem);
router.get('/list', canReadItems, serviceItemController.listServiceItems);
router.get('/detail/:id', canReadItems, validateIdentifierParam, serviceItemController.getServiceItemDetail);
router.patch('/status/:id', canUpdateItems, validateIdParam, validateStatusPayload, serviceItemController.updateServiceItemStatus);

const crmRouter = require('express').Router();
crmRouter.use(authenticate);
crmRouter.get('/list', serviceItemController.listServiceItems);

module.exports = {
  serviceItemRoutes: router,
  crmServiceItemRoutes: crmRouter
};
