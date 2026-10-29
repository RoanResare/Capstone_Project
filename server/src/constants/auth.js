const USER_ROLES = Object.freeze({
  CUSTOMER: "customer",
  ADMIN: "admin",
  STAFF: "staff",
});

const USER_STATUSES = Object.freeze({
  ACTIVE: "active",
  INACTIVE: "inactive",
  SUSPENDED: "suspended",
});

const FRAUD_STATUSES = Object.freeze({
  NORMAL: "normal",
  FLAGGED: "flagged",
  RESTRICTED: "restricted",
  SUSPENDED: "suspended",
  BANNED: "banned",
});

const OTP_COLLECTION = "admin_staff_otp";
const USERS_COLLECTION = "users";

module.exports = {
  OTP_COLLECTION,
  USER_ROLES,
  USER_STATUSES,
  FRAUD_STATUSES,
  USERS_COLLECTION,
};
