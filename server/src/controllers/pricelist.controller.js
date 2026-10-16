const {randomUUID}=require("crypto");
const {getStorage}=require("firebase-admin/storage");
const {db}=require("../config/firebaseAdmin");
const {ApiError}=require("../utils/ApiError");
const {validateImage}=require("../utils/pricelistImage");
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
 const bucket=getStorage().bucket();
 const objectPath="pricelists/"+req.params.category+"/"+randomUUID();
 const file=bucket.file(objectPath), token=randomUUID();
 await file.save(buffer,{resumable:false,metadata:{contentType,cacheControl:"public,max-age=31536000,immutable",metadata:{firebaseStorageDownloadTokens:token}}});
 const imageUrl="https://firebasestorage.googleapis.com/v0/b/"+bucket.name+"/o/"+encodeURIComponent(objectPath)+"?alt=media&token="+token;
 const reference=db.collection("servicePricelists").doc(req.params.category);
 const next={imageUrl,objectPath,revision:expectedRevision+1,updatedAt:new Date().toISOString(),updatedBy:req.auth.user.uid};
 let previousPath;
 try { await db.runTransaction(async transaction=>{
  const snapshot=await transaction.get(reference),current=snapshot.data()||{};
  if((current.revision||0)!==expectedRevision) throw new ApiError(409,"This pricelist changed. Review the current image and try again.");
  previousPath=current.objectPath;
  transaction.set(reference,next);
 }); } catch(error) { await file.delete().catch(()=>{}); throw error; }
 if(previousPath?.startsWith("pricelists/"+req.params.category+"/")) bucket.file(previousPath).delete().catch(()=>{});
 res.json({pricelist:next});
}
module.exports={savePricelist,listPricelists};