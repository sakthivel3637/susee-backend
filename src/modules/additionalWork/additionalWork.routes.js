const router = require('express').Router({ mergeParams: true });
const controller = require('./additionalWork.controller');
const { permissionMiddleware } = require('../../common/middleware/permission.middleware');

const additionalWorkMenuPaths = ['/additional-work', '/body-shop-additional-work'];
const canReadAdditionalWork = permissionMiddleware(additionalWorkMenuPaths, 'canRead');
const canCreateAdditionalWork = permissionMiddleware(additionalWorkMenuPaths, 'canCreate');

router.get('/context', canReadAdditionalWork, controller.getContext);
router.post('/request', canCreateAdditionalWork, controller.createRequest);

module.exports = router;
