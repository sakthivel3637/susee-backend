const prisma = require('../../config/db');
const { createAuditLog, ensureAuditModule } = require('../../common/utils/audit.util');

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const permissionFields = ['canRead', 'canCreate', 'canUpdate', 'canDelete'];
const PERMISSION_TRANSACTION_OPTIONS = {
  maxWait: 20000,
  timeout: 50000
};

const isReadOnlyMenu = (menu) => {
  const path = String(menu?.path || '').toLowerCase();
  const name = String(menu?.name || '').toLowerCase();

  return path.includes('dashboard')
    || name.includes('dashboard')
    || path.includes('kiosk/tv')
    || name.includes('tv display')
    || path.includes('notifications')
    || name.includes('notification')
    || path.includes('audit-logs')
    || name.includes('audit log');
};

const resolveRoleByIdentifier = async (identifier) => {
  const parsedRoleId = Number(identifier);
  const where = Number.isInteger(parsedRoleId) && parsedRoleId > 0
    ? { id: parsedRoleId }
    : { slug: String(identifier || '').trim() };

  const role = await prisma.role.findUnique({
    where,
    select: {
      id: true,
      name: true,
      slug: true
    }
  });

  if (!role) {
    throw createHttpError(404, 'Role not found');
  }

  return role;
};

const ensureMenusExist = async (menuIds) => {
  const menus = await prisma.menu.findMany({
    where: { id: { in: menuIds } },
    select: { id: true, name: true, path: true }
  });

  if (menus.length !== menuIds.length) {
    const foundMenuIds = new Set(menus.map((menu) => menu.id));
    const missingMenuIds = menuIds.filter((menuId) => !foundMenuIds.has(menuId));
    throw createHttpError(400, `Invalid menuId values: ${missingMenuIds.join(', ')}`);
  }

  return new Map(menus.map((menu) => [menu.id, menu]));
};

const getExistingPermissionMap = async (roleId, menuIds) => {
  const permissions = await prisma.roleMenuPermission.findMany({
    where: {
      roleId,
      menuId: { in: menuIds }
    }
  });

  return new Map(permissions.map((permission) => [permission.menuId, permission]));
};

const buildPermissionAuditDetails = (oldPermission, newPermission) => {
  const details = [];

  permissionFields.forEach((fieldName) => {
    const oldValue = oldPermission ? oldPermission[fieldName] : null;
    const newValue = newPermission[fieldName];

    if (oldValue !== newValue) {
      details.push({
        fieldName,
        oldValue,
        newValue,
        dataType: 'boolean'
      });
    }
  });

  if (!oldPermission) {
    details.unshift(
      { fieldName: 'roleId', oldValue: null, newValue: newPermission.roleId, dataType: 'number' },
      { fieldName: 'menuId', oldValue: null, newValue: newPermission.menuId, dataType: 'number' }
    );
  }

  return details;
};

const formatPermissionResponse = (role, menus, permissionMap) => {
  const modules = new Map();

  menus.forEach((menu) => {
    if (!modules.has(menu.module)) {
      modules.set(menu.module, []);
    }

    const permission = permissionMap.get(menu.id);
    const readOnlyMenu = isReadOnlyMenu(menu);

    modules.get(menu.module).push({
      menuId: menu.id,
      parentId: menu.parentId,
      name: menu.name,
      path: menu.path,
      icon: menu.icon,
      sequence: menu.sequence,
      canRead: permission ? permission.canRead : false,
      canCreate: !readOnlyMenu && permission ? permission.canCreate : false,
      canUpdate: !readOnlyMenu && permission ? permission.canUpdate : false,
      canDelete: !readOnlyMenu && permission ? permission.canDelete : false
    });
  });

  return {
    role,
    modules: Array.from(modules.entries())
      .sort(([moduleA], [moduleB]) => moduleA.localeCompare(moduleB))
      .map(([module, moduleMenus]) => ({
        module,
        menus: moduleMenus.sort((a, b) => a.sequence - b.sequence || a.name.localeCompare(b.name))
      }))
  };
};

