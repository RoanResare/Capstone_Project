const { assertAttemptsAllowed, recordFailedAttempt, resetAttempts, MAX_FAILED_ATTEMPTS } = require("../services/authAttempts.service");
const crypto = require("node:crypto");
const { getAllowedClientOrigins } = require("../config/clientOrigins");
const { findPhoneAccounts, PHONE_ACCOUNT_LIMIT, PHONE_ACCOUNT_LIMIT_MESSAGE } = require("../services/phoneAccounts.service");
const { env } = require("../config/env");
const { FRAUD_STATUSES, USER_ROLES, USER_STATUSES } = require("../constants/auth");
const {
  createSupabaseSessionForUser,
  decodeJwtPayload,
  findSupabaseUserByEmail,
  generateSupabaseRecoveryToken,
  signInWithSupabasePassword,
  updateSupabasePassword,
  verifySupabaseRecoveryToken,
} = require("../services/supabaseAuth.service");
const { sendOtpEmail, sendPasswordResetEmail } = require("../services/mail.service");
const {
  createOtpVerification,
  invalidateOpenOtpsForUser,
  verifyOtpCode,
} = require("../services/otp.service");
const {
  findUserByEmailCaseInsensitive,
  getUserByEmail,
  getUserByAuthId,
  getUserByPhone,
  getUserByUid,
  getUserByUsername,
  getUsernameOwner,
  linkSupabaseAuthUser,
  toPublicUser,
  touchLastLogin,
  updateStoredPasswordHash,
} = require("../services/user.service");
const {
  signAccessToken,
  signRememberDeviceToken,
  signOtpTicket,
  verifyRememberDeviceToken,
  verifyOtpTicket,
} = require("../services/token.service");
const { ApiError } = require("../utils/ApiError");
const {
  createFreshSessionBinding,
  validateAccessSecurity,
  waitForFreshSession,
} = require("../services/sessionSecurity.service");
const { assertValidEmail, isValidEmail, ILLEGITIMATE_EMAIL_ERROR } = require("../utils/emailValidation");
const { normalizePhilippineMobileNumber, PH_MOBILE_ERROR } = require("../utils/phoneNumber");
const { assertStrongPassword, hashPassword, verifyPasswordHash } = require("../utils/password");
const { assertAuthSetupReady } = require("../utils/setupGuard");
const {
  assertEmailIsDeliverable,
  validateRegistrationSecurity,
} = require("../services/registrationSecurity.service");

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
    await assertEmailIsDeliverable(normalizedIdentifier);
    return normalizedIdentifier;
  }

  const usernameRecord = await getUsernameOwner(normalizedIdentifier);
  const indexedEmail = normalizeEmail(usernameRecord?.email || "");

  if (indexedEmail) {
    return indexedEmail;
  }

  // Older customer registrations may have a profile username but no index
  // document. Resolve those records once, then let login continue normally.
  const profileUser = await getUserByUsername(normalizedIdentifier);
  const resolvedEmail = normalizeEmail(profileUser?.email || "");

  if (!resolvedEmail) {
    throw new ApiError(401, "Invalid email, username, or password.");
  }

  return resolvedEmail;
}

