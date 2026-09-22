const prisma = require('../../config/db');
const { createAuditLog, ensureAuditModule } = require('../../common/utils/audit.util');
const { generateUniqueCode, CODE_CONFIG } = require('../../common/utils/code.util');
const { generateSlug, generateUniqueSlug } = require('../../common/utils/slug.util');
const { normalizeVehicleNumber } = require('../../utils/normalizeVehicleNumber');
const { generateGateEntryNo } = require('../../utils/generateGateEntryNo');
const { indianMobileRegex } = require('./mobileGateEntry.validation');
const {
  STATUS_MODULE_CODES,
  resolveStatusFromCodes,
  resolveStatusIdFromCodes
} = require('../../common/utils/status.util');
const { startStage } = require('../processStageTracking/processStageTracking.service');

const ENTRY_STATUS_CODES = ['ACTIVE', 'OPEN', 'ENTERED', 'ENTRY_CREATED'];
const EXIT_STATUS_CODES = ['EXITED', 'CLOSED'];
const DELIVERED_JOB_CARD_STATUS_CODES = ['DELIVERED'];
const TERMINAL_SERVICE_STATUS_CODES = ['COMPLETED', 'REJECTED'];
const TERMINAL_APPROVAL_STATUS_CODES = ['REJECTED'];
const ENTRY_TYPE_MAP = {
  service: 'SERVICE',
  pickup: 'PICKUP',
  enquiry: 'ENQUIRY'
};
const ENTRY_TYPE_ALIASES = {
  all: null,
  service: 'SERVICE',
  pickup: 'PICKUP',
  enquiry: 'ENQUIRY',
  visitor: 'ENQUIRY'
};
const HISTORY_RECORD_TYPES = ['all', 'entries', 'exits', 'inside'];

const createHttpError = (statusCode, message, data = {}) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.data = data;
  return error;
};

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const parseDate = (value, endOfDay = false) => {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  if (endOfDay) {
    date.setHours(23, 59, 59, 999);
  } else {
    date.setHours(0, 0, 0, 0);
  }

  return date;
};

const normalizeHistoryRecordType = (value) => {
  const recordType = String(value || 'all').trim().toLowerCase();
  return HISTORY_RECORD_TYPES.includes(recordType) ? recordType : 'all';
};

const getStatusCode = (status) => String((status && status.statusCode) || '').trim().toUpperCase();

const isTerminalServiceStatus = (status) => {
  const code = getStatusCode(status);
  return TERMINAL_SERVICE_STATUS_CODES.includes(code) || code.endsWith('_COMPLETED');
};

const isTerminalApprovalStatus = (status) => {
  return TERMINAL_APPROVAL_STATUS_CODES.includes(getStatusCode(status));
};

const isJobCardServiceReadyForExit = (service) => {
  if (isTerminalServiceStatus(service.serviceStatus) || isTerminalApprovalStatus(service.approvalStatus)) {
    return true;
  }

  const assignments = service.workAssignments || [];
  return assignments.length > 0 && assignments.every((assignment) => {
    return assignment.completedAt || isTerminalServiceStatus(assignment.status);
  });
};

const getIncompleteJobCardServices = (jobCard) => {
  return (jobCard.services || []).filter((service) => !isJobCardServiceReadyForExit(service));
};

const formatDateKey = (date) => {
  if (!date) {
    return null;
  }

  return new Date(date).toISOString().slice(0, 10);
};

const buildGateCustomerName = (mobileNo) => {
  const lastFiveDigits = String(mobileNo || '').slice(-5);
  return `New Customer ${lastFiveDigits}`;
};

const buildCustomerCodeSlugSource = (customerCode) => `Customer ${customerCode}`;

const normalizeRegistrationOrThrow = (registrationNumber) => {
  const normalizedRegistrationNumber = normalizeVehicleNumber(registrationNumber);

  if (!normalizedRegistrationNumber) {
    throw createHttpError(400, 'registrationNumber is required');
  }

  if (normalizedRegistrationNumber.length < 6) {
    throw createHttpError(400, 'normalized registration number must be at least 6 characters');
  }

  return normalizedRegistrationNumber;
};