const saveRoleMenuPermissions = async (roleId, permissionPayload, actorUserId) => {
  const role = await resolveRoleByIdentifier(roleId);
  const parsedRoleId = role.id;
  const menuIds = permissionPayload.map((permission) => Number(permission.menuId));

  const menuMap = await ensureMenusExist(menuIds);

  const modules = new Set(Array.from(menuMap.values()).map(menu => menu.module));
  if (modules.size > 1) {
    throw createHttpError(400, 'All permissions must belong to a single module');
  }
  if (modules.size === 0) {
    throw createHttpError(400, 'Permissions payload cannot be empty');
  }

  const moduleName = Array.from(modules)[0];
  const mobileModules = ['crm-team', 'gate-security'];
  const isMobile = mobileModules.includes(moduleName);

  if (!isMobile) {
    const hasPrivilege = permissionPayload.some(
      (p) => p.canRead || p.canCreate || p.canUpdate || p.canDelete
    );
    if (!hasPrivilege) {
      throw createHttpError(400, 'At least one privilege must be assigned');
    }
  }

  const existingPermissionMap = await getExistingPermissionMap(parsedRoleId, menuIds);

  const permissions = await prisma.$transaction(async (tx) => {
    const savedPermissions = [];
    const auditModule = await ensureAuditModule(tx, {
      moduleCode: 'role-management',
      moduleName: 'Role Management'
    });

    for (const permission of permissionPayload) {
      const menuId = Number(permission.menuId);
      const menu = menuMap.get(menuId);
      const readOnlyMenu = isReadOnlyMenu(menu);
      const data = {
        roleId: parsedRoleId,
        menuId,
        canRead: permission.canRead,
        canCreate: readOnlyMenu ? false : permission.canCreate,
        canUpdate: readOnlyMenu ? false : permission.canUpdate,
        canDelete: readOnlyMenu ? false : permission.canDelete
      };

      const existingPermission = existingPermissionMap.get(menuId);

      if (existingPermission) {
        const hasChanges =
          existingPermission.canRead !== data.canRead ||
          existingPermission.canCreate !== data.canCreate ||
          existingPermission.canUpdate !== data.canUpdate ||
          existingPermission.canDelete !== data.canDelete;

        if (!hasChanges) {
          savedPermissions.push(existingPermission);
          continue; // Skip DB update and audit log entirely
        }
      }

      const savedPermission = await tx.roleMenuPermission.upsert({
        where: {
          roleId_menuId: {
            roleId: parsedRoleId,
            menuId
          }
        },
        update: {
          canRead: data.canRead,
          canCreate: data.canCreate,
          canUpdate: data.canUpdate,
          canDelete: data.canDelete
        },
        create: data
      });

      await createAuditLog(tx, {
        tableName: 'role_menu_permissions',
        recordId: savedPermission.id,
        actionType: existingPermission ? 'UPDATE' : 'CREATE',
        performedByUserId: actorUserId,
        recordName: `${role.name} - ${menu.name}`,
        comments: existingPermission ? `Role menu permission updated for ${menu.name}` : `Role menu permission created for ${menu.name}`,
        details: buildPermissionAuditDetails(existingPermission, savedPermission),
        moduleId: auditModule.id
      });

      savedPermissions.push(savedPermission);
    }

    return savedPermissions;
  }, PERMISSION_TRANSACTION_OPTIONS);

  return permissions;
};

const getRoleMenuPermissions = async (roleId) => {
  const role = await resolveRoleByIdentifier(roleId);
  const parsedRoleId = role.id;

  const [menus, permissions] = await prisma.$transaction([
    prisma.menu.findMany({
      where: { isActive: true },
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
    }),
    prisma.roleMenuPermission.findMany({
      where: { roleId: parsedRoleId }
    })
  ]);

  const permissionMap = new Map(permissions.map((permission) => [permission.menuId, permission]));

  return formatPermissionResponse(role, menus, permissionMap);
};

const deleteRoleMenuPermission = async (roleId, menuId, actorUserId) => {
  const role = await resolveRoleByIdentifier(roleId);
  const parsedRoleId = role.id;
  const parsedMenuId = Number(menuId);
  await ensureMenusExist([parsedMenuId]);

  const existingPermission = await prisma.roleMenuPermission.findUnique({
    where: {
      roleId_menuId: {
        roleId: parsedRoleId,
        menuId: parsedMenuId
      }
    }
  });

  if (!existingPermission) {
    throw createHttpError(404, 'Role menu permission not found');
  }

  return prisma.$transaction(async (tx) => {
    const deletedPermission = await tx.roleMenuPermission.delete({
      where: {
        roleId_menuId: {
          roleId: parsedRoleId,
          menuId: parsedMenuId
        }
      }
    });

    const menuMap = await ensureMenusExist([parsedMenuId]);
    const menu = menuMap.get(parsedMenuId);

    await createAuditLog(tx, {
      tableName: 'role_menu_permissions',
      recordId: deletedPermission.id,
      actionType: 'DELETE',
      performedByUserId: actorUserId,
      recordName: `${role.name} - ${menu.name}`,
      comments: `Role menu permission deleted for ${menu.name}`,
      details: permissionFields.map((fieldName) => ({
        fieldName,
        oldValue: deletedPermission[fieldName],
        newValue: null,
        dataType: 'boolean'
      }))
    });

    return deletedPermission;
  });
};

module.exports = {
  saveRoleMenuPermissions,
  getRoleMenuPermissions,
  deleteRoleMenuPermission
};
