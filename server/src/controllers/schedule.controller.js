const { db } = require("../config/firebaseAdmin");
const { ApiError } = require("../utils/ApiError");

function requireScheduleManager(req) {
  if (!["admin", "staff"].includes(req.auth?.user?.role)) {
    throw new ApiError(403, "Only admin and staff can manage appointment slots.");
  }
}

function slotReference(id) {
  if (typeof id !== "string" || !id.trim() || id.includes("/") || [".", ".."].includes(id)) {
    throw new ApiError(400, "A valid slot ID is required.");
  }
  return db.collection("availabilitySlots").doc(id);
}

function normalizeTime(value = "") {
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (!match) return "";
  let hour = Number(match[1]);
  if (match[3]) hour = hour % 12 + (match[3].toUpperCase() === "PM" ? 12 : 0);
  if (hour > 23 || Number(match[2]) > 59) return "";
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

async function persistSlotChange(req, payload) {
  const reference = slotReference(req.params.id);
  return db.runTransaction(async (transaction) => {
    const previous = await transaction.get(reference);
    const slot = { ...previous.data(), ...payload };
    const cancelledAppointments = [];
    const notifications = [];
    if (!slot.isOpen) {
      const byId = await transaction.get(db.collection("appointments").where("slotId", "==", slot.id));
      const candidates = new Map(byId.docs.map((entry) => [entry.id, entry]));
      if (slot.date && slot.time) {
        const byDate = await transaction.get(db.collection("appointments").where("scheduleDate", "==", slot.date));
        byDate.docs.forEach((entry) => candidates.set(entry.id, entry));
      }
      for (const [id, entry] of candidates) {
        const appointment = entry.data();
        const matchesSchedule = slot.date && slot.time && appointment.scheduleDate === slot.date
          && normalizeTime(appointment.scheduleTime) === normalizeTime(slot.time);
        const matchesLegacyId = appointment.slotId === slot.id && (!appointment.scheduleDate || !appointment.scheduleTime || !slot.date || !slot.time);
        if ((!matchesSchedule && !matchesLegacyId) || !["Pending", "Confirmed", "Accepted"].includes(appointment.status)) continue;
        const cancellationReason = "The clinic administration closed this date and time slot, so your appointment was cancelled. Please choose another available slot.";
        const updated = { ...appointment, id, status: "Cancelled", cancellationReason,
          cancelledBy: req.auth.user.uid, cancelledAt: payload.updatedAt, updatedAt: payload.updatedAt };
        cancelledAppointments.push(updated);
        notifications.push({
          id: `slot-cancelled-${id}-${Date.parse(payload.updatedAt)}`,
          title: "Appointment cancelled by the clinic",
          message: `${appointment.petName || "Your pet"}'s ${appointment.service || "appointment"} on ${appointment.scheduleDate || slot.date || "the scheduled date"} at ${appointment.scheduleTime || slot.time || "the scheduled time"} was cancelled. ${cancellationReason}`,
          targetRoles: ["customer", "admin", "staff"], targetType: "appointment", targetId: id,
          targetUserId: appointment.customerId || "", relatedAppointmentId: id,
          email: appointment.customerEmail || "", petName: appointment.petName || "",
          serviceName: appointment.service || "", appointmentDate: appointment.scheduleDate || slot.date || "",
          appointmentTime: appointment.scheduleTime || slot.time || "", readBy: [], level: "info",
          actorName: payload.updatedBy, actorRole: req.auth.user.role,
          actionLabel: "Cancelled appointment due to slot closure", createdAt: payload.updatedAt,
        });
      }
    }
    // All reads precede writes; slot closure, cancellations and notifications commit together.
    transaction.set(reference, payload, { merge: true });
    cancelledAppointments.forEach((appointment) => {
      transaction.set(db.collection("appointments").doc(appointment.id), appointment, { merge: true });
    });
    notifications.forEach((notification) => {
      transaction.set(db.collection("notifications").doc(notification.id), notification);
    });
    return { slot, cancelledAppointments, notifications };
  });
}

async function listAvailabilitySlots(req, res) {
  if (!req.auth?.user) throw new ApiError(401, "Authentication is required.");
  const snapshot = await db.collection("availabilitySlots").get();
  res.json({ success: true, slots: snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id })) });
}

async function saveAvailabilitySlot(req, res) {
  requireScheduleManager(req);
  const slot = req.body;
  if (!slot || slot.id !== req.params.id || typeof slot.isOpen !== "boolean" ||
      !Number.isInteger(slot.capacity) || slot.capacity < 1) {
    throw new ApiError(400, "A slot must have a matching ID, open status, and positive capacity.");
  }
  const payload = {
    id: slot.id, capacity: slot.capacity, isOpen: slot.isOpen,
    disabled: !slot.isOpen, status: slot.isOpen ? "Open" : "Cancelled",
    updatedAt: new Date().toISOString(), updatedBy: req.auth.user.fullName || req.auth.user.name || req.auth.user.uid,
  };
  for (const field of ["date", "time"]) {
    if (slot[field] !== undefined) {
      const pattern = field === "date" ? /^\d{4}-\d{2}-\d{2}$/ : /^(?:[01]\d|2[0-3]):[0-5]\d$/;
      if (typeof slot[field] !== "string" || !pattern.test(slot[field])) {
        throw new ApiError(400, `A valid slot ${field} is required.`);
      }
      payload[field] = slot[field];
    }
  }
  const result = await persistSlotChange(req, payload);
  res.json({ success: true, ...result });
}

async function disableAvailabilitySlot(req, res) {
  requireScheduleManager(req);
  // A tombstone keeps forecast defaults from recreating a deleted slot.
  const result = await persistSlotChange(req, {
    id: req.params.id, isOpen: false, disabled: true, status: "Cancelled",
    updatedAt: new Date().toISOString(), updatedBy: req.auth.user.uid,
  });
  res.json({ success: true, ...result });
}

module.exports = { listAvailabilitySlots, saveAvailabilitySlot, disableAvailabilitySlot };
