const express = require("express");
const {
  loginStaff,
  me,
  sendStaffOtp,
  verifyStaffOtp,
} = require("../controllers/auth.controller");
const { listUsers, updateMyProfile } = require("../controllers/user.controller");
const { verifySessionToken } = require("../middlewares/authenticate");
const { authRateLimiter } = require("../middlewares/authRateLimiter");
const { verifyStaff } = require("../middlewares/authorize");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.post("/login", authRateLimiter, asyncHandler(loginStaff));
router.post("/send-otp", authRateLimiter, asyncHandler(sendStaffOtp));
router.post("/verify-otp", authRateLimiter, asyncHandler(verifyStaffOtp));

router.use(verifySessionToken, verifyStaff);

router.get("/profile", asyncHandler(me));
router.patch("/profile", asyncHandler(updateMyProfile));
router.get("/users", asyncHandler(listUsers));

module.exports = router;
