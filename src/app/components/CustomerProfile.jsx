import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
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
} from "lucide-react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AppointmentBooking } from "./AppointmentBooking.jsx";
import { useApp } from "../context/AppContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { breedsByPetType, petTypeOptions, serviceCatalog } from "../data/systemData.js";
import { changeCustomerPassword } from "../services/customerAccount.js";
import { isValidEmail, ILLEGITIMATE_EMAIL_ERROR } from "../utils/emailValidation.js";

const dashboardTabs = [
  { id: "overview", label: "Dashboard", icon: CheckCircle2 },
  { id: "services", label: "Services & Book Appointment", icon: Scissors },
  { id: "appointments", label: "My Appointments", icon: Clock3 },
  { id: "profile", label: "Profile", icon: UserRound },
];


function statusTone(status) {
  if (["Completed", "active"].includes(status)) {
    return "bg-[#E8F7EE] text-[#1D7C45]";
  }

  if (["Cancelled", "Rejected", "No-show", "Expired", "suspended"].includes(status)) {
    return "bg-[#FCE8EB] text-[#B23949]";
  }

  if (["Pending", "Confirmed", "Accepted"].includes(status)) {
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
        <span className="inline-flex items-center gap-3">
          <Bell size={20} className="text-[#2D6B73]" />
          <span className="text-lg font-semibold text-[#20343B]">Notifications</span>
          {unreadCount > 0 && <StatusChip label={`${unreadCount} unread`} />}
        </span>
        <ChevronDown
          size={20}
          className={`text-[#607277] transition ${isOpen ? "rotate-180" : ""}`}
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
  } = useApp();
  const customer = currentUser?.role === "customer" ? currentUser : null;
  const [activeTab, setActiveTab] = useState("overview");
  const [profileForm, setProfileForm] = useState({
    fullName: "",
    username: "",
    email: "",
    phone: "",
    status: "active",
  });
  const [petForm, setPetForm] = useState(() => buildEmptyPetForm());
  const [selectedAppointmentId, setSelectedAppointmentId] = useState("");
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingPet, setIsSavingPet] = useState(false);
  const [profileVerificationPassword, setProfileVerificationPassword] = useState("");
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
  const bookingSectionRef = useRef(null);

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
  }, [activeTab, preselectedServiceId]);

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
      phone: customer.phone || "",
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
        .sort((left, right) =>
          `${right.scheduleDate} ${right.scheduleTime}`.localeCompare(
            `${left.scheduleDate} ${left.scheduleTime}`,
          ),
        ),
    [customer?.email, customer?.uid, state.appointments],
  );
  const selectedAppointment =
    customerAppointments.find((appointment) => appointment.id === selectedAppointmentId) ||
    customerAppointments[0] ||
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
    "grid min-w-0 grid-cols-1 items-start gap-4 sm:grid-cols-[repeat(2,minmax(0,17rem))]";
  const passwordStrength = getPasswordStrength(passwordForm.next);

  useEffect(() => {
    if (!selectedAppointmentId && customerAppointments[0]) {
      setSelectedAppointmentId(customerAppointments[0].id);
    }
  }, [customerAppointments, selectedAppointmentId]);

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
      ? event.target.value.replace(/\D/g, "").slice(0, 11)
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
    phone: profileForm.phone.trim(),
    ...overrides,
  });

  const applySavedProfile = (user, message, options = {}) => {
    setProfileForm({
      fullName: user.fullName || user.name || "",
      username: user.username || "",
      email: user.email || "",
      phone: user.phone || "",
      status: user.status || "active",
    });
    setFeedback({ type: "success", message });
    if (options.notify !== false) {
      toast.success(message);
    }
  };

  const validateProfileForm = () => {
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

    if (!profileVerificationPassword) {
      const message = "Enter your current password before saving profile changes.";
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

    setPendingProfilePayload(buildProfilePayload());
  };

  const confirmProfileSave = async () => {
    if (!pendingProfilePayload || isSavingProfile) {
      return;
    }

    setIsSavingProfile(true);

    try {
      const result = await updateProfile({
        ...pendingProfilePayload,
        requireProfileVerification: true,
        verificationPassword: profileVerificationPassword,
      });

      if (!result.ok) {
        setFeedback({ type: "error", message: result.error });
        toast.error(result.error);
        return;
      }

      applySavedProfile(result.user, "Customer profile updated successfully.");
      setProfileVerificationPassword("");
      setPendingProfilePayload(null);
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
      const savePromise = savePetRecord(nextRecord, profileForm.fullName);
      const saveMessage = "Pet record saved successfully.";
      setPetForm(buildEmptyPetForm());
      setIsSavingPet(false);
      setFeedback({ type: "success", message: saveMessage });
      toast.success(saveMessage);

      const didSync = await savePromise;
      if (!didSync) {
        const message = "Pet record was saved locally, but Firestore sync failed. Please check your connection.";
        setFeedback({ type: "error", message });
        toast.error(message);
      }
    } catch (error) {
      const message = "Unable to save pet record. Please try again.";
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

    const confirmed = window.confirm(`Delete ${record.petName}'s pet profile?`);
    if (!confirmed) {
      return;
    }

    try {
      await Promise.resolve(deletePetRecord(record.id, profileForm.fullName));
      if (petForm.id === record.id) {
        setPetForm(buildEmptyPetForm());
      }
      const message = "Pet profile deleted.";
      setFeedback({ type: "success", message });
      toast.success(message);
    } catch (error) {
      const message = "Unable to delete pet profile. Please try again.";
      console.error("[customer-profile] Pet record delete failed.", error);
      setFeedback({ type: "error", message });
      toast.error(message);
    }
  };

  const cancelAppointment = (appointmentId) => {
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

    updateAppointment(appointmentId, { status: "Cancelled" }, profileForm.fullName);
    const message = "Appointment cancelled. The clinic queue has been updated.";
    setFeedback({ type: "success", message });
    toast.success(message);
  };

  const continueToBooking = (serviceId) => {
    openTab("services");
    setPreselectedServiceId(serviceId);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-[#F6F0E7] px-4 py-6 sm:px-6 md:py-8">
      <div className="w-full min-w-0 space-y-6">
        <motion.section
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="rounded-[28px] bg-[linear-gradient(135deg,#173E44_0%,#2D6B73_58%,#82C8C0_100%)] p-5 text-white shadow-[0_20px_44px_rgba(20,43,46,0.18)] md:p-6"
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
        </motion.section>

        <div className="grid items-start gap-6 lg:grid-cols-[224px_minmax(0,1fr)]">
          <aside className="self-start rounded-2xl bg-white p-3 shadow-[0_14px_30px_rgba(102,91,72,0.1)] lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
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
                <div className="grid items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_280px]">
                  <div className="min-w-0 space-y-5">
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

                <section className="@container min-w-0 rounded-[30px] bg-white p-4 shadow-[0_18px_36px_rgba(102,91,72,0.12)] sm:p-6">
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

                  <div className="mt-6 grid grid-cols-1 items-start gap-5 @min-[56rem]:grid-cols-[minmax(260px,320px)_minmax(0,1fr)] @min-[76rem]:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
                    <form onSubmit={savePet} className="min-w-0 rounded-[20px] bg-[#FBFDFC] p-4 sm:p-5 [&_input]:min-w-0 [&_select]:min-w-0 [&_textarea]:min-w-0">
                      <div className="grid gap-4">
                        <input
                          value={petForm.petName}
                          autoComplete="off"
                          onChange={(event) =>
                            setPetForm((current) => ({ ...current, petName: event.target.value }))
                          }
                          maxLength={60}
                          className="rounded-[18px] border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                          placeholder="Pet name"
                        />
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
                          value={petForm.notes}
                          onChange={(event) =>
                            setPetForm((current) => ({ ...current, notes: event.target.value }))
                          }
                          maxLength={500}
                          className="min-h-28 rounded-[18px] border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                          placeholder="Notes for staff or future visits"
                        />
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
                            onClick={() => setPetForm(buildEmptyPetForm())}
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
                                      {record.petName}
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
                                    {record.notes}
                                  </p>
                                )}
                                <div className="mt-auto flex flex-wrap gap-2 pt-3">
                                  <button
                                    type="button"
                                    onClick={() => setPetForm(buildPetFormFromRecord(record))}
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
                        Continue with services or book a new appointment.
                      </h2>
                      <div className="mt-5 grid gap-3">
                        <button
                          type="button"
                          onClick={() => openTab("services")}
                          className="rounded-2xl bg-[#EEF6F6] px-4 py-3 text-sm font-semibold text-[#24444A]"
                        >
                          View services
                        </button>
                        <button
                          type="button"
                          onClick={() => openTab("booking")}
                          className="rounded-2xl bg-[#173E44] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#235A61]"
                        >
                          Book appointment
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
                        <span className="min-w-[8.5rem] shrink-0 whitespace-nowrap rounded-lg bg-[#F7F2E9] px-3.5 py-1 text-center text-xs font-semibold text-[#6A5D4A]">
                          {service.priceLabel}
                        </span>
                      </div>
                      <p className="mt-3 flex-1 text-sm leading-6 text-[#607277]">{service.description}</p>
                      <p className="mt-3 text-xs font-semibold text-[#2D6B73]">
                        Estimated visit time: {service.duration}
                      </p>
                      <button
                        type="button"
                        onClick={() => continueToBooking(service.id)}
                        className="mt-4 w-full cursor-pointer rounded-xl bg-[#173E44] px-4 py-3 text-sm font-semibold text-white transition duration-200 hover:scale-[1.03] hover:bg-[#235A61]"
                      >
                        Continue to booking
                      </button>
                    </article>
                  ))}
                </div>
                {preselectedServiceId && (
                  <div ref={bookingSectionRef} className="mt-6 scroll-mt-24">
                    <AppointmentBooking embedded initialServiceId={preselectedServiceId} />
                  </div>
                )}
              </section>
            )}

            {activeTab === "appointments" && (
              <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
                <section className="rounded-[30px] bg-white p-6 shadow-[0_18px_36px_rgba(102,91,72,0.12)]">
                  <h2 className="text-xl font-semibold text-[#20343B]">My appointments</h2>
                  <div className="mt-5 space-y-3">
                    {customerAppointments.length === 0 ? (
                      <EmptyState
                        title="No appointments yet"
                        message="Book your first appointment to start building your history."
                      />
                    ) : (
                      customerAppointments.map((appointment) => (
                        <button
                          key={appointment.id}
                          type="button"
                          onClick={() => setSelectedAppointmentId(appointment.id)}
                          className={`w-full rounded-[24px] border px-5 py-5 text-left transition ${
                            selectedAppointment?.id === appointment.id
                              ? "border-[#2D9B9B] bg-[#F5FBFB]"
                              : "border-[#E6EFEE] bg-[#FBFDFC]"
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-3">
                            <h3 className="text-lg font-semibold text-[#20343B]">
                              {appointment.petName}
                            </h3>
                            <StatusChip label={appointment.status} />
                          </div>
                          <p className="mt-2 text-sm text-[#607277]">{appointment.service}</p>
                          <p className="mt-2 text-sm text-[#607277]">
                            {formatDateTimeLabel(appointment.scheduleDate, appointment.scheduleTime)}
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                </section>

                <section className="rounded-[30px] bg-white p-6 shadow-[0_18px_36px_rgba(102,91,72,0.12)]">
                  {selectedAppointment ? (
                    <>
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="text-2xl font-semibold text-[#20343B]">
                          {selectedAppointment.petName}
                        </h3>
                        <StatusChip label={selectedAppointment.status} />
                      </div>
                      <p className="mt-3 text-sm text-[#607277]">{selectedAppointment.service}</p>
                      {selectedAppointment.cancellationReason && (
                        <p className="mt-4 rounded-lg border border-[#F2CED6] bg-[#FBECEF] px-4 py-3 text-sm text-[#B23949]">
                          {selectedAppointment.cancellationReason}
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
                        autoComplete="off"
                        onChange={handleProfileChange("phone")}
                        inputMode="numeric"
                        maxLength={15}
                        className="w-full rounded-[20px] border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#425A60]">
                      Verify with your current password
                    </label>
                    <div className="relative">
                      <input
                        type={showProfileVerificationPassword ? "text" : "password"}
                        value={profileVerificationPassword}
                        autoComplete="current-password"
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
                    <div className="w-full max-w-lg rounded-[28px] bg-white p-6 shadow-[0_24px_56px_rgba(20,43,46,0.24)]">
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
                          ["Phone", pendingProfilePayload.phone || "No phone saved"],
                        ].map(([label, value]) => (
                          <div key={label} className="flex items-start justify-between gap-4">
                            <span className="font-semibold text-[#607277]">{label}</span>
                            <span className="text-right font-semibold text-[#20343B]">{value}</span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
                        <button
                          type="button"
                          onClick={() => setPendingProfilePayload(null)}
                          disabled={isSavingProfile}
                          className="rounded-[18px] bg-[#EEF6F6] px-5 py-3 text-sm font-semibold text-[#24444A]"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={confirmProfileSave}
                          disabled={isSavingProfile}
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
