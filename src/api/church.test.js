import { getDocs } from "firebase/firestore";
import { fetchGroupList } from "./church";

jest.mock("../firebase", () => ({ db: {}, storage: {} }));
jest.mock("firebase/firestore", () => ({
  collection: jest.fn(() => "groups"),
  doc: jest.fn((...parts) => parts.join("/")),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  getFirestore: jest.fn(),
  query: jest.fn((_collection, filter) => filter),
  where: jest.fn((field, operator, value) => ({ field, operator, value })),
}));
jest.mock("firebase/storage", () => ({ getDownloadURL: jest.fn(), ref: jest.fn() }));

afterEach(() => {
  jest.clearAllMocks();
});

test("fetchGroupList returns an empty list when group lookup fails", async () => {
  const error = new Error("permission denied");
  getDocs.mockRejectedValueOnce(error);
  const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

  await expect(fetchGroupList("2032")).resolves.toEqual([]);

  expect(consoleError).toHaveBeenCalledWith("Error fetching groups:", error);
  consoleError.mockRestore();
});