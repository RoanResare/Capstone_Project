const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { ApiError } = require("../src/utils/ApiError");
const phoneUtils = require("../src/utils/phoneNumber");

function fixture(initial = {}) {
  const records = new Map(Object.entries(initial));
  let queue = Promise.resolve();
  const queryFor = name => ({ name, async get() {
    return { docs: [...records].filter(([key]) => key.startsWith(`${name}/`))
      .map(([key, value]) => ({ id: key.split("/")[1], data: () => value })) };
  } });
  const db = {
    collection: (name) => ({ ...queryFor(name), doc: (id) => ({ key: `${name}/${id}`, id }) }),
    runTransaction(action) {
      const run = queue.then(async () => {
        const writes = [];
        const transaction = {
          get: async (ref) => ref.key ? { exists: records.has(ref.key), data: () => records.get(ref.key) }
            : { docs: [...records].filter(([key]) => key.startsWith(`${ref.name}/`)).map(([key, value]) => ({ id: key.split("/")[1], data: () => value })) },
          set: (ref, data) => writes.push([ref.key, data]),
        };
        await action(transaction);
        writes.forEach(([key, value]) => records.set(key, value));
      });
      queue = run.catch(() => {});
      return run;
    },
  };
  function load(relative, extra = {}) {
    const filename = path.resolve(__dirname, "../src", relative);
    const controller = new Module(filename, module);
    controller.filename = filename;
    controller.paths = module.paths;
    controller.require = id => {
      if (id.startsWith("node:")) return require(id);
      if (id === "../config/postgresDatabase") return { db };
      if (id === "../config/env") return { env: { runtime: { supabaseAdminReady: true, mailDeliveryReady: true }, auth: { emailVerificationUrl: "https://example.test/activate-account" } } };
      if (id === "../services/supabaseAuth.service") return {
        generateSupabaseEmailLink: async ({ email }) => ({ actionLink: "https://supabase.test/verify", tokenHash: "hash",
          user: { id: email.split("@")[0], email } }),
        findSupabaseUserByEmail: async () => null, deleteSupabaseUser: async () => {},
      };
      if (id === "../services/token.service") return { signCustomerVerificationStatusToken: () => "status" };
      if (id === "../services/mail.service") return { sendEmailVerificationLink: async () => ({ messageId: "mail" }) };
      if (id === "../utils/ApiError") return { ApiError };
      if (id === "../utils/phoneNumber") return phoneUtils;
      if (id === "../utils/emailValidation") return { assertValidEmail() {} };
      if (id === "../utils/password") return { assertStrongPassword() {} };
      if (id === "../services/user.service") return { assertValidUsername: value => value,
        findUserByEmailCaseInsensitive: async () => null, getUsernameOwner: async () => null };
      if (id === "../services/registrationSecurity.service") return { validateRegistrationSecurity: async () => ({ registrationIp: "test" }) };
      if (id === "../services/sessionSecurity.service") return { validateAccessSecurity: async () => {} };
      if (extra[id]) return extra[id];
      throw new Error(id);
    };
    controller._compile(fs.readFileSync(filename, "utf8"), filename);
    return controller.exports;
  }
  const service = load("services/phoneAccounts.service.js");
  const { createCustomerProfile } = load("controllers/registration.controller.js", { "../services/phoneAccounts.service": service });
  return { records, register: (uid, phone) => createCustomerProfile({ headers: {}, body: {
    email: `${uid}@example.test`, password: "Valid!Password1", fullName: "Customer", username: uid, phone,
    termsAndConditionsAccepted: true, privacyPolicyAccepted: true,
  } }, { status() { return this; }, json() {} }) };
}

test("registration permits three normalized phone accounts and rejects a fourth", async () => {
  const system = fixture();
  for (const [uid, phone] of [["one", "09620614953"], ["two", "+63 9620614953"], ["three", "9620614953"]]) await system.register(uid, phone);
  await assert.rejects(system.register("four", "09620614953"), /already has 3 accounts/);
  assert.equal(system.records.has("users/four"), false);
});

test("legacy phone records count and concurrent registrations cannot exceed three", async () => {
  const system = fixture({ "users/legacy": { phone: "09620614953" }, "users/legacy2": { phone: "639620614953" } });
  const results = await Promise.allSettled([system.register("new1", "+63 9620614953"), system.register("new2", "+63 9620614953")]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
});
