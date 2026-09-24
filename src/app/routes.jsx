import { Suspense, lazy } from "react";
import { createBrowserRouter, Navigate, useLocation } from "react-router-dom";
import { AppErrorBoundary } from "./components/AppErrorBoundary.jsx";
import { ForgotPassword } from "./components/ForgotPassword.jsx";
import { Layout } from "./components/Layout.jsx";
import { Home } from "./components/Home.jsx";
import { Login } from "./components/Login.jsx";
import { OtpVerification } from "./components/OtpVerification.jsx";
import { ResetPassword } from "./components/ResetPassword.jsx";
import { RouteErrorScreen } from "./components/RouteErrorScreen.jsx";
import { UnauthorizedPage } from "./components/UnauthorizedPage.jsx";
import { RequireAuth } from "./components/portal/RequireAuth.jsx";
import { useAuth } from "./context/AuthContext.jsx";
import { resolveHomePath } from "./utils/roleUtils.js";

const About = lazy(async () => {
  const module = await import("./components/About.jsx");
  return { default: module.About };
});
const CustomerSignup = lazy(async () => {
  const module = await import("./components/CustomerSignup.jsx");
  return { default: module.CustomerSignup };
});
const CustomerProfile = lazy(async () => {
  const module = await import("./components/CustomerProfile.jsx");
  return { default: module.CustomerProfile };
});
const AdminDashboard = lazy(async () => {
  const module = await import("./components/RoleDashboards.jsx");
  return { default: module.AdminDashboard };
});
const StaffDashboard = lazy(async () => {
  const module = await import("./components/RoleDashboards.jsx");
  return { default: module.StaffDashboard };
});
const Products = lazy(async () => {
  const module = await import("./components/Products.jsx");
  return { default: module.Products };
});
const PortalLayout = lazy(async () => {
  const module = await import("./components/portal/PortalLayout.jsx");
  return { default: module.PortalLayout };
});
const PortalPage = lazy(async () => {
  const module = await import("./components/portal/PortalPage.jsx");
  return { default: module.PortalPage };
});

function RouteRenderBoundary({ Component }) {
  const location = useLocation();

  return (
    <AppErrorBoundary key={`${location.pathname}${location.search}${location.hash}`}>
      <Component />
    </AppErrorBoundary>
  );
}

function RouteLoader({ Component }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-[calc(100vh-5rem)] bg-[#F6F0E7] px-6 py-14 text-[#20343B]">
          <div className="mx-auto max-w-[1220px] rounded-[34px] bg-white p-8 shadow-[0_18px_40px_rgba(94,81,60,0.14)]">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#7B9A9F]">
              Loading Screen
            </p>
            <h1 className="mt-3 text-2xl font-semibold">Loading the next page...</h1>
          </div>
        </div>
      }
    >
      <RouteRenderBoundary Component={Component} />
    </Suspense>
  );
}

function DashboardRedirect() {
  const { currentUser, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-[calc(100vh-5rem)] bg-[#F6F0E7] px-6 py-14 text-[#20343B]">
        <div className="mx-auto max-w-[960px] rounded-[32px] bg-white p-8 shadow-[0_18px_40px_rgba(94,81,60,0.14)]">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#7B9A9F]">
            Loading Account
          </p>
          <h1 className="mt-3 text-2xl font-semibold">Finding your dashboard...</h1>
        </div>
      </div>
    );
  }

  return <Navigate to={currentUser ? resolveHomePath(currentUser.role) : "/login"} replace />;
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    errorElement: <RouteErrorScreen />,
    children: [
      { index: true, element: <Home /> },
      { path: "about", element: <RouteLoader Component={About} /> },
      { path: "dashboard", element: <DashboardRedirect /> },
      {
        path: "services",
        element: (
          <RequireAuth allowedRoles={["customer"]}>
            <Navigate to="/customer/dashboard?tab=services" replace />
          </RequireAuth>
        ),
      },
      { path: "las-pinas-city-branch", element: <Navigate to="/#visit-info" replace /> },
      { path: "las-pinas-branch", element: <Navigate to="/#visit-info" replace /> },
      { path: "login", element: <RouteLoader Component={Login} /> },
      { path: "customer/login", element: <Navigate to="/login" replace /> },
      { path: "customer/signup", element: <RouteLoader Component={CustomerSignup} /> },
      { path: "admin/login", element: <Navigate to="/login" replace /> },
      { path: "staff/login", element: <Navigate to="/login" replace /> },
      { path: "verify-otp", element: <RouteLoader Component={OtpVerification} /> },
      { path: "unauthorized", element: <RouteLoader Component={UnauthorizedPage} /> },
      { path: "forgot-password", element: <RouteLoader Component={ForgotPassword} /> },
      { path: "reset-password", element: <RouteLoader Component={ResetPassword} /> },
      { path: "customer-login", element: <Navigate to="/customer/login" replace /> },
      { path: "customer-signup", element: <Navigate to="/customer/signup" replace /> },
      { path: "admin-login", element: <Navigate to="/admin/login" replace /> },
      { path: "staff-login", element: <Navigate to="/staff/login" replace /> },
      { path: "customer-profile", element: <Navigate to="/customer/dashboard" replace /> },
      {
        path: "customer/dashboard",
        element: (
          <RequireAuth allowedRoles={["customer"]}>
            <RouteLoader Component={CustomerProfile} />
          </RequireAuth>
        ),
      },
      {
        path: "appointment",
        element: (
          <RequireAuth allowedRoles={["customer"]}>
            <Navigate to="/customer/dashboard?tab=booking" replace />
          </RequireAuth>
        ),
      },
      { path: "products", element: <RouteLoader Component={Products} /> },
    ],
  },
  {
    path: "/admin/dashboard",
    errorElement: <RouteErrorScreen />,
    element: (
      <RequireAuth allowedRoles={["admin"]}>
        <RouteLoader Component={AdminDashboard} />
      </RequireAuth>
    ),
  },
  {
    path: "/staff/dashboard",
    errorElement: <RouteErrorScreen />,
    element: (
      <RequireAuth allowedRoles={["staff"]}>
        <RouteLoader Component={StaffDashboard} />
      </RequireAuth>
    ),
  },
  {
    path: "/portal",
    errorElement: <RouteErrorScreen />,
    element: (
      <RequireAuth allowedRoles={["admin", "staff"]}>
        <RouteLoader Component={PortalLayout} />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="appointments" replace /> },
      { path: "appointments", element: <RouteLoader Component={PortalPage} /> },
      { path: "pet-records", element: <RouteLoader Component={PortalPage} /> },
      { path: "photo-moderation", element: <RouteLoader Component={PortalPage} /> },
      {
        path: "manage-users",
        element: (
          <RequireAuth allowedRoles={["admin"]}>
            <RouteLoader Component={PortalPage} />
          </RequireAuth>
        ),
      },
      { path: ":moduleId", element: <Navigate to="/portal/appointments" replace /> },
    ],
  },
]);
