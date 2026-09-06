const { USER_ROLES, USER_STATUSES } = require("../constants/auth");
const { env } = require("../config/env");
const {
  createPortalUser,
  deletePortalUser,
  ensureAdminCanMutateTarget,
  listPortalUsers,
  toPublicUser,
  updateOwnUser,
  updatePortalUser,
} = require("../services/user.service");
const { ApiError } = require("../utils/ApiError");
const { hashPassword, assertStrongPassword } = require("../utils/password");
const { assertAuthSetupReady } = require("../utils/setupGuard");

function normalizePortalRole(role = "") {
  const value = typeof role === "string" ? role.trim().toLowerCase() : "";

  if (![USER_ROLES.ADMIN, USER_ROLES.STAFF].includes(value)) {
    throw new ApiError(400, "Role must be either admin or staff.");
  }

  return value;
}

function normalizeAccountStatus(status = "") {
  const value = typeof status === "string" ? status.trim().toLowerCase() : "";

  if (![USER_STATUSES.ACTIVE, USER_STATUSES.INACTIVE, USER_STATUSES.SUSPENDED].includes(value)) {
    throw new ApiError(400, "Account status must be active, inactive, or suspended.");
  }

  return value;
}

function logAdminUserRequest(req, action, details = {}) {
  if (env.nodeEnv === "production") {
    return;
  }

  console.info(`[admin-users] ${action} request received`, {
    actorUid: req.auth?.user?.uid || "",
    actorEmail: req.auth?.user?.email || "",
    ...details,
  });
}

async function listUsers(req, res) {
  assertAuthSetupReady();
  const shouldRepair = req.auth?.user?.role === USER_ROLES.ADMIN;
  logAdminUserRequest(req, "list", { repair: shouldRepair });
  const users = await listPortalUsers({ repair: shouldRepair });

  return res.status(200).json({
    success: true,
    users: users.map(toPublicUser),
  });
}

async function createUser(req, res) {
  assertAuthSetupReady();
  const fullName = typeof req.body?.fullName === "string" ? req.body.fullName.trim() : "";
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password.trim() : "";
  const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
  const role = normalizePortalRole(req.body?.role);
  const accountStatus = USER_STATUSES.ACTIVE;

  if (!fullName || !email || !password) {
    throw new ApiError(400, "Full name, email, password, and role are required.");
  }

  assertStrongPassword(password);
  logAdminUserRequest(req, "create", { email, role, accountStatus });

  const user = await createPortalUser({
    fullName,
    email,
    username: req.body?.username,
    password,
    passwordHash: hashPassword(password),
    phone,
    role,
    accountStatus,
  });

  return res.status(201).json({
    success: true,
    user: toPublicUser(user),
  });
}

async function updateUser(req, res) {
  assertAuthSetupReady();
  const targetUid = req.params.uid;
  const nextRole = req.body?.role ? normalizePortalRole(req.body.role) : "";
  const nextAccountStatus =
    req.body?.accountStatus || req.body?.status
      ? normalizeAccountStatus(req.body.accountStatus || req.body.status)
      : "";
  const nextPassword =
    typeof req.body?.password === "string" ? req.body.password.trim() : "";

  if (nextPassword) {
    assertStrongPassword(nextPassword);
  }

  logAdminUserRequest(req, "update", {
    targetUid,
    roleChanged: Boolean(nextRole),
    statusChanged: Boolean(nextAccountStatus),
    passwordChanged: Boolean(nextPassword),
  });

  await ensureAdminCanMutateTarget(
    req.auth.user,
    targetUid,
    nextRole,
    nextAccountStatus,
    false,
  );

  const user = await updatePortalUser(targetUid, {
    fullName: req.body?.fullName,
    email: req.body?.email,
    username: req.body?.username,
    password: nextPassword || undefined,
    passwordHash: nextPassword ? hashPassword(nextPassword) : undefined,
    phone: req.body?.phone,
    role: nextRole || undefined,
    accountStatus: nextAccountStatus || undefined,
  });

  return res.status(200).json({
    success: true,
    user: toPublicUser(user),
  });
}

async function removeUser(req, res) {
  assertAuthSetupReady();
  const targetUid = req.params.uid;
  logAdminUserRequest(req, "delete", { targetUid });
  await ensureAdminCanMutateTarget(req.auth.user, targetUid, "", "", true);
  await deletePortalUser(targetUid);

  return res.status(200).json({
    success: true,
    message: "The employee account was deleted successfully.",
  });
}

async function updateMyProfile(req, res) {
  assertAuthSetupReady();
  const fullName = typeof req.body?.fullName === "string" ? req.body.fullName.trim() : "";
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";

  if (!fullName || !email) {
    throw new ApiError(400, "Full name and email are required.");
  }

  const user = await updateOwnUser(req.auth.user.uid, {
    fullName,
    email,
    phone,
  });

  return res.status(200).json({
    success: true,
    user: toPublicUser(user),
  });
}

module.exports = {
  createUser,
  listUsers,
  removeUser,
  updateMyProfile,
  updateUser,
};
