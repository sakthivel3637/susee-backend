const prisma = require('../../config/db');
const { generateSlug, generateUniqueSlug } = require('../../common/utils/slug.util');
const { buildChangeDetails, createAuditLog } = require('../../common/utils/audit.util');

const roleSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  isActive: true,
  createdById: true,
  modifiedById: true,
  createdAt: true,
  updatedAt: true
};

const ADMIN_MODULE = 'admin';
const MANAGER_MODULE = 'manager';
const MANAGING_DIRECTOR_MODULE = 'managing-director';

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
  if (value === undefined || value === '') {
    return undefined;
  }

  if (value === true || value === 'true') {
    return true;
  }

  if (value === false || value === 'false') {
    return false;
  }

  return undefined;
};

const getRoleModules = async (roleId) => {
  if (!roleId) {
    return new Set();
  }

  const permissions = await prisma.roleMenuPermission.findMany({
    where: {
      roleId,
      canRead: true,
      menu: {
        isActive: true
      }
    },
    select: {
      menu: {
        select: {
          module: true
        }
      }
    }
  });

  return new Set(permissions.map((permission) => permission.menu.module));
};

const getRestrictedModulesForActor = async (actor) => {
  const actorModules = await getRoleModules(actor && actor.roleId);

  if (actorModules.has(ADMIN_MODULE)) {
    return [];
  }

  const restrictedModules = [ADMIN_MODULE];

  if (actorModules.has(MANAGER_MODULE) || actorModules.has(MANAGING_DIRECTOR_MODULE)) {
    restrictedModules.push(MANAGING_DIRECTOR_MODULE);
  }

  return restrictedModules;
};

