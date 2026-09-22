const { apiResponse } = require('../../common/utils/apiResponse');
const service = require('./webGateEntries.service');

const { exportToExcel } = require('../../common/utils/excel.util');

const list = async (req, res, next) => {
  try {
    const data = await service.list(req.query, req.user);
    
    if (req.query.export === 'true') {
      const columns = [
        { header: 'Vehicle Number', key: 'vehicleNumber', width: 20 },
        { header: 'Owner Name', key: 'ownerName', width: 25 },
        { header: 'Mobile', key: 'mobile', width: 18 },
        { header: 'Make & Model', key: 'makeModel', width: 25 },
        { header: 'Service Type', key: 'serviceType', width: 18 },
        { header: 'Status', key: 'status', width: 18 },
        { header: 'Entry Time', key: 'entryTime', width: 25 },
        { header: 'Entered By', key: 'entryBy', width: 20 }
      ];
      
      const formattedData = data.entries.map(e => ({
        ...e,
        entryTime: e.entryTime ? new Date(e.entryTime).toLocaleString() : ''
      }));

      return await exportToExcel(res, 'Gate_Entries', 'Gate Entries', columns, formattedData);
    }

    return apiResponse(res, {
      message: 'Gate entries fetched successfully',
      data: data.entries,
      meta: data.meta
    });
  } catch (error) {
    return next(error);
  }
};

const getBySlug = async (req, res, next) => {
  try {
    const data = await service.getBySlug(req.params.slug, req.user);
    return apiResponse(res, {
      message: 'Gate entry fetched successfully',
      data
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = { list, getBySlug };
