const { OAuth2Client } = require("google-auth-library");
const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
const catchAsync = require("../utils/catchAsync.util");
const AppError = require("../utils/AppError.util");

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

module.exports = { googleOauthMobile };
