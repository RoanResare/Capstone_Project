const CUSTOMER_ROLE = "customer";
const ADMIN_ROLE = "admin";
const STAFF_ROLE = "staff";
const PORTAL_ROLES = [ADMIN_ROLE, STAFF_ROLE];
const ALL_ROLES = [CUSTOMER_ROLE, ADMIN_ROLE, STAFF_ROLE];
const HOME_PATHS = Object.freeze({
  [CUSTOMER_ROLE]: "/customer/dashboard",
  [ADMIN_ROLE]: "/admin/dashboard",
  [STAFF_ROLE]: "/staff/dashboard",
});
const LOGIN_PATHS = Object.freeze({
  [CUSTOMER_ROLE]: "/customer/login",
  [ADMIN_ROLE]: "/admin/login",
  [STAFF_ROLE]: "/staff/login",
});

export function normalizeRole(role = "") {
  return typeof role === "string" ? role.trim().toLowerCase() : "";
}

export function formatRoleLabel(role = "") {
  const normalized = normalizeRole(role);

  if (!normalized) {
    return "Account";
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function isPortalRole(role = "") {
  return PORTAL_ROLES.includes(normalizeRole(role));
}

export function isCustomerRole(role = "") {
  return normalizeRole(role) === CUSTOMER_ROLE;
}

export function isKnownRole(role = "") {
  return ALL_ROLES.includes(normalizeRole(role));
}

export function isAllowedRole(role = "", allowedRoles = []) {
  const normalizedRole = normalizeRole(role);
  const normalizedAllowedRoles = Array.isArray(allowedRoles)
    ? allowedRoles.map((value) => normalizeRole(value)).filter(Boolean)
    : [];

  return normalizedAllowedRoles.includes(normalizedRole);
}

function normalizePath(path = "") {
  return typeof path === "string" ? path.trim() : "";
}

function matchesPath(pathname = "", targetPath = "") {
  const normalizedPathname = normalizePath(pathname);
  const normalizedTargetPath = normalizePath(targetPath);

  if (!normalizedPathname || !normalizedTargetPath) {
    return false;
  }

  return (
    normalizedPathname === normalizedTargetPath ||
    normalizedPathname.startsWith(`${normalizedTargetPath}/`) ||
    normalizedPathname.startsWith(`${normalizedTargetPath}?`) ||
    normalizedPathname.startsWith(`${normalizedTargetPath}#`)
  );
}

export function canAccessPath(role = "", path = "") {
  const normalizedRole = normalizeRole(role);
  const normalizedPath = normalizePath(path);

  if (!normalizedRole || !normalizedPath) {
    return false;
  }

  if (normalizedRole === CUSTOMER_ROLE) {
    return matchesPath(normalizedPath, HOME_PATHS.customer);
  }

  if (normalizedRole === ADMIN_ROLE) {
    return (
      matchesPath(normalizedPath, HOME_PATHS.admin) || matchesPath(normalizedPath, "/portal")
    );
  }

  if (normalizedRole === STAFF_ROLE) {
    if (matchesPath(normalizedPath, HOME_PATHS.staff)) {
      return true;
    }

    if (!matchesPath(normalizedPath, "/portal")) {
      return false;
    }

    return !matchesPath(normalizedPath, "/portal/manage-users");
  }

  return false;
}

export function resolveAuthorizedPath(role = "", requestedPath = "") {
  const normalizedRequestedPath = normalizePath(requestedPath);

  if (canAccessPath(role, normalizedRequestedPath)) {
    return normalizedRequestedPath;
  }

  return resolveHomePath(role);
}

export function createAccessDeniedState({
  actualRole = "",
  allowedRoles = [],
  requestedPath = "",
} = {}) {
  return {
    actualRole: normalizeRole(actualRole),
    allowedRoles: Array.isArray(allowedRoles)
      ? allowedRoles.map((role) => normalizeRole(role)).filter(Boolean)
      : [],
    requestedPath: normalizePath(requestedPath),
  };
}

export function buildRoleMismatchMessage(expectedRole = "", actualRole = "") {
  const normalizedExpectedRole = normalizeRole(expectedRole);
  const normalizedActualRole = normalizeRole(actualRole);

  if (!normalizedExpectedRole) {
    return "This login portal is restricted to a specific account type.";
  }

  if (!normalizedActualRole) {
    return `This login portal only accepts ${formatRoleLabel(normalizedExpectedRole).toLowerCase()} accounts.`;
  }

  return `This login portal only accepts ${formatRoleLabel(normalizedExpectedRole).toLowerCase()} accounts. You tried to sign in with a ${formatRoleLabel(normalizedActualRole).toLowerCase()} account.`;
}

export function resolveHomePath(role = "") {
  const normalizedRole = normalizeRole(role);

  if (HOME_PATHS[normalizedRole]) {
    return HOME_PATHS[normalizedRole];
  }

  return "/";
}

export function resolveLoginPath(allowedRoles = []) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles.map(normalizeRole) : [];

  if (roles.length === 1 && LOGIN_PATHS[roles[0]]) {
    return LOGIN_PATHS[roles[0]];
  }

  return "/login";
}
