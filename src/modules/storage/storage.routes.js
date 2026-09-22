const router = require('express').Router();
const storageController = require('./storage.controller');
const { authenticate } = require('../../common/middleware/auth.middleware');

router.use(authenticate);

router.get('/sas-url', storageController.getSasUrl);

module.exports = router;
