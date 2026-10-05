const fs = require('fs/promises');
const prisma = require('../../config/db');
const env = require('../../config/env');
const { createAuditLog, ensureAuditModule } = require('../../common/utils/audit.util');
const { CODE_CONFIG, generateUniqueCode } = require('../../common/utils/code.util');
const { generateSlug, generateUniqueSlug } = require('../../common/utils/slug.util');
const { normalizeVehicleNumber } = require('../../utils/normalizeVehicleNumber');
const { createStorageProvider } = require('../../providers/storage/storage.provider');
const storageProvider = createStorageProvider();
const { STATUS_MODULE_CODES, resolveStatusFromCodes, resolveStatusIdFromCodes, statusModuleFilter } = require('../../common/utils/status.util');
const { completeStage } = require('../processStageTracking/processStageTracking.service');
const { startNextAssignmentPendingStage, syncAssignmentPendingStages } = require('../processStageTracking/departmentAssignmentStage.service');
const jobCardService = require('../jobCards/jobCard.service');

const JOB_CARD_CREATED_STATUS_CODES = ['JOB_CARD_CREATED', 'CREATED'];
const JOB_CARD_APPROVED_STATUS_CODES = ['APPROVED'];
const JOB_CARD_REJECTED_STATUS_CODES = ['REJECTED'];
const JOB_CARD_SERVICE_PENDING_STATUS_CODES = ['PENDING'];
const JOB_CARD_SERVICE_REJECTED_STATUS_CODES = ['REJECTED'];
const APPROVAL_APPROVED_STATUS_CODES = ['APPROVED'];
const APPROVAL_REJECTED_STATUS_CODES = ['REJECTED'];
const INITIAL_APPROVAL_TYPE = 'INITIAL_ESTIMATE';

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

const toTrimmedString = (value) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toOptionalNumber = (value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const isDateOnlyString = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());

const parseDateQuery = (value, fieldName, endOfDay = false) => {
  const trimmed = toTrimmedString(value);

  if (!trimmed) {
    return undefined;
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    throw createHttpError(400, `${fieldName} must be a valid date`);
  }

  if (endOfDay && isDateOnlyString(trimmed)) {
    date.setUTCHours(23, 59, 59, 999);
  }

  return date;
};

const normalizeRoleSlug = (slug) => String(slug || '').trim().toLowerCase().replace(/-/g, '_');

const hasModule = (user, module) => {
  return Boolean(user && Array.isArray(user.modules) && user.modules.includes(module));
};

const hasAnyModule = (user, modules) => {
  return modules.some((module) => hasModule(user, module));
};

const isLocationScopedViewer = (user) => {
  return hasAnyModule(user, ['crm-team', 'manager', 'managing-director'])
    || ['crm_team', 'crm', 'crm_user', 'crm_executive', 'crm_staff', 'manager', 'managing_director']
      .includes(normalizeRoleSlug(user && user.roleSlug));
};

const isCrmViewer = (user) => {
  return hasModule(user, 'crm-team')
    || ['crm_team', 'crm', 'crm_user', 'crm_executive', 'crm_staff'].includes(normalizeRoleSlug(user && user.roleSlug));
};

const resolveLocationFilter = (query, user) => {
  if (isLocationScopedViewer(user)) {
    if (!user.locationId) {
      throw createHttpError(400, 'Location is required for this role');
    }

    return Number(user.locationId);
  }

  if (user && user.locationId) {
    return Number(user.locationId);
  }

  return parsePositiveInt(query.locationId, undefined);
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

const generateJobCardNo = async (tx) => {
  const latestJobCard = await tx.jobCard.findFirst({
    where: {
      jobCardNo: {
        startsWith: CODE_CONFIG.jobCard.prefix
      }
    },
    orderBy: { id: 'desc' },
    select: { jobCardNo: true }
  });

  return generateUniqueCode({
    prefix: CODE_CONFIG.jobCard.prefix,
    latestCode: latestJobCard ? latestJobCard.jobCardNo : null,
    existsCallback: async (jobCardNo) => {
      const existingJobCard = await tx.jobCard.findFirst({
        where: { jobCardNo },
        select: { id: true }
      });

      return !!existingJobCard;
    }
  });
};

const getVehicleBrandIdFromPayload = (vehicleInfo = {}) => {
  const rawBrandId = vehicleInfo.brandId
    ?? vehicleInfo.brand_id
    ?? vehicleInfo.vehicleBrandId
    ?? vehicleInfo.vehicle_brand_id
    ?? (vehicleInfo.make !== undefined && vehicleInfo.make !== null && /^\d+$/.test(String(vehicleInfo.make).trim()) ? vehicleInfo.make : undefined)
    ?? (vehicleInfo.brandName !== undefined && vehicleInfo.brandName !== null && /^\d+$/.test(String(vehicleInfo.brandName).trim()) ? vehicleInfo.brandName : undefined);

  if (rawBrandId === undefined || rawBrandId === null || rawBrandId === '') {
    return undefined;
  }

  const brandId = Number(rawBrandId);
  if (!Number.isInteger(brandId) || brandId <= 0) {
    throw createHttpError(400, 'vehicleInfo.brandId must be a positive integer');
  }

  return brandId;
};

const resolveVehicleBrandId = async (tx, vehicleInfo = {}, actorUserId) => {
  const requestedBrandId = getVehicleBrandIdFromPayload(vehicleInfo);

  if (requestedBrandId !== undefined) {
    const existingBrand = await tx.vehicleBrand.findFirst({
      where: {
        id: requestedBrandId,
        isActive: true
      },
      select: { id: true }
    });

    if (!existingBrand) {
      throw createHttpError(400, 'Selected vehicle brand is invalid or inactive');
    }

    return existingBrand.id;
  }

  const brandName = toTrimmedString(vehicleInfo.make || vehicleInfo.brandName);

  if (!brandName) {
    return undefined;
  }

  const slug = generateSlug(brandName);
  if (!slug) {
    return undefined;
  }

  const existingBrand = await tx.vehicleBrand.findFirst({
    where: { slug },
    select: { id: true }
  });

  if (existingBrand) {
    return existingBrand.id;
  }

  const brand = await tx.vehicleBrand.create({
    data: {
      name: brandName,
      slug,
      createdById: actorUserId || null
    },
    select: { id: true }
  });

  return brand.id;
};

const buildVehicleUpdateData = async (tx, vehicleInfo = {}, actorUserId) => {
  const data = {};
  const registrationNumber = toTrimmedString(vehicleInfo.registrationNumber || vehicleInfo.vehicleNumber);

  if (registrationNumber) {
    data.registrationNo = normalizeVehicleNumber(registrationNumber);
  }

  const model = toTrimmedString(vehicleInfo.model || vehicleInfo.vehicleModel);
  if (model !== undefined) {
    data.model = model;
  }

  const variant = toTrimmedString(vehicleInfo.variant);
  if (variant !== undefined) {
    data.variant = variant;
  }

  const fuelType = toTrimmedString(vehicleInfo.fuelType);
  if (fuelType !== undefined) {
    data.fuelType = fuelType;
  }

  const vehicleColor = toTrimmedString(vehicleInfo.color || vehicleInfo.vehicleColor);
  if (vehicleColor !== undefined) {
    data.vehicleColor = vehicleColor;
  }

  const chassisNo = toTrimmedString(vehicleInfo.chassisNo);
  if (chassisNo !== undefined) {
    data.chassisNo = chassisNo;
  }

  const engineNo = toTrimmedString(vehicleInfo.engineNo);
  if (engineNo !== undefined) {
    data.engineNo = engineNo;
  }

  const brandId = await resolveVehicleBrandId(tx, vehicleInfo, actorUserId);
  if (brandId !== undefined) {
    data.brandId = brandId;
  }

  if (Object.keys(data).length > 0) {
    data.modifiedById = actorUserId || null;
  }

  return data;
};

const buildCustomerUpdateData = (customerInfo = {}, actorUserId) => {
  const data = {};
  const fullName = toTrimmedString(customerInfo.fullName || customerInfo.ownerName || customerInfo.name);
  const mobileNo = toTrimmedString(customerInfo.mobileNo || customerInfo.mobileNumber);
  const alternateMobileNo = toTrimmedString(customerInfo.alternateMobileNo || customerInfo.alternateNumber);
  const emailId = toTrimmedString(customerInfo.emailId || customerInfo.email);
  const addressParts = [
    toTrimmedString(customerInfo.address),
    toTrimmedString(customerInfo.city)
  ].filter(Boolean);

  if (fullName !== undefined) {
    data.fullName = fullName;
  }

  if (mobileNo !== undefined) {
    data.mobileNo = mobileNo;
  }

  if (alternateMobileNo !== undefined) {
    data.alternateMobileNo = alternateMobileNo;
  }

  if (emailId !== undefined) {
    data.emailId = emailId;
  }

  if (addressParts.length > 0) {
    data.address = addressParts.join(', ');
  } else if (customerInfo.address === null || customerInfo.address === '') {
    data.address = null;
  }

  if (Object.keys(data).length > 0) {
    data.modifiedById = actorUserId || null;
  }

  return data;
};

const buildBillingSummary = (billing = {}, serviceSubtotal, defaultTaxRate = 0) => {
  const discountAmount = Math.max(0, toOptionalNumber(billing.discountAmount ?? billing.discount) || 0);

  if (discountAmount > 0 && discountAmount >= serviceSubtotal) {
    throw createHttpError(400, 'Discount amount cannot be equal to or greater than the subtotal');
  }

  const providedTaxRate = toOptionalNumber(billing.taxRate);
  const taxRate = Math.max(0, providedTaxRate !== undefined ? providedTaxRate : defaultTaxRate);
  const taxableAmount = Math.max(0, serviceSubtotal - discountAmount);
  const taxAmount = Math.max(0, toOptionalNumber(billing.taxAmount) ?? ((taxableAmount * taxRate) / 100));
  const finalAmount = Math.max(0, toOptionalNumber(billing.finalAmount) ?? (taxableAmount + taxAmount));
  const discountReason = toTrimmedString(billing.discountReason);

  return {
    serviceSubtotal,
    taxRate,
    taxAmount,
    discountAmount,
    finalAmount,
    discountReason
  };
};

const getBillingField = (payload = {}, fieldName) => {
  if (payload[fieldName] !== undefined) {
    return payload[fieldName];
  }

  return payload.billing && typeof payload.billing === 'object' ? payload.billing[fieldName] : undefined;
};

const getPayloadField = (payload = {}, ...fieldNames) => {
  for (const fieldName of fieldNames) {
    const value = getBillingField(payload, fieldName);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
};

const buildAdditionalNotes = (payload) => toTrimmedString(getPayloadField(payload, 'additionalNotes')) || null;

const normalizeCustomerApproval = (payload = {}) => {
  const rawValue = getPayloadField(payload, 'customer_approval', 'customerApproval');

  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return 'APPROVED';
  }

  const normalized = String(rawValue).trim().toUpperCase();
  if (['YES', 'Y', 'APPROVE', 'APPROVED', 'TRUE'].includes(normalized)) {
    return 'APPROVED';
  }

  if (['NO', 'N', 'REJECT', 'REJECTED', 'FALSE'].includes(normalized)) {
    // Default to APPROVED since the rejection flow has been replaced by signature
    return 'APPROVED';
  }

  return 'APPROVED';
};

const resolveRequiredStatusId = async (tx, moduleCode, statusCodes, label) => {
  const statusId = await resolveStatusIdFromCodes(tx, moduleCode, statusCodes);

  if (!statusId) {
    throw createHttpError(500, `${label} status is not configured`);
  }

  return statusId;
};

const inferPhotoCategory = (file, index, photoCategories = []) => {
  const fieldCategory = Array.isArray(photoCategories) ? photoCategories[index] : null;
  const originalName = String(file.originalname || '').toLowerCase();

  if (fieldCategory) {
    return fieldCategory;
  }

  if (originalName.includes('front')) {
    return 'FRONT_VIEW';
  }

  if (originalName.includes('rear') || originalName.includes('back')) {
    return 'REAR_VIEW';
  }

  if (originalName.includes('left')) {
    return 'LEFT_SIDE';
  }

  if (originalName.includes('right')) {
    return 'RIGHT_SIDE';
  }

  if (originalName.includes('sign') || originalName.includes('signature')) {
    return 'SIGNATURE';
  }

  return 'VEHICLE_PHOTO';
};

const cleanupLocalFiles = async (files) => {
  await Promise.all((files || []).map(async (file) => {
    if (!file.path) {
      return;
    }

    try {
      await fs.unlink(file.path);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn(`Unable to delete temp upload file: ${file.path}`);
      }
    }
  }));
};

