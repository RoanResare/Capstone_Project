const { env } = require("./env");

let accessToken = null;
let accessTokenExpiresAt = 0;
let verificationPromise = null;

function assertFetchAvailable() {
  if (typeof fetch !== "function") {
    throw new Error("Gmail API delivery requires Node.js 18+ with global fetch support.");
  }
}

function base64UrlEncode(value) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64EncodeBody(value) {
  return Buffer.from(value || "", "utf8")
    .toString("base64")
    .replace(/.{1,76}/g, "$&\r\n")
    .trim();
}

function sanitizeHeader(value = "") {
  return String(value).replace(/[\r\n]/g, " ").trim();
}

function encodeHeader(value = "") {
  const sanitized = sanitizeHeader(value);

  if (/^[\x00-\x7F]*$/.test(sanitized)) {
    return sanitized;
  }

  return `=?UTF-8?B?${Buffer.from(sanitized, "utf8").toString("base64")}?=`;
}

function formatAddress(name, email) {
  const sanitizedEmail = sanitizeHeader(email);
  const sanitizedName = sanitizeHeader(name);

  if (!sanitizedName) {
    return sanitizedEmail;
  }

  return `"${sanitizedName.replace(/"/g, '\\"')}" <${sanitizedEmail}>`;
}

function getMailTransportSettings() {
  return {
    provider: env.mail.provider,
    user: env.mail.user,
    fromEmail: env.mail.fromEmail,
    endpoint: "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    transport: "https",
  };
}

async function getAccessToken() {
  assertFetchAvailable();

  if (accessToken && Date.now() < accessTokenExpiresAt - 60000) {
    return accessToken;
  }

  const body = new URLSearchParams({
    client_id: env.mail.oauth.clientId,
    client_secret: env.mail.oauth.clientSecret,
    refresh_token: env.mail.oauth.refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.access_token) {
    const detail = data.error_description || data.error || response.statusText;
    throw new Error(`Gmail OAuth token refresh failed: ${detail}`);
  }

  accessToken = data.access_token;
  accessTokenExpiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;

  return accessToken;
}

function buildRawMessage({ from, to, subject, html, text }) {
  const boundary = `charming-furfection-${Date.now().toString(36)}`;
  const message = [
    `From: ${from}`,
    `To: ${sanitizeHeader(to)}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64EncodeBody(text),
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64EncodeBody(html),
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");

  return base64UrlEncode(message);
}

async function sendMail({ fromName, fromEmail, to, subject, html, text }) {
  if (!env.runtime.gmailApiReady) {
    throw new Error("Gmail API delivery is not configured.");
  }

  assertFetchAvailable();

  const token = await getAccessToken();
  const from = formatAddress(fromName, fromEmail || env.mail.fromEmail);
  const raw = buildRawMessage({ from, to, subject, html, text });
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = data.error?.message || response.statusText;
    throw new Error(`Gmail API send failed: ${detail}`);
  }

  return data;
}

async function verifyMailerConnection(options = {}) {
  if (!env.runtime.gmailApiReady) {
    return false;
  }

  if (options.force) {
    verificationPromise = null;
    accessToken = null;
    accessTokenExpiresAt = 0;
  }

  if (!verificationPromise) {
    verificationPromise = getAccessToken()
      .then(() => true)
      .catch((error) => {
        verificationPromise = null;
        throw error;
      });
  }

  return verificationPromise;
}

module.exports = {
  getMailTransportSettings,
  sendMail,
  verifyMailerConnection,
};
