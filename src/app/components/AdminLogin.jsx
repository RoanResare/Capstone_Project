import { RoleLoginPage } from "./RoleLoginPage.jsx";

export function AdminLogin() {
  return (
    <RoleLoginPage
      role="admin"
      eyebrow="Administrator Access"
      title="Admin sign-in requires your portal credentials and a one-time password."
      description="Administrator accounts validate their Firebase credentials on the server first, then complete an emailed OTP before the admin dashboard and protected operations unlock."
      submitLabel="Sign in as admin"
      loginPath="/admin/login"
    />
  );
}
