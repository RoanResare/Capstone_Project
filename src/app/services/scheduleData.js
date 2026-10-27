import {
  collection,
  arrayUnion,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db, isFirebaseConfigured } from "../../firebase.js";
import { apiClient, buildAuthHeaders, extractApiError } from "./apiClient.js";
import { readJsonCache, removeJsonCache, writeJsonCache } from "../utils/browserState.js";
import { assertAppropriatePetText } from "../../../shared/petTextValidation.mjs";
import { waitForFirebaseUserSession } from "./firebaseSession.js";

const COLLECTIONS = {
  appointments: "appointments",
  petRecords: "pets",
  availabilitySlots: "availabilitySlots",
  photoModeration: "photoModeration",
  notifications: "notifications",
};
const AVAILABILITY_SLOT_PAGE_SIZE = 200;
const MAX_AVAILABILITY_SLOT_PAGES = 10;
const AVAILABILITY_SLOTS_CACHE_KEY = "furfection-cache:availability-slots";
const AVAILABILITY_SLOTS_CACHE_TTL_MS = 60 * 1000;
const SCHEDULE_CACHE_TTL_MS = 30 * 1000;
const SCHEDULE_PAGE_SIZE = 200;
const MAX_PORTAL_APPOINTMENT_PAGES = 10;
const collectionLoadRequests = new Map();
const collectionCache = new Map();
// Only share pending reads; completed API results are never reused.
const sharedRecordRequests = new Map();
let availabilitySlotsLoadRequest = null;

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

export async function loadScheduleDocuments(collectionName, options = {}) {
  if (!canSyncScheduleData()) {
    return [];
  }

  const cacheKey = `${auth.currentUser.uid}:${collectionName}`;
  const cached = collectionCache.get(cacheKey);
  if (!options.force && cached && Date.now() - cached.fetchedAt < SCHEDULE_CACHE_TTL_MS) return cached.documents;
  if (!options.force && collectionLoadRequests.has(cacheKey)) {
    return collectionLoadRequests.get(cacheKey);
  }
  if ([COLLECTIONS.appointments, COLLECTIONS.notifications].includes(collectionName)) {
    if (collectionName === COLLECTIONS.appointments) return loadAppointmentDocuments({ force: options.force });
    return loadRecentNotifications({ force: options.force });
  }

  const request = (async () => {
    try {
      const snapshot = await getDocs(query(collection(db, collectionName), orderBy("__name__"), limit(SCHEDULE_PAGE_SIZE)));
      const documents = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      collectionCache.set(cacheKey, { fetchedAt: Date.now(), documents });
      return documents;
    } catch (error) {
      logSyncError(`${collectionName} load`, error);
      return [];
    } finally {
      if (collectionLoadRequests.get(cacheKey) === request) {
        collectionLoadRequests.delete(cacheKey);
      }
    }
  })();

  collectionLoadRequests.set(cacheKey, request);
  return request;
}

export function forceLoadScheduleDocuments(collectionName) {
  return loadScheduleDocuments(collectionName, { force: true });
}

function logSyncError(action, error) {
  console.error(`[schedule-data] ${action} failed.`, error);
}

function loadSharedRecords(collectionName) {
  const user = auth?.currentUser;
  if (!user) return Promise.reject(new Error("Sign in to load your saved records."));
  const pending = sharedRecordRequests.get(collectionName);
  if (pending?.user === user) return pending.request;
  const request = fetchSharedRecords(collectionName, user).finally(() => {
    if (sharedRecordRequests.get(collectionName)?.request === request) {
      sharedRecordRequests.delete(collectionName);
    }
  });
  sharedRecordRequests.set(collectionName, { user, request });
  return request;
}

async function fetchSharedRecords(collectionName, user) {
  const token = await user.getIdToken();
  const documents = [];
  let cursor = "";
  do {
    const response = await apiClient.get(`/auth/${collectionName}`, {
      headers: buildAuthHeaders(token), params: { cursor, limit: 500 },
    });
    if (auth.currentUser !== user) throw new Error("Your account changed. Please try again.");
    documents.push(...response.data.records);
    const nextCursor = response.data.nextCursor || "";
    if (nextCursor && nextCursor === cursor) throw new Error("Unable to finish loading saved records.");
    cursor = nextCursor;
  } while (cursor);
  return documents;
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
      const response = await apiClient.put(`/auth/appointments/${encodeURIComponent(id)}`, removeUndefinedFields(appointment), {
        headers: buildAuthHeaders(token),
      });
      invalidateScheduleCache(COLLECTIONS.appointments);
      invalidateScheduleCache(COLLECTIONS.notifications);
      return response.data.appointment || true;
    } catch (error) {
      const requestError = new Error(extractApiError(error, "Unable to save the appointment."));
      requestError.code = error?.response?.data?.details?.code;
      throw requestError;
    }
  };

  return save().catch((error) => {
    logSyncError("Appointment sync", error);
    throw error;
  });
}

