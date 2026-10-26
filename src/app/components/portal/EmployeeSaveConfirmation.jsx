import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, EyeOff } from "lucide-react";

export function EmployeeSaveConfirmation({ pendingSave, isSaving, onCancel, onConfirm, error, onNewPasswordChange }) {
  const dialogRef = useRef(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const mode = pendingSave.mode;
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => { dialog.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  const account = pendingSave.fullPayload;
  return createPortal(
    <dialog ref={dialogRef} aria-labelledby="save-employee-title"
      onCancel={event => { event.preventDefault(); if (!isSaving) onCancel(); }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-lg border border-[#BFE1E1] bg-[#F8FCFC] p-5 shadow-xl backdrop:bg-black/40 sm:p-5">
      <h4 id="save-employee-title" className="text-xl font-semibold text-[#20343B]">
        {mode === "delete" ? "Confirm permanent deletion" : mode === "status" ? "Confirm status change" : "Confirm employee changes"}
      </h4>
      <p className="mt-2 text-sm text-[#607277]">Enter your own current password to authorize this employee account {mode === "delete" ? "deletion" : "change"}.</p>
      <form onSubmit={event => { event.preventDefault(); if (!isSaving && currentPassword) onConfirm(currentPassword); }} className="mt-4 space-y-4">
        <dl className="grid gap-3 text-sm">
          {[["Name", account.name], ["Email", account.email], ["Username", account.username],
            ["Role", account.role === "admin" ? "Admin" : "Staff"],
            ...(mode === "status" ? [["Status", pendingSave.status]] : [])].map(([label, value]) => (
              <div key={label} className="grid grid-cols-[80px_minmax(0,1fr)] gap-4">
                <dt className="font-semibold text-[#607277]">{label}</dt><dd className="break-words text-right font-semibold text-[#20343B]">{value}</dd>
              </div>))}
        </dl>
        {["create", "update"].includes(mode) && <label className="block text-sm font-medium text-[#425A60]">
          {mode === "create" ? "Password" : "New password"}
          <input type="password" autoComplete="new-password" value={account.password || ""}
            onChange={event => onNewPasswordChange(event.target.value)} disabled={isSaving}
            placeholder={mode === "create" ? "Set an employee password" : "Leave blank to keep the current password"}
            className="mt-2 w-full rounded-lg border border-[#D9E7E7] bg-white px-4 py-2.5 text-sm" />
        </label>}
        <label className="block text-sm font-medium text-[#425A60]">Your current password
          <div className="relative mt-2">
            <input autoFocus required type={showCurrentPassword ? "text" : "password"} autoComplete="current-password" value={currentPassword}
              onChange={event => setCurrentPassword(event.target.value)} disabled={isSaving}
              className="w-full rounded-lg border border-[#D9E7E7] bg-white px-4 py-2.5 pr-11 text-sm" />
            <button type="button" aria-label={showCurrentPassword ? "Hide current password" : "Show current password"}
              onClick={() => setShowCurrentPassword(value => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#607277]">
              {showCurrentPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </label>
        {error && <p role="alert" className="rounded-lg bg-[#FBECEF] px-4 py-3 text-sm text-[#B23949]">{error}</p>}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={isSaving} className="rounded-lg border border-[#D9E7E7] bg-white px-4 py-2.5 text-sm font-semibold text-[#24444A]">Cancel</button>
          <button type="submit" disabled={isSaving || !currentPassword} className="rounded-lg bg-[#173E44] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
            {isSaving ? "Saving..." : mode === "delete" ? "Delete account" : "Save changes"}
          </button>
        </div>
      </form>
    </dialog>, document.body);
}
