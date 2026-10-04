import { verifyActiveSessionSecurity } from "./sessionSecurity.js";
import { validateBackendEmail } from "./authApi.js";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  EmailAuthProvider,
  getIdTokenResult,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  updateEmail,
  updatePassword,
  updateProfile as updateFirebaseProfile,
} from "firebase/auth";
import {
  deleteField,
  doc,
  getDoc,
  getDocFromCache,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { auth, authPersistenceReadyPromise, db, firebaseConfigError, isFirebaseConfigured } from "../../firebase.js";
import { getPasswordPolicyError } from "../utils/passwordPolicy.js";
import { waitForFirebaseUserSession } from "./firebaseSession.js";
import { beginCustomerRegistration, waitForCustomerRegistration } from "../utils/customerRegistration.js";

const USERS_COLLECTION = "users";

function normalizeString(value = "") {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(email = "") {
  return normalizeString(email).toLowerCase();
}

function normalizeUsername(username = "") {
  return normalizeString(username).toLowerCase();
}

function normalizeAccountStatus(status = "") {
  const normalized = normalizeString(status).toLowerCase();
  return ["active", "inactive", "suspended"].includes(normalized) ? normalized : "active";
}

function deriveDefaultUsername(email = "") {
  const [localPart = "customer"] = normalizeEmail(email).split("@");
  const sanitized = normalizeUsername(localPart.replace(/[^a-z0-9._-]/g, "").slice(0, 24));

  if (sanitized.length >= 3) {
    return sanitized;
  }

  return `customer-${sanitized || "user"}`.slice(0, 24);
}

function assertCustomerUsername(username = "") {
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

function ensureCustomerFirebaseReady() {
  if (!isFirebaseConfigured || !auth || !db) {
    throw new Error(
      firebaseConfigError ||
        "Firebase Authentication or Firestore is not configured. Fill the VITE_FIREBASE_* values first.",
    );
  }
}

function createCustomerAppError(code, message) {
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

function buildFirebaseErrorDetails(error) {
  return {
    code: getFirebaseErrorCode(error),
    message: getFirebaseErrorMessage(error) || "Unknown Firebase error.",
  };
}

function isCustomerConnectionIssue(error) {
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

function buildCustomerProfileRulesMessage() {
  return "Firestore could not verify your signed-in customer session for users/{uid}. Wait for Firebase Authentication to finish, then try again. If this keeps happening, confirm the deployed firestore.rules allow request.auth.uid to access only its matching user document.";
}

function buildCustomerProfileOfflineMessage() {
  return "Firestore could not load or save your customer profile right now. Check your connection and try again.";
}

function normalizeCustomerServiceError(error, options = {}) {
  const subject = options.subject || "profile";

  if (isFirestorePermissionDenied(error)) {
    return createCustomerAppError("permission-denied", buildCustomerProfileRulesMessage());
  }

  if (isCustomerConnectionIssue(error)) {
    return createCustomerAppError("firestore/offline", buildCustomerProfileOfflineMessage());
  }

  return error;
}

function normalizeRoleClaim(role = "") {
  const normalized = normalizeString(role).toLowerCase();
  return ["customer", "admin", "staff"].includes(normalized) ? normalized : "";
}

function buildProtectedPortalMessage(role = "") {
  const normalizedRole = normalizeRoleClaim(role);

  if (!normalizedRole || normalizedRole === "customer") {
    return "This account must use the correct login page.";
  }

  return `This ${normalizedRole} account must sign in through the ${normalizedRole} portal.`;
}

function buildCustomerProfile(firebaseUser, profile = {}) {
  const accountStatus = normalizeAccountStatus(profile.accountStatus || profile.status);
  const fullName =
    normalizeString(profile.fullName) ||
    normalizeString(profile.name) ||
    normalizeString(firebaseUser?.displayName);
  const email = normalizeEmail(profile.email || firebaseUser?.email || "");
  const username = assertCustomerUsername(
    profile.username || deriveDefaultUsername(email || firebaseUser?.email || ""),
  );

  return {
    uid: normalizeString(firebaseUser?.uid),
    id: normalizeString(firebaseUser?.uid),
    profileDocId: normalizeString(firebaseUser?.uid),
    fullName,
    name: fullName,
    username,
    email,
    phone: normalizeString(profile.phone),
    role: "customer",
    accountStatus,
    status: accountStatus,
    fraudStatus: normalizeString(profile.fraudStatus).toLowerCase() || "normal",
    registrationIp: normalizeString(profile.registrationIp),
  };
}

function customerProfileReference(uid = "") {
  return doc(db, USERS_COLLECTION, normalizeString(uid));
}

async function requireCustomerFirebaseSession(firebaseUser, options = {}) {
  if (!firebaseUser?.uid) {
    throw new Error("The signed-in Firebase account is missing its UID.");
  }

  const authenticatedUser = await waitForFirebaseUserSession(firebaseUser.uid, options);

  if (!authenticatedUser?.uid || authenticatedUser.uid !== firebaseUser.uid) {
    throw createCustomerAppError(
      "customer/auth-not-ready",
      "Firebase Authentication did not finish creating the customer session. Please try again.",
    );
  }

  const token = await authenticatedUser.getIdToken(options.forceRefresh === true);
  if (!token || auth.currentUser !== authenticatedUser) {
    throw createCustomerAppError("customer/auth-not-ready", "The customer session changed before the profile could be saved. Please sign in again.");
  }
  return authenticatedUser;
}

async function tryReadCustomerProfileFromCache(reference) {
  try {
    const snapshot = await getDocFromCache(reference);
    return snapshot.exists() ? snapshot : null;
  } catch {
    return null;
  }
}

async function readCustomerProfileSnapshot(reference) {
  try {
    return await getDoc(reference);
  } catch (error) {
    if (isCustomerConnectionIssue(error)) {
      const cachedSnapshot = await tryReadCustomerProfileFromCache(reference);

      if (cachedSnapshot) {
        return cachedSnapshot;
      }
    }

    throw normalizeCustomerServiceError(error);
  }
}

async function writeCustomerProfileSnapshot(reference, payload, options = { merge: true }) {
  try {
    await setDoc(reference, payload, options);
  } catch (error) {
    throw normalizeCustomerServiceError(error);
  }
}

async function assertCustomerSessionRole(firebaseUser) {
  const tokenResult = await getIdTokenResult(firebaseUser, true);
  const claimedRole = normalizeRoleClaim(tokenResult?.claims?.role);

  if (claimedRole === "admin" || claimedRole === "staff") {
    throw createCustomerAppError("auth/role-mismatch", buildProtectedPortalMessage(claimedRole));
  }

  return tokenResult;
}

export async function verifyCustomerPassword(password) {
  ensureCustomerFirebaseReady();

  const activeUser = auth.currentUser;
  const normalizedPassword = typeof password === "string" ? password : "";

  if (!activeUser?.email || !normalizedPassword) {
    throw new Error("Enter your current password to verify this profile change.");
  }

  await reauthenticateWithCredential(
    activeUser,
    EmailAuthProvider.credential(activeUser.email, normalizedPassword),
  );
}

export async function changeCustomerPassword(currentPassword, newPassword, confirmPassword) {
  ensureCustomerFirebaseReady();

  if (!newPassword || newPassword !== confirmPassword) {
    throw new Error("New passwords do not match.");
  }

  const passwordError = getPasswordPolicyError(newPassword);
  if (passwordError) {
    throw new Error(passwordError);
  }

  const activeUser = auth.currentUser;
  if (!activeUser?.email) {
    throw new Error("You must be signed in to change your password.");
  }

  await verifyActiveSessionSecurity();
  await reauthenticateWithCredential(
    activeUser,
    EmailAuthProvider.credential(activeUser.email, currentPassword),
  );
  await updatePassword(activeUser, newPassword);
}

function buildCustomerProfilePayload(firebaseUser, profile = {}) {
  const builtProfile = buildCustomerProfile(firebaseUser, profile);

  return {
    uid: builtProfile.uid,
    email: builtProfile.email,
    username: builtProfile.username,
    fullName: builtProfile.fullName,
    phone: builtProfile.phone,
    role: "customer",
    accountStatus: builtProfile.accountStatus,
    status: builtProfile.status,
    fraudStatus: builtProfile.fraudStatus,
    registrationIp: builtProfile.registrationIp,
  };
}

async function upsertCustomerProfileDocument(firebaseUser, profile = {}, options = {}) {
  firebaseUser = await requireCustomerFirebaseSession(firebaseUser);
  const reference = customerProfileReference(firebaseUser.uid);
  const payload = buildCustomerProfilePayload(firebaseUser, profile);
  const usernameReference = doc(db, "usernames", payload.username);
  const usernameSnapshot = await getDoc(usernameReference);

  if (usernameSnapshot.exists() && usernameSnapshot.data()?.uid !== firebaseUser.uid) {
    throw new Error("That username is already in use.");
  }

  const timestampPayload = {
    updatedAt: serverTimestamp(),
  };

  if (options.isNew) {
    timestampPayload.createdAt = serverTimestamp();
  } else if (options.createdAt) {
    timestampPayload.createdAt = options.createdAt;
  }

  const batch = writeBatch(db);
  batch.set(reference, { ...payload, ...timestampPayload }, { merge: true });
  batch.set(
    usernameReference,
    {
      uid: firebaseUser.uid,
      email: payload.email,
      username: payload.username,
      updatedAt: serverTimestamp(),
      ...(options.isNew ? { createdAt: serverTimestamp() } : {}),
    },
    { merge: true },
  );
  try {
    await requireCustomerFirebaseSession(firebaseUser);
    await batch.commit();
  } catch (error) {
    throw normalizeCustomerServiceError(error);
  }

  const snapshot = await readCustomerProfileSnapshot(reference);
  const data = snapshot.exists() ? snapshot.data() : payload;

  return buildCustomerProfile(firebaseUser, data);
}

function assertCustomerProfileIsActive(profile) {
  const accountStatus = normalizeAccountStatus(profile?.accountStatus || profile?.status);

  if (accountStatus === "active") {
    return;
  }

  throw createCustomerAppError(
    "auth/account-disabled",
    `This customer account is ${accountStatus}.`,
  );
}

async function safeDeleteCustomerAuthUser(firebaseUser) {
  if (!firebaseUser) {
    return;
  }

  try {
    await deleteUser(firebaseUser);
    console.info("[customer-auth] Removed partially created Firebase customer account.", {
      uid: firebaseUser.uid,
      email: firebaseUser.email || "",
    });
  } catch (error) {
    console.error("[customer-auth] Failed to remove partially created customer account.", {
      uid: firebaseUser.uid,
      email: firebaseUser.email || "",
      error,
    });
  }
}

export async function loadOrCreateCustomerProfile(firebaseUser, defaults = {}) {
  ensureCustomerFirebaseReady();
  await waitForCustomerRegistration();

  const authenticatedUser = await requireCustomerFirebaseSession(firebaseUser, {
    forceRefresh: false,
    settleMs: 150,
    timeoutMs: 7000,
  });

  const reference = customerProfileReference(authenticatedUser.uid);
  const snapshot = await readCustomerProfileSnapshot(reference);
  const existingData = snapshot.exists() ? snapshot.data() || {} : null;
  const storedRole = normalizeRoleClaim(existingData?.role);

  if (storedRole === "admin" || storedRole === "staff") {
    throw createCustomerAppError("auth/role-mismatch", buildProtectedPortalMessage(storedRole));
  }

  const normalizedEmail = normalizeEmail(defaults.email || authenticatedUser.email || "");
  const nextProfileData = {
    ...existingData,
    email: normalizedEmail,
    fullName:
      normalizeString(defaults.fullName) ||
      normalizeString(existingData?.fullName) ||
      normalizeString(authenticatedUser.displayName),
    username:
      normalizeString(defaults.username) ||
      normalizeString(existingData?.username) ||
      deriveDefaultUsername(normalizedEmail),
    phone: normalizeString(defaults.phone || existingData?.phone),
    role: "customer",
    accountStatus: normalizeAccountStatus(
      defaults.accountStatus || existingData?.accountStatus || existingData?.status,
    ),
    status: normalizeAccountStatus(
      defaults.accountStatus || existingData?.accountStatus || existingData?.status,
    ),
    fraudStatus: normalizeString(existingData?.fraudStatus).toLowerCase() || "normal",
    registrationIp: normalizeString(existingData?.registrationIp),
  };
  const hasValidStoredUsername = /^[a-z0-9._-]{3,24}$/.test(
    normalizeString(existingData?.username),
  );

  const needsRepair =
    !existingData ||
    normalizeString(existingData?.uid) !== firebaseUser.uid ||
    normalizeEmail(existingData?.email) !== normalizedEmail ||
    normalizeString(existingData?.role).toLowerCase() !== "customer" ||
    !hasValidStoredUsername;

  if (needsRepair) {
    console.info("[customer-auth] Creating or repairing customer profile document.", {
      uid: authenticatedUser.uid,
      email: normalizedEmail,
      existed: Boolean(existingData),
    });

    return upsertCustomerProfileDocument(authenticatedUser, nextProfileData, {
      createdAt: existingData?.createdAt,
      isNew: !existingData,
    });
  }

  return buildCustomerProfile(authenticatedUser, nextProfileData);
}

export async function signUpCustomerWithEmailPassword({
  fullName,
  email,
  password,
  phone = "",
  username = "",
  registrationIp = "",
}) {
  ensureCustomerFirebaseReady();

  const normalizedEmail = normalizeEmail(email);
  const normalizedFullName = normalizeString(fullName);
  const normalizedPhone = normalizeString(phone);
  const normalizedUsername = assertCustomerUsername(
    username || deriveDefaultUsername(normalizedEmail),
  );

  console.info("[customer-auth] Starting customer sign-up.", {
    email: normalizedEmail,
    username: normalizedUsername,
  });

  let credentials = null;
  const finishRegistration = beginCustomerRegistration();

  try {
    await authPersistenceReadyPromise;
    await auth.authStateReady();
    credentials = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
    const authenticatedUser = await requireCustomerFirebaseSession(credentials.user, {
      forceRefresh: true,
      settleMs: 200,
      timeoutMs: 7000,
    });

    if (normalizedFullName) {
      await updateFirebaseProfile(authenticatedUser, {
        displayName: normalizedFullName || authenticatedUser.displayName || null,
      });
    }

    const profile = await upsertCustomerProfileDocument(
      authenticatedUser,
      {
        fullName: normalizedFullName,
        email: normalizedEmail,
        phone: normalizedPhone,
        username: normalizedUsername,
        role: "customer",
        accountStatus: "active",
        status: "active",
        registrationIp: normalizeString(registrationIp),
      },
      {
        isNew: true,
      },
    );

    console.info("[customer-auth] Customer sign-up completed successfully.", {
      uid: authenticatedUser.uid,
      email: normalizedEmail,
    });

    return {
      firebaseUser: authenticatedUser,
      profile,
    };
  } catch (error) {
    console.error("[customer-auth] Customer sign-up failed.", {
      email: normalizedEmail,
      error: buildFirebaseErrorDetails(error),
    });

    if (credentials?.user) {
      await safeDeleteCustomerAuthUser(credentials.user);
    }

    throw normalizeCustomerServiceError(error);
  } finally {
    finishRegistration();
  }
}

export async function signInCustomerWithEmailPassword({ email, password }) {
  ensureCustomerFirebaseReady();

  const normalizedIdentifier = normalizeString(email);
  let normalizedEmail = normalizeEmail(normalizedIdentifier);

  if (!normalizedEmail.includes("@")) {
    const usernameSnapshot = await getDoc(doc(db, "usernames", normalizeUsername(normalizedIdentifier)));
    normalizedEmail = normalizeEmail(usernameSnapshot.exists() ? usernameSnapshot.data()?.email : "");
  }

  if (!normalizedEmail) {
    throw new Error("Email is required.");
  }

  if (!normalizedEmail.includes("@")) {
    throw createCustomerAppError("auth/user-not-found", "No account was found for that email or username.");
  }

  console.info("[customer-auth] Starting customer sign-in.", {
    email: normalizedEmail,
  });

  try {
    const credentials = await signInWithEmailAndPassword(auth, normalizedEmail, password);
    const authenticatedUser = await requireCustomerFirebaseSession(credentials.user, {
      forceRefresh: true,
      settleMs: 200,
      timeoutMs: 7000,
    });
    await assertCustomerSessionRole(authenticatedUser);
    const profile = await loadOrCreateCustomerProfile(authenticatedUser, {
      email: normalizedEmail,
      accountStatus: "active",
    });

    assertCustomerProfileIsActive(profile);
    console.info("[customer-auth] Customer sign-in completed successfully.", {
      uid: authenticatedUser.uid,
      email: normalizedEmail,
    });

    return {
      firebaseUser: authenticatedUser,
      profile,
    };
  } catch (error) {
    console.error("[customer-auth] Customer sign-in failed.", {
      email: normalizedEmail,
      error: buildFirebaseErrorDetails(error),
    });
    throw normalizeCustomerServiceError(error);
  }
}

export async function updateCustomerProfile(currentUser, updates = {}) {
  ensureCustomerFirebaseReady();
  await verifyActiveSessionSecurity();

  const activeAuthUser = await waitForFirebaseUserSession(currentUser?.uid || "", {
    forceRefresh: false,
    settleMs: 100,
    timeoutMs: 5000,
  });

  if (!activeAuthUser?.uid || activeAuthUser.uid !== currentUser?.uid) {
    throw new Error("You must be signed in as this customer to update the profile.");
  }

  const reference = customerProfileReference(activeAuthUser.uid);
  const existingProfile = buildCustomerProfile(activeAuthUser, {
    ...currentUser,
    fullName: currentUser?.fullName || currentUser?.name,
    accountStatus: currentUser?.accountStatus || currentUser?.status,
    status: currentUser?.accountStatus || currentUser?.status,
  });
  const nextFullName = normalizeString(updates.fullName || existingProfile.fullName);
  const nextEmail = normalizeEmail(updates.email || activeAuthUser.email || existingProfile.email);
  const nextPhone = normalizeString(updates.phone || existingProfile.phone);
  const nextUsername = assertCustomerUsername(updates.username || existingProfile.username);

  if (!nextEmail) {
    throw new Error("Email is required.");
  }

  if (updates.requireProfileVerification === true) {
    await verifyCustomerPassword(updates.verificationPassword);
  }

  console.info("[customer-auth] Updating customer profile.", {
    uid: activeAuthUser.uid,
    emailChanged: nextEmail !== normalizeEmail(activeAuthUser.email || existingProfile.email),
  });

  try {
    if (nextEmail !== normalizeEmail(activeAuthUser.email || "")) {
      await validateBackendEmail(nextEmail);
      await updateEmail(activeAuthUser, nextEmail);
      await activeAuthUser.getIdToken(true);
    }

    await writeCustomerProfileSnapshot(reference, {
          uid: activeAuthUser.uid,
          email: nextEmail,
          username: nextUsername,
          fullName: nextFullName,
          phone: nextPhone,
          role: "customer",
          accountStatus: normalizeAccountStatus(existingProfile.accountStatus),
          status: normalizeAccountStatus(existingProfile.status),
          photoURL: deleteField(),
          profilePhotoPath: deleteField(),
          profilePhotoModerationId: deleteField(),
          profilePhotoUploadCount: deleteField(),
          updatedAt: serverTimestamp(),
      }, { merge: true });

    await updateFirebaseProfile(activeAuthUser, {
      displayName: nextFullName || null,
      photoURL: null,
    });

    const profile = buildCustomerProfile(activeAuthUser, {
      ...currentUser,
      uid: activeAuthUser.uid,
      email: nextEmail,
      fullName: nextFullName,
      phone: nextPhone,
      username: nextUsername,
      role: "customer",
      accountStatus: normalizeAccountStatus(existingProfile.accountStatus),
      status: normalizeAccountStatus(existingProfile.status),
    });

    console.info("[customer-auth] Customer profile updated successfully.", {
      uid: activeAuthUser.uid,
    });

    return profile;
  } catch (error) {
    console.error("[customer-auth] Customer profile update failed.", {
      uid: activeAuthUser.uid,
      error: buildFirebaseErrorDetails(error),
    });

    throw normalizeCustomerServiceError(error, {
      subject: "profile",
    });
  }
}
