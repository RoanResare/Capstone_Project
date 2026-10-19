import {apiClient,buildAuthHeaders,extractApiError} from "./apiClient.js";

const PRICELIST_UPDATED = "furfection:pricelist-updated";
const pricelistCache = new Map();
const pricelistRequests = new Map();
export function getCachedPricelists(token) { return token ? pricelistCache.get(token) || null : null; }
export async function loadPricelists(token) {
  if (!token) throw new Error("Sign in to load pricelists.");
  if (pricelistCache.has(token)) return pricelistCache.get(token);
  if (pricelistRequests.has(token)) return pricelistRequests.get(token);
  const request = apiClient.get("/auth/pricelists", {headers: buildAuthHeaders(token)})
    .then(response => {
      pricelistCache.set(token, response.data.pricelists);
      return response.data.pricelists;
    })
    .catch(error => { throw new Error(extractApiError(error, "Unable to load pricelists. Please try again.")); })
    .finally(() => pricelistRequests.delete(token));
  pricelistRequests.set(token, request);
  try {
    return await request;
  } catch (error) {
    throw new Error(extractApiError(error, "Unable to load pricelists. Please try again."));
  }
}

export function subscribePricelists(token, onChange, onError) {
  let disposed = false;
  let running = false;
  let refreshPending = false;
  const refresh = async () => {
    if (disposed) return;
    if (running) { refreshPending = true; return; }
    running = true;
    try {
      const response = await apiClient.get("/auth/pricelists", {headers: buildAuthHeaders(token)});
      const data = response.data.pricelists;
      pricelistCache.set(token, data);
      if (!disposed) onChange(data);
    } catch (error) {
      if (!disposed && !pricelistCache.has(token)) onError(new Error(extractApiError(error, "Unable to load pricelists. Please try again.")));
    } finally {
      running = false;
      if (refreshPending && !disposed) { refreshPending = false; void refresh(); }
    }
  };
  void refresh();
  const interval = window.setInterval(refresh, 30000);
  window.addEventListener(PRICELIST_UPDATED, refresh);
  window.addEventListener("focus", refresh);
  return () => {
    disposed = true;
    window.clearInterval(interval);
    window.removeEventListener(PRICELIST_UPDATED, refresh);
    window.removeEventListener("focus", refresh);
  };
}

export async function savePricelist(token,category,imageDataUrl,expectedRevision){
  try {
    const response=await apiClient.put("/auth/pricelists/"+category,{imageDataUrl,expectedRevision},{headers:buildAuthHeaders(token)});
    if (pricelistCache.has(token)) {
      pricelistCache.set(token, {...pricelistCache.get(token), [category]: response.data.pricelist});
    }
    window.dispatchEvent(new Event(PRICELIST_UPDATED));
    return response.data.pricelist;
  } catch(error) { throw new Error(extractApiError(error,"Unable to save the pricelist.")); }
}
