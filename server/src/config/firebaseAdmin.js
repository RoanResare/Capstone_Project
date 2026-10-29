const { env } = require("./env");

let auth = null;
const provider = (process.env.DATABASE_PROVIDER || "postgres").trim().toLowerCase();
if (provider !== "postgres") {
  throw new Error("DATABASE_PROVIDER=postgres is required. Legacy database providers are disabled.");
}
const db = require("../database/postgres").getPostgresDatabase();

if (env.runtime.firebaseAdminReady) {
  const { cert, getApps, initializeApp } = require("firebase-admin/app");
  const { getAuth } = require("firebase-admin/auth");
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: env.firebase.projectId,
        clientEmail: env.firebase.clientEmail,
        privateKey: env.firebase.privateKey,
      }),
      storageBucket: env.firebase.storageBucket || undefined,
    });
  }
  auth = getAuth();
}

module.exports = {
  auth,
  db,
};
