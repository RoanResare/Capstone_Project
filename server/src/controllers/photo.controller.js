const { prescreenPetImage } = require("../services/huggingFace.service");
const { validateImage } = require("../utils/pricelistImage");
const { db } = require("../config/postgresDatabase");
const { assertAppropriateText, PET_TEXT_FIELDS } = require("../../../shared/textModeration.mjs");
const { ApiError } = require("../utils/ApiError");

async function prescreenPetPhoto(req, res) {
  const imageDataUrl = typeof req.body?.imageDataUrl === "string" ? req.body.imageDataUrl : "";
  if (!imageDataUrl) {
    throw new ApiError(400, "A pet image is required.");
  }

  const result = await prescreenPetImage(imageDataUrl);
  if (!result.allowed) {
    throw new ApiError(422, result.reason, result);
  }

  return res.status(200).json({ success: true, ...result });
}

async function submitPetPhoto(req, res) {
  const user = req.auth.user;
  const input = req.body || {};
  const image = typeof input.photoURL === "string" ? input.photoURL : "";
  if (user.role !== "customer") throw new ApiError(403, "Only customers can submit pet photos for review.");
  if (!input.id || typeof input.id !== "string" || input.id.length > 120 || input.id.includes("/")) throw new ApiError(400, "A valid photo submission ID is required.");
  if (!input.assetId || typeof input.assetId !== "string" || input.assetId.length > 120 || input.assetId.includes("/")) throw new ApiError(400, "A valid pet profile is required.");
  if (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(image) || Buffer.byteLength(image, "utf8") > 1_450_000) throw new ApiError(400, "Choose a valid pet photo up to 1 MB.");
  validateImage(image);
  const petRef = db.collection("pets").doc(input.assetId);
  const pet = await petRef.get();
  if (!pet.exists || pet.data()?.customerId !== user.uid) throw new ApiError(403, "You can only submit photos for your own pet profiles.");
  try { assertAppropriateText({ petName: pet.data()?.petName || "Pet" }, PET_TEXT_FIELDS); }
  catch (error) { throw new ApiError(400, error.message, { code: "INVALID_TEXT", fields: error.fields }); }
  const photoRef = db.collection("photoModeration").doc(input.id);
  const existing = await photoRef.get();
  if (existing.exists && existing.data()?.ownerId !== user.uid) throw new ApiError(409, "This photo submission ID is already in use.");
  const record = {
    id: input.id, assetType: "pet", assetId: input.assetId, ownerId: user.uid,
    ownerEmail: user.email || "", ownerName: user.fullName || user.name || "Customer",
    subjectName: pet.data()?.petName || "Pet", photoURL: image,
    storagePath: "", status: "pending", moderationNote: "", createdAt: new Date().toISOString(),
    reviewedAt: "", reviewedBy: "",
  };
  await photoRef.set(record);
  return res.status(201).json({ success: true, photo: record });
}

async function listPhotoModeration(req, res) {
  const snapshot = await db.collection("photoModeration").orderBy("createdAt", "desc").limit(500).get();
  return res.set("Cache-Control", "no-store").json({ success: true, records: snapshot.docs.map(entry => ({ id: entry.id, ...entry.data() })) });
}

async function updatePhotoModeration(req, res) {
  const { id } = req.params;
  if (!id || id.includes("/")) throw new ApiError(400, "A valid photo submission ID is required.");
  const status = req.body?.status === "approved" ? "approved" : req.body?.status === "rejected" ? "rejected" : "";
  if (!status) throw new ApiError(400, "Choose approved or rejected.");
  const ref = db.collection("photoModeration").doc(id);
  let record;
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new ApiError(404, "Photo submission not found.");
    const current = snapshot.data();
    const now = new Date().toISOString();
    record = { ...current, status, moderationNote: typeof req.body?.moderationNote === "string" ? req.body.moderationNote.slice(0, 500) : "",
      reviewedAt: now, reviewedBy: req.auth.user.fullName || req.auth.user.name || "Administrator" };
    transaction.set(ref, record);
    if (status === "approved" && current.assetType === "pet") {
      const petRef = db.collection("pets").doc(current.assetId);
      const pet = await transaction.get(petRef);
      if (pet.exists && pet.data()?.customerId === current.ownerId) transaction.set(petRef, { photoURL: current.photoURL, photoModerationId: id, updatedAt: now }, { merge: true });
    }
    if (status === "rejected" && current.assetType === "pet") {
      const petRef = db.collection("pets").doc(current.assetId);
      const pet = await transaction.get(petRef);
      if (pet.exists && pet.data()?.customerId === current.ownerId) transaction.set(petRef, { photoURL: "", photoModerationId: id, updatedAt: now }, { merge: true });
    }
    const notificationId = `notification-photo-${id}-${status}`;
    transaction.set(db.collection("notifications").doc(notificationId), {
      id: notificationId, title: status === "approved" ? "Pet photo approved" : "Pet photo rejected",
      message: status === "approved" ? "Your pet photo was approved." : `Your pet photo was rejected${record.moderationNote ? `: ${record.moderationNote}` : "."}`,
      targetRoles: ["customer"], targetUserId: current.ownerId, email: current.ownerEmail || "",
      targetType: "photo-moderation", targetId: id, level: "info", readBy: [], createdAt: now,
    }, { merge: true });
  });
  return res.json({ success: true, photo: record });
}

module.exports = { listPhotoModeration, prescreenPetPhoto, submitPetPhoto, updatePhotoModeration };
