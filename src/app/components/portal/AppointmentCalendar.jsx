import { useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { APPOINTMENT_STATUSES, APPOINTMENT_COLORS, appointmentStatusLabel, appointmentStart } from "../../utils/appointmentPresentation.js";
import "./appointmentCalendar.css";

export function AppointmentCalendar({ appointments, onOpenAppointment }) {
  const calendarRef = useRef(null);
  const containerRef = useRef(null);
  const [title, setTitle] = useState("");
  const [view, setView] = useState("dayGridMonth");
  useEffect(() => {
    let width = 0;
    let frame;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => calendarRef.current?.getApi().updateSize());
    });
    observer.observe(containerRef.current);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  const events = useMemo(() => appointments.flatMap((appointment) => {
    const start = appointmentStart(appointment);
    if (!start) return [];
    const status = appointmentStatusLabel(appointment.status);
    const colors = APPOINTMENT_COLORS[status] || APPOINTMENT_COLORS.Pending;
    const end = new Date(`${start}+08:00`);
    end.setMinutes(end.getMinutes() + 120);
    const endParts = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(end).replace(" ", "T");
    return [{ id: appointment.id, title: `${appointment.petName || "Pet"} | ${appointment.service || "Appointment"}`, start, end: endParts,
      backgroundColor: colors.background, borderColor: colors.border, textColor: colors.text,
      extendedProps: { status, petName: appointment.petName, service: appointment.service } }];
  }), [appointments]);
  const changeView = (nextView) => {
    calendarRef.current?.getApi().changeView(nextView);
    setView(nextView);
  };
  return (
    <section ref={containerRef} className="appointment-calendar min-w-0 bg-white px-4 py-5 md:px-5" aria-label="Appointment calendar">
      <div className="flex items-center gap-3 text-[#20343B]">
        <CalendarDays size={24} className="shrink-0 text-[#2D6B73]" />
        <h3 className="text-xl font-semibold">Appointment calendar</h3>
      </div>
      <div className="my-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => calendarRef.current?.getApi().today()} className="rounded-lg border border-[#D9E7E7] px-3 py-2 text-sm font-semibold text-[#24444A]">Today</button>
          <button type="button" aria-label="Previous calendar period" title="Previous calendar period" onClick={() => calendarRef.current?.getApi().prev()} className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#D9E7E7] text-[#24444A]"><ChevronLeft size={18} /></button>
          <button type="button" aria-label="Next calendar period" title="Next calendar period" onClick={() => calendarRef.current?.getApi().next()} className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#D9E7E7] text-[#24444A]"><ChevronRight size={18} /></button>
          <p className="ml-1 text-base font-semibold text-[#20343B]" aria-live="polite">{title}</p>
        </div>
        <div className="flex overflow-hidden rounded-lg border border-[#D9E7E7]" role="group" aria-label="Calendar view">
          {[["Month", "dayGridMonth"], ["Week", "timeGridWeek"], ["Day", "timeGridDay"]].map(([label, mode]) => (
            <button key={mode} type="button" aria-pressed={view === mode} onClick={() => changeView(mode)}
              className={`px-3 py-2 text-sm font-semibold ${view === mode ? "bg-[#173E44] text-white" : "bg-white text-[#607277]"}`}>{label}</button>
          ))}
        </div>
      </div>
      <FullCalendar ref={calendarRef} plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView="dayGridMonth" headerToolbar={false} height={520} events={events} editable={false}
        dayMaxEvents={3} moreLinkClick="popover" eventDisplay="block" displayEventEnd={false}
        eventTimeFormat={{ hour: "numeric", minute: "2-digit", meridiem: "short", omitZeroMinute: true }}
        slotMinTime="08:00:00" slotMaxTime="19:00:00" allDaySlot={false} nowIndicator
        datesSet={(info) => { setTitle(info.view.title); setView(info.view.type); }}
        dateClick={(info) => calendarRef.current?.getApi().changeView("timeGridDay", info.dateStr)}
        eventClick={(info) => onOpenAppointment(info.event.id)}
        eventDidMount={(info) => { info.el.title = `${info.event.title} | ${info.event.extendedProps.status}`; }}
        eventContent={(info) => <div className="calendar-event-content"><span className="calendar-event-name">{info.event.extendedProps.petName || "Pet"}</span><span className="calendar-event-service">{info.event.extendedProps.service}</span><span>{info.timeText}</span></div>}
      />
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-[#D9E7E7] pt-3 text-xs text-[#425A60]" aria-label="Appointment status colors">
        {APPOINTMENT_STATUSES.map((status) => <span key={status} className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-full border" style={{ backgroundColor: status === "Completed" ? APPOINTMENT_COLORS[status].background : APPOINTMENT_COLORS[status].border, borderColor: APPOINTMENT_COLORS[status].border }} />{status}</span>)}
      </div>
    </section>
  );
}
