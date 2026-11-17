import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
test("server uses the saved species, persists canonical grooming names, and preserves choices on approval",async()=>{
 let record={id:"appointment",status:"Pending",customerId:"customer",petRecordId:"cat",petRecordIds:["cat"],serviceId:"pet-grooming",serviceIds:["pet-grooming"]};
 const pet={customerId:"customer",petType:"Cat"};
 const db={collection:collection=>({doc:id=>({collection,id}),where(){return this;},limit(){return {query:true};}}),async runTransaction(fn){
  let pending;
  await fn({async get(ref){if(ref.query)return {docs:[]};return {exists:true,data:()=>ref.collection==="pets"?pet:record};},set(_ref,value){pending=value;}});
  if(pending)record=pending;
 }};
 const firebasePath=require.resolve("../server/src/config/firebaseAdmin.js"),controllerPath=require.resolve("../server/src/controllers/appointment.controller.js");
 const original=require.cache[firebasePath];
 require.cache[firebasePath]={id:firebasePath,filename:firebasePath,loaded:true,exports:{db}};
 delete require.cache[controllerPath];
 try{
  const {saveAppointment}=require(controllerPath);
  const save=(grooming,user={uid:"customer",role:"customer"},changes={})=>saveAppointment({params:{id:record.id},auth:{user},body:{...record,...changes,grooming}},{json(){}});
  await save({serviceIds:["nail-clipping","ear-cleaning"],name:"Forged client name",price:999});
  assert.equal(record.grooming.name,"Nail Clipping, Ear Cleaning");
  assert.equal(record.grooming.petType,"Cat");assert.ok(!('price' in record.grooming));
  assert.match(record.service,/Nail Clipping, Ear Cleaning/);assert.equal(record.servicePrice,"");
  const pending=record;
  for(const serviceIds of [["full-groom"],["feline-full","ear-cleaning","toothbrush"],["ear-cleaning","ear-cleaning"],["feline-full","ear-cleaning"],["feline-basic","feline-full"]]){
   await assert.rejects(()=>save({serviceIds}),error=>error.statusCode===400);
   assert.deepEqual(record,pending);
  }
  await save(record.grooming,{uid:"admin",role:"admin"},{status:"Accepted",assignedStaff:"Staff A"});
  assert.equal(record.status,"Accepted");assert.deepEqual(record.grooming,pending.grooming);
 }finally{
  delete require.cache[controllerPath];
  if(original)require.cache[firebasePath]=original;else delete require.cache[firebasePath];
 }
});
