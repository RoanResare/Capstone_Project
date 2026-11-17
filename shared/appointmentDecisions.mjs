export const OTHER_REASON_MIN_LENGTH = 10;
export const OTHER_REASON_MAX_LENGTH = 1000;
export const APPOINTMENT_REASON_GROUPS = [
 {id:"A",name:"Staffing and Clinic Capacity",reasons:[
  "Insufficient veterinary staff or personnel availability.",
  "Required veterinarian or specialist is unavailable.",
  "Temporary clinic closure or unexpected operational limitations.",
 ]},
 {id:"B",name:"Pet Health and Medical Suitability",reasons:[
  "The pet's age, health status, or other disclosed medical information may make the requested surgery or procedure medically unsuitable at this time.",
  "The clinic cannot safely perform the requested procedure because of the pet's disclosed medical risks or special care requirements.",
 ]},
 {id:"C",name:"Other",reasons:[]},
];
export function validateAppointmentDecision(input) {
 const group=APPOINTMENT_REASON_GROUPS.find(group=>group.id===input?.category);
 if(!group)throw new Error("Choose a reason category.");
 if(group.id!=="C") {
  if(!group.reasons.includes(input?.reason))throw new Error("Choose an approved reason in the selected category.");
  return {category:group.id,reason:input.reason};
 }
 const reason=typeof input?.reason==="string"?input.reason.trim():"";
 if(reason.length<OTHER_REASON_MIN_LENGTH||reason.length>OTHER_REASON_MAX_LENGTH||!/[\p{L}\p{N}]/u.test(reason))throw new Error(`Enter a meaningful explanation of ${OTHER_REASON_MIN_LENGTH}–${OTHER_REASON_MAX_LENGTH} characters.`);
 return {category:"C",reason};
}
