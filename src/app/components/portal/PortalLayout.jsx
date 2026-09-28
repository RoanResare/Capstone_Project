import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Bell, CalendarDays, Eye, EyeOff, Image, LogOut, PawPrint, Users, X } from "lucide-react";
import { useApp } from "../../context/AppContext.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { BrandMark } from "../BrandMark.jsx";
import { updateMyProfile } from "../../services/userApi.js";

const iconMap = {
  appointments: CalendarDays,
  "pet-records": PawPrint,
  "photo-moderation": Image,
  "manage-users": Users,
};

function formatDateTime(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Just now";
  }

  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
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

function describeNotificationSubject(notification) {
  if (notification.targetType === "appointment") {
    const schedule = [notification.appointmentDate, notification.appointmentTime]
      .filter(Boolean)
      .join(" ");
    const service = notification.serviceName || "Appointment";
    const petName = notification.petName || notification.subjectName || "Pet";
    return `${petName} | ${service}${schedule ? ` | ${schedule}` : ""}`;
  }

  const subjectRole = notification.subjectRole || "Account";
  const subjectName = notification.subjectName || notification.actorName;
  return `${subjectName} | ${subjectRole}`;
}

function PortalNavLink({ module }) {
  const Icon = iconMap[module.id] || CalendarDays;

  return (
    <NavLink
      to={module.id === "appointments" ? "/portal/appointments" : `/portal/${module.id}`}
      end
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition-all ${
          isActive
            ? "bg-[#2D9B9B] text-white shadow-[0_12px_24px_rgba(45,155,155,0.25)]"
            : "text-[#365057] hover:bg-[#E9F3F3]"
        }`
      }
    >
      <Icon size={18} />
      <span>{module.label}</span>
    </NavLink>
  );
}

function NotificationPanel({
  currentUser,
  notifications,
  markNotificationRead,
  markAllNotificationsRead,
  onClose,
}) {
  const navigate = useNavigate();

  const unreadCount = notifications.filter(
    (notification) => !notification.readBy.includes(currentUser.id),
  ).length;

  const openNotification = (notification) => {
    markNotificationRead(notification.id);
    if (notification.targetType === "portal-account" && currentUser.role !== "admin") {
      navigate(`/portal/appointments?notification=${notification.id}`);
      onClose();
      return;
    }

    navigate(notification.targetHref || "/portal/appointments");
    onClose();
  };

  return (
    <div className="fixed right-3 top-20 z-30 w-[calc(100vw-1.5rem)] max-w-[380px] rounded-2xl border border-[#E2EBEB] bg-white p-4 shadow-[0_20px_44px_rgba(68,78,79,0.18)] sm:absolute sm:right-0 sm:top-[calc(100%+0.5rem)]">
      <div className="flex items-start justify-between gap-3 border-b border-[#EEF2F2] pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7B9A9F]">
            Notifications
          </p>
          <h3 className="mt-1 text-base font-semibold text-[#20343B]">
            Appointment and account updates
          </h3>
          <p className="mt-1 text-sm text-[#607277]">
            {unreadCount > 0
              ? `${unreadCount} unread update${unreadCount === 1 ? "" : "s"}`
              : "Everything is up to date."}
          </p>
        </div>
        <button
          type="button"
          onClick={markAllNotificationsRead}
          className="rounded-lg bg-[#EEF6F6] px-3 py-2 text-xs font-semibold text-[#24444A] transition hover:bg-[#E3F0F0]"
        >
          Mark read
        </button>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#F6FAFA] text-[#365057] transition hover:bg-[#E9F3F3] sm:hidden"
          aria-label="Close notifications"
        >
          <X size={16} />
        </button>
      </div>

      {notifications.length === 0 ? (
        <div className="mt-3 rounded-lg bg-[#F7FBFB] px-4 py-4 text-sm text-[#607277]">
          No notifications yet. Customer registrations and appointment bookings will appear here.
        </div>
      ) : (
        <div className="mt-3 max-h-[min(420px,calc(100vh-9rem))] space-y-2.5 overflow-y-auto pr-1">
          {notifications.map((notification) => {
            const isUnread = !notification.readBy.includes(currentUser.id);

            return (
              <button
                key={notification.id}
                type="button"
                onClick={() => openNotification(notification)}
                className={`w-full rounded-xl border px-3.5 py-3 text-left transition ${
                  isUnread
                    ? "border-[#D7ECEC] bg-[#F8FCFC] hover:border-[#BFE1E1]"
                    : "border-[#EDF2F2] bg-white hover:border-[#D7E8E8]"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[#20343B]">{notification.title}</p>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#607277]">{notification.message}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      isUnread ? "bg-[#173E44] text-white" : "bg-[#EEF3F5] text-[#4C6368]"
                    }`}
                  >
                    {isUnread ? "Unread" : "Read"}
                  </span>
                </div>

                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-[#607277]">
                  <span className="rounded-full bg-[#F2F6F6] px-2.5 py-1 font-semibold text-[#365057]">
                    {notification.actorName} | {notification.actorRole}
                  </span>
                  <span className={`rounded-full px-2.5 py-1 font-semibold ${notificationTone(notification.level)}`}>
                    {notification.actionLabel}
                  </span>
                </div>

                <p className="mt-2 text-xs text-[#4E686E]">{describeNotificationSubject(notification)}</p>
                <p className="mt-2 text-xs text-[#7A9297]">{formatDateTime(notification.createdAt)}</p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function PortalLayout() {
  const {
    currentUser,
    accessibleModules,
    visibleNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    signOut,
  } = useApp();
  const { accessToken, refreshCurrentUser } = useAuth();
  const [panelOpen, setPanelOpen] = useState(false);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [profileForm, setProfileForm] = useState({ fullName: "", email: "", phone: "", currentPassword: "" });
  const [profileFeedback, setProfileFeedback] = useState({ type: "", message: "" });
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [showProfilePassword, setShowProfilePassword] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setProfileForm({
      fullName: currentUser.name || currentUser.fullName || "",
      email: currentUser.email || "",
      phone: currentUser.phone || "",
      currentPassword: "",
    });
  }, [currentUser]);

  useEffect(() => {
    setPanelOpen(false);
  }, [location.pathname, location.search]);

  const unreadCount = visibleNotifications.filter(
    (notification) => !notification.readBy.includes(currentUser.id),
  ).length;

  const saveOwnProfile = async (event) => {
    event.preventDefault();
    if (isSavingProfile) {
      return;
    }

    setIsSavingProfile(true);
    setProfileFeedback({ type: "", message: "" });

    try {
      const response = await updateMyProfile(accessToken, currentUser.role, profileForm);
      await refreshCurrentUser();
      setProfileForm((current) => ({ ...current, currentPassword: "" }));
      setProfileFeedback({ type: "success", message: response.message || "Profile updated successfully." });
    } catch (error) {
      setProfileFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Unable to update your profile.",
      });
    } finally {
      setIsSavingProfile(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F1E8] px-4 py-5 md:px-6">
      <div className="mx-auto grid max-w-[1440px] gap-5 xl:h-[calc(100vh-2.5rem)] xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-[30px] bg-white p-5 shadow-[0_18px_36px_rgba(102,91,72,0.12)] xl:sticky xl:top-5 xl:h-[calc(100vh-2.5rem)]">
          <div className="flex items-center gap-3 border-b border-[#EAE5DC] pb-5">
            <BrandMark className="h-14 w-14 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6C8C92]">
                {currentUser.role}
              </p>
              <h1 className="text-lg font-semibold text-[#20343B]">
                {currentUser.role === "admin" ? "Admin Operations" : "Staff Operations"}
              </h1>
            </div>
          </div>

          <div className="mt-5 rounded-[24px] bg-[#173E44] px-4 py-5 text-white">
            <p className="text-sm text-white/70">Signed in as</p>
            <p className="mt-1 text-lg font-semibold">{currentUser.name}</p>
            <p className="text-sm text-white/70">{currentUser.email}</p>
          </div>

          <nav className="mt-5 grid gap-2">
            {accessibleModules.map((module) => (
              <PortalNavLink key={module.id} module={module} />
            ))}
          </nav>

          <button
            type="button"
            onClick={() => {
              setProfileEditorOpen((open) => !open);
              setProfileFeedback({ type: "", message: "" });
            }}
            className="mt-3 flex w-full items-center justify-center rounded-2xl bg-[#EEF6F6] px-4 py-3 text-sm font-semibold text-[#24444A] transition hover:bg-[#E3F0F0]"
          >
            {profileEditorOpen ? "Close profile editor" : "Edit my profile"}
          </button>

          <button
            type="button"
            onClick={signOut}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl border border-[#D9E7E7] px-4 py-3 text-sm font-semibold text-[#24444A] transition hover:bg-[#F4FBFB]"
          >
            <LogOut size={16} />
            Sign Out
          </button>
        </aside>

        <section className="min-w-0 space-y-5 xl:flex xl:min-h-0 xl:flex-col">
          <header className="flex flex-col gap-4 rounded-[30px] bg-white px-6 py-5 shadow-[0_18px_36px_rgba(102,91,72,0.12)] md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#789AA0]">
                Charming Fur-fection Portal
              </p>
              <h2 className="mt-1 text-2xl font-semibold text-[#20343B]">
                Welcome back, {currentUser.name.split(" ")[0]}
              </h2>
              <p className="mt-1 text-sm text-[#5D7075]">
                Customer bookings, pet records, employee accounts, and queue updates stay synchronized here.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setPanelOpen((current) => !current)}
                  className="relative flex items-center gap-2 rounded-2xl bg-[#F0F7F7] px-4 py-3 text-sm font-semibold text-[#24444A] transition hover:bg-[#E5F3F3]"
                >
                  <Bell size={18} />
                  Notifications
                  {unreadCount > 0 && (
                    <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-[#D94A59] px-2 text-xs text-white">
                      {unreadCount}
                    </span>
                  )}
                </button>

                {panelOpen && (
                  <NotificationPanel
                    currentUser={currentUser}
                    notifications={visibleNotifications}
                    markNotificationRead={markNotificationRead}
                    markAllNotificationsRead={markAllNotificationsRead}
                    onClose={() => setPanelOpen(false)}
                  />
                )}
              </div>

              <div className="hidden rounded-2xl bg-[#173E44] px-4 py-3 text-sm text-white md:block">
                <div className="font-semibold">Operations Workspace</div>
                <div className="text-white/70">
                  {accessibleModules.length} enabled module
                  {accessibleModules.length === 1 ? "" : "s"}
                </div>
              </div>
            </div>
          </header>

          <div className="min-h-0 xl:flex-1 xl:overflow-y-auto xl:pr-1">
            <Outlet />
          </div>
        </section>
      </div>

      {profileEditorOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#173E44]/35 px-4 py-6">
          <form onSubmit={saveOwnProfile} className="w-full max-w-lg rounded-[28px] bg-white p-6 shadow-[0_24px_60px_rgba(20,43,46,0.25)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7B9A9F]">Profile information</p>
                <h2 className="mt-2 text-2xl font-semibold text-[#20343B]">Edit your account</h2>
              </div>
              <button type="button" onClick={() => setProfileEditorOpen(false)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#F6FAFA] text-[#365057]" aria-label="Close profile editor"><X size={16} /></button>
            </div>

            <div className="mt-5 grid gap-4">
              <label className="text-sm font-medium text-[#425A60]">Full name<input value={profileForm.fullName} onChange={(event) => setProfileForm((current) => ({ ...current, fullName: event.target.value }))} className="mt-2 w-full rounded-lg border border-[#D9E7E7] px-4 py-3 outline-none focus:border-[#2D9B9B]" /></label>
              <label className="text-sm font-medium text-[#425A60]">Email<input type="email" value={profileForm.email} onChange={(event) => setProfileForm((current) => ({ ...current, email: event.target.value }))} className="mt-2 w-full rounded-lg border border-[#D9E7E7] px-4 py-3 outline-none focus:border-[#2D9B9B]" /></label>
              <label className="text-sm font-medium text-[#425A60]">Phone number<input value={profileForm.phone} onChange={(event) => setProfileForm((current) => ({ ...current, phone: event.target.value.replace(/\D/g, "").slice(0, 11) }))} inputMode="numeric" maxLength={11} className="mt-2 w-full rounded-lg border border-[#D9E7E7] px-4 py-3 outline-none focus:border-[#2D9B9B]" /></label>
              <label className="text-sm font-medium text-[#425A60]">Current password<div className="relative mt-2"><input type={showProfilePassword ? "text" : "password"} value={profileForm.currentPassword} onChange={(event) => setProfileForm((current) => ({ ...current, currentPassword: event.target.value }))} autoComplete="current-password" className="w-full rounded-lg border border-[#D9E7E7] px-4 py-3 pr-11 outline-none focus:border-[#2D9B9B]" placeholder="Required to authorize changes" /><button type="button" onClick={() => setShowProfilePassword((visible) => !visible)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#607277]" aria-label={showProfilePassword ? "Hide current password" : "Show current password"}>{showProfilePassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
            </div>
            <p className="mt-3 text-xs text-[#7A9297]">Your password is verified before profile information is changed.</p>
            <button type="submit" disabled={isSavingProfile} className="mt-5 w-full rounded-lg bg-[#173E44] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">{isSavingProfile ? "Saving profile..." : "Save profile"}</button>
            {profileFeedback.message && <p className={`mt-4 rounded-lg px-4 py-3 text-sm ${profileFeedback.type === "error" ? "bg-[#FBECEF] text-[#B23949]" : "bg-[#EAF7F7] text-[#2D6B73]"}`}>{profileFeedback.message}</p>}
          </form>
        </div>
      )}
    </div>
  );
}
