import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";

const { chromium } = await import(process.env.RESPONSIVE_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.RESPONSIVE_PLAYWRIGHT_MODULE).href
  : "playwright");
const cssFile = readdirSync(new URL("../dist/assets/", import.meta.url))
  .find((name) => /^index-.*\.css$/.test(name));
assert.ok(cssFile, "Run npm run build:frontend before this browser test");
const productionCss = readFileSync(new URL(`../dist/assets/${cssFile}`, import.meta.url), "utf8");

const appMock = `
  import {useSyncExternalStore} from 'react';
  const listeners = new Set();
  const view = new URLSearchParams(window.location.search).get('view') || '';
  const role = view.startsWith('customer') ? 'customer' : view.toLowerCase().includes('admin') ? 'admin' : 'staff';
  const now = new Date();
  const month = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const currentUser = {id: role, uid: role, role, name: role === 'customer' ? 'Jamie Customer' : 'Taylor Staff',
    username: role === 'customer' ? 'jamie' : 'taylor', email: role + '@example.com', status: 'active'};
  const records = [
    ['later', 'Later', 'Pending', '17', '09:00'], ['early', 'Earlier', 'Pending', '13', '09:00'],
    ['approved', 'Green', 'Confirmed', '14', '11:00'], ['completed', 'Finished', 'Completed', '15', '09:00'],
  ].map(([id, petName, status, day, time], index) => ({id, petName, status, scheduleDate: month + '-' + day,
    scheduleTime: time, customerId: 'customer', customerEmail: 'customer@example.com', ownerName: 'Jamie Customer',
    petType: 'Dog', service: 'Vaccination', assignedStaff: status === 'Pending' ? '' : 'Taylor Staff',
    createdAt: new Date(Date.now() - index * 100000).toISOString()}));
  const modules = [{id:'appointments',label:'Appointments'},{id:'schedule',label:'Schedule'},
    {id:'pet-records',label:'Pet Records'},...(role === 'admin' ? [{id:'manage-users',label:'Manage Users'}] : [])];
  let snapshot = {currentUser, accessibleModules: modules, visibleNotifications: [],
    state: {appointments: records, availabilitySlots: [], petRecords: [{id:'pet-one',customerId:'customer',ownerName:'Jamie Customer',customerEmail:'customer@example.com',petName:'Milo',petType:'Dog',breed:'Mixed',notes:'',lastVisit:''}], users: [currentUser,{id:'staff-user',role:'staff',name:'Taylor Staff',email:'staff@example.com',status:'active'}]},
    updateAppointment: async () => true, loadMoreAppointments: async () => {}, refreshScheduleData: async () => {},
    saveAvailabilitySlot: async () => {}, savePetRecord: async () => {}, createStaff: async () => {},
    updateUser: async () => {}, deleteUser: async () => {}, markNotificationRead: () => {},
    markAllNotificationsRead: () => {}, logChatbotInquiry: () => {}, deletePetRecord: async () => {},
    createAppointment: async () => true, getPendingAppointmentCount: () => 0,
    availabilityReady: true, availabilityError: '', kaponPromo: null, kaponPromoAvailable: false,
    kaponPromoReady: true, kaponPromoError: ''};
  export const useApp = () => snapshot;
`;
const mocks = {
  "context/AppContext.jsx": appMock,
  "context/AuthContext.jsx": `const view = new URLSearchParams(window.location.search).get('view') || '';
    const role = view.startsWith('customer') ? 'customer' : view.toLowerCase().includes('admin') ? 'admin' : 'staff';
    const publicAuth = ['login','signup','forgot','reset','otp'].includes(view);
    const mockUser = {id:role,uid:role,role,name:'Test User',username:'testuser',email:'test@example.com'};
    const restoreOtp = () => null;
    export function useAuth() { return {currentUser:publicAuth ? null : mockUser,
      isAuthenticated:!publicAuth,isLoading:false,isOnline:true,accessToken:null,homePath:'',pendingOtp:null,
      signOut:async()=>{},updateProfile:async()=>{},restorePendingOtpSession:restoreOtp,clearPendingOtp:()=>{},
      signUp:async(form)=>form.password===form.confirmPassword?{ok:false,error:'Unexpected test submission'}:{ok:false,error:'Passwords do not match.'},
      requestPasswordReset:async()=>({ok:true,message:'Reset link sent'}),validatePasswordResetCode:async()=>({ok:false,error:'Invalid reset link'}),
      completePasswordReset:async()=>({ok:true,message:'Password updated'}),verifyPendingOtp:async()=>({ok:false,error:'Invalid code'}),resendOtp:async()=>({ok:false,error:'Unavailable'})}; }`,
  "context/ToastContext.jsx": "export const useToast = () => ({error() {}, success() {}, info() {}});",
  "services/customerAccount.js": "export async function changeCustomerPassword() {}",
  "services/groq.js": `export const groqSuggestionChips=[];
    export const CHAT_TIMEOUT_ERROR_MESSAGE='Unavailable';
    export async function getGroqRuntimeStatus(){return {ready:true,summary:'Ready',helpText:''};}
    export async function askGroqAssistantStream(){return {answer:'Test reply',provider:'test'};}`,
};

