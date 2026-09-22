const crypto = require('crypto');
const prisma = require('../../config/db');
const { STATUS_MODULE_CODES, resolveStatusFromCodes, resolveStatusIdFromCodes } = require('../../common/utils/status.util');
const { validateTwilioRequest, sendAdditionalWorkApproval } = require('../../providers/whatsapp/whatsapp.service');

const DEPARTMENT_ORDER = ['mechanical', 'body-shop', 'water-wash'];
const DEPARTMENT_ALIASES = {
  mechanical: ['mechanical', 'mechanic', 'mechnanic', 'floor'],
  'body-shop': ['body-shop', 'body_shop', 'body shop', 'bodyshop', 'paint', 'denting'],
  'water-wash': ['water-wash', 'water_wash', 'water wash', 'wash']
};
const ROLE_ALIASES = {
  body_shop: 'body_shop_supervisor',
  bodyshop: 'body_shop_supervisor',
  bodyshop_supervisor: 'body_shop_supervisor',
  floor: 'floor_supervisor',
  mechanical_supervisor: 'floor_supervisor',
  water_wash: 'water_wash_team',
  water_wash_supervisor: 'water_wash_team',
  wash: 'water_wash_team'
};
const ROLE_DEPARTMENTS = {
  floor_supervisor: 'mechanical',
  mechanical: 'mechanical',
  mechanic: 'mechanical',
  body_shop_supervisor: 'body-shop',
  water_wash_supervisor: 'water-wash',
  water_wash_team: 'water-wash',
  water_wash: 'water-wash'
};
const PRIVILEGED_ROLES = new Set(['admin', 'super_admin', 'manager', 'managing_director']);
const MODULE_DEPARTMENTS = {
  'floor-supervisor': 'mechanical',
  'body-shop-supervisor': 'body-shop',
  'water-wash-team': 'water-wash'
};
const PRIVILEGED_MODULES = new Set(['admin', 'manager', 'managing-director']);
const APPROVAL_TYPE_ADDITIONAL_WORK = 'ADDITIONAL_WORK';
const ADDITIONAL_WORK_SCHEMA_STATEMENTS = [
  `
IF COL_LENGTH('job_card_approvals', 'approval_code') IS NULL
BEGIN
  ALTER TABLE job_card_approvals ADD approval_code NVARCHAR(30) NULL;
END
  `,
  `
IF COL_LENGTH('job_card_approvals', 'mechanic_explanation') IS NULL
BEGIN
  ALTER TABLE job_card_approvals ADD mechanic_explanation NVARCHAR(MAX) NULL;
END
  `,
  `
IF COL_LENGTH('job_card_services', 'parent_job_card_service_id') IS NULL
BEGIN
  ALTER TABLE job_card_services ADD parent_job_card_service_id INT NULL;
END
  `,
  `
IF NOT EXISTS (
  SELECT 1
  FROM sys.foreign_keys
  WHERE name = 'FK_job_card_services_parent_job_card_service'
)
BEGIN
  ALTER TABLE job_card_services
    ADD CONSTRAINT FK_job_card_services_parent_job_card_service
    FOREIGN KEY (parent_job_card_service_id)
    REFERENCES job_card_services(id);
END
  `,
  `
IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_job_card_approvals_approval_code_unique'
    AND object_id = OBJECT_ID('job_card_approvals')
)
BEGIN
  CREATE UNIQUE INDEX IX_job_card_approvals_approval_code_unique
    ON job_card_approvals(approval_code)
    WHERE approval_code IS NOT NULL;
END
  `,
  `
IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_job_card_services_parent_job_card_service_id'
    AND object_id = OBJECT_ID('job_card_services')
)
BEGIN
  CREATE INDEX IX_job_card_services_parent_job_card_service_id
    ON job_card_services(parent_job_card_service_id);
END
  `
];
let additionalWorkSchemaPromise = null;

const createHttpError = (statusCode, message, data = {}) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.data = data;
  return error;
};

const ensureAdditionalWorkSchema = async () => {
  if (!additionalWorkSchemaPromise) {
    additionalWorkSchemaPromise = (async () => {
      for (const statement of ADDITIONAL_WORK_SCHEMA_STATEMENTS) {
        await prisma.$executeRawUnsafe(statement);
      }
    })().catch((error) => {
      additionalWorkSchemaPromise = null;
      throw error;
    });
  }

  return additionalWorkSchemaPromise;
};

