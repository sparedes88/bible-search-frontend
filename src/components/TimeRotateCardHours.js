import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
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

const normalizeProjectMatchKey = (value) => normalizeKey(value);

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

const parseProjectIssueNotes = (value) => {
  if (!Array.isArray(value)) return [];

  return value
    .map((note) => {
      const attachmentCount = Array.isArray(note?.attachments) ? note.attachments.length : 0;
      const rawText = normalizeValue(note?.text);
      const text = rawText || (attachmentCount > 0
        ? `Attachment update (${attachmentCount} file${attachmentCount === 1 ? "" : "s"})`
        : "");

      const createdAtMs =
        toTimestampMs(note?.createdAt) ||
        toTimestampMs(note?.timestamp) ||
        (() => {
          const parsed = Date.parse(normalizeValue(note?.createdAtIso));
          return Number.isFinite(parsed) ? parsed : 0;
        })();

      const activityType = /^progress update:/i.test(rawText)
        ? "Progress Added"
        : "Note Added";
      const completionPercentMatch = rawText.match(/^progress update:\s*\d+\s*%\s*->\s*(\d+)\s*%/i);
      const completionPercent = completionPercentMatch ? Number(completionPercentMatch[1]) : null;

      return {
        text,
        activityType,
        completionPercent: Number.isFinite(completionPercent) ? completionPercent : null,
        createdAtMs,
        createdByUid: normalizeValue(note?.createdByUid),
        createdByEmail: normalizeValue(note?.createdByEmail),
        createdByName: normalizeValue(note?.createdByName),
      };
    })
    .filter((note) => note.text);
};

