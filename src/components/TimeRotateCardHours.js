import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../firebase";
import commonStyles from "../pages/commonStyles";
import TimeRotateTopLogo from "./TimeRotateTopLogo";
import { useAuth } from "../contexts/AuthContext";

const normalizeValue = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const normalizeComparable = (value) => normalizeValue(value).toLowerCase();

const normalizeKey = (value) =>
  normalizeValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const findFieldByAliases = (rowData = {}, aliases = []) => {
  const keys = Object.keys(rowData || {});
  const normalizedAliases = aliases.map((alias) => normalizeKey(alias));

  for (const key of keys) {
    if (normalizedAliases.includes(normalizeKey(key))) {
      return key;
    }
  }

  for (const alias of normalizedAliases) {
    const startsWithMatch = keys.find((key) => normalizeKey(key).startsWith(alias));
    if (startsWithMatch) return startsWithMatch;
  }

  for (const alias of normalizedAliases) {
    const includesMatch = keys.find((key) => normalizeKey(key).includes(alias));
    if (includesMatch) return includesMatch;
  }

  return null;
};

const DATA_STAGE_ALIASES = ["data stage", "datastage"];
const ISSUE_ID_ALIASES = ["issue id", "id", "task id", "card id", "row id"];
const TITLE_ALIASES = ["title", "issue title", "task title", "name"];
const PROJECT_NAME_ALIASES = ["project name", "project", "projectname"];

