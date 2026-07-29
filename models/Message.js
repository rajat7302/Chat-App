const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
    senderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User', 
        required: true
    },
    receiverId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    text: { 
        type: String, 
        default: "" 
    },
    mediaUrl: { 
        type: String, 
        default: null 
    },
    mediaType: { 
        type: String, 
      enum: ['image', 'video', 'document', 'audio', 'file'],
        default: null 
    },
    isViewOnce: { 
        type: Boolean, 
        default: false 
    },
    isViewed: { 
        type: Boolean, 
        default: false 
    },
    isEdited: { 
        type: Boolean, 
        default: false 
    },
    isDeleted: { 
        type: Boolean, 
        default: false 
    },
    clearedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    
    timestamp: {
        type: Date,
        default: Date.now
    },
    deletedFor : [{type : mongoose.Schema.Types.ObjectId, ref : 'User'}]
});

MessageSchema.index({ senderId: 1, receiverId: 1, timestamp: 1 });
MessageSchema.index({ receiverId: 1, senderId: 1, timestamp: 1 });

module.exports = mongoose.model('Message', MessageSchema);