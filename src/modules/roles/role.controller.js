const { apiResponse } = require('../../common/utils/apiResponse');
const roleService = require('./role.service');

const createRole = async (req, res, next) => {
  try {
    const role = await roleService.createRole(req.body, req.user.userId);

    return apiResponse(res, {
      statusCode: 201,
      message: 'Role created successfully',
      data: { role }
    });
  } catch (error) {
    return next(error);
  }
};

const updateRole = async (req, res, next) => {
  try {
    const role = await roleService.updateRole(req.params.id, req.body, req.user.userId);

    return apiResponse(res, {
      message: 'Role updated successfully',
      data: { role }
    });
  } catch (error) {
    return next(error);
  }
};

const listRoles = async (req, res, next) => {
  try {
    const { roles, meta } = await roleService.listRoles(req.query, req.user);

    return apiResponse(res, {
      message: 'Roles fetched successfully',
      data: { roles },
      meta
    });
  } catch (error) {
    return next(error);
  }
};

const getRoleDetail = async (req, res, next) => {
  try {
    const role = await roleService.getRoleDetail(req.params.id);

    return apiResponse(res, {
      message: 'Role fetched successfully',
      data: { role }
    });
  } catch (error) {
    return next(error);
  }
};

const updateRoleStatus = async (req, res, next) => {
  try {
    const role = await roleService.updateRoleStatus(req.params.id, req.body, req.user.userId);

    return apiResponse(res, {
      message: role.isActive ? 'Role activated successfully' : 'Role deactivated successfully',
      data: { role }
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createRole,
  updateRole,
  listRoles,
  getRoleDetail,
  updateRoleStatus
};
