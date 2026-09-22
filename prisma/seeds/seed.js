const { PrismaClient } = require('@prisma/client');
const { seedStateDistricts } = require('./seedStatesDistricts');
const { seedSuperAdmin } = require('./super-admin.seed');
const { seedMenus } = require('./seedMenus');
const { seedAdminRoleMenuPermissions } = require('./seedAdminRoleMenuPermissions');
const { seedServiceCategories } = require('./seedServiceCategories');
const { seedServiceCentersLocations } = require('./seedServiceCentersLocations');
const { seedStatusMasters } = require('./seedStatusMasters');
const { seedStageTimeLimits } = require('./seedStageTimeLimits');

const prisma = new PrismaClient();

const runSeed = async () => {
  await seedStateDistricts(prisma);
  await seedServiceCentersLocations(prisma);
  await seedSuperAdmin(prisma);
  await seedStatusMasters(prisma);
  await seedStageTimeLimits(prisma);
  await seedServiceCategories(prisma);
  await seedMenus(prisma);
  await seedAdminRoleMenuPermissions(prisma);
};

runSeed()
  .catch((error) => {
    console.error('Prisma seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
