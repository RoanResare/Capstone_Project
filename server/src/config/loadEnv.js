const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const projectRoot = path.resolve(__dirname, "../../../");
const serverRoot = path.resolve(__dirname, "../../");

let cachedReport = null;

function loadSingleEnvFile(targetPath, override = false) {
  if (!fs.existsSync(targetPath)) {
    return {
      path: targetPath,
      exists: false,
      override,
      loaded: false,
      loadedKeys: [],
    };
  }

  const result = dotenv.config({
    path: targetPath,
    override,
    quiet: true,
  });

  if (result.error) {
    return {
      path: targetPath,
      exists: true,
      override,
      loaded: false,
      loadedKeys: [],
      error: result.error.message,
    };
  }

  return {
    path: targetPath,
    exists: true,
    override,
    loaded: true,
    loadedKeys: Object.keys(result.parsed || {}),
  };
}

function loadEnvFiles() {
  if (cachedReport) {
    return cachedReport;
  }

  const files = [
    loadSingleEnvFile(path.join(projectRoot, ".env"), false),
    loadSingleEnvFile(path.join(serverRoot, ".env"), true),
  ];

  cachedReport = {
    projectRoot,
    serverRoot,
    files,
    loadedAt: new Date().toISOString(),
  };

  return cachedReport;
}

function logEnvLoadSummary(logger = console, options = {}) {
  const report = loadEnvFiles();
  const verbose = options.verbose === true || process.env.LOG_ENV_LOADS === "true";

  report.files.forEach((file) => {
    if (!file.exists) {
      logger.warn(`[env] File not found: ${file.path}`);
      return;
    }

    if (!file.loaded) {
      logger.error(`[env] Failed to load ${file.path}: ${file.error || "Unknown error"}`);
      return;
    }

    if (verbose) {
      logger.info(`[env] Loaded ${file.path}`, {
        override: file.override,
        keys: file.loadedKeys.length,
      });
    }
  });
}

module.exports = {
  loadEnvFiles,
  logEnvLoadSummary,
  projectRoot,
  serverRoot,
};
