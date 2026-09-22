const { apiResponse } = require('../../common/utils/apiResponse');

const isPositiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0;
};
const isSlug = (value) => /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(String(value || '').trim());

const sendValidationError = (res, message) => {
  return apiResponse(res, {
    statusCode: 400,
    success: false,
    message,
    data: {},
    meta: {}
  });
};

const validateRoleIdParam = (req, res, next) => {
  const roleIdentifier = req.params.roleId;

  if (!isPositiveInt(Number(roleIdentifier)) && !isSlug(roleIdentifier)) {
    return sendValidationError(res, 'Valid role identifier is required');
  }

  return next();
};

const validateMenuIdParam = (req, res, next) => {
  if (!isPositiveInt(Number(req.params.menuId))) {
    return sendValidationError(res, 'Valid menu id is required');
  }

  return next();
};

const validatePermissionPayload = (req, res, next) => {
  const permissions = req.body;

  if (!Array.isArray(permissions) || permissions.length === 0) {
    return sendValidationError(res, 'permissions payload must be a non-empty array');
  }

  const menuIds = new Set();

  for (const permission of permissions) {
    if (!isPositiveInt(Number(permission.menuId))) {
      return sendValidationError(res, 'Each permission must include a valid menuId');
    }

    if (menuIds.has(Number(permission.menuId))) {
      return sendValidationError(res, 'Duplicate menuId values are not allowed');
    }

    menuIds.add(Number(permission.menuId));

    for (const field of ['canRead', 'canCreate', 'canUpdate', 'canDelete']) {
      if (typeof permission[field] !== 'boolean') {
        return sendValidationError(res, `${field} boolean is required for each permission`);
      }
    }
  }

  return next();
};

module.exports = {
  validateRoleIdParam,
  validateMenuIdParam,
  validatePermissionPayload
};
