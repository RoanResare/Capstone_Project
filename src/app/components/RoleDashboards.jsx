import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { CalendarDays, PawPrint, ShieldCheck, Users } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { useApp } from "../context/AppContext.jsx";

function DashboardCard({ title, value, description, tone = "teal" }) {
  const toneClasses = {
    teal: "bg-[#EAF7F7] text-[#2D6B73]",
    slate: "bg-[#EEF3F5] text-[#3E5960]",
    gold: "bg-[#FFF6E5] text-[#A56A0F]",
    rose: "bg-[#FBECEF] text-[#B23949]",
  };

  return (
    <div className={`rounded-[26px] px-5 py-5 ${toneClasses[tone]}`}>
      <p className="text-sm font-semibold uppercase tracking-[0.16em] opacity-80">{title}</p>
      <p className="mt-3 text-4xl font-bold">{value}</p>
      <p className="mt-2 text-sm leading-6 opacity-80">{description}</p>
    </div>
  );
}

function QuickLink({ to, icon: Icon, title, description }) {
  return (
    <Link
      to={to}
      className="rounded-[26px] border border-[#E6EFEE] bg-[#FCFEFE] p-5 transition hover:-translate-y-1 hover:border-[#BDD9D7]"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-[18px] bg-[#EAF6F6] text-[#2D6B73]">
        <Icon size={22} />
      </div>
      <h3 className="mt-5 text-xl font-semibold text-[#20343B]">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-[#607277]">{description}</p>
    </Link>
  );
}

function DashboardShell({ role }) {
  const { currentUser, signOut } = useAuth();
  const { state } = useApp();

  const pendingAppointments = state.appointments.filter(
    (appointment) => appointment.status === "Pending",
  ).length;
  const confirmedAppointments = state.appointments.filter(
    (appointment) => appointment.status === "Confirmed",
  ).length;
  const petRecords = state.petRecords.length;
  const employeeCount = state.users.filter((user) => ["admin", "staff"].includes(user.role)).length;

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-[#F6F0E7] px-6 py-14">
      <div className="mx-auto max-w-[1240px] space-y-8">
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="rounded-[36px] bg-[linear-gradient(135deg,#173E44_0%,#2D6B73_58%,#82C8C0_100%)] p-8 text-white shadow-[0_24px_56px_rgba(20,43,46,0.2)] md:p-10"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white/70">
                {role === "admin" ? "Admin Dashboard" : "Staff Dashboard"}
              </p>
              <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] md:text-[4.2rem]">
                {role === "admin"
                  ? "Review protected operations before entering the portal."
                  : "Track today's protected staff workload at a glance."}
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-7 text-white/78 md:text-lg">
                Signed in as {currentUser?.fullName}. Your account passed Firebase credential
                verification, matched the saved Firestore role, and completed the required email
                OTP challenge for this workspace.
              </p>
            </div>
            <button
              type="button"
              onClick={signOut}
              className="rounded-full border border-white/16 bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/14"
            >
              Sign out
            </button>
          </div>
        </motion.section>

        <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <DashboardCard
            title="Pending"
            value={pendingAppointments}
            description="Appointments waiting for action."
            tone="gold"
          />
          <DashboardCard
            title="Confirmed"
            value={confirmedAppointments}
            description="Upcoming visits already accepted."
            tone="teal"
          />
          <DashboardCard
            title="Pet Records"
            value={petRecords}
            description="Saved pet care histories available to staff."
            tone="slate"
          />
          <DashboardCard
            title={role === "admin" ? "Employees" : "Team Members"}
            value={employeeCount}
            description={
              role === "admin"
                ? "Portal accounts secured with role-based access."
                : "Visible admin and staff accounts in the workspace."
            }
            tone="rose"
          />
        </section>

        <section className="grid gap-5 lg:grid-cols-3">
          <QuickLink
            to="/portal/appointments"
            icon={CalendarDays}
            title="Appointment Workspace"
            description="Approve, reject, cancel, and assign bookings."
          />
          <QuickLink
            to="/portal/pet-records"
            icon={PawPrint}
            title="Pet Records"
            description="Review and manage customer pet histories."
          />
          {role === "admin" ? (
            <QuickLink
              to="/portal/manage-users"
              icon={Users}
              title="Manage Users"
              description="Create, update, and remove protected staff accounts."
            />
          ) : (
            <QuickLink
              to="/portal/appointments"
              icon={ShieldCheck}
              title="Protected Portal"
              description="Open the secure operations portal with your verified session."
            />
          )}
        </section>
      </div>
    </div>
  );
}

export function AdminDashboard() {
  return <DashboardShell role="admin" />;
}

export function StaffDashboard() {
  return <DashboardShell role="staff" />;
}
