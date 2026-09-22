const { apiResponse } = require('../../common/utils/apiResponse');
const userService = require('./user.service');

const createUser = async (req, res, next) => {
  try {
    const user = await userService.createUser(req.body, req.user);

    return apiResponse(res, {
      statusCode: 201,
      message: 'User created successfully',
      data: { user }
    });
  } catch (error) {
    return next(error);
  }
};

const updateUser = async (req, res, next) => {
  try {
    const user = await userService.updateUser(req.params.id, req.body, req.user);

    return apiResponse(res, {
      message: 'User updated successfully',
      data: { user }
    });
  } catch (error) {
    return next(error);
  }
};

const { exportToExcel } = require('../../common/utils/excel.util');

const listUsers = async (req, res, next) => {
  try {
    const { users, meta } = await userService.listUsers(req.query, req.user);

    if (req.query.export === 'true') {
      const columns = [
        { header: 'Full Name', key: 'fullName', width: 25 },
        { header: 'Employee Code', key: 'employeeCode', width: 18 },
        { header: 'Email', key: 'email', width: 25 },
        { header: 'Mobile', key: 'mobile', width: 18 },
        { header: 'Role', key: 'roleName', width: 18 },
        { header: 'Location', key: 'locationName', width: 20 },
        { header: 'Status', key: 'status', width: 15 }
      ];

      const formattedData = users.map(u => ({
        fullName: u.fullName,
        employeeCode: u.employeeCode,
        email: u.email,
        mobile: u.mobile,
        roleName: u.role?.name || '',
        locationName: u.locationName || '',
        status: u.isActive ? 'Active' : 'Inactive'
      }));

      return await exportToExcel(res, 'Users', 'Users', columns, formattedData);
    }

    return apiResponse(res, {
      message: 'Users fetched successfully',
      data: { users },
      meta
    });
  } catch (error) {
    return next(error);
  }
};

const listMechanicDropdown = async (req, res, next) => {
  try {
    const users = await userService.listMechanicDropdown(req.query, req.user);

    return apiResponse(res, {
      message: 'Mechanics dropdown fetched successfully',
      data: { users }
    });
  } catch (error) {
    return next(error);
  }
};

const getUserDetail = async (req, res, next) => {
  try {
    const user = await userService.getUserDetail(req.params.id, req.user);

    return apiResponse(res, {
      message: 'User fetched successfully',
      data: { user }
    });
  } catch (error) {
    return next(error);
  }
};

const updateUserStatus = async (req, res, next) => {
  try {
    const user = await userService.updateUserStatus(req.params.id, req.body, req.user);

    return apiResponse(res, {
      message: user.isActive ? 'User activated successfully' : 'User deactivated successfully',
      data: { user }
    });
  } catch (error) {
    return next(error);
  }
};

const resetUserPassword = async (req, res, next) => {
  try {
    const user = await userService.resetUserPassword(req.params.id, req.body, req.user);

    return apiResponse(res, {
      message: 'User password reset successfully',
      data: { user }
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createUser,
  updateUser,
  listUsers,
  listMechanicDropdown,
  getUserDetail,
  updateUserStatus,
  resetUserPassword
};
