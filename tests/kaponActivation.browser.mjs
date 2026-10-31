import assert from "node:assert/strict";
import { createServer } from "vite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.KAPON_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.KAPON_PLAYWRIGHT_MODULE).href : "playwright");
const cacheDir = mkdtempSync(join(tmpdir(), "capstone-kapon-activation-"));
const mocks = {
  "context/AppContext.jsx": `import {useEffect,useState} from 'react';
    import {subscribeKaponPromo,saveKaponPromo} from '/src/app/services/kaponPromo.js';
    export function useApp(){const [state,setState]=useState({kaponPromo:null,kaponPromoReady:false});
      useEffect(()=>subscribeKaponPromo(promo=>setState({kaponPromo:promo,kaponPromoReady:true}),error=>setState({kaponPromoReady:false,kaponPromoError:error.message})),[]);
      return {...state,kaponPromoAvailable:state.kaponPromo?.isActive===true,manageKaponPromo:async payload=>{
        const promo=await saveKaponPromo(payload);setState({kaponPromo:promo,kaponPromoReady:true});return promo;}};}`,
  "context/ToastContext.jsx": "export function useToast(){return {success(){},error(){}};}",
  "supabaseDatabase.js": "export const db={},isSupabaseConfigured=true;",
  "supabaseSession.js": `export const auth={currentUser:{id:new URLSearchParams(location.search).get('role')}};
    export async function getSupabaseAccessToken(){return 'test-'+auth.currentUser.id;}`,
  "database.js": `export const isPostgresEnabled=true;
    export const doc=(_db,collection,id)=>({collection,id});
    export function onSnapshot(){return ()=>{};}
    export async function getDoc(){const r=await fetch('/__promo-read');const record=await r.json();return {exists:()=>Boolean(record),data:()=>record};}
    export function runTransaction(){throw new Error('Generic writes must not be used');}`,
};
const server = await createServer({ configFile:false,cacheDir,logLevel:"silent",esbuild:{jsx:"automatic"},
  resolve:{dedupe:["react","react-dom"]},optimizeDeps:{include:["react","react-dom/client","react-dom","lucide-react","axios"]},
  define:{"import.meta.env.VITE_API_URL":JSON.stringify("/api")},server:{host:"127.0.0.1",port:0},
  plugins:[{name:"kapon-activation-fixture",enforce:"pre",
    resolveId(source){if(source==="/__entry.js")return "\0entry";
      const key=Object.keys(mocks).find(key=>source.endsWith('/'+key));if(key)return '\0mock:'+key;},
    load(id){if(id.startsWith('\0mock:'))return mocks[id.slice(6)];
      if(id==='\0entry')return `import React from 'react';import {createRoot} from 'react-dom/client';
        import {KaponPromoManager} from '/src/app/components/portal/KaponPromoManager.jsx';
        createRoot(document.getElementById('root')).render(React.createElement(KaponPromoManager));`;},
    configureServer(vite){vite.middlewares.use((req,res,next)=>{if(!req.url.startsWith('/__fixture'))return next();
      res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body><div id="root"></div><script type="module" src="/__entry.js"></script></body></html>');});},
  }],
});
let browser;
try {
  await server.listen(); browser=await chromium.launch({headless:true});
  const page=await browser.newPage();page.setDefaultTimeout(30000);
  const errors=[];page.on('pageerror',error=>errors.push(error.stack));
  let record=null; const writes=[];
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.route('**/__promo-read',route=>route.fulfill({json:record}));
  await page.route('**/api/auth/promotions/low-cost-kapon',route=>{
    const payload=route.request().postDataJSON();writes.push({payload,token:route.request().headers().authorization});
    record={...payload,isActive:payload.action!=='deactivate',revision:payload.expectedRevision+1};
    return route.fulfill({json:{promo:record}});
  });
  for(const role of ['admin','staff']){
    record=null;await page.goto(`${server.resolvedUrls.local[0]}__fixture?role=${role}`,{waitUntil:'domcontentloaded'});
    const activate=page.getByRole('button',{name:'Activate Low-Cost Kapon',exact:true});
    await activate.click();
    await page.getByPlaceholder('https://forms.gle/...').fill('https://forms.gle/test123');
    await page.getByRole('button',{name:'Activate Promo',exact:true}).click();
    await page.getByRole('button',{name:'Edit Promo',exact:true}).waitFor();
    assert.equal(record.isActive,true);assert.equal(writes.at(-1).token,`Bearer test-${role}`);
    await page.reload({waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'Edit Promo',exact:true}).waitFor();
    page.once('dialog',dialog=>dialog.accept());
    await page.getByRole('button',{name:'Deactivate',exact:true}).click();
    await activate.waitFor();assert.equal(record.isActive,false);
  }
  assert.equal(writes.length,4);assert.deepEqual(errors,[]);
  console.log('PASS: Admin/Staff promo controls load, activate, persist across reload, and deactivate while realtime never connects.');
} finally {
  await browser?.close();await server.close();rmSync(cacheDir,{recursive:true,force:true});
}
