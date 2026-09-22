const { apiResponse } = require('../../common/utils/apiResponse');
const { createStorageProvider } = require('../../providers/storage/storage.provider');
const storageProvider = createStorageProvider();

const getSasUrl = async (req, res, next) => {
  try {
    const { blobName, expiresAfterSeconds } = req.query;
    if (!blobName) {
      const error = new Error('blobName query parameter is required');
      error.statusCode = 400;
      return next(error);
    }

    const expiry = expiresAfterSeconds ? parseInt(expiresAfterSeconds, 10) : 3600;
    const sasUrl = await storageProvider.generateSasUrl(blobName, expiry);

    return apiResponse(res, {
      message: 'SAS URL generated successfully',
      data: {
        sasUrl
      }
    });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    return next(error);
  }
};

module.exports = {
  getSasUrl
};
