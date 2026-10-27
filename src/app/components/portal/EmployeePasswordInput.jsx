import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export function EmployeePasswordInput({ id, value = "", onChange, disabled = false, required = false, autoFocus = false }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="w-full min-w-0">
      <label htmlFor={id} className="block text-sm font-medium text-[#425A60]">New password</label>
      <div className="relative mt-2 w-full">
        <input id={id} autoFocus={autoFocus} required={required} type={visible ? "text" : "password"}
          autoComplete="new-password" value={value} onChange={event => onChange(event.target.value)} disabled={disabled}
          placeholder={required ? "Set an employee password" : "Leave blank to keep the current password"}
          className="block w-full min-w-0 rounded-lg border border-[#D9E7E7] bg-white py-2.5 pl-4 pr-12 text-sm" />
        <button type="button" aria-label={visible ? "Hide new password" : "Show new password"}
          aria-controls={id} aria-pressed={visible} disabled={disabled}
          onClick={() => setVisible(current => !current)}
          className="absolute inset-y-0 right-0 flex w-11 cursor-pointer items-center justify-center rounded-r-lg text-[#607277] focus-visible:outline-2 focus-visible:outline-[#2D9B9B] disabled:cursor-not-allowed disabled:opacity-60">
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </div>
  );
}
