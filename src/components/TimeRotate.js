import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { db, storage } from "../firebase";
import commonStyles from "../pages/commonStyles";
import { useAuth } from "../contexts/AuthContext";
import TimeRotateTopLogo from "./TimeRotateTopLogo";

const formatDuration = (milliseconds) => {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const formatTimestamp = (value) => {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
};

const toDateValue = (value) => {
  if (!value) return "";
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const toDateTimeLocalValue = (value) => {
  if (!value) return "";
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
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

const toTwelveHourParts = (value) => {
  if (!value) {
    return {
      date: "",
      hour: "12",
      minute: "00",
      meridiem: "AM",
    };
  }

  const date = new Date(value);
  const hours24 = date.getHours();
  const hour12 = hours24 % 12 || 12;

  return {
    date: toDateValue(value),
    hour: String(hour12),
    minute: String(date.getMinutes()).padStart(2, "0"),
    meridiem: hours24 >= 12 ? "PM" : "AM",
  };
};

const toTimestampFromTwelveHourParts = ({ date, hour, minute, meridiem }) => {
  const normalizedDate = normalizeValue(date);
  const normalizedHour = Number(hour);
  const normalizedMinute = Number(minute);
  const normalizedMeridiem = normalizeValue(meridiem).toUpperCase();

  if (!normalizedDate) return Number.NaN;
  if (!Number.isInteger(normalizedHour) || normalizedHour < 1 || normalizedHour > 12) return Number.NaN;
  if (!Number.isInteger(normalizedMinute) || normalizedMinute < 0 || normalizedMinute > 59) return Number.NaN;
  if (!["AM", "PM"].includes(normalizedMeridiem)) return Number.NaN;

  let hours24 = normalizedHour % 12;
  if (normalizedMeridiem === "PM") {
    hours24 += 12;
  }

  const isoLikeValue = `${normalizedDate}T${String(hours24).padStart(2, "0")}:${String(normalizedMinute).padStart(2, "0")}:00`;
  return Date.parse(isoLikeValue);
};

const normalizeValue = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const isPermissionDeniedError = (error) => {
  const code = normalizeValue(error?.code).toLowerCase();
  return code === "permission-denied" || code === "firestore/permission-denied";
};

const sanitizeFileName = (value) => {
  const normalizedName = normalizeValue(value);
  if (!normalizedName) return "attachment";
  return normalizedName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
};

const normalizeNoteAttachment = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const url = normalizeValue(value.url);
  if (!url) return null;

  return {
    name: normalizeValue(value.name) || "Attachment",
    url,
    path: normalizeValue(value.path),
    contentType: normalizeValue(value.contentType),
    size: Number(value.size) || 0,
  };
};

const normalizeNoteEntry = (noteValue) => {
  const attachment = normalizeNoteAttachment(noteValue?.attachment);
  return {
    text: normalizeValue(noteValue?.text),
    timestamp: Number(noteValue?.timestamp) || 0,
    attachment,
  };
};

const normalizeNotesArray = (value) => {
  if (!Array.isArray(value)) return [];

  return value
    .map((noteValue) => normalizeNoteEntry(noteValue))
    .filter((note) => note.text || note.attachment?.url);
};

const formatFileSize = (value) => {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return "";

  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
};

const isImageAttachment = (attachment) => {
  const contentType = normalizeValue(attachment?.contentType).toLowerCase();
  if (contentType.startsWith("image/")) return true;

  const url = normalizeValue(attachment?.url).toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/.test(url);
};

const normalizeTagValue = (value) => normalizeValue(value).replace(/\s+/g, " ");

const hasTechnicalDetailTitle = (title) => normalizeValue(title).toLowerCase().includes("technical detail");

const parseTagsFromValue = (value) => {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => normalizeTagValue(item)).filter(Boolean)));
  }

  const normalized = normalizeValue(value);
  if (!normalized) {
    return [];
  }

  return Array.from(new Set(normalized.split(",").map((item) => normalizeTagValue(item)).filter(Boolean)));
};

const normalizeKey = (value) =>
  normalizeValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const findFieldByAliases = (fields = [], rowData = {}, aliases = []) => {
  const normalizedAliases = aliases.map(normalizeKey);
  // Check the row's actual stored keys first (same source of truth InvoiceManager's TD Matcher
  // uses), falling back to the project's declared column schema only when a real key isn't
  // present -- otherwise a schema name that doesn't match any real key on this row can win here,
  // silently resolving to a different (often undefined -> row-index-fallback) issue id than what
  // TD Matcher resolved for the exact same row, breaking any identity-based match (e.g. blocking).
  const candidates = [...Object.keys(rowData || {}), ...(Array.isArray(fields) ? fields : [])];

  for (const candidate of candidates) {
    if (normalizedAliases.includes(normalizeKey(candidate))) {
      return candidate;
    }
  }

  for (const aliasKey of normalizedAliases) {
    const startsWith = candidates.find((candidate) => normalizeKey(candidate).startsWith(aliasKey));
    if (startsWith) return startsWith;

    const includes = candidates.find((candidate) => normalizeKey(candidate).includes(aliasKey));
    if (includes) return includes;
  }

  return null;
};

const ISSUE_ID_ALIASES = ["issue id", "id", "task id", "card id", "row id"];
const TITLE_ALIASES = ["title", "issue title", "task title", "name"];
const PROJECT_NAME_ALIASES = ["project name", "project", "projectname"];
const E2_STATUS_ALIASES = ["e2 status update agile", "e2statusupdateagile"];
const LEAD_DETAILER_ALIASES = [
  "e3 lead detailer",
  "e3leaddetailer",
  "e2 lead detailer",
  "e2leaddetailer",
  "e2 detailer",
  "e2detailer",
];
const SUPPORT_TEAM_ALIASES = [
  "e2 detailer support team",
  "e2detailersupportteam",
  "support team",
  "supportteam",
];
const TECHNICAL_DIRECTION_ALIASES = [
  "technical direction",
  "tech direction",
  "technicaldirection",
  "techdirection",
];
const DATA_STAGE_ALIASES = ["data stage", "datastage"];
const TASK_DESCRIPTION_ALIASES = ["task description", "description", "task desc", "details", "scope"];
const ACTIVE_TIMER_STORAGE_PREFIX = "timeRotateActiveTimer";
const ACTIVE_TIMER_COLLECTION = "timeRotateActiveTimers";
const PAY_EVERYONE_SETTINGS_COLLECTION = "payEveryoneUserSettings";
const PAY_EVERYONE_GLOBAL_SETTINGS_COLLECTION = "payEveryoneSettings";
const NOTE_ATTACHMENT_MAX_SIZE_BYTES = 50 * 1024 * 1024;

const DEFAULT_LESSON_LIMIT_CONFIG = {
  enabled: false,
  period: "month",
  maxCount: 0,
  lessonName: "",
  supervisorPin: "",
};

const normalizeLessonLimitConfig = (value = {}) => {
  const normalizedPeriod = normalizeValue(value?.period).toLowerCase();
  return {
    enabled: value?.enabled === true,
    period: ["week", "month", "year"].includes(normalizedPeriod) ? normalizedPeriod : "month",
    maxCount: Math.max(0, Math.floor(Number(value?.maxCount) || 0)),
    lessonName: normalizeValue(value?.lessonName),
    supervisorPin: normalizeValue(value?.supervisorPin),
  };
};

const buildTaskIdentity = (projectDocId, issueId) => {
  const normalizedProjectDocId = normalizeValue(projectDocId) || "unknown-project";
  const normalizedIssueId = normalizeValue(issueId) || "unknown-issue";
  return `${normalizedProjectDocId}::${normalizedIssueId}`;
};

const buildTaskDetailsDocId = (taskIdentity) => normalizeKey(taskIdentity) || "unknown-task";
const TWELVE_HOUR_OPTIONS = Array.from({ length: 12 }, (_, index) => String(index + 1));
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0"));
const COMPLETION_STATUS = {
  NOT_COMPLETED: "not_completed",
  COMPLETED_FOR_REVIEW: "completed_for_review",
  APPROVED_CLOSED: "approved_closed",
};
const COMPLETION_STATUS_FLOW = [
  COMPLETION_STATUS.NOT_COMPLETED,
  COMPLETION_STATUS.COMPLETED_FOR_REVIEW,
  COMPLETION_STATUS.APPROVED_CLOSED,
];

const normalizeCompletionStatus = (statusValue, isCompleted = false) => {
  const normalized = normalizeKey(statusValue);

  if (normalized === "approvedclosed") {
    return COMPLETION_STATUS.APPROVED_CLOSED;
  }

  if (normalized === "completedforreview" || normalized === "completed") {
    return COMPLETION_STATUS.COMPLETED_FOR_REVIEW;
  }

  if (normalized === "notcompleted") {
    return COMPLETION_STATUS.NOT_COMPLETED;
  }

  return isCompleted ? COMPLETION_STATUS.COMPLETED_FOR_REVIEW : COMPLETION_STATUS.NOT_COMPLETED;
};

const getNextCompletionStatus = (statusValue) => {
  const normalizedStatus = normalizeCompletionStatus(statusValue);
  const currentIndex = COMPLETION_STATUS_FLOW.indexOf(normalizedStatus);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (safeIndex + 1) % COMPLETION_STATUS_FLOW.length;
  return COMPLETION_STATUS_FLOW[nextIndex];
};

const getCompletionStatusLabel = (statusValue) => {
  const normalizedStatus = normalizeCompletionStatus(statusValue);

  if (normalizedStatus === COMPLETION_STATUS.COMPLETED_FOR_REVIEW) {
    return "Completed for Review";
  }

  if (normalizedStatus === COMPLETION_STATUS.APPROVED_CLOSED) {
    return "Approved /Closed";
  }

  return "Not Completed";
};

const getCompletionStatusButtonColor = (statusValue) => {
  const normalizedStatus = normalizeCompletionStatus(statusValue);

  if (normalizedStatus === COMPLETION_STATUS.COMPLETED_FOR_REVIEW) {
    return "#15803D";
  }

  if (normalizedStatus === COMPLETION_STATUS.APPROVED_CLOSED) {
    return "#0F766E";
  }

  return "#475569";
};

const getCompletionLogEventLabel = (statusValue) => {
  const normalizedStatus = normalizeCompletionStatus(statusValue);

  if (normalizedStatus === COMPLETION_STATUS.COMPLETED_FOR_REVIEW) {
    return "Marked Completed for Review";
  }

  if (normalizedStatus === COMPLETION_STATUS.APPROVED_CLOSED) {
    return "Marked Approved /Closed";
  }

  return "Marked Not Completed";
};

const getCompletionTransitionLabel = (fromStatusValue, toStatusValue) => {
  const fromLabel = getCompletionStatusLabel(fromStatusValue);
  const toLabel = getCompletionStatusLabel(toStatusValue);
  return `${fromLabel} -> ${toLabel}`;
};

const getTagPalette = (tag, { muted = false } = {}) => {
  const normalized = normalizeKey(tag) || "tag";
  let hash = 0;

  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) % 360;
  }

  if (muted) {
    return {
      backgroundColor: `hsl(${hash} 25% 95%)`,
      borderColor: `hsl(${hash} 20% 86%)`,
      textColor: `hsl(${hash} 35% 28%)`,
    };
  }

  return {
    backgroundColor: `hsl(${hash} 92% 94%)`,
    borderColor: `hsl(${hash} 70% 82%)`,
    textColor: `hsl(${hash} 45% 28%)`,
  };
};

const normalizeLessonsLearned = (value = []) => {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      if (typeof entry === "string") {
        const text = normalizeValue(entry);
        if (!text) return null;
        return {
          text,
          name: "",
          minimumRequired: "",
          createdAt: 0,
          createdBy: "",
          source: "",
          autoKey: "",
        };
      }

      const text = normalizeValue(entry?.text);
      if (!text) return null;
      return {
        text,
        name: normalizeValue(entry?.name),
        minimumRequired: normalizeValue(entry?.minimumRequired),
        createdAt: Number(entry?.createdAt) || 0,
        createdBy: normalizeValue(entry?.createdBy),
        source: normalizeValue(entry?.source),
        autoKey: normalizeValue(entry?.autoKey),
        questions: normalizeLessonQuestions(entry?.questions),
      };
    })
    .filter(Boolean)
    .sort((left, right) => (Number(right.createdAt) || 0) - (Number(left.createdAt) || 0));
};

const normalizeLessonQuestions = (value = []) => {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      const options = Array.isArray(entry?.options) && entry.options.length > 0 
        ? entry.options.map(o => normalizeValue(o)).filter(o => o)
        : ["Yes", "No"];
      return {
        question: normalizeValue(entry?.question),
        answer: normalizeValue(entry?.answer),
        options,
      };
    })
    .filter((entry) => entry.question);
};

const normalizeLessonsAcknowledgements = (value = []) => {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      const lessonKey = normalizeValue(entry?.lessonKey);
      const lessonText = normalizeValue(entry?.lessonText);
      if (!lessonKey && !lessonText) return null;

      return {
        lessonKey,
        lessonText,
        lessonCreatedAt: Number(entry?.lessonCreatedAt) || 0,
        acknowledgedAt: Number(entry?.acknowledgedAt) || 0,
        acknowledgedByUserId: normalizeValue(entry?.acknowledgedByUserId),
        acknowledgedByEmail: normalizeValue(entry?.acknowledgedByEmail),
        acknowledgedByName: normalizeValue(entry?.acknowledgedByName),
        signature: normalizeValue(entry?.signature),
        dateKey: normalizeValue(entry?.dateKey),
        scheduleTimezone: normalizeValue(entry?.scheduleTimezone),
      };
    })
    .filter(Boolean)
    .sort((left, right) => (Number(right.acknowledgedAt) || 0) - (Number(left.acknowledgedAt) || 0));
};

const getZonedDateKey = (timestamp, timeZone = "America/New_York") => {
  const safeTimestamp = Number(timestamp);
  if (!Number.isFinite(safeTimestamp) || safeTimestamp <= 0) return "";

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: normalizeValue(timeZone) || "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    const parts = formatter.formatToParts(new Date(safeTimestamp));
    const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const year = Number(lookup.year) || 0;
    const month = Number(lookup.month) || 0;
    const day = Number(lookup.day) || 0;

    if (!year || !month || !day) return "";
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  } catch (error) {
    return "";
  }
};

const matchesActiveTimerOwner = ({ entry, userId, userEmail, ownerKey, registeredBy }) => {
  const entryUserId = normalizeValue(entry?.userId);
  const entryUserEmail = normalizeValue(entry?.userEmail);
  const entryOwnerKey = normalizeValue(entry?.ownerKey);
  const entryRegisteredBy = normalizeValue(entry?.registeredBy);

  if (userId && entryUserId === userId) return true;
  if (userEmail && entryUserEmail === userEmail) return true;
  if (ownerKey && entryOwnerKey === ownerKey) return true;
  if (registeredBy && entryRegisteredBy === registeredBy) return true;

  return false;
};

const TagChip = ({ tag, onRemove = null, muted = false }) => {
  const palette = getTagPalette(tag, { muted });

  return (
    <span
      title={tag}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "1px 6px",
        borderRadius: "999px",
        border: `1px solid ${palette.borderColor}`,
        backgroundColor: palette.backgroundColor,
        color: palette.textColor,
        fontWeight: 600,
        fontSize: "0.7rem",
        lineHeight: 1.2,
        maxWidth: "min(150px, 40vw)",
      }}
    >
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {tag}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          style={{
            border: "none",
            background: "transparent",
            color: palette.textColor,
            cursor: "pointer",
            fontWeight: 700,
            fontSize: "0.74rem",
            padding: 0,
            lineHeight: 1,
          }}
          aria-label={`Remove tag ${tag}`}
        >
          ×
        </button>
      )}
    </span>
  );
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

