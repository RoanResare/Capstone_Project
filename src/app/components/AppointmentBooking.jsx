import {CLINICAL_SERVICES,clinicalOptions,buildClinicalSelections,normalizeClinicalChoices} from "../../../shared/clinicalServices.mjs";
import { getSelectedPricelistCategories } from "../../../shared/pricelists.mjs";
import {REQUIRED_VACCINATION_FEE,dewormingForPet,dewormingDescription} from "../../../shared/bookingAdditions.mjs";
import { PricelistImage } from "./PricelistImage.jsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  PawPrint,
  Plus,
  Trash2,
} from "lucide-react";
import { useApp } from "../context/AppContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { KAPON_SERVICE_ID, KAPON_UNAVAILABLE_MESSAGE } from "../../../shared/lowCostKaponPromo.mjs";
import { groomingOptionsForPet, buildGroomingSelection } from "../../../shared/groomingServices.mjs";
import { validateAppointmentServices, getEstimatedDuration, getActiveAppointmentCountForSlot, getBlockCapacity, APPOINTMENT_BLOCK_MINUTES } from "../../../shared/bookingServices.mjs";
import { getServiceUnavailableMessage, getUnavailableServiceIds } from "../../../shared/serviceAvailability.mjs";
import {
  buildSeedAvailabilitySlots,
  serviceCatalog,
} from "../data/systemData.js";

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDate(dateValue) {
  return dateValue ? new Date(`${dateValue}T00:00:00`) : null;
}

function getMonthIndex(date) {
  return date.getFullYear() * 12 + date.getMonth();
}

