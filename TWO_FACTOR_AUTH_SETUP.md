# Authentication Setup Guide

## Folder structure

```text
Capstone_Project/
  server/
    server.js
    .env.example
    src/
      app.js
      server.js
      config/
        env.js
        firebaseAdmin.js
        mailer.js
      constants/
        auth.js
      controllers/
        auth.controller.js
        user.controller.js
      middlewares/
        authenticate.js
        authorize.js
        errorHandler.js
      routes/
        auth.routes.js
        user.routes.js
      services/
        firebaseAuth.service.js
        mail.service.js
        otp.service.js
        passwordReset.service.js
        token.service.js
        user.service.js
      utils/
        ApiError.js
        asyncHandler.js
        otp.js
        password.js
        resetToken.js
        setupGuard.js
  src/
    firebase.js
    app/
      components/
        AdminLogin.jsx
        CustomerLogin.jsx
        CustomerProfile.jsx
        ForgotPassword.jsx
        Login.jsx
        OtpVerification.jsx
        ResetPassword.jsx
        RoleDashboards.jsx
        RoleLoginPage.jsx
        portal/
          RequireAuth.jsx
      context/
        AppContext.jsx
        AuthContext.jsx
      services/
        apiClient.js
        authApi.js
        userApi.js
      utils/
        authStorage.js
        roleUtils.js
  firestore.rules
  .env.example
```

## Firestore collections

### `users`

Document ID: Firebase Auth `uid`

Required fields:

- `uid`
- `fullName`
- `email`
- `passwordHash`
- `role`
- `accountStatus`
- `createdAt`
- `updatedAt`
- `lastLogin`

Supported roles:

- `customer`
- `admin`
- `staff`

Supported account statuses:

- `active`
- `inactive`
- `suspended`

### `admin_staff_otp`

Document ID: generated `otpId`

Required fields:

- `otpId`
- `userId`
- `email`
- `role`
- `otpCode`
- `createdAt`
- `expiresAt`
- `isUsed`

Notes:

- `otpCode` stores a hashed OTP, not the raw code.
- OTPs are invalidated when a new OTP is generated.
- OTPs expire after 5 minutes and are single-use.

### `password_reset_requests`

Document ID: generated `resetId`

Required fields:

- `resetId`
- `userId`
- `email`
- `resetToken`
- `createdAt`
- `expiresAt`
- `isUsed`

Notes:

- `resetToken` stores a hashed reset token, not the raw token from the email link.
- Reset requests are single-use and expire after the configured TTL.

## Backend routes

Authentication routes:

- `POST /api/auth/login`
- `POST /api/auth/send-otp`
- `POST /api/auth/verify-otp`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Protected user routes:

- `GET /api/users`
- `POST /api/users`
- `PATCH /api/users/me`
- `PATCH /api/users/:uid`
- `DELETE /api/users/:uid`

## Frontend routes

- `/login` - sign-in hub
- `/customer-login`
- `/admin-login`
- `/staff-login`
- `/verify-otp`
- `/forgot-password`
- `/reset-password`
- `/customer-profile`
- `/admin/dashboard`
- `/staff/dashboard`
- `/portal/*`

## Authentication flow

### Customer

1. Customer signs in on `/customer-login`.
2. Backend validates email and password against Firebase Authentication.
3. Backend loads the Firestore `users` document and verifies:
   - role is `customer`
   - `accountStatus` is `active`
4. Backend issues a JWT access token and Firebase custom token.
5. Frontend stores the JWT session, signs into Firebase with the custom token, and redirects to `/customer-profile`.

### Admin

1. Admin signs in on `/admin-login`.
2. Backend validates Firebase credentials.
3. Backend verifies role is `admin` and `accountStatus` is `active`.
4. Backend generates a 6-digit OTP and stores the hashed code in `admin_staff_otp`.
5. Backend emails the OTP through Nodemailer.
6. Frontend redirects to `/verify-otp`.
7. Backend validates OTP ownership, expiry, and single-use status.
8. Backend issues the JWT session and Firebase custom token.
9. Frontend redirects to `/admin/dashboard`.

### Staff

1. Staff signs in on `/staff-login`.
2. Backend validates Firebase credentials.
3. Backend verifies role is `staff` and `accountStatus` is `active`.
4. Backend generates a 6-digit OTP and stores the hashed code in `admin_staff_otp`.
5. Backend emails the OTP through Nodemailer.
6. Frontend redirects to `/verify-otp`.
7. Backend validates OTP ownership, expiry, and single-use status.
8. Backend issues the JWT session and Firebase custom token.
9. Frontend redirects to `/staff/dashboard`.

### Forgot password

1. User requests a reset from `/forgot-password`.
2. Backend creates a single-use reset record in `password_reset_requests`.
3. Backend emails a reset link.
4. User opens `/reset-password?token=...`.
5. Backend validates the token, checks expiry, updates Firebase Auth password, updates the Firestore `passwordHash`, and invalidates open OTP sessions.

## Setup steps

### 1. Frontend setup

1. Copy `.env.example` to `.env`.
2. Fill in:
   - `VITE_API_BASE_URL`
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
3. Install dependencies:

   ```bash
   npm install
   ```

4. Start Vite:

   ```bash
   npm run dev
   ```

### 2. Backend setup

1. Copy `server/.env.example` to `server/.env`.
2. Fill in:
   - Firebase Admin SDK credentials
   - `FIREBASE_WEB_API_KEY`
   - `JWT_SECRET`
   - `OTP_TICKET_SECRET`
   - `OTP_HASH_SECRET`
   - `RESET_TOKEN_SECRET`
   - `PASSWORD_HASH_PEPPER`
   - `PASSWORD_RESET_URL`
   - SMTP credentials
3. Install dependencies:

   ```bash
   cd server
   npm install
   ```

4. Start the backend:

   ```bash
   npm run dev
   ```

### 3. Firebase setup

1. Create Firebase Authentication accounts for customers, admins, and staff.
2. Create matching Firestore documents in `users` using the same `uid`.
3. Store the correct `role` and `accountStatus`.
4. Publish the Firestore rules from `firestore.rules`.

## Security notes

- Admin and staff access is blocked until OTP verification succeeds.
- OTPs expire after 5 minutes and cannot be reused.
- Password reset links are hashed in Firestore and single-use.
- Passwords must be at least 8 characters and include uppercase, lowercase, numeric, and special characters.
- Protected routes are enforced in both Express middleware and React route guards.
