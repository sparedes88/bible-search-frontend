import { loadBillableInvoiceDraft, saveBillableInvoiceDraft } from "./billableInvoiceDraftStorage";

const draftKey = (name) => `billable-invoice-preview:2155:${name}:test`;

afterEach(() => {
  jest.restoreAllMocks();
  sessionStorage.clear();
});

test("stores a draft for navigation and reload", () => {
  const payload = { invoiceId: "invoice-1", users: [] };
  expect(saveBillableInvoiceDraft(draftKey("saved"), payload)).toBe(true);
  expect(JSON.parse(sessionStorage.getItem(draftKey("saved")))).toEqual(payload);
  expect(loadBillableInvoiceDraft(draftKey("saved"))).toEqual(payload);
});

test("reads existing drafts created before the storage fix", () => {
  sessionStorage.setItem(draftKey("legacy"), JSON.stringify({ invoiceId: "legacy" }));
  expect(loadBillableInvoiceDraft(draftKey("legacy"))).toEqual({ invoiceId: "legacy" });
});

test("recovers quota by removing only previous invoice previews", () => {
  const oldKey = draftKey("old");
  sessionStorage.setItem(oldKey, "old preview");
  sessionStorage.setItem("unrelated-setting", "keep");
  const originalSetItem = Storage.prototype.setItem;
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
    if (this.getItem(oldKey)) throw new DOMException("Full", "QuotaExceededError");
    return originalSetItem.call(this, key, value);
  });
  expect(saveBillableInvoiceDraft(draftKey("recovered"), { invoiceId: "recovered" })).toBe(true);
  expect(sessionStorage.getItem(oldKey)).toBeNull();
  expect(sessionStorage.getItem("unrelated-setting")).toBe("keep");
});

test("opens and updates an oversized draft even when every storage write fails", () => {
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Full", "QuotaExceededError");
  });
  const key = draftKey("oversized");
  expect(saveBillableInvoiceDraft(key, { invoiceId: "large" })).toBe(false);
  expect(loadBillableInvoiceDraft(key)).toEqual({ invoiceId: "large" });
  saveBillableInvoiceDraft(key, { invoiceId: "large", billableExcludedPersonKeys: ["person"] });
  expect(loadBillableInvoiceDraft(key).billableExcludedPersonKeys).toEqual(["person"]);
});

test("keeps the preview usable when tracking prevention blocks storage access", () => {
  jest.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
    throw new DOMException("Blocked", "SecurityError");
  });
  const key = draftKey("blocked");
  expect(saveBillableInvoiceDraft(key, { invoiceId: "blocked" })).toBe(false);
  expect(loadBillableInvoiceDraft(key)).toEqual({ invoiceId: "blocked" });
});

test("bounds stored snapshots without removing unrelated session data", () => {
  sessionStorage.setItem("auth-setting", "keep");
  for (let index = 0; index < 8; index += 1) {
    saveBillableInvoiceDraft(draftKey(String(index)), { invoiceId: String(index) });
  }
  expect(Object.keys(sessionStorage).filter((key) => key.startsWith("billable-invoice-preview:"))).toHaveLength(5);
  expect(sessionStorage.getItem(draftKey("0"))).toBeNull();
  expect(sessionStorage.getItem("auth-setting")).toBe("keep");
});

test("returns null for missing or corrupt snapshots", () => {
  sessionStorage.setItem(draftKey("corrupt"), "not json");
  expect(loadBillableInvoiceDraft(draftKey("corrupt"))).toBeNull();
  expect(loadBillableInvoiceDraft(draftKey("missing"))).toBeNull();
});