const { parsePositiveInt, prisma } = require('../common');

const listStates = () => {
  return prisma.state.findMany({
    where: { isActive: true },
    select: {
      id: true,
      stateName: true,
      stateCode: true
    },
    orderBy: { stateName: 'asc' }
  });
};

const listDistricts = (query = {}) => {
  const stateId = parsePositiveInt(query.stateId, undefined);

  return prisma.district.findMany({
    where: {
      isActive: true,
      ...(stateId ? { stateId } : {})
    },
    select: {
      id: true,
      stateId: true,
      districtName: true
    },
    orderBy: { districtName: 'asc' }
  });
};

const listServiceCategories = () => {
  return prisma.serviceCategory.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      slug: true
    },
    orderBy: { name: 'asc' }
  });
};

const listServiceItems = (query = {}) => {
  const categoryId = parsePositiveInt(query.categoryId, undefined);

  return prisma.serviceItem.findMany({
    where: {
      isActive: true,
      ...(categoryId ? { categoryId } : {})
    },
    select: {
      id: true,
      categoryId: true,
      name: true,
      slug: true,
      defaultPrice: true,
      estimatedMinutes: true
    },
    orderBy: { name: 'asc' }
  });
};

const listServiceCenters = () => {
  return prisma.serviceCenter.findMany({
    where: { isActive: true },
    select: {
      id: true,
      serviceCenterCode: true,
      serviceCenterName: true
    },
    orderBy: { serviceCenterName: 'asc' }
  });
};

const listLocations = (query = {}) => {
  const serviceCenterId = parsePositiveInt(query.serviceCenterId, undefined);

  return prisma.location.findMany({
    where: {
      isActive: true,
      ...(serviceCenterId ? { serviceCenterId } : {})
    },
    select: {
      id: true,
      serviceCenterId: true,
      stateId: true,
      districtId: true,
      locationCode: true,
      locationName: true,
      locationType: true,
      city: true
    },
    orderBy: { locationName: 'asc' }
  });
};

const listStatuses = (query = {}) => {
  const moduleCode = String(query.moduleCode || '').trim().toLowerCase();

  return prisma.statusMaster.findMany({
    where: {
      isActive: true,
      ...(moduleCode
        ? {
          module: {
            is: {
              moduleCode,
              isActive: true
            }
          }
        }
        : {})
    },
    select: {
      id: true,
      moduleId: true,
      statusCode: true,
      statusName: true,
      slug: true,
      sortOrder: true,
      isFinal: true,
      module: {
        select: {
          id: true,
          moduleCode: true,
          moduleName: true
        }
      }
    },
    orderBy: [
      { moduleId: 'asc' },
      { sortOrder: 'asc' },
      { id: 'asc' }
    ]
  });
};

module.exports = {
  listStates,
  listDistricts,
  listServiceCategories,
  listServiceItems,
  listServiceCenters,
  listLocations,
  listStatuses
};
