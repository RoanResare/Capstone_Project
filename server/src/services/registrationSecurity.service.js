const { db } = require("../config/firebaseAdmin");
const { env } = require("../config/env");
const { ApiError } = require("../utils/ApiError");
const { isIP } = require("node:net");
const { Resolver } = require("node:dns/promises");
const { assertValidEmail, ILLEGITIMATE_EMAIL_ERROR } = require("../utils/emailValidation");

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
  const authenticatedTemplate = template.replaceAll("{api_key}", encodeURIComponent(apiKey || ""));
  const url = buildProviderUrl(authenticatedTemplate, params);
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
  assertValidEmail(email);
  const domain = getEmailDomain(email);

  if (trustedEmailDomains.has(domain) && !env.security.emailValidationUrl) {
    return;
  }

  if (disposableEmailDomains.has(domain)) {
    throw new ApiError(400, ILLEGITIMATE_EMAIL_ERROR);
  }

  if (!env.security.emailValidationUrl) {
    const resolver = new Resolver({ timeout: 1500, tries: 2 });
    try {
      const records = await resolver.resolveMx(domain);
      if (!records.some((record) => record.exchange && record.exchange !== ".")) {
        throw new ApiError(400, ILLEGITIMATE_EMAIL_ERROR);
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (["ENOTFOUND", "ENODATA", "ENONAME"].includes(error.code)) {
        throw new ApiError(400, ILLEGITIMATE_EMAIL_ERROR);
      }
      throw new ApiError(503, "Email validation is temporarily unavailable. Please try again later.");
    }
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
    throw new ApiError(400, ILLEGITIMATE_EMAIL_ERROR);
  }
}

function isLocalOrPrivateIp(ip = "") {
  const value = normalizeIp(ip);
  return (
    !value ||
    value === "unknown" ||
    value === "::1" ||
    value.startsWith("127.") ||
    value.startsWith("169.254.") ||
    /^(fc|fd|fe80:)/i.test(value) ||
    value.startsWith("10.") ||
    value.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(value)
  );
}

function hasExplicitVpnOrProxy(result = {}) {
  const security = result?.security || result?.risk || result;
  const parseFlag = (value) => {
    if ([true, 1, "true", "1"].includes(value)) return true;
    if ([false, 0, "false", "0"].includes(value)) return false;
    return undefined;
  };
  const vpn = parseFlag(security.vpn ?? security.isVpn ?? security.is_vpn ?? result.is_vpn);
  const proxy = parseFlag(security.proxy ?? security.isProxy ?? security.is_proxy ?? result.is_proxy);
  const tor = parseFlag(security.tor ?? security.isTor ?? security.is_tor ?? result.is_tor);
  // Geography, hosting, risk scores, and generic anonymity are not VPN evidence.
  return [vpn, proxy, tor].includes(true);
}

const geoLookups = new Map();

async function lookupGeo(ip, { fresh = false } = {}) {
  const key = `${env.security.geoLookupUrl}:${ip}`;
  const cached = geoLookups.get(key);
  if (!fresh && cached && cached.expiresAt > Date.now()) return cached.promise;
  if (geoLookups.size >= 1000) geoLookups.delete(geoLookups.keys().next().value);
  const promise = callProvider(
    env.security.geoLookupUrl || "https://api.ipquery.io/{ip}",
    { ip },
    env.security.geoLookupApiKey,
  );
  geoLookups.set(key, { promise, expiresAt: Date.now() + 5000 });
  return promise;
}

async function assertNoDetectedVpnOrProxy(ip, options) {
  if (isLocalOrPrivateIp(ip) || !isIP(ip)) return;

  let result;
  try {
    result = await lookupGeo(ip, options);
  } catch (error) {
    console.warn("[registration-security] Geo/VPN provider failed.", error);
    return;
  }

  if (!result || result.success === false || result.error) return;
  // Ignore responses for a different IP instead of attributing their flags to this client.
  if (result.ip && normalizeIp(result.ip) !== ip) return;

  if (hasExplicitVpnOrProxy(result)) {
    throw new ApiError(403, "Blocked VPN IP address. Disable your VPN or proxy and try again.");
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
  await assertEmailIsDeliverable(email);
  await assertNoDetectedVpnOrProxy(ip);
  await assertIpAccountLimit(ip);
  return { registrationIp: ip };
}

async function validateAccessSecurity(req, options) {
  const ip = getClientIp(req);
  await assertNoDetectedVpnOrProxy(ip, options);
  return { accessIp: ip };
}

module.exports = { getClientIp, assertEmailIsDeliverable, validateAccessSecurity, validateRegistrationSecurity };