const normalizeRoleSlug = (slug) => String(slug || '').trim().toLowerCase().replace(/-/g, '_');

const hasModule = (user, module) => {
  return Boolean(user && Array.isArray(user.modules) && user.modules.includes(module));
};

const hasAnyModule = (user, modules) => {
  return modules.some((module) => hasModule(user, module));
};

const isAdmin = (user) => {
  return hasModule(user, 'admin') || (user && ['admin', 'super_admin'].includes(normalizeRoleSlug(user.roleSlug)));
};

const isGateSecurity = (user) => {
  return hasModule(user, 'gate-security') || (user && ['gate_security', 'gatekeeper'].includes(normalizeRoleSlug(user.roleSlug)));
};

const isLocationScopedViewer = (user) => {
  return hasAnyModule(user, ['gate-security', 'crm-team', 'manager', 'managing-director'])
    || ['gate_security', 'gatekeeper', 'crm_team', 'crm', 'crm_user', 'crm_executive', 'crm_staff', 'manager', 'managing_director']
      .includes(normalizeRoleSlug(user && user.roleSlug));
};

const resolveLocationId = (payload, user, { allowAdminBody = false } = {}) => {
  if (isGateSecurity(user)) {
    if (!user.locationId) {
      throw createHttpError(400, 'Gate security user must be assigned to a location');
    }

    return Number(user.locationId);
  }

  if (allowAdminBody && isAdmin(user) && payload.locationId) {
    const locationId = Number(payload.locationId);

    if (!Number.isInteger(locationId) || locationId <= 0) {
      throw createHttpError(400, 'Valid locationId is required');
    }

    return locationId;
  }

  if (user.locationId) {
    return Number(user.locationId);
  }

  throw createHttpError(400, 'locationId is required');
};

const ensureActiveLocation = async (locationId) => {
  const location = await prisma.location.findFirst({
    where: {
      id: locationId,
      isActive: true
    },
    select: {
      id: true,
      locationCode: true,
      locationName: true
    }
  });

  if (!location) {
    throw createHttpError(400, 'Invalid or inactive location');
  }

  return location;
};

const findVehicleByRegistration = (registrationNo) => {
  return prisma.vehicle.findUnique({
    where: { registrationNo },
    select: {
      id: true,
      registrationNo: true,
      customerId: true,
      customer: {
        select: {
          id: true,
          fullName: true,
          mobileNo: true
        }
      }
    }
  });
};

const findCustomerByMobileNo = (mobileNo, locationId) => {
  return prisma.customer.findFirst({
    where: {
      mobileNo,
      ...(locationId ? { locationId } : {})
    },
    orderBy: {
      id: 'asc'
    },
    select: {
      id: true,
      fullName: true,
      mobileNo: true
    }
  });
};

const findActiveGateEntry = (vehicleId, locationId) => {
  return prisma.gateEntry.findFirst({
    where: {
      vehicleId,
      exitTime: null,
      ...(locationId ? { locationId } : {})
    },
    orderBy: {
      entryTime: 'desc'
    },
    select: gateEntrySelect
  });
};

const gateEntrySelect = {
  id: true,
  gateEntryNo: true,
  entryType: true,
  entryTime: true,
  exitTime: true,
  remarks: true,
  status: {
    select: {
      id: true,
      statusCode: true,
      statusName: true
    }
  },
  customer: {
    select: {
      id: true,
      fullName: true,
      mobileNo: true
    }
  },
  vehicle: {
    select: {
      id: true,
      registrationNo: true
    }
  },
  location: {
    select: {
      id: true,
      locationCode: true,
      locationName: true
    }
  }
};

const toCustomerResponse = (customer) => {
  if (!customer) {
    return null;
  }

  return {
    id: customer.id,
    name: customer.fullName,
    mobileNo: customer.mobileNo
  };
};

const toVehicleResponse = (vehicle) => ({
  id: vehicle.id,
  registrationNumber: vehicle.registrationNo
});

