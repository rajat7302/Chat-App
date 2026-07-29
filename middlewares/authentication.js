const {validateToken} = require('../services/authentication');

function checkForAuthenticationCookie(cookieName){
    return (req, res, next) =>{
        const tokenCookieValue = req.cookies?.[cookieName];

        if (!tokenCookieValue){
            req.user = null;
            return next();
        }
        try{
            const userPayLoad = validateToken(tokenCookieValue);
            req.user = userPayLoad;
        } catch(error){
            req.user = null;
        }
        return next();
    };
}
function restrictToLoggedinUserOnly(req, res, next) {
    if (!req.user) {
        return res.redirect("/user/signin"); 
    }
    next(); 
}

function restrictToAdmin(req, res, next){
    if (!req.user || req.user.role != 'admin'){
        return res.status(403).send("Acess Denied : Admins Only");
    }
    next();
}
module.exports = { 
    checkForAuthenticationCookie, 
    restrictToLoggedinUserOnly, restrictToAdmin
};