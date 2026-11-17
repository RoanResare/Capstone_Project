const { createHash } = require("node:crypto");
const { db } = require("../config/postgresDatabase");
const { ApiError } = require("../utils/ApiError");

const MAX_FAILED_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 60 * 1000;
const OTP_LOCKOUT_MS = 5 * 60 * 1000;
const LOCKOUT_MS = LOGIN_LOCKOUT_MS;

function attemptReference(scope, identity) {
  const key = createHash("sha256").update(`${scope}:${String(identity).trim().toLowerCase()}`).digest("hex");
  return db.collection("authenticationAttempts").doc(key);
}

function lockError(state, now = Date.now()) {
  if (!(state?.lockedUntil > now)) return null;
  const retryAfterSeconds = Math.ceil((state.lockedUntil - now) / 1000);
  const scope = state.scope || "login";
  return new ApiError(429, scope === "login"
    ? `Too many failed attempts. Please try again in ${retryAfterSeconds} seconds.`
    : `Too many failed attempts. Try again in ${retryAfterSeconds} seconds.`, {
    code: "AUTH_ATTEMPTS_LOCKED", attemptsRemaining: 0, retryAfterSeconds,
    scope,
    lockedUntil: new Date(state.lockedUntil).toISOString(),
  });
}

function failedAttempt(state = {}, now = Date.now(), scope = state.scope || "login") {
  const failures = (state.lockedUntil && state.lockedUntil <= now ? 0 : Number(state.failures) || 0) + 1;
  const lockoutMs = scope === "otp" ? OTP_LOCKOUT_MS : LOGIN_LOCKOUT_MS;
  return { failures, lockedUntil: failures >= MAX_FAILED_ATTEMPTS ? now + lockoutMs : 0, updatedAt: now, scope };
}

async function assertAttemptsAllowed(scope, identity) {
  const snapshot = await attemptReference(scope, identity).get();
  const error = lockError(snapshot.data());
  if (error) throw error;
}

async function recordFailedAttempt(scope, identity) {
  const reference = attemptReference(scope, identity);
  const state = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    const current = snapshot.data() || {};
    const error = lockError(current);
    if (error) throw error;
    const next = failedAttempt(current, Date.now(), scope);
    transaction.set(reference, { ...next, scope });
    return next;
  });
  return Math.max(0, MAX_FAILED_ATTEMPTS - state.failures);
}

async function resetAttempts(scope, identity) {
  const reference = attemptReference(scope, identity);
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    // A successful check that was already in flight cannot clear a newer lock.
    const error = lockError(snapshot.data());
    if (error) throw error;
    transaction.set(reference, { failures: 0, lockedUntil: 0, updatedAt: Date.now() });
  });
}

module.exports = { MAX_FAILED_ATTEMPTS, LOCKOUT_MS, LOGIN_LOCKOUT_MS, OTP_LOCKOUT_MS, attemptReference, lockError, failedAttempt,
  assertAttemptsAllowed, recordFailedAttempt, resetAttempts };
