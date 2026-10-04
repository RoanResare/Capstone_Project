const { db } = require("../config/firebaseAdmin");
const { env } = require("../config/env");
const { ApiError } = require("../utils/ApiError");

function normalizeIp(value = "") {
  const candidate = String(value || "").split(",")[0].trim();
  return candidate.startsWith("::ffff:") ? candidate.slice(7) : candidate;
}

function getClientIp(req) {
  return normalizeIp(
    req.ip ||
      req.socket?.remoteAddress ||
      "unknown",
  );
}

function buildProviderUrl(template, params) {
  let expanded = template;
  const queryParams = {};
  Object.entries(params).forEach(([key, value]) => {
    if (expanded.includes(`{${key}}`)) {
      expanded = expanded.replaceAll(`{${key}}`, encodeURIComponent(value));
    } else {
      queryParams[key] = value;
    }
  });
  const url = new URL(expanded);
  Object.entries(queryParams).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

async function callProvider(template, params, apiKey) {
  const url = buildProviderUrl(template, params);
  const headers = { Accept: "application/json" };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
    headers["X-API-Key"] = apiKey;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);

  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Provider returned HTTP ${response.status}.`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

const trustedEmailDomains = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.com.ph",
  "ymail.com",
  "rocketmail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "zoho.com",
]);

const disposableEmailDomains = new Set([
  "10minutemail.com",
  "guerrillamail.com",
  "mailinator.com",
  "tempmail.com",
  "temp-mail.org",
  "throwawaymail.com",
  "yopmail.com",
]);

function getEmailDomain(email = "") {
  return String(email || "").trim().toLowerCase().split("@").pop() || "";
}

async function assertEmailIsDeliverable(email) {
  const domain = getEmailDomain(email);

  if (trustedEmailDomains.has(domain)) {
    return;
  }

  if (disposableEmailDomains.has(domain)) {
    throw new ApiError(400, "Please use a genuine, deliverable email address.");
  }

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
    result?.deliverable,
  ].filter((value) => typeof value === "boolean");
  const valid = validityChecks.length > 0 ? validityChecks.every(Boolean) : undefined;
  const disposable = result?.disposable ?? result?.is_disposable;
  if (valid === false || disposable === true || result?.success === false) {
    throw new ApiError(400, "Please use a genuine, deliverable email address.");
  }
}

function isLocalOrPrivateIp(ip = "") {
  const value = normalizeIp(ip);
  return (
    !value ||
    value === "unknown" ||
    value === "::1" ||
    value === "127.0.0.1" ||
    /^(fc|fd|fe80:)/i.test(value) ||
    value.startsWith("10.") ||
    value.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(value)
  );
}

function getCountryFromHeaders(headers = {}) {
  const country =
    headers["cf-ipcountry"] ||
    headers["x-vercel-ip-country"] ||
    headers["x-country-code"] ||
    headers["cloudfront-viewer-country"];
  return String(country || "").trim().toUpperCase();
}

function resolveGeoDecision(result = {}) {
  const country = String(
    result?.country_code ||
      result?.countryCode ||
      result?.country ||
      result?.country_code2 ||
      "",
  ).toUpperCase();
  const isPhilippines = country === "PH" || country === "PHILIPPINES";
  const security = result?.security || result;
  const isVpn = [security?.vpn, security?.proxy, security?.tor, result?.is_vpn]
    .some((value) => value === true || value === 1 || value === "true");

  return { country, isPhilippines, isVpn };
}

function shouldFailOpenGeo(ip) {
  return !env.security.failClosed || isLocalOrPrivateIp(ip);
}

const geoLookups = new Map();

async function lookupGeo(ip) {
  const key = `${env.security.geoLookupUrl}:${ip}`;
  const cached = geoLookups.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  if (geoLookups.size >= 1000) geoLookups.delete(geoLookups.keys().next().value);
  const promise = callProvider(
    env.security.geoLookupUrl || "https://ipwho.is/{ip}",
    { ip },
    env.security.geoLookupApiKey,
  );
  geoLookups.set(key, { promise, expiresAt: Date.now() + 30000 });
  return promise;
}

async function assertPhilippineConnection(ip, { enforceConfirmed = false } = {}) {
  if (isLocalOrPrivateIp(ip)) {
    return;
  }

  let result;
  try {
    result = await lookupGeo(ip);
  } catch (error) {
    console.warn("[registration-security] Geo/VPN provider failed.", error);
    if (shouldFailOpenGeo(ip)) {
      return;
    }
    throw new ApiError(503, "Location security verification is temporarily unavailable.");
  }

  if (!result || result.success === false) {
    if (shouldFailOpenGeo(ip)) return;
    throw new ApiError(503, "Location security verification is temporarily unavailable.");
  }

  const { country, isPhilippines, isVpn } = resolveGeoDecision(result);
  if ((country && !isPhilippines) || isVpn) {
    if (!enforceConfirmed && shouldFailOpenGeo(ip)) {
      console.warn("[registration-security] Geo/VPN check did not pass; allowing because fail-closed is disabled.", {
        ip,
      });
      return;
    }
    throw new ApiError(403, "Access is available only from a non-VPN connection in the Philippines.");
  }
  if (!country && env.security.failClosed) {
    throw new ApiError(503, "Location security verification is temporarily unavailable.");
  }
}

async function assertIpAccountLimit(ip) {
  if (!db || isLocalOrPrivateIp(ip) || !env.security.failClosed) {
    return;
  }

  const snapshot = await db.collection("users").where("registrationIp", "==", ip).limit(env.security.maxAccountsPerIp).get();
  if (snapshot.size >= env.security.maxAccountsPerIp) {
    throw new ApiError(429, "The maximum number of accounts for this network has been reached.");
  }
}

async function validateRegistrationSecurity(req, email) {
  const ip = getClientIp(req);
  const headerCountry = getCountryFromHeaders(req.headers);
  await assertEmailIsDeliverable(email);
  if (headerCountry && (headerCountry === "PH" || headerCountry === "PHILIPPINES")) {
    await assertIpAccountLimit(ip);
    return { registrationIp: ip };
  }
  await assertPhilippineConnection(ip);
  await assertIpAccountLimit(ip);
  return { registrationIp: ip };
}

async function validateAccessSecurity(req) {
  const ip = getClientIp(req);
  await assertPhilippineConnection(ip, { enforceConfirmed: true });
  return { accessIp: ip };
}

module.exports = { getClientIp, validateAccessSecurity, validateRegistrationSecurity };
