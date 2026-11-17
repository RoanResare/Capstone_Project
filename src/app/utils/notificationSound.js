import { useEffect, useRef } from "react";

let audioContext;

export function playNotificationSound() {
  if (typeof window === "undefined") return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  try {
    audioContext ||= new AudioContextClass();
    if (audioContext.state === "suspended") void audioContext.resume().catch(() => {});

    const startAt = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(740, startAt);
    oscillator.frequency.setValueAtTime(988, startAt + 0.09);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.12, startAt + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.28);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + 0.29);
  } catch {
    // Browser audio can be unavailable or blocked until the user interacts.
  }
}

export function useNotificationSound(notifications, userId) {
  const trackingRef = useRef(null);

  useEffect(() => {
    if (!userId || typeof window === "undefined") return undefined;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return undefined;
    const primeAudio = () => {
      try {
        audioContext ||= new AudioContextClass();
        if (audioContext.state === "suspended") void audioContext.resume().catch(() => {});
      } catch {
        // Audio remains optional in browsers that do not allow playback.
      }
    };
    window.addEventListener("pointerdown", primeAudio, { once: true });
    window.addEventListener("keydown", primeAudio, { once: true });
    return () => {
      window.removeEventListener("pointerdown", primeAudio);
      window.removeEventListener("keydown", primeAudio);
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      trackingRef.current = null;
      return;
    }

    if (trackingRef.current?.userId !== userId) {
      trackingRef.current = {
        userId,
        startedAt: Date.now(),
        seenIds: new Set((notifications || []).map((notification) => notification.id)),
      };
      return;
    }

    const tracking = trackingRef.current;
    for (const notification of notifications || []) {
      if (!notification?.id || tracking.seenIds.has(notification.id)) continue;
      tracking.seenIds.add(notification.id);
      const createdAt = Date.parse(notification.createdAt || "");
      const isUnread = !Array.isArray(notification.readBy) || !notification.readBy.includes(userId);
      if (isUnread && Number.isFinite(createdAt) && createdAt >= tracking.startedAt) {
        playNotificationSound();
      }
    }
  }, [notifications, userId]);
}
