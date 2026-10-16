import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Eye,
  EyeOff,
  Trash2,
  PawPrint,
  Scissors,
  UserRound,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AppointmentBooking } from "./AppointmentBooking.jsx";
import { BookingAdditions } from "./BookingAdditions.jsx";
import { KaponPromoBanner } from "./KaponPromoBanner.jsx";
import { BrandMark } from "./BrandMark.jsx";
import { KAPON_SERVICE_ID, KAPON_UNAVAILABLE_MESSAGE } from "../../../shared/lowCostKaponPromo.mjs";
import { containsInappropriatePetText, getPetTextErrors } from "../../../shared/petTextValidation.mjs";
import { getTextValidationErrors, ACCOUNT_TEXT_FIELDS } from "../../../shared/textModeration.mjs";
import { APPOINTMENT_STATUSES, appointmentStatusLabel, filterAppointmentList, paginateAppointmentList, compareAppointmentSchedule } from "../utils/appointmentPresentation.js";
import { useApp } from "../context/AppContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { breedsByPetType, petTypeOptions, serviceCatalog } from "../data/systemData.js";
import { changeCustomerPassword } from "../services/customerAccount.js";
import { isValidEmail, ILLEGITIMATE_EMAIL_ERROR } from "../utils/emailValidation.js";
import {
  formatPhilippineMobileInput,
  formatPhilippineMobileNumber,
  normalizePhilippineMobileNumber,
  PH_MOBILE_ERROR,
  PH_MOBILE_FORMAT,
} from "../utils/phoneNumber.js";

const dashboardTabs = [
  { id: "overview", label: "Dashboard", icon: CheckCircle2 },
  { id: "services", label: "Services & Book Appointment", icon: Scissors },
  { id: "appointments", label: "My Appointments", icon: Clock3 },
  { id: "profile", label: "Profile", icon: UserRound },
];

const bookingRules = [
  {
    title: "One pet per appointment",
    description: "Each booking is associated with one pet profile.",
  },
  {
    title: "Maximum of two services per appointment",
    description: "Only clinic-approved service combinations are available for the selected appointment type.",
  },
  {
    title: "Book multiple pets separately",
    description: "Owners may create another appointment for an additional pet, subject to available slots.",
  },
];
const kaponService = serviceCatalog.find((service) => service.id === KAPON_SERVICE_ID);


function statusTone(status) {
  if (status === "Completed") return "bg-[#165B3B] text-white";
  if (["Approved", "Confirmed", "Accepted", "active"].includes(status)) {
    return "bg-[#E8F7EE] text-[#1D7C45]";
  }

  if (["Cancelled", "Rejected", "No-show", "No Show", "suspended"].includes(status)) {
    return "bg-[#FCE8EB] text-[#B23949]";
  }

  if (status === "Pending") {
    return "bg-[#FFF4DF] text-[#A56A0F]";
  }

  return "bg-[#EAF4F4] text-[#2D6A73]";
}

function StatusChip({ label }) {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(label)}`}>
      {label}
    </span>
  );
}

function formatDateTimeLabel(date, time) {
  if (!date || !time) {
    return "Schedule pending";
  }

  const normalizedTime =
    typeof time === "string"
      ? time.trim().replace(/^(\d{1,2}):(\d{2})(?::\d{2})?$/, (_, hours, minutes) => {
          return `${String(hours).padStart(2, "0")}:${minutes}`;
        })
      : "";
  const parsed = new Date(`${date}T${normalizedTime}:00`);
  if (Number.isNaN(parsed.getTime())) {
    return "Schedule pending";
  }

  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function parseAppointmentDateTime(date, time) {
  if (!date || !time) {
    return null;
  }

  const normalizedTime =
    typeof time === "string"
      ? time.trim().replace(/^(\d{1,2}):(\d{2})(?::\d{2})?$/, (_, hours, minutes) => {
          return `${String(hours).padStart(2, "0")}:${minutes}`;
        })
      : "";
  const parsed = new Date(`${date}T${normalizedTime}:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isSameLocalDay(left, right) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function canCancelAppointment(appointment) {
  const parsed = parseAppointmentDateTime(appointment?.scheduleDate, appointment?.scheduleTime);
  if (!parsed) {
    return true;
  }

  const now = new Date();
  return !isSameLocalDay(parsed, now) || parsed.getTime() > now.getTime();
}

function buildEmptyPetForm() {
  return {
    id: "",
    petName: "",
    petType: "",
    customPetType: "",
    breed: "",
    customBreed: "",
    ageValue: "",
    ageUnit: "months",
    weightKg: "",
    notes: "",
    gender: "",
    photoURL: "",
  };
}

function normalizeAgeInput(value = "", unit = "months") {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 2);
  if (!digits) return "";
  const max = unit === "years" ? 35 : 24;
  return String(Math.min(Number(digits), max));
}

function normalizeWeightInput(value = "") {
  const cleaned = String(value || "").replace(/[^0-9.]/g, "");
  const [whole = "", ...rest] = cleaned.split(".");
  const decimal = rest.join("").replace(/\D/g, "").slice(0, 2);
  const cappedWhole = whole.replace(/\D/g, "").slice(0, 3);
  const nextValue = rest.length > 0 ? `${cappedWhole}.${decimal}` : cappedWhole;
  const numericValue = Number(nextValue);
  if (Number.isFinite(numericValue) && numericValue > 200) {
    return "200.00";
  }
  return nextValue;
}

function getPasswordStrength(password = "") {
  const checks = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[a-z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ];
  const score = checks.filter(Boolean).length;
  if (!password) return { label: "Not started", width: "0%", color: "bg-[#D8E8EA]" };
  if (score <= 2) return { label: "Weak", width: "35%", color: "bg-[#D95A6A]" };
  if (score <= 4) return { label: "Good", width: "70%", color: "bg-[#F4C16A]" };
  return { label: "Strong", width: "100%", color: "bg-[#2D9B9B]" };
}

function buildPetFormFromRecord(record = {}) {
  const savedPetType = record.petType || "";
  const petType = petTypeOptions.includes(savedPetType) ? savedPetType : "";
  const customPetType = "";
  const breedOptions = breedsByPetType[petType] || [];
  const savedBreed = record.breed || "";
  const breed = breedOptions.includes(savedBreed) ? savedBreed : savedBreed ? "Other" : "";
  const customBreed = breed === "Other" && savedBreed !== "Other" ? savedBreed : "";

  return {
    id: record.id || "",
    petName: record.petName || "",
    petType,
    customPetType,
    breed,
    customBreed,
    ageValue: record.ageValue || "",
    ageUnit: record.ageUnit || "months",
    weightKg: record.weightKg || "",
    notes: record.notes || "",
    gender: ["Male", "Female"].includes(record.gender) ? record.gender : "",
    photoURL: record.photoURL || "",
  };
}

