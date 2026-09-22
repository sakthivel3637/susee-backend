const prisma = require('../../config/db');

const roleSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  isActive: true,
  createdAt: true,
  updatedAt: true
};

const buildRoleWhere = ({ search, isActive } = {}) => {
  const where = {};

  if (typeof isActive === 'boolean') {
    where.isActive = isActive;
  }

  if (search) {
    where.OR = [
      { name: { contains: search } },
      { slug: { contains: search } }
    ];
  }

  return where;
};

const createRole = (data) => {
  return prisma.role.create({
    data,
    select: roleSelect
  });
};

const updateRole = (id, data) => {
  return prisma.role.update({
    where: { id },
    data,
    select: roleSelect
  });
};

const findRoleById = (id) => {
  return prisma.role.findUnique({
    where: { id },
    select: roleSelect
  });
};

const findRoleByName = (name, excludeId) => {
  return prisma.role.findFirst({
    where: {
      name,
      ...(excludeId ? { id: { not: excludeId } } : {})
    },
    select: roleSelect
  });
};

const findRoleBySlug = (slug, excludeId) => {
  return prisma.role.findFirst({
    where: {
      slug,
      ...(excludeId ? { id: { not: excludeId } } : {})
    },
    select: roleSelect
  });
};

const listRoles = async ({ page, limit, search, isActive }) => {
  const where = buildRoleWhere({ search, isActive });
  const skip = (page - 1) * limit;

  const [roles, total] = await prisma.$transaction([
    prisma.role.findMany({
      where,
      select: roleSelect,
      orderBy: { id: 'desc' },
      skip,
      take: limit
    }),
    prisma.role.count({ where })
  ]);

  return { roles, total };
};

module.exports = {
  createRole,
  updateRole,
  findRoleById,
  findRoleByName,
  findRoleBySlug,
  listRoles
};
