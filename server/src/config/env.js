const fs = require("fs");
const path = require("path");
const { loadEnvFiles } = require("./loadEnv");

const { projectRoot, serverRoot, files: loadedEnvFiles } = loadEnvFiles();

const missingVariables = [];

function readRequired(name, fallback = "") {
  const value = process.env[name] ?? fallback;

  if (typeof value !== "string" || !value.trim()) {
    missingVariables.push(name);
    return "";
  }

  return value.trim();
}

function readOptional(name, fallback = "") {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readBoolean(name, fallback = false) {
  const value = readOptional(name);

  if (!value) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function readNumber(name, fallback) {
  const value = readOptional(name);
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a valid number.`);
  }

  return parsed;
}

function resolveServerPath(targetPath) {
  if (!targetPath) {
    return "";
  }

  if (path.isAbsolute(targetPath)) {
    return targetPath;
  }

  const candidates = [path.resolve(projectRoot, targetPath), path.resolve(serverRoot, targetPath)];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function readServiceAccountFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      return null;
    }

    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);

    if (!parsed?.project_id || !parsed?.client_email || !parsed?.private_key) {
      return null;
    }

    return {
      path: filePath,
      projectId: String(parsed.project_id).trim(),
      clientEmail: String(parsed.client_email).trim(),
      privateKey: String(parsed.private_key),
    };
  } catch {
    return null;
  }
}

function loadServiceAccount() {
  const configuredPath = readOptional(
    "FIREBASE_SERVICE_ACCOUNT_PATH",
    readOptional("GOOGLE_APPLICATION_CREDENTIALS"),
  );
  const configDir = path.join(serverRoot, "config");
  const candidates = [];

  if (configuredPath) {
    candidates.push(resolveServerPath(configuredPath));
  }

  if (fs.existsSync(configDir)) {
    try {
      const stats = fs.statSync(configDir);
      if (stats.isDirectory()) {
        const jsonFiles = fs
          .readdirSync(configDir)
          .filter((entry) => entry.toLowerCase().endsWith(".json"))
          .map((entry) => path.join(configDir, entry));

        candidates.push(...jsonFiles);
      }
    } catch {
      // Ignore config directory read failures and fall back to env vars only.
    }
  }

  const seen = new Set();

  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) {
      continue;
    }

    seen.add(candidate);
    const serviceAccount = readServiceAccountFile(candidate);
    if (serviceAccount) {
      return serviceAccount;
    }
  }

  return null;
}

const serviceAccount = loadServiceAccount();
const nodeEnv = readOptional("NODE_ENV", "development");
const defaultFrontendUrl = "https://capstone-project-1-yqto.onrender.com";
const frontendUrl = readOptional("FRONTEND_URL", defaultFrontendUrl).replace(/\/+$/, "");
const defaultPasswordResetUrl = frontendUrl.endsWith("/reset-password")
  ? frontendUrl
  : `${frontendUrl}/reset-password`;
const defaultEmailVerificationUrl = frontendUrl.endsWith("/activate-account")
  ? frontendUrl
  : `${frontendUrl}/activate-account`;


const env = {
  nodeEnv,
  port: readNumber("PORT", 5000),
  clientUrl: readOptional("CLIENT_URL", "http://localhost:5173"),
  supabase: {
    url: readOptional("SUPABASE_URL", readOptional("VITE_SUPABASE_URL")).replace(/\/+$/, ""),
    anonKey: readOptional("SUPABASE_ANON_KEY", readOptional("VITE_SUPABASE_ANON_KEY")),
    serviceRoleKey: readOptional("SUPABASE_SERVICE_ROLE_KEY"),
  },
  firebase: {
    projectId: readRequired(
      "FIREBASE_PROJECT_ID",
      readOptional("VITE_FIREBASE_PROJECT_ID", serviceAccount?.projectId || ""),
    ),
    clientEmail: readRequired("FIREBASE_CLIENT_EMAIL", serviceAccount?.clientEmail || ""),
    privateKey: readRequired("FIREBASE_PRIVATE_KEY", serviceAccount?.privateKey || "").replace(
      /\\n/g,
      "\n",
    ),
    storageBucket: readOptional(
      "FIREBASE_STORAGE_BUCKET",
      readOptional("VITE_FIREBASE_STORAGE_BUCKET"),
    ),
    webApiKey: readOptional("FIREBASE_WEB_API_KEY", readOptional("VITE_FIREBASE_API_KEY")),
    serviceAccountPath: serviceAccount?.path || "",
  },
  auth: {
    jwtSecret: readRequired("JWT_SECRET"),
    jwtExpiresIn: readOptional("JWT_EXPIRES_IN", "12h"),
    otpTicketSecret: readRequired("OTP_TICKET_SECRET"),
    otpTicketExpiresIn: readOptional("OTP_TICKET_EXPIRES_IN", "10m"),
    otpSecret: readRequired("OTP_HASH_SECRET"),
    passwordHashPepper: readRequired("PASSWORD_HASH_PEPPER"),
    passwordResetUrl: readOptional("PASSWORD_RESET_URL", defaultPasswordResetUrl),
    emailVerificationUrl: readOptional("EMAIL_VERIFICATION_URL", defaultEmailVerificationUrl),
  },
  otp: {
    ttlMinutes: readNumber("OTP_TTL_MINUTES", 5),
    codeLength: readNumber("OTP_CODE_LENGTH", 6),
    maxAttempts: readNumber("OTP_MAX_ATTEMPTS", 5),
    resendCooldownSeconds: readNumber("OTP_RESEND_COOLDOWN_SECONDS", 60),
  },
  passwordReset: {
    ttlMinutes: readNumber("PASSWORD_RESET_TTL_MINUTES", 30),
  },
  security: {
    trustedProxyCidrs: readOptional("TRUSTED_PROXY_CIDRS"),
    maxAccountsPerIp: readNumber("MAX_ACCOUNTS_PER_IP", 2),
    geoLookupUrl: readOptional("FRAUD_GEO_LOOKUP_URL", "https://api.ipapi.is/?q={ip}&key={api_key}"),
    geoLookupApiKey: readOptional("FRAUD_GEO_LOOKUP_API_KEY"),
    blockedNetworkCidrs: readOptional("SESSION_BLOCKED_NETWORK_CIDRS"),
    emailValidationUrl: readOptional("EMAIL_VALIDATION_API_URL"),
    emailValidationApiKey: readOptional("EMAIL_VALIDATION_API_KEY"),
    failClosed: readBoolean("FRAUD_FAIL_CLOSED", false),
    huggingFaceApiKey: readOptional("HUGGINGFACE_API_KEY"),
    huggingFaceModel: readOptional(
      "HUGGINGFACE_PET_IMAGE_MODEL",
      "google/vit-base-patch16-224",
    ),
  },
  mail: {
    deliveryMode: readOptional("MAIL_DELIVERY_MODE", "resend").toLowerCase(),
    provider: "resend",
    apiKey: readOptional("RESEND_API_KEY"),
    fromName: readOptional("EMAIL_FROM_NAME", "Charming Fur-fection Pet Care"),
    emailFrom: readOptional("EMAIL_FROM", "support@charmingfurfectionpetscareservices.online").toLowerCase(),
    fromEmail: readOptional("RESEND_FROM_EMAIL", "noreply@charmingfurfectionpetscareservices.online").toLowerCase(),
    replyTo: readOptional("EMAIL_REPLY_TO"),
  },
};

function resolveMailDeliveryMode() {
  const configuredMode = env.mail.deliveryMode;

  if (["disabled", "none", "off", "false"].includes(configuredMode)) {
    return "disabled";
  }

  // Stale SMTP settings cannot reactivate the removed SMTP transport.
  return env.runtime.resendReady ? "resend" : "disabled";
}

env.runtime = {
  resendReady: Boolean(env.mail.apiKey && env.mail.fromEmail),
  loadedEnvFiles,
  missingVariables: Array.from(new Set(missingVariables)),
  firebaseAdminReady: Boolean(
    env.firebase.projectId && env.firebase.clientEmail && env.firebase.privateKey,
  ),
  supabaseAuthReady: Boolean(env.supabase.url && env.supabase.anonKey),
  supabaseAdminReady: Boolean(env.supabase.url && env.supabase.serviceRoleKey),
  jwtReady: Boolean(
    env.auth.jwtSecret &&
      env.auth.otpTicketSecret &&
      env.auth.otpSecret &&
      env.auth.passwordHashPepper,
  ),
};

env.runtime.mailDeliveryMode = resolveMailDeliveryMode();
env.mail.provider = env.runtime.mailDeliveryMode;
env.runtime.mailDeliveryReady = env.runtime.mailDeliveryMode === "resend";

env.runtime.authReady = Boolean(
  env.runtime.supabaseAuthReady &&
    env.runtime.supabaseAdminReady &&
    env.runtime.jwtReady &&
    env.runtime.mailDeliveryReady,
);

function collectStartupChecks() {
  return [
    {
      label: "Supabase Auth",
      required: ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
      ready: env.runtime.supabaseAuthReady && env.runtime.supabaseAdminReady,
    },
    {
      label: "JWT/Auth Secrets",
      required: ["JWT_SECRET", "OTP_TICKET_SECRET", "OTP_HASH_SECRET", "PASSWORD_HASH_PEPPER"],
      ready: env.runtime.jwtReady,
    },
    {
      label: "Mail Delivery",
      required: ["RESEND_API_KEY"],
      ready: env.runtime.mailDeliveryReady,
    },
  ];
}

function getStartupDiagnostics() {
  const checks = collectStartupChecks();

  return {
    nodeEnv: env.nodeEnv,
    port: env.port,
    clientUrl: env.clientUrl,
    mailDeliveryMode: env.runtime.mailDeliveryMode,
    authReady: env.runtime.authReady,
    loadedEnvFiles: env.runtime.loadedEnvFiles.map((file) => ({
      path: file.path,
      exists: file.exists,
      override: file.override,
      loaded: file.loaded,
      keyCount: Array.isArray(file.loadedKeys) ? file.loadedKeys.length : 0,
      error: file.error || "",
    })),
    mail: {
      apiKeyConfigured: Boolean(env.mail.apiKey),
      fromEmailConfigured: Boolean(env.mail.fromEmail),
      provider: env.mail.provider,
      resendReady: env.runtime.resendReady,
      transport: "https",
    },
    failedChecks: checks.filter((check) => !check.ready),
  };
}

function buildStartupSuccessSummary(diagnostics) {
  return {
    nodeEnv: diagnostics.nodeEnv,
    port: diagnostics.port,
    clientUrl: diagnostics.clientUrl,
    authReady: diagnostics.authReady,
    mailDeliveryMode: diagnostics.mailDeliveryMode,
  };
}

function buildStartupValidationError() {
  const diagnostics = getStartupDiagnostics();
  const missingDetails = diagnostics.failedChecks
    .map((check) => {
      const primary = check.required.join(", ");
      const alternative =
        Array.isArray(check.alternatives) && check.alternatives.length
          ? ` or ${check.alternatives.join(", ")}`
          : "";

      return `${check.label}: ${primary}${alternative}`;
    })
    .join("; ");

  return new Error(
    `Authentication setup is incomplete. Missing environment variables: ${missingDetails}.`,
  );
}

function validateStartupEnvironment() {
  const diagnostics = getStartupDiagnostics();

  if (!diagnostics.failedChecks.length) {
    console.info("[env] Startup checks passed.", buildStartupSuccessSummary(diagnostics));
    return diagnostics;
  }

  console.error("[env] Startup diagnostics", diagnostics);
  throw buildStartupValidationError();
}

module.exports = {
  env,
  resolveMailDeliveryMode,
  getStartupDiagnostics,
  validateStartupEnvironment,
};
