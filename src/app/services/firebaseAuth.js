import {
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  deleteUser,
  fetchSignInMethodsForEmail,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  updateProfile as updateFirebaseProfile,
  verifyPasswordResetCode,
} from "firebase/auth";
import {
  doc,
  getDoc,
  getDocFromCache,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { auth, db, firebaseConfigError, isFirebaseConfigured } from "../../firebase.js";
import { buildRoleMismatchMessage, formatRoleLabel } from "../utils/roleUtils.js";
import { waitForFirebaseUserSession } from "./firebaseSession.js";

const VALID_USER_ROLES = ["customer", "admin", "staff"];
const USERS_COLLECTION = "users";
const USERNAMES_COLLECTION = "usernames";

function normalizeString(value = "") {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeEmail(email = "") {
  return normalizeString(email).toLowerCase();
}

export function normalizeUsername(username = "") {
  return normalizeString(username).toLowerCase();
}

function isEmailLike(value = "") {
  const normalized = normalizeString(value);
  return normalized.includes("@");
}

function deriveDefaultUsername(email = "") {
  const [localPart = ""] = normalizeEmail(email).split("@");
  return normalizeUsername(localPart);
}

function assertValidUsername(username = "") {
  const normalized = normalizeUsername(username);

  if (!normalized) {
    throw new Error("Username is required.");
  }

  if (!/^[a-z0-9._-]{3,24}$/.test(normalized)) {
    throw new Error(
      "Username must be 3-24 characters and use only lowercase letters, numbers, dots, underscores, or hyphens.",
    );
  }

  return normalized;
}

function normalizeRole(role = "") {
  const normalized = normalizeString(role).toLowerCase();
  return VALID_USER_ROLES.includes(normalized) ? normalized : "customer";
}

function normalizeRequestedRole(role = "") {
  const normalized = normalizeString(role).toLowerCase();
  return VALID_USER_ROLES.includes(normalized) ? normalized : "";
}

function hasValidRole(role = "") {
  return VALID_USER_ROLES.includes(normalizeString(role).toLowerCase());
}

function waitFor(ms) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function createAppError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getFirebaseErrorCode(error) {
  return typeof error?.code === "string" ? error.code : "";
}

function getFirebaseErrorMessage(error) {
  return error instanceof Error ? error.message : normalizeString(error);
}

export function isFirebaseConnectionIssue(error) {
  const code = getFirebaseErrorCode(error);
  const message = getFirebaseErrorMessage(error).toLowerCase();

  return (
    code === "auth/network-request-failed" ||
    code === "firestore/offline" ||
    code === "unavailable" ||
    code === "deadline-exceeded" ||
    code === "aborted" ||
    code === "cancelled" ||
    code === "failed-precondition" ||
    message.includes("offline") ||
    message.includes("network")
  );
}

function isFirestorePermissionDenied(error) {
  return getFirebaseErrorCode(error) === "permission-denied";
}

function isBrowserOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function buildOfflineRecoveryMessage(subject) {
  if (isBrowserOffline()) {
    return `You're offline. Reconnect to load ${subject} and try again.`;
  }

  return `Firestore could not load ${subject} right now. Check your connection and try again.`;
}

async function tryReadDocumentFromCache(reference) {
  try {
    const snapshot = await getDocFromCache(reference);
    return snapshot.exists() ? snapshot : null;
  } catch (_error) {
    return null;
  }
}

async function readDocumentSnapshot(
  reference,
  { subject = "this document", retries = 3, delayMs = 250, allowCacheFallback = false } = {},
) {
  let lastError = null;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await getDoc(reference);
    } catch (error) {
      lastError = error;

      if (isFirestorePermissionDenied(error)) {
        throw createAppError(
          "permission-denied",
          `Firestore permissions blocked access to ${subject}.`,
        );
      }

      if (allowCacheFallback && isFirebaseConnectionIssue(error)) {
        const cachedSnapshot = await tryReadDocumentFromCache(reference);

        if (cachedSnapshot) {
          return cachedSnapshot;
        }
      }

      if (attempt < retries - 1 && isFirebaseConnectionIssue(error)) {
        await waitFor(delayMs * (attempt + 1));
        continue;
      }

      break;
    }
  }

  if (isFirebaseConnectionIssue(lastError)) {
    throw createAppError("firestore/offline", buildOfflineRecoveryMessage(subject));
  }

  throw lastError;
}

