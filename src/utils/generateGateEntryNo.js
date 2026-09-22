const normalizeCodePart = (value) => {
  return String(value || 'LOC')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 13) || 'LOC';
};

const formatDatePart = (date = new Date()) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');

  return `${year}${month}${day}`;
};

const extractSequence = (gateEntryNo) => {
  const sequence = String(gateEntryNo || '').split('-').pop();
  const parsed = Number.parseInt(sequence, 10);

  return Number.isNaN(parsed) ? 0 : parsed;
};

const generateGateEntryNo = async ({ tx, locationCode, date = new Date() }) => {
  const prefix = `GE-${normalizeCodePart(locationCode)}-${formatDatePart(date)}-`;
  const latestEntry = await tx.gateEntry.findFirst({
    where: {
      gateEntryNo: {
        startsWith: prefix
      }
    },
    orderBy: {
      gateEntryNo: 'desc'
    },
    select: {
      gateEntryNo: true
    }
  });

  let sequence = extractSequence(latestEntry && latestEntry.gateEntryNo) + 1;
  let gateEntryNo = `${prefix}${String(sequence).padStart(4, '0')}`;

  while (await tx.gateEntry.findUnique({ where: { gateEntryNo }, select: { id: true } })) {
    sequence += 1;
    gateEntryNo = `${prefix}${String(sequence).padStart(4, '0')}`;
  }

  return gateEntryNo;
};

module.exports = {
  generateGateEntryNo
};
