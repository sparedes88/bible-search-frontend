import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import * as XLSX from "xlsx";
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
  setDoc,
} from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { toast } from "react-toastify";
import { db, storage } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import ChurchHeader from "./ChurchHeader";
import commonStyles from "../pages/commonStyles";
import "./BIMModule.css";

const isPermissionDeniedError = (error) =>
  error?.code === "permission-denied" ||
  error?.code === "firestore/permission-denied";

const sanitizeHeader = (value, fallbackIndex) => {
  const raw = String(value ?? "").trim();
  return raw || `Field ${fallbackIndex + 1}`;
};

const ensureUniqueHeaders = (headers) => {
  const seen = {};
  return headers.map((header) => {
    const key = String(header || "").trim();
    if (!seen[key]) {
      seen[key] = 1;
      return key;
    }

    seen[key] += 1;
    return `${key} (${seen[key]})`;
  });
};

const normalizeValue = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return String(value).trim();
};

const isUrlLike = (value) => /^(https?:)?\/\//i.test(normalizeValue(value)) || /^www\./i.test(normalizeValue(value));

const normalizeUrl = (value) => {
  const raw = normalizeValue(value);
  if (!raw) return "";
  if (/^www\./i.test(raw)) return `https://${raw}`;
  return raw;
};

const extractHyperlinkFromFormula = (formula) => {
  if (!formula || typeof formula !== "string") return "";
  const match = formula.match(/HYPERLINK\(\s*"([^"]+)"/i);
  return match?.[1] || "";
};

const extractCellValue = (cell) => {
  const directLink = cell?.l?.Target;
  if (directLink) return directLink;

  const formulaLink = extractHyperlinkFromFormula(cell?.f);
  if (formulaLink) return formulaLink;

  return cell?.w ?? cell?.v ?? "";
};

const getRowImage = (rowData = {}, fields = []) => {
  const rowKeys = Object.keys(rowData || {});
  const thirdColumnField = fields?.[2] || rowKeys?.[2] || null;
  const normalizedSnapshotKey = rowKeys.find((key) =>
    String(key || "").replace(/[^a-z0-9]/gi, "").toLowerCase() === "snapshot"
  );

  const candidates = [
    "snapshot",
    "Snapshot",
    normalizedSnapshotKey,
    thirdColumnField,
    ...fields,
    ...rowKeys,
  ].filter(Boolean);

  const imageField = candidates.find((field) => {
    if (!field) return false;
    const label = String(field).toLowerCase();
    const looksLikeImageField =
      label.includes("snapshot") ||
      label.includes("image") ||
      label.includes("photo") ||
      label.includes("picture") ||
      label.includes("thumbnail");

    return looksLikeImageField && isUrlLike(rowData?.[field]);
  });

  if (!imageField) return null;
  return {
    field: imageField,
    url: normalizeUrl(rowData?.[imageField]),
  };
};

const normalizeFieldKey = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const findFieldByAliases = (fields = [], rowData = {}, aliases = []) => {
  const candidates = Array.from(new Set([...(fields || []), ...Object.keys(rowData || {})]));
  if (!candidates.length) return null;

  for (const alias of aliases) {
    const key = normalizeFieldKey(alias);
    const exact = candidates.find((candidate) => normalizeFieldKey(candidate) === key);
    if (exact) return exact;
  }

  for (const alias of aliases) {
    const key = normalizeFieldKey(alias);
    const contains = candidates.find((candidate) => normalizeFieldKey(candidate).includes(key));
    if (contains) return contains;
  }

  return null;
};

const getCardPreview = (rowData = {}, fields = []) => {
  const titleField = findFieldByAliases(fields, rowData, ["title", "task title", "name"]);
  const statusField = findFieldByAliases(fields, rowData, ["status", "state", "task status"]);
  const priorityField = findFieldByAliases(fields, rowData, ["priority"]);
  const assigneeField = findFieldByAliases(fields, rowData, ["assignee", "assigned to", "owner", "responsible"]);
  const deadlineField = findFieldByAliases(fields, rowData, ["deadline", "due date", "due", "target date"]);
  const idField = findFieldByAliases(fields, rowData, ["id", "task id", "card id", "row id"]);

  return {
    title: normalizeValue(titleField ? rowData?.[titleField] : ""),
    status: normalizeValue(statusField ? rowData?.[statusField] : ""),
    priority: normalizeValue(priorityField ? rowData?.[priorityField] : ""),
    assignee: normalizeValue(assigneeField ? rowData?.[assigneeField] : ""),
    deadline: normalizeValue(deadlineField ? rowData?.[deadlineField] : ""),
    id: normalizeValue(idField ? rowData?.[idField] : ""),
  };
};

const GENERIC_BIM_CARD_IMAGE = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700" viewBox="0 0 1200 700">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#dbeafe"/>
        <stop offset="100%" stop-color="#bfdbfe"/>
      </linearGradient>
    </defs>
    <rect width="1200" height="700" fill="url(#bg)"/>
    <rect x="120" y="120" width="960" height="460" rx="24" fill="#ffffff" stroke="#93c5fd" stroke-width="4"/>
    <g fill="#1d4ed8" font-family="Arial, sans-serif" text-anchor="middle">
      <text x="600" y="310" font-size="64" font-weight="700">BIM Card</text>
      <text x="600" y="370" font-size="30" opacity="0.8">No snapshot image available</text>
    </g>
  </svg>`
)}`;

const applyBimFallbackImage = (event) => {
  const imageElement = event?.currentTarget;
  if (!imageElement) return;

  if (imageElement.dataset.fallbackApplied === "true") return;

  imageElement.dataset.fallbackApplied = "true";
  imageElement.src = GENERIC_BIM_CARD_IMAGE;
};

