import { collection, deleteDoc, doc, getDocs, setDoc } from "firebase/firestore";
import { auth, db, isFirebaseConfigured } from "../../firebase.js";

const COLLECTIONS = {
  appointments: "appointments",
  petRecords: "pets",
  availabilitySlots: "availabilitySlots",
  photoModeration: "photoModeration",
  notifications: "notifications",
};

function normalizeString(value = "") {
  return typeof value === "string" ? value.trim() : "";
}

function canSyncScheduleData() {
  return Boolean(isFirebaseConfigured && auth?.currentUser && db);
}

function removeUndefinedFields(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => removeUndefinedFields(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.entries(value).reduce((collection, [key, entry]) => {
    if (entry !== undefined) {
      collection[key] = removeUndefinedFields(entry);
    }

    return collection;
  }, {});
}

async function saveDocument(collectionName, payload = {}) {
  const id = normalizeString(payload.id);

  if (!id) {
    return false;
  }

  if (!canSyncScheduleData()) {
    return true;
  }

  await setDoc(doc(db, collectionName, id), removeUndefinedFields(payload), { merge: true });
  return true;
}

async function deleteDocument(collectionName, id = "") {
  const normalizedId = normalizeString(id);

  if (!normalizedId) {
    return false;
  }

  if (!canSyncScheduleData()) {
    return true;
  }

  await deleteDoc(doc(db, collectionName, normalizedId));
  return true;
}

function logSyncError(action, error) {
  console.error(`[schedule-data] ${action} failed.`, error);
}

export function saveAppointmentDocument(appointment) {
  return saveDocument(COLLECTIONS.appointments, appointment).catch((error) => {
    logSyncError("Appointment sync", error);
    return false;
  });
}

export function savePetRecordDocument(record) {
  return saveDocument(COLLECTIONS.petRecords, record).catch((error) => {
    logSyncError("Pet record sync", error);
    return false;
  });
}

export function deletePetRecordDocument(id) {
  return deleteDocument(COLLECTIONS.petRecords, id).catch((error) => {
    logSyncError("Pet record delete sync", error);
    return false;
  });
}

export function savePhotoModerationDocument(record) {
  return saveDocument(COLLECTIONS.photoModeration, record).catch((error) => {
    logSyncError("Photo moderation sync", error);
    return false;
  });
}

export async function loadPhotoModerationDocuments() {
  if (!canSyncScheduleData()) {
    return [];
  }

  try {
    const snapshot = await getDocs(collection(db, COLLECTIONS.photoModeration));
    return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
  } catch (error) {
    logSyncError("Photo moderation load", error);
    return [];
  }
}

export async function loadNotificationDocuments() {
  if (!canSyncScheduleData()) {
    return [];
  }

  try {
    const snapshot = await getDocs(collection(db, COLLECTIONS.notifications));
    return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
  } catch (error) {
    logSyncError("Notification load", error);
    return [];
  }
}

export function saveNotificationDocument(notification) {
  return saveDocument(COLLECTIONS.notifications, notification).catch((error) => {
    logSyncError("Notification sync", error);
    return false;
  });
}

export function saveApprovedCustomerPhotoDocument({ customerId, photoURL, photoModerationId }) {
  const normalizedCustomerId = normalizeString(customerId);

  if (!normalizedCustomerId) {
    return Promise.resolve(false);
  }

  if (!canSyncScheduleData()) {
    return Promise.resolve(true);
  }

  return setDoc(
    doc(db, "users", normalizedCustomerId),
    removeUndefinedFields({
      photoURL: normalizeString(photoURL),
      profilePhotoModerationId: normalizeString(photoModerationId),
      updatedAt: new Date().toISOString(),
    }),
    { merge: true },
  )
    .then(() => true)
    .catch((error) => {
      logSyncError("Approved customer photo sync", error);
      return false;
    });
}

export function saveAvailabilitySlotDocument(slot) {
  return saveDocument(COLLECTIONS.availabilitySlots, slot).catch((error) => {
    logSyncError("Availability slot sync", error);
    return false;
  });
}

export function deleteAvailabilitySlotDocument(id) {
  return deleteDocument(COLLECTIONS.availabilitySlots, id).catch((error) => {
    logSyncError("Availability slot delete sync", error);
    return false;
  });
}
