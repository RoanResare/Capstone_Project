import { createContext, useContext, useEffect, useRef, useState } from "react";
import { SESSION_SECURITY_EVENT } from "../services/apiClient.js";
import { isValidEmail, ILLEGITIMATE_EMAIL_ERROR } from "../utils/emailValidation.js";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  onAuthStateChanged,
  signInWithCustomToken,
  signOut as signOutFromFirebase,
  setPersistence,
} from "firebase/auth";
import { auth, firebaseConfigError, isFirebaseConfigured } from "../../firebase.js";
import {
  formatFirebaseAuthError,
  isFirebaseConnectionIssue,
  loadExistingUserProfile,
  signInWithEmailPassword,
  updateFirebaseUserProfile,
} from "../services/firebaseAuth.js";
import {
  loadOrCreateCustomerProfile,
  signInCustomerWithEmailPassword,
  signUpCustomerWithEmailPassword,
  updateCustomerProfile,
} from "../services/customerAccount.js";
import {
  completeBackendPasswordReset,
  checkCustomerRegistrationAvailability,
  loginUnifiedUser,
  loginPortalUser,
  requestBackendPasswordReset,
  resendPortalOtp,
  validateBackendPasswordResetCode,
  verifyPortalOtp,
} from "../services/authApi.js";
import {
  isCustomerRole,
  isPortalRole,
  normalizeRole,
  resolveHomePath,
} from "../utils/roleUtils.js";
import {
  resetTransientAuthStorage,
  writeSessionStorageItem,
} from "../utils/browserState.js";
import {
  clearPendingOtpSession,
  clearPortalSession,
  createPortalSessionRecord,
  decodeJwtPayload,
  hasPortalSessionExpired,
  persistPendingOtpSession,
  persistPortalSession,
  readPendingOtpSession,
  readPortalSession,
} from "../utils/portalSession.js";
import { waitForFirebaseUserSession } from "../services/firebaseSession.js";
import { getPasswordPolicyError } from "../utils/passwordPolicy.js";
import { normalizePhilippineMobileNumber, PH_MOBILE_ERROR } from "../utils/phoneNumber.js";
import { waitForCustomerRegistration } from "../utils/customerRegistration.js";
import { getPasswordRecoveryEmailError } from "../utils/passwordRecovery.js";
import {
  clearRememberedCustomerLogin,
  getRememberedCustomerLoginExpiry,
  rememberCustomerLogin,
} from "../utils/customerRememberMe.js";
import {
  clearRememberedPortalLogin,
  persistRememberedPortalLogin,
  readRememberedPortalLogin,
} from "../utils/portalRememberMe.js";

const AuthContext = createContext(null);
function readRememberDeviceToken(role = "") {
  return readRememberedPortalLogin(role).token || "";
}

function persistRememberDeviceToken(role = "", token = "", identifier = "") {
  const normalizedRole = normalizeRole(role);
  const value = typeof token === "string" ? token.trim() : "";

  if (!normalizedRole) {
    return;
  }

  if (value) {
    persistRememberedPortalLogin(normalizedRole, value, identifier);
    return;
  }

  clearRememberedPortalLogin(normalizedRole);
}

function isTimestampExpired(value = "") {
  const timestamp = typeof value === "string" ? value.trim() : "";

  if (!timestamp) {
    return true;
  }

  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now();
}

function normalizePendingOtpRecord(record) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const otpTicketPayload = decodeJwtPayload(record.otpTicket || "");
  const otpTicketExpiresAt =
    typeof otpTicketPayload?.exp === "number"
      ? new Date(otpTicketPayload.exp * 1000).toISOString()
      : "";

  const normalized = {
    deliveryMode: typeof record.deliveryMode === "string" ? record.deliveryMode : "",
    email: typeof record.email === "string" ? record.email : "",
    identifier: typeof record.identifier === "string" ? record.identifier : "",
    otpExpiresAt: typeof record.otpExpiresAt === "string" ? record.otpExpiresAt : "",
    otpTicket: typeof record.otpTicket === "string" ? record.otpTicket : "",
    otpTicketExpiresAt,
    requestedPath: typeof record.requestedPath === "string" ? record.requestedPath : "",
    resendAvailableAt:
      typeof record.resendAvailableAt === "string" ? record.resendAvailableAt : "",
    role: typeof record.role === "string" ? record.role.trim().toLowerCase() : "",
    rememberDevice: record.rememberDevice === true,
  };

  if (
    !normalized.otpTicket ||
    !normalized.role ||
    (normalized.otpTicketExpiresAt && isTimestampExpired(normalized.otpTicketExpiresAt))
  ) {
    clearPendingOtpSession();
    return null;
  }

  return normalized;
}

