const twilio = require('twilio');
const env = require('../../config/env');
const TwilioProvider = require('./twilio.provider');

const provider = new TwilioProvider();

const toTrimmedString = (value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const normalizeIndianWhatsAppNumber = (value) => {
  const raw = toTrimmedString(value);
  const withoutPrefix = raw.replace(/^whatsapp:/i, '');
  const digits = withoutPrefix.replace(/\D/g, '');
  const normalizedDigits = digits.length > 10 && digits.startsWith('91')
    ? digits.slice(-10)
    : digits;

  if (!/^[6-9]\d{9}$/.test(normalizedDigits)) {
    const error = new Error('Valid customer WhatsApp mobile number is required');
    error.statusCode = 400;
    throw error;
  }

  return `whatsapp:+91${normalizedDigits}`;
};

const normalizeWhatsAppSender = (value) => {
  const raw = toTrimmedString(value);
  if (!raw) return '';
  return raw.toLowerCase().startsWith('whatsapp:') ? raw : `whatsapp:${raw}`;
};

const formatCurrency = (value) => {
  const amount = Number(value || 0);
  return `Rs. ${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })}`;
};

const ensureTwilioConfigured = () => {
  if (!env.twilio.accountSid || !env.twilio.authToken || !env.twilio.whatsappFrom) {
    const error = new Error('Twilio WhatsApp provider is not configured');
    error.statusCode = 500;
    throw error;
  }
};

const sendWhatsAppMessage = async ({ to, body, contentSid, contentVariables, mediaUrl }) => {
  ensureTwilioConfigured();

  return provider.sendWhatsAppMessage({
    to: normalizeIndianWhatsAppNumber(to),
    body,
    contentSid,
    contentVariables,
    mediaUrl
  });
};

const sendWhatsAppVoiceNote = async ({ to, audioUrl, caption }) => {
  if (!audioUrl) {
    const error = new Error('Audio URL is required to send WhatsApp voice note');
    error.statusCode = 400;
    throw error;
  }

  return sendWhatsAppMessage({
    to,
    body: caption || '',
    mediaUrl: [audioUrl]
  });
};

const buildAdditionalWorkApprovalMessage = ({ jobCard, approval, services, explanation, voiceNoteUrl }) => {
  const customerName = jobCard.customer?.fullName || 'Customer';
  const vehicleNo = jobCard.vehicle?.registrationNo || 'your vehicle';
  const serviceLines = services.map((service, index) => {
    const lineTotal = Number(service.price || 0) * Number(service.quantity || 1);
    return `${index + 1}. ${service.serviceName} x${service.quantity || 1} - ${formatCurrency(lineTotal)}`;
  });

  return [
    `Hello ${customerName}, additional work approval is required for ${vehicleNo}.`,
    '',
    `Job Card: ${jobCard.jobCardNo}`,
    `Approval Code: ${approval.approvalCode}`,
    '',
    'Additional work:',
    ...serviceLines,
    '',
    `Total: ${formatCurrency(approval.totalAmount)}`,
    explanation ? `Mechanic explanation: ${explanation}` : null,
    voiceNoteUrl ? `Voice Note: ${voiceNoteUrl}` : null,
    '',
    `Reply YES ${approval.approvalCode} to approve or NO ${approval.approvalCode} to reject.`
  ].filter(Boolean).join('\n');
};

const sendAdditionalWorkApproval = async ({ jobCard, approval, services, explanation, voiceNoteUrl, mediaUrl }) => {
  const resolvedVoiceNoteUrl = voiceNoteUrl || (Array.isArray(mediaUrl) ? mediaUrl[0] : mediaUrl) || null;
  const customerName = jobCard.customer?.fullName || 'Customer';
  const vehicleNo = jobCard.vehicle?.registrationNo || 'your vehicle';
  const serviceLines = services.map((service, index) => {
    const lineTotal = Number(service.price || 0) * Number(service.quantity || 1);
    return `${index + 1}. ${service.serviceName} x${service.quantity || 1} - ${formatCurrency(lineTotal)}`;
  });

  const contentSid = env.twilio.whatsappContentSid || null;

  let messagePayload;
  if (contentSid) {
    // Use interactive template with Approve / Reject buttons
    const contentVariables = JSON.stringify({
      '1': customerName,
      '2': vehicleNo,
      '3': jobCard.jobCardNo,
      '4': approval.approvalCode,
      '5': serviceLines.join('\n'),
      '6': formatCurrency(approval.totalAmount)
    });
    messagePayload = {
      to: jobCard.customer?.mobileNo,
      body: buildAdditionalWorkApprovalMessage({ jobCard, approval, services, explanation }),
      contentSid,
      contentVariables
    };
  } else {
    // Fallback: plain text message with reply instructions
    messagePayload = {
      to: jobCard.customer?.mobileNo,
      body: buildAdditionalWorkApprovalMessage({ jobCard, approval, services, explanation })
    };
  }

  const textResult = await sendWhatsAppMessage(messagePayload);

  // Send voice note as a separate media message if available
  if (resolvedVoiceNoteUrl && typeof resolvedVoiceNoteUrl === 'string' && resolvedVoiceNoteUrl.startsWith('https://')) {
    try {
      await sendWhatsAppMessage({
        to: jobCard.customer?.mobileNo,
        body: 'Mechanic voice note:',
        mediaUrl: [resolvedVoiceNoteUrl]
      });
    } catch (mediaError) {
      console.warn('[WhatsApp] Voice note media send failed (message still delivered):', mediaError?.message || mediaError);
    }
  }

  return textResult;
};

const validateTwilioRequest = (req) => {
  if (!env.twilio.authToken) {
    return false;
  }

  const signature = req.headers['x-twilio-signature'];
  if (!signature) {
    return false;
  }

  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const url = `${protocol}://${host}${req.originalUrl}`;

  return twilio.validateRequest(env.twilio.authToken, signature, url, req.body || {});
};

module.exports = {
  normalizeIndianWhatsAppNumber,
  normalizeWhatsAppSender,
  sendWhatsAppMessage,
  sendWhatsAppVoiceNote,
  sendAdditionalWorkApproval,
  validateTwilioRequest
};
