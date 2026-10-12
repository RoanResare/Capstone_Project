export const APPOINTMENT_STATUSES = ["Pending", "Approved", "Completed", "Rejected", "Cancelled", "Expired"];

export const APPOINTMENT_COLORS = {
  Pending: { background: "#FFF4D6", text: "#8C5A08", border: "#E8B958" },
  Approved: { background: "#DDF5E6", text: "#187A4B", border: "#80C69C" },
  Completed: { background: "#165B3B", text: "#FFFFFF", border: "#165B3B" },
  Rejected: { background: "#FDE8EC", text: "#B32943", border: "#EAA0AE" },
  Cancelled: { background: "#FDE8EC", text: "#B32943", border: "#EAA0AE" },
  Expired: { background: "#FDE8EC", text: "#B32943", border: "#EAA0AE" },
};

export function appointmentStatusLabel(status) {
  return ["Accepted", "Confirmed"].includes(status) ? "Approved" : status;
}

export function appointmentDateKey(appointment) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(appointment?.scheduleDate || "")) return appointment.scheduleDate;
  const date = new Date(appointment?.schedule);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function appointmentStart(appointment) {
  const date = appointmentDateKey(appointment);
  if (!date) return "";
  if (/^\d{2}:\d{2}/.test(appointment.scheduleTime || "")) {
    const start = `${date}T${appointment.scheduleTime.slice(0, 5)}:00`;
    return Number.isFinite(Date.parse(`${start}+08:00`)) ? start : "";
  }
  const parsed = new Date(appointment.schedule);
  if (!Number.isFinite(parsed.getTime())) return "";
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(parsed);
  return `${date}T${time}:00`;
}

export function filterAppointmentList(appointments, status = "All", search = "") {
  const query = search.trim().toLowerCase();
  return appointments.filter((appointment) =>
    (status === "All" || appointmentStatusLabel(appointment.status) === status) &&
    (!query || [appointment.petName, appointment.service, appointment.ownerName, appointment.customerEmail,
      appointment.assignedStaff, appointmentStatusLabel(appointment.status), appointment.scheduleDate, appointment.scheduleTime]
      .some((value) => String(value || "").toLowerCase().includes(query))));
}

export function paginateAppointmentList(appointments, requestedPage, pageSize = 3) {
  const pageCount = Math.max(1, Math.ceil(appointments.length / pageSize));
  const page = Math.min(Math.max(0, requestedPage), pageCount - 1);
  return { page, pageCount, appointments: appointments.slice(page * pageSize, (page + 1) * pageSize) };
}

export function groupPendingAppointments(appointments) {
  const groups = new Map();
  appointments.slice().sort((left, right) => (appointmentStart(left) || "9999").localeCompare(appointmentStart(right) || "9999"))
    .forEach((appointment) => {
      const date = appointmentDateKey(appointment);
      if (!groups.has(date)) groups.set(date, []);
      groups.get(date).push(appointment);
    });
  return [...groups].map(([date, records]) => ({ date, appointments: records }));
}
