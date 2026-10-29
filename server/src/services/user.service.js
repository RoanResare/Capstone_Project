const { db } = require("../config/postgresDatabase");
const { createSupabaseUser, deleteSupabaseUser, findSupabaseUserByEmail, getSupabaseUserById, updateSupabaseUser } = require("./supabaseAuth.service");
const { env } = require("../config/env");
const { FRAUD_STATUSES, USER_ROLES, USER_STATUSES, USERS_COLLECTION } = require("../constants/auth");
const { ApiError } = require("../utils/ApiError");
const { assertEmailIsDeliverable, assertRegistrationEmailAllowed } = require("./registrationSecurity.service");
const { normalizePhilippineMobileNumber } = require("../utils/phoneNumber");
const USERNAMES_COLLECTION = "usernames";
const INACTIVE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function logPortalUserOperation(stage, details = {}, level = "info") {
  if (env.nodeEnv === "production") {
    return;
  }

  const logger = typeof console[level] === "function" ? console[level] : console.info;
  logger(`[admin-users] ${stage}`, details);
}

function normalizeString(value = "") {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTimestamp(value) {
  if (value?.toDate) {
    return value.toDate().toISOString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value || null;
}

function normalizeRole(role = "") {
  const value = typeof role === "string" ? role.trim().toLowerCase() : "";
  return Object.values(USER_ROLES).includes(value) ? value : USER_ROLES.CUSTOMER;
}

function normalizeUserStatus(status = "") {
  const value = typeof status === "string" ? status.trim().toLowerCase() : "";

  if (value === "archived") {
    return USER_STATUSES.INACTIVE;
  }

  return Object.values(USER_STATUSES).includes(value) ? value : USER_STATUSES.ACTIVE;
}

function normalizeFraudStatus(status = "") {
  const value = normalizeString(status).toLowerCase();
  return Object.values(FRAUD_STATUSES).includes(value) ? value : FRAUD_STATUSES.NORMAL;
}

function normalizeUsername(username = "") {
  return typeof username === "string" ? username.trim().toLowerCase() : "";
}

function sanitizeUsernameCandidate(username = "") {
  return normalizeUsername(username)
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+/, "")
    .slice(0, 24);
}

function isValidUsername(username = "") {
  return /^[a-z0-9._-]{3,24}$/.test(normalizeUsername(username));
}

function deriveUsernameFromEmail(email = "") {
  const [localPart = ""] = (typeof email === "string" ? email.trim().toLowerCase() : "").split("@");
  return sanitizeUsernameCandidate(localPart);
}

function resolveProfileUsername(username = "", email = "", uid = "") {
  const normalizedUsername = normalizeUsername(username);

  if (isValidUsername(normalizedUsername)) {
    return normalizedUsername;
  }

  const emailUsername = deriveUsernameFromEmail(email);
  if (isValidUsername(emailUsername)) {
    return emailUsername;
  }

  const uidUsername = sanitizeUsernameCandidate(uid);
  if (isValidUsername(uidUsername)) {
    return uidUsername;
  }

  return "user";
}

function assertValidUsername(username = "") {
  const normalized = normalizeUsername(username);

  if (!isValidUsername(normalized)) {
    throw new ApiError(
      400,
      "Username must be 3-24 characters and use only lowercase letters, numbers, dots, underscores, or hyphens.",
    );
  }

  return normalized;
}

function normalizeUserPayload(payload = {}, documentId = "") {
  const uid = normalizeString(payload.uid || payload.id || documentId);
  const fullName = normalizeString(payload.fullName || payload.name);
  const normalizedEmail =
    typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const accountStatus = normalizeUserStatus(payload.accountStatus || payload.account_status || payload.status);

  return {
    ...payload,
    uid,
    id: uid,
    profileDocId: documentId || uid,
    fullName,
    name: fullName,
    email: normalizedEmail,
    username: resolveProfileUsername(payload.username, normalizedEmail, uid),
    role: normalizeRole(payload.role),
    accountStatus,
    authUserId: normalizeString(payload.authUserId || payload.auth_user_id),
    status: accountStatus,
    fraudStatus: normalizeFraudStatus(payload.fraudStatus),
    fraudReason: normalizeString(payload.fraudReason),
    fraudUpdatedAt: normalizeTimestamp(payload.fraudUpdatedAt),
    phone: typeof payload.phone === "string" ? payload.phone.trim() : "",
    passwordHash: typeof payload.passwordHash === "string" ? payload.passwordHash : "",
    createdAt: normalizeTimestamp(payload.createdAt),
    updatedAt: normalizeTimestamp(payload.updatedAt),
    statusChangedAt: normalizeTimestamp(payload.statusChangedAt),
    lastLogin: normalizeTimestamp(payload.lastLogin || payload.lastLoginAt),
  };
}

function toPublicUser(user) {
  const current = normalizeUserPayload(user);
  const { password, passwordHash, passwordSalt, passwordVersion, ...safeUser } = current;
  return safeUser;
}

async function getUserByUid(uid) {
  const normalizedUid = normalizeString(uid);
  const snapshot = await db.collection(USERS_COLLECTION).doc(normalizedUid).get();

  if (!snapshot.exists) {
    const uidSnapshot = await db
      .collection(USERS_COLLECTION)
      .where("uid", "==", normalizedUid)
      .limit(1)
      .get();

    if (uidSnapshot.empty) {
      return null;
    }

    return normalizeUserPayload(uidSnapshot.docs[0].data(), uidSnapshot.docs[0].id);
  }

  return normalizeUserPayload(snapshot.data(), snapshot.id);
}

async function getUserByAuthId(authUserId) {
  const normalizedId = normalizeString(authUserId);
  if (!normalizedId) return null;
  const snapshot = await db.collection(USERS_COLLECTION).where("authUserId", "==", normalizedId).limit(1).get();
  if (!snapshot.empty) return normalizeUserPayload(snapshot.docs[0].data(), snapshot.docs[0].id);
  // New native profiles may use the Auth UUID as their public.users primary key
  // without carrying the legacy document ID in legacy_data.
  const direct = await getUserByUid(normalizedId);
  return direct?.authUserId === normalizedId || direct?.uid === normalizedId ? direct : null;
}

async function linkSupabaseAuthUser(profile, authUserId) {
  const normalizedId = normalizeString(authUserId);
  if (!profile || !normalizedId) throw new ApiError(400, "A PostgreSQL profile and Supabase Auth identity are required.");
  const existing = await getUserByAuthId(normalizedId);
  if (existing && existing.uid !== profile.uid) throw new ApiError(409, "This Supabase identity is already linked to another profile.");
  if (profile.authUserId && profile.authUserId !== normalizedId) throw new ApiError(409, "This profile is already linked to another Supabase identity.");
  const documentId = profile.profileDocId || profile.uid;
  const reference = db.collection(USERS_COLLECTION).doc(documentId);
  const current = await reference.get();
  const updatedAt = new Date().toISOString();
  if (!current.exists) {
    const completeProfile = normalizeUserPayload({ ...profile, uid: documentId, id: documentId,
      authUserId: normalizedId, updatedAt }, documentId);
    await reference.set(completeProfile);
    return completeProfile;
  }
  await reference.set({ authUserId: normalizedId, updatedAt }, { merge: true });
  return normalizeUserPayload({ ...profile, authUserId: normalizedId, updatedAt, profileDocId: documentId });
}

async function getUsernameOwner(username) {
  const snapshot = await db.collection(USERNAMES_COLLECTION).doc(normalizeUsername(username)).get();

  if (!snapshot.exists) {
    return null;
  }

  return snapshot.data();
}

async function assertUsernameAvailable(username, uid = "") {
  const normalizedUsername = assertValidUsername(username);
  const record = await getUsernameOwner(normalizedUsername);

  if (record && record.uid !== uid) {
    throw new ApiError(409, "This username is already in use.");
  }
}

async function getSupabaseUserByUid(uid) {
  try {
    return await getSupabaseUserById(uid);
  } catch (error) {
    if (error?.statusCode === 404) {
      return null;
    }

    throw error;
  }
}

async function getSupabaseUserByEmail(email) {
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

  if (!normalizedEmail) {
    return null;
  }

  try {
    return await findSupabaseUserByEmail(normalizedEmail);
  } catch (error) {
    throw error;
  }
}

async function assertEmailAvailable(email, uid = "") {
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  const [supabaseUser, storedUser] = await Promise.all([
    getSupabaseUserByEmail(normalizedEmail),
    getUserByEmail(normalizedEmail),
  ]);

  const linkedProfile = supabaseUser?.id ? await getUserByAuthId(supabaseUser.id) : null;
  if ((supabaseUser && (supabaseUser.id !== uid && linkedProfile?.uid !== uid)) || (storedUser && storedUser.uid !== uid)) {
    throw new ApiError(409, "An account with this email already exists.");
  }
}

async function writeUsernameIndex({ uid, email, username }) {
  const normalizedUsername = assertValidUsername(username || deriveUsernameFromEmail(email));
  await assertUsernameAvailable(normalizedUsername, uid);
  await db.collection(USERNAMES_COLLECTION).doc(normalizedUsername).set(
    {
      uid,
      email,
      username: normalizedUsername,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );

  return normalizedUsername;
}

async function deleteUsernameIndex(username, uid = "") {
  const normalizedUsername = normalizeUsername(username);

  if (!normalizedUsername) {
    return;
  }

  const record = await getUsernameOwner(normalizedUsername);
  if (!record || (uid && record.uid !== uid)) {
    return;
  }

  await db.collection(USERNAMES_COLLECTION).doc(normalizedUsername).delete();
}

async function findUsernameIndexesByUid(uid = "") {
  const normalizedUid = normalizeString(uid);

  if (!normalizedUid) {
    return [];
  }

  const snapshot = await db
    .collection(USERNAMES_COLLECTION)
    .where("uid", "==", normalizedUid)
    .get();

  return snapshot.docs;
}

async function getUserByEmail(email) {
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

  if (!normalizedEmail) {
    return null;
  }

  const snapshot = await db
    .collection(USERS_COLLECTION)
    .where("email", "==", normalizedEmail)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  return normalizeUserPayload(snapshot.docs[0].data(), snapshot.docs[0].id);
}

async function getUserByPhone(phone) {
  const normalizedPhone = typeof phone === "string"
    ? (normalizePhilippineMobileNumber(phone) || phone).replace(/\D/g, "") : "";

  if (!normalizedPhone) {
    return null;
  }

  const snapshot = await db
    .collection(USERS_COLLECTION)
    .where("phone", "==", normalizedPhone)
    .limit(1)
    .get();

  if (!snapshot.empty) {
    return normalizeUserPayload(snapshot.docs[0].data(), snapshot.docs[0].id);
  }

  const fallbackSnapshot = await db.collection(USERS_COLLECTION).limit(200).get();
  const document = fallbackSnapshot.docs.find(
    (doc) => {
      const storedPhone = String(doc.data()?.phone || "");
      return (normalizePhilippineMobileNumber(storedPhone) || storedPhone).replace(/\D/g, "") === normalizedPhone;
    },
  );

  return document ? normalizeUserPayload(document.data(), document.id) : null;
}

async function findUserByEmailCaseInsensitive(email) {
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

  if (!normalizedEmail) {
    return null;
  }

  const exactUser = await getUserByEmail(normalizedEmail);
  if (exactUser) {
    return exactUser;
  }

  const snapshot = await db.collection(USERS_COLLECTION).get();
  const document = snapshot.docs.find(
    (doc) => normalizeString(doc.data()?.email).toLowerCase() === normalizedEmail,
  );

  return document ? normalizeUserPayload(document.data(), document.id) : null;
}

async function getUserByUsername(username) {
  const normalizedUsername = normalizeUsername(username);

  if (!normalizedUsername) {
    return null;
  }

  const usernameOwner = await getUsernameOwner(normalizedUsername);
  if (usernameOwner?.uid) {
    const user = await getUserByUid(usernameOwner.uid);
    if (user) {
      return user;
    }
  }

  const snapshot = await db
    .collection(USERS_COLLECTION)
    .where("username", "==", normalizedUsername)
    .limit(1)
    .get();

  if (!snapshot.empty) {
    return normalizeUserPayload(snapshot.docs[0].data(), snapshot.docs[0].id);
  }

  const fallbackSnapshot = await db.collection(USERS_COLLECTION).limit(200).get();
  const document = fallbackSnapshot.docs.find(
    (doc) => normalizeUsername(doc.data()?.username) === normalizedUsername,
  );

  return document ? normalizeUserPayload(document.data(), document.id) : null;
}

async function pickAvailableUsername(baseUsername, uid) {
  const base = isValidUsername(baseUsername) ? normalizeUsername(baseUsername) : "user";

  for (let attempt = 0; attempt < 200; attempt += 1) {
    const suffix = attempt === 0 ? "" : String(attempt);
    const candidate = sanitizeUsernameCandidate(
      `${base.slice(0, Math.max(3, 24 - suffix.length))}${suffix}`,
    );

    if (!isValidUsername(candidate)) {
      continue;
    }

    const snapshot = await db.collection(USERNAMES_COLLECTION).doc(candidate).get();
    if (!snapshot.exists || snapshot.data()?.uid === uid) {
      return candidate;
    }
  }

  throw new ApiError(409, "No available username could be generated for this account.");
}

async function repairPortalUserConsistency({ document, rawUser, user }) {
  const updates = {};
  const rawUsername = normalizeUsername(rawUser.username);
  let nextUsername = user.username;

  if (rawUser.uid !== user.uid) {
    updates.uid = user.uid;
  }

  if (!normalizeString(rawUser.fullName) && user.fullName) {
    updates.fullName = user.fullName;
  }

  if (rawUser.accountStatus !== user.accountStatus || rawUser.status !== user.accountStatus) {
    updates.accountStatus = user.accountStatus;
    updates.status = user.accountStatus;
  }

  if (rawUser.fraudStatus !== user.fraudStatus || rawUser.fraudReason !== user.fraudReason) {
    updates.fraudStatus = user.fraudStatus;
    updates.fraudReason = user.fraudReason;
    updates.fraudUpdatedAt = user.fraudUpdatedAt || new Date().toISOString();
  }

  if (!isValidUsername(rawUsername)) {
    nextUsername = await pickAvailableUsername(user.username, user.uid);
    updates.username = nextUsername;
  }

  const batch = db.batch();
  let hasBatchWrites = false;

  if (Object.keys(updates).length > 0) {
    batch.set(document.ref, updates, { merge: true });
    hasBatchWrites = true;
  }

  if (isValidUsername(nextUsername)) {
    let usernameReference = db.collection(USERNAMES_COLLECTION).doc(nextUsername);
    let usernameSnapshot = await usernameReference.get();

    if (usernameSnapshot.exists && usernameSnapshot.data()?.uid !== user.uid) {
      nextUsername = await pickAvailableUsername(nextUsername, user.uid);
      updates.username = nextUsername;
      usernameReference = db.collection(USERNAMES_COLLECTION).doc(nextUsername);
      usernameSnapshot = await usernameReference.get();
    }

    if (!usernameSnapshot.exists || usernameSnapshot.data()?.uid !== user.uid) {
      batch.set(
        usernameReference,
        {
          uid: user.uid,
          email: user.email,
          username: nextUsername,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
      hasBatchWrites = true;
    }

    if (rawUsername && rawUsername !== nextUsername) {
      const oldUsernameReference = db.collection(USERNAMES_COLLECTION).doc(rawUsername);
      const oldUsernameSnapshot = await oldUsernameReference.get();

      if (oldUsernameSnapshot.exists && oldUsernameSnapshot.data()?.uid === user.uid) {
        batch.delete(oldUsernameReference);
        hasBatchWrites = true;
      }
    }
  }

  if (hasBatchWrites) {
    await batch.commit();
    logPortalUserOperation("profile consistency repaired", {
      uid: user.uid,
      email: user.email,
      username: nextUsername,
      fields: Object.keys(updates),
    });
  }

  const authId = user.authUserId || user.uid;
  if (user.authUserId && env.runtime.supabaseAdminReady) {
    await updateSupabaseUser(authId, { user_metadata: { full_name: user.fullName, role: user.role } });
  }

  return normalizeUserPayload({ ...user, username: nextUsername });
}

async function listPortalUsers(options = {}) {
  if (options.purgeRetained !== false) {
    await purgeExpiredInactivePortalUsers();
  }

  const snapshot = await db
    .collection(USERS_COLLECTION)
    .where("role", "in", [USER_ROLES.ADMIN, USER_ROLES.STAFF])
    .get();

  const users = await Promise.all(
    snapshot.docs.map(async (doc) => {
      const rawUser = doc.data() || {};
      const user = normalizeUserPayload(rawUser, doc.id);

      if (!options.repair) {
        return user;
      }

      try {
        return await repairPortalUserConsistency({ document: doc, rawUser, user });
      } catch (error) {
        logPortalUserOperation(
          "profile consistency repair failed",
          {
            uid: user.uid,
            email: user.email,
            error: error instanceof Error ? error.message : String(error || "Unknown error"),
            code: error?.code || "",
          },
          "warn",
        );
        return user;
      }
    }),
  );

  return users.sort((left, right) => left.fullName.localeCompare(right.fullName));
}

async function setCustomClaims(user) {
  // Authorization is read from PostgreSQL on each backend request.
  return user;
}

async function touchLastLogin(uid) {
  const timestamp = new Date().toISOString();

  await db.collection(USERS_COLLECTION).doc(uid).set(
    {
      updatedAt: timestamp,
      lastLogin: timestamp,
    },
    { merge: true },
  );
}

async function updateStoredPasswordHash(uid, passwordHash) {
  await db.collection(USERS_COLLECTION).doc(uid).set(
    {
      passwordHash,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

async function assertAccountText(payload) {
  const { assertAppropriateText, ACCOUNT_TEXT_FIELDS } = await import("../../../shared/textModeration.mjs");
  try { assertAppropriateText(payload, ACCOUNT_TEXT_FIELDS); }
  catch (error) { throw new ApiError(400, error.message, { code: "INVALID_TEXT", fields: error.fields }); }
}

async function createPortalUser(payload) {
  await assertAccountText(payload);
  const email = payload.email.trim().toLowerCase();
  assertRegistrationEmailAllowed(email);
  await assertEmailIsDeliverable(email);
  const fullName = payload.fullName.trim();
  const password = payload.password;
  const username = assertValidUsername(payload.username || deriveUsernameFromEmail(email));
  const role = normalizeRole(payload.role);
  const accountStatus = USER_STATUSES.ACTIVE;

  logPortalUserOperation("create request validated", {
    email,
    username,
    role,
    accountStatus,
  });

  await Promise.all([
    assertEmailAvailable(email),
    assertUsernameAvailable(username),
  ]);

  const authUser = await createSupabaseUser({ email, password, emailConfirmed: true, userMetadata: { full_name: fullName, role } });
  if (!authUser?.id) throw new ApiError(503, "Supabase Auth did not create the employee identity.");

  const timestamp = new Date().toISOString();
  const documentPayload = {
    uid: authUser.id,
    authUserId: authUser.id,
    fullName,
    email,
    username,
    role,
    accountStatus,
    status: accountStatus,
    fraudStatus: FRAUD_STATUSES.NORMAL,
    fraudReason: "",
    fraudUpdatedAt: timestamp,
    passwordHash: payload.passwordHash,
    phone: payload.phone || "",
    createdAt: timestamp,
    updatedAt: timestamp,
    statusChangedAt: timestamp,
    lastLogin: null,
  };

  try {
    logPortalUserOperation("PostgreSQL profile create started", {
      uid: authUser.id,
      username,
    });
    await db.runTransaction(async (transaction) => {
      const usernameReference = db.collection(USERNAMES_COLLECTION).doc(username);
      const usernameSnapshot = await transaction.get(usernameReference);

      if (usernameSnapshot.exists && usernameSnapshot.data()?.uid !== authUser.id) {
        throw new ApiError(409, "This username is already in use.");
      }

      transaction.set(db.collection(USERS_COLLECTION).doc(authUser.id), documentPayload);
      transaction.set(usernameReference, {
        uid: authUser.id,
        email,
        username,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });
    logPortalUserOperation("PostgreSQL profile create succeeded", {
      uid: authUser.id,
      username,
    });
    await setCustomClaims(documentPayload);
  } catch (error) {
    await Promise.allSettled([
      deleteSupabaseUser(authUser.id),
      db.collection(USERS_COLLECTION).doc(authUser.id).delete(),
      deleteUsernameIndex(username, authUser.id),
    ]);
    logPortalUserOperation(
      "create failed; partial account cleanup attempted",
      {
        uid: authUser.id,
        email,
        username,
        error: error instanceof Error ? error.message : String(error || "Unknown error"),
        code: error?.code || "",
      },
      "error",
    );
    throw error;
  }

  return normalizeUserPayload(documentPayload);
}

async function updatePortalUser(uid, updates) {
  await assertAccountText(updates);
  const existingUser = await getUserByUid(uid);

  if (!existingUser) {
    throw new ApiError(404, "The selected employee account was not found.");
  }

  const nextEmail =
    typeof updates.email === "string" && updates.email.trim()
      ? updates.email.trim().toLowerCase()
      : existingUser.email;
  const nextUser = {
    ...existingUser,
    fullName: typeof updates.fullName === "string" ? updates.fullName.trim() : existingUser.fullName,
    email: nextEmail,
    username:
      typeof updates.username === "string" && updates.username.trim()
        ? assertValidUsername(updates.username)
        : existingUser.username || assertValidUsername(deriveUsernameFromEmail(nextEmail)),
    role: typeof updates.role === "string" ? normalizeRole(updates.role) : existingUser.role,
    accountStatus:
      typeof updates.accountStatus === "string"
        ? normalizeUserStatus(updates.accountStatus)
        : typeof updates.status === "string"
          ? normalizeUserStatus(updates.status)
        : existingUser.accountStatus,
    phone: typeof updates.phone === "string" ? updates.phone.trim() : existingUser.phone,
    fraudStatus:
      typeof updates.fraudStatus === "string"
        ? normalizeFraudStatus(updates.fraudStatus)
        : existingUser.fraudStatus,
    fraudReason:
      typeof updates.fraudReason === "string"
        ? updates.fraudReason.trim()
        : existingUser.fraudReason,
    passwordHash:
      typeof updates.passwordHash === "string" && updates.passwordHash.trim()
        ? updates.passwordHash.trim()
        : existingUser.passwordHash,
    updatedAt: new Date().toISOString(),
  };
  nextUser.fraudUpdatedAt =
    nextUser.fraudStatus !== existingUser.fraudStatus || nextUser.fraudReason !== existingUser.fraudReason
      ? nextUser.updatedAt
      : existingUser.fraudUpdatedAt || nextUser.updatedAt;
  const statusChanged = nextUser.accountStatus !== existingUser.accountStatus;
  const statusChangedAt = statusChanged
    ? nextUser.updatedAt
    : existingUser.statusChangedAt || existingUser.updatedAt || nextUser.updatedAt;

  if (nextUser.email !== existingUser.email) {
    await assertEmailIsDeliverable(nextUser.email);
  }
  await assertEmailAvailable(nextUser.email, uid);
  await assertUsernameAvailable(nextUser.username, uid);

  const authId = existingUser.authUserId || uid;
  nextUser.authUserId = authId;
  const authUpdate = { email: nextUser.email, email_confirm: true, user_metadata: { full_name: nextUser.fullName, role: nextUser.role } };

  if (typeof updates.password === "string" && updates.password.trim()) {
    authUpdate.password = updates.password.trim();
  }

  const previousAuthUser = await getSupabaseUserByUid(authId);
  if (!previousAuthUser) throw new ApiError(404, "The Supabase Auth account for this employee was not found. Recreate the employee account.");

  try {
    logPortalUserOperation("Supabase Auth update started", {
      uid,
      email: nextUser.email,
      role: nextUser.role,
      accountStatus: nextUser.accountStatus,
      passwordChanged: Boolean(authUpdate.password),
    });
    await updateSupabaseUser(authId, authUpdate);
    logPortalUserOperation("Supabase Auth update succeeded", { uid });
  } catch (error) {
    if (error?.details?.code === "email_exists" || error?.statusCode === 409) {
      throw new ApiError(409, "An account with this email already exists.");
    }

    throw error;
  }

  try {
    logPortalUserOperation("PostgreSQL profile update started", {
      uid,
      username: nextUser.username,
    });
    await db.runTransaction(async (transaction) => {
      const userReference = db.collection(USERS_COLLECTION).doc(uid);
      const usernameReference = db.collection(USERNAMES_COLLECTION).doc(nextUser.username);
      const usernameSnapshot = await transaction.get(usernameReference);

      if (usernameSnapshot.exists && usernameSnapshot.data()?.uid !== uid) {
        throw new ApiError(409, "This username is already in use.");
      }

      transaction.set(
        userReference,
        {
          uid,
          authUserId: authId,
          fullName: nextUser.fullName,
          email: nextUser.email,
          username: nextUser.username,
          role: nextUser.role,
          accountStatus: nextUser.accountStatus,
          status: nextUser.accountStatus,
          fraudStatus: nextUser.fraudStatus,
          fraudReason: nextUser.fraudReason,
          fraudUpdatedAt: nextUser.fraudUpdatedAt,
          passwordHash: nextUser.passwordHash,
          phone: nextUser.phone,
          updatedAt: nextUser.updatedAt,
          statusChangedAt,
        },
        { merge: true },
      );
      transaction.set(
        usernameReference,
        {
          uid,
          email: nextUser.email,
          username: nextUser.username,
          updatedAt: nextUser.updatedAt,
        },
        { merge: true },
      );

      if (existingUser.username && existingUser.username !== nextUser.username) {
        transaction.delete(db.collection(USERNAMES_COLLECTION).doc(existingUser.username));
      }
    });
    logPortalUserOperation("PostgreSQL profile update succeeded", { uid });
    await setCustomClaims(nextUser);
    logPortalUserOperation("role claims synchronized", {
      uid,
      role: nextUser.role,
      accountStatus: nextUser.accountStatus,
    });
  } catch (error) {
    await updateSupabaseUser(authId, {
      email: previousAuthUser.email,
      user_metadata: previousAuthUser.user_metadata || {},
      ...(typeof updates.password === "string" && updates.password.trim() ? { password: previousAuthUser.password || undefined } : {}),
    }).catch((rollbackError) => {
      logPortalUserOperation(
        "Supabase Auth rollback failed after profile update error",
        {
          uid,
          error:
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError || "Unknown error"),
        },
        "error",
      );
    });
    logPortalUserOperation(
      "update failed after Supabase Auth update; rollback attempted",
      {
        uid,
        error: error instanceof Error ? error.message : String(error || "Unknown error"),
        code: error?.code || "",
      },
      "error",
    );
    throw error;
  }

  return normalizeUserPayload({ ...nextUser, statusChangedAt });
}

function getRetentionReferenceTime(user) {
  const rawTimestamp = user.statusChangedAt || user.updatedAt || user.createdAt;
  const parsed = rawTimestamp ? new Date(rawTimestamp) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.getTime() : Date.now();
}

function isExpiredInactivePortalUser(user) {
  if (![USER_STATUSES.SUSPENDED, USER_STATUSES.INACTIVE].includes(user.accountStatus)) {
    return false;
  }

  return Date.now() - getRetentionReferenceTime(user) > INACTIVE_RETENTION_MS;
}

async function purgeExpiredInactivePortalUsers() {
  const snapshot = await db
    .collection(USERS_COLLECTION)
    .where("role", "in", [USER_ROLES.ADMIN, USER_ROLES.STAFF])
    .get();
  const expiredUsers = snapshot.docs
    .map((doc) => normalizeUserPayload(doc.data(), doc.id))
    .filter(isExpiredInactivePortalUser);

  for (const user of expiredUsers) {
    try {
      await deletePortalUser(user.uid);
      logPortalUserOperation("30-day inactive employee retention purge completed", {
        uid: user.uid,
        email: user.email,
        accountStatus: user.accountStatus,
        statusChangedAt: user.statusChangedAt || user.updatedAt || "",
      });
    } catch (error) {
      logPortalUserOperation(
        "30-day inactive employee retention purge failed",
        {
          uid: user.uid,
          email: user.email,
          error: error instanceof Error ? error.message : String(error || "Unknown error"),
          code: error?.code || "",
        },
        "error",
      );
    }
  }

  return expiredUsers.length;
}

async function updateOwnUser(uid, updates) {
  await assertAccountText(updates);
  const existingUser = await getUserByUid(uid);

  if (!existingUser) {
    throw new ApiError(404, "The user profile could not be found.");
  }

  const nextEmail =
    typeof updates.email === "string" && updates.email.trim()
      ? updates.email.trim().toLowerCase()
      : existingUser.email;
  const nextUser = {
    ...existingUser,
    fullName: typeof updates.fullName === "string" ? updates.fullName.trim() : existingUser.fullName,
    email: nextEmail,
    username: existingUser.username || assertValidUsername(deriveUsernameFromEmail(nextEmail)),
    phone: typeof updates.phone === "string" ? updates.phone.trim() : existingUser.phone,
    updatedAt: new Date().toISOString(),
  };

  if (nextEmail !== existingUser.email) {
    await assertEmailIsDeliverable(nextEmail);
  }
  const authId = existingUser.authUserId || uid;
  nextUser.authUserId = authId;
  await updateSupabaseUser(authId, {
    email: nextUser.email,
    email_confirm: true,
    user_metadata: { full_name: nextUser.fullName },
  });
  await db.collection(USERS_COLLECTION).doc(uid).set(
    {
      uid,
      authUserId: authId,
      fullName: nextUser.fullName,
      email: nextUser.email,
      username: nextUser.username,
      phone: nextUser.phone,
      updatedAt: nextUser.updatedAt,
    },
    { merge: true },
  );
  await writeUsernameIndex(nextUser);

  return normalizeUserPayload(nextUser);
}

async function ensureAdminCanMutateTarget(
  actor,
  targetUid,
  nextRole,
  nextAccountStatus,
  deleting = false,
) {
  const normalizedTargetUid = normalizeString(targetUid);
  const targetUser = await getUserByUid(normalizedTargetUid);

  let targetAuthUser = null;

  if (!targetUser && deleting) {
    targetAuthUser = await getSupabaseUserByUid(normalizedTargetUid);
  }

  if (!targetUser && !targetAuthUser) {
    throw new ApiError(404, "The selected employee account was not found.");
  }

  const targetRole =
    targetUser?.role || normalizeRole(targetAuthUser?.user_metadata?.role || "");

  if (![USER_ROLES.ADMIN, USER_ROLES.STAFF].includes(targetRole)) {
    throw new ApiError(400, "Only admin and staff accounts can be managed here.");
  }

  if (actor.uid === normalizedTargetUid) {
    if (deleting) {
      throw new ApiError(400, "You cannot delete the account you are currently using.");
    }

    if (nextRole && nextRole !== USER_ROLES.ADMIN) {
      throw new ApiError(400, "You cannot remove admin access from your current session.");
    }

    if (nextAccountStatus && nextAccountStatus !== USER_STATUSES.ACTIVE) {
      throw new ApiError(400, "You cannot deactivate or suspend your current admin session.");
    }
  }

  if (
    targetRole === USER_ROLES.ADMIN &&
    ((nextRole && nextRole !== USER_ROLES.ADMIN) ||
      (nextAccountStatus && nextAccountStatus !== USER_STATUSES.ACTIVE) ||
      deleting)
  ) {
    const portalUsers = await listPortalUsers();
    const activeAdmins = portalUsers.filter(
      (user) => user.role === USER_ROLES.ADMIN && user.accountStatus === USER_STATUSES.ACTIVE,
    );

    if (activeAdmins.length <= 1) {
      throw new ApiError(400, "At least one active admin account must remain in the system.");
    }
  }

  return targetUser || normalizeUserPayload({
    uid: normalizedTargetUid,
    email: targetAuthUser.email || "",
    fullName: targetAuthUser.user_metadata?.full_name || "",
    username: deriveUsernameFromEmail(targetAuthUser.email || normalizedTargetUid),
    role: targetRole,
    accountStatus: USER_STATUSES.ACTIVE,
  });
}

async function deletePortalUser(uid) {
  const normalizedUid = normalizeString(uid);
  const existingUser = await getUserByUid(normalizedUid);
  const usernameIndexDocs = await findUsernameIndexesByUid(normalizedUid);
  const usernameOwner = existingUser?.username
    ? await getUsernameOwner(existingUser.username)
    : null;

  try {
    logPortalUserOperation("Supabase Auth delete started", { uid: normalizedUid });
    await deleteSupabaseUser(existingUser?.authUserId || normalizedUid);
    logPortalUserOperation("Supabase Auth delete succeeded", { uid: normalizedUid });
  } catch (error) {
    if (error?.statusCode !== 404) {
      throw error;
    }
    logPortalUserOperation(
      "Supabase Auth user was already missing during delete",
      { uid: normalizedUid },
      "warn",
    );
  }

  const batch = db.batch();
  batch.delete(db.collection(USERS_COLLECTION).doc(normalizedUid));

  if (existingUser?.profileDocId && existingUser.profileDocId !== normalizedUid) {
    batch.delete(db.collection(USERS_COLLECTION).doc(existingUser.profileDocId));
  }

  if (existingUser?.username && usernameOwner?.uid === normalizedUid) {
    batch.delete(db.collection(USERNAMES_COLLECTION).doc(existingUser.username));
  }

  usernameIndexDocs.forEach((document) => {
    batch.delete(document.ref);
  });

  await batch.commit();
  logPortalUserOperation("PostgreSQL profile and username index delete succeeded", {
    uid: normalizedUid,
    username: existingUser?.username || "",
    usernameIndexCount: usernameIndexDocs.length,
  });
}

module.exports = {
  assertValidUsername,
  createPortalUser,
  deletePortalUser,
  ensureAdminCanMutateTarget,
  findUserByEmailCaseInsensitive,
  getUserByEmail,
  getUserByPhone,
  getUserByUsername,
  getUsernameOwner,
  getUserByUid,
  getUserByAuthId,
  linkSupabaseAuthUser,
  listPortalUsers,
  normalizeRole,
  normalizeUserPayload,
  normalizeUserStatus,
  purgeExpiredInactivePortalUsers,
  toPublicUser,
  touchLastLogin,
  updateOwnUser,
  updatePortalUser,
  updateStoredPasswordHash,
};
