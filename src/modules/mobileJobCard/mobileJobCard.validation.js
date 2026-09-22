const { apiResponse } = require('../../common/utils/apiResponse');

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const CUSTOMER_APPROVAL_VALUES = new Set([
  'YES',
  'Y',
  'APPROVE',
  'APPROVED',
  'TRUE',
  'NO',
  'N',
  'REJECT',
  'REJECTED',
  'FALSE'
]);

const getServiceItemId = (item) => {
  if (!isPlainObject(item)) {
    return Number(item);
  }

  return Number(item.serviceItemId ?? item.service_item_id ?? item.id ?? item.serviceId ?? item.value);
};

const sendValidationError = (res, message) => {
  return apiResponse(res, {
    statusCode: 400,
    success: false,
    message,
    data: {},
    meta: {}
  });
};

const parseJsonField = (payload, fieldName) => {
  if (typeof payload[fieldName] !== 'string') {
    return;
  }

  const value = payload[fieldName].trim();
  if (!value) {
    return;
  }

  payload[fieldName] = JSON.parse(value);
};

const normalizeCreateJobCardPayload = (req, res, next) => {
  try {
    req.body = req.body || {};

    ['serviceItems', 'vehicleInfo', 'customerInfo', 'billing', 'photoCategories', 'deletedMediaIds'].forEach((fieldName) => {
      parseJsonField(req.body, fieldName);
    });

    return next();
  } catch (error) {
    return sendValidationError(res, 'Invalid JSON payload field');
  }
};

const validateIdParam = (req, res, next) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return sendValidationError(res, 'Valid id is required');
  }

  return next();
};

const validateCreateJobCardPayload = (req, res, next) => {
  const { gateEntryId, expectedDeliveryAt, serviceItems, vehicleInfo, customerInfo, billing, photoCategories } = req.body || {};
  const billingObject = isPlainObject(billing) ? billing : {};
  const resolvedExpectedDeliveryAt = expectedDeliveryAt ?? billingObject.expectedDeliveryAt;
  const customerApproval = req.body.customer_approval
    ?? req.body.customerApproval
    ?? billingObject.customer_approval
    ?? billingObject.customerApproval;
  const resolvedGateEntryId = Number(gateEntryId);

  if (!Number.isInteger(resolvedGateEntryId) || resolvedGateEntryId <= 0) {
    return sendValidationError(res, 'Valid gateEntryId is required');
  }

  if (!isNonEmptyString(resolvedExpectedDeliveryAt)) {
    return sendValidationError(res, 'expectedDeliveryAt is required');
  }

  const deliveryDate = new Date(resolvedExpectedDeliveryAt);
  if (Number.isNaN(deliveryDate.getTime())) {
    return sendValidationError(res, 'expectedDeliveryAt must be a valid date time');
  }

  if (!Array.isArray(serviceItems) || serviceItems.length === 0) {
    return sendValidationError(res, 'At least one service item is required');
  }

  for (const item of serviceItems) {
    const serviceItemId = getServiceItemId(item);
    const quantity = Number(isPlainObject(item) && item.quantity !== undefined ? item.quantity : 1);

    if (!Number.isInteger(serviceItemId) || serviceItemId <= 0) {
      return sendValidationError(res, 'Each service item must have a valid serviceItemId');
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return sendValidationError(res, 'Service item quantity must be a positive integer');
    }
  }

  if (vehicleInfo !== undefined && !isPlainObject(vehicleInfo)) {
    return sendValidationError(res, 'vehicleInfo must be an object');
  }

  if (customerInfo !== undefined && !isPlainObject(customerInfo)) {
    return sendValidationError(res, 'customerInfo must be an object');
  }

  if (billing !== undefined) {
    if (!isPlainObject(billing)) {
      return sendValidationError(res, 'billing must be an object');
    }
    const discountValue = billing.discountAmount !== undefined ? billing.discountAmount : billing.discount;
    if (discountValue !== undefined) {
      const discountNum = Number(discountValue);
      if (Number.isNaN(discountNum) || discountNum < 0) {
        return sendValidationError(res, 'Discount amount cannot be less than zero');
      }
    }
  }

  if (photoCategories !== undefined && !Array.isArray(photoCategories)) {
    return sendValidationError(res, 'photoCategories must be an array');
  }

  if (customerApproval !== undefined && customerApproval !== null && customerApproval !== '') {
    const normalizedApproval = String(customerApproval).trim().toUpperCase();
    if (!CUSTOMER_APPROVAL_VALUES.has(normalizedApproval)) {
      return sendValidationError(res, 'customer_approval must be yes or no');
    }
  }

  const { customerComplaint, additionalNotes } = req.body || {};

  if (customerComplaint && typeof customerComplaint === 'string' && customerComplaint.length > 200) {
    return sendValidationError(res, 'customerComplaint must not exceed 200 characters');
  }

  if (additionalNotes && typeof additionalNotes === 'string' && additionalNotes.length > 200) {
    return sendValidationError(res, 'additionalNotes must not exceed 200 characters');
  }

  if (customerInfo && typeof customerInfo.address === 'string' && customerInfo.address.length > 200) {
    return sendValidationError(res, 'customer address must not exceed 200 characters');
  }

  if (billing && typeof billing.discountReason === 'string' && billing.discountReason.length > 200) {
    return sendValidationError(res, 'discountReason must not exceed 200 characters');
  }

  return next();
};

