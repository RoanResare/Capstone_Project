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

    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      unsubscribe();
      resolve();
    };

    unsubscribe = onIdTokenChanged(auth, (user) => {
      if (!expectedUid || !user?.uid || user.uid === expectedUid) {
        finish();
      }
    });

    globalThis.setTimeout(finish, timeoutMs);
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
        await currentUser.getIdToken(forceRefresh);

        if (settleMs > 0) {
          await wait(settleMs);
        }

        const refreshedUser = auth.currentUser;
        if (refreshedUser?.uid && (!normalizedUid || refreshedUser.uid === normalizedUid)) {
          return refreshedUser;
        }

        return currentUser;
      } catch (_error) {
        // Wait for the next auth/id-token event below.
      }
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }

    await Promise.race([
      wait(Math.min(remainingMs, 125)),
      waitForIdTokenSync(normalizedUid, Math.min(remainingMs, 400)),
    ]);
  }

  const currentUser = auth.currentUser;
  return currentUser?.uid && (!normalizedUid || currentUser.uid === normalizedUid)
    ? currentUser
    : null;
}
