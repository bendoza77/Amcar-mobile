const AppError = require("../utils/AppError.util");

/**
 * Allows only admins through. Must run after `protect`, which sets
 * req.user (and promotes ADMIN_EMAILS accounts to the admin role).
 */
const adminOnly = (req, res, next) => {
    if (req.user?.role !== "admin") {
        return next(new AppError("You do not have permission to perform this action.", 403));
    }
    next();
};

module.exports = adminOnly;
