const express = require("express");
const {
  checkCustomerRegistrationAvailability,
  forgotPassword,
  loginUnified,
  logout,
  me,
  resetPassword,
  sessionSecurity,
  validateResetCode,
  validateEmail,
} = require("../controllers/auth.controller");
const { verifyToken } = require("../middlewares/authenticate");
const { authRateLimiter } = require("../middlewares/authRateLimiter");
const { asyncHandler } = require("../utils/asyncHandler");
const { saveAppointment } = require("../controllers/appointment.controller");
const { verifyRole } = require("../middlewares/authorize");
const { listAvailabilitySlots, saveAvailabilitySlot, disableAvailabilitySlot } = require("../controllers/schedule.controller");

const router = express.Router();

router.post("/forgot-password", authRateLimiter, asyncHandler(forgotPassword));
router.post("/register/check", authRateLimiter, asyncHandler(checkCustomerRegistrationAvailability));
router.post("/login", authRateLimiter, asyncHandler(loginUnified));
router.post("/validate-reset-code", authRateLimiter, asyncHandler(validateResetCode));
router.post("/reset-password", authRateLimiter, asyncHandler(resetPassword));
router.get("/me", verifyToken, asyncHandler(me));
router.post("/validate-email", authRateLimiter, verifyToken, asyncHandler(validateEmail));
router.get("/session-security", verifyToken, asyncHandler(sessionSecurity));
router.put("/appointments/:id", verifyToken, asyncHandler(saveAppointment));
router.get("/availability-slots", verifyToken, asyncHandler(listAvailabilitySlots));
router.put("/availability-slots/:id", verifyToken, verifyRole(["admin", "staff"]), asyncHandler(saveAvailabilitySlot));
router.delete("/availability-slots/:id", verifyToken, verifyRole(["admin", "staff"]), asyncHandler(disableAvailabilitySlot));
router.post("/logout", verifyToken, asyncHandler(logout));

module.exports = router;
