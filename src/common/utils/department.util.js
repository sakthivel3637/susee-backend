const DEPARTMENT_ORDER = ['mechanical', 'body-shop', 'water-wash'];

const DEPARTMENT_ALIASES = {
  mechanical: [
    'mechanical', 'mechanic', 'mechnanic', 'floor',
    'general service', 'general-service', 'general_service', 'general',
    'engine', 'electrical', 'periodic', 'oil', 'filter', 'brake', 'clutch',
    'suspension', 'battery', 'alignment', 'wheel', 'ac', 'air condition', 'air-condition',
    'coolant', 'tyre', 'tire', 'service'
  ],
  'body-shop': [
    'body-shop', 'body_shop', 'body shop', 'bodyshop', 'body',
    'paint', 'painting', 'painter',
    'denting', 'dent', 'denting-painting', 'denting-&-painting', 'denting & painting',
    'tinkering', 'bodywork', 'collision', 'scratch', 'crumple',
    'bumper', 'panel', 'fender', 'bonnet', 'door', 'chassis',
    'repair', 'repairment', 'rubbing', 'polishing', 'teflon', 'ceramic', 'coating'
  ],
  'water-wash': [
    'water-wash', 'water_wash', 'water wash', 'waterwash', 'wash', 'washing',
    'cleaning', 'clean', 'door step cleaning', 'doorstep cleaning',
    'interior cleaning', 'exterior cleaning', 'foam wash', 'vacuum', 'car wash', 'water'
  ]
};

const normalizeText = (value) => String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-');

const normalizeDepartment = (value) => {
  if (!value) return null;
  const raw = String(value).trim().toLowerCase();
  const normalizedValue = normalizeText(value);

  // 1. Direct or normalized alias exact match
  for (const department of DEPARTMENT_ORDER) {
    const aliases = DEPARTMENT_ALIASES[department] || [];
    if (aliases.some((alias) => {
      const normAlias = normalizeText(alias);
      return normalizedValue === normAlias || raw === alias.toLowerCase();
    })) {
      return department;
    }
  }

  // 2. Substring matching (checking water-wash and body-shop first to prevent false mechanical defaults)
  const isWash = (DEPARTMENT_ALIASES['water-wash'] || []).some((alias) => {
    const normAlias = normalizeText(alias);
    return normalizedValue.includes(normAlias) || raw.includes(alias.toLowerCase());
  });
  if (isWash) return 'water-wash';

  const isBody = (DEPARTMENT_ALIASES['body-shop'] || []).some((alias) => {
    const normAlias = normalizeText(alias);
    return normalizedValue.includes(normAlias) || raw.includes(alias.toLowerCase());
  });
  if (isBody) return 'body-shop';

  const isMech = (DEPARTMENT_ALIASES['mechanical'] || []).some((alias) => {
    const normAlias = normalizeText(alias);
    return normalizedValue.includes(normAlias) || raw.includes(alias.toLowerCase());
  });
  if (isMech) return 'mechanical';

  return null;
};

const getServiceDepartment = (service) => {
  if (!service) return null;

  // 1. Category from serviceItem or service
  const category = (service.serviceItem && service.serviceItem.category) || service.category || null;
  if (category) {
    const dept = normalizeDepartment(category.slug || category.name);
    if (dept) return dept;
  }

  // 2. CategoryName string property
  if (service.categoryName) {
    const dept = normalizeDepartment(service.categoryName);
    if (dept) return dept;
  }

  // 3. ServiceItem slug or name
  if (service.serviceItem) {
    const dept = normalizeDepartment(service.serviceItem.slug || service.serviceItem.name);
    if (dept) return dept;
  }

  // 4. Service name directly
  const name = service.serviceName || service.name;
  if (name) {
    const dept = normalizeDepartment(name);
    if (dept) return dept;
  }

  // 5. Fallback only if no department could be resolved
  return 'mechanical';
};

module.exports = {
  DEPARTMENT_ORDER,
  DEPARTMENT_ALIASES,
  normalizeText,
  normalizeDepartment,
  getServiceDepartment
};