function normalizeAccountStatus(status = "") {
  const normalized = normalizeString(status).toLowerCase();
  return ["active", "inactive", "suspended"].includes(normalized) ? normalized : "active";
}

export function buildFirebaseUserProfile(firebaseUser, profile = {}, profileDocId = "") {
  const fullName =
    normalizeString(profile.fullName) ||
    normalizeString(profile.name) ||
    normalizeString(firebaseUser?.displayName);
  const email = normalizeEmail(profile.email || firebaseUser?.email || "");
  const role = normalizeRole(profile.role);
  const accountStatus = normalizeAccountStatus(profile.accountStatus || profile.status);

  return {
    uid: normalizeString(firebaseUser?.uid),
    id: normalizeString(firebaseUser?.uid),
    fullName,
    name: fullName,
    email,
    username: normalizeUsername(profile.username),
    phone: normalizeString(profile.phone),
    role,
    accountStatus,
    status: accountStatus,
    photoURL: normalizeString(firebaseUser?.photoURL),
    profileDocId: profileDocId || normalizeString(firebaseUser?.uid),
  };
}

function ensureFirebaseReady() {
  if (!isFirebaseConfigured || !auth || !db) {
    throw new Error(
      firebaseConfigError ||
        "Firebase Authentication is not configured. Fill the VITE_FIREBASE_* values first.",
    );
  }
}

function buildMissingProfileMessage(roleHint = "") {
  const normalizedRole = normalizeRole(roleHint);

  if (normalizedRole === "admin" || normalizedRole === "staff") {
    return "No Firestore user profile was found for this account. Admin and staff accounts must be provisioned through the backend so users/{uid}, usernames/{username}, and role claims stay in sync. Run server/scripts/repairUserProfiles.js or recreate the account from the admin tools before signing in.";
  }

  return "No Firestore customer profile was found for this account. Customer sign-ups now create users/{uid} automatically, but older Firebase Authentication accounts may still need a repaired Firestore profile before they can sign in normally.";
}

function buildPasswordResetActionSettings() {
  if (typeof window === "undefined" || !window.location?.origin) {
    return undefined;
  }

  return {
    url: `${window.location.origin}/reset-password`,
    handleCodeInApp: false,
  };
}

function assertActiveProfile(profile) {
  const accountStatus = normalizeAccountStatus(profile?.accountStatus || profile?.status);

  if (accountStatus === "active") {
    return;
  }

  const roleLabel = formatRoleLabel(profile?.role).toLowerCase();
  throw createAppError("auth/account-disabled", `This ${roleLabel} account is ${accountStatus}.`);
}

function assertRoleAccess(profile, expectedRole = "") {
  const normalizedExpectedRole = normalizeRequestedRole(expectedRole);

  if (!normalizedExpectedRole) {
    return;
  }

  const actualRole = normalizeRole(profile?.role);
  if (actualRole === normalizedExpectedRole) {
    return;
  }

  throw createAppError(
    "auth/role-mismatch",
    buildRoleMismatchMessage(normalizedExpectedRole, actualRole),
  );
}

