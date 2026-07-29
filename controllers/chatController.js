const jwt = require('jsonwebtoken');
const Message = require('../models/Message');

const activeUsers = new Map();
const EDIT_TIME_LIMIT_MS = 15 * 60 * 1000; // 15 Minutes Window

const handleChatWebSocket = (io) => {
    io.use((socket, next) => {
        next();
    });

    io.on('connection', (socket) => {
        const rawId = socket.user?.id || socket.user?._id;
        
        if (!rawId) {
            console.error("❌ Socket Connection Rejected: No user ID found in token payload.");
            return socket.disconnect();
        }

        const userId = rawId.toString();
        console.log(`🔌 User connected: ${userId} (Socket ID: ${socket.id})`);
        
        if (!activeUsers.has(userId)) {
            activeUsers.set(userId, new Set());
        }
        activeUsers.get(userId).add(socket.id);

        const emitToUser = (targetUserId, eventName, payload) => {
            if (!targetUserId) return;
            const userSockets = activeUsers.get(targetUserId.toString());
            if (userSockets && userSockets.size > 0) {
                userSockets.forEach(socketId => {
                    io.to(socketId).emit(eventName, payload);
                });
            }
        };

        socket.on('send_message', async (data, ackCallback) => {
            const { receiverId, text, mediaUrl, mediaType, isViewOnce } = data;
            if (!receiverId || (!text && !mediaUrl)) {
                if (typeof ackCallback === 'function') ackCallback({ error: "Invalid payload" });
                return;
            }

            try {
                const savedMessage = await Message.create({
                    senderId: userId,
                    receiverId,
                    text: text || "",
                    mediaUrl: mediaUrl || null,
                    mediaType: mediaType || null,
                    isViewOnce: isViewOnce || false,
                    isViewed: false,
                    isEdited: false,
                    isDeleted: false,
                    timestamp: new Date()
                });

                const messagePayload = {
                    _id: savedMessage._id.toString(),
                    senderId: userId,
                    receiverId,
                    text: savedMessage.text,
                    mediaUrl: savedMessage.mediaUrl,
                    mediaType: savedMessage.mediaType,
                    isViewOnce: savedMessage.isViewOnce,
                    isViewed: false,
                    isEdited: false,
                    isDeleted: false,
                    timestamp: savedMessage.timestamp
                };

                emitToUser(receiverId, 'receive_message', messagePayload);
                emitToUser(userId, 'receive_message', messagePayload);

                if (typeof ackCallback === 'function') ackCallback({ success: true, message: messagePayload });
            } catch (err) {
                console.error("❌ Error sending message:", err);
                if (typeof ackCallback === 'function') ackCallback({ error: "Server error sending message" });
            }
        });

        socket.on('message:view-once-open', async ({ messageId, receiverId }) => {
            if (!messageId) return;

            try {
                const msg = await Message.findById(messageId);
                if (msg && msg.isViewOnce && !msg.isViewed) {
                    msg.isViewed = true;
                    await msg.save();

                    const payload = { messageId };

                    emitToUser(receiverId, 'message_view_once_opened', payload);
                    emitToUser(userId, 'message_view_once_opened', payload);
                }
            } catch (err) {
                console.error("❌ View once opening error:", err);
            }
        });

        socket.on('edit_message', async (data) => {
            const { messageId, newText, receiverId } = data;
            if (!messageId || !newText || !receiverId) return;

            try {
                const msg = await Message.findById(messageId);
                if (!msg) return;

                if (msg.isDeleted) {
                    return socket.emit('action_error', { message: 'Cannot edit a deleted message.' });
                }

                const isSender = msg.senderId.toString() === userId;
                const isWithinTimeLimit = (Date.now() - new Date(msg.timestamp).getTime()) <= EDIT_TIME_LIMIT_MS;

                if (isSender && isWithinTimeLimit) {
                    msg.text = newText;
                    msg.isEdited = true;
                    await msg.save();

                    const payload = { messageId, newText };

                    emitToUser(receiverId, 'message_edited', payload);
                    emitToUser(userId, 'message_edited', payload);
                    console.log(`✏️ Message ${messageId} edited by ${userId}`);
                } else {
                    socket.emit('action_error', { message: 'Edit window expired or unauthorized.' });
                }
            } catch (err) {
                console.error("❌ Error editing message:", err);
            }
        });

        socket.on('delete_message', async (data) => {
            const { messageId, receiverId } = data;
            if (!messageId || !receiverId) return;

            try {
                const msg = await Message.findById(messageId);
                if (!msg) return;

                if (msg.isDeleted) {
                    return socket.emit('action_error', { message: 'Message has already been deleted.' });
                }

                const isSender = msg.senderId.toString() === userId;
                const isWithinTimeLimit = (Date.now() - new Date(msg.timestamp).getTime()) <= EDIT_TIME_LIMIT_MS;

                if (isSender && isWithinTimeLimit) {
                    msg.isDeleted = true;
                    msg.text = "This message was deleted";
                    await msg.save();

                    const payload = { messageId };

                    emitToUser(receiverId, 'message_deleted', payload);
                    emitToUser(userId, 'message_deleted', payload);
                    console.log(`🗑️ Message ${messageId} deleted by ${userId}`);
                } else {
                    socket.emit('action_error', { message: 'Delete window expired or unauthorized.' });
                }
            } catch (err) {
                console.error("❌ Error deleting message:", err);
            }
        });

        socket.on('disconnect', () => {
            console.log(`❌ User disconnected: ${userId} (Socket ID: ${socket.id})`);
            const userSockets = activeUsers.get(userId);
            if (userSockets) {
                userSockets.delete(socket.id);
                if (userSockets.size === 0) activeUsers.delete(userId);
            }
        });
    });
};

module.exports = { handleChatWebSocket };