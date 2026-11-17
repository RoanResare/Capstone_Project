import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {PRICELIST_CATEGORIES,validatePricelistFile,MAX_PRICELIST_BYTES} from "../shared/pricelists.mjs";
const require=createRequire(import.meta.url);
const {validateImage}=require("../server/src/utils/pricelistImage.js");
test("five independent pricelist category IDs",()=>{
 assert.deepEqual(PRICELIST_CATEGORIES.map(c=>c.id),["vaccination","deworming","consultation","laboratory-testing","pet-grooming"]);
});
test("client rejects empty, oversized, and unsupported uploads",()=>{
 for(const file of [{type:"image/png",size:0},{type:"image/png",size:MAX_PRICELIST_BYTES+1},{type:"image/svg+xml",size:100}])assert.throws(()=>validatePricelistFile(file));
 for(const type of ["image/jpeg","image/png","image/webp"])assert.doesNotThrow(()=>validatePricelistFile({type,size:100}));
});
test("server accepts a real PNG and rejects spoofed content and malformed encodings",()=>{
 const png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
 assert.equal(validateImage("data:image/png;base64,"+png).contentType,"image/png");
 for(const value of ["","data:image/svg+xml;base64,PHN2Zz4=","data:image/png;base64,"+Buffer.from("<script>alert(1)</script>").toString("base64"),"data:image/jpeg;base64,"+png,"data:image/png;base64,abc"])assert.throws(()=>validateImage(value));
});
test("server rejects oversized binary payloads",()=>{
 assert.throws(()=>validateImage("data:image/png;base64,"+Buffer.alloc(MAX_PRICELIST_BYTES+1).toString("base64")));
});
