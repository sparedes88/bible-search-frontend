import { getDoc, getDocs } from "firebase/firestore";
import { getAccessibleOrganizations, hasOrganizationAccess } from "./organizationMemberships";

jest.mock("../firebase", () => ({ db: {} }));
jest.mock("firebase/firestore", () => ({
  collection: (_database, ...segments) => segments.join("/"),
  doc: (_database, ...segments) => segments.join("/"),
  getDoc: jest.fn(), getDocs: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  getDocs.mockResolvedValue({ docs: [
    { id: "2155", data: () => ({ nombre: "E2 Tech Support" }) },
    { id: "2032", data: () => ({ nombre: "VDC Academy" }) },
    { id: "other", data: () => ({ nombre: "Unassigned" }) },
  ] });
  getDoc.mockImplementation(async (path) => ({ exists: () => path === "churches/2032/members/staff-user" }));
});

test("switcher includes primary and additional memberships but not unrelated organizations", async () => {
  const organizations = await getAccessibleOrganizations({ uid: "staff-user", churchId: 2155 });
  expect(organizations.map((organization) => organization.id)).toEqual(["2155", "2032"]);
  expect(getDoc).not.toHaveBeenCalledWith("churches/2155/members/staff-user");
});

test("primary-only members have one switcher option", async () => {
  getDoc.mockResolvedValue({ exists: () => false });
  const organizations = await getAccessibleOrganizations({ uid: "staff-user", churchID: "2155" });
  expect(organizations.map((organization) => organization.id)).toEqual(["2155"]);
});

test("additional membership permits opening that organization without changing primary", async () => {
  const user = { uid: "staff-user", churchId: "2155" };
  expect(await hasOrganizationAccess(user, "2032")).toBe(true);
  expect(await hasOrganizationAccess(user, "other")).toBe(false);
  expect(user.churchId).toBe("2155");
});

test("global administrators retain access to all organizations", async () => {
  const organizations = await getAccessibleOrganizations({ uid: "admin" }, true);
  expect(organizations).toHaveLength(3);
  expect(getDoc).not.toHaveBeenCalled();
});

test("signed out users cannot discover organizations", async () => {
  expect(await getAccessibleOrganizations(null)).toEqual([]);
  expect(await hasOrganizationAccess(null, "2155", true)).toBe(false);
  expect(getDocs).not.toHaveBeenCalled();
});

test("permission failures do not grant access", async () => {
  getDoc.mockRejectedValue(new Error("permission denied"));
  await expect(getAccessibleOrganizations({ uid: "staff-user", churchId: "2155" })).rejects.toThrow("permission denied");
});