const twilio = require('twilio');
const env = require('./env');

let client = null;

const initializeTwilio = () => {
  const { accountSid, authToken } = env.twilio;

  if (!accountSid || !authToken) {
    console.warn('Twilio not initialized. Optional credentials are missing.');
    return null;
  }

  client = twilio(accountSid, authToken);
  return client;
};

const getTwilioClient = () => client;

module.exports = {
  initializeTwilio,
  getTwilioClient
};
