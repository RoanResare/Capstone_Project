import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function AppointmentApprovalDialog({ appointment, busy, onConfirm, onClose }) {
  const dialogRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = busy || saving;

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  async function confirm(event) {
    event.preventDefault();
    if (pending) return;
    setSaving(true);
    setError("");
    try {
      const result = await onConfirm();
      if (result === false) throw new Error("Unable to approve the appointment. Please try again.");
      onClose();
    } catch (error) {
      setError(error.message || "Unable to approve the appointment. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <dialog ref={dialogRef} aria-labelledby="appointment-approval-title" aria-describedby="appointment-approval-description"
      onCancel={event => { event.preventDefault(); if (!pending) onClose(); }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-[#D9E7E7] bg-white p-6 shadow-xl backdrop:bg-black/40">
      <form onSubmit={confirm} className="space-y-5">
        <h3 id="appointment-approval-title" className="text-xl font-semibold text-[#173E44]">Approve appointment</h3>
        <p id="appointment-approval-description" className="text-sm text-[#607277]">Are you sure you would like to approve this appointment? The customer will be notified of this change.</p>
        <div className="space-y-2 rounded-2xl bg-[#F6FAFA] p-4 text-sm text-[#365057]">
          <p className="font-semibold">{appointment.petName} | {appointment.service}</p>
          <p>Assigned staff: {appointment.assignedStaff}</p>
        </div>
        {error && <p role="alert" className="text-sm text-[#B23949]">{error}</p>}
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" autoFocus disabled={pending} onClick={onClose} className="rounded-xl border border-[#D9E7E7] px-4 py-3 text-sm disabled:opacity-50">Back</button>
          <button type="submit" disabled={pending || !appointment.assignedStaff?.trim()} className="rounded-xl bg-[#1D7C45] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Approving..." : "Confirm approval"}</button>
        </div>
      </form>
    </dialog>, document.body,
  );
}
