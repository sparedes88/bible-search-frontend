import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { getDocs, onSnapshot, updateDoc } from "firebase/firestore";
import GlobalOrganizationManager from "./GlobalOrganizationManager";

jest.mock("../firebase", () => ({ db: {}, storage: {} }));
jest.mock("./ChurchHeader", () => () => null);
jest.mock("firebase/storage", () => ({ ref: jest.fn(), uploadBytes: jest.fn(), getDownloadURL: jest.fn() }));
jest.mock("firebase/firestore", () => ({
  collection: (_database, ...segments) => segments.join("/"),
  doc: (_database, ...segments) => segments.join("/"),
  query: (reference) => reference,
  where: jest.fn(), getDocs: jest.fn(), getDoc: jest.fn(),
  updateDoc: jest.fn(), addDoc: jest.fn(), deleteDoc: jest.fn(), onSnapshot: jest.fn(),
}));

test("global directory finds inactive VDC Academy by default without reactivating it", async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  getDocs.mockImplementation(async (path) => ({
    docs: path === "churches" ? [
      { id: "2032", data: () => ({ nombre: "VDC Academy", isActive: false }) },
      { id: "2155", data: () => ({ nombre: "E2 Tech Support", isActive: true }) },
    ] : [],
  }));
  onSnapshot.mockImplementation((_reference, callback) => {
    callback({ docs: [] });
    return jest.fn();
  });
  try {
    await act(async () => root.render(<GlobalOrganizationManager />));
    const search = container.querySelector('input[placeholder="Search organizations..."]');
    await act(async () => Simulate.change(search, { target: { value: "VDC Academy" } }));
    expect(container.querySelector("tbody").textContent).toContain("VDC Academy");
    expect(container.querySelector("tbody").textContent).toContain("2032");
    const visibility = Array.from(container.querySelectorAll("label")).find((label) => label.textContent.includes("Show Inactive Organizations")).querySelector("input");
    expect(visibility.checked).toBe(true);
    await act(async () => Simulate.change(visibility, { target: { checked: false } }));
    expect(container.querySelector("tbody").textContent).not.toContain("VDC Academy");
    expect(updateDoc).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});