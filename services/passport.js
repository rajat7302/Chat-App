const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/user');

const baseUrl = process.env.CALLBACK_URL || `http://localhost:${process.env.PORT || 8080}`;

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${baseUrl}/auth/google/callback`
},
async (accessToken, refreshToken, profile, done) => {
    try {
        const userEmail = profile.emails[0].value;
        let user = await User.findOne({ email: userEmail });
        
        if (!user) {
            const baseUsername = userEmail.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
            let uniqueUsername = baseUsername;
            let userExists = await User.findOne({ username: uniqueUsername });

            while (userExists) {
                const randomSuffix = Math.floor(1000 + Math.random() * 9000);
                uniqueUsername = `${baseUsername}${randomSuffix}`;
                userExists = await User.findOne({ username: uniqueUsername });
            }

            user = await User.create({
                fullName: profile.displayName,
                username: uniqueUsername, 
                email: userEmail,
                password: `GOOGLE_AUTH_${Date.now()}`
            });
        }
        return done(null, user);
    } catch (err) {
        return done(err, null);
    }
}
));

module.exports = passport;