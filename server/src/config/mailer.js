const { env } = require("./env");

let smtpTransport;

function getSmtpTransport() {
  if (!smtpTransport) {
    smtpTransport = require("nodemailer").createTransport({
      host: env.mail.smtp.host,
      port: env.mail.smtp.port,
      secure: env.mail.smtp.secure,
      auth: { user: env.mail.smtp.user, pass: env.mail.smtp.pass },
      tls: { servername: env.mail.smtp.host, minVersion: "TLSv1.2", rejectUnauthorized: true },
      // Use the OS resolver (including Windows/VPN DNS) rather than direct DNS queries.
      getSocket(options, callback) {
        const connectionOptions = {
          host: options.host,
          port: options.port,
          autoSelectFamily: true,
          ...(options.secure ? options.tls : {}),
        };
        // Port 465 must complete TLS before waiting for the SMTP greeting.
        const socket = options.secure
          ? require("node:tls").connect(connectionOptions)
          : require("node:net").connect(connectionOptions);
        const onError = (error) => {
          socket.removeListener("timeout", onTimeout);
          socket.destroy();
          callback(error);
        };
        const onTimeout = () => {
          const error = new Error("SMTP connection timed out.");
          error.code = "ETIMEDOUT";
          socket.destroy(error);
        };
        socket.once("error", onError);
        socket.setTimeout(30000, onTimeout);
        socket.once(options.secure ? "secureConnect" : "connect", () => {
          socket.setTimeout(0);
          socket.removeListener("timeout", onTimeout);
          socket.removeListener("error", onError);
          callback(null, { connection: socket, secured: options.secure === true });
        });
      },
      connectionTimeout: 30000,
      greetingTimeout: 30000,
      socketTimeout: 60000,
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
