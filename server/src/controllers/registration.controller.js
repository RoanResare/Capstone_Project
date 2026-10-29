const { db } = require("../config/postgresDatabase");
const { env } = require("../config/env");
const { ApiError } = require("../utils/ApiError");
const { validateRegistrationSecurity } = require("../services/registrationSecurity.service");
const { validateAccessSecurity } = require("../services/sessionSecurity.service");
const { generateSupabaseEmailLink, deleteSupabaseUser, verifySupabaseEmailToken, findSupabaseUserByEmail } = require("../services/supabaseAuth.service");
const { sendEmailVerificationLink } = require("../services/mail.service");
const { findPhoneAccounts, PHONE_ACCOUNT_LIMIT, PHONE_ACCOUNT_LIMIT_MESSAGE } = require("../services/phoneAccounts.service");
const { normalizePhilippineMobileNumber, PH_MOBILE_ERROR } = require("../utils/phoneNumber");
const { assertValidEmail } = require("../utils/emailValidation");
const { assertStrongPassword } = require("../utils/password");
const { assertValidUsername, findUserByEmailCaseInsensitive, getUserByEmail, getUsernameOwner } = require("../services/user.service");

const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_CODE_LENGTH = 4096;
const normalizeEmail = (value = "") => String(value || "").trim().toLowerCase();
const pendingVerificationMessage = (email) => `Verification link sent! Check ${email} for the activation link. It expires automatically.`;

function buildAppVerificationLink(tokenHash, email) {
  if (!tokenHash) throw new ApiError(500, "The generated verification link is missing its activation token.");
  const link = new URL(env.auth.emailVerificationUrl);
  link.searchParams.set("token_hash", tokenHash);
  link.searchParams.set("type", "signup");
  if (email) link.searchParams.set("email", email);
  return link.toString();
}

async function createCustomerProfile(req, res) {
  if (!env.runtime.supabaseAdminReady || !db) throw new ApiError(503, "Supabase Auth is not configured for registration.");
  const payload = req.body || {};
  const email = normalizeEmail(payload.email);
  const fullName = String(payload.fullName || "").trim();
  const username = assertValidUsername(String(payload.username || "").trim().toLowerCase());
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
  if (await findUserByEmailCaseInsensitive(email)) {
    throw new ApiError(409, "Email is already associated with another account.");
  }
  if (await findSupabaseUserByEmail(email)) {
    throw new ApiError(409, "Email is already associated with another account.");
  }
  const owner = await getUsernameOwner(username);
  if (owner) throw new ApiError(409, "That username is already in use.");
  if (phone && (await findPhoneAccounts(phone)).length >= PHONE_ACCOUNT_LIMIT) throw new ApiError(409, PHONE_ACCOUNT_LIMIT_MESSAGE);

  const registrationSecurity = await validateRegistrationSecurity(req, email);
  await validateAccessSecurity(req);
  const signupStartedAt = Date.now();
  const challenge = await generateSupabaseEmailLink({ email, type: "signup", password,
    userMetadata: { full_name: fullName, username, phone: phone || "" } });
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
  const profileRef = db.collection("users").doc(uid);
  const usernameRef = db.collection("usernames").doc(username);
  let profileCommitted = false;
  try {
    await db.runTransaction(async (transaction) => {
      const profile = await transaction.get(profileRef);
      const usernameDoc = await transaction.get(usernameRef);
      // Auth INSERT triggers may create a profile while generate_link runs.
      // Complete only a fresh, unverified customer row for this exact identity.
      const existing = profile.data() || {};
      const createdAt = new Date(existing.createdAt).getTime();
      const triggerProfile = profile.exists && normalizeEmail(existing.email) === email
        && (existing.authUserId || existing.uid) === uid
        && (!existing.username || existing.username === username)
        && (!existing.role || existing.role === "customer")
        && existing.emailVerified !== true && existing.verificationStatus !== "verified"
        && [undefined, "active", "inactive", "pending"].includes(existing.accountStatus)
        && [undefined, "active", "inactive", "pending"].includes(existing.status)
        && Number.isFinite(createdAt) && createdAt >= signupStartedAt - 1000 && createdAt <= Date.now();
      if (profile.exists && !triggerProfile) throw new ApiError(409, "This account already has a profile.");
      if (usernameDoc.exists && !(triggerProfile && usernameDoc.data()?.uid === uid
        && normalizeEmail(usernameDoc.data()?.email) === email)) throw new ApiError(409, "That username is already in use.");
      let phoneRef = null;
      let phoneAccountIds = [];
      if (phone) {
        phoneRef = db.collection("phoneAccountLimits").doc(phone.replace(/\D/g, ""));
        const lock = await transaction.get(phoneRef);
        phoneAccountIds = [...new Set([...(lock.data()?.accountIds || []), ...await findPhoneAccounts(phone, transaction)])];
        phoneAccountIds = phoneAccountIds.filter((accountId) => accountId !== uid);
        if (phoneAccountIds.length >= PHONE_ACCOUNT_LIMIT) throw new ApiError(409, PHONE_ACCOUNT_LIMIT_MESSAGE);
      }
      transaction.set(profileRef, {
        uid, authUserId: uid, email, fullName, username, phone: phone || "", role: "customer",
        accountStatus: "inactive", status: "inactive", emailVerified: false,
        verificationStatus: "pending",
        registrationIp: registrationSecurity.registrationIp || "",
        verificationSentAt: now, verificationExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), createdAt: now, updatedAt: now,
      });
      transaction.set(usernameRef, { uid, email, username, createdAt: now, updatedAt: now, verificationStatus: "pending" });
      if (phoneRef) transaction.set(phoneRef, { accountIds: [...phoneAccountIds, uid], updatedAt: now });
    });
    profileCommitted = true;
    await sendEmailVerificationLink({ to: email, fullName, verificationLink: buildAppVerificationLink(challenge.tokenHash, email) });
  } catch (error) {
    if (profileCommitted) await db.runTransaction(async (transaction) => {
      const profile = await transaction.get(profileRef);
      const usernameDoc = await transaction.get(usernameRef);
      const phoneRef = phone ? db.collection("phoneAccountLimits").doc(phone.replace(/\D/g, "")) : null;
      const lock = phoneRef ? await transaction.get(phoneRef) : null;
      if (profile.exists && profile.data().authUserId === uid && normalizeEmail(profile.data().email) === email
        && profile.data().verificationStatus === "pending") transaction.delete(profileRef);
      if (usernameDoc.exists && usernameDoc.data().uid === uid) transaction.delete(usernameRef);
      if (lock?.exists) transaction.set(phoneRef, { accountIds: (lock.data()?.accountIds || []).filter((accountId) => accountId !== uid), updatedAt: new Date().toISOString() });
    }).catch(() => {});
    // Never delete an existing identity/profile when the transaction found a conflict.
    if (profileCommitted || error?.statusCode !== 409) await deleteSupabaseUser(uid).catch(() => {});
    if (error?.code === "23505" || error?.cause?.code === "23505" || error?.originalError?.code === "23505") {
      throw new ApiError(409, "An account with this email or username already exists.", {
        code: "REGISTRATION_IDENTITY_CONFLICT",
      });
    }
    throw error;
  }
  return res.status(202).json({ success: true, message: pendingVerificationMessage(email), profile: {
    uid, email, fullName, username, phone: phone || "", role: "customer", accountStatus: "inactive",
    status: "inactive", emailVerified: false, verificationStatus: "pending",
  } });
}

