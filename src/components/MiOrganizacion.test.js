import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { getAccessibleOrganizations, hasOrganizationAccess } from "../utils/organizationMemberships";
import MiOrganizacion from "./MiOrganizacion";

jest.mock("../firebase", () => ({ db: {} }));
jest.mock("./ChurchHeader", () => () => null);
jest.mock("react-loading-skeleton", () => () => null);
jest.mock("react-toastify", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock("../contexts/AuthContext", () => ({ useAuth: jest.fn() }));
jest.mock("../utils/organizationMemberships", () => ({ getAccessibleOrganizations: jest.fn(), hasOrganizationAccess: jest.fn() }));
jest.mock("react-router-dom", () => ({
  useParams: jest.fn(), useNavigate: jest.fn(),
  Link: ({ children, to }) => <a href={to}>{children}</a>,
}));
jest.mock("firebase/firestore", () => ({
  doc: (_database, ...segments) => segments.join("/"),
  getDoc: async (path) => ({
    exists: () => path.split("/").length === 2,
    data: () => mockOrganizationData || ({ nombre: "Organization", address: "", phone: "" }),
  }),
  updateDoc: jest.fn(),
}));

let mockOrganizationData;
let container;
let root;
let navigate;

beforeEach(() => {
  jest.clearAllMocks();
  mockOrganizationData = { nombre: "Organization", address: "", phone: "" };
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  navigate = jest.fn();
  useNavigate.mockReturnValue(navigate);
  useParams.mockReturnValue({ id: "2155" });
  useAuth.mockReturnValue({ user: { uid: "staff-user", churchId: "2155", role: "member" }, logout: jest.fn() });
  getAccessibleOrganizations.mockResolvedValue([
    { id: "2155", nombre: "E2 Tech Support" },
    { id: "2032", nombre: "VDC Academy" },
  ]);
  hasOrganizationAccess.mockResolvedValue(true);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test("multi-organization members see a switcher and can navigate to their additional organization", async () => {
  await act(async () => root.render(<MiOrganizacion />));
  const switcher = container.querySelector('[aria-label="Switch organization"]');
  expect(switcher).not.toBeNull();
  await act(async () => Simulate.click(switcher));
  const destination = Array.from(container.querySelectorAll("button")).find((button) => button.textContent.includes("VDC Academy"));
  expect(destination).toBeDefined();
  await act(async () => Simulate.click(destination));
  expect(navigate).toHaveBeenCalledWith("/organization/2032/mi-organizacion");
});

test("single-organization members do not see the switcher", async () => {
  getAccessibleOrganizations.mockResolvedValue([{ id: "2155", nombre: "E2 Tech Support" }]);
  await act(async () => root.render(<MiOrganizacion />));
  expect(container.querySelector('[aria-label="Switch organization"]')).toBeNull();
});

test("an assigned secondary organization is not blocked by the primary organization check", async () => {
  useParams.mockReturnValue({ id: "2032" });
  await act(async () => root.render(<MiOrganizacion />));
  expect(hasOrganizationAccess).toHaveBeenCalledWith(expect.objectContaining({ churchId: "2155" }), "2032", false);
  expect(container.textContent).toContain("My Organization");
  expect(container.textContent).not.toContain("Access Denied");
});

test("Member based on Admin uses its mapped custom module visibility instead of Member defaults", async () => {
  mockOrganizationData = {
    nombre: "Organization",
    miOrganizacionModuleVisibility: {
      member: { "my-sunday": true },
      "member-admin": { "my-sunday": false },
    },
    miOrganizacionRoleNameMap: { "member-admin": "Member" },
    miOrganizacionRoleBaseRoleMap: { "member-admin": "admin" },
  };
  useAuth.mockReturnValue({
    user: { uid: "staff-user", churchId: "2155", role: "member", customRoleName: "Member", baseRole: "admin" },
    logout: jest.fn(),
  });

  await act(async () => root.render(<MiOrganizacion />));

  expect(container.textContent).toContain("Based on: Admin");
  expect(container.querySelector('a[href="/organization/2155/my-sunday"]')).toBeNull();
});