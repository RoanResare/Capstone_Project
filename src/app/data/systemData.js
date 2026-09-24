export const serviceCatalog = [
  {
    id: "vaccination",
    name: "Vaccination",
    duration: "30 minutes",
    priceLabel: "PHP 850",
    category: "Preventive Care",
    description: "Core and optional vaccines for puppies, kittens, and adult pets.",
  },
  {
    id: "deworming",
    name: "Deworming",
    duration: "20 minutes",
    priceLabel: "PHP 650",
    category: "Preventive Care",
    description: "Routine parasite control for dogs and cats with weight-based guidance.",
  },
  {
    id: "consultation",
    name: "Consultation",
    duration: "45 minutes",
    priceLabel: "PHP 700",
    category: "Clinic Visit",
    description: "General veterinary assessment for symptoms, follow-ups, and wellness checks.",
  },
  {
    id: "laboratory-testing",
    name: "Laboratory Testing",
    duration: "60 minutes",
    priceLabel: "PHP 1,250",
    category: "Diagnostics",
    description: "Diagnostic support for blood work, screening, and follow-up test requests.",
  },
  {
    id: "low-cost-kapon",
    name: "Low Cost Kapon",
    duration: "90 minutes",
    priceLabel: "PHP 1,800",
    category: "Surgery",
    description: "Affordable spay and neuter scheduling with recovery instructions.",
  },
  {
    id: "pet-grooming",
    name: "Pet Grooming",
    duration: "60 minutes",
    priceLabel: "PHP 950",
    category: "Grooming",
    description: "Bath, trim, nail care, and coat maintenance for small to medium pets.",
  },
];

export const branchDetails = {
  name: "Charming Fur-fection Pet Care Services - Las Piñas City",
  address: "Saint Joseph Avenue corner Guinto Street, Pulang Lupa Dos, Las Piñas, Philippines, 1740",
  phone: "+63 0950 251 1754",
  phoneHref: "tel:+639502511754",
  email: "charmingfurfectionpetcare@gmail.com",
  hours: "Consultations: Saturday and Sunday, 9:00 AM to 6:00 PM. Grooming: Daily, 9:00 AM to 7:00 PM.",
};

export const petTypeOptions = ["Dog", "Cat", "Other"];

export const dogBreedOptions = [
  "Aspin (Asong Pinoy)",
  "Shih Tzu",
  "Siberian Husky",
  "Chihuahua",
  "Labrador Retriever",
  "Beagle",
  "Golden Retriever",
  "Poodle",
  "Dachshund",
  "Rottweiler",
  "Other",
];

export const catBreedOptions = [
  "Puspin (Philippine Shorthair)",
  "Siamese",
  "Persian",
  "Maine Coon",
  "British Shorthair",
  "Bengal",
  "Abyssinian",
  "Egyptian Mau",
  "Toyger",
  "Other",
];

export const breedsByPetType = {
  Dog: dogBreedOptions,
  Cat: catBreedOptions,
  Other: ["Other"],
};

export const portalModules = [
  { id: "appointments", label: "Manage Appointments" },
  { id: "pet-records", label: "Manage Pet Records" },
  { id: "manage-users", label: "Manage Users", adminOnly: true },
];

export const portalUserRoles = [
  { value: "admin", label: "Admin" },
  { value: "staff", label: "Staff" },
];

export const portalUserStatuses = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "suspended", label: "Suspended" },
];

export const appointmentStatusOptions = [
  "Pending",
  "Confirmed",
  "Rejected",
  "Completed",
  "Cancelled",
];

export const appointmentFilters = [
  "All",
  "Pending",
  "Confirmed",
  "Rejected",
  "Completed",
  "Cancelled",
];

export const chatbotSuggestionChips = [
  "What services do you offer?",
  "How much is consultation?",
  "How do I book an appointment?",
  "What are the clinic hours?",
];

export function formatMoneyLabel(value) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(value);
}

function padDatePart(value) {
  return String(value).padStart(2, "0");
}

function toLocalDateKey(date) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function startOfLocalDay(value = new Date()) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addDays(date, days) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

export function buildSeedAvailabilitySlots(options = {}) {
  const startDate = startOfLocalDay(options.startDate instanceof Date ? options.startDate : new Date());
  const throughDate =
    options.throughDate instanceof Date
      ? startOfLocalDay(options.throughDate)
      : addDays(startDate, Math.max(Number(options.days) || 90, 1) - 1);
  const slotTemplates = [
    { time: "09:00", capacity: 3 },
    { time: "11:00", capacity: 3 },
    { time: "14:00", capacity: 2 },
    { time: "16:00", capacity: 2 },
  ];
  const slots = [];

  for (
    let cursor = addDays(startDate, 1);
    cursor <= throughDate;
    cursor = addDays(cursor, 1)
  ) {
    const dateLabel = toLocalDateKey(cursor);

    slots.push(...slotTemplates.map((template, slotIndex) => ({
      id: `slot-${dateLabel}-${slotIndex + 1}`,
      date: dateLabel,
      time: template.time,
      capacity: template.capacity,
      isOpen: true,
    })));
  }

  return slots;
}
