import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Bell, CalendarDays, Camera, PawPrint, UserRound } from "lucide-react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";

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
  const isoValue = `${date}T${normalizedTime}:00`;
  const parsed = new Date(isoValue);
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

export function CustomerProfile() {
  const navigate = useNavigate();
  const { currentUser, isAuthenticated, isLoading, signOut, updateProfile } = useAuth();
  const {
    markNotificationRead,
    savePetRecord,
    state,
    updateAppointment,
    visibleNotifications,
  } = useApp();
  const [activeTab, setActiveTab] = useState("pets");
  const [profileForm, setProfileForm] = useState({
    fullName: "",
    username: "",
    email: "",
    phone: "",
    status: "active",
    photoURL: "",
  });
  const [petForm, setPetForm] = useState({
    id: "",
    petName: "",
    petType: "",
    breed: "",
    notes: "",
  });
  const [selectedAppointmentId, setSelectedAppointmentId] = useState("");
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const customer = currentUser?.role === "customer" ? currentUser : null;

  useEffect(() => {
    if (!customer) {
      return;
    }

    setProfileForm({
      fullName: customer.fullName || "",
      username: customer.username || "",
      email: customer.email || "",
      phone: customer.phone || "",
      status: customer.status || "active",
      photoURL: customer.photoURL || "",
    });
  }, [customer]);

  const customerPetRecords = state.petRecords.filter(
    (record) =>
      record.customerId === customer?.uid ||
      record.customerEmail?.toLowerCase() === customer?.email?.toLowerCase(),
  );
  const customerAppointments = state.appointments
    .filter(
      (appointment) =>
        appointment.customerId === customer?.uid ||
        appointment.customerEmail?.toLowerCase() === customer?.email?.toLowerCase(),
    )
    .sort((left, right) =>
      `${right.scheduleDate} ${right.scheduleTime}`.localeCompare(
        `${left.scheduleDate} ${left.scheduleTime}`,
      ),
    );
  const selectedAppointment =
    customerAppointments.find((appointment) => appointment.id === selectedAppointmentId) ||
    customerAppointments[0] ||
    null;
  const unreadNotificationCount = visibleNotifications.filter(
    (notification) => !notification.readBy.includes(customer?.id),
  ).length;

  useEffect(() => {
    if (!selectedAppointmentId && customerAppointments[0]) {
      setSelectedAppointmentId(customerAppointments[0].id);
    }
  }, [customerAppointments, selectedAppointmentId]);

  if (!isLoading && (!isAuthenticated || !customer)) {
    return <Navigate to="/customer/login" replace />;
  }

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

  const applySavedProfile = (user, message) => {
    setProfileForm({
      fullName: user.fullName || "",
      username: user.username || "",
      email: user.email || "",
      phone: user.phone || "",
      status: user.status || "active",
      photoURL: user.photoURL || "",
    });
    setFeedback({ type: "success", message });
  };

  const handleProfilePhotoSelection = async (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = "";

    if (!file || isSavingProfile) {
      return;
    }

    if (!profileForm.fullName.trim() || !profileForm.email.trim() || !profileForm.username.trim()) {
      setFeedback({ type: "error", message: "Full name, username, and email are required before uploading a photo." });
      return;
    }

    setIsSavingProfile(true);
    setFeedback({ type: "", message: "" });

    try {
      const result = await updateProfile(buildProfilePayload({ photoFile: file }));

      if (!result.ok) {
        setFeedback({ type: "error", message: result.error });
        return;
      }

      applySavedProfile(result.user, "Profile photo uploaded successfully.");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const clearProfilePhoto = async () => {
    if (!profileForm.photoURL || isSavingProfile) {
      return;
    }

    setIsSavingProfile(true);
    setFeedback({ type: "", message: "" });

    try {
      const result = await updateProfile(buildProfilePayload({ removePhoto: true }));

      if (!result.ok) {
        setFeedback({ type: "error", message: result.error });
        return;
      }

      applySavedProfile(result.user, "Profile photo removed successfully.");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const saveProfile = async (event) => {
    event.preventDefault();

    if (isSavingProfile) {
      return;
    }

    if (!profileForm.fullName.trim() || !profileForm.email.trim() || !profileForm.username.trim()) {
      setFeedback({ type: "error", message: "Full name, username, and email are required." });
      return;
    }

    setIsSavingProfile(true);

    try {
      const result = await updateProfile(buildProfilePayload());

      if (!result.ok) {
        setFeedback({ type: "error", message: result.error });
        return;
      }

      applySavedProfile(result.user, "Customer profile updated successfully.");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const savePet = (event) => {
    event.preventDefault();
    if (!petForm.petName.trim() || !petForm.petType.trim()) {
      setFeedback({ type: "error", message: "Pet name and pet type are required." });
      return;
    }

    const existingRecord = customerPetRecords.find((record) => record.id === petForm.id);
    savePetRecord(
      {
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
      },
      profileForm.fullName,
    );
    setPetForm({ id: "", petName: "", petType: "", breed: "", notes: "" });
    setFeedback({ type: "success", message: "Pet record saved successfully." });
  };

  const cancelAppointment = (appointmentId) => {
    updateAppointment(appointmentId, { status: "Cancelled" }, profileForm.fullName);
    setFeedback({
      type: "success",
      message: "Appointment cancelled. The clinic queue has been updated.",
    });
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const customerPhotoURL = profileForm.photoURL;

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-[#F6F0E7] px-6 py-14">
      <div className="mx-auto max-w-[1260px] space-y-8">
        <motion.section
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="grid gap-6 lg:grid-cols-[0.86fr_1.14fr]"
        >
          <div className="rounded-[36px] bg-[linear-gradient(135deg,#173E44_0%,#2D6B73_58%,#82C8C0_100%)] p-8 text-white shadow-[0_24px_56px_rgba(20,43,46,0.2)] md:p-10">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white/70">
                  Customer Profile
                </p>
                <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em]">
                  Manage your account, pets, and appointment history.
                </h1>
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                className="rounded-full border border-white/16 bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/14"
              >
                Sign out
              </button>
            </div>

            <div className="mt-8 flex flex-col gap-6 md:flex-row md:items-center">
              <div className="flex flex-col items-start gap-3">
                <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-white/12 text-3xl font-bold">
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
                <div className="flex flex-wrap gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/14 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white transition hover:bg-white/14">
                    <Camera size={14} />
                    {isSavingProfile ? "Saving..." : "Change photo"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleProfilePhotoSelection}
                      disabled={isSavingProfile}
                      className="hidden"
                    />
                  </label>
                  {customerPhotoURL && (
                    <button
                      type="button"
                      onClick={clearProfilePhoto}
                      disabled={isSavingProfile}
                      className="rounded-full border border-white/14 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white transition hover:bg-white/14"
                    >
                      Remove photo
                    </button>
                  )}
                </div>
              </div>
              <div>
                <h2 className="text-2xl font-semibold">{profileForm.fullName}</h2>
                <p className="mt-1 text-sm text-white/72">{profileForm.email}</p>
                <p className="mt-1 text-sm text-white/60">@{profileForm.username}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <StatusChip label={profileForm.status} />
                  <StatusChip label={`${customerPetRecords.length} pets`} />
                  <StatusChip label={`${customerAppointments.length} appointments`} />
                </div>
              </div>
            </div>

            {profileForm.status !== "active" && (
              <div className="mt-8 rounded-[24px] border border-[#F4B7BE] bg-[#FFF1F3] px-5 py-4 text-sm text-[#8A3240]">
                Your account is currently suspended. You can still review your profile, but new
                bookings are disabled until the clinic reactivates your account.
              </div>
            )}

            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              <div className="rounded-[24px] border border-white/10 bg-white/8 p-5">
                <div className="flex h-11 w-11 items-center justify-center rounded-[16px] bg-white/12">
                  <UserRound size={20} />
                </div>
                <p className="mt-4 text-sm text-white/68">Profile access</p>
                <p className="mt-2 text-lg font-semibold">Update photo, name, username, and email</p>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-white/8 p-5">
                <div className="flex h-11 w-11 items-center justify-center rounded-[16px] bg-white/12">
                  <PawPrint size={20} />
                </div>
                <p className="mt-4 text-sm text-white/68">Manage pets</p>
                <p className="mt-2 text-lg font-semibold">Save pet records for future visits</p>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-white/8 p-5">
                <div className="flex h-11 w-11 items-center justify-center rounded-[16px] bg-white/12">
                  <CalendarDays size={20} />
                </div>
                <p className="mt-4 text-sm text-white/68">Appointments</p>
                <p className="mt-2 text-lg font-semibold">Review and cancel upcoming bookings</p>
              </div>
            </div>
          </div>

          <div className="rounded-[36px] bg-white p-8 shadow-[0_18px_42px_rgba(94,81,60,0.14)] md:p-10">
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setActiveTab("pets")}
                className={`rounded-full px-5 py-3 text-sm font-semibold transition ${
                  activeTab === "pets"
                    ? "bg-[#173E44] text-white"
                    : "bg-[#EEF6F6] text-[#2B555C]"
                }`}
              >
                Manage pets
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("appointments")}
                className={`rounded-full px-5 py-3 text-sm font-semibold transition ${
                  activeTab === "appointments"
                    ? "bg-[#173E44] text-white"
                    : "bg-[#EEF6F6] text-[#2B555C]"
                }`}
              >
                Appointment history
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("notifications")}
                className={`inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition ${
                  activeTab === "notifications"
                    ? "bg-[#173E44] text-white"
                    : "bg-[#EEF6F6] text-[#2B555C]"
                }`}
              >
                Notifications
                {unreadNotificationCount > 0 && (
                  <span className="rounded-full bg-[#F4C16A] px-2 py-0.5 text-xs text-[#173E44]">
                    {unreadNotificationCount}
                  </span>
                )}
              </button>
            </div>

            <form onSubmit={saveProfile} className="mt-8 space-y-5">
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
                  <p className="mt-2 text-xs text-[#7A9297]">
                    This username is part of your customer profile only.
                  </p>
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
                    Updating this also updates your Firebase Authentication email.
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
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#425A60]">Security</label>
                  <div className="rounded-[20px] bg-[#F5FAFA] px-4 py-3 text-sm text-[#607277]">
                    Password updates are managed through Firebase Authentication.
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                  type="submit"
                  disabled={isSavingProfile}
                  className="rounded-[20px] bg-[#2D9B9B] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#288A8A]"
                >
                  {isSavingProfile ? "Saving profile..." : "Save profile"}
                </button>
                <Link
                  to="/appointment"
                  className={`rounded-[20px] border border-[#D7E5E5] px-5 py-3 text-sm font-semibold text-[#2B555C] transition hover:bg-[#F5FAFA] ${
                    profileForm.status !== "active" ? "pointer-events-none opacity-50" : ""
                  }`}
                >
                  Book appointment
                </Link>
              </div>
            </form>

            {activeTab === "pets" && (
              <div className="mt-10 grid gap-6 xl:grid-cols-[0.88fr_1.12fr]">
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
                    <input
                      value={petForm.petType}
                      onChange={(event) =>
                        setPetForm((current) => ({ ...current, petType: event.target.value }))
                      }
                      className="rounded-[18px] border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                      placeholder="Pet type"
                    />
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
                    <div className="flex gap-3">
                      <button
                        type="submit"
                        className="rounded-[18px] bg-[#173E44] px-5 py-3 text-sm font-semibold text-white"
                      >
                        Save pet
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setPetForm({ id: "", petName: "", petType: "", breed: "", notes: "" })
                        }
                        className="rounded-[18px] bg-[#EEF6F6] px-5 py-3 text-sm font-semibold text-[#2B555C]"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                </form>

                <div className="space-y-4">
                  {customerPetRecords.length === 0 ? (
                    <div className="rounded-[28px] border border-dashed border-[#D7E5E5] bg-[#FBFDFC] px-6 py-10 text-center">
                      <h3 className="text-lg font-semibold text-[#20343B]">No pet records yet</h3>
                      <p className="mt-2 text-sm text-[#607277]">
                        Add your first pet so future appointments are faster to book.
                      </p>
                    </div>
                  ) : (
                    customerPetRecords.map((record) => (
                      <button
                        key={record.id}
                        type="button"
                        onClick={() =>
                          setPetForm({
                            id: record.id,
                            petName: record.petName,
                            petType: record.petType,
                            breed: record.breed,
                            notes: record.notes || "",
                          })
                        }
                        className="w-full rounded-[28px] border border-[#E6EFEE] bg-[#FBFDFC] px-5 py-5 text-left transition hover:border-[#2D9B9B]"
                      >
                        <div className="flex flex-wrap items-center gap-3">
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
            )}

            {activeTab === "appointments" && (
              <div className="mt-10 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
                <div className="space-y-4">
                  {customerAppointments.length === 0 ? (
                    <div className="rounded-[28px] border border-dashed border-[#D7E5E5] bg-[#FBFDFC] px-6 py-10 text-center">
                      <h3 className="text-lg font-semibold text-[#20343B]">
                        No appointments yet
                      </h3>
                      <p className="mt-2 text-sm text-[#607277]">
                        Book your first appointment to start building your history.
                      </p>
                    </div>
                  ) : (
                    customerAppointments.map((appointment) => (
                      <button
                        key={appointment.id}
                        type="button"
                        onClick={() => setSelectedAppointmentId(appointment.id)}
                        className={`w-full rounded-[28px] border px-5 py-5 text-left transition ${
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
                          {formatDateTimeLabel(
                            appointment.scheduleDate,
                            appointment.scheduleTime,
                          )}
                        </p>
                      </button>
                    ))
                  )}
                </div>

                <div className="rounded-[28px] bg-[#FBFDFC] p-6">
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
                        <div className="rounded-[22px] bg-white px-4 py-4">
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
                        <div className="rounded-[22px] bg-white px-4 py-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7A979C]">
                            Assigned staff
                          </p>
                          <p className="mt-2 text-base font-semibold text-[#20343B]">
                            {selectedAppointment.assignedStaff || "To be assigned"}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 rounded-[22px] bg-white px-4 py-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7A979C]">
                          Notes
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
                    <div className="rounded-[24px] border border-dashed border-[#D7E5E5] px-6 py-10 text-center">
                      <h3 className="text-lg font-semibold text-[#20343B]">
                        Select an appointment
                      </h3>
                      <p className="mt-2 text-sm text-[#607277]">
                        Appointment details will appear here.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === "notifications" && (
              <div className="mt-10 space-y-4">
                {visibleNotifications.length === 0 ? (
                  <div className="rounded-[28px] border border-dashed border-[#D7E5E5] bg-[#FBFDFC] px-6 py-10 text-center">
                    <Bell className="mx-auto text-[#7A979C]" size={28} />
                    <h3 className="mt-3 text-lg font-semibold text-[#20343B]">
                      No notifications yet
                    </h3>
                    <p className="mt-2 text-sm text-[#607277]">
                      Booking confirmations and appointment updates will appear here.
                    </p>
                  </div>
                ) : (
                  visibleNotifications.map((notification) => {
                    const isUnread = !notification.readBy.includes(customer?.id);

                    return (
                      <button
                        key={notification.id}
                        type="button"
                        onClick={() => markNotificationRead(notification.id)}
                        className={`w-full rounded-[28px] border px-5 py-5 text-left transition ${
                          isUnread
                            ? "border-[#2D9B9B] bg-[#F5FBFB]"
                            : "border-[#E6EFEE] bg-[#FBFDFC]"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <h3 className="text-lg font-semibold text-[#20343B]">
                            {notification.title}
                          </h3>
                          <StatusChip label={notification.actionLabel} />
                        </div>
                        <p className="mt-2 text-sm leading-6 text-[#607277]">
                          {notification.message}
                        </p>
                        <div className="mt-4 grid gap-3 text-sm text-[#50666B] md:grid-cols-3">
                          <span>{notification.serviceName || "Appointment"}</span>
                          <span>{notification.petName || "Pet details saved"}</span>
                          <span>{notification.appointmentDate} {notification.appointmentTime}</span>
                        </div>
                        <p className="mt-3 text-xs text-[#7A9297]">
                          {formatNotificationDate(notification.createdAt)}
                        </p>
                      </button>
                    );
                  })
                )}
              </div>
            )}

            {feedback.message && (
              <p
                className={`mt-8 rounded-[22px] px-4 py-3 text-sm font-medium ${
                  feedback.type === "error"
                    ? "bg-[#FBECEF] text-[#B23949]"
                    : "bg-[#EAF7F7] text-[#2D6B73]"
                }`}
              >
                {feedback.message}
              </p>
            )}
          </div>
        </motion.section>
      </div>
    </div>
  );
}
