const getRolesMap = async (prisma) => {
  const roles = await prisma.role.findMany({
    select: { id: true, slug: true }
  });

  const rolesMap = {};
  for (const role of roles) {
    rolesMap[role.slug] = role.id;
  }

  return rolesMap;
};

const limitsData = [
  {
    stageCode: 'JOB_CARD_QUEUE',
    moduleCode: 'job-card',
    statusCode: 'JOB_CARD_PENDING',
    allowedMinutes: 20,
    notifyRoleSlug: 'crm_team'
  },
  {
    stageCode: 'APPROVAL_PENDING',
    moduleCode: 'job-card',
    statusCode: 'APPROVAL_PENDING',
    allowedMinutes: 2,
    notifyRoleSlug: 'crm_team'
  },
  {
    stageCode: 'ADDITIONAL_WORK',
    moduleCode: 'approval-status',
    statusCode: 'PENDING',
    allowedMinutes: 2,
    notifyRoleSlug: 'crm_team'
  },
  {
    stageCode: 'MECHANICAL_ASSIGNMENT_PENDING',
    moduleCode: 'job-card',
    statusCode: 'MECHANICAL_ASSIGNMENT_PENDING',
    allowedMinutes: 20,
    notifyRoleSlug: 'floor_supervisor'
  },
  {
    stageCode: 'BODY_SHOP_ASSIGNMENT_PENDING',
    moduleCode: 'job-card',
    statusCode: 'BODY_SHOP_ASSIGNMENT_PENDING',
    allowedMinutes: 20,
    notifyRoleSlug: 'body_shop_supervisor'
  },
  {
    stageCode: 'WATER_WASH_ASSIGNMENT_PENDING',
    moduleCode: 'job-card',
    statusCode: 'WATER_WASH_ASSIGNMENT_PENDING',
    allowedMinutes: 20,
    notifyRoleSlug: 'water_wash_supervisor'
  },
  {
    stageCode: 'MECHANICAL_WORK',
    moduleCode: 'job-card',
    statusCode: 'MECHANICAL_IN_PROGRESS',
    allowedMinutes: 2,
    notifyRoleSlug: 'floor_supervisor'
  },
  {
    stageCode: 'BODY_SHOP',
    moduleCode: 'job-card',
    statusCode: 'BODY_SHOP_IN_PROGRESS',
    allowedMinutes: 2,
    notifyRoleSlug: 'floor_supervisor'
  },
  {
    stageCode: 'WATER_WASH',
    moduleCode: 'job-card',
    statusCode: 'WATER_WASH_IN_PROGRESS',
    allowedMinutes: 2,
    notifyRoleSlug: 'floor_supervisor'
  },
  {
    stageCode: 'READY_FOR_DELIVERY',
    moduleCode: 'job-card',
    statusCode: 'READY_FOR_DELIVERY',
    allowedMinutes: 2,
    notifyRoleSlug: 'crm_team'
  }
];

const resolveStatus = async (prisma, { moduleCode, statusCode }) => {
  const status = await prisma.statusMaster.findFirst({
    where: {
      statusCode,
      module: { moduleCode }
    },
    select: {
      id: true,
      moduleId: true
    }
  });

  if (!status) {
    throw new Error(`Status ${moduleCode}.${statusCode} must be seeded before stage time limits`);
  }

  return status;
};

async function seedStageTimeLimits(prisma) {
  console.log('Seeding stage time limits...');

  const rolesMap = await getRolesMap(prisma);
  console.log('Roles mapped successfully.');

  for (const limit of limitsData) {
    const status = await resolveStatus(prisma, limit);
    const notifyRoleId = rolesMap[limit.notifyRoleSlug] || null;

    const existing = await prisma.stageTimeLimit.findFirst({
      where: {
        OR: [
          {
            locationId: null,
            moduleId: status.moduleId,
            statusId: status.id
          },
          {
            stageCode: limit.stageCode
          }
        ]
      },
      select: { id: true }
    });

    const data = {
      locationId: null,
      moduleId: status.moduleId,
      statusId: status.id,
      stageCode: limit.stageCode,
      allowedMinutes: limit.allowedMinutes,
      isActive: true
    };
    
    const recipientsUpdate = notifyRoleId ? {
      deleteMany: {},
      create: [{ roleId: notifyRoleId }]
    } : { deleteMany: {} };

    const recipientsCreate = notifyRoleId ? {
      create: [{ roleId: notifyRoleId }]
    } : undefined;

    if (existing) {
      await prisma.stageTimeLimit.update({
        where: { id: existing.id },
        data: {
          stageCode: limit.stageCode,
          allowedMinutes: limit.allowedMinutes,
          isActive: true,
          location: { disconnect: true },
          module: { connect: { id: status.moduleId } },
          status: { connect: { id: status.id } },
          recipients: recipientsUpdate
        }
      });
    } else {
      await prisma.stageTimeLimit.create({ 
        data: {
          ...data,
          recipients: recipientsCreate
        } 
      });
    }
  }

  console.log('Stage time limits seeded successfully.');
}

module.exports = {
  seedStageTimeLimits
};

if (require.main === module) {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  seedStageTimeLimits(prisma)
    .catch((error) => {
      console.error('Stage time limits seed failed:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
