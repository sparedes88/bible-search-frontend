import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  serverTimestamp,
  updateDoc,
  writeBatch,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { toast } from "react-toastify";
import { useAuth } from "../contexts/AuthContext";
import { db, storage } from "../firebase";
import ChurchHeader from "./ChurchHeader";
import commonStyles from "../pages/commonStyles";
import { canManageModule } from "../utils/enhancedPermissions";

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

const buttonStyle = {
  border: "none",
  borderRadius: "8px",
  padding: "8px 12px",
  fontWeight: 600,
  cursor: "pointer",
  color: "#FFFFFF",
};

const TASK_PRIORITY_OPTIONS = [
  { value: "low", label: "Low", bg: "#ECFDF5", text: "#166534" },
  { value: "medium", label: "Medium", bg: "#EEF2FF", text: "#3730A3" },
  { value: "high", label: "High", bg: "#FEF3C7", text: "#92400E" },
  { value: "critical", label: "Critical", bg: "#FEE2E2", text: "#991B1B" },
];

const PRIORITY_SORT_RANK = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const DIRECTION_SORT_RANK = {
  stop_and_start: 3,
  add_to_queue: 2,
  steer_with_current_task: 1,
};

const TASK_DIRECTION_OPTIONS = [
  { value: "stop_and_start", label: "Stop and Start", bg: "#FEF3C7", text: "#92400E" },
  { value: "add_to_queue", label: "Add to Queue", bg: "#E0E7FF", text: "#3730A3" },
  { value: "steer_with_current_task", label: "Steer with current task", bg: "#DCFCE7", text: "#166534" },
];

const NOTE_ATTACHMENT_MAX_SIZE_BYTES = 50 * 1024 * 1024;
const COMMITMENT_TASKS_PER_PAGE = 25;

const normalizeValue = (value) => String(value || "").trim();

const sanitizeFileName = (value) => {
  const normalizedName = normalizeValue(value);
  if (!normalizedName) return "attachment";
  return normalizedName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
};

const normalizeLogAttachment = (value) => {
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

const toDateInputValue = (value) => {
  const raw = normalizeValue(value);
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

const normalizeProgressPercent = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.max(0, Math.min(100, Math.round(numericValue)));
};

const isTaskCompleted = (task) => {
  if (!task || typeof task !== "object") return false;

  const status = normalizeValue(task.status).toLowerCase();
  if (status === "done") return true;

  if (task.completedAt) return true;

  return normalizeProgressPercent(task.progressPercent) >= 100;
};

const normalizeTaskOrder = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
};

const normalizeTaskPriority = (value) => {
  const normalizedValue = normalizeValue(value).toLowerCase();
  return TASK_PRIORITY_OPTIONS.some((option) => option.value === normalizedValue)
    ? normalizedValue
    : "medium";
};

const normalizeTaskDirection = (value) => {
  const normalizedValue = normalizeValue(value).toLowerCase().replace(/\s+/g, "_");
  return TASK_DIRECTION_OPTIONS.some((option) => option.value === normalizedValue)
    ? normalizedValue
    : "stop_and_start";
};

const normalizeTaskChangeLog = (value) => {
  if (!Array.isArray(value)) return [];

  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      message: normalizeValue(entry.message),
      changedAtIso: normalizeValue(entry.changedAtIso),
      changedByName: normalizeValue(entry.changedByName),
      changedByUid: normalizeValue(entry.changedByUid),
      attachment: normalizeLogAttachment(entry.attachment),
    }))
    .filter((entry) => entry.message || entry.changedAtIso || entry.attachment?.url);
};

const toMillis = (value) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 0;
  return parsed.getTime();
};

const getFirestoreDateMillis = (value) => {
  const parsedDate = value?.toDate?.() || (value ? new Date(value) : null);
  if (!parsedDate || Number.isNaN(parsedDate.getTime())) return 0;
  return parsedDate.getTime();
};

const isTaskNoteLogEntry = (entry) => {
  const message = normalizeValue(entry?.message).toLowerCase();
  const hasAttachment = Boolean(normalizeValue(entry?.attachment?.url));

  return message.startsWith("note:") || (hasAttachment && message === "file attachment added");
};

const normalizeStringArray = (value) => {
  if (!Array.isArray(value)) return [];
  const uniqueValues = new Set();

  value.forEach((item) => {
    const normalized = normalizeValue(item);
    if (normalized) {
      uniqueValues.add(normalized);
    }
  });

  return Array.from(uniqueValues);
};

const formatLogTimestamp = (value) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
};

const formatDateDisplay = (value) => {
  const normalized = toDateInputValue(value);
  if (!normalized) return "-";

  const parsed = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "-";

  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).format(parsed);
};

const getDueDateCountdownMeta = (value) => {
  const normalized = toDateInputValue(value);
  if (!normalized) {
    return {
      label: "No due date",
      bg: "#F1F5F9",
      text: "#475569",
    };
  }

  const dueDate = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(dueDate.getTime())) {
    return {
      label: "No due date",
      bg: "#F1F5F9",
      text: "#475569",
    };
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const millisPerDay = 24 * 60 * 60 * 1000;
  const dayDelta = Math.round((dueDate.getTime() - today.getTime()) / millisPerDay);

  if (dayDelta < 0) {
    const overdueDays = Math.abs(dayDelta);
    return {
      label: `${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue`,
      bg: "#FEE2E2",
      text: "#991B1B",
    };
  }

  if (dayDelta === 0) {
    return {
      label: "Due today",
      bg: "#FEF3C7",
      text: "#92400E",
    };
  }

  return {
    label: `${dayDelta} day${dayDelta === 1 ? "" : "s"} left`,
    bg: "#DCFCE7",
    text: "#166534",
  };
};

const getTaskDueDateCountdownMeta = (task) => {
  if (isTaskCompleted(task)) {
    return {
      label: "Completed",
      bg: "#DCFCE7",
      text: "#166534",
    };
  }

  return getDueDateCountdownMeta(task?.dueDate);
};

const getTaskHierarchyMeta = (taskDepth) => {
  const depth = Math.max(0, Number(taskDepth) || 0);

  if (depth === 0) {
    return {
      label: "Task",
      description: "Top level",
      badgeBackground: "rgba(29, 78, 216, 0.10)",
      badgeText: "#1D4ED8",
      markerText: "#1D4ED8",
      indent: 0,
    };
  }

  if (depth === 1) {
    return {
      label: "Subtask",
      description: "Direct child",
      badgeBackground: "rgba(74, 122, 91, 0.12)",
      badgeText: "#3F5F4A",
      markerText: "#DC2626",
      indent: 1,
    };
  }

  return {
    label: `Nested subtask L${depth}`,
    description: `Nested under a subtask${depth > 2 ? ` (${depth} levels deep)` : ""}`,
    badgeBackground: "rgba(124, 58, 237, 0.12)",
    badgeText: "#5B21B6",
    markerText: "#7C3AED",
    indent: Math.min(depth + 1, 8),
  };
};

const getDueDateDeltaDays = (value) => {
  const normalized = toDateInputValue(value);
  if (!normalized) return Number.POSITIVE_INFINITY;

  const dueDate = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(dueDate.getTime())) return Number.POSITIVE_INFINITY;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const millisPerDay = 24 * 60 * 60 * 1000;
  return Math.round((dueDate.getTime() - today.getTime()) / millisPerDay);
};

const buildTaskSearchText = (task, parentTaskTitleById, categoryName = "") => {
  const taskPriority = normalizeTaskPriority(task?.priority);
  const taskDirection = normalizeTaskDirection(task?.direction);
  const taskPriorityLabel = TASK_PRIORITY_OPTIONS.find((option) => option.value === taskPriority)?.label || "";
  const taskDirectionLabel = TASK_DIRECTION_OPTIONS.find((option) => option.value === taskDirection)?.label || "";
  const taskStatus = normalizeValue(task?.status).toLowerCase() === "done" ? "done completed" : "open active";
  const parentTaskTitle = parentTaskTitleById.get(normalizeValue(task?.parentTaskId)) || "";
  const dueDateRaw = toDateInputValue(task?.dueDate);
  const dueDateDisplay = formatDateDisplay(task?.dueDate);
  const dueDateCountdown = getTaskDueDateCountdownMeta(task)?.label || "";
  const taskSheetLogIdentifiers = normalizeSheetLogIdentifierArray(task?.sheetLogIdentifiers);
  const taskSheetLogSearchText = taskSheetLogIdentifiers.length > 0
    ? taskSheetLogIdentifiers.join(" ")
    : normalizeValue(task?.sheetLogIdentifier);
  const changeLogText = normalizeTaskChangeLog(task?.changeLog)
    .map((entry) => [entry.message, entry.changedByName, entry.attachment?.name].filter(Boolean).join(" "))
    .join(" ");

  return [
    normalizeValue(task?.title),
    normalizeValue(task?.description),
    normalizeValue(task?.notes),
    normalizeValue(task?.projectName),
    normalizeValue(categoryName),
    parentTaskTitle,
    taskPriority,
    taskPriorityLabel,
    taskDirection,
    taskDirectionLabel,
    taskStatus,
    normalizeValue(task?.assignedToName),
    normalizeValue(task?.assignedToEmail),
    normalizeValue(task?.ticketId),
    normalizeValue(task?.sheetLogSheetName),
    normalizeValue(task?.sheetLogType),
    normalizeValue(task?.sheetLogRevisionNumber),
    taskSheetLogSearchText,
    String(normalizeProgressPercent(task?.progressPercent)),
    dueDateRaw,
    dueDateDisplay,
    dueDateCountdown,
    changeLogText,
  ]
    .join(" ")
    .toLowerCase();
};

const normalizeCommitmentCategoryEntry = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const name = normalizeValue(value.name);
  if (!name) return null;

  return {
    id: normalizeValue(value.id),
    name,
    description: normalizeValue(value.description),
  };
};

const normalizeCommitmentCategoryCatalog = (value) => {
  if (!Array.isArray(value)) return [];

  const uniqueEntries = new Map();

  value.forEach((entry) => {
    const normalized = normalizeCommitmentCategoryEntry(entry);
    if (!normalized) return;

    const key = normalized.id || normalized.name.toLowerCase();
    if (uniqueEntries.has(key)) return;
    uniqueEntries.set(key, normalized);
  });

  return Array.from(uniqueEntries.values()).sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
  );
};

const buildSheetLogSearchText = (entry) => {
  const identifiers = normalizeSheetLogIdentifierArray(entry?.identifiers);
  const fallbackIdentifier = normalizeValue(entry?.identifier);
  const identifierSearchText = identifiers.length > 0
    ? identifiers.join(" ")
    : fallbackIdentifier;

  return [
    normalizeValue(entry?.projectName),
    normalizeValue(entry?.sheetName),
    identifierSearchText,
    normalizeValue(entry?.type),
    normalizeValue(entry?.revisionNumber),
    entry?.shouldCreateSheet ? "yes create sheet" : "no do not create sheet",
  ]
    .join(" ")
    .toLowerCase();
};

const normalizeSheetLogIdentifierArray = (value) => {
  if (Array.isArray(value)) {
    return normalizeStringArray(value);
  }

  const normalized = normalizeValue(value);
  if (!normalized) return [];

  return normalizeStringArray(
    normalized
      .split(/[\n,;|]+/)
      .map((entry) => normalizeValue(entry))
      .filter(Boolean)
  );
};

const identifiersToDraftText = (identifiers, fallback = "") => {
  const normalizedIdentifiers = normalizeSheetLogIdentifierArray(identifiers);
  if (normalizedIdentifiers.length > 0) {
    return normalizedIdentifiers.join(", ");
  }
  return normalizeValue(fallback);
};

const formatSheetLogIdentifiers = (entry) => {
  const normalizedIdentifiers = normalizeSheetLogIdentifierArray(entry?.identifiers);
  if (normalizedIdentifiers.length > 0) {
    return normalizedIdentifiers.join(", ");
  }
  return normalizeValue(entry?.identifier);
};

const createSheetLogTypeId = (value) => {
  const normalized = normalizeValue(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return normalized || `sheet-type-${Date.now()}`;
};

const normalizeSheetLogTypeCatalog = (value) => {
  if (!Array.isArray(value)) return [];

  const uniqueEntries = new Map();

  value.forEach((entry) => {
    if (typeof entry === "string") {
      const name = normalizeValue(entry);
      if (!name) return;
      const id = createSheetLogTypeId(name);
      if (!uniqueEntries.has(id)) {
        uniqueEntries.set(id, { id, name, description: "" });
      }
      return;
    }

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;

    const name = normalizeValue(entry.name || entry.label || entry.value);
    if (!name) return;

    const id = normalizeValue(entry.id) || createSheetLogTypeId(name);
    uniqueEntries.set(id, {
      id,
      name,
      description: normalizeValue(entry.description),
    });
  });

  return Array.from(uniqueEntries.values()).sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
  );
};

