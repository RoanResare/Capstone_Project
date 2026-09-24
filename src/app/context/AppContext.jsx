import { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import {
  buildSeedAvailabilitySlots,
  portalModules,
} from "../data/systemData.js";
import {
  APP_STORAGE_KEY,
  CURRENT_APP_STATE_VERSION,
  LEGACY_APP_STORAGE_KEYS,
  readStorageItem,
  removeStorageItem,
  writeStorageItem,
} from "../utils/browserState.js";
import { useAuth } from "./AuthContext.jsx";
import {
  deleteAvailabilitySlotDocument,
  deletePetRecordDocument,
  saveAppointmentDocument,
  saveAvailabilitySlotDocument,
  savePetRecordDocument,
  savePhotoModerationDocument,
} from "../services/scheduleData.js";
import * as userApi from "../services/userApi.js";

const AppContext = createContext(null);
const PORTAL_USER_ROLES = ["admin", "staff"];
const NOTIFICATION_TARGET_ROLES = ["admin", "staff", "customer"];
const PORTAL_USER_STATUSES = ["active", "inactive", "suspended"];
const PASSWORD_HASH_VERSION = 1;
const FORECAST_AVAILABILITY_DAYS = 120;
const INACTIVE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PENDING_APPOINTMENTS_PER_ACCOUNT = 2;

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeEmail(email = "") {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function countPendingAppointments(appointments, customerId = "", customerEmail = "") {
  const normalizedCustomerId = String(customerId || "").trim();
  const normalizedCustomerEmail = normalizeEmail(customerEmail);

  return (Array.isArray(appointments) ? appointments : []).filter((appointment) => {
    if (appointment?.status !== "Pending") {
      return false;
    }

    return (
      (normalizedCustomerId && appointment.customerId === normalizedCustomerId) ||
      (normalizedCustomerEmail && normalizeEmail(appointment.customerEmail) === normalizedCustomerEmail)
    );
  }).length;
}

function normalizeUsername(username = "") {
  return typeof username === "string" ? username.trim().toLowerCase() : "";
}

function deriveUsernameFromEmail(email = "") {
  const [localPart = ""] = normalizeEmail(email).split("@");
  return normalizeUsername(localPart.replace(/[^a-z0-9._-]/g, "").slice(0, 24));
}

function isValidUsername(username = "") {
  return /^[a-z0-9._-]{3,24}$/.test(normalizeUsername(username));
}

function isPortalUserRole(role) {
  return PORTAL_USER_ROLES.includes(role);
}

function isNotificationTargetRole(role) {
  return NOTIFICATION_TARGET_ROLES.includes(role);
}

function normalizePortalRole(role = "staff") {
  const normalized = typeof role === "string" ? role.trim().toLowerCase() : "";
  return isPortalUserRole(normalized) ? normalized : "staff";
}

function normalizePortalStatus(status = "active") {
  const normalized = typeof status === "string" ? status.trim().toLowerCase() : "";
  return PORTAL_USER_STATUSES.includes(normalized) ? normalized : "active";
}

function formatPortalStatus(status = "active") {
  const normalized = normalizePortalStatus(status);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function isStrongPassword(password = "") {
  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

function createRandomSalt() {
  if (!globalThis.crypto?.getRandomValues) {
    return createId("salt");
  }

  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function hashPasswordWithSalt(password, salt) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Secure password hashing is unavailable in this browser.");
  }

  const encoder = new TextEncoder();
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`${salt}:${password}`),
  );

  return bufferToHex(digest);
}

async function createPasswordCredentials(password) {
  const salt = createRandomSalt();
  const passwordHash = await hashPasswordWithSalt(password, salt);

  return {
    passwordHash,
    passwordSalt: salt,
    passwordVersion: PASSWORD_HASH_VERSION,
  };
}

async function doesPasswordMatch(user, password) {
  const rawPassword = typeof password === "string" ? password : "";

  if (
    typeof user?.passwordHash === "string" &&
    user.passwordHash &&
    typeof user?.passwordSalt === "string" &&
    user.passwordSalt
  ) {
    const candidateHash = await hashPasswordWithSalt(rawPassword, user.passwordSalt);
    if (candidateHash === user.passwordHash) {
      return true;
    }
  }

  return typeof user?.password === "string" && user.password === rawPassword;
}

function normalizePortalUser(user) {
  const current = user && typeof user === "object" ? user : {};
  const id =
    typeof current.uid === "string" && current.uid.trim()
      ? current.uid.trim()
      : typeof current.id === "string"
        ? current.id.trim()
        : "";
  const name = typeof current.name === "string" ? current.name.trim() : "";
  const role = normalizePortalRole(current.role);
  const hasSecurePassword =
    typeof current.passwordHash === "string" &&
    current.passwordHash &&
    typeof current.passwordSalt === "string" &&
    current.passwordSalt;

  return {
    ...current,
    id,
    uid: id,
    name,
    username: normalizeUsername(current.username || deriveUsernameFromEmail(current.email || "")),
    email: normalizeEmail(current.email || ""),
    role,
    status: normalizePortalStatus(current.status),
    avatar: current.avatar || createAvatar(name),
    bio:
      typeof current.bio === "string" && current.bio.trim()
        ? current.bio.trim()
        : role === "admin"
          ? "Portal administrator"
          : "Staff account",
    password: hasSecurePassword
      ? ""
      : typeof current.password === "string"
        ? current.password
        : "",
    passwordHash:
      typeof current.passwordHash === "string" ? current.passwordHash : "",
    passwordSalt:
      typeof current.passwordSalt === "string" ? current.passwordSalt : "",
    passwordVersion:
      Number(current.passwordVersion) === PASSWORD_HASH_VERSION && hasSecurePassword
        ? PASSWORD_HASH_VERSION
        : hasSecurePassword
          ? PASSWORD_HASH_VERSION
          : 0,
    statusChangedAt:
      typeof current.statusChangedAt === "string" && current.statusChangedAt
        ? current.statusChangedAt
        : typeof current.updatedAt === "string" && current.updatedAt
          ? current.updatedAt
          : typeof current.createdAt === "string" && current.createdAt
            ? current.createdAt
            : new Date().toISOString(),
    };
}

function isExpiredInactiveUser(user) {
  if (!["inactive", "suspended"].includes(user.status)) {
    return false;
  }

  const parsed = new Date(user.statusChangedAt || user.updatedAt || user.createdAt || "");
  const referenceTime = Number.isNaN(parsed.getTime()) ? Date.now() : parsed.getTime();
  return Date.now() - referenceTime > INACTIVE_RETENTION_MS;
}

function normalizeApiPortalUser(user) {
  return {
    ...user,
    id: user.uid || user.id,
    name: user.fullName || user.name,
  };
}

function normalizeSessionUser(user) {
  const current = user && typeof user === "object" ? user : {};
  const name =
    typeof current.fullName === "string" && current.fullName.trim()
      ? current.fullName.trim()
      : typeof current.name === "string"
        ? current.name.trim()
        : "";
  const role =
    typeof current.role === "string" && current.role.trim()
      ? current.role.trim().toLowerCase()
      : "customer";
  const rawStatus =
    typeof current.accountStatus === "string" && current.accountStatus.trim()
      ? current.accountStatus.trim().toLowerCase()
      : typeof current.status === "string" && current.status.trim()
        ? current.status.trim().toLowerCase()
        : "active";
  const status =
    PORTAL_USER_STATUSES.includes(rawStatus) || rawStatus === "active" ? rawStatus : "active";
  const id =
    typeof current.uid === "string" && current.uid.trim()
      ? current.uid.trim()
      : typeof current.id === "string"
        ? current.id.trim()
        : "";

  return {
    ...current,
    id,
    uid: id,
    name,
    fullName: name,
    email: normalizeEmail(current.email || ""),
    role,
    status,
    avatar: current.avatar || createAvatar(name),
    bio:
      typeof current.bio === "string" && current.bio.trim()
        ? current.bio.trim()
        : role === "admin"
          ? "Portal administrator"
          : role === "staff"
            ? "Staff account"
            : "Customer account",
    phone: typeof current.phone === "string" ? current.phone : "",
  };
}

function isValidSessionUser(user) {
  return Boolean(user && isPortalUserRole(user.role) && user.status === "active");
}

function resolveSessionUserId(users, sessionUserId) {
  if (typeof sessionUserId !== "string") {
    return null;
  }

  const user = users.find((candidate) => candidate.id === sessionUserId);
  return isValidSessionUser(user) ? user.id : null;
}

function isValidDateInstance(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function parseDateValue(value) {
  if (value instanceof Date) {
    return isValidDateInstance(value) ? value : null;
  }

  if (value && typeof value === "object") {
    if (typeof value.toDate === "function") {
      const parsed = value.toDate();
      return isValidDateInstance(parsed) ? parsed : null;
    }

    if (typeof value.seconds === "number") {
      const milliseconds = value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1000000);
      const parsed = new Date(milliseconds);
      return isValidDateInstance(parsed) ? parsed : null;
    }
  }

  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const parsed = new Date(value);
  return isValidDateInstance(parsed) ? parsed : null;
}

function padDatePart(value) {
  return String(value).padStart(2, "0");
}

function toLocalDateKey(value) {
  return `${value.getFullYear()}-${padDatePart(value.getMonth() + 1)}-${padDatePart(value.getDate())}`;
}

function toLocalTimeKey(value) {
  return `${padDatePart(value.getHours())}:${padDatePart(value.getMinutes())}`;
}

function normalizeScheduleTime(timeValue) {
  if (typeof timeValue !== "string") {
    return "";
  }

  const normalized = timeValue.trim();
  if (!normalized) {
    return "";
  }

  const match = normalized.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return normalized;
  }

  const [, hours, minutes] = match;
  return `${padDatePart(hours)}:${minutes}`;
}

