import { apiClient, buildAuthHeaders, extractApiError } from "./apiClient.js";

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
  try {
    const response = await apiClient.get(`/${normalizePortalRole(role)}/users`, {
      headers: buildAuthHeaders(accessToken),
    });
    return response.data;
  } catch (error) {
    throw new Error(extractApiError(error, "Unable to load employee accounts."));
  }
}

export async function createUser(accessToken, payload) {
  try {
    const response = await apiClient.post("/admin/users", payload, {
      headers: buildAuthHeaders(accessToken),
    });
    return response.data;
  } catch (error) {
    console.error("[admin-users] Employee creation request failed.", {
      status: error?.response?.status || null,
      response: error?.response?.data || null,
      message: error instanceof Error ? error.message : String(error || "Unknown error"),
    });
    throw new Error(extractApiError(error, "Unable to create the employee account. Please try again."));
  }
}

export async function updateUser(accessToken, uid, payload) {
  try {
    const response = await apiClient.patch(`/admin/users/${encodeURIComponent(uid)}`, payload, {
      headers: buildAuthHeaders(accessToken),
    });
    return response.data;
  } catch (error) {
    console.error("[admin-users] Employee update request failed.", {
      uid,
      status: error?.response?.status || null,
      response: error?.response?.data || null,
      message: error instanceof Error ? error.message : String(error || "Unknown error"),
    });
    throw new Error(extractApiError(error, "Unable to save employee changes. Please try again."));
  }
}

export async function deleteUser(accessToken, uid) {
  try {
    const response = await apiClient.delete(`/admin/users/${encodeURIComponent(uid)}`, {
      headers: buildAuthHeaders(accessToken),
    });
    return response.data;
  } catch (error) {
    console.error("[admin-users] Employee delete request failed.", {
      uid,
      status: error?.response?.status || null,
      response: error?.response?.data || null,
      message: error instanceof Error ? error.message : String(error || "Unknown error"),
    });
    throw new Error(extractApiError(error, "Unable to delete the employee account. Please try again."));
  }
}

export async function updateMyProfile(accessToken, role, payload) {
  const response = await apiClient.patch(`/${normalizeProfileRole(role)}/profile`, payload, {
    headers: buildAuthHeaders(accessToken),
  });
  return response.data;
}
