const service = require('./mobileAdditionalWork.service');

const getList = async (req, res, next) => {
  try {
    const result = await service.getMobileList(req.query, req.user);
    res.status(200).json({
      success: true,
      message: 'Additional work list fetched successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getList
};
