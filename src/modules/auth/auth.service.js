const bcrypt = require('bcryptjs');

const env = require('../../config/env');
const jwt = require('jsonwebtoken');
const authRepository = require('./auth.repository');
const userRepository = require('../users/user.repository');
const { signToken, verifyToken } = require('../../utils/jwt');
const { sendPasswordResetEmail } = require('../../utils/email');
const platformModules = require('../../config/platformModules');

const LOGIN_ERROR_MESSAGE = 'Invalid email or password';
const ADMIN_ROLE_SLUGS = new Set(['admin', 'super_admin']);
const ADMIN_BYPASS_ENABLED = String(process.env.RBAC_ADMIN_BYPASS || '').toLowerCase() === 'true';
const LOCATION_REQUIRED_ROLE_SLUGS = new Set([
  'gate_security',
  'gatekeeper',
  'crm_team',
  'floor_supervisor',
  'body_shop_supervisor',
  'water_wash_supervisor',
  'water_wash_team',
  'manager'
]);

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeRoleSlug = (slug) => String(slug || '').trim().toLowerCase().replace(/-/g, '_');

const roleRequiresLocation = (roleSlug) => {
  const normalizedRoleSlug = normalizeRoleSlug(roleSlug);
  return LOCATION_REQUIRED_ROLE_SLUGS.has(normalizedRoleSlug) && !ADMIN_ROLE_SLUGS.has(normalizedRoleSlug);
};

const toPublicUser = (user) => ({
  id: user.id,
  fullName: user.fullName,
  emailId: user.emailId,
  mobileNo: user.mobileNo,
  role: {
    id: user.role.id,
    name: user.role.name,
    slug: user.role.slug
  },
  locationId: user.locationId,
  location: user.location
    ? {
      id: user.location.id,
      locationName: user.location.locationName,
      locationCode: user.location.locationCode
    }
    : null
});

const buildJwtPayload = (user) => ({
  userId: user.id,
  roleId: user.roleId,
  roleSlug: user.role.slug,
  locationId: user.locationId
});

const normalizeAuthErrorOptions = (options) => {
  if (typeof options === 'boolean') {
    return {
      genericLoginError: options,
      maskInactiveUser: options,
      maskInactiveRole: options
    };
  }

  const genericLoginError = Boolean(options?.genericLoginError);

  return {
    genericLoginError,
    maskInactiveUser: options?.maskInactiveUser ?? genericLoginError,
    maskInactiveRole: options?.maskInactiveRole ?? genericLoginError
  };
};

const assertUserCanAuthenticate = (user, options = false) => {
  const { genericLoginError, maskInactiveUser, maskInactiveRole } = normalizeAuthErrorOptions(options);

  if (!user || !user.role) {
    throw createHttpError(401, genericLoginError ? LOGIN_ERROR_MESSAGE : 'User not found');
  }

  if (!user.isActive) {
    throw createHttpError(403, maskInactiveUser ? LOGIN_ERROR_MESSAGE : 'User account is inactive');
  }

  if (!user.role.isActive) {
    throw createHttpError(403, maskInactiveRole ? LOGIN_ERROR_MESSAGE : 'User role is inactive');
  }
};

const comparePassword = (password, passwordHash) => {
  return bcrypt.compare(password, passwordHash);
};

const groupMenusByModule = (permissions) => {
  const groups = new Map();

  permissions
    .map((permission) => ({
      module: permission.menu.module,
      menuId: permission.menu.id,
      parentId: permission.menu.parentId,
      name: permission.menu.name,
      path: permission.menu.path,
      icon: permission.menu.icon,
      sequence: permission.menu.sequence,
      canRead: permission.canRead,
      canCreate: permission.canCreate,
      canUpdate: permission.canUpdate,
      canDelete: permission.canDelete
    }))
    .sort((a, b) => {
      return a.module.localeCompare(b.module) || a.sequence - b.sequence || a.name.localeCompare(b.name);
    })
    .forEach((menu) => {
      if (!groups.has(menu.module)) {
        groups.set(menu.module, []);
      }

      groups.get(menu.module).push(menu);
    });

  return Array.from(groups.entries()).map(([module, menus]) => ({
    module,
    menus
  }));
};

const getAllMenus = async (modules) => {
  const menus = await authRepository.findActiveMenus(modules);
  return groupMenusByModule(menus.map((menu) => ({
    menu: {
      module: menu.module,
      id: menu.id,
      parentId: menu.parentId,
      name: menu.name,
      path: menu.path,
      icon: menu.icon,
      sequence: menu.sequence
    },
    canRead: true,
    canCreate: true,
    canUpdate: true,
    canDelete: true
  })));
};

const getAllowedMenus = async (roleId, roleSlug) => {
  const permissions = await authRepository.findReadableMenusByRoleId(roleId);

  if (permissions.length > 0) {
    return groupMenusByModule(permissions);
  }

  // Temporary migration fallback. Default is disabled; enable only with RBAC_ADMIN_BYPASS=true.
  if (ADMIN_BYPASS_ENABLED && ADMIN_ROLE_SLUGS.has(normalizeRoleSlug(roleSlug))) {
    return getAllMenus(['admin']);
  }

  return groupMenusByModule(permissions);
};

