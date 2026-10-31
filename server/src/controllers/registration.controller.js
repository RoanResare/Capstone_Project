const { db } = require("../config/postgresDatabase");
const { env } = require("../config/env");
const { ApiError } = require("../utils/ApiError");
const { validateRegistrationSecurity } = require("../services/registrationSecurity.service");
const { validateAccessSecurity } = require("../services/sessionSecurity.service");
const { generateSupabaseEmailLink, deleteSupabaseUser, verifySupabaseEmailToken, verifySupabaseEmailCode, findSupabaseUserByEmail } = require("../services/supabaseAuth.service");
const { sendSignupVerificationCode } = require("../services/mail.service");
const { findPhoneAccounts, PHONE_ACCOUNT_LIMIT, PHONE_ACCOUNT_LIMIT_MESSAGE } = require("../services/phoneAccounts.service");
const { normalizePhilippineMobileNumber, PH_MOBILE_ERROR } = require("../utils/phoneNumber");
const { assertValidEmail } = require("../utils/emailValidation");
const { assertStrongPassword } = require("../utils/password");
const { assertValidUsername, findUserByEmailCaseInsensitive, getUserByEmail, getUsernameOwner } = require("../services/user.service");

const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_CODE_LENGTH = 4096;
const normalizeEmail = (value = "") => String(value || "").trim().toLowerCase();
const pendingVerificationMessage = (email) => `Verification code sent! Check ${email} and enter the code to activate your account.`;

function timestampMillis(value) {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (value == null || value === "") return NaN;
  return new Date(value).getTime();
}

async function sendSignupCode(challenge, email, fullName) {
  if (!/^\d{6,10}$/.test(String(challenge.emailOtp || ""))) {
    throw new ApiError(503, "The signup verification code could not be generated.", { code: "SIGNUP_CODE_MISSING" });
  }
  // Supabase validates this challenge; Resend remains the email sender.
  // Do not guess its provider-configured expiry or expose the code to the client.
  return sendSignupVerificationCode({ to: email, fullName, otpCode: challenge.emailOtp });
}

