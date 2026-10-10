const { PrismaClient } = require('@prisma/client');

const SERVICE_CATEGORIES = [
  {
    name: 'Mechanical',
    slug: 'mechanical',
    description: 'Mechanical service category'
  },
  {
    name: 'Body Shop',
    slug: 'body-shop',
    description: 'Body shop service category'
  },
  {
    name: 'Water Wash',
    slug: 'water-wash',
    description: 'Water wash service category'
  }
];

const seedServiceCategories = async (prisma) => {
  for (const category of SERVICE_CATEGORIES) {
    await prisma.serviceCategory.upsert({
      where: { slug: category.slug },
      update: {
        name: category.name,
        description: category.description,
        isActive: true
      },
      create: {
        name: category.name,
        slug: category.slug,
        description: category.description,
        isActive: true
      }
    });
  }

  console.log('Service categories seeded');
};

const run = async () => {
  const prisma = new PrismaClient();

  try {
    await seedServiceCategories(prisma);
  } catch (error) {
    console.error('Service category seed failed:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
};

if (require.main === module) {
  run();
}

module.exports = {
  SERVICE_CATEGORIES,
  seedServiceCategories
};
