const { logEnvLoadSummary } = require("./config/loadEnv");
const { app } = require("./app");
const { env, validateStartupEnvironment } = require("./config/env");
const { verifyMailerConnection } = require("./config/mailer");

logEnvLoadSummary();

try {
  validateStartupEnvironment();
} catch (error) {
  console.error("[startup] Fatal configuration error.", {
    message: error instanceof Error ? error.message : String(error || "Unknown error"),
  });
  process.exit(1);
}

app.listen(env.port, () => {
  console.info("[startup] Server ready.", {
    port: env.port,
    clientUrl: env.clientUrl,
  });

  verifyMailerConnection()
    .catch((error) => {
      console.error("[mail] SMTP connection verification failed.", {
        provider: env.mail.provider,
        host: env.mail.host,
        port: env.mail.port,
        error: error instanceof Error ? error.message : error,
      });
    });
});
