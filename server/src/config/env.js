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

function normalizeMailPassword(value = "") {
  return typeof value === "string" ? value.replace(/\s+/g, "") : "";
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
const mailUser = readRequired("SMTP_USER", readOptional("EMAIL_USER")).toLowerCase();
const mailPass = normalizeMailPassword(readRequired("SMTP_PASS", readOptional("EMAIL_PASS")));
const mailProvider = readOptional("MAIL_PROVIDER", "gmail").toLowerCase();
const mailHost = readOptional("SMTP_HOST", "smtp.gmail.com");
const mailPort = mailProvider === "gmail" ? 465 : readNumber("SMTP_PORT", 465);
const mailSecure = mailProvider === "gmail" ? true : readBoolean("SMTP_SECURE", true);

const env = {
  nodeEnv: readOptional("NODE_ENV", "development"),
  port: readNumber("PORT", 5000),
  clientUrl: readOptional("CLIENT_URL", "http://localhost:5173"),
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
    webApiKey: readRequired("FIREBASE_WEB_API_KEY", readOptional("VITE_FIREBASE_API_KEY")),
    serviceAccountPath: serviceAccount?.path || "",
  },
  auth: {
    jwtSecret: readRequired("JWT_SECRET"),
    jwtExpiresIn: readOptional("JWT_EXPIRES_IN", "12h"),
    otpTicketSecret: readRequired("OTP_TICKET_SECRET"),
    otpTicketExpiresIn: readOptional("OTP_TICKET_EXPIRES_IN", "10m"),
    otpSecret: readRequired("OTP_HASH_SECRET"),
    passwordHashPepper: readRequired("PASSWORD_HASH_PEPPER"),
    passwordResetUrl: readOptional("PASSWORD_RESET_URL", "http://localhost:5173/reset-password"),
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
  mail: {
    deliveryMode: readOptional("MAIL_DELIVERY_MODE", "smtp").toLowerCase(),
    provider: mailProvider,
    host: mailHost,
    port: mailPort,
    secure: mailSecure,
    user: mailUser,
    pass: mailPass,
    fromName: readOptional(
      "SMTP_FROM_NAME",
      readOptional("EMAIL_FROM_NAME", "Charming Fur-fection Pet Care"),
    ),
    fromEmail: readOptional("SMTP_FROM_EMAIL", mailUser).toLowerCase(),
  },
};

function resolveMailDeliveryMode() {
  const configuredMode = env.mail.deliveryMode;

  if (["disabled", "none", "off", "false"].includes(configuredMode)) {
    return "disabled";
  }

  if (env.runtime?.smtpReady) {
    return "smtp";
  }

  return "disabled";
}

env.runtime = {
  loadedEnvFiles,
  missingVariables: Array.from(new Set(missingVariables)),
  firebaseAdminReady: Boolean(
    env.firebase.projectId && env.firebase.clientEmail && env.firebase.privateKey,
  ),
  firebaseWebReady: Boolean(env.firebase.webApiKey),
  jwtReady: Boolean(
    env.auth.jwtSecret &&
      env.auth.otpTicketSecret &&
      env.auth.otpSecret &&
      env.auth.passwordHashPepper,
  ),
  smtpReady: Boolean(
    env.mail.host && env.mail.user && env.mail.pass && env.mail.fromEmail,
  ),
};

env.runtime.mailDeliveryMode = resolveMailDeliveryMode();
env.runtime.mailDeliveryReady = env.runtime.mailDeliveryMode === "smtp";

env.runtime.authReady = Boolean(
  env.runtime.firebaseAdminReady &&
    env.runtime.firebaseWebReady &&
    env.runtime.jwtReady &&
    env.runtime.mailDeliveryReady,
);

function collectStartupChecks() {
  return [
    {
      label: "Firebase Admin",
      required: ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"],
      ready: env.runtime.firebaseAdminReady,
    },
    {
      label: "Firebase Web API",
      required: ["FIREBASE_WEB_API_KEY"],
      ready: env.runtime.firebaseWebReady,
    },
    {
      label: "JWT/Auth Secrets",
      required: ["JWT_SECRET", "OTP_TICKET_SECRET", "OTP_HASH_SECRET", "PASSWORD_HASH_PEPPER"],
      ready: env.runtime.jwtReady,
    },
    {
      label: "Mail Delivery",
      required: ["EMAIL_USER", "EMAIL_PASS"],
      alternatives: ["SMTP_USER", "SMTP_PASS", "SMTP_FROM_EMAIL"],
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
    smtpReady: env.runtime.smtpReady,
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
      userConfigured: Boolean(env.mail.user),
      fromEmailConfigured: Boolean(env.mail.fromEmail),
      passwordConfigured: Boolean(env.mail.pass),
      host: env.mail.host,
      port: env.mail.port,
      secure: env.mail.secure,
      provider: env.mail.provider,
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
    smtpReady: diagnostics.smtpReady,
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
  getStartupDiagnostics,
  validateStartupEnvironment,
};
