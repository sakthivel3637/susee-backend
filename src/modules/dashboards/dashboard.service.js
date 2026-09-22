const dashboardRepository = require('./dashboard.repository');

const getAdminDashboard = () => {
  return dashboardRepository.getAdminDashboard({ recentUserLimit: 5 });
};

const getMdDashboard = (timeframe, locationId) => {
  return dashboardRepository.getMdDashboard({ timeframe, locationId });
};

const getFloorSupervisorDashboard = (locationId) => {
  return dashboardRepository.getFloorSupervisorDashboard({ locationId });
};

const getManagerDashboard = (locationId, page, limit) => {
  return dashboardRepository.getManagerDashboard({ locationId, page, limit });
};

const getBodyShopDashboard = (locationId) => {
  return dashboardRepository.getBodyShopDashboard({ locationId });
};

const getWaterWashDashboard = (locationId) => {
  return dashboardRepository.getWaterWashDashboard({ locationId });
};

const getTvKioskDashboard = (locationId) => {
  return dashboardRepository.getTvKioskDashboard({ locationId });
};

module.exports = {
  getAdminDashboard,
  getMdDashboard,
  getFloorSupervisorDashboard,
  getManagerDashboard,
  getBodyShopDashboard,
  getWaterWashDashboard,
  getTvKioskDashboard
};
