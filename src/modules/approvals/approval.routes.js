const router = require('express').Router();
const additionalWorkController = require('../additionalWork/additionalWork.controller');

router.post('/whatsapp/twilio/webhook', additionalWorkController.twilioWebhook);

module.exports = router;
