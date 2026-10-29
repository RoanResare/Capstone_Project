const { ApiError } = require("../utils/ApiError");

function errorHandler(error, _req, res, _next) {
  const invalidJson = error?.type === "entity.parse.failed";
  const statusCode = error instanceof ApiError ? error.statusCode : invalidJson ? 400 : 500;
  const message =
    error instanceof ApiError
      ? error.message
      : invalidJson ? "The request body must contain valid JSON."
      : "An unexpected error occurred while processing the request.";

  if (statusCode >= 500) {
    console.error(error);
  }

  res.status(statusCode).json({
    success: false,
    message,
    details: error instanceof ApiError ? error.details : null,
  });
}

module.exports = {
  errorHandler,
};
