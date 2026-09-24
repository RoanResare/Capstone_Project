import { useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import {
  CalendarDays,
  Clock3,
  Mail,
  PawPrint,
  Phone,
  Search,
  Trash2,
  UserRound,
} from "lucide-react";
import { useApp } from "../../context/AppContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { PasswordStrengthMeter } from "../PasswordStrengthMeter.jsx";
import {
  appointmentFilters,
  appointmentStatusOptions,
  breedsByPetType,
  petTypeOptions,
  portalUserRoles,
  portalUserStatuses,
} from "../../data/systemData.js";

const NEW_PORTAL_USER_ID = "__new-portal-user__";

function isValidDateInstance(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function parseDateValue(value) {
  if (value instanceof Date) {
    return isValidDateInstance(value) ? value : null;
  }

  if (value && typeof value === "object") {
    if (typeof value.toDate === "function") {
      const parsed = value.toDate();
      return isValidDateInstance(parsed) ? parsed : null;
    }

    if (typeof value.seconds === "number") {
      const milliseconds = value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1000000);
      const parsed = new Date(milliseconds);
      return isValidDateInstance(parsed) ? parsed : null;
    }
  }

  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const parsed = new Date(value);
  return isValidDateInstance(parsed) ? parsed : null;
}

function padDatePart(value) {
  return String(value).padStart(2, "0");
}

function normalizeScheduleTime(timeValue) {
  if (typeof timeValue !== "string") {
    return "";
  }

  const normalized = timeValue.trim();
  if (!normalized) {
    return "";
  }

  const match = normalized.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return normalized;
  }

  const [, hours, minutes] = match;
  return `${padDatePart(hours)}:${minutes}`;
}

function parseDateTimeParts(dateValue, timeValue) {
  if (typeof dateValue !== "string" || typeof timeValue !== "string") {
    return null;
  }

  const normalizedDate = dateValue.trim();
  const normalizedTime = normalizeScheduleTime(timeValue);
  if (!normalizedDate || !normalizedTime) {
    return null;
  }

  const parsed = new Date(`${normalizedDate}T${normalizedTime}:00`);
  return isValidDateInstance(parsed) ? parsed : null;
}

