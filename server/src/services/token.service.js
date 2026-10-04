const jwt = require("jsonwebtoken");
const { env } = require("../config/env");
const { ApiError } = require("../utils/ApiError");

function buildSessionPayload(user) {
  const accountStatus = user.accountStatus || user.status;

  return {
    sub: user.uid,
    email: user.email,
    role: user.role,
    status: accountStatus,
    accountStatus,
    fullName: user.fullName,
    type: "access",
  };
}

function signAccessToken(user, connectionIp = "", sessionId = "") {
  return jwt.sign({ ...buildSessionPayload(user), ...(connectionIp ? { connectionIp } : {}),
    ...(sessionId ? { sessionId } : {}) }, env.auth.jwtSecret, {
    expiresIn: env.auth.jwtExpiresIn,
  });
}

function signRememberDeviceToken(user) {
  return jwt.sign(
    {
      sub: user.uid,
      email: user.email,
      role: user.role,
      type: "remember_device",
    },
    env.auth.jwtSecret,
    {
      expiresIn: "14d",
    },
  );
}

function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, env.auth.jwtSecret);

    if (payload?.type !== "access") {
      throw new Error("Invalid token type.");
    }

    return payload;
  } catch (error) {
    throw new ApiError(401, "The session token is invalid or has expired.");
  }
}

function verifyRememberDeviceToken(token) {
  const value = typeof token === "string" ? token.trim() : "";

  if (!value) {
    return null;
  }

  try {
    const payload = jwt.verify(value, env.auth.jwtSecret);

    if (payload?.type !== "remember_device") {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function signOtpTicket(user, otpId) {
  return jwt.sign(
    {
      sub: user.uid,
      email: user.email,
      role: user.role,
      otpId,
      type: "otp_ticket",
    },
    env.auth.otpTicketSecret,
    {
      expiresIn: env.auth.otpTicketExpiresIn,
    },
  );
}

function verifyOtpTicket(token) {
  try {
    const payload = jwt.verify(token, env.auth.otpTicketSecret);

    if (payload?.type !== "otp_ticket") {
      throw new Error("Invalid token type.");
    }

    return payload;
  } catch (error) {
    if (error?.name === "TokenExpiredError") {
      throw new ApiError(401, "The OTP session has expired. Start a new sign-in to request another code.", {
        reason: "otp-ticket-expired",
      });
    }

    throw new ApiError(401, "The OTP session is invalid. Start a new sign-in to request another code.", {
      reason: "otp-ticket-invalid",
    });
  }
}

module.exports = {
  signAccessToken,
  signRememberDeviceToken,
  signOtpTicket,
  verifyAccessToken,
  verifyRememberDeviceToken,
  verifyOtpTicket,
};
