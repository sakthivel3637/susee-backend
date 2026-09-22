const categoryRepository = require('./service-category.repository');
const { generateSlug, generateUniqueSlug } = require('../../common/utils/slug.util');
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

const parseForceFlag = (value) => value === true || value === 'true';



const ensureCategoryExists = async (id, onlyActive = false) => {
  const category = await categoryRepository.findCategoryById(id, onlyActive);

  if (!category) {
    throw createHttpError(404, 'Service category not found');
  }

  return category;
};

const ensureCategoryExistsByIdentifier = async (identifier, onlyActive = false) => {
  const category = await categoryRepository.findCategoryByIdentifier(identifier, onlyActive);

  if (!category) {
    throw createHttpError(404, 'Service category not found');
  }

  return category;
};

const ensureUniqueCategorySlug = async (slug, excludeId) => {
  const existingCategory = await categoryRepository.findCategoryBySlug(slug, excludeId);

  if (existingCategory) {
    throw createHttpError(409, 'Service category slug already exists');
  }
};

const resolveCategorySlug = async ({ name, slug, excludeId }) => {
  const sourceSlug = slug ? slug : name;
  const normalizedSlug = generateSlug(sourceSlug);

  if (!normalizedSlug) {
    throw createHttpError(400, 'Valid service category slug is required');
  }

  if (slug) {
    await ensureUniqueCategorySlug(normalizedSlug, excludeId);
    return normalizedSlug;
  }

  return generateUniqueSlug(normalizedSlug, (slugValue) => {
    return categoryRepository.findCategoryBySlug(slugValue, excludeId);
  });
};

const createCategory = async ({ name, slug, description }, actorUserId) => {
  const normalizedName = name.trim();
  const normalizedSlug = await resolveCategorySlug({ name: normalizedName, slug });

  return prisma.$transaction(async (tx) => {
    const data = {
      name: normalizedName,
      slug: normalizedSlug,
      description: description ? description.trim() : null
    };

    const category = await categoryRepository.createCategory(data, tx);

    await createAuditLog(tx, {
      moduleCode: 'service-categories',
      moduleName: 'Service Categories',
      tableName: 'service_categories',
      recordId: category.id,
      actionType: 'CREATE',
      performedByUserId: actorUserId,
      recordName: category.name,
      comments: 'Service category created',
      details: Object.entries(data).map(([fieldName, newValue]) => ({
        fieldName,
        oldValue: null,
        newValue,
        dataType: typeof newValue
      }))
    });

    return category;
  });
};

const updateCategory = async (identifier, { name, slug, description }, actorUserId) => {
  const category = await ensureCategoryExistsByIdentifier(identifier);

  const normalizedName = name.trim();
  const normalizedSlug = await resolveCategorySlug({ name: normalizedName, slug, excludeId: category.id });

  return prisma.$transaction(async (tx) => {
    const data = {
      name: normalizedName,
      slug: normalizedSlug,
      description: description ? description.trim() : null
    };

    const updatedCategory = await categoryRepository.updateCategory(category.id, data, tx);

    await createAuditLog(tx, {
      moduleCode: 'service-categories',
      moduleName: 'Service Categories',
      tableName: 'service_categories',
      recordId: updatedCategory.id,
      actionType: 'UPDATE',
      performedByUserId: actorUserId,
      recordName: updatedCategory.name,
      comments: 'Service category updated',
      details: buildChangeDetails(category, updatedCategory, Object.keys(data))
    });

    return updatedCategory;
  });
};

const listCategories = async (query) => {
  const page = parsePositiveInt(query.page, 1);
  const limit = parsePositiveInt(query.limit, 10);
  const search = query.search ? query.search.trim() : undefined;
  const isActive = parseBooleanFilter(query.isActive);

  const { categories, total } = await categoryRepository.listCategories({
    page,
    limit,
    search,
    isActive
  });

  return {
    categories,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
};

const getCategoryDetail = async (identifier, user) => {
  return ensureCategoryExistsByIdentifier(identifier, shouldRestrictToActive(user));
};

const updateCategoryStatus = async (id, { isActive }, query = {}, actorUserId) => {
  const categoryId = Number(id);
  const currentCategory = await ensureCategoryExists(categoryId);

  if (!isActive) {
    const activeServiceItemCount = await categoryRepository.countActiveServiceItems(categoryId);
    const force = parseForceFlag(query.force);

    if (activeServiceItemCount > 0 && !force) {
      throw createHttpError(
        409,
        'Service category has active service items. Pass force=true to deactivate category and its active service items'
      );
    }

    if (activeServiceItemCount > 0 && force) {
      return prisma.$transaction(async (tx) => {
        const category = await categoryRepository.deactivateCategoryAndItems(categoryId, tx);

        await createAuditLog(tx, {
          moduleCode: 'service-categories',
          moduleName: 'Service Categories',
          tableName: 'service_categories',
          recordId: category.id,
          actionType: 'DEACTIVATE',
          performedByUserId: actorUserId,
          recordName: category.name,
          comments: 'Service category deactivated with items',
          details: buildChangeDetails(currentCategory, category, ['isActive'])
        });

        return category;
      });
    }
  }

  return prisma.$transaction(async (tx) => {
    const category = await categoryRepository.updateCategory(categoryId, { isActive }, tx);

    await createAuditLog(tx, {
      moduleCode: 'service-categories',
      moduleName: 'Service Categories',
      tableName: 'service_categories',
      recordId: category.id,
      actionType: isActive ? 'ACTIVATE' : 'DEACTIVATE',
      performedByUserId: actorUserId,
      recordName: category.name,
      comments: isActive ? 'Service category activated' : 'Service category deactivated',
      details: buildChangeDetails(currentCategory, category, ['isActive'])
    });

    return category;
  });
};

module.exports = {
  createCategory,
  updateCategory,
  listCategories,
  getCategoryDetail,
  updateCategoryStatus
};
