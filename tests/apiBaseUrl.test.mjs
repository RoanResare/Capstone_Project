import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveApiBaseUrl } from "../src/app/utils/apiBaseUrl.js";

test("production signup requests use the same origin as the served frontend", () => {
  for (const configured of [undefined, "", "   "]) {
    assert.equal(new URL(`${resolveApiBaseUrl(configured, true)}/auth/register/profile`, "https://clinic.example/signup").href,
      "https://clinic.example/api/auth/register/profile");
  }
  assert.equal(resolveApiBaseUrl(undefined, false), "http://localhost:5000/api");
  for (const configured of ["https://api.charmingfurfectionpetscareservices.online/api", "/api", "https://api.example/api"]) {
    assert.equal(resolveApiBaseUrl(configured, true), "/api");
  }
  assert.equal(resolveApiBaseUrl("https://api.example/api", false), "https://api.example/api");
  assert.equal(resolveApiBaseUrl("https://api.charmingfurfectionpetscareservices.online/", true), "/api");
});
