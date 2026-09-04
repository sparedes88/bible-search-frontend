import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { addDoc, collection, doc, getDoc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import commonStyles from "../pages/commonStyles";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

const WEEKS_PER_MONTH = 52 / 12;
const PAGE_SIZE = 15;
const FALLBACK_LOGO = "/img/logo-fallback.svg";

const normalizeValue = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const parseNumber = (value, fallbackValue = 0) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : fallbackValue;
};

const toTimestampMs = (value) => {
  if (value === null || value === undefined) return 0;

  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && numericValue > 0) return numericValue;

  if (typeof value?.toMillis === "function") {
    const millisValue = Number(value.toMillis());
    return Number.isFinite(millisValue) && millisValue > 0 ? millisValue : 0;
  }

  if (typeof value?.seconds === "number") {
    const nanos = typeof value?.nanoseconds === "number" ? value.nanoseconds : 0;
    const secondsValue = value.seconds * 1000 + Math.floor(nanos / 1000000);
    return Number.isFinite(secondsValue) && secondsValue > 0 ? secondsValue : 0;
  }

  if (typeof value === "string") {
    const parsedMs = new Date(value).getTime();
    return Number.isFinite(parsedMs) && parsedMs > 0 ? parsedMs : 0;
  }

  return 0;
};

const toCurrency = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);

const toHours = (milliseconds) => Math.max(0, (Number(milliseconds) || 0) / (1000 * 60 * 60));

const formatDateOnly = (value) => {
  const timestamp = toTimestampMs(value);
  if (!timestamp) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(timestamp));
};

const formatTimeOnly = (value) => {
  const timestamp = toTimestampMs(value);
  if (!timestamp) return "-";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
};

const HOURS_FILTERS = [
  ["this-week", "This Week"],
  ["last-month", "Last Month"],
  ["custom", "Custom Range"],
  ["all", "All Time"],
];

const parseDateInputValue = (value, endOfDay = false) => {
  const normalizedValue = normalizeValue(value);
  if (!normalizedValue) return Number.NaN;
  const parsedDate = Date.parse(`${normalizedValue}T${endOfDay ? "23:59:59.999" : "00:00:00"}`);
  return Number.isFinite(parsedDate) ? parsedDate : Number.NaN;
};

// Week starts on Sunday, matching the rest of the payroll reporting.
const getHoursFilterRange = (filterId, { customStart, customEnd } = {}, referenceDate = new Date()) => {
  if (filterId === "this-week") {
    const start = new Date(referenceDate);
    start.setDate(start.getDate() - start.getDay());
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { startMs: start.getTime(), endMs: end.getTime() };
  }

  if (filterId === "last-month") {
    const start = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 1, 1, 0, 0, 0, 0);
    const end = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1, 0, 0, 0, 0);
    return { startMs: start.getTime(), endMs: end.getTime() };
  }

  if (filterId === "custom") {
    const startMs = parseDateInputValue(customStart);
    const endMs = parseDateInputValue(customEnd, true);
    return {
      startMs: Number.isFinite(startMs) ? startMs : 0,
      endMs: Number.isFinite(endMs) ? endMs : Number.MAX_SAFE_INTEGER,
    };
  }

  return { startMs: 0, endMs: Number.MAX_SAFE_INTEGER };
};

const PAYMENT_METHOD_LABELS = {
  airtm: "Airtm",
  zelle: "Zelle",
  "bank-transfer": "Bank Transfer",
  cash: "Cash",
  other: "Other",
};

const normalizeCompSnapshot = (entry = {}) => ({
  billingType: normalizeValue(entry.billingType) === "salary" ? "salary" : "hourly",
  hourlyRate: parseNumber(entry.hourlyRate),
  monthlySalary: parseNumber(entry.monthlySalary),
  expectedHours: parseNumber(entry.expectedHours),
});

// Compensation history is effective-dated; the newest entry that already started wins.
const resolveEffectiveComp = (settings, referenceTimestamp) => {
  const changeLog = Array.isArray(settings?.changeLog) ? settings.changeLog : [];
  const normalizedLog = changeLog
    .map((entry) => ({
      effectiveFrom: toTimestampMs(entry?.effectiveFrom),
      ...normalizeCompSnapshot(entry),
    }))
    .sort((left, right) => right.effectiveFrom - left.effectiveFrom);

  const matched = normalizedLog.find((entry) => entry.effectiveFrom <= (Number(referenceTimestamp) || 0));
  return matched || normalizedLog[normalizedLog.length - 1] || normalizeCompSnapshot(settings);
};

const getEffectiveHourlyRate = (comp) => {
  if (comp.billingType === "salary") {
    const expectedMonthlyHours = comp.expectedHours > 0 ? comp.expectedHours * WEEKS_PER_MONTH : 0;
    return expectedMonthlyHours > 0 ? comp.monthlySalary / expectedMonthlyHours : 0;
  }
  return comp.hourlyRate;
};

const getAwardPeriodRange = (award) => ({
  startMs: parseDateInputValue(award?.startDate),
  endMs: parseDateInputValue(award?.endDate, true),
});

const getZonedDateParts = (timestamp, timeZone) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone || "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    dateKey: `${values.year}-${values.month}-${values.day}`,
    weekday: values.weekday.slice(0, 3),
    minutes: (Number(values.hour) * 60) + Number(values.minute),
  };
};

const calculateAwardMetrics = (logs, compensation, award) => {
  const { startMs, endMs } = getAwardPeriodRange(award);
  const periodLogs = (Array.isArray(logs) ? logs : []).filter((entry) => {
    const timestamp = Number(entry.startedAt) || Number(entry.endedAt) || 0;
    return timestamp >= startMs && timestamp <= endMs;
  });
  const totalHours = periodLogs.reduce((sum, entry) => sum + (parseNumber(entry.durationMs) / 3600000), 0);
  const schedule = compensation?.expectedSchedule || {};
  const timeZone = compensation?.scheduleTimezone || "America/New_York";
  const earliestByDay = new Map();
  periodLogs.forEach((entry) => {
    const timestamp = Number(entry.startedAt) || Number(entry.endedAt) || 0;
    if (!timestamp) return;
    const zoned = getZonedDateParts(timestamp, timeZone);
    const existing = earliestByDay.get(zoned.dateKey);
    if (!existing || timestamp < existing.timestamp) earliestByDay.set(zoned.dateKey, { timestamp, zoned });
  });
  let onTimeDays = 0;
  earliestByDay.forEach(({ zoned }) => {
    const expectedTime = String(schedule[zoned.weekday] || "07:00");
    const [hours, minutes] = expectedTime.split(":").map(Number);
    if (zoned.minutes <= ((hours || 0) * 60) + (minutes || 0)) onTimeDays += 1;
  });
  const trackedDays = earliestByDay.size;
  return {
    totalHours,
    trackedDays,
    onTimeDays,
    onTimeRate: trackedDays > 0 ? (onTimeDays / trackedDays) * 100 : 0,
  };
};

const formatCompensationDate = (value) => {
  const timestamp = toTimestampMs(value);
  if (!timestamp) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(timestamp));
};

const mergeById = (previousList, incomingDocs) => {
  const merged = new Map(previousList.map((entry) => [entry.id, entry]));
  incomingDocs.forEach((entry) => merged.set(entry.id, entry));
  return Array.from(merged.values());
};

const cardStyle = {
  padding: "14px",
  border: "1px solid #E2E8F0",
  borderRadius: "10px",
  backgroundColor: "#FFFFFF",
};

