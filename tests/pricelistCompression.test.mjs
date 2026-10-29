import test from "node:test";
import assert from "node:assert/strict";
import {compressPricelist} from "../src/app/services/pricelistCompression.mjs";
import {MAX_PRICELIST_BYTES,MAX_PRICELIST_DATA_URL_BYTES} from "../shared/pricelists.mjs";

function browser(t,{width=2400,height=3200,encode}={}) {
 const attempts=[];
 function mockGlobal(name,value){
  const original=Object.getOwnPropertyDescriptor(globalThis,name);
  Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
  t.after(()=>{if(original)Object.defineProperty(globalThis,name,original);else delete globalThis[name];});
 }
 t.mock.method(URL,"createObjectURL",()=>"blob:test");
 const revoke=t.mock.method(URL,"revokeObjectURL",()=>{});
 mockGlobal("FileReader",class {
  readAsDataURL(blob){blob.arrayBuffer().then(buffer=>{this.result=`data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`;this.onload();});}
 });
 mockGlobal("Image",class {
  naturalWidth=width;naturalHeight=height;
  set src(value){queueMicrotask(()=>this.onload());}
 });
 const canvas={getContext:()=>({fillRect(){},drawImage(){}}),toBlob(callback,type,quality){
  attempts.push({width:this.width,height:this.height,type,quality});
  callback(new Blob([new Uint8Array(encode?.(this,type,quality)??600_000)],{type}));
 }};
 mockGlobal("document",{createElement:()=>canvas});
 return {attempts,revoke};
}
test("small valid selection preserves original encoding and resolution",async t=>{
 const {attempts,revoke}=browser(t);
 const file=new Blob(["small image"],{type:"image/png"});
 const result=await compressPricelist(file);
 assert.equal(result,"data:image/png;base64,"+Buffer.from("small image").toString("base64"));
 assert.equal(attempts.length,0);assert.equal(revoke.mock.callCount(),1);
});
test("accepts a 5 MiB selection and prefers a high quality encoding at original dimensions",async t=>{
 const {attempts}=browser(t,{encode:(_canvas,type)=>type==="image/png"?800_000:600_000});
 const result=await compressPricelist(new Blob([new Uint8Array(MAX_PRICELIST_BYTES)],{type:"image/jpeg"}));
 assert.ok(result.length<=MAX_PRICELIST_DATA_URL_BYTES);
 assert.match(result,/^data:image\/webp;base64,/);
 assert.equal(attempts[1].quality,0.95);
 assert.equal(attempts[1].width,2400);assert.equal(attempts[1].height,3200);
});
test("resizes when necessary while retaining a readable resolution",async t=>{
 const {attempts}=browser(t,{encode:canvas=>canvas.height>2400?800_000:600_000});
 const result=await compressPricelist(new Blob([new Uint8Array(1_000_000)],{type:"image/png"}));
 assert.ok(result.length<=MAX_PRICELIST_DATA_URL_BYTES);
 const last=attempts.at(-1);assert.ok(last.height<=2400&&last.height>=1600);
 assert.ok(Math.abs(last.width/last.height-0.75)<0.001);
});
test("rejects images that cannot fit without excessive degradation and releases resources",async t=>{
 const {revoke}=browser(t,{encode:()=>800_000});
 await assert.rejects(()=>compressPricelist(new Blob([new Uint8Array(1_000_000)],{type:"image/png"})),/preserving text detail/);
 assert.equal(revoke.mock.callCount(),1);
 await assert.rejects(()=>compressPricelist(new Blob([new Uint8Array(MAX_PRICELIST_BYTES+1)],{type:"image/png"})),/5 MB/);
});
