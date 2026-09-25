const { apiResponse } = require('../../common/utils/apiResponse');
const dashboardService = require('./dashboard.service');

const getAdminDashboard = async (req, res, next) => {
  try {
    const dashboard = await dashboardService.getAdminDashboard();

    return apiResponse(res, {
      message: 'Admin dashboard fetched successfully',
      data: dashboard
    });
  } catch (error) {
    return next(error);
  }
};

const getMdDashboard = async (req, res, next) => {
  try {
    const timeframe = req.query.timeframe || 'today';
    const locationId = req.query.locationId ? parseInt(req.query.locationId) : (req.user?.locationId || null);
    const dashboard = await dashboardService.getMdDashboard(timeframe, locationId);

    return apiResponse(res, {
      message: 'MD dashboard fetched successfully',
      data: dashboard
    });
  } catch (error) {
    return next(error);
  }
};

const getFloorSupervisorDashboard = async (req, res, next) => {
  try {
    const locationId = req.query.locationId ? parseInt(req.query.locationId) : (req.user?.locationId || null);
    const dashboard = await dashboardService.getFloorSupervisorDashboard(locationId);

    return apiResponse(res, {
      message: 'Floor supervisor dashboard fetched successfully',
      data: dashboard
    });
  } catch (error) {
    return next(error);
  }
};

const getManagerDashboard = async (req, res, next) => {
  try {
    const locationId = req.query.locationId ? parseInt(req.query.locationId) : (req.user?.locationId || null);
    const page = req.query.page ? parseInt(req.query.page) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit) : 5;
    const dashboard = await dashboardService.getManagerDashboard(locationId, page, limit);

    return apiResponse(res, {
      message: 'Manager dashboard fetched successfully',
      data: dashboard
    });
  } catch (error) {
    return next(error);
  }
};

const getBodyShopDashboard = async (req, res, next) => {
  try {
    const locationId = req.query.locationId ? parseInt(req.query.locationId) : (req.user?.locationId || null);
    const dashboard = await dashboardService.getBodyShopDashboard(locationId);

    return apiResponse(res, {
      message: 'Body shop dashboard fetched successfully',
      data: dashboard
    });
  } catch (error) {
    return next(error);
  }
};


const getTvKioskDashboard = async (req, res, next) => {
  try {
    const locationId = req.kioskLocationId || (req.query.locationId ? parseInt(req.query.locationId) : (req.user?.locationId || null));
    const dashboard = await dashboardService.getTvKioskDashboard(locationId);

    return apiResponse(res, {
      message: 'TV Kiosk dashboard fetched successfully',
      data: dashboard
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getAdminDashboard,
  getMdDashboard,
  getFloorSupervisorDashboard,
  getManagerDashboard,
  getBodyShopDashboard,
  getTvKioskDashboard
};