export async function savePetRecordDocument(record) {
  if (!["Male", "Female"].includes(record?.gender)) throw new Error("Pet gender must be Male or Female.");
  assertAppropriatePetText(record);
  if (!canSyncScheduleData()) throw new Error("Sign in and reconnect to save a pet profile.");
  const petData = { ...record };
  delete petData.photoURL;
  delete petData.photoModerationId;
  const token = await auth.currentUser.getIdToken();
  try {
    await apiClient.put(`/auth/pets/${encodeURIComponent(record.id)}`, removeUndefinedFields(petData), { headers: buildAuthHeaders(token) });
    invalidateScheduleCache(COLLECTIONS.petRecords);
    return true;
  } catch (error) {
    throw new Error(extractApiError(error, "Unable to save the pet profile."));
  }
}

export async function deletePetRecordDocument(id) {
  if (!canSyncScheduleData()) throw new Error("Sign in to delete a pet profile.");
  try {
    const token = await auth.currentUser.getIdToken();
    const response = await apiClient.delete(`/auth/pets/${encodeURIComponent(id)}`, { headers: buildAuthHeaders(token) });
    invalidateScheduleCache(COLLECTIONS.petRecords);
    invalidateScheduleCache(COLLECTIONS.appointments);
    return response.data.deletedAppointmentIds || [];
  } catch (error) {
    throw new Error(extractApiError(error, "Unable to delete the pet profile."));
  }
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

export function loadAppointmentDocuments() {
  return loadSharedRecords(COLLECTIONS.appointments);
}

export function loadRecentNotifications({ force = false } = {}) {
  if (!canSyncScheduleData()) return Promise.resolve([]);
  return loadFilteredScheduleDocuments("notifications:recent", query(collection(db, COLLECTIONS.notifications), orderBy("createdAt", "desc"), limit(51)), { force });
}

export function loadMoreRecentNotifications() {
  if (!canSyncScheduleData()) return Promise.resolve([]);
  const uid = auth.currentUser.uid;
  const cached = collectionCache.get(`${uid}:notifications:recent`);
  if (!cached?.hasMore) return Promise.resolve(cached?.documents || []);
  const last = cached.documents.at(-1);
  if (!last) return Promise.resolve([]);
  const loadingKey = `${uid}:notifications:older`;
  if (collectionLoadRequests.has(loadingKey)) return collectionLoadRequests.get(loadingKey);
  const request = getDocs(query(
    collection(db, COLLECTIONS.notifications), orderBy("createdAt", "desc"),
    startAfter(last.createdAt), limit(51),
  )).then((snapshot) => {
    const page = snapshot.docs.slice(0, 50).map((entry) => ({ id: entry.id, ...entry.data() }));
    const documents = [...cached.documents, ...page];
    collectionCache.set(`${uid}:notifications:recent`, { fetchedAt: Date.now(), documents, hasMore: snapshot.docs.length > 50 });
    return documents;
  }).catch((error) => {
    logSyncError("Older notifications load", error);
    return cached.documents;
  }).finally(() => collectionLoadRequests.delete(loadingKey));
  collectionLoadRequests.set(loadingKey, request);
  return request;
}

export function hasMoreRecentNotifications() {
  const uid = auth?.currentUser?.uid;
  const cached = uid ? collectionCache.get(`${uid}:notifications:recent`) : null;
  return Boolean(cached?.hasMore);
}

export function loadMoreAppointmentDocuments() {
  return loadSharedRecords(COLLECTIONS.appointments);
}

export function loadCustomerAppointments() {
  return loadSharedRecords(COLLECTIONS.appointments);
}

export function loadCustomerNotifications(customer) {
  if (!canSyncScheduleData() || !customer?.uid) return Promise.resolve([]);
  return loadFilteredScheduleDocuments(`customer-notifications:${customer.uid}`, query(collection(db, COLLECTIONS.notifications), where("targetUserId", "==", customer.uid), orderBy("createdAt", "desc"), limit(50)));
}

function loadPagedFilteredScheduleDocuments(cacheKeySuffix, buildQuery, { maxPages = 1, force = false, cursorType = "id" } = {}) {
  const uid = auth.currentUser.uid;
  const cacheKey = `${uid}:${cacheKeySuffix}`;
  const cached = collectionCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.fetchedAt < SCHEDULE_CACHE_TTL_MS) return Promise.resolve(cached.documents);
  if (!force && collectionLoadRequests.has(cacheKey)) return collectionLoadRequests.get(cacheKey);
  const request = (async () => {
    const documents = [];
    let hasMore = false;
    let cursor = "";
    for (let page = 0; page < Math.min(maxPages, MAX_PORTAL_APPOINTMENT_PAGES); page += 1) {
      const snapshot = await getDocs(buildQuery(cursor));
      if (cacheKeySuffix === "notifications:recent" && snapshot.docs.length > 50) hasMore = true;
      const pageDocuments = snapshot.docs.slice(0, SCHEDULE_PAGE_SIZE).map((entry) => ({ id: entry.id, ...entry.data() }));
      documents.push(...pageDocuments.slice(0, cacheKeySuffix === "notifications:recent" ? 50 : undefined));
      if (cacheKeySuffix === "notifications:recent") break;
      if (snapshot.docs.length <= SCHEDULE_PAGE_SIZE) break;
      cursor = cursorType === "snapshot"
        ? snapshot.docs[SCHEDULE_PAGE_SIZE - 1] || null
        : pageDocuments.at(-1)?.id || "";
      if (!cursor) break;
    }
    collectionCache.set(cacheKey, { fetchedAt: Date.now(), documents, hasMore });
    return documents;
  })().catch((error) => {
    logSyncError(`${cacheKeySuffix} load`, error);
    return [];
  }).finally(() => collectionLoadRequests.delete(cacheKey));
  collectionLoadRequests.set(cacheKey, request);
  return request;
}

