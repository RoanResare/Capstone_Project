import { normalizeRole } from "./roleUtils.js";

const ADMIN_ROUTES = new Set([
  "/admin/dashboard",
  "/portal",
  "/portal/appointments",
  "/portal/pet-records",
  "/portal/photo-moderation",
  "/portal/manage-users",
]);

const STAFF_ROUTES = new Set([
  "/staff/dashboard",
  "/portal",
  "/portal/appointments",
  "/portal/pet-records",
  "/portal/photo-moderation",
]);

export function isValidPortalSessionRoute(role = "", pathname = "") {
  const normalizedRole = normalizeRole(role);
  const normalizedPath = typeof pathname === "string" ? pathname.trim() : "";
  const isPortalAdminRoute =
    normalizedPath === "/portal/admin" || normalizedPath.startsWith("/portal/admin/");
  const isAdminDashboardRoute =
    normalizedPath === "/admin/dashboard" || normalizedPath.startsWith("/admin/dashboard/");
  const isStaffDashboardRoute =
    normalizedPath === "/staff/dashboard" || normalizedPath.startsWith("/staff/dashboard/");

  if (normalizedRole === "admin") {
    return ADMIN_ROUTES.has(normalizedPath) || isPortalAdminRoute || isAdminDashboardRoute;
  }

  if (normalizedRole === "staff") {
    return STAFF_ROUTES.has(normalizedPath) || isPortalAdminRoute || isStaffDashboardRoute;
  }

  return true;
}
