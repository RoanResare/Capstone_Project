import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  setDoc,
} from "firebase/firestore";
import { auth, db, isFirebaseConfigured } from "../../firebase.js";
import { verifyActiveSessionSecurity } from "./sessionSecurity.js";
import { apiClient, buildAuthHeaders, extractApiError } from "./apiClient.js";

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

  await verifyActiveSessionSecurity();
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

  await verifyActiveSessionSecurity();
  await deleteDoc(doc(db, collectionName, normalizedId));
  return true;
}

export async function loadScheduleDocuments(collectionName) {
  if (!canSyncScheduleData()) {
    return [];
  }

  try {
    const snapshot = await getDocs(collection(db, collectionName));
    return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
  } catch (error) {
    logSyncError(`${collectionName} load`, error);
    return [];
  }
}

function logSyncError(action, error) {
  console.error(`[schedule-data] ${action} failed.`, error);
}

export function saveAppointmentDocument(appointment) {
  const save = async () => {
    if (!canSyncScheduleData()) {
      throw new Error("You must be signed in to save an appointment.");
    }

    const id = normalizeString(appointment?.id);
    if (!id) throw new Error("An appointment ID is required.");
    const token = await auth.currentUser.getIdToken();
    try {
      await apiClient.put(`/auth/appointments/${encodeURIComponent(id)}`, removeUndefinedFields(appointment), {
        headers: buildAuthHeaders(token),
      });
    } catch (error) {
      const requestError = new Error(extractApiError(error, "Unable to save the appointment."));
      requestError.code = error?.response?.data?.details?.code;
      throw requestError;
    }
    return true;
  };

  return save().catch((error) => {
    logSyncError("Appointment sync", error);
    throw error;
  });
}

export function savePetRecordDocument(record) {
  return saveDocument(COLLECTIONS.petRecords, record).catch((error) => {
    logSyncError("Pet record sync", error);
    throw error;
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
  return loadScheduleDocuments(COLLECTIONS.photoModeration);
}

export async function loadNotificationDocuments() {
  return loadScheduleDocuments(COLLECTIONS.notifications);
}

export function loadAppointmentDocuments() {
  return loadScheduleDocuments(COLLECTIONS.appointments);
}

export function loadPetRecordDocuments() {
  return loadScheduleDocuments(COLLECTIONS.petRecords);
}

export function loadAvailabilitySlotDocuments() {
  return loadScheduleDocuments(COLLECTIONS.availabilitySlots);
}

export function saveNotificationDocument(notification) {
  return saveDocument(COLLECTIONS.notifications, notification).catch((error) => {
    logSyncError("Notification sync", error);
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
