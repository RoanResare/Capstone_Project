export function canApproveAppointment(status) {
  return status === "Pending";
}

export function canCompleteAppointment(status) {
  return ["Pending", "Accepted", "Approved"].includes(status);
}

export function canChangeAppointmentStatus(currentStatus, nextStatus) {
  if (["Rejected", "Cancelled"].includes(nextStatus)) return currentStatus === "Pending";
  if (nextStatus === "Accepted") return canApproveAppointment(currentStatus);
  if (nextStatus === "Completed") return canCompleteAppointment(currentStatus);
  return false;
}