const uploadVehiclePhotos = async (files = [], actorUserId, photoCategories = []) => {
  if (!files.length) {
    return [];
  }

  const storageProvider = createStorageProvider();
  const uploadedPhotos = [];

  try {
    for (const [index, file] of files.entries()) {
      const uploadResult = await storageProvider.upload(file.path, {
        folder: 'dvsos/job-cards/vehicle-photos',
        resource_type: 'image',
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size
      });

      uploadedPhotos.push({
        uploadedById: actorUserId || null,
        fileType: 'IMAGE',
        category: String(inferPhotoCategory(file, index, photoCategories)).trim().toUpperCase().replace(/\s+/g, '_').slice(0, 50),
        fileName: file.originalname || null,
        fileUrl: uploadResult.secure_url || uploadResult.url,
        blobName: uploadResult.public_id || null,
        containerName: env.azureBlob.container || 'azure',
        mimeType: file.mimetype || uploadResult.format || null,
        fileSizeKb: uploadResult.bytes ? Math.ceil(uploadResult.bytes / 1024) : Math.ceil((file.size || 0) / 1024),
        createdById: actorUserId || null
      });
    }

    return uploadedPhotos;
  } finally {
    await cleanupLocalFiles(files);
  }
};

const buildMediaRows = ({ uploadedPhotos = [], vehicleId }) => {
  return uploadedPhotos.map((photo) => ({
    moduleRecordId: vehicleId,
    moduleName: 'VEHICLE',
    ...photo
  }));
};

const JOB_CARD_AUDIT_MODULE = {
  moduleCode: 'job-card',
  moduleName: 'Job Card'
};

const resolveJobCardAuditModuleId = async (actorUserId) => {
  if (!actorUserId) {
    return null;
  }

  const auditModule = await ensureAuditModule(prisma, JOB_CARD_AUDIT_MODULE);
  return auditModule.id;
};

const createAudit = async (tx, { tableName, recordId, actionType, actorUserId, recordName, comments, locationId, details = [], moduleId = null }) => {
  if (!actorUserId) {
    return null;
  }

  return createAuditLog(tx, {
    ...JOB_CARD_AUDIT_MODULE,
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

const pendingQueueSelect = {
  id: true,
  gateEntryNo: true,
  entryType: true,
  entryTime: true,
  customer: {
    select: {
      id: true,
      fullName: true,
      mobileNo: true,
      alternateMobileNo: true,
      emailId: true,
      address: true
    }
  },
  vehicle: {
    select: {
      id: true,
      registrationNo: true,
      model: true,
      variant: true,
      fuelType: true,
      vehicleColor: true,
      chassisNo: true,
      engineNo: true,
      brand: {
        select: {
          id: true,
          name: true
        }
      }
    }
  },
  location: {
    select: {
      id: true,
      locationCode: true,
      locationName: true,
      serviceCenter: {
        select: {
          tax: true
        }
      }
    }
  },
  jobCards: {
    select: {
      id: true,
      jobCardNo: true
    },
    take: 1
  }
};

const getElapsedMinutes = (date) => {
  if (!date) {
    return 0;
  }

  return Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60000));
};

const toQueueEntryResponse = (entry) => ({
  id: entry.id,
  gateEntryId: entry.id,
  gateEntryNo: entry.gateEntryNo,
  entryType: String(entry.entryType || '').toLowerCase(),
  entryTime: entry.entryTime,
  waitingMinutes: getElapsedMinutes(entry.entryTime),
  customer: entry.customer
    ? {
      id: entry.customer.id,
      name: entry.customer.fullName,
      mobileNo: entry.customer.mobileNo,
      alternateMobileNo: entry.customer.alternateMobileNo,
      emailId: entry.customer.emailId,
      address: entry.customer.address
    }
    : null,
  vehicle: entry.vehicle
    ? {
      id: entry.vehicle.id,
      registrationNumber: entry.vehicle.registrationNo,
      model: entry.vehicle.model,
      brand: toBrandResponse(entry.vehicle.brand),
      variant: entry.vehicle.variant,
      fuelType: entry.vehicle.fuelType,
      color: entry.vehicle.vehicleColor,
      chassisNo: entry.vehicle.chassisNo,
      engineNo: entry.vehicle.engineNo
    }
    : null,
  location: entry.location
    ? {
      id: entry.location.id,
      locationCode: entry.location.locationCode,
      locationName: entry.location.locationName,
      taxRate: Number(entry.location.serviceCenter?.tax) || 0
    }
    : null,
  canCreateJobCard: !entry.jobCards || entry.jobCards.length === 0
});

const jobCardListSelect = {
  id: true,
  jobCardNo: true,
  gateEntryId: true,
  expectedDeliveryAt: true,
  totalEstimate: true,
  serviceSubtotal: true,
  taxRate: true,
  taxAmount: true,
  discountAmount: true,
  finalAmount: true,
  discountReason: true,
  customerComplaint: true,
  additionalNotes: true,
  createdAt: true,
  updatedAt: true,
  location: {
    select: {
      id: true,
      locationCode: true,
      locationName: true
    }
  },
  gateEntry: {
    select: {
      id: true,
      gateEntryNo: true,
      entryTime: true
    }
  },
  createdBy: {
    select: {
      id: true,
      fullName: true,
      employeeCode: true
    }
  },
  currentStatus: {
    select: {
      id: true,
      statusCode: true,
      statusName: true
    }
  },
  approvalStatus: {
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
      mobileNo: true,
      alternateMobileNo: true,
      emailId: true,
      address: true
    }
  },
  vehicle: {
    select: {
      id: true,
      registrationNo: true,
      model: true,
      variant: true,
      fuelType: true,
      vehicleColor: true,
      chassisNo: true,
      engineNo: true,
      brand: {
        select: {
          id: true,
          name: true
        }
      }
    }
  },
  services: {
    select: {
      id: true,
      serviceItemId: true,
      serviceName: true,
      price: true,
      quantity: true,
      isAdditional: true
    },
    orderBy: {
      id: 'asc'
    }
  },
  _count: {
    select: {
      services: true
    }
  },
  workAssignments: {
    select: {
      id: true,
      assignedUserId: true,
      assignedUser: {
        select: {
          id: true,
          fullName: true,
          employeeCode: true
        }
      },
      status: {
        select: {
          id: true,
          statusName: true,
          statusCode: true
        }
      },
      jobCardService: {
        select: {
          id: true,
          serviceName: true,
          serviceItem: {
            select: {
              category: {
                select: {
                  id: true,
                  name: true
                }
              }
            }
          }
        }
      },
      bayId: true,
      assignedAt: true,
      startedAt: true,
      completedAt: true
    }
  }
};

const toStatusResponse = (status) => {
  if (!status) {
    return null;
  }

  return {
    id: status.id,
    code: status.statusCode,
    name: status.statusName
  };
};

const toBrandResponse = (brand) => brand
  ? {
    id: brand.id,
    name: brand.name
  }
  : null;

