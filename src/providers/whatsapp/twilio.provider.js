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
  async sendWhatsAppMessage({ to, body, contentSid, contentVariables, mediaUrl }) {
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

      if (mediaUrl) {
        const urls = Array.isArray(mediaUrl) ? mediaUrl : [mediaUrl];
        const validUrls = urls.map((u) => String(u || '').trim()).filter(Boolean);
        if (validUrls.length > 0) {
          messagePayload.mediaUrl = validUrls;
        }
      }

      // Always try contentSid template first if provided (buttons, formatted message)
      if (contentSid) {
        try {
          return await client.messages.create({
            ...messagePayload,
            contentSid,
            ...(contentVariables ? { contentVariables } : {})
          });
        } catch (templateError) {
          console.warn('[WhatsApp] contentSid template failed, falling back to body text:', templateError?.message || templateError);
        }
      }

      if (body) {
        messagePayload.body = body;
      }

      return await client.messages.create(messagePayload);
    } catch (error) {
      throw toTwilioProviderError(error);
    }
  }
}

module.exports = TwilioProvider;
