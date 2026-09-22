const { apiResponse } = require('../../common/utils/apiResponse');
const service = require('./mobileGateEntry.service');

const checkVehicle = async (req, res, next) => {
  try {
    const data = await service.checkVehicle(req.query, req.user);
    return apiResponse(res, {
      message: 'Vehicle lookup completed successfully',
      data
    });
  } catch (error) {
    return next(error);
  }
};

const createGateEntry = async (req, res, next) => {
  try {
    const data = await service.createGateEntry(req.body, req.user);
    return apiResponse(res, {
      statusCode: data.isCreated ? 201 : 200,
      message: data.message || 'Gate entry created successfully',
      data
    });
  } catch (error) {
    return next(error);
  }
};

const submitExit = async (req, res, next) => {
  try {
    const data = await service.submitExit(req.params.id, req.body, req.user);
    return apiResponse(res, {
      message: 'Gate entry exit submitted successfully',
      data
    });
  } catch (error) {
    return next(error);
  }
};

const history = async (req, res, next) => {
  try {
    const { entries, records, groups, summary, filters, meta } = await service.history(req.query, req.user);
    return apiResponse(res, {
      message: 'Gate entry history fetched successfully',
      data: {
        entries,
        records,
        groups,
        summary,
        filters
      },
      meta
    });
  } catch (error) {
    return next(error);
  }
};

const activeByVehicle = async (req, res, next) => {
  try {
    const data = await service.activeByVehicle(req.query, req.user);
    return apiResponse(res, {
      message: 'Active gate entry fetched successfully',
      data
    });
  } catch (error) {
    return next(error);
  }
};

const pendingCrmEntries = async (req, res, next) => {
  try {
    const { entries, meta } = await service.pendingCrmEntries(req.query, req.user);
    return apiResponse(res, {
      message: 'Pending gate entries fetched successfully',
      data: { entries },
      meta
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  checkVehicle,
  createGateEntry,
  submitExit,
  history,
  activeByVehicle,
  pendingCrmEntries
};
