const { auth: firebaseAdminAuth } = require("../config/firebaseAdmin");
const { env } = require("../config/env");
const { ApiError } = require("../utils/ApiError");

const IDENTITY_TOOLKIT_URL =
  "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword";
const PASSWORD_RESET_URL =
  "https://identitytoolkit.googleapis.com/v1/accounts:resetPassword";

function mapFirebaseAuthError(code = "") {
  switch (code) {
    case "EMAIL_NOT_FOUND":
    case "INVALID_PASSWORD":
    case "INVALID_LOGIN_CREDENTIALS":
      return "Invalid email or password.";
    case "USER_DISABLED":
      return "This account has been disabled in Firebase Authentication.";
    default:
      return "Unable to authenticate with Firebase Authentication.";
  }
}

function mapFirebasePasswordResetError(code = "") {
  switch (code) {
    case "EXPIRED_OOB_CODE":
      return "This password reset link has expired. Please request a new one.";
    case "INVALID_OOB_CODE":
      return "This password reset link is invalid or has already been used.";
    case "USER_DISABLED":
      return "This account has been disabled in Firebase Authentication.";
    case "WEAK_PASSWORD":
      return "The new password does not meet Firebase's minimum security requirements.";
    default:
      return "Unable to validate the Firebase password reset request.";
  }
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function signInWithEmailAndPassword(email, password) {
  const response = await fetch(
    `${IDENTITY_TOOLKIT_URL}?key=${encodeURIComponent(env.firebase.webApiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true,
      }),
    },
  );
  const payload = await parseJsonResponse(response);

  if (!response.ok) {
    const code = payload?.error?.message || "";
    console.warn("[firebase-auth] Sign-in with password failed.", {
      email,
      firebaseCode: code,
    });
    throw new ApiError(401, mapFirebaseAuthError(code), { firebaseCode: code });
  }

  return payload;
}

async function generatePasswordResetLink(email) {
  if (!firebaseAdminAuth || !env.runtime.firebaseAdminReady) {
    throw new ApiError(
      503,
      "Firebase Admin is not configured for password reset link generation.",
    );
  }

  try {
    return await firebaseAdminAuth.generatePasswordResetLink(email);
  } catch (error) {
    throw new ApiError(
      500,
      "Unable to generate a Firebase password reset link right now.",
      error instanceof Error ? { message: error.message } : null,
    );
  }
}

async function callPasswordResetEndpoint(payload) {
  const response = await fetch(
    `${PASSWORD_RESET_URL}?key=${encodeURIComponent(env.firebase.webApiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
  const data = await parseJsonResponse(response);

  if (!response.ok) {
    const code = data?.error?.message || "";
    throw new ApiError(400, mapFirebasePasswordResetError(code), { firebaseCode: code });
  }

  return data;
}

async function validatePasswordResetCode(oobCode) {
  return callPasswordResetEndpoint({
    oobCode,
  });
}

async function confirmPasswordResetCode(oobCode, newPassword) {
  return callPasswordResetEndpoint({
    oobCode,
    newPassword,
  });
}

module.exports = {
  confirmPasswordResetCode,
  generatePasswordResetLink,
  signInWithEmailAndPassword,
  validatePasswordResetCode,
};
