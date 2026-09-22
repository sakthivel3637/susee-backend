const { apiResponse } = require('../../common/utils/apiResponse');
const auditLogService = require('./auditLog.service');

const { exportToExcel } = require('../../common/utils/excel.util');

const getAuditLogs = async (req, res, next) => {
  try {
    const { auditLogs, meta } = await auditLogService.listAuditLogs(req.query);

    if (req.query.export === 'true') {
      const columns = [
        { header: 'User', key: 'userName', width: 25 },
        { header: 'Action', key: 'actionType', width: 18 },
        { header: 'Table Name', key: 'tableName', width: 20 },
        { header: 'Record Name', key: 'recordName', width: 20 },
        { header: 'Comments', key: 'comments', width: 30 },
        { header: 'Timestamp', key: 'performedAt', width: 25 }
      ];

      const formattedData = auditLogs.map(log => ({
        userName: log.performedBy?.fullName || 'System',
        actionType: log.actionType,
        tableName: log.tableName,
        recordName: log.recordName,
        comments: log.comments || '',
        performedAt: log.performedAt ? new Date(log.performedAt).toLocaleString() : ''
      }));

      return await exportToExcel(res, 'Audit_Logs', 'Audit Logs', columns, formattedData);
    }

    return apiResponse(res, {
      message: 'Audit logs fetched successfully',
      data: { auditLogs },
      meta
    });
  } catch (error) {
    return next(error);
  }
};

const getAuditLogById = async (req, res, next) => {
  try {
    const auditLog = await auditLogService.getAuditLogDetail(req.params.id);
    
    return apiResponse(res, {
      message: 'Audit log details fetched successfully',
      data: { auditLog }
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getAuditLogs,
  getAuditLogById
};
