import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, Power, X } from "lucide-react";
import { useApp } from "../../context/AppContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { normalizePromoInput, validatePromoSchedule, getPromoStatus, PROMO_NOTICE_MS } from "../../../../shared/lowCostKaponPromo.mjs";
import { getTextValidationErrors, PROMO_TEXT_FIELDS } from "../../../../shared/textModeration.mjs";

import { getKaponServerTime } from "../../services/kaponPromo.js";

function localDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date).replace(" ", "T");
}

function PromoScheduleFields({ label, value, onChange, inputClass, min = "" }) {
  const [date = "", time = "09:00"] = value.split("T");
  return <fieldset className="min-w-0 rounded-xl border border-[#D9E7E7] bg-[#F8FCFC] p-3">
    <legend className="px-1 text-sm font-medium text-[#425A60]">{label}</legend>
    <div className="grid gap-3">
      <label className="text-xs text-[#607277]">Date
        <input required type="date" min={min.slice(0, 10) || undefined} value={date} onChange={(event) => onChange(event.target.value ? `${event.target.value}T${time}` : "")} className={`mt-1 min-w-0 ${inputClass}`} />
      </label>
      <label className="text-xs text-[#607277]">Time
        <input required type="time" step="900" value={time} disabled={!date} min={date === min.slice(0, 10) ? min.slice(11, 16) : undefined} onChange={(event) => onChange(`${date}T${event.target.value}`)} className={`mt-1 ${inputClass}`} />
      </label>
    </div>
  </fieldset>;
}

