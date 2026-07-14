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

const buildTaskSearchText = (task, parentTaskTitleById) => {
  const taskPriority = normalizeTaskPriority(task?.priority);
  const taskDirection = normalizeTaskDirection(task?.direction);
  const taskPriorityLabel = TASK_PRIORITY_OPTIONS.find((option) => option.value === taskPriority)?.label || "";
  const taskDirectionLabel = TASK_DIRECTION_OPTIONS.find((option) => option.value === taskDirection)?.label || "";
  const taskStatus = normalizeValue(task?.status).toLowerCase() === "done" ? "done completed" : "open active";
  const parentTaskTitle = parentTaskTitleById.get(normalizeValue(task?.parentTaskId)) || "";
  const dueDateRaw = toDateInputValue(task?.dueDate);
  const dueDateDisplay = formatDateDisplay(task?.dueDate);
  const dueDateCountdown = getDueDateCountdownMeta(task?.dueDate)?.label || "";
  const changeLogText = normalizeTaskChangeLog(task?.changeLog)
    .map((entry) => [entry.message, entry.changedByName, entry.attachment?.name].filter(Boolean).join(" "))
    .join(" ");

  return [
    normalizeValue(task?.title),
    normalizeValue(task?.description),
    normalizeValue(task?.notes),
    normalizeValue(task?.projectName),
    parentTaskTitle,
    taskPriority,
    taskPriorityLabel,
    taskDirection,
    taskDirectionLabel,
    taskStatus,
    normalizeValue(task?.assignedToName),
    normalizeValue(task?.assignedToEmail),
    normalizeValue(task?.ticketId),
    String(normalizeProgressPercent(task?.progressPercent)),
    dueDateRaw,
    dueDateDisplay,
    dueDateCountdown,
    changeLogText,
  ]
    .join(" ")
    .toLowerCase();
};

