const router = require('express').Router();

const brandController = require('./brand.controller');
const {
  validateIdParam,
  validateIdentifierParam,
  validateBrandPayload,
  validateStatusPayload
} = require('./brand.validation');
const { authenticate } = require('../../common/middleware/auth.middleware');
const { permissionMiddleware } = require('../../common/middleware/permission.middleware');

const canReadBrands = permissionMiddleware('/master-brands', 'canRead');
const canCreateBrands = permissionMiddleware('/master-brands', 'canCreate');
const canUpdateBrands = permissionMiddleware('/master-brands', 'canUpdate');

router.use(authenticate);

router.get('/dropdown', brandController.getBrandDropdown);
router.post('/create', canCreateBrands, validateBrandPayload, brandController.createBrand);
router.put('/update/:id', canUpdateBrands, validateIdentifierParam, validateBrandPayload, brandController.updateBrand);
router.get('/list', canReadBrands, brandController.listBrands);
router.patch('/status/:id', canUpdateBrands, validateIdParam, validateStatusPayload, brandController.updateBrandStatus);

const crmRouter = require('express').Router();
crmRouter.use(authenticate);
crmRouter.get('/list', brandController.listBrands);

module.exports = {
  brandRoutes: router,
  crmBrandRoutes: crmRouter
};
