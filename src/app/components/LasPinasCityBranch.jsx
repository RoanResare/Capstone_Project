import { motion } from "motion/react";
import { Clock3, Mail, MapPin, Phone } from "lucide-react";
import { Link } from "react-router-dom";
import { ChatbotWidget } from "./ChatbotWidget.jsx";
import { branchDetails, serviceCatalog } from "../data/systemData.js";

const clinicPolicies = [
  "Arrive at least 10 minutes before your slot.",
  "Bring previous medical notes or vaccination cards when available.",
  "Use the appointment page to choose an open date and time slot.",
  "Repeated no-shows may lead to customer account suspension.",
];

export function LasPinasCityBranch() {
  return (
    <div className="min-h-[calc(100vh-5rem)] bg-[#F6F0E7] px-6 py-14">
      <div className="mx-auto max-w-[1260px] space-y-8">
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
          className="overflow-hidden rounded-[36px] bg-[linear-gradient(135deg,#173E44_0%,#2D6B73_55%,#82C8C0_100%)] p-8 text-white shadow-[0_26px_56px_rgba(20,43,46,0.2)] md:p-10"
        >
          <p className="inline-flex rounded-full border border-white/12 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/78">
            View Services
          </p>
          <h1 className="mt-5 text-4xl font-semibold tracking-[-0.04em] md:text-[4.2rem]">
            Las Pinas City branch services and booking information.
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-white/78 md:text-lg">
            This page now works as the service discovery step in your diagram. Customers can
            review services, clinic hours, branch policies, and ask the AI chatbot before moving
            into appointment booking.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              to="/appointment"
              className="inline-flex items-center justify-center rounded-full bg-[#F4C16A] px-6 py-3 text-sm font-semibold text-[#173E44] transition hover:bg-[#F8CC81]"
            >
              Proceed to booking
            </Link>
            <a
              href={branchDetails.phoneHref}
              className="inline-flex items-center justify-center rounded-full border border-white/16 bg-white/10 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/14"
            >
              Call the branch
            </a>
          </div>
        </motion.section>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <motion.section
            initial={{ opacity: 0, x: -18 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.08 }}
            className="rounded-[34px] bg-white p-7 shadow-[0_18px_40px_rgba(94,81,60,0.12)] md:p-8"
          >
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#7C999E]">
              Services offered
            </p>
            <h2 className="mt-2 text-3xl font-semibold text-[#20343B]">
              Appointment-ready service menu
            </h2>

            <div className="mt-6 space-y-4">
              {serviceCatalog.map((service) => (
                <div
                  key={service.id}
                  className="rounded-[28px] border border-[#E6EFEE] bg-[#FBFDFC] p-5"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7C999E]">
                        {service.category}
                      </p>
                      <h3 className="mt-2 text-2xl font-semibold text-[#20343B]">
                        {service.name}
                      </h3>
                      <p className="mt-3 text-sm leading-6 text-[#607277]">
                        {service.description}
                      </p>
                    </div>
                    <div className="min-w-[9rem] shrink-0 rounded-[22px] bg-[#F7F3EA] px-5 py-3 text-center">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#826D4D]">
                        Sample rate
                      </p>
                      <p className="mt-2 whitespace-nowrap text-lg font-semibold text-[#4D4438]">
                        {service.priceLabel}
                      </p>
                      <p className="mt-1 text-sm text-[#6D6559]">{service.duration}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.12 }}
            className="space-y-6"
          >
            <div className="rounded-[34px] bg-white p-7 shadow-[0_18px_40px_rgba(94,81,60,0.12)] md:p-8">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#7C999E]">
                Branch details
              </p>
              <h2 className="mt-2 text-3xl font-semibold text-[#20343B]">
                Contact and operating hours
              </h2>

              <div className="mt-6 space-y-5">
                <div className="flex gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-[18px] bg-[#EAF6F6] text-[#2D6B73]">
                    <MapPin size={20} />
                  </div>
                  <div>
                    <p className="font-semibold text-[#20343B]">Address</p>
                    <p className="mt-1 text-sm leading-6 text-[#607277]">
                      {branchDetails.address}
                    </p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-[18px] bg-[#EAF6F6] text-[#2D6B73]">
                    <Phone size={20} />
                  </div>
                  <div>
                    <p className="font-semibold text-[#20343B]">Phone</p>
                    <p className="mt-1 text-sm text-[#607277]">{branchDetails.phone}</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-[18px] bg-[#EAF6F6] text-[#2D6B73]">
                    <Mail size={20} />
                  </div>
                  <div>
                    <p className="font-semibold text-[#20343B]">Email</p>
                    <p className="mt-1 text-sm text-[#607277]">
                      {branchDetails.email}
                    </p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-[18px] bg-[#EAF6F6] text-[#2D6B73]">
                    <Clock3 size={20} />
                  </div>
                  <div>
                    <p className="font-semibold text-[#20343B]">Clinic hours</p>
                    <p className="mt-1 text-sm text-[#607277]">
                      Consultations: Saturday and Sunday, 9:00 AM to 6:00 PM
                    </p>
                    <p className="mt-1 text-sm text-[#607277]">
                      Grooming: Daily, 9:00 AM to 7:00 PM
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[34px] bg-[#173E44] p-7 text-white shadow-[0_22px_44px_rgba(20,43,46,0.18)] md:p-8">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white/64">
                Policies
              </p>
              <h2 className="mt-2 text-3xl font-semibold">
                Before your visit
              </h2>
              <ul className="mt-5 space-y-3 text-sm leading-7 text-white/78">
                {clinicPolicies.map((policy) => (
                  <li
                    key={policy}
                    className="rounded-[20px] border border-white/10 bg-white/6 px-4 py-3"
                  >
                    {policy}
                  </li>
                ))}
              </ul>
            </div>
          </motion.section>
        </div>

        <ChatbotWidget surface="services" />
      </div>
    </div>
  );
}
