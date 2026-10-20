const {
  getMailTransportSettings,
  sendMail,
} = require("../config/mailer");
const { env } = require("../config/env");
const { ApiError } = require("../utils/ApiError");

function buildOtpHtml({ fullName, otpCode, role, expiresInMinutes }) {
  const greeting = fullName ? `Hi ${fullName},` : "Hello,";

  return `
    <div style="background:#f4f0e8;padding:32px;font-family:Arial,sans-serif;color:#1f353b;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:24px;padding:32px;box-shadow:0 18px 36px rgba(66,74,76,0.12);">
        <p style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#6c8c92;margin:0 0 16px;">
          Two-Factor Authentication
        </p>
        <h1 style="font-size:28px;line-height:1.2;margin:0 0 16px;">
          Charming Fur-fection Pet Care
        </h1>
        <p style="font-size:16px;line-height:1.7;margin:0 0 16px;">${greeting}</p>
        <p style="font-size:16px;line-height:1.7;margin:0 0 20px;">
          We received a login request for your ${role} account. Use the one-time password below to finish signing in.
        </p>
        <div style="margin:24px 0;padding:20px;border-radius:18px;background:#173e44;color:#ffffff;text-align:center;">
          <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.72;margin-bottom:12px;">
            Your verification code
          </div>
          <div style="font-size:34px;font-weight:700;letter-spacing:0.32em;">
            ${otpCode}
          </div>
        </div>
        <p style="font-size:14px;line-height:1.7;color:#5d7075;margin:0 0 12px;">
          This code expires in ${expiresInMinutes} minutes and can only be used once.
        </p>
        <p style="font-size:14px;line-height:1.7;color:#5d7075;margin:0;">
          If you did not attempt to sign in, please contact your system administrator immediately.
        </p>
      </div>
    </div>
  `;
}

