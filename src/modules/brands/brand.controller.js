const { apiResponse } = require('../../common/utils/apiResponse');
const brandService = require('./brand.service');

const createBrand = async (req, res, next) => {
  try {
    const brand = await brandService.createBrand(req.body, req.user.userId);

    return apiResponse(res, {
      statusCode: 201,
      message: 'Brand created successfully',
      data: { brand }
    });
  } catch (error) {
    return next(error);
  }
};

const updateBrand = async (req, res, next) => {
  try {
    const brand = await brandService.updateBrand(req.params.id, req.body, req.user.userId);

    return apiResponse(res, {
      message: 'Brand updated successfully',
      data: { brand }
    });
  } catch (error) {
    return next(error);
  }
};

const listBrands = async (req, res, next) => {
  try {
    const { brands, meta } = await brandService.listBrands(req.query);

    return apiResponse(res, {
      message: 'Brands fetched successfully',
      data: { brands },
      meta
    });
  } catch (error) {
    return next(error);
  }
};

const getBrandDropdown = async (req, res, next) => {
  try {
    const brands = await brandService.getBrandDropdown();

    return apiResponse(res, {
      message: 'Brand dropdown fetched successfully',
      data: { brands }
    });
  } catch (error) {
    return next(error);
  }
};

const updateBrandStatus = async (req, res, next) => {
  try {
    const brand = await brandService.updateBrandStatus(req.params.id, req.body, req.user.userId);

    return apiResponse(res, {
      message: brand.isActive
        ? 'Brand activated successfully'
        : 'Brand deactivated successfully',
      data: { brand }
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createBrand,
  updateBrand,
  listBrands,
  getBrandDropdown,
  updateBrandStatus
};