const thStyle = {
  textAlign: "left",
  padding: "10px 14px",
  borderBottom: "1px solid #E2E8F0",
  color: "#475569",
  fontSize: "0.78rem",
  textTransform: "uppercase",
  letterSpacing: "0.03em",
};

const tdStyle = {
  padding: "11px 14px",
  borderBottom: "1px solid #F1F5F9",
  color: "#334155",
};

const filterLabelStyle = {
  display: "block",
  fontWeight: 700,
  fontSize: "0.78rem",
  color: "#475569",
  marginBottom: "4px",
};

const PIE_COLORS = [
  "#00C2A8",
  "#2F80FF",
  "#FFB020",
  "#9B5CFF",
  "#FF4D9D",
  "#00D26A",
  "#FF7A1A",
  "#00C2E0",
  "#8BD40B",
  "#FF3355",
];

const toHexColor = (red, green, blue) =>
  `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();

const rgbToHsl = (red, green, blue) => {
  const normalizedRed = red / 255;
  const normalizedGreen = green / 255;
  const normalizedBlue = blue / 255;
  const max = Math.max(normalizedRed, normalizedGreen, normalizedBlue);
  const min = Math.min(normalizedRed, normalizedGreen, normalizedBlue);
  const lightness = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) return { hue: 0, saturation: 0, lightness };

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue;
  if (max === normalizedRed) {
    hue = ((normalizedGreen - normalizedBlue) / delta) % 6;
  } else if (max === normalizedGreen) {
    hue = (normalizedBlue - normalizedRed) / delta + 2;
  } else {
    hue = (normalizedRed - normalizedGreen) / delta + 4;
  }

  return { hue: (hue * 60 + 360) % 360, saturation, lightness };
};

const hslToHex = ({ hue, saturation, lightness }) => {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = lightness - chroma / 2;
  const sector = Math.floor(hue / 60) % 6;
  const [red, green, blue] = [
    [chroma, secondary, 0],
    [secondary, chroma, 0],
    [0, chroma, secondary],
    [0, secondary, chroma],
    [secondary, 0, chroma],
    [chroma, 0, secondary],
  ][sector];

  return toHexColor(
    Math.round((red + offset) * 255),
    Math.round((green + offset) * 255),
    Math.round((blue + offset) * 255)
  );
};

// Pushes a brand color to a vivid, high-saturation version so chart slices always read bright.
const brightenColor = (hexColor) => {
  const { hue, saturation, lightness } = rgbToHsl(
    parseInt(hexColor.slice(1, 3), 16),
    parseInt(hexColor.slice(3, 5), 16),
    parseInt(hexColor.slice(5, 7), 16)
  );

  return hslToHex({
    hue,
    saturation: Math.min(1, Math.max(saturation, 0.85)),
    lightness: Math.min(0.62, Math.max(lightness, 0.5)),
  });
};

const rotateHue = (hexColor, degrees) => {
  const { hue, saturation, lightness } = rgbToHsl(
    parseInt(hexColor.slice(1, 3), 16),
    parseInt(hexColor.slice(3, 5), 16),
    parseInt(hexColor.slice(5, 7), 16)
  );

  return hslToHex({ hue: (hue + degrees + 360) % 360, saturation, lightness });
};

// Quantizes the logo and keeps its most vivid colors so charts match the organization branding.
const extractLogoPalette = (imageElement) => {
  const canvas = document.createElement("canvas");
  const sampleSize = 64;
  canvas.width = sampleSize;
  canvas.height = sampleSize;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];

  context.drawImage(imageElement, 0, 0, sampleSize, sampleSize);
  const { data } = context.getImageData(0, 0, sampleSize, sampleSize);
  const buckets = new Map();

  for (let index = 0; index < data.length; index += 4) {
    const [red, green, blue, alpha] = [data[index], data[index + 1], data[index + 2], data[index + 3]];
    if (alpha < 200) continue;

    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const isNearWhite = min > 225;
    const isNearBlack = max < 40;
    const isGray = max - min < 24;
    if (isNearWhite || isNearBlack || isGray) continue;

    const bucketKey = [red, green, blue].map((channel) => Math.round(channel / 32) * 32).join(",");
    const bucket = buckets.get(bucketKey) || { count: 0, red: 0, green: 0, blue: 0 };
    bucket.count += 1;
    bucket.red += red;
    bucket.green += green;
    bucket.blue += blue;
    buckets.set(bucketKey, bucket);
  }

  const candidates = Array.from(buckets.values())
    .filter((bucket) => bucket.count >= 4)
    .map((bucket) => {
      const red = Math.round(bucket.red / bucket.count);
      const green = Math.round(bucket.green / bucket.count);
      const blue = Math.round(bucket.blue / bucket.count);
      const { hue, saturation, lightness } = rgbToHsl(red, green, blue);

      return {
        hue,
        // Favor vivid colors, with a mid lightness bonus so washed-out and muddy tones drop out.
        vividness: saturation * (1 - Math.abs(lightness - 0.55) * 1.2),
        hexColor: brightenColor(toHexColor(red, green, blue)),
      };
    })
    .sort((left, right) => right.vividness - left.vividness);

  const selected = [];
  candidates.forEach((candidate) => {
    if (selected.length >= 6) return;
    const isDistinct = selected.every((entry) => {
      const hueDistance = Math.abs(entry.hue - candidate.hue);
      return Math.min(hueDistance, 360 - hueDistance) > 20;
    });
    if (isDistinct) selected.push(candidate);
  });

  return selected.map((entry) => entry.hexColor);
};

// Repeats the brand colors as hue-rotated variants when there are more slices than brand colors.
const buildChartPalette = (baseColors, requiredCount) => {
  const palette = baseColors.length > 0 ? baseColors : PIE_COLORS;
  const chartColors = [];

  for (let index = 0; index < Math.max(requiredCount, palette.length); index += 1) {
    const baseColor = palette[index % palette.length];
    const cycle = Math.floor(index / palette.length);
    chartColors.push(cycle === 0 ? baseColor : rotateHue(baseColor, cycle * 28));
  }

  return chartColors;
};

const filterInputStyle = {
  padding: "8px 10px",
  border: "1px solid #CBD5E1",
  borderRadius: "8px",
  backgroundColor: "#FFFFFF",
  color: "#334155",
};

const resolveOrganizationLogoUrl = (organization) => {
  const logo = normalizeValue(organization?.logo || organization?.Logo);
  if (!logo) return "";

  if (/^(https?:|data:|blob:)/.test(logo) || logo.startsWith("/img/")) return logo;

  if (logo.startsWith("/")) {
    return `https://firebasestorage.googleapis.com/v0/b/igletechv1.firebasestorage.app/o/${encodeURIComponent(logo.substring(1))}?alt=media`;
  }

  return logo;
};

const getPageSlice = (items, page) => items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

const getPageCount = (itemCount) => Math.max(1, Math.ceil(itemCount / PAGE_SIZE));