const buildSheetLogSearchText = (entry) => {
  const dueDateRaw = toDateInputValue(entry?.dueDate);
  const dueDateDisplay = formatDateDisplay(entry?.dueDate);
  const dueDateCountdown = getDueDateCountdownMeta(entry?.dueDate)?.label || "";
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
    dueDateRaw,
    dueDateDisplay,
    dueDateCountdown,
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

  const [draft, setDraft] = useState({ title: "", description: "", projectId: "", parentTaskId: "", notes: "", dueDate: "", progressPercent: "0", priority: "medium", direction: "stop_and_start" });
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
  const [sheetLogSearchTerm, setSheetLogSearchTerm] = useState("");
  const [taskCreatedSortOrder, setTaskCreatedSortOrder] = useState("manual_order");
  const [sheetLogCreatedSortOrder, setSheetLogCreatedSortOrder] = useState("newest_first");
  const [prioritySortOrder, setPrioritySortOrder] = useState("none");
  const [countdownSortOrder, setCountdownSortOrder] = useState("none");
  const [directionSortOrder, setDirectionSortOrder] = useState("none");
  const [activeSectionTab, setActiveSectionTab] = useState("commitments");
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
    dueDate: "",
    revisionNumber: "",
  });
  const [savingSheetLog, setSavingSheetLog] = useState(false);
  const [editingSheetLogId, setEditingSheetLogId] = useState("");
  const [editingSheetLogDraft, setEditingSheetLogDraft] = useState(null);
  const [savingSheetLogEdit, setSavingSheetLogEdit] = useState(false);

  const projectsRef = useMemo(() => collection(db, "churches", id, "projectListIssueProjects"), [id]);
  const commitmentsRef = useMemo(() => collection(db, "churches", id, "commitments"), [id]);
  const sheetLogsRef = useMemo(() => collection(db, "churches", id, "workProgressSheetLogs"), [id]);
  const sheetLogSettingsRef = useMemo(() => doc(db, "churches", id, "workProgressSettings", "sheetLog"), [id]);
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
  const parentTaskOptions = useMemo(() => {
    return [...tasks]
      .map((task) => ({
        value: task.id,
        label: normalizeValue(task.title) || "Untitled Task",
      }))
      .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base" }));
  }, [tasks]);
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
  const isManualTaskOrderEnabled =
    taskCreatedSortOrder === "manual_order"
    && prioritySortOrder === "none"
    && countdownSortOrder === "none"
    && directionSortOrder === "none";
  const siblingMoveMetaByTaskId = useMemo(() => {
    const byParent = new Map();
    const moveMeta = new Map();

    tasks.forEach((task) => {
      const parentTaskId = normalizeValue(task.parentTaskId);
      if (!byParent.has(parentTaskId)) {
        byParent.set(parentTaskId, []);
      }
      byParent.get(parentTaskId).push(task);
    });

    byParent.forEach((siblings) => {
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

  const displayedTasks = useMemo(() => {
    const normalizedSearch = normalizeValue(taskSearchTerm).toLowerCase();
    const filteredTasks = tasks.filter((task) => {
      const matchesProject = projectFilter === "all" || normalizeValue(task.projectId) === projectFilter;
      if (!matchesProject) return false;

      if (!normalizedSearch) return true;

      return buildTaskSearchText(task, parentTaskTitleById).includes(normalizedSearch);
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
  }, [countdownSortOrder, directionSortOrder, isManualTaskOrderEnabled, parentTaskTitleById, prioritySortOrder, projectFilter, taskCreatedSortOrder, taskSearchTerm, tasks]);

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
        if (normalizedIdentifiers.length > 0) {
          return normalizedIdentifiers.join("\n");
        }
        return normalizeValue(selectedSheetLog.identifier);
      })(),
      type: normalizeValue(selectedSheetLog.type),
      dueDate: toDateInputValue(selectedSheetLog.dueDate),
      revisionNumber: normalizeValue(selectedSheetLog.revisionNumber),
    });
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
      parentTaskId: normalizeValue(selectedEditTask.parentTaskId),
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

  const getNextTaskOrderForParent = (parentTaskId, excludedTaskId = "") => {
    const normalizedParentTaskId = normalizeValue(parentTaskId);
    const siblingOrders = tasks
      .filter(
        (task) => normalizeValue(task.parentTaskId) === normalizedParentTaskId && task.id !== excludedTaskId
      )
      .map((task) => normalizeTaskOrder(task.taskOrder));

    if (siblingOrders.length === 0) {
      return Date.now();
    }

    return Math.max(...siblingOrders) + 1000;
  };

  const handleMoveTask = async (task, direction) => {
    if (!canManageCommitments || !task?.id) return;

    if (!isManualTaskOrderEnabled) {
      toast.info("Enable Manual order and clear other sort options to reorder tasks.");
      return;
    }

    const normalizedParentTaskId = normalizeValue(task.parentTaskId);
    const orderedSiblings = tasks
      .filter((entry) => normalizeValue(entry.parentTaskId) === normalizedParentTaskId)
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

    const targetTask = orderedSiblings[targetIndex];
    if (!targetTask?.id) return;

    const currentTaskOrder = normalizeTaskOrder(task.taskOrder) || (currentIndex + 1) * 1000;
    const targetTaskOrder = normalizeTaskOrder(targetTask.taskOrder) || (targetIndex + 1) * 1000;

    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "churches", id, "commitments", task.id), {
        taskOrder: targetTaskOrder,
        updatedAt: serverTimestamp(),
      });
      batch.update(doc(db, "churches", id, "commitments", targetTask.id), {
        taskOrder: currentTaskOrder,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
    } catch (error) {
      console.error("Failed to reorder task:", error);
      toast.error("Could not reorder task.");
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
    const parentTaskId = normalizeValue(draft.parentTaskId);

    if (!title) {
      toast.warning("Task title is required.");
      return;
    }

    if (!projectId) {
      toast.warning("Select a project from IglesiaTech.");
      return;
    }

    if (parentTaskId && !tasks.some((task) => task.id === parentTaskId)) {
      toast.warning("Selected parent task no longer exists.");
      return;
    }

    const selectedProject = projects.find((project) => project.id === projectId);
    const projectName = normalizeValue(selectedProject?.name) || "Untitled Project";

    setSavingTask(true);

    try {
      await addDoc(commitmentsRef, {
        title,
        description: normalizeValue(draft.description),
        notes: normalizeValue(draft.notes),
        projectId,
        projectName,
        parentTaskId,
        taskOrder: getNextTaskOrderForParent(parentTaskId),
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
        parentTaskId: "",
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

    try {
      await updateDoc(doc(db, "churches", id, "commitments", task.id), {
        dueDate: nextDueDate,
        changeLog: nextLog,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
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
    const nextParentTaskId = normalizeValue(editTaskDraft.parentTaskId);

    if (!title) {
      toast.warning("Task title is required.");
      return;
    }

    if (!projectId) {
      toast.warning("Select a project from IglesiaTech.");
      return;
    }

    if (disallowedEditParentTaskIds.has(nextParentTaskId)) {
      toast.warning("A task cannot be assigned to itself or one of its subtasks.");
      return;
    }

    if (nextParentTaskId && !tasks.some((task) => task.id === nextParentTaskId)) {
      toast.warning("Selected parent task no longer exists.");
      return;
    }

    const selectedProject = projects.find((project) => project.id === projectId);
    const projectName = normalizeValue(selectedProject?.name) || "Untitled Project";
    const nextPriority = normalizeTaskPriority(editTaskDraft.priority);
    const nextDirection = normalizeTaskDirection(editTaskDraft.direction);
    const nextStatus = normalizeValue(editTaskDraft.status).toLowerCase() === "done" ? "done" : "open";
    const nextProgress = nextStatus === "done" ? 100 : normalizeProgressPercent(editTaskDraft.progressPercent);
    const nextDueDate = toDateInputValue(editTaskDraft.dueDate);
    const currentParentTaskId = normalizeValue(selectedEditTask.parentTaskId);
    const hasParentChanged = nextParentTaskId !== currentParentTaskId;
    const nextTaskOrder = hasParentChanged
      ? getNextTaskOrderForParent(nextParentTaskId, selectedEditTask.id)
      : (normalizeTaskOrder(selectedEditTask.taskOrder) || Date.now());

    const existingLog = normalizeTaskChangeLog(selectedEditTask.changeLog);
    const nextLog = [
      ...existingLog,
      buildTaskLogEntry(
        `Task updated${[
          title !== normalizeValue(selectedEditTask.title) ? `title: ${normalizeValue(selectedEditTask.title) || "Untitled Task"} -> ${title}` : null,
          normalizeValue(editTaskDraft.description) !== normalizeValue(selectedEditTask.description) ? "description" : null,
          projectId !== normalizeValue(selectedEditTask.projectId) ? `project: ${normalizeValue(selectedEditTask.projectName) || "Untitled Project"} -> ${projectName}` : null,
          normalizeValue(editTaskDraft.notes) !== normalizeValue(selectedEditTask.notes) ? "notes" : null,
          nextPriority !== normalizeTaskPriority(selectedEditTask.priority) ? `priority: ${normalizeTaskPriority(selectedEditTask.priority)} -> ${nextPriority}` : null,
          nextDirection !== normalizeTaskDirection(selectedEditTask.direction) ? `direction: ${normalizeTaskDirection(selectedEditTask.direction)} -> ${nextDirection}` : null,
          hasParentChanged
            ? `parent: ${parentTaskTitleById.get(currentParentTaskId) || "none"} -> ${parentTaskTitleById.get(nextParentTaskId) || "none"}`
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
        dueDate: toDateInputValue(sheetLogDraft.dueDate),
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
        dueDate: "",
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
    const identifiers = normalizeSheetLogIdentifierArray(editingSheetLogDraft.identifier);
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
        dueDate: toDateInputValue(editingSheetLogDraft.dueDate),
        revisionNumber: normalizeValue(editingSheetLogDraft.revisionNumber),
        updatedAt: serverTimestamp(),
      });

      setEditingSheetLogId("");
      toast.success("Sheet Log entry updated.");
    } catch (error) {
      console.error("Failed to update sheet log:", error);
      toast.error("Could not update Sheet Log entry.");
    } finally {
      setSavingSheetLogEdit(false);
    }
  };

  const handleUpdateEditingSheetLogIdentifierAt = (index, value) => {
    setEditingSheetLogDraft((previous) => {
      if (!previous) return previous;
      const currentIdentifiers = normalizeSheetLogIdentifierArray(previous.identifier);
      const nextIdentifiers = currentIdentifiers.length > 0 ? [...currentIdentifiers] : [""];
      nextIdentifiers[index] = value;
      return {
        ...previous,
        identifier: nextIdentifiers.join("\n"),
      };
    });
  };

  const handleAddEditingSheetLogIdentifier = () => {
    setEditingSheetLogDraft((previous) => {
      if (!previous) return previous;
      const currentIdentifiers = normalizeSheetLogIdentifierArray(previous.identifier);
      const nextIdentifiers = [...currentIdentifiers, ""];
      return {
        ...previous,
        identifier: nextIdentifiers.join("\n"),
      };
    });
  };

  const handleRemoveEditingSheetLogIdentifierAt = (index) => {
    setEditingSheetLogDraft((previous) => {
      if (!previous) return previous;
      const currentIdentifiers = normalizeSheetLogIdentifierArray(previous.identifier);
      if (currentIdentifiers.length <= 1) {
        return {
          ...previous,
          identifier: "",
        };
      }
      const nextIdentifiers = currentIdentifiers.filter((_, currentIndex) => currentIndex !== index);
      return {
        ...previous,
        identifier: nextIdentifiers.join("\n"),
      };
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

        {activeSectionTab === "sheet_log_types" ? (
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
                      Due Date
                    </label>
                    <input
                      type="date"
                      style={inputStyle}
                      value={sheetLogDraft.dueDate}
                      onChange={(event) => setSheetLogDraft((previous) => ({ ...previous, dueDate: event.target.value }))}
                      disabled={!canManageCommitments || savingSheetLog}
                    />
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
                    Track whether each project needs a sheet, plus sheet name, identifiers, type, due date, and revision.
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
                        <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Due Date</th>
                        <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Countdown</th>
                        <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Revision #</th>
                        <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Updated</th>
                        <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedSheetLogs.map((entry) => {
                        const dueDateCountdown = getDueDateCountdownMeta(entry.dueDate);

                        return (
                          <tr key={entry.id}>
                            <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155", wordBreak: "break-word" }}>
                              {normalizeValue(entry.projectName) || "Untitled Project"}
                            </td>
                            <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>
                              {entry.shouldCreateSheet ? (
                                "Yes"
                              ) : (
                                "No"
                              )}
                            </td>
                            <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>
                              {normalizeValue(entry.sheetName) || "-"}
                            </td>
                            <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>
                              {formatSheetLogIdentifiers(entry) || "-"}
                            </td>
                            <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>
                              {normalizeValue(entry.type) || "-"}
                            </td>
                            <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>
                              {formatDateDisplay(entry.dueDate)}
                            </td>
                            <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9" }}>
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
                            <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>
                              {normalizeValue(entry.revisionNumber) || "-"}
                            </td>
                            <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#64748B", fontSize: "0.8rem" }}>
                              {formatCreatedAt(entry.updatedAt || entry.createdAt)}
                            </td>
                            <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9" }}>
                              {canManageCommitments ? (
                                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
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
                          </tr>
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
              <input
                id="task-search"
                type="text"
                value={taskSearchTerm}
                onChange={(event) => setTaskSearchTerm(event.target.value)}
                placeholder="Search title, notes, status, priority, due date, logs"
                style={{ ...inputStyle, padding: "7px 8px", fontSize: "0.82rem" }}
              />
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
                value={draft.parentTaskId}
                onChange={(event) => setDraft((previous) => ({ ...previous, parentTaskId: event.target.value }))}
                disabled={!canManageCommitments || savingTask}
              >
                <option value="">Top-level task (no parent)</option>
                {parentTaskOptions.map((parentTaskOption) => (
                  <option key={`task-parent-${parentTaskOption.value}`} value={parentTaskOption.value}>
                    {parentTaskOption.label}
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
            <small style={{ color: "#475569" }}>{displayedTasks.length} shown of {tasks.length} task{tasks.length === 1 ? "" : "s"}</small>
          </div>

          {loadingTasks ? (
            <div style={{ textAlign: "left", color: "#64748B" }}>Loading tasks...</div>
          ) : tasks.length === 0 ? (
            <div style={{ textAlign: "left", color: "#64748B" }}>No tasks yet. Add your first quick task above.</div>
          ) : displayedTasks.length === 0 ? (
            <div style={{ textAlign: "left", color: "#64748B" }}>No tasks match the current filters.</div>
          ) : (
            <div style={{ width: "100%", border: "1px solid #E2E8F0", borderRadius: "10px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
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
                    <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Notes</th>
                    <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Latest Log Note</th>
                    <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Unread</th>
                    <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Added</th>
                    <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0", color: "#475569", fontSize: "0.76rem", textTransform: "uppercase" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedTasks.map((task) => {
                    const isDone = normalizeValue(task.status).toLowerCase() === "done";
                    const progressPercent = normalizeProgressPercent(task.progressPercent);
                    const taskPriority = normalizeTaskPriority(task.priority);
                    const taskPriorityMeta = TASK_PRIORITY_OPTIONS.find((option) => option.value === taskPriority) || TASK_PRIORITY_OPTIONS[1];
                    const taskDirection = normalizeTaskDirection(task.direction);
                    const taskDirectionMeta = TASK_DIRECTION_OPTIONS.find((option) => option.value === taskDirection) || TASK_DIRECTION_OPTIONS[0];
                    const dueDateInputValue = toDateInputValue(task.dueDate);
                    const dueDateCountdown = getDueDateCountdownMeta(task.dueDate);
                    const latestTaskNote = getLatestTaskNote(task);
                    const latestTaskNoteMessage = normalizeValue(latestTaskNote?.message);
                    const unreadNoteCount = getTaskUnreadNoteCount(task);
                    const taskDepth = Math.max(0, Number(task.__depth) || 0);
                    const hasParentTask = Boolean(normalizeValue(task.parentTaskId));
                    const parentTaskLabel = parentTaskTitleById.get(normalizeValue(task.parentTaskId)) || "";
                    const moveMeta = siblingMoveMetaByTaskId.get(task.id) || { index: 0, total: 1 };
                    const canMoveUp = canManageCommitments && isManualTaskOrderEnabled && moveMeta.index > 0;
                    const canMoveDown = canManageCommitments && isManualTaskOrderEnabled && moveMeta.index < moveMeta.total - 1;

                    return (
                      <tr key={task.id} style={{ background: isDone ? "#F8FAFC" : "#FFFFFF" }}>
                        <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155", wordBreak: "break-word" }}>
                          {normalizeValue(task.projectName) || "Untitled Project"}
                        </td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", wordBreak: "break-word" }}>
                          <div style={{ marginLeft: `${Math.min(taskDepth, 6) * 16}px` }}>
                            {hasParentTask ? (
                              <div style={{ color: "#64748B", fontSize: "0.74rem", fontWeight: 700, marginBottom: "2px" }}>
                                Subtask{parentTaskLabel ? ` of ${parentTaskLabel}` : ""}
                              </div>
                            ) : null}
                          <div style={{ fontWeight: 700, color: "#0F172A", textDecoration: isDone ? "line-through" : "none" }}>
                            {taskDepth > 0 ? "↳ " : ""}
                            {normalizeValue(task.title) || "Untitled Task"}
                          </div>
                          {normalizeValue(task.description) ? (
                            <div style={{ marginTop: "4px", color: "#475569", fontSize: "0.82rem", textDecoration: isDone ? "line-through" : "none" }}>
                              {normalizeValue(task.description)}
                            </div>
                          ) : null}
                          </div>
                        </td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9" }}>
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
                        <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9" }}>
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
                        <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>
                          {canManageCommitments ? (
                            <input
                              type="date"
                              defaultValue={dueDateInputValue}
                                style={{ ...inputStyle, padding: "7px 8px", fontSize: "0.82rem", width: "100%" }}
                              onBlur={(event) => handleUpdateTaskDueDate(task, event.target.value)}
                            />
                          ) : (
                            dueDateInputValue || "-"
                          )}
                        </td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9" }}>
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
                        <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9" }}>
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
                              <div style={{ color: "#64748B", fontSize: "0.74rem", marginTop: "2px" }}>
                                Drag to update progress
                              </div>
                            </div>
                          ) : null}
                        </td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9" }}>
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
                        <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                          {normalizeValue(task.notes) || "-"}
                        </td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155", fontSize: "0.8rem", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                          {latestTaskNote ? (
                            <div>
                              <div style={{ color: "#0F172A", fontWeight: 600 }}>
                                {latestTaskNoteMessage || "File attachment added"}
                              </div>
                              <div style={{ color: "#64748B", marginTop: "2px" }}>
                                {formatLogTimestamp(latestTaskNote.changedAtIso)}
                              </div>
                            </div>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9" }}>
                          <button
                            type="button"
                            onClick={() => handleOpenTaskLog(task)}
                            style={{
                              border: "none",
                              cursor: "pointer",
                              display: "inline-block",
                              minWidth: "34px",
                              textAlign: "center",
                              padding: "4px 8px",
                              borderRadius: "999px",
                              background: unreadNoteCount > 0 ? "#FEE2E2" : "#E2E8F0",
                              color: unreadNoteCount > 0 ? "#991B1B" : "#475569",
                              fontSize: "0.78rem",
                              fontWeight: 800,
                              animation: unreadNoteCount > 0 ? "workProgressUnreadBlink 1s ease-in-out infinite" : "none",
                            }}
                            title={unreadNoteCount > 0 ? `Open log (${unreadNoteCount} unread note${unreadNoteCount === 1 ? "" : "s"})` : "Open log"}
                          >
                            {unreadNoteCount}
                          </button>
                        </td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#64748B", fontSize: "0.8rem", wordBreak: "break-word" }}>
                          {formatCreatedAt(task.createdAt)}
                        </td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                            <button
                              type="button"
                              onClick={() => setSelectedEditTaskId(task.id)}
                              style={{
                                ...buttonStyle,
                                background: "#0F766E",
                                padding: "6px 10px",
                                fontSize: "0.8rem",
                              }}
                            >
                              Edit
                            </button>

                            <button
                              type="button"
                              onClick={() => handleOpenTaskLog(task)}
                              style={{
                                ...buttonStyle,
                                background: "#475569",
                                padding: "6px 10px",
                                fontSize: "0.8rem",
                              }}
                            >
                              Log
                            </button>

                            <button
                              type="button"
                              onClick={() => handleMoveTask(task, "up")}
                              style={{
                                ...buttonStyle,
                                background: canMoveUp ? "#1D4ED8" : "#94A3B8",
                                padding: "6px 10px",
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
                                background: canMoveDown ? "#1D4ED8" : "#94A3B8",
                                padding: "6px 10px",
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
                </tbody>
              </table>
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
                  value={editTaskDraft.parentTaskId}
                  onChange={(event) => setEditTaskDraft((previous) => ({ ...previous, parentTaskId: event.target.value }))}
                  disabled={!canManageCommitments || savingEditTask}
                >
                  <option value="">Top-level task (no parent)</option>
                  {parentTaskOptions
                    .filter((parentTaskOption) => !disallowedEditParentTaskIds.has(parentTaskOption.value))
                    .map((parentTaskOption) => (
                      <option key={`task-edit-parent-${parentTaskOption.value}`} value={parentTaskOption.value}>
                        {parentTaskOption.label}
                      </option>
                    ))}
                </select>

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
                      {(normalizeSheetLogIdentifierArray(editingSheetLogDraft.identifier).length > 0
                        ? normalizeSheetLogIdentifierArray(editingSheetLogDraft.identifier)
                        : [""]
                      ).map((identifierValue, index) => (
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
                      Due Date
                    </label>
                    <input
                      type="date"
                      style={inputStyle}
                      value={editingSheetLogDraft.dueDate}
                      onChange={(event) => setEditingSheetLogDraft((previous) => ({ ...previous, dueDate: event.target.value }))}
                      disabled={!canManageCommitments || savingSheetLogEdit}
                    />
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
