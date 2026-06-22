const express = require("express");
const { googleOauthMobile } = require("../controllers/oauth.controller");
const {
    requestEmailCode,
    verifyEmailCode
} = require("../controllers/auth.controller");

const router = express.Router();

router.post("/google/mobile", googleOauthMobile);
router.post("/email/request-code", requestEmailCode);
router.post("/email/verify", verifyEmailCode);

module.exports = router;
