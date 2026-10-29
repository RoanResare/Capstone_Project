const { randomUUID } = require("node:crypto");

const SLOT_LABELS = { "09:00": "09:00 AM", "11:00": "11:00 AM", "14:00": "02:00 PM", "16:00": "04:00 PM" };
const ACTIVE = ["approved", "accepted", "confirmed"];
const HOUR = 60 * 60 * 1000;

function normalizeScheduleTime(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (!match) return "";
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (match[3]) hours = (hours % 12) + (match[3].toUpperCase() === "PM" ? 12 : 0);
  if (hours > 23 || minutes > 59) return "";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatScheduleTime(value) {
  const normalized = normalizeScheduleTime(value);
  if (!normalized) return "the scheduled time";
  const [hours, minutes] = normalized.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${period}`;
}

function reminderSchedule(appointment) {
  const date = appointment.scheduleDate;
  const time = normalizeScheduleTime(appointment.scheduleTime);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !time) return null;
  const startsAt = Date.parse(`${date}T${time}:00+08:00`);
  if (!Number.isFinite(startsAt) || new Date(startsAt + 8 * HOUR).toISOString().slice(0, 10) !== date) return null;
  return { startsAt, dueAt: startsAt - HOUR, key: `${date}-${time.replace(":", "")}` };
}

function isDue(appointment, now) {
  const schedule = reminderSchedule(appointment);
  return Boolean(schedule && appointment.reminderEnabled === true &&
    ACTIVE.includes(String(appointment.status).trim().toLowerCase()) && !appointment.sessionStartedAt &&
    now >= schedule.dueAt && now < schedule.startsAt);
}

function createReminderWorker({ db, sendReminder, clock = Date.now }) {
  async function run() {
    const today = new Date(clock() + 8 * HOUR).toISOString().slice(0, 10);
    // The PostgreSQL adapter compiles this bounded query against the appointments table.
    const snapshot = await db.collection("appointments").where("scheduleDate", "==", today).get();
    for (const entry of snapshot.docs) {
      try {
      const entryData = entry.data() || {};
      if (!isDue(entryData, clock())) continue;
      const schedule = reminderSchedule(entryData);
      const deliveryRef = db.collection("appointmentReminders").doc(`${entry.id}-${schedule.key}`);
      const token = randomUUID();
      let appointment;
      // Claim in a PostgreSQL transaction so overlapping checks and replicas share one lease.
      await db.runTransaction(async (tx) => {
        appointment = null;
        const current = await tx.get(entry.ref);
        const delivery = await tx.get(deliveryRef);
        const data = current.data();
        const state = delivery.data() || {};
        if (!current.exists || !isDue(data, clock()) || reminderSchedule(data).key !== schedule.key ||
            state.sentAt || state.leaseUntil > clock() || state.retryAt > clock()) return;
        tx.set(deliveryRef, { token, leaseUntil: clock() + 5 * 60 * 1000, attempts: (state.attempts || 0) + 1,
          lastAttemptAt: new Date(clock()).toISOString() }, { merge: true });
        appointment = data;
      });
      if (!appointment) continue;
      try {
        // Email is sourced from the current PostgreSQL user profile so reminders
        // keep working for accounts linked to Supabase after the migration.
        if (!appointment.customerEmail && appointment.customerId) {
          const profile = await db.collection("users").doc(String(appointment.customerId)).get();
          appointment = { ...appointment, customerEmail: profile.data()?.email || "" };
        }
        if (!appointment.customerEmail && appointment.customerId) {
          const profiles = await db.collection("users").where("authUserId", "==", String(appointment.customerId)).limit(1).get();
          if (!profiles.empty) appointment = { ...appointment, customerEmail: profiles.docs[0].data()?.email || "" };
          if (!appointment.customerEmail) {
            const byLegacyUid = await db.collection("users").where("uid", "==", String(appointment.customerId)).limit(1).get();
            if (!byLegacyUid.empty) appointment = { ...appointment, customerEmail: byLegacyUid.docs[0].data()?.email || "" };
          }
        }
        if (!appointment.customerEmail && appointment.customerEmailAddress) appointment.customerEmail = appointment.customerEmailAddress;
        if (!appointment.customerEmail) throw Object.assign(new Error("Appointment customer profile has no email address."), { code: "REMINDER_PROFILE_EMAIL_MISSING" });
        const result = await sendReminder(appointment, `${entry.id}-${schedule.key}`);
        if (!result?.messageId) throw Object.assign(new Error("Reminder email has no Resend delivery ID."), { code: "MISSING_DELIVERY_ID" });
        await db.runTransaction(async (tx) => {
          const current = await tx.get(deliveryRef);
          if (current.data()?.token === token) tx.set(deliveryRef, {
            sentAt: new Date(clock()).toISOString(), messageId: result.messageId, leaseUntil: 0,
            retryAt: 0, lastErrorCode: "",
          }, { merge: true });
        });
        console.info("[appointment-reminder] Email accepted by Resend.", { appointmentId: entry.id, messageId: result.messageId });
      } catch (error) {
        console.error("[appointment-reminder] Delivery failed.", { appointmentId: entry.id, error: error.message });
        await db.runTransaction(async (tx) => {
          const current = await tx.get(deliveryRef);
          if (current.data()?.token === token) tx.set(deliveryRef, { leaseUntil: 0, retryAt: clock() + 60000,
            lastErrorCode: error?.details?.providerCode || error.code || "REMINDER_DELIVERY_FAILED" }, { merge: true });
        });
      }
      } catch (error) {
        // A broken appointment/lease must not prevent reminders for other customers.
        console.error("[appointment-reminder] Appointment processing failed.", { appointmentId: entry.id, error: error.message });
      }
    }
  }
  return { run };
}

function startAppointmentReminders() {
  const { db } = require("../config/firebaseAdmin");
  if (!db || db.provider !== "postgres") {
    throw new Error("Appointment reminders require the PostgreSQL database adapter.");
  }
  const { sendAppointmentReminder } = require("./reminderMail.service");
  const worker = createReminderWorker({ db, sendReminder: sendAppointmentReminder });
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await worker.run(); }
    catch (error) { console.error("[appointment-reminder] Check failed.", { error: error.message }); }
    finally { running = false; }
  };
  void run();
  // Align checks to wall-clock minutes, including the exact reminder hour.
  let timer;
  const schedule = () => {
    timer = setTimeout(async () => { await run(); schedule(); }, 60000 - Date.now() % 60000);
    timer.unref();
  };
  schedule();
  return { stop: () => clearTimeout(timer) };
}

module.exports = { SLOT_LABELS, normalizeScheduleTime, formatScheduleTime, reminderSchedule, isDue, createReminderWorker, startAppointmentReminders };
