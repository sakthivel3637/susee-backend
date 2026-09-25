const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const { Readable, PassThrough } = require('stream');

// Point fluent-ffmpeg to the bundled ffmpeg binary
ffmpeg.setFfmpegPath(ffmpegStatic);

/**
 * Converts a WebM audio Buffer to OGG/Opus Buffer.
 * Uses ffmpeg-static so no system-level ffmpeg install is needed.
 *
 * @param {Buffer} inputBuffer  - Raw audio buffer (any format ffmpeg supports)
 * @param {string} inputFormat  - Input format hint e.g. 'webm'
 * @returns {Promise<Buffer>}   - OGG/Opus encoded buffer
 */
const convertToOgg = (inputBuffer, inputFormat = 'webm') => {
  return new Promise((resolve, reject) => {
    const inputStream = Readable.from(inputBuffer);
    const outputStream = new PassThrough();
    const chunks = [];

    outputStream.on('data', (chunk) => chunks.push(chunk));
    outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    outputStream.on('error', reject);

    ffmpeg(inputStream)
      .inputFormat(inputFormat)
      .audioCodec('libopus')
      .format('ogg')
      .on('error', (err) => reject(new Error(`Audio conversion failed: ${err.message}`)))
      .pipe(outputStream, { end: true });
  });
};

module.exports = { convertToOgg };
