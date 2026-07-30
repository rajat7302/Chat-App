const { Router } = require('express');
const router = Router();
const User = require('../models/user');
const Message = require('../models/Message'); 
const { createTokenForUser } = require("../services/authentication");
const { sendResetEmail } = require('../services/email');
const { randomBytes } = require('crypto');
const Report = require('../models/report');
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const bcrypt = require('bcrypt');
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const avatarStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'chat_app_avatars',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
        transformation: [{ width: 500, height: 500, crop: 'limit' }]
    }
});

const mediaStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req, file) => {
        let resourceType = 'raw';
        const fileExtension = file.originalname.split('.').pop().toLowerCase();

        if (file.mimetype.startsWith('image/')) {
            resourceType = 'image';
        } else if (file.mimetype.startsWith('video/')) {
            resourceType = 'video';
        }

        const cleanName = file.originalname.substring(0, file.originalname.lastIndexOf('.')).replace(/[^a-zA-Z0-9_-]/g, '_');
        const publicId = `${Date.now()}-${cleanName}`;

        const storageParams = {
            folder: 'chat_app_media',
            resource_type: resourceType,
            public_id: publicId
        };

        if (resourceType !== 'raw') {
            storageParams.format = fileExtension;
        }

        return storageParams;
    }
});

const uploadAvatar = multer({ 
    storage: avatarStorage,
    limits: { fileSize: 5 * 1024 * 1024 } 
});

const uploadMedia = multer({ 
    storage: mediaStorage,
    limits: { fileSize: 25 * 1024 * 1024 } 
});

const signInLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 5, 
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        return res.status(429).render('signin', { 
            error: "Too many failed login attempts. Please try again after 15 minutes." 
        });
    }
});

router.get('/signin', (req, res) => {
    try {
        return res.render('signin');
    } catch (err) {
        return res.status(500).send("Internal Server Error");
    }
});

router.get('/signup', (req, res) => {
    try {
        return res.render('signup');
    } catch (err) {
        return res.status(500).send("Internal Server Error");
    }
});

router.post('/signup', async (req, res) => {
    try {
        const { fullName, email, username, password } = req.body;

        if (!fullName || !email || !username || !password) {
            return res.render('signup', { error: "All fields are required." });
        }

        const cleanEmail = email.trim().toLowerCase();
        const cleanUsername = username.replace(/^@+/, '').trim().toLowerCase();

        await User.create({ 
            fullName: fullName.trim(), 
            email: cleanEmail, 
            username: cleanUsername, 
            password,
            role: 'user'
        });

        return res.redirect('/user/signin');
    } catch (err) {
        console.error("[SIGNUP ERROR]", err);

        if (err.code === 11000) {
            const duplicateField = Object.keys(err.keyPattern || err.keyValue || {})[0] || 'field';
            const fieldLabel = duplicateField === 'email' ? 'Email' : 'Username';
            return res.render('signup', { error: `That ${fieldLabel} is already registered.` });
        }

        return res.render('signup', { error: err.message || "Registration failed. Please try again." });
    }
});

router.post('/signin', signInLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.render('signin', { error: "Please enter both email/username and password." });
        }

        const loginIdentifier = email.replace(/^@+/, '').trim().toLowerCase();
        const user = await User.matchPassword(loginIdentifier, password);
        
        if (user.isBanned) {
            return res.render('signin', { 
                error: `Your account has been banned. Reason: ${user.banReason || 'Violation of terms.'}` 
            });
        }

        const token = createTokenForUser(user);
        
        return res.cookie('token', token, {
            httpOnly: true,
            secure: false,
        }).redirect('/');

    } catch (err) {
        return res.render('signin', { error: err.message });
    }
});

router.get('/logout', (req, res) => {
    res.clearCookie('token').redirect('/');
});

router.get('/forgot-password', (req, res) => {
    return res.render('forgot-password');
});

router.get('/reset-password/:token', async (req, res) => {
    try {
        const user = await User.findOne({
            resetPasswordToken: req.params.token,
            resetPasswordExpires: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).send("Reset Link is invalid or has expired.");
        }

        return res.render('reset-password', { token: req.params.token });
    } catch (err) {
        console.error("GET Reset-Password Error:", err);
        return res.status(500).send(`Server Error: ${err.message}`);
    }
});

router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).send("Email is required.");

        const cleanEmail = email.trim().toLowerCase();
        const user = await User.findOne({ email: cleanEmail });
        if (!user) return res.status(404).send("No account found with that email.");
        
        const token = randomBytes(20).toString('hex');
        user.resetPasswordToken = token;
        user.resetPasswordExpires = Date.now() + 600000;
        await user.save();
        
        const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
        const resetLink = `${BASE_URL}/user/reset-password/${token}`;
        await sendResetEmail(cleanEmail, resetLink);
        
        return res.send("Check your email inbox or spam folder! Reset link sent.");
    } catch (err) {
        console.error(err);
        return res.status(500).send("Server Error");
    }
});

