import {
  createUserWithEmailAndPassword,
  deleteUser,
  getIdTokenResult,
  signInWithEmailAndPassword,
  updateEmail,
  updateProfile as updateFirebaseProfile,
} from "firebase/auth";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { doc, getDoc, getDocFromCache, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db, firebaseConfigError, isFirebaseConfigured, storage } from "../../firebase.js";
import { compressImageFile } from "../utils/imageCompression.js";
import { waitForFirebaseUserSession } from "./firebaseSession.js";

const USERS_COLLECTION = "users";
const PROFILE_PHOTO_DIRECTORY = "customer-profile-photos";
const MAX_PROFILE_PHOTO_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_FIRESTORE_PHOTO_BYTES = 750 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function normalizeString(value = "") {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(email = "") {
  return normalizeString(email).toLowerCase();
}

function isDataUrl(value = "") {
  return normalizeString(value).startsWith("data:");
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
  if (!isFirebaseConfigured || !auth || !db || !storage) {
    throw new Error(
      firebaseConfigError ||
        "Firebase Authentication, Firestore, or Storage is not configured. Fill the VITE_FIREBASE_* values first.",
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
    code === "storage/retry-limit-exceeded" ||
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

function isStoragePermissionDenied(error) {
  return ["storage/unauthorized", "storage/unauthenticated"].includes(getFirebaseErrorCode(error));
}

function isStorageBucketUnavailable(error) {
  return (
    getFirebaseErrorCode(error) === "storage/unknown" &&
    (error?.status === 404 || error?.customData?.serverResponse === "")
  );
}

function buildCustomerProfileRulesMessage() {
  return "Firestore could not verify your signed-in customer session for users/{uid}. Wait for Firebase Authentication to finish, then try again. If this keeps happening, confirm the deployed firestore.rules allow request.auth.uid to access only its matching user document.";
}

function buildCustomerProfileOfflineMessage() {
  return "Firestore could not load or save your customer profile right now. Check your connection and try again.";
}

function buildCustomerProfilePhotoRulesMessage() {
  return "Firebase Storage blocked your customer profile photo update. Publish the updated storage.rules so authenticated customers can manage customer-profile-photos/{uid}.";
}

function buildCustomerProfilePhotoOfflineMessage() {
  return "Firebase Storage could not upload your customer profile photo right now. Check your connection and try again.";
}

function normalizeCustomerServiceError(error, options = {}) {
  const subject = options.subject || "profile";

  if (isFirestorePermissionDenied(error)) {
    return createCustomerAppError("permission-denied", buildCustomerProfileRulesMessage());
  }

  if (isStoragePermissionDenied(error)) {
    return createCustomerAppError("permission-denied", buildCustomerProfilePhotoRulesMessage());
  }

  if (isCustomerConnectionIssue(error)) {
    const message =
      subject === "photo" ? buildCustomerProfilePhotoOfflineMessage() : buildCustomerProfileOfflineMessage();
    return createCustomerAppError("firestore/offline", message);
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
    photoURL: normalizeString(profile.photoURL || firebaseUser?.photoURL),
    profilePhotoPath: normalizeString(profile.profilePhotoPath),
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

  await authenticatedUser.getIdToken(options.forceRefresh === true);
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

function validateCustomerPhotoFile(file) {
  if (!file) {
    return;
  }

  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw createCustomerAppError(
      "customer/invalid-image-type",
      "Profile photos must be a JPG, PNG, or WEBP image.",
    );
  }

  if (file.size > MAX_PROFILE_PHOTO_SIZE_BYTES) {
    throw createCustomerAppError(
      "customer/image-too-large",
      "Profile photos must be 5 MB or smaller.",
    );
  }
}

function sanitizeFileName(fileName = "") {
  const normalized = normalizeString(fileName).toLowerCase();
  const sanitized = normalized.replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-");
  return sanitized || "profile-image";
}

async function deleteStorageObjectIfPresent(storagePath = "") {
  const normalizedPath = normalizeString(storagePath);

  if (!normalizedPath) {
    return;
  }

  try {
    await deleteObject(ref(storage, normalizedPath));
    console.info("[customer-auth] Deleted previous customer profile photo.", {
      storagePath: normalizedPath,
    });
  } catch (error) {
    console.warn("[customer-auth] Unable to delete previous customer profile photo.", {
      storagePath: normalizedPath,
      error: buildFirebaseErrorDetails(error),
    });
  }
}

async function uploadCustomerProfilePhoto(uid, file) {
  validateCustomerPhotoFile(file);
  const uploadFile = await compressImageFile(file, {
    maxDimension: 500,
    quality: 0.6,
    outputType: file.type || "image/jpeg",
  });
  validateCustomerPhotoFile(uploadFile);

  const normalizedUid = normalizeString(uid);
  const storagePath = `${PROFILE_PHOTO_DIRECTORY}/${normalizedUid}/${Date.now()}-${sanitizeFileName(uploadFile.name)}`;
  console.info("[customer-auth] Uploading customer profile photo.", {
    uid: normalizedUid,
    storagePath,
    originalSize: file.size,
    size: uploadFile.size,
    type: uploadFile.type,
  });

  let snapshot = null;

  try {
    snapshot = await uploadBytes(ref(storage, storagePath), uploadFile, {
      cacheControl: "public,max-age=3600",
      contentType: uploadFile.type,
    });
  } catch (error) {
    if (isStorageBucketUnavailable(error)) {
      throw createCustomerAppError(
        "storage/bucket-unavailable",
        "Firebase Storage bucket is unavailable for profile photo uploads.",
      );
    }

    throw normalizeCustomerServiceError(error, { subject: "photo" });
  }

  let photoURL = "";

  try {
    photoURL = await getDownloadURL(snapshot.ref);
  } catch (error) {
    throw normalizeCustomerServiceError(error, { subject: "photo" });
  }

  console.info("[customer-auth] Customer profile photo uploaded successfully.", {
    uid: normalizedUid,
    storagePath,
  });

  return {
    photoURL,
    storagePath,
  };
}

function loadImageElement(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The selected image could not be read."));
    image.src = source;
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("The selected image could not be read."));
    reader.readAsDataURL(file);
  });
}

function canvasToDataUrl(canvas, type, quality) {
  return canvas.toDataURL(type, quality);
}

async function buildFirestoreProfilePhotoDataUrl(file) {
  if (typeof document === "undefined" || typeof Image === "undefined" || typeof FileReader === "undefined") {
    throw createCustomerAppError(
      "storage/bucket-unavailable",
      "Firebase Storage is unavailable and this browser cannot prepare a fallback profile photo.",
    );
  }

  const sourceUrl = await readFileAsDataUrl(file);
  const image = await loadImageElement(sourceUrl);
  const canvas = document.createElement("canvas");
  const maxDimension = 512;
  const ratio = Math.min(
    1,
    maxDimension / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height, 1),
  );

  canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * ratio));
  canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * ratio));
  const context = canvas.getContext("2d");

  if (!context) {
    throw createCustomerAppError(
      "storage/bucket-unavailable",
      "Firebase Storage is unavailable and this browser cannot prepare a fallback profile photo.",
    );
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  for (const quality of [0.82, 0.72, 0.62, 0.52]) {
    const dataUrl = canvasToDataUrl(canvas, "image/jpeg", quality);

    if (dataUrl.length <= MAX_FIRESTORE_PHOTO_BYTES) {
      return dataUrl;
    }
  }

  throw createCustomerAppError(
    "customer/image-too-large",
    "Unable to compress this image enough for the temporary profile photo fallback.",
  );
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
    photoURL: builtProfile.photoURL,
    profilePhotoPath: builtProfile.profilePhotoPath,
  };
}