const buildRoleWhere = ({ search, isActive, excludedModules } = {}) => {
  const where = {};
  const andFilters = [];

  if (typeof isActive === 'boolean') {
    where.isActive = isActive;
  }

  if (search) {
    where.OR = [
      { name: { contains: search } },
      { slug: { contains: search } },
      { description: { contains: search } }
    ];
  }

  if (excludedModules && excludedModules.length > 0) {
    andFilters.push({
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

  if (andFilters.length > 0) {
    where.AND = andFilters;
  }

  return where;
};

const resolveRoleByIdentifier = async (identifier) => {
  const parsedId = Number(identifier);
  const where = Number.isInteger(parsedId) && parsedId > 0
    ? { id: parsedId }
    : { slug: String(identifier || '').trim() };

  const role = await prisma.role.findUnique({
    where,
    select: roleSelect
  });

  if (!role) {
    throw createHttpError(404, 'Role not found');
  }

  return role;
};

const ensureUniqueRoleName = async (name, excludeId) => {
  const existingRole = await prisma.role.findFirst({
    where: {
      name,
      ...(excludeId ? { id: { not: excludeId } } : {})
    },
    select: { id: true }
  });

  if (existingRole) {
    throw createHttpError(409, 'Role name already exists');
  }
};

const resolveRoleSlug = async (name, excludeId) => {
  const baseSlug = generateSlug(name);

  if (!baseSlug) {
    throw createHttpError(400, 'Valid role slug could not be generated from role name');
  }

  return generateUniqueSlug(baseSlug, (slugValue) => {
    return prisma.role.findFirst({
      where: {
        slug: slugValue,
        ...(excludeId ? { id: { not: excludeId } } : {})
      },
      select: { id: true }
    });
  });
};

const ensureRoleCanBeInactivated = async (roleId, isActive) => {
  if (isActive === false) {
    const activeUsers = await prisma.user.findFirst({
      where: { roleId, isActive: true },
      select: { id: true }
    });
    if (activeUsers) {
      throw createHttpError(400, 'Cannot deactivate this role because it is currently assigned to active users.');
    }
  }
};

const createRole = async ({ name, description, isActive }, actorUserId) => {
  const normalizedName = name.trim();
  const normalizedSlug = await resolveRoleSlug(normalizedName);

  await ensureUniqueRoleName(normalizedName);

  return prisma.$transaction(async (tx) => {
    const role = await tx.role.create({
      data: {
        name: normalizedName,
        slug: normalizedSlug,
        description: description ? description.trim() : null,
        isActive: typeof isActive === 'boolean' ? isActive : true,
        createdById: actorUserId || null
      },
      select: roleSelect
    });

    await createAuditLog(tx, {
      tableName: 'roles',
      recordId: role.id,
      actionType: 'CREATE',
      performedByUserId: actorUserId,
      recordName: role.name,
      comments: 'Role created',
      details: [
        { fieldName: 'name', oldValue: null, newValue: role.name, dataType: 'string' },
        { fieldName: 'slug', oldValue: null, newValue: role.slug, dataType: 'string' },
        { fieldName: 'description', oldValue: null, newValue: role.description, dataType: 'string' },
        { fieldName: 'isActive', oldValue: null, newValue: role.isActive, dataType: 'boolean' }
      ]
    });

    return role;
  });
};

const updateRole = async (id, { name, description, isActive }, actorUserId) => {
  const currentRole = await resolveRoleByIdentifier(id);
  const roleId = currentRole.id;
  const normalizedName = name.trim();
  const normalizedSlug = await resolveRoleSlug(normalizedName, roleId);

  await ensureUniqueRoleName(normalizedName, roleId);

  const nextData = {
    name: normalizedName,
    slug: normalizedSlug,
    description: description ? description.trim() : null,
    modifiedById: actorUserId || null
  };

  if (typeof isActive === 'boolean') {
    await ensureRoleCanBeInactivated(roleId, isActive);
    nextData.isActive = isActive;
  }

  return prisma.$transaction(async (tx) => {
    const role = await tx.role.update({
      where: { id: roleId },
      data: nextData,
      select: roleSelect
    });

    const details = buildChangeDetails(currentRole, role, [
      'name',
      'slug',
      'description',
      'isActive'
    ]);

    if (details.length > 0) {
      await createAuditLog(tx, {
        tableName: 'roles',
        recordId: role.id,
        actionType: 'UPDATE',
        performedByUserId: actorUserId,
        recordName: role.name,
        comments: 'Role updated',
        details
      });
    }

    return role;
  });
};

const listRoles = async (query, actor) => {
  const page = parsePositiveInt(query.page, 1);
  const limit = parsePositiveInt(query.limit, 10);
  const search = query.search ? query.search.trim() : undefined;
  const isActive = parseBooleanFilter(query.isActive);
  const excludedModules = await getRestrictedModulesForActor(actor);
  const where = buildRoleWhere({ search, isActive, excludedModules });
  const skip = (page - 1) * limit;

  const [roles, total] = await prisma.$transaction([
    prisma.role.findMany({
      where,
      select: roleSelect,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    }),
    prisma.role.count({ where })
  ]);

  return {
    roles,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
};

const getRoleDetail = async (id) => {
  return resolveRoleByIdentifier(id);
};

const updateRoleStatus = async (id, { isActive }, actorUserId) => {
  const currentRole = await resolveRoleByIdentifier(id);
  const roleId = currentRole.id;

  await ensureRoleCanBeInactivated(roleId, isActive);

  return prisma.$transaction(async (tx) => {
    const role = await tx.role.update({
      where: { id: roleId },
      data: {
        isActive,
        modifiedById: actorUserId || null
      },
      select: roleSelect
    });

    await createAuditLog(tx, {
      tableName: 'roles',
      recordId: role.id,
      actionType: isActive ? 'ACTIVATE' : 'DEACTIVATE',
      performedByUserId: actorUserId,
      recordName: role.name,
      comments: isActive ? 'Role activated' : 'Role deactivated',
      details: buildChangeDetails(currentRole, role, ['isActive', 'modifiedById'])
    });

    return role;
  });
};

module.exports = {
  createRole,
  updateRole,
  listRoles,
  getRoleDetail,
  updateRoleStatus
};
