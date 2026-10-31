export function getServerLockDeadline(result) {
  if (result?.details?.code !== "AUTH_ATTEMPTS_LOCKED") return 0;
  const deadline = Date.parse(result.details.lockedUntil);
  return Number.isFinite(deadline) ? deadline : 0;
}

export function getAttemptLockSecondsRemaining(deadline, now = Date.now()) {
  return Math.max(0, Math.ceil((Number(deadline) - now) / 1000));
}

export function formatAttemptLockCountdown(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
