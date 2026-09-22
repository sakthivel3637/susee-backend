const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');

const uploadDir = path.join(os.tmpdir(), 'dvsos-job-card-photos');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    const safeName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`;
    cb(null, safeName);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

  if (!allowedTypes.includes(file.mimetype)) {
    return cb(new Error('Only JPEG, PNG, and WEBP images are allowed'));
  }

  return cb(null, true);
};

const uploadVehiclePhotos = multer({
  storage,
  fileFilter,
  limits: {
    files: 20,
    fileSize: 5 * 1024 * 1024
  }
}).any();

module.exports = {
  uploadVehiclePhotos
};
