import {REQUIRED_VACCINATION_FEE,dewormingDescription,dewormingForPet} from "../../../shared/bookingAdditions.mjs";
export function BookingAdditions({appointment}){
 const ids=appointment.serviceIds || [appointment.serviceId];
 return <>
  {ids.includes("vaccination")&&<p className="mt-2 text-sm">{REQUIRED_VACCINATION_FEE.name} — required with vaccination</p>}
 </>;
}
