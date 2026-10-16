import {collection,onSnapshot} from "firebase/firestore";
import {db} from "../../firebase.js";
import {apiClient,buildAuthHeaders,extractApiError} from "./apiClient.js";
export function subscribePricelists(onChange,onError) {
 if(!db){onError(new Error("Pricelists are unavailable."));return ()=>{};}
 return onSnapshot(collection(db,"servicePricelists"),snapshot=>onChange(Object.fromEntries(snapshot.docs.map(doc=>[doc.id,doc.data()]))),()=>onError(new Error("Unable to load pricelists. Please try again later.")));
}
export async function savePricelist(token,category,imageDataUrl,expectedRevision){
 try {const response=await apiClient.put("/auth/pricelists/"+category,{imageDataUrl,expectedRevision},{headers:buildAuthHeaders(token)});return response.data.pricelist;}
 catch(error){throw new Error(extractApiError(error,"Unable to save the pricelist."));}
}