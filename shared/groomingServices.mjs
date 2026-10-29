export const GROOMING_SIZES = ["Small", "Medium", "Large", "X-Large"];
export const MAX_GROOMING_SELECTIONS = 2;
export function groomingSizeForPet(pet) {
  if (String(pet?.petType).toLowerCase() === "cat") return null;
  const weight = Number(pet?.weightKg);
  if (!Number.isFinite(weight) || weight < 1) return "";
  return weight <= 6 ? "Small" : weight <= 12 ? "Medium" : weight <= 21 ? "Large" : "X-Large";
}
export const GROOMING_SERVICES = [
  { id: "basic", name: "Basic", petType: "Dog" },
  { id: "bath-blowdry", name: "Bath & Blowdry", petType: "Dog" },
  { id: "sanitary", name: "Sanitary", petType: "Dog" },
  { id: "full-groom", name: "Full Groom", petType: "Dog" },
  { id: "puppy-cut", name: "Puppy Cut", petType: "Dog" },
  { id: "feline-basic", name: "Basic Grooming", petType: "Cat" },
  { id: "feline-sanitary", name: "Sanitary Grooming", petType: "Cat" },
  { id: "feline-full", name: "Full Grooming", petType: "Cat" },
];
export const GROOMING_ALA_CARTE_SERVICES = [
  {id:"nail-clipping",name:"Nail Clipping"},
  {id:"ear-cleaning",name:"Ear Cleaning"},
  {id:"anal-sac-expression",name:"Anal Sac Expression"},
  {id:"face-trim",name:"Face Trim"},
  {id:"paw-pad-trim",name:"Paw Pad Trim"},
  {id:"poodle-feet",name:"Poodle Feet"},
  {id:"tummy-butt-trim",name:"Tummy & Butt Trim"},
  {id:"wound-cleaning",name:"Wound Cleaning"},
  {id:"toothbrush",name:"Toothbrush"},
];
export function groomingOptionsForPet(pet) {
 const type=String(pet?.petType||"").trim().toLowerCase();
 if(!["cat","dog"].includes(type))return {packages:[],alaCarte:[]};
 return {packages:GROOMING_SERVICES.filter(service=>service.petType.toLowerCase()===type),alaCarte:GROOMING_ALA_CARTE_SERVICES};
}
export function buildGroomingSelection(serviceIds,pet) {
 if(!Array.isArray(serviceIds)||!serviceIds.length||serviceIds.length>MAX_GROOMING_SELECTIONS)throw new Error("Choose one grooming service or up to two a la carte services for this appointment.");
 if(new Set(serviceIds).size!==serviceIds.length)throw new Error("Choose each grooming service only once.");
 const {packages,alaCarte}=groomingOptionsForPet(pet);
 const services=serviceIds.map(id=>{
  const entry=packages.find(service=>service.id===id)||alaCarte.find(service=>service.id===id);
  if(!entry)throw new Error("Choose grooming services offered for the saved pet's species (cat or dog).");
  return {id:entry.id,name:entry.name,category:packages.includes(entry)?"package":"ala-carte"};
 });
 if(services.some(service=>service.category==="package")&&services.length!==1)throw new Error("Choose one grooming package OR up to two a la carte services, not both.");
 return {serviceIds:[...serviceIds],services,name:services.map(service=>service.name).join(", "),petType:packages[0].petType,size:groomingSizeForPet(pet)||null};
}
// Legacy saved appointments have a single serviceId/name rather than services.
export function groomingDescription(grooming) {
 return Array.isArray(grooming?.services)?grooming.services.map(service=>service.name).filter(Boolean).join(", "):grooming?.name||"";
}