async function checkCustomerRegistrationAvailability(req, res) {
  assertAuthSetupReady();
  const { assertAppropriateText, ACCOUNT_TEXT_FIELDS } = await import("../../../shared/textModeration.mjs");
  try { assertAppropriateText(req.body, ACCOUNT_TEXT_FIELDS); }
  catch (error) { throw new ApiError(400, error.message, { code: "INVALID_TEXT", fields: error.fields }); }

  const email = normalizeEmail(req.body?.email);
  const rawPhone = normalizeString(req.body?.phone);
  const phone = normalizePhilippineMobileNumber(rawPhone);

  if (!email) {
    throw new ApiError(400, "Email is required.");
  }

  if (!isValidEmail(email)) {
    throw new ApiError(400, ILLEGITIMATE_EMAIL_ERROR);
  }

  const registrationSecurity = await validateRegistrationSecurity(req, email);
  await validateAccessSecurity(req);

  if (rawPhone && !phone) {
    throw new ApiError(400, PH_MOBILE_ERROR);
  }

  const storedEmailUser = await findUserByEmailCaseInsensitive(email);
  if (storedEmailUser && normalizeEmail(storedEmailUser.email) === email) {
    throw new ApiError(409, "Email is already associated with another account.", { code: "REGISTRATION_EMAIL_EXISTS" });
  }

  const authUser = await findSupabaseUserByEmail(email);
  if (authUser?.id && normalizeEmail(authUser.email) === email) {
    throw new ApiError(409, "Email is already associated with another account.", { code: "REGISTRATION_EMAIL_EXISTS" });
  }

  if (phone && (await findPhoneAccounts(phone)).length >= PHONE_ACCOUNT_LIMIT) {
    throw new ApiError(409, PHONE_ACCOUNT_LIMIT_MESSAGE);
  }

  return res.status(200).json({ success: true, available: true, ...registrationSecurity });
}

async function resolveAuthenticatedSupabaseUser({ identifier, email, supabaseUid, emailVerified }) {
  const normalizedIdentifier = normalizeString(identifier).toLowerCase();
  const normalizedEmail = normalizeEmail(email);
  const normalizedUid = normalizeString(supabaseUid);
  const candidates = [];

  const addCandidate = (user) => {
    if (user && !candidates.some((candidate) => candidate.uid === user.uid)) {
      candidates.push(user);
    }
  };

  addCandidate(await getUserByAuthId(normalizedUid));
  addCandidate(await findUserByEmailCaseInsensitive(normalizedEmail));

  if (normalizedIdentifier && !isEmailLike(normalizedIdentifier)) {
    addCandidate(await getUserByUsername(normalizedIdentifier));
  }

  const identityMatch = candidates.find((user) => user.authUserId === normalizedUid);
  const emailMatches = candidates.filter((user) => normalizeEmail(user.email) === normalizedEmail);
  if (!identityMatch && emailMatches.some((user) => user.authUserId && user.authUserId !== normalizedUid)) {
    throw new ApiError(403, "This profile is already linked to a different Supabase Auth identity.", { code: "AUTH_IDENTITY_MISMATCH" });
  }
  const matchingUser = identityMatch || emailMatches[0] || candidates.find((user) => user.uid === normalizedUid) || null;

  if (!matchingUser) {
    return null;
  }

  if (matchingUser.authUserId && matchingUser.authUserId !== normalizedUid) {
    throw new ApiError(403, "This profile is already linked to a different Supabase Auth identity.", { code: "AUTH_IDENTITY_MISMATCH" });
  }

  if (!matchingUser.authUserId && emailVerified !== true) {
    throw new ApiError(403, "Verify your email before linking this Supabase Auth identity to the account.", { code: "EMAIL_VERIFICATION_REQUIRED" });
  }

  return matchingUser.authUserId === normalizedUid
    ? matchingUser
    : linkSupabaseAuthUser(matchingUser, normalizedUid);
}

function validateLoginPayload(payload = {}) {
  const identifier = normalizeString(payload.identifier || payload.email);
  const password = typeof payload.password === "string" ? payload.password : "";
  if (identifier.includes("@")) assertValidEmail(identifier);

  if (!identifier || !password) {
    throw new ApiError(400, "Email or username and password are required.");
  }

  return { identifier, password };
}