const server = await createServer({
  configFile: false,
  logLevel: "silent",
  cacheDir: ".tmp/responsive-route-vite-cache",
  server: { host: "127.0.0.1", port: 0 },
  resolve: { dedupe: ["react", "react-dom"] },
  optimizeDeps: { include: ["react", "react-dom/client", "react-router-dom", "motion/react", "lucide-react"] },
  plugins: [{
    name: "responsive-route-fixture",
    enforce: "pre",
    resolveId(source) {
      if (source === "/__responsive_entry.js") return "\0responsive-entry";
      const key = Object.keys(mocks).find((candidate) => source.endsWith(`/${candidate}`));
      if (key) return `\0responsive-mock:${key}`;
    },
    load(id) {
      if (id.startsWith("\0responsive-mock:")) return mocks[id.slice("\0responsive-mock:".length)];
      if (id === "\0responsive-entry") return `
        import React from 'react'; import {createRoot} from 'react-dom/client';
        import {MemoryRouter,Routes,Route} from 'react-router-dom';
        import {Layout} from '/src/app/components/Layout.jsx';
        import {Home} from '/src/app/components/Home.jsx'; import {About} from '/src/app/components/About.jsx';
        import {Products} from '/src/app/components/Products.jsx'; import {UnifiedLogin} from '/src/app/components/UnifiedLogin.jsx';
        import {CustomerSignup} from '/src/app/components/CustomerSignup.jsx';
        import {ForgotPassword} from '/src/app/components/ForgotPassword.jsx';
        import {ResetPassword} from '/src/app/components/ResetPassword.jsx';
        import {OtpVerification} from '/src/app/components/OtpVerification.jsx';
        import {ActivateAccount} from '/src/app/components/ActivateAccount.jsx';
        import {UnauthorizedPage} from '/src/app/components/UnauthorizedPage.jsx';
        import {CustomerProfile} from '/src/app/components/CustomerProfile.jsx';
        import {AdminDashboard,StaffDashboard} from '/src/app/components/RoleDashboards.jsx';
        import {PortalLayout} from '/src/app/components/portal/PortalLayout.jsx';
        import {PortalPage} from '/src/app/components/portal/PortalPage.jsx';
        const view=new URLSearchParams(window.location.search).get('view')||'home';
        const paths={home:'/',about:'/about',products:'/products',login:'/login',signup:'/customer/signup',forgot:'/forgot-password',reset:'/reset-password',otp:'/verify-otp',activate:'/activate-account',unauthorized:'/unauthorized',
          customer:'/customer/dashboard?tab=appointments',customerOverview:'/customer/dashboard?tab=overview',
          customerServices:'/customer/dashboard?tab=services',customerProfile:'/customer/dashboard?tab=profile',
          admin:'/admin/dashboard',staff:'/staff/dashboard',portal:'/portal/appointments',
          portalSchedule:'/portal/schedule',portalPets:'/portal/pet-records',portalUsers:'/portal/manage-users',
          portalAdmin:'/portal/pricelists'};
        const path=paths[view]||'/';
        function Screen(){return React.createElement(MemoryRouter,{initialEntries:[path]},React.createElement(Routes,null,
          React.createElement(Route,{path:'/',element:React.createElement(Layout)},
            React.createElement(Route,{index:true,element:React.createElement(Home)}),
            React.createElement(Route,{path:'about',element:React.createElement(About)}),
            React.createElement(Route,{path:'products',element:React.createElement(Products)}),
            React.createElement(Route,{path:'login',element:React.createElement(UnifiedLogin)}),
            React.createElement(Route,{path:'forgot-password',element:React.createElement(ForgotPassword)}),
            React.createElement(Route,{path:'reset-password',element:React.createElement(ResetPassword)}),
            React.createElement(Route,{path:'verify-otp',element:React.createElement(OtpVerification)}),
            React.createElement(Route,{path:'activate-account',element:React.createElement(ActivateAccount)}),
            React.createElement(Route,{path:'unauthorized',element:React.createElement(UnauthorizedPage)}),
            React.createElement(Route,{path:'customer/signup',element:React.createElement(CustomerSignup)}),
            React.createElement(Route,{path:'customer/dashboard',element:React.createElement(CustomerProfile)})),
          React.createElement(Route,{path:'/admin/dashboard/*',element:React.createElement(AdminDashboard)}),
          React.createElement(Route,{path:'/staff/dashboard/*',element:React.createElement(StaffDashboard)}),
          React.createElement(Route,{path:'/portal/*',element:React.createElement(PortalLayout)},
            React.createElement(Route,{path:'appointments',element:React.createElement(PortalPage)}),
            React.createElement(Route,{path:'schedule',element:React.createElement(PortalPage)}),
            React.createElement(Route,{path:'pet-records',element:React.createElement(PortalPage)}),
            React.createElement(Route,{path:'manage-users',element:React.createElement(PortalPage)}),
            React.createElement(Route,{path:'pricelists',element:React.createElement(PortalPage)}))));}
        createRoot(document.getElementById('root')).render(React.createElement(Screen));`;
    },
    configureServer(vite) {
      vite.middlewares.use((req, res, next) => {
        if (!req.url.startsWith("/__responsive")) return next();
        if (req.url.startsWith("/__responsive_entry")) return next();
        res.setHeader("Content-Type", "text/html");
        res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${productionCss}</style></head><body><div id="root"></div><script type="module" src="/__responsive_entry.js"></script></body></html>`);
      });
    },
  }],
});

let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 320, height: 720 }, timezoneId: "Asia/Manila" });
  page.setDefaultTimeout(8000);
  page.setDefaultNavigationTimeout(30000);
  const errors = [];
  let activeView = "fixture bootstrap";
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource: net::ERR_FAILED")) {
      errors.push(`${activeView}: ${message.text()}`);
    }
  });
  await page.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1"
    ? route.continue() : route.abort());
  const base = server.resolvedUrls.local[0];
  const cases = [
    ["home", "Charming Fur-fection"], ["about", "About Charming Fur-fection"],
    ["products", "Pet Products"], ["login", "Welcome Back!"], ["signup", "Create Account"],
    ["forgot", "Request a secure password reset link."], ["reset", "Choose a new password for your account."], ["otp", "There is no active OTP challenge."],
    ["activate", "Activation link needs attention"], ["unauthorized", "Unauthorized account type."],
    ["customer", "My appointments"], ["customerOverview", "Customer Dashboard"],
    ["customerServices", "Continue to booking"], ["customerProfile", "Profile"],
    ["admin", "Admin Dashboard"], ["staff", "Staff Dashboard"], ["portal", "Manage appointments"],
    ["portalSchedule", "Manage schedule"], ["portalPets", "Manage pet records"],
    ["portalUsers", "Employee accounts"], ["portalAdmin", "Manage Services and Pricelist"],
  ];
  const selectedCases = process.env.CAPSTONE_RESPONSIVE_VIEW
    ? cases.filter(([view]) => view === process.env.CAPSTONE_RESPONSIVE_VIEW)
    : cases;
  for (const [view, expectedText] of selectedCases) {
    activeView = view;
    await page.goto(`${base}__responsive?view=${view}`, { waitUntil: "domcontentloaded" });
    await page.setViewportSize({ width: 320, height: 720 });
    try {
      await page.getByText(expectedText, { exact: false }).first().waitFor();
    } catch (error) {
      console.error(`Screen ${view} did not render its expected content.`, await page.locator("body").innerText(), {url:page.url(), errors});
      throw error;
    }
    if (view === "customerServices") {
      await page.getByRole("button", { name: "Continue to booking" }).first().click();
      await page.getByRole("heading", { name: "Choose a pet, then choose the service." }).waitFor();
    }
    if (view === "signup") {
      await page.getByRole("button", { name: "Toggle menu" }).click();
      await page.getByRole("button", { name: "Home", exact: true }).last().waitFor();
      await page.getByRole("button", { name: "Toggle menu" }).click();
      await page.getByPlaceholder("Enter your full name").fill("Test Customer");
      await page.getByPlaceholder("Enter your email").fill("customer@gmail.com");
      await page.getByPlaceholder("Choose a profile username").fill("test_customer");
      await page.getByPlaceholder("9XXXXXXXXX", { exact: true }).fill("9940702702");
      await page.getByPlaceholder("Create a password").fill("Roanpogi03.");
      await page.getByPlaceholder("Repeat your password").fill("Different03.");
      await page.getByRole("button", { name: "Create account", exact: true }).click();
      await page.getByRole("dialog").locator("div.overflow-y-auto").evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        element.dispatchEvent(new Event("scroll"));
      });
      await page.getByRole("checkbox").check();
      await page.getByRole("button", { name: "Agree and continue" }).click();
      await page.getByRole("button", { name: "Create account", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "Passwords do not match." }).waitFor();
      assert.equal(await page.getByRole("alert").filter({ hasText: "Passwords do not match." }).count(), 1,
        "Signup mismatch validation must remain visible after consent");
    }
    if (view === "home") {
      await page.getByRole("button", { name: "Toggle menu" }).click();
      await page.getByRole("button", { name: "Home", exact: true }).last().waitFor();
      await page.getByRole("button", { name: "Toggle menu" }).click();
    }
    if (view === "portalUsers") {
      const filters = page.getByRole("group", { name: "Filter employee accounts by role" });
      await filters.getByRole("button", { name: "Staff" }).click();
      await page.getByLabel("Staff employee accounts").waitFor();
      await page.getByRole("link", { name: "Appointments" }).click();
      await page.getByRole("heading", { name: "Manage appointments" }).waitFor();
    }
    if (view === "login") {
      const signIn = page.getByRole("button", { name: /Log In/i }).first();
      await signIn.focus();
      assert.notEqual(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), "none",
        "Keyboard focus must remain visible on the login action");
    }
    await page.waitForTimeout(650);
    for (const width of [320, 375, 390, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(40);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      const overflowingElements = overflow ? await page.evaluate(() => [...document.querySelectorAll("body *")]
        .map((element) => ({element, rect: element.getBoundingClientRect()}))
        .filter(({element, rect}) => rect.width > 0 && (rect.left < -1 || rect.right > window.innerWidth + 1
          || element.scrollWidth > element.clientWidth + 2))
        .slice(0, 12)
        .map(({element, rect}) => ({tag:element.tagName, className:String(element.className).slice(0,100), left:Math.round(rect.left), right:Math.round(rect.right), width:element.scrollWidth, client:element.clientWidth, text:(element.innerText||"").slice(0,50)}))) : [];
      assert.equal(overflow, false, `${view} route must not overflow horizontally at ${width}px: ${JSON.stringify(overflowingElements)}`);
    }
    if (view === "portal") {
      await page.setViewportSize({ width: 320, height: 568 });
      await page.locator(".fc-event").first().click();
      const dialog = page.getByRole("dialog", { name: "Appointment details" });
      await dialog.waitFor();
      const bounds = await dialog.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 320 && bounds.y + bounds.height <= 568,
        "Appointment dialog must fit a short 320px mobile viewport");
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
    }
    console.log(`PASS responsive viewport matrix: ${view}`);
  }
  activeView = "chatbot";
  await page.goto(`${base}__responsive?view=home`, { waitUntil: "domcontentloaded" });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole("button", { name: /Charming Assistant/ }).click();
  const assistant = page.locator("#charming-assistant-panel");
  await assistant.waitFor();
  const assistantBounds = await assistant.boundingBox();
  assert.ok(assistantBounds.x >= 0 && assistantBounds.y >= 0
    && assistantBounds.x + assistantBounds.width <= 320 && assistantBounds.y + assistantBounds.height <= 568,
    "Floating assistant must remain within a short mobile viewport");
  await page.getByRole("button", { name: "Close Charming Assistant" }).click();
  assert.deepEqual(errors, []);
  console.log("PASS chatbot positioning and accessible dialog open/close at 320x568; no page errors.");
} finally {
  await browser?.close();
  await server.close();
}
