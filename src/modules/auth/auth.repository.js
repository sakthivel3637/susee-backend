const prisma = require('../../config/db');

const userWithRoleSelect = {
  id: true,
  roleId: true,
  locationId: true,
  fullName: true,
  emailId: true,
  mobileNo: true,
  passwordHash: true,
  isActive: true,
  lastLoginAt: true,
  role: {
    select: {
      id: true,
      name: true,
      slug: true,
      isActive: true
    }
  },
  location: {
    select: {
      id: true,
      locationName: true,
      locationCode: true
    }
  }
};

const findUserByEmailId = (emailId) => {
  return prisma.user.findUnique({
    where: { emailId },
    select: userWithRoleSelect
  });
};

const findUserById = (userId) => {
  return prisma.user.findUnique({
    where: { id: userId },
    select: userWithRoleSelect
  });
};

const updateLastLoginAt = (userId) => {
  return prisma.user.update({
    where: { id: userId },
    data: { lastLoginAt: new Date() },
    select: { id: true }
  });
};

const updatePassword = (userId, passwordHash) => {
  return prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
    select: { id: true }
  });
};

const findReadableMenusByRoleId = (roleId) => {
  return prisma.roleMenuPermission.findMany({
    where: {
      roleId,
      canRead: true,
      menu: {
        isActive: true
      }
    },
    select: {
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      menu: {
        select: {
          id: true,
          module: true,
          parentId: true,
          name: true,
          path: true,
          icon: true,
          sequence: true,
          isActive: true
        }
      }
    },
    orderBy: { id: 'asc' }
  });
};

const findActiveMenus = (modules) => {
  return prisma.menu.findMany({
    where: {
      isActive: true,
      ...(modules && modules.length > 0 ? { module: { in: modules } } : {})
    },
    select: {
      id: true,
      module: true,
      parentId: true,
      name: true,
      path: true,
      icon: true,
      sequence: true
    },
    orderBy: [
      { module: 'asc' },
      { sequence: 'asc' },
      { name: 'asc' }
    ]
  });
};

module.exports = {
  findUserByEmailId,
  findUserById,
  updateLastLoginAt,
  updatePassword,
  findReadableMenusByRoleId,
  findActiveMenus
};
