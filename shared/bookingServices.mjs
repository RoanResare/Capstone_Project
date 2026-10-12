const durations = {
  vaccination: 30,
  deworming: 20,
  consultation: 45,
  "laboratory-testing": 60,
  "low-cost-kapon": 90,
  "pet-grooming": 60,
};

export const APPOINTMENT_BLOCK_MINUTES = 120;

function validateServiceSelection(serviceIds) {
  if (!Array.isArray(serviceIds) || serviceIds.length < 1 || serviceIds.length > 2) {
    throw new Error("Select one or two services for each appointment.");
  }
  if (serviceIds.some((id) => !Object.hasOwn(durations, id))) throw new Error("Select a valid service.");
  if (new Set(serviceIds).size !== serviceIds.length) throw new Error("The same service cannot be selected twice for one appointment.");
  return serviceIds;
}

export function validateServiceIds(serviceIds) {
  validateServiceSelection(serviceIds);
  if (serviceIds.includes("laboratory-testing") && serviceIds.includes("pet-grooming")) {
    throw new Error("Laboratory Testing and Pet Grooming cannot be booked in the same appointment.");
  }
  return serviceIds;
}

export function getEstimatedDuration(serviceIds) {
  return validateServiceSelection(serviceIds).reduce((total, id) => total + durations[id], 0);
}

export function validateAppointmentServices(serviceIds) {
  validateServiceIds(serviceIds);
  if (getEstimatedDuration(serviceIds) > APPOINTMENT_BLOCK_MINUTES) {
    throw new Error("The selected services exceed the 120-minute appointment block. Please book them separately.");
  }
  return serviceIds;
}

export function canPairServices(first, second) {
  if (!first || !second) return true;
  try { validateAppointmentServices([first, second]); return true; }
  catch { return false; }
}

export function getDefaultBlockCapacity(time) {
  return { "09:00": 3, "11:00": 3, "14:00": 2, "16:00": 2 }[String(time || "").slice(0, 5)];
}

export function getBlockCapacity(slot) {
  const limit = getDefaultBlockCapacity(slot.time);
  const configured = Number(slot.capacity) || limit || 1;
  return Math.max(Math.min(configured, limit || configured), 1);
}

export function matchesAppointmentBlock(appointment, slot) {
  return appointment.slotId === slot.id || Boolean(slot.date && slot.time && appointment.scheduleDate === slot.date &&
    appointment.scheduleTime?.slice(0, 5) === slot.time.slice(0, 5));
}

export function validateSinglePet(appointment) {
  const petIds = [appointment.petRecordId,
    ...(Array.isArray(appointment.petRecordIds) ? appointment.petRecordIds : []),
    ...(Array.isArray(appointment.petSnapshots) ? appointment.petSnapshots.map((pet) => pet?.id) : []),
    appointment.petSnapshot?.id].filter(Boolean);
  if (!appointment.petRecordId || new Set(petIds).size !== 1) {
    throw new Error("Each appointment must be associated with exactly one pet profile.");
  }
}

export function getAppointmentInterval(appointment) {
  const ids = appointment.serviceIds || (appointment.serviceId ? [appointment.serviceId] :
    Object.keys(durations).filter((id) => id.replaceAll("-", "") === String(appointment.service || "").toLowerCase().replace(/[^a-z0-9]/g, "")));
  let duration;
  try { duration = getEstimatedDuration(ids); }
  catch { return null; }
  const start = appointment.scheduleDate && appointment.scheduleTime
    ? Date.parse(`${appointment.scheduleDate}T${String(appointment.scheduleTime).slice(0, 5)}:00+08:00`)
    : Date.parse(appointment.schedule);
  return Number.isFinite(start) ? { start, end: start + Math.max(duration, APPOINTMENT_BLOCK_MINUTES) * 60000 } : null;
}

export function appointmentsOverlap(first, second) {
  const left = getAppointmentInterval(first);
  const right = getAppointmentInterval(second);
  return Boolean(left && right && left.start < right.end && right.start < left.end);
}
