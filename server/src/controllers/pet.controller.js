const { db } = require("../config/firebaseAdmin");
const { ApiError } = require("../utils/ApiError");

const RESERVED_STATUSES = ["Pending", "Approved", "Accepted", "Confirmed"];

async function savePet(req, res) {
  const { assertAppropriatePetText } = await import("../../../shared/petTextValidation.mjs");
  const id = req.params.id;
  const user = req.auth.user;
  const input = req.body;
  if (!id || id.includes("/") || [".", ".."].includes(id) || !input || input.id !== id) throw new ApiError(400, "A valid pet profile is required.");
  if (!["customer", "admin", "staff"].includes(user.role)) throw new ApiError(403, "You cannot save pet profiles.");
  try { assertAppropriatePetText(input); }
  catch (error) { throw new ApiError(400, error.message, { code: "INVALID_PET_TEXT", fields: error.fields }); }
  if (!["Male", "Female"].includes(input.gender)) throw new ApiError(400, "Pet gender must be Male or Female.");
  if (![input.petType, input.breed].every(value => typeof value === "string" && value.trim() && value.length <= 100)) throw new ApiError(400, "Pet type and breed are required (maximum 100 characters each).");
  const ref = db.collection("pets").doc(id);
  await db.runTransaction(async transaction => {
    const existing = await transaction.get(ref);
    const deleted = await transaction.get(db.collection("deletedPets").doc(id));
    if (deleted.exists) throw new ApiError(409, "This pet profile was deleted. Create a new profile.");
    const previous = existing.exists ? existing.data() : {};
    const ownsPet = previous.customerId === user.uid || (!previous.customerId && previous.customerEmail && previous.customerEmail.toLowerCase() === user.email?.toLowerCase());
    if (user.role === "customer" && existing.exists && !ownsPet) throw new ApiError(403, "You can only update your own pet profiles.");
    const data = { id, petName: input.petName.trim(), petType: input.petType.trim(), breed: input.breed.trim(), gender: input.gender,
      notes: input.notes ?? "", ageUnit: input.ageUnit === "years" ? "years" : "months", updatedAt: new Date().toISOString(),
      createdAt: previous.createdAt || new Date().toISOString() };
    for (const field of ["ageValue", "weightKg"]) data[field] = typeof input[field] === "string" ? input[field].slice(0, 20) : "";
    if (user.role === "customer") {
      Object.assign(data, { customerId: user.uid, customerEmail: user.email || "", ownerName: user.fullName || user.name || "" });
      if (!existing.exists) Object.assign(data, { lastVisit: "", visitRecords: [], medicalRecords: [] });
    } else {
      for (const field of ["customerId", "customerEmail", "ownerName", "lastVisit"]) {
        if (typeof input[field] === "string") data[field] = input[field];
      }
      for (const field of ["visitRecords", "medicalRecords"]) {
        if (Array.isArray(input[field])) data[field] = input[field];
      }
    }
    transaction.set(ref, data, { merge: true });
  });
  res.json({ success: true });
}

async function deletePet(req, res) {
  const id = req.params.id;
  const user = req.auth.user;
  if (!id || id.includes("/")) throw new ApiError(400, "A valid pet profile is required.");
  if (!["customer", "admin", "staff"].includes(user.role)) throw new ApiError(403, "You cannot delete pet profiles.");
  const petRef = db.collection("pets").doc(id);
  let deletedAppointmentIds = [];
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(petRef);
    if (!snapshot.exists) throw new ApiError(404, "This pet profile no longer exists.");
    const pet = snapshot.data();
    const ownsPet = pet.customerId === user.uid || (!pet.customerId && pet.customerEmail?.toLowerCase() === user.email?.toLowerCase());
    if (user.role === "customer" && !ownsPet) throw new ApiError(403, "You can only delete your own pet profiles.");
    const appointments = await transaction.get(db.collection("appointments").where("petRecordId", "==", id));
    deletedAppointmentIds = appointments.docs.filter((entry) => RESERVED_STATUSES.includes(entry.data().status)).map((entry) => entry.id);
    for (const appointmentId of deletedAppointmentIds) transaction.delete(db.collection("appointments").doc(appointmentId));
    transaction.set(db.collection("deletedPets").doc(id), { deletedAt: new Date().toISOString() });
    transaction.delete(petRef);
  });
  res.json({ success: true, deletedAppointmentIds });
}

module.exports = { deletePet, savePet };