const getServiceDepartment = (service) => {
  if (!service) return null;
  let dept = null;
  const category = service.serviceItem ? service.serviceItem.category : (service.category || null);
  if (category) {
    dept = category.slug || category.name;
  } else if (service.categoryName) {
    dept = service.categoryName;
  }
  if (!dept) return null;
  
  const norm = String(dept).toLowerCase();
  if (norm.includes('body')) return 'body-shop';
  return 'mechanical';
};

const computeWorkType = (jobCard) => {
  const services = jobCard.services || [];
  const assignmentServices = (jobCard.workAssignments || []).map((a) => a.jobCardService).filter(Boolean);
  const allServices = [...services, ...assignmentServices];

  let hasMechanical = false;
  let hasBodyShop = false;

  for (const s of allServices) {
    const dept = getServiceDepartment(s);
    if (dept === 'mechanical') hasMechanical = true;
    if (dept === 'body-shop') hasBodyShop = true;
  }

  if (!hasMechanical && !hasBodyShop) {
    const statusCode = String(jobCard.currentStatus?.statusCode || '').toUpperCase();
    if (statusCode.includes('BODY_SHOP')) {
      hasBodyShop = true;
    } else {
      hasMechanical = true;
    }
  }

  if (hasMechanical && hasBodyShop) return 'Both';
  if (hasBodyShop) return 'Body Shop';
  return 'Mechanic';
};

const toJobCardListResponse = (jobCard) => {
  const allAssignments = (jobCard.workAssignments || []).map(toAssignmentSummary);
  const activeAssignments = allAssignments.filter((assignment) => !assignment.completedAt);
  const displayAssignments = allAssignments;
  
  const assignedMechanics = Array.from(
    new Map(
      displayAssignments
        .filter((assignment) => assignment.assignedUser)
        .map((assignment) => [assignment.assignedUser.id, assignment.assignedUser])
    ).values()
  );
  const assignedMechanic = assignedMechanics[0] || null;
  
  const assignedBays = Array.from(
    new Map(
      displayAssignments
        .filter((assignment) => assignment.bay)
        .map((assignment) => [assignment.bay.id, assignment.bay])
    ).values()
  );
  const assignedBay = assignedBays[0] || null;

  return {
    id: jobCard.id,
    jobCardNo: jobCard.jobCardNo,
    gateEntryId: jobCard.gateEntryId,
    gateEntry: jobCard.gateEntry
      ? {
        id: jobCard.gateEntry.id,
        gateEntryNo: jobCard.gateEntry.gateEntryNo,
        entryTime: jobCard.gateEntry.entryTime
      }
      : null,
    location: jobCard.location || null,
    createdBy: jobCard.createdBy
      ? {
        id: jobCard.createdBy.id,
        name: jobCard.createdBy.fullName,
        employeeCode: jobCard.createdBy.employeeCode
      }
      : null,
    expectedDeliveryAt: jobCard.expectedDeliveryAt,
    totalEstimate: Number(jobCard.totalEstimate),
    billing: {
      serviceSubtotal: jobCard.serviceSubtotal === null || jobCard.serviceSubtotal === undefined ? null : Number(jobCard.serviceSubtotal),
      taxRate: jobCard.taxRate === null || jobCard.taxRate === undefined ? null : Number(jobCard.taxRate),
      taxAmount: jobCard.taxAmount === null || jobCard.taxAmount === undefined ? null : Number(jobCard.taxAmount),
      discountAmount: jobCard.discountAmount === null || jobCard.discountAmount === undefined ? null : Number(jobCard.discountAmount),
      finalAmount: jobCard.finalAmount === null || jobCard.finalAmount === undefined ? null : Number(jobCard.finalAmount),
      discountReason: jobCard.discountReason || null
    },
    customerComplaint: jobCard.customerComplaint,
    additionalNotes: jobCard.additionalNotes,
    createdAt: jobCard.createdAt,
    updatedAt: jobCard.updatedAt,
    currentStatus: toStatusResponse(jobCard.currentStatus),
    approvalStatus: toStatusResponse(jobCard.approvalStatus),
    customer: jobCard.customer
      ? {
        id: jobCard.customer.id,
        name: jobCard.customer.fullName,
        mobileNo: jobCard.customer.mobileNo,
        alternateMobileNo: jobCard.customer.alternateMobileNo,
        emailId: jobCard.customer.emailId,
        address: jobCard.customer.address
      }
      : null,
    vehicle: jobCard.vehicle
      ? {
        id: jobCard.vehicle.id,
        registrationNumber: jobCard.vehicle.registrationNo,
        model: jobCard.vehicle.model,
        brand: toBrandResponse(jobCard.vehicle.brand),
        variant: jobCard.vehicle.variant,
        fuelType: jobCard.vehicle.fuelType,
        color: jobCard.vehicle.vehicleColor,
        chassisNo: jobCard.vehicle.chassisNo,
        engineNo: jobCard.vehicle.engineNo
      }
      : null,
    workType: computeWorkType(jobCard),
    workAssignments: activeAssignments,
    activeAssignments,
    assignmentHistory: displayAssignments,
    assignedMechanic,
    assignedMechanics,
    assignedBay,
    assignedBays,
    bay: assignedBay,
    technician: assignedMechanics.length > 0 ? assignedMechanics.map((mechanic) => mechanic.fullName).join(', ') : null,
    technicianId: assignedMechanic ? assignedMechanic.id : null,
    technicianEmployeeCode: assignedMechanic ? assignedMechanic.employeeCode : null,
    serviceCount: jobCard._count ? jobCard._count.services : (jobCard.services || []).length,
    canCreateJobCard: !jobCard.jobCards || jobCard.jobCards.length === 0,
    services: (jobCard.services || []).map((service) => ({
      id: service.id,
      serviceItemId: service.serviceItemId,
      name: service.serviceName,
      price: Number(service.price),
      quantity: service.quantity,
      isAdditional: service.isAdditional
    }))
  };
};

const jobCardDetailSelect = {
  ...jobCardListSelect,
  slug: true,
  statusLogs: {
    select: {
      id: true,
      remarks: true,
      createdAt: true,
      status: {
        select: {
          id: true,
          statusCode: true,
          statusName: true
        }
      },
      changedBy: {
        select: {
          id: true,
          fullName: true,
          employeeCode: true
        }
      }
    },
    orderBy: {
      createdAt: 'desc'
    },
    take: 10
  },
  workAssignments: {
    select: {
      id: true,
      assignedUserId: true,
      assignedUser: {
        select: {
          id: true,
          fullName: true,
          employeeCode: true
        }
      },
      status: {
        select: {
          id: true,
          statusName: true,
          statusCode: true
        }
      },
      jobCardService: {
        select: {
          id: true,
          serviceName: true,
          serviceItem: {
            select: {
              category: {
                select: {
                  id: true,
                  name: true
                }
              }
            }
          }
        }
      },
      bayId: true,
      assignedAt: true,
      startedAt: true,
      completedAt: true
    }
  }
};

const toMoney = (value, fallback = 0) => {
  if (value === null || value === undefined) {
    return fallback;
  }

  return Number(value);
};

const buildJobCardDetailBilling = (jobCard) => {
  const serviceSubtotal = toMoney(jobCard.serviceSubtotal, (jobCard.services || []).reduce((sum, service) => {
    return sum + (Number(service.price) * service.quantity);
  }, 0));
  const taxRate = toMoney(jobCard.taxRate, null);
  const taxAmount = toMoney(jobCard.taxAmount, 0);
  const discountAmount = toMoney(jobCard.discountAmount, 0);
  const finalAmount = toMoney(jobCard.finalAmount, toMoney(jobCard.totalEstimate, serviceSubtotal + taxAmount - discountAmount));

  return {
    serviceSubtotal,
    taxRate,
    taxAmount,
    discountAmount,
    finalAmount,
    grandTotalEstimate: finalAmount,
    discountReason: jobCard.discountReason || null
  };
};

const toMediaResponse = (mediaFile) => {
  let fileUrl = mediaFile.fileUrl;
  if (storageProvider.isConfigured && mediaFile.blobName) {
    try {
      fileUrl = storageProvider.generateSasUrl(mediaFile.blobName, 3600);
    } catch (e) {
      console.error('Error signing URL for media response:', e);
    }
  }
  return {
    id: mediaFile.id,
    moduleName: mediaFile.moduleName,
    moduleRecordId: mediaFile.moduleRecordId,
    category: mediaFile.category,
    fileType: mediaFile.fileType,
    fileName: mediaFile.fileName,
    fileUrl: fileUrl,
    mimeType: mediaFile.mimeType,
    fileSizeKb: mediaFile.fileSizeKb,
    createdAt: mediaFile.createdAt
  };
};

const toAssignmentSummary = (assignment) => ({
  id: assignment.id,
  jobCardId: assignment.jobCardId,
  jobCardServiceId: assignment.jobCardServiceId,
  assignedUserId: assignment.assignedUserId,
  bayId: assignment.bayId || null,
  bay: assignment.bay ? {
    id: assignment.bay.id,
    bayName: assignment.bay.bayName,
    bayCode: assignment.bay.bayCode
  } : null,
  assignedAt: assignment.assignedAt,
  startedAt: assignment.startedAt,
  completedAt: assignment.completedAt,
  status: assignment.status
    ? {
      id: assignment.status.id,
      statusCode: assignment.status.statusCode,
      statusName: assignment.status.statusName
    }
    : null,
  assignedUser: assignment.assignedUser
    ? {
      id: assignment.assignedUser.id,
      fullName: assignment.assignedUser.fullName,
      employeeCode: assignment.assignedUser.employeeCode
    }
    : null,
  service: assignment.jobCardService
    ? {
      id: assignment.jobCardService.id,
      serviceName: assignment.jobCardService.serviceName,
      category: assignment.jobCardService.serviceItem && assignment.jobCardService.serviceItem.category
        ? {
          id: assignment.jobCardService.serviceItem.category.id,
          name: assignment.jobCardService.serviceItem.category.name,
          slug: assignment.jobCardService.serviceItem.category.slug
        }
        : null
    }
    : null
});

