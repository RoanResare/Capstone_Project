import assert from "node:assert/strict";
import {test} from "node:test";
import {groomingOptionsForPet,buildGroomingSelection,groomingDescription,groomingSizeForPet} from "../shared/groomingServices.mjs";
test("all pictured dog, cat, and shared a la carte services are offered without prices",()=>{
 const dog=groomingOptionsForPet({petType:"Dog"}),cat=groomingOptionsForPet({petType:"Cat"});
 assert.deepEqual(dog.packages.map(s=>s.name),["Basic","Bath & Blowdry","Sanitary","Full Groom","Puppy Cut"]);
 assert.deepEqual(cat.packages.map(s=>s.name),["Basic Grooming","Sanitary Grooming","Full Grooming"]);
 assert.deepEqual(cat.alaCarte.map(s=>s.name),["Nail Clipping","Ear Cleaning","Anal Sac Expression","Face Trim","Paw Pad Trim","Poodle Feet","Tummy & Butt Trim","Wound Cleaning","Toothbrush"]);
 assert.deepEqual(cat.alaCarte,dog.alaCarte);
 for(const entry of [...dog.packages,...cat.packages,...dog.alaCarte])assert.ok(!('price' in entry)&&!('prices' in entry));
});
test("one package or up to two a la carte services can be selected",()=>{
 const dog={petType:"Dog",weightKg:30};
 assert.equal(buildGroomingSelection(["full-groom"],dog).name,"Full Groom");
 assert.equal(buildGroomingSelection(["ear-cleaning","toothbrush"],dog).services.length,2);
 assert.equal(buildGroomingSelection(["feline-full"],{petType:"Cat"}).name,"Full Grooming");
 assert.equal(buildGroomingSelection(["basic"],{petType:"Dog"}).size,null);
 assert.equal(groomingSizeForPet(dog),"X-Large");
});
test("invalid, duplicate, excessive and cross-species selections are rejected",()=>{
 for(const ids of [[],["basic","basic"],["basic","nail-clipping","toothbrush"],["unknown"],["feline-basic"],["full-groom","nail-clipping"],["basic","puppy-cut"]])assert.throws(()=>buildGroomingSelection(ids,{petType:"Dog"}));
 assert.throws(()=>buildGroomingSelection(["basic"],{petType:"Cat"}));
 assert.throws(()=>buildGroomingSelection(["nail-clipping"],{petType:"Rabbit"}));
});
test("saved grooming descriptions support new and legacy appointment records",()=>{
 assert.equal(groomingDescription(buildGroomingSelection(["ear-cleaning","nail-clipping"],{petType:"Cat"})),"Ear Cleaning, Nail Clipping");
 assert.equal(groomingDescription({serviceId:"basic",name:"Basic",price:300}),"Basic");
 assert.equal(groomingDescription(null),"");
});
