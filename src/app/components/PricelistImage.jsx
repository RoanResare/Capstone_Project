import {useEffect,useState} from "react";
import {useAuth} from "../context/AuthContext.jsx";
import {getCachedPricelists,loadPricelists,subscribePricelists} from "../services/pricelists.js";
import {PRICELIST_CATEGORIES} from "../../../shared/pricelists.mjs";
export function usePricelists(){
 const {accessToken}=useAuth();
 const [images,setImages]=useState(()=>getCachedPricelists(accessToken)||{}),[error,setError]=useState(""),[ready,setReady]=useState(()=>Boolean(getCachedPricelists(accessToken)));
 const [attempt,setAttempt]=useState(0);
 useEffect(()=>{
  setImages({});setError("");setReady(false);
  if(!accessToken)return;
  return subscribePricelists(accessToken,data=>{setImages(data);setReady(true);setError("");},error=>{setError(error.message);setReady(true);});
 },[accessToken,attempt]);
 return {images,error,ready,retry:()=>setAttempt(value=>value+1),updateImage:(category,image)=>setImages(current=>({...current,[category]:image}))};
}
export function usePricelistWarmup(){
 const {accessToken}=useAuth();
 useEffect(()=>{if(accessToken)void loadPricelists(accessToken).catch(()=>{});},[accessToken]);
}
export function PricelistPreview({imageUrl,name}){
 const [failedUrl,setFailedUrl]=useState("");
 return imageUrl&&failedUrl!==imageUrl?<img src={imageUrl} alt={name+" services and pricelist"} onError={()=>setFailedUrl(imageUrl)} className="mx-auto block h-auto w-full max-w-4xl rounded-xl object-contain" fetchPriority="high" decoding="async"/>:<div className="flex aspect-[4/3] items-center justify-center rounded-xl border border-dashed border-[#BDD9D7] bg-[#F3FAFA] p-8 text-center text-[#607277]">{name} pricelist is currently unavailable. Please contact the clinic for current fees.</div>;
}
export function PricelistImage({category}){
 const {images,error,ready}=usePricelists(), selected=PRICELIST_CATEGORIES.find(c=>c.id===category);
 if(!selected)return null;
 return <section aria-label={selected.name+" pricelist"} className="rounded-lg bg-white p-4 shadow-sm md:p-5">
 {!ready||error?<div role="status" className="mx-auto flex aspect-[4/3] w-full max-w-4xl items-center justify-center rounded-xl bg-[#F3FAFA] text-sm text-[#607277]">{error||"Loading pricelist..."}</div>:<PricelistPreview imageUrl={images[category]?.imageUrl} name={selected.name}/>}
 <h2 className="mt-4 text-xl font-semibold text-[#173E44]">{selected.name} Services &amp; Pricelist</h2><p className="mt-2 text-sm text-[#607277]">View services and fees, then choose a pet and service below.</p></section>;
}
