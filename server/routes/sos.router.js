const express = require("express");
const protect = require("../middlewares/protect.middleware");
const AppError = require("../utils/AppError.util");
const {
    createSos,
    getActiveSos,
    getPendingSos,
    acceptSos,
    cancelSos,
    completeSos
} = require("../controllers/sos.controller");

const router = express.Router();

// Listing and accepting requests is for responder accounts only.
const responderOnly = (req, res, next) => {
    if (req.user.role === "mechanic" || req.user.role === "admin") return next();
    return next(new AppError("Only mechanic accounts can do this.", 403));
};

router.use(protect);

router.post("/", createSos);
router.get("/active", getActiveSos);
router.get("/pending", responderOnly, getPendingSos);
router.patch("/:id/accept", responderOnly, acceptSos);
router.patch("/:id/cancel", cancelSos);
router.patch("/:id/complete", completeSos);

module.exports = router;
