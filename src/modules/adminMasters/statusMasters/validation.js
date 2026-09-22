const { createValidation } = require('../common');

module.exports = createValidation([
  { name: 'moduleId', type: 'int' },
  { name: 'statusName', type: 'string', maxLength: 100 }
]);
