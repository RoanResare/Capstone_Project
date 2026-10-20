const { env } = require("./env");

let smtpTransport;

function getSmtpTransport() {
  if (!smtpTransport) {
    smtpTransport = require("nodemailer").createTransport({
      host: env.mail.smtp.host,
      port: env.mail.smtp.port,
      secure: env.mail.smtp.secure,
      auth: { user: env.mail.smtp.user, pass: env.mail.smtp.pass },
      // Use the OS resolver (including Windows/VPN DNS) rather than direct DNS queries.
      getSocket(options, callback) {
        const socket = require("node:net").connect({ host: options.host, port: options.port });
        const onError = (error) => {
          socket.destroy();
          callback(error);
        };
        socket.once("error", onError);
        socket.setTimeout(15000, () => {
          const error = new Error("SMTP connection timed out.");
          error.code = "ETIMEDOUT";
          socket.destroy(error);
        });
        socket.once("connect", () => {
          socket.setTimeout(0);
          socket.removeListener("error", onError);
          callback(null, { connection: socket });
        });
      },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    });
  }
  return smtpTransport;
}

function getMailTransportSettings() {
  return { provider: env.runtime.mailDeliveryMode, user: env.mail.smtp.user, fromEmail: env.mail.fromEmail, transport: "smtp" };
}

function assertSmtpReady() {
  if (env.runtime.mailDeliveryMode !== "smtp" || !env.runtime.mailDeliveryReady) {
    throw new Error("SMTP email delivery is not configured. Set EMAIL_USER and EMAIL_PASS, then restart the backend.");
  }
}

async function sendMail({ fromName, fromEmail, to, subject, html, text, messageId }) {
  assertSmtpReady();
  const result = await getSmtpTransport().sendMail({
    from: { name: fromName, address: fromEmail || env.mail.fromEmail },
    to, subject, html, text, messageId,
  });
  if (!result.accepted?.length) throw new Error("SMTP server did not accept the recipient.");
  return { ...result, id: result.messageId };
}

async function verifyMailerConnection() {
  assertSmtpReady();
  return getSmtpTransport().verify();
}

module.exports = { getMailTransportSettings, sendMail, verifyMailerConnection };