async function activateCustomerEmail(req, res) {
  const tokenHash = String(req.body?.token_hash || req.body?.tokenHash || req.body?.oobCode || "").trim();
  if (!tokenHash || tokenHash.length > MAX_CODE_LENGTH) throw new ApiError(400, "This verification link is invalid or incomplete.");
  let verified;
  try { verified = await verifySupabaseEmailToken(tokenHash, "signup"); }
  catch (_error) { throw new ApiError(400, "This verification link is invalid, expired, or already used."); }
  const identity = verified?.user;
  const email = normalizeEmail(identity?.email);
  if (!identity?.id || !email) throw new ApiError(400, "The verification link does not match an account.");
  await activatePendingProfile(identity.id, email);
  return res.status(200).json({ success: true, message: "Email verified. Your account is active; you can now sign in.", email });
}

async function activatePendingProfile(uid, confirmationEmail) {
  const profileRef = db.collection("users").doc(uid);
  await db.runTransaction(async (transaction) => {
    const profile = await transaction.get(profileRef);
    if (!profile.exists) throw new ApiError(400, "This activation link does not match a pending registration.");
    const data = profile.data() || {};
    if (normalizeEmail(data.email) !== normalizeEmail(confirmationEmail)) throw new ApiError(400, "The activation link does not match this account.");
    if (data.verificationStatus !== "pending" || data.accountStatus !== "inactive") throw new ApiError(400, "This account is already activated or no longer awaiting verification.");
    if (Date.parse(data.verificationExpiresAt || "") <= Date.now()) throw new ApiError(400, "This activation link has expired. Request a new one.");
    const phone = profile.data()?.phone || "";
    if (phone) {
      const phoneRef = db.collection("phoneAccountLimits").doc(phone.replace(/\D/g, ""));
      const lock = await transaction.get(phoneRef);
      const accountIds = [...new Set([...(lock.data()?.accountIds || []), ...await findPhoneAccounts(phone, transaction)])].filter((accountId) => accountId !== uid);
      if (accountIds.length >= PHONE_ACCOUNT_LIMIT) throw new ApiError(409, PHONE_ACCOUNT_LIMIT_MESSAGE);
      transaction.set(phoneRef, { accountIds: [...accountIds, uid], updatedAt: new Date().toISOString() });
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
  const sentAt = Date.parse(profile.verificationSentAt || "");
  if (Number.isFinite(sentAt) && Date.now() - sentAt < VERIFICATION_RESEND_COOLDOWN_MS) throw new ApiError(429, "An activation email was sent recently. Please wait one minute before requesting another.", { code: "ACTIVATION_RESEND_COOLDOWN" });
  const challenge = await generateSupabaseEmailLink({ email, type: "signup", userMetadata: { full_name: profile.fullName, username: profile.username } });
  const delivery = await sendEmailVerificationLink({ to: email, fullName: profile.fullName || "", verificationLink: buildAppVerificationLink(challenge.tokenHash, email) });
  const now = new Date().toISOString();
  await db.collection("users").doc(profile.profileDocId || profile.uid).update({ verificationSentAt: now, verificationExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), updatedAt: now });
  return res.status(200).json({ success: true, deliveryStatus: "sent", messageId: delivery.messageId, message: "A new activation link has been sent. Check your inbox and spam folder." });
}

module.exports = { activateCustomerEmail, createCustomerProfile, resendCustomerEmailVerification };
