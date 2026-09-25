const { 
  BlobServiceClient, 
  generateBlobSASQueryParameters, 
  BlobSASPermissions, 
  StorageSharedKeyCredential 
} = require('@azure/storage-blob');
const fs = require('fs/promises');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { convertToOgg } = require('../../utils/audio-convert');

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

  async uploadBuffer(fileBuffer, options = {}) {
    if (!this.isConfigured) {
      throw new Error('Azure Blob storage provider is not configured.');
    }

    const extension = options.extension || (options.originalName ? path.extname(options.originalName) : '.webm');
    const uniqueName = uuidv4() + extension;
    const blobName = options.folder ? `${options.folder}/${uniqueName}` : uniqueName;

    const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);

    const mimeType = options.mimeType || 'audio/webm';
    const blobOptions = {
      blobHTTPHeaders: {
        blobContentType: mimeType
      }
    };

    await blockBlobClient.uploadData(fileBuffer, blobOptions);

    return {
      secure_url: blockBlobClient.url,
      url: blockBlobClient.url,
      public_id: blobName,
      format: extension.replace('.', '') || null,
      bytes: fileBuffer.length
    };
  }

  async uploadDataUrl(dataUrl, folder = 'voice-notes') {
    if (!this.isConfigured || !dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      return dataUrl || null;
    }

    try {
      const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) return dataUrl;

      const rawMimeType = matches[1];
      const base64Data = matches[2];

      // Browser records as audio/webm;codecs=opus — Twilio WhatsApp does NOT support webm.
      // Twilio supports: MP3, OGG/Opus, AMR, 3GP, AAC, MPEG.
      // Store webm/opus as audio/ogg with .ogg extension so Twilio can deliver it.
      let mimeType = rawMimeType;
      let extension = '.ogg';
      let buffer = Buffer.from(base64Data, 'base64');

      if (rawMimeType.includes('mp3')) {
        mimeType = 'audio/mpeg'; extension = '.mp3';
      } else if (rawMimeType.includes('wav')) {
        mimeType = 'audio/wav'; extension = '.wav';
      } else if (rawMimeType.includes('m4a') || rawMimeType.includes('mp4')) {
        mimeType = 'audio/mp4'; extension = '.m4a';
      } else if (rawMimeType.includes('ogg')) {
        mimeType = 'audio/ogg'; extension = '.ogg';
      } else if (rawMimeType.includes('webm')) {
        // Browser records as audio/webm;codecs=opus
        // Twilio WhatsApp requires OGG/Opus — do a real conversion using ffmpeg
        try {
          buffer = await convertToOgg(buffer, 'webm');
          mimeType = 'audio/ogg';
          extension = '.ogg';
          console.log('[Audio] Successfully converted WebM → OGG/Opus for WhatsApp delivery');
        } catch (convErr) {
          console.warn('[Audio] WebM→OGG conversion failed, uploading as-is:', convErr.message);
          mimeType = 'audio/ogg';
          extension = '.ogg';
        }
      }

      const result = await this.uploadBuffer(buffer, {
        folder,
        mimeType,
        extension
      });

      if (!result) return dataUrl;

      try {
        return this.generateSasUrl(result.public_id, 86400 * 30);
      } catch (sasError) {
        return result.url;
      }
    } catch (error) {
      console.error('Failed to upload data URL to Azure Blob Storage:', error);
      return dataUrl;
    }
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
