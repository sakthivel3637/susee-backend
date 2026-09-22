const router = require('express').Router();

const prisma = require('../../config/db');
const { apiResponse } = require('../../common/utils/apiResponse');
const { authenticate } = require('../../common/middleware/auth.middleware');
const { permissionMiddleware } = require('../../common/middleware/permission.middleware');

const canReadSchedules = permissionMiddleware('/md-stage-schedules', 'canRead');

router.get('/modules', authenticate, canReadSchedules, async (req, res, next) => {
  try {
    const modules = await prisma.module.findMany({
      where: { isActive: true },
      select: { id: true, moduleName: true, moduleCode: true, slug: true },
      orderBy: { moduleName: 'asc' }
    });

    return apiResponse(res, { message: 'Modules fetched successfully', data: { modules } });
  } catch (error) {
    return next(error);
  }
});

router.get('/statuses', authenticate, canReadSchedules, async (req, res, next) => {
  try {
    const moduleId = Number(req.query.moduleId);

    if (!Number.isInteger(moduleId) || moduleId <= 0) {
      return apiResponse(res, {
        statusCode: 400,
        success: false,
        message: 'moduleId is required',
        data: {},
        meta: {}
      });
    }

    const statuses = await prisma.statusMaster.findMany({
      where: { moduleId, isActive: true },
      select: {
        id: true,
        moduleId: true,
        statusCode: true,
        statusName: true,
        slug: true,
        sortOrder: true
      },
      orderBy: [{ sortOrder: 'asc' }, { statusName: 'asc' }]
    });

    return apiResponse(res, { message: 'Statuses fetched successfully', data: { statuses } });
  } catch (error) {
    return next(error);
  }
});

router.get('/locations', authenticate, canReadSchedules, async (req, res, next) => {
  try {
    const locations = await prisma.location.findMany({
      where: {
        isActive: true,
        ...(req.user.locationId ? { id: Number(req.user.locationId) } : {})
      },
      select: { id: true, locationName: true, locationCode: true },
      orderBy: { locationName: 'asc' }
    });

    return apiResponse(res, { message: 'Locations fetched successfully', data: { locations } });
  } catch (error) {
    return next(error);
  }
});

router.get('/roles', authenticate, canReadSchedules, async (req, res, next) => {
  try {
    const roles = await prisma.role.findMany({
      where: { isActive: true },
      select: { id: true, name: true, slug: true },
      orderBy: { name: 'asc' }
    });

    return apiResponse(res, { message: 'Roles fetched successfully', data: { roles } });
  } catch (error) {
    return next(error);
  }
});

router.get('/users', authenticate, canReadSchedules, async (req, res, next) => {
  try {
    const isActive = req.query.isActive === undefined || req.query.isActive === ''
      ? true
      : req.query.isActive === 'true' || req.query.isActive === true;

    const users = await prisma.user.findMany({
      where: {
        isActive,
        ...(req.user.locationId ? { locationId: Number(req.user.locationId) } : {})
      },
      select: {
        id: true,
        fullName: true,
        emailId: true,
        mobileNo: true,
        role: { select: { id: true, name: true, slug: true } },
        location: { select: { id: true, locationName: true } }
      },
      orderBy: { fullName: 'asc' }
    });

    return apiResponse(res, { message: 'Users fetched successfully', data: { users } });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
