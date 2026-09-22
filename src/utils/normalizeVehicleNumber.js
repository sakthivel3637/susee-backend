const normalizeVehicleNumber = (vehicleNumber) => {
  return String(vehicleNumber || '')
    .trim()
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
};

module.exports = {
  normalizeVehicleNumber
};