function formatNotificationDate(value) {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function MetricCard({ label, value, description }) {
  return (
    <div className="rounded-[26px] bg-white p-5 shadow-[0_14px_30px_rgba(94,81,60,0.1)]">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#7A979C]">{label}</p>
      <p className="mt-3 text-4xl font-bold text-[#20343B]">{value}</p>
      <p className="mt-2 text-sm leading-6 text-[#607277]">{description}</p>
    </div>
  );
}

function NotificationDropdown({ notifications, currentUserId, onReadNotification, onReadAllNotifications }) {
  const [isOpen, setIsOpen] = useState(true);
  const visibleCount = Math.min(notifications.length, 3);
  const unreadCount = notifications.filter((notification) => !notification.readBy.includes(currentUserId)).length;

  return (
    <section className="rounded-[24px] bg-white p-5 shadow-[0_16px_32px_rgba(102,91,72,0.12)]">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={isOpen}
      >
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <span className="inline-flex shrink-0 items-center gap-2">
            <Bell size={20} className="shrink-0 text-[#2D6B73]" />
            <span className="text-base font-semibold text-[#20343B]">Notifications</span>
          </span>
          {unreadCount > 0 && (
            <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-[#EAF4F4] px-3 py-1 text-xs font-semibold text-[#2D6A73]">
              {unreadCount} unread
            </span>
          )}
        </span>
        <ChevronDown
          size={20}
          className={`shrink-0 text-[#607277] transition ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onReadAllNotifications}
            disabled={unreadCount === 0}
            className="rounded-xl bg-[#EEF6F6] px-3 py-2 text-xs font-semibold text-[#24444A] transition hover:bg-[#E3F0F0] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Mark all as Read
          </button>
        </div>
        <div className="mt-4 max-h-[330px] space-y-3 overflow-y-auto pr-1">
          {notifications.length === 0 ? (
            <EmptyState
              title="No notifications yet"
              message="Booking confirmations and appointment updates will appear here."
            />
          ) : (
            notifications.map((notification) => {
              const isUnread = !notification.readBy.includes(currentUserId);

              return (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => onReadNotification(notification.id)}
                  className={`w-full rounded-[18px] border px-4 py-3 text-left transition ${
                    isUnread
                      ? "border-[#2D9B9B] bg-[#F5FBFB]"
                      : "border-[#E6EFEE] bg-[#FBFDFC]"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-[#20343B]">{notification.title}</p>
                    <StatusChip label={notification.actionLabel} />
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[#607277]">{notification.message}</p>
                  <p className="mt-3 text-xs text-[#7A9297]">
                    {formatNotificationDate(notification.createdAt)}
                  </p>
                </button>
              );
            })
          )}
        </div>
        </>
      )}

      {isOpen && notifications.length > visibleCount && (
        <p className="mt-3 text-xs font-semibold text-[#607277]">
          Showing 3 at a time. Scroll inside this panel for newer appointment updates.
        </p>
      )}
    </section>
  );
}

function MetricButton({ label, value, description, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[26px] bg-white p-5 text-left shadow-[0_14px_30px_rgba(94,81,60,0.1)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(94,81,60,0.14)]"
    >
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#7A979C]">{label}</p>
      <p className="mt-3 text-4xl font-bold text-[#20343B]">{value}</p>
      <p className="mt-2 text-sm leading-6 text-[#607277]">{description}</p>
    </button>
  );
}

function EmptyState({ title, message }) {
  return (
    <div className="rounded-[24px] border border-dashed border-[#D7E5E5] bg-[#FBFDFC] px-6 py-10 text-center">
      <h3 className="text-lg font-semibold text-[#20343B]">{title}</h3>
      <p className="mt-2 text-sm text-[#607277]">{message}</p>
    </div>
  );
}