function maskEmail(value = "") {
  const [localPart = "", domain = ""] = String(value || "").trim().split("@");

  if (!localPart || !domain) {
    return value;
  }

  if (localPart.length <= 2) {
    return `${localPart[0] || "*"}*@${domain}`;
  }

  return `${localPart.slice(0, 2)}***@${domain}`;
}

async function hydrateAuthenticatedUser(firebaseUser) {
  if (!firebaseUser) {
    return {
      accessToken: "",
      user: null,
    };
  }

  const authenticatedUser = await waitForFirebaseUserSession(firebaseUser.uid, {
      forceRefresh: false,
      settleMs: 150,
      timeoutMs: 7000,
    });
  if (!authenticatedUser) {
    throw Object.assign(new Error("Firebase Authentication is not ready to load this profile."), {
      code: "customer/auth-not-ready",
    });
  }
  const accessToken = await authenticatedUser.getIdToken();
  const tokenResult = await authenticatedUser.getIdTokenResult();
  const tokenRole = normalizeRole(tokenResult?.claims?.role);
  const storedPortalSession = readPortalSession();
  const shouldUsePortalProfile =
    isPortalRole(tokenRole) ||
    (storedPortalSession &&
      storedPortalSession.uid === authenticatedUser.uid &&
      isPortalRole(storedPortalSession.role));
  const user = shouldUsePortalProfile
    ? await loadExistingUserProfile(authenticatedUser, {
        email: authenticatedUser.email,
        accountStatus: "active",
        roleHint: tokenRole || storedPortalSession?.role || "",
      })
    : await loadOrCreateCustomerProfile(authenticatedUser, {
        email: authenticatedUser.email,
        accountStatus: "active",
      });

  return {
    accessToken,
    user,
  };
}

function buildConfigErrorResult() {
  return {
    ok: false,
    error:
      firebaseConfigError ||
      "Firebase Authentication is not configured. Fill the VITE_FIREBASE_* values first.",
  };
}

async function configureCustomerAuthPersistence(rememberDevice = false) {
  if (!auth || !isFirebaseConfigured) {
    return;
  }

  await setPersistence(
    auth,
    rememberDevice ? browserLocalPersistence : browserSessionPersistence,
  );
}

async function configurePortalAuthPersistence(rememberDevice = false) {
  if (!auth || !isFirebaseConfigured) {
    return;
  }

  await setPersistence(auth, rememberDevice ? browserLocalPersistence : browserSessionPersistence);
}