const normalizeText = (value) => String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-');

const buildJobCardIdentifierWhere = (identifier) => {
  const normalizedIdentifier = String(identifier || '').trim();

  if (!normalizedIdentifier) {
    throw createHttpError(400, 'jobCardId is required');
  }

  const parsedId = Number(normalizedIdentifier);
  const isNumericId = Number.isInteger(parsedId) && parsedId > 0;

  if (isNumericId) {
    return { id: parsedId };
  }

  return {
    OR: [
      { slug: normalizedIdentifier },
      { jobCardNo: normalizedIdentifier }
    ]
  };
};

const normalizeRoleSlug = (roleSlug) => {
  const normalized = String(roleSlug || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  return ROLE_ALIASES[normalized] || normalized;
};

const normalizeDepartment = (value) => {
  const normalizedValue = normalizeText(value);

  return DEPARTMENT_ORDER.find((department) => {
    return DEPARTMENT_ALIASES[department].some((alias) => normalizeText(alias) === normalizedValue);
  });
};

const getAllowedDepartments = (user) => {
  if (!user) return [];

  const allowed = new Set();
  let isPrivileged = false;

  if (Array.isArray(user.modules)) {
    for (const mod of user.modules) {
      if (PRIVILEGED_MODULES.has(mod)) isPrivileged = true;
      if (MODULE_DEPARTMENTS[mod]) allowed.add(MODULE_DEPARTMENTS[mod]);
    }
  }

  const roleSlug = normalizeRoleSlug(user.roleSlug);
  if (PRIVILEGED_ROLES.has(roleSlug)) {
    isPrivileged = true;
  }

  const deptFromRole = ROLE_DEPARTMENTS[roleSlug];
  if (deptFromRole) {
    allowed.add(deptFromRole);
  }

  if (isPrivileged) return ['all'];
  return Array.from(allowed);
};

const getDepartmentForUser = (user, requestedDepartment) => {
  const allowed = getAllowedDepartments(user);

  if (allowed.includes('all')) {
    const department = normalizeDepartment(requestedDepartment);
    if (department) {
      return department;
    }
  } else if (allowed.length > 0) {
    const reqDept = normalizeDepartment(requestedDepartment);
    if (reqDept) {
      if (allowed.includes(reqDept)) return reqDept;
    } else {
      if (allowed.length === 1) return allowed[0];
    }
  }

  throw createHttpError(400, 'Valid additional work department is required');
};

const getServiceDepartment = (service) => {
  const category = service && service.serviceItem && service.serviceItem.category;
  return normalizeDepartment(category && (category.slug || category.name));
};

const toStatusResource = (status) => status
  ? {
    id: status.id,
    code: status.statusCode,
    name: status.statusName
  }
  : null;

const toServiceResource = (service) => ({
  id: service.id,
  jobCardServiceId: service.id,
  serviceItemId: service.serviceItemId,
  parentJobCardServiceId: service.parentJobCardServiceId || null,
  name: service.serviceName,
  serviceName: service.serviceName,
  category: service.serviceItem && service.serviceItem.category ? service.serviceItem.category.name : null,
  categorySlug: service.serviceItem && service.serviceItem.category ? service.serviceItem.category.slug : null,
  price: Number(service.price),
  quantity: service.quantity,
  isAdditional: service.isAdditional,
  approvalStatus: toStatusResource(service.approvalStatus),
  serviceStatus: toStatusResource(service.serviceStatus)
});

const toServiceItemResource = (serviceItem) => ({
  id: serviceItem.id,
  serviceItemId: serviceItem.id,
  name: serviceItem.name,
  serviceName: serviceItem.name,
  category: serviceItem.category ? serviceItem.category.name : null,
  categorySlug: serviceItem.category ? serviceItem.category.slug : null,
  price: Number(serviceItem.defaultPrice),
  defaultPrice: Number(serviceItem.defaultPrice),
  estimatedMinutes: serviceItem.estimatedMinutes
});

const toApprovalResource = (approval) => approval
  ? {
    id: approval.id,
    jobCardId: approval.jobCardId,
    approvalCode: approval.approvalCode,
    approvalType: approval.approvalType,
    totalAmount: Number(approval.totalAmount),
    whatsappMessageId: approval.whatsappMessageId,
    customerResponse: approval.customerResponse,
    mechanicExplanation: approval.mechanicExplanation || null,
    sentAt: approval.sentAt,
    respondedAt: approval.respondedAt,
    status: toStatusResource(approval.status),
    services: (approval.services || []).map(toServiceResource)
  }
  : null;

const toAdditionalWorkListResource = (approval) => {
  const services = (approval.services || []).map((service) => ({
    ...toServiceResource(service),
    parentService: service.parentService ? toServiceResource(service.parentService) : null
  }));
  const linkedServiceNames = [...new Set(
    services
      .map((service) => service.parentService && service.parentService.serviceName)
      .filter(Boolean)
  )];
  const status = toStatusResource(approval.status);

  return {
    id: approval.id,
    approvalId: approval.id,
    approvalCode: approval.approvalCode,
    approvalType: approval.approvalType,
    jobCardId: approval.jobCardId,
    jobCardNo: approval.jobCard ? approval.jobCard.jobCardNo : null,
    vehicleNumber: approval.jobCard && approval.jobCard.vehicle ? approval.jobCard.vehicle.registrationNo : null,
    customerName: approval.jobCard && approval.jobCard.customer ? approval.jobCard.customer.fullName : null,
    customerMobile: approval.jobCard && approval.jobCard.customer ? approval.jobCard.customer.mobileNo : null,
    makeModel: approval.jobCard && approval.jobCard.vehicle
      ? [approval.jobCard.vehicle.brand && approval.jobCard.vehicle.brand.name, approval.jobCard.vehicle.model].filter(Boolean).join(' ')
      : null,
    locationId: approval.jobCard ? approval.jobCard.locationId : null,
    mechanicExplanation: approval.mechanicExplanation || null,
    description: approval.mechanicExplanation || services.map((service) => service.serviceName).join(', '),
    linkedServiceNames,
    linkedServiceLabel: linkedServiceNames.length ? linkedServiceNames.join(', ') : null,
    totalAmount: Number(approval.totalAmount),
    requestedAt: approval.sentAt || approval.createdAt,
    respondedAt: approval.respondedAt,
    customerResponse: approval.customerResponse,
    status,
    statusCode: status ? status.code : null,
    statusName: status ? status.name : null,
    services
  };
};

const resolveRequiredStatus = async (tx, moduleCode, statusCodes, label) => {
  const status = await resolveStatusFromCodes(tx, moduleCode, statusCodes);

  if (!status) {
    throw createHttpError(500, `${label} status is not configured`);
  }

  return status;
};

const resolveRequiredStatusId = async (tx, moduleCode, statusCodes, label) => {
  const statusId = await resolveStatusIdFromCodes(tx, moduleCode, statusCodes);

  if (!statusId) {
    throw createHttpError(500, `${label} status is not configured`);
  }

  return statusId;
};

const parsePositiveInt = (value, label) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw createHttpError(400, `${label} must be a positive integer`);
  }

  return parsed;
};

