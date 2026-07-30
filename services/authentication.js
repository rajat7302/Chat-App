const JWT = require('jsonwebtoken');

const secret = process.env.JWT_SECRET || "default_fallback_jwt_secret_dev_only";

function createTokenForUser(user) {
    const payload = {
        _id: user._id,
        email: user.email,
        fullName: user.fullName,
        username: user.username,
        profileImage: user.profileImage,
        role: user.role
    };
    
    const token = JWT.sign(payload, secret, { expiresIn: '7d' });
    return token;
}

function validateToken(token) {
    const payload = JWT.verify(token, secret);
    return payload;
}

module.exports = {
    createTokenForUser,
    validateToken
};