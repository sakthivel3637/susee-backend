const prisma = require('../../config/db');

const userSelect = {
  id: true,
  fullName: true,
  slug: true,
  emailId: true,
  mobileNo: true,
  employeeCode: true,
  isActive: true,
  roleId: true,
  locationId: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true,
  dob: true,
  licenceNumber: true,
  emergencyContact: true,
  gender: true,
  address: true,
  role: {
    select: {
      id: true,
      name: true,
      slug: true
    }
  },
  location: {
    select: {
      id: true,
      locationCode: true,
      locationName: true
    }
  }
};

const userWithRoleForChecksSelect = {
  ...userSelect,
  role: {
    select: {
      id: true,
      name: true,
      slug: true,
      isActive: true
    }
  }
};

const buildUserWhere = ({ search, roleId, locationId, isActive, excludedModules, excludedUserId, fromDate, toDate } = {}) => {
  const where = {};
  const roleFilters = [];

  if (typeof isActive === 'boolean') {
    where.isActive = isActive;
  }

  if (roleId) {
    where.roleId = roleId;
  }

  if (locationId) {
    where.locationId = locationId;
  }

  if (excludedUserId) {
    where.id = {
      not: excludedUserId
    };
  }

  if (fromDate || toDate) {
    where.createdAt = {};
    if (fromDate) {
      where.createdAt.gte = new Date(fromDate);
    }
    if (toDate) {
      const endOfDay = new Date(toDate);
      endOfDay.setUTCHours(23, 59, 59, 999);
      where.createdAt.lte = endOfDay;
    }
  }

  if (excludedModules && excludedModules.length > 0) {
    roleFilters.push({
      NOT: {
        rolePermissions: {
          some: {
            menu: {
              module: {
                in: excludedModules
              }
            }
          }
        }
      }
    });
  }

  if (roleFilters.length > 0) {
    where.role = {
      AND: roleFilters
    };
  }

  if (search) {
    where.OR = [
      { fullName: { contains: search } },
      { slug: { contains: search } },
      { emailId: { contains: search } },
      { mobileNo: { contains: search } },
      { employeeCode: { contains: search } }
    ];
  }

  return where;
};

const createUser = (data, tx = prisma) => {
  return tx.user.create({
    data,
    select: userSelect
  });
};

const updateUser = (id, data, tx = prisma) => {
  return tx.user.update({
    where: { id },
    data,
    select: userSelect
  });
};

const findUserById = (id) => {
  return prisma.user.findUnique({
    where: { id },
    select: userWithRoleForChecksSelect
  });
};

const findUserBySlug = (slug) => {
  return prisma.user.findUnique({
    where: { slug },
    select: userWithRoleForChecksSelect
  });
};

const findUserByEmail = (email, excludeId) => {
  return prisma.user.findFirst({
    where: {
      emailId: email,
      ...(excludeId ? { id: { not: excludeId } } : {})
    },
    select: userSelect
  });
};

const findUserByMobile = (mobile, excludeId) => {
  return prisma.user.findFirst({
    where: {
      mobileNo: mobile,
      ...(excludeId ? { id: { not: excludeId } } : {})
    },
    select: userSelect
  });
};

const findUserByLicenceNumber = (licenceNumber, excludeId) => {
  return prisma.user.findFirst({
    where: {
      licenceNumber,
      ...(excludeId ? { id: { not: excludeId } } : {})
    },
    select: userSelect
  });
};

const findUserByEmployeeCode = (employeeCode, excludeId) => {
  return prisma.user.findFirst({
    where: {
      employeeCode,
      ...(excludeId ? { id: { not: excludeId } } : {})
    },
    select: userSelect
  });
};

const findRoleById = (roleId) => {
  return prisma.role.findUnique({
    where: { id: roleId },
    select: {
      id: true,
      name: true,
      slug: true,
      isActive: true
    }
  });
};

const findActiveLocationById = (locationId) => {
  return prisma.location.findFirst({
    where: {
      id: locationId,
      isActive: true
    },
    select: {
      id: true,
      locationCode: true,
      locationName: true
    }
  });
};

const countActiveAdmins = () => {
  return prisma.user.count({
    where: {
      isActive: true,
      role: {
        slug: {
          in: ['admin', 'super_admin']
        }
      }
    }
  });
};

const listUsers = async ({ page, limit, search, roleId, locationId, isActive, excludedModules, excludedUserId, fromDate, toDate }) => {
  const where = buildUserWhere({
    search,
    roleId,
    locationId,
    isActive,
    excludedModules,
    excludedUserId,
    fromDate,
    toDate
  });
  const skip = (page - 1) * limit;

  const [users, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: userSelect,
      orderBy: { id: 'desc' },
      skip,
      take: limit
    }),
    prisma.user.count({ where })
  ]);

  return { users, total };
};

const findLatestEmployeeCode = () => {
  return prisma.user.findFirst({
    orderBy: { id: 'desc' },
    select: { employeeCode: true }
  });
};

module.exports = {
  createUser,
  updateUser,
  findUserById,
  findUserBySlug,
  findUserByEmail,
  findUserByMobile,
  findUserByLicenceNumber,
  findUserByEmployeeCode,
  findRoleById,
  findActiveLocationById,
  countActiveAdmins,
  listUsers,
  findLatestEmployeeCode
};
