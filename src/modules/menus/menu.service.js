const prisma = require('../../config/db');

const menuSelect = {
  id: true,
  module: true,
  parentId: true,
  name: true,
  path: true,
  icon: true,
  sequence: true,
  isActive: true
};

const parseBooleanFilter = (value, defaultValue = true) => {
  if (value === undefined || value === '') {
    return defaultValue;
  }

  if (value === true || value === 'true') {
    return true;
  }

  if (value === false || value === 'false') {
    return false;
  }

  return defaultValue;
};

const toMenuNode = (menu) => ({
  id: menu.id,
  menuId: menu.id,
  module: menu.module,
  parentId: menu.parentId,
  name: menu.name,
  path: menu.path,
  icon: menu.icon,
  sequence: menu.sequence,
  isActive: menu.isActive,
  children: []
});

const buildHierarchy = (menus) => {
  const nodeMap = new Map();
  const roots = [];

  menus.forEach((menu) => {
    nodeMap.set(menu.id, toMenuNode(menu));
  });

  nodeMap.forEach((node) => {
    if (node.parentId && nodeMap.has(node.parentId)) {
      nodeMap.get(node.parentId).children.push(node);
      return;
    }

    roots.push(node);
  });

  const sortNodes = (nodes) => {
    nodes.sort((a, b) => a.sequence - b.sequence || a.name.localeCompare(b.name));
    nodes.forEach((node) => sortNodes(node.children));
    return nodes;
  };

  return sortNodes(roots);
};

const groupMenusByModule = (menus) => {
  const grouped = new Map();

  menus.forEach((menu) => {
    if (!grouped.has(menu.module)) {
      grouped.set(menu.module, []);
    }

    grouped.get(menu.module).push(menu);
  });

  return Array.from(grouped.entries())
    .sort(([moduleA], [moduleB]) => moduleA.localeCompare(moduleB))
    .map(([module, moduleMenus]) => ({
      module,
      menus: buildHierarchy(moduleMenus)
    }));
};

const listMenus = async (query = {}) => {
  const isActive = parseBooleanFilter(query.isActive, true);
  const where = typeof isActive === 'boolean' ? { isActive } : {};

  const menus = await prisma.menu.findMany({
    where,
    select: menuSelect,
    orderBy: [
      { module: 'asc' },
      { sequence: 'asc' },
      { name: 'asc' }
    ]
  });

  return {
    modules: groupMenusByModule(menus)
  };
};

const listMenuModules = async (query = {}) => {
  const isActive = parseBooleanFilter(query.isActive, true);
  const where = typeof isActive === 'boolean' ? { isActive } : {};
  const modules = await prisma.menu.groupBy({
    by: ['module'],
    where,
    _count: { _all: true },
    orderBy: { module: 'asc' }
  });

  return modules.map((item) => ({
    module: item.module,
    menuCount: item._count._all
  }));
};

const listMenusByModule = async (module, query = {}) => {
  const isActive = parseBooleanFilter(query.isActive, true);
  const where = {
    module,
    ...(typeof isActive === 'boolean' ? { isActive } : {})
  };

  const menus = await prisma.menu.findMany({
    where,
    select: menuSelect,
    orderBy: [
      { sequence: 'asc' },
      { name: 'asc' }
    ]
  });

  return {
    module,
    menus: buildHierarchy(menus)
  };
};

module.exports = {
  listMenus,
  listMenuModules,
  listMenusByModule,
  groupMenusByModule,
  buildHierarchy
};
