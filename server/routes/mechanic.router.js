const express = require("express");
const protect = require("../middlewares/protect.middleware");
const adminOnly = require("../middlewares/admin.middleware");
const {
    getMechanics,
    createMechanic,
    updateMechanic,
    deleteMechanic,
    addReview
} = require("../controllers/mechanic.controller");

const router = express.Router();

router.get("/", getMechanics);
router.post("/:id/reviews", protect, addReview);

// Admin panel CRUD
router.post("/", protect, adminOnly, createMechanic);
router.patch("/:id", protect, adminOnly, updateMechanic);
router.delete("/:id", protect, adminOnly, deleteMechanic);

module.exports = router;
