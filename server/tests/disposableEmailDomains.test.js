const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createDisposableDomainChecker, isDisposableEmailDomain } = require("../src/services/disposableEmailDomains.service");
const { downloadDisposableDomains, DISPOSABLE_LIST_URL } = require("../src/utils/disposableDomainList");

const list = (extra = []) => [...Array.from({length: 1100}, (_, index) => `temporary-${index}.example`), ...extra];
const response = (domains) => ({ok: true, json: async () => domains});
const logger = {warn() {}};

test("bundled list blocks recently reported disposable domains without any network request", () => {
  for (const domain of ["gmeenramy.com", "hudzer.com", "yzcalo.com", "mailinator.com", "10minutemail.com", "inbox.gmeenramy.com"]) {
    assert.equal(isDisposableEmailDomain(domain), true, domain);
  }
});

test("major providers and STI are protected even if a downloaded list includes them", async () => {
  const trusted = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "sti.edu", "students.sti.edu"];
  const checker = createDisposableDomainChecker({domains: trusted, fetchImpl: async () => response(list(trusted)), logger});
  await checker.refresh();
  for (const domain of trusted) assert.equal(checker.isDisposable(domain), false, domain);
});

test("custom domains are allowed unless explicitly listed; matches are case-insensitive and label-boundary aware", () => {
  const checker = createDisposableDomainChecker({domains: ["mailinator.com", "listed.example"]});
  for (const domain of ["school.edu.ph", "company.com.ph", "custom.business", "notmailinator.com", "mailinator.com.company.org", "temporary.business"]) {
    assert.equal(checker.isDisposable(domain), false, domain);
  }
  assert.equal(checker.isDisposable(" INBOX.MAILINATOR.COM "), true);
  assert.equal(checker.isDisposable("listed.example"), true);
});

test("concurrent refreshes coalesce, updates apply atomically, and successful checks refresh daily", async () => {
  let time = 0;
  let calls = 0;
  let release;
  const checker = createDisposableDomainChecker({domains: ["old.example"], now: () => time, logger,
    fetchImpl: async () => {
      calls++;
      await new Promise((resolve) => {release = resolve;});
      return response(list(["new.example"]));
    }});
  const first = checker.refresh();
  const second = checker.refresh();
  assert.equal(first, second);
  assert.equal(calls, 1);
  assert.equal(checker.isDisposable("old.example"), true);
  release();
  assert.equal(await first, true);
  assert.equal(checker.isDisposable("old.example"), false);
  assert.equal(checker.isDisposable("new.example"), true);
  assert.equal(await checker.refresh(), false);
  assert.equal(calls, 1);
  time = 24 * 60 * 60 * 1000;
  const next = checker.refresh();
  release();
  await next;
  assert.equal(calls, 2);
});

test("outages or malformed refreshes preserve existing protection and retry after one hour", async () => {
  for (const failure of ["outage", "malformed", "http-error", "invalid-domain"]) {
    let time = 0;
    let calls = 0;
    const checker = createDisposableDomainChecker({domains: ["gmeenramy.com"], now: () => time, logger,
      fetchImpl: async () => {
        calls++;
        if (failure === "outage") throw new Error("Offline");
        if (failure === "http-error") return {ok: false, status: 503};
        return response(failure === "invalid-domain" ? list(["https://bad.example/path"]) : {invalid: true});
      }});
    assert.equal(await checker.refresh(), false);
    assert.equal(checker.isDisposable("gmeenramy.com"), true);
    await checker.refresh();
    assert.equal(calls, 1);
    time = 60 * 60 * 1000;
    await checker.refresh();
    assert.equal(calls, 2);
  }
});

test("downloads use the normal upstream list and reject duplicate-only payloads or large unexpected removals", async () => {
  await downloadDisposableDomains(async (url, options) => {
    assert.equal(url, DISPOSABLE_LIST_URL);
    assert.equal(url.includes("strict"), false);
    assert.ok(options.signal);
    return response(list());
  });
  await assert.rejects(downloadDisposableDomains(async () => response(Array(1100).fill("duplicate.example"))), /unique/);
  const checker = createDisposableDomainChecker({domains: Array.from({length: 5000}, (_, index) => `old-${index}.example`),
    fetchImpl: async () => response(list()), logger});
  assert.equal(await checker.refresh(), false);
  assert.equal(checker.isDisposable("old-0.example"), true);
});
