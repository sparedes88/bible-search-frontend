import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { addDoc, onSnapshot, setDoc, updateDoc } from "firebase/firestore";
import { toast } from "react-toastify";
import ClassInstanceAttendance from "./ClassInstanceAttendance";

jest.mock("../firebase", () => ({ db: {} }));
jest.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ user: { uid: "teacher" } }) }));
jest.mock("react-toastify", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
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
  collection: (_database, ...segments) => segments.join("/"),
  doc: (_database, ...segments) => segments.join("/"),
  query: (reference, filter) => `${reference}?${filter.value}`,
  where: (field, operator, value) => ({ field, operator, value }),
  onSnapshot: jest.fn(), setDoc: jest.fn(), addDoc: jest.fn(), updateDoc: jest.fn(), serverTimestamp: () => "server-time",
}));

const base = "churches/test-org/leadsSettings/";
const instances = [
  { id: "fall", name: "Fall Cohort", classType: "Evening", startDate: "2026-11-02", totalWeeks: 3 },
  { id: "winter", name: "Winter Cohort", classType: "Evening", startDate: "2027-01-11", totalWeeks: 2 },
];
const leads = [
  { id: "alice", name: "Alice", email: "alice@example.com", phone: "5551112222" },
  { id: "bob", name: "Bob", email: "bob@example.com", phone: "5553334444" },
];
let rosterLeads;
let container;
let root;
let records;
let listeners;
let availableLeadRecords;

const change = async (selector, value) => {
  await act(async () => Simulate.change(container.querySelector(selector), { target: { value } }));
};
const present = async (name, checked) => {
  await act(async () => Simulate.change(container.querySelector(`input[aria-label="Present: ${name}"]`), { target: { checked } }));
};
const click = async (label) => {
  const button = Array.from(container.querySelectorAll("button")).find((entry) => entry.textContent === label);
  expect(button).toBeDefined();
  await act(async () => {
    if (button.type === "submit") Simulate.submit(button.closest("form"));
    else Simulate.click(button);
  });
};
const render = async () => {
  await act(async () => root.render(<ClassInstanceAttendance organizationId="test-org" />));
  await change("#attendance-instance", "fall");
};

