const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
const catchAsync = require("../utils/catchAsync.util");
const AppError = require("../utils/AppError.util");

/**
 * Requires a valid `Authorization: Bearer <jwt>` header and
 * attaches the authenticated user to req.user.
 */
const protect = catchAsync(async (req, res, next) => {
    const header = req.headers.authorization;
    const token = header && header.startsWith("Bearer ") ? header.split(" ")[1] : null;

    if (!token) {
        return next(new AppError("You are not logged in. Please log in to get access.", 401));
    }

    // jwt.verify throws JsonWebTokenError/TokenExpiredError — the global
    // error handler already maps both to friendly 401s.
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id);
    if (!user) {
        return next(new AppError("The user belonging to this token no longer exists.", 401));
    }

    // Emails listed in ADMIN_EMAILS (comma-separated) are promoted to
    // admin on sight — idempotent, survives fresh sign-ups.
    const adminEmails = (process.env.ADMIN_EMAILS || "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);

    if (user.email && adminEmails.includes(user.email) && user.role !== "admin") {
        user.role = "admin";
        await user.save();
    }

    req.user = user;
    next();
});

module.exports = protect;
