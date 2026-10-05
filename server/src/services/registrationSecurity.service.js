const { env } = require("../config/env");
const { ApiError } = require("../utils/ApiError");
const { Resolver } = require("node:dns/promises");
const { assertValidEmail, ILLEGITIMATE_EMAIL_ERROR } = require("../utils/emailValidation");
const DISPOSABLE_EMAIL_ERROR = "Temporary or disposable email addresses are not allowed";

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

// Curated from https://github.com/disposable-email-domains/disposable-email-domains.
const disposableEmailDomains = new Set([
  "10-minute-mail.com",
  "10minemail.com",
  "10minute.email",
  "10minutemail.com",
  "10minutemail.net",
  "1secmail.com",
  "1secmail.net",
  "1secmail.org",
  "20minutemail.com",
  "getnada.com",
  "grr.la",
  "guerillamail.com",
  "guerillamail.net",
  "guerrillamail.biz",
  "guerrillamail.com",
  "guerrillamail.de",
  "guerrillamail.info",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "hudzer.com",
  "maildrop.cc",
  "mailinator.co.uk",
  "mailinator.com",
  "mailinator.net",
  "mailinator.org",
  "tempmail.com",
  "temp-mail.org",
  "throwawaymail.com",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
  "yzcalo.com",
]);

function getEmailDomain(email = "") {
  return String(email || "").trim().toLowerCase().split("@").pop() || "";
}

function isDisposableEmailDomain(domain) {
  const labels = domain.split(".");
  for (let index = 0; index < labels.length - 1; index++) {
    if (disposableEmailDomains.has(labels.slice(index).join("."))) return true;
  }
  return false;
}

function assertRegistrationEmailAllowed(email) {
  assertValidEmail(email);
  const domain = getEmailDomain(email);

  if (isDisposableEmailDomain(domain)) {
    throw new ApiError(400, DISPOSABLE_EMAIL_ERROR, { code: "DISPOSABLE_EMAIL_DOMAIN" });
  }
}

async function assertEmailIsDeliverable(email) {
  assertRegistrationEmailAllowed(email);
  const domain = getEmailDomain(email);

  if (trustedEmailDomains.has(domain) && !env.security.emailValidationUrl) {
    return;
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
  if (disposable === true && !trustedEmailDomains.has(domain)) {
    throw new ApiError(400, DISPOSABLE_EMAIL_ERROR, { code: "DISPOSABLE_EMAIL_DOMAIN" });
  }
  if (valid === false || result?.success === false) {
    throw new ApiError(400, ILLEGITIMATE_EMAIL_ERROR);
  }
}

async function validateRegistrationSecurity(req, email) {
  assertRegistrationEmailAllowed(email);
  // Retain IP as registration metadata only, never as an access restriction.
  return { registrationIp: getClientIp(req) };
}

module.exports = { getClientIp, assertRegistrationEmailAllowed, assertEmailIsDeliverable, validateRegistrationSecurity };
