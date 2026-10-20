const { auth, db } = require("../config/firebaseAdmin");
const { env } = require("../config/env");
const { ApiError } = require("../utils/ApiError");
const { validateRegistrationSecurity } = require("../services/registrationSecurity.service");
const { validateAccessSecurity } = require("../services/sessionSecurity.service");
const { applyEmailVerificationCode, generateEmailVerificationLink } = require("../services/firebaseAuth.service");
const { sendEmailVerificationLink } = require("../services/mail.service");
const { findPhoneAccounts, PHONE_ACCOUNT_LIMIT, PHONE_ACCOUNT_LIMIT_MESSAGE } = require("../services/phoneAccounts.service");
const { normalizePhilippineMobileNumber, PH_MOBILE_ERROR } = require("../utils/phoneNumber");

const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;

function buildAppVerificationLink(providerLink, email) {
  let providerUrl;
  try { providerUrl = new URL(providerLink); }
  catch { throw new ApiError(500, "The generated verification link is invalid."); }
  const oobCode = providerUrl.searchParams.get("oobCode");
  if (!oobCode) throw new ApiError(500, "The generated verification link is missing its activation token.");
  const appLink = new URL(env.auth.emailVerificationUrl);
  appLink.searchParams.set("oobCode", oobCode);
  if (email) appLink.searchParams.set("email", email);
  return appLink.toString();
}