export function formatFirebaseAuthError(error, fallbackMessage) {
  const code = typeof error?.code === "string" ? error.code : "";

  switch (code) {
    case "auth/role-mismatch":
      return error.message || "This account cannot sign in through the selected portal.";
    case "auth/account-disabled":
      return error.message || "This account is not active right now.";
    case "permission-denied":
      return error.message || "Firestore permissions blocked the requested account operation.";
    case "firestore/offline":
      return error.message || "Firestore is offline right now. Reconnect and try again.";
    case "auth/requires-recent-login":
      return "For security, sign in again before changing your email address or profile details.";
    case "firestore/profile-not-found":
      return error.message;
    case "auth/api-key-not-valid":
    case "auth/invalid-api-key":
      return "The Firebase web API key is invalid. Update VITE_FIREBASE_API_KEY with the exact value from Firebase Console > Project settings > Your apps, then restart the dev server.";
    case "auth/user-not-found":
      return "No account was found for that email.";
    case "auth/wrong-password":
      return "Incorrect password.";
    case "auth/invalid-credential":
      return "The email or password is incorrect.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/missing-password":
      return "Password is required.";
    case "auth/email-already-in-use":
      return "An account already exists for that email.";
    case "auth/weak-password":
      return "Password should be at least 6 characters.";
    case "auth/operation-not-allowed":
      return "Email/password sign-in is disabled in Firebase Console. Enable it in Authentication > Sign-in method.";
    case "auth/too-many-requests":
      return "Too many attempts were made. Please wait a moment and try again.";
    case "auth/network-request-failed":
      return "Firebase could not be reached. Check your internet connection and Firebase project settings.";
    case "auth/missing-continue-uri":
    case "auth/invalid-continue-uri":
    case "auth/unauthorized-continue-uri":
      return "The password reset redirect URL is not allowed in Firebase Authentication. Add your app domain to Authentication > Settings > Authorized domains.";
    case "auth/expired-action-code":
      return "This password reset link has expired. Request a new one.";
    case "auth/invalid-action-code":
      return "This password reset link is invalid or has already been used.";
    default:
      break;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallbackMessage;
}

async function findUserProfileReference(uid) {
  const primaryReference = doc(db, USERS_COLLECTION, uid);
  const primarySnapshot = await readDocumentSnapshot(primaryReference, {
    subject: "your account profile",
    allowCacheFallback: true,
  });

  if (primarySnapshot.exists()) {
    return {
      reference: primaryReference,
      data: primarySnapshot.data(),
    };
  }

  return {
    reference: primaryReference,
    data: null,
  };
}

async function findUserProfileReferenceWithRetry(uid, attempts = 10, delayMs = 200) {
  let profile = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    profile = await findUserProfileReference(uid);

    if (profile.data) {
      return profile;
    }

    if (attempt < attempts - 1) {
      await waitFor(delayMs);
    }
  }

  return profile;
}

function buildMergedProfile(firebaseUser, profile = {}, defaults = {}) {
  return {
    ...profile,
    uid: firebaseUser.uid,
    email: normalizeEmail(profile.email || firebaseUser.email || defaults.email || ""),
    username: normalizeUsername(profile.username || defaults.username),
    fullName:
      normalizeString(profile.fullName) ||
      normalizeString(profile.name) ||
      normalizeString(defaults.fullName) ||
      normalizeString(firebaseUser.displayName),
    phone: normalizeString(profile.phone || defaults.phone),
    role: normalizeRole(profile.role || defaults.role),
    accountStatus: normalizeAccountStatus(
      profile.accountStatus || profile.status || defaults.accountStatus,
    ),
  };
}

export async function loadExistingUserProfile(firebaseUser, defaults = {}) {
  ensureFirebaseReady();

  if (!firebaseUser?.uid) {
    throw new Error("The signed-in Firebase account is missing its UID.");
  }

  const authenticatedUser =
    (await waitForFirebaseUserSession(firebaseUser.uid, {
      forceRefresh: false,
      settleMs: 150,
      timeoutMs: 7000,
    })) || firebaseUser;
  const { reference, data } = await findUserProfileReferenceWithRetry(authenticatedUser.uid);

  if (!data) {
    throw createAppError(
      "firestore/profile-not-found",
      buildMissingProfileMessage(defaults.roleHint || defaults.role),
    );
  }

  if (!hasValidRole(data.role)) {
    throw new Error(
      'The Firestore user profile is missing a valid "role" field. Expected "admin", "staff", or "customer".',
    );
  }

  return buildFirebaseUserProfile(
    authenticatedUser,
    buildMergedProfile(authenticatedUser, data, defaults),
    reference.id,
  );
}

