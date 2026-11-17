const { randomBytes } = require("node:crypto");
const { getPostgresDatabase } = require("../src/database/postgres");
const {
  createSupabaseUser,
  deleteSupabaseUser,
  findSupabaseUserByEmail,
  getSupabaseUserById,
  updateSupabaseUser,
} = require("../src/services/supabaseAuth.service");
const { env } = require("../src/config/env");

const execute = process.argv.includes("--execute");
const confirmEmailOwnership = process.argv.includes("--confirm-email-ownership");
const emailArgument = process.argv.find((argument) => argument.startsWith("--emails="));
const targetEmails = new Set((emailArgument?.slice("--emails=".length) || "")
  .split(",").map(normalizeEmail).filter(Boolean));

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeRole(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeStatus(profile) {
  return String(profile.accountStatus || profile.status || "active").trim().toLowerCase();
}

async function loadEligibleProfiles(db) {
  const snapshot = await db.collection("users").get();
  const allProfiles = snapshot.docs.map((document) => ({
    document,
    profile: document.data() || {},
  }));
  const emailCounts = new Map();

  for (const { profile } of allProfiles) {
    const email = normalizeEmail(profile.email);
    if (email) emailCounts.set(email, (emailCounts.get(email) || 0) + 1);
  }

  return allProfiles
    .filter(({ profile }) => ["admin", "staff"].includes(normalizeRole(profile.role))
      && normalizeStatus(profile) === "active")
    .map(({ document, profile }) => ({
      document,
      profile,
      email: normalizeEmail(profile.email),
      role: normalizeRole(profile.role),
    }))
    .filter(({ email }) => email && (!targetEmails.size || targetEmails.has(email)))
    .map((entry) => ({ ...entry, duplicateProfileEmail: emailCounts.get(entry.email) !== 1 }));
}

async function getOrCreateAuthUser(profile, email, role) {
  let authUser;
  let created = false;
  try {
    if (profile.authUserId) {
      authUser = await getSupabaseUserById(profile.authUserId);
      if (normalizeEmail(authUser.email) !== email) {
        throw new Error(`Profile ${email} has a linked Supabase identity with a different email; manual review is required.`);
      }
    } else {
      authUser = await findSupabaseUserByEmail(email);
      if (!authUser) {
        const seedPassword = randomBytes(48).toString("base64url");
        authUser = await createSupabaseUser({
          email,
          password: seedPassword,
          emailConfirmed: true,
          userMetadata: { full_name: profile.fullName || profile.name || "", role },
        });
        created = true;
      }
    }

    if (!authUser?.id) throw new Error(`Supabase Auth returned no identity for ${email}.`);
    if (!authUser.email_confirmed_at && !authUser.confirmed_at) {
      if (!confirmEmailOwnership) {
        throw new Error(`${email} is unconfirmed in Supabase Auth. Re-run only after verifying ownership and passing --confirm-email-ownership.`);
      }
      authUser = await updateSupabaseUser(authUser.id, { email_confirm: true });
    }

    const metadata = authUser.user_metadata || {};
    const fullName = profile.fullName || profile.name || "";
    if (metadata.role !== role || (fullName && metadata.full_name !== fullName)) {
      authUser = await updateSupabaseUser(authUser.id, {
        user_metadata: { ...metadata, full_name: fullName, role },
      });
    }
    return { authUser, created };
  } catch (error) {
    if (created && authUser?.id) await deleteSupabaseUser(authUser.id).catch(() => {});
    throw error;
  }
}

async function linkProfile(db, document, profile, authUserId) {
  return db.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(document.ref);
    const currentProfile = currentSnapshot.data();
    if (!currentSnapshot.exists || !currentProfile) throw new Error(`PostgreSQL profile ${document.id} disappeared during provisioning.`);
    if (normalizeEmail(currentProfile.email) !== normalizeEmail(profile.email)
      || normalizeRole(currentProfile.role) !== normalizeRole(profile.role)
      || normalizeStatus(currentProfile) !== "active") {
      throw new Error(`PostgreSQL profile ${profile.email} changed during provisioning; no link was written.`);
    }
    if (currentProfile.authUserId && currentProfile.authUserId !== authUserId) {
      throw new Error(`PostgreSQL profile ${profile.email} is already linked to another Supabase identity.`);
    }

    const existingLink = await transaction.get(
      db.collection("users").where("authUserId", "==", authUserId).limit(2),
    );
    if (existingLink.docs.some((entry) => entry.id !== document.id)) {
      throw new Error(`Supabase identity ${authUserId} is already linked to a different PostgreSQL profile.`);
    }

    transaction.set(document.ref, { authUserId, updatedAt: new Date().toISOString() }, { merge: true });
  });
}

async function main() {
  if (!env.runtime.supabaseAdminReady) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in the server environment.");
  if (execute && !targetEmails.size) throw new Error("Execution requires an explicit --emails=email1,email2 allowlist.");
  if (execute && !confirmEmailOwnership) throw new Error("Execution requires --confirm-email-ownership after verifying each employee email address.");

  const db = getPostgresDatabase();
  try {
    const profiles = await loadEligibleProfiles(db);
    if (!profiles.length) throw new Error("No active admin/staff PostgreSQL profiles matched the requested email list.");
    const matchedEmails = new Set(profiles.map(({ email }) => email));
    const missingEmails = [...targetEmails].filter((email) => !matchedEmails.has(email));
    if (missingEmails.length) throw new Error(`No active admin/staff PostgreSQL profile found for: ${missingEmails.join(", ")}.`);

    for (const entry of profiles) {
      const { document, profile, email, role } = entry;
      if (entry.duplicateProfileEmail) {
        console.error(`[skip] ${email} (${role}): duplicate PostgreSQL profile email; resolve manually.`);
        process.exitCode = 1;
        continue;
      }
      if (profile.authUserId) {
        console.info(`[check] ${email} (${role}): profile already has authUserId ${profile.authUserId}.`);
      } else {
        const existingAuthUser = await findSupabaseUserByEmail(email);
        console.info(`[${existingAuthUser ? "link" : "create + link"}] ${email} (${role}).`);
      }
      if (!execute) continue;

      let createdAuthId = "";
      try {
        const { authUser, created } = await getOrCreateAuthUser(profile, email, role);
        if (created) createdAuthId = authUser.id;
        await linkProfile(db, document, profile, authUser.id);
        console.info(`[done] ${email} (${role}) linked to Supabase Auth ID ${authUser.id}.`);
      } catch (error) {
        if (createdAuthId) await deleteSupabaseUser(createdAuthId).catch(() => {});
        console.error(`[failed] ${email} (${role}): ${error.message}`);
        process.exitCode = 1;
      }
    }

    if (execute && process.exitCode !== 1) {
      console.info("Provisioning finished. Each employee must use the app's Forgot Password flow to set a private password before signing in.");
      console.info("No generated seed password was displayed or stored by this script.");
    } else if (!execute) {
      console.info("Dry run only. To provision, pass an explicit --emails allowlist, --execute, and --confirm-email-ownership.");
    }
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(`[provision-supabase-staff] ${error.message}`);
  process.exitCode = 1;
});
