const { ApiError } = require("../utils/ApiError");

function errorHandler(error, _req, res, _next) {
  const statusCode = error instanceof ApiError ? error.statusCode : 500;
  const message =
    error instanceof ApiError
      ? error.message
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
