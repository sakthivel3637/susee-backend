const { 
  BlobServiceClient, 
  generateBlobSASQueryParameters, 
  BlobSASPermissions, 
  StorageSharedKeyCredential 
} = require('@azure/storage-blob');
const fs = require('fs/promises');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class AzureBlobProvider {
  constructor(config) {
    this.config = config;
    this.isConfigured = Boolean(config.connectionString && config.container);

    if (!this.isConfigured) {
      console.warn('Azure Blob storage provider is not configured yet.');
      return;
    }

    this.blobServiceClient = BlobServiceClient.fromConnectionString(config.connectionString);
    this.containerClient = this.blobServiceClient.getContainerClient(config.container);

    // Extract AccountName and AccountKey for offline SAS token generation
    const connStr = config.connectionString;
    const accountNameMatch = connStr.match(/AccountName=([^;]+)/);
    const accountKeyMatch = connStr.match(/AccountKey=([^;]+)/);
    this.accountName = accountNameMatch ? accountNameMatch[1] : null;
    this.accountKey = accountKeyMatch ? accountKeyMatch[1] : null;
  }

  async upload(filePath, options = {}) {
    if (!this.isConfigured) {
      throw new Error('Azure Blob storage provider is not configured.');
    }

    const extension = options.originalName ? path.extname(options.originalName) : path.extname(filePath);
    const uniqueName = uuidv4() + extension;
    const blobName = options.folder ? `${options.folder}/${uniqueName}` : uniqueName;

    const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);

    const mimeType = options.mimeType || 'application/octet-stream';
    const blobOptions = {
      blobHTTPHeaders: {
        blobContentType: mimeType
      }
    };

    const fileBuffer = await fs.readFile(filePath);
    await blockBlobClient.uploadData(fileBuffer, blobOptions);
    
    const size = options.size || fileBuffer.length;

    return {
      secure_url: blockBlobClient.url,
      url: blockBlobClient.url,
      public_id: blobName,
      format: extension.replace('.', '') || null,
      bytes: size
    };
  }

  async delete(publicId, options = {}) {
    if (!this.isConfigured) {
      throw new Error('Azure Blob storage provider is not configured.');
    }

    const blockBlobClient = this.containerClient.getBlockBlobClient(publicId);
    await blockBlobClient.deleteIfExists();
    return { result: 'ok' };
  }

  generateSasUrl(blobName, expiresAfterSeconds = 3600) {
    if (!this.isConfigured) {
      throw new Error('Azure Blob storage provider is not configured.');
    }
    if (!this.accountName || !this.accountKey) {
      throw new Error('Azure Storage Account credentials could not be parsed from connection string.');
    }

    const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
    const credential = new StorageSharedKeyCredential(this.accountName, this.accountKey);
    
    const sasToken = generateBlobSASQueryParameters({
      containerName: this.config.container,
      blobName: blobName,
      permissions: BlobSASPermissions.parse('r'),
      startsOn: new Date(new Date().valueOf() - 5 * 60 * 1000), // Subtract 5 minutes for clock skew
      expiresOn: new Date(new Date().valueOf() + expiresAfterSeconds * 1000)
    }, credential).toString();

    return `${blockBlobClient.url}?${sasToken}`;
  }
}

module.exports = AzureBlobProvider;
