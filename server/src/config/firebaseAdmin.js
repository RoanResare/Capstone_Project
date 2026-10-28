const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { env } = require("./env");

let auth = null;
const provider = (process.env.DATABASE_PROVIDER || "postgres").trim().toLowerCase();
if (provider !== "postgres") {
  throw new Error("DATABASE_PROVIDER=postgres is required. Legacy database providers are disabled.");
}
const db = require("../database/postgres").getPostgresDatabase();

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
  auth = getAuth();
}

module.exports = {
  auth,
  db,
};
