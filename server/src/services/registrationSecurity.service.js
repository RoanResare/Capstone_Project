const { env } = require("../config/env");
const { ApiError } = require("../utils/ApiError");
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

async function validateRegistrationSecurity(req, email) {
  await assertEmailIsDeliverable(email);
  // Retain IP as registration metadata only, never as an access restriction.
  return { registrationIp: getClientIp(req) };
}

module.exports = { getClientIp, assertEmailIsDeliverable, validateRegistrationSecurity };
