const { db } = require("../config/postgresDatabase");
const { ApiError } = require("../utils/ApiError");
const { inflateSync } = require("node:zlib");

const RESERVED_STATUSES = ["Pending", "Approved", "Accepted", "Confirmed"];
const MAX_PET_PHOTO_DATA_URL_BYTES = 1_450_000;
const PET_PHOTO_DATA_URL = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/i;

function validatePetPhoto(value) {
  if (value === "") return;
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_PET_PHOTO_DATA_URL_BYTES) {
    throw new ApiError(413, "Pet photo must be 1 MB or smaller.");
  }
  const match = PET_PHOTO_DATA_URL.exec(value);
  if (!match) throw new ApiError(400, "Choose a valid JPG, PNG, or WebP pet photo.");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.toString("base64").replace(/=+$/, "") !== match[2].replace(/=+$/, "") || bytes.length > 1_048_576) {
    throw new ApiError(400, "Pet photo content is invalid or exceeds 1 MB.");
  }
  const format = match[1].toLowerCase();
  const valid = format === "jpeg"
    ? isValidJpeg(bytes)
    : format === "png"
      ? isValidPng(bytes)
      : isValidWebp(bytes);
  if (!valid) throw new ApiError(400, "Pet photo content is corrupt or does not match its image format.");
}

function isValidJpeg(bytes) {
  if (bytes.length < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let offset = 2, hasFrame = false, hasScan = false;
  while (offset < bytes.length - 2) {
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) return hasFrame && hasScan && offset === bytes.length;
    if ([0xd8, 0x01, ...Array.from({length: 8}, (_, i) => 0xd0 + i)].includes(marker)) continue;
    if (offset + 2 > bytes.length) return false;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return false;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8 || !bytes.readUInt16BE(offset + 3) || !bytes.readUInt16BE(offset + 5)) return false;
      hasFrame = true;
    }
    if (marker === 0xda) {
      if (!hasFrame) return false;
      hasScan = true;
      offset += length;
      while (offset < bytes.length - 1) {
        if (bytes[offset++] !== 0xff) continue;
        const following = bytes[offset++];
        if (following === 0x00 || (following >= 0xd0 && following <= 0xd7)) continue;
        if (following === 0xd9) return offset === bytes.length;
        offset -= 2;
        break;
      }
      if (offset >= bytes.length - 1) return false;
      continue;
    }
    offset += length;
  }
  return false;
}

function isValidWebp(bytes) {
  if (bytes.length < 25 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.readUInt32LE(4) !== bytes.length - 8 || bytes.toString("ascii", 8, 12) !== "WEBP") return false;
  let offset = 12, hasImage = false;
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString("ascii", offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const bodyStart = offset + 8;
    if (!length || bodyStart + length > bytes.length) return false;
    if (type === "VP8 ") {
      if (length < 10 || bytes[bodyStart + 3] !== 0x9d || bytes[bodyStart + 4] !== 0x01 || bytes[bodyStart + 5] !== 0x2a) return false;
      hasImage = true;
    } else if (type === "VP8L") {
      if (length < 5 || bytes[bodyStart] !== 0x2f) return false;
      hasImage = true;
    } else if (type === "VP8X") {
      if (length !== 10) return false;
    }
    offset = bodyStart + length + (length & 1);
  }
  return hasImage && offset === bytes.length;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isValidPng(bytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(signature)) return false;
  let offset = 8, hasHeader = false, hasData = false, hasEnd = false;
  const compressed = [];
  try {
    while (offset + 12 <= bytes.length) {
      const size = bytes.readUInt32BE(offset);
      if (size > bytes.length - offset - 12) return false;
      const type = bytes.toString("ascii", offset + 4, offset + 8);
      const body = bytes.subarray(offset + 8, offset + 8 + size);
      const expectedCrc = bytes.readUInt32BE(offset + 8 + size);
      if (crc32(bytes.subarray(offset + 4, offset + 8 + size)) !== expectedCrc) return false;
      if (type === "IHDR") {
        if (hasHeader || size !== 13 || !bytes.readUInt32BE(offset + 8) || !bytes.readUInt32BE(offset + 12)) return false;
        const depth = body[8], color = body[9], interlace = body[12];
        const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
        if (!depths[color]?.includes(depth) || body[10] !== 0 || body[11] !== 0 || ![0, 1].includes(interlace)) return false;
        hasHeader = true;
      } else if (type === "IDAT") { if (!hasHeader || hasEnd) return false; hasData = true; compressed.push(body); }
      else if (type === "IEND") { if (size !== 0 || !hasData) return false; hasEnd = true; offset += size + 12; break; }
      offset += size + 12;
    }
    if (!hasHeader || !hasData || !hasEnd || offset !== bytes.length) return false;
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), depth = bytes[24], color = bytes[25], interlace = bytes[28];
    if (width > 16_384 || height > 16_384) return false;
    const bitsPerPixel = depth * ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[color];
    const passes = interlace === 0
      ? [[0, 0, 1, 1]]
      : [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
    let expectedLength = 0;
    const rows = [];
    for (const [startX, startY, stepX, stepY] of passes) {
      const passWidth = width <= startX ? 0 : Math.ceil((width - startX) / stepX);
      const passHeight = height <= startY ? 0 : Math.ceil((height - startY) / stepY);
      if (!passWidth || !passHeight) continue;
      const rowBytes = Math.ceil(passWidth * bitsPerPixel / 8);
      expectedLength += passHeight * (rowBytes + 1);
      rows.push({ count: passHeight, rowBytes });
    }
    const decoded = inflateSync(Buffer.concat(compressed), { maxOutputLength: 32 * 1024 * 1024 });
    if (decoded.length !== expectedLength) return false;
    let rowOffset = 0;
    for (const pass of rows) for (let row = 0; row < pass.count; row++) {
      if (decoded[rowOffset] > 4) return false;
      rowOffset += pass.rowBytes + 1;
    }
    return true;
  } catch { return false; }
}