function restorePortalAccessToken(user) {
  const storedSession = readPortalSession();

  if (!storedSession) {
    return "";
  }

  if (
    hasPortalSessionExpired(storedSession) ||
    storedSession.uid !== user.uid ||
    storedSession.role !== user.role
  ) {
    clearPortalSession();
    return "";
  }

  return storedSession.accessToken;
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [accessToken, setAccessToken] = useState("");
  const [authHydrationError, setAuthHydrationError] = useState("");
  const [hasFirebaseSession, setHasFirebaseSession] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine !== false,
  );
  const [pendingOtp, setPendingOtp] = useState(() =>
    normalizePendingOtpRecord(readPendingOtpSession()),
  );

  function restorePendingOtpSession(reason = "storage-recovery") {
    const restored = normalizePendingOtpRecord(readPendingOtpSession());

    if (!restored) {
      console.warn("[portal-auth] No pending OTP session could be restored.", {
        reason,
      });
      return null;
    }

    console.info("[portal-auth] Restored pending OTP session.", {
      reason,
      role: restored.role,
      email: maskEmail(restored.email),
      expiresAt: restored.otpExpiresAt,
    });
    setPendingOtp(restored);
    return restored;
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!auth || !isFirebaseConfigured) {
      setCurrentUser(null);
      setAccessToken("");
      setAuthHydrationError("");
      setHasFirebaseSession(false);
      setIsLoading(false);
      return undefined;
    }

    let active = true;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        await waitForCustomerRegistration();
        if (!active || (auth.currentUser?.uid || "") !== (firebaseUser?.uid || "")) return;
        if (!firebaseUser) {
          const restoredPendingOtp = normalizePendingOtpRecord(readPendingOtpSession());

          if (active) {
            clearPortalSession();
            setPendingOtp(restoredPendingOtp);
            setCurrentUser(null);
            setAccessToken("");
            setAuthHydrationError("");
            setHasFirebaseSession(false);
            setIsLoading(false);
          }
          return;
        }

        if (active) {
          setHasFirebaseSession(true);
        }

        const session = await hydrateAuthenticatedUser(firebaseUser);
        if (!active || auth.currentUser?.uid !== firebaseUser.uid) {
          return;
        }

        if (isPortalRole(session.user?.role)) {
          const portalAccessToken = restorePortalAccessToken(session.user);

          if (!portalAccessToken) {
            console.warn(
              "Portal session token is missing or expired. Signing out before restoring a protected portal account.",
            );
            await signOutFromFirebase(auth);
            return;
          }

          clearPendingOtpSession();
          setPendingOtp(null);
          setCurrentUser(session.user);
          setAccessToken(portalAccessToken);
          setAuthHydrationError("");
          return;
        }

        clearPortalSession();
        clearPendingOtpSession();
        setPendingOtp(null);
        setCurrentUser(session.user);
        setAccessToken(session.accessToken);
        setAuthHydrationError("");
      } catch (error) {
        console.error("Unable to restore the Firebase auth session.", error);
        if (!active || auth.currentUser?.uid !== firebaseUser?.uid) {
          return;
        }

        const errorCode = typeof error?.code === "string" ? error.code : "";
        const preservedPendingOtp =
          errorCode === "permission-denied"
            ? normalizePendingOtpRecord(readPendingOtpSession())
            : null;

        setAuthHydrationError(
          formatFirebaseAuthError(error, "Unable to restore the Firebase user session right now."),
        );

        if (isFirebaseConnectionIssue(error)) {
          return;
        }

        try {
          if (auth?.currentUser) {
            await signOutFromFirebase(auth);
          }
        } catch (_signOutError) {
          // Ignore secondary cleanup failures and clear local state below.
        }

        if (!active) {
          return;
        }

        resetTransientAuthStorage();
        clearPortalSession();
        if (preservedPendingOtp) {
          console.warn("[portal-auth] Preserving pending OTP session after Firestore profile denial.", {
            role: preservedPendingOtp.role,
            email: maskEmail(preservedPendingOtp.email),
          });
          setPendingOtp(preservedPendingOtp);
        } else {
          clearPendingOtpSession();
          setPendingOtp(null);
        }
        setCurrentUser(null);
        setAccessToken("");
        setHasFirebaseSession(false);
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  async function signIn({ identifier, email, password, roleHint = "", rememberDevice = false }) {
    if (!isFirebaseConfigured || !auth) {
      return buildConfigErrorResult();
    }

    setAuthHydrationError("");

    try {
      const normalizedRoleHint = normalizeRole(roleHint);
      const loginIdentifier =
        typeof identifier === "string" && identifier.trim()
          ? identifier.trim()
          : typeof email === "string"
            ? email.trim()
            : "";
      const isCustomerLogin = !normalizedRoleHint || isCustomerRole(normalizedRoleHint);
      if (loginIdentifier.includes("@") && !isValidEmail(loginIdentifier)) {
        return { ok: false, error: ILLEGITIMATE_EMAIL_ERROR };
      }
      if (isCustomerLogin) {
        await configureCustomerAuthPersistence(rememberDevice);
      } else {
        await configurePortalAuthPersistence(rememberDevice);
      }

      const signInResult = isCustomerLogin
        ? await signInCustomerWithEmailPassword({
            email: loginIdentifier,
            password,
          })
        : await signInWithEmailPassword({
            identifier: loginIdentifier,
            password,
            roleHint: normalizedRoleHint,
          });
      const { firebaseUser, profile } = signInResult;
      const token = await firebaseUser.getIdToken();

      if (isCustomerRole(profile.role)) {
        if (rememberDevice) rememberCustomerLogin(loginIdentifier, password);
        else clearRememberedCustomerLogin();
      }
      clearPortalSession();
      clearPendingOtpSession();
      setPendingOtp(null);
      setCurrentUser(profile);
      setAccessToken(token);
      setAuthHydrationError("");
      setHasFirebaseSession(true);

      return {
        ok: true,
        user: profile,
        homePath: resolveHomePath(profile.role),
      };
    } catch (error) {
      try {
        if (auth?.currentUser) {
          await signOutFromFirebase(auth);
        }
      } catch (_signOutError) {
        // Ignore cleanup failures; the UI still shows the original sign-in error.
      }

      resetTransientAuthStorage();
      clearPortalSession();
      clearPendingOtpSession();
      setPendingOtp(null);
      setHasFirebaseSession(false);
      setCurrentUser(null);
      setAccessToken("");
      return {
        ok: false,
        error: formatFirebaseAuthError(error, "Unable to sign in right now."),
      };
    }
  }

  async function signUp({ fullName, email, password, confirmPassword, phone = "", username = "" }) {
    if (!isFirebaseConfigured || !auth) {
      return buildConfigErrorResult();
    }

    setAuthHydrationError("");

    if (!fullName?.trim()) {
      return {
        ok: false,
        error: "Full name is required.",
      };
    }

    if (!isValidEmail(email)) {
      return {
        ok: false,
        error: ILLEGITIMATE_EMAIL_ERROR,
      };
    }

    if (!username?.trim()) {
      return {
        ok: false,
        error: "Username is required.",
      };
    }

    if (!password) {
      return {
        ok: false,
        error: "Password is required.",
      };
    }

    const passwordError = getPasswordPolicyError(password);
    if (passwordError) {
      return {
        ok: false,
        error: passwordError,
      };
    }

    const normalizedPhone = normalizePhilippineMobileNumber(phone);
    if (phone && !normalizedPhone) {
      return {
        ok: false,
        error: PH_MOBILE_ERROR,
      };
    }

    if (password !== confirmPassword) {
      return {
        ok: false,
        error: "Passwords do not match.",
      };
    }

    try {
      const registrationCheck = await checkCustomerRegistrationAvailability({
        email: email.trim(),
        phone: normalizedPhone,
      });

      const { firebaseUser, profile } = await signUpCustomerWithEmailPassword({
        fullName,
        email,
        password,
        phone: normalizedPhone,
        username,
        registrationIp: registrationCheck.registrationIp || "",
      });
      const token = await firebaseUser.getIdToken();

      clearPortalSession();
      clearPendingOtpSession();
      setPendingOtp(null);
      setCurrentUser(profile);
      setAccessToken(token);
      setAuthHydrationError("");
      setHasFirebaseSession(true);

      return {
        ok: true,
        user: profile,
        homePath: resolveHomePath(profile.role),
      };
    } catch (error) {
      try {
        if (auth?.currentUser) {
          await signOutFromFirebase(auth);
        }
      } catch (_signOutError) {
        // Ignore cleanup failures; the UI still shows the original sign-up error.
      }

      resetTransientAuthStorage();
      clearPortalSession();
      clearPendingOtpSession();
      setPendingOtp(null);
      setHasFirebaseSession(false);
      setCurrentUser(null);
      setAccessToken("");
      return {
        ok: false,
        error: formatFirebaseAuthError(error, "Unable to create your account right now."),
      };
    }
  }

  async function beginLogin({
    identifier,
    password,
    role = "",
    requestedPath = "",
    rememberDevice = false,
  }) {
    const normalizedRole = typeof role === "string" ? role.trim().toLowerCase() : "";

    if (normalizedRole === "admin" || normalizedRole === "staff") {
      if (!isFirebaseConfigured || !auth) {
        return buildConfigErrorResult();
      }

      if (!identifier?.trim()) {
        return {
          ok: false,
          error: "Email or username is required.",
        };
      }

      if (!password) {
        return {
          ok: false,
          error: "Password is required.",
        };
      }

      setAuthHydrationError("");

      try {
        console.info("[portal-auth] Starting protected portal login.", {
          role: normalizedRole,
          identifierType: identifier.includes("@") ? "email" : "username",
        });
        if (!rememberDevice) clearRememberedPortalLogin(normalizedRole);
        const response = await loginPortalUser(normalizedRole, {
          identifier: identifier.trim(),
          password,
          rememberDevice,
          rememberDeviceToken: rememberDevice ? readRememberDeviceToken(normalizedRole) : "",
        });

        clearPortalSession();
        clearPendingOtpSession();

        if (!response.requiresTwoFactor) {
          return await finalizePortalLogin(response, {
            requestedPath,
            rememberDevice,
            role: normalizedRole,
            identifier: identifier.trim(),
          });
        }

        const nextPendingOtp = normalizePendingOtpRecord({
          identifier: identifier.trim(),
          deliveryMode: response.deliveryMode || "",
          email: response.user?.email || "",
          otpExpiresAt: response.otpExpiresAt || "",
          otpTicket: response.otpTicket || "",
          requestedPath,
          resendAvailableAt: response.otpResendAvailableAt || "",
          role: normalizedRole,
          rememberDevice,
        });

        if (!nextPendingOtp) {
          return {
            ok: false,
            error: "The server did not return a valid OTP verification session.",
          };
        }

        const persisted = persistPendingOtpSession(nextPendingOtp);
        setPendingOtp(nextPendingOtp);
        console.info("[portal-auth] OTP challenge issued.", {
          role: normalizedRole,
          email: maskEmail(nextPendingOtp.email),
          expiresAt: nextPendingOtp.otpExpiresAt,
          resendAvailableAt: nextPendingOtp.resendAvailableAt,
          persisted,
        });

        return {
          ok: true,
          requiresTwoFactor: true,
          message: response.message,
          verificationPath: "/verify-otp",
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Unable to sign in right now.",
        };
      }
    }

    return signIn({
      identifier,
      password,
      roleHint: normalizedRole,
      rememberDevice,
    });
  }

  async function beginUnifiedLogin({
    identifier,
    password,
    requestedPath = "",
    rememberDevice = false,
  }) {
    if (!isFirebaseConfigured || !auth) {
      return buildConfigErrorResult();
    }

    if (!identifier?.trim()) {
      return {
        ok: false,
        error: "Email or username is required.",
      };
    }

    if (!password) {
      return {
        ok: false,
        error: "Password is required.",
      };
    }

    setAuthHydrationError("");

    try {
      if (!rememberDevice) {
        clearRememberedCustomerLogin();
        clearRememberedPortalLogin();
      }
      const response = await loginUnifiedUser({
        identifier: identifier.trim(),
        password,
        rememberDevice,
        rememberDeviceTokens: {
          admin: rememberDevice ? readRememberDeviceToken("admin") : "",
          staff: rememberDevice ? readRememberDeviceToken("staff") : "",
        },
      });
      const responseRole = normalizeRole(response.user?.role);

      clearPortalSession();
      clearPendingOtpSession();

      if (response.requiresTwoFactor && isPortalRole(responseRole)) {
        const nextPendingOtp = normalizePendingOtpRecord({
          identifier: identifier.trim(),
          deliveryMode: response.deliveryMode || "",
          email: response.user?.email || "",
          otpExpiresAt: response.otpExpiresAt || "",
          otpTicket: response.otpTicket || "",
          requestedPath,
          resendAvailableAt: response.otpResendAvailableAt || "",
          role: responseRole,
          rememberDevice,
        });

        if (!nextPendingOtp) {
          return {
            ok: false,
            error: "The server did not return a valid OTP verification session.",
          };
        }

        persistPendingOtpSession(nextPendingOtp);
        setPendingOtp(nextPendingOtp);

        return {
          ok: true,
          requiresTwoFactor: true,
          message: response.message,
          verificationPath: "/verify-otp",
        };
      }

      if (!response.firebaseCustomToken || !response.accessToken) {
        return {
          ok: false,
          error: "The server did not return a complete login session.",
        };
      }

      if (isPortalRole(responseRole)) {
        return await finalizePortalLogin(response, { requestedPath, rememberDevice, identifier: identifier.trim() });
      } else {
        await configureCustomerAuthPersistence(rememberDevice);
      }

      const credentials = await signInWithCustomToken(auth, response.firebaseCustomToken);
      const hydratedSession = await hydrateAuthenticatedUser(credentials.user);
      const sessionToken = isPortalRole(hydratedSession.user?.role)
        ? response.accessToken
        : hydratedSession.accessToken;

      if (isCustomerRole(hydratedSession.user?.role)) {
        if (rememberDevice) rememberCustomerLogin(identifier.trim(), password);
        else clearRememberedCustomerLogin();
      }
      setPendingOtp(null);
      setCurrentUser(hydratedSession.user);
      setAccessToken(sessionToken);
      setAuthHydrationError("");
      setHasFirebaseSession(true);

      return {
        ok: true,
        user: hydratedSession.user,
        homePath: resolveHomePath(hydratedSession.user.role),
      };
    } catch (error) {
      try {
        if (auth?.currentUser) {
          await signOutFromFirebase(auth);
        }
      } catch (_signOutError) {
        // Ignore cleanup failures; the UI still shows the original sign-in error.
      }

      resetTransientAuthStorage();
      clearPortalSession();
      clearPendingOtpSession();
      setPendingOtp(null);
      setHasFirebaseSession(false);
      setCurrentUser(null);
      setAccessToken("");

      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to sign in right now.",
      };
    }
  }

  async function refreshCurrentUser() {
    if (!auth?.currentUser) {
      setCurrentUser(null);
      setAccessToken("");
      return null;
    }

    try {
      const session = await hydrateAuthenticatedUser(auth.currentUser);
      if (isPortalRole(session.user?.role)) {
        const portalToken = restorePortalAccessToken(session.user);

        if (!portalToken) {
          await signOutFromFirebase(auth);
          clearPortalSession();
          setCurrentUser(null);
          setAccessToken("");
          setHasFirebaseSession(false);
          return null;
        }

        setCurrentUser(session.user);
        setAccessToken(portalToken);
      } else {
        setCurrentUser(session.user);
        setAccessToken(session.accessToken);
      }
      setAuthHydrationError("");
      setHasFirebaseSession(true);
      return session.user;
    } catch (error) {
      console.error("Unable to refresh the Firebase user profile.", error);
      setAuthHydrationError(
        formatFirebaseAuthError(error, "Unable to refresh the Firebase user profile right now."),
      );
      return null;
    }
  }

  async function updateProfile(payload) {
    if (!currentUser) {
      return {
        ok: false,
        error: "You must be signed in to update your profile.",
      };
    }

    try {
      const user = isCustomerRole(currentUser.role)
        ? await updateCustomerProfile(currentUser, payload)
        : await updateFirebaseUserProfile(currentUser, payload);
      setCurrentUser(user);

      return {
        ok: true,
        user,
      };
    } catch (error) {
      return {
        ok: false,
        error: formatFirebaseAuthError(error, "Unable to update the profile right now."),
      };
    }
  }

  async function signOut() {
    try {
      if (auth) {
        await signOutFromFirebase(auth);
      }
    } catch (_error) {
      // Firebase persistence can already be cleared in some flows.
    } finally {
      resetTransientAuthStorage();
      clearPortalSession();
      clearPendingOtpSession();
      setPendingOtp(null);
      setCurrentUser(null);
      setAccessToken("");
      setAuthHydrationError("");
      setHasFirebaseSession(false);
    }
  }

  useEffect(() => {
    if (!isCustomerRole(currentUser?.role) && !isPortalRole(currentUser?.role)) {
      return undefined;
    }

    const expiresAt = isCustomerRole(currentUser.role)
      ? getRememberedCustomerLoginExpiry()
      : readRememberedPortalLogin(currentUser.role).credentials?.expiresAt;
    if (!expiresAt) {
      return undefined;
    }

    const remainingMs = expiresAt - Date.now();
    if (remainingMs <= 0) {
      void signOut();
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      void signOut();
    }, remainingMs);

    return () => window.clearTimeout(timeout);
  }, [currentUser?.uid, currentUser?.role]);

  const securitySignOutRef = useRef(signOut);
  securitySignOutRef.current = signOut;
  useEffect(() => {
    let terminating = false;
    const terminate = async (event) => {
      if (terminating) return;
      terminating = true;
      writeSessionStorageItem("furfection-security-warning", event.detail.message);
      clearRememberedCustomerLogin();
      clearRememberedPortalLogin();
      try { await securitySignOutRef.current(); }
      finally { window.location.replace("/login"); }
    };
    window.addEventListener(SESSION_SECURITY_EVENT, terminate);
    return () => window.removeEventListener(SESSION_SECURITY_EVENT, terminate);
  }, []);

  async function requestPasswordReset(identifier) {
    setAuthHydrationError("");

    const validationError = getPasswordRecoveryEmailError(identifier);
    if (validationError) {
      return {
        ok: false,
        error: validationError,
      };
    }

    try {
      const response = await requestBackendPasswordReset(identifier.trim());
      return {
        ok: true,
        message:
          response.message ||
          "If an account exists for that email, a password reset link has been sent.",
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to send a password reset email right now.",
      };
    }
  }

  async function validatePasswordResetCode(oobCode) {
    if (!oobCode?.trim()) {
      return {
        ok: false,
        error: "The password reset link is missing its verification code.",
      };
    }

    try {
      const response = await validateBackendPasswordResetCode(oobCode.trim());
      return {
        ok: true,
        email: response.email || "",
      };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to verify the password reset link right now.",
      };
    }
  }

  async function completePasswordReset({ oobCode, resetToken, newPassword, confirmPassword }) {
    const resetCode = oobCode?.trim() || resetToken?.trim() || "";

    if (!resetCode) {
      return {
        ok: false,
        error: "The password reset link is missing its verification code.",
      };
    }

    if (!newPassword) {
      return {
        ok: false,
        error: "New password is required.",
      };
    }

    const passwordError = getPasswordPolicyError(newPassword);
    if (passwordError) {
      return {
        ok: false,
        error: passwordError,
      };
    }

    if (newPassword !== confirmPassword) {
      return {
        ok: false,
        error: "Passwords do not match.",
      };
    }

    try {
      const response = await completeBackendPasswordReset({
        oobCode: resetCode,
        newPassword,
        confirmPassword,
      });
      return {
        ok: true,
        message:
          response.message ||
          "Password reset successful. You can sign in with your new password now.",
      };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error ? error.message : "Unable to reset the password right now.",
      };
    }
  }

  async function finalizePortalLogin(response, pendingSession = pendingOtp) {
    if (!isFirebaseConfigured || !auth) {
      return buildConfigErrorResult();
    }

    const firebaseCustomToken =
      typeof response?.firebaseCustomToken === "string" ? response.firebaseCustomToken.trim() : "";
    const nextAccessToken =
      typeof response?.accessToken === "string" ? response.accessToken.trim() : "";

    if (!firebaseCustomToken || !nextAccessToken) {
      return {
        ok: false,
        error: "The server did not return a complete portal session.",
      };
    }

    const portalSession = createPortalSessionRecord(nextAccessToken);

    if (
      !portalSession.accessToken ||
      hasPortalSessionExpired(portalSession)
    ) {
      throw new Error("The portal session token could not be validated.");
    }

    await configurePortalAuthPersistence(pendingSession?.rememberDevice === true);
    persistPortalSession(portalSession);
    const credentials = await signInWithCustomToken(auth, firebaseCustomToken);
    const hydratedSession = await hydrateAuthenticatedUser(credentials.user);

    if (
      portalSession.uid !== hydratedSession.user?.uid ||
      portalSession.role !== hydratedSession.user?.role
    ) {
      clearPortalSession();
      throw new Error("The portal session token could not be matched to the signed-in user.");
    }

    persistRememberDeviceToken(
      hydratedSession.user.role,
      pendingSession?.rememberDevice ? response?.rememberDeviceToken || "" : "",
      pendingSession?.identifier || hydratedSession.user.email,
    );
    clearPendingOtpSession();
    setPendingOtp(null);
    setCurrentUser(hydratedSession.user);
    setAccessToken(nextAccessToken);
    setAuthHydrationError("");
    setHasFirebaseSession(true);

    return {
      ok: true,
      user: hydratedSession.user,
      homePath: resolveHomePath(hydratedSession.user.role),
      requestedPath: pendingSession?.requestedPath || "",
    };
  }

  async function resendOtp() {
    const activePendingOtp = pendingOtp || restorePendingOtpSession("resend");

    if (!activePendingOtp?.otpTicket || !activePendingOtp?.role) {
      return {
        ok: false,
        error: "There is no active OTP challenge. Sign in again to request a new code.",
      };
    }

    try {
      console.info("[portal-auth] Requesting a new OTP code.", {
        role: activePendingOtp.role,
        email: maskEmail(activePendingOtp.email),
      });
      const response = await resendPortalOtp(activePendingOtp.role, activePendingOtp.otpTicket);
      const nextPendingOtp = normalizePendingOtpRecord({
        deliveryMode: response.deliveryMode || activePendingOtp.deliveryMode || "",
        email: response.user?.email || activePendingOtp.email || "",
        otpExpiresAt: response.otpExpiresAt || activePendingOtp.otpExpiresAt,
        otpTicket: response.otpTicket || activePendingOtp.otpTicket,
        requestedPath: activePendingOtp.requestedPath || "",
        resendAvailableAt: response.otpResendAvailableAt || activePendingOtp.resendAvailableAt,
        role: activePendingOtp.role,
        rememberDevice: activePendingOtp.rememberDevice,
      });

      if (!nextPendingOtp) {
        console.warn("[portal-auth] The backend response did not contain a restorable OTP session.");
        return {
          ok: false,
          error: "The server did not return a valid OTP verification session.",
        };
      }

      const persisted = persistPendingOtpSession(nextPendingOtp);
      setPendingOtp(nextPendingOtp);
      console.info("[portal-auth] OTP challenge refreshed.", {
        role: nextPendingOtp.role,
        email: maskEmail(nextPendingOtp.email),
        expiresAt: nextPendingOtp.otpExpiresAt,
        resendAvailableAt: nextPendingOtp.resendAvailableAt,
        persisted,
      });

      return {
        ok: true,
        message: response.message,
      };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to send a new verification code right now.",
      };
    }
  }

  async function verifyPendingOtp(otpCode) {
    const activePendingOtp = pendingOtp || restorePendingOtpSession("verify");

    if (!activePendingOtp?.otpTicket || !activePendingOtp?.role) {
      return {
        ok: false,
        error: "There is no active OTP challenge. Sign in again to continue.",
      };
    }

    const normalizedCode = typeof otpCode === "string" ? otpCode.trim() : "";

    if (!normalizedCode) {
      return {
        ok: false,
        error: "Enter the verification code first.",
      };
    }

    try {
      console.info("[portal-auth] Verifying OTP challenge.", {
        role: activePendingOtp.role,
        email: maskEmail(activePendingOtp.email),
      });
      const response = await verifyPortalOtp(
        activePendingOtp.role,
        activePendingOtp.otpTicket,
        normalizedCode,
        { rememberDevice: activePendingOtp.rememberDevice },
      );

      return await finalizePortalLogin(response, activePendingOtp);
    } catch (error) {
      const statusCode = Number(error?.statusCode || 0);
      const rawMessage = error instanceof Error ? error.message : "";
      const isExpectedOtpFailure = [400, 401, 404, 409, 429].includes(statusCode);
      const safeMessage = isExpectedOtpFailure
        ? "Invalid or expired OTP code. Please try again."
        : "Unable to verify the OTP code right now. Please try again.";

      console.warn("[portal-auth] OTP verification failed.", {
        role: activePendingOtp.role,
        email: maskEmail(activePendingOtp.email),
        error: rawMessage || error,
        statusCode,
      });
      return {
        ok: false,
        error: safeMessage,
      };
    }
  }

  function clearPendingOtp() {
    clearPendingOtpSession();
    setPendingOtp(null);
  }

  const value = {
    accessToken,
    authHydrationError,
    beginLogin,
    beginUnifiedLogin,
    clearPendingOtp,
    completePasswordReset,
    currentUser,
    firebaseConfigError,
    hasFirebaseSession,
    homePath: resolveHomePath(currentUser?.role),
    isAuthenticated: Boolean(currentUser),
    isFirebaseConfigured,
    isCustomerUser: isCustomerRole(currentUser?.role),
    isLoading,
    isOnline,
    isPortalUser: isPortalRole(currentUser?.role),
    pendingOtp,
    refreshCurrentUser,
    requestPasswordReset,
    resendOtp,
    signIn,
    signOut,
    signUp,
    updateProfile,
    validatePasswordResetCode,
    verifyPendingOtp,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
}
