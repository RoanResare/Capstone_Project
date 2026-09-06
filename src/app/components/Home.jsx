import { motion } from "motion/react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Bot,
  CalendarDays,
  Clock3,
  LogIn,
  Mail,
  MapPin,
  Phone,
} from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { resolveHomePath } from "../utils/roleUtils.js";

const featureCards = [
  {
    title: "Customer Dashboard",
    description:
      "Customers can review services, book appointments, manage profile details, and track appointment history after sign-in.",
    actionLabel: "Open dashboard",
    kind: "dashboard",
    icon: CalendarDays,
  },
  {
    title: "Login",
    description:
      "Customer, staff, and admin users can sign in through one secure entry. The system sends each account to its correct dashboard.",
    actionLabel: "Customer / Staff / Admin",
    to: "/login",
    kind: "route",
    icon: LogIn,
  },
];

const clinicPolicies = [
  "Arrive at least 10 minutes before your schedule.",
  "Bring prior medical notes or vaccination cards when available.",
  "Choose an open slot online before visiting the branch.",
  "Repeated no-shows may lead to account suspension.",
];

const branchDetails = [
  {
    label: "Address",
    value: "123 Alabang-Zapote Road, Las Pinas City, Metro Manila, Philippines 1740",
    icon: MapPin,
  },
  {
    label: "Phone",
    value: "+63 912 345 6789",
    icon: Phone,
  },
  {
    label: "Email",
    value: "laspinas@charmingfurfection.com",
    icon: Mail,
  },
  {
    label: "Clinic Hours",
    value: "Consultations: Saturday and Sunday, 9:00 AM to 6:00 PM. Grooming: Daily, 9:00 AM to 7:00 PM.",
    icon: Clock3,
  },
];