async function savePet(req, res) {
  const { assertAppropriatePetText } = await import("../../../shared/petTextValidation.mjs");
  const id = req.params.id;
  const user = req.auth.user;
  const input = req.body;
  if (!id || id.includes("/") || [".", ".."].includes(id) || !input || input.id !== id) throw new ApiError(400, "A valid pet profile is required.");
  if (!["customer", "admin", "staff"].includes(user.role)) throw new ApiError(403, "You cannot save pet profiles.");
  try { assertAppropriatePetText(input); }
  catch (error) { throw new ApiError(400, error.message, { code: "INVALID_PET_TEXT", fields: error.fields }); }
  if (Object.hasOwn(input, "photoURL")) validatePetPhoto(input.photoURL);
  if (!["Male", "Female"].includes(input.gender)) throw new ApiError(400, "Pet gender must be Male or Female.");
  if (![input.petType, input.breed].every(value => typeof value === "string" && value.trim() && value.length <= 100)) throw new ApiError(400, "Pet type and breed are required (maximum 100 characters each).");
  const ref = db.collection("pets").doc(id);
  await db.runTransaction(async transaction => {
    const existing = await transaction.get(ref);
    const deleted = await transaction.get(db.collection("deletedPets").doc(id));
    if (deleted.exists) throw new ApiError(409, "This pet profile was deleted. Create a new profile.");
    const previous = existing.exists ? existing.data() : {};
    const ownsPet = previous.customerId === user.uid || (!previous.customerId && previous.customerEmail && previous.customerEmail.toLowerCase() === user.email?.toLowerCase());
    if (user.role === "customer" && existing.exists && !ownsPet) throw new ApiError(403, "You can only update your own pet profiles.");
    const data = { id, petName: input.petName.trim(), petType: input.petType.trim(), breed: input.breed.trim(), gender: input.gender,
      notes: input.notes ?? "", ageUnit: input.ageUnit === "years" ? "years" : "months", updatedAt: new Date().toISOString(),
      createdAt: previous.createdAt || new Date().toISOString() };
    if (typeof input.photoURL === "string") data.photoURL = input.photoURL;
    for (const field of ["ageValue", "weightKg"]) data[field] = typeof input[field] === "string" ? input[field].slice(0, 20) : "";
    if (user.role === "customer") {
      Object.assign(data, { customerId: user.uid, customerEmail: user.email || "", ownerName: user.fullName || user.name || "" });
      if (!existing.exists) Object.assign(data, { lastVisit: "", visitRecords: [], medicalRecords: [] });
    } else {
      for (const field of ["customerId", "customerEmail", "ownerName", "lastVisit"]) {
        if (typeof input[field] === "string") data[field] = input[field];
      }
      for (const field of ["visitRecords", "medicalRecords"]) {
        if (Array.isArray(input[field])) data[field] = input[field];
      }
    }
    transaction.set(ref, data, { merge: true });
  });
  res.json({ success: true });
}

async function deletePet(req, res) {
  const id = req.params.id;
  const user = req.auth.user;
  if (!id || id.includes("/")) throw new ApiError(400, "A valid pet profile is required.");
  if (!["customer", "admin", "staff"].includes(user.role)) throw new ApiError(403, "You cannot delete pet profiles.");
  const petRef = db.collection("pets").doc(id);
  let deletedAppointmentIds = [];
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(petRef);
    if (!snapshot.exists) throw new ApiError(404, "This pet profile no longer exists.");
    const pet = snapshot.data();
    const ownsPet = pet.customerId === user.uid || (!pet.customerId && pet.customerEmail?.toLowerCase() === user.email?.toLowerCase());
    if (user.role === "customer" && !ownsPet) throw new ApiError(403, "You can only delete your own pet profiles.");
    const appointments = await transaction.get(db.collection("appointments").where("petRecordId", "==", id));
    deletedAppointmentIds = appointments.docs.filter((entry) => RESERVED_STATUSES.includes(entry.data().status)).map((entry) => entry.id);
    for (const appointmentId of deletedAppointmentIds) transaction.delete(db.collection("appointments").doc(appointmentId));
    transaction.set(db.collection("deletedPets").doc(id), { deletedAt: new Date().toISOString() });
    transaction.delete(petRef);
  });
  res.json({ success: true, deletedAppointmentIds });
}

module.exports = { deletePet, savePet, validatePetPhoto };
