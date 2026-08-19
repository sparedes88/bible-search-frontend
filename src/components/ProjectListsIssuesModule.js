import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { toast } from "react-toastify";
import { useAuth } from "../contexts/AuthContext";
import { db, storage } from "../firebase";
import ChurchHeader from "./ChurchHeader";
import commonStyles from "../pages/commonStyles";

const containerStyle = {
  width: "100vw",
  maxWidth: "100vw",
  marginLeft: "calc(50% - 50vw)",
  marginRight: "calc(50% - 50vw)",
  padding: "1rem clamp(12px, 2vw, 24px)",
};

const panelStyle = {
  background: "transparent",
  border: "none",
  borderRadius: "0",
  padding: "0",
};

const inputStyle = {
  width: "100%",
  border: "1px solid #D1D5DB",
  borderRadius: "8px",
  padding: "10px 12px",
  fontSize: "0.95rem",
  boxSizing: "border-box",
};

const textareaStyle = {
  ...inputStyle,
  resize: "vertical",
  minHeight: "72px",
};

const buttonBaseStyle = {
  border: "none",
  borderRadius: "8px",
  padding: "8px 12px",
  color: "#FFFFFF",
  fontWeight: 600,
  cursor: "pointer",
};

const STATUS_OPTIONS = ["Open", "In Progress", "On Hold", "Resolved", "Closed", "Complete"];
const isIssueDoneStatus = (status) => {
  const normalized = String(status || "").trim().toLowerCase();
  return normalized === "complete" || normalized === "closed";
};
const ISSUE_URGENCY_OPTIONS = ["Low", "Medium", "High", "Critical"];
const CARD_REVIEW_STEP_OPTIONS = [
  { id: "populate", label: "Populate" },
  { id: "coordinate_internal", label: "Coordinate Internal" },
  { id: "coordinate_other_trades", label: "Coordinate Other Trades" },
  { id: "existing_before", label: "Existing Modeling" },
  { id: "add_hangers", label: "Add Hangers" },
  { id: "add_hangers_with_seismic", label: "Add Hangers With Seismic" },
  { id: "shop_creation", label: "Shop Creation" },
  { id: "change_orders", label: "Change Orders" },
];

const CARD_REVIEW_STEP_LABEL_BY_ID = CARD_REVIEW_STEP_OPTIONS.reduce((accumulator, option) => {
  accumulator[option.id] = option.label;
  return accumulator;
}, {});

const normalizeValue = (value) => String(value || "").trim();

const normalizeBucketIdArray = (value) => {
  const rawValues = Array.isArray(value) ? value : [value];
  const seen = new Set();

  return rawValues
    .flatMap((entry) => {
      if (Array.isArray(entry)) return entry;
      if (typeof entry === "string") return entry.split(",");
      return [entry];
    })
    .map((entry) => String(entry || "").trim())
    .filter((entry) => {
      if (!entry || seen.has(entry)) return false;
      seen.add(entry);
      return true;
    });
};

const normalizeCardReviewStep = (value) => {
  const normalizedValue = normalizeValue(value).toLowerCase().replace(/\s+/g, "_");
  return CARD_REVIEW_STEP_LABEL_BY_ID[normalizedValue] ? normalizedValue : "";
};

const normalizeDayCount = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) return 0;
  return Math.round(numericValue * 100) / 100;
};

const MAX_ISSUE_NOTES = 30;
const MAX_ISSUE_NOTE_ATTACHMENTS = 10;
const MAX_ISSUE_NOTE_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const normalizeIssueNoteAttachments = (value) => {
  if (!Array.isArray(value)) return [];

  return value
    .filter((attachment) => attachment && typeof attachment === "object")
    .map((attachment) => ({
      name: String(attachment.name || "").trim(),
      url: String(attachment.url || "").trim(),
      path: String(attachment.path || "").trim(),
      contentType: String(attachment.contentType || "").trim(),
      uploadedAtIso: String(attachment.uploadedAtIso || "").trim(),
      sizeBytes: Number(attachment.sizeBytes || 0),
    }))
    .filter((attachment) => attachment.url);
};

const getIssueNoteAttachmentCount = (note) =>
  normalizeIssueNoteAttachments(note?.attachments).length;

const sanitizeIssueNoteAttachmentName = (value) =>
  String(value || "file")
    .trim()
    .replace(/[^a-zA-Z0-9._()\- ]+/g, "_")
    .replace(/\s+/g, "-")
    .slice(0, 120) || "file";

const formatAttachmentSize = (bytes) => {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const isAttachmentImage = (attachment) => {
  const contentType = String(attachment?.contentType || "").toLowerCase().trim();
  if (contentType.startsWith("image/")) return true;

  const name = String(attachment?.name || attachment?.url || "").toLowerCase().trim();
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/.test(name);
};

const normalizeIssueNotes = (value) => {
  if (!Array.isArray(value)) return [];

  return value
    .filter((note) => note && typeof note === "object")
    .map((note) => ({
      text: String(note.text || "").trim(),
      createdAtIso: String(note.createdAtIso || "").trim(),
      createdByUid: String(note.createdByUid || "").trim(),
      createdByEmail: String(note.createdByEmail || "").trim(),
      createdByName: String(note.createdByName || "").trim(),
      attachments: normalizeIssueNoteAttachments(note.attachments),
    }))
    .filter((note) => note.text || note.attachments.length > 0);
};

const isIssueProgressUpdateNote = (note) =>
  /^progress update:/i.test(String(note?.text || "").trim());

const getManualIssueNotes = (notes) =>
  normalizeIssueNotes(notes).filter((note) => !isIssueProgressUpdateNote(note));

const hasManualIssueNote = (notes) => getManualIssueNotes(notes).length > 0;

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

const getIssueDueDateValue = (issue) =>
  toDateInputValue(issue?.dueDate || issue?.deadline || issue?.targetDate || "");

const IMPORT_STATUS_MAPPING_STORAGE_PREFIX = "project-lists-issue-import-status-map";

const normalizeImportStatusKey = (value) => String(value || "").trim().toLowerCase();

const normalizeImportStatusValue = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "open") return "Open";
  if (normalized === "close" || normalized === "closed") return "Closed";
  return "";
};

const getImportStatusMappingStorageKey = (churchId, projectId) =>
  [IMPORT_STATUS_MAPPING_STORAGE_PREFIX, String(churchId || "").trim(), String(projectId || "").trim()]
    .filter(Boolean)
    .join(":");

const readImportStatusMapping = (churchId, projectId) => {
  if (typeof window === "undefined") return {};
  try {
    const storageKey = getImportStatusMappingStorageKey(churchId, projectId);
    if (!storageKey) return {};
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};

    return Object.fromEntries(
      Object.entries(parsed)
        .map(([statusKey, statusValue]) => [normalizeImportStatusKey(statusKey), normalizeImportStatusValue(statusValue)])
        .filter(([, statusValue]) => !!statusValue)
    );
  } catch (error) {
    console.warn("Failed to read import status mapping:", error);
    return {};
  }
};

const writeImportStatusMapping = (churchId, projectId, mapping) => {
  if (typeof window === "undefined") return;
  try {
    const storageKey = getImportStatusMappingStorageKey(churchId, projectId);
    if (!storageKey) return;
    window.localStorage.setItem(storageKey, JSON.stringify(mapping || {}));
  } catch (error) {
    console.warn("Failed to save import status mapping:", error);
  }
};

const isE2BucketName = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return false;
  return normalized === "e2" || /^e2([\s_-]|\b)/i.test(normalized);
};

const getIssueNumberForE2Scheduling = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const firstNumericMatch = raw.match(/\d+/);
  if (!firstNumericMatch) return null;
  const numericValue = Number(firstNumericMatch[0]);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return null;
  return Math.floor(numericValue);
};

