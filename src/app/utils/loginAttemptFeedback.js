export function getLoginAttemptFeedback(result) {
  const details = result?.details;
  if (details?.code === "AUTH_ATTEMPTS_LOCKED") {
    const seconds = Number(details.retryAfterSeconds);
    return Number.isFinite(seconds) && seconds > 0
      ? `Too many failed attempts. Please try again in ${seconds} seconds.`
      : "Too many failed attempts. Login is temporarily restricted.";
  }

  if (details?.code === "INVALID_LOGIN_CREDENTIALS") {
    const remaining = Number(details.attemptsRemaining);
    if (Number.isInteger(remaining) && remaining > 0 && remaining < 5) {
      return `Invalid credentials. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`;
    }
  }

  return result?.error || "Unable to sign in right now.";
}
