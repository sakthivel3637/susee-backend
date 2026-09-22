const { apiResponse } = require('../../common/utils/apiResponse');
const roleMenuPermissionService = require('./roleMenuPermission.service');

const saveRoleMenuPermissions = async (req, res, next) => {
  try {
    const permissions = await roleMenuPermissionService.saveRoleMenuPermissions(
      req.params.roleId,
      req.body,
      req.user.userId
    );

    return apiResponse(res, {
      statusCode: 201,
      message: 'Role menu permissions saved successfully',
      data: { permissions }
    });
  } catch (error) {
    return next(error);
  }
};

const getRoleMenuPermissions = async (req, res, next) => {
  try {
    const data = await roleMenuPermissionService.getRoleMenuPermissions(req.params.roleId);

    return apiResponse(res, {
      message: 'Role menu permissions fetched successfully',
      data
    });
  } catch (error) {
    return next(error);
  }
};

const updateRoleMenuPermissions = async (req, res, next) => {
  try {
    const permissions = await roleMenuPermissionService.saveRoleMenuPermissions(
      req.params.roleId,
      req.body,
      req.user.userId
    );

    return apiResponse(res, {
      message: 'Role menu permissions updated successfully',
      data: { permissions }
    });
  } catch (error) {
    return next(error);
  }
};

const deleteRoleMenuPermission = async (req, res, next) => {
  try {
    const permission = await roleMenuPermissionService.deleteRoleMenuPermission(
      req.params.roleId,
      req.params.menuId,
      req.user.userId
    );

    return apiResponse(res, {
      message: 'Role menu permission deleted successfully',
      data: { permission }
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  saveRoleMenuPermissions,
  getRoleMenuPermissions,
  updateRoleMenuPermissions,
  deleteRoleMenuPermission
};
