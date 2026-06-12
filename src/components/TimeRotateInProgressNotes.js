import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { collection, doc, getDocs, onSnapshot, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { db } from "../firebase";
import commonStyles from "../pages/commonStyles";
import TimeRotateTopLogo from "./TimeRotateTopLogo";

const ONE_HOUR_MS = 60 * 60 * 1000;

const FLOOR_PLANNER_TAB = "floorPlanner";
const FLOOR_PROGRESS_TAB = "floorProgress";
const CARD_REVIEW_TAB = "cardReview";
const NOTES_TAB = "notes";
const UNASSIGNED_FLOOR_TAB_ID = "__unassigned_cards__";
const CARD_REVIEW_UNASSIGNED_STORAGE_KEY = "unassigned_cards";
const ADD_NEW_PROGRESS_CATEGORY_OPTION = "__add_new_progress_category__";
const CARD_REVIEW_STEPS = [
  { id: "populate", label: "Populate" },
  { id: "coordinate_internal", label: "Coordinate Internal" },
  { id: "coordinate_other_trades", label: "Coordinate Other Trades" },
  { id: "existing_before", label: "Existing Modeling" },
  { id: "add_hangers", label: "Add Hangers" },
  { id: "add_hangers_with_seismic", label: "Add Hangers With Seismic" },
  { id: "shop_creation", label: "Shop Creation" },
  { id: "change_orders", label: "Change Orders" },
];
const CARD_REVIEW_STEP_IDS = new Set(CARD_REVIEW_STEPS.map((step) => step.id));
const DEFAULT_CARD_REVIEW_STEP = CARD_REVIEW_STEPS[0].id;

const ISSUE_ID_ALIASES = ["issue id", "id", "task id", "card id", "row id"];
const TITLE_ALIASES = ["title", "issue title", "task title", "name"];
const PROJECT_NAME_ALIASES = ["project name", "project", "projectname"];
const E2_STATUS_ALIASES = ["e2 status update agile", "e2statusupdateagile"];
const TECHNICAL_DIRECTION_ALIASES = [
  "technical direction",
  "tech direction",
  "technicaldirection",
  "techdirection",
];
const DATA_STAGE_ALIASES = ["data stage", "datastage"];
const TASK_DESCRIPTION_ALIASES = ["task description", "description", "task desc", "details", "scope"];
const ASSIGNED_HOURS_ALIASES = [
  "assigned hours",
  "assignedhours",
  "budget hours",
  "budgethours",
  "estimated hours",
  "estimatedhours",
  "hours budget",
  "hoursbudget",
  "hours",
];

const createId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const normalizePercentValue = (value) => {
  const numericValue = Number.parseFloat(String(value ?? "").trim());
  if (!Number.isFinite(numericValue)) return 0;
  return Math.max(0, Math.min(100, Number(numericValue.toFixed(2))));
};

const normalizeTimestampValue = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return 0;
  return Math.floor(numericValue);
};

const normalizeFloorProgressCatalog = (value) => {
  if (!Array.isArray(value)) return [];

  return value
    .map((catalogEntry) => ({
      id: normalizeValue(catalogEntry?.id) || createId("progress-catalog"),
      name: normalizeValue(catalogEntry?.name),
    }))
    .filter((catalogEntry) => catalogEntry.name)
    .sort((left, right) => left.name.localeCompare(right.name));
};

const normalizeFloorProgressLogMap = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.entries(value).reduce((projectAccumulator, [projectId, floorsValue]) => {
    const normalizedProjectId = normalizeValue(projectId);
    if (!normalizedProjectId || !floorsValue || typeof floorsValue !== "object" || Array.isArray(floorsValue)) {
      return projectAccumulator;
    }

    const normalizedFloors = Object.entries(floorsValue).reduce((floorAccumulator, [floorId, logsValue]) => {
      const normalizedFloorId = normalizeValue(floorId);
      if (!normalizedFloorId || !Array.isArray(logsValue)) return floorAccumulator;

      floorAccumulator[normalizedFloorId] = logsValue
        .map((logEntry) => ({
          id: normalizeValue(logEntry?.id) || createId("floor-progress-log"),
          timestamp: normalizeTimestampValue(logEntry?.timestamp),
          message: normalizeValue(logEntry?.message),
        }))
        .filter((logEntry) => logEntry.timestamp > 0 && logEntry.message)
        .sort((left, right) => right.timestamp - left.timestamp)
        .slice(0, 100);

      return floorAccumulator;
    }, {});

    projectAccumulator[normalizedProjectId] = normalizedFloors;
    return projectAccumulator;
  }, {});
};

const normalizeFloorProgressMap = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.entries(value).reduce((projectAccumulator, [projectId, floorsValue]) => {
    const normalizedProjectId = normalizeValue(projectId);
    if (!normalizedProjectId || !floorsValue || typeof floorsValue !== "object" || Array.isArray(floorsValue)) {
      return projectAccumulator;
    }

    const normalizedFloors = Object.entries(floorsValue).reduce((floorAccumulator, [floorId, categoriesValue]) => {
      const normalizedFloorId = normalizeValue(floorId);
      if (!normalizedFloorId || !Array.isArray(categoriesValue)) return floorAccumulator;

      const normalizedCategories = categoriesValue
        .map((categoryEntry) => ({
          id: normalizeValue(categoryEntry?.id) || createId("floor-progress"),
          catalogId: normalizeValue(categoryEntry?.catalogId),
          name: normalizeValue(categoryEntry?.name),
          percent: normalizePercentValue(categoryEntry?.percent),
          updatedAt: normalizeTimestampValue(categoryEntry?.updatedAt),
        }))
        .filter((categoryEntry) => categoryEntry.name);

      floorAccumulator[normalizedFloorId] = normalizedCategories;
      return floorAccumulator;
    }, {});

    projectAccumulator[normalizedProjectId] = normalizedFloors;
    return projectAccumulator;
  }, {});
};

const normalizeCardReviewStep = (value) => {
  const normalized = normalizeComparable(value);
  return CARD_REVIEW_STEP_IDS.has(normalized) ? normalized : DEFAULT_CARD_REVIEW_STEP;
};

const toCardReviewStorageFloorId = (value) => {
  const normalizedFloorId = normalizeValue(value);
  if (!normalizedFloorId) return "";
  if (normalizedFloorId === UNASSIGNED_FLOOR_TAB_ID) return CARD_REVIEW_UNASSIGNED_STORAGE_KEY;
  return normalizedFloorId;
};

const fromCardReviewStorageFloorId = (value) => {
  const normalizedFloorId = normalizeValue(value);
  if (!normalizedFloorId) return "";
  if (normalizedFloorId === CARD_REVIEW_UNASSIGNED_STORAGE_KEY) return UNASSIGNED_FLOOR_TAB_ID;
  return normalizedFloorId;
};

const serializeCardReviewMapForStorage = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.entries(value).reduce((projectAccumulator, [projectId, floorsValue]) => {
    const normalizedProjectId = normalizeValue(projectId);
    if (!normalizedProjectId || !floorsValue || typeof floorsValue !== "object" || Array.isArray(floorsValue)) {
      return projectAccumulator;
    }

    const normalizedFloors = Object.entries(floorsValue).reduce((floorAccumulator, [floorId, cardsValue]) => {
      const normalizedFloorId = toCardReviewStorageFloorId(floorId);
      if (!normalizedFloorId || !cardsValue || typeof cardsValue !== "object" || Array.isArray(cardsValue)) {
        return floorAccumulator;
      }

      floorAccumulator[normalizedFloorId] = cardsValue;
      return floorAccumulator;
    }, {});

    projectAccumulator[normalizedProjectId] = normalizedFloors;
    return projectAccumulator;
  }, {});
};

const normalizeCardReviewMap = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.entries(value).reduce((projectAccumulator, [projectId, floorsValue]) => {
    const normalizedProjectId = normalizeValue(projectId);
    if (!normalizedProjectId || !floorsValue || typeof floorsValue !== "object" || Array.isArray(floorsValue)) {
      return projectAccumulator;
    }

    const normalizedFloors = Object.entries(floorsValue).reduce((floorAccumulator, [floorId, cardsValue]) => {
      const normalizedFloorId = fromCardReviewStorageFloorId(floorId);
      if (!normalizedFloorId || !cardsValue || typeof cardsValue !== "object" || Array.isArray(cardsValue)) {
        return floorAccumulator;
      }

      const normalizedCards = Object.entries(cardsValue).reduce((cardAccumulator, [cardId, entryValue]) => {
        const normalizedCardId = normalizeValue(cardId);
        if (!normalizedCardId) return cardAccumulator;

        const rawStep =
          entryValue && typeof entryValue === "object" && !Array.isArray(entryValue)
            ? entryValue.step
            : entryValue;
        const normalizedStep = normalizeCardReviewStep(rawStep);
        const updatedAtRaw =
          entryValue && typeof entryValue === "object" && !Array.isArray(entryValue)
            ? entryValue.updatedAt
            : 0;

        cardAccumulator[normalizedCardId] = {
          step: normalizedStep,
          updatedAt: normalizeTimestampValue(updatedAtRaw) || Date.now(),
        };
        return cardAccumulator;
      }, {});

      floorAccumulator[normalizedFloorId] = normalizedCards;
      return floorAccumulator;
    }, {});

    projectAccumulator[normalizedProjectId] = normalizedFloors;
    return projectAccumulator;
  }, {});
};

const normalizeValue = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const normalizeComparable = (value) => normalizeValue(value).toLowerCase();

const normalizeFloorMatchKey = (value) => {
  const normalized = normalizeComparable(value)
    .replace(/\bphase\b/g, "ph")
    .replace(/[^a-z0-9]/g, "");

  return normalized;
};

const getFloorProgressCategoryKey = (value) => {
  const catalogId = normalizeComparable(value?.catalogId);
  if (catalogId) return `catalog:${catalogId}`;

  const name = normalizeComparable(value?.name);
  if (name) return `name:${name}`;

  return "";
};

const buildFloorProgressEntryDraftKey = (projectId, floorId, entryId) => {
  const normalizedProjectId = normalizeValue(projectId) || "project";
  const normalizedFloorId = normalizeValue(floorId) || "floor";
  const normalizedEntryId = normalizeValue(entryId) || "entry";
  return `${normalizedProjectId}::${normalizedFloorId}::${normalizedEntryId}`;
};

const normalizeKey = (value) =>
  normalizeValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const normalizeTagValue = (value) => normalizeValue(value).replace(/\s+/g, " ");

const getInitials = (value) => {
  const normalized = normalizeValue(value);
  if (!normalized) return "?";

  const parts = normalized.split(" ").filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
};

const parseTagsFromValue = (value) => {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => normalizeTagValue(item)).filter(Boolean)));
  }

  const normalized = normalizeValue(value);
  if (!normalized) return [];

  return Array.from(new Set(normalized.split(",").map((item) => normalizeTagValue(item)).filter(Boolean)));
};

const hasTechnicalDetailTitle = (title) => normalizeValue(title).toLowerCase().includes("technical detail");

const isCompletedPlannerStatus = (statusValue) => {
  const normalized = normalizeValue(statusValue).toLowerCase();
  if (!normalized) return false;

  return (
    normalized.includes("completed")
    || normalized.includes("approved")
    || normalized.includes("closed")
  );
};

