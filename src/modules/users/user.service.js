const bcrypt = require('bcryptjs');

const prisma = require('../../config/db');
const userRepository = require('./user.repository');
const { generateUniqueCode, CODE_CONFIG } = require('../../common/utils/code.util');
const { generateSlug, generateUniqueSlug } = require('../../common/utils/slug.util');
const { generateRandomPassword, sendWelcomeEmail } = require('../../utils/welcomeEmailHelper');
const { createAuditLog, buildChangeDetails } = require('../../common/utils/audit.util');

const DEFAULT_USER_PASSWORD = 'Admin@123';
const ADMIN_ROLE_SLUGS = new Set(['admin', 'super_admin']);
const MANAGING_DIRECTOR_ROLE = 'managing_director';
const ADMIN_MODULE = 'admin';
const MANAGER_MODULE = 'manager';
const MANAGING_DIRECTOR_MODULE = 'managing-director';
const MD_BLOCKED_ROLE_SLUGS = new Set(['admin', 'super_admin', 'managing_director']);
const MD_ALLOWED_ROLE_SLUGS = new Set([
  'gate_security',
  'gatekeeper',
  'crm_team',
  'floor_supervisor',
  'body_shop_supervisor',
  'water_wash_supervisor',
  'water_wash_team',
  'manager'
]);
const LOCATION_REQUIRED_ROLE_SLUGS = new Set([
  'managing_director',
  'gate_security',
  'gatekeeper',
  'crm_team',
  'floor_supervisor',
  'body_shop_supervisor',
  'water_wash_supervisor',
  'water_wash_team',
  'manager'
]);
const ASSIGNABLE_MODULE_BY_CATEGORY = {
  mechanical: 'floor-supervisor',
  'body-shop': 'body-shop-supervisor',
  'water-wash': 'water-wash-team'
};

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

const parseBooleanFilter = (value) => {
  if (value === undefined || value === '') {
    return undefined;
  }

  if (value === true || value === 'true') {
    return true;
  }

  if (value === false || value === 'false') {
    return false;
  }

  return undefined;
};

const normalizeRoleSlug = (slug) => String(slug || '').trim().toLowerCase().replace(/-/g, '_');

const normalizeAssignmentCategory = (category) => {
  const normalized = String(category || '').trim().toLowerCase().replace(/[_\s]+/g, '-');

  if (['body-shop', 'bodyshop', 'paint', 'denting'].includes(normalized)) {
    return 'body-shop';
  }

  if (['water-wash', 'waterwash', 'wash'].includes(normalized)) {
    return 'water-wash';
  }

  return 'mechanical';
};

const getServiceCategoryAliases = (category) => {
  if (category === 'body-shop') {
    return ['body-shop', 'bodyshop', 'body_shop', 'paint', 'denting'];
  }

  if (category === 'water-wash') {
    return ['water-wash', 'waterwash', 'water_wash', 'wash'];
  }

  return ['mechanical', 'mechanic', 'mechnanic', 'floor'];
};

const isAdminRole = (roleSlug) => ADMIN_ROLE_SLUGS.has(normalizeRoleSlug(roleSlug));

const isManagingDirector = (user) => normalizeRoleSlug(user && user.roleSlug) === MANAGING_DIRECTOR_ROLE;

const getRoleModules = async (roleId) => {
  if (!roleId) {
    return new Set();
  }

  const permissions = await prisma.roleMenuPermission.findMany({
    where: {
      roleId,
      canRead: true,
      menu: {
        isActive: true
      }
    },
    select: {
      menu: {
        select: {
          module: true
        }
      }
    }
  });

  return new Set(permissions.map((permission) => permission.menu.module));
};

