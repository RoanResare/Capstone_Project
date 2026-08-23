const { env } = require("../config/env");
const { ApiError } = require("./ApiError");

function collectMissingVariables(options = {}) {
  const requireOtp = Boolean(options.requireOtp);
  const requirePasswordReset = Boolean(options.requirePasswordReset);
  const required = [
    { name: "FIREBASE_PROJECT_ID", ready: Boolean(env.firebase.projectId) },
    { name: "FIREBASE_CLIENT_EMAIL", ready: Boolean(env.firebase.clientEmail) },
    { name: "FIREBASE_PRIVATE_KEY", ready: Boolean(env.firebase.privateKey) },
    { name: "FIREBASE_WEB_API_KEY", ready: Boolean(env.firebase.webApiKey) },
    { name: "JWT_SECRET", ready: Boolean(env.auth.jwtSecret) },
    { name: "PASSWORD_HASH_PEPPER", ready: Boolean(env.auth.passwordHashPepper) },
  ];

  if (requireOtp) {
    required.push(
      { name: "OTP_TICKET_SECRET", ready: Boolean(env.auth.otpTicketSecret) },
      { name: "OTP_HASH_SECRET", ready: Boolean(env.auth.otpSecret) },
      {
        name: "EMAIL_USER, EMAIL_PASS (or SMTP_USER, SMTP_PASS, SMTP_FROM_EMAIL)",
        ready: Boolean(env.runtime.mailDeliveryReady),
      },
    );
  }

  if (requirePasswordReset) {
    required.push(
      {
        name: "EMAIL_USER, EMAIL_PASS (or SMTP_USER, SMTP_PASS, SMTP_FROM_EMAIL)",
        ready: Boolean(env.runtime.mailDeliveryReady),
      },
    );
  }

  return required.filter((entry) => !entry.ready).map((entry) => entry.name);
}

function buildSetupMessage(options = {}) {
  const missing = collectMissingVariables(options);

  if (!missing.length) {
    return "Authentication services are configured.";
  }

  return `Authentication setup is incomplete. Missing environment variables: ${missing.join(", ")}.`;
}

function assertAuthSetupReady(options = {}) {
  const missing = collectMissingVariables(options);

  if (!missing.length) {
    return;
  }

  throw new ApiError(503, buildSetupMessage(options), {
    missingVariables: missing,
  });
}

module.exports = {
  assertAuthSetupReady,
  buildSetupMessage,
};
