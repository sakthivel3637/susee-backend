const { apiResponse } = require('../../common/utils/apiResponse');
const menuService = require('./menu.service');

const listMenus = async (req, res, next) => {
  try {
    const data = await menuService.listMenus(req.query);

    return apiResponse(res, {
      message: 'Menus fetched successfully',
      data
    });
  } catch (error) {
    return next(error);
  }
};

const listMenuModules = async (req, res, next) => {
  try {
    const modules = await menuService.listMenuModules(req.query);

    return apiResponse(res, {
      message: 'Menu modules fetched successfully',
      data: { modules }
    });
  } catch (error) {
    return next(error);
  }
};

const listMenusByModule = async (req, res, next) => {
  try {
    const data = await menuService.listMenusByModule(req.params.module, req.query);

    return apiResponse(res, {
      message: 'Menus fetched successfully',
      data
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  listMenus,
  listMenuModules,
  listMenusByModule
};