const normalizeIssueIdentifier = (value) =>
  normalizeValue(value)
    .replace(/^#+/, "")
    .toLowerCase();

const getProjectIssueProgressCompletionState = (note = {}) => {
  return Number(note?.completionPercent) >= 100 ? "completed" : "incomplete";
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

const getDayKeyFromTimestamp = (value) => {
  const timestamp = Number(value) || 0;
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const formatDayHeaderLabel = (value) => {
  const timestamp = Number(value) || 0;
  if (!timestamp) return "Date unavailable";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Date unavailable";

  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

const getDateBlockPalette = (dayKey) => {
  const palettes = [
    { blockBg: "#EFF6FF", headerBg: "#1E3A8A", border: "#60A5FA" },
    { blockBg: "#ECFDF5", headerBg: "#065F46", border: "#34D399" },
    { blockBg: "#FEF3C7", headerBg: "#92400E", border: "#F59E0B" },
    { blockBg: "#F5F3FF", headerBg: "#5B21B6", border: "#A78BFA" },
  ];

  const normalizedDayKey = String(dayKey || "");
  const hashValue = normalizedDayKey
    .split("")
    .reduce((sum, character) => sum + character.charCodeAt(0), 0);

  return palettes[hashValue % palettes.length];
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

const getWeekStartDateFromTimestamp = (timestamp) => {
  const parsed = new Date(Number(timestamp) || 0);
  if (Number.isNaN(parsed.getTime())) return null;
  const baseDate = startOfDay(parsed);
  const mondayOffset = (baseDate.getDay() + 6) % 7;
  baseDate.setDate(baseDate.getDate() - mondayOffset);
  return baseDate;
};

const buildWeekLabel = (weekStartDate, weekEndDate) => {
  if (!(weekStartDate instanceof Date) || Number.isNaN(weekStartDate.getTime())) return "Unknown week";
  if (!(weekEndDate instanceof Date) || Number.isNaN(weekEndDate.getTime())) return "Unknown week";

  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return `${formatter.format(weekStartDate)} - ${formatter.format(weekEndDate)}`;
};

const buildWeeklyApprovalDocId = (userKey, weekKey) => {
  const safeUserKey = encodeURIComponent(normalizeValue(userKey) || "unknown-user");
  const safeWeekKey = normalizeValue(weekKey) || "unknown-week";
  return `${safeUserKey}__${safeWeekKey}`;
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
    case "lastWeek": {
      const currentWeekStart = addDays(today, -today.getDay());
      const previousWeekStart = addDays(currentWeekStart, -7);
      const previousWeekEnd = addDays(currentWeekStart, -1);
      return {
        startDate: formatDateInputValue(previousWeekStart),
        endDate: formatDateInputValue(previousWeekEnd),
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
  { value: "lastWeek", label: "Last Week" },
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
  const [selectedRowStatus, setSelectedRowStatus] = useState("both");
  const [projectIssueProgressStatusFilter, setProjectIssueProgressStatusFilter] = useState("both");
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
  const [editingNoteKey, setEditingNoteKey] = useState("");
  const [editingNoteText, setEditingNoteText] = useState("");
  const [editingNoteSaving, setEditingNoteSaving] = useState(false);
  const [editingNoteError, setEditingNoteError] = useState("");
  const [addingNoteKey, setAddingNoteKey] = useState("");
  const [addingNoteText, setAddingNoteText] = useState("");
  const [addingNoteSaving, setAddingNoteSaving] = useState(false);
  const [addingNoteError, setAddingNoteError] = useState("");
  const [weeklyApprovalsByKey, setWeeklyApprovalsByKey] = useState({});
  const [selectedReviewWeekKey, setSelectedReviewWeekKey] = useState("");
  const [approvingWeekKey, setApprovingWeekKey] = useState("");
  const [weeklyApprovalError, setWeeklyApprovalError] = useState("");
  const [weeklyApprovalNotice, setWeeklyApprovalNotice] = useState("");
  const [isWeeklyApprovalDialogOpen, setIsWeeklyApprovalDialogOpen] = useState(false);
  const [weeklyApprovalAiLoading, setWeeklyApprovalAiLoading] = useState(false);
  const [weeklyApprovalAiReady, setWeeklyApprovalAiReady] = useState(false);
  const [weeklyApprovalAiSummary, setWeeklyApprovalAiSummary] = useState("");
  const [weeklyApprovalAiAdjustments, setWeeklyApprovalAiAdjustments] = useState([]);
  const [weeklyApprovalAiRawFeedback, setWeeklyApprovalAiRawFeedback] = useState("");
  const [weeklyApprovalConfirmedByUser, setWeeklyApprovalConfirmedByUser] = useState(false);
  const [weeklyApprovalActionItems, setWeeklyApprovalActionItems] = useState([]);
  const [weeklyApprovalDraftByKey, setWeeklyApprovalDraftByKey] = useState({});
  const [weeklyApprovalSavingKey, setWeeklyApprovalSavingKey] = useState("");
  const [weeklyApprovalDraftError, setWeeklyApprovalDraftError] = useState("");
  const [weeklyApprovalDraftNotice, setWeeklyApprovalDraftNotice] = useState("");
  const [projectIssueProgressNotes, setProjectIssueProgressNotes] = useState([]);
  const [projectIssueProgressLoading, setProjectIssueProgressLoading] = useState(false);
  const [projectIssueProgressError, setProjectIssueProgressError] = useState("");

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
    if (!id) {
      setWeeklyApprovalsByKey({});
      return () => {};
    }

    const unsubscribe = onSnapshot(collection(db, "churches", id, "timeRotateWeeklyApprovals"), (snapshot) => {
      const nextMap = {};

      snapshot.docs.forEach((approvalDoc) => {
        const approvalData = approvalDoc.data() || {};
        const userKey = normalizeValue(approvalData.userKey);
        const weekKey = normalizeValue(approvalData.weekKey);
        if (!userKey || !weekKey) return;

        nextMap[`${userKey}::${weekKey}`] = {
          id: approvalDoc.id,
          approvedAt: Number(approvalData.approvedAt) || 0,
          approvedByLabel: normalizeValue(approvalData.approvedByLabel),
        };
      });

      setWeeklyApprovalsByKey(nextMap);
    });

    return () => unsubscribe();
  }, [id]);

  useEffect(() => {
    if (!id) {
      setProjectIssueProgressNotes([]);
      setProjectIssueProgressLoading(false);
      setProjectIssueProgressError("");
      return;
    }

    let isCancelled = false;

    const loadProjectIssueProgressNotes = async () => {
      setProjectIssueProgressLoading(true);
      setProjectIssueProgressError("");

      try {
        const projectsSnapshot = await getDocs(collection(db, "churches", id, "projectListIssueProjects"));
        const projectRows = await Promise.all(
          projectsSnapshot.docs.map(async (projectDoc) => {
            const projectData = projectDoc.data() || {};
            const projectId = projectDoc.id;
            const projectName = normalizeValue(projectData.name) || "Untitled Project";
            const issuesSnapshot = await getDocs(collection(db, "churches", id, "projectListIssueProjects", projectId, "issues"));

            const issueRows = [];

            issuesSnapshot.docs.forEach((issueDoc) => {
              const issueData = issueDoc.data() || {};
              const issueIdentifier = normalizeValue(issueData.issueNumber || issueDoc.id);
              const issueTitle = normalizeValue(issueData.title);

              parseProjectIssueNotes(issueData.notes).forEach((note, noteIndex) => {
                issueRows.push({
                  id: `${projectId}::${issueDoc.id}::${noteIndex}::${note.createdAtMs || 0}`,
                  projectId,
                  projectName,
                  issueId: issueIdentifier,
                  issueTitle,
                  activityType: note.activityType,
                  completionPercent: note.completionPercent,
                  noteText: note.text,
                  createdAtMs: note.createdAtMs,
                  createdByUid: note.createdByUid,
                  createdByEmail: note.createdByEmail,
                  createdByName: note.createdByName,
                });
              });
            });

            return issueRows;
          })
        );

        if (isCancelled) return;

        setProjectIssueProgressNotes(
          projectRows
            .flat()
            .sort((left, right) => (right.createdAtMs || 0) - (left.createdAtMs || 0))
        );
      } catch (loadError) {
        if (isCancelled) return;
        setProjectIssueProgressNotes([]);
        setProjectIssueProgressError(normalizeValue(loadError?.message) || "Could not load project progress notes.");
      } finally {
        if (!isCancelled) {
          setProjectIssueProgressLoading(false);
        }
      }
    };

    loadProjectIssueProgressNotes();

    return () => {
      isCancelled = true;
    };
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

  const getOrganizationUserMatch = useCallback((entry) => {
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
  }, [organizationUsers]);

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

  const selectedReviewUser = useMemo(() => {
    const selectedComparable = normalizeComparable(selectedUser);
    if (!selectedComparable) return null;
    return allUsers.find((entry) => normalizeComparable(entry.userId) === selectedComparable) || null;
  }, [allUsers, selectedUser]);

  const selectedReviewUserKey = useMemo(() => {
    return normalizeValue(selectedReviewUser?.userId || selectedUser);
  }, [selectedReviewUser, selectedUser]);

  const selectedReviewUserAliases = useMemo(() => {
    const aliases = [
      selectedReviewUser?.userId,
      selectedReviewUser?.email,
      selectedReviewUser?.label,
      ...(Array.isArray(selectedReviewUser?.aliases) ? selectedReviewUser.aliases : []),
    ]
      .map((value) => normalizeComparable(value))
      .filter(Boolean);

    return new Set(aliases);
  }, [selectedReviewUser]);

  const selectedFilterUserAliases = useMemo(() => {
    if (!selectedUser) return new Set();

    const selectedComparable = normalizeComparable(selectedUser);
    const selectedUserEntry = allUsers.find((entry) => {
      const entryAliases = [
        entry?.userId,
        entry?.email,
        entry?.label,
        ...(Array.isArray(entry?.aliases) ? entry.aliases : []),
      ]
        .map((value) => normalizeComparable(value))
        .filter(Boolean);

      return entryAliases.includes(selectedComparable);
    });

    return new Set(
      [
        selectedUser,
        selectedUserEntry?.userId,
        selectedUserEntry?.email,
        selectedUserEntry?.label,
        ...(Array.isArray(selectedUserEntry?.aliases) ? selectedUserEntry.aliases : []),
      ]
        .map((value) => normalizeComparable(value))
        .filter(Boolean)
    );
  }, [allUsers, selectedUser]);

  const weeklyReviewRows = useMemo(() => {
    if (!selectedReviewUser || selectedReviewUserAliases.size === 0) return [];

    const weekMap = {};

    timeLog
      .filter((entry) => Number(entry.durationMs) > 0)
      .forEach((entry) => {
        const matchedUser = getOrganizationUserMatch(entry);
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

        const matchesSelectedUser = entryAliases.some((alias) => selectedReviewUserAliases.has(alias));
        if (!matchesSelectedUser) return;

        const eventTimestamp = getEntryTimestamp(entry);
        const weekStartDate = getWeekStartDateFromTimestamp(eventTimestamp);
        if (!weekStartDate) return;

        const weekStartKey = formatDateInputValue(weekStartDate);
        const weekEndDate = addDays(weekStartDate, 6);
        const weekEndKey = formatDateInputValue(weekEndDate);
        const weekMapKey = weekStartKey;

        if (!weekMap[weekMapKey]) {
          weekMap[weekMapKey] = {
            weekKey: weekStartKey,
            weekStartDate,
            weekEndDate,
            startDate: weekStartKey,
            endDate: weekEndKey,
            label: buildWeekLabel(weekStartDate, weekEndDate),
            totalLogs: 0,
            totalDurationMs: 0,
            missingNoteLogs: 0,
          };
        }

        weekMap[weekMapKey].totalLogs += 1;
        weekMap[weekMapKey].totalDurationMs += Math.max(0, Number(entry.durationMs) || 0);

        const hasAnyNote = Array.isArray(entry.notes)
          && entry.notes.some((note) => normalizeValue(note?.text));
        if (!hasAnyNote) {
          weekMap[weekMapKey].missingNoteLogs += 1;
        }
      });

    return Object.values(weekMap)
      .map((weekRow) => {
        const approvalKey = `${selectedReviewUserKey}::${weekRow.weekKey}`;
        const approval = weeklyApprovalsByKey[approvalKey] || null;
        return {
          ...weekRow,
          isApproved: Boolean(approval),
          approvedAt: approval?.approvedAt || 0,
          approvedByLabel: approval?.approvedByLabel || "",
        };
      })
      .sort((left, right) => {
        if (left.isApproved !== right.isApproved) {
          return left.isApproved ? 1 : -1;
        }
        return right.weekKey.localeCompare(left.weekKey);
      });
  }, [getOrganizationUserMatch, selectedReviewUser, selectedReviewUserAliases, selectedReviewUserKey, timeLog, weeklyApprovalsByKey]);

  const selectedWeeklyReviewRow = useMemo(() => {
    if (!selectedReviewWeekKey) return null;
    return weeklyReviewRows.find((row) => row.weekKey === selectedReviewWeekKey) || null;
  }, [selectedReviewWeekKey, weeklyReviewRows]);

  const selectedWeeklyReviewEntries = useMemo(() => {
    if (!selectedWeeklyReviewRow || selectedReviewUserAliases.size === 0) return [];

    return timeLog
      .filter((entry) => Number(entry.durationMs) > 0)
      .filter((entry) => {
        const matchedUser = getOrganizationUserMatch(entry);
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

        return entryAliases.some((alias) => selectedReviewUserAliases.has(alias));
      })
      .filter((entry) => {
        const eventTimestamp = getEntryTimestamp(entry);
        const weekStartDate = getWeekStartDateFromTimestamp(eventTimestamp);
        if (!weekStartDate) return false;
        return formatDateInputValue(weekStartDate) === selectedWeeklyReviewRow.weekKey;
      })
      .map((entry) => ({
        ...entry,
        eventTimestamp: getEntryTimestamp(entry),
      }))
      .sort((left, right) => (left.eventTimestamp || 0) - (right.eventTimestamp || 0));
  }, [getOrganizationUserMatch, selectedReviewUserAliases, selectedWeeklyReviewRow, timeLog]);

  const selectedWeeklyProgressNotes = useMemo(() => {
    if (!selectedWeeklyReviewRow || selectedReviewUserAliases.size === 0) return [];

    const weekStartTimestamp = toStartOfDayTimestamp(selectedWeeklyReviewRow.startDate);
    const weekEndTimestamp = toEndOfDayTimestamp(selectedWeeklyReviewRow.endDate);

    return projectIssueProgressNotes
      .filter((note) => {
        const noteTimestamp = Number(note.createdAtMs) || 0;
        if (!noteTimestamp) return false;
        if (!Number.isNaN(weekStartTimestamp) && noteTimestamp < weekStartTimestamp) return false;
        if (!Number.isNaN(weekEndTimestamp) && noteTimestamp > weekEndTimestamp) return false;

        const noteUserAliases = [note.createdByUid, note.createdByEmail, note.createdByName]
          .map((value) => normalizeComparable(value))
          .filter(Boolean);

        return noteUserAliases.some((alias) => selectedReviewUserAliases.has(alias));
      })
      .sort((left, right) => (right.createdAtMs || 0) - (left.createdAtMs || 0));
  }, [projectIssueProgressNotes, selectedReviewUserAliases, selectedWeeklyReviewRow]);

  const selectedWeeklyProgressSummary = useMemo(() => {
    const issueIds = new Set();
    const projectNames = new Set();
    const completedIssueIds = new Set();

    selectedWeeklyProgressNotes.forEach((note) => {
      const issueId = normalizeValue(note.issueId);
      const projectName = normalizeValue(note.projectName);
      if (issueId) issueIds.add(issueId);
      if (projectName) projectNames.add(projectName);
      if (issueId && Number(note.completionPercent) >= 100) {
        completedIssueIds.add(issueId);
      }
    });

    return {
      noteCount: selectedWeeklyProgressNotes.length,
      issueCount: issueIds.size,
      projectCount: projectNames.size,
      completedIssueCount: completedIssueIds.size,
    };
  }, [selectedWeeklyProgressNotes]);

  useEffect(() => {
    setIsWeeklyApprovalDialogOpen(false);
    setWeeklyApprovalAiLoading(false);
    setWeeklyApprovalAiReady(false);
    setWeeklyApprovalAiSummary("");
    setWeeklyApprovalAiAdjustments([]);
    setWeeklyApprovalAiRawFeedback("");
    setWeeklyApprovalConfirmedByUser(false);
    setWeeklyApprovalActionItems([]);
    setWeeklyApprovalDraftByKey({});
    setWeeklyApprovalSavingKey("");
    setWeeklyApprovalDraftError("");
    setWeeklyApprovalDraftNotice("");
  }, [selectedReviewUserKey, selectedReviewWeekKey]);

  useEffect(() => {
    if (weeklyReviewRows.length === 0) {
      setSelectedReviewWeekKey("");
      return;
    }

    const hasCurrentSelection = weeklyReviewRows.some((row) => row.weekKey === selectedReviewWeekKey);
    if (hasCurrentSelection) return;

    const firstUnapproved = weeklyReviewRows.find((row) => !row.isApproved);
    setSelectedReviewWeekKey((firstUnapproved || weeklyReviewRows[0]).weekKey);
  }, [selectedReviewWeekKey, weeklyReviewRows]);

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
      ...projectIssueProgressNotes.map((entry) => normalizeValue(entry.projectName)),
    ];

    return names
      .filter((projectName) => {
        if (!projectName || seenProjects.has(projectName)) return false;
        seenProjects.add(projectName);
        return true;
      })
      .sort((left, right) => left.localeCompare(right))
      .map((projectName) => ({ value: projectName, label: projectName }));
  }, [activeTimers, productionCards, projectIssueProgressNotes, timeLog]);

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

  const importedProjectIssueProgressNotes = useMemo(() => {
    if (projectIssueProgressNotes.length === 0) return [];

    const startTimestamp = toStartOfDayTimestamp(startDate);
    const endTimestamp = toEndOfDayTimestamp(endDate);
    const selectedUserAliasSet = new Set(Array.from(selectedFilterUserAliases || []));
    const selectedProjectMatchKey = normalizeProjectMatchKey(selectedProject);

    return projectIssueProgressNotes
      .filter((note) => {
        const noteTimestamp = Number(note.createdAtMs) || 0;
        if (!noteTimestamp) return false;
        if (!Number.isNaN(startTimestamp) && noteTimestamp < startTimestamp) return false;
        if (!Number.isNaN(endTimestamp) && noteTimestamp > endTimestamp) return false;

        const projectKey = normalizeProjectMatchKey(note.projectName);
        if (selectedProjectMatchKey) {
          if (projectKey !== selectedProjectMatchKey) return false;
        }

        if (selectedUserAliasSet.size > 0) {
          const noteUserAliases = [note.createdByUid, note.createdByEmail, note.createdByName]
            .map((value) => normalizeComparable(value))
            .filter(Boolean);
          if (!noteUserAliases.some((alias) => selectedUserAliasSet.has(alias))) return false;
        }

        return true;
      })
      .sort((left, right) => (right.createdAtMs || 0) - (left.createdAtMs || 0));
  }, [endDate, projectIssueProgressNotes, selectedFilterUserAliases, selectedProject, startDate]);

  const visibleImportedProjectIssueProgressNotes = useMemo(() => {
    if (projectIssueProgressStatusFilter === "both") {
      return importedProjectIssueProgressNotes;
    }

    return importedProjectIssueProgressNotes.filter((note) => {
      return getProjectIssueProgressCompletionState(note) === projectIssueProgressStatusFilter;
    });
  }, [importedProjectIssueProgressNotes, projectIssueProgressStatusFilter]);

  const importedProjectIssueProgressSummary = useMemo(() => {
    const issueIds = new Set();
    const completedIssueIds = new Set();
    const projectNames = new Set();
    let progressUpdateCount = 0;
    let noteCount = 0;

    visibleImportedProjectIssueProgressNotes.forEach((note) => {
      const issueId = normalizeValue(note.issueId);
      const projectName = normalizeValue(note.projectName);
      if (issueId) issueIds.add(issueId);
      if (projectName) projectNames.add(projectName);
      if (note.activityType === "Progress Added") {
        progressUpdateCount += 1;
      } else {
        noteCount += 1;
      }
      if (issueId && Number(note.completionPercent) >= 100) {
        completedIssueIds.add(issueId);
      }
    });

    return {
      issueCount: issueIds.size,
      completedIssueCount: completedIssueIds.size,
      projectCount: projectNames.size,
      progressUpdateCount,
      noteCount,
    };
  }, [visibleImportedProjectIssueProgressNotes]);

  const selectedWeeklyImportedProgressNotes = useMemo(() => {
    if (!selectedWeeklyReviewRow) return [];

    const weekStartTimestamp = toStartOfDayTimestamp(selectedWeeklyReviewRow.startDate);
    const weekEndTimestamp = toEndOfDayTimestamp(selectedWeeklyReviewRow.endDate);

    return importedProjectIssueProgressNotes.filter((note) => {
      const noteTimestamp = Number(note.createdAtMs) || 0;
      if (!noteTimestamp) return false;
      if (!Number.isNaN(weekStartTimestamp) && noteTimestamp < weekStartTimestamp) return false;
      if (!Number.isNaN(weekEndTimestamp) && noteTimestamp > weekEndTimestamp) return false;
      return true;
    });
  }, [importedProjectIssueProgressNotes, selectedWeeklyReviewRow]);

  const selectedWeeklyImportedProgressSummary = useMemo(() => {
    const issueIds = new Set();
    const completedIssueIds = new Set();
    const projectNames = new Set();
    let progressUpdateCount = 0;
    let noteCount = 0;

    selectedWeeklyImportedProgressNotes.forEach((note) => {
      const issueId = normalizeValue(note.issueId);
      const projectName = normalizeValue(note.projectName);
      if (issueId) issueIds.add(issueId);
      if (projectName) projectNames.add(projectName);
      if (note.activityType === "Progress Added") {
        progressUpdateCount += 1;
      } else {
        noteCount += 1;
      }
      if (issueId && Number(note.completionPercent) >= 100) {
        completedIssueIds.add(issueId);
      }
    });

    return {
      issueCount: issueIds.size,
      completedIssueCount: completedIssueIds.size,
      projectCount: projectNames.size,
      progressUpdateCount,
      noteCount,
    };
  }, [selectedWeeklyImportedProgressNotes]);

  const cardUserRollup = useMemo(() => {
    const rollupMap = {};

    filteredTimerLogs.forEach((entry) => {
      const issueId = normalizeValue(entry.issueId);
      const card = productionCardMapByIssueId[issueId] || {};
      const matchedUser = getOrganizationUserMatch(entry);
      const userKey = normalizeValue(matchedUser?.userId) || normalizeValue(entry.userId) || normalizeValue(entry.registeredBy) || "unknown-user";
      const userLabel = normalizeValue(matchedUser?.label) || normalizeValue(entry.registeredBy) || "Unknown user";
      const userEmail = normalizeValue(matchedUser?.email) || normalizeValue(entry.userEmail);
      const entryStartTimestamp = toTimestampMs(entry?.startedAt) || getEntryTimestamp(entry);
      const entryEndTimestamp =
        toTimestampMs(entry?.endedAt) ||
        toTimestampMs(entry?.completionAt) ||
        (entryStartTimestamp > 0
          ? entryStartTimestamp + Math.max(0, Number(entry?.durationMs) || 0)
          : getEntryTimestamp(entry));
      const entryDayKey = getDayKeyFromTimestamp(entryStartTimestamp || entryEndTimestamp || getEntryTimestamp(entry)) || "unknown-day";
      const rollupKey = `${issueId}::${userKey}::${entryDayKey}`;

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
              if ((left.startedAt || 0) !== (right.startedAt || 0)) {
                return (left.startedAt || 0) - (right.startedAt || 0);
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
      if ((left.firstAt || 0) !== (right.firstAt || 0)) {
        return (left.firstAt || 0) - (right.firstAt || 0);
      }
      if (left.issueId !== right.issueId) {
        return left.issueId.localeCompare(right.issueId);
      }
      if (left.userLabel !== right.userLabel) {
        return left.userLabel.localeCompare(right.userLabel);
      }
      return String(left.rollupKey || "").localeCompare(String(right.rollupKey || ""));
      });
  }, [filteredTimerLogs, productionCardMapByIssueId, organizationUsers]);

  const visibleCardUserRollup = useMemo(() => {
    if (selectedRowStatus === "both") {
      return cardUserRollup;
    }

    return cardUserRollup.filter((row) => {
      const hasActiveTimer = Array.isArray(row.entries) && row.entries.some((entry) => entry.logType === "active");
      const rowStatus = hasActiveTimer ? "open" : "closed";
      return rowStatus === selectedRowStatus;
    });
  }, [cardUserRollup, selectedRowStatus]);

  const projectIssueProgressByRollupKey = useMemo(() => {
    if (visibleCardUserRollup.length === 0 || importedProjectIssueProgressNotes.length === 0) return {};

    const rowsByKey = {};

    visibleCardUserRollup.forEach((row) => {
      const rowProjectKey = normalizeComparable(row.projectName);
      const rowIssueKey = normalizeIssueIdentifier(row.issueId);
      const rowDayKey = getDayKeyFromTimestamp(row.firstAt || row.lastAt);
      const rowUserAliases = new Set(
        [row.userKey, row.userEmail, row.userLabel]
          .map((value) => normalizeComparable(value))
          .filter(Boolean)
      );

      if (!rowProjectKey || rowUserAliases.size === 0) {
        rowsByKey[row.rollupKey] = [];
        return;
      }

      const matchingNotes = importedProjectIssueProgressNotes.filter((note) => {
        if (normalizeComparable(note.projectName) !== rowProjectKey) return false;

        const noteUserAliases = [note.createdByUid, note.createdByEmail, note.createdByName]
          .map((value) => normalizeComparable(value))
          .filter(Boolean);
        if (!noteUserAliases.some((alias) => rowUserAliases.has(alias))) return false;

        const sameDay = getDayKeyFromTimestamp(note.createdAtMs) === rowDayKey;

        return sameDay;
      });

      rowsByKey[row.rollupKey] = matchingNotes.slice(0, 6);
    });

    return rowsByKey;
  }, [importedProjectIssueProgressNotes, visibleCardUserRollup]);

  const totalDurationAllRows = useMemo(() => {
    return visibleCardUserRollup.reduce((sum, row) => sum + (Number(row.totalDurationMs) || 0), 0);
  }, [visibleCardUserRollup]);

  const filteredProjectRollup = useMemo(() => {
    const projectMap = {};

    visibleCardUserRollup.forEach((row) => {
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
  }, [visibleCardUserRollup]);

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

  const handleSelectWeeklyReviewRow = (weekRow) => {
    if (!weekRow) return;
    setSelectedReviewWeekKey(weekRow.weekKey);
    setDateRangePreset("custom");
    setStartDate(weekRow.startDate);
    setEndDate(weekRow.endDate);
    setWeeklyApprovalError("");
    setWeeklyApprovalNotice("");
  };

  const buildWeeklyApprovalActionItems = (entries = []) => {
    const actionItems = [];

    entries.forEach((entry) => {
      const notes = Array.isArray(entry.notes) ? entry.notes : [];
      const entryKeyBase = `${normalizeValue(entry.id)}::${normalizeValue(entry.issueId)}`;

      if (notes.length === 0) {
        actionItems.push({
          key: `${entryKeyBase}::missing`,
          entryId: normalizeValue(entry.id),
          issueId: normalizeValue(entry.issueId),
          projectName: normalizeValue(entry.projectName),
          startedAt: Number(entry.startedAt) || 0,
          noteIndex: -1,
          currentText: "",
          reason: "This log has no note. Add a specific task, scope, and outcome.",
        });
        return;
      }

      notes.forEach((note, noteIndex) => {
        const noteText = normalizeValue(note?.text);
        const normalizedNote = normalizeComparable(noteText);
        const reasons = [];

        if (!normalizedNote || normalizedNote.length < 45) {
          reasons.push("This note is too short to justify billed work.");
        }

        if (/\b(meeting|worked|misc|general|coordination|comments?)\b/.test(normalizedNote) && normalizedNote.length < 80) {
          reasons.push("This note is too generic and needs specific task details.");
        }

        if (/\b(create|creating|add|adding|put|placing)\s+text\s+(on|to)\s+racks?\b/i.test(noteText)) {
          reasons.push("Clarify this wording. Text cannot be placed on a rack directly. If you mean annotation for racks, say that explicitly.");
        }

        if (reasons.length === 0) return;

        actionItems.push({
          key: `${entryKeyBase}::${noteIndex}`,
          entryId: normalizeValue(entry.id),
          issueId: normalizeValue(entry.issueId),
          projectName: normalizeValue(entry.projectName),
          startedAt: Number(entry.startedAt) || 0,
          noteIndex,
          currentText: noteText,
          reason: reasons.join(" "),
        });
      });
    });

    return actionItems;
  };

  const canEditWeeklyApprovalEntryNote = (entry) => {
    if (!user || !entry) return false;
    if (isGlobalAdmin()) return true;
    if (isAdmin()) return true;

    const currentUserKeys = new Set(
      [user?.uid, user?.email, user?.displayName, user?.name]
        .map((value) => normalizeComparable(value))
        .filter(Boolean)
    );
    const entryUserKeys = [entry.userId, entry.userEmail, entry.registeredBy]
      .map((value) => normalizeComparable(value))
      .filter(Boolean);

    return entryUserKeys.some((value) => currentUserKeys.has(value));
  };

  const handleWeeklyApprovalDraftChange = (itemKey, nextValue) => {
    setWeeklyApprovalDraftByKey((current) => ({
      ...current,
      [itemKey]: nextValue,
    }));
    setWeeklyApprovalDraftError("");
    setWeeklyApprovalDraftNotice("");
  };

  const handleSaveWeeklyApprovalActionItem = async (item) => {
    if (!item?.entryId) {
      setWeeklyApprovalDraftError("No log entry found for this note.");
      return;
    }

    const sourceEntry = selectedWeeklyReviewEntries.find((entry) => normalizeValue(entry.id) === normalizeValue(item.entryId));
    if (!sourceEntry) {
      setWeeklyApprovalDraftError("Could not find the latest log entry. Close and reopen the review.");
      return;
    }

    if (!canEditWeeklyApprovalEntryNote(sourceEntry)) {
      setWeeklyApprovalDraftError("You do not have permission to edit this note.");
      return;
    }

    const draftText = normalizeValue(weeklyApprovalDraftByKey[item.key]);
    if (!draftText) {
      setWeeklyApprovalDraftError("Note text cannot be empty.");
      return;
    }

    const existingNotes = Array.isArray(sourceEntry.notes)
      ? sourceEntry.notes.map((noteItem) => ({
          text: normalizeValue(noteItem?.text),
          timestamp: Number(noteItem?.timestamp) || Date.now(),
        }))
      : [];

    const nextNotes = item.noteIndex >= 0
      ? existingNotes.map((noteItem, index) => (
          index === item.noteIndex
            ? { text: draftText, timestamp: Number(noteItem?.timestamp) || Date.now() }
            : noteItem
        ))
      : [
          ...existingNotes,
          {
            text: draftText,
            timestamp: Date.now(),
          },
        ];

    setWeeklyApprovalSavingKey(item.key);
    setWeeklyApprovalDraftError("");
    setWeeklyApprovalDraftNotice("");
    try {
      await updateDoc(doc(db, "churches", id, "timeRotateLogs", item.entryId), {
        notes: nextNotes,
      });

      setWeeklyApprovalDraftNotice(`Saved note for issue ${item.issueId || "-"}. Re-run review to refresh approval status.`);
      setWeeklyApprovalActionItems((current) => current.filter((entry) => entry.key !== item.key));
    } catch (saveError) {
      setWeeklyApprovalDraftError(normalizeValue(saveError?.message) || "Could not save note.");
    } finally {
      setWeeklyApprovalSavingKey("");
    }
  };

  const handleApproveSelectedWeek = async () => {
    if (!id || !user) return;
    if (!selectedReviewUserKey) {
      setWeeklyApprovalError("Select a user to review weekly logs.");
      return;
    }

    if (!selectedWeeklyReviewRow) {
      setWeeklyApprovalError("Select a week to approve.");
      return;
    }

    setWeeklyApprovalError("");
    setWeeklyApprovalNotice("");
    setWeeklyApprovalAiSummary("");
    setWeeklyApprovalAiAdjustments([]);
    setWeeklyApprovalAiRawFeedback("");
    setWeeklyApprovalAiReady(false);
    setWeeklyApprovalConfirmedByUser(false);
    setWeeklyApprovalActionItems([]);
    setWeeklyApprovalDraftByKey({});
    setWeeklyApprovalSavingKey("");
    setWeeklyApprovalDraftError("");
    setWeeklyApprovalDraftNotice("");
    setIsWeeklyApprovalDialogOpen(false);
    setWeeklyApprovalAiLoading(true);

    try {
      const nextActionItems = buildWeeklyApprovalActionItems(selectedWeeklyReviewEntries);
      setWeeklyApprovalActionItems(nextActionItems);
      setWeeklyApprovalDraftByKey(
        Object.fromEntries(nextActionItems.map((item) => [item.key, item.currentText]))
      );

      const compactLogEntries = selectedWeeklyReviewEntries.slice(0, 120).map((entry) => ({
        issueId: normalizeValue(entry.issueId),
        projectName: normalizeValue(entry.projectName),
        startedAt: formatTimestamp(entry.startedAt),
        endedAt: formatTimestamp(entry.endedAt),
        duration: formatDurationHoursMinutes(entry.durationMs),
        notes: (Array.isArray(entry.notes) ? entry.notes : []).map((note) => normalizeValue(note?.text)).filter(Boolean),
      }));

      const compactProjectIssueNotes = selectedWeeklyProgressNotes.slice(0, 120).map((note) => ({
        issueId: normalizeValue(note.issueId),
        issueTitle: normalizeValue(note.issueTitle),
        projectName: normalizeValue(note.projectName),
        addedBy: normalizeValue(note.createdByEmail || note.createdByName || note.createdByUid),
        addedAt: formatTimestamp(note.createdAtMs),
        note: truncateText(note.noteText, 280),
      }));

      const compactImportedPanelNotes = selectedWeeklyImportedProgressNotes.slice(0, 120).map((note) => ({
        issueId: normalizeValue(note.issueId),
        issueTitle: normalizeValue(note.issueTitle),
        projectName: normalizeValue(note.projectName),
        activityType: normalizeValue(note.activityType),
        addedBy: normalizeValue(note.createdByEmail || note.createdByName || note.createdByUid),
        addedAt: formatTimestamp(note.createdAtMs),
        completionPercent: Number(note.completionPercent) || null,
        note: truncateText(note.noteText, 280),
      }));

      const prompt = [
        "You are reviewing employee time log notes that will be sent to a client for billing.",
        "Determine if notes are specific enough to justify billed hours.",
        "Reject vague notes like 'meeting with team' unless supported by specific scope and outcomes.",
        "If a note describes an impossible or incorrect operation, require clarification instead of approving it.",
        "Example: 'creating text on racks' is not a valid rack task. Ask the user to clarify whether they mean annotation for racks or another specific action.",
        "Use the imported Project Lists section as supporting evidence.",
        "If Project Lists notes and progress updates for the same user, project, and week provide specific task, scope, and outcome detail, they can justify the work even when some time-log notes are brief or missing.",
        "Provide strict feedback for revision when needed.",
        "",
        "Return ONLY valid JSON with this shape:",
        "{",
        '  "approveReady": boolean,',
        '  "summary": string,',
        '  "requiredAdjustments": string[]',
        "}",
        "",
        `User: ${normalizeValue(selectedReviewUser?.label)}`,
        `Week: ${selectedWeeklyReviewRow.label}`,
        `Total logs: ${selectedWeeklyReviewRow.totalLogs}`,
        `Total duration: ${formatDurationHoursMinutes(selectedWeeklyReviewRow.totalDurationMs)}`,
        `Missing notes count: ${selectedWeeklyReviewRow.missingNoteLogs}`,
        `Project progress notes matched to this user/week: ${compactProjectIssueNotes.length}`,
        `Imported Project Lists notes in top section: ${compactImportedPanelNotes.length}`,
        `Imported Project Lists completed issues: ${selectedWeeklyImportedProgressSummary.completedIssueCount}`,
        `Imported Project Lists issues touched: ${selectedWeeklyImportedProgressSummary.issueCount}`,
        `Imported Project Lists progress updates: ${selectedWeeklyImportedProgressSummary.progressUpdateCount}`,
        `Imported Project Lists note entries: ${selectedWeeklyImportedProgressSummary.noteCount}`,
        "",
        "Time logs and notes:",
        JSON.stringify(compactLogEntries, null, 2),
        "",
        "Related Project Lists progress notes:",
        JSON.stringify(compactProjectIssueNotes, null, 2),
        "",
        "Imported Project Lists section shown on the page:",
        JSON.stringify(compactImportedPanelNotes, null, 2),
      ].join("\n");

      const response = await fetch(`${FIREBASE_FUNCTIONS_BASE_URL}/generateTimeRotateInvoiceReview`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: AI_REVIEW_MODEL,
          prompt,
          maxOutputTokens: 1200,
          temperature: 0.2,
        }),
      });

      const responseContentType = normalizeValue(response.headers.get("content-type") || "");
      if (responseContentType.includes("text/html")) {
        throw new Error("Feedback endpoint returned HTML. Verify function deployment and route settings.");
      }

      let payload = null;
      try {
        payload = await response.json();
      } catch (parseError) {
        throw new Error("Feedback endpoint returned invalid JSON.");
      }

      if (!response.ok) {
        throw new Error(
          normalizeValue(payload?.error)
          || normalizeValue(payload?.message)
          || "Could not evaluate notes for approval."
        );
      }

      const feedbackText = normalizeValue(payload?.text);
      if (!feedbackText) {
        throw new Error("Feedback response did not include content.");
      }

      setWeeklyApprovalAiRawFeedback(feedbackText);

      let parsedFeedback = null;
      try {
        parsedFeedback = JSON.parse(feedbackText);
      } catch (jsonError) {
        const jsonSnippetMatch = feedbackText.match(/\{[\s\S]*\}/);
        if (jsonSnippetMatch) {
          parsedFeedback = JSON.parse(jsonSnippetMatch[0]);
        }
      }

      const fallbackAdjustments = [
        "Notes must clearly explain the exact task, location/scope, and measurable outcome for billed time.",
        "Replace generic phrases with specific deliverables completed during each time block.",
      ];

      const heuristicWeakNotes = nextActionItems.filter((item) => item.noteIndex >= 0);

      const impossibleRackTextNotes = compactLogEntries.flatMap((entry) => {
        const notes = Array.isArray(entry.notes) ? entry.notes : [];
        return notes
          .filter((noteText) => /\b(create|creating|add|adding|put|placing)\s+text\s+(on|to)\s+racks?\b/i.test(String(noteText || "")))
          .map((noteText) => ({
            issueId: normalizeValue(entry.issueId),
            noteText: normalizeValue(noteText),
          }));
      });

      const hasStrongImportedSupport =
        Number(selectedWeeklyImportedProgressSummary.completedIssueCount) > 0
        && (
          Number(selectedWeeklyImportedProgressSummary.progressUpdateCount) >= 3
          || Number(selectedWeeklyImportedProgressSummary.noteCount) >= 3
          || Number(selectedWeeklyImportedProgressSummary.issueCount) >= 3
        );

      const parsedApproveReady = Boolean(parsedFeedback?.approveReady);
      const hasImpossibleRackTextNotes = impossibleRackTextNotes.length > 0;
      const isHeuristicallyReady = (heuristicWeakNotes.length === 0 || hasStrongImportedSupport) && !hasImpossibleRackTextNotes;
      const hasNoMissingNotes = Number(selectedWeeklyReviewRow.missingNoteLogs) === 0 || hasStrongImportedSupport;
      const finalApproveReady = parsedApproveReady && isHeuristicallyReady && hasNoMissingNotes;

      const parsedSummary = normalizeValue(parsedFeedback?.summary)
        || (finalApproveReady
          ? (hasStrongImportedSupport
            ? "Imported Project Lists notes add enough supporting detail to justify this week's work for billing approval."
            : "Notes look detailed enough for client-facing billing support.")
          : "Some notes still need revision before this week can be approved for client billing.");

      const parsedAdjustments = Array.isArray(parsedFeedback?.requiredAdjustments)
        ? parsedFeedback.requiredAdjustments.map((item) => normalizeValue(item)).filter(Boolean)
        : [];

      const heuristicAdjustments = heuristicWeakNotes.length > 0
        && !hasStrongImportedSupport
        ? [
            `Detected ${heuristicWeakNotes.length} log(s) with potentially vague notes. Add concrete task details, scope, and outcome.`,
          ]
        : [];

      const missingNoteAdjustments = Number(selectedWeeklyReviewRow.missingNoteLogs) > 0
        && !hasStrongImportedSupport
        ? [
            `Add notes to ${selectedWeeklyReviewRow.missingNoteLogs} log(s) that currently have no note. Approval requires notes on every log.`,
          ]
        : [];

      const impossibleRackTextAdjustments = hasImpossibleRackTextNotes
        ? [
            `Clarify ${impossibleRackTextNotes.length} note(s) that describe 'text on racks'. Text cannot be placed on a rack directly. If the intent was annotation for racks, rewrite the note to say that explicitly.`,
          ]
        : [];

      const nextAdjustments = [...parsedAdjustments, ...missingNoteAdjustments, ...heuristicAdjustments, ...impossibleRackTextAdjustments];

      setWeeklyApprovalAiReady(finalApproveReady);
      setWeeklyApprovalAiSummary(parsedSummary);
      setWeeklyApprovalAiAdjustments(nextAdjustments.length > 0 ? nextAdjustments : fallbackAdjustments);
      setIsWeeklyApprovalDialogOpen(true);
    } catch (feedbackError) {
      setWeeklyApprovalAiReady(false);
      setWeeklyApprovalAiSummary("Could not validate notes with Gemini feedback. Resolve this before approval.");
      setWeeklyApprovalAiAdjustments([
        normalizeValue(feedbackError?.message) || "Review service unavailable.",
        "Please improve note detail and retry approval once feedback is available.",
      ]);
      setIsWeeklyApprovalDialogOpen(true);
    } finally {
      setWeeklyApprovalAiLoading(false);
    }
  };

  const handleConfirmApproveSelectedWeek = async () => {
    if (!id || !user || !selectedWeeklyReviewRow || !selectedReviewUserKey) return;
    if (!weeklyApprovalAiReady) {
      setWeeklyApprovalError("Approval is blocked until note feedback passes.");
      return;
    }
    if (!weeklyApprovalConfirmedByUser) {
      setWeeklyApprovalError("Please confirm accuracy before final approval.");
      return;
    }

    setApprovingWeekKey(selectedWeeklyReviewRow.weekKey);
    setWeeklyApprovalError("");
    setWeeklyApprovalNotice("");

    try {
      const approvalDocId = buildWeeklyApprovalDocId(selectedReviewUserKey, selectedWeeklyReviewRow.weekKey);
      await setDoc(doc(db, "churches", id, "timeRotateWeeklyApprovals", approvalDocId), {
        churchId: id,
        userKey: selectedReviewUserKey,
        userId: normalizeValue(selectedReviewUser?.userId),
        userEmail: normalizeValue(selectedReviewUser?.email),
        userLabel: normalizeValue(selectedReviewUser?.label),
        weekKey: selectedWeeklyReviewRow.weekKey,
        weekStartDate: selectedWeeklyReviewRow.startDate,
        weekEndDate: selectedWeeklyReviewRow.endDate,
        totalLogs: Number(selectedWeeklyReviewRow.totalLogs) || 0,
        totalDurationMs: Number(selectedWeeklyReviewRow.totalDurationMs) || 0,
        missingNoteLogs: Number(selectedWeeklyReviewRow.missingNoteLogs) || 0,
        approvedAt: Date.now(),
        approvedByUid: normalizeValue(user?.uid),
        approvedByLabel: normalizeValue(user?.displayName || user?.name || user?.email || user?.uid),
        reviewConfirmationText: "I verified that time and notes are accurate for client billing.",
      });

      setIsWeeklyApprovalDialogOpen(false);
      setWeeklyApprovalNotice("Week approved successfully.");
    } catch (approvalError) {
      setWeeklyApprovalError(normalizeValue(approvalError?.message) || "Could not approve this week.");
    } finally {
      setApprovingWeekKey("");
    }
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

  const canEditRowNotes = (row) => {
    if (!user || !row) return false;
    if (canEditRow(row)) return true;

    const currentUserKeys = new Set(
      [user?.uid, user?.email, user?.displayName, user?.name]
        .map((value) => normalizeComparable(value))
        .filter(Boolean)
    );

    if (currentUserKeys.size === 0) return false;

    const rowUserKeys = [row.userKey, row.userEmail, row.userLabel]
      .map((value) => normalizeComparable(value))
      .filter(Boolean);

    return rowUserKeys.some((value) => currentUserKeys.has(value));
  };

  const handleStartEdit = (row) => {
    setAddingRowKey(null);
    setAddError("");
    setEditingEntryKey("");
    setEditingEntryError("");
    setEditingNoteKey("");
    setEditingNoteError("");
    setAddingNoteKey("");
    setAddingNoteError("");
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
    setEditingNoteKey("");
    setEditingNoteError("");
    setAddingNoteKey("");
    setAddingNoteError("");
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
      if (editingNoteKey.startsWith(`${row.rollupKey}::${entry.id}::`)) {
        setEditingNoteKey("");
        setEditingNoteError("");
      }
      if (addingNoteKey === `${row.rollupKey}::${entry.id}`) {
        setAddingNoteKey("");
        setAddingNoteError("");
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
    setEditingNoteKey("");
    setEditingNoteError("");
    setAddingNoteKey("");
    setAddingNoteError("");
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

  const handleStartNoteEdit = (row, entry, note, noteIndex) => {
    const nextNoteKey = `${row.rollupKey}::${entry.id}::${noteIndex}`;
    setEditingRowKey(null);
    setEditError("");
    setAddingRowKey(null);
    setAddError("");
    setAddingNoteKey("");
    setAddingNoteError("");
    setEditingEntryKey("");
    setEditingEntryError("");
    setEditingNoteKey(nextNoteKey);
    setEditingNoteText(normalizeValue(note?.text));
    setEditingNoteError("");
  };

  const handleSaveNoteEdit = async (row, entry, noteIndex) => {
    if (!entry?.id || !entry?.collection) {
      setEditingNoteError("No entry found for this note.");
      return;
    }

    if (!canEditRowNotes(row)) {
      setEditingNoteError("You do not have permission to edit this note.");
      return;
    }

    const trimmedText = normalizeValue(editingNoteText);
    if (!trimmedText) {
      setEditingNoteError("Note text cannot be empty.");
      return;
    }

    const existingNotes = Array.isArray(entry.notes) ? entry.notes : [];
    if (noteIndex < 0 || noteIndex >= existingNotes.length) {
      setEditingNoteError("Could not find this note anymore. Refresh and try again.");
      return;
    }

    const nextNotes = existingNotes.map((noteItem, index) => {
      if (index !== noteIndex) {
        return {
          text: normalizeValue(noteItem?.text),
          timestamp: Number(noteItem?.timestamp) || 0,
        };
      }

      return {
        text: trimmedText,
        timestamp: Number(noteItem?.timestamp) || Date.now(),
      };
    });

    setEditingNoteSaving(true);
    setEditingNoteError("");
    try {
      await updateDoc(doc(db, "churches", id, entry.collection, entry.id), {
        notes: nextNotes,
      });
      setEditingNoteKey("");
      setEditingNoteText("");
    } catch (saveError) {
      setEditingNoteError(normalizeValue(saveError?.message) || "Could not save note.");
    } finally {
      setEditingNoteSaving(false);
    }
  };

  const handleStartAddNote = (row, entry) => {
    const nextNoteKey = `${row.rollupKey}::${entry.id}`;
    setEditingRowKey(null);
    setEditError("");
    setAddingRowKey(null);
    setAddError("");
    setEditingEntryKey("");
    setEditingEntryError("");
    setEditingNoteKey("");
    setEditingNoteError("");
    setAddingNoteKey(nextNoteKey);
    setAddingNoteText("");
    setAddingNoteError("");
  };

  const handleSaveAddNote = async (row, entry) => {
    if (!entry?.id || entry.collection !== "timeRotateLogs") {
      setAddingNoteError("Only submitted log entries can add notes here.");
      return;
    }

    if (!canEditRowNotes(row)) {
      setAddingNoteError("You do not have permission to add notes here.");
      return;
    }

    const trimmedText = normalizeValue(addingNoteText);
    if (!trimmedText) {
      setAddingNoteError("Note text is required.");
      return;
    }

    const existingNotes = Array.isArray(entry.notes)
      ? entry.notes.map((noteItem) => ({
          text: normalizeValue(noteItem?.text),
          timestamp: Number(noteItem?.timestamp) || Date.now(),
        }))
      : [];

    const nextNotes = [
      ...existingNotes,
      {
        text: trimmedText,
        timestamp: Date.now(),
      },
    ];

    setAddingNoteSaving(true);
    setAddingNoteError("");
    try {
      await updateDoc(doc(db, "churches", id, entry.collection, entry.id), {
        notes: nextNotes,
      });
      setAddingNoteKey("");
      setAddingNoteText("");
    } catch (saveError) {
      setAddingNoteError(normalizeValue(saveError?.message) || "Could not add note.");
    } finally {
      setAddingNoteSaving(false);
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
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <input
                type="text"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search by card, title, project, or user"
                style={{
                  flex: "1 1 280px",
                  minWidth: "220px",
                  padding: "8px 10px",
                  border: "1px solid #CBD5E1",
                  borderRadius: "8px",
                  backgroundColor: "#FFFFFF",
                }}
              />
              <select
                value={selectedRowStatus}
                onChange={(event) => setSelectedRowStatus(event.target.value)}
                style={{ ...filterControlStyle, flex: "0 0 170px", minWidth: "170px" }}
              >
                <option value="both">All rows</option>
                <option value="closed">Closed only</option>
                <option value="open">Open only</option>
              </select>
            </div>
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
              value={projectIssueProgressStatusFilter}
              onChange={(event) => setProjectIssueProgressStatusFilter(event.target.value)}
              style={filterControlStyle}
            >
              <option value="both">All project note status</option>
              <option value="completed">Completed only</option>
              <option value="incomplete">Incomplete only</option>
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
                setSelectedRowStatus("both");
                setProjectIssueProgressStatusFilter("both");
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
              {visibleCardUserRollup.length} rows • Total {formatDuration(totalDurationAllRows)}
            </div>
          </div>
        </div>

        <div style={weeklyReviewLayoutStyle}>
          <div style={weeklyReviewSidebarStyle}>
            <div style={weeklyReviewSidebarTitleStyle}>Weekly Time Review</div>
            <div style={weeklyReviewSidebarHintStyle}>
              Approve only when every log in the week has notes.
            </div>

            {!selectedReviewUser ? (
              <div style={weeklyReviewEmptyStyle}>Select a user above to review weekly logs.</div>
            ) : weeklyReviewRows.length === 0 ? (
              <div style={weeklyReviewEmptyStyle}>No submitted logs found for this user.</div>
            ) : (
              <div style={{ display: "grid", gap: "8px" }}>
                {weeklyReviewRows.map((weekRow) => {
                  const isSelected = selectedReviewWeekKey === weekRow.weekKey;
                  const isUnapproved = !weekRow.isApproved;
                  return (
                    <button
                      key={weekRow.weekKey}
                      type="button"
                      onClick={() => handleSelectWeeklyReviewRow(weekRow)}
                      style={{
                        textAlign: "left",
                        width: "100%",
                        borderRadius: "10px",
                        border: isSelected
                          ? "2px solid #1D4ED8"
                          : (isUnapproved ? "1px solid #FCA5A5" : "1px solid #CBD5E1"),
                        backgroundColor: isSelected
                          ? "#DBEAFE"
                          : (isUnapproved ? "#FEF2F2" : "#FFFFFF"),
                        padding: "10px",
                        cursor: "pointer",
                        display: "grid",
                        gap: "4px",
                      }}
                    >
                      <div style={{ color: "#0F172A", fontWeight: 800, fontSize: "0.84rem" }}>
                        {weekRow.label}
                      </div>
                      <div style={{ color: "#334155", fontSize: "0.78rem", fontWeight: 600 }}>
                        Hours: {formatDurationHoursMinutes(weekRow.totalDurationMs)}
                      </div>
                      <div style={{ color: "#334155", fontSize: "0.78rem", fontWeight: 600 }}>
                        Logs: {weekRow.totalLogs} | Missing notes: {weekRow.missingNoteLogs}
                      </div>
                      <div
                        style={{
                          color: weekRow.isApproved ? "#065F46" : "#991B1B",
                          fontSize: "0.76rem",
                          fontWeight: 800,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                        }}
                      >
                        {weekRow.isApproved ? "Approved" : "Needs Approval"}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {selectedWeeklyReviewRow ? (
              <div style={weeklyReviewApprovePanelStyle}>
                <div style={{ color: "#0F172A", fontWeight: 800, fontSize: "0.82rem" }}>
                  Selected Week: {selectedWeeklyReviewRow.label}
                </div>
                <div style={{ color: "#334155", fontSize: "0.78rem", fontWeight: 600 }}>
                  Missing notes: {selectedWeeklyReviewRow.missingNoteLogs}
                </div>
                <div style={{ color: "#166534", fontSize: "0.78rem", fontWeight: 700 }}>
                  Project Lists completed: {selectedWeeklyProgressSummary.completedIssueCount} | Issues: {selectedWeeklyProgressSummary.issueCount} | Projects: {selectedWeeklyProgressSummary.projectCount}
                </div>
                <button
                  type="button"
                  onClick={handleApproveSelectedWeek}
                  disabled={
                    weeklyApprovalAiLoading
                    ||
                    approvingWeekKey === selectedWeeklyReviewRow.weekKey
                    || selectedWeeklyReviewRow.isApproved
                  }
                  style={{
                    backgroundColor: selectedWeeklyReviewRow.isApproved
                      ? "#94A3B8"
                      : (selectedWeeklyReviewRow.missingNoteLogs > 0 ? "#EF4444" : "#059669"),
                    color: "#FFFFFF",
                    border: "none",
                    borderRadius: "8px",
                    padding: "8px 10px",
                    fontWeight: 800,
                    cursor: "pointer",
                    opacity: (weeklyApprovalAiLoading || approvingWeekKey === selectedWeeklyReviewRow.weekKey) ? 0.8 : 1,
                  }}
                >
                  {selectedWeeklyReviewRow.isApproved
                    ? "Already Approved"
                    : weeklyApprovalAiLoading
                      ? "Preparing Report..."
                    : approvingWeekKey === selectedWeeklyReviewRow.weekKey
                      ? "Approving..."
                      : "Approve Week"}
                </button>
                {weeklyApprovalAiLoading ? (
                  <div style={{ display: "grid", gap: "6px", marginTop: "4px" }}>
                    <div style={{ color: "#1D4ED8", fontSize: "0.78rem", fontWeight: 700 }}>
                      Gemini is reviewing time logs and imported Project Lists notes before opening the approval report.
                    </div>
                    <progress style={{ width: "100%", height: "10px" }} />
                  </div>
                ) : null}
                {weeklyApprovalError ? (
                  <div style={{ color: "#B91C1C", fontSize: "0.78rem", fontWeight: 700 }}>{weeklyApprovalError}</div>
                ) : null}
                {weeklyApprovalNotice ? (
                  <div style={{ color: "#065F46", fontSize: "0.78rem", fontWeight: 700 }}>{weeklyApprovalNotice}</div>
                ) : null}
              </div>
            ) : null}

          </div>

          <div>
        <div style={{ marginTop: "4px", border: "1px solid #D1FAE5", borderRadius: "10px", backgroundColor: "#F0FDF4", padding: "10px", display: "grid", gap: "8px" }}>
          <div style={{ color: "#065F46", fontWeight: 800, fontSize: "0.86rem" }}>
            Project Lists Progress Notes (Matched by selected user, selected project, and date)
          </div>
          {!selectedProject ? (
            <div style={{ color: "#334155", fontSize: "0.8rem", fontWeight: 600 }}>
              No project selected. Showing all Project Lists activity for the selected user in the current date range.
            </div>
          ) : null}
          <div style={{ display: "grid", gap: "4px", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
            <div style={{ border: "1px solid #BBF7D0", borderRadius: "8px", backgroundColor: "#FFFFFF", padding: "8px" }}>
              <div style={{ color: "#166534", fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em" }}>Completed</div>
              <div style={{ color: "#0F172A", fontSize: "1rem", fontWeight: 800 }}>{importedProjectIssueProgressSummary.completedIssueCount}</div>
            </div>
            <div style={{ border: "1px solid #BBF7D0", borderRadius: "8px", backgroundColor: "#FFFFFF", padding: "8px" }}>
              <div style={{ color: "#166534", fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em" }}>Issues</div>
              <div style={{ color: "#0F172A", fontSize: "1rem", fontWeight: 800 }}>{importedProjectIssueProgressSummary.issueCount}</div>
            </div>
            <div style={{ border: "1px solid #BBF7D0", borderRadius: "8px", backgroundColor: "#FFFFFF", padding: "8px" }}>
              <div style={{ color: "#166534", fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em" }}>Progress Updates</div>
              <div style={{ color: "#0F172A", fontSize: "1rem", fontWeight: 800 }}>{importedProjectIssueProgressSummary.progressUpdateCount}</div>
            </div>
            <div style={{ border: "1px solid #BBF7D0", borderRadius: "8px", backgroundColor: "#FFFFFF", padding: "8px" }}>
              <div style={{ color: "#166534", fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em" }}>Notes</div>
              <div style={{ color: "#0F172A", fontSize: "1rem", fontWeight: 800 }}>{importedProjectIssueProgressSummary.noteCount}</div>
            </div>
          </div>
          {projectIssueProgressLoading ? (
            <div style={{ color: "#065F46", fontSize: "0.82rem", fontWeight: 600 }}>
              Loading related project progress notes...
            </div>
          ) : projectIssueProgressError ? (
            <div style={{ color: "#B91C1C", fontSize: "0.82rem", fontWeight: 600 }}>
              {projectIssueProgressError}
            </div>
          ) : visibleImportedProjectIssueProgressNotes.length === 0 ? (
            <div style={{ color: "#475569", fontSize: "0.82rem", fontWeight: 600 }}>
              No related project-list progress notes match the current filters.
            </div>
          ) : (
            <div style={{ display: "grid", gap: "6px", maxHeight: "210px", overflowY: "auto", paddingRight: "4px" }}>
              {visibleImportedProjectIssueProgressNotes.slice(0, 14).map((note) => (
                <div key={note.id} style={{ border: "1px solid #BBF7D0", borderRadius: "8px", backgroundColor: "#FFFFFF", padding: "8px", display: "grid", gap: "3px" }}>
                  <div style={{ color: "#166534", fontSize: "0.76rem", fontWeight: 700 }}>
                    {formatTimestamp(note.createdAtMs)} | {note.projectName} | Issue {note.issueId || "-"}
                  </div>
                  <div style={{ color: "#334155", fontSize: "0.75rem", fontWeight: 600 }}>
                    Added by {note.createdByEmail || note.createdByName || note.createdByUid || "Unknown user"}
                  </div>
                  <div style={{ color: "#0F172A", fontSize: "0.82rem", lineHeight: 1.4 }}>
                    {truncateText(note.noteText, 260)}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div style={{ color: "#334155", fontSize: "0.76rem", fontWeight: 600 }}>
            Total matched project-list notes in range: {visibleImportedProjectIssueProgressNotes.length}
          </div>
        </div>

        {visibleCardUserRollup.length === 0 ? (
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
                {visibleCardUserRollup.map((row, rowIndex) => {
                  const isEditing = editingRowKey === row.rollupKey;
                  const isAdding = addingRowKey === row.rollupKey;
                  const canEdit = canEditRow(row);
                  const rowReferenceTimestamp = Number(row.firstAt) || Number(row.lastAt) || 0;
                  const rowDayKey = getDayKeyFromTimestamp(rowReferenceTimestamp) || "unknown-day";
                  const previousRow = rowIndex > 0 ? visibleCardUserRollup[rowIndex - 1] : null;
                  const previousRowReferenceTimestamp = previousRow
                    ? (Number(previousRow.firstAt) || Number(previousRow.lastAt) || 0)
                    : 0;
                  const previousRowDayKey = getDayKeyFromTimestamp(previousRowReferenceTimestamp) || "unknown-day";
                  const isDateBoundary = rowIndex === 0 || rowDayKey !== previousRowDayKey;
                  const datePalette = getDateBlockPalette(rowDayKey);
                  const summaryRowCellStyle = {
                    ...cellStyle,
                    backgroundColor: datePalette.blockBg,
                  };
                  const nextRow = rowIndex < visibleCardUserRollup.length - 1 ? visibleCardUserRollup[rowIndex + 1] : null;
                  const currentCardLabel = normalizeValue(row?.issueId) || "-";
                  const currentProjectLabel = normalizeValue(row?.projectName) || "-";
                  const currentUserLabel = normalizeValue(row?.userLabel) || "-";
                  const nextCardLabel = normalizeValue(nextRow?.issueId) || "-";
                  const nextProjectLabel = normalizeValue(nextRow?.projectName) || "-";
                  const nextUserLabel = normalizeValue(nextRow?.userLabel) || "-";
                  const rowProjectProgressNotes = projectIssueProgressByRollupKey[row.rollupKey] || [];
                  return (
                  <React.Fragment key={row.rollupKey}>
                    {isDateBoundary ? (
                      <>
                        <tr>
                          <td colSpan={9} style={{ ...cardBlockTopSpacerStyle, height: rowIndex === 0 ? "26px" : "34px" }}></td>
                        </tr>
                        <tr>
                          <td
                            style={{
                              ...cardBlockDividerLabelStyle,
                              backgroundColor: datePalette.headerBg,
                              borderTop: `4px solid ${datePalette.border}`,
                              borderBottom: `4px solid ${datePalette.border}`,
                            }}
                          >
                            Date
                          </td>
                          <td
                            colSpan={8}
                            style={{
                              ...cardBlockDividerContentStyle,
                              background: datePalette.headerBg,
                              borderLeft: `8px solid ${datePalette.border}`,
                              borderTop: `4px solid ${datePalette.border}`,
                              borderBottom: `4px solid ${datePalette.border}`,
                            }}
                          >
                            {formatDayHeaderLabel(rowReferenceTimestamp)}
                          </td>
                        </tr>
                        <tr>
                          <td colSpan={9} style={{ ...cardBlockBottomSpacerStyle, height: "26px", backgroundColor: datePalette.blockBg }}></td>
                        </tr>
                      </>
                    ) : null}
                    {rowIndex === 0 ? (
                      <>
                        <tr>
                          <td colSpan={9} style={cardBlockTopSpacerStyle}></td>
                        </tr>
                        <tr>
                          <td style={cardBlockDividerLabelStyle}>Current</td>
                          <td colSpan={8} style={cardBlockDividerContentStyle}>
                            CURRENT CARD {currentCardLabel} | PROJECT {currentProjectLabel} | USER {currentUserLabel}
                          </td>
                        </tr>
                        <tr>
                          <td colSpan={9} style={cardBlockBottomSpacerStyle}></td>
                        </tr>
                      </>
                    ) : null}
                    <tr>
                      <td style={summaryRowCellStyle}>{row.issueId || "-"}</td>
                      <td style={summaryRowCellStyle}>
                        <div>
                          {hasTechnicalDetailTitle(row.title)
                            ? `⭐ ${row.title || "-"}`
                            : (row.title || "-")}
                        </div>
                      </td>
                      <td style={summaryRowCellStyle}>{row.projectName || "-"}</td>
                      <td style={summaryRowCellStyle}>{row.userLabel || "Unknown user"}</td>
                      <td style={summaryRowCellStyle}>{row.totalEntries}</td>
                      <td style={summaryRowCellStyle}>{formatDuration(row.totalDurationMs)}</td>
                      <td style={summaryRowCellStyle}>
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
                      <td style={summaryRowCellStyle}>
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
                      <td style={{ ...summaryRowCellStyle, whiteSpace: "nowrap" }}>
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
                            {(() => {
                              const currentEntryTimestamp = Number(entry.startedAt) || Number(entry.endedAt) || 0;
                              const currentDayKey = getDayKeyFromTimestamp(currentEntryTimestamp);
                              const previousEntry = entryIndex > 0 ? row.entries[entryIndex - 1] : null;
                              const previousEntryTimestamp = previousEntry
                                ? (Number(previousEntry.startedAt) || Number(previousEntry.endedAt) || 0)
                                : 0;
                              const previousDayKey = getDayKeyFromTimestamp(previousEntryTimestamp);
                              const shouldShowDayHeader = entryIndex === 0 || currentDayKey !== previousDayKey;

                              if (!shouldShowDayHeader) return null;

                              return (
                                <tr>
                                  <td
                                    style={{
                                      ...sectionHeaderLabelCellStyle,
                                      backgroundColor: "#0F172A",
                                      color: "#FFFFFF",
                                    }}
                                  >
                                    Day
                                  </td>
                                  <td
                                    colSpan={8}
                                    style={{
                                      ...sectionHeaderContentCellStyle,
                                      backgroundColor: "#1E293B",
                                      borderLeft: "4px solid #38BDF8",
                                      color: "#FFFFFF",
                                      fontWeight: 800,
                                      letterSpacing: "0.02em",
                                    }}
                                  >
                                    {formatDayHeaderLabel(currentEntryTimestamp)}
                                  </td>
                                </tr>
                              );
                            })()}
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
                                      {editingNoteKey === `${row.rollupKey}::${entry.id}::${noteIndex}` ? (
                                        <div style={{ display: "grid", gap: "8px" }}>
                                          <textarea
                                            value={editingNoteText}
                                            onChange={(event) => setEditingNoteText(event.target.value)}
                                            rows={3}
                                            style={{
                                              width: "100%",
                                              border: "1px solid #FCD34D",
                                              borderRadius: "8px",
                                              padding: "8px 10px",
                                              resize: "vertical",
                                              boxSizing: "border-box",
                                              backgroundColor: "#FFFFFF",
                                            }}
                                          />
                                          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                            <button
                                              type="button"
                                              onClick={() => handleSaveNoteEdit(row, entry, noteIndex)}
                                              disabled={editingNoteSaving}
                                              style={{ backgroundColor: "#B45309", color: "#FFF", border: "none", borderRadius: "6px", padding: "6px 10px", cursor: editingNoteSaving ? "not-allowed" : "pointer", fontSize: "0.8rem", fontWeight: 700 }}
                                            >
                                              {editingNoteSaving ? "Saving..." : "Save Note"}
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => { setEditingNoteKey(""); setEditingNoteError(""); }}
                                              disabled={editingNoteSaving}
                                              style={{ backgroundColor: "#64748B", color: "#FFF", border: "none", borderRadius: "6px", padding: "6px 10px", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600 }}
                                            >
                                              Cancel
                                            </button>
                                          </div>
                                          {editingNoteError ? (
                                            <div style={{ color: "#B91C1C", fontWeight: 600, fontSize: "0.8rem" }}>
                                              {editingNoteError}
                                            </div>
                                          ) : null}
                                        </div>
                                      ) : (
                                        <div style={{ display: "grid", gap: "6px" }}>
                                          <span style={noteTextStyle}>{note.text}</span>
                                          {canEditRowNotes(row) ? (
                                            <div>
                                              <button
                                                type="button"
                                                onClick={() => handleStartNoteEdit(row, entry, note, noteIndex)}
                                                style={{ backgroundColor: "transparent", border: "1px solid #FCD34D", borderRadius: "6px", padding: "4px 8px", cursor: "pointer", fontSize: "0.8rem", color: "#92400E" }}
                                              >
                                                Edit Note
                                              </button>
                                            </div>
                                          ) : null}
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                ))
                              : (
                                <tr>
                                  <td
                                    style={{
                                      ...noteRowLabelCellStyle,
                                      backgroundColor: "#FEF2F2",
                                    }}
                                  >
                                    Note
                                  </td>
                                  <td
                                    colSpan={8}
                                    style={{
                                      ...noteRowContentCellStyle,
                                      backgroundColor: "#FEF2F2",
                                      borderLeft: "4px solid #DC2626",
                                    }}
                                  >
                                    {addingNoteKey === `${row.rollupKey}::${entry.id}` ? (
                                      <div style={{ display: "grid", gap: "8px" }}>
                                        <textarea
                                          value={addingNoteText}
                                          onChange={(event) => setAddingNoteText(event.target.value)}
                                          rows={3}
                                          placeholder="Add a note for this submitted time entry"
                                          style={{
                                            width: "100%",
                                            border: "1px solid #FCD34D",
                                            borderRadius: "8px",
                                            padding: "8px 10px",
                                            resize: "vertical",
                                            boxSizing: "border-box",
                                            backgroundColor: "#FFFFFF",
                                          }}
                                        />
                                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                          <button
                                            type="button"
                                            onClick={() => handleSaveAddNote(row, entry)}
                                            disabled={addingNoteSaving}
                                            style={{ backgroundColor: "#B45309", color: "#FFF", border: "none", borderRadius: "6px", padding: "6px 10px", cursor: addingNoteSaving ? "not-allowed" : "pointer", fontSize: "0.8rem", fontWeight: 700 }}
                                          >
                                            {addingNoteSaving ? "Saving..." : "Save Note"}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => { setAddingNoteKey(""); setAddingNoteError(""); }}
                                            disabled={addingNoteSaving}
                                            style={{ backgroundColor: "#64748B", color: "#FFF", border: "none", borderRadius: "6px", padding: "6px 10px", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600 }}
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                        {addingNoteError ? (
                                          <div style={{ color: "#B91C1C", fontWeight: 600, fontSize: "0.8rem" }}>
                                            {addingNoteError}
                                          </div>
                                        ) : null}
                                      </div>
                                    ) : (
                                      <div style={{ display: "grid", gap: "6px" }}>
                                        <span style={{ ...noteTextStyle, color: "#991B1B", fontWeight: 700 }}>
                                          No notes submitted for this time entry yet.
                                        </span>
                                        {canEditRowNotes(row) && entry.collection === "timeRotateLogs" ? (
                                          <div>
                                            <button
                                              type="button"
                                              onClick={() => handleStartAddNote(row, entry)}
                                              style={{ backgroundColor: "transparent", border: "1px solid #FCA5A5", borderRadius: "6px", padding: "4px 8px", cursor: "pointer", fontSize: "0.8rem", color: "#991B1B" }}
                                            >
                                              Add Note
                                            </button>
                                          </div>
                                        ) : null}
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              )}

                            {entryIndex === row.entries.length - 1 && rowProjectProgressNotes.length > 0 ? (
                              <>
                                <tr>
                                  <td
                                    style={{
                                      ...sectionHeaderLabelCellStyle,
                                      backgroundColor: "#D1FAE5",
                                    }}
                                  >
                                    Section
                                  </td>
                                  <td
                                    colSpan={8}
                                    style={{
                                      ...sectionHeaderContentCellStyle,
                                      backgroundColor: "#ECFDF5",
                                      borderLeft: "4px solid #10B981",
                                    }}
                                  >
                                    PROJECT LISTS ACTIVITY
                                  </td>
                                </tr>
                                <tr>
                                  <td
                                    style={{
                                      ...noteRowLabelCellStyle,
                                      backgroundColor: "#ECFDF5",
                                    }}
                                  >
                                    PLI Notes
                                  </td>
                                  <td
                                    colSpan={8}
                                    style={{
                                      ...noteRowContentCellStyle,
                                      backgroundColor: "#ECFDF5",
                                      borderLeft: "4px solid #10B981",
                                    }}
                                  >
                                    <div style={{ display: "grid", gap: "6px" }}>
                                      {rowProjectProgressNotes.map((progressNote) => (
                                        <div key={`${row.rollupKey}-${progressNote.id}`} style={{ display: "grid", gap: "2px" }}>
                                          <span style={{ color: "#065F46", fontSize: "0.75rem", fontWeight: 700 }}>
                                            {formatTimestamp(progressNote.createdAtMs)} | {progressNote.activityType || "Note Added"} | Issue {progressNote.issueId || "-"} | {progressNote.projectName}
                                          </span>
                                          <span style={{ color: "#334155", fontSize: "0.75rem", fontWeight: 600 }}>
                                            Added by {progressNote.createdByEmail || progressNote.createdByName || progressNote.createdByUid || "Unknown user"}
                                          </span>
                                          <span style={{ color: "#0F172A", fontSize: "0.81rem", lineHeight: 1.38 }}>
                                            {truncateText(progressNote.noteText, 220)}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              </>
                            ) : null}
                          </React.Fragment>
                        ))
                      : null}
                    {rowIndex < visibleCardUserRollup.length - 1 ? (
                      <>
                        <tr>
                          <td colSpan={9} style={cardBlockTopSpacerStyle}></td>
                        </tr>
                        <tr>
                          <td style={cardBlockDividerLabelStyle}>Next</td>
                          <td colSpan={8} style={cardBlockDividerContentStyle}>
                            NEXT CARD {nextCardLabel} | PROJECT {nextProjectLabel} | USER {nextUserLabel}
                          </td>
                        </tr>
                        <tr>
                          <td colSpan={9} style={cardBlockBottomSpacerStyle}></td>
                        </tr>
                      </>
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

        {isWeeklyApprovalDialogOpen ? (
          <div style={weeklyApprovalDialogOverlayStyle}>
            <div style={weeklyApprovalDialogCardStyle}>
              <div style={{ color: "#0F172A", fontWeight: 800, fontSize: "1rem" }}>
                Weekly Approval Verification
              </div>
              <div style={{ color: "#334155", fontSize: "0.86rem", lineHeight: 1.45 }}>
                These notes are used for client billing. Verify that time and notes accurately represent real work completed this week.
              </div>

              {selectedWeeklyReviewRow ? (
                <div style={{ color: "#1E293B", fontSize: "0.84rem", fontWeight: 700 }}>
                  Week: {selectedWeeklyReviewRow.label} | Logs: {selectedWeeklyReviewRow.totalLogs} | Hours: {formatDurationHoursMinutes(selectedWeeklyReviewRow.totalDurationMs)}
                </div>
              ) : null}

              {selectedWeeklyReviewRow ? (
                <div style={{ color: "#334155", fontSize: "0.82rem", fontWeight: 600 }}>
                  Imported Project Lists notes used in this review: {selectedWeeklyImportedProgressNotes.length}
                </div>
              ) : null}

              <div style={weeklyApprovalRequirementPanelStyle}>
                <div style={{ color: "#0F172A", fontWeight: 800, fontSize: "0.82rem" }}>Required note quality for approval</div>
                <div style={{ color: "#334155", fontSize: "0.8rem" }}>1. Explain specific task performed.</div>
                <div style={{ color: "#334155", fontSize: "0.8rem" }}>2. Include location/scope or card-specific context.</div>
                <div style={{ color: "#334155", fontSize: "0.8rem" }}>3. Include measurable result, output, or decision made.</div>
                <div style={{ color: "#334155", fontSize: "0.8rem" }}>4. Correct vague entries like "Meeting with the team" before approval.</div>
              </div>

              {weeklyApprovalAiLoading ? (
                <div style={{ color: "#1D4ED8", fontSize: "0.84rem", fontWeight: 700 }}>Gemini is reviewing this week's notes...</div>
              ) : (
                <>
                  <div
                    style={{
                      border: `1px solid ${weeklyApprovalAiReady ? "#86EFAC" : "#FCA5A5"}`,
                      backgroundColor: weeklyApprovalAiReady ? "#ECFDF5" : "#FEF2F2",
                      borderRadius: "10px",
                      padding: "10px",
                      display: "grid",
                      gap: "6px",
                    }}
                  >
                    <div style={{ color: weeklyApprovalAiReady ? "#065F46" : "#991B1B", fontWeight: 800, fontSize: "0.84rem" }}>
                      {weeklyApprovalAiReady ? "Feedback status: Ready to approve" : "Feedback status: Revisions required before approval"}
                    </div>
                    <div style={{ color: "#1F2937", fontSize: "0.82rem", lineHeight: 1.4 }}>
                      {weeklyApprovalAiSummary || "No feedback summary available."}
                    </div>
                    {weeklyApprovalAiAdjustments.length > 0 ? (
                      <div style={{ display: "grid", gap: "4px", marginTop: "2px" }}>
                        {weeklyApprovalAiAdjustments.slice(0, 6).map((item, index) => (
                          <div key={`${item}-${index}`} style={{ color: "#1F2937", fontSize: "0.8rem" }}>
                            {index + 1}. {item}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {weeklyApprovalActionItems.length > 0 ? (
                    <div
                      style={{
                        border: "1px solid #FCD34D",
                        backgroundColor: "#FFFBEB",
                        borderRadius: "10px",
                        padding: "10px",
                        display: "grid",
                        gap: "10px",
                      }}
                    >
                      <div style={{ color: "#92400E", fontWeight: 800, fontSize: "0.84rem" }}>
                        Fix flagged notes here
                      </div>
                      <div style={{ color: "#78350F", fontSize: "0.8rem", lineHeight: 1.4 }}>
                        Update the exact notes Gemini flagged, save them, then click Re-run Review. If the revised notes meet the requirements, approval can pass.
                      </div>
                      {weeklyApprovalActionItems.slice(0, 8).map((item) => (
                        <div key={item.key} style={{ border: "1px solid #FDE68A", borderRadius: "8px", backgroundColor: "#FFFFFF", padding: "10px", display: "grid", gap: "6px" }}>
                          <div style={{ color: "#0F172A", fontSize: "0.8rem", fontWeight: 800 }}>
                            Issue {item.issueId || "-"} | {item.projectName || "No project"} | {item.startedAt ? formatTimestamp(item.startedAt) : "No start time"}
                          </div>
                          <div style={{ color: "#92400E", fontSize: "0.78rem", fontWeight: 600 }}>
                            {item.reason}
                          </div>
                          <textarea
                            value={weeklyApprovalDraftByKey[item.key] ?? item.currentText}
                            onChange={(event) => handleWeeklyApprovalDraftChange(item.key, event.target.value)}
                            rows={3}
                            style={{
                              width: "100%",
                              border: "1px solid #FCD34D",
                              borderRadius: "8px",
                              padding: "8px 10px",
                              resize: "vertical",
                              boxSizing: "border-box",
                              backgroundColor: "#FFFFFF",
                            }}
                          />
                          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                            <button
                              type="button"
                              onClick={() => handleSaveWeeklyApprovalActionItem(item)}
                              disabled={weeklyApprovalSavingKey === item.key}
                              style={{ backgroundColor: "#B45309", color: "#FFFFFF", border: "none", borderRadius: "8px", padding: "8px 12px", fontWeight: 700, cursor: weeklyApprovalSavingKey === item.key ? "not-allowed" : "pointer" }}
                            >
                              {weeklyApprovalSavingKey === item.key ? "Saving..." : (item.noteIndex >= 0 ? "Save Note" : "Add Note")}
                            </button>
                          </div>
                        </div>
                      ))}
                      {weeklyApprovalDraftError ? (
                        <div style={{ color: "#B91C1C", fontSize: "0.8rem", fontWeight: 700 }}>
                          {weeklyApprovalDraftError}
                        </div>
                      ) : null}
                      {weeklyApprovalDraftNotice ? (
                        <div style={{ color: "#065F46", fontSize: "0.8rem", fontWeight: 700 }}>
                          {weeklyApprovalDraftNotice}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <label style={{ display: "flex", gap: "8px", alignItems: "flex-start", color: "#0F172A", fontSize: "0.82rem", fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={weeklyApprovalConfirmedByUser}
                      onChange={(event) => setWeeklyApprovalConfirmedByUser(Boolean(event.target.checked))}
                      disabled={!weeklyApprovalAiReady}
                      style={{ marginTop: "2px" }}
                    />
                    I verify these entries and notes are accurate, client-ready, and reflect actual work performed for billing.
                  </label>
                </>
              )}

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={handleApproveSelectedWeek}
                  disabled={weeklyApprovalAiLoading || weeklyApprovalSavingKey !== ""}
                  style={{ backgroundColor: "#1D4ED8", color: "#FFFFFF", border: "none", borderRadius: "8px", padding: "8px 12px", fontWeight: 700, cursor: (weeklyApprovalAiLoading || weeklyApprovalSavingKey !== "") ? "not-allowed" : "pointer", opacity: (weeklyApprovalAiLoading || weeklyApprovalSavingKey !== "") ? 0.6 : 1 }}
                >
                  Re-run Review
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsWeeklyApprovalDialogOpen(false);
                    setWeeklyApprovalError("");
                  }}
                  style={{ backgroundColor: "#64748B", color: "#FFFFFF", border: "none", borderRadius: "8px", padding: "8px 12px", fontWeight: 700, cursor: "pointer" }}
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={handleConfirmApproveSelectedWeek}
                  disabled={
                    weeklyApprovalAiLoading
                    || !weeklyApprovalAiReady
                    || !weeklyApprovalConfirmedByUser
                    || (approvingWeekKey === selectedReviewWeekKey)
                  }
                  style={{
                    backgroundColor: "#059669",
                    color: "#FFFFFF",
                    border: "none",
                    borderRadius: "8px",
                    padding: "8px 12px",
                    fontWeight: 800,
                    cursor: "pointer",
                    opacity: (
                      weeklyApprovalAiLoading
                      || !weeklyApprovalAiReady
                      || !weeklyApprovalConfirmedByUser
                      || (approvingWeekKey === selectedReviewWeekKey)
                    ) ? 0.55 : 1,
                  }}
                >
                  {approvingWeekKey === selectedReviewWeekKey ? "Approving..." : "Confirm & Approve Week"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
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

const weeklyReviewLayoutStyle = {
  marginTop: "12px",
  display: "grid",
  gridTemplateColumns: "minmax(240px, 290px) minmax(0, 1fr)",
  gap: "14px",
  alignItems: "start",
};

const weeklyReviewSidebarStyle = {
  border: "1px solid #BFDBFE",
  borderRadius: "12px",
  backgroundColor: "#F8FAFF",
  padding: "12px",
  display: "grid",
  gap: "10px",
  position: "sticky",
  top: "12px",
};

const weeklyReviewSidebarTitleStyle = {
  color: "#0F172A",
  fontWeight: 800,
  fontSize: "0.95rem",
};

const weeklyReviewSidebarHintStyle = {
  color: "#475569",
  fontSize: "0.8rem",
  lineHeight: 1.35,
};

const weeklyReviewEmptyStyle = {
  color: "#64748B",
  fontSize: "0.82rem",
  fontWeight: 600,
};

const weeklyReviewApprovePanelStyle = {
  border: "1px solid #BFDBFE",
  borderRadius: "10px",
  backgroundColor: "#FFFFFF",
  padding: "10px",
  display: "grid",
  gap: "8px",
};

const weeklyApprovalDialogOverlayStyle = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(15, 23, 42, 0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "18px",
  zIndex: 2000,
};

const weeklyApprovalDialogCardStyle = {
  width: "min(760px, 96vw)",
  maxHeight: "86vh",
  overflowY: "auto",
  borderRadius: "14px",
  border: "1px solid #BFDBFE",
  backgroundColor: "#FFFFFF",
  padding: "16px",
  boxShadow: "0 18px 30px rgba(15, 23, 42, 0.25)",
  display: "grid",
  gap: "10px",
};

const weeklyApprovalRequirementPanelStyle = {
  border: "1px solid #BFDBFE",
  borderRadius: "10px",
  backgroundColor: "#F8FAFF",
  padding: "10px",
  display: "grid",
  gap: "4px",
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
  padding: "16px 12px",
  borderBottom: "none",
  color: "#FFFFFF",
  fontSize: "0.86rem",
  fontWeight: 800,
  backgroundColor: "#0F172A",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  borderTop: "3px solid #38BDF8",
  borderBottom: "3px solid #38BDF8",
};

const cardBlockDividerContentStyle = {
  padding: "16px 14px",
  borderBottom: "none",
  color: "#FFFFFF",
  fontSize: "0.9rem",
  fontWeight: 800,
  background: "linear-gradient(90deg, #0F172A 0%, #1E3A8A 100%)",
  borderLeft: "6px solid #38BDF8",
  borderTop: "3px solid #38BDF8",
  borderBottom: "3px solid #38BDF8",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const cardBlockTopSpacerStyle = {
  padding: 0,
  height: "24px",
  borderBottom: "none",
  backgroundColor: "#FFFFFF",
};

const cardBlockBottomSpacerStyle = {
  padding: 0,
  height: "24px",
  borderBottom: "none",
  backgroundColor: "#EFF6FF",
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
