import { useEffect, useState } from "react";
import { readSessionStorageItem, writeSessionStorageItem } from "./browserState.js";

// The server enforces the lock; this cache only keeps the countdown across refreshes.
export function useAttemptLock(scope, identity = "") {
  const key = `furfection-attempt-lock:${scope}:${identity.trim().toLowerCase()}`;
  const [now, setNow] = useState(() => Date.now());
  const [lock, setLock] = useState({ key, until: Number(readSessionStorageItem(key)) || 0 });
  const until = lock.key === key ? lock.until : Number(readSessionStorageItem(key)) || 0;
  const secondsRemaining = Math.max(0, Math.ceil((until - now) / 1000));
  useEffect(() => {
    if (!secondsRemaining) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [key, until, secondsRemaining > 0]);
  const applyLock = (result) => {
    if (result?.details?.code !== "AUTH_ATTEMPTS_LOCKED") return;
    const deadline = Date.parse(result.details.lockedUntil);
    if (!Number.isFinite(deadline)) return;
    writeSessionStorageItem(key, String(deadline));
    setLock({ key, until: deadline });
    setNow(Date.now());
  };
  return { secondsRemaining, applyLock };
}
