const express = require("express");
const {
  forgotPassword,
  loginUnified,
  logout,
  me,
  resetPassword,
  validateResetCode,
} = require("../controllers/auth.controller");
const { verifyToken } = require("../middlewares/authenticate");
const { authRateLimiter } = require("../middlewares/authRateLimiter");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.post("/forgot-password", authRateLimiter, asyncHandler(forgotPassword));
router.post("/login", authRateLimiter, asyncHandler(loginUnified));
router.post("/validate-reset-code", authRateLimiter, asyncHandler(validateResetCode));
router.post("/reset-password", authRateLimiter, asyncHandler(resetPassword));
router.get("/me", verifyToken, asyncHandler(me));
router.post("/logout", verifyToken, asyncHandler(logout));

module.exports = router;
