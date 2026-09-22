const { createValidation } = require('../common');

const validation = createValidation([
  { name: 'serviceCenterId', type: 'int' },
  { name: 'stateId', type: 'int' },
  { name: 'districtId', type: 'int' },
  { name: 'locationName', type: 'string', minLength: 3, maxLength: 50 },
  { name: 'locationType', type: 'string' },
  { name: 'address', type: 'string', required: false, maxLength: 200 },
  { 
    name: 'pincode', 
    type: 'string', 
    required: false, 
    maxLength: 6,
    regex: /^[1-9][0-9]{5}$/,
    regexMessage: 'Pincode must be exactly 6 digits and cannot start with 0'
  },
  { name: 'kioskKey', type: 'string', required: false, maxLength: 100 }
]);

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

validation.validateIdentifierParam = (req, res, next) => {
  const identifier = String(req.params.id || '').trim();
  const numericIdentifier = Number(identifier);
  const isValidId = Number.isInteger(numericIdentifier) && numericIdentifier > 0;
  const isValidSlug = slugRegex.test(identifier);

  if (!isValidId && !isValidSlug) {
    return validation.validateIdParam(req, res, next);
  }

  return next();
};

module.exports = validation;
