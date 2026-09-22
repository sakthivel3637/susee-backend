const { apiResponse } = require('../../common/utils/apiResponse');
const categoryService = require('./service-category.service');

const createCategory = async (req, res, next) => {
  try {
    const category = await categoryService.createCategory(req.body, req.user.userId);

    return apiResponse(res, {
      statusCode: 201,
      message: 'Service category created successfully',
      data: { category }
    });
  } catch (error) {
    return next(error);
  }
};

const updateCategory = async (req, res, next) => {
  try {
    const category = await categoryService.updateCategory(req.params.id, req.body, req.user.userId);

    return apiResponse(res, {
      message: 'Service category updated successfully',
      data: { category }
    });
  } catch (error) {
    return next(error);
  }
};

const listCategories = async (req, res, next) => {
  try {
    const { categories, meta } = await categoryService.listCategories(req.query, req.user);

    return apiResponse(res, {
      message: 'Service categories fetched successfully',
      data: { categories },
      meta
    });
  } catch (error) {
    return next(error);
  }
};

const getCategoryDetail = async (req, res, next) => {
  try {
    const category = await categoryService.getCategoryDetail(req.params.id, req.user);

    return apiResponse(res, {
      message: 'Service category fetched successfully',
      data: { category }
    });
  } catch (error) {
    return next(error);
  }
};

const updateCategoryStatus = async (req, res, next) => {
  try {
    const category = await categoryService.updateCategoryStatus(req.params.id, req.body, req.query, req.user.userId);

    return apiResponse(res, {
      message: category.isActive
        ? 'Service category activated successfully'
        : 'Service category deactivated successfully',
      data: { category }
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createCategory,
  updateCategory,
  listCategories,
  getCategoryDetail,
  updateCategoryStatus
};
