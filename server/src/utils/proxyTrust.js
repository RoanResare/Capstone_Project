// Traverse internal ingress hops, stopping at the nearest untrusted address.
function getTrustedProxies(extraCidrs = "") {
  return ["loopback", "linklocal", "uniquelocal", ...extraCidrs.split(",").map((value) => value.trim()).filter(Boolean)];
}

module.exports = { getTrustedProxies };
