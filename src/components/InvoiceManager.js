import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytesResumable } from "firebase/storage";
import { toast } from "react-toastify";
import * as XLSX from "xlsx";
import { useAuth } from "../contexts/AuthContext";
import { db, storage } from "../firebase";
import ChurchHeader from "./ChurchHeader";
import commonStyles from "../pages/commonStyles";
import { canManageModule } from "../utils/enhancedPermissions";
import { getChurchData } from "../api/church";

const FIREBASE_FUNCTIONS_BASE_URL =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "/firebase-api"
    : "https://us-central1-igletechv1.cloudfunctions.net";

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

const getImageDimensions = (dataUrl) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = reject;
    image.src = dataUrl;
  });

const getOrganizationLogoDataUrl = async (churchId) => {
  const churchData = await getChurchData(churchId);
  const logoUrl = String(churchData?.logo || "").trim();
  if (!logoUrl) return "";

  try {
    const response = await fetch(logoUrl, { mode: "cors" });
    if (!response.ok) throw new Error(`Logo fetch failed with status ${response.status}`);
    return await blobToDataUrl(await response.blob());
  } catch (directFetchError) {
    const proxyUrl = `${FIREBASE_FUNCTIONS_BASE_URL}/fetchRemoteImageAsDataUrl?url=${encodeURIComponent(logoUrl)}`;
    const proxyResponse = await fetch(proxyUrl);
    if (!proxyResponse.ok) throw directFetchError;
    const proxyPayload = await proxyResponse.json();
    return String(proxyPayload?.dataUrl || "");
  }
};

const cardStyle = {
  background: "#FFFFFF",
  border: "1px solid #E5E7EB",
  borderRadius: "12px",
  padding: "16px",
};

const inputStyle = {
  width: "100%",
  border: "1px solid #D1D5DB",
  borderRadius: "8px",
  padding: "10px 12px",
  fontSize: "0.95rem",
  boxSizing: "border-box",
};

const fieldLabelStyle = {
  display: "block",
  fontSize: "0.82rem",
  color: "#374151",
  fontWeight: 600,
  marginBottom: "4px",
};

const fieldHintStyle = {
  display: "block",
  marginTop: "4px",
  fontSize: "0.75rem",
  color: "#6B7280",
};

const buttonStyle = {
  border: "none",
  borderRadius: "8px",
  padding: "8px 12px",
  fontWeight: 600,
  cursor: "pointer",
  color: "#FFFFFF",
};

const compactInputStyle = {
  ...inputStyle,
  padding: "6px 8px",
  fontSize: "0.85rem",
  minWidth: 0,
  maxWidth: "100%",
  height: "34px",
};

const compactButtonStyle = {
  ...buttonStyle,
  padding: "6px 10px",
  fontSize: "0.82rem",
  height: "34px",
  whiteSpace: "nowrap",
};

const tableShellStyle = {
  border: "1px solid #E5E7EB",
  borderRadius: "12px",
  overflow: "hidden",
  background: "#FFFFFF",
};

const tableHeaderCellStyle = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "1px solid #E5E7EB",
  background: "#F8FAFC",
  color: "#475569",
  fontSize: "0.76rem",
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

const tableBodyCellStyle = {
  padding: "10px 8px",
  borderBottom: "1px solid #F1F5F9",
  verticalAlign: "middle",
  fontSize: "0.9rem",
  color: "#111827",
};

const toolbarMetricStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "6px 10px",
  borderRadius: "999px",
  background: "#F8FAFC",
  border: "1px solid #E2E8F0",
  fontSize: "0.82rem",
  color: "#334155",
  fontWeight: 600,
};

const BI_PIE_CHART_COLORS = [
  "#2563EB",
  "#0EA5E9",
  "#14B8A6",
  "#22C55E",
  "#84CC16",
  "#EAB308",
  "#F59E0B",
  "#F97316",
  "#EF4444",
  "#EC4899",
  "#A855F7",
  "#6366F1",
];

const INVOICE_TAB_KEYS = ["table", "reconciliation", "td-matcher", "hours-audit", "business-intelligence", "quick-paid"];
const DEFAULT_INVOICE_TAB = "business-intelligence";

const normalizeInvoiceTabKey = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return INVOICE_TAB_KEYS.includes(normalized) ? normalized : DEFAULT_INVOICE_TAB;
};

const getInvoiceTabFromCurrentLocation = () => {
  if (typeof window === "undefined") return DEFAULT_INVOICE_TAB;

  const params = new URLSearchParams(window.location.search || "");
  const tabFromQuery = params.get("invoiceTab") || params.get("tab");
  return normalizeInvoiceTabKey(tabFromQuery);
};

const getInvoiceTabHref = (tabKey) => {
  if (typeof window === "undefined") {
    return `?invoiceTab=${encodeURIComponent(normalizeInvoiceTabKey(tabKey))}`;
  }

  const url = new URL(window.location.href);
  url.searchParams.set("invoiceTab", normalizeInvoiceTabKey(tabKey));
  return `${url.pathname}${url.search}${url.hash}`;
};

const pushInvoiceTabToLocation = (tabKey, { replace = false } = {}) => {
  if (typeof window === "undefined") return;

  const normalizedTab = normalizeInvoiceTabKey(tabKey);
  const nextPath = getInvoiceTabHref(normalizedTab);
  if (replace) {
    window.history.replaceState({}, "", nextPath);
  } else {
    window.history.pushState({}, "", nextPath);
  }
};

const emptyInvoiceDraft = {
  weekNumber: "",
  invoiceNumber: "",
  total: "",
  mondayDate: "",
  dueDate: "",
  paymentTerms: "net30",
  isPaid: false,
  invoiceStatus: "budgeted",
  billingSource: "main_system",
  apStatus: "draft",
};

const BILLING_SOURCE_OPTIONS = [
  { value: "main_system", label: "Main System" },
  { value: "freshbooks", label: "FreshBooks" },
];

const AP_STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "sent_by_email", label: "Sent by Email" },
];

const PAYMENT_TERM_OPTIONS = [
  { value: "net30", label: "Net 30", days: 30 },
  { value: "net60", label: "Net 60", days: 60 },
  { value: "net90", label: "Net 90", days: 90 },
];

const PAYMENT_TERM_DAYS_BY_VALUE = PAYMENT_TERM_OPTIONS.reduce((accumulator, option) => {
  accumulator[option.value] = option.days;
  return accumulator;
}, {});

const PAYMENT_TERM_LABEL_BY_VALUE = PAYMENT_TERM_OPTIONS.reduce((accumulator, option) => {
  accumulator[option.value] = option.label;
  return accumulator;
}, {});

const parseWeekNumber = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const extracted = /^\d+$/.test(raw) ? raw : (raw.match(/(\d+)/)?.[1] || "");
  const parsed = Number(extracted);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : null;
};

const parseMoney = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100) / 100;
};

const parseAmountValue = (value) => {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const isNegativeByParenthesis = /^\(.*\)$/.test(raw);
  const cleaned = raw.replace(/[,$\s]/g, "").replace(/[()]/g, "");
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;

  const signed = isNegativeByParenthesis ? -parsed : parsed;
  return Math.round(signed * 100) / 100;
};

const normalizeInvoiceNumber = (value) => String(value || "").trim().toUpperCase();
const normalizeInvoiceMatchKey = (value) => normalizeInvoiceNumber(value).replace(/[^A-Z0-9]/g, "");
const normalizeInvoiceFuzzyKey = (value) =>
  normalizeInvoiceMatchKey(value)
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");

const isPlaceholderInvoiceNumber = (value) => {
  const normalized = normalizeInvoiceNumber(value);
  if (!normalized) return true;
  return /^W(?:EEK)?[-\s]*\d+$/i.test(normalized) || /^WE\d+$/i.test(normalized);
};

const normalizeInvoiceStatus = (value, fallbackTotal = null, fallbackInvoiceNumber = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "final") return "final";
  if (normalized === "budgeted") return "budgeted";

  const parsedTotal = parseAmountValue(fallbackTotal);
  if (parsedTotal === null || parsedTotal <= 0) return "budgeted";
  if (isPlaceholderInvoiceNumber(fallbackInvoiceNumber)) return "budgeted";
  return "final";
};

const getInvoiceStatusLabel = (value) => {
  const normalized = normalizeInvoiceStatus(value);
  return normalized === "final" ? "Final" : "Budgeted";
};

const normalizeBillingSource = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "freshbooks" ? "freshbooks" : "main_system";
};

const getBillingSourceLabel = (value) => {
  const normalized = normalizeBillingSource(value);
  return normalized === "freshbooks" ? "FreshBooks" : "Main System";
};

const normalizeApStatus = (value) => (
  String(value || "").trim().toLowerCase() === "sent_by_email" ? "sent_by_email" : "draft"
);

const getApStatusLabel = (value) => (
  normalizeApStatus(value) === "sent_by_email" ? "Sent by Email" : "Draft"
);
const normalizeProjectNameKey = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");

const normalizeTimeRotateProjectNames = (value) => {
  const rawValues = Array.isArray(value) ? value : (value ? [value] : []);
  const dedupedByKey = new Map();

  rawValues.forEach((item) => {
    const trimmed = String(item || "").trim().replace(/\s+/g, " ");
    const key = normalizeProjectNameKey(trimmed);
    if (!trimmed || !key || dedupedByKey.has(key)) return;
    dedupedByKey.set(key, trimmed);
  });

  return Array.from(dedupedByKey.values());
};

const formatHoursUsed = (milliseconds) => {
  const safeMilliseconds = Number(milliseconds);
  if (!Number.isFinite(safeMilliseconds) || safeMilliseconds <= 0) return "0h 00m";

  const totalMinutes = Math.round(safeMilliseconds / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
};

const formatPercent = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "0.0%";
  return `${numericValue.toFixed(1)}%`;
};

const BASE_HOURLY_RATE = 90;
const OVERTIME_MULTIPLIER = 1.5;
const OVERTIME_THRESHOLD_HOURS = 40;
const OVERTIME_THRESHOLD_MILLISECONDS = OVERTIME_THRESHOLD_HOURS * 60 * 60 * 1000;
const OVERTIME_RATE = BASE_HOURLY_RATE * OVERTIME_MULTIPLIER;
const OVERTIME_POLICY_LABEL = `OT after ${OVERTIME_THRESHOLD_HOURS}h/user/week @ $${OVERTIME_RATE}/h`;

const convertMillisecondsToHours = (milliseconds) => {
  const safeMilliseconds = Number(milliseconds);
  if (!Number.isFinite(safeMilliseconds) || safeMilliseconds <= 0) return 0;
  return safeMilliseconds / (1000 * 60 * 60);
};

const getLaborCostFromSplit = (regularMilliseconds, overtimeMilliseconds) => {
  const regularHours = convertMillisecondsToHours(regularMilliseconds);
  const overtimeHours = convertMillisecondsToHours(overtimeMilliseconds);
  const totalHours = regularHours + overtimeHours;

  if (totalHours <= 0) {
    return {
      totalHours: 0,
      regularHours: 0,
      overtimeHours: 0,
      regularCost: 0,
      overtimeCost: 0,
      totalCost: 0,
    };
  }

  const regularCost = regularHours * BASE_HOURLY_RATE;
  const overtimeCost = overtimeHours * BASE_HOURLY_RATE * OVERTIME_MULTIPLIER;

  return {
    totalHours,
    regularHours,
    overtimeHours,
    regularCost,
    overtimeCost,
    totalCost: regularCost + overtimeCost,
  };
};

const normalizeIdentityValue = (value) => String(value || "").trim().toLowerCase();
const buildTaskDetailsDocId = (taskIdentity) => (
  String(taskIdentity || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "") || "unknown-task"
);
const getTimeRotateTaskIdentity = (log = {}) => (
  String(log.taskIdentity || `${log.projectDocId || ""}::${log.issueId || log.id || ""}`).trim()
);
const getTimeRotateLogDurationMs = (log = {}) => {
  const durationMs = Number(log.durationMs);
  if (Number.isFinite(durationMs) && durationMs > 0) return durationMs;
  return Math.max(0, (Number(log.endedAt) || 0) - (Number(log.startedAt) || 0));
};

// Prefers a person's full name (first + last) from the org user directory over whatever short name was logged.
const getTimeLogUserLabel = (log = {}, fullNameByIdentityAlias = {}, fullNameByFirstNameOnly = {}) => {
  const aliasMatches = [log.userId, log.userEmail, log.registeredBy]
    .map(normalizeIdentityValue)
    .filter(Boolean);

  for (const alias of aliasMatches) {
    const fullName = fullNameByIdentityAlias[alias];
    if (fullName) return fullName;
  }

  // Some historical logs only stored a first name with no userId/email; if exactly one org
  // member shares that first name, merge into their full name instead of creating a duplicate row.
  const registeredByNormalized = normalizeIdentityValue(log.registeredBy);
  if (registeredByNormalized && fullNameByFirstNameOnly[registeredByNormalized]) {
    return fullNameByFirstNameOnly[registeredByNormalized];
  }

  const byName = String(log.registeredBy || "").trim();
  const byEmail = String(log.userEmail || "").trim();
  const byUid = String(log.userId || "").trim();
  return byName || byEmail || byUid || "Unknown User";
};

