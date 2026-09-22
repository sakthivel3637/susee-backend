const { apiResponse } = require('../../common/utils/apiResponse');
const prisma = require('../../config/db');

const getHealth = async (req, res, next) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    return apiResponse(res, {
      message: 'DVSOS Backend is healthy',
      data: {
        status: 'ok',
        database: 'connected',
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    error.statusCode = 503;
    error.message = 'DVSOS Backend is running but database health check failed';
    return next(error);
  }
};

module.exports = {
  getHealth
};
