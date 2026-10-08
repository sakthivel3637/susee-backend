const { createAdminMasterController, apiResponse } = require('../common');
const service = require('./service');

const baseController = createAdminMasterController(service, 'serviceItem', 'Service item', 'serviceItems');

const { exportToExcel } = require('../../../common/utils/excel.util');

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

baseController.downloadTemplate = async (req, res, next) => {
  try {
    const columns = [
      { header: 'Service Item Name', key: 'name', width: 30 },
      { header: 'Category Group', key: 'categoryGroup', width: 25 },
      { header: 'Base Price', key: 'basePrice', width: 18 },
      { header: 'Est. Duration (Mins)', key: 'estimatedMinutes', width: 22 },
      { header: 'Description', key: 'description', width: 35 },
      { header: 'Status (ACTIVE/INACTIVE)', key: 'status', width: 25 }
    ];
    return await exportToExcel(res, 'service_items_import_template', 'Template', columns, []);
  } catch (error) {
    return next(error);
  }
};

module.exports = baseController;

