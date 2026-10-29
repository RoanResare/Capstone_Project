import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveApiBaseUrl } from "../src/app/utils/apiBaseUrl.js";

test("production signup requests use the hosted API instead of the visitor's localhost", () => {
  for (const configured of [undefined, "", "   "]) {
    assert.equal(new URL(`${resolveApiBaseUrl(configured, true)}/auth/register/profile`, "https://clinic.example/signup").href,
      "https://capstone-project-bczf.onrender.com/api/auth/register/profile");
  }
  assert.equal(resolveApiBaseUrl(undefined, false), "http://localhost:5000/api");
  for (const configured of ["https://api.charmingfurfectionpetscareservices.online/api", "/api", "https://api.example/api"]) {
    assert.equal(resolveApiBaseUrl(configured, true), "https://capstone-project-bczf.onrender.com/api");
  }
  assert.equal(resolveApiBaseUrl("https://api.example/api", false), "https://api.example/api");
  assert.equal(resolveApiBaseUrl("https://capstone-project-bczf.onrender.com/", true),
    "https://capstone-project-bczf.onrender.com/api");
  assert.equal(resolveApiBaseUrl("https://capstone-project-bczf.onrender.com/api/", true),
    "https://capstone-project-bczf.onrender.com/api");
});
