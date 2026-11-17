import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
import {createServer} from "vite";
import tailwindcss from "@tailwindcss/vite";

const {chromium}=await import(process.env.BOOKING_PLAYWRIGHT_MODULE
 ? pathToFileURL(process.env.BOOKING_PLAYWRIGHT_MODULE).href:"playwright");
const mocks={
 "context/AuthContext.jsx":`export const useAuth=()=>({currentUser:{uid:'customer',role:'customer',email:'customer@example.com',username:'Customer',status:'active'},isAuthenticated:true,isLoading:false});`,
 "context/AppContext.jsx":`const state={appointments:[],petRecords:[{id:'pet',customerId:'customer',petName:'Milo',petType:'Dog'},{id:'pet2',customerId:'customer',petName:'Luna',petType:'Cat'}]};
 export const useApp=()=>({state,visibleNotifications:[],availabilityReady:true,kaponPromoReady:true,kaponPromoAvailable:false,getPendingAppointmentCount:()=>0,createAppointment:async payload=>{window.__lastBooking=payload;}});`,
 "context/ToastContext.jsx":"export const useToast=()=>({error(){},success(){}});",
 "services/customerAccount.js":"export async function changeCustomerPassword(){}",
 "PricelistImage.jsx":`import React from 'react';export function PricelistImage({category}){return React.createElement('div',{style:{height:200},'data-testid':'pricelist'},category+' pricelist');}`,
};
const server=await createServer({configFile:false,server:{host:"127.0.0.1",port:5199,strictPort:false},logLevel:"silent",
 plugins:[tailwindcss(),{name:"booking-browser-fixture",enforce:"pre",
  resolveId(source){
   if(source==="/__booking_entry.js")return "\0booking-entry";
   const key=Object.keys(mocks).find(key=>source.endsWith('/'+key));
   if(key)return "\0booking-mock:"+key;
  },
  load(id){
   if(id.startsWith("\0booking-mock:"))return mocks[id.slice("\0booking-mock:".length)];
   if(id==="\0booking-entry")return `import React from 'react';import {createRoot} from 'react-dom/client';
    import {MemoryRouter} from 'react-router-dom';import {CustomerProfile} from '/src/app/components/CustomerProfile.jsx';
    import '/src/styles/index.css';
    const scroll=Element.prototype.scrollIntoView;
    window.__bookingScrolls=[];
    Element.prototype.scrollIntoView=function(options){window.__bookingScrolls.push(options);return scroll.call(this,options);};
    createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,{initialEntries:['/customer/dashboard?tab=services']},React.createElement(CustomerProfile)));`;
  },
  configureServer(vite){vite.middlewares.use((req,res,next)=>{
   if(req.url!=="/__booking_test")return next();
   res.setHeader("Content-Type","text/html");
   res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__booking_entry.js"></script></body></html>');
  });},
 }],
});
let browser;
try{
 await server.listen();browser=await chromium.launch({headless:true});
 const page=await browser.newPage();const errors=[];
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 page.on('pageerror',error=>{errors.push(error.message);console.error(error.message);});
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  await page.setViewportSize(viewport);
  await page.goto(server.resolvedUrls.local[0]+'__booking_test',{waitUntil:'domcontentloaded'});
  for(const [id,name] of [['vaccination','Vaccination'],['deworming','Deworming'],['consultation','Consultation'],['laboratory-testing','Laboratory Testing'],['pet-grooming','Pet Grooming']]){
   console.log(`Checking ${id} at ${viewport.width}px`);
   const card=page.locator('article').filter({has:page.getByRole('heading',{name,exact:true})});
   await card.getByRole('button',{name:'Continue to booking',exact:true}).click();
   const pet=page.getByLabel('Select pet',{exact:true});await pet.waitFor();
   await page.waitForFunction(()=>window.__bookingScrolls.at(-1)?.behavior==='smooth');
   // Wait for the actual scroll to reach the booking/pricelist section.
   await page.waitForFunction(()=>{const top=document.querySelector('[data-testid="pricelist"]').getBoundingClientRect().top;return top>=0&&top<150;});
   await pet.selectOption('pet');
   const service=page.getByLabel('Selected service',{exact:true});
   assert.equal(await service.inputValue(),id);
   assert.ok(!(await service.textContent()).includes('PHP'));
   assert.ok(!(await card.textContent()).includes('PHP'));
   if(['vaccination','consultation','laboratory-testing'].includes(id)){
    const options=page.getByRole('group',{name:name+' services',exact:true}).getByRole('radio');
    assert.equal(await options.count(),id==='vaccination'?6:id==='consultation'?17:3);
    await options.first().check();await options.last().check();
    assert.equal(await options.and(page.locator(':checked')).count(),1);
   }
   await pet.selectOption('pet2');assert.equal(await service.inputValue(),id);
   if(['vaccination','consultation','laboratory-testing'].includes(id)){
    const options=page.getByRole('group',{name:name+' services',exact:true}).getByRole('radio');
    assert.equal(await options.and(page.locator(':checked')).count(),0);
    if(id==='vaccination')assert.equal(await options.count(),3);
   }
   // Manual changes survive changing the selected pet.
   await service.selectOption(id==='vaccination'?'deworming':'vaccination');
   await pet.selectOption('pet');
   assert.equal(await service.inputValue(),id==='vaccination'?'deworming':'vaccination');
   const before=await page.evaluate(()=>window.__bookingScrolls.length);
   await card.getByRole('button',{name:'Continue to booking',exact:true}).click();
   await page.waitForFunction(count=>window.__bookingScrolls.length>count,before);
   assert.equal(await service.inputValue(),id);
   assert.equal(await pet.inputValue(),'pet');
   await page.waitForFunction(()=>{const top=document.querySelector('[data-testid="pricelist"]').getBoundingClientRect().top;return top>=0&&top<150;});
  }
  const grooming=page.getByRole('group',{name:'Dog grooming',exact:true});
  await grooming.waitFor();
  assert.equal(await grooming.getByRole('checkbox').count(),14);
  assert.ok(!(await grooming.textContent()).includes('PHP'));
  await grooming.getByRole('checkbox',{name:'Full Groom',exact:true}).check();
  assert.ok(await grooming.getByRole('checkbox',{name:'Nail Clipping',exact:true}).isDisabled());
  assert.ok(await grooming.getByRole('checkbox',{name:'Basic',exact:true}).isDisabled());
  await grooming.getByRole('checkbox',{name:'Full Groom',exact:true}).uncheck();
  await grooming.getByRole('checkbox',{name:'Nail Clipping',exact:true}).check();
  await grooming.getByRole('checkbox',{name:'Toothbrush',exact:true}).check();
  assert.ok(await grooming.getByRole('checkbox',{name:'Ear Cleaning',exact:true}).isDisabled());
  assert.ok(await grooming.getByRole('checkbox',{name:'Full Groom',exact:true}).isDisabled());
  await grooming.getByRole('checkbox',{name:'Toothbrush',exact:true}).uncheck();
  assert.ok(await grooming.getByRole('checkbox',{name:'Ear Cleaning',exact:true}).isEnabled());
  await page.getByLabel('Select pet',{exact:true}).selectOption('pet2');
  const cat=page.getByRole('group',{name:'Cat grooming',exact:true});
  assert.equal(await cat.getByRole('checkbox').count(),12);
  assert.equal(await cat.getByRole('checkbox').and(page.locator(':checked')).count(),0);
  assert.equal(await cat.getByRole('checkbox',{name:'Puppy Cut',exact:true}).count(),0);
  await cat.getByRole('checkbox',{name:'Full Grooming',exact:true}).check();
  assert.ok(await cat.getByRole('checkbox',{name:'Ear Cleaning',exact:true}).isDisabled());
  assert.ok(await cat.getByRole('checkbox',{name:'Basic Grooming',exact:true}).isDisabled());
  await cat.getByRole('checkbox',{name:'Full Grooming',exact:true}).uncheck();
  await cat.getByRole('checkbox',{name:'Ear Cleaning',exact:true}).check();
  await cat.getByRole('checkbox',{name:'Nail Clipping',exact:true}).check();
  assert.ok(await cat.getByRole('checkbox',{name:'Full Grooming',exact:true}).isDisabled());
  await page.locator('button').filter({hasText:/^\d{1,2}$/}).and(page.locator('button:enabled')).first().click();
  await page.locator('button').filter({hasText:/openings? left/}).first().click();
  await page.getByRole('button',{name:'Confirm appointment booking',exact:true}).click();
  await page.waitForFunction(()=>window.__lastBooking?.grooming?.name==='Ear Cleaning, Nail Clipping');
  const booking=await page.evaluate(()=>window.__lastBooking);
  assert.deepEqual(booking.grooming.serviceIds,['ear-cleaning','nail-clipping']);
  assert.equal(booking.grooming.petType,'Cat');assert.equal(booking.servicePrice,'');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 }
 assert.deepEqual(errors,[]);
 console.log('Passed: service preselection, scrolling, species-specific grooming options, two-selection limit, pet reset, and submitted grooming details on desktop and mobile.');
}finally{await browser?.close();await server.close();}
