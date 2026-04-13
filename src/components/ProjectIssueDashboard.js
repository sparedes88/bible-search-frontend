// Handler for Send to Agile Dashboard button is now inside the component
const E2_TD_FIELD = "E2 TD";
const E2_TD_FIELD_ALIASES = ["e2 td", "e2td", "e2 technical direction", "e2technicaldirection"];
const E2_TD_OPTIONS = ["--", "Stop and Start", "Add to Queue", "Steer with current task"];
const TECHNICAL_DIRECTION_FIELD = "Technical Direction";
const TECHNICAL_DIRECTION_FIELD_ALIASES = ["technical direction", "technicaldirection"];
import React, { useEffect, useMemo, useRef, useState } from "react";
import UsersDropdown from "./UsersDropdown";
import { Link, useParams, useSearchParams } from "react-router-dom";
import * as XLSX from "xlsx";
import { collection, doc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { toast } from "react-toastify";
import { FaInfoCircle, FaCog, FaEdit } from "react-icons/fa";
import { FaShareSquare } from "react-icons/fa";
import commonStyles from "../pages/commonStyles";
import ChurchHeader from "./ChurchHeader";
import { db, storage } from "../firebase";
import {
  DEFAULT_E2_DETAILER_OPTIONS,
  DEFAULT_E2_STATUS_UPDATE,
  DEFAULT_E2_STATUS_UPDATE_OPTIONS,
  E2_DETAILER_OPTIONS_FIELD,
  E2_STATUS_UPDATE_DEFINITIONS_FIELD,
  E2_STATUS_UPDATE_FORMATS_FIELD,
  E2_STATUS_UPDATE_OPTIONS_FIELD,
  PROJECT_ISSUE_CONFIG_DOC_ID,
  PROJECT_NAME_FORMATS_FIELD,
  STATUS_FORMATS_FIELD,
  TAG_ALIASES_FIELD,
} from "./projectIssueConstants";
import "./ProjectIssueDashboard.css";

const E2_DETAILER_FIELD = "E2 Lead Detailer";
const E2_DETAILER_SUPPORT_TEAM_FIELD = "E2 Detailer Support Team";
const ISSUE_ID_FIELD_ALIASES = ["issue id", "id", "task id", "card id", "row id"];
const TITLE_FIELD_ALIASES = ["title", "task title", "name"];
const PROJECT_NAME_FIELD_ALIASES = ["project name", "projectname"];
const OWNER_FIELD_ALIASES = ["assignee", "assigned to", "owner", "responsible"];
const E2_STATUS_UPDATE_FIELD_ALIASES = ["e2 status update", "e2statusupdate"];
const TAG_FIELD_ALIASES = ["tags", "tag", "labels", "label"];
const E2_TAGS_FIELD_ALIASES = ["e2 tags", "e2 tag", "e2tags", "e2tag"];

const E2_STATUS_UPDATE_FIELD = "E2 Status Update";

const E2_STATUS_DATE_FIELD = "E2 Status Date";
const E2_STATUS_DATE_FIELD_ALIASES = [
  "e2 status date",
  "e2statusdate",
  "status update date",
  "statusupdatedate",
  "status date",
  "statusdate",
];
const TECH_DETAILS_FIELD = "Technical Details Available";
const TECH_DETAILS_DISPLAY_LABEL = "T.D. Available";
const TECH_DETAILS_REQUIRED_E2_STATUS_PREFIXES = ["Stop and Start", "Steer with current task", "Add to Queue"];
const PIE_FALLBACK_COLORS = ["#0ea5e9", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#14b8a6", "#f97316"];

const SNAPSHOT_FIELD = "Snapshot URL";
const DAILY_ISSUES_TARGET_PROJECT_ID = "stanford-ff-rad";
const DAILY_ISSUES_TARGET_PROJECT_NAME = "STANFORD -  FF / RAD";
const DAILY_ISSUES_SHEET_NAME = "Issues with one last comment";
const DAILY_ISSUES_EXPORTS_HINT = "C:/Users/BenSolorzano/OneDrive - E2 Tech Support/E2 Tech Team - VDC Project - Equipo Operativo/Exports";

const E2_STATUS_UPDATE_INFO_BY_KEY = {
  received: "Issue has been received and logged by the E2 team.",
  "stop and send": "Pause current work and send the issue to the next workflow step.",
  "send to queue": "Issue is ready and waiting in queue for assignment or execution.",
  "steer with message": "Issue is redirected with written context/instructions for follow-up.",
  "in progress": "Issue is actively being worked on.",
  completed: "Issue is finished and no further action is currently required.",
  "steer to technical details": "Issue requires Technical Details workflow before continuing.",
};

const getTodayMMDDYY = () => {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${mm}/${dd}/${yy} ${hh}:${min}:${ss}`;
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

const getDefaultE2StatusDate = (value) => {
  const normalized = normalizeValue(value);
  return normalized === "-" ? "" : normalized;
};

const hasMeaningfulStatusUpdateDate = (value) => Boolean(parseStatusUpdateDate(value));

const isReceivedStatusUpdate = (value) =>
  normalizeValue(value).toLowerCase() === DEFAULT_E2_STATUS_UPDATE.toLowerCase();

const resolveStatusDateForStatusTransition = (nextStatusValue, previousStatusValue, existingDateValue) => {
  const nextStatus = normalizeValue(nextStatusValue);
  const previousStatus = normalizeValue(previousStatusValue);
  const existing = getDefaultE2StatusDate(existingDateValue);

  if (nextStatus === previousStatus) {
    return existing;
  }

  if (isReceivedStatusUpdate(nextStatus)) {
    return existing || getTodayMMDDYY();
  }

  return getTodayMMDDYY();
};

const getDefaultTechDetailsAvailable = (value) => normalizeValue(value) || "No";

const parseSupportTeamValues = (value) => {
  const rawValues = Array.isArray(value) ? value : String(value || "").split(",");
  const normalized = rawValues
    .map((item) => normalizeValue(item))
    .filter(Boolean)
    .filter((item, index, array) => array.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index);
  return normalized;
};

const formatSupportTeamValue = (value) => parseSupportTeamValues(value).join(", ");

const sanitizeSupportTeamValues = (value, allowedOptions = []) => {
  const allowedSet = new Set(
    (Array.isArray(allowedOptions) ? allowedOptions : [])
      .map((item) => normalizeValue(item).toLowerCase())
      .filter(Boolean)
  );

  if (!allowedSet.size) return [];

  return parseSupportTeamValues(value).filter(
    (item) => allowedSet.has(item.toLowerCase())
  );
};

const isDetailerInSupportTeam = (detailerValue, supportTeamValue) => {
  const normalizedDetailer = normalizeValue(detailerValue).toLowerCase();
  if (!normalizedDetailer) return false;

  return parseSupportTeamValues(supportTeamValue).some(
    (value) => value.toLowerCase() === normalizedDetailer
  );
};

const buildDetailerSupportTeamConflictMessage = (detailerValue) => {
  const safeName = normalizeValue(detailerValue) || "this user";
  return `${safeName} is already in E2 Detailer Support Team. Remove this value from E2 Detailer Support Team first to assign it in E2 Lead Detailer.`;
};

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

const parseStatusFilterParam = (value) => {
  const seen = new Set();
  return normalizeValue(value)
    .split(",")
    .map((item) => normalizeValue(item))
    .filter((item) => item && item.toLowerCase() !== "all")
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const serializeStatusFilterParam = (values = []) => parseStatusFilterParam(values.join(",")).join(",");

const normalizeFieldKey = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const parseTagValues = (value) => {
  const seen = new Set();
  return normalizeValue(value)
    .split(/[,;|]/)
    .map((item) => normalizeValue(item))
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

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


// Patch: Use Tag Alias for Project Name display if available
const getCardPreview = (rowData = {}, fields = [], managedTagAliases = {}) => {
  const titleField = findFieldByAliases(fields, rowData, ["title", "task title", "name"]);
  const projectNameField = findFieldByAliases(fields, rowData, PROJECT_NAME_FIELD_ALIASES);
  const tagsField = findFieldByAliases(fields, rowData, TAG_FIELD_ALIASES);
  const e2TagsField = findFieldByAliases(fields, rowData, E2_TAGS_FIELD_ALIASES);
  const markupField = findFieldByAliases(fields, rowData, ["markup", "mark up"]);
  const markupLinkField = findFieldByAliases(fields, rowData, ["link to markup", "markup link"]);
  const statusField = findFieldByAliases(fields, rowData, ["status", "state", "task status"]);
  // const priorityField = findFieldByAliases(fields, rowData, ["priority"]);
  const gridField = findFieldByAliases(fields, rowData, ["grid", "grid coordinate", "gridlocation"]);
  const levelField = findFieldByAliases(fields, rowData, ["level", "floor", "story"]);
  const roomField = findFieldByAliases(fields, rowData, ["room", "room number", "space"]);
  const zoneField = findFieldByAliases(fields, rowData, ["zone", "area", "section", "location zone"]);
  const assigneeField = findFieldByAliases(fields, rowData, ["assignee", "assigned to", "owner", "responsible"]);
  const e2DetailerField = findFieldByAliases(
    fields,
    rowData,
    ["e2 lead detailer", "e2leaddetailer", "e2 detailer", "e2detailer"]
  );
  const e2DetailerSupportTeamField = findFieldByAliases(
    fields,
    rowData,
    ["e2 detailer support team", "e2 detailer support", "e2 support team", "support team"]
  );
  const e2StatusUpdateField = findFieldByAliases(fields, rowData, ["e2 status update", "e2statusupdate"]);
  const e2StatusDateField = findFieldByAliases(fields, rowData, E2_STATUS_DATE_FIELD_ALIASES);
  const techDetailsField = findFieldByAliases(fields, rowData, ["technical details available", "technical details", "techdetailsavailable"]);
  const snapshotField = findFieldByAliases(fields, rowData, ["snapshot url", "snapshoturl", "snapshot", "picture", "photo", "image"]);
  const linkField = findFieldByAliases(fields, rowData, ["link", "url", "issue url", "card url", "task url", "issue link", "card link"]);
  const deadlineField = findFieldByAliases(fields, rowData, ["deadline", "due date", "due", "target date"]);
  const technicalDirectionField = findFieldByAliases(fields, rowData, TECHNICAL_DIRECTION_FIELD_ALIASES);
  const e2TDField = findFieldByAliases(fields, rowData, E2_TD_FIELD_ALIASES);
  const disableFlagField = findFieldByAliases(fields, rowData, ["disable flag", "disableflag"]);
  const idField = findFieldByAliases(fields, rowData, ["id", "task id", "card id", "row id"]);

  // Determine Project Name for display: prefer Tag Alias if available
  let displayProjectName = normalizeValue(projectNameField ? rowData?.[projectNameField] : "");
  const tagValue = tagsField ? normalizeValue(rowData?.[tagsField]) : "";
  if (tagValue && managedTagAliases && managedTagAliases[tagValue.toLowerCase()]) {
    displayProjectName = normalizeValue(managedTagAliases[tagValue.toLowerCase()]);
  }

  return {
    title: normalizeValue(titleField ? rowData?.[titleField] : ""),
    projectName: displayProjectName,
    tags: normalizeValue(tagsField ? rowData?.[tagsField] : ""),
    e2Tags: normalizeValue(e2TagsField ? rowData?.[e2TagsField] : ""),
    markup: normalizeValue(markupField ? rowData?.[markupField] : ""),
    markupLink: normalizeValue(markupLinkField ? rowData?.[markupLinkField] : ""),
    status: normalizeValue(statusField ? rowData?.[statusField] : ""),
    // priority: normalizeValue(priorityField ? rowData?.[priorityField] : ""),
    grid: normalizeValue(gridField ? rowData?.[gridField] : ""),
    disableFlag: normalizeValue(disableFlagField ? rowData?.[disableFlagField] : "No"),
    technicalDirection: normalizeValue(technicalDirectionField ? rowData?.[technicalDirectionField] : ""),
    e2TD: normalizeValue(e2TDField ? rowData?.[e2TDField] : ""),
    level: normalizeValue(levelField ? rowData?.[levelField] : ""),
    room: normalizeValue(roomField ? rowData?.[roomField] : ""),
    zone: normalizeValue(zoneField ? rowData?.[zoneField] : ""),
    assignee: normalizeValue(assigneeField ? rowData?.[assigneeField] : ""),
    e2Detailer: normalizeValue(e2DetailerField ? rowData?.[e2DetailerField] : ""),
    e2DetailerSupportTeam: formatSupportTeamValue(
      e2DetailerSupportTeamField ? rowData?.[e2DetailerSupportTeamField] : ""
    ),
    e2StatusUpdate: getDefaultE2StatusUpdate(e2StatusUpdateField ? rowData?.[e2StatusUpdateField] : ""),
    e2StatusDate: getDefaultE2StatusDate(e2StatusDateField ? rowData?.[e2StatusDateField] : ""),
    techDetailsAvailable: getDefaultTechDetailsAvailable(techDetailsField ? rowData?.[techDetailsField] : ""),
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
      // Removed stray disableFlag lines causing syntax error
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

const buildNextTDIssueId = (issueIds = []) => {
  const highestSequence = issueIds.reduce((highest, value) => {
    const raw = String(value || "").trim().replace(/\s+/g, "");
    const match = raw.match(/^TD[-_]?(\d+)$/i);
    if (!match) return highest;
    const numericValue = parseInt(match[1], 10);
    return Number.isFinite(numericValue) ? Math.max(highest, numericValue) : highest;
  }, 0);

  const nextSequence = highestSequence + 1;
  const width = Math.max(4, String(nextSequence).length);
  return `TD-${String(nextSequence).padStart(width, "0")}`;
};

const ProjectIssueDashboard = () => {
    // Handler for Send to Agile Dashboard button (must be in scope for JSX)
    async function handleSendToAgileDashboard(issue) {
      if (!issue?.key) return;
      try {
        // Set E2 Status Update to "In Progress", E2 Status Update Agile to "To Do List", and Disable Flag to "Yes"
        const projectSource = projectSources[issue.projectDocId];
        if (!projectSource) return;
        const previousRows = Array.isArray(projectSource.rows) ? projectSource.rows : [];
        const previousFields = Array.isArray(projectSource.fields) ? projectSource.fields : [];
        const targetRow = previousRows[issue.rowIndex];
        if (!targetRow) return;
        const previousRowData = targetRow?.rowData || {};
        const e2StatusFieldName = findFieldByAliases(previousFields, previousRowData, ["e2 status update", "e2statusupdate"]) || E2_STATUS_UPDATE_FIELD;
        const e2StatusAgileFieldName = findFieldByAliases(previousFields, previousRowData, ["e2 status update agile", "e2statusupdateagile"]) || "E2 Status Update Agile";
        const disableFlagFieldName = findFieldByAliases(previousFields, previousRowData, ["disable flag", "disableflag"]) || "Disable Flag";
        const updatedRowData = {
          ...previousRowData,
          [e2StatusFieldName]: "In Progress",
          [e2StatusAgileFieldName]: "To Do List",
          [disableFlagFieldName]: "Yes",
        };
        const updatedRows = previousRows.map((row, idx) =>
          idx === issue.rowIndex ? { ...row, rowData: updatedRowData } : row
        );
        let updatedFields = previousFields;
        if (!updatedFields.includes(e2StatusFieldName)) updatedFields = [...updatedFields, e2StatusFieldName];
        if (!updatedFields.includes(e2StatusAgileFieldName)) updatedFields = [...updatedFields, e2StatusAgileFieldName];
        if (!updatedFields.includes(disableFlagFieldName)) updatedFields = [...updatedFields, disableFlagFieldName];
        await updateDoc(doc(db, "churches", id, "bimProjects", issue.projectDocId), {
          fields: updatedFields,
          rows: updatedRows,
          updatedAt: new Date(),
        });
        if (typeof fetchAndSyncAllIssues === "function") {
          await fetchAndSyncAllIssues();
        }
        toast.success("Sent to Agile Dashboard and updated fields.");
      } catch (err) {
        console.error("Error sending to Agile Dashboard:", err);
        toast.error("Failed to send to Agile Dashboard.");
      }
    }
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const filterVisibilityStorageKey = `project-issue-filter-visibility-${id || "default"}`;

  const [activeTab, setActiveTab] = useState(() =>
    serializeStatusFilterParam(parseStatusFilterParam(searchParams.get("status")))
  );
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProjectName, setSelectedProjectName] = useState(() => searchParams.get("projectName") || "");
  const [selectedIssueId, setSelectedIssueId] = useState(() => searchParams.get("issueId") || "");
  const [selectedE2Detailer, setSelectedE2Detailer] = useState(() => searchParams.get("e2Detailer") || "");
  const [selectedE2StatusUpdate, setSelectedE2StatusUpdate] = useState(() => searchParams.get("e2StatusUpdate") || "");
  const [selectedTechDetails, setSelectedTechDetails] = useState(() => searchParams.get("techDetails") || "");
  const [selectedE2Tags, setSelectedE2Tags] = useState(() => parseTagValues(searchParams.get("e2Tags") || ""));
  const [globalSearch, setGlobalSearch] = useState(() => searchParams.get("search") || "");
  const [selectedDateRange, setSelectedDateRange] = useState(() => searchParams.get("dateRange") || "All");
  const [chartTab, setChartTab] = useState("overview");
  const [filterVisibility, setFilterVisibility] = useState(() => {
    const defaults = {
      projectName: true,
      issueId: true,
      status: true,
      e2LeadDetailer: true,
      e2StatusUpdate: true,
      techDetails: true,
      e2Tags: true,
      statusUpdateDate: true,
      globalSearch: true,
    };
    try {
      const stored = localStorage.getItem(filterVisibilityStorageKey);
      if (!stored) return defaults;
      const parsed = JSON.parse(stored);
      return { ...defaults, ...parsed };
    } catch {
      return defaults;
    }
  });

  // Keep URL in sync with filter state
  useEffect(() => {
    const params = {};
    if (activeTab) params.status = activeTab;
    if (selectedProjectName) params.projectName = selectedProjectName;
    if (selectedIssueId) params.issueId = selectedIssueId;
    if (selectedE2Detailer) params.e2Detailer = selectedE2Detailer;
    if (selectedE2StatusUpdate) params.e2StatusUpdate = selectedE2StatusUpdate;
    if (selectedTechDetails) params.techDetails = selectedTechDetails;
    if (selectedE2Tags.length) params.e2Tags = selectedE2Tags.join(",");
    if (globalSearch) params.search = globalSearch;
    if (selectedDateRange !== "All") params.dateRange = selectedDateRange;
    setSearchParams(params, { replace: true });
  }, [activeTab, selectedProjectName, selectedIssueId, selectedE2Detailer, selectedE2StatusUpdate, selectedTechDetails, selectedE2Tags, globalSearch, selectedDateRange, setSearchParams]);

  useEffect(() => {
    try {
      localStorage.setItem(filterVisibilityStorageKey, JSON.stringify(filterVisibility));
    } catch {}
  }, [filterVisibility, filterVisibilityStorageKey]);

  const resetFilterValueByKey = (key) => {
    if (key === "projectName") {
      setSelectedProjectName("");
      return;
    }
    if (key === "issueId") {
      setSelectedIssueId("");
      return;
    }
    if (key === "status") {
      setActiveTab("");
      return;
    }
    if (key === "e2LeadDetailer") {
      setSelectedE2Detailer("");
      return;
    }
    if (key === "e2StatusUpdate") {
      setSelectedE2StatusUpdate("");
      return;
    }
    if (key === "techDetails") {
      setSelectedTechDetails("");
      return;
    }
    if (key === "e2Tags") {
      setSelectedE2Tags([]);
      return;
    }
    if (key === "statusUpdateDate") {
      setSelectedDateRange("All");
      return;
    }
    if (key === "globalSearch") {
      setGlobalSearch("");
    }
  };

  const toggleFilterVisibility = (key) => {
    setFilterVisibility((prev) => {
      const nextVisible = !prev[key];
      if (!nextVisible) {
        resetFilterValueByKey(key);
      }
      return { ...prev, [key]: nextVisible };
    });
  };

  const setAllFiltersVisibility = (nextVisible) => {
    if (!nextVisible) {
      setSelectedProjectName("");
      setSelectedIssueId("");
      setActiveTab("");
      setSelectedE2Detailer("");
      setSelectedE2StatusUpdate("");
      setSelectedTechDetails("");
      setSelectedE2Tags([]);
      setSelectedDateRange("All");
      setGlobalSearch("");
    }
    setFilterVisibility({
      projectName: nextVisible,
      issueId: nextVisible,
      status: nextVisible,
      e2LeadDetailer: nextVisible,
      e2StatusUpdate: nextVisible,
      techDetails: nextVisible,
      e2Tags: nextVisible,
      statusUpdateDate: nextVisible,
      globalSearch: nextVisible,
    });
  };

  const visibleFilterCount = Object.values(filterVisibility).filter(Boolean).length;
  const [projectSources, setProjectSources] = useState({});
  const [savingIssueKeys, setSavingIssueKeys] = useState({});
  const [uploadingSnapshotKeys, setUploadingSnapshotKeys] = useState({});
  const [lightboxUrl, setLightboxUrl] = useState("");
  const [markupPopup, setMarkupPopup] = useState({ url: "", label: "", issueId: "", issueKey: "" });
  const [markupPopupSize, setMarkupPopupSize] = useState({ width: 960, height: 640 });
  const [markupTagInput, setMarkupTagInput] = useState("");
  const [markupTagValues, setMarkupTagValues] = useState([]);
  const [savingMarkupTags, setSavingMarkupTags] = useState(false);
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
  const [managedProjectNameFormats, setManagedProjectNameFormats] = useState({});
  const [openSupportTeamMenuKey, setOpenSupportTeamMenuKey] = useState("");
  const [techDetailsPopup, setTechDetailsPopup] = useState({
    open: false,
    issueKey: "",
    e2StatusUpdate: "",
    e2Detailer: "",
    e2DetailerSupportTeam: [],
    technicalDirection: "",
    e2Comments: "",
    e2Documents: [],
  });
  const [submittingTechDetailsPopup, setSubmittingTechDetailsPopup] = useState(false);
  const [techDetailsPopupUploadingDocuments, setTechDetailsPopupUploadingDocuments] = useState(false);
  const [techDetailsPopupSavingComments, setTechDetailsPopupSavingComments] = useState(false);
  const techDetailsPopupFileInputRef = useRef(null);
  const [popupSupportTeamMenuOpen, setPopupSupportTeamMenuOpen] = useState(false);
  const [detailerConflictPopupMessage, setDetailerConflictPopupMessage] = useState("");
  const [showE2StatusInfoPopup, setShowE2StatusInfoPopup] = useState(false);
  const [managedE2StatusDefinitions, setManagedE2StatusDefinitions] = useState({});
  const [e2InfoEditMode, setE2InfoEditMode] = useState(false);
  const [e2InfoDrafts, setE2InfoDrafts] = useState({});
  const [savingE2InfoDefinitions, setSavingE2InfoDefinitions] = useState(false);
  const [showAddIssuePopup, setShowAddIssuePopup] = useState(false);
  const [newIssueFormData, setNewIssueFormData] = useState({});
  const [savingNewIssue, setSavingNewIssue] = useState(false);
  const [showReceivedReporting, setShowReceivedReporting] = useState(false);
  const [editingReceivedTagsKeys, setEditingReceivedTagsKeys] = useState(new Set());
  const [receivedTagsDrafts, setReceivedTagsDrafts] = useState({});
  const [savingReceivedTagsKeys, setSavingReceivedTagsKeys] = useState({});
  const [selectedE2StatusChartTarget, setSelectedE2StatusChartTarget] = useState("");
  const [pendingTechDetailsIssueKey, setPendingTechDetailsIssueKey] = useState("");
  const [showColumnVisibilityPopup, setShowColumnVisibilityPopup] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(() => {
    const stored = localStorage.getItem("projectIssueGridVisibleColumns");
    if (stored) {
      try {
        return new Set(JSON.parse(stored));
      } catch (e) {
        // Ignore parsing errors
      }
    }
    // Default visible columns
    return new Set(["Issue ID", "Title", "Project Name", "Markup", "E2 Tags", "Status", "E2 Status Update", "Technical Direction", "Due Date", "Disable Flag", TECH_DETAILS_DISPLAY_LABEL]);
  });
  const techDetailsFieldRefs = useRef({});
  const dailyIssuesInputRef = useRef(null);
  const actionsMenuRef = useRef(null);
  const manageFiltersRef = useRef(null);
  const statusFilterRef = useRef(null);

  const selectedStatuses = useMemo(() => parseStatusFilterParam(activeTab), [activeTab]);
  const hasStatusFilter = selectedStatuses.length > 0;
  const selectedStatusSet = useMemo(
    () => new Set(selectedStatuses.map((status) => normalizeValue(status).toLowerCase())),
    [selectedStatuses]
  );
  const hasE2TagFilter = selectedE2Tags.length > 0;
  const selectedE2TagSet = useMemo(
    () => new Set(selectedE2Tags.map((tag) => normalizeValue(tag).toLowerCase())),
    [selectedE2Tags]
  );

  const openDetailerConflictPopup = (detailerValue) => {
    setDetailerConflictPopupMessage(buildDetailerSupportTeamConflictMessage(detailerValue));
  };

  const closeStatusFilter = () => {
    if (statusFilterRef.current?.open) {
      statusFilterRef.current.open = false;
    }
  };

  const toggleStatusSelection = (statusValue) => {
    const normalizedStatus = normalizeValue(statusValue);
    if (!normalizedStatus) return;

    setActiveTab((previous) => {
      const previousValues = parseStatusFilterParam(previous);
      const exists = previousValues.some((value) => value.toLowerCase() === normalizedStatus.toLowerCase());
      const nextValues = exists
        ? previousValues.filter((value) => value.toLowerCase() !== normalizedStatus.toLowerCase())
        : [...previousValues, normalizedStatus];
      return serializeStatusFilterParam(nextValues);
    });
  };

  const handleOpenE2InfoEdit = () => {
    const drafts = {};
    e2StatusUpdateInfoItems.forEach((item) => {
      drafts[item.value.toLowerCase()] = item.description;
    });
    setE2InfoDrafts(drafts);
    setE2InfoEditMode(true);
  };

  const handleCancelE2InfoEdit = () => {
    setE2InfoEditMode(false);
    setE2InfoDrafts({});
  };

  const handleSaveE2StatusDefinitions = async () => {
    setSavingE2InfoDefinitions(true);
    try {
      const configRef = doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID);
      await setDoc(configRef, { [E2_STATUS_UPDATE_DEFINITIONS_FIELD]: e2InfoDrafts }, { merge: true });
      setE2InfoEditMode(false);
      setE2InfoDrafts({});
    } catch (err) {
      console.error("Failed to save E2 status definitions:", err);
    } finally {
      setSavingE2InfoDefinitions(false);
    }
  };

  const closeActionsMenu = () => {
    if (actionsMenuRef.current?.open) {
      actionsMenuRef.current.open = false;
    }
  };

  const AVAILABLE_COLUMNS = [
    "Issue ID",
    "Title",
    "Project Name",
    "Markup",
    "E2 Tags",
    "Status",
    "E2 Status Update",
    "Technical Direction",
    "E2 TD",
    "Due Date",
    "Disable Flag",
    "Days Since Created",
    "E2 Lead Detailer",
    "E2 Detailer Support Team",
    TECH_DETAILS_DISPLAY_LABEL,
    "Status Update Date",
  ];

  const toggleColumnVisibility = (columnName) => {
    const newVisibleColumns = new Set(visibleColumns);
    if (newVisibleColumns.has(columnName)) {
      newVisibleColumns.delete(columnName);
    } else {
      newVisibleColumns.add(columnName);
    }
    setVisibleColumns(newVisibleColumns);
    localStorage.setItem("projectIssueGridVisibleColumns", JSON.stringify(Array.from(newVisibleColumns)));
  };

  const closeManageFilters = () => {
    if (manageFiltersRef.current?.open) {
      manageFiltersRef.current.open = false;
    }
  };

  const dailyIssuesProjectSource = projectSources[DAILY_ISSUES_TARGET_PROJECT_ID] || null;

  const newIssueFieldConfig = useMemo(() => {
    const sourceFields = Array.isArray(dailyIssuesProjectSource?.fields)
                  ? dailyIssuesProjectSource.fields
                    .map((field) => normalizeValue(field))
                    .filter(Boolean)
      : [];
    const issueIdField = findFieldByAliases(sourceFields, {}, ISSUE_ID_FIELD_ALIASES) || "Issue ID";
    const titleField = findFieldByAliases(sourceFields, {}, TITLE_FIELD_ALIASES) || "Title";
    const projectNameField = findFieldByAliases(sourceFields, {}, PROJECT_NAME_FIELD_ALIASES) || "Project Name";
    const ownerField = findFieldByAliases(sourceFields, {}, OWNER_FIELD_ALIASES) || "Owner";
    const e2StatusUpdateField = findFieldByAliases(sourceFields, {}, E2_STATUS_UPDATE_FIELD_ALIASES) || E2_STATUS_UPDATE_FIELD;
    const e2StatusDateField = findFieldByAliases(sourceFields, {}, E2_STATUS_DATE_FIELD_ALIASES) || E2_STATUS_DATE_FIELD;
    const techDetailsField =
      findFieldByAliases(sourceFields, {}, ["technical details available", "technical details", "techdetailsavailable"]) ||
      TECH_DETAILS_FIELD;
    const orderedFields = [];
    const seen = new Set();
    [
      issueIdField,
      titleField,
      projectNameField,
      ownerField,
      e2StatusUpdateField,
      e2StatusDateField,
      techDetailsField,
      ...sourceFields,
    ].forEach((field) => {
      const normalizedField = normalizeValue(field);
      const key = normalizedField.toLowerCase();
      if (!normalizedField || seen.has(key)) return;
      seen.add(key);
      orderedFields.push(normalizedField);
    });

    return {
      fields: orderedFields,
      fieldNames: {
        issueId: issueIdField,
        title: titleField,
        projectName: projectNameField,
        owner: ownerField,
        e2StatusUpdate: e2StatusUpdateField,
        e2StatusDate: e2StatusDateField,
        techDetails: techDetailsField,
      },
    };
  }, [dailyIssuesProjectSource]);


  // Helper to get Tag Alias value for a given tag
  const getTagAliasForNewIssue = (formData) => {
    // Try to find a tag field in the form data
    const tagField = findFieldByAliases(newIssueFieldConfig.fields, formData, TAG_FIELD_ALIASES);
    const tagValue = tagField ? normalizeValue(formData?.[tagField]) : "";
    if (!tagValue) return "";
    const alias = managedTagAliases[tagValue.toLowerCase()];
    return alias ? normalizeValue(alias) : "";
  };

  const buildNewIssueFormData = () => {
    const generatedIssueId = buildNextTDIssueId(issues.map((issue) => issue.id));
    const nextFormData = newIssueFieldConfig.fields.reduce((accumulator, field) => {
      accumulator[field] = "";
      return accumulator;
    }, {});

    nextFormData[newIssueFieldConfig.fieldNames.issueId] = generatedIssueId;
    // Project Name will be set in handleCreateNewIssue based on Tag Alias or manual entry
    nextFormData[newIssueFieldConfig.fieldNames.projectName] = "";
    nextFormData[newIssueFieldConfig.fieldNames.e2StatusUpdate] = DEFAULT_E2_STATUS_UPDATE;
    nextFormData[newIssueFieldConfig.fieldNames.e2StatusDate] = getTodayMMDDYY();
    nextFormData[newIssueFieldConfig.fieldNames.techDetails] = "No";
    return nextFormData;
  };

  const openAddIssuePopup = () => {
    setNewIssueFormData(buildNewIssueFormData());
    setShowAddIssuePopup(true);
  };

  const closeAddIssuePopup = () => {
    if (savingNewIssue) return;
    setShowAddIssuePopup(false);
    setNewIssueFormData({});
  };

  const handleNewIssueFieldChange = (field, value) => {
    if (
      field === newIssueFieldConfig.fieldNames.issueId ||
      field === newIssueFieldConfig.fieldNames.e2StatusUpdate ||
      field === newIssueFieldConfig.fieldNames.e2StatusDate
    ) {
      return;
    }

    setNewIssueFormData((previous) => ({
      ...previous,
      [field]: value,
    }));
  };

  const handleCreateNewIssue = async (event) => {
    event.preventDefault();
    if (!id) return;

    const { issueId, title, projectName, owner, e2StatusUpdate, e2StatusDate, techDetails } = newIssueFieldConfig.fieldNames;
    const titleValue = normalizeValue(newIssueFormData[title]);
    const ownerValue = normalizeValue(newIssueFormData[owner]);

    // Determine Project Name: use Tag Alias if available, else use manual entry
    let projectNameValue = "";
    const tagAliasValue = getTagAliasForNewIssue(newIssueFormData);
    if (tagAliasValue) {
      projectNameValue = tagAliasValue;
    } else {
      projectNameValue = normalizeValue(newIssueFormData[projectName]);
    }

    if (!titleValue || !projectNameValue || !ownerValue) {
      toast.error("Title, Project Name, and Owner are required.");
      return;
    }

    setSavingNewIssue(true);
    try {
      const existingSource = projectSources[DAILY_ISSUES_TARGET_PROJECT_ID] || {};
      const existingRows = Array.isArray(existingSource.rows) ? existingSource.rows : [];
      const existingFields = Array.isArray(existingSource.fields) ? existingSource.fields : [];
      const existingIssueIds = issues.map((issue) => issue.id);
      let nextIssueId = normalizeValue(newIssueFormData[issueId]) || buildNextTDIssueId(existingIssueIds);
      if (existingIssueIds.some((value) => normalizeValue(value).toLowerCase() === nextIssueId.toLowerCase())) {
        nextIssueId = buildNextTDIssueId([...existingIssueIds, nextIssueId]);
      }

      const nextFields = Array.from(
        new Set([
          ...existingFields.map((field) => normalizeValue(field)).filter(Boolean),
          ...newIssueFieldConfig.fields,
        ])
      );
      const rowData = nextFields.reduce((accumulator, field) => {
        accumulator[field] = normalizeValue(newIssueFormData[field]);
        return accumulator;
      }, {});

      rowData[issueId] = nextIssueId;
      rowData[title] = titleValue;
      rowData[projectName] = projectNameValue;
      rowData[owner] = ownerValue;
      rowData[e2StatusUpdate] = DEFAULT_E2_STATUS_UPDATE;
      rowData[e2StatusDate] = getTodayMMDDYY();
      rowData[techDetails] = normalizeValue(rowData[techDetails]) || "No";

      const nextRows = [
        ...existingRows.map((row) => ({
          ...row,
          rowData: { ...(row?.rowData || {}) },
        })),
        {
          rowNumber: existingRows.length + 1,
          rowData,
        },
      ];

      await setDoc(
        doc(db, "churches", id, "bimProjects", DAILY_ISSUES_TARGET_PROJECT_ID),
        {
          name: DAILY_ISSUES_TARGET_PROJECT_NAME,
          fields: nextFields,
          rows: nextRows,
          rowCount: nextRows.length,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setShowAddIssuePopup(false);
      setNewIssueFormData({});
      setSelectedIssueId(nextIssueId);
      setSelectedProjectName(projectNameValue);
      toast.success(`Issue ${nextIssueId} was created.`);
    } catch (error) {
      console.error("Error creating new issue:", error);
      toast.error("Could not create the new issue.");
    } finally {
      setSavingNewIssue(false);
    }
  };

  const receivedIssues = useMemo(() => {
    return issues.filter((issue) => {
      const normalizedStatus = normalizeValue(issue.e2StatusUpdate).toLowerCase();
      return normalizedStatus === DEFAULT_E2_STATUS_UPDATE.toLowerCase();
    });
  }, [issues]);

  const openReceivedReporting = () => {
    setShowReceivedReporting(true);
    setEditingReceivedTagsKeys(new Set());
    setReceivedTagsDrafts({});
  };

  const closeReceivedReporting = () => {
    setShowReceivedReporting(false);
    setEditingReceivedTagsKeys(new Set());
    setReceivedTagsDrafts({});
  };

  const handleReceivedTagsEdit = (issueKey) => {
    setEditingReceivedTagsKeys((prev) => new Set([...prev, issueKey]));
    const issue = receivedIssues.find((i) => i.key === issueKey);
    if (issue) {
      setReceivedTagsDrafts((prev) => ({
        ...prev,
        [issueKey]: normalizeValue(issue.e2Tags) || "",
      }));
    }
  };

  const handleReceivedTagsChange = (issueKey, value) => {
    setReceivedTagsDrafts((prev) => ({
      ...prev,
      [issueKey]: value,
    }));
  };

  const handleReceivedTagsSave = async (issue) => {
    if (!id || !issue?.projectDocId) return;

    const projectSource = projectSources[issue.projectDocId];
    if (!projectSource) return;

    const previousRows = Array.isArray(projectSource.rows) ? projectSource.rows : [];
    const previousFields = Array.isArray(projectSource.fields) ? projectSource.fields : [];
    const targetRow = previousRows[issue.rowIndex];
    if (!targetRow) return;

    const previousRowData = targetRow?.rowData || {};
    const tagsFieldName = findFieldByAliases(previousFields, previousRowData, E2_TAGS_FIELD_ALIASES) || "E2 Tags";

    const nextValue = normalizeValue(receivedTagsDrafts[issue.key] ?? "");
    const previousValue = normalizeValue(previousRowData[tagsFieldName]);

    if (nextValue === previousValue) {
      setEditingReceivedTagsKeys((prev) => {
        const next = new Set(prev);
        next.delete(issue.key);
        return next;
      });
      return;
    }

    const updatedRowData = { ...previousRowData, [tagsFieldName]: nextValue };
    const updatedRows = previousRows.map((row, index) =>
      index === issue.rowIndex ? { ...row, rowData: updatedRowData } : row
    );
    const updatedFields = previousFields.includes(tagsFieldName) ? previousFields : [...previousFields, tagsFieldName];
    const previousSource = projectSource;

    setSavingReceivedTagsKeys((prev) => ({ ...prev, [issue.key]: true }));

    try {
      await updateDoc(doc(db, "churches", id, "bimProjects", issue.projectDocId), {
        fields: updatedFields,
        rows: updatedRows,
        updatedAt: new Date(),
      });

      setEditingReceivedTagsKeys((prev) => {
        const next = new Set(prev);
        next.delete(issue.key);
        return next;
      });
      toast.success("E2 Tags updated successfully.");
    } catch (error) {
      console.error("Error updating E2 Tags:", error);
      toast.error("Could not update E2 Tags.");
      setProjectSources((prev) => ({
        ...prev,
        [issue.projectDocId]: previousSource,
      }));
    } finally {
      setSavingReceivedTagsKeys((prev) => {
        const next = { ...prev };
        delete next[issue.key];
        return next;
      });
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

        const configuredProjectNameFormats =
          data[PROJECT_NAME_FORMATS_FIELD] && typeof data[PROJECT_NAME_FORMATS_FIELD] === "object"
            ? data[PROJECT_NAME_FORMATS_FIELD]
            : {};
        const normalizedProjectNameFormats = Object.entries(configuredProjectNameFormats).reduce(
          (accumulator, [projectName, formatValue]) => {
            const normalizedKey = normalizeValue(projectName);
            if (!normalizedKey) return accumulator;
            accumulator[normalizedKey] = {
              textColor: normalizeValue(formatValue?.textColor),
              backgroundColor: normalizeValue(formatValue?.backgroundColor),
            };
            return accumulator;
          },
          {}
        );
        setManagedProjectNameFormats(normalizedProjectNameFormats);

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

        const configuredE2Definitions =
          data[E2_STATUS_UPDATE_DEFINITIONS_FIELD] && typeof data[E2_STATUS_UPDATE_DEFINITIONS_FIELD] === "object"
            ? data[E2_STATUS_UPDATE_DEFINITIONS_FIELD]
            : {};
        const normalizedE2Definitions = Object.entries(configuredE2Definitions).reduce(
          (accumulator, [key, value]) => {
            const normalizedKey = normalizeValue(key).toLowerCase();
            if (normalizedKey && typeof value === "string" && value.trim()) {
              accumulator[normalizedKey] = value.trim();
            }
            return accumulator;
          },
          {}
        );
        setManagedE2StatusDefinitions(normalizedE2Definitions);
      },
      () => {
        setManagedE2DetailerOptions(DEFAULT_E2_DETAILER_OPTIONS);
        setManagedE2StatusUpdateOptions(DEFAULT_E2_STATUS_UPDATE_OPTIONS);
        setManagedTagAliases({});
        setManagedStatusFormats({});
        setManagedE2StatusUpdateFormats({});
        setManagedProjectNameFormats({});
        setManagedE2StatusDefinitions({});
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
              cardMetaKey: cardKey,
              title: preview.title || "Untitled issue",
              tags: preview.tags || "-",
              e2Tags: preview.e2Tags || "",
              markup: preview.markup,
              markupLink: preview.markupLink,
              owner: normalizeValue(preview.assignee) || normalizeValue(internalMeta.internalAssignee) || "Unassigned",
              e2Detailer: preview.e2Detailer,
              disableFlag: preview.disableFlag || "No",
              technicalDirection: preview.technicalDirection || "",
              e2DetailerSupportTeam: preview.e2DetailerSupportTeam,
              e2StatusUpdate: preview.e2StatusUpdate,
              e2StatusDate: preview.e2StatusDate,
              techDetailsAvailable: getDefaultTechDetailsAvailable(preview.techDetailsAvailable),
              snapshotUrl: preview.snapshotUrl,
              link: preview.link,
              // priority: preview.priority || "-",
              grid: preview.grid || "-",
              level: preview.level || "-",
              room: preview.room || "-",
              zone: preview.zone || "-",
              zoneCategory: getZoneCategory(preview.zone || ""),
              status: preview.status || "Open",
              dueDate: preview.deadline || "-",
              project: projectName,
              projectName: preview.projectName || projectName,
              projectDocId: projectDoc.id,
              rowIndex,
              createdAt: createdAtValue,
              e2Comments: normalizeValue(internalMeta.e2Comments),
              e2Documents: Array.isArray(internalMeta.e2Documents) ? internalMeta.e2Documents : [],
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
  const statusFilterOptions = useMemo(() => tabs.filter((tab) => tab !== "All"), [tabs]);

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
    const normalizedZone = normalizeValue(issue?.zone).toLowerCase();
    return (
      (normalizedTag && tagAliasByLowerTag[normalizedTag]) ||
      (normalizedZone && tagAliasByLowerTag[normalizedZone]) ||
      normalizeValue(issue?.projectName) ||
      normalizeValue(issue?.project) ||
      "-"
    );
  };

  const visibleIssues = useMemo(() => {
    const normalizedSearch = normalizeValue(globalSearch).toLowerCase();
    const normalizedIssueIdSearch = normalizeValue(selectedIssueId).toLowerCase();
    const normalizedProjectName = normalizeValue(selectedProjectName).toLowerCase();
    const normalizedSelectedDetailer = normalizeValue(selectedE2Detailer).toLowerCase();
    const normalizedSelectedE2StatusUpdate = normalizeValue(selectedE2StatusUpdate).toLowerCase();
    const normalizedSelectedTechDetails = normalizeValue(selectedTechDetails).toLowerCase();

    const dateRangeBounds = getDateRangeBounds(selectedDateRange);

    return issues.filter((issue) => {
      if (hasStatusFilter && !selectedStatusSet.has(normalizeValue(issue.status).toLowerCase())) {
        return false;
      }

      if (selectedProjectName && normalizeValue(getProjectNameDisplay(issue)).toLowerCase() !== normalizedProjectName) {
        return false;
      }

      if (selectedE2Detailer && normalizeValue(issue.e2Detailer).toLowerCase() !== normalizedSelectedDetailer) {
        return false;
      }

      if (selectedE2StatusUpdate && normalizeValue(getDefaultE2StatusUpdate(issue.e2StatusUpdate)).toLowerCase() !== normalizedSelectedE2StatusUpdate) {
        return false;
      }

      if (selectedTechDetails && normalizeValue(issue.techDetailsAvailable).toLowerCase() !== normalizedSelectedTechDetails) {
        return false;
      }

      if (hasE2TagFilter) {
        const issueTags = parseTagValues(issue.e2Tags).map((tag) => tag.toLowerCase());
        const hasNoTagsSelected = selectedE2TagSet.has("no tags");
        const hasOtherTagsSelected = selectedE2Tags.some((tag) => normalizeValue(tag).toLowerCase() !== "no tags");
        
        if (hasNoTagsSelected && !hasOtherTagsSelected) {
          // Only "No Tags" is selected, show only records with no tags
          if (issueTags.length > 0) {
            return false;
          }
        } else if (!hasNoTagsSelected && hasOtherTagsSelected) {
          // Only other tags are selected, show records with those tags
          if (!issueTags.some((tag) => selectedE2TagSet.has(tag))) {
            return false;
          }
        } else if (hasNoTagsSelected && hasOtherTagsSelected) {
          // Both "No Tags" and other tags are selected
          const hasMatchingTag = issueTags.some((tag) => selectedE2TagSet.has(tag));
          const hasNoTags = issueTags.length === 0;
          if (!hasMatchingTag && !hasNoTags) {
            return false;
          }
        }
      }

      if (normalizedIssueIdSearch) {
        const normalizedIssueId = normalizeValue(issue.id).toLowerCase();
        const normalizedIssueIdDisplay = normalizeIssueIdDisplay(issue.id).toLowerCase();
        if (
          !normalizedIssueId.includes(normalizedIssueIdSearch) &&
          !normalizedIssueIdDisplay.includes(normalizedIssueIdSearch)
        ) {
          return false;
        }
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
        issue.e2Tags,
        issue.markup,
        issue.markupLink,
        issue.owner,
        issue.e2Detailer,
        issue.disableFlag,
        issue.technicalDirection,
        issue.e2StatusUpdate,
        // issue.priority,
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
  }, [globalSearch, hasE2TagFilter, hasStatusFilter, issues, selectedE2Detailer, selectedE2StatusUpdate, selectedIssueId, selectedProjectName, selectedStatusSet, selectedE2TagSet, selectedTechDetails, selectedDateRange, tagAliasByLowerTag]);

  const projectNameOptions = useMemo(() => {
    return Array.from(new Set(issues.map((issue) => getProjectNameDisplay(issue)).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [issues, tagAliasByLowerTag]);
  const issueIdOptions = useMemo(() => {
    return Array.from(new Set(issues.map((issue) => normalizeIssueIdDisplay(issue.id)).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [issues]);

  const e2TagSuggestions = useMemo(() => {
    const map = new Map();

    issues.forEach((issue) => {
      const raw = normalizeValue(issue.e2Tags);
      if (!raw) return;

      raw
        .split(/[,;|]/)
        .map((value) => normalizeValue(value))
        .filter(Boolean)
        .forEach((value) => {
          const key = value.toLowerCase();
          if (!map.has(key)) map.set(key, value);
        });
    });

    return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
  }, [issues]);
  const markupNavigableIssues = useMemo(() => {
    return visibleIssues.filter((issue) => Boolean(normalizeValue(issue.markupLink)));
  }, [visibleIssues]);
  const currentMarkupPopupIssue = useMemo(() => {
    if (!markupPopup.issueKey) return null;
    return issues.find((issue) => issue.key === markupPopup.issueKey) || null;
  }, [issues, markupPopup.issueKey]);



  const markupPopupIssueIndex = useMemo(() => {
    if (!markupPopup.issueKey) return -1;
    return markupNavigableIssues.findIndex((issue) => issue.key === markupPopup.issueKey);
  }, [markupNavigableIssues, markupPopup.issueKey]);
  const canNavigateMarkupPrev = markupPopupIssueIndex > 0;
  const canNavigateMarkupNext =
    markupPopupIssueIndex >= 0 && markupPopupIssueIndex < markupNavigableIssues.length - 1;
  const markupPopupTagSuggestions = useMemo(() => {
    const selected = new Set(markupTagValues.map((value) => value.toLowerCase()));
    return e2TagSuggestions.filter((tag) => !selected.has(tag.toLowerCase()));
  }, [e2TagSuggestions, markupTagValues]);
  const e2DetailerOptions = useMemo(() => {
    // Use managed values only so deleted entries are removed from filters/dropdowns everywhere.
    return managedE2DetailerOptions;
  }, [managedE2DetailerOptions]);
  const techDetailsOptions = useMemo(() => {
    return Array.from(new Set(issues.map((issue) => getDefaultTechDetailsAvailable(issue.techDetailsAvailable)).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [issues]);
  const e2TagFilterOptions = useMemo(() => {
    const counts = {};
    let noTagsCount = 0;

    issues.forEach((issue) => {
      const tags = parseTagValues(issue.e2Tags);
      if (tags.length === 0) {
        noTagsCount++;
      } else {
        tags.forEach((tag) => {
          counts[tag] = (counts[tag] || 0) + 1;
        });
      }
    });

    const options = Object.entries(counts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.label.localeCompare(b.label);
      });

    // Add "No Tags" option at the end if there are any issues with no tags
    if (noTagsCount > 0) {
      options.push({ label: "No Tags", count: noTagsCount });
    }

    return options;
  }, [issues]);
  const supportTeamMenuWidthCh = useMemo(() => {
    const longestOptionLength = e2DetailerOptions.reduce((maxLength, option) => {
      return Math.max(maxLength, normalizeValue(option).length);
    }, 0);

    // Add extra width for checkbox, spacing, and menu padding.
    return Math.max(longestOptionLength + 8, 24);
  }, [e2DetailerOptions]);
  const popupSupportTeamMenuWidthCh = useMemo(
    () => Math.max(supportTeamMenuWidthCh + 10, 34),
    [supportTeamMenuWidthCh]
  );
  // Restrict E2 Status Update strictly to values from Manage E2 fields
  const e2StatusUpdateOptions = useMemo(() => managedE2StatusUpdateOptions, [managedE2StatusUpdateOptions]);

  const techDetailsPopupE2StatusOptions = useMemo(() => {
    const matched = e2StatusUpdateOptions.filter((option) => {
      const normalizedOption = normalizeValue(option).toLowerCase();
      return TECH_DETAILS_REQUIRED_E2_STATUS_PREFIXES.some((prefix) =>
        normalizedOption.startsWith(prefix.toLowerCase())
      );
    });

    const uniqueMatched = matched.filter(
      (value, index, array) => array.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index
    );

    return uniqueMatched.length ? uniqueMatched : TECH_DETAILS_REQUIRED_E2_STATUS_PREFIXES;
  }, [e2StatusUpdateOptions]);

  const e2StatusUpdateInfoItems = useMemo(() => {
    return e2StatusUpdateOptions.map((statusValue) => {
      const key = normalizeValue(statusValue).toLowerCase();
      return {
        value: statusValue,
        description:
          managedE2StatusDefinitions[key] ||
          E2_STATUS_UPDATE_INFO_BY_KEY[key] ||
          "Status used in your workflow. Configure this explanation if your process needs a more specific definition.",
      };
    });
  }, [e2StatusUpdateOptions, managedE2StatusDefinitions]);

  const newIssueRequiredFields = useMemo(
    () =>
      new Set([
        newIssueFieldConfig.fieldNames.issueId,
        newIssueFieldConfig.fieldNames.title,
        newIssueFieldConfig.fieldNames.projectName,
        newIssueFieldConfig.fieldNames.owner,
        newIssueFieldConfig.fieldNames.e2StatusUpdate,
      ]),
    [newIssueFieldConfig]
  );

  const e2StatusUpdateCounts = useMemo(() => {
    const normalizedProjectName = normalizeValue(selectedProjectName).toLowerCase();
    const normalizedSelectedDetailer = normalizeValue(selectedE2Detailer).toLowerCase();
    const normalizedSelectedTechDetails = normalizeValue(selectedTechDetails).toLowerCase();
    const dateRangeBounds = getDateRangeBounds(selectedDateRange);

    const counts = {};
    issues.forEach((issue) => {
      if (selectedProjectName && normalizeValue(getProjectNameDisplay(issue)).toLowerCase() !== normalizedProjectName) {
        return;
      }
      if (selectedE2Detailer && normalizeValue(issue.e2Detailer).toLowerCase() !== normalizedSelectedDetailer) {
        return;
      }
      if (selectedTechDetails && normalizeValue(issue.techDetailsAvailable).toLowerCase() !== normalizedSelectedTechDetails) {
        return;
      }
      if (hasStatusFilter && !selectedStatusSet.has(normalizeValue(issue.status).toLowerCase())) {
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
  }, [issues, selectedProjectName, selectedE2Detailer, selectedTechDetails, hasStatusFilter, selectedStatusSet, selectedDateRange, tagAliasByLowerTag]);

  const e2TagCounts = useMemo(() => {
    const normalizedProjectName = normalizeValue(selectedProjectName).toLowerCase();
    const normalizedSelectedDetailer = normalizeValue(selectedE2Detailer).toLowerCase();
    const normalizedSelectedTechDetails = normalizeValue(selectedTechDetails).toLowerCase();
    const normalizedSelectedE2StatusChartTarget = normalizeValue(selectedE2StatusChartTarget).toLowerCase();
    const dateRangeBounds = getDateRangeBounds(selectedDateRange);

    const counts = {};
    issues.forEach((issue) => {
      if (selectedProjectName && normalizeValue(getProjectNameDisplay(issue)).toLowerCase() !== normalizedProjectName) {
        return;
      }
      if (selectedE2Detailer && normalizeValue(issue.e2Detailer).toLowerCase() !== normalizedSelectedDetailer) {
        return;
      }
      if (selectedTechDetails && normalizeValue(issue.techDetailsAvailable).toLowerCase() !== normalizedSelectedTechDetails) {
        return;
      }
      if (hasStatusFilter && !selectedStatusSet.has(normalizeValue(issue.status).toLowerCase())) {
        return;
      }
      if (
        normalizedSelectedE2StatusChartTarget &&
        normalizeValue(getDefaultE2StatusUpdate(issue.e2StatusUpdate)).toLowerCase() !==
          normalizedSelectedE2StatusChartTarget
      ) {
        return;
      }
      if (dateRangeBounds) {
        const d = parseStatusUpdateDate(issue.e2StatusDate);
        if (!d || d < dateRangeBounds[0] || d > dateRangeBounds[1]) return;
      }

      const tags = parseTagValues(issue.e2Tags);
      if (!tags.length) {
        counts["No E2 Tag"] = (counts["No E2 Tag"] || 0) + 1;
        return;
      }

      tags.forEach((tag) => {
        counts[tag] = (counts[tag] || 0) + 1;
      });
    });

    return Object.entries(counts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }, [issues, selectedProjectName, selectedE2Detailer, selectedTechDetails, hasStatusFilter, selectedStatusSet, selectedDateRange, selectedE2StatusChartTarget, tagAliasByLowerTag]);

  useEffect(() => {
    const normalizedTarget = normalizeValue(selectedE2StatusChartTarget).toLowerCase();
    if (!normalizedTarget) return;

    const targetStillExists = e2StatusUpdateCounts.some(
      (item) => normalizeValue(item.label).toLowerCase() === normalizedTarget
    );
    if (!targetStillExists) {
      setSelectedE2StatusChartTarget("");
    }
  }, [e2StatusUpdateCounts, selectedE2StatusChartTarget]);

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
    const normalizedSelectedE2StatusUpdate = normalizeValue(selectedE2StatusUpdate).toLowerCase();
    const normalizedSelectedTechDetails = normalizeValue(selectedTechDetails).toLowerCase();
    const dateRangeBounds = getDateRangeBounds(selectedDateRange);

    return issues.filter((issue) => {
      if (selectedProjectName && normalizeValue(getProjectNameDisplay(issue)).toLowerCase() !== normalizedProjectName) {
        return false;
      }
      if (selectedE2Detailer && normalizeValue(issue.e2Detailer).toLowerCase() !== normalizedSelectedDetailer) {
        return false;
      }
      if (selectedE2StatusUpdate && normalizeValue(getDefaultE2StatusUpdate(issue.e2StatusUpdate)).toLowerCase() !== normalizedSelectedE2StatusUpdate) {
        return false;
      }
      if (selectedTechDetails && normalizeValue(issue.techDetailsAvailable).toLowerCase() !== normalizedSelectedTechDetails) {
        return false;
      }
      if (dateRangeBounds) {
        const d = parseStatusUpdateDate(issue.e2StatusDate);
        if (!d || d < dateRangeBounds[0] || d > dateRangeBounds[1]) return false;
      }
      return true;
    }).length;
  }, [issues, selectedProjectName, selectedE2Detailer, selectedE2StatusUpdate, selectedTechDetails, selectedDateRange, tagAliasByLowerTag]);
  const summaryStatusName = hasStatusFilter ? selectedStatuses.join(", ") : "All Statuses";
  const statusScopedIssueCount = useMemo(() => {
    const normalizedProjectName = normalizeValue(selectedProjectName).toLowerCase();
    const normalizedSelectedDetailer = normalizeValue(selectedE2Detailer).toLowerCase();
    const normalizedSelectedE2StatusUpdate = normalizeValue(selectedE2StatusUpdate).toLowerCase();
    const normalizedSelectedTechDetails = normalizeValue(selectedTechDetails).toLowerCase();
    const dateRangeBounds = getDateRangeBounds(selectedDateRange);

    return issues.filter((issue) => {
      if (selectedProjectName && normalizeValue(getProjectNameDisplay(issue)).toLowerCase() !== normalizedProjectName) {
        return false;
      }

      if (selectedE2Detailer && normalizeValue(issue.e2Detailer).toLowerCase() !== normalizedSelectedDetailer) {
        return false;
      }

      if (selectedE2StatusUpdate && normalizeValue(getDefaultE2StatusUpdate(issue.e2StatusUpdate)).toLowerCase() !== normalizedSelectedE2StatusUpdate) {
        return false;
      }

      if (selectedTechDetails && normalizeValue(issue.techDetailsAvailable).toLowerCase() !== normalizedSelectedTechDetails) {
        return false;
      }

      if (hasStatusFilter && !selectedStatusSet.has(normalizeValue(issue.status).toLowerCase())) {
        return false;
      }

      if (dateRangeBounds) {
        const d = parseStatusUpdateDate(issue.e2StatusDate);
        if (!d || d < dateRangeBounds[0] || d > dateRangeBounds[1]) return false;
      }

      return true;
    }).length;
  }, [hasStatusFilter, issues, selectedProjectName, selectedStatuses, selectedE2Detailer, selectedE2StatusUpdate, selectedStatusSet, selectedTechDetails, selectedDateRange, tagAliasByLowerTag]);

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
    const normalizedSelectedE2StatusUpdate = normalizeValue(selectedE2StatusUpdate).toLowerCase();
    const normalizedSelectedTechDetails = normalizeValue(selectedTechDetails).toLowerCase();
    const dateRangeBounds = getDateRangeBounds(selectedDateRange);
    const countsByStatus = {};

    issues.forEach((issue) => {
      if (selectedProjectName && normalizeValue(getProjectNameDisplay(issue)).toLowerCase() !== normalizedProjectName) {
        return;
      }

      if (selectedE2Detailer && normalizeValue(issue.e2Detailer).toLowerCase() !== normalizedSelectedDetailer) {
        return;
      }

      if (selectedE2StatusUpdate && normalizeValue(getDefaultE2StatusUpdate(issue.e2StatusUpdate)).toLowerCase() !== normalizedSelectedE2StatusUpdate) {
        return;
      }

      if (selectedTechDetails && normalizeValue(issue.techDetailsAvailable).toLowerCase() !== normalizedSelectedTechDetails) {
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
  }, [issues, selectedProjectName, selectedE2Detailer, selectedE2StatusUpdate, selectedTechDetails, selectedDateRange, statusFormatByLowerStatus, tagAliasByLowerTag]);

  const overviewE2BreakdownByStatus = useMemo(() => {
    const normalizedProjectName = normalizeValue(selectedProjectName).toLowerCase();
    const normalizedSelectedDetailer = normalizeValue(selectedE2Detailer).toLowerCase();
    const normalizedSelectedE2StatusUpdate = normalizeValue(selectedE2StatusUpdate).toLowerCase();
    const normalizedSelectedTechDetails = normalizeValue(selectedTechDetails).toLowerCase();
    const dateRangeBounds = getDateRangeBounds(selectedDateRange);
    const grouped = {};

    issues.forEach((issue) => {
      if (selectedProjectName && normalizeValue(getProjectNameDisplay(issue)).toLowerCase() !== normalizedProjectName) {
        return;
      }

      if (selectedE2Detailer && normalizeValue(issue.e2Detailer).toLowerCase() !== normalizedSelectedDetailer) {
        return;
      }

      if (selectedE2StatusUpdate && normalizeValue(getDefaultE2StatusUpdate(issue.e2StatusUpdate)).toLowerCase() !== normalizedSelectedE2StatusUpdate) {
        return;
      }

      if (selectedTechDetails && normalizeValue(issue.techDetailsAvailable).toLowerCase() !== normalizedSelectedTechDetails) {
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
    selectedE2StatusUpdate,
    selectedTechDetails,
    selectedDateRange,
    e2StatusUpdateFormatByLowerValue,
    tagAliasByLowerTag,
  ]);

  const overviewBarColumnWidthPx = useMemo(() => {
    const maxLabelLen = overviewStatusCounts.reduce((maxLen, item) => {
      const len = normalizeValue(item?.label).length;
      return len > maxLen ? len : maxLen;
    }, 0);
    // Approximate label text width and clamp to keep columns readable.
    return Math.max(70, Math.min(220, maxLabelLen * 7 + 18));
  }, [overviewStatusCounts]);

  const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const trendChartBuckets = useMemo(() => {
    const normalizedProjectName = normalizeValue(selectedProjectName).toLowerCase();
    const normalizedSelectedDetailer = normalizeValue(selectedE2Detailer).toLowerCase();
    const normalizedSelectedE2StatusUpdate = normalizeValue(selectedE2StatusUpdate).toLowerCase();
    const normalizedSelectedTechDetails = normalizeValue(selectedTechDetails).toLowerCase();
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
      if (selectedE2StatusUpdate && normalizeValue(getDefaultE2StatusUpdate(issue.e2StatusUpdate)).toLowerCase() !== normalizedSelectedE2StatusUpdate) {
        return false;
      }
      if (selectedTechDetails && normalizeValue(issue.techDetailsAvailable).toLowerCase() !== normalizedSelectedTechDetails) {
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
        return {
          key: `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`,
          label: `${d.getMonth() + 1}/${d.getDate()}`,
          dayLabel: DAY_ABBR[d.getDay()],
          count: 0,
          date: d,
        };
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
      const buckets = Array.from({ length: daysInMonth }, (_, i) => {
        const d = new Date(today.getFullYear(), today.getMonth(), i + 1);
        return {
          key: String(i + 1),
          label: `${d.getMonth() + 1}/${d.getDate()}`,
          dayLabel: DAY_ABBR[d.getDay()],
          count: 0,
          date: d,
        };
      });
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
      // Buckets: Jan-current month, each bucket stacked by project
      const yearStart = new Date(today.getFullYear(), 0, 1);
      const buckets = Array.from({ length: today.getMonth() + 1 }, (_, i) => ({
        key: String(i),
        label: `${MONTH_ABBR[i]} '${String(today.getFullYear()).slice(-2)}`,
        count: 0,
        projectCounts: {},
        date: new Date(today.getFullYear(), i, 1),
      }));

      filtered.forEach((issue) => {
        const d = parseStatusUpdateDate(issue.e2StatusDate);
        if (!d) return;
        if (d < yearStart || d > today) return;
        const monthIdx = d.getMonth();
        const projectLabel = normalizeValue(getProjectNameDisplay(issue)) || "Unknown Project";
        if (!buckets[monthIdx]) return;

        buckets[monthIdx].count += 1;
        buckets[monthIdx].projectCounts[projectLabel] = (buckets[monthIdx].projectCounts[projectLabel] || 0) + 1;
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
  }, [issues, selectedProjectName, selectedE2Detailer, selectedE2StatusUpdate, selectedTechDetails, selectedDateRange, tagAliasByLowerTag]);

  const trendChartTabTitle = selectedDateRange === "YTD" ? "Trending (YTD)" : "Trending";

  const timeRangeDisplay = useMemo(() => {
    const now = new Date();
    const todayStr = `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}/${now.getFullYear()}`;
    if (selectedDateRange === "YTD") {
      const fromStr = `01/01/${now.getFullYear()}`;
      return `Time Range: From: ${fromStr} To: ${todayStr}`;
    }
    if (selectedDateRange === "MTD") {
      const fromStr = `${String(now.getMonth() + 1).padStart(2, "0")}/01/${now.getFullYear()}`;
      return `Time Range: From: ${fromStr} To: ${todayStr}`;
    }
    if (selectedDateRange === "TW") {
      const dow = now.getDay();
      const sunday = new Date(now);
      sunday.setDate(now.getDate() - dow);
      const fromStr = `${String(sunday.getMonth() + 1).padStart(2, "0")}/${String(sunday.getDate()).padStart(2, "0")}/${sunday.getFullYear()}`;
      return `Time Range: From: ${fromStr} To: ${todayStr}`;
    }
    // "All" — find oldest status update date across all issues
    let oldest = null;
    issues.forEach((issue) => {
      const d = parseStatusUpdateDate(issue.e2StatusDate);
      if (d && (!oldest || d < oldest)) oldest = d;
    });
    const fromStr = oldest
      ? `${String(oldest.getMonth() + 1).padStart(2, "0")}/${String(oldest.getDate()).padStart(2, "0")}/${oldest.getFullYear()}`
      : "--";
    return `Time Range: From: ${fromStr} To: ${todayStr}`;
  }, [selectedDateRange, issues]);

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
    const validStatuses = selectedStatuses.filter((status) => tabs.includes(status));
    const serializedValidStatuses = serializeStatusFilterParam(validStatuses);
    if (serializedValidStatuses !== activeTab) {
      setActiveTab(serializedValidStatuses);
    }
  }, [activeTab, selectedStatuses, tabs]);

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
    const detectedDetailerFieldName =
      findFieldByAliases(previousFields, previousRowData, ["e2 lead detailer", "e2leaddetailer", "e2 detailer", "e2detailer"]) || E2_DETAILER_FIELD;
    const detectedTechDetailsFieldName =
      findFieldByAliases(previousFields, previousRowData, ["technical details available", "technical details", "techdetailsavailable"]) || TECH_DETAILS_FIELD;
    const fieldName =
      detectedDetailerFieldName === detectedTechDetailsFieldName ? E2_DETAILER_FIELD : detectedDetailerFieldName;
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
      console.error("Error updating E2 Lead Detailer:", error);
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

  const handleE2DetailerSupportTeamChange = (issueKey, selectedValues) => {
    const formattedValue = formatSupportTeamValue(selectedValues);
    setIssues((previous) =>
      previous.map((issue) =>
        issue.key === issueKey ? { ...issue, e2DetailerSupportTeam: formattedValue } : issue
      )
    );
  };

  const handleE2DetailerSupportTeamSave = async (issue, selectedValuesOverride) => {
    if (!id || !issue?.projectDocId) return;

    const projectSource = projectSources[issue.projectDocId];
    if (!projectSource) return;

    const previousRows = Array.isArray(projectSource.rows) ? projectSource.rows : [];
    const previousFields = Array.isArray(projectSource.fields) ? projectSource.fields : [];
    const targetRow = previousRows[issue.rowIndex];
    if (!targetRow) return;

    const previousRowData = targetRow?.rowData || {};
    const fieldName =
      findFieldByAliases(
        previousFields,
        previousRowData,
        ["e2 detailer support team", "e2 detailer support", "e2 support team", "support team"]
      ) || E2_DETAILER_SUPPORT_TEAM_FIELD;
    const nextValue = formatSupportTeamValue(selectedValuesOverride ?? issue.e2DetailerSupportTeam);
    const previousValue = formatSupportTeamValue(previousRowData[fieldName]);

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
    setSavingIssueKeys((previous) => ({ ...previous, [`supportteam:${issue.key}`]: true }));

    try {
      await updateDoc(doc(db, "churches", id, "bimProjects", issue.projectDocId), {
        fields: updatedFields,
        rows: updatedRows,
        updatedAt: new Date(),
      });
    } catch (error) {
      console.error("Error updating E2 Detailer Support Team:", error);
      setProjectSources((previous) => ({
        ...previous,
        [issue.projectDocId]: previousSource,
      }));
      setIssues((previous) =>
        previous.map((item) =>
          item.key === issue.key ? { ...item, e2DetailerSupportTeam: previousValue } : item
        )
      );
    } finally {
      setSavingIssueKeys((previous) => {
        const next = { ...previous };
        delete next[`supportteam:${issue.key}`];
        return next;
      });
    }
  };

  const handleE2StatusUpdateChange = (issueKey, value) => {
    const normalizedValue = getDefaultE2StatusUpdate(value);
    setIssues((previous) =>
      previous.map((issue) =>
        issue.key === issueKey
          ? {
              ...issue,
              e2StatusUpdate: normalizedValue,
              e2StatusDate: resolveStatusDateForStatusTransition(
                normalizedValue,
                issue.e2StatusUpdate,
                issue.e2StatusDate
              ),
            }
          : issue
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
      findFieldByAliases(previousFields, previousRowData, E2_STATUS_DATE_FIELD_ALIASES) || E2_STATUS_DATE_FIELD;
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
    const normalizedValue = getDefaultTechDetailsAvailable(value);
    setIssues((previous) =>
      previous.map((issue) => (issue.key === issueKey ? { ...issue, techDetailsAvailable: normalizedValue } : issue))
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
    const nextValue = getDefaultTechDetailsAvailable(valueOverride ?? issue.techDetailsAvailable);
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
      console.error(`Error updating ${TECH_DETAILS_DISPLAY_LABEL}:`, error);
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

  const openTechDetailsPopup = (issue) => {
    if (!issue?.key) return;
    setTechDetailsPopup({
      open: true,
      issueKey: issue.key,
      e2StatusUpdate: "",
      e2Detailer: "",
      e2DetailerSupportTeam: sanitizeSupportTeamValues(issue.e2DetailerSupportTeam, e2DetailerOptions),
    });
    setPopupSupportTeamMenuOpen(false);
  };

  const openTechDetailsRequiredInformationPopup = (issue) => {
    if (!issue?.key) return;

    setPendingTechDetailsIssueKey("");

    const launchPopup = async () => {
      let e2Comments = "";
      let e2Documents = [];
      let e2TD = issue.e2TD || "--";
      let e2Detailer = issue.e2Detailer || "";
      let e2DetailerSupportTeam = sanitizeSupportTeamValues(issue.e2DetailerSupportTeam, e2DetailerOptions);

      try {
        if (issue?.projectDocId) {
          const projectSnapshot = await getDoc(doc(db, "churches", id, "bimProjects", issue.projectDocId));
          if (projectSnapshot.exists()) {
            const projectData = projectSnapshot.data();
            const fields = Array.isArray(projectData.fields) ? projectData.fields : [];
            const rows = Array.isArray(projectData.rows) ? projectData.rows : [];
            const targetRow = rows[issue.rowIndex];
            const rowData = targetRow?.rowData || {};
            // Use field alias helpers to get the latest values from Firestore
            const e2TDField = findFieldByAliases(fields, rowData, E2_TD_FIELD_ALIASES);
            const e2DetailerField = findFieldByAliases(fields, rowData, ["e2 lead detailer", "e2leaddetailer", "e2 detailer", "e2detailer"]);
            const e2DetailerSupportTeamField = findFieldByAliases(fields, rowData, ["e2 detailer support team", "e2 detailer support", "e2 support team", "support team"]);
            e2TD = normalizeValue(e2TDField ? rowData[e2TDField] : e2TD);
            e2Detailer = normalizeValue(e2DetailerField ? rowData[e2DetailerField] : e2Detailer);
            e2DetailerSupportTeam = sanitizeSupportTeamValues(rowData[e2DetailerSupportTeamField], e2DetailerOptions);
            const internalCardMeta = projectData?.internalCardMeta || {};
            const cardMeta = internalCardMeta[issue.id] || {};
            e2Comments = normalizeValue(cardMeta.e2Comments) || "";
            e2Documents = Array.isArray(cardMeta.e2Documents) ? cardMeta.e2Documents : [];
          }
        }
      } catch (err) {
        console.error("Error loading E2 metadata for popup:", err);
      }

      let technicalDirection = issue.technicalDirection || "";
      try {
        if (issue?.projectDocId) {
          const projectSnapshot = await getDoc(doc(db, "churches", id, "bimProjects", issue.projectDocId));
          if (projectSnapshot.exists()) {
            const projectData = projectSnapshot.data();
            const fields = Array.isArray(projectData.fields) ? projectData.fields : [];
            const rows = Array.isArray(projectData.rows) ? projectData.rows : [];
            const targetRow = rows[issue.rowIndex];
            const rowData = targetRow?.rowData || {};
            const technicalDirectionField = findFieldByAliases(fields, rowData, TECHNICAL_DIRECTION_FIELD_ALIASES);
            technicalDirection = normalizeValue(technicalDirectionField ? rowData[technicalDirectionField] : technicalDirection);
          }
        }
      } catch (err) {
        console.error("Error loading Technical Direction for popup:", err);
      }
      setTechDetailsPopup({
        open: true,
        issueKey: issue.key,
        e2TD,
        e2Detailer,
        e2DetailerSupportTeam,
        technicalDirection,
        e2Comments,
        e2Documents,
      });
      setPopupSupportTeamMenuOpen(false);
    };

    if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
      window.setTimeout(launchPopup, 0);
      return;
    }

    launchPopup();
  };

  const handleTechDetailsPopupSubmit = async () => {


    // E2 TD value
    const selectedE2TD = techDetailsPopup.e2TD || "--";
    const selectedDetailer = normalizeValue(techDetailsPopup.e2Detailer);
    const selectedSupportTeamValues = sanitizeSupportTeamValues(
      techDetailsPopup.e2DetailerSupportTeam,
      e2DetailerOptions
    );

    if (isDetailerInSupportTeam(selectedDetailer, selectedSupportTeamValues)) {
      openDetailerConflictPopup(selectedDetailer);
      return;
    }

    const issue = issues.find((item) => item.key === techDetailsPopup.issueKey);
    if (!issue) {
      toast.error("Issue data was not found. Please refresh and try again.");
      return;
    }

    const projectSource = projectSources[issue.projectDocId];
    if (!projectSource) {
      toast.error("Project data is not available. Please refresh and try again.");
      return;
    }

    const previousRows = Array.isArray(projectSource.rows) ? projectSource.rows : [];
    const previousFields = Array.isArray(projectSource.fields) ? projectSource.fields : [];
    const targetRow = previousRows[issue.rowIndex];
    if (!targetRow) {
      toast.error("Issue row was not found. Please refresh and try again.");
      return;
    }

    const previousRowData = targetRow?.rowData || {};
    const techDetailsFieldName =
      findFieldByAliases(previousFields, previousRowData, ["technical details available", "technical details", "techdetailsavailable"]) || TECH_DETAILS_FIELD;
    const e2TDFieldName =
      findFieldByAliases(previousFields, previousRowData, E2_TD_FIELD_ALIASES) || E2_TD_FIELD;
    const e2StatusFieldName =
      findFieldByAliases(previousFields, previousRowData, ["e2 status update", "e2statusupdate"]) || E2_STATUS_UPDATE_FIELD;
    const e2DetailerFieldName =
      findFieldByAliases(previousFields, previousRowData, ["e2 lead detailer", "e2leaddetailer", "e2 detailer", "e2detailer"]) || E2_DETAILER_FIELD;
    const e2StatusDateFieldName =
      findFieldByAliases(previousFields, previousRowData, E2_STATUS_DATE_FIELD_ALIASES) || E2_STATUS_DATE_FIELD;

    const previousTechDetailsValue = normalizeValue(previousRowData[techDetailsFieldName]);
    const previousStatusValue = normalizeValue(previousRowData[e2StatusFieldName]);
    const previousDetailerValue = normalizeValue(previousRowData[e2DetailerFieldName]);
    const e2SupportTeamFieldName =
      findFieldByAliases(
        previousFields,
        previousRowData,
        ["e2 detailer support team", "e2 detailer support", "e2 support team", "support team"]
      ) || E2_DETAILER_SUPPORT_TEAM_FIELD;
    const previousSupportTeamValue = formatSupportTeamValue(previousRowData[e2SupportTeamFieldName]);
    const previousStatusDateValue = normalizeValue(previousRowData[e2StatusDateFieldName]);
    // E2 Status Update is no longer required, so resolvedStatusDate can default to previousStatusDateValue
    const resolvedStatusDate = previousStatusDateValue;

    const technicalDirectionFieldName =
      findFieldByAliases(previousFields, previousRowData, TECHNICAL_DIRECTION_FIELD_ALIASES) || TECHNICAL_DIRECTION_FIELD;
    const selectedTechnicalDirection = techDetailsPopup.technicalDirection || "";
    const updatedRowData = {
      ...previousRowData,
      [e2TDFieldName]: selectedE2TD,
      [techDetailsFieldName]: "Yes",
      [e2DetailerFieldName]: selectedDetailer,
      [e2SupportTeamFieldName]: formatSupportTeamValue(selectedSupportTeamValues),
      [e2StatusDateFieldName]: resolvedStatusDate,
      [technicalDirectionFieldName]: selectedTechnicalDirection,
      [e2StatusFieldName]: "To Do List",
    };
    const updatedRows = previousRows.map((row, index) =>
      index === issue.rowIndex ? { ...row, rowData: updatedRowData } : row
    );
    let updatedFields = previousFields.includes(e2TDFieldName) ? previousFields : [...previousFields, e2TDFieldName];
    updatedFields = updatedFields.includes(techDetailsFieldName) ? updatedFields : [...updatedFields, techDetailsFieldName];
    updatedFields = updatedFields.includes(e2StatusFieldName) ? updatedFields : [...updatedFields, e2StatusFieldName];
    updatedFields = updatedFields.includes(e2DetailerFieldName) ? updatedFields : [...updatedFields, e2DetailerFieldName];
    updatedFields = updatedFields.includes(e2SupportTeamFieldName) ? updatedFields : [...updatedFields, e2SupportTeamFieldName];
    updatedFields = updatedFields.includes(e2StatusDateFieldName) ? updatedFields : [...updatedFields, e2StatusDateFieldName];
    updatedFields = updatedFields.includes(technicalDirectionFieldName) ? updatedFields : [...updatedFields, technicalDirectionFieldName];
    const previousSource = projectSource;

    setSubmittingTechDetailsPopup(true);
    setSavingIssueKeys((previous) => ({ ...previous, [`popup:${issue.key}`]: true }));
    try {
      setProjectSources((previous) => ({
        ...previous,
        [issue.projectDocId]: { fields: updatedFields, rows: updatedRows },
      }));
      setIssues((previous) =>
        previous.map((item) =>
          item.key === issue.key
            ? {
                ...item,
                techDetailsAvailable: "Yes",
                e2TD: selectedE2TD,
                e2Detailer: selectedDetailer,
                e2DetailerSupportTeam: formatSupportTeamValue(selectedSupportTeamValues),
                e2StatusDate: resolvedStatusDate,
              }
            : item
        )
      );

      await updateDoc(doc(db, "churches", id, "bimProjects", issue.projectDocId), {
        fields: updatedFields,
        rows: updatedRows,
        updatedAt: new Date(),
      });

      // Force a full refresh of issues from Firestore after submit
      if (typeof fetchAndSyncAllIssues === "function") {
        await fetchAndSyncAllIssues();
      }

      setTechDetailsPopup({
        open: false,
        issueKey: "",
        e2TD: "--",
        e2StatusUpdate: "",
        e2Detailer: "",
        e2DetailerSupportTeam: [],
        technicalDirection: "",
        e2Comments: "",
        e2Documents: [],
      });
      setPopupSupportTeamMenuOpen(false);
      toast.success("Technical details workflow completed.");
    } catch (error) {
      console.error("Error submitting Technical Details popup:", error);
      setProjectSources((previous) => ({
        ...previous,
        [issue.projectDocId]: previousSource,
      }));
      setIssues((previous) =>
        previous.map((item) =>
          item.key === issue.key
            ? {
                ...item,
                techDetailsAvailable: previousTechDetailsValue,
                e2StatusUpdate: previousStatusValue,
                e2Detailer: previousDetailerValue,
                e2DetailerSupportTeam: previousSupportTeamValue,
                e2StatusDate: previousStatusDateValue,
                technicalDirection: previousRowData[technicalDirectionFieldName] || "",
              }
            : item
        )
      );
      toast.error("Could not save Technical Details workflow values.");
    } finally {
      setSavingIssueKeys((previous) => {
        const next = { ...previous };
        delete next[`popup:${issue.key}`];
        return next;
      });
      setSubmittingTechDetailsPopup(false);
    }
  };

  const handleTechDetailsSelectChange = (issue, value) => {
    const nextValue = getDefaultTechDetailsAvailable(value);

    if (issue?.key && issue.key === pendingTechDetailsIssueKey && nextValue === "Yes") {
      setPendingTechDetailsIssueKey("");
    }

    if (nextValue === "Yes") {
      openTechDetailsPopup(issue);
      return;
    }

    handleTechDetailsChange(issue.key, nextValue);
    handleTechDetailsSave({ ...issue, techDetailsAvailable: nextValue }, nextValue);
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
      findFieldByAliases(previousFields, previousRowData, E2_STATUS_DATE_FIELD_ALIASES) || E2_STATUS_DATE_FIELD;
    const previousDateValue = normalizeValue(previousRowData[dateFieldName]);
    const resolvedStatusDate = resolveStatusDateForStatusTransition(
      nextValue,
      previousValue,
      previousDateValue
    );

    const updatedRowData = {
      ...previousRowData,
      [fieldName]: nextValue,
      [dateFieldName]: resolvedStatusDate,
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
          E2_STATUS_UPDATE_FIELD,
          E2_STATUS_DATE_FIELD,
        ])
      );

      const getPrimaryIssueId = (rowData = {}) => {
        const idField = findFieldByAliases(mergedFields, rowData, ["issue id", "id", "task id", "card id", "row id"]);
        return normalizeValue(idField ? rowData?.[idField] : "");
      };

      const getImportedStatusFieldName = (rowData = {}) =>
        findFieldByAliases(mergedFields, rowData, ["e2 status update", "e2statusupdate"]) || E2_STATUS_UPDATE_FIELD;

      const getImportedStatusDateFieldName = (rowData = {}) =>
        findFieldByAliases(mergedFields, rowData, E2_STATUS_DATE_FIELD_ALIASES) || E2_STATUS_DATE_FIELD;

      const buildImportedRowData = (incomingRowData = {}, existingRowData = {}, isNewRow = false) => {
        const rowContext = { ...existingRowData, ...incomingRowData };
        const statusFieldName = getImportedStatusFieldName(rowContext);
        const statusDateFieldName = getImportedStatusDateFieldName(rowContext);
        const previousStatusValue = normalizeValue(existingRowData[statusFieldName]);
        const previousStatusDateValue = getDefaultE2StatusDate(existingRowData[statusDateFieldName]);
        const rawIncomingStatusValue = normalizeValue(incomingRowData[statusFieldName]);
        const rawIncomingStatusDateValue = getDefaultE2StatusDate(incomingRowData[statusDateFieldName]);
        const shouldApplyIncomingStatus = Boolean(rawIncomingStatusValue);
        const nextRowData = { ...existingRowData };

        Object.entries(incomingRowData).forEach(([field, value]) => {
          if (field === statusFieldName || field === statusDateFieldName) {
            return;
          }
          nextRowData[field] = value;
        });

        const nextStatusValue = getDefaultE2StatusUpdate(
          rawIncomingStatusValue || previousStatusValue || DEFAULT_E2_STATUS_UPDATE
        );

        let nextStatusDateValue = previousStatusDateValue;

        if (isNewRow) {
          nextStatusDateValue = hasMeaningfulStatusUpdateDate(rawIncomingStatusDateValue)
            ? rawIncomingStatusDateValue
            : getTodayMMDDYY();
        } else if (shouldApplyIncomingStatus) {
          nextStatusDateValue =
            resolveStatusDateForStatusTransition(nextStatusValue, previousStatusValue, previousStatusDateValue) ||
            (hasMeaningfulStatusUpdateDate(rawIncomingStatusDateValue) ? rawIncomingStatusDateValue : "") ||
            getTodayMMDDYY();
        } else if (!hasMeaningfulStatusUpdateDate(previousStatusDateValue)) {
          nextStatusDateValue = hasMeaningfulStatusUpdateDate(rawIncomingStatusDateValue)
            ? rawIncomingStatusDateValue
            : getTodayMMDDYY();
        }

        nextRowData[statusFieldName] = nextStatusValue;
        nextRowData[statusDateFieldName] = nextStatusDateValue;

        return nextRowData;
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
          const nextRowData = buildImportedRowData(incomingRowData, {}, true);
          nextRows.push({
            rowNumber: nextRows.length + 1,
            rowData: nextRowData,
          });
          existingRowsById.set(issueId, nextRows.length - 1);
          insertedRowsCount += 1;
          changedCells += Object.keys(nextRowData).length;
          return;
        }

        const existingRow = nextRows[existingIndex] || {};
        const existingRowData = existingRow?.rowData || {};
        const mergedRowData = buildImportedRowData(incomingRowData, existingRowData, false);
        let rowChanged = false;

        Object.entries(mergedRowData).forEach(([field, incomingValue]) => {
          const previousValue = normalizeValue(existingRowData[field]);
          const nextValue = normalizeValue(incomingValue);
          if (previousValue !== nextValue) {
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

  const openMarkupPopup = (url, label = "", issueId = "", issueKey = "", tags = "") => {
    const safeUrl = normalizeValue(url);
    if (!safeUrl) return;
    setMarkupPopupSize({ width: 960, height: 640 });
    setMarkupTagValues(parseTagValues(tags));
    setMarkupTagInput("");
    setMarkupPopup({
      url: safeUrl,
      label: normalizeValue(label),
      issueId: normalizeValue(issueId),
      issueKey: normalizeValue(issueKey),
    });
  };

  const openMarkupPopupForIssue = (issue) => {
    if (!issue || !normalizeValue(issue.markupLink)) return;
    if (!markupNavigableIssues.some((item) => item.key === issue.key)) return;
    openMarkupPopup(issue.markupLink, issue.markup || issue.id, issue.id, issue.key, issue.e2Tags);
  };

  const closeMarkupPopup = () => {
    setMarkupPopup({ url: "", label: "", issueId: "", issueKey: "" });
    setMarkupPopupSize({ width: 960, height: 640 });
    setMarkupTagInput("");
    setMarkupTagValues([]);
    setSavingMarkupTags(false);
  };

  const saveMarkupTagsToIssue = async (tagsToSave) => {
    const issue = issues.find((item) => item.key === markupPopup.issueKey);
    if (!id || !issue?.projectDocId) {
      return;
    }

    const projectSource = projectSources[issue.projectDocId];
    if (!projectSource) {
      return;
    }

    const previousRows = Array.isArray(projectSource.rows) ? projectSource.rows : [];
    const previousFields = Array.isArray(projectSource.fields) ? projectSource.fields : [];
    const targetRow = previousRows[issue.rowIndex];
    if (!targetRow) {
      return;
    }

    const previousRowData = targetRow?.rowData || {};
    const tagsFieldName = findFieldByAliases(previousFields, previousRowData, E2_TAGS_FIELD_ALIASES) || "E2 Tags";
    const nextValue = tagsToSave.join(", ");
    const previousValue = normalizeValue(previousRowData[tagsFieldName]);

    if (nextValue === previousValue) {
      return;
    }

    const updatedRowData = { ...previousRowData, [tagsFieldName]: nextValue };
    const updatedRows = previousRows.map((row, index) =>
      index === issue.rowIndex ? { ...row, rowData: updatedRowData } : row
    );
    const updatedFields = previousFields.includes(tagsFieldName) ? previousFields : [...previousFields, tagsFieldName];

    setSavingMarkupTags(true);

    try {
      await updateDoc(doc(db, "churches", id, "bimProjects", issue.projectDocId), {
        fields: updatedFields,
        rows: updatedRows,
        updatedAt: new Date(),
      });

      const requiresTechnicalDetails = tagsToSave.some(
        (tag) => normalizeValue(tag).toLowerCase() === "technical details"
      );
      if (requiresTechnicalDetails) {
        openTechDetailsRequiredInformationPopup(issue);
      }
    } catch (error) {
      console.error("Error auto-saving E2 Tags from markup popup:", error);
      toast.error("Could not auto-save E2 Tags.");
    } finally {
      setSavingMarkupTags(false);
    }
  };

  const handleMarkupTagAdd = (valueOverride = "") => {
    const candidate = normalizeValue(valueOverride || markupTagInput);
    if (!candidate) return;

    setMarkupTagValues((previous) => {
      const exists = previous.some((value) => value.toLowerCase() === candidate.toLowerCase());
      if (exists) return previous;
      const updated = [...previous, candidate];
      // Auto-save to issue
      saveMarkupTagsToIssue(updated);
      return updated;
    });
    setMarkupTagInput("");
  };

  const handleMarkupTagRemove = (tagToRemove) => {
    const removeKey = normalizeValue(tagToRemove).toLowerCase();
    setMarkupTagValues((previous) => {
      const updated = previous.filter((value) => value.toLowerCase() !== removeKey);
      // Auto-save to issue
      saveMarkupTagsToIssue(updated);
      return updated;
    });
  };

  const handleMarkupNavigate = (step) => {
    if (!markupNavigableIssues.length) return;

    const currentIndex = markupPopupIssueIndex;
    if (currentIndex < 0) {
      openMarkupPopupForIssue(markupNavigableIssues[0]);
      return;
    }

    const targetIndex = Math.min(
      Math.max(currentIndex + step, 0),
      markupNavigableIssues.length - 1
    );
    if (targetIndex === currentIndex) return;
    openMarkupPopupForIssue(markupNavigableIssues[targetIndex]);
  };

  useEffect(() => {
    if (!markupPopup.url) return;

    if (!markupNavigableIssues.length) {
      setMarkupPopup({ url: "", label: "", issueId: "", issueKey: "" });
      setMarkupPopupSize({ width: 960, height: 640 });
      setMarkupTagInput("");
      setMarkupTagValues([]);
      setSavingMarkupTags(false);
      return;
    }

    const currentVisibleIssue = markupNavigableIssues.find((issue) => issue.key === markupPopup.issueKey);
    if (currentVisibleIssue) return;

    const firstVisibleIssue = markupNavigableIssues[0];
    setMarkupPopupSize({ width: 960, height: 640 });
    setMarkupTagValues(parseTagValues(firstVisibleIssue.e2Tags));
    setMarkupTagInput("");
    setMarkupPopup({
      url: normalizeValue(firstVisibleIssue.markupLink),
      label: normalizeValue(firstVisibleIssue.markup || firstVisibleIssue.id),
      issueId: normalizeValue(firstVisibleIssue.id),
      issueKey: normalizeValue(firstVisibleIssue.key),
    });
  }, [markupPopup.url, markupPopup.issueKey, markupNavigableIssues]);

  useEffect(() => {
    if (!pendingTechDetailsIssueKey) return;

    const field = techDetailsFieldRefs.current[pendingTechDetailsIssueKey];
    if (!field) return;

    field.scrollIntoView({ behavior: "smooth", block: "center" });
    field.focus();
  }, [pendingTechDetailsIssueKey, visibleIssues]);

  const handleMarkupTagsSave = async () => {
    if (savingMarkupTags) return;

    const issue = issues.find((item) => item.key === markupPopup.issueKey);
    if (!id || !issue?.projectDocId) {
      toast.error("Could not update tags for this issue.");
      return;
    }

    const projectSource = projectSources[issue.projectDocId];
    if (!projectSource) {
      toast.error("Could not load project data for tags.");
      return;
    }

    const previousRows = Array.isArray(projectSource.rows) ? projectSource.rows : [];
    const previousFields = Array.isArray(projectSource.fields) ? projectSource.fields : [];
    const targetRow = previousRows[issue.rowIndex];
    if (!targetRow) {
      toast.error("Could not find issue row for tags.");
      return;
    }

    const previousRowData = targetRow?.rowData || {};
    const tagsFieldName = findFieldByAliases(previousFields, previousRowData, E2_TAGS_FIELD_ALIASES) || "E2 Tags";
    const pendingInput = normalizeValue(markupTagInput);
    const nextTagValues = pendingInput
      ? (() => {
          const exists = markupTagValues.some((value) => value.toLowerCase() === pendingInput.toLowerCase());
          return exists ? markupTagValues : [...markupTagValues, pendingInput];
        })()
      : markupTagValues;
    const nextValue = nextTagValues.join(", ");
    const previousValue = normalizeValue(previousRowData[tagsFieldName]);

    if (nextValue === previousValue) {
      toast.info("No tag changes to save.");
      return;
    }

    const updatedRowData = { ...previousRowData, [tagsFieldName]: nextValue };
    const updatedRows = previousRows.map((row, index) =>
      index === issue.rowIndex ? { ...row, rowData: updatedRowData } : row
    );
    const updatedFields = previousFields.includes(tagsFieldName) ? previousFields : [...previousFields, tagsFieldName];

    setSavingMarkupTags(true);

    try {
      await updateDoc(doc(db, "churches", id, "bimProjects", issue.projectDocId), {
        fields: updatedFields,
        rows: updatedRows,
        updatedAt: new Date(),
      });
      setMarkupTagValues(nextTagValues);
      setMarkupTagInput("");

      const requiresTechnicalDetails = nextTagValues.some(
        (tag) => normalizeValue(tag).toLowerCase() === "technical details"
      );
      if (requiresTechnicalDetails) {
        openTechDetailsRequiredInformationPopup(issue);
        toast.info(`E2 Tags saved. ${TECH_DETAILS_DISPLAY_LABEL} - Required Information opened.`);
        return;
      }

      toast.success("E2 Tags updated successfully.");
    } catch (error) {
      console.error("Error updating E2 Tags from markup popup:", error);
      toast.error("Could not update E2 Tags.");
    } finally {
      setSavingMarkupTags(false);
    }
  };

  const handleMarkupImageLoad = (event) => {
    const naturalWidth = Number(event.currentTarget?.naturalWidth || 0);
    const naturalHeight = Number(event.currentTarget?.naturalHeight || 0);
    if (!naturalWidth || !naturalHeight) return;

    const maxWidth = Math.floor((window.innerWidth || 1366) * 0.96);
    const maxHeight = Math.floor((window.innerHeight || 768) * 0.9) - 220;
    const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight, 1);

    setMarkupPopupSize({
      width: Math.max(360, Math.floor(naturalWidth * scale)),
      height: Math.max(240, Math.floor(naturalHeight * scale)),
    });
  };





  const saveTechDetailsPopupE2Comments = async () => {
    const issue = issues.find((item) => item.key === techDetailsPopup.issueKey);
    if (!id || !issue?.projectDocId) {
      toast.error("Could not save comments.");
      return;
    }

    setTechDetailsPopupSavingComments(true);

    try {
      const projectDoc = doc(db, "churches", id, "bimProjects", issue.projectDocId);
      const snapshot = await getDoc(projectDoc);
      const data = snapshot.data();
      const internalCardMeta = data?.internalCardMeta || {};

      internalCardMeta[issue.id] = internalCardMeta[issue.id] || {};
      internalCardMeta[issue.id].e2Comments = normalizeValue(techDetailsPopup.e2Comments);

      await updateDoc(projectDoc, { internalCardMeta });
      toast.success("E2 Comments saved.");
    } catch (err) {
      console.error("Error saving E2 Comments:", err);
      toast.error("Could not save E2 Comments.");
    } finally {
      setTechDetailsPopupSavingComments(false);
    }
  };

  const handleTechDetailsPopupDocumentUpload = async (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const issue = issues.find((item) => item.key === techDetailsPopup.issueKey);
    if (!id || !issue?.projectDocId) {
      toast.error("Issue data not fully loaded.");
      return;
    }

    const allowedCount = 3 - techDetailsPopup.e2Documents.length;
    if (allowedCount <= 0) {
      toast.warn("Maximum 3 documents allowed.");
      return;
    }

    const filesToUpload = Array.from(files).slice(0, allowedCount);
    if (filesToUpload.length < files.length) {
      toast.warn(`Only ${allowedCount} document(s) can be added.`);
    }

    setTechDetailsPopupUploadingDocuments(true);

    try {
      const uploadedDocs = [];

      for (const file of filesToUpload) {
        const safeCardKey = issue.id.replace(/[^a-zA-Z0-9-_]/g, "_");
        const ext = file.name.split(".").pop();
        const timestamp = Date.now();
        const storagePath = `churches/${id}/bimProjects/${issue.projectDocId}/e2-documents/${safeCardKey}/${timestamp}.${ext}`;
        const fileRef = storageRef(storage, storagePath);

        await uploadBytes(fileRef, file);
        const downloadURL = await getDownloadURL(fileRef);

        uploadedDocs.push({
          name: file.name,
          url: downloadURL,
          uploadedAt: new Date().toISOString(),
          storagePath,
        });
      }

      const projectDoc = doc(db, "churches", id, "bimProjects", issue.projectDocId);
      const snapshot = await getDoc(projectDoc);
      const data = snapshot.data();
      const internalCardMeta = data?.internalCardMeta || {};

      internalCardMeta[issue.id] = internalCardMeta[issue.id] || {};
      internalCardMeta[issue.id].e2Documents = [...(internalCardMeta[issue.id].e2Documents || []), ...uploadedDocs];

      await updateDoc(projectDoc, { internalCardMeta });

      setTechDetailsPopup((prev) => ({
        ...prev,
        e2Documents: [...prev.e2Documents, ...uploadedDocs],
      }));
      toast.success(`${uploadedDocs.length} document(s) uploaded.`);
    } catch (err) {
      console.error("Error uploading documents:", err);
      toast.error(err?.message || "Could not upload document(s).");
    } finally {
      setTechDetailsPopupUploadingDocuments(false);
      if (techDetailsPopupFileInputRef.current) {
        techDetailsPopupFileInputRef.current.value = "";
      }
    }
  };

  const deleteTechDetailsPopupDocument = async (index) => {
    if (index < 0 || index >= techDetailsPopup.e2Documents.length) return;

    const docToDelete = techDetailsPopup.e2Documents[index];
    const confirmed = window.confirm(`Delete "${docToDelete.name}"?`);
    if (!confirmed) return;

    setTechDetailsPopupSavingComments(true);

    try {
      const issue = issues.find((item) => item.key === techDetailsPopup.issueKey);
      if (!issue?.projectDocId) throw new Error("Issue not found");

      if (docToDelete.storagePath) {
        const fileRef = storageRef(storage, docToDelete.storagePath);
        await deleteObject(fileRef).catch((err) => {
          if (err.code !== "storage/object-not-found") throw err;
        });
      }

      const projectDoc = doc(db, "churches", id, "bimProjects", issue.projectDocId);
      const snapshot = await getDoc(projectDoc);
      const data = snapshot.data();
      const internalCardMeta = data?.internalCardMeta || {};

      internalCardMeta[issue.id] = internalCardMeta[issue.id] || {};
      const updatedDocs = internalCardMeta[issue.id].e2Documents || [];
      updatedDocs.splice(index, 1);
      internalCardMeta[issue.id].e2Documents = updatedDocs;

      await updateDoc(projectDoc, { internalCardMeta });

      setTechDetailsPopup((prev) => ({
        ...prev,
        e2Documents: prev.e2Documents.filter((_, i) => i !== index),
      }));
      toast.success("Document deleted.");
    } catch (err) {
      console.error("Error deleting document:", err);
      toast.error("Could not delete document.");
    } finally {
      setTechDetailsPopupSavingComments(false);
    }
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
              <h1 className="project-issue-title">Live Issues Tracker</h1>
              <div className="project-issue-last-update">
                {lastDailyIssuesUpdate ? `Last Update: ${lastDailyIssuesUpdate}` : "Last Update: --"}
                {" "}
                <span className="project-issue-time-range">{timeRangeDisplay}</span>
              </div>
              <div className="project-issue-active-filters">
                {[
                  selectedProjectName && `Project Name: ${selectedProjectName}`,
                  selectedIssueId && `Issue ID: ${selectedIssueId}`,
                  hasStatusFilter && `Status: ${selectedStatuses.join(", ")}`,
                  selectedE2Detailer && `E2 Lead Detailer: ${selectedE2Detailer}`,
                  selectedE2StatusUpdate && `E2 Status Update: ${selectedE2StatusUpdate}`,
                  selectedTechDetails && `${TECH_DETAILS_DISPLAY_LABEL}: ${selectedTechDetails}`,
                  hasE2TagFilter && `E2 Tags: ${selectedE2Tags.join(", ")}`,
                  globalSearch && `Search: ${globalSearch}`,
                ]
                  .filter(Boolean)
                  .join(" | ") || "No filters applied"}
              </div>
            </div>
            <div className="project-issue-head-actions">
              <input
                ref={dailyIssuesInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="project-issue-upload-input"
                onChange={handleDailyIssuesUpload}
              />
              <div className="project-issue-head-actions-stack">
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
                        Field Display Formatting
                      </Link>
                    </div>
                  </details>
                </div>
                <button type="button" className="project-issue-add-btn" onClick={openAddIssuePopup}>
                  Add New Issue
                </button>
                <Link
                  to={`/organization/${id}/e2-agile-board`}
                  className="project-issue-add-btn"
                >
                  🗂️ E2 Agile Board
                </Link>
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
                <div className="project-issue-summary-chart-heading">
                  <div className="project-issue-summary-chart-timeframe">{e2StatusUpdateTimeframeLabel}</div>
                </div>
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

                {overviewStatusCounts.length === 0 ? (
                    <div className="project-issue-summary-empty">No data</div>
                  ) : (
                    <div className="overview-vbar-group">
                      {overviewStatusCounts.map(({ rawStatus, label, count, backgroundColor }) => {
                        const pct = scopedIssueCount ? Math.max((count / scopedIssueCount) * 100, 2) : 0;
                        const fillStyle = { height: `${pct}%` };
                        if (backgroundColor) fillStyle.background = backgroundColor;
                        const displayPct = scopedIssueCount ? Math.round((count / scopedIssueCount) * 100) : 0;
                        const isFiltered = hasStatusFilter;
                        const isActive = !isFiltered || selectedStatusSet.has(normalizeValue(rawStatus).toLowerCase());
                        return (
                          <div
                            key={rawStatus}
                            className={`overview-vbar-col${isFiltered && isActive ? " is-highlighted" : ""}${isFiltered && !isActive ? " is-dimmed" : ""}`}
                            style={{ flex: `0 0 ${overviewBarColumnWidthPx}px`, width: `${overviewBarColumnWidthPx}px` }}
                          >
                            <span className="overview-vbar-count">{count}</span>
                            <span className="overview-vbar-pct">{displayPct}%</span>
                            <div className="overview-vbar-track">
                              <div className="overview-vbar-fill" style={fillStyle} />
                            </div>
                            <span className="overview-vbar-label">{label}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
              </div>
            )}

            {chartTab === "e2status" && (
              <div className="project-issue-e2status-grid" aria-label="E2 Status Update and E2 Tags summary charts">
                <div className="project-issue-summary-chart project-issue-summary-chart--e2status-section" aria-label="E2 Status Update summary chart">
                  <div className="project-issue-summary-chart-heading">
                    <div className="project-issue-summary-chart-title">Count by E2 Status Update</div>
                    <div className="project-issue-summary-chart-timeframe">{e2StatusUpdateTimeframeLabel}</div>
                  </div>
                  {e2StatusUpdateCounts.length === 0 ? (
                    <div className="project-issue-summary-empty">No data</div>
                  ) : (
                    (() => {
                      const e2StatusTotalCount = e2StatusUpdateCounts.reduce((sum, item) => sum + Number(item.count || 0), 0);
                      const hasE2StatusSelection = !!normalizeValue(selectedE2StatusChartTarget);
                      const selectedE2StatusLower = normalizeValue(selectedE2StatusChartTarget).toLowerCase();

                      return e2StatusUpdateCounts.map(({ label, count }) => {
                        const pct = e2StatusTotalCount ? Math.round((count / e2StatusTotalCount) * 100) : 0;
                        const isSelected = normalizeValue(label).toLowerCase() === selectedE2StatusLower;
                        const rowClassName = `project-issue-summary-row e2status-summary-row${hasE2StatusSelection && isSelected ? " is-highlighted" : ""}${hasE2StatusSelection && !isSelected ? " is-dimmed" : ""}`;
                        const e2Format = e2StatusUpdateFormatByLowerValue[label.toLowerCase()] || {};
                        const customBgColor = normalizeValue(e2Format.backgroundColor);
                        const barStyle = {
                          width: `${e2StatusTotalCount ? Math.max((count / e2StatusTotalCount) * 100, 2) : 0}%`,
                        };
                        if (customBgColor) {
                          barStyle.background = customBgColor;
                        }
                        return (
                          <button
                            key={label}
                            type="button"
                            className={`${rowClassName} project-issue-summary-track-link`}
                            onClick={() => {
                              setSelectedE2StatusChartTarget((previous) =>
                                normalizeValue(previous).toLowerCase() === normalizeValue(label).toLowerCase() ? "" : label
                              );
                            }}
                            aria-pressed={isSelected}
                            title={`Show E2 tag counts for ${label}`}
                          >
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
                          </button>
                        );
                      });
                    })()
                  )}
                </div>

                <div className="project-issue-summary-chart project-issue-summary-chart--e2status-section" aria-label="E2 Tags summary chart">
                  <div className="project-issue-summary-chart-heading">
                    <div className="project-issue-summary-chart-title">Count by E2 Tags</div>
                    <div className="project-issue-summary-chart-timeframe">
                      {normalizeValue(selectedE2StatusChartTarget)
                        ? `Target: ${selectedE2StatusChartTarget} | ${e2StatusUpdateTimeframeLabel}`
                        : e2StatusUpdateTimeframeLabel}
                    </div>
                  </div>
                  {e2TagCounts.length === 0 ? (
                    <div className="project-issue-summary-empty">No data</div>
                  ) : (
                    (() => {
                      const e2TagTotalCount = e2TagCounts.reduce((sum, item) => sum + Number(item.count || 0), 0);
                      return e2TagCounts.map(({ label, count }) => {
                        const pct = e2TagTotalCount ? Math.round((count / e2TagTotalCount) * 100) : 0;
                        const barStyle = {
                          width: `${e2TagTotalCount ? Math.max((count / e2TagTotalCount) * 100, 2) : 0}%`,
                        };
                        return (
                          <div key={label} className="project-issue-summary-row e2tags-summary-row">
                            <div className="project-issue-summary-meta">
                              <span>{label}</span>
                              <span className="project-issue-summary-count-pct">
                                <strong>{count}</strong>
                                <span className="project-issue-summary-pct">{pct}%</span>
                              </span>
                            </div>
                            <div className="project-issue-summary-track">
                              <div
                                className="project-issue-summary-fill is-e2tags"
                                style={barStyle}
                              />
                            </div>
                          </div>
                        );
                      });
                    })()
                  )}
                </div>
              </div>
            )}

            {chartTab === "trend" && (() => {
              const isYtdTrend = selectedDateRange === "YTD";
              const maxCount = Math.max(...trendChartBuckets.map((b) => b.count), 1);
              const chartWidth = Math.max(trendChartBuckets.length * 54, 520);
              const chartHeight = 200;
              const padding = { top: 14, right: 14, bottom: 36, left: 34 };
              const innerWidth = chartWidth - padding.left - padding.right;
              const innerHeight = chartHeight - padding.top - padding.bottom;
              const pointCount = trendChartBuckets.length;
              const points = trendChartBuckets.map((bucket, index) => {
                const x =
                  pointCount <= 1
                    ? padding.left + innerWidth / 2
                    : padding.left + (index / (pointCount - 1)) * innerWidth;
                const y = padding.top + (1 - bucket.count / maxCount) * innerHeight;
                return { ...bucket, x, y };
              });

              const linePath = points.length
                ? points.reduce((path, point, index) => {
                    if (index === 0) {
                      return `M ${point.x} ${point.y}`;
                    }
                    const prev = points[index - 1];
                    const controlX = (prev.x + point.x) / 2;
                    return `${path} C ${controlX} ${prev.y}, ${controlX} ${point.y}, ${point.x} ${point.y}`;
                  }, "")
                : "";
              const yTicks = [0, 0.25, 0.5, 0.75, 1].map((step) => {
                const value = Math.round(maxCount * step);
                const y = padding.top + (1 - step) * innerHeight;
                return { value, y };
              });

              return (
                <div className="project-issue-summary-chart project-issue-trend-chart" aria-label="Trending chart">
                  {trendChartBuckets.length === 0 ? (
                    <div className="project-issue-summary-empty">No data for the selected period</div>
                  ) : (
                    isYtdTrend ? (
                      <div className="project-issue-trend-ytd-wrap">
                        <div className="project-issue-trend-ytd-bars">
                          {(() => {
                            const totalsByProject = trendChartBuckets.reduce((acc, bucket) => {
                              Object.entries(bucket.projectCounts || {}).forEach(([projectName, count]) => {
                                acc[projectName] = (acc[projectName] || 0) + count;
                              });
                              return acc;
                            }, {});

                            const ytdProjects = Object.entries(totalsByProject)
                              .sort((a, b) => b[1] - a[1])
                              .map(([projectName]) => projectName);

                            return trendChartBuckets.map((bucket) => {
                              const totalBarHeight = maxCount ? (bucket.count / maxCount) * 100 : 0;
                              return (
                                <div className="project-issue-trend-ytd-col" key={bucket.key}>
                                  <div className="project-issue-trend-ytd-bars-pair">
                                    <div className="project-issue-trend-ytd-total-side">
                                      <span className="project-issue-trend-ytd-count">{bucket.count}</span>
                                      <div className="project-issue-trend-ytd-bar-wrap project-issue-trend-ytd-bar-total">
                                        <div
                                          className="project-issue-trend-ytd-bar-segment"
                                          style={{ height: `${totalBarHeight}%`, backgroundColor: "#94a3b8" }}
                                          title={`Total: ${bucket.count}`}
                                        />
                                      </div>
                                    </div>
                                    <div className="project-issue-trend-ytd-stacked-side">
                                      <span className="project-issue-trend-ytd-count" style={{ visibility: "hidden" }}>0</span>
                                      <div className="project-issue-trend-ytd-bar-wrap">
                                        {ytdProjects.map((projectName, projectIndex) => {
                                          const projectCount = bucket.projectCounts?.[projectName] || 0;
                                          if (!projectCount) return null;
                                          const segmentHeight = maxCount ? (projectCount / maxCount) * 100 : 0;
                                          const pct = bucket.count ? Math.round((projectCount / bucket.count) * 100) : 0;
                                          const projectFmt = managedProjectNameFormats[normalizeValue(projectName)] || {};
                                          const segmentColor = projectFmt.backgroundColor || PIE_FALLBACK_COLORS[projectIndex % PIE_FALLBACK_COLORS.length];
                                          const textColor = projectFmt.textColor || "#ffffff";
                                          return (
                                            <div
                                              key={`${bucket.key}-${projectName}`}
                                              className="project-issue-trend-ytd-bar-segment"
                                              style={{ height: `${segmentHeight}%`, backgroundColor: segmentColor }}
                                              title={`${projectName}: ${projectCount} (${pct}%)`}
                                            >
                                              {segmentHeight >= 14 && (
                                                <div className="project-issue-trend-ytd-seg-label" style={{ color: textColor }}>
                                                  <span>{projectCount}</span>
                                                  <span>{pct}%</span>
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  </div>
                                  <span className="project-issue-trend-ytd-label">{bucket.label}</span>
                                </div>
                              );
                            });
                          })()}
                        </div>
                        <div className="project-issue-trend-ytd-legend">
                          {(() => {
                            const totalsByProject = trendChartBuckets.reduce((acc, bucket) => {
                              Object.entries(bucket.projectCounts || {}).forEach(([projectName, count]) => {
                                acc[projectName] = (acc[projectName] || 0) + count;
                              });
                              return acc;
                            }, {});

                            return Object.entries(totalsByProject)
                              .sort((a, b) => b[1] - a[1])
                              .map(([projectName], projectIndex) => {
                                const projectFmt = managedProjectNameFormats[normalizeValue(projectName)] || {};
                                const swatchColor = projectFmt.backgroundColor || PIE_FALLBACK_COLORS[projectIndex % PIE_FALLBACK_COLORS.length];
                                return (
                                  <span className="project-issue-trend-ytd-legend-item" key={projectName}>
                                    <span
                                      className="project-issue-trend-ytd-legend-swatch"
                                      style={{ backgroundColor: swatchColor }}
                                    />
                                    <span className="project-issue-trend-ytd-legend-text">{projectName}</span>
                                  </span>
                                );
                              });
                          })()}
                        </div>
                      </div>
                    ) : (
                      <div className="project-issue-trend-line-wrap">
                        <svg
                          className="project-issue-trend-line-svg"
                          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                          role="img"
                          aria-label="Issue trend line chart"
                          preserveAspectRatio="none"
                        >
                          {yTicks.map((tick) => (
                            <g key={`tick-${tick.value}`}>
                              <line
                                x1={padding.left}
                                y1={tick.y}
                                x2={chartWidth - padding.right}
                                y2={tick.y}
                                className="project-issue-trend-grid-line"
                              />
                              <text
                                x={padding.left - 8}
                                y={tick.y + 3}
                                textAnchor="end"
                                className="project-issue-trend-axis-label"
                              >
                                {tick.value}
                              </text>
                            </g>
                          ))}

                          <path d={linePath} className="project-issue-trend-line" fill="none" />

                          {points.map((point) => (
                            <g key={point.key}>
                              <circle cx={point.x} cy={point.y} r="4" className="project-issue-trend-point" />
                              <text
                                x={point.x}
                                y={Math.max(point.y - 8, 10)}
                                textAnchor="middle"
                                className="project-issue-trend-point-value"
                              >
                                {point.count}
                              </text>
                              <text
                                x={point.x}
                                y={chartHeight - 18}
                                textAnchor="middle"
                                className="project-issue-trend-x-label"
                              >
                                {point.label}
                                {(selectedDateRange === "TW" || selectedDateRange === "MTD") && point.dayLabel ? (
                                  <tspan x={point.x} dy="10" className="project-issue-trend-x-label-day">
                                    {point.dayLabel}
                                  </tspan>
                                ) : null}
                              </text>
                            </g>
                          ))}
                        </svg>
                      </div>
                    )
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        <div className="project-issue-filters">
          <div className="project-issue-filter project-issue-filter--visibility">
            <details className="project-issue-filter-visibility" ref={manageFiltersRef}>
              <summary className="project-issue-filter-trigger">
                <span className="project-issue-filter-accordion-label">
                  Manage Filters ({visibleFilterCount}/9)
                </span>
                <span className="project-issue-filter-accordion-icon" aria-hidden="true">▾</span>
              </summary>
              <div className="project-issue-filter-panel">
                <div className="project-issue-filter-options">
                  <label className="project-issue-filter-option">
                    <input
                      type="checkbox"
                      className="project-issue-filter-checkbox"
                      checked={!!filterVisibility.projectName}
                      onChange={() => toggleFilterVisibility("projectName")}
                    />
                    <span>Project Name</span>
                  </label>
                  <label className="project-issue-filter-option">
                    <input
                      type="checkbox"
                      className="project-issue-filter-checkbox"
                      checked={!!filterVisibility.status}
                      onChange={() => toggleFilterVisibility("status")}
                    />
                    <span>Status</span>
                  </label>
                  <label className="project-issue-filter-option">
                    <input
                      type="checkbox"
                      className="project-issue-filter-checkbox"
                      checked={!!filterVisibility.issueId}
                      onChange={() => toggleFilterVisibility("issueId")}
                    />
                    <span>Issue ID</span>
                  </label>
                  <label className="project-issue-filter-option">
                    <input
                      type="checkbox"
                      className="project-issue-filter-checkbox"
                      checked={!!filterVisibility.e2LeadDetailer}
                      onChange={() => toggleFilterVisibility("e2LeadDetailer")}
                    />
                    <span>E2 Lead Detailer</span>
                  </label>
                  <label className="project-issue-filter-option">
                    <input
                      type="checkbox"
                      className="project-issue-filter-checkbox"
                      checked={!!filterVisibility.e2StatusUpdate}
                      onChange={() => toggleFilterVisibility("e2StatusUpdate")}
                    />
                    <span>E2 Status Update</span>
                  </label>
                  <label className="project-issue-filter-option">
                    <input
                      type="checkbox"
                      className="project-issue-filter-checkbox"
                      checked={!!filterVisibility.techDetails}
                      onChange={() => toggleFilterVisibility("techDetails")}
                    />
                    <span>{TECH_DETAILS_DISPLAY_LABEL}</span>
                  </label>
                  <label className="project-issue-filter-option">
                    <input
                      type="checkbox"
                      className="project-issue-filter-checkbox"
                      checked={!!filterVisibility.e2Tags}
                      onChange={() => toggleFilterVisibility("e2Tags")}
                    />
                    <span>E2 Tags</span>
                  </label>
                  <label className="project-issue-filter-option">
                    <input
                      type="checkbox"
                      className="project-issue-filter-checkbox"
                      checked={!!filterVisibility.statusUpdateDate}
                      onChange={() => toggleFilterVisibility("statusUpdateDate")}
                    />
                    <span>Status Update Date</span>
                  </label>
                  <label className="project-issue-filter-option">
                    <input
                      type="checkbox"
                      className="project-issue-filter-checkbox"
                      checked={!!filterVisibility.globalSearch}
                      onChange={() => toggleFilterVisibility("globalSearch")}
                    />
                    <span>Search</span>
                  </label>
                </div>
                <div className="project-issue-filter-actions">
                  <button
                    type="button"
                    className="project-issue-filter-clear"
                    onClick={() => setAllFiltersVisibility(true)}
                  >
                    Show all
                  </button>
                  <button
                    type="button"
                    className="project-issue-filter-clear"
                    onClick={() => setAllFiltersVisibility(false)}
                  >
                    Hide all
                  </button>
                  <button
                    type="button"
                    className="project-issue-filter-clear"
                    onClick={closeManageFilters}
                  >
                    Done
                  </button>
                </div>
              </div>
            </details>
          </div>

          {filterVisibility.projectName && (
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
          )}

          {filterVisibility.issueId && (
          <div className="project-issue-filter">
            <input
              type="text"
              className="project-issue-global-search"
              list="project-issue-id-options"
              placeholder="Filter Issue ID"
              value={selectedIssueId}
              onChange={(event) => setSelectedIssueId(event.target.value)}
              aria-label="Filter Issue ID"
            />
            <datalist id="project-issue-id-options">
              {issueIdOptions.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </div>
          )}

          {filterVisibility.status && (
          <div className="project-issue-filter">
            <details className="project-issue-filter-visibility" ref={statusFilterRef}>
              <summary className={`project-issue-filter-trigger ${hasStatusFilter ? "is-selected" : ""}`}>
                <span className="project-issue-filter-accordion-label">
                  {hasStatusFilter ? `Status: ${selectedStatuses.join(", ")}` : "Filter Status"}
                </span>
                <span className="project-issue-filter-accordion-icon" aria-hidden="true">▾</span>
              </summary>
              <div className="project-issue-filter-panel">
                <div className="project-issue-filter-options">
                  {statusFilterOptions.map((statusValue) => {
                    const checked = selectedStatusSet.has(normalizeValue(statusValue).toLowerCase());
                    return (
                      <label key={statusValue} className="project-issue-filter-option">
                        <input
                          type="checkbox"
                          className="project-issue-filter-checkbox"
                          checked={checked}
                          onChange={() => toggleStatusSelection(statusValue)}
                        />
                        <span>{statusValue}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="project-issue-filter-actions">
                  <button
                    type="button"
                    className="project-issue-filter-clear"
                    onClick={() => setActiveTab(serializeStatusFilterParam(statusFilterOptions))}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="project-issue-filter-clear"
                    onClick={() => setActiveTab("")}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    className="project-issue-filter-clear"
                    onClick={closeStatusFilter}
                  >
                    Done
                  </button>
                </div>
              </div>
            </details>
          </div>
          )}

          {filterVisibility.e2LeadDetailer && (
          <div className="project-issue-filter">
            <select
              className={`project-issue-filter-trigger ${selectedE2Detailer ? "is-selected" : ""}`}
              value={selectedE2Detailer}
              onChange={(event) => setSelectedE2Detailer(event.target.value)}
              aria-label="Filter E2 Lead Detailer"
            >
              <option value="">Filter E2 Lead Detailer</option>
              {e2DetailerOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          )}

          {filterVisibility.e2StatusUpdate && (
          <div className="project-issue-filter">
            <select
              className={`project-issue-filter-trigger ${selectedE2StatusUpdate ? "is-selected" : ""}`}
              value={selectedE2StatusUpdate}
              onChange={(event) => setSelectedE2StatusUpdate(event.target.value)}
              aria-label="Filter E2 Status Update"
            >
              <option value="">Filter E2 Status Update</option>
              {e2StatusUpdateOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          )}

          {filterVisibility.techDetails && (
          <div className="project-issue-filter">
            <select
              className={`project-issue-filter-trigger ${selectedTechDetails ? "is-selected" : ""}`}
              value={selectedTechDetails}
              onChange={(event) => setSelectedTechDetails(event.target.value)}
              aria-label={`Filter ${TECH_DETAILS_DISPLAY_LABEL}`}
            >
              <option value="">{`Filter ${TECH_DETAILS_DISPLAY_LABEL}`}</option>
              {techDetailsOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          )}

          {filterVisibility.e2Tags && (
          <div className="project-issue-e2tags-filter" aria-label="Filter E2 Tags">
            <div className="project-issue-e2tags-filter-head">
              <span className="project-issue-e2tags-filter-title">E2 Tags</span>
              {hasE2TagFilter ? (
                <button
                  type="button"
                  className="project-issue-e2tags-filter-clear"
                  onClick={() => setSelectedE2Tags([])}
                >
                  Clear
                </button>
              ) : null}
            </div>
            <div className="project-issue-e2tags-pills" role="group" aria-label="E2 tag options">
              {e2TagFilterOptions.length === 0 ? (
                <span className="project-issue-filter-empty">No E2 tags found</span>
              ) : (
                e2TagFilterOptions.map(({ label, count }) => {
                  const normalizedLabel = normalizeValue(label).toLowerCase();
                  const isActive = selectedE2TagSet.has(normalizedLabel);
                  return (
                    <button
                      key={label}
                      type="button"
                      className={`project-issue-e2tags-pill${isActive ? " is-active" : ""}`}
                      onClick={() => {
                        setSelectedE2Tags((previous) => {
                          const exists = previous.some((value) => normalizeValue(value).toLowerCase() === normalizedLabel);
                          return exists
                            ? previous.filter((value) => normalizeValue(value).toLowerCase() !== normalizedLabel)
                            : [...previous, label];
                        });
                      }}
                      aria-pressed={isActive}
                      title={`Filter by ${label}`}
                    >
                      <span className="project-issue-e2tags-pill-label">{label}</span>
                      <span className="project-issue-e2tags-pill-count">{count}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
          )}

          {filterVisibility.statusUpdateDate && (
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
          )}

          {filterVisibility.globalSearch && (
            <input
              type="text"
              className="project-issue-global-search"
              placeholder="Search any text, letter, ID, owner, zone..."
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
            />
          )}
        </div>

        <div className="project-issue-table-shell">
          <table className="project-issue-table">
            <thead>
              <tr>
                {visibleColumns.has("Issue ID") && (
                  <th>
                    <span className="project-issue-th-with-tools">
                      <span>Issue ID</span>
                      <button
                        type="button"
                        className="project-issue-th-tools-btn"
                        onClick={() => setShowColumnVisibilityPopup(true)}
                        aria-label="Manage column visibility"
                        title="Show/hide columns"
                      >
                        <FaCog aria-hidden="true" className="project-issue-th-tools-icon" />
                      </button>
                    </span>
                  </th>
                )}
                {visibleColumns.has("Title") && <th>Title</th>}
                {visibleColumns.has("Project Name") && <th>Project Name</th>}
                {visibleColumns.has("Markup") && <th>Markup</th>}
                {visibleColumns.has("E2 Tags") && <th>E2 Tags</th>}
                {visibleColumns.has("Status") && <th style={{ width: `${statusColumnWidthCh}ch`, minWidth: `${statusColumnWidthCh}ch` }}>Status</th>}
                {visibleColumns.has("E2 Status Update") && (
                  <th>
                    <span className="project-issue-th-with-info">
                      <span>E2 Status Update</span>
                      <button
                        type="button"
                        className="project-issue-th-info-btn"
                        onClick={() => setShowE2StatusInfoPopup(true)}
                        aria-label="Show E2 Status Update information"
                        title="Status definitions"
                      >
                        <FaInfoCircle aria-hidden="true" className="project-issue-th-info-icon" />
                      </button>
                    </span>
                  </th>
                )}
                {/* Priority column removed */}
                {visibleColumns.has("Due Date") && <th>Due Date</th>}
                {visibleColumns.has("Disable Flag") && <th>Disable Flag</th>}
                {visibleColumns.has("Technical Direction") && <th>Technical Direction</th>}
                {visibleColumns.has("E2 TD") && <th>E2 TD</th>}
                {visibleColumns.has("Days Since Created") && <th>Days Since Created</th>}
                {visibleColumns.has("E2 Lead Detailer") && <th>E2 Lead Detailer</th>}
                {visibleColumns.has("E2 Detailer Support Team") && <th>E2 Detailer Support Team</th>}
                {visibleColumns.has(TECH_DETAILS_DISPLAY_LABEL) && <th>{TECH_DETAILS_DISPLAY_LABEL}</th>}
                {visibleColumns.has("Status Update Date") && <th>Status Update<br />Date</th>}
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={visibleColumns.size} className="project-issue-empty">
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
                const projectNameDisplay = getProjectNameDisplay(issue);

                return (
                <tr key={rowKey} style={normalizeValue(issue.disableFlag) === "Yes" ? { background: 'linear-gradient(90deg, #e0f2fe 60%, #e5e7eb 100%)', opacity: 0.6, pointerEvents: 'none' } : {}}>
                  {visibleColumns.has("Issue ID") && (
                    <td data-label="Issue ID">
                      <Link
                        to={`/organization/${id}/project-issue-dashboard/issue/${issue.projectDocId}/${encodeURIComponent(issue.id)}`}
                        className="project-issue-id-link"
                      >
                        <span className="project-issue-issue-id">{normalizeIssueIdDisplay(issue.id)}</span>
                      </Link>
                    </td>
                  )}
                  {visibleColumns.has("Title") && <td data-label="Title">{issue.title}</td>}
                  {visibleColumns.has("Project Name") && <td data-label="Project Name">{projectNameDisplay}</td>}
                  {visibleColumns.has("Markup") && (
                    <td data-label="Markup">
                      {issue.markupLink ? (
                        <button
                          type="button"
                          className="project-issue-markup-thumb-btn"
                          onClick={(event) => {
                            event.preventDefault();
                            openMarkupPopupForIssue(issue);
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
                  )}
                  {visibleColumns.has("E2 Tags") && <td data-label="E2 Tags">{normalizeValue(issue.e2Tags) || "-"}</td>}
                  {visibleColumns.has("Status") && (
                    <td
                      data-label="Status"
                      style={{ width: `${statusColumnWidthCh}ch`, minWidth: `${statusColumnWidthCh}ch` }}
                    >
                      <span className={`issue-status issue-status-${statusClassName}`} style={statusStyle}>
                        {statusDisplayText}
                      </span>
                    </td>
                  )}
                  {visibleColumns.has("E2 Status Update") && (
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
                  )}
                  {/* Priority column removed */}
                  {visibleColumns.has("Due Date") && <td data-label="Due Date">{formatDueDateMMDDYY(issue.dueDate)}</td>}
                  {visibleColumns.has("Disable Flag") && <td data-label="Disable Flag">{issue.disableFlag}</td>}
                  {visibleColumns.has("Technical Direction") && <td data-label="Technical Direction">{issue.technicalDirection}</td>}
                  {visibleColumns.has("E2 TD") && (
                    <td data-label="E2 TD">
                      {e2InfoEditMode ? (
                        <select
                          className="project-issue-cell-input"
                          value={issue.e2TD || "--"}
                          onChange={event => {
                            const nextValue = event.target.value;
                            handleE2TDChange(issue.key, nextValue);
                            handleE2TDSave({ ...issue, e2TD: nextValue }, nextValue);
                          }}
                          disabled={!!savingIssueKeys[`e2TD:${issue.key}`]}
                        >
                          {E2_TD_OPTIONS.map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : (
                        issue.e2TD || "--"
                      )}
                    </td>
                  )}

                  {visibleColumns.has("Days Since Created") && <td data-label="Days Since Created">{calculateDaysSinceCreated(issue.createdAt)}</td>}
                  <td>
                    <button
                      type="button"
                      className="project-issue-td-edit-icon-btn"
                      title="Add/Edit Technical Details"
                      onClick={() => openTechDetailsRequiredInformationPopup(issue)}
                      style={{ background: 'none', border: 'none', padding: 0, margin: 0, cursor: 'pointer' }}
                    >
                      <FaEdit style={{ fontSize: '1.1em', color: '#2563eb' }} />
                    </button>
                    <button
                      type="button"
                      className="project-issue-td-send-agile-btn"
                      title="Send to Agile Dashboard"
                      style={{ background: 'none', border: 'none', padding: 0, marginLeft: 8, cursor: 'pointer' }}
                      onClick={() => handleSendToAgileDashboard(issue)}
                    >
                      <FaShareSquare style={{ fontSize: '1.1em', color: '#10b981' }} />
                    </button>
                  </td>
                  {visibleColumns.has("E2 Lead Detailer") && (
                    <td data-label="E2 Lead Detailer">
                      <select
                        className="project-issue-cell-input"
                        value={issue.e2Detailer}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          if (isDetailerInSupportTeam(nextValue, issue.e2DetailerSupportTeam)) {
                            openDetailerConflictPopup(nextValue);
                            return;
                          }
                          handleE2DetailerChange(issue.key, nextValue);
                          handleE2DetailerSave({ ...issue, e2Detailer: nextValue }, nextValue);
                        }}
                        disabled={!!savingIssueKeys[issue.key]}
                      >
                        <option value="">Select E2 Lead Detailer</option>
                        {e2DetailerOptions.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
                  {visibleColumns.has("E2 Detailer Support Team") && (
                    <td data-label="E2 Detailer Support Team">
                      {(() => {
                        const selectedValues = sanitizeSupportTeamValues(issue.e2DetailerSupportTeam, e2DetailerOptions);
                        const selectedLabel = selectedValues.join(", ") || "Select support team";
                        const isSaving = !!savingIssueKeys[`supportteam:${issue.key}`];
                        const isOpen = openSupportTeamMenuKey === issue.key;

                        return (
                          <div className="project-issue-support-team-dropdown">
                            <button
                              type="button"
                              className="project-issue-support-team-trigger"
                              aria-label="Select E2 Detailer Support Team"
                              onClick={() => setOpenSupportTeamMenuKey((previous) => (previous === issue.key ? "" : issue.key))}
                              disabled={isSaving}
                            >
                              <span className="project-issue-support-team-text">{selectedLabel}</span>
                            </button>
                            {isOpen ? (
                            <div
                              className="project-issue-support-team-menu"
                              style={{ width: `${supportTeamMenuWidthCh}ch` }}
                            >
                              <div className="project-issue-support-team-menu-options">
                              {e2DetailerOptions.map((name) => {
                                const isChecked = selectedValues.some(
                                  (item) => item.toLowerCase() === name.toLowerCase()
                                );
                                const isCurrentDetailer =
                                  normalizeValue(issue.e2Detailer).toLowerCase() === name.toLowerCase();
                                return (
                                  <button
                                    key={name}
                                    type="button"
                                    className={`project-issue-support-team-option${
                                      isChecked ? " is-selected" : ""
                                    }${
                                      isCurrentDetailer ? " is-disabled" : ""
                                    }`}
                                    disabled={isSaving || isCurrentDetailer}
                                    onClick={() => {
                                      const currentValues = sanitizeSupportTeamValues(
                                        issue.e2DetailerSupportTeam,
                                        e2DetailerOptions
                                      );
                                      const nextValues = currentValues.some(
                                        (item) => item.toLowerCase() === name.toLowerCase()
                                      )
                                        ? currentValues.filter((item) => item.toLowerCase() !== name.toLowerCase())
                                        : [...currentValues, name];
                                      handleE2DetailerSupportTeamChange(issue.key, nextValues);
                                      handleE2DetailerSupportTeamSave(
                                        { ...issue, e2DetailerSupportTeam: formatSupportTeamValue(nextValues) },
                                        nextValues
                                      );
                                    }}
                                  >
                                    <span>{name}</span>
                                  </button>
                                );
                              })}
                              </div>
                              <div className="project-issue-support-team-menu-footer">
                                <button
                                  type="button"
                                  className="project-issue-support-team-done-btn"
                                  onClick={() => setOpenSupportTeamMenuKey("")}
                                >
                                  {selectedValues.length > 0 ? `Done (${selectedValues.length} selected)` : "Done"}
                                </button>
                              </div>
                            </div>
                            ) : null}
                          </div>
                        );
                      })()}
                    </td>
                  )}
                  {visibleColumns.has(TECH_DETAILS_DISPLAY_LABEL) && (
                  <td data-label={TECH_DETAILS_DISPLAY_LABEL}>
                    <select
                      ref={(element) => {
                        techDetailsFieldRefs.current[issue.key] = element;
                      }}
                      className={`project-issue-cell-input${pendingTechDetailsIssueKey === issue.key ? " project-issue-cell-input-pending" : ""}`}
                      value={getDefaultTechDetailsAvailable(issue.techDetailsAvailable)}
                      onChange={(event) => {
                        handleTechDetailsSelectChange(issue, event.target.value);
                      }}
                      disabled={!!savingIssueKeys[`techdetails:${issue.key}`]}
                    >
                      <option value="No">No</option>
                      <option value="Yes">Yes</option>
                    </select>
                  </td>
                  )}
                  {visibleColumns.has("Status Update Date") && (
                  <td data-label="Status Update Date">
                    <input
                      type="text"
                      className="project-issue-cell-input"
                      placeholder="MM/DD/YY HH:mm:ss"
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
                  )}
                </tr>
              );
              })}
              {!loading && !visibleIssues.length ? (
                <tr>
                  <td colSpan={visibleColumns.size} className="project-issue-empty">
                    No issues in this tab.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {showColumnVisibilityPopup ? (
          <div
            className="project-issue-popup-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Column visibility settings"
            onClick={() => setShowColumnVisibilityPopup(false)}
          >
            <div className="project-issue-column-visibility-popup" onClick={(event) => event.stopPropagation()}>
              <div className="project-issue-column-visibility-header">
                <strong>Show/Hide Columns</strong>
                <button
                  type="button"
                  className="project-issue-popup-close"
                  onClick={() => setShowColumnVisibilityPopup(false)}
                  aria-label="Close column visibility popup"
                >
                  ×
                </button>
              </div>
              <div className="project-issue-column-visibility-body">
                {AVAILABLE_COLUMNS.map((columnName) => (
                  <label key={columnName} className="project-issue-column-visibility-label">
                    <input
                      type="checkbox"
                      checked={visibleColumns.has(columnName)}
                      onChange={() => toggleColumnVisibility(columnName)}
                      className="project-issue-column-visibility-checkbox"
                    />
                    <span>{columnName}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        ) : null}
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
              height: "auto",
              maxHeight: "94vh",
            }}
          >
            <div className="project-issue-popup-head">
              <div className="project-issue-popup-title-group">
                <strong className="project-issue-popup-title">
                  Issue ID: <span className="project-issue-popup-title-value">{normalizeIssueIdDisplay(markupPopup.issueId || markupPopup.label) || "-"}</span>
                </strong>
                <div className="project-issue-popup-meta-row">
                  <span className="project-issue-popup-title-status">
                    E2 Status Update: <span className="project-issue-popup-title-value">{getDefaultE2StatusUpdate(currentMarkupPopupIssue?.e2StatusUpdate) || "-"}</span>
                  </span>
                  <span className="project-issue-popup-title-status">
                    Tags: <span className="project-issue-popup-title-value">{normalizeValue(currentMarkupPopupIssue?.tags) || "-"}</span>
                  </span>
                  <span className="project-issue-popup-title-status">
                    Grid: <span className="project-issue-popup-title-value">{normalizeValue(currentMarkupPopupIssue?.grid) || "-"}</span>
                  </span>
                  <span className="project-issue-popup-title-status">
                    Level: <span className="project-issue-popup-title-value">{normalizeValue(currentMarkupPopupIssue?.level) || "-"}</span>
                  </span>
                  <span className="project-issue-popup-title-status">
                    Room: <span className="project-issue-popup-title-value">{normalizeValue(currentMarkupPopupIssue?.room) || "-"}</span>
                  </span>
                  <span className="project-issue-popup-title-status">
                    Zone: <span className="project-issue-popup-title-value">{normalizeValue(currentMarkupPopupIssue?.zone) || "-"}</span>
                  </span>
                </div>
              </div>
              <div className="project-issue-popup-head-actions">
                <span className="project-issue-popup-nav-index">
                  {markupPopupIssueIndex >= 0 ? `${markupPopupIssueIndex + 1} / ${markupNavigableIssues.length}` : `0 / ${markupNavigableIssues.length}`}
                </span>
                <button
                  type="button"
                  className="project-issue-popup-nav-btn"
                  onClick={() => handleMarkupNavigate(-1)}
                  disabled={!canNavigateMarkupPrev}
                  aria-label="Previous markup"
                >
                  ←
                </button>
                <button
                  type="button"
                  className="project-issue-popup-nav-btn"
                  onClick={() => handleMarkupNavigate(1)}
                  disabled={!canNavigateMarkupNext}
                  aria-label="Next markup"
                >
                  →
                </button>
                <button type="button" className="project-issue-popup-close" onClick={closeMarkupPopup}>
                  Close
                </button>
              </div>
            </div>
            <img
              src={markupPopup.url}
              alt={markupPopup.label || "Markup"}
              className="project-issue-popup-image"
              onLoad={handleMarkupImageLoad}
              style={{ height: `${markupPopupSize.height}px` }}
            />
            <div className="project-issue-popup-tags-row">
              <label className="project-issue-popup-tags-label" htmlFor="markup-e2-tags-input">E2 Tags</label>
              <div className="project-issue-popup-tags-editor">
                <div className="project-issue-popup-tags-chips">
                  {markupTagValues.length ? (
                    markupTagValues.map((tag) => (
                      <span className="project-issue-popup-tag-chip" key={tag}>
                        <span>{tag}</span>
                        <button
                          type="button"
                          className="project-issue-popup-tag-remove"
                          onClick={() => handleMarkupTagRemove(tag)}
                          disabled={savingMarkupTags}
                          aria-label={`Remove tag ${tag}`}
                        >
                          ×
                        </button>
                      </span>
                    ))
                  ) : (
                    <span className="project-issue-popup-tags-empty">No E2 Tags selected</span>
                  )}
                </div>

                <div className="project-issue-popup-tags-edit">
                  <input
                    id="markup-e2-tags-input"
                    type="text"
                    className="project-issue-tags-input"
                    list="project-issue-e2-tags-suggestions"
                    value={markupTagInput}
                    onChange={(event) => setMarkupTagInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === "," || event.key === ";") {
                        event.preventDefault();
                        handleMarkupTagAdd();
                      }
                    }}
                    placeholder="Type a tag and press Enter"
                    disabled={savingMarkupTags}
                  />
                  <button
                    type="button"
                    className="project-issue-popup-tag-add-btn"
                    onClick={() => handleMarkupTagAdd()}
                    disabled={savingMarkupTags || !normalizeValue(markupTagInput)}
                  >
                    {savingMarkupTags ? "..." : "Add"}
                  </button>
                </div>

                {markupPopupTagSuggestions.length ? (
                  <div className="project-issue-popup-tags-suggestions">
                    {markupPopupTagSuggestions.slice(0, 10).map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className="project-issue-popup-tag-suggestion"
                        onClick={() => handleMarkupTagAdd(tag)}
                        disabled={savingMarkupTags}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
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

      {showE2StatusInfoPopup ? (
        <div
          className="project-issue-popup-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="E2 Status Update information"
          onClick={() => { if (!e2InfoEditMode) setShowE2StatusInfoPopup(false); }}
        >
          <div className="project-issue-e2info-window" onClick={(event) => event.stopPropagation()}>
            <div className="project-issue-popup-head">
              <strong className="project-issue-popup-title">E2 Status Update Definitions</strong>
              <div className="project-issue-e2info-head-actions">
                {e2InfoEditMode ? (
                  <>
                    <button
                      type="button"
                      className="project-issue-e2info-save-btn"
                      onClick={handleSaveE2StatusDefinitions}
                      disabled={savingE2InfoDefinitions}
                    >
                      {savingE2InfoDefinitions ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      className="project-issue-popup-close"
                      onClick={handleCancelE2InfoEdit}
                      disabled={savingE2InfoDefinitions}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="project-issue-e2info-edit-btn"
                      onClick={handleOpenE2InfoEdit}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="project-issue-popup-close"
                      onClick={() => setShowE2StatusInfoPopup(false)}
                    >
                      Close
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="project-issue-e2info-body">
              {e2StatusUpdateInfoItems.map((item) => (
                <div className="project-issue-e2info-row" key={item.value}>
                  <div className="project-issue-e2info-value">{item.value}</div>
                  {e2InfoEditMode ? (
                    <textarea
                      className="project-issue-e2info-edit-textarea"
                      value={e2InfoDrafts[item.value.toLowerCase()] ?? item.description}
                      onChange={(event) =>
                        setE2InfoDrafts((previous) => ({
                          ...previous,
                          [item.value.toLowerCase()]: event.target.value,
                        }))
                      }
                      rows={2}
                    />
                  ) : (
                    <div className="project-issue-e2info-description">{item.description}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {showAddIssuePopup ? (
        <div
          className="project-issue-popup-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Add a new issue"
          onClick={closeAddIssuePopup}
        >
          <div className="project-issue-add-window" onClick={(event) => event.stopPropagation()}>
            <div className="project-issue-popup-head">
              <strong className="project-issue-popup-title">Add New Issue</strong>
              <button type="button" className="project-issue-popup-close" onClick={closeAddIssuePopup}>
                Close
              </button>
            </div>
            <form className="project-issue-add-form" onSubmit={handleCreateNewIssue}>
              <div className="project-issue-add-grid" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {newIssueFieldConfig.fields
                  .filter(field => {
                    const key = normalizeFieldKey(field);
                    // Remove unwanted fields, including Due Date and its variants, but NOT Owner or Assignee
                    if (
                      key === 'technical direction' ||
                      key === 'e2 status update' ||
                      key === 'agile' ||
                      key === 'comment' ||
                      key === 'due date' ||
                      key === 'deadline' ||
                      key === 'target date'
                    ) {
                      return false;
                    }
                    return !/^(created|status|priority|reporter|deadline|watchers|stamp abbreviation|stamp category|public|last updated|last in-progress|last solved|last closed|last comment|number of comments|camera|sheet|clash guid|clash name|clash test|clash group|discipline|category|level|source file|grid location|distance|element ids|selection|authoring selection|closed date|snapshot|tags|procore link|room|space|area|zone|stamp title|created from|camera position \(m\)|camera position \(ft\)|coordinates \(m\)|coordinates \(ft\)|type|status category|rfi status|linked rfi|comment reporter|comment date|date closed|procore rfi|clash distance \(feets\)|clash distance \(m\)|clash distance \(mm\)|source sheet|view in revizto|grid|navisworks grid x|navisworks grid y|link to markup|assignee company|assignee department|assignee location|view in web issue tracker|clashes|clashing models|issue type|alignment|coordinate on alignment|intelligence tags|e2 tags|disabled|e2 td|disable flag|markup|source)$/i.test(field.trim());
                  })
                  .map((field) => {
                  const value = newIssueFormData[field] ?? "";
                  const isRequired = newIssueRequiredFields.has(field);
                  const isIssueIdField = field === newIssueFieldConfig.fieldNames.issueId;
                  const isProjectNameField = field === newIssueFieldConfig.fieldNames.projectName;
                  const isStatusField = field === newIssueFieldConfig.fieldNames.e2StatusUpdate;
                  const isStatusDateField = field === newIssueFieldConfig.fieldNames.e2StatusDate;
                  const isTechDetailsField = field === newIssueFieldConfig.fieldNames.techDetails;
                  const isE2DetailerField = normalizeFieldKey(field) === normalizeFieldKey(E2_DETAILER_FIELD);
                  const isOwnerField = field === newIssueFieldConfig.fieldNames.owner;
                  const isAssigneeField = normalizeFieldKey(field) === 'assignee';


                  // Only render required fields: Issue ID, Title, Project Name, Owner, Assignee (if required)
                  // Always render the Title field as a form box
                  const requiredFieldKeys = [
                    newIssueFieldConfig.fieldNames.issueId,
                    newIssueFieldConfig.fieldNames.projectName,
                    newIssueFieldConfig.fieldNames.owner,
                    "Assignee"
                  ];
                  if (field === newIssueFieldConfig.fieldNames.title) {
                    return (
                      <label className="project-issue-add-field" key={field}>
                        <span className="project-issue-add-label">
                          {field}
                          {isRequired ? <span className="project-issue-add-required">*</span> : null}
                        </span>
                        <input
                          className="project-issue-add-input"
                          value={value}
                          onChange={(event) => handleNewIssueFieldChange(field, event.target.value)}
                          placeholder={isRequired ? "Required" : "Title"}
                        />
                      </label>
                    );
                  }
                  if (!requiredFieldKeys.includes(field)) return null;

                  return (
                    <label className="project-issue-add-field" key={field}>
                      <span className="project-issue-add-label">
                        {field}
                        {isRequired ? <span className="project-issue-add-required">*</span> : null}
                      </span>
                      {isIssueIdField || isStatusDateField ? (
                        <input className="project-issue-add-input" value={value} disabled />
                      ) : isProjectNameField ? (
                        <select
                          className="project-issue-add-input"
                          value={value}
                          onChange={(event) => handleNewIssueFieldChange(field, event.target.value)}
                        >
                          <option value="">Select project name</option>
                          {projectNameOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : isOwnerField ? (
                        <input
                          className="project-issue-add-input"
                          value={value}
                          onChange={(event) => handleNewIssueFieldChange(field, event.target.value)}
                          placeholder={isRequired ? "Required" : "Owner name or email"}
                        />
                      ) : isAssigneeField ? (
                        <UsersDropdown
                          selectedUsers={value ? [{ value, label: value }] : []}
                          onChange={selected => handleNewIssueFieldChange(field, selected ? selected.label : "")}
                          isMulti={false}
                          idIglesia={id}
                        />
                      ) : null}
                    </label>
                  );
                })}
              </div>
              <div className="project-issue-add-actions">
                <button type="button" className="project-issue-popup-close" onClick={closeAddIssuePopup} disabled={savingNewIssue}>
                  Cancel
                </button>
                <button type="submit" className="project-issue-add-save-btn" disabled={savingNewIssue}>
                  {savingNewIssue ? "Saving..." : "Create Issue"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showReceivedReporting ? (
        <div
          className="project-issue-popup-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Actionable Reporting - Received Issues"
          onClick={closeReceivedReporting}
        >
          <div className="project-issue-reporting-window" onClick={(event) => event.stopPropagation()}>
            <div className="project-issue-popup-head">
              <strong className="project-issue-popup-title">
                Actionable Reporting - Issues with "Received" Status ({receivedIssues.length})
              </strong>
              <button type="button" className="project-issue-popup-close" onClick={closeReceivedReporting}>
                Close
              </button>
            </div>
            <div className="project-issue-reporting-body">
              {receivedIssues.length === 0 ? (
                <div className="project-issue-reporting-empty">No issues with "Received" status</div>
              ) : (
                <table className="project-issue-reporting-table">
                  <thead>
                    <tr>
                      <th>Issue ID</th>
                      <th>E2 Status Update</th>
                      <th>Project</th>
                      <th>Snapshot</th>
                      <th>E2 Tags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receivedIssues.map((issue) => {
                      const isEditingTags = editingReceivedTagsKeys.has(issue.key);
                      const draftTags = receivedTagsDrafts[issue.key] ?? normalizeValue(issue.e2Tags);
                      const isSavingTags = !!savingReceivedTagsKeys[issue.key];

                      return (
                        <tr key={issue.key} className="project-issue-reporting-row">
                          <td className="project-issue-reporting-cell project-issue-reporting-id">
                            <Link
                              to={`/organization/${id}/project-issue-dashboard/issue/${issue.projectDocId}/${encodeURIComponent(issue.id)}`}
                              className="project-issue-id-link"
                            >
                              <span className="project-issue-issue-id">{normalizeIssueIdDisplay(issue.id)}</span>
                            </Link>
                          </td>
                          <td className="project-issue-reporting-cell">
                            {getDefaultE2StatusUpdate(issue.e2StatusUpdate)}
                          </td>
                          <td className="project-issue-reporting-cell">
                            {getProjectNameDisplay(issue)}
                          </td>
                          <td className="project-issue-reporting-cell project-issue-reporting-snapshot">
                            {issue.snapshotUrl ? (
                              <button
                                type="button"
                                className="project-issue-snapshot-link"
                                onClick={() => {
                                  setLightboxUrl(issue.snapshotUrl);
                                }}
                                title="View snapshot"
                              >
                                📸 View
                              </button>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td className="project-issue-reporting-cell project-issue-reporting-tags">
                            {isEditingTags ? (
                              <div className="project-issue-tags-edit">
                                <input
                                  type="text"
                                  className="project-issue-tags-input"
                                  list="project-issue-e2-tags-suggestions"
                                  value={draftTags}
                                  onChange={(event) =>
                                    handleReceivedTagsChange(issue.key, event.target.value)
                                  }
                                  placeholder="Enter tags"
                                  disabled={isSavingTags}
                                />
                                <button
                                  type="button"
                                  className="project-issue-tags-save-btn"
                                  onClick={() => handleReceivedTagsSave(issue)}
                                  disabled={isSavingTags}
                                >
                                  {isSavingTags ? "..." : "✓"}
                                </button>
                                <button
                                  type="button"
                                  className="project-issue-tags-cancel-btn"
                                  onClick={() => {
                                    setEditingReceivedTagsKeys((prev) => {
                                      const next = new Set(prev);
                                      next.delete(issue.key);
                                      return next;
                                    });
                                  }}
                                  disabled={isSavingTags}
                                >
                                  ✕
                                </button>
                              </div>
                            ) : (
                              <div className="project-issue-tags-display">
                                <span className="project-issue-tags-text">
                                  {normalizeValue(issue.e2Tags) || "-"}
                                </span>
                                <button
                                  type="button"
                                  className="project-issue-tags-edit-btn"
                                  onClick={() => handleReceivedTagsEdit(issue.key)}
                                  title="Edit tags"
                                >
                                  ✎
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <datalist id="project-issue-e2-tags-suggestions">
        {e2TagSuggestions.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>

      {techDetailsPopup.open ? (
        <div className="project-issue-popup-overlay" role="dialog" aria-modal="true" aria-label={`${TECH_DETAILS_DISPLAY_LABEL} Required`}>
          <div className="project-issue-tech-details-popup-window" onClick={(event) => event.stopPropagation()}>
            <div className="project-issue-popup-head">
              <strong className="project-issue-popup-title">{`${TECH_DETAILS_DISPLAY_LABEL} - Required Information`}</strong>
            </div>

            <div className="project-issue-tech-details-popup-body">




              {/* Technical Direction Dropdown - now first */}
              <label className="project-issue-tech-details-popup-label" htmlFor="tech-details-technical-direction">
                Technical Direction
              </label>
              <select
                id="tech-details-technical-direction"
                className="project-issue-cell-input"
                value={techDetailsPopup.technicalDirection || ""}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setTechDetailsPopup((previous) => ({
                    ...previous,
                    technicalDirection: nextValue,
                  }));
                }}
                disabled={submittingTechDetailsPopup}
              >
                <option value="">Select...</option>
                <option value="Stop and Start">Stop and Start</option>
                <option value="Add to Queue">Add to Queue</option>
                <option value="Steer with current task">Steer with current task</option>
                <option value="Other">Other</option>
              </select>

              <label className="project-issue-tech-details-popup-label" htmlFor="tech-details-e2-detailer">
                E2 Lead Detailer
              </label>
              <select
                id="tech-details-e2-detailer"
                className="project-issue-cell-input"
                value={techDetailsPopup.e2Detailer}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  if (isDetailerInSupportTeam(nextValue, techDetailsPopup.e2DetailerSupportTeam)) {
                    openDetailerConflictPopup(nextValue);
                    return;
                  }
                  setTechDetailsPopup((previous) => ({
                    ...previous,
                    e2Detailer: nextValue,
                  }));
                }}
                disabled={submittingTechDetailsPopup}
              >
                <option value="">Select...</option>
                {e2DetailerOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>

              <label className="project-issue-tech-details-popup-label">
                E2 Detailer Support Team
              </label>
              <div className="project-issue-support-team-dropdown">
                <button
                  type="button"
                  className="project-issue-support-team-trigger"
                  aria-label="Select E2 Detailer Support Team"
                  onClick={() => setPopupSupportTeamMenuOpen((previous) => !previous)}
                  disabled={submittingTechDetailsPopup}
                >
                  <span className="project-issue-support-team-text">
                    {sanitizeSupportTeamValues(techDetailsPopup.e2DetailerSupportTeam, e2DetailerOptions).join(", ") || "Select support team"}
                  </span>
                </button>
                {popupSupportTeamMenuOpen ? (
                  <div
                    className="project-issue-support-team-menu"
                    style={{ width: `${popupSupportTeamMenuWidthCh}ch` }}
                  >
                    <div className="project-issue-support-team-menu-options">
                    {e2DetailerOptions.map((name) => {
                      const isSelected = sanitizeSupportTeamValues(
                        techDetailsPopup.e2DetailerSupportTeam,
                        e2DetailerOptions
                      ).some(
                        (item) => item.toLowerCase() === name.toLowerCase()
                      );
                      const isCurrentDetailer =
                        normalizeValue(techDetailsPopup.e2Detailer).toLowerCase() === name.toLowerCase();
                      return (
                        <button
                          key={`popup-${name}`}
                          type="button"
                          className={`project-issue-support-team-option${
                            isSelected ? " is-selected" : ""
                          }${isCurrentDetailer ? " is-disabled" : ""}`}
                          disabled={submittingTechDetailsPopup || isCurrentDetailer}
                          onClick={() => {
                            setTechDetailsPopup((previous) => {
                              const currentValues = sanitizeSupportTeamValues(
                                previous.e2DetailerSupportTeam,
                                e2DetailerOptions
                              );
                              const nextValues = currentValues.some(
                                (item) => item.toLowerCase() === name.toLowerCase()
                              )
                                ? currentValues.filter((item) => item.toLowerCase() !== name.toLowerCase())
                                : [...currentValues, name];
                              return {
                                ...previous,
                                e2DetailerSupportTeam: nextValues,
                              };
                            });
                          }}
                        >
                          <span>{name}</span>
                        </button>
                      );
                    })}
                    </div>
                    <div className="project-issue-support-team-menu-footer">
                      <button
                        type="button"
                        className="project-issue-support-team-done-btn"
                        onClick={() => setPopupSupportTeamMenuOpen(false)}
                      >
                        {(() => {
                          const n = sanitizeSupportTeamValues(techDetailsPopup.e2DetailerSupportTeam, e2DetailerOptions).length;
                          return n > 0 ? `Done (${n} selected)` : "Done";
                        })()}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="project-issue-tech-details-e2-section">
                <div className="project-issue-tech-details-e2-box">
                  <h3 className="project-issue-tech-details-e2-title">E2 Comments</h3>
                  <textarea
                    className="project-issue-tech-details-e2-textarea"
                    value={techDetailsPopup.e2Comments}
                    onChange={(e) =>
                      setTechDetailsPopup((prev) => ({
                        ...prev,
                        e2Comments: e.target.value,
                      }))
                    }
                    placeholder="Add notes, observations, or feedback for E2 team members..."
                    rows={4}
                    disabled={techDetailsPopupSavingComments || submittingTechDetailsPopup}
                  />
                  <div className="project-issue-tech-details-e2-actions">
                    <button
                      type="button"
                      className="project-issue-tech-details-e2-save-btn"
                      onClick={saveTechDetailsPopupE2Comments}
                      disabled={techDetailsPopupSavingComments || submittingTechDetailsPopup}
                    >
                      {techDetailsPopupSavingComments ? "Saving..." : "Save Comments"}
                    </button>
                  </div>
                </div>

                <div className="project-issue-tech-details-e2-box">
                  <h3 className="project-issue-tech-details-e2-title">
                    E2 Documents
                    <span className="project-issue-tech-details-e2-count">
                      ({techDetailsPopup.e2Documents.length} / 3)
                    </span>
                  </h3>

                  {techDetailsPopup.e2Documents.length < 3 && (
                    <div className="project-issue-tech-details-upload-area">
                      <input
                        ref={techDetailsPopupFileInputRef}
                        type="file"
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.png,.jpg,.jpeg,.gif"
                        multiple
                        onChange={handleTechDetailsPopupDocumentUpload}
                        disabled={techDetailsPopupUploadingDocuments || techDetailsPopup.e2Documents.length >= 3}
                        style={{ display: "none" }}
                      />
                      <button
                        type="button"
                        className="project-issue-tech-details-upload-btn"
                        onClick={() => techDetailsPopupFileInputRef.current?.click()}
                        disabled={techDetailsPopupUploadingDocuments || techDetailsPopup.e2Documents.length >= 3}
                      >
                        {techDetailsPopupUploadingDocuments ? "Uploading..." : "📎 Add Document"}
                      </button>
                      <span className="project-issue-tech-details-upload-hint">
                        {3 - techDetailsPopup.e2Documents.length} slot{3 - techDetailsPopup.e2Documents.length !== 1 ? "s" : ""} available
                      </span>
                    </div>
                  )}

                  {techDetailsPopup.e2Documents.length === 0 ? (
                    <p className="project-issue-tech-details-no-docs">No documents attached yet.</p>
                  ) : (
                    <div className="project-issue-tech-details-doc-list">
                      {techDetailsPopup.e2Documents.map((doc, index) => (
                        <div key={index} className="project-issue-tech-details-doc-item">
                          <div className="project-issue-tech-details-doc-info">
                            <a
                              href={doc.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="project-issue-tech-details-doc-name"
                            >
                              📄 {doc.name}
                            </a>
                            {doc.uploadedAt && (
                              <span className="project-issue-tech-details-doc-date">
                                {new Date(doc.uploadedAt).toLocaleDateString()} {new Date(doc.uploadedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            className="project-issue-tech-details-doc-delete"
                            onClick={() => deleteTechDetailsPopupDocument(index)}
                            disabled={techDetailsPopupSavingComments || submittingTechDetailsPopup}
                            title="Delete this document"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="project-issue-tech-details-popup-actions">
                <button
                  type="button"
                  className="project-issue-upload-btn"
                  onClick={handleTechDetailsPopupSubmit}
                  disabled={submittingTechDetailsPopup}
                >
                  {submittingTechDetailsPopup ? "Submitting..." : "Submit"}
                </button>
                <button
                  type="button"
                  className="project-issue-upload-btn"
                  style={{ marginLeft: 12 }}
                  onClick={() => setTechDetailsPopup((prev) => ({ ...prev, open: false }))}
                  disabled={submittingTechDetailsPopup}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {detailerConflictPopupMessage ? (
        <div className="project-issue-popup-overlay" role="dialog" aria-modal="true" aria-label="E2 Lead Detailer conflict">
          <div className="project-issue-tech-details-popup-window" onClick={(event) => event.stopPropagation()}>
            <div className="project-issue-popup-head">
              <strong className="project-issue-popup-title">Selection Conflict</strong>
            </div>
            <div className="project-issue-tech-details-popup-body">
              <div className="project-issue-summary-empty">{detailerConflictPopupMessage}</div>
              <div className="project-issue-tech-details-popup-actions">
                <button
                  type="button"
                  className="project-issue-upload-btn"
                  onClick={() => setDetailerConflictPopupMessage("")}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default ProjectIssueDashboard;