const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
const catchAsync = require("../utils/catchAsync.util");
const AppError = require("../utils/AppError.util");
const { sendOtpEmail, isConfigured: emailConfigured } = require("../utils/email.util");

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Coerce request fields to strings before they reach regexes or
// queries — objects in JSON bodies must never become query operators.
const asString = (value) => (typeof value === "string" ? value : "");

/**
 * Shared wrong-code/expiry handling for both verify flows. Counts
 * failed attempts and burns the code after MAX_OTP_ATTEMPTS so a
 * 4-digit code can't be brute-forced. Returns an AppError to send,
 * or null when the code is valid.
 */
const checkOtp = async (user, code) => {
    if (!user || !user.otpCode) {
        return new AppError("The code is incorrect. Please try again.", 401);
    }
    if (!user.otpCodeExpires || user.otpCodeExpires < new Date()) {
        return new AppError("This code has expired. Please request a new one.", 401);
    }
    if (user.otpCode !== code) {
        user.otpAttempts = (user.otpAttempts || 0) + 1;
        const burned = user.otpAttempts >= MAX_OTP_ATTEMPTS;
        if (burned) {
            user.otpCode = null;
            user.otpCodeExpires = null;
        }
        await user.save();
        return new AppError(
            burned
                ? "Too many wrong attempts. Please request a new code."
                : "The code is incorrect. Please try again.",
            401
        );
    }
    return null;
};

const signToken = (id) =>
    jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || "30d"
    });

const publicUser = (user) => ({
    id: user._id,
    fullname: user.fullname,
    email: user.email,
    avatar: user.avatar,
    phone: user.phone,
    role: user.role,
    emailVerified: user.emailVerified,
    // Favorited mechanic ids as strings, so the app can show the heart
    // state without a separate request.
    favorites: (user.favorites || []).map((id) => String(id))
});

/**
 * POST /auth/email/request-code  { email }
 * Generates a 4-digit code, stores it on the (created-if-needed) user
 * and emails it. The code is never returned in the response — it is
 * only ever delivered by email.
 */
const requestEmailCode = catchAsync(async (req, res, next) => {
    const email = asString(req.body.email).trim().toLowerCase();

    if (!EMAIL_RE.test(email)) {
        return next(new AppError("Please provide a valid email address.", 400));
    }

    const code = Math.floor(1000 + Math.random() * 9000);

    const user = await User.findOneAndUpdate(
        { email },
        {
            email,
            otpCode: code,
            otpCodeExpires: new Date(Date.now() + OTP_TTL_MS),
            otpAttempts: 0
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    if (!emailConfigured()) {
        return next(new AppError("Email service is not configured.", 500));
    }

    try {
        await sendOtpEmail(email, code);
    } catch (err) {
        console.error("OTP email failed:", err.message);
        return next(new AppError("Could not send the email. Please try again later.", 502));
    }

    return res.status(200).json({
        success: true,
        message: "Verification code sent."
    });
});

/**
 * POST /auth/email/verify  { email, code }
 * Checks the code, marks the email verified and issues a JWT.
 * `isNew` tells the client to ask for the user's fullname.
 */
const verifyEmailCode = catchAsync(async (req, res, next) => {
    const email = asString(req.body.email).trim().toLowerCase();
    const code = Number(req.body.code);

    if (!EMAIL_RE.test(email) || !Number.isInteger(code)) {
        return next(new AppError("Email and code are required.", 400));
    }

    const user = await User.findOne({ email });

    const otpError = await checkOtp(user, code);
    if (otpError) return next(otpError);

    user.otpCode = null;
    user.otpCodeExpires = null;
    user.otpAttempts = 0;
    user.emailVerified = true;
    if (!user.provider) user.provider = "email";
    await user.save();

    return res.status(200).json({
        success: true,
        token: signToken(user._id),
        isNew: !user.fullname,
        user: publicUser(user)
    });
});

module.exports = {
    requestEmailCode,
    verifyEmailCode,
    signToken,
    publicUser
};
