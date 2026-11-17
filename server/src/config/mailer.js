const { env } = require("./env");

let resendClient;

function assertResendReady() {
  if (!env.runtime.mailDeliveryReady || env.runtime.mailDeliveryMode !== "resend") {
    throw new Error("Resend email delivery is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL, then restart the backend.");
  }
}

function getMailTransportSettings() {
  return { provider: env.runtime.mailDeliveryMode, fromEmail: env.mail.fromEmail, transport: "https" };
}

async function sendMail({ fromName, fromEmail, to, subject, html, text, messageId }) {
  assertResendReady();
  if (!resendClient) {
    const { Resend } = require("resend");
    resendClient = new Resend(env.mail.apiKey);
  }
  const senderName = String(fromName || env.mail.fromName || "").replace(/[\r\n"<>]/g, "");
  const address = fromEmail || env.mail.fromEmail;
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(address) || /@resend\.dev$/i.test(address)) {
    throw Object.assign(new Error("Set RESEND_FROM_EMAIL to an address on your verified custom domain; the Resend test sender is disabled."), {
      code: "invalid_from_address",
    });
  }
  const { data, error } = await resendClient.emails.send({
    from: senderName ? `${senderName} <${address}>` : address,
    to: Array.isArray(to) ? to : [to],
    subject, html, text,
    ...(env.mail.replyTo ? { replyTo: env.mail.replyTo } : {}),
    ...(messageId ? { headers: { "Message-ID": messageId } } : {}),
  }, {
    signal: AbortSignal.timeout(30000),
    // Reminder retries reuse their delivery ID; OTPs and reset links remain distinct.
    ...(messageId ? { idempotencyKey: messageId } : {}),
  });
  if (error) {
    throw Object.assign(new Error(error.message || "Resend rejected the email request."), {
      code: error.name || "resend_error", providerStatus: error.statusCode,
    });
  }
  if (!data?.id) throw Object.assign(new Error("Resend did not return an email delivery ID."), { code: "invalid_resend_response" });
  return { id: data.id, messageId: data.id };
}

module.exports = { getMailTransportSettings, sendMail };