function loadFilteredScheduleDocuments(cacheKeySuffix, firestoreQuery, { force = false } = {}) {
  const uid = auth.currentUser.uid;
  const cacheKey = `${uid}:${cacheKeySuffix}`;
  const cached = collectionCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.fetchedAt < SCHEDULE_CACHE_TTL_MS) return Promise.resolve(cached.documents);
  if (!force && collectionLoadRequests.has(cacheKey)) return collectionLoadRequests.get(cacheKey);
  const request = getDocs(firestoreQuery).then((snapshot) => {
  const documents = snapshot.docs.slice(0, cacheKeySuffix === "notifications:recent" ? 50 : undefined).map((entry) => ({ id: entry.id, ...entry.data() }));
    const hasMore = cacheKeySuffix === "notifications:recent" && snapshot.docs.length > 50;
    collectionCache.set(cacheKey, { fetchedAt: Date.now(), documents, hasMore });
    if (cacheKeySuffix === "appointments:recent") collectionCache.set(`${uid}:appointments`, { fetchedAt: Date.now(), documents });
    if (cacheKeySuffix === "notifications:recent") collectionCache.set(`${uid}:notifications`, { fetchedAt: Date.now(), documents, hasMore });
    return documents;
  }).catch((error) => {
    logSyncError(`${cacheKeySuffix} load`, error);
    return [];
  }).finally(() => collectionLoadRequests.delete(cacheKey));
  collectionLoadRequests.set(cacheKey, request);
  return request;
}

export function loadPetRecordDocuments() {
  return loadSharedRecords(COLLECTIONS.petRecords);
}

export function loadCustomerPetRecords() {
  return loadSharedRecords(COLLECTIONS.petRecords);
}

function subscribeScheduleDocuments(collectionName, onChange, onError = () => {}) {
  let disposed = false;
  const refresh = async (force = false) => {
    try {
      const documents = await loadScheduleDocuments(collectionName, { force });
      if (!disposed) onChange(documents);
    } catch (error) {
      if (!disposed) { logSyncError(`${collectionName} refresh`, error); onError?.(error); }
    }
  };
  void refresh();
  const handleFocus = () => { void refresh(true); };
  window.addEventListener("focus", handleFocus);
  return () => { disposed = true; window.removeEventListener("focus", handleFocus); };
}

