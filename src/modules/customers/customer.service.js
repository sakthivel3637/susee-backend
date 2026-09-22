const customerRepository = require('./customer.repository');
const prisma = require('../../config/db');
const { createAuditLog, buildChangeDetails } = require('../../common/utils/audit.util');
const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const resolveCustomerByIdentifier = async (identifier) => {
  const parsedId = Number(identifier);
  const customer = Number.isInteger(parsedId) && parsedId > 0
    ? await customerRepository.findCustomerById(parsedId)
    : await customerRepository.findCustomerBySlug(String(identifier || '').trim());

  if (!customer) {
    throw createHttpError(404, 'Customer not found');
  }

  return customer;
};

const listCustomers = async (query) => {
  const page = parseInt(query.page, 10) || 1;
  const limit = parseInt(query.limit, 10) || 10;
  const search = query.search || '';

  let isActive;
  if (query.status === 'active') isActive = true;
  if (query.status === 'inactive') isActive = false;

  const locationId = query.locationId ? parseInt(query.locationId, 10) : undefined;

  const { customers, total } = await customerRepository.listCustomers({
    page,
    limit,
    search,
    isActive,
    locationId
  });

  const mappedCustomers = customers.map(c => {
    const { _count, ...rest } = c;
    return {
      ...rest,
      visits: _count?.jobCards || 0
    };
  });

  return {
    customers: mappedCustomers,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  };
};

const getCustomerById = async (id) => {
  const customer = await resolveCustomerByIdentifier(id);
  return customer;
};

const updateCustomer = async (id, payload, modifiedBy) => {
  const customer = await resolveCustomerByIdentifier(id);

  if (payload.emailId) {
    const existingEmail = await customerRepository.findCustomerByEmail(payload.emailId, customer.id);
    if (existingEmail) {
      throw createHttpError(409, 'Email address is already in use by another customer');
    }
  }

  if (payload.mobileNo) {
    const existingMobile = await customerRepository.findCustomerByMobile(payload.mobileNo, customer.id);
    if (existingMobile) {
      throw createHttpError(409, 'Mobile number is already in use by another customer');
    }
  }

  const dataToUpdate = {
    fullName: payload.fullName,
    mobileNo: payload.mobileNo,
    alternateMobileNo: payload.alternateMobileNo,
    emailId: payload.emailId,
    address: payload.address,
    modifiedById: modifiedBy
  };

  if (payload.locationId) {
    dataToUpdate.locationId = parseInt(payload.locationId, 10);
  }

  return prisma.$transaction(async (tx) => {
    const updatedCustomer = await customerRepository.updateCustomer(customer.id, dataToUpdate, tx);

    await createAuditLog(tx, {
      moduleCode: 'customers',
      moduleName: 'Customers',
      tableName: 'customers',
      recordId: updatedCustomer.id,
      actionType: 'UPDATE',
      performedByUserId: modifiedBy,
      recordName: updatedCustomer.fullName,
      comments: 'Customer details updated',
      locationId: updatedCustomer.locationId,
      details: buildChangeDetails(customer, updatedCustomer, Object.keys(dataToUpdate))
    });

    return updatedCustomer;
  });
};

const updateCustomerStatus = async (id, isActive, modifiedBy) => {
  const customer = await resolveCustomerByIdentifier(id);

  if (customer.isActive === isActive) {
    throw createHttpError(400, `Customer is already ${isActive ? 'active' : 'inactive'}`);
  }

  return prisma.$transaction(async (tx) => {
    const updatedCustomer = await customerRepository.updateCustomer(customer.id, {
      isActive,
      modifiedById: modifiedBy
    }, tx);

    await createAuditLog(tx, {
      moduleCode: 'customers',
      moduleName: 'Customers',
      tableName: 'customers',
      recordId: updatedCustomer.id,
      actionType: isActive ? 'ACTIVATE' : 'DEACTIVATE',
      performedByUserId: modifiedBy,
      recordName: updatedCustomer.fullName,
      comments: isActive ? 'Customer activated' : 'Customer deactivated',
      locationId: updatedCustomer.locationId,
      details: buildChangeDetails(customer, updatedCustomer, ['isActive', 'modifiedById'])
    });

    return updatedCustomer;
  });
};

module.exports = {
  listCustomers,
  getCustomerById,
  updateCustomer,
  updateCustomerStatus
};
