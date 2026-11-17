import { useEffect, useState } from "react";
import { readSessionStorageItem, writeSessionStorageItem } from "./browserState.js";
import { getAttemptLockSecondsRemaining, getServerLockDeadline } from "./attemptLockTime.js";

// The server enforces the lock; this cache only keeps the countdown across refreshes.
export function useAttemptLock(scope, identity = "") {
  const key = `furfection-attempt-lock:${scope}:${identity.trim().toLowerCase()}`;
  const [now, setNow] = useState(() => Date.now());
  const [lock, setLock] = useState({ key, until: Number(readSessionStorageItem(key)) || 0 });
  const until = lock.key === key ? lock.until : Number(readSessionStorageItem(key)) || 0;
  const secondsRemaining = getAttemptLockSecondsRemaining(until, now);
  useEffect(() => {
    if (!secondsRemaining) {
      if (until && until <= Date.now()) writeSessionStorageItem(key, "");
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [key, until, secondsRemaining > 0]);
  const applyLock = (result) => {
    const serverDeadline = getServerLockDeadline(result);
    if (!serverDeadline) return;
    writeSessionStorageItem(key, String(serverDeadline));
    setLock({ key, until: serverDeadline });
    setNow(Date.now());
  };
  return { secondsRemaining, applyLock };
}
