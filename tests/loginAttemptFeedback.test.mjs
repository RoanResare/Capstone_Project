import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { getLoginAttemptFeedback } from "../src/app/utils/loginAttemptFeedback.js";
import { formatAttemptLockCountdown, getAttemptLockSecondsRemaining, getServerLockDeadline } from "../src/app/utils/attemptLockTime.js";

test("login feedback displays the backend's remaining-attempt count with singular grammar", () => {
  for (let remaining = 4; remaining >= 1; remaining--) {
    assert.equal(getLoginAttemptFeedback({
      error: "Invalid email, username, or password.",
      details: { code: "INVALID_LOGIN_CREDENTIALS", attemptsRemaining: remaining },
    }), `Invalid credentials. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`);
  }
});

test("login lock feedback uses server retry metadata and preserves the generic fallback", () => {
  const result = {
    error: "Too many failed attempts.",
    details: { code: "AUTH_ATTEMPTS_LOCKED", retryAfterSeconds: 60, lockedUntil: "2030-01-01T12:01:00.000Z" },
  };
  assert.equal(getLoginAttemptFeedback(result), "Too many failed attempts. Please try again in 60 seconds.");
  const deadline = getServerLockDeadline(result);
  assert.equal(deadline, Date.parse("2030-01-01T12:01:00.000Z"));
  assert.equal(getAttemptLockSecondsRemaining(deadline, deadline - 59_100), 60);
  assert.equal(formatAttemptLockCountdown(59), "00:59");
  assert.equal(getAttemptLockSecondsRemaining(deadline, deadline), 0);
  assert.equal(getLoginAttemptFeedback({ error: "Authentication service unavailable." }), "Authentication service unavailable.");
});

test("login failures stay inline instead of creating stacked global error toasts", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  for (const file of ["src/app/components/UnifiedLogin.jsx", "src/app/components/RoleLoginPage.jsx"]) {
    const source = await readFile(path.join(root, file), "utf8");
    assert.match(source, /getLoginAttemptFeedback\(result\)/);
    assert.doesNotMatch(source, /showErrorToast\(result\.error\)/);
  }
});
