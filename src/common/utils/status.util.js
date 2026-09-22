const { STATUS_MODULE_CODES } = require('../constants/status.constants');

const normalizeStatusCode = (statusCode) => String(statusCode || '').trim().toUpperCase();
const normalizeModuleCode = (moduleCode) => String(moduleCode || '').trim().toLowerCase();

const moduleWhere = (moduleCode) => ({
  module: {
    is: {
      moduleCode: normalizeModuleCode(moduleCode),
      isActive: true
    }
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
  const id = Number(statusId);

  if (!Number.isInteger(id) || id <= 0 || !moduleCode) {
    return null;
  }

  return tx.statusMaster.findFirst({
    where: {
      id,
      isActive: true,
      ...moduleWhere(moduleCode)
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
  isAllowedJobCardTransition
};
