const JWT = require('jsonwebtoken');
const {create} = require('../models/user');

const secret = "@#Rajat&%@^@&1234";
function createTokenForUser(user){
    const payload = {
      _id: user._id,
        email: user.email,
        fullName: user.fullName,
        username: user.username,
        profileImage: user.profileImage,
        role : user.role
    }
    const token = JWT.sign(payload, secret);
    return token;
}
function validateToken(token){
    const payload = JWT.verify(token, secret);
    return payload;
}
module.exports = {createTokenForUser, validateToken};