const cors = require("cors");
const express = require("express");
const fs = require("fs");
const helmet = require("helmet");
const path = require("path");
const { env } = require("./config/env");
const { buildSetupMessage } = require("./utils/setupGuard");
const adminRoutes = require("./routes/admin.routes");
const authRoutes = require("./routes/auth.routes");
const customerRoutes = require("./routes/customer.routes");
const groqRoutes = require("./routes/groq.routes");
const staffRoutes = require("./routes/staff.routes");
const { errorHandler } = require("./middlewares/errorHandler");
const { getTrustedProxies } = require("./utils/proxyTrust");
const { getAllowedClientOrigins } = require("./config/clientOrigins");

const app = express();
app.set("trust proxy", getTrustedProxies(env.security.trustedProxyCidrs));
const projectRoot = path.resolve(__dirname, "../..");
const configuredFrontendDir = process.env.FRONTEND_DIST_DIR
  ? path.resolve(process.env.FRONTEND_DIST_DIR)
  : "";
const frontendDistCandidates = [
  configuredFrontendDir,
  path.resolve(projectRoot, "server", "dist"),
  path.resolve(projectRoot, "dist"),
  path.resolve(process.cwd(), "dist"),
  path.resolve(process.cwd(), "server", "dist"),
].filter(Boolean);
const frontendDistPath = frontendDistCandidates.find(candidate => fs.existsSync(path.join(candidate, "index.html"))) ||
  path.resolve(projectRoot, "server", "dist");
const frontendIndexPath = path.join(frontendDistPath, "index.html");
const frontendIndexCandidates = [
  frontendIndexPath,
  path.join(__dirname, "../dist/index.html"),
  path.join(projectRoot, "dist/index.html"),
  path.join(process.cwd(), "../dist/index.html"),
  path.join(process.cwd(), "dist/index.html"),
];
const resetPasswordIndexPath =
  frontendIndexCandidates.find((candidate) => fs.existsSync(candidate)) || frontendIndexPath;
if (!fs.existsSync(frontendIndexPath)) {
  console.error("[frontend] SPA build is missing. Run `npm run build` from the repository root or `npm run build` from server/ before starting the service.", {
    expectedIndexPath: frontendIndexPath,
    checkedDirectories: frontendDistCandidates,
  });
}
const allowedOrigins = getAllowedClientOrigins();
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Accept", "Authorization", "Content-Type", "X-Database-Provider"],
  maxAge: 600,
  optionsSuccessStatus: 204,
  preflightContinue: false,
};
const databaseConnectOrigins = [];
if (process.env.DATABASE_PROVIDER === "postgres") {
  try {
    const supabaseOrigin = new URL(process.env.SUPABASE_URL);
    if (supabaseOrigin.protocol !== "https:") throw new Error("Use an HTTPS Supabase URL.");
    databaseConnectOrigins.push(supabaseOrigin.origin, `wss://${supabaseOrigin.host}`);
  } catch (_error) { throw new Error("Configure a valid HTTPS Supabase project URL before enabling PostgreSQL."); }
}

// Mounted before routes so cors handles all browser preflight OPTIONS requests.
app.use(cors(corsOptions));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      connectSrc: [
        "'self'",
        "https://identitytoolkit.googleapis.com",
        "https://securetoken.googleapis.com",
        "https://api.charmingfurfectionpetscareservices.online",
        "https://api.charmingfurfectionpetservices.online",
        "https://capstone-project-bczf.onrender.com",
        ...databaseConnectOrigins,
      ],
      imgSrc: ["'self'", "data:", "https://www.google.com"],
    },
  },
}));
app.use(express.json({ limit: "8mb" }));
app.use("/api", (req, res, next) => {
  const requestedProvider = req.get("X-Database-Provider");
  if (requestedProvider && requestedProvider !== (process.env.DATABASE_PROVIDER || "postgres")) {
    return res.status(409).json({ success: false, message: "The client and server database providers do not match. Reload after the staging configuration is synchronized.", details: { code: "DATABASE_PROVIDER_MISMATCH" } });
  }
  next();
});

function sendFrontendIndex(req, res, next) {
  const indexPath = req.path.startsWith("/reset-password")
    ? resetPasswordIndexPath
    : frontendIndexPath;

  if (!fs.existsSync(indexPath)) {
    return redirectToFrontendSite(req, res);
  }

  res.set("Cache-Control", "no-store");
  return res.sendFile(indexPath, (error) => {
    if (error) {
      next(error);
    }
  });
}

function redirectToFrontendSite(req, res) {
  const frontendUrl = new URL(env.frontendSiteUrl);
  if (frontendUrl.host.toLowerCase() === String(req.get("host") || "").toLowerCase()) {
    return res.status(503).type("html").send(
      "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Frontend unavailable</title>" +
      "<main><h1>Frontend temporarily unavailable</h1><p>The frontend service has not published its app bundle yet.</p></main></html>",
    );
  }

  const requestedUrl = new URL(req.originalUrl || "/", "http://backend.invalid");
  frontendUrl.pathname = requestedUrl.pathname;
  frontendUrl.search = requestedUrl.search;
  return res.redirect(302, frontendUrl.toString());
}

function setStaticCacheHeaders(res, filePath) {
  const filename = path.basename(filePath);

  if (filename === "index.html") {
    res.set("Cache-Control", "no-store");
    return;
  }

  if (
    filePath.includes(`${path.sep}assets${path.sep}`) ||
    /\.[A-Za-z0-9_-]{8,}\.(?:css|js|png|jpg|jpeg|webp|svg|woff2?)$/i.test(filename)
  ) {
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    return;
  }

  res.set("Cache-Control", "public, max-age=300");
}

app.get("/", (_req, res, next) => {
  if (fs.existsSync(frontendIndexPath)) {
    res.set("Cache-Control", "no-store");
    return res.sendFile(frontendIndexPath, (error) => {
      if (error) {
        next(error);
      }
    });
  }

  return redirectToFrontendSite(_req, res);
});

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Charming Fur-fection backend is running.",
    authReady: env.runtime.authReady,
    mailDeliveryMode: env.runtime.mailDeliveryMode,
    resendReady: env.runtime.resendReady,
    setupMessage: env.runtime.authReady ? "Authentication services are configured." : buildSetupMessage(),
  });
});

// Older password-reset links may include mode/oobCode query parameters. Serve
// the SPA shell explicitly so Render never treats this browser route as a 404.
app.get("/reset-password", sendFrontendIndex);
app.get("/activate-account", sendFrontendIndex);

app.get(/^\/reset-password\/.+$/, sendFrontendIndex);

app.use("/api/auth", authRoutes);
app.use("/api/database", require("./routes/database.routes"));
app.use("/api/customer", customerRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", groqRoutes);
app.use("/api/staff", staffRoutes);

// Render serves this Node process in production. Mount the Vite output after
// the API routes so browser assets are available without intercepting API JSON.
app.use(express.static(frontendDistPath, { setHeaders: setStaticCacheHeaders }));

// React Router owns frontend paths such as /reset-password. This must stay
// after API routes and static assets so browser refreshes receive index.html.
// Express 5 uses the named wildcard syntax; `*` by itself throws at startup.
app.get("/{*splat}", (req, res, next) => {
  if (req.path === "/api" || req.path.startsWith("/api/")) {
    return next();
  }

  return sendFrontendIndex(req, res, next);
});

app.use(errorHandler);

module.exports = {
  app,
  frontendDistPath,
  frontendIndexPath,
};