const getRestrictedModulesForActor = async (actor) => {
  const actorModules = await getRoleModules(actor && actor.roleId);

  if (actorModules.has(ADMIN_MODULE)) {
    return [];
  }

  const restrictedModules = [ADMIN_MODULE];

  if (actorModules.has(MANAGER_MODULE) || actorModules.has(MANAGING_DIRECTOR_MODULE)) {
    restrictedModules.push(MANAGING_DIRECTOR_MODULE);
  }

  return restrictedModules;
};

const parseOptionalPositiveInt = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : NaN;
};

const hasLocationInput = (value) => value !== undefined;

const toPublicUser = (user) => ({
  id: user.id,
  slug: user.slug,
  fullName: user.fullName,
  email: user.emailId,
  mobile: user.mobileNo,
  employeeCode: user.employeeCode,
  locationId: user.locationId,
  location: user.location ? {
    id: user.location.id,
    locationCode: user.location.locationCode,
    locationName: user.location.locationName
  } : null,
  locationName: user.location ? user.location.locationName : null,
  isActive: user.isActive,
  role: {
    id: user.role.id,
    name: user.role.name,
    slug: user.role.slug
  },
  dob: user.dob,
  licenceNumber: user.licenceNumber,
  emergencyContact: user.emergencyContact,
  gender: user.gender,
  address: user.address,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
  lastLoginAt: user.lastLoginAt,
  lastLogin: user.lastLoginAt
});

const hashPassword = (password) => {
  return bcrypt.hash(password, 12);
};

const ensureUserExists = async (id) => {
  const user = await userRepository.findUserById(id);

  if (!user) {
    throw createHttpError(404, 'User not found');
  }

  return user;
};

const resolveUserByIdentifier = async (identifier) => {
  const parsedId = Number(identifier);
  const user = Number.isInteger(parsedId) && parsedId > 0
    ? await userRepository.findUserById(parsedId)
    : await userRepository.findUserBySlug(String(identifier || '').trim());

  if (!user) {
    throw createHttpError(404, 'User not found');
  }

  return user;
};

const resolveUserSlug = async (fullName, excludeId) => {
  const baseSlug = generateSlug(fullName);

  if (!baseSlug) {
    throw createHttpError(400, 'Valid user slug could not be generated from full name');
  }

  return generateUniqueSlug(baseSlug, async (slugValue) => {
    const existingUser = await userRepository.findUserBySlug(slugValue);
    return existingUser && existingUser.id !== excludeId;
  });
};

const ensureRoleExists = async (roleId) => {
  const role = await userRepository.findRoleById(roleId);

  if (!role || !role.isActive) {
    throw createHttpError(400, 'roleId must reference an existing role');
  }

  return role;
};

const ensureActiveLocationExists = async (locationId) => {
  const location = await userRepository.findActiveLocationById(locationId);

  if (!location) {
    throw createHttpError(400, 'Invalid or inactive location');
  }

  return location;
};

const resolveLocationForRole = async ({ actor, targetRole, requestedLocationId, currentLocationId }) => {
  const targetRoleSlug = normalizeRoleSlug(targetRole.slug);
  const parsedRequestedLocationId = parseOptionalPositiveInt(requestedLocationId);
  const shouldUseRequestedLocation = hasLocationInput(requestedLocationId);

  if (Number.isNaN(parsedRequestedLocationId)) {
    throw createHttpError(400, 'Invalid or inactive location');
  }

  if (isAdminRole(actor.roleSlug)) {
    const nextLocationId = shouldUseRequestedLocation
      ? parsedRequestedLocationId
      : currentLocationId || null;

    if (LOCATION_REQUIRED_ROLE_SLUGS.has(targetRoleSlug) && !nextLocationId) {
      throw createHttpError(400, 'Location is required for this role');
    }

    if (nextLocationId) {
      await ensureActiveLocationExists(nextLocationId);
    }

    return nextLocationId;
  }

  if (isManagingDirector(actor)) {
    if (!actor.locationId) {
      throw createHttpError(400, 'Managing Director is not assigned to any location');
    }

    if (parsedRequestedLocationId && parsedRequestedLocationId !== Number(actor.locationId)) {
      throw createHttpError(403, 'You cannot create users for another location');
    }

    return Number(actor.locationId);
  }

  throw createHttpError(403, 'You do not have permission to manage this role');
};