const parseExcelRows = (fileData) => {
  const workbook = XLSX.read(fileData, { type: "array", cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("No worksheet found in the uploaded file.");
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rangeRef = worksheet?.["!ref"];
  if (!rangeRef) {
    throw new Error("The file must include a header row and at least one data row.");
  }

  const range = XLSX.utils.decode_range(rangeRef);
  const headerRow = range.s.r;

  const rawHeaders = [];
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const address = XLSX.utils.encode_cell({ r: headerRow, c });
    const cell = worksheet[address];
    rawHeaders.push(cell?.w ?? cell?.v ?? "");
  }

  const headers = ensureUniqueHeaders(rawHeaders.map((h, i) => sanitizeHeader(h, i)));
  const rows = [];

  for (let r = headerRow + 1; r <= range.e.r; r += 1) {
    const rowData = {};

    headers.forEach((header, index) => {
      const c = range.s.c + index;
      const address = XLSX.utils.encode_cell({ r, c });
      const cell = worksheet[address];
      const cellValue = extractCellValue(cell);
      rowData[header] = normalizeValue(cellValue);
    });

    const hasData = Object.values(rowData).some((v) => normalizeValue(v) !== "");
    if (!hasData) continue;

    rows.push({
      rowNumber: r + 1,
      rowData,
    });
  }

  if (!rows.length) {
    throw new Error("The file must include a header row and at least one data row.");
  }

  return { headers, rows };
};

const detectIdentityHeader = (headers) => {
  const priority = ["id", "code", "sku", "email", "item", "name"];
  const lowerMap = headers.map((h) => ({ original: h, normalized: h.toLowerCase() }));

  for (const key of priority) {
    const found = lowerMap.find((h) => h.normalized === key || h.normalized.includes(key));
    if (found) return found.original;
  }

  return null;
};

const computeUploadDiff = (existingRows = [], nextRows = [], headers = []) => {
  const identityHeader = detectIdentityHeader(headers);

  const createKey = (row, index) => {
    if (identityHeader) {
      const candidate = normalizeValue(row?.rowData?.[identityHeader]);
      if (candidate) return `${identityHeader}:${candidate}`;
    }
    return `ROW_INDEX:${index}`;
  };

  const existingMap = new Map();
  existingRows.forEach((row, index) => {
    existingMap.set(createKey(row, index), row);
  });

  const nextMap = new Map();
  nextRows.forEach((row, index) => {
    nextMap.set(createKey(row, index), row);
  });

  let addedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  const changedRows = [];

  nextRows.forEach((newRow, index) => {
    const key = createKey(newRow, index);
    const existing = existingMap.get(key);

    if (!existing) {
      addedCount += 1;
      return;
    }

    const allFields = Array.from(new Set([
      ...Object.keys(existing.rowData || {}),
      ...Object.keys(newRow.rowData || {}),
    ]));

    const changedFields = [];

    allFields.forEach((field) => {
      const oldValue = normalizeValue(existing.rowData?.[field]);
      const newValue = normalizeValue(newRow.rowData?.[field]);
      if (oldValue !== newValue) {
        changedFields.push({ field, oldValue, newValue });
      }
    });

    if (changedFields.length) {
      updatedCount += 1;
      changedRows.push({
        rowKey: key,
        rowNumber: newRow.rowNumber,
        changedFields,
      });
    } else {
      unchangedCount += 1;
    }
  });

  const deletedRows = [];
  existingRows.forEach((row, index) => {
    const key = createKey(row, index);
    if (!nextMap.has(key)) {
      deletedRows.push({ rowKey: key, rowNumber: row.rowNumber });
    }
  });

  return {
    summary: {
      added: addedCount,
      updated: updatedCount,
      deleted: deletedRows.length,
      unchanged: unchangedCount,
      totalRows: nextRows.length,
      totalFields: headers.length,
    },
    changedRows,
    deletedRows,
  };
};

const BIM_MANUAL_CARD_FIELDS = ["ID", "Title", "Snapshot", "Status", "Priority", "Due Date", "Created", "Source"];

const mergeProjectFields = (...fieldGroups) => {
  const mergedFields = [];
  const seenFields = new Set();

  fieldGroups.flat().forEach((field) => {
    const normalizedField = normalizeValue(field);
    if (!normalizedField) return;

    const normalizedKey = normalizedField.toLowerCase();
    if (seenFields.has(normalizedKey)) return;

    seenFields.add(normalizedKey);
    mergedFields.push(normalizedField);
  });

  return mergedFields;
};

const getNumericCardIdValue = (value) => {
  const normalized = normalizeValue(value).replace(/^#/, "");
  if (!/^\d+$/.test(normalized)) return null;

  const numericId = Number(normalized);
  return Number.isFinite(numericId) ? numericId : null;
};

const getNextAvailableCardId = (rows = [], fields = []) => {
  const highestExistingId = rows.reduce((highestId, row) => {
    const preview = getCardPreview(row?.rowData, fields);
    const numericId = getNumericCardIdValue(preview.id);

    if (!Number.isFinite(numericId)) {
      return highestId;
    }

    return Math.max(highestId, numericId);
  }, 0);

  return String(highestExistingId + 1);
};

const DEFAULT_QUICK_CARD_PRIORITY_OPTIONS = ["Low", "Medium", "High", "Critical"];

const getDefaultQuickCardDraft = ({
  defaultStatuses = [],
  statusOptions = [],
  priorityOptions = [],
  internalAssigneeOptions = [],
  internalStatusOptions = [],
} = {}) => ({
  title: "",
  imageUrl: "",
  status: defaultStatuses[0] || statusOptions[0] || "",
  priority: priorityOptions[0] || DEFAULT_QUICK_CARD_PRIORITY_OPTIONS[0] || "",
  dueDate: "",
  internalAssignee: internalAssigneeOptions[0] || "",
  internalStatus: internalStatusOptions[0] || "",
});

const resetQuickCardDraft = (previousDraft, fallbackDraft) => ({
  ...fallbackDraft,
  status: normalizeValue(previousDraft?.status) || fallbackDraft.status,
  priority: normalizeValue(previousDraft?.priority) || fallbackDraft.priority,
  internalAssignee: normalizeValue(previousDraft?.internalAssignee) || fallbackDraft.internalAssignee,
  internalStatus: normalizeValue(previousDraft?.internalStatus) || fallbackDraft.internalStatus,
});

const buildManualCardRow = ({ cardId, draft }) => {
  const normalizedCardId = normalizeValue(cardId);

  return {
    rowNumber: `manual-${normalizedCardId}`,
    isManual: true,
    rowData: {
      ID: normalizedCardId,
      Title: normalizeValue(draft?.title),
      Snapshot: normalizeUrl(draft?.imageUrl),
      Status: normalizeValue(draft?.status),
      Priority: normalizeValue(draft?.priority),
      "Due Date": normalizeValue(draft?.dueDate),
      Created: new Date().toISOString(),
      Source: "Manual",
    },
  };
};

const formatUploadTimestamp = (value) => {
  if (!value) return "";

  let dateValue = null;
  if (typeof value?.toDate === "function") {
    dateValue = value.toDate();
  } else if (typeof value?.seconds === "number") {
    dateValue = new Date(value.seconds * 1000);
  } else {
    dateValue = new Date(value);
  }

  if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) {
    return "";
  }

  return dateValue.toLocaleString();
};

const toCsvCell = (value) => {
  const normalized = normalizeValue(value);
  return `"${normalized.replace(/"/g, '""')}"`;
};

const downloadTextFile = ({ content, fileName, mimeType }) => {
  const fileBlob = new Blob([content], { type: mimeType });
  const objectUrl = window.URL.createObjectURL(fileBlob);
  const tempLink = document.createElement("a");
  tempLink.href = objectUrl;
  tempLink.download = fileName;
  document.body.appendChild(tempLink);
  tempLink.click();
  tempLink.remove();
  window.URL.revokeObjectURL(objectUrl);
};

const formatChangeValue = (value) => {
  const normalized = normalizeValue(value);
  if (!normalized) return "empty";
  if (normalized.length <= 120) return normalized;
  return `${normalized.slice(0, 117)}...`;
};

const formatFieldChangeMessage = (change) => {
  const fieldName = change?.field || "Field";
  const normalizedField = normalizeFieldKey(fieldName);
  const oldValue = normalizeValue(change?.oldValue);
  const newValue = normalizeValue(change?.newValue);

  if (normalizedField === "lastcomment") {
    if (!oldValue && newValue) {
      return `New comment added: ${formatChangeValue(newValue)}`;
    }

    if (oldValue && !newValue) {
      return "Comment was removed.";
    }

    return `Comment updated to: ${formatChangeValue(newValue)}`;
  }

  if (normalizedField.includes("status")) {
    if (!oldValue && newValue) {
      return `${fieldName} set to ${formatChangeValue(newValue)}.`;
    }

    if (oldValue && !newValue) {
      return `${fieldName} cleared. Previous value: ${formatChangeValue(oldValue)}.`;
    }

    return `${fieldName} changed from ${formatChangeValue(oldValue)} to ${formatChangeValue(newValue)}.`;
  }

  if (!oldValue && newValue) {
    return `${fieldName} added: ${formatChangeValue(newValue)}.`;
  }

  if (oldValue && !newValue) {
    return `${fieldName} cleared. Previous value: ${formatChangeValue(oldValue)}.`;
  }

  return `${fieldName} changed from ${formatChangeValue(oldValue)} to ${formatChangeValue(newValue)}.`;
};

const isStatusFieldName = (fieldName) => normalizeFieldKey(fieldName).includes("status");

const isCoordinateFieldName = (fieldName) => {
  const normalized = normalizeFieldKey(fieldName);
  if (!normalized) return false;

  if (
    [
      "x",
      "y",
      "z",
      "lat",
      "lng",
      "long",
      "latitude",
      "longitude",
      "northing",
      "easting",
    ].includes(normalized)
  ) {
    return true;
  }

  return normalized.includes("coord") || normalized.includes("coordinate");
};

const COMPLETION_STATUS_KEYWORDS = {
  complete: 100,
  completed: 100,
  done: 100,
  resolved: 100,
  closed: 100,
  approved: 95,
  review: 80,
  qa: 75,
  progress: 55,
  active: 50,
  working: 50,
  pending: 35,
  open: 25,
  todo: 20,
  new: 15,
  backlog: 10,
  blocked: 5,
};

const getKeywordCompletionScore = (statusValue) => {
  const normalized = normalizeFieldKey(statusValue);
  if (!normalized) return null;

  let bestScore = null;
  Object.entries(COMPLETION_STATUS_KEYWORDS).forEach(([keyword, score]) => {
    if (normalized.includes(keyword)) {
      bestScore = bestScore === null ? score : Math.max(bestScore, score);
    }
  });

  return bestScore;
};

const getOrderedCompletionScore = (statusValue, orderedStatuses = []) => {
  const normalized = normalizeValue(statusValue);
  if (!normalized || !orderedStatuses.length) return null;

  const index = orderedStatuses.findIndex((value) => normalizeValue(value) === normalized);
  if (index === -1) return null;
  if (orderedStatuses.length === 1) return 100;

  return Math.round((index / (orderedStatuses.length - 1)) * 100);
};

const getCompletionScore = (statusValue, orderedStatuses = []) => {
  const keywordScore = getKeywordCompletionScore(statusValue);
  const orderedScore = getOrderedCompletionScore(statusValue, orderedStatuses);

  if (orderedScore !== null) return orderedScore;
  return keywordScore;
};

const getStatusProgressHint = (change, orderedStatuses = []) => {
  if (!isStatusFieldName(change?.field)) return "";

  const previousScore = getCompletionScore(change?.oldValue, orderedStatuses);
  const nextScore = getCompletionScore(change?.newValue, orderedStatuses);

  if (previousScore === null || nextScore === null || previousScore === nextScore) {
    return "";
  }

  return nextScore > previousScore
    ? "Closer to completion"
    : "Moved away from completion";
};

const getLogStatusChanges = (log = {}) => {
  if (Array.isArray(log.statusChanges) && log.statusChanges.length) {
    return log.statusChanges;
  }

  if (!Array.isArray(log.changedRows) || !log.changedRows.length) {
    return [];
  }

  const extracted = [];
  log.changedRows.forEach((rowChange) => {
    const changedFields = Array.isArray(rowChange?.changedFields) ? rowChange.changedFields : [];
    changedFields.forEach((fieldChange) => {
      if (!isStatusFieldName(fieldChange?.field)) return;
      if (isCoordinateFieldName(fieldChange?.field)) return;
      extracted.push({
        ...fieldChange,
        rowKey: rowChange?.rowKey,
        rowNumber: rowChange?.rowNumber,
      });
    });
  });

  return extracted;
};

const getLogTimestamp = (log = {}) => log.uploadedAt || log.updatedAt || log.createdAt;

const BIM_MONTH_INDEX = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

const BIM_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

const parseBimDate = (value) => {
  const raw = normalizeValue(value);
  if (!raw) return null;

  const directDate = new Date(raw);
  if (!Number.isNaN(directDate.getTime())) {
    return directDate;
  }

  const match = raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return null;

  const [, dayText, monthText, yearText, hourText = "0", minuteText = "0", secondText = "0"] = match;
  const monthIndex = BIM_MONTH_INDEX[monthText.toLowerCase()];
  if (monthIndex === undefined) return null;

  const parsedDate = new Date(
    Number(yearText),
    monthIndex,
    Number(dayText),
    Number(hourText),
    Number(minuteText),
    Number(secondText)
  );

  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
};

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const addDays = (date, days) => {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
};

const countDatesInRange = (dates, start, endExclusive) =>
  dates.filter((date) => date >= start && date < endExclusive).length;

const formatTrendDelta = (current, previous) => {
  const delta = current - previous;
  if (delta === 0) {
    return {
      direction: "flat",
      text: `No change vs ${previous}`,
    };
  }

  return {
    direction: delta > 0 ? "up" : "down",
    text: `${delta > 0 ? "+" : ""}${delta} vs ${previous}`,
  };
};

const getExpectedDeadlineCountdown = (expectedDeadlineValue) => {
  const raw = normalizeValue(expectedDeadlineValue);
  if (!raw) return null;

  const deadline = new Date(raw);
  if (Number.isNaN(deadline.getTime())) return null;

  const now = new Date();
  const todayStart = startOfDay(now);
  const deadlineStart = startOfDay(deadline);
  const diffMs = deadlineStart.getTime() - todayStart.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return { label: "Due today", urgency: "today", diffDays };
  if (diffDays > 0) return { label: `${diffDays}d left`, urgency: diffDays <= 3 ? "critical" : diffDays <= 7 ? "warning" : "safe", diffDays };
  return { label: `${Math.abs(diffDays)}d overdue`, urgency: "overdue", diffDays };
};

const isResolvedStatus = (statusValue) => {
  const normalized = normalizeFieldKey(statusValue);
  if (!normalized) return false;

  return [
    "resolved",
    "done",
    "completed",
    "complete",
    "closed",
    "finished",
    "resuelto",
    "completado",
    "cerrado",
  ].some((keyword) => normalized.includes(keyword));
};

const getDaysSinceCreated = (rowData = {}, fields = []) => {
  const createdField = findFieldByAliases(fields, rowData, [
    "created",
    "date created",
    "created at",
    "start date",
    "opened",
    "fecha creacion",
  ]);

  const createdDate = parseBimDate(rowData?.[createdField]);
  if (!createdDate) return null;

  const now = new Date();
  const millisDiff = now.getTime() - createdDate.getTime();
  if (millisDiff < 0) return 0;

  return Math.floor(millisDiff / (1000 * 60 * 60 * 24));
};

const getCardMetaKey = (row = {}, preview = {}) => {
  const normalizedId = normalizeValue(preview?.id);
  if (normalizedId) return `id:${normalizedId}`;
  return `row:${row?.rowNumber || "unknown"}`;
};

const buildReviztoIssueLink = (template, cardId) => {
  const baseTemplate = normalizeValue(template);
  const normalizedCardId = normalizeValue(cardId).replace(/^#/, "");
  if (!baseTemplate || !normalizedCardId) return "";

  if (baseTemplate.includes("{id}")) {
    return baseTemplate.replaceAll("{id}", encodeURIComponent(normalizedCardId));
  }

  if (/issue_tracker\/\d+/i.test(baseTemplate)) {
    return baseTemplate.replace(/(issue_tracker\/)(\d+)/i, `$1${encodeURIComponent(normalizedCardId)}`);
  }

  const replacedTrailingNumbers = baseTemplate.replace(/\/\d+(?:\/\d+)*$/, `/${encodeURIComponent(normalizedCardId)}`);
  return replacedTrailingNumbers;
};

const BIM_COMMENT_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const toSafeFileSegment = (value) =>
  normalizeValue(value)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "file";

const buildBimCommentAttachmentPath = (churchId, projectId, rowValue, commentId, fileName) => {
  const safeName = toSafeFileSegment(fileName);
  const uniquePrefix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return [
    "churches",
    churchId,
    "bimProjects",
    projectId,
    "rows",
    String(rowValue),
    "comments",
    commentId,
    `${uniquePrefix}-${safeName}`,
  ].join("/");
};

const formatCommentTimestamp = (value) => {
  if (!value) return "";
  if (typeof value?.toDate === "function") {
    return formatUploadTimestamp(value.toDate());
  }
  return formatUploadTimestamp(value);
};

const buildProjectTrendStats = (rows = [], fields = []) => {
  const sampleRowData = rows?.[0]?.rowData || {};
  const dateField = findFieldByAliases(fields, sampleRowData, [
    "last updated",
    "updated",
    "modified",
    "created",
    "date created",
    "created at",
    "date",
  ]);
  const statusField = findFieldByAliases(fields, sampleRowData, ["status", "state", "task status"]);

  const parsedDates = rows
    .map((row) => parseBimDate(row?.rowData?.[dateField]))
    .filter(Boolean)
    .sort((a, b) => a - b);

  const now = new Date();
  const todayStart = startOfDay(now);
  const tomorrowStart = addDays(todayStart, 1);
  const yesterdayStart = addDays(todayStart, -1);
  const sevenDaysAgo = addDays(todayStart, -6);
  const previousSevenDaysStart = addDays(sevenDaysAgo, -7);
  const thirtyDaysAgo = addDays(todayStart, -29);
  const previousThirtyDaysStart = addDays(thirtyDaysAgo, -30);

  const todayCount = countDatesInRange(parsedDates, todayStart, tomorrowStart);
  const yesterdayCount = countDatesInRange(parsedDates, yesterdayStart, todayStart);
  const last7Count = countDatesInRange(parsedDates, sevenDaysAgo, tomorrowStart);
  const previous7Count = countDatesInRange(parsedDates, previousSevenDaysStart, sevenDaysAgo);
  const last30Count = countDatesInRange(parsedDates, thirtyDaysAgo, tomorrowStart);
  const previous30Count = countDatesInRange(parsedDates, previousThirtyDaysStart, thirtyDaysAgo);

  const totalRows = rows.length;
  const readyForReviewCount = rows.filter((row) => {
    const normalizedStatus = normalizeFieldKey(row?.rowData?.[statusField]);
    return normalizedStatus.includes("readyforreview");
  }).length;

  const readyForReviewPercent = totalRows
    ? Math.round((readyForReviewCount / totalRows) * 100)
    : 0;

  return {
    sourceField: dateField,
    statusField,
    trackedRows: parsedDates.length,
    totalRows,
    today: {
      total: todayCount,
      ...formatTrendDelta(todayCount, yesterdayCount),
      label: "Today",
      comparisonLabel: "vs yesterday",
    },
    week: {
      total: last7Count,
      ...formatTrendDelta(last7Count, previous7Count),
      label: "Last 7 days",
      comparisonLabel: "vs previous 7 days",
    },
    month: {
      total: last30Count,
      ...formatTrendDelta(last30Count, previous30Count),
      label: "Last 30 days",
      comparisonLabel: "vs previous 30 days",
    },
    readyForReview: {
      total: readyForReviewCount,
      pending: Math.max(totalRows - readyForReviewCount, 0),
      percent: readyForReviewPercent,
      label: "Ready for Review",
    },
  };
};

const BIMModule = () => {
  const { id, projectId: routeProjectId, rowNumber, bimView } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const fileInputRef = useRef(null);
  const [commentAttachmentInputKey, setCommentAttachmentInputKey] = useState(0);
  const [editAttachmentInputKey, setEditAttachmentInputKey] = useState(0);

  const [projects, setProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [activeProject, setActiveProject] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [internalAssigneeFilter, setInternalAssigneeFilter] = useState("all");
  const [internalStatusFilter, setInternalStatusFilter] = useState("all");
  const [idSearch, setIdSearch] = useState("");
  const [sortBy, setSortBy] = useState("default");
  const [detailFieldSearch, setDetailFieldSearch] = useState("");
  const [assignmentAssigneeFilter, setAssignmentAssigneeFilter] = useState("all");
  const [assignmentSearch, setAssignmentSearch] = useState("");
  const [statusDefaultsDraft, setStatusDefaultsDraft] = useState([]);
  const [savingStatusDefaults, setSavingStatusDefaults] = useState(false);
  const [showStatusDefaultsManager, setShowStatusDefaultsManager] = useState(false);
  const [showQuickCardCreator, setShowQuickCardCreator] = useState(false);
  const [showInternalOptionsManager, setShowInternalOptionsManager] = useState(false);
  const [showInternalFilters, setShowInternalFilters] = useState(false);
  const [cardInternalDrafts, setCardInternalDrafts] = useState({});
  const [savingCardMetaKey, setSavingCardMetaKey] = useState("");
  const [newInternalAssigneeOption, setNewInternalAssigneeOption] = useState("");
  const [newInternalStatusOption, setNewInternalStatusOption] = useState("");
  const [savingInternalOptions, setSavingInternalOptions] = useState(false);
  const [reviztoTemplateDraft, setReviztoTemplateDraft] = useState("");
  const [savingReviztoTemplate, setSavingReviztoTemplate] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [lightboxImage, setLightboxImage] = useState(null);
  const [deletingProjectId, setDeletingProjectId] = useState("");
  const [clearingProjectId, setClearingProjectId] = useState("");
  const [renamingProjectId, setRenamingProjectId] = useState("");
  const [selectedDetailFieldKey, setSelectedDetailFieldKey] = useState("");
  const [comments, setComments] = useState([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentAttachment, setCommentAttachment] = useState(null);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState("");
  const [editingCommentText, setEditingCommentText] = useState("");
  const [editingCommentAttachment, setEditingCommentAttachment] = useState(null);
  const [removeEditingAttachment, setRemoveEditingAttachment] = useState(false);
  const [savingCommentId, setSavingCommentId] = useState("");
  const [deletingCommentId, setDeletingCommentId] = useState("");
  const [quickCardDraft, setQuickCardDraft] = useState(() => getDefaultQuickCardDraft());
  const [creatingQuickCard, setCreatingQuickCard] = useState(false);

  const isAssignmentsView = bimView === "assignments";
  const previousProjectIdRef = useRef("");

  const projectsRef = useMemo(() => collection(db, "churches", id, "bimProjects"), [id]);
  const requestedProjectId = useMemo(() => {
    const fromQuery = new URLSearchParams(location.search).get("project");
    return routeProjectId || fromQuery || "";
  }, [location.search, routeProjectId]);

  const loadProjects = async () => {
    setLoadingProjects(true);
    try {
      const snapshot = await getDocs(query(projectsRef, orderBy("updatedAt", "desc"), limit(50)));
      const loaded = snapshot.docs.map((projectDoc) => ({
        id: projectDoc.id,
        ...projectDoc.data(),
      }));
      setProjects(loaded);

      if (requestedProjectId && loaded.some((project) => project.id === requestedProjectId)) {
        setActiveProjectId(requestedProjectId);
      } else if (!activeProjectId && loaded.length) {
        setActiveProjectId(loaded[0].id);
      }
    } catch (error) {
      if (isPermissionDeniedError(error)) {
        console.warn("BIM projects read denied for current auth state.");
        toast.error("BIM projects are not available for the current account.");
      } else {
        console.error("Error loading BIM projects:", error);
        toast.error("Could not load BIM projects.");
      }
    } finally {
      setLoadingProjects(false);
    }
  };

  const loadProjectDetails = async (projectId) => {
    if (!projectId) {
      setActiveProject(null);
      setLogs([]);
      return;
    }

    try {
      const projectRef = doc(db, "churches", id, "bimProjects", projectId);
      const projectSnapshot = await getDoc(projectRef);
      if (projectSnapshot.exists()) {
        setActiveProject({ id: projectSnapshot.id, ...projectSnapshot.data() });
      } else {
        setActiveProject(null);
      }
    } catch (error) {
      if (isPermissionDeniedError(error)) {
        console.warn("BIM project detail read denied for current auth state.");
        toast.error("Project details are not available for the current account.");
      } else {
        console.error("Error loading BIM project details:", error);
        toast.error("Could not load project details.");
      }
    }

    setLoadingLogs(true);
    try {
      const logsRef = collection(db, "churches", id, "bimProjects", projectId, "uploadLogs");
      const logsSnapshot = await getDocs(query(logsRef, orderBy("uploadedAt", "desc"), limit(20)));
      const loadedLogs = logsSnapshot.docs.map((logDoc) => ({ id: logDoc.id, ...logDoc.data() }));
      setLogs(loadedLogs);
    } catch (error) {
      if (isPermissionDeniedError(error)) {
        console.warn("BIM upload log read denied for current auth state.");
      } else {
        console.error("Error loading BIM upload logs:", error);
      }
      setLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    loadProjectDetails(activeProjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

  useEffect(() => {
    if (routeProjectId && routeProjectId !== activeProjectId) {
      setActiveProjectId(routeProjectId);
    }
  }, [routeProjectId, activeProjectId]);

  useEffect(() => {
    if (!lightboxImage) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setLightboxImage(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [lightboxImage]);

  const openLightbox = (imageUrl, imageLabel) => {
    setLightboxImage({
      url: imageUrl,
      label: imageLabel,
    });
  };

  const closeLightbox = () => {
    setLightboxImage(null);
  };

  const handleLogout = async () => {
    const returnUrl = `${location.pathname}${location.search}`;

    try {
      await logout();
      navigate(`/organization/${id}/login?returnUrl=${encodeURIComponent(returnUrl)}`, { replace: true });
    } catch (error) {
      console.error("Error logging out from BIM module:", error);
      toast.error("Could not log out. Please try again.");
    }
  };

  const handleCreateProject = async () => {
    const name = newProjectName.trim();
    if (!name) {
      toast.warn("Please enter a project name.");
      return;
    }

    setCreatingProject(true);
    try {
      const projectId = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const projectRef = doc(db, "churches", id, "bimProjects", projectId || `bim-project-${Date.now()}`);

      await setDoc(projectRef, {
        name,
        description: newProjectDescription.trim(),
        fields: [],
        rows: [],
        rowCount: 0,
        uploadCount: 0,
        createdBy: user?.uid || null,
        createdByEmail: user?.email || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: false });

      toast.success("Project created. Upload the first Excel now.");
      setNewProjectName("");
      setNewProjectDescription("");
      await loadProjects();
      setActiveProjectId(projectRef.id);

      setTimeout(() => {
        if (fileInputRef.current) {
          fileInputRef.current.click();
        }
      }, 150);
    } catch (error) {
      console.error("Error creating BIM project:", error);
      toast.error("Could not create BIM project.");
    } finally {
      setCreatingProject(false);
    }
  };

  const handleUploadFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const targetProjectId = activeProjectId;

    if (!targetProjectId) {
      toast.warn("Create or select a project before uploading.");
      event.target.value = "";
      return;
    }

    setUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const { headers: parsedHeaders, rows: parsedRows } = parseExcelRows(buffer);
      const previousRows = Array.isArray(activeProject?.rows) ? activeProject.rows : [];
      const manualRows = previousRows.filter((row) => row?.isManual);
      const headers = mergeProjectFields(
        parsedHeaders,
        manualRows.flatMap((row) => Object.keys(row?.rowData || {})),
        BIM_MANUAL_CARD_FIELDS
      );
      const rows = [...parsedRows, ...manualRows];

      const diff = computeUploadDiff(previousRows, rows, headers);
      const projectRef = doc(db, "churches", id, "bimProjects", targetProjectId);

      // Update UI immediately so cards appear as soon as upload succeeds.
      setActiveProject((previousProject) => {
        const matchingProject = projects.find((project) => project.id === targetProjectId);
        const baseProject = previousProject?.id === targetProjectId
          ? previousProject
          : {
              id: targetProjectId,
              name: matchingProject?.name || "BIM Project",
              description: matchingProject?.description || "",
            };

        return {
          ...baseProject,
          fields: headers,
          rows,
          rowCount: rows.length,
          uploadCount: (baseProject?.uploadCount || 0) + 1,
          lastFileName: file.name,
        };
      });

      setStatusFilter("all");
      setPriorityFilter("all");
      setAssigneeFilter("all");
      setIdSearch("");

      await setDoc(projectRef, {
        fields: headers,
        rows,
        rowCount: rows.length,
        uploadCount: (activeProject?.uploadCount || 0) + 1,
        lastFileName: file.name,
        lastUploadAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid || null,
        updatedByEmail: user?.email || null,
      }, { merge: true });

      const trimmedChanges = diff.changedRows.slice(0, 100).map((item) => ({
        rowKey: item.rowKey,
        rowNumber: item.rowNumber,
        changedFields: item.changedFields.slice(0, 25),
      }));

      await addDoc(collection(db, "churches", id, "bimProjects", targetProjectId, "uploadLogs"), {
        fileName: file.name,
        uploadedAt: serverTimestamp(),
        uploadedBy: user?.uid || null,
        uploadedByEmail: user?.email || null,
        summary: diff.summary,
        changedRows: trimmedChanges,
        deletedRows: diff.deletedRows.slice(0, 100),
      });

      toast.success(
        `Upload complete: ${diff.summary.added} added, ${diff.summary.updated} updated, ${diff.summary.deleted} removed.`
      );

      await loadProjects();
      await loadProjectDetails(targetProjectId);
    } catch (error) {
      console.error("Error uploading BIM Excel:", error);
      toast.error(error?.message || "Could not process Excel upload.");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  const handleDeleteProject = async (project) => {
    if (!project?.id) return;

    const confirmed = window.confirm(`Delete BIM project "${project.name || project.id}"? This will remove the project and its upload log.`);
    if (!confirmed) return;

    setDeletingProjectId(project.id);
    try {
      const logsRef = collection(db, "churches", id, "bimProjects", project.id, "uploadLogs");
      const logsSnapshot = await getDocs(logsRef);
      await Promise.all(logsSnapshot.docs.map((logDoc) => deleteDoc(logDoc.ref)));

      await deleteDoc(doc(db, "churches", id, "bimProjects", project.id));

      if (activeProjectId === project.id) {
        const remainingProjects = projects.filter((item) => item.id !== project.id);
        setActiveProjectId(remainingProjects[0]?.id || "");
        if (!remainingProjects.length) {
          setActiveProject(null);
          setLogs([]);
        }
      }

      toast.success("BIM project deleted.");
      await loadProjects();
    } catch (error) {
      console.error("Error deleting BIM project:", error);
      toast.error("Could not delete BIM project.");
    } finally {
      setDeletingProjectId("");
    }
  };

  const handleClearProjectRows = async (project) => {
    if (!project?.id) return;

    const projectName = normalizeValue(project.name) || project.id;
    const confirmed = window.confirm(
      `Delete all rows from BIM project "${projectName}" and keep the existing columns?`
    );
    if (!confirmed) return;

    setClearingProjectId(project.id);
    try {
      const nextFields = Array.isArray(project.fields) ? project.fields : [];
      const projectRef = doc(db, "churches", id, "bimProjects", project.id);

      await setDoc(projectRef, {
        fields: nextFields,
        rows: [],
        rowCount: 0,
        internalCardMeta: {},
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid || null,
        updatedByEmail: user?.email || null,
      }, { merge: true });

      setProjects((previousProjects) => previousProjects.map((item) => (
        item.id === project.id
          ? {
              ...item,
              fields: nextFields,
              rows: [],
              rowCount: 0,
              internalCardMeta: {},
            }
          : item
      )));

      if (activeProjectId === project.id) {
        setActiveProject((previousProject) => (
          previousProject
            ? {
                ...previousProject,
                fields: nextFields,
                rows: [],
                rowCount: 0,
                internalCardMeta: {},
              }
            : previousProject
        ));
        setLogs([]);
      }

      toast.success("All BIM rows were deleted. Columns were preserved.");
      await loadProjects();
      if (activeProjectId === project.id) {
        await loadProjectDetails(project.id);
      }
    } catch (error) {
      console.error("Error clearing BIM project rows:", error);
      toast.error("Could not delete BIM rows.");
    } finally {
      setClearingProjectId("");
    }
  };

  const handleRenameProject = async (project) => {
    if (!project?.id) return;

    const currentName = normalizeValue(project.name) || project.id;
    const enteredName = window.prompt("Enter the new project name:", currentName);
    if (enteredName === null) return;

    const nextName = enteredName.trim();
    if (!nextName) {
      toast.warn("Project name cannot be empty.");
      return;
    }

    if (nextName === currentName) {
      return;
    }

    setRenamingProjectId(project.id);
    try {
      const projectRef = doc(db, "churches", id, "bimProjects", project.id);
      await setDoc(projectRef, {
        name: nextName,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid || null,
        updatedByEmail: user?.email || null,
      }, { merge: true });

      setProjects((previousProjects) => previousProjects.map((item) => (
        item.id === project.id ? { ...item, name: nextName } : item
      )));

      if (activeProjectId === project.id) {
        setActiveProject((previousProject) => (
          previousProject ? { ...previousProject, name: nextName } : previousProject
        ));
      }

      toast.success("BIM project renamed.");
      await loadProjects();
    } catch (error) {
      console.error("Error renaming BIM project:", error);
      toast.error("Could not rename BIM project.");
    } finally {
      setRenamingProjectId("");
    }
  };

  const rowsToRender = activeProject?.rows || [];
  const fieldsToRender = activeProject?.fields || [];
  const cardRows = useMemo(
    () => rowsToRender.map((row, index) => {
      const preview = getCardPreview(row.rowData, fieldsToRender);
      const daysSinceCreated = getDaysSinceCreated(row.rowData, fieldsToRender);
      const unresolvedAgeDays = !isResolvedStatus(preview.status) && Number.isFinite(daysSinceCreated)
        ? daysSinceCreated
        : -1;

      return {
        row,
        index,
        preview,
        daysSinceCreated,
        unresolvedAgeDays,
      };
    }),
    [rowsToRender, fieldsToRender]
  );

  const cardIdentityByRowNumber = useMemo(() => {
    const lookup = new Map();
    cardRows.forEach(({ row, preview }) => {
      const rowNumber = normalizeValue(row?.rowNumber);
      if (!rowNumber) return;
      lookup.set(rowNumber, {
        id: normalizeValue(preview?.id),
        title: normalizeValue(preview?.title),
      });
    });
    return lookup;
  }, [cardRows]);

  const cardIdentityById = useMemo(() => {
    const lookup = new Map();
    cardRows.forEach(({ preview }) => {
      const cardId = normalizeValue(preview?.id);
      if (!cardId) return;
      lookup.set(cardId, {
        id: cardId,
        title: normalizeValue(preview?.title),
      });
    });
    return lookup;
  }, [cardRows]);

  const getLogCardIdentity = (change, log) => {
    const directId = normalizeValue(log?.cardId);
    const directTitle = normalizeValue(log?.cardTitle);
    if (directId || directTitle) {
      return {
        id: directId,
        title: directTitle,
      };
    }

    const rowKey = normalizeValue(change?.rowKey);
    if (rowKey.includes(":")) {
      const keyValue = normalizeValue(rowKey.split(":").slice(1).join(":"));
      const byId = cardIdentityById.get(keyValue);
      if (byId) return byId;
    }

    const byRow = cardIdentityByRowNumber.get(normalizeValue(change?.rowNumber));
    if (byRow) return byRow;

    return {
      id: "",
      title: "",
    };
  };

  const formatLogChangeLabel = (change, log) => {
    const identity = getLogCardIdentity(change, log);
    if (identity.id || identity.title) {
      const left = identity.id ? `#${identity.id}` : "Card";
      const right = identity.title || "Untitled";
      return `${left} - ${right}`;
    }

    return change?.rowNumber ? `Row ${change.rowNumber}` : "Card";
  };

  const statusOptions = useMemo(() => {
    const values = cardRows
      .map((item) => normalizeValue(item.preview?.status))
      .filter(Boolean);
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
  }, [cardRows]);

  const priorityOptions = useMemo(() => {
    const values = cardRows
      .map((item) => normalizeValue(item.preview?.priority))
      .filter(Boolean);
    return Array.from(new Set([
      ...DEFAULT_QUICK_CARD_PRIORITY_OPTIONS,
      ...values,
    ])).sort((a, b) => a.localeCompare(b));
  }, [cardRows]);

  const assigneeOptions = useMemo(() => {
    const values = cardRows
      .map((item) => normalizeValue(item.preview?.assignee))
      .filter(Boolean);
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
  }, [cardRows]);

  const activeProjectDefaultStatuses = useMemo(() => {
    if (!Array.isArray(activeProject?.defaultStatuses)) return [];
    return activeProject.defaultStatuses.map((value) => normalizeValue(value)).filter(Boolean);
  }, [activeProject]);

  const nextQuickCardId = useMemo(
    () => getNextAvailableCardId(rowsToRender, fieldsToRender),
    [rowsToRender, fieldsToRender]
  );

  const configurableStatusOptions = useMemo(() => {
    return Array.from(new Set([...statusOptions, ...activeProjectDefaultStatuses])).sort((a, b) => a.localeCompare(b));
  }, [statusOptions, activeProjectDefaultStatuses]);

  const projectInternalCardMeta = useMemo(() => {
    if (!activeProject?.internalCardMeta || typeof activeProject.internalCardMeta !== "object") {
      return {};
    }
    return activeProject.internalCardMeta;
  }, [activeProject]);

  const projectInternalAssigneeOptions = useMemo(() => {
    if (!Array.isArray(activeProject?.internalAssigneeOptions)) return [];
    return activeProject.internalAssigneeOptions.map((value) => normalizeValue(value)).filter(Boolean);
  }, [activeProject]);

  const projectInternalStatusOptions = useMemo(() => {
    if (!Array.isArray(activeProject?.internalStatusOptions)) return [];
    return activeProject.internalStatusOptions.map((value) => normalizeValue(value)).filter(Boolean);
  }, [activeProject]);

  const internalAssigneeOptions = useMemo(() => {
    const fromSavedMeta = Object.values(projectInternalCardMeta || {})
      .map((item) => normalizeValue(item?.internalAssignee))
      .filter(Boolean);

    return Array.from(new Set([
      ...projectInternalAssigneeOptions,
      ...fromSavedMeta,
    ])).sort((a, b) => a.localeCompare(b));
  }, [projectInternalAssigneeOptions, projectInternalCardMeta]);

  const internalStatusOptions = useMemo(() => {
    const fromSavedMeta = Object.values(projectInternalCardMeta || {})
      .map((item) => normalizeValue(item?.internalStatus))
      .filter(Boolean);

    // Respect project-defined ordering first, then append discovered values.
    const ordered = [...projectInternalStatusOptions];
    const seen = new Set(ordered.map((value) => value.toLowerCase()));

    fromSavedMeta.forEach((value) => {
      const normalized = value.toLowerCase();
      if (!seen.has(normalized)) {
        ordered.push(value);
        seen.add(normalized);
      }
    });

    return ordered;
  }, [projectInternalStatusOptions, projectInternalCardMeta]);

  const filteredCardRows = useMemo(() => {
    const search = normalizeValue(idSearch).toLowerCase();

    return cardRows.filter(({ row, preview }) => {
      const cardKey = getCardMetaKey(row, preview);
      const internalDraft = cardInternalDrafts?.[cardKey] || projectInternalCardMeta?.[cardKey] || {};
      const normalizedInternalAssignee = normalizeValue(internalDraft?.internalAssignee);
      const normalizedInternalStatus = normalizeValue(internalDraft?.internalStatus);
      const normalizedStatus = normalizeValue(preview?.status);
      const statusMatch = statusFilter === "all"
        || (statusFilter === "default"
          ? (!activeProjectDefaultStatuses.length || activeProjectDefaultStatuses.includes(normalizedStatus))
          : normalizedStatus === statusFilter);
      const priorityMatch = priorityFilter === "all" || normalizeValue(preview?.priority) === priorityFilter;
      const assigneeMatch = assigneeFilter === "all" || normalizeValue(preview?.assignee) === assigneeFilter;
      const internalAssigneeMatch = internalAssigneeFilter === "all" || normalizedInternalAssignee === internalAssigneeFilter;
      const internalStatusMatch = internalStatusFilter === "all" || normalizedInternalStatus === internalStatusFilter;
      const idMatch = !search || normalizeValue(preview?.id).toLowerCase().includes(search);

      return statusMatch && priorityMatch && assigneeMatch && internalAssigneeMatch && internalStatusMatch && idMatch;
    });
  }, [
    cardRows,
    statusFilter,
    priorityFilter,
    assigneeFilter,
    internalAssigneeFilter,
    internalStatusFilter,
    idSearch,
    activeProjectDefaultStatuses,
    cardInternalDrafts,
    projectInternalCardMeta,
  ]);

  const sortedCardRows = useMemo(() => {
    if (sortBy === "days_unresolved_desc") {
      return [...filteredCardRows].sort((a, b) => b.unresolvedAgeDays - a.unresolvedAgeDays);
    }

    return filteredCardRows;
  }, [filteredCardRows, sortBy]);

  const totalCardPages = useMemo(() => {
    if (!sortedCardRows.length) return 1;
    return Math.ceil(sortedCardRows.length / rowsPerPage);
  }, [sortedCardRows.length, rowsPerPage]);

  const paginatedCardRows = useMemo(() => {
    const startIndex = (currentPage - 1) * rowsPerPage;
    return sortedCardRows.slice(startIndex, startIndex + rowsPerPage);
  }, [sortedCardRows, currentPage, rowsPerPage]);

  useEffect(() => {
    setStatusFilter("all");
    setPriorityFilter("all");
    setAssigneeFilter("all");
    setInternalAssigneeFilter("all");
    setInternalStatusFilter("all");
    setIdSearch("");
    setSortBy("default");
    setCurrentPage(1);
    setShowQuickCardCreator(false);
  }, [activeProjectId]);

  useEffect(() => {
    const projectChanged = previousProjectIdRef.current !== activeProjectId;

    setStatusDefaultsDraft(activeProjectDefaultStatuses);

    if (projectChanged) {
      setStatusFilter(activeProjectDefaultStatuses.length ? "default" : "all");
      setShowStatusDefaultsManager(false);
      setShowInternalOptionsManager(false);
      setShowInternalFilters(false);
      previousProjectIdRef.current = activeProjectId;
    }
  }, [activeProjectId, activeProjectDefaultStatuses]);

  useEffect(() => {
    setReviztoTemplateDraft(normalizeValue(activeProject?.reviztoIssueLinkTemplate));
  }, [activeProjectId, activeProject?.reviztoIssueLinkTemplate]);

  useEffect(() => {
    const nextDrafts = {};
    cardRows.forEach(({ row, preview }) => {
      const cardKey = getCardMetaKey(row, preview);
      const currentValues = projectInternalCardMeta?.[cardKey] || {};
      nextDrafts[cardKey] = {
        internalAssignee: normalizeValue(currentValues.internalAssignee),
        internalStatus: normalizeValue(currentValues.internalStatus),
        expectedDeadline: normalizeValue(currentValues.expectedDeadline),
      };
    });
    setCardInternalDrafts(nextDrafts);
  }, [activeProjectId, cardRows, projectInternalCardMeta]);

  useEffect(() => {
    setAssignmentAssigneeFilter("all");
    setAssignmentSearch("");
  }, [activeProjectId]);

  useEffect(() => {
    setQuickCardDraft(
      getDefaultQuickCardDraft({
        defaultStatuses: activeProjectDefaultStatuses,
        statusOptions,
        priorityOptions,
        internalAssigneeOptions,
        internalStatusOptions,
      })
    );
  }, [
    activeProjectId,
    activeProjectDefaultStatuses,
    statusOptions,
    priorityOptions,
    internalAssigneeOptions,
    internalStatusOptions,
  ]);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    statusFilter,
    priorityFilter,
    assigneeFilter,
    internalAssigneeFilter,
    internalStatusFilter,
    idSearch,
    rowsPerPage,
    sortBy,
  ]);

  useEffect(() => {
    if (currentPage > totalCardPages) {
      setCurrentPage(totalCardPages);
    }
  }, [currentPage, totalCardPages]);

  useEffect(() => {
    if (!routeProjectId || !rowNumber) {
      setComments([]);
      setLoadingComments(false);
      return undefined;
    }

    setLoadingComments(true);
    const commentsRef = collection(
      db,
      "churches",
      id,
      "bimProjects",
      routeProjectId,
      "rows",
      String(rowNumber),
      "comments"
    );
    const commentsQuery = query(commentsRef, orderBy("createdAt", "desc"));

    const unsubscribe = onSnapshot(
      commentsQuery,
      (snapshot) => {
        const loadedComments = snapshot.docs.map((commentDoc) => ({
          id: commentDoc.id,
          ...commentDoc.data(),
        }));
        setComments(loadedComments);
        setLoadingComments(false);
      },
      (error) => {
        console.error("Error loading BIM row comments:", error);
        if (isPermissionDeniedError(error)) {
          toast.error("Comments are not available for this account.");
        }
        setComments([]);
        setLoadingComments(false);
      }
    );

    return () => unsubscribe();
  }, [id, routeProjectId, rowNumber]);

  useEffect(() => {
    setCommentDraft("");
    setCommentAttachment(null);
    setCommentAttachmentInputKey((previous) => previous + 1);
    setEditingCommentId("");
    setEditingCommentText("");
    setEditingCommentAttachment(null);
    setRemoveEditingAttachment(false);
    setEditAttachmentInputKey((previous) => previous + 1);
  }, [routeProjectId, rowNumber]);

  const selectedRow = useMemo(() => {
    if (!rowNumber || !rowsToRender.length) return null;
    return rowsToRender.find((row, index) =>
      String(row?.rowNumber) === String(rowNumber) || String(index + 1) === String(rowNumber)
    ) || null;
  }, [rowNumber, rowsToRender]);

  const detailFieldEntries = useMemo(() => {
    if (!selectedRow) return [];

    const search = normalizeValue(detailFieldSearch).toLowerCase();
    const fields = fieldsToRender.length ? fieldsToRender : Object.keys(selectedRow?.rowData || {});

    return fields
      .map((field, index) => {
        const value = normalizeValue(selectedRow?.rowData?.[field]) || "-";
        return {
          field,
          value,
          key: `bim-detail-field-${index}`,
        };
      })
      .filter((item) => {
        if (!search) return true;
        return item.field.toLowerCase().includes(search) || item.value.toLowerCase().includes(search);
      });
  }, [selectedRow, fieldsToRender, detailFieldSearch]);

  const selectedDetailField = useMemo(
    () => detailFieldEntries.find((item) => item.key === selectedDetailFieldKey) || null,
    [detailFieldEntries, selectedDetailFieldKey]
  );

  useEffect(() => {
    setSelectedDetailFieldKey("");
  }, [routeProjectId, rowNumber, detailFieldSearch]);

  useEffect(() => {
    if (!selectedDetailFieldKey) return;

    const stillExists = detailFieldEntries.some((entry) => entry.key === selectedDetailFieldKey);
    if (!stillExists) {
      setSelectedDetailFieldKey("");
    }
  }, [detailFieldEntries, selectedDetailFieldKey]);

  const assignmentCards = useMemo(() => {
    return [...cardRows]
      .map(({ row, preview, daysSinceCreated, unresolvedAgeDays }) => {
        const cardKey = getCardMetaKey(row, preview);
        const savedMeta = cardInternalDrafts?.[cardKey] || projectInternalCardMeta?.[cardKey] || {};

        return {
          row,
          preview,
          cardKey,
          internalAssignee: normalizeValue(savedMeta.internalAssignee) || "Unassigned",
          internalStatus: normalizeValue(savedMeta.internalStatus) || "No internal status",
          daysSinceCreated,
          unresolvedAgeDays,
        };
      })
      .sort((a, b) => {
        if (a.internalAssignee === "Unassigned" && b.internalAssignee !== "Unassigned") return 1;
        if (b.internalAssignee === "Unassigned" && a.internalAssignee !== "Unassigned") return -1;

        const assigneeCompare = a.internalAssignee.localeCompare(b.internalAssignee);
        if (assigneeCompare !== 0) return assigneeCompare;

        const statusCompare = a.internalStatus.localeCompare(b.internalStatus);
        if (statusCompare !== 0) return statusCompare;

        const titleCompare = normalizeValue(a.preview?.title).localeCompare(normalizeValue(b.preview?.title));
        if (titleCompare !== 0) return titleCompare;

        return String(a.row?.rowNumber).localeCompare(String(b.row?.rowNumber), undefined, { numeric: true });
      });
  }, [cardRows, cardInternalDrafts, projectInternalCardMeta]);

  const assignmentSummary = useMemo(() => {
    const statusCounts = {};
    let assignedCards = 0;
    let unassignedCards = 0;

    assignmentCards.forEach((card) => {
      if (card.internalAssignee === "Unassigned") {
        unassignedCards += 1;
      } else {
        assignedCards += 1;
      }

      statusCounts[card.internalStatus] = (statusCounts[card.internalStatus] || 0) + 1;
    });

    return {
      assigneeCount: Array.from(new Set(assignmentCards.map((card) => card.internalAssignee).filter((value) => value !== "Unassigned"))).length,
      assignedCards,
      unassignedCards,
      statusCounts: Object.entries(statusCounts).sort((a, b) => b[1] - a[1]),
    };
  }, [assignmentCards]);

  const assignmentAssigneeOptions = useMemo(
    () => Array.from(new Set(assignmentCards.map((card) => card.internalAssignee))),
    [assignmentCards]
  );

  const filteredAssignmentCards = useMemo(() => {
    const search = normalizeValue(assignmentSearch).toLowerCase();

    return assignmentCards.filter((card) => {
      if (assignmentAssigneeFilter !== "all" && card.internalAssignee !== assignmentAssigneeFilter) {
        return false;
      }

      if (!search) return true;

      return [
        card.internalAssignee,
        card.preview?.title,
        card.preview?.id,
        card.preview?.status,
        card.preview?.priority,
        card.internalStatus,
        String(card.row?.rowNumber),
      ].some((value) => normalizeValue(value).toLowerCase().includes(search));
    });
  }, [assignmentCards, assignmentAssigneeFilter, assignmentSearch]);

  const filteredAssignmentSummary = useMemo(() => {
    const statusCounts = {};
    let assignedCards = 0;
    let unassignedCards = 0;

    filteredAssignmentCards.forEach((card) => {
      if (card.internalAssignee === "Unassigned") {
        unassignedCards += 1;
      } else {
        assignedCards += 1;
      }

      statusCounts[card.internalStatus] = (statusCounts[card.internalStatus] || 0) + 1;
    });

    return {
      assigneeCount: Array.from(new Set(filteredAssignmentCards.map((card) => card.internalAssignee).filter((value) => value !== "Unassigned"))).length,
      assignedCards,
      unassignedCards,
      visibleCards: filteredAssignmentCards.length,
      statusCounts: Object.entries(statusCounts).sort((a, b) => b[1] - a[1]),
    };
  }, [filteredAssignmentCards]);

  const handleExportAssignmentsCsv = () => {
    if (!filteredAssignmentCards.length) {
      toast.warn("No assignment cards to export.");
      return;
    }

    const csvHeaders = [
      "Project",
      "Row Number",
      "Card ID",
      "Title",
      "Status",
      "Priority",
      "Assignee",
      "Deadline",
      "Internal Assignee",
      "Internal Status",
      "Days Since Created",
      "Not Resolved Age (days)",
    ];

    const csvRows = filteredAssignmentCards.map((card) => {
      const unresolvedAge = card.unresolvedAgeDays >= 0 ? card.unresolvedAgeDays : "Resolved";
      return [
        activeProject?.name || "",
        card.row?.rowNumber || "",
        card.preview?.id || "",
        card.preview?.title || "",
        card.preview?.status || "",
        card.preview?.priority || "",
        card.preview?.assignee || "",
        card.preview?.deadline || "",
        card.internalAssignee || "",
        card.internalStatus || "",
        Number.isFinite(card.daysSinceCreated) ? card.daysSinceCreated : "",
        unresolvedAge,
      ];
    });

    const csvContent = [
      csvHeaders.map(toCsvCell).join(","),
      ...csvRows.map((rowValues) => rowValues.map(toCsvCell).join(",")),
    ].join("\r\n");

    const safeProjectName = normalizeValue(activeProject?.name)
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "bim-project";
    const dateStamp = new Date().toISOString().slice(0, 10);

    downloadTextFile({
      content: csvContent,
      fileName: `${safeProjectName}-assignments-${dateStamp}.csv`,
      mimeType: "text/csv;charset=utf-8;",
    });

    toast.success(`Exported ${filteredAssignmentCards.length} assignment cards to CSV.`);
  };

  const handleExportBoardCsv = () => {
    if (!filteredCardRows.length) {
      toast.warn("No row cards to export.");
      return;
    }

    const csvHeaders = [
      "Project",
      "Row Number",
      "Card ID",
      "Title",
      "Status",
      "Priority",
      "Assignee",
      "Deadline",
      "Internal Assignee",
      "Internal Status",
      "Days Since Created",
      "Not Resolved Age (days)",
    ];

    const csvRows = filteredCardRows.map(({ row, preview, daysSinceCreated, unresolvedAgeDays }) => {
      const cardKey = getCardMetaKey(row, preview);
      const internalDraft = cardInternalDrafts?.[cardKey] || projectInternalCardMeta?.[cardKey] || {};
      const unresolvedAge = unresolvedAgeDays >= 0 ? unresolvedAgeDays : "Resolved";

      return [
        activeProject?.name || "",
        row?.rowNumber || "",
        preview?.id || "",
        preview?.title || "",
        preview?.status || "",
        preview?.priority || "",
        preview?.assignee || "",
        preview?.deadline || "",
        normalizeValue(internalDraft?.internalAssignee),
        normalizeValue(internalDraft?.internalStatus),
        Number.isFinite(daysSinceCreated) ? daysSinceCreated : "",
        unresolvedAge,
      ];
    });

    const csvContent = [
      csvHeaders.map(toCsvCell).join(","),
      ...csvRows.map((rowValues) => rowValues.map(toCsvCell).join(",")),
    ].join("\r\n");

    const safeProjectName = normalizeValue(activeProject?.name)
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "bim-project";
    const dateStamp = new Date().toISOString().slice(0, 10);

    downloadTextFile({
      content: csvContent,
      fileName: `${safeProjectName}-row-cards-${dateStamp}.csv`,
      mimeType: "text/csv;charset=utf-8;",
    });

    toast.success(`Exported ${filteredCardRows.length} row cards to CSV.`);
  };

  const projectTrendStats = useMemo(
    () => buildProjectTrendStats(rowsToRender, fieldsToRender),
    [rowsToRender, fieldsToRender]
  );

  const handleToggleStatusDefault = (statusValue) => {
    setStatusDefaultsDraft((previousValues) => {
      if (previousValues.includes(statusValue)) {
        return previousValues.filter((value) => value !== statusValue);
      }

      return [...previousValues, statusValue].sort((a, b) => a.localeCompare(b));
    });
  };

  const handleSaveStatusDefaults = async () => {
    if (!activeProjectId) {
      toast.warn("Select a project first.");
      return;
    }

    setSavingStatusDefaults(true);
    try {
      const projectRef = doc(db, "churches", id, "bimProjects", activeProjectId);
      await setDoc(projectRef, {
        defaultStatuses: statusDefaultsDraft,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid || null,
        updatedByEmail: user?.email || null,
      }, { merge: true });

      setActiveProject((previousProject) => (
        previousProject ? { ...previousProject, defaultStatuses: statusDefaultsDraft } : previousProject
      ));
      setProjects((previousProjects) => previousProjects.map((project) => (
        project.id === activeProjectId ? { ...project, defaultStatuses: statusDefaultsDraft } : project
      )));
      setStatusFilter(statusDefaultsDraft.length ? "default" : "all");
      setShowStatusDefaultsManager(false);
      toast.success("Default statuses updated for this project.");
    } catch (error) {
      console.error("Error saving project default statuses:", error);
      toast.error("Could not save default statuses.");
    } finally {
      setSavingStatusDefaults(false);
    }
  };

  const handleAddInternalOption = async (optionType) => {
    if (!activeProjectId) {
      toast.warn("Select a project first.");
      return;
    }

    const isAssignee = optionType === "assignee";
    const rawValue = isAssignee ? newInternalAssigneeOption : newInternalStatusOption;
    const nextValue = normalizeValue(rawValue);

    if (!nextValue) {
      toast.warn(`Enter an internal ${isAssignee ? "assignee" : "status"} value first.`);
      return;
    }

    const currentList = isAssignee ? projectInternalAssigneeOptions : projectInternalStatusOptions;
    const exists = currentList.some((value) => value.toLowerCase() === nextValue.toLowerCase());
    if (exists) {
      toast.info(`That internal ${isAssignee ? "assignee" : "status"} already exists.`);
      return;
    }

    const updatedList = [...currentList, nextValue];
    setSavingInternalOptions(true);
    try {
      const updateField = isAssignee ? "internalAssigneeOptions" : "internalStatusOptions";
      const projectRef = doc(db, "churches", id, "bimProjects", activeProjectId);
      await setDoc(projectRef, {
        [updateField]: updatedList,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid || null,
        updatedByEmail: user?.email || null,
      }, { merge: true });

      setActiveProject((previousProject) => (
        previousProject
          ? {
              ...previousProject,
              [updateField]: updatedList,
            }
          : previousProject
      ));

      setProjects((previousProjects) => previousProjects.map((project) => (
        project.id === activeProjectId
          ? {
              ...project,
              [updateField]: updatedList,
            }
          : project
      )));

      if (isAssignee) {
        setNewInternalAssigneeOption("");
      } else {
        setNewInternalStatusOption("");
      }

      toast.success(`Internal ${isAssignee ? "assignee" : "status"} added.`);
    } catch (error) {
      console.error("Error adding internal option:", error);
      toast.error("Could not add internal option.");
    } finally {
      setSavingInternalOptions(false);
    }
  };

  const handleEditInternalOption = async (optionType, currentValue) => {
    if (!activeProjectId) {
      toast.warn("Select a project first.");
      return;
    }

    const isAssignee = optionType === "assignee";
    const nextValueRaw = window.prompt(`Edit internal ${isAssignee ? "assignee" : "status"}:`, currentValue);
    if (nextValueRaw === null) return;

    const nextValue = normalizeValue(nextValueRaw);
    if (!nextValue) {
      toast.warn("Value cannot be empty.");
      return;
    }

    const currentList = isAssignee ? projectInternalAssigneeOptions : projectInternalStatusOptions;
    const duplicateExists = currentList.some((value) => value.toLowerCase() === nextValue.toLowerCase() && value !== currentValue);
    if (duplicateExists) {
      toast.info(`That internal ${isAssignee ? "assignee" : "status"} already exists.`);
      return;
    }

    const updatedList = currentList
      .map((value) => (value === currentValue ? nextValue : value));

    setSavingInternalOptions(true);
    try {
      const updateField = isAssignee ? "internalAssigneeOptions" : "internalStatusOptions";
      const projectRef = doc(db, "churches", id, "bimProjects", activeProjectId);
      await setDoc(projectRef, {
        [updateField]: updatedList,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid || null,
        updatedByEmail: user?.email || null,
      }, { merge: true });

      setActiveProject((previousProject) => (
        previousProject ? { ...previousProject, [updateField]: updatedList } : previousProject
      ));
      setProjects((previousProjects) => previousProjects.map((project) => (
        project.id === activeProjectId ? { ...project, [updateField]: updatedList } : project
      )));

      // Keep existing card selections aligned with renamed option.
      setCardInternalDrafts((previousDrafts) => {
        const updatedDrafts = { ...previousDrafts };
        Object.keys(updatedDrafts).forEach((key) => {
          const currentDraft = updatedDrafts[key] || {};
          if (isAssignee && currentDraft.internalAssignee === currentValue) {
            updatedDrafts[key] = { ...currentDraft, internalAssignee: nextValue };
          }
          if (!isAssignee && currentDraft.internalStatus === currentValue) {
            updatedDrafts[key] = { ...currentDraft, internalStatus: nextValue };
          }
        });
        return updatedDrafts;
      });

      toast.success(`Internal ${isAssignee ? "assignee" : "status"} updated.`);
    } catch (error) {
      console.error("Error editing internal option:", error);
      toast.error("Could not update internal option.");
    } finally {
      setSavingInternalOptions(false);
    }
  };

  const handleRemoveInternalOption = async (optionType, currentValue) => {
    if (!activeProjectId) {
      toast.warn("Select a project first.");
      return;
    }

    const isAssignee = optionType === "assignee";
    const confirmed = window.confirm(`Remove internal ${isAssignee ? "assignee" : "status"} "${currentValue}"?`);
    if (!confirmed) return;

    const currentList = isAssignee ? projectInternalAssigneeOptions : projectInternalStatusOptions;
    const updatedList = currentList.filter((value) => value !== currentValue);

    setSavingInternalOptions(true);
    try {
      const updateField = isAssignee ? "internalAssigneeOptions" : "internalStatusOptions";
      const projectRef = doc(db, "churches", id, "bimProjects", activeProjectId);
      await setDoc(projectRef, {
        [updateField]: updatedList,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid || null,
        updatedByEmail: user?.email || null,
      }, { merge: true });

      setActiveProject((previousProject) => (
        previousProject ? { ...previousProject, [updateField]: updatedList } : previousProject
      ));
      setProjects((previousProjects) => previousProjects.map((project) => (
        project.id === activeProjectId ? { ...project, [updateField]: updatedList } : project
      )));

      // Remove deleted option from unsaved card drafts.
      setCardInternalDrafts((previousDrafts) => {
        const updatedDrafts = { ...previousDrafts };
        Object.keys(updatedDrafts).forEach((key) => {
          const currentDraft = updatedDrafts[key] || {};
          if (isAssignee && currentDraft.internalAssignee === currentValue) {
            updatedDrafts[key] = { ...currentDraft, internalAssignee: "" };
          }
          if (!isAssignee && currentDraft.internalStatus === currentValue) {
            updatedDrafts[key] = { ...currentDraft, internalStatus: "" };
          }
        });
        return updatedDrafts;
      });

      toast.success(`Internal ${isAssignee ? "assignee" : "status"} removed.`);
    } catch (error) {
      console.error("Error removing internal option:", error);
      toast.error("Could not remove internal option.");
    } finally {
      setSavingInternalOptions(false);
    }
  };

  const handleMoveInternalStatusOption = async (currentValue, direction) => {
    if (!activeProjectId) {
      toast.warn("Select a project first.");
      return;
    }

    const currentList = [...projectInternalStatusOptions];
    const currentIndex = currentList.indexOf(currentValue);
    if (currentIndex < 0) return;

    const swapIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (swapIndex < 0 || swapIndex >= currentList.length) return;

    [currentList[currentIndex], currentList[swapIndex]] = [currentList[swapIndex], currentList[currentIndex]];

    setSavingInternalOptions(true);
    try {
      const projectRef = doc(db, "churches", id, "bimProjects", activeProjectId);
      await setDoc(projectRef, {
        internalStatusOptions: currentList,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid || null,
        updatedByEmail: user?.email || null,
      }, { merge: true });

      setActiveProject((previousProject) => (
        previousProject ? { ...previousProject, internalStatusOptions: currentList } : previousProject
      ));
      setProjects((previousProjects) => previousProjects.map((project) => (
        project.id === activeProjectId ? { ...project, internalStatusOptions: currentList } : project
      )));
    } catch (error) {
      console.error("Error reordering internal status:", error);
      toast.error("Could not reorder internal status.");
    } finally {
      setSavingInternalOptions(false);
    }
  };

  const handleSaveReviztoTemplate = async () => {
    if (!activeProjectId) {
      toast.warn("Select a project first.");
      return;
    }

    const cleanedTemplate = normalizeValue(reviztoTemplateDraft);
    setSavingReviztoTemplate(true);
    try {
      const projectRef = doc(db, "churches", id, "bimProjects", activeProjectId);
      await setDoc(projectRef, {
        reviztoIssueLinkTemplate: cleanedTemplate,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid || null,
        updatedByEmail: user?.email || null,
      }, { merge: true });

      setActiveProject((previousProject) => (
        previousProject
          ? {
              ...previousProject,
              reviztoIssueLinkTemplate: cleanedTemplate,
            }
          : previousProject
      ));

      setProjects((previousProjects) => previousProjects.map((project) => (
        project.id === activeProjectId
          ? {
              ...project,
              reviztoIssueLinkTemplate: cleanedTemplate,
            }
          : project
      )));

      toast.success("Revizto project link template saved.");
    } catch (error) {
      console.error("Error saving Revizto link template:", error);
      toast.error("Could not save Revizto link template.");
    } finally {
      setSavingReviztoTemplate(false);
    }
  };

  const handleInternalFieldChange = (cardKey, field, value) => {
    setCardInternalDrafts((previous) => ({
      ...previous,
      [cardKey]: {
        ...(previous?.[cardKey] || {}),
        [field]: value,
      },
    }));
  };

  const handleInternalFieldInlineSave = async (cardKey, field, value) => {
    const nextDraft = {
      ...(cardInternalDrafts?.[cardKey] || {}),
      [field]: value,
    };

    handleInternalFieldChange(cardKey, field, value);
    await handleSaveInternalCardMeta(cardKey, nextDraft, { silentSuccess: true });
  };

  const handleQuickCardDraftChange = (field, value) => {
    setQuickCardDraft((previousDraft) => ({
      ...previousDraft,
      [field]: value,
    }));
  };

  const handleCreateQuickCard = async () => {
    if (!activeProjectId) {
      toast.warn("Select a project first.");
      return;
    }

    const trimmedTitle = normalizeValue(quickCardDraft.title);
    if (!trimmedTitle) {
      toast.warn("Enter a title before creating a card.");
      return;
    }

    const nextCardId = getNextAvailableCardId(rowsToRender, fieldsToRender);
    const nextRow = buildManualCardRow({
      cardId: nextCardId,
      draft: {
        ...quickCardDraft,
        title: trimmedTitle,
      },
    });
    const nextRows = [...rowsToRender, nextRow];
    const nextFields = mergeProjectFields(fieldsToRender, Object.keys(nextRow.rowData), BIM_MANUAL_CARD_FIELDS);
    const nextCardKey = getCardMetaKey(nextRow, getCardPreview(nextRow.rowData, nextFields));
    const nextInternalMetaEntry = {
      internalAssignee: normalizeValue(quickCardDraft.internalAssignee),
      internalStatus: normalizeValue(quickCardDraft.internalStatus),
    };
    const hasInternalMeta = Boolean(nextInternalMetaEntry.internalAssignee || nextInternalMetaEntry.internalStatus);
    const nextInternalCardMeta = hasInternalMeta
      ? {
          ...(projectInternalCardMeta || {}),
          [nextCardKey]: nextInternalMetaEntry,
        }
      : projectInternalCardMeta;
    const fallbackDraft = getDefaultQuickCardDraft({
      defaultStatuses: activeProjectDefaultStatuses,
      statusOptions,
      priorityOptions,
      internalAssigneeOptions,
      internalStatusOptions,
    });

    setCreatingQuickCard(true);
    try {
      const projectRef = doc(db, "churches", id, "bimProjects", activeProjectId);
      const projectPayload = {
        fields: nextFields,
        rows: nextRows,
        rowCount: nextRows.length,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid || null,
        updatedByEmail: user?.email || null,
      };

      if (hasInternalMeta) {
        projectPayload.internalCardMeta = nextInternalCardMeta;
      }

      await setDoc(projectRef, projectPayload, { merge: true });

      setActiveProject((previousProject) => (
        previousProject
          ? {
              ...previousProject,
              fields: nextFields,
              rows: nextRows,
              rowCount: nextRows.length,
              ...(hasInternalMeta ? { internalCardMeta: nextInternalCardMeta } : {}),
            }
          : previousProject
      ));

      setProjects((previousProjects) => previousProjects.map((project) => (
        project.id === activeProjectId
          ? {
              ...project,
              fields: nextFields,
              rowCount: nextRows.length,
            }
          : project
      )));

      setQuickCardDraft((previousDraft) => resetQuickCardDraft(previousDraft, fallbackDraft));
      toast.success(`Card #${nextCardId} created.`);
    } catch (error) {
      console.error("Error creating BIM quick card:", error);
      toast.error("Could not create BIM card.");
    } finally {
      setCreatingQuickCard(false);
    }
  };

  const handleSaveInternalCardMeta = async (cardKey, draftOverride = null, options = {}) => {
    if (!activeProjectId || !cardKey) return;

    const currentDraft = draftOverride || cardInternalDrafts?.[cardKey] || {};
    const previousValues = projectInternalCardMeta?.[cardKey] || {};
    const previousInternalStatus = normalizeValue(previousValues.internalStatus);
    const nextInternalStatus = normalizeValue(currentDraft.internalStatus);
    const cardMatch = cardRows.find(({ row, preview }) => getCardMetaKey(row, preview) === cardKey);
    const cardId = normalizeValue(cardMatch?.preview?.id);
    const cardTitle = normalizeValue(cardMatch?.preview?.title);
    const cardStatus = normalizeValue(cardMatch?.preview?.status);
    const statusChanges = [];

    if (previousInternalStatus !== nextInternalStatus) {
      statusChanges.push({
        field: "Internal Status",
        oldValue: previousInternalStatus,
        newValue: nextInternalStatus,
        rowKey: cardKey,
        rowNumber: cardMatch?.row?.rowNumber || null,
      });
    }

    const nextInternalMeta = {
      internalAssignee: normalizeValue(currentDraft.internalAssignee),
      internalStatus: nextInternalStatus,
      expectedDeadline: normalizeValue(currentDraft.expectedDeadline),
      updatedBy: user?.uid || null,
      updatedByEmail: user?.email || null,
      updatedAt: Date.now(),
    };

    setSavingCardMetaKey(cardKey);
    try {
      const projectRef = doc(db, "churches", id, "bimProjects", activeProjectId);
      await setDoc(projectRef, {
        internalCardMeta: {
          [cardKey]: nextInternalMeta,
        },
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid || null,
        updatedByEmail: user?.email || null,
      }, { merge: true });

      setActiveProject((previousProject) => (
        previousProject
          ? {
              ...previousProject,
              internalCardMeta: {
                ...(previousProject.internalCardMeta || {}),
                [cardKey]: nextInternalMeta,
              },
            }
          : previousProject
      ));

      if (statusChanges.length) {
        const statusLogEntry = {
          logType: "statusUpdate",
          fileName: cardId ? `Card #${cardId}` : "Card status update",
          uploadedBy: user?.uid || null,
          uploadedByEmail: user?.email || null,
          summary: {
            added: 0,
            updated: statusChanges.length,
            deleted: 0,
          },
          statusChanges,
          cardKey,
          cardId: cardId || null,
          cardTitle: cardTitle || null,
          cardStatus: cardStatus || null,
        };

        await addDoc(collection(db, "churches", id, "bimProjects", activeProjectId, "uploadLogs"), {
          ...statusLogEntry,
          uploadedAt: serverTimestamp(),
        });

        setLogs((previousLogs) => ([
          {
            id: `local-status-log-${Date.now()}`,
            ...statusLogEntry,
            uploadedAt: new Date(),
          },
          ...previousLogs,
        ].slice(0, 20)));
      }

      if (!options?.silentSuccess) {
        toast.success("Internal card data saved.");
      }
    } catch (error) {
      console.error("Error saving internal card fields:", error);
      toast.error("Could not save internal card fields.");
    } finally {
      setSavingCardMetaKey("");
    }
  };

  const uploadBimCommentAttachment = async (projectId, rowValue, commentId, file) => {
    if (!storage) {
      throw new Error("File uploads are not available right now.");
    }

    const filePath = buildBimCommentAttachmentPath(id, projectId, rowValue, commentId, file.name);
    const attachmentRef = ref(storage, filePath);
    await uploadBytes(attachmentRef, file);
    const downloadUrl = await getDownloadURL(attachmentRef);

    return {
      name: file.name,
      path: filePath,
      url: downloadUrl,
      size: file.size || 0,
      contentType: normalizeValue(file.type),
    };
  };

  const deleteCommentAttachment = async (attachmentPath) => {
    if (!storage || !attachmentPath) return;

    try {
      await deleteObject(ref(storage, attachmentPath));
    } catch (error) {
      console.warn("Could not remove BIM comment attachment from storage:", error);
    }
  };

  const handleCreateComment = async (event) => {
    event.preventDefault();
    if (!routeProjectId || !rowNumber) return;

    const trimmedText = normalizeValue(commentDraft);
    if (!trimmedText && !commentAttachment) {
      toast.warn("Write a comment or attach a file before posting.");
      return;
    }

    if (commentAttachment && commentAttachment.size > BIM_COMMENT_MAX_ATTACHMENT_BYTES) {
      toast.warn("Attachments must be 10MB or smaller.");
      return;
    }

    setSubmittingComment(true);
    try {
      const commentsRef = collection(
        db,
        "churches",
        id,
        "bimProjects",
        routeProjectId,
        "rows",
        String(rowNumber),
        "comments"
      );

      const commentRef = await addDoc(commentsRef, {
        text: trimmedText,
        rowNumber: String(rowNumber),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: user?.uid || null,
        createdByEmail: user?.email || null,
        updatedBy: user?.uid || null,
        updatedByEmail: user?.email || null,
      });

      if (commentAttachment) {
        const attachment = await uploadBimCommentAttachment(
          routeProjectId,
          String(rowNumber),
          commentRef.id,
          commentAttachment
        );

        await setDoc(commentRef, {
          attachment,
          updatedAt: serverTimestamp(),
          updatedBy: user?.uid || null,
          updatedByEmail: user?.email || null,
        }, { merge: true });
      }

      setCommentDraft("");
      setCommentAttachment(null);
      setCommentAttachmentInputKey((previous) => previous + 1);
      toast.success("Comment posted.");
    } catch (error) {
      console.error("Error creating BIM row comment:", error);
      toast.error(error?.message || "Could not save comment.");
    } finally {
      setSubmittingComment(false);
    }
  };

  const startEditingComment = (comment) => {
    setEditingCommentId(comment.id);
    setEditingCommentText(normalizeValue(comment.text));
    setEditingCommentAttachment(null);
    setRemoveEditingAttachment(false);
    setEditAttachmentInputKey((previous) => previous + 1);
  };

  const cancelEditingComment = () => {
    setEditingCommentId("");
    setEditingCommentText("");
    setEditingCommentAttachment(null);
    setRemoveEditingAttachment(false);
    setEditAttachmentInputKey((previous) => previous + 1);
  };

  const handleSaveEditedComment = async (comment) => {
    if (!routeProjectId || !rowNumber || !comment?.id) return;

    const trimmedText = normalizeValue(editingCommentText);
    const hasExistingAttachment = !!comment?.attachment?.url && !removeEditingAttachment;
    const hasNewAttachment = !!editingCommentAttachment;

    if (!trimmedText && !hasExistingAttachment && !hasNewAttachment) {
      toast.warn("A comment needs text or an attachment.");
      return;
    }

    if (editingCommentAttachment && editingCommentAttachment.size > BIM_COMMENT_MAX_ATTACHMENT_BYTES) {
      toast.warn("Attachments must be 10MB or smaller.");
      return;
    }

    setSavingCommentId(comment.id);
    try {
      const commentRef = doc(
        db,
        "churches",
        id,
        "bimProjects",
        routeProjectId,
        "rows",
        String(rowNumber),
        "comments",
        comment.id
      );

      const updatePayload = {
        text: trimmedText,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid || null,
        updatedByEmail: user?.email || null,
      };

      if (removeEditingAttachment && comment?.attachment?.path) {
        await deleteCommentAttachment(comment.attachment.path);
        updatePayload.attachment = null;
      }

      if (editingCommentAttachment) {
        const replacementAttachment = await uploadBimCommentAttachment(
          routeProjectId,
          String(rowNumber),
          comment.id,
          editingCommentAttachment
        );

        if (comment?.attachment?.path) {
          await deleteCommentAttachment(comment.attachment.path);
        }

        updatePayload.attachment = replacementAttachment;
      }

      await setDoc(commentRef, updatePayload, { merge: true });
      cancelEditingComment();
      toast.success("Comment updated.");
    } catch (error) {
      console.error("Error updating BIM row comment:", error);
      toast.error(error?.message || "Could not update comment.");
    } finally {
      setSavingCommentId("");
    }
  };

  const handleDeleteComment = async (comment) => {
    if (!routeProjectId || !rowNumber || !comment?.id) return;

    const confirmed = window.confirm("Delete this comment?");
    if (!confirmed) return;

    setDeletingCommentId(comment.id);
    try {
      if (comment?.attachment?.path) {
        await deleteCommentAttachment(comment.attachment.path);
      }

      const commentRef = doc(
        db,
        "churches",
        id,
        "bimProjects",
        routeProjectId,
        "rows",
        String(rowNumber),
        "comments",
        comment.id
      );
      await deleteDoc(commentRef);

      if (editingCommentId === comment.id) {
        cancelEditingComment();
      }

      toast.success("Comment removed.");
    } catch (error) {
      console.error("Error deleting BIM row comment:", error);
      toast.error("Could not remove comment.");
    } finally {
      setDeletingCommentId("");
    }
  };

  const lightboxModal = lightboxImage ? (
    <div className="bim-lightbox" role="dialog" aria-modal="true" aria-label="Image preview" onClick={closeLightbox}>
      <button type="button" className="bim-lightbox-close" onClick={closeLightbox} aria-label="Close image preview">
        ×
      </button>
      <div className="bim-lightbox-content" onClick={(event) => event.stopPropagation()}>
        <img
          src={lightboxImage.url}
          alt={lightboxImage.label || "BIM preview"}
          className="bim-lightbox-image"
          onError={applyBimFallbackImage}
        />
        {lightboxImage.label ? <div className="bim-lightbox-caption">{lightboxImage.label}</div> : null}
      </div>
    </div>
  ) : null;

  const handleSelectDetailField = (fieldKey) => {
    setSelectedDetailFieldKey(fieldKey);
  };

  if (routeProjectId && rowNumber) {
    const detailImage = getRowImage(selectedRow?.rowData, fieldsToRender);
    const detailImageUrl = detailImage?.url || GENERIC_BIM_CARD_IMAGE;
    const detailPreview = getCardPreview(selectedRow?.rowData, fieldsToRender);
    const detailDaysSinceCreated = getDaysSinceCreated(selectedRow?.rowData, fieldsToRender);
    const detailAgeClassName = detailDaysSinceCreated >= 15
      ? "is-critical"
      : detailDaysSinceCreated >= 8
        ? "is-warning"
        : "";

    return (
      <div style={commonStyles.fullWidthContainer}>
        <button
          type="button"
          onClick={() => navigate(`/organization/${id}/bim?project=${routeProjectId}`)}
          style={commonStyles.backButton}
        >
          ← Back to BIM Cards
        </button>

        <ChurchHeader id={id} applyShadow={false} allowEditBannerLogo={true} />

        <div className="bim-wrap">
          <section className="bim-panel bim-detail-panel">
            {!activeProject ? <p>Loading project...</p> : null}
            {activeProject && !selectedRow ? <p>Card not found for this row.</p> : null}

            {activeProject && selectedRow ? (
              <>
                <div className="bim-detail-hero">
                  <div>
                    <p className="bim-detail-kicker">{activeProject?.name || "BIM Project"}</p>
                    <h2 className="bim-detail-title">{detailPreview.title || "Untitled task"}</h2>
                    <p className="bim-muted bim-detail-subtitle">
                      ID #{detailPreview.id || "-"} · Row {selectedRow.rowNumber}
                    </p>
                  </div>
                  <div className="bim-detail-chips">
                    <span className="bim-detail-chip">Status: {detailPreview.status || "Not set"}</span>
                    <span className="bim-detail-chip">Priority: {detailPreview.priority || "-"}</span>
                    <span className="bim-detail-chip">Assignee: {detailPreview.assignee || "-"}</span>
                    <span className={`bim-detail-chip bim-age-value ${detailAgeClassName}`}>
                      Age: {Number.isFinite(detailDaysSinceCreated) ? `${detailDaysSinceCreated} days` : "-"}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="bim-image-button bim-detail-image-button"
                  onClick={() => openLightbox(detailImageUrl, `Row ${selectedRow.rowNumber} snapshot`)}
                >
                  <img
                    src={detailImageUrl}
                    alt={`Row ${selectedRow.rowNumber} snapshot`}
                    className="bim-detail-image"
                    onError={applyBimFallbackImage}
                  />
                </button>

                <div className="bim-detail-toolbar">
                  <input
                    type="text"
                    className="bim-input"
                    placeholder="Search fields or values"
                    value={detailFieldSearch}
                    onChange={(event) => setDetailFieldSearch(event.target.value)}
                  />
                  <p className="bim-muted bim-detail-search-count">
                    Showing {detailFieldEntries.length} of {fieldsToRender.length || Object.keys(selectedRow?.rowData || {}).length} fields
                  </p>
                </div>

                <div className="bim-detail-layout">
                  <aside className="bim-detail-nav" aria-label="Field navigation">
                    {detailFieldEntries.map((item) => (
                      <button
                        key={`nav-${item.key}`}
                        type="button"
                        className={`bim-detail-nav-item ${selectedDetailFieldKey === item.key ? "is-active" : ""}`}
                        onClick={() => handleSelectDetailField(item.key)}
                      >
                        {item.field}
                      </button>
                    ))}
                  </aside>

                  <div className="bim-detail-fields">
                    {!detailFieldEntries.length ? (
                      <p className="bim-muted">No fields match your search.</p>
                    ) : selectedDetailField ? (
                      <div key={selectedDetailField.key} id={selectedDetailField.key} className="bim-field-row bim-detail-field-row">
                        <span className="bim-field-label">{selectedDetailField.field}</span>
                        <span className="bim-field-value">{selectedDetailField.value}</span>
                      </div>
                    ) : (
                      <p className="bim-muted bim-detail-empty-state">Click a field to reveal its value.</p>
                    )}
                  </div>
                </div>

                <section className="bim-detail-comments" aria-label="Row comments">
                  <div className="bim-section-heading-row">
                    <h3 className="bim-section-title">Comments</h3>
                    <p className="bim-muted bim-detail-search-count">{comments.length} total</p>
                  </div>

                  <form className="bim-comment-form" onSubmit={handleCreateComment}>
                    <textarea
                      className="bim-input bim-comment-textarea"
                      rows={3}
                      placeholder="Write a comment for this row"
                      value={commentDraft}
                      onChange={(event) => setCommentDraft(event.target.value)}
                    />
                    <div className="bim-comment-form-actions">
                      <input
                        key={`new-comment-file-${commentAttachmentInputKey}`}
                        type="file"
                        className="bim-input"
                        onChange={(event) => setCommentAttachment(event.target.files?.[0] || null)}
                      />
                      <button type="submit" className="bim-primary" disabled={submittingComment}>
                        {submittingComment ? "Posting..." : "Add comment"}
                      </button>
                    </div>
                    {commentAttachment ? (
                      <p className="bim-muted bim-comment-file-note">Attachment: {commentAttachment.name}</p>
                    ) : null}
                  </form>

                  {loadingComments ? <p className="bim-muted">Loading comments...</p> : null}
                  {!loadingComments && !comments.length ? (
                    <p className="bim-muted">No comments yet for this row.</p>
                  ) : null}

                  <div className="bim-comment-list">
                    {comments.map((comment) => {
                      const isEditing = editingCommentId === comment.id;
                      const createdStamp = formatCommentTimestamp(comment.createdAt);
                      const updatedStamp = formatCommentTimestamp(comment.updatedAt);

                      return (
                        <article key={comment.id} className="bim-comment-item">
                          <div className="bim-comment-head">
                            <strong>{comment.createdByEmail || "Unknown user"}</strong>
                            <span className="bim-muted">
                              {createdStamp || "Just now"}
                              {updatedStamp && updatedStamp !== createdStamp ? ` (edited ${updatedStamp})` : ""}
                            </span>
                          </div>

                          {isEditing ? (
                            <>
                              <textarea
                                className="bim-input bim-comment-textarea"
                                rows={3}
                                value={editingCommentText}
                                onChange={(event) => setEditingCommentText(event.target.value)}
                              />
                              <div className="bim-comment-form-actions">
                                <input
                                  key={`edit-comment-file-${editAttachmentInputKey}`}
                                  type="file"
                                  className="bim-input"
                                  onChange={(event) => setEditingCommentAttachment(event.target.files?.[0] || null)}
                                />
                                {comment?.attachment?.url ? (
                                  <button
                                    type="button"
                                    className="bim-page-btn"
                                    onClick={() => setRemoveEditingAttachment((previous) => !previous)}
                                  >
                                    {removeEditingAttachment ? "Keep file" : "Remove file"}
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className="bim-card-internal-save"
                                  onClick={() => handleSaveEditedComment(comment)}
                                  disabled={savingCommentId === comment.id}
                                >
                                  {savingCommentId === comment.id ? "Saving..." : "Save"}
                                </button>
                                <button type="button" className="bim-page-btn" onClick={cancelEditingComment}>Cancel</button>
                              </div>
                              {editingCommentAttachment ? (
                                <p className="bim-muted bim-comment-file-note">New attachment: {editingCommentAttachment.name}</p>
                              ) : null}
                            </>
                          ) : (
                            <p className="bim-comment-text">{normalizeValue(comment.text) || "-"}</p>
                          )}

                          {comment?.attachment?.url && (!isEditing || !removeEditingAttachment) ? (
                            <a
                              href={comment.attachment.url}
                              className="bim-comment-attachment"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {comment.attachment.name || "Open attachment"}
                            </a>
                          ) : null}

                          {!isEditing ? (
                            <div className="bim-comment-actions">
                              <button type="button" className="bim-page-btn" onClick={() => startEditingComment(comment)}>Edit</button>
                              <button
                                type="button"
                                className="bim-option-btn is-danger"
                                onClick={() => handleDeleteComment(comment)}
                                disabled={deletingCommentId === comment.id}
                              >
                                {deletingCommentId === comment.id ? "Deleting..." : "Delete"}
                              </button>
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                </section>
              </>
            ) : null}
          </section>
        </div>
        {lightboxModal}
      </div>
    );
  }

  if (routeProjectId && isAssignmentsView) {
    return (
      <div style={commonStyles.fullWidthContainer}>
        <button
          type="button"
          onClick={() => navigate(`/organization/${id}/bim?project=${routeProjectId}`)}
          style={commonStyles.backButton}
        >
          ← Back to BIM Cards
        </button>

        <ChurchHeader id={id} applyShadow={false} allowEditBannerLogo={true} />

        <div className="bim-wrap">
          <section className="bim-panel bim-detail-panel bim-assignment-panel">
            {!activeProject ? <p>Loading project...</p> : null}
            {activeProject && !cardRows.length ? <p className="bim-muted">No cards available for this project yet.</p> : null}

            {activeProject && cardRows.length ? (
              <>
                <div className="bim-assignment-hero">
                  <div>
                    <p className="bim-detail-kicker">{activeProject.name || "BIM Project"}</p>
                    <h2 className="bim-detail-title">Assignment View</h2>
                    <p className="bim-muted bim-detail-subtitle">
                      View who owns each card based on internal assignee, with internal status for each assignment.
                    </p>
                  </div>
                  <div className="bim-assignment-hero-actions">
                    <button
                      type="button"
                      className="bim-page-btn"
                      onClick={handleExportAssignmentsCsv}
                    >
                      Export CSV
                    </button>
                    <button
                      type="button"
                      className="bim-page-btn"
                      onClick={() => navigate(`/organization/${id}/bim?project=${routeProjectId}`)}
                    >
                      Open card board
                    </button>
                  </div>
                </div>

                <div className="bim-assignment-toolbar">
                  <label className="bim-assignment-control">
                    <span className="bim-field-label">Project</span>
                    <select
                      className="bim-filter-input"
                      value={activeProjectId}
                      onChange={(event) => {
                        const nextProjectId = normalizeValue(event.target.value);
                        if (!nextProjectId || nextProjectId === activeProjectId) return;
                        navigate(`/organization/${id}/bim/${nextProjectId}/view/assignments`);
                      }}
                    >
                      {projects.map((project) => (
                        <option key={`assignment-project-${project.id}`} value={project.id}>{project.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="bim-assignment-control">
                    <span className="bim-field-label">Assignee</span>
                    <select
                      className="bim-filter-input"
                      value={assignmentAssigneeFilter}
                      onChange={(event) => setAssignmentAssigneeFilter(event.target.value)}
                    >
                      <option value="all">All assignees</option>
                      {assignmentAssigneeOptions.map((assignee) => (
                        <option key={`assignment-assignee-${assignee}`} value={assignee}>{assignee}</option>
                      ))}
                    </select>
                  </label>
                  <label className="bim-assignment-control bim-assignment-search">
                    <span className="bim-field-label">Search</span>
                    <input
                      className="bim-filter-input"
                      type="text"
                      placeholder="Search title, ID, status, row"
                      value={assignmentSearch}
                      onChange={(event) => setAssignmentSearch(event.target.value)}
                    />
                  </label>
                </div>

                <div className="bim-stats bim-assignment-stats">
                  <div className="bim-stat-card">
                    <strong>{filteredAssignmentSummary.assigneeCount}</strong>
                    <span>Visible assignees</span>
                  </div>
                  <div className="bim-stat-card">
                    <strong>{filteredAssignmentSummary.assignedCards}</strong>
                    <span>Visible assigned cards</span>
                  </div>
                  <div className="bim-stat-card">
                    <strong>{filteredAssignmentSummary.unassignedCards}</strong>
                    <span>Visible unassigned cards</span>
                  </div>
                </div>

                <p className="bim-muted bim-assignment-results-count">
                  Showing {filteredAssignmentSummary.visibleCards} of {cardRows.length} cards.
                </p>

                {filteredAssignmentSummary.statusCounts.length ? (
                  <div className="bim-assignment-status-summary">
                    {filteredAssignmentSummary.statusCounts.map(([statusValue, count]) => (
                      <span key={`assignment-status-${statusValue}`} className="bim-detail-chip">
                        {statusValue}: {count}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="bim-cards-grid">
                  {filteredAssignmentCards.map(({ row, preview, cardKey, internalAssignee, internalStatus, daysSinceCreated, unresolvedAgeDays }) => {
                    const rowImage = getRowImage(row.rowData, fieldsToRender);
                    const cardImageUrl = rowImage?.url || GENERIC_BIM_CARD_IMAGE;
                    const internalDraft = cardInternalDrafts?.[cardKey] || {
                      internalAssignee: internalAssignee === "Unassigned" ? "" : internalAssignee,
                      internalStatus: internalStatus === "No internal status" ? "" : internalStatus,
                      expectedDeadline: normalizeValue(projectInternalCardMeta?.[cardKey]?.expectedDeadline),
                    };
                    const expectedDeadlineCountdown = getExpectedDeadlineCountdown(internalDraft.expectedDeadline || projectInternalCardMeta?.[cardKey]?.expectedDeadline);
                    const reviztoIssueLink = buildReviztoIssueLink(activeProject?.reviztoIssueLinkTemplate, preview.id);
                    const daysAgeClassName = daysSinceCreated >= 15
                      ? "is-critical"
                      : daysSinceCreated >= 8
                        ? "is-warning"
                        : "";
                    const unresolvedText = unresolvedAgeDays >= 0
                      ? `${unresolvedAgeDays} day${unresolvedAgeDays === 1 ? "" : "s"} unresolved`
                      : "Resolved";

                    return (
                      <article
                        key={`assignment-card-${cardKey}`}
                        className="bim-card bim-card-clickable"
                        role="button"
                        tabIndex={0}
                        onClick={() => navigate(`/organization/${id}/bim/${activeProjectId}/${row.rowNumber}`)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            navigate(`/organization/${id}/bim/${activeProjectId}/${row.rowNumber}`);
                          }
                        }}
                      >
                        <div className="bim-card-head">ID #{preview.id || "-"} • {preview.title || "Untitled task"}</div>
                        <button
                          type="button"
                          className={`bim-card-image-link bim-image-button ${rowImage?.url ? "" : "is-placeholder"}`}
                          title={rowImage?.url ? "Open snapshot image" : "Open image preview"}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            openLightbox(cardImageUrl, `Row ${row.rowNumber} snapshot`);
                          }}
                        >
                          <img
                            src={cardImageUrl}
                            alt={`Row ${row.rowNumber} snapshot`}
                            className="bim-card-image"
                            loading="lazy"
                            onError={applyBimFallbackImage}
                          />
                        </button>
                        <div className="bim-card-body">
                          <div className="bim-card-status-row">
                            <span className="bim-field-label">Status</span>
                            <span className="bim-status-pill">{preview.status || "Not set"}</span>
                          </div>
                          {expectedDeadlineCountdown ? (
                            <div className={`bim-countdown-badge bim-countdown-badge--${expectedDeadlineCountdown.urgency}`}>
                              <span className="bim-countdown-icon">{expectedDeadlineCountdown.urgency === "overdue" ? "⚠" : expectedDeadlineCountdown.urgency === "today" ? "🎯" : "⏳"}</span>
                              <span className="bim-countdown-label">{expectedDeadlineCountdown.label}</span>
                            </div>
                          ) : null}
                          <div className="bim-card-meta-grid">
                            <div className="bim-field-row"><span className="bim-field-label">Priority</span><span className="bim-field-value">{preview.priority || "-"}</span></div>
                            <div className="bim-field-row"><span className="bim-field-label">Assignee</span><span className="bim-field-value">{preview.assignee || "-"}</span></div>
                            <div className="bim-field-row"><span className="bim-field-label">Deadline</span><span className="bim-field-value">{preview.deadline || "-"}</span></div>
                            <div className="bim-field-row"><span className="bim-field-label">ID</span><span className="bim-field-value">{preview.id || "-"}</span></div>
                            <div className="bim-field-row"><span className="bim-field-label">Days Since Created</span><span className={`bim-field-value bim-age-value ${daysAgeClassName}`}>{Number.isFinite(daysSinceCreated) ? `${daysSinceCreated} day${daysSinceCreated === 1 ? "" : "s"}` : "-"}</span></div>
                            <div className="bim-field-row"><span className="bim-field-label">Not Resolved Age</span><span className={`bim-field-value bim-age-value ${daysAgeClassName}`}>{unresolvedText}</span></div>
                          </div>
                          <div
                            className="bim-card-internal"
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => event.stopPropagation()}
                          >
                            <h4 className="bim-card-internal-title">Internal Tracking</h4>
                            <select
                              className="bim-card-internal-input"
                              value={internalDraft.internalAssignee || ""}
                              onChange={(event) => handleInternalFieldInlineSave(cardKey, "internalAssignee", event.target.value)}
                            >
                              <option value="">Internal assignee</option>
                              {internalAssigneeOptions.map((assigneeValue) => (
                                <option key={`assignment-internal-assignee-${assigneeValue}`} value={assigneeValue}>{assigneeValue}</option>
                              ))}
                            </select>
                            <select
                              className="bim-card-internal-input"
                              value={internalDraft.internalStatus || ""}
                              onChange={(event) => handleInternalFieldInlineSave(cardKey, "internalStatus", event.target.value)}
                            >
                              <option value="">Internal status</option>
                              {internalStatusOptions.map((statusValue) => (
                                <option key={`assignment-internal-status-${statusValue}`} value={statusValue}>{statusValue}</option>
                              ))}
                            </select>
                            <label className="bim-field-label">Expected Deadline</label>
                            <input
                              type="date"
                              className="bim-card-internal-input"
                              value={internalDraft.expectedDeadline || ""}
                              onChange={(event) => handleInternalFieldInlineSave(cardKey, "expectedDeadline", event.target.value)}
                            />
                            {savingCardMetaKey === cardKey ? (
                              <span className="bim-inline-saving-note">Saving internal changes...</span>
                            ) : null}
                            {reviztoIssueLink ? (
                              <a
                                href={reviztoIssueLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="bim-card-revizto-btn"
                                onClick={(event) => event.stopPropagation()}
                              >
                                Open in Revizto
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
                {!filteredAssignmentCards.length ? (
                  <p className="bim-muted">No assignment cards match the current project, assignee, or search.</p>
                ) : null}
              </>
            ) : null}
          </section>
        </div>
      </div>
    );
  }

  return (
    <div style={commonStyles.fullWidthContainer}>
      <Link to={`/organization/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to My Organization
      </Link>

      <ChurchHeader id={id} applyShadow={false} allowEditBannerLogo={true} />

      <div className="bim-wrap">
        <div className="bim-header-row">
          <div>
            <h1 className="bim-title">BIM Projects</h1>
            <p className="bim-subtitle">
              Create projects, upload Excel, and render one card per data row using the first row as field names.
            </p>
          </div>
          <div className="bim-header-actions">
            <label className={`bim-upload-btn ${uploading ? "is-disabled" : ""}`}>
              {uploading ? "Uploading..." : "Upload Excel"}
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleUploadFile}
                disabled={uploading}
                hidden
              />
            </label>
            <button
              type="button"
              className="bim-logout-btn"
              onClick={handleLogout}
            >
              Logout
            </button>
          </div>
        </div>

        <div className="bim-grid">
          <section className="bim-panel">
            <h2>Create Project</h2>
            <input
              className="bim-input"
              placeholder="Project name"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              disabled={creatingProject}
            />
            <textarea
              className="bim-input"
              placeholder="Short description (optional)"
              value={newProjectDescription}
              onChange={(e) => setNewProjectDescription(e.target.value)}
              rows={3}
              disabled={creatingProject}
            />
            <button className="bim-primary" onClick={handleCreateProject} disabled={creatingProject}>
              {creatingProject ? "Creating..." : "Create Project"}
            </button>

            <h3 className="bim-section-title">Update Log</h3>
            {loadingLogs ? <p>Loading logs...</p> : null}
            {!loadingLogs && !logs.length ? <p className="bim-muted">No updates logged yet.</p> : null}

            <div className="bim-log-list">
              {logs.map((log) => {
                const statusChanges = getLogStatusChanges(log);
                const isStatusUpdateLog = log.logType === "statusUpdate";
                const logTitle = isStatusUpdateLog
                  ? (log.cardId ? `Card #${log.cardId} status update` : "Card status update")
                  : (log.fileName || "Upload");

                return (
                  <article key={log.id} className="bim-log-item">
                    <div className="bim-log-title">{logTitle}</div>
                    <div className="bim-log-meta">
                      {isStatusUpdateLog
                        ? `${statusChanges.length} status change${statusChanges.length === 1 ? "" : "s"}`
                        : `Added ${log.summary?.added || 0} • Updated ${log.summary?.updated || 0} • Deleted ${log.summary?.deleted || 0}`}
                    </div>
                    {(log.uploadedByEmail || getLogTimestamp(log)) && (
                      <div className="bim-log-context">
                        {[formatUploadTimestamp(getLogTimestamp(log)), log.uploadedByEmail].filter(Boolean).join(" by ")}
                      </div>
                    )}
                    {!!statusChanges.length && (
                      <details>
                        <summary>View status changes</summary>
                        <div className="bim-log-details">
                          <ul className="bim-log-change-list">
                            {statusChanges.slice(0, 12).map((change, idx) => {
                              const statusHint = getStatusProgressHint(change, internalStatusOptions);
                              return (
                                <li key={`${change.rowKey || log.id}-${idx}`}>
                                  {formatLogChangeLabel(change, log)}: {formatFieldChangeMessage(change)}
                                  {statusHint ? ` (${statusHint})` : ""}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      </details>
                    )}
                    {!!log.changedRows?.length && (
                      <details>
                        <summary>View updated rows</summary>
                        <div className="bim-log-details">
                          {log.changedRows.slice(0, 8).map((change, idx) => (
                            <div key={`${change.rowKey}-${idx}`} className="bim-log-row-change">
                              <div className="bim-log-row-title">{formatLogChangeLabel(change, log)}</div>
                              <ul className="bim-log-change-list">
                                {(change.changedFields || [])
                                  .filter((fieldChange) => !isCoordinateFieldName(fieldChange?.field))
                                  .slice(0, 6)
                                  .map((fieldChange, fieldIdx) => {
                                    const statusHint = getStatusProgressHint(fieldChange, configurableStatusOptions);
                                    return (
                                      <li key={`${change.rowKey}-${fieldIdx}`}>
                                        {formatFieldChangeMessage(fieldChange)}
                                        {statusHint ? ` (${statusHint})` : ""}
                                      </li>
                                    );
                                  })}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                    {!!log.deletedRows?.length && (
                      <details>
                        <summary>View removed rows</summary>
                        <div className="bim-log-details">
                          <p className="bim-log-removed-summary">
                            {log.deletedRows.length} row{log.deletedRows.length === 1 ? "" : "s"} removed from the previous upload.
                          </p>
                          <ul className="bim-log-change-list">
                            {log.deletedRows.slice(0, 12).map((deletedRow, deletedIdx) => (
                              <li key={`${deletedRow.rowKey || deletedRow.rowNumber}-${deletedIdx}`}>
                                Row {deletedRow.rowNumber} was removed.
                              </li>
                            ))}
                          </ul>
                        </div>
                      </details>
                    )}
                  </article>
                );
              })}
            </div>

            <h3 className="bim-section-title">Projects</h3>
            {loadingProjects ? <p>Loading projects...</p> : null}
            {!loadingProjects && !projects.length ? (
              <p className="bim-muted">No BIM projects yet.</p>
            ) : null}
            <div className="bim-project-list">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className={`bim-project-item ${project.id === activeProjectId ? "is-active" : ""}`}
                >
                  <button
                    className="bim-project-select"
                    onClick={() => setActiveProjectId(project.id)}
                    type="button"
                  >
                    <strong>{project.name}</strong>
                    <span>{project.rowCount || 0} rows</span>
                  </button>
                  <div className="bim-project-actions">
                    <button
                      type="button"
                      className="bim-project-clear"
                      onClick={() => handleClearProjectRows(project)}
                      disabled={
                        clearingProjectId === project.id ||
                        renamingProjectId === project.id ||
                        deletingProjectId === project.id
                      }
                      aria-label={`Clear rows from ${project.name}`}
                      title="Delete all rows and keep columns"
                    >
                      {clearingProjectId === project.id ? "Clearing..." : "Clear Rows"}
                    </button>
                    <button
                      type="button"
                      className="bim-project-rename"
                      onClick={() => handleRenameProject(project)}
                      disabled={
                        renamingProjectId === project.id ||
                        deletingProjectId === project.id ||
                        clearingProjectId === project.id
                      }
                      aria-label={`Rename ${project.name}`}
                      title="Rename project"
                    >
                      {renamingProjectId === project.id ? "Renaming..." : "Rename"}
                    </button>
                    <button
                      type="button"
                      className="bim-project-delete"
                      onClick={() => handleDeleteProject(project)}
                      disabled={
                        deletingProjectId === project.id ||
                        renamingProjectId === project.id ||
                        clearingProjectId === project.id
                      }
                      aria-label={`Delete ${project.name}`}
                      title="Delete project"
                    >
                      {deletingProjectId === project.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {activeProjectId ? (
              <button
                type="button"
                className="bim-page-btn bim-sidebar-link-btn"
                onClick={() => navigate(`/organization/${id}/bim/${activeProjectId}/view/assignments`)}
              >
                Open Assignment View
              </button>
            ) : null}
          </section>

          <section className="bim-panel bim-main-panel">
            <h2>{activeProject?.name || "Select a project"}</h2>
            <p className="bim-muted">{activeProject?.description || "Choose a project to view row cards and logs."}</p>

            {!!activeProject && (
              <div className="bim-stats">
                <div className="bim-stat-card">
                  <strong>{activeProject.rowCount || 0}</strong>
                  <span>Total rows</span>
                </div>
                <div className="bim-stat-card">
                  <strong>{projectTrendStats.today.total}</strong>
                  <span>{projectTrendStats.today.label}</span>
                  <small className={`bim-stat-trend is-${projectTrendStats.today.direction}`}>
                    {projectTrendStats.today.text} {projectTrendStats.today.comparisonLabel}
                  </small>
                </div>
                <div className="bim-stat-card">
                  <strong>{projectTrendStats.week.total}</strong>
                  <span>{projectTrendStats.week.label}</span>
                  <small className={`bim-stat-trend is-${projectTrendStats.week.direction}`}>
                    {projectTrendStats.week.text} {projectTrendStats.week.comparisonLabel}
                  </small>
                </div>
                <div className="bim-stat-card">
                  <strong>{projectTrendStats.month.total}</strong>
                  <span>{projectTrendStats.month.label}</span>
                  <small className={`bim-stat-trend is-${projectTrendStats.month.direction}`}>
                    {projectTrendStats.month.text} {projectTrendStats.month.comparisonLabel}
                  </small>
                </div>
                <div className="bim-stat-card bim-progress-card">
                  <strong>
                    {projectTrendStats.readyForReview.total}/{projectTrendStats.totalRows}
                  </strong>
                  <span>{projectTrendStats.readyForReview.label}</span>
                  <small className="bim-stat-trend is-flat">
                    {projectTrendStats.readyForReview.pending} pending review
                  </small>
                  <div className="bim-progress-track" aria-label="Ready for review progress" role="img">
                    <div
                      className="bim-progress-fill"
                      style={{ width: `${projectTrendStats.readyForReview.percent}%` }}
                    />
                  </div>
                  <small className="bim-progress-text">{projectTrendStats.readyForReview.percent}% complete</small>
                </div>
              </div>
            )}

            {!!activeProject && projectTrendStats.sourceField ? (
              <p className="bim-muted bim-stats-note">
                Trend source: {projectTrendStats.sourceField} across {projectTrendStats.trackedRows} tracked rows.
              </p>
            ) : null}

            <div className="bim-section-heading-row">
              <h3 className="bim-section-title">Row Cards</h3>
              {activeProjectId ? (
                <div className="bim-section-actions">
                  <button
                    type="button"
                    className="bim-page-btn"
                    onClick={() => setShowQuickCardCreator((previous) => !previous)}
                  >
                    {showQuickCardCreator ? "Hide card creator" : "New card"}
                  </button>
                  <button
                    type="button"
                    className="bim-page-btn"
                    onClick={handleExportBoardCsv}
                  >
                    Export CSV
                  </button>
                  <button
                    type="button"
                    className="bim-page-btn"
                    onClick={() => navigate(`/organization/${id}/bim/${activeProjectId}/view/assignments`)}
                  >
                    Assignment view
                  </button>
                </div>
              ) : null}
            </div>
            {!activeProject ? <p className="bim-muted">No project selected.</p> : null}
            {!!activeProject && !rowsToRender.length ? (
              <p className="bim-muted">No rows yet. Upload an Excel file or create the first card manually.</p>
            ) : null}

            {!!activeProject ? (
              <>
                {showQuickCardCreator ? (
                  <div className="bim-quick-add-panel">
                    <div className="bim-section-heading-row bim-quick-add-heading">
                      <div>
                        <h4 className="bim-section-title bim-quick-add-title">Quick Add Card</h4>
                        <p className="bim-muted bim-quick-add-subtitle">
                          Set the title, image, status, priority, and due date before saving. The ID is generated automatically and stays locked.
                        </p>
                      </div>
                      <button
                        type="button"
                        className="bim-page-btn"
                        onClick={() => setShowQuickCardCreator(false)}
                      >
                        Close
                      </button>
                    </div>
                    <div className="bim-quick-add-grid">
                      <label className="bim-quick-add-field">
                        <span className="bim-field-label">Card ID</span>
                        <input
                          className="bim-input bim-quick-add-readonly"
                          type="text"
                          value={`#${nextQuickCardId}`}
                          readOnly
                          aria-readonly="true"
                        />
                      </label>
                      <label className="bim-quick-add-field bim-quick-add-field-wide">
                        <span className="bim-field-label">Title</span>
                        <input
                          className="bim-input"
                          type="text"
                          placeholder="Enter card title"
                          value={quickCardDraft.title}
                          onChange={(event) => handleQuickCardDraftChange("title", event.target.value)}
                        />
                      </label>
                      <label className="bim-quick-add-field bim-quick-add-field-wide">
                        <span className="bim-field-label">Image URL</span>
                        <input
                          className="bim-input"
                          type="url"
                          placeholder="https://example.com/image.jpg"
                          value={quickCardDraft.imageUrl}
                          onChange={(event) => handleQuickCardDraftChange("imageUrl", event.target.value)}
                        />
                      </label>
                      <label className="bim-quick-add-field">
                        <span className="bim-field-label">Status</span>
                        <select
                          className="bim-select"
                          value={quickCardDraft.status}
                          onChange={(event) => handleQuickCardDraftChange("status", event.target.value)}
                        >
                          <option value="">Select status</option>
                          {configurableStatusOptions.map((value) => (
                            <option key={`quick-status-${value}`} value={value}>{value}</option>
                          ))}
                        </select>
                      </label>
                      <label className="bim-quick-add-field">
                        <span className="bim-field-label">Priority</span>
                        <select
                          className="bim-select"
                          value={quickCardDraft.priority}
                          onChange={(event) => handleQuickCardDraftChange("priority", event.target.value)}
                        >
                          <option value="">Select priority</option>
                          {priorityOptions.map((value) => (
                            <option key={`quick-priority-${value}`} value={value}>{value}</option>
                          ))}
                        </select>
                      </label>
                      <label className="bim-quick-add-field">
                        <span className="bim-field-label">Internal Assignee</span>
                        <select
                          className="bim-select"
                          value={quickCardDraft.internalAssignee}
                          onChange={(event) => handleQuickCardDraftChange("internalAssignee", event.target.value)}
                        >
                          <option value="">Select assignee</option>
                          {internalAssigneeOptions.map((value) => (
                            <option key={`quick-internal-assignee-${value}`} value={value}>{value}</option>
                          ))}
                        </select>
                      </label>
                      <label className="bim-quick-add-field">
                        <span className="bim-field-label">Internal Status</span>
                        <select
                          className="bim-select"
                          value={quickCardDraft.internalStatus}
                          onChange={(event) => handleQuickCardDraftChange("internalStatus", event.target.value)}
                        >
                          <option value="">Select internal status</option>
                          {internalStatusOptions.map((value) => (
                            <option key={`quick-internal-status-${value}`} value={value}>{value}</option>
                          ))}
                        </select>
                      </label>
                      <label className="bim-quick-add-field">
                        <span className="bim-field-label">Due Date</span>
                        <input
                          className="bim-input"
                          type="date"
                          value={quickCardDraft.dueDate}
                          onChange={(event) => handleQuickCardDraftChange("dueDate", event.target.value)}
                        />
                      </label>
                    </div>
                    <div className="bim-quick-add-actions">
                      <button
                        type="button"
                        className="bim-primary bim-quick-add-submit"
                        onClick={handleCreateQuickCard}
                        disabled={creatingQuickCard}
                      >
                        {creatingQuickCard ? "Creating..." : "Create Card"}
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="bim-status-defaults-header">
                  <p className="bim-muted bim-status-defaults-current">
                    Default statuses: {activeProjectDefaultStatuses.length ? activeProjectDefaultStatuses.join(", ") : "None"}
                  </p>
                  <button
                    type="button"
                    className="bim-page-btn"
                    onClick={() => setShowStatusDefaultsManager((previous) => !previous)}
                  >
                    {showStatusDefaultsManager ? "Hide status management" : "Manage statuses"}
                  </button>
                </div>

                <div className="bim-internal-options-panel">
                  <div className="bim-status-defaults-header bim-collapsible-header">
                    <div>
                      <h4 className="bim-section-title bim-status-defaults-title">Internal Dropdown Options</h4>
                      <p className="bim-muted bim-status-defaults-subtitle bim-collapsible-subtitle">
                        Add people and statuses for internal tracking dropdowns on each card.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="bim-page-btn"
                      onClick={() => setShowInternalOptionsManager((previous) => !previous)}
                    >
                      {showInternalOptionsManager ? "Hide internal options" : "Manage internal options"}
                    </button>
                  </div>
                  {showInternalOptionsManager ? (
                    <>
                      <div className="bim-internal-option-block bim-revizto-option-block">
                        <label className="bim-field-label" htmlFor="bim-revizto-template">Revizto link template</label>
                        <div className="bim-inline-control-row">
                          <input
                            id="bim-revizto-template"
                            className="bim-input"
                            type="text"
                            placeholder="https://ws.revizto.com/redirect-app?url=revizto5://viewer/758673/issue_tracker/{id}"
                            value={reviztoTemplateDraft}
                            onChange={(event) => setReviztoTemplateDraft(event.target.value)}
                          />
                          <button
                            type="button"
                            className="bim-status-default-save"
                            onClick={handleSaveReviztoTemplate}
                            disabled={savingReviztoTemplate}
                          >
                            {savingReviztoTemplate ? "Saving..." : "Save"}
                          </button>
                        </div>
                        <p className="bim-muted bim-status-defaults-subtitle">
                          Use {"{id}"} in the template, or keep numeric tail values and they will be replaced by card ID.
                        </p>
                      </div>
                      <div className="bim-internal-options-grid">
                        <div className="bim-internal-option-block">
                          <label className="bim-field-label" htmlFor="bim-new-internal-assignee">Add internal assignee</label>
                          <div className="bim-inline-control-row">
                            <input
                              id="bim-new-internal-assignee"
                              className="bim-input"
                              type="text"
                              placeholder="Person name"
                              value={newInternalAssigneeOption}
                              onChange={(event) => setNewInternalAssigneeOption(event.target.value)}
                            />
                            <button
                              type="button"
                              className="bim-status-default-save"
                              onClick={() => handleAddInternalOption("assignee")}
                              disabled={savingInternalOptions}
                            >
                              Add
                            </button>
                          </div>
                          {projectInternalAssigneeOptions.length ? (
                            <div className="bim-option-list">
                              {projectInternalAssigneeOptions.map((value) => (
                                <div key={`assignee-option-${value}`} className="bim-option-item">
                                  <span className="bim-option-item-value">{value}</span>
                                  <div className="bim-option-item-actions">
                                    <button
                                      type="button"
                                      className="bim-option-btn"
                                      onClick={() => handleEditInternalOption("assignee", value)}
                                      disabled={savingInternalOptions}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      className="bim-option-btn is-danger"
                                      onClick={() => handleRemoveInternalOption("assignee", value)}
                                      disabled={savingInternalOptions}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <div className="bim-internal-option-block">
                          <label className="bim-field-label" htmlFor="bim-new-internal-status">Add internal status</label>
                          <div className="bim-inline-control-row">
                            <input
                              id="bim-new-internal-status"
                              className="bim-input"
                              type="text"
                              placeholder="Status name"
                              value={newInternalStatusOption}
                              onChange={(event) => setNewInternalStatusOption(event.target.value)}
                            />
                            <button
                              type="button"
                              className="bim-status-default-save"
                              onClick={() => handleAddInternalOption("status")}
                              disabled={savingInternalOptions}
                            >
                              Add
                            </button>
                          </div>
                          {projectInternalStatusOptions.length ? (
                            <div className="bim-option-list">
                              {projectInternalStatusOptions.map((value, statusIndex) => (
                                <div key={`status-option-${value}`} className="bim-option-item">
                                  <span className="bim-option-item-value">{value}</span>
                                  <div className="bim-option-item-actions">
                                    <button
                                      type="button"
                                      className="bim-option-btn"
                                      onClick={() => handleMoveInternalStatusOption(value, "up")}
                                      disabled={savingInternalOptions || statusIndex === 0}
                                      title="Move up"
                                    >
                                      ↑
                                    </button>
                                    <button
                                      type="button"
                                      className="bim-option-btn"
                                      onClick={() => handleMoveInternalStatusOption(value, "down")}
                                      disabled={savingInternalOptions || statusIndex === projectInternalStatusOptions.length - 1}
                                      title="Move down"
                                    >
                                      ↓
                                    </button>
                                    <button
                                      type="button"
                                      className="bim-option-btn"
                                      onClick={() => handleEditInternalOption("status", value)}
                                      disabled={savingInternalOptions}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      className="bim-option-btn is-danger"
                                      onClick={() => handleRemoveInternalOption("status", value)}
                                      disabled={savingInternalOptions}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>

                {showStatusDefaultsManager ? (
                  <div className="bim-status-defaults-panel">
                    <h4 className="bim-section-title bim-status-defaults-title">Project Default Statuses</h4>
                    <p className="bim-muted bim-status-defaults-subtitle">
                      Select which statuses matter for this project. The "Default statuses" filter will use these values.
                    </p>
                    {configurableStatusOptions.length ? (
                      <div className="bim-status-defaults-list">
                        {configurableStatusOptions.map((statusValue) => (
                          <label key={statusValue} className="bim-status-default-item">
                            <input
                              type="checkbox"
                              checked={statusDefaultsDraft.includes(statusValue)}
                              onChange={() => handleToggleStatusDefault(statusValue)}
                            />
                            <span>{statusValue}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className="bim-muted">Upload data with statuses to configure defaults.</p>
                    )}
                    <div className="bim-status-default-actions">
                      <button
                        type="button"
                        className="bim-page-btn"
                        onClick={() => setStatusDefaultsDraft([])}
                        disabled={savingStatusDefaults}
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        className="bim-status-default-save"
                        onClick={handleSaveStatusDefaults}
                        disabled={savingStatusDefaults}
                      >
                        {savingStatusDefaults ? "Saving..." : "Save defaults"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}

            {!!activeProject && !!rowsToRender.length ? (
              <div className="bim-filter-bar">
                <select className="bim-filter-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="all">All status</option>
                  {activeProjectDefaultStatuses.length ? <option value="default">Default statuses</option> : null}
                  {statusOptions.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
                <select className="bim-filter-input" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
                  <option value="all">All priorities</option>
                  {priorityOptions.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
                <select className="bim-filter-input" value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
                  <option value="all">All assignees</option>
                  {assigneeOptions.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
                <button
                  type="button"
                  className="bim-page-btn bim-filter-toggle"
                  onClick={() => setShowInternalFilters((previous) => !previous)}
                >
                  {showInternalFilters ? "Hide internal filters" : "Show internal filters"}
                </button>
                <input
                  className="bim-filter-input"
                  type="text"
                  placeholder="Search by ID"
                  value={idSearch}
                  onChange={(e) => setIdSearch(e.target.value)}
                />
                <select className="bim-filter-input" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                  <option value="default">Sort: Default</option>
                  <option value="days_unresolved_desc">Sort: Days not resolved (highest first)</option>
                </select>
                {showInternalFilters ? (
                  <>
                    <select className="bim-filter-input" value={internalAssigneeFilter} onChange={(e) => setInternalAssigneeFilter(e.target.value)}>
                      <option value="all">All internal assignees</option>
                      {internalAssigneeOptions.map((value) => <option key={`internal-assignee-filter-${value}`} value={value}>{value}</option>)}
                    </select>
                    <select className="bim-filter-input" value={internalStatusFilter} onChange={(e) => setInternalStatusFilter(e.target.value)}>
                      <option value="all">All internal status</option>
                      {internalStatusOptions.map((value) => <option key={`internal-status-filter-${value}`} value={value}>{value}</option>)}
                    </select>
                  </>
                ) : null}
              </div>
            ) : null}

            {!!activeProject && !!rowsToRender.length && filteredCardRows.length === 0 ? (
              <p className="bim-muted">No cards match the selected filters.</p>
            ) : null}

            {!!activeProject && filteredCardRows.length > 0 ? (
              <div className="bim-pagination-bar">
                <div className="bim-pagination-summary">
                  Showing {(currentPage - 1) * rowsPerPage + 1}-
                  {Math.min(currentPage * rowsPerPage, sortedCardRows.length)} of {sortedCardRows.length}
                </div>
                <label className="bim-pagination-size" htmlFor="bim-rows-per-page">
                  Per page
                  <select
                    id="bim-rows-per-page"
                    className="bim-filter-input"
                    value={rowsPerPage}
                    onChange={(event) => setRowsPerPage(Number(event.target.value) || 10)}
                  >
                    {BIM_PAGE_SIZE_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </label>
                <div className="bim-pagination-actions">
                  <button
                    type="button"
                    className="bim-page-btn"
                    onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                    disabled={currentPage <= 1}
                  >
                    Prev
                  </button>
                  <span className="bim-page-indicator">Page {currentPage} of {totalCardPages}</span>
                  <button
                    type="button"
                    className="bim-page-btn"
                    onClick={() => setCurrentPage((page) => Math.min(totalCardPages, page + 1))}
                    disabled={currentPage >= totalCardPages}
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}

            <div className="bim-cards-grid">
              {paginatedCardRows.map(({ row, index, preview, daysSinceCreated, unresolvedAgeDays }) => {
                const rowImage = getRowImage(row.rowData, fieldsToRender);
                const cardImageUrl = rowImage?.url || GENERIC_BIM_CARD_IMAGE;
                const cardMetaKey = getCardMetaKey(row, preview);
                const internalDraft = cardInternalDrafts?.[cardMetaKey] || { internalAssignee: "", internalStatus: "", expectedDeadline: normalizeValue(projectInternalCardMeta?.[cardMetaKey]?.expectedDeadline) };
                const expectedDeadlineCountdown = getExpectedDeadlineCountdown(internalDraft.expectedDeadline || projectInternalCardMeta?.[cardMetaKey]?.expectedDeadline);
                const reviztoIssueLink = buildReviztoIssueLink(activeProject?.reviztoIssueLinkTemplate, preview.id);
                const daysAgeClassName = daysSinceCreated >= 15
                  ? "is-critical"
                  : daysSinceCreated >= 8
                    ? "is-warning"
                    : "";

                const unresolvedText = unresolvedAgeDays >= 0
                  ? `${unresolvedAgeDays} day${unresolvedAgeDays === 1 ? "" : "s"} unresolved`
                  : "Resolved";

                return (
                <article
                  key={`${row.rowNumber}-${index}`}
                  className="bim-card bim-card-clickable"
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/organization/${id}/bim/${activeProjectId}/${row.rowNumber}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      navigate(`/organization/${id}/bim/${activeProjectId}/${row.rowNumber}`);
                    }
                  }}
                >
                  <div className="bim-card-head">ID #{preview.id || "-"} • {preview.title || "Untitled task"}</div>
                  <button
                    type="button"
                    className={`bim-card-image-link bim-image-button ${rowImage?.url ? "" : "is-placeholder"}`}
                    title={rowImage?.url ? "Open snapshot image" : "Open image preview"}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      openLightbox(cardImageUrl, `Row ${row.rowNumber} snapshot`);
                    }}
                  >
                    <img
                      src={cardImageUrl}
                      alt={`Row ${row.rowNumber} snapshot`}
                      className="bim-card-image"
                      loading="lazy"
                      onError={applyBimFallbackImage}
                    />
                  </button>
                  <div className="bim-card-body">
                    <div className="bim-card-status-row">
                      <span className="bim-field-label">Status</span>
                      <span className="bim-status-pill">{preview.status || "Not set"}</span>
                    </div>
                    {expectedDeadlineCountdown ? (
                      <div className={`bim-countdown-badge bim-countdown-badge--${expectedDeadlineCountdown.urgency}`}>
                        <span className="bim-countdown-icon">{expectedDeadlineCountdown.urgency === "overdue" ? "⚠" : expectedDeadlineCountdown.urgency === "today" ? "🎯" : "⏳"}</span>
                        <span className="bim-countdown-label">{expectedDeadlineCountdown.label}</span>
                      </div>
                    ) : null}
                    <div className="bim-card-meta-grid">
                      <div className="bim-field-row"><span className="bim-field-label">Priority</span><span className="bim-field-value">{preview.priority || "-"}</span></div>
                      <div className="bim-field-row"><span className="bim-field-label">Assignee</span><span className="bim-field-value">{preview.assignee || "-"}</span></div>
                      <div className="bim-field-row"><span className="bim-field-label">Deadline</span><span className="bim-field-value">{preview.deadline || "-"}</span></div>
                      <div className="bim-field-row"><span className="bim-field-label">ID</span><span className="bim-field-value">{preview.id || "-"}</span></div>
                      <div className="bim-field-row"><span className="bim-field-label">Days Since Created</span><span className={`bim-field-value bim-age-value ${daysAgeClassName}`}>{Number.isFinite(daysSinceCreated) ? `${daysSinceCreated} day${daysSinceCreated === 1 ? "" : "s"}` : "-"}</span></div>
                      <div className="bim-field-row"><span className="bim-field-label">Not Resolved Age</span><span className={`bim-field-value bim-age-value ${daysAgeClassName}`}>{unresolvedText}</span></div>
                    </div>
                    <div
                      className="bim-card-internal"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <h4 className="bim-card-internal-title">Internal Tracking</h4>
                      <select
                        className="bim-card-internal-input"
                        value={internalDraft.internalAssignee || ""}
                        onChange={(event) => handleInternalFieldInlineSave(cardMetaKey, "internalAssignee", event.target.value)}
                      >
                        <option value="">Internal assignee</option>
                        {internalAssigneeOptions.map((assigneeValue) => (
                          <option key={`internal-assignee-${assigneeValue}`} value={assigneeValue}>{assigneeValue}</option>
                        ))}
                      </select>
                      <select
                        className="bim-card-internal-input"
                        value={internalDraft.internalStatus || ""}
                        onChange={(event) => handleInternalFieldInlineSave(cardMetaKey, "internalStatus", event.target.value)}
                      >
                        <option value="">Internal status</option>
                        {internalStatusOptions.map((statusValue) => (
                          <option key={`internal-status-${statusValue}`} value={statusValue}>{statusValue}</option>
                        ))}
                      </select>
                      <label className="bim-field-label">Expected Deadline</label>
                      <input
                        type="date"
                        className="bim-card-internal-input"
                        value={internalDraft.expectedDeadline || ""}
                        onChange={(event) => handleInternalFieldInlineSave(cardMetaKey, "expectedDeadline", event.target.value)}
                      />
                      {savingCardMetaKey === cardMetaKey ? (
                        <span className="bim-inline-saving-note">Saving internal changes...</span>
                      ) : null}
                      {reviztoIssueLink ? (
                        <a
                          href={reviztoIssueLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="bim-card-revizto-btn"
                          onClick={(event) => event.stopPropagation()}
                        >
                          Open in Revizto
                        </a>
                      ) : null}
                    </div>
                  </div>
                </article>
              );})}
            </div>
          </section>
        </div>
        {lightboxModal}
      </div>
    </div>
  );
};

export default BIMModule;
