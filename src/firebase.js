import { getApp, getApps, initializeApp } from "firebase/app";
import { getAnalytics, isSupported as isAnalyticsSupported } from "firebase/analytics";
import { browserLocalPersistence, getAuth, setPersistence } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";

function normalizeEnvValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStorageBucket(value) {
  return normalizeEnvValue(value).replace(/^gs:\/\//, "").replace(/\/+$/, "");
}

function isUsableValue(value) {
  return Boolean(normalizeEnvValue(value)) && !normalizeEnvValue(value).startsWith("your_");
}

function canUsePersistentFirestoreCache() {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function createFirestore(app, hasExistingApp) {
  if (hasExistingApp) {
    return getFirestore(app);
  }

  if (canUsePersistentFirestoreCache()) {
    try {
      return initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      });
    } catch (error) {
      console.warn("Falling back to in-memory Firestore cache.", error);
    }
  }

  return initializeFirestore(app, {
    localCache: memoryLocalCache(),
  });
}

const viteEnv = typeof import.meta !== "undefined" && import.meta.env ? import.meta.env : {};
const craEnv = typeof process !== "undefined" && process.env ? process.env : {};

function readEnv(viteKey, craKey) {
  return normalizeEnvValue(viteEnv[viteKey] ?? craEnv[craKey]);
}

const firebaseConfig = {
  apiKey: readEnv("VITE_FIREBASE_API_KEY", "REACT_APP_FIREBASE_API_KEY"),
  authDomain: readEnv("VITE_FIREBASE_AUTH_DOMAIN", "REACT_APP_FIREBASE_AUTH_DOMAIN"),
  projectId: readEnv("VITE_FIREBASE_PROJECT_ID", "REACT_APP_FIREBASE_PROJECT_ID"),
  storageBucket: normalizeStorageBucket(
    readEnv("VITE_FIREBASE_STORAGE_BUCKET", "REACT_APP_FIREBASE_STORAGE_BUCKET"),
  ),
  messagingSenderId: readEnv(
    "VITE_FIREBASE_MESSAGING_SENDER_ID",
    "REACT_APP_FIREBASE_MESSAGING_SENDER_ID",
  ),
  appId: readEnv("VITE_FIREBASE_APP_ID", "REACT_APP_FIREBASE_APP_ID"),
};

const measurementId = readEnv("VITE_FIREBASE_MEASUREMENT_ID", "REACT_APP_FIREBASE_MEASUREMENT_ID");

if (isUsableValue(measurementId)) {
  firebaseConfig.measurementId = measurementId;
}

Object.freeze(firebaseConfig);

const requiredFirebaseKeys = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"];
const missingFirebaseKeys = requiredFirebaseKeys.filter((key) => !isUsableValue(firebaseConfig[key]));

let app = null;
let auth = null;
let db = null;
let storage = null;
let analyticsPromise = Promise.resolve(null);
let authPersistenceReadyPromise = Promise.resolve();
let firebaseConfigError = "";

if (missingFirebaseKeys.length > 0) {
  firebaseConfigError = `Firebase web configuration is missing: ${missingFirebaseKeys.join(", ")}.`;
} else {
  try {
    const hasExistingApp = getApps().length > 0;
    app = hasExistingApp ? getApp() : initializeApp(firebaseConfig);
    auth = getAuth(app);
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      authPersistenceReadyPromise = setPersistence(auth, browserLocalPersistence).catch((error) => {
        console.warn("Unable to configure Firebase Authentication persistence.", error);
      });
    }
    db = createFirestore(app, hasExistingApp);
    storage = getStorage(app);

    const canUseAnalytics =
      typeof window !== "undefined" &&
      typeof document !== "undefined" &&
      isUsableValue(firebaseConfig.measurementId);

    if (canUseAnalytics) {
      analyticsPromise = isAnalyticsSupported()
        .then((supported) => (supported ? getAnalytics(app) : null))
        .catch(() => null);
    }
  } catch (error) {
    firebaseConfigError =
      error instanceof Error
        ? error.message
        : "Firebase web configuration could not be initialized.";
  }
}

const isFirebaseConfigured = Boolean(app && auth && db && storage && !firebaseConfigError);

export {
  app,
  auth,
  authPersistenceReadyPromise,
  db,
  storage,
  analyticsPromise,
  firebaseConfigError,
  firebaseConfig,
  isFirebaseConfigured,
};