const validateUpdateJobCardPayload = (req, res, next) => {
  const { expectedDeliveryAt, serviceItems, vehicleInfo, customerInfo, billing, photoCategories, deletedMediaIds } = req.body || {};
  const billingObject = isPlainObject(billing) ? billing : {};
  const resolvedExpectedDeliveryAt = expectedDeliveryAt ?? billingObject.expectedDeliveryAt;
  const customerApproval = req.body.customer_approval
    ?? req.body.customerApproval
    ?? billingObject.customer_approval
    ?? billingObject.customerApproval;

  if (resolvedExpectedDeliveryAt !== undefined) {
    if (!isNonEmptyString(resolvedExpectedDeliveryAt)) {
      return sendValidationError(res, 'expectedDeliveryAt must be a valid date time');
    }
    const deliveryDate = new Date(resolvedExpectedDeliveryAt);
    if (Number.isNaN(deliveryDate.getTime())) {
      return sendValidationError(res, 'expectedDeliveryAt must be a valid date time');
    }
  }

  if (serviceItems !== undefined) {
    if (!Array.isArray(serviceItems)) {
      return sendValidationError(res, 'serviceItems must be an array');
    }
    for (const item of serviceItems) {
      const serviceItemId = getServiceItemId(item);
      const quantity = Number(isPlainObject(item) && item.quantity !== undefined ? item.quantity : 1);

      if (!Number.isInteger(serviceItemId) || serviceItemId <= 0) {
        return sendValidationError(res, 'Each service item must have a valid serviceItemId');
      }

      if (!Number.isInteger(quantity) || quantity <= 0) {
        return sendValidationError(res, 'Service item quantity must be a positive integer');
      }
    }
  }

  if (vehicleInfo !== undefined && !isPlainObject(vehicleInfo)) {
    return sendValidationError(res, 'vehicleInfo must be an object');
  }

  if (customerInfo !== undefined && !isPlainObject(customerInfo)) {
    return sendValidationError(res, 'customerInfo must be an object');
  }

  if (billing !== undefined) {
    if (!isPlainObject(billing)) {
      return sendValidationError(res, 'billing must be an object');
    }
    const discountValue = billing.discountAmount !== undefined ? billing.discountAmount : billing.discount;
    if (discountValue !== undefined) {
      const discountNum = Number(discountValue);
      if (Number.isNaN(discountNum) || discountNum < 0) {
        return sendValidationError(res, 'Discount amount cannot be less than zero');
      }
    }
  }

  if (photoCategories !== undefined && !Array.isArray(photoCategories)) {
    return sendValidationError(res, 'photoCategories must be an array');
  }

  if (deletedMediaIds !== undefined) {
    if (!Array.isArray(deletedMediaIds)) {
      return sendValidationError(res, 'deletedMediaIds must be an array');
    }
    for (const mid of deletedMediaIds) {
      if (!Number.isInteger(Number(mid)) || Number(mid) <= 0) {
        return sendValidationError(res, 'Each item in deletedMediaIds must be a positive integer ID');
      }
    }
  }

  if (customerApproval !== undefined && customerApproval !== null && customerApproval !== '') {
    const normalizedApproval = String(customerApproval).trim().toUpperCase();
    if (!CUSTOMER_APPROVAL_VALUES.has(normalizedApproval)) {
      return sendValidationError(res, 'customer_approval must be yes or no');
    }
  }

  const { customerComplaint, additionalNotes } = req.body || {};

  if (customerComplaint && typeof customerComplaint === 'string' && customerComplaint.length > 200) {
    return sendValidationError(res, 'customerComplaint must not exceed 200 characters');
  }

  if (additionalNotes && typeof additionalNotes === 'string' && additionalNotes.length > 200) {
    return sendValidationError(res, 'additionalNotes must not exceed 200 characters');
  }

  if (customerInfo && typeof customerInfo.address === 'string' && customerInfo.address.length > 200) {
    return sendValidationError(res, 'customer address must not exceed 200 characters');
  }

  if (billing && typeof billing.discountReason === 'string' && billing.discountReason.length > 200) {
    return sendValidationError(res, 'discountReason must not exceed 200 characters');
  }

  return next();
};

module.exports = {
  normalizeCreateJobCardPayload,
  validateIdParam,
  validateCreateJobCardPayload,
  validateUpdateJobCardPayload
};
