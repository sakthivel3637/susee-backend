const { apiResponse } = require('../../common/utils/apiResponse');
const bayService = require('./bay.service');

const createBay = async (req, res, next) => {
  try {
    const bay = await bayService.createBay(req.body, req.user.userId || req.user.id);

    return apiResponse(res, {
      statusCode: 201,
      message: 'Bay created successfully',
      data: { bay }
    });
  } catch (error) {
    return next(error);
  }
};

const updateBay = async (req, res, next) => {
  try {
    const bay = await bayService.updateBay(req.params.id, req.body, req.user.userId || req.user.id);

    return apiResponse(res, {
      message: 'Bay updated successfully',
      data: { bay }
    });
  } catch (error) {
    return next(error);
  }
};

const listBays = async (req, res, next) => {
  try {
    const { bays, meta } = await bayService.listBays(req.query, req.user);

    return apiResponse(res, {
      message: 'Bays fetched successfully',
      data: { bays },
      meta
    });
  } catch (error) {
    return next(error);
  }
};

const getBayDropdown = async (req, res, next) => {
  try {
    const bays = await bayService.getBayDropdown({
      ...req.query,
      locationId: req.user.locationId || req.query.locationId
    });

    return apiResponse(res, {
      message: 'Bay dropdown fetched successfully',
      data: { bays }
    });
  } catch (error) {
    return next(error);
  }
};

const updateBayStatus = async (req, res, next) => {
  try {
    const bay = await bayService.updateBayStatus(req.params.id, req.body, req.user.userId || req.user.id);

    return apiResponse(res, {
      message: bay.isActive
        ? 'Bay activated successfully'
        : 'Bay deactivated successfully',
      data: { bay }
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createBay,
  updateBay,
  listBays,
  getBayDropdown,
  updateBayStatus
};
