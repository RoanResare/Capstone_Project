const { db } = require("../config/postgresDatabase");
const { ApiError } = require("../utils/ApiError");

const ACTIVE_APPOINTMENT_STATUSES = ["Pending", "Confirmed", "Accepted", "Approved"];
const MAX_APPOINTMENT_LOOKUP_LIMIT = 200;
const AUDITED_APPOINTMENT_FIELDS = [
  "scheduleDate", "scheduleTime", "schedule", "slotId", "assignedStaff", "petName",
  "service", "serviceId", "serviceIds", "petRecordId", "notes", "clinicalSelections",
  "grooming", "deworming", "vaccinationFee", "estimatedDurationMinutes", "blockDurationMinutes",
];

function normalizeAppointmentStatus(status = "") {
  const normalized = String(status).trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (["accepted", "confirmed", "approved"].includes(normalized)) return "Approved";
  if (["no show", "expired"].includes(normalized)) return "No Show";
  if (normalized === "canceled") return "Cancelled";
  return normalized ? normalized[0].toUpperCase() + normalized.slice(1) : "Pending";
}

function appointmentActorFullName(actor = {}) {
  return [actor.fullName, actor.full_name, actor.name]
    .find((value) => typeof value === "string" && value.trim())?.trim() || "Unknown account";
}

function buildAppointmentAuditEvent({ isNew, previous, appointment, actor, createdAt }) {
  if (isNew) {
    return {
      status: normalizeAppointmentStatus(appointment.status), action: "Appointment created", changedFields: [],
      actorId: actor.uid, actorName: appointmentActorFullName(actor), actorRole: actor.role, createdAt,
    };
  }

  const changedFields = [];
  if (normalizeAppointmentStatus(previous.status) !== normalizeAppointmentStatus(appointment.status)) {
    changedFields.push("status");
  }
  for (const field of AUDITED_APPOINTMENT_FIELDS) {
    if (JSON.stringify(previous[field]) !== JSON.stringify(appointment[field])) changedFields.push(field);
  }
  if (previous.sessionStartedAt !== appointment.sessionStartedAt) changedFields.push("sessionStartedAt");
  if (previous.sessionEndedAt !== appointment.sessionEndedAt) changedFields.push("sessionEndedAt");
  if (!changedFields.length) return null;

  const status = normalizeAppointmentStatus(appointment.status);
  const scheduleChanged = changedFields.some((field) => ["scheduleDate", "scheduleTime", "schedule", "slotId"].includes(field));
  const assignmentChanged = changedFields.includes("assignedStaff");
  let action;
  if (changedFields.includes("status")) {
    action = ({
      Approved: "Appointment approved",
      Rejected: "Appointment rejected",
      Cancelled: "Appointment cancelled",
      Completed: "Appointment completed",
      "No Show": "Appointment marked No Show",
    })[status] || `Appointment status changed to ${status}`;
  } else if (scheduleChanged) {
    action = "Appointment rescheduled";
  } else if (assignmentChanged) {
    action = previous.assignedStaff ? "Staff assignment updated" : "Staff assigned";
  } else if (changedFields.includes("sessionStartedAt")) {
    action = "Appointment session started";
  } else if (changedFields.includes("sessionEndedAt")) {
    action = "Appointment session completed";
  } else {
    action = "Appointment details updated";
  }

  return {
    status,
    action,
    changedFields,
    reason: appointment.rejectionReason || appointment.cancellationReason || "",
    actorId: actor.uid,
    actorName: appointmentActorFullName(actor),
    actorRole: actor.role,
    createdAt,
  };
}

