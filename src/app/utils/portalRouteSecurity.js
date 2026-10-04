import { isPortalRole, isRegisteredPortalPath } from "./roleUtils.js";

export function isValidPortalSessionRoute(role = "", pathname = "") {
  // Route validity and account authorization are separate: RequireAuth enforces the role.
  return !isPortalRole(role) || isRegisteredPortalPath(pathname);
}
