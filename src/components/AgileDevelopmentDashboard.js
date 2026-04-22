  // Removed feature flag: always use new Firestore subcollection for issues
  // Technical Direction dropdown options
  const technicalDirectionOptions = [
    "Stop and Start",
    "Steer with current task",
    "Add to Queue"
  ];
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
// --- Project Name Values from Firestore (source of truth, as in ProjectIssueDashboard) ---
const PROJECT_NAME_VALUES_FIELD = "projectNameValues";
import { findFieldByAliases } from "./ProjectIssueDetail";
import { TAG_ALIASES_FIELD, PROJECT_ISSUE_CONFIG_DOC_ID } from "./projectIssueConstants";
import AgileUpdateModal from "./AgileUpdateModal";
import QuickEditModal from "./QuickEditModal";

// Ensure normalizeValue is defined before all usages
const normalizeValue = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const toDateSafe = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value?.seconds === "number") return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getLatestLogEntry = (logEntries = []) => {
  if (!Array.isArray(logEntries) || logEntries.length === 0) return null;

  let latestEntry = null;
  let latestMs = -Infinity;

  logEntries.forEach((entry) => {
    const dateValue = entry?.timestamp || entry?.date || entry?.createdAt;
    const parsedDate = toDateSafe(dateValue);
    const ms = parsedDate ? parsedDate.getTime() : -Infinity;

    if (ms > latestMs) {
      latestMs = ms;
      latestEntry = entry;
    }
  });

  if (latestEntry) return latestEntry;
  return logEntries[logEntries.length - 1] || null;
};

const isSameCalendarDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const hasLatestUpdateToday = (issue) => {
  const latestEntry = getLatestLogEntry(issue?.LogEntries);
  if (!latestEntry) return false;
  const latestDate = toDateSafe(latestEntry.timestamp || latestEntry.date || latestEntry.createdAt);
  if (!latestDate) return false;
  return isSameCalendarDay(latestDate, new Date());
};
// Helper to get Project Name display value (matches ProjectIssueDashboard.js)
const getProjectNameDisplay = (issue, tagAliasByLowerTag) => {
  const normalizedTag = normalizeValue(issue?.tags).toLowerCase();
  const normalizedZone = normalizeValue(issue?.zone).toLowerCase();
  return (
    (normalizedTag && tagAliasByLowerTag[normalizedTag]) ||
    (normalizedZone && tagAliasByLowerTag[normalizedZone]) ||
    normalizeValue(issue?.projectName) ||
    normalizeValue(issue?.project) ||
    "-"
  );
};
import { useParams, Link } from "react-router-dom";
import { collection, doc, onSnapshot, updateDoc, getDocs } from "firebase/firestore";
import { toast } from "react-toastify";
import { db } from "../firebase";
import {
  DEFAULT_E2_STATUS_UPDATE,
  DEFAULT_E2_STATUS_UPDATE_OPTIONS,
  E2_STATUS_UPDATE_OPTIONS_FIELD,
  DEFAULT_E2_STATUS_UPDATE_AGILE_OPTIONS,
  E2_STATUS_UPDATE_AGILE_OPTIONS_FIELD,
} from "./projectIssueConstants";
import "./AgileDevelopmentDashboard.css";

const getDefaultTechDetailsAvailable = (value) => normalizeValue(value) || "No";

const normalizeFieldKey = (value) => normalizeValue(value).toLowerCase().replace(/[^a-z0-9]+/g, "");

const dedupeValues = (values = []) => {
  const seen = new Set();
  return values
    .map((item) => normalizeValue(item))
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const resolveRowData = (row) => {
  if (!row || typeof row !== "object") return {};
  if (row.rowData && typeof row.rowData === "object") return row.rowData;
  return row;
};

// --- Deadline timezone helpers (America/New_York) ---
const _nyFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hourCycle: "h23",
});
const _getNyParts = (date) => {
  const p = {};
  _nyFmt.formatToParts(date).forEach(({ type, value }) => { if (type !== "literal") p[type] = Number(value); });
  return p;
};
const _nyLocalToUtcMs = (year, month, day, hour, min = 0, sec = 0) => {
  let utcMs = Date.UTC(year, month - 1, day, hour, min, sec);
  for (let i = 0; i < 3; i++) {
    const a = _getNyParts(new Date(utcMs));
    const delta = Date.UTC(year, month - 1, day, hour, min, sec) - Date.UTC(a.year, a.month - 1, a.day, a.hour, a.minute, a.second);
    if (delta === 0) break;
    utcMs += delta;
  }
  return utcMs;
};
const _shiftDay = (year, month, day, delta) => {
  const d = new Date(Date.UTC(year, month - 1, day + delta));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
};
// Returns the current moment as UTC ms (reference for deadline countdown).
const getDeadlineRefMs = () => Date.now();
// Returns the due date pinned to 4 PM EST on that calendar day as UTC ms.
const getDueDateMs = (dueDateStr) => {
  // Try to extract date parts directly from the string to avoid JS's
  // UTC-midnight parsing of ISO dates (e.g. "2026-04-21") which shifts
  // the day backward by one in negative-UTC-offset timezones like EDT.
  const isoMatch = String(dueDateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return _nyLocalToUtcMs(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]), 16);
  }
  const mdyMatch = String(dueDateStr).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdyMatch) {
    return _nyLocalToUtcMs(Number(mdyMatch[3]), Number(mdyMatch[1]), Number(mdyMatch[2]), 16);
  }
  // Fallback: parse normally and use NY calendar day
  const raw = new Date(dueDateStr);
  if (Number.isNaN(raw.getTime())) return null;
  const { year, month, day } = _getNyParts(raw);
  return _nyLocalToUtcMs(year, month, day, 16);
};

const _getNyDateOnlyFromMs = (ms) => {
  const { year, month, day } = _getNyParts(new Date(ms));
  return { year, month, day };
};

const _isWeekendNy = (year, month, day) => {
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dow === 0 || dow === 6;
};

const _compareNyDate = (a, b) => {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
};