const toGateEntryResponse = (entry) => {
  if (!entry) {
    return null;
  }

  return {
    id: entry.id,
    gateEntryNo: entry.gateEntryNo,
    entryType: String(entry.entryType || '').toLowerCase(),
    entryTime: entry.entryTime,
    exitTime: entry.exitTime,
    remarks: entry.remarks,
    status: entry.status
      ? {
        id: entry.status.id,
        code: entry.status.statusCode,
        name: entry.status.statusName
      }
      : null,
    customer: toCustomerResponse(entry.customer),
    vehicle: entry.vehicle ? toVehicleResponse(entry.vehicle) : null,
    location: entry.location || null
  };
};

const GATE_ENTRY_AUDIT_MODULE = {
  moduleCode: 'gate-entry',
  moduleName: 'Gate Entry'
};

const resolveGateEntryAuditModuleId = async (actorUserId) => {
  if (!actorUserId) {
    return null;
  }

  const auditModule = await ensureAuditModule(prisma, GATE_ENTRY_AUDIT_MODULE);
  return auditModule.id;
};

const createAudit = async (tx, { tableName, recordId, actionType, actorUserId, recordName, comments, locationId, details = [], moduleId = null }) => {
  if (!actorUserId) {
    return null;
  }

  return createAuditLog(tx, {
    ...GATE_ENTRY_AUDIT_MODULE,
    moduleId,
    tableName,
    recordId,
    actionType,
    performedByUserId: actorUserId,
    recordName,
    comments,
    locationId,
    details
  });
};

const createUniqueSlug = (tx, model, source) => {
  const baseSlug = generateSlug(source);

  if (!baseSlug) {
    throw createHttpError(400, 'Valid slug could not be generated');
  }

  return generateUniqueSlug(baseSlug, (slug) => {
    return tx[model].findFirst({
      where: { slug },
      select: { id: true }
    });
  });
};

const generateCustomerCode = async (tx) => {
  const latestCustomer = await tx.customer.findFirst({
    where: {
      customerCode: {
        startsWith: CODE_CONFIG.customer.prefix
      }
    },
    orderBy: { id: 'desc' },
    select: { customerCode: true }
  });

  return generateUniqueCode({
    prefix: CODE_CONFIG.customer.prefix,
    latestCode: latestCustomer ? latestCustomer.customerCode : null,
    existsCallback: async (code) => {
      const existingCustomer = await tx.customer.findFirst({
        where: { customerCode: code },
        select: { id: true }
      });

      return !!existingCustomer;
    }
  });
};

const checkVehicle = async ({ registrationNumber }, user) => {
  const normalizedRegistrationNumber = normalizeRegistrationOrThrow(registrationNumber);
  const locationId = isGateSecurity(user) ? resolveLocationId({}, user) : null;
  const vehicle = await findVehicleByRegistration(normalizedRegistrationNumber);

  if (!vehicle) {
    return {
      isExistingVehicle: false,
      normalizedRegistrationNumber,
      requiredFields: ['whatsappNumber'],
      nextAction: 'CREATE_ENTRY'
    };
  }

  const activeGateEntry = await findActiveGateEntry(vehicle.id, locationId);

  return {
    isExistingVehicle: true,
    normalizedRegistrationNumber,
    vehicle: toVehicleResponse(vehicle),
    customer: toCustomerResponse(vehicle.customer),
    activeGateEntry: activeGateEntry ? toGateEntryResponse(activeGateEntry) : null,
    nextAction: activeGateEntry ? 'EXIT' : 'CREATE_ENTRY'
  };
};