const parseOptionalDate = (value, label) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw createHttpError(400, `${label} must be a valid date time`);
  }

  return date;
};

const parsePositiveIntWithFallback = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeStatusFilter = (value) => {
  const normalized = String(value || '').trim().toUpperCase().replace(/[-\s]+/g, '_');
  if (!normalized || normalized === 'ALL') {
    return null;
  }

  if (normalized === 'PENDING_APPROVAL') {
    return 'PENDING';
  }

  return normalized;
};

const normalizeServiceSelections = (serviceItems) => {
  if (!Array.isArray(serviceItems) || serviceItems.length === 0) {
    throw createHttpError(400, 'At least one additional service item is required');
  }

  const seen = new Set();
  return serviceItems.map((item) => {
    const serviceItemId = parsePositiveInt(
      typeof item === 'object' ? (item.serviceItemId || item.id) : item,
      'serviceItemId'
    );
    const quantity = Math.max(1, Number(typeof item === 'object' && item.quantity !== undefined ? item.quantity : 1) || 1);

    if (seen.has(serviceItemId)) {
      throw createHttpError(400, 'Duplicate additional service items are not allowed');
    }
    seen.add(serviceItemId);

    return { serviceItemId, quantity };
  });
};

const getJobCardForAdditionalWork = (tx, jobCardIdentifier, user) => {
  return tx.jobCard.findFirst({
    where: {
      ...buildJobCardIdentifierWhere(jobCardIdentifier),
      ...(user && user.locationId ? { locationId: Number(user.locationId) } : {})
    },
    include: {
      customer: true,
      vehicle: {
        include: {
          brand: true
        }
      },
      currentStatus: true,
      approvalStatus: true,
      workAssignments: {
        where: { completedAt: null },
        include: {
          assignedUser: {
            select: { id: true, fullName: true, employeeCode: true, mobileNo: true }
          },
          jobCardService: {
            include: {
              serviceItem: {
                include: {
                  category: true
                }
              }
            }
          },
          status: true
        }
      },
      services: {
        include: {
          serviceItem: {
            include: {
              category: true
            }
          },
          approvalStatus: true,
          serviceStatus: true
        },
        orderBy: { id: 'asc' }
      }
    }
  });
};

