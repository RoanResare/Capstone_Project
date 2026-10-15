const { auth, db } = require("../config/firebaseAdmin");
const { ApiError } = require("../utils/ApiError");
const { validateRegistrationSecurity } = require("../services/registrationSecurity.service");
const { validateAccessSecurity } = require("../services/sessionSecurity.service");
const { normalizePhilippineMobileNumber, PH_MOBILE_ERROR } = require("../utils/phoneNumber");
const { findPhoneAccounts, PHONE_ACCOUNT_LIMIT, PHONE_ACCOUNT_LIMIT_MESSAGE } = require("../services/phoneAccounts.service");

async function createCustomerProfile(req, res) {
  const token = String(req.headers.authorization || "").replace(/^Bearer /, "");
  let claims;
  try { claims = await auth.verifyIdToken(token, true); }
  catch { throw new ApiError(401, "A valid Firebase session is required."); }
  const payload = req.body || {};
  const phone = normalizePhilippineMobileNumber(payload.phone);
  if (payload.phone && !phone) throw new ApiError(400, PH_MOBILE_ERROR);
  const username = String(payload.username || "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,24}$/.test(username)) throw new ApiError(400, "Enter a valid username.");
  const fullName = String(payload.fullName || "").trim();
  if (!fullName) throw new ApiError(400, "Full name is required.");
  const email = String(claims.email || "").toLowerCase();
  if (!email) throw new ApiError(400, "An email account is required.");
  const { assertAppropriateText, ACCOUNT_TEXT_FIELDS } = await import("../../../shared/textModeration.mjs");
  try { assertAppropriateText({ fullName, username, email }, ACCOUNT_TEXT_FIELDS); }
  catch (error) { throw new ApiError(400, error.message, { code: "INVALID_TEXT", fields: error.fields }); }
  const registrationSecurity = await validateRegistrationSecurity(req, email);
  await validateAccessSecurity(req);
  const profileRef = db.collection("users").doc(claims.uid);
  const usernameRef = db.collection("usernames").doc(username);
  await db.runTransaction(async (transaction) => {
    const profile = await transaction.get(profileRef);
    const usernameDoc = await transaction.get(usernameRef);
    if (profile.exists) throw new ApiError(409, "This account already has a profile.");
    if (usernameDoc.exists && usernameDoc.data().uid !== claims.uid) throw new ApiError(409, "That username is already in use.");
    let phoneRef;
    let accountIds;
    if (phone) {
      phoneRef = db.collection("phoneAccountLimits").doc(phone.replace(/\D/g, ""));
      const lock = await transaction.get(phoneRef);
      accountIds = [...new Set([...(lock.data()?.accountIds || []), ...await findPhoneAccounts(phone, transaction)])];
      if (accountIds.length >= PHONE_ACCOUNT_LIMIT) throw new ApiError(409, PHONE_ACCOUNT_LIMIT_MESSAGE);
    }
    const now = new Date().toISOString();
    transaction.set(profileRef, { uid: claims.uid, email, fullName, username, phone, role: "customer", accountStatus: "active", status: "active", registrationIp: registrationSecurity.registrationIp || "", createdAt: now, updatedAt: now });
    transaction.set(usernameRef, { uid: claims.uid, email, username, createdAt: now, updatedAt: now });
    if (phoneRef) transaction.set(phoneRef, { accountIds: [...accountIds, claims.uid], updatedAt: now });
  });
  res.status(201).json({ success: true });
}

module.exports = { createCustomerProfile };
