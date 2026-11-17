const {chromium}=require(process.env.TEMP+'/capstone-ui-review/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const results=[];
 for(const width of [390,768,1440]){
  const page=await browser.newPage({viewport:{width,height:960},deviceScaleFactor:1,hasTouch:width<768});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/src/app/context/AuthContext.jsx*',r=>r.fulfill({contentType:'text/javascript',body:`const user={uid:'visual-review',id:'visual-review',role:'customer',username:'Jamie',name:'Jamie Santos',fullName:'Jamie Santos',email:'jamie@example.test',status:'active',phone:'+639123456789'};const screen=new URLSearchParams(location.search).get('screen');const guest=['signup','login','home'].includes(screen);const auth={currentUser:guest?null:user,isAuthenticated:!guest,isLoading:false,isOnline:true,firebaseConfigError:'',signUp:async()=>({ok:true}),signOut:async()=>{},updateProfile:async()=>{},homePath:'/customer/dashboard'};export function useAuth(){return auth;}`}));
  await page.route('**/src/app/context/AppContext.jsx*',r=>r.fulfill({contentType:'text/javascript',body:`const app={state:{petRecords:[],appointments:[],availabilitySlots:[],scheduleSlots:[]},visibleNotifications:[],kaponPromoReady:true,kaponPromoAvailable:false,kaponPromo:null,kaponPromoError:'',markNotificationRead(){},markAllNotificationsRead(){},getPendingAppointmentCount(){return 0},availabilityReady:true,availabilityError:''};export function useApp(){return app;}`}));
  await page.route('**/src/app/context/ToastContext.jsx*',r=>r.fulfill({contentType:'text/javascript',body:`export function useToast(){return {error(){},success(){},info(){}}}`}));
  for(const tab of ['overview','services','profile','signup','login','home']){
   await page.goto('http://127.0.0.1:5181/artifacts/ui-review/dashboard.html?screen='+tab+'&tab='+tab,{waitUntil:'domcontentloaded'});
   await page.waitForSelector(['signup','login'].includes(tab)?'form':tab==='home'?'#home':'[aria-label="Customer welcome"]',{timeout:20000});await page.waitForTimeout(800);
   results.push(await page.evaluate(()=>({tab:new URLSearchParams(location.search).get('tab'),width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,bannerHeight:Math.round(document.querySelector('[aria-label="Customer welcome"]')?.getBoundingClientRect().height||0),sidebar:Math.round(document.querySelector('aside')?.getBoundingClientRect().width||0)})));
   await page.screenshot({path:'artifacts/ui-review/dashboard-'+tab+'-'+width+'.png',fullPage:true});
  }
  console.log(JSON.stringify({width,errors}));await page.close();
 }
 console.log(JSON.stringify(results,null,2));await browser.close();process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
