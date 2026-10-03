const { db } = require("../config/firebaseAdmin");
const { env } = require("../config/env");
const { ApiError } = require("../utils/ApiError");

function normalizeIp(value = "") {
  const candidate = String(value || "").split(",")[0].trim();
  return candidate.startsWith("::ffff:") ? candidate.slice(7) : candidate;
}

function getClientIp(req) {
  return normalizeIp(req.ip || req.socket?.remoteAddress || "unknown");
}

function buildProviderUrl(template, params) {
  const url = new URL(template);
  Object.entries(params).forEach(([key, value]) => {
    if (url.href.includes(`{${key}}`)) {
      url.href = url.href.replaceAll(`{${key}}`, encodeURIComponent(value));
    } else {
      url.searchParams.set(key, value);
    }
  });
  return url;
}

async function callProvider(template, params, apiKey) {
  const url = buildProviderUrl(template, params);
  const headers = { Accept: "application/json" };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
    headers["X-API-Key"] = apiKey;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Provider returned HTTP ${response.status}.`);
  }
  return response.json();
}

async function assertEmailIsDeliverable(email) {
  if (!env.security.emailValidationUrl) {
    return;
  }

  let result;
  try {
    result = await callProvider(
      env.security.emailValidationUrl,
      { email },
      env.security.emailValidationApiKey,
    );
  } catch (error) {
    if (env.security.failClosed) {
      throw new ApiError(503, "Email validation is temporarily unavailable. Please try again later.");
    }
    console.warn("[registration-security] Email validation provider failed.", error);
    return;
  }

  const validityChecks = [
    result?.valid,
    result?.is_valid,
    result?.is_valid_format,
    result?.is_mx_found,
    result?.is_smtp_valid,
    result?.deliverable,
  ].filter((value) => typeof value === "boolean");
  const valid = validityChecks.length > 0 ? validityChecks.every(Boolean) : undefined;
  const disposable = result?.disposable ?? result?.is_disposable;
  if (valid === false || disposable === true || result?.success === false) {
    throw new ApiError(400, "Please use a genuine, deliverable email address.");
  }
}

async function assertPhilippineConnection(ip) {
  if (!env.security.geoLookupUrl) {
    console.warn("[registration-security] Geo/VPN provider is not configured; skipping location verification.");
    return;
  }

  let result;
  try {
    result = await callProvider(env.security.geoLookupUrl, { ip }, env.security.geoLookupApiKey);
  } catch (error) {
    if (env.security.failClosed) {
      throw new ApiError(503, "Location security verification is temporarily unavailable.");
    }
    console.warn("[registration-security] Geo/VPN provider failed.", error);
    return;
  }

  const country = String(result?.country_code || result?.countryCode || result?.country || "").toUpperCase();
  const security = result?.security || result;
  const isVpn = Boolean(security?.vpn || security?.proxy || security?.tor || security?.hosting || result?.is_vpn);
  if (country !== "PH" || isVpn) {
    throw new ApiError(403, "Registration is available only from a non-VPN connection in the Philippines.");
  }
}

async function assertIpAccountLimit(ip) {
  if (!db || !ip || ip === "unknown") {
    return;
  }

  const snapshot = await db.collection("users").where("registrationIp", "==", ip).limit(env.security.maxAccountsPerIp).get();
  if (snapshot.size >= env.security.maxAccountsPerIp) {
    throw new ApiError(429, "The maximum number of accounts for this network has been reached.");
  }
}

async function validateRegistrationSecurity(req, email) {
  const ip = getClientIp(req);
  await assertEmailIsDeliverable(email);
  await assertPhilippineConnection(ip);
  await assertIpAccountLimit(ip);
  return { registrationIp: ip };
}

module.exports = { getClientIp, validateRegistrationSecurity };