const toJobCardDetailResponse = (jobCard, mediaFiles = []) => {
  const allAssignments = (jobCard.workAssignments || []).map(toAssignmentSummary);
  const activeAssignments = allAssignments.filter((assignment) => !assignment.completedAt);
  const displayAssignments = allAssignments;
  const assignedMechanics = Array.from(
    new Map(
      displayAssignments
        .filter((assignment) => assignment.assignedUser)
        .map((assignment) => [assignment.assignedUser.id, assignment.assignedUser])
    ).values()
  );
  const assignedMechanic = assignedMechanics[0] || null;
  const assignedBays = Array.from(
    new Map(
      displayAssignments
        .filter((assignment) => assignment.bay)
        .map((assignment) => [assignment.bay.id, assignment.bay])
    ).values()
  );
  const assignedBay = assignedBays[0] || null;

  const services = (jobCard.services || []).map((service) => {
    const price = Number(service.price);
    const quantity = service.quantity;

    return {
      id: service.id,
      serviceItemId: service.serviceItemId,
      name: service.serviceName,
      description: service.serviceName,
      price,
      quantity,
      total: price * quantity,
      isAdditional: service.isAdditional
    };
  });

  return {
    jobCard: {
      id: jobCard.id,
      jobCardNo: jobCard.jobCardNo,
      slug: jobCard.slug,
      gateEntryId: jobCard.gateEntryId,
      expectedDeliveryAt: jobCard.expectedDeliveryAt,
      customerComplaint: jobCard.customerComplaint,
      additionalNotes: jobCard.additionalNotes,
      createdAt: jobCard.createdAt,
      updatedAt: jobCard.updatedAt,
      currentStatus: toStatusResponse(jobCard.currentStatus),
      approvalStatus: toStatusResponse(jobCard.approvalStatus)
    },
    header: {
      customerName: jobCard.customer ? jobCard.customer.fullName : null,
      mobileNo: jobCard.customer ? jobCard.customer.mobileNo : null,
      emailId: jobCard.customer ? jobCard.customer.emailId : null,
      registrationNumber: jobCard.vehicle ? jobCard.vehicle.registrationNo : null,
      expectedDeliveryAt: jobCard.expectedDeliveryAt
    },
    vehicleSpecifications: jobCard.vehicle
      ? {
        id: jobCard.vehicle.id,
        brand: toBrandResponse(jobCard.vehicle.brand),
        model: jobCard.vehicle.model,
        variant: jobCard.vehicle.variant,
        fuelType: jobCard.vehicle.fuelType,
        color: jobCard.vehicle.vehicleColor,
        chassisNo: jobCard.vehicle.chassisNo,
        engineNo: jobCard.vehicle.engineNo,
        registrationNumber: jobCard.vehicle.registrationNo
      }
      : null,
    customerDetails: jobCard.customer
      ? {
        id: jobCard.customer.id,
        name: jobCard.customer.fullName,
        mobileNo: jobCard.customer.mobileNo,
        alternateMobileNo: jobCard.customer.alternateMobileNo,
        emailId: jobCard.customer.emailId,
        billingAddress: jobCard.customer.address,
        address: jobCard.customer.address
      }
      : null,
    servicesAndMaintenanceTasks: {
      items: services,
      serviceSubtotal: services.reduce((sum, service) => sum + service.total, 0),
      billing: buildJobCardDetailBilling(jobCard)
    },
    customerSignature: mediaFiles.find((m) => m.category === 'SIGNATURE') ? toMediaResponse(mediaFiles.find((m) => m.category === 'SIGNATURE')) : null,
    digitalConditionPhotos: mediaFiles.filter((m) => m.category !== 'SIGNATURE').map(toMediaResponse),
    gateEntry: jobCard.gateEntry
      ? {
        id: jobCard.gateEntry.id,
        gateEntryNo: jobCard.gateEntry.gateEntryNo,
        entryTime: jobCard.gateEntry.entryTime
      }
      : null,
    location: jobCard.location || null,
    createdBy: jobCard.createdBy
      ? {
        id: jobCard.createdBy.id,
        name: jobCard.createdBy.fullName,
        employeeCode: jobCard.createdBy.employeeCode
      }
      : null,
    statusLogs: (jobCard.statusLogs || []).map((log) => ({
      id: log.id,
      status: toStatusResponse(log.status),
      remarks: log.remarks,
      changedBy: log.changedBy
        ? {
          id: log.changedBy.id,
          name: log.changedBy.fullName,
          employeeCode: log.changedBy.employeeCode
        }
        : null,
      createdAt: log.createdAt
    })),
    workAssignments: activeAssignments,
    activeAssignments,
    assignmentHistory: displayAssignments,
    assignedMechanic,
    assignedMechanics,
    assignedBay,
    assignedBays,
    bay: assignedBay,
    technician: assignedMechanics.length > 0 ? assignedMechanics.map((mechanic) => mechanic.fullName).join(', ') : null,
    technicianId: assignedMechanic ? assignedMechanic.id : null,
    technicianEmployeeCode: assignedMechanic ? assignedMechanic.employeeCode : null
  };
};

const resolveCreatedByFilter = (query, user) => {
  if (isCrmViewer(user)) {
    return Number(user.userId);
  }

  return parsePositiveInt(query.createdById, Number(user && user.userId));
};

const buildJobCardListWhere = (query, user) => {
  const where = {};
  const locationId = resolveLocationFilter(query, user);
  const createdById = resolveCreatedByFilter(query, user);

  if (locationId) {
    where.locationId = locationId;
  }

  if (createdById) {
    where.createdById = createdById;
  }

  const customerName = toTrimmedString(query.customerName);
  if (customerName) {
    where.customer = {
      fullName: {
        contains: customerName
      }
    };
  }

  const vehicleNumber = toTrimmedString(query.vehicleNumber || query.registrationNo || query.registrationNumber);
  const normalizedVehicleNumber = vehicleNumber ? normalizeVehicleNumber(vehicleNumber) : null;
  if (normalizedVehicleNumber) {
    where.vehicle = {
      registrationNo: {
        contains: normalizedVehicleNumber
      }
    };
  }

  const fromDate = parseDateQuery(query.fromDate || query.createdFrom || query.createdAtFrom, 'fromDate');
  const toDate = parseDateQuery(query.toDate || query.createdTo || query.createdAtTo, 'toDate', true);
  if (fromDate && toDate && fromDate > toDate) {
    throw createHttpError(400, 'fromDate must be before or equal to toDate');
  }

  if (fromDate || toDate) {
    where.createdAt = {
      ...(fromDate ? { gte: fromDate } : {}),
      ...(toDate ? { lte: toDate } : {})
    };
  }

  const currentStatusCode = toTrimmedString(query.currentStatusCode || query.statusCode);
  if (currentStatusCode) {
    where.currentStatus = {
      is: {
        statusCode: currentStatusCode.toUpperCase(),
        ...statusModuleFilter(STATUS_MODULE_CODES.JOB_CARD_STATUS)
      }
    };
  }

  const approvalStatusCode = toTrimmedString(query.approvalStatusCode);
  if (approvalStatusCode) {
    where.approvalStatus = {
      is: {
        statusCode: approvalStatusCode.toUpperCase(),
        ...statusModuleFilter(STATUS_MODULE_CODES.APPROVAL_STATUS)
      }
    };
  }

  const search = String(query.search || '').trim();
  if (search) {
    const normalizedSearch = normalizeVehicleNumber(search);
    where.OR = [
      {
        jobCardNo: {
          contains: search
        }
      },
      {
        gateEntry: {
          gateEntryNo: {
            contains: search
          }
        }
      },
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
          fullName: {
            contains: search
          }
        }
      },
      {
        customer: {
          mobileNo: {
            contains: search
          }
        }
      }
    ];
  }

  return where;
};

const buildQueueWhere = (query, user) => {
  const where = {
    exitTime: null,
    jobCards: {
      none: {}
    }
  };

  const locationId = resolveLocationFilter(query, user);
  if (locationId) {
    where.locationId = locationId;
  }

  if (query.entryType && String(query.entryType).trim().toLowerCase() !== 'all') {
    where.entryType = String(query.entryType).trim().toUpperCase();
  }

  const search = String(query.search || '').trim();
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
          fullName: {
            contains: search
          }
        }
      },
      {
        customer: {
          mobileNo: {
            contains: search
          }
        }
      }
    ];
  }

  return where;
};

