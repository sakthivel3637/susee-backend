const prisma = require('../../config/db');

const categorySelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  isActive: true,
  createdAt: true,
  updatedAt: true
};

const buildCategoryWhere = ({ search, isActive } = {}) => {
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

const createCategory = (data, tx = prisma) => {
  return tx.serviceCategory.create({
    data,
    select: categorySelect
  });
};

const updateCategory = (id, data, tx = prisma) => {
  return tx.serviceCategory.update({
    where: { id },
    data,
    select: categorySelect
  });
};

const findCategoryById = (id, onlyActive = false) => {
  return prisma.serviceCategory.findFirst({
    where: {
      id,
      ...(onlyActive ? { isActive: true } : {})
    },
    select: categorySelect
  });
};

const findCategoryBySlug = (slug, excludeId) => {
  return prisma.serviceCategory.findFirst({
    where: {
      slug,
      ...(excludeId ? { id: { not: excludeId } } : {})
    },
    select: categorySelect
  });
};

const findCategoryByIdentifier = (identifier, onlyActive = false) => {
  const parsedId = Number(identifier);
  const isNumericId = Number.isInteger(parsedId) && parsedId > 0;

  return prisma.serviceCategory.findFirst({
    where: {
      ...(isNumericId ? { id: parsedId } : { slug: String(identifier).trim() }),
      ...(onlyActive ? { isActive: true } : {})
    },
    select: categorySelect
  });
};

const countActiveServiceItems = (categoryId) => {
  return prisma.serviceItem.count({
    where: {
      categoryId,
      isActive: true
    }
  });
};

const deactivateCategoryAndItems = async (categoryId) => {
  const [, category] = await prisma.$transaction([
    prisma.serviceItem.updateMany({
      where: {
        categoryId,
        isActive: true
      },
      data: { isActive: false }
    }),
    prisma.serviceCategory.update({
      where: { id: categoryId },
      data: { isActive: false },
      select: categorySelect
    })
  ]);

  return category;
};

const listCategories = async ({ page, limit, search, isActive }) => {
  const where = buildCategoryWhere({ search, isActive });
  const skip = (page - 1) * limit;

  const [categories, total] = await prisma.$transaction([
    prisma.serviceCategory.findMany({
      where,
      select: categorySelect,
      orderBy: { id: 'desc' },
      skip,
      take: limit
    }),
    prisma.serviceCategory.count({ where })
  ]);

  return { categories, total };
};

module.exports = {
  createCategory,
  updateCategory,
  findCategoryById,
  findCategoryBySlug,
  findCategoryByIdentifier,
  countActiveServiceItems,
  deactivateCategoryAndItems,
  listCategories
};
