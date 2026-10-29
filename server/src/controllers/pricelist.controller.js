const {db}=require("../config/firebaseAdmin");
const {ApiError}=require("../utils/ApiError");
const {validateImage}=require("../utils/pricelistImage");
async function listPricelists(req,res) {
 res.set("Cache-Control", "no-store");
 const {loadPricelists}=require("../services/pricelists.service");
 res.json({pricelists:await loadPricelists(db)});
}
async function savePricelist(req,res) {
 if(!db) throw new ApiError(503,"Pricelist database is not configured. Please contact the administrator.");
 const {PRICELIST_CATEGORIES,MAX_PRICELIST_DATA_URL_BYTES}=await import("../../../shared/pricelists.mjs");
 if(!PRICELIST_CATEGORIES.some(c=>c.id===req.params.category)) throw new ApiError(400,"Unknown category.");
 const imageUrl=req.body?.imageDataUrl;
 if(typeof imageUrl==="string"&&Buffer.byteLength(imageUrl,"utf8")>MAX_PRICELIST_DATA_URL_BYTES) throw new ApiError(413,"The optimized image is too large. Select the image again to optimize it before saving.");
 validateImage(imageUrl);
 const expectedRevision=req.body?.expectedRevision;
 if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision>=Number.MAX_SAFE_INTEGER) throw new ApiError(400,"A valid revision is required.");
 const reference=db.collection("servicePricelists").doc(req.params.category);
 const next={imageUrl,objectPath:"",revision:expectedRevision+1,updatedAt:new Date().toISOString(),updatedBy:req.auth.user.uid};
 try { await db.runTransaction(async transaction=>{
  const snapshot=await transaction.get(reference),current=snapshot.data()||{};
  if((current.revision||0)!==expectedRevision) throw new ApiError(409,"This pricelist changed. Review the current image and try again.");
  transaction.set(reference,next);
 }); } catch(error) {
  if(error instanceof ApiError) throw error;
  console.error("Pricelist database publication failed:",error);
  throw new ApiError(503,"The pricelist update could not be saved. Your current image has not changed. Please try again.");
 }
 res.json({pricelist:next});
}
module.exports={savePricelist,listPricelists};
