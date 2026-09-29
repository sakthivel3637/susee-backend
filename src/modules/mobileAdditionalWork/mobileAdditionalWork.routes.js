const router = require('express').Router();
const controller = require('./mobileAdditionalWork.controller');
const { authMiddleware } = require('../../common/middleware/auth.middleware');

router.use(authMiddleware);

router.get('/list', controller.getList);

module.exports = router;
