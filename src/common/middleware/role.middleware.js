const prisma = require('../../config/db');
const { apiResponse } = require('../utils/apiResponse');

const normalizeAllowedRoles = (allowedRoles) => {
  if (Array.isArray(allowedRoles[0])) {
    return allowedRoles[0];
  }

  return allowedRoles;
};

const ROLE_ALIASES = {
  super_admin: 'admin',
  body_shop: 'body_shop_supervisor',
  bodyshop: 'body_shop_supervisor',
  bodyshop_supervisor: 'body_shop_supervisor',
  crm: 'crm_team',
  crm_user: 'crm_team',
  crm_executive: 'crm_team',
  crm_staff: 'crm_team',
  floor: 'floor_supervisor',
  mechanical_supervisor: 'floor_supervisor',
  water_wash: 'water_wash_team',
  water_wash_supervisor: 'water_wash_team',
  wash: 'water_wash_team'
};

const ROLE_MODULES = {
  admin: 'admin',
  gate_security: 'gate-security',
  gatekeeper: 'gate-security',
  crm_team: 'crm-team',
  floor_supervisor: 'floor-supervisor',
  mechanical: 'floor-supervisor',
  mechanic: 'floor-supervisor',
  body_shop_supervisor: 'body-shop-supervisor',
  water_wash_team: 'water-wash-team',
  manager: 'manager',
  managing_director: 'managing-director',
  md: 'managing-director'
};

const normalizeRoleSlug = (roleSlug) => {
  const normalized = String(roleSlug || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  return ROLE_ALIASES[normalized] || normalized;
};

const getAllowedModules = (roles) => {
  return Array.from(new Set(
    roles
      .map((role) => ROLE_MODULES[role])
      .filter(Boolean)
  ));
};

const hasModulePermission = async (roleId, allowedModules) => {
  if (!roleId || allowedModules.length === 0) {
    return false;
  }

  const permission = await prisma.roleMenuPermission.findFirst({
    where: {
      roleId,
      canRead: true,
      menu: {
        module: {
          in: allowedModules
        },
        isActive: true
      }
    },
    select: { id: true }
  });

  return Boolean(permission);
};

const hasUserModule = (user, allowedModules) => {
  if (!user || !Array.isArray(user.modules) || allowedModules.length === 0) {
    return false;
  }

  return user.modules.some((module) => allowedModules.includes(module));
};

const roleMiddleware = (allowedRoles = [], options = {}) => {
  const roles = (Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles])
    .map(normalizeRoleSlug);
  const allowedModules = getAllowedModules(roles);
  const allowAdmin = options.allowAdmin === true;

  return async (req, res, next) => {
    const userRole = normalizeRoleSlug(req.user && req.user.roleSlug);
    const canAccess = hasUserModule(req.user, allowedModules)
      || await hasModulePermission(req.user && req.user.roleId, allowedModules)
      || roles.includes(userRole)
      || (allowAdmin && userRole === 'admin');

    if (!userRole || !canAccess) {
      return apiResponse(res, {
        statusCode: 403,
        success: false,
        message: 'You do not have permission to access this resource',
        data: {},
        meta: {}
      });
    }

    return next();
  };
};

const authorizeRoles = (...allowedRoles) => {
  return roleMiddleware(normalizeAllowedRoles(allowedRoles));
};

module.exports = {
  roleMiddleware,
  authorizeRoles
};
