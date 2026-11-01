const crypto = require("crypto");

const rateLimitBuckets = new Map();
const RATE_WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 90;

const text = (value, maxLength = 200) => String(value || "").trim().slice(0, maxLength);

const normalizePhone = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
};

const getDateInTimeZone = (timeZone) => {
  let dateTimeZone = "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    dateTimeZone = timeZone;
  } catch (error) {
    dateTimeZone = "UTC";
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: dateTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const getCurrentClassWeek = (instance, timeZone = "UTC") => {
  const startDate = text(instance.startDate, 10);
  const totalWeeks = Number(instance.totalWeeks);
  const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
  const startParts = startDate.match(datePattern);
  if (!startParts || !Number.isInteger(totalWeeks) || totalWeeks < 1) {
    return { available: false, message: "This class needs a valid start date and total weeks before check-in." };
  }
  const startTime = Date.UTC(Number(startParts[1]), Number(startParts[2]) - 1, Number(startParts[3]));
  const start = new Date(startTime);
  if (start.getUTCFullYear() !== Number(startParts[1]) || start.getUTCMonth() !== Number(startParts[2]) - 1 || start.getUTCDate() !== Number(startParts[3])) {
    return { available: false, message: "This class needs a valid start date and total weeks before check-in." };
  }
  const today = getDateInTimeZone(timeZone);
  const [year, month, day] = today.split("-").map(Number);
  const daysFromStart = Math.floor((Date.UTC(year, month - 1, day) - startTime) / 86400000);
  if (daysFromStart < 0) return { available: false, message: `This class has not started yet. Check-in opens ${startDate}.` };
  const week = Math.floor(daysFromStart / 7) + 1;
  if (week > totalWeeks) return { available: false, message: "This class has ended; it has no current attendance week." };
  const toDateString = (offset) => {
    const date = new Date(startTime + offset * 86400000);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  };
  const weekStartOffset = (week - 1) * 7;
  return {
    available: true,
    week,
    weekStart: toDateString(weekStartOffset),
    weekEnd: toDateString(weekStartOffset + 6),
  };
};

const findLeadByPhone = async (leadsCollection, normalizedPhone) => {
  const snapshot = await leadsCollection.get();
  const match = snapshot.docs.find((leadDoc) => normalizePhone(leadDoc.data()?.phone) === normalizedPhone);
  return match ? { id: match.id, ...match.data() } : null;
};

const consumeRateLimit = (key) => {
  const now = Date.now();
  let bucket = rateLimitBuckets.get(key);
  if (!bucket || now - bucket.start >= RATE_WINDOW_MS) bucket = { start: now, count: 0 };
  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);
  if (rateLimitBuckets.size > 5000) {
    for (const [bucketKey, value] of rateLimitBuckets) {
      if (now - value.start >= RATE_WINDOW_MS) rateLimitBuckets.delete(bucketKey);
    }
  }
  return bucket.count <= MAX_REQUESTS_PER_WINDOW;
};

const matchesToken = (providedToken, storedToken) => {
  const provided = Buffer.from(providedToken);
  const stored = Buffer.from(storedToken);
  return provided.length === stored.length && crypto.timingSafeEqual(provided, stored);
};

