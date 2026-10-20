const { deliverMail } = require("./mail.service");
const { SLOT_LABELS } = require("./appointmentReminder.service");

async function sendAppointmentReminder(appointment, deliveryId) {
  return deliverMail({
    type: "appointment-reminder",
    to: appointment.customerEmail,
    messageId: `<reminder-${Buffer.from(deliveryId).toString("hex")}@charming-furfection.local>`,
    subject: "Reminder: your appointment is in 1 hour",
    text: `Hi ${appointment.customerName || "there"},\n\nYour appointment for ${appointment.petName || "your pet"} at Charming Fur-fection Pet Care is scheduled for ${appointment.scheduleDate} at ${SLOT_LABELS[appointment.scheduleTime]} (Asia/Manila).\n\nPlease prepare to head to the store for your appointment.\n\nSee you soon!`,
  });
}

module.exports = { sendAppointmentReminder };
