const { createAdminMasterController, apiResponse } = require('../common');
const service = require('./service');

const baseController = createAdminMasterController(service, 'serviceItem', 'Service item', 'serviceItems');

baseController.importItems = async (req, res, next) => {
  try {
    const fileBuffer = req.file ? req.file.buffer : null;
    const result = await service.importServiceItems(fileBuffer, req.user?.userId);
    return apiResponse(res, {
      statusCode: 200,
      message: `Import completed: ${result.importedCount} imported, ${result.skippedCount} skipped`,
      data: result
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = baseController;

