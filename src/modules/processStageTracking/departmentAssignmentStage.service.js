const { STATUS_MODULE_CODES, resolveStatusFromCodes } = require('../../common/utils/status.util');
const { startStage, completeStage, cancelStage, skipStage } = require('./processStageTracking.service');

const DEPARTMENT_ORDER = ['mechanical', 'body-shop', 'water-wash'];

const DEPARTMENT_ALIASES = {
  mechanical: ['mechanical', 'mechanic', 'mechnanic', 'floor'],
  'body-shop': ['body-shop', 'body_shop', 'body shop', 'bodyshop', 'paint', 'denting'],
  'water-wash': ['water-wash', 'water_wash', 'water wash', 'wash']
};

const ASSIGNMENT_PENDING_STATUS_CODES = {
  mechanical: 'MECHANICAL_ASSIGNMENT_PENDING',
  'body-shop': 'BODY_SHOP_ASSIGNMENT_PENDING',
  'water-wash': 'WATER_WASH_ASSIGNMENT_PENDING'
};
const FINAL_JOB_CARD_STATUS_CODES = ['DELIVERED', 'REJECTED'];
const REJECTED_APPROVAL_STATUS_CODES = ['REJECTED'];

const normalizeText = (value) => String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-');

const normalizeDepartment = (value) => {
  const normalizedValue = normalizeText(value);

  return DEPARTMENT_ORDER.find((department) => {
    return DEPARTMENT_ALIASES[department].some((alias) => normalizeText(alias) === normalizedValue);
  });
};

const getServiceDepartment = (service) => {
  const category = service && service.serviceItem && service.serviceItem.category;
  return normalizeDepartment(category && (category.slug || category.name));
};

const getStatusCode = (status) => String((status && status.statusCode) || '').trim().toUpperCase();

const isRejectedAdditionalService = (service) => {
  return Boolean(service && service.isAdditional && getStatusCode(service.approvalStatus) === 'REJECTED');
};

const isApprovedForWork = (service) => {
  if (!service || !service.isAdditional) {
    return true;
  }

  return getStatusCode(service.approvalStatus) === 'APPROVED';
};

const isCompletedStatusCode = (statusCode) => {
  const code = String(statusCode || '').trim().toUpperCase();
  return (
    code === 'COMPLETED' ||
    code.endsWith('_COMPLETED') ||
    code === 'REJECTED' ||
    code.endsWith('_REJECTED') ||
    code === 'CANCELLED' ||
    code.endsWith('_CANCELLED')
  );
};

const getDepartmentServices = (jobCard, department) => {
  return (jobCard.services || []).filter((service) => getServiceDepartment(service) === department);
};

const hasAssignment = (service) => {
  return (service.workAssignments || []).length > 0;
};

const isJobCardServiceCompleted = (service) => {
  if (isRejectedAdditionalService(service)) {
    return true;
  }

  if (isCompletedStatusCode(getStatusCode(service.serviceStatus))) {
    return true;
  }

  const assignments = service.workAssignments || [];
  return assignments.length > 0 && assignments.every((assignment) => {
    return assignment.completedAt || isCompletedStatusCode(getStatusCode(assignment.status));
  });
};

const hasDepartmentServicesAvailableForWork = (jobCard, department) => {
  return getDepartmentServices(jobCard, department).some((service) => {
    return isApprovedForWork(service) && !isRejectedAdditionalService(service);
  });
};

const areDepartmentServicesAssigned = (jobCard, department) => {
  const services = getDepartmentServices(jobCard, department).filter((service) => {
    return isApprovedForWork(service) && !isRejectedAdditionalService(service);
  });

  return services.length > 0 && services.every(hasAssignment);
};

const areDepartmentServicesCompleted = (jobCard, department) => {
  const services = getDepartmentServices(jobCard, department).filter((service) => {
    return isApprovedForWork(service) && !isRejectedAdditionalService(service);
  });

  return services.length === 0 || services.every(isJobCardServiceCompleted);
};

const isDepartmentSkipped = (jobCard, department) => {
  if (!jobCard || !jobCard.processStageTrackings) {
    return false;
  }
  const expectedStatusCode = ASSIGNMENT_PENDING_STATUS_CODES[department];
  const tracking = jobCard.processStageTrackings.find((t) => getStatusCode(t.status) === expectedStatusCode);
  return tracking && String(tracking.stageStatus).trim().toUpperCase() === 'SKIPPED';
};

const isDepartmentPostponed = (jobCard, department) => {
  const services = getDepartmentServices(jobCard, department).filter((service) => {
    return isApprovedForWork(service) && !isRejectedAdditionalService(service);
  });
  if (services.length === 0) return false;

  const hasPostponed = services.some(service => getStatusCode(service.serviceStatus) === 'POSTPONED');
  const allPostponedOrCompleted = services.every(service => {
    return getStatusCode(service.serviceStatus) === 'POSTPONED' || isJobCardServiceCompleted(service);
  });

  return hasPostponed && allPostponedOrCompleted;
};

