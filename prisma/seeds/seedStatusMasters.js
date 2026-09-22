const { generateSlug } = require('../../src/common/utils/slug.util');

const statusModules = [
  {
    moduleCode: 'gate-entry',
    moduleName: 'Gate Entry',
    description: 'Gate entry lifecycle statuses',
    statuses: [
      { statusCode: 'ENTRY_CREATED', statusName: 'Entry Created', sortOrder: 1 },
      { statusCode: 'ACTIVE', statusName: 'Active', sortOrder: 2 },
      { statusCode: 'OPEN', statusName: 'Open', sortOrder: 3 },
      { statusCode: 'ENTERED', statusName: 'Entered', sortOrder: 4 },
      { statusCode: 'EXITED', statusName: 'Exited', sortOrder: 90, isFinal: true },
      { statusCode: 'CLOSED', statusName: 'Closed', sortOrder: 100, isFinal: true }
    ]
  },
  {
    moduleCode: 'job-card',
    moduleName: 'Job Card Status',
    description: 'Operational job card stage statuses',
    statuses: [
      { statusCode: 'GATE_ENTRY_CREATED', statusName: 'Gate Entry Created', sortOrder: 1 },
      { statusCode: 'JOB_CARD_PENDING', statusName: 'Waiting for Job Card', sortOrder: 2 },
      { statusCode: 'JOB_CARD_CREATED', statusName: 'Job Card Created', sortOrder: 3 },
      { statusCode: 'APPROVAL_PENDING', statusName: 'Approval Pending', sortOrder: 4 },
      { statusCode: 'APPROVED', statusName: 'Approved', sortOrder: 5 },
      { statusCode: 'REJECTED', statusName: 'Rejected', sortOrder: 6, isFinal: true },
      { statusCode: 'MECHANICAL_ASSIGNMENT_PENDING', statusName: 'Mechanical Assignment Pending', sortOrder: 7 },
      { statusCode: 'BODY_SHOP_ASSIGNMENT_PENDING', statusName: 'Body Shop Assignment Pending', sortOrder: 8 },
      { statusCode: 'WATER_WASH_ASSIGNMENT_PENDING', statusName: 'Water Wash Assignment Pending', sortOrder: 9 },
      { statusCode: 'MECHANICAL_ASSIGNED', statusName: 'Mechanical Assigned', sortOrder: 10 },
      { statusCode: 'MECHANICAL_IN_PROGRESS', statusName: 'Mechanical In Progress', sortOrder: 11 },
      { statusCode: 'MECHANICAL_COMPLETED', statusName: 'Mechanical Completed', sortOrder: 12 },
      { statusCode: 'BODY_SHOP_ASSIGNED', statusName: 'Body Shop Assigned', sortOrder: 20 },
      { statusCode: 'BODY_SHOP_IN_PROGRESS', statusName: 'Body Shop In Progress', sortOrder: 21 },
      { statusCode: 'BODY_SHOP_COMPLETED', statusName: 'Body Shop Completed', sortOrder: 22 },
      { statusCode: 'WATER_WASH_ASSIGNED', statusName: 'Water Wash Assigned', sortOrder: 30 },
      { statusCode: 'WATER_WASH_IN_PROGRESS', statusName: 'Water Wash In Progress', sortOrder: 31 },
      { statusCode: 'WATER_WASH_COMPLETED', statusName: 'Water Wash Completed', sortOrder: 32 },
      { statusCode: 'READY_FOR_DELIVERY', statusName: 'Ready For Delivery', sortOrder: 90 },
      { statusCode: 'DELIVERED', statusName: 'Delivered', sortOrder: 100, isFinal: true }
    ]
  },
  {
    moduleCode: 'approval-status',
    moduleName: 'Approval Status',
    description: 'Customer approval statuses',
    statuses: [
      { statusCode: 'PENDING', statusName: 'Pending', sortOrder: 1 },
      { statusCode: 'APPROVED', statusName: 'Approved', sortOrder: 2, isFinal: true },
      { statusCode: 'REJECTED', statusName: 'Rejected', sortOrder: 3, isFinal: true }
    ]
  },
  {
    moduleCode: 'work-assignment',
    moduleName: 'Work Assignment',
    description: 'Department work assignment statuses',
    statuses: [
      { statusCode: 'MECHANICAL_ASSIGNED', statusName: 'Mechanical Assigned', sortOrder: 10 },
      { statusCode: 'MECHANICAL_IN_PROGRESS', statusName: 'Mechanical In Progress', sortOrder: 11 },
      { statusCode: 'MECHANICAL_COMPLETED', statusName: 'Mechanical Completed', sortOrder: 12, isFinal: true },
      { statusCode: 'BODY_SHOP_ASSIGNED', statusName: 'Body Shop Assigned', sortOrder: 20 },
      { statusCode: 'BODY_SHOP_IN_PROGRESS', statusName: 'Body Shop In Progress', sortOrder: 21 },
      { statusCode: 'BODY_SHOP_COMPLETED', statusName: 'Body Shop Completed', sortOrder: 22, isFinal: true },
      { statusCode: 'WATER_WASH_ASSIGNED', statusName: 'Water Wash Assigned', sortOrder: 30 },
      { statusCode: 'WATER_WASH_IN_PROGRESS', statusName: 'Water Wash In Progress', sortOrder: 31 },
      { statusCode: 'WATER_WASH_COMPLETED', statusName: 'Water Wash Completed', sortOrder: 32, isFinal: true },
      { statusCode: 'ON_HOLD', statusName: 'On Hold', sortOrder: 40 }
    ]
  },
  {
    moduleCode: 'job-card-service',
    moduleName: 'Job Card Service',
    description: 'Individual job card service statuses',
    statuses: [
      { statusCode: 'PENDING', statusName: 'Pending', sortOrder: 1 },
      { statusCode: 'ASSIGNED', statusName: 'Assigned', sortOrder: 2 },
      { statusCode: 'IN_PROGRESS', statusName: 'In Progress', sortOrder: 3 },
      { statusCode: 'COMPLETED', statusName: 'Completed', sortOrder: 4, isFinal: true },
      { statusCode: 'REJECTED', statusName: 'Rejected', sortOrder: 5, isFinal: true },
      { statusCode: 'POSTPONED', statusName: 'Postponed', sortOrder: 6 }
    ]
  },
  {
    moduleCode: 'bay',
    moduleName: 'Bay',
    description: 'Bay statuses',
    statuses: [
      { statusCode: 'ACTIVE', statusName: 'Active', sortOrder: 1 },
      { statusCode: 'INACTIVE', statusName: 'Inactive', sortOrder: 2, isFinal: true }
    ]
  },
  {
    moduleCode: 'service-history-actions',
    moduleName: 'Service History Actions',
    description: 'Actions logged for job card service history',
    statuses: [
      { statusCode: 'SWITCH', statusName: 'Switch', sortOrder: 1 },
      { statusCode: 'RESUME', statusName: 'Resume', sortOrder: 2 },
      { statusCode: 'START', statusName: 'Start', sortOrder: 3 },
      { statusCode: 'COMPLETE', statusName: 'Complete', sortOrder: 4 },
      { statusCode: 'ASSIGN', statusName: 'Assign', sortOrder: 5 }
    ]
  }
];