function formatDateTime(value, fallback = "Time unavailable") {
  const parsed = parseDateValue(value);
  if (!parsed) {
    return fallback;
  }

  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function formatDateLabel(value, fallback = "Not set") {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }

  const parsed = new Date(`${value.trim()}T00:00:00`);
  if (!isValidDateInstance(parsed)) {
    return fallback;
  }

  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function formatAppointmentSchedule(appointment, fallback = "Schedule pending") {
  const parsed = parseDateTimeParts(appointment?.scheduleDate, appointment?.scheduleTime);
  if (parsed) {
    return formatDateTime(parsed);
  }

  if (appointment?.schedule) {
    return formatDateTime(appointment.schedule, fallback);
  }

  return fallback;
}

function getAppointmentSortTime(appointment) {
  const parsed = parseDateTimeParts(appointment?.scheduleDate, appointment?.scheduleTime);
  if (parsed) {
    return parsed.getTime();
  }

  return parseDateValue(appointment?.schedule)?.getTime() ?? Number.POSITIVE_INFINITY;
}

function getNewestTimestamp(record, fallbackFields = []) {
  const timestampFields = ["createdAt", ...fallbackFields, "updatedAt"];

  for (const field of timestampFields) {
    const parsed = parseDateValue(record?.[field]);
    if (parsed) {
      return parsed.getTime();
    }
  }

  return 0;
}

function sortByNewest(left, right, fallbackFields = []) {
  const rightTime = getNewestTimestamp(right, fallbackFields);
  const leftTime = getNewestTimestamp(left, fallbackFields);

  if (rightTime !== leftTime) {
    return rightTime - leftTime;
  }

  return String(right?.id || "").localeCompare(String(left?.id || ""));
}

function statusClasses(status) {
  if (["Confirmed", "Completed"].includes(status)) {
    return "bg-[#E8F7EE] text-[#1D7C45]";
  }

  if (["Rejected", "Cancelled"].includes(status)) {
    return "bg-[#FCE8EB] text-[#B23949]";
  }

  if (["Pending"].includes(status)) {
    return "bg-[#FFF4DF] text-[#A56A0F]";
  }

  return "bg-[#EAF4F4] text-[#2D6A73]";
}

function employeeStatusClasses(status) {
  if (status === "active") {
    return "bg-[#E8F7EE] text-[#1D7C45]";
  }

  if (status === "suspended") {
    return "bg-[#FFF4DF] text-[#A56A0F]";
  }

  return "bg-[#FCE8EB] text-[#B23949]";
}

function formatRoleLabel(role = "staff") {
  const normalized = typeof role === "string" ? role.trim().toLowerCase() : "staff";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatUserStatusLabel(status = "active") {
  const normalized = typeof status === "string" ? status.trim().toLowerCase() : "active";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function notificationTone(level = "info") {
  if (level === "success") {
    return "bg-[#E8F7EE] text-[#1D7C45]";
  }

  if (level === "warning") {
    return "bg-[#FFF4DF] text-[#A56A0F]";
  }

  if (level === "error") {
    return "bg-[#FCE8EB] text-[#B23949]";
  }

  return "bg-[#EAF4F4] text-[#2D6A73]";
}

function matchesSearch(appointment, searchValue) {
  if (!searchValue) {
    return true;
  }

  const lookup = searchValue.trim().toLowerCase();
  if (!lookup) {
    return true;
  }

  return [
    appointment.ownerName,
    appointment.petName,
    appointment.service,
    appointment.customerEmail,
    appointment.assignedStaff,
  ]
    .filter(Boolean)
    .some((value) => value.toLowerCase().includes(lookup));
}

function getAppointmentAccountIdentifiers(appointment) {
  const identifiers = [];
  const customerId = String(appointment?.customerId || "").trim().toLowerCase();
  const customerEmail = String(appointment?.customerEmail || "").trim().toLowerCase();
  const ownerName = String(appointment?.ownerName || "").trim().toLowerCase();

  if (customerId) {
    identifiers.push(`id:${customerId}`);
  }
  if (customerEmail) {
    identifiers.push(`email:${customerEmail}`);
  }
  if (!identifiers.length && ownerName) {
    identifiers.push(`owner:${ownerName}`);
  }

  return identifiers;
}

function getAppointmentRisk(appointment, appointments) {
  const accountIdentifiers = new Set(getAppointmentAccountIdentifiers(appointment));
  const cancelledCount = (Array.isArray(appointments) ? appointments : []).filter((candidate) => {
    if (String(candidate?.status || "").toLowerCase() !== "cancelled") {
      return false;
    }

    return getAppointmentAccountIdentifiers(candidate).some((identifier) =>
      accountIdentifiers.has(identifier),
    );
  }).length;

  return {
    isHighRisk: cancelledCount >= 3,
    cancelledCount,
  };
}

function matchesPetRecordSearch(record, searchValue) {
  if (!searchValue) {
    return true;
  }

  const lookup = searchValue.trim().toLowerCase();
  if (!lookup) {
    return true;
  }

  return [
    record.ownerName,
    record.petName,
    record.petType,
    record.breed,
    record.customerEmail,
  ]
    .filter(Boolean)
    .some((value) => value.toLowerCase().includes(lookup));
}

function normalizeLineItems(value) {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function matchesUserSearch(user, searchValue) {
  if (!searchValue) {
    return true;
  }

  const lookup = searchValue.trim().toLowerCase();
  if (!lookup) {
    return true;
  }

  return [user.name, user.email, user.username, user.role, user.status]
    .filter(Boolean)
    .some((value) => value.toLowerCase().includes(lookup));
}

function buildPetRecordForm(record = null) {
  const current = record && typeof record === "object" ? record : {};
  const savedPetType = typeof current.petType === "string" ? current.petType : "";
  const petType = petTypeOptions.includes(savedPetType) ? savedPetType : savedPetType ? "Other" : "";
  const customPetType = petType === "Other" && savedPetType !== "Other" ? savedPetType : "";
  const breedOptions = breedsByPetType[petType] || [];
  const savedBreed = typeof current.breed === "string" ? current.breed : "";
  const breed = breedOptions.includes(savedBreed) ? savedBreed : savedBreed ? "Other" : "";
  const customBreed = breed === "Other" && savedBreed !== "Other" ? savedBreed : "";

  return {
    id: typeof current.id === "string" ? current.id : "",
    customerId: typeof current.customerId === "string" ? current.customerId : "",
    ownerName: typeof current.ownerName === "string" ? current.ownerName : "",
    customerEmail: typeof current.customerEmail === "string" ? current.customerEmail : "",
    petName: typeof current.petName === "string" ? current.petName : "",
    petType,
    customPetType,
    breed,
    customBreed,
    lastVisit: typeof current.lastVisit === "string" ? current.lastVisit : "",
    notes: typeof current.notes === "string" ? current.notes : "",
    visitRecordsText: Array.isArray(current.visitRecords)
      ? current.visitRecords.join("\n")
      : "",
    medicalRecordsText: Array.isArray(current.medicalRecords)
      ? current.medicalRecords.join("\n")
      : "",
  };
}

function buildPortalUserForm(user = null) {
  const current = user && typeof user === "object" ? user : {};

  return {
    id: typeof current.id === "string" ? current.id : "",
    name: typeof current.name === "string" ? current.name : "",
    email: typeof current.email === "string" ? current.email : "",
    username: typeof current.username === "string" ? current.username : "",
    password: "",
    role: typeof current.role === "string" ? current.role : "staff",
  };
}

function buildChangedPortalUserPayload(form, originalForm) {
  const payload = {};

  ["name", "email", "username", "role"].forEach((field) => {
    if (form[field] !== originalForm[field]) {
      payload[field] = form[field];
    }
  });

  if (form.password.trim()) {
    payload.password = form.password.trim();
  }

  return payload;
}

function describeNotification(notification) {
  if (notification.targetType === "appointment") {
    const schedule = [notification.appointmentDate, notification.appointmentTime]
      .filter(Boolean)
      .join(" ");
    const service = notification.serviceName || "Appointment";
    const petName = notification.petName || notification.subjectName || "Pet";
    return `${petName} | ${service}${schedule ? ` | ${schedule}` : ""}`;
  }

  const subject = notification.subjectName || notification.actorName || "Account";
  const role = notification.subjectRole || notification.actorRole || "system";
  return `${subject} | ${role}`;
}

function PanelCard({ title, description, children, className = "", bodyClassName = "" }) {
  return (
    <section className={`rounded-2xl bg-white p-4 shadow-[0_14px_30px_rgba(102,91,72,0.1)] md:p-5 ${className}`}>
      <div className="border-b border-[#EFE7DC] pb-3">
        <h3 className="text-xl font-semibold text-[#20343B]">{title}</h3>
        {description && <p className="mt-1 text-sm text-[#607277]">{description}</p>}
      </div>
        <div className={`mt-4 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

function EmptyState({ title, message }) {
  return (
    <div className="rounded-2xl border border-dashed border-[#D8E5E5] bg-[#F8FBFB] px-5 py-8 text-center">
      <h4 className="text-lg font-semibold text-[#20343B]">{title}</h4>
      <p className="mt-2 text-sm text-[#607277]">{message}</p>
    </div>
  );
}

function StatusBadge({ status }) {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClasses(status)}`}>
      {status}
    </span>
  );
}

function EmployeeStatusBadge({ status }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-semibold ${employeeStatusClasses(status)}`}
    >
      {formatUserStatusLabel(status)}
    </span>
  );
}

function MetricCard({ label, value, tone = "teal" }) {
  const toneClasses = {
    teal: "bg-[#EAF7F7] text-[#2D6B73]",
    gold: "bg-[#FFF6E5] text-[#A56A0F]",
    rose: "bg-[#FBECEF] text-[#B23949]",
    slate: "bg-[#EEF3F5] text-[#3E5960]",
  };

  return (
    <div className={`rounded-2xl px-4 py-3.5 ${toneClasses[tone]}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-80">{label}</p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
    </div>
  );
}

function AppointmentDetailPanel({ appointment, currentUser, staffOptions, updateAppointment }) {
  if (!appointment) {
    return (
      <PanelCard
        title="Appointment details"
        description="Select a booking from the list to review contact details and queue actions."
      >
        <EmptyState
          title="No appointment selected"
          message="Choose a customer booking to approve, reject, cancel, or update."
        />
      </PanelCard>
    );
  }

  const contactPhone = appointment.contactNumber || "No phone saved";

  return (
    <PanelCard
      title={`${appointment.petName} | ${appointment.service}`}
      description="Review customer information, current status, and assignment details."
    >
      <div className="space-y-5">
        <div className="rounded-[24px] bg-[#F6FAFA] px-5 py-5">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={appointment.status} />
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#365057]">
              {formatAppointmentSchedule(appointment)}
            </span>
          </div>

          <div className="mt-4 grid gap-3 text-sm text-[#607277]">
            <div className="flex items-center gap-3">
              <UserRound size={16} />
              <span>{appointment.ownerName}</span>
            </div>
            <div className="flex items-center gap-3">
              <Mail size={16} />
              <span>{appointment.customerEmail || "No email saved"}</span>
            </div>
            <div className="flex items-center gap-3">
              <Phone size={16} />
              <span>{contactPhone}</span>
            </div>
            <div className="flex items-center gap-3">
              <Clock3 size={16} />
              <span>Assigned staff: {appointment.assignedStaff || "Not assigned"}</span>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => updateAppointment(appointment.id, { status: "Confirmed" })}
            className="rounded-2xl bg-[#E8F7EE] px-4 py-3 text-sm font-semibold text-[#1D7C45]"
          >
            Approve appointment
          </button>
          <button
            type="button"
            onClick={() => updateAppointment(appointment.id, { status: "Rejected" })}
            className="rounded-2xl bg-[#FFF4DF] px-4 py-3 text-sm font-semibold text-[#A56A0F]"
          >
            Reject appointment
          </button>
          <button
            type="button"
            onClick={() => updateAppointment(appointment.id, { status: "Cancelled" })}
            className="rounded-2xl bg-[#FBECEF] px-4 py-3 text-sm font-semibold text-[#B23949]"
          >
            Cancel appointment
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-medium text-[#425A60]">
              Appointment status
            </label>
            <select
              value={appointment.status}
              onChange={(event) =>
                updateAppointment(appointment.id, { status: event.target.value })
              }
              className="w-full rounded-2xl border border-[#D9E7E7] px-4 py-3 text-sm outline-none transition focus:border-[#2D9B9B]"
            >
              {appointmentStatusOptions.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-[#425A60]">
              Assign team member
            </label>
            <select
              value={appointment.assignedStaff || ""}
              onChange={(event) =>
                updateAppointment(appointment.id, { assignedStaff: event.target.value })
              }
              className="w-full rounded-2xl border border-[#D9E7E7] px-4 py-3 text-sm outline-none transition focus:border-[#2D9B9B]"
            >
              <option value="">Assign staff</option>
              {staffOptions.map((staffName) => (
                <option key={staffName}>{staffName}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="rounded-[24px] border border-[#E6F0F0] bg-[#FCFEFE] px-5 py-5">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#6B878D]">
            Queue notes
          </p>
          <p className="mt-3 text-sm leading-6 text-[#607277]">
            {appointment.notes || "No appointment notes were provided by the customer."}
          </p>
          <p className="mt-4 text-xs text-[#7A9297]">
            Updated by {currentUser.name} as part of the appointment workflow.
          </p>
        </div>
      </div>
    </PanelCard>
  );
}

function NotificationContextPanel({ notification, relatedAppointment, openAppointment }) {
  if (!notification) {
    return (
      <PanelCard
        title="Notification context"
        description="Open a notification from the header to jump directly into its related booking or account detail."
      >
        <EmptyState
          title="No notification selected"
          message="Unread customer account and appointment events will open here with their context."
        />
      </PanelCard>
    );
  }

  return (
    <PanelCard
      title={notification.title}
      description="Notification details and related appointment context."
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[#F2F6F6] px-3 py-1 text-xs font-semibold text-[#365057]">
            {notification.actorName} | {notification.actorRole}
          </span>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${notificationTone(notification.level)}`}>
            {notification.actionLabel}
          </span>
        </div>

        <p className="text-sm leading-6 text-[#607277]">{notification.message}</p>

        <div className="rounded-[24px] bg-[#F6FAFA] px-4 py-4 text-sm text-[#4E686E]">
          <p className="font-semibold text-[#20343B]">{describeNotification(notification)}</p>
          {notification.email && <p className="mt-2">Email: {notification.email}</p>}
          {notification.phone && <p className="mt-1">Phone: {notification.phone}</p>}
          <p className="mt-2 text-xs text-[#7A9297]">{formatDateTime(notification.createdAt)}</p>
        </div>

        {relatedAppointment ? (
          <button
            type="button"
            onClick={() => openAppointment(relatedAppointment.id, notification.id)}
            className="w-full rounded-2xl bg-[#173E44] px-4 py-3 text-sm font-semibold text-white"
          >
            Open related appointment
          </button>
        ) : (
          <div className="rounded-[22px] bg-[#FFF4DF] px-4 py-3 text-sm text-[#A56A0F]">
            This notification is account-related, so its full detail is shown here without a
            linked appointment record.
          </div>
        )}
      </div>
    </PanelCard>
  );
}

function RecentNotificationList({ currentUser, notifications, openAppointment }) {
  return (
    <PanelCard
      title="Recent system events"
      description="Latest customer account and appointment updates visible to your role."
    >
      {notifications.length === 0 ? (
        <EmptyState
          title="No recent events"
          message="Customer registrations and booking activity will appear here automatically."
        />
      ) : (
        <div className="space-y-3">
          {notifications.slice(0, 3).map((notification) => {
            const isUnread = !notification.readBy.includes(currentUser.id);

            return (
              <button
                key={notification.id}
                type="button"
                onClick={() =>
                  openAppointment(notification.relatedAppointmentId || "", notification.id)
                }
                className={`w-full rounded-[22px] border px-4 py-4 text-left transition ${
                  isUnread
                    ? "border-[#D7ECEC] bg-[#F8FCFC] hover:border-[#BFE1E1]"
                    : "border-[#EDF2F2] bg-white hover:border-[#D7E8E8]"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-[#20343B]">{notification.title}</p>
                    <p className="mt-1 text-sm text-[#607277]">{notification.message}</p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                      isUnread ? "bg-[#173E44] text-white" : "bg-[#EEF3F5] text-[#4C6368]"
                    }`}
                  >
                    {isUnread ? "Unread" : "Read"}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[#607277]">
                  <span className="rounded-full bg-[#F2F6F6] px-3 py-1 font-semibold text-[#365057]">
                    {notification.actorName} | {notification.actorRole}
                  </span>
                  <span className={`rounded-full px-3 py-1 font-semibold ${notificationTone(notification.level)}`}>
                    {notification.actionLabel}
                  </span>
                </div>

                <p className="mt-3 text-sm text-[#4E686E]">{describeNotification(notification)}</p>
              </button>
            );
          })}
        </div>
      )}
    </PanelCard>
  );
}

function AppointmentsWorkspace({
  currentUser,
  state,
  visibleNotifications,
  updateAppointment,
}) {
  const { success: showSuccessToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState("All");
  const [searchValue, setSearchValue] = useState("");

  const appointments = (Array.isArray(state.appointments) ? state.appointments : [])
    .filter((appointment) => appointment && typeof appointment === "object")
    .slice()
    .sort((left, right) => sortByNewest(left, right, ["updatedAt", "schedule"]));
  const staffOptions = (Array.isArray(state.users) ? state.users : [])
    .filter((user) => user && user.status === "active" && ["admin", "staff"].includes(user.role))
    .map((user) => user.name);
  const handleAppointmentUpdate = (appointmentId, updates) => {
    updateAppointment(appointmentId, updates, currentUser.name);

    if (updates?.status === "Rejected") {
      showSuccessToast("Appointment rejected successfully.");
    }
  };
  const filteredAppointments = appointments.filter((appointment) => {
    const matchesStatus = statusFilter === "All" || appointment.status === statusFilter;
    return matchesStatus && matchesSearch(appointment, searchValue);
  });
  const pendingCount = appointments.filter((appointment) => appointment.status === "Pending").length;
  const confirmedCount = appointments.filter(
    (appointment) => appointment.status === "Confirmed",
  ).length;
  const completedCount = appointments.filter(
    (appointment) => appointment.status === "Completed",
  ).length;
  const blockedCount = appointments.filter((appointment) =>
    ["Rejected", "Cancelled"].includes(appointment.status),
  ).length;

  const selectedNotificationId = searchParams.get("notification") || "";
  const selectedNotification =
    visibleNotifications.find((notification) => notification.id === selectedNotificationId) || null;
  const selectedAppointmentId =
    searchParams.get("appointment") || selectedNotification?.relatedAppointmentId || "";
  const selectedAppointment =
    appointments.find((appointment) => appointment.id === selectedAppointmentId) ||
    filteredAppointments[0] ||
    appointments[0] ||
    null;
  const relatedNotificationAppointment =
    selectedNotification?.relatedAppointmentId
      ? appointments.find(
          (appointment) => appointment.id === selectedNotification.relatedAppointmentId,
        ) || null
      : null;

  const openAppointment = (appointmentId, notificationId = "") => {
    const nextParams = new URLSearchParams();

    if (appointmentId) {
      nextParams.set("appointment", appointmentId);
    }

    if (notificationId) {
      nextParams.set("notification", notificationId);
    }

    setSearchParams(nextParams);
  };

  return (
    <div className="space-y-4 xl:flex xl:min-h-0 xl:flex-col">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Pending" value={pendingCount} tone="gold" />
        <MetricCard label="Confirmed" value={confirmedCount} />
        <MetricCard label="Completed" value={completedCount} tone="slate" />
        <MetricCard label="Rejected / Cancelled" value={blockedCount} tone="rose" />
      </div>

      <div className="grid gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[1.05fr_0.95fr]">
        <PanelCard
          title="Manage appointments"
          description="View bookings, review customer details, and keep the queue moving."
          className="xl:flex xl:min-h-0 xl:flex-col"
          bodyClassName="xl:min-h-0 xl:flex-1"
        >
          <div className="space-y-3 xl:flex xl:h-full xl:min-h-0 xl:flex-col">
            <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="rounded-2xl border border-[#D9E7E7] px-4 py-3 text-sm outline-none transition focus:border-[#2D9B9B]"
              >
                {appointmentFilters.map((filter) => (
                  <option key={filter}>{filter}</option>
                ))}
              </select>

              <label className="flex items-center gap-3 rounded-2xl border border-[#D9E7E7] px-4 py-3 text-sm text-[#607277]">
                <Search size={16} />
                <input
                  value={searchValue}
                  onChange={(event) => setSearchValue(event.target.value)}
                  className="w-full bg-transparent outline-none"
                  placeholder="Search by customer, pet, email, service, or assignee"
                />
              </label>
            </div>

            {filteredAppointments.length === 0 ? (
              <EmptyState
                title="No matching appointments"
                message="Try another filter or wait for new customer bookings to reach the queue."
              />
            ) : (
              <div className="max-h-[430px] space-y-2.5 overflow-y-auto pr-1 xl:min-h-0 xl:flex-1">
                {filteredAppointments.map((appointment) => {
                  const risk = getAppointmentRisk(appointment, appointments);

                  return (
                    <button
                        key={appointment.id}
                        type="button"
                        onClick={() => openAppointment(appointment.id)}
                        className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                          selectedAppointment?.id === appointment.id
                            ? "border-[#BFE1E1] bg-[#F8FCFC]"
                            : "border-[#E6F0F0] bg-white hover:border-[#D0E4E4]"
                        }`}
                      >
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-3">
                              <p className="text-lg font-semibold text-[#20343B]">
                                {appointment.petName} | {appointment.service}
                              </p>
                              <StatusBadge status={appointment.status} />
                              {risk.isHighRisk && (
                                <span
                                  title={`${risk.cancelledCount} cancelled appointments on this account`}
                                  className="rounded-full bg-[#FCE8EB] px-2.5 py-1 text-xs font-bold text-[#B23949]"
                                >
                                  High Risk / Frequent Canceller
                                </span>
                              )}
                            </div>
                        <p className="mt-2 text-sm text-[#607277]">
                          {appointment.ownerName} | {appointment.customerEmail || "No email"}
                        </p>
                        <p className="mt-2 text-sm text-[#607277]">
                          {formatAppointmentSchedule(appointment)}
                        </p>
                        <p className="mt-2 text-sm text-[#607277]">
                          Assigned staff: {appointment.assignedStaff || "Not assigned"}
                        </p>
                          </div>

                          <div className="rounded-full bg-[#F2F6F6] px-3 py-1 text-xs font-semibold text-[#365057]">
                            {appointment.notes ? "Has notes" : "No notes"}
                          </div>
                        </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </PanelCard>

        <AppointmentDetailPanel
          appointment={selectedAppointment}
          currentUser={currentUser}
          staffOptions={staffOptions}
          updateAppointment={handleAppointmentUpdate}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <NotificationContextPanel
          notification={selectedNotification}
          relatedAppointment={relatedNotificationAppointment}
          openAppointment={openAppointment}
        />
        <RecentNotificationList
          currentUser={currentUser}
          notifications={visibleNotifications}
          openAppointment={openAppointment}
        />
      </div>
    </div>
  );
}

function PetRecordsWorkspace({ currentUser, state, savePetRecord }) {
  const [searchValue, setSearchValue] = useState("");
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [form, setForm] = useState(() => buildPetRecordForm());

  const petRecords = (Array.isArray(state.petRecords) ? state.petRecords : [])
    .filter((record) => record && typeof record === "object")
    .slice()
    .sort((left, right) => sortByNewest(left, right, ["updatedAt", "lastVisit"]));
  const filteredPetRecords = petRecords.filter((record) =>
    matchesPetRecordSearch(record, searchValue),
  );
  const selectedRecord =
    petRecords.find((record) => record.id === selectedRecordId) ||
    filteredPetRecords[0] ||
    petRecords[0] ||
    null;
  const customersWithPets = new Set(
    petRecords
      .map((record) => record.customerEmail || record.customerId || record.ownerName)
      .filter(Boolean),
  ).size;
  const petsWithNotes = petRecords.filter((record) => record.notes?.trim()).length;
  const availableBreedOptions = breedsByPetType[form.petType] || [];
  const linkedAppointmentCount = (record) =>
    (Array.isArray(state.appointments) ? state.appointments : []).filter(
      (appointment) =>
        appointment.petRecordId === record.id ||
        (appointment.petName === record.petName &&
          appointment.customerEmail === record.customerEmail),
    ).length;

  useEffect(() => {
    if (!selectedRecordId && filteredPetRecords[0]) {
      setSelectedRecordId(filteredPetRecords[0].id);
      return;
    }

    if (selectedRecordId && !petRecords.some((record) => record.id === selectedRecordId)) {
      setSelectedRecordId(filteredPetRecords[0]?.id || petRecords[0]?.id || "");
    }
  }, [filteredPetRecords, petRecords, selectedRecordId]);

  useEffect(() => {
    setForm(buildPetRecordForm(selectedRecord));
  }, [selectedRecord, selectedRecordId]);

  const updateField = (field) => (event) => {
    const value = event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
  };

  const updatePetType = (event) => {
    const value = event.target.value;
    setForm((current) => ({
      ...current,
      petType: value,
      customPetType: value === "Other" ? current.customPetType : "",
      breed: "",
      customBreed: "",
    }));
  };

  const updateBreed = (event) => {
    const value = event.target.value;
    setForm((current) => ({
      ...current,
      breed: value,
      customBreed: value === "Other" ? current.customBreed : "",
    }));
  };

  const saveRecord = (event) => {
    event.preventDefault();

    if (!selectedRecord?.id) {
      setFeedback({
        type: "error",
        message: "Select an existing booking-created pet record before saving changes.",
      });
      return;
    }

    if (!form.ownerName.trim() || !form.petName.trim() || !form.petType.trim()) {
      setFeedback({
        type: "error",
        message: "Owner name, pet name, and pet type are required.",
      });
      return;
    }

    if (form.petType === "Other" && !form.customPetType.trim()) {
      setFeedback({
        type: "error",
        message: "Specify the custom pet type.",
      });
      return;
    }

    if (!form.breed.trim()) {
      setFeedback({
        type: "error",
        message: "Pet breed is required.",
      });
      return;
    }

    if (form.breed === "Other" && !form.customBreed.trim()) {
      setFeedback({
        type: "error",
        message: "Specify the custom breed.",
      });
      return;
    }

    if (form.customerEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.customerEmail.trim())) {
      setFeedback({
        type: "error",
        message: "Enter a valid customer email address.",
      });
      return;
    }

    const resolvedPetType =
      form.petType === "Other" ? form.customPetType.trim() : form.petType.trim();
    const resolvedBreed =
      form.breed === "Other" ? form.customBreed.trim() : form.breed.trim();

    savePetRecord(
      {
        id: selectedRecord.id,
        customerId: form.customerId.trim(),
        ownerName: form.ownerName.trim(),
        customerEmail: form.customerEmail.trim().toLowerCase(),
        petName: form.petName.trim(),
        petType: resolvedPetType,
        breed: resolvedBreed,
        lastVisit: form.lastVisit.trim(),
        notes: form.notes.trim(),
        visitRecords: normalizeLineItems(form.visitRecordsText),
        medicalRecords: normalizeLineItems(form.medicalRecordsText),
        updatedAt: new Date().toISOString(),
      },
      currentUser.name,
    );

    setFeedback({
      type: "success",
      message: `${form.petName.trim()} was saved successfully.`,
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Total Pet Records" value={petRecords.length} />
        <MetricCard label="Customers With Pets" value={customersWithPets} tone="slate" />
        <MetricCard label="Records With Notes" value={petsWithNotes} tone="gold" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.96fr_1.04fr]">
        <PanelCard
          title="Manage pet records"
          description="Review booking-created customer pets, keep medical notes current, and prepare future appointments faster."
          className="h-full xl:flex xl:min-h-0 xl:flex-col"
          bodyClassName="xl:flex xl:min-h-0 xl:flex-1"
        >
          <div className="space-y-4 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col xl:space-y-0 xl:gap-4">
            <div className="flex flex-col gap-3 xl:shrink-0">
              <label className="flex items-center gap-3 rounded-2xl border border-[#D9E7E7] px-4 py-3 text-sm text-[#607277] md:flex-1">
                <Search size={16} />
                <input
                  value={searchValue}
                  onChange={(event) => setSearchValue(event.target.value)}
                  className="w-full bg-transparent outline-none"
                  placeholder="Search by owner, pet, breed, type, or email"
                />
              </label>
              <div className="rounded-[22px] bg-[#F6FAFA] px-4 py-3 text-sm leading-6 text-[#607277]">
                New pet records are now created automatically when a customer books an appointment.
              </div>
            </div>

            {filteredPetRecords.length === 0 ? (
              <EmptyState
                title="No matching pet records"
                message="Customer pet profiles will appear here as soon as they are created or booked."
              />
            ) : (
              <div className="max-h-[460px] space-y-2.5 overflow-y-auto pr-1 xl:min-h-0 xl:flex-1 xl:max-h-none">
                {filteredPetRecords.map((record) => {
                  const appointmentCount = linkedAppointmentCount(record);

                  return (
                    <button
                      key={record.id}
                      type="button"
                      onClick={() => {
                        setSelectedRecordId(record.id);
                        setFeedback({ type: "", message: "" });
                      }}
                      className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                      selectedRecord?.id === record.id
                          ? "border-[#BFE1E1] bg-[#F8FCFC]"
                          : "border-[#E6F0F0] bg-white hover:border-[#D0E4E4]"
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EEF6F6] text-[#2D6A73]">
                          <PawPrint size={18} />
                        </div>
                        <div>
                          <p className="text-lg font-semibold text-[#20343B]">
                            {record.petName} | {record.petType}
                          </p>
                          <p className="mt-1 text-sm text-[#607277]">
                            {record.ownerName} | {record.customerEmail || "No email saved"}
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                        <span className="rounded-full bg-[#F2F6F6] px-3 py-1 text-[#365057]">
                          {record.breed || "Breed pending"}
                        </span>
                        <span className="rounded-full bg-[#FFF6E5] px-3 py-1 text-[#A56A0F]">
                          {appointmentCount} linked appointment{appointmentCount === 1 ? "" : "s"}
                        </span>
                      </div>

                      <p className="mt-3 text-sm text-[#607277]">
                        Last visit: {formatDateLabel(record.lastVisit)}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </PanelCard>

        <PanelCard
          title="Pet record details"
          description="Update pet profile information, visit history, and medical notes for staff visibility."
        >
          {selectedRecord ? (
            <form onSubmit={saveRecord} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#425A60]">
                    Owner name
                  </label>
                  <input
                    value={form.ownerName}
                    onChange={updateField("ownerName")}
                    maxLength={80}
                    className="w-full rounded-2xl border border-[#D9E7E7] px-4 py-3 text-sm outline-none transition focus:border-[#2D9B9B]"
                    placeholder="Customer name"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#425A60]">
                    Customer email
                  </label>
                  <input
                    type="email"
                    value={form.customerEmail}
                    onChange={updateField("customerEmail")}
                    maxLength={120}
                    className="w-full rounded-2xl border border-[#D9E7E7] px-4 py-3 text-sm outline-none transition focus:border-[#2D9B9B]"
                    placeholder="customer@example.com"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#425A60]">
                    Pet name
                  </label>
                  <input
                    value={form.petName}
                    onChange={updateField("petName")}
                    maxLength={60}
                    className="w-full rounded-2xl border border-[#D9E7E7] px-4 py-3 text-sm outline-none transition focus:border-[#2D9B9B]"
                    placeholder="Pet name"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#425A60]">
                    Pet type
                  </label>
                  <select
                    value={form.petType}
                    onChange={updatePetType}
                    className="w-full rounded-2xl border border-[#D9E7E7] bg-white px-4 py-3 text-sm outline-none transition focus:border-[#2D9B9B]"
                  >
                    <option value="">Select pet type</option>
                    {petTypeOptions.map((petType) => (
                      <option key={petType} value={petType}>
                        {petType}
                      </option>
                    ))}
                  </select>
                  {form.petType === "Other" && (
                    <input
                      value={form.customPetType}
                      onChange={updateField("customPetType")}
                      maxLength={40}
                      className="mt-3 w-full rounded-2xl border border-[#D9E7E7] px-4 py-3 text-sm outline-none transition focus:border-[#2D9B9B]"
                      placeholder="Specify pet type"
                    />
                  )}
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#425A60]">
                    Breed
                  </label>
                  <select
                    value={form.breed}
                    onChange={updateBreed}
                    disabled={!form.petType}
                    className="w-full rounded-2xl border border-[#D9E7E7] bg-white px-4 py-3 text-sm outline-none transition focus:border-[#2D9B9B] disabled:cursor-not-allowed disabled:bg-[#F1F5F5] disabled:text-[#91A0A3]"
                  >
                    <option value="">
                      {form.petType ? "Select breed" : "Select pet type first"}
                    </option>
                    {availableBreedOptions.map((breed) => (
                      <option key={breed} value={breed}>
                        {breed}
                      </option>
                    ))}
                  </select>
                  {form.breed === "Other" && (
                    <input
                      value={form.customBreed}
                      onChange={updateField("customBreed")}
                      maxLength={60}
                      className="mt-3 w-full rounded-2xl border border-[#D9E7E7] px-4 py-3 text-sm outline-none transition focus:border-[#2D9B9B]"
                      placeholder="Specify breed"
                    />
                  )}
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#425A60]">
                    Last visit
                  </label>
                  <input
                    type="date"
                    value={form.lastVisit}
                    onChange={updateField("lastVisit")}
                    className="w-full rounded-2xl border border-[#D9E7E7] px-4 py-3 text-sm outline-none transition focus:border-[#2D9B9B]"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#425A60]">
                  Notes
                </label>
                <textarea
                  value={form.notes}
                  onChange={updateField("notes")}
                  maxLength={500}
                  className="min-h-[120px] w-full rounded-2xl border border-[#D9E7E7] px-4 py-3 text-sm outline-none transition focus:border-[#2D9B9B]"
                  placeholder="Handling notes, special reminders, or grooming concerns"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#425A60]">
                    Visit records
                  </label>
                  <textarea
                    value={form.visitRecordsText}
                    onChange={updateField("visitRecordsText")}
                    maxLength={1200}
                    className="min-h-[140px] w-full rounded-2xl border border-[#D9E7E7] px-4 py-3 text-sm outline-none transition focus:border-[#2D9B9B]"
                    placeholder="One visit update per line"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#425A60]">
                    Medical records
                  </label>
                  <textarea
                    value={form.medicalRecordsText}
                    onChange={updateField("medicalRecordsText")}
                    maxLength={1200}
                    className="min-h-[140px] w-full rounded-2xl border border-[#D9E7E7] px-4 py-3 text-sm outline-none transition focus:border-[#2D9B9B]"
                    placeholder="One medical note per line"
                  />
                </div>
              </div>

              {selectedRecord && (
                <div className="rounded-[24px] bg-[#F6FAFA] px-5 py-4 text-sm text-[#607277]">
                  <p className="font-semibold text-[#20343B]">
                    Linked appointments: {linkedAppointmentCount(selectedRecord)}
                  </p>
                  <p className="mt-2">
                    Record owner: {selectedRecord.ownerName || "No owner saved"}
                  </p>
                </div>
              )}

              <div className="flex flex-col gap-3 md:flex-row">
                <button
                  type="submit"
                  className="rounded-2xl bg-[#173E44] px-5 py-3 text-sm font-semibold text-white"
                >
                  Save pet record
                </button>

                <button
                  type="button"
                  onClick={() => setForm(buildPetRecordForm(selectedRecord))}
                  className="rounded-2xl bg-[#EEF6F6] px-5 py-3 text-sm font-semibold text-[#24444A]"
                >
                  Reset changes
                </button>
              </div>

              {feedback.message && (
                <p
                  className={`rounded-[22px] px-4 py-3 text-sm font-medium ${
                    feedback.type === "error"
                      ? "bg-[#FBECEF] text-[#B23949]"
                      : "bg-[#EAF7F7] text-[#2D6B73]"
                  }`}
                >
                  {feedback.message}
                </p>
              )}
            </form>
          ) : (
            <EmptyState
              title="No pet record selected"
              message="Customer pet records will appear here after a booking is submitted."
            />
          )}
        </PanelCard>
      </div>
    </div>
  );
}

function ManageUsersWorkspace({
  currentUser,
  state,
  visibleNotifications,
  createStaff,
  updateUser,
  deleteUser,
}) {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchValue, setSearchValue] = useState("");
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [form, setForm] = useState(() => buildPortalUserForm());
  const [originalForm, setOriginalForm] = useState(() => buildPortalUserForm());

  const portalUsers = (Array.isArray(state.users) ? state.users : [])
    .filter((user) => user && ["admin", "staff"].includes(user.role))
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));
  const filteredUsers = portalUsers.filter((user) => matchesUserSearch(user, searchValue));
  const activeCount = portalUsers.filter((user) => user.status === "active").length;
  const suspendedCount = portalUsers.filter((user) => user.status === "suspended").length;
  const inactiveCount = portalUsers.filter((user) => user.status === "inactive").length;
  const selectedNotificationId = searchParams.get("notification") || "";
  const selectedNotification =
    visibleNotifications.find((notification) => notification.id === selectedNotificationId) || null;
  const userParam = searchParams.get("user") || "";
  const isCreatingNew = userParam === NEW_PORTAL_USER_ID;
  const selectedUser =
    isCreatingNew
      ? null
      : portalUsers.find((user) => user.id === userParam) ||
        (selectedNotification?.targetType === "portal-account"
          ? portalUsers.find((user) => user.id === selectedNotification.targetId) || null
          : null) ||
        filteredUsers[0] ||
        portalUsers[0] ||
        null;

  const changeUserStatus = async (user, status) => {
    if (isSaving || !user?.id || user.status === status) {
      return;
    }

    setIsSaving(true);
    setFeedback({ type: "", message: "" });

    try {
      const result = await updateUser(user.id, { status });
      if (!result?.ok) {
        setFeedback({
          type: "error",
          message: result?.error || "Unable to update employee status.",
        });
        return;
      }

      const message = `${user.name} is now ${formatUserStatusLabel(status)}.`;
      setFeedback({ type: "success", message });
      toast.success(message);
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    const nextForm = buildPortalUserForm(isCreatingNew ? null : selectedUser);

    setForm(nextForm);
    setOriginalForm(nextForm);
    if (isCreatingNew) {
      setConfirmDelete(false);
      return;
    }

    setConfirmDelete(false);
  }, [isCreatingNew, selectedUser]);

  const updateField = (field) => (event) => {
    const value = event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
  };

  const openUser = (userId, notificationId = "") => {
    const nextParams = new URLSearchParams();

    if (userId) {
      nextParams.set("user", userId);
    }

    if (notificationId) {
      nextParams.set("notification", notificationId);
    }

    setSearchParams(nextParams);
    setFeedback({ type: "", message: "" });
  };

  const startNewUser = () => {
    openUser(NEW_PORTAL_USER_ID, selectedNotificationId);
  };

  const saveUser = async (event) => {
    event.preventDefault();
    if (isSaving) {
      return;
    }

    const fullPayload = {
      name: form.name.trim(),
      email: form.email.trim(),
      username: form.username.trim(),
      role: form.role,
      password: form.password.trim(),
    };

    if (!fullPayload.name || !fullPayload.email || !fullPayload.username || !fullPayload.role) {
      setFeedback({
        type: "error",
        message: "Name, email, username, and role are required.",
      });
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fullPayload.email)) {
      setFeedback({
        type: "error",
        message: "Enter a valid employee email address.",
      });
      return;
    }

    if (!/^[a-zA-Z0-9_]{3,32}$/.test(fullPayload.username)) {
      setFeedback({
        type: "error",
        message: "Username must be 3-32 characters and use only letters, numbers, or underscores.",
      });
      return;
    }

    if (isCreatingNew && !fullPayload.password) {
      setFeedback({
        type: "error",
        message: "A password is required when creating a new employee account.",
      });
      return;
    }

    const payload = isCreatingNew ? fullPayload : buildChangedPortalUserPayload(fullPayload, originalForm);

    if (!isCreatingNew && Object.keys(payload).length === 0) {
      setFeedback({
        type: "success",
        message: "No employee changes to save.",
      });
      return;
    }

    setIsSaving(true);
    setFeedback({ type: "", message: "" });

    try {
      const result = isCreatingNew
        ? await createStaff(payload)
        : await updateUser(selectedUser?.id || "", payload);

      if (!result?.ok) {
        setFeedback({
          type: "error",
          message: result?.error || "Unable to save the employee account.",
        });
        return;
      }

      if (isCreatingNew && result.id) {
        openUser(result.id, selectedNotificationId);
      }

      const savedForm = buildPortalUserForm(
        result.user
          ? { ...result.user, password: "" }
          : {
              ...selectedUser,
              ...fullPayload,
              id: selectedUser?.id || result.id || "",
              password: "",
            },
      );
      const successMessage = isCreatingNew
        ? "Employee account created successfully."
        : "Employee account updated successfully.";

      setForm(savedForm);
      setOriginalForm(savedForm);
      setFeedback({
        type: "success",
        message: successMessage,
      });
      toast.success(successMessage);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedUser?.id) {
      return;
    }

    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }

    setIsSaving(true);

    try {
      const result = await deleteUser(selectedUser.id);
      if (!result?.ok) {
        setFeedback({
          type: "error",
          message: result?.error || "Unable to delete the employee account.",
        });
        return;
      }

      setConfirmDelete(false);
      setFeedback({
        type: "success",
        message: "Employee account deleted successfully.",
      });
      toast.success("Employee account deleted successfully.");

      const fallbackUser = filteredUsers.find((user) => user.id !== selectedUser.id) || null;
      openUser(fallbackUser?.id || "");
    } finally {
      setIsSaving(false);
    }
  };

  const resetForm = () => {
    if (isCreatingNew) {
      setForm(buildPortalUserForm());
      setFeedback({ type: "", message: "" });
      return;
    }

    setForm(originalForm);
    setFeedback({ type: "", message: "" });
    setConfirmDelete(false);
  };

  const selectedUserIsCurrentAdmin = selectedUser?.id === currentUser.id;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Employee Accounts" value={portalUsers.length} />
        <MetricCard label="Active" value={activeCount} tone="teal" />
        <MetricCard label="Suspended" value={suspendedCount} tone="gold" />
        <MetricCard label="Inactive" value={inactiveCount} tone="rose" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.96fr_1.04fr]">
        <PanelCard
          title="Employee accounts"
          description="Create employees here; change account status from the list below."
        >
          <div className="space-y-4">
            <div className="flex flex-col gap-3 md:flex-row">
              <label className="flex items-center gap-3 rounded-lg border border-[#D9E7E7] px-4 py-3 text-sm text-[#607277] md:flex-1">
                <Search size={16} />
                <input
                  value={searchValue}
                  onChange={(event) => setSearchValue(event.target.value)}
                  className="w-full bg-transparent outline-none"
                  placeholder="Search by name, email, username, role, or status"
                />
              </label>

              <button
                type="button"
                onClick={startNewUser}
                className="rounded-lg bg-[#173E44] px-4 py-3 text-sm font-semibold text-white"
              >
                Add employee
              </button>
            </div>

            {selectedNotification?.targetType === "portal-account" && (
              <div className="rounded-[22px] border border-[#E6F0F0] bg-[#F8FCFC] px-4 py-3 text-sm text-[#607277]">
                <p className="font-semibold text-[#20343B]">{selectedNotification.title}</p>
                <p className="mt-1">{selectedNotification.message}</p>
              </div>
            )}

            {filteredUsers.length === 0 ? (
              <EmptyState
                title="No employee accounts found"
                message="Create a staff or admin account to start managing access."
              />
            ) : (
              <div className="max-h-[480px] space-y-3 overflow-y-auto pr-1">
                {filteredUsers.map((user) => (
                  <div
                    key={user.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openUser(user.id, selectedNotificationId)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openUser(user.id, selectedNotificationId);
                      }
                    }}
                    className={`w-full rounded-lg border px-4 py-3 text-left transition ${
                      selectedUser?.id === user.id && !isCreatingNew
                        ? "border-[#BFE1E1] bg-[#F8FCFC]"
                        : "border-[#E6F0F0] bg-white hover:border-[#D0E4E4]"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EEF6F6] text-[#2D6A73]">
                        <UserRound size={18} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-lg font-semibold text-[#20343B]">{user.name}</p>
                        <p className="mt-1 truncate text-sm text-[#607277]">{user.email}</p>
                        {user.username && (
                          <p className="mt-1 truncate text-xs font-semibold text-[#7A9297]">
                            @{user.username}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-[#F2F6F6] px-3 py-1 text-xs font-semibold text-[#365057]">
                        {formatRoleLabel(user.role)}
                      </span>
                      <EmployeeStatusBadge status={user.status} />
                      <select
                        value={user.status}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => {
                          event.stopPropagation();
                          changeUserStatus(user, event.target.value);
                        }}
                        disabled={isSaving || user.id === currentUser.id}
                        className="rounded-full border border-[#D9E7E7] bg-white px-3 py-1.5 text-xs font-semibold text-[#365057] outline-none transition focus:border-[#2D9B9B] disabled:cursor-not-allowed disabled:opacity-60"
                        aria-label={`Change status for ${user.name}`}
                      >
                        {portalUserStatuses.map((status) => (
                          <option key={status.value} value={status.value}>
                            {status.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </PanelCard>

        <PanelCard
          title={isCreatingNew ? "Create employee account" : "Employee account details"}
          description={
            isCreatingNew
              ? "New employee accounts start Active. Manage status from the employee list."
              : "Edit identity, credentials, and role assignment."
          }
        >
          {isCreatingNew || selectedUser ? (
            <form onSubmit={saveUser} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#425A60]">Name</label>
                  <input
                    value={form.name}
                    onChange={updateField("name")}
                    disabled={isSaving}
                    maxLength={80}
                    className="w-full rounded-lg border border-[#D9E7E7] px-4 py-3 text-sm outline-none transition focus:border-[#2D9B9B]"
                    placeholder="Employee full name"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#425A60]">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={updateField("email")}
                    disabled={isSaving}
                    maxLength={120}
                    className="w-full rounded-lg border border-[#D9E7E7] px-4 py-3 text-sm outline-none transition focus:border-[#2D9B9B]"
                    placeholder="employee@furfection.local"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#425A60]">Username</label>
                  <input
                    value={form.username}
                    onChange={updateField("username")}
                    disabled={isSaving}
                    maxLength={32}
                    pattern="[A-Za-z0-9_]{3,32}"
                    className="w-full rounded-lg border border-[#D9E7E7] px-4 py-3 text-sm outline-none transition focus:border-[#2D9B9B]"
                    placeholder="employee username"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#425A60]">Role</label>
                  <select
                    value={form.role}
                    onChange={updateField("role")}
                    disabled={isSaving || selectedUserIsCurrentAdmin}
                    className="w-full rounded-lg border border-[#D9E7E7] px-4 py-3 text-sm outline-none transition focus:border-[#2D9B9B]"
                  >
                    {portalUserRoles.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                </div>

              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#425A60]">
                  {isCreatingNew ? "Password" : "New password"}
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={updateField("password")}
                  disabled={isSaving}
                  className="w-full rounded-lg border border-[#D9E7E7] px-4 py-3 text-sm outline-none transition focus:border-[#2D9B9B]"
                  placeholder={
                    isCreatingNew
                      ? "Set an employee password"
                    : "Leave blank to keep the current password"
                  }
                />
                <PasswordStrengthMeter password={form.password} />
              </div>

              {!isCreatingNew && selectedUser && (
                <div className="rounded-lg bg-[#F6FAFA] px-4 py-4 text-sm text-[#607277]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#365057]">
                      {formatRoleLabel(selectedUser.role)}
                    </span>
                    <EmployeeStatusBadge status={selectedUser.status} />
                  </div>
                  <p className="mt-3">
                    Current access: {selectedUser.status === "active" ? "Can sign in to the portal." : "Portal sign-in is blocked."}
                  </p>
                  {selectedUserIsCurrentAdmin && (
                    <p className="mt-2 text-[#A56A0F]">
                      Your current admin session cannot remove its own admin role, deactivate itself, or delete itself.
                    </p>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-3 md:flex-row">
                <button
                  type="submit"
                  disabled={isSaving}
                className="rounded-lg bg-[#173E44] px-5 py-3 text-sm font-semibold text-white"
                >
                  {isSaving
                    ? isCreatingNew
                      ? "Creating account..."
                      : "Saving changes..."
                    : isCreatingNew
                      ? "Create account"
                      : "Save changes"}
                </button>

                <button
                  type="button"
                  onClick={resetForm}
                  disabled={isSaving}
                  className="rounded-lg bg-[#EEF6F6] px-5 py-3 text-sm font-semibold text-[#24444A]"
                >
                  {isCreatingNew ? "Clear form" : "Reset changes"}
                </button>

                {!isCreatingNew && selectedUser && (
                  <button
                    type="button"
                  onClick={handleDelete}
                  disabled={isSaving}
                    className={`inline-flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold ${
                      confirmDelete
                        ? "bg-[#B23949] text-white"
                        : "bg-[#FBECEF] text-[#B23949]"
                    }`}
                  >
                    <Trash2 size={16} />
                    {isSaving && confirmDelete
                      ? "Deleting..."
                      : confirmDelete
                        ? "Confirm permanent delete"
                        : "Delete account"}
                  </button>
                )}
              </div>

              {confirmDelete && selectedUser && (
                <div
                  role="alertdialog"
                  aria-modal="true"
                  aria-labelledby="delete-employee-title"
                  className="rounded-[22px] border border-[#F4B7BE] bg-[#FFF6F7] px-4 py-4"
                >
                  <h4 id="delete-employee-title" className="font-semibold text-[#8A3240]">
                    Are you sure you want to permanently delete this employee account?
                  </h4>
                  <p className="mt-2 text-sm text-[#8A5660]">
                    {selectedUser.name} will lose portal access and their username index will be removed.
                  </p>
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      disabled={isSaving}
                      className="rounded-2xl border border-[#E8C3C8] bg-white px-4 py-2.5 text-sm font-semibold text-[#8A3240]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={isSaving}
                      className="rounded-2xl bg-[#B23949] px-4 py-2.5 text-sm font-semibold text-white"
                    >
                      {isSaving ? "Deleting..." : "Delete account"}
                    </button>
                  </div>
                </div>
              )}

              {feedback.message && (
                <p
                  className={`rounded-[22px] px-4 py-3 text-sm font-medium ${
                    feedback.type === "error"
                      ? "bg-[#FBECEF] text-[#B23949]"
                      : "bg-[#EAF7F7] text-[#2D6B73]"
                  }`}
                >
                  {feedback.message}
                </p>
              )}
            </form>
          ) : (
            <EmptyState
              title="No employee account selected"
              message="Choose an employee account from the list or create a new one."
            />
          )}
        </PanelCard>
      </div>
    </div>
  );
}

export function PortalPage() {
  const location = useLocation();
  const {
    currentUser,
    state,
    visibleNotifications,
    updateAppointment,
    savePetRecord,
    createStaff,
    updateUser,
    deleteUser,
  } = useApp();
  const activeModule = location.pathname.endsWith("/pet-records")
    ? "pet-records"
    : location.pathname.endsWith("/manage-users")
      ? "manage-users"
      : "appointments";

  if (activeModule === "pet-records") {
    return (
      <PetRecordsWorkspace
        currentUser={currentUser}
        state={state}
        savePetRecord={savePetRecord}
      />
    );
  }

  if (activeModule === "manage-users") {
    return (
      <ManageUsersWorkspace
        currentUser={currentUser}
        state={state}
        visibleNotifications={visibleNotifications}
        createStaff={createStaff}
        updateUser={updateUser}
        deleteUser={deleteUser}
      />
    );
  }

  return (
    <AppointmentsWorkspace
      currentUser={currentUser}
      state={state}
      visibleNotifications={visibleNotifications}
      updateAppointment={updateAppointment}
    />
  );
}
