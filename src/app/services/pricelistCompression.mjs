import {MAX_PRICELIST_DATA_URL_BYTES,validatePricelistFile} from "../../../shared/pricelists.mjs";
function readDataUrl(blob) {
 return new Promise((resolve,reject)=>{
  const reader=new FileReader();reader.onload=()=>resolve(reader.result);
  reader.onerror=()=>reject(new Error("Unable to read image."));reader.readAsDataURL(blob);
 });
}
export async function compressPricelist(file) {
 validatePricelistFile(file);
 const url=URL.createObjectURL(file),image=new Image();
 try {
  await new Promise((resolve,reject)=>{
   image.onload=()=>image.naturalWidth&&image.naturalHeight?resolve():reject(new Error("The image is empty."));
   image.onerror=()=>reject(new Error("This image could not be opened. Choose another file."));image.src=url;
  });
  if(image.naturalWidth*image.naturalHeight>40_000_000)throw new Error("This image has too many pixels. Export a smaller image and try again.");
  const original=await readDataUrl(file);
  if(original.length<=MAX_PRICELIST_DATA_URL_BYTES)return original;
  const canvas=document.createElement("canvas"),context=canvas.getContext("2d");
  if(!context)throw new Error("Image optimization is unavailable in this browser.");
  const longest=Math.max(image.naturalWidth,image.naturalHeight);
  const minimum=Math.min(longest,1600);
  for(let edge=Math.min(longest,4096);;edge=Math.max(minimum,Math.floor(edge*0.85))) {
   const scale=edge/longest;
   canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
   context.fillStyle="#fff";context.fillRect(0,0,canvas.width,canvas.height);
   context.imageSmoothingEnabled=true;context.imageSmoothingQuality="high";
   context.drawImage(image,0,0,canvas.width,canvas.height);
   // Try lossless and high quality encodings before reducing text resolution.
   for(const [type,quality] of [["image/png",1],["image/webp",0.95],["image/jpeg",0.95],["image/webp",0.88],["image/jpeg",0.88],["image/webp",0.82],["image/jpeg",0.82]]) {
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,type,quality));
    if(!blob||4*Math.ceil(blob.size/3)+32>MAX_PRICELIST_DATA_URL_BYTES)continue;
    const dataUrl=await readDataUrl(blob);
    if(dataUrl.length<=MAX_PRICELIST_DATA_URL_BYTES)return dataUrl;
   }
   if(edge===minimum)break;
  }
  throw new Error("This image cannot be optimized enough while preserving text detail. Crop unnecessary borders or export a simpler pricelist image and try again.");
 } finally { URL.revokeObjectURL(url); }
}
