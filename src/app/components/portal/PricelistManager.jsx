import {useEffect,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {ShieldCheck,Syringe,Stethoscope,FlaskConical,Scissors} from "lucide-react";
import {useAuth} from "../../context/AuthContext.jsx";
import {usePricelists,PricelistPreview} from "../PricelistImage.jsx";
import {savePricelist} from "../../services/pricelists.js";
import {PRICELIST_CATEGORIES,validatePricelistFile} from "../../../../shared/pricelists.mjs";

const icons=[ShieldCheck,Syringe,Stethoscope,FlaskConical,Scissors];
const button="rounded-xl bg-[#173E44] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50";
function Modal({title,children,onClose,busy}) {
 const ref=useRef(null);
 useEffect(()=>{const dialog=ref.current;dialog.showModal();return ()=>dialog.close();},[]);
 return createPortal(<dialog ref={ref} aria-labelledby="pricelist-dialog-title" onCancel={event=>{event.preventDefault();if(!busy)onClose();}} className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl bg-white p-6 shadow-xl backdrop:bg-black/40">
 <h2 id="pricelist-dialog-title" className="text-xl font-semibold text-[#173E44]">{title}</h2>{children}</dialog>,document.body);
}
export function PricelistManager(){
 const {accessToken}=useAuth(),{images,error:loadError,ready,retry,updateImage}=usePricelists();
 const [category,setCategory]=useState(null),[pending,setPending]=useState(null),[preview,setPreview]=useState(""),[error,setError]=useState(""),[modal,setModal]=useState(""),[saving,setSaving]=useState(false);
 const lock=useRef(false),selection=useRef(0);
 useEffect(()=>()=>{selection.current++;},[]);
 useEffect(()=>{if(!pending){setPreview("");return;}const url=URL.createObjectURL(pending);setPreview(url);return ()=>URL.revokeObjectURL(url);},[pending]);
 async function choose(file){
  const version=++selection.current;
  setError("");
  try{
   validatePricelistFile(file);
   const url=URL.createObjectURL(file);
   try{await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>image.naturalWidth&&image.naturalHeight?resolve():reject(new Error("The image is empty."));image.onerror=()=>reject(new Error("This image could not be opened. Choose another file."));image.src=url;});}
   finally{URL.revokeObjectURL(url);}
   if(version===selection.current)setPending(file);
  }catch(error){if(version===selection.current){setPending(null);setError(error.message);}}
 }
 function leave(){selection.current++;setCategory(null);setPending(null);setError("");}
 async function confirm(){
  if(lock.current)return;
  lock.current=true;setSaving(true);setError("");
  try{
   validatePricelistFile(pending);
   const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error("Unable to read image."));reader.readAsDataURL(pending);});
   const saved=await savePricelist(accessToken,category.id,dataUrl,images[category.id]?.revision||0);
   updateImage(category.id,saved);
   setPending(null);setModal("success");
  }catch(error){setError(error.message);setModal("");}
  finally{lock.current=false;setSaving(false);}
 }
 return <section className="rounded-2xl bg-white p-5 shadow-sm md:p-7">
 <h1 className="text-2xl font-semibold text-[#173E44]">{category?"Update "+category.name+" Services":"Manage Services and Pricelist"}</h1>
 <p className="mt-2 text-sm text-[#607277]">Update service pricelist images for each category.</p>
 {loadError&&<div role="alert" className="mt-4 text-[#B23949]">{loadError} <button type="button" onClick={retry} disabled={saving} className="underline">Retry loading</button></div>}
 {!category?<div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">{PRICELIST_CATEGORIES.map((item,index)=>{const Icon=icons[index];return <button key={item.id} onClick={()=>setCategory(item)} className="flex flex-col items-center gap-3 rounded-xl border border-[#BDD9D7] p-5 text-[#173E44] hover:bg-[#EAF6F6]"><Icon size={28}/><span className="font-semibold">{item.name}</span><span className="text-xs text-[#607277]">{!ready?"Loading...":images[item.id]?.imageUrl?"Image uploaded":"No image uploaded"}</span></button>;})}</div>:<>
 <div className="mt-6 grid gap-4 lg:grid-cols-2">
 <div className="rounded-xl border border-[#D9E7E7] p-4"><h2 className="mb-3 font-semibold">Current saved image</h2><PricelistPreview imageUrl={images[category.id]?.imageUrl} name={category.name}/></div>
 <div className="rounded-xl border border-[#D9E7E7] p-4"><h2 className="mb-3 font-semibold">Replacement image</h2>
 <label className="block rounded-xl border border-dashed border-[#BDD9D7] bg-[#F3FAFA] p-5 text-sm text-[#173E44]">Select an image from your device
 <input type="file" accept="image/jpeg,image/png,image/webp" disabled={saving} onChange={event=>{const file=event.target.files?.[0];if(file)choose(file);event.target.value="";}} className="mt-3 block w-full"/>
 <span className="mt-2 block text-xs">JPG, PNG or WebP. Maximum 5 MB.</span></label>
 {preview&&<div className="mt-4"><p className="mb-2 text-sm">Pending preview: visible to customers after saving</p><PricelistPreview imageUrl={preview} name={category.name}/></div>}</div></div>
 {error&&<p role="alert" className="mt-4 text-[#B23949]">{error}</p>}
 <div className="mt-5 flex justify-end gap-3"><button disabled={saving} onClick={leave} className="rounded-xl border border-[#BDD9D7] px-5 py-3">Cancel</button><button disabled={!pending||saving||!ready||!!loadError} onClick={()=>setModal("confirm")} className={button}>Save Changes</button></div></>}
 {modal==="confirm"&&<Modal title="Confirm Changes" busy={saving} onClose={()=>setModal("")}><p className="my-5 text-sm leading-6">Are you sure you want to save the updated pricelist image for {category.name}? The new image will replace the currently displayed pricelist for this category and will be visible to customers after saving.</p><div className="flex justify-end gap-3"><button disabled={saving} onClick={()=>setModal("")} className="px-4 py-3">Cancel</button><button disabled={saving} onClick={confirm} className={button}>{saving?"Saving...":"Confirm and Save"}</button></div></Modal>}
 {modal==="success"&&<Modal title="Changes Saved!" onClose={()=>setModal("")}><p className="my-5">The service image and pricelist have been successfully updated.</p><button autoFocus onClick={()=>setModal("")} className={button}>OK</button></Modal>}
 </section>;
}
