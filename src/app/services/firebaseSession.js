import { onIdTokenChanged } from "firebase/auth";
import { auth, authPersistenceReadyPromise } from "../../firebase.js";

function normalizeString(value = "") {
  return typeof value === "string" ? value.trim() : "";
}

function wait(ms) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function waitForIdTokenSync(expectedUid = "", timeoutMs = 250) {
  if (!auth) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe = () => {};

    let timer;
    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      globalThis.clearTimeout(timer);
      unsubscribe();
      resolve();
    };

    timer = globalThis.setTimeout(finish, timeoutMs);
    unsubscribe = onIdTokenChanged(auth, (user) => {
      if (user?.uid && (!expectedUid || user.uid === expectedUid)) {
        finish();
      }
    }, finish);
    if (settled) unsubscribe();
  });
}

export async function waitForFirebaseUserSession(
  expectedUid = "",
  { timeoutMs = 7000, forceRefresh = false, settleMs = 150 } = {},
) {
  const normalizedUid = normalizeString(expectedUid);

  if (!auth) {
    return null;
  }

  await authPersistenceReadyPromise;

  if (typeof auth.authStateReady === "function") {
    try {
      await auth.authStateReady();
    } catch (_error) {
      // Fallback to the polling loop below when auth state bootstrap fails.
    }
  }

  const deadline = Date.now() + Math.max(timeoutMs, 0);

  while (Date.now() <= deadline) {
    const currentUser = auth.currentUser;
    const matchesUser = currentUser?.uid && (!normalizedUid || currentUser.uid === normalizedUid);

    if (matchesUser) {
      try {
        const token = await currentUser.getIdToken(forceRefresh);
        if (!token) throw new Error("Firebase did not return an ID token.");

        if (settleMs > 0) {
          await wait(settleMs);
        }

        const refreshedUser = auth.currentUser;
        if (refreshedUser === currentUser && (!normalizedUid || refreshedUser.uid === normalizedUid)) {
          return refreshedUser;
        }
      } catch (_error) {
        // Wait for the next auth/id-token event below.
      }
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }

    await waitForIdTokenSync(normalizedUid, Math.min(remainingMs, 125));
    // A token event can arrive immediately even while token retrieval is failing.
    await wait(Math.min(Math.max(deadline - Date.now(), 0), 125));
  }

  return null;
}
