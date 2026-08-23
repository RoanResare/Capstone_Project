const crypto = require("crypto");
const { env } = require("../config/env");
const { ApiError } = require("./ApiError");

const PASSWORD_POLICY_MESSAGE =
  "Password must be at least 8 characters and include uppercase, lowercase, number, and special characters.";
const PASSWORD_HASH_VERSION = 1;

function assertStrongPassword(password = "") {
  const value = typeof password === "string" ? password : "";
  const isValid =
    value.length >= 8 &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /\d/.test(value) &&
    /[^A-Za-z0-9]/.test(value);

  if (!isValid) {
    throw new ApiError(400, PASSWORD_POLICY_MESSAGE);
  }

  return value;
}

function buildDerivedKey(password, salt) {
  return crypto
    .scryptSync(password, `${salt}:${env.auth.passwordHashPepper}`, 64)
    .toString("hex");
}

function hashPassword(password) {
  const normalizedPassword = assertStrongPassword(password);
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = buildDerivedKey(normalizedPassword, salt);
  return `scrypt$${PASSWORD_HASH_VERSION}$${salt}$${hash}`;
}

function verifyPasswordHash(password, storedHash = "") {
  if (typeof storedHash !== "string" || !storedHash.trim()) {
    return false;
  }

  const [algorithm, version, salt, hash] = storedHash.split("$");
  if (algorithm !== "scrypt" || Number(version) !== PASSWORD_HASH_VERSION || !salt || !hash) {
    return false;
  }

  const candidate = buildDerivedKey(String(password || ""), salt);
  const candidateBuffer = Buffer.from(candidate, "hex");
  const storedBuffer = Buffer.from(hash, "hex");

  if (candidateBuffer.length !== storedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(candidateBuffer, storedBuffer);
}

module.exports = {
  PASSWORD_POLICY_MESSAGE,
  assertStrongPassword,
  hashPassword,
  verifyPasswordHash,
};
