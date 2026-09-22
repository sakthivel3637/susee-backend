const { generateUniqueSlug } = require('../../common/utils/slug.util');
const prisma = require('../../config/db');
const { createAuditLog, buildChangeDetails } = require('../../common/utils/audit.util');

// Removed VIEW_ACTIVE_ONLY_ROLES per user request

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const parseBooleanFilter = (value) => {
  if (value === undefined || value === '') return undefined;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
};

const toTrimmedString = (value) => {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const toBayResource = (bay, activeBayIds = new Set()) => {
  const isBusy = activeBayIds.has(bay.id);

  return {
    ...bay,
    availability: isBusy ? 'BUSY' : 'AVAILABLE',
    availabilityLabel: isBusy ? 'Busy' : 'Available'
  };
};

const resolveActiveBayIds = async (bayIds = []) => {
  if (!bayIds.length) {
    return new Set();
  }

  const assignments = await prisma.workAssignment.findMany({
    where: {
      bayId: {
        in: bayIds
      },
      completedAt: null
    },
    select: {
      bayId: true
    }
  });

  return new Set(assignments.map((assignment) => assignment.bayId).filter(Boolean));
};



const getActiveStatusId = async () => {
  const status = await prisma.statusMaster.findFirst({
    where: {
      module: { moduleCode: 'bay' },
      statusCode: 'ACTIVE'
    }
  });
  return status?.id;
};

const createBay = async (payload, actorUserId) => {
  const bayName = payload.bayName.trim();
  const bayType = payload.bayType;

  // Try to use provided locationId, user's locationId, or default to the first location
  let locationId = payload.locationId;
  if (!locationId) {
    const user = await prisma.user.findUnique({ where: { id: actorUserId } });
    if (user?.locationId) {
      locationId = user.locationId;
    } else {
      const firstLocation = await prisma.location.findFirst({ orderBy: { id: 'asc' } });
      if (firstLocation) locationId = firstLocation.id;
    }
  }

  if (!locationId) {
    throw createHttpError(400, 'Location is required to create a Bay');
  }

  // Check if name already exists in location
  const existing = await prisma.bay.findFirst({
    where: {
      bayName: { equals: bayName },
      locationId: locationId
    }
  });

  if (existing) {
    throw createHttpError(409, 'Bay with this name already exists in the selected location');
  }

  let bayCode = payload.bayCode;
  if (!bayCode) {
    // Generate a simple unique bay code
    const count = await prisma.bay.count();
    bayCode = `BAY-${String(count + 1).padStart(3, '0')}`;
  }

  const statusId = await getActiveStatusId();
  if (!statusId) {
    throw createHttpError(500, 'Bay ACTIVE status is not configured in the system');
  }

  const bay = await prisma.bay.create({
    data: {
      locationId,
      bayName,
      bayType,
      bayCode,
      statusId,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  });

  await createAuditLog(prisma, {
    tableName: 'bays',
    recordId: bay.id,
    actionType: 'CREATE',
    performedByUserId: actorUserId,
    recordName: bay.bayName,
    comments: 'Bay created',
    locationId: bay.locationId
  }).catch((err) => console.error('Failed to create audit log:', err));

  return bay;
};

const updateBay = async (identifier, payload, actorUserId) => {
  const isId = !Number.isNaN(Number(identifier));
  const where = isId ? { id: Number(identifier) } : { bayCode: identifier }; // Use bayCode if not ID

  const existingBay = await prisma.bay.findFirst({ where });

  if (!existingBay) {
    throw createHttpError(404, 'Bay not found');
  }

  const bayName = payload.bayName.trim();
  const bayType = payload.bayType;

  if (bayName.toLowerCase() !== existingBay.bayName.toLowerCase()) {
    const duplicate = await prisma.bay.findFirst({
      where: {
        bayName: { equals: bayName },
        locationId: existingBay.locationId,
        id: { not: existingBay.id }
      }
    });

    if (duplicate) {
      throw createHttpError(409, 'Bay with this name already exists in this location');
    }
  }

  const updatedBay = await prisma.bay.update({
    where: { id: existingBay.id },
    data: {
      bayName,
      bayType,
      updatedAt: new Date()
    }
  });

  await createAuditLog(prisma, {
    tableName: 'bays',
    recordId: updatedBay.id,
    actionType: 'UPDATE',
    performedByUserId: actorUserId,
    recordName: updatedBay.bayName,
    comments: 'Bay updated',
    locationId: updatedBay.locationId,
    details: buildChangeDetails(existingBay, updatedBay, ['bayName', 'bayType'])
  }).catch((err) => console.error('Failed to create audit log:', err));

  return updatedBay;
};

const listBays = async (query, user) => {
  const page = parsePositiveInt(query.page, 1);
  const limit = parsePositiveInt(query.limit, 10);
  const skip = (page - 1) * limit;

  const search = query.search?.trim();
  const isActive = parseBooleanFilter(query.isActive);
  const locationId = user && user.locationId ? Number(user.locationId) : parsePositiveInt(query.locationId, undefined);
  const bayType = toTrimmedString(query.bayType || query.type);

  const where = {};

  if (search) {
    where.bayName = { contains: search };
  }

  if (locationId) {
    where.locationId = locationId;
  }

  if (bayType) {
    where.bayType = bayType;
  }

  if (isActive !== undefined) {
    where.isActive = isActive;
  }

  const [bays, total] = await Promise.all([
    prisma.bay.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        location: {
          select: { locationName: true, locationCode: true }
        },
        status: {
          select: { statusName: true, statusCode: true }
        }
      }
    }),
    prisma.bay.count({ where })
  ]);
  const activeBayIds = await resolveActiveBayIds(bays.map((bay) => bay.id));

  return {
    bays: bays.map((bay) => toBayResource(bay, activeBayIds)),
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  };
};

