const crypto = require("crypto");
const { env } = require("../config/env");

function generateOtpCode() {
  const max = 10 ** env.otp.codeLength;
  return crypto.randomInt(0, max).toString().padStart(env.otp.codeLength, "0");
}

function hashOtpCode(otpCode) {
  return crypto.createHmac("sha256", env.auth.otpSecret).update(String(otpCode)).digest("hex");
}

module.exports = {
  generateOtpCode,
  hashOtpCode,
};
