import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import * as XLSX from "xlsx";
import { collection, doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { toast } from "react-toastify";
import commonStyles from "../pages/commonStyles";
import ChurchHeader from "./ChurchHeader";
import { db, storage } from "../firebase";
import {
  DEFAULT_E2_DETAILER_OPTIONS,
  DEFAULT_E2_STATUS_UPDATE,
  DEFAULT_E2_STATUS_UPDATE_OPTIONS,
  E2_DETAILER_OPTIONS_FIELD,
  E2_STATUS_UPDATE_FORMATS_FIELD,
  E2_STATUS_UPDATE_OPTIONS_FIELD,
  PROJECT_ISSUE_CONFIG_DOC_ID,
  STATUS_FORMATS_FIELD,
  TAG_ALIASES_FIELD,
} from "./projectIssueConstants";
import "./ProjectIssueDashboard.css";

const E2_DETAILER_FIELD = "E2 Detailer";

const E2_STATUS_UPDATE_FIELD = "E2 Status Update";

const E2_STATUS_DATE_FIELD = "E2 Status Date";
const TECH_DETAILS_FIELD = "Technical Details Available";
const PIE_FALLBACK_COLORS = ["#0ea5e9", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#14b8a6", "#f97316"];

const SNAPSHOT_FIELD = "Snapshot URL";
const DAILY_ISSUES_TARGET_PROJECT_ID = "stanford-ff-rad";
const DAILY_ISSUES_TARGET_PROJECT_NAME = "STANFORD -  FF / RAD";
const DAILY_ISSUES_SHEET_NAME = "Issues with one last comment";
const DAILY_ISSUES_EXPORTS_HINT = "C:/Users/BenSolorzano/OneDrive - E2 Tech Support/E2 Tech Team - VDC Project - Equipo Operativo/Exports";

const getTodayMMDDYY = () => {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
};

const formatUpdateTimestamp = (value) => {
  if (!value) return "";

  const parsedDate =
    value instanceof Date
      ? value
      : typeof value?.toDate === "function"
        ? value.toDate()
        : new Date(value);

  if (!(parsedDate instanceof Date) || Number.isNaN(parsedDate.getTime())) {
    return "";
  }

  const mm = String(parsedDate.getMonth() + 1).padStart(2, "0");
  const dd = String(parsedDate.getDate()).padStart(2, "0");
  const yy = String(parsedDate.getFullYear()).slice(-2);
  const hh = String(parsedDate.getHours()).padStart(2, "0");
  const ss = String(parsedDate.getSeconds()).padStart(2, "0");
  return `${mm}/${dd}/${yy} ${hh}:${ss}`;
};

const formatDueDateMMDDYY = (value) => {
  const raw = normalizeValue(value);
  if (!raw || raw === "-") return "-";

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+.*)?$/);
  if (slashMatch) {
    const part1 = parseInt(slashMatch[1], 10);
    const part2 = parseInt(slashMatch[2], 10);
    const yearRaw = slashMatch[3];
    const year = yearRaw.length === 2 ? 2000 + parseInt(yearRaw, 10) : parseInt(yearRaw, 10);

    // Handle ambiguous slash dates while defaulting to MM/DD.
    const month = part1 > 12 && part2 <= 12 ? part2 : part1;
    const day = part1 > 12 && part2 <= 12 ? part1 : part2;

    const parsed = new Date(year, month - 1, day);
    if (!Number.isNaN(parsed.getTime())) {
      const mm = String(parsed.getMonth() + 1).padStart(2, "0");
      const dd = String(parsed.getDate()).padStart(2, "0");
      const yy = String(parsed.getFullYear()).slice(-2);
      return `${mm}/${dd}/${yy}`;
    }
  }

  const dashMatch = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})(?:\s+.*)?$/);
  if (dashMatch) {
    const part1 = parseInt(dashMatch[1], 10);
    const part2 = parseInt(dashMatch[2], 10);
    const yearRaw = dashMatch[3];
    const year = yearRaw.length === 2 ? 2000 + parseInt(yearRaw, 10) : parseInt(yearRaw, 10);

    // For dash format, prioritize DD-MM when ambiguous.
    const day = part1 > 12 || (part1 <= 12 && part2 <= 12) ? part1 : part2;
    const month = part1 > 12 || (part1 <= 12 && part2 <= 12) ? part2 : part1;

    const parsed = new Date(year, month - 1, day);
    if (!Number.isNaN(parsed.getTime())) {
      const mm = String(parsed.getMonth() + 1).padStart(2, "0");
      const dd = String(parsed.getDate()).padStart(2, "0");
      const yy = String(parsed.getFullYear()).slice(-2);
      return `${mm}/${dd}/${yy}`;
    }
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;

  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getDate()).padStart(2, "0");
  const yy = String(parsed.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
};

// Parses MM/DD/YY or MM/DD/YYYY status update date strings into a Date at midnight local time.
// Returns null for empty or unparseable values.
const parseStatusUpdateDate = (value) => {
  const raw = typeof value === "string" ? value.trim() : String(value || "").trim();
  if (!raw || raw === "-") return null;
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s.*)?$/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  const yearRaw = m[3];
  const year = yearRaw.length === 2 ? 2000 + parseInt(yearRaw, 10) : parseInt(yearRaw, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day, 0, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
};

// Returns the [start, end] Date boundaries (inclusive) for a named range relative to today.
const getDateRangeBounds = (range) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  if (range === "YTD") {
    return [new Date(today.getFullYear(), 0, 1, 0, 0, 0, 0), today];
  }
  if (range === "MTD") {
    return [new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0, 0), today];
  }
  if (range === "TW") {
    // Week starts on Sunday
    const dow = today.getDay();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - dow);
    return [weekStart, today];
  }
  return null;
};

const formatChartRangeDate = (value) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";
  return `${value.getMonth() + 1}/${value.getDate()}/${value.getFullYear()}`;
};

const getDefaultE2StatusUpdate = (value) => normalizeValue(value) || DEFAULT_E2_STATUS_UPDATE;

const getDefaultE2StatusDate = (value) => normalizeValue(value) || getTodayMMDDYY();

const normalizeValue = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toDate === "function") {
    return value.toDate().toISOString();
  }
  return String(value).trim();
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
  const tagsField = findFieldByAliases(fields, rowData, ["tags", "tag", "labels", "label"]);
  const markupField = findFieldByAliases(fields, rowData, ["markup", "mark up"]);
  const markupLinkField = findFieldByAliases(fields, rowData, ["link to markup", "markup link"]);
  const statusField = findFieldByAliases(fields, rowData, ["status", "state", "task status"]);
  const priorityField = findFieldByAliases(fields, rowData, ["priority"]);
  const zoneField = findFieldByAliases(fields, rowData, ["zone", "area", "section", "location zone"]);
  const assigneeField = findFieldByAliases(fields, rowData, ["assignee", "assigned to", "owner", "responsible"]);
  const e2DetailerField = findFieldByAliases(fields, rowData, ["e2 detailer", "e2detailer"]);
  const e2StatusUpdateField = findFieldByAliases(fields, rowData, ["e2 status update", "e2statusupdate"]);
  const e2StatusDateField = findFieldByAliases(fields, rowData, ["e2 status date", "e2statusdate"]);
  const techDetailsField = findFieldByAliases(fields, rowData, ["technical details available", "technical details", "techdetailsavailable"]);
  const snapshotField = findFieldByAliases(fields, rowData, ["snapshot url", "snapshoturl", "snapshot", "picture", "photo", "image"]);
  const linkField = findFieldByAliases(fields, rowData, ["link", "url", "issue url", "card url", "task url", "issue link", "card link"]);
  const deadlineField = findFieldByAliases(fields, rowData, ["deadline", "due date", "due", "target date"]);
  const idField = findFieldByAliases(fields, rowData, ["id", "task id", "card id", "row id"]);

  return {
    title: normalizeValue(titleField ? rowData?.[titleField] : ""),
    tags: normalizeValue(tagsField ? rowData?.[tagsField] : ""),
    markup: normalizeValue(markupField ? rowData?.[markupField] : ""),
    markupLink: normalizeValue(markupLinkField ? rowData?.[markupLinkField] : ""),
    status: normalizeValue(statusField ? rowData?.[statusField] : ""),
    priority: normalizeValue(priorityField ? rowData?.[priorityField] : ""),
    zone: normalizeValue(zoneField ? rowData?.[zoneField] : ""),
    assignee: normalizeValue(assigneeField ? rowData?.[assigneeField] : ""),
    e2Detailer: normalizeValue(e2DetailerField ? rowData?.[e2DetailerField] : ""),
    e2StatusUpdate: getDefaultE2StatusUpdate(e2StatusUpdateField ? rowData?.[e2StatusUpdateField] : ""),
    e2StatusDate: getDefaultE2StatusDate(e2StatusDateField ? rowData?.[e2StatusDateField] : ""),
    techDetailsAvailable: normalizeValue(techDetailsField ? rowData?.[techDetailsField] : ""),
    snapshotUrl: normalizeValue(snapshotField ? rowData?.[snapshotField] : ""),
    link: normalizeValue(linkField ? rowData?.[linkField] : ""),
    deadline: normalizeValue(deadlineField ? rowData?.[deadlineField] : ""),
    id: normalizeValue(idField ? rowData?.[idField] : ""),
  };
};

const getCardMetaKey = (row = {}, preview = {}) => {
  const normalizedId = normalizeValue(preview?.id);
  if (normalizedId) return `id:${normalizedId}`;
  return `row:${row?.rowNumber || "unknown"}`;
};

const getZoneCategory = (zoneValue) => {
  const zone = normalizeValue(zoneValue).toLowerCase();
  if (zone.includes("ff phase 1")) return "Flouroscopy Phase 1";
  if (zone.includes("ff phase 2")) return "Flouroscopy Phase 2";
  if (zone.includes("rad phase 1")) return "Radiology Phase 1";
  if (zone.includes("rad phase 2")) return "Radiology Phase 2";
  return "Other";
};

