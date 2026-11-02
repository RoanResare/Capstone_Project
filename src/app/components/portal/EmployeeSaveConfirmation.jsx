import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function EmployeeSaveConfirmation({ pendingSave, isSaving, onCancel, onConfirm }) {
  const dialogRef = useRef(null);
  const mode = pendingSave.mode;
  const isEmployeeSave = ["create", "update"].includes(mode);
  const account = pendingSave.fullPayload;
  const changeLabels = { name: "Name", email: "Email", username: "Username", role: "Role" };
  const changedFields = isEmployeeSave
    ? Object.keys(pendingSave.payload || {}).filter(field => changeLabels[field])
    : [];

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => { dialog.close(); document.body.style.overflow = previousOverflow; };
  }, []);

  const rows = isEmployeeSave
    ? changedFields.map(field => [changeLabels[field], field === "role" ? (account.role === "admin" ? "Admin" : "Staff") : account[field]])
    : [["Name", account.name], ["Email", account.email], ["Username", account.username], ["Role", account.role === "admin" ? "Admin" : "Staff"]];
  if (mode === "status") rows.push(["Status", pendingSave.status]);

  return createPortal(
    <dialog ref={dialogRef} aria-labelledby="save-employee-title"
      onCancel={event => { event.preventDefault(); if (!isSaving) onCancel(); }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-lg border border-[#BFE1E1] bg-[#F8FCFC] p-5 shadow-xl backdrop:bg-black/40 sm:p-5">
      <h4 id="save-employee-title" className="text-xl font-semibold text-[#20343B]">
        {isEmployeeSave ? "Confirm Employee Changes" : mode === "delete" ? "Confirm permanent deletion" : "Confirm status change"}
      </h4>
      <p className="mt-2 text-sm text-[#607277]">
        {isEmployeeSave ? "Review the changes before saving." : mode === "delete" ? "Review the employee account before deleting it." : "Review the status change before confirming."}
      </p>
      {isEmployeeSave && <p className="mt-2 text-sm font-medium text-[#425A60]">Employee: {pendingSave.employeeName || account.name} · {pendingSave.employeeEmail || account.email}</p>}
      <form onSubmit={event => { event.preventDefault(); if (!isSaving) onConfirm(); }} className="mt-4 space-y-4">
        <dl className="grid gap-3 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-[80px_minmax(0,1fr)] gap-4">
              <dt className="font-semibold text-[#607277]">{label}</dt>
              <dd className="break-words text-right font-semibold text-[#20343B]">{value}</dd>
            </div>))}
        </dl>
        {isEmployeeSave && account.password && <p className="text-sm font-semibold text-[#2D6B73]">Password will be updated</p>}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={isSaving} className="rounded-lg border border-[#D9E7E7] bg-white px-4 py-2.5 text-sm font-semibold text-[#24444A]">Cancel</button>
          <button type="submit" disabled={isSaving} className="rounded-lg bg-[#173E44] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
            {isSaving ? "Saving..." : isEmployeeSave ? "Confirm Changes" : mode === "delete" ? "Delete account" : "Save changes"}
          </button>
        </div>
      </form>
    </dialog>, document.body);
}
