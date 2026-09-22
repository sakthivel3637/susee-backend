const { apiResponse } = require('../utils/apiResponse');
const { Prisma } = require('@prisma/client');

const errorMiddleware = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';

  // Handle Prisma Known Request Errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    statusCode = 400; // Bad Request
    if (err.code === 'P2002') {
      console.log("err", err.message)
      message = 'This record already exists or conflicts with another record.';
    } else {
      message = 'A database error occurred. Please check your inputs.';
    }
  }
  console.error(err);

  return apiResponse(res, {
    statusCode,
    success: false,
    message,
    data: err.data || {},
    meta: {}
  });
};

module.exports = errorMiddleware;
