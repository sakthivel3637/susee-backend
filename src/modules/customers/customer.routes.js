const router = require('express').Router();

const customerController = require('./customer.controller');
const { validateIdParam, validateCustomerPayload, validateStatusPayload } = require('./customer.validation');
const { authenticate } = require('../../common/middleware/auth.middleware');
const { permissionMiddleware } = require('../../common/middleware/permission.middleware');

const canReadCustomers = permissionMiddleware('/customers', 'canRead');
const canUpdateCustomers = permissionMiddleware('/customers', 'canUpdate');

router.use(authenticate);

router.get('/list', canReadCustomers, customerController.getCustomers);
router.get('/detail/:id', canReadCustomers, validateIdParam, customerController.getCustomer);
router.put('/update/:id', canUpdateCustomers, validateIdParam, validateCustomerPayload, customerController.updateCustomer);
router.patch('/status/:id', canUpdateCustomers, validateIdParam, validateStatusPayload, customerController.updateCustomerStatus);

module.exports = router;
