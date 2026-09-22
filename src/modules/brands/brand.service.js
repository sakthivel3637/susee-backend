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
  if (value === 'all') return undefined;
  if (value === undefined || value === '') return true;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return true;
};



const createBrand = async (payload, actorUserId) => {
  const name = payload.name.trim();

  // Check if name already exists
  const existing = await prisma.vehicleBrand.findFirst({
    where: { name: { equals: name } }
  });

  if (existing) {
    throw createHttpError(409, 'Brand with this name already exists');
  }

  const slug = await generateUniqueSlug(name, async (candidateSlug) => {
    const exists = await prisma.vehicleBrand.findUnique({ where: { slug: candidateSlug } });
    return !!exists;
  });

  const brand = await prisma.vehicleBrand.create({
    data: {
      name,
      slug,
      isActive: true,
      createdById: actorUserId,
      modifiedById: actorUserId
    }
  });

  await createAuditLog(prisma, {
    tableName: 'vehicle_brands',
    recordId: brand.id,
    actionType: 'CREATE',
    performedByUserId: actorUserId,
    recordName: brand.name
  }).catch((err) => console.error('Failed to create audit log:', err));

  return brand;
};

const updateBrand = async (identifier, payload, actorUserId) => {
  const isId = !Number.isNaN(Number(identifier));
  const where = isId ? { id: Number(identifier) } : { slug: identifier };

  const existingBrand = await prisma.vehicleBrand.findUnique({ where });

  if (!existingBrand) {
    throw createHttpError(404, 'Brand not found');
  }

  const name = payload.name.trim();
  let slug = existingBrand.slug;

  if (name.toLowerCase() !== existingBrand.name.toLowerCase()) {
    const duplicate = await prisma.vehicleBrand.findFirst({
      where: {
        name: { equals: name },
        id: { not: existingBrand.id }
      }
    });

    if (duplicate) {
      throw createHttpError(409, 'Brand with this name already exists');
    }
    slug = await generateUniqueSlug(name, async (candidateSlug) => {
      const exists = await prisma.vehicleBrand.findFirst({
        where: {
          slug: candidateSlug,
          id: { not: existingBrand.id }
        }
      });
      return !!exists;
    });
  }

  const updatedBrand = await prisma.vehicleBrand.update({
    where: { id: existingBrand.id },
    data: {
      name,
      slug,
      modifiedById: actorUserId
    }
  });

  await createAuditLog(prisma, {
    tableName: 'vehicle_brands',
    recordId: updatedBrand.id,
    actionType: 'UPDATE',
    performedByUserId: actorUserId,
    recordName: updatedBrand.name,
    details: buildChangeDetails(existingBrand, updatedBrand, ['name', 'slug'])
  }).catch((err) => console.error('Failed to create audit log:', err));

  return updatedBrand;
};

const listBrands = async (query, user) => {
  const page = parsePositiveInt(query.page, 1);
  const limit = parsePositiveInt(query.limit, 10);
  const skip = (page - 1) * limit;

  const search = query.search?.trim();
  const isActive = parseBooleanFilter(query.isActive);

  const where = {};

  if (search) {
    where.name = { contains: search };
  }

  if (isActive !== undefined) {
    where.isActive = isActive;
  }

  const [brands, total] = await Promise.all([
    prisma.vehicleBrand.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' }
    }),
    prisma.vehicleBrand.count({ where })
  ]);

  return {
    brands,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  };
};

const getBrandDropdown = async () => {
  const brands = await prisma.vehicleBrand.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' }
  });
  return brands;
};

const updateBrandStatus = async (id, payload, actorUserId) => {
  const brandId = Number(id);
  const existingBrand = await prisma.vehicleBrand.findUnique({
    where: { id: brandId },
    include: {
      vehicles: { select: { id: true }, take: 1 }
    }
  });

  if (!existingBrand) {
    throw createHttpError(404, 'Brand not found');
  }

  const { isActive } = payload;

  if (existingBrand.isActive === isActive) {
    return existingBrand;
  }

  // If deactivating, optionally check if any active vehicles use it
  if (!isActive && existingBrand.vehicles.length > 0) {
    throw createHttpError(400, 'Cannot deactivate brand because it is used by vehicles');
  }

  const updatedBrand = await prisma.vehicleBrand.update({
    where: { id: brandId },
    data: {
      isActive,
      modifiedById: actorUserId
    }
  });

  await createAuditLog(prisma, {
    tableName: 'vehicle_brands',
    recordId: updatedBrand.id,
    actionType: isActive ? 'ACTIVATE' : 'DEACTIVATE',
    performedByUserId: actorUserId,
    recordName: updatedBrand.name,
    details: buildChangeDetails({ isActive: existingBrand.isActive }, { isActive: updatedBrand.isActive }, ['isActive'])
  }).catch((err) => console.error('Failed to create audit log:', err));

  return updatedBrand;
};

module.exports = {
  createBrand,
  updateBrand,
  listBrands,
  getBrandDropdown,
  updateBrandStatus
};