const assertActorCanManageRole = (actor, targetRole) => {
  const targetRoleSlug = normalizeRoleSlug(targetRole.slug);

  if (isAdminRole(actor.roleSlug)) {
    return;
  }

  if (isManagingDirector(actor)) {
    if (MD_BLOCKED_ROLE_SLUGS.has(targetRoleSlug)) {
      throw createHttpError(403, 'You do not have permission to manage this role');
    }

    return;
  }

  throw createHttpError(403, 'You do not have permission to manage this role');
};

const assertMdCanAccessUser = (actor, targetUser) => {
  if (!isManagingDirector(actor)) {
    return;
  }

  if (!actor.locationId) {
    throw createHttpError(400, 'Managing Director is not assigned to any location');
  }

  if (targetUser.locationId !== Number(actor.locationId)) {
    throw createHttpError(403, 'You can access only users from your assigned location');
  }

  if (MD_BLOCKED_ROLE_SLUGS.has(normalizeRoleSlug(targetUser.role.slug))) {
    throw createHttpError(403, 'You do not have permission to manage this role');
  }
};

const ensureUniqueEmail = async (email, excludeId) => {
  const existingUser = await userRepository.findUserByEmail(email, excludeId);

  if (existingUser) {
    throw createHttpError(409, 'Email already exists');
  }
};

const ensureUniqueMobile = async (mobile, excludeId) => {
  if (!mobile) return;
  const existingUser = await userRepository.findUserByMobile(mobile, excludeId);

  if (existingUser) {
    throw createHttpError(409, 'Mobile number already exists');
  }
};

const ensureUniqueLicenceNumber = async (licenceNumber, excludeId) => {
  if (!licenceNumber) return;
  const existingUser = await userRepository.findUserByLicenceNumber(licenceNumber, excludeId);

  if (existingUser) {
    throw createHttpError(409, 'Licence number already exists');
  }
};

const ensureUniqueEmployeeCode = async (employeeCode, excludeId) => {
  if (!employeeCode) {
    return;
  }

  const existingUser = await userRepository.findUserByEmployeeCode(employeeCode, excludeId);

  if (existingUser) {
    throw createHttpError(409, 'Employee code already exists');
  }
};

const assertNotRemovingLastActiveAdmin = async ({ currentUser, nextRoleId, nextIsActive }) => {
  const isCurrentActiveAdmin = currentUser.isActive && isAdminRole(currentUser.role.slug);

  if (!isCurrentActiveAdmin) {
    return;
  }

  const nextRole = nextRoleId && nextRoleId !== currentUser.roleId
    ? await ensureRoleExists(nextRoleId)
    : currentUser.role;

  const remainsActiveAdmin = nextIsActive !== false && isAdminRole(nextRole.slug);

  if (remainsActiveAdmin) {
    return;
  }

  const activeAdminCount = await userRepository.countActiveAdmins();

  if (activeAdminCount <= 1) {
    throw createHttpError(400, 'Cannot deactivate or remove the last active admin user');
  }
};