router.post('/reset-password/:token', async (req, res) => {
    try {
        const { password } = req.body;

        // Strong password regex: 
        // At least 8 characters, 1 uppercase, 1 lowercase, 1 number, and 1 special character
        const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

        if (!password || !strongPasswordRegex.test(password)) {
            return res.status(400).send(
                "Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&)."
            );
        }

        // Find valid user with active token
        const user = await User.findOne({
            resetPasswordToken: req.params.token,
            resetPasswordExpires: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).send("Reset Link is invalid or has expired.");
        }

        // Hash and save new password
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(password, salt);

        // Invalidate token
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();
        
        return res.send("Password reset successful! You can now log in.");
    } catch (err) {
        console.error("Reset Password Error:", err);
        return res.status(500).send("Server Error");
    }
});

router.post('/profile/update', uploadAvatar.single('profileImage'), async (req, res) => {
    try {
        const { fullName, username, bio } = req.body;
        const userId = req.user?._id;

        if (!userId) return res.status(401).send("Unauthorized");

        const currentUser = await User.findById(userId);
        if (!currentUser) {
            return res.status(404).send("User not found");
        }

        const sanitizedUsername = username ? username.replace(/^@+/, '').trim().toLowerCase() : '';

        if (sanitizedUsername && sanitizedUsername !== currentUser.username) {
            const existingUser = await User.findOne({ username: sanitizedUsername });
            if (existingUser) {
                return res.status(400).send("Username is already taken.");
            }
        }

        const updateData = {};
        if (fullName && fullName.trim() !== '') updateData.fullName = fullName.trim();
        if (sanitizedUsername) updateData.username = sanitizedUsername;
        if (bio !== undefined) updateData.bio = bio.trim();

        if (req.file) {
            updateData.profileImage = req.file.secure_url || req.file.path;
        }

        const updatedUser = await User.findByIdAndUpdate(
            userId, 
            { $set: updateData },
            { new: true } 
        );

        const newToken = createTokenForUser(updatedUser);
        res.cookie('token', newToken, {
            httpOnly: true,
            secure: false,
        });
        
        return res.redirect('/');
    } catch (err) {
        console.error("Profile update error:", err);
        return res.status(500).send("Profile update failed");
    }
});

router.post('/upload-media', uploadMedia.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: "No file provided." });
        }

        const fileUrl = req.file.secure_url || req.file.path;
        const mimetype = req.file.mimetype || '';
        
        let mediaType = 'document';
        if (mimetype.startsWith('image/')) {
            mediaType = 'image';
        } else if (mimetype.startsWith('video/')) {
            mediaType = 'video';
        }

        return res.json({
            success: true,
            mediaUrl: fileUrl,
            mediaType: mediaType,
            fileName: req.file.originalname
        });
    } catch (err) {
        console.error("Media Upload Error:", err);
        return res.status(500).json({ success: false, error: "Failed to upload file." });
    }
});

router.get('/search', async (req, res) => {
    try {
        const query = req.query.username;
        if (!query || !req.user?._id) return res.json([]);

        const cleanQuery = query.replace(/^@+/, '').trim();

        const users = await User.find({
            _id: { $ne: req.user._id },
            username: { $regex: cleanQuery, $options: 'i' }
        }).select('_id fullName username profileImage');

        return res.json(users);
    } catch (err) {
        console.error("Search Error:", err);
        return res.status(500).json([]);
    }
});

router.post('/friend-request/send', async (req, res) => {
    try {
        const { targetId } = req.body;
        const targetUser = await User.findById(targetId);
        if (!targetUser) return res.status(404).json({ success: false, message: "User not found" });

        if (!targetUser.friendRequests.includes(req.user._id) && !targetUser.friends.includes(req.user._id)) {
            targetUser.friendRequests.push(req.user._id);
            await targetUser.save();
        }
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false });
    }
});

router.post('/friend-request/respond', async (req, res) => {
    try {
        const { requesterId, action } = req.body;

        await User.findByIdAndUpdate(req.user._id, {
            $pull: { friendRequests: requesterId }
        });

        if (action === 'accept') {
            // Use $addToSet on BOTH users to prevent duplicates
            await User.findByIdAndUpdate(req.user._id, { $addToSet: { friends: requesterId } });
            await User.findByIdAndUpdate(requesterId, { $addToSet: { friends: req.user._id } });
        }

        return res.redirect('/');
    } catch (err) {
        return res.status(500).send("Action Failed");
    }
});

