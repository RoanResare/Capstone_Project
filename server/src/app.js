const cors = require("cors");
const express = require("express");
const helmet = require("helmet");
const { env } = require("./config/env");
const { buildSetupMessage } = require("./utils/setupGuard");
const adminRoutes = require("./routes/admin.routes");
const authRoutes = require("./routes/auth.routes");
const customerRoutes = require("./routes/customer.routes");
const groqRoutes = require("./routes/groq.routes");
const staffRoutes = require("./routes/staff.routes");
const { errorHandler } = require("./middlewares/errorHandler");

const app = express();
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

app.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Charming Fur-fection backend is running.",
    authReady: env.runtime.authReady,
    mailDeliveryMode: env.runtime.mailDeliveryMode,
    gmailApiReady: env.runtime.gmailApiReady,
    setupMessage: env.runtime.authReady ? "Authentication services are configured." : buildSetupMessage(),
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/customer", customerRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", groqRoutes);
app.use("/api/staff", staffRoutes);

app.use(errorHandler);

module.exports = {
  app,
};
