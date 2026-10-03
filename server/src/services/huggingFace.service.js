const { env } = require("../config/env");
const { ApiError } = require("../utils/ApiError");

const PET_LABEL_PATTERN = /\b(cat|kitten|dog|puppy|retriever|terrier|spaniel|poodle|bulldog|shepherd|hound|beagle|collie|chihuahua|dachshund|pug|husky|malamute|mastiff|pinscher|schnauzer|shih[- ]?tzu|pomeranian|corgi|boxer|rottweiler|doberman)\b/i;

function decodeImageDataUrl(value = "") {
  const match = String(value).match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) {
    throw new ApiError(400, "Upload a valid JPG, PNG, or WEBP pet image.");
  }

  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > 5 * 1024 * 1024) {
    throw new ApiError(400, "Pet images must be 5 MB or smaller.");
  }

  return { buffer, contentType: match[1].toLowerCase() };
}

async function prescreenPetImage(imageDataUrl) {
  const { buffer, contentType } = decodeImageDataUrl(imageDataUrl);

  if (!env.security.huggingFaceApiKey) {
    return {
      configured: false,
      allowed: env.nodeEnv !== "production",
      reason:
        env.nodeEnv === "production"
          ? "Automated pet photo screening is not configured."
          : "Automated pre-screening is not configured; admin review is required.",
      labels: [],
    };
  }

  const endpoint = `https://api-inference.huggingface.co/models/${encodeURIComponent(env.security.huggingFaceModel).replace("%2F", "/")}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.security.huggingFaceApiKey}`,
      "Content-Type": contentType,
      Accept: "application/json",
    },
    body: buffer,
  });

  const result = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(result)) {
    throw new ApiError(503, "Automated pet photo screening is temporarily unavailable.");
  }

  const labels = result
    .filter((entry) => entry && typeof entry.label === "string")
    .slice(0, 5)
    .map((entry) => ({ label: entry.label, score: Number(entry.score) || 0 }));
  const petMatch = labels.find((entry) => PET_LABEL_PATTERN.test(entry.label) && entry.score >= 0.2);

  return {
    configured: true,
    allowed: Boolean(petMatch),
    reason: petMatch ? "Pet image detected." : "The image does not appear to contain a cat or dog.",
    labels,
  };
}

module.exports = { prescreenPetImage };
