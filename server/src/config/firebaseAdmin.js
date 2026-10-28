const admin = require("firebase-admin");
const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { env } = require("./env");

let db = null;
let auth = null;

function hasInitializedFirebaseApp() {
  return getApps().length > 0;
}

if (env.runtime.firebaseAdminReady && !hasInitializedFirebaseApp()) {
  initializeApp({
    credential: cert({
      projectId: env.firebase.projectId,
      clientEmail: env.firebase.clientEmail,
      privateKey: env.firebase.privateKey,
    }),
    storageBucket: env.firebase.storageBucket || undefined,
  });
}

if (env.runtime.firebaseAdminReady) {
  const provider = process.env.DATABASE_PROVIDER || "firestore";
  if (!["firestore", "postgres"].includes(provider)) throw new Error("Invalid DATABASE_PROVIDER.");
  db = provider === "postgres" ? require("../database/postgres").getPostgresDatabase() : getFirestore();
  auth = getAuth();
}

admin.firestore = {
  ...(admin.firestore || {}),
  Timestamp,
};

module.exports = {
  admin,
  auth,
  db,
};
