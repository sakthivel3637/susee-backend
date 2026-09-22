const { PrismaClient } = require('@prisma/client');

const MENU_SEED_DATA = [
  {
    module: 'gate-security',
    menus: [
      { name: 'Gate Dashboard', path: '/gate-dashboard', icon: 'LayoutDashboard' },
      { name: 'Vehicle Entry', path: '/gate-entry', icon: 'LogIn' }
    ]
  },
  {
    module: 'crm-team',
    menus: [
      { name: 'CRM Dashboard', path: '/crm-dashboard', icon: 'LayoutDashboard' },
      { name: 'Job Cards', path: '/job-cards', icon: 'ClipboardList' },
      { name: 'Pending Approvals', path: '/approval-followup', icon: 'Clock' },
      { name: 'Delivery Ready', path: '/delivery-ready', icon: 'Package' },
      { name: 'Customers', path: '/customers', icon: 'Users' },
      { name: 'Vehicles', path: '/vehicles', icon: 'Car' },
      { name: 'Notifications', path: '/notifications', icon: 'Bell' }
    ]
  },
  {
    module: 'floor-supervisor',
    menus: [
      { name: 'Floor Dashboard', path: '/floor-dashboard', icon: 'LayoutDashboard' },
      { name: 'Assign Mechanic', path: '/assign-mechanic', icon: 'User' },
      { name: 'Additional Work', path: '/additional-work', icon: 'AlertCircle' },
      { name: 'Job Cards', path: '/job-cards', icon: 'ClipboardList' },
      { name: 'Notifications', path: '/notifications', icon: 'Bell' }
    ]
  },
  {
    module: 'body-shop-supervisor',
    menus: [
      { name: 'Body Shop Dashboard', path: '/body-shop-dashboard', icon: 'LayoutDashboard' },
      // { name: 'Body Shop Queue', path: '/body-shop-queue', icon: 'Paintbrush' },
      { name: 'Assign Mechanic', path: '/body-shop-assign-mechanic', icon: 'User' },
      { name: 'Additional Work', path: '/body-shop-additional-work', icon: 'AlertCircle' },
      { name: 'Job Cards', path: '/job-cards', icon: 'ClipboardList' },
      { name: 'Notifications', path: '/notifications', icon: 'Bell' }
    ]
  },
  {
    module: 'water-wash-team',
    menus: [
      { name: 'Dashboard', path: '/water-wash-dashboard', icon: 'LayoutDashboard' },
      { name: 'Assign Member', path: '/water-wash-assign-member', icon: 'User' },
      { name: 'Job Cards', path: '/job-cards', icon: 'ClipboardList' },
      { name: 'Notifications', path: '/notifications', icon: 'Bell' }
    ]
  },
  {
    module: 'manager',
    menus: [
      { name: 'Manager Dashboard', path: '/manager-dashboard', icon: 'LayoutDashboard' },
      { name: 'User Management', path: '/users', icon: 'Users' },
      { name: 'Customers', path: '/customers', icon: 'Users' },
      { name: 'Vehicles', path: '/vehicles', icon: 'Car' },
      { name: 'Job Cards', path: '/job-cards', icon: 'ClipboardList' },
      { name: 'Notifications', path: '/notifications', icon: 'Bell' },
      { name: 'TV Display', path: '/kiosk/tv', icon: 'Monitor' }
    ]
  },
  {
    module: 'managing-director',
    menus: [
      { name: 'MD Dashboard', path: '/md-dashboard', icon: 'LayoutDashboard' },
      { name: 'Stage Schedules', path: '/md-stage-schedules', icon: 'Clock' },
      { name: 'Role Management', path: '/roles', icon: 'ShieldCheck' },
      { name: 'User Management', path: '/users', icon: 'Users' },
      { name: 'Customers', path: '/customers', icon: 'Users' },
      { name: 'Vehicles', path: '/vehicles', icon: 'Car' },
      { name: 'Job Cards', path: '/job-cards', icon: 'ClipboardList' },
      { name: 'Vehicle Entry', path: '/gate-entry', icon: 'LogIn' },
      { name: 'Notifications', path: '/notifications', icon: 'Bell' },
      // { name: 'System Settings', path: '/system-settings', icon: 'Settings' },
      { name: 'TV Display', path: '/kiosk/tv', icon: 'Monitor' },
      { name: 'Bays', path: '/md-bays', icon: 'Tool' }
    ]
  },
  {
    module: 'admin',
    menus: [
      { name: 'Admin Dashboard', path: '/admin-dashboard', icon: 'LayoutDashboard' },
      {
        name: 'Master Menu',
        path: '/admin/master-menu',
        icon: 'Database',
        children: [
          { name: 'States', path: '/master-states', icon: 'MapPin' },
          { name: 'Districts', path: '/master-districts', icon: 'Building' },
          { name: 'Brands', path: '/master-brands', icon: 'Car' },
          // { name: 'Service Categories', path: '/master-categories', icon: 'ClipboardList' },
          { name: 'Service Items', path: '/master-items', icon: 'Wrench' },
          { name: 'Modules', path: '/modules', icon: 'Package' },
          { name: 'Statuses', path: '/master-statuses', icon: 'CheckSquare' },
          { name: 'Bays', path: '/md-bays', icon: 'Tool' }
        ]
      },
      { name: 'Service Centers', path: '/service-centers', icon: 'Building' },
      { name: 'Locations', path: '/locations', icon: 'MapPin' },
      { name: 'Role Management', path: '/roles', icon: 'ShieldCheck' },
      { name: 'User Management', path: '/users', icon: 'Users' },
      { name: 'Audit Logs', path: '/audit-logs', icon: 'FileText' }
    ]
  }
];
// can remove later
const REMOVED_MENU_PATHS = [
  { module: 'floor-supervisor', path: '/work-status' },
  { module: 'body-shop-supervisor', path: '/body-shop-work-status' },
  { module: 'body-shop-supervisor', path: '/body-shop-queue' },
  { module: 'admin', path: '/master-bays' },
  { module: 'managing-director', path: '/master-bays' },
  { module: 'managing-director', path: '/audit-logs' },
  { module: 'water-wash-team', path: '/vehicles' },
  { module: 'admin', path: '/master-categories' }
];

