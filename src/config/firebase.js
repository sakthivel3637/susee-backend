const admin = require('firebase-admin');
const env = require('./env');

const initializeFirebase = () => {
  const { projectId, clientEmail, privateKey } = env.firebase;

  if (!projectId || !clientEmail || !privateKey) {
    console.warn('Firebase not initialized. Optional credentials are missing.');
    return null;
  }

  if (admin.apps.length > 0) {
    return admin.app();
  }

  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, '\n')
    })
  });
};

module.exports = {
  initializeFirebase,
  admin
};