const createPublicLeadPhoneCheckInHandler = ({ admin, handleCors }) => async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Only POST is allowed." });

  const body = typeof req.body === "string" ? (() => {
    try { return JSON.parse(req.body); } catch (error) { return {}; }
  })() : (req.body || {});
  const churchId = text(body.churchId, 128);
  const token = text(body.token, 128);
  const action = text(body.action, 24);
  if (!churchId || !token || !["bootstrap", "lookup", "checkIn"].includes(action)) {
    return res.status(400).json({ success: false, error: "Invalid check-in request." });
  }

  const firestore = admin.firestore();
  const churchRef = firestore.collection("churches").doc(churchId);
  try {
    const configSnapshot = await churchRef.collection("leadsSettings").doc("publicPhoneCheckIn").get();
    const config = configSnapshot.data() || {};
    if (!config.enabled || !config.token || !matchesToken(token, config.token)) {
      return res.status(404).json({ success: false, error: "This public check-in link is unavailable." });
    }

    const forwardedFor = text(req.headers["x-forwarded-for"], 200);
    const requesterIp = text(req.ip || forwardedFor.split(",")[0] || "unknown", 80);
    const rateLimitKey = crypto.createHash("sha256").update(`${token}:${requesterIp}`).digest("hex");
    if (!consumeRateLimit(rateLimitKey)) {
      return res.status(429).json({ success: false, error: "Too many requests. Please try again in a few minutes." });
    }

    const leadsCollection = churchRef.collection("leads");
    if (action === "bootstrap") {
      const [classTypesSnapshot, instancesSnapshot] = await Promise.all([
        churchRef.collection("leadsSettings").doc("classTypes").get(),
        churchRef.collection("leadsSettings").doc("classInstances").get(),
      ]);
      const timeZone = text(body.timeZone, 80) || "UTC";
      const classInstances = (instancesSnapshot.data()?.statusList || []).map((instance) => ({
        id: text(instance.id, 128),
        name: text(instance.name),
        classType: text(instance.classType, 100),
        startDate: text(instance.startDate, 10),
        totalWeeks: Number(instance.totalWeeks) || 0,
        currentWeek: getCurrentClassWeek(instance, timeZone),
      })).filter((instance) => instance.id && instance.classType);
      const classTypes = [...new Set([
        ...(classTypesSnapshot.data()?.statusList || []).map((value) => text(value, 100)),
        ...classInstances.map((instance) => instance.classType),
      ].filter(Boolean))].sort();
      return res.status(200).json({ success: true, classTypes, classInstances });
    }

    const phone = text(body.phone, 40);
    const normalizedPhone = normalizePhone(phone);
    if (normalizedPhone.length < 7 || normalizedPhone.length > 15) {
      return res.status(400).json({ success: false, error: "Enter a valid phone number." });
    }
    const existingLead = await findLeadByPhone(leadsCollection, normalizedPhone);
    if (action === "lookup") {
      return res.status(200).json({
        success: true,
        lead: existingLead ? { id: existingLead.id, name: text(existingLead.name, 120), phone: text(existingLead.phone, 40) } : null,
      });
    }

    if (body.confirmed !== true) return res.status(400).json({ success: false, error: "Confirm the person is here before check-in." });
    if (!existingLead && !text(body.name, 120)) return res.status(400).json({ success: false, error: "A name is required to create a lead." });
    const classInstanceId = text(body.classInstanceId, 128);
    const instancesSnapshot = await churchRef.collection("leadsSettings").doc("classInstances").get();
    const classInstance = (instancesSnapshot.data()?.statusList || []).find((instance) => instance.id === classInstanceId);
    if (!classInstance) return res.status(400).json({ success: false, error: "Select a valid class." });
    const timeZone = text(body.timeZone, 80) || "UTC";
    const currentWeek = getCurrentClassWeek(classInstance, timeZone);
    if (!currentWeek.available) return res.status(400).json({ success: false, error: currentWeek.message });

    const leadRef = existingLead ? leadsCollection.doc(existingLead.id) : leadsCollection.doc();
    const attendanceDocId = `classAttendance_${classInstance.id}_${currentWeek.week}`;
    const attendanceRef = churchRef.collection("leadsSettings").doc(attendanceDocId);
    const serverTimestamp = admin.firestore.FieldValue.serverTimestamp;
    const leadName = existingLead?.name || text(body.name, 120);
    const leadPhone = existingLead?.phone || phone;
    const leadEmail = existingLead?.email || text(body.email, 254);
    const assignment = {
      id: classInstance.id,
      name: text(classInstance.name),
      classType: text(classInstance.classType, 100),
      startDate: text(classInstance.startDate, 10),
      totalWeeks: Number(classInstance.totalWeeks) || 0,
    };

    const result = await firestore.runTransaction(async (transaction) => {
      const attendanceSnapshot = await transaction.get(attendanceRef);
      const attendanceData = attendanceSnapshot.data() || {};
      const currentEntry = attendanceData.attendance?.[leadRef.id] || {};
      if (currentEntry.present) return { alreadyPresent: true };

      if (!existingLead) {
        transaction.set(leadRef, {
          name: leadName,
          phone: leadPhone,
          email: leadEmail,
          status: "New",
          classType: assignment.classType,
          classInstanceId: assignment.id,
          classInstanceIds: [assignment.id],
          classInstance: assignment,
          classInstances: [assignment],
          cityState: "",
          programType: "",
          callbackTime: "",
          createdAt: serverTimestamp(),
          createdBy: "public-check-in",
          createdByName: "Public check-in",
        });
      }

      transaction.set(attendanceRef, {
        classInstanceId: assignment.id,
        className: assignment.name,
        classType: assignment.classType,
        classInstance: assignment,
        week: currentWeek.week,
        attendance: {
          [leadRef.id]: {
            ...currentEntry,
            present: true,
            couponReceived: Boolean(currentEntry.couponReceived),
            amountPaid: Number(currentEntry.amountPaid || 0),
            programType: existingLead?.programType || currentEntry.programType || "",
            name: leadName,
            phone: leadPhone,
            email: leadEmail,
            updatedBy: "public-check-in",
            updatedAt: serverTimestamp(),
          },
        },
      }, { merge: true });
      return { alreadyPresent: false };
    });

    return res.status(200).json({
      success: true,
      alreadyPresent: result.alreadyPresent,
      lead: { id: leadRef.id, name: leadName },
      className: assignment.name,
      week: currentWeek.week,
      weekStart: currentWeek.weekStart,
      weekEnd: currentWeek.weekEnd,
    });
  } catch (error) {
    console.error("Public lead phone check-in failed:", error);
    return res.status(500).json({ success: false, error: "Unable to complete check-in right now." });
  }
};

module.exports = {
  createPublicLeadPhoneCheckInHandler,
  getCurrentClassWeek,
  normalizePhone,
};