async function saveAppointment(req, res) {
  const appointment = req.body;
  const id = req.params.id;
  const user = req.auth.user;
  if (!appointment || appointment.id !== id || !id || id.includes("/")) {
    throw new ApiError(400, "A valid appointment is required.");
  }
  const reference = db.collection("appointments").doc(id);
  let savedAppointment;
  let emailNotification = null;
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(reference);
    if (appointment.petRecordId && !existing.exists) {
      const deletedPet = await transaction.get(db.collection("deletedPets").doc(appointment.petRecordId));
      if (deletedPet.exists) throw new ApiError(409, "This pet profile was deleted. Choose a saved pet before booking.");
    }
    if (user.role === "customer") {
      if (appointment.customerId !== user.uid ||
          (existing.exists && existing.data().customerId !== user.uid)) {
        throw new ApiError(403, "You can only update your own appointments.");
      }
      if (!existing.exists && ["restricted", "suspended", "banned"].includes(user.fraudStatus)) {
        throw new ApiError(403, "This account is restricted from creating new bookings.");
      }
      if (!existing.exists && appointment.status !== "Pending") {
        throw new ApiError(400, "New appointments must be pending.");
      }
    } else if (!["admin", "staff"].includes(user.role)) {
      throw new ApiError(403, "You cannot save appointments.");
    }
    const nextStatus = appointment.status || existing.data?.()?.status;
    const assignedStaff = existing.exists ? String(existing.data()?.assignedStaff || "").trim() : "";
    if (user.role === "customer" && ["Confirmed", "Accepted", "Completed", "Approved"].includes(nextStatus)) {
      throw new ApiError(403, "Customers cannot confirm or approve appointments.");
    }
    if (user.role === "customer" && existing.exists) {
      const existingStatus = existing.data().status || "Pending";
      const statusChanged = appointment.status && appointment.status !== existingStatus;
      if (statusChanged && normalizeAppointmentStatus(appointment.status) !== "Cancelled") {
        throw new ApiError(403, "Customers can only cancel existing appointments.");
      }
      if (statusChanged && normalizeAppointmentStatus(existingStatus) !== "Approved") {
        throw new ApiError(409, "Appointments can only be cancelled after they have been approved.");
      }
    }
    const { isLowCostKaponAppointment, isKaponPromoAvailable, KAPON_UNAVAILABLE_MESSAGE } =
      await import("../../../shared/lowCostKaponPromo.mjs");
    const previous = existing.data?.() || {};
    const changedText = {};
    for (const field of ["petName", "notes", "rejectionReason", "cancellationReason"]) {
      if (Object.hasOwn(appointment, field) && (!existing.exists || appointment[field] !== previous[field])) changedText[field] = appointment[field];
    }
    if (Object.keys(changedText).length) {
      const { assertAppropriateText } = require("../utils/textModeration");
      await assertAppropriateText(changedText, {
        petName: "Pet name", notes: "Appointment notes", rejectionReason: "Reason", cancellationReason: "Reason",
      });
    }
    if (["admin", "staff"].includes(user.role) && existing.exists) {
      const previousStatus = normalizeAppointmentStatus(previous.status);
      const requestedStatus = appointment.sessionAction === "end"
        ? "Completed"
        : normalizeAppointmentStatus(appointment.status || previous.status);
      const allowedTransition = previousStatus === requestedStatus ||
        (previousStatus === "Pending" && ["Approved", "Rejected"].includes(requestedStatus)) ||
        (previousStatus === "Approved" && ["Cancelled", "Completed"].includes(requestedStatus));
      if (!allowedTransition) {
        throw new ApiError(400, "This status change is not allowed for the appointment's current status.");
      }
    }
    if(!existing.exists && !Array.isArray(appointment.serviceIds))throw new ApiError(400,"Choose valid appointment services.");
    const decisionFields = {};
    const decisionChanged = JSON.stringify(appointment.decision) !== JSON.stringify(previous.decision);
    const staffDecision = ["admin","staff"].includes(user.role) && ["Rejected", "Cancelled"].includes(nextStatus) && (nextStatus !== previous.status || decisionChanged);
    const staffCancellation = ["admin","staff"].includes(user.role) && nextStatus === "Cancelled" && nextStatus !== previous.status;
    if (user.role === "customer" && (decisionChanged || appointment.rejectionReason !== previous.rejectionReason || appointment.cancellationReason !== previous.cancellationReason)) throw new ApiError(403,"Only clinic staff can set a rejection or cancellation reason.");
    if (!["Rejected", "Cancelled"].includes(nextStatus) && decisionChanged) throw new ApiError(400,"Decision reasons can only be set when rejecting or cancelling an appointment.");
    if (staffDecision) {
      const previousStatus = normalizeAppointmentStatus(previous.status);
      if (!existing.exists || (nextStatus === "Rejected" ? previousStatus !== "Pending" : previousStatus !== "Approved")) throw new ApiError(409,"Appointments can only be rejected while pending, and cancelled after approval.");
      const {validateAppointmentDecision} = await import("../../../shared/appointmentDecisions.mjs");
      try {
        const decision=validateAppointmentDecision(appointment.decision);
        const { assertAppropriateText } = require("../utils/textModeration");
        await assertAppropriateText({ reason: decision.reason }, { reason: "Reason" });
        decisionFields.decision={...decision,by:user.uid,at:new Date().toISOString()};
        decisionFields[nextStatus === "Rejected" ? "rejectionReason" : "cancellationReason"]=decision.reason;
      } catch(error) { if (error instanceof ApiError) throw error; throw new ApiError(400,error.message); }
    }
    const sessionFields = {};
    const action = appointment.sessionAction;
    if (action) {
      if (!["admin", "staff"].includes(user.role) || !existing.exists ||
          !["Accepted", "Approved", "Confirmed"].includes(previous.status)) {
        throw new ApiError(403, "Only staff can run sessions for approved appointments.");
      }
      const now = new Date();
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
      if (action === "start") {
        if (previous.scheduleDate !== today || previous.sessionStartedAt) throw new ApiError(409, "Start a session only once, on the appointment date.");
        sessionFields.sessionStartedAt = now.toISOString();
        sessionFields.sessionStartedBy = user.uid;
      } else if (action === "end") {
        if (!previous.sessionStartedAt || previous.sessionEndedAt) throw new ApiError(409, "This appointment has no active session.");
        sessionFields.sessionEndedAt = now.toISOString();
        sessionFields.sessionEndedBy = user.uid;
        sessionFields.sessionDurationSeconds = Math.max(0, Math.floor((now.getTime() - Date.parse(previous.sessionStartedAt)) / 1000));
        sessionFields.status = "Completed";
      } else throw new ApiError(400, "Invalid session action.");
    }
    for (const field of ["sessionStartedAt", "sessionEndedAt", "sessionStartedBy", "sessionEndedBy", "sessionDurationSeconds"]) {
      if (appointment[field] !== previous[field]) throw new ApiError(400, "Session timestamps are managed by the server.");
    }
    if (nextStatus === "Completed" && previous.status !== "Completed" &&
        !["Accepted", "Approved", "Confirmed"].includes(previous.status)) {
      throw new ApiError(400, "Only approved appointments can be marked completed.");
    }
    const nextAppointment = { ...previous, ...appointment, assignedStaff };
    const changedSchedule = ["slotId", "scheduleDate", "scheduleTime", "schedule"].some(
      (field) => nextAppointment[field] !== previous[field],
    );
    const wasActive = ACTIVE_APPOINTMENT_STATUSES.includes(previous.status);
    const willBeActive = ACTIVE_APPOINTMENT_STATUSES.includes(nextStatus);
    const previousServiceIds = previous.serviceIds || (previous.serviceId ? [previous.serviceId] : []);
    const nextServiceIds = nextAppointment.serviceIds || (nextAppointment.serviceId ? [nextAppointment.serviceId] : []);
    const changedServices = JSON.stringify(nextServiceIds) !== JSON.stringify(previousServiceIds) || nextAppointment.serviceId !== previous.serviceId;
    const requiresBookingValidation = !existing.exists || changedServices || changedSchedule ||
      (["Cancelled", "Rejected", "Expired", "No Show", "Completed"].includes(previous.status) && ["Pending", "Confirmed", "Accepted", "Approved"].includes(nextStatus));
    let serviceFields = {};
    const {REQUIRED_VACCINATION_FEE,dewormingForPet,dewormingDescription}=await import("../../../shared/bookingAdditions.mjs");
    serviceFields.vaccinationFee=nextAppointment.serviceIds?.includes("vaccination") || nextAppointment.serviceId==="vaccination" ? REQUIRED_VACCINATION_FEE : null;
    if(nextAppointment.serviceIds?.includes("deworming")){
      const dewormingChanged=JSON.stringify(nextAppointment.deworming)!==JSON.stringify(previous.deworming);
      if(!existing.exists || changedServices || nextAppointment.petRecordId!==previous.petRecordId || dewormingChanged){
        const pet=await transaction.get(db.collection("pets").doc(nextAppointment.petRecordId));
        if(!pet.exists)throw new ApiError(400,"Choose a saved pet for deworming.");
        if(user.role==="customer"&&pet.data().customerId!==user.uid)throw new ApiError(403,"Choose your own pet.");
        serviceFields.deworming=dewormingForPet(pet.data());
      }
    }else if(changedServices){serviceFields.deworming=null;}
    const clinicalChanged=JSON.stringify(nextAppointment.clinicalSelections)!==JSON.stringify(previous.clinicalSelections);
    if ((!existing.exists || changedServices || clinicalChanged || nextAppointment.petRecordId!==previous.petRecordId) && nextAppointment.serviceIds?.some(id=>["consultation","vaccination","laboratory-testing"].includes(id))) {
      const pet=await transaction.get(db.collection("pets").doc(nextAppointment.petRecordId));
      if(!pet.exists)throw new ApiError(400,"Choose a saved cat or dog profile.");
      if(user.role==="customer"&&pet.data().customerId!==user.uid)throw new ApiError(403,"Choose your own pet.");
      const {buildClinicalSelections}=await import("../../../shared/clinicalServices.mjs");
      try {
        const selections=nextAppointment.clinicalSelections;
        if(!Array.isArray(selections))throw new Error("Choose at least one specific service for each selected clinical category.");
        const selectedOptions=selections.filter(item=>!(item?.category==="vaccination"&&item?.serviceId===REQUIRED_VACCINATION_FEE.id));
        const choicesByCategory=selectedOptions.reduce((choices,choice)=>{
          if(!choice?.category||!choice?.serviceId)throw new Error("Choose valid specific services for the selected appointment categories.");
          if(nextAppointment.serviceIds.includes(choice.category)) (choices[choice.category] ||= []).push(choice.serviceId);
          return choices;
        },{});
        serviceFields.clinicalSelections=buildClinicalSelections(nextAppointment.serviceIds,choicesByCategory,pet.data());
        serviceFields.service=nextAppointment.serviceIds.map(id=>{
          if(id==="deworming")return dewormingDescription(serviceFields.deworming || nextAppointment.deworming);
          const choices=serviceFields.clinicalSelections.filter(choice=>choice.category===id&&!choice.required);
          const name={vaccination:"Vaccination",consultation:"Consultation","laboratory-testing":"Laboratory Testing",deworming:"Deworming","pet-grooming":"Pet Grooming","low-cost-kapon":"Low Cost Kapon"}[id]||id;
          return choices.length?`${name}: ${choices.map(choice=>choice.name).join(" + ")}`:name;
        }).join(" + ");
        serviceFields.servicePrice="";
      } catch(error){throw new ApiError(400,error.message);}
    }
    if (nextAppointment.serviceIds !== undefined) {
      const { validateAppointmentServices, validateSinglePet, getEstimatedDuration, APPOINTMENT_BLOCK_MINUTES, getDefaultBlockCapacity } = await import("../../../shared/bookingServices.mjs");
      const { isValidClinicDateKey } = await import("../../../shared/serviceAvailability.mjs");
      try {
        if (requiresBookingValidation && !isValidClinicDateKey(nextAppointment.scheduleDate)) {
          throw new Error("Choose a valid appointment date.");
        }
        if (requiresBookingValidation) validateAppointmentServices(nextAppointment.serviceIds, nextAppointment.scheduleDate);
        if (requiresBookingValidation && !getDefaultBlockCapacity(nextAppointment.scheduleTime)) {
          throw new Error("Select a 9:00 AM, 11:00 AM, 2:00 PM, or 4:00 PM appointment block.");
        }
        validateSinglePet(nextAppointment);
        if (nextAppointment.serviceId !== nextAppointment.serviceIds[0]) {
          throw new Error("The primary service must match the selected appointment services.");
        }
        serviceFields.estimatedDurationMinutes = getEstimatedDuration(nextAppointment.serviceIds);
        serviceFields.blockDurationMinutes = Math.max(APPOINTMENT_BLOCK_MINUTES, serviceFields.estimatedDurationMinutes);
      } catch (error) {
        throw new ApiError(400, error.message);
      }
    }
    const groomingPetChanged = nextAppointment.petRecordId !== previous.petRecordId;
    const groomingChanged = JSON.stringify(nextAppointment.grooming) !== JSON.stringify(previous.grooming);
    if (nextAppointment.serviceIds?.includes("pet-grooming") && (requiresBookingValidation || groomingChanged || groomingPetChanged)) {
      const pet = await transaction.get(db.collection("pets").doc(nextAppointment.petRecordId));
      if (!pet.exists) throw new ApiError(400, "Choose a saved pet for grooming.");
      const petData = pet.data();
      if (user.role === "customer" && petData.customerId !== user.uid) throw new ApiError(403, "Choose your own pet for grooming.");
      const { buildGroomingSelection } = await import("../../../shared/groomingServices.mjs");
      try {
        const serviceIds = nextAppointment.grooming?.serviceIds ?? (nextAppointment.grooming?.serviceId ? [nextAppointment.grooming.serviceId] : []);
        serviceFields.grooming = buildGroomingSelection(serviceIds, petData);
        const { name, size } = serviceFields.grooming;
        const groomingLabel = 'Pet Grooming: ' + name + (size ? ' (' + size + ')' : '');
        serviceFields.service = nextAppointment.serviceIds.map(id => {
          if(id === "pet-grooming")return groomingLabel;
          if(id === "deworming")return dewormingDescription(serviceFields.deworming || nextAppointment.deworming);
          const choices=(serviceFields.clinicalSelections || nextAppointment.clinicalSelections || []).filter(choice=>choice.category===id&&!choice.required);
          const name={vaccination:"Vaccination",consultation:"Consultation",deworming:"Deworming","low-cost-kapon":"Low Cost Kapon"}[id]||id;
          return choices.length?`${name}: ${choices.map(choice=>choice.name).join(" + ")}`:name;
        }).join(' + ');
        serviceFields.servicePrice = '';

      } catch (error) { throw new ApiError(400, error.message); }
    }
    if (["Pending", "Confirmed", "Accepted", "Approved"].includes(nextStatus) && assignedStaff) {
      const { appointmentsOverlap } = await import("../../../shared/bookingServices.mjs");
      let staffBookingsQuery = db.collection("appointments")
        .where("assignedStaff", "==", assignedStaff)
        .where("status", "in", ACTIVE_APPOINTMENT_STATUSES)
        .limit(MAX_APPOINTMENT_LOOKUP_LIMIT);

      if (nextAppointment.scheduleDate) {
        staffBookingsQuery = staffBookingsQuery.where("scheduleDate", "==", nextAppointment.scheduleDate);
      }

      const staffBookings = await transaction.get(staffBookingsQuery);
      if (staffBookings.docs.some((entry) => entry.id !== id &&
          ACTIVE_APPOINTMENT_STATUSES.includes(entry.data().status) &&
          appointmentsOverlap(nextAppointment, entry.data()))) {
        throw new ApiError(409, "This staff member is already assigned to an overlapping appointment. Please choose another staff member or time.", { code: "STAFF_SCHEDULE_CONFLICT" });
      }
    }
    // Existing bookings can still be completed or cancelled after a promo ends.
    if (isLowCostKaponAppointment(nextAppointment) &&
        (!existing.exists || !isLowCostKaponAppointment(previous) ||
          (changedSchedule && !["Cancelled", "Rejected", "Completed"].includes(nextStatus)))) {
      const promo = await transaction.get(db.collection("lowCostKaponPromo").doc("low-cost-kapon"));
      if (!isKaponPromoAvailable(promo.data?.())) {
        throw new ApiError(409, KAPON_UNAVAILABLE_MESSAGE, { code: "KAPON_PROMO_INACTIVE" });
      }
    }
    if (nextAppointment.slotId && willBeActive && (!existing.exists || !wasActive || changedSchedule)) {
      const slot = await transaction.get(db.collection("availabilitySlots").doc(nextAppointment.slotId));
      const availability = slot.data?.() || {};
      if (nextAppointment.serviceIds && ((availability.date && availability.date !== nextAppointment.scheduleDate) ||
          (availability.time && availability.time.slice(0, 5) !== nextAppointment.scheduleTime?.slice(0, 5)))) {
        throw new ApiError(409, "The selected time does not match the appointment slot. Please choose the slot again.");
      }
      if (slot.exists && (availability.isOpen === false || availability.disabled === true ||
          ["cancelled", "disabled", "closed"].includes(String(availability.status || "").toLowerCase()))) {
        throw new ApiError(409, "That time slot is no longer available. Please choose another slot.", { code: "SLOT_UNAVAILABLE" });
      }
      const bySlot = await transaction.get(
        db.collection("appointments")
          .where("slotId", "==", nextAppointment.slotId)
          .limit(MAX_APPOINTMENT_LOOKUP_LIMIT),
      );
      const byDate = nextAppointment.scheduleDate && nextAppointment.scheduleTime
        ? await transaction.get(
          db.collection("appointments")
            .where("scheduleDate", "==", nextAppointment.scheduleDate)
            .limit(MAX_APPOINTMENT_LOOKUP_LIMIT),
        )
        : { docs: [] };
      const candidates = new Map([...bySlot.docs, ...byDate.docs].map((entry) => [entry.id, entry]));
      const activeAppointments = new Map();
      for (const entry of candidates.values()) {
        if (entry.id === id) continue;
        const appointment = entry.data();
        const sameSlot = appointment.slotId === nextAppointment.slotId || Boolean(nextAppointment.scheduleDate && nextAppointment.scheduleTime &&
          appointment.scheduleDate === nextAppointment.scheduleDate && appointment.scheduleTime?.slice(0, 5) === nextAppointment.scheduleTime.slice(0, 5));
        if (!sameSlot) continue;
        // Stable database document IDs are booking identities. Two bookings for the
        // same customer, pet, and slot still reserve two openings.
        activeAppointments.set(entry.id, appointment);
      }
      const activeCount = [...activeAppointments.values()].filter((appointment) => ACTIVE_APPOINTMENT_STATUSES.includes(appointment.status)).length;
      const { getBlockCapacity } = await import("../../../shared/bookingServices.mjs");
      const capacity = getBlockCapacity({ time: availability.time || nextAppointment.scheduleTime, capacity: availability.capacity });
      if (activeCount >= capacity) {
        throw new ApiError(409, "That time slot is already full. Please choose another slot.", { code: "SLOT_FULL" });
      }
    }
    // Touch each affected slot document in the same transaction. This serializes
    // concurrent reservations and makes Pending -> inactive releases visible to
    // every portal through the existing availability subscription.
    const changedReservationSlotIds = new Set();
    if (willBeActive && (!wasActive || changedSchedule) && nextAppointment.slotId) changedReservationSlotIds.add(nextAppointment.slotId);
    if (wasActive && (!willBeActive || changedSchedule) && previous.slotId) changedReservationSlotIds.add(previous.slotId);
    const reservationSlots = [];
    for (const slotId of changedReservationSlotIds) {
      const slotRef = db.collection("availabilitySlots").doc(slotId);
      reservationSlots.push({ ref: slotRef, snapshot: await transaction.get(slotRef) });
    }
    for (const {ref, snapshot} of reservationSlots) {
      transaction.set(ref, {
        reservationVersion: (Number(snapshot.data?.()?.reservationVersion) || 0) + 1,
        reservationUpdatedAt: new Date().toISOString(),
      }, {merge:true});
    }
    const { sessionAction, assignedStaff: _requestedAssignedStaff, ...payload } = appointment;
    savedAppointment = { ...previous, ...payload, ...serviceFields, ...sessionFields, ...decisionFields, updatedAt: new Date().toISOString() };
    const lifecycleEvents = Array.isArray(previous.lifecycleEvents) ? previous.lifecycleEvents : [];
    const auditEvent = buildAppointmentAuditEvent({ isNew: !existing.exists, previous, appointment: savedAppointment, actor: user, createdAt: savedAppointment.updatedAt });
    savedAppointment.lifecycleEvents = auditEvent ? [...lifecycleEvents, auditEvent] : lifecycleEvents;
    const { queueStatusEmail } = await import("../services/appointmentStatusEmail.service.js");
    emailNotification = queueStatusEmail({ db, transaction, previous: existing.exists ? previous : null,
      appointment: savedAppointment, actor: user, reason: decisionFields.decision?.reason || "" });
    transaction.set(reference, savedAppointment, { merge: true });
    if (!existing.exists && user.role === "customer") {
      const notificationId = `appointment-${id}-created`;
      const customerName = user.fullName || user.name || savedAppointment.ownerName || savedAppointment.customerName || "A customer";
      const serviceName = savedAppointment.service || savedAppointment.serviceIds?.join(", ") || savedAppointment.serviceId || "an appointment";
      transaction.set(db.collection("notifications").doc(notificationId), {
        id: notificationId,
        title: "New appointment booking",
        message: `${customerName} booked ${serviceName} for ${savedAppointment.scheduleDate || "a date to be confirmed"} at ${savedAppointment.scheduleTime || "a time to be confirmed"}.`,
        targetRoles: ["admin", "staff"],
        targetType: "appointment",
        targetId: id,
        relatedAppointmentId: id,
        actorName: customerName,
        actorRole: "customer",
        actionLabel: "Booked appointment",
        subjectName: customerName,
        subjectRole: "customer",
        appointmentDate: savedAppointment.scheduleDate || "",
        appointmentTime: savedAppointment.scheduleTime || "",
        serviceName,
        petName: savedAppointment.petName || "",
        level: "info",
        readBy: [],
        createdAt: new Date().toISOString(),
      });
      const customerNotificationId = `appointment-${id}-customer-created`;
      transaction.set(db.collection("notifications").doc(customerNotificationId), {
        id: customerNotificationId,
        title: "Appointment submitted",
        message: `Your appointment for ${serviceName} on ${savedAppointment.scheduleDate || "a date to be confirmed"} at ${savedAppointment.scheduleTime || "a time to be confirmed"} was submitted successfully.`,
        targetRoles: ["customer"],
        targetUserId: user.uid,
        targetType: "appointment",
        targetId: id,
        relatedAppointmentId: id,
        actorName: customerName,
        actorRole: "customer",
        actionLabel: "Submitted appointment",
        serviceName,
        petName: savedAppointment.petName || "",
        appointmentDate: savedAppointment.scheduleDate || "",
        appointmentTime: savedAppointment.scheduleTime || "",
        level: "success",
        readBy: [],
        createdAt: new Date().toISOString(),
      });
    }
    if(staffDecision || staffCancellation){
      const notificationId=`appointment-${id}-${nextStatus.toLowerCase()}`;
      transaction.set(db.collection("notifications").doc(notificationId),{
        id:notificationId,title:nextStatus==="Rejected"?"Appointment rejected":"Appointment cancelled",
        message:`${savedAppointment.petName || "Your appointment"} was ${nextStatus.toLowerCase()}.${staffDecision ? ` Reason: ${decisionFields.decision.reason}` : ""}`,
        targetRoles:["customer"],targetUserId:savedAppointment.customerId,email:savedAppointment.customerEmail||"",
        targetType:"appointment",targetId:id,relatedAppointmentId:id,petName:savedAppointment.petName||"",serviceName:savedAppointment.service||"",
        appointmentDate:savedAppointment.scheduleDate||"",appointmentTime:savedAppointment.scheduleTime||"",
        actorName:appointmentActorFullName(user),actorRole:user.role,level:"info",readBy:[],createdAt:new Date().toISOString(),
      });
    }
  });
  if (emailNotification) {
    const { requestStatusEmailDelivery } = await import("../services/appointmentStatusEmail.service.js");
    requestStatusEmailDelivery();
  }
  res.json({ success: true, appointment: savedAppointment, emailNotification });
}

module.exports = { saveAppointment };
