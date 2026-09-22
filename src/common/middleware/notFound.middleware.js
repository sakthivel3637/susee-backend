const { apiResponse } = require('../utils/apiResponse');

const notFoundMiddleware = (req, res) => {
  return apiResponse(res, {
    statusCode: 404,
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
    data: {},
    meta: {}
  });
};

module.exports = notFoundMiddleware;