const createGateEntry = async (payload, user) => {
  const normalizedRegistrationNumber = normalizeRegistrationOrThrow(payload.registrationNumber);
  const normalizedEntryType = String(payload.entryType || '').trim().toLowerCase();
  const entryType = ENTRY_TYPE_MAP[normalizedEntryType];

  if (!entryType) {
    throw createHttpError(400, 'entryType must be service, pickup, or enquiry');
  }

  const locationId = resolveLocationId(payload, user, { allowAdminBody: true });
  const location = await ensureActiveLocation(locationId);
  const existingVehicle = await findVehicleByRegistration(normalizedRegistrationNumber);
  const whatsappNumber = String(payload.whatsappNumber || '').trim();
  let existingCustomerByMobile = null;

  if (existingVehicle) {
    if (!existingVehicle.customerId || !existingVehicle.customer) {
      throw createHttpError(
        409,
        'Existing vehicle does not have a valid customer mapping. Ask CRM/admin to fix vehicle-customer mapping.',
        {
          normalizedRegistrationNumber,
          vehicle: toVehicleResponse(existingVehicle),
          nextAction: 'FIX_VEHICLE_CUSTOMER_MAPPING'
        }
      );
    }

    const activeGateEntry = await findActiveGateEntry(existingVehicle.id);

    if (activeGateEntry) {
      return {
        normalizedRegistrationNumber,
        vehicle: toVehicleResponse(existingVehicle),
        customer: toCustomerResponse(existingVehicle.customer),
        activeGateEntry: toGateEntryResponse(activeGateEntry),
        nextAction: 'EXIT',
        message: 'Active gate entry already exists for this vehicle. Submit exit first.'
      };
    }
  }

  if (!existingVehicle) {
    if (!indianMobileRegex.test(whatsappNumber)) {
      throw createHttpError(400, 'whatsappNumber is required for new vehicle and must be a valid 10 digit India mobile number');
    }

    existingCustomerByMobile = await findCustomerByMobileNo(whatsappNumber, locationId);
  }

  const auditModuleId = await resolveGateEntryAuditModuleId(user.userId);

  return prisma.$transaction(async (tx) => {
    let customer = existingVehicle ? existingVehicle.customer : existingCustomerByMobile;
    let vehicle = existingVehicle;
    let isNewCustomer = false;
    let isNewVehicle = false;

    if (!vehicle) {
      if (!customer) {
        const customerName = buildGateCustomerName(whatsappNumber);
        const customerCode = await generateCustomerCode(tx);
        const customerSlug = await createUniqueSlug(tx, 'customer', buildCustomerCodeSlugSource(customerCode));

        customer = await tx.customer.create({
          data: {
            locationId,
            customerCode,
            slug: customerSlug,
            fullName: customerName,
            mobileNo: whatsappNumber,
            createdById: user.userId || null
          },
          select: {
            id: true,
            fullName: true,
            mobileNo: true
          }
        });
        isNewCustomer = true;

        await createAudit(tx, {
          tableName: 'customers',
          recordId: customer.id,
          actionType: 'CREATE',
          actorUserId: user.userId,
          recordName: customer.fullName,
          comments: 'Customer created from gate entry',
          locationId,
          moduleId: auditModuleId,
          details: [
            { fieldName: 'mobileNo', oldValue: null, newValue: customer.mobileNo, dataType: 'string' }
          ]
        });
      }

      const vehicleSlug = await createUniqueSlug(tx, 'vehicle', normalizedRegistrationNumber);
      vehicle = await tx.vehicle.create({
        data: {
          locationId,
          customerId: customer.id,
          slug: vehicleSlug,
          registrationNo: normalizedRegistrationNumber,
          createdById: user.userId || null
        },
        select: {
          id: true,
          registrationNo: true,
          customerId: true
        }
      });
      isNewVehicle = true;

      await createAudit(tx, {
        tableName: 'vehicles',
        recordId: vehicle.id,
        actionType: 'CREATE',
        actorUserId: user.userId,
        recordName: vehicle.registrationNo,
        comments: 'Vehicle created from gate entry',
        locationId,
        moduleId: auditModuleId,
        details: [
          { fieldName: 'registrationNo', oldValue: null, newValue: vehicle.registrationNo, dataType: 'string' }
        ]
      });
    }

    const entryStatusId = await resolveStatusIdFromCodes(tx, STATUS_MODULE_CODES.GATE_ENTRY, ENTRY_STATUS_CODES);
    const gateEntryNo = await generateGateEntryNo({ tx, locationCode: location.locationCode });
    const gateEntrySlug = await createUniqueSlug(tx, 'gateEntry', gateEntryNo);
    const gateEntry = await tx.gateEntry.create({
      data: {
        locationId,
        statusId: entryStatusId,
        entryType,
        gateEntryNo,
        slug: gateEntrySlug,
        customerId: customer.id,
        vehicleId: vehicle.id,
        entryTime: new Date(),
        enteredById: user.userId || null,
        remarks: payload.remarks ? String(payload.remarks).trim() : null,
        createdById: user.userId || null
      },
      select: {
        id: true,
        gateEntryNo: true
      }
    });

    const jobCardQueueStatus = await resolveStatusFromCodes(
      tx,
      STATUS_MODULE_CODES.JOB_CARD_STATUS,
      ['JOB_CARD_PENDING']
    );

    if (jobCardQueueStatus) {
      await startStage({
        locationId,
        gateEntryId: gateEntry.id,
        jobCardId: null,
        customerId: customer.id,
        vehicleId: vehicle.id,
        moduleId: jobCardQueueStatus.moduleId,
        statusId: jobCardQueueStatus.id,
        createdById: user.userId || null
      }, tx);
    }

    await createAudit(tx, {
      tableName: 'gate_entries',
      recordId: gateEntry.id,
      actionType: 'CREATE',
      actorUserId: user.userId,
      recordName: gateEntry.gateEntryNo,
      comments: 'Gate entry created',
      locationId,
      moduleId: auditModuleId,
      details: [
        { fieldName: 'registrationNo', oldValue: null, newValue: normalizedRegistrationNumber, dataType: 'string' },
        { fieldName: 'entryType', oldValue: null, newValue: entryType, dataType: 'string' }
      ]
    });

    return {
      gateEntryId: gateEntry.id,
      gateEntryNo: gateEntry.gateEntryNo,
      normalizedRegistrationNumber,
      isNewCustomer,
      isNewVehicle,
      nextAction: 'WAITING_FOR_CRM',
      isCreated: true
    };
  }, { maxWait: 20000, timeout: 50000 });
};

