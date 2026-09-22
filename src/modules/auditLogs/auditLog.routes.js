const router = require('express').Router();
const auditLogController = require('./auditLog.controller');
const { authenticate } = require('../../common/middleware/auth.middleware');
const { permissionMiddleware } = require('../../common/middleware/permission.middleware');

const canReadAuditLogs = permissionMiddleware('/audit-logs', 'canRead');

router.use(authenticate);
router.use(canReadAuditLogs);

router.get('/list', auditLogController.getAuditLogs);
router.get('/detail/:id', auditLogController.getAuditLogById);

module.exports = router;
