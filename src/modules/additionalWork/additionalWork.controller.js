const { apiResponse } = require('../../common/utils/apiResponse');
const service = require('./additionalWork.service');

const getContext = async (req, res, next) => {
  try {
    const data = await service.getContext(req.params.jobCardId, req.query, req.user);

    return apiResponse(res, {
      statusCode: 200,
      success: true,
      message: 'Additional work context retrieved successfully',
      data
    });
  } catch (error) {
    console.error('[getContext Error]:', error);
    return next(error);
  }
};

const listRequests = async (req, res, next) => {
  try {
    const { requests, department, meta } = await service.listRequests(req.query, req.user);

    return apiResponse(res, {
      statusCode: 200,
      success: true,
      message: 'Additional work requests fetched successfully',
      data: { requests, department },
      meta
    });
  } catch (error) {
    return next(error);
  }
};

const createRequest = async (req, res, next) => {
  try {
    const data = await service.createRequest(req.params.jobCardId, req.body, req.user);

    return apiResponse(res, {
      statusCode: 201,
      success: true,
      message: 'Additional work requested successfully',
      data
    });
  } catch (error) {
    return next(error);
  }
};

const twilioWebhook = async (req, res, next) => {
  try {
    const data = await service.handleTwilioWebhook(req);

    if (data.replyText) {
      res.type('text/xml');
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${data.replyText}</Message></Response>`);
    }

    return apiResponse(res, {
      statusCode: 200,
      success: true,
      message: data.alreadyResponded ? 'Approval response was already recorded' : 'Approval response recorded successfully',
      data
    });
  } catch (error) {
    console.error('[Twilio Webhook Error]:', error?.message || error);
    res.type('text/xml');
    return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
};

module.exports = {
  getContext,
  listRequests,
  createRequest,
  twilioWebhook
};