function isFutureAvailabilitySlot(slot) {
  if (!slot?.date || !slot?.time) {
    return false;
  }

  const parsed = parseAppointmentSchedule(slot.date, slot.time);
  return parsed ? parsed.getTime() > Date.now() : slot.date >= toLocalDateKey(new Date());
}

function mergeAvailabilityForecast(slots = []) {
  const forecastSlots = buildSeedAvailabilitySlots({ days: FORECAST_AVAILABILITY_DAYS });
  const byId = new Map();

  forecastSlots.forEach((slot) => {
    byId.set(slot.id, slot);
  });

  slots
    .filter((slot) => slot && typeof slot === "object" && isFutureAvailabilitySlot(slot))
    .forEach((slot) => {
      byId.set(slot.id, {
        capacity: Number(slot.capacity) || 1,
        isOpen: typeof slot.isOpen === "boolean" ? slot.isOpen : true,
        ...slot,
      });
    });

  return Array.from(byId.values()).sort((left, right) =>
    `${left.date} ${left.time}`.localeCompare(`${right.date} ${right.time}`),
  );
}

function parseAppointmentSchedule(dateValue, timeValue) {
  if (typeof dateValue !== "string" || typeof timeValue !== "string") {
    return null;
  }

  const normalizedDate = dateValue.trim();
  const normalizedTime = normalizeScheduleTime(timeValue);
  if (!normalizedDate || !normalizedTime) {
    return null;
  }

  const parsed = new Date(`${normalizedDate}T${normalizedTime}:00`);
  return isValidDateInstance(parsed) ? parsed : null;
}

function normalizeAppointment(appointment) {
  const current = appointment && typeof appointment === "object" ? appointment : {};
  const rawScheduleDate =
    typeof current.scheduleDate === "string" ? current.scheduleDate.trim() : "";
  const rawScheduleTime = normalizeScheduleTime(current.scheduleTime);
  const scheduleFromParts = parseAppointmentSchedule(
    rawScheduleDate,
    rawScheduleTime,
  );
  const scheduleFromValue = parseDateValue(current.schedule);
  const resolvedSchedule = scheduleFromParts || scheduleFromValue;

  return {
    ...current,
    scheduleDate: scheduleFromParts
      ? rawScheduleDate
      : resolvedSchedule
        ? toLocalDateKey(resolvedSchedule)
        : rawScheduleDate,
    scheduleTime: scheduleFromParts
      ? rawScheduleTime
      : resolvedSchedule
        ? toLocalTimeKey(resolvedSchedule)
        : rawScheduleTime,
    schedule: resolvedSchedule ? resolvedSchedule.toISOString() : null,
    status:
      typeof current.status === "string" && current.status.trim()
        ? current.status
        : "Pending",
    assignedStaff:
      typeof current.assignedStaff === "string" ? current.assignedStaff : "",
    reminderEnabled:
      typeof current.reminderEnabled === "boolean" ? current.reminderEnabled : true,
    createdAt: parseDateValue(current.createdAt)?.toISOString() || new Date().toISOString(),
  };
}

function parseGeneratedIdDate(id) {
  if (typeof id !== "string") {
    return null;
  }

  const match = id.match(/-(\d{12,})(?:-|$)/);
  if (!match) {
    return null;
  }

  const parsed = new Date(Number(match[1]));
  return isValidDateInstance(parsed) ? parsed : null;
}

function normalizePetRecord(record) {
  const current = record && typeof record === "object" ? record : {};
  const id = typeof current.id === "string" && current.id.trim() ? current.id : createId("pet");
  const legacyLastVisit = current.lastVisit ? parseDateValue(`${current.lastVisit}T00:00:00`) : null;
  const createdAt =
    parseDateValue(current.createdAt)?.toISOString() ||
    parseDateValue(current.updatedAt)?.toISOString() ||
    parseGeneratedIdDate(id)?.toISOString() ||
    legacyLastVisit?.toISOString() ||
    new Date().toISOString();
  const updatedAt = parseDateValue(current.updatedAt)?.toISOString() || createdAt;

  return {
    ...current,
    id,
    customerId: typeof current.customerId === "string" ? current.customerId : "",
    customerEmail:
      typeof current.customerEmail === "string" ? normalizeEmail(current.customerEmail) : "",
    ownerName: typeof current.ownerName === "string" ? current.ownerName.trim() : "",
    petName: typeof current.petName === "string" ? current.petName.trim() : "",
    petType: typeof current.petType === "string" ? current.petType.trim() : "",
    breed: typeof current.breed === "string" ? current.breed.trim() : "",
    lastVisit: typeof current.lastVisit === "string" ? current.lastVisit.trim() : "",
    visitRecords: Array.isArray(current.visitRecords)
      ? current.visitRecords.filter((item) => typeof item === "string" && item.trim())
      : [],
    medicalRecords: Array.isArray(current.medicalRecords)
      ? current.medicalRecords.filter((item) => typeof item === "string" && item.trim())
      : [],
    notes: typeof current.notes === "string" ? current.notes : "",
    createdAt,
    updatedAt,
  };
}

function normalizePhotoModeration(record) {
  const current = record && typeof record === "object" ? record : {};
  const status = ["pending", "approved", "rejected"].includes(current.status)
    ? current.status
    : "pending";
  const createdAt = parseDateValue(current.createdAt)?.toISOString() || new Date().toISOString();

  return {
    ...current,
    id: typeof current.id === "string" && current.id.trim() ? current.id : createId("photo"),
    assetType: current.assetType === "profile" ? "profile" : "pet",
    assetId: typeof current.assetId === "string" ? current.assetId : "",
    ownerId: typeof current.ownerId === "string" ? current.ownerId : "",
    ownerEmail: normalizeEmail(current.ownerEmail),
    ownerName: typeof current.ownerName === "string" ? current.ownerName.trim() : "Customer",
    subjectName: typeof current.subjectName === "string" ? current.subjectName.trim() : "Photo",
    photoURL: typeof current.photoURL === "string" ? current.photoURL : "",
    status,
    moderationNote: typeof current.moderationNote === "string" ? current.moderationNote : "",
    createdAt,
    reviewedAt: parseDateValue(current.reviewedAt)?.toISOString() || "",
    reviewedBy: typeof current.reviewedBy === "string" ? current.reviewedBy : "",
  };
}

function getNewestTimestamp(record, fallbackFields = []) {
  const timestampFields = ["createdAt", ...fallbackFields, "updatedAt"];

  for (const field of timestampFields) {
    const parsed = parseDateValue(record?.[field]);
    if (parsed) {
      return parsed.getTime();
    }
  }

  return 0;
}

function sortByNewest(left, right, fallbackFields = []) {
  const rightTime = getNewestTimestamp(right, fallbackFields);
  const leftTime = getNewestTimestamp(left, fallbackFields);

  if (rightTime !== leftTime) {
    return rightTime - leftTime;
  }

  return String(right?.id || "").localeCompare(String(left?.id || ""));
}

