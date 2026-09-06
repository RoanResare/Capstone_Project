const { auth, db } = require("../config/firebaseAdmin");
const { env } = require("../config/env");
const { USER_ROLES, USER_STATUSES, USERS_COLLECTION } = require("../constants/auth");
const { ApiError } = require("../utils/ApiError");
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
  const accountStatus = normalizeUserStatus(payload.accountStatus || payload.status);

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
    status: accountStatus,
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

async function getFirebaseUserByUid(uid) {
  try {
    return await auth.getUser(uid);
  } catch (error) {
    if (error?.code === "auth/user-not-found") {
      return null;
    }

    throw error;
  }
}

async function getFirebaseUserByEmail(email) {
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

  if (!normalizedEmail) {
    return null;
  }

  try {
    return await auth.getUserByEmail(normalizedEmail);
  } catch (error) {
    if (error?.code === "auth/user-not-found") {
      return null;
    }

    throw error;
  }
}

async function assertEmailAvailable(email, uid = "") {
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  const [firebaseUser, storedUser] = await Promise.all([
    getFirebaseUserByEmail(normalizedEmail),
    getUserByEmail(normalizedEmail),
  ]);

  if ((firebaseUser && firebaseUser.uid !== uid) || (storedUser && storedUser.uid !== uid)) {
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

async function findUserByEmailCaseInsensitive(email) {
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

  if (!normalizedEmail) {
    return null;
  }

  const exactUser = await getUserByEmail(normalizedEmail);
  if (exactUser) {
    return exactUser;
  }

  const snapshot = await db.collection(USERS_COLLECTION).limit(200).get();
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

async function relinkUserProfileToUid(user, nextUid) {
  const normalizedUid = normalizeString(nextUid);
  const existingUser = normalizeUserPayload(user);

  if (!normalizedUid || existingUser.uid === normalizedUid) {
    return existingUser;
  }

  const timestamp = new Date().toISOString();
  const nextUser = normalizeUserPayload({
    ...existingUser,
    uid: normalizedUid,
    id: normalizedUid,
    updatedAt: timestamp,
  });
  const batch = db.batch();
  const nextReference = db.collection(USERS_COLLECTION).doc(normalizedUid);

  batch.set(
    nextReference,
    {
      ...nextUser,
      uid: normalizedUid,
      updatedAt: timestamp,
    },
    { merge: true },
  );

  if (existingUser.profileDocId && existingUser.profileDocId !== normalizedUid) {
    batch.delete(db.collection(USERS_COLLECTION).doc(existingUser.profileDocId));
  }

  if (isValidUsername(nextUser.username)) {
    batch.set(
      db.collection(USERNAMES_COLLECTION).doc(nextUser.username),
      {
        uid: normalizedUid,
        email: nextUser.email,
        username: nextUser.username,
        updatedAt: timestamp,
      },
      { merge: true },
    );
  }

  await batch.commit();
  logPortalUserOperation("Firestore profile relinked to Firebase Authentication UID", {
    fromUid: existingUser.uid,
    toUid: normalizedUid,
    email: nextUser.email,
    username: nextUser.username,
  });

  return normalizeUserPayload(nextUser, normalizedUid);
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

  const firebaseUser = await getFirebaseUserByUid(user.uid);
  if (!firebaseUser) {
    logPortalUserOperation(
      "profile has no matching Firebase Authentication user",
      {
        uid: user.uid,
        email: user.email,
      },
      "warn",
    );
    return normalizeUserPayload({ ...user, username: nextUsername });
  }

  const authUpdates = {};
  if (firebaseUser.disabled !== (user.accountStatus !== USER_STATUSES.ACTIVE)) {
    authUpdates.disabled = user.accountStatus !== USER_STATUSES.ACTIVE;
  }

  if (normalizeString(firebaseUser.displayName) !== user.fullName) {
    authUpdates.displayName = user.fullName;
  }

  if (Object.keys(authUpdates).length > 0) {
    await auth.updateUser(user.uid, authUpdates);
    logPortalUserOperation("Firebase Authentication profile repaired", {
      uid: user.uid,
      email: user.email,
      fields: Object.keys(authUpdates),
    });
  }

  const claims = firebaseUser.customClaims || {};
  if (
    claims.role !== user.role ||
    claims.accountStatus !== user.accountStatus ||
    claims.status !== user.accountStatus
  ) {
    await setCustomClaims(user);
    logPortalUserOperation("custom claims synchronized", {
      uid: user.uid,
      role: user.role,
      accountStatus: user.accountStatus,
    });
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
  await auth.setCustomUserClaims(user.uid, {
    role: user.role,
    status: user.accountStatus,
    accountStatus: user.accountStatus,
  });
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

async function createPortalUser(payload) {
  const email = payload.email.trim().toLowerCase();
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

  let firebaseUser = null;

  try {
    logPortalUserOperation("Firebase Authentication create started", { email, role });
    firebaseUser = await auth.createUser({
      email,
      password,
      displayName: fullName,
      disabled: accountStatus !== USER_STATUSES.ACTIVE,
    });
    logPortalUserOperation("Firebase Authentication create succeeded", {
      uid: firebaseUser.uid,
      email,
    });
  } catch (error) {
    if (error?.code === "auth/email-already-exists") {
      throw new ApiError(409, "An account with this email already exists.");
    }

    throw error;
  }

  const timestamp = new Date().toISOString();
  const documentPayload = {
    uid: firebaseUser.uid,
    fullName,
    email,
    username,
    role,
    accountStatus,
    status: accountStatus,
    passwordHash: payload.passwordHash,
    phone: payload.phone || "",
    createdAt: timestamp,
    updatedAt: timestamp,
    statusChangedAt: timestamp,
    lastLogin: null,
  };

  try {
    logPortalUserOperation("Firestore profile create started", {
      uid: firebaseUser.uid,
      username,
    });
    await db.runTransaction(async (transaction) => {
      const usernameReference = db.collection(USERNAMES_COLLECTION).doc(username);
      const usernameSnapshot = await transaction.get(usernameReference);

      if (usernameSnapshot.exists && usernameSnapshot.data()?.uid !== firebaseUser.uid) {
        throw new ApiError(409, "This username is already in use.");
      }

      transaction.set(db.collection(USERS_COLLECTION).doc(firebaseUser.uid), documentPayload);
      transaction.set(usernameReference, {
        uid: firebaseUser.uid,
        email,
        username,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });
    logPortalUserOperation("Firestore profile create succeeded", {
      uid: firebaseUser.uid,
      username,
    });
    await setCustomClaims(documentPayload);
    logPortalUserOperation("role claims synchronized", {
      uid: firebaseUser.uid,
      role,
      accountStatus,
    });
  } catch (error) {
    await Promise.allSettled([
      auth.deleteUser(firebaseUser.uid),
      db.collection(USERS_COLLECTION).doc(firebaseUser.uid).delete(),
      deleteUsernameIndex(username, firebaseUser.uid),
    ]);
    logPortalUserOperation(
      "create failed; partial account cleanup attempted",
      {
        uid: firebaseUser.uid,
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
    passwordHash:
      typeof updates.passwordHash === "string" && updates.passwordHash.trim()
        ? updates.passwordHash.trim()
        : existingUser.passwordHash,
    updatedAt: new Date().toISOString(),
  };
  const statusChanged = nextUser.accountStatus !== existingUser.accountStatus;
  const statusChangedAt = statusChanged
    ? nextUser.updatedAt
    : existingUser.statusChangedAt || existingUser.updatedAt || nextUser.updatedAt;

  await assertEmailAvailable(nextUser.email, uid);
  await assertUsernameAvailable(nextUser.username, uid);

  const authUpdate = {
    email: nextUser.email,
    displayName: nextUser.fullName,
    disabled: nextUser.accountStatus !== USER_STATUSES.ACTIVE,
  };

  if (typeof updates.password === "string" && updates.password.trim()) {
    authUpdate.password = updates.password.trim();
  }

  const previousFirebaseUser = await getFirebaseUserByUid(uid);
  if (!previousFirebaseUser) {
    throw new ApiError(
      404,
      "The Firebase Authentication account for this employee was not found. Delete the stale profile or recreate the employee account.",
    );
  }

  try {
    logPortalUserOperation("Firebase Authentication update started", {
      uid,
      email: nextUser.email,
      role: nextUser.role,
      accountStatus: nextUser.accountStatus,
      passwordChanged: Boolean(authUpdate.password),
    });
    await auth.updateUser(uid, authUpdate);
    logPortalUserOperation("Firebase Authentication update succeeded", { uid });
  } catch (error) {
    if (error?.code === "auth/email-already-exists") {
      throw new ApiError(409, "An account with this email already exists.");
    }

    throw error;
  }

  try {
    logPortalUserOperation("Firestore profile update started", {
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
          fullName: nextUser.fullName,
          email: nextUser.email,
          username: nextUser.username,
          role: nextUser.role,
          accountStatus: nextUser.accountStatus,
          status: nextUser.accountStatus,
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
    logPortalUserOperation("Firestore profile update succeeded", { uid });
    await setCustomClaims(nextUser);
    logPortalUserOperation("role claims synchronized", {
      uid,
      role: nextUser.role,
      accountStatus: nextUser.accountStatus,
    });
  } catch (error) {
    await auth.updateUser(uid, {
      email: previousFirebaseUser.email,
      displayName: previousFirebaseUser.displayName || undefined,
      disabled: previousFirebaseUser.disabled,
    }).catch((rollbackError) => {
      logPortalUserOperation(
        "Firebase Authentication rollback failed after profile update error",
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
      "update failed after Firebase Authentication update; rollback attempted",
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

  await auth.updateUser(uid, {
    email: nextUser.email,
    displayName: nextUser.fullName,
  });
  await db.collection(USERS_COLLECTION).doc(uid).set(
    {
      uid,
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

  let targetFirebaseUser = null;

  if (!targetUser && deleting) {
    targetFirebaseUser = await getFirebaseUserByUid(normalizedTargetUid);
  }

  if (!targetUser && !targetFirebaseUser) {
    throw new ApiError(404, "The selected employee account was not found.");
  }

  const targetRole =
    targetUser?.role || normalizeRole(targetFirebaseUser?.customClaims?.role || "");

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
    email: targetFirebaseUser.email || "",
    fullName: targetFirebaseUser.displayName || "",
    username: deriveUsernameFromEmail(targetFirebaseUser.email || normalizedTargetUid),
    role: targetRole,
    accountStatus: targetFirebaseUser.disabled
      ? USER_STATUSES.INACTIVE
      : USER_STATUSES.ACTIVE,
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
    logPortalUserOperation("Firebase Authentication delete started", { uid: normalizedUid });
    await auth.deleteUser(normalizedUid);
    logPortalUserOperation("Firebase Authentication delete succeeded", { uid: normalizedUid });
  } catch (error) {
    if (error?.code !== "auth/user-not-found") {
      throw error;
    }
    logPortalUserOperation(
      "Firebase Authentication user was already missing during delete",
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
  logPortalUserOperation("Firestore profile and username index delete succeeded", {
    uid: normalizedUid,
    username: existingUser?.username || "",
    usernameIndexCount: usernameIndexDocs.length,
  });
}

module.exports = {
  createPortalUser,
  deletePortalUser,
  ensureAdminCanMutateTarget,
  findUserByEmailCaseInsensitive,
  getUserByEmail,
  getUserByUsername,
  getUsernameOwner,
  getUserByUid,
  listPortalUsers,
  normalizeRole,
  normalizeUserPayload,
  normalizeUserStatus,
  relinkUserProfileToUid,
  purgeExpiredInactivePortalUsers,
  toPublicUser,
  touchLastLogin,
  updateOwnUser,
  updatePortalUser,
  updateStoredPasswordHash,
};