const canStartAssignmentPendingForDepartment = (jobCard, department) => {
  const currentStatusCode = getStatusCode(jobCard && jobCard.currentStatus);
  const approvalStatusCode = getStatusCode(jobCard && jobCard.approvalStatus);

  if (FINAL_JOB_CARD_STATUS_CODES.includes(currentStatusCode) || REJECTED_APPROVAL_STATUS_CODES.includes(approvalStatusCode)) {
    return false;
  }

  if (!hasDepartmentServicesAvailableForWork(jobCard, department)) {
    return false;
  }

  if (areDepartmentServicesAssigned(jobCard, department) || areDepartmentServicesCompleted(jobCard, department)) {
    return false;
  }

  const departmentIndex = DEPARTMENT_ORDER.indexOf(department);
  const previousDepartments = DEPARTMENT_ORDER.slice(0, departmentIndex);

  if (department === 'water-wash') {
    return previousDepartments.every((previousDepartment) => {
      return !hasDepartmentServicesAvailableForWork(jobCard, previousDepartment)
        || areDepartmentServicesCompleted(jobCard, previousDepartment);
    });
  }

  return previousDepartments.every((previousDepartment) => {
    return !hasDepartmentServicesAvailableForWork(jobCard, previousDepartment)
      || areDepartmentServicesCompleted(jobCard, previousDepartment)
      || isDepartmentPostponed(jobCard, previousDepartment)
      || isDepartmentSkipped(jobCard, previousDepartment);
  });
};

const getNextAssignmentPendingDepartment = (jobCard) => {
  return DEPARTMENT_ORDER.find((department) => canStartAssignmentPendingForDepartment(jobCard, department)) || null;
};

const resolveAssignmentPendingStatus = async (tx, department) => {
  const statusCode = ASSIGNMENT_PENDING_STATUS_CODES[department];

  if (!statusCode) {
    return null;
  }

  return resolveStatusFromCodes(tx, STATUS_MODULE_CODES.JOB_CARD_STATUS, [statusCode]);
};

const hasAnyTrackingForStatus = async (tx, { jobCardId, statusId }) => {
  const existing = await tx.processStageTracking.findFirst({
    where: {
      jobCardId,
      statusId
    },
    select: {
      id: true
    }
  });

  return Boolean(existing);
};

const startDepartmentAssignmentPendingStage = async (tx, { jobCard, department, createdById = null }) => {
  if (!jobCard || !department) {
    return null;
  }

  const status = await resolveAssignmentPendingStatus(tx, department);
  if (!status) {
    return null;
  }

  const alreadyTracked = await hasAnyTrackingForStatus(tx, {
    jobCardId: jobCard.id,
    statusId: status.id
  });

  if (alreadyTracked) {
    return null;
  }

  return startStage({
    locationId: jobCard.locationId,
    gateEntryId: jobCard.gateEntryId || null,
    jobCardId: jobCard.id,
    customerId: jobCard.customerId,
    vehicleId: jobCard.vehicleId,
    moduleId: status.moduleId,
    statusId: status.id,
    createdById
  }, tx);
};

const startNextAssignmentPendingStage = async (tx, { jobCard, createdById = null }) => {
  const department = getNextAssignmentPendingDepartment(jobCard);

  if (!department) {
    return null;
  }

  return startDepartmentAssignmentPendingStage(tx, {
    jobCard,
    department,
    createdById
  });
};

const skipDepartmentAssignmentPendingStage = async (tx, { jobCard, department, modifiedById = null }) => {
  const status = await resolveAssignmentPendingStatus(tx, department);
  if (!status || !jobCard) {
    return null;
  }

  return skipStage({
    locationId: jobCard.locationId,
    gateEntryId: jobCard.gateEntryId || null,
    jobCardId: jobCard.id,
    customerId: jobCard.customerId,
    vehicleId: jobCard.vehicleId,
    moduleId: status.moduleId,
    statusId: status.id,
    modifiedById
  }, tx);
};

const completeDepartmentAssignmentPendingStage = async (tx, { jobCard, department, modifiedById = null }) => {
  const status = await resolveAssignmentPendingStatus(tx, department);
  if (!status || !jobCard) {
    return null;
  }

  return completeStage({
    gateEntryId: jobCard.gateEntryId || null,
    jobCardId: jobCard.id,
    moduleId: status.moduleId,
    statusId: status.id,
    modifiedById
  }, tx);
};

const cancelDepartmentAssignmentPendingStage = async (tx, { jobCard, department, modifiedById = null }) => {
  const status = await resolveAssignmentPendingStatus(tx, department);
  if (!status || !jobCard) {
    return null;
  }

  return cancelStage({
    gateEntryId: jobCard.gateEntryId || null,
    jobCardId: jobCard.id,
    moduleId: status.moduleId,
    statusId: status.id,
    modifiedById
  }, tx);
};

const syncAssignmentPendingStages = async (tx, { jobCard, actorUserId = null }) => {
  for (const department of DEPARTMENT_ORDER) {
    if (!hasDepartmentServicesAvailableForWork(jobCard, department)) {
      await cancelDepartmentAssignmentPendingStage(tx, {
        jobCard,
        department,
        modifiedById: actorUserId
      });
    }
  }

  return startNextAssignmentPendingStage(tx, {
    jobCard,
    createdById: actorUserId
  });
};

module.exports = {
  DEPARTMENT_ORDER,
  ASSIGNMENT_PENDING_STATUS_CODES,
  getServiceDepartment,
  startNextAssignmentPendingStage,
  completeDepartmentAssignmentPendingStage,
  skipDepartmentAssignmentPendingStage,
  syncAssignmentPendingStages
};
