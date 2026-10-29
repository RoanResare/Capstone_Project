import {useState} from "react";
import {APPOINTMENT_REASON_GROUPS,OTHER_REASON_MIN_LENGTH,OTHER_REASON_MAX_LENGTH,validateAppointmentDecision} from "../../../../shared/appointmentDecisions.mjs";
export function AppointmentDecisionForm({busy,onSave,onClose,status="Rejected"}) {
 const [category,setCategory]=useState(""),[reason,setReason]=useState(""),[error,setError]=useState("");
 const group=APPOINTMENT_REASON_GROUPS.find(group=>group.id===category);
 async function submit(event){
  event.preventDefault();setError("");
  try {
   const decision=validateAppointmentDecision({category,reason});
   const result=await onSave({status,decision});
   if(result===false)throw new Error("Unable to save the appointment decision. Please try again.");
   onClose();
  }catch(error){setError(error.message);}
 }
 return <form onSubmit={submit} className="space-y-4">
  <h3 className="text-xl font-semibold text-[#173E44]">{status==="Cancelled"?"Cancel appointment":"Reject appointment"}</h3>
  <label className="block text-sm font-medium">Reason category
   <select aria-label="Reason category" value={category} disabled={busy} onChange={event=>{setCategory(event.target.value);setReason("");setError("");}} className="mt-2 w-full rounded-xl border border-[#D9E7E7] bg-white p-3">
    <option value="">Choose a category</option>
    {APPOINTMENT_REASON_GROUPS.map(group=><option key={group.id} value={group.id} disabled={!!category&&category!==group.id}>{group.id}. {group.name}</option>)}
   </select>
  </label>
  {category&&<button type="button" disabled={busy} onClick={()=>{setCategory("");setReason("");setError("");}} className="text-sm text-[#173E44] underline">Change category</button>}
  {group?.reasons.length>0&&<fieldset className="space-y-3"><legend className="mb-2 text-sm font-semibold">Choose a reason</legend>{group.reasons.map(option=><label key={option} className="flex items-start gap-3 rounded-xl border border-[#D9E7E7] p-3 text-sm"><input type="radio" name="appointment-decision-reason" checked={reason===option} disabled={busy} onChange={()=>setReason(option)} className="mt-1 accent-[#173E44]"/><span>{option}</span></label>)}</fieldset>}
  {category==="C"&&<label className="block text-sm font-medium">Explanation
   <textarea aria-label="Explanation" value={reason} disabled={busy} minLength={OTHER_REASON_MIN_LENGTH} maxLength={OTHER_REASON_MAX_LENGTH} required rows={5} onChange={event=>setReason(event.target.value)} className="mt-2 w-full rounded-xl border border-[#D9E7E7] p-3"/>
   <span className="mt-1 block text-xs text-[#607277]">{OTHER_REASON_MIN_LENGTH}–{OTHER_REASON_MAX_LENGTH} characters. Explain the reason clearly.</span>
  </label>}
  {error&&<p role="alert" className="text-sm text-[#B23949]">{error}</p>}
  <div className="flex justify-end gap-3"><button type="button" disabled={busy} onClick={onClose} className="rounded-xl border border-[#D9E7E7] px-4 py-3">Back</button><button type="submit" disabled={busy||!category} className="rounded-xl bg-[#173E44] px-4 py-3 font-semibold text-white disabled:opacity-50">{busy?"Saving...":status==="Cancelled"?"Confirm cancellation":"Confirm rejection"}</button></div>
 </form>;
}