function validateForgotPasswordPayload(payload = {}) {
  const identifier = normalizeString(payload.identifier || payload.email);
  const isEmail = isValidEmail(identifier);

  if (!identifier) {
    throw new ApiError(400, "Email address is required.");
  }

  if (!isEmail) {
    throw new ApiError(400, ILLEGITIMATE_EMAIL_ERROR);
  }

  return { identifier };
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

  if (confirmPassword !== newPassword) {
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

  if (user.verificationStatus === "pending") {
    throw new ApiError(403, "Verify your email using the activation link we sent before signing in. Request a new link if it has expired.", {
      code: "EMAIL_VERIFICATION_REQUIRED",
    });
  }

  throw new ApiError(403, `This account is ${user.accountStatus}.`);
}

function assertFraudAccess(user) {
  if ([FRAUD_STATUSES.SUSPENDED, FRAUD_STATUSES.BANNED].includes(user.fraudStatus)) {
    throw new ApiError(403, `This account is ${user.fraudStatus} for security review.`);
  }
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

function sealResetChallenge(tokenHash, email) {
  const payload = Buffer.from(JSON.stringify({
    type: "recovery", tokenHash, email, exp: Date.now() + env.passwordReset.ttlMinutes * 60_000,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", env.auth.jwtSecret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function openResetChallenge(challenge) {
  const [payload, signature, extra] = String(challenge || "").split(".");
  if (!payload || !signature || extra) throw new ApiError(400, "This password reset link is invalid or has expired.");
  const expected = crypto.createHmac("sha256", env.auth.jwtSecret).update(payload).digest();
  let actual;
  try { actual = Buffer.from(signature, "base64url"); } catch { actual = Buffer.alloc(0); }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new ApiError(400, "This password reset link is invalid or has expired.");
  }
  let record;
  try { record = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); }
  catch { throw new ApiError(400, "This password reset link is invalid or has expired."); }
  if (record.type !== "recovery" || !record.tokenHash || !record.email || Number(record.exp) <= Date.now()) {
    throw new ApiError(400, "This password reset link is invalid or has expired.");
  }
  return record;
}

async function createSessionResponse(user, options = {}, req, supabaseSession = null) {
  await waitForFreshSession(user.uid);
  const supabaseClaims = decodeJwtPayload(supabaseSession?.access_token) || {};
  const connection = await createFreshSessionBinding(user, req, supabaseClaims.session_id || "");
  const safeUser = toPublicUser(user);
  const accessToken = signAccessToken(user, connection.ip, connection.sessionId);
  if (!supabaseSession?.access_token || !supabaseSession?.refresh_token) {
    throw new ApiError(503, "Supabase Auth did not return a complete session.");
  }

  await touchLastLogin(user.uid);

  return {
    success: true,
    requiresTwoFactor: false,
    accessToken,
    supabaseSession: {
      access_token: supabaseSession.access_token,
      refresh_token: supabaseSession.refresh_token,
      expires_in: supabaseSession.expires_in,
      expires_at: supabaseSession.expires_at,
      token_type: supabaseSession.token_type || "bearer",
      user: {
        id: supabaseSession.user?.id,
        email: supabaseSession.user?.email || user.email,
        user_metadata: { ...(supabaseSession.user?.user_metadata || {}), full_name: user.fullName, role: user.role },
      },
    },
    rememberDeviceToken: options.rememberDevice
      ? options.rememberDeviceToken || signRememberDeviceToken(user)
      : "",
    user: {
      ...safeUser,
      role: safeUser.role,
      accountStatus: safeUser.accountStatus,
      fullName: safeUser.fullName || safeUser.name || "",
      authUserId: safeUser.authUserId || supabaseSession.user?.id || "",
      account_status: safeUser.accountStatus,
      full_name: safeUser.fullName || safeUser.name || "",
    },
  };
}

async function validateEmail(req, res) {
  await assertEmailIsDeliverable(normalizeEmail(req.body?.email));
  return res.status(200).json({ success: true });
}

function readRememberDeviceRequest(req, role) {
  const token = req.body?.rememberDeviceTokens?.[role] ?? req.body?.rememberDeviceToken;
  return {
    rememberDevice: req.body?.rememberDevice === true,
    rememberDeviceToken:
      typeof token === "string" ? token.trim() : "",
  };
}

function isRememberedPortalDevice(user, token) {
  if (![USER_ROLES.ADMIN, USER_ROLES.STAFF].includes(user?.role)) {
    return false;
  }

  const payload = verifyRememberDeviceToken(token);

  return Boolean(
    payload &&
      payload.sub === user.uid &&
      payload.role === user.role &&
      normalizeEmail(payload.email || "") === normalizeEmail(user.email || ""),
  );
}

async function createOtpChallengeResponse(user, message, options = {}) {
  const otp = await createOtpVerification(user, {
    enforceCooldown: Boolean(options.enforceCooldown),
  });
  let delivery = { deliveryMode: "resend-unavailable" };

  try {
    delivery = await sendOtpEmail({
      to: user.email,
      fullName: user.fullName,
      otpCode: otp.otpCode,
      role: user.role,
      expiresInMinutes: env.otp.ttlMinutes,
    });
  } catch (error) {
    console.error("[auth] OTP email delivery failed.", {
      uid: user.uid,
      role: user.role,
      email: maskEmail(user.email),
      error: error instanceof Error ? error.message : String(error || "Unknown error"),
      code: error?.code || "",
    });
    throw error;
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
    otpMaxAttempts: MAX_FAILED_ATTEMPTS,
    otpResendAvailableAt: otp.resendAvailableAt.toISOString(),
    user: toPublicUser(user),
  };
}

async function verifyLoginCredentials(identifier, password) {
  await assertAttemptsAllowed("login", identifier);
  let email;
  try {
    email = await resolveEmailFromIdentifier(identifier);
  } catch (error) {
    if (error.statusCode === 401) await recordFailedAttempt("login", identifier);
    throw error;
  }
  await assertAttemptsAllowed("login", email);
  const existingUser = await getUserByEmail(email);
  if (existingUser) {
    assertActiveAccount(existingUser);
    await assertAttemptsAllowed("otp", existingUser.uid);
  }
  let signInPayload;
  try {
    signInPayload = await signInWithSupabasePassword(email, password);
  } catch (error) {
    if (["INVALID_PASSWORD", "INVALID_LOGIN_CREDENTIALS", "EMAIL_NOT_FOUND", "INVALID_CREDENTIALS"].includes(error.details?.supabaseCode)) {
      const remaining = await recordFailedAttempt("login", email);
      error.message += ' ' + remaining + ' attempt' + (remaining === 1 ? '' : 's') + ' remaining.';
    }
    throw error;
  }
  await resetAttempts("login", email);
  if (identifier.toLowerCase() !== email.toLowerCase()) await resetAttempts("login", identifier);
  return { email, signInPayload };
}

function createRoleBoundLoginHandler(expectedRole) {
  const routeRole = normalizeExpectedRole(expectedRole);

  return async function roleBoundLogin(req, res) {
    assertAuthSetupReady({
      requireOtp: routeRole !== USER_ROLES.CUSTOMER,
    });
    await validateAccessSecurity(req);
    const { identifier, password } = validateLoginPayload(req.body);
    const { email, signInPayload } = await verifyLoginCredentials(identifier, password);
    const user = await resolveAuthenticatedSupabaseUser({
      identifier,
      email,
      supabaseUid: signInPayload.user.id,
      emailVerified: Boolean(signInPayload.user.email_confirmed_at || signInPayload.user.confirmed_at),
    });

    if (!user) {
      throw new ApiError(
        403,
        "This Supabase Auth account has no matching PostgreSQL user profile.",
      );
    }

    await synchronizePasswordHash(user, password);
    assertRoleMatchesExpected(user, routeRole);
    assertActiveAccount(user);
    assertFraudAccess(user);
    const rememberDeviceRequest = readRememberDeviceRequest(req, user.role);

    if (routeRole === USER_ROLES.CUSTOMER) {
      return res.status(200).json(
        await createSessionResponse(user, {
          rememberDevice: rememberDeviceRequest.rememberDevice,
        }, req, signInPayload),
      );
    }

    if (rememberDeviceRequest.rememberDevice && isRememberedPortalDevice(user, rememberDeviceRequest.rememberDeviceToken)) {
      return res.status(200).json(
        await createSessionResponse(user, {
          rememberDevice: true,
          rememberDeviceToken: rememberDeviceRequest.rememberDeviceToken,
        }, req, signInPayload),
      );
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
    const user = await getUserByUid(ticket.sub) || await getUserByAuthId(ticket.sub);

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
    const otpCode = typeof req.body?.otpCode === "string" ? req.body.otpCode.trim() : "";
    const rememberDevice = req.body?.rememberDevice === true;

    if (!otpTicket) {
      throw new ApiError(400, "An OTP ticket is required.");
    }

    const ticket = verifyOtpTicket(otpTicket);
    console.info("[auth] OTP verification requested.", {
      uid: ticket.sub,
      role: routeRole,
      otpId: ticket.otpId,
    });
    const user = await getUserByUid(ticket.sub) || await getUserByAuthId(ticket.sub);

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

    const supabaseSession = await createSupabaseSessionForUser(user.email);
    const linkedUser = await resolveAuthenticatedSupabaseUser({ identifier: user.email, email: user.email,
      supabaseUid: supabaseSession.user.id, emailVerified: true });
    if (!linkedUser) throw new ApiError(403, "The Supabase Auth account has no matching user profile.");
    assertActiveAccount(linkedUser);
    return res.status(200).json(await createSessionResponse(linkedUser, { rememberDevice }, req, supabaseSession));
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
  await validateAccessSecurity(req);
  const { identifier, password } = validateLoginPayload(req.body);
  const { email, signInPayload } = await verifyLoginCredentials(identifier, password);
  const user = await resolveAuthenticatedSupabaseUser({
    identifier,
    email,
    supabaseUid: signInPayload.user.id,
    emailVerified: Boolean(signInPayload.user.email_confirmed_at || signInPayload.user.confirmed_at),
  });

  if (!user) {
    throw new ApiError(
      403,
      "This Supabase Auth account has no matching PostgreSQL user profile.",
    );
  }

  await synchronizePasswordHash(user, password);
  assertActiveAccount(user);
  assertFraudAccess(user);
  const rememberDeviceRequest = readRememberDeviceRequest(req, user.role);

  if (user.role === USER_ROLES.CUSTOMER) {
    return res.status(200).json(
      await createSessionResponse(user, {
        rememberDevice: rememberDeviceRequest.rememberDevice,
      }, req, signInPayload),
    );
  }

  if (user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.STAFF) {
    if (rememberDeviceRequest.rememberDevice && isRememberedPortalDevice(user, rememberDeviceRequest.rememberDeviceToken)) {
      return res.status(200).json(
        await createSessionResponse(user, {
          rememberDevice: true,
          rememberDeviceToken: rememberDeviceRequest.rememberDeviceToken,
        }, req, signInPayload),
      );
    }

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
  const { identifier } = validateForgotPasswordPayload(req.body);
  await assertEmailIsDeliverable(identifier);
  const normalizedIdentifier = identifier.toLowerCase();
  const isEmail = normalizedIdentifier.includes("@");
  const storedUser = isEmail
    ? await findUserByEmailCaseInsensitive(normalizedIdentifier)
    : await getUserByPhone(identifier);
  const email = normalizeEmail(storedUser?.email || (isEmail ? normalizedIdentifier : ""));
  const genericMessage = "If an account exists for that email address, a password reset link has been sent.";

  let supabaseUser = null;

  if (email) {
    supabaseUser = await findSupabaseUserByEmail(email);
  }

  if (!supabaseUser || supabaseUser.banned_until && Date.parse(supabaseUser.banned_until) > Date.now()) {
    console.info("[auth] Password reset requested for a missing or disabled account.", {
      email: maskEmail(email),
    });
    return res.status(200).json({
      success: true,
      message: genericMessage,
    });
  }

  const supabaseStoredUser = await getUserByEmail(email);

  if (supabaseStoredUser && supabaseStoredUser.accountStatus !== USER_STATUSES.ACTIVE) {
    console.info("[auth] Password reset blocked for a non-active account.", {
      uid: supabaseStoredUser.uid,
      email: maskEmail(email),
      status: supabaseStoredUser.accountStatus,
    });
    return res.status(200).json({
      success: true,
      message: genericMessage,
    });
  }

  const recovery = await generateSupabaseRecoveryToken(email);
  const resetToken = sealResetChallenge(recovery.tokenHash, email);
  const resetLink = new URL(buildPasswordResetUrl(req));
  resetLink.searchParams.set("oobCode", resetToken);
  let delivery = { deliveryMode: "resend-unavailable" };

  try {
    delivery = await sendPasswordResetEmail({
      to: email,
      fullName: supabaseStoredUser?.fullName || supabaseUser.user_metadata?.full_name || "",
      resetLink: resetLink.toString(),
    });
  } catch (error) {
    console.error("[auth] Password reset email delivery failed.", {
      uid: supabaseUser.id,
      email: maskEmail(email),
      error: error instanceof Error ? error.message : String(error || "Unknown error"),
      code: error?.code || "",
    });
    throw error;
  }

  console.info("[auth] Password reset link generated.", {
    uid: supabaseUser.id,
    email: maskEmail(email),
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
  const record = openResetChallenge(oobCode);
  const resetEmail = normalizeEmail(record.email);

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
  const resetChallenge = openResetChallenge(oobCode);
  const resetEmail = normalizeEmail(resetChallenge.email);

  if (!resetEmail) {
    throw new ApiError(400, "The password reset code could not be validated.");
  }

  const user = await getUserByEmail(resetEmail);

  if (user) {
    assertActiveAccount(user);
  }

  const recoverySession = await verifySupabaseRecoveryToken(resetChallenge.tokenHash);
  const confirmationRecord = await updateSupabasePassword(recoverySession.access_token, newPassword);
  const confirmedEmail = normalizeEmail(confirmationRecord?.email || recoverySession.user?.email || resetEmail);

  if (user) {
    const passwordHash = hashPassword(newPassword);
    await updateStoredPasswordHash(user.uid, passwordHash);
    await invalidateOpenOtpsForUser(user.uid);
  } else {
    console.warn("[auth] Password reset completed without a matching PostgreSQL user profile.", {
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

async function changePassword(req, res) {
  assertAuthSetupReady();
  const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
  if (!currentPassword || !newPassword) throw new ApiError(400, "Current and new passwords are required.");
  assertStrongPassword(newPassword);
  const user = await getUserByUid(req.auth.user.uid);
  if (!user || !verifyPasswordHash(currentPassword, user.passwordHash)) throw new ApiError(401, "The current password is incorrect.");
  await updateSupabasePassword(req.auth.token, newPassword);
  await updateStoredPasswordHash(user.uid, hashPassword(newPassword));
  await invalidateOpenOtpsForUser(user.uid);
  return res.status(200).json({ success: true, message: "Your password has been updated successfully." });
}

async function logout(req, res) {
  assertAuthSetupReady();

  return res.status(200).json({
    success: true,
    message: `Signed out${req.auth?.user?.email ? ` ${req.auth.user.email}` : ""} successfully.`,
  });
}

async function sessionSecurity(req, res) {
  assertAuthSetupReady();
  return res.status(200).set("Cache-Control", "no-store").json({ success: true });
}

async function me(req, res) {
  assertAuthSetupReady();
  return res.status(200).set("Cache-Control", "private, max-age=30").json({
    success: true,
    user: toPublicUser(req.auth.user),
  });
}

module.exports = {
  validateEmail,
  checkCustomerRegistrationAvailability,
  changePassword,
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
  sessionSecurity,
  validateResetCode,
  verifyAdminOtp,
  verifyStaffOtp,
};