async function createCustomerProfile(req, res) {
  if (!env.runtime.supabaseAdminReady || !db) throw new ApiError(503, "Supabase Auth is not configured for registration.");
  const payload = req.body || {};
  const email = normalizeEmail(payload.email);
  const username = assertValidUsername(String(payload.username || "").trim().toLowerCase());
  const { resolveCustomerFullName } = await import("../../../shared/customerName.mjs");
  const fullName = resolveCustomerFullName({ ...payload, email, username });
  const password = typeof payload.password === "string" ? payload.password : "";
  const phone = normalizePhilippineMobileNumber(String(payload.phone || "").trim());
  assertValidEmail(email);
  if (!fullName) throw new ApiError(400, "Full name is required.");
  if (!password) throw new ApiError(400, "Password is required.");
  assertStrongPassword(password);
  if (payload.phone && !phone) throw new ApiError(400, PH_MOBILE_ERROR);
  const { assertAppropriateText, ACCOUNT_TEXT_FIELDS } = await import("../../../shared/textModeration.mjs");
  try { assertAppropriateText({ fullName, username, email }, ACCOUNT_TEXT_FIELDS); }
  catch (error) { throw new ApiError(400, error.message, { code: "INVALID_TEXT", fields: error.fields }); }
  if (!env.runtime.mailDeliveryReady) throw new ApiError(503, "Activation email delivery is not configured.", { code: "ACTIVATION_MAIL_NOT_CONFIGURED" });
  const storedEmailUser = await findUserByEmailCaseInsensitive(email);
  if (storedEmailUser && normalizeEmail(storedEmailUser.email) === email) {
    throw new ApiError(409, "Email is already associated with another account.", { code: "REGISTRATION_EMAIL_EXISTS" });
  }
  const authUser = await findSupabaseUserByEmail(email);
  if (authUser?.id && normalizeEmail(authUser.email) === email) {
    throw new ApiError(409, "Email is already associated with another account.", { code: "REGISTRATION_EMAIL_EXISTS" });
  }
  const owner = await getUsernameOwner(username);
  if (owner) throw new ApiError(409, "That username is already in use.");
  if (phone && (await findPhoneAccounts(phone)).length >= PHONE_ACCOUNT_LIMIT) throw new ApiError(409, PHONE_ACCOUNT_LIMIT_MESSAGE);

  const registrationSecurity = await validateRegistrationSecurity(req, email);
  await validateAccessSecurity(req);
  const signupStartedAt = Date.now();
  const challenge = await generateSupabaseEmailLink({ email, type: "signup", password,
    userMetadata: { full_name: fullName, username, phone: phone || "", role: "customer" } });
  let identity = challenge.user;
  if (!identity?.id) identity = await findSupabaseUserByEmail(email);
  const uid = identity?.id;
  if (identity?.email && normalizeEmail(identity.email) !== email) {
    throw new ApiError(503, "Supabase Auth returned an identity for a different email.", { code: "SUPABASE_AUTH_IDENTITY_MISMATCH" });
  }
  if (!uid) {
    console.error("[registration] Supabase signup challenge returned no resolvable Auth user.", {
      hasTokenHash: Boolean(challenge.tokenHash),
      hasActionLink: Boolean(challenge.actionLink),
    });
    throw new ApiError(503, "Supabase Auth did not return a customer identity for the signup challenge.", {
      code: "SUPABASE_AUTH_USER_MISSING",
    });
  }
  const now = new Date().toISOString();
  // Native profile IDs and Auth UUIDs may differ. Only follow an explicit
  // identity link; the transaction below still checks freshness and ownership.
  const generatedProfile = await findUserByEmailCaseInsensitive(email);
  const linkedProfileId = generatedProfile && normalizeEmail(generatedProfile.email) === email
    && generatedProfile.authUserId === uid ? generatedProfile.profileDocId || generatedProfile.uid : uid;
  const profileRef = db.collection("users").doc(linkedProfileId);
  const profileUid = profileRef.id;
  const usernameRef = db.collection("usernames").doc(username);
  try {
    await db.runTransaction(async (transaction) => {
      const profile = await transaction.get(profileRef);
      const usernameDoc = await transaction.get(usernameRef);
      // Auth INSERT triggers may create a profile while generate_link runs.
      // Complete only a fresh, unverified customer row for this exact identity.
      const existing = profile.data() || {};
      const createdAt = timestampMillis(existing.createdAt);
      const triggerProfile = profile.exists && normalizeEmail(existing.email) === email
        && (existing.authUserId || existing.uid) === uid
        && (!existing.username || existing.username === username)
        && (!existing.role || existing.role === "customer")
        && existing.emailVerified !== true && existing.verificationStatus !== "verified"
        && [undefined, null, "active", "inactive", "pending"].includes(existing.accountStatus)
        && [undefined, null, "active", "inactive", "pending"].includes(existing.status)
        && Number.isFinite(createdAt) && createdAt >= signupStartedAt - 1000 && createdAt <= Date.now();
      if (profile.exists && !triggerProfile) throw new ApiError(409,
        "An existing profile conflicts with this registration. Sign in or contact the clinic to verify the account link.",
        { code: "REGISTRATION_PROFILE_CONFLICT" });
      if (usernameDoc.exists && !(triggerProfile && usernameDoc.data()?.uid === profileUid
        && normalizeEmail(usernameDoc.data()?.email) === email)) throw new ApiError(409, "That username is already in use.");
      let phoneRef = null;
      let phoneAccountIds = [];
      if (phone) {
        phoneRef = db.collection("phoneAccountLimits").doc(phone.replace(/\D/g, ""));
        const lock = await transaction.get(phoneRef);
        phoneAccountIds = [...new Set([...(lock.data()?.accountIds || []), ...await findPhoneAccounts(phone, transaction)])];
        phoneAccountIds = phoneAccountIds.filter((accountId) => accountId !== profileUid);
        if (phoneAccountIds.length >= PHONE_ACCOUNT_LIMIT) throw new ApiError(409, PHONE_ACCOUNT_LIMIT_MESSAGE);
      }
      transaction.set(profileRef, {
        uid: profileUid, authUserId: uid, email, fullName, username, phone: phone || "", role: "customer",
        accountStatus: "inactive", status: "inactive", emailVerified: false,
        verificationStatus: "pending",
        registrationIp: registrationSecurity.registrationIp || "",
        verificationSentAt: now, verificationExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), createdAt: now, updatedAt: now,
      }, { merge: true });
      transaction.set(usernameRef, { uid: profileUid, email, username, createdAt: now, updatedAt: now, verificationStatus: "pending" });
      if (phoneRef) transaction.set(phoneRef, { accountIds: [...phoneAccountIds, profileUid], updatedAt: now });
    });
  } catch (error) {
    // Never delete an existing identity/profile when the transaction found a conflict.
    if (error?.statusCode !== 409 && ![error?.code, error?.cause?.code, error?.originalError?.code].includes("23505")) await deleteSupabaseUser(uid).catch(() => {});
    if (error?.code === "23505" || error?.cause?.code === "23505" || error?.originalError?.code === "23505") {
      throw new ApiError(409, "An account with this email or username already exists.", {
        code: "REGISTRATION_IDENTITY_CONFLICT",
      });
    }
    throw error;
  }
  let deliveryStatus = "sent";
  try {
    await sendSignupCode(challenge, email, fullName);
  } catch (_error) {
    // Registration has committed. Preserve the pending account so the customer
    // can retry email delivery instead of creating another identity.
    deliveryStatus = "pending";
  }
  return res.status(202).json({ success: true, deliveryStatus, verificationMethod: "otp",
    message: deliveryStatus === "sent" ? pendingVerificationMessage(email)
      : "Your account was created, but the verification code could not be sent. Wait one minute, then request a new code before signing in.", profile: {
    uid: profileUid, authUserId: uid, email, fullName, username, phone: phone || "", role: "customer", accountStatus: "inactive",
    status: "inactive", emailVerified: false, verificationStatus: "pending",
  } });
}

