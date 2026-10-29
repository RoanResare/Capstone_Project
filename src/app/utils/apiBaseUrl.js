export const PRODUCTION_API_BASE_URL = "/api";

export function resolveApiBaseUrl(configuredUrl, isProduction) {
  // The Express service serves both the SPA and API. Same-origin traffic keeps
  // production independent of a second custom API hostname and its CORS/DNS.
  if (isProduction) return PRODUCTION_API_BASE_URL;
  const configured = typeof configuredUrl === "string" ? configuredUrl.trim() : "";
  if (!configured) return "http://localhost:5000/api";
  const baseUrl = configured.replace(/\/+$/, "");
  // Backend routes live under /api, including when only an origin is configured.
  if (/^https?:\/\/[^/]+$/i.test(baseUrl)) return `${baseUrl}/api`;
  return baseUrl;
}
