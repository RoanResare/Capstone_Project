export const PRICELIST_CATEGORIES = [{id:"vaccination",name:"Vaccination"},{id:"deworming",name:"Deworming"},{id:"consultation",name:"Consultation"},{id:"laboratory-testing",name:"Laboratory Testing"},{id:"pet-grooming",name:"Pet Grooming"}];
export const MAX_PRICELIST_BYTES = 5 * 1024 * 1024;
export function validatePricelistFile(file) {
 if (!file || !["image/jpeg","image/png","image/webp"].includes(file.type)) throw new Error("Choose a JPG, PNG, or WebP image.");
 if (!file.size || file.size > MAX_PRICELIST_BYTES) throw new Error("Choose a nonempty image up to 5 MB.");
}