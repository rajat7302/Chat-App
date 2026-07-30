const passport = require('passport');
const express = require('express');
const {createTokenForUser} = require('../services/authentication');
const router = express.Router();

router.get('/google', passport.authenticate(
'google', {scope : ['profile', 'email']}
));

router.get('/google/callback', passport.authenticate('google', {failureRedirect : '/user/signin', session : false}),
(req, res)=>{
    const token = createTokenForUser(req.user);
    return res.cookie('token', token, {
        httpOnly : true,
        secure : process.env.NODE_ENV === 'production',
        sameSite : 'lax'
    }).redirect('/'); 
});

module.exports = router;