const getBayDropdown = async (query = {}) => {
  const locationId = parsePositiveInt(query.locationId, undefined);
  const bayType = toTrimmedString(query.bayType || query.type);
  const where = { isActive: true };

  if (locationId) {
    where.locationId = locationId;
  }

  if (bayType) {
    where.bayType = bayType;
  }

  const bays = await prisma.bay.findMany({
    where,
    select: { id: true, bayName: true, bayType: true, bayCode: true, currentWorkAssignmentId: true },
    orderBy: { bayName: 'asc' }
  });
  const activeBayIds = await resolveActiveBayIds(bays.map((bay) => bay.id));

  return bays
    .map((bay) => toBayResource(bay, activeBayIds))
    .sort((a, b) => {
      if (a.availability !== b.availability) {
        return a.availability === 'AVAILABLE' ? -1 : 1;
      }
      return String(a.bayName || '').localeCompare(String(b.bayName || ''));
    });
};

const updateBayStatus = async (id, payload, actorUserId) => {
  const bayId = Number(id);
  const existingBay = await prisma.bay.findUnique({
    where: { id: bayId }
  });

  if (!existingBay) {
    throw createHttpError(404, 'Bay not found');
  }

  const { isActive } = payload;

  if (existingBay.isActive === isActive) {
    return existingBay;
  }

  const updatedBay = await prisma.bay.update({
    where: { id: bayId },
    data: {
      isActive,
      updatedAt: new Date()
    }
  });

  await createAuditLog(prisma, {
    tableName: 'bays',
    recordId: updatedBay.id,
    actionType: isActive ? 'ACTIVATE' : 'DEACTIVATE',
    performedByUserId: actorUserId,
    recordName: updatedBay.bayName,
    comments: isActive ? 'Bay activated' : 'Bay deactivated',
    locationId: updatedBay.locationId,
    details: buildChangeDetails({ isActive: existingBay.isActive }, { isActive: updatedBay.isActive }, ['isActive'])
  }).catch((err) => console.error('Failed to create audit log:', err));

  return updatedBay;
};

module.exports = {
  createBay,
  updateBay,
  listBays,
  getBayDropdown,
  updateBayStatus
};