const _businessDaysBetweenNy = (startMs, endMs) => {
  const start = _getNyDateOnlyFromMs(startMs);
  const end = _getNyDateOnlyFromMs(endMs);

  const cmp = _compareNyDate(start, end);
  if (cmp === 0) return 0;

  const step = cmp < 0 ? 1 : -1;
  let cursor = { ...start };
  let count = 0;

  while (_compareNyDate(cursor, end) !== 0) {
    cursor = _shiftDay(cursor.year, cursor.month, cursor.day, step);
    if (!_isWeekendNy(cursor.year, cursor.month, cursor.day)) {
      count += 1;
    }
  }

  return count;
};
// Calculates the deadline label and color for a given due date.
// Returns { label, color, diffMs, daysDiff } or null if date is invalid.
const calculateDeadlineValue = (dueDateStr) => {
  if (!dueDateStr) return null;
  const dueDateMs = getDueDateMs(dueDateStr);
  if (dueDateMs === null) return null;
  const refMs = getDeadlineRefMs();
  const diffMs = dueDateMs - refMs;
  const absDiffMs = Math.abs(diffMs);
  const hoursDiff = Math.ceil(absDiffMs / (1000 * 60 * 60));
  const daysDiff = _businessDaysBetweenNy(refMs, dueDateMs);
  return { diffMs, daysDiff, hoursDiff, absDiffMs };
};
// --- End deadline helpers ---

const toPhaseId = (value) => {
  const normalized = normalizeValue(value).toLowerCase();
  if (!normalized) return "phase-empty";
  return `phase-${normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "empty"}`;
};

const getColumnsFromStatuses = (statusOptions = []) =>
  statusOptions.map((status, index) => ({
    id: toPhaseId(status),
    name: status,
    order: index,
  }));


const ISSUE_ID_ALIASES = ["issue id", "id", "task id", "card id", "row id"];
const TITLE_ALIASES = ["title", "task title", "name"];
const PROJECT_NAME_ALIASES = ["project name", "projectname"];
const E2_STATUS_AGILE_ALIASES = ["e2 status update agile", "e2statusupdateagile"];
const LEAD_DETAILER_ALIASES = [
  "e3 lead detailer",
  "e3leaddetailer",
  "e2 lead detailer",
  "e2leaddetailer",
  "e2 detailer",
  "e2detailer",
];

const TECH_DETAILS_ALIASES = [
  "technical details available",
  "technical details",
  "techdetailsavailable",
];

