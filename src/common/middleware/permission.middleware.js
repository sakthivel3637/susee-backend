const prisma = require('../../config/db');
const { apiResponse } = require('../utils/apiResponse');

const ALLOWED_ACTIONS = new Set(['canRead', 'canCreate', 'canUpdate', 'canDelete']);
const ADMIN_BYPASS_ENABLED = String(process.env.RBAC_ADMIN_BYPASS || '').toLowerCase() === 'true';

const normalizeRoleSlug = (roleSlug) => String(roleSlug || '').trim().toLowerCase().replace(/-/g, '_');

const hasModule = (user, module) => {
  return Boolean(user && Array.isArray(user.modules) && user.modules.includes(module));
};

const respond = (res, statusCode, message) => apiResponse(res, {
  statusCode,
  success: false,
  message,
  data: {},
  meta: {}
});

const isAdminUser = (user) => {
  return hasModule(user, 'admin') || ['admin', 'super_admin'].includes(normalizeRoleSlug(user && user.roleSlug));
};

const permissionMiddleware = (menuPathOrOptions, actionArg) => {
  const options = menuPathOrOptions && typeof menuPathOrOptions === 'object' && !Array.isArray(menuPathOrOptions)
    ? menuPathOrOptions || {}
    : { menuPath: menuPathOrOptions, action: actionArg };
  const { menuPath, action } = options;
  const menuPaths = Array.isArray(options.menuPaths)
    ? options.menuPaths
    : Array.isArray(menuPath)
      ? menuPath
      : [menuPath];

  return async (req, res, next) => {
    try {
      const validMenuPaths = menuPaths.filter(Boolean);

      if (validMenuPaths.length === 0) {
        return respond(res, 403, 'Permission menu path is required');
      }

      if (!req.user) {
        return respond(res, 401, 'Authentication is required');
      }

      if (!req.user.roleId) {
        return respond(res, 403, 'User role is required for permission check');
      }

      if (!action || !ALLOWED_ACTIONS.has(action)) {
        return respond(res, 403, 'Invalid permission action');
      }

      const permission = await prisma.roleMenuPermission.findFirst({
        where: {
          roleId: req.user.roleId,
          menu: {
            path: {
              in: validMenuPaths
            },
            isActive: true
          },
          [action]: true
        },
        select: { id: true }
      });

      if (!permission) {
        // Temporary migration escape hatch. Default is disabled; enable only with RBAC_ADMIN_BYPASS=true.
        if (ADMIN_BYPASS_ENABLED && isAdminUser(req.user)) {
          return next();
        }

        return respond(res, 403, 'You do not have permission to perform this action');
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
};

module.exports = {
  permissionMiddleware
};
