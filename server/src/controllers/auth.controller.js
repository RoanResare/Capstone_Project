const { auth } = require("../config/firebaseAdmin");
const { env } = require("../config/env");
const { USER_ROLES, USER_STATUSES } = require("../constants/auth");
const {
  confirmPasswordResetCode,
  generatePasswordResetLink,
  signInWithEmailAndPassword,
  validatePasswordResetCode: validateFirebasePasswordResetCode,
} = require("../services/firebaseAuth.service");
const { sendOtpEmail, sendPasswordResetEmail } = require("../services/mail.service");
const {
  createOtpVerification,
  invalidateOpenOtpsForUser,
  verifyOtpCode,
} = require("../services/otp.service");
const {
  findUserByEmailCaseInsensitive,
  getUserByEmail,
  getUserByUid,
  getUserByUsername,
  getUsernameOwner,
  relinkUserProfileToUid,
  toPublicUser,
  touchLastLogin,
  updateStoredPasswordHash,
} = require("../services/user.service");
const {
  signAccessToken,
  signOtpTicket,
  verifyOtpTicket,
} = require("../services/token.service");
const { ApiError } = require("../utils/ApiError");
const { assertStrongPassword, hashPassword, verifyPasswordHash } = require("../utils/password");
const { assertAuthSetupReady } = require("../utils/setupGuard");

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function maskEmail(value = "") {
  const [localPart = "", domain = ""] = String(value || "").trim().split("@");

  if (!localPart || !domain) {
    return value;
  }

  if (localPart.length <= 2) {
    return `${localPart[0] || "*"}*@${domain}`;
  }

  return `${localPart.slice(0, 2)}***@${domain}`;
}

function normalizeExpectedRole(role = "") {
  const value = normalizeEmail(role);

  if (!value) {
    return "";
  }

  if (![USER_ROLES.CUSTOMER, USER_ROLES.ADMIN, USER_ROLES.STAFF].includes(value)) {
    throw new ApiError(400, "Expected role must be customer, admin, or staff.");
  }

  return value;
}

function formatRoleLabel(role = "") {
  const normalizedRole = normalizeExpectedRole(role) || normalizeEmail(role);

  if (!normalizedRole) {
    return "Account";
  }

  return normalizedRole.charAt(0).toUpperCase() + normalizedRole.slice(1);
}

function isEmailLike(value = "") {
  return normalizeString(value).includes("@");
}