const seedModule = async (prisma, moduleData) => {
  const slug = generateSlug(moduleData.moduleName);
  const existingModule = await prisma.module.findUnique({
    where: { moduleCode: moduleData.moduleCode },
    select: { id: true }
  });

  if (existingModule) {
    return prisma.module.update({
      where: { id: existingModule.id },
      data: {
        moduleName: moduleData.moduleName,
        slug,
        description: moduleData.description,
        isActive: true
      }
    });
  }

  return prisma.module.create({
    data: {
      moduleCode: moduleData.moduleCode,
      moduleName: moduleData.moduleName,
      slug,
      description: moduleData.description,
      isActive: true
    }
  });
};

const seedStatus = async (prisma, moduleId, statusData) => {
  const slug = generateSlug(statusData.statusName);
  const existingStatus = await prisma.statusMaster.findFirst({
    where: {
      moduleId,
      statusCode: statusData.statusCode
    },
    select: { id: true }
  });

  const data = {
    moduleId,
    statusCode: statusData.statusCode,
    statusName: statusData.statusName,
    slug,
    description: statusData.description || null,
    sortOrder: statusData.sortOrder || 0,
    isFinal: Boolean(statusData.isFinal),
    isActive: true
  };

  if (existingStatus) {
    return prisma.statusMaster.update({
      where: { id: existingStatus.id },
      data
    });
  }

  return prisma.statusMaster.create({ data });
};

const seedStatusMasters = async (prisma) => {
  for (const moduleData of statusModules) {
    const module = await seedModule(prisma, moduleData);

    for (const statusData of moduleData.statuses) {
      await seedStatus(prisma, module.id, statusData);
    }
  }

  console.log('Status modules and statuses seeded');
};

if (require.main === module) {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  seedStatusMasters(prisma)
    .catch((error) => {
      console.error('Status master seed failed:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

module.exports = {
  seedStatusMasters,
  statusModules
};
