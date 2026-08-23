const { getTransporter, verifyMailerConnection } = require("../config/mailer");
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
    "Real email delivery is not configured. Set EMAIL_USER and EMAIL_PASS in server/.env, then restart the backend.",
  );
}

function buildMailDeliveryError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  const normalizedMessage = message.toLowerCase();

  if (
    normalizedMessage.includes("invalid login") ||
    normalizedMessage.includes("username and password not accepted") ||
    normalizedMessage.includes("bad credentials")
  ) {
    return new ApiError(
      503,
      "Gmail rejected the SMTP login. Verify EMAIL_USER and regenerate EMAIL_PASS as a Gmail App Password.",
      { message },
    );
  }

  return new ApiError(
    503,
    "Unable to send email right now. Verify the Gmail SMTP configuration and try again.",
    { message },
  );
}

async function deliverMail({ type, to, subject, html, text }) {
  if (env.runtime.mailDeliveryMode !== "smtp") {
    throw buildMailConfigurationError();
  }

  const transporter = getTransporter();

  if (!transporter) {
    throw buildMailConfigurationError();
  }

  console.info(`[mail:${type}] Attempting SMTP delivery.`, {
    to: maskEmail(to),
    from: env.mail.fromEmail,
    host: env.mail.host,
    port: env.mail.port,
  });

  try {
    await verifyMailerConnection();
    const result = await transporter.sendMail({
      from: `"${env.mail.fromName}" <${env.mail.fromEmail}>`,
      to,
      subject,
      html,
      text,
    });

    console.info(`[mail:${type}] SMTP delivery accepted.`, {
      to: maskEmail(to),
      accepted: result.accepted,
      rejected: result.rejected,
      response: result.response,
      messageId: result.messageId,
    });

    if (Array.isArray(result.rejected) && result.rejected.length > 0) {
      throw new ApiError(502, "The email provider rejected the message.", {
        rejected: result.rejected,
      });
    }

    return {
      deliveryMode: "smtp",
      messageId: result.messageId,
    };
  } catch (error) {
    console.error(`[mail:${type}] SMTP delivery failed.`, {
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

module.exports = {
  sendOtpEmail,
  sendPasswordResetEmail,
};
