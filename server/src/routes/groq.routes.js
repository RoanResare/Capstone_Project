const express = require("express");
const {
  createGroqChat,
  getGroqRuntimeStatus,
} = require("../controllers/groq.controller");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.get("/groq-status", asyncHandler(getGroqRuntimeStatus));
router.post("/groq-chat", asyncHandler(createGroqChat));

module.exports = router;