const findFieldByAliases = (fields = [], rowData = {}, aliases = []) => {
  const normalizedAliases = aliases.map(normalizeKey);
  const candidates = [...(Array.isArray(fields) ? fields : []), ...Object.keys(rowData || {})];

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

const buildTaskIdentity = (projectDocId, issueId) => {
  const normalizedProjectDocId = normalizeValue(projectDocId) || "unknown-project";
  const normalizedIssueId = normalizeValue(issueId) || "unknown-issue";
  return `${normalizedProjectDocId}::${normalizedIssueId}`;
};

const formatTimestamp = (value) => {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
};

const formatDetailedTimestamp = (value) => {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
};

const formatDurationMs = (ms) => {
  const totalMinutes = Math.max(0, Math.floor((Number(ms) || 0) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
};

const formatRelativeDuration = (milliseconds) => {
  const totalMinutes = Math.max(0, Math.floor((Number(milliseconds) || 0) / 60000));
  if (totalMinutes < 60) {
    return `${totalMinutes}m ago`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) {
    return `${hours}h ago`;
  }

  return `${hours}h ${minutes}m ago`;
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

const TimeRotateInProgressNotes = () => {
  const { id } = useParams();
  const location = useLocation();
  const [organizationUsers, setOrganizationUsers] = useState([]);
  const [activeTimers, setActiveTimers] = useState([]);
  const [productionCards, setProductionCards] = useState([]);
  const [selectedUser, setSelectedUser] = useState("");
  const [activeTab, setActiveTab] = useState(NOTES_TAB);
  const [plannerProjects, setPlannerProjects] = useState([]);
  const [selectedPlannerProjectId, setSelectedPlannerProjectId] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [newFloorName, setNewFloorName] = useState("");
  const [selectedFloorId, setSelectedFloorId] = useState("");
  const [editingFloorId, setEditingFloorId] = useState("");
  const [editingFloorName, setEditingFloorName] = useState("");
  const [draggedCardId, setDraggedCardId] = useState("");
  const [draggedCardReview, setDraggedCardReview] = useState(null);
  const [plannerStatusMessage, setPlannerStatusMessage] = useState("");
  const [plannerDateFilter, setPlannerDateFilter] = useState("thisWeek");
  const [floorProgressMap, setFloorProgressMap] = useState({});
  const [floorProgressLogMap, setFloorProgressLogMap] = useState({});
  const [floorProgressLoaded, setFloorProgressLoaded] = useState(false);
  const [lastFloorProgressSnapshotJson, setLastFloorProgressSnapshotJson] = useState("");
  const [floorProgressDrafts, setFloorProgressDrafts] = useState({});
  const [floorProgressPercentDrafts, setFloorProgressPercentDrafts] = useState({});
  const [floorProgressStatusMessage, setFloorProgressStatusMessage] = useState("");
  const [floorProgressCatalog, setFloorProgressCatalog] = useState([]);
  const [newFloorProgressCatalogName, setNewFloorProgressCatalogName] = useState("");
  const [cardReviewMap, setCardReviewMap] = useState({});
  const [cardReviewSortBy, setCardReviewSortBy] = useState("step");
  const [cardReviewMoveTargets, setCardReviewMoveTargets] = useState({});

  const plannerDocRef = useMemo(() => {
    if (!id) return null;
    return doc(db, "churches", id, "timeRotateFloorPlanner", "state");
  }, [id]);

  const floorProgressDocRef = useMemo(() => {
    if (!id) return null;
    return doc(db, "churches", id, "timeRotateFloorPlanner", "floorCategoryProgress");
  }, [id]);

  const [timeRotateLogs, setTimeRotateLogs] = useState([]);
  const [plannerLoaded, setPlannerLoaded] = useState(false);
  const [lastPlannerSnapshotJson, setLastPlannerSnapshotJson] = useState("");
  // cardBudgets: { [issueId]: { assignedHours: number } } — stored in Firestore
  const [cardBudgets, setCardBudgets] = useState({});
  const [lastBudgetsSnapshotJson, setLastBudgetsSnapshotJson] = useState("");
  const [budgetsLoaded, setBudgetsLoaded] = useState(false);
  const [editingBudgetCardId, setEditingBudgetCardId] = useState("");
  const [editingBudgetValue, setEditingBudgetValue] = useState("");

  const routePrefix =
    typeof window !== "undefined" && window.location?.pathname?.includes("/church/")
      ? "/church"
      : "/organization";

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search || "");
    const view = normalizeValue(searchParams.get("view")).toLowerCase();

    if (view === "floor-planner") {
      setActiveTab(FLOOR_PLANNER_TAB);
      return;
    }

    if (view === "floor-progress") {
      setActiveTab(FLOOR_PROGRESS_TAB);
      return;
    }

    if (view === "card-review") {
      setActiveTab(CARD_REVIEW_TAB);
      return;
    }

    if (view === "notes-attention") {
      setActiveTab(NOTES_TAB);
    }
  }, [location.search]);

  useEffect(() => {
    if (!id) return () => {};

    const usersQuery = query(collection(db, "users"), where("churchId", "==", id));
    const unsubscribe = onSnapshot(usersQuery, (snapshot) => {
      const nextUsers = snapshot.docs
        .map((snapshotDoc) => {
          const data = snapshotDoc.data() || {};
          const firstName = normalizeValue(data.firstName || data.name);
          const lastName = normalizeValue(data.lastName);
          const email = normalizeValue(data.email);
          const displayName = normalizeValue(data.displayName);
          const avatarUrl = normalizeValue(
            data.photoURL
            || data.photoUrl
            || data.profileImage
            || data.profileImageUrl
            || data.profilePicture
            || data.avatar
            || data.avatarUrl
          );
          const fullName = normalizeValue([firstName, lastName].filter(Boolean).join(" "));
          const label = fullName || displayName || email || `User ${snapshotDoc.id}`;

          return {
            userId: snapshotDoc.id,
            label,
            email,
            avatarUrl,
            aliases: Array.from(
              new Set([
                snapshotDoc.id,
                email,
                fullName,
                displayName,
                normalizeValue(data.name),
                normalizeValue(data.firstName),
                normalizeValue(data.lastName),
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
      setProductionCards([]);
      return () => {};
    }

    const projectsRef = collection(db, "churches", id, "bimProjects");

    const unsubscribe = onSnapshot(
      projectsRef,
      async (snapshot) => {
        const nextCardsByIdentity = new Map();

        const toCardFromRowData = ({
          rowData,
          rowIndex,
          rowNumber,
          projectDocId,
          fallbackProjectName,
          fields,
        }) => {
          const dataStageField = findFieldByAliases(fields, rowData, DATA_STAGE_ALIASES) || "Data Stage";
          const dataStage = normalizeValue(rowData[dataStageField]);
          if (dataStage.toLowerCase() !== "production") return null;

          const issueIdField = findFieldByAliases(fields, rowData, ISSUE_ID_ALIASES);
          const titleField = findFieldByAliases(fields, rowData, TITLE_ALIASES);
          const projectNameField = findFieldByAliases(fields, rowData, PROJECT_NAME_ALIASES);
          const statusField = findFieldByAliases(fields, rowData, E2_STATUS_ALIASES) || "E2 Status Update Agile";
          const technicalDirectionField =
            findFieldByAliases(fields, rowData, TECHNICAL_DIRECTION_ALIASES) || "Technical Direction";
          const taskDescriptionField = findFieldByAliases(fields, rowData, TASK_DESCRIPTION_ALIASES);
          const assignedHoursField = findFieldByAliases(fields, rowData, ASSIGNED_HOURS_ALIASES);

          const issueId = normalizeValue(issueIdField ? rowData[issueIdField] : "") || String(rowNumber || rowIndex + 1);
          const taskIdentity = buildTaskIdentity(projectDocId, issueId);
          const assignedHoursRaw = assignedHoursField ? normalizeValue(rowData[assignedHoursField]) : "";
          const assignedHours = parseFloat(assignedHoursRaw) || 0;

          const resolvedTitle =
            normalizeValue(titleField ? rowData[titleField] : "")
            || normalizeValue(rowData.Title)
            || normalizeValue(rowData.title)
            || `Card ${issueId}`;

          const resolvedProjectName =
            normalizeValue(projectNameField ? rowData[projectNameField] : "")
            || normalizeValue(rowData["Project Name"])
            || normalizeValue(rowData.projectName)
            || fallbackProjectName;

          const resolvedStatusAgile =
            normalizeValue(statusField ? rowData[statusField] : "")
            || normalizeValue(rowData["E2 Status Update Agile"])
            || normalizeValue(rowData.status)
            || "Unknown";

          const resolvedTechnicalDirection =
            normalizeValue(technicalDirectionField ? rowData[technicalDirectionField] : "")
            || normalizeValue(rowData["Technical Direction"])
            || "";

          return {
            id: taskIdentity,
            issueId,
            title: resolvedTitle,
            projectName: resolvedProjectName,
            statusAgile: resolvedStatusAgile,
            technicalDirection: resolvedTechnicalDirection,
            taskTags: parseTagsFromValue(taskDescriptionField ? rowData[taskDescriptionField] : ""),
            assignedHours,
          };
        };

        for (const projectDoc of snapshot.docs) {
          const projectData = projectDoc.data() || {};
          const fields = Array.isArray(projectData.fields) ? projectData.fields : [];
          const rows = Array.isArray(projectData.rows) ? projectData.rows : [];
          const fallbackProjectName =
            normalizeValue(projectData.projectName)
            || normalizeValue(projectData.name)
            || `Project ${projectDoc.id}`;

          rows.forEach((row, rowIndex) => {
            const parsedCard = toCardFromRowData({
              rowData: row?.rowData || {},
              rowIndex,
              rowNumber: row?.rowNumber,
              projectDocId: projectDoc.id,
              fallbackProjectName,
              fields,
            });
            if (!parsedCard) return;
            nextCardsByIdentity.set(parsedCard.id, parsedCard);
          });

          const issuesRef = collection(db, "churches", id, "bimProjects", projectDoc.id, "issues");
          const issuesSnap = await getDocs(issuesRef);
          issuesSnap.docs.forEach((issueDoc, rowIndex) => {
            const parsedCard = toCardFromRowData({
              rowData: issueDoc.data() || {},
              rowIndex,
              rowNumber: null,
              projectDocId: projectDoc.id,
              fallbackProjectName,
              fields,
            });
            if (!parsedCard) return;
            nextCardsByIdentity.set(parsedCard.id, parsedCard);
          });
        }

        const nextCards = Array.from(nextCardsByIdentity.values())
          .sort((left, right) => left.issueId.localeCompare(right.issueId, undefined, { numeric: true, sensitivity: "base" }));
        setProductionCards(nextCards);
      },
      (snapshotError) => {
        console.error("Error loading TimeRotate production cards for planner:", snapshotError);
        setProductionCards([]);
      }
    );

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
            cardId: normalizeValue(data.cardKey) || normalizeValue(data.issueId) || snapshotDoc.id,
            issueId: normalizeValue(data.issueId),
            projectName: normalizeValue(data.projectName),
            registeredBy: normalizeValue(data.registeredBy),
            userId: normalizeValue(data.userId),
            userEmail: normalizeValue(data.userEmail),
            ownerKey: normalizeValue(data.ownerKey),
            statusAgile: normalizeValue(data.statusAgile),
            technicalDirection: normalizeValue(data.technicalDirection),
            taskTags: Array.isArray(data.taskTags)
              ? data.taskTags.map((tag) => normalizeValue(tag)).filter(Boolean)
              : [],
            startedAt: Number(data.startedAt) || 0,
            notes: Array.isArray(data.notes)
              ? data.notes
                  .map((note) => ({
                    text: normalizeValue(note?.text),
                    timestamp: Number(note?.timestamp) || 0,
                  }))
                  .filter((note) => note.text)
              : [],
          };
        })
        .filter((entry) => entry.startedAt > 0)
        .sort((left, right) => right.startedAt - left.startedAt);

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
          issueId: normalizeValue(data.issueId),
          projectName: normalizeValue(data.projectName),
          durationMs: Number(data.durationMs) || 0,
          startedAt: Number(data.startedAt || data.createdAt || data.timestamp || 0) || 0,
          endedAt: Number(data.endedAt || 0) || 0,
        };
      });
      setTimeRotateLogs(nextLogs);
    });

    return () => unsubscribe();
  }, [id]);

  // ── cardBudgets: load from Firestore ──────────────────────────────
  const budgetsDocRef = useMemo(() => {
    if (!id) return null;
    return doc(db, "churches", id, "timeRotateFloorPlanner", "cardBudgets");
  }, [id]);

  useEffect(() => {
    if (!budgetsDocRef) return () => {};
    const unsubscribe = onSnapshot(budgetsDocRef, (snapshot) => {
      const data = snapshot.data() || {};
      const budgets = data.budgets || {};
      const nextJson = JSON.stringify(budgets);
      setLastBudgetsSnapshotJson(nextJson);
      setCardBudgets(budgets);
      setBudgetsLoaded(true);
    });
    return () => unsubscribe();
  }, [budgetsDocRef]);

  // ── cardBudgets: save to Firestore when changed ──────────────────────
  useEffect(() => {
    if (!budgetsLoaded || !budgetsDocRef) return;
    const currentJson = JSON.stringify(cardBudgets);
    if (currentJson === lastBudgetsSnapshotJson) return;
    setDoc(budgetsDocRef, { budgets: cardBudgets, updatedAt: serverTimestamp() }, { merge: true })
      .catch((err) => console.error("Error saving card budgets:", err));
  }, [budgetsDocRef, budgetsLoaded, cardBudgets, lastBudgetsSnapshotJson]);

  useEffect(() => {
    if (!plannerDocRef) return () => {};

    const unsubscribe = onSnapshot(plannerDocRef, (snapshot) => {
      const data = snapshot.data() || {};
      const nextProjects = Array.isArray(data.projects)
        ? data.projects.map((project) => ({
            id: normalizeValue(project?.id) || createId("project"),
            name: normalizeValue(project?.name) || "Untitled Project",
            floors: Array.isArray(project?.floors)
              ? project.floors.map((floor) => ({
                  id: normalizeValue(floor?.id) || createId("floor"),
                  name: normalizeValue(floor?.name) || "Untitled Floor",
                  cardIds: Array.isArray(floor?.cardIds)
                    ? floor.cardIds.map((cardId) => normalizeValue(cardId)).filter(Boolean)
                    : [],
                }))
              : [],
          }))
        : [];

      const nextJson = JSON.stringify(nextProjects);
      setLastPlannerSnapshotJson(nextJson);
      setPlannerProjects(nextProjects);
      setPlannerLoaded(true);
    });

    return () => unsubscribe();
  }, [plannerDocRef]);

  useEffect(() => {
    if (!plannerLoaded || !plannerDocRef) return;

    const currentJson = JSON.stringify(plannerProjects);
    if (currentJson === lastPlannerSnapshotJson) return;

    setDoc(
      plannerDocRef,
      {
        projects: plannerProjects,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    ).catch((error) => {
      console.error("Error saving floor planner data:", error);
      setPlannerStatusMessage("Could not save floor planner changes right now.");
    });
  }, [plannerDocRef, plannerLoaded, plannerProjects, lastPlannerSnapshotJson]);

  useEffect(() => {
    if (!floorProgressDocRef) return () => {};

    const unsubscribe = onSnapshot(floorProgressDocRef, (snapshot) => {
      const data = snapshot.data() || {};
      const nextFloorProgressMap = normalizeFloorProgressMap(data.projects);
      const nextCatalog = normalizeFloorProgressCatalog(data.catalog);
      const nextLogMap = normalizeFloorProgressLogMap(data.logs);
      const nextCardReviewMap = normalizeCardReviewMap(data.cardReview);
      const nextJson = JSON.stringify({
        projects: nextFloorProgressMap,
        catalog: nextCatalog,
        logs: nextLogMap,
        cardReview: nextCardReviewMap,
      });

      setLastFloorProgressSnapshotJson(nextJson);
      setFloorProgressMap(nextFloorProgressMap);
      setFloorProgressLogMap(nextLogMap);
      setFloorProgressCatalog(nextCatalog);
      setCardReviewMap(nextCardReviewMap);
      setFloorProgressLoaded(true);
    });

    return () => unsubscribe();
  }, [floorProgressDocRef]);

  useEffect(() => {
    if (!floorProgressLoaded || !floorProgressDocRef) return;

    const currentJson = JSON.stringify({
      projects: floorProgressMap,
      catalog: floorProgressCatalog,
      logs: floorProgressLogMap,
      cardReview: cardReviewMap,
    });
    if (currentJson === lastFloorProgressSnapshotJson) return;

    setDoc(
      floorProgressDocRef,
      {
        projects: floorProgressMap,
        catalog: floorProgressCatalog,
        logs: floorProgressLogMap,
        cardReview: serializeCardReviewMapForStorage(cardReviewMap),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    ).catch((error) => {
      console.error("Error saving floor progress data:", error);
      setFloorProgressStatusMessage("Could not save floor progress changes right now.");
    });
  }, [
    cardReviewMap,
    floorProgressCatalog,
    floorProgressDocRef,
    floorProgressLoaded,
    floorProgressLogMap,
    floorProgressMap,
    lastFloorProgressSnapshotJson,
  ]);

  useEffect(() => {
    if (!selectedPlannerProjectId && plannerProjects.length > 0) {
      setSelectedPlannerProjectId(plannerProjects[0].id);
      return;
    }

    if (selectedPlannerProjectId && !plannerProjects.some((project) => project.id === selectedPlannerProjectId)) {
      setSelectedPlannerProjectId(plannerProjects[0]?.id || "");
    }
  }, [plannerProjects, selectedPlannerProjectId]);

  const getOrganizationUserMatch = (entry) => {
    const entryUserId = normalizeValue(entry?.userId);
    const byUserId = organizationUsers.find((userEntry) => normalizeValue(userEntry.userId) === entryUserId);
    if (byUserId) return byUserId;

    const entryEmail = normalizeComparable(entry?.userEmail);
    const byEmail = organizationUsers.find(
      (userEntry) => normalizeComparable(userEntry.email) && normalizeComparable(userEntry.email) === entryEmail
    );
    if (byEmail) return byEmail;

    const registeredBy = normalizeComparable(entry?.registeredBy);
    const ownerKey = normalizeComparable(entry?.ownerKey);
    if (!registeredBy && !ownerKey) return null;

    return (
      organizationUsers.find((userEntry) =>
        Array.isArray(userEntry.aliases)
          ? userEntry.aliases.some((alias) => {
              const normalizedAlias = normalizeComparable(alias);
              return (registeredBy && normalizedAlias === registeredBy) || (ownerKey && normalizedAlias === ownerKey);
            })
          : false
      ) || null
    );
  };

  const getTimerUserKey = (timerEntry, matchedUser = null) => {
    return (
      normalizeValue(matchedUser?.userId) ||
      normalizeValue(timerEntry?.userId) ||
      normalizeComparable(timerEntry?.userEmail) ||
      normalizeComparable(timerEntry?.ownerKey) ||
      normalizeComparable(timerEntry?.registeredBy) ||
      normalizeValue(timerEntry?.id)
    );
  };

  const inferredTimerUsers = useMemo(() => {
    const inferredMap = new Map();

    activeTimers.forEach((timerEntry) => {
      const matchedUser = getOrganizationUserMatch(timerEntry);
      if (matchedUser) return;

      const inferredUserKey = getTimerUserKey(timerEntry, null);
      if (!inferredUserKey || inferredMap.has(inferredUserKey)) return;

      const inferredEmail = normalizeValue(timerEntry?.userEmail);
      const inferredLabel =
        normalizeValue(timerEntry?.registeredBy) ||
        inferredEmail ||
        normalizeValue(timerEntry?.userId) ||
        "Unknown user";

      inferredMap.set(inferredUserKey, {
        userId: inferredUserKey,
        label: inferredLabel,
        email: inferredEmail,
        avatarUrl: "",
        aliases: Array.from(
          new Set(
            [
              inferredUserKey,
              normalizeValue(timerEntry?.userId),
              inferredEmail,
              normalizeValue(timerEntry?.registeredBy),
              normalizeValue(timerEntry?.ownerKey),
            ].filter(Boolean)
          )
        ),
      });
    });

    return Array.from(inferredMap.values()).sort((left, right) => left.label.localeCompare(right.label));
  }, [activeTimers, organizationUsers]);

  const allAttentionUsers = useMemo(() => {
    const combinedMap = new Map();

    organizationUsers.forEach((userEntry) => {
      const userKey = normalizeValue(userEntry.userId);
      if (!userKey) return;
      combinedMap.set(userKey, userEntry);
    });

    inferredTimerUsers.forEach((userEntry) => {
      const userKey = normalizeValue(userEntry.userId);
      if (!userKey || combinedMap.has(userKey)) return;
      combinedMap.set(userKey, userEntry);
    });

    return Array.from(combinedMap.values()).sort((left, right) => left.label.localeCompare(right.label));
  }, [organizationUsers, inferredTimerUsers]);

  const userOptions = useMemo(() => {
    return allAttentionUsers.map((entry) => ({ value: entry.userId, label: entry.label }));
  }, [allAttentionUsers]);

  useEffect(() => {
    if (!selectedUser) return;

    const isStillValidSelection = userOptions.some((option) => option.value === selectedUser);
    if (!isStillValidSelection) {
      setSelectedUser("");
    }
  }, [selectedUser, userOptions]);

  const visibleActiveTimers = useMemo(() => {
    if (!selectedUser) return activeTimers;

    return activeTimers.filter((entry) => {
      const matchedUser = getOrganizationUserMatch(entry);
      const userKey = getTimerUserKey(entry, matchedUser);
      return userKey === selectedUser;
    });
  }, [activeTimers, selectedUser, organizationUsers]);

  const inProgressMessages = useMemo(() => {
    const messages = [];

    visibleActiveTimers.forEach((timerEntry) => {
      const matchedUser = getOrganizationUserMatch(timerEntry);
      const sender = normalizeValue(matchedUser?.label) || normalizeValue(timerEntry.registeredBy) || "Unknown user";
      const timerNotes = Array.isArray(timerEntry.notes) ? timerEntry.notes : [];

      if (timerNotes.length === 0) {
        messages.push({
          id: `${timerEntry.id}-no-notes`,
          sender,
          issueId: timerEntry.issueId,
          projectName: timerEntry.projectName,
          text: "No notes logged yet",
          timestamp: Number(timerEntry.startedAt) || 0,
        });
        return;
      }

      timerNotes.forEach((note, noteIndex) => {
        messages.push({
          id: `${timerEntry.id}-${note.timestamp}-${noteIndex}`,
          sender,
          issueId: timerEntry.issueId,
          projectName: timerEntry.projectName,
          text: note.text,
          timestamp: Number(note.timestamp) || 0,
        });
      });
    });

    return messages.sort((left, right) => {
      if (left.timestamp !== right.timestamp) {
        return right.timestamp - left.timestamp;
      }
      return left.id.localeCompare(right.id);
    });
  }, [visibleActiveTimers, organizationUsers]);

  const attentionRows = useMemo(() => {
    const now = Date.now();

    const rows = allAttentionUsers.map((organizationUser) => {
      const userTimers = activeTimers.filter((timerEntry) => {
        const matchedUser = getOrganizationUserMatch(timerEntry);
        const userKey = getTimerUserKey(timerEntry, matchedUser);
        return userKey === normalizeValue(organizationUser.userId);
      });

      const latestStart = userTimers.reduce((maxValue, timerEntry) => {
        const startedAt = Number(timerEntry.startedAt) || 0;
        return startedAt > maxValue ? startedAt : maxValue;
      }, 0);

      const latestNoteAt = userTimers.reduce((maxValue, timerEntry) => {
        const notes = Array.isArray(timerEntry.notes) ? timerEntry.notes : [];
        const timerLatest = notes.reduce((timerMax, note) => {
          const noteTimestamp = Number(note.timestamp) || 0;
          return noteTimestamp > timerMax ? noteTimestamp : timerMax;
        }, 0);
        return timerLatest > maxValue ? timerLatest : maxValue;
      }, 0);

      const hasActiveTimer = userTimers.length > 0;
      const noteIsStale = hasActiveTimer && latestNoteAt > 0 ? now - latestNoteAt > ONE_HOUR_MS : false;
      const noNotesLogged = hasActiveTimer && !latestNoteAt;
      const notStartedTime = !hasActiveTimer;
      const needsAttention = notStartedTime || noNotesLogged || noteIsStale;

      let timeStatus = "Started";
      if (notStartedTime) {
        timeStatus = "Not started";
      }

      let notesStatus = "Up to date";
      if (notStartedTime) {
        notesStatus = "No notes";
      } else if (noNotesLogged) {
        notesStatus = "No notes logged";
      } else if (noteIsStale) {
        notesStatus = `No recent notes (${formatRelativeDuration(now - latestNoteAt)})`;
      }

      let reason = "On track";
      if (notStartedTime) {
        reason = "Has not started time";
      } else if (noNotesLogged) {
        reason = "Started time but has not logged notes";
      } else if (noteIsStale) {
        reason = "Needs a fresh note update";
      }

      return {
        userId: organizationUser.userId,
        label: organizationUser.label,
        hasActiveTimer,
        notStartedTime,
        noNotesLogged,
        noteIsStale,
        timeStatus,
        notesStatus,
        latestStart,
        latestNoteAt,
        reason,
        needsAttention,
      };
    });

    return rows
      .filter((row) => row.needsAttention)
      .filter((row) => !selectedUser || row.userId === selectedUser)
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [activeTimers, allAttentionUsers, organizationUsers, selectedUser]);

  const attentionSummary = useMemo(() => {
    return attentionRows.reduce(
      (summary, row) => {
        if (row.notStartedTime) summary.notStartedTime += 1;
        if (row.noNotesLogged) summary.noNotesLogged += 1;
        if (row.noteIsStale) summary.staleNotes += 1;
        return summary;
      },
      { notStartedTime: 0, noNotesLogged: 0, staleNotes: 0 }
    );
  }, [attentionRows]);

  const attentionSections = useMemo(() => {
    return {
      notStartedTime: attentionRows.filter((row) => row.notStartedTime),
      noNotesLogged: attentionRows.filter((row) => row.noNotesLogged),
      staleNotes: attentionRows.filter((row) => row.noteIsStale),
    };
  }, [attentionRows]);

  const plannerDateFilterRange = useMemo(() => {
    const now = new Date();
    const startOfDay = (d) => { const c = new Date(d); c.setHours(0, 0, 0, 0); return c.getTime(); };
    const endOfDay = (d) => { const c = new Date(d); c.setHours(23, 59, 59, 999); return c.getTime(); };
    if (plannerDateFilter === "today") return { startMs: startOfDay(now), endMs: endOfDay(now) };
    if (plannerDateFilter === "yesterday") {
      const d = new Date(now); d.setDate(d.getDate() - 1);
      return { startMs: startOfDay(d), endMs: endOfDay(d) };
    }
    if (plannerDateFilter === "thisWeek") {
      const d = new Date(now); d.setDate(d.getDate() - d.getDay());
      return { startMs: startOfDay(d), endMs: endOfDay(now) };
    }
    if (plannerDateFilter === "lastWeek") {
      const startThis = new Date(now); startThis.setDate(now.getDate() - now.getDay());
      const startLast = new Date(startThis); startLast.setDate(startThis.getDate() - 7);
      return { startMs: startOfDay(startLast), endMs: startOfDay(startThis) - 1 };
    }
    if (plannerDateFilter === "lastMonth") {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 1).getTime() - 1;
      return { startMs: s.getTime(), endMs: e };
    }
    return null;
  }, [plannerDateFilter]);

  const plannerTimers = useMemo(() => {
    if (!plannerDateFilterRange) return activeTimers;
    return activeTimers.filter((entry) => {
      const t = Number(entry.startedAt) || 0;
      return t >= plannerDateFilterRange.startMs && t <= plannerDateFilterRange.endMs;
    });
  }, [activeTimers, plannerDateFilterRange]);

  const plannerLogs = useMemo(() => {
    if (!plannerDateFilterRange) return timeRotateLogs;
    return timeRotateLogs.filter((log) => {
      const t = Number(log.startedAt) || 0;
      if (!t) return false;
      return t >= plannerDateFilterRange.startMs && t <= plannerDateFilterRange.endMs;
    });
  }, [timeRotateLogs, plannerDateFilterRange]);

  const hoursPerIssue = useMemo(() => {
    const map = new Map();
    plannerLogs.forEach((log) => {
      const issueId = normalizeValue(log.issueId);
      if (!issueId) return;
      map.set(issueId, (map.get(issueId) || 0) + log.durationMs);
    });
    return map;
  }, [plannerLogs]);

  const resolvedProjectNameByIssue = useMemo(() => {
    const projectNameByIssue = new Map();
    const timestampByIssue = new Map();

    const pushProjectName = (issueIdValue, projectNameValue, timestampValue) => {
      const normalizedIssueId = normalizeValue(issueIdValue);
      const normalizedProjectName = normalizeValue(projectNameValue);
      const numericTimestamp = Number(timestampValue) || 0;
      if (!normalizedIssueId || !normalizedProjectName) return;

      const previousTimestamp = Number(timestampByIssue.get(normalizedIssueId)) || 0;
      if (numericTimestamp >= previousTimestamp) {
        timestampByIssue.set(normalizedIssueId, numericTimestamp);
        projectNameByIssue.set(normalizedIssueId, normalizedProjectName);
      }
    };

    timeRotateLogs.forEach((logEntry) => {
      pushProjectName(
        logEntry?.issueId,
        logEntry?.projectName,
        Number(logEntry?.endedAt) || Number(logEntry?.startedAt) || 0
      );
    });

    activeTimers.forEach((timerEntry) => {
      pushProjectName(
        timerEntry?.issueId,
        timerEntry?.projectName,
        Number(timerEntry?.startedAt) || Date.now()
      );
    });

    return projectNameByIssue;
  }, [activeTimers, timeRotateLogs]);

  const plannerCards = useMemo(() => {
    const inProgressByCardKey = new Map();
    const latestNoteByCardKey = new Map();

    const setLatestNoteForKey = (candidateKey, noteText, noteTimestamp) => {
      const normalizedKey = normalizeValue(candidateKey);
      const normalizedNoteText = normalizeValue(noteText);
      const numericTimestamp = Number(noteTimestamp) || 0;
      if (!normalizedKey || !normalizedNoteText) return;

      const existing = latestNoteByCardKey.get(normalizedKey);
      if (!existing || numericTimestamp >= existing.timestamp) {
        latestNoteByCardKey.set(normalizedKey, {
          text: normalizedNoteText,
          timestamp: numericTimestamp,
        });
      }
    };

    plannerTimers.forEach((timerEntry) => {
      const matchedUser = getOrganizationUserMatch(timerEntry);
      const inProgressUser = normalizeValue(matchedUser?.label) || normalizeValue(timerEntry.registeredBy) || "Unassigned";
      const inProgressAvatar = normalizeValue(matchedUser?.avatarUrl);
      const timerIssueId = normalizeValue(timerEntry.issueId);
      const timerCardId = normalizeValue(timerEntry.cardId);

      const keyCandidates = Array.from(new Set([timerCardId, timerIssueId].filter(Boolean)));
      keyCandidates.forEach((candidateKey) => {
        if (!inProgressByCardKey.has(candidateKey)) {
          inProgressByCardKey.set(candidateKey, new Map());
        }
        const usersMap = inProgressByCardKey.get(candidateKey);
        if (!usersMap.has(inProgressUser)) {
          usersMap.set(inProgressUser, inProgressAvatar);
        } else if (!usersMap.get(inProgressUser) && inProgressAvatar) {
          usersMap.set(inProgressUser, inProgressAvatar);
        }
      });

      const timerNotes = Array.isArray(timerEntry.notes) ? timerEntry.notes : [];
      timerNotes.forEach((note) => {
        const noteText = normalizeValue(note?.text);
        const noteTimestamp = Number(note?.timestamp) || 0;
        keyCandidates.forEach((candidateKey) => {
          setLatestNoteForKey(candidateKey, noteText, noteTimestamp);
        });
      });
    });

    return productionCards
      .filter((card) => !isCompletedPlannerStatus(card.statusAgile))
      .map((card) => {
      const keyById = normalizeValue(card.id);
      const keyByIssue = normalizeValue(card.issueId);
      const usersFromId = inProgressByCardKey.get(keyById) || new Map();
      const usersFromIssue = inProgressByCardKey.get(keyByIssue) || new Map();
      const mergedUsersMap = new Map([...usersFromIssue.entries(), ...usersFromId.entries()]);
      const mergedUsers = Array.from(mergedUsersMap.keys()).sort((a, b) => a.localeCompare(b));
      const mergedUserDetails = mergedUsers.map((name) => ({
        name,
        avatarUrl: normalizeValue(mergedUsersMap.get(name)),
      }));
      const latestNoteById = latestNoteByCardKey.get(keyById);
      const latestNoteByIssue = latestNoteByCardKey.get(keyByIssue);
      const latestNoteEntry = !latestNoteById
        ? latestNoteByIssue
        : !latestNoteByIssue
          ? latestNoteById
          : (latestNoteById.timestamp >= latestNoteByIssue.timestamp ? latestNoteById : latestNoteByIssue);

      const resolvedProjectName = normalizeValue(resolvedProjectNameByIssue.get(keyByIssue)) || normalizeValue(card.projectName);

      return {
        ...card,
        projectName: resolvedProjectName,
        inProgressUsers: mergedUsers,
        inProgressUserDetails: mergedUserDetails,
        latestNote: normalizeValue(latestNoteEntry?.text),
      };
    });
  }, [plannerTimers, productionCards, organizationUsers, resolvedProjectNameByIssue]);

  const cardReviewLiveMetaMap = useMemo(() => {
    const map = new Map();

    plannerCards.forEach((card) => {
      const cardId = normalizeValue(card.id);
      const issueId = normalizeValue(card.issueId);
      const meta = {
        inProgressUsers: Array.isArray(card.inProgressUsers) ? card.inProgressUsers : [],
        inProgressUserDetails: Array.isArray(card.inProgressUserDetails) ? card.inProgressUserDetails : [],
        latestNote: normalizeValue(card.latestNote),
      };

      if (cardId && !map.has(cardId)) map.set(cardId, meta);
      if (issueId && !map.has(issueId)) map.set(issueId, meta);
    });

    return map;
  }, [plannerCards]);

  const cardReviewSourceCards = useMemo(() => {
    return productionCards.map((card) => {
      const issueId = normalizeValue(card.issueId);
      const cardId = normalizeValue(card.id);
      const liveMeta = cardReviewLiveMetaMap.get(issueId) || cardReviewLiveMetaMap.get(cardId) || null;
      const resolvedProjectName = normalizeValue(resolvedProjectNameByIssue.get(issueId)) || normalizeValue(card.projectName);
      return {
        ...card,
        projectName: resolvedProjectName,
        inProgressUsers: Array.isArray(liveMeta?.inProgressUsers) ? liveMeta.inProgressUsers : [],
        inProgressUserDetails: Array.isArray(liveMeta?.inProgressUserDetails) ? liveMeta.inProgressUserDetails : [],
        latestNote: normalizeValue(liveMeta?.latestNote),
      };
    });
  }, [cardReviewLiveMetaMap, productionCards, resolvedProjectNameByIssue]);

  const cardReviewCardMap = useMemo(() => {
    const map = new Map();
    cardReviewSourceCards.forEach((card) => {
      const cardId = normalizeValue(card.id);
      const issueId = normalizeValue(card.issueId);
      if (cardId) map.set(cardId, card);
      if (issueId && !map.has(issueId)) map.set(issueId, card);
    });
    return map;
  }, [cardReviewSourceCards]);

  const selectedPlannerProject = useMemo(() => {
    return plannerProjects.find((project) => project.id === selectedPlannerProjectId) || null;
  }, [plannerProjects, selectedPlannerProjectId]);

  useEffect(() => {
    if (!selectedPlannerProject) {
      setSelectedFloorId("");
      return;
    }

    const floors = Array.isArray(selectedPlannerProject.floors) ? selectedPlannerProject.floors : [];
    if (selectedFloorId === UNASSIGNED_FLOOR_TAB_ID) {
      return;
    }

    if (!selectedFloorId || !floors.some((floor) => floor.id === selectedFloorId)) {
      setSelectedFloorId(floors[0]?.id || "");
    }
  }, [selectedPlannerProject, selectedFloorId]);

  const selectedPlannerProjectIndex = useMemo(() => {
    return plannerProjects.findIndex((project) => project.id === selectedPlannerProjectId);
  }, [plannerProjects, selectedPlannerProjectId]);

  const canGoToPreviousProject = selectedPlannerProjectIndex > 0;
  const canGoToNextProject =
    selectedPlannerProjectIndex >= 0 && selectedPlannerProjectIndex < plannerProjects.length - 1;

  const cardAssignedProjectMap = useMemo(() => {
    const assignedMap = new Map();

    plannerProjects.forEach((project) => {
      (Array.isArray(project.floors) ? project.floors : []).forEach((floor) => {
        (Array.isArray(floor.cardIds) ? floor.cardIds : []).forEach((cardId) => {
          const normalizedCardId = normalizeValue(cardId);
          if (!normalizedCardId || assignedMap.has(normalizedCardId)) return;
          assignedMap.set(normalizedCardId, {
            projectId: project.id,
            projectName: normalizeValue(project.name) || "Untitled Project",
          });
        });
      });
    });

    return assignedMap;
  }, [plannerProjects]);

  const selectedProjectAssignedCardIds = useMemo(() => {
    if (!selectedPlannerProject) return new Set();
    const assignedIds = new Set();
    selectedPlannerProject.floors.forEach((floor) => {
      (Array.isArray(floor.cardIds) ? floor.cardIds : []).forEach((cardId) => assignedIds.add(normalizeValue(cardId)));
    });
    return assignedIds;
  }, [selectedPlannerProject]);

  const unassignedPlannerCards = useMemo(() => {
    if (!selectedPlannerProject) return plannerCards;
    return plannerCards.filter((card) => {
      const cardId = normalizeValue(card.id);
      const issueId = normalizeValue(card.issueId);
      return !selectedProjectAssignedCardIds.has(cardId) && !selectedProjectAssignedCardIds.has(issueId);
    });
  }, [plannerCards, selectedPlannerProject, selectedProjectAssignedCardIds, cardAssignedProjectMap]);

  const plannerCardMap = useMemo(() => {
    const map = new Map();
    plannerCards.forEach((card) => {
      const cardId = normalizeValue(card.id);
      const issueId = normalizeValue(card.issueId);
      if (cardId) map.set(cardId, card);
      if (issueId && !map.has(issueId)) map.set(issueId, card);
    });
    return map;
  }, [plannerCards]);

  const floorVisualSummary = useMemo(() => {
    const allFloors = plannerProjects.flatMap((project) => (
      Array.isArray(project.floors) ? project.floors : []
    ));

    return allFloors.map((floor) => {
      const floorCards = (Array.isArray(floor.cardIds) ? floor.cardIds : [])
        .map((cardId) => plannerCardMap.get(normalizeValue(cardId)))
        .filter(Boolean);

      const inProgressCount = floorCards.reduce((total, card) => {
        const count = Array.isArray(card.inProgressUsers) ? card.inProgressUsers.length : 0;
        return total + count;
      }, 0);

      const inProgressPeopleMap = new Map();
      floorCards.forEach((card) => {
        const details = Array.isArray(card.inProgressUserDetails) ? card.inProgressUserDetails : [];
        details.forEach((person) => {
          const personName = normalizeValue(person?.name);
          if (!personName) return;

          const avatarUrl = normalizeValue(person?.avatarUrl);
          if (!inProgressPeopleMap.has(personName)) {
            inProgressPeopleMap.set(personName, avatarUrl);
            return;
          }

          if (!inProgressPeopleMap.get(personName) && avatarUrl) {
            inProgressPeopleMap.set(personName, avatarUrl);
          }
        });
      });

      const inProgressPeople = Array.from(inProgressPeopleMap.entries())
        .map(([name, avatarUrl]) => ({ name, avatarUrl }))
        .sort((left, right) => left.name.localeCompare(right.name));

      return {
        id: floor.id,
        name: floor.name,
        cardCount: floorCards.length,
        inProgressCount,
        inProgressPeople,
      };
    });
  }, [plannerCardMap, plannerProjects]);

  const floorSummaryById = useMemo(() => {
    const map = new Map();
    floorVisualSummary.forEach((entry) => map.set(entry.id, entry));
    return map;
  }, [floorVisualSummary]);

  const selectedPlannerFloor = useMemo(() => {
    if (!selectedPlannerProject) return null;
    return (Array.isArray(selectedPlannerProject.floors) ? selectedPlannerProject.floors : []).find((floor) => floor.id === selectedFloorId) || null;
  }, [selectedPlannerProject, selectedFloorId]);

  const floorProgressProjects = useMemo(() => {
    return plannerProjects.map((project) => ({
      ...project,
      floors: (Array.isArray(project.floors) ? project.floors : []).map((floor) => ({
        ...floor,
        categories: floorProgressMap?.[project.id]?.[floor.id] || [],
        logs: floorProgressLogMap?.[project.id]?.[floor.id] || [],
      })),
    }));
  }, [floorProgressLogMap, floorProgressMap, plannerProjects]);

  const floorProgressCatalogMap = useMemo(() => {
    return floorProgressCatalog.reduce((catalogMap, catalogEntry) => {
      const catalogId = normalizeValue(catalogEntry.id);
      if (!catalogId) return catalogMap;
      catalogMap[catalogId] = catalogEntry;
      return catalogMap;
    }, {});
  }, [floorProgressCatalog]);

  const buildCardsByStep = useCallback((cardEntries) => {
    return CARD_REVIEW_STEPS.reduce((accumulator, step) => {
      accumulator[step.id] = cardEntries.filter((entry) => entry.step === step.id);
      return accumulator;
    }, {});
  }, []);

  const cardReviewProjects = useMemo(() => {
    const stepOrder = CARD_REVIEW_STEPS.reduce((orderMap, step, index) => {
      orderMap[step.id] = index;
      return orderMap;
    }, {});

    const sortCardReviewEntries = (left, right) => {
      if (cardReviewSortBy === "id") {
        return left.issueId.localeCompare(right.issueId, undefined, { numeric: true, sensitivity: "base" });
      }

      if (cardReviewSortBy === "title") {
        return left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
      }

      const leftStep = stepOrder[left.step] ?? 999;
      const rightStep = stepOrder[right.step] ?? 999;
      if (leftStep !== rightStep) return leftStep - rightStep;
      return left.issueId.localeCompare(right.issueId, undefined, { numeric: true, sensitivity: "base" });
    };

    const mappedProjects = plannerProjects.map((project) => {
      const projectId = normalizeValue(project.id);
      const explicitlyAssignedCardRefs = new Set();

      (Array.isArray(project.floors) ? project.floors : []).forEach((floor) => {
        (Array.isArray(floor.cardIds) ? floor.cardIds : []).forEach((cardId) => {
          const normalizedCardId = normalizeValue(cardId);
          const mappedCard = cardReviewCardMap.get(normalizedCardId);
          if (normalizedCardId) explicitlyAssignedCardRefs.add(normalizedCardId);
          if (mappedCard) {
            const mappedIssueId = normalizeValue(mappedCard.issueId);
            const mappedCardId = normalizeValue(mappedCard.id);
            if (mappedIssueId) explicitlyAssignedCardRefs.add(mappedIssueId);
            if (mappedCardId) explicitlyAssignedCardRefs.add(mappedCardId);
          }
        });
      });

      const floors = (Array.isArray(project.floors) ? project.floors : []).map((floor) => {
        const floorId = normalizeValue(floor.id);
        const explicitFloorCardRefs = (Array.isArray(floor.cardIds) ? floor.cardIds : [])
          .map((cardRef) => normalizeValue(cardRef))
          .filter(Boolean);

        const floorMatchKey = normalizeFloorMatchKey(floor.name);
        const inferredFloorCardRefs = floorMatchKey
            ? cardReviewSourceCards
              .filter((card) => {
                const cardIssueId = normalizeValue(card.issueId);
                const cardId = normalizeValue(card.id);
                if (explicitlyAssignedCardRefs.has(cardIssueId) || explicitlyAssignedCardRefs.has(cardId)) {
                  return false;
                }

                const assignmentByIssue = cardAssignedProjectMap.get(cardIssueId);
                const assignmentByCard = cardAssignedProjectMap.get(cardId);
                const assignedProjectId = normalizeValue(assignmentByIssue?.projectId || assignmentByCard?.projectId);
                if (assignedProjectId && assignedProjectId !== projectId) {
                  return false;
                }

                const titleMatchKey = normalizeFloorMatchKey(card.title);
                const cardProjectNameMatchKey = normalizeFloorMatchKey(card.projectName);
                return titleMatchKey.includes(floorMatchKey) || cardProjectNameMatchKey.includes(floorMatchKey);
              })
              .map((card) => normalizeValue(card.issueId) || normalizeValue(card.id))
              .filter(Boolean)
          : [];

        const resolvedFloorCardRefs = Array.from(new Set([
          ...explicitFloorCardRefs,
          ...inferredFloorCardRefs,
        ]));

        const floorCards = resolvedFloorCardRefs
          .map((cardRef) => {
            const normalizedCardRef = normalizeValue(cardRef);
            const card = cardReviewCardMap.get(normalizedCardRef);
            if (!card) return null;

            const cardReviewEntry = cardReviewMap?.[projectId]?.[floorId]?.[normalizedCardRef]
              || cardReviewMap?.[projectId]?.[floorId]?.[normalizeValue(card.issueId)]
              || cardReviewMap?.[projectId]?.[floorId]?.[normalizeValue(card.id)]
              || null;

            const step = normalizeCardReviewStep(cardReviewEntry?.step);
            const issueId = normalizeValue(card.issueId);
            const title = normalizeValue(card.title);
            const projectName = normalizeValue(card.projectName);

            return {
              cardRef: normalizedCardRef,
              issueId,
              title,
              projectName,
              step,
              card,
            };
          })
          .filter(Boolean)
          .sort(sortCardReviewEntries);

        const cardsByStep = buildCardsByStep(floorCards);

        return {
          ...floor,
          cards: floorCards,
          cardsByStep,
        };
      });

      const floorIncludedCardRefs = new Set();
      floors.forEach((floor) => {
        (Array.isArray(floor.cards) ? floor.cards : []).forEach((entry) => {
          const normalizedCardRef = normalizeValue(entry.cardRef);
          const normalizedIssueId = normalizeValue(entry.issueId);
          const normalizedCardId = normalizeValue(entry?.card?.id);
          if (normalizedCardRef) floorIncludedCardRefs.add(normalizedCardRef);
          if (normalizedIssueId) floorIncludedCardRefs.add(normalizedIssueId);
          if (normalizedCardId) floorIncludedCardRefs.add(normalizedCardId);
        });
      });

      const unassignedCards = cardReviewSourceCards
        .filter((card) => {
          const normalizedIssueId = normalizeValue(card.issueId);
          const normalizedCardId = normalizeValue(card.id);
          if (floorIncludedCardRefs.has(normalizedIssueId) || floorIncludedCardRefs.has(normalizedCardId)) {
            return false;
          }

          const assignmentByIssue = cardAssignedProjectMap.get(normalizedIssueId);
          const assignmentByCard = cardAssignedProjectMap.get(normalizedCardId);
          const assignedProjectId = normalizeValue(assignmentByIssue?.projectId || assignmentByCard?.projectId);
          if (assignedProjectId) {
            return assignedProjectId === projectId;
          }

          return true;
        })
        .map((card) => {
          const normalizedCardRef = normalizeValue(card.issueId) || normalizeValue(card.id);
          const cardReviewEntry = cardReviewMap?.[projectId]?.[UNASSIGNED_FLOOR_TAB_ID]?.[normalizedCardRef]
            || cardReviewMap?.[projectId]?.[UNASSIGNED_FLOOR_TAB_ID]?.[normalizeValue(card.issueId)]
            || cardReviewMap?.[projectId]?.[UNASSIGNED_FLOOR_TAB_ID]?.[normalizeValue(card.id)]
            || null;

          return {
            cardRef: normalizedCardRef,
            issueId: normalizeValue(card.issueId),
            title: normalizeValue(card.title),
            projectName: normalizeValue(card.projectName),
            step: normalizeCardReviewStep(cardReviewEntry?.step),
            sourceProjectId: projectId,
            card,
          };
        })
        .filter((entry) => normalizeValue(entry.cardRef))
        .sort(sortCardReviewEntries);

      floors.push({
        id: UNASSIGNED_FLOOR_TAB_ID,
        name: "Unassigned / Unmatched Cards",
        cardIds: [],
        isVirtualUnassigned: true,
        cards: unassignedCards,
        cardsByStep: buildCardsByStep(unassignedCards),
      });

      return {
        ...project,
        floors,
      };
    });

    const coveredCardRefs = new Set();
    mappedProjects.forEach((project) => {
      (Array.isArray(project.floors) ? project.floors : []).forEach((floor) => {
        (Array.isArray(floor.cards) ? floor.cards : []).forEach((entry) => {
          const normalizedCardRef = normalizeValue(entry.cardRef);
          const normalizedIssueId = normalizeValue(entry.issueId);
          const normalizedCardId = normalizeValue(entry?.card?.id);
          if (normalizedCardRef) coveredCardRefs.add(normalizedCardRef);
          if (normalizedIssueId) coveredCardRefs.add(normalizedIssueId);
          if (normalizedCardId) coveredCardRefs.add(normalizedCardId);
        });
      });
    });

    const virtualProjectCards = cardReviewSourceCards.filter((card) => {
      const normalizedIssueId = normalizeValue(card.issueId);
      const normalizedCardId = normalizeValue(card.id);
      return !coveredCardRefs.has(normalizedIssueId) && !coveredCardRefs.has(normalizedCardId);
    });

    if (virtualProjectCards.length === 0) {
      return mappedProjects;
    }

    const virtualBuckets = virtualProjectCards.reduce((bucketMap, card) => {
      const projectName = normalizeValue(card.projectName) || "Unmapped Project";
      if (!bucketMap[projectName]) {
        bucketMap[projectName] = [];
      }
      bucketMap[projectName].push(card);
      return bucketMap;
    }, {});

    const virtualProjects = Object.entries(virtualBuckets).map(([projectName, cards]) => {
      const projectId = `virtual-${normalizeKey(projectName) || "unmapped"}`;
      const cardEntries = cards
        .map((card) => {
          const normalizedCardRef = normalizeValue(card.issueId) || normalizeValue(card.id);
          const cardReviewEntry = cardReviewMap?.[projectId]?.[UNASSIGNED_FLOOR_TAB_ID]?.[normalizedCardRef]
            || cardReviewMap?.[projectId]?.[UNASSIGNED_FLOOR_TAB_ID]?.[normalizeValue(card.issueId)]
            || cardReviewMap?.[projectId]?.[UNASSIGNED_FLOOR_TAB_ID]?.[normalizeValue(card.id)]
            || null;

          return {
            cardRef: normalizedCardRef,
            issueId: normalizeValue(card.issueId),
            title: normalizeValue(card.title),
            projectName: normalizeValue(card.projectName),
            step: normalizeCardReviewStep(cardReviewEntry?.step),
            sourceProjectId: projectId,
            card,
          };
        })
        .filter((entry) => normalizeValue(entry.cardRef))
        .sort(sortCardReviewEntries);

      return {
        id: projectId,
        name: `${projectName} (Not in Floor Planner)`,
        isVirtualProject: true,
        floors: [
          {
            id: UNASSIGNED_FLOOR_TAB_ID,
            name: "Unassigned / Unmatched Cards",
            cardIds: [],
            isVirtualUnassigned: true,
            cards: cardEntries,
            cardsByStep: buildCardsByStep(cardEntries),
          },
        ],
      };
    });

    return [...mappedProjects, ...virtualProjects];
  }, [buildCardsByStep, cardAssignedProjectMap, cardReviewCardMap, cardReviewMap, cardReviewSortBy, cardReviewSourceCards, plannerProjects]);

  const cardReviewGlobalUnassignedFloor = useMemo(() => {
    const combinedCards = cardReviewProjects
      .flatMap((project) => {
        const unassignedFloor = (Array.isArray(project.floors) ? project.floors : []).find(
          (floor) => floor.isVirtualUnassigned
        );
        if (!unassignedFloor || !Array.isArray(unassignedFloor.cards)) return [];
        return unassignedFloor.cards.map((entry) => ({
          ...entry,
          sourceProjectId: normalizeValue(entry.sourceProjectId) || normalizeValue(project.id),
        }));
      })
      .filter((entry) => normalizeValue(entry.cardRef));

    return {
      id: UNASSIGNED_FLOOR_TAB_ID,
      name: "Unassigned / Unmatched Cards",
      isVirtualUnassigned: true,
      cards: combinedCards,
      cardsByStep: buildCardsByStep(combinedCards),
    };
  }, [cardReviewProjects]);

  const cardReviewMoveProjectOptions = useMemo(() => {
    const optionsById = new Map();

    plannerProjects.forEach((project) => {
      const projectId = normalizeValue(project.id);
      if (!projectId) return;
      optionsById.set(projectId, {
        id: projectId,
        label: normalizeValue(project.name) || "Untitled Project",
        selectable: true,
      });
    });

    cardReviewProjects.forEach((project) => {
      const projectId = normalizeValue(project.id);
      if (!projectId || optionsById.has(projectId)) return;
      optionsById.set(projectId, {
        id: projectId,
        label: `${normalizeValue(project.name) || "Untitled Project"} (add in Floor Planner first)`,
        selectable: false,
      });
    });

    return Array.from(optionsById.values()).sort((left, right) =>
      left.label.localeCompare(right.label, undefined, { sensitivity: "base" })
    );
  }, [cardReviewProjects, plannerProjects]);

  const handleSetCardReviewStep = (projectId, floorId, cardRef, nextStep) => {
    const normalizedProjectId = normalizeValue(projectId);
    const normalizedFloorId = normalizeValue(floorId);
    const normalizedCardRef = normalizeValue(cardRef);
    const normalizedStep = normalizeCardReviewStep(nextStep);
    if (!normalizedProjectId || !normalizedFloorId || !normalizedCardRef) return;

    setCardReviewMap((previousMap) => ({
      ...previousMap,
      [normalizedProjectId]: {
        ...(previousMap?.[normalizedProjectId] || {}),
        [normalizedFloorId]: {
          ...(previousMap?.[normalizedProjectId]?.[normalizedFloorId] || {}),
          [normalizedCardRef]: {
            step: normalizedStep,
            updatedAt: Date.now(),
          },
        },
      },
    }));
  };

  const moveCardToFloorForProject = (projectId, cardId, floorId, successMessage = "Card moved.") => {
    const normalizedProjectId = normalizeValue(projectId);
    const normalizedCardId = normalizeValue(cardId);
    const normalizedFloorId = normalizeValue(floorId);
    if (!normalizedProjectId || !normalizedCardId) return;

    const fallbackIssueId = normalizeValue(plannerCardMap.get(normalizedCardId)?.issueId);
    const assignment = cardAssignedProjectMap.get(normalizedCardId) || cardAssignedProjectMap.get(fallbackIssueId);
    if (assignment && assignment.projectId !== normalizedProjectId) {
      setPlannerStatusMessage(`This card is already assigned to ${assignment.projectName}. Remove it there first before reusing it here.`);
      return;
    }

    savePlannerProjects(
      (previousProjects) => previousProjects.map((project) => {
        if (project.id !== normalizedProjectId) return project;

        return {
          ...project,
          floors: (Array.isArray(project.floors) ? project.floors : []).map((floor) => {
            const withoutCard = (Array.isArray(floor.cardIds) ? floor.cardIds : []).filter((idValue) => idValue !== normalizedCardId);
            if (!normalizedFloorId || normalizedFloorId === UNASSIGNED_FLOOR_TAB_ID || floor.id !== normalizedFloorId) {
              return {
                ...floor,
                cardIds: withoutCard,
              };
            }

            return {
              ...floor,
              cardIds: [...withoutCard, normalizedCardId],
            };
          }),
        };
      }),
      successMessage
    );
  };

  const buildCardReviewMoveKey = (sourceProjectId, cardRef) => {
    return `${normalizeValue(sourceProjectId)}::${normalizeValue(cardRef)}`;
  };

  const handleCardReviewMoveProjectChange = (sourceProjectId, cardRef, targetProjectId) => {
    const moveKey = buildCardReviewMoveKey(sourceProjectId, cardRef);
    const normalizedTargetProjectId = normalizeValue(targetProjectId);

    if (!moveKey) return;

    if (!normalizedTargetProjectId) {
      setCardReviewMoveTargets((previousTargets) => ({
        ...previousTargets,
        [moveKey]: {
          projectId: "",
          floorId: "",
        },
      }));
      return;
    }

    const targetProject = plannerProjects.find((project) => normalizeValue(project.id) === normalizedTargetProjectId) || null;
    const availableFloors = Array.isArray(targetProject?.floors) ? targetProject.floors : [];
    const defaultFloorId = normalizeValue(availableFloors[0]?.id);

    setCardReviewMoveTargets((previousTargets) => ({
      ...previousTargets,
      [moveKey]: {
        projectId: normalizedTargetProjectId,
        floorId: defaultFloorId,
      },
    }));
  };

  const handleCardReviewMoveFloorChange = (sourceProjectId, cardRef, targetFloorId) => {
    const moveKey = buildCardReviewMoveKey(sourceProjectId, cardRef);
    const normalizedTargetFloorId = normalizeValue(targetFloorId);
    if (!moveKey) return;

    setCardReviewMoveTargets((previousTargets) => ({
      ...previousTargets,
      [moveKey]: {
        ...(previousTargets?.[moveKey] || {}),
        floorId: normalizedTargetFloorId,
      },
    }));
  };

  const handleMoveUnassignedCardToProject = (sourceProjectId, cardRef, targetProjectId, targetFloorId, stepId) => {
    const normalizedTargetProjectId = normalizeValue(targetProjectId);
    const normalizedTargetFloorId = normalizeValue(targetFloorId);
    const normalizedCardRef = normalizeValue(cardRef);
    const normalizedStepId = normalizeCardReviewStep(stepId);
    if (!normalizedTargetProjectId || !normalizedTargetFloorId || !normalizedCardRef) return;

    const targetProject = plannerProjects.find((project) => normalizeValue(project.id) === normalizedTargetProjectId) || null;
    if (!targetProject) {
      setPlannerStatusMessage("Selected project was not found in Floor Planner.");
      return;
    }

    const targetFloors = Array.isArray(targetProject.floors) ? targetProject.floors : [];
    const floorExists = targetFloors.some((floor) => normalizeValue(floor.id) === normalizedTargetFloorId);
    if (!floorExists) {
      setPlannerStatusMessage(`Select a valid floor in ${targetProject.name} before moving this card.`);
      return;
    }

    moveCardToFloorForProject(
      normalizedTargetProjectId,
      normalizedCardRef,
      normalizedTargetFloorId,
      `Card moved to ${targetProject.name}.`
    );
    handleSetCardReviewStep(normalizedTargetProjectId, normalizedTargetFloorId, normalizedCardRef, normalizedStepId);

    const normalizedSourceProjectId = normalizeValue(sourceProjectId);
    if (normalizedSourceProjectId) {
      setCardReviewMap((previousMap) => {
        const sourceFloorEntries = previousMap?.[normalizedSourceProjectId]?.[UNASSIGNED_FLOOR_TAB_ID] || {};
        if (!Object.prototype.hasOwnProperty.call(sourceFloorEntries, normalizedCardRef)) {
          return previousMap;
        }

        const nextSourceFloorEntries = { ...sourceFloorEntries };
        delete nextSourceFloorEntries[normalizedCardRef];

        return {
          ...previousMap,
          [normalizedSourceProjectId]: {
            ...(previousMap?.[normalizedSourceProjectId] || {}),
            [UNASSIGNED_FLOOR_TAB_ID]: nextSourceFloorEntries,
          },
        };
      });
    }

    const moveKey = buildCardReviewMoveKey(sourceProjectId, cardRef);
    setCardReviewMoveTargets((previousTargets) => {
      const nextTargets = { ...previousTargets };
      delete nextTargets[moveKey];
      return nextTargets;
    });
  };

  const handleCardReviewDragStart = (projectId, floorId, cardRef) => {
    const normalizedCardRef = normalizeValue(cardRef);
    if (!normalizedCardRef) return;

    setDraggedCardId(normalizedCardRef);
    setDraggedCardReview({
      projectId: normalizeValue(projectId),
      floorId: normalizeValue(floorId),
      cardRef: normalizedCardRef,
    });
  };

  const handleCardReviewDrop = (projectId, floorId, stepId) => {
    const normalizedProjectId = normalizeValue(projectId);
    const normalizedFloorId = normalizeValue(floorId);
    const normalizedStepId = normalizeCardReviewStep(stepId);
    const dragged = draggedCardReview;
    if (!dragged || !normalizeValue(dragged.cardRef) || !normalizedProjectId || !normalizedFloorId) return;

    if (normalizeValue(dragged.projectId) && normalizeValue(dragged.projectId) !== normalizedProjectId) {
      setPlannerStatusMessage("Cards can only be moved inside the same project in Card Review.");
      setDraggedCardReview(null);
      setDraggedCardId("");
      return;
    }

    const targetProject = plannerProjects.find((project) => normalizeValue(project.id) === normalizedProjectId) || null;
    if (!targetProject) {
      setPlannerStatusMessage("This project is not in Floor Planner yet. Add it there first to drag/drop floor assignments.");
      setDraggedCardReview(null);
      setDraggedCardId("");
      return;
    }

    const normalizedCardRef = normalizeValue(dragged.cardRef);
    const sourceFloorId = normalizeValue(dragged.floorId);

    if (sourceFloorId !== normalizedFloorId) {
      moveCardToFloorForProject(
        normalizedProjectId,
        normalizedCardRef,
        normalizedFloorId,
        normalizedFloorId === UNASSIGNED_FLOOR_TAB_ID
          ? "Card moved to unmatched pool."
          : "Card moved to selected floor."
      );
    }

    handleSetCardReviewStep(normalizedProjectId, normalizedFloorId, normalizedCardRef, normalizedStepId);
    setDraggedCardReview(null);
    setDraggedCardId("");
  };

  const isUnassignedTabActive = selectedFloorId === UNASSIGNED_FLOOR_TAB_ID;

  const selectedFloorCards = useMemo(() => {
    if (!selectedPlannerFloor) return [];
    return (Array.isArray(selectedPlannerFloor.cardIds) ? selectedPlannerFloor.cardIds : [])
      .map((cardId) => plannerCardMap.get(normalizeValue(cardId)))
      .filter(Boolean);
  }, [plannerCardMap, selectedPlannerFloor]);

  const savePlannerProjects = (updater, successMessage) => {
    setPlannerProjects((previousProjects) => {
      const nextProjects = updater(previousProjects);
      if (successMessage) setPlannerStatusMessage(successMessage);
      return nextProjects;
    });
  };

  const handleCreateProject = () => {
    const projectName = normalizeValue(newProjectName);
    if (!projectName) return;

    const nextProjectId = createId("project");
    savePlannerProjects(
      (previousProjects) => [
        ...previousProjects,
        {
          id: nextProjectId,
          name: projectName,
          floors: [],
        },
      ],
      "Project created."
    );
    setNewProjectName("");
    setSelectedPlannerProjectId(nextProjectId);
  };

  const handleCreateFloor = () => {
    const floorName = normalizeValue(newFloorName);
    if (!floorName || !selectedPlannerProjectId) return;

    const nextFloorId = createId("floor");
    savePlannerProjects(
      (previousProjects) => previousProjects.map((project) => {
        if (project.id !== selectedPlannerProjectId) return project;
        return {
          ...project,
          floors: [
            ...project.floors,
            {
              id: nextFloorId,
              name: floorName,
              cardIds: [],
            },
          ],
        };
      }),
      "Floor created."
    );
    setNewFloorName("");
    setSelectedFloorId(nextFloorId);
  };

  const startFloorEdit = (floor) => {
    setEditingFloorId(normalizeValue(floor?.id));
    setEditingFloorName(normalizeValue(floor?.name));
  };

  const cancelFloorEdit = () => {
    setEditingFloorId("");
    setEditingFloorName("");
  };

  const saveFloorEdit = () => {
    const floorId = normalizeValue(editingFloorId);
    const nextName = normalizeValue(editingFloorName);
    if (!floorId || !nextName || !selectedPlannerProjectId) return;

    savePlannerProjects(
      (previousProjects) => previousProjects.map((project) => {
        if (project.id !== selectedPlannerProjectId) return project;
        return {
          ...project,
          floors: project.floors.map((floor) => (
            floor.id === floorId
              ? { ...floor, name: nextName }
              : floor
          )),
        };
      }),
      "Floor updated."
    );

    cancelFloorEdit();
  };

  const moveFloor = (floorId, direction) => {
    const normalizedFloorId = normalizeValue(floorId);
    if (!normalizedFloorId || !selectedPlannerProjectId) return;

    savePlannerProjects(
      (previousProjects) => previousProjects.map((project) => {
        if (project.id !== selectedPlannerProjectId) return project;

        const floors = Array.isArray(project.floors) ? [...project.floors] : [];
        const currentIndex = floors.findIndex((floor) => floor.id === normalizedFloorId);
        if (currentIndex < 0) return project;

        const targetIndex = currentIndex + direction;
        if (targetIndex < 0 || targetIndex >= floors.length) return project;

        const [movedFloor] = floors.splice(currentIndex, 1);
        floors.splice(targetIndex, 0, movedFloor);

        return {
          ...project,
          floors,
        };
      }),
      "Floor order updated."
    );
  };

  const selectPlannerFloor = (floorId) => {
    const normalizedFloorId = normalizeValue(floorId);
    if (!normalizedFloorId) return;

    setSelectedFloorId(normalizedFloorId);

    if (editingFloorId && editingFloorId !== normalizedFloorId) {
      cancelFloorEdit();
    }
  };

  const goToPreviousProject = () => {
    if (!canGoToPreviousProject) return;
    const previousProject = plannerProjects[selectedPlannerProjectIndex - 1];
    if (previousProject) {
      setSelectedPlannerProjectId(previousProject.id);
      setPlannerStatusMessage(`Viewing ${previousProject.name}`);
    }
  };

  const goToNextProject = () => {
    if (!canGoToNextProject) return;
    const nextProject = plannerProjects[selectedPlannerProjectIndex + 1];
    if (nextProject) {
      setSelectedPlannerProjectId(nextProject.id);
      setPlannerStatusMessage(`Viewing ${nextProject.name}`);
    }
  };

  const moveCardToFloor = (cardId, floorId) => {
    if (!cardId || !selectedPlannerProjectId) return;
    moveCardToFloorForProject(selectedPlannerProjectId, cardId, floorId, "Card moved.");
  };

  const moveCardToUnassigned = (cardId) => {
    if (!cardId || !selectedPlannerProjectId) return;
    moveCardToFloorForProject(selectedPlannerProjectId, cardId, UNASSIGNED_FLOOR_TAB_ID, "Card returned to unassigned.");
  };

  const handleCardDragStart = (cardId) => {
    setDraggedCardId(cardId);
  };

  const handleCardDropToFloor = (floorId) => {
    if (!draggedCardId) return;

    const normalizedCardId = normalizeValue(draggedCardId);
    const fallbackIssueId = normalizeValue(plannerCardMap.get(normalizedCardId)?.issueId);
    const assignment = cardAssignedProjectMap.get(normalizedCardId) || cardAssignedProjectMap.get(fallbackIssueId);
    if (assignment && assignment.projectId !== selectedPlannerProjectId) {
      setPlannerStatusMessage(`This card is already assigned to ${assignment.projectName}. Remove it there first before reusing it here.`);
      setDraggedCardId("");
      return;
    }

    moveCardToFloor(draggedCardId, floorId);
    setDraggedCardId("");
  };

  const handleCardDropToUnassigned = () => {
    if (!draggedCardId) return;
    moveCardToUnassigned(draggedCardId);
    setDraggedCardId("");
  };

  const handleCardDropToUnassignedTab = () => {
    if (!draggedCardId) return;
    moveCardToUnassigned(draggedCardId);
    setSelectedFloorId(UNASSIGNED_FLOOR_TAB_ID);
    setDraggedCardId("");
  };

  const updateFloorProgressCategories = (projectId, floorId, updater, successMessage = "") => {
    const normalizedProjectId = normalizeValue(projectId);
    const normalizedFloorId = normalizeValue(floorId);
    if (!normalizedProjectId || !normalizedFloorId) return;

    setFloorProgressMap((previousMap) => {
      const previousProjectMap = previousMap?.[normalizedProjectId] || {};
      const previousCategories = Array.isArray(previousProjectMap?.[normalizedFloorId])
        ? previousProjectMap[normalizedFloorId]
        : [];
      const nextCategories = updater(previousCategories);

      return {
        ...previousMap,
        [normalizedProjectId]: {
          ...previousProjectMap,
          [normalizedFloorId]: nextCategories,
        },
      };
    });

    if (successMessage) {
      setFloorProgressStatusMessage(successMessage);
    }
  };

  const appendFloorProgressLogEntry = (projectId, floorId, message, timestamp = Date.now()) => {
    const normalizedProjectId = normalizeValue(projectId);
    const normalizedFloorId = normalizeValue(floorId);
    const normalizedMessage = normalizeValue(message);
    const normalizedTimestamp = normalizeTimestampValue(timestamp) || Date.now();
    if (!normalizedProjectId || !normalizedFloorId || !normalizedMessage) return;

    setFloorProgressLogMap((previousLogMap) => {
      const previousProjectLogMap = previousLogMap?.[normalizedProjectId] || {};
      const previousFloorLogs = Array.isArray(previousProjectLogMap?.[normalizedFloorId])
        ? previousProjectLogMap[normalizedFloorId]
        : [];

      return {
        ...previousLogMap,
        [normalizedProjectId]: {
          ...previousProjectLogMap,
          [normalizedFloorId]: [
            {
              id: createId("floor-progress-log"),
              timestamp: normalizedTimestamp,
              message: normalizedMessage,
            },
            ...previousFloorLogs,
          ].slice(0, 100),
        },
      };
    });
  };

  const handleDeleteFloorProgressLogEntry = (projectId, floorId, logEntryId) => {
    const normalizedProjectId = normalizeValue(projectId);
    const normalizedFloorId = normalizeValue(floorId);
    const normalizedLogEntryId = normalizeValue(logEntryId);
    if (!normalizedProjectId || !normalizedFloorId || !normalizedLogEntryId) return;

    setFloorProgressLogMap((previousLogMap) => {
      const previousProjectLogMap = previousLogMap?.[normalizedProjectId] || {};
      const previousFloorLogs = Array.isArray(previousProjectLogMap?.[normalizedFloorId])
        ? previousProjectLogMap[normalizedFloorId]
        : [];

      return {
        ...previousLogMap,
        [normalizedProjectId]: {
          ...previousProjectLogMap,
          [normalizedFloorId]: previousFloorLogs.filter((logEntry) => normalizeValue(logEntry.id) !== normalizedLogEntryId),
        },
      };
    });

    setFloorProgressStatusMessage("Progress log entry removed.");
  };

  const handleFloorProgressDraftChange = (projectId, floorId, field, value) => {
    const normalizedProjectId = normalizeValue(projectId);
    const normalizedFloorId = normalizeValue(floorId);
    if (!normalizedProjectId || !normalizedFloorId) return;

    setFloorProgressDrafts((previousDrafts) => ({
      ...previousDrafts,
      [normalizedProjectId]: {
        ...(previousDrafts?.[normalizedProjectId] || {}),
        [normalizedFloorId]: {
          catalogId: normalizeValue(previousDrafts?.[normalizedProjectId]?.[normalizedFloorId]?.catalogId),
          name: normalizeValue(previousDrafts?.[normalizedProjectId]?.[normalizedFloorId]?.name),
          percent: normalizeValue(previousDrafts?.[normalizedProjectId]?.[normalizedFloorId]?.percent),
          [field]: value,
        },
      },
    }));
  };

  const handleFloorProgressPercentDraftChange = (projectId, floorId, entryId, value) => {
    const draftKey = buildFloorProgressEntryDraftKey(projectId, floorId, entryId);
    setFloorProgressPercentDrafts((previousDrafts) => ({
      ...previousDrafts,
      [draftKey]: value,
    }));
  };

  const commitFloorProgressPercentDraft = (projectId, floorId, categoryEntry) => {
    const entryId = normalizeValue(categoryEntry?.id);
    if (!entryId) return;

    const draftKey = buildFloorProgressEntryDraftKey(projectId, floorId, entryId);
    const hasDraft = Object.prototype.hasOwnProperty.call(floorProgressPercentDrafts, draftKey);
    if (!hasDraft) return;

    const draftValue = floorProgressPercentDrafts[draftKey];
    const nextPercent = normalizePercentValue(draftValue);
    const currentPercent = normalizePercentValue(categoryEntry?.percent);

    if (nextPercent !== currentPercent) {
      handleUpdateFloorProgressEntry(projectId, floorId, entryId, "percent", draftValue);
    }

    setFloorProgressPercentDrafts((previousDrafts) => {
      const nextDrafts = { ...previousDrafts };
      delete nextDrafts[draftKey];
      return nextDrafts;
    });
  };

  const handleAddFloorProgressCategory = (projectId, floorId) => {
    const normalizedProjectId = normalizeValue(projectId);
    const normalizedFloorId = normalizeValue(floorId);
    const timestamp = Date.now();
    const existingFloorCategories = Array.isArray(floorProgressMap?.[normalizedProjectId]?.[normalizedFloorId])
      ? floorProgressMap[normalizedProjectId][normalizedFloorId]
      : [];
    const draft = floorProgressDrafts?.[normalizedProjectId]?.[normalizedFloorId] || {};
    const selectedCatalogId = normalizeValue(draft.catalogId);
    const typedCategoryName = normalizeValue(draft.name);
    const selectedCatalogEntry = floorProgressCatalogMap[selectedCatalogId] || null;
    const existingCatalogMatch = floorProgressCatalog.find(
      (catalogEntry) => normalizeComparable(catalogEntry.name) === normalizeComparable(typedCategoryName)
    );
    const resolvedCatalogEntry = selectedCatalogEntry
      || existingCatalogMatch
      || (typedCategoryName ? { id: createId("progress-catalog"), name: typedCategoryName } : null);
    const categoryName = normalizeValue(resolvedCatalogEntry?.name || typedCategoryName);
    if (!categoryName) return;

    const nextCategoryKey = getFloorProgressCategoryKey({
      catalogId: normalizeValue(resolvedCatalogEntry?.id),
      name: categoryName,
    });
    const alreadyExistsOnFloor = existingFloorCategories.some(
      (categoryEntry) => getFloorProgressCategoryKey(categoryEntry) === nextCategoryKey
    );

    if (alreadyExistsOnFloor) {
      setFloorProgressStatusMessage("That category already exists on this floor.");
      return;
    }

    if (!selectedCatalogEntry && resolvedCatalogEntry && !existingCatalogMatch) {
      setFloorProgressCatalog((previousCatalog) => (
        [...previousCatalog, resolvedCatalogEntry]
          .sort((left, right) => left.name.localeCompare(right.name))
      ));
    }

    updateFloorProgressCategories(
      normalizedProjectId,
      normalizedFloorId,
      (previousCategories) => ([
        ...previousCategories,
        {
          id: createId("floor-progress"),
          catalogId: normalizeValue(resolvedCatalogEntry?.id),
          name: categoryName,
          percent: normalizePercentValue(draft.percent),
          updatedAt: timestamp,
        },
      ]),
      "Floor progress category added."
    );

    appendFloorProgressLogEntry(
      normalizedProjectId,
      normalizedFloorId,
      `${categoryName}: set to ${normalizePercentValue(draft.percent)}%`,
      timestamp
    );

    handleFloorProgressDraftChange(normalizedProjectId, normalizedFloorId, "catalogId", "");
    handleFloorProgressDraftChange(normalizedProjectId, normalizedFloorId, "name", "");
    handleFloorProgressDraftChange(normalizedProjectId, normalizedFloorId, "percent", "");
  };

  const handleCreateFloorProgressCatalogCategory = () => {
    const categoryName = normalizeValue(newFloorProgressCatalogName);
    if (!categoryName) return;

    const alreadyExists = floorProgressCatalog.some(
      (catalogEntry) => normalizeComparable(catalogEntry.name) === normalizeComparable(categoryName)
    );

    if (alreadyExists) {
      setFloorProgressStatusMessage("That category already exists in the catalog.");
      return;
    }

    setFloorProgressCatalog((previousCatalog) => (
      [...previousCatalog, { id: createId("progress-catalog"), name: categoryName }]
        .sort((left, right) => left.name.localeCompare(right.name))
    ));
    setNewFloorProgressCatalogName("");
    setFloorProgressStatusMessage("Catalog category created.");
  };

  const handleDeleteFloorProgressCatalogCategory = (catalogId) => {
    const normalizedCatalogId = normalizeValue(catalogId);
    if (!normalizedCatalogId) return;

    setFloorProgressCatalog((previousCatalog) => (
      previousCatalog.filter((catalogEntry) => normalizeValue(catalogEntry.id) !== normalizedCatalogId)
    ));

    setFloorProgressMap((previousMap) => Object.entries(previousMap || {}).reduce((projectAccumulator, [projectId, floorsValue]) => {
      const normalizedProjectId = normalizeValue(projectId);
      if (!normalizedProjectId || !floorsValue || typeof floorsValue !== "object" || Array.isArray(floorsValue)) {
        return projectAccumulator;
      }

      const nextFloorMap = Object.entries(floorsValue).reduce((floorAccumulator, [floorId, categoryEntries]) => {
        const normalizedFloorId = normalizeValue(floorId);
        if (!normalizedFloorId || !Array.isArray(categoryEntries)) {
          return floorAccumulator;
        }

        floorAccumulator[normalizedFloorId] = categoryEntries.filter(
          (categoryEntry) => normalizeValue(categoryEntry.catalogId) !== normalizedCatalogId
        );
        return floorAccumulator;
      }, {});

      projectAccumulator[normalizedProjectId] = nextFloorMap;
      return projectAccumulator;
    }, {}));

    setFloorProgressDrafts((previousDrafts) => Object.entries(previousDrafts || {}).reduce((projectAccumulator, [projectId, floorsValue]) => {
      const normalizedProjectId = normalizeValue(projectId);
      if (!normalizedProjectId || !floorsValue || typeof floorsValue !== "object" || Array.isArray(floorsValue)) {
        return projectAccumulator;
      }

      const nextFloorDrafts = Object.entries(floorsValue).reduce((floorAccumulator, [floorId, draftValue]) => {
        const normalizedFloorId = normalizeValue(floorId);
        const normalizedDraftCatalogId = normalizeValue(draftValue?.catalogId);

        if (!normalizedFloorId) {
          return floorAccumulator;
        }

        floorAccumulator[normalizedFloorId] = normalizedDraftCatalogId === normalizedCatalogId
          ? {
              catalogId: "",
              name: "",
              percent: normalizeValue(draftValue?.percent),
            }
          : draftValue;
        return floorAccumulator;
      }, {});

      projectAccumulator[normalizedProjectId] = nextFloorDrafts;
      return projectAccumulator;
    }, {}));

    setFloorProgressStatusMessage("Catalog category deleted everywhere.");
  };

  const handleUpdateFloorProgressEntry = (projectId, floorId, entryId, field, value) => {
    const normalizedProjectId = normalizeValue(projectId);
    const normalizedFloorId = normalizeValue(floorId);
    const normalizedEntryId = normalizeValue(entryId);
    const existingFloorCategories = Array.isArray(floorProgressMap?.[normalizedProjectId]?.[normalizedFloorId])
      ? floorProgressMap[normalizedProjectId][normalizedFloorId]
      : [];
    const existingEntry = existingFloorCategories.find((categoryEntry) => normalizeValue(categoryEntry.id) === normalizedEntryId) || null;

    if (field === "catalogId") {
      const normalizedCatalogId = normalizeValue(value);
      const matchedCatalogEntry = floorProgressCatalogMap[normalizedCatalogId] || null;
      const nextCategoryKey = getFloorProgressCategoryKey({
        catalogId: normalizedCatalogId,
        name: normalizeValue(matchedCatalogEntry?.name),
      });

      const alreadyExistsOnFloor = existingFloorCategories.some((categoryEntry) => (
        normalizeValue(categoryEntry.id) !== normalizedEntryId
        && getFloorProgressCategoryKey(categoryEntry) === nextCategoryKey
      ));

      if (nextCategoryKey && alreadyExistsOnFloor) {
        setFloorProgressStatusMessage("That category already exists on this floor.");
        return;
      }
    }

    const timestamp = Date.now();
    const percentBefore = normalizePercentValue(existingEntry?.percent);
    const percentAfter = normalizePercentValue(value);
    const didPercentChange = field === "percent" && percentBefore !== percentAfter;

    updateFloorProgressCategories(projectId, floorId, (previousCategories) => (
      previousCategories.map((categoryEntry) => {
        if (normalizeValue(categoryEntry.id) !== normalizeValue(entryId)) return categoryEntry;

        if (field === "catalogId") {
          const normalizedCatalogId = normalizeValue(value);
          const matchedCatalogEntry = floorProgressCatalogMap[normalizedCatalogId] || null;

          return {
            ...categoryEntry,
            catalogId: normalizedCatalogId,
            name: normalizeValue(matchedCatalogEntry?.name || categoryEntry.name),
          };
        }

        return {
          ...categoryEntry,
          [field]: field === "percent" ? percentAfter : normalizeValue(value),
          updatedAt: field === "percent" ? timestamp : normalizeTimestampValue(categoryEntry.updatedAt),
        };
      })
    ));

    if (didPercentChange) {
      const resolvedName = normalizeValue(existingEntry?.name)
        || normalizeValue(floorProgressCatalogMap[normalizeValue(existingEntry?.catalogId)]?.name)
        || "Category";

      appendFloorProgressLogEntry(
        normalizedProjectId,
        normalizedFloorId,
        `${resolvedName}: ${percentBefore}% -> ${percentAfter}%`,
        timestamp
      );
    }
  };

  const handleDeleteFloorProgressEntry = (projectId, floorId, entryId) => {
    updateFloorProgressCategories(
      projectId,
      floorId,
      (previousCategories) => previousCategories.filter((categoryEntry) => normalizeValue(categoryEntry.id) !== normalizeValue(entryId)),
      "Floor progress category removed."
    );
  };

  const renderPlannerCard = (card) => {
    const assignment = cardAssignedProjectMap.get(normalizeValue(card.id)) || cardAssignedProjectMap.get(normalizeValue(card.issueId));
    const isLockedToAnotherProject = Boolean(
      assignment
      && selectedPlannerProjectId
      && assignment.projectId !== selectedPlannerProjectId
    );

    return (
    <div
      key={card.id}
      draggable
      onDragStart={() => handleCardDragStart(card.id)}
      style={{
        border: "1px solid #CBD5E1",
        borderRadius: "10px",
        padding: "10px",
        backgroundColor: isLockedToAnotherProject ? "#FFF7ED" : "#FFFFFF",
        boxShadow: "0 3px 10px rgba(15, 23, 42, 0.08)",
        cursor: isLockedToAnotherProject ? "not-allowed" : "grab",
      }}
      title={
        isLockedToAnotherProject
          ? `Assigned to ${assignment.projectName}. Remove it there before assigning here.`
          : "Drag this card to a floor"
      }
    >
      <div style={{ fontWeight: 700, color: "#0F172A" }}>{card.issueId || card.id}</div>
      <div style={{ marginTop: "2px", color: "#334155", fontSize: "0.9rem" }}>{card.projectName || "No project"}</div>
      <div style={{ marginTop: "4px", color: "#0F172A", fontSize: "0.88rem", fontWeight: 700 }}>
        {hasTechnicalDetailTitle(card.title) ? `⭐ ${card.title || "-"}` : (card.title || "-")}
      </div>
      {isLockedToAnotherProject ? (
        <div style={{ marginTop: "6px", color: "#9A3412", fontSize: "0.8rem", fontWeight: 700 }}>
          Locked: assigned to {assignment.projectName}
        </div>
      ) : null}
      <div style={{ marginTop: "8px", fontSize: "0.82rem", color: "#475569" }}>
        <div><strong>In progress:</strong></div>
        {Array.isArray(card.inProgressUsers) && card.inProgressUsers.length > 0 ? (
          <ul style={{ margin: "2px 0 6px 18px", padding: 0 }}>
            {card.inProgressUsers.map((userName) => (
              <li key={`${card.id}-${userName}`}>{userName}</li>
            ))}
          </ul>
        ) : (
          <div>-</div>
        )}
        <div><strong>Status:</strong> {card.statusAgile || "-"}</div>
        <div><strong>Technical:</strong> {card.technicalDirection || "-"}</div>
        <div><strong>Tags:</strong> {card.taskTags.length > 0 ? card.taskTags.join(", ") : "-"}</div>
        <div><strong>Latest note:</strong> {card.latestNote || "-"}</div>
        {/* ── Hours section ── */}
        {(() => {
          const issueKey = normalizeValue(card.issueId);
          const usedMs = hoursPerIssue.get(issueKey) || 0;
          const usedLabel = usedMs > 0 ? formatDurationMs(usedMs) : "0m";
          // Stored budget overrides Excel value
          const storedBudget = cardBudgets[issueKey];
          const budgetH = storedBudget != null ? Number(storedBudget) : (card.assignedHours || 0);
          const isEditing = editingBudgetCardId === issueKey;

          const startEdit = (e) => {
            e.stopPropagation();
            setEditingBudgetCardId(issueKey);
            setEditingBudgetValue(budgetH > 0 ? String(budgetH) : "");
          };

          const saveEdit = () => {
            const parsed = parseFloat(editingBudgetValue);
            setCardBudgets((prev) => ({ ...prev, [issueKey]: isNaN(parsed) ? 0 : parsed }));
            setEditingBudgetCardId("");
          };

          const cancelEdit = () => setEditingBudgetCardId("");

          return (
            <div style={{ marginTop: "8px", borderTop: "1px solid #E2E8F0", paddingTop: "8px", fontSize: "0.82rem" }}>
              {/* Editable budget row */}
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                <strong style={{ color: "#475569" }}>Budget hours:</strong>
                {isEditing ? (
                  <>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={editingBudgetValue}
                      onChange={(e) => setEditingBudgetValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") cancelEdit(); }}
                      autoFocus
                      style={{
                        width: "70px", padding: "2px 4px", fontSize: "0.82rem",
                        border: "1px solid #2563EB", borderRadius: "4px",
                      }}
                    />
                    <button onClick={saveEdit} style={{ background: "#2563EB", color: "#fff", border: "none", borderRadius: "4px", padding: "2px 7px", cursor: "pointer", fontSize: "0.78rem" }}>✓</button>
                    <button onClick={cancelEdit} style={{ background: "#E2E8F0", border: "none", borderRadius: "4px", padding: "2px 7px", cursor: "pointer", fontSize: "0.78rem" }}>✕</button>
                  </>
                ) : (
                  <>
                    <span style={{ fontWeight: 600, color: "#0F172A" }}>
                      {budgetH > 0 ? `${budgetH}h` : <em style={{ color: "#94A3B8" }}>not set</em>}
                    </span>
                    <button
                      onClick={startEdit}
                      title="Edit budget hours"
                      style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", fontSize: "0.8rem", color: "#64748B" }}
                    >✏️</button>
                  </>
                )}
              </div>
              {/* Hours used + progress bar */}
              {budgetH > 0 ? (() => {
                const budgetMs = budgetH * 3600000;
                const pct = Math.min(Math.round((usedMs / budgetMs) * 100), 999);
                const barColor = pct >= 100 ? "#EF4444" : pct >= 80 ? "#F59E0B" : "#10B981";
                return (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", color: "#475569", marginBottom: "2px" }}>
                      <strong>Hours used:</strong>
                      <span style={{ fontWeight: 700, color: pct >= 100 ? "#EF4444" : "#0F172A" }}>
                        {usedLabel} / {budgetH}h ({pct}%)
                      </span>
                    </div>
                    <div style={{ height: "5px", borderRadius: "3px", background: "#E2E8F0", overflow: "hidden" }}>
                      <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", borderRadius: "3px", background: barColor }} />
                    </div>
                  </>
                );
              })() : (
                <div style={{ color: "#475569" }}><strong>Hours used:</strong> {usedLabel}</div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
    );
  };

  return (
    <div style={{ ...commonStyles.fullWidthContainer, paddingTop: "2rem", paddingBottom: "2rem" }}>
      <Link to={`${routePrefix}/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to My Organization
      </Link>

      <TimeRotateTopLogo />

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
            <h1 style={{ ...commonStyles.title, marginBottom: "6px" }}>TimeRotate In Progress Notes</h1>
            <p style={{ margin: 0, color: "#475569" }}>
              Dedicated live view for notes plus users who need follow-up.
            </p>
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
          <Link to={`${routePrefix}/${id}/time-rotate-card-hours`} style={tabStyle(false)}>
            ◶ Card Hours
          </Link>
          <Link to={`${routePrefix}/${id}/time-rotate-notes?view=floor-planner`} style={tabStyle(activeTab === FLOOR_PLANNER_TAB)}>
            ⌖ Floor Planner
          </Link>
          <Link to={`${routePrefix}/${id}/time-rotate-notes?view=floor-progress`} style={tabStyle(activeTab === FLOOR_PROGRESS_TAB)}>
            % Floor Progress
          </Link>
          <Link to={`${routePrefix}/${id}/time-rotate-notes?view=card-review`} style={tabStyle(activeTab === CARD_REVIEW_TAB)}>
            ☑ Card Review
          </Link>
        </div>

        {activeTab === FLOOR_PROGRESS_TAB ? (
          <div style={{ marginTop: "8px" }}>
            <h2 style={{ margin: 0, fontSize: "1.05rem", color: "#0F172A" }}>Project Floor Progress</h2>
            <p style={{ margin: "6px 0 12px", color: "#64748B", fontSize: "0.9rem" }}>
              Review every project and floor in one place, then add multiple category percentages for each floor from a shared catalog.
            </p>

            {floorProgressStatusMessage ? (
              <p style={{ marginTop: "10px", marginBottom: 0, color: "#166534", fontWeight: 600 }}>{floorProgressStatusMessage}</p>
            ) : null}

            <div style={{ ...plannerPanelStyle, marginTop: "12px" }}>
              <h3 style={plannerHeadingStyle}>Category Catalog</h3>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <input
                  type="text"
                  value={newFloorProgressCatalogName}
                  onChange={(event) => setNewFloorProgressCatalogName(event.target.value)}
                  placeholder="Create reusable category"
                  style={plannerInputStyle}
                />
                <button type="button" onClick={handleCreateFloorProgressCatalogCategory} style={plannerButtonStyle}>
                  Add to Catalog
                </button>
              </div>
              <div style={{ marginTop: "10px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {floorProgressCatalog.length === 0 ? (
                  <span style={{ color: "#64748B", fontSize: "0.84rem" }}>No catalog categories yet.</span>
                ) : (
                  floorProgressCatalog.map((catalogEntry) => (
                    <span key={catalogEntry.id} style={floorProgressCatalogChipStyle}>
                      <span>{catalogEntry.name}</span>
                      <button
                        type="button"
                        onClick={() => handleDeleteFloorProgressCatalogCategory(catalogEntry.id)}
                        style={{
                          border: "none",
                          background: "transparent",
                          color: "#B91C1C",
                          cursor: "pointer",
                          fontWeight: 700,
                          fontSize: "0.8rem",
                          padding: 0,
                          lineHeight: 1,
                        }}
                        aria-label={`Delete ${catalogEntry.name} category`}
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>
            </div>

            {floorProgressProjects.length === 0 ? (
              <p style={{ marginTop: "12px", color: "#64748B" }}>
                No planner projects exist yet. Create projects and floors in Floor Planner first.
              </p>
            ) : (
              <div style={{ marginTop: "14px", display: "grid", gap: "14px" }}>
                {floorProgressProjects.map((project) => {
                  const projectFloors = Array.isArray(project.floors) ? project.floors : [];

                  return (
                    <div key={project.id} style={floorProgressProjectCardStyle}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                        <div>
                          <h3 style={{ margin: 0, color: "#0F172A", fontSize: "1rem" }}>{project.name}</h3>
                          <p style={{ margin: "4px 0 0", color: "#64748B", fontSize: "0.85rem" }}>
                            {projectFloors.length} floor{projectFloors.length === 1 ? "" : "s"}
                          </p>
                        </div>
                      </div>

                      {projectFloors.length === 0 ? (
                        <p style={{ margin: 0, color: "#64748B" }}>No floors added to this project yet.</p>
                      ) : (
                        <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
                          {projectFloors.map((floor) => {
                            const floorDraft = floorProgressDrafts?.[project.id]?.[floor.id] || { catalogId: "", name: "", percent: "" };
                            const floorCategories = Array.isArray(floor.categories) ? floor.categories : [];
                            const floorLogs = Array.isArray(floor.logs) ? floor.logs : [];
                            const floorSummary = floorSummaryById.get(floor.id);
                            const hasCatalogCategories = floorProgressCatalog.length > 0;
                            const isAddingNewCategory = !hasCatalogCategories || floorDraft.catalogId === ADD_NEW_PROGRESS_CATEGORY_OPTION;
                            const hasDraftCategory = Boolean(
                              isAddingNewCategory
                                ? normalizeValue(floorDraft.name)
                                : normalizeValue(floorDraft.catalogId) && normalizeValue(floorDraft.catalogId) !== ADD_NEW_PROGRESS_CATEGORY_OPTION
                            );

                            return (
                              <div key={floor.id} style={floorProgressFloorCardStyle}>
                                <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                                  <div>
                                    <div style={{ color: "#0F172A", fontWeight: 800, fontSize: "0.95rem" }}>{floor.name}</div>
                                    <div style={{ color: "#64748B", fontSize: "0.8rem" }}>
                                      Cards: {floorSummary?.cardCount || 0} | In progress: {floorSummary?.inProgressCount || 0}
                                    </div>
                                  </div>
                                </div>

                                {Array.isArray(floorSummary?.inProgressPeople) && floorSummary.inProgressPeople.length > 0 ? (
                                  <div style={floorProgressPeopleWrapStyle}>
                                    {floorSummary.inProgressPeople.map((person) => (
                                      <div key={`${floor.id}-${person.name}`} style={floorProgressPersonRowStyle} title={person.name}>
                                        {person.avatarUrl ? (
                                          <img
                                            src={person.avatarUrl}
                                            alt={person.name}
                                            style={floorProgressAvatarStyle}
                                          />
                                        ) : (
                                          <div style={floorProgressAvatarFallbackStyle}>
                                            {getInitials(person.name)}
                                          </div>
                                        )}
                                        <span style={floorProgressPersonNameStyle}>{person.name}</span>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}

                                <div style={{ display: "grid", gap: "8px", marginTop: "10px" }}>
                                  <div style={{ display: "grid", gridTemplateColumns: hasCatalogCategories ? "minmax(0, 1fr) minmax(0, 1fr) 110px auto" : "minmax(0, 1fr) 110px auto", gap: "8px", alignItems: "center" }}>
                                    {hasCatalogCategories ? (
                                      <select
                                        value={floorDraft.catalogId}
                                        onChange={(event) => {
                                          const nextCatalogId = event.target.value;
                                          const matchedCatalogEntry = floorProgressCatalogMap[nextCatalogId] || null;
                                          handleFloorProgressDraftChange(project.id, floor.id, "catalogId", nextCatalogId);
                                          handleFloorProgressDraftChange(
                                            project.id,
                                            floor.id,
                                            "name",
                                            nextCatalogId === ADD_NEW_PROGRESS_CATEGORY_OPTION
                                              ? ""
                                              : normalizeValue(matchedCatalogEntry?.name)
                                          );
                                        }}
                                        style={plannerInputStyle}
                                      >
                                        <option value="">Select catalog category</option>
                                        {floorProgressCatalog.map((catalogEntry) => (
                                          <option key={catalogEntry.id} value={catalogEntry.id}>{catalogEntry.name}</option>
                                        ))}
                                        <option value={ADD_NEW_PROGRESS_CATEGORY_OPTION}>Add new category</option>
                                      </select>
                                    ) : null}
                                    {isAddingNewCategory ? (
                                      <input
                                        type="text"
                                        value={floorDraft.name}
                                        onChange={(event) => handleFloorProgressDraftChange(project.id, floor.id, "name", event.target.value)}
                                        placeholder="Add new category"
                                        style={plannerInputStyle}
                                      />
                                    ) : (
                                      <div style={floorProgressResolvedNameStyle}>
                                        {normalizeValue(floorProgressCatalogMap[normalizeValue(floorDraft.catalogId)]?.name || floorDraft.name) || "Select category"}
                                      </div>
                                    )}
                                    <input
                                      type="number"
                                      min="0"
                                      max="100"
                                      step="0.01"
                                      value={floorDraft.percent}
                                      onChange={(event) => handleFloorProgressDraftChange(project.id, floor.id, "percent", event.target.value)}
                                      placeholder={hasDraftCategory ? "%" : "Add category first"}
                                      disabled={!hasDraftCategory}
                                      style={{ ...plannerInputStyle, width: "100%" }}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => handleAddFloorProgressCategory(project.id, floor.id)}
                                      disabled={!hasDraftCategory}
                                      style={plannerButtonStyle}
                                    >
                                      Add
                                    </button>
                                  </div>

                                  {floorCategories.length === 0 ? (
                                    <p style={{ margin: 0, color: "#64748B", fontSize: "0.84rem" }}>
                                      No progress categories for this floor yet.
                                    </p>
                                  ) : (
                                    <div style={{ display: "grid", gap: "8px" }}>
                                      {floorCategories.map((categoryEntry) => (
                                        <div key={categoryEntry.id} style={floorProgressCategoryRowStyle}>
                                          {(() => {
                                            const draftKey = buildFloorProgressEntryDraftKey(project.id, floor.id, categoryEntry.id);
                                            const hasPercentDraft = Object.prototype.hasOwnProperty.call(floorProgressPercentDrafts, draftKey);
                                            const percentInputValue = hasPercentDraft
                                              ? floorProgressPercentDrafts[draftKey]
                                              : String(normalizePercentValue(categoryEntry.percent));

                                            return (
                                              <>
                                          <select
                                            value={normalizeValue(categoryEntry.catalogId)}
                                            onChange={(event) => handleUpdateFloorProgressEntry(project.id, floor.id, categoryEntry.id, "catalogId", event.target.value)}
                                            style={plannerInputStyle}
                                          >
                                            <option value="">Keep current category</option>
                                            {floorProgressCatalog.map((catalogEntry) => (
                                              <option key={catalogEntry.id} value={catalogEntry.id}>{catalogEntry.name}</option>
                                            ))}
                                          </select>
                                          <div style={floorProgressPercentInputWrapStyle}>
                                            <input
                                              type="number"
                                              min="0"
                                              max="100"
                                              step="0.01"
                                              value={percentInputValue}
                                              onChange={(event) => handleFloorProgressPercentDraftChange(project.id, floor.id, categoryEntry.id, event.target.value)}
                                              onBlur={() => commitFloorProgressPercentDraft(project.id, floor.id, categoryEntry)}
                                              onKeyDown={(event) => {
                                                if (event.key === "Enter") {
                                                  event.preventDefault();
                                                  commitFloorProgressPercentDraft(project.id, floor.id, categoryEntry);
                                                }
                                              }}
                                              style={{ ...plannerInputStyle, width: "100%" }}
                                            />
                                            <span style={floorProgressPercentSuffixStyle}>%</span>
                                          </div>
                                          <button
                                            type="button"
                                            onClick={() => handleDeleteFloorProgressEntry(project.id, floor.id, categoryEntry.id)}
                                            style={floorProgressDeleteButtonStyle}
                                          >
                                            Delete
                                          </button>
                                          <div style={floorProgressResolvedNameStyle}>
                                            {normalizeValue(floorProgressCatalogMap[normalizeValue(categoryEntry.catalogId)]?.name || categoryEntry.name)}
                                          </div>
                                          <div style={floorProgressTimestampStyle}>
                                            Last % update: {formatDetailedTimestamp(categoryEntry.updatedAt)}
                                          </div>
                                              </>
                                            );
                                          })()}
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                  <div style={floorProgressLogPanelStyle}>
                                    <div style={floorProgressLogHeadingStyle}>Update Log</div>
                                    {floorLogs.length === 0 ? (
                                      <div style={floorProgressLogEmptyStyle}>No % updates yet for this floor.</div>
                                    ) : (
                                      <div style={{ display: "grid", gap: "6px" }}>
                                        {floorLogs.map((logEntry) => (
                                          <div key={logEntry.id} style={floorProgressLogRowStyle}>
                                            <div style={floorProgressLogRowTopStyle}>
                                              <span style={floorProgressLogTimeStyle}>{formatDetailedTimestamp(logEntry.timestamp)}</span>
                                              <button
                                                type="button"
                                                onClick={() => handleDeleteFloorProgressLogEntry(project.id, floor.id, logEntry.id)}
                                                style={floorProgressLogDeleteButtonStyle}
                                              >
                                                Delete
                                              </button>
                                            </div>
                                            <span style={floorProgressLogMessageStyle}>{logEntry.message}</span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : activeTab === CARD_REVIEW_TAB ? (
          <div style={{ marginTop: "8px" }}>
            <h2 style={{ margin: 0, fontSize: "1.05rem", color: "#0F172A" }}>Card Review</h2>
            <p style={{ margin: "6px 0 12px", color: "#64748B", fontSize: "0.9rem" }}>
              Review every floor and every card, then move each card through: Populate, Coordinate Internal,
              Coordinate Other Trades, Existing Modeling, Add Hangers, Add Hangers With Seismic, Shop Creation,
              and Change Orders.
            </p>
            <p style={{ margin: "-4px 0 12px", color: "#475569", fontSize: "0.84rem", fontWeight: 600 }}>
              Drag cards between floor columns to match floors; this updates Floor Planner assignments automatically.
            </p>

            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
              <label htmlFor="card-review-sort" style={{ color: "#334155", fontWeight: 600, fontSize: "0.88rem" }}>
                Sort cards by:
              </label>
              <select
                id="card-review-sort"
                value={cardReviewSortBy}
                onChange={(event) => setCardReviewSortBy(event.target.value)}
                style={{ ...plannerInputStyle, minWidth: "190px" }}
              >
                <option value="step">Workflow Step</option>
                <option value="id">Card ID</option>
                <option value="title">Card Title</option>
              </select>
            </div>

            {cardReviewProjects.length === 0 ? (
              <p style={{ marginTop: "12px", color: "#64748B" }}>
                No planner projects exist yet. Create projects and floors in Floor Planner first.
              </p>
            ) : (
              <div style={{ marginTop: "14px", display: "grid", gap: "14px" }}>
                {cardReviewProjects.map((project) => (
                  <div key={project.id} style={floorProgressProjectCardStyle}>
                    <h3 style={{ margin: 0, color: "#0F172A", fontSize: "1rem" }}>{project.name}</h3>

                    {(Array.isArray(project.floors) ? project.floors.filter((floor) => !floor.isVirtualUnassigned) : []).length === 0 ? (
                      <p style={{ marginTop: "8px", color: "#64748B" }}>No floors added to this project yet.</p>
                    ) : (
                      <div style={{ marginTop: "12px", display: "grid", gap: "12px" }}>
                        {project.floors.filter((floor) => !floor.isVirtualUnassigned).map((floor) => (
                          <div key={floor.id} style={floorProgressFloorCardStyle}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                              <div style={{ color: "#0F172A", fontWeight: 800, fontSize: "0.95rem" }}>{floor.name}</div>
                              <div style={{ color: "#64748B", fontSize: "0.82rem" }}>
                                {floor.cards.length} card{floor.cards.length === 1 ? "" : "s"}
                              </div>
                            </div>

                            {floor.cards.length === 0 ? (
                              <p style={{ margin: "8px 0 0", color: "#64748B", fontSize: "0.84rem" }}>
                                No cards assigned to this floor yet. Drag a card here.
                              </p>
                            ) : null}

                            <div style={{ marginTop: "10px", display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                              {CARD_REVIEW_STEPS.map((step) => {
                                const stepCards = floor.cardsByStep?.[step.id] || [];
                                return (
                                  <div
                                    key={`${floor.id}-${step.id}`}
                                    onDragOver={(event) => event.preventDefault()}
                                    onDrop={() => handleCardReviewDrop(project.id, floor.id, step.id)}
                                    style={{
                                      border: "1px solid #CBD5E1",
                                      borderRadius: "10px",
                                      backgroundColor: "#F8FAFC",
                                      padding: "8px",
                                      minHeight: "100px",
                                    }}
                                  >
                                    <div style={{ color: "#1E293B", fontWeight: 800, fontSize: "0.83rem", marginBottom: "6px" }}>
                                      {step.label} ({stepCards.length})
                                    </div>

                                    {stepCards.length === 0 ? (
                                      <div style={{ color: "#94A3B8", fontSize: "0.8rem" }}>Drop card here</div>
                                    ) : (
                                      <div style={{ display: "grid", gap: "6px" }}>
                                        {stepCards.map((entry) => (
                                          <div
                                            key={`${floor.id}-${entry.cardRef}`}
                                            draggable
                                            onDragStart={() => handleCardReviewDragStart(project.id, floor.id, entry.cardRef)}
                                            style={{
                                              border: "1px solid #E2E8F0",
                                              borderRadius: "8px",
                                              backgroundColor: "#FFFFFF",
                                              padding: "8px",
                                              cursor: "grab",
                                            }}
                                          >
                                            <div style={{ color: "#0F172A", fontWeight: 800, fontSize: "0.82rem" }}>
                                              {entry.issueId || "-"}
                                            </div>
                                            <div style={{ marginTop: "2px", color: "#0F172A", fontSize: "0.82rem", fontWeight: 700 }}>
                                              {entry.title || "-"}
                                            </div>
                                            <div style={{ marginTop: "2px", color: "#475569", fontSize: "0.8rem" }}>
                                              {entry.projectName || "No project"}
                                            </div>
                                            {(() => {
                                              const totalMs = hoursPerIssue.get(normalizeValue(entry.issueId)) || 0;
                                              const activeUsers = Array.isArray(entry.card?.inProgressUsers) ? entry.card.inProgressUsers : [];
                                              return (
                                                <>
                                                  <div style={{ marginTop: "4px", color: "#334155", fontSize: "0.78rem" }}>
                                                    <strong>Total hrs:</strong> {totalMs > 0 ? formatDurationMs(totalMs) : "0m"}
                                                  </div>
                                                  <div style={{ marginTop: "2px", color: "#334155", fontSize: "0.78rem" }}>
                                                    <strong>Current on card:</strong> {activeUsers.length > 0 ? activeUsers.join(", ") : "-"}
                                                  </div>
                                                </>
                                              );
                                            })()}
                                            <select
                                              value={entry.step}
                                              onChange={(event) => handleSetCardReviewStep(project.id, floor.id, entry.cardRef, event.target.value)}
                                              style={{ ...plannerInputStyle, marginTop: "6px", width: "100%", padding: "6px 8px", fontSize: "0.8rem" }}
                                            >
                                              {CARD_REVIEW_STEPS.map((stepOption) => (
                                                <option key={stepOption.id} value={stepOption.id}>{stepOption.label}</option>
                                              ))}
                                            </select>
                                            {floor.isVirtualUnassigned ? (() => {
                                              const moveKey = buildCardReviewMoveKey(project.id, entry.cardRef);
                                              const moveState = cardReviewMoveTargets?.[moveKey] || { projectId: "", floorId: "" };
                                              const selectedTargetProject = plannerProjects.find(
                                                (plannerProject) => normalizeValue(plannerProject.id) === normalizeValue(moveState.projectId)
                                              ) || null;
                                              const targetFloors = Array.isArray(selectedTargetProject?.floors)
                                                ? selectedTargetProject.floors
                                                : [];

                                              return (
                                                <>
                                                  <select
                                                    value={moveState.projectId}
                                                    onChange={(event) => handleCardReviewMoveProjectChange(project.id, entry.cardRef, event.target.value)}
                                                    style={{ ...plannerInputStyle, marginTop: "6px", width: "100%", padding: "6px 8px", fontSize: "0.8rem" }}
                                                  >
                                                    <option value="">Move to project...</option>
                                                    {cardReviewMoveProjectOptions.map((projectOption) => (
                                                        <option
                                                          key={`move-project-${entry.cardRef}-${projectOption.id}`}
                                                          value={projectOption.id}
                                                          disabled={!projectOption.selectable}
                                                        >
                                                          {projectOption.label}
                                                        </option>
                                                      ))}
                                                  </select>

                                                  <select
                                                    value={moveState.floorId}
                                                    onChange={(event) => handleCardReviewMoveFloorChange(project.id, entry.cardRef, event.target.value)}
                                                    disabled={!moveState.projectId || targetFloors.length === 0}
                                                    style={{ ...plannerInputStyle, marginTop: "6px", width: "100%", padding: "6px 8px", fontSize: "0.8rem" }}
                                                  >
                                                    <option value="">Select floor...</option>
                                                    {targetFloors.map((targetFloor) => (
                                                      <option key={`move-floor-${entry.cardRef}-${targetFloor.id}`} value={targetFloor.id}>
                                                        {targetFloor.name}
                                                      </option>
                                                    ))}
                                                  </select>

                                                  <button
                                                    type="button"
                                                    onClick={() => handleMoveUnassignedCardToProject(project.id, entry.cardRef, moveState.projectId, moveState.floorId, entry.step)}
                                                    disabled={!moveState.projectId || !moveState.floorId}
                                                    style={{ ...plannerButtonStyle, marginTop: "6px", width: "100%", padding: "6px 8px", fontSize: "0.8rem" }}
                                                  >
                                                    Move Card
                                                  </button>
                                                </>
                                              );
                                            })() : null}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                <div key="global-unassigned-card-review" style={floorProgressProjectCardStyle}>
                  <h3 style={{ margin: 0, color: "#0F172A", fontSize: "1rem" }}>{cardReviewGlobalUnassignedFloor.name}</h3>
                  <p style={{ margin: "4px 0 0", color: "#64748B", fontSize: "0.85rem" }}>
                    One shared section for cards not assigned to a mapped floor.
                  </p>

                  {cardReviewGlobalUnassignedFloor.cards.length === 0 ? (
                    <p style={{ marginTop: "8px", color: "#64748B" }}>No unassigned cards.</p>
                  ) : (
                    <div style={{ marginTop: "12px", display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                      {CARD_REVIEW_STEPS.map((step) => {
                        const stepCards = cardReviewGlobalUnassignedFloor.cardsByStep?.[step.id] || [];
                        return (
                          <div
                            key={`global-unassigned-${step.id}`}
                            style={{
                              border: "1px solid #CBD5E1",
                              borderRadius: "10px",
                              backgroundColor: "#F8FAFC",
                              padding: "8px",
                              minHeight: "100px",
                            }}
                          >
                            <div style={{ color: "#1E293B", fontWeight: 800, fontSize: "0.83rem", marginBottom: "6px" }}>
                              {step.label} ({stepCards.length})
                            </div>

                            {stepCards.length === 0 ? (
                              <div style={{ color: "#94A3B8", fontSize: "0.8rem" }}>No cards</div>
                            ) : (
                              <div style={{ display: "grid", gap: "6px" }}>
                                {stepCards.map((entry) => {
                                  const sourceProjectId = normalizeValue(entry.sourceProjectId);
                                  return (
                                    <div
                                      key={`global-unassigned-${entry.cardRef}`}
                                      draggable
                                      onDragStart={() => handleCardReviewDragStart(sourceProjectId, UNASSIGNED_FLOOR_TAB_ID, entry.cardRef)}
                                      style={{
                                        border: "1px solid #E2E8F0",
                                        borderRadius: "8px",
                                        backgroundColor: "#FFFFFF",
                                        padding: "8px",
                                        cursor: "grab",
                                      }}
                                    >
                                      <div style={{ color: "#0F172A", fontWeight: 800, fontSize: "0.82rem" }}>
                                        {entry.issueId || "-"}
                                      </div>
                                      <div style={{ marginTop: "2px", color: "#0F172A", fontSize: "0.82rem", fontWeight: 700 }}>
                                        {entry.title || "-"}
                                      </div>
                                      <div style={{ marginTop: "2px", color: "#475569", fontSize: "0.8rem" }}>
                                        {entry.projectName || "No project"}
                                      </div>
                                      <select
                                        value={entry.step}
                                        onChange={(event) => handleSetCardReviewStep(sourceProjectId, UNASSIGNED_FLOOR_TAB_ID, entry.cardRef, event.target.value)}
                                        style={{ ...plannerInputStyle, marginTop: "6px", width: "100%", padding: "6px 8px", fontSize: "0.8rem" }}
                                      >
                                        {CARD_REVIEW_STEPS.map((stepOption) => (
                                          <option key={`global-unassigned-step-${entry.cardRef}-${stepOption.id}`} value={stepOption.id}>{stepOption.label}</option>
                                        ))}
                                      </select>
                                      {(() => {
                                        const moveKey = buildCardReviewMoveKey(sourceProjectId, entry.cardRef);
                                        const moveState = cardReviewMoveTargets?.[moveKey] || { projectId: "", floorId: "" };
                                        const selectedTargetProject = plannerProjects.find(
                                          (plannerProject) => normalizeValue(plannerProject.id) === normalizeValue(moveState.projectId)
                                        ) || null;
                                        const targetFloors = Array.isArray(selectedTargetProject?.floors)
                                          ? selectedTargetProject.floors
                                          : [];

                                        return (
                                          <>
                                            <select
                                              value={moveState.projectId}
                                              onChange={(event) => handleCardReviewMoveProjectChange(sourceProjectId, entry.cardRef, event.target.value)}
                                              style={{ ...plannerInputStyle, marginTop: "6px", width: "100%", padding: "6px 8px", fontSize: "0.8rem" }}
                                            >
                                              <option value="">Move to project...</option>
                                              {cardReviewMoveProjectOptions.map((projectOption) => (
                                                <option
                                                  key={`global-unassigned-move-project-${entry.cardRef}-${projectOption.id}`}
                                                  value={projectOption.id}
                                                  disabled={!projectOption.selectable}
                                                >
                                                  {projectOption.label}
                                                </option>
                                              ))}
                                            </select>

                                            <select
                                              value={moveState.floorId}
                                              onChange={(event) => handleCardReviewMoveFloorChange(sourceProjectId, entry.cardRef, event.target.value)}
                                              disabled={!moveState.projectId || targetFloors.length === 0}
                                              style={{ ...plannerInputStyle, marginTop: "6px", width: "100%", padding: "6px 8px", fontSize: "0.8rem" }}
                                            >
                                              <option value="">Select floor...</option>
                                              {targetFloors.map((targetFloor) => (
                                                <option key={`global-unassigned-move-floor-${entry.cardRef}-${targetFloor.id}`} value={targetFloor.id}>
                                                  {targetFloor.name}
                                                </option>
                                              ))}
                                            </select>

                                            <button
                                              type="button"
                                              onClick={() => handleMoveUnassignedCardToProject(sourceProjectId, entry.cardRef, moveState.projectId, moveState.floorId, entry.step)}
                                              disabled={!moveState.projectId || !moveState.floorId}
                                              style={{ ...plannerButtonStyle, marginTop: "6px", width: "100%", padding: "6px 8px", fontSize: "0.8rem" }}
                                            >
                                              Move Card
                                            </button>
                                          </>
                                        );
                                      })()}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : activeTab === FLOOR_PLANNER_TAB ? (
          <div style={{ marginTop: "8px" }}>
            <h2 style={{ margin: 0, fontSize: "1.05rem", color: "#0F172A" }}>Projects and Floors Planner</h2>
            <p style={{ margin: "6px 0 12px", color: "#64748B", fontSize: "0.9rem" }}>
              Create projects and floors, then drag production cards into the correct floor to track where work should happen.
            </p>

            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginBottom: "12px" }}>
              <span style={{ fontWeight: 600, color: "#334155", fontSize: "0.88rem" }}>Filter by date:</span>
              {[
                { value: "", label: "All time" },
                { value: "today", label: "Today" },
                { value: "yesterday", label: "Yesterday" },
                { value: "thisWeek", label: "This week" },
                { value: "lastWeek", label: "Last week" },
                { value: "lastMonth", label: "Last month" },
              ].map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPlannerDateFilter(value)}
                  style={{
                    padding: "5px 12px",
                    borderRadius: "999px",
                    fontSize: "0.82rem",
                    fontWeight: 700,
                    cursor: "pointer",
                    border: plannerDateFilter === value ? "1px solid #2563EB" : "1px solid #CBD5E1",
                    backgroundColor: plannerDateFilter === value ? "#EFF6FF" : "#FFFFFF",
                    color: plannerDateFilter === value ? "#1D4ED8" : "#334155",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
              <div style={plannerPanelStyle}>
                <h3 style={plannerHeadingStyle}>Create Project</h3>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(event) => setNewProjectName(event.target.value)}
                    placeholder="Ex: Building A Production"
                    style={plannerInputStyle}
                  />
                  <button type="button" onClick={handleCreateProject} style={plannerButtonStyle}>Add</button>
                </div>
              </div>

              <div style={plannerPanelStyle}>
                <h3 style={plannerHeadingStyle}>Select Project</h3>
                <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                  <button
                    type="button"
                    onClick={goToPreviousProject}
                    style={plannerButtonSecondaryStyle}
                    disabled={!canGoToPreviousProject}
                  >
                    ← Previous
                  </button>
                  <button
                    type="button"
                    onClick={goToNextProject}
                    style={plannerButtonSecondaryStyle}
                    disabled={!canGoToNextProject}
                  >
                    Next →
                  </button>
                </div>
                <select
                  value={selectedPlannerProjectId}
                  onChange={(event) => setSelectedPlannerProjectId(event.target.value)}
                  style={{ ...plannerInputStyle, width: "100%" }}
                >
                  <option value="">Choose project</option>
                  {plannerProjects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
                <div style={{ marginTop: "8px", display: "flex", gap: "6px", flexWrap: "wrap", maxHeight: "84px", overflowY: "auto" }}>
                  {plannerProjects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => setSelectedPlannerProjectId(project.id)}
                      style={{
                        border: project.id === selectedPlannerProjectId ? "1px solid #2563EB" : "1px solid #CBD5E1",
                        borderRadius: "999px",
                        backgroundColor: project.id === selectedPlannerProjectId ? "#EFF6FF" : "#FFFFFF",
                        color: project.id === selectedPlannerProjectId ? "#1D4ED8" : "#334155",
                        fontSize: "0.78rem",
                        fontWeight: 700,
                        padding: "4px 10px",
                        cursor: "pointer",
                      }}
                      title={`Switch to ${project.name}`}
                    >
                      {project.name}
                    </button>
                  ))}
                </div>
              </div>

              <div style={plannerPanelStyle}>
                <h3 style={plannerHeadingStyle}>Create Floor</h3>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="text"
                    value={newFloorName}
                    onChange={(event) => setNewFloorName(event.target.value)}
                    placeholder="Ex: Floor 1"
                    style={plannerInputStyle}
                    disabled={!selectedPlannerProjectId}
                  />
                  <button type="button" onClick={handleCreateFloor} style={plannerButtonStyle} disabled={!selectedPlannerProjectId}>
                    Add
                  </button>
                </div>
              </div>
            </div>

            {plannerStatusMessage ? (
              <p style={{ marginTop: "10px", marginBottom: 0, color: "#166534", fontWeight: 600 }}>{plannerStatusMessage}</p>
            ) : null}

            {!selectedPlannerProject ? (
              <p style={{ marginTop: "12px", color: "#64748B" }}>
                Create or select a project to start assigning cards to floors.
              </p>
            ) : (
              <div style={{ marginTop: "14px", display: "grid", gap: "14px", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
                <div
                  style={{
                    border: "1px solid #CBD5E1",
                    borderRadius: "12px",
                    backgroundColor: "#F8FAFC",
                    padding: "10px",
                  }}
                >
                  <h3 style={{ ...plannerHeadingStyle, marginBottom: "8px" }}>High-Rise Floors</h3>
                  {selectedPlannerProject.floors.length === 0 ? (
                    <p style={{ margin: 0, color: "#64748B" }}>No floors yet. Add floors to build the high-rise.</p>
                  ) : (
                    <div style={{ display: "grid", gap: "8px" }}>
                      {[...selectedPlannerProject.floors].map((floor, index) => {
                        const floorSummary = floorSummaryById.get(floor.id);
                        const isSelectedFloor = floor.id === selectedFloorId;
                        const isEditingFloor = floor.id === editingFloorId;

                        return (
                          <div
                            key={floor.id}
                            onClick={() => selectPlannerFloor(floor.id)}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={() => handleCardDropToFloor(floor.id)}
                            style={{
                              border: isSelectedFloor ? "2px solid #2563EB" : "1px solid #94A3B8",
                              borderRadius: "10px",
                              padding: "10px",
                              backgroundColor: isSelectedFloor ? "#DBEAFE" : "#FFFFFF",
                              textAlign: "left",
                              cursor: "pointer",
                            }}
                            title="Click floor name to open and drop cards here"
                          >
                            {isEditingFloor ? (
                              <div style={{ display: "grid", gap: "6px" }} onClick={(event) => event.stopPropagation()}>
                                <input
                                  type="text"
                                  value={editingFloorName}
                                  onChange={(event) => setEditingFloorName(event.target.value)}
                                  style={plannerInputStyle}
                                  autoFocus
                                />
                                <div style={{ display: "flex", gap: "6px" }}>
                                  <button type="button" onClick={saveFloorEdit} style={plannerTinyButtonStyle}>Save</button>
                                  <button type="button" onClick={cancelFloorEdit} style={plannerTinyButtonStyle}>Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    selectPlannerFloor(floor.id);
                                  }}
                                  style={plannerFloorSelectButtonStyle}
                                >
                                  {floor.name}
                                </button>
                                <div style={{ marginTop: "6px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      moveFloor(floor.id, -1);
                                    }}
                                    disabled={index === 0}
                                    style={plannerTinyButtonStyle}
                                  >
                                    Move Up
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      moveFloor(floor.id, 1);
                                    }}
                                    disabled={index === selectedPlannerProject.floors.length - 1}
                                    style={plannerTinyButtonStyle}
                                  >
                                    Move Down
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      startFloorEdit(floor);
                                    }}
                                    style={plannerTinyButtonStyle}
                                  >
                                    Edit
                                  </button>
                                </div>
                              </>
                            )}
                            <div style={{ marginTop: "4px", fontSize: "0.8rem", color: "#334155" }}>
                              Cards: {floorSummary?.cardCount || 0} | In progress: {floorSummary?.inProgressCount || 0}
                            </div>
                            {Array.isArray(floorSummary?.inProgressPeople) && floorSummary.inProgressPeople.length > 0 ? (
                              <div style={{ marginTop: "8px", display: "grid", gap: "4px" }}>
                                {floorSummary.inProgressPeople.map((person) => (
                                  <div
                                    key={`${floor.id}-${person.name}`}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "6px",
                                      fontSize: "0.76rem",
                                      color: "#1E293B",
                                      lineHeight: 1.2,
                                    }}
                                    title={person.name}
                                  >
                                    {person.avatarUrl ? (
                                      <img
                                        src={person.avatarUrl}
                                        alt={person.name}
                                        style={{
                                          width: "20px",
                                          height: "20px",
                                          borderRadius: "999px",
                                          objectFit: "cover",
                                          border: "1px solid #CBD5E1",
                                          flexShrink: 0,
                                        }}
                                      />
                                    ) : (
                                      <div
                                        style={{
                                          width: "20px",
                                          height: "20px",
                                          borderRadius: "999px",
                                          border: "1px solid #CBD5E1",
                                          backgroundColor: "#E2E8F0",
                                          color: "#334155",
                                          fontSize: "0.62rem",
                                          fontWeight: 800,
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          flexShrink: 0,
                                        }}
                                      >
                                        {getInitials(person.name)}
                                      </div>
                                    )}
                                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                      {person.name}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div
                    style={{ marginTop: "10px", paddingTop: "8px", borderTop: "1px dashed #CBD5E1" }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={handleCardDropToUnassignedTab}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedFloorId(UNASSIGNED_FLOOR_TAB_ID)}
                      style={{
                        width: "100%",
                        border: isUnassignedTabActive ? "2px solid #2563EB" : "1px solid #94A3B8",
                        borderRadius: "10px",
                        padding: "10px",
                        backgroundColor: isUnassignedTabActive ? "#DBEAFE" : "#FFFFFF",
                        textAlign: "left",
                        cursor: "pointer",
                        color: "#0F172A",
                        fontWeight: 800,
                        fontSize: "0.9rem",
                      }}
                    >
                      Unassigned Cards ({unassignedPlannerCards.length})
                    </button>
                  </div>
                </div>

                <div style={{ display: "grid", gap: "12px" }}>
                  <div
                    style={{
                      border: "1px solid #CBD5E1",
                      borderRadius: "12px",
                      padding: "12px",
                      backgroundColor: "#FFFFFF",
                      minHeight: "160px",
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (isUnassignedTabActive) {
                        handleCardDropToUnassigned();
                        return;
                      }

                      if (selectedFloorId) {
                        handleCardDropToFloor(selectedFloorId);
                      }
                    }}
                  >
                    <h3 style={{ ...plannerHeadingStyle, marginBottom: "8px" }}>
                      {isUnassignedTabActive
                        ? "Unassigned Cards"
                        : (selectedPlannerFloor ? `${selectedPlannerFloor.name} Cards` : "Select a floor")}
                    </h3>
                    {isUnassignedTabActive ? (
                      unassignedPlannerCards.length === 0 ? (
                        <p style={{ margin: 0, color: "#64748B" }}>No unassigned cards right now.</p>
                      ) : (
                        <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
                          {unassignedPlannerCards.map((card) => renderPlannerCard(card))}
                        </div>
                      )
                    ) : !selectedPlannerFloor ? (
                      <p style={{ margin: 0, color: "#64748B" }}>Choose a floor on the left high-rise to view its cards.</p>
                    ) : selectedFloorCards.length === 0 ? (
                      <p style={{ margin: 0, color: "#64748B" }}>Drop cards here.</p>
                    ) : (
                      <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
                        {selectedFloorCards.map((card) => renderPlannerCard(card))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>

        <div style={{ marginTop: "10px", display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
          <label htmlFor="notes-user-filter" style={{ color: "#334155", fontWeight: 600, fontSize: "0.9rem" }}>
            Filter by user:
          </label>
          <select
            id="notes-user-filter"
            value={selectedUser}
            onChange={(event) => setSelectedUser(event.target.value)}
            style={{
              minWidth: "240px",
              padding: "8px 10px",
              border: "1px solid #CBD5E1",
              borderRadius: "8px",
              backgroundColor: "#FFFFFF",
            }}
          >
            <option value="">All users</option>
            {userOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginTop: "16px", borderTop: "1px solid #E2E8F0", paddingTop: "14px" }}>
          <h2 style={{ margin: 0, fontSize: "1.05rem", color: "#0F172A" }}>Needs Attention</h2>
          <p style={{ margin: "6px 0 0", color: "#64748B", fontSize: "0.9rem" }}>
            Users shown here either have no active timer or have not added a note in the last hour.
          </p>

          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "10px" }}>
            <div style={summaryCardStyle("#FEF2F2", "#B91C1C")}>
              <div style={summaryLabelStyle}>Not started time</div>
              <div style={summaryCountStyle}>{attentionSummary.notStartedTime}</div>
            </div>
            <div style={summaryCardStyle("#FFF7ED", "#C2410C")}>
              <div style={summaryLabelStyle}>Started, no notes logged</div>
              <div style={summaryCountStyle}>{attentionSummary.noNotesLogged}</div>
            </div>
            <div style={summaryCardStyle("#FFFBEB", "#A16207")}>
              <div style={summaryLabelStyle}>Notes older than 1 hour</div>
              <div style={summaryCountStyle}>{attentionSummary.staleNotes}</div>
            </div>
          </div>

          <div style={{ marginTop: "12px", display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
            <div style={sectionListCardStyle("#FEF2F2", "#B91C1C")}>
              <h3 style={sectionListTitleStyle}>Not started time users</h3>
              {attentionSections.notStartedTime.length === 0 ? (
                <p style={sectionEmptyTextStyle}>No users in this section.</p>
              ) : (
                <ul style={sectionListStyle}>
                  {attentionSections.notStartedTime.map((row) => (
                    <li key={`not-started-${row.userId}`} style={sectionListItemStyle}>
                      {row.label}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div style={sectionListCardStyle("#FFF7ED", "#C2410C")}>
              <h3 style={sectionListTitleStyle}>Started, no notes users</h3>
              {attentionSections.noNotesLogged.length === 0 ? (
                <p style={sectionEmptyTextStyle}>No users in this section.</p>
              ) : (
                <ul style={sectionListStyle}>
                  {attentionSections.noNotesLogged.map((row) => (
                    <li key={`no-notes-${row.userId}`} style={sectionListItemStyle}>
                      {row.label}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div style={sectionListCardStyle("#FFFBEB", "#A16207")}>
              <h3 style={sectionListTitleStyle}>Stale note users</h3>
              {attentionSections.staleNotes.length === 0 ? (
                <p style={sectionEmptyTextStyle}>No users in this section.</p>
              ) : (
                <ul style={sectionListStyle}>
                  {attentionSections.staleNotes.map((row) => (
                    <li key={`stale-notes-${row.userId}`} style={sectionListItemStyle}>
                      {row.label}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {attentionRows.length === 0 ? (
            <p style={{ marginTop: "8px", marginBottom: 0, color: "#16A34A", fontWeight: 600 }}>
              All visible users are active and have recent notes.
            </p>
          ) : (
            <div style={{ marginTop: "10px", overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "720px" }}>
                <thead>
                  <tr style={{ background: "#F8FAFC" }}>
                    <th style={cellHeaderStyle}>User</th>
                    <th style={cellHeaderStyle}>Time Status</th>
                    <th style={cellHeaderStyle}>Notes Status</th>
                    <th style={cellHeaderStyle}>Latest Timer Start</th>
                    <th style={cellHeaderStyle}>Latest Note</th>
                    <th style={cellHeaderStyle}>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {attentionRows.map((row) => (
                    <tr key={row.userId}>
                      <td style={cellStyle}>{row.label}</td>
                      <td style={{ ...cellStyle, fontWeight: 700, color: row.notStartedTime ? "#B91C1C" : "#166534" }}>
                        {row.timeStatus}
                      </td>
                      <td
                        style={{
                          ...cellStyle,
                          fontWeight: 700,
                          color: row.noNotesLogged ? "#C2410C" : row.noteIsStale ? "#A16207" : "#166534",
                        }}
                      >
                        {row.notesStatus}
                      </td>
                      <td style={cellStyle}>{formatTimestamp(row.latestStart)}</td>
                      <td style={cellStyle}>{formatTimestamp(row.latestNoteAt)}</td>
                      <td
                        style={{
                          ...cellStyle,
                          color: row.notStartedTime ? "#B91C1C" : row.noNotesLogged ? "#C2410C" : "#A16207",
                          fontWeight: 700,
                        }}
                      >
                        {row.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ marginTop: "18px", borderTop: "1px solid #E2E8F0", paddingTop: "14px" }}>
          <h2 style={{ margin: 0, fontSize: "1.05rem", color: "#0F172A" }}>In Progress Notes (All Users)</h2>
          {inProgressMessages.length === 0 ? (
            <p style={{ marginTop: "8px", marginBottom: 0, color: "#64748B" }}>
              No active notes found for current filter.
            </p>
          ) : (
            <div style={{ marginTop: "10px", overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "880px" }}>
                <thead>
                  <tr style={{ background: "#F8FAFC" }}>
                    <th style={cellHeaderStyle}>User</th>
                    <th style={cellHeaderStyle}>ID</th>
                    <th style={cellHeaderStyle}>Project Name</th>
                    <th style={cellHeaderStyle}>Note</th>
                    <th style={cellHeaderStyle}>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {inProgressMessages.map((message) => (
                    <tr key={message.id}>
                      <td style={cellStyle}>{message.sender}</td>
                      <td style={cellStyle}>{message.issueId || "-"}</td>
                      <td style={cellStyle}>{message.projectName || "-"}</td>
                      <td style={cellStyle}>{message.text}</td>
                      <td style={cellStyle}>{formatTimestamp(message.timestamp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
          </>
        )}
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

const summaryCardStyle = (backgroundColor, borderColor) => ({
  backgroundColor,
  border: `1px solid ${borderColor}`,
  borderRadius: "10px",
  minWidth: "190px",
  padding: "10px 12px",
});

const summaryLabelStyle = {
  fontSize: "0.8rem",
  color: "#334155",
  fontWeight: 600,
};

const summaryCountStyle = {
  marginTop: "4px",
  fontSize: "1.2rem",
  fontWeight: 800,
  color: "#0F172A",
};

const sectionListCardStyle = (backgroundColor, borderColor) => ({
  backgroundColor,
  border: `1px solid ${borderColor}`,
  borderRadius: "10px",
  padding: "10px 12px",
});

const sectionListTitleStyle = {
  margin: 0,
  color: "#0F172A",
  fontSize: "0.92rem",
};

const sectionListStyle = {
  margin: "8px 0 0",
  paddingLeft: "18px",
};

const sectionListItemStyle = {
  marginBottom: "4px",
  color: "#334155",
  fontSize: "0.88rem",
};

const sectionEmptyTextStyle = {
  margin: "8px 0 0",
  color: "#64748B",
  fontSize: "0.88rem",
};

const plannerPanelStyle = {
  border: "1px solid #E2E8F0",
  borderRadius: "10px",
  padding: "10px",
  backgroundColor: "#FFFFFF",
};

const plannerHeadingStyle = {
  margin: "0 0 6px",
  color: "#0F172A",
  fontSize: "0.92rem",
  fontWeight: 700,
};

const plannerInputStyle = {
  flex: 1,
  border: "1px solid #CBD5E1",
  borderRadius: "8px",
  padding: "8px 10px",
  fontSize: "0.9rem",
};

const plannerButtonStyle = {
  border: "none",
  borderRadius: "8px",
  padding: "8px 12px",
  backgroundColor: "#1D4ED8",
  color: "#FFFFFF",
  fontWeight: 700,
  cursor: "pointer",
};

const plannerButtonSecondaryStyle = {
  border: "1px solid #CBD5E1",
  borderRadius: "8px",
  padding: "7px 10px",
  backgroundColor: "#F8FAFC",
  color: "#334155",
  fontWeight: 700,
  cursor: "pointer",
};

const plannerTinyButtonStyle = {
  border: "1px solid #CBD5E1",
  borderRadius: "6px",
  padding: "4px 8px",
  backgroundColor: "#FFFFFF",
  color: "#334155",
  fontWeight: 700,
  fontSize: "0.74rem",
  cursor: "pointer",
};

const plannerFloorSelectButtonStyle = {
  border: "none",
  backgroundColor: "transparent",
  color: "#0F172A",
  fontWeight: 800,
  fontSize: "0.92rem",
  padding: 0,
  textAlign: "left",
  cursor: "pointer",
};

const floorProgressProjectCardStyle = {
  border: "1px solid #CBD5E1",
  borderRadius: "12px",
  backgroundColor: "#FFFFFF",
  padding: "14px",
  boxShadow: "0 6px 14px rgba(15, 23, 42, 0.05)",
  display: "grid",
  gap: "12px",
};

const floorProgressFloorCardStyle = {
  border: "1px solid #E2E8F0",
  borderRadius: "10px",
  backgroundColor: "#F8FAFC",
  padding: "12px",
  display: "grid",
  gap: "10px",
};

const floorProgressCategoryRowStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 120px auto",
  gap: "8px",
  alignItems: "center",
};

const floorProgressPercentInputWrapStyle = {
  position: "relative",
  display: "flex",
  alignItems: "center",
};

const floorProgressPercentSuffixStyle = {
  position: "absolute",
  right: "10px",
  color: "#64748B",
  fontSize: "0.82rem",
  fontWeight: 700,
  pointerEvents: "none",
};

const floorProgressDeleteButtonStyle = {
  border: "1px solid #FCA5A5",
  borderRadius: "8px",
  padding: "8px 10px",
  backgroundColor: "#FEF2F2",
  color: "#B91C1C",
  fontWeight: 700,
  cursor: "pointer",
};

const floorProgressCatalogChipStyle = {
  border: "1px solid #BFDBFE",
  borderRadius: "999px",
  padding: "5px 10px",
  backgroundColor: "#EFF6FF",
  color: "#1D4ED8",
  fontSize: "0.8rem",
  fontWeight: 700,
};

const floorProgressResolvedNameStyle = {
  gridColumn: "1 / -1",
  color: "#475569",
  fontSize: "0.8rem",
  fontWeight: 600,
};

const floorProgressPeopleWrapStyle = {
  marginTop: "8px",
  display: "grid",
  gap: "4px",
};

const floorProgressPersonRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  fontSize: "0.76rem",
  color: "#1E293B",
  lineHeight: 1.2,
};

const floorProgressAvatarStyle = {
  width: "20px",
  height: "20px",
  borderRadius: "999px",
  objectFit: "cover",
  border: "1px solid #CBD5E1",
  flexShrink: 0,
};

const floorProgressAvatarFallbackStyle = {
  width: "20px",
  height: "20px",
  borderRadius: "999px",
  border: "1px solid #CBD5E1",
  backgroundColor: "#E2E8F0",
  color: "#334155",
  fontSize: "0.62rem",
  fontWeight: 800,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const floorProgressPersonNameStyle = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const floorProgressTimestampStyle = {
  gridColumn: "1 / -1",
  color: "#64748B",
  fontSize: "0.76rem",
  fontWeight: 600,
};

const floorProgressLogPanelStyle = {
  borderTop: "1px dashed #CBD5E1",
  paddingTop: "8px",
  marginTop: "2px",
  display: "grid",
  gap: "8px",
};

const floorProgressLogHeadingStyle = {
  color: "#0F172A",
  fontSize: "0.82rem",
  fontWeight: 700,
};

const floorProgressLogEmptyStyle = {
  color: "#64748B",
  fontSize: "0.8rem",
};

const floorProgressLogRowStyle = {
  display: "grid",
  gap: "2px",
  border: "1px solid #E2E8F0",
  borderRadius: "8px",
  backgroundColor: "#FFFFFF",
  padding: "6px 8px",
};

const floorProgressLogRowTopStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "8px",
};

const floorProgressLogTimeStyle = {
  color: "#1E3A8A",
  fontSize: "0.74rem",
  fontWeight: 700,
};

const floorProgressLogDeleteButtonStyle = {
  border: "1px solid #FCA5A5",
  borderRadius: "6px",
  padding: "2px 6px",
  backgroundColor: "#FEF2F2",
  color: "#B91C1C",
  fontSize: "0.7rem",
  fontWeight: 700,
  cursor: "pointer",
};

const floorProgressLogMessageStyle = {
  color: "#334155",
  fontSize: "0.8rem",
  fontWeight: 600,
};

export default TimeRotateInProgressNotes;
