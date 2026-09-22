const prisma = require('../../config/db');
const { STATUS_MODULE_CODES, statusModuleFilter } = require('../../common/utils/status.util');

const list = async (query, user) => {
  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 10;
  const skip = (page - 1) * limit;

  const where = {};

  if (user && user.locationId) {
    where.locationId = Number(user.locationId);
  }

  if (query.search) {
    where.OR = [
      { vehicle: { registrationNo: { contains: query.search } } },
      { customer: { fullName: { contains: query.search } } },
      { customer: { mobileNo: { contains: query.search } } }
    ];
  }
  
  if (query.status) {
    where.status = {
      is: {
        statusCode: String(query.status).trim().toUpperCase(),
        ...statusModuleFilter(STATUS_MODULE_CODES.GATE_ENTRY)
      }
    };
  }
  
  if (query.serviceType) {
    where.entryType = query.serviceType;
  }

  if (query.startDate && query.endDate) {
    where.entryTime = {
      gte: new Date(query.startDate),
      lte: new Date(query.endDate + 'T23:59:59.999Z')
    };
  } else if (query.startDate) {
    where.entryTime = {
      gte: new Date(query.startDate)
    };
  } else if (query.endDate) {
    where.entryTime = {
      lte: new Date(query.endDate + 'T23:59:59.999Z')
    };
  }

  const isExport = query.export === 'true';

  const [entries, total] = await Promise.all([
    prisma.gateEntry.findMany({
      where,
      ...(isExport ? {} : { skip, take: limit }),
      orderBy: { entryTime: 'desc' },
      include: {
        vehicle: {
          include: {
            brand: true
          }
        },
        customer: true,
        status: true,
        enteredBy: true
      }
    }),
    prisma.gateEntry.count({ where })
  ]);

  const formattedEntries = entries.map(entry => ({
    id: entry.id.toString(),
    slug: entry.slug,
    vehicleNumber: entry.vehicle?.registrationNo || '',
    ownerName: entry.customer?.fullName || '',
    mobile: entry.customer?.mobileNo || '',
    makeModel: entry.vehicle?.model ? `${entry.vehicle?.brand?.name || ''} ${entry.vehicle?.model}`.trim() : (entry.vehicle?.brand?.name || 'Unknown'),
    serviceType: entry.entryType,
    status: entry.status?.statusCode || 'PENDING',
    entryTime: entry.entryTime,
    entryBy: entry.enteredBy?.fullName || 'System'
  }));

  return {
    entries: formattedEntries,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  };
};

const getBySlug = async (slugOrId, user) => {
  const isNumeric = /^\d+$/.test(slugOrId);
  const entry = await prisma.gateEntry.findFirst({
    where: {
      OR: [
        { slug: slugOrId },
        ...(isNumeric ? [{ id: parseInt(slugOrId) }] : [])
      ]
    },
    include: {
      vehicle: { include: { brand: true } },
      customer: true,
      status: true,
      enteredBy: true,
      location: true
    }
  });
  
  if (!entry) throw new Error('Gate entry not found');
  
  return {
    id: entry.id.toString(),
    slug: entry.slug,
    vehicleNumber: entry.vehicle?.registrationNo || '',
    ownerName: entry.customer?.fullName || '',
    mobile: entry.customer?.mobileNo || '',
    makeModel: entry.vehicle?.model ? `${entry.vehicle?.brand?.name || ''} ${entry.vehicle?.model}`.trim() : (entry.vehicle?.brand?.name || 'Unknown'),
    serviceType: entry.entryType,
    status: entry.status?.statusCode || 'PENDING',
    entryTime: entry.entryTime,
    exitTime: entry.exitTime,
    entryBy: entry.enteredBy?.fullName || 'System',
    remarks: entry.remarks
  };
};

module.exports = { list, getBySlug };
