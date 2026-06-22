const express = require("express");
const { getDirections } = require("../controllers/directions.controller");

const router = express.Router();

router.get("/", getDirections);

module.exports = router;