async function findEmailForIdentifier(identifier = "") {
  const normalizedIdentifier = normalizeString(identifier);

  if (!normalizedIdentifier) {
    throw new Error("Email or username is required.");
  }

  if (isEmailLike(normalizedIdentifier)) {
    return normalizeEmail(normalizedIdentifier);
  }

  const username = assertValidUsername(normalizedIdentifier);
  const usernameReference = doc(db, USERNAMES_COLLECTION, username);
  const usernameSnapshot = await readDocumentSnapshot(usernameReference, {
    subject: "the username lookup",
    allowCacheFallback: false,
  });

  if (!usernameSnapshot.exists()) {
    throw new Error("No account was found for that username.");
  }

  const data = usernameSnapshot.data() || {};
  const email = normalizeEmail(data.email || "");

  if (!email) {
    throw new Error("The username index is missing its email mapping.");
  }

  return email;
}

async function ensureUsernameAvailable(username = "") {
  const normalizedUsername = assertValidUsername(username);
  const usernameSnapshot = await readDocumentSnapshot(doc(db, USERNAMES_COLLECTION, normalizedUsername), {
    subject: "the username availability check",
    allowCacheFallback: false,
  });

  if (usernameSnapshot.exists()) {
    throw new Error("That username is already in use.");
  }

  return normalizedUsername;
}