const submitExit = async (id, payload, user) => {
  const gateEntryId = Number(id);
  const where = {
    id: gateEntryId,
    ...(isGateSecurity(user) ? { locationId: resolveLocationId({}, user) } : {})
  };

  const currentEntry = await prisma.gateEntry.findFirst({
    where,
    select: {
      id: true,
      gateEntryNo: true,
      entryType: true,
      locationId: true,
      exitTime: true
    }
  });

  if (!currentEntry) {
    throw createHttpError(404, 'Gate entry not found');
  }

  if (currentEntry.exitTime) {
    throw createHttpError(409, 'Gate entry exit is already submitted');
  }

  const auditModuleId = await resolveGateEntryAuditModuleId(user.userId);

  return prisma.$transaction(async (tx) => {
    const exitStatusId = await resolveStatusIdFromCodes(tx, STATUS_MODULE_CODES.GATE_ENTRY, EXIT_STATUS_CODES);
    const linkedJobCards = await tx.jobCard.findMany({
      where: {
        gateEntryId
      },
      select: {
        id: true,
        jobCardNo: true,
        currentStatus: {
          select: {
            statusCode: true
          }
        },
        services: {
          select: {
            id: true,
            serviceName: true,
            serviceStatus: {
              select: {
                statusCode: true,
                statusName: true
              }
            },
            approvalStatus: {
              select: {
                statusCode: true,
                statusName: true
              }
            },
            workAssignments: {
              select: {
                id: true,
                completedAt: true,
                status: {
                  select: {
                    statusCode: true,
                    statusName: true
                  }
                }
              }
            }
          }
        }
      }
    });
    const blockedJobCards = linkedJobCards
      .map((jobCard) => ({
        jobCardId: jobCard.id,
        jobCardNo: jobCard.jobCardNo,
        incompleteServices: getIncompleteJobCardServices(jobCard).map((service) => ({
          id: service.id,
          serviceName: service.serviceName,
          serviceStatus: service.serviceStatus
            ? {
              code: service.serviceStatus.statusCode,
              name: service.serviceStatus.statusName
            }
            : null,
          approvalStatus: service.approvalStatus
            ? {
              code: service.approvalStatus.statusCode,
              name: service.approvalStatus.statusName
            }
            : null
        }))
      }))
      .filter((jobCard) => jobCard.incompleteServices.length > 0);

    if (currentEntry.entryType !== 'ENQUIRY' && blockedJobCards.length > 0) {
      throw createHttpError(400, 'All job card services must be completed before vehicle exit', {
        jobCards: blockedJobCards
      });
    }

    const deliveredStatusId = linkedJobCards.length > 0
      ? await resolveStatusIdFromCodes(tx, STATUS_MODULE_CODES.JOB_CARD_STATUS, DELIVERED_JOB_CARD_STATUS_CODES)
      : null;

    if (linkedJobCards.length > 0 && !deliveredStatusId) {
      throw createHttpError(500, 'Delivered job card status is not configured');
    }

    const gateEntry = await tx.gateEntry.update({
      where: { id: gateEntryId },
      data: {
        exitTime: new Date(),
        ...(exitStatusId ? { statusId: exitStatusId } : {}),
        ...(payload.remarks ? { remarks: String(payload.remarks).trim() } : {}),
        modifiedById: user.userId || null
      },
      select: gateEntrySelect
    });

    if (linkedJobCards.length > 0) {
      const jobCardIds = linkedJobCards.map((jobCard) => jobCard.id);

      await tx.jobCard.updateMany({
        where: {
          id: {
            in: jobCardIds
          }
        },
        data: {
          currentStatusId: deliveredStatusId,
          modifiedById: user.userId || null
        }
      });

      const statusLogRows = linkedJobCards
        .filter((jobCard) => getStatusCode(jobCard.currentStatus) !== 'DELIVERED')
        .map((jobCard) => ({
          jobCardId: jobCard.id,
          statusId: deliveredStatusId,
          changedById: user.userId || null,
          remarks: 'Vehicle exited from gate'
        }));

      if (statusLogRows.length > 0) {
        await tx.jobCardStatusLog.createMany({
          data: statusLogRows
        });
      }
    }

    await createAudit(tx, {
      tableName: 'gate_entries',
      recordId: gateEntry.id,
      actionType: 'UPDATE',
      actorUserId: user.userId,
      recordName: gateEntry.gateEntryNo,
      comments: 'Gate entry exited',
      locationId: gateEntry.location.id,
      moduleId: auditModuleId,
      details: [
        { fieldName: 'exitTime', oldValue: null, newValue: gateEntry.exitTime, dataType: 'date' }
      ]
    });

    return {
      gateEntry: toGateEntryResponse(gateEntry),
      jobCards: linkedJobCards.map((jobCard) => ({
        id: jobCard.id,
        jobCardNo: jobCard.jobCardNo,
        status: linkedJobCards.length > 0 ? 'DELIVERED' : null
      })),
      nextAction: 'EXIT_SUBMITTED'
    };
  }, { maxWait: 20000, timeout: 50000 });
};

