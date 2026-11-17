const { ApiError } = require("../utils/ApiError");

// Transactional create-if-missing keeps initialization safe during concurrent saves.
async function loadPricelists(db) {
  if (!db) throw new ApiError(503, "Pricelist storage is not configured. Please contact the administrator.");
  const { PRICELIST_CATEGORIES } = await import("../../../shared/pricelists.mjs");
  return db.runTransaction(async transaction => {
    const references = PRICELIST_CATEGORIES.map(category => db.collection("servicePricelists").doc(category.id));
    const snapshots = await transaction.getAll(...references);
    return Object.fromEntries(PRICELIST_CATEGORIES.map((category, index) => {
      const defaults = { categoryId: category.id, name: category.name, imageUrl: "", objectPath: "", revision: 0 };
      const snapshot = snapshots[index];
      if (!snapshot.exists) transaction.set(references[index], defaults);
      return [category.id, { ...defaults, ...(snapshot.exists ? snapshot.data() : {}) }];
    }));
  });
}
module.exports = { loadPricelists };
