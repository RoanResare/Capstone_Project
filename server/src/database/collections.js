// Runtime business collections mapped to PostgreSQL tables.
const COLLECTION_TABLES = Object.freeze({
  users: "users", usernames: "usernames", appointments: "appointments", pets: "pets",
  deletedPets: "deleted_pets", availabilitySlots: "availability_slots",
  notifications: "notifications", photoModeration: "photo_moderation",
  lowCostKaponPromo: "low_cost_kapon_promo", promotionDetails: "promotion_details",
  servicePricelists: "service_pricelists", sessionSecurity: "session_security",
  sessionConnections: "session_connections", authenticationAttempts: "authentication_attempts",
  phoneAccountLimits: "phone_account_limits", admin_staff_otp: "admin_staff_otp",
  appointmentReminders: "appointment_reminders",
  customers: "customers", chatbot_faqs: "chatbot_faqs", services: "services",
  timeSlots: "time_slots", slotManagement: "slot_management_camel", schedules: "schedules",
  slot_management: "slot_management", revoked_tokens: "revoked_tokens",
  products: "products", orders: "orders",
});
const RELATIONAL_COLLECTIONS = new Set(["users", "pets", "services", "appointments", "products", "orders"]);
function tableFor(collection) {
  const table = COLLECTION_TABLES[collection];
  if (!Object.hasOwn(COLLECTION_TABLES, collection)) throw new Error("Unsupported database collection.");
  return `app_private.${table}${RELATIONAL_COLLECTIONS.has(collection) ? "_relational" : ""}`;
}
module.exports = { COLLECTION_TABLES, RELATIONAL_COLLECTIONS, tableFor };