const getHistoryDateRange = (query) => {
  const fromDate = parseDate(query.fromDate || query.date);
  const toDate = parseDate(query.toDate || query.date, true);

  if (!fromDate && !toDate) {
    return null;
  }

  return {
    ...(fromDate ? { gte: fromDate } : {}),
    ...(toDate ? { lte: toDate } : {})
  };
};

const buildHistoryBaseWhere = (query, user) => {
  const where = {};

  if (query.entryType && String(query.entryType).trim().toLowerCase() !== 'all') {
    const entryType = ENTRY_TYPE_ALIASES[String(query.entryType).trim().toLowerCase()];
    if (entryType) {
      where.entryType = entryType;
    }
  }

  const search = String(query.search || query.registrationNumber || query.mobileNo || '').trim();
  if (search) {
    const normalizedSearch = normalizeVehicleNumber(search);
    where.OR = [
      ...(normalizedSearch
        ? [
          {
            vehicle: {
              registrationNo: {
                contains: normalizedSearch
              }
            }
          }
        ]
        : []),
      {
        customer: {
          mobileNo: {
            contains: search
          }
        }
      },
      {
        customer: {
          alternateMobileNo: {
            contains: search
          }
        }
      }
    ];
  }

  if (isLocationScopedViewer(user)) {
    if (!user.locationId) {
      throw createHttpError(400, 'Location is required for this role');
    }
    where.locationId = resolveLocationId({}, user);
  } else if (query.locationId) {
    where.locationId = parsePositiveInt(query.locationId, undefined);
  } else if (user.locationId) {
    where.locationId = Number(user.locationId);
  }

  return where;
};