const createUser = async ({ fullName, email, mobile, employeeCode, roleId, password, dob, licenceNumber, emergencyContact, gender, address, locationId }, actor) => {
  const normalizedEmail = email.trim();
  let normalizedEmployeeCode = employeeCode ? employeeCode.trim() : null;
  const parsedRoleId = Number(roleId);


  const initialPassword = typeof password === 'string' && password.trim() ? password : DEFAULT_USER_PASSWORD;

  // const isRandomPasswordGenerated = !(typeof password === 'string' && password.trim());
  // const initialPassword = isRandomPasswordGenerated ? generateRandomPassword(8) : password.trim();

  const role = await ensureRoleExists(parsedRoleId);
  const normalizedFullName = fullName.trim();
  const normalizedSlug = await resolveUserSlug(normalizedFullName);
  assertActorCanManageRole(actor, role);
  const resolvedLocationId = await resolveLocationForRole({
    actor,
    targetRole: role,
    requestedLocationId: locationId
  });
  await ensureUniqueEmail(normalizedEmail);
  await ensureUniqueMobile(mobile ? mobile.trim() : null);
  await ensureUniqueLicenceNumber(licenceNumber ? licenceNumber.trim() : null);

  if (!normalizedEmployeeCode) {
    const latestUser = await userRepository.findLatestEmployeeCode();
    normalizedEmployeeCode = await generateUniqueCode({
      prefix: CODE_CONFIG.employee.prefix,
      latestCode: latestUser?.employeeCode,
      existsCallback: async (code) => !!(await userRepository.findUserByEmployeeCode(code))
    });
  } else {
    await ensureUniqueEmployeeCode(normalizedEmployeeCode);
  }

  const passwordHash = await hashPassword(initialPassword);

  const data = {
    fullName: normalizedFullName,
    slug: normalizedSlug,
    emailId: normalizedEmail,
    mobileNo: mobile ? mobile.trim() : null,
    employeeCode: normalizedEmployeeCode,
    roleId: parsedRoleId,
    locationId: resolvedLocationId,
    passwordHash,
    dob: dob ? new Date(dob) : null,
    licenceNumber: licenceNumber ? licenceNumber.trim() : null,
    emergencyContact: emergencyContact ? emergencyContact.trim() : null,
    gender: gender ? gender.trim() : null,
    address: address ? address.trim() : null,
    createdById: actor.userId || null
  };

  const user = await prisma.$transaction(async (tx) => {
    const newUser = await userRepository.createUser(data, tx);

    await createAuditLog(tx, {
      moduleCode: 'user-management',
      moduleName: 'User Management',
      tableName: 'users',
      recordId: newUser.id,
      actionType: 'CREATE',
      performedByUserId: actor.userId,
      recordName: newUser.fullName,
      comments: 'User created',
      locationId: newUser.locationId,
      details: Object.entries(data).filter(([k]) => k !== 'passwordHash').map(([fieldName, newValue]) => ({
        fieldName,
        oldValue: null,
        newValue,
        dataType: typeof newValue
      }))
    });

    return newUser;
  }, { maxWait: 20000, timeout: 50000 });

  // if (isRandomPasswordGenerated && normalizedEmail) {
  //   try {
  //     await sendWelcomeEmail(normalizedEmail, initialPassword);
  //   } catch (error) {
  //     console.error('Failed to send welcome email:', error);
  //   }
  // }

  return toPublicUser(user);
};

