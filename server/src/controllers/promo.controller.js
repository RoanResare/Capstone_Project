const { db } = require("../config/firebaseAdmin");
const { ApiError } = require("../utils/ApiError");

async function saveKaponPromo(req, res) {
  const user = req.auth.user;
  if (!["admin", "staff"].includes(user.role) ||
      (user.accountStatus && user.accountStatus !== "active") ||
      ["inactive", "suspended"].includes(user.status) || ["suspended", "banned"].includes(user.fraudStatus)) {
    throw new ApiError(403, "Only active admin and staff accounts can manage promotions.");
  }
  const { action, expectedRevision } = req.body || {};
  if (!["activate", "edit", "deactivate"].includes(action) || !Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new ApiError(400, "A valid promo action and revision are required.");
  }
  const { normalizePromoInput } = await import("../../../shared/lowCostKaponPromo.mjs");
  let configuration;
  if (action !== "deactivate") {
    try { configuration = normalizePromoInput(req.body); }
    catch (error) { throw new ApiError(400, error.message); }
  }
  const reference = db.collection("promotions").doc("low-cost-kapon");
  const detailsReference = db.collection("promotionDetails").doc("low-cost-kapon");
  const promo = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const current = snapshot.data() || {};
    if ((current.revision || 0) !== expectedRevision) {
      throw new ApiError(409, "The promotion was changed by another employee. Review the latest details and try again.");
    }
    if ((action === "edit" || action === "deactivate") && current.isActive !== true) {
      throw new ApiError(409, "This promotion is no longer active.");
    }
    if (action === "activate" && current.isActive === true) {
      throw new ApiError(409, "This promotion is already active. Use Edit Promo to change it.");
    }
    const now = new Date().toISOString();
    if (configuration?.endsAt && configuration.endsAt <= now) {
      throw new ApiError(400, "End time must be in the future.");
    }
    const actor = { uid: user.uid, name: user.name || user.fullName || "", role: user.role };
    const next = action === "deactivate"
      ? { isActive: false, revision: expectedRevision + 1 }
      : { ...configuration, isActive: true, revision: expectedRevision + 1 };
    transaction.set(reference, next);
    transaction.set(detailsReference, {
      ...(configuration || {}),
      isActive: next.isActive,
      revision: next.revision,
      updatedAt: now,
      updatedBy: actor,
      ...(action === "activate" ? { activatedAt: now, activatedBy: actor } : {}),
      ...(action === "deactivate" ? { deactivatedAt: now, deactivatedBy: actor } : {}),
    }, { merge: true });
    return next;
  });
  res.json({ promo });
}

module.exports = { saveKaponPromo };
