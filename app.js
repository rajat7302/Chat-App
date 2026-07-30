require('dotenv').config(); // Load environment variables from .env

const mongoose = require('mongoose');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const PORT = process.env.PORT || 8080;
const fs = require('fs');
const path = require('path');
const cookieParser = require('cookie-parser');

const userRoute = require('./routes/user');
const server = http.createServer(app);
const io = new Server(server);
const { checkForAuthenticationCookie, restrictToLoggedinUserOnly } = require('./middlewares/authentication');
const authRouter = require('./routes/auth');
const passport = require('./services/passport');

const User = require('./models/user');
const Message = require('./models/message'); 
const adminRoute = require('./routes/admin');

const MONGO_URL = process.env.MONGO_URI || process.env.MONGO_URL || "mongodb://localhost:27017/chat-app-standard";

const EDIT_TIME_LIMIT_MS = 15 * 60 * 1000; // 15 Minutes Window

const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

mongoose.connect(MONGO_URL)
    .then(() => {
        console.log("Mongo DB Connected");
        seedSingleAdmin();
    })
    .catch(err => console.log(err));

app.set('view engine', 'ejs');
app.set("views", path.resolve('./views'));

app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: false }));
app.use(passport.initialize());
app.use('/auth', authRouter);
app.use(checkForAuthenticationCookie("token"));

