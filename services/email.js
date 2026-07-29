const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'kamalrajatjoshi@gmail.com',
        pass: 'yhoh qxdk djzo jzmf'
    }
});

function sendResetEmail(toEmail, resetLink) {
    const mailOptions = {
        from: '"Secure Auth System" <kamalrajatjoshi@gmail.com>',
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
    return transporter.sendMail(mailOptions);
}

module.exports = { sendResetEmail };