import { apiClient, extractApiError } from "./apiClient.js";

export async function validateBackendEmail(email) {
  try {
    await apiClient.post("/auth/validate-email", { email });
  } catch (error) {
    throw createApiRequestError(error, "Unable to verify the email address right now.", "email-validation");
  }
}

function normalizePortalRole(role = "") {
  const normalized = typeof role === "string" ? role.trim().toLowerCase() : "";

  if (!["admin", "staff"].includes(normalized)) {
    throw new Error("A valid portal role is required.");
  }

  return normalized;
}

function createApiRequestError(error, fallbackMessage, context) {
  const requestError = new Error(extractApiError(error, fallbackMessage));
  requestError.statusCode = Number(error?.response?.status || 0);
  requestError.details = error?.response?.data?.details || null;
  requestError.context = context;

  console.warn("[portal-auth-api] Request failed.", {
    context,
    statusCode: requestError.statusCode,
    message: requestError.message,
    details: requestError.details,
  });

  return requestError;
}

export async function requestBackendPasswordReset(identifier) {
  try {
    const response = await apiClient.post("/auth/forgot-password", {
      identifier,
    });
    return response.data;
  } catch (error) {
    throw createApiRequestError(
      error,
      "Unable to send a password reset email right now.",
      "password-reset-request",
    );
  }
}

export async function validateBackendPasswordResetCode(oobCode) {
  try {
    const response = await apiClient.post("/auth/validate-reset-code", {
      oobCode,
    });
    return response.data;
  } catch (error) {
    throw createApiRequestError(
      error,
      "Unable to verify the password reset link right now.",
      "password-reset-validate",
    );
  }
}

export async function completeBackendPasswordReset({
  oobCode,
  newPassword,
  confirmPassword,
}) {
  try {
    const response = await apiClient.post("/auth/reset-password", {
      oobCode,
      newPassword,
      confirmPassword,
    });
    return response.data;
  } catch (error) {
    throw createApiRequestError(error, "Unable to reset the password right now.", "password-reset-complete");
  }
}

export async function loginPortalUser(role, payload) {
  try {
    const response = await apiClient.post(`/${normalizePortalRole(role)}/login`, payload);
    return response.data;
  } catch (error) {
    throw createApiRequestError(error, "Unable to sign in right now.", `${normalizePortalRole(role)}-login`);
  }
}

export async function loginUnifiedUser(payload) {
  try {
    const response = await apiClient.post("/auth/login", payload);
    return response.data;
  } catch (error) {
    throw createApiRequestError(error, "Unable to sign in right now.", "unified-login");
  }
}

export async function checkCustomerRegistrationAvailability({ email, phone }) {
  try {
    const response = await apiClient.post("/auth/register/check", { email, phone });
    return response.data;
  } catch (error) {
    throw createApiRequestError(
      error,
      "Unable to verify registration details right now.",
      "customer-registration-check",
    );
  }
}

export async function resendPortalOtp(role, otpTicket) {
  try {
    const response = await apiClient.post(`/${normalizePortalRole(role)}/send-otp`, {
      otpTicket,
    });
    return response.data;
  } catch (error) {
    throw createApiRequestError(
      error,
      "Unable to send a new verification code right now.",
      `${normalizePortalRole(role)}-resend-otp`,
    );
  }
}

export async function verifyPortalOtp(role, otpTicket, otpCode, options = {}) {
  try {
    const response = await apiClient.post(`/${normalizePortalRole(role)}/verify-otp`, {
      otpTicket,
      otpCode,
      rememberDevice: options.rememberDevice === true,
    });
    return response.data;
  } catch (error) {
    throw createApiRequestError(
      error,
      "Unable to verify the one-time password.",
      `${normalizePortalRole(role)}-verify-otp`,
    );
  }
}
