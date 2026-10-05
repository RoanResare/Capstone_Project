const bundledDomains = require("../data/disposable-email-domains.json");
const { normalizeDomain, downloadDisposableDomains } = require("../utils/disposableDomainList");

const protectedDomains = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.com.ph", "ymail.com", "rocketmail.com",
  "outlook.com", "hotmail.com", "live.com", "msn.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "proton.me", "protonmail.com", "zoho.com", "sti.edu",
]);
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

function isProtectedEmailDomain(domain) {
  return protectedDomains.has(domain) || domain.endsWith(".sti.edu");
}

function createDisposableDomainChecker({ domains = bundledDomains, fetchImpl, now = Date.now, logger = console } = {}) {
  let activeDomains = new Set(domains.map(normalizeDomain).filter(Boolean));
  let nextRefreshAt = 0;
  let inFlight;
  let timer;
  function isDisposable(domain) {
    domain = normalizeDomain(domain);
    if (!domain || isProtectedEmailDomain(domain)) return false;
    const labels = domain.split(".");
    for (let index = 0; index < labels.length - 1; index++) {
      if (activeDomains.has(labels.slice(index).join("."))) return true;
    }
    return false;
  }
  function refresh() {
    if (inFlight) return inFlight;
    if (now() < nextRefreshAt) return Promise.resolve(false);
    inFlight = downloadDisposableDomains(fetchImpl).then((updated) => {
      if (updated.length < activeDomains.size / 2) throw new Error("Disposable domain list unexpectedly lost most of its entries.");
      // Replace atomically so upstream removals can correct false positives.
      activeDomains = new Set(updated);
      nextRefreshAt = now() + DAY;
      return true;
    }).catch((error) => {
      nextRefreshAt = now() + HOUR;
      logger.warn("[registration-security] Disposable list refresh failed; retaining the last known list.", { error: error.message });
      return false;
    }).finally(() => { inFlight = undefined; });
    return inFlight;
  }
  function start() {
    if (timer) return;
    void refresh();
    timer = setInterval(() => { void refresh(); }, HOUR);
    timer.unref();
  }
  return { isDisposable, refresh, start };
}

const checker = createDisposableDomainChecker();
module.exports = {
  isDisposableEmailDomain: checker.isDisposable,
  isProtectedEmailDomain,
  startDisposableEmailUpdates: checker.start,
  createDisposableDomainChecker,
};