function normalizeEmail(value = "") {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function pendingVerificationMessage(email) {
  return `Verification link sent! Check ${email} for the activation link. It expires automatically.`;
}

async function runRegistrationStage(stage, message, action) {
  try { return await action(); }
  catch (error) {
    if (error instanceof ApiError) {
      error.details = { ...error.details, stage: error.details?.stage || stage };
      throw error;
    }
    console.error("[registration] Stage failed.", { stage, code: error?.code || "" });
    throw new ApiError(503, message, { code: "REGISTRATION_DEPENDENCY_FAILED", stage, dependencyCode: String(error?.code || "") });
  }
}

async function createCustomerProfile(req, res) {
  if (!auth || !db) throw new ApiError(503, "Firebase Admin is not configured for registration.", { stage: "firebase-auth" });
  const token = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ""))?.[1];
  if (!token) throw new ApiError(401, "A valid Firebase session is required.", { stage: "firebase-auth" });
  let claims;
  try { claims = await auth.verifyIdToken(token, true); }
  catch (error) {
    const invalidSession = ["auth/argument-error", "auth/invalid-id-token", "auth/id-token-expired", "auth/id-token-revoked", "auth/user-disabled", "auth/user-not-found"].includes(error?.code);
    throw new ApiError(invalidSession ? 401 : 503,
      invalidSession ? "A valid Firebase session is required." : "Firebase could not verify your registration session right now. Please try again.",
      { stage: "firebase-auth", code: invalidSession ? "INVALID_FIREBASE_SESSION" : "FIREBASE_AUTH_UNAVAILABLE" });
  }
  const payload = req.body || {};
  const phone = String(payload.phone || "").trim();
  const username = String(payload.username || "").trim().toLowerCase();
  const fullName = String(payload.fullName || "").trim();
  const email = normalizeEmail(claims.email || "");
  if (!/^[a-z0-9._-]{3,24}$/.test(username)) throw new ApiError(400, "Enter a valid username.");
  if (!fullName) throw new ApiError(400, "Full name is required.");
  if (!email) throw new ApiError(400, "An email account is required.");
  const normalizedPhone = normalizePhilippineMobileNumber(phone);
  if (phone && !normalizedPhone) throw new ApiError(400, PH_MOBILE_ERROR);
  const { assertAppropriateText, ACCOUNT_TEXT_FIELDS } = await import("../../../shared/textModeration.mjs");
  try { assertAppropriateText({ fullName, username, email }, ACCOUNT_TEXT_FIELDS); }
  catch (error) { throw new ApiError(400, error.message, { code: "INVALID_TEXT", fields: error.fields }); }
  const registrationSecurity = await validateRegistrationSecurity(req, email);
  await validateAccessSecurity(req);
  const profileRef = db.collection("users").doc(claims.uid);
  const usernameRef = db.collection("usernames").doc(username);
  await runRegistrationStage("profile-save", "Unable to save your registration profile right now. Please try again.", () => db.runTransaction(async (transaction) => {
    const profile = await transaction.get(profileRef);
    const usernameDoc = await transaction.get(usernameRef);
    if (profile.exists) throw new ApiError(409, "This account already has a profile.");
    if (usernameDoc.exists && usernameDoc.data().uid !== claims.uid) throw new ApiError(409, "That username is already in use.");
    if (normalizedPhone) {
      const phoneRef = db.collection("phoneAccountLimits").doc(normalizedPhone.replace(/\D/g, ""));
      const lock = await transaction.get(phoneRef);
      const accountIds = [...new Set([...(lock.data()?.accountIds || []), ...await findPhoneAccounts(normalizedPhone, transaction)])];
      if (accountIds.length >= PHONE_ACCOUNT_LIMIT) throw new ApiError(409, PHONE_ACCOUNT_LIMIT_MESSAGE);
    }
    const now = new Date().toISOString();
    transaction.set(profileRef, {
      uid: claims.uid, email, fullName, username, phone: normalizedPhone, role: "customer",
      accountStatus: "inactive", status: "inactive", emailVerified: false,
      verificationStatus: "pending", registrationIp: registrationSecurity.registrationIp || "",
      verificationExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdAt: now, updatedAt: now,
    });
    transaction.set(usernameRef, { uid: claims.uid, email, username, createdAt: now, updatedAt: now, verificationStatus: "pending" });
  }));

  try {
    const providerLink = await runRegistrationStage("verification-link", "Unable to generate your activation link right now. Please try again.", () => generateEmailVerificationLink(email));
    const verificationLink = buildAppVerificationLink(providerLink, email);
    await runRegistrationStage("email-verification", "Unable to send your activation email right now. Please try again.", () => sendEmailVerificationLink({ to: email, fullName, verificationLink }));
  } catch (error) {
    try { await db.runTransaction(async (transaction) => {
      const profile = await transaction.get(profileRef);
      const usernameDoc = await transaction.get(usernameRef);
      if (profile.exists && profile.data().verificationStatus === "pending") transaction.delete(profileRef);
      if (usernameDoc.exists && usernameDoc.data().uid === claims.uid) transaction.delete(usernameRef);
    }); } catch (cleanupError) {
      console.error("[registration] Pending profile rollback failed.", { stage: "profile-rollback", code: cleanupError?.code || "" });
    }
    throw error;
  }

  // The email provider accepted the activation email. A timestamp write failure
  // must not delete the profile or make the frontend delete the Auth account.
  const sentAt = new Date().toISOString();
  try { await profileRef.update({ verificationSentAt: sentAt, updatedAt: sentAt }); }
  catch (error) {
    console.warn("[registration] Activation email sent; delivery timestamp update failed.", { stage: "verification-metadata", code: error?.code || "" });
  }

  return res.status(202).json({
    success: true,
    message: pendingVerificationMessage(email),
    profile: {
      uid: claims.uid, email, fullName, username, phone: normalizedPhone, role: "customer",
      accountStatus: "inactive", status: "inactive", emailVerified: false, verificationStatus: "pending",
      registrationIp: registrationSecurity.registrationIp || "",
    },
  });
}

async function activateCustomerEmail(req, res) {
  const oobCode = typeof req.body?.oobCode === "string" ? req.body.oobCode.trim() : "";
  if (!oobCode || oobCode.length > 4096) throw new ApiError(400, "This verification link is invalid or incomplete.");
  const confirmation = await applyEmailVerificationCode(oobCode);
  await activatePendingProfile(confirmation.uid, confirmation.email);
  return res.status(200).json({ success: true, message: "Email verified. Your account is active; you can now sign in.", email: normalizeEmail(confirmation.email) });
}

