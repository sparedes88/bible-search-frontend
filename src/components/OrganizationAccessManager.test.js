import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { deleteDoc, getDoc, getDocs, runTransaction } from "firebase/firestore";
import { toast } from "react-toastify";
import OrganizationAccessManager from "./OrganizationAccessManager";

jest.mock("../firebase", () => ({ db: {} }));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("react-select", () => ({ inputId, options, value, onChange, isDisabled }) => (
  <select id={inputId} value={value?.value || ""} onChange={(event) => onChange(options.find((option) => option.value === event.target.value))} disabled={isDisabled}>
    <option value="">Choose team member</option>
    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>
));
jest.mock("firebase/firestore", () => ({
  collection: (_database, ...segments) => segments.join("/"),
  doc: (_database, ...segments) => segments.join("/"),
  getDoc: jest.fn(), getDocs: jest.fn(), deleteDoc: jest.fn(), runTransaction: jest.fn(),
  serverTimestamp: () => "server-time",
}));

let container;
let root;
let transaction;
const teamMember = { uid: "staff-user", name: "Staff", email: "splascencia@e2techsupport.com", churchId: "2155" };

const choose = async (selector, value) => {
  await act(async () => Simulate.change(container.querySelector(selector), { target: { value } }));
};
const click = async (label) => {
  const button = Array.from(container.querySelectorAll("button")).find((entry) => entry.textContent === label);
  expect(button).toBeDefined();
  await act(async () => Simulate.click(button));
};
const render = async (props = {}) => {
  await act(async () => root.render(<OrganizationAccessManager users={[teamMember]} organizationId="2155" currentUser={{ uid: "admin-user" }} {...props} />));
  await choose("#organization-access-user", "staff-user");
};

beforeEach(() => {
  jest.clearAllMocks();
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  getDocs.mockResolvedValue({ docs: [
    { id: "2155", data: () => ({ nombre: "E2 Tech Support" }) },
    { id: "2032", data: () => ({ nombre: "VDC Academy" }) },
  ] });
  getDoc.mockResolvedValue({ exists: () => false });
  transaction = { get: jest.fn().mockResolvedValue({ exists: () => false }), set: jest.fn() };
  runTransaction.mockImplementation(async (_database, callback) => callback(transaction));
  deleteDoc.mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  jest.restoreAllMocks();
});

test("adding additional access writes only a destination membership", async () => {
  await render();
  await choose("#organization-access-destination", "2032");
  await click("Add to Organization");
  expect(transaction.set).toHaveBeenCalledWith("churches/2032/members/staff-user", {
    userId: "staff-user", email: teamMember.email, name: "Staff", lastName: "",
    sourceOrganizationId: "2155", addedBy: "admin-user", addedAt: "server-time",
  });
  expect(teamMember.churchId).toBe("2155");
  expect(container.textContent).toContain("already has access");
  expect(container.querySelector('[aria-label="Organization memberships"]').textContent).toContain("VDC Academy");
});

test("primary organization membership cannot be changed through this tab", async () => {
  await render();
  await choose("#organization-access-destination", "2155");
  expect(container.textContent).toContain("primary organization");
  expect(container.querySelector("button")).toBeNull();
  expect(getDoc).not.toHaveBeenCalledWith("churches/2155/members/staff-user");
});

test("existing additional membership can be removed without touching the user profile", async () => {
  getDoc.mockResolvedValue({ exists: () => true, data: () => ({ userId: "staff-user" }) });
  jest.spyOn(window, "confirm").mockReturnValue(true);
  await render();
  await choose("#organization-access-destination", "2032");
  await click("Remove Additional Access");
  expect(deleteDoc).toHaveBeenCalledWith("churches/2032/members/staff-user");
  expect(container.textContent).toContain("No additional membership");
  expect(container.querySelector('[aria-label="Organization memberships"]').textContent).not.toContain("VDC Academy");
});

test("permission denied while checking membership prevents writes", async () => {
  getDoc.mockRejectedValue(new Error("permission denied"));
  await render();
  await choose("#organization-access-destination", "2032");
  expect(container.querySelector('[role="alert"]').textContent).toContain("administrator of the destination");
  expect(container.querySelector("button")).toBeNull();
  expect(runTransaction).not.toHaveBeenCalled();
});

test("failed addition does not report or display success", async () => {
  runTransaction.mockRejectedValue(new Error("permission denied"));
  await render();
  await choose("#organization-access-destination", "2032");
  await click("Add to Organization");
  expect(toast.error).toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(container.textContent).toContain("No additional membership");
});

test("membership added concurrently is not overwritten", async () => {
  transaction.get.mockResolvedValue({ exists: () => true, data: () => ({ userId: "staff-user", preserved: true }) });
  await render();
  await choose("#organization-access-destination", "2032");
  await click("Add to Organization");
  expect(transaction.set).not.toHaveBeenCalled();
  expect(container.textContent).toContain("already has access");
});

test("selecting a user immediately displays primary and additional organizations with their account role", async () => {
  getDoc.mockResolvedValue({ exists: () => true, data: () => ({ userId: "staff-user" }) });
  await render({ users: [{ ...teamMember, role: "admin" }] });
  const table = container.querySelector('[aria-label="Organization memberships"]');
  const rows = table.querySelectorAll("tbody tr");
  expect(rows).toHaveLength(2);
  expect(rows[0].textContent).toContain("E2 Tech Support (2155)");
  expect(rows[0].textContent).toContain("Primary");
  expect(rows[1].textContent).toContain("VDC Academy (2032)");
  expect(rows[1].textContent).toContain("Additional");
  expect(Array.from(rows).every((row) => row.textContent.includes("Admin"))).toBe(true);
  expect(container.querySelector("#organization-access-destination").value).toBe("");
});

test("custom role labels are resolved from the admin role catalog", async () => {
  await render({
    users: [{ ...teamMember, customRoleId: "support-role", role: "support-role" }],
    roleOptions: [{ value: "support-role", label: "Support Coordinator", baseRole: "member" }],
  });
  expect(container.querySelector('[aria-label="Organization memberships"]').textContent).toContain("Support Coordinator");
});

test("global account access includes organizations without individual membership records", async () => {
  await render({ users: [{ ...teamMember, role: "global_admin" }] });
  const table = container.querySelector('[aria-label="Organization memberships"]');
  expect(table.textContent).toContain("VDC Academy");
  expect(table.textContent).toContain("Global access");
  expect(table.textContent).toContain("Global Admin");
});

test("unreadable memberships are reported as unverified rather than absent", async () => {
  getDoc.mockRejectedValue(new Error("permission denied"));
  await render();
  expect(container.textContent).toContain("Some memberships could not be verified");
  expect(container.querySelector('[aria-label="Organization memberships"]').textContent).toContain("E2 Tech Support");
});