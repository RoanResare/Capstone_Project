import { motion } from "motion/react";
import { branchDetails } from "../data/systemData.js";

export function About() {
  return (
    <div className="min-h-[calc(100vh-5rem)] px-4 py-8 sm:px-6 sm:py-12">
      <div className="max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <h1 className="mb-6 text-center text-3xl font-bold text-[#2D9B9B] sm:text-4xl md:text-5xl">
            About Charming Fur-fection Pet Care Services
          </h1>

          <div className="space-y-5 rounded-3xl border border-[#E6EFEE] bg-white p-5 shadow-[0_16px_36px_rgba(54,67,62,0.1)] sm:p-8">
            <p className="text-lg text-gray-700 leading-relaxed">
              This is the official website of Charming Fur-fection Pet Care Services in Las Piñas City. Customers can explore pet care services, manage pet profiles, and book appointments through this website.
            </p>

            <p className="text-lg text-gray-700 leading-relaxed">
              The website was developed for the business and is used by the client for its operations. It provides information about services and related clinic details, along with customer accounts, pet profiles, and appointment booking.
            </p>

            <p className="text-lg text-gray-700 leading-relaxed">
              Find the business at{" "}
              <span className="font-semibold text-[#2D9B9B]">
                {branchDetails.name}
              </span>{" "}
              in Las Piñas City, Philippines. Contact details and current operating information are listed on the home page.
            </p>

          </div>
        </motion.div>
      </div>
    </div>
  );
}