async function upsertCustomerProfileDocument(firebaseUser, profile = {}, options = {}) {
  const reference = customerProfileReference(firebaseUser.uid);
  const payload = buildCustomerProfilePayload(firebaseUser, profile);
  const timestampPayload = {
    updatedAt: serverTimestamp(),
  };

  if (options.isNew) {
    timestampPayload.createdAt = serverTimestamp();
  } else if (options.createdAt) {
    timestampPayload.createdAt = options.createdAt;
  }

  await writeCustomerProfileSnapshot(
    reference,
    {
      ...payload,
      ...timestampPayload,
    },
    { merge: true },
  );

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
    photoURL: normalizeString(existingData?.photoURL || firebaseUser.photoURL),
    profilePhotoPath: normalizeString(existingData?.profilePhotoPath),
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

  try {
    credentials = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
    const authenticatedUser = await requireCustomerFirebaseSession(credentials.user, {
      forceRefresh: true,
      settleMs: 200,
      timeoutMs: 7000,
    });

    if (normalizedFullName || authenticatedUser.photoURL) {
      await updateFirebaseProfile(authenticatedUser, {
        displayName: normalizedFullName || authenticatedUser.displayName || null,
        photoURL: authenticatedUser.photoURL || null,
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
        photoURL: normalizeString(authenticatedUser.photoURL),
        profilePhotoPath: "",
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
  }
}

export async function signInCustomerWithEmailPassword({ email, password }) {
  ensureCustomerFirebaseReady();

  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    throw new Error("Email is required.");
  }

  if (!normalizedEmail.includes("@")) {
    throw createCustomerAppError(
      "customer/email-required",
      "Customer sign-in now uses email and password only.",
    );
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
  const shouldRemovePhoto = updates.removePhoto === true;
  const nextPhotoFile =
    typeof File !== "undefined" && updates.photoFile instanceof File ? updates.photoFile : null;
  let nextPhotoURL = normalizeString(existingProfile.photoURL);
  let nextProfilePhotoPath = normalizeString(existingProfile.profilePhotoPath);
  let uploadedPhotoPath = "";
  const previousPhotoPath = normalizeString(existingProfile.profilePhotoPath);

  if (!nextEmail) {
    throw new Error("Email is required.");
  }

  console.info("[customer-auth] Updating customer profile.", {
    uid: activeAuthUser.uid,
    emailChanged: nextEmail !== normalizeEmail(activeAuthUser.email || existingProfile.email),
    photoUpload: Boolean(nextPhotoFile),
    removePhoto: shouldRemovePhoto,
  });

  try {
    if (nextPhotoFile) {
      try {
        const uploadedPhoto = await uploadCustomerProfilePhoto(activeAuthUser.uid, nextPhotoFile);
        uploadedPhotoPath = uploadedPhoto.storagePath;
        nextPhotoURL = uploadedPhoto.photoURL;
        nextProfilePhotoPath = uploadedPhoto.storagePath;
      } catch (error) {
        if (getFirebaseErrorCode(error) !== "storage/bucket-unavailable") {
          throw error;
        }

        console.warn("[customer-auth] Firebase Storage unavailable; saving compressed profile photo fallback.", {
          uid: activeAuthUser.uid,
        });
        nextPhotoURL = await buildFirestoreProfilePhotoDataUrl(nextPhotoFile);
        nextProfilePhotoPath = "";
      }
    } else if (shouldRemovePhoto && existingProfile.profilePhotoPath) {
      nextPhotoURL = "";
      nextProfilePhotoPath = "";
    }

    if (nextEmail !== normalizeEmail(activeAuthUser.email || "")) {
      await updateEmail(activeAuthUser, nextEmail);
      await activeAuthUser.getIdToken(true);
    }

    await writeCustomerProfileSnapshot(
      reference,
      {
        uid: activeAuthUser.uid,
        email: nextEmail,
        username: nextUsername,
        fullName: nextFullName,
        phone: nextPhone,
        role: "customer",
        accountStatus: normalizeAccountStatus(existingProfile.accountStatus),
        status: normalizeAccountStatus(existingProfile.status),
        photoURL: nextPhotoURL,
        profilePhotoPath: nextProfilePhotoPath,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    await updateFirebaseProfile(activeAuthUser, {
      displayName: nextFullName || null,
      photoURL: isDataUrl(nextPhotoURL) ? null : nextPhotoURL || null,
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
      photoURL: nextPhotoURL,
      profilePhotoPath: nextProfilePhotoPath,
    });

    if (nextPhotoFile && previousPhotoPath && previousPhotoPath !== nextProfilePhotoPath) {
      await deleteStorageObjectIfPresent(previousPhotoPath);
    }

    if (shouldRemovePhoto && previousPhotoPath) {
      await deleteStorageObjectIfPresent(previousPhotoPath);
    }

    console.info("[customer-auth] Customer profile updated successfully.", {
      uid: activeAuthUser.uid,
    });

    return profile;
  } catch (error) {
    console.error("[customer-auth] Customer profile update failed.", {
      uid: activeAuthUser.uid,
      error: buildFirebaseErrorDetails(error),
    });

    if (uploadedPhotoPath) {
      await deleteStorageObjectIfPresent(uploadedPhotoPath);
    }

    throw normalizeCustomerServiceError(error, {
      subject: nextPhotoFile ? "photo" : "profile",
    });
  }
}