const calculateDaysSinceCreated = (createdAtString) => {
  if (!createdAtString) return "-";
  try {
    let created;
    let month, day, year, hour = 0, minute = 0, second = 0;
    
    // Try parsing D/M/YYYY h:mm:ss AM/PM format (with two spaces) or M/D/YYYY format
    let dateMatch = createdAtString.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s{1,2}(\d{1,2}):(\d{2})(?::(\d{2}))?\s?(AM|PM)?/i);
    if (dateMatch) {
      const num1 = parseInt(dateMatch[1], 10);
      const num2 = parseInt(dateMatch[2], 10);
      const yearMatch = parseInt(dateMatch[3], 10);
      const hourMatch = parseInt(dateMatch[4], 10);
      const minMatch = parseInt(dateMatch[5], 10);
      const secMatch = dateMatch[6] ? parseInt(dateMatch[6], 10) : 0;
      const ampm = dateMatch[7] ? dateMatch[7].toUpperCase() : null;
      
      // Intelligently determine month and day
      // If first number > 12, it must be day (DD/MM format)
      // If second number > 12, first must be day
      if (num1 > 12) {
        day = num1;
        month = num2;
      } else if (num2 > 12) {
        day = num2;
        month = num1;
      } else {
        // Both could be valid, assume MM/DD format as default
        month = num1;
        day = num2;
      }
      
      year = yearMatch;
      hour = hourMatch;
      minute = minMatch;
      second = secMatch;
      
      // Convert 12-hour to 24-hour format if AM/PM provided
      if (ampm) {
        if (ampm === "PM" && hour !== 12) hour += 12;
        if (ampm === "AM" && hour === 12) hour = 0;
      }
      
      created = new Date(year, month - 1, day, hour, minute, second, 0);
    } else {
      // Try parsing DD-MM-YYYY HH:MM format (no AM/PM)
      dateMatch = createdAtString.match(/(\d{1,2})-(\d{1,2})-(\d{4})\s(\d{1,2}):(\d{2})/);
      if (dateMatch) {
        const num1 = parseInt(dateMatch[1], 10);
        const num2 = parseInt(dateMatch[2], 10);
        year = parseInt(dateMatch[3], 10);
        hour = parseInt(dateMatch[4], 10);
        minute = parseInt(dateMatch[5], 10);
        
        // Intelligently determine month and day
        if (num1 > 12) {
          day = num1;
          month = num2;
        } else if (num2 > 12) {
          day = num2;
          month = num1;
        } else {
          // Assume DD-MM format for dash-separated dates
          day = num1;
          month = num2;
        }
        
        created = new Date(year, month - 1, day, hour, minute, 0, 0);
      } else {
        // Fall back to native Date parsing
        created = new Date(createdAtString);
      }
    }
    
    if (Number.isNaN(created.getTime())) return "-";
    
    // Get today's date at midnight
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Get created date at midnight
    const createdDate = new Date(created);
    createdDate.setHours(0, 0, 0, 0);
    
    // Calculate difference in milliseconds
    const diffMs = today.getTime() - createdDate.getTime();
    // Convert to days
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    return diffDays >= 0 ? String(diffDays) : "-";
  } catch {
    return "-";
  }
};

const normalizeIssueIdDisplay = (value) => {
  const raw = normalizeValue(value);
  if (!raw) return "-";

  const compact = raw.replace(/\s+/g, "");
  const match = compact.match(/^([a-zA-Z]+)[-_]?(\d+)$/);
  if (match) {
    return `${match[1].toUpperCase()}-${match[2]}`;
  }

  return raw.toUpperCase().replace(/\s+/g, "-");
};

