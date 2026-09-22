const router = require('express').Router();

const categoryController = require('./service-category.controller');
const {
  validateIdParam,
  validateIdentifierParam,
  validateCategoryPayload,
  validateStatusPayload
} = require('./service-category.validation');
const { authenticate } = require('../../common/middleware/auth.middleware');
const { permissionMiddleware } = require('../../common/middleware/permission.middleware');

const canReadCategories = permissionMiddleware('/master-categories', 'canRead');
const canCreateCategories = permissionMiddleware('/master-categories', 'canCreate');
const canUpdateCategories = permissionMiddleware('/master-categories', 'canUpdate');

router.use(authenticate);

router.post('/create', canCreateCategories, validateCategoryPayload, categoryController.createCategory);
router.put('/update/:id', canUpdateCategories, validateIdentifierParam, validateCategoryPayload, categoryController.updateCategory);
router.get('/list', canReadCategories, categoryController.listCategories);
router.get('/detail/:id', canReadCategories, validateIdentifierParam, categoryController.getCategoryDetail);
router.patch('/status/:id', canUpdateCategories, validateIdParam, validateStatusPayload, categoryController.updateCategoryStatus);

const crmRouter = require('express').Router();
crmRouter.use(authenticate);
crmRouter.get('/list', canReadCategories, categoryController.listCategories);

module.exports = {
  serviceCategoryRoutes: router,
  crmServiceCategoryRoutes: crmRouter
};
