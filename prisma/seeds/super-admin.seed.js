const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { generateSlug } = require('../../src/common/utils/slug.util');

const SUPER_ADMIN_ROLE = {
  name: 'Admin',
  slug: 'admin',
  description: 'System administrator with full access'
};

const SUPER_ADMIN_USER = {
  fullName: process.env.SUPER_ADMIN_NAME || 'Super Admin',
  emailId: process.env.SUPER_ADMIN_EMAIL || 'admin@gmail.com',
  mobileNo: process.env.SUPER_ADMIN_MOBILE || null,
  employeeCode: process.env.SUPER_ADMIN_EMPLOYEE_CODE || 'SUPERADMIN001',
  password: process.env.SUPER_ADMIN_PASSWORD || 'Admin@123'
};

const seedSuperAdmin = async (prisma) => {
  await prisma.$transaction(async (tx) => {
    const userSlug = generateSlug(SUPER_ADMIN_USER.fullName);
    const adminRole = await tx.role.upsert({
      where: { slug: SUPER_ADMIN_ROLE.slug },
      update: {
        name: SUPER_ADMIN_ROLE.name,
        description: SUPER_ADMIN_ROLE.description,
        isActive: true
      },
      create: {
        ...SUPER_ADMIN_ROLE,
        isActive: true
      }
    });

    console.log('Super admin role seeded');

    const passwordHash = await bcrypt.hash(SUPER_ADMIN_USER.password, 10);

    await tx.user.upsert({
      where: { emailId: SUPER_ADMIN_USER.emailId },
      update: {
        roleId: adminRole.id,
        fullName: SUPER_ADMIN_USER.fullName,
        slug: userSlug,
        mobileNo: SUPER_ADMIN_USER.mobileNo,
        employeeCode: SUPER_ADMIN_USER.employeeCode,
        isActive: true
      },
      create: {
        roleId: adminRole.id,
        fullName: SUPER_ADMIN_USER.fullName,
        slug: userSlug,
        emailId: SUPER_ADMIN_USER.emailId,
        mobileNo: SUPER_ADMIN_USER.mobileNo,
        employeeCode: SUPER_ADMIN_USER.employeeCode,
        passwordHash,
        isActive: true
      }
    });

    console.log('Super admin user seeded');
  });
};

const run = async () => {
  const prisma = new PrismaClient();

  try {
    await seedSuperAdmin(prisma);
  } catch (error) {
    console.error('Super admin seed failed:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
};

if (require.main === module) {
  run();
}

module.exports = {
  seedSuperAdmin,
  SUPER_ADMIN_ROLE,
  SUPER_ADMIN_USER
};
