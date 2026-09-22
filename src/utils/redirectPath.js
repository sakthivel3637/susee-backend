const ROLE_REDIRECT_PATHS = {
  admin: '/admin/dashboard',
  gate_security: '/gate/gate-entry',
  crm_team: '/crm/job-card-create',
  floor_supervisor: '/floor/work-assignment',
  body_shop_supervisor: '/body-shop/queue',
  water_wash_supervisor: '/water-wash-dashboard',
  water_wash_team: '/water-wash/queue',
  manager: '/manager/dashboard',
  managing_director: '/md/dashboard'
};

const getRedirectPath = (roleSlug) => {
  if (!roleSlug) return '/profile';
  const normalized = roleSlug.toLowerCase().replace(/-/g, '_');
  return ROLE_REDIRECT_PATHS[normalized] || '/profile';
};

module.exports = {
  ROLE_REDIRECT_PATHS,
  getRedirectPath
};
