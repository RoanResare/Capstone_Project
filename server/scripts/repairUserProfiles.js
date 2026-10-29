const { auth, db } = require("../src/config/firebaseAdmin");
const { env } = require("../src/config/env");
const { USER_ROLES, USER_STATUSES } = require("../src/constants/auth");

const USERS_COLLECTION = "users";
const USERNAMES_COLLECTION = "usernames";

function normalizeString(value = "") {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(email = "") {
  return normalizeString(email).toLowerCase();
}

function normalizeRole(role = "") {
  const normalized = normalizeString(role).toLowerCase();
  return Object.values(USER_ROLES).includes(normalized) ? normalized : USER_ROLES.CUSTOMER;
}

function normalizeStatus(status = "", disabled = false) {
  const normalized = normalizeString(status).toLowerCase();

  if (Object.values(USER_STATUSES).includes(normalized)) {
    return normalized;
  }

  return disabled ? USER_STATUSES.INACTIVE : USER_STATUSES.ACTIVE;
}

function normalizeUsername(username = "") {
  return normalizeString(username).toLowerCase();
}

function sanitizeUsernameCandidate(username = "") {
  const normalized = normalizeUsername(username)
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+/, "")
    .slice(0, 24);

  return normalized;
}

function deriveUsernameFromEmail(email = "") {
  const [localPart = ""] = normalizeEmail(email).split("@");
  return sanitizeUsernameCandidate(localPart);
}

function isValidUsername(username = "") {
  return /^[a-z0-9._-]{3,24}$/.test(username);
}

async function getUsernameRecordForUid(uid) {
  const snapshot = await db
    .collection(USERNAMES_COLLECTION)
    .where("uid", "==", uid)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  const document = snapshot.docs[0];
  return {
    id: document.id,
    ...document.data(),
  };
}

async function pickAvailableUsername(baseUsername, uid) {
  const fallbackBase = isValidUsername(baseUsername) ? baseUsername : "user";

  for (let attempt = 0; attempt < 200; attempt += 1) {
    const suffix = attempt === 0 ? "" : String(attempt);
    const nextCandidate = sanitizeUsernameCandidate(
      `${fallbackBase.slice(0, Math.max(3, 24 - suffix.length))}${suffix}`,
    );

    if (!isValidUsername(nextCandidate)) {
      continue;
    }

    const snapshot = await db.collection(USERNAMES_COLLECTION).doc(nextCandidate).get();

    if (!snapshot.exists || snapshot.data()?.uid === uid) {
      return nextCandidate;
    }
  }

  throw new Error(`Could not find an available username for uid ${uid}.`);
}

async function listAllAuthUsers() {
  const users = [];
  let nextPageToken;

  do {
    const result = await auth.listUsers(1000, nextPageToken);
    users.push(...result.users);
    nextPageToken = result.pageToken;
  } while (nextPageToken);

  return users;
}

async function main() {
  if (!env.runtime.firebaseAdminReady || !auth || !db) {
    throw new Error("Firebase Admin credentials are not configured in the server environment.");
  }

  const authUsers = await listAllAuthUsers();

  if (authUsers.length === 0) {
    console.log("No Firebase Authentication users were found.");
    return;
  }

  let repairedProfiles = 0;
  let repairedUsernames = 0;
  let syncedClaims = 0;
  let skippedNoEmail = 0;

  for (const firebaseUser of authUsers) {
    const email = normalizeEmail(firebaseUser.email);

    if (!email) {
      skippedNoEmail += 1;
      continue;
    }

    const userReference = db.collection(USERS_COLLECTION).doc(firebaseUser.uid);
    const [userSnapshot, usernameRecord] = await Promise.all([
      userReference.get(),
      getUsernameRecordForUid(firebaseUser.uid),
    ]);
    const existingProfile = userSnapshot.exists ? userSnapshot.data() || {} : {};
    const existingClaims = firebaseUser.customClaims || {};
    const role = normalizeRole(existingProfile.role || existingClaims.role);
    const accountStatus = normalizeStatus(
      existingProfile.accountStatus || existingProfile.status || existingClaims.accountStatus || existingClaims.status,
      firebaseUser.disabled,
    );
    const usernameCandidate =
      sanitizeUsernameCandidate(existingProfile.username || usernameRecord?.username) ||
      deriveUsernameFromEmail(email);
    const username = await pickAvailableUsername(usernameCandidate, firebaseUser.uid);
    const createdAt =
      existingProfile.createdAt ||
      normalizeString(firebaseUser.metadata.creationTime) ||
      new Date().toISOString();
    const updatedAt = new Date().toISOString();
    const profilePayload = {
      uid: firebaseUser.uid,
      fullName:
        normalizeString(existingProfile.fullName || existingProfile.name) ||
        normalizeString(firebaseUser.displayName),
      email,
      username,
      role,
      accountStatus,
      phone: normalizeString(existingProfile.phone),
      createdAt,
      updatedAt,
      lastLogin:
        existingProfile.lastLogin ||
        normalizeString(firebaseUser.metadata.lastSignInTime) ||
        null,
    };

    const batch = db.batch();
    batch.set(userReference, profilePayload, { merge: true });
    batch.set(
      db.collection(USERNAMES_COLLECTION).doc(username),
      {
        uid: firebaseUser.uid,
        email,
        username,
        createdAt,
        updatedAt,
      },
      { merge: true },
    );

    if (usernameRecord?.id && usernameRecord.id !== username && usernameRecord.uid === firebaseUser.uid) {
      batch.delete(db.collection(USERNAMES_COLLECTION).doc(usernameRecord.id));
    }

    await batch.commit();

    if (!userSnapshot.exists) {
      repairedProfiles += 1;
    }

    if (!usernameRecord || usernameRecord.id !== username) {
      repairedUsernames += 1;
    }

    await auth.setCustomUserClaims(firebaseUser.uid, {
      role,
      status: accountStatus,
      accountStatus,
    });
    syncedClaims += 1;
  }

  console.log(
    `Profile repair completed. Profiles repaired: ${repairedProfiles}, username indexes repaired: ${repairedUsernames}, custom claims synced: ${syncedClaims}, auth users skipped without email: ${skippedNoEmail}.`,
  );
}

main().catch((error) => {
  console.error("Profile repair failed.", error);
  process.exitCode = 1;
});
