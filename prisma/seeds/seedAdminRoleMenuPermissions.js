const { PrismaClient } = require('@prisma/client');

const ADMIN_ROLE_SLUG = 'admin';
const ADMIN_MENU_MODULE = 'admin';
const isReadOnlyMenu = (menu) => {
  const path = String(menu?.path || '').toLowerCase();
  const name = String(menu?.name || '').toLowerCase();

  return path.includes('dashboard')
    || name.includes('dashboard')
    || path.includes('kiosk/tv')
    || name.includes('tv display')
    || path.includes('notifications')
    || name.includes('notification')
    || path.includes('audit-logs')
    || name.includes('audit log');
};

const seedAdminRoleMenuPermissions = async (prisma) => {
  const adminRole = await prisma.role.findUnique({
    where: { slug: ADMIN_ROLE_SLUG },
    select: { id: true, name: true }
  });

  if (!adminRole) {
    throw new Error('Admin role not found. Run super admin seed before permission seed.');
  }

  const adminMenus = await prisma.menu.findMany({
    where: {
      module: ADMIN_MENU_MODULE,
      isActive: true
    },
    select: { id: true, name: true, path: true }
  });

  if (adminMenus.length === 0) {
    throw new Error('Admin menus not found. Run menu seed before permission seed.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.roleMenuPermission.deleteMany({
      where: { roleId: adminRole.id }
    });

    await tx.roleMenuPermission.createMany({
      data: adminMenus.map((menu) => {
        const readOnlyMenu = isReadOnlyMenu(menu);
        return {
          roleId: adminRole.id,
          menuId: menu.id,
          canRead: true,
          canCreate: !readOnlyMenu,
          canUpdate: !readOnlyMenu,
          canDelete: false
        };
      })
    });
  });

  console.log('Admin role menu permissions seeded');
};

const run = async () => {
  const prisma = new PrismaClient();

  try {
    await seedAdminRoleMenuPermissions(prisma);
  } catch (error) {
    console.error('Admin role menu permission seed failed:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
};

if (require.main === module) {
  run();
}

module.exports = {
  seedAdminRoleMenuPermissions
};
