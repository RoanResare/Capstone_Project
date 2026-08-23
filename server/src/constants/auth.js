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

const OTP_COLLECTION = "admin_staff_otp";
const USERS_COLLECTION = "users";

module.exports = {
  OTP_COLLECTION,
  USER_ROLES,
  USER_STATUSES,
  USERS_COLLECTION,
};
