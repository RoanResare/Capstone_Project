import { loginCustomerUser } from "./authApi.js";
import { apiClient, buildAuthHeaders, extractApiError } from "./apiClient.js";
import { getSupabaseAccessToken, installSupabaseSession, loadSupabaseProfile, setSupabaseSessionPersistence, signOutSupabase } from "./supabaseSession.js";
import { getPasswordPolicyError } from "../utils/passwordPolicy.js";
import { assertAppropriateText, ACCOUNT_TEXT_FIELDS } from "../../../shared/textModeration.mjs";
import { resolveCustomerFullName } from "../../../shared/customerName.mjs";

function normalizeEmail(value = "") { return typeof value === "string" ? value.trim().toLowerCase() : ""; }

export async function changeCustomerPassword(currentPassword, newPassword, confirmPassword) {
  if (!newPassword || newPassword !== confirmPassword) throw new Error("New passwords do not match.");
  const passwordError = getPasswordPolicyError(newPassword);
  if (passwordError) throw new Error(passwordError);
  const accessToken = await getSupabaseAccessToken();
  if (!accessToken) throw new Error("You must be signed in to change your password.");
  try {
    await apiClient.post("/auth/change-password", { currentPassword, newPassword }, { headers: buildAuthHeaders(accessToken) });
  } catch (error) {
    throw new Error(extractApiError(error, "Unable to update the password."));
  }
}

export async function signUpCustomerWithEmailPassword({ fullName, email, password, phone = "", username = "" }) {
  fullName = resolveCustomerFullName({ fullName, username, email });
  assertAppropriateText({ fullName, email, username }, ACCOUNT_TEXT_FIELDS);
  // The registration endpoint owns validation and uniqueness. A separate
  // availability request can go stale and must not gate account creation.
  try {
    const response = await apiClient.post("/auth/register/profile", {
      fullName: String(fullName || "").trim(), email: normalizeEmail(email), password, phone, username,
    });
    return { profile: response.data.profile };
  } catch (error) {
    throw new Error(extractApiError(error, "Unable to create your account right now."));
  }
}

export async function signInCustomerWithEmailPassword({ email, password, rememberDevice = false }) {
  const response = await loginCustomerUser({ identifier: normalizeEmail(email), password });
  setSupabaseSessionPersistence(rememberDevice);
  const session = await installSupabaseSession(response.supabaseSession);
  const profile = await loadSupabaseProfile(session.access_token);
  if (profile.role !== "customer") {
    await signOutSupabase();
    throw new Error("This login portal only accepts customer accounts.");
  }
  return { supabaseUser: session.user, profile };
}

export async function updateCustomerProfile(currentUser, updates = {}) {
  assertAppropriateText(updates, ACCOUNT_TEXT_FIELDS);
  const accessToken = await getSupabaseAccessToken();
  if (!accessToken) throw new Error("You must be signed in to update your profile.");
  try {
    const { data } = await apiClient.patch("/customer/profile", {
      fullName: updates.fullName || currentUser.fullName,
      email: normalizeEmail(updates.email || currentUser.email),
      phone: updates.phone || currentUser.phone || "",
      currentPassword: updates.verificationPassword || "",
    }, { headers: buildAuthHeaders(accessToken) });
    return data.user;
  } catch (error) {
    throw new Error(extractApiError(error, "Unable to update your profile."));
  }
}
