const { db } = require("../config/firebaseAdmin");
const { ApiError } = require("../utils/ApiError");

async function saveAppointment(req, res) {
  const appointment = req.body;
  const id = req.params.id;
  const user = req.auth.user;
  if (!appointment || appointment.id !== id || !id || id.includes("/")) {
    throw new ApiError(400, "A valid appointment is required.");
  }
  const reference = db.collection("appointments").doc(id);
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(reference);
    if (user.role === "customer") {
      if (appointment.customerId !== user.uid ||
          (existing.exists && existing.data().customerId !== user.uid)) {
        throw new ApiError(403, "You can only update your own appointments.");
      }
      if (!existing.exists && ["restricted", "suspended", "banned"].includes(user.fraudStatus)) {
        throw new ApiError(403, "This account is restricted from creating new bookings.");
      }
      if (!existing.exists && appointment.status !== "Pending") {
        throw new ApiError(400, "New appointments must be pending.");
      }
    } else if (!["admin", "staff"].includes(user.role)) {
      throw new ApiError(403, "You cannot save appointments.");
    }
    if (!existing.exists && appointment.slotId) {
      const slots = await transaction.get(
        db.collection("appointments").where("slotId", "==", appointment.slotId),
      );
      const activeCount = slots.docs.filter((entry) =>
        ["Pending", "Confirmed", "Accepted"].includes(entry.data().status),
      ).length;
      if (activeCount >= Math.max(Number(appointment.slotCapacity) || 1, 1)) {
        throw new ApiError(409, "That time slot is already full. Please choose another slot.", { code: "SLOT_FULL" });
      }
    }
    transaction.set(reference, appointment, { merge: true });
  });
  res.json({ success: true });
}

module.exports = { saveAppointment };
