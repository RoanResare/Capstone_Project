const nodemailer = require("nodemailer");
const { env } = require("../config/env");
const { SLOT_LABELS } = require("./appointmentReminder.service");

let transport;
async function sendAppointmentReminder(appointment, deliveryId) {
  const appPassword = process.env.GMAIL_APP_PASSWORD?.trim();
  transport ||= nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
    auth: appPassword ? { user: env.mail.user, pass: appPassword } : {
      type: "OAuth2", user: env.mail.user,
      clientId: env.mail.oauth.clientId, clientSecret: env.mail.oauth.clientSecret,
      refreshToken: env.mail.oauth.refreshToken,
    },
  });
  return transport.sendMail({
    from: { name: env.mail.fromName, address: env.mail.user },
    to: appointment.customerEmail,
    messageId: `<reminder-${Buffer.from(deliveryId).toString("hex")}@charming-furfection.local>`,
    subject: "Reminder: your appointment is in 1 hour",
    text: `Hi ${appointment.customerName || "there"},\n\nYour appointment for ${appointment.petName || "your pet"} at Charming Fur-fection Pet Care is scheduled for ${appointment.scheduleDate} at ${SLOT_LABELS[appointment.scheduleTime]} (Asia/Manila).\n\nPlease prepare to head to the store for your appointment.\n\nSee you soon!`,
  });
}

module.exports = { sendAppointmentReminder };
