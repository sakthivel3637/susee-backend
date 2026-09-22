const env = require('../../config/env');
const AzureBlobProvider = require('./azure-blob.provider');

const createStorageProvider = () => {
  return new AzureBlobProvider(env.azureBlob);
};

module.exports = {
  createStorageProvider
};
