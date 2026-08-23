const { db } = require("../src/config/firebaseAdmin");
const { env } = require("../src/config/env");

function normalizeUsername(username = "") {
  return typeof username === "string" ? username.trim().toLowerCase() : "";
}

function deriveUsernameFromEmail(email = "") {
  const [localPart = ""] = (typeof email === "string" ? email.trim().toLowerCase() : "").split("@");
  return normalizeUsername(localPart);
}

function isValidUsername(username = "") {
  return /^[a-z0-9._-]{3,24}$/.test(username);
}

async function main() {
  if (!env.runtime.firebaseAdminReady || !db) {
    throw new Error("Firebase Admin credentials are not configured in the server environment.");
  }

  const usersSnapshot = await db.collection("users").get();

  if (usersSnapshot.empty) {
    console.log("No user documents were found.");
    return;
  }

  let updatedCount = 0;

  for (const snapshot of usersSnapshot.docs) {
    const user = snapshot.data() || {};
    const email = typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
    const username = normalizeUsername(user.username || deriveUsernameFromEmail(email));

    if (!email || !isValidUsername(username)) {
      console.warn(`Skipping ${snapshot.id}: missing email or invalid username candidate.`);
      continue;
    }

    const usernameReference = db.collection("usernames").doc(username);
    const usernameSnapshot = await usernameReference.get();

    if (usernameSnapshot.exists && usernameSnapshot.data()?.uid !== snapshot.id) {
      console.warn(
        `Skipping ${snapshot.id}: username "${username}" is already linked to ${usernameSnapshot.data()?.uid}.`,
      );
      continue;
    }

    const timestamp = new Date().toISOString();
    const batch = db.batch();
    batch.set(
      snapshot.ref,
      {
        username,
        updatedAt: timestamp,
      },
      { merge: true },
    );
    batch.set(
      usernameReference,
      {
        uid: snapshot.id,
        email,
        username,
        updatedAt: timestamp,
      },
      { merge: true },
    );
    await batch.commit();
    updatedCount += 1;
  }

  console.log(`Username backfill completed. Updated ${updatedCount} user records.`);
}

main().catch((error) => {
  console.error("Username backfill failed.", error);
  process.exitCode = 1;
});
