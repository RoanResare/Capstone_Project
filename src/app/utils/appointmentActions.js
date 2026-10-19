export function canApproveAppointment(status) {
  return status === "Pending";
}

export function canCompleteAppointment(status) {
  return ["Accepted", "Approved", "Confirmed"].includes(status);
}

export function canChangeAppointmentStatus(currentStatus, nextStatus) {
  if (nextStatus === "Rejected") return currentStatus === "Pending";
  if (nextStatus === "Cancelled") return ["Pending", "Accepted", "Approved", "Confirmed"].includes(currentStatus);
  if (nextStatus === "Accepted") return canApproveAppointment(currentStatus);
  if (nextStatus === "Completed") return canCompleteAppointment(currentStatus);
  return false;
}