async function activatePendingProfile(uid, confirmationEmail) {
  const profileRef = db.collection("users").doc(uid);
  const profileSnapshot = await profileRef.get();
  if (!profileSnapshot.exists) throw new ApiError(400, "This activation link does not match a pending registration.");
  const email = normalizeEmail(confirmationEmail);
  if (normalizeEmail(profileSnapshot.data().email) !== email) throw new ApiError(400, "The activation link does not match this account.");
  const username = profileSnapshot.data().username;
  const phone = profileSnapshot.data().phone || "";
  const now = new Date().toISOString();
  await db.runTransaction(async (transaction) => {
    const profile = await transaction.get(profileRef);
    if (!profile.exists || profile.data().verificationStatus !== "pending") {
      throw new ApiError(400, "This account is already activated or no longer awaiting verification.");
    }
    if (normalizeEmail(profile.data().email) !== email) throw new ApiError(400, "The activation link does not match this account.");
    const usernameRef = db.collection("usernames").doc(username);
    const usernameDoc = await transaction.get(usernameRef);
    if (!usernameDoc.exists || usernameDoc.data().uid !== uid) {
      throw new ApiError(409, "The reserved username is no longer available. Contact the clinic for help.");
    }
    if (phone) {
      const phoneRef = db.collection("phoneAccountLimits").doc(phone.replace(/\D/g, ""));
      const lock = await transaction.get(phoneRef);
      const accountIds = [...new Set([...(lock.data()?.accountIds || []), ...await findPhoneAccounts(phone, transaction)])]
        .filter((accountId) => accountId !== uid);
      if (accountIds.length >= PHONE_ACCOUNT_LIMIT) throw new ApiError(409, PHONE_ACCOUNT_LIMIT_MESSAGE);
      transaction.set(phoneRef, { accountIds: [...accountIds, uid], updatedAt: now });
    }
    transaction.update(profileRef, {
      accountStatus: "active", status: "active", emailVerified: true,
      verificationStatus: "verified", emailVerifiedAt: now, updatedAt: now,
    });
    transaction.set(usernameRef, { uid, email, username, verificationStatus: "verified", updatedAt: now }, { merge: true });
  });
  await auth.updateUser(uid, { emailVerified: true });
}

async function resendCustomerEmailVerification(req, res) {
  const email = normalizeEmail(req.body?.email || "");
  if (!email || email.length > 254) throw new ApiError(400, "Enter the email address used to register.");
  const genericMessage = "If an account is waiting for email verification, a new activation link has been sent.";
  const snapshot = await db.collection("users").where("email", "==", email).limit(1).get();
  if (snapshot.empty) return res.status(200).json({ success: true, message: genericMessage });
  const userDoc = snapshot.docs[0];
  const user = userDoc.data() || {};
  if (user.verificationStatus !== "pending" || user.accountStatus !== "inactive") {
    return res.status(200).json({ success: true, message: genericMessage });
  }
  const firebaseUser = await auth.getUser(userDoc.id).catch(() => null);
  if (firebaseUser?.emailVerified) {
    await activatePendingProfile(userDoc.id, email);
    return res.status(200).json({
      success: true,
      activated: true,
      message: "Your email is verified and your account is active. You can now sign in.",
    });
  }
  const lastSentAt = Date.parse(user.verificationSentAt || "");
  if (Number.isFinite(lastSentAt) && Date.now() - lastSentAt < VERIFICATION_RESEND_COOLDOWN_MS) {
    return res.status(200).json({ success: true, message: genericMessage });
  }
  const providerLink = await generateEmailVerificationLink(email);
  const verificationLink = buildAppVerificationLink(providerLink, email);
  await sendEmailVerificationLink({ to: email, fullName: user.fullName || "", verificationLink });
  const sentAt = new Date().toISOString();
  await userDoc.ref.update({
    verificationSentAt: sentAt,
    verificationExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    updatedAt: sentAt,
  });
  return res.status(200).json({ success: true, message: genericMessage });
}

module.exports = { activateCustomerEmail, createCustomerProfile, resendCustomerEmailVerification };