app.use((req, res, next) => {
    res.locals.user = req.user;
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.use('/user', userRoute);
app.use('/admin', adminRoute);

async function seedSingleAdmin() {
    try {
        const adminData = {
            fullName: process.env.ADMIN_FULL_NAME || "System Administrator",
            email: process.env.ADMIN_EMAIL || "adminchatapp@gmail.com",
            username: process.env.ADMIN_USERNAME || "admin",
            password: process.env.ADMIN_PASSWORD || "ToHardToGuess@1234",
            role: "admin"
        };

        let existingAdmin = await User.findOne({ role: 'admin' });

        if (!existingAdmin) {
            await User.create(adminData);
            console.log("Single Admin created successfully!");
        } else {
            existingAdmin.username = adminData.username;
            existingAdmin.email = adminData.email;
            existingAdmin.password = adminData.password; // Mongoose pre-save hooks will hash this if configured
            await existingAdmin.save();
            console.log("Admin account synced with current .env configuration.");
        }
    } catch (err) {
        console.error("Admin Seed error:", err);
    }
}

app.get('/', restrictToLoggedinUserOnly, async (req, res) => {
    try {
        const currentUser = await User.findById(req.user._id)
            .populate('friends', 'fullName username profileImage')
            .populate('friendRequests', 'fullName username')
            .populate('blockedUsers', 'fullName username profileImage');

        res.locals.user = currentUser;
        return res.render('home', { user: currentUser });
    } catch (err) {
        console.error(err);
        return res.status(500).send("Internal Server Error");
    }
});

io.on('connection', (socket) => {
    console.log(`🔌 Device connected: ${socket.id}`);

    socket.on('join', (userId) => {
        if (userId) {
            socket.join(userId.toString());
            console.log(`👤 User joined room: ${userId}`);
        }
    });

    socket.on('send_message', async (data, ackCallback) => {
        const senderId = data.senderId || data.userId;
        const receiverId = data.receiverId || data.targetId || data.recipientId;
        const { text, mediaUrl, mediaType, isViewOnce } = data;

        console.log(`📩 Incoming message from [${senderId}] to [${receiverId}]`);

        try {
            if (!senderId || !receiverId) {
                console.error("❌ Missing senderId or receiverId in payload:", data);
                if (ackCallback) ackCallback({ success: false, error: 'Invalid user payload' });
                return;
            }

            const sender = await User.findById(senderId);
            const receiver = await User.findById(receiverId);

            if (!sender || !receiver) {
                console.error(`❌ DB Lookup Failed - Sender: ${!!sender}, Receiver: ${!!receiver}`);
                if (ackCallback) ackCallback({ success: false, error: 'User not found in DB' });
                return;
            }

            const isFriend = sender.friends.some(id => id && id.toString() === receiverId.toString());

            const senderBlockedReceiver = sender.blockedUsers && sender.blockedUsers.some(id => id && id.toString() === receiverId.toString());
            const receiverBlockedSender = receiver.blockedUsers && receiver.blockedUsers.some(id => id && id.toString() === senderId.toString());
            const isBlocked = senderBlockedReceiver || receiverBlockedSender;
            
            if (isFriend && !isBlocked) {
                const savedMsg = await Message.create({
                    senderId: senderId.toString(),
                    receiverId: receiverId.toString(),
                    text: text || '',
                    mediaUrl: mediaUrl || null,
                    mediaType: mediaType || null,
                    isViewOnce: !!isViewOnce
                });
                
                const messagePayload = {
                    _id: savedMsg._id.toString(),
                    senderId: senderId.toString(),
                    receiverId: receiverId.toString(),
                    text: savedMsg.text,
                    mediaUrl: savedMsg.mediaUrl,
                    mediaType: savedMsg.mediaType,
                    isViewOnce: savedMsg.isViewOnce,
                    isViewed: savedMsg.isViewed,
                    isEdited: savedMsg.isEdited,
                    isDeleted: savedMsg.isDeleted,
                    timestamp: savedMsg.timestamp || savedMsg.createdAt
                };

                io.to(receiverId.toString()).emit('receive_message', messagePayload);
                io.to(senderId.toString()).emit('receive_message', messagePayload);
                
                if (ackCallback) ackCallback({ success: true, message: messagePayload });
                console.log(`🚀 Message delivered from ${senderId} to ${receiverId}`);
            } else {
                console.log(`⚠️ Message dropped: Users are not friends or block active.`);
                if (ackCallback) ackCallback({ success: false, error: 'Cannot message user' });
            }
        } catch (err) {
            console.error("Socket Message Error:", err);
            if (ackCallback) ackCallback({ success: false, error: 'Server error' });
        }
    });

    socket.on('edit_message', async (data, ackCallback) => {
        try {
            const { messageId, senderId, receiverId, newText } = data || {};

            if (!messageId || !senderId) {
                if (ackCallback) ackCallback({ success: false, error: 'Missing messageId or senderId' });
                return;
            }

            const msg = await Message.findById(messageId);
            if (!msg) {
                if (ackCallback) ackCallback({ success: false, error: 'Message not found' });
                return;
            }

            if (msg.isDeleted) {
                socket.emit('error:action-failed', { message: 'Cannot edit a deleted message.' });
                if (ackCallback) ackCallback({ success: false, error: 'Message is deleted' });
                return;
            }

            const msgSenderId = msg.senderId ? msg.senderId.toString() : null;
            const isSender = msgSenderId === senderId.toString();
            const msgCreationTime = new Date(msg.createdAt || msg.timestamp || Date.now()).getTime();
            const isWithinTimeLimit = (Date.now() - msgCreationTime) <= EDIT_TIME_LIMIT_MS;

            if (isSender && isWithinTimeLimit) {
                msg.text = newText;
                msg.isEdited = true;
                await msg.save();

                const payload = { messageId, newText };

                if (receiverId) io.to(receiverId.toString()).emit('message_edited', payload);
                io.to(senderId.toString()).emit('message_edited', payload);

                if (ackCallback) ackCallback({ success: true });
                console.log(`✏️ Message ${messageId} edited by ${senderId}`);
            } else {
                socket.emit('error:action-failed', { message: 'Edit window expired or unauthorized.' });
                if (ackCallback) ackCallback({ success: false, error: 'Unauthorized or window expired' });
            }
        } catch (err) {
            console.error("Edit Message Error:", err);
            if (ackCallback) ackCallback({ success: false, error: 'Server error' });
        }
    });

    socket.on('delete_message', async (data, ackCallback) => {
        try {
            const { messageId, senderId, receiverId } = data || {};

            if (!messageId || !senderId) {
                if (ackCallback) ackCallback({ success: false, error: 'Missing messageId or senderId' });
                return;
            }

            const msg = await Message.findById(messageId);
            if (!msg) {
                if (ackCallback) ackCallback({ success: false, error: 'Message not found' });
                return;
            }

            if (msg.isDeleted) {
                socket.emit('error:action-failed', { message: 'Message has already been deleted.' });
                if (ackCallback) ackCallback({ success: false, error: 'Message already deleted' });
                return;
            }

            const msgSenderId = msg.senderId ? msg.senderId.toString() : null;
            const isSender = msgSenderId === senderId.toString();
            const msgCreationTime = new Date(msg.createdAt || msg.timestamp || Date.now()).getTime();
            const isWithinTimeLimit = (Date.now() - msgCreationTime) <= EDIT_TIME_LIMIT_MS;

            if (isSender && isWithinTimeLimit) {
                msg.isDeleted = true;
                msg.text = "This message was deleted";
                msg.mediaUrl = null; 
                await msg.save();

                const payload = { messageId };

                if (receiverId) io.to(receiverId.toString()).emit('message_deleted', payload);
                io.to(senderId.toString()).emit('message_deleted', payload);

                if (ackCallback) ackCallback({ success: true });
                console.log(`🗑️ Message ${messageId} deleted by ${senderId}`);
            } else {
                socket.emit('error:action-failed', { message: 'Delete window expired or unauthorized.' });
                if (ackCallback) ackCallback({ success: false, error: 'Unauthorized or window expired' });
            }
        } catch (err) {
            console.error("Delete Message Error:", err);
            if (ackCallback) ackCallback({ success: false, error: 'Server error' });
        }
    });

    socket.on('disconnect', () => {
        console.log(`❌ Device disconnected: ${socket.id}`);
    });
});

server.listen(PORT, () => console.log(`Server started at ${PORT}`));