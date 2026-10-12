export function uniqueAppointmentsById(appointments) {
  const records = new Map();
  const updatedTime = (record) => Date.parse(record.updatedAt || record.createdAt || "") || 0;
  for (const appointment of appointments) {
    const key = appointment.id || appointment;
    const existing = records.get(key);
    if (!existing || updatedTime(appointment) >= updatedTime(existing)) records.set(key, appointment);
  }
  return [...records.values()];
}
