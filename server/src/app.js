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

const app = express();
app.set("trust proxy", 1);
const frontendIndexCandidates = [
  path.join(__dirname, "../dist/index.html"),
  path.join(__dirname, "../../dist/index.html"),
  path.join(process.cwd(), "dist/index.html"),
  path.join(process.cwd(), "../dist/index.html"),
];
const frontendIndexPath =
  frontendIndexCandidates.find((candidate) => fs.existsSync(candidate)) ||
  frontendIndexCandidates[0];
const frontendDistPath = path.dirname(frontendIndexPath);
const productionFrontendOrigin = "https://capstone-project-1-yqto.onrender.com";

const allowedOrigins = Array.from(
  new Set(
    [productionFrontendOrigin, ...env.clientUrl.split(",")]
      .map((origin) => origin.trim())
      .filter(Boolean),
  ),
);

function isLoopbackOrigin(origin = "") {
  try {
    const parsed = new URL(origin);
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      const allowLoopback =
        env.nodeEnv !== "production" && origin && isLoopbackOrigin(origin);

      if (!origin || allowedOrigins.includes(origin) || allowLoopback) {
        return callback(null, true);
      }

      return callback(new Error("Origin is not allowed by CORS."));
    },
  }),
);
app.use(helmet());
app.use(express.json({ limit: "1mb" }));

function sendFrontendIndex(_req, res, next) {
  if (!fs.existsSync(frontendIndexPath)) {
    console.error("[frontend] SPA entry point was not found.", {
      frontendIndexPath,
    });
    return next();
  }

  res.set("Cache-Control", "no-store");
  return res.sendFile(frontendIndexPath, (error) => {
    if (error) {
      next(error);
    }
  });
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

  res.status(200).json({
    success: true,
    message: "Charming Fur-fection backend is running.",
    authReady: env.runtime.authReady,
    mailDeliveryMode: env.runtime.mailDeliveryMode,
    gmailApiReady: env.runtime.gmailApiReady,
    setupMessage: env.runtime.authReady ? "Authentication services are configured." : buildSetupMessage(),
  });
});

// Firebase password-reset links include mode/oobCode query parameters. Serve
// the SPA shell explicitly so Render never treats this browser route as a 404.
app.get(/^\/reset-password(?:\/.*)?$/, sendFrontendIndex);

app.use("/api/auth", authRoutes);
app.use("/api/customer", customerRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", groqRoutes);
app.use("/api/staff", staffRoutes);

// Render serves this Node process in production. Mount the Vite output after
// the API routes so browser assets are available without intercepting API JSON.
app.use(express.static(frontendDistPath));

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
};