function isLoopbackOrigin(origin = "") {
  try {
    const parsed = new URL(origin);
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function normalizeOriginCandidate(value = "") {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function getAllowedClientOrigins() {
  return env.clientUrl
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isAllowedClientOrigin(origin = "") {
  if (!origin) {
    return false;
  }

  if (getAllowedClientOrigins().includes(origin)) {
    return true;
  }

  return env.nodeEnv !== "production" && isLoopbackOrigin(origin);
}

function buildRoleMismatchMessage(expectedRole = "", actualRole = "") {
  const expected = normalizeExpectedRole(expectedRole);
  const actual = normalizeExpectedRole(actualRole) || normalizeEmail(actualRole);

  if (!expected) {
    return "This login portal is restricted to a specific account type.";
  }

  if (!actual) {
    return `This login portal only accepts ${formatRoleLabel(expected).toLowerCase()} accounts.`;
  }

  return `This login portal only accepts ${formatRoleLabel(expected).toLowerCase()} accounts. You tried to sign in with a ${formatRoleLabel(actual).toLowerCase()} account.`;
}

async function resolveEmailFromIdentifier(identifier = "") {
  const normalizedIdentifier = normalizeString(identifier).toLowerCase();

  if (!normalizedIdentifier) {
    throw new ApiError(400, "Email or username is required.");
  }

  if (isEmailLike(normalizedIdentifier)) {
    return normalizedIdentifier;
  }

  const usernameRecord = await getUsernameOwner(normalizedIdentifier);
  const resolvedEmail = normalizeEmail(usernameRecord?.email || "");

  if (!resolvedEmail) {
    throw new ApiError(401, "Invalid email, username, or password.");
  }

  return resolvedEmail;
}

async function resolveAuthenticatedFirestoreUser({ identifier, email, firebaseUid }) {
  const normalizedIdentifier = normalizeString(identifier).toLowerCase();
  const normalizedEmail = normalizeEmail(email);
  const normalizedUid = normalizeString(firebaseUid);
  const candidates = [];

  const addCandidate = (user) => {
    if (user && !candidates.some((candidate) => candidate.uid === user.uid)) {
      candidates.push(user);
    }
  };

  addCandidate(await getUserByUid(normalizedUid));
  addCandidate(await findUserByEmailCaseInsensitive(normalizedEmail));

  if (normalizedIdentifier && !isEmailLike(normalizedIdentifier)) {
    addCandidate(await getUserByUsername(normalizedIdentifier));
  }

  const matchingUser =
    candidates.find((user) => user.uid === normalizedUid) ||
    candidates.find((user) => normalizeEmail(user.email) === normalizedEmail) ||
    candidates[0] ||
    null;

  if (!matchingUser) {
    return null;
  }

  if (matchingUser.uid !== normalizedUid || matchingUser.profileDocId !== normalizedUid) {
    return relinkUserProfileToUid(matchingUser, normalizedUid);
  }

  return matchingUser;
}

function validateLoginPayload(payload = {}) {
  const identifier = normalizeString(payload.identifier || payload.email);
  const password = typeof payload.password === "string" ? payload.password : "";

  if (!identifier || !password) {
    throw new ApiError(400, "Email or username and password are required.");
  }

  return { identifier, password };
}

function validateForgotPasswordPayload(payload = {}) {
  const email = normalizeEmail(payload.email);

  if (!email) {
    throw new ApiError(400, "Email is required.");
  }

  return { email };
}

function validateResetPasswordPayload(payload = {}) {
  const oobCode =
    typeof payload.oobCode === "string"
      ? payload.oobCode.trim()
      : typeof payload.resetToken === "string"
        ? payload.resetToken.trim()
        : typeof payload.token === "string"
          ? payload.token.trim()
          : "";
  const newPassword = typeof payload.newPassword === "string" ? payload.newPassword : "";
  const confirmPassword =
    typeof payload.confirmPassword === "string" ? payload.confirmPassword : "";

  if (!oobCode) {
    throw new ApiError(400, "A valid password reset code is required.");
  }

  if (!newPassword) {
    throw new ApiError(400, "A new password is required.");
  }

  if (confirmPassword && confirmPassword !== newPassword) {
    throw new ApiError(400, "The password confirmation does not match.");
  }

  assertStrongPassword(newPassword);

  return {
    newPassword,
    oobCode,
  };
}

function validateResetCodePayload(payload = {}) {
  const oobCode =
    typeof payload.oobCode === "string"
      ? payload.oobCode.trim()
      : typeof payload.token === "string"
        ? payload.token.trim()
        : "";

  if (!oobCode) {
    throw new ApiError(400, "A valid password reset code is required.");
  }

  return {
    oobCode,
  };
}

function validateOtpCode(otpCode = "") {
  const value = typeof otpCode === "string" ? otpCode.trim() : "";
  const expression = new RegExp(`^\\d{${env.otp.codeLength}}$`);

  if (!expression.test(value)) {
    throw new ApiError(
      400,
      `A valid ${env.otp.codeLength}-digit one-time password is required.`,
    );
  }

  return value;
}

function assertRoleMatchesExpected(user, expectedRole) {
  if (!expectedRole || user.role === expectedRole) {
    return;
  }

  throw new ApiError(403, buildRoleMismatchMessage(expectedRole, user.role));
}

function assertActiveAccount(user) {
  if (user.accountStatus === USER_STATUSES.ACTIVE) {
    return;
  }

  throw new ApiError(403, `This account is ${user.accountStatus}.`);
}

async function synchronizePasswordHash(user, password) {
  if (verifyPasswordHash(password, user.passwordHash)) {
    return;
  }

  await updateStoredPasswordHash(user.uid, hashPassword(password));
}

function assertOtpEnabledRole(role) {
  if ([USER_ROLES.ADMIN, USER_ROLES.STAFF].includes(role)) {
    return;
  }

  throw new ApiError(400, "Two-factor authentication is only enabled for admin and staff users.");
}

function assertOtpRouteMatchesRole(user, ticket, expectedRole) {
  assertOtpEnabledRole(expectedRole);

  if (ticket?.role === expectedRole && user?.role === expectedRole) {
    return;
  }

  throw new ApiError(403, buildRoleMismatchMessage(expectedRole, user?.role || ticket?.role));
}

function buildPasswordResetUrl(req) {
  const candidateOrigins = [
    normalizeOriginCandidate(req.headers.origin),
    normalizeOriginCandidate(req.headers.referer),
  ].filter(Boolean);

  for (const origin of candidateOrigins) {
    if (isAllowedClientOrigin(origin)) {
      return `${origin.replace(/\/+$/, "")}/reset-password`;
    }
  }

  return env.auth.passwordResetUrl;
}

function buildAppPasswordResetLink(req, providerLink) {
  let providerUrl;

  try {
    providerUrl = new URL(providerLink);
  } catch {
    throw new ApiError(500, "The generated password reset link is invalid.");
  }

  const oobCode = providerUrl.searchParams.get("oobCode");
  const mode = providerUrl.searchParams.get("mode");
  const lang = providerUrl.searchParams.get("lang");

  if (!oobCode) {
    throw new ApiError(500, "The generated password reset link is missing its verification code.");
  }

  const appResetUrl = new URL(buildPasswordResetUrl(req));
  appResetUrl.searchParams.set("oobCode", oobCode);

  if (mode) {
    appResetUrl.searchParams.set("mode", mode);
  }

  if (lang) {
    appResetUrl.searchParams.set("lang", lang);
  }

  return appResetUrl.toString();
}

async function createSessionResponse(user) {
  const safeUser = toPublicUser(user);
  const accessToken = signAccessToken(user);
  const firebaseCustomToken = await auth.createCustomToken(user.uid, {
    role: user.role,
    status: user.accountStatus,
    accountStatus: user.accountStatus,
  });

  await touchLastLogin(user.uid);

  return {
    success: true,
    requiresTwoFactor: false,
    accessToken,
    firebaseCustomToken,
    user: safeUser,
  };
}

async function createOtpChallengeResponse(user, message, options = {}) {
  const otp = await createOtpVerification(user, {
    enforceCooldown: Boolean(options.enforceCooldown),
  });
  let delivery = { deliveryMode: "smtp-unavailable" };

  try {
    delivery = await sendOtpEmail({
      to: user.email,
      fullName: user.fullName,
      otpCode: otp.otpCode,
      role: user.role,
      expiresInMinutes: env.otp.ttlMinutes,
    });
  } catch (error) {
    console.error("[auth] OTP email delivery failed; login challenge remains active.", {
      uid: user.uid,
      role: user.role,
      email: maskEmail(user.email),
      error: error instanceof Error ? error.message : String(error || "Unknown error"),
      code: error?.code || "",
    });
  }

  console.info("[auth] OTP challenge created.", {
    uid: user.uid,
    role: user.role,
    deliveryMode: delivery.deliveryMode,
    expiresAt: otp.expiresAt.toISOString(),
  });

  return {
    success: true,
    requiresTwoFactor: true,
    deliveryMode: delivery.deliveryMode,
    message,
    otpTicket: signOtpTicket(user, otp.otpId),
    otpExpiresAt: otp.expiresAt.toISOString(),
    otpMaxAttempts: env.otp.maxAttempts,
    otpResendAvailableAt: otp.resendAvailableAt.toISOString(),
    user: toPublicUser(user),
  };
}

function createRoleBoundLoginHandler(expectedRole) {
  const routeRole = normalizeExpectedRole(expectedRole);

  return async function roleBoundLogin(req, res) {
    assertAuthSetupReady({
      requireOtp: routeRole !== USER_ROLES.CUSTOMER,
    });
    const { identifier, password } = validateLoginPayload(req.body);
    const email = await resolveEmailFromIdentifier(identifier);
    const existingUser = await getUserByEmail(email);

    if (existingUser && existingUser.accountStatus !== USER_STATUSES.ACTIVE) {
      assertActiveAccount(existingUser);
    }

    const signInPayload = await signInWithEmailAndPassword(email, password);
    const user = await resolveAuthenticatedFirestoreUser({
      identifier,
      email,
      firebaseUid: signInPayload.localId,
    });

    if (!user) {
      throw new ApiError(
        403,
        "This account exists in Firebase Authentication but has no user profile in Firestore.",
      );
    }

    await synchronizePasswordHash(user, password);
    assertRoleMatchesExpected(user, routeRole);
    assertActiveAccount(user);

    if (routeRole === USER_ROLES.CUSTOMER) {
      return res.status(200).json(await createSessionResponse(user));
    }

    return res.status(202).json(
      await createOtpChallengeResponse(
        user,
        "Credentials accepted. Enter the OTP sent to the registered email address.",
      ),
    );
  };
}

function createRoleBoundSendOtpHandler(expectedRole) {
  const routeRole = normalizeExpectedRole(expectedRole);
  assertOtpEnabledRole(routeRole);

  return async function roleBoundSendOtp(req, res) {
    assertAuthSetupReady({ requireOtp: true });
    const otpTicket = typeof req.body?.otpTicket === "string" ? req.body.otpTicket.trim() : "";

    if (!otpTicket) {
      throw new ApiError(400, "An OTP ticket is required before requesting a new code.");
    }

    const ticket = verifyOtpTicket(otpTicket);
    console.info("[auth] OTP resend requested.", {
      uid: ticket.sub,
      role: routeRole,
      otpId: ticket.otpId,
    });
    const user = await getUserByUid(ticket.sub);

    if (!user) {
      throw new ApiError(404, "The OTP session user could not be found.");
    }

    assertActiveAccount(user);
    assertOtpRouteMatchesRole(user, ticket, routeRole);

    return res.status(200).json(
      await createOtpChallengeResponse(
        user,
        "A new OTP has been sent to the registered email address.",
        { enforceCooldown: true },
      ),
    );
  };
}

function createRoleBoundVerifyOtpHandler(expectedRole) {
  const routeRole = normalizeExpectedRole(expectedRole);
  assertOtpEnabledRole(routeRole);

  return async function roleBoundVerifyOtp(req, res) {
    assertAuthSetupReady({ requireOtp: true });
    const otpTicket = typeof req.body?.otpTicket === "string" ? req.body.otpTicket.trim() : "";
    const otpCode = validateOtpCode(req.body?.otpCode);

    if (!otpTicket) {
      throw new ApiError(400, "An OTP ticket is required.");
    }

    const ticket = verifyOtpTicket(otpTicket);
    console.info("[auth] OTP verification requested.", {
      uid: ticket.sub,
      role: routeRole,
      otpId: ticket.otpId,
    });
    const user = await getUserByUid(ticket.sub);

    if (!user) {
      throw new ApiError(404, "The OTP session user could not be found.");
    }

    assertActiveAccount(user);
    assertOtpRouteMatchesRole(user, ticket, routeRole);
    await verifyOtpCode({
      otpId: ticket.otpId,
      otpCode,
      user,
    });

    return res.status(200).json(await createSessionResponse(user));
  };
}

const loginCustomer = createRoleBoundLoginHandler(USER_ROLES.CUSTOMER);
const loginAdmin = createRoleBoundLoginHandler(USER_ROLES.ADMIN);
const loginStaff = createRoleBoundLoginHandler(USER_ROLES.STAFF);
const sendAdminOtp = createRoleBoundSendOtpHandler(USER_ROLES.ADMIN);
const sendStaffOtp = createRoleBoundSendOtpHandler(USER_ROLES.STAFF);
const verifyAdminOtp = createRoleBoundVerifyOtpHandler(USER_ROLES.ADMIN);
const verifyStaffOtp = createRoleBoundVerifyOtpHandler(USER_ROLES.STAFF);

async function loginUnified(req, res) {
  assertAuthSetupReady({ requireOtp: true });
  const { identifier, password } = validateLoginPayload(req.body);
  const email = await resolveEmailFromIdentifier(identifier);
  const existingUser = await getUserByEmail(email);

  if (existingUser && existingUser.accountStatus !== USER_STATUSES.ACTIVE) {
    assertActiveAccount(existingUser);
  }

  const signInPayload = await signInWithEmailAndPassword(email, password);
  const user = await resolveAuthenticatedFirestoreUser({
    identifier,
    email,
    firebaseUid: signInPayload.localId,
  });

  if (!user) {
    throw new ApiError(
      403,
      "This account exists in Firebase Authentication but has no user profile in Firestore.",
    );
  }

  await synchronizePasswordHash(user, password);
  assertActiveAccount(user);

  if (user.role === USER_ROLES.CUSTOMER) {
    return res.status(200).json(await createSessionResponse(user));
  }

  if (user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.STAFF) {
    return res.status(202).json(
      await createOtpChallengeResponse(
        user,
        "Credentials accepted. Enter the OTP sent to the registered email address.",
      ),
    );
  }

  throw new ApiError(403, "This account does not have a supported role.");
}

async function forgotPassword(req, res) {
  assertAuthSetupReady({ requirePasswordReset: true });
  const { email } = validateForgotPasswordPayload(req.body);
  const genericMessage = "If an account exists for that email, a password reset link has been sent.";

  let firebaseUser = null;

  try {
    firebaseUser = await auth.getUserByEmail(email);
  } catch (error) {
    if (error?.code !== "auth/user-not-found") {
      throw error;
    }
  }

  if (!firebaseUser || firebaseUser.disabled) {
    console.info("[auth] Password reset requested for a missing or disabled account.", {
      email: maskEmail(email),
    });
    return res.status(200).json({
      success: true,
      message: genericMessage,
    });
  }

  const storedUser = await getUserByUid(firebaseUser.uid);

  if (storedUser && storedUser.accountStatus !== USER_STATUSES.ACTIVE) {
    console.info("[auth] Password reset blocked for a non-active account.", {
      uid: storedUser.uid,
      email: maskEmail(firebaseUser.email),
      status: storedUser.accountStatus,
    });
    return res.status(200).json({
      success: true,
      message: genericMessage,
    });
  }

  const providerLink = await generatePasswordResetLink(firebaseUser.email);
  const resetLink = buildAppPasswordResetLink(req, providerLink);
  let delivery = { deliveryMode: "smtp-unavailable" };

  try {
    delivery = await sendPasswordResetEmail({
      to: firebaseUser.email,
      fullName: storedUser?.fullName || firebaseUser.displayName || "",
      resetLink,
    });
  } catch (error) {
    console.error("[auth] Password reset email delivery failed.", {
      uid: firebaseUser.uid,
      email: maskEmail(firebaseUser.email),
      error: error instanceof Error ? error.message : String(error || "Unknown error"),
      code: error?.code || "",
    });
  }

  console.info("[auth] Password reset link generated.", {
    uid: firebaseUser.uid,
    email: maskEmail(firebaseUser.email),
    deliveryMode: delivery.deliveryMode,
    resetUrl: buildPasswordResetUrl(req),
  });

  return res.status(200).json({
    success: true,
    message: genericMessage,
  });
}

async function validateResetCode(req, res) {
  assertAuthSetupReady();
  const { oobCode } = validateResetCodePayload(req.body);
  const record = await validateFirebasePasswordResetCode(oobCode);
  const resetEmail = normalizeEmail(record?.email || "");

  if (!resetEmail) {
    throw new ApiError(400, "The password reset code could not be validated.");
  }

  const user = await getUserByEmail(resetEmail);

  if (user) {
    assertActiveAccount(user);
  }

  console.info("[auth] Password reset code validated.", {
    email: maskEmail(resetEmail),
  });

  return res.status(200).json({
    success: true,
    email: resetEmail,
  });
}

async function resetPassword(req, res) {
  assertAuthSetupReady();
  const { newPassword, oobCode } = validateResetPasswordPayload(req.body);
  const validationRecord = await validateFirebasePasswordResetCode(oobCode);
  const resetEmail = normalizeEmail(validationRecord?.email || "");

  if (!resetEmail) {
    throw new ApiError(400, "The password reset code could not be validated.");
  }

  const user = await getUserByEmail(resetEmail);

  if (user) {
    assertActiveAccount(user);
  }

  const confirmationRecord = await confirmPasswordResetCode(oobCode, newPassword);
  const confirmedEmail = normalizeEmail(confirmationRecord?.email || resetEmail);

  if (user) {
    const passwordHash = hashPassword(newPassword);
    await updateStoredPasswordHash(user.uid, passwordHash);
    await invalidateOpenOtpsForUser(user.uid);
  } else {
    console.warn("[auth] Password reset completed without a matching Firestore user profile.", {
      email: maskEmail(confirmedEmail),
    });
  }

  console.info("[auth] Password reset completed.", {
    uid: user?.uid || "",
    email: maskEmail(confirmedEmail),
  });

  return res.status(200).json({
    success: true,
    message: "Your password has been reset successfully. You can now sign in.",
  });
}

async function logout(req, res) {
  assertAuthSetupReady();

  return res.status(200).json({
    success: true,
    message: `Signed out${req.auth?.user?.email ? ` ${req.auth.user.email}` : ""} successfully.`,
  });
}

async function me(req, res) {
  assertAuthSetupReady();
  return res.status(200).json({
    success: true,
    user: toPublicUser(req.auth.user),
  });
}

module.exports = {
  forgotPassword,
  loginAdmin,
  loginCustomer,
  loginUnified,
  loginStaff,
  logout,
  me,
  resetPassword,
  sendAdminOtp,
  sendStaffOtp,
  validateResetCode,
  verifyAdminOtp,
  verifyStaffOtp,
};
