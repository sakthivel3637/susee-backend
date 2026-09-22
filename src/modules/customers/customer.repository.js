const prisma = require('../../config/db');

const customerSelect = {
  id: true,
  slug: true,
  customerCode: true,
  fullName: true,
  mobileNo: true,
  alternateMobileNo: true,
  emailId: true,
  address: true,
  isActive: true,
  locationId: true,
  createdAt: true,
  updatedAt: true,
  location: {
    select: {
      id: true,
      locationCode: true,
      locationName: true
    }
  },
  _count: {
    select: {
      jobCards: true
    }
  }
};

const buildCustomerWhere = ({ search, isActive, locationId } = {}) => {
  const where = {};

  if (typeof isActive === 'boolean') {
    where.isActive = isActive;
  }

  if (locationId) {
    where.locationId = locationId;
  }

  if (search) {
    where.OR = [
      { fullName: { contains: search } },
      { customerCode: { contains: search } },
      { mobileNo: { contains: search } },
      { emailId: { contains: search } }
    ];
  }

  return where;
};

const listCustomers = async ({ page, limit, search, isActive, locationId }) => {
  const where = buildCustomerWhere({ search, isActive, locationId });
  const skip = (page - 1) * limit;

  const [customers, total] = await prisma.$transaction([
    prisma.customer.findMany({
      where,
      select: customerSelect,
      orderBy: { id: 'desc' },
      skip,
      take: limit
    }),
    prisma.customer.count({ where })
  ]);

  return { customers, total };
};

const findCustomerById = (id) => {
  return prisma.customer.findUnique({
    where: { id },
    select: customerSelect
  });
};

const findCustomerBySlug = (slug) => {
  return prisma.customer.findUnique({
    where: { slug },
    select: customerSelect
  });
};

const findCustomerByEmail = (emailId, excludeId = null) => {
  const where = { emailId };
  if (excludeId) {
    where.id = { not: excludeId };
  }
  return prisma.customer.findFirst({
    where,
    select: customerSelect
  });
};

const findCustomerByMobile = (mobileNo, excludeId = null) => {
  const where = { mobileNo };
  if (excludeId) {
    where.id = { not: excludeId };
  }
  return prisma.customer.findFirst({
    where,
    select: customerSelect
  });
};

const updateCustomer = (id, data, tx = prisma) => {
  return tx.customer.update({
    where: { id },
    data,
    select: customerSelect
  });
};

module.exports = {
  listCustomers,
  findCustomerById,
  findCustomerBySlug,
  findCustomerByEmail,
  findCustomerByMobile,
  updateCustomer
};