const withEventDateFilter = (baseWhere, recordType, dateRange) => {
  if (recordType === 'entries') {
    return {
      ...baseWhere,
      ...(dateRange ? { entryTime: dateRange } : {})
    };
  }

  if (recordType === 'exits') {
    return {
      ...baseWhere,
      exitTime: {
        not: null,
        ...(dateRange || {})
      }
    };
  }

  if (recordType === 'inside') {
    return {
      ...baseWhere,
      exitTime: null,
      ...(dateRange ? { entryTime: dateRange } : {})
    };
  }

  if (!dateRange) {
    return baseWhere;
  }

  const { OR: baseOr, ...baseFilters } = baseWhere;
  return {
    ...baseFilters,
    AND: [
      ...(baseOr ? [{ OR: baseOr }] : []),
      {
        OR: [
          {
            entryTime: dateRange
          },
          {
            exitTime: {
              not: null,
              ...dateRange
            }
          }
        ]
      }
    ]
  };
};

const isRecordWithinDateRange = (date, dateRange) => {
  if (!date || !dateRange) {
    return true;
  }

  const time = new Date(date).getTime();
  if (dateRange.gte && time < new Date(dateRange.gte).getTime()) {
    return false;
  }

  if (dateRange.lte && time > new Date(dateRange.lte).getTime()) {
    return false;
  }

  return true;
};

const toHistoryRecordResponse = (entry, direction, happenedAt) => ({
  id: `${entry.id}-${direction.toLowerCase()}`,
  gateEntryId: entry.id,
  gateEntryNo: entry.gateEntryNo,
  direction,
  eventType: direction.toLowerCase(),
  happenedAt,
  entryType: String(entry.entryType || '').toLowerCase(),
  entryTime: entry.entryTime,
  exitTime: entry.exitTime,
  remarks: entry.remarks,
  status: entry.status
    ? {
      id: entry.status.id,
      code: entry.status.statusCode,
      name: entry.status.statusName
    }
    : null,
  customer: toCustomerResponse(entry.customer),
  vehicle: entry.vehicle ? toVehicleResponse(entry.vehicle) : null,
  location: entry.location || null
});

const buildHistoryRecords = (entries, recordType, dateRange) => {
  const records = [];

  entries.forEach((entry) => {
    if ((recordType === 'all' || recordType === 'entries') && isRecordWithinDateRange(entry.entryTime, dateRange)) {
      records.push(toHistoryRecordResponse(entry, 'ENTRY', entry.entryTime));
    }

    if ((recordType === 'all' || recordType === 'exits') && entry.exitTime && isRecordWithinDateRange(entry.exitTime, dateRange)) {
      records.push(toHistoryRecordResponse(entry, 'EXIT', entry.exitTime));
    }

    if (recordType === 'inside' && !entry.exitTime && isRecordWithinDateRange(entry.entryTime, dateRange)) {
      records.push(toHistoryRecordResponse(entry, 'INSIDE', entry.entryTime));
    }
  });

  return records.sort((first, second) => new Date(second.happenedAt).getTime() - new Date(first.happenedAt).getTime());
};

const groupHistoryRecords = (records, allRecords = records) => {
  const groups = [];
  const groupMap = new Map();
  const totalByDate = allRecords.reduce((acc, record) => {
    const dateKey = formatDateKey(record.happenedAt);
    acc[dateKey] = (acc[dateKey] || 0) + 1;
    return acc;
  }, {});

  records.forEach((record) => {
    const dateKey = formatDateKey(record.happenedAt);
    if (!groupMap.has(dateKey)) {
      const group = {
        date: dateKey,
        totalRecords: totalByDate[dateKey] || 0,
        records: []
      };
      groupMap.set(dateKey, group);
      groups.push(group);
    }

    const group = groupMap.get(dateKey);
    group.records.push(record);
  });

  return groups;
};