const seedMenus = async (prisma) => {
  for (const removedMenu of REMOVED_MENU_PATHS) {
    await prisma.menu.updateMany({
      where: removedMenu,
      data: { isActive: false }
    });
  }

  for (const moduleMenu of MENU_SEED_DATA) {
    for (const [index, menu] of moduleMenu.menus.entries()) {
      const parent = await prisma.menu.upsert({
        where: {
          module_path: {
            module: moduleMenu.module,
            path: menu.path
          }
        },
        update: {
          parentId: null,
          name: menu.name,
          icon: menu.icon || null,
          sequence: index + 1,
          isActive: true
        },
        create: {
          module: moduleMenu.module,
          parentId: null,
          name: menu.name,
          path: menu.path,
          icon: menu.icon || null,
          sequence: index + 1,
          isActive: true
        }
      });

      for (const [childIndex, child] of (menu.children || []).entries()) {
        await prisma.menu.upsert({
          where: {
            module_path: {
              module: moduleMenu.module,
              path: child.path
            }
          },
          update: {
            parentId: parent.id,
            name: child.name,
            icon: child.icon || null,
            sequence: childIndex + 1,
            isActive: true
          },
          create: {
            module: moduleMenu.module,
            parentId: parent.id,
            name: child.name,
            path: child.path,
            icon: child.icon || null,
            sequence: childIndex + 1,
            isActive: true
          }
        });
      }
    }
  }

  console.log('Menus seeded');
};

const run = async () => {
  const prisma = new PrismaClient();

  try {
    await seedMenus(prisma);
  } catch (error) {
    console.error('Menu seed failed:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
};

if (require.main === module) {
  run();
}

module.exports = {
  MENU_SEED_DATA,
  seedMenus
};
