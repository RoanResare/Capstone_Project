const { db } = require("../config/firebaseAdmin");
const { normalizePhilippineMobileNumber } = require("../utils/phoneNumber");

const PHONE_ACCOUNT_LIMIT = 3;
const PHONE_ACCOUNT_LIMIT_MESSAGE = "This phone number already has 3 accounts. Use another phone number to register.";

async function findPhoneAccounts(phone, reader = db) {
  const normalized = normalizePhilippineMobileNumber(phone);
  if (!normalized) return [];
  // Include legacy domestic and unformatted numbers, without a truncated lookup.
  const query = db.collection("users");
  const snapshot = reader === db ? await query.get() : await reader.get(query);
  return snapshot.docs.filter((entry) => normalizePhilippineMobileNumber(entry.data().phone) === normalized).map((entry) => entry.id);
}

module.exports = { findPhoneAccounts, PHONE_ACCOUNT_LIMIT, PHONE_ACCOUNT_LIMIT_MESSAGE };
