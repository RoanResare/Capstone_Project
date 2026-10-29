const { ApiError } = require("../utils/ApiError");
const { USER_ROLES } = require("../constants/auth");

function normalizeRoles(allowedRoles = []) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  return roles
    .filter((role) => typeof role === "string")
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);
}

function verifyRole(allowedRoles = []) {
  const expectedRoles = normalizeRoles(allowedRoles);

  return (req, _res, next) => {
    const currentRole =
      typeof req.auth?.user?.role === "string" ? req.auth.user.role.trim().toLowerCase() : "";

    if (!expectedRoles.includes(currentRole)) {
      return next(new ApiError(403, "You do not have permission to access this resource."));
    }

    return next();
  };
}

const verifyAdmin = verifyRole(USER_ROLES.ADMIN);
const verifyStaff = verifyRole(USER_ROLES.STAFF);
const verifyCustomer = verifyRole(USER_ROLES.CUSTOMER);

module.exports = {
  authorize: verifyRole,
  verifyAdmin,
  verifyCustomer,
  verifyRole,
  verifyStaff,
};