async function activateCustomerEmail(req, res) {
  const emailInput = normalizeEmail(req.body?.email);
  const otpCode = String(req.body?.otpCode || "").trim();
  const tokenHash = String(req.body?.token_hash || req.body?.tokenHash || req.body?.oobCode || "").trim();
  if (otpCode) {
    assertValidEmail(emailInput);
    if (!/^\d{6,10}$/.test(otpCode)) throw new ApiError(400, "Enter the verification code from your email.");
  } else if (!tokenHash || tokenHash.length > MAX_CODE_LENGTH) throw new ApiError(400, "This verification link is invalid or incomplete.");
  let verified;
  try { verified = otpCode ? await verifySupabaseEmailCode(emailInput, otpCode) : await verifySupabaseEmailToken(tokenHash, "signup"); }
  catch (error) {
    if (error?.statusCode >= 500) throw error;
    throw new ApiError(400, "This verification code or link is invalid, expired, or already used.");
  }
  const identity = verified?.user;
  const email = normalizeEmail(identity?.email);
  if (!identity?.id || !email) throw new ApiError(400, "The verification link does not match an account.");
  if (otpCode && email !== emailInput) throw new ApiError(400, "The verification code does not match this account.");
  await activatePendingProfile(identity.id, email);
  return res.status(200).json({ success: true, message: "Email verified. Your account is active; you can now sign in.", email });
}