const getE2AutoDueDateValue = (issueNumberValue) => {
  const numericIssueNumber = getIssueNumberForE2Scheduling(issueNumberValue);
  if (!numericIssueNumber) return "";

  const blockIndex = Math.floor((numericIssueNumber - 1) / 16);
  const offsetDays = (blockIndex + 1) * 2;
  const baseDate = new Date();
  baseDate.setHours(0, 0, 0, 0);
  baseDate.setDate(baseDate.getDate() + offsetDays);

  const year = baseDate.getFullYear();
  const month = String(baseDate.getMonth() + 1).padStart(2, "0");
  const day = String(baseDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const extractBestUrlFromText = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";

  // Markdown link(s): [label](https://...)
  const markdownUrls = Array.from(raw.matchAll(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi)).map((m) => m[1]);
  if (markdownUrls.length) {
    const nonLocalMarkdown = markdownUrls.find((url) => !/localhost/i.test(url));
    return nonLocalMarkdown || markdownUrls[0] || "";
  }

  // Plain URL(s) in text
  const plainUrls = Array.from(raw.matchAll(/https?:\/\/[^\s)"'<>]+/gi)).map((m) => m[0]);
  if (plainUrls.length) {
    const nonLocalPlain = plainUrls.find((url) => !/localhost/i.test(url));
    return nonLocalPlain || plainUrls[0] || "";
  }

  return raw;
};

const normalizeSnapshotUrl = (value) => {
  const raw = extractBestUrlFromText(value);
  if (!raw) return "";

  let normalized = raw;
  if (normalized.startsWith("//")) {
    normalized = `https:${normalized}`;
  }

  const driveMatch = normalized.match(/^https?:\/\/drive\.google\.com\/file\/d\/([^/]+)\//i);
  if (driveMatch?.[1]) {
    normalized = `https://drive.google.com/uc?export=view&id=${driveMatch[1]}`;
  }

  if (/^https?:\/\/www\.dropbox\.com\//i.test(normalized)) {
    normalized = normalized.replace(/[?&]dl=0/i, "");
    normalized += normalized.includes("?") ? "&raw=1" : "?raw=1";
  }

  if (normalized.startsWith("http://")) {
    normalized = `https://${normalized.slice(7)}`;
  }

  return normalized;
};

const getIssueSnapshotUrl = (issue) =>
  normalizeSnapshotUrl(
    issue?.snapshotImageUrl
    || issue?.snapshot
    || issue?.imageUrl
    || issue?.image
    || issue?.mainImageUrl
    || ""
  );

const getDaysUntilDueDate = (value) => {
  const normalized = toDateInputValue(value);
  if (!normalized) return null;

  const dueDate = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(dueDate.getTime())) return null;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const millisPerDay = 24 * 60 * 60 * 1000;
  return Math.round((dueDate.getTime() - today.getTime()) / millisPerDay);
};

const getDueDateCountdownMeta = (value) => {
  const days = getDaysUntilDueDate(value);
  if (days === null) return null;

  if (days < 0) {
    const overdueDays = Math.abs(days);
    return {
      label: `${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue`,
      bg: "#FEE2E2",
      text: "#B91C1C",
    };
  }

  if (days === 0) {
    return {
      label: "Due today",
      bg: "#FEF3C7",
      text: "#92400E",
    };
  }

  return {
    label: `${days} day${days === 1 ? "" : "s"} left`,
    bg: "#DCFCE7",
    text: "#166534",
  };
};

const getDueDateSetterLabel = (issue) => {
  const email = String(issue?.dueDateSetByEmail || "").trim();
  const name = String(issue?.dueDateSetByName || "").trim();
  const uid = String(issue?.dueDateSetByUid || "").trim();
  return email || name || uid || "";
};

const normalizeIssueProgress = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.min(100, Math.max(0, Math.round(numericValue)));
};

const normalizeIssueTag = (value) => String(value || "").trim().replace(/\s+/g, " ");

const normalizeIssueTags = (value) => {
  const rawTags = Array.isArray(value) ? value : String(value || "").split(",");
  const deduped = [];
  const seen = new Set();

  rawTags.forEach((tag) => {
    const normalizedTag = normalizeIssueTag(tag);
    if (!normalizedTag) return;
    const lowerTag = normalizedTag.toLowerCase();
    if (seen.has(lowerTag)) return;
    seen.add(lowerTag);
    deduped.push(normalizedTag);
  });

  return deduped;
};

const normalizeIssueUrgency = (value) => {
  const normalizedValue = String(value || "").trim().toLowerCase();
  const matchedUrgency = ISSUE_URGENCY_OPTIONS.find(
    (option) => option.toLowerCase() === normalizedValue
  );
  return matchedUrgency || "Medium";
};

const getIssueUrgencyColors = (urgency) => {
  switch (normalizeIssueUrgency(urgency).toLowerCase()) {
    case "low":
      return { bg: "#ECFDF5", text: "#166534" };
    case "high":
      return { bg: "#FEF3C7", text: "#92400E" };
    case "critical":
      return { bg: "#FEE2E2", text: "#991B1B" };
    case "medium":
    default:
      return { bg: "#E0E7FF", text: "#3730A3" };
  }
};

const normalizeIssueWorkMarker = (value) => {
  const normalizedValue = String(value || "").trim().toLowerCase();
  if (normalizedValue === "start" || normalizedValue === "stop") return normalizedValue;
  return "";
};

const formatIssueNoteTimestamp = (value) => {
  const parsedDate = value ? new Date(value) : null;
  if (!parsedDate || Number.isNaN(parsedDate.getTime())) return "Unknown time";
  return parsedDate.toLocaleString();
};

const getDateKeyFromDate = (value) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
};

const getIssueCompletionDate = (issue) => {
  const completedAt = issue?.completedAt;
  if (!completedAt) return null;

  if (typeof completedAt?.toDate === "function") {
    const dateValue = completedAt.toDate();
    if (dateValue instanceof Date && !Number.isNaN(dateValue.getTime())) {
      return dateValue;
    }
  }

  const parsedDate = new Date(completedAt);
  if (Number.isNaN(parsedDate.getTime())) return null;
  return parsedDate;
};

const getIssueCompletionFallbackFromProgressNotes = (issue) => {
  const notes = normalizeIssueNotes(issue?.notes);
  for (let index = notes.length - 1; index >= 0; index -= 1) {
    const note = notes[index];
    if (!isIssueProgressUpdateNote(note)) continue;

    const noteText = String(note?.text || "").trim();
    const progressMatch = noteText.match(/^progress update:\s*\d+\s*%\s*->\s*(\d+)\s*%/i);
    if (!progressMatch) continue;

    const nextProgress = Number(progressMatch[1]);
    if (!Number.isFinite(nextProgress) || nextProgress < 100) continue;

    const completedAtDate = note?.createdAtIso ? new Date(note.createdAtIso) : null;
    if (!(completedAtDate instanceof Date) || Number.isNaN(completedAtDate.getTime())) continue;

    const completedByLabel = String(
      note?.createdByEmail || note?.createdByName || note?.createdByUid || "Unknown user"
    ).trim() || "Unknown user";

    return {
      completedAtDate,
      completedByLabel,
    };
  }

  return null;
};

const formatMinutesToDurationLabel = (minutes) => {
  const numericValue = Number(minutes);
  if (!Number.isFinite(numericValue) || numericValue < 0) return "-";

  if (numericValue < 60) {
    return `${Math.round(numericValue)}m`;
  }

  const hours = Math.floor(numericValue / 60);
  const remainingMinutes = Math.round(numericValue % 60);
  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remainingMinutes}m`;
};

const getIssueNoteAuthorLabel = (note) => {
  const email = String(note?.createdByEmail || "").trim();
  const name = String(note?.createdByName || "").trim();
  const uid = String(note?.createdByUid || "").trim();
  return email || name || uid || "Unknown user";
};

const buildIssueNotesTooltip = (notes) => {
  if (!notes.length) return "No notes yet";

  return notes
    .slice(-10)
    .reverse()
    .map((note) => {
      const author = getIssueNoteAuthorLabel(note);
      const timestamp = formatIssueNoteTimestamp(note.createdAtIso);
      const attachmentsCount = getIssueNoteAttachmentCount(note);
      const attachmentSuffix = attachmentsCount > 0
        ? ` (${attachmentsCount} file${attachmentsCount === 1 ? "" : "s"})`
        : "";
      const text = String(note.text || "").trim() || "[Attachment only]";
      return `${author} at ${timestamp}${attachmentSuffix}: ${text}`;
    })
    .join("\n");
};

const getCurrentDateKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

const ProjectListsIssuesModule = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = searchParams.get("tab") || "projects";
  const selectedProjectId = searchParams.get("project") || "";
  const selectedBucketCardId = searchParams.get("bucketCard") || "all";

  const setActiveTab = (tab) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", tab);
      return next;
    });

  const setSelectedProjectId = (pid) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (pid) next.set("project", pid);
      else next.delete("project");
      next.delete("bucketCard");
      return next;
    });

  const setSelectedBucketCardId = (bucketId) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (bucketId && bucketId !== "all") next.set("bucketCard", bucketId);
      else next.delete("bucketCard");
      return next;
    });

  const routePrefix =
    typeof window !== "undefined" && window.location?.pathname?.includes("/church/")
      ? "/church"
      : "/organization";

  // â”€â”€ Collections â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const projectsRef = useMemo(() => collection(db, "churches", id, "projectListIssueProjects"), [id]);
  const bucketsRef = useMemo(
    () =>
      selectedProjectId
        ? collection(db, "churches", id, "projectListIssueProjects", selectedProjectId, "buckets")
        : null,
    [id, selectedProjectId]
  );
  const issuesRef = useMemo(
    () =>
      selectedProjectId
        ? collection(db, "churches", id, "projectListIssueProjects", selectedProjectId, "issues")
        : null,
    [id, selectedProjectId]
  );
  const dayCountLogsRef = useMemo(
    () =>
      selectedProjectId
        ? collection(db, "churches", id, "projectListIssueProjects", selectedProjectId, "dayCountLogs")
        : null,
    [id, selectedProjectId]
  );

  // â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [projects, setProjects] = useState([]);
  const [issues, setIssues] = useState([]);
  const [buckets, setBuckets] = useState([]);

  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingIssues, setLoadingIssues] = useState(false);
  const [loadingBuckets, setLoadingBuckets] = useState(false);

  // Project form
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [projectDraft, setProjectDraft] = useState({ name: "", description: "" });
  const [editingProjectId, setEditingProjectId] = useState("");
  const [editProjectDraft, setEditProjectDraft] = useState({ name: "", description: "" });
  const [isManagingProjects, setIsManagingProjects] = useState(false);
  const [selectedManageProjectId, setSelectedManageProjectId] = useState("");

  // Issue form
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [issueDraft, setIssueDraft] = useState({ issueNumber: "", status: "Open", bucketId: "", dueDate: "" });
  const [lastUsedIssueBucketId, setLastUsedIssueBucketId] = useState("");
  const [editingIssueId, setEditingIssueId] = useState("");
  const [editIssueDraft, setEditIssueDraft] = useState({ issueNumber: "", title: "", description: "", status: "Open", bucketId: "", dueDate: "" });
  const [focusIssueIndex, setFocusIssueIndex] = useState(0);
  const [focusNoteDraft, setFocusNoteDraft] = useState("");
  const [focusSavedNoteCountByIssueId, setFocusSavedNoteCountByIssueId] = useState({});
  const [focusRecentAddedNoteTextByIssueId, setFocusRecentAddedNoteTextByIssueId] = useState({});
  const focusTouchStartXRef = useRef(null);
  const hasRunE2DueDateBackfillRef = useRef(false);
  const [savingDueDateByIssueId, setSavingDueDateByIssueId] = useState({});
  const [editingBucketIssueId, setEditingBucketIssueId] = useState("");
  const [savingBucketByIssueId, setSavingBucketByIssueId] = useState({});
  const [savingUrgencyByIssueId, setSavingUrgencyByIssueId] = useState({});
  const [savingWorkMarkerByIssueId, setSavingWorkMarkerByIssueId] = useState({});
  const [progressDraftByIssueId, setProgressDraftByIssueId] = useState({});
  const [savingProgressByIssueId, setSavingProgressByIssueId] = useState({});
  const [tagDraftByIssueId, setTagDraftByIssueId] = useState({});
  const [savingTagsByIssueId, setSavingTagsByIssueId] = useState({});
  const [linkedIssueDraftByIssueId, setLinkedIssueDraftByIssueId] = useState({});
  const [savingLinkedIssuesByIssueId, setSavingLinkedIssuesByIssueId] = useState({});
  const [compareModalBaseIssueId, setCompareModalBaseIssueId] = useState("");
  const [compareMoveIssueId, setCompareMoveIssueId] = useState("");
  const [compareMoveBucketId, setCompareMoveBucketId] = useState("");
  const [savingCompareMoveIssueId, setSavingCompareMoveIssueId] = useState("");
  const [issueSearchQuery, setIssueSearchQuery] = useState("");
  const [bucketTabIssueSearchQuery, setBucketTabIssueSearchQuery] = useState("");
  const [completedDateFrom, setCompletedDateFrom] = useState("");
  const [completedDateTo, setCompletedDateTo] = useState("");
  const [projectDayCountDraft, setProjectDayCountDraft] = useState("");
  const [dayCountLogs, setDayCountLogs] = useState([]);
  const [loadingDayCountLogs, setLoadingDayCountLogs] = useState(false);

  // Bucket form
  const [showBucketForm, setShowBucketForm] = useState(false);
  const [bucketDraft, setBucketDraft] = useState({
    name: "",
    description: "",
    cardReviewProjectId: "",
    cardReviewStep: "",
    cardReviewCardRef: "",
  });
  const [editingBucketId, setEditingBucketId] = useState("");
  const [editBucketDraft, setEditBucketDraft] = useState({
    name: "",
    description: "",
    cardReviewProjectId: "",
    cardReviewStep: "",
    cardReviewCardRef: "",
  });
  const [isManagingBuckets, setIsManagingBuckets] = useState(false);
  const [selectedManageBucketId, setSelectedManageBucketId] = useState("");
  const [draggedBucketId, setDraggedBucketId] = useState("");
  const [isReorderingBuckets, setIsReorderingBuckets] = useState(false);
  const [cardReviewEntries, setCardReviewEntries] = useState([]);
  const [loadingCardReviewEntries, setLoadingCardReviewEntries] = useState(false);
  const [organizationUsers, setOrganizationUsers] = useState([]);
  const [loadingOrganizationUsers, setLoadingOrganizationUsers] = useState(false);
  const [taskAssigneeUserId, setTaskAssigneeUserId] = useState("");
  const [taskBucketIds, setTaskBucketIds] = useState([]);
  const [movingIssueId, setMovingIssueId] = useState("");
  const [movingIssueBucketId, setMovingIssueBucketId] = useState("");
  const [selectedBucketIssueIds, setSelectedBucketIssueIds] = useState([]);
  const [isBulkSelectMode, setIsBulkSelectMode] = useState(false);
  const [bulkMoveBucketId, setBulkMoveBucketId] = useState("");
  const [isBulkUpdatingIssues, setIsBulkUpdatingIssues] = useState(false);
  const [selectedIssueNotesIssueId, setSelectedIssueNotesIssueId] = useState("");
  const [issueNoteDraft, setIssueNoteDraft] = useState("");
  const [issueNoteFiles, setIssueNoteFiles] = useState([]);
  const [isSavingIssueNote, setIsSavingIssueNote] = useState(false);
  const [issueNoteLightboxAttachment, setIssueNoteLightboxAttachment] = useState(null);
  const [snapshotLightbox, setSnapshotLightbox] = useState(null);
  const issueNoteFileInputRef = useRef(null);
  const [showCompletedByBucketId, setShowCompletedByBucketId] = useState({});
  const [bucketVisibilityFilterIds, setBucketVisibilityFilterIds] = useState([]);
  const [bucketFilterSearchQuery, setBucketFilterSearchQuery] = useState("");
  const [issueTagFilterValues, setIssueTagFilterValues] = useState([]);
  const [issueTagFilterSearchQuery, setIssueTagFilterSearchQuery] = useState("");
  const [selectedBucketNavId, setSelectedBucketNavId] = useState("");
  const [bulkMoveSourceBucketId, setBulkMoveSourceBucketId] = useState("");
  const [bulkMoveSourceBucketName, setBulkMoveSourceBucketName] = useState("");
  const [bulkMoveSourceIssueIds, setBulkMoveSourceIssueIds] = useState([]);
  const [bulkMoveDestinationBucketId, setBulkMoveDestinationBucketId] = useState("");
  const [isBulkMovingBucketIssues, setIsBulkMovingBucketIssues] = useState(false);
  const [progressTabSelectedProjectIds, setProgressTabSelectedProjectIds] = useState([]);
  const [progressDateFrom, setProgressDateFrom] = useState(() => getCurrentDateKey());
  const [progressDateTo, setProgressDateTo] = useState(() => getCurrentDateKey());
  const [progressIssues, setProgressIssues] = useState([]);
  const [loadingProgressIssues, setLoadingProgressIssues] = useState(false);

  // Import issues
  const [showImportIssuesPanel, setShowImportIssuesPanel] = useState(false);
  const [importIssuesRows, setImportIssuesRows] = useState([]);
  const [importIssuesDefaultBucketId, setImportIssuesDefaultBucketId] = useState("");
  const [importIssuesStatusMapping, setImportIssuesStatusMapping] = useState({});
  const [importIssuesLoading, setImportIssuesLoading] = useState(false);
  const importIssuesFileRef = useRef(null);

  // Import buckets
  const [showImportBucketsPanel, setShowImportBucketsPanel] = useState(false);
  const [importBucketsRows, setImportBucketsRows] = useState([]);
  const [importBucketsLoading, setImportBucketsLoading] = useState(false);
  const importBucketsFileRef = useRef(null);

  // â”€â”€ Grouped issues by bucket â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const issuesByBucket = useMemo(() => {
    const grouped = new Map();

    buckets.forEach((bucket) => {
      grouped.set(bucket.id, {
        id: bucket.id,
        name: String(bucket.name || "").trim() || "Untitled Bucket",
        issues: [],
      });
    });

    const unassignedKey = "__unassigned__";
    grouped.set(unassignedKey, { id: unassignedKey, name: "No Bucket", issues: [] });

    issues.forEach((issue) => {
      const bid = String(issue.bucketId || "").trim();
      if (bid && grouped.has(bid)) {
        grouped.get(bid).issues.push(issue);
      } else {
        grouped.get(unassignedKey).issues.push(issue);
      }
    });

    return Array.from(grouped.values()).filter((g) => g.issues.length > 0);
  }, [buckets, issues]);

  const filteredIssuesByBucket = useMemo(() => {
    const normalizedQuery = issueSearchQuery.trim().toLowerCase();
    const selectedGroups = selectedBucketCardId === "all"
      ? issuesByBucket
      : issuesByBucket.filter((g) => g.id === selectedBucketCardId);

    if (!normalizedQuery) return selectedGroups;

    return selectedGroups
      .map((group) => ({
        ...group,
        issues: group.issues.filter((issue) => {
          const bucketName = buckets.find((bucket) => bucket.id === issue.bucketId)?.name || issue.bucketName || "";
          return [issue.issueNumber, issue.title, issue.description, issue.status, bucketName]
            .some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
        }),
      }))
      .filter((group) => group.issues.length > 0);
  }, [buckets, issueSearchQuery, issuesByBucket, selectedBucketCardId]);

  const bucketTabDateFilteredIssuesByBucket = useMemo(() => {
    if (!completedDateFrom && !completedDateTo) {
      return filteredIssuesByBucket;
    }

    return filteredIssuesByBucket
      .map((group) => ({
        ...group,
        issues: group.issues.filter((issue) => {
          const completedAtDate = issue.completedAt?.toDate?.();
          // Include non-completed items regardless of date filter (for search to work on all items)
          if (!completedAtDate) {
            return true;
          }

          const completedDateKey = `${completedAtDate.getFullYear()}-${String(completedAtDate.getMonth() + 1).padStart(2, "0")}-${String(completedAtDate.getDate()).padStart(2, "0")}`;
          if (completedDateFrom && completedDateKey < completedDateFrom) {
            return false;
          }
          if (completedDateTo && completedDateKey > completedDateTo) {
            return false;
          }
          return true;
        }),
      }))
      .filter((group) => group.issues.length > 0);
  }, [completedDateFrom, completedDateTo, filteredIssuesByBucket]);

  const issueTagFilterOptions = useMemo(() => {
    const tagStats = new Map();

    bucketTabDateFilteredIssuesByBucket.forEach((group) => {
      group.issues.forEach((issue) => {
        const tags = normalizeIssueTags(issue.tags);
        const localSeen = new Set();
        tags.forEach((tag) => {
          const lowerTag = tag.toLowerCase();
          if (!lowerTag || localSeen.has(lowerTag)) return;
          localSeen.add(lowerTag);

          const existing = tagStats.get(lowerTag);
          if (existing) {
            existing.count += 1;
          } else {
            tagStats.set(lowerTag, { value: tag, lowerValue: lowerTag, count: 1 });
          }
        });
      });
    });

    return Array.from(tagStats.values()).sort((left, right) =>
      left.value.localeCompare(right.value, undefined, { sensitivity: "base" })
    );
  }, [bucketTabDateFilteredIssuesByBucket]);

  const visibleIssueTagFilterOptions = useMemo(() => {
    const normalizedSearch = String(issueTagFilterSearchQuery || "").trim().toLowerCase();
    if (!normalizedSearch) return issueTagFilterOptions;

    return issueTagFilterOptions.filter((option) =>
      option.lowerValue.includes(normalizedSearch)
    );
  }, [issueTagFilterOptions, issueTagFilterSearchQuery]);

  const selectedIssueTagFilterLabel = useMemo(() => {
    if (!issueTagFilterValues.length) return "All tags";

    const selectedNames = issueTagFilterOptions
      .filter((option) => issueTagFilterValues.includes(option.lowerValue))
      .map((option) => option.value);

    if (selectedNames.length === 0) return "All tags";
    if (selectedNames.length <= 2) return selectedNames.join(", ");
    return `${selectedNames[0]}, ${selectedNames[1]} +${selectedNames.length - 2}`;
  }, [issueTagFilterOptions, issueTagFilterValues]);

  const bucketTabTagFilteredIssuesByBucket = useMemo(() => {
    if (!issueTagFilterValues.length) return bucketTabDateFilteredIssuesByBucket;

    const selectedTags = new Set(issueTagFilterValues);
    return bucketTabDateFilteredIssuesByBucket
      .map((group) => ({
        ...group,
        issues: group.issues.filter((issue) => {
          const issueTags = normalizeIssueTags(issue.tags).map((tag) => tag.toLowerCase());
          return issueTags.some((tag) => selectedTags.has(tag));
        }),
      }))
      .filter((group) => group.issues.length > 0);
  }, [bucketTabDateFilteredIssuesByBucket, issueTagFilterValues]);

  const bucketFilterOptions = useMemo(
    () =>
      bucketTabTagFilteredIssuesByBucket.map((group) => ({
        id: group.id,
        name: group.name,
        count: group.issues.length,
      })).sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      })),
    [bucketTabTagFilteredIssuesByBucket]
  );

  const visibleBucketFilterOptions = useMemo(() => {
    const normalizedSearch = String(bucketFilterSearchQuery || "").trim().toLowerCase();
    if (!normalizedSearch) return bucketFilterOptions;

    return bucketFilterOptions.filter((option) =>
      String(option.name || "").toLowerCase().includes(normalizedSearch)
    );
  }, [bucketFilterOptions, bucketFilterSearchQuery]);

  const selectedBucketFilterLabel = useMemo(() => {
    if (bucketVisibilityFilterIds.length === 0) return "All buckets";

    const selectedNames = bucketFilterOptions
      .filter((option) => bucketVisibilityFilterIds.includes(option.id))
      .map((option) => option.name);

    if (selectedNames.length === 0) return "All buckets";
    if (selectedNames.length <= 2) return selectedNames.join(", ");
    return `${selectedNames[0]}, ${selectedNames[1]} +${selectedNames.length - 2}`;
  }, [bucketFilterOptions, bucketVisibilityFilterIds]);

  const bucketTabVisibleIssuesByBucket = useMemo(() => {
    if (!Array.isArray(bucketVisibilityFilterIds) || bucketVisibilityFilterIds.length === 0) {
      return bucketTabTagFilteredIssuesByBucket;
    }

    const selectedIds = new Set(bucketVisibilityFilterIds.map((value) => String(value || "").trim()).filter(Boolean));
    return bucketTabTagFilteredIssuesByBucket.filter((group) => selectedIds.has(String(group.id || "").trim()));
  }, [bucketTabTagFilteredIssuesByBucket, bucketVisibilityFilterIds]);

  const bucketTabSearchedIssuesByBucket = useMemo(() => {
    const normalizedQuery = String(bucketTabIssueSearchQuery || "").trim().toLowerCase();
    if (!normalizedQuery) return bucketTabVisibleIssuesByBucket;
    return bucketTabVisibleIssuesByBucket
      .map((group) => ({
        ...group,
        issues: group.issues.filter((issue) => {
          if (
            String(issue.title || "").toLowerCase().includes(normalizedQuery) ||
            String(issue.issueNumber || "").toLowerCase().includes(normalizedQuery) ||
            String(issue.description || "").toLowerCase().includes(normalizedQuery) ||
            normalizeIssueTags(issue.tags).some((tag) => tag.toLowerCase().includes(normalizedQuery))
          ) return true;

          const notes = normalizeIssueNotes(issue.notes);
          return notes.some((note) =>
            String(note.text || "").toLowerCase().includes(normalizedQuery) ||
            String(note.createdByEmail || "").toLowerCase().includes(normalizedQuery) ||
            String(note.createdByName || "").toLowerCase().includes(normalizedQuery)
          );
        }),
      }))
      .filter((group) => group.issues.length > 0);
  }, [bucketTabVisibleIssuesByBucket, bucketTabIssueSearchQuery]);

  const leftBucketNavGroups = useMemo(
    () => bucketTabSearchedIssuesByBucket,
    [bucketTabSearchedIssuesByBucket]
  );

  const bucketGrandTotals = useMemo(() => {
    const perBucket = bucketTabDateFilteredIssuesByBucket.map((group) => {
      const completed = group.issues.filter((issue) => isIssueDoneStatus(issue.status)).length;
      const total = group.issues.length;
      const remaining = Math.max(total - completed, 0);
      return {
        id: group.id,
        name: group.name,
        total,
        completed,
        remaining,
      };
    });

    const totals = perBucket.reduce(
      (accumulator, item) => ({
        total: accumulator.total + item.total,
        completed: accumulator.completed + item.completed,
        remaining: accumulator.remaining + item.remaining,
      }),
      { total: 0, completed: 0, remaining: 0 }
    );

    const completionPercent = totals.total > 0
      ? Math.round((totals.completed / totals.total) * 100)
      : 0;

    const topBuckets = perBucket
      .slice()
      .sort((left, right) => {
        if (right.remaining !== left.remaining) return right.remaining - left.remaining;
        return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
      })
      .slice(0, 8);

    return {
      ...totals,
      completionPercent,
      topBuckets,
    };
  }, [bucketTabDateFilteredIssuesByBucket]);

  const selectedIssueForNotes = useMemo(() => {
    if (!selectedIssueNotesIssueId) return null;
    return issues.find((issue) => issue.id === selectedIssueNotesIssueId) || null;
  }, [issues, selectedIssueNotesIssueId]);

  const selectedIssueModalNotes = useMemo(
    () => normalizeIssueNotes(selectedIssueForNotes?.notes),
    [selectedIssueForNotes]
  );

  const selectedIssueModalProgressNotes = useMemo(
    () => selectedIssueModalNotes.filter((note) => isIssueProgressUpdateNote(note)),
    [selectedIssueModalNotes]
  );

  const selectedIssueModalGeneralNotes = useMemo(
    () => selectedIssueModalNotes.filter((note) => !isIssueProgressUpdateNote(note)),
    [selectedIssueModalNotes]
  );

  const visibleIssuesCount = useMemo(
    () => filteredIssuesByBucket.reduce((count, group) => count + group.issues.length, 0),
    [filteredIssuesByBucket]
  );

  const { incompleteCount, completeCount } = useMemo(() => {
    const allIssues = filteredIssuesByBucket.flatMap((group) => group.issues);
    const incomplete = allIssues.filter((issue) => !isIssueDoneStatus(issue.status)).length;
    const complete = allIssues.filter((issue) => isIssueDoneStatus(issue.status)).length;
    return { incompleteCount: incomplete, completeCount: complete };
  }, [filteredIssuesByBucket]);

  const issuesTableRows = useMemo(
    () => filteredIssuesByBucket.flatMap((group) =>
      group.issues.map((issue) => ({
        ...issue,
        groupName: group.name,
      }))
    ),
    [filteredIssuesByBucket]
  );

  const focusIssues = useMemo(
    () => filteredIssuesByBucket.flatMap((group) =>
      group.issues
        .filter((issue) => {
          const normalizedStatus = String(issue?.status || "").trim().toLowerCase();
          const bucketName = String(group?.name || issue?.bucketName || "").trim().toLowerCase();
          const isReadyToAssignBucket = bucketName.includes("ready to assign");
          const isOpenStatus = normalizedStatus === "" || normalizedStatus === "open";
          return isReadyToAssignBucket && isOpenStatus;
        })
        .map((issue) => ({
          ...issue,
          groupName: group.name,
        }))
    ),
    [filteredIssuesByBucket]
  );

  const currentFocusIssue = useMemo(() => {
    if (focusIssues.length === 0) return null;
    const boundedIndex = Math.min(focusIssueIndex, focusIssues.length - 1);
    return focusIssues[boundedIndex] || null;
  }, [focusIssueIndex, focusIssues]);

  const shouldAutoShowIssueForm = useMemo(() => {
    if (activeTab !== "issues" || !selectedProjectId) return false;
    const normalizedIssueSearch = String(issueSearchQuery || "").trim();
    return !!normalizedIssueSearch && issuesTableRows.length === 0;
  }, [activeTab, issueSearchQuery, issuesTableRows.length, selectedProjectId]);

  const effectiveShowIssueForm = showIssueForm || shouldAutoShowIssueForm;

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  const selectedProjectTotalDayCount = useMemo(
    () => normalizeDayCount(selectedProject?.dayCount),
    [selectedProject]
  );

  const importIssuesUniqueStatuses = useMemo(() => {
    const seen = new Set();
    const statuses = [];

    importIssuesRows.forEach((row) => {
      const rawStatus = String(row.statusRaw || "").trim();
      const statusKey = normalizeImportStatusKey(rawStatus);
      if (!statusKey || seen.has(statusKey)) return;
      seen.add(statusKey);
      statuses.push({ key: statusKey, label: rawStatus || "(blank)" });
    });

    return statuses;
  }, [importIssuesRows]);

  const resolvedImportStatusMapping = useMemo(() => {
    const storedMapping = readImportStatusMapping(id, selectedProjectId);
    const merged = {};

    importIssuesUniqueStatuses.forEach((statusEntry) => {
      const currentValue = normalizeImportStatusValue(importIssuesStatusMapping[statusEntry.key]);
      const storedValue = normalizeImportStatusValue(storedMapping[statusEntry.key]);
      merged[statusEntry.key] = currentValue || storedValue || "";
    });

    return merged;
  }, [id, importIssuesStatusMapping, importIssuesUniqueStatuses, selectedProjectId]);

  const importIssuesAllStatusesMapped = useMemo(
    () => importIssuesUniqueStatuses.every((statusEntry) => !!normalizeImportStatusValue(resolvedImportStatusMapping[statusEntry.key])),
    [importIssuesUniqueStatuses, resolvedImportStatusMapping]
  );

  const dailyDayCountSeries = useMemo(() => {
    const dailyMap = new Map();
    dayCountLogs.forEach((entry) => {
      if (!entry.recordedDate) return;
      dailyMap.set(entry.recordedDate, normalizeDayCount(entry.dayCount));
    });

    return Array.from(dailyMap.entries())
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [dayCountLogs]);

  const todayDateKey = useMemo(() => getCurrentDateKey(), []);

  const todayTaskAssignments = useMemo(() => {
    const tasksByDate = selectedProject?.dailyTasks || {};
    const tasksForToday = tasksByDate?.[todayDateKey];
    return Array.isArray(tasksForToday) ? tasksForToday : [];
  }, [selectedProject, todayDateKey]);

  const tasksByUserId = useMemo(() => {
    const map = new Map();
    todayTaskAssignments.forEach((assignment) => {
      const uid = String(assignment?.userId || "").trim();
      if (!uid) return;
      const existing = map.get(uid) || [];
      existing.push(assignment);
      map.set(uid, existing);
    });
    return map;
  }, [todayTaskAssignments]);

  const visibleBucketIssueIds = useMemo(() => {
    const hasActiveSearch = String(bucketTabIssueSearchQuery || "").trim().length > 0;
    return leftBucketNavGroups.flatMap((group) => {
      const showCompletedIssues = !!showCompletedByBucketId[group.id];
      const visibleIssues = (showCompletedIssues || hasActiveSearch)
        ? group.issues
        : group.issues.filter((issue) => !isIssueDoneStatus(issue.status));
      return visibleIssues.map((issue) => issue.id);
    });
  }, [bucketTabIssueSearchQuery, leftBucketNavGroups, showCompletedByBucketId]);

  const progressActivityRows = useMemo(() => {
    return progressIssues
      .flatMap((issue) => {
        const projectName = String(issue?.projectName || "Selected project").trim() || "Selected project";
        const issueNumber = String(issue?.issueNumber || issue?.id || "-").trim() || "-";
        return normalizeIssueNotes(issue?.notes)
          .map((note, noteIndex) => {
            const rawText = String(note?.text || "").trim();
            const isProgressUpdate = rawText.startsWith("Progress update:");
            const attachmentCount = getIssueNoteAttachmentCount(note);
            const logText = rawText || (attachmentCount > 0
              ? `Attachment update (${attachmentCount} file${attachmentCount === 1 ? "" : "s"})`
              : "[Empty note]");
            const createdAtLabel = formatIssueNoteTimestamp(note?.createdAtIso);
            const parsedCreatedAt = note?.createdAtIso ? new Date(note.createdAtIso) : null;
            const createdAtMs = parsedCreatedAt && !Number.isNaN(parsedCreatedAt.getTime())
              ? parsedCreatedAt.getTime()
              : 0;

            return {
              id: `${issue.id || issueNumber}-${noteIndex}-${note?.createdAtIso || ""}-${isProgressUpdate ? "progress" : "note"}`,
              issueNumber,
              projectName,
              createdBy: getIssueNoteAuthorLabel(note),
              createdAtLabel,
              createdAtMs,
              activityType: isProgressUpdate ? "Progress Added" : "Note Added",
              logText,
            };
          });
      })
      .sort((left, right) => right.createdAtMs - left.createdAtMs);
  }, [progressIssues]);

  const filteredProgressActivityRows = useMemo(() => {
    if (!progressDateFrom && !progressDateTo) return progressActivityRows;

    return progressActivityRows.filter((entry) => {
      if (!Number.isFinite(entry.createdAtMs) || entry.createdAtMs <= 0) return false;
      const entryDateKey = getDateKeyFromDate(new Date(entry.createdAtMs));
      if (!entryDateKey) return false;
      if (progressDateFrom && entryDateKey < progressDateFrom) return false;
      if (progressDateTo && entryDateKey > progressDateTo) return false;
      return true;
    });
  }, [progressActivityRows, progressDateFrom, progressDateTo]);

  const progressDateFilterLabel = useMemo(() => {
    if (progressDateFrom && progressDateTo) {
      return progressDateFrom === progressDateTo
        ? `Date: ${progressDateFrom}`
        : `Date: ${progressDateFrom} to ${progressDateTo}`;
    }
    if (progressDateFrom) return `From: ${progressDateFrom}`;
    if (progressDateTo) return `Up to: ${progressDateTo}`;
    return "All dates";
  }, [progressDateFrom, progressDateTo]);

  const progressProjectOptions = useMemo(
    () => projects.slice().sort((left, right) =>
      String(left?.name || "").localeCompare(String(right?.name || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      })
    ),
    [projects]
  );

  const effectiveProgressProjectIds = useMemo(() => {
    if (progressTabSelectedProjectIds.length > 0) {
      return progressTabSelectedProjectIds;
    }
    return selectedProjectId ? [selectedProjectId] : [];
  }, [progressTabSelectedProjectIds, selectedProjectId]);

  const completedIssuesInRangeRows = useMemo(() => {
    return progressIssues
      .map((issue) => {
        const statusValue = String(issue?.status || "").toLowerCase();
        const completionFallback = getIssueCompletionFallbackFromProgressNotes(issue);
        const issueProgress = normalizeIssueProgress(issue?.progressPercent);
        const hasProgressCompletion = issueProgress >= 100 && !!completionFallback;
        const isCompletedForReporting =
          isIssueDoneStatus(statusValue)
          || issueProgress >= 100
          || !!completionFallback;
        if (!isCompletedForReporting) return null;

        const completedAtDate = hasProgressCompletion
          ? (completionFallback?.completedAtDate || getIssueCompletionDate(issue))
          : (getIssueCompletionDate(issue) || completionFallback?.completedAtDate);
        if (!completedAtDate) return null;

        const completedDateKey = getDateKeyFromDate(completedAtDate);
        if (!completedDateKey) return null;
        if (progressDateFrom && completedDateKey < progressDateFrom) return null;
        if (progressDateTo && completedDateKey > progressDateTo) return null;

        const completedByLabel = String(
          hasProgressCompletion
            ? (completionFallback?.completedByLabel
              || issue?.completedByEmail
              || issue?.completedByName
              || issue?.completedByUid)
            : (issue?.completedByEmail
              || issue?.completedByName
              || issue?.completedByUid
              || completionFallback?.completedByLabel)
            || "Unknown user"
        ).trim() || "Unknown user";

        return {
          id: String(issue?.id || ""),
          issueNumber: String(issue?.issueNumber || issue?.id || "-").trim() || "-",
          projectId: String(issue?.projectId || "").trim(),
          projectName: String(issue?.projectName || "Untitled Project").trim() || "Untitled Project",
          completedByLabel,
          completedAtDate,
          completedAtMs: completedAtDate.getTime(),
        };
      })
      .filter(Boolean)
      .sort((left, right) => right.completedAtMs - left.completedAtMs);
  }, [progressDateFrom, progressDateTo, progressIssues]);

  const completedInRangeProjectTotals = useMemo(() => {
    const totalsByProject = completedIssuesInRangeRows.reduce((accumulator, row) => {
      const projectId = String(row.projectId || row.projectName || "").trim() || row.projectName;
      const existing = accumulator[projectId] || {
        projectId,
        projectName: row.projectName,
        completedCount: 0,
      };

      existing.completedCount += 1;
      accumulator[projectId] = existing;
      return accumulator;
    }, {});

    return Object.values(totalsByProject).sort((left, right) => {
      if (right.completedCount !== left.completedCount) {
        return right.completedCount - left.completedCount;
      }
      return String(left.projectName || "").localeCompare(String(right.projectName || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
  }, [completedIssuesInRangeRows]);

  const completedInRangeUserTotals = useMemo(() => {
    const totalsByUser = completedIssuesInRangeRows.reduce((accumulator, row) => {
      const userKey = row.completedByLabel.toLowerCase();
      const existing = accumulator[userKey] || {
        userLabel: row.completedByLabel,
        completedCount: 0,
        projectIds: new Set(),
        completionTimes: [],
      };

      existing.completedCount += 1;
      existing.projectIds.add(row.projectId || row.projectName);
      existing.completionTimes.push(row.completedAtMs);
      accumulator[userKey] = existing;
      return accumulator;
    }, {});

    return Object.values(totalsByUser)
      .map((entry) => {
        const sortedTimes = entry.completionTimes.slice().sort((left, right) => left - right);
        const gapMinutes = [];
        for (let index = 1; index < sortedTimes.length; index += 1) {
          const diffMinutes = (sortedTimes[index] - sortedTimes[index - 1]) / (1000 * 60);
          if (Number.isFinite(diffMinutes) && diffMinutes >= 0) {
            gapMinutes.push(diffMinutes);
          }
        }

        const averageGapMinutes = gapMinutes.length
          ? gapMinutes.reduce((sum, value) => sum + value, 0) / gapMinutes.length
          : null;

        return {
          userLabel: entry.userLabel,
          completedCount: entry.completedCount,
          projectCount: entry.projectIds.size,
          averageGapMinutes,
        };
      })
      .sort((left, right) => {
        if (right.completedCount !== left.completedCount) {
          return right.completedCount - left.completedCount;
        }
        return String(left.userLabel || "").localeCompare(String(right.userLabel || ""), undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });
  }, [completedIssuesInRangeRows]);

  const collaboratorsByUser = useMemo(() => {
    if (completedIssuesInRangeRows.length === 0) return [];

    const issueById = new Map(progressIssues.map((issue) => [String(issue?.id || ""), issue]));
    const totalsByUser = {};

    for (const row of completedIssuesInRangeRows) {
      const issue = issueById.get(row.id);
      if (!issue) continue;
      const manualNotes = getManualIssueNotes(issue.notes);
      const noteUsersSeen = new Set();
      for (const note of manualNotes) {
        const userLabel = String(note.createdByEmail || note.createdByName || note.createdByUid || "").trim();
        if (!userLabel) continue;
        const userKey = userLabel.toLowerCase();
        if (noteUsersSeen.has(userKey)) continue;
        noteUsersSeen.add(userKey);
        if (!totalsByUser[userKey]) {
          totalsByUser[userKey] = { userLabel, issueCount: 0, projectIds: new Set() };
        }
        totalsByUser[userKey].issueCount += 1;
        totalsByUser[userKey].projectIds.add(row.projectId || row.projectName);
      }
    }

    return Object.values(totalsByUser)
      .map((entry) => ({
        userLabel: entry.userLabel,
        issueCount: entry.issueCount,
        projectCount: entry.projectIds.size,
      }))
      .sort((left, right) => {
        if (right.issueCount !== left.issueCount) return right.issueCount - left.issueCount;
        return String(left.userLabel || "").localeCompare(String(right.userLabel || ""), undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });
  }, [completedIssuesInRangeRows, progressIssues]);

  const completionTimingInRange = useMemo(() => {
    const sortedCompletionTimes = completedIssuesInRangeRows
      .map((row) => row.completedAtMs)
      .sort((left, right) => left - right);

    if (sortedCompletionTimes.length < 2) {
      return {
        averageGapMinutes: null,
        shortestGapMinutes: null,
        longestGapMinutes: null,
      };
    }

    const gaps = [];
    for (let index = 1; index < sortedCompletionTimes.length; index += 1) {
      const diffMinutes = (sortedCompletionTimes[index] - sortedCompletionTimes[index - 1]) / (1000 * 60);
      if (Number.isFinite(diffMinutes) && diffMinutes >= 0) {
        gaps.push(diffMinutes);
      }
    }

    if (gaps.length === 0) {
      return {
        averageGapMinutes: null,
        shortestGapMinutes: null,
        longestGapMinutes: null,
      };
    }

    const totalGapMinutes = gaps.reduce((sum, value) => sum + value, 0);
    return {
      averageGapMinutes: totalGapMinutes / gaps.length,
      shortestGapMinutes: Math.min(...gaps),
      longestGapMinutes: Math.max(...gaps),
    };
  }, [completedIssuesInRangeRows]);

  const hasTodayDayCountLog = useMemo(
    () => dayCountLogs.some((entry) => entry.recordedDate === todayDateKey),
    [dayCountLogs, todayDateKey]
  );

  const cardReviewProjects = useMemo(() => {
    const projectMap = cardReviewEntries.reduce((accumulator, entry) => {
      const projectId = normalizeValue(entry.projectId);
      if (!projectId) return accumulator;

      const existing = accumulator[projectId] || {
        id: projectId,
        label: normalizeValue(entry.projectName) || projectId,
      };

      if (!existing.label && normalizeValue(entry.projectName)) {
        existing.label = normalizeValue(entry.projectName);
      }

      accumulator[projectId] = existing;
      return accumulator;
    }, {});

    return Object.values(projectMap).sort((left, right) =>
      String(left.label || left.id).localeCompare(String(right.label || right.id), undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );
  }, [cardReviewEntries]);

  const cardReviewCardsByProjectAndStep = useMemo(() => {
    return cardReviewEntries.reduce((accumulator, entry) => {
      const projectId = normalizeValue(entry.projectId);
      const step = normalizeCardReviewStep(entry.step);
      if (!projectId || !step) return accumulator;

      const projectBucket = accumulator[projectId] || {};
      const existing = projectBucket[step] || [];
      existing.push(entry);
      projectBucket[step] = existing;
      accumulator[projectId] = projectBucket;
      return accumulator;
    }, {});
  }, [cardReviewEntries]);

  const getCardReviewCardsForSelection = (projectId, stepId) => {
    const normalizedProjectId = normalizeValue(projectId);
    const normalizedStep = normalizeCardReviewStep(stepId);
    if (!normalizedProjectId || !normalizedStep) return [];
    return cardReviewCardsByProjectAndStep?.[normalizedProjectId]?.[normalizedStep] || [];
  };

  const getFirstCardForSelection = (projectId, stepId) => {
    const cardsForStep = getCardReviewCardsForSelection(projectId, stepId);
    return cardsForStep.length > 0 ? cardsForStep[0].cardRef : "";
  };

  useEffect(() => {
    setProjectDayCountDraft(String(selectedProject?.dayCount ?? ""));
  }, [selectedProjectId, selectedProject]);

  useEffect(() => {
    if (!dayCountLogsRef) {
      setDayCountLogs([]);
      return;
    }

    setLoadingDayCountLogs(true);
    const unsubscribe = onSnapshot(
      query(dayCountLogsRef, orderBy("recordedAt", "asc")),
      (snapshot) => {
        const logs = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() || {};
          const recordedAtDate = data.recordedAt?.toDate?.();
          const fallbackDate = recordedAtDate
            ? `${recordedAtDate.getFullYear()}-${String(recordedAtDate.getMonth() + 1).padStart(2, "0")}-${String(recordedAtDate.getDate()).padStart(2, "0")}`
            : "";

          return {
            id: docSnap.id,
            dayCount: normalizeDayCount(data.dayCount),
            recordedDate: String(data.recordedDate || fallbackDate || ""),
            recordedBy: String(data.recordedBy || ""),
            recordedAt: recordedAtDate || null,
          };
        });

        setDayCountLogs(logs);
        setLoadingDayCountLogs(false);
      },
      (error) => {
        console.error("Failed to load day count logs:", error);
        setLoadingDayCountLogs(false);
      }
    );

    return unsubscribe;
  }, [dayCountLogsRef]);

  useEffect(() => {
    if (!id) {
      setCardReviewEntries([]);
      return () => {};
    }

    const floorProgressDocRef = doc(db, "churches", id, "timeRotateFloorPlanner", "floorCategoryProgress");
    setLoadingCardReviewEntries(true);

    const unsubscribe = onSnapshot(
      floorProgressDocRef,
      (snapshot) => {
        const data = snapshot.data() || {};
        const rawCardReview = data.cardReview;
        if (!rawCardReview || typeof rawCardReview !== "object" || Array.isArray(rawCardReview)) {
          setCardReviewEntries([]);
          setLoadingCardReviewEntries(false);
          return;
        }

        const dedupedByProjectCardRef = new Map();

        Object.entries(rawCardReview).forEach(([projectIdKey, projectValue]) => {
          const projectId = normalizeValue(projectIdKey);
          if (!projectValue || typeof projectValue !== "object" || Array.isArray(projectValue)) return;

          Object.values(projectValue).forEach((floorValue) => {
            if (!floorValue || typeof floorValue !== "object" || Array.isArray(floorValue)) return;

            Object.entries(floorValue).forEach(([cardRefKey, entryValue]) => {
              const cardRef = normalizeValue(cardRefKey);
              if (!cardRef) return;

              const step = normalizeCardReviewStep(entryValue?.step || "");
              if (!step) return;

              const updatedAt = Number(entryValue?.updatedAt) || 0;
              const dedupeKey = `${projectId}::${cardRef}`;
              const existing = dedupedByProjectCardRef.get(dedupeKey);
              if (!existing || updatedAt >= existing.updatedAt) {
                dedupedByProjectCardRef.set(dedupeKey, {
                  projectId,
                  projectName: projectId,
                  cardRef,
                  step,
                  updatedAt,
                });
              }
            });
          });
        });

        const nextEntries = Array.from(dedupedByProjectCardRef.values()).sort((left, right) => {
          const projectCompare = left.projectId.localeCompare(right.projectId, undefined, {
            numeric: true,
            sensitivity: "base",
          });
          if (projectCompare !== 0) return projectCompare;
          return left.cardRef.localeCompare(right.cardRef, undefined, { numeric: true, sensitivity: "base" });
        }
        );

        setCardReviewEntries(nextEntries);
        setLoadingCardReviewEntries(false);
      },
      (error) => {
        console.error("Failed to load Card Review entries for buckets:", error);
        setCardReviewEntries([]);
        setLoadingCardReviewEntries(false);
      }
    );

    return unsubscribe;
  }, [id]);

  useEffect(() => {
    if (!id || !user?.uid) {
      setOrganizationUsers([]);
      setLoadingOrganizationUsers(false);
      return;
    }

    setLoadingOrganizationUsers(true);

    const toUserEntry = (docSnap) => {
      const data = docSnap.data() || {};
      const fullName = String(
        data.displayName
        || data.name
        || `${String(data.firstName || "").trim()} ${String(data.lastName || "").trim()}`.trim()
        || data.email
        || docSnap.id
      ).trim();

      return {
        id: docSnap.id,
        name: fullName,
        email: String(data.email || "").trim(),
      };
    };

    const loadCurrentUserFallback = async () => {
      try {
        const currentUserSnap = await getDoc(doc(db, "users", user.uid));
        if (currentUserSnap.exists()) {
          setOrganizationUsers([toUserEntry(currentUserSnap)]);
        } else {
          setOrganizationUsers([]);
        }
      } catch (fallbackError) {
        console.error("Failed to load current user fallback:", fallbackError);
        setOrganizationUsers([]);
      } finally {
        setLoadingOrganizationUsers(false);
      }
    };

    const unsubscribe = onSnapshot(
      query(collection(db, "users"), where("churchId", "==", id)),
      (snapshot) => {
        const users = snapshot.docs
          .map((docSnap) => toUserEntry(docSnap))
          .sort((a, b) => a.name.localeCompare(b.name));

        setOrganizationUsers(users);
        setLoadingOrganizationUsers(false);
      },
      async (error) => {
        console.error("Failed to load organization users:", error);

        const errorCode = String(error?.code || "");
        if (errorCode === "permission-denied") {
          await loadCurrentUserFallback();
          return;
        }

        toast.error("Failed to load users.");
        await loadCurrentUserFallback();
      }
    );

    return unsubscribe;
  }, [id, user?.uid]);

  // â”€â”€ Load projects (realtime) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (!id) return;
    setLoadingProjects(true);
    const unsubscribe = onSnapshot(
      query(projectsRef, orderBy("createdAt", "desc")),
      (snap) => {
        setProjects(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoadingProjects(false);
      },
      (error) => {
        console.error("Failed to load projects:", error);
        toast.error("Failed to load projects.");
        setLoadingProjects(false);
      }
    );
    return unsubscribe;
  }, [id, projectsRef]);

  // â”€â”€ Load issues for selected project (realtime) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (!issuesRef) {
      setIssues([]);
      return;
    }
    setLoadingIssues(true);
    const unsubscribe = onSnapshot(
      query(issuesRef, orderBy("createdAt", "desc")),
      (snap) => {
        setIssues(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoadingIssues(false);
      },
      (error) => {
        console.error("Failed to load issues:", error);
        toast.error("Failed to load issues.");
        setIssues([]);
        setLoadingIssues(false);
      }
    );
    return unsubscribe;
  }, [issuesRef]);

  // Load issues for progress tab across multiple selected projects (realtime)
  useEffect(() => {
    if (activeTab !== "progress" || !id) {
      setLoadingProgressIssues(false);
      return;
    }

    const targetProjectIds = effectiveProgressProjectIds
      .map((value) => String(value || "").trim())
      .filter(Boolean);

    if (targetProjectIds.length === 0) {
      setProgressIssues([]);
      setLoadingProgressIssues(false);
      return;
    }

    const projectNameById = projects.reduce((accumulator, project) => {
      accumulator[String(project.id || "").trim()] = String(project.name || "").trim() || "Untitled Project";
      return accumulator;
    }, {});

    let didCancel = false;
    let hasShownLoadError = false;
    let pendingInitialSnapshots = targetProjectIds.length;
    const initializedProjectIds = new Set();
    const issuesByProjectId = new Map();

    const syncCombinedIssues = () => {
      if (didCancel) return;

      const mergedIssues = targetProjectIds.flatMap((projectId) =>
        (issuesByProjectId.get(projectId) || []).map((issue) => ({
          ...issue,
          projectId,
          projectName: projectNameById[projectId] || "Untitled Project",
        }))
      );

      setProgressIssues(mergedIssues);
      if (pendingInitialSnapshots <= 0) {
        setLoadingProgressIssues(false);
      }
    };

    setLoadingProgressIssues(true);

    const unsubscribes = targetProjectIds.map((projectId) => {
      const projectIssuesRef = collection(db, "churches", id, "projectListIssueProjects", projectId, "issues");
      return onSnapshot(
        query(projectIssuesRef, orderBy("createdAt", "desc")),
        (snapshot) => {
          issuesByProjectId.set(projectId, snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
          if (!initializedProjectIds.has(projectId)) {
            initializedProjectIds.add(projectId);
            pendingInitialSnapshots -= 1;
          }
          syncCombinedIssues();
        },
        (error) => {
          console.error("Failed to load progress issues:", error);
          issuesByProjectId.set(projectId, []);
          if (!initializedProjectIds.has(projectId)) {
            initializedProjectIds.add(projectId);
            pendingInitialSnapshots -= 1;
          }
          if (!hasShownLoadError) {
            toast.error("Failed to load some progress activity.");
            hasShownLoadError = true;
          }
          syncCombinedIssues();
        }
      );
    });

    return () => {
      didCancel = true;
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [activeTab, effectiveProgressProjectIds, id, projects]);

  // â”€â”€ Load buckets (realtime) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (!bucketsRef) {
      setBuckets([]);
      return;
    }
    setLoadingBuckets(true);
    const unsubscribe = onSnapshot(
      query(bucketsRef),
      (snap) => {
        const nextBuckets = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        nextBuckets.sort((left, right) => {
          const leftOrder = Number.isFinite(Number(left.sortOrder)) ? Number(left.sortOrder) : Number.MAX_SAFE_INTEGER;
          const rightOrder = Number.isFinite(Number(right.sortOrder)) ? Number(right.sortOrder) : Number.MAX_SAFE_INTEGER;
          if (leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
          }

          return String(left.name || "").localeCompare(String(right.name || ""), undefined, {
            numeric: true,
            sensitivity: "base",
          });
        });
        setBuckets(nextBuckets);
        setLoadingBuckets(false);
      },
      (error) => {
        console.error("Failed to load buckets:", error);
        toast.error("Failed to load buckets.");
        setLoadingBuckets(false);
      }
    );
    return unsubscribe;
  }, [bucketsRef]);

  // Auto-select Ready for Review bucket as default for issue import
  useEffect(() => {
    const readyBucket = buckets.find((b) => String(b.name || '').trim().toLowerCase() === 'ready for review');
    if (readyBucket) {
      setImportIssuesDefaultBucketId((prev) => prev || readyBucket.id);
    }
  }, [buckets]);



  // â”€â”€ Project CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleCreateProject = async (event) => {
    event.preventDefault();
    const name = String(projectDraft.name || "").trim() || "Untitled Project";
    try {
      const newDoc = await addDoc(projectsRef, {
        name,
        description: String(projectDraft.description || "").trim(),
        createdBy: user?.uid || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await addDoc(collection(db, "churches", id, "projectListIssueProjects", newDoc.id, "buckets"), {
        name: "Ready for Review",
        description: "",
        sortOrder: 0,
        cardReviewProjectId: "",
        cardReviewStep: "",
        cardReviewCardRef: "",
        createdBy: user?.uid || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setProjectDraft({ name: "", description: "" });
      setShowProjectForm(false);
      setSelectedProjectId(newDoc.id);
      toast.success("Project created.");
    } catch (error) {
      console.error("Failed to create project:", error);
      toast.error("Could not create project.");
    }
  };

  const handleUpdateProject = async (projectId) => {
    const name = String(editProjectDraft.name || "").trim();
    if (!name) { toast.warning("Project name is required."); return; }
    try {
      await updateDoc(doc(db, "churches", id, "projectListIssueProjects", projectId), {
        name,
        description: String(editProjectDraft.description || "").trim(),
        updatedAt: serverTimestamp(),
      });
      setEditingProjectId("");
      toast.success("Project updated.");
    } catch (error) {
      console.error("Failed to update project:", error);
      toast.error("Could not update project.");
    }
  };

  const handleDeleteProject = async (projectId) => {
    if (!window.confirm("Delete this project? All issues inside it will also be deleted.")) return;
    try {
      const issuesSnap = await getDocs(
        collection(db, "churches", id, "projectListIssueProjects", projectId, "issues")
      );
      for (const issueDoc of issuesSnap.docs) {
        await deleteDoc(doc(db, "churches", id, "projectListIssueProjects", projectId, "issues", issueDoc.id));
      }
      await deleteDoc(doc(db, "churches", id, "projectListIssueProjects", projectId));
      if (selectedProjectId === projectId) setSelectedProjectId("");
      toast.success("Project deleted.");
    } catch (error) {
      console.error("Failed to delete project:", error);
      toast.error("Could not delete project.");
    }
  };

  // â”€â”€ Issue CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleCreateIssue = async (event) => {
    event.preventDefault();
    if (!selectedProjectId) { toast.warning("Select a project first."); return; }
    const issueNumber = String(issueDraft.issueNumber || "").trim();
    const bucketId = String(issueDraft.bucketId || "").trim();
    if (!issueNumber) { toast.warning("Issue number is required."); return; }
    if (!bucketId) { toast.warning("Please assign a bucket card."); return; }
    const duplicateIssue = issues.some(
      (issue) => String(issue.issueNumber || "").trim().toLowerCase() === issueNumber.toLowerCase()
    );
    if (duplicateIssue) { toast.warning("That issue number already exists in this project."); return; }
    const selectedBucket = buckets.find((b) => b.id === bucketId);
    const e2AutoDueDate = isE2BucketName(selectedBucket?.name)
      ? getE2AutoDueDateValue(issueNumber)
      : "";
    const nextDueDate = e2AutoDueDate || toDateInputValue(issueDraft.dueDate);
    try {
      await addDoc(issuesRef, {
        issueNumber,
        title: "",
        description: "",
        status: issueDraft.status || "Open",
        urgencyLevel: "Medium",
        workMarker: "",
        workMarkerAtIso: "",
        workMarkerByUid: "",
        workMarkerByEmail: "",
        workMarkerByName: "",
        tags: [],
        dueDate: nextDueDate,
        dueDateSetByUid: nextDueDate ? String(user?.uid || "") : "",
        dueDateSetByEmail: nextDueDate ? String(user?.email || "") : "",
        dueDateSetByName: nextDueDate ? String(user?.displayName || user?.name || "") : "",
        bucketId,
        bucketName: selectedBucket?.name || "",
        createdBy: user?.uid || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setLastUsedIssueBucketId(bucketId);
      setIssueDraft({ issueNumber: "", status: "Open", bucketId, dueDate: "" });
      setIssueSearchQuery("");
      toast.success("Issue created.");
    } catch (error) {
      console.error("Failed to create issue:", error);
      toast.error("Could not create issue.");
    }
  };

  const handleUpdateIssue = async (issueId) => {
    const issueNumber = String(editIssueDraft.issueNumber || "").trim();
    if (!issueNumber) { toast.warning("Issue number is required."); return; }
    const duplicateIssue = issues.some(
      (issue) => issue.id !== issueId && String(issue.issueNumber || "").trim().toLowerCase() === issueNumber.toLowerCase()
    );
    if (duplicateIssue) { toast.warning("That issue number already exists in this project."); return; }
    const selectedBucket = buckets.find((b) => b.id === editIssueDraft.bucketId);
    const e2AutoDueDate = isE2BucketName(selectedBucket?.name)
      ? getE2AutoDueDateValue(issueNumber)
      : "";
    const nextDueDate = e2AutoDueDate || toDateInputValue(editIssueDraft.dueDate);
    try {
      await updateDoc(
        doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "issues", issueId),
        {
          issueNumber,
          title: String(editIssueDraft.title || "").trim(),
          description: String(editIssueDraft.description || "").trim(),
          status: editIssueDraft.status || "Open",
          bucketId: String(editIssueDraft.bucketId || "").trim(),
          dueDate: nextDueDate,
          dueDateSetByUid: nextDueDate ? String(user?.uid || "") : "",
          dueDateSetByEmail: nextDueDate ? String(user?.email || "") : "",
          dueDateSetByName: nextDueDate ? String(user?.displayName || user?.name || "") : "",
          bucketName: selectedBucket?.name || "",
          updatedAt: serverTimestamp(),
        }
      );
      setEditingIssueId("");
      toast.success("Issue updated.");
    } catch (error) {
      console.error("Failed to update issue:", error);
      toast.error("Could not update issue.");
    }
  };

  const handleDeleteIssue = async (issueId) => {
    if (!window.confirm("Delete this issue?")) return;
    try {
      await deleteDoc(
        doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "issues", issueId)
      );
      toast.success("Issue deleted.");
    } catch (error) {
      console.error("Failed to delete issue:", error);
      toast.error("Could not delete issue.");
    }
  };

  const handleDeleteAllProjectIssues = async () => {
    if (!selectedProjectId) {
      toast.warning("Select a project first.");
      return;
    }
    if (issues.length === 0) {
      toast.info("This project has no issues to delete.");
      return;
    }

    const projectLabel = String(selectedProject?.name || "this project").trim() || "this project";
    const firstConfirm = window.confirm(
      `Delete ALL ${issues.length} issue(s) in ${projectLabel}? This cannot be undone.`
    );
    if (!firstConfirm) return;

    const secondConfirm = window.confirm(
      "Final confirmation: this will permanently remove every issue in the selected project. Continue?"
    );
    if (!secondConfirm) return;

    try {
      const issuesSnapshot = await getDocs(
        collection(db, "churches", id, "projectListIssueProjects", selectedProjectId, "issues")
      );

      await Promise.all(
        issuesSnapshot.docs.map((issueDoc) =>
          deleteDoc(
            doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "issues", issueDoc.id)
          )
        )
      );

      setSelectedBucketIssueIds([]);
      setBulkMoveBucketId("");
      toast.success(`Deleted ${issuesSnapshot.size} issue(s).`);
    } catch (error) {
      console.error("Failed to delete all project issues:", error);
      toast.error("Could not delete all issues.");
    }
  };

  const handleIssueDueDateChange = async (issue, nextValue) => {
    if (!selectedProjectId || !issue?.id) return;

    const currentDueDate = getIssueDueDateValue(issue);
    const nextDueDate = toDateInputValue(nextValue);
    if (currentDueDate === nextDueDate) return;

    setSavingDueDateByIssueId((previous) => ({
      ...previous,
      [issue.id]: true,
    }));

    try {
      await updateDoc(
        doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "issues", issue.id),
        {
          dueDate: nextDueDate,
          dueDateSetByUid: nextDueDate ? String(user?.uid || "") : "",
          dueDateSetByEmail: nextDueDate ? String(user?.email || "") : "",
          dueDateSetByName: nextDueDate ? String(user?.displayName || user?.name || "") : "",
          updatedAt: serverTimestamp(),
        }
      );
    } catch (error) {
      console.error("Failed to update issue due date:", error);
      toast.error("Could not update due date.");
    } finally {
      setSavingDueDateByIssueId((previous) => ({
        ...previous,
        [issue.id]: false,
      }));
    }
  };

  const handleIssueUrgencyChange = async (issue, nextValue) => {
    if (!selectedProjectId || !issue?.id) return;

    const currentUrgency = normalizeIssueUrgency(issue.urgencyLevel);
    const normalizedUrgency = normalizeIssueUrgency(nextValue);
    if (currentUrgency === normalizedUrgency) return;

    setSavingUrgencyByIssueId((previous) => ({
      ...previous,
      [issue.id]: true,
    }));

    try {
      await updateDoc(
        doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "issues", issue.id),
        {
          urgencyLevel: normalizedUrgency,
          updatedAt: serverTimestamp(),
        }
      );
      toast.success(`Urgency set to ${normalizedUrgency} for issue #${issue.issueNumber || issue.id}.`);
    } catch (error) {
      console.error("Failed to update issue urgency:", error);
      toast.error("Could not update urgency.");
    } finally {
      setSavingUrgencyByIssueId((previous) => ({
        ...previous,
        [issue.id]: false,
      }));
    }
  };

  const handleIssueWorkMarkerChange = async (issue, nextMarker) => {
    if (!selectedProjectId || !issue?.id) return;

    const currentMarker = normalizeIssueWorkMarker(issue.workMarker);
    const normalizedMarker = normalizeIssueWorkMarker(nextMarker);
    if (currentMarker === normalizedMarker) return;

    setSavingWorkMarkerByIssueId((previous) => ({
      ...previous,
      [issue.id]: true,
    }));

    try {
      const markerAtIso = normalizedMarker ? new Date().toISOString() : "";
      await updateDoc(
        doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "issues", issue.id),
        {
          workMarker: normalizedMarker,
          workMarkerAtIso: markerAtIso,
          workMarkerByUid: normalizedMarker ? String(user?.uid || "") : "",
          workMarkerByEmail: normalizedMarker ? String(user?.email || "") : "",
          workMarkerByName: normalizedMarker ? String(user?.displayName || user?.name || "") : "",
          updatedAt: serverTimestamp(),
        }
      );

      if (normalizedMarker) {
        toast.success(`${normalizedMarker === "start" ? "Start" : "Stop"} marker set for issue #${issue.issueNumber || issue.id}.`);
      } else {
        toast.success(`Start/Stop marker cleared for issue #${issue.issueNumber || issue.id}.`);
      }
    } catch (error) {
      console.error("Failed to update issue work marker:", error);
      toast.error("Could not update start/stop marker.");
    } finally {
      setSavingWorkMarkerByIssueId((previous) => ({
        ...previous,
        [issue.id]: false,
      }));
    }
  };

  const handleSaveIssueProgress = async (issue, explicitNextProgress = null, options = {}) => {
    if (!selectedProjectId || !issue?.id) return;

    const showNoChangeToast = options.showNoChangeToast !== false;
    const showSuccessToast = options.showSuccessToast !== false;

    const currentProgress = normalizeIssueProgress(issue.progressPercent);
    const draftProgress = explicitNextProgress === null
      ? progressDraftByIssueId[issue.id]
      : explicitNextProgress;
    const nextProgress = normalizeIssueProgress(
      draftProgress === undefined ? currentProgress : draftProgress
    );

    if (nextProgress === currentProgress) {
      if (showNoChangeToast) {
        toast.info("Progress is already up to date.");
      }
      return;
    }

    setSavingProgressByIssueId((previous) => ({ ...previous, [issue.id]: true }));
    try {
      const existingNotes = normalizeIssueNotes(issue.notes);
      const createdAtIso = new Date().toISOString();
      const progressUpdatedBy = String(user?.displayName || user?.name || user?.email || user?.uid || "Unknown user").trim();
      const progressTimestampLabel = formatIssueNoteTimestamp(createdAtIso);
      const progressNote = {
        text: `Progress update: ${currentProgress}% -> ${nextProgress}% | Timestamp: ${progressTimestampLabel} | Updated by: ${progressUpdatedBy}`,
        createdAtIso,
        createdByUid: String(user?.uid || ""),
        createdByEmail: String(user?.email || ""),
        createdByName: String(user?.displayName || user?.name || ""),
        attachments: [],
      };

      const nextNotes = [...existingNotes, progressNote].slice(-MAX_ISSUE_NOTES);
      const shouldAutoComplete =
        nextProgress >= 100
        && !isIssueDoneStatus(issue.status);
      const shouldStampCompletionMetadata =
        nextProgress >= 100
        && (!issue?.completedAt || !String(issue?.completedByUid || issue?.completedByEmail || "").trim());

      const payload = {
        progressPercent: nextProgress,
        notes: nextNotes,
        lastNoteAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      if (shouldAutoComplete) {
        payload.status = "Complete";
      }

      if (shouldAutoComplete || shouldStampCompletionMetadata) {
        payload.completedByUid = String(user?.uid || "");
        payload.completedByEmail = String(user?.email || "");
        payload.completedAt = serverTimestamp();
      }

      await updateDoc(
        doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "issues", issue.id),
        payload
      );
      setProgressDraftByIssueId((previous) => ({ ...previous, [issue.id]: nextProgress }));
      if (showSuccessToast) {
        toast.success(`Progress saved at ${nextProgress}%.`);
      }
    } catch (error) {
      console.error("Failed to save issue progress:", error);
      toast.error("Could not save progress.");
    } finally {
      setSavingProgressByIssueId((previous) => ({ ...previous, [issue.id]: false }));
    }
  };

  const handleAddIssueTag = async (issue, providedTag = null) => {
    if (!selectedProjectId || !issue?.id) return;

    const fallbackDraft = tagDraftByIssueId[issue.id] || "";
    const nextTag = normalizeIssueTag(providedTag === null ? fallbackDraft : providedTag);
    if (!nextTag) {
      toast.warning("Tag cannot be empty.");
      return;
    }

    const currentTags = normalizeIssueTags(issue.tags);
    if (currentTags.some((tag) => tag.toLowerCase() === nextTag.toLowerCase())) {
      toast.warning("That tag already exists for this issue.");
      return;
    }

    setSavingTagsByIssueId((previous) => ({ ...previous, [issue.id]: true }));
    try {
      await updateDoc(
        doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "issues", issue.id),
        {
          tags: [...currentTags, nextTag],
          updatedAt: serverTimestamp(),
        }
      );
      setTagDraftByIssueId((previous) => ({ ...previous, [issue.id]: "" }));
    } catch (error) {
      console.error("Failed to add issue tag:", error);
      toast.error("Could not add tag.");
    } finally {
      setSavingTagsByIssueId((previous) => ({ ...previous, [issue.id]: false }));
    }
  };

  const handleRemoveIssueTag = async (issue, tagToRemove) => {
    if (!selectedProjectId || !issue?.id) return;
    const normalizedRemove = normalizeIssueTag(tagToRemove).toLowerCase();
    if (!normalizedRemove) return;

    const currentTags = normalizeIssueTags(issue.tags);
    const nextTags = currentTags.filter((tag) => tag.toLowerCase() !== normalizedRemove);
    if (nextTags.length === currentTags.length) return;

    setSavingTagsByIssueId((previous) => ({ ...previous, [issue.id]: true }));
    try {
      await updateDoc(
        doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "issues", issue.id),
        {
          tags: nextTags,
          updatedAt: serverTimestamp(),
        }
      );
    } catch (error) {
      console.error("Failed to remove issue tag:", error);
      toast.error("Could not remove tag.");
    } finally {
      setSavingTagsByIssueId((previous) => ({ ...previous, [issue.id]: false }));
    }
  };

  const handleEditIssueTag = async (issue, currentTag) => {
    if (!selectedProjectId || !issue?.id) return;
    const editedValue = window.prompt("Edit tag", currentTag || "");
    if (editedValue === null) return;

    const nextTag = normalizeIssueTag(editedValue);
    if (!nextTag) {
      toast.warning("Tag cannot be empty.");
      return;
    }

    const currentTags = normalizeIssueTags(issue.tags);
    const currentTagLower = normalizeIssueTag(currentTag).toLowerCase();
    const hasDuplicate = currentTags.some(
      (tag) => tag.toLowerCase() === nextTag.toLowerCase() && tag.toLowerCase() !== currentTagLower
    );
    if (hasDuplicate) {
      toast.warning("That tag already exists for this issue.");
      return;
    }

    const nextTags = currentTags.map((tag) =>
      tag.toLowerCase() === currentTagLower ? nextTag : tag
    );

    setSavingTagsByIssueId((previous) => ({ ...previous, [issue.id]: true }));
    try {
      await updateDoc(
        doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "issues", issue.id),
        {
          tags: normalizeIssueTags(nextTags),
          updatedAt: serverTimestamp(),
        }
      );
    } catch (error) {
      console.error("Failed to edit issue tag:", error);
      toast.error("Could not edit tag.");
    } finally {
      setSavingTagsByIssueId((previous) => ({ ...previous, [issue.id]: false }));
    }
  };

  const normalizeLinkedIssues = (value) => {
    const rawArr = Array.isArray(value) ? value : [];
    const deduped = [];
    const seen = new Set();
    rawArr.forEach((entry) => {
      const num = String(entry?.issueNumber || "").trim();
      const issueId = String(entry?.issueId || "").trim();
      if (!num) return;
      const key = num.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      deduped.push({ issueNumber: num, issueId });
    });
    return deduped;
  };

  const handleAddLinkedIssue = async (issue) => {
    if (!selectedProjectId || !issue?.id) return;
    const rawDraft = String(linkedIssueDraftByIssueId[issue.id] || "").trim();
    const draftNumber = rawDraft.replace(/^#/, "").trim();
    if (!draftNumber) { toast.warning("Enter an issue number to link."); return; }

    const currentLinked = normalizeLinkedIssues(issue.linkedIssues);
    if (currentLinked.some((li) => li.issueNumber.toLowerCase() === draftNumber.toLowerCase())) {
      toast.warning("That issue is already linked.");
      return;
    }

    const targetIssue = issues.find((i) => String(i.issueNumber || "").trim().toLowerCase() === draftNumber.toLowerCase());
    if (!targetIssue) { toast.warning(`Issue #${draftNumber} not found in this project.`); return; }
    if (targetIssue.id === issue.id) { toast.warning("Cannot link an issue to itself."); return; }

    setSavingLinkedIssuesByIssueId((prev) => ({ ...prev, [issue.id]: true }));
    try {
      // Write link on the source issue
      await updateDoc(
        doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "issues", issue.id),
        {
          linkedIssues: [...currentLinked, { issueNumber: targetIssue.issueNumber, issueId: targetIssue.id }],
          updatedAt: serverTimestamp(),
        }
      );
      // Write back-link on the target issue (bidirectional)
      const targetCurrentLinked = normalizeLinkedIssues(targetIssue.linkedIssues);
      const alreadyBackLinked = targetCurrentLinked.some(
        (li) => li.issueNumber.toLowerCase() === String(issue.issueNumber || "").toLowerCase()
      );
      if (!alreadyBackLinked) {
        await updateDoc(
          doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "issues", targetIssue.id),
          {
            linkedIssues: [...targetCurrentLinked, { issueNumber: issue.issueNumber, issueId: issue.id }],
            updatedAt: serverTimestamp(),
          }
        );
      }
      setLinkedIssueDraftByIssueId((prev) => ({ ...prev, [issue.id]: "" }));
      // Optimistically update local state for both sides immediately
      setIssues((prev) => prev.map((i) => {
        if (i.id === issue.id) {
          return { ...i, linkedIssues: [...currentLinked, { issueNumber: targetIssue.issueNumber, issueId: targetIssue.id }] };
        }
        if (i.id === targetIssue.id) {
          const tLinked = normalizeLinkedIssues(i.linkedIssues);
          const alreadyThere = tLinked.some((li) => li.issueNumber.toLowerCase() === String(issue.issueNumber || "").toLowerCase());
          if (alreadyThere) return i;
          return { ...i, linkedIssues: [...tLinked, { issueNumber: issue.issueNumber, issueId: issue.id }] };
        }
        return i;
      }));
    } catch (error) {
      console.error("Failed to link issue:", error);
      toast.error("Could not link issue.");
    } finally {
      setSavingLinkedIssuesByIssueId((prev) => ({ ...prev, [issue.id]: false }));
    }
  };

  const handleCompareMoveIssueToBucket = async (targetIssue) => {
    if (!selectedProjectId || !targetIssue?.id || !compareMoveBucketId) return;
    const selectedBucket = buckets.find((b) => b.id === compareMoveBucketId);
    if (!selectedBucket) return;
    setSavingCompareMoveIssueId(targetIssue.id);
    try {
      await updateDoc(
        doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "issues", targetIssue.id),
        {
          bucketId: compareMoveBucketId,
          bucketName: selectedBucket.name || "",
          ...getAutoCompleteStatusFieldsForBucketMove(targetIssue, selectedBucket.name || ""),
          ...getAutoDueDateFieldsForBucketMove(targetIssue, selectedBucket.name || ""),
          updatedAt: serverTimestamp(),
        }
      );
      toast.success(`Issue #${targetIssue.issueNumber || targetIssue.id} moved to ${selectedBucket.name}.`);
      setCompareMoveIssueId("");
      setCompareMoveBucketId("");
    } catch (error) {
      console.error("Failed to move issue from compare modal:", error);
      toast.error("Could not move issue.");
    } finally {
      setSavingCompareMoveIssueId("");
    }
  };

  const handleRemoveLinkedIssue = async (issue, linkedIssueNumber) => {
    if (!selectedProjectId || !issue?.id) return;
    const currentLinked = normalizeLinkedIssues(issue.linkedIssues);
    const nextLinked = currentLinked.filter(
      (li) => li.issueNumber.toLowerCase() !== String(linkedIssueNumber || "").toLowerCase()
    );
    if (nextLinked.length === currentLinked.length) return;

    setSavingLinkedIssuesByIssueId((prev) => ({ ...prev, [issue.id]: true }));
    try {
      // Remove from source issue
      await updateDoc(
        doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "issues", issue.id),
        { linkedIssues: nextLinked, updatedAt: serverTimestamp() }
      );
      // Remove back-link from the target issue (bidirectional)
      const targetIssue = issues.find(
        (i) => String(i.issueNumber || "").trim().toLowerCase() === String(linkedIssueNumber || "").toLowerCase()
      );
      if (targetIssue) {
        const targetCurrentLinked = normalizeLinkedIssues(targetIssue.linkedIssues);
        const targetNextLinked = targetCurrentLinked.filter(
          (li) => li.issueNumber.toLowerCase() !== String(issue.issueNumber || "").toLowerCase()
        );
        if (targetNextLinked.length !== targetCurrentLinked.length) {
          await updateDoc(
            doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "issues", targetIssue.id),
            { linkedIssues: targetNextLinked, updatedAt: serverTimestamp() }
          );
        }
        // Optimistically update local state for both sides immediately
        setIssues((prev) => prev.map((i) => {
          if (i.id === issue.id) return { ...i, linkedIssues: nextLinked };
          if (i.id === targetIssue.id) return { ...i, linkedIssues: targetNextLinked };
          return i;
        }));
      } else {
        // No target found in local state — still patch source optimistically
        setIssues((prev) => prev.map((i) => i.id === issue.id ? { ...i, linkedIssues: nextLinked } : i));
      }
    } catch (error) {
      console.error("Failed to unlink issue:", error);
      toast.error("Could not remove linked issue.");
    } finally {
      setSavingLinkedIssuesByIssueId((prev) => ({ ...prev, [issue.id]: false }));
    }
  };

  const handleSaveProjectDayCount = async () => {
    if (!selectedProjectId) return;

    if (hasTodayDayCountLog) {
      toast.warning("Today's day count is already logged. You can add another entry tomorrow.");
      return;
    }

    const normalizedProjectDayCount = normalizeDayCount(projectDayCountDraft);
    const recordedDate = todayDateKey;

    try {
      await updateDoc(
        doc(db, "churches", id, "projectListIssueProjects", selectedProjectId),
        {
          dayCount: normalizedProjectDayCount,
          updatedAt: serverTimestamp(),
        }
      );

      if (dayCountLogsRef) {
        await addDoc(dayCountLogsRef, {
          dayCount: normalizedProjectDayCount,
          recordedDate,
          recordedAt: serverTimestamp(),
          recordedBy: user?.uid || "",
        });
      }

      toast.success("Project day count updated.");
    } catch (error) {
      console.error("Failed to update project day count:", error);
      toast.error("Could not update project day count.");
    }
  };

  // â”€â”€ Bucket CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleCreateBucket = async (event) => {
    event.preventDefault();
    if (!selectedProjectId) { toast.warning("Select a project first."); return; }
    const name = String(bucketDraft.name || "").trim() || "Untitled Bucket";
    const duplicate = buckets.some((b) => String(b.name || "").trim().toLowerCase() === name.toLowerCase());
    if (duplicate) { toast.warning("That bucket already exists."); return; }
    try {
      await addDoc(bucketsRef, {
        name,
        description: String(bucketDraft.description || "").trim(),
        sortOrder: buckets.length,
        cardReviewProjectId: normalizeValue(bucketDraft.cardReviewProjectId),
        cardReviewStep: normalizeCardReviewStep(bucketDraft.cardReviewStep),
        cardReviewCardRef: normalizeValue(bucketDraft.cardReviewCardRef),
        createdBy: user?.uid || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setBucketDraft({
        name: "",
        description: "",
        cardReviewProjectId: "",
        cardReviewStep: "",
        cardReviewCardRef: "",
      });
      setShowBucketForm(false);
      toast.success("Bucket created.");
    } catch (error) {
      console.error("Failed to create bucket:", error);
      toast.error("Could not create bucket.");
    }
  };

  const handleUpdateBucket = async (bucketId) => {
    const name = String(editBucketDraft.name || "").trim();
    if (!name) { toast.warning("Bucket name is required."); return; }
    const duplicate = buckets.some(
      (b) => b.id !== bucketId && String(b.name || "").trim().toLowerCase() === name.toLowerCase()
    );
    if (duplicate) { toast.warning("That bucket name already exists."); return; }
    try {
      await updateDoc(doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "buckets", bucketId), {
        name,
        description: String(editBucketDraft.description || "").trim(),
        cardReviewProjectId: normalizeValue(editBucketDraft.cardReviewProjectId),
        cardReviewStep: normalizeCardReviewStep(editBucketDraft.cardReviewStep),
        cardReviewCardRef: normalizeValue(editBucketDraft.cardReviewCardRef),
        updatedAt: serverTimestamp(),
      });
      setEditingBucketId("");
      toast.success("Bucket updated.");
    } catch (error) {
      console.error("Failed to update bucket:", error);
      toast.error("Could not update bucket.");
    }
  };

  const handleDeleteBucket = async (bucketId) => {
    if (!window.confirm("Delete this bucket?")) return;
    try {
      await deleteDoc(doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "buckets", bucketId));
      toast.success("Bucket deleted.");
    } catch (error) {
      console.error("Failed to delete bucket:", error);
      toast.error("Could not delete bucket.");
    }
  };

  const handleDeleteAllBuckets = async () => {
    if (!selectedProjectId) {
      toast.warning("Select a project first.");
      return;
    }
    if (buckets.length === 0) {
      toast.info("This project has no buckets to delete.");
      return;
    }

    const projectLabel = String(selectedProject?.name || "this project").trim() || "this project";
    const confirmed = window.confirm(
      `Delete ALL ${buckets.length} bucket(s) in ${projectLabel}? This cannot be undone.`
    );
    if (!confirmed) return;

    try {
      const bucketsSnapshot = await getDocs(
        collection(db, "churches", id, "projectListIssueProjects", selectedProjectId, "buckets")
      );

      await Promise.all(
        bucketsSnapshot.docs.map((bucketDoc) =>
          deleteDoc(
            doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "buckets", bucketDoc.id)
          )
        )
      );

      setSelectedManageBucketId("");
      setEditingBucketId("");
      setDraggedBucketId("");
      toast.success(`Deleted ${bucketsSnapshot.size} bucket(s).`);
    } catch (error) {
      console.error("Failed to delete all buckets:", error);
      toast.error("Could not delete all buckets.");
    }
  };

  const handleReorderBuckets = async (sourceBucketId, targetBucketId) => {
    if (!selectedProjectId || !sourceBucketId || !targetBucketId || sourceBucketId === targetBucketId) {
      return;
    }

    const currentBuckets = [...buckets];
    const sourceIndex = currentBuckets.findIndex((bucket) => bucket.id === sourceBucketId);
    const targetIndex = currentBuckets.findIndex((bucket) => bucket.id === targetBucketId);
    if (sourceIndex === -1 || targetIndex === -1) {
      return;
    }

    const reorderedBuckets = [...currentBuckets];
    const [movedBucket] = reorderedBuckets.splice(sourceIndex, 1);
    reorderedBuckets.splice(targetIndex, 0, movedBucket);

    setBuckets(reorderedBuckets);
    setIsReorderingBuckets(true);

    try {
      await Promise.all(
        reorderedBuckets.map((bucket, index) => {
          if (Number(bucket.sortOrder) === index) {
            return Promise.resolve();
          }

          return updateDoc(
            doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "buckets", bucket.id),
            {
              sortOrder: index,
              updatedAt: serverTimestamp(),
            }
          );
        })
      );
      toast.success("Bucket order updated.");
    } catch (error) {
      console.error("Failed to reorder buckets:", error);
      setBuckets(currentBuckets);
      toast.error("Could not reorder buckets.");
    } finally {
      setDraggedBucketId("");
      setIsReorderingBuckets(false);
    }
  };

  // â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    setIssueSearchQuery("");
    setCompletedDateFrom("");
    setCompletedDateTo("");
    setIssueTagFilterValues([]);
    setIssueTagFilterSearchQuery("");
    setShowCompletedByBucketId({});
    setBucketVisibilityFilterIds([]);
    setBucketFilterSearchQuery("");
    setShowIssueForm(false);
    setSavingUrgencyByIssueId({});
    setSavingWorkMarkerByIssueId({});
    setProgressDraftByIssueId({});
    setSavingProgressByIssueId({});
    setIsManagingBuckets(false);
    setSelectedManageBucketId("");
    setEditingBucketId("");
    setDraggedBucketId("");
    setTaskBucketIds([]);
    setSelectedBucketIssueIds([]);
    setBulkMoveBucketId("");
    setBulkMoveSourceBucketId("");
    setBulkMoveSourceBucketName("");
    setBulkMoveSourceIssueIds([]);
    setBulkMoveDestinationBucketId("");
  }, [selectedProjectId]);

  useEffect(() => {
    const validIds = new Set(issues.map((issue) => issue.id));
    setSelectedBucketIssueIds((previous) => previous.filter((issueId) => validIds.has(issueId)));
    setProgressDraftByIssueId((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([issueId]) => validIds.has(issueId))
      )
    );
    setSavingProgressByIssueId((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([issueId]) => validIds.has(issueId))
      )
    );
    setSavingUrgencyByIssueId((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([issueId]) => validIds.has(issueId))
      )
    );
    setSavingWorkMarkerByIssueId((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([issueId]) => validIds.has(issueId))
      )
    );
  }, [issues]);

  useEffect(() => {
    if (focusIssues.length === 0) {
      if (focusIssueIndex !== 0) {
        setFocusIssueIndex(0);
      }
      return;
    }

    if (focusIssueIndex > focusIssues.length - 1) {
      setFocusIssueIndex(focusIssues.length - 1);
    }
  }, [focusIssueIndex, focusIssues]);

  useEffect(() => {
    if (activeTab === "focus") {
      setFocusIssueIndex(0);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!showImportIssuesPanel || !selectedProjectId || importIssuesUniqueStatuses.length === 0) {
      return;
    }

    const storedMapping = readImportStatusMapping(id, selectedProjectId);
    setImportIssuesStatusMapping((previous) => {
      const next = {};
      importIssuesUniqueStatuses.forEach((statusEntry) => {
        next[statusEntry.key] = normalizeImportStatusValue(previous[statusEntry.key])
          || normalizeImportStatusValue(storedMapping[statusEntry.key])
          || "";
      });
      return next;
    });
  }, [id, importIssuesUniqueStatuses, selectedProjectId, showImportIssuesPanel]);

  useEffect(() => {
    if (!showImportIssuesPanel || !selectedProjectId || importIssuesUniqueStatuses.length === 0) return;
    writeImportStatusMapping(id, selectedProjectId, resolvedImportStatusMapping);
  }, [id, importIssuesUniqueStatuses.length, resolvedImportStatusMapping, selectedProjectId, showImportIssuesPanel]);

  useEffect(() => {
    if (!id || projects.length === 0) return;
    if (hasRunE2DueDateBackfillRef.current) return;

    hasRunE2DueDateBackfillRef.current = true;
    let isCancelled = false;

    const runE2DueDateBackfill = async () => {
      try {
        let updatedCount = 0;

        for (const project of projects) {
          const projectId = String(project?.id || "").trim();
          if (!projectId) continue;

          const issuesSnapshot = await getDocs(
            collection(db, "churches", id, "projectListIssueProjects", projectId, "issues")
          );

          const updates = issuesSnapshot.docs
            .map((issueDoc) => {
              const issueData = { id: issueDoc.id, ...issueDoc.data() };
              const bucketName = String(issueData?.bucketName || "").trim();
              if (!isE2BucketName(bucketName)) return null;

              const nextDueDate = getE2AutoDueDateValue(issueData?.issueNumber);
              if (!nextDueDate) return null;

              const currentDueDate = getIssueDueDateValue(issueData);
              if (currentDueDate === nextDueDate) return null;

              return updateDoc(issueDoc.ref, {
                dueDate: nextDueDate,
                dueDateSetByUid: String(user?.uid || ""),
                dueDateSetByEmail: String(user?.email || ""),
                dueDateSetByName: String(user?.displayName || user?.name || ""),
                updatedAt: serverTimestamp(),
              });
            })
            .filter(Boolean);

          if (updates.length > 0) {
            await Promise.all(updates);
            updatedCount += updates.length;
          }
        }

        if (!isCancelled && updatedCount > 0) {
          toast.success(`Auto-updated due dates for ${updatedCount} E2 issue(s).`);
        }
      } catch (error) {
        console.error("Failed to auto-backfill E2 due dates:", error);
        if (!isCancelled) {
          toast.error("Could not auto-update some E2 due dates.");
        }
      }
    };

    runE2DueDateBackfill();

    return () => {
      isCancelled = true;
    };
  }, [db, id, projects, user?.displayName, user?.email, user?.name, user?.uid]);

  useEffect(() => {
    setFocusNoteDraft("");
  }, [currentFocusIssue?.id]);

  useEffect(() => {
    const validIds = new Set(bucketFilterOptions.map((option) => option.id));
    setBucketVisibilityFilterIds((previous) => previous.filter((idValue) => validIds.has(idValue)));
  }, [bucketFilterOptions]);

  useEffect(() => {
    const validTagValues = new Set(issueTagFilterOptions.map((option) => option.lowerValue));
    setIssueTagFilterValues((previous) => previous.filter((value) => validTagValues.has(value)));
  }, [issueTagFilterOptions]);

  useEffect(() => {
    if (issues.length === 0) return;
    const latestIssueWithBucket = issues.find((issue) => String(issue?.bucketId || "").trim());
    if (!latestIssueWithBucket) return;

    const latestBucketId = String(latestIssueWithBucket.bucketId || "").trim();
    if (!latestBucketId) return;
    setLastUsedIssueBucketId((previous) => (previous || latestBucketId));
  }, [issues]);

  useEffect(() => {
    if (!shouldAutoShowIssueForm) return;
    const normalizedIssueSearch = String(issueSearchQuery || "").trim();

    setIssueDraft((previous) => ({
      ...previous,
      issueNumber: showIssueForm ? (previous.issueNumber || normalizedIssueSearch) : normalizedIssueSearch,
      bucketId: previous.bucketId || lastUsedIssueBucketId || buckets[0]?.id || "",
    }));
  }, [buckets, issueSearchQuery, lastUsedIssueBucketId, shouldAutoShowIssueForm, showIssueForm]);

  useEffect(() => {
    if (!taskAssigneeUserId && organizationUsers.length > 0) {
      setTaskAssigneeUserId(organizationUsers[0].id);
    }
  }, [organizationUsers, taskAssigneeUserId]);

  useEffect(() => {
    if (bucketTabSearchedIssuesByBucket.length === 0) {
      if (selectedBucketNavId) setSelectedBucketNavId("");
      return;
    }

    const hasSelectedBucket = bucketTabSearchedIssuesByBucket.some(
      (group) => group.id === selectedBucketNavId
    );
    if (!hasSelectedBucket) {
      setSelectedBucketNavId(bucketTabSearchedIssuesByBucket[0].id);
    }
  }, [bucketTabSearchedIssuesByBucket, selectedBucketNavId]);

  useEffect(() => {
    setBucketDraft((previous) => {
      const normalizedProjectId = normalizeValue(previous.cardReviewProjectId);
      const normalizedStep = normalizeCardReviewStep(previous.cardReviewStep);
      const cardsForStep = getCardReviewCardsForSelection(normalizedProjectId, normalizedStep);
      const hasSelectedCardInStep = cardsForStep.some(
        (cardEntry) => cardEntry.cardRef === normalizeValue(previous.cardReviewCardRef)
      );

      if (!normalizedProjectId) {
        if (!previous.cardReviewStep && !previous.cardReviewCardRef) return previous;
        return {
          ...previous,
          cardReviewStep: "",
          cardReviewCardRef: "",
        };
      }

      if (!normalizedStep) {
        if (!previous.cardReviewCardRef) return previous;
        return {
          ...previous,
          cardReviewCardRef: "",
        };
      }

      if (hasSelectedCardInStep) return previous;

      return {
        ...previous,
        cardReviewCardRef: getFirstCardForSelection(normalizedProjectId, normalizedStep),
      };
    });
  }, [bucketDraft.cardReviewProjectId, bucketDraft.cardReviewStep, cardReviewCardsByProjectAndStep]);

  useEffect(() => {
    if (!editingBucketId) return;

    setEditBucketDraft((previous) => {
      const normalizedProjectId = normalizeValue(previous.cardReviewProjectId);
      const normalizedStep = normalizeCardReviewStep(previous.cardReviewStep);
      const cardsForStep = getCardReviewCardsForSelection(normalizedProjectId, normalizedStep);
      const hasSelectedCardInStep = cardsForStep.some(
        (cardEntry) => cardEntry.cardRef === normalizeValue(previous.cardReviewCardRef)
      );

      if (!normalizedProjectId) {
        if (!previous.cardReviewStep && !previous.cardReviewCardRef) return previous;
        return {
          ...previous,
          cardReviewStep: "",
          cardReviewCardRef: "",
        };
      }

      if (!normalizedStep) {
        if (!previous.cardReviewCardRef) return previous;
        return {
          ...previous,
          cardReviewCardRef: "",
        };
      }

      if (hasSelectedCardInStep) return previous;

      return {
        ...previous,
        cardReviewCardRef: getFirstCardForSelection(normalizedProjectId, normalizedStep),
      };
    });
  }, [cardReviewCardsByProjectAndStep, editBucketDraft.cardReviewProjectId, editBucketDraft.cardReviewStep, editingBucketId]);

  const statusBadgeColor = (status) => {
    switch (String(status || "").toLowerCase()) {
      case "open": return { bg: "#DBEAFE", text: "#1E40AF" };
      case "in progress": return { bg: "#FEF3C7", text: "#92400E" };
      case "on hold": return { bg: "#F3F4F6", text: "#374151" };
      case "resolved": return { bg: "#D1FAE5", text: "#065F46" };
      case "complete": return { bg: "#DCFCE7", text: "#166534" };
      case "closed": return { bg: "#E5E7EB", text: "#4B5563" };
      default: return { bg: "#EEF2FF", text: "#4338CA" };
    }
  };

  const handleToggleIssueComplete = async (issue, checked) => {
    if (!selectedProjectId || !issue?.id) return;

    if (checked) {
      const existingNotes = getManualIssueNotes(issue.notes);
      if (existingNotes.length === 0) {
        toast.warning("Add at least one note before marking this issue complete.");
        openIssueNotesModal(issue);
        return;
      }
    }

    try {
      const issueRef = doc(
        db,
        "churches",
        id,
        "projectListIssueProjects",
        selectedProjectId,
        "issues",
        issue.id
      );

      if (checked) {
        await updateDoc(issueRef, {
          status: "Complete",
          completedByUid: String(user?.uid || ""),
          completedByEmail: String(user?.email || ""),
          completedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        toast.success(`Issue #${issue.issueNumber || issue.id} marked complete.`);
        return;
      }

      await updateDoc(issueRef, {
        status: "Open",
        completedByUid: "",
        completedByEmail: "",
        completedAt: null,
        updatedAt: serverTimestamp(),
      });
      toast.success(`Issue #${issue.issueNumber || issue.id} marked open.`);
    } catch (error) {
      console.error("Failed to toggle issue completion:", error);
      toast.error("Could not update issue status.");
    }
  };

  const handleAddIssueNote = async (issue, providedNoteText = null, providedFiles = []) => {
    if (!selectedProjectId || !issue?.id) return;

    const noteText = typeof providedNoteText === "string"
      ? providedNoteText
      : "";
    if (providedNoteText === null) return;

    const normalizedNoteText = String(noteText || "").trim();
    const selectedFiles = Array.isArray(providedFiles)
      ? providedFiles.filter(Boolean)
      : [];

    if (!normalizedNoteText && selectedFiles.length === 0) {
      toast.warning("Add a note or attach at least one file.");
      return false;
    }

    if (selectedFiles.length > MAX_ISSUE_NOTE_ATTACHMENTS) {
      toast.warning(`You can attach up to ${MAX_ISSUE_NOTE_ATTACHMENTS} files per note.`);
      return false;
    }

    const oversizedFile = selectedFiles.find(
      (file) => Number(file?.size || 0) > MAX_ISSUE_NOTE_ATTACHMENT_BYTES
    );
    if (oversizedFile) {
      toast.warning(
        `${oversizedFile.name || "A file"} exceeds the ${Math.round(MAX_ISSUE_NOTE_ATTACHMENT_BYTES / (1024 * 1024))}MB limit.`
      );
      return false;
    }

    if (selectedFiles.length > 0 && !storage) {
      toast.error("File upload is unavailable right now.");
      return false;
    }

    const issueRef = doc(
      db,
      "churches",
      id,
      "projectListIssueProjects",
      selectedProjectId,
      "issues",
      issue.id
    );

    setIsSavingIssueNote(true);

    const existingNotes = normalizeIssueNotes(issue.notes);

    try {
      const uploadedAtIso = new Date().toISOString();
      const uploadedAttachments = selectedFiles.length > 0
        ? await Promise.all(
            selectedFiles.map(async (file, index) => {
              const safeName = sanitizeIssueNoteAttachmentName(file?.name || `attachment-${index + 1}`);
              const storagePath = [
                "churches",
                id,
                "projectListIssueProjects",
                selectedProjectId,
                "issues",
                issue.id,
                "notes",
                `${Date.now()}-${index}-${safeName}`,
              ].join("/");

              const attachmentRef = storageRef(storage, storagePath);
              await uploadBytes(attachmentRef, file);
              const downloadUrl = await getDownloadURL(attachmentRef);

              return {
                name: String(file?.name || safeName),
                url: downloadUrl,
                path: storagePath,
                contentType: String(file?.type || ""),
                sizeBytes: Number(file?.size || 0),
                uploadedAtIso,
              };
            })
          )
        : [];

      const nextNote = {
        text: normalizedNoteText,
        createdAtIso: uploadedAtIso,
        createdByUid: String(user?.uid || ""),
        createdByEmail: String(user?.email || ""),
        createdByName: String(user?.displayName || user?.name || ""),
        attachments: uploadedAttachments,
      };

      await updateDoc(issueRef, {
        notes: [...existingNotes, nextNote].slice(-MAX_ISSUE_NOTES),
        lastNoteAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      toast.success(`Note added to issue #${issue.issueNumber || issue.id}.`);
      return true;
    } catch (error) {
      console.error("Failed to add issue note:", error);
      toast.error("Could not add note.");
      return false;
    } finally {
      setIsSavingIssueNote(false);
    }
  };

  const openIssueNotesModal = (issue) => {
    if (!issue?.id) return;
    setSelectedIssueNotesIssueId(issue.id);
    setIssueNoteDraft("");
    setIssueNoteFiles([]);
    if (issueNoteFileInputRef.current) {
      issueNoteFileInputRef.current.value = "";
    }
  };

  const closeIssueNotesModal = () => {
    if (isSavingIssueNote) return;
    setSelectedIssueNotesIssueId("");
    setIssueNoteDraft("");
    setIssueNoteFiles([]);
    setIssueNoteLightboxAttachment(null);
    if (issueNoteFileInputRef.current) {
      issueNoteFileInputRef.current.value = "";
    }
  };

  const openIssueNoteImageLightbox = (attachment) => {
    if (!isAttachmentImage(attachment)) return;
    setIssueNoteLightboxAttachment({
      name: String(attachment?.name || "Attachment image"),
      url: String(attachment?.url || ""),
    });
  };

  const closeIssueNoteImageLightbox = () => {
    setIssueNoteLightboxAttachment(null);
  };

  const getAutoCompleteStatusFieldsForBucketMove = (issue, bucketName) => {
    const normalizedBucketName = String(bucketName || "").trim().toLowerCase();
    const isSolvedOrClosedBucket = normalizedBucketName.includes("solved") || normalizedBucketName.includes("closed");
    const currentStatus = String(issue?.status || "").trim().toLowerCase();

    if (!isSolvedOrClosedBucket || currentStatus !== "open") {
      return {};
    }

    return {
      status: "Complete",
      completedByUid: String(user?.uid || ""),
      completedByEmail: String(user?.email || ""),
      completedAt: serverTimestamp(),
    };
  };

  const getAutoDueDateFieldsForBucketMove = (issue, bucketName) => {
    if (!isE2BucketName(bucketName)) return {};
    const autoDueDate = getE2AutoDueDateValue(issue?.issueNumber);
    if (!autoDueDate) return {};

    return {
      dueDate: autoDueDate,
      dueDateSetByUid: String(user?.uid || ""),
      dueDateSetByEmail: String(user?.email || ""),
      dueDateSetByName: String(user?.displayName || user?.name || ""),
    };
  };

  const handleInlineBucketChange = async (issue, newBucketId) => {
    const selectedBucket = buckets.find((b) => b.id === newBucketId);
    if (!selectedBucket || !issue?.id) return;
    setSavingBucketByIssueId((prev) => ({ ...prev, [issue.id]: true }));
    try {
      await updateDoc(
        doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "issues", issue.id),
        {
          bucketId: selectedBucket.id,
          bucketName: selectedBucket.name,
          ...getAutoCompleteStatusFieldsForBucketMove(issue, selectedBucket.name),
          ...getAutoDueDateFieldsForBucketMove(issue, selectedBucket.name),
          updatedAt: serverTimestamp(),
        }
      );
    } catch (err) {
      console.error("Failed to update bucket:", err);
      toast.error("Could not update bucket.");
    } finally {
      setSavingBucketByIssueId((prev) => ({ ...prev, [issue.id]: false }));
      setEditingBucketIssueId("");
    }
  };

  const openSnapshotLightbox = (url, label = "Snapshot") => {
    const normalizedUrl = String(url || "").trim();
    if (!normalizedUrl) return;
    setSnapshotLightbox({
      url: normalizedUrl,
      label: String(label || "Snapshot"),
    });
  };

  const closeSnapshotLightbox = () => {
    setSnapshotLightbox(null);
  };

  const handleIssueNoteFilesChange = (event) => {
    const incomingFiles = Array.from(event?.target?.files || []).filter(Boolean);
    if (!incomingFiles.length) {
      setIssueNoteFiles([]);
      return;
    }

    if (incomingFiles.length > MAX_ISSUE_NOTE_ATTACHMENTS) {
      toast.warning(`Only the first ${MAX_ISSUE_NOTE_ATTACHMENTS} files were kept.`);
    }

    setIssueNoteFiles(incomingFiles.slice(0, MAX_ISSUE_NOTE_ATTACHMENTS));
  };

  const handleRemoveIssueNoteFile = (indexToRemove) => {
    setIssueNoteFiles((previous) => previous.filter((_, index) => index !== indexToRemove));
  };

  const handleSaveIssueNoteFromModal = async () => {
    if (!selectedIssueForNotes || isSavingIssueNote) return;
    const didSave = await handleAddIssueNote(selectedIssueForNotes, issueNoteDraft, issueNoteFiles);
    if (didSave) {
      setIssueNoteDraft("");
      setIssueNoteFiles([]);
      if (issueNoteFileInputRef.current) {
        issueNoteFileInputRef.current.value = "";
      }
    }
  };

  const handleAssignTaskForDay = async (event) => {
    event.preventDefault();
    if (!selectedProjectId) {
      toast.warning("Select a project first.");
      return;
    }

    const userId = String(taskAssigneeUserId || "").trim();
    if (!userId || taskBucketIds.length === 0) {
      toast.warning("Select a user and at least one bucket.");
      return;
    }

    const selectedUser = organizationUsers.find((item) => item.id === userId);
    if (!selectedUser) {
      toast.warning("Selected user is no longer available.");
      return;
    }

    const selectedBucketsData = taskBucketIds
      .map((bucketId) => buckets.find((item) => item.id === bucketId))
      .filter(Boolean);
    if (selectedBucketsData.length === 0) {
      toast.warning("Selected buckets are no longer available.");
      return;
    }

    const newAssignments = selectedBucketsData
      .filter((selectedBucket) => {
        const isDuplicate = todayTaskAssignments.some(
          (assignment) =>
            String(assignment?.userId || "") === userId
            && String(assignment?.bucketId || "") === selectedBucket.id
        );
        return !isDuplicate;
      })
      .map((selectedBucket) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        dateKey: todayDateKey,
        userId,
        userName: selectedUser.name,
        userEmail: selectedUser.email,
        bucketId: selectedBucket.id,
        bucketName: selectedBucket.name || "Untitled Bucket",
        assignedByUid: String(user?.uid || ""),
        assignedByEmail: String(user?.email || ""),
        assignedAtIso: new Date().toISOString(),
      }));

    if (newAssignments.length === 0) {
      toast.warning("All selected buckets are already assigned to that user for today.");
      return;
    }

    try {
      await updateDoc(
        doc(db, "churches", id, "projectListIssueProjects", selectedProjectId),
        {
          [`dailyTasks.${todayDateKey}`]: [...todayTaskAssignments, ...newAssignments],
          updatedAt: serverTimestamp(),
        }
      );
      toast.success(`${newAssignments.length} bucket(s) assigned to ${selectedUser.name}.`);
      setTaskBucketIds([]);
    } catch (error) {
      console.error("Failed to assign task for day:", error);
      toast.error("Could not assign task.");
    }
  };

  const handleMoveIssueToBucket = async (issue) => {
    if (!selectedProjectId || !issue?.id) return;

    const normalizedBucketId = String(movingIssueBucketId || "").trim();
    const selectedBucket = buckets.find((bucket) => bucket.id === normalizedBucketId);
    const nextBucketName = selectedBucket?.name || "";

    try {
      await updateDoc(
        doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "issues", issue.id),
        {
          bucketId: normalizedBucketId,
          bucketName: nextBucketName,
          ...getAutoCompleteStatusFieldsForBucketMove(issue, nextBucketName),
          ...getAutoDueDateFieldsForBucketMove(issue, nextBucketName),
          updatedAt: serverTimestamp(),
        }
      );
      toast.success(`Issue #${issue.issueNumber || issue.id} moved.`);
      setMovingIssueId("");
      setMovingIssueBucketId("");
    } catch (error) {
      console.error("Failed to move issue to another bucket:", error);
      toast.error("Could not move issue.");
    }
  };

  const handleToggleBulkIssueSelection = (issueId, checked) => {
    const normalizedIssueId = String(issueId || "").trim();
    if (!normalizedIssueId) return;

    setSelectedBucketIssueIds((previous) => {
      if (checked) {
        if (previous.includes(normalizedIssueId)) return previous;
        return [...previous, normalizedIssueId];
      }
      return previous.filter((entryId) => entryId !== normalizedIssueId);
    });
  };

  const handleSelectAllVisibleBucketIssues = () => {
    if (visibleBucketIssueIds.length === 0) return;
    setSelectedBucketIssueIds(Array.from(new Set(visibleBucketIssueIds)));
  };

  const handleClearBulkIssueSelection = () => {
    setSelectedBucketIssueIds([]);
  };

  const handleBulkMoveIssuesToBucket = async () => {
    if (!selectedProjectId || selectedBucketIssueIds.length === 0) return;

    const normalizedBucketId = String(bulkMoveBucketId || "").trim();
    const selectedBucket = buckets.find((bucket) => bucket.id === normalizedBucketId);
    const nextBucketName = selectedBucket?.name || "";
    const issuesById = new Map(issues.map((issue) => [issue.id, issue]));

    setIsBulkUpdatingIssues(true);
    try {
      await Promise.all(
        selectedBucketIssueIds.map((issueId) => {
          const sourceIssue = issuesById.get(issueId);
          return updateDoc(
            doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "issues", issueId),
            {
              bucketId: normalizedBucketId,
              bucketName: nextBucketName,
              ...getAutoCompleteStatusFieldsForBucketMove(sourceIssue, nextBucketName),
              ...getAutoDueDateFieldsForBucketMove(sourceIssue, nextBucketName),
              updatedAt: serverTimestamp(),
            }
          );
        })
      );

      toast.success(`${selectedBucketIssueIds.length} issue(s) moved.`);
      setSelectedBucketIssueIds([]);
      setBulkMoveBucketId("");
    } catch (error) {
      console.error("Failed to bulk move issues:", error);
      toast.error("Could not move selected issues.");
    } finally {
      setIsBulkUpdatingIssues(false);
    }
  };

  const handleBulkDeleteIssues = async () => {
    if (!selectedProjectId || selectedBucketIssueIds.length === 0) return;
    if (!window.confirm(`Delete ${selectedBucketIssueIds.length} selected issue(s)?`)) return;

    setIsBulkUpdatingIssues(true);
    try {
      await Promise.all(
        selectedBucketIssueIds.map((issueId) =>
          deleteDoc(
            doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "issues", issueId)
          )
        )
      );
      toast.success(`${selectedBucketIssueIds.length} issue(s) deleted.`);
      setSelectedBucketIssueIds([]);
    } catch (error) {
      console.error("Failed to bulk delete issues:", error);
      toast.error("Could not delete selected issues.");
    } finally {
      setIsBulkUpdatingIssues(false);
    }
  };

  const handleScrollToBucketGroup = (bucketGroupId) => {
    if (!bucketGroupId || typeof window === "undefined") return;
    const targetElement = document.getElementById(`bucket-group-${bucketGroupId}`);
    if (!targetElement) return;
    targetElement.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleSelectBucketNav = (bucketGroupId) => {
    const normalizedId = String(bucketGroupId || "").trim();
    if (!normalizedId) return;
    setSelectedBucketNavId(normalizedId);

    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        handleScrollToBucketGroup(normalizedId);
      });
    });
  };

  const handleOpenBulkMoveForBucket = (bucketGroupId) => {
    const normalizedId = String(bucketGroupId || "").trim();
    if (!normalizedId) return;

    const sourceGroup = leftBucketNavGroups.find((group) => String(group?.id || "").trim() === normalizedId);
    const sourceIssueIds = (sourceGroup?.issues || []).map((issue) => issue.id).filter(Boolean);

    setBulkMoveSourceBucketId(normalizedId);
    setBulkMoveSourceBucketName(String(sourceGroup?.name || "").trim());
    setBulkMoveSourceIssueIds(sourceIssueIds);
    setBulkMoveDestinationBucketId("");
  };

  const handleCloseBulkMoveForBucket = () => {
    if (isBulkMovingBucketIssues) return;
    setBulkMoveSourceBucketId("");
    setBulkMoveSourceBucketName("");
    setBulkMoveSourceIssueIds([]);
    setBulkMoveDestinationBucketId("");
  };

  const handleBulkMoveAllIssuesFromBucket = async () => {
    const sourceBucketId = String(bulkMoveSourceBucketId || "").trim();
    const destinationBucketId = String(bulkMoveDestinationBucketId || "").trim();
    if (!selectedProjectId || !sourceBucketId || !destinationBucketId) return;

    if (sourceBucketId === destinationBucketId) {
      toast.warning("Select a different destination bucket.");
      return;
    }

    const destinationBucket = buckets.find((bucket) => bucket.id === destinationBucketId);
    if (!destinationBucket) {
      toast.warning("Destination bucket not found.");
      return;
    }

    const sourceIssueIdSet = new Set(bulkMoveSourceIssueIds);
    const issuesToMove = issues.filter((issue) => sourceIssueIdSet.has(issue.id));
    if (issuesToMove.length === 0) {
      toast.info("No issues to move in that bucket.");
      return;
    }

    setIsBulkMovingBucketIssues(true);
    try {
      await Promise.all(
        issuesToMove.map((issue) =>
          updateDoc(
            doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "issues", issue.id),
            {
              bucketId: destinationBucketId,
              bucketName: destinationBucket.name || "",
              ...getAutoCompleteStatusFieldsForBucketMove(issue, destinationBucket.name || ""),
              ...getAutoDueDateFieldsForBucketMove(issue, destinationBucket.name || ""),
              updatedAt: serverTimestamp(),
            }
          )
        )
      );

      toast.success(`${issuesToMove.length} issue(s) moved to ${destinationBucket.name || "destination bucket"}.`);
      handleCloseBulkMoveForBucket();
    } catch (error) {
      console.error("Failed to bulk move issues from left bucket list:", error);
      toast.error("Could not move all issues from this bucket.");
    } finally {
      setIsBulkMovingBucketIssues(false);
    }
  };

  const handleFocusMove = (step) => {
    if (focusIssues.length === 0) return;

    setFocusIssueIndex((previous) => {
      const next = previous + step;
      if (next < 0) return focusIssues.length - 1;
      if (next >= focusIssues.length) return 0;
      return next;
    });
  };

  const handleFocusTouchStart = (event) => {
    const touchX = event?.touches?.[0]?.clientX;
    if (!Number.isFinite(touchX)) return;
    focusTouchStartXRef.current = touchX;
  };

  const handleFocusTouchEnd = (event) => {
    const startX = focusTouchStartXRef.current;
    const endX = event?.changedTouches?.[0]?.clientX;
    focusTouchStartXRef.current = null;
    if (!Number.isFinite(startX) || !Number.isFinite(endX)) return;

    const delta = endX - startX;
    if (Math.abs(delta) < 48) return;
    if (delta < 0) handleFocusMove(1);
    if (delta > 0) handleFocusMove(-1);
  };

  const handleAddFocusIssueNote = async () => {
    if (!currentFocusIssue) return;
    const normalizedIssueId = String(currentFocusIssue?.id || "").trim();
    const normalizedNoteText = String(focusNoteDraft || "").trim();
    const didSave = await handleAddIssueNote(currentFocusIssue, focusNoteDraft, []);
    if (didSave) {
      if (normalizedIssueId) {
        setFocusSavedNoteCountByIssueId((previous) => ({
          ...previous,
          [normalizedIssueId]: Math.max(1, Number(previous[normalizedIssueId] || 0) + 1),
        }));
        if (normalizedNoteText) {
          setFocusRecentAddedNoteTextByIssueId((previous) => ({
            ...previous,
            [normalizedIssueId]: normalizedNoteText,
          }));
        }
      }
      setFocusNoteDraft("");
    }
  };

  const handleEmailIssue = (issue, fallbackBucketName = "") => {
    if (!issue) return;

    const issueNumber = String(issue.issueNumber || issue.id || "-").trim();
    const issueTitle = String(issue.title || "").trim();
    const projectName = String(selectedProject?.name || "").trim();
    const issueStatus = String(issue.status || "").trim();
    const bucketName = String(
      fallbackBucketName
      || buckets.find((bucket) => bucket.id === issue.bucketId)?.name
      || issue.bucketName
      || ""
    ).trim();
    const issueDescription = String(issue.description || "").trim();
    const dueDateValue = getIssueDueDateValue(issue);
    const dueDateCountdown = getDueDateCountdownMeta(dueDateValue);
    const dueDateSetterLabel = getDueDateSetterLabel(issue);
    const tags = normalizeIssueTags(issue.tags);
    const notes = normalizeIssueNotes(issue.notes);
    const senderFirstName = String(user?.firstName || user?.name || "").trim();
    const senderLastName = String(user?.lastName || "").trim();
    const senderFullName = [senderFirstName, senderLastName].filter(Boolean).join(" ").trim();
    const senderName = String(user?.displayName || senderFullName || user?.name || "").trim();
    const senderEmail = String(user?.email || "").trim();
    const companyName = "E2 Tech Support";

    const completedAtLabel = formatIssueNoteTimestamp(issue?.completedAt?.toDate?.() || issue?.completedAt || "");
    const subject = issueTitle
      ? projectName
        ? `${issueTitle} - ${projectName}`
        : issueTitle
      : projectName
        ? `Issue #${issueNumber} - ${projectName}`
        : `Issue #${issueNumber}`;
    const topicTags = tags.join(", ");
    const lines = [
      "Team,",
      "",
      tags.length
        ? `The following issue needs further revision for ${topicTags}, please let me know what you think and how we can get a response on this soon.`
        : "The following issue needs further revision, please let me know what you think and how we can get a response on this soon.",
      "",
    ];

    const maybeAddLine = (label, value) => {
      const normalized = String(value || "").trim();
      if (!normalized) return;
      if (normalized === "-") return;
      if (normalized.toLowerCase() === "not set") return;
      if (normalized.toLowerCase() === "unknown time") return;
      if (normalized.toLowerCase() === "untitled issue") return;
      if (!normalized) return;
      lines.push(`${label}: ${normalized}`);
    };

    maybeAddLine("Project", String(selectedProject?.name || "").trim());
    maybeAddLine("Issue Number", `#${issueNumber}`);
    maybeAddLine("Title", issueTitle);
    maybeAddLine("Status", issueStatus);
    maybeAddLine("Bucket", bucketName);
    maybeAddLine("Description", issueDescription);
    maybeAddLine("Due Date", dueDateValue);
    maybeAddLine("Due Countdown", dueDateCountdown?.label || "");
    maybeAddLine("Tags", tags.join(", "));
    if (completedAtLabel && completedAtLabel !== "Unknown time") {
      maybeAddLine("Completed At", completedAtLabel);
    }

    if (notes.length) {
      if (lines.length) lines.push("");
      lines.push("Notes:");
      notes.forEach((note, index) => {
        const noteText = String(note.text || "").trim() || "[Attachment only]";
        lines.push(`${index + 1}. [${formatIssueNoteTimestamp(note.createdAtIso)}] ${getIssueNoteAuthorLabel(note)}: ${noteText}`);
        const attachments = normalizeIssueNoteAttachments(note.attachments);
        attachments.forEach((attachment) => {
          const attachmentLabel = String(attachment.name || attachment.url || "Attachment").trim();
          const attachmentUrl = String(attachment.url || "").trim();
          if (!attachmentUrl) return;
          lines.push(`   - File: ${attachmentLabel} (${attachmentUrl})`);
        });
      });
    }

    const signatureLines = [senderName, senderEmail].filter(Boolean);
    if (signatureLines.length) {
      lines.push("", "Sincerely,");
      signatureLines.forEach((line) => lines.push(line));
    }

    if (companyName) {
      lines.push("", companyName);
    }

    const mailtoHref = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\n"))}`;

    try {
      if (typeof window !== "undefined") {
        window.location.href = mailtoHref;
      }
    } catch (error) {
      console.error("Failed to open email client:", error);
      toast.error("Could not open email client.");
    }
  };

  // ── Import helpers ────────────────────────────────────────────────────────────
  const parseFileToRows = (file) =>
    new Promise((resolve, reject) => {
      const ext = file.name.split(".").pop().toLowerCase();
      if (ext === "csv") {
        Papa.parse(file, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => resolve(results.data),
          error: reject,
        });
      } else {
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const workbook = XLSX.read(event.target.result, { type: "array" });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rangeRef = sheet["!ref"];
            if (!rangeRef) {
              resolve([]);
              return;
            }

            const range = XLSX.utils.decode_range(rangeRef);
            const headers = [];
            for (let col = range.s.c; col <= range.e.c; col += 1) {
              const headerCellAddress = XLSX.utils.encode_cell({ r: range.s.r, c: col });
              const headerCell = sheet[headerCellAddress];
              headers.push(String(headerCell?.w ?? headerCell?.v ?? "").trim());
            }

            const rows = [];
            for (let rowIndex = range.s.r + 1; rowIndex <= range.e.r; rowIndex += 1) {
              const row = {};
              let hasValue = false;

              for (let col = range.s.c; col <= range.e.c; col += 1) {
                const header = headers[col - range.s.c] || `Column ${col - range.s.c + 1}`;
                const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: col });
                const cell = sheet[cellAddress];

                let cellValue = String(cell?.w ?? cell?.v ?? "").trim();
                const hyperlinkTarget = String(cell?.l?.Target || "").trim();
                if (hyperlinkTarget) {
                  cellValue = hyperlinkTarget;
                }

                if (cellValue) hasValue = true;
                row[header] = cellValue;
              }

              if (hasValue) {
                rows.push(row);
              }
            }

            resolve(rows);
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
      }
    });

  const normalizeHeader = (key) =>
    String(key || "").trim().toLowerCase().replace(/[\s_-]+/g, "");

  const getColValue = (row, ...candidates) => {
    for (const candidate of candidates) {
      for (const key of Object.keys(row)) {
        if (normalizeHeader(key) === normalizeHeader(candidate)) {
          return String(row[key] || "").trim();
        }
      }
    }
    return "";
  };

  const handleImportIssuesFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const rawRows = await parseFileToRows(file);
      const parsed = rawRows
        .map((row) => ({
          issueNumber: getColValue(row, "ID", "issueNumber", "issue number", "issue_number", "issue#", "number", "#"),
          title: getColValue(row, "title"),
          statusRaw: getColValue(row, "status", "state", "issue status"),
          snapshot: getColValue(row, "snapshot", "snapshotUrl", "snapshot url", "image", "imageUrl", "image url", "imageLink", "image link"),
        }))
        .filter((row) => row.issueNumber);
      setImportIssuesRows(parsed);
    } catch (err) {
      console.error("Failed to parse issues file:", err);
      toast.error("Could not read file. Make sure it is a valid CSV or Excel file.");
    }
    event.target.value = "";
  };

  const handleImportIssuesSubmit = async () => {
    if (!selectedProjectId) { toast.warning("Select a project first."); return; }
    if (importIssuesRows.length === 0) { toast.warning("No rows to import."); return; }
    if (!importIssuesAllStatusesMapped) {
      toast.warning("Map every spreadsheet status to Open or Closed before importing.");
      return;
    }
    setImportIssuesLoading(true);
    const existingByNumber = new Map(
      issues.map((issue) => [String(issue.issueNumber || "").trim().toLowerCase(), issue])
    );
    let created = 0;
    let reactivated = 0;
    let skipped = 0;
    for (const row of importIssuesRows) {
      const issueNumber = String(row.issueNumber || "").trim();
      const normalizedIssueNumber = issueNumber.toLowerCase();
      if (!issueNumber) { skipped++; continue; }

      const existingIssue = existingByNumber.get(normalizedIssueNumber);
      const existingBucketId = String(existingIssue?.bucketId || "").trim();
      const existingBucketName = String(existingIssue?.bucketName || "").trim();
      const mappedStatus = normalizeImportStatusValue(resolvedImportStatusMapping[normalizeImportStatusKey(row.statusRaw)]) || "Open";

      let bucketId = importIssuesDefaultBucketId;
      let bucketName = buckets.find((b) => b.id === bucketId)?.name || "";
      if (row.bucketName) {
        const matched = buckets.find(
          (b) => String(b.name || "").trim().toLowerCase() === row.bucketName.toLowerCase()
        );
        if (matched) { bucketId = matched.id; bucketName = matched.name; }
      }

      try {
        const importedSnapshotUrl = normalizeSnapshotUrl(row.snapshot);
        let resolvedIssueId = existingIssue?.id || "";

        if (existingIssue?.id) {
          const updateData = {
            issueNumber,
            title: row.title || "",
            status: mappedStatus,
            urgencyLevel: normalizeIssueUrgency(existingIssue.urgencyLevel),
            workMarker: normalizeIssueWorkMarker(existingIssue.workMarker),
            updatedAt: serverTimestamp(),
          };

          if (isIssueDoneStatus(mappedStatus)) {
            updateData.completedByUid = String(user?.uid || "");
            updateData.completedByEmail = String(user?.email || "");
            updateData.completedAt = serverTimestamp();
          } else {
            updateData.completedByUid = "";
            updateData.completedByEmail = "";
            updateData.completedAt = null;
          }

          // Keep the existing bucket for duplicates when one is already set.
          if (existingBucketId) {
            updateData.bucketId = existingBucketId;
            updateData.bucketName = existingBucketName || buckets.find((b) => b.id === existingBucketId)?.name || "";
          } else if (bucketId) {
            // If duplicate has no bucket yet, allow default bucket assignment.
            updateData.bucketId = bucketId;
            updateData.bucketName = bucketName;
          }

          if (importedSnapshotUrl) {
            updateData.snapshotImageUrl = importedSnapshotUrl;
            updateData.snapshot = importedSnapshotUrl;
          }
          await updateDoc(
            doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "issues", existingIssue.id),
            updateData
          );
          reactivated++;
        } else {
          if (!bucketId) { skipped++; continue; }

          const newIssueData = {
            issueNumber,
            title: row.title || "",
            status: mappedStatus,
            urgencyLevel: "Medium",
            workMarker: "",
            workMarkerAtIso: "",
            workMarkerByUid: "",
            workMarkerByEmail: "",
            workMarkerByName: "",
            bucketId,
            bucketName,
            createdBy: user?.uid || "",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };

          if (isIssueDoneStatus(mappedStatus)) {
            newIssueData.completedByUid = String(user?.uid || "");
            newIssueData.completedByEmail = String(user?.email || "");
            newIssueData.completedAt = serverTimestamp();
          }
          if (importedSnapshotUrl) {
            newIssueData.snapshotImageUrl = importedSnapshotUrl;
            newIssueData.snapshot = importedSnapshotUrl;
          }
          const createdIssueDoc = await addDoc(issuesRef, newIssueData);
          resolvedIssueId = createdIssueDoc.id;
          created++;
        }

        existingByNumber.set(normalizedIssueNumber, {
          ...(existingIssue || {}),
          issueNumber,
          id: resolvedIssueId,
        });
      } catch (err) {
        console.error("Failed to import issue:", err);
        skipped++;
      }
    }
    // Auto-complete issues not present in the latest upload
    const importedIssueNumbers = new Set(
      importIssuesRows.map((row) => String(row.issueNumber || "").trim().toLowerCase()).filter(Boolean)
    );
    let autoCompletedCount = 0;
    for (const [normalizedNumber, existingIssue] of existingByNumber) {
      if (importedIssueNumbers.has(normalizedNumber)) continue;
      if (!existingIssue?.id) continue;
      if (isIssueDoneStatus(existingIssue.status)) continue;
      const nowIso = new Date().toISOString();
      const systemNote = {
        text: `[System] Status changed from '${existingIssue.status || "Open"}' to 'Complete' — not present in latest upload.`,
        createdAtIso: nowIso,
        createdByUid: "",
        createdByEmail: "system",
        createdByName: "System",
        attachments: [],
      };
      try {
        await updateDoc(
          doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "issues", existingIssue.id),
          {
            status: "Complete",
            completedByUid: "",
            completedByEmail: "system",
            completedAt: serverTimestamp(),
            notes: arrayUnion(systemNote),
            updatedAt: serverTimestamp(),
          }
        );
        autoCompletedCount++;
      } catch (err) {
        console.error("Failed to auto-complete issue:", existingIssue.id, err);
      }
    }

    setImportIssuesLoading(false);
    toast.success(
      `Imported ${created} new issue(s). Reactivated ${reactivated} existing issue(s). Auto-completed ${autoCompletedCount} missing issue(s).${skipped > 0 ? ` ${skipped} skipped (missing bucket or invalid issue number).` : ""}`
    );
    setImportIssuesRows([]);
    setShowImportIssuesPanel(false);
  };

  const handleImportBucketsFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const rawRows = await parseFileToRows(file);
      const parsed = rawRows
        .map((row) => ({
          name: getColValue(row, "name", "bucket name", "bucketName", "bucket_name"),
          description: getColValue(row, "description", "desc"),
        }))
        .filter((row) => row.name);
      setImportBucketsRows(parsed);
    } catch (err) {
      console.error("Failed to parse buckets file:", err);
      toast.error("Could not read file. Make sure it is a valid CSV or Excel file.");
    }
    event.target.value = "";
  };

  const handleImportBucketsSubmit = async () => {
    if (!selectedProjectId) { toast.warning("Select a project first."); return; }
    if (!bucketsRef) { toast.warning("Select a project first."); return; }
    if (importBucketsRows.length === 0) { toast.warning("No rows to import."); return; }
    setImportBucketsLoading(true);
    const existingNames = new Set(buckets.map((b) => String(b.name || "").trim().toLowerCase()));
    let created = 0;
    let skipped = 0;
    for (const row of importBucketsRows) {
      const name = String(row.name || "").trim();
      if (!name || existingNames.has(name.toLowerCase())) { skipped++; continue; }
      try {
        await addDoc(bucketsRef, {
          name,
          description: row.description || "",
          sortOrder: buckets.length + created,
          cardReviewProjectId: "",
          cardReviewStep: "",
          cardReviewCardRef: "",
          createdBy: user?.uid || "",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        existingNames.add(name.toLowerCase());
        created++;
      } catch (err) {
        console.error("Failed to import bucket:", err);
        skipped++;
      }
    }
    setImportBucketsLoading(false);
    toast.success(`Imported ${created} bucket(s).${skipped > 0 ? ` ${skipped} skipped (duplicate or empty).` : ""}`);
    setImportBucketsRows([]);
    setShowImportBucketsPanel(false);
  };

  // â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <>
    <div
      style={{
        ...commonStyles.fullWidthContainer,
        position: "relative",
        paddingLeft: 0,
        paddingRight: 0,
        width: "100vw",
        maxWidth: "100vw",
        marginLeft: "calc(50% - 50vw)",
        marginRight: "calc(50% - 50vw)",
      }}
    >
      {user && (
        <Link
          to={`${routePrefix}/${id}/mi-organizacion`}
          style={{ ...commonStyles.backButtonLink, marginBottom: "16px" }}
        >
          â† Back to My Organization
        </Link>
      )}

      <ChurchHeader id={id} applyShadow={false} />

      <div style={containerStyle}>
        <h1 style={commonStyles.title}>Project Lists and Issues</h1>
        <p style={{ color: "#6B7280", marginTop: "-8px" }}>
          Manage your own projects, issues, and bucket cards independently.
        </p>

        {/* Project selector + Bucket filter */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "10px", marginBottom: "1rem" }}>
          <div>
            <label style={{ display: "block", fontWeight: 600, fontSize: "0.88rem", marginBottom: "4px", color: "#374151" }}>
              Project
            </label>
            <select style={inputStyle} value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
              <option value="">â€” Select a project â€”</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name || "Untitled Project"}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontWeight: 600, fontSize: "0.88rem", marginBottom: "4px", color: "#374151" }}>
              Filter by Bucket Card
            </label>
            <select style={inputStyle} value={selectedBucketCardId} onChange={(e) => setSelectedBucketCardId(e.target.value)} disabled={!selectedProjectId}>
              <option value="all">All Bucket Cards</option>
              {buckets.map((b) => (
                <option key={b.id} value={b.id}>{b.name || "Untitled Bucket"}</option>
              ))}
              <option value="__unassigned__">No Bucket</option>
            </select>
          </div>
        </div>

        {bulkMoveSourceBucketId ? (
          <div
            role="dialog"
            aria-modal="true"
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(15, 23, 42, 0.55)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 2200,
              padding: "16px",
            }}
          >
            <div
              style={{
                width: "min(560px, 100%)",
                backgroundColor: "#FFFFFF",
                borderRadius: "12px",
                border: "1px solid #E5E7EB",
                boxShadow: "0 24px 40px rgba(2, 6, 23, 0.22)",
                padding: "16px",
              }}
            >
              {(() => {
                const sourceBucket = buckets.find((bucket) => bucket.id === bulkMoveSourceBucketId);
                const sourceBucketName = bulkMoveSourceBucketName || sourceBucket?.name || "Selected bucket";
                const sourceIssueCount = bulkMoveSourceIssueIds.length;
                const destinationOptions = buckets.filter((bucket) => bucket.id !== bulkMoveSourceBucketId);

                return (
                  <>
                    <h3 style={{ margin: "0 0 8px", color: "#111827" }}>Move All Issues From Bucket</h3>
                    <p style={{ margin: "0 0 12px", color: "#374151", fontSize: "0.9rem" }}>
                      Source: <strong>{sourceBucketName}</strong> ({sourceIssueCount} issue{sourceIssueCount === 1 ? "" : "s"})
                    </p>

                    <label style={{ display: "block", marginBottom: "8px", fontSize: "0.85rem", color: "#374151", fontWeight: 700 }}>
                      Destination Bucket
                    </label>
                    <select
                      value={bulkMoveDestinationBucketId}
                      onChange={(event) => setBulkMoveDestinationBucketId(event.target.value)}
                      disabled={isBulkMovingBucketIssues}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: "8px",
                        border: "1px solid #CBD5E1",
                        marginBottom: "12px",
                        backgroundColor: "#FFFFFF",
                      }}
                    >
                      <option value="">Select destination bucket...</option>
                      {destinationOptions.map((bucket) => (
                        <option key={bucket.id} value={bucket.id}>
                          {bucket.name || "Unnamed Bucket"}
                        </option>
                      ))}
                    </select>

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                      <button
                        type="button"
                        onClick={handleCloseBulkMoveForBucket}
                        disabled={isBulkMovingBucketIssues}
                        style={{
                          ...buttonBaseStyle,
                          backgroundColor: "#64748B",
                          cursor: isBulkMovingBucketIssues ? "not-allowed" : "pointer",
                          opacity: isBulkMovingBucketIssues ? 0.75 : 1,
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleBulkMoveAllIssuesFromBucket}
                        disabled={isBulkMovingBucketIssues || !bulkMoveDestinationBucketId}
                        style={{
                          ...buttonBaseStyle,
                          backgroundColor: "#1D4ED8",
                          cursor: isBulkMovingBucketIssues || !bulkMoveDestinationBucketId ? "not-allowed" : "pointer",
                          opacity: isBulkMovingBucketIssues || !bulkMoveDestinationBucketId ? 0.75 : 1,
                        }}
                      >
                        {isBulkMovingBucketIssues ? "Moving..." : "Move All Issues"}
                      </button>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        ) : null}

        {/* Tabs */}
        <div style={{ display: "flex", gap: "4px", borderBottom: "2px solid #E5E7EB", marginBottom: "1rem", flexWrap: "wrap" }}>
          {[ ["projects", "Projects"], ["issues", "Issues"], ["buckets", "Bucket Cards"], ["focus", "Focus View"], ["progress", "Progress"], ["tasksForDay", "Tasks For The Day"], ["dayCounts", "Total Day Count"]].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              style={{
                border: "none",
                borderBottom: activeTab === key ? "3px solid #2563EB" : "3px solid transparent",
                background: "transparent",
                padding: "8px 18px",
                fontWeight: activeTab === key ? 700 : 500,
                color: activeTab === key ? "#2563EB" : "#374151",
                cursor: "pointer",
                fontSize: "0.95rem",
                marginBottom: "-2px",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <section style={panelStyle}>

          {/* â”€â”€ PROJECTS TAB â”€â”€ */}
          {activeTab === "projects" && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <h2 style={{ margin: 0 }}>Projects</h2>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    style={{ ...buttonBaseStyle, backgroundColor: isManagingProjects ? "#6B7280" : "#0F766E" }}
                    onClick={() => {
                      setIsManagingProjects((prev) => {
                        const next = !prev;
                        if (!next) {
                          setSelectedManageProjectId("");
                          setEditingProjectId("");
                        }
                        return next;
                      });
                    }}
                  >
                    {isManagingProjects ? "Done Managing" : "Manage Projects"}
                  </button>
                  <button
                    type="button"
                    style={{ ...buttonBaseStyle, backgroundColor: "#2563EB" }}
                    onClick={() => { setShowProjectForm((prev) => !prev); setProjectDraft({ name: "", description: "" }); }}
                  >
                    {showProjectForm ? "Cancel" : "+ New Project"}
                  </button>
                </div>
              </div>

              {isManagingProjects && !editingProjectId && (
                <div style={{ marginBottom: "10px", padding: "8px 10px", borderRadius: "8px", backgroundColor: "#ECFDF5", border: "1px solid #A7F3D0", color: "#065F46", fontWeight: 600, fontSize: "0.9rem" }}>
                  Select a project to enable Edit or Delete.
                </div>
              )}

              {showProjectForm && (
                <form
                  onSubmit={handleCreateProject}
                  style={{ border: "1px solid #BFDBFE", borderRadius: "8px", padding: "14px", marginBottom: "14px", backgroundColor: "#EFF6FF" }}
                >
                  <h3 style={{ marginTop: 0, marginBottom: "12px", color: "#1E40AF" }}>New Project</h3>
                  <div style={{ display: "grid", gap: "10px" }}>
                    <div>
                      <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", marginBottom: "4px" }}>Name (optional)</label>
                      <input style={inputStyle} placeholder="Project name (optional)" value={projectDraft.name} onChange={(e) => setProjectDraft((prev) => ({ ...prev, name: e.target.value }))} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", marginBottom: "4px" }}>Description</label>
                      <textarea style={textareaStyle} placeholder="Optional description" value={projectDraft.description} onChange={(e) => setProjectDraft((prev) => ({ ...prev, description: e.target.value }))} />
                    </div>
                    <button type="submit" style={{ ...buttonBaseStyle, backgroundColor: "#2563EB" }}>Save Project</button>
                  </div>
                </form>
              )}

              {loadingProjects ? <p>Loading projects...</p> : null}

              {projects.length === 0 && !loadingProjects ? (
                <p style={{ color: "#6B7280" }}>No projects yet. Click "+ New Project" to get started.</p>
              ) : (
                <div style={{ display: "grid", gap: "8px" }}>
                  {projects.map((project) => (
                    <div
                      key={project.id}
                      style={{
                        border: selectedProjectId === project.id ? "2px solid #2563EB" : "1px solid #E5E7EB",
                        borderRadius: "8px",
                        padding: "12px",
                        backgroundColor: selectedProjectId === project.id ? "#EFF6FF" : "#FFFFFF",
                      }}
                    >
                      {editingProjectId === project.id ? (
                        <div style={{ display: "grid", gap: "8px" }}>
                          <input style={inputStyle} placeholder="Project name" value={editProjectDraft.name} onChange={(e) => setEditProjectDraft((prev) => ({ ...prev, name: e.target.value }))} />
                          <textarea style={textareaStyle} placeholder="Description" value={editProjectDraft.description} onChange={(e) => setEditProjectDraft((prev) => ({ ...prev, description: e.target.value }))} />
                          <div style={{ display: "flex", gap: "6px" }}>
                            <button type="button" style={{ ...buttonBaseStyle, backgroundColor: "#2563EB" }} onClick={() => handleUpdateProject(project.id)}>Save</button>
                            <button type="button" style={{ ...buttonBaseStyle, backgroundColor: "#6B7280" }} onClick={() => setEditingProjectId("")}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedProjectId(project.id);
                              if (isManagingProjects && !editingProjectId) {
                                setSelectedManageProjectId(project.id);
                              }
                            }}
                            style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, textAlign: "left", flex: 1 }}
                          >
                            <strong style={{ fontSize: "0.97rem" }}>{project.name || "Untitled Project"}</strong>
                            {project.description ? (
                              <p style={{ margin: "2px 0 0", color: "#6B7280", fontSize: "0.85rem" }}>{project.description}</p>
                            ) : null}
                          </button>
                          {isManagingProjects && !editingProjectId && selectedManageProjectId === project.id && (
                            <span style={{ alignSelf: "center", fontSize: "0.76rem", backgroundColor: "#DBEAFE", color: "#1D4ED8", borderRadius: "999px", padding: "3px 8px", fontWeight: 700 }}>
                              Selected
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {isManagingProjects && !editingProjectId && projects.length > 0 && (
                <div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    style={{ ...buttonBaseStyle, backgroundColor: selectedManageProjectId ? "#0F766E" : "#94A3B8" }}
                    disabled={!selectedManageProjectId}
                    onClick={() => {
                      const projectToEdit = projects.find((project) => project.id === selectedManageProjectId);
                      if (!projectToEdit) return;
                      setEditingProjectId(projectToEdit.id);
                      setEditProjectDraft({
                        name: projectToEdit.name || "",
                        description: projectToEdit.description || "",
                      });
                    }}
                  >
                    Edit Selected
                  </button>
                  <button
                    type="button"
                    style={{ ...buttonBaseStyle, backgroundColor: selectedManageProjectId ? "#DC2626" : "#94A3B8" }}
                    disabled={!selectedManageProjectId}
                    onClick={() => {
                      if (!selectedManageProjectId) return;
                      handleDeleteProject(selectedManageProjectId);
                      setSelectedManageProjectId("");
                    }}
                  >
                    Delete Selected
                  </button>
                </div>
              )}
            </>
          )}

          {/* â”€â”€ ISSUES TAB â”€â”€ */}
          {activeTab === "issues" && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <h2 style={{ margin: 0 }}>Issues</h2>
                {selectedProjectId && (
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      type="button"
                      style={{ ...buttonBaseStyle, backgroundColor: showImportIssuesPanel ? "#6B7280" : "#0369A1" }}
                      onClick={() => {
                        setShowImportIssuesPanel((prev) => !prev);
                        setImportIssuesRows([]);
                      }}
                    >
                      {showImportIssuesPanel ? "Cancel Import" : "Import CSV/Excel"}
                    </button>
                    <input
                      ref={importIssuesFileRef}
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      style={{ display: "none" }}
                      onChange={handleImportIssuesFile}
                    />
                    <button
                      type="button"
                      style={{ ...buttonBaseStyle, backgroundColor: "#059669" }}
                      onClick={() => {
                        setShowIssueForm((prev) => !prev);
                        setIssueDraft((previous) => ({
                          issueNumber: previous.issueNumber || String(issueSearchQuery || "").trim(),
                          status: "Open",
                          bucketId: previous.bucketId || lastUsedIssueBucketId || buckets[0]?.id || "",
                          secondaryBucketIds: normalizeBucketIdArray(previous.secondaryBucketIds),
                          dueDate: previous.dueDate || "",
                        }));
                      }}
                    >
                      {showIssueForm ? "Cancel" : "+ New Issue"}
                    </button>
                    <button
                      type="button"
                      style={{ ...buttonBaseStyle, backgroundColor: issues.length > 0 ? "#DC2626" : "#94A3B8" }}
                      disabled={issues.length === 0}
                      onClick={handleDeleteAllProjectIssues}
                    >
                      Delete All Issues
                    </button>
                  </div>
                )}
              </div>

              {/* Import Issues panel */}
              {showImportIssuesPanel && selectedProjectId && (
                <div style={{ border: "1px solid #BAE6FD", borderRadius: "8px", padding: "14px", marginBottom: "14px", backgroundColor: "#F0F9FF" }}>
                  <h3 style={{ marginTop: 0, marginBottom: "12px", color: "#0369A1" }}>Import Issues from CSV / Excel</h3>
                  <div style={{ margin: "0 0 12px", fontSize: "0.85rem", color: "#475569" }}>
                    <div style={{ marginBottom: "8px", fontWeight: 600 }}>📋 Column Requirements:</div>
                    <div style={{ marginLeft: "16px", lineHeight: "1.6" }}>
                      <div><strong style={{ color: "#DC2626" }}>ID</strong> (Required) - Unique identifier for each issue. Accepts: ID, issueNumber, issue number, issue_number, issue#, number, or #</div>
                      <div><strong>Title</strong> (Optional) - Issue name/summary. Accepts: title</div>
                      <div><strong>Status</strong> (Optional but configurable) - Each unique spreadsheet status must be mapped to Open or Closed before importing. The mapping is saved for future imports in this project.</div>
                      <div><strong>Snapshot</strong> (Optional) - Issue main image/screenshot URL. Used as the primary image for the issue. Accepts: snapshot, snapshotUrl, snapshot url, image, imageUrl, image url, imageLink, or image link</div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gap: "10px" }}>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        style={{ ...buttonBaseStyle, backgroundColor: "#0369A1" }}
                        onClick={() => importIssuesFileRef.current?.click()}
                      >
                        Choose File
                      </button>
                      {importIssuesRows.length > 0 && (
                        <span style={{ fontSize: "0.85rem", color: "#0369A1", fontWeight: 600 }}>
                          {importIssuesRows.length} row(s) ready to import
                        </span>
                      )}
                    </div>
                    <div>
                      <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", marginBottom: "4px" }}>
                        Default Bucket (used when no bucket column or no match)
                      </label>
                      {buckets.length === 0 ? (
                        <p style={{ margin: 0, fontSize: "0.85rem", color: "#B45309" }}>No buckets found. Create buckets first.</p>
                      ) : (
                        <select
                          style={inputStyle}
                          value={importIssuesDefaultBucketId}
                          onChange={(e) => setImportIssuesDefaultBucketId(e.target.value)}
                        >
                          <option value="">— No default bucket —</option>
                          {buckets.map((b) => (
                            <option key={b.id} value={b.id}>{b.name || "Untitled Bucket"}</option>
                          ))}
                        </select>
                      )}
                    </div>
                    {importIssuesUniqueStatuses.length > 0 && (
                      <div style={{ border: "1px solid #BAE6FD", borderRadius: "8px", backgroundColor: "#FFFFFF", padding: "12px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "10px" }}>
                          <div>
                            <div style={{ fontWeight: 700, color: "#0369A1" }}>Status Mapping</div>
                            <div style={{ fontSize: "0.82rem", color: "#64748B" }}>
                              Map every spreadsheet status to Open or Closed. Saved mappings will be reused next time.
                            </div>
                          </div>
                          <div style={{ fontSize: "0.78rem", fontWeight: 700, color: importIssuesAllStatusesMapped ? "#166534" : "#B45309" }}>
                            {importIssuesAllStatusesMapped
                              ? "All statuses mapped"
                              : `${importIssuesUniqueStatuses.filter((statusEntry) => !!normalizeImportStatusValue(resolvedImportStatusMapping[statusEntry.key])).length}/${importIssuesUniqueStatuses.length} mapped`}
                          </div>
                        </div>
                        <div style={{ display: "grid", gap: "10px" }}>
                          {importIssuesUniqueStatuses.map((statusEntry) => {
                            const currentValue = normalizeImportStatusValue(resolvedImportStatusMapping[statusEntry.key]);
                            return (
                              <div key={`import-status-map-${statusEntry.key || "blank"}`} style={{ display: "grid", gridTemplateColumns: "1fr minmax(180px, 220px)", gap: "10px", alignItems: "center" }}>
                                <div style={{ fontSize: "0.84rem", color: "#0F172A", fontWeight: 600 }}>
                                  {statusEntry.label}
                                </div>
                                <select
                                  style={inputStyle}
                                  value={currentValue}
                                  onChange={(event) => {
                                    const nextValue = normalizeImportStatusValue(event.target.value);
                                    setImportIssuesStatusMapping((previous) => ({
                                      ...previous,
                                      [statusEntry.key]: nextValue,
                                    }));
                                  }}
                                >
                                  <option value="">Select Open or Closed</option>
                                  <option value="Open">Open</option>
                                  <option value="Closed">Closed</option>
                                </select>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {importIssuesRows.length > 0 && (
                      <>
                        <div style={{ maxHeight: "200px", overflowY: "auto", border: "1px solid #BAE6FD", borderRadius: "6px", backgroundColor: "#FFFFFF" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                            <thead>
                              <tr style={{ backgroundColor: "#E0F2FE" }}>
                                <th style={{ textAlign: "left", padding: "6px 8px" }}>Issue #</th>
                                <th style={{ textAlign: "left", padding: "6px 8px" }}>Title</th>
                                <th style={{ textAlign: "left", padding: "6px 8px" }}>Status</th>
                                <th style={{ textAlign: "left", padding: "6px 8px" }}>Snapshot</th>
                              </tr>
                            </thead>
                            <tbody>
                              {importIssuesRows.map((row, idx) => (
                                <tr key={idx} style={{ borderTop: "1px solid #E0F2FE" }}>
                                  <td style={{ padding: "5px 8px", fontWeight: 700 }}>{row.issueNumber}</td>
                                  <td style={{ padding: "5px 8px", color: "#475569" }}>{row.title || "—"}</td>
                                  <td style={{ padding: "5px 8px", color: "#475569" }}>{row.statusRaw || "—"}</td>
                                  <td style={{ padding: "5px 8px", color: "#475569" }}>
                                    {row.snapshot ? (
                                      <a href={normalizeSnapshotUrl(row.snapshot)} target="_blank" rel="noreferrer" style={{ color: "#0369A1", textDecoration: "underline" }}>
                                        View snapshot
                                      </a>
                                    ) : "—"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <button
                          type="button"
                          style={{ ...buttonBaseStyle, backgroundColor: importIssuesLoading || !importIssuesAllStatusesMapped ? "#94A3B8" : "#0369A1" }}
                          disabled={importIssuesLoading || !importIssuesAllStatusesMapped}
                          onClick={handleImportIssuesSubmit}
                        >
                          {importIssuesLoading
                            ? "Importing..."
                            : !importIssuesAllStatusesMapped
                              ? "Map all statuses first"
                              : `Import ${importIssuesRows.length} Issue(s)`}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {!selectedProjectId ? (
                <div style={{ backgroundColor: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "8px", padding: "12px 16px", color: "#991B1B", fontWeight: 600 }}>
                  Please select a project first.
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "12px", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span style={{ fontSize: "2.5rem", fontWeight: 800, color: "#059669", lineHeight: 1 }}>{incompleteCount}</span>
                        <div>
                          <div style={{ fontSize: "0.8rem", color: "#6B7280", fontWeight: 600, textTransform: "uppercase" }}>Incomplete</div>
                          <div style={{ fontSize: "0.85rem", color: "#374151" }}>in <strong>{selectedProject?.name}</strong></div>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span style={{ fontSize: "2.5rem", fontWeight: 800, color: "#1D4ED8", lineHeight: 1 }}>{completeCount}</span>
                        <div>
                          <div style={{ fontSize: "0.8rem", color: "#6B7280", fontWeight: 600, textTransform: "uppercase" }}>Complete</div>
                          <div style={{ fontSize: "0.85rem", color: "#374151" }}>in <strong>{selectedProject?.name}</strong></div>
                        </div>
                      </div>
                    </div>
                    <input
                      style={{ ...inputStyle, maxWidth: "280px", minWidth: "220px" }}
                      placeholder="Search issues..."
                      value={issueSearchQuery}
                      onChange={(e) => setIssueSearchQuery(e.target.value)}
                    />
                  </div>

                  {effectiveShowIssueForm && (
                    <form
                      onSubmit={handleCreateIssue}
                      style={{ border: "1px solid #A7F3D0", borderRadius: "8px", padding: "14px", marginBottom: "14px", backgroundColor: "#F0FDF4" }}
                    >
                      <h3 style={{ marginTop: 0, marginBottom: "12px", color: "#065F46" }}>New Issue</h3>
                      <div style={{ display: "grid", gap: "10px" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                          <div>
                            <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", marginBottom: "4px" }}>Issue Number *</label>
                            <input style={inputStyle} placeholder="e.g. 1042" value={issueDraft.issueNumber} onChange={(e) => setIssueDraft((prev) => ({ ...prev, issueNumber: e.target.value }))} />
                          </div>
                          <div>
                            <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", marginBottom: "4px" }}>Status</label>
                            <select style={inputStyle} value={issueDraft.status} onChange={(e) => setIssueDraft((prev) => ({ ...prev, status: e.target.value }))}>
                              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </div>
                        </div>
                        <div>
                          <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", marginBottom: "4px" }}>Due Date</label>
                          <input
                            type="date"
                            style={inputStyle}
                            value={toDateInputValue(issueDraft.dueDate)}
                            onChange={(e) => setIssueDraft((prev) => ({ ...prev, dueDate: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", marginBottom: "4px" }}>Bucket Card *</label>
                          {buckets.length === 0 ? (
                            <div style={{ fontSize: "0.88rem", color: "#B45309", backgroundColor: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: "6px", padding: "8px 12px" }}>
                              No buckets found. Create buckets in the Bucket Cards tab first.
                            </div>
                          ) : (
                            <select style={inputStyle} value={issueDraft.bucketId} onChange={(e) => setIssueDraft((prev) => ({ ...prev, bucketId: e.target.value }))}>
                              <option value="">â€” Select a bucket â€”</option>
                              {buckets.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                          )}
                        </div>
                        <div>
                          <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", marginBottom: "4px" }}>Additional Buckets (non-primary)</label>
                          <select
                            multiple
                            style={{ ...inputStyle, minHeight: "120px" }}
                            value={normalizeBucketIdArray(issueDraft.secondaryBucketIds).filter((item) => item !== String(issueDraft.bucketId || "").trim())}
                            onChange={(e) => {
                              const selectedValues = Array.from(e.target.selectedOptions).map((option) => option.value);
                              setIssueDraft((prev) => ({
                                ...prev,
                                secondaryBucketIds: normalizeBucketIdArray(selectedValues).filter((item) => item !== String(prev.bucketId || "").trim()),
                              }));
                            }}
                          >
                            {buckets
                              .filter((b) => b.id !== String(issueDraft.bucketId || "").trim())
                              .map((b) => <option key={`new-secondary-${b.id}`} value={b.id}>{b.name}</option>)}
                          </select>
                        </div>
                        <button type="submit" style={{ ...buttonBaseStyle, backgroundColor: "#059669" }}>Save Issue</button>
                      </div>
                    </form>
                  )}

                  {loadingIssues ? <p>Loading issues...</p> : null}

                  {issuesTableRows.length === 0 && !loadingIssues ? (
                    <p style={{ color: "#6B7280" }}>
                      {issueSearchQuery.trim()
                        ? "No issues match the current filter."
                        : "No issues yet. Click \"+ New Issue\" to create one."}
                    </p>
                  ) : (
                    <div style={{ border: "1px solid #E5E7EB", borderRadius: "8px", backgroundColor: "#FFFFFF", overflow: "hidden" }}>
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "1120px" }}>
                          <thead>
                            <tr style={{ backgroundColor: "#F8FAFC", borderBottom: "1px solid #E2E8F0" }}>
                              <th style={{ textAlign: "left", padding: "10px 12px", fontSize: "0.78rem", color: "#475569", textTransform: "uppercase" }}>Issue #</th>
                              <th style={{ textAlign: "left", padding: "10px 12px", fontSize: "0.78rem", color: "#475569", textTransform: "uppercase" }}>Snapshot</th>
                              <th style={{ textAlign: "left", padding: "10px 12px", fontSize: "0.78rem", color: "#475569", textTransform: "uppercase" }}>Status</th>
                              <th style={{ textAlign: "left", padding: "10px 12px", fontSize: "0.78rem", color: "#475569", textTransform: "uppercase" }}>Due Date</th>
                              <th style={{ textAlign: "left", padding: "10px 12px", fontSize: "0.78rem", color: "#475569", textTransform: "uppercase" }}>Bucket</th>
                              <th style={{ textAlign: "left", padding: "10px 12px", fontSize: "0.78rem", color: "#475569", textTransform: "uppercase" }}>Title</th>
                              <th style={{ textAlign: "left", padding: "10px 12px", fontSize: "0.78rem", color: "#475569", textTransform: "uppercase" }}>Description</th>
                              <th style={{ textAlign: "left", padding: "10px 12px", fontSize: "0.78rem", color: "#475569", textTransform: "uppercase" }}>Tags</th>
                              <th style={{ textAlign: "left", padding: "10px 12px", fontSize: "0.78rem", color: "#475569", textTransform: "uppercase" }}>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {issuesTableRows.map((issue) => {
                              const { bg, text } = statusBadgeColor(issue.status);
                              const isCompleted = isIssueDoneStatus(issue.status);
                              const bucket = buckets.find((b) => b.id === issue.bucketId);
                              const dueDateCountdown = getDueDateCountdownMeta(getIssueDueDateValue(issue));
                              const dueDateSetterLabel = getDueDateSetterLabel(issue);
                              const issueHasManualNote = hasManualIssueNote(issue.notes);
                              const issueTags = normalizeIssueTags(issue.tags);
                              const issueSnapshotUrl = getIssueSnapshotUrl(issue);
                              const tagDraftValue = String(tagDraftByIssueId[issue.id] || "");
                              const liveIssueNumberQuery = String(issueSearchQuery || "").trim().toLowerCase();
                              const matchesLiveIssueNumber = !!liveIssueNumberQuery
                                && String(issue.issueNumber || "").toLowerCase().includes(liveIssueNumberQuery);

                              if (editingIssueId === issue.id) {
                                return (
                                  <tr key={issue.id} style={{ borderTop: "1px solid #E5E7EB" }}>
                                    <td colSpan={9} style={{ padding: "10px 12px" }}>
                                      <div style={{ display: "grid", gap: "8px" }}>
                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                                          <input style={inputStyle} placeholder="Issue number" value={editIssueDraft.issueNumber} onChange={(e) => setEditIssueDraft((prev) => ({ ...prev, issueNumber: e.target.value }))} />
                                          <select style={inputStyle} value={editIssueDraft.status} onChange={(e) => setEditIssueDraft((prev) => ({ ...prev, status: e.target.value }))}>
                                            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                                          </select>
                                        </div>
                                        <input
                                          type="date"
                                          style={inputStyle}
                                          value={toDateInputValue(editIssueDraft.dueDate)}
                                          onChange={(e) => setEditIssueDraft((prev) => ({ ...prev, dueDate: e.target.value }))}
                                        />
                                        <input style={inputStyle} placeholder="Title" value={editIssueDraft.title} onChange={(e) => setEditIssueDraft((prev) => ({ ...prev, title: e.target.value }))} />
                                        <textarea style={textareaStyle} placeholder="Description" value={editIssueDraft.description} onChange={(e) => setEditIssueDraft((prev) => ({ ...prev, description: e.target.value }))} />
                                        <select style={inputStyle} value={editIssueDraft.bucketId} onChange={(e) => setEditIssueDraft((prev) => ({ ...prev, bucketId: e.target.value }))}>
                                          <option value="">â€” No bucket â€”</option>
                                          {buckets.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                                        </select>
                                        <select
                                          multiple
                                          style={{ ...inputStyle, minHeight: "120px" }}
                                          value={normalizeBucketIdArray(editIssueDraft.secondaryBucketIds).filter((item) => item !== String(editIssueDraft.bucketId || "").trim())}
                                          onChange={(e) => {
                                            const selectedValues = Array.from(e.target.selectedOptions).map((option) => option.value);
                                            setEditIssueDraft((prev) => ({
                                              ...prev,
                                              secondaryBucketIds: normalizeBucketIdArray(selectedValues).filter((item) => item !== String(prev.bucketId || "").trim()),
                                            }));
                                          }}
                                        >
                                          {buckets
                                            .filter((b) => b.id !== String(editIssueDraft.bucketId || "").trim())
                                            .map((b) => <option key={`edit-secondary-${b.id}`} value={b.id}>{b.name}</option>)}
                                        </select>
                                        <div style={{ display: "flex", gap: "6px" }}>
                                          <button type="button" style={{ ...buttonBaseStyle, backgroundColor: "#2563EB" }} onClick={() => handleUpdateIssue(issue.id)}>Save</button>
                                          <button type="button" style={{ ...buttonBaseStyle, backgroundColor: "#6B7280" }} onClick={() => setEditingIssueId("")}>Cancel</button>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              }

                              return (
                                <tr
                                  key={issue.id}
                                  style={{
                                    borderTop: "1px solid #E5E7EB",
                                    backgroundColor: matchesLiveIssueNumber ? "#FFF7ED" : "transparent",
                                    boxShadow: matchesLiveIssueNumber ? "inset 3px 0 0 #F97316" : "none",
                                  }}
                                >
                                  <td style={{ padding: "10px 12px", fontWeight: 700, color: "#0F172A", whiteSpace: "nowrap" }}>#{issue.issueNumber || "-"}</td>
                                  <td style={{ padding: "6px 12px" }}>
                                    {issueSnapshotUrl ? (
                                      <img
                                        src={issueSnapshotUrl}
                                        alt="Snapshot"
                                        style={{ display: "block", width: "80px", height: "56px", objectFit: "cover", borderRadius: "6px", cursor: "zoom-in" }}
                                        onClick={() => openSnapshotLightbox(issueSnapshotUrl, `Issue #${issue.issueNumber || issue.id || ""} Snapshot`)}
                                        onError={(e) => { e.target.style.display = "none"; }}
                                      />
                                    ) : (
                                      <span style={{ fontSize: "0.72rem", color: "#CBD5E1" }}>—</span>
                                    )}
                                  </td>
                                  <td style={{ padding: "10px 12px" }}>
                                    <div style={{ display: "grid", gap: "5px" }}>
                                      <button
                                        type="button"
                                        title={isCompleted ? "Click to re-open" : "Click to mark as complete"}
                                        onClick={() => handleToggleIssueComplete(issue, !isCompleted)}
                                        style={{ fontSize: "0.78rem", backgroundColor: bg, color: text, borderRadius: "999px", padding: "3px 8px", fontWeight: 700, whiteSpace: "nowrap", border: "none", cursor: "pointer", width: "fit-content" }}
                                      >
                                        {isCompleted ? "Close" : "Open"}
                                      </button>
                                      {!issueHasManualNote ? (
                                        <span className="issue-note-warning-blink" style={{ fontSize: "0.68rem", color: "#DC2626", fontWeight: 800, lineHeight: 1.35 }}>
                                          Please Leave a note urgently
                                        </span>
                                      ) : null}
                                    </div>
                                  </td>
                                  <td style={{ padding: "10px 12px", minWidth: "160px" }}>
                                    <div style={{ display: "grid", gap: "6px" }}>
                                      <input
                                        type="date"
                                        style={{ ...inputStyle, minWidth: "145px", padding: "6px 8px" }}
                                        value={getIssueDueDateValue(issue)}
                                        disabled={!!savingDueDateByIssueId[issue.id]}
                                        onChange={(event) => handleIssueDueDateChange(issue, event.target.value)}
                                      />
                                      {dueDateCountdown ? (
                                        <span
                                          style={{
                                            fontSize: "0.7rem",
                                            fontWeight: 700,
                                            backgroundColor: dueDateCountdown.bg,
                                            color: dueDateCountdown.text,
                                            borderRadius: "999px",
                                            padding: "2px 8px",
                                            width: "fit-content",
                                          }}
                                        >
                                          {dueDateCountdown.label}
                                        </span>
                                      ) : null}
                                      {dueDateSetterLabel ? (
                                        <span style={{ fontSize: "0.68rem", color: "#64748B" }}>
                                          Set by: {dueDateSetterLabel}
                                        </span>
                                      ) : null}
                                    </div>
                                  </td>
                                  <td
                                    style={{ padding: "10px 12px", color: "#334155", whiteSpace: "nowrap", cursor: "pointer" }}
                                    title="Double-click to change bucket"
                                    onDoubleClick={() => setEditingBucketIssueId(issue.id)}
                                  >
                                    {editingBucketIssueId === issue.id ? (
                                      <select
                                        autoFocus
                                        style={{ ...inputStyle, minWidth: "140px", padding: "4px 6px", fontSize: "0.82rem" }}
                                        value={issue.bucketId || ""}
                                        disabled={!!savingBucketByIssueId[issue.id]}
                                        onChange={(e) => handleInlineBucketChange(issue, e.target.value)}
                                        onBlur={() => setEditingBucketIssueId("")}
                                      >
                                        {buckets.map((b) => (
                                          <option key={b.id} value={b.id}>{b.name}</option>
                                        ))}
                                      </select>
                                    ) : (() => {
                                      const primaryName = bucket?.name || issue.bucketName || issue.groupName || "No bucket";
                                      const secondaryCount = normalizeBucketIdArray(issue.secondaryBucketIds).filter((item) => item !== String(issue.bucketId || "").trim()).length;
                                      return secondaryCount > 0 ? `${primaryName} +${secondaryCount}` : primaryName;
                                    })()}
                                  </td>
                                  <td style={{ padding: "10px 12px", color: "#334155" }}>{issue.title || "-"}</td>
                                  <td style={{ padding: "10px 12px", color: "#64748B" }}>{issue.description || "-"}</td>
                                  <td style={{ padding: "10px 12px", minWidth: "240px" }}>
                                    <div style={{ display: "grid", gap: "6px" }}>
                                      <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                                        {issueTags.length === 0 ? (
                                          <span style={{ fontSize: "0.72rem", color: "#94A3B8" }}>No tags</span>
                                        ) : issueTags.map((tag) => (
                                          <span key={`${issue.id}-tag-${tag}`} style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "0.7rem", backgroundColor: "#E0E7FF", color: "#312E81", borderRadius: "999px", padding: "2px 7px", fontWeight: 700 }}>
                                            <span>{tag}</span>
                                            <button
                                              type="button"
                                              onClick={() => handleEditIssueTag(issue, tag)}
                                              disabled={!!savingTagsByIssueId[issue.id]}
                                              style={{ border: "none", background: "transparent", color: "#3730A3", cursor: "pointer", fontSize: "0.65rem", padding: 0 }}
                                              title="Edit tag"
                                            >
                                              Edit
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleRemoveIssueTag(issue, tag)}
                                              disabled={!!savingTagsByIssueId[issue.id]}
                                              style={{ border: "none", background: "transparent", color: "#4338CA", cursor: "pointer", fontSize: "0.75rem", padding: 0, lineHeight: 1 }}
                                              title="Remove tag"
                                            >
                                              x
                                            </button>
                                          </span>
                                        ))}
                                      </div>
                                      <div style={{ display: "flex", gap: "6px" }}>
                                        <input
                                          style={{ ...inputStyle, padding: "5px 7px", fontSize: "0.75rem" }}
                                          placeholder="Add tag"
                                          value={tagDraftValue}
                                          disabled={!!savingTagsByIssueId[issue.id]}
                                          onChange={(event) => setTagDraftByIssueId((previous) => ({ ...previous, [issue.id]: event.target.value }))}
                                          onKeyDown={(event) => {
                                            if (event.key === "Enter") {
                                              event.preventDefault();
                                              handleAddIssueTag(issue);
                                            }
                                          }}
                                        />
                                        <button
                                          type="button"
                                          style={{ ...buttonBaseStyle, backgroundColor: "#4F46E5", fontSize: "0.72rem", padding: "4px 8px" }}
                                          disabled={!!savingTagsByIssueId[issue.id]}
                                          onClick={() => handleAddIssueTag(issue)}
                                        >
                                          Add
                                        </button>
                                      </div>
                                    </div>
                                  </td>
                                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                      <button
                                        type="button"
                                        title="Email this issue"
                                        style={{ ...buttonBaseStyle, backgroundColor: "#2563EB", fontSize: "1rem", padding: "3px 7px", lineHeight: 1 }}
                                        onClick={() => handleEmailIssue(issue, bucket?.name || issue.bucketName || issue.groupName || "")}
                                      >
                                        ✉
                                      </button>
                                      <button
                                        type="button"
                                        style={{ ...buttonBaseStyle, backgroundColor: "#0F766E", fontSize: "0.75rem", padding: "3px 8px" }}
                                        onClick={() => { setEditingIssueId(issue.id); setEditIssueDraft({ issueNumber: issue.issueNumber || "", title: issue.title || "", description: issue.description || "", status: issue.status || "Open", bucketId: issue.bucketId || "", secondaryBucketIds: normalizeBucketIdArray(issue.secondaryBucketIds).filter((item) => item !== String(issue.bucketId || "").trim()), dueDate: getIssueDueDateValue(issue) }); }}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        style={{ ...buttonBaseStyle, backgroundColor: "#DC2626", fontSize: "0.75rem", padding: "3px 8px" }}
                                        onClick={() => handleDeleteIssue(issue.id)}
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* â”€â”€ BUCKET CARDS TAB â”€â”€ */}
          {activeTab === "buckets" && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <h2 style={{ margin: 0 }}>Bucket Cards</h2>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    style={{ ...buttonBaseStyle, backgroundColor: isManagingBuckets ? "#6B7280" : "#0F766E" }}
                    onClick={() => {
                      setIsManagingBuckets((prev) => {
                        const next = !prev;
                        if (!next) {
                          setSelectedManageBucketId("");
                          setEditingBucketId("");
                        }
                        return next;
                      });
                    }}
                    disabled={!selectedProjectId}
                  >
                    {isManagingBuckets ? "Done Managing" : "Manage Buckets"}
                  </button>
                  <button
                    type="button"
                    style={{ ...buttonBaseStyle, backgroundColor: showImportBucketsPanel ? "#6B7280" : "#0369A1" }}
                    onClick={() => {
                      setShowImportBucketsPanel((prev) => !prev);
                      setImportBucketsRows([]);
                    }}
                    disabled={!selectedProjectId}
                  >
                    {showImportBucketsPanel ? "Cancel Import" : "Import CSV/Excel"}
                  </button>
                  <input
                    ref={importBucketsFileRef}
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    style={{ display: "none" }}
                    onChange={handleImportBucketsFile}
                  />
                  <button
                    type="button"
                    style={{ ...buttonBaseStyle, backgroundColor: "#7C3AED" }}
                    onClick={() => {
                      setShowBucketForm((prev) => !prev);
                      setBucketDraft({
                        name: "",
                        description: "",
                        cardReviewProjectId: "",
                        cardReviewStep: "",
                        cardReviewCardRef: "",
                      });
                    }}
                  >
                    {showBucketForm ? "Cancel" : "+ New Bucket"}
                  </button>
                  <button
                    type="button"
                    style={{ ...buttonBaseStyle, backgroundColor: buckets.length > 0 ? "#DC2626" : "#94A3B8" }}
                    onClick={handleDeleteAllBuckets}
                    disabled={!selectedProjectId || buckets.length === 0}
                  >
                    Delete All Buckets
                  </button>
                </div>
              </div>

              {/* Import Buckets panel */}
              {showImportBucketsPanel && selectedProjectId && (
                <div style={{ border: "1px solid #BAE6FD", borderRadius: "8px", padding: "14px", marginBottom: "14px", backgroundColor: "#F0F9FF" }}>
                  <h3 style={{ marginTop: 0, marginBottom: "10px", color: "#0369A1" }}>Import Buckets from CSV / Excel</h3>
                  <p style={{ margin: "0 0 10px", fontSize: "0.85rem", color: "#475569" }}>
                    Expected columns: <strong>name</strong> (required), <strong>description</strong> (optional).
                  </p>
                  <div style={{ display: "grid", gap: "10px" }}>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        style={{ ...buttonBaseStyle, backgroundColor: "#0369A1" }}
                        onClick={() => importBucketsFileRef.current?.click()}
                      >
                        Choose File
                      </button>
                      {importBucketsRows.length > 0 && (
                        <span style={{ fontSize: "0.85rem", color: "#0369A1", fontWeight: 600 }}>
                          {importBucketsRows.length} row(s) ready to import
                        </span>
                      )}
                    </div>
                    {importBucketsRows.length > 0 && (
                      <>
                        <div style={{ maxHeight: "200px", overflowY: "auto", border: "1px solid #BAE6FD", borderRadius: "6px", backgroundColor: "#FFFFFF" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                            <thead>
                              <tr style={{ backgroundColor: "#E0F2FE" }}>
                                <th style={{ textAlign: "left", padding: "6px 8px" }}>Name</th>
                                <th style={{ textAlign: "left", padding: "6px 8px" }}>Description</th>
                              </tr>
                            </thead>
                            <tbody>
                              {importBucketsRows.map((row, idx) => (
                                <tr key={idx} style={{ borderTop: "1px solid #E0F2FE" }}>
                                  <td style={{ padding: "5px 8px", fontWeight: 700 }}>{row.name}</td>
                                  <td style={{ padding: "5px 8px", color: "#475569" }}>{row.description || "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <button
                          type="button"
                          style={{ ...buttonBaseStyle, backgroundColor: importBucketsLoading ? "#94A3B8" : "#0369A1" }}
                          disabled={importBucketsLoading}
                          onClick={handleImportBucketsSubmit}
                        >
                          {importBucketsLoading ? "Importing..." : `Import ${importBucketsRows.length} Bucket(s)`}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {isManagingBuckets && !editingBucketId && (
                <div style={{ marginBottom: "10px", padding: "8px 10px", borderRadius: "8px", backgroundColor: "#F5F3FF", border: "1px solid #DDD6FE", color: "#5B21B6", fontWeight: 600, fontSize: "0.9rem" }}>
                  Select a bucket card to enable Edit or Delete.
                </div>
              )}

              {isManagingBuckets && !editingBucketId && (
                <div style={{ marginBottom: "10px", padding: "8px 10px", borderRadius: "8px", backgroundColor: "#EEF2FF", border: "1px solid #C7D2FE", color: "#3730A3", fontWeight: 600, fontSize: "0.85rem" }}>
                  Drag and drop bucket cards to reorder them.
                  {isReorderingBuckets ? " Saving order..." : ""}
                </div>
              )}

              {showBucketForm && (
                <form
                  onSubmit={handleCreateBucket}
                  style={{ border: "1px solid #DDD6FE", borderRadius: "8px", padding: "14px", marginBottom: "14px", backgroundColor: "#F5F3FF" }}
                >
                  <h3 style={{ marginTop: 0, marginBottom: "12px", color: "#5B21B6" }}>New Bucket</h3>
                  <div style={{ display: "grid", gap: "10px" }}>
                    <div>
                      <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", marginBottom: "4px" }}>Name (optional)</label>
                      <input style={inputStyle} placeholder="Bucket name (optional)" value={bucketDraft.name} onChange={(e) => setBucketDraft((prev) => ({ ...prev, name: e.target.value }))} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", marginBottom: "4px" }}>Description</label>
                      <textarea style={textareaStyle} placeholder="Optional description" value={bucketDraft.description} onChange={(e) => setBucketDraft((prev) => ({ ...prev, description: e.target.value }))} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", marginBottom: "4px" }}>Card Review Project</label>
                      <select
                        style={inputStyle}
                        value={bucketDraft.cardReviewProjectId}
                        onChange={(event) => {
                          const nextProjectId = normalizeValue(event.target.value);
                          setBucketDraft((previous) => ({
                            ...previous,
                            cardReviewProjectId: nextProjectId,
                          }));
                        }}
                      >
                        <option value="">Select project...</option>
                        {cardReviewProjects.map((projectOption) => (
                          <option key={`new-bucket-project-${projectOption.id}`} value={projectOption.id}>
                            {projectOption.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", marginBottom: "4px" }}>Card Review Column Step</label>
                      <select
                        style={inputStyle}
                        value={bucketDraft.cardReviewStep}
                        onChange={(event) => {
                          const nextStep = normalizeCardReviewStep(event.target.value);
                          setBucketDraft((previous) => ({
                            ...previous,
                            cardReviewStep: nextStep,
                          }));
                        }}
                        disabled={!bucketDraft.cardReviewProjectId}
                      >
                        <option value="">Select step...</option>
                        {CARD_REVIEW_STEP_OPTIONS.map((stepOption) => (
                          <option key={`new-bucket-step-${stepOption.id}`} value={stepOption.id}>
                            {stepOption.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", marginBottom: "4px" }}>Card Associated To Step</label>
                      <select
                        style={inputStyle}
                        value={bucketDraft.cardReviewCardRef}
                        onChange={(event) => {
                          setBucketDraft((previous) => ({
                            ...previous,
                            cardReviewCardRef: normalizeValue(event.target.value),
                          }));
                        }}
                        disabled={!bucketDraft.cardReviewProjectId || !bucketDraft.cardReviewStep}
                      >
                        <option value="">
                          {bucketDraft.cardReviewProjectId && bucketDraft.cardReviewStep
                            ? "Select card..."
                            : bucketDraft.cardReviewProjectId
                            ? "Select step first..."
                            : "Select project first..."}
                        </option>
                        {getCardReviewCardsForSelection(bucketDraft.cardReviewProjectId, bucketDraft.cardReviewStep).map((cardOption) => (
                          <option key={`new-bucket-card-${cardOption.cardRef}`} value={cardOption.cardRef}>
                            {cardOption.cardRef}
                          </option>
                        ))}
                      </select>
                      {bucketDraft.cardReviewProjectId && bucketDraft.cardReviewStep && getCardReviewCardsForSelection(bucketDraft.cardReviewProjectId, bucketDraft.cardReviewStep).length === 0 ? (
                        <p style={{ margin: "6px 0 0", color: "#64748B", fontSize: "0.8rem" }}>
                          No cards currently found in this Card Review step.
                        </p>
                      ) : null}
                      {loadingCardReviewEntries ? (
                        <p style={{ margin: "6px 0 0", color: "#64748B", fontSize: "0.8rem" }}>Loading Card Review cards...</p>
                      ) : null}
                    </div>
                    <button type="submit" style={{ ...buttonBaseStyle, backgroundColor: "#7C3AED" }}>Save Bucket</button>
                  </div>
                </form>
              )}

              {loadingBuckets ? <p>Loading buckets...</p> : null}

              {buckets.length === 0 && !loadingBuckets ? (
                <p style={{ color: "#6B7280" }}>No bucket cards yet. Click "+ New Bucket" to create one.</p>
              ) : (
                <>
                  {isManagingBuckets && (
                    <>
                      {/* Bucket catalog */}
                      <div style={{ display: "grid", gap: "8px", marginBottom: "24px" }}>
                        {buckets.map((bucket) => (
                          <div
                            key={bucket.id}
                            draggable={isManagingBuckets && !editingBucketId}
                            onDragStart={() => setDraggedBucketId(bucket.id)}
                            onDragEnd={() => setDraggedBucketId("")}
                            onDragOver={(event) => {
                              if (isManagingBuckets && !editingBucketId) {
                                event.preventDefault();
                              }
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              if (!isManagingBuckets || editingBucketId || !draggedBucketId || draggedBucketId === bucket.id) {
                                return;
                              }
                              handleReorderBuckets(draggedBucketId, bucket.id);
                            }}
                            style={{
                              border: draggedBucketId === bucket.id ? "2px solid #7C3AED" : "1px solid #E5E7EB",
                              borderRadius: "8px",
                              padding: "12px",
                              backgroundColor: draggedBucketId === bucket.id ? "#F5F3FF" : "#FFFFFF",
                              cursor: isManagingBuckets && !editingBucketId ? "grab" : "default",
                            }}
                          >
                            {editingBucketId === bucket.id ? (
                              <div style={{ display: "grid", gap: "8px" }}>
                                <input style={inputStyle} placeholder="Bucket name" value={editBucketDraft.name} onChange={(e) => setEditBucketDraft((prev) => ({ ...prev, name: e.target.value }))} />
                                <textarea style={textareaStyle} placeholder="Description" value={editBucketDraft.description} onChange={(e) => setEditBucketDraft((prev) => ({ ...prev, description: e.target.value }))} />
                                <select
                                  style={inputStyle}
                                  value={editBucketDraft.cardReviewProjectId}
                                  onChange={(event) => {
                                    const nextProjectId = normalizeValue(event.target.value);
                                    setEditBucketDraft((previous) => ({
                                      ...previous,
                                      cardReviewProjectId: nextProjectId,
                                    }));
                                  }}
                                >
                                  <option value="">Select project...</option>
                                  {cardReviewProjects.map((projectOption) => (
                                    <option key={`edit-bucket-project-${bucket.id}-${projectOption.id}`} value={projectOption.id}>
                                      {projectOption.label}
                                    </option>
                                  ))}
                                </select>
                                <select
                                  style={inputStyle}
                                  value={editBucketDraft.cardReviewStep}
                                  onChange={(event) => {
                                    const nextStep = normalizeCardReviewStep(event.target.value);
                                    setEditBucketDraft((previous) => ({
                                      ...previous,
                                      cardReviewStep: nextStep,
                                    }));
                                  }}
                                  disabled={!editBucketDraft.cardReviewProjectId}
                                >
                                  <option value="">Select step...</option>
                                  {CARD_REVIEW_STEP_OPTIONS.map((stepOption) => (
                                    <option key={`edit-bucket-step-${bucket.id}-${stepOption.id}`} value={stepOption.id}>
                                      {stepOption.label}
                                    </option>
                                  ))}
                                </select>
                                <select
                                  style={inputStyle}
                                  value={editBucketDraft.cardReviewCardRef}
                                  onChange={(event) => {
                                    setEditBucketDraft((previous) => ({
                                      ...previous,
                                      cardReviewCardRef: normalizeValue(event.target.value),
                                    }));
                                  }}
                                  disabled={!editBucketDraft.cardReviewProjectId || !editBucketDraft.cardReviewStep}
                                >
                                  <option value="">
                                    {editBucketDraft.cardReviewProjectId && editBucketDraft.cardReviewStep
                                      ? "Select card..."
                                      : editBucketDraft.cardReviewProjectId
                                      ? "Select step first..."
                                      : "Select project first..."}
                                  </option>
                                  {getCardReviewCardsForSelection(editBucketDraft.cardReviewProjectId, editBucketDraft.cardReviewStep).map((cardOption) => (
                                    <option key={`edit-bucket-card-${bucket.id}-${cardOption.cardRef}`} value={cardOption.cardRef}>
                                      {cardOption.cardRef}
                                    </option>
                                  ))}
                                </select>
                                <div style={{ display: "flex", gap: "6px" }}>
                                  <button type="button" style={{ ...buttonBaseStyle, backgroundColor: "#7C3AED" }} onClick={() => handleUpdateBucket(bucket.id)}>Save</button>
                                  <button type="button" style={{ ...buttonBaseStyle, backgroundColor: "#6B7280" }} onClick={() => setEditingBucketId("")}>Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (isManagingBuckets && !editingBucketId) {
                                      setSelectedManageBucketId(bucket.id);
                                    }
                                  }}
                                  style={{ border: "none", background: "transparent", padding: 0, textAlign: "left", cursor: isManagingBuckets ? "pointer" : "default", flex: 1 }}
                                >
                                  <strong>{bucket.name}</strong>
                                  {bucket.description ? <p style={{ margin: "2px 0 0", color: "#6B7280", fontSize: "0.83rem" }}>{bucket.description}</p> : null}
                                  {(normalizeValue(bucket.cardReviewProjectId) || normalizeCardReviewStep(bucket.cardReviewStep) || normalizeValue(bucket.cardReviewCardRef)) ? (
                                    <p style={{ margin: "4px 0 0", color: "#334155", fontSize: "0.8rem", fontWeight: 600 }}>
                                      {normalizeValue(bucket.cardReviewProjectId)
                                        ? `Project: ${normalizeValue(bucket.cardReviewProjectId)}`
                                        : "Project: -"}
                                      {" | "}
                                      {normalizeCardReviewStep(bucket.cardReviewStep)
                                        ? `Step: ${CARD_REVIEW_STEP_LABEL_BY_ID[normalizeCardReviewStep(bucket.cardReviewStep)] || bucket.cardReviewStep}`
                                        : "Step: -"}
                                      {normalizeValue(bucket.cardReviewCardRef)
                                        ? ` | Card: ${normalizeValue(bucket.cardReviewCardRef)}`
                                        : " | Card: -"}
                                    </p>
                                  ) : null}
                                </button>
                                {isManagingBuckets && !editingBucketId && selectedManageBucketId === bucket.id && (
                                  <span style={{ alignSelf: "center", fontSize: "0.76rem", backgroundColor: "#EDE9FE", color: "#5B21B6", borderRadius: "999px", padding: "3px 8px", fontWeight: 700 }}>
                                    Selected
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      {!editingBucketId && buckets.length > 0 && (
                        <div style={{ display: "flex", gap: "8px", marginTop: "10px", marginBottom: "16px", flexWrap: "wrap" }}>
                          <button
                            type="button"
                            style={{ ...buttonBaseStyle, backgroundColor: selectedManageBucketId ? "#0F766E" : "#94A3B8" }}
                            disabled={!selectedManageBucketId}
                            onClick={() => {
                              const bucketToEdit = buckets.find((bucket) => bucket.id === selectedManageBucketId);
                              if (!bucketToEdit) return;
                              setEditingBucketId(bucketToEdit.id);
                              setEditBucketDraft({
                                name: bucketToEdit.name || "",
                                description: bucketToEdit.description || "",
                                cardReviewProjectId: normalizeValue(bucketToEdit.cardReviewProjectId),
                                cardReviewStep: normalizeCardReviewStep(bucketToEdit.cardReviewStep),
                                cardReviewCardRef: normalizeValue(bucketToEdit.cardReviewCardRef),
                              });
                            }}
                          >
                            Edit Selected
                          </button>
                          <button
                            type="button"
                            style={{ ...buttonBaseStyle, backgroundColor: selectedManageBucketId ? "#DC2626" : "#94A3B8" }}
                            disabled={!selectedManageBucketId}
                            onClick={() => {
                              if (!selectedManageBucketId) return;
                              handleDeleteBucket(selectedManageBucketId);
                              setSelectedManageBucketId("");
                            }}
                          >
                            Delete Selected
                          </button>
                        </div>
                      )}
                    </>
                  )}

                  {/* Issues grouped by bucket for selected project */}
                  {selectedProjectId && (
                    <>
                      <div style={{ display: "flex", gap: "8px", alignItems: "stretch", flexWrap: "wrap", marginBottom: "10px" }}>
                        <input
                          type="text"
                          style={{ ...inputStyle, flex: "1 1 340px", minWidth: "240px", boxSizing: "border-box" }}
                          placeholder="Search issues by title, number, or description..."
                          value={bucketTabIssueSearchQuery}
                          onChange={(e) => setBucketTabIssueSearchQuery(e.target.value)}
                        />
                        <details style={{ position: "relative", flex: "0 0 240px", minWidth: "220px" }}>
                          <summary
                            style={{
                              ...inputStyle,
                              listStyle: "none",
                              cursor: "pointer",
                              userSelect: "none",
                              display: "flex",
                              alignItems: "center",
                              minHeight: "40px",
                              justifyContent: "space-between",
                              padding: "8px 10px",
                              fontSize: "0.84rem",
                            }}
                          >
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: "8px", color: "#334155", fontWeight: 600 }}>
                              {issueTagFilterValues.length === 0 ? "Tags: All" : `Tags: ${selectedIssueTagFilterLabel}`}
                            </span>
                            <span style={{ fontSize: "0.72rem", color: "#475569", fontWeight: 700 }}>
                              {issueTagFilterValues.length === 0 ? "ALL" : issueTagFilterValues.length}
                            </span>
                          </summary>
                          <div
                            style={{
                              position: "absolute",
                              top: "calc(100% + 4px)",
                              left: 0,
                              right: 0,
                              zIndex: 20,
                              backgroundColor: "#FFFFFF",
                              border: "1px solid #CBD5E1",
                              borderRadius: "8px",
                              boxShadow: "0 8px 20px rgba(15, 23, 42, 0.12)",
                              padding: "8px",
                              maxHeight: "220px",
                              overflowY: "auto",
                              display: "grid",
                              gap: "6px",
                            }}
                          >
                            <input
                              style={{ ...inputStyle, fontSize: "0.8rem", padding: "6px 8px" }}
                              placeholder="Search tags..."
                              value={issueTagFilterSearchQuery}
                              onChange={(event) => setIssueTagFilterSearchQuery(event.target.value)}
                            />
                            <div style={{ display: "flex", gap: "6px" }}>
                              <button
                                type="button"
                                style={{ ...buttonBaseStyle, backgroundColor: "#334155", fontSize: "0.7rem", padding: "4px 8px" }}
                                onClick={() => setIssueTagFilterValues(issueTagFilterOptions.map((option) => option.lowerValue))}
                                disabled={issueTagFilterOptions.length === 0}
                              >
                                Select All
                              </button>
                              <button
                                type="button"
                                style={{ ...buttonBaseStyle, backgroundColor: "#64748B", fontSize: "0.7rem", padding: "4px 8px" }}
                                onClick={() => setIssueTagFilterValues([])}
                                disabled={issueTagFilterValues.length === 0}
                              >
                                Clear
                              </button>
                            </div>
                            {visibleIssueTagFilterOptions.length === 0 ? (
                              <span style={{ color: "#64748B", fontSize: "0.82rem" }}>No tags available for current filters.</span>
                            ) : (
                              visibleIssueTagFilterOptions.map((option) => {
                                const isChecked = issueTagFilterValues.includes(option.lowerValue);
                                return (
                                  <label
                                    key={`issue-tag-filter-${option.lowerValue}`}
                                    style={{
                                      display: "grid",
                                      gridTemplateColumns: "16px minmax(0, 1fr) auto",
                                      alignItems: "center",
                                      gap: "8px",
                                      fontSize: "0.84rem",
                                      color: "#334155",
                                      cursor: "pointer",
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      style={{ margin: 0 }}
                                      onChange={(event) => {
                                        if (event.target.checked) {
                                          setIssueTagFilterValues((previous) =>
                                            previous.includes(option.lowerValue)
                                              ? previous
                                              : [...previous, option.lowerValue]
                                          );
                                        } else {
                                          setIssueTagFilterValues((previous) =>
                                            previous.filter((value) => value !== option.lowerValue)
                                          );
                                        }
                                      }}
                                    />
                                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{option.value}</span>
                                    <span style={{ fontSize: "0.75rem", color: "#64748B", fontVariantNumeric: "tabular-nums" }}>{option.count}</span>
                                  </label>
                                );
                              })
                            )}
                          </div>
                        </details>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "8px", marginBottom: "10px" }}>
                        <div>
                          <label style={{ display: "block", fontWeight: 600, fontSize: "0.78rem", marginBottom: "4px", color: "#475569", textTransform: "uppercase" }}>
                            Completed From
                          </label>
                          <input
                            type="date"
                            style={inputStyle}
                            value={completedDateFrom}
                            onChange={(event) => setCompletedDateFrom(event.target.value)}
                          />
                        </div>
                        <div>
                          <label style={{ display: "block", fontWeight: 600, fontSize: "0.78rem", marginBottom: "4px", color: "#475569", textTransform: "uppercase" }}>
                            Completed To
                          </label>
                          <input
                            type="date"
                            style={inputStyle}
                            value={completedDateTo}
                            onChange={(event) => setCompletedDateTo(event.target.value)}
                          />
                        </div>
                        <div style={{ display: "flex", alignItems: "flex-end" }}>
                          <button
                            type="button"
                            style={{ ...buttonBaseStyle, backgroundColor: "#475569", width: "100%" }}
                            onClick={() => {
                              setCompletedDateFrom("");
                              setCompletedDateTo("");
                            }}
                            disabled={!completedDateFrom && !completedDateTo}
                          >
                            Clear Date Filter
                          </button>
                        </div>
                        <div>
                          <label style={{ display: "block", fontWeight: 600, fontSize: "0.78rem", marginBottom: "4px", color: "#475569", textTransform: "uppercase" }}>
                            Buckets To Show
                          </label>
                          <details style={{ position: "relative" }}>
                            <summary
                              style={{
                                ...inputStyle,
                                listStyle: "none",
                                cursor: "pointer",
                                userSelect: "none",
                                display: "flex",
                                alignItems: "center",
                                minHeight: "40px",
                                justifyContent: "space-between",
                              }}
                            >
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: "8px" }}>
                                {selectedBucketFilterLabel}
                              </span>
                              <span style={{ fontSize: "0.72rem", color: "#475569", fontWeight: 700 }}>
                                {bucketVisibilityFilterIds.length === 0 ? "ALL" : bucketVisibilityFilterIds.length}
                              </span>
                            </summary>
                            <div
                              style={{
                                position: "absolute",
                                top: "calc(100% + 4px)",
                                left: 0,
                                right: 0,
                                zIndex: 20,
                                backgroundColor: "#FFFFFF",
                                border: "1px solid #CBD5E1",
                                borderRadius: "8px",
                                boxShadow: "0 8px 20px rgba(15, 23, 42, 0.12)",
                                padding: "8px",
                                maxHeight: "220px",
                                overflowY: "auto",
                                display: "grid",
                                gap: "6px",
                              }}
                            >
                              <input
                                style={{ ...inputStyle, fontSize: "0.8rem", padding: "6px 8px" }}
                                placeholder="Search buckets..."
                                value={bucketFilterSearchQuery}
                                onChange={(event) => setBucketFilterSearchQuery(event.target.value)}
                              />
                              <div style={{ display: "flex", gap: "6px" }}>
                                <button
                                  type="button"
                                  style={{ ...buttonBaseStyle, backgroundColor: "#334155", fontSize: "0.7rem", padding: "4px 8px" }}
                                  onClick={() => setBucketVisibilityFilterIds(bucketFilterOptions.map((option) => option.id))}
                                  disabled={bucketFilterOptions.length === 0}
                                >
                                  Select All
                                </button>
                                <button
                                  type="button"
                                  style={{ ...buttonBaseStyle, backgroundColor: "#64748B", fontSize: "0.7rem", padding: "4px 8px" }}
                                  onClick={() => setBucketVisibilityFilterIds([])}
                                  disabled={bucketVisibilityFilterIds.length === 0}
                                >
                                  Clear
                                </button>
                              </div>
                              {visibleBucketFilterOptions.length === 0 ? (
                                <span style={{ color: "#64748B", fontSize: "0.82rem" }}>No buckets available for current filters.</span>
                              ) : (
                                <>
                                  {visibleBucketFilterOptions.map((option) => {
                                    const isChecked = bucketVisibilityFilterIds.includes(option.id);
                                    return (
                                      <label
                                        key={`bucket-visibility-${option.id}`}
                                        style={{
                                          display: "grid",
                                          gridTemplateColumns: "16px minmax(0, 1fr) auto",
                                          alignItems: "center",
                                          gap: "8px",
                                          fontSize: "0.84rem",
                                          color: "#334155",
                                          cursor: "pointer",
                                        }}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          style={{ margin: 0 }}
                                          onChange={(event) => {
                                            if (event.target.checked) {
                                              setBucketVisibilityFilterIds((previous) => previous.includes(option.id) ? previous : [...previous, option.id]);
                                            } else {
                                              setBucketVisibilityFilterIds((previous) => previous.filter((value) => value !== option.id));
                                            }
                                          }}
                                        />
                                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{option.name}</span>
                                        <span style={{ fontSize: "0.75rem", color: "#64748B", fontVariantNumeric: "tabular-nums" }}>{option.count}</span>
                                      </label>
                                    );
                                  })}
                                  {visibleBucketFilterOptions.length > 5 ? (
                                    <div
                                      style={{
                                        position: "sticky",
                                        bottom: 0,
                                        marginTop: "2px",
                                        padding: "6px 8px",
                                        borderRadius: "6px",
                                        background: "linear-gradient(180deg, rgba(255,255,255,0.86) 0%, #FFFFFF 55%)",
                                        color: "#1D4ED8",
                                        fontSize: "0.74rem",
                                        fontWeight: 700,
                                        textAlign: "center",
                                        borderTop: "1px solid #DBEAFE",
                                      }}
                                    >
                                      Scroll to see more buckets ↓
                                    </div>
                                  ) : null}
                                </>
                              )}
                            </div>
                          </details>
                        </div>
                      </div>

                      {leftBucketNavGroups.length === 0 ? (
                        <p style={{ color: "#6B7280" }}>
                          {bucketTabIssueSearchQuery.trim()
                            ? "No issues match your search."
                            : "No issues assigned to buckets for this project yet."}
                        </p>
                      ) : (
                        <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 1fr) minmax(320px, 1fr)", gap: "10px", alignItems: "start" }}>
                          <aside
                            style={{
                              border: "1px solid #D7E2F0",
                              borderRadius: "16px",
                              background: "linear-gradient(180deg, #FFFFFF 0%, #F8FBFF 100%)",
                              padding: "12px",
                              position: "sticky",
                              top: "10px",
                              maxHeight: "calc(100vh - 20px)",
                              overflowY: "auto",
                              overflowX: "hidden",
                              boxShadow: "0 12px 28px rgba(37, 99, 235, 0.08)",
                              display: "grid",
                              gap: "10px",
                            }}
                          >
                            <div style={{ display: "grid", gap: "8px" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                                <div style={{ display: "grid", gap: "3px" }}>
                                  <span style={{ fontSize: "0.72rem", fontWeight: 800, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                                    Bucket Navigator
                                  </span>
                                  <span style={{ fontSize: "1rem", fontWeight: 800, color: "#0F172A" }}>
                                    {leftBucketNavGroups.length} buckets
                                  </span>
                                </div>
                                <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#1E40AF", backgroundColor: "#DBEAFE", borderRadius: "999px", padding: "4px 9px", whiteSpace: "nowrap" }}>
                                  {leftBucketNavGroups.reduce((sum, group) => sum + group.issues.length, 0)} issues
                                </span>
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "6px" }}>
                                <div style={{ border: "1px solid #DBEAFE", borderRadius: "12px", backgroundColor: "#EFF6FF", padding: "8px" }}>
                                  <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.04em" }}>Total</div>
                                  <div style={{ fontSize: "1rem", fontWeight: 800, color: "#1D4ED8", lineHeight: 1.2 }}>{leftBucketNavGroups.reduce((sum, group) => sum + group.issues.length, 0)}</div>
                                </div>
                                <div style={{ border: "1px solid #DCFCE7", borderRadius: "12px", backgroundColor: "#F0FDF4", padding: "8px" }}>
                                  <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.04em" }}>Open</div>
                                  <div style={{ fontSize: "1rem", fontWeight: 800, color: "#166534", lineHeight: 1.2 }}>
                                    {leftBucketNavGroups.reduce((sum, group) => sum + group.issues.filter((issue) => !isIssueDoneStatus(issue.status)).length, 0)}
                                  </div>
                                </div>
                                <div style={{ border: "1px solid #E5E7EB", borderRadius: "12px", backgroundColor: "#F8FAFC", padding: "8px" }}>
                                  <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.04em" }}>Done</div>
                                  <div style={{ fontSize: "1rem", fontWeight: 800, color: "#475569", lineHeight: 1.2 }}>
                                    {leftBucketNavGroups.reduce((sum, group) => sum + group.issues.filter((issue) => isIssueDoneStatus(issue.status)).length, 0)}
                                  </div>
                                </div>
                              </div>
                              <div style={{ fontSize: "0.75rem", color: "#64748B", lineHeight: 1.45 }}>
                                Pick a bucket to jump straight to its issue stack.
                              </div>
                            </div>
                            <div style={{ display: "grid", gap: "8px", paddingRight: "2px" }}>
                              {leftBucketNavGroups.map((group) => {
                                const completedCount = group.issues.filter((issue) => isIssueDoneStatus(issue.status)).length;
                                const remainingCount = group.issues.length - completedCount;
                                const isSelectedBucketNav = selectedBucketNavId === group.id;
                                const completionRatio = group.issues.length > 0
                                  ? Math.round((completedCount / group.issues.length) * 100)
                                  : 0;

                                return (
                                  <button
                                    key={`bucket-nav-${group.id}`}
                                    type="button"
                                    onClick={() => handleSelectBucketNav(group.id)}
                                    onDoubleClick={() => handleOpenBulkMoveForBucket(group.id)}
                                    title="Double-click to move all issues from this bucket"
                                    style={{
                                      width: "100%",
                                      textAlign: "left",
                                      border: isSelectedBucketNav ? "1px solid #2563EB" : "1px solid #E2E8F0",
                                      borderRadius: "14px",
                                      background: isSelectedBucketNav
                                        ? "linear-gradient(180deg, #EFF6FF 0%, #DBEAFE 100%)"
                                        : "linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%)",
                                      padding: "10px",
                                      cursor: "pointer",
                                      display: "grid",
                                      gap: "8px",
                                      boxShadow: isSelectedBucketNav
                                        ? "0 10px 20px rgba(37, 99, 235, 0.12)"
                                        : "0 8px 16px rgba(15, 23, 42, 0.04)",
                                    }}
                                  >
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                                      <div style={{ minWidth: 0, display: "grid", gap: "3px", flex: 1 }}>
                                        <span style={{ fontSize: "0.88rem", fontWeight: 800, color: isSelectedBucketNav ? "#1E40AF" : "#0F172A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                          {group.name}
                                        </span>
                                        <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                          {group.issues.length} total issues
                                        </span>
                                      </div>
                                      <span style={{ fontSize: "0.68rem", fontWeight: 800, color: isSelectedBucketNav ? "#1D4ED8" : "#475569", backgroundColor: isSelectedBucketNav ? "#FFFFFF" : "#E2E8F0", borderRadius: "999px", padding: "4px 8px", whiteSpace: "nowrap" }}>
                                        {remainingCount} left
                                      </span>
                                    </div>
                                    <div style={{ display: "grid", gap: "5px" }}>
                                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "6px" }}>
                                        <div style={{ borderRadius: "10px", backgroundColor: "rgba(255,255,255,0.72)", padding: "6px 8px" }}>
                                          <div style={{ fontSize: "0.64rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase" }}>Open</div>
                                          <div style={{ fontSize: "0.85rem", color: "#166534", fontWeight: 800 }}>{remainingCount}</div>
                                        </div>
                                        <div style={{ borderRadius: "10px", backgroundColor: "rgba(255,255,255,0.72)", padding: "6px 8px" }}>
                                          <div style={{ fontSize: "0.64rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase" }}>Done</div>
                                          <div style={{ fontSize: "0.85rem", color: "#475569", fontWeight: 800 }}>{completedCount}</div>
                                        </div>
                                        <div style={{ borderRadius: "10px", backgroundColor: "rgba(255,255,255,0.72)", padding: "6px 8px" }}>
                                          <div style={{ fontSize: "0.64rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase" }}>Done %</div>
                                          <div style={{ fontSize: "0.85rem", color: "#1E40AF", fontWeight: 800 }}>{completionRatio}%</div>
                                        </div>
                                      </div>
                                      <div style={{ height: "7px", borderRadius: "999px", backgroundColor: isSelectedBucketNav ? "rgba(59, 130, 246, 0.16)" : "#E2E8F0", overflow: "hidden" }}>
                                        <div
                                          style={{
                                            width: `${completionRatio}%`,
                                            height: "100%",
                                            borderRadius: "999px",
                                            background: isSelectedBucketNav
                                              ? "linear-gradient(90deg, #2563EB 0%, #60A5FA 100%)"
                                              : "linear-gradient(90deg, #94A3B8 0%, #CBD5E1 100%)",
                                          }}
                                        />
                                      </div>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </aside>

                          <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "minmax(0, 1fr)" }}>
                            <div
                              style={{
                                border: "1px solid #BFDBFE",
                                borderRadius: "12px",
                                padding: "10px",
                                backgroundColor: "#EFF6FF",
                                display: "grid",
                                gap: "8px",
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                <span style={{ fontSize: "0.82rem", fontWeight: 800, color: "#1E3A8A" }}>
                                  Bulk Actions ({selectedBucketIssueIds.length} selected)
                                </span>
                                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                  <button
                                    type="button"
                                    style={{ ...buttonBaseStyle, backgroundColor: isBulkSelectMode ? "#7C3AED" : "#475569", fontSize: "0.72rem", padding: "5px 9px" }}
                                    onClick={() => {
                                      setIsBulkSelectMode((prev) => {
                                        if (prev) setSelectedBucketIssueIds([]);
                                        return !prev;
                                      });
                                    }}
                                    disabled={isBulkUpdatingIssues}
                                  >
                                    {isBulkSelectMode ? "Multi-select: ON" : "Multi-select"}
                                  </button>
                                  <button
                                    type="button"
                                    style={{ ...buttonBaseStyle, backgroundColor: "#1D4ED8", fontSize: "0.72rem", padding: "5px 9px" }}
                                    onClick={handleSelectAllVisibleBucketIssues}
                                    disabled={!isBulkSelectMode || visibleBucketIssueIds.length === 0 || isBulkUpdatingIssues}
                                  >
                                    Select Visible ({visibleBucketIssueIds.length})
                                  </button>
                                  <button
                                    type="button"
                                    style={{ ...buttonBaseStyle, backgroundColor: "#64748B", fontSize: "0.72rem", padding: "5px 9px" }}
                                    onClick={handleClearBulkIssueSelection}
                                    disabled={selectedBucketIssueIds.length === 0 || isBulkUpdatingIssues}
                                  >
                                    Clear
                                  </button>
                                </div>
                              </div>
                              <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                                <select
                                  style={{ ...inputStyle, width: "auto", minWidth: "170px", padding: "7px 8px", fontSize: "0.78rem" }}
                                  value={bulkMoveBucketId}
                                  disabled={isBulkUpdatingIssues}
                                  onChange={(event) => setBulkMoveBucketId(event.target.value)}
                                >
                                  <option value="">Move selected to: No Bucket</option>
                                  {buckets.map((bucketOption) => (
                                    <option key={`bulk-move-${bucketOption.id}`} value={bucketOption.id}>
                                      {bucketOption.name || "Untitled Bucket"}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  style={{ ...buttonBaseStyle, backgroundColor: "#2563EB", fontSize: "0.72rem", padding: "6px 10px" }}
                                  onClick={handleBulkMoveIssuesToBucket}
                                  disabled={selectedBucketIssueIds.length === 0 || isBulkUpdatingIssues}
                                >
                                  Move Selected
                                </button>
                                <button
                                  type="button"
                                  style={{ ...buttonBaseStyle, backgroundColor: "#DC2626", fontSize: "0.72rem", padding: "6px 10px" }}
                                  onClick={handleBulkDeleteIssues}
                                  disabled={selectedBucketIssueIds.length === 0 || isBulkUpdatingIssues}
                                >
                                  Delete Selected
                                </button>
                              </div>
                            </div>
                            {leftBucketNavGroups.map((group) => {
                              const completedCount = group.issues.filter((issue) => isIssueDoneStatus(issue.status)).length;
                              const remainingCount = group.issues.length - completedCount;
                              const showCompletedIssues = !!showCompletedByBucketId[group.id];
                              // If there's an active search query, show all results including completed items
                              const hasActiveSearch = String(bucketTabIssueSearchQuery || "").trim().length > 0;
                              const visibleIssues = (showCompletedIssues || hasActiveSearch)
                                ? group.issues
                                : group.issues.filter((issue) => !isIssueDoneStatus(issue.status));

                              // Sort issues: high/critical urgency first, then medium urgency, then work markers (start/stop)
                              const sortedVisibleIssues = visibleIssues.slice().sort((a, b) => {
                                const aUrgency = normalizeIssueUrgency(a.urgencyLevel).toLowerCase();
                                const bUrgency = normalizeIssueUrgency(b.urgencyLevel).toLowerCase();
                                const aMarker = normalizeIssueWorkMarker(a.workMarker);
                                const bMarker = normalizeIssueWorkMarker(b.workMarker);

                                // Priority order: critical, high, medium, low
                                const urgencyPriority = { critical: 0, high: 1, medium: 2, low: 3 };
                                const aPriority = urgencyPriority[aUrgency] ?? 3;
                                const bPriority = urgencyPriority[bUrgency] ?? 3;

                                // If urgency differs, prioritize higher urgency (critical/high > medium > low)
                                if (aPriority !== bPriority) return aPriority - bPriority;

                                // If urgency is same, prioritize those with work markers (start/stop)
                                const aHasMarker = aMarker ? 0 : 1;
                                const bHasMarker = bMarker ? 0 : 1;
                                if (aHasMarker !== bHasMarker) return aHasMarker - bHasMarker;

                                // Otherwise preserve original order
                                return 0;
                              });

                              return (
                              <div
                                id={`bucket-group-${group.id}`}
                                key={group.id}
                                style={{
                                  border: selectedBucketNavId === group.id ? "1px solid #2563EB" : "1px solid #D1D5DB",
                                  borderRadius: "10px",
                                  padding: "12px",
                                  backgroundColor: selectedBucketNavId === group.id ? "#EFF6FF" : "#F8FAFC",
                                  scrollMarginTop: "14px",
                                }}
                              >
                              <div style={{ textAlign: "center", marginBottom: "8px" }}>
                                <span style={{ fontSize: "2.5rem", fontWeight: 800, color: "#1D4ED8", lineHeight: 1 }}>
                                  {remainingCount}
                                </span>
                                <div style={{ fontSize: "0.75rem", color: "#6B7280", marginTop: "2px", fontWeight: 600, textTransform: "uppercase" }}>Remaining (Unchecked)</div>
                              </div>
                              <div style={{ border: "1px solid #DBEAFE", borderRadius: "10px", backgroundColor: "#EFF6FF", padding: "9px 10px", display: "grid", gap: "6px", marginBottom: "8px" }}>
                                <div style={{ fontSize: "0.68rem", color: "#1D4ED8", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                                  Bucket Details
                                </div>
                                <div style={{ fontSize: "0.95rem", color: "#0F172A", fontWeight: 800 }}>
                                  {group.name || "Untitled Bucket"}
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                                  <span style={{ fontSize: "0.72rem", backgroundColor: "#DBEAFE", color: "#1E3A8A", borderRadius: "999px", padding: "2px 8px", fontWeight: 700 }}>
                                    Total Issues: {group.issues.length}
                                  </span>
                                  <span style={{ fontSize: "0.72rem", backgroundColor: "#E0E7FF", color: "#3730A3", borderRadius: "999px", padding: "2px 8px", fontWeight: 700 }}>
                                    Associated: {visibleIssues.length}
                                  </span>
                                </div>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                                <button
                                  type="button"
                                  onClick={() => handleSelectBucketNav(group.id)}
                                  style={{
                                    border: "none",
                                    background: "transparent",
                                    padding: 0,
                                    margin: 0,
                                    fontWeight: 700,
                                    fontSize: "1rem",
                                    color: selectedBucketNavId === group.id ? "#1E40AF" : "#111827",
                                    cursor: "pointer",
                                    textAlign: "left",
                                  }}
                                  title="Move this bucket to the top"
                                >
                                  {group.name}
                                </button>
                                <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setShowCompletedByBucketId((previous) => ({
                                        ...previous,
                                        [group.id]: !previous[group.id],
                                      }))
                                    }
                                    title={showCompletedIssues ? "Hide completed" : "Show completed"}
                                    style={{
                                      border: "1px solid #CBD5E1",
                                      borderRadius: "999px",
                                      backgroundColor: showCompletedIssues ? "#DCFCE7" : "#FFFFFF",
                                      color: showCompletedIssues ? "#166534" : "#64748B",
                                      fontSize: "0.72rem",
                                      fontWeight: 700,
                                      padding: "3px 8px",
                                      cursor: "pointer",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "4px",
                                    }}
                                  >
                                    <span style={{ fontSize: "0.8rem", lineHeight: 1 }}>✓</span>
                                    {showCompletedIssues ? "Completed: ON" : "Completed: OFF"}
                                  </button>
                                  <span style={{ fontSize: "0.78rem", backgroundColor: "#E2E8F0", color: "#1E293B", borderRadius: "999px", padding: "2px 8px", fontWeight: 700 }}>
                                    {remainingCount} left
                                  </span>
                                </div>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginBottom: "8px", fontSize: "0.75rem", color: "#64748B", fontWeight: 600 }}>
                                <span>Total: {group.issues.length}</span>
                                <span>Completed: {completedCount}</span>
                              </div>
                              {visibleIssues.length === 0 ? (
                                <div style={{ border: "1px dashed #CBD5E1", borderRadius: "8px", backgroundColor: "#FFFFFF", padding: "10px", color: "#64748B", fontSize: "0.82rem" }}>
                                  {completedCount > 0 && !showCompletedIssues
                                    ? "Completed issues are hidden. Use the check toggle to show them."
                                    : "No issues to display in this bucket."}
                                </div>
                              ) : null}
                              <div style={{ display: "grid", gap: "5px" }}>
                                {sortedVisibleIssues.map((issue) => {
                                  const { bg, text } = statusBadgeColor(issue.status);
                                  const isCompleted = isIssueDoneStatus(issue.status);
                                  const isMovingIssue = movingIssueId === issue.id;
                                  const issueNotes = normalizeIssueNotes(issue.notes);
                                  const hasIssueNotes = issueNotes.length > 0;
                                  const hasManualNotes = hasManualIssueNote(issue.notes);
                                  const notesTooltip = buildIssueNotesTooltip(issueNotes);
                                  const latestIssueNote = issueNotes.length > 0 ? issueNotes[issueNotes.length - 1] : null;
                                  const latestIssueNoteAttachmentCount = getIssueNoteAttachmentCount(latestIssueNote);
                                  const completedAtDate = issue.completedAt?.toDate?.();
                                  const completedAtLabel = completedAtDate
                                    ? completedAtDate.toLocaleString()
                                    : "";
                                  const completedByEmail = String(issue.completedByEmail || "").trim();
                                  const completedByUid = String(issue.completedByUid || "").trim();
                                  const completedByLabel = completedByEmail || completedByUid || "Unknown user";
                                  const completionTooltip = isCompleted
                                    ? [
                                        completedByEmail ? `Completed by: ${completedByEmail}` : completedByUid ? `Completed by UID: ${completedByUid}` : "Completed by: Unknown user",
                                        completedAtLabel ? `Completed at: ${completedAtLabel}` : "Completed at: Pending timestamp",
                                      ].join("\n")
                                    : "Mark as complete";
                                  const issueDueDateValue = getIssueDueDateValue(issue);
                                  const dueDateCountdown = getDueDateCountdownMeta(issueDueDateValue);
                                  const dueDateSetterLabel = getDueDateSetterLabel(issue);
                                  const issueProgress = normalizeIssueProgress(issue.progressPercent);
                                  const progressDraftValue = normalizeIssueProgress(
                                    progressDraftByIssueId[issue.id] === undefined
                                      ? issueProgress
                                      : progressDraftByIssueId[issue.id]
                                  );
                                  const isSavingProgress = !!savingProgressByIssueId[issue.id];
                                  const issueTags = normalizeIssueTags(issue.tags);
                                  const issueDescription = String(issue.description || "").trim();
                                  const issueNumberLabel = issue.issueNumber || issue.id || "-";
                                  const linkedIssues = normalizeLinkedIssues(issue.linkedIssues);
                                  const linkedDraft = String(linkedIssueDraftByIssueId[issue.id] || "");
                                  const isSavingLinked = !!savingLinkedIssuesByIssueId[issue.id];
                                  const tagDraftValue = String(tagDraftByIssueId[issue.id] || "");
                                  const isBulkSelected = selectedBucketIssueIds.includes(issue.id);
                                  const issueSnapshotUrl = getIssueSnapshotUrl(issue);
                                  const issueUrgency = normalizeIssueUrgency(issue.urgencyLevel);
                                  const urgencyColors = getIssueUrgencyColors(issueUrgency);
                                  const issueWorkMarker = normalizeIssueWorkMarker(issue.workMarker);
                                  const workMarkerLabel = issueWorkMarker === "start" ? "START" : issueWorkMarker === "stop" ? "STOP" : "-";
                                  const workMarkerAtIso = String(issue.workMarkerAtIso || "").trim();
                                  const workMarkerAtLabel = workMarkerAtIso ? formatIssueNoteTimestamp(workMarkerAtIso) : "No marker yet";
                                  const workMarkerByLabel = String(issue.workMarkerByName || issue.workMarkerByEmail || issue.workMarkerByUid || "").trim();
                                  return (
                                    <div
                                      key={issue.id}
                                      style={{
                                        border: isCompleted ? "1px solid #BBF7D0" : "1px solid #D7E2F0",
                                        borderRadius: "14px",
                                        padding: "12px",
                                        background: isCompleted
                                          ? "linear-gradient(180deg, #FFFFFF 0%, #F0FDF4 100%)"
                                          : "linear-gradient(180deg, #FFFFFF 0%, #F8FBFF 100%)",
                                        boxShadow: isCompleted
                                          ? "0 12px 24px rgba(34, 197, 94, 0.08)"
                                          : "0 12px 24px rgba(37, 99, 235, 0.08)",
                                        display: "grid",
                                        gap: "10px",
                                      }}
                                      title={isCompleted ? completionTooltip : undefined}
                                      onDoubleClick={(event) => {
                                        const interactiveAncestor = event.target?.closest?.("button, input, select, textarea, label");
                                        if (interactiveAncestor) return;
                                        setMovingIssueId(issue.id);
                                        setMovingIssueBucketId(String(issue.bucketId || ""));
                                      }}
                                    >
                                      <div style={{ display: "grid", gap: "2px" }}>
                                        <div style={{ fontSize: "1.26rem", fontWeight: 900, color: "#0B3B8A", letterSpacing: "0.01em", lineHeight: 1.08 }}>
                                          {`Issue #${issueNumberLabel}`}
                                        </div>
                                        <div style={{ fontSize: "1.02rem", fontWeight: 700, color: "#0F172A", lineHeight: 1.2 }}>
                                          {issue.title || "Untitled issue"}
                                        </div>
                                      </div>
                                      {issueSnapshotUrl ? (
                                        <img
                                          src={issueSnapshotUrl}
                                          alt="Snapshot"
                                          style={{ width: "100%", borderRadius: "8px", objectFit: "cover", maxHeight: "180px", display: "block", cursor: "zoom-in" }}
                                          onClick={() => openSnapshotLightbox(issueSnapshotUrl, `Issue #${issueNumberLabel} Snapshot`)}
                                          onError={(e) => { e.target.style.display = "none"; }}
                                        />
                                      ) : null}
                                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", flexWrap: "wrap" }}>
                                        <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", minWidth: 0, flex: "1 1 320px" }}>
                                          <div style={{ display: "grid", gap: "7px", marginTop: "2px", flexShrink: 0 }}>
                                            {isBulkSelectMode ? (
                                              <label style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "0.66rem", fontWeight: 700, color: isBulkSelected ? "#1D4ED8" : "#64748B", textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer" }}>
                                                <input
                                                  type="checkbox"
                                                  checked={isBulkSelected}
                                                  onChange={(event) => handleToggleBulkIssueSelection(issue.id, event.target.checked)}
                                                  onDoubleClick={(event) => event.stopPropagation()}
                                                  style={{ margin: 0, width: "14px", height: "14px" }}
                                                />
                                                Select
                                              </label>
                                            ) : null}
                                            <label style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "0.66rem", fontWeight: 700, color: isCompleted ? "#166534" : "#64748B", textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer" }}>
                                              <input
                                                type="checkbox"
                                                checked={isCompleted}
                                                onChange={(event) => handleToggleIssueComplete(issue, event.target.checked)}
                                                onDoubleClick={(event) => event.stopPropagation()}
                                                title={completionTooltip}
                                                style={{ margin: 0, width: "14px", height: "14px" }}
                                              />
                                              Done
                                            </label>
                                          </div>
                                          <div style={{ minWidth: 0, display: "grid", gap: "6px", flex: 1 }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                              {isCompleted ? (
                                                <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "#166534", backgroundColor: "#DCFCE7", borderRadius: "999px", padding: "2px 8px" }}>
                                                  Completed
                                                </span>
                                              ) : null}
                                            </div>
                                            {issueDescription ? (
                                              <div style={{ fontSize: "0.78rem", color: "#64748B", lineHeight: 1.5 }}>
                                                {issueDescription}
                                              </div>
                                            ) : null}
                                          </div>
                                        </div>
                                        <button
                                          type="button"
                                          title={isCompleted ? "Click to re-open" : "Click to mark as complete"}
                                          onClick={() => handleToggleIssueComplete(issue, !isCompleted)}
                                          style={{ fontSize: "0.75rem", backgroundColor: bg, color: text, borderRadius: "999px", padding: "5px 10px", fontWeight: 800, alignSelf: "flex-start", border: "none", cursor: "pointer" }}
                                        >
                                          {isCompleted ? "Close" : "Open"}
                                        </button>
                                      </div>
                                      {!hasManualNotes ? (
                                        <div className="issue-note-warning-blink" style={{ fontSize: "0.74rem", color: "#DC2626", fontWeight: 800 }}>
                                          Please Leave a note urgently
                                        </div>
                                      ) : null}
                                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "8px" }}>
                                        <div style={{ display: "grid", gap: "8px", border: "1px solid #E2E8F0", borderRadius: "10px", backgroundColor: "#F8FAFC", padding: "10px" }}>
                                          <div style={{ fontSize: "0.7rem", fontWeight: 800, color: "#475569", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                                            Urgency & Schedule
                                          </div>
                                          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                            <span style={{ fontSize: "0.72rem", color: "#475569", fontWeight: 700 }}>Urgency:</span>
                                            <select
                                              style={{ ...inputStyle, width: "auto", minWidth: "132px", padding: "4px 6px", fontSize: "0.74rem", backgroundColor: urgencyColors.bg, color: urgencyColors.text, fontWeight: 700 }}
                                              value={issueUrgency}
                                              disabled={!!savingUrgencyByIssueId[issue.id]}
                                              onChange={(event) => handleIssueUrgencyChange(issue, event.target.value)}
                                            >
                                              {ISSUE_URGENCY_OPTIONS.map((urgencyOption) => (
                                                <option key={`issue-urgency-${issue.id}-${urgencyOption}`} value={urgencyOption}>{urgencyOption}</option>
                                              ))}
                                            </select>
                                            <span style={{ fontSize: "0.72rem", color: "#475569", fontWeight: 700 }}>Due:</span>
                                            <input
                                              type="date"
                                              style={{ ...inputStyle, width: "auto", minWidth: "146px", padding: "4px 6px", fontSize: "0.75rem" }}
                                              value={issueDueDateValue}
                                              disabled={!!savingDueDateByIssueId[issue.id]}
                                              onChange={(event) => handleIssueDueDateChange(issue, event.target.value)}
                                            />
                                            {dueDateCountdown ? (
                                              <span
                                                style={{
                                                  fontSize: "0.68rem",
                                                  fontWeight: 700,
                                                  backgroundColor: dueDateCountdown.bg,
                                                  color: dueDateCountdown.text,
                                                  borderRadius: "999px",
                                                  padding: "2px 8px",
                                                }}
                                              >
                                                {dueDateCountdown.label}
                                              </span>
                                            ) : null}
                                            {dueDateSetterLabel ? (
                                              <span style={{ fontSize: "0.68rem", color: "#64748B" }}>
                                                Set by: {dueDateSetterLabel}
                                              </span>
                                            ) : null}
                                          </div>
                                        </div>
                                        <div style={{ display: "grid", gap: "6px", border: "1px solid #E2E8F0", borderRadius: "10px", backgroundColor: "#F8FAFC", padding: "10px" }}>
                                          <div style={{ fontSize: "0.7rem", fontWeight: 800, color: "#0F766E", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                                            Progress
                                          </div>
                                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                                            <span style={{ fontSize: "0.72rem", color: "#0F172A", fontWeight: 700 }}>Progress</span>
                                            <span style={{ fontSize: "0.72rem", color: "#0F766E", fontWeight: 800 }}>{progressDraftValue}%</span>
                                          </div>
                                          <input
                                            type="range"
                                            min="0"
                                            max="100"
                                            step="5"
                                            value={progressDraftValue}
                                            disabled={isSavingProgress}
                                            onChange={(event) => {
                                              const nextValue = normalizeIssueProgress(event.target.value);
                                              setProgressDraftByIssueId((previous) => ({ ...previous, [issue.id]: nextValue }));
                                            }}
                                            onMouseUp={(event) => {
                                              handleSaveIssueProgress(issue, event.currentTarget.value, {
                                                showNoChangeToast: false,
                                                showSuccessToast: false,
                                              });
                                            }}
                                            onTouchEnd={(event) => {
                                              handleSaveIssueProgress(issue, event.currentTarget.value, {
                                                showNoChangeToast: false,
                                                showSuccessToast: false,
                                              });
                                            }}
                                          />
                                          {isSavingProgress ? (
                                            <div style={{ fontSize: "0.68rem", color: "#0F766E", fontWeight: 700, textAlign: "right" }}>
                                              Saving...
                                            </div>
                                          ) : null}
                                        </div>
                                      </div>
                                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "8px" }}>
                                      <div style={{ display: "grid", gap: "8px", border: "1px solid #E2E8F0", borderRadius: "10px", backgroundColor: "#FFF7ED", padding: "10px" }}>
                                        <div style={{ fontSize: "0.7rem", fontWeight: 800, color: "#9A3412", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                                          Linked Issues
                                        </div>
                                        {linkedIssues.length > 0 ? (
                                          <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", alignItems: "center" }}>
                                            {linkedIssues.map((li) => {
                                              const linkedTarget = issues.find((i) => i.id === li.issueId || String(i.issueNumber || "").trim().toLowerCase() === li.issueNumber.toLowerCase());
                                              return (
                                                <span key={`${issue.id}-linked-${li.issueNumber}`} style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "0.7rem", backgroundColor: "#FEF3C7", color: "#92400E", borderRadius: "999px", padding: "3px 9px", fontWeight: 700 }}>
                                                  <button
                                                    type="button"
                                                    onClick={() => setCompareModalBaseIssueId(issue.id)}
                                                    style={{ border: "none", background: "transparent", color: "#92400E", cursor: "pointer", fontWeight: 700, fontSize: "0.7rem", padding: 0, textDecoration: "underline dotted" }}
                                                    title="View side-by-side"
                                                  >#{li.issueNumber}{linkedTarget?.title ? ` - ${linkedTarget.title}` : ""}</button>
                                                  <button
                                                    type="button"
                                                    onClick={() => handleRemoveLinkedIssue(issue, li.issueNumber)}
                                                    disabled={isSavingLinked}
                                                    style={{ border: "none", background: "transparent", color: "#B45309", cursor: "pointer", fontSize: "0.75rem", padding: 0, lineHeight: 1 }}
                                                    title="Unlink"
                                                  >x</button>
                                                </span>
                                              );
                                            })}
                                          </div>
                                        ) : (
                                          <span style={{ fontSize: "0.72rem", color: "#9CA3AF" }}>No linked issues yet.</span>
                                        )}
                                        <div style={{ display: "grid", gap: "4px" }}>
                                          <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                                            <input
                                              style={{ ...inputStyle, width: "auto", minWidth: "130px", padding: "4px 6px", fontSize: "0.72rem" }}
                                              placeholder="Link issue #"
                                              value={linkedDraft}
                                              disabled={isSavingLinked}
                                              onChange={(event) => setLinkedIssueDraftByIssueId((prev) => ({ ...prev, [issue.id]: event.target.value }))}
                                              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); handleAddLinkedIssue(issue); } }}
                                            />
                                            <button
                                              type="button"
                                              style={{ ...buttonBaseStyle, backgroundColor: "#D97706", fontSize: "0.68rem", padding: "4px 8px" }}
                                              disabled={isSavingLinked}
                                              onClick={() => handleAddLinkedIssue(issue)}
                                            >Link Issue</button>
                                          </div>
                                          {(() => {
                                            const draftNum = linkedDraft.replace(/^#/, "").trim();
                                            if (!draftNum) return null;
                                            const alreadyLinked = linkedIssues.some(
                                              (li) => li.issueNumber.toLowerCase() === draftNum.toLowerCase()
                                            );
                                            if (alreadyLinked) {
                                              return (
                                                <span style={{ fontSize: "0.68rem", color: "#B45309", fontWeight: 600 }}>
                                                  Already linked
                                                </span>
                                              );
                                            }
                                            const match = issues.find(
                                              (i) => String(i.issueNumber || "").trim().toLowerCase() === draftNum.toLowerCase()
                                            );
                                            if (match) {
                                              return (
                                                <span style={{ fontSize: "0.68rem", color: "#166534", fontWeight: 600 }}>
                                                  Match found: #{match.issueNumber}{match.title ? ` - ${match.title}` : ""}
                                                </span>
                                              );
                                            }
                                            return (
                                              <span style={{ fontSize: "0.68rem", color: "#DC2626", fontWeight: 600 }}>
                                                Issue not found
                                              </span>
                                            );
                                          })()}
                                        </div>
                                      </div>
                                      <div style={{ display: "grid", gap: "8px", border: "1px solid #E0E7FF", borderRadius: "10px", backgroundColor: "#F8FAFF", padding: "10px" }}>
                                        <div style={{ fontSize: "0.7rem", fontWeight: 800, color: "#3730A3", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                                          Tags
                                        </div>
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                                          {issueTags.length === 0 ? (
                                            <span style={{ fontSize: "0.7rem", color: "#94A3B8" }}>No tags</span>
                                          ) : issueTags.map((tag) => (
                                            <span key={`${issue.id}-bucket-tag-${tag}`} style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "0.68rem", backgroundColor: "#E0E7FF", color: "#312E81", borderRadius: "999px", padding: "3px 8px", fontWeight: 700 }}>
                                              <span>{tag}</span>
                                              <button
                                                type="button"
                                                onClick={() => handleEditIssueTag(issue, tag)}
                                                disabled={!!savingTagsByIssueId[issue.id]}
                                                style={{ border: "none", background: "transparent", color: "#3730A3", cursor: "pointer", fontSize: "0.62rem", padding: 0 }}
                                                title="Edit tag"
                                              >
                                                Edit
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => handleRemoveIssueTag(issue, tag)}
                                                disabled={!!savingTagsByIssueId[issue.id]}
                                                style={{ border: "none", background: "transparent", color: "#4338CA", cursor: "pointer", fontSize: "0.72rem", padding: 0, lineHeight: 1 }}
                                                title="Remove tag"
                                              >
                                                x
                                              </button>
                                            </span>
                                          ))}
                                        </div>
                                        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                                          <input
                                            style={{ ...inputStyle, width: "auto", minWidth: "140px", padding: "4px 6px", fontSize: "0.72rem" }}
                                            placeholder="Add tag"
                                            value={tagDraftValue}
                                            disabled={!!savingTagsByIssueId[issue.id]}
                                            onChange={(event) => setTagDraftByIssueId((previous) => ({ ...previous, [issue.id]: event.target.value }))}
                                            onKeyDown={(event) => {
                                              if (event.key === "Enter") {
                                                event.preventDefault();
                                                handleAddIssueTag(issue);
                                              }
                                            }}
                                          />
                                          <button
                                            type="button"
                                            style={{ ...buttonBaseStyle, backgroundColor: "#4F46E5", fontSize: "0.68rem", padding: "4px 8px" }}
                                            disabled={!!savingTagsByIssueId[issue.id]}
                                            onClick={() => handleAddIssueTag(issue)}
                                          >
                                            Add Tag
                                          </button>
                                        </div>
                                      </div>
                                      </div>
                                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", flexWrap: "wrap" }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setMovingIssueId(issue.id);
                                              setMovingIssueBucketId(String(issue.bucketId || ""));
                                            }}
                                            title="Move this issue"
                                            style={{
                                              border: "1px solid #C7D2FE",
                                              borderRadius: "999px",
                                              padding: "4px 10px",
                                              fontSize: "0.72rem",
                                              lineHeight: 1.2,
                                              color: "#3730A3",
                                              backgroundColor: "#EEF2FF",
                                              cursor: "pointer",
                                              fontWeight: 700,
                                            }}
                                          >
                                            Move
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handleEmailIssue(issue, group.name)}
                                            title="Email this issue"
                                            style={{
                                              border: "1px solid #BFDBFE",
                                              borderRadius: "999px",
                                              padding: "4px 10px",
                                              fontSize: "0.72rem",
                                              lineHeight: 1.2,
                                              color: "#1D4ED8",
                                              backgroundColor: "#EFF6FF",
                                              cursor: "pointer",
                                              fontWeight: 700,
                                            }}
                                          >
                                            Email
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => openIssueNotesModal(issue)}
                                            title="Add note"
                                            style={{
                                              border: "1px solid #CBD5E1",
                                              borderRadius: "999px",
                                              padding: "4px 10px",
                                              minWidth: "72px",
                                              fontSize: "0.72rem",
                                              fontWeight: 700,
                                              color: "#334155",
                                              backgroundColor: "#F8FAFC",
                                              cursor: "pointer",
                                              lineHeight: 1.2,
                                            }}
                                          >
                                            Add Note
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => openIssueNotesModal(issue)}
                                            title={hasIssueNotes ? notesTooltip : "No notes yet. Click to view and add."}
                                            style={{
                                              border: "1px solid #CBD5E1",
                                              borderRadius: "999px",
                                              padding: "2px 8px",
                                              fontSize: "0.72rem",
                                              fontWeight: 700,
                                              color: hasIssueNotes ? "#1E3A8A" : "#475569",
                                              backgroundColor: hasIssueNotes ? "#EFF6FF" : "#F8FAFC",
                                              cursor: "pointer",
                                              lineHeight: 1.2,
                                            }}
                                          >
                                            {`View Notes (${issueNotes.length})`}
                                          </button>
                                        </div>
                                        {latestIssueNote ? (
                                          <div
                                            title={notesTooltip}
                                            style={{ fontSize: "0.72rem", color: "#475569", lineHeight: 1.45, textAlign: "right", maxWidth: "260px" }}
                                          >
                                            <div style={{ fontWeight: 700, color: "#1E293B" }}>Latest note</div>
                                            <div>
                                              {getIssueNoteAuthorLabel(latestIssueNote)}
                                              {latestIssueNoteAttachmentCount > 0
                                                ? ` (${latestIssueNoteAttachmentCount} file${latestIssueNoteAttachmentCount === 1 ? "" : "s"})`
                                                : ""}
                                            </div>
                                          </div>
                                        ) : (
                                          <span style={{ fontSize: "0.72rem", color: "#94A3B8" }}>No notes yet</span>
                                        )}
                                      </div>
                                      {latestIssueNote ? (
                                        <div style={{ padding: "8px 10px", backgroundColor: "#F1F5F9", borderRadius: "10px", borderLeft: "4px solid #94A3B8" }}>
                                          <div style={{ fontSize: "0.68rem", color: "#64748B", fontWeight: 600, marginBottom: "2px" }}>
                                            {getIssueNoteAuthorLabel(latestIssueNote)} · {formatIssueNoteTimestamp(latestIssueNote.createdAtIso)}
                                          </div>
                                          <div style={{ fontSize: "0.75rem", color: "#1E293B", lineHeight: 1.45 }}>
                                            {latestIssueNote.text || "[Attachment only]"}
                                          </div>
                                          {latestIssueNoteAttachmentCount > 0 ? (
                                            <div style={{ marginTop: "4px", fontSize: "0.68rem", color: "#475569", fontWeight: 600 }}>
                                              {latestIssueNoteAttachmentCount} file{latestIssueNoteAttachmentCount === 1 ? "" : "s"} attached
                                            </div>
                                          ) : null}
                                        </div>
                                      ) : null}
                                      {isMovingIssue ? (
                                        <div style={{ marginTop: "6px", border: "1px solid #BFDBFE", borderRadius: "8px", backgroundColor: "#EFF6FF", padding: "8px" }}>
                                          <div style={{ fontSize: "0.72rem", color: "#1D4ED8", fontWeight: 700, marginBottom: "6px" }}>
                                            Move issue to another bucket
                                          </div>
                                          <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                                            <select
                                              style={{ ...inputStyle, fontSize: "0.78rem", padding: "6px 8px" }}
                                              value={movingIssueBucketId}
                                              onChange={(event) => setMovingIssueBucketId(event.target.value)}
                                            >
                                              <option value="">— No Bucket —</option>
                                              {buckets.map((bucketOption) => (
                                                <option key={`move-issue-${issue.id}-${bucketOption.id}`} value={bucketOption.id}>
                                                  {bucketOption.name || "Untitled Bucket"}
                                                </option>
                                              ))}
                                            </select>
                                            <button
                                              type="button"
                                              style={{ ...buttonBaseStyle, backgroundColor: "#2563EB", fontSize: "0.72rem", padding: "4px 8px" }}
                                              onClick={() => handleMoveIssueToBucket(issue)}
                                            >
                                              Save
                                            </button>
                                            <button
                                              type="button"
                                              style={{ ...buttonBaseStyle, backgroundColor: "#64748B", fontSize: "0.72rem", padding: "4px 8px" }}
                                              onClick={() => {
                                                setMovingIssueId("");
                                                setMovingIssueBucketId("");
                                              }}
                                            >
                                              Cancel
                                            </button>
                                          </div>
                                        </div>
                                      ) : null}
                                      {isCompleted ? (
                                        <div style={{ marginTop: "4px", fontSize: "0.74rem", color: "#166534", lineHeight: 1.35 }}>
                                          Completed by: {completedByLabel}
                                          <br />
                                          Completed at: {completedAtLabel || "Pending timestamp"}
                                        </div>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                              </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </>
          )}

          {/* ── FOCUS TAB ── */}
          {activeTab === "focus" && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", gap: "10px", flexWrap: "wrap" }}>
                <h2 style={{ margin: 0 }}>Focus View</h2>
                <span style={{ fontSize: "0.82rem", backgroundColor: "#E0E7FF", color: "#3730A3", borderRadius: "999px", padding: "5px 10px", fontWeight: 700 }}>
                  {focusIssues.length === 0 ? "0 issues" : `${Math.min(focusIssueIndex + 1, focusIssues.length)} of ${focusIssues.length}`}
                </span>
              </div>

              {focusIssues.length === 0 || !currentFocusIssue ? (
                <div style={{ border: "1px dashed #CBD5E1", borderRadius: "10px", backgroundColor: "#F8FAFC", padding: "14px", color: "#64748B" }}>
                  No open issues found in the Ready to Assign bucket.
                </div>
              ) : (
                <>
                  <div style={{ fontSize: "0.76rem", color: "#64748B", fontWeight: 700, marginBottom: "10px" }}>
                    Swipe left/right on the snapshot, or use the side navigation buttons.
                  </div>

                  <div
                    style={{
                      marginBottom: "10px",
                      borderRadius: "10px",
                      padding: "8px 10px",
                      fontSize: "0.78rem",
                      fontWeight: 700,
                      backgroundColor: "#DBEAFE",
                      color: "#1E40AF",
                    }}
                  >
                    No required fields. You can continue anytime.
                  </div>

                  {(() => {
                    const focusIssue = currentFocusIssue;
                    const focusBucket = buckets.find((bucket) => bucket.id === focusIssue.bucketId);
                    const focusTags = normalizeIssueTags(focusIssue.tags);
                    const focusTagDraft = tagDraftByIssueId[focusIssue.id] || "";
                    const focusDueDate = getIssueDueDateValue(focusIssue);
                    const focusDueCountdown = getDueDateCountdownMeta(focusDueDate);
                    const focusIsCompleted = isIssueDoneStatus(focusIssue.status);
                    const focusStatusMeta = statusBadgeColor(focusIssue.status);
                    const focusIssueNotes = normalizeIssueNotes(focusIssue.notes);
                    const focusSavedLocalNoteCount = Number(focusSavedNoteCountByIssueId[focusIssue.id] || 0);
                    const focusVisibleNoteCount = focusIssueNotes.length > 0 ? focusIssueNotes.length : focusSavedLocalNoteCount;
                    const focusRecentAddedNoteText = String(focusRecentAddedNoteTextByIssueId[focusIssue.id] || "").trim();
                    const focusPreviewNotes = focusIssueNotes.slice(0, 3);
                    const focusIssueSnapshotUrl = getIssueSnapshotUrl(focusIssue)
                      || (
                        focusIssueNotes
                          .flatMap((note) => normalizeIssueNoteAttachments(note.attachments))
                          .find((attachment) => isAttachmentImage(attachment))?.url
                        || ""
                      );

                    return (
                      <div
                        onTouchStart={handleFocusTouchStart}
                        onTouchEnd={handleFocusTouchEnd}
                        style={{ border: "1px solid #E2E8F0", borderRadius: "14px", backgroundColor: "#FFFFFF", boxShadow: "0 10px 22px rgba(15, 23, 42, 0.07)", padding: "14px", display: "grid", gap: "12px" }}
                      >
                        <div style={{ display: "grid", gridTemplateColumns: "56px minmax(0, 1fr) 56px", gap: "8px", alignItems: "stretch" }}>
                          <button
                            type="button"
                            style={{ ...buttonBaseStyle, backgroundColor: "#64748B", height: "100%", minHeight: "100%", writingMode: "vertical-rl", textOrientation: "mixed", padding: "10px 6px" }}
                            onClick={() => handleFocusMove(-1)}
                            title="Previous issue"
                          >
                            Prev
                          </button>

                          <div style={{ border: "1px solid #DBEAFE", background: "linear-gradient(180deg, #EFF6FF 0%, #FFFFFF 100%)", borderRadius: "12px", padding: "12px", display: "grid", gap: "9px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", flexWrap: "wrap" }}>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: "0.8rem", color: "#64748B", fontWeight: 700 }}>{focusIssue.groupName || "Bucket"}</div>
                                <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "#0F172A", lineHeight: 1.25 }}>Issue #{focusIssue.issueNumber || focusIssue.id}</div>
                                <div style={{ fontSize: "0.95rem", color: "#334155", fontWeight: 600, marginTop: "2px" }}>{focusIssue.title || "Untitled issue"}</div>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                <span style={{ fontSize: "0.74rem", backgroundColor: focusStatusMeta.bg, color: focusStatusMeta.text, borderRadius: "999px", padding: "3px 10px", fontWeight: 700 }}>
                                  {focusIssue.status || "Open"}
                                </span>
                                <button
                                  type="button"
                                  style={{ ...buttonBaseStyle, backgroundColor: focusIsCompleted ? "#6B7280" : "#059669", fontSize: "0.74rem", padding: "4px 9px" }}
                                  onClick={() => handleToggleIssueComplete(focusIssue, !focusIsCompleted)}
                                >
                                  {focusIsCompleted ? "Re-open" : "Complete"}
                                </button>
                              </div>
                            </div>

                            {focusIssueSnapshotUrl ? (
                              <img
                                src={focusIssueSnapshotUrl}
                                alt="Issue snapshot"
                                style={{ width: "100%", borderRadius: "10px", objectFit: "cover", maxHeight: "320px", display: "block", cursor: "zoom-in", border: "1px solid #BFDBFE" }}
                                onClick={() => openSnapshotLightbox(focusIssueSnapshotUrl, `Issue #${focusIssue.issueNumber || focusIssue.id || ""} Snapshot`)}
                                onError={(event) => {
                                  event.currentTarget.style.display = "none";
                                }}
                              />
                            ) : (
                              <div style={{ border: "1px dashed #BFDBFE", borderRadius: "10px", padding: "10px", fontSize: "0.74rem", color: "#64748B", backgroundColor: "#F8FAFC" }}>
                                No snapshot image on this issue.
                              </div>
                            )}

                            {focusIssue.description ? (
                              <div style={{ fontSize: "0.86rem", color: "#475569", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                                {focusIssue.description}
                              </div>
                            ) : null}
                          </div>

                          <button
                            type="button"
                            style={{
                              ...buttonBaseStyle,
                              backgroundColor: "#2563EB",
                              height: "100%",
                              minHeight: "100%",
                              writingMode: "vertical-rl",
                              textOrientation: "mixed",
                              padding: "10px 6px",
                              cursor: "pointer",
                            }}
                            onClick={() => handleFocusMove(1)}
                            title="Next issue"
                          >
                            Next
                          </button>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px" }}>
                          <div style={{ display: "grid", gap: "6px" }}>
                            <label style={{ fontSize: "0.76rem", color: "#334155", fontWeight: 700 }}>Bucket</label>
                            <select
                              style={inputStyle}
                              value={focusIssue.bucketId || ""}
                              disabled={!!savingBucketByIssueId[focusIssue.id]}
                              onChange={(event) => handleInlineBucketChange(focusIssue, event.target.value)}
                            >
                              {buckets.map((bucketOption) => (
                                <option key={`focus-bucket-${bucketOption.id}`} value={bucketOption.id}>{bucketOption.name || "Untitled Bucket"}</option>
                              ))}
                            </select>
                            <span style={{ fontSize: "0.72rem", color: "#64748B" }}>
                              Current: {focusBucket?.name || focusIssue.bucketName || "No bucket"}
                            </span>
                          </div>

                          <div style={{ display: "grid", gap: "6px" }}>
                            <label style={{ fontSize: "0.76rem", color: "#334155", fontWeight: 700 }}>
                              Due date (optional)
                            </label>
                            <input
                              type="date"
                              style={inputStyle}
                              value={focusDueDate}
                              disabled={!!savingDueDateByIssueId[focusIssue.id]}
                              onChange={(event) => handleIssueDueDateChange(focusIssue, event.target.value)}
                            />
                            {focusDueCountdown ? (
                              <span style={{ fontSize: "0.7rem", fontWeight: 700, backgroundColor: focusDueCountdown.bg, color: focusDueCountdown.text, borderRadius: "999px", padding: "2px 8px", width: "fit-content" }}>
                                {focusDueCountdown.label}
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <div style={{ display: "grid", gap: "7px" }}>
                          <label style={{ fontSize: "0.76rem", color: "#334155", fontWeight: 700 }}>Tags</label>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                            {focusTags.length === 0 ? (
                              <span style={{ fontSize: "0.72rem", color: "#94A3B8" }}>No tags</span>
                            ) : focusTags.map((tag) => (
                              <span key={`focus-tag-${focusIssue.id}-${tag}`} style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "0.72rem", backgroundColor: "#E0E7FF", color: "#312E81", borderRadius: "999px", padding: "3px 8px", fontWeight: 700 }}>
                                <span>{tag}</span>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveIssueTag(focusIssue, tag)}
                                  disabled={!!savingTagsByIssueId[focusIssue.id]}
                                  style={{ border: "none", background: "transparent", color: "#4338CA", cursor: "pointer", fontSize: "0.78rem", padding: 0, lineHeight: 1 }}
                                  title="Remove tag"
                                >
                                  x
                                </button>
                              </span>
                            ))}
                          </div>
                          <div style={{ display: "flex", gap: "6px" }}>
                            <input
                              style={inputStyle}
                              placeholder="Add tag"
                              value={focusTagDraft}
                              disabled={!!savingTagsByIssueId[focusIssue.id]}
                              onChange={(event) => setTagDraftByIssueId((previous) => ({ ...previous, [focusIssue.id]: event.target.value }))}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  handleAddIssueTag(focusIssue);
                                }
                              }}
                            />
                            <button
                              type="button"
                              style={{ ...buttonBaseStyle, backgroundColor: "#4F46E5" }}
                              disabled={!!savingTagsByIssueId[focusIssue.id]}
                              onClick={() => handleAddIssueTag(focusIssue)}
                            >
                              Add
                            </button>
                          </div>
                        </div>

                        <div style={{ display: "grid", gap: "7px" }}>
                          <label style={{ fontSize: "0.76rem", color: "#334155", fontWeight: 700 }}>Quick note</label>
                          <textarea
                            style={{ ...textareaStyle, minHeight: "86px" }}
                            value={focusNoteDraft}
                            onChange={(event) => setFocusNoteDraft(event.target.value)}
                            placeholder="Add a note to this issue"
                          />
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                            <span style={{ fontSize: "0.72rem", color: "#64748B" }}>
                              {focusVisibleNoteCount} note{focusVisibleNoteCount === 1 ? "" : "s"} on this issue
                            </span>
                            <button
                              type="button"
                              style={{ ...buttonBaseStyle, backgroundColor: "#0F766E" }}
                              onClick={handleAddFocusIssueNote}
                            >
                              Add Note
                            </button>
                          </div>

                          {focusPreviewNotes.length > 0 ? (
                            <div style={{ display: "grid", gap: "6px" }}>
                              {focusPreviewNotes.map((note, index) => (
                                <div key={`focus-note-preview-${focusIssue.id}-${note.createdAtIso || index}`} style={{ border: "1px solid #E2E8F0", borderRadius: "8px", backgroundColor: "#F8FAFC", padding: "7px 8px" }}>
                                  <div style={{ fontSize: "0.68rem", color: "#64748B", marginBottom: "3px" }}>
                                    {getIssueNoteAuthorLabel(note)} - {formatIssueNoteTimestamp(note.createdAtIso)}
                                  </div>
                                  <div style={{ fontSize: "0.76rem", color: "#1E293B", lineHeight: 1.35, whiteSpace: "pre-wrap" }}>
                                    {String(note.text || "").trim() || "[Attachment only]"}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : focusRecentAddedNoteText ? (
                            <div style={{ border: "1px solid #99F6E4", borderRadius: "8px", backgroundColor: "#F0FDFA", padding: "7px 8px" }}>
                              <div style={{ fontSize: "0.68rem", color: "#0F766E", marginBottom: "3px", fontWeight: 700 }}>
                                Saved just now
                              </div>
                              <div style={{ fontSize: "0.76rem", color: "#134E4A", lineHeight: 1.35, whiteSpace: "pre-wrap" }}>
                                {focusRecentAddedNoteText}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}
            </>
          )}

          {/* ── PROGRESS TAB ── */}
          {activeTab === "progress" && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "10px" }}>
                <h2 style={{ margin: 0 }}>Progress</h2>
                <span style={{ fontSize: "0.82rem", backgroundColor: "#E0E7FF", color: "#3730A3", borderRadius: "999px", padding: "5px 10px", fontWeight: 700 }}>
                  {filteredProgressActivityRows.length} activity log{filteredProgressActivityRows.length === 1 ? "" : "s"}
                </span>
              </div>

              <div style={{ display: "grid", gap: "8px", marginBottom: "12px" }}>
                <label style={{ fontSize: "0.84rem", color: "#334155", fontWeight: 700 }}>
                  Filter by Projects (multi-select)
                </label>
                <select
                  multiple
                  value={progressTabSelectedProjectIds}
                  onChange={(event) => {
                    const selectedValues = Array.from(event.target.selectedOptions).map((option) => option.value);
                    setProgressTabSelectedProjectIds(selectedValues);
                  }}
                  style={{
                    ...inputStyle,
                    minHeight: "110px",
                    padding: "8px 10px",
                  }}
                >
                  {progressProjectOptions.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name || "Untitled Project"}
                    </option>
                  ))}
                </select>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "0.78rem", color: "#64748B" }}>
                    {progressTabSelectedProjectIds.length > 0
                      ? `Showing ${effectiveProgressProjectIds.length} selected project${effectiveProgressProjectIds.length === 1 ? "" : "s"}`
                      : selectedProjectId
                        ? "No explicit filter selected. Using the currently selected project."
                        : "Select one or more projects to view progress activity."}
                  </span>
                  {progressTabSelectedProjectIds.length > 0 ? (
                    <button
                      type="button"
                      style={{ ...buttonBaseStyle, backgroundColor: "#64748B", padding: "6px 10px", fontSize: "0.74rem" }}
                      onClick={() => setProgressTabSelectedProjectIds([])}
                    >
                      Clear Project Filter
                    </button>
                  ) : null}
                </div>
              </div>

              <div style={{ display: "grid", gap: "8px", marginBottom: "12px" }}>
                <label style={{ fontSize: "0.84rem", color: "#334155", fontWeight: 700 }}>
                  Filter by Date
                </label>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    type="date"
                    style={{ ...inputStyle, maxWidth: "190px", padding: "8px 10px" }}
                    value={progressDateFrom}
                    onChange={(event) => setProgressDateFrom(event.target.value)}
                  />
                  <span style={{ fontSize: "0.8rem", color: "#64748B", fontWeight: 700 }}>to</span>
                  <input
                    type="date"
                    style={{ ...inputStyle, maxWidth: "190px", padding: "8px 10px" }}
                    value={progressDateTo}
                    onChange={(event) => setProgressDateTo(event.target.value)}
                  />
                  <button
                    type="button"
                    style={{ ...buttonBaseStyle, backgroundColor: "#2563EB", padding: "6px 10px", fontSize: "0.74rem" }}
                    onClick={() => {
                      const today = getCurrentDateKey();
                      setProgressDateFrom(today);
                      setProgressDateTo(today);
                    }}
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    style={{ ...buttonBaseStyle, backgroundColor: "#B45309", padding: "6px 10px", fontSize: "0.74rem" }}
                    onClick={() => {
                      const yesterdayDate = new Date();
                      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
                      const yesterdayKey = getDateKeyFromDate(yesterdayDate);
                      setProgressDateFrom(yesterdayKey);
                      setProgressDateTo(yesterdayKey);
                    }}
                  >
                    Yesterday
                  </button>
                  <button
                    type="button"
                    style={{ ...buttonBaseStyle, backgroundColor: "#0F766E", padding: "6px 10px", fontSize: "0.74rem" }}
                    onClick={() => {
                      const now = new Date();
                      const toKey = getDateKeyFromDate(now);
                      const fromDate = new Date(now);
                      fromDate.setDate(now.getDate() - 6);
                      const fromKey = getDateKeyFromDate(fromDate);
                      setProgressDateFrom(fromKey);
                      setProgressDateTo(toKey);
                    }}
                  >
                    Last 7 Days
                  </button>
                  <button
                    type="button"
                    style={{ ...buttonBaseStyle, backgroundColor: "#64748B", padding: "6px 10px", fontSize: "0.74rem" }}
                    onClick={() => {
                      setProgressDateFrom("");
                      setProgressDateTo("");
                    }}
                  >
                    All Dates
                  </button>
                </div>
                <span style={{ fontSize: "0.78rem", color: "#64748B", fontWeight: 600 }}>
                  {progressDateFilterLabel}
                </span>
              </div>

              <div style={{ border: "1px solid #E2E8F0", borderRadius: "10px", backgroundColor: "#F8FAFC", padding: "12px", marginBottom: "12px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "8px", marginBottom: "10px" }}>
                  <div style={{ backgroundColor: "#FFFFFF", border: "1px solid #DCFCE7", borderRadius: "8px", padding: "10px" }}>
                    <div style={{ fontSize: "0.72rem", textTransform: "uppercase", color: "#166534", fontWeight: 700 }}>Completed in Date Filter</div>
                    <div style={{ fontSize: "1.55rem", color: "#166534", fontWeight: 800, lineHeight: 1.15 }}>
                      {completedIssuesInRangeRows.length}
                    </div>
                  </div>
                  <div style={{ backgroundColor: "#FFFFFF", border: "1px solid #DBEAFE", borderRadius: "8px", padding: "10px" }}>
                    <div style={{ fontSize: "0.72rem", textTransform: "uppercase", color: "#1E40AF", fontWeight: 700 }}>Projects With Completes</div>
                    <div style={{ fontSize: "1.55rem", color: "#1E3A8A", fontWeight: 800, lineHeight: 1.15 }}>
                      {completedInRangeProjectTotals.length}
                    </div>
                  </div>
                  <div style={{ backgroundColor: "#FFFFFF", border: "1px solid #E9D5FF", borderRadius: "8px", padding: "10px" }}>
                    <div style={{ fontSize: "0.72rem", textTransform: "uppercase", color: "#6B21A8", fontWeight: 700 }}>Users With Completes</div>
                    <div style={{ fontSize: "1.55rem", color: "#581C87", fontWeight: 800, lineHeight: 1.15 }}>
                      {completedInRangeUserTotals.length}
                    </div>
                  </div>
                  <div style={{ backgroundColor: "#FFFFFF", border: "1px solid #FDE68A", borderRadius: "8px", padding: "10px" }}>
                    <div style={{ fontSize: "0.72rem", textTransform: "uppercase", color: "#92400E", fontWeight: 700 }}>Avg Time Between Issues</div>
                    <div style={{ fontSize: "1.2rem", color: "#78350F", fontWeight: 800, lineHeight: 1.15 }}>
                      {formatMinutesToDurationLabel(completionTimingInRange.averageGapMinutes)}
                    </div>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "10px" }}>
                  <div style={{ backgroundColor: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: "8px", padding: "10px" }}>
                    <div style={{ fontSize: "0.78rem", textTransform: "uppercase", color: "#334155", fontWeight: 700, marginBottom: "8px" }}>
                      Completed by Project
                    </div>
                    {completedInRangeProjectTotals.length === 0 ? (
                      <div style={{ fontSize: "0.82rem", color: "#64748B" }}>No completed issues in the selected date filter.</div>
                    ) : (
                      <div style={{ maxHeight: "190px", overflowY: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                          <thead>
                            <tr style={{ borderBottom: "1px solid #E2E8F0" }}>
                              <th style={{ textAlign: "left", padding: "6px 4px", fontSize: "0.72rem", color: "#64748B", textTransform: "uppercase" }}>Project</th>
                              <th style={{ textAlign: "right", padding: "6px 4px", fontSize: "0.72rem", color: "#64748B", textTransform: "uppercase" }}>Completed</th>
                            </tr>
                          </thead>
                          <tbody>
                            {completedInRangeProjectTotals.map((entry) => (
                              <tr key={`completed-project-${entry.projectId}`} style={{ borderTop: "1px solid #F1F5F9" }}>
                                <td style={{ padding: "6px 4px", fontSize: "0.83rem", color: "#0F172A", fontWeight: 600 }}>{entry.projectName}</td>
                                <td style={{ padding: "6px 4px", fontSize: "0.83rem", color: "#166534", fontWeight: 800, textAlign: "right" }}>{entry.completedCount}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div style={{ backgroundColor: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: "8px", padding: "10px" }}>
                    <div style={{ fontSize: "0.78rem", textTransform: "uppercase", color: "#334155", fontWeight: 700, marginBottom: "8px" }}>
                      Completed by User
                    </div>
                    {completedInRangeUserTotals.length === 0 ? (
                      <div style={{ fontSize: "0.82rem", color: "#64748B" }}>No user completion data in the selected date filter.</div>
                    ) : (
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid #E2E8F0" }}>
                            <th style={{ textAlign: "left", padding: "6px 4px", fontSize: "0.72rem", color: "#64748B", textTransform: "uppercase" }}>User</th>
                            <th style={{ textAlign: "right", padding: "6px 4px", fontSize: "0.72rem", color: "#64748B", textTransform: "uppercase" }}>Completed</th>
                            <th style={{ textAlign: "right", padding: "6px 4px", fontSize: "0.72rem", color: "#64748B", textTransform: "uppercase" }}>Projects</th>
                            <th style={{ textAlign: "right", padding: "6px 4px", fontSize: "0.72rem", color: "#64748B", textTransform: "uppercase" }}>Avg Gap</th>
                          </tr>
                        </thead>
                        <tbody>
                          {completedInRangeUserTotals.map((entry) => (
                            <tr key={`completed-user-${entry.userLabel}`} style={{ borderTop: "1px solid #F1F5F9" }}>
                              <td style={{ padding: "6px 4px", fontSize: "0.83rem", color: "#0F172A", fontWeight: 600, maxWidth: "150px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={entry.userLabel}>{entry.userLabel}</td>
                              <td style={{ padding: "6px 4px", fontSize: "0.83rem", color: "#1E3A8A", fontWeight: 800, textAlign: "right" }}>{entry.completedCount}</td>
                              <td style={{ padding: "6px 4px", fontSize: "0.83rem", color: "#334155", fontWeight: 700, textAlign: "right" }}>{entry.projectCount}</td>
                              <td style={{ padding: "6px 4px", fontSize: "0.83rem", color: "#78350F", fontWeight: 700, textAlign: "right" }}>{formatMinutesToDurationLabel(entry.averageGapMinutes)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  <div style={{ backgroundColor: "#FFFFFF", border: "1px solid #D1FAE5", borderRadius: "8px", padding: "10px" }}>
                    <div style={{ fontSize: "0.78rem", textTransform: "uppercase", color: "#065F46", fontWeight: 700, marginBottom: "8px" }}>
                      Collaborated to Close
                    </div>
                    {collaboratorsByUser.length === 0 ? (
                      <div style={{ fontSize: "0.82rem", color: "#64748B" }}>No collaboration notes found for completed issues.</div>
                    ) : (
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid #D1FAE5" }}>
                            <th style={{ textAlign: "left", padding: "6px 4px", fontSize: "0.72rem", color: "#64748B", textTransform: "uppercase" }}>User</th>
                            <th style={{ textAlign: "right", padding: "6px 4px", fontSize: "0.72rem", color: "#64748B", textTransform: "uppercase" }}>Issues</th>
                            <th style={{ textAlign: "right", padding: "6px 4px", fontSize: "0.72rem", color: "#64748B", textTransform: "uppercase" }}>Projects</th>
                          </tr>
                        </thead>
                        <tbody>
                          {collaboratorsByUser.map((entry) => (
                            <tr key={`collab-user-${entry.userLabel}`} style={{ borderTop: "1px solid #ECFDF5" }}>
                              <td style={{ padding: "6px 4px", fontSize: "0.83rem", color: "#0F172A", fontWeight: 600, maxWidth: "150px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={entry.userLabel}>{entry.userLabel}</td>
                              <td style={{ padding: "6px 4px", fontSize: "0.83rem", color: "#065F46", fontWeight: 800, textAlign: "right" }}>{entry.issueCount}</td>
                              <td style={{ padding: "6px 4px", fontSize: "0.83rem", color: "#334155", fontWeight: 700, textAlign: "right" }}>{entry.projectCount}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginTop: "10px", fontSize: "0.78rem", color: "#475569", fontWeight: 600 }}>
                  <span>Shortest issue gap: {formatMinutesToDurationLabel(completionTimingInRange.shortestGapMinutes)}</span>
                  <span>Longest issue gap: {formatMinutesToDurationLabel(completionTimingInRange.longestGapMinutes)}</span>
                </div>
              </div>

              {effectiveProgressProjectIds.length === 0 ? (
                <div style={{ backgroundColor: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "8px", padding: "12px 16px", color: "#991B1B", fontWeight: 600 }}>
                  Select at least one project to view progress activity.
                </div>
              ) : loadingProgressIssues ? (
                <div style={{ border: "1px dashed #CBD5E1", borderRadius: "10px", backgroundColor: "#F8FAFC", color: "#64748B", padding: "14px" }}>
                  Loading progress activity...
                </div>
              ) : filteredProgressActivityRows.length === 0 ? (
                <div style={{ border: "1px dashed #CBD5E1", borderRadius: "10px", backgroundColor: "#F8FAFC", color: "#64748B", padding: "14px" }}>
                  No note or progress activity found for the selected project/date filter.
                </div>
              ) : (
                <div style={{ border: "1px solid #E5E7EB", borderRadius: "10px", backgroundColor: "#FFFFFF", overflow: "hidden" }}>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "920px" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid #E2E8F0", backgroundColor: "#F8FAFC" }}>
                          <th style={{ textAlign: "left", padding: "10px 12px", fontSize: "0.78rem", color: "#475569", textTransform: "uppercase" }}>Date / Time</th>
                          <th style={{ textAlign: "left", padding: "10px 12px", fontSize: "0.78rem", color: "#475569", textTransform: "uppercase" }}>Issue #</th>
                          <th style={{ textAlign: "left", padding: "10px 12px", fontSize: "0.78rem", color: "#475569", textTransform: "uppercase" }}>Project Name</th>
                          <th style={{ textAlign: "left", padding: "10px 12px", fontSize: "0.78rem", color: "#475569", textTransform: "uppercase" }}>Activity</th>
                          <th style={{ textAlign: "left", padding: "10px 12px", fontSize: "0.78rem", color: "#475569", textTransform: "uppercase" }}>Added By</th>
                          <th style={{ textAlign: "left", padding: "10px 12px", fontSize: "0.78rem", color: "#475569", textTransform: "uppercase" }}>Log</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredProgressActivityRows.map((entry) => (
                          <tr key={entry.id} style={{ borderTop: "1px solid #E5E7EB" }}>
                            <td style={{ padding: "10px 12px", color: "#334155", fontSize: "0.85rem", whiteSpace: "nowrap" }}>{entry.createdAtLabel}</td>
                            <td style={{ padding: "10px 12px", color: "#0F172A", fontWeight: 700 }}>#{entry.issueNumber}</td>
                            <td style={{ padding: "10px 12px", color: "#1E293B", fontWeight: 600 }}>{entry.projectName}</td>
                            <td style={{ padding: "10px 12px" }}>
                              <span style={{ fontSize: "0.72rem", fontWeight: 700, borderRadius: "999px", padding: "4px 8px", backgroundColor: entry.activityType === "Progress Added" ? "#DBEAFE" : "#F1F5F9", color: entry.activityType === "Progress Added" ? "#1E40AF" : "#334155" }}>
                                {entry.activityType}
                              </span>
                            </td>
                            <td style={{ padding: "10px 12px", color: "#475569", fontSize: "0.84rem", whiteSpace: "nowrap" }}>{entry.createdBy}</td>
                            <td style={{ padding: "10px 12px", color: "#111827", fontSize: "0.84rem", lineHeight: 1.45 }}>
                              {entry.logText}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* â”€â”€ TASKS FOR THE DAY TAB â”€â”€ */}
          {activeTab === "tasksForDay" && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "10px" }}>
                <h2 style={{ margin: 0 }}>Tasks For The Day</h2>
                <span style={{ fontSize: "0.84rem", backgroundColor: "#E0E7FF", color: "#3730A3", borderRadius: "999px", padding: "5px 10px", fontWeight: 700 }}>
                  {todayDateKey}
                </span>
              </div>

              {!selectedProjectId ? (
                <div style={{ backgroundColor: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "8px", padding: "12px 16px", color: "#991B1B", fontWeight: 600 }}>
                  Please select a project first.
                </div>
              ) : (
                <>
                  <form
                    onSubmit={handleAssignTaskForDay}
                    style={{ border: "1px solid #C7D2FE", borderRadius: "10px", padding: "14px", marginBottom: "14px", backgroundColor: "#EEF2FF" }}
                  >
                    <h3 style={{ marginTop: 0, marginBottom: "12px", color: "#3730A3" }}>Assign Bucket Task</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px" }}>
                      <div>
                        <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", marginBottom: "4px" }}>User *</label>
                        <select
                          style={inputStyle}
                          value={taskAssigneeUserId}
                          onChange={(event) => setTaskAssigneeUserId(event.target.value)}
                          disabled={loadingOrganizationUsers}
                        >
                          <option value="">â€” Select user â€”</option>
                          {organizationUsers.map((person) => (
                            <option key={person.id} value={person.id}>
                              {person.name}{person.email ? ` (${person.email})` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", marginBottom: "8px" }}>Buckets (select multiple)</label>
                        {buckets.length === 0 ? (
                          <p style={{ margin: 0, color: "#6B7280", fontSize: "0.85rem" }}>No buckets available.</p>
                        ) : (
                          <div style={{ display: "grid", gap: "6px", maxHeight: "200px", overflowY: "auto", padding: "6px", border: "1px solid #D1D5DB", borderRadius: "6px", backgroundColor: "#FAFAFA" }}>
                            {buckets.map((bucket) => {
                              const isChecked = taskBucketIds.includes(bucket.id);
                              return (
                                <label key={bucket.id} style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", margin: 0, fontSize: "0.9rem" }}>
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(event) => {
                                      if (event.target.checked) {
                                        setTaskBucketIds([...taskBucketIds, bucket.id]);
                                      } else {
                                        setTaskBucketIds(taskBucketIds.filter((id) => id !== bucket.id));
                                      }
                                    }}
                                    style={{ cursor: "pointer" }}
                                  />
                                  <span>{bucket.name || "Untitled Bucket"}</span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ marginTop: "10px" }}>
                      <button type="submit" style={{ ...buttonBaseStyle, backgroundColor: "#4F46E5" }}>
                        Assign Task
                      </button>
                    </div>
                  </form>

                  <div style={{ border: "1px solid #E5E7EB", borderRadius: "10px", backgroundColor: "#FFFFFF", overflow: "hidden" }}>
                    <div style={{ padding: "12px", borderBottom: "1px solid #E5E7EB", backgroundColor: "#F8FAFC" }}>
                      <strong>All Users</strong>
                    </div>
                    {loadingOrganizationUsers ? (
                      <p style={{ margin: 0, padding: "12px", color: "#64748B" }}>Loading users...</p>
                    ) : organizationUsers.length === 0 ? (
                      <p style={{ margin: 0, padding: "12px", color: "#64748B" }}>No users found for this organization.</p>
                    ) : (
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "640px" }}>
                          <thead>
                            <tr style={{ borderBottom: "1px solid #E2E8F0", backgroundColor: "#F8FAFC" }}>
                              <th style={{ textAlign: "left", padding: "10px 12px", fontSize: "0.78rem", color: "#475569", textTransform: "uppercase" }}>User</th>
                              <th style={{ textAlign: "left", padding: "10px 12px", fontSize: "0.78rem", color: "#475569", textTransform: "uppercase" }}>Email</th>
                              <th style={{ textAlign: "left", padding: "10px 12px", fontSize: "0.78rem", color: "#475569", textTransform: "uppercase" }}>Assigned Buckets Today</th>
                              <th style={{ textAlign: "left", padding: "10px 12px", fontSize: "0.78rem", color: "#475569", textTransform: "uppercase" }}>Issues in Assigned Buckets</th>
                            </tr>
                          </thead>
                          <tbody>
                            {organizationUsers.map((person) => {
                              const assignments = tasksByUserId.get(person.id) || [];
                              const assignedBucketsLabel = assignments.length
                                ? assignments.map((assignment) => assignment.bucketName || "Untitled Bucket").join(", ")
                                : "No tasks assigned";
                              const assignedBucketIds = assignments.map((assignment) => String(assignment?.bucketId || "").trim()).filter(Boolean);
                              const issuesInBuckets = issues.filter((issue) => assignedBucketIds.includes(String(issue?.bucketId || "").trim()));
                              const issuesLabel = issuesInBuckets.length
                                ? issuesInBuckets.map((issue) => issue.issueNumber || `#${issue.id}`).join(", ")
                                : "No issues";

                              return (
                                <tr key={person.id} style={{ borderTop: "1px solid #E5E7EB" }}>
                                  <td style={{ padding: "10px 12px", color: "#0F172A", fontWeight: 600 }}>{person.name || person.id}</td>
                                  <td style={{ padding: "10px 12px", color: "#475569" }}>{person.email || "-"}</td>
                                  <td style={{ padding: "10px 12px", color: assignments.length ? "#0F766E" : "#64748B", fontWeight: assignments.length ? 700 : 500 }}>
                                    {assignedBucketsLabel}
                                  </td>
                                  <td style={{ padding: "10px 12px", color: issuesInBuckets.length ? "#1E40AF" : "#64748B", fontWeight: issuesInBuckets.length ? 600 : 400, fontSize: "0.9rem" }}>
                                    {issuesLabel}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {/* ── TOTAL DAY COUNT TAB ── */}
          {activeTab === "dayCounts" && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "10px" }}>
                <h2 style={{ margin: 0 }}>Total Day Count</h2>
                {selectedProjectId && (
                  <div style={{ backgroundColor: "#DBEAFE", color: "#1D4ED8", borderRadius: "999px", padding: "6px 12px", fontWeight: 700 }}>
                    Total Days: {selectedProjectTotalDayCount}
                  </div>
                )}
              </div>

              {!selectedProjectId ? (
                <div style={{ backgroundColor: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "8px", padding: "12px 16px", color: "#991B1B", fontWeight: 600 }}>
                  Please select a project first.
                </div>
              ) : (
                <div style={{ display: "grid", gap: "12px", width: "100%" }}>
                  <div
                    style={{
                      border: "1px solid #BFDBFE",
                      borderRadius: "10px",
                      padding: "14px",
                      backgroundColor: "#F8FBFF",
                      width: "100%",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px", marginBottom: "10px" }}>
                      <h3 style={{ margin: 0, color: "#1E3A8A" }}>Grand Total Chart</h3>
                      <span style={{ fontSize: "0.8rem", color: "#475569", fontWeight: 600 }}>
                        {selectedProject?.name || "Selected project"}
                      </span>
                    </div>

                    {bucketGrandTotals.total === 0 ? (
                      <p style={{ margin: 0, color: "#64748B" }}>
                        No issues available for the current filters.
                      </p>
                    ) : (
                      <div style={{ display: "grid", gap: "10px" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "8px" }}>
                          <div style={{ backgroundColor: "#FFFFFF", border: "1px solid #DBEAFE", borderRadius: "8px", padding: "10px" }}>
                            <div style={{ fontSize: "0.75rem", color: "#64748B", textTransform: "uppercase", fontWeight: 700 }}>Total</div>
                            <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#1E293B", lineHeight: 1.1 }}>{bucketGrandTotals.total}</div>
                          </div>
                          <div style={{ backgroundColor: "#FFFFFF", border: "1px solid #DCFCE7", borderRadius: "8px", padding: "10px" }}>
                            <div style={{ fontSize: "0.75rem", color: "#166534", textTransform: "uppercase", fontWeight: 700 }}>Completed</div>
                            <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#166534", lineHeight: 1.1 }}>{bucketGrandTotals.completed}</div>
                          </div>
                          <div style={{ backgroundColor: "#FFFFFF", border: "1px solid #DBEAFE", borderRadius: "8px", padding: "10px" }}>
                            <div style={{ fontSize: "0.75rem", color: "#1D4ED8", textTransform: "uppercase", fontWeight: 700 }}>Remaining</div>
                            <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#1D4ED8", lineHeight: 1.1 }}>{bucketGrandTotals.remaining}</div>
                          </div>
                          <div style={{ backgroundColor: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: "8px", padding: "10px" }}>
                            <div style={{ fontSize: "0.75rem", color: "#475569", textTransform: "uppercase", fontWeight: 700 }}>Completion</div>
                            <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0F172A", lineHeight: 1.1 }}>{bucketGrandTotals.completionPercent}%</div>
                          </div>
                        </div>

                        <div style={{ borderRadius: "999px", backgroundColor: "#E2E8F0", overflow: "hidden", height: "12px" }}>
                          <div
                            style={{
                              height: "100%",
                              width: `${bucketGrandTotals.completionPercent}%`,
                              background: "linear-gradient(90deg, #22C55E 0%, #16A34A 100%)",
                              transition: "width 180ms ease",
                            }}
                          />
                        </div>

                        <div style={{ display: "grid", gap: "6px" }}>
                          {bucketGrandTotals.topBuckets.map((bucket) => {
                            const maxRemaining = Math.max(...bucketGrandTotals.topBuckets.map((item) => item.remaining), 1);
                            const barWidth = Math.max((bucket.remaining / maxRemaining) * 100, bucket.remaining > 0 ? 8 : 0);

                            return (
                              <div key={`grand-total-${bucket.id}`}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", fontSize: "0.8rem", marginBottom: "2px" }}>
                                  <span style={{ color: "#334155", fontWeight: 700 }}>{bucket.name}</span>
                                  <span style={{ color: "#64748B", fontWeight: 600 }}>
                                    {bucket.remaining} left / {bucket.total} total
                                  </span>
                                </div>
                                <div style={{ height: "8px", borderRadius: "999px", backgroundColor: "#E2E8F0", overflow: "hidden" }}>
                                  <div style={{ height: "100%", width: `${barWidth}%`, backgroundColor: "#3B82F6" }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  <div style={{ border: "1px solid #DBEAFE", borderRadius: "10px", padding: "14px", backgroundColor: "#F8FBFF", width: "100%" }}>
                    <p style={{ marginTop: 0, marginBottom: "10px", color: "#334155", fontWeight: 600 }}>
                      Daily Change Chart
                    </p>

                    {dailyDayCountSeries.length === 0 ? (
                      <p style={{ margin: 0, color: "#64748B" }}>No history yet. Save a day count to start tracking.</p>
                    ) : (
                      (() => {
                        const chartWidth = 640;
                        const chartHeight = 220;
                        const leftPad = 48;
                        const rightPad = 20;
                        const topPad = 16;
                        const bottomPad = 34;

                        const values = dailyDayCountSeries.map((item) => item.value);
                        const minValue = Math.min(...values);
                        const maxValue = Math.max(...values);
                        const valueRange = maxValue - minValue || 1;
                        const usableWidth = chartWidth - leftPad - rightPad;
                        const usableHeight = chartHeight - topPad - bottomPad;
                        const stepX = dailyDayCountSeries.length > 1 ? usableWidth / (dailyDayCountSeries.length - 1) : 0;

                        const points = dailyDayCountSeries.map((point, index) => {
                          const x = leftPad + (stepX * index);
                          const y = topPad + ((maxValue - point.value) / valueRange) * usableHeight;
                          return { ...point, x, y };
                        });

                        const polylinePoints = points.map((point) => `${point.x},${point.y}`).join(" ");

                        return (
                          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} style={{ width: "100%", height: "auto", display: "block" }}>
                            <line x1={leftPad} y1={topPad + usableHeight} x2={chartWidth - rightPad} y2={topPad + usableHeight} stroke="#CBD5E1" strokeWidth="1" />
                            <line x1={leftPad} y1={topPad} x2={leftPad} y2={topPad + usableHeight} stroke="#CBD5E1" strokeWidth="1" />

                            <polyline fill="none" stroke="#2563EB" strokeWidth="2.5" points={polylinePoints} />

                            {points.map((point) => (
                              <g key={point.date}>
                                <circle cx={point.x} cy={point.y} r="3.5" fill="#1D4ED8" />
                                <text x={point.x} y={chartHeight - 10} textAnchor="middle" fontSize="10" fill="#64748B">
                                  {point.date.slice(5)}
                                </text>
                              </g>
                            ))}

                            <text x="8" y={topPad + 8} fontSize="10" fill="#64748B">{maxValue}</text>
                            <text x="8" y={topPad + usableHeight} fontSize="10" fill="#64748B">{minValue}</text>
                          </svg>
                        );
                      })()
                    )}
                  </div>

                  <div style={{ border: "1px solid #E5E7EB", borderRadius: "8px", padding: "16px", backgroundColor: "#FFFFFF", width: "100%" }}>
                    <p style={{ marginTop: 0, color: "#475569" }}>
                      Set one total day count for this project. Saving automatically records today in the history log.
                    </p>
                    {hasTodayDayCountLog && (
                      <p style={{ marginTop: 0, color: "#B45309", fontWeight: 600 }}>
                        Today's value is already logged. Next entry allowed tomorrow.
                      </p>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <input
                        type="number"
                        min="0"
                        step="0.25"
                        style={{ ...inputStyle, width: "180px" }}
                        value={projectDayCountDraft}
                        onChange={(e) => setProjectDayCountDraft(e.target.value)}
                        placeholder="Project total days"
                        disabled={hasTodayDayCountLog}
                      />
                      <button
                        type="button"
                        style={{ ...buttonBaseStyle, backgroundColor: "#2563EB" }}
                        onClick={handleSaveProjectDayCount}
                        disabled={hasTodayDayCountLog}
                      >
                        Save
                      </button>
                    </div>
                  </div>

                  <div style={{ border: "1px solid #E5E7EB", borderRadius: "8px", padding: "16px", backgroundColor: "#FFFFFF", width: "100%" }}>
                    <h3 style={{ marginTop: 0, marginBottom: "10px", fontSize: "1rem" }}>Day Count Log</h3>
                    {loadingDayCountLogs ? (
                      <p style={{ margin: 0, color: "#64748B" }}>Loading log...</p>
                    ) : dayCountLogs.length === 0 ? (
                      <p style={{ margin: 0, color: "#64748B" }}>No entries yet.</p>
                    ) : (
                      <div style={{ display: "grid", gap: "6px" }}>
                        {dayCountLogs.slice().reverse().map((entry, index) => {
                          const previous = dayCountLogs[dayCountLogs.length - index - 2];
                          const delta = previous ? normalizeDayCount(entry.dayCount - previous.dayCount) : 0;
                          const deltaColor = delta > 0 ? "#047857" : delta < 0 ? "#B91C1C" : "#475569";

                          return (
                            <div key={entry.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #F1F5F9", paddingBottom: "6px" }}>
                              <span style={{ color: "#334155", fontWeight: 600 }}>{entry.recordedDate || "Unknown date"}</span>
                              <span style={{ color: "#1E293B" }}>{entry.dayCount}</span>
                              <span style={{ color: deltaColor, fontWeight: 600 }}>
                                {delta > 0 ? `+${delta}` : `${delta}`}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {selectedIssueForNotes && (
            <div
              role="dialog"
              aria-modal="true"
              onClick={closeIssueNotesModal}
              style={{
                position: "fixed",
                inset: 0,
                backgroundColor: "rgba(15, 23, 42, 0.45)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "16px",
                zIndex: 80,
              }}
            >
              <div
                onClick={(event) => event.stopPropagation()}
                style={{
                  width: "min(960px, 100%)",
                  maxHeight: "90vh",
                  overflow: "hidden",
                  backgroundColor: "#FFFFFF",
                  borderRadius: "12px",
                  border: "1px solid #E2E8F0",
                  boxShadow: "0 24px 50px rgba(15, 23, 42, 0.28)",
                  display: "grid",
                  gridTemplateRows: "auto 1fr auto",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", padding: "12px 14px", borderBottom: "1px solid #E2E8F0" }}>
                  <div>
                    <div style={{ fontSize: "0.76rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase" }}>
                      Issue #{selectedIssueForNotes.issueNumber || selectedIssueForNotes.id}
                    </div>
                    <div style={{ fontSize: "0.98rem", color: "#0F172A", fontWeight: 700 }}>
                      Notes
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={closeIssueNotesModal}
                    style={{
                      border: "1px solid #CBD5E1",
                      borderRadius: "8px",
                      backgroundColor: "#FFFFFF",
                      color: "#334155",
                      width: "32px",
                      height: "32px",
                      cursor: "pointer",
                      fontSize: "1.05rem",
                      lineHeight: 1,
                    }}
                    aria-label="Close notes"
                  >
                    ×
                  </button>
                </div>

                <div style={{ padding: "12px 14px", overflowY: "auto", display: "grid", gap: "8px", backgroundColor: "#F8FAFC" }}>
                  {selectedIssueModalNotes.length === 0 ? (
                    <div style={{ border: "1px dashed #CBD5E1", borderRadius: "8px", backgroundColor: "#FFFFFF", padding: "12px", color: "#64748B" }}>
                      No notes yet. Use the box below to add the first note.
                    </div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "10px", alignItems: "start" }}>
                      {[
                        {
                          id: "progress",
                          title: "Progress Updates",
                          notes: selectedIssueModalProgressNotes,
                          headerColor: "#0F766E",
                          headerBg: "#CCFBF1",
                          emptyText: "No progress updates yet.",
                        },
                        {
                          id: "general",
                          title: "Notes",
                          notes: selectedIssueModalGeneralNotes,
                          headerColor: "#1E3A8A",
                          headerBg: "#DBEAFE",
                          emptyText: "No regular notes yet.",
                        },
                      ].map((section) => (
                        <div key={section.id} style={{ display: "grid", gap: "8px", border: "1px solid #E2E8F0", borderRadius: "10px", padding: "10px", backgroundColor: "#FFFFFF" }}>
                          <div
                            style={{
                              fontSize: "0.76rem",
                              fontWeight: 800,
                              color: section.headerColor,
                              backgroundColor: section.headerBg,
                              borderRadius: "999px",
                              padding: "4px 10px",
                              width: "fit-content",
                              textTransform: "uppercase",
                              letterSpacing: "0.05em",
                            }}
                          >
                            {section.title} ({section.notes.length})
                          </div>
                          {section.notes.length === 0 ? (
                            <div style={{ border: "1px dashed #CBD5E1", borderRadius: "8px", backgroundColor: "#F8FAFC", padding: "10px", color: "#64748B", fontSize: "0.82rem" }}>
                              {section.emptyText}
                            </div>
                          ) : (
                            section.notes.slice().reverse().map((note, index) => {
                              const noteAttachments = normalizeIssueNoteAttachments(note.attachments);
                              return (
                                <div
                                  key={`${section.id}-${note.createdAtIso || "note"}-${index}`}
                                  style={{ border: "1px solid #E2E8F0", borderRadius: "8px", backgroundColor: "#FFFFFF", padding: "10px" }}
                                >
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginBottom: "6px", flexWrap: "wrap" }}>
                                    <span style={{ fontSize: "0.78rem", color: "#1E3A8A", fontWeight: 700 }}>{getIssueNoteAuthorLabel(note)}</span>
                                    <span style={{ fontSize: "0.74rem", color: "#64748B" }}>{formatIssueNoteTimestamp(note.createdAtIso)}</span>
                                  </div>
                                  {note.text ? (
                                    <div style={{ fontSize: "0.86rem", color: "#0F172A", whiteSpace: "pre-wrap", lineHeight: 1.4 }}>
                                      {note.text}
                                    </div>
                                  ) : (
                                    <div style={{ fontSize: "0.8rem", color: "#64748B", fontStyle: "italic" }}>
                                      Attachment only
                                    </div>
                                  )}
                                  {noteAttachments.length > 0 ? (
                                    <div style={{ marginTop: "8px", display: "grid", gap: "6px" }}>
                                      <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#475569", textTransform: "uppercase" }}>
                                        Files ({noteAttachments.length})
                                      </div>
                                      {noteAttachments.map((attachment, attachmentIndex) => {
                                        const isImage = isAttachmentImage(attachment);
                                        return (
                                          <div key={`${attachment.url}-${attachmentIndex}`} style={{ border: "1px solid #E2E8F0", borderRadius: "8px", padding: "7px", backgroundColor: "#F8FAFC" }}>
                                            <a
                                              href={attachment.url}
                                              target="_blank"
                                              rel="noreferrer"
                                              style={{ fontSize: "0.8rem", fontWeight: 700, color: "#1D4ED8", textDecoration: "none", wordBreak: "break-all" }}
                                            >
                                              {attachment.name || "Attachment"}
                                            </a>
                                            <div style={{ fontSize: "0.72rem", color: "#64748B", marginTop: "2px" }}>
                                              {[formatAttachmentSize(attachment.sizeBytes), attachment.contentType].filter(Boolean).join(" · ") || "File"}
                                            </div>
                                            {isImage ? (
                                              <div style={{ marginTop: "6px" }}>
                                                <button
                                                  type="button"
                                                  onClick={() => openIssueNoteImageLightbox(attachment)}
                                                  style={{
                                                    border: "none",
                                                    background: "transparent",
                                                    padding: 0,
                                                    cursor: "zoom-in",
                                                    display: "block",
                                                  }}
                                                  title="Open image preview"
                                                >
                                                  <img
                                                    src={attachment.url}
                                                    alt={attachment.name || "Attachment image"}
                                                    style={{ maxWidth: "100%", maxHeight: "180px", borderRadius: "6px", border: "1px solid #E2E8F0", objectFit: "contain", backgroundColor: "#FFFFFF" }}
                                                  />
                                                </button>
                                              </div>
                                            ) : null}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ padding: "12px 14px", borderTop: "1px solid #E2E8F0", backgroundColor: "#FFFFFF" }}>
                  <div style={{ display: "grid", gap: "8px" }}>
                    <textarea
                      style={{ ...textareaStyle, minHeight: "84px" }}
                      value={issueNoteDraft}
                      onChange={(event) => setIssueNoteDraft(event.target.value)}
                      placeholder="Write a note..."
                      disabled={isSavingIssueNote}
                    />
                    <div style={{ display: "grid", gap: "6px" }}>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => issueNoteFileInputRef.current?.click?.()}
                          disabled={isSavingIssueNote || !storage}
                          style={{
                            ...buttonBaseStyle,
                            backgroundColor: storage ? "#0F766E" : "#94A3B8",
                            fontSize: "0.78rem",
                            padding: "6px 10px",
                          }}
                          title={storage ? "Attach files to this note" : "Storage unavailable"}
                        >
                          Attach files
                        </button>
                        <input
                          ref={issueNoteFileInputRef}
                          type="file"
                          multiple
                          style={{ display: "none" }}
                          onChange={handleIssueNoteFilesChange}
                          disabled={isSavingIssueNote || !storage}
                        />
                        <span style={{ fontSize: "0.75rem", color: "#64748B" }}>
                          Up to {MAX_ISSUE_NOTE_ATTACHMENTS} files, {Math.round(MAX_ISSUE_NOTE_ATTACHMENT_BYTES / (1024 * 1024))}MB each
                        </span>
                      </div>
                      {issueNoteFiles.length > 0 ? (
                        <div style={{ display: "grid", gap: "5px", border: "1px solid #E2E8F0", borderRadius: "8px", backgroundColor: "#F8FAFC", padding: "8px" }}>
                          {issueNoteFiles.map((file, index) => (
                            <div key={`${file.name}-${index}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "#0F172A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={file.name}>
                                  {file.name}
                                </div>
                                <div style={{ fontSize: "0.72rem", color: "#64748B" }}>
                                  {[formatAttachmentSize(file.size), file.type].filter(Boolean).join(" · ") || "File"}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemoveIssueNoteFile(index)}
                                disabled={isSavingIssueNote}
                                style={{
                                  border: "1px solid #CBD5E1",
                                  borderRadius: "6px",
                                  backgroundColor: "#FFFFFF",
                                  color: "#475569",
                                  cursor: "pointer",
                                  fontSize: "0.74rem",
                                  padding: "4px 8px",
                                }}
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                      <button
                        type="button"
                        style={{ ...buttonBaseStyle, backgroundColor: "#64748B" }}
                        onClick={closeIssueNotesModal}
                        disabled={isSavingIssueNote}
                      >
                        Close
                      </button>
                      <button
                        type="button"
                        style={{ ...buttonBaseStyle, backgroundColor: "#1D4ED8" }}
                        onClick={handleSaveIssueNoteFromModal}
                        disabled={isSavingIssueNote}
                      >
                        {isSavingIssueNote ? "Saving..." : "Add Note"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {issueNoteLightboxAttachment?.url ? (
            <div
              role="dialog"
              aria-modal="true"
              onClick={closeIssueNoteImageLightbox}
              style={{
                position: "fixed",
                inset: 0,
                backgroundColor: "rgba(2, 6, 23, 0.86)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "18px",
                zIndex: 95,
              }}
            >
              <div
                onClick={(event) => event.stopPropagation()}
                style={{
                  width: "min(1000px, 100%)",
                  maxHeight: "92vh",
                  display: "grid",
                  gridTemplateRows: "auto 1fr",
                  gap: "10px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
                  <div style={{ color: "#E2E8F0", fontSize: "0.9rem", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {issueNoteLightboxAttachment.name || "Image preview"}
                  </div>
                  <button
                    type="button"
                    onClick={closeIssueNoteImageLightbox}
                    style={{
                      border: "1px solid rgba(226, 232, 240, 0.5)",
                      borderRadius: "8px",
                      backgroundColor: "rgba(15, 23, 42, 0.5)",
                      color: "#F8FAFC",
                      width: "34px",
                      height: "34px",
                      cursor: "pointer",
                      fontSize: "1.1rem",
                      lineHeight: 1,
                    }}
                    aria-label="Close image preview"
                  >
                    ×
                  </button>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", overflow: "auto" }}>
                  <img
                    src={issueNoteLightboxAttachment.url}
                    alt={issueNoteLightboxAttachment.name || "Attachment image"}
                    style={{
                      maxWidth: "100%",
                      maxHeight: "84vh",
                      borderRadius: "10px",
                      objectFit: "contain",
                      boxShadow: "0 20px 45px rgba(0, 0, 0, 0.4)",
                      backgroundColor: "#FFFFFF",
                    }}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {snapshotLightbox?.url ? (
            <div
              role="dialog"
              aria-modal="true"
              onClick={closeSnapshotLightbox}
              style={{
                position: "fixed",
                inset: 0,
                backgroundColor: "rgba(2, 6, 23, 0.86)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "18px",
                zIndex: 96,
              }}
            >
              <div
                onClick={(event) => event.stopPropagation()}
                style={{
                  width: "min(1000px, 100%)",
                  maxHeight: "92vh",
                  display: "grid",
                  gridTemplateRows: "auto 1fr",
                  gap: "10px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
                  <div style={{ color: "#E2E8F0", fontSize: "0.9rem", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {snapshotLightbox.label || "Snapshot preview"}
                  </div>
                  <button
                    type="button"
                    onClick={closeSnapshotLightbox}
                    style={{
                      border: "1px solid rgba(226, 232, 240, 0.5)",
                      borderRadius: "8px",
                      backgroundColor: "rgba(15, 23, 42, 0.5)",
                      color: "#F8FAFC",
                      width: "34px",
                      height: "34px",
                      cursor: "pointer",
                      fontSize: "1.1rem",
                      lineHeight: 1,
                    }}
                    aria-label="Close snapshot preview"
                  >
                    ×
                  </button>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", overflow: "auto" }}>
                  <img
                    src={snapshotLightbox.url}
                    alt={snapshotLightbox.label || "Snapshot image"}
                    style={{
                      maxWidth: "100%",
                      maxHeight: "84vh",
                      borderRadius: "10px",
                      objectFit: "contain",
                      boxShadow: "0 20px 45px rgba(0, 0, 0, 0.4)",
                      backgroundColor: "#FFFFFF",
                    }}
                  />
                </div>
              </div>
            </div>
          ) : null}

        </section>
      </div>
    </div>

    {/* ── Linked Issues Compare Modal ─────────────────────────────── */}
    {compareModalBaseIssueId && (() => {
      const baseIssue = issues.find((i) => i.id === compareModalBaseIssueId);
      if (!baseIssue) return null;
      const linked = normalizeLinkedIssues(baseIssue.linkedIssues);
      const linkedIssueObjects = linked
        .map((li) => issues.find((i) => i.id === li.issueId || String(i.issueNumber || "").trim().toLowerCase() === li.issueNumber.toLowerCase()))
        .filter(Boolean);
      const allIssues = [baseIssue, ...linkedIssueObjects];

      const renderIssueCard = (iss) => {
        const cardNotes = normalizeIssueNotes(iss.notes);
        const cardTags = normalizeIssueTags(iss.tags);
        const cardDue = getIssueDueDateValue(iss);
        const cardCountdown = getDueDateCountdownMeta(cardDue);
        const bucketLabel = buckets.find((b) => b.id === iss.bucketId)?.name || iss.bucketName || "";
        const isBase = iss.id === baseIssue.id;
        const isMovingThisCard = compareMoveIssueId === iss.id;
        const isSavingThisCard = savingCompareMoveIssueId === iss.id;
        const cardIsCompleted = isIssueDoneStatus(iss.status);
        return (
          <div
            key={iss.id}
            onDoubleClick={() => {
              if (compareMoveIssueId === iss.id) {
                setCompareMoveIssueId("");
                setCompareMoveBucketId("");
              } else {
                setCompareMoveIssueId(iss.id);
                setCompareMoveBucketId(iss.bucketId || "");
              }
            }}
            title="Double-click to move to another bucket"
            style={{
              flex: "1 1 280px",
              minWidth: "260px",
              maxWidth: "360px",
              border: isMovingThisCard ? "2px solid #7C3AED" : isBase ? "2px solid #2563EB" : "1px solid #D1D5DB",
              borderRadius: "10px",
              backgroundColor: isMovingThisCard ? "#F5F3FF" : isBase ? "#EFF6FF" : "#FFFFFF",
              padding: "14px",
              display: "grid",
              gap: "8px",
              alignContent: "start",
              cursor: "default",
            }}
          >
            {isBase && (
              <div style={{ fontSize: "0.68rem", fontWeight: 800, color: "#2563EB", textTransform: "uppercase", letterSpacing: "0.04em" }}>Current Issue</div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <input
                  type="checkbox"
                  checked={cardIsCompleted}
                  onChange={(e) => {
                    e.stopPropagation();
                    handleToggleIssueComplete(iss, e.target.checked);
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                  title={cardIsCompleted ? "Mark as Open" : "Mark as Complete"}
                />
                <span style={{ fontWeight: 800, fontSize: "0.95rem", color: "#0F172A" }}>#{iss.issueNumber || iss.id}</span>
              </span>
              <span style={{ fontSize: "0.75rem", backgroundColor: (() => { const m = statusBadgeColor(iss.status); return m.bg; })(), color: (() => { const m = statusBadgeColor(iss.status); return m.text; })(), borderRadius: "999px", padding: "2px 8px", fontWeight: 700 }}>{iss.status || "Open"}</span>
            </div>
            {iss.title ? <div style={{ fontSize: "0.88rem", fontWeight: 600, color: "#1E293B" }}>{iss.title}</div> : null}
            {bucketLabel ? <div style={{ fontSize: "0.75rem", color: "#64748B" }}>Bucket: {bucketLabel}</div> : null}
            {iss.description ? <div style={{ fontSize: "0.78rem", color: "#475569", lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{iss.description}</div> : null}
            {cardDue ? (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "0.72rem", color: "#475569", fontWeight: 700 }}>Due: {cardDue}</span>
                {cardCountdown ? <span style={{ fontSize: "0.68rem", fontWeight: 700, backgroundColor: cardCountdown.bg, color: cardCountdown.text, borderRadius: "999px", padding: "2px 8px" }}>{cardCountdown.label}</span> : null}
              </div>
            ) : null}
            {cardTags.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                {cardTags.map((tag) => (
                  <span key={tag} style={{ fontSize: "0.68rem", backgroundColor: "#E0E7FF", color: "#312E81", borderRadius: "999px", padding: "2px 7px", fontWeight: 700 }}>{tag}</span>
                ))}
              </div>
            ) : null}
            {cardNotes.length > 0 ? (
              <div style={{ borderTop: "1px solid #E2E8F0", paddingTop: "8px", display: "grid", gap: "6px" }}>
                <div style={{ fontSize: "0.7rem", fontWeight: 800, color: "#334155", textTransform: "uppercase" }}>Notes ({cardNotes.length})</div>
                {cardNotes.slice().reverse().map((note, idx) => {
                  const noteAttachments = normalizeIssueNoteAttachments(note.attachments);
                  return (
                    <div key={idx} style={{ fontSize: "0.73rem", color: "#1E293B", backgroundColor: "#F8FAFC", borderRadius: "6px", padding: "6px 8px", borderLeft: "3px solid #CBD5E1" }}>
                      <div style={{ fontSize: "0.65rem", color: "#64748B", fontWeight: 600, marginBottom: "2px" }}>{getIssueNoteAuthorLabel(note)} · {formatIssueNoteTimestamp(note.createdAtIso)}</div>
                      <div>{note.text || "[Attachment only]"}</div>
                      {noteAttachments.length > 0 ? (
                        <div style={{ marginTop: "4px", display: "grid", gap: "2px" }}>
                          {noteAttachments.map((attachment, attachmentIndex) => (
                            <a
                              key={`${attachment.url}-${attachmentIndex}`}
                              href={attachment.url}
                              target="_blank"
                              rel="noreferrer"
                              style={{ fontSize: "0.66rem", color: "#1D4ED8", textDecoration: "none", wordBreak: "break-all" }}
                            >
                              {attachment.name || "Attachment"}
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : <div style={{ fontSize: "0.72rem", color: "#94A3B8" }}>No notes yet</div>}
            {isMovingThisCard ? (
              <div style={{ borderTop: "1px solid #DDD6FE", paddingTop: "8px", display: "grid", gap: "6px" }}>
                <div style={{ fontSize: "0.7rem", fontWeight: 800, color: "#7C3AED", textTransform: "uppercase" }}>Move to bucket</div>
                <select
                  style={{ ...inputStyle, fontSize: "0.78rem", padding: "6px 8px" }}
                  value={compareMoveBucketId}
                  onChange={(e) => setCompareMoveBucketId(e.target.value)}
                  disabled={isSavingThisCard}
                >
                  <option value="">— Select bucket —</option>
                  {buckets.map((b) => (
                    <option key={b.id} value={b.id}>{b.name || "Untitled Bucket"}</option>
                  ))}
                </select>
                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    type="button"
                    style={{ ...buttonBaseStyle, backgroundColor: compareMoveBucketId && !isSavingThisCard ? "#7C3AED" : "#A78BFA", fontSize: "0.75rem", padding: "4px 10px" }}
                    disabled={!compareMoveBucketId || isSavingThisCard}
                    onClick={() => handleCompareMoveIssueToBucket(iss)}
                  >{isSavingThisCard ? "Moving…" : "Move"}</button>
                  <button
                    type="button"
                    style={{ ...buttonBaseStyle, backgroundColor: "#6B7280", fontSize: "0.75rem", padding: "4px 10px" }}
                    disabled={isSavingThisCard}
                    onClick={() => { setCompareMoveIssueId(""); setCompareMoveBucketId(""); }}
                  >Cancel</button>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: "0.65rem", color: "#94A3B8", marginTop: "2px" }}>Double-click to move bucket</div>
            )}
          </div>
        );
      };

      return (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 1200, backgroundColor: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
          onClick={() => setCompareModalBaseIssueId("")}
        >
          <div
            style={{ backgroundColor: "#FFFFFF", borderRadius: "14px", width: "100%", maxWidth: "1100px", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(15,23,42,0.2)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid #E2E8F0" }}>
              <strong style={{ fontSize: "1rem", color: "#0F172A" }}>Linked Issues — #{baseIssue.issueNumber}{baseIssue.title ? ` · ${baseIssue.title}` : ""}</strong>
              <button
                type="button"
                onClick={() => setCompareModalBaseIssueId("")}
                style={{ border: "1px solid #CBD5E1", borderRadius: "6px", backgroundColor: "#F8FAFC", color: "#475569", padding: "4px 12px", cursor: "pointer", fontWeight: 600, fontSize: "0.85rem" }}
              >Close</button>
            </div>
            <div style={{ overflowY: "auto", padding: "16px", display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "start" }}>
              {allIssues.map(renderIssueCard)}
            </div>
          </div>
        </div>
      );
    })()}

  </>);
};

export default ProjectListsIssuesModule;
