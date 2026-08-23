import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import {
  createAccessDeniedState,
  isAllowedRole,
  normalizeRole,
  resolveLoginPath,
} from "../../utils/roleUtils.js";

function LoadingScreen() {
  return (
    <div className="min-h-[calc(100vh-5rem)] bg-[#F6F0E7] px-6 py-14 text-[#20343B]">
      <div className="mx-auto max-w-[960px] rounded-[32px] bg-white p-8 shadow-[0_18px_40px_rgba(94,81,60,0.14)]">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#7B9A9F]">
          Securing Session
        </p>
        <h1 className="mt-3 text-2xl font-semibold">Checking your account access...</h1>
      </div>
    </div>
  );
}

function RecoveryScreen({ message, isOnline }) {
  return (
    <div className="min-h-[calc(100vh-5rem)] bg-[#F6F0E7] px-6 py-14 text-[#20343B]">
      <div className="mx-auto max-w-[960px] rounded-[32px] bg-white p-8 shadow-[0_18px_40px_rgba(94,81,60,0.14)]">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#7B9A9F]">
          Session Recovery
        </p>
        <h1 className="mt-3 text-2xl font-semibold">
          Your Firebase session exists, but the profile could not be restored yet.
        </h1>
        <p className="mt-4 text-base leading-7 text-[#607277]">
          {isOnline
            ? "Retry after the connection stabilizes or after Firestore rules finish deploying."
            : "Reconnect to the internet, then reload the page so Firestore can restore your role and profile."}
        </p>
        <div className="mt-6 rounded-[24px] bg-[#F8FBFB] px-5 py-4 text-sm text-[#4C6368]">
          {message}
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-6 rounded-[22px] bg-[#173E44] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#1E4E55]"
        >
          Reload and try again
        </button>
      </div>
    </div>
  );
}

export function RequireAuth({ children, allowedRoles = [] }) {
  const {
    authHydrationError,
    currentUser,
    hasFirebaseSession,
    isAuthenticated,
    isLoading,
    isOnline,
  } = useAuth();
  const location = useLocation();
  const normalizedAllowedRoles = Array.isArray(allowedRoles)
    ? allowedRoles.map((role) => normalizeRole(role)).filter(Boolean)
    : [];

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated && hasFirebaseSession && authHydrationError) {
    return <RecoveryScreen message={authHydrationError} isOnline={isOnline} />;
  }

  if (!isAuthenticated) {
    return (
      <Navigate
        to={resolveLoginPath(normalizedAllowedRoles)}
        replace
        state={{ from: `${location.pathname}${location.search}${location.hash}` }}
      />
    );
  }

  if (
    normalizedAllowedRoles.length > 0 &&
    !isAllowedRole(currentUser.role, normalizedAllowedRoles)
  ) {
    return (
      <Navigate
        to="/unauthorized"
        replace
        state={createAccessDeniedState({
          actualRole: normalizeRole(currentUser.role),
          allowedRoles: normalizedAllowedRoles,
          requestedPath: `${location.pathname}${location.search}${location.hash}`,
        })}
      />
    );
  }

  return children;
}