const updateUser = async (id, { fullName, email, mobile, employeeCode, roleId, dob, licenceNumber, emergencyContact, gender, address, locationId }, actor) => {
  const parsedRoleId = Number(roleId);
  const normalizedEmail = email.trim();

  const currentUser = await resolveUserByIdentifier(id);
  const normalizedEmployeeCode = employeeCode ? employeeCode.trim() : currentUser.employeeCode;
  const userId = currentUser.id;
  const normalizedFullName = fullName.trim();
  const normalizedSlug = await resolveUserSlug(normalizedFullName, userId);
  assertMdCanAccessUser(actor, currentUser);
  const role = await ensureRoleExists(parsedRoleId);
  assertActorCanManageRole(actor, role);
  await assertNotRemovingLastActiveAdmin({
    currentUser,
    nextRoleId: parsedRoleId,
    nextIsActive: currentUser.isActive
  });
  const resolvedLocationId = await resolveLocationForRole({
    actor,
    targetRole: role,
    requestedLocationId: locationId,
    currentLocationId: currentUser.locationId
  });
  await ensureUniqueEmail(normalizedEmail, userId);
  await ensureUniqueMobile(mobile ? mobile.trim() : null, userId);
  await ensureUniqueLicenceNumber(licenceNumber ? licenceNumber.trim() : null, userId);
  await ensureUniqueEmployeeCode(normalizedEmployeeCode, userId);

  const data = {
    fullName: normalizedFullName,
    slug: normalizedSlug,
    emailId: normalizedEmail,
    mobileNo: mobile ? mobile.trim() : null,
    employeeCode: normalizedEmployeeCode,
    roleId: parsedRoleId,
    locationId: resolvedLocationId,
    dob: dob ? new Date(dob) : null,
    licenceNumber: licenceNumber ? licenceNumber.trim() : null,
    emergencyContact: emergencyContact ? emergencyContact.trim() : null,
    gender: gender ? gender.trim() : null,
    address: address ? address.trim() : null
  };

  const user = await prisma.$transaction(async (tx) => {
    const updatedUser = await userRepository.updateUser(userId, data, tx);

    await createAuditLog(tx, {
      moduleCode: 'user-management',
      moduleName: 'User Management',
      tableName: 'users',
      recordId: updatedUser.id,
      actionType: 'UPDATE',
      performedByUserId: actor.userId,
      recordName: updatedUser.fullName,
      comments: 'User updated',
      locationId: updatedUser.locationId,
      details: buildChangeDetails(currentUser, updatedUser, Object.keys(data))
    });

    return updatedUser;
  }, { maxWait: 20000, timeout: 50000 });

  return toPublicUser(user);
};

const listUsers = async (query, actor) => {
  const isExport = query.export === 'true';
  const page = isExport ? 1 : parsePositiveInt(query.page, 1);
  const limit = isExport ? 1000000 : parsePositiveInt(query.limit, 10);
  const search = query.search ? query.search.trim() : undefined;
  const roleId = query.roleId ? parsePositiveInt(query.roleId, undefined) : undefined;
  const requestedLocationId = query.locationId ? parsePositiveInt(query.locationId, undefined) : undefined;
  const locationId = isManagingDirector(actor) ? Number(actor.locationId) : requestedLocationId;
  const isActive = parseBooleanFilter(query.isActive);
  const fromDate = (query.fromDate || query.startDate) ? String(query.fromDate || query.startDate).trim() : undefined;
  const toDate = (query.toDate || query.endDate) ? String(query.toDate || query.endDate).trim() : undefined;
  const excludedModules = await getRestrictedModulesForActor(actor);
  const excludedUserId = actor && actor.userId ? Number(actor.userId) : undefined;

  if (isManagingDirector(actor) && !actor.locationId) {
    throw createHttpError(400, 'Managing Director is not assigned to any location');
  }

  const { users, total } = await userRepository.listUsers({
    page,
    limit,
    search,
    roleId,
    locationId,
    isActive,
    excludedModules,
    excludedUserId,
    fromDate,
    toDate
  });

  return {
    users: users.map(toPublicUser),
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
};

const listMechanicDropdown = async (query, actor) => {
  const requestedLocationId = query.locationId ? parsePositiveInt(query.locationId, undefined) : undefined;
  const locationId = actor && actor.locationId ? Number(actor.locationId) : requestedLocationId;
  const category = normalizeAssignmentCategory(query.category);
  const targetModule = ASSIGNABLE_MODULE_BY_CATEGORY[category] || ASSIGNABLE_MODULE_BY_CATEGORY.mechanical;

  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      ...(locationId ? { locationId } : {}),
      role: {
        isActive: true,
        rolePermissions: {
          some: {
            canRead: true,
            menu: {
              isActive: true,
              module: targetModule
            }
          }
        }
      }
    },
    select: {
      id: true,
      fullName: true,
      employeeCode: true,
      mobileNo: true,
      locationId: true,
      role: {
        select: {
          id: true,
          name: true,
          slug: true
        }
      }
    },
    orderBy: {
      fullName: 'asc'
    }
  });

  const userIds = users.map((user) => user.id);
  const activeAssignments = userIds.length > 0
    ? await prisma.workAssignment.findMany({
      where: {
        assignedUserId: {
          in: userIds
        },
        completedAt: null,
        ...(locationId ? { locationId } : {}),
        jobCardService: {
          serviceItem: {
            category: {
              OR: getServiceCategoryAliases(category).map((alias) => ({
                slug: String(alias).trim().toLowerCase().replace(/[_\s]+/g, '-')
              }))
            }
          }
        }
      },
      select: {
        assignedUserId: true,
        jobCardId: true
      }
    })
    : [];
  const activeJobMap = activeAssignments.reduce((map, assignment) => {
    if (!map.has(assignment.assignedUserId)) {
      map.set(assignment.assignedUserId, new Set());
    }
    map.get(assignment.assignedUserId).add(assignment.jobCardId);
    return map;
  }, new Map());

  return users.map((user) => ({
    id: user.id,
    fullName: user.fullName,
    employeeCode: user.employeeCode,
    mobile: user.mobileNo,
    locationId: user.locationId,
    role: user.role,
    activeJobCount: activeJobMap.get(user.id)?.size || 0,
    availability: activeJobMap.get(user.id)?.size ? 'BUSY' : 'AVAILABLE',
    availabilityLabel: activeJobMap.get(user.id)?.size
      ? `Busy (${activeJobMap.get(user.id).size} job${activeJobMap.get(user.id).size > 1 ? 's' : ''})`
      : 'Available'
  })).sort((a, b) => {
    return a.activeJobCount - b.activeJobCount || a.fullName.localeCompare(b.fullName);
  });
};

