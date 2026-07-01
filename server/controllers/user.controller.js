const { default: mongoose } = require("mongoose");
const User = require("../models/user.model");
const catchAsync = require("../utils/catchAsync.util");
const AppError = require("../utils/AppError.util");
const { publicUser } = require("./auth.controller");
const { uploadImage, isConfigured: cloudinaryConfigured } = require("../utils/cloudinary.util");

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9]{9,15}$/;

/** True when the buffer starts like a real JPEG/PNG/WebP image. */
const looksLikeImage = (buffer) => {
    if (buffer.length < 12) return false;
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isPng =
        buffer[0] === 0x89 && buffer[1] === 0x50 &&
        buffer[2] === 0x4e && buffer[3] === 0x47;
    const isWebp =
        buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WEBP";
    return isJpeg || isPng || isWebp;
};

const getUsers = catchAsync(async (req, res, next) => {
    const users = await User.find();

    return res.json({
        status: "success",
        users
    });
});

const getUser = catchAsync(async (req, res, next) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        return next(new AppError("id is invalid", 400));
    }

    const user = await User.findById(id);

    if (!user) {
        return next(new AppError("User not found", 404));
    }

    return res.json({
        status: "success",
        user
    });
});

/** GET /users/me — the authenticated user's profile. */
const getMe = catchAsync(async (req, res, next) => {
    return res.json({
        success: true,
        user: publicUser(req.user)
    });
});

/**
 * PATCH /users/me — whitelisted profile updates.
 * Changing the email un-verifies it until the user confirms the new one.
 */
const updateMe = catchAsync(async (req, res, next) => {
    const allowed = ["fullname", "email", "phone", "avatar", "expoPushToken"];
    const updates = {};

    for (const field of allowed) {
        const value = req.body[field];
        if (value === undefined) continue;
        // null clears optional fields; everything else must be a plain
        // string — objects in the body must never reach the query.
        if (value !== null && typeof value !== "string") {
            return next(new AppError(`'${field}' must be a string.`, 400));
        }
        updates[field] = value;
    }

    if (Object.keys(updates).length === 0) {
        return next(new AppError("Nothing to update.", 400));
    }

    if (updates.fullname != null) {
        updates.fullname = updates.fullname.trim().slice(0, 80);
        if (!updates.fullname) {
            return next(new AppError("Name cannot be empty.", 400));
        }
    }
    if (updates.email != null) {
        updates.email = updates.email.trim().toLowerCase();
        if (!EMAIL_RE.test(updates.email)) {
            return next(new AppError("Please provide a valid email address.", 400));
        }
        if (updates.email !== req.user.email) updates.emailVerified = false;
    }
    if (updates.phone != null) {
        updates.phone = updates.phone.replace(/[\s-]/g, "");
        if (!PHONE_RE.test(updates.phone)) {
            return next(new AppError("Please provide a valid phone number.", 400));
        }
    }
    if (updates.expoPushToken != null && updates.expoPushToken.length > 200) {
        return next(new AppError("Push token is invalid.", 400));
    }

    const user = await User.findByIdAndUpdate(req.user._id, updates, {
        new: true,
        runValidators: true
    });

    return res.json({
        success: true,
        user: publicUser(user)
    });
});

/**
 * POST /users/me/avatar  { image: <base64> }
 * Uploads the avatar to Cloudinary and stores the absolute secure_url on
 * the user, so it shows identically on phone and web and survives Render
 * wiping the local disk on redeploy. One image per user: a stable
 * public_id (the user id) means re-uploads overwrite in place, and
 * `invalidate` (in the util) busts the CDN cache so the new photo shows
 * immediately.
 */
const uploadAvatar = catchAsync(async (req, res, next) => {
    const { image } = req.body;

    if (!image || typeof image !== "string") {
        return next(new AppError("Image is required.", 400));
    }

    const base64 = image.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64, "base64");

    if (!buffer.length) {
        return next(new AppError("Image data is invalid.", 400));
    }
    if (buffer.length > MAX_AVATAR_BYTES) {
        return next(new AppError("Image is too large (max 5 MB).", 413));
    }
    // Magic-byte sniff — only real image bytes are allowed regardless of
    // what the data-URL prefix claimed.
    if (!looksLikeImage(buffer)) {
        return next(new AppError("Only JPEG, PNG or WebP images are allowed.", 400));
    }
    if (!cloudinaryConfigured()) {
        return next(new AppError("Image storage is not configured.", 500));
    }

    const url = await uploadImage(buffer, {
        folder: "amcar/avatars",
        publicId: String(req.user._id)
    });

    const user = await User.findByIdAndUpdate(
        req.user._id,
        { avatar: url },
        { new: true }
    );

    return res.json({
        success: true,
        user: publicUser(user)
    });
});

/** GET /users/me/favorites — the user's saved mechanics, populated. */
const getFavorites = catchAsync(async (req, res, next) => {
    const user = await User.findById(req.user._id).populate("favorites");
    return res.json({
        success: true,
        mechanics: user.favorites
    });
});

/**
 * PUT /users/me/favorites/:mechanicId — save a mechanic ($addToSet is
 * idempotent, so tapping the heart twice can't create duplicates).
 */
const addFavorite = catchAsync(async (req, res, next) => {
    const { mechanicId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(mechanicId)) {
        return next(new AppError("Mechanic id is invalid.", 400));
    }
    const user = await User.findByIdAndUpdate(
        req.user._id,
        { $addToSet: { favorites: mechanicId } },
        { new: true }
    );
    return res.json({
        success: true,
        user: publicUser(user)
    });
});

/** DELETE /users/me/favorites/:mechanicId — unsave a mechanic. */
const removeFavorite = catchAsync(async (req, res, next) => {
    const { mechanicId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(mechanicId)) {
        return next(new AppError("Mechanic id is invalid.", 400));
    }
    const user = await User.findByIdAndUpdate(
        req.user._id,
        { $pull: { favorites: mechanicId } },
        { new: true }
    );
    return res.json({
        success: true,
        user: publicUser(user)
    });
});

module.exports = {
    getUsers,
    getUser,
    getMe,
    updateMe,
    uploadAvatar,
    getFavorites,
    addFavorite,
    removeFavorite
};
