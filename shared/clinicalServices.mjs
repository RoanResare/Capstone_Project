import {REQUIRED_VACCINATION_FEE} from "./bookingAdditions.mjs";
const both=["cat","dog"];
const option=(id,name,species=both)=>({id,name,species});
export const CLINICAL_SERVICES={
 consultation:[
  option("consultation","Consultation"),option("wound-cleaning","Wound Cleaning"),option("wound-repair","Wound Repair"),
  option("ultrasound","Ultrasound"),option("fecalysis","Fecalysis"),option("skin-scraping","Skin Scraping"),
  option("vaginal-smear","Vaginal Smear Test"),option("earmite-test","Earmite Test"),option("urine-microscopic","Urine Microscopic Analysis"),
  option("urinalysis","Urinalysis"),option("urinalysis-sensitivity","Urinalysis + Sensitivity"),option("parvo","Parvo"),
  option("distemper","Distemper"),option("blood-parasite","4-Way Blood Parasite"),option("heartworm","Heartworm"),
  option("ehrlichia","Ehrlichia"),option("hematoma-draining","Hematoma Draining"),
 ],
 vaccination:[option("4-in-1","4 in 1 Vaccine",["cat"]),option("5-in-1","5 in 1 Vaccine",["dog"]),option("6-in-1","6 in 1 Vaccine",["dog"]),option("8-in-1","8 in 1 Vaccine",["dog"]),option("kennel-cough","Kennel Cough Vaccine",["dog"]),option("anti-rabies","Anti Rabies Vaccine")],
 "laboratory-testing":[option("cbc-plain","CBC Plain"),{...option("cbc-basic-chemistry","CBC Basic Chemistry"),description:"Complete Blood Count, BUN, CREA, ALT (SGPT), Glucose, ALK Phos"},{...option("comprehensive-chem","Comprehensive Chem"),description:"Complete Blood Count, Calcium, Glucose, Phosphorus, Total Protein, Globulin, Total Bilirubin, Cholesterol, BUN, CREA, SGPT, SGOT, ALK"}],
};
export function clinicalOptions(category,pet){return (CLINICAL_SERVICES[category]||[]).filter(option=>option.species.includes(String(pet?.petType||"").trim().toLowerCase()));}
export function buildClinicalSelections(serviceIds,choices,pet){
 return serviceIds.filter(id=>Object.hasOwn(CLINICAL_SERVICES,id)).map(category=>{
  const selected=clinicalOptions(category,pet).find(option=>option.id===choices?.[category]);
  if(!selected)throw new Error(`Choose one ${category.replaceAll("-"," ")} service for the saved cat or dog profile.`);
  return [{category,serviceId:selected.id,name:selected.name},...(category==="vaccination"?[{category,serviceId:REQUIRED_VACCINATION_FEE.id,name:REQUIRED_VACCINATION_FEE.name,required:true}]:[])];
 }).flat();
}
