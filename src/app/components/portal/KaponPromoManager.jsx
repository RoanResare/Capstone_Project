import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, Power, X } from "lucide-react";
import { useApp } from "../../context/AppContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { normalizePromoInput, validatePromoStart } from "../../../../shared/lowCostKaponPromo.mjs";
import { getTextValidationErrors, PROMO_TEXT_FIELDS } from "../../../../shared/textModeration.mjs";

function localDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date).replace(" ", "T");
}

function PromoScheduleFields({ label, value, onChange, inputClass, min = "" }) {
  const [date = "", time = "09:00"] = value.split("T");
  const times = Array.from({ length: 96 }, (_, index) => `${String(Math.floor(index / 4)).padStart(2, "0")}:${String(index % 4 * 15).padStart(2, "0")}`);
  if (!times.includes(time)) times.push(time);
  times.sort();
  return <fieldset className="min-w-0 rounded-xl border border-[#D9E7E7] bg-[#F8FCFC] p-3">
    <legend className="px-1 text-sm font-medium text-[#425A60]">{label} (optional)</legend>
    <div className="grid gap-3">
      <label className="text-xs text-[#607277]">Date
        <input type="date" min={min.slice(0, 10) || undefined} value={date} onChange={(event) => onChange(event.target.value ? `${event.target.value}T${time}` : "")} className={`mt-1 min-w-0 ${inputClass}`} />
      </label>
      <label className="text-xs text-[#607277]">Time
        <select value={time} disabled={!date} onChange={(event) => onChange(`${date}T${event.target.value}`)} className={`mt-1 ${inputClass}`}>
          {times.map((slot) => <option key={slot} value={slot} disabled={Boolean(min && `${date}T${slot}` < min)}>{new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" }).format(new Date(`2000-01-01T${slot}:00+08:00`))}</option>)}
        </select>
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
    startsAt: localDateTime(initialPromo?.startsAt),
    endsAt: localDateTime(initialPromo?.endsAt),
  });
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
      const payload = normalizePromoInput({ ...form, startsAt: form.startsAt ? `${form.startsAt}:00+08:00` : "", endsAt: form.endsAt ? `${form.endsAt}:00+08:00` : "" });
      validatePromoStart(payload.startsAt, { previousStartsAt: editing ? initialPromo?.startsAt : null });
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
        <h2 id="kapon-promo-title" className="text-xl font-semibold text-[#20343B]">{editing ? "Edit Promo" : "Activate Low-Cost Kapon"}</h2>
        <button type="button" onClick={onClose} disabled={saving} aria-label="Close promotion form" title="Close" className="p-1 text-[#607277] disabled:opacity-50"><X size={20} /></button>
      </div>
      <form noValidate onSubmit={submit} className="mt-5 space-y-4">
        <fieldset disabled={saving} className="space-y-4">
          <label className="block text-sm font-medium text-[#425A60]">
            Google Form Registration Link <span className="text-[#B23949]">*</span>
            <input autoFocus required type="url" value={form.formLink} onChange={updateField("formLink")} maxLength={2048} placeholder="https://forms.gle/..." className={`mt-2 ${inputClass}`} />
          </label>
          <label className="block text-sm font-medium text-[#425A60]">
            Promo Title
            <input value={form.title} onChange={updateField("title")} maxLength={100} className={`mt-2 ${inputClass}`} />
          </label>
          <label className="block text-sm font-medium text-[#425A60]">
            Promo Description (optional)
            <textarea value={form.description} onChange={updateField("description")} maxLength={1000} rows={3} className={`mt-2 resize-y ${inputClass}`} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <PromoScheduleFields min={editing && form.startsAt === localDateTime(initialPromo?.startsAt) ? "" : localDateTime(new Date())} label="Start" value={form.startsAt} onChange={(value) => { setForm((current) => ({ ...current, startsAt: value })); setError(""); }} inputClass={inputClass} />
            <PromoScheduleFields label="End" value={form.endsAt} onChange={(value) => { setForm((current) => ({ ...current, endsAt: value })); setError(""); }} inputClass={inputClass} />
          </div>
          <p className="text-xs leading-5 text-[#607277]">Times use Philippine time. Leave the start blank to activate immediately, or the end blank for no scheduled expiry.</p>
        </fieldset>
        {error && <p role="alert" className="text-sm text-[#B23949]">{error}</p>}
        <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-[#D9E7E7] px-4 py-2.5 text-sm font-semibold text-[#24444A] disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-lg bg-[#173E44] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving..." : editing ? "Save changes" : "Activate Promo"}</button>
        </div>
      </form>
    </dialog>, document.body,
  );
}

export function KaponPromoManager() {
  const { kaponPromo, kaponPromoReady, kaponPromoAvailable, kaponPromoError, manageKaponPromo } = useApp();
  const toast = useToast();
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const active = kaponPromo?.isActive === true;
  const status = active ? kaponPromoAvailable ? "Active" : "Outside promotion dates" : "Inactive";
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
          {active && kaponPromo.formLink && <a href={kaponPromo.formLink} target="_blank" rel="noopener noreferrer" className="mt-2 block break-all text-sm text-[#2D6B73] underline">{kaponPromo.formLink}</a>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {active ? <>
            <button type="button" onClick={() => setModal({ ...kaponPromo })} disabled={!kaponPromoReady || saving} className="inline-flex items-center gap-2 rounded-lg border border-[#D9E7E7] bg-white px-4 py-2.5 text-sm font-semibold text-[#24444A] disabled:opacity-50"><Pencil size={16} />Edit Promo</button>
            <button type="button" onClick={deactivate} disabled={!kaponPromoReady || saving} className="inline-flex items-center gap-2 rounded-lg bg-[#FBECEF] px-4 py-2.5 text-sm font-semibold text-[#B23949] disabled:opacity-50"><Power size={16} />{saving ? "Deactivating..." : "Deactivate"}</button>
          </> : <button type="button" onClick={() => setModal({ ...(kaponPromo || {}) })} disabled={!kaponPromoReady || saving} className="inline-flex items-center gap-2 rounded-lg bg-[#173E44] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Power size={16} />Activate Low-Cost Kapon</button>}
        </div>
      </div>
      {modal && <PromoFormDialog initialPromo={modal} onClose={() => setModal(null)} onSave={async (payload) => {
        await manageKaponPromo(payload);
        toast.success(payload.action === "edit" ? "Promotion updated." : "Low-Cost Kapon promotion activated.");
      }} />}
    </section>
  );
}
