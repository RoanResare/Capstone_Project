export const PRODUCTION_API_BASE_URL = "https://capstone-project-bczf.onrender.com/api";

export function resolveApiBaseUrl(configuredUrl, isProduction) {
  // Pin production traffic while the custom API domain blocks requests upstream.
  if (isProduction) return PRODUCTION_API_BASE_URL;
  const configured = typeof configuredUrl === "string" ? configuredUrl.trim() : "";
  if (!configured) return "http://localhost:5000/api";
  const baseUrl = configured.replace(/\/+$/, "");
  // Backend routes live under /api, including when only an origin is configured.
  if (/^https?:\/\/[^/]+$/i.test(baseUrl)) return `${baseUrl}/api`;
  return baseUrl;
}
