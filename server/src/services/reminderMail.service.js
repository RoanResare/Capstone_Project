const { deliverMail } = require("./mail.service");
const { formatScheduleTime } = require("./appointmentReminder.service");
const { env } = require("../config/env");
const { createHash } = require("node:crypto");

async function sendAppointmentReminder(appointment, deliveryId) {
  return deliverMail({
    type: "appointment-reminder",
    to: appointment.customerEmail,
    messageId: `<reminder-${createHash("sha256").update(deliveryId).digest("hex")}@${env.mail.fromEmail.split("@")[1]}>`,
    subject: "Reminder: your appointment is in 1 hour",
    text: `Hi ${appointment.customerName || "there"},\n\nYour appointment for ${appointment.petName || "your pet"} at Charming Fur-fection Pet Care is scheduled for ${appointment.scheduleDate} at ${formatScheduleTime(appointment.scheduleTime)} (Asia/Manila).\n\nPlease prepare to head to the store for your appointment.\n\nSee you soon!`,
  });
}

module.exports = { sendAppointmentReminder };
