import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Info,
  PawPrint,
} from "lucide-react";
import { useApp } from "../context/AppContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { buildSeedAvailabilitySlots, serviceCatalog } from "../data/systemData.js";

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function createInitialFormData(customer, selectedDate = "") {
  return {
    fullName: customer?.name || "",
    email: customer?.email || "",
    contactNumber: customer?.phone || "",
    selectedServiceId: "",
    selectedDate,
    selectedSlotId: "",
    petName: "",
    petType: "",
    breed: "",
    petInformation: "",
    reminderEnabled: true,
  };
}

function parseLocalDate(dateValue) {
  if (!dateValue) {
    return null;
  }

  return new Date(`${dateValue}T00:00:00`);
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getMonthIndex(date) {
  return date.getFullYear() * 12 + date.getMonth();
}

function shiftMonth(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function isSameMonth(dateValue, visibleMonth) {
  const parsedDate = parseLocalDate(dateValue);
  return (
    parsedDate &&
    getMonthIndex(parsedDate) === getMonthIndex(visibleMonth)
  );
}

function getForecastEndDate(visibleMonth) {
  const today = new Date();
  const visibleMonthEnd = new Date(
    visibleMonth.getFullYear(),
    visibleMonth.getMonth() + 2,
    0,
  );
  const rollingEnd = new Date(today.getFullYear(), today.getMonth() + 4, 0);

  return visibleMonthEnd > rollingEnd ? visibleMonthEnd : rollingEnd;
}

function mergeSlotsById(baseSlots = [], overrideSlots = []) {
  const slotsById = new Map();

  baseSlots.forEach((slot) => {
    if (slot?.id) {
      slotsById.set(slot.id, slot);
    }
  });

  overrideSlots.forEach((slot) => {
    if (slot?.id) {
      slotsById.set(slot.id, {
        ...slotsById.get(slot.id),
        ...slot,
      });
    }
  });

  return Array.from(slotsById.values());
}

function isBookableFutureSlot(slot) {
  if (!slot?.date || !slot?.time) {
    return false;
  }

  const normalizedTime =
    typeof slot.time === "string"
      ? slot.time.trim().replace(/^(\d{1,2}):(\d{2})(?::\d{2})?$/, (_, hours, minutes) => {
          return `${String(hours).padStart(2, "0")}:${minutes}`;
        })
      : "";
  const parsed = new Date(`${slot.date}T${normalizedTime}:00`);

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

  for (
    let cursor = new Date(calendarStart);
    cursor <= calendarEnd;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    const day = new Date(cursor);
    const dateKey = formatDateKey(day);
    const slotsForDay = availableSlotsByDate[dateKey] || [];

    days.push({
      date: day,
      dateKey,
      isCurrentMonth: day.getMonth() === visibleMonth.getMonth(),
      isToday: dateKey === formatDateKey(new Date()),
      isSelected: dateKey === selectedDate,
      slotCount: slotsForDay.length,
      hasAvailability: slotsForDay.length > 0,
    });
  }

  return days;
}

function formatDateTimeLabel(date, time) {
  if (!date || !time) {
    return "Choose a slot";
  }

  const normalizedTime =
    typeof time === "string"
      ? time.trim().replace(/^(\d{1,2}):(\d{2})(?::\d{2})?$/, (_, hours, minutes) => {
          return `${String(hours).padStart(2, "0")}:${minutes}`;
        })
      : "";
  const parsed = new Date(`${date}T${normalizedTime}:00`);
  if (Number.isNaN(parsed.getTime())) {
    return "Choose a slot";
  }

  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function formatCalendarMonthLabel(date) {
  return new Intl.DateTimeFormat("en-PH", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatSelectedDateLabel(dateValue) {
  if (!dateValue) {
    return "Choose an available date";
  }

  const date = parseLocalDate(dateValue);
  if (!date || Number.isNaN(date.getTime())) {
    return "Choose an available date";
  }

  return new Intl.DateTimeFormat("en-PH", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatTimeLabel(time) {
  const normalizedTime =
    typeof time === "string"
      ? time.trim().replace(/^(\d{1,2}):(\d{2})(?::\d{2})?$/, (_, hours, minutes) => {
          return `${String(hours).padStart(2, "0")}:${minutes}`;
        })
      : "";
  const parsed = new Date(`2000-01-01T${normalizedTime}:00`);
  if (Number.isNaN(parsed.getTime())) {
    return "Time unavailable";
  }

  return new Intl.DateTimeFormat("en-PH", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

export function AppointmentBooking({ embedded = false }) {
  const { currentUser } = useAuth();
  const currentCustomer = currentUser?.role === "customer" ? currentUser : null;
  const { state, createAppointment, savePetRecord } = useApp();
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [availabilityRefreshTime, setAvailabilityRefreshTime] = useState(() => Date.now());
  const storedAvailabilitySlots = Array.isArray(state.availabilitySlots) ? state.availabilitySlots : [];
  const appointments = Array.isArray(state.appointments) ? state.appointments : [];
  const petRecords = Array.isArray(state.petRecords) ? state.petRecords : [];
  const forecastAvailabilitySlots = useMemo(
    () =>
      buildSeedAvailabilitySlots({
        startDate: new Date(availabilityRefreshTime),
        throughDate: getForecastEndDate(visibleMonth),
      }),
    [availabilityRefreshTime, visibleMonth],
  );
  const availabilitySlots = useMemo(
    () => mergeSlotsById(forecastAvailabilitySlots, storedAvailabilitySlots),
    [forecastAvailabilitySlots, storedAvailabilitySlots],
  );

  const slotInventory = useMemo(
    () =>
      availabilitySlots
        .map((slot) => {
          const bookedCount = appointments.filter(
            (appointment) =>
              appointment.slotId === slot.id &&
              ["Pending", "Confirmed", "Accepted"].includes(appointment.status),
          ).length;

          return {
            ...slot,
            bookedCount,
            remaining: Math.max(slot.capacity - bookedCount, 0),
          };
        })
        .filter((slot) => isBookableFutureSlot(slot))
        .filter((slot) => slot.isOpen)
        .sort((left, right) =>
          `${left.date} ${left.time}`.localeCompare(`${right.date} ${right.time}`),
        ),
    [appointments, availabilitySlots],
  );

  const availableSlots = useMemo(
    () => slotInventory.filter((slot) => slot.remaining > 0),
    [slotInventory],
  );
  const availableSlotsByDate = useMemo(
    () =>
      availableSlots.reduce((collection, slot) => {
        const nextCollection = collection;
        if (!nextCollection[slot.date]) {
          nextCollection[slot.date] = [];
        }
        nextCollection[slot.date].push(slot);
        return nextCollection;
      }, {}),
    [availableSlots],
  );
  const availableDateKeys = useMemo(
    () => Object.keys(availableSlotsByDate).sort(),
    [availableSlotsByDate],
  );
  const firstAvailableDate = availableDateKeys[0] || "";
  const visibleMonthAvailableDateKeys = useMemo(
    () => availableDateKeys.filter((dateKey) => isSameMonth(dateKey, visibleMonth)),
    [availableDateKeys, visibleMonth],
  );
  const firstVisibleAvailableDate = visibleMonthAvailableDateKeys[0] || "";
  const [formData, setFormData] = useState(() =>
    createInitialFormData(currentCustomer, firstAvailableDate),
  );
  const [errors, setErrors] = useState({});
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const firstAvailableMonthDate = firstAvailableDate ? parseLocalDate(firstAvailableDate) : null;

  const selectedService = serviceCatalog.find(
    (service) => service.id === formData.selectedServiceId,
  );
  const selectedSlot = availableSlots.find((slot) => slot.id === formData.selectedSlotId) || null;
  const selectedDateSlots = formData.selectedDate
    ? availableSlotsByDate[formData.selectedDate] || []
    : [];
  const calendarDays = useMemo(
    () => buildCalendarDays(visibleMonth, availableSlotsByDate, formData.selectedDate),
    [availableSlotsByDate, formData.selectedDate, visibleMonth],
  );
  const firstVisibleMonth = firstAvailableMonthDate
    ? new Date(firstAvailableMonthDate.getFullYear(), firstAvailableMonthDate.getMonth(), 1)
    : null;
  const currentVisibleMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const canGoToPreviousMonth = firstVisibleMonth
    ? getMonthIndex(visibleMonth) > getMonthIndex(currentVisibleMonth)
    : true;
  const canGoToNextMonth = true;

  useEffect(() => {
    const refreshTimer = window.setInterval(() => {
      setAvailabilityRefreshTime(Date.now());
    }, 60 * 1000);

    return () => window.clearInterval(refreshTimer);
  }, []);

  useEffect(() => {
    setFormData((current) => {
      const keepSelectedDate =
        current.selectedDate &&
        availableSlotsByDate[current.selectedDate]?.length &&
        isSameMonth(current.selectedDate, visibleMonth);
      const nextSelectedDate = keepSelectedDate
        ? current.selectedDate
        : firstVisibleAvailableDate || firstAvailableDate;
      const selectedSlotStillAvailable = nextSelectedDate
        ? availableSlotsByDate[nextSelectedDate]?.some((slot) => slot.id === current.selectedSlotId)
        : false;

      if (
        nextSelectedDate === current.selectedDate &&
        (!current.selectedSlotId || selectedSlotStillAvailable)
      ) {
        return current;
      }

      return {
        ...current,
        selectedDate: nextSelectedDate,
        selectedSlotId: selectedSlotStillAvailable ? current.selectedSlotId : "",
      };
    });
  }, [
    availableSlotsByDate,
    firstAvailableDate,
    firstVisibleAvailableDate,
    visibleMonth,
  ]);

  const handleMonthChange = useCallback(
    (amount) => {
      const nextVisibleMonth = shiftMonth(visibleMonth, amount);
      const nextMonthAvailableDate = availableDateKeys.find((dateKey) =>
        isSameMonth(dateKey, nextVisibleMonth),
      );
      const nextSelectedDate = nextMonthAvailableDate || firstAvailableDate || "";

      setVisibleMonth(nextVisibleMonth);
      setFormData((current) => {
        const selectedSlotStillAvailable = nextSelectedDate
          ? availableSlotsByDate[nextSelectedDate]?.some((slot) => slot.id === current.selectedSlotId)
          : false;

        if (
          current.selectedDate === nextSelectedDate &&
          (!current.selectedSlotId || selectedSlotStillAvailable)
        ) {
          return current;
        }

        return {
          ...current,
          selectedDate: nextSelectedDate,
          selectedSlotId: selectedSlotStillAvailable ? current.selectedSlotId : "",
        };
      });
    },
    [availableDateKeys, availableSlotsByDate, firstAvailableDate, visibleMonth],
  );

  const handleChange = (field) => (event) => {
    const value =
      event.target.type === "checkbox" ? event.target.checked : event.target.value;

    setFormData((current) => ({ ...current, [field]: value }));
    if (feedback.message) {
      setFeedback({ type: "", message: "" });
    }
    if (errors[field]) {
      setErrors((current) => ({ ...current, [field]: "" }));
    }
  };

  const handleServiceSelect = (serviceId) => {
    setFormData((current) => ({ ...current, selectedServiceId: serviceId }));
    if (feedback.message) {
      setFeedback({ type: "", message: "" });
    }
    if (errors.selectedServiceId) {
      setErrors((current) => ({ ...current, selectedServiceId: "" }));
    }
  };

  const handleDateSelect = (dateKey) => {
    const selectedDate = parseLocalDate(dateKey);
    if (selectedDate) {
      const selectedMonth = new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        1,
      );
      if (getMonthIndex(selectedMonth) !== getMonthIndex(visibleMonth)) {
        setVisibleMonth(selectedMonth);
      }
    }

    setFormData((current) => {
      const keepCurrentSlot = availableSlotsByDate[dateKey]?.some(
        (slot) => slot.id === current.selectedSlotId,
      );

      return {
        ...current,
        selectedDate: dateKey,
        selectedSlotId: keepCurrentSlot ? current.selectedSlotId : "",
      };
    });
    if (feedback.message) {
      setFeedback({ type: "", message: "" });
    }
    if (errors.selectedSlotId) {
      setErrors((current) => ({ ...current, selectedSlotId: "" }));
    }
  };

  const handleSlotSelect = (slotId, dateKey) => {
    const selectedDate = parseLocalDate(dateKey);
    if (selectedDate) {
      const selectedMonth = new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        1,
      );
      if (getMonthIndex(selectedMonth) !== getMonthIndex(visibleMonth)) {
        setVisibleMonth(selectedMonth);
      }
    }

    setFormData((current) => ({
      ...current,
      selectedDate: dateKey,
      selectedSlotId: slotId,
    }));
    if (feedback.message) {
      setFeedback({ type: "", message: "" });
    }
    if (errors.selectedSlotId) {
      setErrors((current) => ({ ...current, selectedSlotId: "" }));
    }
  };

  const validateForm = () => {
    const nextErrors = {};

    if (!formData.fullName.trim()) {
      nextErrors.fullName = "Full name is required.";
    }

    if (!formData.email.trim()) {
      nextErrors.email = "Email is required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      nextErrors.email = "Please enter a valid email address.";
    }

    if (!formData.contactNumber.trim()) {
      nextErrors.contactNumber = "Contact number is required.";
    }

    if (!formData.selectedServiceId) {
      nextErrors.selectedServiceId = "Choose a service first.";
    }

    if (!formData.selectedSlotId) {
      nextErrors.selectedSlotId = "Select an available date and time.";
    }

    if (!formData.petName.trim()) {
      nextErrors.petName = "Pet name is required.";
    }

    if (!formData.petType.trim()) {
      nextErrors.petType = "Pet type is required.";
    }

    if (
      currentCustomer &&
      currentCustomer.email === formData.email.trim().toLowerCase() &&
      currentCustomer.status !== "active"
    ) {
      nextErrors.email = "This customer account is suspended and cannot create bookings.";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    if (!validateForm() || !selectedService || !selectedSlot) {
      return;
    }

    const existingPetRecord = petRecords.find(
      (record) =>
        record.customerEmail?.toLowerCase() === formData.email.trim().toLowerCase() &&
        record.petName.trim().toLowerCase() === formData.petName.trim().toLowerCase(),
    );

    const nextPetRecordPayload = {
      id: existingPetRecord?.id,
      customerId: currentCustomer?.uid || existingPetRecord?.customerId || "",
      customerEmail: formData.email.trim().toLowerCase(),
      ownerName: formData.fullName.trim(),
      petName: formData.petName.trim(),
      petType: formData.petType.trim(),
      breed: formData.breed.trim(),
      lastVisit: existingPetRecord?.lastVisit || "",
      visitRecords: existingPetRecord?.visitRecords || [],
      medicalRecords: existingPetRecord?.medicalRecords || [],
      notes: formData.petInformation.trim() || existingPetRecord?.notes || "",
    };

    savePetRecord(nextPetRecordPayload, formData.fullName.trim());

    createAppointment(
      {
        customerId: currentCustomer?.uid || "",
        customerEmail: formData.email.trim().toLowerCase(),
        contactNumber: formData.contactNumber.trim(),
        ownerName: formData.fullName.trim(),
        petRecordId: existingPetRecord?.id || undefined,
        petName: formData.petName.trim(),
        petType: formData.petType.trim(),
        breed: formData.breed.trim(),
        service: selectedService.name,
        slotId: selectedSlot.id,
        scheduleDate: selectedSlot.date,
        scheduleTime: selectedSlot.time,
        status: "Pending",
        reminderEnabled: formData.reminderEnabled,
        notes: formData.petInformation.trim(),
      },
      formData.fullName.trim(),
    );

    setFeedback({
      type: "success",
      message:
        "Appointment booked successfully. A booking notification is now available in Notifications.",
    });
    setFormData(createInitialFormData(currentCustomer, firstAvailableDate));
    setErrors({});
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
          <p className="inline-flex rounded-full border border-white/14 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/76">
            Book Appointment
          </p>
          <h1 className="mt-4 max-w-4xl text-3xl font-semibold leading-tight md:text-5xl">
            Select a service, choose a date, and confirm a time slot.
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-white/78 md:text-base">
            Browse open dates, review time slots, enter pet details, and send a complete booking
            request in one place.
          </p>

          {currentCustomer?.status !== "active" && currentCustomer && (
            <div className="mt-6 rounded-[24px] border border-[#F4B7BE] bg-[#FFF1F3] px-5 py-4 text-sm text-[#8A3240]">
              Your customer account is suspended, so new bookings are disabled until the clinic
              restores access.
            </div>
          )}
        </motion.section>
      )}

      <form onSubmit={handleSubmit} className="grid items-start gap-4 xl:grid-cols-[1.12fr_0.88fr]">
        <div className="space-y-4">
          <section className="rounded-lg bg-white p-4 shadow-[0_14px_32px_rgba(94,81,60,0.12)] md:p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#EAF6F6] text-[#2D6B73]">
                <CheckCircle2 size={20} />
              </div>
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#7A979C]">
                  Step 1
                </p>
                <h2 className="text-xl font-semibold text-[#20343B]">Choose a service</h2>
              </div>
            </div>

            <div className="mt-4 grid gap-2.5 md:grid-cols-2">
              {serviceCatalog.map((service) => (
                <button
                  key={service.id}
                  type="button"
                  onClick={() => handleServiceSelect(service.id)}
                  className={`rounded-lg border px-3.5 py-3 text-left transition ${
                    formData.selectedServiceId === service.id
                      ? "border-[#2D9B9B] bg-[#F3FBFB]"
                      : "border-[#E6EFEE] bg-[#FCFEFE]"
                  }`}
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7A979C]">
                    {service.category}
                  </p>
                  <h3 className="mt-1 text-lg font-semibold text-[#20343B]">{service.name}</h3>
                  <p className="mt-2 text-sm leading-5 text-[#607277]">{service.description}</p>
                  <div className="mt-2 flex items-center justify-between text-xs font-semibold">
                    <span className="text-[#2D6B73]">{service.duration}</span>
                    <span className="text-[#6A5D4A]">{service.priceLabel}</span>
                  </div>
                </button>
              ))}
            </div>
            {errors.selectedServiceId && (
              <p className="mt-3 text-sm text-[#B23949]">{errors.selectedServiceId}</p>
            )}
          </section>

          <section className="rounded-lg bg-white p-4 shadow-[0_14px_32px_rgba(94,81,60,0.12)] md:p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#EAF6F6] text-[#2D6B73]">
                <CalendarDays size={20} />
              </div>
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#7A979C]">
                  Step 2
                </p>
                <h2 className="text-xl font-semibold text-[#20343B]">
                  Select date and time
                </h2>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <div className="rounded-lg border border-[#E6EFEE] bg-[#FCFEFE] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                <div className="flex items-center justify-between gap-4">
                  <button
                    type="button"
                    onClick={() => canGoToPreviousMonth && handleMonthChange(-1)}
                    disabled={!canGoToPreviousMonth}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#E2ECEB] bg-white text-[#2D6B73] transition hover:border-[#BDD9D7] hover:bg-[#F7FBFB] disabled:cursor-not-allowed disabled:opacity-45"
                    aria-label="Show previous month"
                  >
                    <ChevronLeft size={18} />
                  </button>

                  <div className="text-center">
                    <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#7B9A9F]">
                      Available calendar
                    </p>
                    <h3 className="mt-1 text-xl font-semibold text-[#20343B]">
                      {formatCalendarMonthLabel(visibleMonth)}
                    </h3>
                  </div>

                  <button
                    type="button"
                    onClick={() => canGoToNextMonth && handleMonthChange(1)}
                    disabled={!canGoToNextMonth}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#E2ECEB] bg-white text-[#2D6B73] transition hover:border-[#BDD9D7] hover:bg-[#F7FBFB] disabled:cursor-not-allowed disabled:opacity-45"
                    aria-label="Show next month"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-7 gap-1.5 text-center text-xs font-semibold uppercase tracking-[0.14em] text-[#8BA3A7]">
                  {DAYS_OF_WEEK.map((day) => (
                    <div key={day} className="py-1">
                      {day}
                    </div>
                  ))}
                </div>

                <div className="mt-1.5 grid grid-cols-7 gap-1.5">
                  {calendarDays.map((day) => (
                    <button
                      key={day.dateKey}
                      type="button"
                      onClick={() => day.hasAvailability && handleDateSelect(day.dateKey)}
                      disabled={!day.hasAvailability}
                      className={`min-h-[46px] rounded-lg border px-1 py-1.5 transition ${
                        day.isSelected
                          ? "border-[#2D9B9B] bg-[#2D9B9B] text-white shadow-[0_18px_34px_rgba(45,155,155,0.22)]"
                        : day.hasAvailability
                            ? "border-[#DDEAEA] bg-white text-[#20343B] hover:border-[#BFDCDC] hover:bg-[#F5FBFB]"
                            : day.isToday
                              ? "border-[#F4C16A] bg-[#FFF8EA] text-[#A56A0F]"
                            : day.isCurrentMonth
                              ? "border-transparent bg-transparent text-[#B4C2C5]"
                              : "border-transparent bg-transparent text-[#D0DADC]"
                      }`}
                    >
                      <div className="flex flex-col items-center justify-center">
                        <span className="text-sm font-semibold">{day.date.getDate()}</span>
                        <span
                          className={`mt-2 inline-flex h-1.5 w-1.5 rounded-full ${
                            day.hasAvailability
                              ? day.isSelected
                                ? "bg-white"
                                : "bg-[#2D9B9B]"
                              : "bg-transparent"
                          }`}
                        />
                      </div>
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-[#607277]">
                  <span className="rounded-lg bg-[#2D9B9B] px-3 py-1.5 text-white">Selected</span>
                  <span className="rounded-lg border border-[#DDEAEA] bg-white px-3 py-1.5">Available</span>
                  <span className="rounded-lg bg-[#F1F5F5] px-3 py-1.5 text-[#9AA9AC]">Unavailable</span>
                  <span className="rounded-lg border border-[#F4C16A] bg-[#FFF8EA] px-3 py-1.5 text-[#A56A0F]">Today</span>
                </div>
              </div>

              <div className="rounded-lg border border-[#E6EFEE] bg-[#FCFEFE] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#7B9A9F]">
                      Available time slots
                    </p>
                    <h3 className="mt-1 text-xl font-semibold text-[#20343B]">
                      {formatSelectedDateLabel(formData.selectedDate)}
                    </h3>
                  </div>
                  {selectedDateSlots.length > 0 && (
                    <p className="text-sm text-[#607277]">
                      {selectedDateSlots.length} time slot
                      {selectedDateSlots.length === 1 ? "" : "s"} open
                    </p>
                  )}
                </div>

                {selectedDateSlots.length > 0 ? (
                  <div className="mt-4 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                    {selectedDateSlots.map((slot) => (
                      <button
                        key={slot.id}
                        type="button"
                        onClick={() => handleSlotSelect(slot.id, slot.date)}
                      className={`rounded-lg border px-3.5 py-2.5 text-left transition ${
                          formData.selectedSlotId === slot.id
                            ? "border-[#2D9B9B] bg-[#2D9B9B] text-white shadow-[0_18px_34px_rgba(45,155,155,0.22)]"
                            : "border-[#DDEAEA] bg-white text-[#20343B] hover:border-[#BFDCDC] hover:bg-[#F5FBFB]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-base font-semibold">{formatTimeLabel(slot.time)}</span>
                          <Clock3 size={17} className={formData.selectedSlotId === slot.id ? "text-white" : "text-[#2D6B73]"} />
                        </div>
                        <p
                          className={`mt-2 text-sm ${
                            formData.selectedSlotId === slot.id ? "text-white/78" : "text-[#607277]"
                          }`}
                        >
                          {slot.remaining} opening{slot.remaining === 1 ? "" : "s"} left
                        </p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-5 text-sm leading-6 text-[#607277]">
                    Choose a highlighted date to see the available appointment times.
                  </p>
                )}

                <div className="mt-3 rounded-lg bg-[#F4FAFA] px-4 py-3 text-sm text-[#33545A]">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#2D6B73]">
                      <Info size={18} />
                    </div>
                    <div>
                      <p className="font-semibold">
                        Estimated session duration: {selectedService?.duration || "Choose a service first"}
                      </p>
                      <p className="mt-1 text-[#607277]">
                        Please arrive 10 minutes before your appointment time and bring any previous medical notes when available.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              {availableSlots.length === 0 && (
                <p className="text-sm text-[#607277]">
                  No open slots are available right now. Please check again later.
                </p>
              )}
              {errors.selectedSlotId && (
                <p className="text-sm text-[#B23949]">{errors.selectedSlotId}</p>
              )}
            </div>
          </section>
        </div>

        <section className="rounded-lg bg-white p-4 shadow-[0_14px_32px_rgba(94,81,60,0.12)] md:p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#EAF6F6] text-[#2D6B73]">
              <PawPrint size={20} />
            </div>
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#7A979C]">
                Step 3
              </p>
              <h2 className="text-xl font-semibold text-[#20343B]">
                Enter customer and pet details
              </h2>
            </div>
          </div>

          <div className="mt-4 grid gap-2.5">
            <input
              value={formData.fullName}
              onChange={handleChange("fullName")}
              className="rounded-lg border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
              placeholder="Full name"
            />
            {errors.fullName && <p className="-mt-1 text-sm text-[#B23949]">{errors.fullName}</p>}

            <input
              type="email"
              value={formData.email}
              onChange={handleChange("email")}
              className="rounded-lg border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
              placeholder="Email address"
            />
            {errors.email && <p className="-mt-1 text-sm text-[#B23949]">{errors.email}</p>}

            <input
              value={formData.contactNumber}
              onChange={handleChange("contactNumber")}
              className="rounded-lg border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
              placeholder="Contact number"
            />
            {errors.contactNumber && (
              <p className="-mt-1 text-sm text-[#B23949]">{errors.contactNumber}</p>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <input
                  value={formData.petName}
                  onChange={handleChange("petName")}
                  className="w-full rounded-lg border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                  placeholder="Pet name"
                />
                {errors.petName && (
                  <p className="mt-2 text-sm text-[#B23949]">{errors.petName}</p>
                )}
              </div>
              <div>
                <input
                  value={formData.petType}
                  onChange={handleChange("petType")}
                  className="w-full rounded-lg border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                  placeholder="Pet type"
                />
                {errors.petType && (
                  <p className="mt-2 text-sm text-[#B23949]">{errors.petType}</p>
                )}
              </div>
            </div>

            <input
              value={formData.breed}
              onChange={handleChange("breed")}
              className="rounded-lg border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
              placeholder="Breed"
            />

            <textarea
              value={formData.petInformation}
              onChange={handleChange("petInformation")}
              rows={4}
              className="rounded-lg border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
              placeholder="Pet information, symptoms, special handling notes, or visit concerns"
            />

            <label className="flex items-center gap-3 rounded-lg bg-[#F5FAFA] px-4 py-3 text-sm text-[#33545A]">
              <input
                type="checkbox"
                checked={formData.reminderEnabled}
                onChange={handleChange("reminderEnabled")}
                className="h-4 w-4 rounded border-[#BFD6D6]"
              />
              Send booking reminder notification
            </label>
          </div>

          <div className="mt-4 rounded-lg bg-[#173E44] px-4 py-4 text-white">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/64">
              Booking summary
            </p>
            <div className="mt-3 space-y-2.5 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-white/72">Service</span>
                <span className="font-semibold">
                  {selectedService ? selectedService.name : "Choose a service"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-white/72">Schedule</span>
                <span className="font-semibold">
                  {selectedSlot
                    ? formatDateTimeLabel(selectedSlot.date, selectedSlot.time)
                    : "Choose a slot"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-white/72">Notifications</span>
                <span className="inline-flex items-center gap-2 font-semibold">
                  <Bell size={14} />
                  {formData.reminderEnabled ? "Enabled" : "Disabled"}
                </span>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={currentCustomer?.status !== "active" && Boolean(currentCustomer)}
            className={`mt-4 w-full rounded-lg px-5 py-3 text-sm font-semibold text-white transition ${
              currentCustomer?.status !== "active" && currentCustomer
                ? "cursor-not-allowed bg-[#9CB5B8]"
                : "bg-[#2D9B9B] hover:bg-[#288A8A]"
            }`}
          >
            Confirm appointment booking
          </button>

          {feedback.message && (
            <p
              className={`mt-5 rounded-[22px] px-4 py-3 text-sm font-medium ${
                feedback.type === "error"
                  ? "bg-[#FBECEF] text-[#B23949]"
                  : "bg-[#EAF7F7] text-[#2D6B73]"
              }`}
            >
              {feedback.message}
            </p>
          )}
        </section>
      </form>
    </div>
  );

  if (embedded) {
    return content;
  }

  return <div className="min-h-[calc(100vh-5rem)] bg-[#F6F0E7] px-4 py-6 sm:px-6">{content}</div>;
}
