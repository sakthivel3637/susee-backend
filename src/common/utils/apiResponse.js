const apiResponse = (
  res,
  {
    statusCode = 200,
    success = true,
    message = 'Success',
    data = {},
    meta = {}
  } = {}
) => {
  return res.status(statusCode).json({
    success,
    message,
    data,
    meta
  });
};

module.exports = {
  apiResponse
};
