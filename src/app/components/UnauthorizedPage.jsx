import { motion } from "motion/react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { normalizeRole, resolveHomePath, resolveLoginPath } from "../utils/roleUtils.js";

function formatRoleLabel(role = "") {
  const normalized = normalizeRole(role);

  if (!normalized) {
    return "account";
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatAllowedRoles(roles = []) {
  const labels = roles.map((role) => formatRoleLabel(role));

  if (labels.length === 0) {
    return "authorized";
  }

  if (labels.length === 1) {
    return labels[0];
  }

  if (labels.length === 2) {
    return `${labels[0]} or ${labels[1]}`;
  }

  return `${labels.slice(0, -1).join(", ")}, or ${labels.at(-1)}`;
}

export function UnauthorizedPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, isAuthenticated, signOut } = useAuth();
  const allowedRoles = Array.isArray(location.state?.allowedRoles)
    ? location.state.allowedRoles.map((role) => normalizeRole(role)).filter(Boolean)
    : [];
  const actualRole = normalizeRole(location.state?.actualRole || currentUser?.role);
  const requestedPath =
    typeof location.state?.requestedPath === "string" ? location.state.requestedPath.trim() : "";
  const loginPath = resolveLoginPath(allowedRoles);
  const homePath = resolveHomePath(actualRole);

  const handleSignOut = async () => {
    await signOut();
    navigate(loginPath, { replace: true });
  };

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-[#F6F0E7] px-6 py-14 lg:py-18">
      <div className="mx-auto max-w-[920px]">
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="rounded-[36px] bg-white p-8 shadow-[0_18px_40px_rgba(94,81,60,0.14)] md:p-10"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-[20px] bg-[#FBECEF] text-[#B23949]">
            <ShieldAlert size={28} />
          </div>

          <p className="mt-6 text-sm font-semibold uppercase tracking-[0.18em] text-[#B23949]">
            Access Blocked
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-[#20343B]">
            Unauthorized account type.
          </h1>
          <p className="mt-4 text-base leading-7 text-[#607277] md:text-lg">
            This route is reserved for {formatAllowedRoles(allowedRoles)} accounts. Role-based
            access control blocked the request before the protected dashboard or API flow loaded.
          </p>

          {requestedPath && (
            <div className="mt-8 rounded-[24px] bg-[#F8FBFB] px-5 py-5">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#7A979C]">
                Requested route
              </p>
              <p className="mt-3 break-all text-sm text-[#365057]">{requestedPath}</p>
            </div>
          )}

          {isAuthenticated && currentUser ? (
            <div className="mt-8 rounded-[24px] bg-[#F5FAFA] px-5 py-5">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#7A979C]">
                Current session
              </p>
              <p className="mt-3 text-sm leading-6 text-[#607277]">
                Signed in as <span className="font-semibold text-[#20343B]">{currentUser.email}</span>{" "}
                with a <span className="font-semibold text-[#20343B]">{formatRoleLabel(actualRole)}</span>{" "}
                account.
              </p>
            </div>
          ) : null}

          <div className="mt-8 flex flex-wrap gap-3">
            {isAuthenticated && currentUser ? (
              <>
                <Link
                  to={homePath}
                  className="rounded-full bg-[#173E44] px-5 py-3 text-sm font-semibold text-white"
                >
                  Go to my dashboard
                </Link>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="rounded-full border border-[#D9E7E7] px-5 py-3 text-sm font-semibold text-[#365057]"
                >
                  Sign out
                </button>
              </>
            ) : (
              <Link
                to={loginPath}
                className="rounded-full bg-[#173E44] px-5 py-3 text-sm font-semibold text-white"
              >
                Return to login
              </Link>
            )}
          </div>
        </motion.section>
      </div>
    </div>
  );
}
