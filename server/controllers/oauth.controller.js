const { OAuth2Client } = require("google-auth-library");
const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
const catchAsync = require("../utils/catchAsync.util");
const AppError = require("../utils/AppError.util");
const { publicUser } = require("./auth.controller");
const {
    verifyIdToken: verifyFirebaseIdToken,
    isConfigured: firebaseConfigured
} = require("../utils/firebaseAdmin.util");

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const signToken = (id) =>
    jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || "30d"
    });

const googleOauthMobile = catchAsync(async (req, res, next) => {
    const { idToken } = req.body;

    if (!idToken) {
        return next(new AppError("idToken is required", 400));
    }

    // verifyIdToken throws on a bad/expired token — translate that
    // into a 401 instead of letting it surface as a generic 500.
    let payload;
    try {
        const ticket = await client.verifyIdToken({
            idToken,
            audience: process.env.GOOGLE_CLIENT_ID
        });
        payload = ticket.getPayload();
    } catch (err) {
        return next(new AppError("Invalid or expired Google token. Please sign in again.", 401));
    }

    const { name, email, picture, sub, email_verified: emailVerified } = payload;

    let user = await User.findOne({ provider: "google", providerId: sub });

    // Link an existing account by email only when Google vouches for the
    // address — an unverified email could belong to someone else.
    if (!user && email && emailVerified) {
        user = await User.findOne({ email });

        if (user) {
            user.provider = "google";
            user.providerId = sub;
            user.emailVerified = true;
            if (!user.fullname) user.fullname = name;
            await user.save();
        }
    }

    if (!user) {
        user = await User.create({
            fullname: name,
            email,
            avatar: picture || undefined,
            provider: "google",
            providerId: sub,
            emailVerified: Boolean(emailVerified)
        });
    }

    const token = signToken(user._id);

    return res.status(200).json({
        success: true,
        token,
        user: {
            id: user._id,
            fullname: user.fullname,
            email: user.email,
            avatar: user.avatar,
            phone: user.phone,
            role: user.role
        }
    });
});

/**
 * POST /auth/phone/firebase  { idToken }
 * Completes Firebase phone-number sign-in: the app sends the SMS and
 * verifies the code with Firebase, then hands us the resulting ID
 * token. We verify it server-side (so the phone number can't be
 * spoofed), find-or-create the matching user keyed on the Firebase
 * uid, and issue our own 30-day JWT.
 */
const phoneFirebaseAuth = catchAsync(async (req, res, next) => {
    const { idToken } = req.body;

    if (!idToken) {
        return next(new AppError("idToken is required", 400));
    }

    if (!firebaseConfigured()) {
        return next(new AppError("Phone sign-in is not configured.", 500));
    }

    let decoded;
    try {
        decoded = await verifyFirebaseIdToken(idToken);
    } catch (err) {
        return next(new AppError("Invalid or expired token. Please sign in again.", 401));
    }

    const uid = decoded.uid;
    const phone = decoded.phone_number || null;

    if (!phone) {
        return next(new AppError("This token has no verified phone number.", 401));
    }

    let user = await User.findOne({ provider: "phone", providerId: uid });

    // Link an existing account that already carries this phone number
    // (e.g. one created earlier via email) instead of duplicating it.
    if (!user) {
        user = await User.findOne({ phone });
    }

    if (user) {
        user.provider = "phone";
        user.providerId = uid;
        user.phone = phone;
        user.phoneVerified = true;
        await user.save();
    } else {
        user = await User.create({
            phone,
            provider: "phone",
            providerId: uid,
            phoneVerified: true
        });
    }

    return res.status(200).json({
        success: true,
        token: signToken(user._id),
        isNew: !user.fullname,
        user: publicUser(user)
    });
});

module.exports = { googleOauthMobile, phoneFirebaseAuth };