const formatDuration = (milliseconds) => {
  const totalSeconds = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const formatDurationHoursMinutes = (milliseconds) => {
  const totalMinutes = Math.max(0, Math.floor((Number(milliseconds) || 0) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) return `${hours} hr ${minutes} min`;
  if (hours > 0) return `${hours} hr`;
  return `${minutes} min`;
};

const toTimestampMs = (value) => {
  if (value === null || value === undefined) return 0;

  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && numericValue > 0) {
    return numericValue;
  }

  if (typeof value?.toMillis === "function") {
    const millisValue = Number(value.toMillis());
    return Number.isFinite(millisValue) && millisValue > 0 ? millisValue : 0;
  }

  if (typeof value?.seconds === "number") {
    const nanos = typeof value?.nanoseconds === "number" ? value.nanoseconds : 0;
    const secondsValue = (value.seconds * 1000) + Math.floor(nanos / 1000000);
    return Number.isFinite(secondsValue) && secondsValue > 0 ? secondsValue : 0;
  }

  return 0;
};

const parseNotes = (value) => {
  if (!Array.isArray(value)) return [];

  return value
    .map((note) => ({
      text: normalizeValue(note?.text),
      timestamp: toTimestampMs(note?.timestamp),
    }))
    .filter((note) => note.text);
};

const getEntryTimestamp = (entry) => {
  const directTimestamp =
    toTimestampMs(entry?.endedAt) ||
    toTimestampMs(entry?.startedAt) ||
    toTimestampMs(entry?.completionAt);
  if (directTimestamp) return directTimestamp;

  if (!Array.isArray(entry?.notes) || entry.notes.length === 0) return 0;

  return entry.notes.reduce((latest, note) => {
    const noteTimestamp = toTimestampMs(note?.timestamp);
    return noteTimestamp > latest ? noteTimestamp : latest;
  }, 0);
};

const formatTimestamp = (value) => {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
};

const toDatetimeLocalValue = (ms) => {
  if (!ms) return "";
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const parseDatetimeLocalToMs = (value) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const toStartOfDayTimestamp = (dateValue) => {
  const normalizedDate = normalizeValue(dateValue);
  if (!normalizedDate) return Number.NaN;
  return Date.parse(`${normalizedDate}T00:00:00`);
};

const toEndOfDayTimestamp = (dateValue) => {
  const normalizedDate = normalizeValue(dateValue);
  if (!normalizedDate) return Number.NaN;
  return Date.parse(`${normalizedDate}T23:59:59.999`);
};

const formatDateInputValue = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const startOfDay = (value = new Date()) => {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

const addDays = (value, days) => {
  const date = startOfDay(value);
  date.setDate(date.getDate() + days);
  return date;
};

const getDateRangeForPreset = (presetValue) => {
  const today = startOfDay(new Date());

  switch (presetValue) {
    case "today":
      return {
        startDate: formatDateInputValue(today),
        endDate: formatDateInputValue(today),
      };
    case "yesterday": {
      const yesterday = addDays(today, -1);
      return {
        startDate: formatDateInputValue(yesterday),
        endDate: formatDateInputValue(yesterday),
      };
    }
    case "thisWeek": {
      const weekStart = addDays(today, -today.getDay());
      return {
        startDate: formatDateInputValue(weekStart),
        endDate: formatDateInputValue(today),
      };
    }
    case "last7Days": {
      const rangeStart = addDays(today, -6);
      return {
        startDate: formatDateInputValue(rangeStart),
        endDate: formatDateInputValue(today),
      };
    }
    case "thisMonth": {
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      return {
        startDate: formatDateInputValue(monthStart),
        endDate: formatDateInputValue(today),
      };
    }
    case "lastMonth": {
      const previousMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const previousMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
      return {
        startDate: formatDateInputValue(previousMonthStart),
        endDate: formatDateInputValue(previousMonthEnd),
      };
    }
    case "allTime":
    case "custom":
    default:
      return {
        startDate: "",
        endDate: "",
      };
  }
};

const DATE_RANGE_PRESET_OPTIONS = [
  { value: "allTime", label: "All Time" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "thisWeek", label: "This Week" },
  { value: "last7Days", label: "Last 7 Days" },
  { value: "thisMonth", label: "This Month" },
  { value: "lastMonth", label: "Last Month" },
  { value: "custom", label: "Custom" },
];

const hasTechnicalDetailTitle = (title) =>
  normalizeValue(title).toLowerCase().includes("technical detail");

const AI_REVIEW_MODEL = "gemini-flash-latest";
const FIREBASE_FUNCTIONS_BASE_URL =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "/firebase-api"
    : "https://us-central1-igletechv1.cloudfunctions.net";
const REPORTING_PROGRESS_STORAGE_PREFIX = "timeRotateReportingProgress";
const MAX_PROGRESS_SNAPSHOTS_PER_USER = 30;

const truncateText = (value, maxLength = 220) => {
  const normalized = normalizeValue(value);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
};

const clamp = (value, min = 0, max = 100) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return min;
  return Math.min(max, Math.max(min, numericValue));
};

const average = (values = []) => {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const total = values.reduce((sum, value) => sum + (Number(value) || 0), 0);
  return total / values.length;
};

const standardDeviation = (values = []) => {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const mean = average(values);
  const variance = average(values.map((value) => {
    const delta = (Number(value) || 0) - mean;
    return delta * delta;
  }));
  return Math.sqrt(variance);
};

const formatPercent = (value) => `${clamp(value).toFixed(1)}%`;

const getLocalDayKey = (timestampMs) => {
  const date = new Date(Number(timestampMs) || 0);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const ELECTRICAL_QUANTITY_PATTERNS = {
  conduits: [
    /(\d+(?:\.\d+)?)\s*(?:x\s*)?(?:conduit|conduits|run|runs)\b/g,
    /(?:conduit|conduits)\s*[:=-]?\s*(\d+(?:\.\d+)?)/g,
  ],
  racks: [
    /(\d+(?:\.\d+)?)\s*(?:x\s*)?(?:rack|racks|tray|trays|ladder\s*rack|cable\s*tray)\b/g,
    /(?:rack|racks|tray|trays)\s*[:=-]?\s*(\d+(?:\.\d+)?)/g,
  ],
  supports: [
    /(\d+(?:\.\d+)?)\s*(?:x\s*)?(?:support|supports|hanger|hangers|brace|braces)\b/g,
    /(?:support|supports|hanger|hangers|brace|braces)\s*[:=-]?\s*(\d+(?:\.\d+)?)/g,
  ],
  adjustments: [
    /(\d+(?:\.\d+)?)\s*(?:x\s*)?(?:adjustment|adjustments|revision|revisions|rework|changes?)\b/g,
    /(?:adjustment|adjustments|revision|revisions|rework|changes?)\s*[:=-]?\s*(\d+(?:\.\d+)?)/g,
  ],
};

const parseElectricalQuantitiesFromText = (textValue) => {
  const normalizedText = normalizeValue(textValue).toLowerCase();
  const totals = {
    conduits: 0,
    racks: 0,
    supports: 0,
    adjustments: 0,
  };

  if (!normalizedText) {
    return {
      ...totals,
      totalObjects: 0,
    };
  }

  Object.entries(ELECTRICAL_QUANTITY_PATTERNS).forEach(([metric, regexPatterns]) => {
    regexPatterns.forEach((pattern) => {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match = regex.exec(normalizedText);

      while (match) {
        totals[metric] += Number(match[1]) || 0;
        match = regex.exec(normalizedText);
      }
    });
  });

  if (totals.adjustments === 0) {
    const adjustmentMentions = normalizedText.match(/\b(adjustment|adjustments|revision|revisions|rework|change|changes)\b/g);
    if (Array.isArray(adjustmentMentions)) {
      totals.adjustments += adjustmentMentions.length;
    }
  }

  const totalObjects = totals.conduits + totals.racks + totals.supports + totals.adjustments;
  return {
    ...totals,
    totalObjects,
  };
};

const mergeElectricalTotals = (baseTotals, deltaTotals) => {
  const safeBase = baseTotals || {};
  const safeDelta = deltaTotals || {};
  return {
    conduits: (Number(safeBase.conduits) || 0) + (Number(safeDelta.conduits) || 0),
    racks: (Number(safeBase.racks) || 0) + (Number(safeDelta.racks) || 0),
    supports: (Number(safeBase.supports) || 0) + (Number(safeDelta.supports) || 0),
    adjustments: (Number(safeBase.adjustments) || 0) + (Number(safeDelta.adjustments) || 0),
    totalObjects: (Number(safeBase.totalObjects) || 0) + (Number(safeDelta.totalObjects) || 0),
  };
};

const buildElectricalQualificationLabel = ({ productivityUnitsPerHour, totalObjects, totalDurationMs }) => {
  const productivity = Number(productivityUnitsPerHour) || 0;
  const objects = Number(totalObjects) || 0;
  const hours = (Number(totalDurationMs) || 0) / (60 * 60 * 1000);

  if (hours < 2 && objects < 10) return "Insufficient evidence";
  if (productivity >= 12 && objects >= 40) return "High preconstruction readiness";
  if (productivity >= 7 && objects >= 20) return "Ready with minor coaching";
  if (productivity >= 3 && objects >= 10) return "Developing - monitor closely";
  return "Needs immediate coaching";
};

const buildEmployeeReportingReviewPrompt = ({
  organizationId,
  filterSummary,
  dateRange,
  totalEntries,
  totalDuration,
  employees,
}) => {
  return [
    "You are a workforce analytics AI evaluating how well employees report their work in TimeRotate.",
    "Use the provided machine-learning style features to assess reporting quality per employee.",
    "Write in clear business English with concise sections and bullet points.",
    "Do not include markdown tables.",
    "",
    "Report requirements:",
    "1) Start with a 3-5 bullet executive summary focused on reporting quality.",
    "2) Add an 'Employee Scorecard' section where each employee includes:\n   - Reporting Quality Score (0-100)\n   - Confidence level (High/Medium/Low)\n   - What they are doing well\n   - Gaps or risk patterns\n   - One coaching recommendation",
    "3) Add an 'Electrical Preconstruction Qualification' section (electrical BIM manager perspective) that qualifies each employee based on productivity and total conduits, racks, supports, and adjustments.",
    "4) Add a short 'Potential Data Integrity Risks' section for suspicious patterns (duplicate notes, low note coverage, inconsistent sessions).",
    "5) Add a short 'Manager Actions (Next 2 Weeks)' section with practical steps.",
    "6) Be factual and only use provided data. If evidence is weak, state assumptions clearly.",
    "",
    `Organization ID: ${organizationId}`,
    `Applied filters: ${filterSummary}`,
    `Date range: ${dateRange}`,
    `Filtered entries: ${totalEntries}`,
    `Filtered total time: ${totalDuration}`,
    "",
    "Employee feature dataset:",
    JSON.stringify(employees, null, 2),
  ].join("\n");
};

const buildProgressStorageKey = (organizationId) => {
  const normalizedOrgId = normalizeValue(organizationId) || "unknown-org";
  return `${REPORTING_PROGRESS_STORAGE_PREFIX}:${normalizedOrgId}`;
};

const readProgressSnapshotStore = (organizationId) => {
  if (typeof window === "undefined") return {};

  try {
    const rawValue = window.localStorage.getItem(buildProgressStorageKey(organizationId));
    if (!rawValue) return {};

    const parsedValue = JSON.parse(rawValue);
    if (!parsedValue || typeof parsedValue !== "object" || Array.isArray(parsedValue)) {
      return {};
    }

    return parsedValue;
  } catch (storageError) {
    return {};
  }
};

const writeProgressSnapshotStore = (organizationId, storeValue) => {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(buildProgressStorageKey(organizationId), JSON.stringify(storeValue || {}));
  } catch (storageError) {
    // Ignore storage quota and serialization failures.
  }
};

const createEmployeeProgressSnapshot = (employeeInsight = {}) => {
  return {
    generatedAt: Date.now(),
    qualityScore: Number(employeeInsight.qualityScore) || 0,
    noteCoveragePct: parsePercentToNumber(employeeInsight.noteCoveragePct),
    detailedNotePct: parsePercentToNumber(employeeInsight.detailedNotePct),
    duplicateNotePct: parsePercentToNumber(employeeInsight.duplicateNotePct),
    consistencyScore: Number(employeeInsight.consistencyScore) || 0,
    totalEntries: Number(employeeInsight.totalEntries) || 0,
  };
};

const buildReportingCoachChatPrompt = ({
  organizationId,
  filterSummary,
  dateRange,
  question,
  aiReviewText,
  selectedEmployee,
  progressContext,
  previousMessages,
}) => {
  return [
    "You are an employee reporting coach for TimeRotate card-hour reporting.",
    "Respond as a practical coach with specific, measurable advice.",
    "Keep your response concise and actionable using plain text bullets.",
    "Use the generated report and progress history to personalize recommendations.",
    "If progress regressed, point it out and explain why.",
    "If progress improved, reinforce what worked and define next milestones.",
    "",
    `Organization ID: ${organizationId}`,
    `Applied filters: ${filterSummary}`,
    `Date range: ${dateRange}`,
    `Selected employee: ${selectedEmployee?.userLabel || "Unknown"}`,
    `Current quality score: ${Number(selectedEmployee?.qualityScore || 0)}`,
    "",
    "Current AI reporting quality review:",
    aiReviewText,
    "",
    "Progress context:",
    JSON.stringify(progressContext || {}, null, 2),
    "",
    "Recent coach chat history:",
    JSON.stringify(previousMessages || [], null, 2),
    "",
    `User question: ${normalizeValue(question)}`,
    "",
    "Return format:",
    "- Start with 2 short bullets: key diagnosis and progress trend.",
    "- Then provide a 7-day improvement plan with 3 to 5 steps.",
    "- End with 2 example high-quality notes tailored to the employee's gaps.",
  ].join("\n");
};

const parsePercentToNumber = (value) => {
  if (typeof value === "number") return clamp(value);
  const parsed = Number.parseFloat(String(value || "").replace(/[^0-9.]+/g, ""));
  return Number.isFinite(parsed) ? clamp(parsed) : 0;
};

const escapeRegExp = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const hasKeyword = (text, keywordList) => {
  const normalized = normalizeValue(text).toLowerCase();
  if (!normalized) return false;
  const pattern = new RegExp(`\\b(${keywordList.map((keyword) => escapeRegExp(keyword.toLowerCase())).join("|")})\\b`, "i");
  return pattern.test(normalized);
};

const buildNoteCoachFeedback = (draftNote, employeeInsight) => {
  const noteText = normalizeValue(draftNote);
  const noteLength = noteText.length;

  if (!noteText) {
    return {
      noteQualityScore: 0,
      projectedEmployeeScore: Number(employeeInsight?.qualityScore || 0),
      featureChecks: [],
      missingElements: ["Add a draft note to run coaching feedback."],
      coachingAdvice: [],
      bestScoreTemplate: "",
    };
  }

  const sentenceCount = noteText
    .split(/[.!?]+/g)
    .map((part) => part.trim())
    .filter(Boolean).length;

  const electricalStats = parseElectricalQuantitiesFromText(noteText);
  const hasNumericEvidence = /\b\d+(?:\.\d+)?\b/.test(noteText);
  const hasElectricalMetrics = Number(electricalStats.totalObjects || 0) > 0;
  const hasActionVerb = hasKeyword(noteText, [
    "installed", "updated", "completed", "modeled", "resolved", "coordinated", "reviewed", "verified",
    "created", "submitted", "checked", "routed", "documented", "finalized", "tested",
  ]);
  const hasOutcome = hasKeyword(noteText, [
    "passed", "approved", "ready", "closed", "fixed", "validated", "delivered", "released", "cleared",
  ]);
  const hasBlocker = hasKeyword(noteText, [
    "blocked", "waiting", "delay", "issue", "risk", "dependency", "stuck", "hold",
  ]);
  const hasNextStep = hasKeyword(noteText, [
    "next", "tomorrow", "follow up", "will", "plan", "pending", "continue", "schedule",
  ]);
  const hasLocation = hasKeyword(noteText, [
    "area", "zone", "floor", "room", "section", "panel", "level", "building", "east", "west", "north", "south",
  ]);
  const hasTimeContext = /(\b\d{1,2}:\d{2}\s?(am|pm)?\b|\btoday\b|\byesterday\b|\bshift\b|\bhrs?\b|\bminutes?\b)/i.test(noteText);

  const lengthScore = clamp((noteLength / 180) * 100);
  const structureScore = clamp((sentenceCount / 3) * 100);
  const evidenceScore = hasNumericEvidence ? 100 : 20;
  const electricalScore = hasElectricalMetrics ? 100 : 20;
  const actionScore = hasActionVerb ? 100 : 20;
  const outcomeScore = hasOutcome ? 100 : 30;
  const nextStepScore = hasNextStep ? 100 : 30;
  const locationScore = hasLocation ? 100 : 35;
  const timeScore = hasTimeContext ? 100 : 35;

  const rawQualityScore =
    (lengthScore * 0.2) +
    (structureScore * 0.12) +
    (evidenceScore * 0.13) +
    (electricalScore * 0.1) +
    (actionScore * 0.14) +
    (outcomeScore * 0.11) +
    (nextStepScore * 0.08) +
    (locationScore * 0.06) +
    (timeScore * 0.06);

  const noteQualityScore = Number(clamp(noteLength < 35 ? rawQualityScore - 15 : rawQualityScore).toFixed(1));
  const baselineEmployeeScore = Number(employeeInsight?.qualityScore || 0);
  const projectedEmployeeScore = Number(clamp((baselineEmployeeScore * 0.82) + (noteQualityScore * 0.18)).toFixed(1));

  const featureChecks = [
    { label: "Specific actions", passed: hasActionVerb },
    { label: "Measurable quantities", passed: hasNumericEvidence },
    { label: "Electrical objects (conduits/racks/supports/adjustments)", passed: hasElectricalMetrics },
    { label: "Outcome/result", passed: hasOutcome },
    { label: "Location/context", passed: hasLocation },
    { label: "Time context", passed: hasTimeContext },
    { label: "Next step", passed: hasNextStep },
    { label: "Blocker or risk status", passed: hasBlocker },
  ];

  const missingElements = [];
  if (noteLength < 80) missingElements.push("Expand detail: target at least 80 to 180 characters.");
  if (!hasActionVerb) missingElements.push("Describe exactly what action was performed.");
  if (!hasNumericEvidence) missingElements.push("Add at least one measurable number (counts, lengths, or quantities).");
  if (!hasOutcome) missingElements.push("State the result or completion status.");
  if (!hasLocation) missingElements.push("Add location context (zone, floor, section, panel, or room).");
  if (!hasNextStep) missingElements.push("Add next step or owner follow-up.");
  if (!hasTimeContext) missingElements.push("Add timing context (shift, timestamp, or time spent).");

  const coachingAdvice = [
    `Score target: aim for 85+ note quality. Current estimate: ${noteQualityScore}.`,
    `Include one quantified progress line like \"installed 8 conduits and 4 supports\" when applicable.`,
    "Use an action -> result -> next step structure in 2 to 4 short sentences.",
  ];

  if (employeeInsight) {
    const noteCoverage = parsePercentToNumber(employeeInsight.noteCoveragePct);
    const detailedRate = parsePercentToNumber(employeeInsight.detailedNotePct);
    const duplicateRate = parsePercentToNumber(employeeInsight.duplicateNotePct);

    if (noteCoverage < 70) {
      coachingAdvice.push("Add notes on every time entry to increase note coverage consistency.");
    }
    if (detailedRate < 55) {
      coachingAdvice.push("Increase detail depth with measurable evidence and outcome wording.");
    }
    if (duplicateRate > 25) {
      coachingAdvice.push("Avoid copy-paste note patterns; personalize each note with card-specific details.");
    }
  }

  const bestScoreTemplate = [
    "Action: [what was done] on [card/area/location].",
    "Evidence: [quantity] conduits, [quantity] racks, [quantity] supports, [quantity] adjustments.",
    "Result: [status/outcome/quality check].",
    "Next: [next step + owner + ETA].",
  ].join(" ");

  return {
    noteQualityScore,
    projectedEmployeeScore,
    featureChecks,
    missingElements,
    coachingAdvice,
    bestScoreTemplate,
  };
};

const tabStyle = (active) => ({
  textDecoration: "none",
  borderRadius: "8px",
  padding: "8px 12px",
  fontWeight: 700,
  fontSize: "0.9rem",
  border: active ? "1px solid #2563EB" : "1px solid #CBD5E1",
  color: active ? "#1D4ED8" : "#334155",
  backgroundColor: active ? "#EFF6FF" : "#FFFFFF",
});

const TimeRotateCardHours = () => {
  const { id } = useParams();
  const { user, isGlobalAdmin, isAdmin } = useAuth();
  const [productionCards, setProductionCards] = useState([]);
  const [timeLog, setTimeLog] = useState([]);
  const [activeTimers, setActiveTimers] = useState([]);
  const [organizationUsers, setOrganizationUsers] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [selectedCard, setSelectedCard] = useState("");
  const [selectedUser, setSelectedUser] = useState("");
  const [hasInitializedSelectedUser, setHasInitializedSelectedUser] = useState(false);
  const [userSearchText, setUserSearchText] = useState("");
  const [selectedProject, setSelectedProject] = useState("");
  const [dateRangePreset, setDateRangePreset] = useState("today");
  const [startDate, setStartDate] = useState(() => formatDateInputValue(startOfDay(new Date())));
  const [endDate, setEndDate] = useState(() => formatDateInputValue(startOfDay(new Date())));
  const [isAiReviewLoading, setIsAiReviewLoading] = useState(false);
  const [aiReviewError, setAiReviewError] = useState("");
  const [aiReviewText, setAiReviewText] = useState("");
  const [copiedReport, setCopiedReport] = useState(false);
  const [reportingCoachQuestion, setReportingCoachQuestion] = useState("");
  const [reportingCoachMessages, setReportingCoachMessages] = useState([]);
  const [isReportingCoachLoading, setIsReportingCoachLoading] = useState(false);
  const [reportingCoachError, setReportingCoachError] = useState("");
  const [progressSnapshotsByUser, setProgressSnapshotsByUser] = useState({});
  const [coachSelectedUserKey, setCoachSelectedUserKey] = useState("");
  const [coachDraftNote, setCoachDraftNote] = useState("");
  const [editingRowKey, setEditingRowKey] = useState(null);
  const [editStartMs, setEditStartMs] = useState(0);
  const [editEndMs, setEditEndMs] = useState(0);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [addingRowKey, setAddingRowKey] = useState(null);
  const [addStartMs, setAddStartMs] = useState(0);
  const [addEndMs, setAddEndMs] = useState(0);
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState("");
  const [deleteRowKey, setDeleteRowKey] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const [highlightedEntryKey, setHighlightedEntryKey] = useState("");
  const [editingEntryKey, setEditingEntryKey] = useState("");
  const [editingEntryStartMs, setEditingEntryStartMs] = useState(0);
  const [editingEntryEndMs, setEditingEntryEndMs] = useState(0);
  const [editingEntrySaving, setEditingEntrySaving] = useState(false);
  const [editingEntryError, setEditingEntryError] = useState("");

  const routePrefix =
    typeof window !== "undefined" && window.location?.pathname?.includes("/church/")
      ? "/church"
      : "/organization";

  useEffect(() => {
    if (!id) {
      setProgressSnapshotsByUser({});
      return;
    }

    setProgressSnapshotsByUser(readProgressSnapshotStore(id));
  }, [id]);

  useEffect(() => {
    if (!id) return () => {};

    const usersQuery = query(collection(db, "users"), where("churchId", "==", id));
    const unsubscribe = onSnapshot(usersQuery, (snapshot) => {
      const nextUsers = snapshot.docs
        .map((snapshotDoc) => {
          const data = snapshotDoc.data() || {};
          const firstName = normalizeValue(data.firstName || data.name);
          const lastName = normalizeValue(data.lastName);
          const fullName = normalizeValue([firstName, lastName].filter(Boolean).join(" "));
          const displayName = normalizeValue(data.displayName);
          const email = normalizeValue(data.email);
          const label = fullName || displayName || email || `User ${snapshotDoc.id}`;

          return {
            userId: snapshotDoc.id,
            label,
            email,
            aliases: Array.from(
              new Set([
                snapshotDoc.id,
                fullName,
                displayName,
                email,
                normalizeValue(data.name),
              ].filter(Boolean))
            ),
          };
        })
        .sort((left, right) => left.label.localeCompare(right.label));

      setOrganizationUsers(nextUsers);
    });

    return () => unsubscribe();
  }, [id]);

  useEffect(() => {
    if (!id) return () => {};

    const unsubscribe = onSnapshot(collection(db, "churches", id, "timeRotateActiveTimers"), (snapshot) => {
      const nextActiveTimers = snapshot.docs
        .map((snapshotDoc) => {
          const data = snapshotDoc.data() || {};
          return {
            id: snapshotDoc.id,
            logType: "active",
            issueId: normalizeValue(data.issueId),
            projectName: normalizeValue(data.projectName),
            registeredBy: normalizeValue(data.registeredBy),
            userId: normalizeValue(data.userId),
            userEmail: normalizeValue(data.userEmail),
            startedAt: toTimestampMs(data.startedAt),
            endedAt: 0,
            completionAt: 0,
            durationMs: Math.max(0, Date.now() - toTimestampMs(data.startedAt)),
            notes: parseNotes(data.notes),
          };
        })
        .filter((entry) => entry.startedAt > 0);

      setActiveTimers(nextActiveTimers);
    });

    return () => unsubscribe();
  }, [id]);

  useEffect(() => {
    if (!id) return () => {};

    const unsubscribe = onSnapshot(collection(db, "churches", id, "timeRotateLogs"), (snapshot) => {
      const nextLogs = snapshot.docs.map((snapshotDoc) => {
        const data = snapshotDoc.data() || {};
        return {
          id: snapshotDoc.id,
          logType: normalizeValue(data.logType) || "timer",
          issueId: normalizeValue(data.issueId),
          projectName: normalizeValue(data.projectName),
          registeredBy: normalizeValue(data.registeredBy),
          userId: normalizeValue(data.userId),
          userEmail: normalizeValue(data.userEmail),
          startedAt: toTimestampMs(data.startedAt),
          endedAt: toTimestampMs(data.endedAt),
          completionAt: toTimestampMs(data.completionAt),
          durationMs: Number(data.durationMs) || 0,
          notes: parseNotes(data.notes),
        };
      });

      setTimeLog(nextLogs);
    });

    return () => unsubscribe();
  }, [id]);

  useEffect(() => {
    if (!id) return () => {};

    const unsubscribe = onSnapshot(collection(db, "churches", id, "bimProjects"), (snapshot) => {
      const nextCards = [];

      snapshot.forEach((projectDoc) => {
        const projectData = projectDoc.data() || {};
        const rows = Array.isArray(projectData.rows) ? projectData.rows : [];

        rows.forEach((row, rowIndex) => {
          const rowData = row?.rowData || {};
          const dataStageField = findFieldByAliases(rowData, DATA_STAGE_ALIASES) || "Data Stage";
          const dataStage = normalizeValue(rowData[dataStageField]);
          if (normalizeValue(dataStage).toLowerCase() !== "production") {
            return;
          }

          const issueIdField = findFieldByAliases(rowData, ISSUE_ID_ALIASES);
          const titleField = findFieldByAliases(rowData, TITLE_ALIASES);
          const projectNameField = findFieldByAliases(rowData, PROJECT_NAME_ALIASES);

          const issueId =
            normalizeValue(issueIdField ? rowData[issueIdField] : "") ||
            String(row?.rowNumber || rowIndex + 1);
          const title = normalizeValue(titleField ? rowData[titleField] : "");
          const projectName = normalizeValue(projectNameField ? rowData[projectNameField] : "");

          nextCards.push({
            issueId,
            title,
            projectName,
          });
        });
      });

      const dedupedByIssueId = [];
      const seen = new Set();
      nextCards.forEach((card) => {
        const issueKey = normalizeValue(card.issueId);
        if (!issueKey || seen.has(issueKey)) return;
        seen.add(issueKey);
        dedupedByIssueId.push(card);
      });

      setProductionCards(dedupedByIssueId.sort((left, right) => left.issueId.localeCompare(right.issueId)));
    });

    return () => unsubscribe();
  }, [id]);

  const getOrganizationUserMatch = (entry) => {
    const entryUserId = normalizeComparable(entry?.userId);
    const byUserId = organizationUsers.find((userEntry) => normalizeComparable(userEntry.userId) === entryUserId);
    if (byUserId) return byUserId;

    const entryEmail = normalizeComparable(entry?.userEmail);
    const byEmail = organizationUsers.find((userEntry) => normalizeComparable(userEntry.email) && normalizeComparable(userEntry.email) === entryEmail);
    if (byEmail) return byEmail;

    const registeredBy = normalizeComparable(entry?.registeredBy);
    if (!registeredBy) return null;

    return (
      organizationUsers.find((userEntry) =>
        Array.isArray(userEntry.aliases)
          ? userEntry.aliases.some((alias) => normalizeComparable(alias) === registeredBy)
          : false
      ) || null
    );
  };

  const productionCardMapByIssueId = useMemo(() => {
    const map = {};
    productionCards.forEach((card) => {
      const key = normalizeValue(card.issueId);
      if (!key) return;
      map[key] = card;
    });
    return map;
  }, [productionCards]);

  const allTimerEntries = useMemo(() => {
    return [...timeLog, ...activeTimers];
  }, [timeLog, activeTimers]);

  // Users inferred from log entries that don't match any org user (e.g. registeredBy name only)
  const inferredLogUsers = useMemo(() => {
    const inferredMap = new Map();

    allTimerEntries.forEach((entry) => {
      const matchedUser = getOrganizationUserMatch(entry);
      if (matchedUser) return;

      const inferredKey =
        normalizeValue(entry.userId) ||
        normalizeValue(entry.userEmail) ||
        normalizeValue(entry.registeredBy);
      if (!inferredKey || inferredMap.has(inferredKey)) return;

      const inferredLabel =
        normalizeValue(entry.registeredBy) ||
        normalizeValue(entry.userEmail) ||
        normalizeValue(entry.userId) ||
        "Unknown user";

      inferredMap.set(inferredKey, {
        userId: inferredKey,
        label: inferredLabel,
        email: normalizeValue(entry.userEmail),
        aliases: Array.from(
          new Set(
            [normalizeValue(entry.userId), normalizeValue(entry.userEmail), normalizeValue(entry.registeredBy)].filter(Boolean)
          )
        ),
      });
    });

    return Array.from(inferredMap.values()).sort((left, right) => left.label.localeCompare(right.label));
  }, [allTimerEntries, organizationUsers]);

  const allUsers = useMemo(() => {
    const combinedMap = new Map();
    organizationUsers.forEach((u) => { if (normalizeValue(u.userId)) combinedMap.set(normalizeValue(u.userId), u); });
    inferredLogUsers.forEach((u) => { if (normalizeValue(u.userId) && !combinedMap.has(normalizeValue(u.userId))) combinedMap.set(normalizeValue(u.userId), u); });
    return Array.from(combinedMap.values()).sort((left, right) => left.label.localeCompare(right.label));
  }, [organizationUsers, inferredLogUsers]);

  const userOptions = useMemo(() => {
    return allUsers.map((entry) => ({ value: entry.userId, label: entry.label }));
  }, [allUsers]);

  const filteredUserOptions = useMemo(() => {
    const userSearch = normalizeComparable(userSearchText);
    if (!userSearch) return userOptions;

    return userOptions.filter((option) => normalizeComparable(option.label).includes(userSearch));
  }, [userOptions, userSearchText]);

  const getDefaultSelectedUser = () => {
    const authUid = normalizeComparable(user?.uid);
    const authEmail = normalizeComparable(user?.email);

    const matchedUser = allUsers.find((entry) => {
      const aliases = [
        entry?.userId,
        entry?.email,
        ...(Array.isArray(entry?.aliases) ? entry.aliases : []),
      ]
        .map((value) => normalizeComparable(value))
        .filter(Boolean);

      if (authUid && aliases.includes(authUid)) return true;
      if (authEmail && aliases.includes(authEmail)) return true;
      return false;
    });

    return normalizeValue(matchedUser?.userId);
  };

  useEffect(() => {
    if (hasInitializedSelectedUser) return;
    if (!user || allUsers.length === 0) return;

    const defaultUserId = getDefaultSelectedUser();
    if (defaultUserId) {
      setSelectedUser(defaultUserId);
    }

    setHasInitializedSelectedUser(true);
  }, [allUsers, hasInitializedSelectedUser, user]);

  const cardOptions = useMemo(() => {
    const cardMap = new Map();

    productionCards.forEach((card) => {
      const issueId = normalizeValue(card.issueId);
      if (!issueId || cardMap.has(issueId)) return;
      cardMap.set(issueId, {
        issueId,
        title: normalizeValue(card.title),
      });
    });

    timeLog.forEach((entry) => {
      const issueId = normalizeValue(entry.issueId);
      if (!issueId || cardMap.has(issueId)) return;
      cardMap.set(issueId, {
        issueId,
        title: "",
      });
    });

    activeTimers.forEach((entry) => {
      const issueId = normalizeValue(entry.issueId);
      if (!issueId || cardMap.has(issueId)) return;
      cardMap.set(issueId, {
        issueId,
        title: "",
      });
    });

    return Array.from(cardMap.values())
      .sort((left, right) => left.issueId.localeCompare(right.issueId))
      .map((card) => ({
        value: card.issueId,
        label: `${card.issueId} - ${card.title || "No title"}`,
      }));
  }, [productionCards, timeLog, activeTimers]);

  const projectOptions = useMemo(() => {
    const seenProjects = new Set();
    const names = [
      ...productionCards.map((card) => normalizeValue(card.projectName)),
      ...timeLog.map((entry) => normalizeValue(entry.projectName)),
      ...activeTimers.map((entry) => normalizeValue(entry.projectName)),
    ];

    return names
      .filter((projectName) => {
        if (!projectName || seenProjects.has(projectName)) return false;
        seenProjects.add(projectName);
        return true;
      })
      .sort((left, right) => left.localeCompare(right))
      .map((projectName) => ({ value: projectName, label: projectName }));
  }, [productionCards, timeLog, activeTimers]);

  const filteredTimerLogs = useMemo(() => {
    const normalizedSearch = normalizeValue(searchText).toLowerCase();
    const startTimestamp = toStartOfDayTimestamp(startDate);
    const endTimestamp = toEndOfDayTimestamp(endDate);

    return allTimerEntries
      .filter((entry) => entry.logType !== "completion" || (Array.isArray(entry.notes) && entry.notes.some((n) => normalizeValue(n?.text))))
      .filter((entry) => Number(entry.durationMs) > 0 || (Array.isArray(entry.notes) && entry.notes.some((n) => normalizeValue(n?.text))))
      .filter((entry) => Boolean(normalizeValue(entry.issueId)))
      .filter((entry) => {
        const eventTimestamp = getEntryTimestamp(entry);
        if (!eventTimestamp) return false;
        if (!Number.isNaN(startTimestamp) && eventTimestamp < startTimestamp) return false;
        if (!Number.isNaN(endTimestamp) && eventTimestamp > endTimestamp) return false;
        return true;
      })
      .filter((entry) => {
        if (!selectedUser) return true;
        const selectedComparable = normalizeComparable(selectedUser);
        const matchedUser = getOrganizationUserMatch(entry);
        const selectedUserEntry = allUsers.find((u) => normalizeComparable(u.userId) === selectedComparable) || null;

        const entryAliases = [
          entry.userId,
          entry.userEmail,
          entry.registeredBy,
          matchedUser?.userId,
          matchedUser?.email,
          matchedUser?.label,
          ...(Array.isArray(matchedUser?.aliases) ? matchedUser.aliases : []),
        ]
          .map((value) => normalizeComparable(value))
          .filter(Boolean);

        if (selectedUserEntry) {
          const selectedAliases = [
            selectedUserEntry.userId,
            selectedUserEntry.email,
            selectedUserEntry.label,
            ...(Array.isArray(selectedUserEntry.aliases) ? selectedUserEntry.aliases : []),
          ]
            .map((value) => normalizeComparable(value))
            .filter(Boolean);

          return entryAliases.some((entryAlias) => selectedAliases.includes(entryAlias));
        }

        return entryAliases.includes(selectedComparable);
      })
      .filter((entry) => {
        if (!selectedProject) return true;
        const card = productionCardMapByIssueId[normalizeValue(entry.issueId)] || {};
        const projectName = normalizeValue(card.projectName || entry.projectName);
        return projectName === selectedProject;
      })
      .filter((entry) => {
        if (!selectedCard) return true;
        return normalizeValue(entry.issueId) === selectedCard;
      })
      .filter((entry) => {
        if (!normalizedSearch) return true;
        const card = productionCardMapByIssueId[normalizeValue(entry.issueId)] || {};
        const matchedUser = getOrganizationUserMatch(entry);
        const haystack = [
          entry.issueId,
          card.title,
          card.projectName,
          entry.projectName,
          matchedUser?.label,
          entry.registeredBy,
        ]
          .map((value) => normalizeValue(value).toLowerCase())
          .join(" ");

        return haystack.includes(normalizedSearch);
      });
  }, [allTimerEntries, allUsers, endDate, productionCardMapByIssueId, searchText, selectedCard, selectedProject, selectedUser, startDate]);

  const cardUserRollup = useMemo(() => {
    const rollupMap = {};

    filteredTimerLogs.forEach((entry) => {
      const issueId = normalizeValue(entry.issueId);
      const card = productionCardMapByIssueId[issueId] || {};
      const matchedUser = getOrganizationUserMatch(entry);
      const userKey = normalizeValue(matchedUser?.userId) || normalizeValue(entry.userId) || normalizeValue(entry.registeredBy) || "unknown-user";
      const userLabel = normalizeValue(matchedUser?.label) || normalizeValue(entry.registeredBy) || "Unknown user";
      const userEmail = normalizeValue(matchedUser?.email) || normalizeValue(entry.userEmail);
      const rollupKey = `${issueId}::${userKey}`;
      const entryStartTimestamp = toTimestampMs(entry?.startedAt) || getEntryTimestamp(entry);
      const entryEndTimestamp =
        toTimestampMs(entry?.endedAt) ||
        toTimestampMs(entry?.completionAt) ||
        (entryStartTimestamp > 0
          ? entryStartTimestamp + Math.max(0, Number(entry?.durationMs) || 0)
          : getEntryTimestamp(entry));

      if (!rollupMap[rollupKey]) {
        rollupMap[rollupKey] = {
          rollupKey,
          issueId,
          title: normalizeValue(card.title),
          projectName: normalizeValue(card.projectName || entry.projectName),
          userKey,
          userLabel,
          userEmail,
          totalDurationMs: 0,
          totalEntries: 0,
          firstAt: entryStartTimestamp,
          firstEntryId: entry.id,
          firstEntryCollection: entry.logType === "active" ? "timeRotateActiveTimers" : "timeRotateLogs",
          firstEntryEndedAt: entryEndTimestamp,
          lastAt: entryEndTimestamp,
          lastEntryId: entry.id,
          lastEntryCollection: entry.logType === "active" ? "timeRotateActiveTimers" : "timeRotateLogs",
          lastEntryStartedAt: entryStartTimestamp,
          entryRefs: [],
          entries: [],
          noteMap: {},
        };
      }

      rollupMap[rollupKey].totalDurationMs += Number(entry.durationMs) || 0;
      rollupMap[rollupKey].totalEntries += 1;
      rollupMap[rollupKey].entryRefs.push({
        id: entry.id,
        collection: entry.logType === "active" ? "timeRotateActiveTimers" : "timeRotateLogs",
      });
      rollupMap[rollupKey].entries.push({
        id: entry.id,
        collection: entry.logType === "active" ? "timeRotateActiveTimers" : "timeRotateLogs",
        startedAt: entryStartTimestamp,
        endedAt: entryEndTimestamp,
        durationMs: Math.max(0, Number(entry.durationMs) || 0),
        logType: entry.logType,
        notes: (Array.isArray(entry.notes) ? entry.notes : [])
          .map((note) => ({
            text: normalizeValue(note?.text),
            timestamp: Number(note?.timestamp) || 0,
          }))
          .filter((note) => note.text)
          .sort((left, right) => {
            if (right.timestamp !== left.timestamp) return right.timestamp - left.timestamp;
            return left.text.localeCompare(right.text);
          }),
      });
      if (
        entryStartTimestamp &&
        (rollupMap[rollupKey].firstAt === 0 || entryStartTimestamp < rollupMap[rollupKey].firstAt)
      ) {
        rollupMap[rollupKey].firstAt = entryStartTimestamp;
        rollupMap[rollupKey].firstEntryId = entry.id;
        rollupMap[rollupKey].firstEntryCollection = entry.logType === "active" ? "timeRotateActiveTimers" : "timeRotateLogs";
        rollupMap[rollupKey].firstEntryEndedAt = entryEndTimestamp;
      }
      if (entryEndTimestamp > rollupMap[rollupKey].lastAt) {
        rollupMap[rollupKey].lastAt = entryEndTimestamp;
        rollupMap[rollupKey].lastEntryId = entry.id;
        rollupMap[rollupKey].lastEntryCollection = entry.logType === "active" ? "timeRotateActiveTimers" : "timeRotateLogs";
        rollupMap[rollupKey].lastEntryStartedAt = entryStartTimestamp;
      }

      if (Array.isArray(entry.notes)) {
        entry.notes.forEach((note) => {
          const noteText = normalizeValue(note?.text);
          if (!noteText) return;

          const noteTimestamp = Number(note?.timestamp) || 0;
          const noteKey = `${noteText}::${noteTimestamp}`;
          rollupMap[rollupKey].noteMap[noteKey] = {
            text: noteText,
            timestamp: noteTimestamp,
          };
        });
      }
    });

    return Object.values(rollupMap)
      .map((row) => {
        const entries = Array.isArray(row.entries)
          ? [...row.entries].sort((left, right) => {
              if ((right.startedAt || 0) !== (left.startedAt || 0)) {
                return (right.startedAt || 0) - (left.startedAt || 0);
              }
              return String(left.id || "").localeCompare(String(right.id || ""));
            })
          : [];
        const notes = Object.values(row.noteMap || {}).sort((left, right) => {
          if (right.timestamp !== left.timestamp) {
            return right.timestamp - left.timestamp;
          }
          return left.text.localeCompare(right.text);
        });
        const { noteMap, ...rowWithoutNoteMap } = row;

        return {
          ...rowWithoutNoteMap,
          entries,
          notes,
        };
      })
      .sort((left, right) => {
      if (right.totalDurationMs !== left.totalDurationMs) {
        return right.totalDurationMs - left.totalDurationMs;
      }
      if (left.issueId !== right.issueId) {
        return left.issueId.localeCompare(right.issueId);
      }
      return left.userLabel.localeCompare(right.userLabel);
      });
  }, [filteredTimerLogs, productionCardMapByIssueId, organizationUsers]);

  const totalDurationAllRows = useMemo(() => {
    return cardUserRollup.reduce((sum, row) => sum + (Number(row.totalDurationMs) || 0), 0);
  }, [cardUserRollup]);

  const filteredProjectRollup = useMemo(() => {
    const projectMap = {};

    cardUserRollup.forEach((row) => {
      const projectName = normalizeValue(row.projectName) || "Unassigned Project";
      if (!projectMap[projectName]) {
        projectMap[projectName] = {
          projectName,
          totalDurationMs: 0,
          totalEntries: 0,
          cards: {},
          contributors: {},
        };
      }

      const projectBucket = projectMap[projectName];
      projectBucket.totalDurationMs += Number(row.totalDurationMs) || 0;
      projectBucket.totalEntries += Number(row.totalEntries) || 0;

      const contributorLabel = normalizeValue(row.userLabel) || "Unknown user";
      projectBucket.contributors[contributorLabel] =
        (projectBucket.contributors[contributorLabel] || 0) + (Number(row.totalDurationMs) || 0);

      const issueId = normalizeValue(row.issueId) || "Unknown card";
      if (!projectBucket.cards[issueId]) {
        projectBucket.cards[issueId] = {
          issueId,
          title: normalizeValue(row.title),
          totalDurationMs: 0,
          totalEntries: 0,
          contributors: {},
          notes: [],
        };
      }

      const cardBucket = projectBucket.cards[issueId];
      cardBucket.totalDurationMs += Number(row.totalDurationMs) || 0;
      cardBucket.totalEntries += Number(row.totalEntries) || 0;
      cardBucket.contributors[contributorLabel] =
        (cardBucket.contributors[contributorLabel] || 0) + (Number(row.totalDurationMs) || 0);

      if (Array.isArray(row.notes) && row.notes.length > 0) {
        row.notes.slice(0, 3).forEach((note) => {
          const noteText = truncateText(note?.text, 180);
          if (!noteText) return;
          cardBucket.notes.push({
            timestamp: Number(note?.timestamp) || 0,
            text: noteText,
          });
        });
      }
    });

    return Object.values(projectMap)
      .map((projectBucket) => {
        const cards = Object.values(projectBucket.cards)
          .map((cardBucket) => ({
            issueId: cardBucket.issueId,
            title: cardBucket.title || "No title",
            totalDuration: formatDuration(cardBucket.totalDurationMs),
            totalEntries: cardBucket.totalEntries,
            contributors: Object.entries(cardBucket.contributors)
              .sort((left, right) => right[1] - left[1])
              .slice(0, 5)
              .map(([name, durationMs]) => ({ name, duration: formatDuration(durationMs) })),
            notes: cardBucket.notes
              .sort((left, right) => right.timestamp - left.timestamp)
              .slice(0, 3)
              .map((note) => ({
                at: note.timestamp ? formatTimestamp(note.timestamp) : "No timestamp",
                text: note.text,
              })),
          }))
          .sort((left, right) => {
            if (left.totalEntries !== right.totalEntries) {
              return right.totalEntries - left.totalEntries;
            }
            if (left.issueId !== right.issueId) {
              return left.issueId.localeCompare(right.issueId);
            }
            return left.title.localeCompare(right.title);
          });

        const topContributors = Object.entries(projectBucket.contributors)
          .sort((left, right) => right[1] - left[1])
          .slice(0, 8)
          .map(([name, durationMs]) => ({ name, duration: formatDuration(durationMs) }));

        return {
          projectName: projectBucket.projectName,
          totalDuration: formatDuration(projectBucket.totalDurationMs),
          totalEntries: projectBucket.totalEntries,
          cardCount: cards.length,
          topContributors,
          cards,
        };
      })
      .sort((left, right) => {
        if (left.cardCount !== right.cardCount) {
          return right.cardCount - left.cardCount;
        }
        return left.projectName.localeCompare(right.projectName);
      });
  }, [cardUserRollup]);

  const employeeReportingInsights = useMemo(() => {
    const employeeMap = {};

    filteredTimerLogs.forEach((entry) => {
      const matchedUser = getOrganizationUserMatch(entry);
      const userKey = normalizeValue(matchedUser?.userId) || normalizeValue(entry.userId) || normalizeValue(entry.registeredBy) || "unknown-user";
      const userLabel = normalizeValue(matchedUser?.label) || normalizeValue(entry.registeredBy) || "Unknown user";
      const issueId = normalizeValue(entry.issueId) || "Unknown card";
      const card = productionCardMapByIssueId[issueId] || {};
      const projectName = normalizeValue(card.projectName || entry.projectName) || "Unassigned Project";
      const durationMs = Math.max(0, Number(entry.durationMs) || 0);
      const timestamp = getEntryTimestamp(entry);
      const dayKey = getLocalDayKey(timestamp);
      const notes = Array.isArray(entry.notes) ? entry.notes : [];

      if (!employeeMap[userKey]) {
        employeeMap[userKey] = {
          userKey,
          userLabel,
          totalEntries: 0,
          totalDurationMs: 0,
          noteEntries: 0,
          totalNotes: 0,
          longNotes: 0,
          totalNoteCharacters: 0,
          duplicateNoteCount: 0,
          shortSessionCount: 0,
          days: new Set(),
          cards: new Set(),
          projects: new Set(),
          sessionDurationsMs: [],
          dayDurationsMs: {},
          uniqueNoteTexts: new Set(),
          parsedIssueTitles: new Set(),
          noteSamples: [],
          electricalTotals: {
            conduits: 0,
            racks: 0,
            supports: 0,
            adjustments: 0,
            totalObjects: 0,
          },
          quantifiableEvidenceCount: 0,
        };
      }

      const bucket = employeeMap[userKey];
      bucket.totalEntries += 1;
      bucket.totalDurationMs += durationMs;
      bucket.cards.add(issueId);
      bucket.projects.add(projectName);
      bucket.sessionDurationsMs.push(durationMs);

      if (dayKey) {
        bucket.days.add(dayKey);
        bucket.dayDurationsMs[dayKey] = (bucket.dayDurationsMs[dayKey] || 0) + durationMs;
      }

      if (durationMs > 0 && durationMs <= 5 * 60 * 1000) {
        bucket.shortSessionCount += 1;
      }

      if (notes.length > 0) {
        bucket.noteEntries += 1;
      }

      if (!bucket.parsedIssueTitles.has(issueId)) {
        const titleQuantities = parseElectricalQuantitiesFromText(card?.title);
        bucket.electricalTotals = mergeElectricalTotals(bucket.electricalTotals, titleQuantities);
        if (Number(titleQuantities.totalObjects) > 0) {
          bucket.quantifiableEvidenceCount += 1;
        }
        bucket.parsedIssueTitles.add(issueId);
      }

      notes.forEach((note) => {
        const noteText = normalizeValue(note?.text);
        if (!noteText) return;

        bucket.totalNotes += 1;
        bucket.totalNoteCharacters += noteText.length;
        if (noteText.length >= 40) {
          bucket.longNotes += 1;
        }

        const normalizedNote = normalizeComparable(noteText);
        if (normalizedNote) {
          if (bucket.uniqueNoteTexts.has(normalizedNote)) {
            bucket.duplicateNoteCount += 1;
          }
          bucket.uniqueNoteTexts.add(normalizedNote);
        }

        if (bucket.noteSamples.length < 6) {
          bucket.noteSamples.push(truncateText(noteText, 140));
        }

        const noteQuantities = parseElectricalQuantitiesFromText(noteText);
        bucket.electricalTotals = mergeElectricalTotals(bucket.electricalTotals, noteQuantities);
        if (Number(noteQuantities.totalObjects) > 0) {
          bucket.quantifiableEvidenceCount += 1;
        }
      });
    });

    return Object.values(employeeMap)
      .map((bucket) => {
        const activeDays = Math.max(1, bucket.days.size);
        const noteCoveragePct = bucket.totalEntries > 0 ? (bucket.noteEntries / bucket.totalEntries) * 100 : 0;
        const detailedNotePct = bucket.totalNotes > 0 ? (bucket.longNotes / bucket.totalNotes) * 100 : 0;
        const avgNoteLength = bucket.totalNotes > 0 ? bucket.totalNoteCharacters / bucket.totalNotes : 0;
        const duplicateNotePct = bucket.totalNotes > 0 ? (bucket.duplicateNoteCount / bucket.totalNotes) * 100 : 0;
        const sessionsPerDay = bucket.totalEntries / activeDays;
        const averageSessionMs = average(bucket.sessionDurationsMs);
        const sessionStdDevMs = standardDeviation(bucket.sessionDurationsMs);
        const sessionCv = averageSessionMs > 0 ? sessionStdDevMs / averageSessionMs : 1;
        const consistencyScore = clamp(100 - (sessionCv * 55));
        const cadenceScore = clamp((sessionsPerDay / 4) * 100);
        const duplicatePenaltyScore = clamp(100 - duplicateNotePct);
        const shortSessionRate = bucket.totalEntries > 0 ? (bucket.shortSessionCount / bucket.totalEntries) * 100 : 0;
        const totalObjects = Number(bucket.electricalTotals?.totalObjects) || 0;
        const hoursWorked = Math.max(0, Number(bucket.totalDurationMs) || 0) / (60 * 60 * 1000);
        const productivityUnitsPerHour = hoursWorked > 0 ? totalObjects / hoursWorked : 0;
        const productivityScore = clamp((productivityUnitsPerHour / 12) * 100);

        const qualityScore = clamp(
          (noteCoveragePct * 0.3) +
          (detailedNotePct * 0.18) +
          (consistencyScore * 0.18) +
          (cadenceScore * 0.12) +
          (duplicatePenaltyScore * 0.1) +
          (productivityScore * 0.12)
        );

        const confidence = bucket.totalEntries >= 20
          ? "High"
          : bucket.totalEntries >= 8
            ? "Medium"
            : "Low";

        const riskSignals = [];
        if (noteCoveragePct < 35) riskSignals.push("Low note coverage");
        if (detailedNotePct < 25) riskSignals.push("Low detail in notes");
        if (duplicateNotePct > 40) riskSignals.push("High repeated-note behavior");
        if (shortSessionRate > 45) riskSignals.push("High short-session frequency");
        if (consistencyScore < 45) riskSignals.push("Irregular reporting cadence");
        if (totalObjects === 0) riskSignals.push("No quantifiable electrical objects reported");
        if (totalObjects >= 10 && productivityUnitsPerHour < 2) riskSignals.push("Low productivity versus reported object volume");

        const electricalQualification = buildElectricalQualificationLabel({
          productivityUnitsPerHour,
          totalObjects,
          totalDurationMs: bucket.totalDurationMs,
        });

        const topProjects = Object.entries(bucket.dayDurationsMs)
          .sort((left, right) => right[1] - left[1])
          .slice(0, 5)
          .map(([day, durationMs]) => ({ day, duration: formatDuration(durationMs) }));

        return {
          userKey: bucket.userKey,
          userLabel: bucket.userLabel,
          qualityScore: Number(qualityScore.toFixed(1)),
          confidence,
          totalEntries: bucket.totalEntries,
          totalDuration: formatDuration(bucket.totalDurationMs),
          activeDays: bucket.days.size,
          uniqueCards: bucket.cards.size,
          uniqueProjects: bucket.projects.size,
          productivityUnitsPerHour: Number(productivityUnitsPerHour.toFixed(2)),
          electricalQualification,
          quantifiableEvidenceCount: bucket.quantifiableEvidenceCount,
          electricalTotals: {
            conduits: Number(bucket.electricalTotals.conduits || 0),
            racks: Number(bucket.electricalTotals.racks || 0),
            supports: Number(bucket.electricalTotals.supports || 0),
            adjustments: Number(bucket.electricalTotals.adjustments || 0),
            totalObjects: Number(bucket.electricalTotals.totalObjects || 0),
          },
          noteCoveragePct: formatPercent(noteCoveragePct),
          detailedNotePct: formatPercent(detailedNotePct),
          avgNoteLength: Number(avgNoteLength.toFixed(1)),
          duplicateNotePct: formatPercent(duplicateNotePct),
          shortSessionRate: formatPercent(shortSessionRate),
          consistencyScore: Number(consistencyScore.toFixed(1)),
          sessionsPerDay: Number(sessionsPerDay.toFixed(2)),
          riskSignals,
          noteSamples: bucket.noteSamples,
          activeDayBreakdown: topProjects,
        };
      })
      .sort((left, right) => {
        if (left.qualityScore !== right.qualityScore) {
          return left.qualityScore - right.qualityScore;
        }
        return left.userLabel.localeCompare(right.userLabel);
      });
  }, [filteredTimerLogs, productionCardMapByIssueId]);

  const selectedUserLabel = useMemo(() => {
    if (!selectedUser) return "All users";
    return filteredUserOptions.find((entry) => entry.value === selectedUser)?.label || selectedUser;
  }, [filteredUserOptions, selectedUser]);

  const selectedCardLabel = useMemo(() => {
    if (!selectedCard) return "All cards";
    return cardOptions.find((entry) => entry.value === selectedCard)?.label || selectedCard;
  }, [cardOptions, selectedCard]);

  const selectedProjectLabel = useMemo(() => {
    if (!selectedProject) return "All projects";
    return projectOptions.find((entry) => entry.value === selectedProject)?.label || selectedProject;
  }, [projectOptions, selectedProject]);

  useEffect(() => {
    if (employeeReportingInsights.length === 0) {
      setCoachSelectedUserKey("");
      return;
    }

    if (selectedUser && employeeReportingInsights.some((entry) => entry.userKey === selectedUser)) {
      setCoachSelectedUserKey(selectedUser);
      return;
    }

    if (!coachSelectedUserKey || !employeeReportingInsights.some((entry) => entry.userKey === coachSelectedUserKey)) {
      setCoachSelectedUserKey(employeeReportingInsights[0].userKey);
    }
  }, [employeeReportingInsights, selectedUser, coachSelectedUserKey]);

  const selectedCoachEmployee = useMemo(() => {
    if (!coachSelectedUserKey) return null;
    return employeeReportingInsights.find((entry) => entry.userKey === coachSelectedUserKey) || null;
  }, [employeeReportingInsights, coachSelectedUserKey]);

  const noteCoachFeedback = useMemo(() => {
    return buildNoteCoachFeedback(coachDraftNote, selectedCoachEmployee);
  }, [coachDraftNote, selectedCoachEmployee]);

  const selectedCoachSampleNote = useMemo(() => {
    if (!Array.isArray(selectedCoachEmployee?.noteSamples)) return "";
    return normalizeValue(selectedCoachEmployee.noteSamples[0]);
  }, [selectedCoachEmployee]);

  const selectedCoachProgressContext = useMemo(() => {
    if (!selectedCoachEmployee) {
      return {
        hasBaseline: false,
        summary: "Select an employee to analyze reporting progress.",
      };
    }

    const history = Array.isArray(progressSnapshotsByUser?.[selectedCoachEmployee.userKey])
      ? progressSnapshotsByUser[selectedCoachEmployee.userKey]
      : [];

    const currentSnapshot = createEmployeeProgressSnapshot(selectedCoachEmployee);
    const previousSnapshot = [...history]
      .reverse()
      .find((snapshot) => {
        if (!snapshot || typeof snapshot !== "object") return false;

        return (
          Number(snapshot.qualityScore) !== Number(currentSnapshot.qualityScore)
          || Number(snapshot.totalEntries) !== Number(currentSnapshot.totalEntries)
          || Number(snapshot.noteCoveragePct) !== Number(currentSnapshot.noteCoveragePct)
          || Number(snapshot.detailedNotePct) !== Number(currentSnapshot.detailedNotePct)
          || Number(snapshot.duplicateNotePct) !== Number(currentSnapshot.duplicateNotePct)
          || Number(snapshot.consistencyScore) !== Number(currentSnapshot.consistencyScore)
        );
      });

    if (!previousSnapshot) {
      return {
        hasBaseline: false,
        summary: "No previous benchmark found yet. Generate quality reviews over time to unlock progress coaching.",
        currentSnapshot,
      };
    }

    const qualityDelta = Number(currentSnapshot.qualityScore) - Number(previousSnapshot.qualityScore || 0);
    const noteCoverageDelta = Number(currentSnapshot.noteCoveragePct) - Number(previousSnapshot.noteCoveragePct || 0);
    const detailedNoteDelta = Number(currentSnapshot.detailedNotePct) - Number(previousSnapshot.detailedNotePct || 0);
    const duplicateDelta = Number(currentSnapshot.duplicateNotePct) - Number(previousSnapshot.duplicateNotePct || 0);
    const consistencyDelta = Number(currentSnapshot.consistencyScore) - Number(previousSnapshot.consistencyScore || 0);

    const formatDelta = (value) => {
      const numericValue = Number(value) || 0;
      const roundedValue = Number(numericValue.toFixed(1));
      const prefix = roundedValue > 0 ? "+" : "";
      return `${prefix}${roundedValue}`;
    };

    const baselineDateLabel = previousSnapshot.generatedAt
      ? formatTimestamp(previousSnapshot.generatedAt)
      : "Unknown date";

    return {
      hasBaseline: true,
      summary: `Since ${baselineDateLabel}: Score ${formatDelta(qualityDelta)}, Coverage ${formatDelta(noteCoverageDelta)} pts, Detail ${formatDelta(detailedNoteDelta)} pts, Duplicate ${formatDelta(duplicateDelta)} pts, Consistency ${formatDelta(consistencyDelta)} pts.`,
      qualityDelta,
      noteCoverageDelta,
      detailedNoteDelta,
      duplicateDelta,
      consistencyDelta,
      baselineDateLabel,
      currentSnapshot,
      previousSnapshot,
    };
  }, [progressSnapshotsByUser, selectedCoachEmployee]);

  const handleGenerateAiReportingReview = async () => {
    setAiReviewError("");
    setCopiedReport(false);

    if (employeeReportingInsights.length === 0) {
      setAiReviewError("No employee reporting activity found for the current filters.");
      return;
    }

    setIsAiReviewLoading(true);

    try {
      const compactProjects = filteredProjectRollup.slice(0, 15).map((projectEntry) => ({
        projectName: projectEntry.projectName,
        totalDuration: projectEntry.totalDuration,
        totalEntries: projectEntry.totalEntries,
        cardCount: projectEntry.cardCount,
        topContributors: projectEntry.topContributors,
        cards: projectEntry.cards.slice(0, 12),
      }));

      const compactEmployeeInsights = employeeReportingInsights.slice(0, 40).map((employee) => ({
        ...employee,
        noteSamples: employee.noteSamples.slice(0, 4),
      }));

      const prompt = buildEmployeeReportingReviewPrompt({
        organizationId: id,
        filterSummary: [
          `User: ${selectedUserLabel}`,
          `Card: ${selectedCardLabel}`,
          `Project: ${selectedProjectLabel}`,
          `Search: ${normalizeValue(searchText) || "None"}`,
          `Preset: ${dateRangePreset}`,
        ].join(" | "),
        dateRange: `${startDate || "No start"} to ${endDate || "No end"}`,
        totalEntries: filteredTimerLogs.length,
        totalDuration: formatDuration(totalDurationAllRows),
        employees: {
          userInsights: compactEmployeeInsights,
          projectContext: compactProjects,
        },
      });

      const response = await fetch(`${FIREBASE_FUNCTIONS_BASE_URL}/generateTimeRotateInvoiceReview`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          model: AI_REVIEW_MODEL,
        }),
      });

      const responseContentType = String(response.headers.get("content-type") || "").toLowerCase();
      const rawBody = await response.text();
      let payload = {};

      if (responseContentType.includes("application/json")) {
        try {
          payload = rawBody ? JSON.parse(rawBody) : {};
        } catch (jsonParseError) {
          throw new Error("AI review endpoint returned invalid JSON.");
        }
      } else if (rawBody.trim().startsWith("<")) {
        throw new Error("AI review endpoint returned HTML. Deploy the function and verify the endpoint URL.");
      }

      if (!response.ok) {
        const requestErrorMessage =
          normalizeValue(payload?.error) ||
          normalizeValue(payload?.message) ||
          normalizeValue(payload?.details?.error?.message) ||
          "AI review request failed.";
        throw new Error(requestErrorMessage);
      }

      const responseText = normalizeValue(payload?.text);

      if (!responseText) {
        throw new Error("AI returned no review text for this dataset.");
      }

      setAiReviewText(responseText);

      const nextProgressStore = readProgressSnapshotStore(id);
      employeeReportingInsights.forEach((employeeInsight) => {
        const employeeKey = normalizeValue(employeeInsight?.userKey);
        if (!employeeKey) return;

        const nextSnapshot = createEmployeeProgressSnapshot(employeeInsight);
        const currentHistory = Array.isArray(nextProgressStore[employeeKey])
          ? nextProgressStore[employeeKey]
          : [];
        const lastSnapshot = currentHistory[currentHistory.length - 1] || null;

        const isDuplicateSnapshot =
          lastSnapshot
          && Number(lastSnapshot.qualityScore) === Number(nextSnapshot.qualityScore)
          && Number(lastSnapshot.totalEntries) === Number(nextSnapshot.totalEntries)
          && Number(lastSnapshot.noteCoveragePct) === Number(nextSnapshot.noteCoveragePct)
          && Number(lastSnapshot.detailedNotePct) === Number(nextSnapshot.detailedNotePct)
          && Number(lastSnapshot.duplicateNotePct) === Number(nextSnapshot.duplicateNotePct)
          && Number(lastSnapshot.consistencyScore) === Number(nextSnapshot.consistencyScore);

        if (isDuplicateSnapshot) {
          return;
        }

        nextProgressStore[employeeKey] = [...currentHistory, nextSnapshot].slice(-MAX_PROGRESS_SNAPSHOTS_PER_USER);
      });

      writeProgressSnapshotStore(id, nextProgressStore);
      setProgressSnapshotsByUser(nextProgressStore);
    } catch (requestError) {
      console.error("AI reporting quality review failed:", requestError);
      setAiReviewError(normalizeValue(requestError?.message) || "Unable to generate AI review right now.");
    } finally {
      setIsAiReviewLoading(false);
    }
  };

  const handleAskReportingCoach = async () => {
    setReportingCoachError("");

    const trimmedQuestion = normalizeValue(reportingCoachQuestion);
    if (!trimmedQuestion) {
      setReportingCoachError("Ask a question so the coach can respond.");
      return;
    }

    if (!aiReviewText) {
      setReportingCoachError("Generate AI Quality Review first so the chat can use that report.");
      return;
    }

    if (!selectedCoachEmployee) {
      setReportingCoachError("Select an employee to receive tailored coaching.");
      return;
    }

    const userMessage = {
      role: "user",
      text: trimmedQuestion,
      timestamp: Date.now(),
    };

    setReportingCoachMessages((current) => [...current, userMessage]);
    setReportingCoachQuestion("");
    setIsReportingCoachLoading(true);

    try {
      const previousMessages = [...reportingCoachMessages, userMessage]
        .slice(-6)
        .map((message) => ({
          role: message.role,
          text: message.text,
        }));

      const prompt = buildReportingCoachChatPrompt({
        organizationId: id,
        filterSummary: [
          `User: ${selectedUserLabel}`,
          `Card: ${selectedCardLabel}`,
          `Project: ${selectedProjectLabel}`,
          `Search: ${normalizeValue(searchText) || "None"}`,
          `Preset: ${dateRangePreset}`,
        ].join(" | "),
        dateRange: `${startDate || "No start"} to ${endDate || "No end"}`,
        question: trimmedQuestion,
        aiReviewText,
        selectedEmployee: selectedCoachEmployee,
        progressContext: selectedCoachProgressContext,
        previousMessages,
      });

      const response = await fetch(`${FIREBASE_FUNCTIONS_BASE_URL}/generateTimeRotateInvoiceReview`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          model: AI_REVIEW_MODEL,
        }),
      });

      const responseContentType = String(response.headers.get("content-type") || "").toLowerCase();
      const rawBody = await response.text();
      let payload = {};

      if (responseContentType.includes("application/json")) {
        try {
          payload = rawBody ? JSON.parse(rawBody) : {};
        } catch (jsonParseError) {
          throw new Error("Coach chat endpoint returned invalid JSON.");
        }
      } else if (rawBody.trim().startsWith("<")) {
        throw new Error("Coach chat endpoint returned HTML. Deploy the function and verify endpoint URL.");
      }

      if (!response.ok) {
        const requestErrorMessage =
          normalizeValue(payload?.error) ||
          normalizeValue(payload?.message) ||
          normalizeValue(payload?.details?.error?.message) ||
          "Coach chat request failed.";
        throw new Error(requestErrorMessage);
      }

      const responseText = normalizeValue(payload?.text);
      if (!responseText) {
        throw new Error("Coach chat returned no response text.");
      }

      setReportingCoachMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: responseText,
          timestamp: Date.now(),
        },
      ]);
    } catch (chatError) {
      console.error("AI reporting coach chat failed:", chatError);
      setReportingCoachError(normalizeValue(chatError?.message) || "Unable to get coach response right now.");
    } finally {
      setIsReportingCoachLoading(false);
    }
  };

  const handleCopyAiReview = async () => {
    if (!aiReviewText) return;

    try {
      await navigator.clipboard.writeText(aiReviewText);
      setCopiedReport(true);
    } catch (copyError) {
      console.error("Copy AI review failed:", copyError);
      setAiReviewError("Could not copy report automatically. Please copy manually.");
    }
  };

  const handleDateRangePresetChange = (presetValue) => {
    setDateRangePreset(presetValue);

    if (presetValue === "custom") {
      return;
    }

    const nextRange = getDateRangeForPreset(presetValue);
    setStartDate(nextRange.startDate);
    setEndDate(nextRange.endDate);
  };

  const canEditRow = (row) => {
    if (!user) return false;

    const normalizedRoleCandidates = [
      user?.role,
      user?.baseRole,
      user?.basedOn,
      user?.systemRole,
      user?.roleBase,
    ]
      .map((value) => normalizeComparable(value).replace(/\s+/g, "_"))
      .filter(Boolean);

    if (normalizedRoleCandidates.includes("global_admin")) return true;
    if (normalizedRoleCandidates.includes("admin")) return true;

    // Keep existing auth helper checks as fallback.
    if (isGlobalAdmin()) return true;
    if (isAdmin()) return true;

    return false;
  };

  const handleStartEdit = (row) => {
    setAddingRowKey(null);
    setAddError("");
    setEditingEntryKey("");
    setEditingEntryError("");
    setEditingRowKey(row.rollupKey);
    setEditStartMs(row.firstAt || 0);
    setEditEndMs(row.lastAt || 0);
    setEditError("");
  };

  const handleStartAdd = (row) => {
    const baseStart = row.lastAt || Date.now();
    setEditingRowKey(null);
    setEditError("");
    setEditingEntryKey("");
    setEditingEntryError("");
    setAddingRowKey(row.rollupKey);
    setAddStartMs(baseStart);
    setAddEndMs(baseStart + (30 * 60 * 1000));
    setAddError("");
    setDeleteError("");
  };

  const handleSaveEdit = async (row) => {
    setEditSaving(true);
    setEditError("");
    try {
      const sameEntry = row.firstEntryId && row.firstEntryId === row.lastEntryId;

      if (sameEntry) {
        // Single entry — update both timestamps and recalculate duration
        const entryRef = doc(db, "churches", id, row.firstEntryCollection, row.firstEntryId);
        const newDuration = Math.max(0, (editEndMs || 0) - (editStartMs || 0));
        await updateDoc(entryRef, {
          startedAt: editStartMs,
          endedAt: editEndMs,
          durationMs: newDuration,
        });
      } else {
        // Different entries — update each independently and adjust their individual durations
        if (row.firstEntryId && editStartMs) {
          const startRef = doc(db, "churches", id, row.firstEntryCollection, row.firstEntryId);
          const newFirstDuration = Math.max(0, (row.firstEntryEndedAt || 0) - editStartMs);
          await updateDoc(startRef, { startedAt: editStartMs, durationMs: newFirstDuration });
        }
        if (row.lastEntryId && editEndMs) {
          const endRef = doc(db, "churches", id, row.lastEntryCollection, row.lastEntryId);
          const newLastDuration = Math.max(0, editEndMs - (row.lastEntryStartedAt || 0));
          await updateDoc(endRef, { endedAt: editEndMs, durationMs: newLastDuration });
        }
      }
      setEditingRowKey(null);
    } catch (saveError) {
      setEditError(normalizeValue(saveError?.message) || "Save failed.");
    } finally {
      setEditSaving(false);
    }
  };

  const handleSaveAdd = async (row) => {
    if (!user) return;

    if (!addStartMs || !addEndMs || Number.isNaN(addStartMs) || Number.isNaN(addEndMs)) {
      setAddError("Start and End time are required.");
      return;
    }

    if (addEndMs < addStartMs) {
      setAddError("End time cannot be before start time.");
      return;
    }

    setAddSaving(true);
    setAddError("");
    try {
      const newEntryRef = await addDoc(collection(db, "churches", id, "timeRotateLogs"), {
        churchId: id,
        issueId: row.issueId,
        projectName: row.projectName,
        startedAt: addStartMs,
        endedAt: addEndMs,
        durationMs: addEndMs - addStartMs,
        registeredBy: row.userLabel || user?.name || user?.displayName || user?.email || "Unknown user",
        userId: row.userKey || user?.uid || "",
        userEmail: row.userEmail || user?.email || "",
        notes: [],
      });
      setHighlightedEntryKey(`${row.rollupKey}::${newEntryRef.id}`);
      setAddingRowKey(null);
    } catch (saveError) {
      setAddError(normalizeValue(saveError?.message) || "Could not add time entry.");
    } finally {
      setAddSaving(false);
    }
  };

  const handleDeleteEntry = async (row, entry) => {
    if (!entry?.id || !entry?.collection) {
      setDeleteError("No time entry found to delete.");
      return;
    }

    const confirmed = window.confirm(
      `Delete this time entry for ${row.issueId} / ${row.userLabel} (${formatDuration(entry.durationMs)})?`
    );
    if (!confirmed) {
      return;
    }

    setDeleteRowKey(`${row.rollupKey}::${entry.id}`);
    setDeleteError("");
    try {
      await deleteDoc(doc(db, "churches", id, entry.collection, entry.id));
      if (highlightedEntryKey === `${row.rollupKey}::${entry.id}`) {
        setHighlightedEntryKey("");
      }
      if (editingEntryKey === `${row.rollupKey}::${entry.id}`) {
        setEditingEntryKey("");
        setEditingEntryError("");
      }
    } catch (removeError) {
      setDeleteError(normalizeValue(removeError?.message) || "Could not delete time entry.");
    } finally {
      setDeleteRowKey(null);
    }
  };

  const handleStartEntryEdit = (row, entry) => {
    setEditingRowKey(null);
    setEditError("");
    setAddingRowKey(null);
    setAddError("");
    setEditingEntryKey(`${row.rollupKey}::${entry.id}`);
    setEditingEntryStartMs(entry.startedAt || 0);
    setEditingEntryEndMs(entry.endedAt || 0);
    setEditingEntryError("");
  };

  const handleSaveEntryEdit = async (row, entry) => {
    if (!entry?.id || entry.collection !== "timeRotateLogs") {
      setEditingEntryError("Only completed log entries can be edited here.");
      return;
    }

    if (!editingEntryStartMs || !editingEntryEndMs || Number.isNaN(editingEntryStartMs) || Number.isNaN(editingEntryEndMs)) {
      setEditingEntryError("Start and End time are required.");
      return;
    }

    if (editingEntryEndMs < editingEntryStartMs) {
      setEditingEntryError("End time cannot be before start time.");
      return;
    }

    setEditingEntrySaving(true);
    setEditingEntryError("");
    try {
      await updateDoc(doc(db, "churches", id, entry.collection, entry.id), {
        startedAt: editingEntryStartMs,
        endedAt: editingEntryEndMs,
        durationMs: Math.max(0, editingEntryEndMs - editingEntryStartMs),
      });
      setEditingEntryKey("");
    } catch (saveError) {
      setEditingEntryError(normalizeValue(saveError?.message) || "Could not save time entry.");
    } finally {
      setEditingEntrySaving(false);
    }
  };

  return (
    <div
      style={{
        ...commonStyles.fullWidthContainer,
        paddingTop: "2rem",
        paddingBottom: "2rem",
        width: "100%",
        maxWidth: "100%",
        boxSizing: "border-box",
      }}
    >
      <Link to={`${routePrefix}/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to My Organization
      </Link>

      <TimeRotateTopLogo />

      <div
        style={{
          backgroundColor: "white",
          border: "1px solid #E5E7EB",
          borderRadius: "16px",
          width: "100%",
          maxWidth: "100%",
          boxSizing: "border-box",
          padding: "24px",
          marginTop: "1.5rem",
          boxShadow: "0 10px 20px rgba(15, 23, 42, 0.05)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ ...commonStyles.title, marginBottom: "6px" }}>TimeRotate Card Hours</h1>
            <p style={{ margin: 0, color: "#475569" }}>
              Total production hours per card, broken down by user.
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px", marginBottom: "12px" }}>
          <Link to={`${routePrefix}/${id}/time-tracking`} style={tabStyle(false)}>
            ◴ TimeTracking
          </Link>
          <Link to={`${routePrefix}/${id}/time-rotate`} style={tabStyle(false)}>
            ▤ TimeRotate Board
          </Link>
          <Link to={`${routePrefix}/${id}/time-rotate-tracker`} style={tabStyle(false)}>
            ✦ Time Tracker
          </Link>
          <Link to={`${routePrefix}/${id}/time-rotate-office-status`} style={tabStyle(false)}>
            ⌂ Office Status
          </Link>
          <Link to={`${routePrefix}/${id}/time-rotate-card-hours`} style={tabStyle(true)}>
            ◶ Card Hours
          </Link>
          <Link to={`${routePrefix}/${id}/time-rotate-notes?view=floor-planner`} style={tabStyle(false)}>
            ⌖ Floor Planner
          </Link>
          <Link to={`${routePrefix}/${id}/e2-agile-board`} style={tabStyle(false)}>
            ▦ Agile Board
          </Link>
        </div>

        <div
          style={{
            marginTop: "10px",
            border: "1px solid #E2E8F0",
            backgroundColor: "#F8FAFC",
            borderRadius: "12px",
            padding: "12px",
            display: "grid",
            gap: "10px",
          }}
        >
          <div style={{ display: "grid", gap: "8px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <input
              type="text"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search by card, title, project, or user"
              style={{
                width: "100%",
                padding: "8px 10px",
                border: "1px solid #CBD5E1",
                borderRadius: "8px",
                backgroundColor: "#FFFFFF",
              }}
            />
            <input
              type="text"
              value={userSearchText}
              onChange={(event) => setUserSearchText(event.target.value)}
              placeholder="Search users in filter"
              style={{
                width: "100%",
                padding: "8px 10px",
                border: "1px solid #CBD5E1",
                borderRadius: "8px",
                backgroundColor: "#FFFFFF",
              }}
            />
            <select
              value={selectedUser}
              onChange={(event) => setSelectedUser(event.target.value)}
              style={filterControlStyle}
            >
              <option value="">All users</option>
              {filteredUserOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              value={selectedCard}
              onChange={(event) => setSelectedCard(event.target.value)}
              style={filterControlStyle}
            >
              <option value="">All cards</option>
              {cardOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              value={selectedProject}
              onChange={(event) => setSelectedProject(event.target.value)}
              style={filterControlStyle}
            >
              <option value="">All projects</option>
              {projectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              value={dateRangePreset}
              onChange={(event) => handleDateRangePresetChange(event.target.value)}
              style={filterControlStyle}
            >
              {DATE_RANGE_PRESET_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={startDate}
              onChange={(event) => {
                setDateRangePreset("custom");
                setStartDate(event.target.value);
              }}
              max={endDate || undefined}
              style={filterControlStyle}
            />
            <input
              type="date"
              value={endDate}
              onChange={(event) => {
                setDateRangePreset("custom");
                setEndDate(event.target.value);
              }}
              min={startDate || undefined}
              style={filterControlStyle}
            />
          </div>

          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => {
                setSearchText("");
                setUserSearchText("");
                setSelectedUser(getDefaultSelectedUser());
                setSelectedCard("");
                setSelectedProject("");
                setDateRangePreset("today");
                setStartDate(formatDateInputValue(startOfDay(new Date())));
                setEndDate(formatDateInputValue(startOfDay(new Date())));
              }}
              style={{
                backgroundColor: "#334155",
                color: "#FFFFFF",
                border: "none",
                borderRadius: "8px",
                padding: "8px 12px",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Clear Filters
            </button>
            <div style={{ color: "#334155", fontWeight: 600, fontSize: "0.9rem" }}>
              {cardUserRollup.length} rows • Total {formatDuration(totalDurationAllRows)}
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: "12px",
            border: "1px solid #DBEAFE",
            backgroundColor: "#F8FAFF",
            borderRadius: "12px",
            padding: "12px",
            display: "grid",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div style={{ color: "#0F172A", fontWeight: 800, fontSize: "0.95rem" }}>AI Employee Reporting Quality Review</div>
              <div style={{ color: "#475569", fontSize: "0.86rem", marginTop: "2px" }}>
                Scores reporting consistency, detail quality, and risk patterns for employees in the current filters.
              </div>
            </div>

            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={handleGenerateAiReportingReview}
                disabled={isAiReviewLoading}
                style={{
                  backgroundColor: "#1D4ED8",
                  color: "#FFFFFF",
                  border: "none",
                  borderRadius: "8px",
                  padding: "8px 12px",
                  cursor: isAiReviewLoading ? "not-allowed" : "pointer",
                  fontWeight: 700,
                  opacity: isAiReviewLoading ? 0.8 : 1,
                }}
              >
                {isAiReviewLoading ? "Generating..." : "Generate AI Quality Review"}
              </button>
              <button
                type="button"
                onClick={handleCopyAiReview}
                disabled={!aiReviewText}
                style={{
                  backgroundColor: aiReviewText ? "#0F766E" : "#94A3B8",
                  color: "#FFFFFF",
                  border: "none",
                  borderRadius: "8px",
                  padding: "8px 12px",
                  cursor: aiReviewText ? "pointer" : "not-allowed",
                  fontWeight: 700,
                }}
              >
                {copiedReport ? "Copied" : "Copy Report"}
              </button>
            </div>
          </div>

          {aiReviewError ? (
            <div style={{ color: "#B91C1C", fontWeight: 600, fontSize: "0.87rem" }}>{aiReviewError}</div>
          ) : null}

          {aiReviewText ? (
            <textarea
              value={aiReviewText}
              onChange={(event) => setAiReviewText(event.target.value)}
              rows={16}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #CBD5E1",
                borderRadius: "10px",
                backgroundColor: "#FFFFFF",
                color: "#0F172A",
                fontSize: "0.9rem",
                lineHeight: 1.5,
                resize: "vertical",
              }}
            />
          ) : (
            <div style={{ color: "#475569", fontSize: "0.88rem" }}>
              Generate a review to evaluate how well each employee reports work, including consistency, detail quality, and coaching actions.
            </div>
          )}

          <div
            style={{
              border: "1px solid #BFDBFE",
              backgroundColor: "#EFF6FF",
              borderRadius: "10px",
              padding: "12px",
              display: "grid",
              gap: "10px",
            }}
          >
            <div>
              <div style={{ color: "#1E3A8A", fontWeight: 800, fontSize: "0.9rem" }}>AI Reporting Coach Chat</div>
              <div style={{ color: "#334155", fontSize: "0.82rem", marginTop: "2px" }}>
                Ask questions about the current report. Responses use this report and your progress history for better coaching.
              </div>
            </div>

            {reportingCoachError ? (
              <div style={{ color: "#B91C1C", fontWeight: 600, fontSize: "0.82rem" }}>{reportingCoachError}</div>
            ) : null}

            {selectedCoachEmployee ? (
              <div style={{ color: "#1E293B", fontSize: "0.82rem", fontWeight: 600 }}>
                Progress Context: {selectedCoachProgressContext.summary}
              </div>
            ) : null}

            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <input
                type="text"
                value={reportingCoachQuestion}
                onChange={(event) => setReportingCoachQuestion(event.target.value)}
                placeholder="Ask the coach: What should this employee improve this week?"
                style={{
                  flex: "1 1 420px",
                  padding: "8px 10px",
                  border: "1px solid #93C5FD",
                  borderRadius: "8px",
                  backgroundColor: "#FFFFFF",
                }}
              />
              <button
                type="button"
                onClick={handleAskReportingCoach}
                disabled={isReportingCoachLoading}
                style={{
                  backgroundColor: "#1D4ED8",
                  color: "#FFFFFF",
                  border: "none",
                  borderRadius: "8px",
                  padding: "8px 12px",
                  cursor: isReportingCoachLoading ? "not-allowed" : "pointer",
                  fontWeight: 700,
                  opacity: isReportingCoachLoading ? 0.8 : 1,
                }}
              >
                {isReportingCoachLoading ? "Thinking..." : "Ask Coach"}
              </button>
            </div>

            {reportingCoachMessages.length > 0 ? (
              <div style={{ display: "grid", gap: "8px", maxHeight: "260px", overflowY: "auto", paddingRight: "4px" }}>
                {reportingCoachMessages.slice(-8).map((message, index) => (
                  <div
                    key={`${message.role}-${message.timestamp || index}`}
                    style={{
                      border: `1px solid ${message.role === "assistant" ? "#BFDBFE" : "#CBD5E1"}`,
                      backgroundColor: message.role === "assistant" ? "#FFFFFF" : "#F8FAFC",
                      borderRadius: "8px",
                      padding: "8px 10px",
                    }}
                  >
                    <div style={{ color: "#475569", fontSize: "0.72rem", fontWeight: 700, marginBottom: "4px" }}>
                      {message.role === "assistant" ? "Coach" : "You"}
                    </div>
                    <div style={{ color: "#0F172A", fontSize: "0.84rem", lineHeight: 1.4, whiteSpace: "pre-wrap" }}>{message.text}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div
            style={{
              border: "1px solid #D1FAE5",
              backgroundColor: "#ECFDF5",
              borderRadius: "10px",
              padding: "12px",
              display: "grid",
              gap: "10px",
            }}
          >
            <div>
              <div style={{ color: "#064E3B", fontWeight: 800, fontSize: "0.9rem" }}>Interactive ML Note Coach (Beta)</div>
              <div style={{ color: "#065F46", fontSize: "0.82rem", marginTop: "2px" }}>
                Simulate note quality impact before submitting. The coach estimates quality score and shows what to add for top scoring notes.
              </div>
            </div>

            <div style={{ display: "grid", gap: "8px", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
              <select
                value={coachSelectedUserKey}
                onChange={(event) => setCoachSelectedUserKey(event.target.value)}
                style={filterControlStyle}
              >
                {employeeReportingInsights.length === 0 ? (
                  <option value="">No employees in current filters</option>
                ) : null}
                {employeeReportingInsights.map((employee) => (
                  <option key={employee.userKey} value={employee.userKey}>
                    {employee.userLabel} - Score {employee.qualityScore}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  if (!selectedCoachSampleNote) {
                    return;
                  }
                  setCoachDraftNote(selectedCoachSampleNote);
                }}
                disabled={!selectedCoachSampleNote}
                style={{
                  backgroundColor: selectedCoachSampleNote ? "#065F46" : "#94A3B8",
                  color: "#FFFFFF",
                  border: "none",
                  borderRadius: "8px",
                  padding: "8px 12px",
                  cursor: selectedCoachSampleNote ? "pointer" : "not-allowed",
                  fontWeight: 700,
                }}
              >
                Load Report Note
              </button>
            </div>

            <textarea
              value={coachDraftNote}
              onChange={(event) => setCoachDraftNote(event.target.value)}
              rows={5}
              placeholder="Type a draft note here to get real-time coaching..."
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #A7F3D0",
                borderRadius: "10px",
                backgroundColor: "#FFFFFF",
                color: "#0F172A",
                fontSize: "0.9rem",
                lineHeight: 1.45,
                resize: "vertical",
              }}
            />

            {normalizeValue(coachDraftNote) ? (
              <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
                <div style={{ backgroundColor: "#FFFFFF", border: "1px solid #A7F3D0", borderRadius: "10px", padding: "10px" }}>
                  <div style={{ color: "#065F46", fontSize: "0.8rem", fontWeight: 700 }}>Estimated Note Quality</div>
                  <div style={{ color: "#064E3B", fontSize: "1.4rem", fontWeight: 800 }}>{noteCoachFeedback.noteQualityScore} / 100</div>
                  <div style={{ color: "#047857", fontSize: "0.8rem" }}>
                    Projected employee score: {noteCoachFeedback.projectedEmployeeScore} / 100
                  </div>
                </div>

                <div style={{ backgroundColor: "#FFFFFF", border: "1px solid #A7F3D0", borderRadius: "10px", padding: "10px" }}>
                  <div style={{ color: "#065F46", fontSize: "0.8rem", fontWeight: 700, marginBottom: "6px" }}>Signal Coverage</div>
                  <div style={{ display: "grid", gap: "4px" }}>
                    {noteCoachFeedback.featureChecks.map((feature) => (
                      <div key={feature.label} style={{ color: feature.passed ? "#047857" : "#B91C1C", fontSize: "0.8rem", fontWeight: 600 }}>
                        {feature.passed ? "PASS" : "MISS"} - {feature.label}
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ backgroundColor: "#FFFFFF", border: "1px solid #A7F3D0", borderRadius: "10px", padding: "10px" }}>
                  <div style={{ color: "#065F46", fontSize: "0.8rem", fontWeight: 700, marginBottom: "6px" }}>How To Improve</div>
                  {noteCoachFeedback.missingElements.length > 0 ? (
                    <div style={{ display: "grid", gap: "4px" }}>
                      {noteCoachFeedback.missingElements.slice(0, 6).map((item, index) => (
                        <div key={`${item}-${index}`} style={{ color: "#0F172A", fontSize: "0.82rem" }}>
                          {index + 1}. {item}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ color: "#047857", fontSize: "0.82rem", fontWeight: 600 }}>
                      Excellent structure. Keep this pattern for consistent high scores.
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {normalizeValue(coachDraftNote) ? (
              <div style={{ backgroundColor: "#FFFFFF", border: "1px solid #A7F3D0", borderRadius: "10px", padding: "10px", display: "grid", gap: "8px" }}>
                <div style={{ color: "#065F46", fontSize: "0.8rem", fontWeight: 700 }}>Best-Score Guidance</div>
                <div style={{ display: "grid", gap: "4px" }}>
                  {noteCoachFeedback.coachingAdvice.map((tip, index) => (
                    <div key={`${tip}-${index}`} style={{ color: "#0F172A", fontSize: "0.82rem" }}>
                      {index + 1}. {tip}
                    </div>
                  ))}
                </div>
                <div style={{ color: "#065F46", fontSize: "0.78rem", fontWeight: 700, marginTop: "4px" }}>High-score template</div>
                <div style={{ color: "#0F172A", fontSize: "0.82rem", lineHeight: 1.4 }}>
                  {noteCoachFeedback.bestScoreTemplate}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {cardUserRollup.length === 0 ? (
          <p style={{ marginTop: "12px", color: "#64748B" }}>
            No production card hours found for the current filters.
          </p>
        ) : (
          <div style={{ marginTop: "12px", overflowX: "auto", width: "100%" }}>
            {deleteError ? (
              <div style={{ marginBottom: "12px", color: "#B91C1C", fontWeight: 700 }}>
                {deleteError}
              </div>
            ) : null}
            <table
              style={{
                width: "max(100%, 1080px)",
                minWidth: "100%",
                borderCollapse: "collapse",
                tableLayout: "fixed",
              }}
            >
              <thead>
                <tr style={{ background: "#F8FAFC" }}>
                  <th style={cellHeaderStyle}>Card ID</th>
                  <th style={cellHeaderStyle}>Title</th>
                  <th style={cellHeaderStyle}>Project Name</th>
                  <th style={cellHeaderStyle}>User</th>
                  <th style={cellHeaderStyle}>Log Entries</th>
                  <th style={cellHeaderStyle}>Total Time</th>
                  <th style={cellHeaderStyle}>Start Time</th>
                  <th style={cellHeaderStyle}>End Time</th>
                  <th style={{ ...cellHeaderStyle, width: "220px" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {cardUserRollup.map((row, rowIndex) => {
                  const isEditing = editingRowKey === row.rollupKey;
                  const isAdding = addingRowKey === row.rollupKey;
                  const canEdit = canEditRow(row);
                  return (
                  <React.Fragment key={row.rollupKey}>
                    <tr>
                      <td style={cellStyle}>{row.issueId || "-"}</td>
                      <td style={cellStyle}>
                        <div>
                          {hasTechnicalDetailTitle(row.title)
                            ? `⭐ ${row.title || "-"}`
                            : (row.title || "-")}
                        </div>
                      </td>
                      <td style={cellStyle}>{row.projectName || "-"}</td>
                      <td style={cellStyle}>{row.userLabel || "Unknown user"}</td>
                      <td style={cellStyle}>{row.totalEntries}</td>
                      <td style={cellStyle}>{formatDuration(row.totalDurationMs)}</td>
                      <td style={cellStyle}>
                        {isEditing ? (
                          <input
                            type="datetime-local"
                            value={toDatetimeLocalValue(editStartMs)}
                            onChange={(e) => setEditStartMs(e.target.value ? new Date(e.target.value).getTime() : 0)}
                            style={{ padding: "4px 6px", border: "1px solid #CBD5E1", borderRadius: "6px", fontSize: "0.85rem", width: "100%" }}
                          />
                        ) : (
                          formatTimestamp(row.firstAt)
                        )}
                      </td>
                      <td style={cellStyle}>
                        {isEditing ? (
                          <input
                            type="datetime-local"
                            value={toDatetimeLocalValue(editEndMs)}
                            onChange={(e) => setEditEndMs(e.target.value ? new Date(e.target.value).getTime() : 0)}
                            style={{ padding: "4px 6px", border: "1px solid #CBD5E1", borderRadius: "6px", fontSize: "0.85rem", width: "100%" }}
                          />
                        ) : (
                          formatTimestamp(row.lastAt)
                        )}
                      </td>
                      <td style={{ ...cellStyle, whiteSpace: "nowrap" }}>
                        {isEditing ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                            <button
                              type="button"
                              onClick={() => handleSaveEdit(row)}
                              disabled={editSaving}
                              style={{ backgroundColor: "#0F766E", color: "#FFF", border: "none", borderRadius: "6px", padding: "4px 8px", cursor: editSaving ? "not-allowed" : "pointer", fontSize: "0.8rem", fontWeight: 700 }}
                            >
                              {editSaving ? "Saving…" : "Save"}
                            </button>
                            <button
                              type="button"
                              onClick={() => { setEditingRowKey(null); setEditError(""); }}
                              disabled={editSaving}
                              style={{ backgroundColor: "#64748B", color: "#FFF", border: "none", borderRadius: "6px", padding: "4px 8px", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600 }}
                            >
                              Cancel
                            </button>
                            {editError ? (
                              <span style={{ color: "#B91C1C", fontSize: "0.78rem" }}>{editError}</span>
                            ) : null}
                          </div>
                        ) : canEdit ? (
                          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                            <button
                              type="button"
                              onClick={() => handleStartEdit(row)}
                              style={{ backgroundColor: "transparent", border: "1px solid #CBD5E1", borderRadius: "6px", padding: "4px 8px", cursor: "pointer", fontSize: "0.8rem", color: "#475569" }}
                              title="Edit start/end time"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleStartAdd(row)}
                              style={{ backgroundColor: "transparent", border: "1px solid #93C5FD", borderRadius: "6px", padding: "4px 8px", cursor: "pointer", fontSize: "0.8rem", color: "#1D4ED8" }}
                              title="Add time entry"
                            >
                              Add
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                    {isAdding ? (
                      <tr>
                        <td style={{ ...timeEntryLabelCellStyle, backgroundColor: "#DBEAFE" }}>New Time</td>
                        <td colSpan={8} style={{ ...timeEntryContentCellStyle, backgroundColor: "#EFF6FF", borderLeft: "4px solid #60A5FA" }}>
                          <div style={{ display: "grid", gap: "8px", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", alignItems: "end" }}>
                            <div>
                              <div style={inlineFieldLabelStyle}>Start</div>
                              <input
                                type="datetime-local"
                                value={toDatetimeLocalValue(addStartMs)}
                                onChange={(event) => setAddStartMs(parseDatetimeLocalToMs(event.target.value))}
                                style={inlineFieldInputStyle}
                              />
                            </div>
                            <div>
                              <div style={inlineFieldLabelStyle}>End</div>
                              <input
                                type="datetime-local"
                                value={toDatetimeLocalValue(addEndMs)}
                                onChange={(event) => setAddEndMs(parseDatetimeLocalToMs(event.target.value))}
                                style={inlineFieldInputStyle}
                              />
                            </div>
                            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                              <button
                                type="button"
                                onClick={() => handleSaveAdd(row)}
                                disabled={addSaving}
                                style={{ backgroundColor: "#1D4ED8", color: "#FFF", border: "none", borderRadius: "6px", padding: "8px 10px", cursor: addSaving ? "not-allowed" : "pointer", fontSize: "0.82rem", fontWeight: 700 }}
                              >
                                {addSaving ? "Saving..." : "Save New Time"}
                              </button>
                              <button
                                type="button"
                                onClick={() => { setAddingRowKey(null); setAddError(""); }}
                                disabled={addSaving}
                                style={{ backgroundColor: "#64748B", color: "#FFF", border: "none", borderRadius: "6px", padding: "8px 10px", cursor: "pointer", fontSize: "0.82rem", fontWeight: 600 }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                          {addError ? <div style={{ marginTop: "8px", color: "#B91C1C", fontWeight: 600 }}>{addError}</div> : null}
                        </td>
                      </tr>
                    ) : null}
                    {Array.isArray(row.entries) && row.entries.length > 0 ? (
                      <tr>
                        <td style={{ ...sectionHeaderLabelCellStyle, backgroundColor: "#DBEAFE" }}>Section</td>
                        <td colSpan={8} style={{ ...sectionHeaderContentCellStyle, backgroundColor: "#EFF6FF", borderLeft: "4px solid #2563EB" }}>
                          TIME LOGS
                        </td>
                      </tr>
                    ) : null}
                    {Array.isArray(row.entries) && row.entries.length > 0
                      ? row.entries.map((entry, entryIndex) => (
                          <React.Fragment key={`${row.rollupKey}-entry-row-${entry.id}`}>
                            <tr>
                              <td
                                style={{
                                  ...timeEntryLabelCellStyle,
                                  backgroundColor:
                                    highlightedEntryKey === `${row.rollupKey}::${entry.id}`
                                      ? "#DCFCE7"
                                      : entry.logType === "active"
                                        ? "#D1FAE5"
                                      : entryIndex % 2 === 0
                                        ? "#F8FAFC"
                                        : "#EFF6FF",
                                }}
                              >
                                {highlightedEntryKey === `${row.rollupKey}::${entry.id}`
                                  ? "New Time"
                                  : entry.logType === "active"
                                    ? "In Progress"
                                    : "Time"}
                              </td>
                              <td
                                colSpan={8}
                                style={{
                                  ...timeEntryContentCellStyle,
                                  backgroundColor:
                                    highlightedEntryKey === `${row.rollupKey}::${entry.id}`
                                      ? "#F0FDF4"
                                      : entry.logType === "active"
                                        ? "#ECFDF5"
                                      : entryIndex % 2 === 0
                                        ? "#F8FAFC"
                                        : "#EFF6FF",
                                  borderLeft:
                                    highlightedEntryKey === `${row.rollupKey}::${entry.id}`
                                      ? "4px solid #16A34A"
                                      : entry.logType === "active"
                                        ? "4px solid #059669"
                                      : entryIndex % 2 === 0
                                        ? "4px solid #94A3B8"
                                        : "4px solid #60A5FA",
                                }}
                              >
                                {editingEntryKey === `${row.rollupKey}::${entry.id}` ? (
                                  <div style={{ display: "grid", gap: "8px" }}>
                                    <div style={{ display: "grid", gap: "8px", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", alignItems: "end" }}>
                                      <div>
                                        <div style={inlineFieldLabelStyle}>Start</div>
                                        <input
                                          type="datetime-local"
                                          value={toDatetimeLocalValue(editingEntryStartMs)}
                                          onChange={(event) => setEditingEntryStartMs(parseDatetimeLocalToMs(event.target.value))}
                                          style={inlineFieldInputStyle}
                                        />
                                      </div>
                                      <div>
                                        <div style={inlineFieldLabelStyle}>End</div>
                                        <input
                                          type="datetime-local"
                                          value={toDatetimeLocalValue(editingEntryEndMs)}
                                          onChange={(event) => setEditingEntryEndMs(parseDatetimeLocalToMs(event.target.value))}
                                          style={inlineFieldInputStyle}
                                        />
                                      </div>
                                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                        <button
                                          type="button"
                                          onClick={() => handleSaveEntryEdit(row, entry)}
                                          disabled={editingEntrySaving}
                                          style={{ backgroundColor: "#0F766E", color: "#FFF", border: "none", borderRadius: "6px", padding: "8px 10px", cursor: editingEntrySaving ? "not-allowed" : "pointer", fontSize: "0.82rem", fontWeight: 700 }}
                                        >
                                          {editingEntrySaving ? "Saving..." : "Save Time"}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => { setEditingEntryKey(""); setEditingEntryError(""); }}
                                          disabled={editingEntrySaving}
                                          style={{ backgroundColor: "#64748B", color: "#FFF", border: "none", borderRadius: "6px", padding: "8px 10px", cursor: "pointer", fontSize: "0.82rem", fontWeight: 600 }}
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                    {editingEntryError ? <div style={{ color: "#B91C1C", fontWeight: 600 }}>{editingEntryError}</div> : null}
                                  </div>
                                ) : (
                                  <div style={timeEntryGridRowStyle}>
                                    <div style={timeEntryGridCellStyle}>
                                      <div style={timeEntryColumnLabelStyle}>Start</div>
                                      <div style={timeEntryColumnValueStyle}>{formatTimestamp(entry.startedAt)}</div>
                                    </div>
                                    <div style={timeEntryGridCellStyle}>
                                      <div style={timeEntryColumnLabelStyle}>End</div>
                                      <div style={timeEntryColumnValueStyle}>{formatTimestamp(entry.endedAt)}</div>
                                    </div>
                                    <div style={timeEntryGridCellStyle}>
                                      <div style={timeEntryColumnLabelStyle}>Total</div>
                                      <div style={timeEntryColumnValueStyle}>{formatDurationHoursMinutes(entry.durationMs)}</div>
                                      <div style={timeEntrySubValueStyle}>{formatDuration(entry.durationMs)}</div>
                                    </div>
                                    <div style={timeEntryGridCellStyle}>
                                      <div style={timeEntryColumnLabelStyle}>Type</div>
                                      <div style={entry.logType === "active" ? timeEntryActiveTypeStyle : timeEntryColumnValueStyle}>
                                        {entry.logType === "active" ? "Active Timer" : "Log Entry"}
                                      </div>
                                    </div>
                                    <div style={{ ...timeEntryGridCellStyle, alignItems: "flex-end" }}>
                                      <div style={timeEntryColumnLabelStyle}>Actions</div>
                                      {canEdit ? (
                                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                                          {entry.collection === "timeRotateLogs" ? (
                                            <button
                                              type="button"
                                              onClick={() => handleStartEntryEdit(row, entry)}
                                              style={{ backgroundColor: "transparent", border: "1px solid #CBD5E1", borderRadius: "6px", padding: "4px 8px", cursor: "pointer", fontSize: "0.8rem", color: "#475569" }}
                                            >
                                              Edit
                                            </button>
                                          ) : null}
                                          <button
                                            type="button"
                                            onClick={() => handleDeleteEntry(row, entry)}
                                            disabled={deleteRowKey === `${row.rollupKey}::${entry.id}`}
                                            style={{ backgroundColor: "transparent", border: "1px solid #FECACA", borderRadius: "6px", padding: "4px 8px", cursor: deleteRowKey === `${row.rollupKey}::${entry.id}` ? "not-allowed" : "pointer", fontSize: "0.8rem", color: "#B91C1C" }}
                                          >
                                            {deleteRowKey === `${row.rollupKey}::${entry.id}` ? "Deleting..." : "Delete"}
                                          </button>
                                        </div>
                                      ) : (
                                        <div style={timeEntrySubValueStyle}>No actions</div>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </td>
                            </tr>
                            {entryIndex < row.entries.length - 1 ? (
                              <tr>
                                <td style={timeLogSpacerLabelCellStyle}></td>
                                <td colSpan={8} style={timeLogSpacerContentCellStyle}></td>
                              </tr>
                            ) : null}
                            {Array.isArray(entry.notes) && entry.notes.length > 0
                              ? entry.notes.map((note, noteIndex) => (
                                  <tr key={`${row.rollupKey}-entry-${entry.id}-note-${noteIndex}`}>
                                    <td
                                      style={{
                                        ...noteRowLabelCellStyle,
                                        backgroundColor: "#FFFBEB",
                                      }}
                                    >
                                      Note
                                    </td>
                                    <td
                                      colSpan={8}
                                      style={{
                                        ...noteRowContentCellStyle,
                                        backgroundColor: "#FFFBEB",
                                        borderLeft: "4px solid #F59E0B",
                                      }}
                                    >
                                      <span style={noteTimestampStyle}>
                                        {note.timestamp ? formatTimestamp(note.timestamp) : "No timestamp"}
                                      </span>
                                      <span style={noteTextStyle}>{note.text}</span>
                                    </td>
                                  </tr>
                                ))
                              : null}
                          </React.Fragment>
                        ))
                      : null}
                    {rowIndex < cardUserRollup.length - 1 ? (
                      <tr>
                        <td style={cardBlockDividerLabelStyle}>Card</td>
                        <td colSpan={8} style={cardBlockDividerContentStyle}>
                          Next Card/User Block
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

const filterControlStyle = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #CBD5E1",
  borderRadius: "8px",
  backgroundColor: "#FFFFFF",
};

const cellHeaderStyle = {
  textAlign: "left",
  padding: "12px",
  borderBottom: "1px solid #E2E8F0",
  color: "#0F172A",
  fontSize: "0.9rem",
};

const cellStyle = {
  padding: "12px",
  borderBottom: "1px solid #E2E8F0",
  color: "#334155",
  fontSize: "0.92rem",
  verticalAlign: "top",
  overflowWrap: "anywhere",
  wordBreak: "break-word",
};

const noteRowLabelCellStyle = {
  padding: "8px 12px",
  borderBottom: "1px solid #E2E8F0",
  color: "#475569",
  fontSize: "0.82rem",
  fontWeight: 700,
  textAlign: "left",
  verticalAlign: "top",
  backgroundColor: "#F8FAFC",
  whiteSpace: "nowrap",
};

const timeEntryLabelCellStyle = {
  padding: "8px 12px",
  borderBottom: "1px solid #E2E8F0",
  color: "#1E3A8A",
  fontSize: "0.82rem",
  fontWeight: 700,
  textAlign: "left",
  verticalAlign: "top",
  whiteSpace: "nowrap",
};

const noteRowContentCellStyle = {
  padding: "8px 12px",
  borderBottom: "1px solid #E2E8F0",
  color: "#334155",
  fontSize: "0.84rem",
  lineHeight: 1.4,
  textAlign: "left",
  backgroundColor: "#F8FAFC",
  overflowWrap: "anywhere",
  wordBreak: "break-word",
};

const timeEntryContentCellStyle = {
  padding: "8px 12px",
  borderBottom: "1px solid #E2E8F0",
  color: "#1F2937",
  fontSize: "0.84rem",
  lineHeight: 1.4,
  textAlign: "left",
  overflowWrap: "anywhere",
  wordBreak: "break-word",
};

const sectionHeaderLabelCellStyle = {
  padding: "6px 12px",
  borderBottom: "1px solid #E2E8F0",
  color: "#0F172A",
  fontSize: "0.78rem",
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  whiteSpace: "nowrap",
};

const sectionHeaderContentCellStyle = {
  padding: "6px 12px",
  borderBottom: "1px solid #E2E8F0",
  color: "#0F172A",
  fontSize: "0.78rem",
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

const timeLogSpacerLabelCellStyle = {
  padding: 0,
  height: "10px",
  borderBottom: "none",
  backgroundColor: "#FFFFFF",
};

const timeLogSpacerContentCellStyle = {
  padding: 0,
  height: "10px",
  borderBottom: "none",
  backgroundColor: "#FFFFFF",
};

const cardBlockDividerLabelStyle = {
  padding: "10px 12px",
  borderBottom: "none",
  color: "#475569",
  fontSize: "0.78rem",
  fontWeight: 800,
  backgroundColor: "#E2E8F0",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const cardBlockDividerContentStyle = {
  padding: "10px 12px",
  borderBottom: "none",
  color: "#334155",
  fontSize: "0.78rem",
  fontWeight: 700,
  backgroundColor: "#E2E8F0",
  borderLeft: "4px solid #64748B",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const noteTimestampStyle = {
  display: "inline-block",
  minWidth: "170px",
  color: "#0F172A",
  fontWeight: 700,
  marginRight: "10px",
  verticalAlign: "top",
  textAlign: "left",
};

const noteTextStyle = {
  color: "#334155",
  textAlign: "left",
};

const timeEntryMetaStyle = {
  color: "#334155",
  fontSize: "0.82rem",
  fontWeight: 600,
};

const timeEntryGridRowStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(170px, 1.2fr) minmax(170px, 1.2fr) minmax(150px, 1fr) minmax(120px, 0.9fr) minmax(140px, auto)",
  gap: "14px",
  alignItems: "start",
};

const timeEntryGridCellStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  minWidth: 0,
};

const timeEntryColumnLabelStyle = {
  color: "#64748B",
  fontSize: "0.74rem",
  fontWeight: 800,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
};

const timeEntryColumnValueStyle = {
  color: "#0F172A",
  fontSize: "0.87rem",
  fontWeight: 700,
};

const timeEntryActiveTypeStyle = {
  color: "#065F46",
  backgroundColor: "#D1FAE5",
  border: "1px solid #6EE7B7",
  borderRadius: "999px",
  padding: "3px 10px",
  fontSize: "0.8rem",
  fontWeight: 800,
  display: "inline-block",
};

const timeEntrySubValueStyle = {
  color: "#475569",
  fontSize: "0.78rem",
  fontWeight: 600,
};

const timeEntryTotalBadgeStyle = {
  color: "#1E3A8A",
  backgroundColor: "#DBEAFE",
  border: "1px solid #93C5FD",
  borderRadius: "999px",
  padding: "3px 10px",
  fontSize: "0.8rem",
  fontWeight: 800,
};

const inlineFieldLabelStyle = {
  color: "#334155",
  fontSize: "0.8rem",
  fontWeight: 700,
  marginBottom: "4px",
};

const inlineFieldInputStyle = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #CBD5E1",
  borderRadius: "8px",
  backgroundColor: "#FFFFFF",
  fontSize: "0.85rem",
};

export default TimeRotateCardHours;
