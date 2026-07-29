const { createHmac, randomBytes } = require('crypto');
const { Schema, model } = require('mongoose');

const userSchema = new Schema({
    fullName: {
        type: String,
        required: true,
    },
    username: {
        type: String,
        required: true,
        unique: true,
    },
    email: {
        type: String,
        required: true,
        unique: true,
    },
    salt: {
        type: String,
    },
    password: {
        type: String,
        required: true,
    },
    bio: {
        type: String,
        default: ""
    },
    profileImage: {
        type: String,
        default: '/images/default-avatar.png'
    },
    role: {
        type: String,
        enum: ["user", "admin"],
        default: 'user'
    },
    friends: [{
        type: Schema.Types.ObjectId,
        ref: 'user'
    }],
    friendRequests: [{
        type: Schema.Types.ObjectId,
        ref: 'user'
    }],
    blockedUsers: [{
        type: Schema.Types.ObjectId,
        ref: 'user'
    }],
    reports: [{
        reportedBy: { type: Schema.Types.ObjectId, ref: 'user' },
        reason: String,
        timestamp: { type: Date, default: Date.now }
    }],
    resetPasswordToken: {
        type: String,
        default: null
    },
    resetPasswordExpires: {
        type: Date,
        default: null
    },
    isBanned: {
        type: Boolean,
        default: false
    },
    banReason: {
        type: String,
        default: ''
    }
}, { timestamps: true });

userSchema.pre('save', async function () {
    const user = this;

    if (!user.isModified('password')) return; 
    if (!user.password.startsWith('GOOGLE_AUTH_')) {
        const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
        if (!strongPasswordRegex.test(user.password)) {
            throw new Error("Password must be at least 8 characters long and include an uppercase letter, lowercase letter, number, and special character.");
        }
    }
    try {
        const salt = randomBytes(16).toString('hex');
        const hashedPassword = createHmac('sha256', salt)
            .update(user.password)
            .digest('hex');

        user.salt = salt;
        user.password = hashedPassword;
    } catch (error) {
        throw error; 
    }
});

userSchema.static('matchPassword', async function (loginInput, password) {
    if (!loginInput || !password) throw new Error("Email/Username and password are required");

    const cleanInput = loginInput.replace(/^@+/, '').trim().toLowerCase();

    const user = await this.findOne({
        $or: [
            { email: cleanInput },
            { username: cleanInput }
        ]
    });

    if (!user) throw new Error("User Not Found!");

    const salt = user.salt;
    const hashedPassword = user.password;

    const userProvidedHash = createHmac('sha256', salt)
        .update(password)
        .digest('hex');

    if (hashedPassword !== userProvidedHash) {
        throw new Error("Incorrect Password");
    }

    return user;
});

const User = model('user', userSchema);
module.exports = User;