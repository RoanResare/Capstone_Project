const { randomUUID } = require("node:crypto");

const TYPE = "appointment-status-email";
const COLLECTION = "appointmentReminders"; // Existing private delivery ledger; never browser writable.
const LEASE_MS = 5 * 60 * 1000;
const RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
const WEBSITE = "https://www.charmingfurfectionpetscareservices.online";
const canonicalStatus = value => ({ accepted: "Approved", confirmed: "Approved", approved: "Approved", pending: "Pending", rejected: "Rejected", cancelled: "Cancelled", canceled: "Cancelled" })[String(value || "").trim().toLowerCase()] || value;

function queueStatusEmail({ db, transaction, previous, appointment, actor, reason = "", clock = Date.now }) {
  const from = canonicalStatus(previous?.status);
  const status = canonicalStatus(appointment.status);
  if (!previous || !["admin", "staff"].includes(actor.role) || from === status ||
      !(from === "Pending" && ["Approved", "Rejected", "Cancelled"].includes(status) || from === "Approved" && status === "Cancelled")) return null;
  const eventId = randomUUID();
  transaction.set(db.collection(COLLECTION).doc(`status-mail-${eventId}`), {
    notificationType: TYPE, eventId, appointmentId: appointment.id,
    customerId: previous.customerId || "", fromStatus: from, status,
    actorId: actor.uid, actorRole: actor.role,
    // Only committed, customer-facing details. Never store request email, notes or medical records.
    details: { petName: appointment.petName || "", service: appointment.service || "",
      scheduleDate: appointment.scheduleDate || "", scheduleTime: appointment.scheduleTime || "", reason },
    deliveryState: "pending", attempts: 0, retryAt: clock(), leaseUntil: 0,
    createdAt: new Date(clock()).toISOString(),
  });
  return { eventId, state: "pending" };
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
function buildStatusEmail(job) {
  const { formatScheduleTime, normalizeScheduleTime } = require("./appointmentReminder.service");
  const details = job.details;
  let date = details.scheduleDate || "Not recorded";
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00+08:00`)) && new Date(Date.parse(`${date}T00:00:00+08:00`) + 28800000).toISOString().slice(0, 10) === date) {
    date = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "long" }).format(new Date(`${date}T00:00:00+08:00`));
  }
  const match = /^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i.exec(String(details.scheduleTime || "").trim());
  const validTime = match && Number(match[2]) < 60 && (match[3] ? Number(match[1]) >= 1 && Number(match[1]) <= 12 : Number(match[1]) <= 23);
  const time = validTime && normalizeScheduleTime(details.scheduleTime) ? formatScheduleTime(details.scheduleTime) : details.scheduleTime || "Not recorded";
  const approved = job.status === "Approved", rejected = job.status === "Rejected";
  const subject = approved ? "Your Pet Appointment Is Confirmed! | Charming Fur-fection"
    : rejected ? "Update on Your Appointment Request | Charming Fur-fection"
      : "Your Appointment Has Been Cancelled | Charming Fur-fection";
  const introduction = approved ? "Good news!\n\nYour appointment at Charming Fur-fection Pet Care Services has been approved."
    : rejected ? "Hello!\n\nWe're sorry, but your appointment request at Charming Fur-fection Pet Care Services was not approved."
      : "Hello!\n\nYour appointment at Charming Fur-fection Pet Care Services has been cancelled.";
  const ending = approved ? "We look forward to seeing you and your pet!"
    : rejected ? "You may submit a new appointment request through our website.\n\nThank you for understanding."
      : "Please do not visit the clinic for this cancelled appointment.\n\nIf you still need the service, you may book another appointment through our website.\n\nThank you for understanding.";
  const text = `${introduction}\n\nAppointment Details:\n- Pet Name: ${details.petName || "Not recorded"}\n- Service: ${details.service || "Not recorded"}\n- ${rejected ? "Requested Date" : "Date"}: ${date}\n- ${rejected ? "Requested Time" : "Time"}: ${time} (Philippine time, Asia/Manila)\n- Status: ${job.status}${details.reason ? `\n\nReason: ${details.reason}` : ""}\n\n${ending}\n\nCharming Fur-fection Pet Care Services\n${WEBSITE}`;
  const html = `<html lang="en"><body style="margin:0;background:#f4f0e8;font-family:Arial,sans-serif;color:#20343b"><main style="max-width:560px;margin:24px auto;padding:24px;background:white;border-radius:20px"><h1 style="font-size:22px;color:#173e44">Appointment ${job.status.toLowerCase()}</h1><p style="font-size:16px;line-height:1.7">${escapeHtml(text).replace(/\n/g, "<br>")}</p><a style="color:#173e44" href="${WEBSITE}">Visit our website</a></main></body></html>`;
  return { subject, text, html };
}

const recipientError = code => Object.assign(new Error("Customer email is not eligible for this notification."), { code });
async function resolveCustomerRecipient(db, customerId) {
  if (!customerId) throw recipientError("RECIPIENT_MISSING");
  let profile = (await db.collection("users").doc(customerId).get()).data();
  if (!profile) {
    for (const field of ["uid", "authUserId"]) {
      const matches = await db.collection("users").where(field, "==", customerId).limit(2).get();
      if (matches.docs.length > 1) throw recipientError("RECIPIENT_AMBIGUOUS");
      if (matches.docs.length) { profile = matches.docs[0].data(); break; }
    }
  }
  if (!profile || profile.role !== "customer" || (profile.accountStatus || profile.status || "active") !== "active" ||
      ["suspended", "banned"].includes(profile.fraudStatus)) throw recipientError("RECIPIENT_INELIGIBLE");
  const email = String(profile.email || "").trim().toLowerCase();
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email)) throw recipientError("RECIPIENT_INVALID_EMAIL");
  if (profile.authUserId) {
    const { getSupabaseUserById } = require("./supabaseAuth.service");
    const result = await getSupabaseUserById(profile.authUserId);
    const user = result?.user || result;
    if (!user?.email_confirmed_at || String(user.email || "").toLowerCase() !== email) throw recipientError("RECIPIENT_UNVERIFIED");
  } else if (profile.emailVerified !== true || profile.verificationStatus === "pending") {
    throw recipientError("RECIPIENT_UNVERIFIED");
  }
  return email;
}

function createStatusEmailWorker({ db, clock = Date.now, resolveRecipient = id => resolveCustomerRecipient(db, id),
  makeEnvelope = (job, to) => {
    const { env } = require("../config/env");
    return { ...buildStatusEmail(job), to, fromName: env.mail.fromName, fromEmail: env.mail.fromEmail,
      messageId: `<appointment-status-${job.eventId}@${env.mail.fromEmail.split("@")[1]}>` };
  }, send = payload => require("../config/mailer").sendMail(payload),
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)), batchSize = 10 } = {}) {
  let running = false;
  let requested = false;
  async function processJob(ref) {
    const token = randomUUID();
    let job;
    let nextRunAt = Infinity;
    await db.runTransaction(async tx => {
      job = null;
      const current = (await tx.get(ref)).data();
      if (!current || current.notificationType !== TYPE || current.deliveryState !== "pending") return;
      if (current.retryAt > clock() || current.leaseUntil > clock()) { nextRunAt = Math.max(current.retryAt, current.leaseUntil); return; }
      if (current.attempts >= 8 || current.firstAttemptAt && clock() - current.firstAttemptAt >= RETRY_WINDOW_MS) {
        tx.set(ref, { deliveryState: "needs_review", lastErrorCode: "RETRY_LIMIT", failedAt: new Date(clock()).toISOString(), leaseUntil: 0 }, { merge: true });
        return;
      }
      job = { ...current, token, firstAttemptAt: current.firstAttemptAt || clock(), attempts: current.attempts + 1 };
      tx.set(ref, { token, attempts: job.attempts, firstAttemptAt: job.firstAttemptAt, leaseUntil: clock() + LEASE_MS, retryAt: clock() + LEASE_MS }, { merge: true });
    });
    if (!job) return nextRunAt;
    const finish = async patch => db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (current?.token !== token || current.deliveryState !== "pending") return false;
      tx.set(ref, patch, { merge: true });
      return true;
    });
    try {
      const recipient = await resolveRecipient(job.customerId);
      if (job.envelope && recipient !== job.envelope.to) throw recipientError("RECIPIENT_CHANGED");
      const envelope = job.envelope || makeEnvelope(job, recipient);
      // Freeze the exact payload before contacting Resend so crash retries reuse it.
      if (!await finish({ envelope, recipient })) return Infinity;
      await pause(1000); // At most one status email per second per process.
      const result = await send(envelope);
      const messageId = result?.id || result?.messageId;
      if (!messageId) throw Object.assign(new Error("Missing provider acceptance ID."), { code: "MISSING_PROVIDER_ID" });
      await finish({ deliveryState: "accepted", providerMessageId: messageId, sentAt: new Date(clock()).toISOString(), leaseUntil: 0, lastErrorCode: "" });
      return Infinity;
    } catch (error) {
      const code = String(error.code || "STATUS_EMAIL_FAILED").slice(0, 80);
      const ineligible = code.startsWith("RECIPIENT_");
      // Raw provider errors may contain addresses/content. Persist only a bounded code.
      const retryAt = clock() + Math.min(60 * 60 * 1000, 60000 * 2 ** (job.attempts - 1));
      await finish({ deliveryState: ineligible ? "skipped" : job.attempts >= 8 ? "needs_review" : "pending",
        failedAt: new Date(clock()).toISOString(), lastErrorCode: code, leaseUntil: 0,
        retryAt });
      return ineligible || job.attempts >= 8 ? Infinity : retryAt;
    }
  }
  async function run() {
    if (running) { requested = true; return null; }
    running = true;
    let nextRunAt = Infinity;
    try {
      const due = await db.collection(COLLECTION).where("notificationType", "==", TYPE)
        .where("deliveryState", "==", "pending").orderBy("retryAt").limit(batchSize).get();
      for (const entry of due.docs) {
        try { nextRunAt = Math.min(nextRunAt, await processJob(entry.ref)); }
        catch {
          nextRunAt = Math.min(nextRunAt, clock() + 60000);
          console.error("[appointment-status-email] Delivery ledger operation failed.", { event: entry.id });
        }
      }
      if (due.docs.length === batchSize && due.docs.some(entry => entry.data().retryAt <= clock())) nextRunAt = Math.min(nextRunAt, clock() + 1000);
    } finally { running = false; }
    if (requested) { requested = false; nextRunAt = Math.min(nextRunAt, clock() + 1000); }
    return nextRunAt;
  }
  return { run };
}

let runtime;
let runtimeTimer;
function requestStatusEmailDelivery() {
  if (!runtime) return;
  clearTimeout(runtimeTimer);
  setImmediate(async () => {
    const worker = runtime;
    if (!worker) return;
    let next;
    try { next = await worker.run(); }
    catch { console.error("[appointment-status-email] Queue check failed."); next = Date.now() + 60000; }
    if (runtime === worker && Number.isFinite(next)) {
      clearTimeout(runtimeTimer);
      runtimeTimer = setTimeout(requestStatusEmailDelivery, Math.max(1000, next - Date.now()));
      runtimeTimer.unref();
    }
  });
}
function startAppointmentStatusEmails() {
  const { db } = require("../config/postgresDatabase");
  runtime = createStatusEmailWorker({ db });
  requestStatusEmailDelivery(); // Recover durable work after restart/cold start.
  return { stop() { clearTimeout(runtimeTimer); runtime = null; } };
}

module.exports = { TYPE, COLLECTION, canonicalStatus, queueStatusEmail, buildStatusEmail, resolveCustomerRecipient,
  createStatusEmailWorker, requestStatusEmailDelivery, startAppointmentStatusEmails };
