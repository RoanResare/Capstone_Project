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
  await slotReference(req.params.id).set(payload, { merge: true });
  res.json({ success: true, slot: payload });
}

async function disableAvailabilitySlot(req, res) {
  requireScheduleManager(req);
  // A tombstone keeps forecast defaults from recreating a deleted slot.
  await slotReference(req.params.id).set({
    id: req.params.id, isOpen: false, disabled: true, status: "Cancelled",
    updatedAt: new Date().toISOString(), updatedBy: req.auth.user.uid,
  }, { merge: true });
  res.json({ success: true });
}

module.exports = { listAvailabilitySlots, saveAvailabilitySlot, disableAvailabilitySlot };