router.post('/block', async (req, res) => {
    try {
        const { targetId } = req.body;
        await User.findByIdAndUpdate(req.user._id, {
            $addToSet: { blockedUsers: targetId }
        });
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/unblock', async (req, res) => {
    try {
        const { targetId } = req.body;
        await User.findByIdAndUpdate(req.user._id, {
            $pull: { blockedUsers: targetId }
        });
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/report', async (req, res) => {
    try {
        const { targetId, reason } = req.body;

        if (!targetId || !reason) {
            return res.status(400).json({ 
                success: false, 
                message: "Target user ID and reason are required." 
            });
        }

        await Report.create({
            reporter: req.user._id,
            reportedUser: targetId,
            reason: reason.trim()
        });

        return res.status(200).json({ success: true });
    } catch (err) {
        console.error("[REPORT ROUTE ERROR]", err);
        return res.status(500).json({ success: false });
    }
});

router.get('/messages/:friendId', async (req, res) => {
    try {
        const userId = req.user?._id;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const history = await Message.find({
            $or: [
                { senderId: userId, receiverId: req.params.friendId },
                { senderId: req.params.friendId, receiverId: userId }
            ],
            deletedFor: { $ne: userId }
        })
        .sort({ timestamp: 1 })
        .lean();

        const sanitizedHistory = history.map(msg => {
            if (msg.isViewOnce && msg.isViewed) {
                return {
                    ...msg,
                    mediaUrl: null
                };
            }
            return msg;
        });

        return res.json({ history: sanitizedHistory });
    } catch (err) {
        console.error("Error fetching chat history:", err);
        return res.status(500).json({ error: "Failed to load chat history" });
    }
});

router.post('/remove-friend', async (req, res) => {
    try {
        const userId = req.user._id;      
        const { targetUserId } = req.body; 

        await User.findByIdAndUpdate(userId, {
            $pull: { friends: targetUserId }
        });

        await User.findByIdAndUpdate(targetUserId, {
            $pull: { friends: userId }
        });

        return res.json({ success: true, message: 'Friend removed successfully' });
    } catch (err) {
        return res.status(500).json({ error: 'Failed to remove friend' });
    }
});

router.get('/proxy-pdf', async (req, res) => {
    try {
        const rawPdfUrl = req.query.url;
        if (!rawPdfUrl) {
            return res.status(400).send('Missing PDF URL');
        }

        const parsedUrl = new URL(rawPdfUrl);
        if (!parsedUrl.hostname.includes('cloudinary.com')) {
            return res.status(403).send('Forbidden source domain.');
        }

        const response = await axios({
            method: 'get',
            url: rawPdfUrl,
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'application/pdf,application/octet-stream,*/*'
            }
        });

        let fileName = parsedUrl.pathname.split('/').pop() || 'document.pdf';
        if (!fileName.toLowerCase().endsWith('.pdf')) {
            fileName += '.pdf';
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${encodeURI(fileName)}"`);

        if (response.headers['content-length']) {
            res.setHeader('Content-Length', response.headers['content-length']);
        }

        response.data.on('error', (streamErr) => {
            console.error('Stream error during PDF proxy:', streamErr);
            if (!res.headersSent) {
                res.status(500).send('Error streaming PDF');
            } else {
                res.destroy();
            }
        });

        response.data.pipe(res);

    } catch (error) {
        console.error('Error proxying PDF:', error.response?.status || error.message);
        if (!res.headersSent) {
            const statusCode = error.response?.status || 500;
            res.status(statusCode).send(`Failed to load PDF document (${statusCode}).`);
        }
    }
});

router.post('/messages/delete-for-me', async (req, res) => {
    try {
        const userId = req.user?._id;
        const { messageId } = req.body;

        if (!userId || !messageId) {
            return res.status(400).json({ success: false, error: "Missing required fields" });
        }

        await Message.findByIdAndUpdate(messageId, {
            $addToSet: { deletedFor: userId }
        });

        return res.json({ success: true, messageId });
    } catch (err) {
        console.error("Error in delete-for-me:", err);
        return res.status(500).json({ success: false, error: "Failed to delete message" });
    }
});

router.post('/chat/clear/:friendId', async (req, res) => {
    try {
        const currentUserId = req.user?._id;
        const friendId = req.params.friendId;

        if (!currentUserId || !friendId) {
            return res.status(400).json({ success: false, error: "Missing user or friend ID" });
        }

        await Message.updateMany(
            {
                $or: [
                    { senderId: currentUserId, receiverId: friendId },
                    { senderId: friendId, receiverId: currentUserId }
                ]
            },
            {
                $addToSet: { deletedFor: currentUserId }
            }
        );

        return res.json({ success: true, message: 'Chat history cleared for you.' });
    } catch (err) {
        console.error("Clear chat error:", err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/messages/forward', async (req, res) => {
    try {
        const senderId = req.user?._id;
        const { messageId, recipientIds } = req.body;

        if (!senderId || !messageId || !Array.isArray(recipientIds) || recipientIds.length === 0) {
            return res.status(400).json({ success: false, error: "Missing required parameters." });
        }

        const originalMessage = await Message.findById(messageId);
        if (!originalMessage) {
            return res.status(404).json({ success: false, error: "Original message not found." });
        }

        const newMessages = recipientIds.map(receiverId => ({
            senderId: senderId,
            receiverId: receiverId,
            text: originalMessage.text || originalMessage.content || '', 
            mediaUrl: originalMessage.mediaUrl || null,
            mediaType: originalMessage.mediaType || null,
            fileName: originalMessage.fileName || null,
            isViewOnce: false, 
            isForwarded: true  
        }));
        const createdMessages = await Message.insertMany(newMessages);

        return res.json({ success: true, count: createdMessages.length });
    } catch (err) {
        console.error("Error in forward message route:", err);
        return res.status(500).json({ success: false, error: "Failed to forward message." });
    }
});
module.exports = router;