const WorkProgressModule = () => {
  const { id } = useParams();
  const { user } = useAuth();

  const routePrefix =
    typeof window !== "undefined" && window.location?.pathname?.includes("/church/")
      ? "/church"
      : "/organization";

  const [checkingPermissions, setCheckingPermissions] = useState(true);
  const [canManageCommitments, setCanManageCommitments] = useState(false);

  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [organizationUsers, setOrganizationUsers] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(true);

  const [draft, setDraft] = useState({ title: "", description: "", projectId: "", categoryId: "", parentTaskId: "", sheetLogId: "", notes: "", dueDate: "", progressPercent: "0", priority: "medium", direction: "stop_and_start" });
  const [isQuickTaskOpen, setIsQuickTaskOpen] = useState(false);
  const [savingTask, setSavingTask] = useState(false);
  const [selectedEditTaskId, setSelectedEditTaskId] = useState("");
  const [editTaskDraft, setEditTaskDraft] = useState(null);
  const [savingEditTask, setSavingEditTask] = useState(false);
  const [selectedLogTaskId, setSelectedLogTaskId] = useState("");
  const [logNoteDraft, setLogNoteDraft] = useState("");
  const [logNoteFileDraft, setLogNoteFileDraft] = useState(null);
  const [logNoteError, setLogNoteError] = useState("");
  const [savingLogNote, setSavingLogNote] = useState(false);
  const [imagePreviewAttachment, setImagePreviewAttachment] = useState(null);
  const [projectFilter, setProjectFilter] = useState("all");
  const [sheetLogProjectFilter, setSheetLogProjectFilter] = useState("all");
  const [taskSearchTerm, setTaskSearchTerm] = useState("");
  const [taskStatusFilter, setTaskStatusFilter] = useState("both");
  const [sheetLogSearchTerm, setSheetLogSearchTerm] = useState("");
  const [taskCreatedSortOrder, setTaskCreatedSortOrder] = useState("manual_order");
  const [sheetLogCreatedSortOrder, setSheetLogCreatedSortOrder] = useState("newest_first");
  const [prioritySortOrder, setPrioritySortOrder] = useState("none");
  const [countdownSortOrder, setCountdownSortOrder] = useState("none");
  const [directionSortOrder, setDirectionSortOrder] = useState("none");
  const [activeSectionTab, setActiveSectionTab] = useState("commitments");
  const [commitmentCategoryFilter, setCommitmentCategoryFilter] = useState("all");
  const [commitmentsPage, setCommitmentsPage] = useState(1);
  const [movingTaskId, setMovingTaskId] = useState("");
  const [hasLoadedPersistedFilters, setHasLoadedPersistedFilters] = useState(false);
  const [commitmentCategories, setCommitmentCategories] = useState([]);
  const [loadingCommitmentCategories, setLoadingCommitmentCategories] = useState(true);
  const [commitmentCategoryDraft, setCommitmentCategoryDraft] = useState({ name: "", description: "" });
  const [editingCommitmentCategoryId, setEditingCommitmentCategoryId] = useState("");
  const [editingCommitmentCategoryDraft, setEditingCommitmentCategoryDraft] = useState({ name: "", description: "" });
  const [savingCommitmentCategory, setSavingCommitmentCategory] = useState(false);
  const [sheetLogs, setSheetLogs] = useState([]);
  const [loadingSheetLogs, setLoadingSheetLogs] = useState(true);
  const [sheetLogTypes, setSheetLogTypes] = useState([]);
  const [loadingSheetLogTypes, setLoadingSheetLogTypes] = useState(true);
  const [sheetLogTypeDraft, setSheetLogTypeDraft] = useState({ name: "", description: "" });
  const [editingSheetLogTypeId, setEditingSheetLogTypeId] = useState("");
  const [editingSheetLogTypeDraft, setEditingSheetLogTypeDraft] = useState({ name: "", description: "" });
  const [savingSheetLogType, setSavingSheetLogType] = useState(false);
  const [sheetLogDraft, setSheetLogDraft] = useState({
    projectId: "",
    shouldCreateSheet: "yes",
    sheetName: "",
    identifier: "",
    type: "",
    revisionNumber: "",
  });
  const [savingSheetLog, setSavingSheetLog] = useState(false);
  const [editingSheetLogId, setEditingSheetLogId] = useState("");
  const [editingSheetLogDraft, setEditingSheetLogDraft] = useState(null);
  const [editingSheetLogIdentifiers, setEditingSheetLogIdentifiers] = useState([]);
  const [savingSheetLogEdit, setSavingSheetLogEdit] = useState(false);

  const projectsRef = useMemo(() => collection(db, "churches", id, "projectListIssueProjects"), [id]);
  const commitmentsRef = useMemo(() => collection(db, "churches", id, "commitments"), [id]);
  const commitmentCategoriesRef = useMemo(() => collection(db, "churches", id, "workProgressCommitmentCategories"), [id]);
  const sheetLogsRef = useMemo(() => collection(db, "churches", id, "workProgressSheetLogs"), [id]);
  const sheetLogSettingsRef = useMemo(() => doc(db, "churches", id, "workProgressSettings", "sheetLog"), [id]);
  const persistedFiltersStorageKey = useMemo(() => {
    const normalizedId = normalizeValue(id);
    return normalizedId ? `workProgressFilters:${normalizedId}` : "";
  }, [id]);
  const selectedLogTask = useMemo(
    () => tasks.find((task) => task.id === selectedLogTaskId) || null,
    [selectedLogTaskId, tasks]
  );
  const selectedEditTask = useMemo(
    () => tasks.find((task) => task.id === selectedEditTaskId) || null,
    [selectedEditTaskId, tasks]
  );
  const selectedSheetLog = useMemo(
    () => sheetLogs.find((entry) => entry.id === editingSheetLogId) || null,
    [editingSheetLogId, sheetLogs]
  );
  const selectedSheetLogType = useMemo(
    () => sheetLogTypes.find((entry) => entry.id === editingSheetLogTypeId) || null,
    [editingSheetLogTypeId, sheetLogTypes]
  );
  const selectedCommitmentCategory = useMemo(
    () => commitmentCategories.find((entry) => entry.id === editingCommitmentCategoryId) || null,
    [commitmentCategories, editingCommitmentCategoryId]
  );
  const childTaskIdsByParentId = useMemo(() => {
    const map = new Map();

    tasks.forEach((task) => {
      const parentTaskId = normalizeValue(task.parentTaskId);
      if (!parentTaskId) return;

      if (!map.has(parentTaskId)) {
        map.set(parentTaskId, []);
      }

      map.get(parentTaskId).push(task.id);
    });

    return map;
  }, [tasks]);
  const parentTaskTitleById = useMemo(() => {
    const map = new Map();
    tasks.forEach((task) => {
      map.set(task.id, normalizeValue(task.title) || "Untitled Task");
    });
    return map;
  }, [tasks]);
  const commitmentCategoryById = useMemo(() => {
    const map = new Map();
    commitmentCategories.forEach((category) => {
      map.set(category.id, category);
    });
    return map;
  }, [commitmentCategories]);
  const commitmentCategoryOptions = useMemo(
    () => commitmentCategories.map((category) => ({ value: category.id, label: category.name, description: category.description })),
    [commitmentCategories]
  );
  const sheetLogById = useMemo(() => {
    const map = new Map();
    sheetLogs.forEach((entry) => {
      const entryId = normalizeValue(entry.id);
      if (!entryId) return;
      map.set(entryId, entry);
    });
    return map;
  }, [sheetLogs]);
  const commitmentSheetLogOptions = useMemo(() => {
    return sheetLogs
      .map((entry) => {
        const entryId = normalizeValue(entry.id);
        if (!entryId) return null;

        const projectId = normalizeValue(entry.projectId);
        const sheetName = normalizeValue(entry.sheetName) || "Untitled Sheet";
        const sheetType = normalizeValue(entry.type);
        const sheetRevision = normalizeValue(entry.revisionNumber);
        const identifiers = normalizeSheetLogIdentifierArray(
          Array.isArray(entry.identifiers) && entry.identifiers.length > 0
            ? entry.identifiers
            : entry.identifier
        );
        const identifierPreview = identifiers.length > 0 ? identifiers[0] : "";

        return {
          value: entryId,
          projectId,
          label: [
            sheetName,
            sheetType ? `Type: ${sheetType}` : "",
            sheetRevision ? `Rev: ${sheetRevision}` : "",
            identifierPreview ? `ID: ${identifierPreview}` : "",
          ].filter(Boolean).join(" | "),
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base" }));
  }, [sheetLogs]);
  const createSheetLogOptions = useMemo(() => {
    const normalizedProjectId = normalizeValue(draft.projectId);
    return commitmentSheetLogOptions.filter((option) => normalizeValue(option.projectId) === normalizedProjectId);
  }, [commitmentSheetLogOptions, draft.projectId]);
  const editSheetLogOptions = useMemo(() => {
    const normalizedProjectId = normalizeValue(editTaskDraft?.projectId);
    return commitmentSheetLogOptions.filter((option) => normalizeValue(option.projectId) === normalizedProjectId);
  }, [commitmentSheetLogOptions, editTaskDraft?.projectId]);
  const parentTaskOptionsByProjectId = useMemo(() => {
    const map = new Map();

    tasks.forEach((task) => {
      const projectId = normalizeValue(task.projectId);
      if (!projectId) return;

      if (!map.has(projectId)) {
        map.set(projectId, []);
      }

      map.get(projectId).push({
        value: task.id,
        label: normalizeValue(task.title) || "Untitled Task",
      });
    });

    map.forEach((entries, projectId) => {
      map.set(
        projectId,
        entries.sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base" }))
      );
    });

    return map;
  }, [tasks]);
  const createParentTaskOptions = useMemo(() => {
    const normalizedProjectId = normalizeValue(draft.projectId);
    if (!normalizedProjectId) return [];
    return parentTaskOptionsByProjectId.get(normalizedProjectId) || [];
  }, [draft.projectId, parentTaskOptionsByProjectId]);
  const editParentTaskOptions = useMemo(() => {
    const normalizedProjectId = normalizeValue(editTaskDraft?.projectId);
    if (!normalizedProjectId) return [];
    return parentTaskOptionsByProjectId.get(normalizedProjectId) || [];
  }, [editTaskDraft?.projectId, parentTaskOptionsByProjectId]);

  useEffect(() => {
    if (!persistedFiltersStorageKey) {
      setHasLoadedPersistedFilters(false);
      return;
    }

    try {
      const rawValue = window.localStorage.getItem(persistedFiltersStorageKey);
      if (rawValue) {
        const parsedValue = JSON.parse(rawValue);
        const persistedProjectFilter = normalizeValue(parsedValue?.projectFilter);

        if (persistedProjectFilter) {
          setProjectFilter(persistedProjectFilter);
        }
      }
    } catch (error) {
      console.warn("Could not restore Work Progress filters:", error);
    } finally {
      setHasLoadedPersistedFilters(true);
    }
  }, [persistedFiltersStorageKey]);

  useEffect(() => {
    if (!persistedFiltersStorageKey || !hasLoadedPersistedFilters) return;

    try {
      window.localStorage.setItem(
        persistedFiltersStorageKey,
        JSON.stringify({
          projectFilter: normalizeValue(projectFilter) || "all",
        })
      );
    } catch (error) {
      console.warn("Could not persist Work Progress filters:", error);
    }
  }, [hasLoadedPersistedFilters, persistedFiltersStorageKey, projectFilter]);
  const disallowedEditParentTaskIds = useMemo(() => {
    const disallowed = new Set();
    if (!selectedEditTaskId) return disallowed;

    disallowed.add(selectedEditTaskId);
    const queue = [selectedEditTaskId];

    while (queue.length > 0) {
      const currentTaskId = queue.shift();
      const childIds = childTaskIdsByParentId.get(currentTaskId) || [];

      childIds.forEach((childId) => {
        if (disallowed.has(childId)) return;
        disallowed.add(childId);
        queue.push(childId);
      });
    }

    return disallowed;
  }, [childTaskIdsByParentId, selectedEditTaskId]);

  useEffect(() => {
    const normalizedProjectId = normalizeValue(draft.projectId);
    if (!normalizedProjectId) {
      if (normalizeValue(draft.parentTaskId)) {
        setDraft((previous) => ({ ...previous, parentTaskId: "" }));
      }
      return;
    }

    const allowedParentTaskIds = new Set((parentTaskOptionsByProjectId.get(normalizedProjectId) || []).map((option) => option.value));
    if (draft.parentTaskId && !allowedParentTaskIds.has(draft.parentTaskId)) {
      setDraft((previous) => ({ ...previous, parentTaskId: "" }));
    }
  }, [draft.parentTaskId, draft.projectId, parentTaskOptionsByProjectId]);

  useEffect(() => {
    const normalizedProjectId = normalizeValue(draft.projectId);
    if (!normalizedProjectId) {
      if (normalizeValue(draft.sheetLogId)) {
        setDraft((previous) => ({ ...previous, sheetLogId: "" }));
      }
      return;
    }

    const allowedSheetLogIds = new Set(createSheetLogOptions.map((option) => option.value));
    if (draft.sheetLogId && !allowedSheetLogIds.has(draft.sheetLogId)) {
      setDraft((previous) => ({ ...previous, sheetLogId: "" }));
    }
  }, [createSheetLogOptions, draft.projectId, draft.sheetLogId]);

  useEffect(() => {
    if (!editTaskDraft) return;

    const normalizedProjectId = normalizeValue(editTaskDraft.projectId);
    if (!normalizedProjectId) {
      if (normalizeValue(editTaskDraft.parentTaskId)) {
        setEditTaskDraft((previous) => (previous ? { ...previous, parentTaskId: "" } : previous));
      }
      return;
    }

    const allowedParentTaskIds = new Set((parentTaskOptionsByProjectId.get(normalizedProjectId) || []).map((option) => option.value));
    if (editTaskDraft.parentTaskId && !allowedParentTaskIds.has(editTaskDraft.parentTaskId)) {
      setEditTaskDraft((previous) => (previous ? { ...previous, parentTaskId: "" } : previous));
    }
  }, [editTaskDraft, parentTaskOptionsByProjectId]);

  useEffect(() => {
    if (!editTaskDraft) return;

    const normalizedProjectId = normalizeValue(editTaskDraft.projectId);
    if (!normalizedProjectId) {
      if (normalizeValue(editTaskDraft.sheetLogId)) {
        setEditTaskDraft((previous) => (previous ? { ...previous, sheetLogId: "" } : previous));
      }
      return;
    }

    const allowedSheetLogIds = new Set(editSheetLogOptions.map((option) => option.value));
    if (editTaskDraft.sheetLogId && !allowedSheetLogIds.has(editTaskDraft.sheetLogId)) {
      setEditTaskDraft((previous) => (previous ? { ...previous, sheetLogId: "" } : previous));
    }
  }, [editSheetLogOptions, editTaskDraft]);

  const isManualTaskOrderEnabled =
    taskCreatedSortOrder === "manual_order"
    && prioritySortOrder === "none"
    && countdownSortOrder === "none"
    && directionSortOrder === "none";
  const siblingMoveMetaByTaskId = useMemo(() => {
    const byParentAndProject = new Map();
    const moveMeta = new Map();

    tasks.forEach((task) => {
      const parentTaskId = normalizeValue(task.parentTaskId);
      const projectId = normalizeValue(task.projectId);
      const groupKey = `${parentTaskId}::${projectId}`;
      if (!byParentAndProject.has(groupKey)) {
        byParentAndProject.set(groupKey, []);
      }
      byParentAndProject.get(groupKey).push(task);
    });

    byParentAndProject.forEach((siblings) => {
      siblings
        .slice()
        .sort((leftTask, rightTask) => {
          const orderDifference = normalizeTaskOrder(leftTask.taskOrder) - normalizeTaskOrder(rightTask.taskOrder);
          if (orderDifference !== 0) return orderDifference;

          const leftCreatedAt = getFirestoreDateMillis(leftTask?.createdAt);
          const rightCreatedAt = getFirestoreDateMillis(rightTask?.createdAt);
          return leftCreatedAt - rightCreatedAt;
        })
        .forEach((task, index, orderedSiblings) => {
          moveMeta.set(task.id, {
            index,
            total: orderedSiblings.length,
          });
        });
    });

    return moveMeta;
  }, [tasks]);
  const getDescendantTaskIds = (taskId) => {
    const normalizedTaskId = normalizeValue(taskId);
    if (!normalizedTaskId) return [];

    const descendantIds = [];
    const visitedIds = new Set([normalizedTaskId]);
    const queue = [normalizedTaskId];

    while (queue.length > 0) {
      const currentTaskId = queue.shift();
      const childIds = childTaskIdsByParentId.get(currentTaskId) || [];

      childIds.forEach((childId) => {
        if (visitedIds.has(childId)) return;
        visitedIds.add(childId);
        descendantIds.push(childId);
        queue.push(childId);
      });
    }

    return descendantIds;
  };
  const taskProjectOptions = useMemo(() => {
    const optionsMap = new Map();

    projects.forEach((project) => {
      const key = normalizeValue(project.id);
      if (!key) return;
      optionsMap.set(key, normalizeValue(project.name) || "Untitled Project");
    });

    tasks.forEach((task) => {
      const key = normalizeValue(task.projectId);
      if (!key || optionsMap.has(key)) return;
      optionsMap.set(key, normalizeValue(task.projectName) || "Untitled Project");
    });

    return Array.from(optionsMap.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base" }));
  }, [projects, tasks]);
  const commitmentTableColumnCount = 10;

  const displayedTasks = useMemo(() => {
    const normalizedSearch = normalizeValue(taskSearchTerm).toLowerCase();
    const filteredTasks = tasks.filter((task) => {
      const matchesProject = projectFilter === "all" || normalizeValue(task.projectId) === projectFilter;
      if (!matchesProject) return false;

      const isDone = isTaskCompleted(task);
      if (taskStatusFilter === "completed" && !isDone) return false;
      if (taskStatusFilter === "incomplete" && isDone) return false;

      if (!normalizedSearch) return true;

      const categoryName = normalizeValue(commitmentCategoryById.get(normalizeValue(task.categoryId))?.name || task.categoryName);
      return buildTaskSearchText(task, parentTaskTitleById, categoryName).includes(normalizedSearch);
    });

    if (isManualTaskOrderEnabled) {
      const filteredTaskIds = new Set(filteredTasks.map((task) => task.id));
      const tasksByParentId = new Map();
      const visitedTaskIds = new Set();
      const flattenedTasks = [];

      filteredTasks.forEach((task) => {
        const rawParentTaskId = normalizeValue(task.parentTaskId);
        const parentTaskId = rawParentTaskId && filteredTaskIds.has(rawParentTaskId)
          ? rawParentTaskId
          : "";

        if (!tasksByParentId.has(parentTaskId)) {
          tasksByParentId.set(parentTaskId, []);
        }

        tasksByParentId.get(parentTaskId).push(task);
      });

      tasksByParentId.forEach((taskList) => {
        taskList.sort((leftTask, rightTask) => {
          const orderDifference = normalizeTaskOrder(leftTask.taskOrder) - normalizeTaskOrder(rightTask.taskOrder);
          if (orderDifference !== 0) return orderDifference;

          const leftCreatedAt = getFirestoreDateMillis(leftTask?.createdAt);
          const rightCreatedAt = getFirestoreDateMillis(rightTask?.createdAt);
          return leftCreatedAt - rightCreatedAt;
        });
      });

      const appendTasks = (parentTaskId, depth) => {
        const siblings = tasksByParentId.get(parentTaskId) || [];
        siblings.forEach((task) => {
          if (visitedTaskIds.has(task.id)) return;
          visitedTaskIds.add(task.id);
          flattenedTasks.push({ ...task, __depth: depth });
          appendTasks(task.id, depth + 1);
        });
      };

      appendTasks("", 0);

      filteredTasks.forEach((task) => {
        if (visitedTaskIds.has(task.id)) return;
        flattenedTasks.push({ ...task, __depth: 0 });
      });

      return flattenedTasks;
    }

    const sortedTasks = [...filteredTasks];

    sortedTasks.sort((leftTask, rightTask) => {
      if (countdownSortOrder !== "none") {
        const leftCountdown = getDueDateDeltaDays(leftTask?.dueDate);
        const rightCountdown = getDueDateDeltaDays(rightTask?.dueDate);
        const countdownDifference = leftCountdown - rightCountdown;

        if (countdownDifference !== 0) {
          return countdownSortOrder === "latest_first" ? -countdownDifference : countdownDifference;
        }
      }

      if (prioritySortOrder !== "none") {
        const leftPriorityRank = PRIORITY_SORT_RANK[normalizeTaskPriority(leftTask?.priority)] || 0;
        const rightPriorityRank = PRIORITY_SORT_RANK[normalizeTaskPriority(rightTask?.priority)] || 0;
        const priorityDifference = rightPriorityRank - leftPriorityRank;

        if (priorityDifference !== 0) {
          return prioritySortOrder === "lowest_first" ? -priorityDifference : priorityDifference;
        }
      }

      if (directionSortOrder !== "none") {
        const leftDirectionRank = DIRECTION_SORT_RANK[normalizeTaskDirection(leftTask?.direction)] || 0;
        const rightDirectionRank = DIRECTION_SORT_RANK[normalizeTaskDirection(rightTask?.direction)] || 0;
        const directionDifference = rightDirectionRank - leftDirectionRank;

        if (directionDifference !== 0) {
          return directionSortOrder === "reverse" ? -directionDifference : directionDifference;
        }
      }

      const leftCreatedAt = getFirestoreDateMillis(leftTask?.createdAt);
      const rightCreatedAt = getFirestoreDateMillis(rightTask?.createdAt);
      return taskCreatedSortOrder === "oldest_first"
        ? leftCreatedAt - rightCreatedAt
        : rightCreatedAt - leftCreatedAt;
    });

    return sortedTasks.map((task) => ({ ...task, __depth: 0 }));
  }, [commitmentCategoryById, countdownSortOrder, directionSortOrder, isManualTaskOrderEnabled, parentTaskTitleById, prioritySortOrder, projectFilter, taskCreatedSortOrder, taskSearchTerm, taskStatusFilter, tasks]);

  const categoryFilteredDisplayedTasks = useMemo(() => {
    const selectedCategoryId = commitmentCategoryFilter === "all" ? "" : commitmentCategoryFilter;
    if (!selectedCategoryId) return displayedTasks;

    return displayedTasks.filter((task) => {
      const categoryId = normalizeValue(task.categoryId);
      const fallbackLabel = normalizeValue(task.categoryName);
      const sectionKey = categoryId || fallbackLabel || "__uncategorized__";
      return sectionKey === selectedCategoryId;
    });
  }, [commitmentCategoryFilter, displayedTasks]);

  const totalCommitmentPages = useMemo(() => {
    return Math.max(1, Math.ceil(categoryFilteredDisplayedTasks.length / COMMITMENT_TASKS_PER_PAGE));
  }, [categoryFilteredDisplayedTasks.length]);

  const paginatedCommitmentTasks = useMemo(() => {
    const startIndex = (Math.max(commitmentsPage, 1) - 1) * COMMITMENT_TASKS_PER_PAGE;
    return categoryFilteredDisplayedTasks.slice(startIndex, startIndex + COMMITMENT_TASKS_PER_PAGE);
  }, [categoryFilteredDisplayedTasks, commitmentsPage]);

  useEffect(() => {
    setCommitmentsPage((previousPage) => Math.min(Math.max(previousPage, 1), totalCommitmentPages));
  }, [totalCommitmentPages]);

  useEffect(() => {
    setCommitmentsPage(1);
  }, [projectFilter, taskSearchTerm, taskStatusFilter, commitmentCategoryFilter, prioritySortOrder, countdownSortOrder, directionSortOrder, taskCreatedSortOrder]);

  const displayedTaskSections = useMemo(() => {
    const sectionsByKey = new Map();
    const selectedCategoryId = commitmentCategoryFilter === "all" ? "" : commitmentCategoryFilter;
    const shouldFlattenSections =
      prioritySortOrder !== "none"
      || countdownSortOrder !== "none"
      || directionSortOrder !== "none"
      || taskCreatedSortOrder !== "manual_order";

    const selectedCategoryOption = selectedCategoryId
      ? commitmentCategoryOptions.find((option) => option.value === selectedCategoryId)
      : null;

    if (shouldFlattenSections) {
      if (!paginatedCommitmentTasks.length) {
        return [];
      }

      return [
        {
          key: selectedCategoryId || "__all_sorted__",
          categoryId: selectedCategoryId,
          label: selectedCategoryOption?.label || "All Commitments",
          description: "Sorted across all categories",
          tasks: paginatedCommitmentTasks,
        },
      ];
    }

    paginatedCommitmentTasks.forEach((task) => {
      const categoryId = normalizeValue(task.categoryId);
      const categoryData = categoryId ? commitmentCategoryById.get(categoryId) : null;
      const fallbackLabel = normalizeValue(task.categoryName);
      const sectionKey = categoryId || fallbackLabel || "__uncategorized__";
      const sectionLabel = categoryData?.name || fallbackLabel || "Uncategorized";

      if (!sectionsByKey.has(sectionKey)) {
        sectionsByKey.set(sectionKey, {
          key: sectionKey,
          categoryId,
          label: sectionLabel,
          description: categoryData?.description || "",
          tasks: [],
        });
      }

      sectionsByKey.get(sectionKey).tasks.push(task);
    });

    const orderedSections = [];
    commitmentCategoryOptions.forEach((option) => {
      const section = sectionsByKey.get(option.value);
      if (section) {
        orderedSections.push(section);
        sectionsByKey.delete(option.value);
      }
    });

    if (sectionsByKey.has("__uncategorized__")) {
      orderedSections.push(sectionsByKey.get("__uncategorized__"));
      sectionsByKey.delete("__uncategorized__");
    }

    sectionsByKey.forEach((section) => {
      orderedSections.push(section);
    });

    return orderedSections;
  }, [commitmentCategoryById, commitmentCategoryFilter, commitmentCategoryOptions, countdownSortOrder, directionSortOrder, paginatedCommitmentTasks, prioritySortOrder, taskCreatedSortOrder]);

  const displayedTaskCategoryCounts = useMemo(() => {
    const counts = new Map();

    displayedTasks.forEach((task) => {
      const categoryId = normalizeValue(task.categoryId);
      const fallbackLabel = normalizeValue(task.categoryName);
      const sectionKey = categoryId || fallbackLabel || "__uncategorized__";
      counts.set(sectionKey, (counts.get(sectionKey) || 0) + 1);
    });

    return counts;
  }, [displayedTasks]);

  const getTaskRowColors = (isDone, taskDepth, rowIndex) => {
    const isEvenRow = (Number(rowIndex) || 0) % 2 === 0;

    if (isDone) {
      return {
        rowBackground: isEvenRow ? "#F8FAF9" : "#F2F7F4",
        accentBackground: "#E2ECE6",
        accentBorder: "#86A895",
        subtaskBadgeBackground: "rgba(74, 122, 91, 0.12)",
        subtaskBadgeText: "#3F5F4A",
      };
    }

    const depthMutedAccent = ["#D0D7E2", "#C2CBD8", "#B4BFCE", "#A8B5C5"];
    const accentBackgroundByDepth = ["#E8EDF4", "#E2E8F0", "#DCE4EE", "#D6DFEA"];
    const depthIndex = Math.min(taskDepth, depthMutedAccent.length - 1);

    return {
      rowBackground: isEvenRow ? "#FFFFFF" : "#F7F8FA",
      accentBackground: accentBackgroundByDepth[depthIndex],
      accentBorder: depthMutedAccent[depthIndex],
      subtaskBadgeBackground: accentBackgroundByDepth[depthIndex],
      subtaskBadgeText: "#475569",
    };
  };

  const categoryHeaderThemes = [
    {
      cardBackground: "linear-gradient(135deg, #EEF2FF 0%, #FFFFFF 68%)",
      cardBorder: "#C7D2FE",
      accentRail: "linear-gradient(180deg, rgba(79, 70, 229, 0.70) 0%, rgba(99, 102, 241, 0.16) 100%)",
      labelBackground: "rgba(79, 70, 229, 0.08)",
      labelText: "#312E81",
      titleText: "#0F172A",
      lineGradient: "linear-gradient(90deg, rgba(79, 70, 229, 0.46) 0%, rgba(79, 70, 229, 0.18) 100%)",
      arrowColor: "rgba(79, 70, 229, 0.56)",
      countText: "#475569",
    },
    {
      cardBackground: "linear-gradient(135deg, #ECFEFF 0%, #FFFFFF 68%)",
      cardBorder: "#A5F3FC",
      accentRail: "linear-gradient(180deg, rgba(8, 145, 178, 0.70) 0%, rgba(34, 211, 238, 0.16) 100%)",
      labelBackground: "rgba(8, 145, 178, 0.08)",
      labelText: "#164E63",
      titleText: "#082F49",
      lineGradient: "linear-gradient(90deg, rgba(8, 145, 178, 0.46) 0%, rgba(8, 145, 178, 0.18) 100%)",
      arrowColor: "rgba(8, 145, 178, 0.56)",
      countText: "#0F766E",
    },
    {
      cardBackground: "linear-gradient(135deg, #FFF7ED 0%, #FFFFFF 68%)",
      cardBorder: "#FED7AA",
      accentRail: "linear-gradient(180deg, rgba(234, 88, 12, 0.68) 0%, rgba(251, 146, 60, 0.16) 100%)",
      labelBackground: "rgba(234, 88, 12, 0.08)",
      labelText: "#7C2D12",
      titleText: "#1F2937",
      lineGradient: "linear-gradient(90deg, rgba(234, 88, 12, 0.40) 0%, rgba(234, 88, 12, 0.16) 100%)",
      arrowColor: "rgba(234, 88, 12, 0.56)",
      countText: "#9A3412",
    },
    {
      cardBackground: "linear-gradient(135deg, #F5F3FF 0%, #FFFFFF 68%)",
      cardBorder: "#DDD6FE",
      accentRail: "linear-gradient(180deg, rgba(124, 58, 237, 0.70) 0%, rgba(167, 139, 250, 0.16) 100%)",
      labelBackground: "rgba(124, 58, 237, 0.08)",
      labelText: "#4C1D95",
      titleText: "#111827",
      lineGradient: "linear-gradient(90deg, rgba(124, 58, 237, 0.42) 0%, rgba(124, 58, 237, 0.16) 100%)",
      arrowColor: "rgba(124, 58, 237, 0.56)",
      countText: "#5B21B6",
    },
    {
      cardBackground: "linear-gradient(135deg, #F0FDF4 0%, #FFFFFF 68%)",
      cardBorder: "#BBF7D0",
      accentRail: "linear-gradient(180deg, rgba(22, 163, 74, 0.70) 0%, rgba(74, 222, 128, 0.16) 100%)",
      labelBackground: "rgba(22, 163, 74, 0.08)",
      labelText: "#14532D",
      titleText: "#0F172A",
      lineGradient: "linear-gradient(90deg, rgba(22, 163, 74, 0.42) 0%, rgba(22, 163, 74, 0.16) 100%)",
      arrowColor: "rgba(22, 163, 74, 0.56)",
      countText: "#166534",
    },
  ];

  const getCategoryHeaderTheme = (sectionIndex) => categoryHeaderThemes[sectionIndex % categoryHeaderThemes.length];

  const sheetLogProjectOptions = useMemo(() => {
    const optionsMap = new Map();

    projects.forEach((project) => {
      const key = normalizeValue(project.id);
      if (!key) return;
      optionsMap.set(key, normalizeValue(project.name) || "Untitled Project");
    });

    sheetLogs.forEach((entry) => {
      const key = normalizeValue(entry.projectId);
      if (!key || optionsMap.has(key)) return;
      optionsMap.set(key, normalizeValue(entry.projectName) || "Untitled Project");
    });

    return Array.from(optionsMap.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base" }));
  }, [projects, sheetLogs]);

  const sheetLogTypeOptions = useMemo(() => {
    const knownTypes = new Set(sheetLogTypes.map((entry) => normalizeValue(entry.name)).filter(Boolean));

    const selectedDraftType = normalizeValue(sheetLogDraft.type);
    if (selectedDraftType) {
      knownTypes.add(selectedDraftType);
    }

    const selectedEditType = normalizeValue(editingSheetLogDraft?.type);
    if (selectedEditType) {
      knownTypes.add(selectedEditType);
    }

    return Array.from(knownTypes).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
  }, [editingSheetLogDraft?.type, sheetLogDraft.type, sheetLogTypes]);
  const selectedSheetLogTypeDescription = useMemo(
    () => sheetLogTypes.find((entry) => normalizeValue(entry.name) === normalizeValue(sheetLogDraft.type))?.description || "",
    [sheetLogDraft.type, sheetLogTypes]
  );
  const selectedEditingSheetLogTypeDescription = useMemo(
    () => sheetLogTypes.find((entry) => normalizeValue(entry.name) === normalizeValue(editingSheetLogDraft?.type))?.description || "",
    [editingSheetLogDraft?.type, sheetLogTypes]
  );

  const displayedSheetLogs = useMemo(() => {
    const normalizedSearch = normalizeValue(sheetLogSearchTerm).toLowerCase();
    const filteredEntries = sheetLogs.filter((entry) => {
      const matchesProject = sheetLogProjectFilter === "all" || normalizeValue(entry.projectId) === sheetLogProjectFilter;
      if (!matchesProject) return false;

      if (!normalizedSearch) return true;
      return buildSheetLogSearchText(entry).includes(normalizedSearch);
    });

    return [...filteredEntries].sort((leftEntry, rightEntry) => {
      const leftCreatedAt = getFirestoreDateMillis(leftEntry?.createdAt);
      const rightCreatedAt = getFirestoreDateMillis(rightEntry?.createdAt);
      return sheetLogCreatedSortOrder === "oldest_first"
        ? leftCreatedAt - rightCreatedAt
        : rightCreatedAt - leftCreatedAt;
    });
  }, [sheetLogCreatedSortOrder, sheetLogProjectFilter, sheetLogSearchTerm, sheetLogs]);

  useEffect(() => {
    setLogNoteDraft("");
    setLogNoteFileDraft(null);
    setLogNoteError("");
    setSavingLogNote(false);
  }, [selectedLogTaskId]);

  useEffect(() => {
    if (!editingSheetLogId) {
      setEditingSheetLogDraft(null);
      setEditingSheetLogIdentifiers([]);
      setSavingSheetLogEdit(false);
      return;
    }

    const selectedSheetLog = sheetLogs.find((entry) => entry.id === editingSheetLogId);
    if (!selectedSheetLog) {
      setEditingSheetLogDraft(null);
      return;
    }

    setEditingSheetLogDraft({
      projectId: normalizeValue(selectedSheetLog.projectId),
      shouldCreateSheet: selectedSheetLog.shouldCreateSheet ? "yes" : "no",
      sheetName: normalizeValue(selectedSheetLog.sheetName),
      identifier: (() => {
        const normalizedIdentifiers = normalizeSheetLogIdentifierArray(selectedSheetLog.identifiers);
        return normalizedIdentifiers.length > 0 ? normalizedIdentifiers.join("\n") : normalizeValue(selectedSheetLog.identifier);
      })(),
      type: normalizeValue(selectedSheetLog.type),
      revisionNumber: normalizeValue(selectedSheetLog.revisionNumber),
    });
    setEditingSheetLogIdentifiers(
      normalizeSheetLogIdentifierArray(
        Array.isArray(selectedSheetLog.identifiers) && selectedSheetLog.identifiers.length > 0
          ? selectedSheetLog.identifiers
          : selectedSheetLog.identifier
      )
    );
  }, [editingSheetLogId, sheetLogs]);

  useEffect(() => {
    if (!id) {
      setSheetLogTypes([]);
      setLoadingSheetLogTypes(false);
      return undefined;
    }

    setLoadingSheetLogTypes(true);

    const unsubscribe = onSnapshot(
      sheetLogSettingsRef,
      (snapshot) => {
        const nextTypes = normalizeSheetLogTypeCatalog(snapshot.data()?.types || []);
        setSheetLogTypes(nextTypes);
        setLoadingSheetLogTypes(false);
      },
      (error) => {
        console.error("Failed to load Sheet Log types:", error);
        toast.error("Could not load Sheet Log types.");
        setSheetLogTypes([]);
        setLoadingSheetLogTypes(false);
      }
    );

    return unsubscribe;
  }, [id, sheetLogSettingsRef]);

  useEffect(() => {
    if (sheetLogDraft.type || sheetLogTypeOptions.length === 0) return;
    setSheetLogDraft((previous) => ({ ...previous, type: sheetLogTypeOptions[0] || "" }));
  }, [sheetLogDraft.type, sheetLogTypeOptions]);

  useEffect(() => {
    if (!id) {
      setCommitmentCategories([]);
      setLoadingCommitmentCategories(false);
      return undefined;
    }

    setLoadingCommitmentCategories(true);

    const unsubscribe = onSnapshot(
      query(commitmentCategoriesRef, orderBy("createdAt", "desc")),
      (snapshot) => {
        const nextCategories = normalizeCommitmentCategoryCatalog(
          snapshot.docs.map((categoryDoc) => ({
            id: categoryDoc.id,
            ...categoryDoc.data(),
          }))
        );

        setCommitmentCategories(nextCategories);
        setLoadingCommitmentCategories(false);
      },
      (error) => {
        console.error("Failed to load commitment categories:", error);
        toast.error("Could not load commitment categories.");
        setCommitmentCategories([]);
        setLoadingCommitmentCategories(false);
      }
    );

    return unsubscribe;
  }, [commitmentCategoriesRef, id]);

  useEffect(() => {
    if (!selectedCommitmentCategory) {
      setEditingCommitmentCategoryDraft({ name: "", description: "" });
      return;
    }

    setEditingCommitmentCategoryDraft({
      name: normalizeValue(selectedCommitmentCategory.name),
      description: normalizeValue(selectedCommitmentCategory.description),
    });
  }, [selectedCommitmentCategory]);

  useEffect(() => {
    if (commitmentCategoryFilter === "all") return;

    if (!commitmentCategories.some((entry) => entry.id === commitmentCategoryFilter)) {
      setCommitmentCategoryFilter("all");
    }
  }, [commitmentCategories, commitmentCategoryFilter]);

  useEffect(() => {
    if (!selectedSheetLogType) {
      setEditingSheetLogTypeDraft({ name: "", description: "" });
      return;
    }

    setEditingSheetLogTypeDraft({
      name: normalizeValue(selectedSheetLogType.name),
      description: normalizeValue(selectedSheetLogType.description),
    });
  }, [selectedSheetLogType]);

  useEffect(() => {
    if (!selectedEditTask) {
      setEditTaskDraft(null);
      setSavingEditTask(false);
      return;
    }

    setEditTaskDraft({
      title: normalizeValue(selectedEditTask.title),
      description: normalizeValue(selectedEditTask.description),
      projectId: normalizeValue(selectedEditTask.projectId),
      categoryId: normalizeValue(selectedEditTask.categoryId),
      parentTaskId: normalizeValue(selectedEditTask.parentTaskId),
      sheetLogId: normalizeValue(selectedEditTask.sheetLogId),
      notes: normalizeValue(selectedEditTask.notes),
      dueDate: toDateInputValue(selectedEditTask.dueDate),
      progressPercent: String(normalizeProgressPercent(selectedEditTask.progressPercent)),
      priority: normalizeTaskPriority(selectedEditTask.priority),
      direction: normalizeTaskDirection(selectedEditTask.direction),
      status: normalizeValue(selectedEditTask.status).toLowerCase() === "done" ? "done" : "open",
    });
  }, [selectedEditTask]);

  const handleOpenImagePreview = (attachment, event) => {
    if (!isImageAttachment(attachment)) return;
    if (event) event.preventDefault();
    setImagePreviewAttachment(attachment);
  };

  const handleCloseImagePreview = () => {
    setImagePreviewAttachment(null);
  };

  const uploadLogAttachment = async ({ file, taskId }) => {
    if (!file) return null;

    if (!storage) {
      throw new Error("Firebase Storage is not available right now.");
    }

    if (file.size > NOTE_ATTACHMENT_MAX_SIZE_BYTES) {
      throw new Error("File is too large. Max size is 50 MB.");
    }

    const safeTaskId = normalizeValue(taskId) || "task";
    const safeName = sanitizeFileName(file.name);
    const filePath = `churches/${id}/workProgressNoteAttachments/${safeTaskId}/${Date.now()}-${safeName}`;
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
  };

  const buildTaskLogEntry = (message, attachment = null) => ({
    message: normalizeValue(message),
    changedAtIso: new Date().toISOString(),
    changedByName: normalizeValue(user?.displayName || user?.name || user?.email || "Unknown user"),
    changedByUid: normalizeValue(user?.uid),
    attachment: normalizeLogAttachment(attachment),
  });

  const getNextTaskOrderForParent = (parentTaskId, excludedTaskId = "", projectId = "") => {
    const normalizedParentTaskId = normalizeValue(parentTaskId);
    const normalizedProjectId = normalizeValue(projectId);
    const siblingOrders = tasks
      .filter(
        (task) => (
          normalizeValue(task.parentTaskId) === normalizedParentTaskId
          && task.id !== excludedTaskId
          && (!normalizedProjectId || normalizeValue(task.projectId) === normalizedProjectId)
        )
      )
      .map((task) => normalizeTaskOrder(task.taskOrder));

    if (siblingOrders.length === 0) {
      return Date.now();
    }

    return Math.max(...siblingOrders) + 1000;
  };

  const handleMoveTask = async (task, direction) => {
    if (!canManageCommitments || !task?.id) return;
    if (movingTaskId) return;

    if (!isManualTaskOrderEnabled) {
      toast.info("Enable Manual order and clear other sort options to reorder tasks.");
      return;
    }

    const normalizedParentTaskId = normalizeValue(task.parentTaskId);
    const normalizedProjectId = normalizeValue(task.projectId);
    const orderedSiblings = tasks
      .filter(
        (entry) => normalizeValue(entry.parentTaskId) === normalizedParentTaskId
          && normalizeValue(entry.projectId) === normalizedProjectId
      )
      .sort((leftTask, rightTask) => {
        const orderDifference = normalizeTaskOrder(leftTask.taskOrder) - normalizeTaskOrder(rightTask.taskOrder);
        if (orderDifference !== 0) return orderDifference;

        const leftCreatedAt = getFirestoreDateMillis(leftTask?.createdAt);
        const rightCreatedAt = getFirestoreDateMillis(rightTask?.createdAt);
        return leftCreatedAt - rightCreatedAt;
      });

    const currentIndex = orderedSiblings.findIndex((entry) => entry.id === task.id);
    if (currentIndex === -1) return;

    const offset = direction === "up" ? -1 : 1;
    const targetIndex = currentIndex + offset;
    if (targetIndex < 0 || targetIndex >= orderedSiblings.length) return;

    const movingTask = orderedSiblings[currentIndex];
    if (!movingTask?.id) return;

    const reorderedSiblings = [...orderedSiblings];
    reorderedSiblings.splice(currentIndex, 1);
    reorderedSiblings.splice(targetIndex, 0, movingTask);

    const orderById = new Map(reorderedSiblings.map((entry, index) => [entry.id, (index + 1) * 1000]));
    const previousTasksSnapshot = tasks;

    setTasks((previousTasks) => previousTasks.map((entry) => (
      orderById.has(entry.id)
        ? { ...entry, taskOrder: orderById.get(entry.id) }
        : entry
    )));

    try {
      setMovingTaskId(task.id);

      // Keep ordering deterministic on every click to avoid precision/gap issues over repeated moves.
      const chunkSize = 450;
      for (let startIndex = 0; startIndex < reorderedSiblings.length; startIndex += chunkSize) {
        const chunk = reorderedSiblings.slice(startIndex, startIndex + chunkSize);
        const batch = writeBatch(db);

        chunk.forEach((entry, chunkOffset) => {
          const absoluteIndex = startIndex + chunkOffset;
          batch.update(doc(db, "churches", id, "commitments", entry.id), {
            taskOrder: (absoluteIndex + 1) * 1000,
            updatedAt: serverTimestamp(),
          });
        });

        await batch.commit();
      }

    } catch (error) {
      setTasks(previousTasksSnapshot);
      console.error("Failed to reorder task:", error);
      toast.error("Could not reorder task.");
    } finally {
      setMovingTaskId("");
    }
  };

  useEffect(() => {
    let active = true;

    const checkPermissions = async () => {
      if (!user || !id) {
        if (!active) return;
        setCanManageCommitments(false);
        setCheckingPermissions(false);
        return;
      }

      try {
        const canManage = await canManageModule(user, id, "commitments");
        if (!active) return;
        setCanManageCommitments(Boolean(canManage));
      } catch (error) {
        console.error("Error checking commitments permissions:", error);
        if (!active) return;
        setCanManageCommitments(false);
      } finally {
        if (active) {
          setCheckingPermissions(false);
        }
      }
    };

    checkPermissions();

    return () => {
      active = false;
    };
  }, [id, user]);

  useEffect(() => {
    if (!id) {
      setProjects([]);
      setLoadingProjects(false);
      return undefined;
    }

    setLoadingProjects(true);

    const unsubscribe = onSnapshot(
      query(projectsRef, orderBy("createdAt", "desc")),
      (snapshot) => {
        const nextProjects = snapshot.docs.map((projectDoc) => ({
          id: projectDoc.id,
          ...projectDoc.data(),
        }));

        setProjects(nextProjects);
        setLoadingProjects(false);

        if (!draft.projectId && nextProjects.length > 0) {
          setDraft((previous) => ({ ...previous, projectId: nextProjects[0].id }));
        }
        if (!sheetLogDraft.projectId && nextProjects.length > 0) {
          setSheetLogDraft((previous) => ({ ...previous, projectId: nextProjects[0].id }));
        }
      },
      (error) => {
        console.error("Failed to load IglesiaTech projects:", error);
        toast.error("Could not load projects from Project Lists and Issues.");
        setProjects([]);
        setLoadingProjects(false);
      }
    );

    return unsubscribe;
  }, [draft.projectId, id, projectsRef, sheetLogDraft.projectId]);

  useEffect(() => {
    if (!id) {
      setSheetLogs([]);
      setLoadingSheetLogs(false);
      return undefined;
    }

    setLoadingSheetLogs(true);

    const unsubscribe = onSnapshot(
      query(sheetLogsRef, orderBy("createdAt", "desc")),
      (snapshot) => {
        const nextSheetLogs = snapshot.docs.map((sheetLogDoc) => ({
          id: sheetLogDoc.id,
          ...sheetLogDoc.data(),
        }));

        setSheetLogs(nextSheetLogs);
        setLoadingSheetLogs(false);
      },
      (error) => {
        console.error("Failed to load sheet logs:", error);
        toast.error("Could not load Sheet Log entries.");
        setSheetLogs([]);
        setLoadingSheetLogs(false);
      }
    );

    return unsubscribe;
  }, [id, sheetLogsRef]);

  useEffect(() => {
    if (!id) {
      setTasks([]);
      setLoadingTasks(false);
      return undefined;
    }

    setLoadingTasks(true);

    const unsubscribe = onSnapshot(
      query(commitmentsRef, orderBy("createdAt", "desc")),
      (snapshot) => {
        const nextTasks = snapshot.docs.map((taskDoc) => ({
          id: taskDoc.id,
          ...taskDoc.data(),
        }));
        setTasks(nextTasks);
        setLoadingTasks(false);
      },
      (error) => {
        console.error("Failed to load commitments:", error);
        toast.error("Could not load work progress tasks.");
        setTasks([]);
        setLoadingTasks(false);
      }
    );

    return unsubscribe;
  }, [commitmentsRef, id]);

  useEffect(() => {
    let active = true;

    const fetchOrganizationUsers = async () => {
      if (!id) {
        if (!active) return;
        setOrganizationUsers([]);
        setLoadingUsers(false);
        return;
      }

      setLoadingUsers(true);

      try {
        const [byChurchIdResult, byChurchIDResult, byOrganizationIdResult] = await Promise.allSettled([
          getDocs(query(collection(db, "users"), where("churchId", "==", id))),
          getDocs(query(collection(db, "users"), where("churchID", "==", id))),
          getDocs(query(collection(db, "users"), where("organizationId", "==", id))),
        ]);

        if (!active) return;

        const byChurchIdSnapshot = byChurchIdResult.status === "fulfilled" ? byChurchIdResult.value : null;
        const byChurchIDSnapshot = byChurchIDResult.status === "fulfilled" ? byChurchIDResult.value : null;
        const byOrganizationIdSnapshot = byOrganizationIdResult.status === "fulfilled" ? byOrganizationIdResult.value : null;

        if (byChurchIdResult.status === "rejected") {
          console.warn("Could not query users by churchId:", byChurchIdResult.reason);
        }
        if (byChurchIDResult.status === "rejected") {
          console.warn("Could not query users by churchID:", byChurchIDResult.reason);
        }
        if (byOrganizationIdResult.status === "rejected") {
          console.warn("Could not query users by organizationId:", byOrganizationIdResult.reason);
        }

        const allUserDocs = [
          ...(byChurchIdSnapshot?.docs || []),
          ...(byChurchIDSnapshot?.docs || []),
          ...(byOrganizationIdSnapshot?.docs || []),
        ];

        const usersMap = new Map();
        allUserDocs.forEach((userDoc) => {
          if (usersMap.has(userDoc.id)) return;

          const userData = userDoc.data() || {};
          const displayLabel = normalizeValue(
            userData.displayName || userData.name || userData.fullName || userData.email || userDoc.id
          );

          usersMap.set(userDoc.id, {
            id: userDoc.id,
            label: displayLabel,
          });
        });

        setOrganizationUsers(
          Array.from(usersMap.values()).sort((left, right) =>
            normalizeValue(left.label).localeCompare(normalizeValue(right.label), undefined, { sensitivity: "base" })
          )
        );
      } catch (error) {
        console.error("Failed to load organization users:", error);
        if (!active) return;
        setOrganizationUsers([]);
        toast.error("Could not load users for assignments.");
      } finally {
        if (active) {
          setLoadingUsers(false);
        }
      }
    };

    fetchOrganizationUsers();

    return () => {
      active = false;
    };
  }, [id]);

  const handleCreateTask = async (event) => {
    event.preventDefault();

    if (!canManageCommitments) {
      toast.error("You do not have permission to manage this module.");
      return;
    }

    const title = normalizeValue(draft.title);
    const projectId = normalizeValue(draft.projectId);
    const categoryId = normalizeValue(draft.categoryId);
    const parentTaskId = normalizeValue(draft.parentTaskId);
    const sheetLogId = normalizeValue(draft.sheetLogId);

    if (!title) {
      toast.warning("Task title is required.");
      return;
    }

    if (!projectId) {
      toast.warning("Select a project from IglesiaTech.");
      return;
    }

    if (categoryId && !commitmentCategoryById.has(categoryId)) {
      toast.warning("Selected category no longer exists.");
      return;
    }

    const allowedParentTaskIds = new Set((parentTaskOptionsByProjectId.get(projectId) || []).map((option) => option.value));
    if (parentTaskId && !allowedParentTaskIds.has(parentTaskId)) {
      toast.warning("Selected parent task no longer exists.");
      return;
    }

    const selectedSheetLog = sheetLogId ? sheetLogById.get(sheetLogId) : null;
    if (sheetLogId && !selectedSheetLog) {
      toast.warning("Selected Sheet Log row no longer exists.");
      return;
    }
    if (selectedSheetLog && normalizeValue(selectedSheetLog.projectId) !== projectId) {
      toast.warning("Selected Sheet Log row must belong to the same project.");
      return;
    }

    const selectedProject = projects.find((project) => project.id === projectId);
    const projectName = normalizeValue(selectedProject?.name) || "Untitled Project";
    const parentTask = parentTaskId ? tasks.find((task) => task.id === parentTaskId) : null;
    const resolvedCategoryId = categoryId || normalizeValue(parentTask?.categoryId);
    const selectedCategory = resolvedCategoryId ? commitmentCategoryById.get(resolvedCategoryId) : null;
    const categoryName = normalizeValue(selectedCategory?.name);
    const selectedSheetLogIdentifiers = normalizeSheetLogIdentifierArray(
      Array.isArray(selectedSheetLog?.identifiers) && selectedSheetLog.identifiers.length > 0
        ? selectedSheetLog.identifiers
        : selectedSheetLog?.identifier
    );

    setSavingTask(true);

    try {
      await addDoc(commitmentsRef, {
        title,
        description: normalizeValue(draft.description),
        notes: normalizeValue(draft.notes),
        projectId,
        projectName,
        categoryId: resolvedCategoryId,
        categoryName,
        sheetLogId,
        sheetLogSheetName: normalizeValue(selectedSheetLog?.sheetName),
        sheetLogType: normalizeValue(selectedSheetLog?.type),
        sheetLogRevisionNumber: normalizeValue(selectedSheetLog?.revisionNumber),
        sheetLogIdentifiers: selectedSheetLogIdentifiers,
        sheetLogIdentifier: selectedSheetLogIdentifiers[0] || "",
        parentTaskId,
        taskOrder: getNextTaskOrderForParent(parentTaskId, "", projectId),
        dueDate: toDateInputValue(draft.dueDate),
        progressPercent: normalizeProgressPercent(draft.progressPercent),
        priority: normalizeTaskPriority(draft.priority),
        direction: normalizeTaskDirection(draft.direction),
        status: "open",
        changeLog: [buildTaskLogEntry("Task created")],
        createdByUid: user?.uid || "",
        createdByName: normalizeValue(user?.displayName || user?.name || user?.email),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setDraft((previous) => ({
        ...previous,
        title: "",
        description: "",
        categoryId: "",
        parentTaskId: "",
        sheetLogId: "",
        notes: "",
        dueDate: "",
        progressPercent: "0",
        priority: "medium",
        direction: "stop_and_start",
      }));
      setIsQuickTaskOpen(false);

      toast.success("Quick task added to Work Progress.");
    } catch (error) {
      console.error("Failed to create commitment:", error);
      toast.error("Could not save the task.");
    } finally {
      setSavingTask(false);
    }
  };

  const handleDeleteTask = async (taskId) => {
    if (!canManageCommitments) {
      toast.error("You do not have permission to manage this module.");
      return;
    }

    if (!window.confirm("Delete this task?")) {
      return;
    }

    try {
      const childTasks = tasks.filter((task) => normalizeValue(task.parentTaskId) === taskId);
      const batch = writeBatch(db);

      childTasks.forEach((childTask, index) => {
        batch.update(doc(db, "churches", id, "commitments", childTask.id), {
          parentTaskId: "",
          taskOrder: Date.now() + index,
          updatedAt: serverTimestamp(),
        });
      });

      batch.delete(doc(db, "churches", id, "commitments", taskId));
      await batch.commit();

      if (selectedEditTaskId === taskId) {
        setSelectedEditTaskId("");
      }
      if (selectedLogTaskId === taskId) {
        setSelectedLogTaskId("");
      }
      if (childTasks.length > 0) {
        toast.success("Task deleted. Subtasks were moved to top-level.");
        return;
      }
      toast.success("Task deleted.");
    } catch (error) {
      console.error("Failed to delete task:", error);
      toast.error("Could not delete task.");
    }
  };

  const handleDuplicateTask = async (task) => {
    if (!canManageCommitments) {
      toast.error("You do not have permission to manage this module.");
      return;
    }

    const sourceTask = task && typeof task === "object" ? task : null;
    if (!sourceTask) {
      toast.error("Could not duplicate this task.");
      return;
    }

    const sourceParentTaskId = normalizeValue(sourceTask.parentTaskId);
    const sourceProjectId = normalizeValue(sourceTask.projectId);
    const copiedTitle = normalizeValue(sourceTask.title) || "Untitled Task";

    try {
      const nextTaskPayload = {
        title: `${copiedTitle} (Copy)`,
        description: normalizeValue(sourceTask.description),
        notes: normalizeValue(sourceTask.notes),
        projectId: normalizeValue(sourceTask.projectId),
        projectName: normalizeValue(sourceTask.projectName) || "Untitled Project",
        categoryId: normalizeValue(sourceTask.categoryId),
        categoryName: normalizeValue(sourceTask.categoryName),
        sheetLogId: normalizeValue(sourceTask.sheetLogId),
        sheetLogSheetName: normalizeValue(sourceTask.sheetLogSheetName),
        sheetLogType: normalizeValue(sourceTask.sheetLogType),
        sheetLogRevisionNumber: normalizeValue(sourceTask.sheetLogRevisionNumber),
        sheetLogIdentifiers: normalizeSheetLogIdentifierArray(
          Array.isArray(sourceTask.sheetLogIdentifiers) && sourceTask.sheetLogIdentifiers.length > 0
            ? sourceTask.sheetLogIdentifiers
            : sourceTask.sheetLogIdentifier
        ),
        sheetLogIdentifier: normalizeValue(sourceTask.sheetLogIdentifier),
        parentTaskId: sourceParentTaskId,
        taskOrder: getNextTaskOrderForParent(sourceParentTaskId, "", sourceProjectId),
        dueDate: toDateInputValue(sourceTask.dueDate),
        progressPercent: normalizeProgressPercent(sourceTask.progressPercent),
        priority: normalizeTaskPriority(sourceTask.priority),
        direction: normalizeTaskDirection(sourceTask.direction),
        status: normalizeValue(sourceTask.status).toLowerCase() === "done" ? "done" : "open",
        changeLog: [buildTaskLogEntry(`Task duplicated from ${copiedTitle}`)],
        createdByUid: user?.uid || "",
        createdByName: normalizeValue(user?.displayName || user?.name || user?.email),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const docRef = await addDoc(commitmentsRef, nextTaskPayload);

      setTasks((previousTasks) => {
        const nextTask = {
          id: docRef.id,
          ...nextTaskPayload,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        const nextTasks = [...previousTasks, nextTask];
        nextTasks.sort((leftTask, rightTask) => {
          const leftOrder = normalizeTaskOrder(leftTask.taskOrder);
          const rightOrder = normalizeTaskOrder(rightTask.taskOrder);
          if (leftOrder !== rightOrder) return leftOrder - rightOrder;

          const leftCreatedAt = getFirestoreDateMillis(leftTask?.createdAt);
          const rightCreatedAt = getFirestoreDateMillis(rightTask?.createdAt);
          return leftCreatedAt - rightCreatedAt;
        });
        return nextTasks;
      });

      toast.success("Task duplicated.");
    } catch (error) {
      console.error("Failed to duplicate task:", error);
      toast.error("Could not duplicate task.");
    }
  };

  const handleUpdateTaskDueDate = async (task, rawDateValue) => {
    if (!canManageCommitments || !task?.id) return;

    const nextDueDate = toDateInputValue(rawDateValue);
    const currentDueDate = toDateInputValue(task?.dueDate);
    if (nextDueDate === currentDueDate) return;

    const existingLog = normalizeTaskChangeLog(task?.changeLog);
    const nextLog = [
      ...existingLog,
      buildTaskLogEntry(`Due date changed: ${currentDueDate || "none"} -> ${nextDueDate || "none"}`),
    ].slice(-200);

    // Optimistic UI update so countdown reflects the new date immediately.
    setTasks((previousTasks) => previousTasks.map((entry) => (
      entry.id === task.id
        ? { ...entry, dueDate: nextDueDate }
        : entry
    )));

    try {
      await updateDoc(doc(db, "churches", id, "commitments", task.id), {
        dueDate: nextDueDate,
        changeLog: nextLog,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      setTasks((previousTasks) => previousTasks.map((entry) => (
        entry.id === task.id
          ? { ...entry, dueDate: currentDueDate }
          : entry
      )));
      console.error("Failed to update due date:", error);
      toast.error("Could not update due date.");
    }
  };

  const handleUpdateTaskProgress = async (task, rawProgressValue) => {
    if (!canManageCommitments || !task?.id) return;

    const nextProgress = normalizeProgressPercent(rawProgressValue);
    const currentProgress = normalizeProgressPercent(task?.progressPercent);
    if (nextProgress === currentProgress) return;

    const isDone = nextProgress >= 100;
    const existingLog = normalizeTaskChangeLog(task?.changeLog);
    const nextLog = [
      ...existingLog,
      buildTaskLogEntry(`Progress changed: ${currentProgress}% -> ${nextProgress}%`),
    ].slice(-200);

    try {
      await updateDoc(doc(db, "churches", id, "commitments", task.id), {
        progressPercent: nextProgress,
        status: isDone ? "done" : "open",
        changeLog: nextLog,
        completedAt: isDone ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("Failed to update progress:", error);
      toast.error("Could not update progress.");
    }
  };

  const handleUpdateTaskPriority = async (task, rawPriorityValue) => {
    if (!canManageCommitments || !task?.id) return;

    const nextPriority = normalizeTaskPriority(rawPriorityValue);
    const currentPriority = normalizeTaskPriority(task?.priority);
    if (nextPriority === currentPriority) return;

    const existingLog = normalizeTaskChangeLog(task?.changeLog);
    const nextLog = [
      ...existingLog,
      buildTaskLogEntry(`Priority changed: ${currentPriority} -> ${nextPriority}`),
    ].slice(-200);

    try {
      await updateDoc(doc(db, "churches", id, "commitments", task.id), {
        priority: nextPriority,
        changeLog: nextLog,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("Failed to update priority:", error);
      toast.error("Could not update priority.");
    }
  };

  const handleUpdateTaskDirection = async (task, rawDirectionValue) => {
    if (!canManageCommitments || !task?.id) return;

    const nextDirection = normalizeTaskDirection(rawDirectionValue);
    const currentDirection = normalizeTaskDirection(task?.direction);
    if (nextDirection === currentDirection) return;

    const existingLog = normalizeTaskChangeLog(task?.changeLog);
    const currentLabel = TASK_DIRECTION_OPTIONS.find((option) => option.value === currentDirection)?.label || currentDirection;
    const nextLabel = TASK_DIRECTION_OPTIONS.find((option) => option.value === nextDirection)?.label || nextDirection;
    const nextLog = [
      ...existingLog,
      buildTaskLogEntry(`Direction changed: ${currentLabel} -> ${nextLabel}`),
    ].slice(-200);

    try {
      await updateDoc(doc(db, "churches", id, "commitments", task.id), {
        direction: nextDirection,
        changeLog: nextLog,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("Failed to update direction:", error);
      toast.error("Could not update direction.");
    }
  };

  const handleSaveEditedTask = async (event) => {
    event.preventDefault();

    if (!canManageCommitments || !selectedEditTask?.id || !editTaskDraft) {
      return;
    }

    const title = normalizeValue(editTaskDraft.title);
    const projectId = normalizeValue(editTaskDraft.projectId);
    const nextCategoryId = normalizeValue(editTaskDraft.categoryId);
    const nextParentTaskId = normalizeValue(editTaskDraft.parentTaskId);
    const nextSheetLogId = normalizeValue(editTaskDraft.sheetLogId);

    if (!title) {
      toast.warning("Task title is required.");
      return;
    }

    if (!projectId) {
      toast.warning("Select a project from IglesiaTech.");
      return;
    }

    if (nextCategoryId && !commitmentCategoryById.has(nextCategoryId)) {
      toast.warning("Selected category no longer exists.");
      return;
    }

    if (disallowedEditParentTaskIds.has(nextParentTaskId)) {
      toast.warning("A task cannot be assigned to itself or one of its subtasks.");
      return;
    }

    const allowedEditParentTaskIds = new Set((parentTaskOptionsByProjectId.get(projectId) || []).map((option) => option.value));
    if (nextParentTaskId && !allowedEditParentTaskIds.has(nextParentTaskId)) {
      toast.warning("Selected parent task no longer exists.");
      return;
    }

    const nextSelectedSheetLog = nextSheetLogId ? sheetLogById.get(nextSheetLogId) : null;
    if (nextSheetLogId && !nextSelectedSheetLog) {
      toast.warning("Selected Sheet Log row no longer exists.");
      return;
    }
    if (nextSelectedSheetLog && normalizeValue(nextSelectedSheetLog.projectId) !== projectId) {
      toast.warning("Selected Sheet Log row must belong to the same project.");
      return;
    }

    const selectedProject = projects.find((project) => project.id === projectId);
    const projectName = normalizeValue(selectedProject?.name) || "Untitled Project";
    const selectedCategory = nextCategoryId ? commitmentCategoryById.get(nextCategoryId) : null;
    const nextCategoryName = normalizeValue(selectedCategory?.name);
    const nextPriority = normalizeTaskPriority(editTaskDraft.priority);
    const nextDirection = normalizeTaskDirection(editTaskDraft.direction);
    const nextStatus = normalizeValue(editTaskDraft.status).toLowerCase() === "done" ? "done" : "open";
    const nextProgress = nextStatus === "done" ? 100 : normalizeProgressPercent(editTaskDraft.progressPercent);
    const nextDueDate = toDateInputValue(editTaskDraft.dueDate);
    const nextSheetLogIdentifiers = normalizeSheetLogIdentifierArray(
      Array.isArray(nextSelectedSheetLog?.identifiers) && nextSelectedSheetLog.identifiers.length > 0
        ? nextSelectedSheetLog.identifiers
        : nextSelectedSheetLog?.identifier
    );
    const currentParentTaskId = normalizeValue(selectedEditTask.parentTaskId);
    const currentCategoryId = normalizeValue(selectedEditTask.categoryId);
    const hasParentChanged = nextParentTaskId !== currentParentTaskId;
    const hasCategoryChanged = nextCategoryId !== currentCategoryId;
    const nextTaskOrder = hasParentChanged
      ? getNextTaskOrderForParent(nextParentTaskId, selectedEditTask.id, projectId)
      : (normalizeTaskOrder(selectedEditTask.taskOrder) || Date.now());

    const existingLog = normalizeTaskChangeLog(selectedEditTask.changeLog);
    const nextLog = [
      ...existingLog,
      buildTaskLogEntry(
        `Task updated${[
          title !== normalizeValue(selectedEditTask.title) ? `title: ${normalizeValue(selectedEditTask.title) || "Untitled Task"} -> ${title}` : null,
          normalizeValue(editTaskDraft.description) !== normalizeValue(selectedEditTask.description) ? "description" : null,
          projectId !== normalizeValue(selectedEditTask.projectId) ? `project: ${normalizeValue(selectedEditTask.projectName) || "Untitled Project"} -> ${projectName}` : null,
          hasCategoryChanged
            ? `category: ${normalizeValue(selectedEditTask.categoryName) || "none"} -> ${nextCategoryName || "none"}`
            : null,
          normalizeValue(editTaskDraft.notes) !== normalizeValue(selectedEditTask.notes) ? "notes" : null,
          nextPriority !== normalizeTaskPriority(selectedEditTask.priority) ? `priority: ${normalizeTaskPriority(selectedEditTask.priority)} -> ${nextPriority}` : null,
          nextDirection !== normalizeTaskDirection(selectedEditTask.direction) ? `direction: ${normalizeTaskDirection(selectedEditTask.direction)} -> ${nextDirection}` : null,
          hasParentChanged
            ? `parent: ${parentTaskTitleById.get(currentParentTaskId) || "none"} -> ${parentTaskTitleById.get(nextParentTaskId) || "none"}`
            : null,
          nextSheetLogId !== normalizeValue(selectedEditTask.sheetLogId)
            ? `sheet log: ${normalizeValue(selectedEditTask.sheetLogSheetName) || normalizeValue(selectedEditTask.sheetLogId) || "none"} -> ${normalizeValue(nextSelectedSheetLog?.sheetName) || nextSheetLogId || "none"}`
            : null,
          nextDueDate !== toDateInputValue(selectedEditTask.dueDate) ? `due date: ${toDateInputValue(selectedEditTask.dueDate) || "none"} -> ${nextDueDate || "none"}` : null,
          nextStatus !== normalizeValue(selectedEditTask.status).toLowerCase() ? `status: ${normalizeValue(selectedEditTask.status).toLowerCase() || "open"} -> ${nextStatus}` : null,
          nextProgress !== normalizeProgressPercent(selectedEditTask.progressPercent) ? `progress: ${normalizeProgressPercent(selectedEditTask.progressPercent)}% -> ${nextProgress}%` : null,
        ]
          .filter(Boolean)
          .join("; ")}`
      ),
    ].slice(-200);

    setSavingEditTask(true);
    try {
      await updateDoc(doc(db, "churches", id, "commitments", selectedEditTask.id), {
        title,
        description: normalizeValue(editTaskDraft.description),
        notes: normalizeValue(editTaskDraft.notes),
        projectId,
        projectName,
        categoryId: nextCategoryId,
        categoryName: nextCategoryName,
        sheetLogId: nextSheetLogId,
        sheetLogSheetName: normalizeValue(nextSelectedSheetLog?.sheetName),
        sheetLogType: normalizeValue(nextSelectedSheetLog?.type),
        sheetLogRevisionNumber: normalizeValue(nextSelectedSheetLog?.revisionNumber),
        sheetLogIdentifiers: nextSheetLogIdentifiers,
        sheetLogIdentifier: nextSheetLogIdentifiers[0] || "",
        parentTaskId: nextParentTaskId,
        taskOrder: nextTaskOrder,
        dueDate: nextDueDate,
        progressPercent: nextProgress,
        priority: nextPriority,
        direction: nextDirection,
        status: nextStatus,
        completedAt: nextStatus === "done" ? serverTimestamp() : null,
        changeLog: nextLog,
        updatedAt: serverTimestamp(),
      });

      const descendantTaskIds = getDescendantTaskIds(selectedEditTask.id);
      if (descendantTaskIds.length > 0) {
        const descendantBatch = writeBatch(db);
        descendantTaskIds.forEach((descendantTaskId) => {
          descendantBatch.update(doc(db, "churches", id, "commitments", descendantTaskId), {
            categoryId: nextCategoryId,
            categoryName: nextCategoryName,
            updatedAt: serverTimestamp(),
          });
        });
        await descendantBatch.commit();
      }

      setSelectedEditTaskId("");
      toast.success("Task updated.");
    } catch (error) {
      console.error("Failed to update task:", error);
      toast.error("Could not update task.");
    } finally {
      setSavingEditTask(false);
    }
  };

  const handleAddLogNote = async () => {
    if (!selectedLogTask?.id) return;

    if (!canManageCommitments) {
      toast.error("You do not have permission to add notes.");
      return;
    }

    const noteText = normalizeValue(logNoteDraft);
    if (!noteText && !logNoteFileDraft) {
      toast.warning("Type a note or attach a file before saving.");
      return;
    }

    setLogNoteError("");

    let attachment = null;
    try {
      attachment = await uploadLogAttachment({
        file: logNoteFileDraft,
        taskId: selectedLogTask.id,
      });
    } catch (uploadError) {
      const uploadMessage = normalizeValue(uploadError?.message) || "Could not upload attachment. Try again.";
      setLogNoteError(uploadMessage);
      toast.error(uploadMessage);
      return;
    }

    const timelineMessage = noteText
      ? `Note: ${noteText}`
      : "File attachment added";

    const existingLog = normalizeTaskChangeLog(selectedLogTask.changeLog);
    const nextLog = [
      ...existingLog,
      buildTaskLogEntry(timelineMessage, attachment),
    ].slice(-200);

    setSavingLogNote(true);
    try {
      await updateDoc(doc(db, "churches", id, "commitments", selectedLogTask.id), {
        changeLog: nextLog,
        updatedAt: serverTimestamp(),
      });
      setLogNoteDraft("");
      setLogNoteFileDraft(null);
      setLogNoteError("");
      toast.success("Log note added.");
    } catch (error) {
      console.error("Failed to add log note:", error);
      toast.error("Could not add log note.");
    } finally {
      setSavingLogNote(false);
    }
  };

  const getTaskNoteEntries = (task) =>
    normalizeTaskChangeLog(task?.changeLog).filter((entry) => isTaskNoteLogEntry(entry));

  const getLatestTaskNote = (task) => {
    const noteEntries = getTaskNoteEntries(task);
    if (noteEntries.length === 0) return null;

    return noteEntries.reduce((latestEntry, currentEntry) => {
      if (!latestEntry) return currentEntry;
      return toMillis(currentEntry.changedAtIso) > toMillis(latestEntry.changedAtIso)
        ? currentEntry
        : latestEntry;
    }, null);
  };

  const getTaskUnreadNoteCount = (task) => {
    const currentUserId = normalizeValue(user?.uid);
    if (!currentUserId) return 0;

    const taskReadsByUser = task?.logReadsByUser && typeof task.logReadsByUser === "object"
      ? task.logReadsByUser
      : {};
    const lastReadAt = normalizeValue(taskReadsByUser[currentUserId]);
    const lastReadAtMillis = toMillis(lastReadAt);

    return getTaskNoteEntries(task).filter((entry) => toMillis(entry.changedAtIso) > lastReadAtMillis).length;
  };

  const handleOpenTaskLog = async (task) => {
    setSelectedLogTaskId(task.id);

    const currentUserId = normalizeValue(user?.uid);
    if (!currentUserId || !task?.id) return;

    const alreadyReadAt = normalizeValue(task?.logReadsByUser?.[currentUserId]);
    const latestTaskNote = getLatestTaskNote(task);
    const latestNoteMillis = toMillis(latestTaskNote?.changedAtIso);

    if (latestNoteMillis === 0 || toMillis(alreadyReadAt) >= latestNoteMillis) {
      return;
    }

    try {
      await updateDoc(doc(db, "churches", id, "commitments", task.id), {
        [`logReadsByUser.${currentUserId}`]: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.warn("Could not update note read status:", error);
    }
  };

  const getAssignedUserNames = (task) => {
    const storedNames = normalizeStringArray(task?.assignedUserNames);
    if (storedNames.length > 0) return storedNames;

    const assignedIds = normalizeStringArray(task?.assignedUserIds);
    if (assignedIds.length === 0) return [];

    const namesById = new Map(organizationUsers.map((entry) => [entry.id, entry.label]));
    return assignedIds.map((userId) => namesById.get(userId) || userId);
  };

  const handleUpdateTaskAssignedUsers = async (task, nextAssignedIdsRaw) => {
    if (!canManageCommitments || !task?.id) return;

    const nextAssignedIds = normalizeStringArray(nextAssignedIdsRaw);
    const currentAssignedIds = normalizeStringArray(task?.assignedUserIds);

    if (JSON.stringify(nextAssignedIds) === JSON.stringify(currentAssignedIds)) {
      return;
    }

    const userNameMap = new Map(organizationUsers.map((entry) => [entry.id, entry.label]));
    const nextAssignedNames = nextAssignedIds.map((userId) => userNameMap.get(userId) || userId);
    const currentAssignedNames = getAssignedUserNames(task);

    const existingLog = normalizeTaskChangeLog(task?.changeLog);
    const nextLog = [
      ...existingLog,
      buildTaskLogEntry(
        `Assigned users changed: ${currentAssignedNames.join(", ") || "none"} -> ${nextAssignedNames.join(", ") || "none"}`
      ),
    ].slice(-200);

    try {
      await updateDoc(doc(db, "churches", id, "commitments", task.id), {
        assignedUserIds: nextAssignedIds,
        assignedUserNames: nextAssignedNames,
        changeLog: nextLog,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("Failed to update task assignees:", error);
      toast.error("Could not update assigned users.");
    }
  };

  const handleToggleTaskAssignedUser = (task, userId) => {
    const currentAssignedIds = normalizeStringArray(task?.assignedUserIds);
    const nextAssignedIds = currentAssignedIds.includes(userId)
      ? currentAssignedIds.filter((entryId) => entryId !== userId)
      : [...currentAssignedIds, userId];

    handleUpdateTaskAssignedUsers(task, nextAssignedIds);
  };

  const handleCreateCommitmentCategory = async (event) => {
    if (event?.preventDefault) event.preventDefault();

    if (!canManageCommitments) {
      toast.error("You do not have permission to manage this module.");
      return;
    }

    const name = normalizeValue(commitmentCategoryDraft.name);
    const description = normalizeValue(commitmentCategoryDraft.description);

    if (!name) {
      toast.warning("Enter a category name.");
      return;
    }

    if (commitmentCategories.some((entry) => normalizeValue(entry.name).toLowerCase() === name.toLowerCase())) {
      toast.warning("That category already exists.");
      return;
    }

    setSavingCommitmentCategory(true);
    try {
      await addDoc(commitmentCategoriesRef, {
        name,
        description,
        createdByUid: user?.uid || "",
        createdByName: normalizeValue(user?.displayName || user?.name || user?.email),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setCommitmentCategoryDraft({ name: "", description: "" });
      toast.success("Commitment category created.");
    } catch (error) {
      console.error("Failed to create commitment category:", error);
      toast.error("Could not create category.");
    } finally {
      setSavingCommitmentCategory(false);
    }
  };

  const handleSaveEditedCommitmentCategory = async (event) => {
    if (event?.preventDefault) event.preventDefault();

    if (!canManageCommitments || !editingCommitmentCategoryId || !editingCommitmentCategoryDraft) {
      return;
    }

    const name = normalizeValue(editingCommitmentCategoryDraft.name);
    const description = normalizeValue(editingCommitmentCategoryDraft.description);

    if (!name) {
      toast.warning("Enter a category name.");
      return;
    }

    const duplicateCategory = commitmentCategories.find(
      (entry) => entry.id !== editingCommitmentCategoryId && normalizeValue(entry.name).toLowerCase() === name.toLowerCase()
    );
    if (duplicateCategory) {
      toast.warning("That category already exists.");
      return;
    }

    setSavingCommitmentCategory(true);
    try {
      await updateDoc(doc(db, "churches", id, "workProgressCommitmentCategories", editingCommitmentCategoryId), {
        name,
        description,
        updatedAt: serverTimestamp(),
      });

      setEditingCommitmentCategoryId("");
      toast.success("Commitment category updated.");
    } catch (error) {
      console.error("Failed to update commitment category:", error);
      toast.error("Could not update category.");
    } finally {
      setSavingCommitmentCategory(false);
    }
  };

  const handleDeleteCommitmentCategory = async (categoryId) => {
    if (!canManageCommitments) {
      toast.error("You do not have permission to manage this module.");
      return;
    }

    if (!categoryId) return;

    const category = commitmentCategoryById.get(categoryId);
    const categoryTaskCount = tasks.filter((task) => normalizeValue(task.categoryId) === categoryId).length;
    const confirmationMessage = categoryTaskCount > 0
      ? `Delete ${normalizeValue(category?.name) || "this category"}? ${categoryTaskCount} task${categoryTaskCount === 1 ? " is" : "s are"} assigned and will become Uncategorized.`
      : `Delete ${normalizeValue(category?.name) || "this category"}?`;

    if (!window.confirm(confirmationMessage)) {
      return;
    }

    setSavingCommitmentCategory(true);
    try {
      const batch = writeBatch(db);

      tasks
        .filter((task) => normalizeValue(task.categoryId) === categoryId)
        .forEach((task) => {
          batch.update(doc(db, "churches", id, "commitments", task.id), {
            categoryId: "",
            categoryName: "",
            updatedAt: serverTimestamp(),
          });
        });

      batch.delete(doc(db, "churches", id, "workProgressCommitmentCategories", categoryId));
      await batch.commit();

      if (editingCommitmentCategoryId === categoryId) {
        setEditingCommitmentCategoryId("");
      }

      toast.success("Commitment category deleted.");
    } catch (error) {
      console.error("Failed to delete commitment category:", error);
      toast.error("Could not delete category.");
    } finally {
      setSavingCommitmentCategory(false);
    }
  };

  const handleCreateSheetLog = async (event) => {
    event.preventDefault();

    if (!canManageCommitments) {
      toast.error("You do not have permission to manage this module.");
      return;
    }

    const projectId = normalizeValue(sheetLogDraft.projectId);
    const sheetName = normalizeValue(sheetLogDraft.sheetName);
    const identifiers = normalizeSheetLogIdentifierArray(sheetLogDraft.identifier);
    const identifier = identifiers[0] || "";
    const sheetType = normalizeValue(sheetLogDraft.type);

    if (!projectId) {
      toast.warning("Select an IglesiaTech project.");
      return;
    }

    if (!sheetType) {
      toast.warning("Sheet type is required.");
      return;
    }

    if (!sheetName) {
      toast.warning("Sheet name is required.");
      return;
    }

    const selectedProject = projects.find((project) => project.id === projectId);
    const projectName = normalizeValue(selectedProject?.name) || "Untitled Project";

    setSavingSheetLog(true);
    try {
      await addDoc(sheetLogsRef, {
        projectId,
        projectName,
        shouldCreateSheet: normalizeValue(sheetLogDraft.shouldCreateSheet).toLowerCase() !== "no",
        sheetName,
        identifiers,
        identifier,
        type: sheetType,
        revisionNumber: normalizeValue(sheetLogDraft.revisionNumber),
        createdByUid: user?.uid || "",
        createdByName: normalizeValue(user?.displayName || user?.name || user?.email),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setSheetLogDraft((previous) => ({
        ...previous,
        shouldCreateSheet: "yes",
        sheetName: "",
        identifier: "",
        type: sheetLogTypeOptions[0] || "",
        revisionNumber: "",
      }));

      toast.success("Sheet Log entry created.");
    } catch (error) {
      console.error("Failed to create sheet log:", error);
      toast.error("Could not create Sheet Log entry.");
    } finally {
      setSavingSheetLog(false);
    }
  };

  const handleSaveSheetLogEdit = async () => {
    if (!canManageCommitments || !editingSheetLogId || !editingSheetLogDraft) {
      return;
    }

    const projectId = normalizeValue(editingSheetLogDraft.projectId);
    const sheetName = normalizeValue(editingSheetLogDraft.sheetName);
    const identifiers = normalizeSheetLogIdentifierArray(
      editingSheetLogIdentifiers.length > 0 ? editingSheetLogIdentifiers : editingSheetLogDraft.identifier
    );
    const identifier = identifiers[0] || "";
    const sheetType = normalizeValue(editingSheetLogDraft.type);

    if (!projectId) {
      toast.warning("Select an IglesiaTech project.");
      return;
    }

    if (!sheetType) {
      toast.warning("Sheet type is required.");
      return;
    }

    if (!sheetName) {
      toast.warning("Sheet name is required.");
      return;
    }

    const selectedProject = projects.find((project) => project.id === projectId);
    const projectName = normalizeValue(selectedProject?.name) || "Untitled Project";

    setSavingSheetLogEdit(true);
    try {
      await updateDoc(doc(db, "churches", id, "workProgressSheetLogs", editingSheetLogId), {
        projectId,
        projectName,
        shouldCreateSheet: normalizeValue(editingSheetLogDraft.shouldCreateSheet).toLowerCase() !== "no",
        sheetName,
        identifiers,
        identifier,
        type: sheetType,
        revisionNumber: normalizeValue(editingSheetLogDraft.revisionNumber),
        updatedAt: serverTimestamp(),
      });

      setEditingSheetLogId("");
      setEditingSheetLogIdentifiers([]);
      toast.success("Sheet Log entry updated.");
    } catch (error) {
      console.error("Failed to update sheet log:", error);
      toast.error("Could not update Sheet Log entry.");
    } finally {
      setSavingSheetLogEdit(false);
    }
  };

  const handleUpdateEditingSheetLogIdentifierAt = (index, value) => {
    setEditingSheetLogIdentifiers((previous) => {
      const currentIdentifiers = previous.length > 0 ? [...previous] : [""];
      currentIdentifiers[index] = value;
      setEditingSheetLogDraft((draftPrevious) => (
        draftPrevious
          ? { ...draftPrevious, identifier: currentIdentifiers.join("\n") }
          : draftPrevious
      ));
      return currentIdentifiers;
    });
  };

  const handleAddEditingSheetLogIdentifier = () => {
    setEditingSheetLogIdentifiers((previous) => {
      const nextIdentifiers = [...previous, ""];
      setEditingSheetLogDraft((draftPrevious) => (
        draftPrevious
          ? { ...draftPrevious, identifier: nextIdentifiers.join("\n") }
          : draftPrevious
      ));
      return nextIdentifiers;
    });
  };

  const handleRemoveEditingSheetLogIdentifierAt = (index) => {
    setEditingSheetLogIdentifiers((previous) => {
      const nextIdentifiers = previous.filter((_, currentIndex) => currentIndex !== index);
      const normalizedNextIdentifiers = nextIdentifiers.length > 0 ? nextIdentifiers : [""];
      setEditingSheetLogDraft((draftPrevious) => (
        draftPrevious
          ? { ...draftPrevious, identifier: normalizedNextIdentifiers.join("\n") }
          : draftPrevious
      ));
      return normalizedNextIdentifiers;
    });
  };

  const handleCreateSheetLogType = async (event) => {
    if (event?.preventDefault) event.preventDefault();

    if (!canManageCommitments) {
      toast.error("You do not have permission to manage this module.");
      return;
    }

    const nextName = normalizeValue(sheetLogTypeDraft.name);
    const nextDescription = normalizeValue(sheetLogTypeDraft.description);
    if (!nextName) {
      toast.warning("Enter a type name.");
      return;
    }

    if (sheetLogTypes.some((entry) => normalizeValue(entry.name).toLowerCase() === nextName.toLowerCase())) {
      toast.warning("That sheet type already exists.");
      return;
    }

    const nextTypes = [...sheetLogTypes, {
      id: createSheetLogTypeId(nextName),
      name: nextName,
      description: nextDescription,
    }];

    setSavingSheetLogType(true);

    try {
      await setDoc(sheetLogSettingsRef, {
        types: nextTypes,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setSheetLogTypeDraft({ name: "", description: "" });
      toast.success("Sheet Log type added.");
    } catch (error) {
      console.error("Failed to save Sheet Log type:", error);
      toast.error("Could not save Sheet Log type.");
    } finally {
      setSavingSheetLogType(false);
    }
  };

  const handleSaveSheetLogTypeEdit = async () => {
    if (!canManageCommitments) {
      toast.error("You do not have permission to manage this module.");
      return;
    }

    if (!editingSheetLogTypeId) return;

    const nextName = normalizeValue(editingSheetLogTypeDraft.name);
    const nextDescription = normalizeValue(editingSheetLogTypeDraft.description);
    if (!nextName) {
      toast.warning("Enter a type name.");
      return;
    }

    if (sheetLogTypes.some((entry) => entry.id !== editingSheetLogTypeId && normalizeValue(entry.name).toLowerCase() === nextName.toLowerCase())) {
      toast.warning("That sheet type already exists.");
      return;
    }

    const previousType = sheetLogTypes.find((entry) => entry.id === editingSheetLogTypeId);
    const previousName = normalizeValue(previousType?.name);
    const nextTypes = sheetLogTypes.map((entry) =>
      entry.id === editingSheetLogTypeId
        ? { ...entry, name: nextName, description: nextDescription }
        : entry
    );

    setSavingSheetLogType(true);

    try {
      await setDoc(sheetLogSettingsRef, {
        types: nextTypes,
        updatedAt: serverTimestamp(),
      }, { merge: true });

      if (previousName && previousName !== nextName) {
        const matchingLogs = sheetLogs.filter((entry) => normalizeValue(entry.type) === previousName);
        await Promise.all(matchingLogs.map((entry) => updateDoc(doc(db, "churches", id, "workProgressSheetLogs", entry.id), {
          type: nextName,
          updatedAt: serverTimestamp(),
        })));
      }

      setEditingSheetLogTypeId("");
      toast.success("Sheet Log type updated.");
    } catch (error) {
      console.error("Failed to update Sheet Log type:", error);
      toast.error("Could not update Sheet Log type.");
    } finally {
      setSavingSheetLogType(false);
    }
  };

  const handleDeleteSheetLogType = async (typeId) => {
    if (!canManageCommitments) {
      toast.error("You do not have permission to manage this module.");
      return;
    }

    const sheetType = sheetLogTypes.find((entry) => entry.id === typeId);
    const typeName = normalizeValue(sheetType?.name);
    if (!typeName) return;

    const affectedEntries = sheetLogs.filter((entry) => normalizeValue(entry.type) === typeName).length;
    const confirmationMessage = affectedEntries > 0
      ? `Delete this Sheet Log type? ${affectedEntries} Sheet Log entr${affectedEntries === 1 ? "y uses" : "ies use"} it and will be cleared.`
      : "Delete this Sheet Log type?";

    if (!window.confirm(confirmationMessage)) {
      return;
    }

    const nextTypes = sheetLogTypes.filter((entry) => entry.id !== typeId);
    setSavingSheetLogType(true);

    try {
      await setDoc(sheetLogSettingsRef, {
        types: nextTypes,
        updatedAt: serverTimestamp(),
      }, { merge: true });

      const matchingLogs = sheetLogs.filter((entry) => normalizeValue(entry.type) === typeName);
      await Promise.all(matchingLogs.map((entry) => updateDoc(doc(db, "churches", id, "workProgressSheetLogs", entry.id), {
        type: "",
        updatedAt: serverTimestamp(),
      })));

      if (editingSheetLogTypeId === typeId) {
        setEditingSheetLogTypeId("");
      }
      toast.success("Sheet Log type deleted.");
    } catch (error) {
      console.error("Failed to delete Sheet Log type:", error);
      toast.error("Could not delete Sheet Log type.");
    } finally {
      setSavingSheetLogType(false);
    }
  };

  const handleDeleteSheetLog = async (sheetLogId) => {
    if (!canManageCommitments) {
      toast.error("You do not have permission to manage this module.");
      return;
    }

    if (!window.confirm("Delete this Sheet Log entry?")) {
      return;
    }

    try {
      await deleteDoc(doc(db, "churches", id, "workProgressSheetLogs", sheetLogId));
      if (editingSheetLogId === sheetLogId) {
        setEditingSheetLogId("");
      }
      toast.success("Sheet Log entry deleted.");
    } catch (error) {
      console.error("Failed to delete sheet log:", error);
      toast.error("Could not delete Sheet Log entry.");
    }
  };

  const handleDuplicateSheetLog = async (entry) => {
    if (!canManageCommitments) {
      toast.error("You do not have permission to manage this module.");
      return;
    }

    const sourceEntry = entry && typeof entry === "object" ? entry : null;
    if (!sourceEntry) {
      toast.error("Could not duplicate this Sheet Log entry.");
      return;
    }

    const copiedSheetName = normalizeValue(sourceEntry.sheetName);
    const copiedIdentifiers = normalizeSheetLogIdentifierArray(
      Array.isArray(sourceEntry.identifiers) && sourceEntry.identifiers.length > 0
        ? sourceEntry.identifiers
        : sourceEntry.identifier
    );

    try {
      await addDoc(sheetLogsRef, {
        projectId: normalizeValue(sourceEntry.projectId),
        projectName: normalizeValue(sourceEntry.projectName) || "Untitled Project",
        shouldCreateSheet: Boolean(sourceEntry.shouldCreateSheet),
        sheetName: copiedSheetName ? `${copiedSheetName} (Copy)` : "Copy",
        identifiers: copiedIdentifiers,
        identifier: copiedIdentifiers[0] || "",
        type: normalizeValue(sourceEntry.type),
        revisionNumber: normalizeValue(sourceEntry.revisionNumber),
        createdByUid: user?.uid || "",
        createdByName: normalizeValue(user?.displayName || user?.name || user?.email),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      toast.success("Sheet Log entry duplicated.");
    } catch (error) {
      console.error("Failed to duplicate sheet log:", error);
      toast.error("Could not duplicate Sheet Log entry.");
    }
  };

  const formatCreatedAt = (value) => {
    const dateValue = value?.toDate?.() || (value ? new Date(value) : null);
    if (!dateValue || Number.isNaN(dateValue.getTime())) return "-";

    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(dateValue);
  };

  return (
    <div style={{ width: "100%", padding: "1rem" }}>
      <style>
        {`@keyframes workProgressUnreadBlink {
          0% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.35; transform: scale(1.06); }
          100% { opacity: 1; transform: scale(1); }
        }`}
      </style>

      <ChurchHeader id={id} />

      <div style={{ width: "100%", maxWidth: "100%", margin: "0 auto" }}>
        <Link to={`${routePrefix}/${id}/mi-organizacion`} style={{ ...commonStyles.backButtonLink, display: "inline-block", marginBottom: "14px" }}>
          Back
        </Link>

        <h1 style={{ ...commonStyles.title, textAlign: "left", marginBottom: "8px" }}>Work Progress</h1>

        <div style={{ ...cardStyle, marginBottom: "16px", padding: "10px" }}>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setActiveSectionTab("commitments")}
              style={{
                ...buttonStyle,
                background: activeSectionTab === "commitments" ? "#1D4ED8" : "#E2E8F0",
                color: activeSectionTab === "commitments" ? "#FFFFFF" : "#0F172A",
              }}
            >
              Commitments
            </button>
            <button
              type="button"
              onClick={() => setActiveSectionTab("commitment_categories")}
              style={{
                ...buttonStyle,
                background: activeSectionTab === "commitment_categories" ? "#1D4ED8" : "#E2E8F0",
                color: activeSectionTab === "commitment_categories" ? "#FFFFFF" : "#0F172A",
              }}
            >
              Commitment Categories
            </button>
            <button
              type="button"
              onClick={() => setActiveSectionTab("sheet_log")}
              style={{
                ...buttonStyle,
                background: activeSectionTab === "sheet_log" ? "#1D4ED8" : "#E2E8F0",
                color: activeSectionTab === "sheet_log" ? "#FFFFFF" : "#0F172A",
              }}
            >
              Sheet Log
            </button>
            <button
              type="button"
              onClick={() => setActiveSectionTab("sheet_log_types")}
              style={{
                ...buttonStyle,
                background: activeSectionTab === "sheet_log_types" ? "#1D4ED8" : "#E2E8F0",
                color: activeSectionTab === "sheet_log_types" ? "#FFFFFF" : "#0F172A",
              }}
            >
              Sheet Types
            </button>
          </div>
        </div>

        {activeSectionTab === "commitment_categories" ? (
          <>
            <div style={{ ...cardStyle, marginBottom: "16px" }}>
              <div style={{ color: "#0F172A", fontWeight: 800, marginBottom: "10px" }}>New Commitment Category</div>
              <form onSubmit={handleCreateCommitmentCategory} style={{ display: "grid", gap: "10px" }}>
                <div>
                  <label style={{ display: "block", textAlign: "left", color: "#475569", fontSize: "0.78rem", marginBottom: "4px", fontWeight: 700 }}>
                    Category Name
                  </label>
                  <input
                    type="text"
                    style={inputStyle}
                    value={commitmentCategoryDraft.name}
                    onChange={(event) => setCommitmentCategoryDraft((previous) => ({ ...previous, name: event.target.value }))}
                    placeholder="Category name"
                    disabled={!canManageCommitments || savingCommitmentCategory}
                  />
                </div>
                <div>
                  <label style={{ display: "block", textAlign: "left", color: "#475569", fontSize: "0.78rem", marginBottom: "4px", fontWeight: 700 }}>
                    Description
                  </label>
                  <textarea
                    style={{ ...inputStyle, minHeight: "92px", resize: "vertical" }}
                    value={commitmentCategoryDraft.description}
                    onChange={(event) => setCommitmentCategoryDraft((previous) => ({ ...previous, description: event.target.value }))}
                    placeholder="Optional description shown under the category header"
                    disabled={!canManageCommitments || savingCommitmentCategory}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <small style={{ color: "#64748B" }}>
                    Categories become the section headers above grouped commitments.
                  </small>
                  <button
                    type="submit"
                    style={{ ...buttonStyle, background: canManageCommitments ? "#1D4ED8" : "#94A3B8" }}
                    disabled={!canManageCommitments || savingCommitmentCategory}
                  >
                    {savingCommitmentCategory ? "Saving..." : "Create Category"}
                  </button>
                </div>
              </form>
            </div>

            {editingCommitmentCategoryId ? (
              <div style={{ ...cardStyle, marginBottom: "16px" }}>
                <div style={{ color: "#0F172A", fontWeight: 800, marginBottom: "10px" }}>Edit Commitment Category</div>
                <form onSubmit={handleSaveEditedCommitmentCategory} style={{ display: "grid", gap: "10px" }}>
                  <div>
                    <label style={{ display: "block", textAlign: "left", color: "#475569", fontSize: "0.78rem", marginBottom: "4px", fontWeight: 700 }}>
                      Category Name
                    </label>
                    <input
                      type="text"
                      style={inputStyle}
                      value={editingCommitmentCategoryDraft.name}
                      onChange={(event) => setEditingCommitmentCategoryDraft((previous) => ({ ...previous, name: event.target.value }))}
                      placeholder="Category name"
                      disabled={!canManageCommitments || savingCommitmentCategory}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", textAlign: "left", color: "#475569", fontSize: "0.78rem", marginBottom: "4px", fontWeight: 700 }}>
                      Description
                    </label>
                    <textarea
                      style={{ ...inputStyle, minHeight: "92px", resize: "vertical" }}
                      value={editingCommitmentCategoryDraft.description}
                      onChange={(event) => setEditingCommitmentCategoryDraft((previous) => ({ ...previous, description: event.target.value }))}
                      placeholder="Optional description shown under the category header"
                      disabled={!canManageCommitments || savingCommitmentCategory}
                    />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                    <small style={{ color: "#64748B" }}>
                      Update the header name or description for this category.
                    </small>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      <button
                        type="submit"
                        style={{ ...buttonStyle, background: canManageCommitments ? "#2563EB" : "#94A3B8" }}
                        disabled={!canManageCommitments || savingCommitmentCategory}
                      >
                        {savingCommitmentCategory ? "Saving..." : "Save Category"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingCommitmentCategoryId("")}
                        style={{ ...buttonStyle, background: "#64748B" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            ) : null}

            <div style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px", flexWrap: "wrap", gap: "10px" }}>
                <strong style={{ color: "#0F172A" }}>Commitment Category Catalog</strong>
                <small style={{ color: "#475569" }}>{commitmentCategories.length} categor{commitmentCategories.length === 1 ? "y" : "ies"}</small>
              </div>

              {loadingCommitmentCategories ? (
                <div style={{ textAlign: "left", color: "#64748B" }}>Loading commitment categories...</div>
              ) : commitmentCategories.length === 0 ? (
                <div style={{ textAlign: "left", color: "#64748B" }}>No categories yet. Create the first one above.</div>
              ) : (
                <div style={{ width: "100%", border: "1px solid #E2E8F0", borderRadius: "10px" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                    <thead>
                      <tr style={{ background: "#F8FAFC" }}>
                        <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Category</th>
                        <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Description</th>
                        <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {commitmentCategories.map((categoryEntry) => (
                        <tr key={categoryEntry.id}>
                          <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155", fontWeight: 700 }}>
                            {normalizeValue(categoryEntry.name) || "-"}
                          </td>
                          <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155", whiteSpace: "pre-wrap" }}>
                            {normalizeValue(categoryEntry.description) || "-"}
                          </td>
                          <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9" }}>
                            {canManageCommitments ? (
                              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                <button
                                  type="button"
                                  onClick={() => setEditingCommitmentCategoryId(categoryEntry.id)}
                                  style={{ ...buttonStyle, background: "#0F766E", padding: "6px 10px", fontSize: "0.8rem" }}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteCommitmentCategory(categoryEntry.id)}
                                  style={{ ...buttonStyle, background: "#DC2626", padding: "6px 10px", fontSize: "0.8rem" }}
                                  disabled={savingCommitmentCategory}
                                >
                                  Delete
                                </button>
                              </div>
                            ) : (
                              <span style={{ color: "#94A3B8", fontSize: "0.78rem", fontWeight: 700 }}>Read-only</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        ) : activeSectionTab === "sheet_log_types" ? (
          <>
            <div style={{ ...cardStyle, marginBottom: "16px" }}>
              <div style={{ color: "#0F172A", fontWeight: 800, marginBottom: "10px" }}>New Sheet Type</div>
              <form onSubmit={handleCreateSheetLogType} style={{ display: "grid", gap: "10px" }}>
                <div>
                  <label style={{ display: "block", textAlign: "left", color: "#475569", fontSize: "0.78rem", marginBottom: "4px", fontWeight: 700 }}>
                    Type Name
                  </label>
                  <input
                    type="text"
                    style={inputStyle}
                    value={sheetLogTypeDraft.name}
                    onChange={(event) => setSheetLogTypeDraft((previous) => ({ ...previous, name: event.target.value }))}
                    placeholder="Type name"
                    disabled={!canManageCommitments || savingSheetLogType}
                  />
                </div>
                <div>
                  <label style={{ display: "block", textAlign: "left", color: "#475569", fontSize: "0.78rem", marginBottom: "4px", fontWeight: 700 }}>
                    Description
                  </label>
                  <textarea
                    style={{ ...inputStyle, minHeight: "96px", resize: "vertical" }}
                    value={sheetLogTypeDraft.description}
                    onChange={(event) => setSheetLogTypeDraft((previous) => ({ ...previous, description: event.target.value }))}
                    placeholder="Describe when this sheet type should be used"
                    disabled={!canManageCommitments || savingSheetLogType}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <small style={{ color: "#64748B" }}>
                    Manage the master list of Sheet Log types and their descriptions here.
                  </small>
                  <button
                    type="submit"
                    style={{ ...buttonStyle, background: canManageCommitments ? "#1D4ED8" : "#94A3B8" }}
                    disabled={!canManageCommitments || savingSheetLogType}
                  >
                    {savingSheetLogType ? "Saving..." : "Create Type"}
                  </button>
                </div>
              </form>
            </div>

            <div style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px", flexWrap: "wrap", gap: "10px" }}>
                <strong style={{ color: "#0F172A" }}>Sheet Type Catalog</strong>
                <small style={{ color: "#475569" }}>{sheetLogTypes.length} type{sheetLogTypes.length === 1 ? "" : "s"}</small>
              </div>

              {loadingSheetLogTypes ? (
                <div style={{ textAlign: "left", color: "#64748B" }}>Loading Sheet Log types...</div>
              ) : sheetLogTypes.length === 0 ? (
                <div style={{ textAlign: "left", color: "#64748B" }}>No Sheet Log types yet. Create the first one above.</div>
              ) : (
                <div style={{ width: "100%", border: "1px solid #E2E8F0", borderRadius: "10px" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                    <thead>
                      <tr style={{ background: "#F8FAFC" }}>
                        <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Type</th>
                        <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Description</th>
                        <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sheetLogTypes.map((typeEntry) => (
                        <tr key={typeEntry.id}>
                          <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155", fontWeight: 700 }}>
                            {normalizeValue(typeEntry.name) || "-"}
                          </td>
                          <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155", whiteSpace: "pre-wrap" }}>
                            {normalizeValue(typeEntry.description) || "-"}
                          </td>
                          <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9" }}>
                            {canManageCommitments ? (
                              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                <button
                                  type="button"
                                  onClick={() => setEditingSheetLogTypeId(typeEntry.id)}
                                  style={{ ...buttonStyle, background: "#0F766E", padding: "6px 10px", fontSize: "0.8rem" }}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteSheetLogType(typeEntry.id)}
                                  style={{ ...buttonStyle, background: "#DC2626", padding: "6px 10px", fontSize: "0.8rem" }}
                                  disabled={savingSheetLogType}
                                >
                                  Delete
                                </button>
                              </div>
                            ) : (
                              <span style={{ color: "#94A3B8", fontSize: "0.78rem", fontWeight: 700 }}>Read-only</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        ) : activeSectionTab === "sheet_log" ? (
          <>
            <div style={{ ...cardStyle, marginBottom: "16px" }}>
              <div style={{ color: "#0F172A", fontWeight: 800, marginBottom: "10px" }}>Create Sheet Log Entry</div>
              <form onSubmit={handleCreateSheetLog} style={{ display: "grid", gap: "10px" }}>
                <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
                  <div>
                    <label style={{ display: "block", textAlign: "left", color: "#475569", fontSize: "0.78rem", marginBottom: "4px", fontWeight: 700 }}>
                      Project
                    </label>
                    <select
                      style={inputStyle}
                      value={sheetLogDraft.projectId}
                      onChange={(event) => setSheetLogDraft((previous) => ({ ...previous, projectId: event.target.value }))}
                      disabled={loadingProjects || projects.length === 0 || !canManageCommitments || savingSheetLog}
                    >
                      <option value="">Select project</option>
                      {projects.map((project) => (
                        <option key={`sheet-log-project-${project.id}`} value={project.id}>
                          {normalizeValue(project.name) || "Untitled Project"}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: "block", textAlign: "left", color: "#475569", fontSize: "0.78rem", marginBottom: "4px", fontWeight: 700 }}>
                      Create Sheet
                    </label>
                    <select
                      style={inputStyle}
                      value={sheetLogDraft.shouldCreateSheet}
                      onChange={(event) => setSheetLogDraft((previous) => ({ ...previous, shouldCreateSheet: event.target.value }))}
                      disabled={!canManageCommitments || savingSheetLog}
                    >
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: "block", textAlign: "left", color: "#475569", fontSize: "0.78rem", marginBottom: "4px", fontWeight: 700 }}>
                      Sheet Name
                    </label>
                    <input
                      type="text"
                      style={inputStyle}
                      value={sheetLogDraft.sheetName}
                      onChange={(event) => setSheetLogDraft((previous) => ({ ...previous, sheetName: event.target.value }))}
                      placeholder="Sheet name"
                      disabled={!canManageCommitments || savingSheetLog}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", textAlign: "left", color: "#475569", fontSize: "0.78rem", marginBottom: "4px", fontWeight: 700 }}>
                      Identifiers
                    </label>
                    <input
                      type="text"
                      style={inputStyle}
                      value={sheetLogDraft.identifier}
                      onChange={(event) => setSheetLogDraft((previous) => ({ ...previous, identifier: event.target.value }))}
                      placeholder="Identifier 1, Identifier 2"
                      disabled={!canManageCommitments || savingSheetLog}
                    />
                    <div style={{ color: "#64748B", fontSize: "0.74rem", marginTop: "4px" }}>
                      Use commas, semicolons, or new lines to add multiple identifiers.
                    </div>
                  </div>

                  <div>
                    <label style={{ display: "block", textAlign: "left", color: "#475569", fontSize: "0.78rem", marginBottom: "4px", fontWeight: 700 }}>
                      Type
                    </label>
                    <select
                      style={inputStyle}
                      value={sheetLogDraft.type}
                      onChange={(event) => setSheetLogDraft((previous) => ({ ...previous, type: event.target.value }))}
                      disabled={!canManageCommitments || savingSheetLog || sheetLogTypeOptions.length === 0}
                    >
                      <option value="">Select type</option>
                      {sheetLogTypeOptions.map((typeValue) => (
                        <option key={`sheet-log-type-option-${typeValue}`} value={typeValue}>
                          {typeValue}
                        </option>
                      ))}
                    </select>
                    {selectedSheetLogTypeDescription ? (
                      <div style={{ color: "#64748B", fontSize: "0.74rem", marginTop: "4px" }}>
                        {selectedSheetLogTypeDescription}
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <label style={{ display: "block", textAlign: "left", color: "#475569", fontSize: "0.78rem", marginBottom: "4px", fontWeight: 700 }}>
                      Revision #
                    </label>
                    <input
                      type="text"
                      style={inputStyle}
                      value={sheetLogDraft.revisionNumber}
                      onChange={(event) => setSheetLogDraft((previous) => ({ ...previous, revisionNumber: event.target.value }))}
                      placeholder="Revision number"
                      disabled={!canManageCommitments || savingSheetLog}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <small style={{ color: "#64748B" }}>
                    Track whether each project needs a sheet, plus sheet name, identifiers, type, and revision.
                  </small>
                  <button
                    type="submit"
                    style={{ ...buttonStyle, background: canManageCommitments ? "#1D4ED8" : "#94A3B8" }}
                    disabled={!canManageCommitments || savingSheetLog}
                  >
                    {savingSheetLog ? "Saving..." : "Create Sheet Log"}
                  </button>
                </div>
              </form>
            </div>

            <div style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px", flexWrap: "wrap", gap: "10px" }}>
                <strong style={{ color: "#0F172A" }}>Sheet Log</strong>
                <small style={{ color: "#475569" }}>
                  {displayedSheetLogs.length} shown of {sheetLogs.length} entr{sheetLogs.length === 1 ? "y" : "ies"}
                </small>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "8px", marginBottom: "10px" }}>
                <div>
                  <label htmlFor="sheet-log-project-filter" style={{ color: "#475569", fontSize: "0.78rem", fontWeight: 700, display: "block", marginBottom: "4px" }}>
                    Filter by project
                  </label>
                  <select
                    id="sheet-log-project-filter"
                    value={sheetLogProjectFilter}
                    onChange={(event) => setSheetLogProjectFilter(event.target.value)}
                    style={{ ...inputStyle, padding: "7px 8px", fontSize: "0.82rem" }}
                  >
                    <option value="all">All projects</option>
                    {sheetLogProjectOptions.map((projectOption) => (
                      <option key={`sheet-log-project-filter-${projectOption.value}`} value={projectOption.value}>
                        {projectOption.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="sheet-log-search" style={{ color: "#475569", fontSize: "0.78rem", fontWeight: 700, display: "block", marginBottom: "4px" }}>
                    Search sheet log
                  </label>
                  <input
                    id="sheet-log-search"
                    type="text"
                    value={sheetLogSearchTerm}
                    onChange={(event) => setSheetLogSearchTerm(event.target.value)}
                    placeholder="Search project, sheet, identifiers, type, revision"
                    style={{ ...inputStyle, padding: "7px 8px", fontSize: "0.82rem" }}
                  />
                </div>
                <div>
                  <label htmlFor="sheet-log-date-order" style={{ color: "#475569", fontSize: "0.78rem", fontWeight: 700, display: "block", marginBottom: "4px" }}>
                    Sort by added date
                  </label>
                  <select
                    id="sheet-log-date-order"
                    value={sheetLogCreatedSortOrder}
                    onChange={(event) => setSheetLogCreatedSortOrder(event.target.value)}
                    style={{ ...inputStyle, padding: "7px 8px", fontSize: "0.82rem" }}
                  >
                    <option value="newest_first">Newest to oldest</option>
                    <option value="oldest_first">Oldest to newest</option>
                  </select>
                </div>
              </div>

              {loadingSheetLogs ? (
                <div style={{ textAlign: "left", color: "#64748B" }}>Loading Sheet Log entries...</div>
              ) : sheetLogs.length === 0 ? (
                <div style={{ textAlign: "left", color: "#64748B" }}>No Sheet Log entries yet.</div>
              ) : displayedSheetLogs.length === 0 ? (
                <div style={{ textAlign: "left", color: "#64748B" }}>No Sheet Log entries match the current filters.</div>
              ) : (
                <div style={{ width: "100%", border: "1px solid #E2E8F0", borderRadius: "10px" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                    <thead>
                      <tr style={{ background: "#F8FAFC" }}>
                        <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Project</th>
                        <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Create Sheet</th>
                        <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Sheet Name</th>
                        <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Identifiers</th>
                        <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Type</th>
                        <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Revision #</th>
                        <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Updated</th>
                        <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedSheetLogs.map((entry) => {
                        const sheetLogIdentifiers = normalizeSheetLogIdentifierArray(
                          Array.isArray(entry.identifiers) && entry.identifiers.length > 0
                            ? entry.identifiers
                            : entry.identifier
                        );
                        const sheetLogIdentifierRows = sheetLogIdentifiers.length > 0 ? sheetLogIdentifiers : [""];
                        const packageRowCount = Math.max(1, sheetLogIdentifierRows.length);

                        return (
                          <React.Fragment key={entry.id}>
                            {sheetLogIdentifierRows.map((identifierValue, identifierIndex) => (
                              <tr key={`${entry.id}-${identifierIndex}`}>
                                {identifierIndex === 0 ? (
                                  <>
                                    <td rowSpan={packageRowCount} style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155", wordBreak: "break-word", verticalAlign: "top" }}>
                                      {normalizeValue(entry.projectName) || "Untitled Project"}
                                    </td>
                                    <td rowSpan={packageRowCount} style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155", verticalAlign: "top" }}>
                                      {entry.shouldCreateSheet ? "Yes" : "No"}
                                    </td>
                                    <td rowSpan={packageRowCount} style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155", verticalAlign: "top" }}>
                                      {normalizeValue(entry.sheetName) || "-"}
                                    </td>
                                  </>
                                ) : null}

                                <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155", background: identifierIndex > 0 ? "#F8FAFC" : undefined, borderTop: identifierIndex > 0 ? "1px solid #E2E8F0" : undefined }}>
                                  <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 10px", borderRadius: "999px", background: identifierIndex === 0 ? "rgba(29, 78, 216, 0.08)" : "rgba(100, 116, 139, 0.10)", color: identifierIndex === 0 ? "#1D4ED8" : "#334155", fontWeight: 700, fontSize: "0.78rem", lineHeight: 1.2 }}>
                                    <span style={{ width: "7px", height: "7px", borderRadius: "999px", background: identifierIndex === 0 ? "#60A5FA" : "#94A3B8", display: "inline-block" }} />
                                    {identifierValue || "-"}
                                  </div>
                                </td>

                                {identifierIndex === 0 ? (
                                  <>
                                    <td rowSpan={packageRowCount} style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155", verticalAlign: "top" }}>
                                      {normalizeValue(entry.type) || "-"}
                                    </td>
                                    <td rowSpan={packageRowCount} style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155", verticalAlign: "top" }}>
                                      {normalizeValue(entry.revisionNumber) || "-"}
                                    </td>
                                    <td rowSpan={packageRowCount} style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#64748B", fontSize: "0.8rem", verticalAlign: "top" }}>
                                      {formatCreatedAt(entry.updatedAt || entry.createdAt)}
                                    </td>
                                    <td rowSpan={packageRowCount} style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", verticalAlign: "top" }}>
                                      {canManageCommitments ? (
                                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                          <button
                                            type="button"
                                            onClick={() => handleDuplicateSheetLog(entry)}
                                            style={{ ...buttonStyle, background: "#4F46E5", padding: "6px 10px", fontSize: "0.8rem" }}
                                          >
                                            Duplicate
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setEditingSheetLogId(entry.id)}
                                            style={{ ...buttonStyle, background: "#0F766E", padding: "6px 10px", fontSize: "0.8rem" }}
                                          >
                                            Edit
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handleDeleteSheetLog(entry.id)}
                                            style={{ ...buttonStyle, background: "#DC2626", padding: "6px 10px", fontSize: "0.8rem" }}
                                          >
                                            Delete
                                          </button>
                                        </div>
                                      ) : (
                                        <span style={{ color: "#94A3B8", fontSize: "0.78rem", fontWeight: 700 }}>Read-only</span>
                                      )}
                                    </td>
                                  </>
                                ) : null}
                              </tr>
                            ))}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
        <div style={{ ...cardStyle, marginBottom: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px", flexWrap: "wrap", gap: "10px" }}>
            <strong style={{ color: "#0F172A" }}>Search and Filter Commitments</strong>
            <small style={{ color: "#475569" }}>{displayedTasks.length} shown of {tasks.length} task{tasks.length === 1 ? "" : "s"}</small>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "8px", marginBottom: "10px" }}>
            <div>
              <label htmlFor="project-filter" style={{ color: "#475569", fontSize: "0.78rem", fontWeight: 700, display: "block", marginBottom: "4px" }}>
                Filter by project
              </label>
              <select
                id="project-filter"
                value={projectFilter}
                onChange={(event) => setProjectFilter(event.target.value)}
                style={{ ...inputStyle, padding: "7px 8px", fontSize: "0.82rem" }}
              >
                <option value="all">All projects</option>
                {taskProjectOptions.map((projectOption) => (
                  <option key={`project-filter-${projectOption.value}`} value={projectOption.value}>
                    {projectOption.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="task-search" style={{ color: "#475569", fontSize: "0.78rem", fontWeight: 700, display: "block", marginBottom: "4px" }}>
                Search all tasks
              </label>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <input
                  id="task-search"
                  type="text"
                  value={taskSearchTerm}
                  onChange={(event) => setTaskSearchTerm(event.target.value)}
                  placeholder="Search title, notes, status, priority, due date, logs"
                  style={{ ...inputStyle, padding: "7px 8px", fontSize: "0.82rem", flex: "1 1 260px", minWidth: "220px" }}
                />
                <select
                  value={taskStatusFilter}
                  onChange={(event) => setTaskStatusFilter(event.target.value)}
                  style={{ ...inputStyle, padding: "7px 8px", fontSize: "0.82rem", flex: "0 0 170px", minWidth: "170px" }}
                >
                  <option value="both">Both statuses</option>
                  <option value="completed">Completed only</option>
                  <option value="incomplete">Incomplete only</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="countdown-sort" style={{ color: "#475569", fontSize: "0.78rem", fontWeight: 700, display: "block", marginBottom: "4px" }}>
                Sort by countdown
              </label>
              <select
                id="countdown-sort"
                value={countdownSortOrder}
                onChange={(event) => setCountdownSortOrder(event.target.value)}
                style={{ ...inputStyle, padding: "7px 8px", fontSize: "0.82rem" }}
              >
                <option value="none">None</option>
                <option value="soonest_first">Soonest first</option>
                <option value="latest_first">Latest first</option>
              </select>
            </div>

            <div>
              <label htmlFor="priority-sort" style={{ color: "#475569", fontSize: "0.78rem", fontWeight: 700, display: "block", marginBottom: "4px" }}>
                Sort by priority
              </label>
              <select
                id="priority-sort"
                value={prioritySortOrder}
                onChange={(event) => setPrioritySortOrder(event.target.value)}
                style={{ ...inputStyle, padding: "7px 8px", fontSize: "0.82rem" }}
              >
                <option value="none">None</option>
                <option value="highest_first">Highest first</option>
                <option value="lowest_first">Lowest first</option>
              </select>
            </div>

            <div>
              <label htmlFor="direction-sort" style={{ color: "#475569", fontSize: "0.78rem", fontWeight: 700, display: "block", marginBottom: "4px" }}>
                Sort by direction
              </label>
              <select
                id="direction-sort"
                value={directionSortOrder}
                onChange={(event) => setDirectionSortOrder(event.target.value)}
                style={{ ...inputStyle, padding: "7px 8px", fontSize: "0.82rem" }}
              >
                <option value="none">None</option>
                <option value="default">Default order</option>
                <option value="reverse">Reverse order</option>
              </select>
            </div>

            <div>
              <label htmlFor="task-date-order" style={{ color: "#475569", fontSize: "0.78rem", fontWeight: 700, display: "block", marginBottom: "4px" }}>
                Sort by added date
              </label>
              <select
                id="task-date-order"
                value={taskCreatedSortOrder}
                onChange={(event) => setTaskCreatedSortOrder(event.target.value)}
                style={{ ...inputStyle, padding: "7px 8px", fontSize: "0.82rem" }}
              >
                <option value="manual_order">Manual order (for reordering)</option>
                <option value="newest_first">Newest to oldest</option>
                <option value="oldest_first">Oldest to newest</option>
              </select>
            </div>
          </div>

          <div style={{ color: "#64748B", fontSize: "0.78rem", textAlign: "left" }}>
            Reordering works when added date is set to Manual order and all other sort options are set to None.
          </div>
        </div>

        <div style={{ ...cardStyle, marginBottom: "16px" }}>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setIsQuickTaskOpen((previous) => !previous)}
              style={{
                ...buttonStyle,
                background: canManageCommitments ? "#1D4ED8" : "#94A3B8",
                minWidth: "160px",
              }}
              disabled={!canManageCommitments || checkingPermissions}
            >
              {isQuickTaskOpen ? "Close Quick Task" : "Add Quick Task"}
            </button>
          </div>

          {checkingPermissions ? (
            <div style={{ color: "#64748B", textAlign: "left" }}>Checking permissions...</div>
          ) : isQuickTaskOpen ? (
            <form onSubmit={handleCreateTask} style={{ display: "grid", gap: "10px" }}>
              <input
                style={inputStyle}
                value={draft.title}
                onChange={(event) => setDraft((previous) => ({ ...previous, title: event.target.value }))}
                placeholder="Task title"
                disabled={!canManageCommitments || savingTask}
              />

              <input
                style={inputStyle}
                value={draft.description}
                onChange={(event) => setDraft((previous) => ({ ...previous, description: event.target.value }))}
                placeholder="Task description"
                disabled={!canManageCommitments || savingTask}
              />

              <select
                style={inputStyle}
                value={draft.projectId}
                onChange={(event) => setDraft((previous) => ({ ...previous, projectId: event.target.value }))}
                disabled={loadingProjects || projects.length === 0 || !canManageCommitments || savingTask}
              >
                <option value="">Select IglesiaTech project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {normalizeValue(project.name) || "Untitled Project"}
                  </option>
                ))}
              </select>

              <select
                style={inputStyle}
                value={draft.categoryId}
                onChange={(event) => setDraft((previous) => ({ ...previous, categoryId: event.target.value }))}
                disabled={!canManageCommitments || savingTask}
              >
                <option value="">Uncategorized</option>
                {commitmentCategoryOptions.map((categoryOption) => (
                  <option key={`task-category-${categoryOption.value}`} value={categoryOption.value}>
                    {categoryOption.label}
                  </option>
                ))}
              </select>

              <select
                style={inputStyle}
                value={draft.parentTaskId}
                onChange={(event) => setDraft((previous) => ({ ...previous, parentTaskId: event.target.value }))}
                disabled={!canManageCommitments || savingTask || !normalizeValue(draft.projectId)}
              >
                <option value="">{normalizeValue(draft.projectId) ? "Top-level task (no parent)" : "Select a project first"}</option>
                {createParentTaskOptions.map((parentTaskOption) => (
                  <option key={`task-parent-${parentTaskOption.value}`} value={parentTaskOption.value}>
                    {parentTaskOption.label}
                  </option>
                ))}
              </select>

              <select
                style={inputStyle}
                value={draft.sheetLogId}
                onChange={(event) => setDraft((previous) => ({ ...previous, sheetLogId: event.target.value }))}
                disabled={!canManageCommitments || savingTask || !normalizeValue(draft.projectId)}
              >
                <option value="">{normalizeValue(draft.projectId) ? "No linked Sheet Log row" : "Select a project first"}</option>
                {createSheetLogOptions.map((sheetLogOption) => (
                  <option key={`task-sheet-log-${sheetLogOption.value}`} value={sheetLogOption.value}>
                    {sheetLogOption.label}
                  </option>
                ))}
              </select>

              <textarea
                style={{ ...inputStyle, minHeight: "72px", resize: "vertical" }}
                value={draft.notes}
                onChange={(event) => setDraft((previous) => ({ ...previous, notes: event.target.value }))}
                placeholder="Optional notes"
                disabled={!canManageCommitments || savingTask}
              />

              <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
                <div>
                  <label style={{ display: "block", textAlign: "left", color: "#475569", fontSize: "0.78rem", marginBottom: "4px", fontWeight: 700 }}>
                    Priority
                  </label>
                  <select
                    style={inputStyle}
                    value={draft.priority}
                    onChange={(event) => setDraft((previous) => ({ ...previous, priority: event.target.value }))}
                    disabled={!canManageCommitments || savingTask}
                  >
                    {TASK_PRIORITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", textAlign: "left", color: "#475569", fontSize: "0.78rem", marginBottom: "4px", fontWeight: 700 }}>
                    Direction
                  </label>
                  <select
                    style={inputStyle}
                    value={draft.direction}
                    onChange={(event) => setDraft((previous) => ({ ...previous, direction: event.target.value }))}
                    disabled={!canManageCommitments || savingTask}
                  >
                    {TASK_DIRECTION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", textAlign: "left", color: "#475569", fontSize: "0.78rem", marginBottom: "4px", fontWeight: 700 }}>
                    Due Date
                  </label>
                  <input
                    type="date"
                    style={inputStyle}
                    value={draft.dueDate}
                    onChange={(event) => setDraft((previous) => ({ ...previous, dueDate: event.target.value }))}
                    disabled={!canManageCommitments || savingTask}
                  />
                </div>
                <div>
                  <label style={{ display: "block", textAlign: "left", color: "#475569", fontSize: "0.78rem", marginBottom: "4px", fontWeight: 700 }}>
                    Progress % ({normalizeProgressPercent(draft.progressPercent)}%)
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    style={inputStyle}
                    value={draft.progressPercent}
                    onChange={(event) => setDraft((previous) => ({ ...previous, progressPercent: event.target.value }))}
                    disabled={!canManageCommitments || savingTask}
                  />
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <small style={{ color: "#64748B" }}>
                  {canManageCommitments
                    ? "Managed by module manager permissions."
                    : "Read-only: ask a module manager to add or edit tasks."}
                </small>
                <button
                  type="submit"
                  style={{ ...buttonStyle, background: canManageCommitments ? "#1D4ED8" : "#94A3B8" }}
                  disabled={!canManageCommitments || savingTask}
                >
                  {savingTask ? "Saving..." : "Add Quick Task"}
                </button>
              </div>
            </form>
          ) : null}
        </div>

        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px", flexWrap: "wrap", gap: "10px" }}>
            <strong style={{ color: "#0F172A" }}>Recent Commitments</strong>
            <small style={{ color: "#475569" }}>
              {categoryFilteredDisplayedTasks.length > 0
                ? `${Math.min((commitmentsPage - 1) * COMMITMENT_TASKS_PER_PAGE + 1, categoryFilteredDisplayedTasks.length)}-${Math.min(commitmentsPage * COMMITMENT_TASKS_PER_PAGE, categoryFilteredDisplayedTasks.length)}`
                : "0"} shown of {categoryFilteredDisplayedTasks.length} filtered task{categoryFilteredDisplayedTasks.length === 1 ? "" : "s"} ({tasks.length} total)
            </small>
          </div>

          <div style={{ marginBottom: "12px" }}>
            <div style={{ color: "#475569", fontSize: "0.78rem", fontWeight: 700, marginBottom: "6px" }}>
              Filter categories
            </div>
            <div style={{ display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "4px", flexWrap: "nowrap" }}>
              <button
                type="button"
                onClick={() => setCommitmentCategoryFilter("all")}
                style={{
                  ...buttonStyle,
                  background: commitmentCategoryFilter === "all" ? "#1D4ED8" : "#E2E8F0",
                  color: commitmentCategoryFilter === "all" ? "#FFFFFF" : "#0F172A",
                  whiteSpace: "nowrap",
                  boxShadow: commitmentCategoryFilter === "all" ? "0 8px 18px rgba(29, 78, 216, 0.18)" : "none",
                }}
              >
                All ({displayedTasks.length})
              </button>
              {commitmentCategoryOptions.map((categoryOption) => {
                const isActive = commitmentCategoryFilter === categoryOption.value;
                const categoryTaskCount = displayedTaskCategoryCounts.get(categoryOption.value) || 0;
                const isDisabled = categoryTaskCount === 0;

                return (
                  <button
                    key={`commitment-filter-${categoryOption.value}`}
                    type="button"
                    onClick={() => {
                      if (isDisabled) return;
                      setCommitmentCategoryFilter(categoryOption.value);
                    }}
                    disabled={isDisabled}
                    style={{
                      ...buttonStyle,
                      background: isDisabled ? "#F8FAFC" : isActive ? "#1D4ED8" : "#F1F5F9",
                      color: isDisabled ? "#94A3B8" : isActive ? "#FFFFFF" : "#334155",
                      border: "1px solid #CBD5E1",
                      whiteSpace: "nowrap",
                      boxShadow: isActive ? "0 8px 18px rgba(29, 78, 216, 0.18)" : "none",
                      opacity: isDisabled ? 0.55 : 1,
                      cursor: isDisabled ? "not-allowed" : "pointer",
                    }}
                    title={isDisabled ? `${categoryOption.label} has 0 tasks` : categoryOption.description || categoryOption.label}
                  >
                    {categoryOption.label} ({categoryTaskCount})
                  </button>
                );
              })}
            </div>
          </div>

          {!loadingTasks && categoryFilteredDisplayedTasks.length > 0 ? (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "10px" }}>
              <div style={{ color: "#64748B", fontSize: "0.78rem" }}>
                Page {Math.min(commitmentsPage, totalCommitmentPages)} of {totalCommitmentPages}
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => setCommitmentsPage((previous) => Math.max(1, previous - 1))}
                  disabled={commitmentsPage <= 1}
                  style={{
                    ...buttonStyle,
                    background: commitmentsPage <= 1 ? "#CBD5E1" : "#2563EB",
                    padding: "6px 10px",
                    fontSize: "0.8rem",
                    cursor: commitmentsPage <= 1 ? "not-allowed" : "pointer",
                  }}
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setCommitmentsPage((previous) => Math.min(totalCommitmentPages, previous + 1))}
                  disabled={commitmentsPage >= totalCommitmentPages}
                  style={{
                    ...buttonStyle,
                    background: commitmentsPage >= totalCommitmentPages ? "#CBD5E1" : "#2563EB",
                    padding: "6px 10px",
                    fontSize: "0.8rem",
                    cursor: commitmentsPage >= totalCommitmentPages ? "not-allowed" : "pointer",
                  }}
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}

          {loadingTasks ? (
            <div style={{ textAlign: "left", color: "#64748B" }}>Loading tasks...</div>
          ) : tasks.length === 0 ? (
            <div style={{ textAlign: "left", color: "#64748B" }}>No tasks yet. Add your first quick task above.</div>
          ) : categoryFilteredDisplayedTasks.length === 0 ? (
            <div style={{ textAlign: "left", color: "#64748B" }}>No tasks match the current filters.</div>
          ) : (
            <div style={{ width: "100%", border: "1px solid #E2E8F0", borderRadius: "16px", background: "linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%)", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 10px", tableLayout: "fixed", padding: "0 10px 10px" }}>
                <thead>
                  <tr style={{ background: "#F8FAFC" }}>
                    <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Project</th>
                    <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Task</th>
                    <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Priority</th>
                    <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Direction</th>
                    <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Due Date</th>
                    <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Countdown</th>
                    <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Progress</th>
                    <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Status</th>
                    <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Unread</th>
                    <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedTaskSections.map((section, sectionIndex) => {
                    const sectionTheme = getCategoryHeaderTheme(sectionIndex);

                    return (
                    <React.Fragment key={section.key}>
                      <tr>
                        <td colSpan={commitmentTableColumnCount} style={{ padding: sectionIndex === 0 ? "12px 12px 6px" : "24px 12px 6px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", flexWrap: "wrap", padding: "16px 16px 14px", borderRadius: "16px", background: sectionTheme.cardBackground, border: `1px solid ${sectionTheme.cardBorder}`, boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.65), 0 10px 24px rgba(15, 23, 42, 0.05)", position: "relative", overflow: "hidden" }}>
                            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "7px", background: sectionTheme.accentRail }} />
                            <div style={{ position: "absolute", left: "7px", right: 0, top: 0, height: "1px", background: "rgba(255,255,255,0.85)" }} />
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", paddingLeft: "8px" }}>
                                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 10px", borderRadius: "999px", background: sectionTheme.labelBackground, color: sectionTheme.labelText, fontSize: "0.72rem", fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                                  <span style={{ width: "8px", height: "8px", borderRadius: "999px", background: sectionTheme.arrowColor, display: "inline-block" }} />
                                  Category
                                </span>
                                <div style={{ color: sectionTheme.titleText, fontSize: "1.45rem", fontWeight: 950, letterSpacing: "-0.03em", lineHeight: 1.02 }}>
                                  {section.label}
                                </div>
                                <div style={{ flex: "1 1 auto", minWidth: "260px", height: "4px", position: "relative", marginLeft: "6px", marginRight: "6px", marginTop: "2px" }}>
                                  <div style={{ position: "absolute", inset: 0, borderRadius: "999px", background: sectionTheme.lineGradient }} />
                                  <div style={{ position: "absolute", right: "-1px", top: "-4px", width: 0, height: 0, borderTop: "6px solid transparent", borderBottom: "6px solid transparent", borderLeft: `10px solid ${sectionTheme.arrowColor}` }} />
                                </div>
                                <span style={{ color: sectionTheme.countText, fontSize: "0.8rem", fontWeight: 800, whiteSpace: "nowrap" }}>
                                  {section.tasks.length} task{section.tasks.length === 1 ? "" : "s"}
                                </span>
                              </div>
                              {section.description ? (
                                <div style={{ marginTop: "6px", color: "#475569", fontSize: "0.84rem", paddingLeft: "8px" }}>{section.description}</div>
                              ) : null}
                            </div>
                          </div>
                        </td>
                      </tr>

                      {section.tasks.map((task, index) => {
                        const isDone = isTaskCompleted(task);
                        const progressPercent = normalizeProgressPercent(task.progressPercent);
                        const taskPriority = normalizeTaskPriority(task.priority);
                        const taskPriorityMeta = TASK_PRIORITY_OPTIONS.find((option) => option.value === taskPriority) || TASK_PRIORITY_OPTIONS[1];
                        const taskDirection = normalizeTaskDirection(task.direction);
                        const taskDirectionMeta = TASK_DIRECTION_OPTIONS.find((option) => option.value === taskDirection) || TASK_DIRECTION_OPTIONS[0];
                        const dueDateInputValue = toDateInputValue(task.dueDate);
                        const dueDateCountdown = getTaskDueDateCountdownMeta(task);
                        const unreadNoteCount = getTaskUnreadNoteCount(task);
                        const taskDepth = Math.max(0, Number(task.__depth) || 0);
                        const hierarchyMeta = getTaskHierarchyMeta(taskDepth);
                        const hasParentTask = Boolean(normalizeValue(task.parentTaskId));
                        const parentTaskLabel = parentTaskTitleById.get(normalizeValue(task.parentTaskId)) || "";
                        const moveMeta = siblingMoveMetaByTaskId.get(task.id) || { index: 0, total: 1 };
                        const isMoveBusy = Boolean(movingTaskId);
                        const canMoveUp = canManageCommitments && isManualTaskOrderEnabled && moveMeta.index > 0 && !isMoveBusy;
                        const canMoveDown = canManageCommitments && isManualTaskOrderEnabled && moveMeta.index < moveMeta.total - 1 && !isMoveBusy;
                        const taskRowColors = getTaskRowColors(isDone, taskDepth, index);
                        const linkedSheetLogId = normalizeValue(task.sheetLogId);
                        const linkedSheetLogEntry = linkedSheetLogId ? sheetLogById.get(linkedSheetLogId) : null;
                        const linkedSheetLogName = normalizeValue(linkedSheetLogEntry?.sheetName || task.sheetLogSheetName);
                        const linkedSheetLogType = normalizeValue(linkedSheetLogEntry?.type || task.sheetLogType);
                        const linkedSheetLogRevision = normalizeValue(linkedSheetLogEntry?.revisionNumber || task.sheetLogRevisionNumber);
                        const linkedSheetLogIdentifiers = normalizeSheetLogIdentifierArray(
                          Array.isArray(linkedSheetLogEntry?.identifiers) && linkedSheetLogEntry.identifiers.length > 0
                            ? linkedSheetLogEntry.identifiers
                            : (Array.isArray(task.sheetLogIdentifiers) && task.sheetLogIdentifiers.length > 0
                              ? task.sheetLogIdentifiers
                              : linkedSheetLogEntry?.identifier || task.sheetLogIdentifier)
                        );
                        const hasLinkedSheetLog = Boolean(
                          linkedSheetLogId
                          || linkedSheetLogName
                          || linkedSheetLogType
                          || linkedSheetLogRevision
                          || linkedSheetLogIdentifiers.length > 0
                        );

                        return (
                          <tr
                            key={task.id}
                            onDoubleClick={() => setSelectedEditTaskId(task.id)}
                            title="Double-click to edit"
                            style={{
                              background: taskRowColors.rowBackground,
                              borderLeft: taskDepth > 0 ? `6px solid ${taskRowColors.accentBorder}` : undefined,
                              boxShadow: "0 10px 24px rgba(15, 23, 42, 0.06)",
                              cursor: "pointer",
                            }}
                          >
                            <td style={{ padding: "12px 10px", borderTopLeftRadius: "14px", borderBottomLeftRadius: "14px", borderBottom: "1px solid #E2E8F0", borderTop: "1px solid #E2E8F0", borderLeft: "1px solid #E2E8F0", background: taskRowColors.rowBackground, color: "#334155", wordBreak: "break-word" }}>
                              <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "4px 10px", borderRadius: "999px", background: isDone ? "rgba(34, 197, 94, 0.08)" : "rgba(234, 179, 8, 0.09)", color: isDone ? "#4B7F58" : "#8A6C1F", fontSize: "0.76rem", fontWeight: 800, marginBottom: "6px" }}>
                                <span style={{ width: "8px", height: "8px", borderRadius: "999px", background: isDone ? "#8CCF9A" : "#D2B04A", display: "inline-block" }} />
                                {isDone ? "Finished" : "Active"}
                              </div>
                              <div style={{ fontWeight: 700, color: "#0F172A", fontSize: "0.88rem" }}>
                                {normalizeValue(task.projectName) || "Untitled Project"}
                              </div>
                            </td>
                            <td style={{ padding: "12px 10px", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0", background: taskRowColors.rowBackground, wordBreak: "break-word" }}>
                              <div style={{ marginLeft: `${Math.min(hierarchyMeta.indent, 8) * 18}px`, paddingLeft: taskDepth > 0 ? (taskDepth >= 2 ? "14px" : "10px") : "0", position: "relative" }}>
                                {taskDepth > 0 ? (
                                  <div style={{ position: "absolute", left: "0", top: "10px", width: taskDepth >= 2 ? "4px" : "2px", height: "calc(100% - 10px)", borderRadius: "999px", background: `linear-gradient(180deg, ${taskDepth >= 2 ? hierarchyMeta.markerText : taskRowColors.accentBorder} 0%, rgba(255,255,255,0.1) 100%)` }} />
                                ) : null}
                                {hasParentTask ? (
                                  <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: hierarchyMeta.badgeText, background: hierarchyMeta.badgeBackground, fontSize: "0.72rem", fontWeight: 900, marginBottom: "6px", padding: "3px 10px", borderRadius: "999px", boxShadow: taskDepth >= 2 ? "0 6px 12px rgba(91, 33, 182, 0.12)" : "none" }}>
                                    {hierarchyMeta.label}{parentTaskLabel ? ` of ${parentTaskLabel}` : ""}
                                  </div>
                                ) : null}
                                <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", marginBottom: "2px" }}>
                                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: "30px", padding: "3px 8px", borderRadius: "999px", background: isDone ? "rgba(34, 197, 94, 0.10)" : taskDepth >= 2 ? "rgba(124, 58, 237, 0.10)" : "rgba(29, 78, 216, 0.10)", color: isDone ? "#4B7F58" : taskDepth >= 2 ? "#5B21B6" : "#1D4ED8", fontSize: "0.76rem", fontWeight: 900, letterSpacing: "0.01em" }}>
                                    {index + 1}
                                  </span>
                                  <div style={{ fontWeight: 900, color: taskDepth >= 2 ? "#4C1D95" : "#0F172A", textDecoration: isDone ? "line-through" : "none", fontSize: taskDepth >= 2 ? "0.92rem" : "0.95rem", letterSpacing: "-0.01em", display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                    {taskDepth > 0 ? (
                                      <span style={{ color: hierarchyMeta.markerText, fontSize: taskDepth >= 2 ? "1.28rem" : "1.18rem", fontWeight: 900, lineHeight: 1, transform: "translateY(-1px)" }}>
                                        {taskDepth >= 2 ? "⇢" : "↳"}
                                      </span>
                                    ) : null}
                                    {normalizeValue(task.title) || "Untitled Task"}
                                  </div>
                                </div>
                                {normalizeValue(task.description) ? (
                                  <div style={{ marginTop: "4px", color: taskDepth >= 2 ? "#6B21A8" : "#475569", fontSize: taskDepth >= 2 ? "0.8rem" : "0.82rem", textDecoration: isDone ? "line-through" : "none" }}>
                                    {normalizeValue(task.description)}
                                  </div>
                                ) : null}
                                {hasLinkedSheetLog ? (
                                  <div style={{ marginTop: "7px", display: "grid", gap: "4px", padding: "6px 10px", borderRadius: "14px", background: "rgba(79, 70, 229, 0.10)", color: "#4338CA", fontSize: "0.74rem", fontWeight: 700 }}>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
                                      <span style={{ width: "7px", height: "7px", borderRadius: "999px", background: "#6366F1", display: "inline-block" }} />
                                      <span style={{ color: "#312E81", fontWeight: 900 }}>Sheet Log</span>
                                      <span style={{ color: "#312E81", fontWeight: 800 }}>
                                        {linkedSheetLogName || linkedSheetLogId || "Linked row"}
                                      </span>
                                      {linkedSheetLogType ? <span style={{ color: "#5B21B6" }}>Type: {linkedSheetLogType}</span> : null}
                                      {linkedSheetLogRevision ? <span style={{ color: "#5B21B6" }}>Rev: {linkedSheetLogRevision}</span> : null}
                                      {linkedSheetLogId && !linkedSheetLogEntry ? <span style={{ color: "#B45309" }}>(row not found)</span> : null}
                                    </div>
                                    {linkedSheetLogIdentifiers.length > 0 ? (
                                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center", color: "#312E81", fontWeight: 800 }}>
                                        <span style={{ fontWeight: 900 }}>Identifiers:</span>
                                        {linkedSheetLogIdentifiers.map((identifierValue, identifierIndex) => (
                                          <span
                                            key={`${task.id}-linked-sheet-log-identifier-${identifierIndex}`}
                                            style={{
                                              display: "inline-flex",
                                              alignItems: "center",
                                              padding: "3px 8px",
                                              borderRadius: "999px",
                                              background: "rgba(255, 255, 255, 0.90)",
                                              border: "1px solid rgba(99, 102, 241, 0.24)",
                                              color: "#312E81",
                                              fontWeight: 800,
                                            }}
                                          >
                                            {identifierValue}
                                          </span>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            </td>
                            <td style={{ padding: "12px 10px", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0", background: taskRowColors.rowBackground }}>
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "6px",
                                  padding: "4px 9px",
                                  borderRadius: "999px",
                                  background: taskPriorityMeta.bg,
                                  color: taskPriorityMeta.text,
                                  fontSize: "0.76rem",
                                  fontWeight: 800,
                                  letterSpacing: "0.01em",
                                }}
                                title={`Priority: ${taskPriorityMeta.label}`}
                              >
                                <span style={{ width: "8px", height: "8px", borderRadius: "999px", background: taskPriorityMeta.text, display: "inline-block" }} />
                                {taskPriorityMeta.label}
                              </span>
                            </td>
                            <td style={{ padding: "12px 10px", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0", background: taskRowColors.rowBackground }}>
                              {canManageCommitments ? (
                                <select
                                  value={taskDirection}
                                  onChange={(event) => handleUpdateTaskDirection(task, event.target.value)}
                                  style={{ ...inputStyle, padding: "7px 8px", fontSize: "0.82rem", width: "100%" }}
                                >
                                  {TASK_DIRECTION_OPTIONS.map((option) => (
                                    <option key={`${task.id}-direction-${option.value}`} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span
                                  style={{
                                    display: "inline-block",
                                    padding: "4px 8px",
                                    borderRadius: "999px",
                                    background: taskDirectionMeta.bg,
                                    color: taskDirectionMeta.text,
                                    fontSize: "0.74rem",
                                    fontWeight: 700,
                                  }}
                                  title={`Direction: ${taskDirectionMeta.label}`}
                                >
                                  {taskDirectionMeta.label}
                                </span>
                              )}
                            </td>
                            <td style={{ padding: "12px 10px", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0", background: taskRowColors.rowBackground, color: "#334155" }}>
                              {canManageCommitments ? (
                                <input
                                  type="date"
                                  value={dueDateInputValue}
                                  style={{ ...inputStyle, padding: "7px 8px", fontSize: "0.82rem", width: "100%" }}
                                  onChange={(event) => handleUpdateTaskDueDate(task, event.target.value)}
                                />
                              ) : (
                                dueDateInputValue || "-"
                              )}
                            </td>
                            <td style={{ padding: "12px 10px", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0", background: taskRowColors.rowBackground }}>
                              <span
                                style={{
                                  padding: "4px 8px",
                                  borderRadius: "999px",
                                  fontSize: "0.74rem",
                                  fontWeight: 700,
                                  background: dueDateCountdown.bg,
                                  color: dueDateCountdown.text,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {dueDateCountdown.label}
                              </span>
                            </td>
                            <td style={{ padding: "12px 10px", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0", background: taskRowColors.rowBackground }}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                                <span style={{ color: "#0F172A", fontSize: "0.78rem", fontWeight: 700 }}>{progressPercent}%</span>
                              </div>
                              <div style={{ height: "8px", width: "100%", borderRadius: "999px", background: "#E2E8F0", overflow: "hidden", marginBottom: "6px" }}>
                                <div
                                  style={{
                                    height: "100%",
                                    width: `${progressPercent}%`,
                                    background: progressPercent >= 100 ? "#16A34A" : "#2563EB",
                                  }}
                                />
                              </div>
                              {canManageCommitments ? (
                                <div>
                                  <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    step="1"
                                    defaultValue={String(progressPercent)}
                                    style={{ ...inputStyle, padding: "7px 8px", width: "100%" }}
                                    onMouseUp={(event) => handleUpdateTaskProgress(task, event.target.value)}
                                    onTouchEnd={(event) => handleUpdateTaskProgress(task, event.target.value)}
                                    onKeyUp={(event) => {
                                      if (event.key === "Enter") {
                                        handleUpdateTaskProgress(task, event.currentTarget.value);
                                      }
                                    }}
                                  />
                                </div>
                              ) : null}
                            </td>
                            <td style={{ padding: "12px 10px", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0", background: taskRowColors.rowBackground }}>
                              <span
                                style={{
                                  padding: "4px 8px",
                                  borderRadius: "999px",
                                  background: isDone ? "#DCFCE7" : "#DBEAFE",
                                  color: isDone ? "#166534" : "#1E40AF",
                                  fontSize: "0.76rem",
                                  fontWeight: 700,
                                  textTransform: "uppercase",
                                }}
                              >
                                {isDone ? "Done" : "Open"}
                              </span>
                            </td>
                            <td style={{ padding: "12px 10px", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0", background: taskRowColors.rowBackground }}>
                              <button
                                type="button"
                                onClick={() => handleOpenTaskLog(task)}
                                style={{
                                  border: "none",
                                  cursor: "pointer",
                                  display: "inline-block",
                                  minWidth: "40px",
                                  textAlign: "center",
                                  padding: "5px 10px",
                                  borderRadius: "999px",
                                  background: unreadNoteCount > 0 ? "linear-gradient(135deg, #FECACA 0%, #FCA5A5 100%)" : "linear-gradient(135deg, #E2E8F0 0%, #CBD5E1 100%)",
                                  color: unreadNoteCount > 0 ? "#7F1D1D" : "#334155",
                                  fontSize: "0.78rem",
                                  fontWeight: 800,
                                  animation: unreadNoteCount > 0 ? "workProgressUnreadBlink 1s ease-in-out infinite" : "none",
                                  boxShadow: "0 6px 14px rgba(15, 23, 42, 0.08)",
                                }}
                                title={unreadNoteCount > 0 ? `Open log (${unreadNoteCount} unread note${unreadNoteCount === 1 ? "" : "s"})` : "Open log"}
                              >
                                {unreadNoteCount}
                              </button>
                            </td>
                            <td style={{ padding: "12px 10px", borderTopRightRadius: "14px", borderBottomRightRadius: "14px", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0", borderRight: "1px solid #E2E8F0", background: taskRowColors.rowBackground }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                <Link
                                  to={`${routePrefix}/${id}/work-progress/task/${task.id}`}
                                  style={{
                                    ...buttonStyle,
                                    background: "linear-gradient(135deg, #7C3AED 0%, #A78BFA 100%)",
                                    padding: "6px 12px",
                                    fontSize: "0.8rem",
                                    boxShadow: "0 8px 18px rgba(124, 58, 237, 0.24)",
                                    textDecoration: "none",
                                    display: "inline-flex",
                                    alignItems: "center",
                                  }}
                                >
                                  Details
                                </Link>

                                <button
                                  type="button"
                                  onClick={() => setSelectedEditTaskId(task.id)}
                                  style={{
                                    ...buttonStyle,
                                    background: "linear-gradient(135deg, #0F766E 0%, #14B8A6 100%)",
                                    padding: "6px 12px",
                                    fontSize: "0.8rem",
                                    boxShadow: "0 8px 18px rgba(15, 118, 110, 0.24)",
                                  }}
                                >
                                  Edit
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleOpenTaskLog(task)}
                                  style={{
                                    ...buttonStyle,
                                    background: "linear-gradient(135deg, #475569 0%, #64748B 100%)",
                                    padding: "6px 12px",
                                    fontSize: "0.8rem",
                                    boxShadow: "0 8px 18px rgba(71, 85, 105, 0.22)",
                                  }}
                                >
                                  Log
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleDuplicateTask(task)}
                                  style={{
                                    ...buttonStyle,
                                    background: "linear-gradient(135deg, #4F46E5 0%, #818CF8 100%)",
                                    padding: "6px 12px",
                                    fontSize: "0.8rem",
                                    boxShadow: "0 8px 18px rgba(79, 70, 229, 0.24)",
                                  }}
                                >
                                  Duplicate Row
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleMoveTask(task, "up")}
                                  style={{
                                    ...buttonStyle,
                                    background: canMoveUp ? "linear-gradient(135deg, #1D4ED8 0%, #60A5FA 100%)" : "#94A3B8",
                                    padding: "6px 12px",
                                    fontSize: "0.8rem",
                                  }}
                                  disabled={!canMoveUp}
                                  title="Move up"
                                >
                                  Up
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleMoveTask(task, "down")}
                                  style={{
                                    ...buttonStyle,
                                    background: canMoveDown ? "linear-gradient(135deg, #1D4ED8 0%, #60A5FA 100%)" : "#94A3B8",
                                    padding: "6px 12px",
                                    fontSize: "0.8rem",
                                  }}
                                  disabled={!canMoveDown}
                                  title="Move down"
                                >
                                  Down
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                    );
                  })}
                </tbody>
              </table>

              {totalCommitmentPages > 1 ? (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap", padding: "10px 12px 14px", borderTop: "1px solid #E2E8F0", background: "linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%)" }}>
                  <div style={{ color: "#64748B", fontSize: "0.78rem" }}>
                    Page {Math.min(commitmentsPage, totalCommitmentPages)} of {totalCommitmentPages}
                  </div>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <button
                      type="button"
                      onClick={() => setCommitmentsPage((previous) => Math.max(1, previous - 1))}
                      disabled={commitmentsPage <= 1}
                      style={{
                        ...buttonStyle,
                        background: commitmentsPage <= 1 ? "#CBD5E1" : "#2563EB",
                        padding: "6px 10px",
                        fontSize: "0.8rem",
                        cursor: commitmentsPage <= 1 ? "not-allowed" : "pointer",
                      }}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      onClick={() => setCommitmentsPage((previous) => Math.min(totalCommitmentPages, previous + 1))}
                      disabled={commitmentsPage >= totalCommitmentPages}
                      style={{
                        ...buttonStyle,
                        background: commitmentsPage >= totalCommitmentPages ? "#CBD5E1" : "#2563EB",
                        padding: "6px 10px",
                        fontSize: "0.8rem",
                        cursor: commitmentsPage >= totalCommitmentPages ? "not-allowed" : "pointer",
                      }}
                    >
                      Next
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
          </>
        )}
      </div>

      {selectedLogTask ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(15, 23, 42, 0.5)",
            zIndex: 1200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
          }}
        >
          <div
            style={{
              width: "min(760px, 100%)",
              maxHeight: "80vh",
              overflowY: "auto",
              background: "#FFFFFF",
              borderRadius: "12px",
              border: "1px solid #E2E8F0",
              padding: "16px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
              <div>
                <div style={{ color: "#0F172A", fontWeight: 800 }}>Change Log</div>
                <div style={{ color: "#64748B", fontSize: "0.86rem" }}>
                  {normalizeValue(selectedLogTask.title) || "Untitled Task"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLogTaskId("")}
                style={{
                  ...buttonStyle,
                  background: "#334155",
                  padding: "6px 10px",
                  fontSize: "0.82rem",
                }}
              >
                Close
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: "12px",
                alignItems: "start",
              }}
            >
              <div style={{ border: "1px solid #E2E8F0", borderRadius: "10px", padding: "10px", background: "#FFFFFF" }}>
                <div style={{ color: "#334155", fontSize: "0.8rem", fontWeight: 700, marginBottom: "6px" }}>
                  Add Note to Log
                </div>
                <textarea
                  value={logNoteDraft}
                  onChange={(event) => {
                    setLogNoteDraft(event.target.value);
                    setLogNoteError("");
                  }}
                  placeholder="Write a note for this task log"
                  style={{ ...inputStyle, minHeight: "120px", resize: "vertical", marginBottom: "8px" }}
                  disabled={!canManageCommitments || savingLogNote}
                />
                <input
                  type="file"
                  onChange={(event) => {
                    setLogNoteFileDraft(event.target.files?.[0] || null);
                    setLogNoteError("");
                  }}
                  style={{ ...inputStyle, marginBottom: "8px", padding: "8px" }}
                  disabled={!canManageCommitments || savingLogNote}
                />
                {logNoteFileDraft ? (
                  <div style={{ color: "#1E3A8A", fontSize: "0.8rem", marginBottom: "8px", fontWeight: 600 }}>
                    Attachment ready: {logNoteFileDraft.name}
                    {formatFileSize(logNoteFileDraft.size)
                      ? ` (${formatFileSize(logNoteFileDraft.size)})`
                      : ""}
                  </div>
                ) : null}
                {logNoteError ? (
                  <div style={{ color: "#B91C1C", fontSize: "0.8rem", marginBottom: "8px", fontWeight: 600 }}>
                    {logNoteError}
                  </div>
                ) : null}
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={handleAddLogNote}
                    style={{
                      ...buttonStyle,
                      background: canManageCommitments ? "#2563EB" : "#94A3B8",
                      padding: "6px 10px",
                      fontSize: "0.8rem",
                    }}
                    disabled={!canManageCommitments || savingLogNote}
                  >
                    {savingLogNote ? "Saving..." : "Save Note"}
                  </button>
                </div>
              </div>

              <div style={{ border: "1px solid #E2E8F0", borderRadius: "10px", padding: "10px", background: "#FFFFFF" }}>
                <div style={{ color: "#334155", fontSize: "0.8rem", fontWeight: 700, marginBottom: "6px" }}>
                  Log Timeline
                </div>
                {normalizeTaskChangeLog(selectedLogTask.changeLog).length === 0 ? (
                  <div style={{ color: "#64748B" }}>No log entries yet.</div>
                ) : (
                  <div style={{ display: "grid", gap: "8px", maxHeight: "48vh", overflowY: "auto", paddingRight: "2px" }}>
                    {normalizeTaskChangeLog(selectedLogTask.changeLog)
                      .slice()
                      .reverse()
                      .map((entry, index) => (
                        <div
                          key={`${entry.changedAtIso}-${index}`}
                          style={{
                            border: "1px solid #E2E8F0",
                            borderRadius: "10px",
                            padding: "10px",
                            background: "#F8FAFC",
                          }}
                        >
                          <div style={{ color: "#0F172A", fontWeight: 700 }}>
                            {entry.message || "Updated"}
                          </div>
                          {entry.attachment?.url ? (
                            <div style={{ display: "grid", gap: "4px", marginTop: "4px" }}>
                              {isImageAttachment(entry.attachment) ? (
                                <a
                                  href={entry.attachment.url}
                                  onClick={(event) => handleOpenImagePreview(entry.attachment, event)}
                                  style={{ display: "inline-block", width: "fit-content" }}
                                >
                                  <img
                                    src={entry.attachment.url}
                                    alt={entry.attachment.name || "Attachment preview"}
                                    style={{ width: "88px", height: "88px", objectFit: "cover", borderRadius: "8px", border: "1px solid #CBD5E1", backgroundColor: "#FFFFFF" }}
                                  />
                                </a>
                              ) : null}
                              <a
                                href={entry.attachment.url}
                                onClick={isImageAttachment(entry.attachment)
                                  ? (event) => handleOpenImagePreview(entry.attachment, event)
                                  : undefined}
                                target={isImageAttachment(entry.attachment) ? undefined : "_blank"}
                                rel={isImageAttachment(entry.attachment) ? undefined : "noopener noreferrer"}
                                style={{ color: "#1D4ED8", textDecoration: "underline", fontSize: "0.82rem", fontWeight: 600, display: "inline-block" }}
                              >
                                Open file: {entry.attachment.name || "Attachment"}
                                {formatFileSize(entry.attachment.size)
                                  ? ` (${formatFileSize(entry.attachment.size)})`
                                  : ""}
                              </a>
                            </div>
                          ) : null}
                          <div style={{ color: "#64748B", fontSize: "0.8rem", marginTop: "2px" }}>
                            {formatLogTimestamp(entry.changedAtIso)} by {entry.changedByName || "Unknown user"}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {selectedEditTask ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(15, 23, 42, 0.5)",
            zIndex: 1250,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
          }}
        >
          <div
            style={{
              width: "min(860px, 100%)",
              maxHeight: "84vh",
              overflowY: "auto",
              background: "#FFFFFF",
              borderRadius: "12px",
              border: "1px solid #E2E8F0",
              padding: "16px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
              <div>
                <div style={{ color: "#0F172A", fontWeight: 800 }}>Edit Task</div>
                <div style={{ color: "#64748B", fontSize: "0.86rem" }}>
                  {normalizeValue(selectedEditTask.title) || "Untitled Task"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEditTaskId("")}
                style={{
                  ...buttonStyle,
                  background: "#334155",
                  padding: "6px 10px",
                  fontSize: "0.82rem",
                }}
              >
                Close
              </button>
            </div>

            {editTaskDraft ? (
              <form onSubmit={handleSaveEditedTask} style={{ display: "grid", gap: "10px" }}>
                <input
                  style={inputStyle}
                  value={editTaskDraft.title}
                  onChange={(event) => setEditTaskDraft((previous) => ({ ...previous, title: event.target.value }))}
                  placeholder="Task title"
                  disabled={!canManageCommitments || savingEditTask}
                />

                <input
                  style={inputStyle}
                  value={editTaskDraft.description}
                  onChange={(event) => setEditTaskDraft((previous) => ({ ...previous, description: event.target.value }))}
                  placeholder="Task description"
                  disabled={!canManageCommitments || savingEditTask}
                />

                <select
                  style={inputStyle}
                  value={editTaskDraft.projectId}
                  onChange={(event) => setEditTaskDraft((previous) => ({ ...previous, projectId: event.target.value }))}
                  disabled={loadingProjects || projects.length === 0 || !canManageCommitments || savingEditTask}
                >
                  <option value="">Select IglesiaTech project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {normalizeValue(project.name) || "Untitled Project"}
                    </option>
                  ))}
                </select>

                <select
                  style={inputStyle}
                  value={editTaskDraft.categoryId}
                  onChange={(event) => setEditTaskDraft((previous) => ({ ...previous, categoryId: event.target.value }))}
                  disabled={!canManageCommitments || savingEditTask}
                >
                  <option value="">Uncategorized</option>
                  {commitmentCategoryOptions.map((categoryOption) => (
                    <option key={`task-edit-category-${categoryOption.value}`} value={categoryOption.value}>
                      {categoryOption.label}
                    </option>
                  ))}
                </select>

                <select
                  style={inputStyle}
                  value={editTaskDraft.parentTaskId}
                  onChange={(event) => setEditTaskDraft((previous) => ({ ...previous, parentTaskId: event.target.value }))}
                  disabled={!canManageCommitments || savingEditTask || !normalizeValue(editTaskDraft.projectId)}
                >
                  <option value="">{normalizeValue(editTaskDraft.projectId) ? "Top-level task (no parent)" : "Select a project first"}</option>
                  {editParentTaskOptions
                    .filter((parentTaskOption) => !disallowedEditParentTaskIds.has(parentTaskOption.value))
                    .map((parentTaskOption) => (
                      <option key={`task-edit-parent-${parentTaskOption.value}`} value={parentTaskOption.value}>
                        {parentTaskOption.label}
                      </option>
                    ))}
                </select>

                <select
                  style={inputStyle}
                  value={editTaskDraft.sheetLogId}
                  onChange={(event) => setEditTaskDraft((previous) => ({ ...previous, sheetLogId: event.target.value }))}
                  disabled={!canManageCommitments || savingEditTask || !normalizeValue(editTaskDraft.projectId)}
                >
                  <option value="">{normalizeValue(editTaskDraft.projectId) ? "No linked Sheet Log row" : "Select a project first"}</option>
                  {editSheetLogOptions.map((sheetLogOption) => (
                    <option key={`task-edit-sheet-log-${sheetLogOption.value}`} value={sheetLogOption.value}>
                      {sheetLogOption.label}
                    </option>
                  ))}
                </select>
                {normalizeValue(editTaskDraft.sheetLogId) && sheetLogById.get(normalizeValue(editTaskDraft.sheetLogId)) ? (
                  (() => {
                    const selectedLinkedSheetLog = sheetLogById.get(normalizeValue(editTaskDraft.sheetLogId));
                    const selectedLinkedIdentifiers = normalizeSheetLogIdentifierArray(
                      Array.isArray(selectedLinkedSheetLog?.identifiers) && selectedLinkedSheetLog.identifiers.length > 0
                        ? selectedLinkedSheetLog.identifiers
                        : selectedLinkedSheetLog?.identifier
                    );

                    return (
                      <div style={{ display: "grid", gap: "4px", padding: "8px 10px", borderRadius: "12px", background: "rgba(79, 70, 229, 0.08)", border: "1px solid rgba(99, 102, 241, 0.18)", color: "#4338CA", fontSize: "0.78rem" }}>
                        <div style={{ fontWeight: 800 }}>
                          Associated Sheet Log: {normalizeValue(selectedLinkedSheetLog?.sheetName) || normalizeValue(editTaskDraft.sheetLogId)}
                        </div>
                        {normalizeValue(selectedLinkedSheetLog?.type) ? <div>Type: {normalizeValue(selectedLinkedSheetLog?.type)}</div> : null}
                        {normalizeValue(selectedLinkedSheetLog?.revisionNumber) ? <div>Revision: {normalizeValue(selectedLinkedSheetLog?.revisionNumber)}</div> : null}
                        {selectedLinkedIdentifiers.length > 0 ? (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center", color: "#312E81", fontWeight: 800 }}>
                            <span>Identifiers:</span>
                            {selectedLinkedIdentifiers.map((identifierValue, identifierIndex) => (
                              <span
                                key={`edit-task-linked-sheet-log-identifier-${identifierIndex}`}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  padding: "3px 8px",
                                  borderRadius: "999px",
                                  background: "rgba(255, 255, 255, 0.78)",
                                  border: "1px solid rgba(99, 102, 241, 0.22)",
                                  color: "#312E81",
                                  fontWeight: 800,
                                }}
                              >
                                {identifierValue}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })()
                ) : null}

                <textarea
                  style={{ ...inputStyle, minHeight: "72px", resize: "vertical" }}
                  value={editTaskDraft.notes}
                  onChange={(event) => setEditTaskDraft((previous) => ({ ...previous, notes: event.target.value }))}
                  placeholder="Notes"
                  disabled={!canManageCommitments || savingEditTask}
                />

                <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
                  <div>
                    <label style={{ display: "block", textAlign: "left", color: "#475569", fontSize: "0.78rem", marginBottom: "4px", fontWeight: 700 }}>
                      Priority
                    </label>
                    <select
                      style={inputStyle}
                      value={editTaskDraft.priority}
                      onChange={(event) => setEditTaskDraft((previous) => ({ ...previous, priority: event.target.value }))}
                      disabled={!canManageCommitments || savingEditTask}
                    >
                      {TASK_PRIORITY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", textAlign: "left", color: "#475569", fontSize: "0.78rem", marginBottom: "4px", fontWeight: 700 }}>
                      Direction
                    </label>
                    <select
                      style={inputStyle}
                      value={editTaskDraft.direction}
                      onChange={(event) => setEditTaskDraft((previous) => ({ ...previous, direction: event.target.value }))}
                      disabled={!canManageCommitments || savingEditTask}
                    >
                      {TASK_DIRECTION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", textAlign: "left", color: "#475569", fontSize: "0.78rem", marginBottom: "4px", fontWeight: 700 }}>
                      Due Date
                    </label>
                    <input
                      type="date"
                      style={inputStyle}
                      value={editTaskDraft.dueDate}
                      onChange={(event) => setEditTaskDraft((previous) => ({ ...previous, dueDate: event.target.value }))}
                      disabled={!canManageCommitments || savingEditTask}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", textAlign: "left", color: "#475569", fontSize: "0.78rem", marginBottom: "4px", fontWeight: 700 }}>
                      Status
                    </label>
                    <select
                      style={inputStyle}
                      value={editTaskDraft.status}
                      onChange={(event) => setEditTaskDraft((previous) => ({ ...previous, status: event.target.value }))}
                      disabled={!canManageCommitments || savingEditTask}
                    >
                      <option value="open">Open</option>
                      <option value="done">Done</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", textAlign: "left", color: "#475569", fontSize: "0.78rem", marginBottom: "4px", fontWeight: 700 }}>
                      Progress % ({normalizeProgressPercent(editTaskDraft.progressPercent)}%)
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      style={inputStyle}
                      value={editTaskDraft.progressPercent}
                      onChange={(event) => setEditTaskDraft((previous) => ({ ...previous, progressPercent: event.target.value }))}
                      disabled={!canManageCommitments || savingEditTask}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                    <button
                      type="submit"
                      style={{ ...buttonStyle, background: canManageCommitments ? "#2563EB" : "#94A3B8" }}
                      disabled={!canManageCommitments || savingEditTask}
                    >
                      {savingEditTask ? "Saving..." : "Save Changes"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedEditTaskId("")}
                      style={{ ...buttonStyle, background: "#64748B" }}
                    >
                      Cancel
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDeleteTask(selectedEditTask.id)}
                    style={{
                      ...buttonStyle,
                      background: canManageCommitments ? "#DC2626" : "#94A3B8",
                    }}
                    disabled={!canManageCommitments || savingEditTask}
                  >
                    Delete
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}

      {selectedSheetLog ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(15, 23, 42, 0.5)",
            zIndex: 1250,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
          }}
        >
          <div
            style={{
              width: "min(860px, 100%)",
              maxHeight: "84vh",
              overflowY: "auto",
              background: "#FFFFFF",
              borderRadius: "12px",
              border: "1px solid #E2E8F0",
              padding: "16px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
              <div>
                <div style={{ color: "#0F172A", fontWeight: 800 }}>Edit Sheet Log</div>
                <div style={{ color: "#64748B", fontSize: "0.86rem" }}>
                  {normalizeValue(selectedSheetLog.sheetName) || normalizeValue(selectedSheetLog.projectName) || "Untitled Sheet Log"}
                </div>
                <div style={{ marginTop: "4px" }}>
                  <div style={{ color: "#475569", fontSize: "0.76rem", fontWeight: 700 }}>
                    Identifiers
                  </div>
                  <div style={{ color: "#475569", fontSize: "0.8rem", whiteSpace: "pre-wrap" }}>
                    {(normalizeSheetLogIdentifierArray(
                      Array.isArray(selectedSheetLog.identifiers) && selectedSheetLog.identifiers.length > 0
                        ? selectedSheetLog.identifiers
                        : selectedSheetLog.identifier
                    ).length > 0
                      ? normalizeSheetLogIdentifierArray(
                        Array.isArray(selectedSheetLog.identifiers) && selectedSheetLog.identifiers.length > 0
                          ? selectedSheetLog.identifiers
                          : selectedSheetLog.identifier
                      )
                      : ["-"]
                    ).join("\n")}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingSheetLogId("")}
                style={{
                  ...buttonStyle,
                  background: "#334155",
                  padding: "6px 10px",
                  fontSize: "0.82rem",
                }}
              >
                Close
              </button>
            </div>

            {editingSheetLogDraft ? (
              <form onSubmit={(event) => {
                event.preventDefault();
                handleSaveSheetLogEdit();
              }} style={{ display: "grid", gap: "10px" }}>
                <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
                  <div>
                    <label style={{ display: "block", textAlign: "left", color: "#475569", fontSize: "0.78rem", marginBottom: "4px", fontWeight: 700 }}>
                      Project
                    </label>
                    <select
                      style={inputStyle}
                      value={editingSheetLogDraft.projectId}
                      onChange={(event) => setEditingSheetLogDraft((previous) => ({ ...previous, projectId: event.target.value }))}
                      disabled={loadingProjects || projects.length === 0 || !canManageCommitments || savingSheetLogEdit}
                    >
                      <option value="">Select IglesiaTech project</option>
                      {projects.map((project) => (
                        <option key={`sheet-edit-project-${project.id}`} value={project.id}>
                          {normalizeValue(project.name) || "Untitled Project"}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: "block", textAlign: "left", color: "#475569", fontSize: "0.78rem", marginBottom: "4px", fontWeight: 700 }}>
                      Create Sheet
                    </label>
                    <select
                      style={inputStyle}
                      value={editingSheetLogDraft.shouldCreateSheet}
                      onChange={(event) => setEditingSheetLogDraft((previous) => ({ ...previous, shouldCreateSheet: event.target.value }))}
                      disabled={!canManageCommitments || savingSheetLogEdit}
                    >
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: "block", textAlign: "left", color: "#475569", fontSize: "0.78rem", marginBottom: "4px", fontWeight: 700 }}>
                      Sheet Name
                    </label>
                    <input
                      type="text"
                      style={inputStyle}
                      value={editingSheetLogDraft.sheetName}
                      onChange={(event) => setEditingSheetLogDraft((previous) => ({ ...previous, sheetName: event.target.value }))}
                      disabled={!canManageCommitments || savingSheetLogEdit}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", textAlign: "left", color: "#475569", fontSize: "0.78rem", marginBottom: "4px", fontWeight: 700 }}>
                      Identifiers
                    </label>
                    <div style={{ display: "grid", gap: "6px" }}>
                      {(editingSheetLogIdentifiers.length > 0 ? editingSheetLogIdentifiers : [""]).map((identifierValue, index) => (
                        <div key={`edit-sheet-log-identifier-${index}`} style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                          <input
                            type="text"
                            style={inputStyle}
                            value={identifierValue}
                            onChange={(event) => handleUpdateEditingSheetLogIdentifierAt(index, event.target.value)}
                            placeholder={`Identifier ${index + 1}`}
                            disabled={!canManageCommitments || savingSheetLogEdit}
                          />
                          <button
                            type="button"
                            onClick={() => handleRemoveEditingSheetLogIdentifierAt(index)}
                            style={{ ...buttonStyle, background: "#DC2626", padding: "6px 10px", fontSize: "0.78rem" }}
                            disabled={!canManageCommitments || savingSheetLogEdit}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <div>
                        <button
                          type="button"
                          onClick={handleAddEditingSheetLogIdentifier}
                          style={{ ...buttonStyle, background: canManageCommitments ? "#0F766E" : "#94A3B8", padding: "6px 10px", fontSize: "0.8rem" }}
                          disabled={!canManageCommitments || savingSheetLogEdit}
                        >
                          Add Identifier
                        </button>
                      </div>
                    </div>
                    <div style={{ color: "#64748B", fontSize: "0.74rem", marginTop: "4px" }}>
                      Add as many identifiers as needed.
                    </div>
                  </div>

                  <div>
                    <label style={{ display: "block", textAlign: "left", color: "#475569", fontSize: "0.78rem", marginBottom: "4px", fontWeight: 700 }}>
                      Type
                    </label>
                    <select
                      style={inputStyle}
                      value={editingSheetLogDraft.type}
                      onChange={(event) => setEditingSheetLogDraft((previous) => ({ ...previous, type: event.target.value }))}
                      disabled={!canManageCommitments || savingSheetLogEdit || sheetLogTypeOptions.length === 0}
                    >
                      <option value="">Select type</option>
                      {sheetLogTypeOptions.map((typeValue) => (
                        <option key={`sheet-log-edit-type-option-${typeValue}`} value={typeValue}>
                          {typeValue}
                        </option>
                      ))}
                    </select>
                    {selectedEditingSheetLogTypeDescription ? (
                      <div style={{ color: "#64748B", fontSize: "0.74rem", marginTop: "4px" }}>
                        {selectedEditingSheetLogTypeDescription}
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <label style={{ display: "block", textAlign: "left", color: "#475569", fontSize: "0.78rem", marginBottom: "4px", fontWeight: 700 }}>
                      Revision #
                    </label>
                    <input
                      type="text"
                      style={inputStyle}
                      value={editingSheetLogDraft.revisionNumber}
                      onChange={(event) => setEditingSheetLogDraft((previous) => ({ ...previous, revisionNumber: event.target.value }))}
                      disabled={!canManageCommitments || savingSheetLogEdit}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                    <button
                      type="submit"
                      style={{ ...buttonStyle, background: canManageCommitments ? "#2563EB" : "#94A3B8" }}
                      disabled={!canManageCommitments || savingSheetLogEdit}
                    >
                      {savingSheetLogEdit ? "Saving..." : "Save Changes"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingSheetLogId("")}
                      style={{ ...buttonStyle, background: "#64748B" }}
                    >
                      Cancel
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDeleteSheetLog(selectedSheetLog.id)}
                    style={{
                      ...buttonStyle,
                      background: canManageCommitments ? "#DC2626" : "#94A3B8",
                    }}
                    disabled={!canManageCommitments || savingSheetLogEdit}
                  >
                    Delete
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}

      {selectedSheetLogType ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(15, 23, 42, 0.5)",
            zIndex: 1250,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
          }}
        >
          <div
            style={{
              width: "min(720px, 100%)",
              maxHeight: "84vh",
              overflowY: "auto",
              background: "#FFFFFF",
              borderRadius: "12px",
              border: "1px solid #E2E8F0",
              padding: "16px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
              <div>
                <div style={{ color: "#0F172A", fontWeight: 800 }}>Edit Sheet Type</div>
                <div style={{ color: "#64748B", fontSize: "0.86rem" }}>
                  {normalizeValue(selectedSheetLogType.name) || "Untitled Sheet Type"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingSheetLogTypeId("")}
                style={{
                  ...buttonStyle,
                  background: "#334155",
                  padding: "6px 10px",
                  fontSize: "0.82rem",
                }}
              >
                Close
              </button>
            </div>

            <form onSubmit={(event) => {
              event.preventDefault();
              handleSaveSheetLogTypeEdit();
            }} style={{ display: "grid", gap: "10px" }}>
              <div>
                <label style={{ display: "block", textAlign: "left", color: "#475569", fontSize: "0.78rem", marginBottom: "4px", fontWeight: 700 }}>
                  Type Name
                </label>
                <input
                  type="text"
                  style={inputStyle}
                  value={editingSheetLogTypeDraft.name}
                  onChange={(event) => setEditingSheetLogTypeDraft((previous) => ({ ...previous, name: event.target.value }))}
                  disabled={!canManageCommitments || savingSheetLogType}
                />
              </div>

              <div>
                <label style={{ display: "block", textAlign: "left", color: "#475569", fontSize: "0.78rem", marginBottom: "4px", fontWeight: 700 }}>
                  Description
                </label>
                <textarea
                  style={{ ...inputStyle, minHeight: "96px", resize: "vertical" }}
                  value={editingSheetLogTypeDraft.description}
                  onChange={(event) => setEditingSheetLogTypeDraft((previous) => ({ ...previous, description: event.target.value }))}
                  disabled={!canManageCommitments || savingSheetLogType}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  <button
                    type="submit"
                    style={{ ...buttonStyle, background: canManageCommitments ? "#2563EB" : "#94A3B8" }}
                    disabled={!canManageCommitments || savingSheetLogType}
                  >
                    {savingSheetLogType ? "Saving..." : "Save Changes"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingSheetLogTypeId("")}
                    style={{ ...buttonStyle, background: "#64748B" }}
                  >
                    Cancel
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => handleDeleteSheetLogType(selectedSheetLogType.id)}
                  style={{
                    ...buttonStyle,
                    background: canManageCommitments ? "#DC2626" : "#94A3B8",
                  }}
                  disabled={!canManageCommitments || savingSheetLogType}
                >
                  Delete
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {imagePreviewAttachment?.url && isImageAttachment(imagePreviewAttachment) ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={handleCloseImagePreview}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(15, 23, 42, 0.68)",
            zIndex: 1300,
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
              borderRadius: "12px",
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
    </div>
  );
};

export default WorkProgressModule;
