const { domainToASCII } = require("node:url");

const DISPOSABLE_LIST_URL = "https://raw.githubusercontent.com/disposable/disposable-email-domains/master/domains.json";

function normalizeDomain(value) {
  if (typeof value !== "string") return "";
  const domain = domainToASCII(value.trim().toLowerCase());
  if (domain.length > 253 || !domain.includes(".") ||
      !domain.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return "";
  return domain;
}

async function downloadDisposableDomains(fetchImpl = fetch) {
  const response = await fetchImpl(DISPOSABLE_LIST_URL, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Disposable domain list returned HTTP ${response.status}.`);
  const payload = await response.json();
  if (!Array.isArray(payload) || payload.length < 1000 || payload.length > 500000) {
    throw new Error("Disposable domain list has an invalid size or format.");
  }
  const domains = payload.map(normalizeDomain);
  if (domains.some((domain) => !domain)) throw new Error("Disposable domain list contains invalid domains.");
  const uniqueDomains = [...new Set(domains)].sort();
  if (uniqueDomains.length < 1000) throw new Error("Disposable domain list contains too few unique domains.");
  return uniqueDomains;
}

module.exports = { DISPOSABLE_LIST_URL, normalizeDomain, downloadDisposableDomains };
