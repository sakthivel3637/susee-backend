const customerService = require('./customer.service');
const { apiResponse } = require('../../common/utils/apiResponse');

const getCustomers = async (req, res, next) => {
  try {
    if (req.user && req.user.locationId) {
      req.query.locationId = req.user.locationId;
    }
    const result = await customerService.listCustomers(req.query);

    return apiResponse(res, {
      statusCode: 200,
      success: true,
      message: 'Customers retrieved successfully',
      data: result.customers,
      meta: result.meta
    });
  } catch (error) {
    return next(error);
  }
};

const getCustomer = async (req, res, next) => {
  try {
    const identifier = req.params.id;
    const customer = await customerService.getCustomerById(identifier);

    return apiResponse(res, {
      statusCode: 200,
      success: true,
      message: 'Customer retrieved successfully',
      data: customer
    });
  } catch (error) {
    return next(error);
  }
};

const updateCustomer = async (req, res, next) => {
  try {
    const identifier = req.params.id;
    const modifiedBy = req.user.userId;
    const updatedCustomer = await customerService.updateCustomer(identifier, req.body, modifiedBy);

    return apiResponse(res, {
      statusCode: 200,
      success: true,
      message: 'Customer updated successfully',
      data: updatedCustomer
    });
  } catch (error) {
    return next(error);
  }
};

const updateCustomerStatus = async (req, res, next) => {
  try {
    const identifier = req.params.id;
    const { isActive } = req.body;
    const modifiedBy = req.user.userId;

    const updatedCustomer = await customerService.updateCustomerStatus(identifier, isActive, modifiedBy);

    return apiResponse(res, {
      statusCode: 200,
      success: true,
      message: `Customer ${isActive ? 'activated' : 'deactivated'} successfully`,
      data: updatedCustomer
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getCustomers,
  getCustomer,
  updateCustomer,
  updateCustomerStatus
};