function subscribeSharedRecords(collectionName, onChange, onError = () => {}, { customerId = "", expectedUid = "" } = {}) {
  let disposed = false;
  let timer;
  let unsubscribe = () => {};
  let user;
  let refreshing = false;
  let refreshAgain = false;
  const refresh = async () => {
    if (disposed || !user || auth.currentUser !== user) return;
    if (refreshing) { refreshAgain = true; return; }
    refreshing = true;
    clearTimeout(timer);
    try {
      const documents = await loadSharedRecords(collectionName);
      if (!disposed && auth.currentUser === user) onChange(documents);
    } catch (error) {
      if (!disposed && auth.currentUser === user) onError(error);
    } finally {
      refreshing = false;
      if (!disposed && auth.currentUser === user) {
        if (refreshAgain) { refreshAgain = false; void refresh(); }
        else timer = setTimeout(refresh, 10000);
      }
    }
  };
  const handleFocus = () => { if (document.visibilityState !== "hidden") void refresh(); };
  const start = async () => {
    user = await waitForFirebaseUserSession(expectedUid || customerId);
    if (disposed) return;
    if (!user) { onError(new Error("Sign in again to synchronize saved records.")); return; }
    void refresh();
    const constraints = customerId ? [where("customerId", "==", customerId)] : [];
    // Firestore events trigger complete API reads, so a limited snapshot cannot
    // remove older bookings from the calendar. Polling also covers denied rules.
    unsubscribe = onSnapshot(query(collection(db, collectionName), ...constraints,
      orderBy("__name__", "desc"), limit(SCHEDULE_PAGE_SIZE)), () => { void refresh(); },
      error => { logSyncError(collectionName + " live updates; using API refresh", error); });
  };
  void start().catch(error => { if (!disposed) onError(error); });
  window.addEventListener("focus", handleFocus);
  document.addEventListener("visibilitychange", handleFocus);
  return () => {
    disposed = true; clearTimeout(timer); unsubscribe();
    window.removeEventListener("focus", handleFocus);
    document.removeEventListener("visibilitychange", handleFocus);
  };
}

export function subscribeAppointments(onChange, onError, options) {
  return subscribeSharedRecords(COLLECTIONS.appointments, onChange, onError, options);
}

export function subscribePetRecords(onChange, onError, options) {
  return subscribeSharedRecords(COLLECTIONS.petRecords, onChange, onError, options);
}

export function subscribeNotifications(onChange, onError) {
  return subscribeScheduleDocuments(COLLECTIONS.notifications, onChange, onError);
}

export async function loadAvailabilitySlotDocuments(options = {}) {
  if (!options.force) {
    const cachedSlots = readJsonCache(AVAILABILITY_SLOTS_CACHE_KEY, AVAILABILITY_SLOTS_CACHE_TTL_MS);
    if (Array.isArray(cachedSlots)) return cachedSlots;
    if (availabilitySlotsLoadRequest) return availabilitySlotsLoadRequest;
  } else if (availabilitySlotsLoadRequest) {
    return availabilitySlotsLoadRequest;
  }

  const request = (async () => {
    const slots = [];
    let cursor = "";

    for (let page = 0; page < MAX_AVAILABILITY_SLOT_PAGES; page += 1) {
      const data = await requestAvailabilitySlots("get", "", undefined, {
        limit: AVAILABILITY_SLOT_PAGE_SIZE,
        cursor,
      });
      slots.push(...(Array.isArray(data.slots) ? data.slots : []));

      cursor = data.pagination?.nextCursor || "";
      if (!cursor) {
        break;
      }
    }

    writeJsonCache(AVAILABILITY_SLOTS_CACHE_KEY, slots);
    return slots;
  })().catch((error) => {
    removeJsonCache(AVAILABILITY_SLOTS_CACHE_KEY);
    throw error;
  });

  availabilitySlotsLoadRequest = request;

  try {
    return await request;
  } finally {
    if (availabilitySlotsLoadRequest === request) availabilitySlotsLoadRequest = null;
  }
}

export function invalidateScheduleCache(collectionName) {
  // A post-write refresh must not join a read started before the write.
  if (collectionName) sharedRecordRequests.delete(collectionName);
  else sharedRecordRequests.clear();
  const uid = auth?.currentUser?.uid;
  if (uid && collectionName) {
    for (const key of collectionCache.keys()) {
      const matchesCollection = key.includes(collectionName) ||
        (collectionName === COLLECTIONS.petRecords && key === `${uid}:customer-pets`);
      if (key.startsWith(`${uid}:`) && matchesCollection) collectionCache.delete(key);
    }
  } else if (uid) {
    for (const key of collectionCache.keys()) if (key.startsWith(`${uid}:`)) collectionCache.delete(key);
  }
}