const TimeRotate = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState("board");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [productionCards, setProductionCards] = useState([]);
  const [activeTimer, setActiveTimer] = useState(null);
  const [allActiveTimers, setAllActiveTimers] = useState([]);
  const [currentTick, setCurrentTick] = useState(Date.now());
  const [timeLog, setTimeLog] = useState([]);
  const [editingLogId, setEditingLogId] = useState("");
  const [editingRegisteredBy, setEditingRegisteredBy] = useState("");
  const [editingStartDate, setEditingStartDate] = useState("");
  const [editingStartHour, setEditingStartHour] = useState("12");
  const [editingStartMinute, setEditingStartMinute] = useState("00");
  const [editingStartMeridiem, setEditingStartMeridiem] = useState("AM");
  const [editingEndDate, setEditingEndDate] = useState("");
  const [editingEndHour, setEditingEndHour] = useState("12");
  const [editingEndMinute, setEditingEndMinute] = useState("00");
  const [editingEndMeridiem, setEditingEndMeridiem] = useState("AM");
  const [editingError, setEditingError] = useState("");
  const [logActionError, setLogActionError] = useState("");
  const [isStoppingTimer, setIsStoppingTimer] = useState(false);
  const [activeNoteInput, setActiveNoteInput] = useState("");
  const [activeNoteFile, setActiveNoteFile] = useState(null);
  const [activeNoteError, setActiveNoteError] = useState("");
  const [savingActiveNote, setSavingActiveNote] = useState(false);
  const [taskSearch, setTaskSearch] = useState("");
  const [selectedIssueId, setSelectedIssueId] = useState("");
  const [selectedProjectName, setSelectedProjectName] = useState("");
  const [selectedStatusAgile, setSelectedStatusAgile] = useState("");
  const [selectedTechnicalDirection, setSelectedTechnicalDirection] = useState("");
  const [selectedDataStage, setSelectedDataStage] = useState("");
  const [taskTagsByIdentity, setTaskTagsByIdentity] = useState({});
  const [taskProjectNameByIdentity, setTaskProjectNameByIdentity] = useState({});
  const [taskCompletionByIdentity, setTaskCompletionByIdentity] = useState({});
  const [taskBlockedByIdentity, setTaskBlockedByIdentity] = useState({});
  const [taskBlockedByIssueId, setTaskBlockedByIssueId] = useState({});
  const [taskBlockedByDigits, setTaskBlockedByDigits] = useState({});
  const [projectNameQuickUpdate, setProjectNameQuickUpdate] = useState({
    open: false,
    card: null,
    value: "",
  });
  const [taskTagInputByIdentity, setTaskTagInputByIdentity] = useState({});
  const [showTaskTagInputByIdentity, setShowTaskTagInputByIdentity] = useState({});
  const [savingTaskTagsByIdentity, setSavingTaskTagsByIdentity] = useState({});
  const [savingTaskProjectNameByIdentity, setSavingTaskProjectNameByIdentity] = useState({});
  const [savingTaskCompletionByIdentity, setSavingTaskCompletionByIdentity] = useState({});
  const [editingTaskTags, setEditingTaskTags] = useState([]);
  const [editingTaskTagInput, setEditingTaskTagInput] = useState("");
  const [showEditingLogTagInput, setShowEditingLogTagInput] = useState(false);
  const [hasLoadedActiveTimers, setHasLoadedActiveTimers] = useState(false);
  const [suppressTimerAutoRestore, setSuppressTimerAutoRestore] = useState(false);
  const [logViewMode, setLogViewMode] = useState("mine");
  const [selectedAllLogsUser, setSelectedAllLogsUser] = useState("");
  const [selectedAllLogsStartDate, setSelectedAllLogsStartDate] = useState("");
  const [selectedAllLogsEndDate, setSelectedAllLogsEndDate] = useState("");
  const [organizationUsers, setOrganizationUsers] = useState([]);
  const [inProgressNoteInputs, setInProgressNoteInputs] = useState({});
  const [inProgressNoteFilesByDocId, setInProgressNoteFilesByDocId] = useState({});
  const [savingInProgressNoteByDocId, setSavingInProgressNoteByDocId] = useState({});
  const [inProgressNoteErrorByDocId, setInProgressNoteErrorByDocId] = useState({});
  const [manualSelectedUserId, setManualSelectedUserId] = useState("");
  const [manualSelectedTaskIdentity, setManualSelectedTaskIdentity] = useState("");
  const [manualStartAt, setManualStartAt] = useState("");
  const [manualEndAt, setManualEndAt] = useState("");
  const [manualTotalHours, setManualTotalHours] = useState("1");
  const [manualEntrySaving, setManualEntrySaving] = useState(false);
  const [manualEntryError, setManualEntryError] = useState("");
  const [manualEntrySuccess, setManualEntrySuccess] = useState("");
  const [currentUserSettingsDoc, setCurrentUserSettingsDoc] = useState(null);
  const [pendingLessonItems, setPendingLessonItems] = useState([]);
  const [lessonAcknowledgeChecked, setLessonAcknowledgeChecked] = useState(false);
  const [lessonSignature, setLessonSignature] = useState("");
  const [lessonAckSaving, setLessonAckSaving] = useState(false);
  const [lessonAckError, setLessonAckError] = useState("");
  const [lessonLimitConfig, setLessonLimitConfig] = useState(DEFAULT_LESSON_LIMIT_CONFIG);
  const [lessonFeaturesUnavailable, setLessonFeaturesUnavailable] = useState(false);
  const [lessonSupervisorPinInput, setLessonSupervisorPinInput] = useState("");
  const [lessonQuestionAnswers, setLessonQuestionAnswers] = useState({});
  const [imagePreviewAttachment, setImagePreviewAttachment] = useState(null);
  const signatureCanvasRef = React.useRef(null);
  const signatureDrawingRef = React.useRef({ isDrawing: false, hasDrawn: false });

  const handleOpenImagePreview = useCallback((attachment, event) => {
    if (!isImageAttachment(attachment)) return;
    if (event) event.preventDefault();
    setImagePreviewAttachment(attachment);
  }, []);

  const handleCloseImagePreview = useCallback(() => {
    setImagePreviewAttachment(null);
  }, []);

  const clearSignatureCanvas = () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    signatureDrawingRef.current.hasDrawn = false;
    setLessonSignature("");
    setLessonAckError("");
  };

  const getSignatureDataUrl = () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas || !signatureDrawingRef.current.hasDrawn) return "";
    return canvas.toDataURL("image/png");
  };

  const handleSignaturePointerDown = (event) => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = ((event.touches ? event.touches[0].clientX : event.clientX) - rect.left) * scaleX;
    const y = ((event.touches ? event.touches[0].clientY : event.clientY) - rect.top) * scaleY;
    const ctx = canvas.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(x, y);
    signatureDrawingRef.current.isDrawing = true;
  };

  const handleSignaturePointerMove = (event) => {
    if (!signatureDrawingRef.current.isDrawing) return;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = ((event.touches ? event.touches[0].clientX : event.clientX) - rect.left) * scaleX;
    const y = ((event.touches ? event.touches[0].clientY : event.clientY) - rect.top) * scaleY;
    const ctx = canvas.getContext("2d");
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1E293B";
    ctx.lineTo(x, y);
    ctx.stroke();
    signatureDrawingRef.current.hasDrawn = true;
    setLessonSignature("drawn");
    setLessonAckError("");
  };

  const handleSignaturePointerUp = () => {
    signatureDrawingRef.current.isDrawing = false;
  };

  const resolvedUserId = useMemo(() => {
    return normalizeValue(user?.uid || user?.id || user?.userId);
  }, [user?.id, user?.uid, user?.userId]);

  const resolvedUserEmail = useMemo(() => {
    return normalizeValue(user?.email);
  }, [user?.email]);

  const activeTimerOwnerKey = useMemo(() => {
    return normalizeValue(resolvedUserId || resolvedUserEmail);
  }, [resolvedUserEmail, resolvedUserId]);

  const uploadNoteAttachment = useCallback(async ({ file, targetDocId }) => {
    if (!file) return null;

    if (!storage) {
      throw new Error("Firebase Storage is not available right now.");
    }

    if (file.size > NOTE_ATTACHMENT_MAX_SIZE_BYTES) {
      throw new Error("File is too large. Max size is 50 MB.");
    }

    const safeDocId = normalizeKey(targetDocId) || "active";
    const safeName = sanitizeFileName(file.name);
    const filePath = `churches/${id}/timeRotateNoteAttachments/${safeDocId}/${Date.now()}-${safeName}`;
    const fileRef = storageRef(storage, filePath);

    await uploadBytes(fileRef, file, {
      contentType: normalizeValue(file.type) || "application/octet-stream",
    });

    const url = await getDownloadURL(fileRef);

    return {
      name: safeName,
      url,
      path: filePath,
      contentType: normalizeValue(file.type),
      size: Number(file.size) || 0,
    };
  }, [id]);

  const normalizedUserRole = useMemo(() => normalizeValue(user?.role).toLowerCase(), [user?.role]);
  const normalizedBaseRole = useMemo(() => normalizeValue(user?.baseRole).toLowerCase(), [user?.baseRole]);
  const canModerateInProgressNotes = [normalizedUserRole, normalizedBaseRole].some(
    (role) => role === "admin" || role === "global_admin"
  );

  const activeTimerStorageKey = useMemo(() => {
    const userKey = activeTimerOwnerKey || "anonymous";
    return `${ACTIVE_TIMER_STORAGE_PREFIX}:${id || "unknown"}:${userKey}`;
  }, [activeTimerOwnerKey, id]);

  const routePrefix =
    typeof window !== "undefined" && window.location?.pathname?.includes("/church/")
      ? "/church"
      : "/organization";

  const resolvedUserName = useMemo(() => {
    return normalizeValue(user?.displayName || user?.name || user?.fullName || user?.email || "User");
  }, [user?.displayName, user?.email, user?.fullName, user?.name]);

  useEffect(() => {
    let active = true;

    const loadLessonSettings = async () => {
      if (!id || !activeTimerOwnerKey) {
        if (!active) return;
        setCurrentUserSettingsDoc(null);
        setPendingLessonItems([]);
        setLessonFeaturesUnavailable(false);
        return;
      }

      const candidateDocIds = Array.from(
        new Set(
          [resolvedUserId, activeTimerOwnerKey, resolvedUserEmail]
            .map((value) => normalizeValue(value))
            .filter(Boolean)
        )
      );

      let matchedDoc = null;
      let sawPermissionDenied = false;

      for (const docIdCandidate of candidateDocIds) {
        try {
          const settingsDocRef = doc(db, "churches", id, PAY_EVERYONE_SETTINGS_COLLECTION, docIdCandidate);
          const settingsSnapshot = await getDoc(settingsDocRef);
          if (!settingsSnapshot.exists()) continue;

          const data = settingsSnapshot.data() || {};
          matchedDoc = {
            docId: settingsSnapshot.id,
            userKey: normalizeValue(data.userKey || settingsSnapshot.id),
            userId: normalizeValue(data.userId),
            userEmail: normalizeValue(data.userEmail),
            userLabel: normalizeValue(data.userLabel),
            scheduleTimezone: normalizeValue(data.scheduleTimezone) || "America/New_York",
            lessonsLearned: normalizeLessonsLearned(data.lessonsLearned),
            lessonsAcknowledgements: normalizeLessonsAcknowledgements(data.lessonsAcknowledgements),
          };
          break;
        } catch (settingsError) {
          if (isPermissionDeniedError(settingsError)) {
            sawPermissionDenied = true;
            continue;
          }
          console.error("Error loading lesson acknowledgement settings:", settingsError);
          break;
        }
      }

      if (!active) return;

      setCurrentUserSettingsDoc(matchedDoc);
      setLessonFeaturesUnavailable(sawPermissionDenied);

      if (!matchedDoc) {
        setPendingLessonItems([]);
        return;
      }

      const acknowledgedKeys = new Set(
        matchedDoc.lessonsAcknowledgements
          .map((ack) => normalizeValue(ack.lessonKey))
          .filter(Boolean)
      );

      const nextPendingLessons = matchedDoc.lessonsLearned.filter((lesson) => {
        const lessonKey = `${Number(lesson.createdAt) || 0}::${normalizeValue(lesson.text)}`;
        return !acknowledgedKeys.has(lessonKey);
      });

      setPendingLessonItems(nextPendingLessons);
    };

    loadLessonSettings();

    return () => {
      active = false;
    };
  }, [activeTimerOwnerKey, id, resolvedUserEmail, resolvedUserId]);

  useEffect(() => {
    setLessonQuestionAnswers({});
  }, [pendingLessonItems]);

  useEffect(() => {
    if (!id) {
      setLessonLimitConfig(DEFAULT_LESSON_LIMIT_CONFIG);
      return () => {};
    }

    const unsubscribe = onSnapshot(
      doc(db, "churches", id, PAY_EVERYONE_GLOBAL_SETTINGS_COLLECTION, "lessonLimits"),
      (snapshotDoc) => {
        if (!snapshotDoc.exists()) {
          setLessonLimitConfig(DEFAULT_LESSON_LIMIT_CONFIG);
          return;
        }

        const data = snapshotDoc.data() || {};
        setLessonLimitConfig(normalizeLessonLimitConfig(data));
      },
      (snapshotError) => {
        if (!isPermissionDeniedError(snapshotError)) {
          console.error("Error loading lesson limit config:", snapshotError);
        }
        setLessonLimitConfig(DEFAULT_LESSON_LIMIT_CONFIG);
      }
    );

    return () => unsubscribe();
  }, [id]);

  const todayPerformanceContext = useMemo(() => {
    if (!currentUserSettingsDoc) return null;

    const tz = normalizeValue(currentUserSettingsDoc.scheduleTimezone) || "America/New_York";
    const now = Date.now();
    const todayKey = getZonedDateKey(now, tz);
    if (!todayKey) return null;

    const expectedSchedule = currentUserSettingsDoc.expectedSchedule || {};
    const dayFormatter = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
    const weekday = dayFormatter.format(new Date(now));
    const expectedTimeStr = expectedSchedule[weekday] || "07:00";
    const [expH, expM] = expectedTimeStr.split(":").map(Number);
    const expectedMinutes = (expH || 7) * 60 + (expM || 0);

    const myLogs = timeLog.filter((entry) => {
      const ts = Number(entry.startedAt) || Number(entry.endedAt) || 0;
      if (!ts) return false;
      if (normalizeValue(entry.logType) === "completion") return false;
      if (getZonedDateKey(ts, tz) !== todayKey) return false;

      const uid = normalizeValue(entry.userId);
      const email = normalizeValue(entry.userEmail);
      const byName = normalizeValue(entry.registeredBy);
      return (
        (resolvedUserId && uid === resolvedUserId) ||
        (resolvedUserEmail && (email === resolvedUserEmail || byName === resolvedUserEmail)) ||
        (resolvedUserName && byName === resolvedUserName)
      );
    });

    let firstStartMs = 0;
    let totalNotesCount = 0;
    myLogs.forEach((entry) => {
      const ts = Number(entry.startedAt) || 0;
      if (ts && (!firstStartMs || ts < firstStartMs)) firstStartMs = ts;
      if (Array.isArray(entry.notes)) totalNotesCount += entry.notes.length;
    });

    let lateMinutes = 0;
    let actualTimeLabel = "No sign-in recorded today";
    if (firstStartMs) {
      const zonedParts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }).formatToParts(new Date(firstStartMs));
      const pLookup = Object.fromEntries(zonedParts.map((p) => [p.type, p.value]));
      const actualH = Number(pLookup.hour) || 0;
      const actualM = Number(pLookup.minute) || 0;
      const meridiem = normalizeValue(pLookup.dayPeriod || pLookup.ampm || "").toUpperCase() || "AM";
      actualTimeLabel = `${actualH}:${String(actualM).padStart(2, "0")} ${meridiem} (${tz})`;

      const actualTotalMinutes = (() => {
        const zonedHourParts = new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).formatToParts(new Date(firstStartMs));
        const hLookup = Object.fromEntries(zonedHourParts.map((p) => [p.type, p.value]));
        return (Number(hLookup.hour) || 0) * 60 + (Number(hLookup.minute) || 0);
      })();

      lateMinutes = actualTotalMinutes - expectedMinutes;
    }

    const allOtherUserNotes = {};
    timeLog.forEach((entry) => {
      if (getZonedDateKey(Number(entry.startedAt) || 0, tz) !== todayKey) return;
      if (normalizeValue(entry.logType) === "completion") return;
      const key = normalizeValue(entry.userId || entry.userEmail || entry.registeredBy);
      if (!key) return;
      if (!allOtherUserNotes[key]) allOtherUserNotes[key] = { label: normalizeValue(entry.registeredBy || entry.userEmail || entry.userId), count: 0 };
      if (Array.isArray(entry.notes)) allOtherUserNotes[key].count += entry.notes.length;
    });

    const topPeer = Object.values(allOtherUserNotes)
      .filter((peer) => peer.count > totalNotesCount)
      .sort((a, b) => b.count - a.count)[0] || null;

    const expH12 = expH % 12 || 12;
    const expSuffix = expH >= 12 ? "PM" : "AM";
    const expectedTimeLabel = `${expH12}:${String(expM || 0).padStart(2, "0")} ${expSuffix} (${tz})`;

    const dateDisplayFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    return {
      todayKey,
      dateLabel: dateDisplayFormatter.format(new Date(now)),
      expectedTimeLabel,
      actualTimeLabel,
      lateMinutes,
      isLate: lateMinutes > 1,
      isAbsent: !firstStartMs,
      totalNotesCount,
      topPeer,
      weekday,
      tz,
    };
  }, [currentUserSettingsDoc, resolvedUserEmail, resolvedUserId, resolvedUserName, timeLog]);

  const pendingLessonLimitInfo = useMemo(() => {
    const normalizedConfig = normalizeLessonLimitConfig(lessonLimitConfig);
    const configuredLessonName = normalizeValue(normalizedConfig.lessonName).toLowerCase();
    const infoByLessonKey = {};

    if (!currentUserSettingsDoc || pendingLessonItems.length === 0) {
      return {
        byLessonKey: infoByLessonKey,
        requiresSupervisorPin: false,
      };
    }

    const allLessons = normalizeLessonsLearned(currentUserSettingsDoc.lessonsLearned);
    const now = Date.now();
    const boundaryDate = new Date(now);
    boundaryDate.setHours(0, 0, 0, 0);

    if (normalizedConfig.period === "week") {
      const mondayOffset = (boundaryDate.getDay() + 6) % 7;
      boundaryDate.setDate(boundaryDate.getDate() - mondayOffset);
    } else if (normalizedConfig.period === "month") {
      boundaryDate.setDate(1);
    } else if (normalizedConfig.period === "year") {
      boundaryDate.setMonth(0, 1);
    }

    const startBoundaryMs = boundaryDate.getTime();
    let requiresSupervisorPin = false;

    pendingLessonItems.forEach((lesson) => {
      const lessonKey = `${Number(lesson.createdAt) || 0}::${normalizeValue(lesson.text)}`;
      const lessonName = normalizeValue(lesson.name).toLowerCase();
      const appliesToLesson =
        normalizedConfig.enabled
        && Number(normalizedConfig.maxCount) > 0
        && Boolean(configuredLessonName)
        && lessonName === configuredLessonName;

      if (!appliesToLesson) {
        infoByLessonKey[lessonKey] = {
          applies: false,
          remainingCount: null,
          countInPeriod: 0,
          maxCount: Number(normalizedConfig.maxCount) || 0,
          period: normalizedConfig.period,
        };
        return;
      }

      const countInPeriod = allLessons.filter((savedLesson) => {
        const createdAtMs = Number(savedLesson?.createdAt) || 0;
        const savedLessonName = normalizeValue(savedLesson?.name).toLowerCase();
        return createdAtMs >= startBoundaryMs && createdAtMs <= now && savedLessonName === configuredLessonName;
      }).length;

      const remainingCount = Math.max(0, Number(normalizedConfig.maxCount) - countInPeriod);
      const requiresPinForLesson = countInPeriod >= Number(normalizedConfig.maxCount);
      if (requiresPinForLesson) requiresSupervisorPin = true;

      infoByLessonKey[lessonKey] = {
        applies: true,
        remainingCount,
        countInPeriod,
        maxCount: Number(normalizedConfig.maxCount),
        period: normalizedConfig.period,
        requiresPinForLesson,
      };
    });

    return {
      byLessonKey: infoByLessonKey,
      requiresSupervisorPin,
    };
  }, [currentUserSettingsDoc, lessonLimitConfig, pendingLessonItems]);

  const lessonQuestionValidation = useMemo(() => {
    let totalRequired = 0;
    let correctCount = 0;

    pendingLessonItems.forEach((lesson) => {
      const lessonKey = `${Number(lesson.createdAt) || 0}::${normalizeValue(lesson.text)}`;
      const questions = lesson.questions || [];

      questions.forEach((entry, questionIndex) => {
        totalRequired += 1;
        const answerKey = `${lessonKey}::q${questionIndex}`;
        const typedAnswer = normalizeValue(lessonQuestionAnswers[answerKey]).toLowerCase();
        const expectedAnswer = normalizeValue(entry.answer).toLowerCase();
        if (typedAnswer && typedAnswer === expectedAnswer) correctCount += 1;
      });
    });

    return {
      totalRequired,
      correctCount,
      allCorrect: totalRequired === 0 ? true : correctCount === totalRequired,
    };
  }, [lessonQuestionAnswers, pendingLessonItems]);

  const handleAcknowledgePendingLessons = useCallback(async () => {
    if (!id || !currentUserSettingsDoc || pendingLessonItems.length === 0) return;

    if (!lessonAcknowledgeChecked) {
      setLessonAckError("Please acknowledge the lessons before signing.");
      return;
    }

    if (lessonQuestionValidation.totalRequired > 0 && !lessonQuestionValidation.allCorrect) {
      setLessonAckError(`Please answer all lesson questions correctly before continuing (${lessonQuestionValidation.correctCount}/${lessonQuestionValidation.totalRequired} correct).`);
      return;
    }

    if (pendingLessonLimitInfo.requiresSupervisorPin) {
      const normalizedConfig = normalizeLessonLimitConfig(lessonLimitConfig);
      if (!normalizedConfig.supervisorPin) {
        setLessonAckError("Supervisor PIN is required, but no PIN is configured. Ask a supervisor to set it in PayEveryone -> Lessons Submitted.");
        return;
      }

      const enteredPin = normalizeValue(lessonSupervisorPinInput);
      if (!enteredPin) {
        setLessonAckError("Supervisor PIN is required because lesson limit was exceeded.");
        return;
      }

      if (enteredPin !== normalizedConfig.supervisorPin) {
        setLessonAckError("Invalid supervisor PIN.");
        return;
      }
    }

    const signatureDataUrl = getSignatureDataUrl();
    if (!signatureDrawingRef.current.hasDrawn || !signatureDataUrl) {
      setLessonAckError("Please draw your signature to continue.");
      return;
    }
    const normalizedSignature = signatureDataUrl;

    const now = Date.now();
    const dateKey = getZonedDateKey(now, currentUserSettingsDoc.scheduleTimezone || "America/New_York");
    const existingAcknowledgements = normalizeLessonsAcknowledgements(currentUserSettingsDoc.lessonsAcknowledgements);
    const newAcknowledgements = pendingLessonItems.map((lesson) => ({
      lessonKey: `${Number(lesson.createdAt) || 0}::${normalizeValue(lesson.text)}`,
      lessonText: normalizeValue(lesson.text),
      lessonCreatedAt: Number(lesson.createdAt) || 0,
      acknowledgedAt: now,
      acknowledgedByUserId: normalizeValue(resolvedUserId),
      acknowledgedByEmail: normalizeValue(resolvedUserEmail),
      acknowledgedByName: normalizeValue(resolvedUserName),
      signature: normalizedSignature,
      dateKey,
      scheduleTimezone: normalizeValue(currentUserSettingsDoc.scheduleTimezone) || "America/New_York",
    }));

    setLessonAckSaving(true);
    setLessonAckError("");

    try {
      await setDoc(
        doc(db, "churches", id, PAY_EVERYONE_SETTINGS_COLLECTION, currentUserSettingsDoc.docId || currentUserSettingsDoc.userKey),
        {
          userKey: normalizeValue(currentUserSettingsDoc.userKey || currentUserSettingsDoc.docId),
          userId: normalizeValue(currentUserSettingsDoc.userId || resolvedUserId),
          userEmail: normalizeValue(currentUserSettingsDoc.userEmail || resolvedUserEmail),
          userLabel: normalizeValue(currentUserSettingsDoc.userLabel || resolvedUserName),
          lessonsAcknowledgements: [...newAcknowledgements, ...existingAcknowledgements],
          updatedAt: now,
        },
        { merge: true }
      );

      setLessonAcknowledgeChecked(false);
      setLessonSignature("");
      setLessonAckError("");
      setLessonSupervisorPinInput("");
      clearSignatureCanvas();
    } catch (ackError) {
      console.error("Error saving lesson acknowledgement receipt:", ackError);
      setLessonAckError("Could not save lesson acknowledgement. Please try again.");
    } finally {
      setLessonAckSaving(false);
    }
  }, [
    currentUserSettingsDoc,
    id,
    lessonAcknowledgeChecked,
    lessonQuestionValidation,
    lessonLimitConfig,
    lessonSignature,
    lessonSupervisorPinInput,
    pendingLessonLimitInfo,
    pendingLessonItems,
    resolvedUserEmail,
    resolvedUserId,
    resolvedUserName,
  ]);

  useEffect(() => {
    if (!id) {
      setError("Organization ID is missing.");
      setLoading(false);
      return () => {};
    }

    const projectsRef = collection(db, "churches", id, "bimProjects");

    const unsubscribe = onSnapshot(
      projectsRef,
      async (snapshot) => {
        const nextCards = [];

        for (const projectDoc of snapshot.docs) {
          const projectData = projectDoc.data() || {};
          const fields = Array.isArray(projectData.fields) ? projectData.fields : [];

          const issuesRef = collection(db, "churches", id, "bimProjects", projectDoc.id, "issues");
          const issuesSnap = await getDocs(issuesRef);

          issuesSnap.docs.forEach((issueDoc, rowIndex) => {
            const rowData = issueDoc.data() || {};

            const dataStageField = findFieldByAliases(fields, rowData, DATA_STAGE_ALIASES) || "Data Stage";
            const dataStage = normalizeValue(rowData[dataStageField]);

            if (dataStage.toLowerCase() !== "production") {
              return;
            }

            const issueIdField = findFieldByAliases(fields, rowData, ISSUE_ID_ALIASES);
            const titleField = findFieldByAliases(fields, rowData, TITLE_ALIASES);
            const projectNameField = findFieldByAliases(fields, rowData, PROJECT_NAME_ALIASES);
            const statusField = findFieldByAliases(fields, rowData, E2_STATUS_ALIASES) || "E2 Status Update Agile";
            const detailerField = findFieldByAliases(fields, rowData, LEAD_DETAILER_ALIASES);
            const supportTeamField = findFieldByAliases(fields, rowData, SUPPORT_TEAM_ALIASES);
            const technicalDirectionField =
              findFieldByAliases(fields, rowData, TECHNICAL_DIRECTION_ALIASES) || "Technical Direction";
            const taskDescriptionField = findFieldByAliases(fields, rowData, TASK_DESCRIPTION_ALIASES);

            const issueId = normalizeValue(issueIdField ? rowData[issueIdField] : "") || String(rowIndex + 1);
            const taskIdentity = buildTaskIdentity(projectDoc.id, issueId);

            nextCards.push({
              key: `${projectDoc.id}-${issueDoc.id}`,
              projectDocId: projectDoc.id,
              taskIdentity,
              issueId,
              title: normalizeValue(titleField ? rowData[titleField] : ""),
              projectName: normalizeValue(projectNameField ? rowData[projectNameField] : ""),
              statusAgile: normalizeValue(statusField ? rowData[statusField] : ""),
              leadDetailer: normalizeValue(detailerField ? rowData[detailerField] : ""),
              supportTeam: Array.isArray(rowData[supportTeamField])
                ? rowData[supportTeamField].map((item) => normalizeValue(item)).filter(Boolean).join(", ")
                : normalizeValue(supportTeamField ? rowData[supportTeamField] : ""),
              technicalDirection: normalizeValue(technicalDirectionField ? rowData[technicalDirectionField] : ""),
              taskTags: parseTagsFromValue(taskDescriptionField ? rowData[taskDescriptionField] : ""),
              dataStage,
            });
          });
        }

        nextCards.sort((left, right) => left.issueId.localeCompare(right.issueId));
        setProductionCards(nextCards);
        setLoading(false);
        setError("");
      },
      (snapshotError) => {
        console.error("Error loading TimeRotate cards:", snapshotError);
        setError("Failed to load production cards.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [id]);

  useEffect(() => {
    if (!id) {
      return () => {};
    }

    const unsubscribe = onSnapshot(
      collection(db, "churches", id, "timeRotateTaskDetails"),
      (snapshot) => {
        const nextTagsMap = {};
        const nextProjectNameMap = {};
        const nextCompletionMap = {};
        const nextBlockedMap = {};
        const nextBlockedByIssueIdMap = {};
        const nextBlockedByDigitsMap = {};

        snapshot.forEach((snapshotDoc) => {
          const data = snapshotDoc.data() || {};
          const taskIdentity = normalizeValue(data.taskIdentity);
          if (!taskIdentity) {
            return;
          }

          nextTagsMap[taskIdentity] = parseTagsFromValue(data.tags ?? data.description);
          if (Object.prototype.hasOwnProperty.call(data, "projectNameOverride")) {
            nextProjectNameMap[taskIdentity] = normalizeValue(data.projectNameOverride);
          } else if (Object.prototype.hasOwnProperty.call(data, "projectName")) {
            nextProjectNameMap[taskIdentity] = normalizeValue(data.projectName);
          }
          nextCompletionMap[taskIdentity] = normalizeCompletionStatus(data.completionStatus, data.isCompleted === true);
          const isBlocked = data.timeEntryBlocked === true;
          nextBlockedMap[taskIdentity] = isBlocked;
          // A TD can produce slightly different task identities over time (e.g. project doc id
          // drift), so also index blocked status by the bare TD/issue id as a fallback match.
          const issueIdSuffix = String(taskIdentity.split("::").pop() || "").trim().toLowerCase();
          if (issueIdSuffix && (isBlocked || !Object.prototype.hasOwnProperty.call(nextBlockedByIssueIdMap, issueIdSuffix))) {
            nextBlockedByIssueIdMap[issueIdSuffix] = isBlocked;
          }
          // The TD number itself can gain/lose a "TD-" style prefix between when a historical log
          // was written and how the sheet reads today, so also fall back to matching by digits only.
          const issueIdDigits = issueIdSuffix.replace(/[^0-9]/g, "");
          if (issueIdDigits && (isBlocked || !Object.prototype.hasOwnProperty.call(nextBlockedByDigitsMap, issueIdDigits))) {
            nextBlockedByDigitsMap[issueIdDigits] = isBlocked;
          }
        });

        setTaskTagsByIdentity(nextTagsMap);
        setTaskProjectNameByIdentity(nextProjectNameMap);
        setTaskCompletionByIdentity(nextCompletionMap);
        setTaskBlockedByIdentity(nextBlockedMap);
        setTaskBlockedByIssueId(nextBlockedByIssueIdMap);
        setTaskBlockedByDigits(nextBlockedByDigitsMap);
      },
      (snapshotError) => {
        console.error("Error loading task descriptions:", snapshotError);
      }
    );

    return () => unsubscribe();
  }, [id]);

  useEffect(() => {
    if (!id) {
      return () => {};
    }

    const organizationUsersQuery = query(collection(db, "users"), where("churchId", "==", id));

    const unsubscribe = onSnapshot(
      organizationUsersQuery,
      (snapshot) => {
        const nextUsers = snapshot.docs
          .map((snapshotDoc) => {
            const data = snapshotDoc.data() || {};
            const firstName = normalizeValue(data.firstName || data.name);
            const lastName = normalizeValue(data.lastName);
            const email = normalizeValue(data.email);
            const displayName = normalizeValue(data.displayName);
            const fullName = normalizeValue([firstName, lastName].filter(Boolean).join(" "));
            const label =
              fullName ||
              displayName ||
              email ||
              `User ${snapshotDoc.id}`;
            const aliases = Array.from(
              new Set(
                [
                  snapshotDoc.id,
                  fullName,
                  displayName,
                  email,
                  normalizeValue(data.name),
                  normalizeValue(data.firstName),
                  normalizeValue(data.lastName),
                ]
                  .map((value) => normalizeValue(value))
                  .filter(Boolean)
              )
            );

            return {
              value: snapshotDoc.id,
              label,
              email,
              aliases,
            };
          })
          .sort((left, right) => left.label.localeCompare(right.label));

        setOrganizationUsers(nextUsers);
      },
      (snapshotError) => {
        console.error("Error loading organization users for TimeRotate filter:", snapshotError);
      }
    );

    return () => unsubscribe();
  }, [id]);

  useEffect(() => {
    if (!id) {
      return () => {};
    }

    const unsubscribe = onSnapshot(
      collection(db, "churches", id, ACTIVE_TIMER_COLLECTION),
      (snapshot) => {
        const nextActiveTimers = snapshot.docs
          .map((snapshotDoc) => {
            const data = snapshotDoc.data() || {};
            return {
              docId: snapshotDoc.id,
              cardKey: normalizeValue(data.cardKey),
              startedAt: Number(data.startedAt) || 0,
              updatedAt: Number(data.updatedAt) || 0,
              issueId: normalizeValue(data.issueId),
              projectName: normalizeValue(data.projectName),
              statusAgile: normalizeValue(data.statusAgile),
              technicalDirection: normalizeValue(data.technicalDirection),
              taskTags: parseTagsFromValue(data.taskTags ?? data.taskDescription),
              registeredBy: normalizeValue(data.registeredBy),
              userId: normalizeValue(data.userId),
              userEmail: normalizeValue(data.userEmail),
              ownerKey: normalizeValue(data.ownerKey),
              notes: normalizeNotesArray(data.notes),
            };
          })
          .filter((entry) => Number.isFinite(entry.startedAt) && entry.startedAt > 0)
          .sort((left, right) => right.startedAt - left.startedAt);

        setAllActiveTimers(nextActiveTimers);
        setHasLoadedActiveTimers(true);
      },
      (snapshotError) => {
        console.error("Error loading active TimeRotate timers:", snapshotError);
        setHasLoadedActiveTimers(true);
      }
    );

    return () => unsubscribe();
  }, [id]);

  useEffect(() => {
    if (!id) {
      return () => {};
    }

    const logsQuery = query(collection(db, "churches", id, "timeRotateLogs"));

    const unsubscribe = onSnapshot(
      logsQuery,
      (snapshot) => {
        const nextLogs = snapshot.docs.map((snapshotDoc) => {
          const data = snapshotDoc.data() || {};
          return {
            id: snapshotDoc.id,
            logType: normalizeValue(data.logType) || "timer",
            issueId: normalizeValue(data.issueId),
            projectName: normalizeValue(data.projectName),
            statusAgile: normalizeValue(data.statusAgile),
            technicalDirection: normalizeValue(data.technicalDirection),
            taskTags: parseTagsFromValue(data.taskTags ?? data.taskDescription),
            completionStatus: normalizeValue(data.completionStatus),
            completionFromStatus: normalizeValue(data.completionFromStatus),
            completionToStatus: normalizeValue(data.completionToStatus),
            completionAt: Number(data.completionAt) || 0,
            startedAt: Number(data.startedAt) || 0,
            endedAt: Number(data.endedAt) || 0,
            durationMs: Number(data.durationMs) || 0,
            registeredBy: normalizeValue(data.registeredBy),
            userId: normalizeValue(data.userId),
            notes: normalizeNotesArray(data.notes),
          };
        });

        nextLogs.sort((left, right) => right.endedAt - left.endedAt);
        setTimeLog(nextLogs);
      },
      (snapshotError) => {
        console.error("Error loading TimeRotate logs:", snapshotError);
        setLogActionError("Unable to load saved time logs.");
      }
    );

    return () => unsubscribe();
  }, [id]);

  useEffect(() => {
    if (!id || typeof window === "undefined") {
      return;
    }

    try {
      const rawValue = window.localStorage.getItem(activeTimerStorageKey);
      if (!rawValue) {
        return;
      }

      const parsedValue = JSON.parse(rawValue);
      const startedAt = Number(parsedValue?.startedAt);

      if (!parsedValue || !parsedValue.cardKey || !Number.isFinite(startedAt) || startedAt <= 0) {
        window.localStorage.removeItem(activeTimerStorageKey);
        return;
      }

      setActiveTimer({
        cardKey: normalizeValue(parsedValue.cardKey),
        startedAt,
        issueId: normalizeValue(parsedValue.issueId),
        projectName: normalizeValue(parsedValue.projectName),
        statusAgile: normalizeValue(parsedValue.statusAgile),
        technicalDirection: normalizeValue(parsedValue.technicalDirection),
        taskTags: parseTagsFromValue(parsedValue.taskTags ?? parsedValue.taskDescription),
        notes: normalizeNotesArray(parsedValue.notes).map((note) => ({
          ...note,
          timestamp: Number(note.timestamp) || Date.now(),
        })),
      });
      setCurrentTick(Date.now());
    } catch (restoreError) {
      console.error("Error restoring active timer:", restoreError);
      window.localStorage.removeItem(activeTimerStorageKey);
    }
  }, [activeTimerStorageKey, id]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!activeTimer) {
      window.localStorage.removeItem(activeTimerStorageKey);
      return;
    }

    try {
      window.localStorage.setItem(activeTimerStorageKey, JSON.stringify(activeTimer));
    } catch (persistError) {
      console.error("Error persisting active timer:", persistError);
    }
  }, [activeTimer, activeTimerStorageKey]);

  useEffect(() => {
    const currentUserId = normalizeValue(resolvedUserId);
    const currentUserEmail = normalizeValue(resolvedUserEmail);
    const currentOwnerKey = normalizeValue(activeTimerOwnerKey);
    const currentRegisteredBy = normalizeValue(user?.name || user?.displayName || user?.email);

    const matchedTimer = allActiveTimers
      .filter((entry) => {
        const entryUserId = normalizeValue(entry?.userId);
        const entryUserEmail = normalizeValue(entry?.userEmail);
        const entryOwnerKey = normalizeValue(entry?.ownerKey);
        const entryRegisteredBy = normalizeValue(entry?.registeredBy);

        if (currentUserId && entryUserId === currentUserId) return true;
        if (currentUserEmail && entryUserEmail === currentUserEmail) return true;
        if (currentOwnerKey && entryOwnerKey === currentOwnerKey) return true;
        if (currentRegisteredBy && entryRegisteredBy === currentRegisteredBy) return true;

        return false;
      })
      .sort((left, right) => {
        const rightStartedAt = Number(right.startedAt) || 0;
        const leftStartedAt = Number(left.startedAt) || 0;
        if (rightStartedAt !== leftStartedAt) {
          return rightStartedAt - leftStartedAt;
        }
        return (Number(right.updatedAt) || 0) - (Number(left.updatedAt) || 0);
      })[0];

    if (!matchedTimer) {
      if (activeTimer?.source === "remote") {
        setActiveTimer(null);
        setCurrentTick(Date.now());
      }

      if (suppressTimerAutoRestore) {
        setSuppressTimerAutoRestore(false);
      }

      return;
    }

    if (suppressTimerAutoRestore) {
      return;
    }

    const mappedRemoteTimer = {
      cardKey: normalizeValue(matchedTimer.cardKey),
      startedAt: Number(matchedTimer.startedAt) || Date.now(),
      issueId: normalizeValue(matchedTimer.issueId),
      projectName: normalizeValue(matchedTimer.projectName),
      statusAgile: normalizeValue(matchedTimer.statusAgile),
      technicalDirection: normalizeValue(matchedTimer.technicalDirection),
      taskTags: parseTagsFromValue(matchedTimer.taskTags),
      notes: normalizeNotesArray(matchedTimer.notes).map((note) => ({
        ...note,
        timestamp: Number(note.timestamp) || Date.now(),
      })),
      updatedAt: Number(matchedTimer.updatedAt) || Date.now(),
      source: "remote",
    };

    const hasSameRemoteSnapshot =
      activeTimer &&
      activeTimer.source === "remote" &&
      Number(activeTimer.updatedAt || 0) === Number(mappedRemoteTimer.updatedAt || 0) &&
      normalizeValue(activeTimer.issueId) === normalizeValue(mappedRemoteTimer.issueId) &&
      Number(activeTimer.startedAt || 0) === Number(mappedRemoteTimer.startedAt || 0) &&
      (Array.isArray(activeTimer.notes) ? activeTimer.notes.length : 0) ===
        (Array.isArray(mappedRemoteTimer.notes) ? mappedRemoteTimer.notes.length : 0);

    const shouldReplaceLocal =
      !activeTimer ||
      activeTimer.source === "remote" ||
      Number(mappedRemoteTimer.updatedAt) >= Number(activeTimer.updatedAt || 0);

    if (shouldReplaceLocal && !hasSameRemoteSnapshot) {
      setActiveTimer(mappedRemoteTimer);
      setCurrentTick(Date.now());
    }
  }, [activeTimer, activeTimerOwnerKey, allActiveTimers, resolvedUserEmail, resolvedUserId, suppressTimerAutoRestore, user?.displayName, user?.email, user?.name]);

  useEffect(() => {
    if (!id || !activeTimerOwnerKey) {
      return;
    }

    const activeTimerDocRef = doc(db, "churches", id, ACTIVE_TIMER_COLLECTION, normalizeKey(activeTimerOwnerKey) || activeTimerOwnerKey);
    const currentUserId = normalizeValue(resolvedUserId);
    const currentUserEmail = normalizeValue(resolvedUserEmail);
    const currentOwnerKey = normalizeValue(activeTimerOwnerKey);
    const currentRegisteredBy = normalizeValue(user?.name || user?.displayName || user?.email);

    if (!activeTimer) {
      if (!hasLoadedActiveTimers) {
        return;
      }

      // Only clear remote timers after an explicit stop action.
      if (!suppressTimerAutoRestore) {
        return;
      }

      const matchingRemoteTimerDocIds = Array.from(
        new Set(
          allActiveTimers
            .filter((entry) =>
              matchesActiveTimerOwner({
                entry,
                userId: currentUserId,
                userEmail: currentUserEmail,
                ownerKey: currentOwnerKey,
                registeredBy: currentRegisteredBy,
              })
            )
            .map((entry) => normalizeValue(entry.docId))
            .filter(Boolean)
        )
      );

      if (matchingRemoteTimerDocIds.length > 0) {
        Promise.allSettled(
          matchingRemoteTimerDocIds.map((docId) =>
            deleteDoc(doc(db, "churches", id, ACTIVE_TIMER_COLLECTION, docId))
          )
        ).then((results) => {
          if (results.some((result) => result.status === "rejected")) {
            console.error("Error clearing matched TimeRotate timers:", results);
          }
        });
        return;
      }

      deleteDoc(activeTimerDocRef).catch((deleteError) => {
        console.error("Error clearing active TimeRotate timer:", deleteError);
      });
      return;
    }

    if (normalizeValue(activeTimer.source) === "remote") {
      return;
    }

    setDoc(
      activeTimerDocRef,
      {
        churchId: id,
        userId: resolvedUserId,
        userEmail: resolvedUserEmail,
        ownerKey: activeTimerOwnerKey,
        registeredBy: user?.name || user?.displayName || user?.email || "Unknown user",
        cardKey: activeTimer.cardKey,
        startedAt: Number(activeTimer.startedAt) || Date.now(),
        issueId: normalizeValue(activeTimer.issueId),
        projectName: normalizeValue(activeTimer.projectName),
        statusAgile: normalizeValue(activeTimer.statusAgile),
        technicalDirection: normalizeValue(activeTimer.technicalDirection),
        taskTags: parseTagsFromValue(activeTimer.taskTags),
        taskDescription: parseTagsFromValue(activeTimer.taskTags).join(", "),
        notes: Array.isArray(activeTimer.notes) ? activeTimer.notes : [],
        updatedAt: Number(activeTimer.updatedAt) || Date.now(),
      },
      { merge: true }
    ).catch((saveError) => {
      console.error("Error syncing active TimeRotate timer:", saveError);
    });
  }, [activeTimer, activeTimerOwnerKey, allActiveTimers, hasLoadedActiveTimers, id, resolvedUserEmail, resolvedUserId, suppressTimerAutoRestore, user?.displayName, user?.email, user?.name]);

  useEffect(() => {
    if (!activeTimer) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setCurrentTick(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [activeTimer]);

  useEffect(() => {
    if (activeWorkspaceTab !== "manual") {
      return;
    }

    const now = Date.now();

    if (!manualStartAt) {
      setManualStartAt(toDateTimeLocalValue(now - (60 * 60 * 1000)));
    }

    if (!manualEndAt) {
      setManualEndAt(toDateTimeLocalValue(now));
    }
  }, [activeWorkspaceTab, manualEndAt, manualStartAt]);

  const activeDuration = activeTimer ? currentTick - activeTimer.startedAt : 0;

  const visibleInProgressTimers = useMemo(() => {
    if (logViewMode === "all") {
      return allActiveTimers;
    }

    const currentUserId = normalizeValue(resolvedUserId);
    if (currentUserId) {
      const byUserId = allActiveTimers.filter((entry) => normalizeValue(entry.userId) === currentUserId);
      if (byUserId.length > 0) {
        return byUserId;
      }
    }

    const currentUserEmail = normalizeValue(resolvedUserEmail);
    if (currentUserEmail) {
      const byUserEmail = allActiveTimers.filter((entry) => normalizeValue(entry.userEmail) === currentUserEmail);
      if (byUserEmail.length > 0) {
        return byUserEmail;
      }
    }

    const currentOwnerKey = normalizeValue(activeTimerOwnerKey);
    if (currentOwnerKey) {
      const byOwnerKey = allActiveTimers.filter((entry) => normalizeValue(entry.ownerKey) === currentOwnerKey);
      if (byOwnerKey.length > 0) {
        return byOwnerKey;
      }
    }

    const fallbackRegisteredBy = normalizeValue(user?.name || user?.displayName || user?.email);
    if (!fallbackRegisteredBy) {
      return allActiveTimers;
    }

    return allActiveTimers.filter((entry) => normalizeValue(entry.registeredBy) === fallbackRegisteredBy);
  }, [activeTimerOwnerKey, allActiveTimers, logViewMode, resolvedUserEmail, resolvedUserId, user?.displayName, user?.email, user?.name]);

  const issueIdOptions = useMemo(() => {
    return Array.from(new Set(productionCards.map((card) => card.issueId).filter(Boolean))).sort((left, right) => left.localeCompare(right));
  }, [productionCards]);

  const getResolvedProjectName = useCallback((card) => {
    const taskIdentity = card?.taskIdentity;
    if (!taskIdentity) {
      return normalizeValue(card?.projectName);
    }

    if (Object.prototype.hasOwnProperty.call(taskProjectNameByIdentity, taskIdentity)) {
      return normalizeValue(taskProjectNameByIdentity[taskIdentity]);
    }

    return normalizeValue(card?.projectName);
  }, [taskProjectNameByIdentity]);

  const handleOpenProjectNameQuickUpdate = (card) => {
    setProjectNameQuickUpdate({
      open: true,
      card,
      value: getResolvedProjectName(card),
    });
  };

  const handleCloseProjectNameQuickUpdate = () => {
    setProjectNameQuickUpdate({
      open: false,
      card: null,
      value: "",
    });
  };

  const persistTaskProjectName = async (card, nextProjectName) => {
    if (!id || !card?.taskIdentity) {
      return false;
    }

    setSavingTaskProjectNameByIdentity((current) => ({
      ...current,
      [card.taskIdentity]: true,
    }));

    try {
      await setDoc(
        doc(db, "churches", id, "timeRotateTaskDetails", buildTaskDetailsDocId(card.taskIdentity)),
        {
          taskIdentity: card.taskIdentity,
          issueId: card.issueId,
          projectDocId: card.projectDocId,
          projectNameOverride: nextProjectName,
          updatedAt: Date.now(),
          updatedBy: user?.name || user?.displayName || user?.email || "Unknown user",
          updatedByUid: user?.uid || "",
        },
        { merge: true }
      );

      setTaskProjectNameByIdentity((current) => ({
        ...current,
        [card.taskIdentity]: nextProjectName,
      }));
      return true;
    } catch (saveError) {
      console.error("Error saving project name override:", saveError);
      setLogActionError("Could not save project name.");
      return false;
    } finally {
      setSavingTaskProjectNameByIdentity((current) => ({
        ...current,
        [card.taskIdentity]: false,
      }));
    }
  };

  const handleSaveTaskProjectNameQuickUpdate = async () => {
    const card = projectNameQuickUpdate.card;
    const taskIdentity = card?.taskIdentity;
    if (!taskIdentity) return;

    const draftValue = normalizeValue(projectNameQuickUpdate.value);
    const fallbackValue = normalizeValue(card?.projectName);
    const nextProjectName = draftValue || fallbackValue;

    const saved = await persistTaskProjectName(card, nextProjectName);
    if (saved) {
      handleCloseProjectNameQuickUpdate();
    }
  };

  const projectNameOptions = useMemo(() => {
    return Array.from(
      new Set(
        productionCards
          .map((card) => getResolvedProjectName(card))
          .filter(Boolean)
      )
    ).sort((left, right) => left.localeCompare(right));
  }, [getResolvedProjectName, productionCards]);

  const manualUserOptions = useMemo(() => {
    const options = [...organizationUsers];
    const fallbackValue = normalizeValue(resolvedUserId || resolvedUserEmail);
    const fallbackLabel = normalizeValue(user?.name || user?.displayName || user?.email);

    if (
      fallbackValue &&
      fallbackLabel &&
      !options.some((option) => normalizeValue(option.value) === fallbackValue)
    ) {
      options.push({
        value: fallbackValue,
        label: fallbackLabel,
        email: normalizeValue(user?.email),
        aliases: [fallbackValue, fallbackLabel].filter(Boolean),
      });
    }

    return options.sort((left, right) => left.label.localeCompare(right.label));
  }, [organizationUsers, resolvedUserEmail, resolvedUserId, user?.displayName, user?.email, user?.name]);

  const statusOptions = useMemo(() => {
    return Array.from(new Set(productionCards.map((card) => card.statusAgile).filter(Boolean))).sort((left, right) => left.localeCompare(right));
  }, [productionCards]);

  const technicalDirectionOptions = useMemo(() => {
    return Array.from(new Set(productionCards.map((card) => card.technicalDirection).filter(Boolean))).sort((left, right) => left.localeCompare(right));
  }, [productionCards]);

  const dataStageOptions = useMemo(() => {
    return Array.from(new Set(productionCards.map((card) => card.dataStage).filter(Boolean))).sort((left, right) => left.localeCompare(right));
  }, [productionCards]);

  const tagSuggestionOptions = useMemo(() => {
    const allTags = [
      ...productionCards.flatMap((card) => (Array.isArray(card.taskTags) ? card.taskTags : [])),
      ...Object.values(taskTagsByIdentity).flatMap((tags) => (Array.isArray(tags) ? tags : [])),
    ];

    return Array.from(new Set(allTags.map((tag) => normalizeTagValue(tag)).filter(Boolean))).sort((left, right) => left.localeCompare(right));
  }, [productionCards, taskTagsByIdentity]);

  const filteredCards = useMemo(() => {
    const normalizedSearch = normalizeValue(taskSearch).toLowerCase();

    return productionCards.filter((card) => {
      const resolvedProjectName = getResolvedProjectName(card);
      const mergedTaskTags = Array.isArray(taskTagsByIdentity[card.taskIdentity]) && taskTagsByIdentity[card.taskIdentity].length > 0
        ? taskTagsByIdentity[card.taskIdentity]
        : (Array.isArray(card.taskTags) ? card.taskTags : []);
      const mergedTaskTagsText = mergedTaskTags.join(" ");
      const matchesSearch =
        !normalizedSearch ||
        [
          card.issueId,
          card.title,
          resolvedProjectName,
          card.statusAgile,
          card.leadDetailer,
          card.supportTeam,
          card.technicalDirection,
          card.dataStage,
          mergedTaskTagsText,
        ]
          .map((value) => normalizeValue(value).toLowerCase())
          .some((value) => value.includes(normalizedSearch));

      if (!matchesSearch) return false;
      if (selectedIssueId && card.issueId !== selectedIssueId) return false;
      if (selectedProjectName && resolvedProjectName !== selectedProjectName) return false;
      if (selectedStatusAgile && card.statusAgile !== selectedStatusAgile) return false;
      if (selectedTechnicalDirection && card.technicalDirection !== selectedTechnicalDirection) return false;
      if (selectedDataStage && card.dataStage !== selectedDataStage) return false;

      return true;
    });
  }, [
    getResolvedProjectName,
    productionCards,
    taskSearch,
    selectedIssueId,
    selectedProjectName,
    selectedStatusAgile,
    selectedTechnicalDirection,
    selectedDataStage,
    taskTagsByIdentity,
  ]);

  const getResolvedTaskTags = useCallback((card) => {
    const taskIdentity = card?.taskIdentity;
    if (!taskIdentity) {
      return Array.isArray(card?.taskTags) ? card.taskTags : [];
    }

    if (Object.prototype.hasOwnProperty.call(taskTagsByIdentity, taskIdentity)) {
      return taskTagsByIdentity[taskIdentity];
    }

    return Array.isArray(card?.taskTags) ? card.taskTags : [];
  }, [taskTagsByIdentity]);

  const manualTaskOptions = useMemo(() => {
    return productionCards.map((card) => {
      const issueIdKey = String(card.issueId || "").trim().toLowerCase();
      const issueIdDigits = issueIdKey.replace(/[^0-9]/g, "");
      const isBlocked = Boolean(
        taskBlockedByIdentity[card.taskIdentity]
        || (issueIdKey && taskBlockedByIssueId[issueIdKey])
        || (issueIdDigits && taskBlockedByDigits[issueIdDigits])
      );
      return {
        value: card.taskIdentity,
        label: `${card.issueId || "-"} - ${card.title || "Untitled task"} (${getResolvedProjectName(card) || "No project"})${isBlocked ? " [BLOCKED]" : ""}`,
        card,
      };
    });
  }, [getResolvedProjectName, productionCards, taskBlockedByIdentity, taskBlockedByIssueId, taskBlockedByDigits]);

  const selectedManualUser = useMemo(() => {
    return manualUserOptions.find((option) => option.value === manualSelectedUserId) || null;
  }, [manualSelectedUserId, manualUserOptions]);

  const selectedManualTask = useMemo(() => {
    return productionCards.find((card) => card.taskIdentity === manualSelectedTaskIdentity) || null;
  }, [manualSelectedTaskIdentity, productionCards]);

  const getResolvedTaskCompletionStatus = (card) => {
    const taskIdentity = card?.taskIdentity;
    if (!taskIdentity) {
      return COMPLETION_STATUS.NOT_COMPLETED;
    }

    if (Object.prototype.hasOwnProperty.call(taskCompletionByIdentity, taskIdentity)) {
      return normalizeCompletionStatus(taskCompletionByIdentity[taskIdentity]);
    }

    return COMPLETION_STATUS.NOT_COMPLETED;
  };

  const handleTaskTagInputChange = (taskIdentity, value) => {
    setTaskTagInputByIdentity((current) => ({
      ...current,
      [taskIdentity]: value,
    }));
  };

  const handleShowTaskTagInput = (taskIdentity) => {
    setShowTaskTagInputByIdentity((current) => ({
      ...current,
      [taskIdentity]: true,
    }));
  };

  const handleHideTaskTagInput = (taskIdentity) => {
    setShowTaskTagInputByIdentity((current) => ({
      ...current,
      [taskIdentity]: false,
    }));
    setTaskTagInputByIdentity((current) => ({
      ...current,
      [taskIdentity]: "",
    }));
  };

  const persistTaskTags = async (card, nextTags) => {
    if (!id || !card?.taskIdentity) {
      return false;
    }

    setSavingTaskTagsByIdentity((current) => ({
      ...current,
      [card.taskIdentity]: true,
    }));

    try {
      await setDoc(
        doc(
          db,
          "churches",
          id,
          "timeRotateTaskDetails",
          buildTaskDetailsDocId(card.taskIdentity)
        ),
        {
          taskIdentity: card.taskIdentity,
          issueId: card.issueId,
          projectDocId: card.projectDocId,
          projectName: getResolvedProjectName(card),
          tags: nextTags,
          description: nextTags.join(", "),
          updatedAt: Date.now(),
          updatedBy: user?.name || user?.displayName || user?.email || "Unknown user",
          updatedByUid: user?.uid || "",
        },
        { merge: true }
      );

      setTaskTagsByIdentity((current) => ({
        ...current,
        [card.taskIdentity]: nextTags,
      }));
      return true;
    } catch (saveError) {
      console.error("Error saving task tags:", saveError);
      setLogActionError("Could not save task tags.");
      return false;
    } finally {
      setSavingTaskTagsByIdentity((current) => ({
        ...current,
        [card.taskIdentity]: false,
      }));
    }
  };

  const handleAddTaskTag = async (card, rawTag) => {
    const taskIdentity = card?.taskIdentity;
    if (!taskIdentity) {
      return;
    }

    const normalizedTag = normalizeTagValue(rawTag);
    if (!normalizedTag) {
      return;
    }

    const currentTags = getResolvedTaskTags(card);
    if (currentTags.some((tag) => normalizeKey(tag) === normalizeKey(normalizedTag))) {
      setTaskTagInputByIdentity((current) => ({
        ...current,
        [taskIdentity]: "",
      }));
      return;
    }

    const nextTags = [...currentTags, normalizedTag];

    setTaskTagsByIdentity((current) => ({
      ...current,
      [taskIdentity]: nextTags,
    }));

    setTaskTagInputByIdentity((current) => ({
      ...current,
      [taskIdentity]: "",
    }));

    await persistTaskTags(card, nextTags);
  };

  const handleRemoveTaskTag = async (card, tagToRemove) => {
    const taskIdentity = card?.taskIdentity;
    if (!taskIdentity) {
      return;
    }

    const currentTags = getResolvedTaskTags(card);
    const nextTags = currentTags.filter((tag) => normalizeKey(tag) !== normalizeKey(tagToRemove));

    setTaskTagsByIdentity((current) => ({
      ...current,
      [taskIdentity]: nextTags,
    }));

    await persistTaskTags(card, nextTags);
  };

  const handleSaveTaskTags = async (card) => {
    const tags = getResolvedTaskTags(card);
    await persistTaskTags(card, tags);
  };

  const handleToggleTaskCompletion = async (card) => {
    if (!id || !card?.taskIdentity) {
      return;
    }

    const currentCompletionStatus = getResolvedTaskCompletionStatus(card);
    const nextCompletionStatus = getNextCompletionStatus(currentCompletionStatus);
    const nextCompleted = nextCompletionStatus !== COMPLETION_STATUS.NOT_COMPLETED;
    const now = Date.now();

    setSavingTaskCompletionByIdentity((current) => ({
      ...current,
      [card.taskIdentity]: true,
    }));

    setTaskCompletionByIdentity((current) => ({
      ...current,
      [card.taskIdentity]: nextCompletionStatus,
    }));

    try {
      await setDoc(
        doc(db, "churches", id, "timeRotateTaskDetails", buildTaskDetailsDocId(card.taskIdentity)),
        {
          taskIdentity: card.taskIdentity,
          issueId: card.issueId,
          projectDocId: card.projectDocId,
          projectName: getResolvedProjectName(card),
          isCompleted: nextCompleted,
          completionStatus: nextCompletionStatus,
          completionAt: now,
          updatedAt: now,
          updatedBy: user?.name || user?.displayName || user?.email || "Unknown user",
          updatedByUid: user?.uid || "",
        },
        { merge: true }
      );

      await addDoc(collection(db, "churches", id, "timeRotateLogs"), {
        churchId: id,
        logType: "completion",
        issueId: card.issueId,
        projectName: getResolvedProjectName(card),
        statusAgile: card.statusAgile,
        technicalDirection: card.technicalDirection,
        taskTags: getResolvedTaskTags(card),
        taskDescription: getResolvedTaskTags(card).join(", "),
        completionStatus: nextCompletionStatus,
        completionFromStatus: currentCompletionStatus,
        completionToStatus: nextCompletionStatus,
        completionAt: now,
        startedAt: now,
        endedAt: now,
        durationMs: 0,
        registeredBy: user?.name || user?.displayName || user?.email || "Unknown user",
        userId: user?.uid || "",
        notes: [],
      });
    } catch (toggleError) {
      console.error("Error updating task completion:", toggleError);
      setLogActionError("Could not update completion status.");
      setTaskCompletionByIdentity((current) => ({
        ...current,
        [card.taskIdentity]: currentCompletionStatus,
      }));
    } finally {
      setSavingTaskCompletionByIdentity((current) => ({
        ...current,
        [card.taskIdentity]: false,
      }));
    }
  };

  const isCardBlocked = (card) => {
    if (!card) return false;
    if (taskBlockedByIdentity[card.taskIdentity]) return true;
    const issueIdKey = String(card.issueId || "").trim().toLowerCase();
    if (issueIdKey && taskBlockedByIssueId[issueIdKey]) return true;
    const issueIdDigits = issueIdKey.replace(/[^0-9]/g, "");
    return Boolean(issueIdDigits && taskBlockedByDigits[issueIdDigits]);
  };

  const handleStart = (card) => {
    if (activeTimer && activeTimer.cardKey !== card.key) {
      return;
    }

    if (activeTimer && activeTimer.cardKey === card.key) {
      return;
    }

    if (isCardBlocked(card)) {
      setLogActionError("This TD card is blocked from time entry. Ask a supervisor to unblock it in the TD Matcher.");
      return;
    }

    const now = Date.now();
    setSuppressTimerAutoRestore(false);
    setCurrentTick(now);
    setActiveTimer({
      cardKey: card.key,
      startedAt: now,
      issueId: card.issueId,
      projectName: getResolvedProjectName(card),
      statusAgile: card.statusAgile,
      technicalDirection: card.technicalDirection,
      taskTags: getResolvedTaskTags(card),
      notes: [],
      updatedAt: now,
      source: "local",
    });
    setActiveNoteInput("");
  };

  const handleAddActiveNote = async () => {
    const trimmedNote = normalizeValue(activeNoteInput);
    if ((!trimmedNote && !activeNoteFile) || !activeTimer || savingActiveNote) {
      return;
    }

    try {
      setSavingActiveNote(true);
      setActiveNoteError("");

      const noteTimestamp = Date.now();
      const attachment = activeNoteFile
        ? await uploadNoteAttachment({
            file: activeNoteFile,
            targetDocId: normalizeKey(activeTimerOwnerKey) || "active",
          })
        : null;

      setActiveTimer((current) => {
        if (!current) return current;
        return {
          ...current,
          notes: [
            ...(Array.isArray(current.notes) ? current.notes : []),
            {
              text: trimmedNote,
              timestamp: noteTimestamp,
              attachment,
            },
          ],
          updatedAt: noteTimestamp,
          source: "local",
        };
      });

      setActiveNoteInput("");
      setActiveNoteFile(null);
    } catch (saveError) {
      console.error("Error adding active note:", saveError);
      setActiveNoteError(normalizeValue(saveError?.message) || "Could not add note right now. Try again.");
    } finally {
      setSavingActiveNote(false);
    }
  };

  const canEditInProgressTimer = (timerEntry) => {
    if (canModerateInProgressNotes) {
      return true;
    }

    const currentUserId = normalizeValue(resolvedUserId);
    const currentUserEmail = normalizeValue(resolvedUserEmail);
    const currentOwnerKey = normalizeValue(activeTimerOwnerKey);
    const currentRegisteredBy = normalizeValue(user?.name || user?.displayName || user?.email);

    const entryUserId = normalizeValue(timerEntry?.userId);
    const entryUserEmail = normalizeValue(timerEntry?.userEmail);
    const entryOwnerKey = normalizeValue(timerEntry?.ownerKey);
    const entryRegisteredBy = normalizeValue(timerEntry?.registeredBy);

    if (currentUserId && entryUserId === currentUserId) return true;
    if (currentUserEmail && entryUserEmail === currentUserEmail) return true;
    if (currentOwnerKey && entryOwnerKey === currentOwnerKey) return true;
    if (currentRegisteredBy && entryRegisteredBy === currentRegisteredBy) return true;

    return false;
  };

  const handleInProgressNoteInputChange = (docId, value) => {
    setInProgressNoteInputs((current) => ({
      ...current,
      [docId]: value,
    }));

    setInProgressNoteErrorByDocId((current) => ({
      ...current,
      [docId]: "",
    }));
  };

  const handleInProgressNoteFileChange = (docId, file) => {
    setInProgressNoteFilesByDocId((current) => ({
      ...current,
      [docId]: file || null,
    }));

    setInProgressNoteErrorByDocId((current) => ({
      ...current,
      [docId]: "",
    }));
  };

  const handleAddInProgressNote = async (timerEntry) => {
    const docId = normalizeValue(timerEntry?.docId);
    const trimmedNote = normalizeValue(inProgressNoteInputs[docId]);
    const selectedFile = inProgressNoteFilesByDocId[docId] || null;

    if (!id || !docId || (!trimmedNote && !selectedFile)) {
      return;
    }

    if (!canEditInProgressTimer(timerEntry)) {
      setInProgressNoteErrorByDocId((current) => ({
        ...current,
        [docId]: "You can only add notes to your own timer unless you are an admin.",
      }));
      return;
    }

    setSavingInProgressNoteByDocId((current) => ({
      ...current,
      [docId]: true,
    }));

    try {
      const noteTimestamp = Date.now();
      const attachment = selectedFile
        ? await uploadNoteAttachment({
            file: selectedFile,
            targetDocId: docId,
          })
        : null;

      const nextNotes = [
        ...(Array.isArray(timerEntry?.notes) ? timerEntry.notes : []),
        {
          text: trimmedNote,
          timestamp: noteTimestamp,
          attachment,
        },
      ];

      await updateDoc(doc(db, "churches", id, ACTIVE_TIMER_COLLECTION, docId), {
        notes: nextNotes,
        updatedAt: noteTimestamp,
      });

      setInProgressNoteInputs((current) => ({
        ...current,
        [docId]: "",
      }));

      setInProgressNoteFilesByDocId((current) => ({
        ...current,
        [docId]: null,
      }));

      setInProgressNoteErrorByDocId((current) => ({
        ...current,
        [docId]: "",
      }));
    } catch (saveError) {
      console.error("Error adding in-progress note:", saveError);
      setInProgressNoteErrorByDocId((current) => ({
        ...current,
        [docId]: "Could not add note right now. Try again.",
      }));
    } finally {
      setSavingInProgressNoteByDocId((current) => ({
        ...current,
        [docId]: false,
      }));
    }
  };

  const handleStop = async () => {
    if (!activeTimer || isStoppingTimer) {
      return;
    }

    const endedAt = Date.now();
    const durationMs = endedAt - activeTimer.startedAt;
    const stopLogEntry = {
      churchId: id,
      logType: "timer",
      issueId: activeTimer.issueId,
      projectName: activeTimer.projectName,
      statusAgile: activeTimer.statusAgile,
      technicalDirection: activeTimer.technicalDirection,
      taskTags: parseTagsFromValue(activeTimer.taskTags),
      taskDescription: parseTagsFromValue(activeTimer.taskTags).join(", "),
      startedAt: activeTimer.startedAt,
      endedAt,
      durationMs,
      registeredBy: user?.name || user?.displayName || user?.email || "Unknown user",
      userId: resolvedUserId,
      userEmail: resolvedUserEmail,
      ownerKey: activeTimerOwnerKey,
      notes: Array.isArray(activeTimer.notes) ? activeTimer.notes : [],
    };

    try {
      setIsStoppingTimer(true);
      setLogActionError("");
      await addDoc(collection(db, "churches", id, "timeRotateLogs"), stopLogEntry);

      setSuppressTimerAutoRestore(true);
      setActiveTimer(null);
      setCurrentTick(Date.now());
      setActiveNoteInput("");
    } catch (saveError) {
      console.error("Error saving time log:", saveError);
      setLogActionError("Could not save log entry to Firebase. Timer remains active.");
    } finally {
      setIsStoppingTimer(false);
    }
  };

  const handleSaveManualEntry = async () => {
    const startTimestamp = Date.parse(manualStartAt);
    const endTimestamp = Date.parse(manualEndAt);

    if (!selectedManualUser) {
      setManualEntryError("Select a user before saving manual time.");
      setManualEntrySuccess("");
      return;
    }

    if (!selectedManualTask) {
      setManualEntryError("Select a task before saving manual time.");
      setManualEntrySuccess("");
      return;
    }

    if (isCardBlocked(selectedManualTask)) {
      setManualEntryError("This TD card is blocked from time entry. Ask a supervisor to unblock it in the TD Matcher.");
      setManualEntrySuccess("");
      return;
    }

    if (!Number.isFinite(startTimestamp) || !Number.isFinite(endTimestamp)) {
      setManualEntryError("Start and stop times are required.");
      setManualEntrySuccess("");
      return;
    }

    if (endTimestamp <= startTimestamp) {
      setManualEntryError("Stop time must be after start time.");
      setManualEntrySuccess("");
      return;
    }

    setManualEntrySaving(true);
    setManualEntryError("");
    setManualEntrySuccess("");

    try {
      await addDoc(collection(db, "churches", id, "timeRotateLogs"), {
        churchId: id,
        logType: "timer",
        entrySource: "manual",
        taskIdentity: selectedManualTask.taskIdentity,
        projectDocId: selectedManualTask.projectDocId,
        issueId: selectedManualTask.issueId,
        title: selectedManualTask.title,
        projectName: getResolvedProjectName(selectedManualTask),
        statusAgile: selectedManualTask.statusAgile,
        technicalDirection: selectedManualTask.technicalDirection,
        taskTags: getResolvedTaskTags(selectedManualTask),
        taskDescription: getResolvedTaskTags(selectedManualTask).join(", "),
        startedAt: startTimestamp,
        endedAt: endTimestamp,
        durationMs: endTimestamp - startTimestamp,
        registeredBy: selectedManualUser.label,
        userId: selectedManualUser.value,
        userEmail: normalizeValue(selectedManualUser.email),
        notes: [
          {
            text: "Manual Entry",
            timestamp: Date.now(),
          },
        ],
        createdBy: user?.name || user?.displayName || user?.email || "Unknown user",
        createdByUid: user?.uid || "",
        createdAt: Date.now(),
      });

      const now = Date.now();
      setManualEntrySuccess("Manual time entry saved.");
      setManualStartAt(toDateTimeLocalValue(now - (60 * 60 * 1000)));
      setManualEndAt(toDateTimeLocalValue(now));
    } catch (saveError) {
      console.error("Error saving manual time entry:", saveError);
      setManualEntryError("Could not save manual time entry.");
    } finally {
      setManualEntrySaving(false);
    }
  };

  const handleDeleteLog = async (logId) => {
    try {
      setLogActionError("");
      await deleteDoc(doc(db, "churches", id, "timeRotateLogs", logId));
    } catch (deleteError) {
      console.error("Error deleting time log:", deleteError);
      setLogActionError("Could not delete log entry.");
    }

    if (editingLogId === logId) {
      setEditingLogId("");
      setEditingRegisteredBy("");
      setEditingStartDate("");
      setEditingStartHour("12");
      setEditingStartMinute("00");
      setEditingStartMeridiem("AM");
      setEditingEndDate("");
      setEditingEndHour("12");
      setEditingEndMinute("00");
      setEditingEndMeridiem("AM");
      setEditingError("");
    }
  };

  const handleBeginEditLog = (entry) => {
    setEditingLogId(entry.id);
    setEditingRegisteredBy(entry.registeredBy || "");
    setEditingTaskTags(parseTagsFromValue(entry.taskTags));
    setEditingTaskTagInput("");
    setShowEditingLogTagInput(false);
    const startParts = toTwelveHourParts(entry.startedAt);
    const endParts = toTwelveHourParts(entry.endedAt);
    setEditingStartDate(startParts.date);
    setEditingStartHour(startParts.hour);
    setEditingStartMinute(startParts.minute);
    setEditingStartMeridiem(startParts.meridiem);
    setEditingEndDate(endParts.date);
    setEditingEndHour(endParts.hour);
    setEditingEndMinute(endParts.minute);
    setEditingEndMeridiem(endParts.meridiem);
    setEditingError("");
  };

  const handleAddEditingLogTag = () => {
    const normalizedTag = normalizeTagValue(editingTaskTagInput);
    if (!normalizedTag) {
      return;
    }

    setEditingTaskTags((current) => {
      if (current.some((tag) => normalizeKey(tag) === normalizeKey(normalizedTag))) {
        return current;
      }
      return [...current, normalizedTag];
    });
    setEditingTaskTagInput("");
  };

  const handleRemoveEditingLogTag = (tagToRemove) => {
    setEditingTaskTags((current) => current.filter((tag) => normalizeKey(tag) !== normalizeKey(tagToRemove)));
  };

  const handleSaveLogEdit = async (logId) => {
    const trimmedValue = editingRegisteredBy.trim();
    const parsedStart = toTimestampFromTwelveHourParts({
      date: editingStartDate,
      hour: editingStartHour,
      minute: editingStartMinute,
      meridiem: editingStartMeridiem,
    });
    const parsedEnd = toTimestampFromTwelveHourParts({
      date: editingEndDate,
      hour: editingEndHour,
      minute: editingEndMinute,
      meridiem: editingEndMeridiem,
    });

    if (Number.isNaN(parsedStart) || Number.isNaN(parsedEnd)) {
      setEditingError("Start and End time are required.");
      return;
    }

    if (parsedEnd < parsedStart) {
      setEditingError("End time cannot be before start time.");
      return;
    }

    try {
      setEditingError("");
      setLogActionError("");
      await updateDoc(doc(db, "churches", id, "timeRotateLogs", logId), {
        registeredBy: trimmedValue || "Unknown user",
        taskTags: parseTagsFromValue(editingTaskTags),
        taskDescription: parseTagsFromValue(editingTaskTags).join(", "),
        startedAt: parsedStart,
        endedAt: parsedEnd,
        durationMs: parsedEnd - parsedStart,
      });
    } catch (updateError) {
      console.error("Error updating time log:", updateError);
      setEditingError("Could not save changes to Firebase.");
      return;
    }

    setEditingLogId("");
    setEditingRegisteredBy("");
    setEditingTaskTags([]);
    setEditingTaskTagInput("");
    setShowEditingLogTagInput(false);
    setEditingStartDate("");
    setEditingStartHour("12");
    setEditingStartMinute("00");
    setEditingStartMeridiem("AM");
    setEditingEndDate("");
    setEditingEndHour("12");
    setEditingEndMinute("00");
    setEditingEndMeridiem("AM");
    setEditingError("");
  };

  const totalCountLabel = useMemo(() => {
    if (filteredCards.length === productionCards.length) {
      if (productionCards.length === 1) return "1 production card";
      return `${productionCards.length} production cards`;
    }

    return `${filteredCards.length} of ${productionCards.length} production cards`;
  }, [filteredCards.length, productionCards.length]);

  const getOrganizationUserMatchForLogEntry = (entry) => {
    const entryUserId = normalizeValue(entry?.userId);
    const entryRegisteredBy = normalizeValue(entry?.registeredBy);

    const byUserId = organizationUsers.find((organizationUser) => normalizeValue(organizationUser.value) === entryUserId);
    if (byUserId) {
      return byUserId;
    }

    if (!entryRegisteredBy) {
      return null;
    }

    const byAlias = organizationUsers.find((organizationUser) =>
      Array.isArray(organizationUser.aliases)
        ? organizationUser.aliases.some((alias) => normalizeValue(alias) === entryRegisteredBy)
        : false
    );

    return byAlias || null;
  };

  const doesLogEntryMatchAllLogsDateRange = (entry) => {
    if (logViewMode !== "all") {
      return true;
    }

    const entryTimestamp = Number(entry?.completionAt || entry?.endedAt || entry?.startedAt) || 0;
    if (!entryTimestamp) {
      return false;
    }

    const startTimestamp = toStartOfDayTimestamp(selectedAllLogsStartDate);
    if (!Number.isNaN(startTimestamp) && entryTimestamp < startTimestamp) {
      return false;
    }

    const endTimestamp = toEndOfDayTimestamp(selectedAllLogsEndDate);
    if (!Number.isNaN(endTimestamp) && entryTimestamp > endTimestamp) {
      return false;
    }

    return true;
  };

  const allModeDateFilteredLogs = useMemo(() => {
    if (logViewMode !== "all") {
      return timeLog;
    }

    return timeLog.filter((entry) => doesLogEntryMatchAllLogsDateRange(entry));
  }, [logViewMode, selectedAllLogsEndDate, selectedAllLogsStartDate, timeLog]);

  const visibleTimeLog = useMemo(() => {
    if (logViewMode === "all") {
      const selectedUser = normalizeValue(selectedAllLogsUser);
      if (!selectedUser) {
        return allModeDateFilteredLogs;
      }

      const selectedUserEntry = organizationUsers.find((entry) => normalizeValue(entry.value) === selectedUser);
      const selectedAliases = Array.isArray(selectedUserEntry?.aliases)
        ? selectedUserEntry.aliases.map((alias) => normalizeValue(alias)).filter(Boolean)
        : [];

      return allModeDateFilteredLogs.filter((entry) => {
        const matchedOrganizationUser = getOrganizationUserMatchForLogEntry(entry);
        if (matchedOrganizationUser) {
          return normalizeValue(matchedOrganizationUser.value) === selectedUser;
        }

        const entryUserId = normalizeValue(entry.userId);
        const entryRegisteredBy = normalizeValue(entry.registeredBy);
        const userKey = entryUserId || entryRegisteredBy || "unknown-user";

        if (userKey === selectedUser) {
          return true;
        }

        if (!entryUserId && selectedAliases.length > 0) {
          return selectedAliases.some((alias) => alias === entryRegisteredBy);
        }

        return false;
      });
    }

    const currentUserId = normalizeValue(user?.uid);
    if (currentUserId) {
      const byUserId = timeLog.filter((entry) => normalizeValue(entry.userId) === currentUserId);
      if (byUserId.length > 0) {
        return byUserId;
      }
    }

    const fallbackRegisteredBy = normalizeValue(user?.name || user?.displayName || user?.email);
    if (!fallbackRegisteredBy) {
      return timeLog;
    }

    return timeLog.filter((entry) => normalizeValue(entry.registeredBy) === fallbackRegisteredBy);
  }, [allModeDateFilteredLogs, logViewMode, organizationUsers, selectedAllLogsUser, timeLog, user?.displayName, user?.email, user?.name, user?.uid]);

  const allUsersLogSummary = useMemo(() => {
    const summaryMap = {};

    organizationUsers.forEach((organizationUser) => {
      const userKey = normalizeValue(organizationUser.value);
      if (!userKey) return;

      summaryMap[userKey] = {
        userKey,
        label: normalizeValue(organizationUser.label) || `User ${userKey}`,
        totalEntries: 0,
        timerEntries: 0,
        completionEntries: 0,
        totalDurationMs: 0,
        lastActivityAt: 0,
      };
    });

    visibleTimeLog.forEach((entry) => {
      const matchedOrganizationUser = getOrganizationUserMatchForLogEntry(entry);
      const userKey =
        normalizeValue(matchedOrganizationUser?.value) ||
        normalizeValue(entry.userId) ||
        normalizeValue(entry.registeredBy) ||
        "unknown-user";
      const label =
        normalizeValue(matchedOrganizationUser?.label) ||
        normalizeValue(entry.registeredBy) ||
        "Unknown user";

      if (!summaryMap[userKey]) {
        summaryMap[userKey] = {
          userKey,
          label,
          totalEntries: 0,
          timerEntries: 0,
          completionEntries: 0,
          totalDurationMs: 0,
          lastActivityAt: 0,
        };
      }

      summaryMap[userKey].totalEntries += 1;
      if (entry.logType === "completion") {
        summaryMap[userKey].completionEntries += 1;
      } else {
        summaryMap[userKey].timerEntries += 1;
        summaryMap[userKey].totalDurationMs += Number(entry.durationMs) || 0;
      }

      const activityTimestamp = Number(entry.completionAt || entry.endedAt || entry.startedAt) || 0;
      if (activityTimestamp > summaryMap[userKey].lastActivityAt) {
        summaryMap[userKey].lastActivityAt = activityTimestamp;
      }
    });

    return Object.values(summaryMap).sort((left, right) => {
      if (right.totalEntries !== left.totalEntries) {
        return right.totalEntries - left.totalEntries;
      }
      if (right.totalDurationMs !== left.totalDurationMs) {
        return right.totalDurationMs - left.totalDurationMs;
      }
      return right.lastActivityAt - left.lastActivityAt;
    });
  }, [organizationUsers, visibleTimeLog]);

  const allLogsUserOptions = useMemo(() => {
    const optionsByValue = {};

    organizationUsers.forEach((entry) => {
      optionsByValue[entry.value] = {
        value: entry.value,
        label: entry.label,
      };
    });

    allUsersLogSummary.forEach((entry) => {
      const value = entry.userKey;
      if (!value) return;

      if (!optionsByValue[value]) {
        optionsByValue[value] = {
          value,
          label: entry.label,
        };
      }
    });

    return Object.values(optionsByValue).sort((left, right) => left.label.localeCompare(right.label));
  }, [allUsersLogSummary, organizationUsers]);

  return (
    <div style={{ ...commonStyles.fullWidthContainer, paddingTop: "2rem", paddingBottom: "2rem" }}>
      <Link to={`${routePrefix}/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to My Organization
      </Link>

      <TimeRotateTopLogo />

      {pendingLessonItems.length > 0 ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(2, 6, 23, 0.72)",
            zIndex: 3000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "18px",
          }}
        >
          <div
            style={{
              width: "min(860px, 100%)",
              maxHeight: "88vh",
              overflowY: "auto",
              backgroundColor: "#FFFFFF",
              borderRadius: "16px",
              border: "1px solid #E2E8F0",
              boxShadow: "0 24px 60px rgba(2, 6, 23, 0.28)",
              padding: "18px",
            }}
          >
            <div style={{ color: "#7C2D12", fontWeight: 800, fontSize: "1.05rem", marginBottom: "6px" }}>
              Action Required: Lessons Learned Acknowledgement
            </div>
            <div style={{ color: "#334155", marginBottom: "10px" }}>
              You must read, acknowledge, and sign these lessons before continuing in TimeRotate.
            </div>

            {todayPerformanceContext ? (
              <div style={{ display: "grid", gap: "10px", marginBottom: "16px" }}>
                {/* Date + timezone header */}
                <div style={{ backgroundColor: "#F8FAFC", borderRadius: "10px", padding: "10px 14px", border: "1px solid #E2E8F0" }}>
                  <div style={{ fontSize: "0.74rem", fontWeight: 700, color: "#64748B" }}>Today</div>
                  <div style={{ fontWeight: 800, color: "#0F172A", fontSize: "1rem" }}>{todayPerformanceContext.dateLabel}</div>
                </div>

                {/* Punctuality block */}
                {todayPerformanceContext.isAbsent ? (
                  <div style={{ backgroundColor: "#FEF2F2", borderRadius: "12px", padding: "16px", border: "2px solid #FCA5A5" }}>
                    <div style={{ fontSize: "1.8rem", fontWeight: 900, color: "#991B1B" }}>⚠ No sign-in recorded today</div>
                    <div style={{ marginTop: "6px", color: "#7F1D1D", fontWeight: 700 }}>
                      You were expected at <strong>{todayPerformanceContext.expectedTimeLabel}</strong> but no time entry was found.
                    </div>
                  </div>
                ) : todayPerformanceContext.isLate ? (
                  <div style={{ backgroundColor: "#FEF2F2", borderRadius: "12px", padding: "16px", border: "2px solid #F87171" }}>
                    <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#64748B", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Punctuality</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
                      <div>
                        <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#9CA3AF" }}>Expected to start</div>
                        <div style={{ fontWeight: 800, color: "#0F172A", fontSize: "1.05rem" }}>{todayPerformanceContext.expectedTimeLabel}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#9CA3AF" }}>You started at</div>
                        <div style={{ fontWeight: 800, color: "#991B1B", fontSize: "1.05rem" }}>{todayPerformanceContext.actualTimeLabel}</div>
                      </div>
                    </div>
                    <div style={{ fontSize: "2rem", fontWeight: 900, color: "#991B1B", lineHeight: 1.1 }}>
                      ⚠ You were {Math.round(todayPerformanceContext.lateMinutes)} min late
                    </div>
                    <div style={{ marginTop: "6px", color: "#7F1D1D", fontWeight: 700, fontSize: "0.9rem" }}>
                      Next time, be ready to work at your expected start time — not just logging in at that time.
                    </div>
                  </div>
                ) : null}

                {/* Notes block — only shown when below minimum */}
                {todayPerformanceContext.totalNotesCount < 8 ? (
                  <div style={{ backgroundColor: "#FEF2F2", borderRadius: "12px", padding: "16px", border: "2px solid #FCA5A5" }}>
                    <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#64748B", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Notes</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
                      <div>
                        <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#9CA3AF" }}>Minimum required</div>
                        <div style={{ fontWeight: 800, color: "#0F172A", fontSize: "1.05rem" }}>8 notes</div>
                      </div>
                      <div>
                        <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#9CA3AF" }}>You submitted</div>
                        <div style={{ fontWeight: 900, color: "#991B1B", fontSize: "2rem", lineHeight: 1 }}>{todayPerformanceContext.totalNotesCount}</div>
                      </div>
                    </div>
                    <div style={{ color: "#7F1D1D", fontWeight: 700, fontSize: "0.9rem" }}>
                      You need {8 - todayPerformanceContext.totalNotesCount} more note{8 - todayPerformanceContext.totalNotesCount === 1 ? "" : "s"} to meet the minimum.
                      Add notes throughout your shift — not only at the end.
                    </div>
                    {todayPerformanceContext.topPeer ? (
                      <div style={{ marginTop: "10px", backgroundColor: "#FFF7ED", borderRadius: "8px", padding: "8px 10px", border: "1px solid #FED7AA" }}>
                        <span style={{ fontWeight: 700, color: "#92400E" }}>
                          Example: {normalizeValue(todayPerformanceContext.topPeer.label) || "A teammate"} submitted{" "}
                          <strong>{todayPerformanceContext.topPeer.count} notes</strong> today. Aim for that.
                        </span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div style={{ display: "grid", gap: "10px" }}>
              {pendingLessonItems.map((lesson, index) => (
                <div
                  key={`pending-lesson-${index}-${normalizeValue(lesson.text)}`}
                  style={{
                    backgroundColor: "#FEF2F2",
                    borderRadius: "12px",
                    padding: "16px",
                    border: "2px solid #FCA5A5",
                  }}
                >
                  {(() => {
                    const lessonKey = `${Number(lesson.createdAt) || 0}::${normalizeValue(lesson.text)}`;
                    const limitInfo = pendingLessonLimitInfo.byLessonKey?.[lessonKey];
                    if (!limitInfo?.applies) return null;

                    if (limitInfo.requiresPinForLesson) {
                      return (
                        <div style={{ marginBottom: "8px", backgroundColor: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: "8px", padding: "8px 10px", color: "#991B1B", fontWeight: 800, fontSize: "0.84rem" }}>
                          You reached the limit for this lesson this {limitInfo.period}. Supervisor PIN is required to continue.
                        </div>
                      );
                    }

                    return (
                      <div style={{ marginBottom: "8px", backgroundColor: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: "8px", padding: "8px 10px", color: "#065F46", fontWeight: 800, fontSize: "0.84rem" }}>
                        You can still receive this lesson {limitInfo.remainingCount} more time{limitInfo.remainingCount === 1 ? "" : "s"} this {limitInfo.period}.
                      </div>
                    );
                  })()}

                  {(() => {
                    const lessonKey = `${Number(lesson.createdAt) || 0}::${normalizeValue(lesson.text)}`;
                    const questions = lesson.questions || [];
                    if (questions.length === 0) return null;

                    return (
                      <div style={{ marginBottom: "10px", border: "1px solid #E2E8F0", borderRadius: "10px", padding: "10px", backgroundColor: "#FFFFFF" }}>
                        <div style={{ color: "#334155", fontWeight: 800, fontSize: "0.8rem", marginBottom: "6px" }}>
                          Knowledge Check (Answer all correctly)
                        </div>
                        <div style={{ display: "grid", gap: "8px" }}>
                          {questions.map((entry, questionIndex) => {
                            const answerKey = `${lessonKey}::q${questionIndex}`;
                            return (
                              <div key={`lesson-question-${lessonKey}-${questionIndex}`}>
                                <div style={{ fontSize: "0.78rem", color: "#334155", fontWeight: 700, marginBottom: "4px" }}>
                                  {questionIndex + 1}. {entry.question}
                                </div>
                                <select
                                  value={lessonQuestionAnswers[answerKey] || ""}
                                  onChange={(event) => {
                                    const nextValue = event.target.value;
                                    setLessonQuestionAnswers((current) => ({
                                      ...current,
                                      [answerKey]: nextValue,
                                    }));
                                    setLessonAckError("");
                                  }}
                                  style={{ width: "100%", padding: "8px 10px", border: "1px solid #CBD5E1", borderRadius: "8px", fontFamily: "inherit" }}
                                >
                                  <option value="">-- select answer --</option>
                                  {(entry.options || ["Yes", "No"]).map((opt, optIndex) => (
                                    <option key={`answer-opt-${lessonKey}-${questionIndex}-${optIndex}`} value={opt}>
                                      {opt}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Lesson Name if available */}
                  {normalizeValue(lesson.name) ? (
                    <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#64748B", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      {normalizeValue(lesson.name)}
                    </div>
                  ) : (
                    <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#64748B", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Lesson {index + 1}
                    </div>
                  )}

                  {/* Minimum Required if available */}
                  {normalizeValue(lesson.minimumRequired) ? (
                    <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#9CA3AF", marginBottom: "8px" }}>
                      Minimum required: <strong>{normalizeValue(lesson.minimumRequired)}</strong>
                    </div>
                  ) : null}

                  {/* Lesson Text - large bold */}
                  <div style={{ fontSize: "1rem", fontWeight: 800, color: "#991B1B", whiteSpace: "pre-wrap", wordBreak: "break-word", marginBottom: "6px" }}>
                    {normalizeValue(lesson.text)}
                  </div>

                  {/* Creator info if available */}
                  {normalizeValue(lesson.createdBy) ? (
                    <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "#7F1D1D" }}>
                      Added by {normalizeValue(lesson.createdBy)}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            {lessonQuestionValidation.totalRequired > 0 ? (
              <div style={{ marginTop: "10px", border: "1px solid #E2E8F0", borderRadius: "8px", backgroundColor: "#F8FAFC", padding: "8px 10px", color: "#334155", fontWeight: 700, fontSize: "0.82rem" }}>
                Question score: {lessonQuestionValidation.correctCount}/{lessonQuestionValidation.totalRequired} correct
              </div>
            ) : null}

            {pendingLessonLimitInfo.requiresSupervisorPin ? (
              <div style={{ marginTop: "12px", backgroundColor: "#FEF2F2", borderRadius: "10px", border: "2px solid #FCA5A5", padding: "10px 12px" }}>
                <div style={{ color: "#991B1B", fontWeight: 800, marginBottom: "6px" }}>
                  Supervisor PIN Required
                </div>
                <div style={{ color: "#7F1D1D", fontSize: "0.82rem", marginBottom: "8px" }}>
                  Lesson limit exceeded. Enter supervisor PIN to acknowledge and continue.
                </div>
                <input
                  type="password"
                  value={lessonSupervisorPinInput}
                  onChange={(event) => {
                    setLessonSupervisorPinInput(event.target.value);
                    setLessonAckError("");
                  }}
                  placeholder="Supervisor PIN"
                  style={{ width: "100%", padding: "9px 10px", border: "1px solid #F87171", borderRadius: "8px", fontFamily: "inherit" }}
                />
              </div>
            ) : null}

            <label style={{ display: "flex", alignItems: "flex-start", gap: "8px", marginTop: "12px", color: "#0F172A", fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={lessonAcknowledgeChecked}
                onChange={(event) => {
                  setLessonAcknowledgeChecked(event.target.checked);
                  setLessonAckError("");
                }}
                style={{ marginTop: "2px" }}
              />
              I acknowledge I read and understood these lessons and agree to apply them.
            </label>

            <div style={{ marginTop: "10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <label style={{ color: "#334155", fontWeight: 700 }}>Draw your signature</label>
                <button
                  type="button"
                  onClick={clearSignatureCanvas}
                  style={{ border: "1px solid #CBD5E1", backgroundColor: "#F8FAFC", color: "#475569", borderRadius: "8px", padding: "4px 10px", fontWeight: 700, cursor: "pointer", fontSize: "0.8rem" }}
                >
                  Clear
                </button>
              </div>
              <canvas
                ref={signatureCanvasRef}
                width={800}
                height={160}
                onMouseDown={handleSignaturePointerDown}
                onMouseMove={handleSignaturePointerMove}
                onMouseUp={handleSignaturePointerUp}
                onMouseLeave={handleSignaturePointerUp}
                onTouchStart={handleSignaturePointerDown}
                onTouchMove={handleSignaturePointerMove}
                onTouchEnd={handleSignaturePointerUp}
                style={{
                  width: "100%",
                  height: "120px",
                  border: lessonSignature ? "2px solid #1D4ED8" : "2px dashed #CBD5E1",
                  borderRadius: "10px",
                  backgroundColor: "#F8FAFC",
                  cursor: "crosshair",
                  touchAction: "none",
                  display: "block",
                }}
              />
              {!lessonSignature ? (
                <div style={{ textAlign: "center", color: "#94A3B8", fontSize: "0.8rem", marginTop: "4px", pointerEvents: "none" }}>
                  Sign above with your mouse or finger
                </div>
              ) : null}
            </div>

            {lessonAckError ? (
              <div style={{ marginTop: "10px", border: "1px solid #FCA5A5", backgroundColor: "#FEF2F2", color: "#B91C1C", borderRadius: "10px", padding: "10px 12px", fontWeight: 700 }}>
                {lessonAckError}
              </div>
            ) : null}

            <div style={{ marginTop: "12px", display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={handleAcknowledgePendingLessons}
                disabled={lessonAckSaving}
                style={{
                  border: "none",
                  backgroundColor: "#1D4ED8",
                  color: "#FFFFFF",
                  borderRadius: "10px",
                  padding: "10px 14px",
                  fontWeight: 800,
                  cursor: lessonAckSaving ? "not-allowed" : "pointer",
                  opacity: lessonAckSaving ? 0.75 : 1,
                }}
              >
                {lessonAckSaving ? "Saving Receipt..." : "Acknowledge and Sign"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div
        style={{
          backgroundColor: "white",
          border: "1px solid #E5E7EB",
          borderRadius: "16px",
          padding: "24px",
          marginTop: "1.5rem",
          boxShadow: "0 10px 20px rgba(15, 23, 42, 0.05)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ ...commonStyles.title, marginBottom: "6px" }}>TimeRotate</h1>
            <p style={{ margin: 0, color: "#475569" }}>
              Live list of all E2 Agile Board cards where Data Stage is set to Production.
            </p>
            {lessonFeaturesUnavailable ? (
              <p style={{ margin: "6px 0 0", color: "#B45309", fontWeight: 600, fontSize: "0.84rem" }}>
                Lessons acknowledgement settings are unavailable for your account right now. TimeRotate remains usable.
              </p>
            ) : null}
          </div>
          <Link
            to={`${routePrefix}/${id}/e2-agile-board`}
            style={{
              alignSelf: "flex-start",
              textDecoration: "none",
              backgroundColor: "#111827",
              color: "#FFFFFF",
              padding: "10px 14px",
              borderRadius: "10px",
              fontWeight: 600,
            }}
          >
            Open E2 Agile Board
          </Link>
        </div>

        <div style={{ marginTop: "14px", color: "#334155", fontWeight: 600 }}>{totalCountLabel}</div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px", marginBottom: "12px" }}>
          <Link to={`${routePrefix}/${id}/time-rotate`} style={tabStyle(true)}>
            ▤ TimeRotate Board
          </Link>
          <Link to={`${routePrefix}/${id}/time-rotate-progress`} style={tabStyle(false)}>
            ◷ All Users Progress
          </Link>
          <Link to={`${routePrefix}/${id}/time-rotate-tracker`} style={tabStyle(false)}>
            ✦ Time Tracker
          </Link>
          <Link to={`${routePrefix}/${id}/time-rotate-office-status`} style={tabStyle(false)}>
            ⌂ Office Status
          </Link>
          <Link to={`${routePrefix}/${id}/time-rotate-card-hours`} style={tabStyle(false)}>
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
            display: "flex",
            gap: "8px",
            flexWrap: "wrap",
            marginTop: "4px",
            marginBottom: "12px",
          }}
        >
          <button
            type="button"
            onClick={() => setActiveWorkspaceTab("board")}
            style={{
              ...tabStyle(activeWorkspaceTab === "board"),
              cursor: "pointer",
            }}
          >
            Board
          </button>
          <button
            type="button"
            onClick={() => setActiveWorkspaceTab("manual")}
            style={{
              ...tabStyle(activeWorkspaceTab === "manual"),
              cursor: "pointer",
            }}
          >
            Manual
          </button>
        </div>

        {activeWorkspaceTab === "manual" ? (
          <div
            style={{
              marginTop: "14px",
              border: "1px solid #BFDBFE",
              background: "linear-gradient(145deg, #F8FBFF 0%, #EFF6FF 100%)",
              borderRadius: "16px",
              padding: "16px",
              display: "grid",
              gap: "14px",
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: "1.05rem", color: "#0F172A" }}>Manual Time Entry</h2>
              <p style={{ margin: "6px 0 0", color: "#475569" }}>
                Add time directly by choosing the user, the task, and the exact start and stop times.
              </p>
            </div>

            <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
              <label style={{ display: "grid", gap: "6px", color: "#0F172A", fontWeight: 600 }}>
                <span>User</span>
                <select
                  value={manualSelectedUserId}
                  onChange={(event) => {
                    setManualSelectedUserId(event.target.value);
                    setManualEntryError("");
                    setManualEntrySuccess("");
                  }}
                  style={inputStyle}
                >
                  <option value="">Select user...</option>
                  {manualUserOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: "grid", gap: "6px", color: "#0F172A", fontWeight: 600 }}>
                <span>Task ID / Title / Project</span>
                <select
                  value={manualSelectedTaskIdentity}
                  onChange={(event) => {
                    setManualSelectedTaskIdentity(event.target.value);
                    setManualEntryError("");
                    setManualEntrySuccess("");
                  }}
                  style={inputStyle}
                >
                  <option value="">Select task...</option>
                  {manualTaskOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: "grid", gap: "6px", color: "#0F172A", fontWeight: 600 }}>
                <span>Start</span>
                <input
                  type="datetime-local"
                  value={manualStartAt}
                  onChange={(event) => {
                    const nextStartValue = event.target.value;
                    setManualStartAt(nextStartValue);

                    const startTimestamp = Date.parse(nextStartValue);
                    const stopTimestamp = Date.parse(manualEndAt);

                    if (
                      Number.isFinite(startTimestamp) &&
                      Number.isFinite(stopTimestamp) &&
                      stopTimestamp > startTimestamp
                    ) {
                      const totalHours = (stopTimestamp - startTimestamp) / (60 * 60 * 1000);
                      setManualTotalHours(String(Number(totalHours.toFixed(4))));
                    }

                    setManualEntryError("");
                    setManualEntrySuccess("");
                  }}
                  style={inputStyle}
                />
              </label>

              <label style={{ display: "grid", gap: "6px", color: "#0F172A", fontWeight: 600 }}>
                <span>Total Hrs</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.25"
                  value={manualTotalHours}
                  onChange={(event) => {
                    const nextTotalHoursValue = event.target.value;
                    setManualTotalHours(nextTotalHoursValue);

                    const parsedHours = Number(nextTotalHoursValue);
                    const startTimestamp = Date.parse(manualStartAt);

                    if (Number.isFinite(parsedHours) && parsedHours > 0 && Number.isFinite(startTimestamp)) {
                      const calculatedEndTimestamp = startTimestamp + (parsedHours * 60 * 60 * 1000);
                      setManualEndAt(toDateTimeLocalValue(calculatedEndTimestamp));
                    }

                    setManualEntryError("");
                    setManualEntrySuccess("");
                  }}
                  placeholder="e.g. 2 or 1.5"
                  style={inputStyle}
                />
              </label>

              <label style={{ display: "grid", gap: "6px", color: "#0F172A", fontWeight: 600 }}>
                <span>Stop</span>
                <input
                  type="datetime-local"
                  value={manualEndAt}
                  onChange={(event) => {
                    const nextStopValue = event.target.value;
                    setManualEndAt(nextStopValue);

                    const startTimestamp = Date.parse(manualStartAt);
                    const stopTimestamp = Date.parse(nextStopValue);

                    if (
                      Number.isFinite(startTimestamp) &&
                      Number.isFinite(stopTimestamp) &&
                      stopTimestamp > startTimestamp
                    ) {
                      const totalHours = (stopTimestamp - startTimestamp) / (60 * 60 * 1000);
                      setManualTotalHours(String(Number(totalHours.toFixed(4))));
                    }

                    setManualEntryError("");
                    setManualEntrySuccess("");
                  }}
                  style={inputStyle}
                />
              </label>
            </div>

            {selectedManualTask ? (
              <div
                style={{
                  border: "1px solid #DBEAFE",
                  backgroundColor: "#FFFFFF",
                  borderRadius: "12px",
                  padding: "12px 14px",
                  display: "grid",
                  gap: "4px",
                }}
              >
                <div style={{ color: "#0F172A", fontWeight: 700 }}>
                  {selectedManualTask.issueId || "-"} - {selectedManualTask.title || "Untitled task"}
                </div>
                <div style={{ color: "#475569" }}>{getResolvedProjectName(selectedManualTask) || "No project"}</div>
                <div style={{ color: "#64748B", fontSize: "0.88rem" }}>
                  {selectedManualTask.statusAgile || "No status"}
                  {selectedManualTask.technicalDirection ? ` • ${selectedManualTask.technicalDirection}` : ""}
                </div>
              </div>
            ) : null}

            {manualEntryError ? (
              <div
                style={{
                  border: "1px solid #FCA5A5",
                  backgroundColor: "#FEF2F2",
                  color: "#B91C1C",
                  borderRadius: "10px",
                  padding: "10px 12px",
                  fontWeight: 600,
                }}
              >
                {manualEntryError}
              </div>
            ) : null}

            {manualEntrySuccess ? (
              <div
                style={{
                  border: "1px solid #86EFAC",
                  backgroundColor: "#F0FDF4",
                  color: "#166534",
                  borderRadius: "10px",
                  padding: "10px 12px",
                  fontWeight: 600,
                }}
              >
                {manualEntrySuccess}
              </div>
            ) : null}

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={handleSaveManualEntry}
                disabled={manualEntrySaving}
                style={{
                  backgroundColor: "#2563EB",
                  color: "#FFFFFF",
                  border: "none",
                  borderRadius: "10px",
                  padding: "10px 14px",
                  cursor: manualEntrySaving ? "not-allowed" : "pointer",
                  fontWeight: 700,
                  opacity: manualEntrySaving ? 0.75 : 1,
                }}
              >
                {manualEntrySaving ? "Saving..." : "Save Manual Time"}
              </button>
              <button
                type="button"
                onClick={() => {
                  const now = Date.now();
                  setManualSelectedUserId("");
                  setManualSelectedTaskIdentity("");
                  setManualStartAt(toDateTimeLocalValue(now - (60 * 60 * 1000)));
                  setManualEndAt(toDateTimeLocalValue(now));
                  setManualTotalHours("1");
                  setManualEntryError("");
                  setManualEntrySuccess("");
                }}
                style={{
                  backgroundColor: "#E2E8F0",
                  color: "#0F172A",
                  border: "none",
                  borderRadius: "10px",
                  padding: "10px 14px",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                Clear
              </button>
            </div>
          </div>
        ) : (
          <>
            <div
              style={{
                marginTop: "14px",
                border: "1px solid #E2E8F0",
                backgroundColor: "#F8FAFC",
                borderRadius: "12px",
                padding: "12px",
                display: "grid",
                gap: "10px",
              }}
            >
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                <input
                  type="text"
                  value={taskSearch}
                  onChange={(event) => setTaskSearch(event.target.value)}
                  placeholder="Search task by ID, project, status, assignee, tags, technical direction, stage"
                  style={{
                    flex: "1 1 320px",
                    minWidth: "260px",
                    padding: "9px 10px",
                    border: "1px solid #CBD5E1",
                    borderRadius: "8px",
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setTaskSearch("");
                    setSelectedIssueId("");
                    setSelectedProjectName("");
                    setSelectedStatusAgile("");
                    setSelectedTechnicalDirection("");
                    setSelectedDataStage("");
                  }}
                  style={{
                    backgroundColor: "#334155",
                    color: "#FFFFFF",
                    border: "none",
                    borderRadius: "8px",
                    padding: "9px 12px",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Clear Filters
                </button>
              </div>
              <div style={{ display: "grid", gap: "8px", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                <select value={selectedIssueId} onChange={(event) => setSelectedIssueId(event.target.value)} style={filterSelectStyle}>
                  <option value="">All Task IDs</option>
                  {issueIdOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <select value={selectedProjectName} onChange={(event) => setSelectedProjectName(event.target.value)} style={filterSelectStyle}>
                  <option value="">All Project Names</option>
                  {projectNameOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <select value={selectedStatusAgile} onChange={(event) => setSelectedStatusAgile(event.target.value)} style={filterSelectStyle}>
                  <option value="">All E2 Status</option>
                  {statusOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedTechnicalDirection}
                  onChange={(event) => setSelectedTechnicalDirection(event.target.value)}
                  style={filterSelectStyle}
                >
                  <option value="">All Technical Direction</option>
                  {technicalDirectionOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <select value={selectedDataStage} onChange={(event) => setSelectedDataStage(event.target.value)} style={filterSelectStyle}>
                  <option value="">All Data Stage</option>
                  {dataStageOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {logActionError && (
              <div
                style={{
                  marginTop: "10px",
                  border: "1px solid #FCA5A5",
                  backgroundColor: "#FEF2F2",
                  color: "#B91C1C",
                  borderRadius: "10px",
                  padding: "10px 12px",
                  fontWeight: 600,
                }}
              >
                {logActionError}
              </div>
            )}

            {activeTimer && (
              <div
                style={{
                  marginTop: "12px",
                  border: "1px solid #BBF7D0",
                  backgroundColor: "#F0FDF4",
                  color: "#166534",
                  borderRadius: "10px",
                  padding: "10px 12px",
                  fontWeight: 600,
                }}
              >
                <div style={{ display: "flex", gap: "10px", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                  <span>
                    Active timer: {activeTimer.issueId || "-"} ({activeTimer.projectName || "No project"}) - {formatDuration(activeDuration)}
                  </span>
                  <button
                    type="button"
                    onClick={handleStop}
                    disabled={isStoppingTimer}
                    style={{
                      backgroundColor: "#DC2626",
                      color: "#FFFFFF",
                      border: "none",
                      borderRadius: "8px",
                      padding: "8px 12px",
                      cursor: isStoppingTimer ? "not-allowed" : "pointer",
                      fontWeight: 700,
                      opacity: isStoppingTimer ? 0.75 : 1,
                    }}
                  >
                    {isStoppingTimer ? "Stopping..." : "Stop Timer"}
                  </button>
                </div>
              </div>
            )}

            {activeTimer && (
              <div
                style={{
                  marginTop: "10px",
                  border: "1px solid #BFDBFE",
                  backgroundColor: "#EFF6FF",
                  color: "#1E3A8A",
                  borderRadius: "10px",
                  padding: "10px 12px",
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: "8px" }}>Notes while timing</div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <input
                    type="text"
                    value={activeNoteInput}
                    onChange={(event) => {
                      setActiveNoteInput(event.target.value);
                      setActiveNoteError("");
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !savingActiveNote) {
                        event.preventDefault();
                        handleAddActiveNote();
                      }
                    }}
                    placeholder="Write a note (optional if attaching a file)"
                    style={{
                      flex: "1 1 320px",
                      padding: "8px 10px",
                      border: "1px solid #93C5FD",
                      borderRadius: "8px",
                    }}
                  />
                  <input
                    type="file"
                    onChange={(event) => {
                      setActiveNoteFile(event.target.files?.[0] || null);
                      setActiveNoteError("");
                    }}
                    style={{
                      flex: "0 1 260px",
                      padding: "8px 10px",
                      border: "1px solid #93C5FD",
                      borderRadius: "8px",
                      backgroundColor: "#FFFFFF",
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleAddActiveNote}
                    disabled={savingActiveNote}
                    style={{
                      backgroundColor: "#2563EB",
                      color: "#FFFFFF",
                      border: "none",
                      borderRadius: "8px",
                      padding: "8px 12px",
                      cursor: savingActiveNote ? "not-allowed" : "pointer",
                      fontWeight: 600,
                      opacity: savingActiveNote ? 0.75 : 1,
                    }}
                  >
                    {savingActiveNote ? "Saving..." : "Add Note"}
                  </button>
                </div>
                {activeNoteFile ? (
                  <div style={{ marginTop: "6px", fontSize: "0.82rem", color: "#1E3A8A" }}>
                    Attachment ready: {activeNoteFile.name}{formatFileSize(activeNoteFile.size) ? ` (${formatFileSize(activeNoteFile.size)})` : ""}
                  </div>
                ) : null}
                {activeNoteError ? (
                  <div style={{ marginTop: "6px", fontSize: "0.82rem", color: "#B91C1C", fontWeight: 600 }}>
                    {activeNoteError}
                  </div>
                ) : null}
                {Array.isArray(activeTimer.notes) && activeTimer.notes.length > 0 && (
                  <div style={{ marginTop: "10px", display: "grid", gap: "6px" }}>
                    {activeTimer.notes.map((note, noteIndex) => (
                      <div key={`${note.timestamp}-${noteIndex}`} style={{ fontSize: "0.9rem", color: "#1E3A8A", display: "grid", gap: "2px" }}>
                        <div>[{formatTimestamp(note.timestamp)}] {note.text || "File attachment"}</div>
                        {note.attachment?.url ? (
                          <div style={{ display: "grid", gap: "4px" }}>
                            {isImageAttachment(note.attachment) ? (
                              <a
                                href={note.attachment.url}
                                onClick={(event) => handleOpenImagePreview(note.attachment, event)}
                                style={{ display: "inline-block", width: "fit-content" }}
                              >
                                <img
                                  src={note.attachment.url}
                                  alt={note.attachment.name || "Attachment preview"}
                                  style={{ width: "86px", height: "86px", objectFit: "cover", borderRadius: "8px", border: "1px solid #93C5FD", backgroundColor: "#FFFFFF" }}
                                />
                              </a>
                            ) : null}
                            <a
                              href={note.attachment.url}
                              onClick={isImageAttachment(note.attachment)
                                ? (event) => handleOpenImagePreview(note.attachment, event)
                                : undefined}
                              target={isImageAttachment(note.attachment) ? undefined : "_blank"}
                              rel={isImageAttachment(note.attachment) ? undefined : "noopener noreferrer"}
                              style={{ color: "#1D4ED8", textDecoration: "underline", fontSize: "0.82rem", fontWeight: 600 }}
                            >
                              Open file: {note.attachment.name || "Attachment"}
                            </a>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {loading ? (
          <p style={{ marginTop: "16px", color: "#64748B" }}>Loading production cards...</p>
        ) : error ? (
          <p style={{ marginTop: "16px", color: "#DC2626" }}>{error}</p>
        ) : productionCards.length === 0 ? (
          <p style={{ marginTop: "16px", color: "#64748B" }}>
            No cards are currently marked as Production.
          </p>
        ) : filteredCards.length === 0 ? (
          <p style={{ marginTop: "16px", color: "#64748B" }}>
            No tasks match your current search and filters.
          </p>
        ) : (
          <div style={{ overflowX: "auto", marginTop: "16px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "1160px" }}>
              <thead>
                <tr style={{ background: "#F8FAFC" }}>
                  <th style={cellHeaderStyle}>ID</th>
                  <th style={cellHeaderStyle}>Project Name</th>
                  <th style={cellHeaderStyle}>Title</th>
                  <th style={cellHeaderStyle}>Completed for Review</th>
                  <th style={cellHeaderStyle}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredCards.map((card) => (
                  <tr key={card.key}>
                    <td style={cellStyle}>
                      {card.issueId ? (
                        <Link
                          to={`/organization/${id}/project-issue-dashboard/issue/${encodeURIComponent(card.projectDocId)}/${encodeURIComponent(card.issueId)}`}
                          style={{ color: "#1D4ED8", textDecoration: "underline", fontWeight: 700 }}
                        >
                          {card.issueId}
                        </Link>
                      ) : (
                        "-"
                      )}
                      <div style={{ marginTop: "2px", color: "#94A3B8", fontSize: "0.68rem", fontFamily: "monospace", wordBreak: "break-all" }}>
                        {card.taskIdentity}
                      </div>
                    </td>
                    <td style={cellStyle}>
                      <div style={{ minWidth: "220px", display: "grid", gap: "6px" }}>
                        <div style={{ fontWeight: 600, color: "#0F172A" }}>{getResolvedProjectName(card) || "-"}</div>
                        <button
                          type="button"
                          onClick={() => handleOpenProjectNameQuickUpdate(card)}
                          disabled={Boolean(savingTaskProjectNameByIdentity[card.taskIdentity])}
                          style={{
                            justifySelf: "flex-start",
                            color: "#059669",
                            textDecoration: "underline",
                            background: "transparent",
                            border: "none",
                            cursor: savingTaskProjectNameByIdentity[card.taskIdentity] ? "not-allowed" : "pointer",
                            fontSize: "0.82rem",
                            fontWeight: 600,
                            padding: 0,
                            opacity: savingTaskProjectNameByIdentity[card.taskIdentity] ? 0.75 : 1,
                          }}
                        >
                          {savingTaskProjectNameByIdentity[card.taskIdentity] ? "Saving..." : "Quick Update"}
                        </button>
                      </div>
                    </td>
                    <td style={cellStyle}>
                      {hasTechnicalDetailTitle(card.title)
                        ? `⭐ ${card.title || "-"}`
                        : (card.title || "-")}
                    </td>
                    <td style={cellStyle}>
                      {(() => {
                        const completionStatus = getResolvedTaskCompletionStatus(card);

                        return (
                      <button
                        type="button"
                        onClick={() => handleToggleTaskCompletion(card)}
                        disabled={Boolean(savingTaskCompletionByIdentity[card.taskIdentity])}
                        style={{
                          backgroundColor: getCompletionStatusButtonColor(completionStatus),
                          color: "#FFFFFF",
                          border: "none",
                          borderRadius: "8px",
                          padding: "7px 10px",
                          cursor: savingTaskCompletionByIdentity[card.taskIdentity] ? "not-allowed" : "pointer",
                          fontWeight: 600,
                          opacity: savingTaskCompletionByIdentity[card.taskIdentity] ? 0.75 : 1,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {savingTaskCompletionByIdentity[card.taskIdentity]
                          ? "Saving..."
                          : getCompletionStatusLabel(completionStatus)}
                      </button>
                        );
                      })()}
                    </td>
                    <td style={cellStyle}>
                      {activeTimer && activeTimer.cardKey === card.key ? (
                        <button
                          type="button"
                          onClick={handleStop}
                          disabled={isStoppingTimer}
                          style={{
                            backgroundColor: "#DC2626",
                            color: "#FFFFFF",
                            border: "none",
                            borderRadius: "8px",
                            padding: "8px 12px",
                            cursor: isStoppingTimer ? "not-allowed" : "pointer",
                            fontWeight: 600,
                            opacity: isStoppingTimer ? 0.75 : 1,
                          }}
                        >
                          {isStoppingTimer ? "Stopping..." : "Stop"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleStart(card)}
                          disabled={Boolean(activeTimer && activeTimer.cardKey !== card.key) || isCardBlocked(card)}
                          title={isCardBlocked(card) ? "This TD card is blocked from time entry" : `taskIdentity: ${card.taskIdentity} | issueId: ${card.issueId}`}
                          style={{
                            backgroundColor: isCardBlocked(card) ? "#B91C1C" : (activeTimer ? "#94A3B8" : "#0F766E"),
                            color: "#FFFFFF",
                            border: "none",
                            borderRadius: "8px",
                            padding: "8px 12px",
                            cursor: (activeTimer || isCardBlocked(card)) ? "not-allowed" : "pointer",
                            fontWeight: 600,
                          }}
                        >
                          {isCardBlocked(card) ? "Blocked" : "Start"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {false && (
        <div
          style={{
            marginTop: "24px",
            borderTop: "1px solid #E2E8F0",
            paddingTop: "18px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
            <h2 style={{ fontSize: "1.08rem", margin: 0, color: "#0F172A" }}>Time Log</h2>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => {
                  setLogViewMode("mine");
                  setSelectedAllLogsUser("");
                  setSelectedAllLogsStartDate("");
                  setSelectedAllLogsEndDate("");
                }}
                style={{
                  backgroundColor: logViewMode === "mine" ? "#1D4ED8" : "#E2E8F0",
                  color: logViewMode === "mine" ? "#FFFFFF" : "#0F172A",
                  border: "none",
                  borderRadius: "8px",
                  padding: "7px 10px",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                My Logs
              </button>
              <button
                type="button"
                onClick={() => setLogViewMode("all")}
                style={{
                  backgroundColor: logViewMode === "all" ? "#1D4ED8" : "#E2E8F0",
                  color: logViewMode === "all" ? "#FFFFFF" : "#0F172A",
                  border: "none",
                  borderRadius: "8px",
                  padding: "7px 10px",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                View All Users Logs
              </button>
            </div>
          </div>

          {logViewMode === "all" && (
            <div
              style={{
                marginTop: "10px",
                display: "grid",
                gap: "8px",
                gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
                alignItems: "end",
              }}
            >
              <label style={{ color: "#334155", fontWeight: 600, fontSize: "0.9rem", display: "grid", gap: "6px" }}>
                <span>Filter by user</span>
                <select
                  id="all-users-log-filter"
                  value={selectedAllLogsUser}
                  onChange={(event) => setSelectedAllLogsUser(event.target.value)}
                  style={{
                    minWidth: "220px",
                    padding: "8px 10px",
                    border: "1px solid #CBD5E1",
                    borderRadius: "8px",
                    backgroundColor: "#FFFFFF",
                  }}
                >
                  <option value="">All users</option>
                  {allLogsUserOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ color: "#334155", fontWeight: 600, fontSize: "0.9rem", display: "grid", gap: "6px" }}>
                <span>From date</span>
                <input
                  type="date"
                  value={selectedAllLogsStartDate}
                  onChange={(event) => setSelectedAllLogsStartDate(event.target.value)}
                  max={selectedAllLogsEndDate || undefined}
                  style={{
                    padding: "8px 10px",
                    border: "1px solid #CBD5E1",
                    borderRadius: "8px",
                    backgroundColor: "#FFFFFF",
                  }}
                />
              </label>

              <label style={{ color: "#334155", fontWeight: 600, fontSize: "0.9rem", display: "grid", gap: "6px" }}>
                <span>To date</span>
                <input
                  type="date"
                  value={selectedAllLogsEndDate}
                  onChange={(event) => setSelectedAllLogsEndDate(event.target.value)}
                  min={selectedAllLogsStartDate || undefined}
                  style={{
                    padding: "8px 10px",
                    border: "1px solid #CBD5E1",
                    borderRadius: "8px",
                    backgroundColor: "#FFFFFF",
                  }}
                />
              </label>

              <button
                type="button"
                onClick={() => {
                  setSelectedAllLogsUser("");
                  setSelectedAllLogsStartDate("");
                  setSelectedAllLogsEndDate("");
                }}
                style={{
                  justifySelf: "start",
                  backgroundColor: "#334155",
                  color: "#FFFFFF",
                  border: "none",
                  borderRadius: "8px",
                  padding: "8px 12px",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Clear Log Filters
              </button>
            </div>
          )}

          {logViewMode === "all" && allUsersLogSummary.length > 0 && (
            <div style={{ marginTop: "12px", overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "760px" }}>
                <thead>
                  <tr style={{ background: "#F8FAFC" }}>
                    <th style={cellHeaderStyle}>User</th>
                    <th style={cellHeaderStyle}>Total Logs</th>
                    <th style={cellHeaderStyle}>Timer Logs</th>
                    <th style={cellHeaderStyle}>Completion Logs</th>
                    <th style={cellHeaderStyle}>Total Time</th>
                    <th style={cellHeaderStyle}>Last Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {allUsersLogSummary.map((entry) => (
                    <tr key={entry.userKey}>
                      <td style={cellStyle}>{entry.label}</td>
                      <td style={cellStyle}>{entry.totalEntries}</td>
                      <td style={cellStyle}>{entry.timerEntries}</td>
                      <td style={cellStyle}>{entry.completionEntries}</td>
                      <td style={cellStyle}>{formatDuration(entry.totalDurationMs)}</td>
                      <td style={cellStyle}>{entry.lastActivityAt ? formatTimestamp(entry.lastActivityAt) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {visibleTimeLog.length === 0 ? (
            <p style={{ marginTop: "10px", marginBottom: 0, color: "#64748B" }}>No entries yet. Start and stop a row to create a log entry.</p>
          ) : (
            <div style={{ overflowX: "auto", marginTop: "12px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "1080px" }}>
                <thead>
                  <tr style={{ background: "#F8FAFC" }}>
                    <th style={cellHeaderStyle}>Event</th>
                    <th style={cellHeaderStyle}>ID</th>
                    <th style={cellHeaderStyle}>Project Name</th>
                    <th style={cellHeaderStyle}>Task Tags</th>
                    <th style={cellHeaderStyle}>Registered By</th>
                    <th style={cellHeaderStyle}>Started</th>
                    <th style={cellHeaderStyle}>Stopped</th>
                    <th style={cellHeaderStyle}>Duration</th>
                    <th style={cellHeaderStyle}>Notes (timestamped)</th>
                    <th style={cellHeaderStyle}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTimeLog.map((entry) => (
                    <tr key={entry.id}>
                      <td style={cellStyle}>
                        {entry.logType === "completion"
                          ? entry.completionFromStatus || entry.completionToStatus
                            ? getCompletionTransitionLabel(entry.completionFromStatus, entry.completionToStatus || entry.completionStatus)
                            : getCompletionLogEventLabel(entry.completionStatus)
                          : "Timer"}
                      </td>
                      <td style={cellStyle}>{entry.issueId || "-"}</td>
                      <td style={cellStyle}>{entry.projectName || "-"}</td>
                      <td style={cellStyle}>
                        {editingLogId === entry.id ? (
                          <div style={{ minWidth: "220px", display: "grid", gap: "8px" }}>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", minHeight: "24px" }}>
                              {editingTaskTags.length > 0 ? (
                                editingTaskTags.map((tag) => (
                                  <TagChip
                                    key={`${entry.id}-${tag}`}
                                    tag={tag}
                                    onRemove={() => handleRemoveEditingLogTag(tag)}
                                  />
                                ))
                              ) : (
                                <span style={{ color: "#94A3B8", fontSize: "0.85rem" }}>No tags</span>
                              )}
                            </div>
                            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                              {showEditingLogTagInput ? (
                                <>
                                  <input
                                    type="text"
                                    value={editingTaskTagInput}
                                    onChange={(event) => setEditingTaskTagInput(event.target.value)}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter" || event.key === ",") {
                                        event.preventDefault();
                                        handleAddEditingLogTag();
                                      }
                                      if (event.key === "Escape") {
                                        event.preventDefault();
                                        setShowEditingLogTagInput(false);
                                        setEditingTaskTagInput("");
                                      }
                                    }}
                                    placeholder="Add tag"
                                    style={{
                                      width: "100%",
                                      minWidth: "120px",
                                      padding: "8px 10px",
                                      border: "1px solid #CBD5E1",
                                      borderRadius: "6px",
                                      fontFamily: "inherit",
                                      fontSize: "0.9rem",
                                    }}
                                  />
                                  <button
                                    type="button"
                                    onClick={handleAddEditingLogTag}
                                    style={{
                                      backgroundColor: "#0F766E",
                                      color: "#FFFFFF",
                                      border: "none",
                                      borderRadius: "8px",
                                      padding: "7px 10px",
                                      cursor: "pointer",
                                      fontWeight: 600,
                                    }}
                                  >
                                    Add
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setShowEditingLogTagInput(false);
                                      setEditingTaskTagInput("");
                                    }}
                                    style={{
                                      backgroundColor: "#64748B",
                                      color: "#FFFFFF",
                                      border: "none",
                                      borderRadius: "8px",
                                      padding: "7px 10px",
                                      cursor: "pointer",
                                      fontWeight: 600,
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setShowEditingLogTagInput(true)}
                                  style={{
                                    backgroundColor: "#0F766E",
                                    color: "#FFFFFF",
                                    border: "none",
                                    borderRadius: "8px",
                                    padding: "7px 10px",
                                    cursor: "pointer",
                                    fontWeight: 600,
                                  }}
                                >
                                  Add Tag
                                </button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div
                            style={{
                              minWidth: "220px",
                              maxWidth: "360px",
                              color: Array.isArray(entry.taskTags) && entry.taskTags.length > 0 ? "#334155" : "#94A3B8",
                            }}
                          >
                            {Array.isArray(entry.taskTags) && entry.taskTags.length > 0 ? (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                                {entry.taskTags.map((tag) => (
                                  <TagChip
                                    key={`${entry.id}-tag-${tag}`}
                                    tag={tag}
                                    muted={true}
                                  />
                                ))}
                              </div>
                            ) : "-"}
                          </div>
                        )}
                      </td>
                      <td style={cellStyle}>
                        {editingLogId === entry.id ? (
                          <input
                            type="text"
                            value={editingRegisteredBy}
                            onChange={(event) => setEditingRegisteredBy(event.target.value)}
                            style={{ width: "100%", minWidth: "150px", padding: "8px", border: "1px solid #CBD5E1", borderRadius: "6px" }}
                          />
                        ) : (
                          entry.registeredBy || "Unknown user"
                        )}
                      </td>
                      <td style={cellStyle}>
                        {editingLogId === entry.id && entry.logType !== "completion" ? (
                          <div style={{ display: "grid", gap: "6px", minWidth: "210px" }}>
                            <input
                              type="date"
                              value={editingStartDate}
                              onChange={(event) => setEditingStartDate(event.target.value)}
                              style={{ width: "100%", padding: "8px", border: "1px solid #CBD5E1", borderRadius: "6px" }}
                            />
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" }}>
                              <select
                                value={editingStartHour}
                                onChange={(event) => setEditingStartHour(event.target.value)}
                                style={{ padding: "8px", border: "1px solid #CBD5E1", borderRadius: "6px", backgroundColor: "#FFFFFF" }}
                              >
                                {TWELVE_HOUR_OPTIONS.map((option) => (
                                  <option key={`start-hour-${option}`} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                              <select
                                value={editingStartMinute}
                                onChange={(event) => setEditingStartMinute(event.target.value)}
                                style={{ padding: "8px", border: "1px solid #CBD5E1", borderRadius: "6px", backgroundColor: "#FFFFFF" }}
                              >
                                {MINUTE_OPTIONS.map((option) => (
                                  <option key={`start-minute-${option}`} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                              <select
                                value={editingStartMeridiem}
                                onChange={(event) => setEditingStartMeridiem(event.target.value)}
                                style={{ padding: "8px", border: "1px solid #CBD5E1", borderRadius: "6px", backgroundColor: "#FFFFFF" }}
                              >
                                <option value="AM">AM</option>
                                <option value="PM">PM</option>
                              </select>
                            </div>
                          </div>
                        ) : (
                          formatTimestamp(entry.logType === "completion" ? entry.completionAt || entry.endedAt : entry.startedAt)
                        )}
                      </td>
                      <td style={cellStyle}>
                        {editingLogId === entry.id && entry.logType !== "completion" ? (
                          <div style={{ display: "grid", gap: "6px", minWidth: "210px" }}>
                            <input
                              type="date"
                              value={editingEndDate}
                              onChange={(event) => setEditingEndDate(event.target.value)}
                              style={{ width: "100%", padding: "8px", border: "1px solid #CBD5E1", borderRadius: "6px" }}
                            />
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" }}>
                              <select
                                value={editingEndHour}
                                onChange={(event) => setEditingEndHour(event.target.value)}
                                style={{ padding: "8px", border: "1px solid #CBD5E1", borderRadius: "6px", backgroundColor: "#FFFFFF" }}
                              >
                                {TWELVE_HOUR_OPTIONS.map((option) => (
                                  <option key={`end-hour-${option}`} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                              <select
                                value={editingEndMinute}
                                onChange={(event) => setEditingEndMinute(event.target.value)}
                                style={{ padding: "8px", border: "1px solid #CBD5E1", borderRadius: "6px", backgroundColor: "#FFFFFF" }}
                              >
                                {MINUTE_OPTIONS.map((option) => (
                                  <option key={`end-minute-${option}`} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                              <select
                                value={editingEndMeridiem}
                                onChange={(event) => setEditingEndMeridiem(event.target.value)}
                                style={{ padding: "8px", border: "1px solid #CBD5E1", borderRadius: "6px", backgroundColor: "#FFFFFF" }}
                              >
                                <option value="AM">AM</option>
                                <option value="PM">PM</option>
                              </select>
                            </div>
                          </div>
                        ) : (
                          formatTimestamp(entry.logType === "completion" ? entry.completionAt || entry.endedAt : entry.endedAt)
                        )}
                      </td>
                      <td style={cellStyle}>{entry.logType === "completion" ? "-" : formatDuration(entry.durationMs)}</td>
                      <td style={cellStyle}>
                        {Array.isArray(entry.notes) && entry.notes.length > 0 ? (
                          <div style={{ display: "grid", gap: "6px", minWidth: "240px" }}>
                            {entry.notes.map((note, noteIndex) => (
                              <div key={`${entry.id}-note-${noteIndex}`} style={{ fontSize: "0.85rem", color: "#334155", display: "grid", gap: "2px" }}>
                                <div>[{formatTimestamp(note.timestamp)}] {note.text || "File attachment"}</div>
                                {note.attachment?.url ? (
                                  <div style={{ display: "grid", gap: "4px" }}>
                                    {isImageAttachment(note.attachment) ? (
                                      <a
                                        href={note.attachment.url}
                                        onClick={(event) => handleOpenImagePreview(note.attachment, event)}
                                        style={{ display: "inline-block", width: "fit-content" }}
                                      >
                                        <img
                                          src={note.attachment.url}
                                          alt={note.attachment.name || "Attachment preview"}
                                          style={{ width: "78px", height: "78px", objectFit: "cover", borderRadius: "8px", border: "1px solid #CBD5E1", backgroundColor: "#FFFFFF" }}
                                        />
                                      </a>
                                    ) : null}
                                    <a
                                      href={note.attachment.url}
                                      onClick={isImageAttachment(note.attachment)
                                        ? (event) => handleOpenImagePreview(note.attachment, event)
                                        : undefined}
                                      target={isImageAttachment(note.attachment) ? undefined : "_blank"}
                                      rel={isImageAttachment(note.attachment) ? undefined : "noopener noreferrer"}
                                      style={{ color: "#1D4ED8", textDecoration: "underline", fontWeight: 600 }}
                                    >
                                      Open file: {note.attachment.name || "Attachment"}
                                    </a>
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span style={{ color: "#94A3B8" }}>-</span>
                        )}
                      </td>
                      <td style={cellStyle}>
                        {editingLogId === entry.id ? (
                          <div style={{ display: "flex", gap: "8px" }}>
                            <button
                              type="button"
                              onClick={() => handleSaveLogEdit(entry.id)}
                              style={{
                                backgroundColor: "#0F766E",
                                color: "#FFFFFF",
                                border: "none",
                                borderRadius: "8px",
                                padding: "7px 10px",
                                cursor: "pointer",
                                fontWeight: 600,
                              }}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingLogId("");
                                setEditingRegisteredBy("");
                                setEditingTaskTags([]);
                                setEditingTaskTagInput("");
                                setEditingStartDate("");
                                setEditingStartHour("12");
                                setEditingStartMinute("00");
                                setEditingStartMeridiem("AM");
                                setEditingEndDate("");
                                setEditingEndHour("12");
                                setEditingEndMinute("00");
                                setEditingEndMeridiem("AM");
                                setEditingError("");
                              }}
                              style={{
                                backgroundColor: "#64748B",
                                color: "#FFFFFF",
                                border: "none",
                                borderRadius: "8px",
                                padding: "7px 10px",
                                cursor: "pointer",
                                fontWeight: 600,
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", gap: "8px" }}>
                            {entry.logType !== "completion" && (
                              <button
                                type="button"
                                onClick={() => handleBeginEditLog(entry)}
                                style={{
                                  backgroundColor: "#1D4ED8",
                                  color: "#FFFFFF",
                                  border: "none",
                                  borderRadius: "8px",
                                  padding: "7px 10px",
                                  cursor: "pointer",
                                  fontWeight: 600,
                                }}
                              >
                                Edit
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDeleteLog(entry.id)}
                              style={{
                                backgroundColor: "#DC2626",
                                color: "#FFFFFF",
                                border: "none",
                                borderRadius: "8px",
                                padding: "7px 10px",
                                cursor: "pointer",
                                fontWeight: 600,
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                        {editingLogId === entry.id && editingError && (
                          <div style={{ color: "#DC2626", fontSize: "0.8rem", marginTop: "6px" }}>
                            {editingError}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        )}

            <div
              style={{
                marginTop: "16px",
                borderTop: "1px solid #E2E8F0",
                paddingTop: "14px",
              }}
            >
              <h3 style={{ margin: 0, fontSize: "1rem", color: "#0F172A" }}>In Progress Notes</h3>

              {visibleInProgressTimers.length === 0 ? (
                <p style={{ marginTop: "8px", marginBottom: 0, color: "#64748B" }}>
                  {logViewMode === "all"
                    ? "No active timers found for any users right now."
                    : "No active timer. Start a task to capture and view in-progress notes here."}
                </p>
              ) : (
                <div style={{ display: "grid", gap: "10px", marginTop: "10px" }}>
                  {visibleInProgressTimers.map((timerEntry) => (
                    <div
                      key={timerEntry.docId || `${timerEntry.userId}-${timerEntry.startedAt}`}
                      style={{
                        border: "1px solid #BFDBFE",
                        backgroundColor: "#EFF6FF",
                        borderRadius: "10px",
                        padding: "10px 12px",
                      }}
                    >
                      <div style={{ fontWeight: 700, color: "#1E3A8A", marginBottom: "6px" }}>
                        {timerEntry.issueId || "-"} ({timerEntry.projectName || "No project"})
                      </div>
                      <div style={{ color: "#334155", fontSize: "0.84rem", marginBottom: "6px" }}>
                        {timerEntry.registeredBy || "Unknown user"} • Started {formatTimestamp(timerEntry.startedAt)}
                      </div>
                      {Array.isArray(timerEntry.notes) && timerEntry.notes.length > 0 ? (
                        <div style={{ display: "grid", gap: "6px" }}>
                          {timerEntry.notes.map((note, noteIndex) => (
                            <div key={`${timerEntry.docId || timerEntry.startedAt}-${note.timestamp}-${noteIndex}`} style={{ fontSize: "0.88rem", color: "#1E3A8A", display: "grid", gap: "2px" }}>
                              <div>[{formatTimestamp(note.timestamp)}] {note.text || "File attachment"}</div>
                              {note.attachment?.url ? (
                                <div style={{ display: "grid", gap: "4px" }}>
                                  {isImageAttachment(note.attachment) ? (
                                    <a
                                      href={note.attachment.url}
                                      onClick={(event) => handleOpenImagePreview(note.attachment, event)}
                                      style={{ display: "inline-block", width: "fit-content" }}
                                    >
                                      <img
                                        src={note.attachment.url}
                                        alt={note.attachment.name || "Attachment preview"}
                                        style={{ width: "74px", height: "74px", objectFit: "cover", borderRadius: "8px", border: "1px solid #93C5FD", backgroundColor: "#FFFFFF" }}
                                      />
                                    </a>
                                  ) : null}
                                  <a
                                    href={note.attachment.url}
                                    onClick={isImageAttachment(note.attachment)
                                      ? (event) => handleOpenImagePreview(note.attachment, event)
                                      : undefined}
                                    target={isImageAttachment(note.attachment) ? undefined : "_blank"}
                                    rel={isImageAttachment(note.attachment) ? undefined : "noopener noreferrer"}
                                    style={{ color: "#1D4ED8", textDecoration: "underline", fontWeight: 600, fontSize: "0.8rem" }}
                                  >
                                    Open file: {note.attachment.name || "Attachment"}
                                  </a>
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ color: "#64748B", fontSize: "0.86rem" }}>No notes added yet.</div>
                      )}

                      {canEditInProgressTimer(timerEntry) ? (
                        <div style={{ marginTop: "10px", display: "grid", gap: "6px" }}>
                          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                            <input
                              type="text"
                              value={inProgressNoteInputs[timerEntry.docId] || ""}
                              onChange={(event) => handleInProgressNoteInputChange(timerEntry.docId, event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  handleAddInProgressNote(timerEntry);
                                }
                              }}
                              placeholder="Add a note to this active timer"
                              style={{
                                flex: "1 1 280px",
                                padding: "8px 10px",
                                border: "1px solid #93C5FD",
                                borderRadius: "8px",
                                backgroundColor: "#FFFFFF",
                              }}
                            />
                            <input
                              type="file"
                              onChange={(event) => handleInProgressNoteFileChange(timerEntry.docId, event.target.files?.[0] || null)}
                              style={{
                                flex: "0 1 260px",
                                padding: "8px 10px",
                                border: "1px solid #93C5FD",
                                borderRadius: "8px",
                                backgroundColor: "#FFFFFF",
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => handleAddInProgressNote(timerEntry)}
                              disabled={Boolean(savingInProgressNoteByDocId[timerEntry.docId])}
                              style={{
                                backgroundColor: "#2563EB",
                                color: "#FFFFFF",
                                border: "none",
                                borderRadius: "8px",
                                padding: "8px 12px",
                                cursor: savingInProgressNoteByDocId[timerEntry.docId] ? "not-allowed" : "pointer",
                                fontWeight: 600,
                                opacity: savingInProgressNoteByDocId[timerEntry.docId] ? 0.75 : 1,
                              }}
                            >
                              {savingInProgressNoteByDocId[timerEntry.docId] ? "Saving..." : "Add Note"}
                            </button>
                          </div>
                          {inProgressNoteFilesByDocId[timerEntry.docId] ? (
                            <div style={{ color: "#1E3A8A", fontSize: "0.8rem", fontWeight: 600 }}>
                              Attachment ready: {inProgressNoteFilesByDocId[timerEntry.docId].name}
                              {formatFileSize(inProgressNoteFilesByDocId[timerEntry.docId].size)
                                ? ` (${formatFileSize(inProgressNoteFilesByDocId[timerEntry.docId].size)})`
                                : ""}
                            </div>
                          ) : null}
                          {inProgressNoteErrorByDocId[timerEntry.docId] ? (
                            <div style={{ color: "#B91C1C", fontSize: "0.82rem", fontWeight: 600 }}>
                              {inProgressNoteErrorByDocId[timerEntry.docId]}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {projectNameQuickUpdate.open && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(15, 23, 42, 0.42)",
              zIndex: 1200,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "16px",
            }}
          >
            <div
              style={{
                width: "min(560px, 100%)",
                backgroundColor: "#FFFFFF",
                borderRadius: "14px",
                border: "1px solid #E2E8F0",
                boxShadow: "0 26px 64px rgba(15, 23, 42, 0.28)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "14px 16px",
                  borderBottom: "1px solid #E2E8F0",
                }}
              >
                <span style={{ fontWeight: 700, color: "#0F172A" }}>Quick Update</span>
                <button
                  type="button"
                  onClick={handleCloseProjectNameQuickUpdate}
                  style={{
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    color: "#64748B",
                    fontSize: "1.4rem",
                    lineHeight: 1,
                  }}
                  aria-label="Close quick update"
                >
                  ×
                </button>
              </div>

              <div style={{ padding: "16px" }}>
                <div style={{ color: "#334155", marginBottom: "8px", fontSize: "0.9rem" }}>
                  Issue ID: <strong>{projectNameQuickUpdate.card?.issueId || "-"}</strong>
                </div>
                <label style={{ display: "grid", gap: "8px", color: "#0F172A", fontWeight: 600 }}>
                  Project Name
                  <select
                    value={projectNameQuickUpdate.value}
                    onChange={(event) =>
                      setProjectNameQuickUpdate((current) => ({
                        ...current,
                        value: event.target.value,
                      }))
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleSaveTaskProjectNameQuickUpdate();
                      }
                    }}
                    style={{
                      width: "100%",
                      padding: "9px 10px",
                      border: "1px solid #CBD5E1",
                      borderRadius: "8px",
                      fontSize: "0.92rem",
                      fontFamily: "inherit",
                      backgroundColor: "#FFFFFF",
                    }}
                  >
                    <option value="">Select project name...</option>
                    {Array.from(new Set([projectNameQuickUpdate.value, ...projectNameOptions].filter(Boolean))).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "8px",
                  padding: "12px 16px 16px",
                }}
              >
                <button
                  type="button"
                  onClick={handleCloseProjectNameQuickUpdate}
                  style={{
                    backgroundColor: "#E2E8F0",
                    color: "#0F172A",
                    border: "none",
                    borderRadius: "8px",
                    padding: "8px 12px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={handleSaveTaskProjectNameQuickUpdate}
                  disabled={Boolean(savingTaskProjectNameByIdentity[projectNameQuickUpdate.card?.taskIdentity])}
                  style={{
                    backgroundColor: "#2563EB",
                    color: "#FFFFFF",
                    border: "none",
                    borderRadius: "8px",
                    padding: "8px 12px",
                    fontWeight: 600,
                    cursor: Boolean(savingTaskProjectNameByIdentity[projectNameQuickUpdate.card?.taskIdentity])
                      ? "not-allowed"
                      : "pointer",
                    opacity: Boolean(savingTaskProjectNameByIdentity[projectNameQuickUpdate.card?.taskIdentity]) ? 0.75 : 1,
                  }}
                >
                  {Boolean(savingTaskProjectNameByIdentity[projectNameQuickUpdate.card?.taskIdentity]) ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        )}

        {imagePreviewAttachment?.url && isImageAttachment(imagePreviewAttachment) ? (
          <div
            role="dialog"
            aria-modal="true"
            onClick={handleCloseImagePreview}
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(15, 23, 42, 0.68)",
              zIndex: 1400,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "16px",
            }}
          >
            <div
              onClick={(event) => event.stopPropagation()}
              style={{
                width: "min(560px, 100%)",
                backgroundColor: "#FFFFFF",
                borderRadius: "14px",
                border: "1px solid #E2E8F0",
                boxShadow: "0 26px 64px rgba(15, 23, 42, 0.35)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "12px 14px",
                  borderBottom: "1px solid #E2E8F0",
                }}
              >
                <div style={{ color: "#0F172A", fontWeight: 700, fontSize: "0.92rem" }}>
                  {imagePreviewAttachment.name || "Image attachment"}
                </div>
                <button
                  type="button"
                  onClick={handleCloseImagePreview}
                  style={{
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    color: "#64748B",
                    fontSize: "1.4rem",
                    lineHeight: 1,
                  }}
                  aria-label="Close image preview"
                >
                  ×
                </button>
              </div>
              <div style={{ padding: "14px", display: "grid", gap: "10px" }}>
                <img
                  src={imagePreviewAttachment.url}
                  alt={imagePreviewAttachment.name || "Image attachment"}
                  style={{
                    width: "100%",
                    maxHeight: "62vh",
                    objectFit: "contain",
                    borderRadius: "10px",
                    border: "1px solid #CBD5E1",
                    backgroundColor: "#F8FAFC",
                  }}
                />
                <a
                  href={imagePreviewAttachment.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#1D4ED8", textDecoration: "underline", fontWeight: 600, fontSize: "0.84rem" }}
                >
                  Open original image
                </a>
              </div>
            </div>
          </div>
        ) : null}

        <datalist id="task-tag-suggestions">
          {tagSuggestionOptions.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      </div>
    </div>
  );
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
};

const filterSelectStyle = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #CBD5E1",
  borderRadius: "8px",
  backgroundColor: "#FFFFFF",
};

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #CBD5E1",
  borderRadius: "8px",
  backgroundColor: "#FFFFFF",
  color: "#0F172A",
};

export default TimeRotate;
