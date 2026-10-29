import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { isPortalRole } from "../../utils/roleUtils.js";
import { isValidPortalSessionRoute } from "../../utils/portalRouteSecurity.js";

function SecurityLogoutScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F6F0E7] px-6 text-[#20343B]">
      <div className="w-full max-w-lg rounded-[28px] bg-white p-8 text-center shadow-[0_18px_40px_rgba(94,81,60,0.14)]">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#B04A56]">
          Security Logout
        </p>
        <h1 className="mt-3 text-2xl font-semibold">Your session is being secured.</h1>
        <p className="mt-3 text-sm leading-6 text-[#607277]">
          The requested portal address is not a valid Admin or Staff route. Please sign in again.
        </p>
      </div>
    </div>
  );
}

export function PortalSessionRouteGuard({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, isLoading, signOut } = useAuth();
  const logoutStartedRef = useRef(false);
  const isInvalidPortalRoute =
    !isLoading &&
    isPortalRole(currentUser?.role) &&
    !isValidPortalSessionRoute(currentUser.role, location.pathname);

  useEffect(() => {
    if (!isInvalidPortalRoute || logoutStartedRef.current) {
      return undefined;
    }

    logoutStartedRef.current = true;

    (async () => {
      await signOut();
      navigate("/login", {
        replace: true,
        state: { securityLogout: true },
      });
    })();
  }, [isInvalidPortalRoute, navigate, signOut]);

  if (isInvalidPortalRoute || (logoutStartedRef.current && isPortalRole(currentUser?.role))) {
    return <SecurityLogoutScreen />;
  }

  return children;
}
