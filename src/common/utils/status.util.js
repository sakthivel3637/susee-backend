const { STATUS_MODULE_CODES } = require('../constants/status.constants');

const normalizeStatusCode = (statusCode) => String(statusCode || '').trim().toUpperCase();
const normalizeModuleCode = (moduleCode) => String(moduleCode || '').trim().toLowerCase();

const moduleWhere = (moduleCode) => ({
  module: {
    moduleCode: normalizeModuleCode(moduleCode),
    isActive: true
  }
});

const statusModuleFilter = (moduleCode) => moduleWhere(moduleCode);

const resolveStatus = async (tx, moduleCode, statusCode) => {
  const code = normalizeStatusCode(statusCode);

  if (!moduleCode || !code) {
    return null;
  }

  return tx.statusMaster.findFirst({
    where: {
      isActive: true,
      statusCode: code,
      ...moduleWhere(moduleCode)
    },
    orderBy: {
      sortOrder: 'asc'
    },
    select: {
      id: true,
      moduleId: true,
      statusCode: true,
      statusName: true,
      slug: true,
      sortOrder: true,
      isFinal: true
    }
  });
};

const resolveStatusFromCodes = async (tx, moduleCode, statusCodes = []) => {
  const codes = statusCodes.map(normalizeStatusCode).filter(Boolean);

  if (!moduleCode || codes.length === 0) {
    return null;
  }

  return tx.statusMaster.findFirst({
    where: {
      isActive: true,
      statusCode: {
        in: codes
      },
      ...moduleWhere(moduleCode)
    },
    orderBy: [
      { sortOrder: 'asc' },
      { id: 'asc' }
    ],
    select: {
      id: true,
      moduleId: true,
      statusCode: true,
      statusName: true,
      slug: true,
      sortOrder: true,
      isFinal: true
    }
  });
};

const resolveStatusId = async (tx, moduleCode, statusCode) => {
  const status = await resolveStatus(tx, moduleCode, statusCode);
  return status ? status.id : null;
};

const resolveStatusIdFromCodes = async (tx, moduleCode, statusCodes = []) => {
  const status = await resolveStatusFromCodes(tx, moduleCode, statusCodes);
  return status ? status.id : null;
};

const resolveStatusById = async (tx, moduleCode, statusId) => {
  let id = Number(statusId);
  let mod = moduleCode;

  if (statusId === undefined && Number.isInteger(Number(moduleCode))) {
    id = Number(moduleCode);
    mod = null;
  }

  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  return tx.statusMaster.findFirst({
    where: {
      id,
      isActive: true,
      ...(mod ? moduleWhere(mod) : {})
    },
    select: {
      id: true,
      moduleId: true,
      statusCode: true,
      statusName: true,
      slug: true,
      sortOrder: true,
      isFinal: true
    }
  });
};

const resolveOrEnsureStatus = async (tx, moduleCode, statusCode, statusName, sortOrder = 30) => {
  let status = await resolveStatusFromCodes(tx, moduleCode, [statusCode]);
  if (status) return status;

  try {
    const mod = await tx.module.findFirst({
      where: {
        moduleCode: normalizeModuleCode(moduleCode),
        isActive: true
      }
    });
    if (!mod) return null;

    const code = normalizeStatusCode(statusCode);
    const slug = code.toLowerCase().replace(/[_\s]+/g, '-');

    const existing = await tx.statusMaster.findFirst({
      where: {
        moduleId: mod.id,
        OR: [
          { statusCode: code },
          { slug: slug }
        ]
      },
      select: {
        id: true,
        moduleId: true,
        statusCode: true,
        statusName: true,
        slug: true,
        sortOrder: true,
        isFinal: true
      }
    });
    if (existing) return existing;

    return await tx.statusMaster.create({
      data: {
        moduleId: mod.id,
        statusCode: code,
        statusName: statusName || code,
        slug,
        sortOrder: sortOrder || 0,
        isFinal: false,
        isActive: true
      },
      select: {
        id: true,
        moduleId: true,
        statusCode: true,
        statusName: true,
        slug: true,
        sortOrder: true,
        isFinal: true
      }
    });
  } catch (error) {
    console.error(`Failed to ensure status ${statusCode} for module ${moduleCode}:`, error);
    return null;
  }
};

const isAllowedJobCardTransition = (currentStatusCode, nextStatusCode, transitions) => {
  const currentCode = normalizeStatusCode(currentStatusCode);
  const nextCode = normalizeStatusCode(nextStatusCode);

  if (!currentCode || !nextCode || currentCode === nextCode) {
    return true;
  }

  const allowedStatuses = transitions[currentCode] || [];
  return allowedStatuses.includes(nextCode);
};

module.exports = {
  STATUS_MODULE_CODES,
  normalizeStatusCode,
  normalizeModuleCode,
  statusModuleFilter,
  resolveStatus,
  resolveStatusFromCodes,
  resolveStatusId,
  resolveStatusIdFromCodes,
  resolveStatusById,
  resolveOrEnsureStatus,
  isAllowedJobCardTransition
};

