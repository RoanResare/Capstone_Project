import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";
import tailwindcss from "@tailwindcss/vite";

const { chromium } = await import(process.env.APPOINTMENT_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.APPOINTMENT_PLAYWRIGHT_MODULE).href : "playwright");
const appMock = `
  import {useSyncExternalStore} from 'react';
  const listeners = new Set();
  const now = new Date();
  const month = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const staff = {id: 'staff', uid: 'staff', role: 'staff', name: 'Staff A', status: 'active'};
  const customer = {id: 'customer', uid: 'customer', role: 'customer', name: 'Customer', username: 'Customer', email: 'customer@example.com', status: 'active'};
  const records = [
    ['later', 'Later', 'Pending', '17', '09:00'],
    ['early', 'Earlier', 'Pending', '13', '09:00'],
    ['approve', 'Approval Test', 'Pending', '19', '09:00'],
    ['approved', 'Green', 'Confirmed', '14', '11:00'],
    ['completed', 'Finished', 'Completed', '15', '09:00'],
    ['cancelled', 'Cancelled Pet', 'Cancelled', '16', '09:00'],
    ['rejected', 'Rejected Pet', 'Rejected', '16', '11:00'],
    ['expired', 'Expired Pet', 'No Show', '17', '14:00'],
    ['accepted', 'Approved Pet', 'Accepted', '18', '09:00'],
  ].map(([id, petName, status, day, time], index) => ({id, petName, status, scheduleDate: month + '-' + day, scheduleTime: time,
    customerId: 'customer', customerEmail: 'customer@example.com', ownerName: 'Customer', petType: 'Dog', service: 'Vaccination',
    serviceId: 'vaccination', assignedStaff: status === 'Pending' ? '' : 'Staff A', createdAt: new Date(Date.now() - index * 100000).toISOString()}));
  records.find(record=>record.id==='approve').assignedStaff='Staff A';
  let snapshot;
  const notify = () => listeners.forEach(fn => fn());
  const updateAppointment = async (id, changes) => {snapshot = {...snapshot, state: {...snapshot.state, appointments: snapshot.state.appointments.map(record => record.id === id ? {...record, ...changes} : record)}}; notify(); return {ok:true,emailNotification:changes.status ? {state:'pending',eventId:'test-event'} : null};};
  snapshot = {currentUser: staff, state: {appointments: records, petRecords: [], users: [{...staff, role: 'staff'}]},
    visibleNotifications: [], updateAppointment, refreshScheduleData: async()=>{}, kaponPromoReady: true, kaponPromoAvailable: false};
  window.__appointmentSnapshot = () => snapshot;
  window.__appointmentRole = role => {snapshot = {...snapshot, currentUser: role === 'customer' ? customer : staff}; notify();};
  export const useApp = () => useSyncExternalStore(fn => {listeners.add(fn); return () => listeners.delete(fn);}, () => snapshot);
`;
const mocks = {
  "context/AppContext.jsx": appMock,
  "context/AuthContext.jsx": "import {useApp} from '/src/app/context/AppContext.jsx'; export const useAuth = () => ({currentUser: useApp().currentUser, isAuthenticated: true, isLoading: false});",
  "context/ToastContext.jsx": "window.__emailToasts=[]; export const useToast = () => ({error(message) {window.__emailToasts.push({type:'error',message});}, success(message) {window.__emailToasts.push({type:'success',message});}});",
  "services/customerAccount.js": "export async function changeCustomerPassword() {}",
};
const server = await createServer({ configFile: false, server: { host: "127.0.0.1", port: 5199, strictPort: false }, logLevel: "silent",
  plugins: [tailwindcss(), { name: "appointment-browser-fixture", enforce: "pre",
    resolveId(source) {
      if (source === "/__appointment_entry.js") return "\0appointment-entry";
      const key = Object.keys(mocks).find((key) => source.endsWith(`/${key}`));
      if (key) return `\0appointment-mock:${key}`;
    },
    load(id) {
      if (id.startsWith("\0appointment-mock:")) return mocks[id.slice("\0appointment-mock:".length)];
      if (id === "\0appointment-entry") return `
        import React from 'react'; import {createRoot} from 'react-dom/client'; import {MemoryRouter} from 'react-router-dom';
        import {useApp} from '/src/app/context/AppContext.jsx'; import {PortalPage} from '/src/app/components/portal/PortalPage.jsx';
        import {CustomerProfile} from '/src/app/components/CustomerProfile.jsx'; import '/src/styles/index.css';
        function Root() {const {currentUser} = useApp(); const customer = currentUser.role === 'customer';
          return React.createElement(MemoryRouter, {key: currentUser.role, initialEntries: [customer ? '/customer/dashboard?tab=appointments' : '/portal/appointments']}, React.createElement(customer ? CustomerProfile : PortalPage));}
        createRoot(document.getElementById('root')).render(React.createElement(Root));`;
    },
    configureServer(vite) {
      vite.middlewares.use((req, res, next) => {
        if (req.url !== "/__appointment_test") return next();
        res.setHeader("Content-Type", "text/html");
        res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#f6f0e7;padding:16px"><div id="root"></div><script type="module" src="/__appointment_entry.js"></script></body></html>');
      });
    },
  }],
});
let browser;
try {
 await server.listen();browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(server.resolvedUrls.local[0]+'__appointment_test',{waitUntil:'domcontentloaded',timeout:90000});
 const list=page.getByRole('heading',{name:'Manage appointments',exact:true}).locator('xpath=ancestor::section[1]');
 await page.getByRole('heading',{name:'Manage appointments',exact:true}).waitFor({timeout:90000});
 await list.getByRole('button',{name:/Approval Test/}).click();
 await page.getByRole('dialog',{name:'Appointment details',exact:true}).getByRole('button',{name:'Approve appointment',exact:true}).click();
 await page.getByRole('dialog',{name:'Approve appointment',exact:true}).getByRole('button',{name:'Confirm approval',exact:true}).click();
 await page.waitForFunction(()=>window.__appointmentSnapshot().state.appointments.find(a=>a.id==='approve').status==='Accepted');
 await page.getByRole('button',{name:'Close appointment details',exact:true}).click();
 await list.getByRole('button',{name:/Earlier/}).click();
 const dialog=page.getByRole('dialog',{name:'Appointment details',exact:true});await dialog.waitFor();
 assert.equal(await dialog.getByText('Requested grooming services',{exact:true}).count(),0);
 await dialog.getByRole('button',{name:'Reject appointment',exact:true}).click();
 const category=dialog.getByLabel('Reason category',{exact:true});
 await category.selectOption('A');
 await page.waitForFunction(()=>document.querySelector('dialog option[value="B"]')?.disabled);
 assert.ok(await category.locator('option[value="B"]').evaluate(option=>option.disabled));
 assert.ok(await category.locator('option[value="C"]').evaluate(option=>option.disabled));
 assert.equal(await dialog.getByRole('radio').count(),3);
 await dialog.getByRole('radio').first().check();
 await dialog.getByRole('radio').last().check();
 assert.equal(await dialog.getByRole('radio').and(page.locator(':checked')).count(),1);
 await dialog.getByRole('button',{name:'Change category',exact:true}).click();
 await category.selectOption('B');await page.waitForFunction(()=>document.querySelectorAll('dialog input[type="radio"]').length===2);assert.equal(await dialog.getByRole('radio').count(),2);
 await dialog.getByRole('button',{name:'Change category',exact:true}).click();
 await category.selectOption('C');await dialog.getByLabel('Explanation',{exact:true}).waitFor();assert.equal(await dialog.getByRole('radio').count(),0);
 const input=dialog.getByLabel('Explanation',{exact:true});
 await input.fill('            ');
 await dialog.getByRole('button',{name:'Confirm rejection',exact:true}).click();
 await dialog.getByRole('alert').waitFor();
 const reason='The clinic cannot accommodate this visit today.';
 await input.fill('  '+reason+'  ');
 await dialog.getByRole('button',{name:'Confirm rejection',exact:true}).click();
 await page.waitForFunction(()=>window.__appointmentSnapshot().state.appointments.find(a=>a.id==='early').status==='Rejected');
 const saved=await page.evaluate(()=>window.__appointmentSnapshot().state.appointments.find(a=>a.id==='early'));
 assert.equal(saved.decision.reason,reason);
 await dialog.getByRole('button',{name:'Back',exact:true}).click();
 await list.getByRole('button',{name:/Later/}).click();await dialog.waitFor();
 for (const [pet,id] of [['Later','later'],['Green','approved']]) {
  if (id==='approved') {await dialog.getByRole('button',{name:'Back',exact:true}).click();await list.getByRole('button',{name:/Green/}).click();await dialog.waitFor();}
  await dialog.getByRole('button',{name:'Cancel appointment',exact:true}).click();
  await category.selectOption('A');
  assert.equal(await dialog.getByRole('radio').count(),3);
  await dialog.getByRole('button',{name:'Back',exact:true}).click();
  assert.notEqual(await page.evaluate(id=>window.__appointmentSnapshot().state.appointments.find(a=>a.id===id).status,id),'Cancelled');
  await dialog.getByRole('button',{name:'Cancel appointment',exact:true}).click();
  await category.selectOption('B');
  await dialog.getByRole('radio').first().check();
  const reason=await dialog.getByRole('radio').first().locator('..').innerText();
  await dialog.getByRole('button',{name:'Confirm cancellation',exact:true}).click();
  await page.waitForFunction(id=>window.__appointmentSnapshot().state.appointments.find(a=>a.id===id).status==='Cancelled',id);
  assert.equal(await page.evaluate(id=>window.__appointmentSnapshot().state.appointments.find(a=>a.id===id).decision.category,id),'B');
 }
 await dialog.getByRole('button',{name:'Back',exact:true}).click();
 assert.equal(await page.getByRole('option',{name:'Expired',exact:true}).count(),0);
 assert.ok(await page.getByRole('option',{name:'No Show',exact:true}).count());
 const toasts=await page.evaluate(()=>window.__emailToasts);
 assert.equal(toasts.length,4);
 assert.ok(toasts.every(toast=>toast.type==='success' && toast.message.includes('Customer email notification is pending.')));
 assert.equal(toasts.some(toast=>toast.message.includes('notification sent')),false);
 assert.deepEqual(errors,[]);
 console.log('Passed: approval, rejection/cancellation reasons, permitted cancellations, and one accurate pending-email toast per decision.');
}finally{await browser?.close();await server.close();}
