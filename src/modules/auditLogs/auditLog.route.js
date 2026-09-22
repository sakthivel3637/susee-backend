const express = require('express');
const { requireAuth } = require('../../middlewares/auth.middleware');
const { checkPermission } = require('../../middlewares/permission.middleware');
const auditLogController = require('./auditLog.controller');

const router = express.Router();

router.use(requireAuth);

router.get(
  '/',
  checkPermission('audit-logs', 'canRead'),
  auditLogController.listAuditLogs
);

router.get(
  '/:id',
  checkPermission('audit-logs', 'canRead'),
  auditLogController.getAuditLogDetail
);

module.exports = router;
