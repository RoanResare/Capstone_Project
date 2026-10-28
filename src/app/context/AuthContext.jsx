import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { SESSION_SECURITY_EVENT } from "../services/apiClient.js";
import { setSecuritySession } from "../utils/securitySession.js";
import { isValidEmail, ILLEGITIMATE_EMAIL_ERROR } from "../utils/emailValidation.js";
import { isSupabaseConfigured } from "../../firebase.js";
import { auth, installSupabaseSession, loadSupabaseProfile, signOutSupabase, subscribeSupabaseAuth, getSupabaseSession, setSupabaseSessionPersistence, supabase } from "../services/supabaseSession.js";
import { signUpCustomerWithEmailPassword, updateCustomerProfile } from "../services/customerAccount.js";
import { updateMyProfile } from "../services/userApi.js";
import {
  completeBackendPasswordReset,
  loginCustomerUser,
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
  removeSessionStorageItem,
  removeStorageItem,
  writeSessionStorageItem,
} from "../utils/browserState.js";
import {
  clearPendingOtpSession,
  clearPortalSession,
  decodeJwtPayload,
  persistPendingOtpSession,
  readPendingOtpSession,
} from "../utils/portalSession.js";
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

function formatAuthError(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isAuthConnectionIssue(error) {
  return error?.code === "ERR_NETWORK" || error?.name === "TypeError" || error?.statusCode >= 500;
}

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
    !isPortalRole(normalized.role) ||
    (normalized.otpTicketExpiresAt && isTimestampExpired(normalized.otpTicketExpiresAt))
  ) {
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

async function hydrateAuthenticatedUser(supabaseUser, activeSession = null) {
  if (!supabaseUser) {
    return {
      accessToken: "",
      user: null,
    };
  }

  const session = activeSession || await getSupabaseSession();
  if (!session?.user || session.user.id !== (supabaseUser.id || supabaseUser.uid)) {
    throw Object.assign(new Error("Supabase Auth is not ready to load this profile."), { code: "auth/session-not-ready" });
  }
  const accessToken = session.access_token;
  const user = await loadSupabaseProfile(accessToken);

  return {
    accessToken,
    user,
  };
}

function buildConfigErrorResult() {
  return {
    ok: false,
    error:
      "Supabase Auth is not configured. Fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY first.",
  };
}

async function configureCustomerAuthPersistence(rememberDevice = false) {
  setSupabaseSessionPersistence(rememberDevice);
}

export function AuthProvider({ children }) {
  const authGenerationRef = useRef(0);
  const loginHandoffRef = useRef(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [accessToken, setAccessToken] = useState("");
  const [authHydrationError, setAuthHydrationError] = useState("");
  const [hasSupabaseSession, setHasSupabaseSession] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine !== false,
  );
  const [pendingOtp, updatePendingOtp] = useState(() =>
    normalizePendingOtpRecord(readPendingOtpSession()),
  );
  const pendingOtpRef = useRef(pendingOtp);
  const setPendingOtp = useCallback((session) => {
    pendingOtpRef.current = session;
    updatePendingOtp(session);
  }, []);

  const restorePendingOtpSession = useCallback((reason = "storage-recovery") => {
    const restored = normalizePendingOtpRecord(pendingOtpRef.current)
      || normalizePendingOtpRecord(readPendingOtpSession());

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
  }, [setPendingOtp]);

  async function installPendingOtpSession(session) {
    // Invalidate profile hydration started before this challenge was issued.
    authGenerationRef.current++;
    loginHandoffRef.current = true;
    setIsLoading(true);
    try {
      // Commit the server-issued ticket before any asynchronous sign-out or navigation.
      const persisted = persistPendingOtpSession(session);
      setPendingOtp(session);
      if (auth?.currentUser) await signOutSupabase();
      clearPortalSession();
      setSecuritySession();
      setCurrentUser(null);
      setAccessToken("");
      setHasSupabaseSession(false);
      setAuthHydrationError("");
      return persisted;
    } finally {
      loginHandoffRef.current = false;
      setIsLoading(false);
    }
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
    if (!auth || !isSupabaseConfigured) {
      setCurrentUser(null);
      setAccessToken("");
      setAuthHydrationError("");
      setHasSupabaseSession(false);
      setIsLoading(false);
      return undefined;
    }

    let active = true;

    const unsubscribe = subscribeSupabaseAuth(async (_event, activeSession) => {
      const supabaseUser = activeSession?.user || null;
      const generation = ++authGenerationRef.current;
      if (loginHandoffRef.current) return;
      const isCurrent = () => active && generation === authGenerationRef.current
        && !loginHandoffRef.current
        && (auth.currentUser?.id || "") === (supabaseUser?.id || "");
      try {
        await waitForCustomerRegistration();
        if (!isCurrent()) return;
        const restoredPendingOtp = normalizePendingOtpRecord(pendingOtpRef.current)
          || normalizePendingOtpRecord(readPendingOtpSession());
        // A pending challenge takes precedence over a persisted Supabase identity,
        // including after a reload or an auth event from another tab.
        if (supabaseUser && restoredPendingOtp) {
          await installPendingOtpSession(restoredPendingOtp);
          return;
        }
        if (!supabaseUser) {

          if (active) {
            clearPortalSession();
            setPendingOtp(restoredPendingOtp);
            setCurrentUser(null);
            setAccessToken("");
            setAuthHydrationError("");
            setHasSupabaseSession(false);
            setIsLoading(false);
          }
          return;
        }

        if (active) {
          setHasSupabaseSession(true);
        }

        const session = await hydrateAuthenticatedUser(supabaseUser, activeSession);
        if (!isCurrent()) {
          return;
        }

        clearPendingOtpSession();
        clearPortalSession();
        setPendingOtp(null);
        setCurrentUser(session.user);
        setAccessToken(session.accessToken);
        setAuthHydrationError("");
      } catch (error) {
        console.error("Unable to restore the Supabase Auth session.", error);
        if (!isCurrent()) {
          return;
        }

        const errorCode = typeof error?.code === "string" ? error.code : "";
        const preservedPendingOtp =
          errorCode === "permission-denied"
            ? normalizePendingOtpRecord(readPendingOtpSession())
            : null;

        setAuthHydrationError(
          formatAuthError(error, "Unable to restore the Supabase user session right now."),
        );

        if (isAuthConnectionIssue(error)) {
          return;
        }

        try {
          if (auth?.currentUser) {
            await signOutSupabase();
          }
        } catch (_signOutError) {
          // Ignore secondary cleanup failures and clear local state below.
        }

        if (!isCurrent()) {
          return;
        }

        resetTransientAuthStorage();
        clearPortalSession();
        if (preservedPendingOtp) {
          persistPendingOtpSession(preservedPendingOtp);
          console.warn("[portal-auth] Preserving pending OTP session after profile access denial.", {
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
        setHasSupabaseSession(false);
      } finally {
        if (isCurrent()) {
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
    const loginIdentifier = typeof identifier === "string" && identifier.trim()
      ? identifier.trim() : typeof email === "string" ? email.trim() : "";
    void roleHint;
    if (loginIdentifier.includes("@") && !isValidEmail(loginIdentifier)) return { ok: false, error: ILLEGITIMATE_EMAIL_ERROR };
    return beginUnifiedLogin({ identifier: loginIdentifier, password, rememberDevice });
  }

  async function signUp({ fullName, email, password, confirmPassword, phone = "", username = "" }) {
    const textErrors = getTextValidationErrors({ fullName, email, username }, ACCOUNT_TEXT_FIELDS);
    if (Object.keys(textErrors).length) return { ok: false, error: Object.values(textErrors)[0] };
    if (!isSupabaseConfigured || !auth) {
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

    const previousSignupUid = auth.currentUser?.id || "";
    try {
      const { profile } = await signUpCustomerWithEmailPassword({
        fullName,
        email,
        password,
        phone: normalizedPhone,
        username,
      });
      resetTransientAuthStorage();
      clearPortalSession();
      clearPendingOtpSession();
      setPendingOtp(null);
      setCurrentUser(null);
      setAccessToken("");
      setAuthHydrationError("");
      setHasSupabaseSession(false);

      return {
        ok: true,
        verificationRequired: true,
        email: profile.email || email.trim(),
        message: "Verification link sent! Please check your email inbox to activate your account.",
      };
    } catch (error) {
      if ((auth.currentUser?.id || "") === previousSignupUid) {
        return {
          ok: false,
          error: formatAuthError(error, "Unable to create your account right now."),
        };
      }
      try {
        if (auth?.currentUser) {
          await signOutSupabase();
        }
      } catch (_signOutError) {
        // Ignore cleanup failures; the UI still shows the original sign-up error.
      }

      resetTransientAuthStorage();
      clearPortalSession();
      clearPendingOtpSession();
      setPendingOtp(null);
      setHasSupabaseSession(false);
      setCurrentUser(null);
      setAccessToken("");
      return {
        ok: false,
        error: formatAuthError(error, "Unable to create your account right now."),
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
      if (!isSupabaseConfigured || !auth) {
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

        const persisted = await installPendingOtpSession(nextPendingOtp);
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
          details: error?.details || null,
        };
      }
    }

    if (!isSupabaseConfigured || !auth) {
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

    try {
      if (!rememberDevice) clearRememberedCustomerLogin();
      const response = await loginCustomerUser({
        identifier: identifier.trim(),
        password,
        rememberDevice,
      });
      const hydratedSession = await installFreshSupabaseSession(response.supabaseSession, rememberDevice);
      if (!isCustomerRole(hydratedSession.user?.role)) {
        return {
          ok: false,
          error: "This login portal only accepts customer accounts.",
        };
      }
      if (rememberDevice) rememberCustomerLogin(identifier.trim(), password);
      else clearRememberedCustomerLogin();
      setPendingOtp(null);
      setCurrentUser(hydratedSession.user);
      setAccessToken(hydratedSession.accessToken);
      setAuthHydrationError("");
      setHasSupabaseSession(true);

      return {
        ok: true,
        user: hydratedSession.user,
        homePath: resolveHomePath(hydratedSession.user.role),
      };
    } catch (error) {
      try {
        if (auth?.currentUser) {
          await signOutSupabase();
        }
      } catch (_signOutError) {
        // Ignore cleanup failures; the UI still shows the original sign-in error.
      }

      resetTransientAuthStorage();
      clearPortalSession();
      clearPendingOtpSession();
      setPendingOtp(null);
      setHasSupabaseSession(false);
      setCurrentUser(null);
      setAccessToken("");

      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to sign in right now.",
        details: error?.details || null,
      };
    }
  }

  async function beginUnifiedLogin({
    identifier,
    password,
    requestedPath = "",
    rememberDevice = false,
  }) {
    if (!isSupabaseConfigured || !auth) {
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

        await installPendingOtpSession(nextPendingOtp);

        return {
          ok: true,
          requiresTwoFactor: true,
          message: response.message,
          verificationPath: "/verify-otp",
        };
      }

      if (!response.supabaseSession?.access_token) {
        return {
          ok: false,
          error: "The server did not return a complete login session.",
        };
      }

      if (isPortalRole(responseRole)) {
        return await finalizePortalLogin(response, { requestedPath, rememberDevice, identifier: identifier.trim() });
      }

      const hydratedSession = await installFreshSupabaseSession(response.supabaseSession, rememberDevice);

      if (isCustomerRole(hydratedSession.user?.role)) {
        if (rememberDevice) rememberCustomerLogin(identifier.trim(), password);
        else clearRememberedCustomerLogin();
      }
      setPendingOtp(null);
      setCurrentUser(hydratedSession.user);
      setAccessToken(hydratedSession.accessToken);
      setAuthHydrationError("");
      setHasSupabaseSession(true);

      return {
        ok: true,
        user: hydratedSession.user,
        homePath: resolveHomePath(hydratedSession.user.role),
      };
    } catch (error) {
      try {
        if (auth?.currentUser) {
          await signOutSupabase();
        }
      } catch (_signOutError) {
        // Ignore cleanup failures; the UI still shows the original sign-in error.
      }

      resetTransientAuthStorage();
      clearPortalSession();
      clearPendingOtpSession();
      setPendingOtp(null);
      setHasSupabaseSession(false);
      setCurrentUser(null);
      setAccessToken("");

      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to sign in right now.",
        details: error?.details || null,
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
      const supabaseSession = await getSupabaseSession();
      const session = await hydrateAuthenticatedUser(auth.currentUser, supabaseSession);
      setCurrentUser(session.user);
      setAccessToken(session.accessToken);
      setAuthHydrationError("");
      setHasSupabaseSession(true);
      return session.user;
    } catch (error) {
      console.error("Unable to refresh the Supabase user profile.", error);
      setAuthHydrationError(
        formatAuthError(error, "Unable to refresh the Supabase user profile right now."),
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
        : await updateMyProfile(accessToken, currentUser.role, payload);
      setCurrentUser(user);

      return {
        ok: true,
        user,
      };
    } catch (error) {
      return {
        ok: false,
        error: formatAuthError(error, "Unable to update the profile right now."),
      };
    }
  }

  async function signOut() {
    authGenerationRef.current++;
    setSecuritySession();
    resetTransientAuthStorage();
    setPendingOtp(null);
    setCurrentUser(null);
    setAccessToken("");
    setAuthHydrationError("");
    setHasSupabaseSession(false);
    try {
      if (auth) {
        await signOutSupabase();
      }
    } catch (_error) {
      // Supabase session storage can already be cleared in some flows.
    } finally {
      resetTransientAuthStorage();
      clearPortalSession();
      clearPendingOtpSession();
      setPendingOtp(null);
      setCurrentUser(null);
      setAccessToken("");
      setAuthHydrationError("");
      setHasSupabaseSession(false);
    }
  }

  async function prepareFreshLogin() {
    await signOut();
    removeSessionStorageItem("furfection-security-warning");
    removeStorageItem("furfection-security-warning");
  }

  async function installFreshSupabaseSession(supabaseSession, rememberDevice) {
    loginHandoffRef.current = true;
    try {
      await prepareFreshLogin();
      await configureCustomerAuthPersistence(rememberDevice);
      const session = await installSupabaseSession(supabaseSession);
      return await hydrateAuthenticatedUser(session.user, session);
    } finally {
      loginHandoffRef.current = false;
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
  useEffect(() => { setSecuritySession(currentUser?.uid || "", accessToken || ""); }, [currentUser?.uid, accessToken]);
  useEffect(() => {
    let terminating = false;
    const terminate = async (event) => {
      if (terminating) return;
      terminating = true;
      setSecuritySession();
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
    if (!isSupabaseConfigured || !auth) {
      return buildConfigErrorResult();
    }

    const supabaseSession = response?.supabaseSession;
    if (!supabaseSession?.access_token) {
      return {
        ok: false,
        error: "The server did not return a complete portal session.",
      };
    }

    const hydratedSession = await installFreshSupabaseSession(supabaseSession,
      pendingSession?.rememberDevice === true);

    persistRememberDeviceToken(
      hydratedSession.user.role,
      pendingSession?.rememberDevice ? response?.rememberDeviceToken || "" : "",
      pendingSession?.identifier || hydratedSession.user.email,
    );
    clearPendingOtpSession();
    setPendingOtp(null);
    setCurrentUser(hydratedSession.user);
    setAccessToken(hydratedSession.accessToken);
    setAuthHydrationError("");
    setHasSupabaseSession(true);

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
        details: error?.details || null,
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
        error: isExpectedOtpFailure && rawMessage ? rawMessage : safeMessage,
        details: error?.details || null,
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
    supabaseConfigError: isSupabaseConfigured ? "" : "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable sign-in.",
    hasSupabaseSession,
    homePath: resolveHomePath(currentUser?.role),
    isAuthenticated: Boolean(currentUser),
    isSupabaseConfigured,
    isCustomerUser: isCustomerRole(currentUser?.role),
    isLoading,
    isOnline,
    isPortalUser: isPortalRole(currentUser?.role),
    pendingOtp,
    restorePendingOtpSession,
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
import { getTextValidationErrors, ACCOUNT_TEXT_FIELDS } from "../../../shared/textModeration.mjs";
