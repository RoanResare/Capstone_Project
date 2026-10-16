const { db } = require("../config/firebaseAdmin");
const { ApiError } = require("../utils/ApiError");

const ACTIVE_APPOINTMENT_STATUSES = ["Pending", "Confirmed", "Accepted", "Approved"];
const MAX_APPOINTMENT_LOOKUP_LIMIT = 200;

async function saveAppointment(req, res) {
  const appointment = req.body;
  const id = req.params.id;
  const user = req.auth.user;
  if (!appointment || appointment.id !== id || !id || id.includes("/")) {
    throw new ApiError(400, "A valid appointment is required.");
  }
  const reference = db.collection("appointments").doc(id);
  let savedAppointment;
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
    const assignedStaff = String(appointment.assignedStaff ?? existing.data?.()?.assignedStaff ?? "").trim();
    if (["Confirmed", "Accepted"].includes(nextStatus) && !assignedStaff) {
      throw new ApiError(400, "Assign a staff member before confirming the appointment.", { code: "STAFF_ASSIGNMENT_REQUIRED" });
    }
    if (user.role === "customer" && ["Confirmed", "Accepted", "Completed", "Approved"].includes(nextStatus)) {
      throw new ApiError(403, "Customers cannot confirm or approve appointments.");
    }
    if (user.role === "customer" && existing.exists) {
      const existingStatus = existing.data().status || "Pending";
      const statusChanged = appointment.status && appointment.status !== existingStatus;
      if (statusChanged && appointment.status !== "Cancelled") {
        throw new ApiError(403, "Customers can only cancel existing appointments.");
      }
    }
    const { isLowCostKaponAppointment, isKaponPromoAvailable, KAPON_UNAVAILABLE_MESSAGE } =
      await import("../../../shared/lowCostKaponPromo.mjs");
    const previous = existing.data?.() || {};
    if(!existing.exists && !Array.isArray(appointment.serviceIds))throw new ApiError(400,"Choose valid appointment services.");
    const decisionFields = {};
    const decisionChanged = JSON.stringify(appointment.decision) !== JSON.stringify(previous.decision);
    const staffDecision = ["admin","staff"].includes(user.role) && nextStatus === "Rejected" && (nextStatus !== previous.status || decisionChanged);
    const staffCancellation = ["admin","staff"].includes(user.role) && nextStatus === "Cancelled" && nextStatus !== previous.status;
    if (user.role === "customer" && (decisionChanged || appointment.rejectionReason !== previous.rejectionReason || appointment.cancellationReason !== previous.cancellationReason)) throw new ApiError(403,"Only clinic staff can set a rejection or cancellation reason.");
    if (nextStatus !== "Rejected" && decisionChanged) throw new ApiError(400,"Rejection reasons can only be set when rejecting an appointment.");
    if (staffDecision) {
      if (!existing.exists || previous.status !== "Pending") throw new ApiError(409,"Only pending appointments can be rejected.");
      const {validateAppointmentDecision} = await import("../../../shared/appointmentDecisions.mjs");
      try {
        const decision=validateAppointmentDecision(appointment.decision);
        decisionFields.decision={...decision,by:user.uid,at:new Date().toISOString()};
        decisionFields.rejectionReason=decision.reason;
      } catch(error) { throw new ApiError(400,error.message); }
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
    const nextAppointment = { ...previous, ...appointment };
    const changedSchedule = ["slotId", "scheduleDate", "scheduleTime", "schedule"].some(
      (field) => nextAppointment[field] !== previous[field],
    );
    const changedServices = JSON.stringify(nextAppointment.serviceIds) !== JSON.stringify(previous.serviceIds) || nextAppointment.serviceId !== previous.serviceId;
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
        if(!Array.isArray(selections))throw new Error("Choose one specific service per clinical category.");
        const selectedOptions=selections.filter(item=>!(item?.category==="vaccination"&&item?.serviceId===REQUIRED_VACCINATION_FEE.id));
        if(new Set(selectedOptions.map(item=>item?.category)).size!==selectedOptions.length)throw new Error("Choose one specific service per clinical category.");
        serviceFields.clinicalSelections=buildClinicalSelections(nextAppointment.serviceIds,Object.fromEntries(selectedOptions.map(choice=>[choice?.category,choice?.serviceId])),pet.data());
        serviceFields.service=nextAppointment.serviceIds.map(id=>{
          if(id==="deworming")return dewormingDescription(serviceFields.deworming || nextAppointment.deworming);
          const choices=serviceFields.clinicalSelections.filter(choice=>choice.category===id);
          const name={vaccination:"Vaccination",consultation:"Consultation","laboratory-testing":"Laboratory Testing",deworming:"Deworming","pet-grooming":"Pet Grooming","low-cost-kapon":"Low Cost Kapon"}[id]||id;
          return choices.length?`${name}: ${choices.map(choice=>choice.name).join(" + ")}`:name;
        }).join(" + ");
        serviceFields.servicePrice="";
      } catch(error){throw new ApiError(400,error.message);}
    }
    if (nextAppointment.serviceIds !== undefined) {
      const { validateAppointmentServices, validateSinglePet, getEstimatedDuration, APPOINTMENT_BLOCK_MINUTES, getDefaultBlockCapacity } = await import("../../../shared/bookingServices.mjs");
      try {
        if (requiresBookingValidation) validateAppointmentServices(nextAppointment.serviceIds);
        if (requiresBookingValidation && !getDefaultBlockCapacity(nextAppointment.scheduleTime)) {
          throw new Error("Select a 9:00 AM, 11:00 AM, 2:00 PM, or 4:00 PM appointment block.");
        }
        validateSinglePet(nextAppointment);
        if (nextAppointment.serviceId !== nextAppointment.serviceIds[0]) {
          throw new Error("The primary service must match the selected appointment services.");
        }
        serviceFields.estimatedDurationMinutes = getEstimatedDuration(nextAppointment.serviceIds);
        serviceFields.blockDurationMinutes = APPOINTMENT_BLOCK_MINUTES;
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
          const choice=(serviceFields.clinicalSelections || nextAppointment.clinicalSelections || []).find(choice=>choice.category===id);
          const name={vaccination:"Vaccination",consultation:"Consultation",deworming:"Deworming","low-cost-kapon":"Low Cost Kapon"}[id]||id;
          return choice?`${name}: ${choice.name}`:name;
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
    if (nextAppointment.slotId && (!existing.exists || changedSchedule)) {
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
          .where("status", "in", ACTIVE_APPOINTMENT_STATUSES)
          .limit(MAX_APPOINTMENT_LOOKUP_LIMIT),
      );
      const byDate = nextAppointment.scheduleDate && nextAppointment.scheduleTime
        ? await transaction.get(
          db.collection("appointments")
            .where("scheduleDate", "==", nextAppointment.scheduleDate)
            .where("status", "in", ACTIVE_APPOINTMENT_STATUSES)
            .limit(MAX_APPOINTMENT_LOOKUP_LIMIT),
        )
        : { docs: [] };
      const candidates = new Map([...bySlot.docs, ...byDate.docs].map((entry) => [entry.id, entry]));
      const activeCount = [...candidates.values()].filter((entry) =>
        entry.id !== id && ACTIVE_APPOINTMENT_STATUSES.includes(entry.data().status) &&
          (entry.data().slotId === nextAppointment.slotId || !nextAppointment.scheduleDate || !nextAppointment.scheduleTime ||
            entry.data().scheduleTime?.slice(0, 5) === nextAppointment.scheduleTime.slice(0, 5)),
      ).length;
      const { getBlockCapacity } = await import("../../../shared/bookingServices.mjs");
      const capacity = getBlockCapacity({ time: availability.time || nextAppointment.scheduleTime, capacity: availability.capacity });
      if (activeCount >= capacity) {
        throw new ApiError(409, "That time slot is already full. Please choose another slot.", { code: "SLOT_FULL" });
      }
    }
    const { sessionAction, ...payload } = appointment;
    savedAppointment = { ...previous, ...payload, ...serviceFields, ...sessionFields, ...decisionFields, updatedAt: new Date().toISOString() };
    if(savedAppointment.status==="Expired")savedAppointment.status="No Show";
    transaction.set(reference, savedAppointment, { merge: true });
    if(staffDecision || staffCancellation){
      const notificationId=`appointment-${id}-${nextStatus.toLowerCase()}`;
      transaction.set(db.collection("notifications").doc(notificationId),{
        id:notificationId,title:nextStatus==="Rejected"?"Appointment rejected":"Appointment cancelled",
        message:`${savedAppointment.petName || "Your appointment"} was ${nextStatus.toLowerCase()}.${staffDecision ? ` Reason: ${decisionFields.decision.reason}` : ""}`,
        targetRoles:["customer"],targetUserId:savedAppointment.customerId,email:savedAppointment.customerEmail||"",
        targetType:"appointment",targetId:id,relatedAppointmentId:id,petName:savedAppointment.petName||"",serviceName:savedAppointment.service||"",
        appointmentDate:savedAppointment.scheduleDate||"",appointmentTime:savedAppointment.scheduleTime||"",
        actorName:user.name||user.fullName||"Clinic team",actorRole:user.role,level:"info",readBy:[],createdAt:new Date().toISOString(),
      });
    }
  });
  res.json({ success: true, appointment: savedAppointment });
}

module.exports = { saveAppointment };
