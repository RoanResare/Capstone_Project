import { motion } from "motion/react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Clock3,
  Mail,
  MapPin,
  Phone,
} from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { branchDetails as businessBranchDetails } from "../data/systemData.js";
import heroImage from "../../assets/login-pets-hero.png";

const clinicPolicies = [
  "Arrive at least 10 minutes before your schedule.",
  "Bring prior medical notes or vaccination cards when available.",
  "Choose an open slot online before visiting the branch.",
  "Repeated no-shows may lead to account suspension.",
];

const branchDetailsList = [
  {
    label: "Branch Name",
    value: businessBranchDetails.name,
    icon: MapPin,
  },
  {
    label: "Address",
    value: businessBranchDetails.address,
    icon: MapPin,
  },
  {
    label: "Phone",
    value: businessBranchDetails.phone,
    icon: Phone,
  },
  {
    label: "Email",
    value: businessBranchDetails.email,
    icon: Mail,
  },
  {
    label: "Clinic Hours",
    value: businessBranchDetails.hours,
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
  const customerBookingPath = currentCustomer ? "/customer/dashboard?tab=services" : "/login";

  const openCustomerBooking = () => {
    navigate(customerBookingPath, {
      state: currentCustomer ? undefined : { from: "/customer/dashboard?tab=services" },
    });
  };

  return (
    <div className="bg-[#F6F0E7] pb-6">
      <section id="home" className="scroll-mt-28 relative overflow-hidden">
        <img aria-hidden="true" src={heroImage} alt="" className="pointer-events-none absolute inset-0 z-0 h-full w-full object-cover object-center opacity-[0.34]" />
        <div className="relative z-[2] mx-auto max-w-[1180px] px-3 pb-5 pt-5 sm:px-4 md:pt-6">
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="grid items-stretch gap-4 lg:grid-cols-[1.2fr_0.9fr]"
          >
            <div className="flex min-h-[280px] flex-col justify-between rounded-lg border border-[#205A60] bg-[#173E44]/92 p-5 text-white shadow-[0_20px_46px_rgba(14,39,43,0.2)] md:min-h-[320px] md:p-5">
              <div>
                <p className="inline-flex rounded-full border border-[#F4C16A]/50 bg-[#245B62] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#FFF4D8]">
                  {businessBranchDetails.name}
                </p>
                <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight text-white md:text-5xl">
                  Pet care services and account access in one calm place.
                </h1>
              </div>

              <div className="pt-8">
                <p className="max-w-2xl text-sm leading-5 text-[#E9F7F7] md:text-base">
                  Review the essentials, then sign in to book a visit or manage your pet care
                  details from your customer account.
                </p>

                <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={openCustomerBooking}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#F4C16A] px-5 py-2.5 text-sm font-semibold text-[#173E44] transition hover:bg-[#F8CD82]"
                  >
                    Start booking
                    <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            </div>

            <motion.div
              initial={{ opacity: 0, x: 26 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.65, delay: 0.12 }}
              className="flex h-full min-h-[320px] flex-col rounded-lg bg-[#FFFDFC]/92 p-5 shadow-[0_14px_28px_rgba(94,81,60,0.12)] backdrop-blur-[2px] md:min-h-[350px] md:p-5"
            >
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#7B9A9F]">
                Branch details
              </p>
              <div className="mt-4 space-y-3">
                {branchDetailsList.map((detail) => {
                  const Icon = detail.icon;

                  return (
                    <div key={detail.label} className="flex gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-[#2D6B73] shadow-[0_8px_16px_rgba(94,81,60,0.08)]">
                        <Icon size={18} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-[#20343B]">{detail.label}</p>
                        <p className="mt-1 text-sm leading-5 text-[#607277]">{detail.value}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </motion.div>

          <motion.section
            id="visit-info"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.1 }}
            className="relative isolate mt-5 rounded-lg bg-white/88 p-4 shadow-[0_16px_34px_rgba(94,81,60,0.12)] backdrop-blur-[3px] md:p-5"
          >
            <div className="relative z-10">
              <div className="flex min-w-0 flex-col">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#7B9A9F]">
                  Visit policies
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-[#20343B]">
                  Plan your visit, then complete service selection inside your account.
                </h2>
                <p className="mt-3 text-sm leading-5 text-[#607277]">
                  Booking now happens in the customer dashboard so pet details, profile information,
                  appointment history, and clinic updates stay connected to one authenticated account.
                </p>

                <div className="mt-5">
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#7B9A9F]">
                    Reminders
                  </p>
                  <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                    {clinicPolicies.map((policy) => (
                      <div
                        key={policy}
                        className="rounded-lg border border-[#E2ECEB] bg-[#FBFDFC] px-3.5 py-2.5 text-sm leading-5 text-[#607277] shadow-[0_8px_18px_rgba(94,81,60,0.06)]"
                      >
                        {policy}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </motion.section>
        </div>
      </section>
    </div>
  );
}