const getLatestPendingAdditionalApproval = (tx, jobCardId) => {
  return tx.jobCardApproval.findFirst({
    where: {
      jobCardId,
      approvalType: APPROVAL_TYPE_ADDITIONAL_WORK,
      status: {
        is: {
          statusCode: 'PENDING',
          module: {
            is: {
              moduleCode: STATUS_MODULE_CODES.APPROVAL_STATUS
            }
          }
        }
      }
    },
    include: {
      status: true,
      services: {
        include: {
          serviceItem: {
            include: {
              category: true
            }
          },
          approvalStatus: true,
          serviceStatus: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
};

const listRequests = async (query, user) => {
  await ensureAdditionalWorkSchema();

  const department = getDepartmentForUser(user, query.department || query.category);
  const page = parsePositiveIntWithFallback(query.page, 1);
  const limit = parsePositiveIntWithFallback(query.limit, 20);
  const search = String(query.search || '').trim();
  const statusCode = normalizeStatusFilter(query.status);
  const departmentCategoryFilter = {
    OR: DEPARTMENT_ALIASES[department].map((alias) => ({
      slug: normalizeText(alias)
    }))
  };

  const where = {
    approvalType: APPROVAL_TYPE_ADDITIONAL_WORK,
    ...(statusCode
      ? {
        status: {
          is: {
            statusCode
          }
        }
      }
      : {}),
    ...(user && user.locationId
      ? {
        jobCard: {
          is: {
            locationId: Number(user.locationId)
          }
        }
      }
      : {}),
    services: {
      some: {
        isAdditional: true,
        serviceItem: {
          category: departmentCategoryFilter
        }
      }
    },
    ...(search
      ? {
        OR: [
          { approvalCode: { contains: search } },
          { mechanicExplanation: { contains: search } },
          {
            jobCard: {
              is: {
                OR: [
                  { jobCardNo: { contains: search } },
                  { vehicle: { is: { registrationNo: { contains: search } } } },
                  { customer: { is: { fullName: { contains: search } } } }
                ]
              }
            }
          }
        ]
      }
      : {})
  };

  const [requests, total] = await prisma.$transaction([
    prisma.jobCardApproval.findMany({
      where,
      include: {
        status: true,
        jobCard: {
          include: {
            customer: true,
            vehicle: {
              include: {
                brand: true
              }
            }
          }
        },
        services: {
          where: {
            isAdditional: true,
            serviceItem: {
              category: departmentCategoryFilter
            }
          },
          include: {
            serviceItem: {
              include: {
                category: true
              }
            },
            parentService: {
              include: {
                serviceItem: {
                  include: {
                    category: true
                  }
                },
                approvalStatus: true,
                serviceStatus: true
              }
            },
            approvalStatus: true,
            serviceStatus: true
          },
          orderBy: { id: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.jobCardApproval.count({ where })
  ]);

  return {
    department,
    requests: requests.map(toAdditionalWorkListResource),
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
};

const buildJobCardResource = (jobCard) => ({
  id: jobCard.id,
  jobCardNo: jobCard.jobCardNo,
  vehicleNumber: jobCard.vehicle ? jobCard.vehicle.registrationNo : null,
  ownerName: jobCard.customer ? jobCard.customer.fullName : null,
  ownerMobile: jobCard.customer ? jobCard.customer.mobileNo : null,
  makeModel: jobCard.vehicle ? [jobCard.vehicle.brand && jobCard.vehicle.brand.name, jobCard.vehicle.model].filter(Boolean).join(' ') : null,
  status: jobCard.currentStatus ? jobCard.currentStatus.statusCode : null,
  approvalStatus: jobCard.approvalStatus ? jobCard.approvalStatus.statusCode : null,
  createdAt: jobCard.createdAt,
  expectedDeliveryAt: jobCard.expectedDeliveryAt,
  serviceSubtotal: jobCard.serviceSubtotal === null || jobCard.serviceSubtotal === undefined ? null : Number(jobCard.serviceSubtotal),
  taxRate: jobCard.taxRate === null || jobCard.taxRate === undefined ? null : Number(jobCard.taxRate),
  taxAmount: jobCard.taxAmount === null || jobCard.taxAmount === undefined ? null : Number(jobCard.taxAmount),
  discountAmount: jobCard.discountAmount === null || jobCard.discountAmount === undefined ? null : Number(jobCard.discountAmount),
  finalAmount: jobCard.finalAmount === null || jobCard.finalAmount === undefined ? null : Number(jobCard.finalAmount),
  technician: (jobCard.workAssignments || [])
    .map((assignment) => assignment.assignedUser && assignment.assignedUser.fullName)
    .filter(Boolean)
    .join(', ') || null
});

const listAvailableServiceItems = (tx, department) => {
  return tx.serviceItem.findMany({
    where: {
      isActive: true,
      category: {
        isActive: true,
        OR: DEPARTMENT_ALIASES[department].map((alias) => ({
          slug: normalizeText(alias)
        }))
      }
    },
    include: {
      category: true
    },
    orderBy: { name: 'asc' }
  });
};

const getContext = async (jobCardIdentifier, query, user) => {
  await ensureAdditionalWorkSchema();

  const department = getDepartmentForUser(user, query.department || query.category);

  const [jobCard, serviceItems, pendingApproval] = await prisma.$transaction(async (tx) => {
    const [foundJobCard, availableItems] = await Promise.all([
      getJobCardForAdditionalWork(tx, jobCardIdentifier, user),
      listAvailableServiceItems(tx, department)
    ]);

    const latestPendingApproval = foundJobCard
      ? await getLatestPendingAdditionalApproval(tx, foundJobCard.id)
      : null;

    return [foundJobCard, availableItems, latestPendingApproval];
  });

  if (!jobCard) {
    throw createHttpError(404, 'Job card not found');
  }

  return {
    department,
    jobCard: buildJobCardResource(jobCard),
    currentServices: jobCard.services.map(toServiceResource),
    eligibleParentServices: jobCard.services
      .filter((service) => getServiceDepartment(service) === department && !service.isAdditional)
      .map(toServiceResource),
    availableServices: serviceItems.map(toServiceItemResource),
    pendingApproval: toApprovalResource(pendingApproval)
  };
};

const generateApprovalCode = async (tx) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = `AW${crypto.randomInt(100000, 999999)}`;
    const existing = await tx.jobCardApproval.findFirst({
      where: { approvalCode: code },
      select: { id: true }
    });

    if (!existing) {
      return code;
    }
  }

  throw createHttpError(500, 'Could not generate approval code');
};

const createRequest = async (jobCardIdentifier, payload, user) => {
  await ensureAdditionalWorkSchema();

  const explanation = String(payload.mechanicExplanation || payload.explanation || payload.notes || '').trim();
  if (explanation.length < 5) {
    throw createHttpError(400, 'Mechanic explanation is required');
  }

  const department = getDepartmentForUser(user, payload.department || payload.category);
  const parentJobCardServiceId = parsePositiveInt(payload.parentJobCardServiceId, 'parentJobCardServiceId');
  const selections = normalizeServiceSelections(payload.serviceItems || payload.services);
  const expectedDeliveryAt = parseOptionalDate(payload.expectedDeliveryAt, 'expectedDeliveryAt');

  const result = await prisma.$transaction(async (tx) => {
    const jobCard = await getJobCardForAdditionalWork(tx, jobCardIdentifier, user);
    if (!jobCard) {
      throw createHttpError(404, 'Job card not found');
    }

    const parentService = jobCard.services.find((service) => service.id === parentJobCardServiceId);
    if (!parentService) {
      throw createHttpError(400, 'Parent job card service is invalid');
    }

    if (getServiceDepartment(parentService) !== department) {
      throw createHttpError(400, 'Parent service does not belong to this department');
    }

    const serviceItems = await tx.serviceItem.findMany({
      where: {
        id: {
          in: selections.map((selection) => selection.serviceItemId)
        },
        isActive: true,
        category: {
          isActive: true
        }
      },
      include: {
        category: true
      }
    });
    const serviceItemMap = new Map(serviceItems.map((item) => [item.id, item]));

    if (serviceItems.length !== selections.length) {
      throw createHttpError(400, 'One or more selected service items are invalid or inactive');
    }

    for (const serviceItem of serviceItems) {
      if (normalizeDepartment(serviceItem.category && (serviceItem.category.slug || serviceItem.category.name)) !== department) {
        throw createHttpError(400, 'One or more selected service items are outside this department');
      }
    }

    const pendingApprovalStatus = await resolveRequiredStatus(tx, STATUS_MODULE_CODES.APPROVAL_STATUS, ['PENDING'], 'Pending approval');
    const pendingServiceStatusId = await resolveRequiredStatusId(tx, STATUS_MODULE_CODES.JOB_CARD_SERVICE, ['PENDING'], 'Pending job card service');
    const approvalCode = await generateApprovalCode(tx);
    const totalAmount = selections.reduce((sum, selection) => {
      const serviceItem = serviceItemMap.get(selection.serviceItemId);
      return sum + (Number(serviceItem.defaultPrice) * selection.quantity);
    }, 0);

    const approval = await tx.jobCardApproval.create({
      data: {
        jobCardId: jobCard.id,
        statusId: pendingApprovalStatus.id,
        approvalCode,
        approvalType: APPROVAL_TYPE_ADDITIONAL_WORK,
        totalAmount,
        customerResponse: null,
        sentAt: new Date(),
        respondedAt: null,
        createdById: user && user.userId ? user.userId : null
      }
    });

    await tx.$executeRaw`
      UPDATE job_card_approvals
      SET mechanic_explanation = ${explanation}
      WHERE id = ${approval.id}
    `;

    const activeAssignment = jobCard.workAssignments.find(
      (wa) => getServiceDepartment(wa.jobCardService) === department
    );

    const createdServices = [];
    for (const selection of selections) {
      const serviceItem = serviceItemMap.get(selection.serviceItemId);
      const createdService = await tx.jobCardService.create({
        data: {
          jobCardId: jobCard.id,
          approvalId: approval.id,
          parentJobCardServiceId,
          serviceItemId: serviceItem.id,
          approvalStatusId: pendingApprovalStatus.id,
          serviceStatusId: pendingServiceStatusId,
          serviceName: serviceItem.name,
          price: Number(serviceItem.defaultPrice),
          quantity: selection.quantity,
          isAdditional: true,
          createdById: user && user.userId ? user.userId : null
        },
        include: {
          serviceItem: {
            include: {
              category: true
            }
          },
          approvalStatus: true,
          serviceStatus: true
        }
      });
      createdServices.push(createdService);
    }

    if (expectedDeliveryAt) {
      await tx.jobCard.update({
        where: { id: jobCard.id },
        data: {
          expectedDeliveryAt,
          modifiedById: user && user.userId ? user.userId : null
        }
      });
    }

    const updatedApproval = await tx.jobCardApproval.findUnique({
      where: { id: approval.id },
      include: {
        status: true,
        services: {
          include: {
            serviceItem: {
              include: {
                category: true
              }
            },
            approvalStatus: true,
            serviceStatus: true
          }
        }
      }
    });

    return {
      jobCard,
      approval: updatedApproval,
      services: createdServices,
      explanation
    };
  }, { timeout: 30000 });

  try {
    const jobCardForMsg = {
      ...result.jobCard,
      customer: {
        ...(result.jobCard.customer || {}),
        mobileNo: '8825971339'
      }
    };

    await sendAdditionalWorkApproval({
      jobCard: jobCardForMsg,
      approval: result.approval,
      services: result.services,
      explanation: result.explanation
    });
  } catch (error) {
    console.error('Failed to send Twilio WhatsApp message:', error);
  }

  return {
    approval: toApprovalResource(result.approval),
    services: result.services.map(toServiceResource)
  };
};

const parseApprovalReply = (reqOrBody) => {
  const bodyObj = typeof reqOrBody === 'object' && reqOrBody !== null ? (reqOrBody.body || reqOrBody) : {};
  const textFields = [
    bodyObj.Body,
    bodyObj.ButtonText,
    bodyObj.ButtonPayload,
    bodyObj.Text,
    bodyObj.ListResponse,
    bodyObj.Title,
    bodyObj.Payload,
    typeof reqOrBody === 'string' ? reqOrBody : ''
  ];
  const rawText = textFields.filter(Boolean).join(' ').trim().toUpperCase();

  const isApproved = /\b(YES|Y|OK|1|CONFIRM|PROCEED|AGREE)\b/i.test(rawText) || /APPROV/i.test(rawText);
  const isRejected = /\b(NO|N|CANCEL|2|STOP|DECLINE|DISAGREE)\b/i.test(rawText) || /REJECT/i.test(rawText);

  if (!isApproved && !isRejected) {
    console.warn('Twilio approval parsing failed. Received payload:', JSON.stringify(bodyObj));
    throw createHttpError(400, 'Could not parse approval response');
  }

  const decision = isApproved ? 'APPROVED' : 'REJECTED';
  const codeMatch = rawText.match(/\b([A-Z]{2}\d{6})\b/i);
  const approvalCode = codeMatch ? codeMatch[1].toUpperCase() : null;

  return {
    decision,
    approvalCode,
    responseText: rawText || decision
  };
};

const handleTwilioWebhook = async (req) => {
  await ensureAdditionalWorkSchema();

  // Ignore Twilio message delivery status callbacks (e.g. sent, delivered, read)
  if (req.body && req.body.MessageStatus && !req.body.Body && !req.body.ButtonPayload && !req.body.ButtonText) {
    return {
      alreadyResponded: false,
      message: 'Status callback ignored'
    };
  }

  // if (!validateTwilioRequest(req)) {
  //   throw createHttpError(403, 'Invalid Twilio signature');
  // }

  const { decision, approvalCode, responseText } = parseApprovalReply(req);

  return prisma.$transaction(async (tx) => {
    let approval = null;

    const includeOptions = {
      jobCard: {
        include: {
          workAssignments: {
            where: { completedAt: null },
            orderBy: { id: 'desc' },
            include: {
              jobCardService: {
                include: {
                  serviceItem: {
                    include: {
                      category: true
                    }
                  }
                }
              }
            }
          }
        }
      },
      status: true,
      services: {
        include: {
          approvalStatus: true,
          serviceStatus: true,
          serviceItem: {
            include: {
              category: true
            }
          }
        }
      }
    };

    if (approvalCode) {
      approval = await tx.jobCardApproval.findFirst({
        where: {
          approvalCode: approvalCode.toUpperCase(),
          approvalType: APPROVAL_TYPE_ADDITIONAL_WORK
        },
        include: includeOptions
      });
    } else {
      const fromNumber = String(req.body?.From || '').replace(/\D/g, '');
      const mobileDigits = fromNumber.length >= 10 ? fromNumber.slice(-10) : null;

      if (mobileDigits) {
        approval = await tx.jobCardApproval.findFirst({
          where: {
            approvalType: APPROVAL_TYPE_ADDITIONAL_WORK,
            status: {
              is: {
                statusCode: 'PENDING'
              }
            },
            jobCard: {
              is: {
                customer: {
                  is: {
                    OR: [
                      { mobileNo: { contains: mobileDigits } },
                      { alternateMobileNo: { contains: mobileDigits } }
                    ]
                  }
                }
              }
            }
          },
          orderBy: { createdAt: 'desc' },
          include: includeOptions
        });
      }

      if (!approval) {
        approval = await tx.jobCardApproval.findFirst({
          where: {
            approvalType: APPROVAL_TYPE_ADDITIONAL_WORK,
            status: {
              is: {
                statusCode: 'PENDING'
              }
            }
          },
          orderBy: { createdAt: 'desc' },
          include: includeOptions
        });
      }
    }

    if (!approval) {
      throw createHttpError(404, 'Approval request not found');
    }

    if (approval.respondedAt) {
      return {
        approval: toApprovalResource(approval),
        alreadyResponded: true
      };
    }

    const approvalStatus = await resolveRequiredStatus(tx, STATUS_MODULE_CODES.APPROVAL_STATUS, [decision], `${decision.toLowerCase()} approval`);
    const serviceStatusId = decision === 'REJECTED'
      ? await resolveRequiredStatusId(tx, STATUS_MODULE_CODES.JOB_CARD_SERVICE, ['REJECTED'], 'Rejected job card service')
      : null;
    const now = new Date();

    await tx.jobCardApproval.update({
      where: { id: approval.id },
      data: {
        statusId: approvalStatus.id,
        customerResponse: responseText || String(req.body?.Body || '').trim(),
        respondedAt: now,
        modifiedById: null
      }
    });

    const department = approval.services.length > 0 ? getServiceDepartment(approval.services[0]) : null;
    const activeAssignment = department ? approval.jobCard.workAssignments.find(
      (wa) => getServiceDepartment(wa.jobCardService) === department
    ) : null;

    const actualServiceStatusId = serviceStatusId || (
      (decision === 'APPROVED' && activeAssignment)
        ? activeAssignment.jobCardService.serviceStatusId
        : undefined
    );

    await tx.jobCardService.updateMany({
      where: {
        approvalId: approval.id
      },
      data: {
        approvalStatusId: approvalStatus.id,
        ...(actualServiceStatusId ? { serviceStatusId: actualServiceStatusId } : {}),
        modifiedById: null
      }
    });

    if (decision === 'APPROVED' && activeAssignment) {
      for (const service of approval.services) {
        await tx.workAssignment.create({
          data: {
            locationId: approval.jobCard.locationId,
            jobCardId: approval.jobCard.id,
            jobCardServiceId: service.id,
            statusId: activeAssignment.statusId,
            assignedUserId: activeAssignment.assignedUserId,
            bayId: activeAssignment.bayId,
            assignedById: null,
            createdById: null,
            assignedAt: new Date(),
            ...(activeAssignment.startedAt ? { startedAt: new Date() } : {})
          }
        });
      }
    }

    const activeServices = await tx.jobCardService.findMany({
      where: {
        jobCardId: approval.jobCardId,
        approvalStatus: {
          statusCode: { not: 'REJECTED' }
        }
      },
      select: { price: true, quantity: true }
    });

    const serviceSubtotal = activeServices.reduce((sum, s) => sum + (Number(s.price) * s.quantity), 0);
    const taxRate = Number(approval.jobCard.taxRate || 0);
    const discountAmount = Number(approval.jobCard.discountAmount || 0);
    const taxableAmount = Math.max(0, serviceSubtotal - discountAmount);
    const taxAmount = (taxableAmount * taxRate) / 100;
    const finalAmount = taxableAmount + taxAmount;

    await tx.jobCard.update({
      where: { id: approval.jobCardId },
      data: {
        approvalStatusId: approvalStatus.id,
        serviceSubtotal,
        taxAmount,
        finalAmount
      }
    });

    const updatedApproval = await tx.jobCardApproval.findUnique({
      where: { id: approval.id },
      include: {
        status: true,
        services: {
          include: {
            serviceItem: {
              include: {
                category: true
              }
            },
            approvalStatus: true,
            serviceStatus: true
          }
        }
      }
    });

    return {
      approval: toApprovalResource(updatedApproval),
      alreadyResponded: false
    };
  }, { maxWait: 20000, timeout: 50000 });
};

module.exports = {
  getContext,
  createRequest,
  listRequests,
  handleTwilioWebhook
};
