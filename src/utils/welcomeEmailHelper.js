const crypto = require('crypto');
const nodemailer = require('nodemailer');


function generateRandomPassword(length = 8) {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+";
    const specialChars = "!@#$%^&*()_+";

    let password = "";
    password += specialChars[crypto.randomInt(0, specialChars.length)];

    for (let i = 1; i < length; i++) {
        password += chars[crypto.randomInt(0, chars.length)];
    }

    const passwordArray = password.split('');
    for (let i = passwordArray.length - 1; i > 0; i--) {
        const j = crypto.randomInt(0, i + 1);
        [passwordArray[i], passwordArray[j]] = [passwordArray[j], passwordArray[i]];
    }

    return passwordArray.join('');
}


async function sendWelcomeEmail(userEmail, randomPassword) {
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.example.com',
        port: process.env.SMTP_PORT || 587,
        secure: false,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });

    const htmlTemplate = `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: 'Inter', system-ui, -apple-system, sans-serif; background-color: #f0f4ff; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 14px; box-shadow: 0 4px 16px rgba(37, 99, 235, 0.1), 0 2px 4px rgba(0, 0, 0, 0.06); overflow: hidden; }
            .header { background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%); color: #ffffff; text-align: center; padding: 30px 20px; }
            .content { padding: 30px; color: #1e293b; line-height: 1.6; }
            .password-box { background-color: #eff6ff; border: 1px dashed #3b82f6; border-radius: 8px; padding: 20px; font-size: 24px; font-family: monospace; font-weight: bold; color: #1e3a8a; letter-spacing: 4px; text-align: center; margin: 25px 0; }
            .footer { text-align: center; font-size: 13px; color: #475569; padding: 20px; background-color: #f8faff; border-top: 1px solid #dce6f5; }
            .project-name { font-weight: bold; color: #2563eb; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1 style="margin: 0; font-size: 24px;">Welcome to DVSOS!</h1>
            </div>
            <div class="content">
                <p>Hello,</p>
                <p>An administrator has successfully created your account for the <span class="project-name">Digital Vehicle Service Operations System (DVSOS)</span>.</p>
                <p>We have auto-generated a temporary password for you to log in securely.</p>
                <div class="password-box">
                    ${randomPassword}
                </div>
                <p>For your security, we strongly recommend that you change this password immediately after your first login.</p>
            </div>
            <div class="footer">
                <p>If you did not expect this email, please contact support.</p>
                <p>&copy; ${new Date().getFullYear()} DVSOS. All rights reserved.</p>
            </div>
        </div>
    </body>
    </html>
    `;

    const mailOptions = {
        from: '"Your Platform" <no-reply@yourplatform.com>',
        to: userEmail,
        subject: 'Your New Account Details - Login Inside',
        html: htmlTemplate
    };

    try {
        let info = await transporter.sendMail(mailOptions);
        console.log('Password email sent successfully: %s', info.messageId);
        return info;
    } catch (error) {
        console.error('Error sending password email: ', error);
        throw error;
    }
}

module.exports = {
    generateRandomPassword,
    sendWelcomeEmail
};
