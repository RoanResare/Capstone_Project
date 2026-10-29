const { logEnvLoadSummary } = require("./config/loadEnv");
const { app, frontendIndexPath } = require("./app");
const { env, validateStartupEnvironment } = require("./config/env");
const { getMailTransportSettings } = require("./config/mailer");
const { startDisposableEmailUpdates } = require("./services/disposableEmailDomains.service");
const { startPendingRegistrationCleanup } = require("./services/pendingRegistrationCleanup.service");
const { startAppointmentReminders } = require("./services/appointmentReminder.service");
const { startAppointmentNoShowUpdates } = require("./services/appointmentNoShow.service");

logEnvLoadSummary();

try {
  validateStartupEnvironment();
} catch (error) {
  console.error("[startup] Fatal configuration error.", {
    message: error instanceof Error ? error.message : String(error || "Unknown error"),
  });
  process.exit(1);
}

startDisposableEmailUpdates();
startPendingRegistrationCleanup();
startAppointmentReminders();
startAppointmentNoShowUpdates();

app.listen(env.port, () => {
  console.info("[startup] Server ready.", {
    port: env.port,
    clientUrl: env.clientUrl,
    frontendEntryPoint: frontendIndexPath,
  });

  // Sending-only Resend keys cannot list account resources for an SMTP-style
  // connection check. Actual API acceptance is checked on every email send.
  console.info("[mail] Resend HTTPS delivery configured.", getMailTransportSettings());
});
