import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { addDoc, arrayRemove, deleteDoc, onSnapshot, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { toast } from "react-toastify";
import { getChurchData } from "../api/church";
import LeadsPage from "./LeadsPage";
import LeadsStatusManager from "./LeadsStatusManager";
import LeadClassInstances from "./LeadClassInstances";
import PublicLeadPhoneCheckIn from "./PublicLeadPhoneCheckIn";
import { findDuplicateLead, getUpcomingLeadCalls, isValidClassInstance, LEAD_MODULE_TABS } from "../utils/leadOptions";

jest.mock("../firebase", () => ({ db: {}, storage: {} }));
jest.mock("firebase/storage", () => ({
  deleteObject: jest.fn(),
  getDownloadURL: jest.fn(),
  ref: jest.fn((_storage, path) => path),
  uploadBytes: jest.fn(),
}));
jest.mock("../api/church", () => ({ getChurchData: jest.fn() }));
jest.mock("./ChurchHeader", () => () => null);
jest.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ user: { uid: "tester" } }) }));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("react-select/creatable", () => ({ inputId, options, value, onChange, isDisabled, inputValue, onInputChange, onCreateOption }) => (
  <div>
    <select id={inputId} value={value?.value || ""} disabled={isDisabled} onChange={(event) => onChange(options.find((option) => option.value === event.target.value))}>
      <option value="">Choose lead</option>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    <input aria-label="Lead picker search" value={inputValue} onChange={(event) => onInputChange(event.target.value)} />
    <button type="button" onClick={() => onCreateOption(inputValue)}>Create picker option</button>
  </div>
));
jest.mock("firebase/firestore", () => ({
  arrayUnion: (...values) => ({ __arrayUnion: values }),
  arrayRemove: (...values) => ({ __arrayRemove: values }),
  addDoc: jest.fn(), updateDoc: jest.fn(), setDoc: jest.fn(), deleteDoc: jest.fn(),
  writeBatch: jest.fn(),
  collection: (_database, ...segments) => segments.join("/"),
  doc: (_database, ...segments) => segments.length ? segments.join("/") : { id: "new-instance" },
  query: (reference, constraint) => constraint?.field ? `${reference}?${constraint.value}` : reference,
  where: jest.fn((field, operator, value) => ({ field, operator, value })),
  orderBy: jest.fn(), serverTimestamp: () => "server-time", onSnapshot: jest.fn(),
}));

let container;
let root;
let savedLists;
let listeners;
let rosterLeads;
let availableLeadRecords;
let classAttendanceRecords;
let classPaymentRecords;
const lead = {
  name: "Sample Lead", phone: "5551234567", email: "lead@example.com",
  city: "Retired City", state: "Illinois", classType: "Evening", programType: "Certificate",
  callbackTime: "14:30",
};
const settingsPath = "churches/test-org/leadsSettings";
const classInstance = { id: "fall", name: "Fall Cohort", classType: "Evening", startDate: "2026-11-02", totalWeeks: 8 };
const classInstanceStartingEightDaysAgo = () => {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 8);
  return { ...classInstance, startDate: `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}-${String(startDate.getDate()).padStart(2, "0")}` };
};

const RouterProbe = () => {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output data-testid="current-path">{location.pathname}</output><output data-testid="current-search">{location.search}</output><button type="button" onClick={() => navigate(-1)}>Browser Back</button><button type="button" onClick={() => navigate(1)}>Browser Forward</button></>;
};