const AgileDevelopmentDashboard = () => {
    // Popup state for support team icon (must be before return)
    // showSupportTeamPopup: { key, rect } | null
    const [showSupportTeamPopup, setShowSupportTeamPopup] = useState(null);
    // Search box state
    const [searchTerm, setSearchTerm] = useState("");
  const { id } = useParams();
  // Project Name values managed in Project Name Manager
  const [projectNameValues, setProjectNameValues] = useState([]);
  useEffect(() => {
    if (!id) return;
    const configRef = doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID);
    const unsubscribe = onSnapshot(configRef, (snapshot) => {
      const data = snapshot.data() || {};
      const values = Array.isArray(data[PROJECT_NAME_VALUES_FIELD]) ? data[PROJECT_NAME_VALUES_FIELD] : [];
      setProjectNameValues(values);
    });
    return () => unsubscribe();
  }, [id]);
  const [quickEditModal, setQuickEditModal] = useState({ open: false, issue: null });
  // Columns will be generated dynamically from unique E2 Status Update Agile values
  const [columns, setColumns] = useState([]);
  const [issues, setIssues] = useState([]);
  const [projectSources, setProjectSources] = useState({});
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [loadingIssues, setLoadingIssues] = useState(true);
  const [draggedIssueKey, setDraggedIssueKey] = useState("");
  const [savingIssueKey, setSavingIssueKey] = useState("");
  const [selectedProjectNames, setSelectedProjectNames] = useState([]);
  const [isProjectFilterOpen, setIsProjectFilterOpen] = useState(false);
  const [selectedE2LeadDetailer, setSelectedE2LeadDetailer] = useState("All");
  const [selectedE2StatusAgile, setSelectedE2StatusAgile] = useState("All");
  const [selectedDataStage, setSelectedDataStage] = useState("All");
  const [tagAliasByLowerTag, setTagAliasByLowerTag] = useState({});
  const DATA_STAGE_OPTIONS = ["Testing", "Production"];
  const projectFilterRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!projectFilterRef.current) return;
      if (!projectFilterRef.current.contains(event.target)) {
        setIsProjectFilterOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  // Load tag aliases from Firestore (same as ProjectIssueDashboard)
  useEffect(() => {
    if (!id) return;
    const configRef = doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID);
    const unsubscribe = onSnapshot(configRef, (snapshot) => {
      const data = snapshot.data() || {};
      const tagAliases = data[TAG_ALIASES_FIELD] || {};
      // Normalize keys to lower case
      const normalized = {};
      Object.entries(tagAliases).forEach(([k, v]) => {
        if (k && v) normalized[k.toLowerCase()] = v;
      });
      setTagAliasByLowerTag(normalized);
    });
    return () => unsubscribe();
  }, [id]);

  // Always use E2 Status Update Agile options from Firestore for columns, in dropdown order
  const [agileStatusOptions, setAgileStatusOptions] = useState(DEFAULT_E2_STATUS_UPDATE_AGILE_OPTIONS);
  useEffect(() => {
    if (!id) return;
    const configRef = doc(db, "churches", id, "settings", E2_STATUS_UPDATE_AGILE_OPTIONS_FIELD ? PROJECT_ISSUE_CONFIG_DOC_ID : "");
    const unsubscribe = onSnapshot(configRef, (snapshot) => {
      const data = snapshot.data() || {};
      const configuredAgileStatus = Array.isArray(data[E2_STATUS_UPDATE_AGILE_OPTIONS_FIELD])
        ? data[E2_STATUS_UPDATE_AGILE_OPTIONS_FIELD]
        : [];
      setAgileStatusOptions(configuredAgileStatus.length ? configuredAgileStatus : DEFAULT_E2_STATUS_UPDATE_AGILE_OPTIONS);
    });
    return () => unsubscribe();
  }, [id]);

  useEffect(() => {
    setColumns(getColumnsFromStatuses(agileStatusOptions));
    setLoadingConfig(false);
  }, [agileStatusOptions]);

  useEffect(() => {
    if (!id) return undefined;
    let unsubscribe = () => {};
    // Always use new structure: fetch issues from subcollection for each project
    const projectsRef = collection(db, "churches", id, "bimProjects");
    unsubscribe = onSnapshot(
      projectsRef,
      async (snapshot) => {
        const nextProjectSources = {};
        let nextIssues = [];
        for (const projectDoc of snapshot.docs) {
          const projectData = projectDoc.data() || {};
          const fields = Array.isArray(projectData.fields) ? projectData.fields : [];
          // Fetch issues subcollection for this project
          const issuesRef = collection(db, "churches", id, "bimProjects", projectDoc.id, "issues");
          const issuesSnap = await getDocs(issuesRef);
          // Fetch LogEntries for each issue
          const issues = await Promise.all(issuesSnap.docs.map(async (issueDoc, rowIndex) => {
            const rowData = issueDoc.data() || {};
            let logEntries = [];
            try {
              if (Array.isArray(rowData.LogEntries)) {
                logEntries = rowData.LogEntries;
              }
            } catch {}
            const issueIdField = findFieldByAliases(fields, rowData, ISSUE_ID_ALIASES);
            const titleField = findFieldByAliases(fields, rowData, TITLE_ALIASES);
            const projectNameField = findFieldByAliases(fields, rowData, PROJECT_NAME_ALIASES);
            const statusAgileField = findFieldByAliases(fields, rowData, E2_STATUS_AGILE_ALIASES) || "E2 Status Update Agile";
            const techDetailsField = findFieldByAliases(fields, rowData, TECH_DETAILS_ALIASES);
            const leadDetailerField = findFieldByAliases(fields, rowData, LEAD_DETAILER_ALIASES);
            const dataStageField = findFieldByAliases(fields, rowData, ["data stage", "datastage"]);
            const dataStage = normalizeValue(dataStageField ? rowData[dataStageField] : "") || "Testing";
            const issueId = normalizeValue(issueIdField ? rowData[issueIdField] : "") || String(rowIndex + 1);
            const title = normalizeValue(titleField ? rowData[titleField] : "") || "Untitled issue";
            const projectName = normalizeValue(projectNameField ? rowData[projectNameField] : "");
            const techDetailsAvailable = getDefaultTechDetailsAvailable(techDetailsField ? rowData[techDetailsField] : "");
            const e3LeadDetailer = normalizeValue(leadDetailerField ? rowData[leadDetailerField] : "");
            let status = "";
            if (statusAgileField && rowData[statusAgileField] !== undefined && rowData[statusAgileField] !== null) {
              status = normalizeValue(rowData[statusAgileField]);
            }
            const technicalDirectionField = "Technical Direction";
            const technicalDirection = normalizeValue(rowData[technicalDirectionField] || "");
            return {
              key: `${projectDoc.id}-${issueDoc.id}`,
              projectDocId: projectDoc.id,
              rowIndex,
              statusField: statusAgileField,
              issueId,
              title,
              projectName,
              dataStage,
              techDetailsAvailable,
              e3LeadDetailer,
              e2LeadDetailer: e3LeadDetailer,
              status,
              technicalDirection,
              developmentCycleCounter: typeof rowData.Development_Cycle_Counter === 'number' ? rowData.Development_Cycle_Counter : 0,
              rowData,
              LogEntries: logEntries,
            };
          }));
          nextProjectSources[projectDoc.id] = { fields, rows: issues };
          nextIssues = nextIssues.concat(issues);
        }
        setProjectSources(nextProjectSources);
        setIssues(nextIssues);
        setLoadingIssues(false);
      },
      () => {
        setProjectSources({});
        setIssues([]);
        setLoadingIssues(false);
      }
    );
    return () => unsubscribe();
  }, [id]);

  const loading = loadingConfig || loadingIssues;

  // Use getProjectNameDisplay with tagAliasByLowerTag for filter options
  // Use authoritative values from Project Name Manager if available, else fallback to deduped values from issues
  const projectNameOptions = useMemo(
    () =>
      projectNameValues.length > 0
        ? projectNameValues.slice().sort((a, b) => a.localeCompare(b))
        : dedupeValues(issues.map((issue) => getProjectNameDisplay(issue, tagAliasByLowerTag))).sort((a, b) => a.localeCompare(b)),
    [projectNameValues, issues, tagAliasByLowerTag]
  );

    // DEBUG: Log the exact Project Name filter options to the browser console
    if (!loading) {
      // Only log once per load
      console.log('[AgileBoard] Project Name filter options:', projectNameOptions);
    }

  // E2 Lead Detailer options from Firestore (source of truth, as in ProjectIssueDashboard)
  const [e2LeadDetailerOptions, setE2LeadDetailerOptions] = useState([]);
  useEffect(() => {
    if (!id) return;
    const configRef = doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID);
    const unsubscribe = onSnapshot(configRef, (snapshot) => {
      const data = snapshot.data() || {};
      const values = Array.isArray(data["e2DetailerOptions"]) ? data["e2DetailerOptions"] : [];
      setE2LeadDetailerOptions(values.length ? values : [
        "Juan", "Josias", "Krismara", "Eliana", "Guely", "Christian", "Ben", "Salomon"
      ]);
    });
    return () => unsubscribe();
  }, [id]);

  // E2 Detailer Support Team options from Firestore config (e2DetailerOptions)
  const supportTeamOptions = useMemo(() => {
    return e2LeadDetailerOptions;
  }, [e2LeadDetailerOptions]);

  const visibleIssues = useMemo(() => {
    return issues.filter((issue) => {
      const selectedProjectSet = new Set(selectedProjectNames);
      const projectMatched =
        selectedProjectSet.size === 0 || selectedProjectSet.has(normalizeValue(issue.projectName));
      const detailerMatched =
        selectedE2LeadDetailer === "All" || normalizeValue(issue.e2LeadDetailer) === selectedE2LeadDetailer;
      const e2StatusAgileMatched =
        selectedE2StatusAgile === "All" || normalizeValue(issue.status) === selectedE2StatusAgile;
      const dataStageMatched =
        selectedDataStage === "All" || normalizeValue(issue.dataStage) === selectedDataStage;
      // Search filter: match Issue ID or Title (case-insensitive, partial)
      const search = searchTerm.trim().toLowerCase();
      const idMatch = normalizeValue(issue.issueId).toLowerCase().includes(search);
      const titleMatch = normalizeValue(issue.title).toLowerCase().includes(search);
      const searchMatched = !search || idMatch || titleMatch;
      return projectMatched && detailerMatched && e2StatusAgileMatched && dataStageMatched && searchMatched;
    });
  }, [issues, selectedProjectNames, selectedE2LeadDetailer, selectedE2StatusAgile, selectedDataStage, searchTerm]);

  const e2StatusAgileOptions = useMemo(
    () => dedupeValues(issues.map((issue) => normalizeValue(issue.status))).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    [issues]
  );

  const sortedColumns = useMemo(() => [...columns].sort((a, b) => a.order - b.order), [columns]);

  const handleDragStart = (issueKey) => {
    setDraggedIssueKey(issueKey);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
  };

  const handleDrop = async (column) => {
    if (!draggedIssueKey) return;

    const issue = issues.find((item) => item.key === draggedIssueKey);
    if (!issue) {
      setDraggedIssueKey("");
      return;
    }

    if (toPhaseId(issue.status) === column.id) {
      setDraggedIssueKey("");
      return;
    }

    const source = projectSources[issue.projectDocId];
    if (!source) {
      toast.error("Could not find source project for this issue.");
      setDraggedIssueKey("");
      return;
    }

    const rows = Array.isArray(source.rows) ? source.rows : [];
    const targetRow = rows[issue.rowIndex];
    if (!targetRow) {
      toast.error("Could not find source row for this issue.");
      setDraggedIssueKey("");
      return;
    }

    const nextStatus = column.name;
    const targetRowData = resolveRowData(targetRow);
    const statusField = issue.statusField || "E2 Status Update Agile";
    const prevStatus = targetRowData[statusField] || "-";
    const prevUpdates = Array.isArray(targetRowData.updates) ? targetRowData.updates : [];
    const prevLogEntries = Array.isArray(targetRowData.LogEntries) ? targetRowData.LogEntries : [];
    const now = new Date().toISOString();
    const statusChangeUpdate = {
      text: `Moved card from column '${prevStatus}' to column '${nextStatus}'`,
      percentCompleted: 0,
      date: now,
    };
    const statusChangeLog = {
      type: "status-change",
      update: `Status changed from '${prevStatus}' to '${nextStatus}'`,
      from: prevStatus,
      to: nextStatus,
      user: (window.currentUser && window.currentUser.displayName) || "System",
      timestamp: now,
    };

    // Increment Development_Cycle_Counter if status changes to 'Completed' from any other status
    const isMovingToCompletion = nextStatus === "Completed" || nextStatus === "Report Completion to Client";
    
    const updatedRows = rows.map((row, index) => {
      if (index !== issue.rowIndex) return row;
      const rowData = resolveRowData(row);
      const hasNestedRowData = Boolean(row?.rowData && typeof row.rowData === "object");
      const prevUpdates = Array.isArray(rowData.updates) ? rowData.updates : [];
      const statusChangeUpdate = {
        text: `Status changed from '${prevStatus}' to '${nextStatus}'`,
        percentCompleted: 0,
        date: new Date().toISOString(),
      };

      let nextDevCycle =
        typeof rowData.Development_Cycle_Counter === "number" ? rowData.Development_Cycle_Counter : 0;
      if (nextStatus === "Completed" && prevStatus !== "Completed") {
        nextDevCycle += 1;
      } else if (prevStatus === "Completed" && nextStatus !== "Completed" && nextDevCycle === 1) {
        nextDevCycle = 1;
      }

      // Calculate and freeze deadline if moving to completion columns
      let permanentDeadlineLabel = null;
      let permanentDeadlineColor = null;
      if (isMovingToCompletion && !rowData.permanentDeadlineLabel) {
        const calc = calculateDeadlineValue(rowData.e2DueDate);
        if (calc) {
          const { diffMs, daysDiff, hoursDiff } = calc;
          if (diffMs > 0 && daysDiff > 1) {
            permanentDeadlineLabel = "Delivered ahead of schedule";
            permanentDeadlineColor = "#22c55e";
          } else if (diffMs > 0) {
            permanentDeadlineLabel = "Met";
            permanentDeadlineColor = "#22c55e";
          } else {
            permanentDeadlineLabel = "Missed the Deadline";
            permanentDeadlineColor = "#dc2626";
          }
        }
      }

      const nextRowData = {
        ...rowData,
        [statusField]: nextStatus,
        updates: [...prevUpdates, statusChangeUpdate],
        Development_Cycle_Counter: nextDevCycle,
      };
      
      // Add permanent deadline if calculated
      if (permanentDeadlineLabel) {
        nextRowData.permanentDeadlineLabel = permanentDeadlineLabel;
        nextRowData.permanentDeadlineColor = permanentDeadlineColor;
      }

      if (hasNestedRowData) {
        return {
          ...row,
          rowData: nextRowData,
        };
      }

      return {
        ...row,
        rowData: { ...nextRowData, LogEntries: [...prevLogEntries, statusChangeLog] },
      };
    });

    setSavingIssueKey(issue.key);

    setProjectSources((previous) => ({
      ...previous,
      [issue.projectDocId]: {
        ...previous[issue.projectDocId],
        rows: updatedRows,
      },
    }));
    // Also update developmentCycleCounter for real-time UI update
    setIssues((previous) =>
      previous.map((item) => {
        if (item.key === issue.key) {
          // Find the updated row for this issue
          const updatedRow = updatedRows[issue.rowIndex];
          const updatedRowData = updatedRow?.rowData || {};
          const devCycle = updatedRowData.Development_Cycle_Counter;
          return {
            ...item,
            status: nextStatus,
            e2StatusUpdateAgile: nextStatus,
            rowData: { ...item.rowData, ...updatedRowData },
            developmentCycleCounter: typeof devCycle === 'number' ? devCycle : item.developmentCycleCounter,
          };
        }
        return item;
      })
    );

    try {
      // Always update the issue document in the subcollection
      const issueRef = doc(db, "churches", id, "bimProjects", issue.projectDocId, "issues", issue.issueId);
      await updateDoc(issueRef, {
        ...updatedRows[issue.rowIndex].rowData,
        status: nextStatus,
        LogEntries: [...prevLogEntries, statusChangeLog],
      });
      toast.success(`Moved to ${nextStatus}.`);
    } catch (error) {
      toast.error("Could not move the issue. Please try again.");
      console.error("Error moving issue in Agile Dashboard:", error);
    } finally {
      setSavingIssueKey("");
      setDraggedIssueKey("");
    }
  };

  const [updateModal, setUpdateModal] = useState({ open: false, issue: null });
  const [newUpdate, setNewUpdate] = useState("");
  const [percentCompleted, setPercentCompleted] = useState("");
  const [latestUpdate, setLatestUpdate] = useState("");
  const [updateLoading, setUpdateLoading] = useState(false);

  // Fetch latest update and percent completed for a given issue from Firestore LogEntries
  const fetchLatestUpdate = async (issue) => {
    if (!issue || !issue.projectDocId || !issue.issueId || !id) return { text: "", percentCompleted: null, date: null };
    try {
      const issueRef = doc(db, "churches", id, "bimProjects", issue.projectDocId, "issues", issue.issueId);
      const issueSnap = await (await import("firebase/firestore")).getDoc(issueRef);
      if (issueSnap.exists()) {
        const data = issueSnap.data();
        const logEntries = Array.isArray(data.LogEntries) ? data.LogEntries : [];
        if (logEntries.length > 0) {
          const latest = logEntries[0];
          return {
            text: latest.update || "",
            percentCompleted: typeof latest.percent === "number" ? latest.percent : null,
            date: latest.timestamp || null
          };
        }
      }
    } catch (e) {
      // ignore
    }
    return { text: "", percentCompleted: null, date: null };
  };

  if (loading) {
    return <div className="agile-dashboard-loading">Loading Agile Dashboard...</div>;
  }

  return (
    <div className="agile-dashboard-wrapper">
      <div className="agile-dashboard-header">
        <div className="agile-dashboard-header-top">
          {/* Removed Back to Project Issue Dashboard link as requested */}
          <Link
            to="/live-issue-tracker"
            style={{
              marginLeft: 16,
              background: 'rgba(236, 239, 244, 0.88)',
              color: '#111827',
              padding: '10px 16px',
              borderRadius: 8,
              fontWeight: 500,
              letterSpacing: '0.2px',
              textDecoration: 'none',
              display: 'inline-block',
              border: '1px solid #a8a8a8',
              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.08)',
              cursor: 'pointer',
            }}
          >
            Open Live Issue Tracker
          </Link>
        </div>
        <div style={{ marginTop: 16, marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ textAlign: 'center', width: '100%' }}>
            <h1 style={{ margin: 0 }}>Agile Development Dashboard</h1>
            <p style={{ margin: '6px 0 0 0', color: '#64748b', fontSize: 14 }}>
              © E2 Tech Support, LLC
            </p>
          </div>
          {/* Removed Manage Project Name Values button as requested */}
        </div>
        <div className="agile-dashboard-filters">
          {/* Search box for Issue ID and Title */}
          <label className="agile-dashboard-filter-item" htmlFor="agile-search-box" style={{ minWidth: 220 }}>
            <span>Search Issue ID or Title</span>
            <input
              id="agile-search-box"
              className="agile-dashboard-filter-select"
              type="text"
              placeholder="Search by ID or Title..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{ minWidth: 180 }}
            />
          </label>

          <div className="agile-dashboard-filter-item agile-project-filter" ref={projectFilterRef}>
            <span>Project Name</span>
            <div className="agile-project-filter-controls">
              <button
                type="button"
                className="agile-dashboard-filter-select"
                onClick={() => setIsProjectFilterOpen((prev) => !prev)}
                style={{ minWidth: 220, textAlign: "left" }}
              >
                {selectedProjectNames.length > 0
                  ? `${selectedProjectNames.length} project(s) selected`
                  : "All Projects"}
              </button>

              <button
                type="button"
                className="agile-dashboard-filter-select"
                onClick={() => setSelectedProjectNames([])}
                disabled={selectedProjectNames.length === 0}
                style={{ minWidth: "auto", padding: "0.5rem 0.55rem", whiteSpace: "nowrap" }}
              >
                Clear
              </button>
            </div>

            {isProjectFilterOpen && (
              <div className="agile-project-filter-dropdown">
                {projectNameOptions.map((option) => {
                  const checked = selectedProjectNames.includes(option);
                  return (
                    <label key={option} className="agile-project-filter-option">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setSelectedProjectNames((prev) =>
                            prev.includes(option)
                              ? prev.filter((value) => value !== option)
                              : [...prev, option]
                          );
                        }}
                      />
                      <div className="agile-project-filter-option-text">{option}</div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <label className="agile-dashboard-filter-item" htmlFor="agile-detailer-filter">
            <span>E2 Lead Detailer</span>
            <select
              id="agile-detailer-filter"
              className="agile-dashboard-filter-select"
              value={selectedE2LeadDetailer}
              onChange={(event) => setSelectedE2LeadDetailer(event.target.value)}
            >
              <option value="All">All E2 Lead Detailers</option>
              {e2LeadDetailerOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="agile-dashboard-filter-item" htmlFor="agile-data-stage-filter">
            <span>Data Stage</span>
            <select
              id="agile-data-stage-filter"
              className="agile-dashboard-filter-select"
              value={selectedDataStage}
              onChange={e => setSelectedDataStage(e.target.value)}
              style={{ minWidth: 120 }}
            >
              <option value="All">All</option>
              {DATA_STAGE_OPTIONS.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="agile-dashboard-board">
        {sortedColumns.map((column) => {
          let columnIssues = visibleIssues.filter((issue) => toPhaseId(issue.status) === column.id);
          // For To Do List column, only show issues where status is exactly 'To Do List'
          if (column.name === "To Do List") {
            columnIssues = columnIssues.filter((issue) => normalizeValue(issue.status) === "To Do List");
          }
          console.log(`[AgileDashboard] Rendering column: ${column.name} (id: ${column.id}), issues:`, columnIssues);
          return (
            <div key={column.id} className="agile-column">
              <div className="agile-column-header">
                <h2 className="agile-column-title">{column.name}</h2>
              </div>

              <div
                className="agile-column-content"
                onDragOver={handleDragOver}
                onDrop={() => handleDrop(column)}
              >
                {columnIssues.map((issue) => {
                  // Find latest percent from LogEntries in Firestore
                  let percentCompleted = null;
                  if (Array.isArray(issue.LogEntries) && issue.LogEntries.length > 0) {
                    const latestLog = issue.LogEntries[0];
                    if (typeof latestLog.percent === 'number') {
                      percentCompleted = latestLog.percent;
                    }
                  }
                  const latestUpdateDoneToday = hasLatestUpdateToday(issue);
                  return (
                    <div
                      key={issue.key}
                      className={`agile-card${savingIssueKey === issue.key ? " is-saving" : ""}`}
                      draggable={savingIssueKey !== issue.key}
                      onDragStart={() => handleDragStart(issue.key)}
                    >
                      <div className="agile-card-header">
                        <div className="agile-card-field-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                            {normalizeValue(issue.dataStage).toLowerCase() === 'testing' && (
                              <img src="/img/data-stage-t.svg" alt="Testing" title="Testing" style={{ width: 16, height: 16, marginRight: 4 }} />
                            )}
                            {normalizeValue(issue.dataStage).toLowerCase() === 'production' && (
                              <img src="/img/data-stage-p.svg" alt="Production" title="Production" style={{ width: 16, height: 16, marginRight: 4 }} />
                            )}
                            {Number.isFinite(issue.developmentCycleCounter) && issue.developmentCycleCounter > 0 && (
                              <>
                                <img src="/img/star.svg" alt="star" style={{ width: 16, height: 16, marginRight: 4 }} />
                                <span style={{ color: '#2563eb', fontWeight: 600, fontSize: '13px', marginRight: 8 }}>{issue.developmentCycleCounter}</span>
                              </>
                            )}
                            <Link
                              className="agile-card-issue-id"
                              to={`/organization/${id}/project-issue-dashboard/issue/${issue.projectDocId}/${issue.issueId}`}
                              style={{ color: '#2563eb', textDecoration: 'underline', cursor: 'pointer' }}
                            >
                              {normalizeValue(issue.issueId) || "-"}
                            </Link>
                            {latestUpdateDoneToday ? (
                              <span
                                title="Latest update added today"
                                aria-label="Latest update added today"
                                style={{ marginLeft: 6, color: '#16a34a', fontSize: 14, fontWeight: 700, lineHeight: 1 }}
                              >
                                ✓
                              </span>
                            ) : null}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            <a
                              href="#"
                              style={{ color: '#059669', textDecoration: 'underline', cursor: 'pointer', fontSize: 13, marginRight: 12 }}
                              onClick={async e => {
                                e.preventDefault();
                                // Fetch latest issue data from Firestore
                                try {
                                  const issueRef = doc(db, "churches", id, "bimProjects", issue.projectDocId, "issues", issue.issueId);
                                  const snap = await getDocs(collection(db, "churches", id, "bimProjects", issue.projectDocId, "issues"));
                                  let latestDoc = null;
                                  snap.forEach(docSnap => {
                                    if (docSnap.id === issue.issueId) latestDoc = docSnap;
                                  });
                                  let latestData = latestDoc ? latestDoc.data() : null;
                                  // fallback to old if not found
                                  setQuickEditModal({ open: true, issue: latestData ? { ...issue, rowData: latestData } : issue });
                                } catch (err) {
                                  setQuickEditModal({ open: true, issue });
                                }
                              }}
                            >Quick Edit</a>
                            <a
                              href="#"
                              style={{ color: '#6366f1', textDecoration: 'underline', cursor: 'pointer', fontSize: 13 }}
                              onClick={e => {
                                e.preventDefault();
                                setUpdateModal({ open: true, issue });
                                setNewUpdate("");
                                setPercentCompleted("");
                                // Fetch latest update from Firestore
                                fetchLatestUpdate(issue).then(setLatestUpdate);
                              }}
                            >Add Update</a>
                          </div>
                        </div>
                        <div className="agile-card-field-row">
                          <span className="agile-card-project-title-combined" style={{ marginLeft: 4 }}>
                            <span style={{ fontWeight: 'bold' }}>{normalizeValue(issue.projectName) || "-"}</span>: {normalizeValue(issue.title) || "-"}
                          </span>
                        </div>
                        <div className="agile-card-field-row" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span className="agile-card-label" style={{ fontFamily: 'Arial, sans-serif', fontSize: '11pt' }}>Assignee:</span>
                          <span className="agile-card-detailer" style={{ marginLeft: 4, fontFamily: 'Arial, sans-serif', fontSize: '11pt' }}>{normalizeValue(issue.e3LeadDetailer) || "-"}</span>
                          <span
                            style={{ position: 'relative', display: 'inline-block' }}
                            onMouseEnter={e => {
                              const rect = e.currentTarget.getBoundingClientRect();
                              setShowSupportTeamPopup({ key: issue.key, rect });
                            }}
                            onMouseLeave={() => setShowSupportTeamPopup(null)}
                          >
                            <img
                              src="/img/person.svg"
                              alt="Show E2 Detailer Support Team"
                              title="Show E2 Detailer Support Team"
                              style={{ width: 18, height: 18, marginLeft: 6, cursor: 'pointer', verticalAlign: 'middle' }}
                            />
                            {showSupportTeamPopup && showSupportTeamPopup.key === issue.key && typeof window !== 'undefined' && createPortal(
                              <div
                                style={{
                                  position: 'fixed',
                                  left: (showSupportTeamPopup.rect?.right || 0) + 8,
                                  top: showSupportTeamPopup.rect?.top || 0,
                                  zIndex: 9999,
                                  background: '#fff',
                                  border: '1px solid #cbd5e1',
                                  borderRadius: 6,
                                  boxShadow: '0 2px 8px #0002',
                                  padding: '6px 10px',
                                  minWidth: 150,
                                  fontSize: '0.92em',
                                  color: '#222',
                                }}
                              >
                                <div style={{ fontWeight: 600, marginBottom: 6, color: '#6366f1' }}>E2 Detailer Support Team</div>
                                {Array.isArray(issue.rowData?.["E2 Detailer Support Team"]) && issue.rowData["E2 Detailer Support Team"].length > 0 ? (
                                  <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                                    {issue.rowData["E2 Detailer Support Team"].map((name, idx) => (
                                      <li key={idx} style={{ padding: '2px 0' }}>{name}</li>
                                    ))}
                                  </ul>
                                ) : (
                                  <div style={{ color: '#888' }}>(No support team listed)</div>
                                )}
                              </div>,
                              document.body
                            )}
                          </span>
                        </div>
                        {/* Deadline row below Assignee */}
                        <div className="agile-card-field-row" style={{ fontSize: '1.08em', color: '#334155', marginTop: 2 }}>
                          {(() => {
                            const dueDateStr = issue.rowData?.e2DueDate || issue.e2DueDate;
                            const e2StatusAgile = issue.rowData?.["E2 Status Update Agile"] || issue.e2StatusUpdateAgile;
                            const isCompleted = e2StatusAgile === "Completed" || e2StatusAgile === "Report Completion to Client";
                            
                            // Check if deadline is already frozen (permanent)
                            const permanentLabel = issue.rowData?.permanentDeadlineLabel;
                            const permanentColor = issue.rowData?.permanentDeadlineColor;
                            if (permanentLabel) {
                              return (
                                <span>
                                  <span style={{ fontWeight: 600, fontFamily: 'Arial, sans-serif', fontSize: '11pt' }}>Deadline:</span>{' '}
                                  <span style={{ color: permanentColor, fontFamily: 'Arial, sans-serif', fontSize: '11pt' }}>{permanentLabel}</span>
                                </span>
                              );
                            }
                            
                            let deadlineLabel = null;
                            let deadlineColor = 'inherit';
                            let diffMs = 0;
                            let daysDiff = 0;
                            let hoursDiff = 0;
                            
                            if (dueDateStr) {
                              const calc = calculateDeadlineValue(dueDateStr);
                              if (calc) {
                                diffMs = calc.diffMs;
                                daysDiff = calc.daysDiff;
                                hoursDiff = calc.hoursDiff;
                                
                                // If card is in Completed or Report Completion to Client status, show conditional text
                                if (isCompleted) {
                                  if (diffMs > 0 && daysDiff > 1) {
                                    deadlineLabel = "Delivered ahead of schedule";
                                    deadlineColor = "#22c55e"; // green
                                  } else if (diffMs > 0) {
                                    deadlineLabel = "Met";
                                    deadlineColor = "#22c55e"; // green
                                  } else {
                                    deadlineLabel = "Missed the Deadline";
                                    deadlineColor = "#dc2626"; // red
                                  }
                                } else {
                                  // Normal countdown display
                                  if (daysDiff <= 0) {
                                    const hourLabel = `${hoursDiff} hour${hoursDiff === 1 ? '' : 's'}`;
                                    deadlineLabel = diffMs < 0 ? `Overdue by ${hourLabel}` : hourLabel;
                                  } else {
                                    const dayLabel = `${daysDiff} business day${daysDiff === 1 ? '' : 's'}`;
                                    deadlineLabel = diffMs < 0 ? `Overdue by ${dayLabel}` : dayLabel;
                                  }
                                  deadlineColor = diffMs < 0 ? '#dc2626' : 'inherit';
                                }
                              }
                            }
                            
                            return (
                              <span>
                                <span style={{ fontWeight: 600, fontFamily: 'Arial, sans-serif', fontSize: '11pt' }}>Deadline:</span>{' '}
                                <span style={{ color: deadlineColor, fontFamily: 'Arial, sans-serif', fontSize: '11pt' }}>{deadlineLabel ?? '—'}</span>
                              </span>
                            );
                          })()}
                        </div>
                        {/* Data Stage row removed as per request; T/P icon remains in card header */}
                        <div className="agile-card-field-row">
                          {(() => {
                            const value = issue.technicalDirection || "-";
                            let color = '#7c3aed'; // default purple
                            if (value === 'Stop and Start') color = '#ef4444'; // red
                            else if (value === 'Steer with current task') color = '#2563eb'; // blue
                            else if (value === 'Add to Queue') color = '#374151'; // dark gray
                            return (
                              <span className="agile-card-technical-direction" style={{ marginLeft: 4, fontWeight: 500, color, fontSize: '0.95em' }}>
                                {value}
                              </span>
                            );
                          })()}
                        </div>
                      </div>

                      {/* Percent Completed Bar */}
                      <div style={{ margin: '12px 0 0 0', padding: 0 }}>
                        <div style={{
                          width: '100%',
                          height: '18px',
                          background: '#e5e7eb',
                          borderRadius: '8px',
                          overflow: 'hidden',
                          position: 'relative',
                          boxShadow: '0 1px 2px #0001',
                        }}>
                          <div style={{
                            width: percentCompleted !== null ? `${Math.max(0, Math.min(percentCompleted, 100))}%` : '0%',
                            height: '100%',
                            background: 'linear-gradient(90deg, #22c55e 60%, #16a34a 100%)',
                            transition: 'width 0.5s cubic-bezier(.4,2,.6,1)',
                          }} />
                          <span style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            width: '100%',
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 600,
                            color: percentCompleted !== null && percentCompleted > 50 ? '#fff' : '#166534',
                            fontSize: '0.92em',
                            letterSpacing: '0.01em',
                            textShadow: percentCompleted !== null && percentCompleted > 50 ? '0 1px 2px #0006' : 'none',
                          }}>
                            {percentCompleted !== null ? `${percentCompleted}% Completed` : '0% Completed'}
                          </span>
                        </div>
                      </div>

                      {/* Removed Add Update link from bottom, now at top right */}
                    </div>
                  );
                })}
              </div>

              <div className="agile-column-footer">
                <span className="agile-column-card-count">{columnIssues.length} cards</span>
              </div>
            </div>
          );
        })}
      </div>
      <AgileUpdateModal
        isOpen={updateModal.open}
        onClose={() => setUpdateModal({ open: false, issue: null })}
        latestUpdate={latestUpdate}
        newUpdate={newUpdate}
        onChange={setNewUpdate}
        percentCompleted={percentCompleted}
        onPercentChange={setPercentCompleted}
        loading={updateLoading}
        churchId={id}
        issue={updateModal.issue}
        onSave={async () => {
          if (!updateModal.issue || !newUpdate.trim()) return;
          setUpdateLoading(true);
          try {
            const { issue } = updateModal;
            const issueRef = doc(db, "churches", id, "bimProjects", issue.projectDocId, "issues", issue.issueId);
            // Fetch current log entries
            const issueSnap = await (await import("firebase/firestore")).getDoc(issueRef);
            const issueData = issueSnap.exists() ? issueSnap.data() : {};
            const prevLog = Array.isArray(issueData.LogEntries) ? issueData.LogEntries : [];
            const now = new Date().toISOString();
            const logEntry = {
              update: newUpdate.trim(),
              percent: Number(percentCompleted) || 0,
              timestamp: now,
            };
            const nextLog = [logEntry, ...prevLog];
            await updateDoc(issueRef, { LogEntries: nextLog });
            // Optimistically update local issues state for instant UI feedback
            setIssues((prevIssues) => prevIssues.map((i) => {
              if (
                i.issueId === issue.issueId &&
                i.projectDocId === issue.projectDocId
              ) {
                return { ...i, LogEntries: nextLog };
              }
              return i;
            }));
            setLatestUpdate({ text: logEntry.update, percentCompleted: logEntry.percent, date: logEntry.timestamp });
            setNewUpdate("");
            setPercentCompleted("");
            setUpdateModal({ open: false, issue: null });
          } finally {
            setUpdateLoading(false);
          }
        }}
      />

      <QuickEditModal
        isOpen={quickEditModal.open}
        onClose={() => setQuickEditModal({ open: false, issue: null })}
        issue={quickEditModal.issue}
        issueId={quickEditModal.issue?.issueId || quickEditModal.issue?.id || quickEditModal.issue?.ID || quickEditModal.issue?.['Issue ID'] || quickEditModal.issue?.rowData?.id || quickEditModal.issue?.rowData?.ID || quickEditModal.issue?.rowData?.['Issue ID'] || ""}
        onSubmit={async (formData) => {
          if (!quickEditModal.issue) return;
          const { issue } = quickEditModal;
          const source = projectSources[issue.projectDocId];
          if (!source) return;
          const rows = Array.isArray(source.rows) ? source.rows : [];
          const targetRow = rows[issue.rowIndex];
          if (!targetRow) return;

          // Find correct field keys for each editable field
          const fields = Array.isArray(source.fields) ? source.fields : [];
          const rowData = { ...targetRow.rowData };
          // Helper to update by alias
          const setFieldByAliases = (aliases, value) => {
            const key = findFieldByAliases(fields, rowData, aliases);
            if (key) rowData[key] = value;
          };
          setFieldByAliases(PROJECT_NAME_ALIASES, formData.projectName);
          setFieldByAliases(TITLE_ALIASES, formData.title);
          setFieldByAliases(LEAD_DETAILER_ALIASES, formData.e3LeadDetailer);
          setFieldByAliases(["e2 detailer support team", "e2detailersupportteam"], formData.e2DetailerSupportTeam);
          setFieldByAliases(["e2 comments", "e2comments"], formData.e2Comments);
          setFieldByAliases(["e2 documents", "e2documents"], formData.e2Documents);
          setFieldByAliases(["data stage", "datastage"], formData.dataStage);
          rowData["Technical Direction"] = formData.technicalDirection;
          // Always set E2 Due Date directly
          rowData["e2DueDate"] = formData.e2DueDate;

          // Always update the issue document in the subcollection
          const issueRef = doc(db, "churches", id, "bimProjects", issue.projectDocId, "issues", issue.issueId);
          try {
            await updateDoc(issueRef, rowData);
            // Optimistically update local state for instant UI feedback
            setProjectSources((prevSources) => {
              const prev = prevSources[issue.projectDocId];
              if (!prev) return prevSources;
              const updatedRows = prev.rows.map((row, idx) =>
                idx === issue.rowIndex ? { ...row, rowData: { ...rowData } } : row
              );
              return {
                ...prevSources,
                [issue.projectDocId]: {
                  ...prev,
                  rows: updatedRows,
                },
              };
            });
            setIssues((prevIssues) =>
              prevIssues.map((item) =>
                item.key === issue.key ? { ...item, ...formData, rowData: { ...rowData } } : item
              )
            );
            toast.success("Issue updated successfully.");
          } catch (err) {
            toast.error("Failed to update issue.");
          }
          setQuickEditModal({ open: false, issue: null });
        }}
        projectNameOptions={projectNameOptions}
        technicalDirectionOptions={technicalDirectionOptions}
        leadDetailerOptions={e2LeadDetailerOptions}
        supportTeamOptions={supportTeamOptions}
        dataStageOptions={DATA_STAGE_OPTIONS}
      />
    </div>
  );
};

export default AgileDevelopmentDashboard;
