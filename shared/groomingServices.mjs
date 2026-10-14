export const GROOMING_SIZES = ["Small", "Medium", "Large", "X-Large"];
export function groomingSizeForPet(pet) {
  if (String(pet?.petType).toLowerCase() === "cat") return null;
  const weight = Number(pet?.weightKg);
  if (!Number.isFinite(weight) || weight < 1) return "";
  return weight <= 6 ? "Small" : weight <= 12 ? "Medium" : weight <= 21 ? "Large" : "X-Large";
}
export const GROOMING_SERVICES = [
  { id: "basic", name: "Basic", prices: [300, 350, 400, 450], petType: "Dog" },
  { id: "bath-blowdry", name: "Bath & Blowdry", prices: [250, 300, 350, 400], petType: "Dog" },
  { id: "sanitary", name: "Sanitary", prices: [350, 400, 500, 550], petType: "Dog" },
  { id: "full-groom", name: "Full Groom", prices: [400, 500, 600, 700], petType: "Dog" },
  { id: "puppy-cut", name: "Puppy Cut", prices: [450, 550, 650, 750], petType: "Dog" },
  { id: "feline-basic", name: "Feline Basic Groom", price: 500, petType: "Cat" },
  { id: "feline-sanitary", name: "Feline Sanitary Groom", price: 600, petType: "Cat" },
];

export function groomingQuote(serviceId, size, petType) {
  const service = GROOMING_SERVICES.find((entry) => entry.id === serviceId);
  if (!service || service.petType.toLowerCase() !== String(petType).toLowerCase()) throw new Error("Choose a grooming service for the selected pet type.");
  const price = service.price ?? service.prices[GROOMING_SIZES.indexOf(size)];
  if (price === undefined) throw new Error("Choose the pet's grooming size category.");
  return { serviceId: service.id, name: service.name, size: service.price !== undefined ? null : size, price };
}
