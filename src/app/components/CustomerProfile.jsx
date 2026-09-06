import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  Bell,
  CalendarDays,
  Camera,
  CheckCircle2,
  Clock3,
  PawPrint,
  Scissors,
  UserRound,
} from "lucide-react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AppointmentBooking } from "./AppointmentBooking.jsx";
import { useApp } from "../context/AppContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { serviceCatalog } from "../data/systemData.js";
import { compressImageFileToDataUrl } from "../utils/imageCompression.js";

const dashboardTabs = [
  { id: "overview", label: "Dashboard", icon: CheckCircle2 },
  { id: "services", label: "Services", icon: Scissors },
  { id: "booking", label: "Book Appointment", icon: CalendarDays },
  { id: "appointments", label: "My Appointments", icon: Clock3 },
  { id: "profile", label: "Profile", icon: UserRound },
];

const allowedProfilePhotoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxProfilePhotoSizeBytes = 5 * 1024 * 1024;

function getCustomerInitials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function statusTone(status) {
  if (["Completed", "active"].includes(status)) {
    return "bg-[#E8F7EE] text-[#1D7C45]";
  }

  if (["Cancelled", "Rejected", "No-show", "suspended"].includes(status)) {
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
    breed: "",
    notes: "",
    photoURL: "",
  };
}