export function clearScheduleCache() {
  sharedRecordRequests.clear();
  collectionCache.clear();
  collectionLoadRequests.clear();
  availabilitySlotsLoadRequest = null;
  removeJsonCache(AVAILABILITY_SLOTS_CACHE_KEY);
}

async function requestAvailabilitySlots(method, id = "", payload, params = {}) {
  const user = auth?.currentUser;
  if (!isFirebaseConfigured || !user) throw new Error("You must be signed in to access appointment slots.");
  try {
    const token = await user.getIdToken();
    if (auth.currentUser !== user) throw new Error("Your account changed. Please try again.");
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        query.set(key, String(value));
      }
    });
    const queryString = query.toString();
    const url = `/auth/availability-slots${id ? `/${encodeURIComponent(id)}` : ""}${queryString ? `?${queryString}` : ""}`;
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
  let pollingTimer;
  let refreshing = false;
  const fail = (error) => {
    if (disposed) return;
    logSyncError("Availability subscription", error);
    onError(schedulePermissionError(error));
  };
  const refresh = async () => {
    if (disposed || auth.currentUser !== user || document.visibilityState === "hidden") return;
    if (refreshing) return;
    refreshing = true;
    clearTimeout(pollingTimer);
    try {
      const slots = await loadAvailabilitySlotDocuments({ force: true });
      if (!disposed && auth.currentUser === user) onChange(slots);
    } catch (error) { fail(error); }
    finally { refreshing = false; }
    if (!disposed && auth.currentUser === user) pollingTimer = setTimeout(refresh, 60_000);
  };
  const cachedSlots = readJsonCache(AVAILABILITY_SLOTS_CACHE_KEY, AVAILABILITY_SLOTS_CACHE_TTL_MS);
  if (Array.isArray(cachedSlots)) onChange(cachedSlots);
  void refresh();
  const handleFocus = () => {
    clearTimeout(pollingTimer);
    removeJsonCache(AVAILABILITY_SLOTS_CACHE_KEY);
    invalidateScheduleCache(COLLECTIONS.appointments);
    void refresh();
  };
  window.addEventListener("focus", handleFocus);
  document.addEventListener("visibilitychange", handleFocus);
  return () => { disposed = true; clearTimeout(pollingTimer); window.removeEventListener("focus", handleFocus); document.removeEventListener("visibilitychange", handleFocus); };
}

export async function markNotificationReadDocument(notificationId, userId) {
  if (!canSyncScheduleData() || !notificationId || !userId) return;
  try {
    const reference = doc(db, COLLECTIONS.notifications, notificationId);
    await updateDoc(reference, { readBy: arrayUnion(userId) });
    invalidateScheduleCache(COLLECTIONS.notifications);
    invalidateScheduleCache(`customer-notifications:${userId}`);
  } catch (error) {
    logSyncError("Notification read status", error);
  }
}

export async function saveNotificationDocument(notification) {
  const saved = await saveDocument(COLLECTIONS.notifications, notification);
  invalidateScheduleCache(COLLECTIONS.notifications);
  return saved;
}

export async function markAllNotificationsReadDocuments(notifications, userId) {
  if (!canSyncScheduleData() || !Array.isArray(notifications) || !userId) return;
  const unread = notifications.filter((entry) => !entry.readBy?.includes(userId));
  for (const notification of unread) await markNotificationReadDocument(notification.id, userId);
}

export async function saveAvailabilitySlotDocument(slot) {
  const id = normalizeString(slot?.id);
  if (!id) throw new Error("A slot ID is required.");
  const result = await requestAvailabilitySlots("put", id, slot);
  removeJsonCache(AVAILABILITY_SLOTS_CACHE_KEY);
  invalidateScheduleCache(COLLECTIONS.availabilitySlots);
  return result;
}

export async function deleteAvailabilitySlotDocument(id) {
  const slotId = normalizeString(id);
  if (!slotId) throw new Error("A slot ID is required.");
  await requestAvailabilitySlots("delete", slotId);
  removeJsonCache(AVAILABILITY_SLOTS_CACHE_KEY);
  invalidateScheduleCache(COLLECTIONS.availabilitySlots);
  return true;
}
