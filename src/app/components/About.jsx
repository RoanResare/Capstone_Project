import { motion } from "motion/react";

const values = [
  {
    icon: "\uD83D\uDC9A",
    title: "Compassion",
    description: "We treat every pet with love and care",
  },
  {
    icon: "\u2728",
    title: "Quality",
    description: "Professional service at affordable prices",
  },
  {
    icon: "\uD83C\uDFE5",
    title: "Expertise",
    description: "Experienced veterinarians and staff",
  },
  {
    icon: "\uD83E\uDD1D",
    title: "Trust",
    description: "Building lasting relationships with pet owners",
  },
];

export function About() {
  return (
    <div className="min-h-[calc(100vh-5rem)] py-16 px-6">
      <div className="max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <h1 className="text-5xl font-bold text-[#2D9B9B] mb-8 text-center">
            About Charming Fur-fection
          </h1>

          <div className="bg-white rounded-3xl shadow-xl p-10 space-y-6">
            <p className="text-lg text-gray-700 leading-relaxed">
              Welcome to{" "}
              <span className="font-semibold text-[#2D9B9B]">
                Charming Fur-fection Pet Care Services
              </span>
              , your trusted partner in providing quality care for your beloved pets. We are
              dedicated to offering affordable and comprehensive veterinary services, grooming,
              and pet care solutions.
            </p>

            <p className="text-lg text-gray-700 leading-relaxed">
              Our mission is to ensure that every pet receives the love, care, and medical
              attention they deserve. With our experienced team of veterinarians and pet care
              specialists, we provide a wide range of services including vaccinations, deworming,
              consultations, laboratory testing, and low-cost neutering services.
            </p>

            <p className="text-lg text-gray-700 leading-relaxed">
              At Charming Fur-fection, we believe that quality pet care should be accessible to
              everyone. That is why we strive to offer competitive pricing without compromising on
              the quality of our services.
            </p>

            <div className="pt-6">
              <h2 className="text-2xl font-bold text-[#2D9B9B] mb-4">Our Values</h2>
              <ul className="space-y-3 text-gray-700 text-lg">
                {values.map((value) => (
                  <li key={value.title} className="flex items-start gap-3">
                    <span className="text-[#2D9B9B] text-2xl">{value.icon}</span>
                    <span>
                      <strong>{value.title}:</strong> {value.description}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
