const {chromium}=require(process.env.TEMP+'/capstone-ui-review/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const results=[];
 for(const width of [390,768,1440]){
  const page=await browser.newPage({viewport:{width,height:960},deviceScaleFactor:1,hasTouch:width<768});
  for(const route of ['/','/customer/signup','/login']){
   await page.goto('http://127.0.0.1:5179'+route,{waitUntil:'domcontentloaded'});
   await page.waitForTimeout(1800);
   await page.screenshot({path:'artifacts/ui-review/'+(route==='/'?'home':route.slice(1).replaceAll('/','-'))+'-'+width+'.png',fullPage:true});
   results.push(await page.evaluate(()=>({path:location.pathname,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,root:getComputedStyle(document.documentElement).fontSize,body:getComputedStyle(document.body).fontSize,heading:document.querySelector('h1')&&getComputedStyle(document.querySelector('h1')).fontSize})));
  }
  await page.close();
 }
 console.log(JSON.stringify(results,null,2));await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1});