const render = async (component, initialPath = "/organization/test-org/leads/statuses") => {
  await act(async () => root.render(
    <MemoryRouter initialEntries={[initialPath]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <RouterProbe />
      <Routes><Route path="/:routeType/:id/leads/:tab" element={component} /></Routes>
    </MemoryRouter>
  ));
};
const renderPublicCheckIn = async (path = "/public-lead-check-in/test-org/share-token") => {
  await act(async () => root.render(
    <MemoryRouter initialEntries={[path]}>
      <RouterProbe />
      <Routes>
        <Route path="/public-lead-check-in/:churchId/:token" element={<PublicLeadPhoneCheckIn />} />
        <Route path="/check-in/:churchId/:slug/:token" element={<PublicLeadPhoneCheckIn />} />
      </Routes>
    </MemoryRouter>
  ));
};
const change = async (element, value) => {
  await act(async () => Simulate.change(element, { target: { value } }));
};
const click = async (text) => {
  const button = Array.from(container.querySelectorAll('button, [role="tab"]')).find((element) => element.textContent === text);
  expect(button).toBeDefined();
  await act(async () => {
    if (button.type === "submit") Simulate.submit(button.closest("form"));
    else Simulate.click(button, { button: 0 });
  });
};
const openAddLeadFormFromSearch = async (name) => {
  await change(container.querySelector('[aria-label="Search leads"]'), name);
  await click(`Add "${name}" as a lead`);
};

beforeEach(() => {
  jest.clearAllMocks();
  deleteObject.mockResolvedValue(undefined);
  ref.mockImplementation((_storage, path) => path);
  writeBatch.mockImplementation(() => ({ update: jest.fn(), commit: jest.fn().mockResolvedValue(undefined) }));
  where.mockImplementation((field, operator, value) => ({ field, operator, value }));
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  savedLists = { locations: ["Chicago, Illinois"], classTypes: ["Evening"], programTypes: ["Certificate"] };
  listeners = {};
  rosterLeads = [];
  availableLeadRecords = [{ ...lead, id: "lead-1" }];
  classAttendanceRecords = [];
  classPaymentRecords = [];
  onSnapshot.mockImplementation((path, callback) => {
    listeners[path] = callback;
    if (path === settingsPath) {
      const optionDocs = Object.entries(savedLists).map(([id, statusList]) => ({ id, data: () => ({ statusList }) }));
      const attendanceDocs = classAttendanceRecords.map((record) => ({ id: record.id, data: () => record }));
      const paymentDocs = classPaymentRecords.map((record) => ({ id: record.id, data: () => record }));
      callback({ docs: [...optionDocs, ...attendanceDocs, ...paymentDocs] });
    } else if (path.includes("/leadsSettings/")) {
      const list = savedLists[path.split("/").pop()];
      callback({ data: () => list ? { statusList: list } : undefined });
    } else if (path.includes("?")) {
      const instanceId = path.split("?")[1];
      callback({ docs: rosterLeads.filter((entry) => entry.classInstanceId === instanceId).map((entry) => ({ id: entry.id, data: () => entry })) });
    } else if (path.includes("/comments")) {
      callback({ docs: [{ id: "comment-1", data: () => ({ text: "Called and left a message", createdByName: "Tester", createdAt: new Date("2026-10-29T10:00:00Z") }) }] });
    } else if (path === "churches/test-org/leads") {
      callback({ docs: availableLeadRecords.map((entry) => ({ id: entry.id, data: () => entry })) });
    } else {
      callback({ docs: [{ id: "lead-1", data: () => lead }] });
    }
    return jest.fn();
  });
  setDoc.mockImplementation(async (path, data) => {
    const settingId = path.split("/").pop();
    if (settingId.startsWith("classAttendance_")) {
      const previous = classAttendanceRecords.find((record) => record.id === settingId) || {};
      classAttendanceRecords = [
        ...classAttendanceRecords.filter((record) => record.id !== settingId),
        { ...previous, id: settingId, ...data, attendance: { ...previous.attendance, ...data.attendance } },
      ];
      const optionDocs = Object.entries(savedLists).filter(([listId]) => !listId.startsWith("classAttendance_")).map(([id, statusList]) => ({ id, data: () => ({ statusList }) }));
      const attendanceDocs = classAttendanceRecords.map((record) => ({ id: record.id, data: () => record }));
      const paymentDocs = classPaymentRecords.map((record) => ({ id: record.id, data: () => record }));
      listeners[settingsPath]?.({ docs: [...optionDocs, ...attendanceDocs, ...paymentDocs] });
      return;
    }
    if (settingId.startsWith("classPayments_")) {
      const previous = classPaymentRecords.find((record) => record.id === settingId) || {};
      classPaymentRecords = [...classPaymentRecords.filter((record) => record.id !== settingId), { ...previous, id: settingId, ...data, payments: { ...previous.payments, ...data.payments } }];
      const optionDocs = Object.entries(savedLists).filter(([listId]) => !listId.startsWith("classAttendance_")).map(([id, statusList]) => ({ id, data: () => ({ statusList }) }));
      const attendanceDocs = classAttendanceRecords.map((record) => ({ id: record.id, data: () => record }));
      const paymentDocs = classPaymentRecords.map((record) => ({ id: record.id, data: () => record }));
      listeners[settingsPath]?.({ docs: [...optionDocs, ...attendanceDocs, ...paymentDocs] });
      return;
    }
    savedLists[settingId] = data.statusList;
    listeners[path]?.({ data: () => data });
  });
  addDoc.mockResolvedValue({ id: "new-lead" });
  updateDoc.mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test("new leads save, close the form, and open their profile", async () => {
  savedLists.statuses = ["Dead Lead", "New", "Qualified"];
  await render(<LeadsPage />);
  expect(container.querySelector("#add-lead-name")).toBeNull();
  expect(container.querySelector(".leads-add-form-heading")).toBeNull();
  await change(container.querySelector('[aria-label="Search leads"]'), "New Lead");
  await click('Add "New Lead" as a lead');
  expect(container.querySelector("#add-lead-status").value).toBe("New");
  await change(container.querySelector('input[placeholder="Lead name"]'), "New Lead");
  await change(container.querySelector("#add-lead-status"), "Qualified");
  for (const [field, value] of Object.entries({ cityState: "Chicago, Illinois", classType: "Evening", programType: "Certificate", callbackTime: "09:15" })) {
    await change(container.querySelector(`#add-lead-${field}`), value);
  }
  await act(async () => Simulate.submit(container.querySelector("form")));
  expect(addDoc).toHaveBeenCalledWith("churches/test-org/leads", expect.objectContaining({
    name: "New Lead", cityState: "Chicago, Illinois", classType: "Evening", programType: "Certificate", callbackTime: "09:15", status: "Qualified",
  }));
  expect(container.querySelector(".leads-add-form")).toBeNull();
  expect(container.querySelector('[data-testid="current-search"]').textContent).toBe("?leadId=new-lead");
  expect(container.querySelector(".lead-profile-panel h4").textContent).toBe("New Lead");
});

test("creating a lead scrolls its newly opened profile to the top", async () => {
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
  const scrollIntoView = jest.fn();
  HTMLElement.prototype.scrollIntoView = scrollIntoView;

  try {
    await render(<LeadsPage />);
    await openAddLeadFormFromSearch("New Scroll Lead");
    await change(container.querySelector("#add-lead-name"), "New Scroll Lead");
    await act(async () => Simulate.submit(container.querySelector(".leads-add-form")));

    expect(container.querySelector(".lead-profile-panel h4").textContent).toBe("New Scroll Lead");
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  } finally {
    if (originalScrollIntoView) HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    else delete HTMLElement.prototype.scrollIntoView;
  }
});

test("searching for a missing lead offers a prefilled add form", async () => {
  await render(<LeadsPage />);
  expect(container.querySelector("#add-lead-cityState")).toBeNull();
  await change(container.querySelector('[aria-label="Search leads"]'), "New Prospect");
  expect(container.textContent).toContain("No leads found.");
  await click('Add "New Prospect" as a lead');

  expect(container.querySelector("#add-lead-cityState")).not.toBeNull();
  expect(container.querySelector('input[placeholder="Lead name"]').value).toBe("New Prospect");
  await act(async () => Simulate.submit(container.querySelector(".leads-main form")));
  expect(addDoc).toHaveBeenCalledWith("churches/test-org/leads", expect.objectContaining({ name: "New Prospect" }));
  expect(container.querySelector(".leads-add-form")).toBeNull();
});

test("new lead form blocks a matching phone and shows the existing profile", async () => {
  availableLeadRecords = [{ ...lead, id: "existing-lead", name: "Existing Student", phone: "(555)123-4567", email: "existing@example.com" }];
  await render(<LeadsPage />);
  await openAddLeadFormFromSearch("Potential Duplicate");
  await change(container.querySelector("#add-lead-phone"), "5551234567");

  const duplicateAlert = container.querySelector("#add-lead-phone-duplicate");
  expect(duplicateAlert.textContent).toContain("This lead was already created.");
  expect(duplicateAlert.textContent).toContain("Existing Student");
  expect(duplicateAlert.textContent).toContain("existing@example.com");
  expect(container.querySelector("#add-lead-phone").disabled).toBe(false);
  expect(container.querySelector("#add-lead-name").disabled).toBe(true);
  expect(container.querySelector("#add-lead-email").matches(":disabled")).toBe(true);
  expect(container.querySelector('button[type="submit"]').disabled).toBe(true);

  await act(async () => Simulate.submit(container.querySelector(".leads-add-form")));
  expect(addDoc).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith("A profile with this phone number already exists");

  await click("View existing profile");
  expect(container.querySelector(".leads-add-form")).toBeNull();
  expect(container.querySelector(".lead-profile-details").textContent).toContain("existing@example.com");
});

test("failed lead creation keeps the add form open for retry", async () => {
  await render(<LeadsPage />);
  await openAddLeadFormFromSearch("Retry Lead");
  await change(container.querySelector("#add-lead-name"), "Retry Lead");
  addDoc.mockRejectedValueOnce(new Error("network error"));
  const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

  await act(async () => Simulate.submit(container.querySelector(".leads-add-form")));

  expect(container.querySelector("#add-lead-name").value).toBe("Retry Lead");
  expect(container.querySelector(".leads-add-form")).not.toBeNull();
  expect(toast.error).toHaveBeenCalledWith("Failed to add lead");
  consoleError.mockRestore();
});

test("new city and state values can be created from the add form and saved to shared options", async () => {
  await render(<LeadsPage />);
  await openAddLeadFormFromSearch("New Evanston Lead");
  await change(container.querySelector("#add-lead-cityState"), "Evanston, Illinois");
  await click("Add to options");

  expect(container.querySelector("#add-lead-cityState").value).toBe("Evanston, Illinois");
  expect(setDoc).toHaveBeenCalledWith("churches/test-org/leadsSettings/locations", { statusList: ["Chicago, Illinois", "Evanston, Illinois"] }, { merge: true });
  await change(container.querySelector("#add-lead-name"), "New Evanston Lead");
  await act(async () => Simulate.submit(container.querySelector(".leads-add-form")));
  expect(addDoc).toHaveBeenCalledWith("churches/test-org/leads", expect.objectContaining({ name: "New Evanston Lead", cityState: "Evanston, Illinois" }));
  expect(container.querySelector(".leads-add-form")).toBeNull();
});

test("new city and state values can be created while editing a lead profile", async () => {
  await render(<LeadsPage />);
  await click("View Profile");
  await click("Edit");
  await change(container.querySelector("#edit-lead-lead-1-cityState"), "Aurora, Illinois");
  await click("Add to options");

  expect(container.querySelector("#edit-lead-lead-1-cityState").value).toBe("Aurora, Illinois");
  expect(setDoc).toHaveBeenCalledWith("churches/test-org/leadsSettings/locations", { statusList: ["Chicago, Illinois", "Aurora, Illinois"] }, { merge: true });
  await click("Save");
  expect(updateDoc).toHaveBeenCalledWith("churches/test-org/leads/lead-1", expect.objectContaining({ cityState: "Aurora, Illinois" }));
});

test("editing retains deleted list values and saves all new fields", async () => {
  await render(<LeadsPage />);
  await click("View Profile");
  await click("Edit");
  expect(container.querySelector(".leads-profile-column #edit-lead-lead-1-cityState")).not.toBeNull();
  expect(container.querySelector(".leads-main #edit-lead-lead-1-cityState")).toBeNull();
  expect(container.querySelector("#edit-lead-lead-1-cityState").value).toBe("Retired City, Illinois");
  expect(container.querySelector("#edit-lead-lead-1-callbackTime").value).toBe("14:30");
  await change(container.querySelector("#edit-lead-lead-1-status"), "Qualified");
  await change(container.querySelector("#edit-lead-lead-1-cityState"), "Chicago, Illinois");
  await change(container.querySelector("#edit-lead-lead-1-callbackTime"), "16:45");
  await click("Save");
  expect(updateDoc).toHaveBeenCalledWith("churches/test-org/leads/lead-1", expect.objectContaining({
    cityState: "Chicago, Illinois", classType: "Evening", programType: "Certificate", callbackTime: "16:45", status: "Qualified",
  }));
});

test("lead list shows ten leads per page and resets paging when search changes", async () => {
  availableLeadRecords = Array.from({ length: 23 }, (_unused, index) => ({
    ...lead,
    id: `lead-${index + 1}`,
    name: `Lead ${index + 1}`,
    status: "New",
  }));
  await render(<LeadsPage />);

  expect(container.querySelectorAll(".leads-main .list-group-item")).toHaveLength(10);
  expect(container.querySelector(".leads-pagination").textContent).toContain("Showing 1-10 of 23 leads");
  await click("Next");
  expect(container.querySelector(".leads-pagination").textContent).toContain("Showing 11-20 of 23 leads");
  expect(container.querySelectorAll(".leads-main .list-group-item")).toHaveLength(10);
  await click("Next");
  expect(container.querySelector(".leads-pagination").textContent).toContain("Showing 21-23 of 23 leads");
  expect(container.querySelectorAll(".leads-main .list-group-item")).toHaveLength(3);

  await change(container.querySelector('[aria-label="Search leads"]'), "Lead 2");
  expect(container.querySelectorAll(".leads-main .list-group-item")).toHaveLength(5);
  expect(container.querySelector(".leads-pagination")).toBeNull();
  expect(container.querySelector(".leads-main .list-group-item").textContent).toContain("Lead 2");
});

test("lead cards show who created the profile", async () => {
  availableLeadRecords = [
    { ...lead, id: "named-creator", name: "Named Creator Lead", createdByName: "Ana Admin", createdBy: "admin-1" },
    { ...lead, id: "legacy-creator", name: "Legacy Creator Lead", createdBy: "admin-2" },
  ];
  await render(<LeadsPage />);

  const namedLead = Array.from(container.querySelectorAll(".leads-main .list-group-item")).find((item) => item.textContent.includes("Named Creator Lead"));
  const legacyLead = Array.from(container.querySelectorAll(".leads-main .list-group-item")).find((item) => item.textContent.includes("Legacy Creator Lead"));
  expect(namedLead.querySelector(".lead-list-created-by").textContent).toBe("Created by: Ana Admin");
  expect(legacyLead.querySelector(".lead-list-created-by").textContent).toBe("Created by: admin-2");
});

test("lead cards tag phone numbers shared with another profile, even when it is hidden by search", async () => {
  availableLeadRecords = [
    { ...lead, id: "shared-phone", name: "Jordan Lee", phone: "555-123-4567" },
    { ...lead, id: "other-profile", name: "Another Profile", phone: "(555) 123 4567" },
    { ...lead, id: "unique-phone", name: "Unique Profile", phone: "555-987-6543" },
  ];
  await render(<LeadsPage />);

  const uniqueLead = Array.from(container.querySelectorAll(".leads-main .list-group-item")).find((item) => item.textContent.includes("Unique Profile"));
  expect(uniqueLead.querySelector(".badge.text-bg-warning")).toBeNull();

  await change(container.querySelector('[aria-label="Search leads"]'), "Jordan Lee");
  const matchingLead = container.querySelector(".leads-main .list-group-item");
  expect(matchingLead.textContent).toContain("Shared phone");
  expect(matchingLead.querySelector(".badge.text-bg-warning").title).toBe("This phone number is also used by another profile");
});

test("phone searches format the query and match numbers regardless of punctuation", async () => {
  availableLeadRecords = [
    { ...lead, id: "formatted-phone", name: "Phone Search Lead", phone: "(555) 123-4567" },
    { ...lead, id: "other-phone", name: "Other Lead", phone: "555-987-6543" },
  ];
  await render(<LeadsPage />);

  const searchInput = container.querySelector('[aria-label="Search leads"]');
  await change(searchInput, "5551234567");

  expect(searchInput.value).toBe("(555)123-4567");
  expect(container.querySelectorAll(".leads-main .list-group-item")).toHaveLength(1);
  const phoneSearchLead = container.querySelector(".leads-main .list-group-item");
  expect(phoneSearchLead.textContent).toContain("Phone Search Lead");
  expect(phoneSearchLead.querySelector('a[href="tel:5551234567"]').textContent).toContain("(555) 123-4567");
});

test("shared phone filter shows only profiles with a matching phone number", async () => {
  availableLeadRecords = [
    { ...lead, id: "shared-one", name: "Shared Lead One", phone: "555-123-4567" },
    { id: "group-two-minimal", name: "Group Two Minimal", phone: "555-222-3333", status: "New" },
    { id: "shared-two", name: "Shared Lead Two", phone: "(555) 123 4567", status: "New" },
    { ...lead, id: "group-two-complete", name: "Group Two Complete", phone: "(555) 222-3333" },
    { ...lead, id: "unique", name: "Unique Lead", phone: "555-987-6543" },
  ];
  await render(<LeadsPage />);

  await act(async () => Simulate.change(container.querySelector("#leads-shared-phone-only"), { target: { checked: true } }));

  const leadCards = container.querySelectorAll(".leads-main .list-group-item");
  const leadCardText = Array.from(leadCards).map((card) => card.textContent).join(" ");
  expect(leadCards).toHaveLength(4);
  expect(leadCardText).toContain("Shared Lead One");
  expect(leadCardText).toContain("Shared Lead Two");
  expect(leadCardText).not.toContain("Unique Lead");
  expect(leadCards[0].textContent).toContain("Shared Lead One");
  expect(leadCards[0].querySelector(".lead-list-more-data").textContent).toBe("More data");
  expect(leadCards[1].textContent).toContain("Shared Lead Two");
  expect(leadCards[1].querySelector(".lead-list-more-data")).toBeNull();
  expect(leadCards[2].textContent).toContain("Group Two Complete");
  expect(leadCards[3].textContent).toContain("Group Two Minimal");
});

test("shared phone groups stay together across pagination boundaries", async () => {
  availableLeadRecords = Array.from({ length: 6 }, (_unused, index) => {
    const phone = `555000${String(index).padStart(4, "0")}`;
    return [
      { id: `group-${index}-a`, name: `Pair ${index} A`, phone, status: "New" },
      { id: `group-${index}-b`, name: `Pair ${index} B`, phone, status: "New" },
    ];
  }).flat();
  await render(<LeadsPage />);
  await act(async () => Simulate.change(container.querySelector("#leads-shared-phone-only"), { target: { checked: true } }));

  expect(container.querySelectorAll(".leads-main .list-group-item")).toHaveLength(10);
  expect(container.querySelector(".leads-pagination").textContent).toContain("Showing 1-10 of 12 leads");
  await click("Next");
  expect(container.querySelector(".leads-pagination").textContent).toContain("Showing 11-12 of 12 leads");
  const secondPageCards = container.querySelectorAll(".leads-main .list-group-item");
  expect(secondPageCards).toHaveLength(2);
  expect(secondPageCards[0].textContent).toContain("Pair 5 A");
  expect(secondPageCards[1].textContent).toContain("Pair 5 B");
});

test("status toggles show only enabled statuses and All on restores every status", async () => {
  savedLists.statuses = ["New", "Qualified", "Converted"];
  availableLeadRecords = [
    { id: "new-lead", name: "New Student", status: "New" },
    { id: "qualified-lead", name: "Qualified Student", status: "Qualified" },
    { id: "converted-lead", name: "Converted Student", status: "Converted" },
  ];
  await render(<LeadsPage />);

  const primaryTabs = container.querySelector(".leads-primary-tabs");
  const statusFilter = container.querySelector(".lead-status-filter-bar");
  const searchInput = container.querySelector('[aria-label="Search leads"]');
  expect(Boolean(primaryTabs.compareDocumentPosition(statusFilter) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  expect(Boolean(statusFilter.compareDocumentPosition(searchInput) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  expect(container.querySelectorAll(".leads-main .list-group-item")).toHaveLength(3);
  await act(async () => Simulate.change(container.querySelector('[aria-label="Show leads with status New"]'), { target: { checked: false } }));
  expect(container.querySelectorAll(".leads-main .list-group-item")).toHaveLength(2);
  expect(container.textContent).not.toContain("New Student");
  expect(container.textContent).toContain("Qualified Student");
  expect(container.textContent).toContain("Converted Student");

  await act(async () => Simulate.change(container.querySelector('[aria-label="Show leads with status Qualified"]'), { target: { checked: false } }));
  expect(container.querySelectorAll(".leads-main .list-group-item")).toHaveLength(1);
  expect(container.textContent).toContain("Converted Student");

  await click("All on");
  expect(container.querySelectorAll(".leads-main .list-group-item")).toHaveLength(3);
});

test("address-shaped lead fields render as readable text", async () => {
  availableLeadRecords = [{
    ...lead,
    cityState: { country: "US", street: "123 Main St", state: "Illinois", zip: "60601", city: "Chicago" },
    programType: { country: "US", street: "123 Main St", state: "Illinois", zip: "60601", city: "Chicago" },
    id: "lead-1",
  }];
  await render(<LeadsPage />);
  expect(container.textContent).toContain("123 Main St, Chicago, Illinois, 60601, US");
});

test("address objects in saved location options render as readable text", async () => {
  savedLists.locations = [{ city: "Chicago", street: "123 Main St", zip: "60601", country: "US", state: "Illinois" }];
  await render(<LeadsPage />);
  await openAddLeadFormFromSearch("Missing Lead");
  expect(Array.from(container.querySelector("#add-lead-cityState-options").options).map((option) => option.value)).toContain("123 Main St, Chicago, Illinois, 60601, US");
});

test("lead profile shows every detail field even when no value is set", async () => {
  availableLeadRecords = [{ id: "lead-1", name: "Sparse Lead", status: "New" }];
  await render(<LeadsPage />);
  await click("View Profile");

  const details = Array.from(container.querySelectorAll(".lead-profile-details > div")).map((row) => [
    row.querySelector("dt").textContent,
    row.querySelector("dd").textContent,
  ]);
  expect(details).toEqual([
    ["Phone", "Not provided"],
    ["Email", "Not provided"],
    ["City & State", "Not provided"],
    ["Class Type", "Not provided"],
    ["Program Type", "Not provided"],
    ["Callback time", "Not set"],
  ]);
  expect(container.querySelector("#edit-lead-lead-1-name")).toBeNull();
});

test("lead profile uploads and removes images and documents", async () => {
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
  uploadBytes.mockResolvedValue({});
  getDownloadURL.mockResolvedValue("https://storage.example/lead-photo.png");
  await render(<LeadsPage />);
  await click("View Profile");

  const file = new File(["image-data"], "class-photo.png", { type: "image/png" });
  const fileInput = container.querySelector("#lead-attachments-lead-1");
  Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
  await act(async () => Simulate.change(fileInput));

  expect(ref).toHaveBeenCalledWith({}, expect.stringMatching(/^churches\/test-org\/leads\/lead-1\/attachments\//));
  const fileRef = ref.mock.calls[0][1];
  expect(fileRef).toMatch(/^churches\/test-org\/leads\/lead-1\/attachments\//);
  expect(uploadBytes).toHaveBeenCalledWith(fileRef, file, { contentType: "image/png" });
  expect(updateDoc).toHaveBeenCalledWith("churches/test-org/leads/lead-1", expect.objectContaining({
    attachments: { __arrayUnion: [expect.objectContaining({ name: "class-photo.png", url: "https://storage.example/lead-photo.png", path: fileRef, type: "image/png" })] },
  }));
  const attachmentSection = container.querySelector(".lead-profile-attachments");
  expect(attachmentSection.querySelector('a[href="https://storage.example/lead-photo.png"]').textContent).toBe("class-photo.png");
  expect(attachmentSection.querySelector('img[alt="class-photo.png"]')).not.toBeNull();

  await act(async () => Simulate.click(attachmentSection.querySelector('[aria-label="Delete attachment class-photo.png"]')));
  expect(confirm).toHaveBeenCalledWith("Delete class-photo.png?");
  expect(updateDoc).toHaveBeenLastCalledWith("churches/test-org/leads/lead-1", expect.objectContaining({
    attachments: { __arrayRemove: [expect.objectContaining({ name: "class-photo.png", path: fileRef })] },
  }));
  expect(deleteObject).toHaveBeenCalledWith(fileRef);
  expect(attachmentSection.textContent).toContain("No documents or images attached.");
  confirm.mockRestore();
});

test("lead profile photo can be uploaded and replaced in the profile and list", async () => {
  uploadBytes.mockResolvedValue({});
  getDownloadURL.mockResolvedValueOnce("https://storage.example/profile-one.png").mockResolvedValueOnce("https://storage.example/profile-two.png");
  await render(<LeadsPage />);
  await click("View Profile");

  const imageInput = container.querySelector("#lead-profile-photo-lead-1");
  const firstFile = new File(["first-image"], "first.png", { type: "image/png" });
  Object.defineProperty(imageInput, "files", { configurable: true, value: [firstFile] });
  await act(async () => Simulate.change(imageInput));

  expect(container.querySelector('.lead-profile-photo-picker img').getAttribute("src")).toBe("https://storage.example/profile-one.png");
  expect(container.querySelector('.lead-list-avatar[src="https://storage.example/profile-one.png"]')).not.toBeNull();
  const firstProfileImagePath = updateDoc.mock.calls[0][1].profileImage.path;

  const secondFile = new File(["second-image"], "second.png", { type: "image/png" });
  Object.defineProperty(imageInput, "files", { configurable: true, value: [secondFile] });
  await act(async () => Simulate.change(imageInput));

  expect(container.querySelector('.lead-profile-photo-picker img').getAttribute("src")).toBe("https://storage.example/profile-two.png");
  expect(container.querySelector('.lead-list-avatar[src="https://storage.example/profile-two.png"]')).not.toBeNull();
  expect(deleteObject).toHaveBeenCalledWith(firstProfileImagePath);
  expect(updateDoc.mock.calls[1][1].profileImage.url).toBe("https://storage.example/profile-two.png");
});

test("accounts receivable report filters payments by date and lists classes and attendees", async () => {
  const pricedInstance = { ...classInstance, programAssignments: [{ programType: "Certificate", price: 300 }] };
  savedLists.classInstances = [pricedInstance];
  availableLeadRecords = [{
    ...lead,
    id: "lead-1",
    programType: "Certificate",
    classInstanceId: "fall",
    classInstance: pricedInstance,
    classPaymentHistory: [
      { id: "payment-in-range", classInstanceId: "fall", amount: 75, date: "2026-11-03", method: "Zelle" },
      { id: "cash-in-range", classInstanceId: "fall", amount: 20, date: "2026-11-02", method: "Cash" },
      { id: "coupon-in-range", classInstanceId: "fall", amount: 35, date: "2026-11-04", method: "Lighthouse Church Coupon" },
      { id: "payment-after-date", classInstanceId: "fall", amount: 40, date: "2026-11-08", method: "Cash" },
    ],
  }, {
    ...lead,
    id: "lead-2",
    name: "Second Student",
    programType: "Certificate",
    classInstanceId: "fall",
    classInstance: pricedInstance,
  }];
  classAttendanceRecords = [{
    id: "classAttendance_fall_1",
    classInstanceId: "fall",
    week: 1,
    attendance: { "lead-1": { present: true }, "lead-2": { present: false } },
  }];
  await render(<LeadsPage />);
  await click("Accounts Receivable");
  expect(container.querySelector('[aria-label="Accounts Receivable PIN"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Accounts receivable report"]')).toBeNull();
  await change(container.querySelector("#accounts-receivable-pin"), "1111");
  await act(async () => Simulate.submit(container.querySelector('[aria-label="Accounts Receivable PIN"] form')));
  expect(container.querySelector("#accounts-receivable-pin-error").textContent).toBe("Incorrect PIN. Try again.");
  await change(container.querySelector("#accounts-receivable-pin"), "2197");
  await act(async () => Simulate.submit(container.querySelector('[aria-label="Accounts Receivable PIN"] form')));
  await change(container.querySelector('[aria-label="Report start date"]'), "2026-11-01");
  await change(container.querySelector('[aria-label="Report end date"]'), "2026-11-05");
  expect(container.querySelector(".lead-ar-date-display").textContent).toBe("November 1, 2026 - November 5, 2026");

  expect(Array.from(container.querySelectorAll(".leads-primary-tabs [role=tab]")).map((tab) => tab.textContent)).toEqual([
    "Leads", "By Status", "Accounts Receivable", "Class Roster", "Attendance", "Phone Check-in",
  ]);
  const report = container.querySelector('[aria-label="Accounts receivable report"]');
  expect(report.querySelector(".lead-ar-report-tabs")).toBeNull();
  const methodTotals = report.querySelector('[aria-label="Payment totals by method"]');
  expect(methodTotals.textContent).toContain("Cash");
  expect(methodTotals.textContent).toContain("$20.00");
  expect(methodTotals.textContent).toContain("Zelle");
  expect(methodTotals.textContent).toContain("$75.00");
  expect(methodTotals.textContent).toContain("Church Coupons");
  expect(methodTotals.textContent).toContain("$35.00");
  expect(methodTotals.querySelector(".lead-ar-lockbox-total").textContent).toContain("$95.00");
  expect(methodTotals.textContent).not.toContain("$40.00");
  const paymentReport = report.querySelector('[aria-label="Payment report"]');
  expect(Array.from(paymentReport.querySelectorAll('input[type="date"]')).map((input) => input.value)).toContain("2026-11-03");
  expect(paymentReport.textContent).toContain("Zelle");
  expect(Array.from(paymentReport.querySelectorAll('input[type="date"]')).map((input) => input.value)).not.toContain("2026-11-08");
  const paymentMethodFilter = paymentReport.querySelector('[aria-label="Filter Accounts Receivable payments by method"]');
  await change(paymentMethodFilter, "Zelle");
  expect(paymentReport.querySelectorAll("tbody tr")).toHaveLength(2);
  expect(paymentReport.querySelector(".lead-ar-payment-subtotal").textContent).toContain("$75.00");
  const zelleMethodSelect = paymentReport.querySelector('[aria-label="Change payment method for Sample Lead November 3, 2026"]');
  expect(zelleMethodSelect).not.toBeNull();
  expect(zelleMethodSelect.value).toBe("Zelle");
  await change(zelleMethodSelect, "Card");
  const paymentEditBatch = writeBatch.mock.results[writeBatch.mock.results.length - 1].value;
  expect(paymentEditBatch.update).toHaveBeenCalledWith("churches/test-org/leads/lead-1", expect.objectContaining({
    classPaymentHistory: expect.arrayContaining([expect.objectContaining({ id: "payment-in-range", method: "Card" })]),
  }));
  expect(methodTotals.querySelector(".lead-ar-lockbox-total").textContent).toContain("$20.00");
  await change(paymentMethodFilter, "all");
  expect(paymentReport.querySelector("tbody").textContent).toContain("Card");
  const paymentDateInput = paymentReport.querySelector('[aria-label="Change payment date for Sample Lead November 3, 2026"]');
  expect(paymentDateInput.value).toBe("2026-11-03");
  await change(paymentDateInput, "2026-11-04");
  const dateEditBatch = writeBatch.mock.results[writeBatch.mock.results.length - 1].value;
  expect(dateEditBatch.update).toHaveBeenCalledWith("churches/test-org/leads/lead-1", expect.objectContaining({
    classPaymentHistory: expect.arrayContaining([expect.objectContaining({ id: "payment-in-range", date: "2026-11-04", method: "Card" })]),
  }));
  expect(paymentReport.querySelector('[aria-label="Change payment date for Sample Lead November 4, 2026"]').value).toBe("2026-11-04");
  const receiptInput = paymentReport.querySelector('[aria-label="Receipt number for Sample Lead 2026-11-04"]');
  await change(receiptInput, "RCPT-1004");
  await act(async () => Simulate.blur(receiptInput));
  const receiptEditBatch = writeBatch.mock.results[writeBatch.mock.results.length - 1].value;
  expect(receiptEditBatch.update).toHaveBeenCalledWith("churches/test-org/leads/lead-1", expect.objectContaining({
    classPaymentHistory: expect.arrayContaining([expect.objectContaining({ id: "payment-in-range", receiptNumber: "RCPT-1004" })]),
  }));
  expect(paymentReport.querySelector(".lead-ar-payment-subtotal").textContent).toContain("$130.00");
  expect(report.querySelector('[aria-label="Outstanding balances"]')).toBeNull();
  expect(report.querySelector(".lead-ar-summary").textContent).toContain("$470.00");
  const activeReport = container.querySelector('[aria-label="Accounts receivable report"]');
  expect(activeReport.querySelector('[aria-label="Class roster"]')).toBeNull();
  await click("Class Roster");
  expect(activeReport.querySelector('[aria-label="Class roster"]').textContent).toContain("Sample Lead");
  expect(activeReport.querySelector('[aria-label="Class roster totals"] tbody').textContent).toContain("2");
  expect(activeReport.querySelector('[aria-label="Class roster"]').textContent).toContain("Second Student");
  expect(activeReport.querySelector('[aria-label="Payment report"]')).toBeNull();
  expect(activeReport.querySelector(".lead-ar-summary")).toBeNull();
  expect(activeReport.textContent).not.toContain("Outstanding balance");
  expect(activeReport.textContent).not.toContain("$170.00");
  await click("Attendance");
  const attendanceView = container.querySelector('[aria-label="Attendance report"]');
  const attendanceReport = attendanceView.querySelector('[aria-label="Class attendance report"]');
  const eveningAttendance = attendanceReport.querySelector('[aria-label="Attendance for Evening"]');
  expect(eveningAttendance.querySelector('[aria-label="1 present, 1 absent, 2 total records"]')).not.toBeNull();
  expect(eveningAttendance.querySelector(".lead-ar-attendance-metrics").textContent).toContain("1 Present");
  expect(eveningAttendance.querySelector(".lead-ar-attendance-metrics").textContent).toContain("1 Absent");
  expect(eveningAttendance.querySelector(".lead-ar-attendance-metrics").textContent).toContain("2 Total");
  expect(eveningAttendance.textContent).toContain("Present");
  expect(eveningAttendance.textContent).toContain("November 2, 2026");
  expect(attendanceView.querySelector(".lead-ar-summary")).toBeNull();
  expect(attendanceView.textContent).not.toContain("Outstanding balance");
  expect(attendanceView.textContent).not.toContain("$170.00");
  await click("Leads");
  const sampleLeadCard = Array.from(container.querySelectorAll(".leads-main .list-group-item")).find((card) => card.textContent.includes("Sample Lead"));
  await act(async () => Simulate.click(sampleLeadCard.querySelector("button")));
  expect(container.querySelector('[aria-label="Payments for Fall Cohort"]').textContent).toContain("Receipt #RCPT-1004");
});

test("attendance report displays class type instead of class instance name", async () => {
  availableLeadRecords = [{ id: "lead-1", name: "Maria Flores", programType: "Full Payment" }];
  classAttendanceRecords = [{
    id: "classAttendance_archived-english_1",
    classInstanceId: "archived-english",
    className: "English Level 01",
    classType: "English",
    startDate: "2026-10-24",
    totalWeeks: 1,
    week: 1,
    attendance: { "lead-1": { present: true } },
  }];
  await render(<LeadsPage />);
  await click("Attendance");

  const attendanceReport = container.querySelector('[aria-label="Class attendance report"]');
  const englishAttendance = attendanceReport.querySelector('[aria-label="Attendance for English"]');
  expect(englishAttendance).not.toBeNull();
  expect(englishAttendance.textContent).toContain("English");
  expect(englishAttendance.textContent).not.toContain("English Level 01");
  expect(englishAttendance.textContent).not.toContain("Archived class instance");
});

test("attendance report separates data into one section per class type", async () => {
  const englishClass = { ...classInstance, id: "english", name: "English Cohort", classType: "English Level 01", startDate: "2026-10-24", totalWeeks: 1 };
  const spanishClass = { ...classInstance, id: "spanish", name: "Spanish Cohort", classType: "Spanish Level 01", startDate: "2026-10-24", totalWeeks: 1 };
  savedLists.classInstances = [englishClass, spanishClass];
  availableLeadRecords = [
    { id: "english-student", name: "Maria Flores", classType: englishClass.classType, classInstanceId: englishClass.id, classInstance: englishClass },
    { id: "spanish-student", name: "Luis Rivera", classType: spanishClass.classType, classInstanceId: spanishClass.id, classInstance: spanishClass },
  ];
  classAttendanceRecords = [
    { id: "classAttendance_english_1", classInstanceId: englishClass.id, className: englishClass.name, classType: englishClass.classType, startDate: englishClass.startDate, totalWeeks: 1, week: 1, attendance: { "english-student": { present: true } } },
    { id: "classAttendance_spanish_1", classInstanceId: spanishClass.id, className: spanishClass.name, classType: spanishClass.classType, startDate: spanishClass.startDate, totalWeeks: 1, week: 1, attendance: { "spanish-student": { present: false } } },
  ];
  await render(<LeadsPage />);
  await click("Attendance");

  const attendanceReport = container.querySelector('[aria-label="Class attendance report"]');
  const typeSections = attendanceReport.querySelectorAll(".lead-ar-attendance-group");
  expect(typeSections).toHaveLength(2);
  const englishSection = attendanceReport.querySelector('[aria-label="Attendance for English Level 01"]');
  const spanishSection = attendanceReport.querySelector('[aria-label="Attendance for Spanish Level 01"]');
  expect(englishSection.textContent).toContain("Maria Flores");
  expect(englishSection.textContent).not.toContain("Luis Rivera");
  expect(spanishSection.textContent).toContain("Luis Rivera");
  expect(spanishSection.textContent).not.toContain("Maria Flores");
});

test("phone check-in finds an existing lead and marks them present for the selected week", async () => {
  savedLists.classInstances = [classInstanceStartingEightDaysAgo()];
  await render(<LeadsPage />);
  await click("Phone Check-in");
  await change(container.querySelector("#lead-phone-checkin-phone"), "5551234567");
  expect(container.textContent).toContain("Sample Lead");

  await change(container.querySelector("#lead-phone-checkin-class-type"), "Evening");
  await change(container.querySelector("#lead-phone-checkin-instance"), "fall");
  expect(container.textContent).toContain("Current class week: Week 2");
  await act(async () => Simulate.change(container.querySelector(".lead-phone-checkin-confirm input"), { target: { checked: true } }));
  await click("CHECK IN");

  expect(addDoc).not.toHaveBeenCalled();
  expect(setDoc).toHaveBeenCalledWith("churches/test-org/leadsSettings/classAttendance_fall_2", expect.objectContaining({
    classInstanceId: "fall", week: 2,
    attendance: { "lead-1": expect.objectContaining({ present: true, name: "Sample Lead", phone: "5551234567", updatedBy: "tester" }) },
  }), { merge: true });
  expect(container.textContent).toContain("already marked present for Week 2");
});

test("phone check-in creates a required lead profile before marking attendance", async () => {
  savedLists.classInstances = [classInstanceStartingEightDaysAgo()];
  await render(<LeadsPage />);
  await click("Phone Check-in");
  await change(container.querySelector("#lead-phone-checkin-phone"), "5557654321");
  expect(container.textContent).toContain("Create a lead profile to continue check-in");
  expect(container.querySelector(".lead-phone-checkin-button").disabled).toBe(true);

  await change(container.querySelector("#lead-phone-checkin-name"), "New Check-in Lead");
  await change(container.querySelector("#lead-phone-checkin-class-type"), "Evening");
  await change(container.querySelector("#lead-phone-checkin-instance"), "fall");
  await act(async () => Simulate.change(container.querySelector(".lead-phone-checkin-confirm input"), { target: { checked: true } }));
  await click("CHECK IN");

  expect(addDoc).toHaveBeenCalledWith("churches/test-org/leads", expect.objectContaining({
    name: "New Check-in Lead", phone: "(555)765-4321", classType: "Evening", classInstanceId: "fall", status: "New",
  }));
  expect(setDoc).toHaveBeenCalledWith("churches/test-org/leadsSettings/classAttendance_fall_2", expect.objectContaining({
    attendance: { "new-lead": expect.objectContaining({ present: true, name: "New Check-in Lead", phone: "(555)765-4321" }) },
  }), { merge: true });
  expect(toast.success).toHaveBeenCalledWith("Lead created and checked in");
});

test("phone check-in blocks a class that has not started yet", async () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  savedLists.classInstances = [{
    ...classInstance,
    startDate: `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`,
  }];
  await render(<LeadsPage />);
  await click("Phone Check-in");
  await change(container.querySelector("#lead-phone-checkin-phone"), "5551234567");
  await change(container.querySelector("#lead-phone-checkin-class-type"), "Evening");
  await change(container.querySelector("#lead-phone-checkin-instance"), "fall");

  expect(container.textContent).toContain("This class has not started yet");
  expect(container.querySelector(".lead-phone-checkin-button").disabled).toBe(true);
  expect(setDoc).not.toHaveBeenCalled();
});

test("admins can generate a tokenized public phone check-in link", async () => {
  const originalCrypto = window.crypto;
  Object.defineProperty(window, "crypto", { configurable: true, value: { getRandomValues: (bytes) => bytes.fill(90) } });
  try {
    await render(<LeadsPage />);
    await click("Phone Check-in");
    await click("Generate public link");

    expect(setDoc).toHaveBeenCalledWith("churches/test-org/leadsSettings/publicPhoneCheckIn", expect.objectContaining({
      enabled: true,
      token: expect.stringMatching(/^[a-f0-9]{64}$/),
    }), { merge: true });
    await change(container.querySelector("#public-checkin-custom-slug"), "Electrical Class October");
    await click("Save");
    expect(setDoc).toHaveBeenCalledWith("churches/test-org/leadsSettings/publicPhoneCheckIn", expect.objectContaining({ slug: "electrical-class-october" }), { merge: true });
    expect(container.querySelector('[aria-label="Public check-in URL"]').value).toMatch(/\/check-in\/test-org\/electrical-class-october\/[a-f0-9]{64}$/);
    expect(container.textContent).toContain("Regenerate link");
  } finally {
    Object.defineProperty(window, "crypto", { configurable: true, value: originalCrypto });
  }
});

test("public phone check-in looks up and submits through the scoped endpoint without Firebase reads", async () => {
  const previousFetch = global.fetch;
  const requests = [];
  global.fetch = jest.fn(async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const result = body.action === "bootstrap"
      ? { success: true, classTypes: ["Electrical"], classInstances: [{ id: "electrical", name: "Electrical Class Level 01", classType: "Electrical", currentWeek: { available: true, week: 2, weekStart: "2026-10-30", weekEnd: "2026-11-05" } }] }
      : body.action === "lookup"
        ? { success: true, lead: { id: "lead-1", name: "Salomon Paredes", phone: "5551234567" } }
        : { success: true, alreadyPresent: false, lead: { id: "lead-1", name: "Salomon Paredes" }, className: "Electrical Class Level 01", week: 2, weekStart: "2026-10-30", weekEnd: "2026-11-05" };
    return { ok: true, json: async () => result };
  });
  try {
    await renderPublicCheckIn("/check-in/test-org/salomon-paredes/share-token");
    await change(container.querySelector("#public-checkin-phone"), "5551234567");
    await click("Find profile");
    await change(container.querySelector("#public-checkin-class-type"), "Electrical");
    await change(container.querySelector("#public-checkin-class"), "electrical");
    await act(async () => Simulate.change(container.querySelector(".lead-phone-checkin-confirm input"), { target: { checked: true } }));
    await click("CHECK IN");

    expect(requests.map((request) => request.action)).toEqual(["bootstrap", "lookup", "checkIn"]);
    expect(requests.every((request) => request.churchId === "test-org" && request.token === "share-token")).toBe(true);
    expect(requests[2]).toEqual(expect.objectContaining({ confirmed: true, classInstanceId: "electrical", phone: "(555)123-4567" }));
    expect(container.textContent).toContain("Salomon Paredes is checked in for Electrical Class Level 01, Week 2");
    expect(onSnapshot).not.toHaveBeenCalled();
  } finally {
    global.fetch = previousFetch;
  }
});

test("By Status tab groups leads and lists their phone numbers", async () => {
  savedLists.statuses = ["New", "Qualified"];
  availableLeadRecords = [
    { id: "lead-1", name: "Ana Rivera", phone: "5551112222", status: "New" },
    { id: "lead-2", name: "Luis Cruz", phone: "5553334444", status: "Qualified" },
    { id: "lead-3", name: "Mia Torres", phone: "5555556666", status: "New" },
  ];
  await render(<LeadsPage />);
  await click("By Status");

  const report = container.querySelector('[aria-label="Leads grouped by status"]');
  const newLeads = report.querySelector('[aria-label="Leads with status New"]');
  const qualifiedLeads = report.querySelector('[aria-label="Leads with status Qualified"]');
  expect(report.querySelector('[aria-label="3 total leads"]').textContent).toBe("3 total leads");
  expect(newLeads.querySelector(".lead-status-count").textContent).toBe("2 leads");
  expect(qualifiedLeads.querySelector(".lead-status-count").textContent).toBe("1 lead");
  expect(newLeads.textContent).toContain("Ana Rivera");
  expect(newLeads.textContent).toContain("5551112222");
  expect(newLeads.textContent).toContain("Mia Torres");
  expect(qualifiedLeads.textContent).toContain("Luis Cruz");
  expect(qualifiedLeads.textContent).toContain("5553334444");
  expect(report.querySelectorAll(".lead-status-group")).toHaveLength(2);
});

test("By Status search and toggles filter grouped leads", async () => {
  savedLists.statuses = ["New", "Qualified"];
  availableLeadRecords = [
    { id: "lead-1", name: "Ana Rivera", phone: "5551112222", status: "New" },
    { id: "lead-2", name: "Luis Cruz", phone: "5553334444", status: "Qualified" },
    { id: "lead-3", name: "Mia Torres", phone: "5555556666", status: "New" },
  ];
  await render(<LeadsPage />);
  await click("By Status");
  const search = container.querySelector('[aria-label="Search leads by status"]');
  await change(search, "Ana");

  let report = container.querySelector('[aria-label="Leads grouped by status"]');
  expect(report.textContent).toContain("Ana Rivera");
  expect(report.textContent).not.toContain("Luis Cruz");
  expect(report.querySelectorAll(".lead-status-group")).toHaveLength(1);

  await act(async () => Simulate.change(container.querySelector('[aria-label="Include status New"]'), { target: { checked: false } }));
  expect(container.querySelector('[aria-label="Leads grouped by status"]').textContent).toContain("No leads to report.");
  await click("All on");
  report = container.querySelector('[aria-label="Leads grouped by status"]');
  expect(report.textContent).toContain("Ana Rivera");
  expect(report.textContent).toContain("1 total leads");

  await change(search, "");
  expect(container.querySelector('[aria-label="Leads grouped by status"]').textContent).toContain("3 total leads");
});

test("lead profile status selector updates the lead without opening full edit mode", async () => {
  availableLeadRecords = [{ ...lead, id: "lead-1", status: "New" }];
  await render(<LeadsPage />);
  await click("View Profile");
  const status = container.querySelector("#lead-profile-status-lead-1");
  expect(status.value).toBe("New");
  await change(status, "Qualified");
  expect(updateDoc).toHaveBeenCalledWith("churches/test-org/leads/lead-1", expect.objectContaining({ status: "Qualified" }));
  expect(status.value).toBe("Qualified");
});

test("lead comments are displayed, added, and deleted from the profile", async () => {
  await render(<LeadsPage />);
  await click("View Profile");
  const profile = container.querySelector(".lead-profile-panel");
  expect(profile.textContent).toContain("Called and left a message");
  expect(container.querySelector(".leads-main button" )?.textContent).not.toContain("Comments");

  const commentInput = profile.querySelector('[aria-label="Comment for Sample Lead"]');
  await change(commentInput, "Follow up next week");
  await click("Add Comment");
  expect(addDoc).toHaveBeenCalledWith("churches/test-org/leads/lead-1/comments", expect.objectContaining({ text: "Follow up next week" }));
  expect(commentInput.value).toBe("");

  const deleteComment = Array.from(profile.querySelectorAll("button")).find((button) => button.textContent === "Delete");
  await act(async () => Simulate.click(deleteComment));
  expect(deleteDoc).toHaveBeenCalledWith("churches/test-org/leads/lead-1/comments/comment-1");
});

test("lead profile follow-up saves the flag and time to call", async () => {
  availableLeadRecords = [{ ...lead, id: "lead-1", status: "New", followUp: false, callbackTime: "" }];
  await render(<LeadsPage />);
  await click("View Profile");
  const followUp = container.querySelector('[aria-label="Needs follow-up: Sample Lead"]');
  const callTime = container.querySelector("#lead-profile-call-time-lead-1");
  await act(async () => Simulate.change(followUp, { target: { checked: true } }));
  await change(callTime, "16:45");
  await click("Save Follow-up");

  expect(updateDoc).toHaveBeenCalledWith("churches/test-org/leads/lead-1", expect.objectContaining({
    followUp: true, callbackTime: "16:45", status: "Contacted",
  }));
  expect(followUp.checked).toBe(true);
  expect(callTime.value).toBe("16:45");
});

test("lead profiles show only the selected program price with weekly attendance", async () => {
  const winterInstance = { ...classInstance, id: "winter", name: "Winter Cohort", startDate: "2027-01-11", totalWeeks: 2, programAssignments: [
    { programType: "Certificate", price: 275 },
    { programType: "Diploma", price: 410 },
    { programType: "Full Payment", price: 600 },
  ] };
  savedLists.classInstances = [classInstance, winterInstance];
  availableLeadRecords = [{ ...lead, id: "lead-1", classInstanceId: "winter", classInstance: winterInstance }];
  classAttendanceRecords = [
    { id: "classAttendance_fall_1", classInstanceId: "fall", week: 1, attendance: { "lead-1": { present: true } } },
    { id: "classAttendance_fall_2", classInstanceId: "fall", week: 2, attendance: { "lead-1": { present: false } } },
    { id: "classAttendance_winter_1", classInstanceId: "winter", week: 1, attendance: { "lead-1": { present: true } } },
  ];
  await render(<LeadsPage />);

  await click("View Profile");
  const profile = container.querySelector(".lead-profile-panel");
  expect(container.querySelector(".leads-calls-sidebar")).toBeNull();
  expect(container.querySelector('[data-testid="current-search"]').textContent).toBe("?leadId=lead-1");
  expect(profile.textContent).toContain("Sample Lead");
  expect(profile.textContent).toContain("Fall Cohort");
  expect(profile.textContent).toContain("Winter Cohort");
  const winterEnrollment = profile.querySelector('[aria-label="Enrollment for Winter Cohort"]');
  const winterPayments = profile.querySelector('[aria-label="Payments for Winter Cohort"]');
  expect(winterEnrollment.textContent).toContain("Current assignment");
  expect(winterEnrollment.textContent).toContain("Evening · 2027-01-11 · 2 weeks");
  expect(winterEnrollment.textContent).not.toContain("Certificate: $275.00");
  expect(winterPayments.textContent).toContain("Payments");
  expect(winterPayments.textContent).toContain("Certificate: $275.00");
  expect(winterPayments.textContent).not.toContain("Diploma: $410.00");
  expect(winterPayments.textContent).not.toContain("Full Payment: $600.00");
  expect(profile.querySelectorAll(".lead-profile-attendance")).toHaveLength(2);
  expect(profile.querySelectorAll(".lead-profile-attendance h6")[0].textContent).toBe("Attendance report");
  const fallReport = profile.querySelector('.lead-profile-attendance[aria-label="Attendance report for Fall Cohort"]');
  expect(fallReport).not.toBeNull();
  expect(fallReport.querySelectorAll('input[type="checkbox"]')).toHaveLength(8);
  expect(fallReport.textContent).toContain("Present 1 of 8 weeks");
  expect(profile.textContent).toContain("Present 1 of 8 weeks");
  expect(profile.textContent).toContain("Week 1 · Nov 2, 2026: Present");
  expect(profile.textContent).toContain("Week 2 · Nov 9, 2026: Absent");
  const thirdWeek = fallReport.querySelector('[aria-label="Present: Sample Lead, Fall Cohort, week 3"]');
  expect(thirdWeek.checked).toBe(false);
  await act(async () => Simulate.change(thirdWeek, { target: { checked: true } }));
  expect(setDoc).toHaveBeenCalledWith("churches/test-org/leadsSettings/classAttendance_fall_3", expect.objectContaining({
    classInstanceId: "fall", week: 3,
    attendance: { "lead-1": expect.objectContaining({ present: true, name: "Sample Lead", phone: "5551234567", email: "lead@example.com", updatedBy: "tester", updatedAt: "server-time" }) },
  }), { merge: true });
  await act(async () => Simulate.change(fallReport.querySelector('[aria-label="Present: Sample Lead, Fall Cohort, week 1"]'), { target: { checked: false } }));
  expect(setDoc).toHaveBeenCalledWith("churches/test-org/leadsSettings/classAttendance_fall_1", expect.objectContaining({
    attendance: { "lead-1": expect.objectContaining({ present: false }) },
  }), { merge: true });
  await click("Close profile");
  expect(container.querySelector(".lead-profile-panel")).toBeNull();
  expect(container.querySelector(".leads-calls-sidebar")).not.toBeNull();
  expect(container.querySelector('[data-testid="current-search"]').textContent).toBe("");
});

test("profile shows one coupon choice and marks $35 owed when it is unchecked", async () => {
  const couponInstance = { ...classInstance, programAssignments: [{ programType: "Coupon Church 100% Paid", price: 0 }] };
  savedLists.classInstances = [couponInstance];
  availableLeadRecords = [{ ...lead, id: "lead-1", programType: "Coupon Church 100% Paid", classInstanceId: "fall", classInstance: couponInstance }];
  await render(<LeadsPage />);
  await click("View Profile");

  const payments = container.querySelector('[aria-label="Payments for Fall Cohort"]');
  const coupon = payments.querySelector('[aria-label="Coupon received: Sample Lead, Fall Cohort, week 1"]');
  const present = container.querySelector('[aria-label="Present: Sample Lead, Fall Cohort, week 1"]');
  expect(coupon).not.toBeNull();
  expect(payments.querySelector('[aria-label="Record $35 payment: Sample Lead, Fall Cohort, week 1"]')).toBeNull();
  expect(payments.textContent).toContain("Owes $35 for week 1");
  expect(payments.textContent).toContain("Balance due: $280.00");
  expect(present.disabled).toBe(false);

  await act(async () => Simulate.change(coupon, { target: { checked: true } }));
  expect(setDoc).toHaveBeenNthCalledWith(1, "churches/test-org/leadsSettings/classAttendance_fall_1", expect.objectContaining({
    attendance: { "lead-1": expect.objectContaining({ couponReceived: true, amountPaid: 0, present: false, programType: "Coupon Church 100% Paid" }) },
  }), { merge: true });
  expect(payments.textContent).toContain("Balance due: $245.00");
  expect(present.disabled).toBe(false);

  await act(async () => Simulate.change(present, { target: { checked: true } }));
  expect(setDoc).toHaveBeenNthCalledWith(2, "churches/test-org/leadsSettings/classAttendance_fall_1", expect.objectContaining({
    attendance: { "lead-1": expect.objectContaining({ couponReceived: true, present: true }) },
  }), { merge: true });
});

test("full payment profile records amount, date, and method and updates the balance", async () => {
  const fullPaymentInstance = { ...classInstance, programAssignments: [{ programType: "Full Payment", price: 420 }] };
  savedLists.classInstances = [fullPaymentInstance];
  availableLeadRecords = [{ ...lead, id: "lead-1", programType: "Full Payment", classInstanceId: "fall", classInstance: fullPaymentInstance }];
  await render(<LeadsPage />);
  await click("View Profile");

  const payments = container.querySelector('[aria-label="Payments for Fall Cohort"]');
  expect(payments.textContent).toContain("Balance due: $420.00");
  expect(Array.from(container.querySelector(`#payment-method-lead-1-fall`).options).map((option) => option.value)).toContain("Cash");
  expect(Array.from(container.querySelector(`#payment-method-lead-1-fall`).options).map((option) => option.value)).toContain("Zelle");
  await change(container.querySelector("#payment-amount-lead-1-fall"), "120");
  await change(container.querySelector("#payment-date-lead-1-fall"), "2026-10-28");
  await change(container.querySelector("#payment-method-lead-1-fall"), "Zelle");
  await act(async () => Simulate.submit(container.querySelector(".lead-profile-payment-form")));

  expect(updateDoc).toHaveBeenCalledWith("churches/test-org/leads/lead-1", expect.objectContaining({
    classPaymentHistory: { __arrayUnion: [{ id: "new-instance", classInstanceId: "fall", amount: 120, date: "2026-10-28", method: "Zelle", receiptNumber: "", recordedAt: expect.any(String), recordedBy: "tester" }] },
  }));
  expect(payments.textContent).toContain("Balance due: $300.00");
  expect(payments.textContent).toContain("$120.00 · 2026-10-28 · Zelle");
});

test("church referral profile records a payment and updates the remaining balance", async () => {
  const referralInstance = { ...classInstance, programAssignments: [{ programType: "Church Referral 50%", price: 210 }] };
  savedLists.classInstances = [referralInstance];
  availableLeadRecords = [{
    ...lead,
    id: "lead-1",
    programType: "Church Referral 50%",
    classInstanceId: "fall",
    classInstance: referralInstance,
  }];
  await render(<LeadsPage />);
  await click("View Profile");

  const payments = container.querySelector('[aria-label="Payments for Fall Cohort"]');
  expect(payments.textContent).toContain("Church Referral 50%: $210.00");
  expect(payments.textContent).toContain("Balance due: $210.00");
  await change(container.querySelector("#payment-amount-lead-1-fall"), "50");
  await change(container.querySelector("#payment-date-lead-1-fall"), "2026-10-28");
  await act(async () => Simulate.submit(container.querySelector(".lead-profile-payment-form")));

  expect(updateDoc).toHaveBeenCalledWith("churches/test-org/leads/lead-1", expect.objectContaining({
    classPaymentHistory: { __arrayUnion: [expect.objectContaining({ amount: 50, date: "2026-10-28", method: "Cash" })] },
  }));
  expect(payments.textContent).toContain("Balance due: $160.00");
  expect(payments.textContent).toContain("$50.00 · 2026-10-28 · Cash");
});

test("payments can be edited and deleted from the profile", async () => {
  const referralInstance = { ...classInstance, programAssignments: [{ programType: "Church Referral 50%", price: 210 }] };
  const payment = { id: "payment-1", classInstanceId: "fall", amount: 50, date: "2026-10-28", method: "Cash" };
  savedLists.classInstances = [referralInstance];
  availableLeadRecords = [{ ...lead, id: "lead-1", programType: "Church Referral 50%", classInstanceId: "fall", classInstance: referralInstance, classPaymentHistory: [payment] }];
  window.confirm = jest.fn(() => true);
  await render(<LeadsPage />);
  await click("View Profile");

  await act(async () => Simulate.click(container.querySelector('[aria-label="Edit payment $50.00 2026-10-28"]')));
  const editForm = container.querySelector(".lead-profile-payment-edit-form");
  await change(editForm.querySelector('input[type="number"]'), "75");
  await change(editForm.querySelector('input[type="date"]'), "2026-10-29");
  await change(editForm.querySelector("select"), "Zelle");
  await act(async () => Simulate.submit(editForm));

  const editBatch = writeBatch.mock.results[0].value;
  expect(editBatch.update).toHaveBeenCalledWith("churches/test-org/leads/lead-1", expect.objectContaining({
    classPaymentHistory: [expect.objectContaining({ id: "payment-1", amount: 75, date: "2026-10-29", method: "Zelle" })],
  }));
  const payments = container.querySelector('[aria-label="Payments for Fall Cohort"]');
  expect(payments.textContent).toContain("Balance due: $135.00");
  expect(payments.textContent).toContain("$75.00 · 2026-10-29 · Zelle");

  await act(async () => Simulate.click(container.querySelector('[aria-label="Delete payment $75.00 2026-10-29"]')));
  const deleteBatch = writeBatch.mock.results[1].value;
  expect(window.confirm).toHaveBeenCalledWith("Delete this payment?");
  expect(deleteBatch.update).toHaveBeenCalledWith("churches/test-org/leads/lead-1", expect.objectContaining({ classPaymentHistory: [] }));
  expect(payments.textContent).toContain("Balance due: $210.00");
  expect(payments.textContent).toContain("No payments recorded.");
});

test("lead profile filters payments by method and saves a changed method", async () => {
  const referralInstance = { ...classInstance, programAssignments: [{ programType: "Church Referral 50%", price: 210 }] };
  const payments = [
    { id: "cash-payment", classInstanceId: "fall", amount: 50, date: "2026-10-28", method: "Cash" },
    { id: "zelle-payment", classInstanceId: "fall", amount: 25, date: "2026-10-29", method: "Zelle" },
  ];
  savedLists.classInstances = [referralInstance];
  availableLeadRecords = [{ ...lead, id: "lead-1", programType: "Church Referral 50%", classInstanceId: "fall", classInstance: referralInstance, classPaymentHistory: payments }];
  await render(<LeadsPage />);
  await click("View Profile");

  const paymentSection = container.querySelector('[aria-label="Payments for Fall Cohort"]');
  const methodFilter = paymentSection.querySelector('[aria-label="Filter payments by method for Fall Cohort"]');
  await change(methodFilter, "Zelle");
  expect(paymentSection.querySelector(".lead-profile-payment-history").textContent).toContain("$25.00 · 2026-10-29 · Zelle");
  expect(paymentSection.querySelector(".lead-profile-payment-history").textContent).not.toContain("Cash");

  await act(async () => Simulate.click(paymentSection.querySelector('[aria-label="Edit payment $25.00 2026-10-29"]')));
  const editForm = paymentSection.querySelector(".lead-profile-payment-edit-form");
  await change(editForm.querySelector("select"), "Card");
  await act(async () => Simulate.submit(editForm));

  const editBatch = writeBatch.mock.results[0].value;
  expect(editBatch.update).toHaveBeenCalledWith("churches/test-org/leads/lead-1", expect.objectContaining({
    classPaymentHistory: [payments[0], expect.objectContaining({ id: "zelle-payment", method: "Card" })],
  }));
  await change(methodFilter, "all");
  expect(paymentSection.querySelector(".lead-profile-payment-history").textContent).toContain("$25.00 · 2026-10-29 · Card");
});

test("lead profile exports an academy-branded PDF", async () => {
  getChurchData.mockResolvedValue({ churchName: "Sample Academy", logo: "" });
  availableLeadRecords = [{
    ...lead,
    id: "lead-1",
    callAttempts: [{ attemptedAt: "2026-10-30T12:00:00Z", attemptedBy: "Tester" }],
    classInstances: Array.from({ length: 8 }, (_unused, index) => ({
      id: `class-${index}`,
      name: `Class enrollment ${index + 1}`,
      classType: "Evening",
      startDate: "2026-11-02",
      totalWeeks: 8,
    })),
  }];
  await render(<LeadsPage />);
  await click("View Profile");
  await act(async () => Simulate.click(container.querySelector('[aria-label="Export lead profile as PDF"]')));

  expect(getChurchData).toHaveBeenCalledWith("test-org");
  expect(toast.error).not.toHaveBeenCalled();
  expect(container.querySelector('[aria-label="Export lead profile as PDF"]').textContent).toContain("Export PDF");
});

test("editing a legacy class payment updates its settings record", async () => {
  const referralInstance = { ...classInstance, programAssignments: [{ programType: "Church Referral 50%", price: 210 }] };
  const payment = { id: "legacy-payment", classInstanceId: "fall", amount: 50, date: "2026-10-28", method: "Cash" };
  savedLists.classInstances = [referralInstance];
  availableLeadRecords = [{ ...lead, id: "lead-1", programType: "Church Referral 50%", classInstanceId: "fall", classInstance: referralInstance }];
  classPaymentRecords = [{ id: "classPayments_fall", classInstanceId: "fall", payments: { "lead-1": [payment] } }];
  await render(<LeadsPage />);
  await click("View Profile");

  await act(async () => Simulate.click(container.querySelector('[aria-label="Edit payment $50.00 2026-10-28"]')));
  const editForm = container.querySelector(".lead-profile-payment-edit-form");
  await change(editForm.querySelector('input[type="number"]'), "60");
  await act(async () => Simulate.submit(editForm));

  expect(writeBatch.mock.results[0].value.update).toHaveBeenCalledWith("churches/test-org/leadsSettings/classPayments_fall", expect.objectContaining({
    payments: { "lead-1": [expect.objectContaining({ id: "legacy-payment", amount: 60 })] },
  }));
  expect(container.querySelector('[aria-label="Payments for Fall Cohort"]').textContent).toContain("Balance due: $150.00");
});

test("church coupon and affiliate methods preset their fixed payment amounts", async () => {
  const fullPaymentInstance = { ...classInstance, programAssignments: [{ programType: "Full Payment", price: 420 }] };
  savedLists.classInstances = [fullPaymentInstance];
  availableLeadRecords = [{ ...lead, id: "lead-1", programType: "Full Payment", classInstanceId: "fall", classInstance: fullPaymentInstance }];
  await render(<LeadsPage />);
  await click("View Profile");

  const amount = container.querySelector("#payment-amount-lead-1-fall");
  const method = container.querySelector("#payment-method-lead-1-fall");
  const methods = Array.from(method.options).map((option) => option.value);
  expect(methods).toContain("Lighthouse Church Coupon");
  expect(methods).toContain("Affiliate Church");

  await change(method, "Affiliate Church");
  expect(amount.value).toBe("210");
  expect(amount.readOnly).toBe(true);
  await change(container.querySelector("#payment-date-lead-1-fall"), "2026-10-27");
  await act(async () => Simulate.submit(container.querySelector(".lead-profile-payment-form")));
  expect(updateDoc).toHaveBeenCalledWith("churches/test-org/leads/lead-1", expect.objectContaining({
    classPaymentHistory: { __arrayUnion: [{ id: "new-instance", classInstanceId: "fall", amount: 210, date: "2026-10-27", method: "Affiliate Church", receiptNumber: "", recordedAt: expect.any(String), recordedBy: "tester" }] },
  }));
  expect(container.querySelector('[aria-label="Payments for Fall Cohort"]').textContent).toContain("Balance due: $210.00");

  await change(method, "Lighthouse Church Coupon");
  expect(amount.value).toBe("35");
  expect(amount.readOnly).toBe(true);
});

test("new lead profile records three dated call attempts and marks Dead Lead", async () => {
  availableLeadRecords = [{ ...lead, id: "lead-1", status: "New" }];
  await render(<LeadsPage />);
  await click("View Profile");
  const profile = container.querySelector(".lead-profile-panel");
  const attemptInputs = () => Array.from(profile.querySelectorAll('[aria-label^="Call attempt "]'));

  expect(attemptInputs()).toHaveLength(3);
  const followUpSection = profile.querySelector(".lead-profile-follow-up");
  const callAttemptsSection = profile.querySelector(".lead-profile-call-attempts");
  const commentsSection = profile.querySelector(".lead-profile-comments");
  const attachmentsSection = profile.querySelector(".lead-profile-attachments");
  expect(Boolean(followUpSection.compareDocumentPosition(callAttemptsSection) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  expect(Boolean(callAttemptsSection.compareDocumentPosition(commentsSection) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  expect(Boolean(commentsSection.compareDocumentPosition(attachmentsSection) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  expect(profile.lastElementChild).toBe(attachmentsSection);
  for (let index = 0; index < 3; index += 1) {
    await act(async () => Simulate.change(attemptInputs()[index], { target: { checked: true } }));
    const savedLead = updateDoc.mock.calls[index][1];
    expect(Date.parse(savedLead.callAttempts[index].attemptedAt)).not.toBeNaN();
    expect(savedLead.callAttempts[index].attemptedBy).toBe("tester");
    if (index < 2) expect(profile.querySelectorAll(".lead-profile-call-attempts time")).toHaveLength(index + 1);
  }
  expect(updateDoc).toHaveBeenLastCalledWith("churches/test-org/leads/lead-1", expect.objectContaining({ status: "Dead Lead" }));
  expect(profile.textContent).toContain("StatusDead Lead");
  expect(profile.querySelector(".lead-profile-call-attempts")).toBeNull();

  await change(container.querySelector("#lead-profile-status-lead-1"), "New");
  expect(profile.querySelectorAll(".lead-profile-call-attempts time")).toHaveLength(3);
  await act(async () => Simulate.change(attemptInputs()[2], { target: { checked: false } }));
  expect(updateDoc).toHaveBeenLastCalledWith("churches/test-org/leads/lead-1", expect.objectContaining({ status: "New" }));
});

test("Manage Lead Options dropdown contains every lead management tab and route", async () => {
  await render(<LeadsPage />);
  const optionsMenu = container.querySelector(".leads-options-menu");
  expect(optionsMenu.querySelector("summary").textContent).toContain("Manage Lead Options");
  const links = Array.from(optionsMenu.querySelectorAll("nav a"));
  expect(links.map((link) => link.textContent)).toEqual(LEAD_MODULE_TABS.map((tab) => tab.label));
  expect(links.map((link) => link.getAttribute("href"))).toEqual(LEAD_MODULE_TABS.map((tab) => `/organization/test-org/leads/${tab.path}`));
});

test("callback time can be edited from the lead profile", async () => {
  await render(<LeadsPage />);
  const callback = container.querySelector('[aria-label="Best callback time"]');
  expect(callback.textContent).toContain("Call back at");
  expect(callback.parentElement.className).toContain("ms-md-auto");
  expect(callback.parentElement.textContent).not.toContain("Edit");
  await click("View Profile");
  await click("Edit");
  await change(container.querySelector("#edit-lead-lead-1-callbackTime"), "");
  await click("Save");
  expect(updateDoc).toHaveBeenCalledWith("churches/test-org/leads/lead-1", expect.objectContaining({ callbackTime: "" }));
});

test("lead edit and delete actions are available from the profile instead of the list row", async () => {
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
  await render(<LeadsPage />);
  const leadRow = container.querySelector(".leads-main .list-group-item");
  expect(leadRow.textContent).not.toContain("Edit");
  expect(leadRow.textContent).not.toContain("Delete");

  await click("View Profile");
  const profile = container.querySelector(".lead-profile-panel");
  const editButton = profile.querySelector('[aria-label="Edit lead Sample Lead"]');
  const deleteButton = profile.querySelector('[aria-label="Delete lead Sample Lead"]');
  expect(editButton).not.toBeNull();
  expect(editButton.disabled).toBe(false);
  expect(deleteButton).not.toBeNull();

  await act(async () => Simulate.click(deleteButton));
  expect(confirm).toHaveBeenCalledWith("Delete this lead and its comments?");
  expect(deleteDoc).toHaveBeenCalledWith("churches/test-org/leads/lead-1");
  expect(container.querySelector(".lead-profile-panel")).toBeNull();
  confirm.mockRestore();
});

test("top call ticker announces the next lead call with time and contact details", async () => {
  await render(<LeadsPage />);
  const ticker = container.querySelector('.leads-call-ticker[aria-label="Next upcoming call"]');
  expect(ticker).not.toBeNull();
  expect(ticker.getAttribute("aria-live")).toBe("polite");
  expect(ticker.querySelector(".leads-call-ticker-label").textContent).toBe("Next call");
  expect(ticker.querySelector(".leads-call-ticker-countdown").textContent).toMatch(/^(In|Due now)/);
  expect(Boolean(ticker.compareDocumentPosition(container.querySelector('a[href="/organization/test-org/mi-organizacion"]')) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  expect(Boolean(ticker.compareDocumentPosition(container.querySelector("h2")) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  const announcement = ticker.querySelector(".visually-hidden").textContent;
  expect(announcement).toContain("Sample Lead");
  expect(announcement).toContain("5551234567");
  expect(announcement).toMatch(/\d{1,2}:\d{2} [AP]M/);
});

test("calls sidebar shows the next contact and a click-to-call phone number independently of search", async () => {
  await render(<LeadsPage />);
  const sidebar = container.querySelector('aside[aria-labelledby="upcoming-calls-heading"]');
  expect(sidebar.textContent).toContain("Upcoming Calls");
  expect(sidebar.textContent).toContain("Next Call");
  expect(sidebar.textContent).toContain("Sample Lead");
  expect(sidebar.querySelector("a").getAttribute("href")).toBe("tel:5551234567");
  expect(sidebar.querySelector("time")).not.toBeNull();
  await change(container.querySelector('[aria-label="Search leads"]'), "no matching lead");
  expect(sidebar.textContent).toContain("Sample Lead");
});

test("sidebar call completion is saved and can be scheduled again", async () => {
  await render(<LeadsPage />);
  await click("Mark Complete");
  expect(updateDoc).toHaveBeenCalledWith("churches/test-org/leads/lead-1", {
    callbackCompleted: true, callbackCompletedAt: "server-time", updatedAt: "server-time",
  });
  await act(async () => listeners["churches/test-org/leads"]({
    docs: [{ id: "lead-1", data: () => ({ ...lead, callbackCompleted: true }) }],
  }));
  const sidebar = container.querySelector("aside");
  expect(sidebar.textContent).toContain("No upcoming calls.");
  expect(sidebar.textContent).not.toContain("Sample Lead");
  expect(container.textContent).toContain("Call completed");
  await click("Schedule Again");
  expect(updateDoc).toHaveBeenCalledTimes(1);
  expect(container.querySelector("#reschedule-call-lead-1").value).toBe("14:30");
  await change(container.querySelector("#reschedule-call-lead-1"), "16:15");
  await click("Reschedule Call");
  expect(updateDoc).toHaveBeenLastCalledWith("churches/test-org/leads/lead-1", {
    callbackCompleted: false, callbackCompletedAt: null, callbackTime: "16:15", updatedAt: "server-time",
  });
  await act(async () => listeners["churches/test-org/leads"]({
    docs: [{ id: "lead-1", data: () => ({ ...lead, callbackCompleted: false, callbackTime: "16:15" }) }],
  }));
  expect(sidebar.textContent).toContain("Sample Lead");
});

test("rescheduling can be canceled without changing a completed call", async () => {
  await render(<LeadsPage />);
  await act(async () => listeners["churches/test-org/leads"]({
    docs: [{ id: "lead-1", data: () => ({ ...lead, callbackCompleted: true }) }],
  }));
  await click("Schedule Again");
  await change(container.querySelector("#reschedule-call-lead-1"), "17:00");
  await click("Cancel Reschedule");
  expect(updateDoc).not.toHaveBeenCalled();
  expect(container.querySelector("#reschedule-call-lead-1")).toBeNull();
  expect(container.querySelector("aside").textContent).toContain("No upcoming calls.");
});

test("failed rescheduling retains the new time and completed call state", async () => {
  await render(<LeadsPage />);
  await act(async () => listeners["churches/test-org/leads"]({
    docs: [{ id: "lead-1", data: () => ({ ...lead, callbackCompleted: true }) }],
  }));
  await click("Schedule Again");
  await change(container.querySelector("#reschedule-call-lead-1"), "17:00");
  updateDoc.mockRejectedValueOnce(new Error("permission denied"));
  const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  await click("Reschedule Call");
  expect(container.querySelector("#reschedule-call-lead-1").value).toBe("17:00");
  expect(container.querySelector("aside").textContent).toContain("No upcoming calls.");
  expect(toast.error).toHaveBeenCalledWith("Failed to update call completion");
  consoleError.mockRestore();
});

test("failed completion keeps the call in the sidebar", async () => {
  await render(<LeadsPage />);
  const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  updateDoc.mockRejectedValueOnce(new Error("permission denied"));
  await click("Mark Complete");
  expect(toast.error).toHaveBeenCalledWith("Failed to update call completion");
  expect(container.querySelector("aside").textContent).toContain("Sample Lead");
  expect(container.querySelector('button[aria-label="Mark call to Sample Lead complete"]').disabled).toBe(false);
  consoleError.mockRestore();
});

test("editing contact details preserves completion but a new callback time reopens the call", async () => {
  await render(<LeadsPage />);
  await act(async () => listeners["churches/test-org/leads"]({
    docs: [{ id: "lead-1", data: () => ({ ...lead, callbackCompleted: true }) }],
  }));
  await click("View Profile");
  await click("Edit");
  await click("Save");
  expect(updateDoc.mock.calls[0][1]).not.toHaveProperty("callbackCompleted");
  await click("Edit");
  await change(container.querySelector("#edit-lead-lead-1-callbackTime"), "17:00");
  await click("Save");
  expect(updateDoc).toHaveBeenLastCalledWith("churches/test-org/leads/lead-1", expect.objectContaining({
    callbackTime: "17:00", callbackCompleted: false, callbackCompletedAt: null,
  }));
});

test("next calls are ordered by upcoming local time and wrap past times to tomorrow", () => {
  const now = new Date(2026, 9, 26, 10, 0, 25);
  const leads = [
    { id: "past", name: "Earlier", callbackTime: "09:00" },
    { id: "later", name: "Afternoon", callbackTime: "14:30" },
    { id: "now", name: "Current", callbackTime: "10:00" },
    { id: "invalid", callbackTime: "25:99" },
    { id: "unset" },
    { id: "complete", callbackTime: "10:30", callbackCompleted: true },
  ];
  const calls = getUpcomingLeadCalls(leads, now);
  expect(calls.map(({ lead }) => lead.id)).toEqual(["now", "later", "past"]);
  expect(calls[0].callAt.getDate()).toBe(26);
  expect(calls[2].callAt.getDate()).toBe(27);
  expect(leads[0].id).toBe("past");
  expect(getUpcomingLeadCalls([], now)).toEqual([]);
});

test("manager creates, renames, reorders and deletes combined location options", async () => {
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
  await render(<LeadsStatusManager />);
  await click("City & State");
  await change(container.querySelector('input[aria-label="New city & state"]'), "Evanston, Illinois");
  await click("Add");
  expect(savedLists.locations).toEqual(["Chicago, Illinois", "Evanston, Illinois"]);
  await click("Edit");
  await change(container.querySelector("li input"), "Springfield, Illinois");
  await click("Save");
  expect(savedLists.locations).toEqual(["Springfield, Illinois", "Evanston, Illinois"]);
  await act(async () => Simulate.click(container.querySelector('button[title="Move down"]')));
  expect(savedLists.locations).toEqual(["Evanston, Illinois", "Springfield, Illinois"]);
  await click("Delete");
  expect(savedLists.locations).toEqual(["Springfield, Illinois"]);
  confirm.mockRestore();
});

test("option tabs use separate settings documents with one combined location tab", async () => {
  await render(<LeadsStatusManager />);
  expect(container.textContent).toContain("Contacted");
  expect(container.querySelectorAll('[role="tab"]')).toHaveLength(7);
  await click("City & State");
  expect(container.textContent).toContain("Chicago, Illinois");
  await click("Class Types");
  await change(container.querySelector('input[aria-label="New class type"]'), "Weekend");
  await click("Add");
  expect(savedLists.classTypes).toEqual(["Evening", "Weekend"]);
  await click("Program Types");
  await change(container.querySelector('input[aria-label="New program type"]'), "Diploma");
  await click("Add");
  expect(savedLists.programTypes).toEqual(["Certificate", "Diploma"]);
});

test("duplicate names are rejected and failed saves retain input", async () => {
  await render(<LeadsStatusManager />);
  await click("City & State");
  const input = container.querySelector('input[aria-label="New city & state"]');
  await change(input, " chicago, illinois ");
  await click("Add");
  expect(setDoc).not.toHaveBeenCalled();
  await change(input, "Evanston");
  setDoc.mockRejectedValueOnce(new Error("permission denied"));
  const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  await click("Add");
  expect(input.value).toBe("Evanston");
  expect(toast.error).toHaveBeenCalledWith("Failed to save city & state");
  consoleError.mockRestore();
});

test("class instances are filtered by type and saved with schedule details on new leads", async () => {
  savedLists.classTypes = ["Evening", "Weekend"];
  savedLists.classInstances = [classInstance,
    { ...classInstance, id: "winter", name: "Winter Cohort", startDate: "2027-01-11" },
    { ...classInstance, id: "weekend", name: "Weekend Cohort", classType: "Weekend" },
  ];
  await render(<LeadsPage />);
  await openAddLeadFormFromSearch("Student");
  expect(container.querySelector("#add-lead-classInstanceId")).toBeNull();
  await change(container.querySelector("#add-lead-classType"), "Evening");
  const instanceOptions = container.querySelectorAll(".lead-class-instance-picker input[type=checkbox]");
  expect(instanceOptions).toHaveLength(2);
  expect(container.querySelector(".lead-class-instance-picker").textContent).toContain("Nov 2, 2026");
  expect(container.querySelector(".lead-class-instance-picker").textContent).toContain("8 weeks");
  expect(container.querySelector(".lead-class-instance-picker").textContent).not.toContain("Weekend Cohort");
  await act(async () => Simulate.change(container.querySelector('.lead-class-instance-picker input[value="fall"]'), { target: { checked: true } }));
  await act(async () => Simulate.change(container.querySelector('.lead-class-instance-picker input[value="winter"]'), { target: { checked: true } }));
  await change(container.querySelector('input[placeholder="Lead name"]'), "Student");
  await act(async () => Simulate.submit(container.querySelector("form")));
  expect(addDoc).toHaveBeenCalledWith("churches/test-org/leads", expect.objectContaining({
    classType: "Evening",
    classInstanceIds: ["fall", "winter"],
    classInstances: [
      expect.objectContaining({ id: "fall", classType: "Evening" }),
      expect.objectContaining({ id: "winter", classType: "Evening" }),
    ],
    classInstanceId: "fall",
    classInstance,
  }));
  expect(container.querySelectorAll(".lead-profile-class")).toHaveLength(2);
  expect(container.querySelector("#add-lead-classInstanceId")).toBeNull();
});

test("editing a lead can assign a class instance and changing class type clears it", async () => {
  savedLists.classTypes = ["Evening", "Weekend"];
  savedLists.classInstances = [classInstance];
  await render(<LeadsPage />);
  await click("View Profile");
  await click("Edit");
  const fallInstance = container.querySelector('.lead-class-instance-picker input[value="fall"]');
  expect(fallInstance.checked).toBe(false);
  await act(async () => Simulate.change(fallInstance, { target: { checked: true } }));
  await click("Save");
  expect(updateDoc).toHaveBeenLastCalledWith("churches/test-org/leads/lead-1", expect.objectContaining({
    classInstanceIds: ["fall"], classInstances: [classInstance], classInstanceId: "fall", classInstance,
  }));
  await click("Edit");
  expect(container.querySelector('.lead-class-instance-picker input[value="fall"]').checked).toBe(true);
  await change(container.querySelector("#edit-lead-lead-1-classType"), "Weekend");
  expect(container.querySelector('.lead-class-instance-picker input[value="fall"]')).toBeNull();
  await click("Save");
  expect(updateDoc).toHaveBeenLastCalledWith("churches/test-org/leads/lead-1", expect.objectContaining({
    classType: "Weekend", classInstanceIds: [], classInstances: [], classInstanceId: "", classInstance: null,
  }));
});

test("a lead can be assigned to multiple class instances with separate attendance and payments", async () => {
  const fallInstance = { ...classInstance, programAssignments: [{ programType: "Certificate", price: 300 }] };
  const winterInstance = { ...classInstance, id: "winter", name: "Winter Cohort", startDate: "2027-01-11", programAssignments: [{ programType: "Certificate", price: 500 }] };
  const fallPayment = { id: "fall-payment", classInstanceId: "fall", amount: 25, date: "2026-10-28", method: "Zelle" };
  const winterPayment = { id: "winter-payment", classInstanceId: "winter", amount: 50, date: "2027-01-12", method: "Cash" };
  savedLists.classInstances = [fallInstance, winterInstance];
  availableLeadRecords = [{
    ...lead,
    id: "lead-1",
    programType: "Certificate",
    classInstanceId: "fall",
    classInstance: fallInstance,
    classPaymentHistory: [fallPayment, winterPayment],
  }];
  classAttendanceRecords = [
    { id: "classAttendance_fall_1", classInstanceId: "fall", week: 1, attendance: { "lead-1": { present: true } } },
    { id: "classAttendance_winter_1", classInstanceId: "winter", week: 1, attendance: { "lead-1": { present: false } } },
  ];
  await render(<LeadsPage />);
  await click("View Profile");
  await click("Edit");

  const winterCheckbox = container.querySelector('.lead-class-instance-picker input[value="winter"]');
  await act(async () => Simulate.change(winterCheckbox, { target: { checked: true } }));
  await click("Save");

  expect(updateDoc).toHaveBeenLastCalledWith("churches/test-org/leads/lead-1", expect.objectContaining({
    classInstanceIds: ["fall", "winter"],
    classInstances: [
      expect.objectContaining({ id: "fall", classType: "Evening" }),
      expect.objectContaining({ id: "winter", classType: "Evening" }),
    ],
  }));
  const classCards = container.querySelectorAll(".lead-profile-class");
  expect(classCards).toHaveLength(2);
  expect(container.querySelector('[aria-label="Payments for Fall Cohort"]').textContent).toContain("$25.00 · 2026-10-28 · Zelle");
  expect(container.querySelector('[aria-label="Payments for Fall Cohort"]').textContent).toContain("Balance due: $275.00");
  expect(container.querySelector('[aria-label="Payments for Winter Cohort"]').textContent).toContain("$50.00 · 2027-01-12 · Cash");
  expect(container.querySelector('[aria-label="Payments for Winter Cohort"]').textContent).toContain("Balance due: $450.00");
  expect(container.querySelector('[aria-label="Attendance report for Fall Cohort"]').textContent).toContain("Present 1 of 8 weeks");
  expect(container.querySelector('[aria-label="Attendance report for Winter Cohort"]').textContent).toContain("Present 0 of 8 weeks");
});

test("deleted instances retain their saved schedule on existing leads", async () => {
  await render(<LeadsPage />);
  await act(async () => listeners["churches/test-org/leads"]({ docs: [{ id: "lead-1", data: () => ({ ...lead, classInstanceId: "fall", classInstance }) }] }));
  expect(container.textContent).toContain("Fall Cohort - Nov 2, 2026 (8 weeks)");
  await click("View Profile");
  await click("Edit");
  expect(container.querySelector('.lead-class-instance-picker input[value="fall"]').checked).toBe(true);
  await click("Save");
  expect(updateDoc).toHaveBeenLastCalledWith("churches/test-org/leads/lead-1", expect.objectContaining({
    classInstanceIds: ["fall"], classInstances: [classInstance], classInstanceId: "fall", classInstance,
  }));
});

test("class instance manager supports multiple cohorts, edit and delete", async () => {
  savedLists.classInstances = [classInstance];
  await render(<LeadClassInstances organizationId="test-org" classTypes={["Evening"]} mode="manage" />);
  await change(container.querySelector("#class-instance-name"), "Winter Cohort");
  await change(container.querySelector("#class-instance-type"), "Evening");
  await change(container.querySelector("#class-instance-start"), "2027-01-11");
  await change(container.querySelector("#class-instance-weeks"), "12");
  await click("Add Instance");
  expect(savedLists.classInstances).toHaveLength(2);
  expect(savedLists.classInstances[1]).toEqual({ id: "new-instance", name: "Winter Cohort", classType: "Evening", startDate: "2027-01-11", totalWeeks: 12, programAssignments: [] });
  await click("Edit Instance");
  await change(container.querySelector("#class-instance-weeks"), "10");
  await click("Save Instance");
  expect(savedLists.classInstances[0].totalWeeks).toBe(10);
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
  await click("Delete Instance");
  expect(savedLists.classInstances).toHaveLength(1);
  expect(savedLists.classInstances[0].name).toBe("Winter Cohort");
  confirm.mockRestore();
});

test("class instances save program types with prices and preserve them when edited", async () => {
  savedLists.classInstances = [{ ...classInstance, programAssignments: [] }];
  await render(<LeadClassInstances organizationId="test-org" classTypes={["Evening"]} mode="manage" />);

  await click("Edit Instance");
  await click("Add Program Type");
  await change(container.querySelector("#class-program-type-0"), "Certificate");
  await change(container.querySelector("#class-program-price-0"), "249.50");
  await click("Save Instance");
  expect(savedLists.classInstances[0].programAssignments).toEqual([{ programType: "Certificate", price: 249.5 }]);

  await click("Edit Instance");
  expect(container.querySelector("#class-program-type-0").value).toBe("Certificate");
  expect(container.querySelector("#class-program-price-0").value).toBe("249.5");
  await change(container.querySelector("#class-program-price-0"), "275");
  await click("Save Instance");
  expect(savedLists.classInstances[0].programAssignments).toEqual([{ programType: "Certificate", price: 275 }]);
});

test("class instance validation rejects invalid dates and non-positive or fractional weeks", () => {
  expect(isValidClassInstance(classInstance)).toBe(true);
  for (const invalid of [{ startDate: "2026-02-30" }, { startDate: "" }, { totalWeeks: 0 }, { totalWeeks: -2 }, { totalWeeks: 2.5 }, { classType: "" }, { name: " " }]) {
    expect(isValidClassInstance({ ...classInstance, ...invalid })).toBe(false);
  }
});

test("failed class instance saves retain form entries", async () => {
  await render(<LeadClassInstances organizationId="test-org" classTypes={["Evening"]} mode="manage" />);
  await change(container.querySelector("#class-instance-name"), "Spring Cohort");
  await change(container.querySelector("#class-instance-type"), "Evening");
  await change(container.querySelector("#class-instance-start"), "2027-04-05");
  await change(container.querySelector("#class-instance-weeks"), "8");
  setDoc.mockRejectedValueOnce(new Error("permission denied"));
  await click("Add Instance");
  expect(container.querySelector("#class-instance-name").value).toBe("Spring Cohort");
  expect(toast.error).toHaveBeenCalledWith("Failed to save class instances");
});

test("dedicated roster and management tabs are separate from class types", async () => {
  savedLists.classInstances = [classInstance];
  await render(<LeadsStatusManager />);
  await click("Class Instances");
  expect(container.querySelector("#class-instance-roster")).not.toBeNull();
  expect(container.querySelector("#class-instance-name")).toBeNull();
  expect(container.querySelector('input[aria-label="New class type"]')).toBeNull();
  await click("Create a Class");
  expect(container.querySelector("#class-instance-roster")).toBeNull();
  expect(container.querySelector("#class-instance-name")).not.toBeNull();
  await click("Class Types");
  expect(container.querySelector("#class-instance-roster")).toBeNull();
  expect(container.querySelector('input[aria-label="New class type"]')).not.toBeNull();
});

test("selecting an instance shows only assigned leads with contact details and status", async () => {
  savedLists.classInstances = [classInstance, { ...classInstance, id: "winter", name: "Winter Cohort" }];
  rosterLeads = [
    { ...lead, id: "fall-student", name: "Fall Student", status: "Qualified", classInstanceId: "fall" },
    { ...lead, id: "winter-student", name: "Winter Student", classInstanceId: "winter" },
  ];
  await render(<LeadClassInstances organizationId="test-org" classTypes={["Evening"]} />);
  await change(container.querySelector("#class-instance-roster"), "fall");
  expect(where).toHaveBeenCalledWith("classInstanceId", "==", "fall");
  const roster = container.querySelector('[aria-label="Assigned leads"]');
  expect(roster.textContent).toContain("Fall Student");
  expect(roster.textContent).toContain("Qualified");
  expect(roster.textContent).toContain("1 assigned lead");
  expect(roster.textContent).not.toContain("Winter Student");
  expect(roster.querySelector('a[href="/organization/test-org/leads?leadId=fall-student"]')).not.toBeNull();
  expect(roster.querySelector('a[href="tel:5551234567"]')).not.toBeNull();
  expect(roster.querySelector('a[href="mailto:lead@example.com"]')).not.toBeNull();
  await change(container.querySelector("#class-instance-roster"), "winter");
  expect(roster.textContent).toContain("Winter Student");
  expect(roster.textContent).not.toContain("Fall Student");
});

test("instance roster handles empty classes and realtime reassignment", async () => {
  savedLists.classInstances = [classInstance];
  await render(<LeadClassInstances organizationId="test-org" classTypes={["Evening"]} />);
  await change(container.querySelector("#class-instance-roster"), "fall");
  const roster = container.querySelector('[aria-label="Assigned leads"]');
  expect(roster.textContent).toContain("No leads assigned");
  await act(async () => listeners["churches/test-org/leads?fall"]({ docs: [{ id: "lead-1", data: () => lead }] }));
  expect(roster.textContent).toContain("Sample Lead");
  await act(async () => listeners["churches/test-org/leads?fall"]({ docs: [] }));
  expect(roster.textContent).toContain("No leads assigned");
});

test("roster read failures show an error instead of an empty class", async () => {
  savedLists.classInstances = [classInstance];
  const defaultListener = onSnapshot.getMockImplementation();
  onSnapshot.mockImplementation((path, callback, onError) => {
    if (path.includes("?")) {
      onError(new Error("permission denied"));
      return jest.fn();
    }
    return defaultListener(path, callback, onError);
  });
  await render(<LeadClassInstances organizationId="test-org" classTypes={["Evening"]} />);
  await change(container.querySelector("#class-instance-roster"), "fall");
  expect(container.querySelector('[aria-label="Assigned leads"]').textContent).toContain("Failed to load assigned leads");
  expect(container.textContent).not.toContain("No leads assigned");
});

test("quick assignment saves the selected lead to the active instance without changing other lead options", async () => {
  savedLists.classInstances = [classInstance];
  await render(<LeadClassInstances organizationId="test-org" classTypes={["Evening"]} />);
  await change(container.querySelector("#class-instance-roster"), "fall");
  await change(container.querySelector("#class-instance-add-lead"), "lead-1");
  await click("Assign Lead");
  expect(updateDoc).toHaveBeenCalledWith("churches/test-org/leads/lead-1", {
    classType: "Evening", classInstanceId: "fall", classInstance, updatedAt: "server-time",
  });
  expect(container.querySelector("#class-instance-add-lead").value).toBe("");
  await act(async () => listeners["churches/test-org/leads?fall"]({ docs: [{ id: "lead-1", data: () => ({ ...lead, classInstanceId: "fall" }) }] }));
  expect(container.querySelector('[aria-label="Class instance leads"]').textContent).toContain("Sample Lead");
});

test("quick assignment excludes leads already in the selected instance and confirms transfers", async () => {
  savedLists.classInstances = [classInstance];
  availableLeadRecords = [
    { ...lead, id: "already", classInstanceId: "fall" },
    { ...lead, id: "transfer", name: "Transfer Lead", classInstanceId: "winter" },
  ];
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
  await render(<LeadClassInstances organizationId="test-org" classTypes={["Evening"]} />);
  await change(container.querySelector("#class-instance-roster"), "fall");
  const selector = container.querySelector("#class-instance-add-lead");
  expect(Array.from(selector.options).map((option) => option.value)).toEqual(["", "transfer"]);
  await change(selector, "transfer");
  await click("Assign Lead");
  expect(confirm).toHaveBeenCalled();
  expect(updateDoc).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  await click("Assign Lead");
  expect(updateDoc).toHaveBeenCalledWith("churches/test-org/leads/transfer", expect.objectContaining({ classInstanceId: "fall" }));
  confirm.mockRestore();
});

test("quick assignment failures keep the selected lead available to retry", async () => {
  savedLists.classInstances = [classInstance];
  await render(<LeadClassInstances organizationId="test-org" classTypes={["Evening"]} />);
  await change(container.querySelector("#class-instance-roster"), "fall");
  await change(container.querySelector("#class-instance-add-lead"), "lead-1");
  updateDoc.mockRejectedValueOnce(new Error("permission denied"));
  await click("Assign Lead");
  expect(container.querySelector("#class-instance-add-lead").value).toBe("lead-1");
  expect(toast.error).toHaveBeenCalledWith("Failed to assign lead to class instance");
});

test("roster shows each lead option in a separate column", async () => {
  savedLists.classInstances = [classInstance];
  rosterLeads = [{ ...lead, id: "lead-1", status: "Qualified", followUp: true, callbackCompleted: false, classInstanceId: "fall" }];
  await render(<LeadClassInstances organizationId="test-org" classTypes={["Evening"]} />);
  await change(container.querySelector("#class-instance-roster"), "fall");
  const table = container.querySelector('[aria-label="Class instance leads"]');
  expect(Array.from(table.querySelectorAll("th")).map((heading) => heading.textContent)).toEqual([
    "Name", "Phone", "Email", "Status", "City & State", "Class Type", "Program Type", "Class Instance", "Start Date", "Total Weeks", "Follow-up", "Callback Time", "Call Status", "Actions",
  ]);
  expect(Array.from(table.querySelectorAll("tbody td")).map((cell) => cell.textContent)).toEqual([
    "Sample Lead", "5551234567", "lead@example.com", "Qualified", "Retired City, Illinois", "Evening", "Certificate", "Fall Cohort", "2026-11-02", "8", "Yes", "14:30", "Upcoming", "Remove",
  ]);
});

test("class selection and its roster stay separate from the management tab", async () => {
  savedLists.classInstances = [classInstance];
  await render(<LeadsStatusManager />);
  await click("Class Instances");
  const selection = container.querySelector('section[aria-labelledby="select-class-instance-heading"]');
  expect(container.querySelector('section[aria-labelledby="manage-class-instances-heading"]')).toBeNull();
  expect(selection.contains(container.querySelector("#class-instance-roster"))).toBe(true);
  expect(selection.querySelector("#class-instance-name")).toBeNull();
  await change(container.querySelector("#class-instance-roster"), "fall");
  expect(selection.querySelector('[aria-label="Assigned leads"]')).not.toBeNull();
  expect(selection.querySelector("#class-instance-add-lead")).not.toBeNull();
  await click("Create a Class");
  const management = container.querySelector('section[aria-labelledby="manage-class-instances-heading"]');
  expect(management.contains(container.querySelector("#class-instance-name"))).toBe(true);
  expect(management.querySelector('[aria-label="Assigned leads"]')).toBeNull();
  await change(container.querySelector("#class-instance-name"), "Unfinished instance");
  await click("Class Instances");
  expect(container.querySelector("#class-instance-name")).toBeNull();
  await click("Create a Class");
  expect(container.querySelector("#class-instance-name").value).toBe("");
});

test("removing a lead clears only the instance assignment and updates the live roster", async () => {
  savedLists.classInstances = [classInstance];
  rosterLeads = [{ ...lead, id: "lead-1", classInstanceId: "fall", classInstance }];
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
  await render(<LeadClassInstances organizationId="test-org" classTypes={["Evening"]} />);
  await change(container.querySelector("#class-instance-roster"), "fall");
  await click("Remove");
  expect(confirm).toHaveBeenCalled();
  expect(updateDoc).toHaveBeenCalledWith("churches/test-org/leads/lead-1", {
    classInstanceId: "", classInstance: null, updatedAt: "server-time",
  });
  expect(deleteDoc).not.toHaveBeenCalled();
  await act(async () => listeners["churches/test-org/leads?fall"]({ docs: [] }));
  expect(container.querySelector('[aria-label="Assigned leads"]').textContent).toContain("No leads assigned");
  expect(toast.success).toHaveBeenCalledWith("Lead removed from class instance");
  confirm.mockRestore();
});

test("canceling removal keeps the lead assigned without writing", async () => {
  savedLists.classInstances = [classInstance];
  rosterLeads = [{ ...lead, id: "lead-1", classInstanceId: "fall" }];
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
  await render(<LeadClassInstances organizationId="test-org" classTypes={["Evening"]} />);
  await change(container.querySelector("#class-instance-roster"), "fall");
  await click("Remove");
  expect(updateDoc).not.toHaveBeenCalled();
  expect(container.querySelector('[aria-label="Class instance leads"]').textContent).toContain("Sample Lead");
  confirm.mockRestore();
});

test("failed removal keeps the roster entry and allows retry", async () => {
  savedLists.classInstances = [classInstance];
  rosterLeads = [{ ...lead, id: "lead-1", classInstanceId: "fall" }];
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
  await render(<LeadClassInstances organizationId="test-org" classTypes={["Evening"]} />);
  await change(container.querySelector("#class-instance-roster"), "fall");
  updateDoc.mockRejectedValueOnce(new Error("permission denied"));
  await click("Remove");
  expect(toast.error).toHaveBeenCalledWith("Failed to remove lead from class instance");
  expect(container.querySelector('[aria-label="Class instance leads"]').textContent).toContain("Sample Lead");
  expect(container.querySelector('button[aria-label="Remove Sample Lead from class instance"]').disabled).toBe(false);
  confirm.mockRestore();
});

test("Attendance tab provides class and week selection separately from instance management", async () => {
  savedLists.classInstances = [classInstance];
  await render(<LeadsStatusManager />);
  await click("Attendance");
  expect(container.querySelector("#attendance-instance")).not.toBeNull();
  expect(container.querySelector("#class-instance-name")).toBeNull();
  await change(container.querySelector("#attendance-instance"), "fall");
  expect(container.querySelectorAll("#attendance-week option")).toHaveLength(9);
});

test("creating an unmatched lead asks for every option and assigns it to the selected instance", async () => {
  const pricedInstance = { ...classInstance, programAssignments: [{ programType: "Certificate", price: 275 }] };
  savedLists.classInstances = [pricedInstance];
  savedLists.programTypes = ["Certificate", "Diploma"];
  savedLists.statuses = ["New", "Contacted", "Qualified"];
  await render(<LeadClassInstances organizationId="test-org" classTypes={["Evening"]} />);
  await change(container.querySelector("#class-instance-roster"), "fall");
  await change(container.querySelector('[aria-label="Lead picker search"]'), "New Student");
  await click("Create picker option");
  expect(container.querySelector("#instance-new-lead-name").value).toBe("New Student");
  expect(container.querySelector("#instance-new-lead-classType").value).toBe("Evening");
  expect(container.querySelector("#instance-new-lead-classType").disabled).toBe(true);
  expect(container.querySelector("#instance-new-lead-classInstanceId").value).toBe("fall");
  expect(container.querySelector("#instance-new-lead-classInstanceId").disabled).toBe(true);
  expect(Array.from(container.querySelector("#instance-new-lead-programType").options).map((option) => option.value)).toEqual(["", "Certificate"]);
  for (const [field, value] of Object.entries({ phone: "5559876543", email: "new@example.com", cityState: "Chicago, Illinois", programType: "Certificate", callbackTime: "11:45", status: "Qualified" })) {
    await change(container.querySelector(`#instance-new-lead-${field}`), value);
  }
  const formSection = container.querySelector('[aria-labelledby="instance-new-lead-heading"]');
  await act(async () => Simulate.change(formSection.querySelector('input[type="checkbox"]'), { target: { checked: true } }));
  await click("Create and Assign Lead");
  expect(addDoc).toHaveBeenCalledWith("churches/test-org/leads", {
    name: "New Student", phone: "5559876543", email: "new@example.com", cityState: "Chicago, Illinois",
    classType: "Evening", programType: "Certificate", callbackTime: "11:45", status: "Qualified", followUp: true,
    classInstanceId: "fall", classInstance, createdBy: "tester", createdByName: "", createdAt: "server-time",
  });
  expect(container.querySelector("#instance-new-lead-name")).toBeNull();
  expect(updateDoc).not.toHaveBeenCalled();
});

test("canceling inline lead creation does not create or assign a lead", async () => {
  savedLists.classInstances = [classInstance];
  await render(<LeadClassInstances organizationId="test-org" classTypes={["Evening"]} />);
  await change(container.querySelector("#class-instance-roster"), "fall");
  await click("Create New Lead");
  await change(container.querySelector("#instance-new-lead-name"), "Canceled Lead");
  await click("Cancel New Lead");
  expect(addDoc).not.toHaveBeenCalled();
  expect(container.querySelector("#instance-new-lead-name")).toBeNull();
});

test("failed inline lead creation retains the entered details for retry", async () => {
  savedLists.classInstances = [classInstance];
  await render(<LeadClassInstances organizationId="test-org" classTypes={["Evening"]} />);
  await change(container.querySelector("#class-instance-roster"), "fall");
  await click("Create New Lead");
  await change(container.querySelector("#instance-new-lead-name"), "Retry Student");
  await change(container.querySelector("#instance-new-lead-email"), "retry@example.com");
  addDoc.mockRejectedValueOnce(new Error("permission denied"));
  await click("Create and Assign Lead");
  expect(container.querySelector("#instance-new-lead-name").value).toBe("Retry Student");
  expect(container.querySelector("#instance-new-lead-email").value).toBe("retry@example.com");
  expect(toast.error).toHaveBeenCalledWith("Failed to create lead");
});

test("inline creation rejects duplicate email and clears the draft when the instance changes", async () => {
  savedLists.classInstances = [classInstance, { ...classInstance, id: "winter", name: "Winter" }];
  await render(<LeadClassInstances organizationId="test-org" classTypes={["Evening"]} />);
  await change(container.querySelector("#class-instance-roster"), "fall");
  await click("Create New Lead");
  await change(container.querySelector("#instance-new-lead-name"), "Duplicate Student");
  await change(container.querySelector("#instance-new-lead-email"), " LEAD@example.com ");
  await click("Create and Assign Lead");
  expect(addDoc).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith("A lead with this email already exists. Select the existing lead instead.");
  await change(container.querySelector("#class-instance-roster"), "winter");
  expect(container.querySelector("#instance-new-lead-name")).toBeNull();
});

test.each(LEAD_MODULE_TABS)("direct URL opens the $label tab", async (tab) => {
  const path = `/organization/test-org/leads/${tab.path}`;
  await render(<LeadsStatusManager />, path);
  const active = container.querySelector('[role="tab"][aria-selected="true"]');
  expect(active.textContent).toBe(tab.label);
  expect(active.getAttribute("href")).toBe(path);
  expect(container.querySelector('[data-testid="current-path"]').textContent).toBe(path);
  const selectors = {
    statuses: 'input[aria-label="New status"]', locations: 'input[aria-label="New city & state"]',
    classTypes: 'input[aria-label="New class type"]', programTypes: 'input[aria-label="New program type"]',
    classInstances: "#class-instance-roster", manageClassInstances: "#class-instance-name", attendance: "#attendance-instance",
  };
  expect(container.querySelector(selectors[tab.id])).not.toBeNull();
  const links = Array.from(container.querySelectorAll('[role="tab"]')).map((element) => element.getAttribute("href"));
  expect(new Set(links).size).toBe(LEAD_MODULE_TABS.length);
});

test("tab navigation updates the URL and follows browser back and forward history", async () => {
  await render(<LeadsStatusManager />);
  await click("Class Types");
  expect(container.querySelector('[data-testid="current-path"]').textContent).toBe("/organization/test-org/leads/class-types");
  await click("Attendance");
  expect(container.querySelector('[data-testid="current-path"]').textContent).toBe("/organization/test-org/leads/attendance");
  await click("Browser Back");
  expect(container.querySelector('[role="tab"][aria-selected="true"]').textContent).toBe("Class Types");
  await click("Browser Back");
  expect(container.querySelector('[role="tab"][aria-selected="true"]').textContent).toBe("Statuses");
  await click("Browser Forward");
  expect(container.querySelector('[role="tab"][aria-selected="true"]').textContent).toBe("Class Types");
});

test("church route aliases preserve their prefix when switching tabs", async () => {
  await render(<LeadsStatusManager />, "/church/test-org/leads/statuses");
  await click("Attendance");
  expect(container.querySelector('[data-testid="current-path"]').textContent).toBe("/church/test-org/leads/attendance");
  expect(container.querySelector('[role="tab"][aria-selected="true"]').textContent).toBe("Attendance");
});

test("unknown tab URLs redirect to the existing statuses page", async () => {
  await render(<LeadsStatusManager />, "/organization/test-org/leads/unknown-tab");
  expect(container.querySelector('[data-testid="current-path"]').textContent).toBe("/organization/test-org/leads/statuses");
  expect(container.querySelector('[role="tab"][aria-selected="true"]').textContent).toBe("Statuses");
});

test("duplicate matching normalizes names, email and phone without matching empty fields", () => {
  const existing = [{ id: "existing", name: "Maria Garcia", phone: "(555) 123-4567", email: "Maria@Example.com" }];
  expect(findDuplicateLead({ name: "  MARIA   Garcia " }, existing)).toEqual({ lead: existing[0], field: "name" });
  expect(findDuplicateLead({ phone: "+1 5551234567" }, existing)).toEqual({ lead: existing[0], field: "phone" });
  expect(findDuplicateLead({ email: " maria@example.COM " }, existing)).toEqual({ lead: existing[0], field: "email" });
  expect(findDuplicateLead({ name: "Different Person", phone: "", email: "" }, existing)).toBeNull();
});