const jobCardList = async (query, user) => {
  const page = parsePositiveInt(query.page, 1);
  const limit = parsePositiveInt(query.limit, 10);
  const where = buildJobCardListWhere(query, user);
  const activeWhere = {
    AND: [
      where,
      {
        OR: [
          {
            currentStatusId: null
          },
          {
            currentStatus: {
              is: {
                statusCode: {
                  notIn: ['DELIVERED', 'REJECTED']
                },
                ...statusModuleFilter(STATUS_MODULE_CODES.JOB_CARD_STATUS)
              }
            }
          }
        ]
      }
    ]
  };

  const [jobCards, total, activeCount] = await prisma.$transaction([
    prisma.jobCard.findMany({
      where,
      select: jobCardListSelect,
      orderBy: {
        createdAt: 'desc'
      },
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.jobCard.count({ where }),
    prisma.jobCard.count({ where: activeWhere })
  ]);

  return {
    jobCards: jobCards.map(toJobCardListResponse),
    summary: {
      total,
      active: activeCount,
      completed: Math.max(0, total - activeCount)
    },
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
};

const pendingQueue = async (query, user) => {
  const page = parsePositiveInt(query.page, 1);
  const limit = parsePositiveInt(query.limit, 10);
  const where = buildQueueWhere(query, user);
  const activeWhere = {
    ...(where.locationId ? { locationId: where.locationId } : {}),
    OR: [
      {
        currentStatusId: null
      },
      {
        currentStatus: {
          is: {
            statusCode: {
              notIn: ['DELIVERED', 'REJECTED']
            },
            ...statusModuleFilter(STATUS_MODULE_CODES.JOB_CARD_STATUS)
          }
        }
      }
    ]
  };

  const [entries, total, waitingCount, activeCount] = await prisma.$transaction([
    prisma.gateEntry.findMany({
      where,
      select: pendingQueueSelect,
      orderBy: {
        entryTime: 'desc'
      },
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.gateEntry.count({ where }),
    prisma.gateEntry.count({ where }),
    prisma.jobCard.count({ where: activeWhere })
  ]);

  return {
    entries: entries.map(toQueueEntryResponse),
    summary: {
      totalQueue: waitingCount + activeCount,
      waiting: waitingCount,
      active: activeCount
    },
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
};

const detailSelect = {
  ...pendingQueueSelect,
  remarks: true
};

const queueDetail = async (id, user) => {
  const gateEntryId = Number(id);
  const where = {
    id: gateEntryId,
    ...(user && user.locationId ? { locationId: Number(user.locationId) } : {})
  };

  const gateEntry = await prisma.gateEntry.findFirst({
    where,
    select: detailSelect
  });

  if (!gateEntry) {
    throw createHttpError(404, 'Gate entry not found');
  }

  return {
    entry: {
      ...toQueueEntryResponse(gateEntry),
      remarks: gateEntry.remarks || null
    }
  };
};

const jobCardDetail = async (id, user) => {
  const jobCardId = Number(id);
  const where = {
    id: jobCardId,
    ...(user && user.locationId ? { locationId: Number(user.locationId) } : {})
  };

  const jobCard = await prisma.jobCard.findFirst({
    where,
    select: jobCardDetailSelect
  });

  if (!jobCard) {
    throw createHttpError(404, 'Job card not found');
  }

  const mediaFiles = await prisma.mediaFile.findMany({
    where: {
      OR: [
        {
          moduleName: 'JOB_CARD',
          moduleRecordId: jobCard.id
        },
        {
          moduleName: 'VEHICLE',
          moduleRecordId: jobCard.vehicle.id
        }
      ],
      fileType: 'IMAGE'
    },
    select: {
      id: true,
      moduleRecordId: true,
      moduleName: true,
      fileType: true,
      category: true,
      fileName: true,
      fileUrl: true,
      blobName: true,
      mimeType: true,
      fileSizeKb: true,
      createdAt: true
    },
    orderBy: {
      createdAt: 'desc'
    }
  });

  return {
    record: toJobCardDetailResponse(jobCard, mediaFiles)
  };
};

const getServiceItemId = (item) => {
  if (!isPlainObject(item)) {
    return Number(item);
  }

  return Number(item.serviceItemId ?? item.service_item_id ?? item.id ?? item.serviceId ?? item.value);
};

const getServiceItemName = (item) => {
  if (!isPlainObject(item)) {
    return undefined;
  }

  return toTrimmedString(item.serviceName || item.name || item.label);
};

const getServiceItemSlug = (item) => {
  if (!isPlainObject(item)) {
    return undefined;
  }

  return toTrimmedString(item.slug || item.serviceSlug || item.service_item_slug);
};

const normalizeServiceItems = (serviceItems) => {
  const namesById = new Map();
  const duplicateIdsWithoutNaturalKey = new Set();
  const seenIdsWithoutNaturalKey = new Set();

  serviceItems.forEach((item) => {
    const serviceItemId = getServiceItemId(item);
    const serviceName = getServiceItemName(item);
    const serviceSlug = getServiceItemSlug(item);

    if (Number.isInteger(serviceItemId) && serviceItemId > 0 && serviceName) {
      const nameSet = namesById.get(serviceItemId) || new Set();
      nameSet.add(serviceName.toLowerCase());
      namesById.set(serviceItemId, nameSet);
    }

    if (Number.isInteger(serviceItemId) && serviceItemId > 0 && !serviceName && !serviceSlug) {
      if (seenIdsWithoutNaturalKey.has(serviceItemId)) {
        duplicateIdsWithoutNaturalKey.add(serviceItemId);
      }

      seenIdsWithoutNaturalKey.add(serviceItemId);
    }
  });

  const conflictingIds = new Set(
    Array.from(namesById.entries())
      .filter(([, nameSet]) => nameSet.size > 1)
      .map(([serviceItemId]) => serviceItemId)
  );

  if (duplicateIdsWithoutNaturalKey.size > 0) {
    throw createHttpError(
      400,
      'Duplicate service item ids are ambiguous. Send each selected service with its own serviceItemId, or include serviceName/serviceSlug for each item.'
    );
  }
  const itemMap = new Map();

  serviceItems.forEach((item) => {
    const parsedServiceItemId = getServiceItemId(item);
    const serviceItemId = Number.isInteger(parsedServiceItemId) && parsedServiceItemId > 0 ? parsedServiceItemId : null;
    const serviceName = getServiceItemName(item);
    const serviceSlug = getServiceItemSlug(item);
    const quantity = Math.max(1, Number(isPlainObject(item) && item.quantity !== undefined ? item.quantity : 1) || 1);
    const shouldUseNaturalKey = serviceItemId && conflictingIds.has(serviceItemId) && (serviceSlug || serviceName);
    const key = shouldUseNaturalKey
      ? `${serviceSlug ? 'slug' : 'name'}:${String(serviceSlug || serviceName).toLowerCase()}`
      : `id:${serviceItemId}`;
    const existing = itemMap.get(key);

    itemMap.set(key, {
      serviceItemId: shouldUseNaturalKey ? null : serviceItemId,
      serviceName,
      serviceSlug,
      quantity: (existing ? existing.quantity : 0) + quantity
    });
  });

  return Array.from(itemMap.values());
};

const toJobCardResponse = (jobCard) => ({
  id: jobCard.id,
  jobCardNo: jobCard.jobCardNo,
  gateEntryId: jobCard.gateEntryId,
  expectedDeliveryAt: jobCard.expectedDeliveryAt,
  totalEstimate: Number(jobCard.totalEstimate),
  billing: {
    serviceSubtotal: jobCard.serviceSubtotal === null || jobCard.serviceSubtotal === undefined ? null : Number(jobCard.serviceSubtotal),
    taxRate: jobCard.taxRate === null || jobCard.taxRate === undefined ? null : Number(jobCard.taxRate),
    taxAmount: jobCard.taxAmount === null || jobCard.taxAmount === undefined ? null : Number(jobCard.taxAmount),
    discountAmount: jobCard.discountAmount === null || jobCard.discountAmount === undefined ? null : Number(jobCard.discountAmount),
    finalAmount: jobCard.finalAmount === null || jobCard.finalAmount === undefined ? null : Number(jobCard.finalAmount),
    discountReason: jobCard.discountReason || null
  },
  customerComplaint: jobCard.customerComplaint,
  additionalNotes: jobCard.additionalNotes,
  currentStatus: jobCard.currentStatus
    ? {
      id: jobCard.currentStatus.id,
      code: jobCard.currentStatus.statusCode,
      name: jobCard.currentStatus.statusName
    }
    : null,
  approvalStatus: jobCard.approvalStatus
    ? {
      id: jobCard.approvalStatus.id,
      code: jobCard.approvalStatus.statusCode,
      name: jobCard.approvalStatus.statusName
    }
    : null,
  customer: jobCard.customer
    ? {
      id: jobCard.customer.id,
      name: jobCard.customer.fullName,
      mobileNo: jobCard.customer.mobileNo,
      alternateMobileNo: jobCard.customer.alternateMobileNo,
      emailId: jobCard.customer.emailId,
      address: jobCard.customer.address
    }
    : null,
  vehicle: jobCard.vehicle
    ? {
      id: jobCard.vehicle.id,
      registrationNumber: jobCard.vehicle.registrationNo,
      model: jobCard.vehicle.model,
      brand: toBrandResponse(jobCard.vehicle.brand),
      variant: jobCard.vehicle.variant,
      fuelType: jobCard.vehicle.fuelType,
      color: jobCard.vehicle.vehicleColor,
      chassisNo: jobCard.vehicle.chassisNo,
      engineNo: jobCard.vehicle.engineNo
    }
    : null,
  services: (jobCard.services || []).map((service) => ({
    id: service.id,
    serviceItemId: service.serviceItemId,
    name: service.serviceName,
    price: Number(service.price),
    quantity: service.quantity,
    isAdditional: service.isAdditional
  }))
});

const createFromGateEntry = async (payload, user, files = []) => {
  const gateEntryId = Number(payload.gateEntryId);
  const expectedDeliveryAt = new Date(getPayloadField(payload, 'expectedDeliveryAt'));
  const normalizedServiceItems = normalizeServiceItems(payload.serviceItems);

  const gateEntry = await prisma.gateEntry.findFirst({
    where: {
      id: gateEntryId,
      exitTime: null,
      ...(user && user.locationId ? { locationId: Number(user.locationId) } : {})
    },
    select: {
      id: true,
      gateEntryNo: true,
      locationId: true,
      customerId: true,
      vehicleId: true,
      location: {
        select: {
          serviceCenter: {
            select: {
              tax: true
            }
          }
        }
      },
      jobCards: {
        select: {
          id: true,
          jobCardNo: true
        },
        take: 1
      }
    }
  });

  if (!gateEntry) {
    throw createHttpError(404, 'Active gate entry not found');
  }

  if (gateEntry.jobCards.length > 0) {
    throw createHttpError(409, 'Job card is already created for this gate entry', {
      jobCard: gateEntry.jobCards[0]
    });
  }

  const serviceItemIds = normalizedServiceItems
    .map((item) => item.serviceItemId)
    .filter(Boolean);
  const serviceItemNames = normalizedServiceItems
    .filter((item) => !item.serviceItemId && item.serviceName)
    .map((item) => item.serviceName);
  const serviceItemSlugs = normalizedServiceItems
    .filter((item) => !item.serviceItemId && item.serviceSlug)
    .map((item) => item.serviceSlug);
  const serviceItemFilters = [
    ...(serviceItemIds.length > 0 ? [{ id: { in: serviceItemIds } }] : []),
    ...(serviceItemNames.length > 0 ? [{ name: { in: serviceItemNames } }] : []),
    ...(serviceItemSlugs.length > 0 ? [{ slug: { in: serviceItemSlugs } }] : [])
  ];

  if (serviceItemFilters.length === 0) {
    throw createHttpError(400, 'At least one valid service item is required');
  }

  const serviceItems = await prisma.serviceItem.findMany({
    where: {
      isActive: true,
      category: {
        isActive: true
      },
      OR: serviceItemFilters
    },
    select: {
      id: true,
      name: true,
      slug: true,
      defaultPrice: true,
      category: {
        select: {
          id: true,
          name: true,
          slug: true
        }
      }
    }
  });

  const serviceItemMap = new Map(serviceItems.map((item) => [item.id, item]));
  const serviceItemNameMap = new Map(serviceItems.map((item) => [String(item.name).toLowerCase(), item]));
  const serviceItemSlugMap = new Map(serviceItems.map((item) => [String(item.slug).toLowerCase(), item]));
  const resolvedServiceItems = normalizedServiceItems.map((item) => {
    const serviceItem = item.serviceItemId
      ? serviceItemMap.get(item.serviceItemId)
      : serviceItemSlugMap.get(String(item.serviceSlug || '').toLowerCase())
      || serviceItemNameMap.get(String(item.serviceName || '').toLowerCase());

    if (!serviceItem) {
      return null;
    }

    return {
      ...item,
      serviceItemId: serviceItem.id,
      serviceName: serviceItem.name,
      price: Number(serviceItem.defaultPrice),
      category: serviceItem.category
    };
  });

  if (resolvedServiceItems.some((item) => !item)) {
    throw createHttpError(400, 'One or more service items are invalid or inactive');
  }

  const serviceSubtotal = resolvedServiceItems.reduce((sum, item) => {
    return sum + (item.price * item.quantity);
  }, 0);
  const serviceCenterTax = Number(gateEntry.location?.serviceCenter?.tax) || 0;
  const billingSummary = buildBillingSummary(payload.billing, serviceSubtotal, serviceCenterTax);
  const customerApprovalDecision = normalizeCustomerApproval(payload);
  const uploadedPhotos = await uploadVehiclePhotos(files, user.userId, payload.photoCategories);
  const auditModuleId = await resolveJobCardAuditModuleId(user.userId);

  return prisma.$transaction(async (tx) => {
    const existingJobCard = await tx.jobCard.findFirst({
      where: { gateEntryId: gateEntry.id },
      select: {
        id: true,
        jobCardNo: true
      }
    });

    if (existingJobCard) {
      throw createHttpError(409, 'Job card is already created for this gate entry', {
        jobCard: existingJobCard
      });
    }

    const vehicleUpdateData = await buildVehicleUpdateData(tx, payload.vehicleInfo, user.userId);
    if (vehicleUpdateData.registrationNo) {
      const duplicateVehicle = await tx.vehicle.findFirst({
        where: {
          registrationNo: vehicleUpdateData.registrationNo,
          id: {
            not: gateEntry.vehicleId
          }
        },
        select: { id: true }
      });

      if (duplicateVehicle) {
        throw createHttpError(409, 'Vehicle number already exists for another vehicle');
      }
    }

    if (Object.keys(vehicleUpdateData).length > 0) {
      await tx.vehicle.update({
        where: { id: gateEntry.vehicleId },
        data: vehicleUpdateData
      });
    }

    const customerUpdateData = buildCustomerUpdateData(payload.customerInfo, user.userId);
    if (Object.keys(customerUpdateData).length > 0) {
      await tx.customer.update({
        where: { id: gateEntry.customerId },
        data: customerUpdateData
      });
    }

    let currentStatusId = await resolveStatusIdFromCodes(
      tx,
      STATUS_MODULE_CODES.JOB_CARD_STATUS,
      JOB_CARD_CREATED_STATUS_CODES
    );
    let approvalStatusId = null;
    let serviceApprovalStatusId = null;
    let serviceStatusId = await resolveStatusIdFromCodes(
      tx,
      STATUS_MODULE_CODES.JOB_CARD_SERVICE,
      JOB_CARD_SERVICE_PENDING_STATUS_CODES
    );

    if (customerApprovalDecision) {
      const isApproved = customerApprovalDecision === 'APPROVED';
      const approvalStatusCodes = isApproved ? APPROVAL_APPROVED_STATUS_CODES : APPROVAL_REJECTED_STATUS_CODES;
      const jobCardStatusCodes = isApproved ? JOB_CARD_APPROVED_STATUS_CODES : JOB_CARD_REJECTED_STATUS_CODES;

      approvalStatusId = await resolveRequiredStatusId(
        tx,
        STATUS_MODULE_CODES.APPROVAL_STATUS,
        approvalStatusCodes,
        `${customerApprovalDecision.toLowerCase()} approval`
      );
      serviceApprovalStatusId = approvalStatusId;
      currentStatusId = await resolveRequiredStatusId(
        tx,
        STATUS_MODULE_CODES.JOB_CARD_STATUS,
        jobCardStatusCodes,
        `${customerApprovalDecision.toLowerCase()} job card`
      );

      if (!isApproved) {
        serviceStatusId = await resolveRequiredStatusId(
          tx,
          STATUS_MODULE_CODES.JOB_CARD_SERVICE,
          JOB_CARD_SERVICE_REJECTED_STATUS_CODES,
          'Rejected job card service'
        );
      }
    }

    const jobCardNo = await generateJobCardNo(tx);
    const jobCardSlug = await createUniqueSlug(tx, 'jobCard', jobCardNo);
    const additionalNotes = buildAdditionalNotes(payload);
    const customerComplaint = toTrimmedString(getPayloadField(payload, 'customerComplaint'));
    const customerApprovalResponse = toTrimmedString(getPayloadField(payload, 'customer_approval', 'customerApproval'));

    const jobCard = await tx.jobCard.create({
      data: {
        locationId: gateEntry.locationId,
        jobCardNo,
        slug: jobCardSlug,
        gateEntryId: gateEntry.id,
        customerId: gateEntry.customerId,
        vehicleId: gateEntry.vehicleId,
        expectedDeliveryAt,
        currentStatusId,
        approvalStatusId,
        totalEstimate: billingSummary.finalAmount,
        serviceSubtotal: billingSummary.serviceSubtotal,
        taxRate: billingSummary.taxRate,
        taxAmount: billingSummary.taxAmount,
        discountAmount: billingSummary.discountAmount,
        finalAmount: billingSummary.finalAmount,
        discountReason: billingSummary.discountReason,
        customerComplaint,
        additionalNotes,
        createdById: user.userId || null
      },
      select: {
        id: true,
        jobCardNo: true
      }
    });

    const jobCardQueueStatus = await resolveStatusFromCodes(
      tx,
      STATUS_MODULE_CODES.JOB_CARD_STATUS,
      ['JOB_CARD_PENDING']
    );

    if (jobCardQueueStatus) {
      await completeStage({
        gateEntryId: gateEntry.id,
        jobCardId: jobCard.id,
        moduleId: jobCardQueueStatus.moduleId,
        statusId: jobCardQueueStatus.id,
        modifiedById: user.userId || null
      }, tx);
    }

    const approval = customerApprovalDecision
      ? await tx.jobCardApproval.create({
        data: {
          jobCardId: jobCard.id,
          statusId: approvalStatusId,
          approvalType: INITIAL_APPROVAL_TYPE,
          totalAmount: billingSummary.finalAmount,
          customerResponse: customerApprovalResponse,
          sentAt: new Date(),
          respondedAt: new Date(),
          createdById: user.userId || null
        },
        select: {
          id: true,
          approvalType: true,
          totalAmount: true,
          customerResponse: true,
          sentAt: true,
          respondedAt: true,
          status: {
            select: {
              id: true,
              statusCode: true,
              statusName: true
            }
          }
        }
      })
      : null;

    await tx.jobCardService.createMany({
      data: resolvedServiceItems.map((item) => {
        return {
          jobCardId: jobCard.id,
          approvalId: approval ? approval.id : null,
          serviceItemId: item.serviceItemId,
          approvalStatusId: serviceApprovalStatusId,
          serviceName: item.serviceName,
          price: item.price,
          quantity: item.quantity,
          serviceStatusId,
          isAdditional: false,
          createdById: user.userId || null
        };
      })
    });

    const trackingJobCard = await tx.jobCard.findUnique({
      where: {
        id: jobCard.id
      },
      select: {
        id: true,
        locationId: true,
        gateEntryId: true,
        customerId: true,
        vehicleId: true,
        currentStatus: {
          select: {
            statusCode: true
          }
        },
        approvalStatus: {
          select: {
            statusCode: true
          }
        },
        services: {
          select: {
            id: true,
            isAdditional: true,
            serviceStatus: {
              select: {
                statusCode: true
              }
            },
            approvalStatus: {
              select: {
                statusCode: true
              }
            },
            workAssignments: {
              select: {
                id: true,
                completedAt: true,
                status: {
                  select: {
                    statusCode: true
                  }
                }
              }
            },
            serviceItem: {
              select: {
                category: {
                  select: {
                    name: true,
                    slug: true
                  }
                }
              }
            }
          }
        }
      }
    });

    if (trackingJobCard) {
      await startNextAssignmentPendingStage(tx, {
        jobCard: trackingJobCard,
        createdById: user.userId || null
      });
    }

    const mediaRows = buildMediaRows({
      uploadedPhotos,
      vehicleId: gateEntry.vehicleId,
      actorUserId: user.userId
    });

    if (mediaRows.length > 0) {
      await tx.mediaFile.createMany({
        data: mediaRows
      });
    }

    // await tx.jobCardStatusLog.create({
    //   data: {
    //     jobCardId: jobCard.id,
    //     statusId: currentStatusId,
    //     changedById: user.userId || null,
    //     remarks: 'Job card created from gate entry'
    //   }
    // });

    await createAudit(tx, {
      tableName: 'job_cards',
      recordId: jobCard.id,
      actionType: 'CREATE',
      actorUserId: user.userId,
      recordName: jobCard.jobCardNo,
      comments: 'Job card created from mobile job card app',
      locationId: gateEntry.locationId,
      moduleId: auditModuleId,
      details: [
        { fieldName: 'gateEntryNo', oldValue: null, newValue: gateEntry.gateEntryNo, dataType: 'string' },
        { fieldName: 'totalEstimate', oldValue: null, newValue: billingSummary.finalAmount, dataType: 'number' }
      ]
    });

    const createdJobCard = await tx.jobCard.findUnique({
      where: {
        id: jobCard.id
      },
      select: {
        id: true,
        jobCardNo: true,
        gateEntryId: true,
        expectedDeliveryAt: true,
        totalEstimate: true,
        serviceSubtotal: true,
        taxRate: true,
        taxAmount: true,
        discountAmount: true,
        finalAmount: true,
        discountReason: true,
        customerComplaint: true,
        additionalNotes: true,
        currentStatus: {
          select: {
            id: true,
            statusCode: true,
            statusName: true
          }
        },
        approvalStatus: {
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
            mobileNo: true,
            alternateMobileNo: true,
            emailId: true,
            address: true
          }
        },
        vehicle: {
          select: {
            id: true,
            registrationNo: true,
            model: true,
            variant: true,
            fuelType: true,
            vehicleColor: true,
            chassisNo: true,
            engineNo: true,
            brand: {
              select: {
                id: true,
                name: true
              }
            }
          }
        },
        services: {
          select: {
            id: true,
            serviceItemId: true,
            serviceName: true,
            price: true,
            quantity: true,
            isAdditional: true
          }
        }
      }
    });

    return {
      jobCard: toJobCardResponse(createdJobCard),
      billing: billingSummary,
      media: {
        photos: mediaRows.map((row) => {
          let fileUrl = row.fileUrl;
          if (storageProvider.isConfigured && row.blobName) {
            try {
              fileUrl = storageProvider.generateSasUrl(row.blobName, 3600);
            } catch (e) {
              console.error('Error signing URL in createJobCard response:', e);
            }
          }
          return {
            category: row.category,
            fileUrl: fileUrl,
            fileName: row.fileName
          };
        })
      },
      approval: approval
        ? {
          id: approval.id,
          type: approval.approvalType,
          status: toStatusResponse(approval.status),
          totalAmount: Number(approval.totalAmount),
          customerResponse: approval.customerResponse,
          sentAt: approval.sentAt,
          respondedAt: approval.respondedAt
        }
        : null,
      nextAction: customerApprovalDecision ? `CUSTOMER_${customerApprovalDecision}` : 'JOB_CARD_CREATED'
    };
  }, { maxWait: 20000, timeout: 50000 });
};

const updateFromMobile = async (id, payload, user, files = []) => {
  const existingJobCard = await prisma.jobCard.findFirst({
    where: { id: Number(id) },
    select: { id: true, vehicleId: true }
  });

  if (!existingJobCard) {
    throw createHttpError(404, 'Job Card not found');
  }

  if (payload.deletedMediaIds && Array.isArray(payload.deletedMediaIds) && payload.deletedMediaIds.length > 0) {
    const idsToDelete = payload.deletedMediaIds.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (idsToDelete.length > 0) {
      const filesToDelete = await prisma.mediaFile.findMany({
        where: {
          id: { in: idsToDelete },
          OR: [
            { moduleName: 'JOB_CARD', moduleRecordId: existingJobCard.id },
            { moduleName: 'VEHICLE', moduleRecordId: existingJobCard.vehicleId }
          ]
        }
      });

      for (const f of filesToDelete) {
        if (f.blobName && storageProvider.isConfigured) {
          try {
            await storageProvider.delete(f.blobName);
          } catch (err) {
            console.warn(`Failed to delete blob ${f.blobName}`, err);
          }
        }
      }

      if (filesToDelete.length > 0) {
        await prisma.mediaFile.deleteMany({
          where: { id: { in: filesToDelete.map((f) => f.id) } }
        });
      }
    }
  }

  if (files && files.length > 0) {
    const uploadedPhotos = await uploadVehiclePhotos(files, user.userId, payload.photoCategories);
    if (uploadedPhotos.length > 0) {
      await prisma.mediaFile.createMany({
        data: buildMediaRows({ uploadedPhotos, vehicleId: existingJobCard.vehicleId })
      });
    }
  }

  return await jobCardService.updateJobCard(id, payload, user);
};

const lookupVehicleByNumber = async (vehicleNumber, user) => {
  const normalizedNumber = normalizeVehicleNumber(vehicleNumber);

  if (!normalizedNumber) {
    throw createHttpError(400, 'Vehicle number is required');
  }

  const vehicle = await prisma.vehicle.findUnique({
    where: { registrationNo: normalizedNumber },
    include: {
      customer: {
        select: {
          id: true,
          fullName: true,
          mobileNo: true,
          alternateMobileNo: true,
          emailId: true,
          address: true
        }
      },
      brand: {
        select: { id: true, name: true }
      },
      location: {
        select: { id: true, locationName: true, locationCode: true }
      }
    }
  });

  if (!vehicle) {
    return null;
  }

  return {
    id: vehicle.id,
    registrationNumber: vehicle.registrationNo,
    model: vehicle.model,
    brand: toBrandResponse(vehicle.brand),
    variant: vehicle.variant,
    fuelType: vehicle.fuelType,
    color: vehicle.vehicleColor,
    chassisNo: vehicle.chassisNo,
    engineNo: vehicle.engineNo,
    customer: vehicle.customer
      ? {
        id: vehicle.customer.id,
        name: vehicle.customer.fullName,
        mobileNo: vehicle.customer.mobileNo,
        alternateMobileNo: vehicle.customer.alternateMobileNo,
        emailId: vehicle.customer.emailId,
        address: vehicle.customer.address
      }
      : null,
    location: vehicle.location || null
  };
};

const updateJobCardServices = async (jobCardId, servicesPayload, user) => {
  const parsedJobCardId = Number(jobCardId);
  if (!parsedJobCardId) throw createHttpError(400, 'Invalid job card ID');

  return await prisma.$transaction(async (tx) => {
    const jobCard = await tx.jobCard.findUnique({
      where: { id: parsedJobCardId },
      include: {
        services: true,
        currentStatus: true,
        workAssignments: true
      }
    });

    if (!jobCard) throw createHttpError(404, 'Job Card not found');

    const closedStatuses = ['BILLED', 'INVOICED', 'DELIVERED', 'CANCELLED'];
    if (closedStatuses.includes(jobCard.currentStatus?.statusCode)) {
      throw createHttpError(400, `Cannot update services. Job card is ${jobCard.currentStatus?.statusName}`);
    }

    const statuses = await tx.statusMaster.findMany({
      where: { module: { is: { moduleCode: 'job-card-service', isActive: true } }, isActive: true }
    });

    for (const payloadService of (servicesPayload || [])) {
      const serviceId = Number(payloadService.id);
      const newStatusString = (payloadService.status || '').toUpperCase().replace(/\s+/g, '_');
      
      const statusObj = statuses.find(s => s.statusCode === newStatusString || s.statusName.toUpperCase().replace(/\s+/g, '_') === newStatusString);
      if (!statusObj) throw createHttpError(400, `Invalid status: ${payloadService.status}`);

      const existingService = jobCard.services.find(s => s.id === serviceId);
      if (!existingService) continue;

      if (existingService.serviceStatusId !== statusObj.id) {
        // 1. Completed service cannot be changed
        const currentServiceStatus = await tx.statusMaster.findUnique({ where: { id: existingService.serviceStatusId } });
        if (currentServiceStatus?.statusCode === 'COMPLETED') {
          throw createHttpError(400, 'Completed service status cannot be changed');
        }

        // 2. Additional work must be customer approved before it can be started / progressed
        if (existingService.isAdditional && ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED'].includes(statusObj.statusCode)) {
          const approval = existingService.approvalId ? await tx.jobCardApproval.findUnique({
            where: { id: existingService.approvalId },
            include: { status: true }
          }) : null;
          const approvalCode = approval?.status?.statusCode;
          if (approvalCode !== 'APPROVED' && approvalCode !== 'CUSTOMER_APPROVED') {
            throw createHttpError(400, 'Additional work must be customer approved before it can be started');
          }
        }

        // 3. Validate "In Progress"
        if (statusObj.statusCode === 'IN_PROGRESS') {
          const assignment = jobCard.workAssignments.find(a => a.jobCardServiceId === serviceId);
          if (!assignment || !assignment.assignedUserId) {
            throw createHttpError(400, `Cannot mark service ${existingService.serviceName} as In Progress without an assigned mechanic`);
          }
        }

        await tx.jobCardService.update({
          where: { id: serviceId },
          data: { serviceStatusId: statusObj.id, modifiedById: user?.userId || null }
        });

        await tx.jobCardServiceHistory.create({
          data: {
            jobCardServiceId: serviceId,
            actionTypeId: statusObj.id,
            fromStatusId: existingService.serviceStatusId,
            toStatusId: statusObj.id,
            reason: statusObj.statusCode === 'POSTPONED' ? (payloadService.reason || 'Mobile Status Update - Postponed') : 'Mobile Status Update',
            changedById: user?.userId || 1
          }
        });
      }

      // ─── POSTPONED: set assignment ON_HOLD + release bay (matches web flow) ───
      if (statusObj.statusCode === 'POSTPONED') {
        const activeAssignment = jobCard.workAssignments.find(
          a => a.jobCardServiceId === serviceId && !a.completedAt
        );

        if (activeAssignment) {
          const onHoldStatus = await tx.statusMaster.findFirst({
            where: {
              statusCode: 'ON_HOLD',
              module: { is: { moduleCode: 'work-assignment', isActive: true } },
              isActive: true
            }
          });

          if (onHoldStatus) {
            await tx.workAssignment.update({
              where: { id: activeAssignment.id },
              data: { statusId: onHoldStatus.id, modifiedById: user?.userId || null }
            });
          }

          // Release the bay so another job can use it
          await tx.bay.updateMany({
            where: { currentWorkAssignmentId: activeAssignment.id },
            data: { currentWorkAssignmentId: null }
          });
        }

        // Complete any open process stage tracker
        const activeTracker = await tx.processStageTracking.findFirst({
          where: { jobCardId: parsedJobCardId, completedAt: null }
        });
        if (activeTracker) {
          await tx.processStageTracking.update({
            where: { id: activeTracker.id },
            data: { completedAt: new Date() }
          });
        }

        // Skip normal assignment sync — POSTPONED is fully handled above
        continue;
      }

      // Sync Work Assignments
      const assignment = jobCard.workAssignments.find(a => a.jobCardServiceId === serviceId);
      if (assignment) {
        const assignmentStatuses = await tx.statusMaster.findMany({ where: { module: { is: { moduleCode: 'work-assignment', isActive: true } }, isActive: true } });
        const existingAssignmentStatus = assignmentStatuses.find(s => s.id === assignment.statusId);
        const isBodyShop = existingAssignmentStatus?.statusCode?.includes('BODY_SHOP') || false;
        const prefix = isBodyShop ? 'BODY_SHOP_' : 'MECHANICAL_';
        
        let baseStatusCode = statusObj.statusCode;
        const normalizedName = (statusObj.statusName || '').toUpperCase().replace(/\s+/g, '_');
        if (normalizedName === 'IN_PROGRESS' || baseStatusCode === 'IN_PROGRESS') baseStatusCode = 'IN_PROGRESS';
        if (normalizedName === 'COMPLETED' || baseStatusCode === 'COMPLETED') baseStatusCode = 'COMPLETED';
        if (normalizedName === 'ASSIGNED' || baseStatusCode === 'ASSIGNED') baseStatusCode = 'ASSIGNED';
        
        const matchAssignStatus = assignmentStatuses.find(s => s.statusCode === `${prefix}${baseStatusCode}` || s.statusName.toUpperCase().replace(/\s+/g, '_') === `${prefix}${baseStatusCode}`);
        
        if (matchAssignStatus && assignment.statusId !== matchAssignStatus.id) {
          let updateData = { statusId: matchAssignStatus.id, modifiedById: user?.userId || null };
          if (statusObj.statusCode === 'COMPLETED') updateData.completedAt = new Date();
          if (statusObj.statusCode === 'IN_PROGRESS') updateData.startedAt = new Date();
          
          await tx.workAssignment.update({
            where: { id: assignment.id },
            data: updateData
          });
        }
      }
    }

    // Recalculate job card status based on updated services
    const updatedJobCard = await tx.jobCard.findUnique({
      where: { id: parsedJobCardId },
      include: {
        services: {
          include: {
            serviceStatus: true,
            workAssignments: { include: { status: true } },
            approvalStatus: true,
            serviceItem: { include: { category: true } }
          }
        },
        currentStatus: true,
        approvalStatus: true,
        processStageTrackings: {
          select: {
            stageStatus: true,
            status: { select: { statusCode: true } }
          }
        }
      }
    });

    if (updatedJobCard) {
      const newJobCardStatus = await jobCardService.deriveJobCardStatus(tx, updatedJobCard);
      if (newJobCardStatus && newJobCardStatus.id !== updatedJobCard.currentStatusId) {
        await jobCardService.syncJobCardStageTracking(tx, parsedJobCardId, updatedJobCard.currentStatusId, newJobCardStatus, user);
        await tx.jobCard.update({
          where: { id: parsedJobCardId },
          data: { currentStatusId: newJobCardStatus.id }
        });
      }

      await syncAssignmentPendingStages(tx, { jobCard: updatedJobCard, actorUserId: user?.userId || null });
    }

    // Return the updated job card
    return { success: true, message: 'Services updated successfully' };
  }, { maxWait: 20000, timeout: 50000 });
};

// ─── Resume a POSTPONED service (matches web API resumeJobCardService) ────────
// PUT /mobile/job-cards/resume-service/:jobCardId/:serviceId
// Body: { bayId, mechanicId }
const resumeJobCardService = async (jobCardId, serviceId, bayId, mechanicId, user) => {
  const parsedJobCardId = Number(jobCardId);
  const parsedServiceId = Number(serviceId);

  return prisma.$transaction(async (tx) => {
    const service = await tx.jobCardService.findUnique({
      where: { id: parsedServiceId, jobCardId: parsedJobCardId },
      include: {
        jobCard: { include: { currentStatus: true } },
        serviceStatus: true,
        workAssignments: { where: { completedAt: null }, orderBy: { createdAt: 'desc' } },
        serviceItem: { include: { category: true } }
      }
    });

    if (!service) throw createHttpError(404, 'Service not found in Job Card');

    const currentStatusCode = (service.serviceStatus?.statusCode || '').toUpperCase();
    if (currentStatusCode !== 'POSTPONED') {
      throw createHttpError(400, 'Only POSTPONED services can be resumed');
    }

    // Validate bay is available
    const bay = await tx.bay.findUnique({ where: { id: Number(bayId) } });
    if (!bay || bay.currentWorkAssignmentId) {
      throw createHttpError(400, 'Selected bay is not available');
    }

    // Determine department prefix from service category
    const category = service.serviceItem?.category;
    const deptRaw = String(category?.slug || category?.name || '').toLowerCase();
    const isBodyShop = deptRaw.includes('body');
    const deptPrefix = isBodyShop ? 'BODY_SHOP' : 'MECHANICAL';

    const assignedServiceStatus = await tx.statusMaster.findFirst({
      where: { statusCode: 'ASSIGNED', module: { is: { moduleCode: 'job-card-service', isActive: true } }, isActive: true }
    });
    if (!assignedServiceStatus) throw createHttpError(500, 'Assigned service status not configured');

    const assignedAssignmentStatus = await tx.statusMaster.findFirst({
      where: { statusCode: `${deptPrefix}_ASSIGNED`, module: { is: { moduleCode: 'work-assignment', isActive: true } }, isActive: true }
    });
    if (!assignedAssignmentStatus) throw createHttpError(500, `${deptPrefix}_ASSIGNED work assignment status not configured`);

    // Complete the old ON_HOLD assignment
    const oldAssignment = service.workAssignments[0];
    if (oldAssignment) {
      const completedStatus = await tx.statusMaster.findFirst({
        where: { statusCode: `${deptPrefix}_COMPLETED`, module: { is: { moduleCode: 'work-assignment', isActive: true } }, isActive: true }
      });
      if (completedStatus) {
        await tx.workAssignment.update({
          where: { id: oldAssignment.id },
          data: { completedAt: new Date(), statusId: completedStatus.id, modifiedById: user?.userId || null }
        });
      }
    }

    // Set service status back to ASSIGNED
    await tx.jobCardService.update({
      where: { id: parsedServiceId },
      data: { serviceStatusId: assignedServiceStatus.id, modifiedById: user?.userId || null }
    });

    // Create new work assignment
    const newAssignment = await tx.workAssignment.create({
      data: {
        jobCardId: parsedJobCardId,
        jobCardServiceId: parsedServiceId,
        assignedUserId: Number(mechanicId),
        assignedById: user?.userId || null,
        bayId: Number(bayId),
        statusId: assignedAssignmentStatus.id,
        assignedAt: new Date(),
        createdById: user?.userId || null
      }
    });

    // Mark bay as occupied
    await tx.bay.update({
      where: { id: Number(bayId) },
      data: { currentWorkAssignmentId: newAssignment.id }
    });

    // Record service history
    await tx.jobCardServiceHistory.create({
      data: {
        jobCardServiceId: parsedServiceId,
        actionTypeId: assignedServiceStatus.id,
        fromStatusId: service.serviceStatusId,
        toStatusId: assignedServiceStatus.id,
        reason: 'Service resumed from Postponed (Mobile)',
        changedById: user?.userId || 1
      }
    });

    // Recalculate overall job card status
    const fullJobCard = await tx.jobCard.findUnique({
      where: { id: parsedJobCardId },
      include: {
        services: {
          include: {
            serviceStatus: true,
            workAssignments: { include: { status: true } },
            approvalStatus: true,
            serviceItem: { include: { category: true } }
          }
        },
        currentStatus: true,
        approvalStatus: true
      }
    });

    if (fullJobCard) {
      const newJobCardStatus = await jobCardService.deriveJobCardStatus(tx, fullJobCard);
      if (newJobCardStatus && newJobCardStatus.id !== fullJobCard.currentStatusId) {
        await jobCardService.syncJobCardStageTracking(tx, parsedJobCardId, fullJobCard.currentStatusId, newJobCardStatus, user);
        await tx.jobCard.update({
          where: { id: parsedJobCardId },
          data: { currentStatusId: newJobCardStatus.id }
        });
      }
      await syncAssignmentPendingStages(tx, { jobCard: fullJobCard, actorUserId: user?.userId || null });
    }

    return { success: true, message: 'Service resumed successfully', assignmentId: newAssignment.id };
  }, { maxWait: 20000, timeout: 50000 });
};

module.exports = {
  pendingQueue,
  jobCardList,
  queueDetail,
  jobCardDetail,
  createFromGateEntry,
  updateFromMobile,
  updateJobCardServices,
  resumeJobCardService,
  lookupVehicleByNumber
};
