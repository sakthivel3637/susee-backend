const router = require('express').Router();
const vehicleController = require('./vehicle.controller');
const { validateIdParam, validateVehiclePayload } = require('./vehicle.validation');
const { authenticate } = require('../../common/middleware/auth.middleware');
const { permissionMiddleware } = require('../../common/middleware/permission.middleware');

const canReadVehicles = permissionMiddleware('/vehicles', 'canRead');
const canUpdateVehicles = permissionMiddleware('/vehicles', 'canUpdate');

router.use(authenticate);

router.get('/list', canReadVehicles, vehicleController.getVehicles);
router.get('/detail/:id', canReadVehicles, validateIdParam, vehicleController.getVehicle);
router.get('/history/:id', canReadVehicles, validateIdParam, vehicleController.getVehicleHistory);
router.put('/update/:id', canUpdateVehicles, validateIdParam, validateVehiclePayload, vehicleController.updateVehicle);

module.exports = router;
