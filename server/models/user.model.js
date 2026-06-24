const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    fullname: {
        type: String,
        trim: true,
        default: null
    },

    email: {
        type: String,
        trim: true,
        lowercase: true,
        default: null
    },

    avatar: {
        type: String,
        default: "https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y"
    },

    phone: {
        type: String,
        trim: true,
        default: null
    },

    provider: {
        type: String,
        default: null
    },

    role: {
        type: String,
        enum: ["client", "mechanic", "admin"],
        default: "client"
    },

    // Google's `sub` is a ~21-digit numeric string — far beyond
    // Number.MAX_SAFE_INTEGER, so it must be stored as a string.
    providerId: {
        type: String,
        default: null
    },

    otpCode: {
        type: Number,
        default: null,
    },

    otpCodeExpires: {
        type: Date,
        default: null
    },

    // Wrong-code attempts since the last code was issued. The code is
    // invalidated after MAX_OTP_ATTEMPTS, blocking brute force —
    // 4 digits are only 10,000 combinations.
    otpAttempts: {
        type: Number,
        default: 0
    },

    emailVerified: {
        type: Boolean,
        default: false
    },

    phoneVerified: {
        type: Boolean,
        default: false
    },

    // Expo push token — set from the app after the user grants
    // notification permission.
    expoPushToken: {
        type: String,
        default: null
    },

    favorites: [
        {
            type: mongoose.Types.ObjectId,
            ref: "Mechanic"
        }
    ]


}, { timestamps: true, collection: "users" })

// Partial: enforce uniqueness only when the field holds a real value —
// fields default to null here, and unlike `sparse`, a partial index
// also skips nulls, so many users without email/provider can coexist.
userSchema.index(
    { email: 1 },
    { unique: true, partialFilterExpression: { email: { $type: "string" } } }
);
userSchema.index(
    { provider: 1, providerId: 1 },
    { unique: true, partialFilterExpression: { providerId: { $type: "string" } } }
);

const User = mongoose.model("User", userSchema);

module.exports = User;