function normalizeRoleLabel(role = "") {
  const normalized = typeof role === "string" ? role.trim().toLowerCase() : "";
  if (!normalized) {
    return "System";
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function buildNotificationHref(notification) {
  const params = new URLSearchParams();

  if (notification.targetType === "portal-account") {
    params.set("user", notification.targetId);
    params.set("notification", notification.id);
    return `/portal/manage-users?${params.toString()}`;
  }

  if (notification.relatedAppointmentId) {
    params.set("appointment", notification.relatedAppointmentId);
  }

  params.set("notification", notification.id);
  return `/portal/appointments?${params.toString()}`;
}

function normalizeNotification(notification) {
  const current = notification && typeof notification === "object" ? notification : {};
  const targetRoles = Array.isArray(current.targetRoles)
    ? current.targetRoles
        .map((role) => (typeof role === "string" ? role.trim().toLowerCase() : ""))
        .filter((role) => isNotificationTargetRole(role))
    : [];

  const normalized = {
    id: typeof current.id === "string" && current.id.trim() ? current.id : createId("notification"),
    title:
      typeof current.title === "string" && current.title.trim()
        ? current.title.trim()
        : "System notification",
    message: typeof current.message === "string" ? current.message : "",
    targetRoles: targetRoles.length > 0 ? targetRoles : ["admin", "staff"],
    level:
      typeof current.level === "string" && current.level.trim() ? current.level.trim() : "info",
    readBy: Array.isArray(current.readBy)
      ? current.readBy.filter((value) => typeof value === "string" && value.trim())
      : [],
    createdAt: parseDateValue(current.createdAt)?.toISOString() || new Date().toISOString(),
    actorName:
      typeof current.actorName === "string" && current.actorName.trim()
        ? current.actorName.trim()
        : "System",
    actorRole: normalizeRoleLabel(current.actorRole),
    actionLabel:
      typeof current.actionLabel === "string" && current.actionLabel.trim()
        ? current.actionLabel.trim()
        : "Updated",
    subjectName:
      typeof current.subjectName === "string" && current.subjectName.trim()
        ? current.subjectName.trim()
        : "",
    subjectRole: normalizeRoleLabel(current.subjectRole),
    targetType:
      typeof current.targetType === "string" && current.targetType.trim()
        ? current.targetType.trim()
        : "system",
    targetId:
      typeof current.targetId === "string" && current.targetId.trim() ? current.targetId.trim() : "",
    targetUserId:
      typeof current.targetUserId === "string" && current.targetUserId.trim()
        ? current.targetUserId.trim()
        : "",
    relatedAppointmentId:
      typeof current.relatedAppointmentId === "string" && current.relatedAppointmentId.trim()
        ? current.relatedAppointmentId.trim()
        : "",
    appointmentDate:
      typeof current.appointmentDate === "string" && current.appointmentDate.trim()
        ? current.appointmentDate.trim()
        : "",
    appointmentTime: normalizeScheduleTime(current.appointmentTime),
    serviceName:
      typeof current.serviceName === "string" && current.serviceName.trim()
        ? current.serviceName.trim()
        : "",
    petName:
      typeof current.petName === "string" && current.petName.trim() ? current.petName.trim() : "",
    email:
      typeof current.email === "string" && current.email.trim()
        ? normalizeEmail(current.email)
        : "",
    phone:
      typeof current.phone === "string" && current.phone.trim() ? current.phone.trim() : "",
  };

  return {
    ...normalized,
    targetHref:
      typeof current.targetHref === "string" && current.targetHref.trim()
        ? current.targetHref.trim()
        : buildNotificationHref(normalized),
  };
}

function createNotification(input, message, targetRoles, level = "info") {
  if (input && typeof input === "object") {
    return normalizeNotification({
      id: createId("notification"),
      ...input,
    });
  }

  return normalizeNotification({
    id: createId("notification"),
    title: input,
    message,
    targetRoles,
    level,
  });
}

function notificationSignature(notification) {
  return [
    notification.targetType,
    notification.targetId,
    notification.relatedAppointmentId,
    notification.actionLabel,
    notification.title,
  ].join("|");
}

function mergeNotifications(existingNotifications, requiredNotifications) {
  const normalizedExisting = existingNotifications
    .filter((notification) => notification && typeof notification === "object")
    .map((notification) => normalizeNotification(notification));
  const existingSignatures = new Set(
    normalizedExisting.map((notification) => notificationSignature(notification)),
  );
  const missingNotifications = requiredNotifications
    .map((notification) => normalizeNotification(notification))
    .filter((notification) => !existingSignatures.has(notificationSignature(notification)));

  return [...normalizedExisting, ...missingNotifications]
    .sort(
      (left, right) =>
        (parseDateValue(right.createdAt)?.getTime() || 0) -
        (parseDateValue(left.createdAt)?.getTime() || 0),
    )
    .slice(0, 50);
}

function isNotificationVisibleToUser(notification, currentUser) {
  if (!notification?.targetRoles?.includes(currentUser?.role)) {
    return false;
  }

  if (currentUser.role !== "customer") {
    return true;
  }

  const currentUserIds = [currentUser.id, currentUser.uid].filter(Boolean);
  const notificationUserIds = [notification.targetUserId, notification.targetId].filter(Boolean);
  const matchesUserId = notificationUserIds.some((id) => currentUserIds.includes(id));
  const matchesEmail =
    notification.email &&
    currentUser.email &&
    normalizeEmail(notification.email) === normalizeEmail(currentUser.email);

  return matchesUserId || matchesEmail;
}

function createAvatar(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function createActivity(actorName, action, module, detail) {
  return {
    id: createId("log"),
    actorName,
    action,
    module,
    detail,
    at: new Date().toISOString(),
  };
}

function createSeedState() {
  const availabilitySlots = buildSeedAvailabilitySlots({ days: FORECAST_AVAILABILITY_DAYS });
  const firstSlot = availabilitySlots[0];
  const secondSlot = availabilitySlots[1];
  const thirdSlot = availabilitySlots[2];
  const users = [
    {
      id: "user-admin-1",
      name: "Andrea Santos",
      email: "admin@furfection.local",
      password: "admin123",
      role: "admin",
      phone: "+63 917 555 0101",
      shift: "Operations Director",
      avatar: "AS",
      bio: "Clinic administrator and appointment operations lead.",
      status: "active",
    },
    {
      id: "user-staff-1",
      name: "Mika Reyes",
      email: "staff@furfection.local",
      password: "staff123",
      role: "staff",
      phone: "+63 917 555 0102",
      shift: "Morning Shift",
      avatar: "MR",
      bio: "Front desk and appointment coordinator.",
      status: "active",
    },
    {
      id: "user-staff-2",
      name: "Luis Dela Cruz",
      email: "luis@furfection.local",
      password: "staff123",
      role: "staff",
      phone: "+63 917 555 0103",
      shift: "Afternoon Shift",
      avatar: "LC",
      bio: "Queue management and follow-up support.",
      status: "active",
    },
  ];
  const appointments = [
    {
      id: "appt-1",
      customerId: "customer-demo-1",
      customerEmail: "petparent@furfection.local",
      ownerName: "Janelle Ramos",
      petRecordId: "pet-1",
      petName: "Tofu",
      petType: "Dog",
      breed: "Shih Tzu",
      service: "Vaccination",
      slotId: firstSlot.id,
      scheduleDate: firstSlot.date,
      scheduleTime: firstSlot.time,
      assignedStaff: "Mika Reyes",
      status: "Pending",
      reminderEnabled: true,
      notes: "First puppy shot and vaccine card update.",
      createdAt: new Date().toISOString(),
    },
    {
      id: "appt-2",
      customerId: "customer-demo-1",
      customerEmail: "petparent@furfection.local",
      ownerName: "Janelle Ramos",
      petRecordId: "pet-2",
      petName: "Mochi",
      petType: "Cat",
      breed: "Persian",
      service: "Consultation",
      slotId: secondSlot.id,
      scheduleDate: secondSlot.date,
      scheduleTime: secondSlot.time,
      assignedStaff: "Luis Dela Cruz",
      status: "Confirmed",
      reminderEnabled: true,
      notes: "Skin irritation follow-up.",
      createdAt: new Date().toISOString(),
    },
    {
      id: "appt-3",
      customerId: "",
      customerEmail: "walkin@example.com",
      ownerName: "Paolo Tan",
      petRecordId: "pet-3",
      petName: "Cookie",
      petType: "Dog",
      breed: "Pomeranian",
      service: "Pet Grooming",
      slotId: thirdSlot.id,
      scheduleDate: thirdSlot.date,
      scheduleTime: thirdSlot.time,
      assignedStaff: "Mika Reyes",
      status: "Completed",
      reminderEnabled: false,
      notes: "Requested short summer cut.",
      createdAt: new Date().toISOString(),
    },
  ];
  const notifications = [
    createNotification({
      title: "Admin account created",
      message: "Andrea Santos can review bookings and manage the appointment queue.",
      actorName: "Andrea Santos",
      actorRole: "admin",
      actionLabel: "Created account",
      subjectName: "Andrea Santos",
      subjectRole: "admin",
      targetType: "portal-account",
      targetId: "user-admin-1",
      email: "admin@furfection.local",
      phone: "+63 917 555 0101",
      targetRoles: ["admin", "staff"],
      level: "success",
    }),
    createNotification({
      title: "Staff account created",
      message: "Mika Reyes can now coordinate pending and confirmed appointments.",
      actorName: "Mika Reyes",
      actorRole: "staff",
      actionLabel: "Created account",
      subjectName: "Mika Reyes",
      subjectRole: "staff",
      targetType: "portal-account",
      targetId: "user-staff-1",
      email: "staff@furfection.local",
      phone: "+63 917 555 0102",
      targetRoles: ["admin", "staff"],
      level: "success",
    }),
    createNotification({
      title: "Customer account created",
      message: "Janelle Ramos can now book appointments through the customer portal.",
      actorName: "Janelle Ramos",
      actorRole: "customer",
      actionLabel: "Created account",
      subjectName: "Janelle Ramos",
      subjectRole: "customer",
      targetType: "customer-account",
      targetId: "customer-demo-1",
      email: "petparent@furfection.local",
      phone: "+63 917 555 0199",
      targetRoles: ["admin", "staff"],
      level: "success",
    }),
    createNotification({
      title: "New appointment booking",
      message: "Janelle Ramos submitted a Vaccination request for Tofu.",
      actorName: "Janelle Ramos",
      actorRole: "customer",
      actionLabel: "Booked appointment",
      subjectName: "Tofu",
      subjectRole: "pet",
      targetType: "appointment",
      targetId: "appt-1",
      relatedAppointmentId: "appt-1",
      appointmentDate: firstSlot.date,
      appointmentTime: firstSlot.time,
      serviceName: "Vaccination",
      petName: "Tofu",
      email: "petparent@furfection.local",
      phone: "+63 917 555 0199",
      targetRoles: ["admin", "staff"],
      level: "info",
    }),
  ];
  const petRecords = [
    {
      id: "pet-1",
      customerId: "customer-demo-1",
      customerEmail: "petparent@furfection.local",
      ownerName: "Janelle Ramos",
      petName: "Tofu",
      petType: "Dog",
      breed: "Shih Tzu",
      lastVisit: "2026-05-04",
      visitRecords: [
        "Routine checkup completed.",
        "Vaccination follow-up scheduled.",
      ],
      medicalRecords: [
        "No known allergies.",
        "Weight management advice provided.",
      ],
      notes: "Friendly during handling and grooming prep.",
    },
    {
      id: "pet-2",
      customerId: "customer-demo-1",
      customerEmail: "petparent@furfection.local",
      ownerName: "Janelle Ramos",
      petName: "Mochi",
      petType: "Cat",
      breed: "Persian",
      lastVisit: "2026-05-07",
      visitRecords: [
        "Consultation requested for mild skin irritation.",
      ],
      medicalRecords: [
        "Sensitive skin noted.",
        "Hypoallergenic shampoo recommended.",
      ],
      notes: "Needs quiet handling during checkups.",
    },
    {
      id: "pet-3",
      customerId: "",
      customerEmail: "walkin@example.com",
      ownerName: "Paolo Tan",
      petName: "Cookie",
      petType: "Dog",
      breed: "Pomeranian",
      lastVisit: "2026-05-08",
      visitRecords: [
        "Full grooming session completed.",
      ],
      medicalRecords: [
        "No medical alerts provided.",
      ],
      notes: "Prefers quick dryer setting.",
    },
  ];

  return {
    version: CURRENT_APP_STATE_VERSION,
    sessionUserId: null,
    users: users.map((user) => normalizePortalUser(user)),
    availabilitySlots,
    appointments: appointments.map((appointment) => normalizeAppointment(appointment)),
    petRecords: petRecords.map((record) => normalizePetRecord(record)),
    photoModeration: [],
    chatbotLogs: [
      {
        id: "chat-1",
        question: "What services do you offer?",
        response:
          "We offer vaccination, deworming, consultation, laboratory testing, low cost kapon, and pet grooming.",
        recognized: true,
        language: "en",
        topic: "services",
        source: "home",
        createdAt: new Date().toISOString(),
      },
    ],
    notifications,
    activityLogs: [
      createActivity(
        "Andrea Santos",
        "Created portal account",
        "Authentication",
        "Initial admin account is ready for appointment oversight.",
      ),
      createActivity(
        "Janelle Ramos",
        "Created customer account",
        "Customer Accounts",
        "Customer registration is ready for appointment booking.",
      ),
      createActivity(
        "Janelle Ramos",
        "Booked appointment",
        "Manage Appointments",
        "Tofu has a pending vaccination appointment in the queue.",
      ),
    ],
  };
}

function normalizeStoredState(parsed) {
  const seed = createSeedState();

  if (!parsed || typeof parsed !== "object") {
    return seed;
  }

  const users = (Array.isArray(parsed.users) ? parsed.users : seed.users)
    .map((user) => normalizePortalUser(user))
    .filter((user) => !isExpiredInactiveUser(user));
  const notifications = Array.isArray(parsed.notifications)
    ? mergeNotifications(parsed.notifications, seed.notifications)
    : seed.notifications;

  return {
    ...seed,
    ...parsed,
    version: CURRENT_APP_STATE_VERSION,
    sessionUserId: resolveSessionUserId(users, parsed.sessionUserId),
    users,
    availabilitySlots: mergeAvailabilityForecast(
      Array.isArray(parsed.availabilitySlots) ? parsed.availabilitySlots : seed.availabilitySlots,
    ),
    appointments: Array.isArray(parsed.appointments)
      ? parsed.appointments
          .filter((appointment) => appointment && typeof appointment === "object")
          .map((appointment) => normalizeAppointment(appointment))
          .sort((left, right) => sortByNewest(left, right, ["updatedAt", "schedule"]))
      : seed.appointments,
    petRecords: Array.isArray(parsed.petRecords)
      ? parsed.petRecords
          .filter((record) => record && typeof record === "object")
          .map((record) => normalizePetRecord(record))
          .sort((left, right) => sortByNewest(left, right, ["updatedAt", "lastVisit"]))
      : seed.petRecords,
    photoModeration: Array.isArray(parsed.photoModeration)
      ? parsed.photoModeration
          .filter((record) => record && typeof record === "object")
          .map((record) => normalizePhotoModeration(record))
          .sort((left, right) => sortByNewest(left, right))
      : seed.photoModeration,
    chatbotLogs: Array.isArray(parsed.chatbotLogs) ? parsed.chatbotLogs : seed.chatbotLogs,
    notifications,
    activityLogs: Array.isArray(parsed.activityLogs)
      ? parsed.activityLogs
      : seed.activityLogs,
  };
}

function loadInitialState() {
  if (typeof window === "undefined") {
    return createSeedState();
  }

  for (const key of [APP_STORAGE_KEY, ...LEGACY_APP_STORAGE_KEYS]) {
    const storedValue = readStorageItem(key);
    if (!storedValue) {
      continue;
    }

    try {
      return normalizeStoredState(JSON.parse(storedValue));
    } catch {
      removeStorageItem(key);
    }
  }

  return createSeedState();
}

function persistState(state) {
  if (typeof window === "undefined") {
    return;
  }

  writeStorageItem(APP_STORAGE_KEY, JSON.stringify(normalizeStoredState(state)));
  LEGACY_APP_STORAGE_KEYS.forEach((key) => {
    if (key !== APP_STORAGE_KEY) {
      removeStorageItem(key);
    }
  });
}

function attachAudit(nextState, audit) {
  if (!audit) {
    return nextState;
  }

  return {
    ...nextState,
    activityLogs: [
      createActivity(audit.actorName, audit.action, audit.module, audit.detail),
      ...nextState.activityLogs,
    ].slice(0, 80),
    notifications: audit.notification
      ? [createNotification(audit.notification), ...nextState.notifications].slice(0, 50)
      : nextState.notifications,
  };
}

function appReducer(state, action) {
  switch (action.type) {
    case "HYDRATE_STATE":
      return normalizeStoredState(action.payload);
    case "SYNC_PORTAL_USERS": {
      const users = action.payload.users.map((user) => normalizePortalUser(user));
      return {
        ...state,
        users,
        sessionUserId: resolveSessionUserId(users, state.sessionUserId),
      };
    }
    case "MIGRATE_USER_PASSWORDS": {
      const users = action.payload.users.map((user) => normalizePortalUser(user));
      return {
        ...state,
        users,
        sessionUserId: resolveSessionUserId(users, state.sessionUserId),
      };
    }
    case "SET_SESSION":
      return {
        ...state,
        sessionUserId: resolveSessionUserId(state.users, action.payload.userId),
      };
    case "LOGOUT":
      return { ...state, sessionUserId: null };
    case "CREATE_STAFF": {
      const nextUser = normalizePortalUser({
        id: action.payload.id || createId("user"),
        role: "staff",
        status: action.payload.status || "active",
        statusChangedAt: action.payload.statusChangedAt || new Date().toISOString(),
        avatar: createAvatar(action.payload.name),
        bio: action.payload.bio || "Staff account",
        ...action.payload,
      });
      const nextState = {
        ...state,
        users: [nextUser, ...state.users],
      };

      return attachAudit(nextState, {
        actorName: action.meta.actorName,
        action: "Created portal account",
        module: "Authentication",
        detail: `${nextUser.name} was added to the appointment team.`,
        notification: {
          title: `${normalizeRoleLabel(nextUser.role)} account created`,
          message: `${nextUser.name} can now manage customer bookings and appointment updates.`,
          actorName: nextUser.name,
          actorRole: nextUser.role,
          actionLabel: "Created account",
          subjectName: nextUser.name,
          subjectRole: nextUser.role,
          targetType: "portal-account",
          targetId: nextUser.id,
          email: nextUser.email,
          phone: nextUser.phone,
          targetRoles: ["admin", "staff"],
          level: "success",
        },
      });
    }
    case "UPDATE_USER": {
      const users = state.users.map((user) =>
        user.id === action.payload.id
          ? (() => {
              const nextStatus = action.payload.updates.status || user.status;
              return normalizePortalUser({
                ...user,
                ...action.payload.updates,
                statusChangedAt:
                  nextStatus !== user.status
                    ? new Date().toISOString()
                    : action.payload.updates.statusChangedAt || user.statusChangedAt,
                avatar: createAvatar(action.payload.updates.name || user.name),
              });
            })()
          : user,
      );
      const nextState = {
        ...state,
        users,
        sessionUserId: resolveSessionUserId(users, state.sessionUserId),
      };

      return attachAudit(nextState, {
        actorName: action.meta.actorName,
        action: "Updated user account",
        module: "Manage Users",
        detail: "Employee account details were updated.",
      });
    }
    case "DELETE_USER": {
      const targetUser = state.users.find((user) => user.id === action.payload.id);
      const users = state.users.filter((user) => user.id !== action.payload.id);
      const nextState = {
        ...state,
        users,
        sessionUserId: resolveSessionUserId(users, state.sessionUserId),
      };

      return attachAudit(nextState, {
        actorName: action.meta.actorName,
        action: "Removed user account",
        module: "Authentication",
        detail: `${targetUser?.name || "An employee"} was permanently removed from portal access.`,
        notification: {
          title: "Employee account removed",
          message: `${targetUser?.name || "An employee"} was removed from the user list.`,
          actorName: targetUser?.name || "Portal user",
          actorRole: targetUser?.role || "staff",
          actionLabel: "Removed account",
          subjectName: targetUser?.name || "Portal user",
          subjectRole: targetUser?.role || "staff",
          targetType: "portal-account",
          targetId: targetUser?.id || "",
          email: targetUser?.email || "",
          phone: targetUser?.phone || "",
          targetRoles: ["admin", "staff"],
          level: "warning",
        },
      });
    }
    case "RESET_USER_PASSWORD": {
      const nextState = {
        ...state,
        users: state.users.map((user) =>
          user.id === action.payload.id
            ? normalizePortalUser({
                ...user,
                password: "",
                passwordHash: action.payload.passwordHash,
                passwordSalt: action.payload.passwordSalt,
                passwordVersion: action.payload.passwordVersion,
              })
            : user,
        ),
      };

      return attachAudit(nextState, {
        actorName: action.meta.actorName,
        action: "Reset password",
        module: "Authentication",
        detail: "Portal password was reset.",
      });
    }
    case "UPDATE_PROFILE":
      return {
        ...state,
        users: state.users.map((user) =>
          user.id === action.payload.id
            ? normalizePortalUser({
                ...user,
                ...action.payload.updates,
                avatar: createAvatar(action.payload.updates.name || user.name),
              })
            : user,
        ),
      };
    case "MARK_NOTIFICATION_READ":
      return {
        ...state,
        notifications: state.notifications.map((notification) =>
          notification.id === action.payload.notificationId
            ? {
                ...notification,
                readBy: notification.readBy.includes(action.payload.userId)
                  ? notification.readBy
                  : [...notification.readBy, action.payload.userId],
              }
            : notification,
        ),
      };
    case "MARK_ALL_NOTIFICATIONS_READ":
      return {
        ...state,
        notifications: state.notifications.map((notification) => ({
          ...notification,
          readBy: notification.readBy.includes(action.payload.userId)
            ? notification.readBy
            : [...notification.readBy, action.payload.userId],
        })),
      };
    case "CREATE_APPOINTMENT": {
      const nextAppointment = normalizeAppointment({
        id: createId("appt"),
        status: "Pending",
        reminderEnabled: true,
        createdAt: new Date().toISOString(),
        assignedStaff: "",
        ...action.payload,
      });
      const nextState = {
        ...state,
        appointments: [nextAppointment, ...state.appointments].sort((left, right) =>
          sortByNewest(left, right, ["updatedAt", "schedule"]),
        ),
      };

      return attachAudit(nextState, {
        actorName: action.meta.actorName || "Customer",
        action: "Booked appointment",
        module: "Manage Appointments",
        detail: `${nextAppointment.petName} was booked for ${nextAppointment.service}.`,
        notification: {
          title: "New appointment booking",
          message: `Appointment booked for ${nextAppointment.service} on ${nextAppointment.scheduleDate} at ${nextAppointment.scheduleTime}. Pet: ${nextAppointment.petName}. Customer: ${nextAppointment.ownerName}. Current status: ${nextAppointment.status}.`,
          actorName: nextAppointment.ownerName,
          actorRole: action.meta.actorRole || "customer",
          actionLabel: "Booked appointment",
          subjectName: nextAppointment.petName,
          subjectRole: "pet",
          targetType: "appointment",
          targetId: nextAppointment.id,
          targetUserId: nextAppointment.customerId,
          relatedAppointmentId: nextAppointment.id,
          appointmentDate: nextAppointment.scheduleDate,
          appointmentTime: nextAppointment.scheduleTime,
          serviceName: nextAppointment.service,
          petName: nextAppointment.petName,
          email: nextAppointment.customerEmail,
          targetRoles: ["admin", "staff", "customer"],
          level: "info",
        },
      });
    }
    case "UPDATE_APPOINTMENT": {
      const targetAppointment = state.appointments.find(
        (appointment) => appointment.id === action.payload.id,
      );
      const nextState = {
        ...state,
        appointments: state.appointments.map((appointment) =>
          appointment.id === action.payload.id
            ? normalizeAppointment({ ...appointment, ...action.payload.updates })
            : appointment,
        ).sort((left, right) => sortByNewest(left, right, ["updatedAt", "schedule"])),
      };
      const updatedAppointment =
        nextState.appointments.find((appointment) => appointment.id === action.payload.id) || null;

      return attachAudit(nextState, {
        actorName: action.meta.actorName,
        action: "Updated appointment",
        module: "Manage Appointments",
        detail: `${targetAppointment?.petName || "Appointment"} is now ${action.payload.updates.status || "updated"}.`,
        notification: action.payload.updates.status
          ? {
              title: "Appointment status updated",
              message: `${updatedAppointment?.petName || "An appointment"} was marked ${action.payload.updates.status}.`,
              actorName: action.meta.actorName || "Portal team",
              actorRole: action.meta.actorRole || "staff",
              actionLabel: "Updated appointment status",
              subjectName: updatedAppointment?.petName || targetAppointment?.petName || "",
              subjectRole: "pet",
              targetType: "appointment",
              targetId: updatedAppointment?.id || action.payload.id,
              targetUserId: updatedAppointment?.customerId || targetAppointment?.customerId || "",
              relatedAppointmentId: updatedAppointment?.id || action.payload.id,
              appointmentDate: updatedAppointment?.scheduleDate || "",
              appointmentTime: updatedAppointment?.scheduleTime || "",
              serviceName: updatedAppointment?.service || targetAppointment?.service || "",
              petName: updatedAppointment?.petName || targetAppointment?.petName || "",
              email: updatedAppointment?.customerEmail || targetAppointment?.customerEmail || "",
              targetRoles: ["admin", "staff", "customer"],
              level:
                action.payload.updates.status === "Completed" ? "success" : "info",
            }
          : null,
      });
    }
    case "LOG_CUSTOMER_ACCOUNT_CREATED": {
      const customer = action.payload.customer;

      return attachAudit({ ...state }, {
        actorName: customer.name,
        action: "Created customer account",
        module: "Customer Accounts",
        detail: `${customer.name} registered and can now book appointments.`,
        notification: {
          title: "Customer account created",
          message: `${customer.name} can now book appointments through the customer portal.`,
          actorName: customer.name,
          actorRole: "customer",
          actionLabel: "Created account",
          subjectName: customer.name,
          subjectRole: "customer",
          targetType: "customer-account",
          targetId: customer.id,
          email: customer.email,
          phone: customer.phone,
          targetRoles: ["admin", "staff"],
          level: "success",
        },
      });
    }
    case "SUBMIT_PHOTO_MODERATION": {
      const nextPhoto = normalizePhotoModeration({
        id: action.payload.id || createId("photo"),
        status: "pending",
        createdAt: new Date().toISOString(),
        ...action.payload,
      });
      const existing = state.photoModeration.some((photo) => photo.id === nextPhoto.id);

      return {
        ...state,
        photoModeration: existing
          ? state.photoModeration.map((photo) => (photo.id === nextPhoto.id ? nextPhoto : photo))
          : [nextPhoto, ...state.photoModeration],
      };
    }
    case "MODERATE_PHOTO": {
      const target = state.photoModeration.find((photo) => photo.id === action.payload.id);
      if (!target) {
        return state;
      }

      const status = action.payload.status === "approved" ? "approved" : "rejected";
      const subject = target.assetType === "profile" ? "profile photo" : `${target.subjectName}'s photo`;
      const nextPhoto = normalizePhotoModeration({
        ...target,
        status,
        moderationNote: action.payload.moderationNote || "",
        reviewedAt: new Date().toISOString(),
        reviewedBy: action.meta.actorName || "Administrator",
      });
      const nextState = {
        ...state,
        photoModeration: state.photoModeration.map((photo) =>
          photo.id === nextPhoto.id ? nextPhoto : photo,
        ),
        petRecords:
          status === "rejected" && target.assetType === "pet"
            ? state.petRecords.map((record) =>
                record.id === target.assetId
                  ? normalizePetRecord({ ...record, photoURL: "", photoModerationId: nextPhoto.id })
                  : record,
              )
            : state.petRecords,
      };

      return attachAudit(nextState, {
        actorName: action.meta.actorName || "Administrator",
        action: status === "approved" ? "Approved customer photo" : "Rejected customer photo",
        module: "Photo Moderation",
        detail: `${subject} was ${status}.`,
        notification: {
          title: status === "approved" ? "Photo Approved" : "Photo Rejected",
          message:
            status === "approved"
              ? "Admin approved your photo. It is now visible in your customer dashboard."
              : `Your ${target.assetType} photo was rejected and removed from your dashboard${nextPhoto.moderationNote ? `: ${nextPhoto.moderationNote}` : "."}`,
          actorName: action.meta.actorName || "Administrator",
          actorRole: "admin",
          actionLabel: status === "approved" ? "Approved photo" : "Rejected photo",
          subjectName: target.subjectName,
          subjectRole: target.assetType === "profile" ? "customer" : "pet",
          targetType: "photo-moderation",
          targetId: nextPhoto.id,
          targetUserId: target.ownerId,
          email: target.ownerEmail,
          targetRoles: ["customer"],
          level: status === "approved" ? "success" : "error",
        },
      });
    }
    case "UPSERT_PET_RECORD": {
      const nextRecord = normalizePetRecord({
        id: action.payload.id || createId("pet"),
        visitRecords: [],
        medicalRecords: [],
        notes: "",
        ...action.payload,
      });
      const exists = state.petRecords.some((record) => record.id === nextRecord.id);
      const nextState = {
        ...state,
        petRecords: exists
          ? state.petRecords.map((record) =>
              record.id === nextRecord.id ? nextRecord : record,
            ).sort((left, right) => sortByNewest(left, right, ["updatedAt", "lastVisit"]))
          : [nextRecord, ...state.petRecords].sort((left, right) =>
              sortByNewest(left, right, ["updatedAt", "lastVisit"]),
            ),
      };

      return attachAudit(nextState, {
        actorName: action.meta.actorName,
        action: exists ? "Updated pet record" : "Added pet record",
        module: "Manage Pet Records",
        detail: `${nextRecord.petName} was saved for ${nextRecord.ownerName}.`,
      });
    }
    case "DELETE_PET_RECORD": {
      const targetRecord = state.petRecords.find((record) => record.id === action.payload.id);
      const nextState = {
        ...state,
        petRecords: state.petRecords.filter((record) => record.id !== action.payload.id),
      };

      return attachAudit(nextState, {
        actorName: action.meta.actorName,
        action: "Deleted pet record",
        module: "Manage Pet Records",
        detail: `${targetRecord?.petName || "A pet"} was removed from records.`,
      });
    }
    case "UPSERT_AVAILABILITY_SLOT": {
      const nextSlot = {
        id: action.payload.id || createId("slot"),
        capacity: Number(action.payload.capacity) || 1,
        isOpen:
          typeof action.payload.isOpen === "boolean" ? action.payload.isOpen : true,
        ...action.payload,
      };
      const exists = state.availabilitySlots.some((slot) => slot.id === nextSlot.id);
      const nextState = {
        ...state,
        availabilitySlots: exists
          ? state.availabilitySlots.map((slot) =>
              slot.id === nextSlot.id ? nextSlot : slot,
            )
          : [...state.availabilitySlots, nextSlot].sort((left, right) =>
              `${left.date} ${left.time}`.localeCompare(`${right.date} ${right.time}`),
            ),
      };

      return attachAudit(nextState, {
        actorName: action.meta.actorName,
        action: exists ? "Updated availability slot" : "Created availability slot",
        module: "Manage Appointments",
        detail: `${nextSlot.date} at ${nextSlot.time} is ${nextSlot.isOpen ? "open" : "closed"} with capacity ${nextSlot.capacity}.`,
      });
    }
    case "DELETE_AVAILABILITY_SLOT": {
      const nextState = {
        ...state,
        availabilitySlots: state.availabilitySlots.filter(
          (slot) => slot.id !== action.payload.id,
        ),
      };

      return attachAudit(nextState, {
        actorName: action.meta.actorName,
        action: "Deleted availability slot",
        module: "Manage Appointments",
        detail: "An availability slot was removed from the booking calendar.",
      });
    }
    case "LOG_CHATBOT_INQUIRY": {
      const nextLog = {
        id: createId("chat"),
        createdAt: new Date().toISOString(),
        ...action.payload,
      };
      const nextState = {
        ...state,
        chatbotLogs: [nextLog, ...state.chatbotLogs].slice(0, 80),
      };

      return attachAudit(nextState, {
        actorName: "AI Chatbot",
        action: nextLog.recognized ? "Answered inquiry" : "Escalated unknown inquiry",
        module: "AI Chatbot",
        detail: nextLog.question,
      });
    }
    default:
      return state;
  }
}

export function AppProvider({ children }) {
  const {
    accessToken,
    currentUser: authenticatedUser,
    signOut: signOutFromAuth,
  } = useAuth();
  const [state, dispatch] = useReducer(appReducer, undefined, loadInitialState);
  const currentUser = authenticatedUser ? normalizeSessionUser(authenticatedUser) : null;

  useEffect(() => {
    persistState(state);
  }, [state]);

  useEffect(() => {
    if (!accessToken || !currentUser || !["admin", "staff"].includes(currentUser.role)) {
      return;
    }

    let cancelled = false;

    async function synchronizePortalUsers() {
      try {
        const response = await userApi.listUsers(accessToken, currentUser.role);
        if (cancelled) {
          return;
        }

        const users = response.users.map(normalizeApiPortalUser);

        dispatch({
          type: "SYNC_PORTAL_USERS",
          payload: { users },
        });
      } catch (error) {
        console.error("Unable to synchronize portal users from the backend.", error);
      }
    }

    synchronizePortalUsers();

    return () => {
      cancelled = true;
    };
  }, [accessToken, currentUser?.role, currentUser?.uid]);

  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key !== APP_STORAGE_KEY) {
        return;
      }

      if (!event.newValue) {
        dispatch({ type: "HYDRATE_STATE", payload: createSeedState() });
        return;
      }

      try {
        dispatch({
          type: "HYDRATE_STATE",
          payload: normalizeStoredState(JSON.parse(event.newValue)),
        });
      } catch (error) {
        console.error("Unable to hydrate synchronized browser state.", error);
        removeStorageItem(APP_STORAGE_KEY);
        dispatch({ type: "HYDRATE_STATE", payload: createSeedState() });
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    const legacyUsers = state.users.filter(
      (user) =>
        user &&
        typeof user === "object" &&
        typeof user.password === "string" &&
        user.password &&
        !user.passwordHash,
    );

    if (legacyUsers.length === 0) {
      return;
    }

    let cancelled = false;

    async function migrateLegacyPasswords() {
      try {
        const users = await Promise.all(
          state.users.map(async (user) => {
            if (
              !user ||
              typeof user !== "object" ||
              typeof user.password !== "string" ||
              !user.password ||
              user.passwordHash
            ) {
              return user;
            }

            const credentials = await createPasswordCredentials(user.password);
            return normalizePortalUser({
              ...user,
              ...credentials,
              password: "",
            });
          }),
        );

        if (cancelled) {
          return;
        }

        dispatch({
          type: "MIGRATE_USER_PASSWORDS",
          payload: { users },
        });
      } catch (error) {
        console.error("Unable to migrate legacy portal passwords.", error);
      }
    }

    migrateLegacyPasswords();

    return () => {
      cancelled = true;
    };
  }, [state]);

  const visibleNotifications = currentUser
    ? state.notifications
        .filter((notification) => isNotificationVisibleToUser(notification, currentUser))
        .sort(
          (left, right) =>
            (parseDateValue(right.createdAt)?.getTime() || 0) -
            (parseDateValue(left.createdAt)?.getTime() || 0),
        )
    : [];

  const refreshPortalUsers = useCallback(async () => {
    if (!accessToken || !currentUser || !["admin", "staff"].includes(currentUser.role)) {
      return [];
    }

    const response = await userApi.listUsers(accessToken, currentUser.role);
    const users = response.users.map(normalizeApiPortalUser);

    dispatch({
      type: "SYNC_PORTAL_USERS",
      payload: { users },
    });

    return users;
  }, [accessToken, currentUser?.role, currentUser?.uid]);

  async function validateCredentials(email, password, expectedRole) {
    const user = state.users.find(
      (candidate) => normalizeEmail(candidate.email) === normalizeEmail(email),
    );

    if (!user) {
      return { ok: false, error: "No account was found for that email." };
    }

    let passwordMatches = false;
    try {
      passwordMatches = await doesPasswordMatch(user, password);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to validate credentials.",
      };
    }

    if (!passwordMatches) {
      return { ok: false, error: "Incorrect password." };
    }

    if (user.status !== "active") {
      return {
        ok: false,
        error: `This account is ${formatPortalStatus(user.status).toLowerCase()}.`,
      };
    }

    if (expectedRole && user.role !== normalizePortalRole(expectedRole)) {
      return {
        ok: false,
        error: `This account is registered as ${user.role}, not ${expectedRole}.`,
      };
    }

    return { ok: true, user };
  }

  const value = {
    state,
    currentUser,
    visibleNotifications,
    accessibleModules: currentUser
      ? portalModules.filter(
          (module) => currentUser.role === "admin" || !module.adminOnly,
        )
      : [],
    async validateCredentials(email, password, expectedRole) {
      return {
        ok: false,
        error:
          "Credential validation now happens through the shared authentication service.",
      };
    },
    async signIn(email, password, expectedRole) {
      return {
        ok: false,
        error: "Sign-in is now handled through the shared authentication service.",
      };
    },
    signOut() {
      dispatch({ type: "LOGOUT" });
      return signOutFromAuth();
    },
    async resetUserPassword(email, newPassword, role) {
      return {
        ok: false,
        error:
          "Password resets should be handled through Firebase Authentication or an admin workflow.",
      };
    },
    async createStaff(payload) {
      if (currentUser?.role !== "admin") {
        return { ok: false, error: "Only administrators can create employee accounts." };
      }

      if (!accessToken) {
        return { ok: false, error: "Your session expired. Please sign in again." };
      }

      const name = typeof payload?.name === "string" ? payload.name.trim() : "";
      const email = normalizeEmail(payload?.email || "");
      const username = normalizeUsername(payload?.username || "");
      const password = typeof payload?.password === "string" ? payload.password.trim() : "";
      const role = normalizePortalRole(payload?.role || "staff");
      const status = normalizePortalStatus(payload?.status || "active");

      if (!name || !email || !username || !password) {
        return { ok: false, error: "Name, email, username, password, and role are required." };
      }

      if (!isValidUsername(username)) {
        return {
          ok: false,
          error:
            "Username must be 3-24 characters and use only lowercase letters, numbers, dots, underscores, or hyphens.",
        };
      }

      if (!isStrongPassword(password)) {
        return {
          ok: false,
          error:
            "Password must be at least 8 characters and include uppercase, lowercase, number, and special character.",
        };
      }

      try {
        const response = await userApi.createUser(accessToken, {
          fullName: name,
          email,
          username,
          password,
          phone: typeof payload?.phone === "string" ? payload.phone.trim() : "",
          role,
          status,
        });
        const createdUser = response.user;
        const userId = createdUser.uid || createdUser.id;

        dispatch({
          type: "CREATE_STAFF",
          payload: {
            ...createdUser,
            id: userId,
            name: createdUser.fullName || createdUser.name,
          },
          meta: {
            actorName: currentUser?.name || "Admin",
            actorRole: currentUser?.role || "admin",
          },
        });
        await refreshPortalUsers();

        return {
          ok: true,
          id: userId,
          user: {
            ...createdUser,
            id: userId,
            name: createdUser.fullName || createdUser.name,
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Unable to create the employee account.",
        };
      }
    },
    async updateUser(id, updates) {
      if (currentUser?.role !== "admin") {
        return { ok: false, error: "Only administrators can update employee accounts." };
      }

      if (!accessToken) {
        return { ok: false, error: "Your session expired. Please sign in again." };
      }

      const targetUser = state.users.find((user) => user.id === id);
      if (!targetUser) {
        return { ok: false, error: "That employee account no longer exists." };
      }

      const normalizedEmail = updates.email
        ? normalizeEmail(updates.email)
        : targetUser.email;
      const normalizedUsername = updates.username
        ? normalizeUsername(updates.username)
        : normalizeUsername(targetUser.username);
      const normalizedRole = updates.role
        ? normalizePortalRole(updates.role)
        : targetUser.role;
      const normalizedStatus = updates.status
        ? normalizePortalStatus(updates.status)
        : targetUser.status;
      const nextName = updates.name ? updates.name.trim() : targetUser.name;
      const nextPassword =
        typeof updates.password === "string" ? updates.password.trim() : "";

      if (!nextName || !normalizedEmail) {
        return { ok: false, error: "Name and email are required." };
      }

      if (!normalizedUsername || !isValidUsername(normalizedUsername)) {
        return {
          ok: false,
          error:
            "Username must be 3-24 characters and use only lowercase letters, numbers, dots, underscores, or hyphens.",
        };
      }

      if (currentUser.id === id) {
        if (normalizedStatus !== "active") {
          return { ok: false, error: "You cannot deactivate or suspend your own active admin session." };
        }

        if (normalizedRole !== "admin") {
          return { ok: false, error: "You cannot remove admin access from your current session." };
        }
      }

      if (nextPassword && !isStrongPassword(nextPassword)) {
        return {
          ok: false,
          error:
            "Password must be at least 8 characters and include uppercase, lowercase, number, and special character.",
        };
      }

      try {
        const response = await userApi.updateUser(accessToken, id, {
          fullName: nextName,
          email: normalizedEmail,
          username: normalizedUsername,
          phone:
            typeof updates.phone === "string"
              ? updates.phone.trim()
              : typeof targetUser.phone === "string"
                ? targetUser.phone
                : "",
          role: normalizedRole,
          status: normalizedStatus,
          password: nextPassword || undefined,
        });

        dispatch({
          type: "UPDATE_USER",
          payload: {
            id,
            updates: {
              ...response.user,
              id: response.user.uid || response.user.id,
              name: response.user.fullName || response.user.name,
            },
          },
          meta: { actorName: currentUser?.name || "Admin" },
        });
        await refreshPortalUsers();

        return {
          ok: true,
          user: {
            ...response.user,
            id: response.user.uid || response.user.id,
            name: response.user.fullName || response.user.name,
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Unable to update the employee account.",
        };
      }
    },
    async deleteUser(id) {
      if (currentUser?.role !== "admin") {
        return { ok: false, error: "Only administrators can delete employee accounts." };
      }

      if (!accessToken) {
        return { ok: false, error: "Your session expired. Please sign in again." };
      }

      const targetUser = state.users.find((user) => user.id === id);
      if (!targetUser) {
        return { ok: false, error: "That employee account no longer exists." };
      }

      if (currentUser.id === id) {
        return { ok: false, error: "You cannot delete the account you are currently using." };
      }

      try {
        await userApi.deleteUser(accessToken, id);
        dispatch({
          type: "DELETE_USER",
          payload: { id },
          meta: { actorName: currentUser?.name || "Admin" },
        });
        await refreshPortalUsers();
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Unable to delete the employee account.",
        };
      }

      return { ok: true };
    },
    updateProfile(updates) {
      if (!currentUser) {
        return;
      }

      dispatch({
        type: "UPDATE_PROFILE",
        payload: {
          id: currentUser.id,
          updates: {
            ...updates,
            email: updates.email ? normalizeEmail(updates.email) : currentUser.email,
          },
        },
      });
    },
    submitPhotoForReview(payload) {
      const nextPhoto = normalizePhotoModeration({
        id: payload?.id || createId("photo"),
        status: "pending",
        createdAt: new Date().toISOString(),
        ...payload,
      });

      dispatch({ type: "SUBMIT_PHOTO_MODERATION", payload: nextPhoto });
      return savePhotoModerationDocument(nextPhoto).then(() => nextPhoto);
    },
    moderatePhoto(id, status, moderationNote = "") {
      if (!currentUser || currentUser.role !== "admin") {
        return Promise.resolve({ ok: false, error: "Only administrators can review photos." });
      }

      const photo = state.photoModeration.find((record) => record.id === id);
      if (!photo) {
        return Promise.resolve({ ok: false, error: "That photo is no longer in the review queue." });
      }

      dispatch({
        type: "MODERATE_PHOTO",
        payload: { id, status, moderationNote },
        meta: { actorName: currentUser.name || "Administrator" },
      });

      const nextPhoto = normalizePhotoModeration({
        ...photo,
        status: status === "approved" ? "approved" : "rejected",
        moderationNote,
        reviewedAt: new Date().toISOString(),
        reviewedBy: currentUser.name || "Administrator",
      });

      return savePhotoModerationDocument(nextPhoto).then(() => ({ ok: true, photo: nextPhoto }));
    },
    markNotificationRead(notificationId) {
      if (!currentUser) {
        return;
      }

      dispatch({
        type: "MARK_NOTIFICATION_READ",
        payload: { notificationId, userId: currentUser.id },
      });
    },
    markAllNotificationsRead() {
      if (!currentUser) {
        return;
      }

      dispatch({
        type: "MARK_ALL_NOTIFICATIONS_READ",
        payload: { userId: currentUser.id },
      });
    },
    getPendingAppointmentCount(customerId, customerEmail) {
      return countPendingAppointments(state.appointments, customerId, customerEmail);
    },
    createAppointment(payload, actorName) {
      const pendingAppointmentCount = countPendingAppointments(
        state.appointments,
        payload?.customerId,
        payload?.customerEmail,
      );

      if (pendingAppointmentCount >= MAX_PENDING_APPOINTMENTS_PER_ACCOUNT) {
        const error = new Error(
          "Booking limit reached. You can have up to 2 pending appointments at a time.",
        );
        error.code = "PENDING_APPOINTMENT_LIMIT";
        throw error;
      }

      const nextAppointment = normalizeAppointment({
        id: payload.id || createId("appt"),
        status: "Pending",
        reminderEnabled: true,
        createdAt: new Date().toISOString(),
        assignedStaff: "",
        ...payload,
      });

      dispatch({
        type: "CREATE_APPOINTMENT",
        payload: nextAppointment,
        meta: {
          actorName: actorName || currentUser?.name || "Customer",
          actorRole: currentUser?.role || "customer",
        },
      });
      return saveAppointmentDocument(nextAppointment);
    },
    updateAppointment(id, updates, actorName) {
      const existingAppointment = state.appointments.find((appointment) => appointment.id === id);
      const nextAppointment = existingAppointment
        ? normalizeAppointment({ ...existingAppointment, ...updates })
        : null;

      dispatch({
        type: "UPDATE_APPOINTMENT",
        payload: { id, updates },
        meta: {
          actorName: actorName || currentUser?.name || "System User",
          actorRole: currentUser?.role || "customer",
        },
      });

      if (nextAppointment) {
        return saveAppointmentDocument(nextAppointment);
      }

      return Promise.resolve(false);
    },
    savePetRecord(payload, actorName) {
      const existingRecord = state.petRecords.find((record) => record.id === payload.id);
      const hasNewPhoto = Boolean(payload.photoURL) && payload.photoURL !== existingRecord?.photoURL;
      const photoModerationId = hasNewPhoto ? createId("photo") : payload.photoModerationId || existingRecord?.photoModerationId || "";
      const nextRecord = normalizePetRecord({
        id: payload.id || createId("pet"),
        visitRecords: [],
        medicalRecords: [],
        notes: "",
        ...payload,
        photoModerationId,
      });

      if (hasNewPhoto) {
        const nextPhoto = normalizePhotoModeration({
          id: photoModerationId,
          assetType: "pet",
          assetId: nextRecord.id,
          ownerId: nextRecord.customerId,
          ownerEmail: nextRecord.customerEmail,
          ownerName: nextRecord.ownerName,
          subjectName: nextRecord.petName,
          photoURL: nextRecord.photoURL,
          status: "pending",
          createdAt: new Date().toISOString(),
        });
        dispatch({ type: "SUBMIT_PHOTO_MODERATION", payload: nextPhoto });
        void savePhotoModerationDocument(nextPhoto);
      }

      dispatch({
        type: "UPSERT_PET_RECORD",
        payload: nextRecord,
        meta: { actorName: actorName || currentUser?.name || "Customer" },
      });
      return savePetRecordDocument(nextRecord);
    },
    deletePetRecord(id, actorName) {
      dispatch({
        type: "DELETE_PET_RECORD",
        payload: { id },
        meta: { actorName: actorName || currentUser?.name || "System User" },
      });
      return deletePetRecordDocument(id);
    },
    saveAvailabilitySlot(payload) {
      const nextSlot = {
        id: payload.id || createId("slot"),
        capacity: Number(payload.capacity) || 1,
        isOpen: typeof payload.isOpen === "boolean" ? payload.isOpen : true,
        ...payload,
      };

      dispatch({
        type: "UPSERT_AVAILABILITY_SLOT",
        payload: nextSlot,
        meta: { actorName: currentUser?.name || "Staff" },
      });
      return saveAvailabilitySlotDocument(nextSlot);
    },
    deleteAvailabilitySlot(id) {
      dispatch({
        type: "DELETE_AVAILABILITY_SLOT",
        payload: { id },
        meta: { actorName: currentUser?.name || "Staff" },
      });
      return deleteAvailabilitySlotDocument(id);
    },
    logChatbotInquiry(payload) {
      dispatch({
        type: "LOG_CHATBOT_INQUIRY",
        payload,
      });
    },
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error("useApp must be used within AppProvider");
  }

  return context;
}
