const express = require("express");
const { loginCustomer, me } = require("../controllers/auth.controller");
const { updateMyProfile } = require("../controllers/user.controller");
const { verifyToken } = require("../middlewares/authenticate");
const { authRateLimiter } = require("../middlewares/authRateLimiter");
const { verifyCustomer } = require("../middlewares/authorize");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.post("/login", authRateLimiter, asyncHandler(loginCustomer));

router.use(verifyToken, verifyCustomer);

router.get("/profile", asyncHandler(me));
router.patch("/profile", asyncHandler(updateMyProfile));

module.exports = router;
