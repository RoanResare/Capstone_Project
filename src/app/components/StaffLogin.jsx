import { RoleLoginPage } from "./RoleLoginPage.jsx";

export function StaffLogin() {
  return (
    <RoleLoginPage
      role="staff"
      eyebrow="Staff Access"
      title="Staff sign-in requires your portal credentials and a one-time password."
      description="Staff accounts validate their Firebase credentials on the server first, then complete an emailed OTP before the staff dashboard and protected workspace unlock."
      submitLabel="Sign in as staff"
      loginPath="/staff/login"
    />
  );
}
