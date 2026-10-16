import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {loadPricelists}=require("../server/src/services/pricelists.service.js");

function memoryDatabase(initial={}) {
 const records=new Map(Object.entries(initial));
 const writes=[];
 const db={
  collection(name){assert.equal(name,"servicePricelists");return {doc:id=>({id})};},
  async runTransaction(callback){
   const pending=[];
   const result=await callback({
    async getAll(...refs){return refs.map(ref=>({exists:records.has(ref.id),data:()=>records.get(ref.id)}));},
    async get(ref){return {exists:records.has(ref.id),data:()=>records.get(ref.id)};},
    set(ref,value){pending.push([ref.id,value]);}
   });
   for(const [id,value] of pending){records.set(id,value);writes.push(id);}
   return result;
  }
 };
 return {db,records,writes};
}
test("first load initializes five empty records and repeated loads preserve them",async()=>{
 const {db,records,writes}=memoryDatabase();
 const first=await loadPricelists(db);
 assert.equal(Object.keys(first).length,5);
 assert.equal(records.size,5);
 assert.equal(writes.length,5);
 for(const image of Object.values(first)){assert.equal(image.imageUrl,"");assert.equal(image.revision,0);}
 assert.deepEqual(await loadPricelists(db),first);
 assert.equal(writes.length,5);
});
test("initialization never replaces an existing saved image or its revision",async()=>{
 const saved={imageUrl:"https://example.test/vaccine.png",objectPath:"pricelists/vaccination/existing",revision:7};
 const {db,records,writes}=memoryDatabase({vaccination:saved});
 const result=await loadPricelists(db);
 assert.equal(result.vaccination.imageUrl,saved.imageUrl);
 assert.equal(result.vaccination.revision,7);
 assert.deepEqual(records.get("vaccination"),saved);
 assert.equal(writes.includes("vaccination"),false);
 assert.equal(writes.length,4);
});
test("unconfigured database returns a useful service-unavailable error",async()=>{
 await assert.rejects(()=>loadPricelists(null),/not configured/);
});
test("database failure is reported instead of returning empty success",async()=>{
 await assert.rejects(()=>loadPricelists({runTransaction:async()=>{throw Error("database offline");}}),/database offline/);
});

test("list and save controllers persist records, reject conflicts, and clean up failed uploads",async()=>{
 const {db,records}=memoryDatabase();
 const uploaded=new Map(),deleted=[];
 const bucket={name:"test-bucket",file:path=>({
  async save(buffer){uploaded.set(path,buffer);},
  async delete(){deleted.push(path);uploaded.delete(path);}
 })};
 const firebasePath=require.resolve("../server/src/config/firebaseAdmin.js");
 const serverRequire=createRequire(new URL("../server/src/controllers/pricelist.controller.js",import.meta.url));
 const storagePath=serverRequire.resolve("firebase-admin/storage");
 const originalFirebase=require.cache[firebasePath],originalStorage=require.cache[storagePath];
 require.cache[firebasePath]={id:firebasePath,filename:firebasePath,loaded:true,exports:{db}};
 require.cache[storagePath]={id:storagePath,filename:storagePath,loaded:true,exports:{getStorage:()=>({bucket:()=>bucket})}};
 const controllerPath=require.resolve("../server/src/controllers/pricelist.controller.js");
 delete require.cache[controllerPath];
 try{
  const {listPricelists,savePricelist}=require(controllerPath);
  let response;
  const res={set(){},json(value){response=value;}};
  await listPricelists({},res);
  assert.equal(Object.keys(response.pricelists).length,5);
  const imageDataUrl="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  const req={params:{category:"vaccination"},body:{imageDataUrl,expectedRevision:0},auth:{user:{uid:"admin"}}};
  await savePricelist(req,res);
  assert.equal(response.pricelist.revision,1);
  assert.match(records.get("vaccination").imageUrl,/test-bucket/);
  assert.equal(records.get("deworming").imageUrl,"");
  const saved=records.get("vaccination");
  await assert.rejects(()=>savePricelist(req,res),/changed/);
  assert.deepEqual(records.get("vaccination"),saved);
  assert.equal(deleted.length,1);
  assert.equal(uploaded.size,1);
  await assert.rejects(()=>savePricelist({...req,params:{category:"unknown"}},res),/Unknown category/);
  await assert.rejects(()=>savePricelist({...req,body:{imageDataUrl:"invalid",expectedRevision:1}},res),/valid JPG/);
 }finally{
  delete require.cache[controllerPath];
  if(originalFirebase)require.cache[firebasePath]=originalFirebase;else delete require.cache[firebasePath];
  if(originalStorage)require.cache[storagePath]=originalStorage;else delete require.cache[storagePath];
 }
});
