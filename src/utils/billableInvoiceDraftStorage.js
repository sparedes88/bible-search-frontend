const DRAFT_PREFIX = "billable-invoice-preview:";
const MAX_DRAFTS = 5;
const draftCache = new Map();

const cacheDraft = (key, payload) => {
  draftCache.delete(key);
  draftCache.set(key, payload);
  while (draftCache.size > MAX_DRAFTS) {
    draftCache.delete(draftCache.keys().next().value);
  }
};

export const saveBillableInvoiceDraft = (key, payload) => {
  if (!key || !key.startsWith(DRAFT_PREFIX)) return;
  cacheDraft(key, payload);

  try {
    const storage = window.sessionStorage;
    const previousKeys = Object.keys(storage)
      .filter((storedKey) => storedKey.startsWith(DRAFT_PREFIX) && storedKey !== key)
      .sort((left, right) => Number(right.split(":")[2]) - Number(left.split(":")[2]));
    previousKeys.slice(MAX_DRAFTS - 1).forEach((storedKey) => storage.removeItem(storedKey));
    const serialized = JSON.stringify(payload);
    try {
      storage.setItem(key, serialized);
    } catch (error) {
      previousKeys.forEach((storedKey) => storage.removeItem(storedKey));
      storage.removeItem(key);
      storage.setItem(key, serialized);
    }
  } catch (error) {
    return false;
  }
  return true;
};

export const loadBillableInvoiceDraft = (key) => {
  if (!key || !key.startsWith(DRAFT_PREFIX)) return null;
  if (draftCache.has(key)) return draftCache.get(key);

  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    cacheDraft(key, payload);
    return payload;
  } catch (error) {
    return null;
  }
};