require('dotenv').config();
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendResetEmail(toEmail, resetLink) {
    try {
        const data = await resend.emails.send({
            from: 'Acme <onboarding@resend.dev>', // Resend's default testing address
            to: [toEmail],
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
        });
        
        console.log('✅ Email sent successfully via Resend:', data.id);
        return data;
    } catch (error) {
        console.error('❌ Failed to send reset email:', error);
        throw error;
    }
}

module.exports = { sendResetEmail };