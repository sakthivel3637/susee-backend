const serviceItemRepository = require('./service-item.repository');
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

const parseOptionalPositiveInt = (value) => {
  if (value === undefined || value === '') {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};



const toServiceItemResource = (serviceItem) => ({
  id: serviceItem.id,
  categoryId: serviceItem.categoryId,
  name: serviceItem.name,
  slug: serviceItem.slug,
  description: serviceItem.description,
  basePrice: Number(serviceItem.defaultPrice),
  estimatedMinutes: serviceItem.estimatedMinutes,
  isActive: serviceItem.isActive,
  createdAt: serviceItem.createdAt,
  updatedAt: serviceItem.updatedAt,
  category: serviceItem.category
    ? {
      id: serviceItem.category.id,
      name: serviceItem.category.name,
      slug: serviceItem.category.slug
    }
    : null
});

const ensureServiceItemExists = async (id, options = {}) => {
  const serviceItem = await serviceItemRepository.findServiceItemById(id, options);

  if (!serviceItem) {
    throw createHttpError(404, 'Service item not found');
  }

  return serviceItem;
};

const ensureServiceItemExistsByIdentifier = async (identifier, options = {}) => {
  const serviceItem = await serviceItemRepository.findServiceItemByIdentifier(identifier, options);

  if (!serviceItem) {
    throw createHttpError(404, 'Service item not found');
  }

  return serviceItem;
};

const ensureUniqueServiceItemSlug = async (slug, excludeId) => {
  const existingServiceItem = await serviceItemRepository.findServiceItemBySlug(slug, excludeId);

  if (existingServiceItem) {
    throw createHttpError(409, 'Service item slug already exists');
  }
};

const resolveServiceItemSlug = async ({ name, slug, excludeId }) => {
  const sourceSlug = slug ? slug : name;
  const normalizedSlug = generateSlug(sourceSlug);

  if (!normalizedSlug) {
    throw createHttpError(400, 'Valid service item slug is required');
  }

  if (slug) {
    await ensureUniqueServiceItemSlug(normalizedSlug, excludeId);
    return normalizedSlug;
  }

  return generateUniqueSlug(normalizedSlug, (slugValue) => {
    return serviceItemRepository.findServiceItemBySlug(slugValue, excludeId);
  });
};

const ensureActiveCategoryExists = async (categoryId) => {
  const category = await serviceItemRepository.findCategoryById(categoryId);

  if (!category) {
    throw createHttpError(404, 'Service category not found');
  }

  if (!category.isActive) {
    throw createHttpError(400, 'Cannot create or assign service item under inactive category');
  }

  return category;
};

const buildServiceItemData = async ({ categoryId, name, slug, description, basePrice, estimatedMinutes }, excludeId) => {
  const normalizedName = name.trim();
  const normalizedSlug = await resolveServiceItemSlug({ name: normalizedName, slug, excludeId });

  return {
    categoryId: Number(categoryId),
    name: normalizedName,
    slug: normalizedSlug,
    description: description ? description.trim() : null,
    defaultPrice: basePrice === undefined || basePrice === null || basePrice === '' ? 0 : Number(basePrice),
    estimatedMinutes:
      estimatedMinutes === undefined || estimatedMinutes === null || estimatedMinutes === ''
        ? null
        : Number(estimatedMinutes)
  };
};

const createServiceItem = async (payload, actorUserId) => {
  const data = await buildServiceItemData(payload);

  await ensureActiveCategoryExists(data.categoryId);

  const existingWithSameName = await prisma.serviceItem.findFirst({
    where: {
      categoryId: data.categoryId,
      name: data.name
    }
  });
  if (existingWithSameName) {
    throw createHttpError(409, 'Service Item Name under this Category Group already exists');
  }

  return prisma.$transaction(async (tx) => {
    const serviceItem = await serviceItemRepository.createServiceItem(data, tx);

    await createAuditLog(tx, {
      moduleCode: 'service-items',
      moduleName: 'Service Items',
      tableName: 'service_items',
      recordId: serviceItem.id,
      actionType: 'CREATE',
      performedByUserId: actorUserId,
      recordName: serviceItem.name,
      comments: 'Service item created',
      details: Object.entries(data).map(([fieldName, newValue]) => ({
        fieldName,
        oldValue: null,
        newValue,
        dataType: typeof newValue
      }))
    });

    return toServiceItemResource(serviceItem);
  });
};

const updateServiceItem = async (identifier, payload, actorUserId) => {
  const existingServiceItem = await ensureServiceItemExistsByIdentifier(identifier);
  const data = await buildServiceItemData(payload, existingServiceItem.id);

  await ensureActiveCategoryExists(data.categoryId);

  const existingWithSameName = await prisma.serviceItem.findFirst({
    where: {
      categoryId: data.categoryId,
      name: data.name,
      id: { not: existingServiceItem.id }
    }
  });
  if (existingWithSameName) {
    throw createHttpError(409, 'Service Item Name under this Category Group already exists');
  }

  return prisma.$transaction(async (tx) => {
    const serviceItem = await serviceItemRepository.updateServiceItem(existingServiceItem.id, data, tx);

    await createAuditLog(tx, {
      moduleCode: 'service-items',
      moduleName: 'Service Items',
      tableName: 'service_items',
      recordId: serviceItem.id,
      actionType: 'UPDATE',
      performedByUserId: actorUserId,
      recordName: serviceItem.name,
      comments: 'Service item updated',
      details: buildChangeDetails(existingServiceItem, serviceItem, Object.keys(data))
    });

    return toServiceItemResource(serviceItem);
  });
};

const listServiceItems = async (query, user) => {
  const page = parsePositiveInt(query.page, 1);
  const limit = parsePositiveInt(query.limit, 10);
  const search = query.search ? query.search.trim() : undefined;
  const categoryId = parseOptionalPositiveInt(query.categoryId);
  const isActive = parseBooleanFilter(query.isActive);

  const { serviceItems, total } = await serviceItemRepository.listServiceItems({
    page,
    limit,
    search,
    categoryId,
    isActive
  });

  return {
    serviceItems: serviceItems.map(toServiceItemResource),
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
};

const getServiceItemDetail = async (identifier, user) => {
  const serviceItem = await ensureServiceItemExistsByIdentifier(identifier, {});
  return toServiceItemResource(serviceItem);
};

const updateServiceItemStatus = async (id, { isActive }, actorUserId) => {
  const serviceItemId = Number(id);
  const serviceItem = await ensureServiceItemExists(serviceItemId);

  if (isActive) {
    await ensureActiveCategoryExists(serviceItem.categoryId);
  }

  return prisma.$transaction(async (tx) => {
    const updatedServiceItem = await serviceItemRepository.updateServiceItem(serviceItemId, { isActive }, tx);

    await createAuditLog(tx, {
      moduleCode: 'service-items',
      moduleName: 'Service Items',
      tableName: 'service_items',
      recordId: updatedServiceItem.id,
      actionType: isActive ? 'ACTIVATE' : 'DEACTIVATE',
      performedByUserId: actorUserId,
      recordName: updatedServiceItem.name,
      comments: isActive ? 'Service item activated' : 'Service item deactivated',
      details: buildChangeDetails(serviceItem, updatedServiceItem, ['isActive'])
    });

    return toServiceItemResource(updatedServiceItem);
  });
};

module.exports = {
  createServiceItem,
  updateServiceItem,
  listServiceItems,
  getServiceItemDetail,
  updateServiceItemStatus
};
