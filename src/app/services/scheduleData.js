import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
} from "firebase/firestore";
import { auth, db, isFirebaseConfigured } from "../../firebase.js";
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
  if (!["Male", "Female"].includes(record?.gender)) return Promise.reject(new Error("Pet gender must be Male or Female."));
  const petData = { ...record };
  delete petData.photoURL;
  delete petData.photoModerationId;
  return saveDocument(COLLECTIONS.petRecords, petData).catch((error) => {
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

function subscribeScheduleDocuments(collectionName, onChange, onError = () => {}) {
  if (!canSyncScheduleData()) return () => {};
  return onSnapshot(collection(db, collectionName),
    (snapshot) => onChange(snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id }))),
    (error) => { logSyncError(`${collectionName} subscription`, error); onError(error); });
}

export function subscribeAppointments(onChange, onError) {
  return subscribeScheduleDocuments(COLLECTIONS.appointments, onChange, onError);
}

export function subscribeNotifications(onChange, onError) {
  return subscribeScheduleDocuments(COLLECTIONS.notifications, onChange, onError);
}

export function loadAvailabilitySlotDocuments() {
  return requestAvailabilitySlots("get").then((data) => data.slots);
}

async function requestAvailabilitySlots(method, id = "", payload) {
  const user = auth?.currentUser;
  if (!isFirebaseConfigured || !user) throw new Error("You must be signed in to access appointment slots.");
  try {
    const token = await user.getIdToken();
    if (auth.currentUser !== user) throw new Error("Your account changed. Please try again.");
    const url = `/auth/availability-slots${id ? `/${encodeURIComponent(id)}` : ""}`;
    const options = { headers: buildAuthHeaders(token) };
    const response = method === "put"
      ? await apiClient.put(url, removeUndefinedFields(payload), options)
      : await apiClient[method](url, options);
    return response.data;
  } catch (error) {
    throw new Error(extractApiError(error, "Unable to access appointment slots."));
  }
}

function isPermissionDenied(error) {
  return ["permission-denied", "firestore/permission-denied"].includes(error?.code);
}

function schedulePermissionError(error) {
  if (!isPermissionDenied(error)) return error;
  const result = new Error("Schedule access was denied. Please sign in again. If the problem continues, the administrator must publish the updated Firestore rules.");
  result.code = error.code;
  return result;
}

export function subscribeAvailabilitySlots(onChange, onError = () => {}) {
  if (!canSyncScheduleData()) return () => {};
  const user = auth.currentUser;
  let disposed = false;
  let retried = false;
  let unsubscribe = () => {};
  let pollingTimer;
  const fail = (error) => {
    if (disposed) return;
    logSyncError("Availability subscription", error);
    onError(schedulePermissionError(error));
  };
  const poll = async () => {
    if (disposed || auth.currentUser !== user) return;
    try {
      const slots = await loadAvailabilitySlotDocuments();
      if (!disposed && auth.currentUser === user) onChange(slots);
    } catch (error) { fail(error); }
    if (!disposed && auth.currentUser === user) pollingTimer = setTimeout(poll, 5000);
  };
  const listen = () => {
    unsubscribe = onSnapshot(collection(db, COLLECTIONS.availabilitySlots),
      (snapshot) => {
        if (!disposed) onChange(snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id })));
      },
      async (error) => {
        if (disposed) return;
        if (!retried && isPermissionDenied(error)) {
          retried = true;
          unsubscribe();
          try {
            await user.getIdToken(true);
            if (!disposed && auth.currentUser === user) listen();
          } catch (refreshError) { fail(refreshError); }
          return;
        }
        if (isPermissionDenied(error)) {
          unsubscribe();
          await poll();
          return;
        }
        fail(error);
      });
  };
  listen();
  return () => { disposed = true; clearTimeout(pollingTimer); unsubscribe(); };
}

export function saveNotificationDocument(notification) {
  return saveDocument(COLLECTIONS.notifications, notification).catch((error) => {
    logSyncError("Notification sync", error);
    return false;
  });
}

export async function saveAvailabilitySlotDocument(slot) {
  const id = normalizeString(slot?.id);
  if (!id) throw new Error("A slot ID is required.");
  return requestAvailabilitySlots("put", id, slot);
}

export async function deleteAvailabilitySlotDocument(id) {
  const slotId = normalizeString(id);
  if (!slotId) throw new Error("A slot ID is required.");
  await requestAvailabilitySlots("delete", slotId);
  return true;
}
