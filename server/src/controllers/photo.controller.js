const { prescreenPetImage } = require("../services/huggingFace.service");
const { ApiError } = require("../utils/ApiError");

async function prescreenPetPhoto(req, res) {
  const imageDataUrl = typeof req.body?.imageDataUrl === "string" ? req.body.imageDataUrl : "";
  if (!imageDataUrl) {
    throw new ApiError(400, "A pet image is required.");
  }

  const result = await prescreenPetImage(imageDataUrl);
  if (!result.allowed) {
    throw new ApiError(422, result.reason, result);
  }

  return res.status(200).json({ success: true, ...result });
}

module.exports = { prescreenPetPhoto };
