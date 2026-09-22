const prisma = require('../../config/db');

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const buildAuditLogWhere = (query) => {
  const where = {};

  if (query.tableName) {
    where.tableName = query.tableName;
  }

  if (query.actionType) {
    where.actionType = query.actionType;
  }
  
  if (query.performedByUserId) {
    where.performedByUserId = Number.parseInt(query.performedByUserId, 10);
  }

  if (query.locationId) {
    where.locationId = Number.parseInt(query.locationId, 10);
  }

  if (query.search) {
    const searchStr = query.search.trim();
    where.OR = [
      { tableName: { contains: searchStr } },
      { recordName: { contains: searchStr } },
      { actionType: { contains: searchStr } },
      { comments: { contains: searchStr } },
      { performedBy: { fullName: { contains: searchStr } } }
    ];
  }

  if (query.fromDate) {
    where.performedAt = { ...where.performedAt, gte: new Date(query.fromDate) };
  }

  if (query.toDate) {
    const to = new Date(query.toDate);
    to.setHours(23, 59, 59, 999);
    where.performedAt = { ...where.performedAt, lte: to };
  }

  return where;
};

const listAuditLogs = async (query) => {
  const isExport = query.export === 'true';
  const page = isExport ? 1 : parsePositiveInt(query.page, 1);
  const limit = isExport ? 1000000 : parsePositiveInt(query.limit, 10);
  const where = buildAuditLogWhere(query);
  const skip = (page - 1) * limit;

  // By default, sort by newest first
  const orderBy = { performedAt: 'desc' };

  const [auditLogs, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      include: {
        performedBy: {
          select: { id: true, fullName: true, emailId: true }
        },
        location: {
          select: { id: true, locationName: true }
        }
      }
    }),
    prisma.auditLog.count({ where })
  ]);

  // Convert BigInt to String to avoid serialization issues
  const serializedLogs = auditLogs.map(log => ({
    ...log,
    id: log.id.toString(),
    recordId: log.recordId.toString(),
  }));

  return {
    auditLogs: serializedLogs,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
};

const getAuditLogDetail = async (id) => {
  const parsedId = BigInt(id);
  const auditLog = await prisma.auditLog.findUnique({
    where: { id: parsedId },
    include: {
      performedBy: {
        select: { id: true, fullName: true, emailId: true }
      },
      location: {
        select: { id: true, locationName: true }
      },
      details: true // AuditLogDetail
    }
  });

  if (!auditLog) {
    const error = new Error('Audit log not found');
    error.statusCode = 404;
    throw error;
  }

  // Convert BigInt to String
  return {
    ...auditLog,
    id: auditLog.id.toString(),
    recordId: auditLog.recordId.toString(),
    details: auditLog.details.map(detail => ({
      ...detail,
      id: detail.id.toString(),
      auditLogId: detail.auditLogId.toString()
    }))
  };
};

module.exports = {
  listAuditLogs,
  getAuditLogDetail
};
