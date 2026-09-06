const DEFAULT_MAX_DIMENSION = 800;
const DEFAULT_QUALITY = 0.7;
const DEFAULT_OUTPUT_TYPE = "image/jpeg";

function normalizeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function loadImageFromObjectUrl(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The selected image could not be read."));
    image.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error("The selected image could not be compressed."));
      },
      type,
      quality,
    );
  });
}

export async function compressImageFile(file, options = {}) {
  if (!file) {
    return null;
  }

  if (typeof document === "undefined" || typeof URL === "undefined") {
    return file;
  }

  const maxDimension = normalizeNumber(options.maxDimension, DEFAULT_MAX_DIMENSION);
  const quality = Math.min(1, Math.max(0.1, Number(options.quality) || DEFAULT_QUALITY));
  const outputType = options.outputType || file.type || DEFAULT_OUTPUT_TYPE;
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await loadImageFromObjectUrl(objectUrl);
    const width = image.naturalWidth || image.width || 1;
    const height = image.naturalHeight || image.height || 1;
    const ratio = Math.min(1, maxDimension / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));

    const context = canvas.getContext("2d");
    if (!context) {
      return file;
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas, outputType, quality);

    return new File([blob], file.name || "image.jpg", {
      type: blob.type || outputType,
      lastModified: Date.now(),
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function compressImageFileToDataUrl(file, options = {}) {
  const compressedFile = await compressImageFile(file, options);

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("The selected image could not be read."));
    reader.readAsDataURL(compressedFile || file);
  });
}
