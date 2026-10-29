export const REQUIRED_VACCINATION_FEE = {id:"doctors-fee",name:"Doctor's Fee",required:true};
export function dewormingForPet(pet){
 const weight=Number(pet?.weightKg);
 const weightKg=Number.isFinite(weight)&&weight>0?weight:null;
 const weightBracket=weightKg===null?"Weight not saved":weightKg<=10?"1–10 kg":weightKg<=20?"11–20 kg":weightKg<=30?"21–30 kg":weightKg<=40?"31–40 kg":"Over 40 kg — clinic assessment required";
 return {weightKg,weightBracket};
}
export function dewormingDescription(details){
 return details?`Deworming (${details.weightKg===null?details.weightBracket:`${details.weightKg} kg | ${details.weightBracket}`})`:"Deworming (Weight not saved)";
}

export function formatAppointmentService(value = "") {
 return typeof value === "string" ? value.replace(/\s+[?·]\s+/g, " | ") : "";
}
