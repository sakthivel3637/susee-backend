const { getTwilioClient } = require('../../config/twilio');
const env = require('../../config/env');

const normalizeWhatsAppSender = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.toLowerCase().startsWith('whatsapp:') ? raw : `whatsapp:${raw}`;
};

const toTwilioProviderError = (error) => {
  if (error && error.code === 63007) {
    const providerError = new Error(
      'Twilio WhatsApp sender is not valid. Set TWILIO_WHATSAPP_FROM to whatsapp:+14155238886 for sandbox or to your approved WhatsApp sender.'
    );
    providerError.statusCode = 500;
    providerError.cause = error;
    return providerError;
  }

  return error;
};

class TwilioProvider {
  async sendWhatsAppMessage({ to, body, contentSid, contentVariables }) {
    const client = getTwilioClient();
    const from = normalizeWhatsAppSender(env.twilio.whatsappFrom);

    if (!client || !from) {
      throw new Error('Twilio WhatsApp provider is not configured.');
    }

    try {
      const messagePayload = {
        from,
        to
      };

      if (contentSid) {
        messagePayload.contentSid = contentSid;
        if (contentVariables) {
          messagePayload.contentVariables = contentVariables;
        }
      } else {
        messagePayload.body = body;
      }

      return await client.messages.create(messagePayload);
    } catch (error) {
      throw toTwilioProviderError(error);
    }
  }
}

module.exports = TwilioProvider;
