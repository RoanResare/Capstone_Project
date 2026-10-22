import axios from "axios";
import { getSecurityEpoch, isCurrentSecurityResponse } from "../utils/securitySession.js";
import { resolveApiBaseUrl } from "../utils/apiBaseUrl.js";

export const apiClient = axios.create({
  timeout: 60000,
  baseURL: resolveApiBaseUrl(
    import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL,
    import.meta.env.PROD,
  ),
  headers: {
    "Content-Type": "application/json",
  },
});

export const SESSION_SECURITY_EVENT = "furfection:session-security-violation";

apiClient.interceptors.request.use((config) => {
  config.securityEpoch = getSecurityEpoch();
  return config;
});

export function reportSessionSecurityViolation(error) {
  if (error?.response?.data?.details?.code === "SESSION_SECURITY_VIOLATION"
    && isCurrentSecurityResponse(error.config?.securityEpoch)) {
    window.dispatchEvent(new CustomEvent(SESSION_SECURITY_EVENT, { detail: { message: error.response.data.message } }));
  }
}

apiClient.interceptors.response.use(
  (response) => {
    if (typeof response.data === "string" && /text\/html/i.test(response.headers["content-type"] || "")) {
      const error = new Error("The API returned a web page instead of JSON. Check the API URL and domain routing.");
      error.response = response;
      return Promise.reject(error);
    }
    return response;
  },
  (error) => {
    reportSessionSecurityViolation(error);
    return Promise.reject(error);
  },
);

export function buildAuthHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
  };
}

export function extractApiError(error, fallbackMessage) {
  const message = error?.response?.data?.message;

  if (typeof message === "string" && message.trim()) {
    return message;
  }

  if (error?.code === "ERR_NETWORK" || error?.message === "Network Error") {
    return "Cannot reach the backend API. The API domain may be blocking requests or unavailable. Please try again shortly.";
  }

  if (["ECONNABORTED", "ETIMEDOUT"].includes(error?.code)) {
    return "The backend took too long to respond. Please wait a moment and try again.";
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallbackMessage;
}
