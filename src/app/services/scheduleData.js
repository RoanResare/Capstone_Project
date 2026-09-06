import { deleteDoc, doc, setDoc } from "firebase/firestore";
import { auth, db, isFirebaseConfigured } from "../../firebase.js";

const COLLECTIONS = {
  appointments: "appointments",
  petRecords: "pets",
  availabilitySlots: "availabilitySlots",
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
