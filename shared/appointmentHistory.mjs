export function historyStatus(value = "") {
  const status = String(value).toLowerCase().replace(/[\s_-]+/g, " ").trim();
  return ({ completed: "Completed", rejected: "Rejected", cancelled: "Cancelled", canceled: "Cancelled",
    "no show": "No Show", expired: "No Show" })[status] || "";
}

export function buildAppointmentHistory(appointments = [], role) {
  if (!["admin", "staff"].includes(role)) return [];
  return appointments.flatMap(appointment => {
    const recorded = (Array.isArray(appointment.lifecycleEvents) ? appointment.lifecycleEvents : [])
      .filter(event => historyStatus(event.status));
    const currentStatus = historyStatus(appointment.status);
    // Older records and automatically detected no-shows still belong in history.
    const events = currentStatus && !recorded.some(event => historyStatus(event.status) === currentStatus)
      ? [...recorded, { status: currentStatus, createdAt: appointment.updatedAt || appointment.schedule || appointment.createdAt,
          actorName: "", actorRole: "", reason: appointment.rejectionReason || appointment.cancellationReason || "" }]
      : recorded;
    return events.map((event, index) => ({ ...event, status: historyStatus(event.status),
      id: `${appointment.id}:${index}`, appointmentId: appointment.id,
      petName: appointment.petName || "Pet", service: appointment.service || "Appointment",
      customerName: appointment.customerName || appointment.ownerName || "",
      scheduleDate: appointment.scheduleDate, scheduleTime: appointment.scheduleTime,
    }));
  }).sort((left, right) => (Date.parse(right.createdAt) || 0) - (Date.parse(left.createdAt) || 0));
}
