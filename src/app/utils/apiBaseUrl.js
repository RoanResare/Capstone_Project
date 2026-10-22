export function resolveApiBaseUrl(configuredUrl, isProduction) {
  const configured = typeof configuredUrl === "string" ? configuredUrl.trim() : "";
  if (!configured) return isProduction ? "/api" : "http://localhost:5000/api";
  const baseUrl = configured.replace(/\/+$/, "");
  // Backend routes live under /api, including when only an origin is configured.
  if (/^https?:\/\/[^/]+$/i.test(baseUrl)) return `${baseUrl}/api`;
  return baseUrl;
}
