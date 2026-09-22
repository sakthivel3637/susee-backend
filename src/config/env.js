const dotenv = require('dotenv');

dotenv.config();

if (!process.env.DATABASE_URL && process.env.MSSERVER_URI) {
  process.env.DATABASE_URL = process.env.MSSERVER_URI;
}

const DEFAULT_TWILIO_WHATSAPP_FROM = 'whatsapp:+14155238886';
const toTrimmedEnv = (value) => String(value || '').trim();
const normalizeWhatsAppSender = (value) => {
  const raw = toTrimmedEnv(value);
  if (!raw) return '';
  return raw.toLowerCase().startsWith('whatsapp:') ? raw : `whatsapp:${raw}`;
};

const twilioAccountSid = toTrimmedEnv(process.env.TWILIO_ACCOUNT_SID) || toTrimmedEnv(process.env.AccountSID);
const twilioAuthToken = toTrimmedEnv(process.env.TWILIO_AUTH_TOKEN) || toTrimmedEnv(process.env.AuthToken);
const configuredWhatsappFrom = toTrimmedEnv(process.env.TWILIO_WHATSAPP_FROM);
const legacyWhatsappFrom = toTrimmedEnv(process.env.Twiliophonenumber).toLowerCase().startsWith('whatsapp:')
  ? toTrimmedEnv(process.env.Twiliophonenumber)
  : '';
const twilioWhatsappFrom = normalizeWhatsAppSender(configuredWhatsappFrom || legacyWhatsappFrom || DEFAULT_TWILIO_WHATSAPP_FROM);

const requiredEnv = ['DATABASE_URL', 'JWT_SECRET'];

const missingRequiredEnv = requiredEnv.filter((key) => !process.env[key]);

if (missingRequiredEnv.length > 0) {
  throw new Error(`Missing required environment variables: ${missingRequiredEnv.join(', ')}`);
}

const optionalGroups = [
  {
    name: 'Azure Blob Storage',
    keys: ['AZURE_STORAGE_CONNECTION_STRING', 'AZURE_STORAGE_CONTAINER']
  },
  {
    name: 'Firebase',
    keys: ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']
  }
];

optionalGroups.forEach((group) => {
  const missing = group.keys.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.warn(`${group.name} optional config missing: ${missing.join(', ')}`);
  }
});

const missingTwilio = [
  !twilioAccountSid && 'TWILIO_ACCOUNT_SID',
  !twilioAuthToken && 'TWILIO_AUTH_TOKEN',
  !twilioWhatsappFrom && 'TWILIO_WHATSAPP_FROM'
].filter(Boolean);

if (missingTwilio.length > 0) {
  console.warn(`Twilio optional config missing: ${missingTwilio.join(', ')}`);
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 5000),
  appName: process.env.APP_NAME || 'DVSOS Backend',
  apiPrefix: process.env.API_PREFIX || '/api',
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  storageProvider: process.env.STORAGE_PROVIDER || 'azure',
  azureBlob: {
    connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
    container: process.env.AZURE_STORAGE_CONTAINER
  },
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY
  },
  twilio: {
    accountSid: twilioAccountSid,
    authToken: twilioAuthToken,
    whatsappFrom: twilioWhatsappFrom
  },
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || 'noreply@dvsos.com'
  },
  frontendUrl: process.env.FRONTEND_URL
};
