const { STATUS_MODULE_CODES, resolveStatusFromCodes } = require('../../common/utils/status.util');
const { startStage, completeStage, cancelStage, skipStage } = require('./processStageTracking.service');

const DEPARTMENT_ORDER = ['mechanical', 'body-shop', 'water-wash'];

const DEPARTMENT_ALIASES = {
  mechanical: ['mechanical', 'mechanic', 'mechnanic', 'floor', 'general service', 'engine', 'electrical'],
  'body-shop': ['body-shop', 'body_shop', 'body shop', 'bodyshop', 'paint', 'painting', 'denting', 'denting-painting', 'denting-&-painting', 'denting & painting', 'tinkering', 'bodywork', 'collision'],
  'water-wash': ['water-wash', 'water_wash', 'water wash', 'waterwash', 'washing', 'wash']
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
  if (!value) return null;
  const normalizedValue = normalizeText(value);

  return DEPARTMENT_ORDER.find((department) => {
    return DEPARTMENT_ALIASES[department].some((alias) => {
      const normAlias = normalizeText(alias);
      return normalizedValue === normAlias || normalizedValue.includes(normAlias) || normAlias.includes(normalizedValue);
    });
  });
};

const getServiceDepartment = (service) => {
  if (!service) return null;

  const category = service.serviceItem && service.serviceItem.category;
  if (category) {
    const dept = normalizeDepartment(category.slug || category.name);
    if (dept) return dept;
  }

  if (service.category) {
    const dept = normalizeDepartment(service.category.slug || service.category.name);
    if (dept) return dept;
  }

  if (service.categoryName) {
    const dept = normalizeDepartment(service.categoryName);
    if (dept) return dept;
  }

  return 'mechanical';
};

const getStatusCode = (status) => String((status && status.statusCode) || '').trim().toUpperCase();

const isRejectedAdditionalService = (service) => {
  return Boolean(service && service.isAdditional && getStatusCode(service.approvalStatus) === 'REJECTED');
};

const isPendingAdditionalService = (service) => {
  if (!service || !service.isAdditional) return false;
  const code = getStatusCode(service.approvalStatus);
  // Blank / unknown approval status on additional work is treated as PENDING
  return !code || code === 'PENDING';
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
  // If there are pending additional services for this department, it is NOT complete.
  const hasPendingForDept = getDepartmentServices(jobCard, department).some(isPendingAdditionalService);
  if (hasPendingForDept) {
    return false;
  }

  const services = getDepartmentServices(jobCard, department).filter((service) => {
    return isApprovedForWork(service) && !isRejectedAdditionalService(service);
  });

  return services.length === 0 || services.every(isJobCardServiceCompleted);
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

  if (
    areDepartmentServicesAssigned(jobCard, department) ||
    areDepartmentServicesCompleted(jobCard, department) ||
    (department === 'water-wash' && getDepartmentServices(jobCard, 'water-wash').some((s) => {
      const code = getStatusCode(s.serviceStatus);
      return code === 'IN_PROGRESS' || code.includes('IN_PROGRESS');
    }))
  ) {
    return false;
  }

  // 1. Water wash is strictly the final department.
  //    It can ONLY start if all repair departments (mechanical and body-shop) are completely finished.
  //    A postponed repair department is NOT completed!
  if (department === 'water-wash') {
    const repairDepartments = ['mechanical', 'body-shop'];
    return repairDepartments.every((repairDept) => {
      if (!hasDepartmentServicesAvailableForWork(jobCard, repairDept)) return true;
      return areDepartmentServicesCompleted(jobCard, repairDept);
    });
  }

  // 2. For repair departments (mechanical and body-shop):
  const otherRepairDept = department === 'mechanical' ? 'body-shop' : 'mechanical';

  // If the other repair department has no work or is completely finished:
  if (!hasDepartmentServicesAvailableForWork(jobCard, otherRepairDept) || areDepartmentServicesCompleted(jobCard, otherRepairDept)) {
    return true;
  }

  // Both repair departments have uncompleted work.
  // If the other repair department is currently assigned or has active work in progress:
  if (areDepartmentServicesAssigned(jobCard, otherRepairDept)) {
    return false;
  }
  const otherInProgress = getDepartmentServices(jobCard, otherRepairDept).some((s) => {
    const code = getStatusCode(s.serviceStatus);
    return code === 'IN_PROGRESS' || code.includes('IN_PROGRESS');
  });
  if (otherInProgress) {
    return false;
  }

  // If this department is postponed and the other repair department is NOT postponed:
  // this department was skipped in favor of the other. Let the other be assigned!
  if (isDepartmentPostponed(jobCard, department) && !isDepartmentPostponed(jobCard, otherRepairDept)) {
    return false;
  }

  // If the other repair department is postponed and this department is NOT postponed:
  // the other was skipped in favor of this department. This department can start!
  if (!isDepartmentPostponed(jobCard, department) && isDepartmentPostponed(jobCard, otherRepairDept)) {
    return true;
  }

  // If neither (or both) are postponed, follow default department order (mechanical before body-shop):
  const departmentIndex = DEPARTMENT_ORDER.indexOf(department);
  const otherIndex = DEPARTMENT_ORDER.indexOf(otherRepairDept);
  return departmentIndex < otherIndex;
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

  // Auto-resume any postponed approved services in this department since its turn has arrived
  const postponedServices = getDepartmentServices(jobCard, department).filter((service) => {
    return getStatusCode(service.serviceStatus) === 'POSTPONED' && isApprovedForWork(service) && !isRejectedAdditionalService(service);
  });

  if (postponedServices.length > 0) {
    const pendingStatus = await resolveStatusFromCodes(tx, STATUS_MODULE_CODES.JOB_CARD_SERVICE, ['PENDING']);
    if (pendingStatus) {
      for (const service of postponedServices) {
        await tx.jobCardService.update({
          where: { id: service.id },
          data: {
            serviceStatusId: pendingStatus.id,
            modifiedById: createdById
          }
        });

        let resumeAction = null;
        try {
          resumeAction = await resolveStatusFromCodes(tx, 'service-history-actions', ['RESUME']);
        } catch (err) { /* ignore */ }

        await tx.jobCardServiceHistory.create({
          data: {
            jobCardServiceId: service.id,
            actionTypeId: resumeAction ? resumeAction.id : pendingStatus.id,
            fromStatusId: service.serviceStatusId,
            toStatusId: pendingStatus.id,
            reason: `Auto-resumed as ${department} assignment started`,
            changedById: createdById || 1
          }
        });

        service.serviceStatusId = pendingStatus.id;
        service.serviceStatus = pendingStatus;
      }
    }
  }

  if (jobCard.currentStatusId !== status.id) {
    if (jobCard.id) {
      await completeStage({
        jobCardId: jobCard.id,
        modifiedById: createdById
      }, tx);
    }

    await tx.jobCard.update({
      where: { id: jobCard.id },
      data: {
        currentStatusId: status.id,
        modifiedById: createdById
      }
    });
    jobCard.currentStatusId = status.id;
    jobCard.currentStatus = status;
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
  const nextDepartment = getNextAssignmentPendingDepartment(jobCard);

  for (const department of DEPARTMENT_ORDER) {
    if (department !== nextDepartment) {
      await cancelDepartmentAssignmentPendingStage(tx, {
        jobCard,
        department,
        modifiedById: actorUserId
      });
    }
  }

  if (!nextDepartment) {
    return null;
  }

  return startDepartmentAssignmentPendingStage(tx, {
    jobCard,
    department: nextDepartment,
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
