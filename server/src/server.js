const { logEnvLoadSummary } = require("./config/loadEnv");
const { app } = require("./app");
const { env, validateStartupEnvironment } = require("./config/env");
const { getMailTransportSettings, verifyMailerConnection } = require("./config/mailer");

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
      const transportSettings = getMailTransportSettings();

      console.error("[mail] Gmail API verification failed.", {
        provider: transportSettings.provider,
        transport: transportSettings.transport,
        error: error instanceof Error ? error.message : error,
      });
    });
});
