const { createValidation } = require('../common');

module.exports = createValidation([
  { name: 'serviceCenterName', type: 'string', minLength: 3, maxLength: 50 },
  { 
    name: 'tax', 
    type: 'string', 
    required: true,
    maxValue: 100, 
    regex: /^[0-9]+(\.[0-9]+)?$/,
    regexMessage: 'Tax must be a valid number'
  }
]);