function buildPetFormFromRecord(record = {}) {
  return {
    id: record.id || "",
    petName: record.petName || "",
    petType: record.petType || "",
    breed: record.breed || "",
    notes: record.notes || "",
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
    photoURL: "",
  });
  const [petForm, setPetForm] = useState(() => buildEmptyPetForm());
  const [selectedAppointmentId, setSelectedAppointmentId] = useState("");
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingPhoto, setIsSavingPhoto] = useState(false);
  const [isSavingPet, setIsSavingPet] = useState(false);
  const [profilePhotoPreviewUrl, setProfilePhotoPreviewUrl] = useState("");

  useEffect(() => {
    const tabFromQuery = searchParams.get("tab") || "";
    const legacyTabFromHash = location.hash.replace("#", "");
    const nextTab = dashboardTabs.some((tab) => tab.id === tabFromQuery)
      ? tabFromQuery
      : dashboardTabs.some((tab) => tab.id === legacyTabFromHash)
        ? legacyTabFromHash
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
      photoURL: customer.photoURL || "",
    });
  }, [customer]);

  useEffect(() => {
    return () => {
      if (profilePhotoPreviewUrl) {
        URL.revokeObjectURL(profilePhotoPreviewUrl);
      }
    };
  }, [profilePhotoPreviewUrl]);

  const customerPetRecords = useMemo(
    () =>
      state.petRecords.filter(
        (record) =>
          record.customerId === customer?.uid ||
          record.customerEmail?.toLowerCase() === customer?.email?.toLowerCase(),
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
  const unreadNotificationCount = visibleNotifications.filter(
    (notification) => !notification.readBy.includes(customer?.id || customer?.uid),
  ).length;
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
          petForm.breed.trim() ||
          petForm.notes.trim() ||
          petForm.photoURL,
      );

  useEffect(() => {
    if (!selectedAppointmentId && customerAppointments[0]) {
      setSelectedAppointmentId(customerAppointments[0].id);
    }
  }, [customerAppointments, selectedAppointmentId]);

  if (!isLoading && (!isAuthenticated || !customer)) {
    return <Navigate to="/login" replace />;
  }

  const openTab = (tabId) => {
    setActiveTab(tabId);
    navigate(tabId === "overview" ? "/customer/dashboard" : `/customer/dashboard?tab=${tabId}`, { replace: true });
    setFeedback({ type: "", message: "" });
  };

  const handleProfileChange = (field) => (event) => {
    const value = event.target.value;
    setProfileForm((current) => ({ ...current, [field]: value }));
  };

  const buildProfilePayload = (overrides = {}) => ({
    fullName: profileForm.fullName.trim(),
    username: profileForm.username.trim(),
    email: profileForm.email.trim().toLowerCase(),
    phone: profileForm.phone.trim(),
    ...overrides,
  });

  const validateProfilePhoto = (file) => {
    if (!file) {
      return "Please select a valid image file.";
    }

    if (!allowedProfilePhotoTypes.has(file.type)) {
      return "Please select a JPG, PNG, or WEBP image.";
    }

    if (file.size > maxProfilePhotoSizeBytes) {
      return "Profile pictures must be 5 MB or smaller.";
    }

    return "";
  };

  const applySavedProfile = (user, message) => {
    if (profilePhotoPreviewUrl) {
      URL.revokeObjectURL(profilePhotoPreviewUrl);
      setProfilePhotoPreviewUrl("");
    }
    setProfileForm({
      fullName: user.fullName || user.name || "",
      username: user.username || "",
      email: user.email || "",
      phone: user.phone || "",
      status: user.status || "active",
      photoURL: user.photoURL || "",
    });
    setFeedback({ type: "success", message });
    toast.success(message);
  };

  const handleProfilePhotoSelection = async (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = "";

    if (isSavingPhoto) {
      return;
    }

    const validationMessage = validateProfilePhoto(file);
    if (validationMessage) {
      setFeedback({ type: "error", message: validationMessage });
      toast.error(validationMessage);
      return;
    }

    setIsSavingPhoto(true);
    setFeedback({ type: "", message: "" });
    const previewUrl = URL.createObjectURL(file);
    if (profilePhotoPreviewUrl) {
      URL.revokeObjectURL(profilePhotoPreviewUrl);
    }
    setProfilePhotoPreviewUrl(previewUrl);

    try {
      const result = await updateProfile({ photoFile: file });

      if (!result.ok) {
        const message = "Unable to upload profile picture. Please try again.";
        console.error("[customer-profile] Profile photo upload failed.", {
          error: result.error,
        });
        URL.revokeObjectURL(previewUrl);
        setProfilePhotoPreviewUrl("");
        setFeedback({ type: "error", message });
        toast.error(message);
        return;
      }

      applySavedProfile(result.user, "Profile picture updated successfully.");
    } catch (error) {
      const message = "Unable to upload profile picture. Please try again.";
      console.error("[customer-profile] Unexpected profile photo upload error.", error);
      URL.revokeObjectURL(previewUrl);
      setProfilePhotoPreviewUrl("");
      setFeedback({ type: "error", message });
      toast.error(message);
    } finally {
      setIsSavingPhoto(false);
    }
  };

  const clearProfilePhoto = async () => {
    if (!profileForm.photoURL || isSavingPhoto) {
      return;
    }

    setIsSavingPhoto(true);
    setFeedback({ type: "", message: "" });

    try {
      const result = await updateProfile({ removePhoto: true });

      if (!result.ok) {
        const message = "Unable to remove profile picture. Please try again.";
        console.error("[customer-profile] Profile photo removal failed.", {
          error: result.error,
        });
        setFeedback({ type: "error", message });
        toast.error(message);
        return;
      }

      applySavedProfile(result.user, "Profile photo removed successfully.");
    } catch (error) {
      const message = "Unable to remove profile picture. Please try again.";
      console.error("[customer-profile] Unexpected profile photo removal error.", error);
      setFeedback({ type: "error", message });
      toast.error(message);
    } finally {
      setIsSavingPhoto(false);
    }
  };

  const saveProfile = async (event) => {
    event.preventDefault();

    if (isSavingProfile || isSavingPhoto) {
      return;
    }

    if (!profileForm.fullName.trim() || !profileForm.email.trim() || !profileForm.username.trim()) {
      const message = "Full name, username, and email are required.";
      setFeedback({ type: "error", message });
      toast.error(message);
      return;
    }

    setIsSavingProfile(true);

    try {
      const result = await updateProfile(buildProfilePayload());

      if (!result.ok) {
        setFeedback({ type: "error", message: result.error });
        toast.error(result.error);
        return;
      }

      applySavedProfile(result.user, "Customer profile updated successfully.");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handlePetPhotoSelection = async (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = "";

    const validationMessage = validateProfilePhoto(file);
    if (validationMessage) {
      setFeedback({ type: "error", message: validationMessage });
      toast.error(validationMessage);
      return;
    }

    try {
      const photoURL = await compressImageFileToDataUrl(file, {
        maxDimension: 500,
        quality: 0.6,
        outputType: file.type || "image/jpeg",
      });
      setPetForm((current) => ({ ...current, photoURL }));
    } catch (error) {
      const message = "Unable to prepare pet photo. Please try another image.";
      console.error("[customer-profile] Pet photo compression failed.", error);
      setFeedback({ type: "error", message });
      toast.error(message);
    }
  };

  const savePet = async (event) => {
    event.preventDefault();
    if (isSavingPet) {
      return;
    }

    if (!petForm.petName.trim() || !petForm.petType.trim()) {
      const message = "Pet name and pet type are required.";
      setFeedback({ type: "error", message });
      toast.error(message);
      return;
    }

    setIsSavingPet(true);
    setFeedback({ type: "", message: "" });
    const existingRecord = customerPetRecords.find((record) => record.id === petForm.id);
    const nextRecord = {
      id: petForm.id || undefined,
      customerId: customer?.uid || "",
      customerEmail: customer?.email || "",
      ownerName: profileForm.fullName,
      petName: petForm.petName,
      petType: petForm.petType,
      breed: petForm.breed,
      lastVisit: existingRecord?.lastVisit || "",
      visitRecords: existingRecord?.visitRecords || [],
      medicalRecords: existingRecord?.medicalRecords || [],
      notes: petForm.notes,
      photoURL: petForm.photoURL || existingRecord?.photoURL || "",
      updatedAt: new Date().toISOString(),
    };

    try {
      const didSync = await savePetRecord(nextRecord, profileForm.fullName);
      if (!didSync) {
        const message = "Pet record was saved locally, but Firestore sync failed. Please check your connection.";
        setFeedback({ type: "error", message });
        toast.error(message);
        return;
      }

      setPetForm(buildEmptyPetForm());
      const message = "Pet record saved successfully.";
      setFeedback({ type: "success", message });
      toast.success(message);
    } catch (error) {
      const message = "Unable to save pet record. Please try again.";
      console.error("[customer-profile] Pet record save failed.", error);
      setFeedback({ type: "error", message });
      toast.error(message);
    } finally {
      setIsSavingPet(false);
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

    updateAppointment(appointmentId, { status: "Cancelled" }, profileForm.fullName);
    const message = "Appointment cancelled. The clinic queue has been updated.";
    setFeedback({ type: "success", message });
    toast.success(message);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const customerPhotoURL = profilePhotoPreviewUrl || profileForm.photoURL;

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-[#F6F0E7] px-4 py-6 sm:px-6 md:py-8">
      <div className="mx-auto max-w-[1260px] space-y-6">
        <motion.section
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="rounded-[28px] bg-[linear-gradient(135deg,#173E44_0%,#2D6B73_58%,#82C8C0_100%)] p-5 text-white shadow-[0_20px_44px_rgba(20,43,46,0.18)] md:p-6"
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/12 text-xl font-bold md:h-[4.5rem] md:w-[4.5rem]">
                {customerPhotoURL ? (
                  <img
                    src={customerPhotoURL}
                    alt={`${profileForm.fullName || "Customer"} profile`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  getCustomerInitials(profileForm.fullName)
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white/70">
                  Customer Dashboard
                </p>
                <h1 className="mt-2 truncate text-3xl font-semibold md:text-4xl">
                  Hi, {profileForm.fullName || "Customer"}
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

        <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="self-start rounded-2xl bg-white p-3 shadow-[0_14px_30px_rgba(102,91,72,0.1)] lg:sticky lg:top-4">
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
                <div className="grid gap-5 md:grid-cols-3">
                  <MetricCard
                    label="Upcoming"
                    value={upcomingAppointments.length}
                    description="Pending or confirmed visits."
                  />
                  <MetricCard
                    label="Pets"
                    value={customerPetRecords.length}
                    description="Pet profiles connected to your account."
                  />
                  <MetricCard
                    label="Unread"
                    value={unreadNotificationCount}
                    description="Clinic updates and booking notices."
                  />
                </div>

                <section className="rounded-[30px] bg-white p-6 shadow-[0_18px_36px_rgba(102,91,72,0.12)]">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#7B9A9F]">
                        Next step
                      </p>
                      <h2 className="mt-2 text-2xl font-semibold text-[#20343B]">
                        Continue with services or book a new appointment.
                      </h2>
                    </div>
                    <div className="flex flex-wrap gap-2">
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
                        className="rounded-2xl bg-[#173E44] px-4 py-3 text-sm font-semibold text-white"
                      >
                        Book appointment
                      </button>
                    </div>
                  </div>
                </section>

                <section className="rounded-[30px] bg-white p-6 shadow-[0_18px_36px_rgba(102,91,72,0.12)]">
                  <div className="flex items-center gap-3">
                    <Bell size={20} className="text-[#2D6B73]" />
                    <h2 className="text-xl font-semibold text-[#20343B]">Notifications</h2>
                  </div>
                  <div className="mt-4 space-y-3">
                    {visibleNotifications.length === 0 ? (
                      <EmptyState
                        title="No notifications yet"
                        message="Booking confirmations and appointment updates will appear here."
                      />
                    ) : (
                      visibleNotifications.slice(0, 4).map((notification) => {
                        const isUnread = !notification.readBy.includes(customer?.id || customer?.uid);

                        return (
                          <button
                            key={notification.id}
                            type="button"
                            onClick={() => markNotificationRead(notification.id)}
                            className={`w-full rounded-[24px] border px-5 py-4 text-left transition ${
                              isUnread
                                ? "border-[#2D9B9B] bg-[#F5FBFB]"
                                : "border-[#E6EFEE] bg-[#FBFDFC]"
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <p className="font-semibold text-[#20343B]">{notification.title}</p>
                              <StatusChip label={notification.actionLabel} />
                            </div>
                            <p className="mt-2 text-sm leading-6 text-[#607277]">
                              {notification.message}
                            </p>
                            <p className="mt-3 text-xs text-[#7A9297]">
                              {formatNotificationDate(notification.createdAt)}
                            </p>
                          </button>
                        );
                      })
                    )}
                  </div>
                </section>
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
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7A979C]">
                            {service.category}
                          </p>
                          <h3 className="mt-1 text-lg font-semibold text-[#20343B]">
                            {service.name}
                          </h3>
                        </div>
                        <span className="rounded-lg bg-[#F7F2E9] px-2.5 py-1 text-xs font-semibold text-[#6A5D4A]">
                          {service.priceLabel}
                        </span>
                      </div>
                      <p className="mt-3 flex-1 text-sm leading-6 text-[#607277]">{service.description}</p>
                      <p className="mt-3 text-xs font-semibold text-[#2D6B73]">
                        Estimated visit time: {service.duration}
                      </p>
                      <button
                        type="button"
                        onClick={() => openTab("booking")}
                        className="mt-4 w-full rounded-xl bg-[#173E44] px-4 py-3 text-sm font-semibold text-white"
                      >
                        Continue to booking
                      </button>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {activeTab === "booking" && <AppointmentBooking embedded />}

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
                      <div className="mt-6 grid gap-4 md:grid-cols-2">
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
                      Profile and saved pets
                    </h2>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-[#EEF6F6] px-4 py-3 text-sm font-semibold text-[#24444A]">
                      <Camera size={16} />
                      {isSavingPhoto ? "Saving..." : "Change photo"}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={handleProfilePhotoSelection}
                        disabled={isSavingPhoto}
                        className="hidden"
                      />
                    </label>
                    {customerPhotoURL && (
                      <button
                        type="button"
                        onClick={clearProfilePhoto}
                        disabled={isSavingPhoto}
                        className="rounded-2xl bg-[#FBECEF] px-4 py-3 text-sm font-semibold text-[#B23949]"
                      >
                        Remove photo
                      </button>
                    )}
                  </div>
                </div>

                <form onSubmit={saveProfile} className="mt-6 space-y-5">
                  <div className="grid gap-5 md:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-[#425A60]">Full Name</label>
                      <input
                        value={profileForm.fullName}
                        onChange={handleProfileChange("fullName")}
                        className="w-full rounded-[20px] border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-[#425A60]">Username</label>
                      <input
                        value={profileForm.username}
                        onChange={handleProfileChange("username")}
                        className="w-full rounded-[20px] border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-[#425A60]">Email</label>
                      <input
                        type="email"
                        value={profileForm.email}
                        onChange={handleProfileChange("email")}
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
                        onChange={handleProfileChange("phone")}
                        className="w-full rounded-[20px] border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={isSavingProfile || isSavingPhoto}
                    className="rounded-[20px] bg-[#2D9B9B] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#288A8A] disabled:cursor-not-allowed disabled:bg-[#9CB5B8]"
                  >
                    {isSavingProfile ? "Saving profile..." : "Save profile"}
                  </button>
                </form>

                <div className="mt-8 grid gap-6 xl:grid-cols-[0.88fr_1.12fr]">
                  <form onSubmit={savePet} className="rounded-[28px] bg-[#FBFDFC] p-6">
                    <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#7A979C]">
                      Add or update pet
                    </p>
                    <div className="mt-5 grid gap-4">
                      <input
                        value={petForm.petName}
                        onChange={(event) =>
                          setPetForm((current) => ({ ...current, petName: event.target.value }))
                        }
                        className="rounded-[18px] border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                        placeholder="Pet name"
                      />
                      <select
                        value={petForm.petType}
                        onChange={(event) =>
                          setPetForm((current) => ({ ...current, petType: event.target.value }))
                        }
                        className="rounded-[18px] border border-[#D9E7E7] bg-white px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                      >
                        <option value="">Select pet type</option>
                        <option value="Dog">Dog</option>
                        <option value="Cat">Cat</option>
                      </select>
                      <input
                        value={petForm.breed}
                        onChange={(event) =>
                          setPetForm((current) => ({ ...current, breed: event.target.value }))
                        }
                        className="rounded-[18px] border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                        placeholder="Breed"
                      />
                      <textarea
                        value={petForm.notes}
                        onChange={(event) =>
                          setPetForm((current) => ({ ...current, notes: event.target.value }))
                        }
                        className="min-h-28 rounded-[18px] border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                        placeholder="Notes for staff or future visits"
                      />
                      <div className="flex flex-col gap-3 rounded-[20px] border border-dashed border-[#D9E7E7] bg-white p-4 sm:flex-row sm:items-center">
                        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[#EEF6F6] text-[#5E777C]">
                          {petForm.photoURL ? (
                            <img
                              src={petForm.photoURL}
                              alt={`${petForm.petName || "Pet"} preview`}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <PawPrint size={26} />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-[#EEF6F6] px-4 py-3 text-sm font-semibold text-[#24444A]">
                            <Camera size={16} />
                            Pet photo
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              onChange={handlePetPhotoSelection}
                              className="hidden"
                            />
                          </label>
                        </div>
                      </div>
                      <div className="flex gap-3">
                        <button
                          type="submit"
                          disabled={isSavingPet || !petFormChanged}
                          className="rounded-[18px] bg-[#173E44] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#9CB5B8]"
                        >
                          {isSavingPet
                            ? "Saving pet..."
                            : petForm.id
                              ? "SAVE CHANGES"
                              : "Save pet"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setPetForm(buildEmptyPetForm())
                          }
                          disabled={isSavingPet}
                          className="rounded-[18px] bg-[#EEF6F6] px-5 py-3 text-sm font-semibold text-[#2B555C]"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  </form>

                  <div className="space-y-4">
                    {customerPetRecords.length === 0 ? (
                      <EmptyState
                        title="No pet records yet"
                        message="Book an appointment or add a pet here so future visits are faster."
                      />
                    ) : (
                      customerPetRecords.map((record) => (
                        <button
                          key={record.id}
                          type="button"
                          onClick={() =>
                            setPetForm(buildPetFormFromRecord(record))
                          }
                          className="w-full rounded-[28px] border border-[#E6EFEE] bg-[#FBFDFC] px-5 py-5 text-left transition hover:border-[#2D9B9B]"
                        >
                          <div className="flex flex-wrap items-center gap-3">
                            {record.photoURL ? (
                              <img
                                src={record.photoURL}
                                alt={`${record.petName} profile`}
                                className="h-12 w-12 rounded-2xl object-cover"
                              />
                            ) : (
                              <PawPrint size={18} className="text-[#2D6B73]" />
                            )}
                            <h3 className="text-xl font-semibold text-[#20343B]">{record.petName}</h3>
                            <StatusChip label={record.petType} />
                          </div>
                          <p className="mt-3 text-sm text-[#607277]">
                            {record.breed || "Breed not specified"}
                          </p>
                          <p className="mt-3 rounded-[18px] bg-white px-4 py-3 text-sm text-[#50666B]">
                            {record.notes || "No extra notes yet."}
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
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
