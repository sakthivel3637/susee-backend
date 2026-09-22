const { PrismaClient } = require('@prisma/client');
const {
  seedStateDistricts,
  TAMIL_NADU_STATE,
  TAMIL_NADU_DISTRICTS
} = require('./state-district.seed');

const run = async () => {
  const prisma = new PrismaClient();

  try {
    await seedStateDistricts(prisma);
  } catch (error) {
    console.error('State and district seed failed:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
};

if (require.main === module) {
  run();
}

module.exports = {
  seedStateDistricts,
  TAMIL_NADU_STATE,
  TAMIL_NADU_DISTRICTS
};
