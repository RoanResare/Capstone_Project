import axios from "axios";
import { getSecurityEpoch, isCurrentSecurityResponse } from "../utils/securitySession.js";

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api",
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
  (response) => response,
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
    return "Cannot reach the backend API. Start the server and verify it is listening on the URL configured by VITE_API_BASE_URL.";
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallbackMessage;
}
