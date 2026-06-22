const express = require("express");
const protect = require("../middlewares/protect.middleware");
const {
    getMe,
    updateMe,
    uploadAvatar,
    getFavorites,
    addFavorite,
    removeFavorite
} = require("../controllers/user.controller");

const router = express.Router();

router.use(protect);

router.get("/me", getMe);
router.patch("/me", updateMe);
router.post("/me/avatar", uploadAvatar);

router.get("/me/favorites", getFavorites);
router.put("/me/favorites/:mechanicId", addFavorite);
router.delete("/me/favorites/:mechanicId", removeFavorite);

module.exports = router;
