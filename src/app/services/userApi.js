import { apiClient, buildAuthHeaders } from "./apiClient.js";

function normalizeProfileRole(role = "") {
  const value = typeof role === "string" ? role.trim().toLowerCase() : "";

  if (!["customer", "admin", "staff"].includes(value)) {
    throw new Error("A valid signed-in role is required.");
  }

  return value;
}

function normalizePortalRole(role = "") {
  const value = typeof role === "string" ? role.trim().toLowerCase() : "";

  if (!["admin", "staff"].includes(value)) {
    throw new Error("A valid portal role is required.");
  }

  return value;
}

export async function listUsers(accessToken, role) {
  const response = await apiClient.get(`/${normalizePortalRole(role)}/users`, {
    headers: buildAuthHeaders(accessToken),
  });
  return response.data;
}

export async function createUser(accessToken, payload) {
  const response = await apiClient.post("/admin/users", payload, {
    headers: buildAuthHeaders(accessToken),
  });
  return response.data;
}

export async function updateUser(accessToken, uid, payload) {
  const response = await apiClient.patch(`/admin/users/${uid}`, payload, {
    headers: buildAuthHeaders(accessToken),
  });
  return response.data;
}

export async function deleteUser(accessToken, uid) {
  const response = await apiClient.delete(`/admin/users/${uid}`, {
    headers: buildAuthHeaders(accessToken),
  });
  return response.data;
}

export async function updateMyProfile(accessToken, role, payload) {
  const response = await apiClient.patch(`/${normalizeProfileRole(role)}/profile`, payload, {
    headers: buildAuthHeaders(accessToken),
  });
  return response.data;
}
