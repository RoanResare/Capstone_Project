import assert from "node:assert/strict";
import { test } from "node:test";
import { setSecuritySession, getSecurityEpoch, isCurrentSecurityResponse } from "../src/app/utils/securitySession.js";

test("old responses cannot log out a new session for the same account", () => {
  setSecuritySession("customer");
  const previous = getSecurityEpoch();
  assert.equal(isCurrentSecurityResponse(previous), true);
  setSecuritySession();
  assert.equal(isCurrentSecurityResponse(previous), false);
  setSecuritySession("customer");
  assert.equal(isCurrentSecurityResponse(previous), false);
  assert.equal(isCurrentSecurityResponse(getSecurityEpoch()), true);
  const beforeReplacement = getSecurityEpoch();
  setSecuritySession("customer", "fresh-token");
  assert.equal(isCurrentSecurityResponse(beforeReplacement), false);
  assert.equal(isCurrentSecurityResponse(getSecurityEpoch()), true);
  setSecuritySession();
});
