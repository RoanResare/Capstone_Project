const { ApiError } = require("./ApiError");

async function assertAppropriateText(record, fields) {
  const policy = await import("../../../shared/textModeration.mjs");
  try { policy.assertAppropriateText(record, fields); }
  catch (error) {
    throw new ApiError(400, error.message, { code: "INVALID_TEXT", fields: error.fields });
  }
}

module.exports = { assertAppropriateText };