async function createCustomerUserProfile(firebaseUser, profile = {}) {
  const authenticatedUser =
    (await waitForFirebaseUserSession(firebaseUser?.uid || "", {
      forceRefresh: false,
      settleMs: 150,
      timeoutMs: 7000,
    })) || firebaseUser;
  const normalizedEmail = normalizeEmail(profile.email || firebaseUser?.email || "");
  const normalizedUsername = assertValidUsername(
    profile.username || deriveDefaultUsername(normalizedEmail),
  );

  const userReference = doc(db, USERS_COLLECTION, authenticatedUser.uid);
  const usernameReference = doc(db, USERNAMES_COLLECTION, normalizedUsername);
  const usernameSnapshot = await readDocumentSnapshot(usernameReference, {
    subject: "the username index",
    allowCacheFallback: false,
  });

  if (usernameSnapshot.exists() && usernameSnapshot.data()?.uid !== firebaseUser.uid) {
    throw new Error("That username is already in use.");
  }

  const batch = writeBatch(db);
  const timestamp = serverTimestamp();
  const userProfile = {
    uid: authenticatedUser.uid,
    email: normalizedEmail,
    username: normalizedUsername,
    fullName:
      normalizeString(profile.fullName) || normalizeString(firebaseUser?.displayName) || "",
    phone: normalizeString(profile.phone),
    role: normalizeRole(profile.role),
    accountStatus: normalizeAccountStatus(profile.accountStatus),
    status: normalizeAccountStatus(profile.accountStatus),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  batch.set(userReference, userProfile, { merge: true });

  if (!usernameSnapshot.exists()) {
    batch.set(usernameReference, {
      uid: firebaseUser.uid,
      email: normalizedEmail,
      username: normalizedUsername,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  await batch.commit();

  return buildFirebaseUserProfile(authenticatedUser, userProfile, userReference.id);
}

export async function loadOrCreateUserProfile(firebaseUser, defaults = {}) {
  ensureFirebaseReady();

  if (!firebaseUser?.uid) {
    return null;
  }

  const authenticatedUser =
    (await waitForFirebaseUserSession(firebaseUser.uid, {
      forceRefresh: false,
      settleMs: 150,
      timeoutMs: 7000,
    })) || firebaseUser;
  const { reference, data } = await findUserProfileReference(authenticatedUser.uid);

  if (data) {
    return buildFirebaseUserProfile(
      authenticatedUser,
      buildMergedProfile(authenticatedUser, data, defaults),
      reference.id,
    );
  }

  if (normalizeRole(defaults.role) !== "customer") {
    throw createAppError(
      "firestore/profile-not-found",
      buildMissingProfileMessage(defaults.role),
    );
  }

  return createCustomerUserProfile(authenticatedUser, {
    username: defaults.username || deriveDefaultUsername(defaults.email || firebaseUser.email || ""),
    fullName:
      normalizeString(defaults.fullName) || normalizeString(firebaseUser.displayName) || "",
    email: normalizeEmail(defaults.email || firebaseUser.email || ""),
    phone: normalizeString(defaults.phone),
    role: "customer",
    accountStatus: normalizeAccountStatus(defaults.accountStatus),
  });
}

export async function signUpWithEmailPassword({
  fullName,
  email,
  password,
  phone = "",
  username = "",
}) {
  ensureFirebaseReady();

  const normalizedEmail = normalizeEmail(email);
  const normalizedFullName = normalizeString(fullName);
  const normalizedPhone = normalizeString(phone);
  const normalizedUsername = await ensureUsernameAvailable(
    username || deriveDefaultUsername(normalizedEmail),
  );
  const credentials = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
  const authenticatedUser =
    (await waitForFirebaseUserSession(credentials.user.uid, {
      forceRefresh: true,
      settleMs: 200,
      timeoutMs: 7000,
    })) || credentials.user;

  if (normalizedFullName) {
    await updateFirebaseProfile(authenticatedUser, { displayName: normalizedFullName });
  }
  let profile = null;

  try {
    profile = await createCustomerUserProfile(authenticatedUser, {
      username: normalizedUsername,
      fullName: normalizedFullName,
      email: normalizedEmail,
      phone: normalizedPhone,
      role: "customer",
      accountStatus: "active",
    });
  } catch (error) {
    await deleteUser(credentials.user);
    throw error;
  }

  return {
    firebaseUser: authenticatedUser,
    profile,
  };
}

export async function signInWithEmailPassword({ identifier, email, password, roleHint = "" }) {
  ensureFirebaseReady();

  const resolvedEmail = await findEmailForIdentifier(identifier || email);
  const credentials = await signInWithEmailAndPassword(auth, resolvedEmail, password);
  const authenticatedUser =
    (await waitForFirebaseUserSession(credentials.user.uid, {
      forceRefresh: true,
      settleMs: 200,
      timeoutMs: 7000,
    })) || credentials.user;
  const profile = await loadExistingUserProfile(authenticatedUser, {
    email: resolvedEmail,
    accountStatus: "active",
    roleHint,
  });
  assertActiveProfile(profile);
  assertRoleAccess(profile, roleHint);

  return {
    firebaseUser: authenticatedUser,
    profile,
  };
}

export async function sendFirebasePasswordReset(email) {
  ensureFirebaseReady();

  const normalizedEmail = normalizeEmail(email);
  const signInMethods = await fetchSignInMethodsForEmail(auth, normalizedEmail);

  if (!signInMethods.includes("password")) {
    throw createAppError(
      "auth/user-not-found",
      "No email/password account was found for that email address.",
    );
  }

  if (typeof navigator !== "undefined" && navigator.language) {
    auth.languageCode = navigator.language;
  }

  await sendPasswordResetEmail(auth, normalizedEmail, buildPasswordResetActionSettings());
}

export async function applyFirebasePasswordReset(oobCode, newPassword) {
  ensureFirebaseReady();

  await confirmPasswordReset(auth, normalizeString(oobCode), newPassword);
}

export async function validateFirebasePasswordResetCode(oobCode) {
  ensureFirebaseReady();

  return verifyPasswordResetCode(auth, normalizeString(oobCode));
}

export async function updateFirebaseUserProfile(currentUser, updates = {}) {
  ensureFirebaseReady();

  if (!currentUser?.uid) {
    throw new Error("You must be signed in to update your profile.");
  }

  const authenticatedUser =
    (await waitForFirebaseUserSession(currentUser.uid, {
      forceRefresh: false,
      settleMs: 100,
      timeoutMs: 5000,
    })) || currentUser;

  const reference = doc(db, USERS_COLLECTION, currentUser.profileDocId || authenticatedUser.uid);
  const nextFullName = normalizeString(updates.fullName || currentUser.fullName || currentUser.name);
  const nextPhone = normalizeString(updates.phone || currentUser.phone);

  await updateDoc(reference, {
    fullName: nextFullName,
    phone: nextPhone,
    updatedAt: serverTimestamp(),
  });

  if (authenticatedUser && nextFullName && authenticatedUser.displayName !== nextFullName) {
    await updateFirebaseProfile(authenticatedUser, { displayName: nextFullName });
  }

  return loadOrCreateUserProfile(authenticatedUser, {
    fullName: nextFullName,
    email: currentUser.email,
    phone: nextPhone,
    role: currentUser.role,
    accountStatus: currentUser.accountStatus || currentUser.status,
  });
}
