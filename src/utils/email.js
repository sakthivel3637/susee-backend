const nodemailer = require('nodemailer');
const env = require('../config/env');

const createTransporter = () => {
  if (!env.smtp.user || !env.smtp.pass) {
    console.warn('SMTP credentials are not fully configured in environment variables.');
  }

  const transportConfig = {
    auth: {
      user: env.smtp.user,
      pass: env.smtp.pass
    }
  };

  if (env.smtp.host && env.smtp.host.includes('gmail')) {
    transportConfig.service = 'gmail';
  } else {
    transportConfig.host = env.smtp.host;
    transportConfig.port = env.smtp.port;
    transportConfig.secure = env.smtp.port === 465;
  }

  return nodemailer.createTransport(transportConfig);
};

const sendPasswordResetEmail = async (toEmail, resetLink) => {
  const transporter = createTransporter();

  const mailOptions = {
    from: env.smtp.from || env.smtp.user, // Uses SMTP_FROM if available, otherwise defaults to the authenticated user's email
    to: toEmail,
    subject: 'Security Notice: Password Reset Request - DVSOS',
    html: `
      <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #dce6f5; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(37, 99, 235, 0.1);">
        <!-- Header -->
        <div style="background-color: #1e3a8a; padding: 30px 20px; text-align: center; color: #ffffff;">
          <div style="display: inline-block; background-color: rgba(255,255,255,0.15); padding: 12px 18px; border-radius: 12px; font-weight: bold; font-size: 24px; margin-bottom: 12px; letter-spacing: 1px;">
            DV
          </div>
          <div style="font-weight: 800; font-size: 20px; letter-spacing: 2px;">DVSOS</div>
          <div style="font-size: 13px; opacity: 0.9; margin-top: 6px; text-transform: uppercase; letter-spacing: 1px;">Security notification</div>
        </div>

        <!-- Body -->
        <div style="padding: 35px 30px;">
          <div style="display: inline-block; background-color: #eff6ff; color: #2563eb; padding: 6px 14px; border-radius: 20px; font-size: 11px; font-weight: 800; letter-spacing: 1px; margin-bottom: 24px;">
            SECURITY NOTICE
          </div>

          <h1 style="color: #1e3a8a; font-size: 28px; margin: 0 0 20px 0; font-weight: 800;">Reset your password</h1>

          <p style="color: #475569; font-size: 16px; line-height: 1.6; margin-bottom: 25px;">
            Hi there, we received a request to reset the password for your DVSOS account.
          </p>

          <div style="border: 1px solid #bfdbfe; border-radius: 10px; padding: 20px; margin-bottom: 25px; background-color: #f8faff;">
            <p style="color: #475569; font-size: 15px; margin: 0 0 15px 0; line-height: 1.6;">
              Use the button below to choose a new password. For your safety, this link expires in 15 minutes.
            </p>
            <p style="color: #1e293b; font-size: 14px; margin: 0; font-weight: 600;">
              Account: <a href="mailto:${toEmail}" style="color: #2563eb; text-decoration: underline;">${toEmail}</a>
            </p>
          </div>

          <div style="font-size: 12px; font-weight: 800; color: #1e3a8a; letter-spacing: 1.5px; margin-bottom: 12px; text-transform: uppercase;">
            What this means
          </div>

          <div style="border: 1px solid #dce6f5; border-radius: 10px; padding: 20px; margin-bottom: 35px;">
            <ul style="margin: 0; padding-left: 20px; color: #475569; font-size: 14px; line-height: 1.6;">
              <li style="margin-bottom: 12px;">Only use this link if you requested a password reset.</li>
              <li>If the link expires, return to the login screen and request a fresh reset.</li>
            </ul>
          </div>

          <div style="text-align: center;">
            <a href="${resetLink}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: bold; padding: 14px 40px; border-radius: 8px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.2);">
              Reset Password
            </a>
          </div>
        </div>
      </div>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Password reset email sent: %s', info.messageId);
    return info;
  } catch (error) {
    console.error('Error sending password reset email:', error);
    throw error;
  }
};

module.exports = {
  sendPasswordResetEmail
};
