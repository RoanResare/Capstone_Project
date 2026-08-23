const express = require("express");
const {
  loginAdmin,
  me,
  sendAdminOtp,
  verifyAdminOtp,
} = require("../controllers/auth.controller");
const {
  createUser,
  listUsers,
  removeUser,
  updateMyProfile,
  updateUser,
} = require("../controllers/user.controller");
const { verifySessionToken } = require("../middlewares/authenticate");
const { authRateLimiter } = require("../middlewares/authRateLimiter");
const { verifyAdmin } = require("../middlewares/authorize");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.post("/login", authRateLimiter, asyncHandler(loginAdmin));
router.post("/send-otp", authRateLimiter, asyncHandler(sendAdminOtp));
router.post("/verify-otp", authRateLimiter, asyncHandler(verifyAdminOtp));

router.use(verifySessionToken, verifyAdmin);

router.get("/profile", asyncHandler(me));
router.patch("/profile", asyncHandler(updateMyProfile));
router.get("/users", asyncHandler(listUsers));
router.post("/users", asyncHandler(createUser));
router.patch("/users/:uid", asyncHandler(updateUser));
router.delete("/users/:uid", asyncHandler(removeUser));

module.exports = router;
