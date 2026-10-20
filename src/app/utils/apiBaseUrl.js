export function resolveApiBaseUrl(configuredUrl, isProduction) {
  const configured = typeof configuredUrl === "string" ? configuredUrl.trim() : "";
  return configured || (isProduction ? "/api" : "http://localhost:5000/api");
}