function buildPasswordResetHtml({ fullName, resetLink }) {
  const greeting = fullName ? `Hi ${fullName},` : "Hello,";

  return `
    <div style="background:#f4f0e8;padding:32px;font-family:Arial,sans-serif;color:#1f353b;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:24px;padding:32px;box-shadow:0 18px 36px rgba(66,74,76,0.12);">
        <p style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#6c8c92;margin:0 0 16px;">
          Password Reset
        </p>
        <h1 style="font-size:28px;line-height:1.2;margin:0 0 16px;">
          Charming Fur-fection Pet Care
        </h1>
        <p style="font-size:16px;line-height:1.7;margin:0 0 16px;">${greeting}</p>
        <p style="font-size:16px;line-height:1.7;margin:0 0 20px;">
          We received a request to reset your password. Use the secure link below to set a new password.
        </p>
        <div style="margin:24px 0;">
          <a href="${resetLink}" style="display:inline-block;background:#173e44;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:14px;font-weight:700;">
            Reset password
          </a>
        </div>
        <p style="font-size:14px;line-height:1.7;color:#5d7075;margin:0 0 12px;">
          This secure reset link expires automatically and can only be used once.
        </p>
        <p style="font-size:14px;line-height:1.7;color:#5d7075;margin:0 0 12px;">
          If the button does not open, copy and paste this URL into your browser:
        </p>
        <p style="font-size:13px;line-height:1.7;color:#173e44;word-break:break-all;margin:0;">
          ${resetLink}
        </p>
      </div>
    </div>
  `;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function buildEmailVerificationHtml({ fullName, verificationLink }) {
  const greeting = fullName ? `Hi ${escapeHtml(fullName)},` : "Hello,";
  return `
    <div style="background:#f4f0e8;padding:32px;font-family:Arial,sans-serif;color:#1f353b;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:24px;padding:32px;box-shadow:0 18px 36px rgba(66,74,76,0.12);">
        <p style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#6c8c92;margin:0 0 16px;">Email verification</p>
        <h1 style="font-size:28px;line-height:1.2;margin:0 0 16px;">Charming Fur-fection Pet Care</h1>
        <p style="font-size:16px;line-height:1.7;margin:0 0 16px;">${greeting}</p>
        <p style="font-size:16px;line-height:1.7;margin:0 0 20px;">Confirm your email address to activate your customer account.</p>
        <p style="margin:24px 0;"><a href="${escapeHtml(verificationLink)}" style="display:inline-block;background:#173e44;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:14px;font-weight:700;">Activate account</a></p>
        <p style="font-size:14px;line-height:1.7;color:#5d7075;margin:0 0 12px;">This secure link expires automatically and can only be used once.</p>
        <p style="font-size:13px;line-height:1.7;color:#173e44;word-break:break-all;margin:0;">${escapeHtml(verificationLink)}</p>
      </div>
    </div>`;
}

function maskEmail(value = "") {
  const [localPart = "", domain = ""] = String(value || "").trim().split("@");

  if (!localPart || !domain) {
    return value;
  }

  if (localPart.length <= 2) {
    return `${localPart[0] || "*"}*@${domain}`;
  }

  return `${localPart.slice(0, 2)}***@${domain}`;
}

function buildMailConfigurationError() {
  return new ApiError(
    503,
    "Email delivery is not configured. Set EMAIL_USER and EMAIL_PASS (an app password) for SMTP, then restart the backend.",
  );
}

function buildMailDeliveryError(error) {
  if (error?.code === "EAUTH") {
    return new ApiError(503, "The SMTP server rejected the credentials. Update EMAIL_USER and EMAIL_PASS with the sender account's app password, then restart the backend.");
  }
  if (["ETIMEDOUT", "ECONNECTION", "ESOCKET", "EDNS"].includes(error?.code)) {
    return new ApiError(503, "Unable to connect to the email server. Check SMTP host, port, TLS settings, and outbound network access.");
  }
  return new ApiError(503, "Unable to send email right now. Check the SMTP connection and app password, then try again.");
}

async function deliverMail({ type, to, subject, html, text, messageId }) {
  if (!env.runtime.mailDeliveryReady) {
    throw buildMailConfigurationError();
  }

  const senderEmail = env.mail.fromEmail;
  const transportSettings = getMailTransportSettings();

  console.info(`[mail:${type}] Attempting email delivery.`, {
    to: maskEmail(to),
    from: senderEmail,
    provider: transportSettings.provider,
    transport: transportSettings.transport,
  });

  try {
    const result = await sendMail({
      fromName: env.mail.fromName,
      fromEmail: senderEmail,
      to,
      subject,
      messageId,
      html,
      text,
    });

    console.info(`[mail:${type}] Email delivery accepted.`, {
      to: maskEmail(to),
      messageId: result.id,
      threadId: result.threadId,
    });

    return {
      deliveryMode: env.runtime.mailDeliveryMode,
      messageId: result.id,
    };
  } catch (error) {
    console.error(`[mail:${type}] Email delivery failed.`, {
      to: maskEmail(to),
      subject,
      error: error instanceof Error ? error.message : error,
    });

    if (error instanceof ApiError) {
      throw error;
    }

    throw buildMailDeliveryError(error);
  }
}

async function sendOtpEmail({ to, fullName, otpCode, role, expiresInMinutes }) {
  return deliverMail({
    type: "otp",
    to,
    subject: "Your Charming Fur-fection verification code",
    html: buildOtpHtml({ fullName, otpCode, role, expiresInMinutes }),
    text: `Your verification code is ${otpCode}. It expires in ${expiresInMinutes} minutes.`,
  });
}

async function sendPasswordResetEmail({ to, fullName, resetLink }) {
  return deliverMail({
    type: "password-reset",
    to,
    subject: "Reset your Charming Fur-fection password",
    html: buildPasswordResetHtml({ fullName, resetLink }),
    text: `Reset your password using this link: ${resetLink}`,
  });
}

async function sendEmailVerificationLink({ to, fullName, verificationLink }) {
  return deliverMail({
    type: "email-verification",
    to,
    subject: "Activate your Charming Fur-fection account",
    html: buildEmailVerificationHtml({ fullName, verificationLink }),
    text: `Activate your Charming Fur-fection account using this secure link: ${verificationLink}\nThis link expires automatically and can only be used once.`,
  });
}

module.exports = {
  deliverMail,
  sendEmailVerificationLink,
  sendOtpEmail,
  sendPasswordResetEmail,
};