const ProjectIssueDashboard = () => {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const [activeTab, setActiveTab] = useState(() => searchParams.get("status") || "All");
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProjectName, setSelectedProjectName] = useState(() => searchParams.get("projectName") || "");
  const [selectedE2Detailer, setSelectedE2Detailer] = useState(() => searchParams.get("e2Detailer") || "");
  const [globalSearch, setGlobalSearch] = useState(() => searchParams.get("search") || "");
  const [selectedDateRange, setSelectedDateRange] = useState(() => searchParams.get("dateRange") || "All");
  const [chartTab, setChartTab] = useState("overview");

  // Keep URL in sync with filter state
  useEffect(() => {
    const params = {};
    if (activeTab !== "All") params.status = activeTab;
    if (selectedProjectName) params.projectName = selectedProjectName;
    if (selectedE2Detailer) params.e2Detailer = selectedE2Detailer;
    if (globalSearch) params.search = globalSearch;
    if (selectedDateRange !== "All") params.dateRange = selectedDateRange;
    setSearchParams(params, { replace: true });
  }, [activeTab, selectedProjectName, selectedE2Detailer, globalSearch, selectedDateRange, setSearchParams]);
  const [projectSources, setProjectSources] = useState({});
  const [savingIssueKeys, setSavingIssueKeys] = useState({});
  const [uploadingSnapshotKeys, setUploadingSnapshotKeys] = useState({});
  const [lightboxUrl, setLightboxUrl] = useState("");
  const [markupPopup, setMarkupPopup] = useState({ url: "", label: "" });
  const [markupPopupSize, setMarkupPopupSize] = useState({ width: 960, height: 640 });
  const [overviewPiePopup, setOverviewPiePopup] = useState({
    statusKey: "",
    statusLabel: "",
    segments: [],
  });
  const [uploadingDailyIssues, setUploadingDailyIssues] = useState(false);
  const [lastDailyIssuesUpdate, setLastDailyIssuesUpdate] = useState("");
  const [managedE2DetailerOptions, setManagedE2DetailerOptions] = useState(DEFAULT_E2_DETAILER_OPTIONS);
  const [managedE2StatusUpdateOptions, setManagedE2StatusUpdateOptions] = useState(DEFAULT_E2_STATUS_UPDATE_OPTIONS);
  const [managedTagAliases, setManagedTagAliases] = useState({});
  const [managedStatusFormats, setManagedStatusFormats] = useState({});
  const [managedE2StatusUpdateFormats, setManagedE2StatusUpdateFormats] = useState({});
  const dailyIssuesInputRef = useRef(null);
  const actionsMenuRef = useRef(null);

  const closeActionsMenu = () => {
    if (actionsMenuRef.current?.open) {
      actionsMenuRef.current.open = false;
    }
  };

  useEffect(() => {
    if (!id) return undefined;

    const configRef = doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID);
    const unsubscribe = onSnapshot(
      configRef,
      (snapshot) => {
        const data = snapshot.data() || {};
        const configured = Array.isArray(data[E2_DETAILER_OPTIONS_FIELD]) ? data[E2_DETAILER_OPTIONS_FIELD] : [];
        const normalized = configured
          .map((value) => normalizeValue(value))
          .filter(Boolean)
          .filter((value, index, array) => array.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index);

        setManagedE2DetailerOptions(normalized.length ? normalized : DEFAULT_E2_DETAILER_OPTIONS);

        const configuredStatus = Array.isArray(data[E2_STATUS_UPDATE_OPTIONS_FIELD])
          ? data[E2_STATUS_UPDATE_OPTIONS_FIELD]
          : [];
        const normalizedStatus = configuredStatus
          .map((value) => normalizeValue(value))
          .filter(Boolean)
          .filter((value, index, array) => array.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index);

        setManagedE2StatusUpdateOptions(
          normalizedStatus.some((value) => value.toLowerCase() === DEFAULT_E2_STATUS_UPDATE.toLowerCase())
            ? normalizedStatus
            : [DEFAULT_E2_STATUS_UPDATE, ...(normalizedStatus.length ? normalizedStatus : DEFAULT_E2_STATUS_UPDATE_OPTIONS)]
        );

        const configuredTagAliases =
          data[TAG_ALIASES_FIELD] && typeof data[TAG_ALIASES_FIELD] === "object" ? data[TAG_ALIASES_FIELD] : {};
        const normalizedTagAliases = Object.entries(configuredTagAliases).reduce((accumulator, [tagValue, aliasValue]) => {
          const normalizedTag = normalizeValue(tagValue);
          const normalizedAlias = normalizeValue(aliasValue);
          if (!normalizedTag || !normalizedAlias) return accumulator;
          accumulator[normalizedTag] = normalizedAlias;
          return accumulator;
        }, {});

        const configuredStatusFormats =
          data[STATUS_FORMATS_FIELD] && typeof data[STATUS_FORMATS_FIELD] === "object"
            ? data[STATUS_FORMATS_FIELD]
            : {};
        const normalizedStatusFormats = Object.entries(configuredStatusFormats).reduce(
          (accumulator, [statusValue, formatValue]) => {
            const normalizedStatus = normalizeValue(statusValue);
            if (!normalizedStatus) return accumulator;

            const normalizedLabel = normalizeValue(formatValue?.label);
            const normalizedTextColor = normalizeValue(formatValue?.textColor);
            const normalizedBackgroundColor = normalizeValue(formatValue?.backgroundColor);

            accumulator[normalizedStatus] = {
              label: normalizedLabel,
              textColor: normalizedTextColor,
              backgroundColor: normalizedBackgroundColor,
            };
            return accumulator;
          },
          {}
        );

        setManagedTagAliases(normalizedTagAliases);
        setManagedStatusFormats(normalizedStatusFormats);

        const configuredE2StatusUpdateFormats =
          data[E2_STATUS_UPDATE_FORMATS_FIELD] && typeof data[E2_STATUS_UPDATE_FORMATS_FIELD] === "object"
            ? data[E2_STATUS_UPDATE_FORMATS_FIELD]
            : {};
        const normalizedE2StatusUpdateFormats = Object.entries(configuredE2StatusUpdateFormats).reduce(
          (accumulator, [updateValue, formatValue]) => {
            const normalizedKey = normalizeValue(updateValue);
            if (!normalizedKey) return accumulator;
            accumulator[normalizedKey] = {
              textColor: normalizeValue(formatValue?.textColor),
              backgroundColor: normalizeValue(formatValue?.backgroundColor),
            };
            return accumulator;
          },
          {}
        );
        setManagedE2StatusUpdateFormats(normalizedE2StatusUpdateFormats);
      },
      () => {
        setManagedE2DetailerOptions(DEFAULT_E2_DETAILER_OPTIONS);
        setManagedE2StatusUpdateOptions(DEFAULT_E2_STATUS_UPDATE_OPTIONS);
        setManagedTagAliases({});
        setManagedStatusFormats({});
        setManagedE2StatusUpdateFormats({});
      }
    );

    return () => unsubscribe();
  }, [id]);

  useEffect(() => {
    if (!id) return undefined;

    setLoading(true);
    const projectsRef = collection(db, "churches", id, "bimProjects");

    const unsubscribe = onSnapshot(
      projectsRef,
      (snapshot) => {
        const nextIssues = [];
        const nextProjectSources = {};

        snapshot.forEach((projectDoc) => {
          const projectData = projectDoc.data() || {};
          const projectName = normalizeValue(projectData.name) || projectDoc.id;
          const fields = Array.isArray(projectData.fields) ? projectData.fields : [];
          const rows = Array.isArray(projectData.rows) ? projectData.rows : [];
          const internalCardMeta = projectData.internalCardMeta || {};

          nextProjectSources[projectDoc.id] = {
            fields,
            rows,
            lastUploadAt: projectData.lastUploadAt || projectData.updatedAt || null,
          };

          rows.forEach((row, rowIndex) => {
            const rowData = row?.rowData || {};
            const preview = getCardPreview(rowData, fields);
            const cardKey = getCardMetaKey(row, preview);
            const internalMeta = internalCardMeta?.[cardKey] || {};
            const createdAtField = findFieldByAliases(fields, rowData, ["created", "created date", "creation date", "createdAt", "date created"]);
            const createdAtValue = createdAtField ? normalizeValue(rowData[createdAtField]) : "";

            nextIssues.push({
              key: `${projectDoc.id}-${row?.rowNumber ?? "row"}-${rowIndex}`,
              id: preview.id || String(row?.rowNumber || rowIndex + 1),
              title: preview.title || "Untitled issue",
              tags: preview.tags || "-",
              markup: preview.markup,
              markupLink: preview.markupLink,
              owner: normalizeValue(preview.assignee) || normalizeValue(internalMeta.internalAssignee) || "Unassigned",
              e2Detailer: preview.e2Detailer,
              e2StatusUpdate: preview.e2StatusUpdate,
              e2StatusDate: preview.e2StatusDate,
              snapshotUrl: preview.snapshotUrl,
              link: preview.link,
              priority: preview.priority || "-",
              zone: preview.zone || "-",
              zoneCategory: getZoneCategory(preview.zone || ""),
              status: preview.status || "Open",
              dueDate: preview.deadline || "-",
              project: projectName,
              projectDocId: projectDoc.id,
              rowIndex,
              createdAt: createdAtValue,
            });
          });
        });

        setProjectSources(nextProjectSources);
        setIssues(nextIssues);
        setLoading(false);
      },
      () => {
        setProjectSources({});
        setIssues([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [id]);

  useEffect(() => {
    const lastUploadValue = projectSources?.[DAILY_ISSUES_TARGET_PROJECT_ID]?.lastUploadAt;
    if (!lastUploadValue) return;

    const formatted = formatUpdateTimestamp(lastUploadValue);
    if (formatted) {
      setLastDailyIssuesUpdate(formatted);
    }
  }, [projectSources]);

  const tabs = useMemo(() => {
    const dynamicStatuses = Array.from(new Set(issues.map((issue) => normalizeValue(issue.status)).filter(Boolean)));
    return ["All", ...dynamicStatuses];
  }, [issues]);

  const tagAliasByLowerTag = useMemo(() => {
    return Object.entries(managedTagAliases).reduce((accumulator, [tagValue, aliasValue]) => {
      const normalizedTag = normalizeValue(tagValue).toLowerCase();
      const normalizedAlias = normalizeValue(aliasValue);
      if (!normalizedTag || !normalizedAlias) return accumulator;
      accumulator[normalizedTag] = normalizedAlias;
      return accumulator;
    }, {});
  }, [managedTagAliases]);

  const statusFormatByLowerStatus = useMemo(() => {
    return Object.entries(managedStatusFormats).reduce((accumulator, [statusValue, formatValue]) => {
      const normalizedStatus = normalizeValue(statusValue).toLowerCase();
      if (!normalizedStatus) return accumulator;
      accumulator[normalizedStatus] = {
        label: normalizeValue(formatValue?.label),
        textColor: normalizeValue(formatValue?.textColor),
        backgroundColor: normalizeValue(formatValue?.backgroundColor),
      };
      return accumulator;
    }, {});
  }, [managedStatusFormats]);

  const e2StatusUpdateFormatByLowerValue = useMemo(() => {
    return Object.entries(managedE2StatusUpdateFormats).reduce((accumulator, [updateValue, formatValue]) => {
      accumulator[updateValue.toLowerCase()] = formatValue;
      return accumulator;
    }, {});
  }, [managedE2StatusUpdateFormats]);

  const getStatusDisplayText = (statusValue) => {
    const safeStatus = normalizeValue(statusValue) || "Unknown";
    const statusFormat = statusFormatByLowerStatus[safeStatus.toLowerCase()] || {};
    return normalizeValue(statusFormat.label) || safeStatus;
  };

  const statusColumnWidthCh = useMemo(() => {
    const maxLength = issues.reduce((largest, issue) => {
      const length = getStatusDisplayText(issue.status).length;
      return Math.max(largest, length);
    }, "Status".length);

    // Add a small buffer for badge padding and avoid collapsing on short values.
    return Math.max(maxLength + 4, 12);
  }, [issues, statusFormatByLowerStatus]);

  const getProjectNameDisplay = (issue) => {
    const normalizedTag = normalizeValue(issue?.tags).toLowerCase();
    return (normalizedTag && tagAliasByLowerTag[normalizedTag]) || normalizeValue(issue?.zoneCategory) || "-";
  };

  const visibleIssues = useMemo(() => {
    const normalizedSearch = normalizeValue(globalSearch).toLowerCase();
    const normalizedActiveTab = normalizeValue(activeTab).toLowerCase();
    const normalizedProjectName = normalizeValue(selectedProjectName).toLowerCase();
    const normalizedSelectedDetailer = normalizeValue(selectedE2Detailer).toLowerCase();

    const dateRangeBounds = getDateRangeBounds(selectedDateRange);

    return issues.filter((issue) => {
      if (activeTab !== "All" && normalizeValue(issue.status).toLowerCase() !== normalizedActiveTab) {
        return false;
      }

      if (selectedProjectName && normalizeValue(getProjectNameDisplay(issue)).toLowerCase() !== normalizedProjectName) {
        return false;
      }

      if (selectedE2Detailer && normalizeValue(issue.e2Detailer).toLowerCase() !== normalizedSelectedDetailer) {
        return false;
      }

      if (dateRangeBounds) {
        const d = parseStatusUpdateDate(issue.e2StatusDate);
        if (!d || d < dateRangeBounds[0] || d > dateRangeBounds[1]) return false;
      }

      if (!normalizedSearch) return true;

      const haystack = [
        issue.project,
        issue.id,
        issue.title,
        issue.tags,
        issue.markup,
        issue.markupLink,
        issue.owner,
        issue.e2Detailer,
        issue.e2StatusUpdate,
        issue.priority,
        issue.zone,
        getProjectNameDisplay(issue),
        issue.zoneCategory,
        issue.status,
        issue.dueDate,
      ]
        .map((value) => normalizeValue(value).toLowerCase())
        .join(" ");

      return haystack.includes(normalizedSearch);
    });
  }, [activeTab, globalSearch, issues, selectedE2Detailer, selectedProjectName, selectedDateRange, tagAliasByLowerTag]);

  const projectNameOptions = useMemo(() => {
    return Array.from(new Set(issues.map((issue) => getProjectNameDisplay(issue)).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [issues, tagAliasByLowerTag]);
  const e2DetailerOptions = useMemo(
    () => {
      // Respect the managed order; append any values found in issue data that aren't in the managed list
      const managedLower = new Set(managedE2DetailerOptions.map((v) => v.toLowerCase()));
      const extra = issues
        .map((issue) => normalizeValue(issue.e2Detailer))
        .filter((v) => v && !managedLower.has(v.toLowerCase()))
        .filter((value, index, array) => array.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index);

      return [...managedE2DetailerOptions, ...extra];
    },
    [issues, managedE2DetailerOptions]
  );
  const e2StatusUpdateOptions = useMemo(() => {
    // Respect the managed order; append any values found in issue data that aren't in the managed list
    const managedLower = new Set(managedE2StatusUpdateOptions.map((v) => v.toLowerCase()));
    const extra = issues
      .map((issue) => normalizeValue(issue.e2StatusUpdate))
      .filter((v) => v && !managedLower.has(v.toLowerCase()))
      .filter((value, index, array) => array.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index);

    return [...managedE2StatusUpdateOptions, ...extra];
  }, [issues, managedE2StatusUpdateOptions]);

  const e2StatusUpdateCounts = useMemo(() => {
    const normalizedProjectName = normalizeValue(selectedProjectName).toLowerCase();
    const normalizedSelectedDetailer = normalizeValue(selectedE2Detailer).toLowerCase();
    const normalizedActiveTab = normalizeValue(activeTab).toLowerCase();
    const dateRangeBounds = getDateRangeBounds(selectedDateRange);

    const counts = {};
    issues.forEach((issue) => {
      if (selectedProjectName && normalizeValue(getProjectNameDisplay(issue)).toLowerCase() !== normalizedProjectName) {
        return;
      }
      if (selectedE2Detailer && normalizeValue(issue.e2Detailer).toLowerCase() !== normalizedSelectedDetailer) {
        return;
      }
      if (activeTab !== "All" && normalizeValue(issue.status).toLowerCase() !== normalizedActiveTab) {
        return;
      }
      if (dateRangeBounds) {
        const d = parseStatusUpdateDate(issue.e2StatusDate);
        if (!d || d < dateRangeBounds[0] || d > dateRangeBounds[1]) return;
      }
      const label = normalizeValue(issue.e2StatusUpdate) || "No Update";
      counts[label] = (counts[label] || 0) + 1;
    });

    return Object.entries(counts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }, [issues, selectedProjectName, selectedE2Detailer, activeTab, selectedDateRange, tagAliasByLowerTag]);

  const e2StatusUpdateTimeframeLabel = useMemo(() => {
    const bounds = getDateRangeBounds(selectedDateRange);
    if (!bounds) {
      return "From: All dates To: Today";
    }

    const [startDate, endDate] = bounds;
    return `From: ${formatChartRangeDate(startDate)} To: ${formatChartRangeDate(endDate)}`;
  }, [selectedDateRange]);

  const summaryProjectName = selectedProjectName || "All Projects";
  const scopedIssueCount = useMemo(() => {
    const normalizedProjectName = normalizeValue(selectedProjectName).toLowerCase();
    const normalizedSelectedDetailer = normalizeValue(selectedE2Detailer).toLowerCase();
    const dateRangeBounds = getDateRangeBounds(selectedDateRange);

    return issues.filter((issue) => {
      if (selectedProjectName && normalizeValue(getProjectNameDisplay(issue)).toLowerCase() !== normalizedProjectName) {
        return false;
      }
      if (selectedE2Detailer && normalizeValue(issue.e2Detailer).toLowerCase() !== normalizedSelectedDetailer) {
        return false;
      }
      if (dateRangeBounds) {
        const d = parseStatusUpdateDate(issue.e2StatusDate);
        if (!d || d < dateRangeBounds[0] || d > dateRangeBounds[1]) return false;
      }
      return true;
    }).length;
  }, [issues, selectedProjectName, selectedE2Detailer, selectedDateRange, tagAliasByLowerTag]);
  const summaryStatusName = activeTab === "All" ? "All Statuses" : activeTab;
  const statusScopedIssueCount = useMemo(() => {
    const normalizedActiveTab = normalizeValue(activeTab).toLowerCase();
    const normalizedProjectName = normalizeValue(selectedProjectName).toLowerCase();
    const normalizedSelectedDetailer = normalizeValue(selectedE2Detailer).toLowerCase();
    const dateRangeBounds = getDateRangeBounds(selectedDateRange);

    return issues.filter((issue) => {
      if (selectedProjectName && normalizeValue(getProjectNameDisplay(issue)).toLowerCase() !== normalizedProjectName) {
        return false;
      }

      if (selectedE2Detailer && normalizeValue(issue.e2Detailer).toLowerCase() !== normalizedSelectedDetailer) {
        return false;
      }

      if (activeTab !== "All" && normalizeValue(issue.status).toLowerCase() !== normalizedActiveTab) {
        return false;
      }

      if (dateRangeBounds) {
        const d = parseStatusUpdateDate(issue.e2StatusDate);
        if (!d || d < dateRangeBounds[0] || d > dateRangeBounds[1]) return false;
      }

      return true;
    }).length;
  }, [activeTab, issues, selectedProjectName, selectedE2Detailer, selectedDateRange, tagAliasByLowerTag]);

  const overviewTotalStatusFormat = statusFormatByLowerStatus["all statuses"] || {};
  const overviewTotalBackground = normalizeValue(overviewTotalStatusFormat.backgroundColor);
  const overviewTotalBarStyle = {
    width: `${scopedIssueCount ? 100 : 0}%`,
  };
  if (overviewTotalBackground) {
    overviewTotalBarStyle.background = overviewTotalBackground;
  }

  const summaryStatusFormat = statusFormatByLowerStatus[normalizeValue(summaryStatusName).toLowerCase()] || {};
  const summaryStatusBackground = normalizeValue(summaryStatusFormat.backgroundColor);
  const overviewFilteredBarStyle = {
    width: `${scopedIssueCount ? Math.max((statusScopedIssueCount / scopedIssueCount) * 100, 2) : 0}%`,
  };
  if (summaryStatusBackground) {
    overviewFilteredBarStyle.background = summaryStatusBackground;
  }

  const overviewStatusCounts = useMemo(() => {
    const normalizedProjectName = normalizeValue(selectedProjectName).toLowerCase();
    const normalizedSelectedDetailer = normalizeValue(selectedE2Detailer).toLowerCase();
    const dateRangeBounds = getDateRangeBounds(selectedDateRange);
    const countsByStatus = {};

    issues.forEach((issue) => {
      if (selectedProjectName && normalizeValue(getProjectNameDisplay(issue)).toLowerCase() !== normalizedProjectName) {
        return;
      }

      if (selectedE2Detailer && normalizeValue(issue.e2Detailer).toLowerCase() !== normalizedSelectedDetailer) {
        return;
      }

      if (dateRangeBounds) {
        const d = parseStatusUpdateDate(issue.e2StatusDate);
        if (!d || d < dateRangeBounds[0] || d > dateRangeBounds[1]) return;
      }

      const rawStatus = normalizeValue(issue.status) || "Unknown";
      countsByStatus[rawStatus] = (countsByStatus[rawStatus] || 0) + 1;
    });

    return Object.entries(countsByStatus)
      .map(([rawStatus, count]) => {
        const statusFormat = statusFormatByLowerStatus[rawStatus.toLowerCase()] || {};
        return {
          rawStatus,
          label: getStatusDisplayText(rawStatus),
          count,
          backgroundColor: normalizeValue(statusFormat.backgroundColor),
        };
      })
      .sort((a, b) => b.count - a.count);
  }, [issues, selectedProjectName, selectedE2Detailer, selectedDateRange, statusFormatByLowerStatus, tagAliasByLowerTag]);

  const overviewE2BreakdownByStatus = useMemo(() => {
    const normalizedProjectName = normalizeValue(selectedProjectName).toLowerCase();
    const normalizedSelectedDetailer = normalizeValue(selectedE2Detailer).toLowerCase();
    const dateRangeBounds = getDateRangeBounds(selectedDateRange);
    const grouped = {};

    issues.forEach((issue) => {
      if (selectedProjectName && normalizeValue(getProjectNameDisplay(issue)).toLowerCase() !== normalizedProjectName) {
        return;
      }

      if (selectedE2Detailer && normalizeValue(issue.e2Detailer).toLowerCase() !== normalizedSelectedDetailer) {
        return;
      }

      if (dateRangeBounds) {
        const d = parseStatusUpdateDate(issue.e2StatusDate);
        if (!d || d < dateRangeBounds[0] || d > dateRangeBounds[1]) return;
      }

      const rawStatus = normalizeValue(issue.status) || "Unknown";
      const e2Update = getDefaultE2StatusUpdate(issue.e2StatusUpdate);

      if (!grouped[rawStatus]) {
        grouped[rawStatus] = {
          total: 0,
          e2Counts: {},
        };
      }

      grouped[rawStatus].total += 1;
      grouped[rawStatus].e2Counts[e2Update] = (grouped[rawStatus].e2Counts[e2Update] || 0) + 1;
    });

    return Object.entries(grouped).reduce((accumulator, [rawStatus, payload]) => {
      const segments = Object.entries(payload.e2Counts)
        .map(([label, count]) => {
          const e2Format = e2StatusUpdateFormatByLowerValue[label.toLowerCase()] || {};
          return {
            label,
            count,
            pct: payload.total ? Math.round((count / payload.total) * 100) : 0,
            widthPct: payload.total ? (count / payload.total) * 100 : 0,
            backgroundColor: normalizeValue(e2Format.backgroundColor),
          };
        })
        .sort((a, b) => b.count - a.count);

      accumulator[rawStatus] = segments;
      return accumulator;
    }, {});
  }, [
    issues,
    selectedProjectName,
    selectedE2Detailer,
    selectedDateRange,
    e2StatusUpdateFormatByLowerValue,
    tagAliasByLowerTag,
  ]);

  const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const trendChartBuckets = useMemo(() => {
    const normalizedProjectName = normalizeValue(selectedProjectName).toLowerCase();
    const normalizedSelectedDetailer = normalizeValue(selectedE2Detailer).toLowerCase();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

    // filter issues respecting project/detailer filters (NOT the date range filter — trend shows its own range)
    const filtered = issues.filter((issue) => {
      if (selectedProjectName && normalizeValue(getProjectNameDisplay(issue)).toLowerCase() !== normalizedProjectName) {
        return false;
      }
      if (selectedE2Detailer && normalizeValue(issue.e2Detailer).toLowerCase() !== normalizedSelectedDetailer) {
        return false;
      }
      return true;
    });

    if (selectedDateRange === "TW") {
      // Buckets: Sun–Sat of the current week
      const dow = today.getDay();
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - dow);
      const buckets = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + i);
        return { key: `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`, label: DAY_ABBR[d.getDay()], count: 0, date: d };
      });
      filtered.forEach((issue) => {
        const d = parseStatusUpdateDate(issue.e2StatusDate);
        if (!d) return;
        if (d < weekStart || d > today) return;
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        const bucket = buckets.find((b) => b.key === key);
        if (bucket) bucket.count += 1;
      });
      return buckets;
    }

    if (selectedDateRange === "MTD") {
      // Buckets: day 1 to today within the current month
      const daysInMonth = today.getDate();
      const buckets = Array.from({ length: daysInMonth }, (_, i) => ({
        key: String(i + 1),
        label: String(i + 1),
        count: 0,
        date: new Date(today.getFullYear(), today.getMonth(), i + 1),
      }));
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      filtered.forEach((issue) => {
        const d = parseStatusUpdateDate(issue.e2StatusDate);
        if (!d) return;
        if (d < monthStart || d > today) return;
        const dayIdx = d.getDate() - 1;
        if (buckets[dayIdx]) buckets[dayIdx].count += 1;
      });
      return buckets;
    }

    if (selectedDateRange === "YTD") {
      // Buckets: Jan–current month
      const buckets = Array.from({ length: today.getMonth() + 1 }, (_, i) => ({
        key: String(i),
        label: MONTH_ABBR[i],
        count: 0,
        date: new Date(today.getFullYear(), i, 1),
      }));
      const yearStart = new Date(today.getFullYear(), 0, 1);
      filtered.forEach((issue) => {
        const d = parseStatusUpdateDate(issue.e2StatusDate);
        if (!d) return;
        if (d < yearStart || d > today) return;
        const monthIdx = d.getMonth();
        if (buckets[monthIdx]) buckets[monthIdx].count += 1;
      });
      return buckets;
    }

    // All: bucket by year-month (sorted)
    const countsByYM = {};
    filtered.forEach((issue) => {
      const d = parseStatusUpdateDate(issue.e2StatusDate);
      if (!d) return;
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
      countsByYM[key] = (countsByYM[key] || 0) + 1;
    });
    return Object.entries(countsByYM)
      .sort(([a], [b]) => (a > b ? 1 : -1))
      .map(([key]) => {
        const [yr, mo] = key.split("-");
        const monthIdx = parseInt(mo, 10);
        return { key, label: `${MONTH_ABBR[monthIdx]} '${String(yr).slice(-2)}`, count: countsByYM[key] };
      });
  }, [issues, selectedProjectName, selectedE2Detailer, selectedDateRange, tagAliasByLowerTag]);

  const trendChartTabTitle = selectedDateRange === "YTD" ? "Trending (YTD)" : "Trending";

  const getOverviewSegmentColor = (segment, index) => {
    return normalizeValue(segment?.backgroundColor) || PIE_FALLBACK_COLORS[index % PIE_FALLBACK_COLORS.length];
  };

  const openOverviewPiePopup = (rawStatus, statusLabel) => {
    const segments = overviewE2BreakdownByStatus[rawStatus] || [];
    if (!segments.length) return;
    setOverviewPiePopup({
      statusKey: rawStatus,
      statusLabel,
      segments,
    });
  };

  const closeOverviewPiePopup = () => {
    setOverviewPiePopup({ statusKey: "", statusLabel: "", segments: [] });
  };

  const overviewPieTotal = useMemo(
    () => overviewPiePopup.segments.reduce((sum, segment) => sum + Number(segment.count || 0), 0),
    [overviewPiePopup.segments]
  );

  const overviewPieStyle = useMemo(() => {
    if (!overviewPiePopup.segments.length) return {};
    let cursor = 0;
    const stops = overviewPiePopup.segments.map((segment, index) => {
      const start = cursor;
      cursor += Number(segment.widthPct || 0);
      const end = Math.min(cursor, 100);
      const color = getOverviewSegmentColor(segment, index);
      return `${color} ${start}% ${end}%`;
    });
    return {
      background: `conic-gradient(${stops.join(", ")})`,
    };
  }, [overviewPiePopup.segments]);

  useEffect(() => {
    if (!tabs.includes(activeTab)) {
      setActiveTab("All");
    }
  }, [activeTab, tabs]);

  const handleE2DetailerChange = (issueKey, value) => {
    setIssues((previous) =>
      previous.map((issue) => (issue.key === issueKey ? { ...issue, e2Detailer: value } : issue))
    );
  };

  const handleE2DetailerSave = async (issue, valueOverride) => {
    if (!id || !issue?.projectDocId) return;

    const projectSource = projectSources[issue.projectDocId];
    if (!projectSource) return;

    const previousRows = Array.isArray(projectSource.rows) ? projectSource.rows : [];
    const previousFields = Array.isArray(projectSource.fields) ? projectSource.fields : [];
    const targetRow = previousRows[issue.rowIndex];
    if (!targetRow) return;

    const previousRowData = targetRow?.rowData || {};
    const fieldName =
      findFieldByAliases(previousFields, previousRowData, ["e2 detailer", "e2detailer"]) || E2_DETAILER_FIELD;
    const nextValue = normalizeValue(valueOverride ?? issue.e2Detailer);
    const previousValue = normalizeValue(previousRowData[fieldName]);

    if (nextValue === previousValue) return;

    const updatedRowData = {
      ...previousRowData,
      [fieldName]: nextValue,
    };
    const updatedRows = previousRows.map((row, index) =>
      index === issue.rowIndex ? { ...row, rowData: updatedRowData } : row
    );
    const updatedFields = previousFields.includes(fieldName) ? previousFields : [...previousFields, fieldName];
    const previousSource = projectSource;

    setProjectSources((previous) => ({
      ...previous,
      [issue.projectDocId]: {
        fields: updatedFields,
        rows: updatedRows,
      },
    }));
    setSavingIssueKeys((previous) => ({ ...previous, [issue.key]: true }));

    try {
      await updateDoc(doc(db, "churches", id, "bimProjects", issue.projectDocId), {
        fields: updatedFields,
        rows: updatedRows,
        updatedAt: new Date(),
      });
    } catch (error) {
      console.error("Error updating E2 Detailer:", error);
      setProjectSources((previous) => ({
        ...previous,
        [issue.projectDocId]: previousSource,
      }));
      setIssues((previous) =>
        previous.map((item) =>
          item.key === issue.key ? { ...item, e2Detailer: previousValue } : item
        )
      );
    } finally {
      setSavingIssueKeys((previous) => {
        const next = { ...previous };
        delete next[issue.key];
        return next;
      });
    }
  };

  const handleE2StatusUpdateChange = (issueKey, value) => {
    const normalizedValue = getDefaultE2StatusUpdate(value);
    const today = getTodayMMDDYY();
    setIssues((previous) =>
      previous.map((issue) =>
        issue.key === issueKey ? { ...issue, e2StatusUpdate: normalizedValue, e2StatusDate: today } : issue
      )
    );
  };

  const handleE2StatusDateChange = (issueKey, value) => {
    setIssues((previous) =>
      previous.map((issue) =>
        issue.key === issueKey ? { ...issue, e2StatusDate: getDefaultE2StatusDate(value) } : issue
      )
    );
  };

  const handleE2StatusDateSave = async (issue, valueOverride) => {
    if (!id || !issue?.projectDocId) return;

    const projectSource = projectSources[issue.projectDocId];
    if (!projectSource) return;

    const previousRows = Array.isArray(projectSource.rows) ? projectSource.rows : [];
    const previousFields = Array.isArray(projectSource.fields) ? projectSource.fields : [];
    const targetRow = previousRows[issue.rowIndex];
    if (!targetRow) return;

    const previousRowData = targetRow?.rowData || {};
    const fieldName =
      findFieldByAliases(previousFields, previousRowData, ["e2 status date", "e2statusdate"]) || E2_STATUS_DATE_FIELD;
    const nextValue = getDefaultE2StatusDate(valueOverride ?? issue.e2StatusDate);
    const previousValue = normalizeValue(previousRowData[fieldName]);

    if (nextValue === previousValue) return;

    const updatedRowData = { ...previousRowData, [fieldName]: nextValue };
    const updatedRows = previousRows.map((row, index) =>
      index === issue.rowIndex ? { ...row, rowData: updatedRowData } : row
    );
    const updatedFields = previousFields.includes(fieldName) ? previousFields : [...previousFields, fieldName];
    const previousSource = projectSource;

    setProjectSources((previous) => ({
      ...previous,
      [issue.projectDocId]: { fields: updatedFields, rows: updatedRows },
    }));
    setSavingIssueKeys((previous) => ({ ...previous, [`e2date:${issue.key}`]: true }));

    try {
      await updateDoc(doc(db, "churches", id, "bimProjects", issue.projectDocId), {
        fields: updatedFields,
        rows: updatedRows,
        updatedAt: new Date(),
      });
    } catch (error) {
      console.error("Error updating Status Update Date:", error);
      setProjectSources((previous) => ({ ...previous, [issue.projectDocId]: previousSource }));
      setIssues((previous) =>
        previous.map((item) =>
          item.key === issue.key ? { ...item, e2StatusDate: previousValue } : item
        )
      );
    } finally {
      setSavingIssueKeys((previous) => {
        const next = { ...previous };
        delete next[`e2date:${issue.key}`];
        return next;
      });
    }
  };

  const handleTechDetailsChange = (issueKey, value) => {
    setIssues((previous) =>
      previous.map((issue) => (issue.key === issueKey ? { ...issue, techDetailsAvailable: value } : issue))
    );
  };

  const handleTechDetailsSave = async (issue, valueOverride) => {
    if (!id || !issue?.projectDocId) return;

    const projectSource = projectSources[issue.projectDocId];
    if (!projectSource) return;

    const previousRows = Array.isArray(projectSource.rows) ? projectSource.rows : [];
    const previousFields = Array.isArray(projectSource.fields) ? projectSource.fields : [];
    const targetRow = previousRows[issue.rowIndex];
    if (!targetRow) return;

    const previousRowData = targetRow?.rowData || {};
    const fieldName =
      findFieldByAliases(previousFields, previousRowData, ["technical details available", "technical details", "techdetailsavailable"]) || TECH_DETAILS_FIELD;
    const nextValue = normalizeValue(valueOverride ?? issue.techDetailsAvailable);
    const previousValue = normalizeValue(previousRowData[fieldName]);

    if (nextValue === previousValue) return;

    const updatedRowData = { ...previousRowData, [fieldName]: nextValue };
    const updatedRows = previousRows.map((row, index) =>
      index === issue.rowIndex ? { ...row, rowData: updatedRowData } : row
    );
    const updatedFields = previousFields.includes(fieldName) ? previousFields : [...previousFields, fieldName];
    const previousSource = projectSource;

    setProjectSources((previous) => ({
      ...previous,
      [issue.projectDocId]: { fields: updatedFields, rows: updatedRows },
    }));
    setSavingIssueKeys((previous) => ({ ...previous, [`techdetails:${issue.key}`]: true }));

    try {
      await updateDoc(doc(db, "churches", id, "bimProjects", issue.projectDocId), {
        fields: updatedFields,
        rows: updatedRows,
        updatedAt: new Date(),
      });
    } catch (error) {
      console.error("Error updating Technical Details Available:", error);
      setProjectSources((previous) => ({ ...previous, [issue.projectDocId]: previousSource }));
      setIssues((previous) =>
        previous.map((item) =>
          item.key === issue.key ? { ...item, techDetailsAvailable: previousValue } : item
        )
      );
    } finally {
      setSavingIssueKeys((previous) => {
        const next = { ...previous };
        delete next[`techdetails:${issue.key}`];
        return next;
      });
    }
  };

  const handleE2StatusUpdateSave = async (issue, valueOverride) => {
    if (!id || !issue?.projectDocId) return;

    const projectSource = projectSources[issue.projectDocId];
    if (!projectSource) return;

    const previousRows = Array.isArray(projectSource.rows) ? projectSource.rows : [];
    const previousFields = Array.isArray(projectSource.fields) ? projectSource.fields : [];
    const targetRow = previousRows[issue.rowIndex];
    if (!targetRow) return;

    const previousRowData = targetRow?.rowData || {};
    const fieldName =
      findFieldByAliases(previousFields, previousRowData, ["e2 status update", "e2statusupdate"]) || E2_STATUS_UPDATE_FIELD;
    const nextValue = getDefaultE2StatusUpdate(valueOverride ?? issue.e2StatusUpdate);
    const previousValue = normalizeValue(previousRowData[fieldName]);

    if (nextValue === previousValue) return;

    const dateFieldName =
      findFieldByAliases(previousFields, previousRowData, ["e2 status date", "e2statusdate"]) || E2_STATUS_DATE_FIELD;
    const todayDate = getTodayMMDDYY();
    const previousDateValue = normalizeValue(previousRowData[dateFieldName]);

    const updatedRowData = {
      ...previousRowData,
      [fieldName]: nextValue,
      [dateFieldName]: todayDate,
    };
    const updatedRows = previousRows.map((row, index) =>
      index === issue.rowIndex ? { ...row, rowData: updatedRowData } : row
    );
    let updatedFields = previousFields.includes(fieldName) ? previousFields : [...previousFields, fieldName];
    updatedFields = updatedFields.includes(dateFieldName) ? updatedFields : [...updatedFields, dateFieldName];
    const previousSource = projectSource;

    setProjectSources((previous) => ({
      ...previous,
      [issue.projectDocId]: {
        fields: updatedFields,
        rows: updatedRows,
      },
    }));
    setSavingIssueKeys((previous) => ({ ...previous, [`e2status:${issue.key}`]: true }));

    try {
      await updateDoc(doc(db, "churches", id, "bimProjects", issue.projectDocId), {
        fields: updatedFields,
        rows: updatedRows,
        updatedAt: new Date(),
      });
    } catch (error) {
      console.error("Error updating E2 Status Update:", error);
      setProjectSources((previous) => ({
        ...previous,
        [issue.projectDocId]: previousSource,
      }));
      setIssues((previous) =>
        previous.map((item) =>
          item.key === issue.key
            ? { ...item, e2StatusUpdate: previousValue, e2StatusDate: previousDateValue }
            : item
        )
      );
    } finally {
      setSavingIssueKeys((previous) => {
        const next = { ...previous };
        delete next[`e2status:${issue.key}`];
        return next;
      });
    }
  };

  const handleSnapshotUpload = async (issue, file) => {
    if (!file || !id || !issue?.projectDocId) return;

    const safeKey = issue.key.replace(/[^a-zA-Z0-9-_]/g, "_");
    const ext = file.name.split(".").pop();
    const path = `churches/${id}/bimProjects/${issue.projectDocId}/snapshots/${safeKey}.${ext}`;
    const fileRef = storageRef(storage, path);

    setUploadingSnapshotKeys((previous) => ({ ...previous, [issue.key]: true }));

    try {
      await uploadBytes(fileRef, file);
      const downloadURL = await getDownloadURL(fileRef);

      const projectSource = projectSources[issue.projectDocId];
      if (!projectSource) return;

      const previousRows = Array.isArray(projectSource.rows) ? projectSource.rows : [];
      const previousFields = Array.isArray(projectSource.fields) ? projectSource.fields : [];
      const targetRow = previousRows[issue.rowIndex];
      if (!targetRow) return;

      const previousRowData = targetRow?.rowData || {};
      const fieldName =
        findFieldByAliases(previousFields, previousRowData, ["snapshot url", "snapshoturl", "snapshot"]) || SNAPSHOT_FIELD;

      const updatedRowData = { ...previousRowData, [fieldName]: downloadURL };
      const updatedRows = previousRows.map((row, index) =>
        index === issue.rowIndex ? { ...row, rowData: updatedRowData } : row
      );
      const updatedFields = previousFields.includes(fieldName) ? previousFields : [...previousFields, fieldName];

      setProjectSources((previous) => ({
        ...previous,
        [issue.projectDocId]: { fields: updatedFields, rows: updatedRows },
      }));
      setIssues((previous) =>
        previous.map((item) => (item.key === issue.key ? { ...item, snapshotUrl: downloadURL } : item))
      );

      await updateDoc(doc(db, "churches", id, "bimProjects", issue.projectDocId), {
        fields: updatedFields,
        rows: updatedRows,
        updatedAt: new Date(),
      });
    } catch (error) {
      console.error("Error uploading snapshot:", error);
    } finally {
      setUploadingSnapshotKeys((previous) => {
        const next = { ...previous };
        delete next[issue.key];
        return next;
      });
    }
  };

  const importDailyIssuesFile = async (file) => {
    if (!file) return;

    setUploadingDailyIssues(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const fallbackSheetName = workbook.SheetNames?.[1] || workbook.SheetNames?.[0];
      const selectedSheetName = workbook.SheetNames.includes(DAILY_ISSUES_SHEET_NAME)
        ? DAILY_ISSUES_SHEET_NAME
        : fallbackSheetName;

      const worksheet = selectedSheetName ? workbook.Sheets[selectedSheetName] : null;
      if (!worksheet) {
        throw new Error("No worksheet found to import.");
      }

      const matrix = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: "",
        raw: false,
      });

      const rawHeaders = Array.isArray(matrix?.[0]) ? matrix[0] : [];
      const excelHeaders = rawHeaders.map((header) => normalizeValue(header)).filter(Boolean);

      if (!excelHeaders.length) {
        throw new Error("The selected worksheet has no headers.");
      }

      const parsedRows = (matrix.slice(1) || [])
        .map((cells, index) => {
          const rowData = {};
          excelHeaders.forEach((field, fieldIndex) => {
            rowData[field] = normalizeValue(cells?.[fieldIndex]);
          });

          const hasData = Object.values(rowData).some((value) => normalizeValue(value));
          if (!hasData) return null;

          return {
            rowNumber: index + 1,
            rowData,
          };
        })
        .filter(Boolean);

      if (!parsedRows.length) {
        throw new Error("The selected worksheet has no data rows.");
      }

      const targetProjectId = DAILY_ISSUES_TARGET_PROJECT_ID;
      const existingRows = Array.isArray(projectSources?.[targetProjectId]?.rows)
        ? projectSources[targetProjectId].rows
        : [];
      const existingFields = Array.isArray(projectSources?.[targetProjectId]?.fields)
        ? projectSources[targetProjectId].fields
        : [];
      const mergedFields = Array.from(
        new Set([
          ...existingFields.map((field) => normalizeValue(field)).filter(Boolean),
          ...excelHeaders,
        ])
      );

      const getPrimaryIssueId = (rowData = {}) => {
        const idField = findFieldByAliases(mergedFields, rowData, ["issue id", "id", "task id", "card id", "row id"]);
        return normalizeValue(idField ? rowData?.[idField] : "");
      };

      const existingRowsById = new Map();
      const nextRows = existingRows.map((row, index) => {
        const rowData = row?.rowData || {};
        const issueId = getPrimaryIssueId(rowData);
        if (issueId) {
          existingRowsById.set(issueId, index);
        }

        return {
          ...row,
          rowData: { ...rowData },
        };
      });

      let changedCells = 0;
      let updatedRowsCount = 0;
      let insertedRowsCount = 0;
      let skippedRowsWithoutId = 0;

      parsedRows.forEach((incomingRow) => {
        const incomingRowData = incomingRow?.rowData || {};
        const issueId = getPrimaryIssueId(incomingRowData);
        if (!issueId) {
          skippedRowsWithoutId += 1;
          return;
        }

        const existingIndex = existingRowsById.get(issueId);
        if (existingIndex === undefined) {
          nextRows.push({
            rowNumber: nextRows.length + 1,
            rowData: { ...incomingRowData },
          });
          existingRowsById.set(issueId, nextRows.length - 1);
          insertedRowsCount += 1;
          changedCells += Object.keys(incomingRowData).length;
          return;
        }

        const existingRow = nextRows[existingIndex] || {};
        const existingRowData = existingRow?.rowData || {};
        let rowChanged = false;
        const mergedRowData = { ...existingRowData };

        Object.entries(incomingRowData).forEach(([field, incomingValue]) => {
          const previousValue = normalizeValue(existingRowData[field]);
          const nextValue = normalizeValue(incomingValue);
          if (previousValue !== nextValue) {
            mergedRowData[field] = nextValue;
            changedCells += 1;
            rowChanged = true;
          }
        });

        if (rowChanged) {
          nextRows[existingIndex] = {
            ...existingRow,
            rowData: mergedRowData,
          };
          updatedRowsCount += 1;
        }
      });

      if (!changedCells) {
        toast.info("No data changes detected. Existing grid values were kept intact.");
        return;
      }

      await setDoc(
        doc(db, "churches", id, "bimProjects", targetProjectId),
        {
          name: DAILY_ISSUES_TARGET_PROJECT_NAME,
          fields: mergedFields,
          rows: nextRows,
          rowCount: nextRows.length,
          lastFileName: file.name,
          lastUploadAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setLastDailyIssuesUpdate(formatUpdateTimestamp(new Date()));

      if (selectedSheetName !== DAILY_ISSUES_SHEET_NAME) {
        toast.warn(`Imported fallback tab: ${selectedSheetName}`);
      }

      toast.success(
        `Sync complete from ${selectedSheetName}: ${updatedRowsCount} updated, ${insertedRowsCount} inserted, ${changedCells} changed cells.`
      );
      if (skippedRowsWithoutId) {
        toast.warn(`${skippedRowsWithoutId} row(s) were skipped because they do not contain Issue ID.`);
      }
    } catch (error) {
      console.error("Error importing daily issues:", error);
      toast.error(error?.message || "Could not import daily issues file.");
    } finally {
      setUploadingDailyIssues(false);
      if (dailyIssuesInputRef.current) {
        dailyIssuesInputRef.current.value = "";
      }
    }
  };

  const handleDailyIssuesUpload = async (event) => {
    const file = event.target.files?.[0];
    await importDailyIssuesFile(file);
  };

  const handleDailyIssuesPicker = async () => {
    if (uploadingDailyIssues) return;

    toast.info(`Select the file from: ${DAILY_ISSUES_EXPORTS_HINT}`);

    const canUseFsApi = typeof window !== "undefined" && typeof window.showOpenFilePicker === "function";
    if (!canUseFsApi) {
      dailyIssuesInputRef.current?.click();
      return;
    }

    try {
      const [fileHandle] = await window.showOpenFilePicker({
        id: "daily-issues-exports-picker",
        startIn: "documents",
        multiple: false,
        types: [
          {
            description: "Excel Files",
            accept: {
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
              "application/vnd.ms-excel": [".xls"],
            },
          },
        ],
      });

      if (!fileHandle) return;
      const file = await fileHandle.getFile();
      await importDailyIssuesFile(file);
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.error("Error opening daily issues picker:", error);
      dailyIssuesInputRef.current?.click();
    }
  };

  const openMarkupPopup = (url, label = "") => {
    const safeUrl = normalizeValue(url);
    if (!safeUrl) return;
    setMarkupPopupSize({ width: 960, height: 640 });
    setMarkupPopup({ url: safeUrl, label: normalizeValue(label) });
  };

  const closeMarkupPopup = () => {
    setMarkupPopup({ url: "", label: "" });
    setMarkupPopupSize({ width: 960, height: 640 });
  };

  const handleMarkupImageLoad = (event) => {
    const naturalWidth = Number(event.currentTarget?.naturalWidth || 0);
    const naturalHeight = Number(event.currentTarget?.naturalHeight || 0);
    if (!naturalWidth || !naturalHeight) return;

    const maxWidth = Math.floor((window.innerWidth || 1366) * 0.96);
    const maxHeight = Math.floor((window.innerHeight || 768) * 0.9) - 56;
    const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight, 1);

    setMarkupPopupSize({
      width: Math.max(360, Math.floor(naturalWidth * scale)),
      height: Math.max(240, Math.floor(naturalHeight * scale)),
    });
  };

  return (
    <div style={commonStyles.fullWidthContainer}>
      <Link to={`/organization/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to My Organization
      </Link>

      <ChurchHeader id={id} applyShadow={false} allowEditBannerLogo={true} />

      <div className="project-issue-wrap">
        <div className="project-issue-head">
          <div className="project-issue-head-top">
            <div className="project-issue-title-group">
              <h1 className="project-issue-title">Project Issue List</h1>
              <div className="project-issue-last-update">
                {lastDailyIssuesUpdate ? `Last Update: ${lastDailyIssuesUpdate}` : "Last Update: --"}
              </div>
              <p className="project-issue-subtitle">
                Tracking live issues from BIM projects.
              </p>
            </div>
            <div className="project-issue-head-actions">
              <input
                ref={dailyIssuesInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="project-issue-upload-input"
                onChange={handleDailyIssuesUpload}
              />
              <div className="project-issue-actions-menu">
                <details className="project-issue-actions-dropdown" ref={actionsMenuRef}>
                  <summary className="project-issue-actions-trigger">Actions</summary>
                  <div className="project-issue-actions-list" role="menu" aria-label="Project issue actions">
                    <button
                      type="button"
                      className="project-issue-actions-item"
                      onClick={async () => {
                        closeActionsMenu();
                        await handleDailyIssuesPicker();
                      }}
                      disabled={uploadingDailyIssues}
                    >
                      {uploadingDailyIssues ? "Uploading Daily Issues List..." : "Upload Daily Issues List"}
                    </button>
                    <Link
                      to={`/organization/${id}/project-issue-dashboard/e2-detailers`}
                      className="project-issue-actions-item"
                      onClick={closeActionsMenu}
                    >
                      Manage E2 fields
                    </Link>
                    <Link
                      to={`/organization/${id}/project-issue-dashboard/tag-aliases`}
                      className="project-issue-actions-item"
                      onClick={closeActionsMenu}
                    >
                      Add Aliases
                    </Link>
                  </div>
                </details>
              </div>
            </div>
          </div>
          <div className="project-issue-charts-window">
            <div className="project-issue-charts-tabs" role="tablist">
              <button
                role="tab"
                aria-selected={chartTab === "overview"}
                className={`project-issue-charts-tab${chartTab === "overview" ? " is-active" : ""}`}
                onClick={() => setChartTab("overview")}
              >
                Overview
              </button>
              <button
                role="tab"
                aria-selected={chartTab === "e2status"}
                className={`project-issue-charts-tab${chartTab === "e2status" ? " is-active" : ""}`}
                onClick={() => setChartTab("e2status")}
              >
                Issues by E2 Status Update
              </button>
              <button
                role="tab"
                aria-selected={chartTab === "trend"}
                className={`project-issue-charts-tab${chartTab === "trend" ? " is-active" : ""}`}
                onClick={() => setChartTab("trend")}
              >
                {trendChartTabTitle}
              </button>
            </div>

            {chartTab === "overview" && (
              <div className="project-issue-summary-chart project-issue-summary-chart--overview" aria-label="Issue summary chart">
                <div className="project-issue-summary-row">
                  <div className="project-issue-summary-meta">
                    <span>
                      Total Number of Issues in <strong>{summaryProjectName}</strong>
                    </span>
                    <strong>{scopedIssueCount}</strong>
                  </div>
                  <div className="project-issue-summary-track">
                    <div
                      className="project-issue-summary-fill"
                      style={overviewTotalBarStyle}
                    />
                  </div>
                </div>

                {activeTab === "All" ? (
                  overviewStatusCounts.length === 0 ? (
                    <div className="project-issue-summary-empty">No data</div>
                  ) : (
                    overviewStatusCounts.map(({ rawStatus, label, count, backgroundColor }) => {
                      const pct = scopedIssueCount ? Math.round((count / scopedIssueCount) * 100) : 0;
                      const barStyle = {
                        width: `${scopedIssueCount ? Math.max((count / scopedIssueCount) * 100, 2) : 0}%`,
                      };
                      if (backgroundColor) {
                        barStyle.background = backgroundColor;
                      }

                      return (
                        <div className="project-issue-summary-row" key={rawStatus}>
                          <div className="project-issue-summary-meta">
                            <span>{label}</span>
                            <span className="project-issue-summary-count-pct">
                              <strong>{count}</strong>
                              <span className="project-issue-summary-pct">{pct}%</span>
                            </span>
                          </div>
                          <button
                            type="button"
                            className="project-issue-summary-track-link"
                            onClick={() => openOverviewPiePopup(rawStatus, label)}
                            title={`View E2 Status Update breakdown for ${label}`}
                          >
                            <div className="project-issue-summary-track">
                              <div className="project-issue-summary-fill" style={barStyle} />
                            </div>
                          </button>
                        </div>
                      );
                    })
                  )
                ) : (
                  <div className="project-issue-summary-row">
                    <div className="project-issue-summary-meta">
                      <span>
                        Number of Issues with status as <strong>{summaryStatusName}</strong>
                      </span>
                      <span className="project-issue-summary-count-pct">
                        <strong>{statusScopedIssueCount}</strong>
                        <span className="project-issue-summary-pct">
                          {scopedIssueCount ? Math.round((statusScopedIssueCount / scopedIssueCount) * 100) : 0}%
                        </span>
                      </span>
                    </div>
                    <button
                      type="button"
                      className="project-issue-summary-track-link"
                      onClick={() => openOverviewPiePopup(summaryStatusName, summaryStatusName)}
                      title={`View E2 Status Update breakdown for ${summaryStatusName}`}
                    >
                      <div className="project-issue-summary-track">
                        <div
                          className="project-issue-summary-fill is-filtered"
                          style={overviewFilteredBarStyle}
                        />
                      </div>
                    </button>
                  </div>
                )}
              </div>
            )}

            {chartTab === "e2status" && (
              <div className="project-issue-summary-chart" aria-label="E2 Status Update summary chart">
                <div className="project-issue-summary-chart-heading">
                  <div className="project-issue-summary-chart-timeframe">{e2StatusUpdateTimeframeLabel}</div>
                </div>
                {e2StatusUpdateCounts.length === 0 ? (
                  <div className="project-issue-summary-empty">No data</div>
                ) : (
                  e2StatusUpdateCounts.map(({ label, count }) => {
                    const pct = scopedIssueCount ? Math.round((count / scopedIssueCount) * 100) : 0;
                    const e2Format = e2StatusUpdateFormatByLowerValue[label.toLowerCase()] || {};
                    const customBgColor = normalizeValue(e2Format.backgroundColor);
                    const barStyle = {
                      width: `${scopedIssueCount ? Math.max((count / scopedIssueCount) * 100, 2) : 0}%`,
                    };
                    if (customBgColor) {
                      barStyle.background = customBgColor;
                    }
                    return (
                      <div key={label} className="project-issue-summary-row">
                        <div className="project-issue-summary-meta">
                          <span>{label}</span>
                          <span className="project-issue-summary-count-pct">
                            <strong>{count}</strong>
                            <span className="project-issue-summary-pct">{pct}%</span>
                          </span>
                        </div>
                        <div className="project-issue-summary-track">
                          <div
                            className="project-issue-summary-fill"
                            style={barStyle}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {chartTab === "trend" && (() => {
              const maxCount = Math.max(...trendChartBuckets.map((b) => b.count), 1);
              return (
                <div className="project-issue-summary-chart project-issue-trend-chart" aria-label="Trending chart">
                  {trendChartBuckets.length === 0 ? (
                    <div className="project-issue-summary-empty">No data for the selected period</div>
                  ) : (
                    <>
                      <div className="project-issue-trend-bars">
                        {trendChartBuckets.map((bucket) => {
                          const heightPct = maxCount ? (bucket.count / maxCount) * 100 : 0;
                          return (
                            <div className="project-issue-trend-col" key={bucket.key}>
                              <span className="project-issue-trend-count">{bucket.count > 0 ? bucket.count : ""}</span>
                              <div className="project-issue-trend-bar-wrap">
                                <div
                                  className="project-issue-trend-bar-fill"
                                  style={{ height: `${Math.max(heightPct, bucket.count > 0 ? 4 : 0)}%` }}
                                />
                              </div>
                              <span className="project-issue-trend-label">{bucket.label}</span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        <div className="project-issue-filters">
          <div className="project-issue-filter">
            <select
              className={`project-issue-filter-trigger ${selectedProjectName ? "is-selected" : ""}`}
              value={selectedProjectName}
              onChange={(event) => setSelectedProjectName(event.target.value)}
              aria-label="Filter Project Name"
            >
              <option value="">Filter Project Name</option>
              {projectNameOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div className="project-issue-filter">
            <select
              className={`project-issue-filter-trigger ${activeTab !== "All" ? "is-selected" : ""}`}
              value={activeTab}
              onChange={(event) => setActiveTab(event.target.value)}
              aria-label="Filter Status"
            >
              {tabs.map((tab) => (
                <option key={tab} value={tab}>
                  {tab === "All" ? "Filter Status" : tab}
                </option>
              ))}
            </select>
          </div>

          <div className="project-issue-filter">
            <select
              className={`project-issue-filter-trigger ${selectedE2Detailer ? "is-selected" : ""}`}
              value={selectedE2Detailer}
              onChange={(event) => setSelectedE2Detailer(event.target.value)}
              aria-label="Filter E2 Detailer"
            >
              <option value="">Filter E2 Detailer</option>
              {e2DetailerOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div className="project-issue-filter">
            <select
              className={`project-issue-filter-trigger ${selectedDateRange !== "All" ? "is-selected" : ""}`}
              value={selectedDateRange}
              onChange={(event) => setSelectedDateRange(event.target.value)}
              aria-label="Filter by Status Update Date"
            >
              <option value="All">All Time</option>
              <option value="YTD">YTD (Year to Date)</option>
              <option value="MTD">MTD (Month to Date)</option>
              <option value="TW">This Week</option>
            </select>
          </div>

          <input
            type="text"
            className="project-issue-global-search"
            placeholder="Search any text, letter, ID, owner, zone..."
            value={globalSearch}
            onChange={(event) => setGlobalSearch(event.target.value)}
          />
        </div>

        <div className="project-issue-table-shell">
          <table className="project-issue-table">
            <thead>
              <tr>
                <th>Issue ID</th>
                <th>Title</th>
                <th>Project Name</th>
                <th>Markup</th>
                <th style={{ width: `${statusColumnWidthCh}ch`, minWidth: `${statusColumnWidthCh}ch` }}>Status</th>
                <th>E2 Status Update</th>
                <th>Priority</th>
                <th>Owner</th>
                <th>Due Date</th>
                <th>Days Since Created</th>
                <th>E2 Detailer</th>
                <th>Technical Details Available</th>
                <th>Status Update Date</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={13} className="project-issue-empty">
                    Loading BIM issues...
                  </td>
                </tr>
              ) : null}
              {visibleIssues.map((issue, index) => {
                const safeStatus = normalizeValue(issue.status) || "Unknown";
                const statusClassName = safeStatus.toLowerCase().replace(/\s+/g, "-");
                const statusFormat = statusFormatByLowerStatus[safeStatus.toLowerCase()] || {};
                const statusDisplayText = getStatusDisplayText(safeStatus);
                const statusStyle = {
                  color: normalizeValue(statusFormat.textColor) || undefined,
                  backgroundColor: normalizeValue(statusFormat.backgroundColor) || undefined,
                };
                const rowKey = issue.key || `${issue.projectDocId || "project"}-${issue.id || "issue"}-${issue.rowIndex ?? index}-${index}`;
                const normalizedTag = normalizeValue(issue.tags).toLowerCase();
                const projectNameDisplay =
                  (normalizedTag && tagAliasByLowerTag[normalizedTag]) || normalizeValue(issue.zoneCategory) || "-";

                return (
                <tr key={rowKey}>
                  <td data-label="Issue ID">
                    <Link
                      to={`/organization/${id}/project-issue-dashboard/issue/${issue.projectDocId}/${encodeURIComponent(issue.id)}`}
                      className="project-issue-id-link"
                    >
                      <span className="project-issue-issue-id">{normalizeIssueIdDisplay(issue.id)}</span>
                    </Link>
                  </td>
                  <td data-label="Title">{issue.title}</td>
                  <td data-label="Project Name">{projectNameDisplay}</td>
                  <td data-label="Markup">
                    {issue.markupLink ? (
                      <button
                        type="button"
                        className="project-issue-markup-thumb-btn"
                        onClick={(event) => {
                          event.preventDefault();
                          openMarkupPopup(issue.markupLink, issue.markup || issue.id);
                        }}
                        title={issue.markup || "Open markup"}
                      >
                        <img
                          src={issue.markupLink}
                          alt={issue.markup || "Markup preview"}
                          className="project-issue-markup-thumb"
                        />
                      </button>
                    ) : (
                      issue.markup || "-"
                    )}
                  </td>
                  <td
                    data-label="Status"
                    style={{ width: `${statusColumnWidthCh}ch`, minWidth: `${statusColumnWidthCh}ch` }}
                  >
                    <span className={`issue-status issue-status-${statusClassName}`} style={statusStyle}>
                      {statusDisplayText}
                    </span>
                  </td>
                  <td data-label="E2 Status Update">
                    {(() => {
                      const selectedE2Value = getDefaultE2StatusUpdate(issue.e2StatusUpdate);
                      const e2Format = e2StatusUpdateFormatByLowerValue[
                        normalizeValue(selectedE2Value).toLowerCase()
                      ] || {};
                      const e2ShellStyle = {
                        color: normalizeValue(e2Format.textColor) || undefined,
                        backgroundColor: normalizeValue(e2Format.backgroundColor) || undefined,
                      };
                      return (
                        <div className="project-issue-cell-select-shell" style={e2ShellStyle}>
                          <select
                            className="project-issue-cell-input project-issue-cell-input--bare"
                            value={selectedE2Value}
                            onChange={(event) => {
                              const nextValue = getDefaultE2StatusUpdate(event.target.value);
                              handleE2StatusUpdateChange(issue.key, nextValue);
                              handleE2StatusUpdateSave({ ...issue, e2StatusUpdate: nextValue }, nextValue);
                            }}
                            disabled={!!savingIssueKeys[`e2status:${issue.key}`]}
                          >
                            {e2StatusUpdateOptions.map((opt) => {
                              const optionFormat =
                                e2StatusUpdateFormatByLowerValue[normalizeValue(opt).toLowerCase()] || {};
                              const optionStyle = {
                                color: normalizeValue(optionFormat.textColor) || undefined,
                                backgroundColor: normalizeValue(optionFormat.backgroundColor) || undefined,
                              };
                              return (
                                <option key={opt} value={opt} style={optionStyle}>
                                  {opt}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                      );
                    })()}
                  </td>
                  <td data-label="Priority">{issue.priority}</td>
                  <td data-label="Owner">{issue.owner}</td>
                  <td data-label="Due Date">{formatDueDateMMDDYY(issue.dueDate)}</td>
                  <td data-label="Days Since Created">{calculateDaysSinceCreated(issue.createdAt)}</td>
                  <td data-label="E2 Detailer">
                    <select
                      className="project-issue-cell-input"
                      value={issue.e2Detailer}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        handleE2DetailerChange(issue.key, nextValue);
                        handleE2DetailerSave({ ...issue, e2Detailer: nextValue }, nextValue);
                      }}
                      disabled={!!savingIssueKeys[issue.key]}
                    >
                      <option value="">Select E2 Detailer</option>
                      {e2DetailerOptions.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td data-label="Technical Details Available">
                    <select
                      className="project-issue-cell-input"
                      value={issue.techDetailsAvailable}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        handleTechDetailsChange(issue.key, nextValue);
                        handleTechDetailsSave({ ...issue, techDetailsAvailable: nextValue }, nextValue);
                      }}
                      disabled={!!savingIssueKeys[`techdetails:${issue.key}`]}
                    >
                      <option value="">Select...</option>
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                    </select>
                  </td>
                  <td data-label="Status Update Date">
                    <input
                      type="text"
                      className="project-issue-cell-input"
                      placeholder="MM/DD/YY"
                      value={getDefaultE2StatusDate(issue.e2StatusDate)}
                      onChange={(event) => handleE2StatusDateChange(issue.key, event.target.value)}
                      onBlur={(event) =>
                        handleE2StatusDateSave(
                          { ...issue, e2StatusDate: getDefaultE2StatusDate(event.target.value) },
                          event.target.value
                        )
                      }
                      disabled={!!savingIssueKeys[`e2date:${issue.key}`]}
                    />
                  </td>
                </tr>
              );
              })}
              {!loading && !visibleIssues.length ? (
                <tr>
                  <td colSpan={13} className="project-issue-empty">
                    No issues in this tab.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {lightboxUrl ? (
        <div
          className="project-issue-lightbox-overlay"
          onClick={() => setLightboxUrl("")}
          role="dialog"
          aria-modal="true"
          aria-label="Snapshot preview"
        >
          <button
            type="button"
            className="project-issue-lightbox-close"
            onClick={() => setLightboxUrl("")}
            aria-label="Close"
          >
            ✕
          </button>
          <img
            src={lightboxUrl}
            alt="Issue snapshot fullsize"
            className="project-issue-lightbox-img"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      ) : null}

      {markupPopup.url ? (
        <div className="project-issue-popup-overlay" role="dialog" aria-modal="true" aria-label="Markup link popup">
          <div
            className="project-issue-popup-window"
            style={{
              width: `${markupPopupSize.width}px`,
              height: `${markupPopupSize.height + 56}px`,
            }}
          >
            <div className="project-issue-popup-head">
              <strong className="project-issue-popup-title">{markupPopup.label || "Markup"}</strong>
              <button type="button" className="project-issue-popup-close" onClick={closeMarkupPopup}>
                Close
              </button>
            </div>
            <img
              src={markupPopup.url}
              alt={markupPopup.label || "Markup"}
              className="project-issue-popup-image"
              onLoad={handleMarkupImageLoad}
            />
          </div>
        </div>
      ) : null}

      {overviewPiePopup.segments.length ? (
        <div
          className="project-issue-popup-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Overview status E2 breakdown"
          onClick={closeOverviewPiePopup}
        >
          <div className="project-issue-overview-pie-window" onClick={(event) => event.stopPropagation()}>
            <div className="project-issue-overview-pie-head">
              <strong className="project-issue-popup-title">{overviewPiePopup.statusLabel} - E2 Status Update Breakdown</strong>
              <button type="button" className="project-issue-popup-close" onClick={closeOverviewPiePopup}>
                Close
              </button>
            </div>
            <div className="project-issue-overview-pie-body">
              <div className="project-issue-overview-pie-chart" style={overviewPieStyle} />
              <div className="project-issue-overview-pie-legend">
                {overviewPiePopup.segments.map((segment, index) => {
                  const pct = overviewPieTotal ? Math.round((segment.count / overviewPieTotal) * 100) : segment.pct;
                  return (
                    <div className="project-issue-overview-pie-legend-item" key={`${overviewPiePopup.statusKey}-${segment.label}`}>
                      <span
                        className="project-issue-overview-pie-dot"
                        style={{ background: getOverviewSegmentColor(segment, index) }}
                      />
                      <span className="project-issue-overview-pie-label">{segment.label}</span>
                      <span className="project-issue-overview-pie-metrics">{segment.count} ({pct}%)</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default ProjectIssueDashboard;
