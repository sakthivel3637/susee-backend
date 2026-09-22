const { admin } = require('../../config/firebase');

class FirebaseProvider {
  async sendPushMessage(message) {
    if (!admin.apps.length) {
      throw new Error('Firebase provider is not configured.');
    }

    return admin.messaging().send(message);
  }
}

module.exports = FirebaseProvider;
