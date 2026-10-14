const { db } = require("../config/firebaseAdmin");
const { ApiError } = require("../utils/ApiError");

const RESERVED_STATUSES = ["Pending", "Approved", "Accepted", "Confirmed"];

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

module.exports = { deletePet };