const history = async (query, user) => {
  const page = parsePositiveInt(query.page, 1);
  const limit = parsePositiveInt(query.limit, 10);
  const recordType = normalizeHistoryRecordType(query.recordType || query.logType || query.tab || query.status);
  const dateRange = getHistoryDateRange(query);
  const baseWhere = buildHistoryBaseWhere(query, user);
  const entriesWhere = withEventDateFilter(baseWhere, 'entries', dateRange);
  const exitsWhere = withEventDateFilter(baseWhere, 'exits', dateRange);
  const insideWhere = withEventDateFilter(baseWhere, 'inside', dateRange);
  const recordsWhere = withEventDateFilter(baseWhere, recordType, dateRange);

  const [entries, totalEntries, historyEntries, summaryEntries, summaryExits, summaryInside] = await prisma.$transaction([
    prisma.gateEntry.findMany({
      where: entriesWhere,
      select: gateEntrySelect,
      orderBy: {
        entryTime: 'desc'
      },
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.gateEntry.count({ where: entriesWhere }),
    prisma.gateEntry.findMany({
      where: recordsWhere,
      select: gateEntrySelect,
      orderBy: {
        entryTime: 'desc'
      }
    }),
    prisma.gateEntry.count({ where: entriesWhere }),
    prisma.gateEntry.count({ where: exitsWhere }),
    prisma.gateEntry.count({ where: insideWhere })
  ]);
  const allRecords = buildHistoryRecords(historyEntries, recordType, dateRange);
  const records = allRecords.slice((page - 1) * limit, page * limit);
  const totalRecords = allRecords.length;

  return {
    entries: entries.map(toGateEntryResponse),
    records,
    groups: groupHistoryRecords(records, allRecords),
    summary: {
      totalEntries: summaryEntries,
      totalExits: summaryExits,
      currentlyInside: summaryInside,
      totalRecords: summaryEntries + summaryExits
    },
    filters: {
      recordType,
      entryType: query.entryType ? String(query.entryType).trim().toLowerCase() : 'all',
      search: String(query.search || query.registrationNumber || query.mobileNo || '').trim() || null,
      fromDate: query.fromDate || query.date || null,
      toDate: query.toDate || query.date || null
    },
    meta: {
      page,
      limit,
      total: totalRecords,
      totalPages: Math.ceil(totalRecords / limit),
      entriesTotal: totalEntries
    }
  };
};

const activeByVehicle = async ({ registrationNumber }, user) => {
  const normalizedRegistrationNumber = normalizeRegistrationOrThrow(registrationNumber);
  const vehicle = await findVehicleByRegistration(normalizedRegistrationNumber);

  if (!vehicle) {
    return {
      normalizedRegistrationNumber,
      activeGateEntry: null,
      nextAction: 'CREATE_ENTRY'
    };
  }

  const activeGateEntry = await findActiveGateEntry(vehicle.id, isGateSecurity(user) ? resolveLocationId({}, user) : null);

  return {
    normalizedRegistrationNumber,
    vehicle: toVehicleResponse(vehicle),
    activeGateEntry: toGateEntryResponse(activeGateEntry),
    nextAction: activeGateEntry ? 'EXIT' : 'CREATE_ENTRY'
  };
};

const pendingCrmEntries = async (query, user) => {
  const page = parsePositiveInt(query.page, 1);
  const limit = parsePositiveInt(query.limit, 10);
  const where = {
    jobCards: {
      none: {}
    }
  };
  const fromDate = parseDate(query.date);

  if (fromDate) {
    where.entryTime = {
      gte: fromDate,
      lte: parseDate(query.date, true)
    };
  }

  if (query.registrationNumber) {
    where.vehicle = {
      registrationNo: normalizeRegistrationOrThrow(query.registrationNumber)
    };
  }

  const queryLocationId = parsePositiveInt(query.locationId, undefined);
  if (isLocationScopedViewer(user)) {
    if (!user.locationId) {
      throw createHttpError(400, 'Location is required for this role');
    }
    where.locationId = Number(user.locationId);
  } else if (user.locationId) {
    where.locationId = Number(user.locationId);
  } else if (queryLocationId) {
    where.locationId = queryLocationId;
  }

  const [entries, total] = await prisma.$transaction([
    prisma.gateEntry.findMany({
      where,
      select: gateEntrySelect,
      orderBy: {
        entryTime: 'desc'
      },
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.gateEntry.count({ where })
  ]);

  return {
    entries: entries.map(toGateEntryResponse),
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
};

module.exports = {
  checkVehicle,
  createGateEntry,
  submitExit,
  history,
  activeByVehicle,
  pendingCrmEntries
};