beforeEach(() => {
  jest.clearAllMocks();
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  records = {};
  listeners = {};
  rosterLeads = leads.map((lead) => ({ ...lead, classInstanceId: "fall" }));
  availableLeadRecords = [...leads.map((lead) => ({ ...lead, classInstanceId: "fall" })), { id: "candidate", name: "New Student", email: "student@example.com" }];
  onSnapshot.mockImplementation((path, callback) => {
    listeners[path] = callback;
    if (path === `${base}classInstances`) callback({ data: () => ({ statusList: instances }) });
    else if (path === "churches/test-org/leads") callback({ docs: availableLeadRecords.map((lead) => ({ id: lead.id, data: () => lead })) });
    else if (path === "churches/test-org/leadsSettings") callback({ docs: Object.entries({ classTypes: ["Evening"], programTypes: ["Certificate"], locations: ["Chicago, Illinois"], statuses: ["New", "Contacted"] }).map(([id, statusList]) => ({ id, data: () => ({ statusList }) })) });
    else if (path.includes("/leads?")) callback({ docs: rosterLeads.map((lead) => ({ id: lead.id, data: () => lead })) });
    else callback({ data: () => records[path] });
    return jest.fn();
  });
  setDoc.mockImplementation(async (path, data) => {
    records[path] = { ...records[path], ...data, attendance: { ...records[path]?.attendance, ...data.attendance } };
    listeners[path]?.({ data: () => records[path] });
  });
  updateDoc.mockResolvedValue(undefined);
  addDoc.mockResolvedValue({ id: "created" });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test("attendance lists every class week with its date and assigned leads", async () => {
  await render();
  expect(container.querySelectorAll("#attendance-week option")).toHaveLength(4);
  expect(container.querySelector("#attendance-week").textContent).toContain("Week 2 - Nov 9, 2026");
  expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
  expect(container.textContent).toContain("Alice");
  expect(container.textContent).toContain("Bob");
  expect(container.querySelector('a[href="/organization/test-org/leads?leadId=alice"]')).not.toBeNull();
});

test("presence saves for the chosen instance and week with staff audit details", async () => {
  await render();
  await present("Alice", true);
  expect(setDoc).toHaveBeenCalledWith(`${base}classAttendance_fall_1`, {
    classInstanceId: "fall", className: "Fall Cohort", classType: "Evening", classInstance: instances[0], week: 1,
    attendance: { alice: { present: true, couponReceived: false, amountPaid: 0, programType: "", name: "Alice", phone: "5551112222", email: "alice@example.com", updatedBy: "teacher", updatedAt: "server-time" } },
  }, { merge: true });
  expect(container.querySelector('input[aria-label="Present: Alice"]').checked).toBe(true);
  expect(container.textContent).toContain("1 of 2 present");
});

test("an unchecked coupon marks $35 owed and exposes only one payment checkbox", async () => {
  rosterLeads[0].programType = "Coupon Church 100% Paid";
  await render();
  const coupon = container.querySelector('[aria-label="Coupon received: Alice"]');
  const attendance = container.querySelector('[aria-label="Present: Alice"]');
  expect(coupon).not.toBeNull();
  expect(container.querySelector('[aria-label="Record $35 payment: Alice"]')).toBeNull();
  expect(coupon.closest("td").textContent).toContain("Owes $35");
  expect(attendance.disabled).toBe(false);

  await act(async () => Simulate.change(coupon, { target: { checked: true } }));
  expect(setDoc).toHaveBeenCalledWith(`${base}classAttendance_fall_1`, expect.objectContaining({
    attendance: { alice: expect.objectContaining({ couponReceived: true, amountPaid: 0, present: false }) },
  }), { merge: true });
  expect(attendance.disabled).toBe(false);

  await present("Alice", true);
  expect(setDoc).toHaveBeenLastCalledWith(`${base}classAttendance_fall_1`, expect.objectContaining({
    attendance: { alice: expect.objectContaining({ couponReceived: true, present: true }) },
  }), { merge: true });
});

test("weeks and instances keep separate attendance records", async () => {
  await render();
  await present("Alice", true);
  await change("#attendance-week", "2");
  expect(container.querySelector('input[aria-label="Present: Alice"]').checked).toBe(false);
  await present("Bob", true);
  expect(records[`${base}classAttendance_fall_2`].attendance.bob.present).toBe(true);
  await change("#attendance-week", "1");
  expect(container.querySelector('input[aria-label="Present: Alice"]').checked).toBe(true);
  expect(container.querySelector('input[aria-label="Present: Bob"]').checked).toBe(false);
  await change("#attendance-instance", "winter");
  expect(container.querySelector("#attendance-week").value).toBe("1");
  expect(container.querySelectorAll("#attendance-week option")).toHaveLength(3);
  expect(container.querySelector('input[aria-label="Present: Alice"]').checked).toBe(false);
});

test("unchecking presence does not overwrite attendance for another lead", async () => {
  await render();
  await present("Alice", true);
  await present("Bob", true);
  await present("Alice", false);
  expect(records[`${base}classAttendance_fall_1`].attendance.alice.present).toBe(false);
  expect(records[`${base}classAttendance_fall_1`].attendance.bob.present).toBe(true);
});

test("attendance remains visible after a lead is removed from the instance", async () => {
  await render();
  await present("Alice", true);
  await act(async () => listeners["churches/test-org/leads?fall"]({ docs: [] }));
  expect(container.textContent).toContain("Former assignment");
  expect(container.textContent).toContain("Alice");
  expect(container.querySelector('input[aria-label="Present: Alice"]').checked).toBe(true);
});

test("failed saves keep the stored checkbox state and allow retry", async () => {
  await render();
  setDoc.mockRejectedValueOnce(new Error("permission denied"));
  await present("Alice", true);
  const checkbox = container.querySelector('input[aria-label="Present: Alice"]');
  expect(checkbox.checked).toBe(false);
  expect(checkbox.disabled).toBe(false);
  expect(toast.error).toHaveBeenCalledWith("Failed to save attendance");
});

test("attendance read errors prevent check-in instead of presenting blank records", async () => {
  const original = onSnapshot.getMockImplementation();
  onSnapshot.mockImplementation((path, callback, onError) => {
    if (path.includes("classAttendance_")) {
      onError(new Error("permission denied"));
      return jest.fn();
    }
    return original(path, callback, onError);
  });
  await render();
  expect(container.textContent).toContain("Failed to load attendance");
  expect(container.querySelector('input[type="checkbox"]')).toBeNull();
});

test("View All Weeks displays all weekly checkboxes and per-lead totals together", async () => {
  records[`${base}classAttendance_fall_1`] = { attendance: { alice: { ...leads[0], present: true } } };
  records[`${base}classAttendance_fall_2`] = { attendance: { bob: { ...leads[1], present: true } } };
  records[`${base}classAttendance_fall_3`] = { attendance: { alice: { ...leads[0], present: true } } };
  await render();
  await change("#attendance-week", "all");
  const table = container.querySelector('[aria-label="Weekly class attendance"]');
  expect(Array.from(table.querySelectorAll("th")).map((heading) => heading.textContent)).toEqual([
    "Lead", "Phone", "Week 1Nov 2, 2026", "Week 2Nov 9, 2026", "Week 3Nov 16, 2026", "Present Total",
  ]);
  expect(table.querySelectorAll('input[type="checkbox"]')).toHaveLength(6);
  expect(table.querySelector('input[aria-label="Present: Alice, week 1"]').checked).toBe(true);
  expect(table.querySelector('input[aria-label="Present: Alice, week 2"]').checked).toBe(false);
  expect(table.querySelector('input[aria-label="Present: Bob, week 2"]').checked).toBe(true);
  expect(table.querySelectorAll("tbody tr")[0].lastElementChild.textContent).toBe("2 / 3");
  expect(table.querySelectorAll("tbody tr")[1].lastElementChild.textContent).toBe("1 / 3");
});

test("checking a matrix cell updates only that week and remains correct in single-week mode", async () => {
  await render();
  await present("Alice", true);
  await change("#attendance-week", "all");
  await present("Bob, week 3", true);
  expect(setDoc).toHaveBeenLastCalledWith(`${base}classAttendance_fall_3`, expect.objectContaining({
    classInstanceId: "fall", week: 3, attendance: { bob: expect.objectContaining({ present: true }) },
  }), { merge: true });
  expect(records[`${base}classAttendance_fall_1`].attendance.alice.present).toBe(true);
  await change("#attendance-week", "3");
  expect(container.querySelector('input[aria-label="Present: Bob"]').checked).toBe(true);
  expect(container.querySelector('input[aria-label="Present: Alice"]').checked).toBe(false);
});

test("all weeks includes historical leads recorded in any week", async () => {
  records[`${base}classAttendance_fall_2`] = { attendance: { former: { name: "Former Student", present: true } } };
  await render();
  expect(container.textContent).not.toContain("Former Student");
  await change("#attendance-week", "all");
  expect(container.textContent).toContain("Former Student");
  expect(container.textContent).toContain("Former assignment");
  expect(container.querySelector('input[aria-label="Present: Former Student, week 2"]').checked).toBe(true);
});

test("a failed week read prevents an incomplete all-weeks table from appearing", async () => {
  const original = onSnapshot.getMockImplementation();
  onSnapshot.mockImplementation((path, callback, onError) => {
    if (path === `${base}classAttendance_fall_2`) {
      onError(new Error("permission denied"));
      return jest.fn();
    }
    return original(path, callback, onError);
  });
  await render();
  await change("#attendance-week", "all");
  expect(container.textContent).toContain("Failed to load attendance");
  expect(container.querySelector('[aria-label="Weekly class attendance"]')).toBeNull();
});

test("attendance can quickly enroll an existing lead without recording presence", async () => {
  await render();
  expect(container.querySelector("#class-instance-roster")).toBeNull();
  await change("#class-instance-add-lead", "candidate");
  await click("Assign Lead");
  expect(updateDoc).toHaveBeenCalledWith("churches/test-org/leads/candidate", {
    classType: "Evening", classInstanceId: "fall", classInstance: instances[0], updatedAt: "server-time",
  });
  await act(async () => listeners["churches/test-org/leads?fall"]({ docs: [...leads, { id: "candidate", name: "New Student" }].map((lead) => ({ id: lead.id, data: () => lead })) }));
  expect(container.querySelector('input[aria-label="Present: New Student"]').checked).toBe(false);
  expect(setDoc).not.toHaveBeenCalled();
});

test("attendance can create a lead with all options and assign the selected class", async () => {
  await render();
  await change('[aria-label="Lead picker search"]', "Fresh Enrollment");
  await click("Create picker option");
  expect(container.querySelector("#instance-new-lead-name").value).toBe("Fresh Enrollment");
  expect(container.querySelector("#instance-new-lead-classInstanceId").value).toBe("fall");
  expect(container.querySelector("#instance-new-lead-classInstanceId").disabled).toBe(true);
  for (const [field, value] of Object.entries({ phone: "5559998888", email: "fresh@example.com", cityState: "Chicago, Illinois", programType: "Certificate", callbackTime: "13:30", status: "Contacted" })) {
    await change(`#instance-new-lead-${field}`, value);
  }
  await click("Create and Assign Lead");
  expect(addDoc).toHaveBeenCalledWith("churches/test-org/leads", {
    name: "Fresh Enrollment", phone: "5559998888", email: "fresh@example.com", cityState: "Chicago, Illinois",
    programType: "Certificate", classType: "Evening", classInstanceId: "fall", classInstance: instances[0],
    status: "Contacted", followUp: false, callbackTime: "13:30", createdBy: "teacher", createdByName: "", createdAt: "server-time",
  });
  expect(setDoc).not.toHaveBeenCalled();
  expect(container.querySelector("#instance-new-lead-name")).toBeNull();
});

test("failed attendance enrollment keeps the selected lead and existing attendance", async () => {
  await render();
  await present("Alice", true);
  await change("#class-instance-add-lead", "candidate");
  updateDoc.mockRejectedValueOnce(new Error("permission denied"));
  await click("Assign Lead");
  expect(toast.error).toHaveBeenCalledWith("Failed to assign lead to class instance");
  expect(container.querySelector("#class-instance-add-lead").value).toBe("candidate");
  expect(container.querySelector('input[aria-label="Present: Alice"]').checked).toBe(true);
});

test("class and week selectors are locked while enrollment saves", async () => {
  let finishSave;
  updateDoc.mockImplementationOnce(() => new Promise((resolve) => { finishSave = resolve; }));
  await render();
  await change("#class-instance-add-lead", "candidate");
  await click("Assign Lead");
  expect(container.querySelector("#attendance-instance").disabled).toBe(true);
  expect(container.querySelector("#attendance-week").disabled).toBe(true);
  await act(async () => finishSave());
  expect(container.querySelector("#attendance-instance").disabled).toBe(false);
  expect(container.querySelector("#attendance-week").disabled).toBe(false);
});

test.each([
  ["name", "  ALICE  "],
  ["phone", "+1 (555) 111-2222"],
  ["email", " ALICE@EXAMPLE.COM "],
])("attendance creation blocks an existing person matched by %s", async (field, value) => {
  await render();
  await click("Create New Lead");
  await change("#instance-new-lead-name", "Different Name");
  await change(`#instance-new-lead-${field}`, value);
  const alert = container.querySelector('[aria-labelledby="instance-new-lead-heading"] [role="alert"]');
  expect(alert.textContent).toContain("Existing lead found: Alice");
  expect(alert.textContent).toContain("Already assigned to this class instance");
  const saveButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Create and Assign Lead");
  expect(saveButton.disabled).toBe(true);
  await act(async () => Simulate.submit(saveButton.closest("form")));
  expect(addDoc).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith(`A lead with this ${field} already exists. Select the existing lead instead.`);
});

test("duplicate warning can select the existing unassigned person without creating a copy", async () => {
  await render();
  await click("Create New Lead");
  await change("#instance-new-lead-name", " new   STUDENT ");
  await click("Use Existing Lead");
  expect(container.querySelector("#instance-new-lead-name")).toBeNull();
  expect(container.querySelector("#class-instance-add-lead").value).toBe("candidate");
  await click("Assign Lead");
  expect(updateDoc).toHaveBeenCalledWith("churches/test-org/leads/candidate", expect.objectContaining({ classInstanceId: "fall" }));
  expect(addDoc).not.toHaveBeenCalled();
});