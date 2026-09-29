const mobileAssignMechanicService = require('./mobileAssignMechanic.service');

const getMobileList = async (req, res, next) => {
  try {
    const result = await mobileAssignMechanicService.getMobileList(req.query, req.user);
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

const assignWork = async (req, res, next) => {
  try {
    const result = await mobileAssignMechanicService.assignWork(req.params.jobCardId, req.body, req.user);
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

const skipDepartment = async (req, res, next) => {
  try {
    if (!req.body.reason) {
      return res.status(400).json({ success: false, message: 'Reason is required to skip a department' });
    }
    const result = await mobileAssignMechanicService.skipDepartment(req.params.jobCardId, req.params.department, req.body.reason, req.user);
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getMobileList,
  assignWork,
  skipDepartment
};
