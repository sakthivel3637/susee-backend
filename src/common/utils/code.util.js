const DEFAULT_CODE_LENGTH = 4;

const CODE_CONFIG = {
  serviceCenter: {
    field: 'serviceCenterCode',
    prefix: 'SC'
  },
  state: {
    field: 'stateCode',
    prefix: 'ST'
  },
  location: {
    field: 'locationCode',
    prefix: 'LOC'
  },
  customer: {
    field: 'customerCode',
    prefix: 'CUS'
  },
  gateEntry: {
    field: 'gateEntryNo',
    prefix: 'GE'
  },
  jobCard: {
    field: 'jobCardNo',
    prefix: 'JC'
  },
  employee: {
    field: 'employeeCode',
    prefix: 'EMP'
  },
  module: {
    field: 'moduleCode',
    prefix: 'MOD'
  },
  statusMaster: {
    field: 'statusCode',
    prefix: 'STAT'
  }
};

const normalizePrefix = (prefix) => {
  return String(prefix || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
};

const extractCodeNumber = (code, prefix = '') => {
  if (!code) {
    return 0;
  }

  const normalizedPrefix = normalizePrefix(prefix);
  const normalizedCode = String(code).trim().toUpperCase();
  const numberPart = normalizedPrefix && normalizedCode.startsWith(normalizedPrefix)
    ? normalizedCode.slice(normalizedPrefix.length)
    : normalizedCode.replace(/^\D+/, '');

  const parsedNumber = Number.parseInt(numberPart, 10);
  return Number.isNaN(parsedNumber) ? 0 : parsedNumber;
};

const formatCode = ({ prefix, number, length = DEFAULT_CODE_LENGTH }) => {
  const normalizedPrefix = normalizePrefix(prefix);

  if (!normalizedPrefix) {
    throw new Error('Code prefix is required');
  }

  const normalizedNumber = Number.parseInt(number, 10);

  if (Number.isNaN(normalizedNumber) || normalizedNumber <= 0) {
    throw new Error('Code number must be a positive integer');
  }

  return `${normalizedPrefix}${String(normalizedNumber).padStart(length, '0')}`;
};

const generateNextCode = ({ prefix, latestCode, length = DEFAULT_CODE_LENGTH, startAt = 1 }) => {
  const latestNumber = extractCodeNumber(latestCode, prefix);
  const nextNumber = latestNumber > 0 ? latestNumber + 1 : startAt;

  return formatCode({
    prefix,
    number: nextNumber,
    length
  });
};

const generateUniqueCode = async ({
  prefix,
  latestCode,
  length = DEFAULT_CODE_LENGTH,
  startAt = 1,
  existsCallback
}) => {
  if (typeof existsCallback !== 'function') {
    throw new Error('existsCallback must be a function');
  }

  let candidateNumber = Math.max(extractCodeNumber(latestCode, prefix) + 1, startAt);
  let candidateCode = formatCode({ prefix, number: candidateNumber, length });

  while (await existsCallback(candidateCode)) {
    candidateNumber += 1;
    candidateCode = formatCode({ prefix, number: candidateNumber, length });
  }

  return candidateCode;
};

const getCodeConfig = (tableName) => {
  return CODE_CONFIG[tableName] || null;
};

module.exports = {
  CODE_CONFIG,
  DEFAULT_CODE_LENGTH,
  extractCodeNumber,
  formatCode,
  generateNextCode,
  generateUniqueCode,
  getCodeConfig
};
