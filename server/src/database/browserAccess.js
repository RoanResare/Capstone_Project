const { ApiError } = require("../utils/ApiError");
const { ownsRecord } = require("../services/scheduleRecords.service");
const PUBLIC_READ = new Set(["usernames", "services", "chatbot_faqs"]);
const SHARED_READ = new Set(["availabilitySlots", "timeSlots", "slotManagement", "schedules", "slot_management", "lowCostKaponPromo"]);
const SELF_FIELDS = new Set(["uid", "id", "email", "username", "fullName", "name", "phone", "updatedAt", "createdAt", "role", "status", "accountStatus", "fraudStatus", "registrationIp", "photoURL", "profilePhotoPath", "profilePhotoModerationId", "profilePhotoUploadCount"]);
function deny() { throw new ApiError(403, "Database access denied."); }
function assertRead(collection, id, record, identity) {
  if (PUBLIC_READ.has(collection)) return;
  const user = identity.user;
  if (!identity.uid) deny();
  if (collection === "users" && id === identity.uid) return;
  if (!user) deny();
  const manager = ["admin", "staff"].includes(user.role);
  if (SHARED_READ.has(collection)) return;
  if (collection === "users" && user.role === "admin") return;
  if (["appointments", "pets"].includes(collection) && (manager || (record && ownsRecord(record, user)))) return;
  if (collection === "notifications" && (manager || record?.targetUserId === identity.uid)) return;
  if (collection === "photoModeration" && user.role === "admin") return;
  if (collection === "customers" && (manager || id === identity.uid)) return;
  deny();
}
function assertWrite(collection, id, before, after, identity, operation) {
  if (!identity.uid) deny();
  if (collection === "users" && id === identity.uid && operation !== "delete") {
    // Account creation is performed by the validated registration API. Browser
    // updates cannot change permissions, restrictions or password credentials.
    if (!before) deny();
    const changed = Object.keys({ ...before, ...after }).filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
    if (changed.some(key => !SELF_FIELDS.has(key))) deny();
    for (const field of ["id", "createdAt"]) {
      if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) deny();
    }
    if (after.uid !== undefined && after.uid !== identity.uid) deny();
    const role = value => ["admin", "staff", "customer"].includes(String(value || "").toLowerCase()) ? String(value).toLowerCase() : "customer";
    if (role(before.role) !== role(after.role)) deny();
    const status = value => ["inactive", "archived"].includes(String(value || "").toLowerCase()) ? "inactive" : String(value || "").toLowerCase() === "suspended" ? "suspended" : "active";
    const previousStatus = status(before.accountStatus || before.status);
    if (status(after.accountStatus || after.status) !== previousStatus || (after.status !== undefined && status(after.status) !== previousStatus)) deny();
    if ((before.fraudStatus || "normal").toLowerCase() !== (after.fraudStatus || "normal").toLowerCase()) deny();
    if ((before.registrationIp || "") !== (after.registrationIp || "")) deny();
    if (after.username && !/^[a-z0-9._-]{3,24}$/.test(after.username)) deny();
    if (after.email && after.email.toLowerCase() !== String(identity.claims.email || "").toLowerCase()) deny();
    return;
  }
  if (collection === "usernames" && operation !== "delete") {
    if (!/^[a-z0-9._-]{3,24}$/.test(id)) deny();
    if (after?.uid !== identity.uid || (before?.uid && before.uid !== identity.uid)) deny();
    if (after.email && after.email.toLowerCase() !== String(identity.claims.email || "").toLowerCase()) deny();
    return;
  }
  if (collection === "notifications") {
    assertRead(collection, id, before || after, identity);
    if (["admin", "staff"].includes(identity.user?.role)) return;
    // Customers can acknowledge their notifications, not forge notifications.
    const changed = Object.keys({ ...before, ...after }).filter(key => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]));
    if (!before || operation === "delete" || changed.some(key => key !== "readBy")) deny();
    const oldReaders = before.readBy || [], newReaders = after.readBy || [];
    if (!Array.isArray(newReaders) || oldReaders.some(uid => !newReaders.includes(uid)) || newReaders.some(uid => uid !== identity.uid && !oldReaders.includes(uid))) deny();
    return;
  }
  // Scheduling, pets, promotion revisions and employee changes must use their
  // existing validated business endpoints, never a generic document write.
  if (collection === "photoModeration" && identity.user?.role === "admin") return;
  deny();
}
module.exports = { assertRead, assertWrite, PUBLIC_READ };
