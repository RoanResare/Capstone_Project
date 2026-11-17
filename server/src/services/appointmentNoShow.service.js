const { db } = require("../config/postgresDatabase");

const ACTIVE_BOOKING_STATUSES = [
  "Pending", "Approved", "Accepted", "Confirmed",
  "pending", "approved", "accepted", "confirmed",
];
const NO_SHOW_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const NO_SHOW_BATCH_SIZE = 200;

async function resolveCustomerEmail(appointment) {
  if (appointment.customerEmail) return appointment.customerEmail;
  if (!appointment.customerId) return "";
  const direct = await db.collection("users").doc(String(appointment.customerId)).get();
  if (direct.exists && direct.data()?.email) return direct.data().email;
  const linked = await db.collection("users").where("authUserId", "==", String(appointment.customerId)).limit(1).get();
  if (!linked.empty && linked.docs[0].data()?.email) return linked.docs[0].data().email;
  const legacy = await db.collection("users").where("uid", "==", String(appointment.customerId)).limit(1).get();
  return legacy.empty ? "" : legacy.docs[0].data()?.email || "";
}

function clinicDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function hasAppointmentDayPassed(appointment, today) {
  const date = String(appointment.scheduleDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const scheduledDay = new Date(`${date}T00:00:00+08:00`);
  if (!Number.isFinite(scheduledDay.getTime()) || clinicDate(scheduledDay) !== date) return false;
  return date < today;
}

async function markAppointmentNoShow(entry, now) {
  const appointmentRef = entry.ref;
  return db.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(appointmentRef);
    if (!currentSnapshot.exists) return false;
    const current = currentSnapshot.data() || {};
    if (!ACTIVE_BOOKING_STATUSES.includes(current.status) || current.sessionStartedAt || current.sessionEndedAt ||
        !hasAppointmentDayPassed(current, clinicDate(now))) return false;

    const slotRef = current.slotId ? db.collection("availabilitySlots").doc(current.slotId) : null;
    const slotSnapshot = slotRef ? await transaction.get(slotRef) : null;
    const customerId = current.customerId || "";
    const notificationRef = db.collection("notifications").doc(`appointment-${entry.id}-no-show`);
    const customerEmail = await resolveCustomerEmail(current);
    const updatedAt = now.toISOString();
    const lifecycleEvents = Array.isArray(current.lifecycleEvents) ? current.lifecycleEvents : [];
    transaction.update(appointmentRef, { status: "No Show", updatedAt, lifecycleEvents: [...lifecycleEvents, {
      status: "No Show", action: "Appointment marked No Show", changedFields: ["status"],
      actorId: "system", actorName: "Automatic appointment monitor", actorRole: "system", createdAt: updatedAt,
    }] });
    if (slotRef && slotSnapshot?.exists) {
      transaction.set(slotRef, {
        reservationVersion: (Number(slotSnapshot.data()?.reservationVersion) || 0) + 1,
        reservationUpdatedAt: updatedAt,
      }, { merge: true });
    }
    if (customerId) {
      transaction.set(notificationRef, {
        id: notificationRef.id,
        title: "Appointment marked No Show",
        message: `${current.petName || "Your pet"}'s appointment was marked No Show because the scheduled day passed without a session being started.`,
        targetRoles: ["customer"],
        targetUserId: customerId,
        email: customerEmail,
        targetType: "appointment",
        targetId: entry.id,
        relatedAppointmentId: entry.id,
        petName: current.petName || "",
        serviceName: current.service || "",
        appointmentDate: current.scheduleDate || "",
        appointmentTime: current.scheduleTime || "",
        actorName: "Automatic appointment monitor",
        actorRole: "system",
        level: "info",
        readBy: [],
        createdAt: updatedAt,
      }, { merge: true });
    }
    return true;
  });
}

async function markPastAppointmentsNoShow(now = new Date()) {
  const today = clinicDate(now);
  let cursor = null;
  let changed = 0;
  while (true) {
    let dueQuery = db.collection("appointments")
      .where("status", "in", ACTIVE_BOOKING_STATUSES)
      .where("scheduleDate", "<", today)
      .orderBy("scheduleDate", "asc")
      .limit(NO_SHOW_BATCH_SIZE);
    if (cursor) dueQuery = dueQuery.startAfter(cursor);
    const snapshot = await dueQuery.get();
    if (snapshot.empty) break;
    for (const entry of snapshot.docs) {
      const data = entry.data() || {};
      if (data.sessionStartedAt || data.sessionEndedAt || !hasAppointmentDayPassed(data, today)) continue;
      if (await markAppointmentNoShow(entry, now)) changed += 1;
    }
    if (snapshot.size < NO_SHOW_BATCH_SIZE) break;
    cursor = snapshot.docs.at(-1);
  }
  if (changed) console.info("[appointments] Marked past bookings as No Show.", { count: changed });
  return changed;
}

function startAppointmentNoShowUpdates() {
  const run = () => markPastAppointmentsNoShow().catch((error) => {
    console.warn("[appointments] Automatic No Show update failed.", { error: error.message });
  });
  void run();
  const timer = setInterval(run, NO_SHOW_CHECK_INTERVAL_MS);
  timer.unref();
  return timer;
}

module.exports = { clinicDate, hasAppointmentDayPassed, markPastAppointmentsNoShow, startAppointmentNoShowUpdates };
