const ROLE_DEFAULT_PERMISSIONS = {
  'crm-team': {
    module: 'crm-team',
    permissions: {
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true
    }
  },
  'gate-security': {
    module: 'gate-security',
    permissions: {
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true
    }
  }
};

module.exports = {
  ROLE_DEFAULT_PERMISSIONS
};