export function CustomerProfile() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const { currentUser, isAuthenticated, isLoading, signOut, updateProfile } = useAuth();
  const {
    markNotificationRead,
    markAllNotificationsRead,
    deletePetRecord,
    savePetRecord,
    state,
    updateAppointment,
    visibleNotifications,
    kaponPromo,
    kaponPromoAvailable,
    kaponPromoReady,
    kaponPromoError,
  } = useApp();
  const customer = currentUser?.role === "customer" ? currentUser : null;
  const [activeTab, setActiveTab] = useState(() => {
    const requested = searchParams.get("tab") || location.hash.replace("#", "");
    const tab = requested === "booking" ? "services" : requested;
    return dashboardTabs.some((item) => item.id === tab) ? tab : "overview";
  });
  const [profileForm, setProfileForm] = useState({
    fullName: "",
    username: "",
    email: "",
    phone: "",
    status: "active",
  });
  const [petForm, setPetForm] = useState(() => buildEmptyPetForm());
  const [selectedAppointmentId, setSelectedAppointmentId] = useState("");
  const [appointmentFilter, setAppointmentFilter] = useState("All");
  const [appointmentSearch, setAppointmentSearch] = useState("");
  const [appointmentPage, setAppointmentPage] = useState(0);
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingPet, setIsSavingPet] = useState(false);
  const [profileVerificationPassword, setProfileVerificationPassword] = useState("");
  const [profileConfirmationError, setProfileConfirmationError] = useState("");
  const [showProfileVerificationPassword, setShowProfileVerificationPassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current: "", next: "", confirm: "" });
  const [passwordVisibility, setPasswordVisibility] = useState({
    current: false,
    next: false,
    confirm: false,
  });
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [pendingProfilePayload, setPendingProfilePayload] = useState(null);
  const [preselectedServiceId, setPreselectedServiceId] = useState("");
  const [bookingScrollRequest, setBookingScrollRequest] = useState(0);
  const bookingSectionRef = useRef(null);
  const petSectionRef = useRef(null);
  const [petTextErrors, setPetTextErrors] = useState({});
  const [pendingBookingServiceId, setPendingBookingServiceId] = useState("");
  useEffect(() => {
    if (activeTab === "overview" && (pendingBookingServiceId || new URLSearchParams(location.search).has("addPet"))) {
      petSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      petSectionRef.current?.querySelector("input")?.focus({ preventScroll: true });
    }
  }, [activeTab, pendingBookingServiceId, location.search]);

  useEffect(() => {
    if (activeTab !== "services") {
      setPreselectedServiceId("");
      return;
    }
    if (!preselectedServiceId) return;
    const frame = window.requestAnimationFrame(() => {
      bookingSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, preselectedServiceId, bookingScrollRequest]);

  useEffect(() => {
    const tabFromQuery = searchParams.get("tab") || "";
    const legacyTabFromHash = location.hash.replace("#", "");
    const normalizedTabFromQuery = tabFromQuery === "booking" ? "services" : tabFromQuery;
    const normalizedLegacyTab = legacyTabFromHash === "booking" ? "services" : legacyTabFromHash;
    const nextTab = dashboardTabs.some((tab) => tab.id === normalizedTabFromQuery)
      ? normalizedTabFromQuery
      : dashboardTabs.some((tab) => tab.id === normalizedLegacyTab)
        ? normalizedLegacyTab
        : "";

    if (nextTab) {
      setActiveTab(nextTab);
      if (location.hash) {
        navigate(`/customer/dashboard?tab=${nextTab}`, { replace: true });
      }
    }
  }, [location.hash, navigate, searchParams]);

  useEffect(() => {
    if (!customer) {
      return;
    }

    setProfileForm({
      fullName: customer.fullName || customer.name || "",
      username: customer.username || "",
      email: customer.email || "",
      phone: formatPhilippineMobileNumber(customer.phone || "") || customer.phone || "",
      status: customer.status || "active",
    });
  }, [customer]);

  const customerPetRecords = useMemo(
    () =>
      state.petRecords.filter(
        (record) =>
          customer &&
          record?.id &&
          record.petName?.trim() &&
          (record.customerId === customer.uid ||
            record.customerEmail?.toLowerCase() === customer.email?.toLowerCase()),
      ),
    [customer?.email, customer?.uid, state.petRecords],
  );
  const customerAppointments = useMemo(
    () =>
      state.appointments
        .filter(
          (appointment) =>
            appointment.customerId === customer?.uid ||
            appointment.customerEmail?.toLowerCase() === customer?.email?.toLowerCase(),
        )
        .sort(compareAppointmentSchedule),
    [customer?.email, customer?.uid, state.appointments],
  );
  const filteredCustomerAppointments = filterAppointmentList(customerAppointments, appointmentFilter, appointmentSearch);
  const pagedAppointments = paginateAppointmentList(filteredCustomerAppointments, appointmentPage);
  const selectedAppointment =
    filteredCustomerAppointments.find((appointment) => appointment.id === selectedAppointmentId) ||
    pagedAppointments.appointments[0] ||
    null;
  const currentCustomerId = customer?.id || customer?.uid;
  const unreadNotificationCount = currentCustomerId
    ? visibleNotifications.filter((notification) => !notification.readBy.includes(currentCustomerId)).length
    : 0;
  const upcomingAppointments = customerAppointments.filter((appointment) =>
    ["Pending", "Confirmed", "Accepted"].includes(appointment.status),
  );
  const editingPetRecord = petForm.id
    ? customerPetRecords.find((record) => record.id === petForm.id) || null
    : null;
  const petFormChanged = editingPetRecord
    ? JSON.stringify(buildPetFormFromRecord(editingPetRecord)) !== JSON.stringify(petForm)
    : Boolean(
        petForm.petName.trim() ||
          petForm.petType.trim() ||
          petForm.customPetType.trim() ||
          petForm.breed.trim() ||
          petForm.customBreed.trim() ||
          petForm.ageValue.trim() ||
          petForm.weightKg.trim() ||
          petForm.notes.trim() ||
          petForm.gender ||
          petForm.photoURL,
      );
  const petBreedOptions = breedsByPetType[petForm.petType] || [];
  const petCardGridClass =
    "grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),17rem))] items-start gap-4";
  const passwordStrength = getPasswordStrength(passwordForm.next);

  useEffect(() => {
    if (activeTab === "appointments" && !selectedAppointmentId && pagedAppointments.appointments[0]) {
      setSelectedAppointmentId(pagedAppointments.appointments[0].id);
    }
  }, [activeTab, pagedAppointments.appointments, selectedAppointmentId]);

  if (!isLoading && (!isAuthenticated || !customer)) {
    return <Navigate to="/login" replace />;
  }

  const openTab = (tabId) => {
    const nextTab = tabId === "booking" ? "services" : tabId;
    setPreselectedServiceId("");
    setActiveTab(nextTab);
    navigate(nextTab === "overview" ? "/customer/dashboard" : `/customer/dashboard?tab=${nextTab}`, { replace: true });
    setFeedback({ type: "", message: "" });
  };

  const handleProfileChange = (field) => (event) => {
    const value = field === "phone"
      ? formatPhilippineMobileInput(event.target.value)
      : field === "username"
        ? event.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 24)
        : event.target.value;
    setProfileForm((current) => ({ ...current, [field]: value }));
  };

  const handlePetTypeChange = (event) => {
    const value = event.target.value;
    setPetForm((current) => ({
      ...current,
      petType: value,
      customPetType: "",
      breed: "",
      customBreed: "",
    }));
  };

  const handleBreedChange = (event) => {
    const value = event.target.value;
    setPetForm((current) => ({
      ...current,
      breed: value,
      customBreed: value === "Other" ? current.customBreed : "",
    }));
  };

  const handlePetPhotoChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      const message = "Choose an image file for the pet photo.";
      setFeedback({ type: "error", message });
      toast.error(message);
      event.target.value = "";
      return;
    }

    if (file.size > 1024 * 1024) {
      const message = "Pet photo must be 1 MB or smaller.";
      setFeedback({ type: "error", message });
      toast.error(message);
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setPetForm((current) => ({ ...current, photoURL: String(reader.result || "") }));
      setFeedback({ type: "", message: "" });
    };
    reader.readAsDataURL(file);
  };

  const buildProfilePayload = (overrides = {}) => ({
    fullName: profileForm.fullName.trim(),
    username: profileForm.username.trim(),
    email: profileForm.email.trim().toLowerCase(),
    phone: normalizePhilippineMobileNumber(profileForm.phone),
    ...overrides,
  });

  const applySavedProfile = (user, message, options = {}) => {
    setProfileForm({
      fullName: user.fullName || user.name || "",
      username: user.username || "",
      email: user.email || "",
      phone: formatPhilippineMobileNumber(user.phone || "") || user.phone || "",
      status: user.status || "active",
    });
    setFeedback({ type: "success", message });
    if (options.notify !== false) {
      toast.success(message);
    }
  };

  const validateProfileForm = () => {
    const textErrors = getTextValidationErrors(profileForm, ACCOUNT_TEXT_FIELDS);
    if (Object.keys(textErrors).length) {
      const message = Object.values(textErrors)[0];
      setFeedback({ type: "error", message });
      toast.error(message);
      return false;
    }
    if (isSavingProfile) {
      return false;
    }

    if (!profileForm.fullName.trim() || !profileForm.email.trim() || !profileForm.username.trim()) {
      const message = "Full name, username, and email are required.";
      setFeedback({ type: "error", message });
      toast.error(message);
      return false;
    }

    if (!isValidEmail(profileForm.email)) {
      const message = ILLEGITIMATE_EMAIL_ERROR;
      setFeedback({ type: "error", message });
      toast.error(message);
      return false;
    }

    if (!normalizePhilippineMobileNumber(profileForm.phone)) {
      const message = PH_MOBILE_ERROR;
      setFeedback({ type: "error", message });
      toast.error(message);
      return false;
    }

    return true;
  };

  const saveProfile = (event) => {
    event.preventDefault();

    if (!validateProfileForm()) {
      return;
    }

    setProfileVerificationPassword("");
    setShowProfileVerificationPassword(false);
    setProfileConfirmationError("");
    setPendingProfilePayload(buildProfilePayload());
  };

  const confirmProfileSave = async () => {
    if (!pendingProfilePayload || isSavingProfile) {
      return;
    }

    if (!profileVerificationPassword) {
      setProfileConfirmationError("Enter your current password to authorize these changes.");
      return;
    }
    setProfileConfirmationError("");
    setIsSavingProfile(true);

    try {
      const result = await updateProfile({
        ...pendingProfilePayload,
        requireProfileVerification: true,
        verificationPassword: profileVerificationPassword,
      });

      if (!result.ok) {
        setProfileConfirmationError(result.error);
        setFeedback({ type: "error", message: result.error });
        toast.error(result.error);
        return;
      }

      applySavedProfile(result.user, "Customer profile updated successfully.");
      setProfileVerificationPassword("");
      setPendingProfilePayload(null);
      setShowProfileVerificationPassword(false);
    } finally {
      setIsSavingProfile(false);
    }
  };

  const savePassword = async (event) => {
    event.preventDefault();
    if (isChangingPassword) return;
    if (passwordForm.current && passwordForm.next && passwordForm.current === passwordForm.next) {
      const message = "New password must be different from your current password.";
      setFeedback({ type: "error", message });
      toast.error(message);
      return;
    }
    setIsChangingPassword(true);
    try {
      await changeCustomerPassword(passwordForm.current, passwordForm.next, passwordForm.confirm);
      setPasswordForm({ current: "", next: "", confirm: "" });
      setFeedback({ type: "success", message: "Password changed successfully." });
      toast.success("Password changed successfully.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to change your password.";
      setFeedback({ type: "error", message });
      toast.error(message);
    } finally {
      setIsChangingPassword(false);
    }
  };

  const savePet = async (event) => {
    event.preventDefault();
    if (isSavingPet) {
      return;
    }

    const textErrors = getPetTextErrors(petForm);
    setPetTextErrors(textErrors);
    if (Object.keys(textErrors).length) {
      const message = Object.values(textErrors)[0];
      setFeedback({ type: "error", message });
      toast.error(message);
      petSectionRef.current?.querySelector(`[name="${Object.keys(textErrors)[0]}"]`)?.focus();
      return;
    }

    if (!petForm.petName.trim() || !petForm.petType.trim() || !petForm.breed.trim()) {
      const message = "Pet name, pet type, and breed are required.";
      setFeedback({ type: "error", message });
      toast.error(message);
      return;
    }

    if (petForm.breed === "Other" && !petForm.customBreed.trim()) {
      const message = "Specify the custom breed.";
      setFeedback({ type: "error", message });
      toast.error(message);
      return;
    }

    if (!["Male", "Female"].includes(petForm.gender)) {
      const message = "Select Male or Female for pet gender.";
      setFeedback({ type: "error", message });
      toast.error(message);
      return;
    }

    setIsSavingPet(true);
    setFeedback({ type: "", message: "" });
    const existingRecord = customerPetRecords.find((record) => record.id === petForm.id);
    const resolvedPetType = petForm.petType.trim();
    const resolvedBreed =
      petForm.breed === "Other" ? petForm.customBreed.trim() : petForm.breed.trim();
    const nextRecord = {
      id: petForm.id || undefined,
      customerId: customer?.uid || "",
      customerEmail: customer?.email || "",
      ownerName: profileForm.fullName,
      petName: petForm.petName.trim(),
      petType: resolvedPetType,
      breed: resolvedBreed,
      ageValue: petForm.ageValue.trim(),
      ageUnit: petForm.ageUnit,
      weightKg: petForm.weightKg.trim(),
      lastVisit: existingRecord?.lastVisit || "",
      visitRecords: existingRecord?.visitRecords || [],
      medicalRecords: existingRecord?.medicalRecords || [],
      notes: petForm.notes,
      gender: petForm.gender,
      photoURL: petForm.photoURL,
      updatedAt: new Date().toISOString(),
    };

    try {
      await savePetRecord(nextRecord, profileForm.fullName);
      const saveMessage = "Pet record saved successfully.";
      setPetForm(buildEmptyPetForm());
      setIsSavingPet(false);
      setFeedback({ type: "success", message: saveMessage });
      toast.success(saveMessage);

      if (pendingBookingServiceId) {
        const serviceId = pendingBookingServiceId;
        setPendingBookingServiceId("");
        openTab("services");
        if (serviceId !== KAPON_SERVICE_ID || kaponPromoAvailable) setPreselectedServiceId(serviceId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save pet record. Please try again.";
      console.error("[customer-profile] Pet record save failed.", error);
      setFeedback({ type: "error", message });
      toast.error(message);
    } finally {
      setIsSavingPet(false);
    }
  };

  const removePet = async (record) => {
    if (!record?.id || isSavingPet) {
      return;
    }

    const confirmed = window.confirm(`Are you sure? All information for ${record.petName} will be deleted. Pending and approved appointments for this pet will also be deleted, and their reserved slots will become available again.`);
    if (!confirmed) {
      return;
    }

    setIsSavingPet(true);
    try {
      await Promise.resolve(deletePetRecord(record.id, profileForm.fullName));
      if (petForm.id === record.id) {
        setPetForm(buildEmptyPetForm());
      }
      const message = "Pet profile and its pending/approved appointments deleted. Reserved slots are available again.";
      setFeedback({ type: "success", message });
      toast.success(message);
    } catch (error) {
      const message = error.message || "Unable to delete pet profile. Please try again.";
      console.error("[customer-profile] Pet record delete failed.", error);
      setFeedback({ type: "error", message });
      toast.error(message);
    } finally {
      setIsSavingPet(false);
    }
  };

  const cancelAppointment = async (appointmentId) => {
    const appointment = customerAppointments.find((item) => item.id === appointmentId);
    if (!canCancelAppointment(appointment)) {
      const message = "Same-day appointments can only be cancelled before the scheduled time.";
      setFeedback({ type: "error", message });
      toast.error(message);
      return;
    }

    const confirmed = window.confirm("Cancel this appointment? This will update the clinic queue and notify the portal team.");
    if (!confirmed) {
      return;
    }

    try {
      await updateAppointment(appointmentId, { status: "Cancelled" }, profileForm.fullName);
      const message = "Appointment cancelled. The clinic queue has been updated.";
      setFeedback({ type: "success", message });
      toast.success(message);
    } catch (error) {
      const message = error?.message || "Unable to cancel this appointment. Please try again.";
      setFeedback({ type: "error", message });
      toast.error(message);
    }
  };

  const continueToBooking = (serviceId) => {
    if (serviceId === KAPON_SERVICE_ID && !kaponPromoAvailable) {
      toast.error(KAPON_UNAVAILABLE_MESSAGE);
      return;
    }
    if (customerPetRecords.length === 0) {
      setPendingBookingServiceId(serviceId);
      openTab("overview");
      setFeedback({ type: "info", message: "Create a pet profile first, then continue booking." });
      return;
    }
    // Keep the mounted form when choosing another card within this tab.
    if (activeTab !== "services") openTab("services");
    setPreselectedServiceId(serviceId);
    // A repeat click on the same card must also scroll back to the form.
    setBookingScrollRequest((request) => request + 1);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-[#F6F0E7] px-4 py-6 sm:px-6 md:py-8">
      <div className="w-full min-w-0 space-y-6">
        <section
          aria-label="Customer welcome"
          className="rounded-[28px] bg-[linear-gradient(135deg,#173E44_0%,#2D6B73_58%,#82C8C0_100%)] p-4 text-white shadow-[0_20px_44px_rgba(20,43,46,0.18)] md:p-5"
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white/70">
                  Customer Dashboard
                </p>
                <h1 className="mt-2 truncate text-3xl font-semibold md:text-4xl">
                  Hi, {profileForm.username || customer?.username || "Customer"}
                </h1>
                <p className="mt-1 truncate text-sm text-white/72">{profileForm.email}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusChip label={profileForm.status} />
              <StatusChip label={`${customerPetRecords.length} pets`} />
              <StatusChip label={`${customerAppointments.length} appointments`} />
              {unreadNotificationCount > 0 && <StatusChip label={`${unreadNotificationCount} unread`} />}
            </div>
          </div>

          {profileForm.status !== "active" && (
            <div className="mt-6 rounded-[24px] border border-[#F4B7BE] bg-[#FFF1F3] px-5 py-4 text-sm text-[#8A3240]">
              Your account is currently suspended. You can still review your profile, but new
              bookings are disabled until the clinic reactivates your account.
            </div>
          )}
        </section>


        <div className="grid items-start gap-6 lg:grid-cols-[224px_minmax(0,1fr)]">
          <aside className="self-start rounded-2xl bg-white p-3 shadow-[0_14px_30px_rgba(102,91,72,0.1)] lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto">
            <nav className="grid gap-2">
              {dashboardTabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => openTab(tab.id)}
                      className={`flex items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold transition ${
                      isActive
                        ? "bg-[#2D9B9B] text-white shadow-[0_12px_24px_rgba(45,155,155,0.25)]"
                        : "text-[#365057] hover:bg-[#E9F3F3]"
                    }`}
                  >
                    <Icon size={18} />
                    {tab.label}
                  </button>
                );
              })}
            </nav>
            <button
              type="button"
              onClick={handleSignOut}
              className="mt-3 w-full rounded-xl border border-[#D9E7E7] px-4 py-3 text-sm font-semibold text-[#24444A] transition hover:bg-[#F4FBFB]"
            >
              Log Out
            </button>
          </aside>

          <main className="min-w-0">
            {activeTab === "overview" && (
              <div className="space-y-5">
                <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="min-w-0 space-y-5">
                  {kaponPromoAvailable && <KaponPromoBanner promo={kaponPromo} />}
                  <article aria-label="Low-Cost Kapon service" className="min-w-0 rounded-[24px] border border-[#D9E7E7] bg-white p-5 shadow-[0_18px_36px_rgba(102,91,72,0.12)] sm:p-6">
                    <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                      <BrandMark className="h-24 w-24 shrink-0 self-start rounded-2xl bg-[#EAF6F6] p-3" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-3">
                          <h2 className="text-xl font-semibold text-[#20343B]">Low-Cost Kapon</h2>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-[#607277]">{kaponService.description}</p>
                        <p className="mt-3 text-xs font-semibold text-[#2D6B73]">Estimated visit time: {kaponService.duration}</p>
                        <p role="status" className={`mt-2 text-sm font-semibold ${kaponPromoAvailable ? "text-[#1D7C45]" : "text-[#607277]"}`}>
                          Status: {kaponPromoAvailable ? "Available" : kaponPromoError ? "Promotion availability could not be verified" : !kaponPromoReady ? "Checking promotion availability..." : "Currently unavailable"}
                        </p>
                      </div>
                    </div>
                  </article>
                  <section className="min-w-0 rounded-[24px] bg-white p-6 shadow-[0_18px_36px_rgba(102,91,72,0.12)]">
                    <div>
                      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#7B9A9F]">
                        Next step
                      </p>
                      <h2 className="mt-2 text-2xl font-semibold text-[#20343B]">
                        To book a service, please fill out the 'Add Pet' form.
                      </h2>
                      <p className="mt-3 max-w-2xl text-sm leading-6 text-[#607277]">
                        Add your pet details first, then continue to service selection and appointment booking.
                      </p>
                    </div>
                  </section>

                <section ref={petSectionRef} className="@container min-w-0 scroll-mt-24 rounded-[30px] bg-white p-4 shadow-[0_18px_36px_rgba(102,91,72,0.12)] sm:p-6">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#7B9A9F]">
                        Pet widget
                      </p>
                      <h2 className="mt-2 text-2xl font-semibold text-[#20343B]">
                        Add pet
                      </h2>
                    </div>
                  </div>

                  <div className="mt-6 grid grid-cols-1 items-start gap-5 @min-[32rem]:grid-cols-[minmax(240px,280px)_minmax(0,1fr)] @min-[48rem]:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
                    <form onSubmit={savePet} className="min-w-0 rounded-[20px] bg-[#FBFDFC] p-4 sm:p-5 [&_input]:min-w-0 [&_select]:min-w-0 [&_textarea]:min-w-0">
                      <div className="grid gap-4">
                        <input
                          name="petName"
                          aria-label="Pet name"
                          aria-invalid={Boolean(petTextErrors.petName)}
                          aria-describedby={petTextErrors.petName ? "pet-name-error" : undefined}
                          value={petForm.petName}
                          autoComplete="off"
                          onChange={(event) => {
                            setPetForm((current) => ({ ...current, petName: event.target.value }));
                            setPetTextErrors((current) => ({ ...current, petName: undefined }));
                          }}
                          maxLength={60}
                          className="rounded-[18px] border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                          placeholder="Pet name"
                        />
                        {petTextErrors.petName && <p id="pet-name-error" role="alert" className="text-sm text-[#B23949]">{petTextErrors.petName}</p>}
                        <select
                          value={petForm.petType}
                          onChange={handlePetTypeChange}
                          className="rounded-[18px] border border-[#D9E7E7] bg-white px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                        >
                          <option value="">Select pet type</option>
                          {petTypeOptions.map((petType) => (
                            <option key={petType} value={petType}>
                              {petType}
                            </option>
                          ))}
                        </select>
                        <select
                          value={petForm.breed}
                          onChange={handleBreedChange}
                          disabled={!petForm.petType}
                          className="rounded-[18px] border border-[#D9E7E7] bg-white px-4 py-3 outline-none transition focus:border-[#2D9B9B] disabled:cursor-not-allowed disabled:bg-[#F1F5F5] disabled:text-[#91A0A3]"
                        >
                          <option value="">
                            {petForm.petType ? "Select breed" : "Select pet type first"}
                          </option>
                          {petBreedOptions.map((breed) => (
                            <option key={breed} value={breed}>
                              {breed}
                            </option>
                          ))}
                        </select>
                        {petForm.breed === "Other" && (
                          <input
                            value={petForm.customBreed}
                            autoComplete="off"
                            onChange={(event) =>
                              setPetForm((current) => ({ ...current, customBreed: event.target.value }))
                            }
                            maxLength={60}
                            className="rounded-[18px] border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                            placeholder="Specify breed"
                          />
                        )}
                        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                          <input
                            value={petForm.ageValue}
                            autoComplete="off"
                            onChange={(event) =>
                              setPetForm((current) => ({
                                ...current,
                                ageValue: normalizeAgeInput(event.target.value, current.ageUnit),
                              }))
                            }
                            inputMode="numeric"
                            maxLength={2}
                            className="rounded-[18px] border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                            placeholder="Age"
                          />
                          <select
                            value={petForm.ageUnit}
                            onChange={(event) =>
                              setPetForm((current) => ({
                                ...current,
                                ageUnit: event.target.value,
                                ageValue: normalizeAgeInput(current.ageValue, event.target.value),
                              }))
                            }
                            className="rounded-[18px] border border-[#D9E7E7] bg-white px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                          >
                            <option value="months">Months</option>
                            <option value="years">Years</option>
                          </select>
                        </div>
                        <label className="flex items-center overflow-hidden rounded-[18px] border border-[#D9E7E7] bg-white transition focus-within:border-[#2D9B9B]">
                          <input
                            value={petForm.weightKg}
                            autoComplete="off"
                            onChange={(event) =>
                              setPetForm((current) => ({
                                ...current,
                                weightKg: normalizeWeightInput(event.target.value),
                              }))
                            }
                            inputMode="decimal"
                            maxLength={6}
                            className="min-w-0 flex-1 px-4 py-3 outline-none"
                            placeholder="000.00"
                          />
                          <span className="shrink-0 border-l border-[#E2ECEC] bg-[#F6FAFA] px-4 py-3 text-sm font-semibold text-[#33545A]">
                            kg
                          </span>
                        </label>
                        <label className="grid gap-2 text-sm font-medium text-[#425A60]">
                          Pet gender
                          <select required value={petForm.gender}
                            onChange={(event) => setPetForm((current) => ({ ...current, gender: event.target.value }))}
                            className="rounded-[18px] border border-[#D9E7E7] bg-white px-4 py-3 outline-none focus:border-[#2D9B9B]">
                            <option value="" disabled>Select pet gender</option>
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                          </select>
                        </label>
                        <textarea
                          name="notes"
                          aria-label="Notes for staff or future visits"
                          aria-invalid={Boolean(petTextErrors.notes)}
                          aria-describedby={petTextErrors.notes ? "pet-notes-error" : undefined}
                          value={petForm.notes}
                          onChange={(event) => {
                            setPetForm((current) => ({ ...current, notes: event.target.value }));
                            setPetTextErrors((current) => ({ ...current, notes: undefined }));
                          }}
                          maxLength={500}
                          className="min-h-28 rounded-[18px] border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                          placeholder="Notes for staff or future visits"
                        />
                        {petTextErrors.notes && <p id="pet-notes-error" role="alert" className="text-sm text-[#B23949]">{petTextErrors.notes}</p>}
                        <label className="grid gap-2 text-sm font-medium text-[#425A60]">
                          Pet photo (optional)
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handlePetPhotoChange}
                            className="rounded-[18px] border border-[#D9E7E7] bg-white px-4 py-3 text-sm outline-none transition file:mr-3 file:rounded-xl file:border-0 file:bg-[#EEF6F6] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[#2B555C] focus:border-[#2D9B9B]"
                          />
                        </label>
                        {petForm.photoURL && (
                          <div className="rounded-[18px] border border-[#D9E7E7] bg-white p-3">
                            <img
                              src={petForm.photoURL}
                              alt={`${petForm.petName || "Pet"} preview`}
                              className="h-32 w-full rounded-[14px] object-cover"
                            />
                            <button
                              type="button"
                              onClick={() => setPetForm((current) => ({ ...current, photoURL: "" }))}
                              className="mt-3 rounded-xl bg-[#FBECEF] px-3 py-2 text-sm font-semibold text-[#B23949]"
                            >
                              Remove photo
                            </button>
                          </div>
                        )}
                        <div className="flex flex-wrap gap-3">
                          <button
                            type="submit"
                            disabled={isSavingPet || !petFormChanged}
                            className="rounded-[18px] bg-[#173E44] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#9CB5B8]"
                          >
                            {isSavingPet
                              ? "Saving pet..."
                              : petForm.id
                                ? "Save changes"
                                : "Save pet"}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setPetForm(buildEmptyPetForm()); setPetTextErrors({}); }}
                            disabled={isSavingPet}
                            className="rounded-[18px] bg-[#EEF6F6] px-5 py-3 text-sm font-semibold text-[#2B555C]"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    </form>

                    <div className="min-w-0 space-y-5">
                      <div>
                        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#7B9A9F]">
                          Saved pets
                        </p>
                        <div className={`mt-3 ${petCardGridClass}`}>
                          {customerPetRecords.map((record) => {
                            return (
                              <div
                                key={record.id}
                                className="flex min-h-[13rem] min-w-0 flex-col overflow-hidden rounded-lg border border-[#E6EFEE] bg-[#FBFDFC] p-3.5 text-left transition hover:border-[#2D9B9B]"
                              >
                                <div className="flex min-w-0 items-start gap-3">
                                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[#EEF6F6] text-[#2D6B73]">
                                    {record.photoURL ? (
                                      <img
                                        src={record.photoURL}
                                        alt=""
                                        className="h-full w-full object-cover"
                                      />
                                    ) : (
                                      <PawPrint size={18} />
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    <h3 className="truncate text-base font-semibold text-[#20343B]">
                                      {containsInappropriatePetText(record.petName) ? "Pet name needs review" : record.petName}
                                    </h3>
                                    <div className="mt-1 flex flex-wrap gap-1.5">
                                      <StatusChip label={record.petType} />
                                      {record.gender && <StatusChip label={record.gender} />}
                                    </div>
                                  </div>
                                </div>
                                <p className="mt-3 line-clamp-2 text-sm leading-5 text-[#607277]">
                                  {[
                                    record.breed || "Breed not specified",
                                    record.ageValue ? `${record.ageValue} ${record.ageUnit || "months"} old` : "",
                                    record.weightKg ? `${record.weightKg} kg` : "",
                                  ].filter(Boolean).join(" | ")}
                                </p>
                                {record.notes && (
                                  <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm leading-6 text-[#50666B]">
                                    {containsInappropriatePetText(record.notes) ? "Notes hidden: inappropriate language. Please edit this pet record." : record.notes}
                                  </p>
                                )}
                                <div className="mt-auto flex flex-wrap gap-2 pt-3">
                                  <button
                                    type="button"
                                    onClick={() => { setPetForm(buildPetFormFromRecord(record)); setPetTextErrors({}); }}
                                    className="rounded-xl bg-[#EEF6F6] px-3 py-2 text-sm font-semibold text-[#2B555C]"
                                  >
                                    Edit pet
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => removePet(record)}
                                    className="inline-flex items-center gap-2 rounded-xl bg-[#FBECEF] px-3 py-2 text-sm font-semibold text-[#B23949]"
                                  >
                                    <Trash2 size={15} />
                                    Delete
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
                  </div>
                  <div className="min-w-0 space-y-5">
                    <section className="rounded-[24px] bg-white p-5 shadow-[0_18px_36px_rgba(102,91,72,0.12)]">
                      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#7B9A9F]">
                        Booking
                      </p>
                      <h2 className="mt-2 text-xl font-semibold text-[#20343B]">
                        Choose a service and book your pet's appointment.
                      </h2>
                      <div className="mt-5 grid gap-3">
                        <button
                          type="button"
                          onClick={() => openTab("services")}
                          className="rounded-2xl bg-[#173E44] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#235A61]"
                        >
                          Choose service &amp; book
                        </button>
                      </div>
                    </section>
                    <NotificationDropdown
                      notifications={visibleNotifications}
                      currentUserId={currentCustomerId}
                      onReadNotification={markNotificationRead}
                      onReadAllNotifications={markAllNotificationsRead}
                    />
                  </div>
                </div>

              </div>
            )}

            {activeTab === "services" && (
              <section className="rounded-2xl bg-white p-5 shadow-[0_14px_30px_rgba(102,91,72,0.1)]">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#7B9A9F]">
                  Services
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-[#20343B]">
                  Appointment-ready services for clinic visits, wellness care, and grooming.
                </h2>
                <div className="mt-4 grid gap-3 rounded-2xl border border-[#DDEAEA] bg-[#F8FCFC] p-4 sm:grid-cols-2 xl:grid-cols-3">
                  {bookingRules.map((rule, index) => (
                    <div key={rule.title} className="flex min-w-0 gap-3">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#13A55A]" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#20343B]">
                          {index + 1}. {rule.title}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-[#607277]">{rule.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-5 grid auto-rows-fr gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {serviceCatalog.map((service) => (
                    <article
                      key={service.id}
                      className="flex h-full flex-col rounded-2xl border border-[#E6EFEE] bg-[#FCFEFE] p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7A979C]">
                            {service.category}
                          </p>
                          <h3 className="mt-1 text-lg font-semibold text-[#20343B]">
                            {service.name}
                          </h3>
                        </div>

                      </div>
                      <p className="mt-3 flex-1 text-sm leading-6 text-[#607277]">{service.description}</p>
                      <p className="mt-3 text-xs font-semibold text-[#2D6B73]">
                        Estimated visit time: {service.duration}
                      </p>
                      {service.id === KAPON_SERVICE_ID && !kaponPromoAvailable && (
                        <p className="mt-3 text-xs font-semibold text-[#607277]" role="status">
                          {kaponPromoError ? "Promotion availability could not be verified." : !kaponPromoReady ? "Checking promotion availability..." : "Currently unavailable"}
                        </p>
                      )}
                      {service.id === KAPON_SERVICE_ID ? (
                        kaponPromoAvailable ? <a href={kaponPromo.formLink} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-[#173E44] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#235A61]">Register Now</a>
                          : <button type="button" disabled className="mt-4 w-full rounded-xl bg-[#E6EFEE] px-4 py-3 text-sm font-semibold text-[#607277] disabled:cursor-not-allowed">Register Now</button>
                      ) : <button
                        type="button"
                        onClick={() => continueToBooking(service.id)}
                        disabled={service.id === KAPON_SERVICE_ID && !kaponPromoAvailable}
                        className="mt-4 w-full cursor-pointer rounded-xl bg-[#173E44] px-4 py-3 text-sm font-semibold text-white transition duration-200 enabled:hover:scale-[1.03] enabled:hover:bg-[#235A61] disabled:cursor-not-allowed disabled:bg-[#E6EFEE] disabled:text-[#607277]"
                      >
                        Continue to booking
                      </button>}
                    </article>
                  ))}
                </div>
                {preselectedServiceId && (
                  <div ref={bookingSectionRef} className="mt-6 scroll-mt-24">
                    <AppointmentBooking embedded initialServiceId={preselectedServiceId} serviceSelectionRequest={bookingScrollRequest} />
                  </div>
                )}
              </section>
            )}

            {activeTab === "appointments" && (
              <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
                <section className="min-w-0 self-start rounded-[30px] bg-white p-5 shadow-[0_18px_36px_rgba(102,91,72,0.12)] sm:p-6">
                  <h2 className="text-xl font-semibold text-[#20343B]">My appointments</h2>
                  <div className="mt-4 grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)]">
                    <select aria-label="Filter my appointments by status" value={appointmentFilter}
                      onChange={(event) => { setAppointmentFilter(event.target.value); setAppointmentPage(0); setSelectedAppointmentId(""); }}
                      className="min-w-0 rounded-lg border border-[#D9E7E7] bg-white px-3 py-2.5 text-sm text-[#20343B]">
                      {["All", ...APPOINTMENT_STATUSES].map((status) => <option key={status}>{status}</option>)}
                    </select>
                    <label className="flex min-w-0 items-center gap-2 rounded-lg border border-[#D9E7E7] px-3 py-2.5 text-[#607277]">
                      <Search size={16} className="shrink-0" />
                      <input aria-label="Search my appointments" value={appointmentSearch}
                        onChange={(event) => { setAppointmentSearch(event.target.value); setAppointmentPage(0); setSelectedAppointmentId(""); }}
                        placeholder="Search pet, service, or date" className="min-w-0 w-full bg-transparent text-sm outline-none" />
                    </label>
                  </div>
                  <div className="mt-5 space-y-3">
                    {filteredCustomerAppointments.length === 0 ? (
                      <EmptyState
                        title={customerAppointments.length ? "No matching appointments" : "No appointments yet"}
                        message={customerAppointments.length ? "No appointments match the selected status and search." : "Book your first appointment to start building your history."}
                      />
                    ) : (
                      pagedAppointments.appointments.map((appointment) => (
                        <button
                          key={appointment.id}
                          type="button"
                          onClick={() => setSelectedAppointmentId(appointment.id)}
                          className={`w-full min-h-[116px] rounded-lg border px-4 py-4 text-left transition ${
                            selectedAppointment?.id === appointment.id
                              ? "border-[#2D9B9B] bg-[#F5FBFB]"
                              : "border-[#E6EFEE] bg-[#FBFDFC]"
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-3">
                            <h3 className="text-lg font-semibold text-[#20343B]">
                              {appointment.petName}
                            </h3>
                            <StatusChip label={appointmentStatusLabel(appointment.status)} />
                          </div>
                          <p className="mt-2 text-sm text-[#607277]">{appointment.service}</p>
                          <p className="mt-2 text-sm text-[#607277]">
                            {formatDateTimeLabel(appointment.scheduleDate, appointment.scheduleTime)}
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                  {filteredCustomerAppointments.length > 0 && (
                    <div className="mt-4 flex items-center justify-between gap-3 border-t border-[#E6EFEE] pt-4 text-sm text-[#607277]">
                      <span>{pagedAppointments.page * 3 + 1}-{Math.min((pagedAppointments.page + 1) * 3, filteredCustomerAppointments.length)} of {filteredCustomerAppointments.length}</span>
                      <div className="flex items-center gap-2">
                        <button type="button" aria-label="Previous appointments" title="Previous appointments" disabled={pagedAppointments.page === 0}
                          onClick={() => { setAppointmentPage(pagedAppointments.page - 1); setSelectedAppointmentId(""); }}
                          className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#D9E7E7] disabled:opacity-40"><ChevronLeft size={17} /></button>
                        <span>{pagedAppointments.page + 1} / {pagedAppointments.pageCount}</span>
                        <button type="button" aria-label="Next appointments" title="Next appointments" disabled={pagedAppointments.page + 1 >= pagedAppointments.pageCount}
                          onClick={() => { setAppointmentPage(pagedAppointments.page + 1); setSelectedAppointmentId(""); }}
                          className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#D9E7E7] disabled:opacity-40"><ChevronRight size={17} /></button>
                      </div>
                    </div>
                  )}
                </section>

                <section className="rounded-[30px] bg-white p-6 shadow-[0_18px_36px_rgba(102,91,72,0.12)]">
                  {selectedAppointment ? (
                    <>
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="text-2xl font-semibold text-[#20343B]">
                          {selectedAppointment.petName}
                        </h3>
                        <StatusChip label={appointmentStatusLabel(selectedAppointment.status)} />
                      </div>
                      <p className="mt-3 text-sm text-[#607277]">{selectedAppointment.service}</p>
                      <BookingAdditions appointment={selectedAppointment}/>
                      {(selectedAppointment.rejectionReason || selectedAppointment.cancellationReason) && (
                        <p className="mt-4 rounded-lg border border-[#F2CED6] bg-[#FBECEF] px-4 py-3 text-sm text-[#B23949]">
                          {selectedAppointment.rejectionReason || selectedAppointment.cancellationReason}
                        </p>
                      )}
                      <div className="mt-6 grid gap-4 md:grid-cols-2">
                        <div className="rounded-[22px] bg-[#F6FAFA] px-4 py-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7A979C]">
                            Service
                          </p>
                          <p className="mt-2 text-base font-semibold text-[#20343B]">
                            {selectedAppointment.service || "Service not specified"}
                          </p>
                        </div>
                        <div className="rounded-[22px] bg-[#F6FAFA] px-4 py-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7A979C]">
                            Scheduled
                          </p>
                          <p className="mt-2 text-base font-semibold text-[#20343B]">
                            {formatDateTimeLabel(
                              selectedAppointment.scheduleDate,
                              selectedAppointment.scheduleTime,
                            )}
                          </p>
                        </div>
                        <div className="rounded-[22px] bg-[#F6FAFA] px-4 py-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7A979C]">
                            Booked on
                          </p>
                          <p className="mt-2 text-base font-semibold text-[#20343B]">
                            {formatNotificationDate(selectedAppointment.createdAt) || "Booking timestamp unavailable"}
                          </p>
                        </div>
                        <div className="rounded-[22px] bg-[#F6FAFA] px-4 py-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7A979C]">
                            Assigned staff
                          </p>
                          <p className="mt-2 text-base font-semibold text-[#20343B]">
                            {selectedAppointment.assignedStaff || "To be assigned"}
                          </p>
                        </div>
                      </div>
                      <div className="mt-4 rounded-[22px] bg-[#F6FAFA] px-4 py-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7A979C]">
                          Pet details and notes
                        </p>
                        <p className="mt-2 text-sm leading-6 text-[#607277]">
                          {[selectedAppointment.petType, selectedAppointment.breed]
                            .filter(Boolean)
                            .join(" | ") || "Pet type not specified."}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-[#607277]">
                          {selectedAppointment.notes || "No additional notes."}
                        </p>
                      </div>
                      {["Pending", "Confirmed", "Accepted"].includes(selectedAppointment.status) &&
                        profileForm.status === "active" && (
                          <button
                            type="button"
                            onClick={() => cancelAppointment(selectedAppointment.id)}
                            className="mt-6 rounded-[20px] bg-[#FBECEF] px-5 py-3 text-sm font-semibold text-[#B23949]"
                          >
                            Cancel appointment
                          </button>
                        )}
                    </>
                  ) : (
                    <EmptyState
                      title="Select an appointment"
                      message="Appointment details will appear here."
                    />
                  )}
                </section>
              </div>
            )}

            {activeTab === "profile" && (
              <section className="rounded-[30px] bg-white p-6 shadow-[0_18px_36px_rgba(102,91,72,0.12)]">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#7B9A9F]">
                      Manage account
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold text-[#20343B]">
                      Profile settings
                    </h2>
                  </div>
                </div>

                <form noValidate onSubmit={saveProfile} className="mt-6 space-y-5">
                  <div className="grid gap-5 md:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-[#425A60]">Full Name</label>
                      <input
                        value={profileForm.fullName}
                        autoComplete="off"
                        onChange={handleProfileChange("fullName")}
                        maxLength={80}
                        className="w-full rounded-[20px] border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-[#425A60]">Username</label>
                      <input
                        value={profileForm.username}
                        autoComplete="off"
                        onChange={handleProfileChange("username")}
                        maxLength={24}
                        pattern="[a-z0-9._-]{3,24}"
                        className="w-full rounded-[20px] border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-[#425A60]">Email</label>
                      <input
                        type="email"
                        value={profileForm.email}
                        autoComplete="off"
                        onChange={handleProfileChange("email")}
                        maxLength={120}
                        className="w-full rounded-[20px] border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                      />
                      <p className="mt-2 text-xs text-[#7A9297]">
                        Email updates follow the existing Firebase Authentication profile flow.
                      </p>
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-[#425A60]">Phone</label>
                      <input
                        value={profileForm.phone}
                        autoComplete="tel"
                        onChange={handleProfileChange("phone")}
                        type="tel"
                        inputMode="tel"
                        pattern="\+63 9[0-9]{2}-[0-9]{3}-[0-9]{4}"
                        maxLength={16}
                        placeholder={PH_MOBILE_FORMAT}
                        className="w-full rounded-[20px] border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                      />
                      <p className="mt-2 text-xs text-[#7A9297]">
                        Format: {PH_MOBILE_FORMAT}
                      </p>
                    </div>
                  </div>

                  <button
                    type="submit"
                        disabled={isSavingProfile}
                    className="rounded-[20px] bg-[#2D9B9B] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#288A8A] disabled:cursor-not-allowed disabled:bg-[#9CB5B8]"
                  >
                    {isSavingProfile ? "Saving profile..." : "Save profile"}
                  </button>
                </form>

                {pendingProfilePayload && (
                  <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="save-profile-title"
                    className="fixed inset-0 z-[90] flex items-center justify-center bg-[#173E44]/45 px-4 py-6 backdrop-blur-sm"
                  >
                    <div className="max-h-[calc(100dvh-3rem)] w-full max-w-lg overflow-y-auto rounded-[28px] bg-white p-6 shadow-[0_24px_56px_rgba(20,43,46,0.24)]">
                      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#7B9A9F]">
                        Save changes?
                      </p>
                      <h3 id="save-profile-title" className="mt-2 text-2xl font-semibold text-[#20343B]">
                        Confirm new profile details
                      </h3>
                      <div className="mt-5 grid gap-3 rounded-[22px] bg-[#F6FAFA] px-4 py-4 text-sm">
                        {[
                          ["Full name", pendingProfilePayload.fullName],
                          ["Username", pendingProfilePayload.username],
                          ["Email", pendingProfilePayload.email],
                          ["Phone", formatPhilippineMobileNumber(pendingProfilePayload.phone)],
                        ].map(([label, value]) => (
                          <div key={label} className="flex items-start justify-between gap-4">
                            <span className="font-semibold text-[#607277]">{label}</span>
                            <span className="text-right font-semibold text-[#20343B]">{value}</span>
                          </div>
                        ))}
                      </div>
                  <div className="mt-5">
                    <label htmlFor="profile-confirmation-password" className="mb-2 block text-sm font-medium text-[#425A60]">
                      Verify with your current password
                    </label>
                    <div className="relative">
                      <input
                        type={showProfileVerificationPassword ? "text" : "password"}
                        value={profileVerificationPassword}
                        id="profile-confirmation-password" required autoFocus autoComplete="current-password"
                        onChange={(event) => setProfileVerificationPassword(event.target.value)}
                        disabled={isSavingProfile}
                        className="w-full rounded-[20px] border border-[#D9E7E7] px-4 py-3 pr-12 outline-none transition focus:border-[#2D9B9B]"
                        placeholder="Enter your password to authorize this change"
                      />
                      <button
                        type="button"
                        onClick={() => setShowProfileVerificationPassword((visible) => !visible)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#607277]"
                        aria-label={showProfileVerificationPassword ? "Hide verification password" : "Show verification password"}
                      >
                        {showProfileVerificationPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-[#7A9297]">
                      Your password is checked before your name, username, email, or phone changes are saved.
                    </p>
                  </div>
                      {profileConfirmationError && <p role="alert" className="mt-3 text-sm text-[#B23949]">{profileConfirmationError}</p>}
                      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
                        <button
                          type="button"
                          onClick={() => { setPendingProfilePayload(null); setProfileVerificationPassword(""); setShowProfileVerificationPassword(false); setProfileConfirmationError(""); }}
                          disabled={isSavingProfile}
                          className="rounded-[18px] bg-[#EEF6F6] px-5 py-3 text-sm font-semibold text-[#24444A]"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={confirmProfileSave}
                          disabled={isSavingProfile || !profileVerificationPassword}
                          className="rounded-[18px] bg-[#2D9B9B] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#9CB5B8]"
                        >
                          {isSavingProfile ? "Saving profile..." : "Save changes"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <form onSubmit={savePassword} className="mt-8 rounded-[28px] bg-[#FBFDFC] p-6">
                  <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#7A979C]">
                    Change password
                  </p>
                  <div className="mt-4 grid gap-4 md:grid-cols-3">
                    <div>
                      <div className="relative">
                        <input
                          type={passwordVisibility.current ? "text" : "password"}
                          value={passwordForm.current}
                          onChange={(event) => setPasswordForm((current) => ({ ...current, current: event.target.value }))}
                          autoComplete="current-password"
                          className="w-full rounded-[18px] border border-[#D9E7E7] px-4 py-3 pr-12 outline-none focus:border-[#2D9B9B]"
                          placeholder="Current password"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setPasswordVisibility((current) => ({ ...current, current: !current.current }))}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#607277]"
                          aria-label={passwordVisibility.current ? "Hide current password" : "Show current password"}
                        >
                          {passwordVisibility.current ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <div className="relative">
                        <input
                          type={passwordVisibility.next ? "text" : "password"}
                          value={passwordForm.next}
                          onChange={(event) => setPasswordForm((current) => ({ ...current, next: event.target.value }))}
                          autoComplete="new-password"
                          className="w-full rounded-[18px] border border-[#D9E7E7] px-4 py-3 pr-12 outline-none focus:border-[#2D9B9B]"
                          placeholder="New password"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setPasswordVisibility((current) => ({ ...current, next: !current.next }))}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#607277]"
                          aria-label={passwordVisibility.next ? "Hide new password" : "Show new password"}
                        >
                          {passwordVisibility.next ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#D8E8EA]">
                        <div
                          className={`h-full rounded-full transition-all ${passwordStrength.color}`}
                          style={{ width: passwordStrength.width }}
                        />
                      </div>
                      <p className="mt-2 text-xs font-semibold text-[#607277]">
                        Password strength: {passwordStrength.label}
                      </p>
                    </div>
                    <div>
                      <div className="relative">
                        <input
                          type={passwordVisibility.confirm ? "text" : "password"}
                          value={passwordForm.confirm}
                          onChange={(event) => setPasswordForm((current) => ({ ...current, confirm: event.target.value }))}
                          autoComplete="new-password"
                          className="w-full rounded-[18px] border border-[#D9E7E7] px-4 py-3 pr-12 outline-none focus:border-[#2D9B9B]"
                          placeholder="Confirm new password"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setPasswordVisibility((current) => ({ ...current, confirm: !current.confirm }))}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#607277]"
                          aria-label={passwordVisibility.confirm ? "Hide confirmation password" : "Show confirmation password"}
                        >
                          {passwordVisibility.confirm ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={isChangingPassword}
                    className="mt-4 rounded-[18px] bg-[#173E44] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {isChangingPassword ? "Changing password..." : "Change password"}
                  </button>
                </form>


              </section>
            )}

            {feedback.message && (
              <p
                className={`mt-5 rounded-[22px] px-4 py-3 text-sm font-medium ${
                  feedback.type === "error"
                    ? "bg-[#FBECEF] text-[#B23949]"
                    : "bg-[#EAF7F7] text-[#2D6B73]"
                }`}
              >
                {feedback.message}
              </p>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