const Pagination = ({ page, itemCount, onPageChange }) => {
  const pageCount = getPageCount(itemCount);
  if (itemCount <= PAGE_SIZE) return null;

  const firstItem = (page - 1) * PAGE_SIZE + 1;
  const lastItem = Math.min(page * PAGE_SIZE, itemCount);
  const buttonStyle = (disabled) => ({
    padding: "6px 12px",
    borderRadius: "8px",
    border: "1px solid #CBD5E1",
    backgroundColor: disabled ? "#F1F5F9" : "#FFFFFF",
    color: disabled ? "#94A3B8" : "#334155",
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
  });

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "10px", padding: "10px 14px", color: "#475569", fontWeight: 700 }}>
      <span style={{ fontSize: "0.82rem" }}>
        {firstItem}-{lastItem} of {itemCount}
      </span>
      <button type="button" style={buttonStyle(page <= 1)} disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        Previous
      </button>
      <span style={{ fontSize: "0.82rem" }}>
        Page {page} of {pageCount}
      </span>
      <button type="button" style={buttonStyle(page >= pageCount)} disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
        Next
      </button>
    </div>
  );
};

const MyPayments = () => {
  const { id } = useParams();
  const { user, isGlobalAdmin } = useAuth();

  const userId = normalizeValue(user?.uid);
  const userEmail = normalizeValue(user?.email);
  const canSwitchUsers = typeof isGlobalAdmin === "function" ? isGlobalAdmin() : false;

  const [payments, setPayments] = useState([]);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [timeLogs, setTimeLogs] = useState([]);
  const [compSettings, setCompSettings] = useState(null);
  const [organizationLogo, setOrganizationLogo] = useState("");
  const [logoPalette, setLogoPalette] = useState([]);
  const [hoursFilter, setHoursFilter] = useState("this-week");
  const [projectFilter, setProjectFilter] = useState("all");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [hoursPage, setHoursPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [organizationUsers, setOrganizationUsers] = useState([]);
  const [selectedUserKey, setSelectedUserKey] = useState("");
  const [editingPaymentMethodId, setEditingPaymentMethodId] = useState("");
  const [editingMethodType, setEditingMethodType] = useState("airtm");
  const [editingMethodOther, setEditingMethodOther] = useState("");
  const [editingMethodDetails, setEditingMethodDetails] = useState("");
  const [editingMethodNote, setEditingMethodNote] = useState("");
  const [savingPaymentMethod, setSavingPaymentMethod] = useState(false);
  const [paymentMethodFormOpen, setPaymentMethodFormOpen] = useState(false);
  const [awards, setAwards] = useState([]);
  const [awardClaims, setAwardClaims] = useState([]);
  const [awardLogs, setAwardLogs] = useState([]);
  const [allCompSettings, setAllCompSettings] = useState({});
  const [awardFormOpen, setAwardFormOpen] = useState(false);
  const [savingAward, setSavingAward] = useState(false);
  const [claimingAwardId, setClaimingAwardId] = useState("");
  const [awardDraft, setAwardDraft] = useState({
    name: "",
    description: "",
    conditionType: "most_hours",
    threshold: "",
    startDate: new Date().toISOString().slice(0, 8) + "01",
    endDate: new Date().toISOString().slice(0, 10),
    rewardAmount: "",
  });

  const selectedIdentity = useMemo(() => {
    if (!canSwitchUsers) return { userId, userEmail };
    const selectedUser = organizationUsers.find((entry) => entry.userKey === selectedUserKey);
    return selectedUser
      ? { userId: selectedUser.userId, userEmail: selectedUser.userEmail }
      : { userId, userEmail };
  }, [canSwitchUsers, organizationUsers, selectedUserKey, userEmail, userId]);

  const startEditingPaymentMethod = (method) => {
    setPaymentMethodFormOpen(true);
    setEditingPaymentMethodId(method.id);
    setEditingMethodType(method.methodType || "airtm");
    setEditingMethodOther(method.methodOther || "");
    setEditingMethodDetails(method.details || "");
    setEditingMethodNote(method.note || "");
  };

  const cancelEditingPaymentMethod = () => {
    setPaymentMethodFormOpen(false);
    setEditingPaymentMethodId("");
    setEditingMethodType("airtm");
    setEditingMethodOther("");
    setEditingMethodDetails("");
    setEditingMethodNote("");
  };

  const handleSavePaymentMethod = async (methodId) => {
    if (!editingMethodType || !editingMethodDetails.trim()) return;
    setSavingPaymentMethod(true);
    try {
      const methodData = {
        userId: selectedIdentity.userId,
        userEmail: selectedIdentity.userEmail,
        methodType: editingMethodType,
        methodOther: editingMethodType === "other" ? editingMethodOther.trim() : "",
        details: editingMethodDetails.trim(),
        note: editingMethodNote.trim(),
        updatedAt: Date.now(),
      };
      if (methodId) {
        await updateDoc(doc(db, "churches", id, "payEveryonePaymentMethods", methodId), methodData);
      } else {
        await addDoc(collection(db, "churches", id, "payEveryonePaymentMethods"), methodData);
      }
      cancelEditingPaymentMethod();
    } catch (error) {
      console.error("Failed to update payment method:", error);
      setLoadError("We could not update the payment method. Please try again.");
    } finally {
      setSavingPaymentMethod(false);
    }
  };

  useEffect(() => {
    if (!canSwitchUsers || !id) {
      setOrganizationUsers([]);
      setSelectedUserKey("");
      return undefined;
    }

    return onSnapshot(
      query(collection(db, "users"), where("churchId", "==", id)),
      (snapshot) => {
        const nextUsers = snapshot.docs
          .map((snapshotDoc) => {
            const data = snapshotDoc.data() || {};
            const firstName = normalizeValue(data.firstName || data.name || data.displayName);
            const lastName = normalizeValue(data.lastName || data.surname);
            const fullName = lastName && !firstName.toLowerCase().includes(lastName.toLowerCase())
              ? `${firstName} ${lastName}`.trim()
              : firstName;
            const label = fullName || data.email || snapshotDoc.id;
            return {
              userKey: snapshotDoc.id,
              userId: snapshotDoc.id,
              userEmail: normalizeValue(data.email),
              userLabel: label,
            };
          })
          .sort((left, right) => left.userLabel.localeCompare(right.userLabel));
        setOrganizationUsers(nextUsers);
        setSelectedUserKey((previous) => previous || nextUsers.find((entry) => entry.userId === userId)?.userKey || nextUsers[0]?.userKey || "");
      },
      (error) => console.error("Failed to load users for global admin payment switcher:", error)
    );
  }, [canSwitchUsers, id, userId]);

  useEffect(() => {
    if (!id) return undefined;
    return onSnapshot(collection(db, "churches", id, "payEveryoneAwards"), (snapshot) => {
      setAwards(snapshot.docs.map((awardDoc) => ({ id: awardDoc.id, ...awardDoc.data() }))
        .filter((award) => award.active !== false)
        .sort((left, right) => String(left.endDate || "").localeCompare(String(right.endDate || ""))));
    });
  }, [id]);

  useEffect(() => {
    if (!id || !selectedIdentity.userId) {
      setAwardClaims([]);
      return undefined;
    }
    return onSnapshot(
      query(collection(db, "churches", id, "payEveryoneAwardClaims"), where("userId", "==", selectedIdentity.userId)),
      (snapshot) => setAwardClaims(snapshot.docs.map((claimDoc) => ({ id: claimDoc.id, ...claimDoc.data() })))
    );
  }, [id, selectedIdentity.userId]);

  useEffect(() => {
    if (!canSwitchUsers || !id) {
      setAwardLogs([]);
      setAllCompSettings({});
      return undefined;
    }
    const logUnsubscribe = onSnapshot(collection(db, "churches", id, "timeRotateLogs"), (snapshot) => {
      setAwardLogs(snapshot.docs.map((logDoc) => {
        const data = logDoc.data() || {};
        return { id: logDoc.id, userId: normalizeValue(data.userId), userEmail: normalizeValue(data.userEmail), userLabel: normalizeValue(data.registeredBy || data.userLabel), startedAt: toTimestampMs(data.startedAt), endedAt: toTimestampMs(data.endedAt), durationMs: parseNumber(data.durationMs) };
      }));
    });
    const settingsUnsubscribe = onSnapshot(collection(db, "churches", id, "payEveryoneUserSettings"), (snapshot) => {
      const settings = {};
      snapshot.docs.forEach((settingsDoc) => { settings[settingsDoc.id] = settingsDoc.data() || {}; });
      setAllCompSettings(settings);
    });
    return () => { logUnsubscribe(); settingsUnsubscribe(); };
  }, [canSwitchUsers, id]);

  useEffect(() => {
    if (!id || !selectedIdentity.userId) {
      setPayments([]);
      setLoading(false);
      return () => {};
    }

    setLoading(true);
    const paymentsRef = collection(db, "churches", id, "payEveryonePayments");
    const identityQueries = [query(paymentsRef, where("userId", "==", selectedIdentity.userId))];
    if (selectedIdentity.userEmail) {
      identityQueries.push(query(paymentsRef, where("userEmail", "==", selectedIdentity.userEmail)));
    }

    const perQueryResults = identityQueries.map(() => []);
    const unsubscribes = identityQueries.map((identityQuery, queryIndex) =>
      onSnapshot(
        identityQuery,
        (snapshot) => {
          perQueryResults[queryIndex] = snapshot.docs.map((snapshotDoc) => {
            const data = snapshotDoc.data() || {};
            return {
              id: snapshotDoc.id,
              amount: parseNumber(data.amount),
              paymentDate: normalizeValue(data.paymentDate),
              note: normalizeValue(data.note),
              paymentDateMs: toTimestampMs(data.paymentDate || data.createdAt),
            };
          });

          setPayments(
            perQueryResults
              .reduce((accumulator, entries) => mergeById(accumulator, entries), [])
              .sort((left, right) => (right.paymentDateMs || 0) - (left.paymentDateMs || 0))
          );
          setLoading(false);
        },
        (error) => {
          console.error("Failed to load my payments:", error);
          setLoadError("We could not load your payment history. Please contact an administrator.");
          setLoading(false);
        }
      )
    );

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [id, selectedIdentity.userEmail, selectedIdentity.userId]);

  useEffect(() => {
    if (!id || !selectedIdentity.userId) {
      setPaymentMethods([]);
      return () => {};
    }

    const methodsRef = collection(db, "churches", id, "payEveryonePaymentMethods");
    const identityQueries = [query(methodsRef, where("userId", "==", selectedIdentity.userId))];
    if (selectedIdentity.userEmail) {
      identityQueries.push(query(methodsRef, where("userEmail", "==", selectedIdentity.userEmail)));
    }

    const perQueryResults = identityQueries.map(() => []);
    const unsubscribes = identityQueries.map((identityQuery, queryIndex) =>
      onSnapshot(
        identityQuery,
        (snapshot) => {
          perQueryResults[queryIndex] = snapshot.docs.map((snapshotDoc) => {
            const data = snapshotDoc.data() || {};
            return {
              id: snapshotDoc.id,
              methodType: normalizeValue(data.methodType),
              methodOther: normalizeValue(data.methodOther),
              details: normalizeValue(data.details),
              note: normalizeValue(data.note),
              updatedAt: toTimestampMs(data.updatedAt),
            };
          });

          setPaymentMethods(
            perQueryResults
              .reduce((accumulator, entries) => mergeById(accumulator, entries), [])
              .sort((left, right) => right.updatedAt - left.updatedAt)
          );
        },
        (error) => {
          console.error("Failed to load my payment methods:", error);
        }
      )
    );

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [id, selectedIdentity.userEmail, selectedIdentity.userId]);

  useEffect(() => {
    if (!id || !selectedIdentity.userId) {
      setTimeLogs([]);
      return () => {};
    }

    const unsubscribe = onSnapshot(
      query(collection(db, "churches", id, "timeRotateLogs"), where("userId", "==", selectedIdentity.userId)),
      (snapshot) => {
        setTimeLogs(
          snapshot.docs.map((snapshotDoc) => {
            const data = snapshotDoc.data() || {};
            return {
              id: snapshotDoc.id,
              durationMs: parseNumber(data.durationMs),
              startedAt: toTimestampMs(data.startedAt),
              endedAt: toTimestampMs(data.endedAt),
              issueLabel: normalizeValue(data.issueLabel || data.issueTitle),
              projectName: normalizeValue(data.projectName),
            };
          })
        );
      },
      (error) => {
        console.error("Failed to load my time logs:", error);
      }
    );

    return () => unsubscribe();
  }, [id, selectedIdentity.userId]);

  useEffect(() => {
    if (!id || !selectedIdentity.userId) {
      setCompSettings(null);
      return () => {};
    }

    const unsubscribe = onSnapshot(
      query(collection(db, "churches", id, "payEveryoneUserSettings"), where("userId", "==", selectedIdentity.userId)),
      (snapshot) => {
        const settingsDoc = snapshot.docs[0];
        setCompSettings(settingsDoc ? settingsDoc.data() || {} : {});
      },
      (error) => {
        console.error("Failed to load my compensation settings:", error);
        setCompSettings({});
      }
    );

    return () => unsubscribe();
  }, [id, selectedIdentity.userId]);

  useEffect(() => {
    if (!id) {
      setOrganizationLogo("");
      return () => {};
    }

    let active = true;
    getDoc(doc(db, "churches", id))
      .then((snapshotDoc) => {
        if (!active) return;
        setOrganizationLogo(resolveOrganizationLogoUrl(snapshotDoc.data() || {}));
      })
      .catch((error) => {
        console.error("Failed to load organization logo:", error);
      });

    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    const logoUrl = organizationLogo || FALLBACK_LOGO;
    let active = true;

    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (!active) return;
      try {
        setLogoPalette(extractLogoPalette(image));
      } catch (error) {
        console.warn("Could not read logo colors, using default chart palette:", error);
        setLogoPalette([]);
      }
    };
    image.onerror = () => {
      if (active) setLogoPalette([]);
    };
    image.src = logoUrl;

    return () => {
      active = false;
    };
  }, [organizationLogo]);

  const totals = useMemo(() => {
    const totalMs = timeLogs.reduce((sum, entry) => sum + parseNumber(entry.durationMs), 0);
    const effectiveComp = resolveEffectiveComp(compSettings || {}, Date.now());
    const hourlyRate = getEffectiveHourlyRate(effectiveComp);
    const totalOwed = toHours(totalMs) * hourlyRate;
    const totalPaid = payments.reduce((sum, payment) => sum + parseNumber(payment.amount), 0);

    return {
      totalHours: toHours(totalMs),
      hourlyRate,
      billingType: effectiveComp.billingType,
      totalOwed,
      totalPaid,
      balance: totalOwed - totalPaid,
    };
  }, [compSettings, payments, timeLogs]);

  const projectOptions = useMemo(() => {
    const uniqueProjects = new Set(
      timeLogs.map((entry) => normalizeValue(entry.projectName)).filter(Boolean)
    );
    return Array.from(uniqueProjects).sort((left, right) => left.localeCompare(right));
  }, [timeLogs]);

  const compensationHistory = useMemo(() => {
    const rawHistory = Array.isArray(compSettings?.changeLog) && compSettings.changeLog.length > 0
      ? compSettings.changeLog
      : [{ effectiveFrom: 0, ...compSettings }];
    const entries = rawHistory
      .map((entry) => ({
        effectiveFrom: toTimestampMs(entry?.effectiveFrom),
        ...normalizeCompSnapshot(entry),
      }))
      .sort((left, right) => left.effectiveFrom - right.effectiveFrom);

    return entries.map((entry, index) => {
      const nextEntry = entries[index + 1];
      const endMs = nextEntry?.effectiveFrom ? nextEntry.effectiveFrom - 1 : 0;
      const previousEntry = entries[index - 1];
      const changed = Boolean(previousEntry) && (
        entry.billingType !== previousEntry.billingType
        || entry.hourlyRate !== previousEntry.hourlyRate
        || entry.monthlySalary !== previousEntry.monthlySalary
        || entry.expectedHours !== previousEntry.expectedHours
      );
      return { ...entry, endMs, changed };
    });
  }, [compSettings]);

  const awardRows = useMemo(() => awards.map((award) => {
    const logsForUser = canSwitchUsers
      ? awardLogs.filter((entry) => entry.userId === selectedIdentity.userId || (selectedIdentity.userEmail && entry.userEmail === selectedIdentity.userEmail))
      : timeLogs;
    const metrics = calculateAwardMetrics(logsForUser, compSettings || {}, award);
    let eligible = false;
    if (award.conditionType === "min_hours") eligible = metrics.totalHours >= parseNumber(award.threshold);
    if (award.conditionType === "on_time_rate") {
      const requiredRate = parseNumber(award.threshold) > 0 ? parseNumber(award.threshold) : 100;
      eligible = metrics.onTimeRate >= requiredRate;
    }
    if (award.conditionType === "on_time_days") eligible = metrics.onTimeDays >= parseNumber(award.threshold);
    if (award.conditionType === "most_hours") {
      if (canSwitchUsers) {
        const totalsByUser = organizationUsers.map((entry) => {
          const entryLogs = awardLogs.filter((log) => log.userId === entry.userId || (entry.userEmail && log.userEmail === entry.userEmail));
          const entryComp = allCompSettings[entry.userId] || {};
          return { userId: entry.userId, hours: calculateAwardMetrics(entryLogs, entryComp, award).totalHours };
        });
        const maxHours = Math.max(0, ...totalsByUser.map((entry) => entry.hours));
        eligible = totalsByUser.some((entry) => entry.userId === selectedIdentity.userId && maxHours > 0 && entry.hours === maxHours);
      } else {
        eligible = Array.isArray(award.winnerUserIds) && award.winnerUserIds.includes(selectedIdentity.userId);
      }
    }
    const claimed = awardClaims.some((claim) => claim.awardId === award.id);
    return { ...award, metrics, eligible, claimed };
  }), [allCompSettings, awardClaims, awardLogs, awards, canSwitchUsers, compSettings, organizationUsers, selectedIdentity.userEmail, selectedIdentity.userId, timeLogs]);

  const handleSaveAward = async () => {
    if (!canSwitchUsers || !awardDraft.name.trim() || !awardDraft.startDate || !awardDraft.endDate) return;
    setSavingAward(true);
    try {
      await addDoc(collection(db, "churches", id, "payEveryoneAwards"), {
        name: awardDraft.name.trim(),
        description: awardDraft.description.trim(),
        conditionType: awardDraft.conditionType,
        threshold: parseNumber(awardDraft.threshold),
        startDate: awardDraft.startDate,
        endDate: awardDraft.endDate,
        rewardAmount: parseNumber(awardDraft.rewardAmount),
        active: true,
        createdByUid: userId,
        createdAt: Date.now(),
      });
      setAwardDraft((current) => ({ ...current, name: "", description: "", threshold: "", rewardAmount: "" }));
      setAwardFormOpen(false);
    } finally {
      setSavingAward(false);
    }
  };

  const handleClaimAward = async (award) => {
    if (!award.eligible || award.claimed || claimingAwardId) return;
    setClaimingAwardId(award.id);
    try {
      await addDoc(collection(db, "churches", id, "payEveryoneAwardClaims"), {
        awardId: award.id,
        awardName: award.name,
        rewardAmount: parseNumber(award.rewardAmount),
        userId: selectedIdentity.userId,
        userEmail: selectedIdentity.userEmail,
        userLabel: displayName,
        claimedAt: Date.now(),
      });
    } finally {
      setClaimingAwardId("");
    }
  };

  const dateFilteredTimeLogs = useMemo(() => {
    const { startMs, endMs } = getHoursFilterRange(hoursFilter, { customStart, customEnd });
    return timeLogs.filter((entry) => {
      const referenceMs = entry.startedAt || entry.endedAt;
      return referenceMs >= startMs && referenceMs < endMs;
    });
  }, [customEnd, customStart, hoursFilter, timeLogs]);

  const filteredTimeLogs = useMemo(() => {
    return dateFilteredTimeLogs
      .filter((entry) => projectFilter === "all" || normalizeValue(entry.projectName) === projectFilter)
      .sort((left, right) => (right.startedAt || 0) - (left.startedAt || 0));
  }, [dateFilteredTimeLogs, projectFilter]);

  const hoursByProject = useMemo(() => {
    const totalsByProject = new Map();
    dateFilteredTimeLogs.forEach((entry) => {
      const projectName = normalizeValue(entry.projectName) || "Unassigned";
      totalsByProject.set(projectName, (totalsByProject.get(projectName) || 0) + parseNumber(entry.durationMs));
    });

    return Array.from(totalsByProject.entries())
      .map(([name, durationMs]) => ({ name, hours: Number(toHours(durationMs).toFixed(2)) }))
      .filter((entry) => entry.hours > 0)
      .sort((left, right) => right.hours - left.hours);
  }, [dateFilteredTimeLogs]);

  const filteredHours = useMemo(
    () => toHours(filteredTimeLogs.reduce((sum, entry) => sum + parseNumber(entry.durationMs), 0)),
    [filteredTimeLogs]
  );

  useEffect(() => {
    setHoursPage(1);
  }, [hoursFilter, projectFilter, customStart, customEnd]);

  useEffect(() => {
    setHoursPage((previous) => Math.min(previous, getPageCount(filteredTimeLogs.length)));
  }, [filteredTimeLogs.length]);

  useEffect(() => {
    setPaymentsPage((previous) => Math.min(previous, getPageCount(payments.length)));
  }, [payments.length]);

  const paginatedPayments = useMemo(() => getPageSlice(payments, paymentsPage), [payments, paymentsPage]);
  const paginatedTimeLogs = useMemo(() => getPageSlice(filteredTimeLogs, hoursPage), [filteredTimeLogs, hoursPage]);

  const chartPalette = useMemo(
    () => buildChartPalette(logoPalette, hoursByProject.length),
    [hoursByProject.length, logoPalette]
  );

  const selectedUserRecord = organizationUsers.find((entry) => entry.userKey === selectedUserKey);
  const displayName = canSwitchUsers
    ? selectedUserRecord?.userLabel || selectedIdentity.userEmail || "Selected user"
    : normalizeValue(user?.displayName) || userEmail || "My account";
  const activeFilterLabel = HOURS_FILTERS.find(([filterId]) => filterId === hoursFilter)?.[1] || "";

  if (!userId) {
    return <div style={{ padding: "24px" }}>Sign in to view your payment information.</div>;
  }

  return (
    <div style={{ padding: "20px", maxWidth: "1100px", margin: "0 auto" }}>
      <Link to={`/organization/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to Mi Organizacion
      </Link>

      <div style={{ display: "flex", justifyContent: "center", marginTop: "12px" }}>
        <img
          src={organizationLogo || FALLBACK_LOGO}
          alt="Organization logo"
          style={{ maxHeight: "72px", maxWidth: "220px", objectFit: "contain" }}
          onError={(event) => {
            event.currentTarget.src = FALLBACK_LOGO;
          }}
        />
      </div>

      <div style={{ margin: "16px 0", textAlign: "center" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0F172A", margin: 0 }}>My Payments</h1>
        <div style={{ color: "#64748B", marginTop: "4px" }}>
          Payment history and balance for {displayName}. {canSwitchUsers ? "Global admin view." : "Only your own records are shown."}
        </div>
      </div>

      {canSwitchUsers && (
        <div style={{ ...cardStyle, marginBottom: "16px", borderColor: "#93C5FD", backgroundColor: "#EFF6FF" }}>
          <label htmlFor="my-payments-user-switcher" style={{ display: "block", color: "#1E3A8A", fontWeight: 800, marginBottom: "6px" }}>
            View payments for user
          </label>
          <select
            id="my-payments-user-switcher"
            value={selectedUserKey}
            onChange={(event) => {
              setSelectedUserKey(event.target.value);
              setPaymentsPage(1);
              setHoursPage(1);
            }}
            style={{ width: "100%", maxWidth: "520px", padding: "10px 12px", border: "1px solid #93C5FD", borderRadius: "8px", backgroundColor: "#FFFFFF" }}
          >
            {organizationUsers.map((entry) => (
              <option key={entry.userKey} value={entry.userKey}>{entry.userLabel}</option>
            ))}
          </select>
        </div>
      )}

      {loadError && (
        <div style={{ ...cardStyle, borderColor: "#FCA5A5", backgroundColor: "#FEF2F2", color: "#B91C1C", marginBottom: "16px" }}>
          {loadError}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "20px" }}>
        <div style={cardStyle}>
          <div style={{ color: "#64748B", fontSize: "0.78rem", fontWeight: 700 }}>Total Hours</div>
          <div style={{ color: "#0F172A", fontSize: "1.15rem", fontWeight: 800 }}>{totals.totalHours.toFixed(2)} hrs</div>
        </div>
        <div style={cardStyle}>
          <div style={{ color: "#64748B", fontSize: "0.78rem", fontWeight: 700 }}>
            {totals.billingType === "salary" ? "Effective Rate" : "Hourly Rate"}
          </div>
          <div style={{ color: "#0F172A", fontSize: "1.15rem", fontWeight: 800 }}>{toCurrency(totals.hourlyRate)}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ color: "#64748B", fontSize: "0.78rem", fontWeight: 700 }}>Total Earned</div>
          <div style={{ color: "#0F172A", fontSize: "1.15rem", fontWeight: 800 }}>{toCurrency(totals.totalOwed)}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ color: "#64748B", fontSize: "0.78rem", fontWeight: 700 }}>Total Paid</div>
          <div style={{ color: "#0F172A", fontSize: "1.15rem", fontWeight: 800 }}>{toCurrency(totals.totalPaid)}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ color: "#64748B", fontSize: "0.78rem", fontWeight: 700 }}>Balance Remaining</div>
          <div style={{ color: totals.balance > 0 ? "#B45309" : "#065F46", fontSize: "1.15rem", fontWeight: 800 }}>
            {toCurrency(totals.balance)}
          </div>
        </div>
      </div>

      <div style={{ ...cardStyle, marginBottom: "20px", padding: 0, overflowX: "auto" }}>
        <div style={{ padding: "14px", fontWeight: 800, color: "#0F172A" }}>Compensation History</div>
        <div style={{ padding: "0 14px 10px", color: "#64748B", fontSize: "0.84rem" }}>
          Salary and rate history pulled from Pay Everyone Compensation.
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "760px" }}>
          <thead>
            <tr>
              <th style={thStyle}>Effective From</th>
              <th style={thStyle}>Effective To</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Salary / Rate</th>
              <th style={thStyle}>Expected Hours</th>
              <th style={thStyle}>Change</th>
            </tr>
          </thead>
          <tbody>
            {compensationHistory.length === 0 ? (
              <tr><td style={tdStyle} colSpan={6}>No compensation history found.</td></tr>
            ) : compensationHistory.map((entry, index) => (
              <tr key={`compensation-history-${entry.effectiveFrom}-${index}`}>
                <td style={tdStyle}>{entry.effectiveFrom ? formatCompensationDate(entry.effectiveFrom) : "Before history tracking"}</td>
                <td style={tdStyle}>{entry.endMs ? formatCompensationDate(entry.endMs) : "Current"}</td>
                <td style={tdStyle}>{entry.billingType === "salary" ? "Salary" : "Hourly"}</td>
                <td style={{ ...tdStyle, fontWeight: 700 }}>
                  {entry.billingType === "salary"
                    ? `${toCurrency(entry.monthlySalary)} / month`
                    : `${toCurrency(entry.hourlyRate)} / hour`}
                </td>
                <td style={tdStyle}>{entry.expectedHours || 0} hrs/week</td>
                <td style={tdStyle}>{entry.changed ? "Increased or changed" : index === 0 ? "Starting rate" : "No change"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ ...cardStyle, marginBottom: "20px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "8px" }}>
          <div style={{ fontWeight: 800, color: "#0F172A" }}>Hours by Project</div>
          <div style={{ color: "#64748B", fontSize: "0.82rem", fontWeight: 700 }}>{activeFilterLabel}</div>
        </div>
        {hoursByProject.length === 0 ? (
          <div style={{ color: "#64748B", padding: "12px 0" }}>No hours logged for this period.</div>
        ) : (
          <div style={{ width: "100%", height: "320px" }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={hoursByProject}
                  dataKey="hours"
                  nameKey="name"
                  outerRadius="75%"
                  label={(entry) => `${entry.name}: ${entry.hours.toFixed(2)} hrs`}
                >
                  {hoursByProject.map((entry, index) => (
                    <Cell key={entry.name} fill={chartPalette[index % chartPalette.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => [`${Number(value).toFixed(2)} hrs`, "Hours"]} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div style={{ ...cardStyle, padding: 0, marginBottom: "20px", overflowX: "auto" }}>
        <div style={{ padding: "14px", fontWeight: 800, color: "#0F172A" }}>Payment History</div>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "520px" }}>
          <thead>
            <tr>
              <th style={thStyle}>Payment Date</th>
              <th style={thStyle}>Amount</th>
              <th style={thStyle}>Note</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td style={tdStyle} colSpan={3}>Loading your payments...</td>
              </tr>
            ) : payments.length === 0 ? (
              <tr>
                <td style={tdStyle} colSpan={3}>No payments recorded yet.</td>
              </tr>
            ) : (
              paginatedPayments.map((payment) => (
                <tr key={payment.id}>
                  <td style={tdStyle}>{formatDateOnly(payment.paymentDate || payment.paymentDateMs)}</td>
                  <td style={{ ...tdStyle, fontWeight: 700, color: "#0F172A" }}>{toCurrency(payment.amount)}</td>
                  <td style={tdStyle}>{payment.note || "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <Pagination page={paymentsPage} itemCount={payments.length} onPageChange={setPaymentsPage} />
      </div>

      <div style={{ ...cardStyle, padding: 0, marginBottom: "20px", overflowX: "auto" }}>
        <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
            <div style={{ fontWeight: 800, color: "#0F172A" }}>My Hours Worked</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {HOURS_FILTERS.map(([filterId, label]) => (
                <button
                  key={filterId}
                  type="button"
                  onClick={() => setHoursFilter(filterId)}
                  style={{
                    padding: "7px 12px",
                    borderRadius: "999px",
                    border: `1px solid ${hoursFilter === filterId ? "#0F766E" : "#CBD5E1"}`,
                    backgroundColor: hoursFilter === filterId ? "#0F766E" : "#FFFFFF",
                    color: hoursFilter === filterId ? "#FFFFFF" : "#334155",
                    fontWeight: 700,
                    fontSize: "0.82rem",
                    cursor: "pointer",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "flex-end" }}>
            <div>
              <label style={filterLabelStyle} htmlFor="my-payments-project-filter">Project</label>
              <select
                id="my-payments-project-filter"
                value={projectFilter}
                onChange={(event) => setProjectFilter(event.target.value)}
                style={{ ...filterInputStyle, minWidth: "200px" }}
              >
                <option value="all">All Projects</option>
                {projectOptions.map((projectName) => (
                  <option key={projectName} value={projectName}>
                    {projectName}
                  </option>
                ))}
              </select>
            </div>

            {hoursFilter === "custom" && (
              <>
                <div>
                  <label style={filterLabelStyle} htmlFor="my-payments-start-date">From</label>
                  <input
                    id="my-payments-start-date"
                    type="date"
                    value={customStart}
                    onChange={(event) => setCustomStart(event.target.value)}
                    style={filterInputStyle}
                  />
                </div>
                <div>
                  <label style={filterLabelStyle} htmlFor="my-payments-end-date">To</label>
                  <input
                    id="my-payments-end-date"
                    type="date"
                    value={customEnd}
                    onChange={(event) => setCustomEnd(event.target.value)}
                    style={filterInputStyle}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCustomStart("");
                    setCustomEnd("");
                  }}
                  style={{ ...filterInputStyle, fontWeight: 700, color: "#334155", cursor: "pointer" }}
                >
                  Clear Dates
                </button>
              </>
            )}
          </div>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "640px" }}>
          <thead>
            <tr>
              <th style={thStyle}>Date</th>
              <th style={thStyle}>Start Time</th>
              <th style={thStyle}>End Time</th>
              <th style={thStyle}>Task</th>
              <th style={thStyle}>Total Hours</th>
            </tr>
          </thead>
          <tbody>
            {filteredTimeLogs.length === 0 ? (
              <tr>
                <td style={tdStyle} colSpan={5}>No hours logged for this period.</td>
              </tr>
            ) : (
              paginatedTimeLogs.map((entry) => (
                <tr key={entry.id}>
                  <td style={tdStyle}>{formatDateOnly(entry.startedAt || entry.endedAt)}</td>
                  <td style={tdStyle}>{formatTimeOnly(entry.startedAt)}</td>
                  <td style={tdStyle}>{formatTimeOnly(entry.endedAt)}</td>
                  <td style={tdStyle}>{entry.issueLabel || entry.projectName || "-"}</td>
                  <td style={{ ...tdStyle, fontWeight: 700, color: "#0F172A" }}>{toHours(entry.durationMs).toFixed(2)} hrs</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <Pagination page={hoursPage} itemCount={filteredTimeLogs.length} onPageChange={setHoursPage} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "16px", padding: "12px 14px", color: "#0F172A", fontWeight: 800 }}>
          <div>Entries: {filteredTimeLogs.length}</div>
          <div>Total: {filteredHours.toFixed(2)} hrs</div>
        </div>
      </div>

      <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
        <div style={{ padding: "14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 800, color: "#0F172A" }}>Awards</div>
            <div style={{ color: "#64748B", fontSize: "0.82rem", marginTop: "3px" }}>Awards use the employee's hours and Pay Everyone expected schedule for the award period.</div>
          </div>
          {canSwitchUsers && <button type="button" onClick={() => setAwardFormOpen((current) => !current)} style={{ padding: "7px 10px", border: "1px solid #CBD5E1", borderRadius: "6px", backgroundColor: "#FFFFFF", color: "#334155", fontWeight: 700 }}>{awardFormOpen ? "Close Award Builder" : "Create Award"}</button>}
        </div>
        {canSwitchUsers && awardFormOpen && (
          <div style={{ margin: "0 14px 14px", padding: "12px", border: "1px solid #BFDBFE", borderRadius: "8px", backgroundColor: "#EFF6FF" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "8px" }}>
              <input value={awardDraft.name} onChange={(event) => setAwardDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Award name" style={filterInputStyle} />
              <select value={awardDraft.conditionType} onChange={(event) => setAwardDraft((current) => ({ ...current, conditionType: event.target.value, threshold: event.target.value === "on_time_rate" ? "100" : current.threshold }))} style={filterInputStyle}>
                <option value="most_hours">Most hours worked</option>
                <option value="min_hours">Minimum hours worked</option>
                <option value="on_time_rate">On-time attendance rate</option>
                <option value="on_time_days">On-time attendance days</option>
              </select>
              <input type="number" min="0" max={awardDraft.conditionType === "on_time_rate" ? "100" : undefined} value={awardDraft.threshold} onChange={(event) => setAwardDraft((current) => ({ ...current, threshold: event.target.value }))} placeholder={awardDraft.conditionType === "on_time_rate" ? "Required on-time % (default 100)" : "Threshold (if needed)"} style={filterInputStyle} />
              <input type="number" min="0" step="0.01" value={awardDraft.rewardAmount} onChange={(event) => setAwardDraft((current) => ({ ...current, rewardAmount: event.target.value }))} placeholder="Reward amount (optional)" style={filterInputStyle} />
              <input type="date" value={awardDraft.startDate} onChange={(event) => setAwardDraft((current) => ({ ...current, startDate: event.target.value }))} style={filterInputStyle} />
              <input type="date" value={awardDraft.endDate} onChange={(event) => setAwardDraft((current) => ({ ...current, endDate: event.target.value }))} style={filterInputStyle} />
              <input value={awardDraft.description} onChange={(event) => setAwardDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Description / rules" style={{ ...filterInputStyle, gridColumn: "1 / -1" }} />
            </div>
            <button type="button" onClick={handleSaveAward} disabled={savingAward || !awardDraft.name.trim()} style={{ marginTop: "10px", padding: "7px 11px", border: "none", borderRadius: "6px", backgroundColor: "#0F766E", color: "#FFFFFF", fontWeight: 700 }}>{savingAward ? "Saving..." : "Save Award"}</button>
          </div>
        )}
        <div style={{ padding: "0 14px 14px", display: "grid", gap: "10px" }}>
          {awardRows.length === 0 ? <div style={{ color: "#64748B" }}>No active awards available.</div> : awardRows.map((award) => (
            <div key={award.id} style={{ border: "1px solid #E2E8F0", borderRadius: "8px", padding: "12px", backgroundColor: award.claimed ? "#F8FAFC" : award.eligible ? "#ECFDF5" : "#FFFFFF" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
                <div style={{ fontWeight: 800, color: "#0F172A" }}>{award.name}</div>
                <div style={{ color: "#64748B", fontSize: "0.8rem" }}>{formatCompensationDate(parseDateInputValue(award.startDate))} - {formatCompensationDate(parseDateInputValue(award.endDate, true))}</div>
              </div>
              <div style={{ color: "#475569", fontSize: "0.84rem", marginTop: "4px" }}>{award.description || "No additional rules."}</div>
              <div style={{ color: "#1E3A8A", fontSize: "0.82rem", fontWeight: 700, marginTop: "4px" }}>
                Rule: {award.conditionType === "on_time_rate" ? `100% on time${parseNumber(award.threshold) > 0 && parseNumber(award.threshold) !== 100 ? ` (configured ${parseNumber(award.threshold)}%)` : ""}` : award.conditionType === "on_time_days" ? `${parseNumber(award.threshold)} on-time days` : award.conditionType === "min_hours" ? `${parseNumber(award.threshold)} minimum hours` : "Most hours worked"}
              </div>
              <div style={{ color: "#334155", fontSize: "0.82rem", marginTop: "6px" }}>
                Current result: {award.metrics.totalHours.toFixed(2)} hrs, {award.metrics.onTimeDays} on-time days, {award.metrics.onTimeRate.toFixed(1)}% on time
                {award.rewardAmount ? ` • Reward: ${toCurrency(award.rewardAmount)}` : ""}
              </div>
              <div style={{ marginTop: "8px", fontWeight: 800, color: award.claimed ? "#64748B" : award.eligible ? "#166534" : "#B45309" }}>
                {award.claimed ? "Already cashed in" : award.eligible ? "Eligible" : "Not eligible yet"}
                {award.eligible && !award.claimed && <button type="button" onClick={() => handleClaimAward(award)} disabled={claimingAwardId === award.id} style={{ marginLeft: "10px", padding: "6px 10px", border: "none", borderRadius: "6px", backgroundColor: "#0F766E", color: "#FFFFFF", fontWeight: 700 }}>{claimingAwardId === award.id ? "Processing..." : "Cash In Award"}</button>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
        <div style={{ padding: "14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
          <div style={{ fontWeight: 800, color: "#0F172A" }}>My Payment Methods</div>
          <button
            type="button"
            onClick={() => {
              setEditingPaymentMethodId("");
              setEditingMethodType("airtm");
              setEditingMethodOther("");
              setEditingMethodDetails("");
              setEditingMethodNote("");
              setPaymentMethodFormOpen(true);
            }}
            style={{ padding: "7px 10px", border: "1px solid #CBD5E1", borderRadius: "6px", backgroundColor: "#FFFFFF", color: "#334155", fontWeight: 700, cursor: "pointer" }}
          >
            Add Payment Method
          </button>
        </div>
        {paymentMethodFormOpen && (
          <div style={{ margin: "0 14px 14px", padding: "12px", border: "1px solid #BFDBFE", borderRadius: "8px", backgroundColor: "#EFF6FF" }}>
            <div style={{ color: "#1E3A8A", fontWeight: 800, marginBottom: "8px" }}>{editingPaymentMethodId ? "Edit Payment Method" : "Add Payment Method"}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "8px" }}>
              <select value={editingMethodType} onChange={(event) => setEditingMethodType(event.target.value)} style={filterInputStyle}>
                {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              {editingMethodType === "other" && <input value={editingMethodOther} onChange={(event) => setEditingMethodOther(event.target.value)} placeholder="Other method" style={filterInputStyle} />}
              <input value={editingMethodDetails} onChange={(event) => setEditingMethodDetails(event.target.value)} placeholder="Account details" style={filterInputStyle} required />
              <input value={editingMethodNote} onChange={(event) => setEditingMethodNote(event.target.value)} placeholder="Note (optional)" style={filterInputStyle} />
            </div>
            <div style={{ marginTop: "10px" }}>
              <button type="button" onClick={() => handleSavePaymentMethod(editingPaymentMethodId)} disabled={savingPaymentMethod || !editingMethodDetails.trim()} style={{ marginRight: "6px", padding: "7px 11px", border: "none", borderRadius: "6px", backgroundColor: "#0F766E", color: "#FFFFFF", fontWeight: 700 }}>{savingPaymentMethod ? "Saving..." : editingPaymentMethodId ? "Update" : "Save"}</button>
              <button type="button" onClick={cancelEditingPaymentMethod} style={{ padding: "7px 11px", border: "1px solid #CBD5E1", borderRadius: "6px", backgroundColor: "#FFFFFF", color: "#334155", fontWeight: 700 }}>Cancel</button>
            </div>
          </div>
        )}
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "520px" }}>
          <thead>
            <tr>
              <th style={thStyle}>Method</th>
              <th style={thStyle}>Details</th>
              <th style={thStyle}>Note</th>
              <th style={thStyle}>Updated</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {paymentMethods.length === 0 ? (
              <tr>
                <td style={tdStyle} colSpan={5}>No payment method on file.</td>
              </tr>
            ) : (
              paymentMethods.map((method) => (
                <tr key={method.id}>
                  <td style={tdStyle}>
                    {editingPaymentMethodId === method.id ? (
                      <select value={editingMethodType} onChange={(event) => setEditingMethodType(event.target.value)} style={filterInputStyle}>
                        {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    ) : method.methodType === "other"
                      ? method.methodOther || "Other"
                      : PAYMENT_METHOD_LABELS[method.methodType] || method.methodType || "-"}
                    {editingPaymentMethodId === method.id && editingMethodType === "other" && (
                      <input value={editingMethodOther} onChange={(event) => setEditingMethodOther(event.target.value)} placeholder="Other method" style={{ ...filterInputStyle, marginTop: "6px" }} />
                    )}
                  </td>
                  <td style={tdStyle}>{editingPaymentMethodId === method.id ? <input value={editingMethodDetails} onChange={(event) => setEditingMethodDetails(event.target.value)} style={filterInputStyle} /> : method.details || "-"}</td>
                  <td style={tdStyle}>{editingPaymentMethodId === method.id ? <input value={editingMethodNote} onChange={(event) => setEditingMethodNote(event.target.value)} style={filterInputStyle} /> : method.note || "-"}</td>
                  <td style={tdStyle}>{formatDateOnly(method.updatedAt)}</td>
                  <td style={tdStyle}>
                    {editingPaymentMethodId === method.id ? (
                      <>
                        <button type="button" onClick={() => handleSavePaymentMethod(method.id)} disabled={savingPaymentMethod} style={{ marginRight: "6px", padding: "6px 10px", border: "none", borderRadius: "6px", backgroundColor: "#0F766E", color: "#FFFFFF", fontWeight: 700 }}>{savingPaymentMethod ? "Saving..." : "Save"}</button>
                        <button type="button" onClick={cancelEditingPaymentMethod} style={{ padding: "6px 10px", border: "1px solid #CBD5E1", borderRadius: "6px", backgroundColor: "#FFFFFF", color: "#334155", fontWeight: 700 }}>Cancel</button>
                      </>
                    ) : (
                      <button type="button" onClick={() => startEditingPaymentMethod(method)} style={{ padding: "6px 10px", border: "1px solid #CBD5E1", borderRadius: "6px", backgroundColor: "#FFFFFF", color: "#334155", fontWeight: 700 }}>Edit</button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default MyPayments;
