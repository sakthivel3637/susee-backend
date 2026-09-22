const router = require('express').Router();

const authRoutes = require('../modules/auth/auth.routes');
const adminDistrictRoutes = require('../modules/adminMasters/districts/routes');
const adminDropdownRoutes = require('../modules/adminMasters/dropdowns/routes');
const adminLocationRoutes = require('../modules/adminMasters/locations/routes');
const adminServiceCategoryRoutes = require('../modules/adminMasters/serviceCategories/routes');
const adminServiceCenterRoutes = require('../modules/adminMasters/serviceCenters/routes');
const adminServiceItemRoutes = require('../modules/adminMasters/serviceItems/routes');
const adminStateRoutes = require('../modules/adminMasters/states/routes');
const adminModuleRoutes = require('../modules/adminMasters/modules/routes');
const adminStatusRoutes = require('../modules/adminMasters/statuses/routes');
const dashboardRoutes = require('../modules/dashboards/dashboard.routes');
const adminStatusMasterRoutes = require('../modules/adminMasters/statusMasters/routes');
const healthRoutes = require('../modules/health/health.routes');
const menuRoutes = require('../modules/menus/menu.routes');
const {
  mobileGateEntryRoutes,
  crmGateEntryRoutes
} = require('../modules/mobileGateEntry/mobileGateEntry.routes');
const mobileJobCardRoutes = require('../modules/mobileJobCard/mobileJobCard.routes');
const roleMenuPermissionRoutes = require('../modules/roleMenuPermissions/roleMenuPermission.routes');
const roleRoutes = require('../modules/roles/role.routes');
const { serviceCategoryRoutes, crmServiceCategoryRoutes } = require('../modules/service-categories/service-category.routes');
const { serviceItemRoutes, crmServiceItemRoutes } = require('../modules/service-items/service-item.routes');
const userRoutes = require('../modules/users/user.routes');
const customerRoutes = require('../modules/customers/customer.routes');
const vehicleRoutes = require('../modules/vehicles/vehicle.routes');
const jobCardRoutes = require('../modules/jobCards/jobCard.routes');
const queueRoutes = require('../modules/queues/queue.routes');
const approvalRoutes = require('../modules/approvals/approval.routes');
const storageRoutes = require('../modules/storage/storage.routes');

const webGateEntryRoutes = require('../modules/webGateEntries/webGateEntries.routes');
const notificationRoutes = require('../modules/notifications/notification.routes');
const deviceTokenRoutes = require('../modules/notifications/deviceToken.routes');
const auditLogRoutes = require('../modules/auditLogs/auditLog.routes');
const { brandRoutes, crmBrandRoutes } = require('../modules/brands/brand.routes');
const stageTimeLimitRoutes = require('../modules/stageTimeLimits/stageTimeLimit.routes');
const stageTimeLimitDropdownRoutes = require('../modules/stageTimeLimits/stageTimeLimitDropdown.routes');
const { bayRoutes, crmBayRoutes } = require('../modules/bays/bay.routes');

router.use('/', stageTimeLimitDropdownRoutes);
router.use('/auth', authRoutes);
router.use('/notifications', notificationRoutes);
router.use('/device-token', deviceTokenRoutes);
router.use('/admin/states', adminStateRoutes);
router.use('/admin/districts', adminDistrictRoutes);
router.use('/admin/service-categories', adminServiceCategoryRoutes);
router.use('/admin/service-items', adminServiceItemRoutes);
router.use('/admin/service-centers', adminServiceCenterRoutes);
router.use('/admin/locations', adminLocationRoutes);
router.use('/admin/dropdowns', adminDropdownRoutes);
router.use('/admin/modules', adminModuleRoutes);
router.use('/admin/statuses', adminStatusRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/admin/statuses', adminStatusMasterRoutes);
router.use('/health', healthRoutes);
router.use('/menus', menuRoutes);
router.use('/mobile/gate-entry', mobileGateEntryRoutes);
router.use('/mobile/job-cards', mobileJobCardRoutes);
router.use('/crm/gate-entries', crmGateEntryRoutes);
router.use('/gate-entries', webGateEntryRoutes);
router.use('/roles', roleRoutes);
router.use('/roles/:roleId/menu-permissions', roleMenuPermissionRoutes);
router.use('/service-categories', serviceCategoryRoutes);
router.use('/crm/service-categories', crmServiceCategoryRoutes);
router.use('/service-items', serviceItemRoutes);
router.use('/crm/service-items', crmServiceItemRoutes);
router.use('/users', userRoutes);
router.use('/customers', customerRoutes);
router.use('/vehicles', vehicleRoutes);
router.use('/job-cards', jobCardRoutes);
router.use('/queues', queueRoutes);
router.use('/approvals', approvalRoutes);
router.use('/audit-logs', auditLogRoutes);
router.use('/stage-time-limits', stageTimeLimitRoutes);
router.use('/admin/brands', brandRoutes);
router.use('/brands', brandRoutes);
router.use('/crm/brands', crmBrandRoutes);
router.use('/bays', bayRoutes);
router.use('/crm/bays', crmBayRoutes);
router.use('/storage', storageRoutes);

// Kiosk routes
const { validateKioskKey } = require('../common/middleware/kioskAuth.middleware');
router.get('/kiosk/tv', validateKioskKey, require('../modules/dashboards/dashboard.controller').getTvKioskDashboard);

module.exports = router;
