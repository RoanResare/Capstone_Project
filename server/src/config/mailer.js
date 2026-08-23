const nodemailer = require("nodemailer");
const { env } = require("./env");

let transporter = null;
let verificationPromise = null;

function buildTransportOptions() {
  return {
    service: env.mail.provider === "gmail" ? "gmail" : undefined,
    host: env.mail.host,
    port: env.mail.port,
    secure: env.mail.secure,
    auth: {
      user: env.mail.user,
      pass: env.mail.pass,
    },
  };
}

function getTransporter() {
  if (!env.runtime.smtpReady) {
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport(buildTransportOptions());
  }

  return transporter;
}

async function verifyMailerConnection(options = {}) {
  if (!env.runtime.smtpReady) {
    return false;
  }

  if (options.force) {
    verificationPromise = null;
  }

  if (!verificationPromise) {
    verificationPromise = getTransporter()
      .verify()
      .then(() => true)
      .catch((error) => {
        verificationPromise = null;
        throw error;
      });
  }

  return verificationPromise;
}

module.exports = {
  getTransporter,
  verifyMailerConnection,
};