async function activatePendingProfile(uid, confirmationEmail) {
  const linked = await findUserByEmailCaseInsensitive(confirmationEmail);
  const profileId = linked && normalizeEmail(linked.email) === normalizeEmail(confirmationEmail)
    && linked.authUserId === uid ? linked.profileDocId || linked.uid : uid;
  const profileRef = db.collection("users").doc(profileId);
  await db.runTransaction(async (transaction) => {
    const profile = await transaction.get(profileRef);
    if (!profile.exists) throw new ApiError(400, "This activation link does not match a pending registration.");
    const data = profile.data() || {};
    if (normalizeEmail(data.email) !== normalizeEmail(confirmationEmail)) throw new ApiError(400, "The activation link does not match this account.");
    if (data.authUserId && data.authUserId !== uid) throw new ApiError(400, "The verification identity does not match this account.");
    if (data.role !== "customer") throw new ApiError(403, "This verification request is not for a customer account.");
    if (data.verificationStatus === "verified" && data.emailVerified === true && data.accountStatus === "active") return;
    if (data.verificationStatus !== "pending" || data.accountStatus !== "inactive") throw new ApiError(400, "This account is already activated or no longer awaiting verification.");
    const expiresAt = timestampMillis(data.verificationExpiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new ApiError(400, "This activation link has expired. Request a new one.");
    const phone = profile.data()?.phone || "";
    if (phone) {
      const phoneRef = db.collection("phoneAccountLimits").doc(phone.replace(/\D/g, ""));
      const lock = await transaction.get(phoneRef);
      const accountIds = [...new Set([...(lock.data()?.accountIds || []), ...await findPhoneAccounts(phone, transaction)])].filter((accountId) => accountId !== profileId);
      if (accountIds.length >= PHONE_ACCOUNT_LIMIT) throw new ApiError(409, PHONE_ACCOUNT_LIMIT_MESSAGE);
      transaction.set(phoneRef, { accountIds: [...accountIds, profileId], updatedAt: new Date().toISOString() });
    }
    transaction.update(profileRef, { accountStatus: "active", status: "active", emailVerified: true,
      verificationStatus: "verified", emailVerifiedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  });
}

async function resendCustomerEmailVerification(req, res) {
  const email = normalizeEmail(req.body?.email || "");
  if (!email || email.length > 254) throw new ApiError(400, "Enter the email address used to register.");
  if (!env.runtime.mailDeliveryReady || !env.runtime.supabaseAdminReady) throw new ApiError(503, "Activation email delivery is not configured.", { code: "ACTIVATION_MAIL_NOT_CONFIGURED" });
  const profile = await getUserByEmail(email);
  const notSent = () => res.status(200).json({ success: true, deliveryStatus: "not_sent", message: "No activation email was sent. If your account still needs activation, contact the clinic for help." });
  if (!profile || profile.verificationStatus !== "pending" || profile.accountStatus !== "inactive") return notSent();
  const sentAt = timestampMillis(profile.verificationSentAt);
  if (Number.isFinite(sentAt) && Date.now() - sentAt < VERIFICATION_RESEND_COOLDOWN_MS) throw new ApiError(429, "An activation email was sent recently. Please wait one minute before requesting another.", { code: "ACTIVATION_RESEND_COOLDOWN" });
  const { resolveCustomerFullName } = await import("../../../shared/customerName.mjs");
  const challenge = await generateSupabaseEmailLink({ email, type: "signup", userMetadata: {
    full_name: resolveCustomerFullName(profile), username: profile.username, role: "customer",
  } });
  if (challenge.user?.id && challenge.user.id !== (profile.authUserId || profile.uid)) throw new ApiError(409, "The verification identity does not match this account.");
  const delivery = await sendSignupCode(challenge, email, profile.fullName || "");
  const now = new Date().toISOString();
  try {
    await db.collection("users").doc(profile.profileDocId || profile.uid).update({ verificationSentAt: now, verificationExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), updatedAt: now });
  } catch (_error) {
    // Delivery already succeeded; never tell the customer their email failed.
    console.warn("[registration] Verification code sent but delivery metadata could not be updated.");
  }
  return res.status(200).json({ success: true, verificationMethod: "otp", deliveryStatus: "sent", messageId: delivery.messageId, message: "A new verification code has been sent. Check your inbox and spam folder." });
}

module.exports = { activateCustomerEmail, createCustomerProfile, resendCustomerEmailVerification };
