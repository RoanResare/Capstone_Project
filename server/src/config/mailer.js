const nodemailer = require("nodemailer");
const { env } = require("./env");

let transporter = null;
let verificationPromise = null;

function buildTransportOptions() {
  const isGmail = env.mail.provider === "gmail";

  return {
    service: isGmail ? "gmail" : undefined,
    host: env.mail.host,
    port: isGmail ? 465 : env.mail.port,
    secure: isGmail ? true : env.mail.secure,
    family: 4,
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

function getMailTransportSettings() {
  const options = buildTransportOptions();

  return {
    provider: env.mail.provider,
    service: options.service,
    host: options.host,
    port: options.port,
    secure: options.secure,
    family: options.family,
  };
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
  getMailTransportSettings,
  getTransporter,
  verifyMailerConnection,
};
