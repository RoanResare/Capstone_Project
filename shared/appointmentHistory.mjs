import { formatAppointmentService } from "./bookingAdditions.mjs";

export function historyStatus(value = "") {
  const status = String(value).toLowerCase().replace(/[\s_-]+/g, " ").trim();
  return ({ completed: "Completed", rejected: "Rejected", cancelled: "Cancelled", canceled: "Cancelled",
    "no show": "No Show", expired: "No Show", pending: "Pending", approved: "Approved",
    confirmed: "Approved", accepted: "Approved" })[status] || "";
}

const TERMINAL_HISTORY_STATUSES = new Set(["Completed", "Rejected", "Cancelled", "No Show"]);

export function buildAppointmentHistory(appointments = [], role) {
  if (!["admin", "staff"].includes(role)) return [];
  return appointments.flatMap(appointment => {
    const recorded = (Array.isArray(appointment.lifecycleEvents) ? appointment.lifecycleEvents : [])
      .filter(event => event?.action || TERMINAL_HISTORY_STATUSES.has(historyStatus(event?.status)));
    const currentStatus = historyStatus(appointment.status);
    // Older records and automatically detected no-shows still belong in history.
    const events = TERMINAL_HISTORY_STATUSES.has(currentStatus) && !recorded.some(event => historyStatus(event.status) === currentStatus)
      ? [...recorded, { status: currentStatus, createdAt: appointment.updatedAt || appointment.schedule || appointment.createdAt,
          actorName: "", actorRole: "", reason: appointment.rejectionReason || appointment.cancellationReason || "" }]
      : recorded;
    return events.map((event, index) => ({ ...event, status: historyStatus(event.status) || "Updated",
      id: `${appointment.id}:${index}`, appointmentId: appointment.id,
      petName: appointment.petName || "Pet", service: formatAppointmentService(appointment.service) || "Appointment",
      customerName: appointment.customerName || appointment.ownerName || "",
      scheduleDate: appointment.scheduleDate, scheduleTime: appointment.scheduleTime,
    }));
  }).sort((left, right) => (Date.parse(right.createdAt) || 0) - (Date.parse(left.createdAt) || 0));
}