function scrollToSection(sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) {
    return;
  }

  section.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function Home() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const currentCustomer = currentUser?.role === "customer" ? currentUser : null;
  const dashboardPath = currentUser ? resolveHomePath(currentUser.role) : "/login";
  const customerBookingPath = currentCustomer ? "/customer/dashboard?tab=booking" : "/login";
  const customerServicesPath = currentCustomer ? "/customer/dashboard?tab=services" : "/login";

  const openCustomerBooking = () => {
    navigate(customerBookingPath, {
      state: currentCustomer ? undefined : { from: "/customer/dashboard?tab=booking" },
    });
  };

  const openCustomerServices = () => {
    navigate(customerServicesPath, {
      state: currentCustomer ? undefined : { from: "/customer/dashboard?tab=services" },
    });
  };

  return (
    <div className="bg-[#F6F0E7] pb-6">
      <section id="home" className="scroll-mt-28 relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-[300px] bg-[#2D9B9B]" />
        <div className="relative mx-auto max-w-[1180px] px-4 pb-5 pt-5 sm:px-6 md:pt-6">
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="grid gap-4 lg:grid-cols-[1.04fr_0.96fr]"
          >
            <div className="flex min-h-[460px] flex-col rounded-lg border border-[#205A60] bg-[#173E44] p-5 text-white shadow-[0_20px_46px_rgba(14,39,43,0.2)] md:min-h-[520px] md:p-7">
              <div>
                <p className="inline-flex rounded-full border border-[#F4C16A]/50 bg-[#245B62] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#FFF4D8]">
                  Charming Fur-fection Pet Care Services
                </p>
                <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight text-white md:text-5xl">
                  Pet care services and account access in one calm place.
                </h1>
              </div>

              <div className="mt-auto pt-8">
                <p className="max-w-2xl text-sm leading-6 text-[#E9F7F7] md:text-base">
                  Review branch information, ask the AI assistant, and continue to your customer
                  account when you are ready to browse services or book a visit.
                </p>

                <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={openCustomerBooking}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#F4C16A] px-5 py-3 text-sm font-semibold text-[#173E44] transition hover:bg-[#F8CD82]"
                  >
                    Start booking
                    <ArrowRight size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={openCustomerServices}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#B8DADA] bg-[#245B62] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#2D6B73]"
                  >
                    View services
                  </button>
                  <Link
                    to={dashboardPath}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#B8DADA] bg-transparent px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#245B62]"
                  >
                    Open dashboard
                  </Link>
                </div>
              </div>
            </div>

            <motion.div
              initial={{ opacity: 0, x: 26 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.65, delay: 0.12 }}
              className="grid gap-3 self-start"
            >
              {featureCards.map((card) => {
                const Icon = card.icon;
                const sharedClasses =
                  "group rounded-lg bg-[#FFFDFC] p-4 text-left shadow-[0_14px_28px_rgba(94,81,60,0.12)] transition hover:-translate-y-1 md:p-5";

                const content = (
                  <>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#EAF6F6] text-[#2D6B73]">
                        <Icon size={24} />
                      </div>
                      <span className="rounded-lg bg-[#F6F0E7] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B6254]">
                        Flow-ready
                      </span>
                    </div>
                    <h2 className="mt-3 text-xl font-semibold text-[#20343B]">{card.title}</h2>
                    <p className="mt-2 text-sm leading-5 text-[#5C7074]">{card.description}</p>
                    <div className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[#2D6B73]">
                      {card.actionLabel}
                      <ArrowRight size={16} className="transition group-hover:translate-x-1" />
                    </div>
                  </>
                );

                if (card.kind === "dashboard") {
                  return (
                    <button
                      key={card.title}
                      type="button"
                      onClick={() => navigate(dashboardPath)}
                      className={sharedClasses}
                    >
                      {content}
                    </button>
                  );
                }

                return (
                  <Link key={card.title} to={card.to} className={sharedClasses}>
                    {content}
                  </Link>
                );
              })}
              <div className="rounded-lg bg-[#173E44] p-4 text-white shadow-[0_18px_34px_rgba(20,43,46,0.16)]">
                <div className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white/78">
                  <Bot size={14} />
                  AI guidance
                </div>
                <h3 className="mt-3 text-lg font-semibold">
                  Ask questions before you commit to a booking.
                </h3>
                <p className="mt-2 text-sm leading-5 text-white/74">
                  Ask Llama AI stays available on the home page and customer account pages so
                  customers can get quick answers without losing their place.
                </p>
              </div>
            </motion.div>
          </motion.div>

          <motion.section
            id="visit-info"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.1 }}
            className="mt-5 rounded-lg bg-white p-4 shadow-[0_16px_34px_rgba(94,81,60,0.12)] md:p-5"
          >
            <div className="grid gap-5 lg:grid-cols-[0.78fr_1.22fr]">
              <div className="rounded-lg bg-[#F9F5EE] p-4">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#7B9A9F]">
                  Branch details
                </p>
                <div className="mt-3 space-y-2.5">
                  {branchDetails.map((detail) => {
                    const Icon = detail.icon;

                    return (
                      <div key={detail.label} className="flex gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-[#2D6B73] shadow-[0_8px_16px_rgba(94,81,60,0.08)]">
                          <Icon size={18} />
                        </div>
                        <div>
                          <p className="font-semibold text-[#20343B]">{detail.label}</p>
                          <p className="mt-1 text-sm leading-5 text-[#607277]">{detail.value}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#7B9A9F]">
                  Visit policies
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-[#20343B]">
                  Plan your visit, then complete service selection inside your account.
                </h2>
                <p className="mt-3 text-sm leading-6 text-[#607277]">
                  Booking now happens in the customer dashboard so pet details, profile information,
                  appointment history, and clinic updates stay connected to one authenticated account.
                </p>
              </div>
            </div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#7B9A9F]">
              Reminders
            </p>
            <div className="mt-2 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
              {clinicPolicies.map((policy) => (
                <div
                  key={policy}
                  className="rounded-lg border border-[#E2ECEB] bg-[#FBFDFC] px-3.5 py-3 text-sm leading-5 text-[#607277] shadow-[0_8px_18px_rgba(94,81,60,0.06)]"
                >
                  {policy}
                </div>
              ))}
            </div>
          </motion.section>
        </div>
      </section>
    </div>
  );
}
