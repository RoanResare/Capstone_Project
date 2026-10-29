const assert = require("node:assert/strict");
const { test } = require("node:test");
const express = require("express");
const { getTrustedProxies } = require("../src/utils/proxyTrust");

function observedIp(peer, forwarded, extraCidrs) {
  const app = express();
  app.set("trust proxy", getTrustedProxies(extraCidrs));
  const req = Object.create(app.request);
  req.app = app;
  req.connection = { remoteAddress: peer };
  req.headers = { "x-forwarded-for": forwarded };
  return req.ip;
}

test("internal multi-hop ingress resolves the public client rather than a private load balancer", () => {
  assert.equal(observedIp("10.0.0.2", "1.2.3.4, 172.16.0.5, 10.0.0.3"), "1.2.3.4");
  assert.equal(observedIp("::ffff:10.0.0.2", "1.2.3.4, 192.168.1.2"), "1.2.3.4");
});

test("untrusted clients cannot override their IP with forged forwarding headers", () => {
  assert.equal(observedIp("8.8.8.8", "1.2.3.4"), "8.8.8.8");
  assert.equal(observedIp("10.0.0.2", "1.2.3.4, 8.8.8.8"), "8.8.8.8");
});

test("explicit deployment CIDRs allow a known public ingress without trusting arbitrary hops", () => {
  assert.equal(observedIp("203.0.113.5", "1.2.3.4", "203.0.113.0/24"), "1.2.3.4");
  assert.equal(observedIp("8.8.8.8", "1.2.3.4", "203.0.113.0/24"), "8.8.8.8");
});
