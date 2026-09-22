const { apiResponse } = require('../../common/utils/apiResponse');
const serviceItemService = require('./service-item.service');

const createServiceItem = async (req, res, next) => {
  try {
    const serviceItem = await serviceItemService.createServiceItem(req.body, req.user.userId);

    return apiResponse(res, {
      statusCode: 201,
      message: 'Service item created successfully',
      data: { serviceItem }
    });
  } catch (error) {
    return next(error);
  }
};

const updateServiceItem = async (req, res, next) => {
  try {
    const serviceItem = await serviceItemService.updateServiceItem(req.params.id, req.body, req.user.userId);

    return apiResponse(res, {
      message: 'Service item updated successfully',
      data: { serviceItem }
    });
  } catch (error) {
    return next(error);
  }
};

const listServiceItems = async (req, res, next) => {
  try {
    const { serviceItems, meta } = await serviceItemService.listServiceItems(req.query, req.user);

    return apiResponse(res, {
      message: 'Service items fetched successfully',
      data: { serviceItems },
      meta
    });
  } catch (error) {
    return next(error);
  }
};

const getServiceItemDetail = async (req, res, next) => {
  try {
    const serviceItem = await serviceItemService.getServiceItemDetail(req.params.id, req.user);

    return apiResponse(res, {
      message: 'Service item fetched successfully',
      data: { serviceItem }
    });
  } catch (error) {
    return next(error);
  }
};

const updateServiceItemStatus = async (req, res, next) => {
  try {
    const serviceItem = await serviceItemService.updateServiceItemStatus(req.params.id, req.body, req.user.userId);

    return apiResponse(res, {
      message: serviceItem.isActive
        ? 'Service item activated successfully'
        : 'Service item deactivated successfully',
      data: { serviceItem }
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createServiceItem,
  updateServiceItem,
  listServiceItems,
  getServiceItemDetail,
  updateServiceItemStatus
};