const getIsoWeekStartDateKeyFromTimestamp = (timestamp) => {
  const numericTimestamp = Number(timestamp);
  if (!Number.isFinite(numericTimestamp) || numericTimestamp <= 0) return "";

  const date = new Date(numericTimestamp);
  if (Number.isNaN(date.getTime())) return "";

  const day = date.getDay() || 7;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - day + 1);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${dayOfMonth}`;
};

const normalizeHeaderKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const findColumnByAliases = (row = {}, aliases = []) => {
  const keys = Object.keys(row || {});
  if (keys.length === 0) return "";

  const normalizedAliasSet = new Set(aliases.map(normalizeHeaderKey));
  const directMatch = keys.find((key) => normalizedAliasSet.has(normalizeHeaderKey(key)));
  if (directMatch) return directMatch;

  return keys.find((key) => {
    const normalizedKey = normalizeHeaderKey(key);
    return aliases.some((alias) => normalizedKey.includes(normalizeHeaderKey(alias)));
  }) || "";
};

const toIdentityKey = (value) => String(value || "").trim().toLowerCase();

const collectIdentityKeys = (values = []) => {
  const set = new Set();
  values.forEach((value) => {
    const key = toIdentityKey(value);
    if (key) set.add(key);
  });
  return set;
};

const normalizeProjectIssueNotes = (value) => {
  if (!Array.isArray(value)) return [];

  return value
    .map((note) => {
      if (!note || typeof note !== "object") {
        const text = String(note || "").trim();
        return { text, timestamp: 0, createdByUid: "", createdByEmail: "", createdByName: "" };
      }

      const createdAtIso = String(note.createdAtIso || "").trim();
      const parsedTimestamp = createdAtIso ? Date.parse(createdAtIso) : Number.NaN;

      return {
        text: String(note.text || "").trim(),
        timestamp: Number(note.timestamp) || (Number.isFinite(parsedTimestamp) ? parsedTimestamp : 0),
        createdByUid: String(note.createdByUid || "").trim(),
        createdByEmail: String(note.createdByEmail || "").trim(),
        createdByName: String(note.createdByName || "").trim(),
      };
    })
    .filter((note) => note.text);
};

const doesProjectIssueNoteMatchUserIdentity = (note = {}, userIdentityKeys = new Set()) => {
  if (!(userIdentityKeys instanceof Set) || userIdentityKeys.size === 0) return false;

  const noteIdentityKeys = collectIdentityKeys([
    note.createdByUid,
    note.createdByEmail,
    note.createdByName,
  ]);

  if (noteIdentityKeys.size === 0) return false;

  for (const key of noteIdentityKeys) {
    if (userIdentityKeys.has(key)) return true;
  }

  return false;
};

const MAX_RECONCILIATION_DETAIL_ROWS = 500;

const buildMissingInSystemKey = (row = {}) => [
  "missing_in_system",
  normalizeInvoiceFuzzyKey(row.invoiceNumber),
  parseAmountValue(row.total) ?? "",
  String(row.projectName || "").trim().toLowerCase(),
].join("|");

const buildMissingInExcelKey = (row = {}) => [
  "missing_in_excel",
  normalizeInvoiceFuzzyKey(row.invoiceNumber),
  parseAmountValue(row.total) ?? "",
  String(row.projectId || "").trim(),
  String(row.projectName || "").trim().toLowerCase(),
  Number(row.weekNumber || 0) || "",
].join("|");

const getMissingInExcelDiagnostic = (systemRow = {}, excelRows = []) => {
  const importedRows = Array.isArray(excelRows) ? excelRows : [];
  if (importedRows.length === 0) {
    return {
      reason: "No imported Excel rows in this session.",
      details: "This may be a restored saved report. Re-import and compare to validate now.",
    };
  }

  const systemInvoiceRaw = String(systemRow?.invoiceNumber || "").trim();
  const systemInvoiceUpper = normalizeInvoiceNumber(systemInvoiceRaw);
  const systemInvoiceLoose = normalizeInvoiceMatchKey(systemInvoiceRaw);
  const systemInvoiceFuzzy = normalizeInvoiceFuzzyKey(systemInvoiceRaw);

  const caseInsensitiveMatch = importedRows.find(
    (row) => String(row?.invoiceNumber || "").trim().toLowerCase() === systemInvoiceRaw.toLowerCase()
  );
  const looseMatch = importedRows.find(
    (row) => normalizeInvoiceMatchKey(row?.invoiceNumber) === systemInvoiceLoose
  );
  const fuzzyMatch = importedRows.find(
    (row) => normalizeInvoiceFuzzyKey(row?.invoiceNumber) === systemInvoiceFuzzy
  );
  const prefixMatch = importedRows.find((row) =>
    normalizeInvoiceNumber(row?.invoiceNumber).startsWith(systemInvoiceUpper.slice(0, 4))
  );

  if (caseInsensitiveMatch) {
    return {
      reason: "Case-only match found in imported Excel.",
      details: `Excel row ${caseInsensitiveMatch.rowNumber || "-"}: ${caseInsensitiveMatch.invoiceNumber || "-"}`,
    };
  }

  if (looseMatch) {
    return {
      reason: "Format-only match found (spaces/dashes/symbols).",
      details: `Excel row ${looseMatch.rowNumber || "-"}: ${looseMatch.invoiceNumber || "-"}`,
    };
  }

  if (fuzzyMatch) {
    return {
      reason: "Likely O/0 or I/L/1 match found.",
      details: `Excel row ${fuzzyMatch.rowNumber || "-"}: ${fuzzyMatch.invoiceNumber || "-"}`,
    };
  }

  if (prefixMatch) {
    return {
      reason: "No exact invoice number match.",
      details: `Closest prefix candidate: ${prefixMatch.invoiceNumber || "-"} (row ${prefixMatch.rowNumber || "-"})`,
    };
  }

  return {
    reason: "No invoice number match found in imported Excel.",
    details: "Invoice number not present after normalization.",
  };
};

const getMissingInSystemAssignmentKey = (row = {}) => [
  buildMissingInSystemKey(row),
  Number(row.rowNumber || 0) || "",
].join("|");

const toIsoStringFromValue = (value) => {
  if (!value) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  }
  if (typeof value?.toDate === "function") {
    const parsed = value.toDate();
    return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : "";
  }

  return "";
};

const toMillisecondsFromValue = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === "function") return Number(value.toMillis()) || 0;
  if (typeof value?.toDate === "function") return value.toDate().getTime() || 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatLogTimestamp = (value) => {
  const iso = toIsoStringFromValue(value);
  if (!iso) return "-";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
};

const formatCurrency = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "$0.00";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numericValue);
};

const toDateInputValue = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const shiftDateInputValue = (dateInputValue, dayOffset) => {
  const normalized = toDateInputValue(dateInputValue);
  if (!normalized) return "";

  const baseDate = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(baseDate.getTime())) return "";

  baseDate.setDate(baseDate.getDate() + dayOffset);
  const year = baseDate.getFullYear();
  const month = String(baseDate.getMonth() + 1).padStart(2, "0");
  const day = String(baseDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const resolveNetDays = (paymentTerms, explicitNetDays = null) => {
  const explicitDays = Number(explicitNetDays);
  if (Number.isFinite(explicitDays) && explicitDays > 0) {
    return explicitDays;
  }

  const mappedDays = PAYMENT_TERM_DAYS_BY_VALUE[String(paymentTerms || "").trim().toLowerCase()];
  return Number.isFinite(mappedDays) ? mappedDays : 30;
};

const getPaymentTermLabel = (paymentTerms, netDays) => {
  const normalized = String(paymentTerms || "").trim().toLowerCase();
  if (PAYMENT_TERM_LABEL_BY_VALUE[normalized]) {
    return PAYMENT_TERM_LABEL_BY_VALUE[normalized];
  }

  const resolvedNetDays = resolveNetDays(paymentTerms, netDays);
  return `Net ${resolvedNetDays}`;
};

const formatDisplayDate = (value) => {
  const normalized = toDateInputValue(value);
  if (!normalized) return "-";

  const parsed = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "-";

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
};

const formatWeekdayName = (value) => {
  const normalized = toDateInputValue(value);
  if (!normalized) return "-";

  const parsed = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "-";

  return new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(parsed);
};

const isDueOnOrBeforeToday = (value) => {
  const normalized = toDateInputValue(value);
  if (!normalized) return false;

  const dueDate = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(dueDate.getTime())) return false;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return dueDate.getTime() <= today.getTime();
};

const getDueCountdownMeta = (value) => {
  const normalized = toDateInputValue(value);
  if (!normalized) {
    return {
      label: "-",
      textColor: "#6B7280",
      bgColor: "#F9FAFB",
    };
  }

  const dueDate = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(dueDate.getTime())) {
    return {
      label: "-",
      textColor: "#6B7280",
      bgColor: "#F9FAFB",
    };
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const millisPerDay = 24 * 60 * 60 * 1000;
  const dayDelta = Math.round((dueDate.getTime() - today.getTime()) / millisPerDay);

  if (dayDelta < 0) {
    const overdueDays = Math.abs(dayDelta);
    return {
      label: `-${overdueDays}`,
      textColor: "#991B1B",
      bgColor: "#FEE2E2",
    };
  }

  if (dayDelta === 0) {
    return {
      label: "+0",
      textColor: "#065F46",
      bgColor: "#D1FAE5",
    };
  }

  return {
    label: `+${dayDelta}`,
    textColor: "#065F46",
    bgColor: "#D1FAE5",
  };
};

const getStartOfIsoWeek = (dateValue = new Date()) => {
  const baseDate = new Date(dateValue);
  const day = baseDate.getDay() || 7;
  baseDate.setHours(0, 0, 0, 0);
  baseDate.setDate(baseDate.getDate() - day + 1);
  return baseDate;
};

const getIsoWeekNumber = (dateValue = new Date()) => {
  const baseDate = new Date(dateValue);
  baseDate.setHours(0, 0, 0, 0);
  baseDate.setDate(baseDate.getDate() + 4 - (baseDate.getDay() || 7));
  const yearStart = new Date(baseDate.getFullYear(), 0, 1);
  return Math.ceil((((baseDate - yearStart) / 86400000) + 1) / 7);
};

const formatIsoDate = (dateValue) => {
  const year = dateValue.getFullYear();
  const month = String(dateValue.getMonth() + 1).padStart(2, "0");
  const day = String(dateValue.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getWeekDifference = (fromDateValue, toDateValue) => {
  const fromDate = new Date(`${toDateInputValue(fromDateValue)}T00:00:00`);
  const toDate = new Date(`${toDateInputValue(toDateValue)}T00:00:00`);

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return 0;
  }

  const millisPerWeek = 7 * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.round((toDate.getTime() - fromDate.getTime()) / millisPerWeek));
};

const getExpectedWeekMondayDate = (targetWeek, invoiceRows = [], fallbackDate = "") => {
  const targetWeekNumber = Number(targetWeek);
  if (!Number.isFinite(targetWeekNumber) || targetWeekNumber <= 0) {
    return toDateInputValue(fallbackDate) || "";
  }

  const normalizedRows = (Array.isArray(invoiceRows) ? invoiceRows : [])
    .map((invoice) => {
      const weekNumber = Number(invoice?.weekNumber || 0);
      const mondayDate = toDateInputValue(invoice?.mondayDate || invoice?.weekStartDate || "");
      if (!Number.isFinite(weekNumber) || weekNumber <= 0 || !mondayDate) {
        return null;
      }

      return { weekNumber, mondayDate };
    })
    .filter(Boolean)
    .sort((left, right) => left.weekNumber - right.weekNumber);

  if (normalizedRows.length === 0) {
    return toDateInputValue(fallbackDate) || "";
  }

  const latestPreviousWeek = [...normalizedRows]
    .reverse()
    .find((invoice) => invoice.weekNumber <= targetWeekNumber);

  if (!latestPreviousWeek) {
    return toDateInputValue(fallbackDate) || "";
  }

  return shiftDateInputValue(latestPreviousWeek.mondayDate, 7 * (targetWeekNumber - latestPreviousWeek.weekNumber));
};

// Flags when a week's Monday date doesn't land exactly 7 days after the prior week, so gaps/overlaps surface in the UI.
const getWeekSequenceGapInfo = (weekNumber, mondayDate, invoiceRows = [], excludeInvoiceId = null) => {
  const normalizedWeek = Number(weekNumber);
  const normalizedMonday = toDateInputValue(mondayDate);
  if (!Number.isFinite(normalizedWeek) || normalizedWeek <= 1 || !normalizedMonday) {
    return { hasGap: false };
  }

  const previousWeekInvoice = (Array.isArray(invoiceRows) ? invoiceRows : []).find(
    (row) => row?.id !== excludeInvoiceId && Number(row?.weekNumber || 0) === normalizedWeek - 1
  );
  const previousMondayDate = toDateInputValue(previousWeekInvoice?.mondayDate || "");
  if (!previousMondayDate) {
    return { hasGap: false };
  }

  const expectedMondayDate = shiftDateInputValue(previousMondayDate, 7);
  if (expectedMondayDate === normalizedMonday) {
    return { hasGap: false };
  }

  const millisPerDay = 24 * 60 * 60 * 1000;
  const gapDays = Math.round(
    (new Date(`${normalizedMonday}T00:00:00`).getTime() - new Date(`${expectedMondayDate}T00:00:00`).getTime()) / millisPerDay
  );

  return { hasGap: true, expectedMondayDate, actualMondayDate: normalizedMonday, gapDays };
};

const getNextWeekSuggestion = (invoiceRows = []) => {
  if (!Array.isArray(invoiceRows) || invoiceRows.length === 0) {
    return {
      weekNumber: "1",
      mondayDate: "",
      dueDate: "",
      paymentTerms: "net30",
      netDays: 30,
    };
  }

  let highestWeek = 0;
  let highestWeekInvoice = null;

  invoiceRows.forEach((invoice) => {
    const currentWeek = Number(invoice?.weekNumber || 0);
    if (currentWeek > highestWeek) {
      highestWeek = currentWeek;
      highestWeekInvoice = invoice;
    }
  });

  const nextWeekNumber = highestWeek + 1;
  const latestMonday = toDateInputValue(highestWeekInvoice?.mondayDate || "");
  const highestWeekPaymentTerms = String(highestWeekInvoice?.paymentTerms || "net30").trim().toLowerCase() || "net30";
  const highestWeekNetDays = resolveNetDays(highestWeekPaymentTerms, highestWeekInvoice?.netDays);
  const nextWeekMondayDate = getExpectedWeekMondayDate(nextWeekNumber, invoiceRows, latestMonday ? shiftDateInputValue(latestMonday, 7) : "");

  return {
    weekNumber: String(nextWeekNumber),
    mondayDate: nextWeekMondayDate,
    dueDate: nextWeekMondayDate ? shiftDateInputValue(nextWeekMondayDate, highestWeekNetDays) : "",
    paymentTerms: highestWeekPaymentTerms,
    netDays: highestWeekNetDays,
  };
};

const InvoiceManager = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const routePrefix =
    typeof window !== "undefined" && window.location?.pathname?.includes("/church/")
      ? "/church"
      : "/organization";

  const getBudgetInvoiceCreateHref = (projectName = "") => {
    const params = new URLSearchParams();
    params.set("tab", "invoice-create");
    params.set("source", "invoice-manager");

    const normalizedProjectName = String(projectName || "").trim();
    if (normalizedProjectName) {
      params.set("projectName", normalizedProjectName);
    }

    return `${routePrefix}/${id}/budget?${params.toString()}`;
  };

  const [checkingPermissions, setCheckingPermissions] = useState(true);
  const [canManageInvoices, setCanManageInvoices] = useState(false);

  const [projects, setProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(true);

  const getLastSelectedProjectStorageKey = () => `invoiceManager:lastProjectId:${id}`;

  const [selectedProjectId, setSelectedProjectId] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem(`invoiceManager:lastProjectId:${id}`) || "";
    } catch (error) {
      return "";
    }
  });
  const [invoices, setInvoices] = useState([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);

  const INVOICE_TABLE_COLUMN_DEFS = [
    { key: "dueDate", label: "Due Date" },
    { key: "dueDay", label: "Due Day" },
    { key: "countdown", label: "Countdown" },
  ];
  const getInvoiceTableColumnsStorageKey = () => `invoiceManager:tableColumns:${id}`;

  const [visibleInvoiceTableColumns, setVisibleInvoiceTableColumns] = useState(() => {
    const defaults = { dueDate: false, dueDay: false, countdown: false };
    if (typeof window === "undefined") return defaults;
    try {
      const raw = window.localStorage.getItem(`invoiceManager:tableColumns:${id}`);
      return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
    } catch (error) {
      return defaults;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(getInvoiceTableColumnsStorageKey(), JSON.stringify(visibleInvoiceTableColumns));
    } catch (error) {
      // Ignore storage write failures (e.g. private browsing quota).
    }
  }, [visibleInvoiceTableColumns, id]);

  const toggleInvoiceTableColumn = (columnKey) => {
    setVisibleInvoiceTableColumns((previous) => ({ ...previous, [columnKey]: !previous[columnKey] }));
  };
  const [projectTotalsById, setProjectTotalsById] = useState({});
  const [projectDueTotalsById, setProjectDueTotalsById] = useState({});
  const [projectBudgetedTotalsById, setProjectBudgetedTotalsById] = useState({});
  const [projectFinalTotalsById, setProjectFinalTotalsById] = useState({});

  const [projectDraft, setProjectDraft] = useState({ name: "", description: "", timeRotateProjectNames: [] });
  const [editingProjectId, setEditingProjectId] = useState("");
  const [editProjectDraft, setEditProjectDraft] = useState({ name: "", description: "", timeRotateProjectNames: [] });

  const [invoiceDraft, setInvoiceDraft] = useState({ ...emptyInvoiceDraft });
  const [editingInvoiceId, setEditingInvoiceId] = useState("");
  const [editInvoiceDraft, setEditInvoiceDraft] = useState({ ...emptyInvoiceDraft });
  const [isInvoiceDraftDirty, setIsInvoiceDraftDirty] = useState(false);
  const [creatingCatchUpInvoices, setCreatingCatchUpInvoices] = useState(false);
  const [recreateWeekNumber, setRecreateWeekNumber] = useState("");
  const [recreatingWeek, setRecreatingWeek] = useState(false);
  const [insertingWeekInvoiceId, setInsertingWeekInvoiceId] = useState(null);
  const [addingNextWeek, setAddingNextWeek] = useState(false);
  const [activeInvoicesTab, setActiveInvoicesTab] = useState(() => getInvoiceTabFromCurrentLocation());
  const [tdMatcherSearch, setTdMatcherSearch] = useState("");
  const [quickPaidSearch, setQuickPaidSearch] = useState("");
  const [quickPaidSavingByInvoiceKey, setQuickPaidSavingByInvoiceKey] = useState({});
  const [allProjectInvoices, setAllProjectInvoices] = useState([]);
  const [loadingAllProjectInvoices, setLoadingAllProjectInvoices] = useState(false);
  const [excelFileName, setExcelFileName] = useState("");
  const [excelRawRows, setExcelRawRows] = useState([]);
  const [excelPreviewHeaders, setExcelPreviewHeaders] = useState([]);
  const [excelPreviewRows, setExcelPreviewRows] = useState([]);
  const [excelColumnMap, setExcelColumnMap] = useState({
    invoiceNumber: "",
    total: "",
    projectName: "",
  });
  const [excelInvoiceRows, setExcelInvoiceRows] = useState([]);
  const [reconciliationResult, setReconciliationResult] = useState(null);
  const [resolvedReconciliationItems, setResolvedReconciliationItems] = useState([]);
  const [missingSystemAssignments, setMissingSystemAssignments] = useState({});
  const [savingMissingSystemAssignments, setSavingMissingSystemAssignments] = useState({});
  const [duplicateInvoiceEdits, setDuplicateInvoiceEdits] = useState({});
  const [savingDuplicateInvoiceEdits, setSavingDuplicateInvoiceEdits] = useState({});
  const [savingReconciliationReport, setSavingReconciliationReport] = useState(false);
  const [lastSavedReconciliationAt, setLastSavedReconciliationAt] = useState("");
  const [loadingSavedReconciliationReport, setLoadingSavedReconciliationReport] = useState(false);
  const [invoiceLogModalInvoice, setInvoiceLogModalInvoice] = useState(null);
  const [externalPdfInvoiceId, setExternalPdfInvoiceId] = useState("");
  const [downloadingInvoiceStatusReport, setDownloadingInvoiceStatusReport] = useState(false);
  const [uploadingExternalPdfInvoiceId, setUploadingExternalPdfInvoiceId] = useState("");
  const [timeRotateLogs, setTimeRotateLogs] = useState([]);
  const [organizationUserDirectory, setOrganizationUserDirectory] = useState([]);
  const [issueTitleByIdentity, setIssueTitleByIdentity] = useState({});
  const [issueTitleByIssueId, setIssueTitleByIssueId] = useState({});
  const [tdMatcherCandidates, setTdMatcherCandidates] = useState([]);
  const [projectIssuesByProjectNameKey, setProjectIssuesByProjectNameKey] = useState({});
  const [tdInvoiceProjectIdByIdentity, setTdInvoiceProjectIdByIdentity] = useState({});
  const externalPdfInputRef = useRef(null);

  const handleInvoicesTabChange = (tabKey, { replace = false } = {}) => {
    const normalizedTab = normalizeInvoiceTabKey(tabKey);
    setActiveInvoicesTab(normalizedTab);
    pushInvoiceTabToLocation(normalizedTab, { replace });
  };

  const buildInvoiceLogEntry = ({ action, note = "", changes = {} }) => ({
    action: String(action || "Updated").trim() || "Updated",
    note: String(note || "").trim(),
    changes: changes && typeof changes === "object" ? changes : {},
    actorUid: user?.uid || "",
    actorEmail: user?.email || "",
    loggedAt: new Date().toISOString(),
  });

  const getInvoiceLogEntries = (invoice) => {
    const existingEntries = Array.isArray(invoice?.changeLog) ? invoice.changeLog : [];
    const sortedExisting = existingEntries
      .slice()
      .sort((left, right) => {
        const leftIso = toIsoStringFromValue(left?.loggedAt);
        const rightIso = toIsoStringFromValue(right?.loggedAt);
        return rightIso.localeCompare(leftIso);
      });

    if (sortedExisting.length > 0) {
      return sortedExisting;
    }

    if (!invoice) {
      return [];
    }

    const createdAtIso = toIsoStringFromValue(invoice?.createdAt) || toIsoStringFromValue(invoice?.updatedAt);
    return [{
      action: "Created",
      note: "Initial invoice record.",
      changes: {
        invoiceNumber: normalizeInvoiceNumber(invoice?.invoiceNumber || ""),
        total: parseAmountValue(invoice?.total),
        weekNumber: Number(invoice?.weekNumber || 0) || "",
      },
      actorUid: String(invoice?.createdByUid || "").trim(),
      actorEmail: String(invoice?.createdByEmail || "").trim(),
      loggedAt: createdAtIso || new Date().toISOString(),
    }];
  };

  const projectsRef = useMemo(() => collection(db, "churches", id, "invoiceProjects"), [id]);
  const invoicesRef = useMemo(
    () =>
      selectedProjectId
        ? collection(db, "churches", id, "invoiceProjects", selectedProjectId, "invoices")
        : null,
    [id, selectedProjectId]
  );

  const previousWeekStatus = useMemo(() => {
    const previousWeekDate = new Date();
    previousWeekDate.setDate(previousWeekDate.getDate() - 7);

    const previousWeekNumber = getIsoWeekNumber(previousWeekDate);
    const previousWeekMondayDate = formatIsoDate(getStartOfIsoWeek(previousWeekDate));
    let latestInvoiceMondayDate = "";
    let latestInvoiceWeekNumber = 0;
    let latestInvoicePaymentTerms = "net30";
    let latestInvoiceNetDays = 30;

    invoices.forEach((invoice) => {
      const currentMondayDate = toDateInputValue(invoice?.mondayDate || "");
      const currentWeekNumber = Number(invoice?.weekNumber || 0);
      const currentPaymentTerms = String(invoice?.paymentTerms || "net30").trim().toLowerCase() || "net30";
      const currentNetDays = resolveNetDays(currentPaymentTerms, invoice?.netDays);

      if (!currentMondayDate) {
        if (currentWeekNumber > latestInvoiceWeekNumber) {
          latestInvoiceWeekNumber = currentWeekNumber;
        }
        return;
      }

      if (!latestInvoiceMondayDate || currentMondayDate > latestInvoiceMondayDate) {
        latestInvoiceMondayDate = currentMondayDate;
        latestInvoiceWeekNumber = currentWeekNumber;
        latestInvoicePaymentTerms = currentPaymentTerms;
        latestInvoiceNetDays = currentNetDays;
      }
    });

    const missingWeekPlans = [];

    if (latestInvoiceMondayDate) {
      let nextMissingMondayDate = shiftDateInputValue(latestInvoiceMondayDate, 7);
      while (nextMissingMondayDate && nextMissingMondayDate <= previousWeekMondayDate) {
        missingWeekPlans.push({
          mondayDate: nextMissingMondayDate,
          dueDate: shiftDateInputValue(nextMissingMondayDate, latestInvoiceNetDays),
        });
        nextMissingMondayDate = shiftDateInputValue(nextMissingMondayDate, 7);
      }
    }

    const missingCount = latestInvoiceMondayDate ? missingWeekPlans.length : previousWeekNumber;

    return {
      previousWeekNumber,
      previousWeekMondayDate,
      highestExistingWeek: latestInvoiceWeekNumber,
      latestInvoiceMondayDate,
      latestInvoicePaymentTerms,
      latestInvoiceNetDays,
      missingWeekPlans,
      missingCount,
      isUpToDate: missingCount === 0,
    };
  }, [invoices]);

  useEffect(() => {
    if (!id) {
      setTimeRotateLogs([]);
      return undefined;
    }

    const unsubscribe = onSnapshot(
      collection(db, "churches", id, "timeRotateLogs"),
      (snapshot) => {
        const nextLogs = snapshot.docs.map((logDoc) => {
          const data = logDoc.data() || {};
          const rawNotes = Array.isArray(data.notes) ? data.notes : [];
          const taskIdentity = String(data.taskIdentity || "").trim();
          const taskIdentityParts = taskIdentity ? taskIdentity.split("::") : [];
          const derivedProjectDocId = String(data.projectDocId || "").trim() || String(taskIdentityParts[0] || "").trim();
          const derivedIssueId = String(data.issueId || "").trim() || String(taskIdentityParts[1] || "").trim();

          return {
            id: logDoc.id,
            projectName: String(data.projectName || "").trim(),
            projectNameKey: normalizeProjectNameKey(data.projectName),
            logType: String(data.logType || "").trim().toLowerCase(),
            durationMs: Number(data.durationMs) || 0,
            startedAt: toMillisecondsFromValue(data.startedAt),
            endedAt: toMillisecondsFromValue(data.endedAt),
            registeredBy: String(data.registeredBy || "").trim(),
            userEmail: String(data.userEmail || "").trim(),
            userId: String(data.userId || "").trim(),
            projectDocId: derivedProjectDocId,
            issueId: derivedIssueId,
            title: String(data.title || "").trim(),
            description: String(data.description || data.details || data.issueDescription || data.issueDetails || "").trim(),
            taskIdentity,
            associatedProjectName: String(data.projectName || "").trim(),
            notes: rawNotes
              .map((note) => {
                if (note && typeof note === "object") {
                  return {
                    text: String(note.text || "").trim(),
                    timestamp: Number(note.timestamp) || 0,
                  };
                }

                return {
                  text: String(note || "").trim(),
                  timestamp: 0,
                };
              })
              .filter((note) => note.text),
          };
        });
        setTimeRotateLogs(nextLogs);
      },
      (error) => {
        console.error("Error loading Time Rotate logs for invoice hours:", error);
      }
    );

    return unsubscribe;
  }, [id]);

  useEffect(() => {
    if (!id) {
      setTdInvoiceProjectIdByIdentity({});
      return undefined;
    }

    return onSnapshot(collection(db, "churches", id, "timeRotateTaskDetails"), (snapshot) => {
      const nextMatches = {};
      snapshot.forEach((taskDoc) => {
        const taskData = taskDoc.data() || {};
        const taskIdentity = String(taskData.taskIdentity || "").trim();
        const invoiceProjectId = String(taskData.invoiceProjectId || "").trim();
        if (taskIdentity && invoiceProjectId) nextMatches[taskIdentity] = invoiceProjectId;
      });
      setTdInvoiceProjectIdByIdentity(nextMatches);
    }, (error) => {
      console.error("Error loading TD invoice matches:", error);
      setTdInvoiceProjectIdByIdentity({});
    });
  }, [id]);

  // Loads org members so invoices can display each person's full name instead of whatever short name was logged.
  useEffect(() => {
    if (!id) {
      setOrganizationUserDirectory([]);
      return undefined;
    }

    const usersQuery = query(collection(db, "users"), where("churchId", "==", id));
    const unsubscribe = onSnapshot(
      usersQuery,
      (snapshot) => {
        const nextDirectory = snapshot.docs.map((userDoc) => {
          const data = userDoc.data() || {};
          const firstName = String(data.firstName || data.name || "").trim();
          const lastName = String(data.lastName || "").trim();
          const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
          const displayName = String(data.displayName || "").trim();
          const email = String(data.email || "").trim();
          const label = fullName || displayName || email || `User ${userDoc.id}`;

          return {
            userId: userDoc.id,
            label,
            firstName,
            aliases: [userDoc.id, email, displayName, data.name]
              .map(normalizeIdentityValue)
              .filter(Boolean),
          };
        });

        setOrganizationUserDirectory(nextDirectory);
      },
      (error) => {
        console.error("Error loading organization user directory for invoices:", error);
      }
    );

    return unsubscribe;
  }, [id]);

  const fullNameByIdentityAlias = useMemo(() => {
    const lookup = {};
    organizationUserDirectory.forEach((userEntry) => {
      userEntry.aliases.forEach((alias) => {
        lookup[alias] = userEntry.label;
      });
    });
    return lookup;
  }, [organizationUserDirectory]);

  // Maps a normalized first name to a full label, but only when exactly one org member has
  // that first name — ambiguous first names are left out to avoid merging different people.
  const fullNameByFirstNameOnly = useMemo(() => {
    const countByFirstName = new Map();
    organizationUserDirectory.forEach((userEntry) => {
      const key = normalizeIdentityValue(userEntry.firstName);
      if (!key) return;
      countByFirstName.set(key, (countByFirstName.get(key) || 0) + 1);
    });

    const lookup = {};
    organizationUserDirectory.forEach((userEntry) => {
      const key = normalizeIdentityValue(userEntry.firstName);
      if (!key || countByFirstName.get(key) !== 1) return;
      lookup[key] = userEntry.label;
    });
    return lookup;
  }, [organizationUserDirectory]);

  const timeRotateProjectOptions = useMemo(() => {
    const allValues = [
      ...timeRotateLogs.map((log) => String(log.projectName || "").trim()),
      ...projects.flatMap((project) => normalizeTimeRotateProjectNames(project?.timeRotateProjectNames)),
    ];

    return normalizeTimeRotateProjectNames(allValues).sort((left, right) => left.localeCompare(right));
  }, [projects, timeRotateLogs]);

  const selectedInvoiceProject = useMemo(() => {
    return projects.find((project) => project.id === selectedProjectId) || null;
  }, [projects, selectedProjectId]);

  const selectedTimeRotateProjectNameKeys = useMemo(() => {
    const names = normalizeTimeRotateProjectNames(
      selectedInvoiceProject?.timeRotateProjectNames?.length > 0
        ? selectedInvoiceProject.timeRotateProjectNames
        : [selectedInvoiceProject?.name]
    );
    return new Set(names.map((name) => normalizeProjectNameKey(name)).filter(Boolean));
  }, [selectedInvoiceProject]);

  const associatedTimeRotateProjectNameKeysByProjectId = useMemo(() => {
    return Object.fromEntries(
      projects.map((project) => {
        const associatedProjectNames = normalizeTimeRotateProjectNames(
          project?.timeRotateProjectNames?.length > 0
            ? project.timeRotateProjectNames
            : [project?.name]
        );
        const keys = associatedProjectNames
          .map((name) => normalizeProjectNameKey(name))
          .filter(Boolean);
        return [project.id, new Set(keys)];
      })
    );
  }, [projects]);

  const allAssociatedTimeRotateProjectNameKeys = useMemo(() => {
    const keys = new Set();
    Object.values(associatedTimeRotateProjectNameKeysByProjectId).forEach((projectSet) => {
      projectSet.forEach((key) => keys.add(key));
    });
    return keys;
  }, [associatedTimeRotateProjectNameKeysByProjectId]);

  const projectNamesWithExplicitTdMatches = useMemo(() => new Set(
    timeRotateLogs
      .filter((log) => tdInvoiceProjectIdByIdentity[getTimeRotateTaskIdentity(log)])
      .map((log) => log.projectNameKey)
      .filter(Boolean)
  ), [tdInvoiceProjectIdByIdentity, timeRotateLogs]);

  const isLogMatchedToInvoiceProject = (log, invoiceProjectId) => {
    const explicitProjectId = tdInvoiceProjectIdByIdentity[getTimeRotateTaskIdentity(log)];
    if (explicitProjectId) return explicitProjectId === invoiceProjectId;
    if (projectNamesWithExplicitTdMatches.has(log.projectNameKey)) return false;
    return associatedTimeRotateProjectNameKeysByProjectId[invoiceProjectId]?.has(log.projectNameKey) || false;
  };

  const tdMatcherRows = useMemo(() => {
    const rowsByIdentity = new Map();

    tdMatcherCandidates.forEach((candidate) => {
      rowsByIdentity.set(candidate.identity, {
        ...candidate,
        milliseconds: 0,
        firstUsedAt: 0,
        lastUsedAt: 0,
        users: new Set(),
      });
    });

    timeRotateLogs.forEach((log) => {
      if (log.logType === "completion" || getTimeRotateLogDurationMs(log) <= 0) return;
      const projectName = String(log.projectName || "").trim();
      const identity = getTimeRotateTaskIdentity(log);
      if (!identity) return;
      const resolvedTitle = String(
        log.title
        || issueTitleByIdentity[`${String(log.projectDocId || "").trim()}::${String(log.issueId || "").trim()}`]
        || issueTitleByIdentity[identity]
        || issueTitleByIssueId[String(log.issueId || "").trim()]
        || ""
      ).trim();

      const existing = rowsByIdentity.get(identity) || {
        identity,
        issueId: String(log.issueId || "").trim(),
        title: resolvedTitle,
        projectName,
        milliseconds: 0,
        firstUsedAt: 0,
        lastUsedAt: 0,
        users: new Set(),
      };
      if (!existing.title && resolvedTitle) existing.title = resolvedTitle;
      existing.milliseconds += Math.max(0, Number(log.durationMs) || (Number(log.endedAt) - Number(log.startedAt)) || 0);
      const logStartAt = Number(log.startedAt) || Number(log.endedAt) || 0;
      const logEndAt = Number(log.endedAt) || logStartAt;
      if (logStartAt > 0 && (!existing.firstUsedAt || logStartAt < existing.firstUsedAt)) {
        existing.firstUsedAt = logStartAt;
      }
      if (logEndAt > existing.lastUsedAt) {
        existing.lastUsedAt = logEndAt;
      }
      const userLabel = getTimeLogUserLabel(log, fullNameByIdentityAlias, fullNameByFirstNameOnly);
      if (userLabel) existing.users.add(userLabel);
      rowsByIdentity.set(identity, existing);
    });

    return Array.from(rowsByIdentity.values())
      .map((row) => {
        const explicitProjectId = tdInvoiceProjectIdByIdentity[row.identity];
        const projectNameKey = normalizeProjectNameKey(row.projectName);
        const matchedProjects = explicitProjectId
          ? projects.filter((project) => project.id === explicitProjectId)
          : projects.filter((project) => {
          const associatedNames = normalizeTimeRotateProjectNames(
            project?.timeRotateProjectNames?.length > 0 ? project.timeRotateProjectNames : [project?.name]
          );
          return associatedNames.some((name) => normalizeProjectNameKey(name) === projectNameKey);
        });
        const excludedByExplicitTdMatch = !explicitProjectId
          && projectNamesWithExplicitTdMatches.has(projectNameKey)
          && row.milliseconds > 0;
        return {
          ...row,
          explicitProjectId,
          excludedByExplicitTdMatch,
          users: Array.from(row.users).sort((left, right) => left.localeCompare(right)),
          matchedProjects,
        };
      })
      .filter((row) => {
        const search = tdMatcherSearch.trim().toLowerCase();
        if (!search) return true;
        return [row.issueId, row.title, row.projectName, ...row.users]
          .join(" ")
          .toLowerCase()
          .includes(search);
      })
      .sort((left, right) => left.projectName.localeCompare(right.projectName) || left.issueId.localeCompare(right.issueId));
  }, [fullNameByFirstNameOnly, fullNameByIdentityAlias, issueTitleByIdentity, issueTitleByIssueId, projectNamesWithExplicitTdMatches, projects, tdInvoiceProjectIdByIdentity, tdMatcherCandidates, tdMatcherSearch, timeRotateLogs]);

  const tdMatcherHoursAudit = useMemo(() => {
    const finalizedLogs = timeRotateLogs.filter((log) => (
      log.logType !== "completion" && getTimeRotateLogDurationMs(log) > 0
    ));
    const loggedMilliseconds = finalizedLogs.reduce(
      (total, log) => total + getTimeRotateLogDurationMs(log),
      0
    );
    const tdMatcherMilliseconds = tdMatcherRows.reduce(
      (total, row) => total + (Number(row.milliseconds) || 0),
      0
    );
    const selectedProjectMilliseconds = selectedProjectId
      ? finalizedLogs
        .filter((log) => isLogMatchedToInvoiceProject(log, selectedProjectId))
        .reduce((total, log) => total + getTimeRotateLogDurationMs(log), 0)
      : 0;

    return {
      loggedMilliseconds,
      payEveryoneMilliseconds: loggedMilliseconds,
      tdMatcherMilliseconds,
      selectedProjectMilliseconds,
      unassignedToSelectedProjectMilliseconds: Math.max(0, loggedMilliseconds - selectedProjectMilliseconds),
    };
  }, [selectedProjectId, tdMatcherRows, timeRotateLogs, tdInvoiceProjectIdByIdentity, associatedTimeRotateProjectNameKeysByProjectId, projectNamesWithExplicitTdMatches]);

  const hoursAuditRows = useMemo(() => {
    if (!selectedProjectId) return [];

    const groupedRows = new Map();
    timeRotateLogs.forEach((log) => {
      if (log.logType === "completion") return;
      const durationMs = getTimeRotateLogDurationMs(log);
      const usedAt = Number(log.startedAt) || Number(log.endedAt) || 0;
      if (durationMs <= 0) return;

      const userLabel = getTimeLogUserLabel(log, fullNameByIdentityAlias, fullNameByFirstNameOnly);
      const tdId = String(log.issueId || "Unspecified TD").trim();
      const tdTitle = String(
        log.title
        || issueTitleByIdentity[`${String(log.projectDocId || "").trim()}::${tdId}`]
        || issueTitleByIssueId[tdId]
        || ""
      ).trim();
      const key = `${userLabel.toLowerCase()}::${getTimeRotateTaskIdentity(log)}`;
      const existing = groupedRows.get(key) || {
        userLabel,
        tdId,
        tdTitle,
        timeRotateMilliseconds: 0,
        payEveryoneMilliseconds: 0,
        invoiceMilliseconds: 0,
        invoiceWeeks: new Set(),
        logCount: 0,
      };
      existing.timeRotateMilliseconds += durationMs;
      existing.payEveryoneMilliseconds += durationMs;
      if (isLogMatchedToInvoiceProject(log, selectedProjectId)) {
        let isCoveredByInvoiceWeek = false;
        invoices.forEach((invoice) => {
          const mondayDate = toDateInputValue(invoice.mondayDate);
          const weekEndDate = shiftDateInputValue(mondayDate, 6);
          const rangeStart = mondayDate ? Date.parse(`${mondayDate}T00:00:00`) : Number.NaN;
          const rangeEnd = weekEndDate ? Date.parse(`${weekEndDate}T23:59:59.999`) : Number.NaN;
          if (usedAt >= rangeStart && usedAt <= rangeEnd) {
            existing.invoiceWeeks.add(`Week ${invoice.weekNumber || "-"}`);
            isCoveredByInvoiceWeek = true;
          }
        });
        if (isCoveredByInvoiceWeek) existing.invoiceMilliseconds += durationMs;
      }
      existing.logCount += 1;
      groupedRows.set(key, existing);
    });

    return Array.from(groupedRows.values())
      .map((row) => ({ ...row, invoiceWeeks: Array.from(row.invoiceWeeks).sort() }))
      .sort((left, right) => left.userLabel.localeCompare(right.userLabel) || left.tdId.localeCompare(right.tdId));
  }, [fullNameByFirstNameOnly, fullNameByIdentityAlias, invoices, issueTitleByIdentity, issueTitleByIssueId, selectedProjectId, tdInvoiceProjectIdByIdentity, timeRotateLogs]);

  const billableTimeRotateLogs = useMemo(() => {
    if (
      timeRotateLogs.length === 0
      || (allAssociatedTimeRotateProjectNameKeys.size === 0 && Object.keys(tdInvoiceProjectIdByIdentity).length === 0)
    ) {
      return [];
    }

    const mappedLogs = timeRotateLogs
      .map((log) => {
        const eventTimestamp = Number(log.startedAt) || Number(log.endedAt) || 0;
        const rawDurationMs = Number(log.durationMs);
        const safeDuration = Number.isFinite(rawDurationMs) && rawDurationMs > 0
          ? rawDurationMs
          : Math.max(0, (Number(log.endedAt) || 0) - (Number(log.startedAt) || 0));
        const weekKey = getIsoWeekStartDateKeyFromTimestamp(eventTimestamp);

        if (log.logType === "completion") return null;
        const explicitProjectId = tdInvoiceProjectIdByIdentity[getTimeRotateTaskIdentity(log)];
        if (!explicitProjectId && !allAssociatedTimeRotateProjectNameKeys.has(log.projectNameKey)) return null;
        if (!Number.isFinite(eventTimestamp) || eventTimestamp <= 0) return null;
        if (!Number.isFinite(safeDuration) || safeDuration <= 0) return null;
        if (!weekKey) return null;

        return {
          ...log,
          eventTimestamp,
          safeDuration,
          weekKey,
          userLabel: getTimeLogUserLabel(log, fullNameByIdentityAlias, fullNameByFirstNameOnly),
        };
      })
      .filter(Boolean);

    // Safety net: if a person's logs ended up split between a short name and their fuller name
    // (e.g. "Salomon" vs "Salomon Paredes"), merge them under the fuller name here so weekly
    // overtime allocation and hour totals are computed against their true combined hours,
    // matching the billable invoice preview instead of under-counting overtime per variant.
    const canonicalNameByShortName = new Map();
    const sortedLabelsByLength = Array.from(new Set(mappedLogs.map((log) => log.userLabel)))
      .filter(Boolean)
      .sort((left, right) => right.length - left.length);
    sortedLabelsByLength.forEach((label) => {
      const firstWord = label.split(/\s+/)[0].toLowerCase();
      if (firstWord && !canonicalNameByShortName.has(firstWord)) {
        canonicalNameByShortName.set(firstWord, label);
      }
    });

    return mappedLogs
      .map((log) => {
        const isSingleWordName = log.userLabel && !log.userLabel.includes(" ");
        const canonicalName = isSingleWordName ? canonicalNameByShortName.get(log.userLabel.toLowerCase()) : null;
        const resolvedLabel = (canonicalName && canonicalName.toLowerCase() !== log.userLabel.toLowerCase())
          ? canonicalName
          : log.userLabel;

        return resolvedLabel === log.userLabel ? log : { ...log, userLabel: resolvedLabel };
      })
      .sort((left, right) => {
        const timeDelta = left.eventTimestamp - right.eventTimestamp;
        if (timeDelta !== 0) return timeDelta;
        return String(left.id || "").localeCompare(String(right.id || ""));
      });
  }, [allAssociatedTimeRotateProjectNameKeys, tdInvoiceProjectIdByIdentity, timeRotateLogs, fullNameByIdentityAlias, fullNameByFirstNameOnly]);

  useEffect(() => {
    let active = true;

    if (!id) {
      setIssueTitleByIdentity({});
      setTdMatcherCandidates([]);
      return () => {
        active = false;
      };
    }

    const loadIssueTitles = async () => {
      try {
        const projectsSnapshot = await getDocs(collection(db, "churches", id, "bimProjects"));

        const snapshots = await Promise.all(
          projectsSnapshot.docs.map(async (projectDoc) => {
            const projectDocId = String(projectDoc.id || "").trim();
            const issuesRef = collection(db, "churches", id, "bimProjects", projectDocId, "issues");
            const issuesSnapshot = await getDocs(issuesRef);
            return { projectDocId, issuesSnapshot };
          })
        );

        if (!active) return;

        const nextIssueTitleByIdentity = {};
        const titlesByIssueIdSet = {};
        const nextTdMatcherCandidates = [];

        snapshots.forEach(({ projectDocId, issuesSnapshot }) => {
          issuesSnapshot.docs.forEach((issueDoc, rowIndex) => {
            const rowData = issueDoc.data() || {};

            const issueIdColumn = findColumnByAliases(rowData, ["issue id", "id", "task id", "card id", "row id"]);
            const titleColumn = findColumnByAliases(rowData, ["title", "issue title", "task title", "name"]);
            const projectNameColumn = findColumnByAliases(rowData, ["project name", "project", "projectname"]);

            const issueId = String(
              (issueIdColumn ? rowData[issueIdColumn] : "")
              || rowData.issueId
              || rowData.id
              || String(rowIndex + 1)
            ).trim();

            const issueTitle = String(
              (titleColumn ? rowData[titleColumn] : "")
              || rowData.title
              || ""
            ).trim();

            if (!issueId || !issueTitle) return;

            nextIssueTitleByIdentity[`${projectDocId}::${issueId}`] = issueTitle;

            const isTechnicalDetail = /^TD[-\s]?/i.test(issueId)
              || /technical detail/i.test(issueTitle);
            if (isTechnicalDetail) {
              nextTdMatcherCandidates.push({
                identity: `${projectDocId}::${issueId}`,
                issueId,
                title: issueTitle,
                projectName: String(
                  (projectNameColumn ? rowData[projectNameColumn] : "")
                  || rowData.projectName
                  || ""
                ).trim(),
              });
            }

            if (!titlesByIssueIdSet[issueId]) {
              titlesByIssueIdSet[issueId] = new Set();
            }
            titlesByIssueIdSet[issueId].add(issueTitle);
          });
        });

        const nextIssueTitleByIssueId = Object.fromEntries(
          Object.entries(titlesByIssueIdSet)
            .filter(([, titleSet]) => titleSet.size === 1)
            .map(([issueId, titleSet]) => [issueId, Array.from(titleSet)[0]])
        );

        setIssueTitleByIdentity(nextIssueTitleByIdentity);
        setIssueTitleByIssueId(nextIssueTitleByIssueId);
        setTdMatcherCandidates(nextTdMatcherCandidates);
      } catch (error) {
        console.error("Error loading issue titles for billable invoices:", error);
        if (active) {
          setIssueTitleByIdentity({});
          setIssueTitleByIssueId({});
          setTdMatcherCandidates([]);
        }
      }
    };

    loadIssueTitles();

    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    let active = true;

    if (!id) {
      setProjectIssuesByProjectNameKey({});
      return () => {
        active = false;
      };
    }

    const loadProjectListIssues = async () => {
      try {
        const projectsSnapshot = await getDocs(collection(db, "churches", id, "projectListIssueProjects"));

        const projectEntries = await Promise.all(
          projectsSnapshot.docs.map(async (projectDoc) => {
            const projectData = projectDoc.data() || {};
            const projectName = String(projectData.name || projectData.projectName || "").trim();
            const projectNameKey = normalizeProjectNameKey(projectName);
            if (!projectNameKey) return null;

            const issuesSnapshot = await getDocs(
              collection(db, "churches", id, "projectListIssueProjects", projectDoc.id, "issues")
            );

            const issues = issuesSnapshot.docs.map((issueDoc, rowIndex) => {
              const rowData = issueDoc.data() || {};
              const issueIdColumn = findColumnByAliases(rowData, [
                "issue id",
                "id",
                "task id",
                "card id",
                "row id",
                "issue number",
                "issue #",
                "number",
              ]);
              const titleColumn = findColumnByAliases(rowData, ["title", "issue title", "task title", "name"]);
              const descriptionColumn = findColumnByAliases(rowData, [
                "description",
                "issue description",
                "details",
                "issue details",
              ]);

              const issueId = String(
                (issueIdColumn ? rowData[issueIdColumn] : "")
                || rowData.issueNumber
                || rowData.issueId
                || rowData.id
                || String(rowIndex + 1)
              ).trim();

              const issueTitle = String(
                (titleColumn ? rowData[titleColumn] : "")
                || rowData.title
                || ""
              ).trim();

              const issueDescription = String(
                (descriptionColumn ? rowData[descriptionColumn] : "")
                || rowData.description
                || ""
              ).trim();

              return {
                projectName,
                issueId,
                title: issueTitle,
                description: issueDescription,
                notes: normalizeProjectIssueNotes(rowData.notes),
              };
            });

            return {
              projectNameKey,
              issues,
            };
          })
        );

        if (!active) return;

        const nextIssuesByProjectNameKey = {};
        projectEntries.forEach((entry) => {
          if (!entry || !entry.projectNameKey || !Array.isArray(entry.issues) || entry.issues.length === 0) return;
          if (!nextIssuesByProjectNameKey[entry.projectNameKey]) {
            nextIssuesByProjectNameKey[entry.projectNameKey] = [];
          }
          nextIssuesByProjectNameKey[entry.projectNameKey].push(...entry.issues);
        });

        setProjectIssuesByProjectNameKey(nextIssuesByProjectNameKey);
      } catch (error) {
        console.error("Error loading project list issues for billable invoices:", error);
        if (active) {
          setProjectIssuesByProjectNameKey({});
        }
      }
    };

    loadProjectListIssues();

    return () => {
      active = false;
    };
  }, [id]);

  const weeklyOvertimeAllocationByLogId = useMemo(() => {
    if (billableTimeRotateLogs.length === 0) return {};

    const grouped = new Map();

    billableTimeRotateLogs.forEach((log) => {
      const groupKey = `${log.weekKey}::${String(log.userLabel || "").trim().toLowerCase()}`;
      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, []);
      }
      grouped.get(groupKey).push(log);
    });

    const allocationByLogId = {};

    grouped.forEach((logs) => {
      let consumedMilliseconds = 0;

      logs.forEach((log) => {
        const regularRemaining = Math.max(0, OVERTIME_THRESHOLD_MILLISECONDS - consumedMilliseconds);
        const regularMilliseconds = Math.min(log.safeDuration, regularRemaining);
        const overtimeMilliseconds = Math.max(0, log.safeDuration - regularMilliseconds);

        allocationByLogId[log.id] = {
          regularMilliseconds,
          overtimeMilliseconds,
        };

        consumedMilliseconds += log.safeDuration;
      });
    });

    return allocationByLogId;
  }, [billableTimeRotateLogs]);

  const invoiceHoursById = useMemo(() => {
    if (invoices.length === 0 || billableTimeRotateLogs.length === 0) {
      return {};
    }

    return Object.fromEntries(
      invoices.map((invoice) => {
        const mondayDate = toDateInputValue(invoice.mondayDate);
        const weekEndDate = shiftDateInputValue(mondayDate, 6);
        const rangeStart = mondayDate ? Date.parse(`${mondayDate}T00:00:00`) : Number.NaN;
        const rangeEnd = weekEndDate ? Date.parse(`${weekEndDate}T23:59:59.999`) : Number.NaN;

        if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd)) {
          return [invoice.id, {
            totalMilliseconds: 0,
            totalRegularMilliseconds: 0,
            totalOvertimeMilliseconds: 0,
            users: [],
          }];
        }

        const userAggregationByLabel = new Map();

        let totalMilliseconds = 0;
        let totalRegularMilliseconds = 0;
        let totalOvertimeMilliseconds = 0;

        billableTimeRotateLogs.forEach((log) => {
          if (!isLogMatchedToInvoiceProject(log, selectedProjectId)) return;
          if (log.eventTimestamp < rangeStart || log.eventTimestamp > rangeEnd) return;

          const allocation = weeklyOvertimeAllocationByLogId[log.id] || {
            regularMilliseconds: log.safeDuration,
            overtimeMilliseconds: 0,
          };

          totalMilliseconds += log.safeDuration;
          totalRegularMilliseconds += allocation.regularMilliseconds;
          totalOvertimeMilliseconds += allocation.overtimeMilliseconds;

          const userLabel = log.userLabel;
          if (!userAggregationByLabel.has(userLabel)) {
            userAggregationByLabel.set(userLabel, {
              milliseconds: 0,
              regularMilliseconds: 0,
              overtimeMilliseconds: 0,
              cardsByKey: new Map(),
              notes: [],
              identityKeys: new Set(),
            });
          }

          const userAggregation = userAggregationByLabel.get(userLabel);
          userAggregation.identityKeys = collectIdentityKeys([
            ...Array.from(userAggregation.identityKeys || []),
            userLabel,
            log.registeredBy,
            log.userEmail,
            log.userId,
          ]);
          userAggregation.milliseconds += log.safeDuration;
          userAggregation.regularMilliseconds += allocation.regularMilliseconds;
          userAggregation.overtimeMilliseconds += allocation.overtimeMilliseconds;

          const resolvedProjectDocId = String(log.projectDocId || "").trim();
          const resolvedIssueId = String(log.issueId || "").trim();
          const resolvedTaskIdentity = String(log.taskIdentity || "").trim();
          const titleFromLookup = issueTitleByIdentity[`${resolvedProjectDocId}::${resolvedIssueId}`]
            || issueTitleByIdentity[resolvedTaskIdentity]
            || issueTitleByIssueId[resolvedIssueId]
            || "";
          const resolvedCardTitle = String(log.title || titleFromLookup || "").trim();
          const cardLabel = String(log.issueId || resolvedCardTitle || log.taskIdentity || "Unspecified Card").trim();
          const cardKey = String(log.taskIdentity || `${resolvedProjectDocId}::${resolvedIssueId}::${cardLabel}`).trim();
          const existingCard = userAggregation.cardsByKey.get(cardKey) || {
            key: cardKey,
            label: cardLabel,
            milliseconds: 0,
            projectDocId: resolvedProjectDocId,
            issueId: resolvedIssueId,
            title: resolvedCardTitle,
            description: String(log.description || "").trim(),
            taskIdentity: resolvedTaskIdentity,
            projectName: String(log.associatedProjectName || "").trim() || "Unknown Project",
            firstUsedAt: 0,
            lastUsedAt: 0,
          };
          existingCard.milliseconds += log.safeDuration;
          const logUsedAt = Number(log.eventTimestamp) || 0;
          if (logUsedAt > 0 && (!existingCard.firstUsedAt || logUsedAt < existingCard.firstUsedAt)) {
            existingCard.firstUsedAt = logUsedAt;
          }
          if (logUsedAt > existingCard.lastUsedAt) {
            existingCard.lastUsedAt = logUsedAt;
          }
          if (!existingCard.projectDocId) {
            existingCard.projectDocId = String(log.projectDocId || "").trim();
          }
          if (!existingCard.issueId) {
            existingCard.issueId = String(log.issueId || "").trim();
          }
          if (!existingCard.title) {
            existingCard.title = resolvedCardTitle;
          }
          if (!existingCard.description) {
            existingCard.description = String(log.description || "").trim();
          }
          if (!existingCard.taskIdentity) {
            existingCard.taskIdentity = String(log.taskIdentity || "").trim();
          }
          userAggregation.cardsByKey.set(cardKey, existingCard);

          if (Array.isArray(log.notes) && log.notes.length > 0) {
            log.notes.forEach((note) => {
              userAggregation.notes.push({
                text: String(note.text || "").trim(),
                timestamp: Number(note.timestamp) || 0,
                cardLabel,
                title: resolvedCardTitle,
                projectName: String(log.associatedProjectName || "").trim() || "Unknown Project",
                projectDocId: String(log.projectDocId || "").trim(),
                issueId: String(log.issueId || "").trim(),
                taskIdentity: String(log.taskIdentity || "").trim(),
              });
            });
          }
        });

        const projectIssuesForInvoice = Array.from(selectedTimeRotateProjectNameKeys)
          .flatMap((projectNameKey) => projectIssuesByProjectNameKey[projectNameKey] || []);

        userAggregationByLabel.forEach((userAggregation) => {
          if (!Array.isArray(projectIssuesForInvoice) || projectIssuesForInvoice.length === 0) return;

          const userIdentityKeys = userAggregation.identityKeys || new Set();
          projectIssuesForInvoice.forEach((issue) => {
            const issueNotes = Array.isArray(issue.notes) ? issue.notes : [];
            issueNotes.forEach((note) => {
              if (!Number.isFinite(note.timestamp) || note.timestamp <= 0) return;
              if (note.timestamp < rangeStart || note.timestamp > rangeEnd) return;
              if (!doesProjectIssueNoteMatchUserIdentity(note, userIdentityKeys)) return;

              const cardLabel = String(issue.issueId || issue.title || "Unspecified Card").trim() || "Unspecified Card";
              userAggregation.notes.push({
                text: String(note.text || "").trim(),
                timestamp: Number(note.timestamp) || 0,
                cardLabel,
                title: String(issue.title || "").trim(),
                projectName: String(issue.projectName || "").trim() || "Unknown Project",
                projectDocId: "",
                issueId: String(issue.issueId || "").trim(),
                taskIdentity: "",
              });
            });
          });
        });

        const users = Array.from(userAggregationByLabel.entries())
          .map(([name, aggregate]) => {
            const cards = Array.from(aggregate.cardsByKey.values())
              .sort((left, right) => right.milliseconds - left.milliseconds);

            const dedupedNotesMap = new Map();
            aggregate.notes.forEach((note) => {
              const dedupeKey = `${String(note.projectName || "").trim().toLowerCase()}::${String(note.cardLabel || "").trim().toLowerCase()}::${String(note.text || "").trim().toLowerCase()}`;
              if (!note.text || dedupedNotesMap.has(dedupeKey)) return;
              dedupedNotesMap.set(dedupeKey, note);
            });

            const notes = Array.from(dedupedNotesMap.values()).sort((left, right) => right.timestamp - left.timestamp);

            return {
              name,
              milliseconds: aggregate.milliseconds,
              regularMilliseconds: aggregate.regularMilliseconds,
              overtimeMilliseconds: aggregate.overtimeMilliseconds,
              cards,
              notes,
            };
          })
          .sort((left, right) => right.milliseconds - left.milliseconds);

        return [invoice.id, {
          totalMilliseconds,
          totalRegularMilliseconds,
          totalOvertimeMilliseconds,
          users,
        }];
      })
    );
  }, [
    billableTimeRotateLogs,
    invoices,
    issueTitleByIdentity,
    issueTitleByIssueId,
    projectIssuesByProjectNameKey,
    selectedProjectId,
    selectedTimeRotateProjectNameKeys,
    associatedTimeRotateProjectNameKeysByProjectId,
    tdInvoiceProjectIdByIdentity,
    projectNamesWithExplicitTdMatches,
    weeklyOvertimeAllocationByLogId,
  ]);

  const allProjectsTotal = useMemo(() => {
    return (allProjectInvoices || []).reduce((sum, invoice) => {
      const status = normalizeInvoiceStatus(invoice?.invoiceStatus, invoice?.total, invoice?.invoiceNumber);
      if (status !== "final") return sum;
      return sum + (Number(invoice?.total || 0) || 0);
    }, 0);
  }, [allProjectInvoices]);

  const allProjectsBudgetedInvoiceTotal = useMemo(() => {
    return (allProjectInvoices || []).reduce((sum, invoice) => {
      const status = normalizeInvoiceStatus(invoice?.invoiceStatus, invoice?.total, invoice?.invoiceNumber);
      if (status !== "budgeted") return sum;
      return sum + (Number(invoice?.total || 0) || 0);
    }, 0);
  }, [allProjectInvoices]);

  const allProjectsSubtotalInvoiceTotal = useMemo(() => {
    return (Number(allProjectsTotal || 0) || 0) + (Number(allProjectsBudgetedInvoiceTotal || 0) || 0);
  }, [allProjectsBudgetedInvoiceTotal, allProjectsTotal]);

  const projectTotalsLiveById = useMemo(() => {
    const totals = {};
    (allProjectInvoices || []).forEach((invoice) => {
      const projectId = String(invoice?.projectId || "").trim();
      if (!projectId) return;
      totals[projectId] = (totals[projectId] || 0) + (Number(invoice?.total || 0) || 0);
    });

    return Object.fromEntries(
      Object.entries(totals).map(([projectId, total]) => [projectId, Math.round(total * 100) / 100])
    );
  }, [allProjectInvoices]);

  const projectDueTotalsLiveById = useMemo(() => {
    const totals = {};
    (allProjectInvoices || []).forEach((invoice) => {
      const projectId = String(invoice?.projectId || "").trim();
      if (!projectId) return;
      if (!isDueOnOrBeforeToday(invoice?.dueDate)) return;

      totals[projectId] = (totals[projectId] || 0) + (Number(invoice?.total || 0) || 0);
    });

    return Object.fromEntries(
      Object.entries(totals).map(([projectId, total]) => [projectId, Math.round(total * 100) / 100])
    );
  }, [allProjectInvoices]);

  const allProjectsDueTotal = useMemo(() => {
    return (allProjectInvoices || []).reduce((sum, invoice) => {
      if (!isDueOnOrBeforeToday(invoice?.dueDate)) return sum;
      return sum + (Number(invoice?.total || 0) || 0);
    }, 0);
  }, [allProjectInvoices]);

  const projectFinalTotalsLiveById = useMemo(() => {
    const totals = {};
    (allProjectInvoices || []).forEach((invoice) => {
      const projectId = String(invoice?.projectId || "").trim();
      if (!projectId) return;

      const status = normalizeInvoiceStatus(invoice?.invoiceStatus, invoice?.total, invoice?.invoiceNumber);
      if (status !== "final") return;

      totals[projectId] = (totals[projectId] || 0) + (Number(invoice?.total || 0) || 0);
    });

    return Object.fromEntries(
      Object.entries(totals).map(([projectId, total]) => [projectId, Math.round(total * 100) / 100])
    );
  }, [allProjectInvoices]);

  const projectBudgetedInvoiceTotalsLiveById = useMemo(() => {
    const totals = {};
    (allProjectInvoices || []).forEach((invoice) => {
      const projectId = String(invoice?.projectId || "").trim();
      if (!projectId) return;

      const status = normalizeInvoiceStatus(invoice?.invoiceStatus, invoice?.total, invoice?.invoiceNumber);
      if (status !== "budgeted") return;

      totals[projectId] = (totals[projectId] || 0) + (Number(invoice?.total || 0) || 0);
    });

    return Object.fromEntries(
      Object.entries(totals).map(([projectId, total]) => [projectId, Math.round(total * 100) / 100])
    );
  }, [allProjectInvoices]);

  const projectSubtotalInvoiceTotalsLiveById = useMemo(() => {
    const subtotal = {};
    const allProjectIds = new Set([
      ...Object.keys(projectFinalTotalsLiveById || {}),
      ...Object.keys(projectBudgetedInvoiceTotalsLiveById || {}),
    ]);

    allProjectIds.forEach((projectId) => {
      const finalTotal = Number(projectFinalTotalsLiveById?.[projectId] || 0) || 0;
      const budgetedTotal = Number(projectBudgetedInvoiceTotalsLiveById?.[projectId] || 0) || 0;
      subtotal[projectId] = Math.round((finalTotal + budgetedTotal) * 100) / 100;
    });

    return subtotal;
  }, [projectBudgetedInvoiceTotalsLiveById, projectFinalTotalsLiveById]);

  const invoiceTableTotals = useMemo(() => {
    const totals = {
      totalInvoiceAmount: 0,
      totalFinalInvoiceAmount: 0,
      totalBudgetedInvoiceAmount: 0,
      totalMilliseconds: 0,
      totalRegularMilliseconds: 0,
      totalOvertimeMilliseconds: 0,
    };

    (invoices || []).forEach((invoice) => {
      totals.totalInvoiceAmount += Number(invoice?.total || 0) || 0;
      const status = normalizeInvoiceStatus(invoice?.invoiceStatus, invoice?.total, invoice?.invoiceNumber);
      if (status === "final") {
        totals.totalFinalInvoiceAmount += Number(invoice?.total || 0) || 0;
      } else if (status === "budgeted") {
        totals.totalBudgetedInvoiceAmount += Number(invoice?.total || 0) || 0;
      }

      const hoursData = invoiceHoursById[invoice?.id] || {
        totalMilliseconds: 0,
        totalRegularMilliseconds: 0,
        totalOvertimeMilliseconds: 0,
      };

      totals.totalMilliseconds += Number(hoursData.totalMilliseconds || 0) || 0;
      totals.totalRegularMilliseconds += Number(hoursData.totalRegularMilliseconds || 0) || 0;
      totals.totalOvertimeMilliseconds += Number(hoursData.totalOvertimeMilliseconds || 0) || 0;
    });

    const laborCost = getLaborCostFromSplit(totals.totalRegularMilliseconds, totals.totalOvertimeMilliseconds);
    return {
      totalInvoiceAmount: totals.totalInvoiceAmount,
      totalFinalInvoiceAmount: totals.totalFinalInvoiceAmount,
      totalBudgetedInvoiceAmount: totals.totalBudgetedInvoiceAmount,
      subtotalInvoiceAmount: totals.totalFinalInvoiceAmount + totals.totalBudgetedInvoiceAmount,
      totalMilliseconds: totals.totalMilliseconds,
      totalLaborCost: laborCost.totalCost,
      totalOvertimeHours: laborCost.overtimeHours,
    };
  }, [invoiceHoursById, invoices]);

  const availableProjectWeeksByProjectId = useMemo(() => {
    const weekMap = new Map();

    (allProjectInvoices || []).forEach((invoice) => {
      const projectId = String(invoice?.projectId || "").trim();
      const weekNumber = Number(invoice?.weekNumber || 0);
      if (!projectId || !weekNumber) return;

      if (!weekMap.has(projectId)) {
        weekMap.set(projectId, new Set());
      }
      weekMap.get(projectId).add(weekNumber);
    });

    return Object.fromEntries(
      Array.from(weekMap.entries()).map(([projectId, weekSet]) => [
        projectId,
        Array.from(weekSet).sort((left, right) => left - right),
      ])
    );
  }, [allProjectInvoices]);

  const duplicateSystemInvoices = useMemo(() => {
    const grouped = new Map();

    (allProjectInvoices || []).forEach((row) => {
      const key = normalizeInvoiceMatchKey(row?.invoiceNumber);
      if (!key) return;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key).push(row);
    });

    return Array.from(grouped.entries())
      .filter(([, rows]) => rows.length > 1)
      .map(([key, rows]) => ({
        invoiceNumberKey: key,
        invoiceNumber: normalizeInvoiceNumber(rows[0]?.invoiceNumber || key),
        count: rows.length,
        rows: rows
          .slice()
          .sort((left, right) => {
            const leftProject = String(left?.projectName || "").toLowerCase();
            const rightProject = String(right?.projectName || "").toLowerCase();
            if (leftProject !== rightProject) {
              return leftProject.localeCompare(rightProject);
            }
            return Number(left?.weekNumber || 0) - Number(right?.weekNumber || 0);
          }),
      }))
      .sort((left, right) => left.invoiceNumber.localeCompare(right.invoiceNumber));
  }, [allProjectInvoices]);

  const excelRowsByInvoiceKey = useMemo(() => {
    const grouped = new Map();
    (excelInvoiceRows || []).forEach((row) => {
      const key = normalizeInvoiceFuzzyKey(row?.invoiceNumber || row?.invoiceNumberKey);
      if (!key) return;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key).push(row);
    });
    return grouped;
  }, [excelInvoiceRows]);

  const reconciliationDiscrepancies = useMemo(() => {
    if (!reconciliationResult) return [];

    const rows = [];

    (reconciliationResult.missingInSystem || []).forEach((row) => {
      rows.push({
        type: "Missing in System",
        invoiceNumber: row.invoiceNumber || "-",
        projectName: row.projectName || "-",
        weekNumber: "-",
        systemTotal: "-",
        expectedExcel: row.total === null ? "-" : formatCurrency(row.total),
        reason: "Exists in Excel but not in system invoices.",
      });
    });

    (reconciliationResult.missingInExcel || []).forEach((row) => {
      rows.push({
        type: "Missing in Excel",
        invoiceNumber: row.invoiceNumber || "-",
        projectName: row.projectName || "-",
        weekNumber: row.weekNumber || "-",
        systemTotal: row.total === null ? "-" : formatCurrency(row.total),
        expectedExcel: "-",
        reason: "Exists in system but not in imported Excel.",
      });
    });

    (reconciliationResult.totalMismatch || []).forEach((row) => {
      const expectedExcelTotals = (row.excelEntries || [])
        .map((entry) => parseAmountValue(entry?.total))
        .filter((value) => value !== null)
        .map((value) => formatCurrency(value));

      const systemEntries = Array.isArray(row.appEntries) ? row.appEntries : [];
      if (systemEntries.length === 0) {
        rows.push({
          type: "Total mismatch",
          invoiceNumber: row.invoiceNumber || "-",
          projectName: "-",
          weekNumber: "-",
          systemTotal: "-",
          expectedExcel: expectedExcelTotals.join(", ") || "-",
          reason: "Invoice number found but totals do not align.",
        });
      } else {
        systemEntries.forEach((entry) => {
          const systemTotal = parseAmountValue(entry?.total);
          rows.push({
            type: "Total mismatch",
            invoiceNumber: row.invoiceNumber || "-",
            projectName: entry?.projectName || "-",
            weekNumber: entry?.weekNumber || "-",
            systemTotal: systemTotal === null ? "-" : formatCurrency(systemTotal),
            expectedExcel: expectedExcelTotals.join(", ") || "-",
            reason: "Invoice number found but totals do not align.",
          });
        });
      }
    });

    return rows;
  }, [reconciliationResult]);

  const normalizeReportForUi = (savedReport = {}) => {
    const normalizedMissingInSystem = Array.isArray(savedReport?.missingInSystem)
      ? savedReport.missingInSystem.map((row) => ({
        invoiceNumber: String(row?.invoiceNumber || "").trim(),
        invoiceNumberKey: normalizeInvoiceFuzzyKey(row?.invoiceNumber),
        total: parseAmountValue(row?.total),
        projectName: String(row?.projectName || "").trim(),
        rowNumber: Number(row?.rowNumber || 0) || "",
      }))
      : [];

    const normalizedMissingInExcel = Array.isArray(savedReport?.missingInExcel)
      ? savedReport.missingInExcel.map((row) => ({
        invoiceNumber: String(row?.invoiceNumber || "").trim(),
        invoiceNumberKey: normalizeInvoiceFuzzyKey(row?.invoiceNumber),
        total: parseAmountValue(row?.total),
        projectId: String(row?.projectId || "").trim(),
        projectName: String(row?.projectName || "").trim(),
        weekNumber: Number(row?.weekNumber || 0) || "",
        dueDate: String(row?.dueDate || "").trim(),
      }))
      : [];

    const normalizedTotalMismatch = Array.isArray(savedReport?.totalMismatch)
      ? savedReport.totalMismatch.map((row) => {
        if (Array.isArray(row?.excelEntries) && Array.isArray(row?.appEntries)) {
          return {
            invoiceNumber: String(row?.invoiceNumber || "").trim(),
            excelEntries: row.excelEntries,
            appEntries: row.appEntries,
            unmatchedExcelEntries: row.unmatchedExcelEntries || [],
            unmatchedAppEntries: row.unmatchedAppEntries || [],
          };
        }

        const excelTotals = Array.isArray(row?.excelTotals) ? row.excelTotals : [];
        const systemTotals = Array.isArray(row?.systemTotals) ? row.systemTotals : [];
        const systemProjects = Array.isArray(row?.systemProjects) ? row.systemProjects : [];

        return {
          invoiceNumber: String(row?.invoiceNumber || "").trim(),
          excelEntries: excelTotals.map((total) => ({ total: parseAmountValue(total) })),
          appEntries: systemTotals.map((total, index) => ({
            total: parseAmountValue(total),
            projectName: String(systemProjects[index] || systemProjects[0] || "").trim(),
          })),
          unmatchedExcelEntries: [],
          unmatchedAppEntries: [],
        };
      })
      : [];

    const generatedAtIso = String(savedReport?.generatedAtIso || "").trim();

    return {
      excelRowsCount: Number(savedReport?.summary?.excelRowsCount || 0),
      appRowsCount: Number(savedReport?.summary?.appRowsCount || 0),
      matchedCount: Number(savedReport?.summary?.matchedCount || 0),
      missingInSystem: normalizedMissingInSystem,
      missingInExcel: normalizedMissingInExcel,
      totalMismatch: normalizedTotalMismatch,
      generatedAt: generatedAtIso || new Date().toISOString(),
    };
  };

  const normalizeResolvedItemsForUi = (savedReport = {}) => {
    if (!Array.isArray(savedReport?.resolvedItems)) return [];

    return savedReport.resolvedItems.map((item) => {
      const type = String(item?.type || "Resolved").trim();
      const invoiceNumber = String(item?.invoiceNumber || "").trim();
      const total = parseAmountValue(item?.total);
      const projectName = String(item?.projectName || "").trim();
      const projectId = String(item?.projectId || "").trim();
      const weekNumber = Number(item?.weekNumber || 0) || "";

      return {
        key: type.toLowerCase().includes("system")
          ? buildMissingInSystemKey({ invoiceNumber, total, projectName })
          : buildMissingInExcelKey({ invoiceNumber, total, projectName, projectId, weekNumber }),
        type,
        invoiceNumber,
        total,
        projectName,
        projectId,
        weekNumber,
        resolvedAt: String(item?.resolvedAt || "").trim() || new Date().toISOString(),
      };
    });
  };

  useEffect(() => {
    let active = true;

    const check = async () => {
      if (!user || !id) {
        if (!active) return;
        setCanManageInvoices(false);
        setCheckingPermissions(false);
        return;
      }

      try {
        const canManage = await canManageModule(user, id, "invoices");
        if (!active) return;
        setCanManageInvoices(Boolean(canManage));
      } catch (error) {
        console.error("Error checking invoice permissions:", error);
        if (!active) return;
        setCanManageInvoices(false);
      } finally {
        if (active) {
          setCheckingPermissions(false);
        }
      }
    };

    check();

    return () => {
      active = false;
    };
  }, [id, user]);

  useEffect(() => {
    if (!id) {
      setLoadingProjects(false);
      return undefined;
    }

    setLoadingProjects(true);

    const projectsQuery = query(projectsRef, orderBy("createdAt", "desc"));

    const unsubscribe = onSnapshot(
      projectsQuery,
      (snapshot) => {
        const nextProjects = snapshot.docs.map((projectDoc) => ({
          id: projectDoc.id,
          ...projectDoc.data(),
        }));

        setProjects(nextProjects);

        if (!selectedProjectId && nextProjects.length > 0) {
          setSelectedProjectId(nextProjects[0].id);
        }

        if (selectedProjectId && !nextProjects.some((project) => project.id === selectedProjectId)) {
          setSelectedProjectId(nextProjects[0]?.id || "");
          setInvoices([]);
        }

        setLoadingProjects(false);
      },
      (error) => {
        console.error("Error loading invoice projects:", error);
        toast.error("Failed to load invoice projects.");
        setLoadingProjects(false);
      }
    );

    return unsubscribe;
  }, [id, projectsRef, selectedProjectId]);

  // Remembers the last viewed project per organization so returning to this page keeps the same selection.
  useEffect(() => {
    if (typeof window === "undefined" || !id) return;

    try {
      if (selectedProjectId) {
        window.localStorage.setItem(getLastSelectedProjectStorageKey(), selectedProjectId);
      } else {
        window.localStorage.removeItem(getLastSelectedProjectStorageKey());
      }
    } catch (error) {
      // Ignore storage failures (e.g., private browsing mode).
    }
  }, [id, selectedProjectId]);

  useEffect(() => {
    if (!invoicesRef) {
      setInvoices([]);
      setLoadingInvoices(false);
      return undefined;
    }

    setLoadingInvoices(true);
    const invoicesQuery = query(invoicesRef, orderBy("weekNumber", "asc"));

    const unsubscribe = onSnapshot(
      invoicesQuery,
      (snapshot) => {
        const nextInvoices = snapshot.docs.map((invoiceDoc) => ({
          id: invoiceDoc.id,
          ...invoiceDoc.data(),
          invoiceStatus: normalizeInvoiceStatus(invoiceDoc.data()?.invoiceStatus, invoiceDoc.data()?.total, invoiceDoc.data()?.invoiceNumber),
        }));
        setInvoices(nextInvoices);
        setLoadingInvoices(false);
      },
      (error) => {
        console.error("Error loading invoices:", error);
        toast.error("Failed to load invoices.");
        setLoadingInvoices(false);
      }
    );

    return unsubscribe;
  }, [invoicesRef]);

  useEffect(() => {
    if (!id || projects.length === 0) {
      setProjectTotalsById({});
      setProjectDueTotalsById({});
      setProjectBudgetedTotalsById({});
      setProjectFinalTotalsById({});
      return;
    }

    let active = true;

    const loadProjectTotals = async () => {
      try {
        const entries = await Promise.all(
          projects.map(async (project) => {
            const projectInvoicesRef = collection(db, "churches", id, "invoiceProjects", project.id, "invoices");
            const projectInvoicesSnapshot = await getDocs(projectInvoicesRef);
            const projectTotal = projectInvoicesSnapshot.docs.reduce((sum, invoiceDoc) => {
              const invoiceData = invoiceDoc.data() || {};
              return sum + (Number(invoiceData.total || 0) || 0);
            }, 0);

            const projectDueTotal = projectInvoicesSnapshot.docs.reduce((sum, invoiceDoc) => {
              const invoiceData = invoiceDoc.data() || {};
              if (!isDueOnOrBeforeToday(invoiceData.dueDate)) {
                return sum;
              }

              return sum + (Number(invoiceData.total || 0) || 0);
            }, 0);

            const projectBudgetedTotal = projectInvoicesSnapshot.docs.reduce((sum, invoiceDoc) => {
              const invoiceData = invoiceDoc.data() || {};
              const status = normalizeInvoiceStatus(invoiceData.invoiceStatus, invoiceData.total, invoiceData.invoiceNumber);
              if (status !== "budgeted") return sum;
              return sum + (Number(invoiceData.total || 0) || 0);
            }, 0);

            const projectFinalTotal = projectInvoicesSnapshot.docs.reduce((sum, invoiceDoc) => {
              const invoiceData = invoiceDoc.data() || {};
              const status = normalizeInvoiceStatus(invoiceData.invoiceStatus, invoiceData.total, invoiceData.invoiceNumber);
              if (status !== "final") return sum;
              return sum + (Number(invoiceData.total || 0) || 0);
            }, 0);

            return {
              projectId: project.id,
              total: Math.round(projectTotal * 100) / 100,
              dueTotal: Math.round(projectDueTotal * 100) / 100,
              budgetedTotal: Math.round(projectBudgetedTotal * 100) / 100,
              finalTotal: Math.round(projectFinalTotal * 100) / 100,
            };
          })
        );

        if (!active) return;
        setProjectTotalsById(
          Object.fromEntries(entries.map((entry) => [entry.projectId, entry.total]))
        );
        setProjectDueTotalsById(
          Object.fromEntries(entries.map((entry) => [entry.projectId, entry.dueTotal]))
        );
        setProjectBudgetedTotalsById(
          Object.fromEntries(entries.map((entry) => [entry.projectId, entry.budgetedTotal]))
        );
        setProjectFinalTotalsById(
          Object.fromEntries(entries.map((entry) => [entry.projectId, entry.finalTotal]))
        );
      } catch (error) {
        console.error("Error loading project totals:", error);
      }
    };

    loadProjectTotals();

    return () => {
      active = false;
    };
  }, [id, projects]);

  useEffect(() => {
    if (!selectedProjectId) {
      return;
    }

    const selectedProjectTotal = invoices.reduce((sum, invoice) => {
      return sum + (Number(invoice?.total || 0) || 0);
    }, 0);

    const selectedProjectDueTotal = invoices.reduce((sum, invoice) => {
      if (!isDueOnOrBeforeToday(invoice?.dueDate)) {
        return sum;
      }

      return sum + (Number(invoice?.total || 0) || 0);
    }, 0);

    const selectedProjectBudgetedTotal = invoices.reduce((sum, invoice) => {
      const status = normalizeInvoiceStatus(invoice?.invoiceStatus, invoice?.total, invoice?.invoiceNumber);
      if (status !== "budgeted") return sum;

      const rowHoursData = invoiceHoursById[invoice.id] || {
        totalRegularMilliseconds: 0,
        totalOvertimeMilliseconds: 0,
      };
      const rowLaborCost = getLaborCostFromSplit(
        rowHoursData.totalRegularMilliseconds,
        rowHoursData.totalOvertimeMilliseconds
      );

      return sum + (Number(rowLaborCost.totalCost || 0) || 0);
    }, 0);

    const selectedProjectFinalTotal = invoices.reduce((sum, invoice) => {
      const status = normalizeInvoiceStatus(invoice?.invoiceStatus, invoice?.total, invoice?.invoiceNumber);
      if (status !== "final") return sum;
      return sum + (Number(invoice?.total || 0) || 0);
    }, 0);

    setProjectTotalsById((previous) => ({
      ...previous,
      [selectedProjectId]: Math.round(selectedProjectTotal * 100) / 100,
    }));

    setProjectDueTotalsById((previous) => ({
      ...previous,
      [selectedProjectId]: Math.round(selectedProjectDueTotal * 100) / 100,
    }));

    setProjectBudgetedTotalsById((previous) => ({
      ...previous,
      [selectedProjectId]: Math.round(selectedProjectBudgetedTotal * 100) / 100,
    }));

    setProjectFinalTotalsById((previous) => ({
      ...previous,
      [selectedProjectId]: Math.round(selectedProjectFinalTotal * 100) / 100,
    }));
  }, [selectedProjectId, invoices, invoiceHoursById]);

  useEffect(() => {
    if (!selectedProjectId) {
      setInvoiceDraft({ ...emptyInvoiceDraft });
      setIsInvoiceDraftDirty(false);
      return;
    }

    if (isInvoiceDraftDirty) {
      return;
    }

    const suggestion = getNextWeekSuggestion(invoices);
    setInvoiceDraft((previous) => ({
      ...previous,
      weekNumber: suggestion.weekNumber,
      mondayDate: suggestion.mondayDate,
      dueDate: suggestion.dueDate,
      paymentTerms: suggestion.paymentTerms,
    }));
  }, [selectedProjectId, invoices, isInvoiceDraftDirty]);

  useEffect(() => {
    if (!invoiceDraft.mondayDate) {
      setInvoiceDraft((previous) => ({ ...previous, dueDate: "" }));
      return;
    }

    const netDays = resolveNetDays(invoiceDraft.paymentTerms);
    const computedDueDate = shiftDateInputValue(invoiceDraft.mondayDate, netDays);
    setInvoiceDraft((previous) => {
      if (previous.dueDate === computedDueDate) {
        return previous;
      }

      return {
        ...previous,
        dueDate: computedDueDate,
      };
    });
  }, [invoiceDraft.mondayDate, invoiceDraft.paymentTerms]);

  useEffect(() => {
    if (!id) {
      setLoadingAllProjectInvoices(false);
      return undefined;
    }

    if (projects.length === 0) {
      setAllProjectInvoices([]);
      setLoadingAllProjectInvoices(false);
      return undefined;
    }

    let active = true;
    setLoadingAllProjectInvoices(true);
    const invoicesByProjectId = new Map();

    const unsubscribeListeners = projects.map((project) => {
      const projectInvoicesRef = collection(db, "churches", id, "invoiceProjects", project.id, "invoices");
      const projectInvoicesQuery = query(projectInvoicesRef, orderBy("weekNumber", "asc"));

      return onSnapshot(
        projectInvoicesQuery,
        (snapshot) => {
          if (!active) return;

          const projectRows = snapshot.docs.map((invoiceDoc) => {
            const invoiceData = invoiceDoc.data() || {};
            return {
              id: invoiceDoc.id,
              projectId: project.id,
              projectName: String(project.name || "Untitled Project").trim() || "Untitled Project",
              invoiceNumber: String(invoiceData.invoiceNumber || "").trim(),
              invoiceNumberKey: normalizeInvoiceFuzzyKey(invoiceData.invoiceNumber),
              total: parseAmountValue(invoiceData.total),
              mondayDate: toDateInputValue(invoiceData.mondayDate),
              dueDate: toDateInputValue(invoiceData.dueDate),
              paymentTerms: String(invoiceData.paymentTerms || "net30").trim().toLowerCase() || "net30",
              netDays: resolveNetDays(invoiceData.paymentTerms, invoiceData.netDays),
              isPaid: Boolean(invoiceData.isPaid),
              invoiceStatus: normalizeInvoiceStatus(invoiceData.invoiceStatus, invoiceData.total, invoiceData.invoiceNumber),
              weekNumber: Number(invoiceData.weekNumber || 0) || "",
              changeLog: Array.isArray(invoiceData.changeLog) ? invoiceData.changeLog : [],
            };
          });

          invoicesByProjectId.set(project.id, projectRows);
          setAllProjectInvoices(Array.from(invoicesByProjectId.values()).flat());
          setLoadingAllProjectInvoices(false);
        },
        (error) => {
          console.error("Error loading project invoices for reconciliation:", error);
          if (!active) return;
          setLoadingAllProjectInvoices(false);
          toast.error("Failed to live refresh invoices for comparison.");
        }
      );
    });

    return () => {
      active = false;
      unsubscribeListeners.forEach((unsubscribe) => unsubscribe());
    };
  }, [id, projects]);

  const projectBudgetedHoursCostById = useMemo(() => {
    if (!Array.isArray(allProjectInvoices) || allProjectInvoices.length === 0) {
      return {};
    }

    const totalsByProjectId = {};

    allProjectInvoices.forEach((invoice) => {
      const projectId = String(invoice?.projectId || "").trim();
      if (!projectId) return;

      const status = normalizeInvoiceStatus(invoice?.invoiceStatus, invoice?.total, invoice?.invoiceNumber);
      if (status !== "budgeted") return;

      const associatedProjectKeys = associatedTimeRotateProjectNameKeysByProjectId[projectId] || new Set();
      if (associatedProjectKeys.size === 0) {
        if (!Object.prototype.hasOwnProperty.call(totalsByProjectId, projectId)) {
          totalsByProjectId[projectId] = 0;
        }
        return;
      }

      const mondayDate = toDateInputValue(invoice?.mondayDate);
      const weekEndDate = shiftDateInputValue(mondayDate, 6);
      const rangeStart = mondayDate ? Date.parse(`${mondayDate}T00:00:00`) : Number.NaN;
      const rangeEnd = weekEndDate ? Date.parse(`${weekEndDate}T23:59:59.999`) : Number.NaN;
      if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd)) return;

      let rowRegularMilliseconds = 0;
      let rowOvertimeMilliseconds = 0;

      billableTimeRotateLogs.forEach((log) => {
        if (!associatedProjectKeys.has(log.projectNameKey)) return;
        if (log.eventTimestamp < rangeStart || log.eventTimestamp > rangeEnd) return;

        const allocation = weeklyOvertimeAllocationByLogId[log.id] || {
          regularMilliseconds: log.safeDuration,
          overtimeMilliseconds: 0,
        };

        rowRegularMilliseconds += allocation.regularMilliseconds;
        rowOvertimeMilliseconds += allocation.overtimeMilliseconds;
      });

      const rowCost = getLaborCostFromSplit(rowRegularMilliseconds, rowOvertimeMilliseconds).totalCost;
      totalsByProjectId[projectId] = (totalsByProjectId[projectId] || 0) + (Number(rowCost) || 0);
    });

    return Object.fromEntries(
      Object.entries(totalsByProjectId).map(([projectId, totalCost]) => [projectId, Math.round(totalCost * 100) / 100])
    );
  }, [allProjectInvoices, associatedTimeRotateProjectNameKeysByProjectId, billableTimeRotateLogs, weeklyOvertimeAllocationByLogId]);

  const allProjectsBudgetedHoursCost = useMemo(() => {
    return Object.values(projectBudgetedHoursCostById || {}).reduce((sum, value) => {
      return sum + (Number(value || 0) || 0);
    }, 0);
  }, [projectBudgetedHoursCostById]);

  const businessIntelligenceProjectRows = useMemo(() => {
    if (!Array.isArray(projects) || projects.length === 0) return [];

    return projects.map((project) => {
      const projectId = String(project?.id || "").trim();
      const projectInvoices = (allProjectInvoices || []).filter((invoice) => String(invoice?.projectId || "") === projectId);
      const associatedProjectKeys = associatedTimeRotateProjectNameKeysByProjectId[projectId] || new Set();

      const invoiceAmountTotal = projectInvoices.reduce((sum, invoice) => sum + (Number(invoice?.total || 0) || 0), 0);
      const budgetedInvoiceAmount = projectInvoices.reduce((sum, invoice) => {
        const status = normalizeInvoiceStatus(invoice?.invoiceStatus, invoice?.total, invoice?.invoiceNumber);
        return status === "budgeted" ? sum + (Number(invoice?.total || 0) || 0) : sum;
      }, 0);
      const finalInvoiceAmount = projectInvoices.reduce((sum, invoice) => {
        const status = normalizeInvoiceStatus(invoice?.invoiceStatus, invoice?.total, invoice?.invoiceNumber);
        return status === "final" ? sum + (Number(invoice?.total || 0) || 0) : sum;
      }, 0);

      let totalHoursMilliseconds = 0;
      let totalRegularMilliseconds = 0;
      let totalOvertimeMilliseconds = 0;

      if (associatedProjectKeys.size > 0) {
        projectInvoices.forEach((invoice) => {
          const mondayDate = toDateInputValue(invoice?.mondayDate);
          const weekEndDate = shiftDateInputValue(mondayDate, 6);
          const rangeStart = mondayDate ? Date.parse(`${mondayDate}T00:00:00`) : Number.NaN;
          const rangeEnd = weekEndDate ? Date.parse(`${weekEndDate}T23:59:59.999`) : Number.NaN;
          if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd)) return;

          billableTimeRotateLogs.forEach((log) => {
            if (!associatedProjectKeys.has(log.projectNameKey)) return;
            if (log.eventTimestamp < rangeStart || log.eventTimestamp > rangeEnd) return;

            const allocation = weeklyOvertimeAllocationByLogId[log.id] || {
              regularMilliseconds: log.safeDuration,
              overtimeMilliseconds: 0,
            };

            totalHoursMilliseconds += log.safeDuration;
            totalRegularMilliseconds += allocation.regularMilliseconds;
            totalOvertimeMilliseconds += allocation.overtimeMilliseconds;
          });
        });
      }

      const laborCost = getLaborCostFromSplit(totalRegularMilliseconds, totalOvertimeMilliseconds);
      const variance = invoiceAmountTotal - laborCost.totalCost;
      const marginPercent = invoiceAmountTotal > 0 ? (variance / invoiceAmountTotal) * 100 : 0;

      const budgetedCount = projectInvoices.filter((invoice) => normalizeInvoiceStatus(invoice?.invoiceStatus, invoice?.total, invoice?.invoiceNumber) === "budgeted").length;
      const finalCount = projectInvoices.filter((invoice) => normalizeInvoiceStatus(invoice?.invoiceStatus, invoice?.total, invoice?.invoiceNumber) === "final").length;
      const paidCount = projectInvoices.filter((invoice) => Boolean(invoice?.isPaid)).length;

      return {
        projectId,
        projectName: String(project?.name || "Untitled Project").trim() || "Untitled Project",
        invoicesCount: projectInvoices.length,
        budgetedCount,
        finalCount,
        paidCount,
        invoiceAmountTotal,
        budgetedInvoiceAmount,
        finalInvoiceAmount,
        budgetedHoursCost: Number(projectBudgetedHoursCostById[projectId] || 0) || 0,
        totalHoursMilliseconds,
        laborCostTotal: laborCost.totalCost,
        overtimeHours: laborCost.overtimeHours,
        variance,
        marginPercent,
      };
    }).sort((left, right) => right.invoiceAmountTotal - left.invoiceAmountTotal);
  }, [allProjectInvoices, associatedTimeRotateProjectNameKeysByProjectId, billableTimeRotateLogs, projectBudgetedHoursCostById, projects, weeklyOvertimeAllocationByLogId]);

  const businessIntelligenceSummary = useMemo(() => {
    const rows = businessIntelligenceProjectRows;
    const totalInvoiceAmount = rows.reduce((sum, row) => sum + row.invoiceAmountTotal, 0);
    const totalBudgetedInvoiceAmount = rows.reduce((sum, row) => sum + row.budgetedInvoiceAmount, 0);
    const totalFinalInvoiceAmount = rows.reduce((sum, row) => sum + row.finalInvoiceAmount, 0);
    const totalLaborCost = rows.reduce((sum, row) => sum + row.laborCostTotal, 0);
    const totalBudgetedHoursCost = rows.reduce((sum, row) => sum + row.budgetedHoursCost, 0);
    const totalRevenueVariance = rows.reduce((sum, row) => sum + row.variance, 0);
    const totalCombinedTarget = totalFinalInvoiceAmount + totalBudgetedHoursCost;
    const totalProjectedVariance = totalCombinedTarget - totalLaborCost;

    return {
      projectsCount: rows.length,
      invoicesCount: rows.reduce((sum, row) => sum + row.invoicesCount, 0),
      budgetedCount: rows.reduce((sum, row) => sum + row.budgetedCount, 0),
      finalCount: rows.reduce((sum, row) => sum + row.finalCount, 0),
      paidCount: rows.reduce((sum, row) => sum + row.paidCount, 0),
      totalInvoiceAmount,
      totalBudgetedInvoiceAmount,
      totalFinalInvoiceAmount,
      totalLaborCost,
      totalHours: rows.reduce((sum, row) => sum + row.totalHoursMilliseconds, 0),
      totalOvertimeHours: rows.reduce((sum, row) => sum + row.overtimeHours, 0),
      totalVariance: totalRevenueVariance,
      totalRevenueVariance,
      totalBudgetedHoursCost,
      totalCombinedTarget,
      totalProjectedVariance,
    };
  }, [businessIntelligenceProjectRows]);

  const businessIntelligenceFinancialCompositionRows = useMemo(() => {
    const finalBilledRevenue = Number(allProjectsTotal || 0) || 0;
    const budgetedInvoiceTotal = Number(allProjectsBudgetedInvoiceTotal || 0) || 0;
    const subtotalInvoiceTotal = Number(allProjectsSubtotalInvoiceTotal || 0) || 0;

    const rows = [
      { key: "final-billed", label: "All Projects Total Billed (Final)", value: finalBilledRevenue, color: "#1D4ED8" },
      { key: "budgeted", label: "All Projects Total Budgeted", value: budgetedInvoiceTotal, color: "#7C3AED" },
      { key: "subtotal", label: "All Projects Subtotal (Final + Budgeted)", value: subtotalInvoiceTotal, color: "#0F766E" },
    ];

    const maxValue = rows.reduce((max, row) => Math.max(max, row.value), 0);
    return rows.map((row) => ({
      ...row,
      widthPercent: maxValue > 0 ? (row.value / maxValue) * 100 : 0,
    }));
  }, [allProjectsBudgetedInvoiceTotal, allProjectsSubtotalInvoiceTotal, allProjectsTotal]);

  const businessIntelligenceOverdueAnalysis = useMemo(() => {
    const todayDateInput = toDateInputValue(new Date());
    const projectNameById = new Map(
      (projects || []).map((project) => [
        String(project?.id || "").trim(),
        String(project?.name || "").trim(),
      ])
    );

    const overdueByProject = new Map();
    let overdueCount = 0;
    let overdueAmount = 0;

    (allProjectInvoices || []).forEach((invoice) => {
      if (invoice?.isPaid) return;

      const invoiceTotal = Number(invoice?.total || 0) || 0;
      if (invoiceTotal <= 0) return;

      const mondayDate = toDateInputValue(invoice?.mondayDate);
      const dueByTermsDate = toDateInputValue(invoice?.dueDate)
        || (mondayDate ? shiftDateInputValue(mondayDate, resolveNetDays(invoice?.paymentTerms, invoice?.netDays)) : "");
      const overdueNinetyDate = mondayDate ? shiftDateInputValue(mondayDate, 90) : "";

      const isOverdueByTerms = Boolean(dueByTermsDate) && dueByTermsDate < todayDateInput;
      const isOverdueByNinety = Boolean(overdueNinetyDate) && overdueNinetyDate < todayDateInput;

      if (!isOverdueByTerms && !isOverdueByNinety) return;

      overdueCount += 1;
      overdueAmount += invoiceTotal;

      const projectId = String(invoice?.projectId || "").trim() || "__unknown__";
      const fallbackName = String(invoice?.projectName || "").trim();
      const projectName = projectNameById.get(projectId) || fallbackName || "Unassigned Project";
      const existing = overdueByProject.get(projectId) || {
        projectId,
        projectName,
        count: 0,
        amount: 0,
      };

      overdueByProject.set(projectId, {
        ...existing,
        count: existing.count + 1,
        amount: existing.amount + invoiceTotal,
      });
    });

    const byProjectRows = Array.from(overdueByProject.values())
      .sort((left, right) => right.amount - left.amount);

    return {
      count: overdueCount,
      amount: overdueAmount,
      byProjectRows,
    };
  }, [allProjectInvoices, projects]);

  const businessIntelligenceStatusRows = useMemo(() => {
    const invoicesCount = Number(businessIntelligenceSummary.invoicesCount || 0) || 0;
    const budgetedCount = Number(businessIntelligenceSummary.budgetedCount || 0) || 0;
    const finalCount = Number(businessIntelligenceSummary.finalCount || 0) || 0;
    const paidCount = Number(businessIntelligenceSummary.paidCount || 0) || 0;

    const budgetedInvoiceAmount = Number(businessIntelligenceSummary.totalBudgetedInvoiceAmount || 0) || 0;
    const finalAmount = Number(businessIntelligenceSummary.totalFinalInvoiceAmount || 0) || 0;
    const paidAmount = (allProjectInvoices || []).reduce((sum, invoice) => {
      if (!invoice?.isPaid) return sum;
      return sum + (Number(invoice?.total || 0) || 0);
    }, 0);

    const budgetedAmount = budgetedInvoiceAmount;

    const denominator = invoicesCount > 0 ? invoicesCount : 1;
    return [
      {
        key: "budgeted",
        label: "Budgeted",
        count: budgetedCount,
        amount: budgetedAmount,
        percent: (budgetedCount / denominator) * 100,
        color: "#0EA5E9",
      },
      {
        key: "final",
        label: "Final",
        count: finalCount,
        amount: finalAmount,
        percent: (finalCount / denominator) * 100,
        color: "#16A34A",
      },
      {
        key: "paid",
        label: "Paid",
        count: paidCount,
        amount: paidAmount,
        percent: (paidCount / denominator) * 100,
        color: "#F59E0B",
      },
      {
        key: "overdue",
        label: "Overdue (Past Terms or 90 Days)",
        count: businessIntelligenceOverdueAnalysis.count,
        amount: businessIntelligenceOverdueAnalysis.amount,
        percent: (businessIntelligenceOverdueAnalysis.count / denominator) * 100,
        color: "#DC2626",
      },
    ];
  }, [allProjectInvoices, businessIntelligenceOverdueAnalysis, businessIntelligenceSummary]);

  const businessIntelligenceTopRevenueRows = useMemo(() => {
    const rankedRows = [...businessIntelligenceProjectRows]
      .sort((left, right) => right.invoiceAmountTotal - left.invoiceAmountTotal)
      .slice(0, 8);

    const maxRevenue = rankedRows.reduce((max, row) => Math.max(max, Number(row.invoiceAmountTotal || 0) || 0), 0);

    return rankedRows.map((row) => {
      const revenue = Number(row.invoiceAmountTotal || 0) || 0;
      return {
        ...row,
        widthPercent: maxRevenue > 0 ? (revenue / maxRevenue) * 100 : 0,
      };
    });
  }, [businessIntelligenceProjectRows]);

  const businessIntelligenceProjectSharePie = useMemo(() => {
    const rows = [...(businessIntelligenceProjectRows || [])]
      .map((row) => ({
        projectId: row.projectId,
        projectName: row.projectName,
        revenue: Number(row.invoiceAmountTotal || 0) || 0,
      }))
      .filter((row) => row.revenue > 0)
      .sort((left, right) => right.revenue - left.revenue);

    const totalRevenue = rows.reduce((sum, row) => sum + row.revenue, 0);
    if (totalRevenue <= 0) {
      return {
        rows: [],
        totalRevenue: 0,
        gradient: "",
      };
    }

    let currentPercent = 0;
    const pieRows = rows.map((row, index) => {
      const percent = (row.revenue / totalRevenue) * 100;
      const startPercent = currentPercent;
      currentPercent += percent;

      return {
        ...row,
        percent,
        startPercent,
        endPercent: currentPercent,
        color: BI_PIE_CHART_COLORS[index % BI_PIE_CHART_COLORS.length],
      };
    });

    const gradient = pieRows
      .map((row) => `${row.color} ${row.startPercent.toFixed(4)}% ${row.endPercent.toFixed(4)}%`)
      .join(", ");

    return {
      rows: pieRows,
      totalRevenue,
      gradient,
    };
  }, [businessIntelligenceProjectRows]);

  const businessIntelligenceProjectTotalsRows = useMemo(() => {
    const rows = (projects || []).map((project) => {
      const projectId = String(project?.id || "").trim();
      return {
        projectId,
        projectName: String(project?.name || "Untitled Project").trim() || "Untitled Project",
        totalFinal: Number(projectFinalTotalsLiveById?.[projectId] || 0) || 0,
        totalBudgeted: Number(projectBudgetedInvoiceTotalsLiveById?.[projectId] || 0) || 0,
        subtotal: Number(projectSubtotalInvoiceTotalsLiveById?.[projectId] || 0) || 0,
        totalDue: Number(projectDueTotalsLiveById?.[projectId] || 0) || 0,
      };
    });

    return rows.sort((left, right) => right.subtotal - left.subtotal);
  }, [projectBudgetedInvoiceTotalsLiveById, projectDueTotalsLiveById, projectFinalTotalsLiveById, projectSubtotalInvoiceTotalsLiveById, projects]);

  const businessIntelligenceMonthlyRevenuePoints = useMemo(() => {
    const totalsByMonthKey = new Map();

    (allProjectInvoices || []).forEach((invoice) => {
      const mondayDateRaw = toDateInputValue(invoice?.mondayDate);
      if (!mondayDateRaw) return;

      const mondayDate = new Date(`${mondayDateRaw}T00:00:00`);
      if (Number.isNaN(mondayDate.getTime())) return;

      const monthKey = `${mondayDate.getFullYear()}-${String(mondayDate.getMonth() + 1).padStart(2, "0")}`;
      const invoiceTotal = Number(invoice?.total || 0) || 0;
      totalsByMonthKey.set(monthKey, (totalsByMonthKey.get(monthKey) || 0) + invoiceTotal);
    });

    return Array.from(totalsByMonthKey.entries())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([monthKey, total]) => {
        const [year, month] = monthKey.split("-");
        const labelDate = new Date(Number(year), Number(month) - 1, 1);
        const label = Number.isNaN(labelDate.getTime())
          ? monthKey
          : labelDate.toLocaleString("en-US", { month: "short", year: "2-digit" });

        return {
          monthKey,
          label,
          total,
        };
      });
  }, [allProjectInvoices]);

  const businessIntelligenceTrendInsights = useMemo(() => {
    const points = businessIntelligenceMonthlyRevenuePoints;
    if (!Array.isArray(points) || points.length === 0) {
      return {
        hasData: false,
      };
    }

    const latestPoint = points[points.length - 1];
    const previousPoint = points.length > 1 ? points[points.length - 2] : null;

    const delta = previousPoint ? (Number(latestPoint.total || 0) || 0) - (Number(previousPoint.total || 0) || 0) : 0;
    const deltaPercent = previousPoint && Number(previousPoint.total || 0) > 0
      ? (delta / Number(previousPoint.total || 0)) * 100
      : 0;

    const sortedByValue = [...points].sort((left, right) => (Number(right.total || 0) || 0) - (Number(left.total || 0) || 0));
    const peakMonth = sortedByValue[0] || null;
    const lowestMonth = sortedByValue[sortedByValue.length - 1] || null;

    const trailingCount = Math.min(3, points.length);
    const trailingPoints = points.slice(points.length - trailingCount);
    const trailingAverage = trailingPoints.reduce((sum, point) => sum + (Number(point.total || 0) || 0), 0) / trailingCount;

    return {
      hasData: true,
      latestPoint,
      previousPoint,
      delta,
      deltaPercent,
      peakMonth,
      lowestMonth,
      trailingAverage,
    };
  }, [businessIntelligenceMonthlyRevenuePoints]);

  const businessIntelligenceCollectionInsights = useMemo(() => {
    const finalRow = businessIntelligenceStatusRows.find((row) => row.key === "final");
    const paidRow = businessIntelligenceStatusRows.find((row) => row.key === "paid");

    const finalAmount = Number(finalRow?.amount || 0) || 0;
    const paidAmount = Number(paidRow?.amount || 0) || 0;
    const collectionRatePercent = finalAmount > 0 ? (paidAmount / finalAmount) * 100 : 0;
    const outstandingAmount = Math.max(0, finalAmount - paidAmount);

    return {
      finalAmount,
      paidAmount,
      collectionRatePercent,
      outstandingAmount,
    };
  }, [businessIntelligenceStatusRows]);

  const businessIntelligenceProjectInsights = useMemo(() => {
    const rows = Array.isArray(businessIntelligenceProjectRows) ? businessIntelligenceProjectRows : [];

    const topMarginProject = [...rows]
      .filter((row) => Number(row.invoiceAmountTotal || 0) > 0)
      .sort((left, right) => (Number(right.marginPercent || 0) || 0) - (Number(left.marginPercent || 0) || 0))[0] || null;

    const highestRevenueProject = [...rows]
      .sort((left, right) => (Number(right.invoiceAmountTotal || 0) || 0) - (Number(left.invoiceAmountTotal || 0) || 0))[0] || null;

    const riskProjects = rows
      .filter((row) => Number(row.variance || 0) < 0)
      .sort((left, right) => (Number(left.variance || 0) || 0) - (Number(right.variance || 0) || 0))
      .slice(0, 3);

    return {
      topMarginProject,
      highestRevenueProject,
      riskProjects,
    };
  }, [businessIntelligenceProjectRows]);

  const quickPaidFilteredInvoices = useMemo(() => {
    const normalizedQuery = String(quickPaidSearch || "").trim().toLowerCase();
    const rows = Array.isArray(allProjectInvoices) ? [...allProjectInvoices] : [];

    const filteredRows = normalizedQuery
      ? rows.filter((invoice) => {
        const projectName = String(invoice?.projectName || "").toLowerCase();
        const invoiceNumber = String(invoice?.invoiceNumber || "").toLowerCase();
        const weekNumber = String(invoice?.weekNumber || "").toLowerCase();
        const mondayDate = String(invoice?.mondayDate || "").toLowerCase();
        const dueDate = String(invoice?.dueDate || "").toLowerCase();
        const paidLabel = invoice?.isPaid ? "paid" : "unpaid";
        const statusLabel = normalizeInvoiceStatus(invoice?.invoiceStatus, invoice?.total, invoice?.invoiceNumber);

        return [
          projectName,
          invoiceNumber,
          weekNumber,
          mondayDate,
          dueDate,
          paidLabel,
          statusLabel,
        ].some((value) => value.includes(normalizedQuery));
      })
      : rows;

    return filteredRows.sort((left, right) => {
      const paidDelta = Number(Boolean(left?.isPaid)) - Number(Boolean(right?.isPaid));
      if (paidDelta !== 0) return paidDelta;

      const leftDue = Date.parse(`${toDateInputValue(left?.dueDate) || "1970-01-01"}T00:00:00`);
      const rightDue = Date.parse(`${toDateInputValue(right?.dueDate) || "1970-01-01"}T00:00:00`);
      const dueDelta = leftDue - rightDue;
      if (Number.isFinite(dueDelta) && dueDelta !== 0) return dueDelta;

      const projectDelta = String(left?.projectName || "").localeCompare(String(right?.projectName || ""));
      if (projectDelta !== 0) return projectDelta;

      const weekDelta = Number(left?.weekNumber || 0) - Number(right?.weekNumber || 0);
      if (weekDelta !== 0) return weekDelta;

      return String(left?.invoiceNumber || "").localeCompare(String(right?.invoiceNumber || ""));
    });
  }, [allProjectInvoices, quickPaidSearch]);

  const quickPaidSummary = useMemo(() => {
    const rows = quickPaidFilteredInvoices;
    return {
      visibleCount: rows.length,
      paidCount: rows.filter((row) => Boolean(row?.isPaid)).length,
      unpaidCount: rows.filter((row) => !row?.isPaid).length,
      visibleTotal: rows.reduce((sum, row) => sum + (Number(row?.total || 0) || 0), 0),
    };
  }, [quickPaidFilteredInvoices]);

  useEffect(() => {
    if (activeInvoicesTab !== "reconciliation") return;
    if (loadingAllProjectInvoices) return;
    if (excelInvoiceRows.length === 0) return;

    runInvoiceReconciliation(excelInvoiceRows);
  }, [activeInvoicesTab, allProjectInvoices, excelInvoiceRows, loadingAllProjectInvoices]);

  useEffect(() => {
    if (!id || activeInvoicesTab !== "reconciliation") {
      setLoadingSavedReconciliationReport(false);
      return undefined;
    }

    setLoadingSavedReconciliationReport(true);
    const latestReportQuery = query(
      collection(db, "churches", id, "invoiceReconciliationReports"),
      orderBy("createdAt", "desc"),
      limit(1)
    );

    const unsubscribe = onSnapshot(
      latestReportQuery,
      (snapshot) => {
        if (snapshot.empty) {
          if (excelInvoiceRows.length === 0) {
            setResolvedReconciliationItems([]);
          }
          setLoadingSavedReconciliationReport(false);
          return;
        }

        const reportDoc = snapshot.docs[0];
        const reportData = reportDoc.data() || {};

        if (excelInvoiceRows.length === 0) {
          const hydratedResult = normalizeReportForUi(reportData);
          setReconciliationResult(hydratedResult);
          setResolvedReconciliationItems(normalizeResolvedItemsForUi(reportData));
          setExcelFileName(String(reportData.sourceFileName || "").trim());
          setExcelColumnMap({
            invoiceNumber: String(reportData?.columnMap?.invoiceNumber || "").trim(),
            total: String(reportData?.columnMap?.total || "").trim(),
            projectName: String(reportData?.columnMap?.projectName || "").trim(),
          });
        }

        const createdAtDate = reportData?.createdAt?.toDate?.() || null;
        setLastSavedReconciliationAt(createdAtDate ? createdAtDate.toISOString() : "");
        setLoadingSavedReconciliationReport(false);
      },
      (error) => {
        console.error("Failed to load latest reconciliation report:", error);
        setLoadingSavedReconciliationReport(false);
      }
    );

    return unsubscribe;
  }, [activeInvoicesTab, excelInvoiceRows.length, id]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handlePopState = () => {
      setActiveInvoicesTab(getInvoiceTabFromCurrentLocation());
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search || "");
    const tabFromQuery = params.get("invoiceTab") || params.get("tab");
    if (!tabFromQuery) {
      pushInvoiceTabToLocation(activeInvoicesTab, { replace: true });
    }
  }, [activeInvoicesTab]);

  const handleCreateProject = async (event) => {
    event.preventDefault();

    if (!canManageInvoices) {
      toast.error("You do not have permission to create projects.");
      return;
    }

    const name = String(projectDraft.name || "").trim();
    const description = String(projectDraft.description || "").trim();
    const timeRotateProjectNames = normalizeTimeRotateProjectNames(projectDraft.timeRotateProjectNames);

    if (!name) {
      toast.error("Project name is required.");
      return;
    }

    try {
      const created = await addDoc(projectsRef, {
        name,
        description,
        timeRotateProjectNames,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdByUid: user?.uid || "",
        createdByEmail: user?.email || "",
      });

      setProjectDraft({ name: "", description: "", timeRotateProjectNames: [] });
      setSelectedProjectId(created.id);
      toast.success("Project created.");
    } catch (error) {
      console.error("Error creating project:", error);
      toast.error("Failed to create project.");
    }
  };

  const startProjectEdit = (project) => {
    setEditingProjectId(project.id);
    setEditProjectDraft({
      name: String(project.name || ""),
      description: String(project.description || ""),
      timeRotateProjectNames: normalizeTimeRotateProjectNames(project.timeRotateProjectNames),
    });
  };

  const handleUpdateProject = async (event) => {
    event.preventDefault();

    if (!canManageInvoices || !editingProjectId) {
      return;
    }

    const name = String(editProjectDraft.name || "").trim();
    const description = String(editProjectDraft.description || "").trim();
    const timeRotateProjectNames = normalizeTimeRotateProjectNames(editProjectDraft.timeRotateProjectNames);

    if (!name) {
      toast.error("Project name is required.");
      return;
    }

    try {
      await updateDoc(doc(db, "churches", id, "invoiceProjects", editingProjectId), {
        name,
        description,
        timeRotateProjectNames,
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || "",
      });

      setEditingProjectId("");
      setEditProjectDraft({ name: "", description: "", timeRotateProjectNames: [] });
      toast.success("Project updated.");
    } catch (error) {
      console.error("Error updating project:", error);
      toast.error("Failed to update project.");
    }
  };

  const handleDeleteProject = async (projectId) => {
    if (!canManageInvoices) {
      toast.error("You do not have permission to delete projects.");
      return;
    }

    const confirmDelete = window.confirm(
      "Delete this project and all its invoices? This action cannot be undone."
    );

    if (!confirmDelete) return;

    try {
      const projectInvoicesRef = collection(db, "churches", id, "invoiceProjects", projectId, "invoices");
      const projectInvoiceSnapshot = await getDocs(projectInvoicesRef);

      await Promise.all(projectInvoiceSnapshot.docs.map((invoiceDoc) => deleteDoc(invoiceDoc.ref)));
      await deleteDoc(doc(db, "churches", id, "invoiceProjects", projectId));

      if (selectedProjectId === projectId) {
        setSelectedProjectId("");
      }

      toast.success("Project deleted.");
    } catch (error) {
      console.error("Error deleting project:", error);
      toast.error("Failed to delete project.");
    }
  };

  const buildMissingWeekInvoices = (targetWeek, existingInvoiceMap, draft) => {
    const rows = [];
    const normalizedTargetWeek = Number(targetWeek);
    const sequenceInvoiceRows = Array.from(existingInvoiceMap.values())
      .filter((invoice) => Number.isFinite(Number(invoice?.weekNumber || 0)) && Number(invoice?.weekNumber || 0) > 0)
      .map((invoice) => ({
        weekNumber: Number(invoice.weekNumber),
        mondayDate: toDateInputValue(invoice.mondayDate || ""),
      }))
      .filter((invoice) => invoice.mondayDate);

    const correctedTargetMondayDate = getExpectedWeekMondayDate(
      normalizedTargetWeek,
      sequenceInvoiceRows,
      draft.mondayDate || ""
    );

    for (let week = 1; week <= targetWeek; week += 1) {
      if (existingInvoiceMap.has(week)) {
        continue;
      }

      const weekDistance = targetWeek - week;
      const mondayDate = correctedTargetMondayDate
        ? shiftDateInputValue(correctedTargetMondayDate, -7 * weekDistance)
        : "";
      const netDays = resolveNetDays(draft.paymentTerms, draft.netDays);
      const dueDate = mondayDate ? shiftDateInputValue(mondayDate, netDays) : "";

      const invoiceNumber = week === targetWeek
        ? normalizeInvoiceNumber(draft.invoiceNumber)
        : `W${String(week).padStart(2, "0")}`;
      const total = week === targetWeek ? parseMoney(draft.total) || 0 : 0;

      rows.push({
        weekNumber: week,
        weekLabel: `Week ${week}`,
        invoiceNumber,
        total,
        mondayDate,
        dueDate,
        paymentTerms: String(draft.paymentTerms || "net30").trim().toLowerCase() || "net30",
        netDays,
        isPlaceholder: week !== targetWeek,
        generatedFromWeek: week !== targetWeek ? targetWeek : null,
      });
    }

    return rows;
  };

  const handleCreateInvoice = async (event) => {
    event.preventDefault();

    if (!canManageInvoices) {
      toast.error("You do not have permission to create invoices.");
      return;
    }

    if (!selectedProjectId) {
      toast.error("Select a project first.");
      return;
    }

    const suggestion = getNextWeekSuggestion(invoices);
    const weekNumber = parseWeekNumber(invoiceDraft.weekNumber) || parseWeekNumber(suggestion.weekNumber);
    const invoiceNumber = normalizeInvoiceNumber(invoiceDraft.invoiceNumber);
    const total = parseMoney(invoiceDraft.total);
    const paymentTerms = String(invoiceDraft.paymentTerms || "net30").trim().toLowerCase() || "net30";
    const netDays = resolveNetDays(paymentTerms);
    const mondayDate = getExpectedWeekMondayDate(
      weekNumber,
      invoices,
      invoiceDraft.mondayDate || suggestion.mondayDate
    );
    const dueDate = mondayDate ? shiftDateInputValue(mondayDate, netDays) : "";

    if (!weekNumber) {
      toast.error("Week number must be a positive number.");
      return;
    }

    if (!invoiceNumber) {
      toast.error("Invoice # is required.");
      return;
    }

    if (total === null || total < 0) {
      toast.error("Total must be 0 or greater.");
      return;
    }

    if (!mondayDate) {
      toast.error("Select the Monday date for the week.");
      return;
    }

    if (!dueDate) {
      toast.error("Select the invoice due date.");
      return;
    }

    try {
      const invoiceCollectionRef = collection(db, "churches", id, "invoiceProjects", selectedProjectId, "invoices");
      const existingSnapshot = await getDocs(invoiceCollectionRef);
      const existingByWeek = new Map(
        existingSnapshot.docs
          .map((invoiceDoc) => ({ id: invoiceDoc.id, ...invoiceDoc.data() }))
          .map((invoice) => [Number(invoice.weekNumber), invoice])
      );

      const missingRows = buildMissingWeekInvoices(weekNumber, existingByWeek, {
        invoiceNumber,
        total,
        mondayDate,
        dueDate,
        paymentTerms,
        netDays,
      });

      if (missingRows.length === 0) {
        toast.error(`Week ${weekNumber} already exists for this project.`);
        return;
      }

      await Promise.all(
        missingRows.map((row) =>
          addDoc(invoiceCollectionRef, {
            weekNumber: row.weekNumber,
            weekLabel: row.weekLabel,
            invoiceNumber: row.invoiceNumber,
            total: row.total,
            mondayDate: row.mondayDate,
            dueDate: row.dueDate,
            paymentTerms: row.paymentTerms,
            netDays: row.netDays,
            isPaid: false,
            invoiceStatus: normalizeInvoiceStatus("", row.total, row.invoiceNumber),
            isPlaceholder: Boolean(row.isPlaceholder),
            generatedFromWeek: row.generatedFromWeek,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            createdByUid: user?.uid || "",
            createdByEmail: user?.email || "",
            changeLog: [
              buildInvoiceLogEntry({
                action: "Created",
                note: row.isPlaceholder
                  ? `Auto-generated placeholder while creating through Week ${weekNumber}.`
                  : "Invoice created manually.",
                changes: {
                  weekNumber: row.weekNumber,
                  invoiceNumber: row.invoiceNumber,
                  total: row.total,
                  mondayDate: row.mondayDate,
                  dueDate: row.dueDate,
                },
              }),
            ],
          })
        )
      );

      setInvoiceDraft({
        ...emptyInvoiceDraft,
        weekNumber: String(weekNumber + 1),
        mondayDate: shiftDateInputValue(mondayDate, 7),
        dueDate: shiftDateInputValue(shiftDateInputValue(mondayDate, 7), netDays),
        paymentTerms,
      });
      setIsInvoiceDraftDirty(false);
      if (missingRows.length > 1) {
        toast.success(`Invoice saved and weeks 1-${weekNumber} were ensured.`);
      } else {
        toast.success("Invoice added.");
      }
    } catch (error) {
      console.error("Error creating invoice:", error);
      toast.error("Failed to create invoice.");
    }
  };

  const handleExportBillableInvoice = (invoice, rowHoursData) => {
    const users = Array.isArray(rowHoursData?.users) ? rowHoursData.users : [];
    if (!invoice || users.length === 0) {
      toast.error("No user hours are available to generate a billable invoice.");
      return;
    }

    const invoiceNumber = String(invoice.invoiceNumber || `W${String(invoice.weekNumber || "").padStart(2, "0")}`).trim();
    const mondayDate = toDateInputValue(invoice.mondayDate);
    const weekEndDate = shiftDateInputValue(mondayDate, 6);
    const dueDate = toDateInputValue(invoice.dueDate);
    const projectName = String(selectedInvoiceProject?.name || "Unknown Project").trim();
    const workRangeStart = mondayDate ? Date.parse(`${mondayDate}T00:00:00`) : Number.NaN;
    const workRangeEnd = weekEndDate ? Date.parse(`${weekEndDate}T23:59:59.999`) : Number.NaN;
    const workTimestampRange = billableTimeRotateLogs.reduce((range, log) => {
      if (!isLogMatchedToInvoiceProject(log, selectedProjectId)) return range;
      if (log.eventTimestamp < workRangeStart || log.eventTimestamp > workRangeEnd) return range;
      const firstUsedAt = Number(log.eventTimestamp) || 0;
      const lastUsedAt = Number(log.endedAt) || firstUsedAt;
      if (firstUsedAt > 0 && (!range.firstUsedAt || firstUsedAt < range.firstUsedAt)) range.firstUsedAt = firstUsedAt;
      if (lastUsedAt > range.lastUsedAt) range.lastUsedAt = lastUsedAt;
      return range;
    }, { firstUsedAt: 0, lastUsedAt: 0 });

    const sortedUsers = users
      .map((userEntry) => {
        const cost = getLaborCostFromSplit(
          userEntry.regularMilliseconds,
          userEntry.overtimeMilliseconds
        );

        const cards = Array.isArray(userEntry.cards) ? userEntry.cards : [];
        const notes = Array.isArray(userEntry.notes) ? userEntry.notes : [];

        const issueSummary = cards
          .map((card) => {
            const cardLabel = String(card.label || "Unspecified Card").trim();
            const cardHours = formatHoursUsed(card.milliseconds);
            return `${cardLabel} (${cardHours})`;
          })
          .join(" | ");

        const notesSummary = notes
          .map((note) => String(note.text || "").trim())
          .filter(Boolean)
          .join(" | ");

        return {
          name: String(userEntry.name || "Unknown User").trim() || "Unknown User",
          regularHours: Number(cost.regularHours || 0),
          overtimeHours: Number(cost.overtimeHours || 0),
          totalHours: Number(cost.totalHours || 0),
          regularRate: BASE_HOURLY_RATE,
          overtimeRate: BASE_HOURLY_RATE * OVERTIME_MULTIPLIER,
          regularCost: Number(cost.regularCost || 0),
          overtimeCost: Number(cost.overtimeCost || 0),
          lineTotal: Number(cost.totalCost || 0),
          cards,
          notes,
          issueSummary,
          notesSummary,
        };
      })
      .sort((left, right) => right.lineTotal - left.lineTotal);

    const totalRegularHours = sortedUsers.reduce((sum, item) => sum + item.regularHours, 0);
    const totalOvertimeHours = sortedUsers.reduce((sum, item) => sum + item.overtimeHours, 0);
    const totalHours = sortedUsers.reduce((sum, item) => sum + item.totalHours, 0);
    const totalAmount = sortedUsers.reduce((sum, item) => sum + item.lineTotal, 0);

    const worksheetRows = [
      ["Billable Invoice"],
      ["Project", projectName],
      ["Invoice #", invoiceNumber],
      ["Week", `Week ${invoice.weekNumber || "-"}`],
      ["Start of Week", mondayDate || "-"],
      ["End of Week", weekEndDate || "-"],
      ["Due Date", dueDate || "-"],
      ["Payment Terms", getPaymentTermLabel(invoice.paymentTerms, invoice.netDays)],
      ["Overtime Policy", OVERTIME_POLICY_LABEL],
      [],
      [
        "Person",
        `Regular Hours (<= ${OVERTIME_THRESHOLD_HOURS}/wk)`,
        `Overtime Hours (> ${OVERTIME_THRESHOLD_HOURS}/wk)`,
        "Total Hours",
        "Regular Rate",
        "Overtime Rate",
        "Regular Cost",
        "Overtime Cost",
        "Line Total",
        "Issues Worked",
        "Notes",
      ],
      ...sortedUsers.map((item) => ([
        item.name,
        Number(item.regularHours.toFixed(2)),
        Number(item.overtimeHours.toFixed(2)),
        Number(item.totalHours.toFixed(2)),
        Number(item.regularRate.toFixed(2)),
        Number(item.overtimeRate.toFixed(2)),
        Number(item.regularCost.toFixed(2)),
        Number(item.overtimeCost.toFixed(2)),
        Number(item.lineTotal.toFixed(2)),
        item.issueSummary,
        item.notesSummary,
      ])),
      [],
      ["Totals", Number(totalRegularHours.toFixed(2)), Number(totalOvertimeHours.toFixed(2)), Number(totalHours.toFixed(2)), "", "", "", "", Number(totalAmount.toFixed(2))],
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(worksheetRows);
    worksheet["!cols"] = [
      { wch: 28 },
      { wch: 14 },
      { wch: 14 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 13 },
      { wch: 13 },
      { wch: 12 },
      { wch: 56 },
      { wch: 56 },
    ];

    const issueAndNoteRows = [
      ["Invoice Issues and Notes"],
      ["Project", projectName],
      ["Invoice #", invoiceNumber],
      ["Week", `Week ${invoice.weekNumber || "-"}`],
      ["Start of Week", mondayDate || "-"],
      ["End of Week", weekEndDate || "-"],
      [],
      [
        "Person",
        "Issue/Card",
        "Project",
        "Issue ID",
        "Issue Title",
        "Issue Details",
        "Note",
      ],
    ];

    sortedUsers.forEach((userEntry) => {
      const userCards = Array.isArray(userEntry.cards) ? userEntry.cards : [];
      const userNotes = Array.isArray(userEntry.notes) ? userEntry.notes : [];

      if (userCards.length === 0 && userNotes.length === 0) {
        issueAndNoteRows.push([
          userEntry.name,
          "",
          "",
          "",
          "",
          "",
          "",
        ]);
        return;
      }

      if (userCards.length > 0) {
        userCards.forEach((card) => {
          issueAndNoteRows.push([
            userEntry.name,
            String(card.label || "Unspecified Card").trim(),
            String(card.projectName || "Unknown Project").trim(),
            String(card.issueId || "").trim(),
            String(card.title || "").trim(),
            String(card.description || card.title || card.taskIdentity || "").trim(),
            "",
          ]);
        });
      }

      if (userNotes.length > 0) {
        userNotes.forEach((note) => {
          issueAndNoteRows.push([
            userEntry.name,
            String(note.cardLabel || "").trim(),
            String(note.projectName || "").trim(),
            String(note.issueId || "").trim(),
            String(note.title || "").trim(),
            String(note.taskIdentity || "").trim(),
            String(note.text || "").trim(),
          ]);
        });
      }

      issueAndNoteRows.push(["", "", "", "", "", "", ""]);
    });

    const issueAndNotesWorksheet = XLSX.utils.aoa_to_sheet(issueAndNoteRows);
    issueAndNotesWorksheet["!cols"] = [
      { wch: 24 },
      { wch: 34 },
      { wch: 24 },
      { wch: 14 },
      { wch: 30 },
      { wch: 40 },
      { wch: 64 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Billable Invoice");
    XLSX.utils.book_append_sheet(workbook, issueAndNotesWorksheet, "Issues & Notes");

    const safeInvoiceNumber = invoiceNumber.replace(/[^A-Z0-9_-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "invoice";
    const safeProjectName = projectName.replace(/[^A-Z0-9_-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "project";
    const fileName = `${safeProjectName}-${safeInvoiceNumber}-billable-invoice.xlsx`;
    const draftStorageKey = `billable-invoice-preview:${id}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const previewPayload = {
      fileName,
      generatedAt: Date.now(),
      projectId: selectedProjectId,
      invoiceId: invoice.id,
      projectName,
      invoiceNumber,
      weekNumber: invoice.weekNumber || "-",
      mondayDate,
      weekEndDate,
      dueDate,
      paymentTermsLabel: getPaymentTermLabel(invoice.paymentTerms, invoice.netDays),
      workTimestampRange,
      overtimePolicy: {
        thresholdHours: OVERTIME_THRESHOLD_HOURS,
        baseRate: BASE_HOURLY_RATE,
        overtimeMultiplier: OVERTIME_MULTIPLIER,
        overtimeRate: OVERTIME_RATE,
        label: OVERTIME_POLICY_LABEL,
      },
      totals: {
        totalRegularHours: Number(totalRegularHours.toFixed(2)),
        totalOvertimeHours: Number(totalOvertimeHours.toFixed(2)),
        totalHours: Number(totalHours.toFixed(2)),
        totalAmount: Number(totalAmount.toFixed(2)),
      },
      users: sortedUsers.map((userEntry) => ({
        name: userEntry.name,
        regularHours: Number(userEntry.regularHours.toFixed(2)),
        overtimeHours: Number(userEntry.overtimeHours.toFixed(2)),
        totalHours: Number(userEntry.totalHours.toFixed(2)),
        regularRate: Number(userEntry.regularRate.toFixed(2)),
        overtimeRate: Number(userEntry.overtimeRate.toFixed(2)),
        lineTotal: Number(userEntry.lineTotal.toFixed(2)),
        issueSummary: userEntry.issueSummary,
        notesSummary: userEntry.notesSummary,
        cards: (Array.isArray(userEntry.cards) ? userEntry.cards : []).map((card) => ({
          label: String(card.label || "Unspecified Card").trim(),
          projectName: String(card.projectName || "Unknown Project").trim(),
          issueId: String(card.issueId || "").trim(),
          title: String(card.title || "").trim(),
          description: String(card.description || "").trim(),
          taskIdentity: String(card.taskIdentity || "").trim(),
          projectDocId: String(card.projectDocId || "").trim(),
          firstUsedAt: Number(card.firstUsedAt) || 0,
          lastUsedAt: Number(card.lastUsedAt) || 0,
          hoursUsed: formatHoursUsed(card.milliseconds),
        })),
        notes: (Array.isArray(userEntry.notes) ? userEntry.notes : []).map((note) => ({
          cardLabel: String(note.cardLabel || "").trim(),
          projectName: String(note.projectName || "").trim(),
          issueId: String(note.issueId || "").trim(),
          title: String(note.title || "").trim(),
          taskIdentity: String(note.taskIdentity || "").trim(),
          projectDocId: String(note.projectDocId || "").trim(),
          text: String(note.text || "").trim(),
        })),
      })),
    };

    sessionStorage.setItem(draftStorageKey, JSON.stringify(previewPayload));
    const previewUrl = `/organization/${id}/invoices/billable-preview?draft=${encodeURIComponent(draftStorageKey)}`;
    navigate(previewUrl);
  };

  const handleCatchUpToPreviousWeek = async () => {
    if (!canManageInvoices) {
      toast.error("You do not have permission to create invoices.");
      return;
    }

    if (!selectedProjectId) {
      toast.error("Select a project first.");
      return;
    }

    if (previousWeekStatus.missingCount <= 0) {
      toast.success("This project is already up to date through the previous week.");
      return;
    }

    const suggestion = getNextWeekSuggestion(invoices);
    const paymentTerms = String(previousWeekStatus.latestInvoicePaymentTerms || suggestion.paymentTerms || invoiceDraft.paymentTerms || "net30").trim().toLowerCase() || "net30";
    const netDays = resolveNetDays(paymentTerms);
    const missingWeekPlans = Array.isArray(previousWeekStatus.missingWeekPlans) ? previousWeekStatus.missingWeekPlans : [];

    setCreatingCatchUpInvoices(true);

    try {
      const invoiceCollectionRef = collection(db, "churches", id, "invoiceProjects", selectedProjectId, "invoices");
      const existingSnapshot = await getDocs(invoiceCollectionRef);
      const existingWeekNumbers = new Set(
        existingSnapshot.docs
          .map((invoiceDoc) => Number(invoiceDoc.data()?.weekNumber || 0))
          .filter((weekNumber) => Number.isFinite(weekNumber) && weekNumber > 0)
      );

      let nextWeekNumber = Math.max(0, ...Array.from(existingWeekNumbers));
      const missingRows = missingWeekPlans.map((plan) => {
        do {
          nextWeekNumber += 1;
        } while (existingWeekNumbers.has(nextWeekNumber));

        existingWeekNumbers.add(nextWeekNumber);

        const mondayDate = toDateInputValue(plan.mondayDate);
        const dueDate = mondayDate ? shiftDateInputValue(mondayDate, netDays) : "";

        return {
          weekNumber: nextWeekNumber,
          weekLabel: `Week ${nextWeekNumber}`,
          invoiceNumber: `W${String(nextWeekNumber).padStart(2, "0")}`,
          total: 0,
          mondayDate,
          dueDate,
          paymentTerms,
          netDays,
          isPlaceholder: true,
          generatedFromWeek: null,
        };
      });

      if (missingRows.length === 0) {
        toast.success("This project is already up to date through the previous week.");
        return;
      }

      await Promise.all(
        missingRows.map((row) =>
          addDoc(invoiceCollectionRef, {
            weekNumber: row.weekNumber,
            weekLabel: row.weekLabel,
            invoiceNumber: row.invoiceNumber,
            total: row.total,
            mondayDate: row.mondayDate,
            dueDate: row.dueDate,
            paymentTerms: row.paymentTerms,
            netDays: row.netDays,
            isPaid: false,
            invoiceStatus: normalizeInvoiceStatus("", row.total, row.invoiceNumber),
            isPlaceholder: Boolean(row.isPlaceholder),
            generatedFromWeek: row.generatedFromWeek,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            createdByUid: user?.uid || "",
            createdByEmail: user?.email || "",
            changeLog: [
              buildInvoiceLogEntry({
                action: "Created",
                note: "Auto-generated by catch-up to previous week.",
                changes: {
                  weekNumber: row.weekNumber,
                  invoiceNumber: row.invoiceNumber,
                  total: row.total,
                  mondayDate: row.mondayDate,
                  dueDate: row.dueDate,
                },
              }),
            ],
          })
        )
      );

      const lastCreatedMondayDate = missingRows[missingRows.length - 1]?.mondayDate || "";
      const nextMondayDate = shiftDateInputValue(lastCreatedMondayDate, 7);
      setInvoiceDraft({
        ...emptyInvoiceDraft,
        weekNumber: String((missingRows[missingRows.length - 1]?.weekNumber || 0) + 1),
        mondayDate: nextMondayDate,
        dueDate: shiftDateInputValue(nextMondayDate, netDays),
        paymentTerms,
      });
      setIsInvoiceDraftDirty(false);
      toast.success(`Created ${missingRows.length} missing invoice week${missingRows.length === 1 ? "" : "s"} through ${formatDisplayDate(previousWeekStatus.previousWeekMondayDate)}.`);
    } catch (error) {
      console.error("Error catching up missing invoices:", error);
      toast.error("Failed to create missing invoices.");
    } finally {
      setCreatingCatchUpInvoices(false);
    }
  };

  const handleRecreateWeek = async () => {
    if (!canManageInvoices) {
      toast.error("You do not have permission to create invoices.");
      return;
    }

    if (!selectedProjectId) {
      toast.error("Select a project first.");
      return;
    }

    const targetWeek = parseWeekNumber(recreateWeekNumber);
    if (!targetWeek) {
      toast.error("Enter a valid week number to recreate.");
      return;
    }

    setRecreatingWeek(true);

    try {
      const invoiceCollectionRef = collection(db, "churches", id, "invoiceProjects", selectedProjectId, "invoices");
      const existingSnapshot = await getDocs(invoiceCollectionRef);
      const existingInvoices = existingSnapshot.docs.map((invoiceDoc) => ({ id: invoiceDoc.id, ...invoiceDoc.data() }));

      if (existingInvoices.some((invoice) => Number(invoice.weekNumber) === targetWeek)) {
        toast.error(`Week ${targetWeek} already exists for this project.`);
        return;
      }

      const suggestion = getNextWeekSuggestion(existingInvoices);

      let anchorInvoice = null;
      let smallestDistance = Number.POSITIVE_INFINITY;

      existingInvoices.forEach((invoice) => {
        const invoiceWeek = Number(invoice.weekNumber || 0);
        const invoiceMonday = toDateInputValue(invoice.mondayDate || "");
        if (!invoiceWeek || !invoiceMonday) return;

        const distance = Math.abs(invoiceWeek - targetWeek);
        if (distance < smallestDistance) {
          smallestDistance = distance;
          anchorInvoice = {
            weekNumber: invoiceWeek,
            mondayDate: invoiceMonday,
            paymentTerms: String(invoice.paymentTerms || "net30").trim().toLowerCase() || "net30",
            netDays: resolveNetDays(invoice.paymentTerms, invoice.netDays),
          };
        }
      });

      const paymentTerms = anchorInvoice?.paymentTerms || suggestion.paymentTerms || "net30";
      const netDays = resolveNetDays(paymentTerms, anchorInvoice?.netDays ?? suggestion.netDays);

      const mondayDate = anchorInvoice
        ? shiftDateInputValue(anchorInvoice.mondayDate, 7 * (targetWeek - anchorInvoice.weekNumber))
        : (toDateInputValue(suggestion.mondayDate) || formatIsoDate(getStartOfIsoWeek(new Date())));

      const dueDate = shiftDateInputValue(mondayDate, netDays);
      const invoiceNumber = `W${String(targetWeek).padStart(2, "0")}`;

      await addDoc(invoiceCollectionRef, {
        weekNumber: targetWeek,
        weekLabel: `Week ${targetWeek}`,
        invoiceNumber,
        total: 0,
        mondayDate,
        dueDate,
        paymentTerms,
        netDays,
        isPaid: false,
        invoiceStatus: normalizeInvoiceStatus("", 0, invoiceNumber),
        isPlaceholder: false,
        generatedFromWeek: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdByUid: user?.uid || "",
        createdByEmail: user?.email || "",
        changeLog: [
          buildInvoiceLogEntry({
            action: "Created",
            note: `Week ${targetWeek} recreated after deletion.`,
            changes: {
              weekNumber: targetWeek,
              invoiceNumber,
              total: 0,
              mondayDate,
              dueDate,
            },
          }),
        ],
      });

      setRecreateWeekNumber("");
      toast.success(`Week ${targetWeek} recreated.`);
    } catch (error) {
      console.error("Error recreating week:", error);
      toast.error("Failed to recreate week.");
    } finally {
      setRecreatingWeek(false);
    }
  };

  // Inserts a new placeholder week at the gap and renumbers every week from that point onward by +1.
  const handleInsertMissingWeek = async (invoice, gapInfo) => {
    if (!canManageInvoices) {
      toast.error("You do not have permission to create invoices.");
      return;
    }

    if (!selectedProjectId || !gapInfo?.hasGap) {
      return;
    }

    const insertedWeekNumber = Number(invoice.weekNumber);
    if (!Number.isFinite(insertedWeekNumber) || insertedWeekNumber <= 0) {
      toast.error("Cannot insert a week without a valid week number.");
      return;
    }

    const confirmed = window.confirm(
      `Insert a new Week ${insertedWeekNumber} starting ${formatDisplayDate(gapInfo.expectedMondayDate)}? `
      + `Week ${insertedWeekNumber} and every week after it will be renumbered by +1 (their dates stay the same).`
    );
    if (!confirmed) return;

    setInsertingWeekInvoiceId(invoice.id);

    try {
      const invoiceCollectionRef = collection(db, "churches", id, "invoiceProjects", selectedProjectId, "invoices");
      const existingSnapshot = await getDocs(invoiceCollectionRef);
      const existingInvoices = existingSnapshot.docs.map((invoiceDoc) => ({ id: invoiceDoc.id, ...invoiceDoc.data() }));

      const invoicesToShift = existingInvoices.filter(
        (row) => Number(row.weekNumber || 0) >= insertedWeekNumber
      );

      const batch = writeBatch(db);

      invoicesToShift.forEach((row) => {
        const newWeekNumber = Number(row.weekNumber) + 1;
        const rowRef = doc(db, "churches", id, "invoiceProjects", selectedProjectId, "invoices", row.id);
        const updates = {
          weekNumber: newWeekNumber,
          weekLabel: `Week ${newWeekNumber}`,
          updatedAt: serverTimestamp(),
          changeLog: [
            ...(Array.isArray(row.changeLog) ? row.changeLog : []),
            buildInvoiceLogEntry({
              action: "Renumbered",
              note: `Shifted from Week ${row.weekNumber} to Week ${newWeekNumber} to make room for an inserted week.`,
              changes: { weekNumber: newWeekNumber },
            }),
          ],
        };

        if (Number.isFinite(Number(row.generatedFromWeek)) && Number(row.generatedFromWeek) >= insertedWeekNumber) {
          updates.generatedFromWeek = Number(row.generatedFromWeek) + 1;
        }

        batch.update(rowRef, updates);
      });

      const netDays = resolveNetDays(invoice.paymentTerms, invoice.netDays);
      const newInvoiceNumber = `W${String(insertedWeekNumber).padStart(2, "0")}`;
      const newInvoiceRef = doc(invoiceCollectionRef);

      batch.set(newInvoiceRef, {
        weekNumber: insertedWeekNumber,
        weekLabel: `Week ${insertedWeekNumber}`,
        invoiceNumber: newInvoiceNumber,
        total: 0,
        mondayDate: gapInfo.expectedMondayDate,
        dueDate: shiftDateInputValue(gapInfo.expectedMondayDate, netDays),
        paymentTerms: String(invoice.paymentTerms || "net30").trim().toLowerCase() || "net30",
        netDays,
        isPaid: false,
        invoiceStatus: normalizeInvoiceStatus("", 0, newInvoiceNumber),
        isPlaceholder: true,
        generatedFromWeek: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdByUid: user?.uid || "",
        createdByEmail: user?.email || "",
        changeLog: [
          buildInvoiceLogEntry({
            action: "Created",
            note: `Auto-inserted to fill a detected date gap before the former Week ${insertedWeekNumber}.`,
            changes: {
              weekNumber: insertedWeekNumber,
              mondayDate: gapInfo.expectedMondayDate,
              dueDate: shiftDateInputValue(gapInfo.expectedMondayDate, netDays),
            },
          }),
        ],
      });

      await batch.commit();
      toast.success(`Week ${insertedWeekNumber} inserted. Later weeks were renumbered.`);
    } catch (error) {
      console.error("Error inserting missing week:", error);
      toast.error("Failed to insert missing week.");
    } finally {
      setInsertingWeekInvoiceId(null);
    }
  };

  // Appends the next sequential week using the same suggestion logic as the create-invoice form, with no data entry required.
  const handleAddNextWeek = async () => {
    if (!canManageInvoices) {
      toast.error("You do not have permission to create invoices.");
      return;
    }

    if (!selectedProjectId) {
      toast.error("Select a project first.");
      return;
    }

    setAddingNextWeek(true);

    try {
      const invoiceCollectionRef = collection(db, "churches", id, "invoiceProjects", selectedProjectId, "invoices");
      const existingSnapshot = await getDocs(invoiceCollectionRef);
      const existingInvoices = existingSnapshot.docs.map((invoiceDoc) => ({ id: invoiceDoc.id, ...invoiceDoc.data() }));

      const suggestion = getNextWeekSuggestion(existingInvoices);
      const weekNumber = parseWeekNumber(suggestion.weekNumber);

      if (!weekNumber) {
        toast.error("Could not determine the next week number.");
        return;
      }

      if (existingInvoices.some((invoice) => Number(invoice.weekNumber || 0) === weekNumber)) {
        toast.error(`Week ${weekNumber} already exists for this project.`);
        return;
      }

      const mondayDate = toDateInputValue(suggestion.mondayDate) || formatIsoDate(getStartOfIsoWeek(new Date()));
      const paymentTerms = String(suggestion.paymentTerms || "net30").trim().toLowerCase() || "net30";
      const netDays = resolveNetDays(paymentTerms, suggestion.netDays);
      const dueDate = shiftDateInputValue(mondayDate, netDays);
      const invoiceNumber = `W${String(weekNumber).padStart(2, "0")}`;

      await addDoc(invoiceCollectionRef, {
        weekNumber,
        weekLabel: `Week ${weekNumber}`,
        invoiceNumber,
        total: 0,
        mondayDate,
        dueDate,
        paymentTerms,
        netDays,
        isPaid: false,
        invoiceStatus: normalizeInvoiceStatus("", 0, invoiceNumber),
        isPlaceholder: false,
        generatedFromWeek: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdByUid: user?.uid || "",
        createdByEmail: user?.email || "",
        changeLog: [
          buildInvoiceLogEntry({
            action: "Created",
            note: `Week ${weekNumber} added via "Add Next Week".`,
            changes: { weekNumber, mondayDate, dueDate },
          }),
        ],
      });

      toast.success(`Week ${weekNumber} added.`);
    } catch (error) {
      console.error("Error adding next week:", error);
      toast.error("Failed to add next week.");
    } finally {
      setAddingNextWeek(false);
    }
  };

  const startInvoiceEdit = (invoice) => {
    setEditingInvoiceId(invoice.id);
    setEditInvoiceDraft({
      weekNumber: String(invoice.weekNumber || ""),
      invoiceNumber: String(invoice.invoiceNumber || ""),
      total: String(invoice.total ?? ""),
      mondayDate: toDateInputValue(invoice.mondayDate || ""),
      dueDate: toDateInputValue(invoice.dueDate || ""),
      paymentTerms: String(invoice.paymentTerms || "net30").trim().toLowerCase() || "net30",
      isPaid: invoice.isPaid || false,
      invoiceStatus: normalizeInvoiceStatus(invoice.invoiceStatus, invoice.total, invoice.invoiceNumber),
      billingSource: normalizeBillingSource(invoice.billingSource),
      apStatus: normalizeApStatus(invoice.apStatus),
    });
  };

  const handleUpdateInvoice = async (event) => {
    event.preventDefault();

    if (!canManageInvoices || !editingInvoiceId || !selectedProjectId) {
      return;
    }

    const weekNumber = parseWeekNumber(editInvoiceDraft.weekNumber);
    const invoiceNumber = normalizeInvoiceNumber(editInvoiceDraft.invoiceNumber);
    const billingSource = normalizeBillingSource(editInvoiceDraft.billingSource);
    const editingRowHoursData = invoiceHoursById[editingInvoiceId] || {
      totalRegularMilliseconds: 0,
      totalOvertimeMilliseconds: 0,
    };
    const editingRowLaborCost = getLaborCostFromSplit(
      editingRowHoursData.totalRegularMilliseconds,
      editingRowHoursData.totalOvertimeMilliseconds
    );
    const total = billingSource === "main_system"
      ? Number(editingRowLaborCost.totalCost.toFixed(2))
      : parseMoney(editInvoiceDraft.total);
    const paymentTerms = String(editInvoiceDraft.paymentTerms || "net30").trim().toLowerCase() || "net30";
    const invoiceStatus = normalizeInvoiceStatus(editInvoiceDraft.invoiceStatus, total, invoiceNumber);
    const netDays = resolveNetDays(paymentTerms);
    const mondayDate = toDateInputValue(editInvoiceDraft.mondayDate);
    const dueDate = mondayDate ? shiftDateInputValue(mondayDate, netDays) : "";

    if (!weekNumber) {
      toast.error("Week number must be a positive number.");
      return;
    }

    if (!invoiceNumber) {
      toast.error("Invoice # is required.");
      return;
    }

    if (total === null || total < 0) {
      toast.error("Total must be 0 or greater.");
      return;
    }

    if (!mondayDate) {
      toast.error("Select the Monday date for the week.");
      return;
    }

    if (!dueDate) {
      toast.error("Select the invoice due date.");
      return;
    }

    const duplicateWeek = invoices.find(
      (invoice) => invoice.id !== editingInvoiceId && Number(invoice.weekNumber) === weekNumber
    );

    if (duplicateWeek) {
      toast.error(`Week ${weekNumber} already exists for this project.`);
      return;
    }

    try {
      const currentInvoice = invoices.find((invoice) => invoice.id === editingInvoiceId) || null;

      const batch = writeBatch(db);
      const masterRef = doc(db, "churches", id, "invoiceProjects", selectedProjectId, "invoices", editingInvoiceId);
      const masterChangeLog = Array.isArray(currentInvoice?.changeLog) ? currentInvoice.changeLog : [];
      const updateLogEntry = buildInvoiceLogEntry({
        action: "Updated",
        note: "Edited from Invoice Table.",
        changes: {
          before: {
            weekNumber: Number(currentInvoice?.weekNumber || 0) || "",
            invoiceNumber: normalizeInvoiceNumber(currentInvoice?.invoiceNumber || ""),
            total: parseAmountValue(currentInvoice?.total),
            mondayDate: toDateInputValue(currentInvoice?.mondayDate),
            dueDate: toDateInputValue(currentInvoice?.dueDate),
            paymentTerms: String(currentInvoice?.paymentTerms || "").trim().toLowerCase(),
            isPaid: Boolean(currentInvoice?.isPaid),
            invoiceStatus: normalizeInvoiceStatus(currentInvoice?.invoiceStatus, currentInvoice?.total, currentInvoice?.invoiceNumber),
            apStatus: normalizeApStatus(currentInvoice?.apStatus),
          },
          after: {
            weekNumber,
            invoiceNumber,
            total,
            mondayDate,
            dueDate,
            paymentTerms,
            isPaid: Boolean(editInvoiceDraft.isPaid),
            invoiceStatus,
            apStatus: normalizeApStatus(editInvoiceDraft.apStatus),
          },
        },
      });
      batch.update(masterRef, {
        weekNumber,
        weekLabel: `Week ${weekNumber}`,
        invoiceNumber,
        total,
        mondayDate,
        dueDate,
        paymentTerms,
        netDays,
        isPaid: editInvoiceDraft.isPaid,
        invoiceStatus,
        billingSource,
        apStatus: normalizeApStatus(editInvoiceDraft.apStatus),
        isPlaceholder: false,
        generatedFromWeek: null,
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || "",
        changeLog: [...masterChangeLog, updateLogEntry],
      });

      await batch.commit();

      setEditingInvoiceId("");
      setEditInvoiceDraft({ ...emptyInvoiceDraft });
      toast.success("Invoice updated.");
    } catch (error) {
      console.error("Error updating invoice:", error);
      toast.error("Failed to update invoice.");
    }
  };

  const handleUpdateInvoiceStatus = async (invoice, nextStatusValue) => {
    if (!canManageInvoices || !selectedProjectId || !invoice?.id) {
      return;
    }

    const normalizedStatus = normalizeInvoiceStatus(nextStatusValue, invoice?.total, invoice?.invoiceNumber);
    const currentStatus = normalizeInvoiceStatus(invoice?.invoiceStatus, invoice?.total, invoice?.invoiceNumber);
    if (normalizedStatus === currentStatus) {
      return;
    }

    try {
      const existingChangeLog = Array.isArray(invoice?.changeLog) ? invoice.changeLog : [];
      await updateDoc(doc(db, "churches", id, "invoiceProjects", selectedProjectId, "invoices", invoice.id), {
        invoiceStatus: normalizedStatus,
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || "",
        changeLog: [
          ...existingChangeLog,
          buildInvoiceLogEntry({
            action: "Status Updated",
            note: "Invoice status changed from Invoice Table.",
            changes: {
              before: { invoiceStatus: currentStatus },
              after: { invoiceStatus: normalizedStatus },
            },
          }),
        ],
      });
      toast.success(`Invoice marked as ${getInvoiceStatusLabel(normalizedStatus)}.`);
    } catch (error) {
      console.error("Error updating invoice status:", error);
      toast.error("Failed to update invoice status.");
    }
  };

  const handleUpdateBillingSource = async (invoice, nextSourceValue) => {
    if (!canManageInvoices || !selectedProjectId || !invoice?.id) {
      return;
    }

    const normalizedSource = normalizeBillingSource(nextSourceValue);
    const currentSource = normalizeBillingSource(invoice?.billingSource);
    if (normalizedSource === currentSource) {
      return;
    }

    try {
      const existingChangeLog = Array.isArray(invoice?.changeLog) ? invoice.changeLog : [];
      await updateDoc(doc(db, "churches", id, "invoiceProjects", selectedProjectId, "invoices", invoice.id), {
        billingSource: normalizedSource,
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || "",
        changeLog: [
          ...existingChangeLog,
          buildInvoiceLogEntry({
            action: "Billing Source Updated",
            note: "Billing source changed from Invoice Table.",
            changes: {
              before: { billingSource: currentSource },
              after: { billingSource: normalizedSource },
            },
          }),
        ],
      });
      toast.success(`Billing source marked as ${getBillingSourceLabel(normalizedSource)}.`);
    } catch (error) {
      console.error("Error updating billing source:", error);
      toast.error("Failed to update billing source.");
    }
  };

  const handleMatchTdToInvoiceProject = async (tdIdentity, timeRotateProjectName, targetProjectId) => {
    if (!canManageInvoices || !targetProjectId) return;

    const targetProject = projects.find((project) => project.id === targetProjectId);
    const normalizedTdIdentity = String(tdIdentity || "").trim();
    const normalizedProjectName = String(timeRotateProjectName || "").trim();
    if (!targetProject || !normalizedTdIdentity || !normalizedProjectName) return;

    try {
      const normalizedProjectNameKey = normalizeProjectNameKey(normalizedProjectName);
      const batch = writeBatch(db);

      projects.forEach((project) => {
        const existingNames = normalizeTimeRotateProjectNames(project.timeRotateProjectNames);
        const withoutCurrentMatch = existingNames.filter(
          (name) => normalizeProjectNameKey(name) !== normalizedProjectNameKey
        );
        const timeRotateProjectNames = withoutCurrentMatch;

        if (timeRotateProjectNames.length !== existingNames.length) {
          batch.update(doc(db, "churches", id, "invoiceProjects", project.id), {
            timeRotateProjectNames,
            updatedAt: serverTimestamp(),
            updatedByUid: user?.uid || "",
          });
        }
      });
      batch.set(doc(db, "churches", id, "timeRotateTaskDetails", buildTaskDetailsDocId(normalizedTdIdentity)), {
        taskIdentity: normalizedTdIdentity,
        invoiceProjectId: targetProjectId,
        updatedAt: Date.now(),
        updatedBy: user?.name || user?.displayName || user?.email || "Unknown user",
        updatedByUid: user?.uid || "",
      }, { merge: true });
      await batch.commit();
      toast.success(`TD is now matched to ${targetProject.name}.`);
    } catch (error) {
      console.error("Error matching TD project to invoice project:", error);
      toast.error("Failed to save the TD match.");
    }
  };

  const handleUpdateApStatus = async (invoice, nextStatusValue) => {
    if (!canManageInvoices || !selectedProjectId || !invoice?.id) {
      return;
    }

    const apStatus = normalizeApStatus(nextStatusValue);
    const currentApStatus = normalizeApStatus(invoice.apStatus);
    if (apStatus === currentApStatus) {
      return;
    }

    try {
      const existingChangeLog = Array.isArray(invoice.changeLog) ? invoice.changeLog : [];
      await updateDoc(doc(db, "churches", id, "invoiceProjects", selectedProjectId, "invoices", invoice.id), {
        apStatus,
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || "",
        changeLog: [
          ...existingChangeLog,
          buildInvoiceLogEntry({
            action: "AP Status Updated",
            note: "AP status changed from Invoice Table.",
            changes: {
              before: { apStatus: currentApStatus },
              after: { apStatus },
            },
          }),
        ],
      });
      toast.success(`AP status marked as ${getApStatusLabel(apStatus)}.`);
    } catch (error) {
      console.error("Error updating AP status:", error);
      toast.error("Failed to update AP status.");
    }
  };

  const handleDownloadInvoiceStatusReportPdf = async () => {
    if (!invoices.length) {
      toast.error("No invoices available to export.");
      return;
    }

    setDownloadingInvoiceStatusReport(true);
    try {
      const [jspdfModule, autoTableModule] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);
      const JsPdfConstructor = jspdfModule.jsPDF || jspdfModule.default?.jsPDF || jspdfModule.default;
      const autoTable = autoTableModule.default || autoTableModule;
      if (typeof JsPdfConstructor !== "function" || typeof autoTable !== "function") {
        throw new Error("PDF generation libraries did not load correctly.");
      }

      const projectName = String(selectedInvoiceProject?.name || "Project").trim();
      const pdf = new JsPdfConstructor({ orientation: "landscape", unit: "pt", format: "letter" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const margin = 40;
      let logoDataUrl = "";

      try {
        logoDataUrl = await getOrganizationLogoDataUrl(id);
      } catch (logoError) {
        console.warn("Unable to load organization logo for invoice status report:", logoError);
      }

      if (logoDataUrl) {
        try {
          const { width, height } = await getImageDimensions(logoDataUrl);
          const scale = Math.min(80 / width, 40 / height);
          const logoWidth = width * scale;
          const logoHeight = height * scale;
          pdf.addImage(logoDataUrl, margin, 24 + ((40 - logoHeight) / 2), logoWidth, logoHeight);
        } catch (logoError) {
          console.warn("Unable to size organization logo for invoice status report:", logoError);
          logoDataUrl = "";
        }
      }

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(16);
      pdf.text("Invoice Status Report", logoDataUrl ? 132 : margin, 40);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.text(`Project: ${projectName}`, logoDataUrl ? 132 : margin, 58);
      pdf.text(`Generated: ${new Date().toLocaleString()}`, pageWidth - margin, 58, { align: "right" });

      const sortedInvoices = [...invoices].sort(
        (left, right) => (parseWeekNumber(left.weekNumber) || 0) - (parseWeekNumber(right.weekNumber) || 0)
      );
      const reportTotals = {
        finalAmount: 0,
        budgetedAmount: 0,
        totalMilliseconds: 0,
        totalLaborCost: 0,
        totalOvertimeHours: 0,
      };

      const rows = sortedInvoices.map((invoice) => {
        const weekEndDate = shiftDateInputValue(invoice.mondayDate, 6);
        const rowHoursData = invoiceHoursById[invoice.id] || {
          totalRegularMilliseconds: 0,
          totalOvertimeMilliseconds: 0,
        };
        const rowLaborCost = getLaborCostFromSplit(
          rowHoursData.totalRegularMilliseconds,
          rowHoursData.totalOvertimeMilliseconds
        );
        const effectiveInvoiceTotal = normalizeBillingSource(invoice.billingSource) === "main_system"
          ? rowLaborCost.totalCost
          : invoice.total;
        const effectiveTotalAmount = Number(effectiveInvoiceTotal) || 0;
        const invoiceStatus = normalizeInvoiceStatus(invoice.invoiceStatus, effectiveTotalAmount, invoice.invoiceNumber);
        if (invoiceStatus === "final") {
          reportTotals.finalAmount += effectiveTotalAmount;
        } else {
          reportTotals.budgetedAmount += effectiveTotalAmount;
        }
        reportTotals.totalMilliseconds += Number(rowHoursData.totalMilliseconds) || 0;
        reportTotals.totalLaborCost += Number(rowLaborCost.totalCost) || 0;
        reportTotals.totalOvertimeHours += Number(rowLaborCost.overtimeHours) || 0;
        return [
          invoice.weekNumber ? `Week ${invoice.weekNumber}` : "-",
          formatDisplayDate(invoice.mondayDate) || "-",
          formatDisplayDate(weekEndDate) || "-",
          formatCurrency(effectiveInvoiceTotal || 0),
          (invoice.invoiceNumber || "-").toString().toUpperCase(),
          getInvoiceStatusLabel(invoiceStatus),
          getBillingSourceLabel(invoice.billingSource),
          getApStatusLabel(invoice.apStatus),
        ];
      });

      autoTable(pdf, {
        startY: 88,
        theme: "grid",
        head: [["Week", "Start of Week", "End of Week", "Total", "Invoice #", "Invoice Status", "Billing Source", "AP Status"]],
        body: rows,
        styles: { font: "helvetica", fontSize: 9, cellPadding: 6 },
        headStyles: { fillColor: [29, 78, 216], textColor: [255, 255, 255], fontStyle: "bold" },
        margin: { left: margin, right: margin },
      });

      const summaryStartY = (pdf.lastAutoTable?.finalY || 88) + 24;
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(12);
      pdf.setTextColor(15, 23, 42);
      pdf.text("Project Totals", margin, summaryStartY);

      autoTable(pdf, {
        startY: summaryStartY + 8,
        theme: "grid",
        head: [["Invoice Amounts", "Hours & Labor", "Overtime Policy"]],
        body: [[
          [
            `Final: ${formatCurrency(reportTotals.finalAmount)}`,
            `Budgeted: ${formatCurrency(reportTotals.budgetedAmount)}`,
            `Subtotal: ${formatCurrency(reportTotals.finalAmount + reportTotals.budgetedAmount)}`,
          ].join("\n"),
          [
            `Total Hours: ${formatHoursUsed(reportTotals.totalMilliseconds)}`,
            `Labor Cost: ${formatCurrency(reportTotals.totalLaborCost)}`,
            `Overtime: ${reportTotals.totalOvertimeHours.toFixed(2)}h`,
          ].join("\n"),
          OVERTIME_POLICY_LABEL,
        ]],
        styles: { font: "helvetica", fontSize: 9, cellPadding: 7, valign: "top" },
        headStyles: { fillColor: [15, 118, 110], textColor: [255, 255, 255], fontStyle: "bold" },
        columnStyles: { 0: { cellWidth: 220 }, 1: { cellWidth: 220 }, 2: { cellWidth: 232 } },
        margin: { left: margin, right: margin },
      });
      pdf.setTextColor(0, 0, 0);

      const safeProjectName = projectName.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "project";
      pdf.save(`${safeProjectName}-invoice-status-report.pdf`);
    } catch (error) {
      console.error("Failed to generate invoice status report PDF:", error);
      toast.error("Failed to generate the invoice status report PDF.");
    } finally {
      setDownloadingInvoiceStatusReport(false);
    }
  };

  const handleSelectExternalPdf = (invoiceId) => {
    if (!canManageInvoices || !invoiceId) return;
    if (!storage) {
      toast.error("File storage is not available. Please try again later.");
      return;
    }

    setExternalPdfInvoiceId(invoiceId);
    externalPdfInputRef.current?.click();
  };

  const handleExternalPdfUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    const invoiceId = externalPdfInvoiceId;
    setExternalPdfInvoiceId("");

    if (!file || !invoiceId || !selectedProjectId || !id) return;
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name || "")) {
      toast.error("Please select a PDF file.");
      return;
    }

    try {
      setUploadingExternalPdfInvoiceId(invoiceId);
      const safeFileName = String(file.name || "external-invoice.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `churches/${id}/invoiceProjects/${selectedProjectId}/invoices/${invoiceId}/external-pdf/${Date.now()}-${safeFileName}`;
      const fileRef = storageRef(storage, storagePath);
      const uploadTask = uploadBytesResumable(fileRef, file, { contentType: "application/pdf" });
      await new Promise((resolve, reject) => uploadTask.on("state_changed", null, reject, resolve));

      const externalPdf = {
        name: file.name || "External invoice PDF",
        url: await getDownloadURL(fileRef),
        storagePath,
        size: Number(file.size || 0),
        uploadedAt: new Date().toISOString(),
        uploadedByUid: user?.uid || "",
      };
      const invoice = invoices.find((entry) => entry.id === invoiceId);
      await updateDoc(doc(db, "churches", id, "invoiceProjects", selectedProjectId, "invoices", invoiceId), {
        externalPdf,
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || "",
        changeLog: [
          ...(Array.isArray(invoice?.changeLog) ? invoice.changeLog : []),
          buildInvoiceLogEntry({ action: "External PDF attached", note: externalPdf.name }),
        ],
      });
      toast.success("External invoice PDF uploaded.");
    } catch (error) {
      console.error("Failed to upload external invoice PDF:", error);
      toast.error("Failed to upload the external invoice PDF.");
    } finally {
      setUploadingExternalPdfInvoiceId("");
    }
  };

  const handleQuickPaidToggle = async (invoice, nextPaidValue) => {
    if (!canManageInvoices || !id || !invoice?.id || !invoice?.projectId) {
      return;
    }

    const invoiceKey = `${invoice.projectId}::${invoice.id}`;
    if (quickPaidSavingByInvoiceKey[invoiceKey]) {
      return;
    }

    const currentPaidValue = Boolean(invoice?.isPaid);
    const normalizedNextPaidValue = Boolean(nextPaidValue);
    if (currentPaidValue === normalizedNextPaidValue) {
      return;
    }

    setQuickPaidSavingByInvoiceKey((previous) => ({
      ...previous,
      [invoiceKey]: true,
    }));

    try {
      const existingChangeLog = Array.isArray(invoice?.changeLog) ? invoice.changeLog : [];
      await updateDoc(doc(db, "churches", id, "invoiceProjects", invoice.projectId, "invoices", invoice.id), {
        isPaid: normalizedNextPaidValue,
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || "",
        changeLog: [
          ...existingChangeLog,
          buildInvoiceLogEntry({
            action: "Paid Status Updated",
            note: "Updated from Quick Paid Update tab.",
            changes: {
              before: { isPaid: currentPaidValue },
              after: { isPaid: normalizedNextPaidValue },
            },
          }),
        ],
      });

      toast.success(normalizedNextPaidValue ? "Invoice marked as paid." : "Invoice marked as unpaid.");
    } catch (error) {
      console.error("Error updating paid status from quick tab:", error);
      toast.error("Failed to update paid status.");
    } finally {
      setQuickPaidSavingByInvoiceKey((previous) => ({
        ...previous,
        [invoiceKey]: false,
      }));
    }
  };

  const handleDeleteInvoice = async (invoiceId) => {
    if (!canManageInvoices || !selectedProjectId) {
      return;
    }

    const invoiceToDelete = invoices.find((invoice) => invoice.id === invoiceId);
    const baseDeleteIds = [invoiceId];

    if (invoiceToDelete && !invoiceToDelete.isPlaceholder) {
      const linkedGeneratedInvoices = invoices.filter(
        (invoice) =>
          invoice.id !== invoiceId
          && invoice.isPlaceholder === true
          && Number(invoice.generatedFromWeek) === Number(invoiceToDelete.weekNumber)
      );

      if (linkedGeneratedInvoices.length > 0) {
        baseDeleteIds.push(...linkedGeneratedInvoices.map((invoice) => invoice.id));
      }
    }

    try {
      await Promise.all(
        baseDeleteIds.map((targetInvoiceId) =>
          deleteDoc(doc(db, "churches", id, "invoiceProjects", selectedProjectId, "invoices", targetInvoiceId))
        )
      );

      toast.success(
        baseDeleteIds.length > 1
          ? `Invoice deleted with ${baseDeleteIds.length - 1} generated week(s).`
          : "Invoice deleted."
      );
    } catch (error) {
      console.error("Error deleting invoice:", error);
      toast.error("Failed to delete invoice.");
    }
  };

  const runInvoiceReconciliation = (excelRowsInput = excelInvoiceRows) => {
    const normalizedExcelRows = Array.isArray(excelRowsInput) ? excelRowsInput : [];
    const normalizedAppRows = Array.isArray(allProjectInvoices) ? allProjectInvoices : [];

    const excelByInvoiceNumber = new Map();
    normalizedExcelRows.forEach((row) => {
      if (!row.invoiceNumberKey) return;
      if (!excelByInvoiceNumber.has(row.invoiceNumberKey)) {
        excelByInvoiceNumber.set(row.invoiceNumberKey, []);
      }
      excelByInvoiceNumber.get(row.invoiceNumberKey).push(row);
    });

    const appByInvoiceNumber = new Map();
    normalizedAppRows.forEach((row) => {
      if (!row.invoiceNumberKey) return;
      if (!appByInvoiceNumber.has(row.invoiceNumberKey)) {
        appByInvoiceNumber.set(row.invoiceNumberKey, []);
      }
      appByInvoiceNumber.get(row.invoiceNumberKey).push(row);
    });

    const invoiceKeys = Array.from(new Set([...excelByInvoiceNumber.keys(), ...appByInvoiceNumber.keys()])).sort();
    const missingInSystem = [];
    const missingInExcel = [];
    const totalMismatch = [];
    let matchedCount = 0;

    invoiceKeys.forEach((invoiceNumberKey) => {
      const excelEntries = excelByInvoiceNumber.get(invoiceNumberKey) || [];
      const appEntries = appByInvoiceNumber.get(invoiceNumberKey) || [];

      if (excelEntries.length === 0 && appEntries.length > 0) {
        appEntries.forEach((entry) => missingInExcel.push(entry));
        return;
      }

      if (appEntries.length === 0 && excelEntries.length > 0) {
        excelEntries.forEach((entry) => missingInSystem.push(entry));
        return;
      }

      const unmatchedAppEntries = [...appEntries];
      const unmatchedExcelEntries = [];

      excelEntries.forEach((excelEntry) => {
        const matchIndex = unmatchedAppEntries.findIndex(
          (appEntry) => excelEntry.total !== null && appEntry.total !== null && appEntry.total === excelEntry.total
        );

        if (matchIndex >= 0) {
          unmatchedAppEntries.splice(matchIndex, 1);
          matchedCount += 1;
        } else {
          unmatchedExcelEntries.push(excelEntry);
        }
      });

      if (unmatchedExcelEntries.length > 0 || unmatchedAppEntries.length > 0) {
        totalMismatch.push({
          invoiceNumber: invoiceNumberKey,
          excelEntries,
          appEntries,
          unmatchedExcelEntries,
          unmatchedAppEntries,
        });
      }
    });

    const nextResult = {
      excelRowsCount: normalizedExcelRows.length,
      appRowsCount: normalizedAppRows.length,
      matchedCount,
      missingInSystem,
      missingInExcel,
      totalMismatch,
      generatedAt: new Date().toISOString(),
    };

    setReconciliationResult((previousResult) => {
      if (previousResult) {
        const previousMissingInSystem = Array.isArray(previousResult.missingInSystem) ? previousResult.missingInSystem : [];
        const previousMissingInExcel = Array.isArray(previousResult.missingInExcel) ? previousResult.missingInExcel : [];

        const nextMissingSystemKeys = new Set((nextResult.missingInSystem || []).map((row) => buildMissingInSystemKey(row)));
        const nextMissingExcelKeys = new Set((nextResult.missingInExcel || []).map((row) => buildMissingInExcelKey(row)));

        const newlyResolvedSystemItems = previousMissingInSystem
          .filter((row) => !nextMissingSystemKeys.has(buildMissingInSystemKey(row)))
          .map((row) => ({
            key: buildMissingInSystemKey(row),
            type: "Missing in System",
            invoiceNumber: String(row.invoiceNumber || "").trim(),
            total: parseAmountValue(row.total),
            projectName: String(row.projectName || "").trim(),
            resolvedAt: new Date().toISOString(),
          }));

        const newlyResolvedExcelItems = previousMissingInExcel
          .filter((row) => !nextMissingExcelKeys.has(buildMissingInExcelKey(row)))
          .map((row) => ({
            key: buildMissingInExcelKey(row),
            type: "Missing in Excel",
            invoiceNumber: String(row.invoiceNumber || "").trim(),
            total: parseAmountValue(row.total),
            projectName: String(row.projectName || "").trim(),
            weekNumber: Number(row.weekNumber || 0) || "",
            resolvedAt: new Date().toISOString(),
          }));

        if (newlyResolvedSystemItems.length > 0 || newlyResolvedExcelItems.length > 0) {
          setResolvedReconciliationItems((previousResolvedItems) => {
            const existingKeys = new Set((previousResolvedItems || []).map((item) => item.key));
            const nextItems = [...(previousResolvedItems || [])];

            [...newlyResolvedSystemItems, ...newlyResolvedExcelItems].forEach((item) => {
              if (!existingKeys.has(item.key)) {
                nextItems.push(item);
                existingKeys.add(item.key);
              }
            });

            return nextItems;
          });
        }
      }

      return nextResult;
    });
    return nextResult;
  };

  const saveReconciliationReport = async (resultToSave, { source = "manual", showSuccessToast = true } = {}) => {
    if (!id) return;

    const result = resultToSave || reconciliationResult;
    if (!result) {
      toast.error("Run reconciliation before saving.");
      return;
    }

    if (savingReconciliationReport) return;

    const missingInSystem = (result.missingInSystem || []).slice(0, MAX_RECONCILIATION_DETAIL_ROWS).map((row) => ({
      invoiceNumber: String(row.invoiceNumber || "").trim(),
      total: row.total,
      projectName: String(row.projectName || "").trim(),
      rowNumber: Number(row.rowNumber || 0) || null,
    }));

    const missingInExcel = (result.missingInExcel || []).slice(0, MAX_RECONCILIATION_DETAIL_ROWS).map((row) => ({
      invoiceNumber: String(row.invoiceNumber || "").trim(),
      total: row.total,
      projectId: String(row.projectId || "").trim(),
      projectName: String(row.projectName || "").trim(),
      weekNumber: Number(row.weekNumber || 0) || null,
      dueDate: String(row.dueDate || "").trim(),
    }));

    const totalMismatch = (result.totalMismatch || []).slice(0, MAX_RECONCILIATION_DETAIL_ROWS).map((row) => ({
      invoiceNumber: String(row.invoiceNumber || "").trim(),
      excelTotals: (row.excelEntries || []).map((entry) => entry.total),
      systemTotals: (row.appEntries || []).map((entry) => entry.total),
      systemProjects: Array.from(new Set((row.appEntries || []).map((entry) => String(entry.projectName || "").trim()).filter(Boolean))),
    }));

    const payload = {
      source,
      sourceFileName: String(excelFileName || "").trim(),
      columnMap: {
        invoiceNumber: String(excelColumnMap.invoiceNumber || "").trim(),
        total: String(excelColumnMap.total || "").trim(),
        projectName: String(excelColumnMap.projectName || "").trim(),
      },
      generatedAtIso: String(result.generatedAt || "").trim(),
      summary: {
        excelRowsCount: Number(result.excelRowsCount || 0),
        appRowsCount: Number(result.appRowsCount || 0),
        matchedCount: Number(result.matchedCount || 0),
        totalMismatchCount: Number((result.totalMismatch || []).length || 0),
        missingInSystemCount: Number((result.missingInSystem || []).length || 0),
        missingInExcelCount: Number((result.missingInExcel || []).length || 0),
      },
      detailLimits: {
        maxRowsPerSection: MAX_RECONCILIATION_DETAIL_ROWS,
        missingInSystemSaved: missingInSystem.length,
        missingInExcelSaved: missingInExcel.length,
        totalMismatchSaved: totalMismatch.length,
        resolvedSaved: (resolvedReconciliationItems || []).slice(-MAX_RECONCILIATION_DETAIL_ROWS).length,
      },
      missingInSystem,
      missingInExcel,
      totalMismatch,
      resolvedItems: (resolvedReconciliationItems || []).slice(-MAX_RECONCILIATION_DETAIL_ROWS).map((item) => ({
        type: String(item.type || "").trim(),
        invoiceNumber: String(item.invoiceNumber || "").trim(),
        total: item.total,
        projectName: String(item.projectName || "").trim(),
        projectId: String(item.projectId || "").trim(),
        weekNumber: Number(item.weekNumber || 0) || null,
        resolvedAt: String(item.resolvedAt || "").trim(),
      })),
      createdByUid: user?.uid || "",
      createdByEmail: user?.email || "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    setSavingReconciliationReport(true);
    try {
      await addDoc(collection(db, "churches", id, "invoiceReconciliationReports"), payload);
      setLastSavedReconciliationAt(new Date().toISOString());
      if (showSuccessToast) {
        toast.success("Reconciliation report saved to Firebase.");
      }
    } catch (error) {
      console.error("Failed to save reconciliation report:", error);
      toast.error("Could not save reconciliation report.");
    } finally {
      setSavingReconciliationReport(false);
    }
  };

  const handleImportInvoiceExcel = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const firstSheet = workbook.Sheets[firstSheetName];
      const rawRows = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });

      if (!Array.isArray(rawRows) || rawRows.length === 0) {
        toast.error("The Excel file is empty.");
        return;
      }

      const sampleRow = rawRows.find((row) => row && Object.keys(row).length > 0) || {};
      const headers = Array.from(
        new Set(
          rawRows
            .slice(0, 100)
            .flatMap((row) => Object.keys(row || {}))
            .map((header) => String(header || "").trim())
            .filter(Boolean)
        )
      );

      if (headers.length === 0) {
        toast.error("Could not detect columns in this Excel file.");
        return;
      }

      const invoiceColumnGuess = findColumnByAliases(sampleRow, [
        "invoice",
        "invoice number",
        "invoice #",
        "invoice no",
        "inv #",
        "inv no",
      ]);
      const totalColumnGuess = findColumnByAliases(sampleRow, [
        "total",
        "amount",
        "invoice total",
        "total amount",
      ]);
      const projectColumnGuess = findColumnByAliases(sampleRow, ["project", "project name"]);

      const rowsWithMeta = rawRows.map((row, index) => ({
        __rowNumber: index + 2,
        ...row,
      }));

      setExcelFileName(file.name);
      setExcelRawRows(rowsWithMeta);
      setExcelPreviewHeaders(headers);
      setExcelPreviewRows(rowsWithMeta.slice(0, 8));
      setExcelColumnMap({
        invoiceNumber: invoiceColumnGuess || "",
        total: totalColumnGuess || "",
        projectName: projectColumnGuess || "",
      });
      setExcelInvoiceRows([]);
      setReconciliationResult(null);

      toast.info("Preview loaded. Confirm your column mapping, then click Import and Compare.");
    } catch (error) {
      console.error("Error importing invoice Excel:", error);
      toast.error("Failed to import Excel file.");
    } finally {
      event.target.value = "";
    }
  };

  const handleApplyExcelColumnMapping = async () => {
    const invoiceColumn = String(excelColumnMap.invoiceNumber || "").trim();
    const totalColumn = String(excelColumnMap.total || "").trim();
    const projectColumn = String(excelColumnMap.projectName || "").trim();

    if (!invoiceColumn || !totalColumn) {
      toast.error("Select Invoice # and Total columns before importing.");
      return;
    }

    const parsedRows = excelRawRows
      .map((row) => {
        const invoiceNumber = normalizeInvoiceNumber(row?.[invoiceColumn]);
        const invoiceNumberKey = normalizeInvoiceFuzzyKey(invoiceNumber);
        const total = parseAmountValue(row?.[totalColumn]);

        return {
          rowNumber: Number(row?.__rowNumber || 0) || "",
          projectName: projectColumn ? String(row?.[projectColumn] || "").trim() : "",
          invoiceNumber,
          invoiceNumberKey,
          total,
        };
      })
      .filter((row) => row.invoiceNumberKey);

    if (parsedRows.length === 0) {
      toast.error("No valid Invoice # rows found with the current column mapping.");
      return;
    }

    setExcelInvoiceRows(parsedRows);
    const nextResult = runInvoiceReconciliation(parsedRows);
    await saveReconciliationReport(nextResult, { source: "import", showSuccessToast: false });
    toast.success(`Imported ${parsedRows.length} Excel invoice row${parsedRows.length === 1 ? "" : "s"} and saved report.`);
  };

  const setMissingSystemAssignmentField = (row, field, value) => {
    const key = getMissingInSystemAssignmentKey(row);
    setMissingSystemAssignments((previous) => {
      const current = previous[key] || {};
      return {
        ...previous,
        [key]: {
          ...current,
          [field]: value,
        },
      };
    });
  };

  const handleApplyMissingInSystemAssignment = async (row) => {
    if (!canManageInvoices || !id) {
      toast.error("You do not have permission to update invoices.");
      return;
    }

    const key = getMissingInSystemAssignmentKey(row);
    const assignment = missingSystemAssignments[key] || {};
    const projectId = String(assignment.projectId || "").trim() || String(selectedProjectId || "").trim();
    const weekNumber = parseWeekNumber(assignment.weekNumber || "");
    const weekStartDate = toDateInputValue(assignment.weekStartDate || "");
    const assignmentMode = String(assignment.assignmentMode || "").trim().toLowerCase() || "existing";

    if (!projectId) {
      toast.error("Select a project for this item.");
      return;
    }

    if (!weekNumber) {
      toast.error("Enter a valid week number.");
      return;
    }

    const totalValue = parseAmountValue(row.total);
    if (totalValue === null || totalValue < 0) {
      toast.error("This row needs a valid total before applying.");
      return;
    }

    const invoiceNumber = normalizeInvoiceNumber(row.invoiceNumber);
    if (!invoiceNumber) {
      toast.error("This row needs a valid invoice number before applying.");
      return;
    }

    setSavingMissingSystemAssignments((previous) => ({ ...previous, [key]: true }));
    try {
      const projectInvoicesRef = collection(db, "churches", id, "invoiceProjects", projectId, "invoices");
      const snapshot = await getDocs(projectInvoicesRef);
      const projectInvoices = snapshot.docs.map((invoiceDoc) => ({ id: invoiceDoc.id, ...invoiceDoc.data() }));

      const existingByWeek = projectInvoices.find((invoice) => Number(invoice.weekNumber || 0) === weekNumber);
      if (existingByWeek?.id && assignmentMode !== "new") {
        const existingPaymentTerms = String(existingByWeek.paymentTerms || "net30").trim().toLowerCase() || "net30";
        const existingNetDays = resolveNetDays(existingPaymentTerms, existingByWeek.netDays);
        const existingMondayDate = toDateInputValue(existingByWeek.mondayDate);
        const computedDueDate = existingMondayDate ? shiftDateInputValue(existingMondayDate, existingNetDays) : toDateInputValue(existingByWeek.dueDate);

        const payload = {
          weekNumber,
          weekLabel: `Week ${weekNumber}`,
          invoiceNumber,
          total: totalValue,
          mondayDate: existingMondayDate,
          dueDate: computedDueDate,
          paymentTerms: existingPaymentTerms,
          netDays: existingNetDays,
          isPaid: Boolean(existingByWeek.isPaid),
          invoiceStatus: normalizeInvoiceStatus(existingByWeek.invoiceStatus, totalValue, existingByWeek.invoiceNumber),
          isPlaceholder: false,
          generatedFromWeek: null,
          updatedAt: serverTimestamp(),
          updatedByUid: user?.uid || "",
          changeLog: [
            ...(Array.isArray(existingByWeek?.changeLog) ? existingByWeek.changeLog : []),
            buildInvoiceLogEntry({
              action: "Updated",
              note: "Adjusted from Reconciliation: Missing in System assignment.",
              changes: {
                before: {
                  weekNumber: Number(existingByWeek?.weekNumber || 0) || "",
                  invoiceNumber: normalizeInvoiceNumber(existingByWeek?.invoiceNumber || ""),
                  total: parseAmountValue(existingByWeek?.total),
                },
                after: {
                  weekNumber,
                  invoiceNumber,
                  total: totalValue,
                },
              },
            }),
          ],
        };

        await updateDoc(doc(db, "churches", id, "invoiceProjects", projectId, "invoices", existingByWeek.id), payload);
      } else {
        if (assignmentMode !== "new") {
          toast.error("Selected week is not available anymore for this project.");
          return;
        }

        if (!weekStartDate) {
          toast.error("Select a start date to create a new week.");
          return;
        }

        const paymentTerms = "net30";
        const netDays = resolveNetDays(paymentTerms);
        const dueDate = shiftDateInputValue(weekStartDate, netDays);

        await addDoc(projectInvoicesRef, {
          weekNumber,
          weekLabel: `Week ${weekNumber}`,
          invoiceNumber,
          total: totalValue,
          mondayDate: weekStartDate,
          dueDate,
          paymentTerms,
          netDays,
          isPaid: false,
          invoiceStatus: normalizeInvoiceStatus("", totalValue, invoiceNumber),
          isPlaceholder: false,
          generatedFromWeek: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdByUid: user?.uid || "",
          createdByEmail: user?.email || "",
          changeLog: [
            buildInvoiceLogEntry({
              action: "Created",
              note: "Created from Reconciliation: Missing in System assignment.",
              changes: {
                weekNumber,
                invoiceNumber,
                total: totalValue,
                mondayDate: weekStartDate,
                dueDate,
              },
            }),
          ],
        });
      }

      const nextResult = runInvoiceReconciliation(excelInvoiceRows);
      await saveReconciliationReport(nextResult, { source: "assignment", showSuccessToast: false });
      toast.success(`${existingByWeek?.id ? "Updated" : "Created"} ${invoiceNumber} on project week ${weekNumber}.`);
    } catch (error) {
      console.error("Failed to apply missing-in-system assignment:", error);
      toast.error("Could not apply assignment.");
    } finally {
      setSavingMissingSystemAssignments((previous) => ({ ...previous, [key]: false }));
    }
  };

  const setDuplicateInvoiceEditField = (row, field, value) => {
    const key = `${row.projectId || ""}::${row.id || ""}`;
    setDuplicateInvoiceEdits((previous) => {
      const current = previous[key] || {
        invoiceNumber: normalizeInvoiceNumber(row.invoiceNumber),
        total: row.total === null || row.total === undefined ? "" : String(row.total),
      };

      return {
        ...previous,
        [key]: {
          ...current,
          [field]: value,
        },
      };
    });
  };

  const handleSaveDuplicateInvoiceRow = async (row) => {
    if (!canManageInvoices || !id) {
      toast.error("You do not have permission to update invoices.");
      return;
    }

    const key = `${row.projectId || ""}::${row.id || ""}`;
    const edit = duplicateInvoiceEdits[key] || {
      invoiceNumber: normalizeInvoiceNumber(row.invoiceNumber),
      total: row.total === null || row.total === undefined ? "" : String(row.total),
    };

    const nextInvoiceNumber = normalizeInvoiceNumber(edit.invoiceNumber);
    const nextTotal = parseAmountValue(edit.total);

    if (!nextInvoiceNumber) {
      toast.error("Invoice # is required.");
      return;
    }

    if (nextTotal === null || nextTotal < 0) {
      toast.error("Total must be 0 or greater.");
      return;
    }

    setSavingDuplicateInvoiceEdits((previous) => ({ ...previous, [key]: true }));
    try {
      const invoiceDocRef = doc(db, "churches", id, "invoiceProjects", row.projectId, "invoices", row.id);
      const invoiceSnapshot = await getDoc(invoiceDocRef);
      const existingInvoice = invoiceSnapshot.exists() ? invoiceSnapshot.data() : {};
      const existingChangeLog = Array.isArray(existingInvoice?.changeLog) ? existingInvoice.changeLog : [];

      await updateDoc(invoiceDocRef, {
        invoiceNumber: nextInvoiceNumber,
        total: nextTotal,
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || "",
        changeLog: [
          ...existingChangeLog,
          buildInvoiceLogEntry({
            action: "Updated",
            note: "Adjusted from Reconciliation: duplicate invoice correction.",
            changes: {
              before: {
                invoiceNumber: normalizeInvoiceNumber(existingInvoice?.invoiceNumber || row.invoiceNumber || ""),
                total: parseAmountValue(existingInvoice?.total ?? row.total),
              },
              after: {
                invoiceNumber: nextInvoiceNumber,
                total: nextTotal,
              },
            },
          }),
        ],
      });

      const nextResult = runInvoiceReconciliation(excelInvoiceRows);
      await saveReconciliationReport(nextResult, { source: "duplicate-adjustment", showSuccessToast: false });
      toast.success(`Updated duplicate row for ${nextInvoiceNumber}.`);
    } catch (error) {
      console.error("Failed to update duplicate invoice row:", error);
      toast.error("Could not update duplicate row.");
    } finally {
      setSavingDuplicateInvoiceEdits((previous) => ({ ...previous, [key]: false }));
    }
  };

  if (checkingPermissions) {
    return (
      <div style={commonStyles.pageContainer}>
        <ChurchHeader id={id} />
        <div style={{ padding: "16px" }}>Checking permissions...</div>
      </div>
    );
  }

  if (!canManageInvoices) {
    return (
      <div style={commonStyles.pageContainer}>
        <ChurchHeader id={id} />
        <div style={{ ...cardStyle, marginTop: "16px" }}>
          <h2 style={{ marginTop: 0 }}>Invoices</h2>
          <p style={{ marginBottom: "12px", color: "#4B5563" }}>
            You do not have permission to manage this module.
          </p>
          <Link to={`${routePrefix}/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
            Back to Mi Organizacion
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={commonStyles.pageContainer}>
      <ChurchHeader id={id} />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "12px",
          marginBottom: "16px",
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ margin: 0 }}>Invoice Projects</h1>
        <Link to={`${routePrefix}/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
          Back to Mi Organizacion
        </Link>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(280px, 340px) minmax(0, 1fr)",
          gap: "16px",
          alignItems: "start",
        }}
      >
        <div style={cardStyle}>
          <h2 style={{ marginTop: 0, marginBottom: "12px" }}>Projects</h2>

          <div
            style={{
              marginBottom: "12px",
              padding: "10px 12px",
              borderRadius: "10px",
              border: "1px solid #BFDBFE",
              background: "#EFF6FF",
              color: "#1E3A8A",
              fontWeight: 700,
              fontSize: "0.9rem",
            }}
          >
            <div>All Projects Total Billed (Final): {formatCurrency(allProjectsTotal)}</div>
            <div style={{ marginTop: "4px" }}>
              All Projects Total Budgeted: {formatCurrency(allProjectsBudgetedInvoiceTotal)}
            </div>
            <div style={{ marginTop: "4px" }}>
              All Projects Subtotal (Final + Budgeted): {formatCurrency(allProjectsSubtotalInvoiceTotal)}
            </div>
            <div style={{ marginTop: "4px" }}>
              All Projects Total Due: {formatCurrency(allProjectsDueTotal)}
            </div>
          </div>

          <form onSubmit={handleCreateProject} style={{ display: "grid", gap: "8px", marginBottom: "14px" }}>
            <input
              style={inputStyle}
              placeholder="Project name"
              value={projectDraft.name}
              onChange={(event) =>
                setProjectDraft((prev) => ({ ...prev, name: event.target.value }))
              }
            />
            <textarea
              style={{ ...inputStyle, minHeight: "70px", resize: "vertical" }}
              placeholder="Project description (optional)"
              value={projectDraft.description}
              onChange={(event) =>
                setProjectDraft((prev) => ({ ...prev, description: event.target.value }))
              }
            />
            <div>
              <label style={fieldLabelStyle}>Associated Time Rotate Projects</label>
              <select
                multiple
                style={{ ...inputStyle, minHeight: "96px" }}
                value={normalizeTimeRotateProjectNames(projectDraft.timeRotateProjectNames)}
                onChange={(event) => {
                  const selectedValues = Array.from(event.target.selectedOptions).map((option) => option.value);
                  setProjectDraft((prev) => ({ ...prev, timeRotateProjectNames: normalizeTimeRotateProjectNames(selectedValues) }));
                }}
              >
                {timeRotateProjectOptions.length === 0 ? (
                  <option value="" disabled>No Time Rotate project names found yet.</option>
                ) : (
                  timeRotateProjectOptions.map((projectName) => (
                    <option key={`create-time-rotate-${projectName}`} value={projectName}>
                      {projectName}
                    </option>
                  ))
                )}
              </select>
              <small style={fieldHintStyle}>Hold Ctrl/Cmd to select multiple.</small>
            </div>
            <button
              type="submit"
              style={{ ...buttonStyle, background: "#2563EB", justifySelf: "start" }}
            >
              Add Project
            </button>
          </form>

          {loadingProjects ? (
            <p style={{ color: "#6B7280", margin: 0 }}>Loading projects...</p>
          ) : projects.length === 0 ? (
            <p style={{ color: "#6B7280", margin: 0 }}>No projects yet.</p>
          ) : (
            <div style={{ display: "grid", gap: "8px" }}>
              {projects.map((project) => {
                const selected = project.id === selectedProjectId;
                const isEditing = editingProjectId === project.id;
                const projectTotalFinal = Number(projectFinalTotalsLiveById[project.id] || 0);
                const projectTotalBudgeted = Number(projectBudgetedInvoiceTotalsLiveById[project.id] || 0);
                const projectSubtotal = Number(projectSubtotalInvoiceTotalsLiveById[project.id] || 0);
                const projectDueTotal = Number(projectDueTotalsLiveById[project.id] || 0);

                return (
                  <div
                    key={project.id}
                    style={{
                      border: selected ? "1px solid #2563EB" : "1px solid #E5E7EB",
                      borderRadius: "10px",
                      padding: "10px",
                      background: selected ? "#EFF6FF" : "#FFFFFF",
                    }}
                  >
                    {isEditing ? (
                      <form onSubmit={handleUpdateProject} style={{ display: "grid", gap: "8px" }}>
                        <input
                          style={inputStyle}
                          value={editProjectDraft.name}
                          onChange={(event) =>
                            setEditProjectDraft((prev) => ({ ...prev, name: event.target.value }))
                          }
                        />
                        <textarea
                          style={{ ...inputStyle, minHeight: "66px", resize: "vertical" }}
                          value={editProjectDraft.description}
                          onChange={(event) =>
                            setEditProjectDraft((prev) => ({ ...prev, description: event.target.value }))
                          }
                        />
                        <div>
                          <label style={fieldLabelStyle}>Associated Time Rotate Projects</label>
                          <select
                            multiple
                            style={{ ...inputStyle, minHeight: "96px" }}
                            value={normalizeTimeRotateProjectNames(editProjectDraft.timeRotateProjectNames)}
                            onChange={(event) => {
                              const selectedValues = Array.from(event.target.selectedOptions).map((option) => option.value);
                              setEditProjectDraft((prev) => ({ ...prev, timeRotateProjectNames: normalizeTimeRotateProjectNames(selectedValues) }));
                            }}
                          >
                            {timeRotateProjectOptions.length === 0 ? (
                              <option value="" disabled>No Time Rotate project names found yet.</option>
                            ) : (
                              timeRotateProjectOptions.map((projectName) => (
                                <option key={`edit-time-rotate-${project.id}-${projectName}`} value={projectName}>
                                  {projectName}
                                </option>
                              ))
                            )}
                          </select>
                          <small style={fieldHintStyle}>Hold Ctrl/Cmd to select multiple.</small>
                        </div>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          <button type="submit" style={{ ...buttonStyle, background: "#16A34A" }}>
                            Save
                          </button>
                          <button
                            type="button"
                            style={{ ...buttonStyle, background: "#6B7280" }}
                            onClick={() => {
                              setEditingProjectId("");
                              setEditProjectDraft({ name: "", description: "", timeRotateProjectNames: [] });
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            style={{ ...buttonStyle, background: "#DC2626" }}
                            onClick={() => handleDeleteProject(project.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setSelectedProjectId(project.id)}
                          style={{
                            border: "none",
                            background: "transparent",
                            padding: 0,
                            width: "100%",
                            textAlign: "left",
                            cursor: "pointer",
                          }}
                        >
                          <div style={{ fontWeight: 700 }}>{project.name || "Untitled Project"}</div>
                          {project.description ? (
                            <div style={{ marginTop: "4px", color: "#4B5563", fontSize: "0.9rem" }}>
                              {project.description}
                            </div>
                          ) : null}
                          <div style={{ marginTop: "6px", color: "#1F2937", fontSize: "0.82rem", fontWeight: 600 }}>
                            Total Final: {formatCurrency(projectTotalFinal)}
                          </div>
                          <div style={{ marginTop: "4px", color: "#1F2937", fontSize: "0.82rem", fontWeight: 600 }}>
                            Total Budgeted: {formatCurrency(projectTotalBudgeted)}
                          </div>
                          <div style={{ marginTop: "4px", color: "#0F172A", fontSize: "0.82rem", fontWeight: 700 }}>
                            Subtotal: {formatCurrency(projectSubtotal)}
                          </div>
                          <div style={{ marginTop: "4px", color: "#7C2D12", fontSize: "0.82rem", fontWeight: 700 }}>
                            Total Due: {formatCurrency(projectDueTotal)}
                          </div>
                          <div style={{ marginTop: "4px", color: "#334155", fontSize: "0.8rem" }}>
                            Time Rotate Linked: {normalizeTimeRotateProjectNames(project.timeRotateProjectNames).length > 0
                              ? normalizeTimeRotateProjectNames(project.timeRotateProjectNames).join(", ")
                              : "None"}
                          </div>
                        </button>

                        <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                          <button
                            type="button"
                            style={{ ...buttonStyle, background: "#F59E0B" }}
                            onClick={() => startProjectEdit(project)}
                          >
                            Edit / Associate
                          </button>
                          <Link
                            to={getBudgetInvoiceCreateHref(project.name)}
                            style={{
                              ...buttonStyle,
                              background: "#1D4ED8",
                              textDecoration: "none",
                              display: "inline-flex",
                              alignItems: "center",
                            }}
                          >
                            Create Invoice
                          </Link>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={cardStyle}>
          <h2 style={{ marginTop: 0, marginBottom: "12px" }}>Invoices</h2>

          <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => handleInvoicesTabChange("table")}
              style={{
                ...buttonStyle,
                background: activeInvoicesTab === "table" ? "#1D4ED8" : "#94A3B8",
              }}
            >
              Invoice Table
            </button>
            <button
              type="button"
              onClick={() => handleInvoicesTabChange("reconciliation")}
              style={{
                ...buttonStyle,
                background: activeInvoicesTab === "reconciliation" ? "#1D4ED8" : "#94A3B8",
              }}
            >
              Excel Reconciliation
            </button>
            <button
              type="button"
              onClick={() => handleInvoicesTabChange("td-matcher")}
              style={{
                ...buttonStyle,
                background: activeInvoicesTab === "td-matcher" ? "#1D4ED8" : "#94A3B8",
              }}
            >
              TD Matcher
            </button>
            <button
              type="button"
              onClick={() => handleInvoicesTabChange("hours-audit")}
              style={{
                ...buttonStyle,
                background: activeInvoicesTab === "hours-audit" ? "#1D4ED8" : "#94A3B8",
              }}
            >
              Hours Audit
            </button>
            <button
              type="button"
              onClick={() => handleInvoicesTabChange("business-intelligence")}
              style={{
                ...buttonStyle,
                background: activeInvoicesTab === "business-intelligence" ? "#1D4ED8" : "#94A3B8",
              }}
            >
              Business Intelligence
            </button>
            <button
              type="button"
              onClick={() => handleInvoicesTabChange("quick-paid")}
              style={{
                ...buttonStyle,
                background: activeInvoicesTab === "quick-paid" ? "#1D4ED8" : "#94A3B8",
              }}
            >
              Quick Paid Update
            </button>
          </div>

          <div style={{ display: "flex", gap: "10px", marginBottom: "12px", flexWrap: "wrap", fontSize: "0.8rem" }}>
            <a href={getInvoiceTabHref("business-intelligence")} style={{ color: "#1D4ED8", textDecoration: "underline" }}>BI Link</a>
            <a href={getInvoiceTabHref("table")} style={{ color: "#1D4ED8", textDecoration: "underline" }}>Invoice Table Link</a>
            <a href={getInvoiceTabHref("reconciliation")} style={{ color: "#1D4ED8", textDecoration: "underline" }}>Reconciliation Link</a>
            <a href={getInvoiceTabHref("td-matcher")} style={{ color: "#1D4ED8", textDecoration: "underline" }}>TD Matcher Link</a>
            <a href={getInvoiceTabHref("hours-audit")} style={{ color: "#1D4ED8", textDecoration: "underline" }}>Hours Audit Link</a>
            <a href={getInvoiceTabHref("quick-paid")} style={{ color: "#1D4ED8", textDecoration: "underline" }}>Quick Paid Link</a>
          </div>

          {activeInvoicesTab === "table" ? (
            !selectedProjectId ? (
            <p style={{ color: "#6B7280", margin: 0 }}>Select a project to manage invoices.</p>
            ) : (
            <>
              <div
                style={{
                  marginBottom: "12px",
                  padding: "10px 12px",
                  borderRadius: "10px",
                  border: `1px solid ${previousWeekStatus.isUpToDate ? "#BBF7D0" : "#FDE68A"}`,
                  background: previousWeekStatus.isUpToDate ? "#F0FDF4" : "#FFFBEB",
                }}
              >
                <div style={{ fontWeight: 700, color: "#111827", marginBottom: "4px" }}>
                  Previous Week Status
                </div>
                <div style={{ color: "#374151", fontSize: "0.92rem" }}>
                  {previousWeekStatus.isUpToDate
                    ? `This project is up to date through Week ${previousWeekStatus.previousWeekNumber}.`
                    : `${previousWeekStatus.missingCount} invoice week${previousWeekStatus.missingCount === 1 ? "" : "s"} need to be created to be up to date through Week ${previousWeekStatus.previousWeekNumber}.`}
                </div>
                <div style={{ color: "#6B7280", fontSize: "0.82rem", marginTop: "4px" }}>
                  Latest existing week: {previousWeekStatus.highestExistingWeek || "None"}
                </div>
                {!previousWeekStatus.isUpToDate ? (
                  <button
                    type="button"
                    onClick={handleCatchUpToPreviousWeek}
                    disabled={creatingCatchUpInvoices}
                    style={{
                      ...buttonStyle,
                      background: "#D97706",
                      marginTop: "10px",
                      opacity: creatingCatchUpInvoices ? 0.7 : 1,
                    }}
                  >
                    {creatingCatchUpInvoices
                      ? "Creating Missing Invoices..."
                      : `Create ${previousWeekStatus.missingCount} Missing Invoice${previousWeekStatus.missingCount === 1 ? "" : "s"}`}
                  </button>
                ) : null}
              </div>

              <div style={{ ...tableShellStyle, marginBottom: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "center", padding: "10px 12px", borderBottom: "1px solid #E5E7EB", background: "#FCFCFD", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                    <div style={{ fontSize: "0.94rem", fontWeight: 700, color: "#111827" }}>Invoice Table</div>
                    <span style={toolbarMetricStyle}>Rows: {invoices.length}</span>
                    <span style={toolbarMetricStyle}>Next Week: {invoiceDraft.weekNumber || "-"}</span>
                    <span style={toolbarMetricStyle}>Due Day: {invoiceDraft.dueDate ? formatWeekdayName(invoiceDraft.dueDate) : "-"}</span>
                  </div>
                </div>

              <form onSubmit={handleCreateInvoice} style={{ display: "grid", gap: "8px", padding: "12px", borderBottom: "1px solid #E5E7EB", background: "#F8FAFC" }}>
                <div style={{ fontSize: "0.76rem", fontWeight: 700, color: "#475569", letterSpacing: "0.04em", textTransform: "uppercase" }}>Add Invoice Row</div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.05fr 1fr 0.9fr 1fr 0.95fr 1fr auto",
                    gap: "8px",
                    alignItems: "end",
                  }}
                >
                  <div>
                    <label style={fieldLabelStyle}>Week</label>
                    <input
                      style={compactInputStyle}
                      type="text"
                      placeholder="Example: Week 10"
                      value={invoiceDraft.weekNumber}
                      onChange={(event) =>
                        setInvoiceDraft((prev) => ({ ...prev, weekNumber: event.target.value }))
                      }
                      onInput={() => setIsInvoiceDraftDirty(true)}
                    />
                  </div>
                  <div>
                    <label style={fieldLabelStyle}>Invoice #</label>
                    <input
                      style={compactInputStyle}
                      placeholder="Example: INV-2026-010"
                      value={invoiceDraft.invoiceNumber}
                      onChange={(event) =>
                        setInvoiceDraft((prev) => ({ ...prev, invoiceNumber: event.target.value }))
                      }
                      onInput={() => setIsInvoiceDraftDirty(true)}
                    />
                  </div>
                  <div>
                    <label style={fieldLabelStyle}>Total</label>
                    <input
                      style={compactInputStyle}
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Example: 1250.00"
                      value={invoiceDraft.total}
                      onChange={(event) =>
                        setInvoiceDraft((prev) => ({ ...prev, total: event.target.value }))
                      }
                      onInput={() => setIsInvoiceDraftDirty(true)}
                    />
                  </div>
                  <div>
                    <label style={fieldLabelStyle}>Monday</label>
                    <input
                      style={compactInputStyle}
                      type="date"
                      value={invoiceDraft.mondayDate}
                      onChange={(event) =>
                        setInvoiceDraft((prev) => ({ ...prev, mondayDate: event.target.value }))
                      }
                      onInput={() => setIsInvoiceDraftDirty(true)}
                    />
                  </div>
                  <div>
                    <label style={fieldLabelStyle}>Terms</label>
                    <select
                      style={compactInputStyle}
                      value={invoiceDraft.paymentTerms}
                      onChange={(event) =>
                        setInvoiceDraft((prev) => ({ ...prev, paymentTerms: event.target.value }))
                      }
                      onInput={() => setIsInvoiceDraftDirty(true)}
                    >
                      {PAYMENT_TERM_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={fieldLabelStyle}>Due Date</label>
                    <input
                      style={compactInputStyle}
                      type="text"
                      readOnly
                      value={invoiceDraft.dueDate ? formatDisplayDate(invoiceDraft.dueDate) : ""}
                      placeholder="Select Monday + payment terms"
                    />
                  </div>
                  <div>
                    <button type="submit" style={{ ...compactButtonStyle, background: "#2563EB", minHeight: "34px" }}>
                      Add
                    </button>
                  </div>
                </div>
                <small style={{ color: "#6B7280" }}>
                  Add Invoice defaults to the next week. If you add Week 10, missing weeks before it are auto-created with shifted Monday and due dates.
                </small>
                <small style={{ color: "#0C4A6E", fontWeight: 700 }}>
                  Billable labor policy: {OVERTIME_POLICY_LABEL}
                </small>
              </form>

              <div
                style={{
                  display: "grid",
                  gap: "8px",
                  padding: "12px",
                  borderBottom: "1px solid #E5E7EB",
                  background: "#FFF7ED",
                }}
              >
                <div style={{ fontSize: "0.76rem", fontWeight: 700, color: "#9A3412", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                  Recreate Deleted Week
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "end", flexWrap: "wrap" }}>
                  <div style={{ minWidth: "180px" }}>
                    <label style={fieldLabelStyle}>Week to Recreate</label>
                    <input
                      style={compactInputStyle}
                      type="text"
                      placeholder="Example: Week 8"
                      value={recreateWeekNumber}
                      onChange={(event) => setRecreateWeekNumber(event.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleRecreateWeek}
                    disabled={recreatingWeek}
                    style={{
                      ...compactButtonStyle,
                      background: "#EA580C",
                      opacity: recreatingWeek ? 0.7 : 1,
                    }}
                  >
                    {recreatingWeek ? "Recreating..." : "Recreate Week"}
                  </button>
                </div>
                <small style={{ color: "#9A3412" }}>
                  Restores only the selected missing week with auto-calculated Monday and due date.
                </small>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px", padding: "12px", borderBottom: "1px solid #E5E7EB", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
                  <strong style={{ color: "#0F172A", fontSize: "0.85rem" }}>Columns:</strong>
                  {INVOICE_TABLE_COLUMN_DEFS.map((column) => (
                    <label key={column.key} style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", color: "#334155", fontSize: "0.85rem" }}>
                      <input
                        type="checkbox"
                        checked={Boolean(visibleInvoiceTableColumns[column.key])}
                        onChange={() => toggleInvoiceTableColumn(column.key)}
                      />
                      {column.label}
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleDownloadInvoiceStatusReportPdf}
                  disabled={downloadingInvoiceStatusReport || !invoices.length}
                  style={{
                    ...compactButtonStyle,
                    background: "#1D4ED8",
                    opacity: downloadingInvoiceStatusReport || !invoices.length ? 0.7 : 1,
                  }}
                >
                  {downloadingInvoiceStatusReport ? "Generating PDF..." : "Download Invoice Status Report (PDF)"}
                </button>
              </div>

              {editingInvoiceId ? (() => {
                const activeInvoice = invoices.find((invoice) => invoice.id === editingInvoiceId);
                if (!activeInvoice) return null;

                const activeRowHoursData = invoiceHoursById[activeInvoice.id] || {
                  totalMilliseconds: 0,
                  totalRegularMilliseconds: 0,
                  totalOvertimeMilliseconds: 0,
                  users: [],
                };
                const activeRowUsersHours = Array.isArray(activeRowHoursData.users) ? activeRowHoursData.users : [];

                return (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", padding: "12px", borderBottom: "1px solid #E5E7EB", background: "#F8FAFC" }}>
                    <strong style={{ color: "#0F172A", fontSize: "0.85rem" }}>
                      {`Actions for #${activeInvoice.weekNumber || "-"}:`}
                    </strong>
                    <button
                      type="button"
                      style={{ ...compactButtonStyle, background: "#0F766E" }}
                      onClick={() => setInvoiceLogModalInvoice(activeInvoice)}
                    >
                      Log
                    </button>
                    <button
                      type="button"
                      style={{ ...compactButtonStyle, background: "#7C3AED", opacity: uploadingExternalPdfInvoiceId === activeInvoice.id ? 0.7 : 1 }}
                      onClick={() => handleSelectExternalPdf(activeInvoice.id)}
                      disabled={!canManageInvoices || uploadingExternalPdfInvoiceId === activeInvoice.id}
                    >
                      {uploadingExternalPdfInvoiceId === activeInvoice.id ? "Uploading PDF..." : "Upload External PDF"}
                    </button>
                    {activeInvoice.externalPdf?.url ? (
                      <a
                        href={activeInvoice.externalPdf.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ ...compactButtonStyle, display: "inline-flex", alignItems: "center", background: "#475569", textDecoration: "none" }}
                        title={activeInvoice.externalPdf.name || "View external invoice PDF"}
                      >
                        View External PDF
                      </a>
                    ) : null}
                    <button
                      type="button"
                      style={{ ...compactButtonStyle, background: "#1D4ED8" }}
                      onClick={() => handleExportBillableInvoice(activeInvoice, activeRowHoursData)}
                      disabled={activeRowUsersHours.length === 0}
                      title={activeRowUsersHours.length === 0 ? "No user hours available" : "View billable invoice"}
                    >
                      View Billable Invoice
                    </button>
                    <button
                      type="button"
                      style={{ ...compactButtonStyle, background: "#DC2626" }}
                      onClick={() => handleDeleteInvoice(activeInvoice.id)}
                    >
                      Delete
                    </button>
                  </div>
                );
              })() : null}

              {loadingInvoices ? (
                <p style={{ color: "#6B7280", margin: 0 }}>Loading invoices...</p>
              ) : invoices.length === 0 ? (
                <div style={{ padding: "16px", color: "#6B7280" }}>No invoices for this project.</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <input
                    ref={externalPdfInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={handleExternalPdfUpload}
                    style={{ display: "none" }}
                  />
                  <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                    <thead>
                      <tr>
                        <th style={tableHeaderCellStyle}>Week</th>
                        <th style={tableHeaderCellStyle}>Start of Week</th>
                        <th style={tableHeaderCellStyle}>End of Week</th>
                        <th style={{ ...tableHeaderCellStyle, width: "70px" }}>Total</th>
                        <th style={{ ...tableHeaderCellStyle, width: "110px" }}>Hours &amp; Labor</th>
                        <th style={tableHeaderCellStyle}>Invoice #</th>
                        {visibleInvoiceTableColumns.dueDate ? <th style={tableHeaderCellStyle}>Due Date</th> : null}
                        {visibleInvoiceTableColumns.dueDay ? <th style={tableHeaderCellStyle}>Due Day</th> : null}
                        {visibleInvoiceTableColumns.countdown ? <th style={tableHeaderCellStyle}>Countdown</th> : null}
                        <th style={tableHeaderCellStyle}>Terms</th>
                        <th style={tableHeaderCellStyle}>Invoice Status</th>
                        <th style={tableHeaderCellStyle}>Paid Status</th>
                        <th style={tableHeaderCellStyle}>Billing Source</th>
                        <th style={tableHeaderCellStyle}>AP Status</th>
                        <th style={tableHeaderCellStyle}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((invoice, index) => {
                        const isEditing = editingInvoiceId === invoice.id;
                        const dueCountdown = getDueCountdownMeta(invoice.dueDate);
                        const weekEndDate = shiftDateInputValue(invoice.mondayDate, 6);
                        const weekGapInfo = getWeekSequenceGapInfo(invoice.weekNumber, invoice.mondayDate, invoices, invoice.id);
                        const rowHoursData = invoiceHoursById[invoice.id] || {
                          totalMilliseconds: 0,
                          totalRegularMilliseconds: 0,
                          totalOvertimeMilliseconds: 0,
                          users: [],
                        };
                        const rowUsersHours = Array.isArray(rowHoursData.users) ? rowHoursData.users : [];
                        const rowLaborCost = getLaborCostFromSplit(
                          rowHoursData.totalRegularMilliseconds,
                          rowHoursData.totalOvertimeMilliseconds
                        );
                        // Main System billing always tracks the live Hours & Labor cost instead of
                        // whatever total was last saved, so the two never drift out of sync.
                        const effectiveInvoiceTotal = normalizeBillingSource(invoice.billingSource) === "main_system"
                          ? rowLaborCost.totalCost
                          : invoice.total;
                        const isMissingInvoiceTotal = !effectiveInvoiceTotal;
                        const invoiceTotalValue = parseAmountValue(effectiveInvoiceTotal);
                        const hasUpdatedInvoiceTotal = invoiceTotalValue !== null && invoiceTotalValue > 0;
                        const hasPlaceholderInvoiceNumber = isPlaceholderInvoiceNumber(invoice.invoiceNumber);
                        const shouldHighlightPendingInvoiceNumber = hasUpdatedInvoiceTotal && hasPlaceholderInvoiceNumber;
                        const isMasterInvoice = invoice.isPlaceholder !== true && invoices.some(
                          (linkedInvoice) =>
                            linkedInvoice.id !== invoice.id
                            && linkedInvoice.isPlaceholder === true
                            && Number(linkedInvoice.generatedFromWeek) === Number(invoice.weekNumber)
                        );
                        const rowBg = isMissingInvoiceTotal
                          ? (index % 2 === 0 ? "#FEE2E2" : "#FECACA")
                          : shouldHighlightPendingInvoiceNumber
                            ? (index % 2 === 0 ? "#FEF9C3" : "#FEF08A")
                            : (index % 2 === 0 ? "#FFFFFF" : "#F3F4F6");

                        if (isEditing) {
                          const editDueDate = editInvoiceDraft.mondayDate
                            ? shiftDateInputValue(editInvoiceDraft.mondayDate, resolveNetDays(editInvoiceDraft.paymentTerms))
                            : "";
                          const editWeekEndDate = editInvoiceDraft.mondayDate
                            ? shiftDateInputValue(editInvoiceDraft.mondayDate, 6)
                            : "";
                          const editWeekGapInfo = getWeekSequenceGapInfo(
                            editInvoiceDraft.weekNumber,
                            editInvoiceDraft.mondayDate,
                            invoices,
                            invoice.id
                          );
                          return (
                            <tr key={invoice.id} style={{ background: rowBg }}>
                              <td style={tableBodyCellStyle}>
                                {isMasterInvoice ? (
                                  <input
                                    style={compactInputStyle}
                                    type="text"
                                    placeholder="Week"
                                    title="Week Name or Number"
                                    value={editInvoiceDraft.weekNumber}
                                    onChange={(event) =>
                                      setEditInvoiceDraft((prev) => ({ ...prev, weekNumber: event.target.value }))
                                    }
                                  />
                                ) : (
                                  <span title="Week Name or Number">{`#${editInvoiceDraft.weekNumber || "-"}`}</span>
                                )}
                              </td>
                              <td style={tableBodyCellStyle}>
                                {isMasterInvoice ? (
                                  <input
                                    style={compactInputStyle}
                                    type="date"
                                    title="Monday for This Week"
                                    value={editInvoiceDraft.mondayDate}
                                    onChange={(event) =>
                                      setEditInvoiceDraft((prev) => ({ ...prev, mondayDate: event.target.value }))
                                    }
                                  />
                                ) : (
                                  <span title="Monday for This Week">{formatDisplayDate(editInvoiceDraft.mondayDate)}</span>
                                )}
                                {editWeekGapInfo.hasGap ? (
                                  <div style={{ marginTop: "4px", fontSize: "0.72rem", color: "#B91C1C", display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
                                    <span>
                                      Gap: expected {formatDisplayDate(editWeekGapInfo.expectedMondayDate)}
                                      {" "}({editWeekGapInfo.gapDays > 0 ? "+" : ""}{editWeekGapInfo.gapDays}d off)
                                    </span>
                                    {isMasterInvoice ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setEditInvoiceDraft((prev) => ({ ...prev, mondayDate: editWeekGapInfo.expectedMondayDate }))
                                        }
                                        style={{ border: "none", borderRadius: "4px", padding: "1px 6px", background: "#B91C1C", color: "#FFFFFF", fontSize: "0.7rem", cursor: "pointer" }}
                                      >
                                        Fix
                                      </button>
                                    ) : null}
                                  </div>
                                ) : null}
                              </td>
                              <td style={tableBodyCellStyle}>
                                <span title="Sunday for This Week">{formatDisplayDate(editWeekEndDate)}</span>
                              </td>
                              <td style={tableBodyCellStyle}>
                                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                  <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "#1F2937" }}>$</span>
                                  <input
                                    style={compactInputStyle}
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    title={normalizeBillingSource(editInvoiceDraft.billingSource) === "freshbooks" ? "Invoice Total" : "Total is calculated from Hours & Labor cost while Billing Source is Main System"}
                                    value={
                                      normalizeBillingSource(editInvoiceDraft.billingSource) === "freshbooks"
                                        ? editInvoiceDraft.total
                                        : rowLaborCost.totalCost.toFixed(2)
                                    }
                                    disabled={normalizeBillingSource(editInvoiceDraft.billingSource) !== "freshbooks"}
                                    onChange={(event) =>
                                      setEditInvoiceDraft((prev) => ({ ...prev, total: event.target.value }))
                                    }
                                  />
                                </div>
                              </td>
                              <td style={tableBodyCellStyle}>
                                <span
                                  style={{
                                    display: "inline-block",
                                    padding: "4px 8px",
                                    borderRadius: "999px",
                                    background: "#E0F2FE",
                                    color: "#0C4A6E",
                                    fontSize: "0.8rem",
                                    fontWeight: 700,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {formatHoursUsed(rowHoursData.totalMilliseconds)}
                                </span>
                                <div style={{ marginTop: "4px", fontSize: "0.74rem", color: "#0C4A6E", fontWeight: 700 }}>
                                  Cost: {formatCurrency(rowLaborCost.totalCost)}
                                </div>
                              </td>
                              <td style={tableBodyCellStyle}>
                                <input
                                  style={compactInputStyle}
                                  title="Invoice Number"
                                  value={String(editInvoiceDraft.invoiceNumber || "").toUpperCase()}
                                  onChange={(event) =>
                                    setEditInvoiceDraft((prev) => ({ ...prev, invoiceNumber: event.target.value.toUpperCase() }))
                                  }
                                />
                              </td>
                              {visibleInvoiceTableColumns.dueDate ? (
                                <td style={tableBodyCellStyle}>
                                  <span title="Calculated Due Date">{editDueDate ? formatDisplayDate(editDueDate) : "-"}</span>
                                </td>
                              ) : null}
                              {visibleInvoiceTableColumns.dueDay ? (
                                <td style={tableBodyCellStyle}>
                                  <span title="Due Day">{editDueDate ? formatWeekdayName(editDueDate) : "-"}</span>
                                </td>
                              ) : null}
                              {visibleInvoiceTableColumns.countdown ? (
                                <td style={tableBodyCellStyle}>
                                  {editDueDate ? (() => {
                                    const editCountdown = getDueCountdownMeta(editDueDate);

                                    return (
                                      <span
                                        title="Countdown"
                                        style={{
                                          display: "inline-block",
                                          padding: "4px 8px",
                                          borderRadius: "999px",
                                          background: editCountdown.bgColor,
                                          color: editCountdown.textColor,
                                          fontSize: "0.8rem",
                                          fontWeight: 600,
                                          whiteSpace: "nowrap",
                                        }}
                                      >
                                        {editCountdown.label}
                                      </span>
                                    );
                                  })() : "-"}
                                </td>
                              ) : null}
                              <td style={tableBodyCellStyle}>
                                <select
                                  style={compactInputStyle}
                                  title="Payment Terms"
                                  value={editInvoiceDraft.paymentTerms}
                                  onChange={(event) =>
                                    setEditInvoiceDraft((prev) => ({ ...prev, paymentTerms: event.target.value }))
                                  }
                                >
                                  {PAYMENT_TERM_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </td>
                              <td style={tableBodyCellStyle}>
                                <select
                                  style={compactInputStyle}
                                  title="Invoice Status"
                                  value={normalizeInvoiceStatus(editInvoiceDraft.invoiceStatus, editInvoiceDraft.total, editInvoiceDraft.invoiceNumber)}
                                  onChange={(event) =>
                                    setEditInvoiceDraft((prev) => ({ ...prev, invoiceStatus: event.target.value }))
                                  }
                                >
                                  <option value="budgeted">Budgeted</option>
                                  <option value="final">Final</option>
                                </select>
                              </td>
                              <td style={tableBodyCellStyle}>
                                <input
                                  type="checkbox"
                                  title="Mark as Paid"
                                  checked={editInvoiceDraft.isPaid || false}
                                  onChange={(event) =>
                                    setEditInvoiceDraft((prev) => ({ ...prev, isPaid: event.target.checked }))
                                  }
                                  style={{ width: "18px", height: "18px", cursor: "pointer" }}
                                />
                              </td>
                              <td style={tableBodyCellStyle}>
                                <select
                                  style={{ ...compactInputStyle, minWidth: "120px" }}
                                  title="Billing Source"
                                  value={normalizeBillingSource(editInvoiceDraft.billingSource)}
                                  onChange={(event) => {
                                    const nextSource = normalizeBillingSource(event.target.value);
                                    setEditInvoiceDraft((prev) => ({
                                      ...prev,
                                      billingSource: nextSource,
                                      total: nextSource === "main_system" ? rowLaborCost.totalCost.toFixed(2) : prev.total,
                                    }));
                                  }}
                                >
                                  {BILLING_SOURCE_OPTIONS.map((option) => (
                                    <option key={`edit-billing-source-${invoice.id}-${option.value}`} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td style={tableBodyCellStyle}>
                                <select
                                  style={{ ...compactInputStyle, minWidth: "120px" }}
                                  title="AP Status"
                                  value={normalizeApStatus(editInvoiceDraft.apStatus)}
                                  onChange={(event) =>
                                    setEditInvoiceDraft((prev) => ({ ...prev, apStatus: event.target.value }))
                                  }
                                >
                                  {AP_STATUS_OPTIONS.map((option) => (
                                    <option key={`edit-ap-status-${invoice.id}-${option.value}`} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td style={tableBodyCellStyle}>
                                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                  <button
                                    type="button"
                                    style={{ ...compactButtonStyle, background: "#16A34A" }}
                                    onClick={handleUpdateInvoice}
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    style={{ ...compactButtonStyle, background: "#6B7280" }}
                                    onClick={() => {
                                      setEditingInvoiceId("");
                                      setEditInvoiceDraft({ ...emptyInvoiceDraft });
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        }

                        return (
                          <tr key={invoice.id} style={{ background: rowBg }}>
                            <td style={tableBodyCellStyle}>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                {isMasterInvoice ? (
                                  <span
                                    title="Master invoice"
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      width: "18px",
                                      height: "18px",
                                      borderRadius: "999px",
                                      background: "#DBEAFE",
                                      color: "#1D4ED8",
                                      fontSize: "0.72rem",
                                      fontWeight: 700,
                                      flexShrink: 0,
                                    }}
                                  >
                                    M
                                  </span>
                                ) : null}
                                {weekGapInfo.hasGap ? (
                                  <span
                                    title={`Date gap detected: expected ${formatDisplayDate(weekGapInfo.expectedMondayDate)} based on Week ${Number(invoice.weekNumber) - 1}, but this week starts ${formatDisplayDate(weekGapInfo.actualMondayDate)} (${weekGapInfo.gapDays > 0 ? "+" : ""}${weekGapInfo.gapDays} days off).`}
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      width: "18px",
                                      height: "18px",
                                      borderRadius: "999px",
                                      background: "#FEE2E2",
                                      color: "#B91C1C",
                                      fontSize: "0.72rem",
                                      fontWeight: 700,
                                      flexShrink: 0,
                                    }}
                                  >
                                    !
                                  </span>
                                ) : null}
                                <span>{`#${invoice.weekNumber}`}</span>
                              </div>
                              {weekGapInfo.hasGap ? (
                                <button
                                  type="button"
                                  onClick={() => handleInsertMissingWeek(invoice, weekGapInfo)}
                                  disabled={insertingWeekInvoiceId === invoice.id}
                                  title={`Insert a new Week ${invoice.weekNumber} on ${formatDisplayDate(weekGapInfo.expectedMondayDate)} and renumber this week (and later ones) by +1`}
                                  style={{
                                    marginTop: "4px",
                                    border: "none",
                                    borderRadius: "6px",
                                    padding: "2px 8px",
                                    background: "#B91C1C",
                                    color: "#FFFFFF",
                                    fontSize: "0.7rem",
                                    fontWeight: 700,
                                    cursor: insertingWeekInvoiceId === invoice.id ? "not-allowed" : "pointer",
                                    opacity: insertingWeekInvoiceId === invoice.id ? 0.7 : 1,
                                  }}
                                >
                                  {insertingWeekInvoiceId === invoice.id ? "Inserting..." : "Insert Week Immediately"}
                                </button>
                              ) : null}
                            </td>
                            <td style={tableBodyCellStyle}>
                              {formatDisplayDate(invoice.mondayDate)}
                            </td>
                            <td style={tableBodyCellStyle}>
                              {formatDisplayDate(weekEndDate)}
                            </td>
                            <td style={tableBodyCellStyle}>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                {!invoice.total ? (
                                  <span
                                    title="Invoice amount not entered"
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      width: "18px",
                                      height: "18px",
                                      borderRadius: "999px",
                                      background: "#FEE2E2",
                                      color: "#991B1B",
                                      fontSize: "1rem",
                                      fontWeight: 700,
                                    }}
                                  >
                                    !
                                  </span>
                                ) : null}
                                <span>{formatCurrency(effectiveInvoiceTotal)}</span>
                                {isMissingInvoiceTotal ? (
                                  <span
                                    style={{
                                      display: "inline-block",
                                      marginLeft: "4px",
                                      padding: "2px 6px",
                                      borderRadius: "999px",
                                      background: "#991B1B",
                                      color: "#FFFFFF",
                                      fontSize: "0.72rem",
                                      fontWeight: 700,
                                      letterSpacing: "0.02em",
                                    }}
                                  >
                                    MISSING TOTAL
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td style={tableBodyCellStyle}>
                              <span
                                style={{
                                  display: "inline-block",
                                  padding: "4px 8px",
                                  borderRadius: "999px",
                                  background: "#E0F2FE",
                                  color: "#0C4A6E",
                                  fontSize: "0.8rem",
                                  fontWeight: 700,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {formatHoursUsed(rowHoursData.totalMilliseconds)}
                              </span>
                              <div style={{ marginTop: "4px", fontSize: "0.74rem", color: "#0C4A6E", fontWeight: 700 }}>
                                Cost: {formatCurrency(rowLaborCost.totalCost)}
                              </div>
                            </td>
                            <td style={tableBodyCellStyle}>
                              {(invoice.invoiceNumber || "").toUpperCase() || "-"}
                            </td>
                            {visibleInvoiceTableColumns.dueDate ? (
                              <td style={tableBodyCellStyle}>
                                {formatDisplayDate(invoice.dueDate)}
                              </td>
                            ) : null}
                            {visibleInvoiceTableColumns.dueDay ? (
                              <td style={tableBodyCellStyle}>
                                {formatWeekdayName(invoice.dueDate)}
                              </td>
                            ) : null}
                            {visibleInvoiceTableColumns.countdown ? (
                              <td style={tableBodyCellStyle}>
                                <span
                                  style={{
                                    display: "inline-block",
                                    padding: "4px 8px",
                                    borderRadius: "999px",
                                    background: dueCountdown.bgColor,
                                    color: dueCountdown.textColor,
                                    fontSize: "0.8rem",
                                    fontWeight: 600,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {dueCountdown.label}
                                </span>
                              </td>
                            ) : null}
                            <td style={tableBodyCellStyle}>
                              {getPaymentTermLabel(invoice.paymentTerms, invoice.netDays)}
                            </td>
                            <td style={tableBodyCellStyle}>
                              <select
                                style={{ ...compactInputStyle, minWidth: "110px" }}
                                value={normalizeInvoiceStatus(invoice.invoiceStatus, invoice.total, invoice.invoiceNumber)}
                                onChange={(event) => handleUpdateInvoiceStatus(invoice, event.target.value)}
                              >
                                <option value="budgeted">Budgeted</option>
                                <option value="final">Final</option>
                              </select>
                            </td>
                            <td style={tableBodyCellStyle}>
                              <span
                                style={{
                                  display: "inline-block",
                                  padding: "4px 8px",
                                  borderRadius: "999px",
                                  background: invoice.isPaid ? "#DCFCE7" : "#FEE2E2",
                                  color: invoice.isPaid ? "#166534" : "#991B1B",
                                  fontSize: "0.8rem",
                                  fontWeight: 600,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {invoice.isPaid ? "Paid" : "Not Paid"}
                              </span>
                            </td>
                            <td style={tableBodyCellStyle}>
                              <select
                                style={{ ...compactInputStyle, minWidth: "120px" }}
                                value={normalizeBillingSource(invoice.billingSource)}
                                onChange={(event) => handleUpdateBillingSource(invoice, event.target.value)}
                              >
                                {BILLING_SOURCE_OPTIONS.map((option) => (
                                  <option key={`billing-source-${invoice.id}-${option.value}`} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td style={tableBodyCellStyle}>
                              <select
                                style={{ ...compactInputStyle, minWidth: "120px" }}
                                value={normalizeApStatus(invoice.apStatus)}
                                onChange={(event) => handleUpdateApStatus(invoice, event.target.value)}
                              >
                                {AP_STATUS_OPTIONS.map((option) => (
                                  <option key={`ap-status-${invoice.id}-${option.value}`} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td style={tableBodyCellStyle}>
                              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                <button
                                  type="button"
                                  style={{ ...buttonStyle, background: "#F59E0B" }}
                                  onClick={() => startInvoiceEdit(invoice)}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  style={{ ...buttonStyle, background: "#1D4ED8" }}
                                  onClick={() => handleExportBillableInvoice(invoice, rowHoursData)}
                                  disabled={rowUsersHours.length === 0}
                                  title={rowUsersHours.length === 0 ? "No user hours available" : "View billable invoice"}
                                >
                                  View
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      <tr style={{ background: "#F8FAFC" }}>
                        <td style={{ ...tableBodyCellStyle, padding: "16px" }} colSpan={14}>
                          <div style={{ color: "#0F172A", fontSize: "0.95rem", fontWeight: 800, marginBottom: "10px" }}>Project Totals</div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px" }}>
                            <div style={{ border: "1px solid #BFDBFE", background: "#EFF6FF", padding: "12px" }}>
                              <div style={{ color: "#1E3A8A", fontSize: "0.75rem", fontWeight: 800, textTransform: "uppercase" }}>Invoice Amounts</div>
                              <div style={{ marginTop: "7px", color: "#0F172A", fontSize: "0.86rem" }}>Final: <strong>{formatCurrency(invoiceTableTotals.totalFinalInvoiceAmount)}</strong></div>
                              <div style={{ marginTop: "4px", color: "#0F172A", fontSize: "0.86rem" }}>Budgeted: <strong>{formatCurrency(invoiceTableTotals.totalBudgetedInvoiceAmount)}</strong></div>
                              <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid #BFDBFE", color: "#1D4ED8", fontSize: "0.95rem", fontWeight: 800 }}>Subtotal: {formatCurrency(invoiceTableTotals.subtotalInvoiceAmount)}</div>
                            </div>
                            <div style={{ border: "1px solid #99F6E4", background: "#F0FDFA", padding: "12px" }}>
                              <div style={{ color: "#115E59", fontSize: "0.75rem", fontWeight: 800, textTransform: "uppercase" }}>Hours &amp; Labor</div>
                              <div style={{ marginTop: "7px", color: "#0F172A", fontSize: "1.05rem", fontWeight: 800 }}>{formatHoursUsed(invoiceTableTotals.totalMilliseconds)}</div>
                              <div style={{ marginTop: "4px", color: "#0F172A", fontSize: "0.86rem" }}>Labor Cost: <strong>{formatCurrency(invoiceTableTotals.totalLaborCost)}</strong></div>
                              <div style={{ marginTop: "4px", color: "#0F766E", fontSize: "0.82rem", fontWeight: 700 }}>Overtime: {invoiceTableTotals.totalOvertimeHours.toFixed(2)}h</div>
                            </div>
                            <div style={{ border: "1px solid #E2E8F0", background: "#FFFFFF", padding: "12px" }}>
                              <div style={{ color: "#475569", fontSize: "0.75rem", fontWeight: 800, textTransform: "uppercase" }}>Overtime Policy</div>
                              <div style={{ marginTop: "7px", color: "#334155", fontSize: "0.86rem", lineHeight: 1.4 }}>{OVERTIME_POLICY_LABEL}</div>
                            </div>
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td style={{ ...tableBodyCellStyle, textAlign: "center", padding: "14px" }} colSpan={14}>
                          <button
                            type="button"
                            onClick={handleAddNextWeek}
                            disabled={addingNextWeek || !canManageInvoices}
                            style={{
                              border: "none",
                              borderRadius: "8px",
                              padding: "10px 18px",
                              background: "#16A34A",
                              color: "#FFFFFF",
                              fontWeight: 700,
                              cursor: addingNextWeek || !canManageInvoices ? "not-allowed" : "pointer",
                              opacity: addingNextWeek || !canManageInvoices ? 0.7 : 1,
                            }}
                          >
                            {addingNextWeek ? "Adding..." : "+ Add Next Week"}
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
              </div>
            </>
            )
          ) : activeInvoicesTab === "reconciliation" ? (
            <div style={{ ...tableShellStyle, padding: "12px" }}>
              <div style={{ marginBottom: "10px", color: "#334155", fontSize: "0.9rem" }}>
                Import your Excel file and compare all project invoices by exact Invoice # and Total match.
              </div>

              <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", marginBottom: "12px" }}>
                <div style={{ display: "grid", gap: "6px" }}>
                  <label style={fieldLabelStyle}>Import Excel File</label>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    style={inputStyle}
                    onChange={handleImportInvoiceExcel}
                  />
                  <small style={fieldHintStyle}>
                    Required columns: Invoice # and Total. Optional: Project.
                  </small>
                </div>
                <div style={{ display: "grid", gap: "6px", alignContent: "start" }}>
                  <span style={toolbarMetricStyle}>Projects: {projects.length}</span>
                  <span style={toolbarMetricStyle}>System Rows: {allProjectInvoices.length}</span>
                  <span style={toolbarMetricStyle}>Excel Rows: {excelInvoiceRows.length}</span>
                  <span style={toolbarMetricStyle}>Source: {excelFileName || "No file imported"}</span>
                  <button
                    type="button"
                    onClick={() => runInvoiceReconciliation()}
                    disabled={loadingAllProjectInvoices || excelInvoiceRows.length === 0}
                    style={{
                      ...buttonStyle,
                      background: loadingAllProjectInvoices || excelInvoiceRows.length === 0 ? "#94A3B8" : "#0F766E",
                      width: "fit-content",
                    }}
                  >
                    {loadingAllProjectInvoices ? "Loading System Invoices..." : "Run Comparison"}
                  </button>
                  <button
                    type="button"
                    onClick={() => saveReconciliationReport(reconciliationResult, { source: "manual", showSuccessToast: true })}
                    disabled={!reconciliationResult || savingReconciliationReport}
                    style={{
                      ...buttonStyle,
                      background: !reconciliationResult || savingReconciliationReport ? "#94A3B8" : "#1D4ED8",
                      width: "fit-content",
                    }}
                  >
                    {savingReconciliationReport ? "Saving Report..." : "Save Report to Firebase"}
                  </button>
                  {lastSavedReconciliationAt ? (
                    <small style={{ color: "#475569" }}>
                      Last saved: {new Intl.DateTimeFormat("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      }).format(new Date(lastSavedReconciliationAt))}
                    </small>
                  ) : null}
                </div>
              </div>

              {excelPreviewHeaders.length > 0 ? (
                <div style={{ border: "1px solid #E2E8F0", borderRadius: "10px", padding: "10px", marginBottom: "12px", background: "#F8FAFC" }}>
                  <div style={{ fontWeight: 700, color: "#0F172A", marginBottom: "8px" }}>Preview and Column Mapping</div>
                  <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginBottom: "10px" }}>
                    <div>
                      <label style={fieldLabelStyle}>Invoice # Column</label>
                      <select
                        style={inputStyle}
                        value={excelColumnMap.invoiceNumber}
                        onChange={(event) => setExcelColumnMap((prev) => ({ ...prev, invoiceNumber: event.target.value }))}
                      >
                        <option value="">Select column</option>
                        {excelPreviewHeaders.map((header) => (
                          <option key={`invoice-col-${header}`} value={header}>{header}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={fieldLabelStyle}>Total Column</label>
                      <select
                        style={inputStyle}
                        value={excelColumnMap.total}
                        onChange={(event) => setExcelColumnMap((prev) => ({ ...prev, total: event.target.value }))}
                      >
                        <option value="">Select column</option>
                        {excelPreviewHeaders.map((header) => (
                          <option key={`total-col-${header}`} value={header}>{header}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={fieldLabelStyle}>Project Column (Optional)</label>
                      <select
                        style={inputStyle}
                        value={excelColumnMap.projectName}
                        onChange={(event) => setExcelColumnMap((prev) => ({ ...prev, projectName: event.target.value }))}
                      >
                        <option value="">Not mapped</option>
                        {excelPreviewHeaders.map((header) => (
                          <option key={`project-col-${header}`} value={header}>{header}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleApplyExcelColumnMapping}
                    style={{
                      ...buttonStyle,
                      background: "#2563EB",
                      marginBottom: "10px",
                    }}
                    disabled={!excelColumnMap.invoiceNumber || !excelColumnMap.total}
                  >
                    Import and Compare
                  </button>

                  <div style={{ overflowX: "auto", border: "1px solid #E2E8F0", borderRadius: "8px", background: "#FFFFFF" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          <th style={tableHeaderCellStyle}>Excel Row</th>
                          {excelPreviewHeaders.map((header) => (
                            <th key={`preview-header-${header}`} style={tableHeaderCellStyle}>{header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {excelPreviewRows.map((row, index) => (
                          <tr key={`preview-row-${index}`}>
                            <td style={tableBodyCellStyle}>{row.__rowNumber || "-"}</td>
                            {excelPreviewHeaders.map((header) => (
                              <td key={`preview-cell-${index}-${header}`} style={tableBodyCellStyle}>
                                {header === excelColumnMap.invoiceNumber
                                  ? normalizeInvoiceNumber(row?.[header])
                                  : String(row?.[header] || "")}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <small style={{ ...fieldHintStyle, marginTop: "8px" }}>
                    Showing first {excelPreviewRows.length} row{excelPreviewRows.length === 1 ? "" : "s"} for preview.
                  </small>
                  {excelColumnMap.invoiceNumber ? (
                    <small style={{ ...fieldHintStyle, marginTop: "4px" }}>
                      Invoice # values are normalized to ALL CAPS for import and comparison.
                    </small>
                  ) : null}
                </div>
              ) : null}

              {loadingSavedReconciliationReport ? (
                <div style={{ color: "#64748B", marginBottom: "10px" }}>
                  Loading latest saved reconciliation report...
                </div>
              ) : null}

              {!reconciliationResult ? (
                <div style={{ color: "#64748B" }}>Import a file to begin reconciliation.</div>
              ) : (
                <div style={{ display: "grid", gap: "12px" }}>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <span style={toolbarMetricStyle}>Matched: {reconciliationResult.matchedCount}</span>
                    <span style={toolbarMetricStyle}>Total Mismatches: {reconciliationResult.totalMismatch.length}</span>
                    <span style={toolbarMetricStyle}>Missing in System: {reconciliationResult.missingInSystem.length}</span>
                    <span style={toolbarMetricStyle}>Missing in Excel: {reconciliationResult.missingInExcel.length}</span>
                    <span style={toolbarMetricStyle}>Resolved: {resolvedReconciliationItems.length}</span>
                    <span style={toolbarMetricStyle}>System Duplicates: {duplicateSystemInvoices.length}</span>
                    <span style={toolbarMetricStyle}>Discrepancy Rows: {reconciliationDiscrepancies.length}</span>
                  </div>

                  <div style={{ border: "1px solid #E2E8F0", borderRadius: "10px", overflow: "hidden" }}>
                    <div style={{ padding: "10px", background: "#FEF2F2", color: "#991B1B", fontWeight: 700 }}>
                      Discrepancies To Match Imported Excel
                    </div>
                    {reconciliationDiscrepancies.length === 0 ? (
                      <div style={{ padding: "10px", color: "#166534" }}>No discrepancies found. System matches imported Excel.</div>
                    ) : (
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                          <thead>
                            <tr>
                              <th style={tableHeaderCellStyle}>Type</th>
                              <th style={tableHeaderCellStyle}>Invoice #</th>
                              <th style={tableHeaderCellStyle}>Project</th>
                              <th style={tableHeaderCellStyle}>Week</th>
                              <th style={tableHeaderCellStyle}>System Total</th>
                              <th style={tableHeaderCellStyle}>Expected Excel</th>
                              <th style={tableHeaderCellStyle}>Reason</th>
                            </tr>
                          </thead>
                          <tbody>
                            {reconciliationDiscrepancies.map((row, index) => (
                              <tr key={`discrepancy-${index}-${row.invoiceNumber}-${row.projectName}-${row.weekNumber}`}>
                                <td style={tableBodyCellStyle}>{row.type}</td>
                                <td style={tableBodyCellStyle}>{row.invoiceNumber}</td>
                                <td style={tableBodyCellStyle}>{row.projectName}</td>
                                <td style={tableBodyCellStyle}>{row.weekNumber}</td>
                                <td style={tableBodyCellStyle}>{row.systemTotal}</td>
                                <td style={tableBodyCellStyle}>{row.expectedExcel}</td>
                                <td style={tableBodyCellStyle}>{row.reason}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div style={{ border: "1px solid #E2E8F0", borderRadius: "10px", overflow: "hidden" }}>
                    <div style={{ padding: "10px", background: "#FEF3C7", color: "#92400E", fontWeight: 700 }}>
                      Duplicate Invoice # In System (Invoice Table)
                    </div>
                    {duplicateSystemInvoices.length === 0 ? (
                      <div style={{ padding: "10px", color: "#166534" }}>No duplicate invoice numbers found in system invoices.</div>
                    ) : (
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                          <thead>
                            <tr>
                              <th style={tableHeaderCellStyle}>Invoice #</th>
                              <th style={tableHeaderCellStyle}>Occurrences</th>
                              <th style={tableHeaderCellStyle}>Project</th>
                              <th style={tableHeaderCellStyle}>Week</th>
                              <th style={tableHeaderCellStyle}>Total</th>
                              <th style={tableHeaderCellStyle}>Expected From Excel</th>
                              <th style={tableHeaderCellStyle}>Discrepancy</th>
                              <th style={tableHeaderCellStyle}>Adjust Invoice #</th>
                              <th style={tableHeaderCellStyle}>Adjust Total</th>
                              <th style={tableHeaderCellStyle}>Save</th>
                            </tr>
                          </thead>
                          <tbody>
                            {duplicateSystemInvoices.flatMap((group) =>
                              group.rows.map((row, index) => {
                                const editKey = `${row.projectId || ""}::${row.id || ""}`;
                                const editState = duplicateInvoiceEdits[editKey] || {
                                  invoiceNumber: normalizeInvoiceNumber(row.invoiceNumber),
                                  total: row.total === null || row.total === undefined ? "" : String(row.total),
                                };
                                const isSaving = Boolean(savingDuplicateInvoiceEdits[editKey]);
                                const excelMatches = excelRowsByInvoiceKey.get(normalizeInvoiceFuzzyKey(row.invoiceNumber)) || [];
                                const excelTotals = Array.from(
                                  new Set(
                                    excelMatches
                                      .map((entry) => parseAmountValue(entry?.total))
                                      .filter((value) => value !== null)
                                  )
                                );
                                const hasExactTotalMatch = excelTotals.includes(parseAmountValue(row.total));
                                const discrepancyLabel = excelMatches.length === 0
                                  ? "Not found in imported Excel"
                                  : hasExactTotalMatch
                                    ? "Matches imported"
                                    : "Total differs from imported";
                                const discrepancyColor = excelMatches.length === 0
                                  ? "#991B1B"
                                  : hasExactTotalMatch
                                    ? "#166534"
                                    : "#92400E";
                                const excelRowRefs = excelMatches
                                  .map((entry) => entry.rowNumber)
                                  .filter(Boolean)
                                  .slice(0, 4)
                                  .join(", ");

                                return (
                                  <tr key={`dup-${group.invoiceNumberKey}-${row.projectId || "unknown"}-${row.id || index}`}>
                                    <td style={tableBodyCellStyle}>{index === 0 ? group.invoiceNumber : ""}</td>
                                    <td style={tableBodyCellStyle}>{index === 0 ? group.count : ""}</td>
                                    <td style={tableBodyCellStyle}>{row.projectName || "-"}</td>
                                    <td style={tableBodyCellStyle}>{row.weekNumber || "-"}</td>
                                    <td style={tableBodyCellStyle}>{row.total === null ? "-" : formatCurrency(row.total)}</td>
                                    <td style={tableBodyCellStyle}>
                                      {excelTotals.length === 0
                                        ? "-"
                                        : excelTotals.map((value) => formatCurrency(value)).join(", ")}
                                      {excelRowRefs ? (
                                        <div style={{ color: "#64748B", fontSize: "0.76rem", marginTop: "2px" }}>
                                          Excel rows: {excelRowRefs}
                                        </div>
                                      ) : null}
                                    </td>
                                    <td style={tableBodyCellStyle}>
                                      <span style={{ color: discrepancyColor, fontWeight: 700, fontSize: "0.82rem" }}>
                                        {discrepancyLabel}
                                      </span>
                                    </td>
                                    <td style={tableBodyCellStyle}>
                                      <input
                                        style={{ ...compactInputStyle, minWidth: "150px" }}
                                        value={editState.invoiceNumber}
                                        onChange={(event) => setDuplicateInvoiceEditField(row, "invoiceNumber", event.target.value.toUpperCase())}
                                      />
                                    </td>
                                    <td style={tableBodyCellStyle}>
                                      <input
                                        style={{ ...compactInputStyle, minWidth: "120px" }}
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={editState.total}
                                        onChange={(event) => setDuplicateInvoiceEditField(row, "total", event.target.value)}
                                      />
                                    </td>
                                    <td style={tableBodyCellStyle}>
                                      <button
                                        type="button"
                                        style={{
                                          ...compactButtonStyle,
                                          background: isSaving ? "#94A3B8" : "#1D4ED8",
                                        }}
                                        disabled={isSaving}
                                        onClick={() => handleSaveDuplicateInvoiceRow(row)}
                                      >
                                        {isSaving ? "Saving..." : "Save"}
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div style={{ border: "1px solid #E2E8F0", borderRadius: "10px", overflow: "hidden" }}>
                    <div style={{ padding: "10px", background: "#FEF2F2", color: "#991B1B", fontWeight: 700 }}>Invoice # Present But Total Does Not Match</div>
                    {reconciliationResult.totalMismatch.length === 0 ? (
                      <div style={{ padding: "10px", color: "#166534" }}>No total mismatches found.</div>
                    ) : (
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                          <thead>
                            <tr>
                              <th style={tableHeaderCellStyle}>Invoice #</th>
                              <th style={tableHeaderCellStyle}>Excel Totals</th>
                              <th style={tableHeaderCellStyle}>System Totals</th>
                              <th style={tableHeaderCellStyle}>Projects</th>
                            </tr>
                          </thead>
                          <tbody>
                            {reconciliationResult.totalMismatch.map((row) => (
                              <tr key={`mismatch-${row.invoiceNumber}`}>
                                <td style={tableBodyCellStyle}>{row.invoiceNumber}</td>
                                <td style={tableBodyCellStyle}>{row.excelEntries.map((entry) => entry.total ?? "-").join(", ") || "-"}</td>
                                <td style={tableBodyCellStyle}>{row.appEntries.map((entry) => entry.total ?? "-").join(", ") || "-"}</td>
                                <td style={tableBodyCellStyle}>{Array.from(new Set(row.appEntries.map((entry) => entry.projectName).filter(Boolean))).join(", ") || "-"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div style={{ border: "1px solid #E2E8F0", borderRadius: "10px", overflow: "hidden" }}>
                    <div style={{ padding: "10px", background: "#FFF7ED", color: "#9A3412", fontWeight: 700 }}>Missing in System (Exists in Excel)</div>
                    {reconciliationResult.missingInSystem.length === 0 ? (
                      <div style={{ padding: "10px", color: "#166534" }}>No missing invoice numbers in system.</div>
                    ) : (
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                          <thead>
                            <tr>
                              <th style={tableHeaderCellStyle}>Invoice #</th>
                              <th style={tableHeaderCellStyle}>Excel Total</th>
                              <th style={tableHeaderCellStyle}>Excel Project</th>
                              <th style={tableHeaderCellStyle}>Excel Row</th>
                              <th style={tableHeaderCellStyle}>Assign Project</th>
                              <th style={tableHeaderCellStyle}>Assign Week</th>
                              <th style={tableHeaderCellStyle}>Current Week Data</th>
                              <th style={tableHeaderCellStyle}>Apply</th>
                            </tr>
                          </thead>
                          <tbody>
                            {reconciliationResult.missingInSystem.map((row) => {
                              const assignmentKey = getMissingInSystemAssignmentKey(row);
                              const assignmentState = missingSystemAssignments[assignmentKey] || {};
                              const targetProjectId = String(assignmentState.projectId || selectedProjectId || "");
                              const targetProjectWeeks = availableProjectWeeksByProjectId[targetProjectId] || [];
                              const hasAssignedWeeks = targetProjectWeeks.length > 0;
                              const assignmentMode = String(assignmentState.assignmentMode || (hasAssignedWeeks ? "existing" : "new"));
                              const isCreatingNewWeek = assignmentMode === "new";
                              const targetWeek = String(assignmentState.weekNumber || "");
                              const targetWeekNumber = Number(targetWeek || 0) || 0;
                              const targetWeekStartDate = String(assignmentState.weekStartDate || "");
                              const selectedExistingInvoice = (allProjectInvoices || []).find(
                                (invoice) =>
                                  String(invoice?.projectId || "") === targetProjectId
                                  && Number(invoice?.weekNumber || 0) === targetWeekNumber
                              ) || null;
                              const isSavingAssignment = Boolean(savingMissingSystemAssignments[assignmentKey]);
                              const hasSelectedTarget = Boolean(targetProjectId && targetWeekNumber);
                              const canCreateNewWeek = hasSelectedTarget && isCreatingNewWeek && Boolean(toDateInputValue(targetWeekStartDate));

                              return (
                                <tr key={`missing-system-${row.invoiceNumberKey}-${row.rowNumber}`}>
                                  <td style={tableBodyCellStyle}>{row.invoiceNumber}</td>
                                  <td style={tableBodyCellStyle}>{row.total ?? "-"}</td>
                                  <td style={tableBodyCellStyle}>{row.projectName || "-"}</td>
                                  <td style={tableBodyCellStyle}>{row.rowNumber}</td>
                                  <td style={tableBodyCellStyle}>
                                    <select
                                      style={{ ...compactInputStyle, minWidth: "180px" }}
                                      value={targetProjectId}
                                      onChange={(event) => {
                                        const nextProjectId = event.target.value;
                                        const nextWeeks = availableProjectWeeksByProjectId[nextProjectId] || [];
                                        setMissingSystemAssignmentField(row, "projectId", nextProjectId);
                                        const defaultMode = nextWeeks.length > 0 ? "existing" : "new";
                                        setMissingSystemAssignmentField(row, "assignmentMode", defaultMode);
                                        setMissingSystemAssignmentField(row, "weekNumber", nextWeeks[0] ? String(nextWeeks[0]) : "");
                                        setMissingSystemAssignmentField(row, "weekStartDate", "");
                                      }}
                                    >
                                      <option value="">Select project</option>
                                      {projects.map((project) => (
                                        <option key={`assign-project-${project.id}`} value={project.id}>
                                          {String(project.name || "Untitled Project").trim() || "Untitled Project"}
                                        </option>
                                      ))}
                                    </select>
                                  </td>
                                  <td style={tableBodyCellStyle}>
                                    <div style={{ display: "grid", gap: "6px", minWidth: "190px" }}>
                                      {hasAssignedWeeks ? (
                                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                          <button
                                            type="button"
                                            style={{
                                              ...compactButtonStyle,
                                              height: "30px",
                                              background: !isCreatingNewWeek ? "#1D4ED8" : "#94A3B8",
                                              padding: "4px 8px",
                                            }}
                                            onClick={() => setMissingSystemAssignmentField(row, "assignmentMode", "existing")}
                                            disabled={!targetProjectId}
                                          >
                                            Use Existing
                                          </button>
                                          <button
                                            type="button"
                                            style={{
                                              ...compactButtonStyle,
                                              height: "30px",
                                              background: isCreatingNewWeek ? "#0F766E" : "#94A3B8",
                                              padding: "4px 8px",
                                            }}
                                            onClick={() => {
                                              setMissingSystemAssignmentField(row, "assignmentMode", "new");
                                              setMissingSystemAssignmentField(row, "weekStartDate", targetWeekStartDate || "");
                                            }}
                                            disabled={!targetProjectId}
                                          >
                                            Create New Week
                                          </button>
                                        </div>
                                      ) : null}

                                      {!isCreatingNewWeek ? (
                                        <select
                                          style={{ ...compactInputStyle, minWidth: "120px" }}
                                          value={targetWeek}
                                          onChange={(event) => setMissingSystemAssignmentField(row, "weekNumber", event.target.value)}
                                          disabled={!targetProjectId}
                                        >
                                          <option value="">Select week</option>
                                          {targetProjectWeeks.map((weekNumber) => (
                                            <option key={`assign-week-${assignmentKey}-${weekNumber}`} value={String(weekNumber)}>
                                              Week {weekNumber}
                                            </option>
                                          ))}
                                        </select>
                                      ) : (
                                        <>
                                          <input
                                            style={compactInputStyle}
                                            type="text"
                                            placeholder="New week #"
                                            value={targetWeek}
                                            onChange={(event) => setMissingSystemAssignmentField(row, "weekNumber", event.target.value)}
                                            disabled={!targetProjectId}
                                          />
                                          <input
                                            style={compactInputStyle}
                                            type="date"
                                            value={targetWeekStartDate}
                                            onChange={(event) => setMissingSystemAssignmentField(row, "weekStartDate", event.target.value)}
                                            disabled={!targetProjectId}
                                          />
                                        </>
                                      )}
                                    </div>
                                  </td>
                                  <td style={tableBodyCellStyle}>
                                    {!hasSelectedTarget ? (
                                      <div style={{ color: "#64748B", fontSize: "0.82rem" }}>
                                        Select project and week to preview current values.
                                      </div>
                                    ) : !selectedExistingInvoice && !isCreatingNewWeek ? (
                                      <div style={{ color: "#991B1B", fontSize: "0.82rem", fontWeight: 600 }}>
                                        No current invoice found for this week.
                                      </div>
                                    ) : isCreatingNewWeek ? (
                                      <div style={{ display: "grid", gap: "2px", fontSize: "0.8rem", color: "#334155", minWidth: "260px" }}>
                                        <div style={{ fontWeight: 700, color: "#0F172A" }}>New Week Preview</div>
                                        <div><strong>Project:</strong> {projects.find((project) => project.id === targetProjectId)?.name || "-"}</div>
                                        <div><strong>Week:</strong> {targetWeekNumber ? `Week ${targetWeekNumber}` : "-"}</div>
                                        <div><strong>Start:</strong> {formatDisplayDate(targetWeekStartDate)}</div>
                                        <div><strong>Due (Net 30):</strong> {formatDisplayDate(shiftDateInputValue(targetWeekStartDate, 30))}</div>
                                        <div><strong>Invoice #:</strong> #{normalizeInvoiceNumber(row.invoiceNumber) || "-"}</div>
                                        <div><strong>Total:</strong> {row.total === null ? "-" : formatCurrency(row.total)}</div>
                                      </div>
                                    ) : (
                                      <div style={{ display: "grid", gap: "2px", fontSize: "0.8rem", color: "#334155", minWidth: "260px" }}>
                                        <div style={{ fontWeight: 700, color: "#0F172A" }}>Before</div>
                                        <div><strong>Project:</strong> {selectedExistingInvoice.projectName || "-"}</div>
                                        <div><strong>Week:</strong> {selectedExistingInvoice.weekNumber ? `Week ${selectedExistingInvoice.weekNumber}` : "-"}</div>
                                        <div><strong>Invoice #:</strong> #{selectedExistingInvoice.invoiceNumber || "-"}</div>
                                        <div><strong>Total:</strong> {formatCurrency(selectedExistingInvoice.total || 0)}</div>
                                        <div><strong>Start:</strong> {formatDisplayDate(selectedExistingInvoice.mondayDate)}</div>
                                        <div><strong>Due:</strong> {formatDisplayDate(selectedExistingInvoice.dueDate)}</div>
                                        <div><strong>Terms:</strong> {getPaymentTermLabel(selectedExistingInvoice.paymentTerms, selectedExistingInvoice.netDays)}</div>
                                        <div><strong>Paid:</strong> {selectedExistingInvoice.isPaid ? "Yes" : "No"}</div>
                                        <div style={{ marginTop: "6px", fontWeight: 700, color: "#0F766E" }}>After</div>
                                        <div><strong>Project:</strong> {projects.find((project) => project.id === targetProjectId)?.name || "-"}</div>
                                        <div><strong>Week:</strong> {targetWeekNumber ? `Week ${targetWeekNumber}` : "-"}</div>
                                        <div><strong>Invoice #:</strong> #{normalizeInvoiceNumber(row.invoiceNumber) || "-"}</div>
                                        <div><strong>Total:</strong> {row.total === null ? "-" : formatCurrency(row.total)}</div>
                                      </div>
                                    )}
                                  </td>
                                  <td style={tableBodyCellStyle}>
                                    <button
                                      type="button"
                                      onClick={() => handleApplyMissingInSystemAssignment(row)}
                                      disabled={isSavingAssignment || !hasSelectedTarget || (!selectedExistingInvoice && !canCreateNewWeek)}
                                      style={{
                                        ...compactButtonStyle,
                                        background: isSavingAssignment || !hasSelectedTarget || (!selectedExistingInvoice && !canCreateNewWeek) ? "#94A3B8" : "#0F766E",
                                      }}
                                    >
                                      {isSavingAssignment ? "Applying..." : isCreatingNewWeek ? "Create Week" : "Update"}
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div style={{ border: "1px solid #E2E8F0", borderRadius: "10px", overflow: "hidden" }}>
                    <div style={{ padding: "10px", background: "#EFF6FF", color: "#1E40AF", fontWeight: 700 }}>Missing in Excel (Exists in System)</div>
                    {reconciliationResult.missingInExcel.length === 0 ? (
                      <div style={{ padding: "10px", color: "#166534" }}>No extra system invoice numbers missing from Excel.</div>
                    ) : (
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                          <thead>
                            <tr>
                              <th style={tableHeaderCellStyle}>Invoice #</th>
                              <th style={tableHeaderCellStyle}>System Total</th>
                              <th style={tableHeaderCellStyle}>Project</th>
                              <th style={tableHeaderCellStyle}>Week</th>
                              <th style={tableHeaderCellStyle}>Why Missing</th>
                              <th style={tableHeaderCellStyle}>Comparison</th>
                            </tr>
                          </thead>
                          <tbody>
                            {reconciliationResult.missingInExcel.map((row) => {
                              const diagnostic = getMissingInExcelDiagnostic(row, excelInvoiceRows);
                              return (
                                <tr key={`missing-excel-${row.projectId}-${row.id || row.invoiceNumber}-${row.weekNumber || ""}`}>
                                  <td style={tableBodyCellStyle}>{row.invoiceNumber || "-"}</td>
                                  <td style={tableBodyCellStyle}>{row.total ?? "-"}</td>
                                  <td style={tableBodyCellStyle}>{row.projectName || "-"}</td>
                                  <td style={tableBodyCellStyle}>{row.weekNumber || "-"}</td>
                                  <td style={tableBodyCellStyle}>{diagnostic.reason}</td>
                                  <td style={tableBodyCellStyle}>{diagnostic.details}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div style={{ border: "1px solid #E2E8F0", borderRadius: "10px", overflow: "hidden" }}>
                    <div style={{ padding: "10px", background: "#ECFDF5", color: "#166534", fontWeight: 700 }}>
                      Resolved (No Longer Missing)
                    </div>
                    {resolvedReconciliationItems.length === 0 ? (
                      <div style={{ padding: "10px", color: "#64748B" }}>No resolved items yet.</div>
                    ) : (
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                          <thead>
                            <tr>
                              <th style={tableHeaderCellStyle}>Type</th>
                              <th style={tableHeaderCellStyle}>Invoice #</th>
                              <th style={tableHeaderCellStyle}>Total</th>
                              <th style={tableHeaderCellStyle}>Project</th>
                              <th style={tableHeaderCellStyle}>Week</th>
                              <th style={tableHeaderCellStyle}>Resolved At</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...resolvedReconciliationItems].slice().reverse().map((item) => (
                              <tr key={`resolved-${item.key}`}>
                                <td style={tableBodyCellStyle}>{item.type || "Resolved"}</td>
                                <td style={tableBodyCellStyle}>{item.invoiceNumber || "-"}</td>
                                <td style={tableBodyCellStyle}>{item.total ?? "-"}</td>
                                <td style={tableBodyCellStyle}>{item.projectName || "-"}</td>
                                <td style={tableBodyCellStyle}>{item.weekNumber || "-"}</td>
                                <td style={tableBodyCellStyle}>
                                  {item.resolvedAt
                                    ? new Intl.DateTimeFormat("en-US", {
                                      month: "short",
                                      day: "numeric",
                                      year: "numeric",
                                      hour: "numeric",
                                      minute: "2-digit",
                                    }).format(new Date(item.resolvedAt))
                                    : "-"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : activeInvoicesTab === "hours-audit" ? (
            <div style={{ ...tableShellStyle, padding: "12px" }}>
              <div style={{ color: "#334155", fontSize: "0.9rem", marginBottom: "12px" }}>
                Compare all finalized time by user and TD card. TimeRotate and Pay Everyone use the same finalized logs; Invoice shows only the hours included by this invoice project's TD matches.
              </div>
              {!selectedInvoiceProject ? (
                <p style={{ color: "#64748B", margin: 0 }}>Select an invoice project to run the audit.</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "1080px" }}>
                    <thead>
                      <tr>
                        <th style={tableHeaderCellStyle}>User</th>
                        <th style={tableHeaderCellStyle}>TD Card</th>
                        <th style={tableHeaderCellStyle}>TimeRotate</th>
                        <th style={tableHeaderCellStyle}>Pay Everyone</th>
                        <th style={tableHeaderCellStyle}>Invoice Included</th>
                        <th style={tableHeaderCellStyle}>Invoice Week</th>
                        <th style={tableHeaderCellStyle}>Difference</th>
                        <th style={tableHeaderCellStyle}>Logs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hoursAuditRows.length === 0 ? (
                        <tr><td style={tableBodyCellStyle} colSpan={8}>No finalized TimeRotate hours are available for this audit.</td></tr>
                      ) : hoursAuditRows.map((row) => {
                        const difference = row.timeRotateMilliseconds - row.invoiceMilliseconds;
                        return (
                          <tr key={`${row.userLabel}-${row.tdId}`} style={{ background: difference > 0 ? "#FFFBEB" : "#F0FDF4" }}>
                            <td style={tableBodyCellStyle}>{row.userLabel || "Unknown"}</td>
                            <td style={tableBodyCellStyle}>
                              <div style={{ fontWeight: 700 }}>{row.tdId}</div>
                              {row.tdTitle ? <div style={{ marginTop: "2px", color: "#64748B", fontSize: "0.8rem" }}>{row.tdTitle}</div> : null}
                            </td>
                            <td style={tableBodyCellStyle}>{formatHoursUsed(row.timeRotateMilliseconds)}</td>
                            <td style={tableBodyCellStyle}>{formatHoursUsed(row.payEveryoneMilliseconds)}</td>
                            <td style={{ ...tableBodyCellStyle, fontWeight: 800 }}>{formatHoursUsed(row.invoiceMilliseconds)}</td>
                            <td style={{ ...tableBodyCellStyle, color: row.invoiceWeeks.length > 0 ? "#166534" : "#B45309", fontWeight: 700 }}>
                              {row.invoiceWeeks.length > 0 ? row.invoiceWeeks.join(", ") : "Not caught by an invoice week"}
                            </td>
                            <td style={{ ...tableBodyCellStyle, color: difference > 0 ? "#B45309" : "#166534", fontWeight: 800 }}>
                              {difference > 0 ? `${formatHoursUsed(difference)} excluded` : "Matched"}
                            </td>
                            <td style={tableBodyCellStyle}>{row.logCount}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : activeInvoicesTab === "td-matcher" ? (
            <div style={{ ...tableShellStyle, padding: "12px" }}>
              <div style={{ marginBottom: "10px", color: "#334155", fontSize: "0.9rem" }}>
                Match each Technical Detail's actual TimeRotate project name to its invoice project. This is the source of weekly hours and billing totals.
              </div>
              <div style={{ marginBottom: "12px", padding: "12px", border: "1px solid #BFDBFE", background: "#EFF6FF" }}>
                <div style={{ color: "#1E3A8A", fontWeight: 800, marginBottom: "8px" }}>Hours Audit</div>
                <div style={{ display: "grid", gap: "8px", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                  <div style={{ padding: "8px", background: "#FFFFFF", border: "1px solid #DBEAFE" }}>
                    <div style={{ color: "#475569", fontSize: "0.75rem", fontWeight: 700 }}>TIME ROTATE LOGGED</div>
                    <div style={{ color: "#0F172A", fontSize: "1rem", fontWeight: 800 }}>{formatHoursUsed(tdMatcherHoursAudit.loggedMilliseconds)}</div>
                  </div>
                  <div style={{ padding: "8px", background: "#FFFFFF", border: "1px solid #DBEAFE" }}>
                    <div style={{ color: "#475569", fontSize: "0.75rem", fontWeight: 700 }}>PAY EVERYONE CAPTURED</div>
                    <div style={{ color: "#0F172A", fontSize: "1rem", fontWeight: 800 }}>{formatHoursUsed(tdMatcherHoursAudit.payEveryoneMilliseconds)}</div>
                  </div>
                  <div style={{ padding: "8px", background: "#FFFFFF", border: "1px solid #DBEAFE" }}>
                    <div style={{ color: "#475569", fontSize: "0.75rem", fontWeight: 700 }}>TD MATCHER CAPTURED</div>
                    <div style={{ color: "#0F172A", fontSize: "1rem", fontWeight: 800 }}>{formatHoursUsed(tdMatcherHoursAudit.tdMatcherMilliseconds)}</div>
                  </div>
                  <div style={{ padding: "8px", background: "#FFFFFF", border: "1px solid #DBEAFE" }}>
                    <div style={{ color: "#475569", fontSize: "0.75rem", fontWeight: 700 }}>SELECTED INVOICE PROJECT</div>
                    <div style={{ color: "#0F172A", fontSize: "1rem", fontWeight: 800 }}>{formatHoursUsed(tdMatcherHoursAudit.selectedProjectMilliseconds)}</div>
                    <div style={{ marginTop: "2px", color: "#64748B", fontSize: "0.72rem" }}>{selectedInvoiceProject?.name || "Select an invoice project"}</div>
                  </div>
                </div>
                {tdMatcherHoursAudit.loggedMilliseconds !== tdMatcherHoursAudit.tdMatcherMilliseconds ? (
                  <div style={{ marginTop: "8px", color: "#B91C1C", fontSize: "0.82rem", fontWeight: 700 }}>
                    TD Matcher is missing {formatHoursUsed(tdMatcherHoursAudit.loggedMilliseconds - tdMatcherHoursAudit.tdMatcherMilliseconds)} from finalized TimeRotate logs.
                  </div>
                ) : null}
                {selectedProjectId && tdMatcherHoursAudit.unassignedToSelectedProjectMilliseconds > 0 ? (
                  <div style={{ marginTop: "8px", color: "#B45309", fontSize: "0.82rem", fontWeight: 700 }}>
                    Not assigned to this invoice project: {formatHoursUsed(tdMatcherHoursAudit.unassignedToSelectedProjectMilliseconds)}.
                  </div>
                ) : null}
              </div>
              <input
                type="search"
                value={tdMatcherSearch}
                onChange={(event) => setTdMatcherSearch(event.target.value)}
                placeholder="Search TD ID, title, TimeRotate project, or user"
                style={{ ...inputStyle, maxWidth: "480px", marginBottom: "12px" }}
              />
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "940px" }}>
                  <thead>
                    <tr>
                      <th style={tableHeaderCellStyle}>TD / Issue</th>
                      <th style={tableHeaderCellStyle}>Title</th>
                      <th style={tableHeaderCellStyle}>TimeRotate Project</th>
                      <th style={tableHeaderCellStyle}>Logged Hours</th>
                      <th style={tableHeaderCellStyle}>First Used</th>
                      <th style={tableHeaderCellStyle}>Last Used</th>
                      <th style={tableHeaderCellStyle}>Users</th>
                      <th style={tableHeaderCellStyle}>Invoice Project Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tdMatcherRows.length === 0 ? (
                      <tr><td style={tableBodyCellStyle} colSpan={8}>No TimeRotate Technical Details match this search.</td></tr>
                    ) : tdMatcherRows.map((row) => {
                      const matchedProjectIds = row.matchedProjects.map((project) => project.id);
                      const selectedMatch = matchedProjectIds.length === 1 ? matchedProjectIds[0] : "";
                      return (
                        <tr key={row.identity} style={{ background: row.matchedProjects.length === 1 ? "#F0FDF4" : "#FFFBEB" }}>
                          <td style={tableBodyCellStyle}>{row.issueId || "-"}</td>
                          <td style={tableBodyCellStyle}>{row.title || "-"}</td>
                          <td style={tableBodyCellStyle}>{row.projectName || "Missing project name"}</td>
                          <td style={tableBodyCellStyle}>{formatHoursUsed(row.milliseconds)}</td>
                          <td style={tableBodyCellStyle}>{formatLogTimestamp(row.firstUsedAt)}</td>
                          <td style={tableBodyCellStyle}>{formatLogTimestamp(row.lastUsedAt)}</td>
                          <td style={tableBodyCellStyle}>
                            <div>{row.users.join(", ") || "Unknown"}</div>
                            {row.excludedByExplicitTdMatch ? (
                              <div style={{ marginTop: "4px", color: "#B45309", fontSize: "0.75rem", fontWeight: 700 }}>
                                Logged but excluded: select an invoice project for this TD.
                              </div>
                            ) : null}
                          </td>
                          <td style={tableBodyCellStyle}>
                            <select
                              value={selectedMatch}
                              onChange={(event) => handleMatchTdToInvoiceProject(row.identity, row.projectName, event.target.value)}
                              disabled={!row.projectName || !canManageInvoices}
                              style={{ ...compactInputStyle, minWidth: "220px" }}
                            >
                              <option value="">
                                {row.matchedProjects.length > 1 ? "Multiple matches - choose one" : "Unmatched - choose invoice project"}
                              </option>
                              {projects.map((project) => (
                                <option key={`${row.identity}-${project.id}`} value={project.id}>{project.name}</option>
                              ))}
                            </select>
                            {row.matchedProjects.length > 1 ? (
                              <div style={{ marginTop: "4px", color: "#B45309", fontSize: "0.75rem", fontWeight: 700 }}>
                                Currently matches: {row.matchedProjects.map((project) => project.name).join(", ")}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : activeInvoicesTab === "business-intelligence" ? (
            <div style={{ ...tableShellStyle, padding: "12px" }}>
              <div style={{ marginBottom: "10px", color: "#334155", fontSize: "0.9rem" }}>
                Business Intelligence overview for project, invoice, hours, and billing analytics.
              </div>

              <div style={{ display: "grid", gap: "8px", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginBottom: "12px" }}>
                <span style={toolbarMetricStyle}>Projects: {businessIntelligenceSummary.projectsCount}</span>
                <span style={toolbarMetricStyle}>Invoice Rows: {businessIntelligenceSummary.invoicesCount}</span>
                <span style={toolbarMetricStyle}>Budgeted Rows: {businessIntelligenceSummary.budgetedCount}</span>
                <span style={toolbarMetricStyle}>Final Rows: {businessIntelligenceSummary.finalCount}</span>
                <span style={toolbarMetricStyle}>Paid Rows: {businessIntelligenceSummary.paidCount}</span>
                <span style={toolbarMetricStyle}>Total Hours: {formatHoursUsed(businessIntelligenceSummary.totalHours)}</span>
                <span style={toolbarMetricStyle}>Overtime Hours: {businessIntelligenceSummary.totalOvertimeHours.toFixed(2)}h</span>
                <span style={toolbarMetricStyle}>Revenue Total: {formatCurrency(businessIntelligenceSummary.totalInvoiceAmount)}</span>
                <span style={toolbarMetricStyle}>Total Budgeted: {formatCurrency(businessIntelligenceSummary.totalBudgetedInvoiceAmount)}</span>
                <span style={toolbarMetricStyle}>Subtotal (Final + Budgeted): {formatCurrency(allProjectsSubtotalInvoiceTotal)}</span>
                <span style={toolbarMetricStyle}>Total Due: {formatCurrency(allProjectsDueTotal)}</span>
              </div>

              <div
                style={{
                  display: "grid",
                  gap: "12px",
                  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                  marginBottom: "12px",
                }}
              >
                <div style={{ border: "1px solid #E2E8F0", borderRadius: "10px", padding: "12px", background: "#FFFFFF" }}>
                  <div style={{ fontWeight: 700, color: "#0F172A", marginBottom: "8px" }}>Financial Composition</div>
                  <div style={{ display: "grid", gap: "8px" }}>
                    {businessIntelligenceFinancialCompositionRows.map((row) => (
                      <div key={`bi-financial-${row.key}`}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", marginBottom: "4px", fontSize: "0.82rem", color: "#334155" }}>
                          <span>{row.label}</span>
                          <span>{formatCurrency(row.displayValue ?? row.value)}</span>
                        </div>
                        <div style={{ width: "100%", height: "10px", borderRadius: "999px", background: "#E2E8F0", overflow: "hidden" }}>
                          <div
                            style={{
                              width: `${Math.max(3, Math.min(100, row.widthPercent))}%`,
                              height: "100%",
                              background: row.color,
                              borderRadius: "999px",
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ border: "1px solid #E2E8F0", borderRadius: "10px", padding: "12px", background: "#FFFFFF" }}>
                  <div style={{ fontWeight: 700, color: "#0F172A", marginBottom: "8px" }}>Invoice Status Mix</div>
                  <div style={{ display: "grid", gap: "8px" }}>
                    {businessIntelligenceStatusRows.map((row) => (
                      <div key={`bi-status-${row.key}`}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", marginBottom: "4px", fontSize: "0.82rem", color: "#334155" }}>
                          <span>{row.label} ({row.count}) - {formatCurrency(row.amount || 0)}</span>
                          <span>{formatPercent(row.percent)}</span>
                        </div>
                        <div style={{ width: "100%", height: "10px", borderRadius: "999px", background: "#E2E8F0", overflow: "hidden" }}>
                          <div
                            style={{
                              width: `${Math.max(0, Math.min(100, row.percent))}%`,
                              height: "100%",
                              background: row.color,
                              borderRadius: "999px",
                            }}
                          />
                        </div>
                      </div>
                    ))}

                    <div style={{ borderTop: "1px solid #E2E8F0", marginTop: "4px", paddingTop: "8px" }}>
                      <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#991B1B", marginBottom: "6px" }}>
                        Overdue Breakdown by Project
                      </div>
                      {businessIntelligenceOverdueAnalysis.byProjectRows.length === 0 ? (
                        <div style={{ color: "#64748B", fontSize: "0.8rem" }}>No overdue invoices right now.</div>
                      ) : (
                        <div style={{ display: "grid", gap: "4px" }}>
                          {businessIntelligenceOverdueAnalysis.byProjectRows.map((row) => (
                            <div
                              key={`bi-overdue-project-${row.projectId}`}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                gap: "8px",
                                fontSize: "0.8rem",
                                color: "#334155",
                              }}
                            >
                              <span>{row.projectName} ({row.count})</span>
                              <span style={{ fontWeight: 700, color: "#991B1B" }}>{formatCurrency(row.amount)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div style={{ border: "1px solid #E2E8F0", borderRadius: "10px", padding: "12px", background: "#FFFFFF" }}>
                  <div style={{ fontWeight: 700, color: "#0F172A", marginBottom: "8px" }}>Top Projects by Revenue</div>
                  {businessIntelligenceTopRevenueRows.length === 0 ? (
                    <div style={{ color: "#64748B", fontSize: "0.86rem" }}>No project revenue rows available.</div>
                  ) : (
                    <div style={{ display: "grid", gap: "8px" }}>
                      {businessIntelligenceTopRevenueRows.map((row) => (
                        <div key={`bi-top-revenue-${row.projectId}`}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", marginBottom: "4px", fontSize: "0.82rem", color: "#334155" }}>
                            <span style={{ fontWeight: 600 }}>{row.projectName}</span>
                            <span>{formatCurrency(row.invoiceAmountTotal)}</span>
                          </div>
                          <div style={{ width: "100%", height: "10px", borderRadius: "999px", background: "#E2E8F0", overflow: "hidden" }}>
                            <div
                              style={{
                                width: `${Math.max(3, Math.min(100, row.widthPercent))}%`,
                                height: "100%",
                                background: "#2563EB",
                                borderRadius: "999px",
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ border: "1px solid #E2E8F0", borderRadius: "10px", padding: "12px", background: "#FFFFFF" }}>
                  <div style={{ fontWeight: 700, color: "#0F172A", marginBottom: "8px" }}>All Projects Revenue Share</div>
                  {businessIntelligenceProjectSharePie.rows.length === 0 ? (
                    <div style={{ color: "#64748B", fontSize: "0.86rem" }}>No project revenue available to draw pie chart.</div>
                  ) : (
                    <div style={{ display: "grid", gap: "10px" }}>
                      <div style={{ display: "flex", justifyContent: "center" }}>
                        <div
                          style={{
                            width: "190px",
                            height: "190px",
                            borderRadius: "50%",
                            background: `conic-gradient(${businessIntelligenceProjectSharePie.gradient})`,
                            position: "relative",
                            border: "1px solid #E2E8F0",
                          }}
                        >
                          <div
                            style={{
                              position: "absolute",
                              inset: "30px",
                              borderRadius: "50%",
                              background: "#FFFFFF",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              textAlign: "center",
                              padding: "8px",
                              color: "#0F172A",
                              fontSize: "0.78rem",
                              fontWeight: 700,
                              lineHeight: 1.35,
                            }}
                          >
                            Total<br />{formatCurrency(businessIntelligenceProjectSharePie.totalRevenue)}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "grid", gap: "6px", maxHeight: "210px", overflowY: "auto", paddingRight: "4px" }}>
                        {businessIntelligenceProjectSharePie.rows.map((row) => (
                          <div
                            key={`bi-project-pie-${row.projectId}`}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "12px minmax(0, 1fr) auto",
                              gap: "8px",
                              alignItems: "center",
                              fontSize: "0.8rem",
                              color: "#334155",
                            }}
                          >
                            <span style={{ width: "12px", height: "12px", borderRadius: "3px", background: row.color }} />
                            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {row.projectName} ({formatPercent(row.percent)})
                            </span>
                            <span style={{ fontWeight: 700 }}>{formatCurrency(row.revenue)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ border: "1px solid #E2E8F0", borderRadius: "10px", overflow: "hidden" }}>
                <div style={{ padding: "10px", background: "#EFF6FF", color: "#1E40AF", fontWeight: 700 }}>
                  Project Performance Overview
                </div>
                <div style={{ padding: "10px", borderBottom: "1px solid #E2E8F0", background: "#F8FAFC", color: "#334155", fontSize: "0.84rem", lineHeight: 1.45 }}>
                  How to read this table: Revenue is billed amount and Budgeted Hours Cost is planned cost for budgeted work.
                  Prioritize projects with high budgeted exposure and low paid collection.
                </div>
                {businessIntelligenceProjectRows.length === 0 ? (
                  <div style={{ padding: "10px", color: "#64748B" }}>No project data available for business intelligence yet.</div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          <th style={tableHeaderCellStyle}>Project</th>
                          <th style={tableHeaderCellStyle}>Invoice Rows</th>
                          <th style={tableHeaderCellStyle}>Status Mix</th>
                          <th style={tableHeaderCellStyle}>Revenue</th>
                          <th style={tableHeaderCellStyle}>Budgeted Hours Cost</th>
                          <th style={tableHeaderCellStyle}>Hours</th>
                          <th style={tableHeaderCellStyle}>Variance</th>
                          <th style={tableHeaderCellStyle}>Margin</th>
                        </tr>
                      </thead>
                      <tbody>
                        {businessIntelligenceProjectRows.map((row) => (
                          <tr key={`bi-project-${row.projectId}`}>
                            <td style={tableBodyCellStyle}>{row.projectName}</td>
                            <td style={tableBodyCellStyle}>{row.invoicesCount}</td>
                            <td style={tableBodyCellStyle}>B:{row.budgetedCount} | F:{row.finalCount} | P:{row.paidCount}</td>
                            <td style={tableBodyCellStyle}>{formatCurrency(row.invoiceAmountTotal)}</td>
                            <td style={tableBodyCellStyle}>{formatCurrency(row.budgetedHoursCost)}</td>
                            <td style={tableBodyCellStyle}>{formatHoursUsed(row.totalHoursMilliseconds)}</td>
                            <td style={tableBodyCellStyle}>{formatCurrency(row.variance)}</td>
                            <td style={tableBodyCellStyle}>{formatPercent(row.marginPercent)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div style={{ border: "1px solid #E2E8F0", borderRadius: "10px", padding: "12px", background: "#FFFFFF", marginTop: "12px" }}>
                <div style={{ fontWeight: 700, color: "#0F172A", marginBottom: "8px" }}>Per-Project Totals (All Projects)</div>
                {businessIntelligenceProjectTotalsRows.length === 0 ? (
                  <div style={{ color: "#64748B", fontSize: "0.86rem" }}>No projects available.</div>
                ) : (
                  <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", maxHeight: "420px", overflowY: "auto", paddingRight: "4px" }}>
                    {businessIntelligenceProjectTotalsRows.map((row) => (
                      <div key={`bi-project-totals-${row.projectId}`} style={{ border: "1px solid #E2E8F0", borderRadius: "10px", padding: "10px", background: "#F8FAFC" }}>
                        <div style={{ fontSize: "0.84rem", fontWeight: 700, color: "#0F172A", marginBottom: "6px" }}>{row.projectName}</div>
                        <div style={{ display: "grid", gap: "3px", fontSize: "0.79rem", color: "#334155" }}>
                          <div>Total Final: {formatCurrency(row.totalFinal)}</div>
                          <div>Total Budgeted: {formatCurrency(row.totalBudgeted)}</div>
                          <div style={{ fontWeight: 700, color: "#111827" }}>Subtotal: {formatCurrency(row.subtotal)}</div>
                          <div style={{ color: "#7C2D12", fontWeight: 700 }}>Total Due: {formatCurrency(row.totalDue)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ ...tableShellStyle, padding: "12px" }}>
              <div style={{ marginBottom: "10px", color: "#334155", fontSize: "0.9rem" }}>
                Search across all projects and quickly mark invoices as paid or unpaid.
              </div>

              <div style={{ display: "grid", gap: "10px", marginBottom: "12px" }}>
                <input
                  style={{ ...inputStyle, maxWidth: "520px" }}
                  type="text"
                  placeholder="Search by project, invoice #, week, date, status, paid/unpaid"
                  value={quickPaidSearch}
                  onChange={(event) => setQuickPaidSearch(event.target.value)}
                />

                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <span style={toolbarMetricStyle}>Visible: {quickPaidSummary.visibleCount}</span>
                  <span style={toolbarMetricStyle}>Paid: {quickPaidSummary.paidCount}</span>
                  <span style={toolbarMetricStyle}>Unpaid: {quickPaidSummary.unpaidCount}</span>
                  <span style={toolbarMetricStyle}>Visible Total: {formatCurrency(quickPaidSummary.visibleTotal)}</span>
                </div>
              </div>

              {loadingAllProjectInvoices ? (
                <div style={{ color: "#64748B" }}>Loading invoices across all projects...</div>
              ) : quickPaidFilteredInvoices.length === 0 ? (
                <div style={{ color: "#64748B" }}>No invoices matched your search.</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "980px" }}>
                    <thead>
                      <tr>
                        <th style={tableHeaderCellStyle}>Project</th>
                        <th style={tableHeaderCellStyle}>Week</th>
                        <th style={tableHeaderCellStyle}>Invoice #</th>
                        <th style={tableHeaderCellStyle}>Total</th>
                        <th style={tableHeaderCellStyle}>Monday</th>
                        <th style={tableHeaderCellStyle}>Due Date</th>
                        <th style={tableHeaderCellStyle}>Invoice Status</th>
                        <th style={tableHeaderCellStyle}>Paid</th>
                        <th style={tableHeaderCellStyle}>Quick Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quickPaidFilteredInvoices.map((invoice) => {
                        const invoiceKey = `${invoice.projectId}::${invoice.id}`;
                        const isSaving = Boolean(quickPaidSavingByInvoiceKey[invoiceKey]);
                        const isPaid = Boolean(invoice?.isPaid);
                        const statusLabel = getInvoiceStatusLabel(invoice?.invoiceStatus);

                        return (
                          <tr key={`quick-paid-${invoiceKey}`}>
                            <td style={tableBodyCellStyle}>{invoice.projectName || "-"}</td>
                            <td style={tableBodyCellStyle}>{invoice.weekNumber || "-"}</td>
                            <td style={tableBodyCellStyle}>{invoice.invoiceNumber || "-"}</td>
                            <td style={tableBodyCellStyle}>{formatCurrency(invoice.total || 0)}</td>
                            <td style={tableBodyCellStyle}>{formatDisplayDate(invoice.mondayDate) || "-"}</td>
                            <td style={tableBodyCellStyle}>{formatDisplayDate(invoice.dueDate) || "-"}</td>
                            <td style={tableBodyCellStyle}>{statusLabel}</td>
                            <td style={tableBodyCellStyle}>
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  minWidth: "68px",
                                  padding: "4px 8px",
                                  borderRadius: "999px",
                                  fontSize: "0.78rem",
                                  fontWeight: 700,
                                  background: isPaid ? "#DCFCE7" : "#FEE2E2",
                                  color: isPaid ? "#166534" : "#991B1B",
                                }}
                              >
                                {isPaid ? "Paid" : "Unpaid"}
                              </span>
                            </td>
                            <td style={tableBodyCellStyle}>
                              <button
                                type="button"
                                disabled={isSaving}
                                onClick={() => handleQuickPaidToggle(invoice, !isPaid)}
                                style={{
                                  ...compactButtonStyle,
                                  background: isPaid ? "#B91C1C" : "#059669",
                                  opacity: isSaving ? 0.7 : 1,
                                }}
                              >
                                {isSaving ? "Saving..." : (isPaid ? "Mark Unpaid" : "Mark Paid")}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {invoiceLogModalInvoice ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1200,
            padding: "16px",
          }}
          onClick={() => setInvoiceLogModalInvoice(null)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "900px",
              maxHeight: "80vh",
              overflow: "auto",
              borderRadius: "12px",
              border: "1px solid #E2E8F0",
              background: "#FFFFFF",
              boxShadow: "0 20px 40px rgba(15, 23, 42, 0.2)",
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "12px",
                padding: "12px 14px",
                borderBottom: "1px solid #E2E8F0",
                background: "#F8FAFC",
              }}
            >
              <div>
                <div style={{ fontWeight: 800, color: "#0F172A" }}>
                  Invoice History Log
                </div>
                <div style={{ fontSize: "0.85rem", color: "#475569" }}>
                  Invoice: {(invoiceLogModalInvoice.invoiceNumber || "-").toUpperCase()} | Week {invoiceLogModalInvoice.weekNumber || "-"}
                </div>
              </div>
              <button
                type="button"
                style={{ ...buttonStyle, background: "#475569" }}
                onClick={() => setInvoiceLogModalInvoice(null)}
              >
                Close
              </button>
            </div>

            <div style={{ padding: "12px", display: "grid", gap: "10px" }}>
              {(() => {
                const worklogData = invoiceHoursById[invoiceLogModalInvoice.id] || {
                  totalMilliseconds: 0,
                  totalRegularMilliseconds: 0,
                  totalOvertimeMilliseconds: 0,
                  users: [],
                };
                const worklogUsers = Array.isArray(worklogData.users) ? worklogData.users : [];
                const worklogCost = getLaborCostFromSplit(
                  worklogData.totalRegularMilliseconds,
                  worklogData.totalOvertimeMilliseconds
                );

                return (
                  <div style={{ border: "1px solid #E2E8F0", borderRadius: "10px", overflow: "hidden" }}>
                    <div style={{ padding: "10px", background: "#EFF6FF", color: "#1E40AF", fontWeight: 700 }}>
                      Billed Cards and Notes (Time Rotate)
                    </div>
                    <div style={{ padding: "10px", display: "grid", gap: "8px" }}>
                      <div style={{ color: "#0F172A", fontWeight: 700 }}>
                        Total Hours: {formatHoursUsed(worklogData.totalMilliseconds)} | Total Cost: {formatCurrency(worklogCost.totalCost)}
                      </div>
                      {id ? (
                        <div style={{ fontSize: "0.82rem", color: "#475569" }}>
                          Project Lists & Issues reference: {" "}
                          <Link to={`${routePrefix}/${id}/project-lists-issues`} style={{ color: "#1D4ED8", fontWeight: 700 }}>
                            Board
                          </Link>{" "}
                          |{" "}
                          <Link to={`${routePrefix}/${id}/project-lists-issues?tab=progress`} style={{ color: "#1D4ED8", fontWeight: 700 }}>
                            Progress
                          </Link>
                        </div>
                      ) : null}
                      {worklogUsers.length === 0 ? (
                        <div style={{ color: "#64748B" }}>No billed Time Rotate hours found for this invoice row.</div>
                      ) : (
                        worklogUsers.map((userEntry) => {
                          const userCost = getLaborCostFromSplit(
                            userEntry.regularMilliseconds,
                            userEntry.overtimeMilliseconds
                          );
                          const userCards = Array.isArray(userEntry.cards) ? userEntry.cards : [];
                          const userNotes = Array.isArray(userEntry.notes) ? userEntry.notes : [];

                          return (
                            <div
                              key={`worklog-user-${invoiceLogModalInvoice.id}-${userEntry.name}`}
                              style={{ border: "1px solid #DBEAFE", borderRadius: "8px", padding: "8px", background: "#F8FAFC" }}
                            >
                              <div style={{ fontWeight: 700, color: "#0F172A" }}>
                                {userEntry.name} | {formatHoursUsed(userEntry.milliseconds)} | {formatCurrency(userCost.totalCost)}
                                {userCost.overtimeHours > 0 ? ` (OT ${userCost.overtimeHours.toFixed(2)}h)` : ""}
                              </div>

                              <div style={{ marginTop: "6px", fontSize: "0.82rem", color: "#334155", fontWeight: 700 }}>
                                Cards Billed
                              </div>
                              {userCards.length === 0 ? (
                                <div style={{ fontSize: "0.82rem", color: "#64748B" }}>No cards found.</div>
                              ) : (
                                <div style={{ display: "grid", gap: "2px" }}>
                                  {userCards.map((card) => (
                                    <div key={`worklog-card-${invoiceLogModalInvoice.id}-${userEntry.name}-${card.key || card.label}`} style={{ fontSize: "0.8rem", color: "#334155" }}>
                                      <div>
                                        {card.label}: {formatHoursUsed(card.milliseconds)}
                                      </div>
                                      <div style={{ fontSize: "0.74rem", color: "#64748B" }}>
                                        PLI Project: {card.projectDocId || "-"} | Issue: {card.issueId || "-"}
                                        {card.taskIdentity ? ` | Task: ${card.taskIdentity}` : ""}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              <div style={{ marginTop: "8px", fontSize: "0.82rem", color: "#334155", fontWeight: 700 }}>
                                Notes Left
                              </div>
                              {userNotes.length === 0 ? (
                                <div style={{ fontSize: "0.82rem", color: "#64748B" }}>No notes left.</div>
                              ) : (
                                <div style={{ display: "grid", gap: "8px", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
                                  {Object.entries(
                                    userNotes.reduce((accumulator, note) => {
                                      const projectKey = String(note.projectName || "Unknown Project").trim() || "Unknown Project";
                                      if (!accumulator[projectKey]) {
                                        accumulator[projectKey] = [];
                                      }
                                      accumulator[projectKey].push(note);
                                      return accumulator;
                                    }, {})
                                  )
                                    .sort((left, right) => left[0].localeCompare(right[0]))
                                    .map(([projectName, projectNotes]) => (
                                      <div
                                        key={`worklog-note-project-${invoiceLogModalInvoice.id}-${userEntry.name}-${projectName}`}
                                        style={{
                                          border: "1px solid #E2E8F0",
                                          borderRadius: "8px",
                                          padding: "8px",
                                          background: "#FFFFFF",
                                        }}
                                      >
                                        <div style={{ fontSize: "0.8rem", color: "#0F172A", fontWeight: 700, marginBottom: "6px" }}>
                                          {projectName}
                                        </div>
                                        <div style={{ display: "grid", gap: "6px" }}>
                                          {projectNotes.map((note, index) => (
                                            <div key={`worklog-note-${invoiceLogModalInvoice.id}-${userEntry.name}-${projectName}-${index}`} style={{ fontSize: "0.8rem", color: "#334155" }}>
                                              {note.cardLabel}: {note.text}
                                              <div style={{ fontSize: "0.74rem", color: "#64748B" }}>
                                                PLI Project: {note.projectDocId || "-"} | Issue: {note.issueId || "-"}
                                                {note.taskIdentity ? ` | Task: ${note.taskIdentity}` : ""}
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    ))}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })()}

              {getInvoiceLogEntries(invoiceLogModalInvoice).length === 0 ? (
                <div style={{ color: "#64748B" }}>No history available for this invoice yet.</div>
              ) : (
                getInvoiceLogEntries(invoiceLogModalInvoice).map((entry, index) => {
                  const actorLabel = String(entry?.actorEmail || "").trim() || String(entry?.actorUid || "").trim() || "System";
                  const changesText = entry?.changes && Object.keys(entry.changes).length > 0
                    ? JSON.stringify(entry.changes)
                    : "";

                  return (
                    <div
                      key={`invoice-log-${index}-${entry?.action || "entry"}-${entry?.loggedAt || ""}`}
                      style={{
                        border: "1px solid #E2E8F0",
                        borderRadius: "10px",
                        padding: "10px",
                        background: index % 2 === 0 ? "#FFFFFF" : "#F8FAFC",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                        <strong style={{ color: "#0F172A" }}>{entry?.action || "Updated"}</strong>
                        <span style={{ color: "#475569", fontSize: "0.82rem" }}>{formatLogTimestamp(entry?.loggedAt)}</span>
                      </div>
                      <div style={{ color: "#334155", fontSize: "0.86rem", marginTop: "2px" }}>
                        By: {actorLabel}
                      </div>
                      {entry?.note ? (
                        <div style={{ color: "#1E293B", marginTop: "6px" }}>{entry.note}</div>
                      ) : null}
                      {changesText ? (
                        <pre
                          style={{
                            margin: "8px 0 0",
                            padding: "8px",
                            borderRadius: "8px",
                            background: "#0F172A",
                            color: "#E2E8F0",
                            fontSize: "0.74rem",
                            overflowX: "auto",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                          }}
                        >
                          {changesText}
                        </pre>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default InvoiceManager;