const getFirstReadableMenuPath = (modules = []) => {
  for (const moduleItem of modules) {
    for (const menu of moduleItem.menus || []) {
      if (menu.canRead && menu.path && menu.path !== '#' && menu.path !== '/admin/master-menu') {
        return menu.path;
      }

      for (const child of menu.children || []) {
        if (child.canRead && child.path && child.path !== '#') {
          return child.path;
        }
      }
    }
  }

  return '/profile';
};

const buildAuthResponse = async (user, menus, includeToken = false) => {
  const authData = {
    user: toPublicUser(user),
    redirectPath: getFirstReadableMenuPath(menus),
    menus
  };

  if (includeToken) {
    return {
      token: signToken(buildJwtPayload(user)),
      ...authData
    };
  }

  return authData;
};

const login = async ({ emailId, password }, platform = 'web') => {
  const normalizedEmailId = emailId.trim();
  const user = await authRepository.findUserByEmailId(normalizedEmailId);

  if (!user) {
    throw createHttpError(401, 'Incorrect email and password');
  }

  assertUserCanAuthenticate(user, {
    genericLoginError: false,
    maskInactiveUser: false
  });

  const passwordMatches = await comparePassword(password, user.passwordHash);

  if (!passwordMatches) {
    throw createHttpError(401, 'Incorrect password');
  }

  const menus = await getAllowedMenus(user.roleId, user.role.slug);
  const userModules = menus.map(m => m.module);
  
  if (platform === 'web') {
    const hasWebModule = userModules.some(mod => platformModules.web.includes(mod));
    if (!hasWebModule) {
      throw createHttpError(403, 'This account is not permitted to access the Web application.');
    }
  } else if (platform === 'mobile') {
    const hasMobileModule = userModules.some(mod => platformModules.mobile.includes(mod));
    if (!hasMobileModule) {
      throw createHttpError(403, 'This account is not permitted to access the Mobile application.');
    }
  } else if (platform === 'mobile-gate') {
    const hasGateModule = userModules.some(mod => platformModules['mobile-gate'].includes(mod));
    if (!hasGateModule) {
      throw createHttpError(403, 'This account is not permitted to access the Gate Security application.');
    }
  } else if (platform === 'mobile-crm') {
    const hasCrmModule = userModules.some(mod => platformModules['mobile-crm'].includes(mod));
    if (!hasCrmModule) {
      throw createHttpError(403, 'This account is not permitted to access the CRM application.');
    }
  }

  if (roleRequiresLocation(user.role.slug) && !user.locationId) {
    throw createHttpError(403, 'Location is required for this role');
  }

  await authRepository.updateLastLoginAt(user.id);

  return buildAuthResponse(user, menus, true);
};

const getCurrentUser = async (userId) => {
  const user = await authRepository.findUserById(Number(userId));

  assertUserCanAuthenticate(user);

  if (roleRequiresLocation(user.role.slug) && !user.locationId) {
    throw createHttpError(403, 'Location is required for this role');
  }

  const menus = await getAllowedMenus(user.roleId, user.role.slug);
  return buildAuthResponse(user, menus, false);
};

const updateProfile = async (userId, data) => {
  const numericUserId = Number(userId);
  const user = await authRepository.findUserById(numericUserId);

  assertUserCanAuthenticate(user);

  const existingEmail = await userRepository.findUserByEmail(data.emailId, numericUserId);
  if (existingEmail) {
    throw createHttpError(400, 'Email already exists');
  }

  const updatedUser = await userRepository.updateUser(numericUserId, {
    fullName: data.fullName,
    emailId: data.emailId,
    mobileNo: data.mobileNo
  });

  const menus = await getAllowedMenus(updatedUser.roleId, updatedUser.role.slug);
  return buildAuthResponse(updatedUser, menus, false);
};

const forgotPassword = async (emailId) => {
  const normalizedEmailId = emailId.trim();
  const user = await authRepository.findUserByEmailId(normalizedEmailId);

  if (!user) {
    throw createHttpError(404, 'No account found with this email.');
  }

  const resetToken = jwt.sign(
    { userId: user.id },
    env.jwtSecret,
    { expiresIn: '15m' }
  );

  const resetLink = `${env.frontendUrl}/reset-password/${resetToken}`;

  await sendPasswordResetEmail(user.emailId, resetLink);
};

const resetPassword = async (token, newPassword) => {
  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    throw createHttpError(400, 'Invalid or expired reset token.');
  }

  const userId = payload.userId;
  const passwordHash = await bcrypt.hash(newPassword, 10);

  await authRepository.updatePassword(userId, passwordHash);
};

module.exports = {
  LOGIN_ERROR_MESSAGE,
  toPublicUser,
  buildJwtPayload,
  getAllowedMenus,
  login,
  getCurrentUser,
  updateProfile,
  forgotPassword,
  resetPassword
};
