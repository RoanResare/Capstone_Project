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

export const chatbotKnowledgeBase = [
  {
    id: "services",
    keywords: [
      "service",
      "services",
      "offer",
      "available",
      "clinic",
      "grooming",
      "serbisyo",
      "ano meron",
    ],
    answerEn:
      "We offer vaccination, deworming, consultation, laboratory testing, low cost kapon, and pet grooming.",
    answerTl:
      "Nag-aalok kami ng vaccination, deworming, consultation, laboratory testing, low cost kapon, at pet grooming.",
  },
  {
    id: "pricing",
    keywords: [
      "price",
      "pricing",
      "cost",
      "rates",
      "fee",
      "magkano",
      "bayad",
      "presyo",
    ],
    answerEn:
      "Current sample rates start at PHP 650 for deworming, PHP 700 for consultation, PHP 850 for vaccination, PHP 950 for grooming, PHP 1,250 for laboratory testing, and PHP 1,800 for low cost kapon.",
    answerTl:
      "Ang sample rates namin ay nagsisimula sa PHP 650 para sa deworming, PHP 700 sa consultation, PHP 850 sa vaccination, PHP 950 sa grooming, PHP 1,250 sa laboratory testing, at PHP 1,800 sa low cost kapon.",
  },
  {
    id: "appointments",
    keywords: [
      "appointment",
      "book",
      "schedule",
      "slot",
      "date",
      "time",
      "reschedule",
      "cancel",
      "appointment",
      "schedule",
      "oras",
      "petsa",
    ],
    answerEn:
      "You can book an appointment by choosing a service, selecting an available date and time, and entering your pet information on the appointment page.",
    answerTl:
      "Maaari kang mag-book ng appointment sa pamamagitan ng pagpili ng service, available na petsa at oras, at paglagay ng pet information sa appointment page.",
  },
  {
    id: "hours",
    keywords: [
      "hours",
      "open",
      "opening",
      "closing",
      "time",
      "schedule",
      "operating",
      "bukas",
      "oras",
    ],
    answerEn:
      "Clinic consultations run on weekends from 9:00 AM to 6:00 PM, while grooming services are available daily from 9:00 AM to 7:00 PM.",
    answerTl:
      "Ang clinic consultations ay tuwing weekend mula 9:00 AM hanggang 6:00 PM, habang ang grooming services ay available araw-araw mula 9:00 AM hanggang 7:00 PM.",
  },
  {
    id: "policies",
    keywords: [
      "policy",
      "policies",
      "late",
      "no-show",
      "rules",
      "requirements",
      "patakaran",
    ],
    answerEn:
      "Please arrive at least 10 minutes early, bring any previous medical notes when available, and cancel ahead of time if you cannot attend. Repeated no-shows may lead to account suspension.",
    answerTl:
      "Mangyaring dumating nang hindi bababa sa 10 minuto nang maaga, dalhin ang previous medical notes kung meron, at magkansela agad kung hindi makakadalo. Ang paulit-ulit na no-show ay maaaring magresulta sa account suspension.",
  },
];

export const chatbotSuggestionChips = [
  "What services do you offer?",
  "Magkano ang consultation?",
  "How do I book an appointment?",
  "Ano ang clinic hours?",
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
