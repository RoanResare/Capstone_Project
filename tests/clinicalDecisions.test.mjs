import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {clinicalOptions,buildClinicalSelections} from "../shared/clinicalServices.mjs";
import {APPOINTMENT_REASON_GROUPS,validateAppointmentDecision} from "../shared/appointmentDecisions.mjs";
const require=createRequire(import.meta.url);
test("clinical choices match the image and enforce one species-appropriate option per category",()=>{
 assert.equal(clinicalOptions("consultation",{petType:"Dog"}).length,17);
 assert.equal(clinicalOptions("laboratory-testing",{petType:"Cat"}).length,3);
 assert.deepEqual(clinicalOptions("vaccination",{petType:"Cat"}).map(option=>option.id),["4-in-1","anti-rabies"]);
 assert.deepEqual(buildClinicalSelections(["vaccination"],{vaccination:"5-in-1"},{petType:"Dog"}).map(choice=>choice.name),["5 in 1 Vaccine","Doctor's Fee"]);
 assert.equal(buildClinicalSelections(["consultation"],{consultation:"consultation"},{petType:"Dog"})[0].name,"Consultation");
 assert.equal(buildClinicalSelections(["laboratory-testing"],{"laboratory-testing":"cbc-basic-chemistry"},{petType:"Dog"})[0].name,"CBC Basic Chemistry");
 for(const [choice,petType] of [["5-in-1","Cat"],["4-in-1","Dog"],["anti-rabies","Rabbit"]])assert.throws(()=>buildClinicalSelections(["vaccination"],{vaccination:choice},{petType}));
 assert.throws(()=>buildClinicalSelections(["consultation"],{}, {petType:"Cat"}));
});
test("decision reasons contain only the approved wording and preserve trimmed Other text",()=>{
 assert.deepEqual(APPOINTMENT_REASON_GROUPS.map(group=>[group.id,group.reasons.length]),[["A",3],["B",2],["C",0]]);
 for(const group of APPOINTMENT_REASON_GROUPS.slice(0,2))for(const reason of group.reasons)assert.deepEqual(validateAppointmentDecision({category:group.id,reason}),{category:group.id,reason});
 const reason="We cannot accommodate this visit; please call tomorrow.";
 assert.equal(validateAppointmentDecision({category:"C",reason:"  "+reason+"  "}).reason,reason);
 for(const reason of [" ",".........!","short","a".repeat(1001)])assert.throws(()=>validateAppointmentDecision({category:"C",reason}));
 assert.throws(()=>validateAppointmentDecision({category:"A",reason:"Another reason"}));
 assert.throws(()=>validateAppointmentDecision({category:"D",reason}));
});
test("API validates clinical radios against saved pets and atomically saves decisions with customer notifications",async()=>{
 const initial={id:"appointment",status:"Pending",customerId:"customer",customerEmail:"customer@example.test",petName:"Milo",petRecordId:"pet",petRecordIds:["pet"],serviceId:"vaccination",serviceIds:["vaccination"],scheduleDate:"2026-10-17",scheduleTime:"14:00",slotId:"slot"};
 const records=new Map([["appointments/appointment",initial],["pets/pet",{customerId:"customer",petType:"Cat"}]]);
 const db={collection:collection=>({doc:id=>({key:collection+"/"+id}),where(){return this;},limit(){return {query:true};}}),async runTransaction(fn){
  const writes=[];
  await fn({async get(ref){return ref.query?{docs:[]}:{exists:records.has(ref.key),data:()=>records.get(ref.key)};},set(ref,value){writes.push([ref.key,value]);}});
  for(const [key,value] of writes)records.set(key,value);
 }};
 const firebasePath=require.resolve("../server/src/config/firebaseAdmin.js"),controllerPath=require.resolve("../server/src/controllers/appointment.controller.js"),original=require.cache[firebasePath];
 require.cache[firebasePath]={id:firebasePath,filename:firebasePath,loaded:true,exports:{db}};delete require.cache[controllerPath];
 try{
  const {saveAppointment}=require(controllerPath);
  const save=(changes,user={uid:"customer",role:"customer"})=>saveAppointment({params:{id:"appointment"},auth:{user},body:{...records.get("appointments/appointment"),...changes}},{json(){}});
  await assert.rejects(()=>save({clinicalSelections:[{category:"vaccination",serviceId:"5-in-1"}]}),error=>error.statusCode===400);
  await assert.rejects(()=>save({clinicalSelections:[{category:"vaccination",serviceId:"4-in-1"},{category:"vaccination",serviceId:"anti-rabies"}]}),error=>error.statusCode===400);
  await save({clinicalSelections:[{category:"vaccination",serviceId:"4-in-1",name:"Forged"},{category:"vaccination",serviceId:"doctors-fee",name:"Forged fee"}]});
  assert.deepEqual(records.get("appointments/appointment").clinicalSelections.map(choice=>choice.name),["4 in 1 Vaccine","Doctor's Fee"]);
  await save({serviceId:"consultation",serviceIds:["consultation"],clinicalSelections:[{category:"consultation",serviceId:"consultation"}]});
  assert.equal(records.get("appointments/appointment").clinicalSelections[0].name,"Consultation");
  await save({serviceId:"laboratory-testing",serviceIds:["laboratory-testing"],clinicalSelections:[{category:"laboratory-testing",serviceId:"cbc-basic-chemistry"}]});
  assert.equal(records.get("appointments/appointment").clinicalSelections[0].name,"CBC Basic Chemistry");
  for(const role of ["admin","staff"]){
   for(const status of ["Rejected"]){
    records.set("appointments/appointment",initial);
    await assert.rejects(()=>save({status},{uid:role,role}),error=>error.statusCode===400);
    const reason="The requested appointment cannot be accommodated today.";
    await save({status,decision:{category:"C",reason:"  "+reason+"  "}},{uid:role,role});
    const saved=records.get("appointments/appointment"),notice=records.get("notifications/appointment-appointment-"+status.toLowerCase());
    assert.equal(saved.decision.reason,reason);assert.equal(saved.decision.by,role);
    assert.equal(saved[status==="Rejected"?"rejectionReason":"cancellationReason"],reason);
    assert.ok(notice.message.includes(reason));assert.equal(notice.targetUserId,"customer");assert.deepEqual(notice.targetRoles,["customer"]);
   }
   records.set("appointments/appointment",initial);
   await save({status:"Cancelled"},{uid:role,role});
   const cancelled=records.get("appointments/appointment");
   assert.equal(cancelled.status,"Cancelled");
   assert.equal(cancelled.decision,undefined);
   assert.equal(cancelled.cancellationReason,undefined);
   assert.ok(!records.get("notifications/appointment-appointment-cancelled").message.includes("Reason:"));
   records.set("appointments/appointment",initial);
   await assert.rejects(()=>save({status:"Cancelled",decision:{category:"C",reason:"A cancellation must not use the rejection form."}},{uid:role,role}),error=>error.statusCode===400);
  }
  records.set("appointments/appointment",initial);
  await assert.rejects(()=>save({status:"Cancelled",decision:{category:"C",reason:"Forged customer reason"}}),error=>error.statusCode===403);
 }finally{delete require.cache[controllerPath];if(original)require.cache[firebasePath]=original;else delete require.cache[firebasePath];}
});
