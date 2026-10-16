const {randomUUID}=require("crypto");
const {getStorage}=require("firebase-admin/storage");
const {db}=require("../config/firebaseAdmin");
const {ApiError}=require("../utils/ApiError");
const {validateImage}=require("../utils/pricelistImage");
function storageError(error) {
 console.error("Pricelist image storage failed:", error);
 const code=String(error.code);
 if(code==="404") return new ApiError(503,"The pricelist storage bucket was not found. Ask the administrator to provision Firebase Storage and check FIREBASE_STORAGE_BUCKET.");
 if(code==="401"||code==="403") return new ApiError(503,"Pricelist storage access was denied. Ask the administrator to check the backend service account's Storage permissions.");
 if(code==="storage/invalid-argument"||code==="app/no-app") return new ApiError(503,"Pricelist storage is not configured. Ask the administrator to check Firebase Admin and FIREBASE_STORAGE_BUCKET.");
 return new ApiError(503,"The image could not be uploaded to pricelist storage. Your current image has not changed. Please try again.");
}
async function listPricelists(req,res) {
 res.set("Cache-Control", "no-store");
 const {loadPricelists}=require("../services/pricelists.service");
 res.json({pricelists:await loadPricelists(db)});
}
async function savePricelist(req,res) {
 if(!db) throw new ApiError(503,"Pricelist storage is not configured. Please contact the administrator.");
 const {PRICELIST_CATEGORIES}=await import("../../../shared/pricelists.mjs");
 if(!PRICELIST_CATEGORIES.some(c=>c.id===req.params.category)) throw new ApiError(400,"Unknown category.");
 const {buffer,contentType}=validateImage(req.body?.imageDataUrl);
 const expectedRevision=req.body?.expectedRevision;
 if(!Number.isInteger(expectedRevision)||expectedRevision<0) throw new ApiError(400,"A valid revision is required.");
 let bucket;
 try { bucket=getStorage().bucket(); } catch(error) { throw storageError(error); }
 const objectPath="pricelists/"+req.params.category+"/"+randomUUID();
 const file=bucket.file(objectPath), token=randomUUID();
 try {
  await file.save(buffer,{resumable:false,metadata:{contentType,cacheControl:"public,max-age=31536000,immutable",metadata:{firebaseStorageDownloadTokens:token}}});
 } catch(error) { throw storageError(error); }
 const imageUrl="https://firebasestorage.googleapis.com/v0/b/"+bucket.name+"/o/"+encodeURIComponent(objectPath)+"?alt=media&token="+token;
 const reference=db.collection("servicePricelists").doc(req.params.category);
 const next={imageUrl,objectPath,revision:expectedRevision+1,updatedAt:new Date().toISOString(),updatedBy:req.auth.user.uid};
 let previousPath;
 try { await db.runTransaction(async transaction=>{
  const snapshot=await transaction.get(reference),current=snapshot.data()||{};
  if((current.revision||0)!==expectedRevision) throw new ApiError(409,"This pricelist changed. Review the current image and try again.");
  previousPath=current.objectPath;
  transaction.set(reference,next);
 }); } catch(error) {
  await file.delete().catch(cleanupError=>console.error("Pricelist upload cleanup failed:",cleanupError));
  if(error instanceof ApiError) throw error;
  console.error("Pricelist database publication failed:",error);
  throw new ApiError(503,"The image was uploaded but its pricelist update could not be saved. Your current image has not changed. Please try again.");
 }
 if(previousPath?.startsWith("pricelists/"+req.params.category+"/")) bucket.file(previousPath).delete().catch(()=>{});
 res.json({pricelist:next});
}
module.exports={savePricelist,listPricelists};
