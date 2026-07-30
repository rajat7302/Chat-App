const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, 
    family: 4, // Tells the underlying socket to strictly use IPv4
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS 
    },
    connectionTimeout: 10000,
    socketTimeout: 10000
});

transporter.verify((error, success) => {
    if (error) {
        console.error('❌ SMTP Connection Error:', error);
    } else {
        console.log('✅ Mailer is ready to send messages');
    }
});

async function sendResetEmail(toEmail, resetLink) {
    const mailOptions = {
        from: `"Secure Auth System" <${process.env.EMAIL_USER}>`,
        to: toEmail,
        subject: 'Password Reset Request',
        html: `
            <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
                <h2>Password Reset Request</h2>
                <p>Click the button below to change your password. This link will expire in 10 minutes.</p>
                <div style="margin: 25px 0;">
                    <a href="${resetLink}" style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">Reset My Password</a>
                </div>
                <p>Or copy this link: <a href="${resetLink}">${resetLink}</a></p>
            </div>
        `
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log('📧 Email sent successfully:', info.messageId);
        return info;
    } catch (error) {
        console.error('❌ Failed to send reset email:', error);
        throw error; 
    }
}

module.exports = { sendResetEmail };