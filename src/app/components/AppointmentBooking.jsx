import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import {
  buildSeedAvailabilitySlots,
  isServiceAvailableOnDate,
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
  if (!slot?.date || !slot?.time || !slot.isOpen) return false;
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

function createPetSelection() {
  return {
    id: `pet-choice-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    petRecordId: "",
    serviceId: "",
  };
}

function mergeSlotsById(baseSlots = [], overrideSlots = []) {
  const slotsById = new Map();
  baseSlots.forEach((slot) => slot?.id && slotsById.set(slot.id, slot));
  overrideSlots.forEach((slot) => {
    if (slot?.id) slotsById.set(slot.id, { ...slotsById.get(slot.id), ...slot });
  });
  return Array.from(slotsById.values());
}

export function AppointmentBooking({ embedded = false }) {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { state, createAppointment, getPendingAppointmentCount } = useApp();
  const customer = currentUser?.role === "customer" ? currentUser : null;
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [petSelections, setPetSelections] = useState(() => [createPetSelection()]);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [errors, setErrors] = useState({});
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);

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
  const selectedServices = petSelections
    .map((selection) => serviceCatalog.find((service) => service.id === selection.serviceId))
    .filter(Boolean);
  const allSelectedServicesDaily =
    selectedServices.length > 0 && selectedServices.every((service) => service.availability === "daily");
  const appointmentServiceId = allSelectedServicesDaily ? "pet-grooming" : "consultation";
  const forecastAvailabilitySlots = useMemo(() => buildSeedAvailabilitySlots({ days: 120 }), []);
  const availabilitySlots = useMemo(
    () => mergeSlotsById(forecastAvailabilitySlots, state.availabilitySlots || []),
    [forecastAvailabilitySlots, state.availabilitySlots],
  );
  const availableSlots = useMemo(
    () =>
      availabilitySlots
        .map((slot) => {
          const bookedCount = appointments.filter(
            (appointment) =>
              appointment.slotId === slot.id &&
              ["Pending", "Confirmed", "Accepted"].includes(appointment.status),
          ).length;
          return { ...slot, bookedCount, remaining: Math.max((Number(slot.capacity) || 1) - bookedCount, 0) };
        })
        .filter(isBookableFutureSlot)
        .filter((slot) => slot.remaining > 0)
        .filter((slot) => isServiceAvailableOnDate(appointmentServiceId, slot.date))
        .sort((left, right) => `${left.date} ${left.time}`.localeCompare(`${right.date} ${right.time}`)),
    [appointmentServiceId, appointments, availabilitySlots],
  );
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

  const updateSelection = (id, updates) => {
    setPetSelections((current) =>
      current.map((selection) => (selection.id === id ? { ...selection, ...updates } : selection)),
    );
    setFeedback({ type: "", message: "" });
    setErrors({});
  };

  const addPetSelection = () => setPetSelections((current) => [...current, createPetSelection()]);
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
      if (!selection.petRecordId) nextErrors[`pet-${selection.id}`] = `Choose pet #${index + 1}.`;
      if (selection.petRecordId && !selection.serviceId) {
        nextErrors[`service-${selection.id}`] = `Choose a service for pet #${index + 1}.`;
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
      navigate("/login", { state: { from: "/customer/dashboard?tab=booking" } });
      return;
    }

    if (isSubmitting || !validateForm() || !selectedSlot) return;

    const bookingEmail = customer.email?.trim().toLowerCase() || "";
    const pendingAppointmentCount = getPendingAppointmentCount(customer.uid || customer.id, bookingEmail);
    if (pendingAppointmentCount + petSelections.length > 2) {
      const message = "Booking limit reached. You can have up to 2 pending appointments at a time.";
      setFeedback({ type: "error", message });
      toast.error(message);
      return;
    }

    setIsSubmitting(true);
    const now = new Date().toISOString();

    try {
      for (const selection of petSelections) {
        const pet = customerPetRecords.find((record) => record.id === selection.petRecordId);
        const service = serviceCatalog.find((item) => item.id === selection.serviceId);
        if (!pet || !service) continue;

        const appointmentId = `appt-${customer.uid}-${selectedSlot.id}-${pet.id}-${service.id}`
          .replace(/[^a-zA-Z0-9_-]/g, "-")
          .slice(0, 150);
        const petSnapshot = {
          id: pet.id,
          petName: pet.petName,
          petType: pet.petType,
          breed: pet.breed,
          notes: pet.notes || "",
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
            service: service.name,
            servicePrice: service.priceLabel,
            slotId: selectedSlot.id,
            slotCapacity: selectedSlot.capacity,
            scheduleDate: selectedSlot.date,
            scheduleTime: selectedSlot.time,
            status: "Pending",
            reminderEnabled,
            notes: pet.notes || "",
            updatedAt: now,
          },
          customer.fullName || customer.name || "Customer",
        );
      }

      const message = "Appointment booking submitted successfully.";
      setFeedback({ type: "success", message });
      toast.success(message);
      setPetSelections([createPetSelection()]);
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

  const content = (
    <div className="mx-auto max-w-[1180px] space-y-4">
      {!embedded && (
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="rounded-lg bg-[linear-gradient(135deg,#173E44_0%,#2D6B73_58%,#82C8C0_100%)] p-5 text-white shadow-[0_20px_42px_rgba(20,43,46,0.18)] md:p-6"
        >
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white/72">
            Book Appointment
          </p>
          <h1 className="mt-2 text-3xl font-semibold md:text-4xl">Select pets, services, then reserve a slot.</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-white/76">
            Contact details are pulled from your customer profile. Add pets from the dashboard first, then choose which pet needs which service.
          </p>
        </motion.section>
      )}

      <form onSubmit={handleSubmit} className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
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
              <div className="mt-5 rounded-lg border border-dashed border-[#D9E7E7] bg-[#F8FCFC] px-5 py-6 text-sm text-[#607277]">
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
                          <label className="mb-2 block text-sm font-medium text-[#425A60]">Select pet</label>
                          <select
                            value={selection.petRecordId}
                            onChange={(event) =>
                              updateSelection(selection.id, {
                                petRecordId: event.target.value,
                                serviceId: "",
                              })
                            }
                            className="w-full rounded-lg border border-[#D9E7E7] bg-white px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                          >
                            <option value="">Choose a saved pet</option>
                            {customerPetRecords.map((record) => (
                              <option key={record.id} value={record.id}>
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
                            <label className="mb-2 block text-sm font-medium text-[#425A60]">
                              Selected service
                            </label>
                            <select
                              value={selection.serviceId}
                              onChange={(event) => updateSelection(selection.id, { serviceId: event.target.value })}
                              className="w-full rounded-lg border border-[#D9E7E7] bg-white px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                            >
                              <option value="">Choose service</option>
                              {serviceCatalog.map((service) => (
                                <option key={service.id} value={service.id}>
                                  {service.name} - {service.priceLabel}
                                </option>
                              ))}
                            </select>
                            {errors[`service-${selection.id}`] && (
                              <p className="mt-2 text-sm text-[#B23949]">{errors[`service-${selection.id}`]}</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                <button
                  type="button"
                  onClick={addPetSelection}
                  className="inline-flex w-fit items-center gap-2 rounded-lg bg-[#EEF6F6] px-4 py-3 text-sm font-semibold text-[#24444A] transition hover:bg-[#E3F0F0]"
                >
                  <Plus size={16} />
                  Add another pet
                </button>
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
                  <p className="mt-5 text-sm leading-6 text-[#607277]">
                    Choose a highlighted date to see available times.
                  </p>
                )}
                {errors.selectedDate && <p className="mt-3 text-sm text-[#B23949]">{errors.selectedDate}</p>}
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
              const service = serviceCatalog.find((item) => item.id === selection.serviceId);
              return (
                <div key={selection.id} className="border-b border-white/10 pb-3 last:border-0 last:pb-0">
                  <p className="font-semibold">Pet #{index + 1}: {pet?.petName || "Choose pet"}</p>
                  <p className="mt-1 text-white/72">{service?.name || "Choose service"}</p>
                </div>
              );
            })}
            <div>
              <p className="text-white/72">Schedule</p>
              <p className="mt-1 font-semibold">{selectedSlot ? formatDateTimeLabel(selectedSlot.date, selectedSlot.time) : "Choose a slot"}</p>
            </div>
          </div>
          <label className="mt-4 flex items-center gap-3 rounded-lg bg-[#F5FAFA] px-4 py-3 text-sm text-[#33545A]">
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
            disabled={isSubmitting || customerPetRecords.length === 0 || customer?.status !== "active"}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#173E44] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#235A61] disabled:bg-[#9CB5B8]"
          >
            <CheckCircle2 size={16} />
            {isSubmitting ? "Saving appointment..." : "Confirm appointment booking"}
          </button>
          {feedback.message && (
            <p
              className={`mt-4 rounded-lg px-4 py-3 text-sm font-medium ${
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
