const assert = require("node:assert/strict");
const test = require("node:test");
const { createPublicLeadPhoneCheckInHandler, getCurrentClassWeek, normalizePhone } = require("./publicLeadPhoneCheckIn");

const createResponse = () => ({
  statusCode: 200,
  payload: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.payload = payload; return this; },
});

const utcDateDaysAgo = (days) => {
  const date = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};

const createHandler = ({ token = "share-token", leads = [], attendance = {} } = {}) => {
  const transactionWrites = [];
  const settings = {
    publicPhoneCheckIn: { token, enabled: true },
    classTypes: { statusList: ["Electrical"] },
    classInstances: { statusList: [{ id: "electrical-oct", name: "Electrical Class Level 01", classType: "Electrical", startDate: utcDateDaysAgo(8), totalWeeks: 8 }] },
  };
  const churchRef = {
    collection(collectionName) {
      if (collectionName === "leads") {
        return {
          get: async () => ({ docs: leads.map((lead, index) => ({ id: `lead-${index + 1}`, data: () => lead })) }),
          doc: (documentId) => ({ id: documentId || "new-lead" }),
        };
      }
      return {
        doc(documentId) {
          return {
            id: documentId,
            get: async () => ({ exists: Boolean(settings[documentId]), data: () => settings[documentId] }),
          };
        },
      };
    },
  };
  const firestore = {
    collection: () => ({ doc: () => churchRef }),
    runTransaction: async (callback) => callback({
      get: async (reference) => ({ data: () => attendance[reference.id] || {} }),
      set: (reference, data, options) => transactionWrites.push({ id: reference.id, data, options }),
    }),
  };
  const firestoreFactory = () => firestore;
  firestoreFactory.FieldValue = { serverTimestamp: () => "server-time" };
  const admin = { firestore: firestoreFactory };
  return { handler: createPublicLeadPhoneCheckInHandler({ admin, handleCors: () => false }), transactionWrites };
};

test("phone normalization handles formatted and US country-code values", () => {
  assert.equal(normalizePhone("+1 (555) 123-4567"), "5551234567");
});

test("current class week follows the schedule start date", () => {
  const startDate = utcDateDaysAgo(8);
  const currentWeek = getCurrentClassWeek({ startDate, totalWeeks: 8 }, "UTC");
  const currentDate = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const expectedWeekStart = new Date(currentDate);
  expectedWeekStart.setUTCDate(expectedWeekStart.getUTCDate() - 1);
  const expectedWeekEnd = new Date(expectedWeekStart);
  expectedWeekEnd.setUTCDate(expectedWeekEnd.getUTCDate() + 6);
  assert.equal(currentWeek.week, 2);
  assert.equal(currentWeek.weekStart, expectedWeekStart.toISOString().slice(0, 10));
  assert.equal(currentWeek.weekEnd, expectedWeekEnd.toISOString().slice(0, 10));
});

test("public bootstrap returns class information without exposing leads", async () => {
  const { handler } = createHandler({ leads: [{ name: "Private Lead", phone: "5551234567", email: "private@example.com" }] });
  const response = createResponse();
  await handler({ method: "POST", body: { churchId: "church-1", token: "share-token", action: "bootstrap", timeZone: "UTC" }, headers: {} }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload.classTypes, ["Electrical"]);
  assert.equal(response.payload.classInstances[0].currentWeek.week, 2);
  assert.equal(JSON.stringify(response.payload).includes("Private Lead"), false);
});

test("phone lookup returns only the matching profile's minimal details", async () => {
  const { handler } = createHandler({ leads: [
    { name: "Private Lead", phone: "(555)123-4567", email: "private@example.com" },
    { name: "Other Lead", phone: "5559876543", email: "other@example.com" },
  ] });
  const response = createResponse();
  await handler({ method: "POST", body: { churchId: "church-1", token: "share-token", action: "lookup", phone: "+1 5551234567" }, headers: { "x-forwarded-for": "198.51.100.10" } }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload.lead, { id: "lead-1", name: "Private Lead", phone: "(555)123-4567" });
  assert.equal(JSON.stringify(response.payload).includes("private@example.com"), false);
});

test("invalid public tokens cannot query organization data", async () => {
  const { handler } = createHandler();
  const response = createResponse();
  await handler({ method: "POST", body: { churchId: "church-1", token: "wrong-token", action: "bootstrap" }, headers: {} }, response);

  assert.equal(response.statusCode, 404);
  assert.equal(response.payload.success, false);
});

test("public check-in records the scheduled week and preserves existing payment values", async () => {
  const { handler, transactionWrites } = createHandler({
    leads: [{ name: "Private Lead", phone: "5551234567", programType: "Certificate" }],
    attendance: {
      "classAttendance_electrical-oct_2": {
        attendance: { "lead-1": { present: false, couponReceived: true, amountPaid: 35, programType: "Certificate" } },
      },
    },
  });
  const response = createResponse();
  await handler({
    method: "POST",
    body: { churchId: "church-1", token: "share-token", action: "checkIn", phone: "5551234567", classInstanceId: "electrical-oct", confirmed: true, timeZone: "UTC" },
    headers: { "x-forwarded-for": "198.51.100.11" },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.week, 2);
  assert.equal(transactionWrites.length, 1);
  assert.equal(transactionWrites[0].id, "classAttendance_electrical-oct_2");
  assert.deepEqual(transactionWrites[0].data.attendance["lead-1"], {
    present: true,
    couponReceived: true,
    amountPaid: 35,
    programType: "Certificate",
    name: "Private Lead",
    phone: "5551234567",
    email: "",
    updatedBy: "public-check-in",
    updatedAt: "server-time",
  });
});

test("public check-in creates a new lead and marks them present transactionally", async () => {
  const { handler, transactionWrites } = createHandler();
  const response = createResponse();
  await handler({
    method: "POST",
    body: { churchId: "church-1", token: "share-token", action: "checkIn", phone: "5557654321", name: "New Student", classInstanceId: "electrical-oct", confirmed: true, timeZone: "UTC" },
    headers: { "x-forwarded-for": "198.51.100.12" },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(transactionWrites.length, 2);
  assert.equal(transactionWrites[0].id, "new-lead");
  assert.equal(transactionWrites[0].data.name, "New Student");
  assert.equal(transactionWrites[1].id, "classAttendance_electrical-oct_2");
  assert.equal(transactionWrites[1].data.attendance["new-lead"].present, true);
});