function shiftMonth(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function formatCalendarMonthLabel(date) {
  return new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric" }).format(date);
}

function formatSelectedDateLabel(dateValue) {
  const date = parseLocalDate(dateValue);
  if (!date || Number.isNaN(date.getTime())) return "Choose an available date";
  return new Intl.DateTimeFormat("en-PH", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatTimeLabel(time) {
  const parsed = new Date(`2000-01-01T${String(time || "").slice(0, 5)}:00`);
  if (Number.isNaN(parsed.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-PH", { hour: "2-digit", minute: "2-digit" }).format(parsed);
}

function formatDateTimeLabel(date, time) {
  const parsed = date && time ? new Date(`${date}T${String(time).slice(0, 5)}:00`) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return "Choose a slot";
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function isBookableFutureSlot(slot) {
  if (!slot?.date || !slot?.time || slot.isOpen !== true || slot.disabled === true ||
      ["cancelled", "disabled", "closed"].includes(String(slot.status || "").toLowerCase())) return false;
  const parsed = new Date(`${slot.date}T${String(slot.time).slice(0, 5)}:00`);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() > Date.now();
}

function buildCalendarDays(visibleMonth, availableSlotsByDate, selectedDate) {
  const firstDayOfMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
  const lastDayOfMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0);
  const calendarStart = new Date(firstDayOfMonth);
  calendarStart.setDate(firstDayOfMonth.getDate() - firstDayOfMonth.getDay());
  const calendarEnd = new Date(lastDayOfMonth);
  calendarEnd.setDate(lastDayOfMonth.getDate() + (6 - lastDayOfMonth.getDay()));
  const days = [];

  for (let cursor = new Date(calendarStart); cursor <= calendarEnd; cursor.setDate(cursor.getDate() + 1)) {
    const date = new Date(cursor);
    const dateKey = formatDateKey(date);
    const slotsForDay = availableSlotsByDate[dateKey] || [];
    days.push({
      date,
      dateKey,
      isCurrentMonth: date.getMonth() === visibleMonth.getMonth(),
      isToday: dateKey === formatDateKey(new Date()),
      isSelected: dateKey === selectedDate,
      hasAvailability: slotsForDay.length > 0,
    });
  }

  return days;
}

function createPetSelection(serviceId = "") {
  return {
    id: `pet-choice-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    petRecordId: "",
    serviceIds: serviceId ? [serviceId] : [""],
    groomingServiceIds: [], clinicalChoices: {},
  };
}

function selectedServiceIds(selection) {
  if (Array.isArray(selection.serviceIds)) return selection.serviceIds;
  return [selection.serviceId, selection.additionalServiceId].filter((id) => id !== null && id !== undefined);
}

function servicePriceRange(serviceIds) {
  return serviceIds.map((id) => serviceCatalog.find((service) => service.id === id)?.priceLabel || "")
    .reduce((total, label) => {
      const match = /PHP\s*([\d,]+)(?:\s*-\s*([\d,]+))?/i.exec(label);
      if (!match) return total;
      const minimum = Number(match[1].replaceAll(",", ""));
      const maximum = Number((match[2] || match[1]).replaceAll(",", ""));
      return { minimum: total.minimum + minimum, maximum: total.maximum + maximum, count: total.count + 1 };
    }, { minimum: 0, maximum: 0, count: 0 });
}

function formatPriceRange(range) {
  const money = (amount) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(amount);
  return range.minimum === range.maximum ? money(range.minimum) : `${money(range.minimum)}–${money(range.maximum)}`;
}

function mergeSlotsById(baseSlots = [], overrideSlots = []) {
  const slotsById = new Map();
  baseSlots.forEach((slot) => slot?.id && slotsById.set(slot.id, slot));
  overrideSlots.forEach((slot) => {
    if (slot?.id) slotsById.set(slot.id, { ...slotsById.get(slot.id), ...slot });
  });
  return Array.from(slotsById.values());
}

export function AppointmentBooking({ embedded = false, initialServiceId = "", serviceSelectionRequest = 0, rebookAppointment = null }) {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { state, availabilityReady, availabilityError, createAppointment, kaponPromoAvailable } = useApp();
  const customer = currentUser?.role === "customer" ? currentUser : null;
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [petSelections, setPetSelections] = useState(() => [createPetSelection(initialServiceId)]);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [pricelistIndex, setPricelistIndex] = useState(0);
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [errors, setErrors] = useState({});
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (rebookAppointment) {
      const serviceIds = rebookAppointment.serviceIds?.length ? rebookAppointment.serviceIds : [rebookAppointment.serviceId];
      setPetSelections([{
        ...createPetSelection(serviceIds[0] || initialServiceId),
        petRecordId: rebookAppointment.petRecordId || rebookAppointment.petRecordIds?.[0] || "",
        serviceIds: serviceIds.length ? serviceIds : [""],
        groomingServiceIds: rebookAppointment.grooming?.serviceIds || [],
        notes: rebookAppointment.notes || "",
        clinicalChoices: (rebookAppointment.clinicalSelections || []).filter(choice => !choice.required).reduce((choices, choice) => {
          (choices[choice.category] ||= []).push(choice.serviceId);
          return choices;
        }, {}),
      }]);
      setReminderEnabled(rebookAppointment.reminderEnabled !== false);
      setSelectedDate("");
      setSelectedSlotId("");
      setErrors({});
      setFeedback({ type: "info", message: "Your previous pet and service details are filled in. Choose an available date and time for your new appointment." });
      return;
    }
    if (!initialServiceId) return;
    setPetSelections((current) => current.map((selection, index) => index === 0
      ? { ...selection, serviceIds: initialServiceId ? [initialServiceId] : [""], groomingServiceIds: [], clinicalChoices: {} }
      : selection));
    setSelectedDate("");
    setSelectedSlotId("");
    setErrors({});
    setFeedback({ type: "", message: "" });
  }, [initialServiceId, serviceSelectionRequest, rebookAppointment?.id]);


  const customerPetRecords = useMemo(
    () =>
      (state.petRecords || []).filter(
        (record) =>
          record.customerId === customer?.uid ||
          record.customerEmail?.toLowerCase() === customer?.email?.toLowerCase(),
      ),
    [customer?.email, customer?.uid, state.petRecords],
  );
  const appointments = Array.isArray(state.appointments) ? state.appointments : [];
  const hasUnavailableKapon = !kaponPromoAvailable && petSelections.some((selection) =>
    selectedServiceIds(selection).includes(KAPON_SERVICE_ID));
  const bookingServiceIds = [...new Set(petSelections.flatMap(selectedServiceIds).filter(Boolean))];
  const selectedPricelists = getSelectedPricelistCategories(bookingServiceIds);
  const activePricelist = selectedPricelists[pricelistIndex] || null;
  useEffect(() => {
    if (pricelistIndex >= selectedPricelists.length) setPricelistIndex(Math.max(selectedPricelists.length - 1, 0));
  }, [pricelistIndex, selectedPricelists.length]);
  const unavailableSelectedServices = selectedDate ? [...new Set(petSelections.flatMap((selection) =>
    getUnavailableServiceIds(selectedServiceIds(selection).filter(Boolean), selectedDate)))]: [];
  const selectedServicesAvailabilityError = unavailableSelectedServices.length
    ? unavailableSelectedServices.map((id) => getServiceUnavailableMessage(id, selectedDate)).join(" ")
    : "";
  const forecastAvailabilitySlots = useMemo(() => buildSeedAvailabilitySlots({ days: 120 }), []);
  const availabilitySlots = useMemo(
    () => availabilityReady ? mergeSlotsById(forecastAvailabilitySlots, state.availabilitySlots || []) : [],
    [availabilityReady, forecastAvailabilitySlots, state.availabilitySlots],
  );
  const availableSlots = useMemo(
    () =>
      availabilitySlots
        .map((slot) => {
          const bookedCount = getActiveAppointmentCountForSlot(appointments, slot);
          return { ...slot, bookedCount, remaining: Math.max(getBlockCapacity(slot) - bookedCount, 0) };
        })
        .filter(isBookableFutureSlot)
        .filter((slot) => getUnavailableServiceIds(bookingServiceIds, slot.date).length === 0)
        .filter((slot) => slot.remaining > 0)
        .sort((left, right) => `${left.date} ${left.time}`.localeCompare(`${right.date} ${right.time}`)),
    [appointments, availabilitySlots, bookingServiceIds.join("|")],
  );
  const fullyBookedDates = useMemo(() => {
    const bookedByDate = new Map();

    availabilitySlots
      .filter(isBookableFutureSlot)
      .forEach((slot) => {
        const bookedCount = getActiveAppointmentCountForSlot(appointments, slot);
        const remaining = Math.max(getBlockCapacity(slot) - bookedCount, 0);
        const entry = bookedByDate.get(slot.date) || { total: 0, full: 0 };
        entry.total += 1;
        if (remaining <= 0) entry.full += 1;
        bookedByDate.set(slot.date, entry);
      });

    return Array.from(bookedByDate.entries())
      .filter(([, entry]) => entry.total > 0 && entry.total === entry.full)
      .map(([date]) => date)
      .sort()
      .slice(0, 12);
  }, [appointments, availabilitySlots]);
  const availableSlotsByDate = useMemo(
    () =>
      availableSlots.reduce((collection, slot) => {
        collection[slot.date] = [...(collection[slot.date] || []), slot];
        return collection;
      }, {}),
    [availableSlots],
  );
  const calendarDays = useMemo(
    () => buildCalendarDays(visibleMonth, availableSlotsByDate, selectedDate),
    [availableSlotsByDate, selectedDate, visibleMonth],
  );
  const selectedDateSlots = selectedDate ? availableSlotsByDate[selectedDate] || [] : [];
  const selectedSlot = availableSlots.find((slot) => slot.id === selectedSlotId) || null;
  const restoredSchedule = useRef("");
  useEffect(() => {
    if (!rebookAppointment || !availabilityReady) return;
    const request = rebookAppointment.id + ':' + serviceSelectionRequest;
    if (restoredSchedule.current === request) return;
    restoredSchedule.current = request;
    const previousSlot = availableSlots.find(slot =>
      slot.date === rebookAppointment.scheduleDate &&
      slot.time.slice(0, 5) === String(rebookAppointment.scheduleTime || "").slice(0, 5));
    if (previousSlot) {
      setSelectedDate(previousSlot.date);
      setSelectedSlotId(previousSlot.id);
      const date = parseLocalDate(previousSlot.date);
      setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    }
  }, [rebookAppointment?.id, serviceSelectionRequest, availabilityReady, availableSlots]);

  const updateSelection = (id, updates) => {
    setPetSelections((current) =>
      current.map((selection) => (selection.id === id ? { ...selection, ...updates } : selection)),
    );
    setFeedback({ type: "", message: "" });
    setErrors({});
  };

  const clearServiceFeedback = () => { setFeedback({ type: "", message: "" }); setErrors({}); };
  const addServiceSelection = (selectionId) => {
    setPetSelections((current) => current.map((selection) =>
      selection.id === selectionId ? { ...selection, serviceIds: [...selectedServiceIds(selection), ""] } : selection));
    clearServiceFeedback();
  };
  const updateService = (selectionId, serviceIndex, serviceId) => {
    setPetSelections((current) => current.map((selection) => {
      if (selection.id !== selectionId) return selection;
      const serviceIds = selectedServiceIds(selection).slice();
      serviceIds[serviceIndex] = serviceId;
      return { ...selection, serviceIds };
    }));
    clearServiceFeedback();
  };
  const removeService = (selectionId, serviceIndex) => {
    setPetSelections((current) => current.map((selection) => {
      if (selection.id !== selectionId) return selection;
      const serviceIds = selectedServiceIds(selection).filter((_, index) => index !== serviceIndex);
      return { ...selection, serviceIds: serviceIds.length ? serviceIds : [""] };
    }));
    clearServiceFeedback();
  };
  const removePetSelection = (id) =>
    setPetSelections((current) =>
      current.length === 1 ? current : current.filter((selection) => selection.id !== id),
    );

  const handleDateSelect = (dateKey) => {
    const selected = parseLocalDate(dateKey);
    if (selected) setVisibleMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
    setSelectedDate(dateKey);
    setSelectedSlotId("");
    setErrors((current) => ({ ...current, selectedDate: "", selectedSlotId: "" }));
  };

  const validateForm = () => {
    const nextErrors = {};

    if (customerPetRecords.length === 0) {
      nextErrors.petSelections = "Add a pet on your dashboard before booking a service.";
    }

    petSelections.forEach((selection, index) => {
      const ids = selectedServiceIds(selection).filter(Boolean);
      if (selection.petRecordId) {
        try { buildClinicalSelections(ids, selection.clinicalChoices, customerPetRecords.find(record => record.id === selection.petRecordId)); }
        catch(error) { nextErrors[`clinical-${selection.id}`] = error.message; }
      }
      if (ids.includes(KAPON_SERVICE_ID) && !kaponPromoAvailable) {
        nextErrors[`service-${selection.id}`] = KAPON_UNAVAILABLE_MESSAGE;
      }
      if (ids.includes("pet-grooming")) {
        const pet = customerPetRecords.find((record) => record.id === selection.petRecordId);
        try { buildGroomingSelection(selection.groomingServiceIds, pet); }
        catch (error) { nextErrors[`grooming-${selection.id}`] = error.message; }
      }
      if (!selection.petRecordId) nextErrors[`pet-${selection.id}`] = `Choose pet #${index + 1}.`;
      if (selection.petRecordId && !ids.length) {
        nextErrors[`service-${selection.id}`] = `Choose a service for pet #${index + 1}.`;
      }
      if (selectedServiceIds(selection).some((serviceId) => !serviceId)) nextErrors[`service-${selection.id}`] = "Choose a service or remove the empty service selection.";
      if (ids.length) {
        try { validateAppointmentServices(ids, selectedDate); }
        catch (error) { nextErrors[`service-${selection.id}`] = error.message; }
      }
      if (selection.petRecordId && petSelections.some((other) => other.id !== selection.id && other.petRecordId === selection.petRecordId)) {
        nextErrors[`pet-${selection.id}`] = "Choose a different pet for each appointment.";
      }
    });

    if (!selectedDate) nextErrors.selectedDate = "Choose an available date.";
    if (!selectedSlotId || !selectedDateSlots.some((slot) => slot.id === selectedSlotId)) {
      nextErrors.selectedSlotId = "Choose an available time slot.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      const message = "Missing items. Please complete all booking fields.";
      setFeedback({ type: "error", message });
      toast.error(message);
      return false;
    }

    setFeedback({ type: "", message: "" });
    return true;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!customer) {
      navigate("/login", { state: { from: "/customer/dashboard?tab=services" } });
      return;
    }

    if (isSubmitting || !validateForm() || !selectedSlot) return;

    const bookingEmail = customer.email?.trim().toLowerCase() || "";

    setIsSubmitting(true);
    const now = new Date().toISOString();

    try {
      for (const selection of petSelections) {
        const pet = customerPetRecords.find((record) => record.id === selection.petRecordId);
        const serviceIds = selectedServiceIds(selection).filter(Boolean);
        const service = serviceCatalog.find((item) => item.id === serviceIds[0]);
        if (!pet || !service) continue;
        const clinicalSelections = buildClinicalSelections(serviceIds, selection.clinicalChoices, pet);
        const services = serviceIds.map((id) => serviceCatalog.find((item) => item.id === id));
        const grooming = serviceIds.includes("pet-grooming") ? buildGroomingSelection(selection.groomingServiceIds, pet) : null;

        const appointmentId = `appt-${customer.uid}-${selectedSlot.id}-${pet.id}-${service.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
          .replace(/[^a-zA-Z0-9_-]/g, "-")
          .slice(0, 150);
        const petSnapshot = {
          id: pet.id,
          petName: pet.petName,
          petType: pet.petType,
          weightKg: pet.weightKg || "",
          breed: pet.breed,
          notes: selection.notes ?? pet.notes ?? "",
        };

        await createAppointment(
          {
            id: appointmentId,
            customerId: customer.uid,
            customerEmail: bookingEmail,
            customerName: customer.fullName || customer.name || "",
            ownerName: customer.fullName || customer.name || "",
            contactNumber: customer.phone || "",
            petRecordId: pet.id,
            petRecordIds: [pet.id],
            petSnapshot,
            petSnapshots: [petSnapshot],
            petName: pet.petName,
            petType: pet.petType,
            breed: pet.breed,
            serviceId: service.id,
            serviceIds,
            clinicalSelections,
            vaccinationFee: serviceIds.includes("vaccination") ? REQUIRED_VACCINATION_FEE : null,
            deworming: serviceIds.includes("deworming") ? dewormingForPet(pet) : null,
            service: services.map((item) => item.id === "pet-grooming" ? `Pet Grooming: ${grooming.name}${grooming.size ? ` (${grooming.size})` : ""}` : item.id === "deworming" ? dewormingDescription(dewormingForPet(pet)) : clinicalSelections.filter(choice => choice.category === item.id && !choice.required).map(choice => choice.name).join(" + ") ? `${item.name}: ${clinicalSelections.filter(choice => choice.category === item.id && !choice.required).map(choice => choice.name).join(" + ")}` : item.name).join(" + "),
            servicePrice: "",
            ...(grooming ? { grooming } : {}),
            estimatedDurationMinutes: getEstimatedDuration(serviceIds),
            blockDurationMinutes: Math.max(APPOINTMENT_BLOCK_MINUTES, getEstimatedDuration(serviceIds)),
            slotId: selectedSlot.id,
            slotCapacity: selectedSlot.capacity,
            scheduleDate: selectedSlot.date,
            scheduleTime: selectedSlot.time,
            status: "Pending",
            reminderEnabled,
            notes: selection.notes ?? pet.notes ?? "",
            updatedAt: now,
          },
          customer.fullName || customer.name || "Customer",
        );
      }

      const message = "Appointment booking submitted successfully.";
      setFeedback({ type: "success", message });
      toast.success(message);
      setPetSelections([createPetSelection(initialServiceId)]);
      setSelectedDate("");
      setSelectedSlotId("");
    } catch (error) {
      const message = error?.message || "Unable to save your appointment. Please try again.";
      setFeedback({ type: "error", message });
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (customer && customerPetRecords.length === 0) {
    return <Navigate to="/customer/dashboard?tab=overview&addPet=1" replace />;
  }
  if (initialServiceId === KAPON_SERVICE_ID && !kaponPromoAvailable) {
    return <div role="status" className="rounded-2xl border border-[#D9E7E7] bg-[#F8FCFC] p-5 text-sm text-[#607277]">{KAPON_UNAVAILABLE_MESSAGE}</div>;
  }

  const content = (
    <div className="mx-auto max-w-[1180px] space-y-4">
      {!embedded && (
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="rounded-lg bg-[linear-gradient(135deg,#173E44_0%,#2D6B73_58%,#82C8C0_100%)] p-5 text-white shadow-[0_20px_42px_rgba(20,43,46,0.18)] md:p-5"
        >
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white/72">
            Book Appointment
          </p>
          <h1 className="mt-2 text-3xl font-semibold md:text-4xl">Select a pet and services, then reserve a slot.</h1>
          <p className="mt-3 max-w-3xl text-sm leading-5 text-white/76">
            Contact details are pulled from your customer profile. Add pets from the dashboard first, then choose which pet needs which service.
          </p>
        </motion.section>
      )}

      <form onSubmit={handleSubmit} className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {activePricelist && <div>
            {selectedPricelists.length > 1 && <div className="mb-2 flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 shadow-sm sm:px-4">
              <button type="button" aria-label="Previous selected service pricelist" onClick={() => setPricelistIndex((index) => Math.max(index - 1, 0))}
                disabled={pricelistIndex === 0} className="inline-flex items-center gap-1 rounded-lg border border-[#D9E7E7] px-3 py-2 text-sm font-semibold text-[#24444A] disabled:opacity-40">
                <ChevronLeft size={16} /> Previous
              </button>
              <p aria-live="polite" className="text-center text-sm font-semibold text-[#365057]">{activePricelist.name} pricelist · {pricelistIndex + 1} of {selectedPricelists.length}</p>
              <button type="button" aria-label="Next selected service pricelist" onClick={() => setPricelistIndex((index) => Math.min(index + 1, selectedPricelists.length - 1))}
                disabled={pricelistIndex === selectedPricelists.length - 1} className="inline-flex items-center gap-1 rounded-lg border border-[#D9E7E7] px-3 py-2 text-sm font-semibold text-[#24444A] disabled:opacity-40">
                Next <ChevronRight size={16} />
              </button>
            </div>}
            <PricelistImage category={activePricelist.id} />
          </div>}
          <section className="rounded-lg bg-white p-4 shadow-[0_14px_32px_rgba(94,81,60,0.12)] md:p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#EAF6F6] text-[#2D6B73]">
                <PawPrint size={20} />
              </div>
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#7A979C]">
                  Pets and services
                </p>
                <h2 className="text-xl font-semibold text-[#20343B]">Choose a pet, then choose the service.</h2>
              </div>
            </div>

            {customerPetRecords.length === 0 ? (
              <div className="mt-5 rounded-lg border border-dashed border-[#BFDADA] bg-[#F8FCFC] px-5 py-6 text-xl font-semibold leading-7 text-[#20343B]">
                To book a service, please fill out the 'Add pet' form.
              </div>
            ) : (
              <div className="mt-5 grid gap-3">
                {petSelections.map((selection, index) => {
                  const selectedPet = customerPetRecords.find((record) => record.id === selection.petRecordId);
                  return (
                    <div key={selection.id} className="rounded-lg border border-[#E1ECEC] bg-[#FBFDFC] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#7A979C]">
                          Pet #{index + 1}
                        </p>
                        {petSelections.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removePetSelection(selection.id)}
                            className="inline-flex items-center gap-1 rounded-lg bg-[#FBECEF] px-3 py-2 text-xs font-semibold text-[#B23949]"
                          >
                            <Trash2 size={14} />
                            Remove
                          </button>
                        )}
                      </div>

                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div>
                          <label htmlFor={`booking-pet-${selection.id}`} className="mb-2 block text-sm font-medium text-[#425A60]">Select pet</label>
                          <select
                            id={`booking-pet-${selection.id}`}
                            value={selection.petRecordId}
                            onChange={(event) =>
                              updateSelection(selection.id, {
                                petRecordId: event.target.value,
                                notes: undefined,
                                serviceIds: selectedServiceIds(selection),
                                groomingServiceIds: [], clinicalChoices: {},
                              })
                            }
                            className="w-full rounded-lg border border-[#D9E7E7] bg-white px-4 py-2.5 outline-none transition focus:border-[#2D9B9B]"
                          >
                            <option value="">Choose a saved pet</option>
                            {customerPetRecords.map((record) => (
                              <option key={record.id} value={record.id} disabled={petSelections.some((other) => other.id !== selection.id && other.petRecordId === record.id)}>
                                {record.petName} ({record.petType})
                              </option>
                            ))}
                          </select>
                          {errors[`pet-${selection.id}`] && (
                            <p className="mt-2 text-sm text-[#B23949]">{errors[`pet-${selection.id}`]}</p>
                          )}
                        </div>

                        {selectedPet && (
                          <div>
                            <p className="mb-2 text-sm font-medium text-[#425A60]">Selected services</p>
                            <div className="space-y-3">
                              {selectedServiceIds(selection).map((serviceId, serviceIndex) => {
                                const otherIds = selectedServiceIds(selection).filter((_, index) => index !== serviceIndex && selectedServiceIds(selection)[index]);
                                const label = serviceIndex === 0 ? "Service" : `Additional service ${serviceIndex}`;
                                return <div key={`${selection.id}-service-${serviceIndex}`} className="flex items-center gap-2">
                                  <select
                                    id={`booking-service-${selection.id}-${serviceIndex}`}
                                    aria-label={label}
                                    value={serviceId}
                                    onChange={(event) => updateService(selection.id, serviceIndex, event.target.value)}
                                    className="min-w-0 flex-1 rounded-lg border border-[#D9E7E7] bg-white px-4 py-2.5 outline-none transition focus:border-[#2D9B9B]"
                                  >
                                    <option value="">Choose service</option>
                                    {serviceCatalog.filter((service) => service.id !== KAPON_SERVICE_ID || serviceId === KAPON_SERVICE_ID).map((service) => {
                                      let incompatible = otherIds.includes(service.id);
                                      if (!incompatible && service.id !== serviceId) {
                                        try { validateAppointmentServices([...otherIds, service.id]); }
                                        catch { incompatible = true; }
                                      }
                                      return <option key={service.id} value={service.id} disabled={incompatible || (service.id === KAPON_SERVICE_ID && !kaponPromoAvailable)}>
                                        {service.name}{service.id === KAPON_SERVICE_ID && !kaponPromoAvailable ? " (Currently unavailable)" : ""}
                                      </option>;
                                    })}
                                  </select>
                                  {(serviceIndex > 0 || selectedServiceIds(selection).length > 1) && <button type="button" onClick={() => removeService(selection.id, serviceIndex)} title={`Remove ${label.toLowerCase()}`} aria-label={`Remove ${label.toLowerCase()}`} className="p-2 text-[#B23949]"><Trash2 size={16} /></button>}
                                </div>;
                              })}
                              <button type="button" onClick={() => addServiceSelection(selection.id)}
                                className="inline-flex items-center gap-2 rounded-lg bg-[#EEF6F6] px-3 py-2 text-sm font-semibold text-[#24444A] transition hover:bg-[#E3F0F0]">
                                <Plus size={15} /> Add service
                              </button>
                            </div>
                            {errors[`service-${selection.id}`] && (
                              <p className="mt-2 text-sm text-[#B23949]">{errors[`service-${selection.id}`]}</p>
                            )}

                          </div>
                        )}
                        {selectedPet && [...new Set(selectedServiceIds(selection).filter(id => Object.hasOwn(CLINICAL_SERVICES,id)))].map(category => (
                          <fieldset key={category} className="rounded-lg border border-[#D9E7E7] bg-[#F3F8F8] p-3 md:col-span-2">
                            <legend className="px-1 text-sm font-semibold">{serviceCatalog.find(item => item.id === category)?.name} services</legend>
                            <p className="mb-3 text-xs text-[#607277]">Choose any services needed for {selectedPet.petName}.</p>
                            {category==="vaccination"&&<p className="mb-3 text-xs text-[#607277]">Doctor's Fee is required and will be added after booking.</p>}
                            <div className="grid gap-2 sm:grid-cols-2">{clinicalOptions(category,selectedPet).map(option => (
                              <label key={option.id} className="flex items-start gap-3 rounded-lg border border-[#D9E7E7] bg-white p-3 text-sm">
                                <input type="checkbox" checked={(normalizeClinicalChoices(selection.clinicalChoices)[category] || []).includes(option.id)}
                                  onChange={() => {
                                    const choices = normalizeClinicalChoices(selection.clinicalChoices);
                                    const selected = choices[category] || [];
                                    choices[category] = selected.includes(option.id) ? selected.filter(id => id !== option.id) : [...selected, option.id];
                                    updateSelection(selection.id, { clinicalChoices: choices });
                                  }} className="mt-1 h-4 w-4 shrink-0 accent-[#173E44]"/>
                                <span>{option.name}{option.description && <span className="mt-1 block text-xs text-[#607277]">{option.description}</span>}</span>
                              </label>
                            ))}</div>
                            {!clinicalOptions(category,selectedPet).length && <p className="text-sm text-[#B23949]">Available for saved cat and dog profiles only.</p>}
                          </fieldset>
                        ))}
                        {errors[`clinical-${selection.id}`] && <p role="alert" className="text-sm text-[#B23949] md:col-span-2">{errors[`clinical-${selection.id}`]}</p>}
                        {selectedPet && selectedServiceIds(selection).includes("deworming")&&<p className="text-xs text-[#607277] md:col-span-2">{dewormingDescription(dewormingForPet(selectedPet))}</p>}
                        {selectedPet && (selectedServiceIds(selection).includes("pet-grooming") && (
                              <fieldset className="mt-4 rounded-lg border border-[#D9E7E7] bg-[#F3F8F8] p-3 md:col-span-2">
                                <legend className="px-1 text-sm font-semibold text-[#365057]">{selectedPet.petType} grooming</legend>
                                <p className="mb-3 text-xs text-[#607277]">Select any grooming services and à la carte options you want for this pet.</p>
                                <div className="grid gap-4 sm:grid-cols-2">
                                  {Object.entries(groomingOptionsForPet(selectedPet)).map(([group, options]) => (
                                    <div key={group}>
                                      <p className="mb-2 text-sm font-semibold text-[#365057]">{group === "packages" ? "Grooming services" : "À la carte services"}</p>
                                      <div className="space-y-2">{options.map(item => {
                                        const checked = selection.groomingServiceIds.includes(item.id);
                                        return <label key={item.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-[#D9E7E7] bg-white px-3 py-2.5 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
                                          <input type="checkbox" checked={checked}
                                            onChange={() => updateSelection(selection.id, {groomingServiceIds: checked ? selection.groomingServiceIds.filter(id => id !== item.id) : [...selection.groomingServiceIds, item.id]})}
                                            className="h-4 w-4 shrink-0 accent-[#173E44]"/>{item.name}
                                        </label>;
                                      })}</div>
                                    </div>
                                  ))}
                                </div>
                                {!groomingOptionsForPet(selectedPet).packages.length && <p className="mt-2 text-sm text-[#B23949]">Grooming is available for saved cat and dog profiles only.</p>}
                                {errors[`grooming-${selection.id}`] && <p role="alert" className="mt-2 text-sm text-[#B23949]">{errors[`grooming-${selection.id}`]}</p>}
                              </fieldset>
                            ))}
                      </div>
                    </div>
                  );
                })}

              </div>
            )}
            {errors.petSelections && <p className="mt-3 text-sm text-[#B23949]">{errors.petSelections}</p>}
          </section>

          <section className="rounded-lg bg-white p-4 shadow-[0_14px_32px_rgba(94,81,60,0.12)] md:p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#EAF6F6] text-[#2D6B73]">
                <CalendarDays size={20} />
              </div>
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#7A979C]">
                  Date and time
                </p>
                <h2 className="text-xl font-semibold text-[#20343B]">Choose an open appointment slot.</h2>
              </div>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
              <div className="rounded-lg border border-[#E6EFEE] bg-[#FCFEFE] p-4">
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setVisibleMonth((current) => shiftMonth(current, -1))}
                    disabled={getMonthIndex(visibleMonth) <= getMonthIndex(new Date())}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#E2ECEB] bg-white text-[#2D6B73] transition hover:bg-[#F7FBFB] disabled:opacity-45"
                    aria-label="Show previous month"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <div className="text-center">
                    <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#7B9A9F]">
                      Calendar
                    </p>
                    <h3 className="mt-1 text-xl font-semibold text-[#20343B]">
                      {formatCalendarMonthLabel(visibleMonth)}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setVisibleMonth((current) => shiftMonth(current, 1))}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#E2ECEB] bg-white text-[#2D6B73] transition hover:bg-[#F7FBFB]"
                    aria-label="Show next month"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-7 gap-1.5 text-center text-xs font-semibold uppercase tracking-[0.14em] text-[#8BA3A7]">
                  {DAYS_OF_WEEK.map((day) => <div key={day} className="py-1">{day}</div>)}
                </div>
                <div className="mt-1.5 grid grid-cols-7 gap-1.5">
                  {calendarDays.map((day) =>
                    !day.isCurrentMonth ? (
                      <div key={day.dateKey} aria-hidden="true" className="min-h-[46px]" />
                    ) : (
                      <button
                        key={day.dateKey}
                        type="button"
                        onClick={() => day.hasAvailability && handleDateSelect(day.dateKey)}
                        disabled={!day.hasAvailability}
                        className={`relative min-h-[46px] rounded-lg border px-1 py-1.5 transition ${
                          day.isSelected
                            ? "border-[#2D9B9B] bg-[#2D9B9B] text-white"
                            : day.isToday
                              ? "border-[#F4C16A] bg-[#FFF8EA] text-[#A56A0F]"
                              : day.hasAvailability
                                ? "border-[#DDEAEA] bg-white text-[#20343B] hover:bg-[#F5FBFB]"
                                : "border-transparent bg-transparent text-[#B4C2C5]"
                        }`}
                      >
                        <span className="text-sm font-semibold">{day.date.getDate()}</span>
                      </button>
                    ),
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-[#E6EFEE] bg-[#FCFEFE] p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#7B9A9F]">
                      Time slots
                    </p>
                    <h3 className="mt-1 text-xl font-semibold text-[#20343B]">
                      {formatSelectedDateLabel(selectedDate)}
                    </h3>
                  </div>
                  <p className="text-sm text-[#607277]">{selectedDateSlots.length} open</p>
                </div>

                {selectedDateSlots.length > 0 ? (
                  <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                    {selectedDateSlots.map((slot) => (
                      <button
                        key={slot.id}
                        type="button"
                        onClick={() => {
                          setSelectedSlotId(slot.id);
                          setErrors((current) => ({ ...current, selectedSlotId: "" }));
                        }}
                        className={`rounded-lg border px-3.5 py-2.5 text-left transition ${
                          selectedSlotId === slot.id
                            ? "border-[#2D9B9B] bg-[#2D9B9B] text-white"
                            : "border-[#DDEAEA] bg-white text-[#20343B] hover:bg-[#F5FBFB]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-base font-semibold">{formatTimeLabel(slot.time)}</span>
                          <Clock3 size={17} />
                        </div>
                        <p className={selectedSlotId === slot.id ? "mt-2 text-sm text-white/78" : "mt-2 text-sm text-[#607277]"}>
                          {slot.remaining} opening{slot.remaining === 1 ? "" : "s"} left
                        </p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-5 text-sm leading-5 text-[#607277]">
                    {availabilityError || (availabilityReady ? "Choose a highlighted date to see available times." : "Loading available times...")}
                  </p>
                )}
                {errors.selectedDate && <p className="mt-3 text-sm text-[#B23949]">{errors.selectedDate}</p>}
                {selectedServicesAvailabilityError && <p role="alert" className="mt-3 rounded-lg bg-[#FBECEF] px-3 py-2 text-sm text-[#B23949]">{selectedServicesAvailabilityError}</p>}
                {errors.selectedSlotId && <p className="mt-3 text-sm text-[#B23949]">{errors.selectedSlotId}</p>}
              </div>
            </div>
          </section>
        </div>

        <aside className="self-start rounded-lg bg-white p-4 shadow-[0_14px_32px_rgba(94,81,60,0.12)] md:p-5 xl:sticky xl:top-24">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#7B9A9F]">Next step</p>
          <h2 className="mt-2 text-2xl font-semibold text-[#20343B]">Review and book appointment.</h2>
          <div className="mt-4 space-y-3 rounded-lg bg-[#173E44] px-4 py-4 text-sm text-white">
            {petSelections.map((selection, index) => {
              const pet = customerPetRecords.find((record) => record.id === selection.petRecordId);
              const serviceIds = selectedServiceIds(selection).filter(Boolean);
              const services = serviceIds.map((id) => serviceCatalog.find((item) => item.id === id)).filter(Boolean);
              const priceRange = servicePriceRange(serviceIds);
              return (
                <div key={selection.id} className="border-b border-white/10 pb-3 last:border-0 last:pb-0">
                  <p className="font-semibold">Pet #{index + 1}: {pet?.petName || "Choose pet"}</p>
                  {services.length ? <div className="mt-1 space-y-1 text-white/80">{services.map((item) => <p key={item.id}>{item.name} <span className="text-white/65">({item.priceLabel})</span></p>)}</div> : <p className="mt-1 text-white/72">Choose service</p>}
                  {serviceIds.includes("vaccination")&&<p className="mt-1 text-white/90">{REQUIRED_VACCINATION_FEE.name} — required with vaccination</p>}
                  {serviceIds.includes("deworming")&&<p className="mt-1 text-white/90">{dewormingDescription(dewormingForPet(pet))}</p>}
                  {[...new Set(serviceIds.filter(id=>Object.hasOwn(CLINICAL_SERVICES,id)))].map(category=>{
                    const choices=normalizeClinicalChoices(selection.clinicalChoices)[category] || [];
                    const names=clinicalOptions(category,pet).filter(option=>choices.includes(option.id)).map(option=>option.name);
                    return <p key={category} className="mt-1 text-white/90">{names.join(", ") || "Choose at least one specific service"}</p>;
                  })}
                  {serviceIds.includes("pet-grooming") && (() => {
                    try {
                      const quote = buildGroomingSelection(selection.groomingServiceIds, pet);
                      return <p className="mt-1 text-white/90">{quote.name}</p>;
                    } catch { return <p className="mt-1 text-white/72">Choose at least one grooming service or à la carte option.</p>; }
                  })()}
                  {services.length > 0 && <p className="mt-1 text-white/72">Estimated duration: {getEstimatedDuration(serviceIds)} minutes</p>}
                  {priceRange.count > 0 && <p className="mt-1 font-semibold">Estimated service total: {formatPriceRange(priceRange)}</p>}
                </div>
              );
            })}
            <p className="text-xs text-white/65">Prices are estimates; the clinic confirms the final total based on the selected treatment or package.</p>
            <div>
              <p className="text-white/72">Schedule</p>
              <p className="mt-1 font-semibold">{selectedSlot ? formatDateTimeLabel(selectedSlot.date, selectedSlot.time) : "Choose a slot"}</p>
            </div>
          </div>
          <div className="mt-4 rounded-lg border border-[#E6EFEE] bg-[#FCFEFE] px-4 py-4">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#7B9A9F]">
              Fully booked dates
            </p>
            {fullyBookedDates.length === 0 ? (
              <p className="mt-2 text-sm leading-5 text-[#607277]">
                No fully booked dates in the current availability window.
              </p>
            ) : (
              <div className="mt-3 max-h-44 space-y-2 overflow-y-auto pr-1">
                {fullyBookedDates.map((date) => (
                  <div key={date} className="rounded-lg bg-[#FBECEF] px-3 py-2 text-sm font-semibold text-[#B23949]">
                    {formatSelectedDateLabel(date)}
                  </div>
                ))}
              </div>
            )}
          </div>

          <label className="mt-4 flex items-center gap-3 rounded-lg bg-[#F5FAFA] px-4 py-2.5 text-sm text-[#33545A]">
            <input
              type="checkbox"
              checked={reminderEnabled}
              onChange={(event) => setReminderEnabled(event.target.checked)}
              className="h-4 w-4 rounded border-[#BFD6D6]"
            />
            Send booking reminder notification
          </label>
          <button
            type="submit"
            disabled={isSubmitting || customerPetRecords.length === 0 || customer?.status !== "active" || hasUnavailableKapon}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#173E44] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#235A61] disabled:bg-[#9CB5B8]"
          >
            <CheckCircle2 size={16} />
            {isSubmitting ? "Saving appointment..." : "Confirm appointment booking"}
          </button>
          {hasUnavailableKapon && <p role="status" className="mt-3 text-sm text-[#607277]">{KAPON_UNAVAILABLE_MESSAGE}</p>}
          {feedback.message && (
            <p
              className={`mt-4 rounded-lg px-4 py-2.5 text-sm font-medium ${
                feedback.type === "error"
                  ? "bg-[#FBECEF] text-[#B23949]"
                  : "bg-[#EAF7F7] text-[#2D6B73]"
              }`}
            >
              {feedback.message}
            </p>
          )}
        </aside>
      </form>
    </div>
  );

  if (embedded) return content;

  return <div className="min-h-[calc(100vh-5rem)] bg-[#F6F0E7] px-4 py-6 sm:px-6">{content}</div>;
}
