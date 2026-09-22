const router = require('express').Router();

const dashboardController = require('./dashboard.controller');
const { authenticate } = require('../../common/middleware/auth.middleware');
const { permissionMiddleware } = require('../../common/middleware/permission.middleware');

const canReadAdminDashboard = permissionMiddleware('/admin-dashboard', 'canRead');
const canReadMdDashboard = permissionMiddleware('/md-dashboard', 'canRead');
const canReadFloorDashboard = permissionMiddleware('/floor-dashboard', 'canRead');
const canReadManagerDashboard = permissionMiddleware('/manager-dashboard', 'canRead');
const canReadBodyShopDashboard = permissionMiddleware('/body-shop-dashboard', 'canRead');
const canReadWaterWashDashboard = permissionMiddleware('/water-wash-dashboard', 'canRead');

// Public route for TV Kiosk in the lobby (Moved to /kiosk/tv in index.js)

router.use(authenticate);

router.get('/admin', canReadAdminDashboard, dashboardController.getAdminDashboard);
router.get('/md', canReadMdDashboard, dashboardController.getMdDashboard);
router.get('/supervisor', canReadFloorDashboard, dashboardController.getFloorSupervisorDashboard);
router.get('/manager', canReadManagerDashboard, dashboardController.getManagerDashboard);
router.get('/body-shop', canReadBodyShopDashboard, dashboardController.getBodyShopDashboard);
router.get('/water-wash', canReadWaterWashDashboard, dashboardController.getWaterWashDashboard);

module.exports = router;