const getUserDetail = async (id, actor) => {
  const user = await resolveUserByIdentifier(id);
  assertMdCanAccessUser(actor, user);

  return toPublicUser(user);
};

const updateUserStatus = async (id, { isActive }, actor) => {
  const currentUser = await resolveUserByIdentifier(id);
  const userId = currentUser.id;
  assertMdCanAccessUser(actor, currentUser);

  await assertNotRemovingLastActiveAdmin({
    currentUser,
    nextRoleId: currentUser.roleId,
    nextIsActive: isActive
  });

  const user = await prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: {
        isActive,
        modifiedById: actor.userId || null
      },
      select: {
        id: true,
        slug: true,
        fullName: true,
        emailId: true,
        mobileNo: true,
        employeeCode: true,
        locationId: true,
        isActive: true,
        roleId: true,
        role: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        },
        location: {
          select: {
            id: true,
            locationCode: true,
            locationName: true
          }
        }
      }
    });

    await createAuditLog(tx, {
      moduleCode: 'user-management',
      moduleName: 'User Management',
      tableName: 'users',
      recordId: updatedUser.id,
      actionType: isActive ? 'ACTIVATE' : 'DEACTIVATE',
      performedByUserId: actor.userId,
      recordName: updatedUser.fullName,
      comments: isActive ? 'User activated' : 'User deactivated',
      locationId: updatedUser.locationId,
      details: buildChangeDetails(currentUser, updatedUser, ['isActive', 'modifiedById'])
    });

    return updatedUser;
  }, { maxWait: 20000, timeout: 50000 });

  return toPublicUser(user);
};

const resetUserPassword = async (id, { password }, actor) => {
  const currentUser = await resolveUserByIdentifier(id);
  const userId = currentUser.id;
  assertMdCanAccessUser(actor, currentUser);

  const passwordHash = await hashPassword(password);
  const user = await userRepository.updateUser(userId, { passwordHash });

  return toPublicUser(user);
};

module.exports = {
  createUser,
  updateUser,
  listUsers,
  listMechanicDropdown,
  getUserDetail,
  updateUserStatus,
  resetUserPassword
};
