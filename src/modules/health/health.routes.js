const router = require('express').Router();

const healthController = require('./health.controller');

router.get('/check', healthController.getHealth);

module.exports = router;