function PromoFormDialog({ initialPromo, onClose, onSave }) {
  const dialogRef = useRef(null);
  const [form, setForm] = useState({
    title: initialPromo?.title || "Low-Cost Kapon",
    description: initialPromo?.description || "",
    formLink: initialPromo?.formLink || "",
    startsAt: initialPromo?.isActive ? localDateTime(initialPromo.startsAt) : "",
    endsAt: initialPromo?.isActive ? localDateTime(initialPromo.endsAt) : "",
  });
  const [serverClock, setServerClock] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const editing = initialPromo?.isActive === true;

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => { dialog.close(); document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getKaponServerTime().then(now => {
      if (cancelled) return;
      setServerClock({ now, received: performance.now() });
      if (!editing) {
        const start = Math.ceil((now + PROMO_NOTICE_MS) / 900000) * 900000;
        setForm(current => ({ ...current, startsAt: current.startsAt || localDateTime(start), endsAt: current.endsAt || localDateTime(start + 7200000) }));
      }
    }).catch(error => { if (!cancelled) setError(error.message); });
    return () => { cancelled = true; };
  }, []);
  const trustedNow = () => serverClock ? serverClock.now + performance.now() - serverClock.received : NaN;
  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setError("");
  };
  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setError("");
    const textErrors = getTextValidationErrors(form, PROMO_TEXT_FIELDS);
    if (Object.keys(textErrors).length) {
      setError(Object.values(textErrors)[0]);
      return;
    }
    try {
      const payload = normalizePromoInput({ ...form, startsAt: editing && form.startsAt === localDateTime(initialPromo.startsAt) ? initialPromo.startsAt : form.startsAt ? `${form.startsAt}:00+08:00` : "", endsAt: editing && form.endsAt === localDateTime(initialPromo.endsAt) ? initialPromo.endsAt : form.endsAt ? `${form.endsAt}:00+08:00` : "" });
      if (!serverClock) throw new Error("Wait for server time before scheduling.");
      validatePromoSchedule(payload, { now: trustedNow(), previous: editing ? initialPromo : null });
      setSaving(true);
      await onSave({ ...payload, action: editing ? "edit" : "activate", expectedRevision: initialPromo?.revision || 0 });
      onClose();
    } catch (saveError) {
      setError(saveError.message || "Unable to save the promotion.");
    } finally {
      setSaving(false);
    }
  };
  const inputClass = "w-full rounded-lg border border-[#D9E7E7] bg-white px-3 py-2.5 text-sm text-[#20343B] outline-none focus:border-[#2D9B9B] disabled:opacity-60";

  return createPortal(
    <dialog ref={dialogRef} aria-labelledby="kapon-promo-title"
      onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-lg border border-[#D9E7E7] bg-white p-5 shadow-xl backdrop:bg-black/40 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 id="kapon-promo-title" className="text-xl font-semibold text-[#20343B]">{editing ? "Edit Promo" : "Schedule Low-Cost Kapon"}</h2>
        <button type="button" onClick={onClose} disabled={saving} aria-label="Close promotion form" title="Close" className="p-1 text-[#607277] disabled:opacity-50"><X size={20} /></button>
      </div>
      <p className="mt-3 text-sm text-[#607277]">Choose when the promotion will start and end. Schedule it at least 24 hours in advance so customers have time to prepare.</p>
      <form noValidate onSubmit={submit} className="mt-5 space-y-4">
        <fieldset disabled={saving} className="space-y-4">
          <label className="block text-sm font-medium text-[#425A60]">
            Google Form Registration Link <span className="text-[#B23949]">*</span>
            <input autoFocus required type="url" value={form.formLink} onChange={updateField("formLink")} maxLength={2048} placeholder="https://forms.gle/..." className={`mt-2 ${inputClass}`} />
          </label>
          <label className="block text-sm font-medium text-[#425A60]">
            Promotion Title
            <input value={form.title} onChange={updateField("title")} maxLength={100} className={`mt-2 ${inputClass}`} />
          </label>
          <label className="block text-sm font-medium text-[#425A60]">
            Promotion Description (Optional)
            <textarea value={form.description} onChange={updateField("description")} maxLength={1000} rows={3} className={`mt-2 resize-y ${inputClass}`} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <PromoScheduleFields min={editing && form.startsAt === localDateTime(initialPromo?.startsAt) ? "" : localDateTime(trustedNow() + PROMO_NOTICE_MS)} label="Promotion Start" value={form.startsAt} onChange={(value) => { setForm((current) => ({ ...current, startsAt: value })); setError(""); }} inputClass={inputClass} />
            <PromoScheduleFields min={form.startsAt ? localDateTime(Date.parse(`${form.startsAt}:00+08:00`) + 60000) : ""} label="Promotion End" value={form.endsAt} onChange={(value) => { setForm((current) => ({ ...current, endsAt: value })); setError(""); }} inputClass={inputClass} />
          </div>
          <p className="text-xs leading-5 text-[#607277]">Times use Philippine time (Asia/Manila). Start and end are required. Use 15-minute intervals; the end must be later than the start.</p>
        </fieldset>
        {error && <p role="alert" className="text-sm text-[#B23949]">{error}</p>}
        <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-[#D9E7E7] px-4 py-2.5 text-sm font-semibold text-[#24444A] disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={saving || !serverClock} className="rounded-lg bg-[#173E44] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving..." : editing ? "Save changes" : "Schedule Promotion"}</button>
        </div>
      </form>
    </dialog>, document.body,
  );
}

export function KaponPromoManager() {
  const { kaponPromo, kaponPromoReady, kaponPromoError, manageKaponPromo } = useApp();
  const toast = useToast();
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const active = kaponPromo?.isActive === true;
  const status = getPromoStatus(kaponPromo);
  const deactivate = async () => {
    if (saving || !window.confirm("Are you sure you would like to deactivate the Low-Cost Kapon promotion? New bookings and registration will become unavailable.")) return;
    setSaving(true);
    try {
      await manageKaponPromo({ action: "deactivate", expectedRevision: kaponPromo?.revision || 0 });
      toast.success("Low-Cost Kapon promotion deactivated.");
    } catch (error) { toast.error(error.message); }
    finally { setSaving(false); }
  };
  return (
    <section className="border-y border-[#D9E7E7] bg-[#F8FCFC] px-5 py-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-xl font-semibold text-[#20343B]">Low-Cost Kapon Promo</h3>
          <p className="mt-2 text-sm text-[#607277]" role="status">{kaponPromoError || (!kaponPromoReady ? "Loading promotion..." : `Low-Cost Kapon: ${status}`)}</p>
          {active && <p className="mt-2 text-sm text-[#607277]">{localDateTime(kaponPromo.startsAt).replace("T", " ")} to {localDateTime(kaponPromo.endsAt).replace("T", " ")} (Philippine time). Email announcements are disabled pending consent approval.</p>}
          {active && kaponPromo.formLink && <a href={kaponPromo.formLink} target="_blank" rel="noopener noreferrer" className="mt-2 block break-all text-sm text-[#2D6B73] underline">{kaponPromo.formLink}</a>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {active ? <>
            <button type="button" onClick={() => setModal({ ...kaponPromo })} disabled={!kaponPromoReady || saving} className="inline-flex items-center gap-2 rounded-lg border border-[#D9E7E7] bg-white px-4 py-2.5 text-sm font-semibold text-[#24444A] disabled:opacity-50"><Pencil size={16} />Edit Promo</button>
            <button type="button" onClick={deactivate} disabled={!kaponPromoReady || saving} className="inline-flex items-center gap-2 rounded-lg bg-[#FBECEF] px-4 py-2.5 text-sm font-semibold text-[#B23949] disabled:opacity-50"><Power size={16} />{saving ? "Deactivating..." : "Deactivate"}</button>
          </> : <button type="button" onClick={() => setModal({ ...(kaponPromo || {}) })} disabled={!kaponPromoReady || saving} className="inline-flex items-center gap-2 rounded-lg bg-[#173E44] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Power size={16} />Schedule Low-Cost Kapon</button>}
        </div>
      </div>
      {modal && <PromoFormDialog initialPromo={modal} onClose={() => setModal(null)} onSave={async (payload) => {
        await manageKaponPromo(payload);
        toast.success(payload.action === "edit" ? "Promotion updated." : "Low-Cost Kapon has been scheduled successfully.");
      }} />}
    </section>
  );
}
