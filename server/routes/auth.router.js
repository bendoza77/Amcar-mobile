const express = require("express");
const { googleOauthMobile, phoneFirebaseAuth } = require("../controllers/oauth.controller");
const {
    requestEmailCode,
    verifyEmailCode
} = require("../controllers/auth.controller");

const router = express.Router();

router.post("/google/mobile", googleOauthMobile);
router.post("/phone/firebase", phoneFirebaseAuth);
router.post("/email/request-code", requestEmailCode);
router.post("/email/verify", verifyEmailCode);

module.exports = router;
