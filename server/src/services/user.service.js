const { auth, db } = require("../config/firebaseAdmin");
const { USER_ROLES, USER_STATUSES, USERS_COLLECTION } = require("../constants/auth");
const { ApiError } = require("../utils/ApiError");
const USERNAMES_COLLECTION = "usernames";

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

function deriveUsernameFromEmail(email = "") {
  const [localPart = ""] = (typeof email === "string" ? email.trim().toLowerCase() : "").split("@");
  return normalizeUsername(localPart);
}

function assertValidUsername(username = "") {
  const normalized = normalizeUsername(username);

  if (!/^[a-z0-9._-]{3,24}$/.test(normalized)) {
    throw new ApiError(
      400,
      "Username must be 3-24 characters and use only lowercase letters, numbers, dots, underscores, or hyphens.",
    );
  }

  return normalized;
}

function normalizeUserPayload(payload = {}) {
  const uid = payload.uid || payload.id || "";
  const fullName = payload.fullName || payload.name || "";
  const normalizedEmail =
    typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const accountStatus = normalizeUserStatus(payload.accountStatus || payload.status);

  return {
    ...payload,
    uid,
    id: uid,
    fullName,
    name: fullName,
    email: normalizedEmail,
    username: normalizeUsername(payload.username || deriveUsernameFromEmail(normalizedEmail)),
    role: normalizeRole(payload.role),
    accountStatus,
    status: accountStatus,
    phone: typeof payload.phone === "string" ? payload.phone.trim() : "",
    passwordHash: typeof payload.passwordHash === "string" ? payload.passwordHash : "",
    createdAt: normalizeTimestamp(payload.createdAt),
    updatedAt: normalizeTimestamp(payload.updatedAt),
    lastLogin: normalizeTimestamp(payload.lastLogin || payload.lastLoginAt),
  };
}

function toPublicUser(user) {
  const current = normalizeUserPayload(user);
  const { passwordHash, ...safeUser } = current;
  return safeUser;
}

async function getUserByUid(uid) {
  const snapshot = await db.collection(USERS_COLLECTION).doc(uid).get();

  if (!snapshot.exists) {
    return null;
  }

  return normalizeUserPayload(snapshot.data());
}

async function getUsernameOwner(username) {
  const snapshot = await db.collection(USERNAMES_COLLECTION).doc(username).get();

  if (!snapshot.exists) {
    return null;
  }

  return snapshot.data();
}

async function assertUsernameAvailable(username, uid = "") {
  const record = await getUsernameOwner(username);

  if (record && record.uid !== uid) {
    throw new ApiError(409, "That username is already in use.");
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

  return normalizeUserPayload(snapshot.docs[0].data());
}

async function listPortalUsers() {
  const snapshot = await db
    .collection(USERS_COLLECTION)
    .where("role", "in", [USER_ROLES.ADMIN, USER_ROLES.STAFF])
    .get();

  return snapshot.docs
    .map((doc) => normalizeUserPayload(doc.data()))
    .sort((left, right) => left.fullName.localeCompare(right.fullName));
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
  const accountStatus = normalizeUserStatus(payload.accountStatus);
  await assertUsernameAvailable(username);

  const firebaseUser = await auth.createUser({
    email,
    password,
    displayName: fullName,
    disabled: accountStatus !== USER_STATUSES.ACTIVE,
  });

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
    lastLogin: null,
  };

  try {
    await db.collection(USERS_COLLECTION).doc(firebaseUser.uid).set(documentPayload);
    await writeUsernameIndex(documentPayload);
    await setCustomClaims(documentPayload);
  } catch (error) {
    await Promise.allSettled([
      auth.deleteUser(firebaseUser.uid),
      db.collection(USERS_COLLECTION).doc(firebaseUser.uid).delete(),
      deleteUsernameIndex(username, firebaseUser.uid),
    ]);
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

  const authUpdate = {
    email: nextUser.email,
    displayName: nextUser.fullName,
    disabled: nextUser.accountStatus !== USER_STATUSES.ACTIVE,
  };

  if (typeof updates.password === "string" && updates.password.trim()) {
    authUpdate.password = updates.password.trim();
  }

  await auth.updateUser(uid, authUpdate);
  await db.collection(USERS_COLLECTION).doc(uid).set(
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
    },
    { merge: true },
  );
  if (existingUser.username && existingUser.username !== nextUser.username) {
    await deleteUsernameIndex(existingUser.username, uid);
  }
  await writeUsernameIndex(nextUser);
  await setCustomClaims(nextUser);

  return normalizeUserPayload(nextUser);
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
  const targetUser = await getUserByUid(targetUid);

  if (!targetUser) {
    throw new ApiError(404, "The selected employee account was not found.");
  }

  if (actor.uid === targetUid) {
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
    targetUser.role === USER_ROLES.ADMIN &&
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

  return targetUser;
}

async function deletePortalUser(uid) {
  const existingUser = await getUserByUid(uid);

  try {
    await auth.deleteUser(uid);
  } catch (error) {
    if (error?.code !== "auth/user-not-found") {
      throw error;
    }
  }

  await db.collection(USERS_COLLECTION).doc(uid).delete();
  await deleteUsernameIndex(existingUser?.username, uid);
}

module.exports = {
  createPortalUser,
  deletePortalUser,
  ensureAdminCanMutateTarget,
  getUserByEmail,
  getUsernameOwner,
  getUserByUid,
  listPortalUsers,
  normalizeRole,
  normalizeUserPayload,
  normalizeUserStatus,
  toPublicUser,
  touchLastLogin,
  updateOwnUser,
  updatePortalUser,
  updateStoredPasswordHash,
};
