import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { pdf } from "@react-pdf/renderer";
import AgileUpdateModal from "./AgileUpdateModal";
import AgileDataTablePDF from "./AgileDataTablePDF";
import { Link, useParams } from "react-router-dom";
import { collection, deleteField, doc, getDocs, onSnapshot, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { toast } from "react-toastify";
import { db } from "../firebase";
import { getChurchData } from "../api/church";
import commonStyles from "../pages/commonStyles";
import { findFieldByAliases } from "./ProjectIssueDetail";
import {
  DEFAULT_E2_STATUS_UPDATE_AGILE_OPTIONS,
  E2_STATUS_UPDATE_AGILE_OPTIONS_FIELD,
  PROJECT_ISSUE_CONFIG_DOC_ID,
  TAG_ALIASES_FIELD,
} from "./projectIssueConstants";
import "./AgileDataTableModule.css";

const PROJECT_NAME_VALUES_FIELD = "projectNameValues";
const AGILE_DATA_TABLE_VISIBLE_COLUMNS_FIELD = "agileDataTableVisibleColumns";

const AGILE_DATA_TABLE_COLUMNS = [
  "Issue ID",
  "Project Name",
  "Total Hours",
  "Title",
  "Card Review Assignment",
  "E2 Status Update Agile",
  "E2 Lead Detailer",
  "Data Stage",
  "Technical Direction",
  "Cycle Count",
  "Percent Completed",
  "Due Date",
  "Deadline",
  "Latest Update",
  "Last Update Time",
];

const ISSUE_ID_ALIASES = ["issue id", "id", "task id", "card id", "row id"];
const CARD_REVIEW_ASSIGNMENT_OPTIONS = [
  "Populate",
  "Coordinate Internal",
  "Coordinate Other Trades",
  "Add Hangers",
  "Add Hangers With Seismic",
  "Shop Creation",
  "Change Orders",
];
const LEGACY_CARD_REVIEW_COLUMNS = CARD_REVIEW_ASSIGNMENT_OPTIONS;
const CARD_REVIEW_STEP_BY_LABEL = {
  Populate: "populate",
  "Coordinate Internal": "coordinate_internal",
  "Coordinate Other Trades": "coordinate_other_trades",
  "Add Hangers": "add_hangers",
  "Add Hangers With Seismic": "add_hangers_with_seismic",
  "Shop Creation": "shop_creation",
  "Change Orders": "change_orders",
};
const CARD_REVIEW_LABEL_BY_STEP = Object.entries(CARD_REVIEW_STEP_BY_LABEL).reduce((accumulator, [label, stepId]) => {
  accumulator[stepId] = label;
  return accumulator;
}, {});
const CARD_REVIEW_STEP_BY_LOWER_LABEL = Object.entries(CARD_REVIEW_STEP_BY_LABEL).reduce((accumulator, [label, stepId]) => {
  accumulator[label.toLowerCase()] = stepId;
  return accumulator;
}, {});
const UNASSIGNED_FLOOR_TAB_ID = "__unassigned_cards__";
const CARD_REVIEW_UNASSIGNED_STORAGE_KEY = "unassigned_cards";
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
const DATA_STAGE_ALIASES = ["data stage", "datastage"];
const TECHNICAL_DIRECTION_OPTIONS = ["Stop and Start", "Steer with current task", "Add to Queue"];

const normalizeValue = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const buildCardIdentity = (projectDocId, issueId) => {
  const normalizedIssueId = normalizeValue(issueId);
  if (!normalizedIssueId) return "";
  const normalizedProjectDocId = normalizeValue(projectDocId);
  return normalizedProjectDocId ? `${normalizedProjectDocId}::${normalizedIssueId}` : normalizedIssueId;
};

const getCardReviewIssueKey = (issue) => {
  const byIdentity = buildCardIdentity(issue?.projectDocId, issue?.issueId);
  if (byIdentity) return byIdentity;
  return normalizeValue(issue?.issueId) || normalizeValue(issue?.issueDocId) || normalizeValue(issue?.key);
};

const parseCardReviewRef = (cardRef) => {
  const normalizedRef = normalizeValue(cardRef);
  if (!normalizedRef) {
    return { rawRef: "", issueId: "", projectIdFromRef: "" };
  }

  const parts = normalizedRef.split("::");
  if (parts.length >= 2) {
    const projectIdFromRef = normalizeValue(parts[0]);
    const issueIdFromRef = normalizeValue(parts.slice(1).join("::"));
    return {
      rawRef: normalizedRef,
      issueId: issueIdFromRef || normalizedRef,
      projectIdFromRef,
    };
  }

  return {
    rawRef: normalizedRef,
    issueId: normalizedRef,
    projectIdFromRef: "",
  };
};

const normalizeCardReviewStepId = (value) => {
  const normalizedValue = normalizeValue(value).toLowerCase();
  if (CARD_REVIEW_LABEL_BY_STEP[normalizedValue]) return normalizedValue;
  const asLabel = CARD_REVIEW_STEP_BY_LOWER_LABEL[normalizedValue];
  return asLabel || "";
};

const resolveCardReviewAssignment = (data = {}) => {
  const explicitAssignment = normalizeValue(data["Card Review Assignment"] || data.cardReviewAssignment || data.assignment);
  if (CARD_REVIEW_ASSIGNMENT_OPTIONS.includes(explicitAssignment)) {
    return explicitAssignment;
  }

  for (const option of CARD_REVIEW_ASSIGNMENT_OPTIONS) {
    if (normalizeValue(data[option])) {
      return option;
    }
  }

  return "";
};

const buildCardReviewAssignmentMap = (cardReviewValue) => {
  const assignmentMap = {};
  const latestByIssue = {};

  if (!cardReviewValue || typeof cardReviewValue !== "object" || Array.isArray(cardReviewValue)) {
    return assignmentMap;
  }

  Object.entries(cardReviewValue).forEach(([projectId, floorsValue]) => {
    if (!floorsValue || typeof floorsValue !== "object" || Array.isArray(floorsValue)) return;

    Object.values(floorsValue).forEach((cardsValue) => {
      if (!cardsValue || typeof cardsValue !== "object" || Array.isArray(cardsValue)) return;

      Object.entries(cardsValue).forEach(([cardRef, entryValue]) => {
        const parsedRef = parseCardReviewRef(cardRef);
        const issueId = parsedRef.issueId;
        if (!issueId) return;

        const stepValue =
          entryValue && typeof entryValue === "object" && !Array.isArray(entryValue)
            ? entryValue.step
            : entryValue;
        const normalizedStep = normalizeCardReviewStepId(stepValue);
        const assignmentLabel = CARD_REVIEW_LABEL_BY_STEP[normalizedStep] || "";
        if (!assignmentLabel) return;

        const updatedAt = Number(entryValue?.updatedAt) || 0;
        const resolvedProjectId = normalizeValue(projectId) || parsedRef.projectIdFromRef;
        const identityKey = buildCardIdentity(resolvedProjectId, issueId);

        if (parsedRef.rawRef) {
          assignmentMap[parsedRef.rawRef] = {
            assignment: assignmentLabel,
            issueId,
            projectId: resolvedProjectId,
            updatedAt,
          };
        }

        if (identityKey) {
          assignmentMap[identityKey] = {
            assignment: assignmentLabel,
            issueId,
            projectId: resolvedProjectId,
            updatedAt,
          };
        }

        const previous = latestByIssue[issueId];
        if (!previous || updatedAt >= previous.updatedAt) {
          latestByIssue[issueId] = {
            assignment: assignmentLabel,
            issueId,
            projectId: resolvedProjectId,
            updatedAt,
          };
        }
      });
    });
  });

  Object.entries(latestByIssue).forEach(([issueId, value]) => {
    assignmentMap[issueId] = value;
  });

  return assignmentMap;
};

const buildProjectDocIdFromName = (name) => {
  const normalized = normalizeValue(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return normalized;
};

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

const getCardReviewAssignmentForIssue = (cardReviewFieldsByIssue, issue) => {
  const identityKey = buildCardIdentity(issue?.projectDocId, issue?.issueId);
  const issueId = normalizeValue(issue?.issueId);
  return (
    cardReviewFieldsByIssue?.[identityKey]?.assignment ||
    cardReviewFieldsByIssue?.[issueId]?.assignment ||
    ""
  );
};

const parseIssueTagValues = (value) => {
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

  return latestEntry || logEntries[0] || null;
};

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

const formatDateTime = (value) => {
  const date = toDateSafe(value);
  if (!date) return "-";
  return date.toLocaleString();
};

const toDateInputValue = (value) => {
  const raw = normalizeValue(value);
  if (!raw) return "";
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// --- Deadline helpers (same logic as Agile Board) ---
const _nyFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const _getNyParts = (date) => {
  const p = {};
  _nyFmt.formatToParts(date).forEach(({ type, value }) => {
    if (type !== "literal") p[type] = Number(value);
  });
  return p;
};

const _nyLocalToUtcMs = (year, month, day, hour, min = 0, sec = 0) => {
  let utcMs = Date.UTC(year, month - 1, day, hour, min, sec);
  for (let i = 0; i < 3; i += 1) {
    const a = _getNyParts(new Date(utcMs));
    const delta =
      Date.UTC(year, month - 1, day, hour, min, sec) -
      Date.UTC(a.year, a.month - 1, a.day, a.hour, a.minute, a.second);
    if (delta === 0) break;
    utcMs += delta;
  }
  return utcMs;
};

const _shiftDay = (year, month, day, delta) => {
  const d = new Date(Date.UTC(year, month - 1, day + delta));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
};

const getDeadlineRefMs = () => Date.now();

const getDueDateMs = (dueDateStr) => {
  const isoMatch = String(dueDateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return _nyLocalToUtcMs(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]), 16);
  }
  const mdyMatch = String(dueDateStr).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdyMatch) {
    return _nyLocalToUtcMs(Number(mdyMatch[3]), Number(mdyMatch[1]), Number(mdyMatch[2]), 16);
  }
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

const getDeadlineDisplay = (issue) => {
  const permanentLabel = normalizeValue(issue?.permanentDeadlineLabel);
  const permanentColor = normalizeValue(issue?.permanentDeadlineColor) || "inherit";
  if (permanentLabel) {
    return { label: permanentLabel, color: permanentColor };
  }

  const dueDateStr = issue?.e2DueDate;
  if (!dueDateStr) return { label: "-", color: "inherit" };

  const calc = calculateDeadlineValue(dueDateStr);
  if (!calc) return { label: "-", color: "inherit" };

  const { diffMs, daysDiff, hoursDiff } = calc;
  const statusValue = normalizeValue(issue?.status);
  const isCompleted = statusValue === "Completed" || statusValue === "Report Completion to Client";

  if (isCompleted) {
    if (diffMs > 0 && daysDiff > 1) {
      return { label: "Delivered ahead of schedule", color: "#22c55e" };
    }
    if (diffMs > 0) {
      return { label: "Met", color: "#22c55e" };
    }
    return { label: "Missed the Deadline", color: "#dc2626" };
  }

  if (daysDiff <= 0) {
    const hourLabel = `${hoursDiff} hour${hoursDiff === 1 ? "" : "s"}`;
    return {
      label: diffMs < 0 ? `Overdue by ${hourLabel}` : hourLabel,
      color: diffMs < 0 ? "#dc2626" : "inherit",
    };
  }

  const dayLabel = `${daysDiff} business day${daysDiff === 1 ? "" : "s"}`;
  return {
    label: diffMs < 0 ? `Overdue by ${dayLabel}` : dayLabel,
    color: diffMs < 0 ? "#dc2626" : "inherit",
  };
};

const SearchableSelect = ({ value, onChange, options = [], placeholder, disabled = false }) => {
  const [query, setQuery] = useState(value || "");
  const [open, setOpen] = useState(false);
  const [showAddNew, setShowAddNew] = useState(false);
  const [newValue, setNewValue] = useState("");
  const [menuPlacement, setMenuPlacement] = useState({ top: 0, left: 0, width: 0, maxHeight: 220 });
  const wrapperRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    setQuery(value || "");
  }, [value]);

  useEffect(() => {
    if (!open || disabled) return undefined;

    const updateMenuPlacement = () => {
      const wrapperRect = wrapperRef.current?.getBoundingClientRect();
      if (!wrapperRect) return;

      const viewportPadding = 16;
      const spaceBelow = window.innerHeight - wrapperRect.bottom - viewportPadding;
      const spaceAbove = wrapperRect.top - viewportPadding;
      const openUpward = spaceBelow < 220 && spaceAbove > spaceBelow;
      const maxHeight = Math.max(140, Math.min(280, openUpward ? spaceAbove : spaceBelow));
      const top = openUpward ? Math.max(viewportPadding, wrapperRect.top - 4 - maxHeight) : wrapperRect.bottom + 4;

      setMenuPlacement({
        top,
        left: wrapperRect.left,
        width: wrapperRect.width,
        maxHeight,
      });
    };

    const raf = window.requestAnimationFrame(updateMenuPlacement);
    window.addEventListener("resize", updateMenuPlacement);
    window.addEventListener("scroll", updateMenuPlacement, true);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", updateMenuPlacement);
      window.removeEventListener("scroll", updateMenuPlacement, true);
    };
  }, [open, disabled, query, options.length]);

  const filteredOptions = useMemo(() => {
    const normalizedQuery = normalizeValue(query).toLowerCase();
    if (!normalizedQuery) return options;
    return options.filter((option) => normalizeValue(option).toLowerCase().includes(normalizedQuery));
  }, [options, query]);

  const handleAddNew = () => {
    setShowAddNew(true);
    setNewValue(query);
  };

  return (
    <div className={`agile-searchable-select ${disabled ? "is-disabled" : ""}`} ref={wrapperRef}>
      <input
        className="project-issue-add-input"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          if (!disabled) setOpen(true);
        }}
        onFocus={() => {
          if (!disabled) setOpen(true);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder}
        readOnly={disabled}
        disabled={disabled}
        onKeyDown={(e) => {
          if (!disabled && open && e.key === "Enter" && (!filteredOptions.length || query && !filteredOptions.includes(query))) {
            e.preventDefault();
            handleAddNew();
            setOpen(false);
          }
        }}
      />
      {open && !disabled ? (
        ReactDOM.createPortal(
          <div
            className="agile-searchable-select-menu"
            ref={menuRef}
            onMouseDown={(event) => event.preventDefault()}
            style={{
              top: `${menuPlacement.top}px`,
              left: `${menuPlacement.left}px`,
              width: `${menuPlacement.width}px`,
              maxHeight: `${menuPlacement.maxHeight}px`,
            }}
          >
            <div className="agile-searchable-select-menu-inner">
              {filteredOptions.length ? (
                filteredOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className="agile-searchable-select-option"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      onChange(option);
                      setQuery(option);
                      setOpen(false);
                    }}
                  >
                    <span className="agile-searchable-select-option-label">{option}</span>
                    <span className="agile-searchable-select-option-badge">Select</span>
                  </button>
                ))
              ) : null}
              <button
                type="button"
                className="agile-searchable-select-option agile-searchable-select-add-new"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleAddNew();
                  setOpen(false);
                }}
              >
                <span className="agile-searchable-select-option-label">+ Add New</span>
                <span className="agile-searchable-select-option-badge is-primary">Create</span>
              </button>
              {!filteredOptions.length && (
                <div className="agile-searchable-select-empty">No matches found</div>
              )}
            </div>
          </div>,
          document.body
        )
      ) : null}
      {showAddNew && (
        <div className="agile-searchable-select-add-new-modal">
          <div className="agile-searchable-select-add-new-window">
            <div style={{ marginBottom: 8 }}>Add new value:</div>
            <input
              className="project-issue-add-input"
              value={newValue}
              onChange={e => setNewValue(e.target.value)}
              autoFocus
              placeholder="Enter new value"
              onKeyDown={e => {
                if (e.key === "Enter" && newValue.trim()) {
                  onChange({ addNew: true, value: newValue.trim() });
                  setShowAddNew(false);
                }
              }}
            />
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="project-issue-add-save-btn"
                onClick={() => {
                  if (newValue.trim()) {
                    onChange({ addNew: true, value: newValue.trim() });
                    setShowAddNew(false);
                  }
                }}
              >Add</button>
              <button
                type="button"
                className="project-issue-popup-close"
                onClick={() => setShowAddNew(false)}
              >Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SearchableMultiSelect = ({
  values = [],
  onChange,
  options = [],
  placeholder,
  isOptionDisabled,
  onAddNew,
}) => {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [showAddNew, setShowAddNew] = useState(false);
  const [newValue, setNewValue] = useState("");
  const wrapperRef = useRef(null);
  const menuRef = useRef(null);
  const [menuPlacement, setMenuPlacement] = useState({ top: 0, left: 0, width: 0, maxHeight: 220 });

  const selectedSet = useMemo(() => new Set(values), [values]);

  const filteredOptions = useMemo(() => {
    const normalizedQuery = normalizeValue(query).toLowerCase();
    return options.filter((option) => {
      if (normalizedQuery && !normalizeValue(option).toLowerCase().includes(normalizedQuery)) {
        return false;
      }
      return true;
    });
  }, [options, query]);

  const toggleOption = (option) => {
    const checked = selectedSet.has(option);
    if (checked) return;
    onChange([...values, option]);
    setQuery("");
    setOpen(true);
  };

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!wrapperRef.current) return;
      if (wrapperRef.current.contains(event.target)) return;
      if (menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("touchstart", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick);
    };
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    const updateMenuPlacement = () => {
      const wrapperRect = wrapperRef.current?.getBoundingClientRect();
      if (!wrapperRect) return;

      const viewportPadding = 16;
      const spaceBelow = window.innerHeight - wrapperRect.bottom - viewportPadding;
      const spaceAbove = wrapperRect.top - viewportPadding;
      const openUpward = spaceBelow < 220 && spaceAbove > spaceBelow;
      const maxHeight = Math.max(140, Math.min(280, openUpward ? spaceAbove : spaceBelow));
      const top = openUpward ? Math.max(viewportPadding, wrapperRect.top - 4 - maxHeight) : wrapperRect.bottom + 4;

      setMenuPlacement({
        top,
        left: wrapperRect.left,
        width: wrapperRect.width,
        maxHeight,
      });
    };

    const raf = window.requestAnimationFrame(updateMenuPlacement);
    window.addEventListener("resize", updateMenuPlacement);
    window.addEventListener("scroll", updateMenuPlacement, true);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", updateMenuPlacement);
      window.removeEventListener("scroll", updateMenuPlacement, true);
    };
  }, [open, query, options.length, values.length]);

  const handleAddNew = () => {
    setShowAddNew(true);
    setNewValue(query);
  };

  return (
    <div className="agile-searchable-select" ref={wrapperRef}>
      <div className="agile-multi-select-chip-row">
        {values.map((item) => (
          <span key={item} className="agile-multi-select-chip">
            {item}
            <button
              type="button"
              className="agile-multi-select-chip-remove"
              onClick={(event) => {
                event.stopPropagation();
                onChange(values.filter((value) => value !== item));
              }}
              aria-label={`Remove ${item}`}
            >
              x
            </button>
          </span>
        ))}
      </div>
      <input
        className="project-issue-add-input"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (open && e.key === "Enter" && (!filteredOptions.length || query && !filteredOptions.includes(query))) {
            e.preventDefault();
            handleAddNew();
            setOpen(false);
          }
        }}
      />
      <div className="agile-multi-select-meta">
        {values.length} selected
      </div>
      {open ? (
        ReactDOM.createPortal(
          <div
            className="agile-searchable-select-menu"
            ref={menuRef}
            onMouseDown={(event) => event.preventDefault()}
            style={{
              top: `${menuPlacement.top}px`,
              left: `${menuPlacement.left}px`,
              width: `${menuPlacement.width}px`,
              maxHeight: `${menuPlacement.maxHeight}px`,
            }}
          >
            <div className="agile-searchable-select-menu-inner">
              {filteredOptions.length ? (
                filteredOptions.map((option) => {
                  const disabled = typeof isOptionDisabled === "function" ? isOptionDisabled(option) : false;
                  const checked = selectedSet.has(option);
                  return (
                    <button
                      key={option}
                      type="button"
                      className={`agile-searchable-select-option ${checked ? "is-selected" : ""}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        if (disabled) return;
                        toggleOption(option);
                      }}
                      disabled={disabled}
                    >
                      <span className="agile-searchable-select-option-label">{option}</span>
                      <span className="agile-searchable-select-option-badge">
                        {checked ? "Added" : "Add"}
                      </span>
                    </button>
                  );
                })
              ) : null}
              <button
                type="button"
                className="agile-searchable-select-option agile-searchable-select-add-new"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleAddNew();
                  setOpen(false);
                }}
              >
                <span className="agile-searchable-select-option-label">+ Add New</span>
                <span className="agile-searchable-select-option-badge is-primary">Create</span>
              </button>
              {!filteredOptions.length && (
                <div className="agile-searchable-select-empty">No matches found</div>
              )}
            </div>
          </div>,
          document.body
        )
      ) : null}
      {showAddNew && (
        <div className="agile-searchable-select-add-new-modal">
          <div className="agile-searchable-select-add-new-window">
            <div style={{ marginBottom: 8 }}>Add new value:</div>
            <input
              className="project-issue-add-input"
              value={newValue}
              onChange={e => setNewValue(e.target.value)}
              autoFocus
              placeholder="Enter new value"
              onKeyDown={e => {
                if (e.key === "Enter" && newValue.trim()) {
                  if (onAddNew) onAddNew(newValue.trim());
                  setShowAddNew(false);
                }
              }}
            />
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="project-issue-add-save-btn"
                onClick={() => {
                  if (newValue.trim()) {
                    if (onAddNew) onAddNew(newValue.trim());
                    setShowAddNew(false);
                  }
                }}
              >Add</button>
              <button
                type="button"
                className="project-issue-popup-close"
                onClick={() => setShowAddNew(false)}
              >Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const AgileDataTableModule = () => {
    // --- Inline editing state for Title ---
    const [editingTitleKey, setEditingTitleKey] = useState(null);
    const [titleDraft, setTitleDraft] = useState("");
    const handleTitleChange = async (issue, value) => {
      const nextTitle = normalizeValue(value);
      if (nextTitle === normalizeValue(issue.title)) return;
      await updateIssueField({
        issue,
        fieldName: "title",
        updates: { [issue.titleField || "Title"]: nextTitle },
        patch: { title: nextTitle },
      });
    };
  const { id } = useParams();

  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [organizationLogoUrl, setOrganizationLogoUrl] = useState("");
  const [showColumnPreferencesPopup, setShowColumnPreferencesPopup] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(AGILE_DATA_TABLE_COLUMNS);
  const [columnPreferencesDraft, setColumnPreferencesDraft] = useState(AGILE_DATA_TABLE_COLUMNS);
  const [savingColumnPreferences, setSavingColumnPreferences] = useState(false);
  const [percentDrafts, setPercentDrafts] = useState({});
  const [openingPdf, setOpeningPdf] = useState(false);

  const [projectNameValues, setProjectNameValues] = useState([]);
  const [tagAliasByLowerTag, setTagAliasByLowerTag] = useState({});
  const [e2LeadDetailerOptions, setE2LeadDetailerOptions] = useState([]);
  const [e2TagConfigOptions, setE2TagConfigOptions] = useState([]);
  const [agileStatusOptions, setAgileStatusOptions] = useState(DEFAULT_E2_STATUS_UPDATE_AGILE_OPTIONS);
  const [cardReviewFieldsByIssue, setCardReviewFieldsByIssue] = useState({});
  const [totalHoursByCard, setTotalHoursByCard] = useState({});

  useEffect(() => {
    if (!id) return;
    const floorProgressRef = doc(db, "churches", id, "timeRotateFloorPlanner", "floorCategoryProgress");
    const unsubscribe = onSnapshot(
      floorProgressRef,
      (snapshot) => {
        const data = snapshot.data() || {};
        const fieldsMap = buildCardReviewAssignmentMap(data.cardReview);
        setCardReviewFieldsByIssue(fieldsMap);
      },
      () => {
        setCardReviewFieldsByIssue({});
      }
    );

    return () => unsubscribe();
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let mounted = true;

    async function fetchTotalHours() {
      try {
        const logsQuery = collection(db, "churches", id, "timeRotateLogs");
        const logsSnap = await getDocs(logsQuery);
        const totalsByIdentity = {};
        const totalsByIssueId = {};

        logsSnap.docs.forEach((docSnap) => {
          const log = docSnap.data() || {};
          const duration = Number(log.durationMs) || 0;
          if (duration <= 0) return;

          const issueId = normalizeValue(log.issueId);
          if (!issueId) return;

          const projectDocId = normalizeValue(log.projectDocId);
          const cardIdentity = buildCardIdentity(projectDocId, issueId);

          if (cardIdentity) {
            if (!totalsByIdentity[cardIdentity]) totalsByIdentity[cardIdentity] = 0;
            totalsByIdentity[cardIdentity] += duration;
          }

          if (!totalsByIssueId[issueId]) totalsByIssueId[issueId] = 0;
          totalsByIssueId[issueId] += duration;
        });

        Object.keys(totalsByIdentity).forEach((key) => {
          totalsByIdentity[key] = +(totalsByIdentity[key] / (1000 * 60 * 60)).toFixed(2);
        });
        Object.keys(totalsByIssueId).forEach((key) => {
          totalsByIssueId[key] = +(totalsByIssueId[key] / (1000 * 60 * 60)).toFixed(2);
        });

        if (mounted) {
          setTotalHoursByCard({
            byIdentity: totalsByIdentity,
            byIssueId: totalsByIssueId,
          });
        }
      } catch {
        if (mounted) setTotalHoursByCard({ byIdentity: {}, byIssueId: {} });
      }
    }

    fetchTotalHours();
    return () => {
      mounted = false;
    };
  }, [id]);

  // detailerOptions must be defined before any use
  const detailerOptions = useMemo(() => {
    if (e2LeadDetailerOptions.length > 0) {
      return e2LeadDetailerOptions.slice().sort((a, b) => a.localeCompare(b));
    }
    return dedupeValues(issues.map((issue) => issue.e2LeadDetailer)).sort((a, b) => a.localeCompare(b));
  }, [e2LeadDetailerOptions, issues]);

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProjectNames, setSelectedProjectNames] = useState([]);
  const [selectedE2LeadDetailer, setSelectedE2LeadDetailer] = useState("All");
  const [selectedE2StatusAgile, setSelectedE2StatusAgile] = useState("All");
  const [selectedDataStage, setSelectedDataStage] = useState("Production");

  const normalizeVisibleColumns = (candidateColumns) => {
    const hasLegacyCardColumns =
      Array.isArray(candidateColumns) &&
      LEGACY_CARD_REVIEW_COLUMNS.some((column) => candidateColumns.includes(column));

    const valid = Array.isArray(candidateColumns)
      ? (() => {
          const seen = new Set();
          return candidateColumns
            .map((column) => normalizeValue(column))
            .filter((column) => AGILE_DATA_TABLE_COLUMNS.includes(column))
            .filter((column) => {
              if (seen.has(column)) return false;
              seen.add(column);
              return true;
            });
        })()
      : [];

    if (!valid.length) return AGILE_DATA_TABLE_COLUMNS;
    if (hasLegacyCardColumns && !valid.includes("Card Review Assignment")) {
      valid.push("Card Review Assignment");
    }
    if (!valid.includes("Deadline")) valid.push("Deadline");
    return valid;
  };

  // Add Issue Popup State
  const [showAddIssuePopup, setShowAddIssuePopup] = useState(false);
  const [addIssueStep, setAddIssueStep] = useState(1);
  const [newIssueFormData, setNewIssueFormData] = useState({});
  const [savingNewIssue, setSavingNewIssue] = useState(false);
  const [dataEnvironmentOptions] = useState(["Testing", "Production"]);

  // Canonical: build next TD-xxxx issue ID
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

  // Helper: get today MM/DD/YY
  const getTodayMMDDYY = () => {
    const d = new Date();
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear().toString().slice(-2)}`;
  };

  // Helper: build form data with defaults
  const buildNewIssueFormData = () => {
    const generatedIssueId = buildNextTDIssueId(issues.map((issue) => issue.issueId));
    return {
      ID: generatedIssueId,
      Title: "",
      "Project Name": "",
      "E2 Tags": "",
      Requester: "",
      "Lead Detailer": "",
      "Support Team": [],
      "Data Environment": "Production",
      "Send to Agile": "Yes",
    };
  };

  const resolveTargetProjectDocId = async (projectName) => {
    const targetProjectName = normalizeValue(projectName);
    if (!id || !targetProjectName) return "";

    const targetProjectDocId = buildProjectDocIdFromName(targetProjectName);
    const projectsSnap = await getDocs(collection(db, "churches", id, "bimProjects"));
    const existingProject = projectsSnap.docs.find((projectDoc) => {
      const projectData = projectDoc.data() || {};
      const existingProjectName = normalizeValue(projectData.name);
      return (
        projectDoc.id === targetProjectName ||
        projectDoc.id === targetProjectDocId ||
        existingProjectName.toLowerCase() === targetProjectName.toLowerCase()
      );
    });

    if (existingProject) {
      return existingProject.id;
    }

    const fallbackProjectDocId = targetProjectDocId || `bim-project-${Date.now()}`;
    await setDoc(
      doc(db, "churches", id, "bimProjects", fallbackProjectDocId),
      {
        name: targetProjectName,
        fields: [],
        rows: [],
        rowCount: 0,
        uploadCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return fallbackProjectDocId;
  };
  const [savingFields, setSavingFields] = useState({});

  // Update Modal State
  const [updateModal, setUpdateModal] = useState({ open: false, issue: null });
  const [updateLoading, setUpdateLoading] = useState(false);
  const [newUpdate, setNewUpdate] = useState("");
  const [modalPercent, setModalPercent] = useState(0);
  const [latestUpdate, setLatestUpdate] = useState({ text: "", percentCompleted: null, date: null });

  useEffect(() => {
    let mounted = true;

    const loadOrganizationBranding = async () => {
      if (!id) {
        if (mounted) setOrganizationLogoUrl("");
        return;
      }

      try {
        const churchData = await getChurchData(id);
        if (mounted) {
          setOrganizationLogoUrl(normalizeValue(churchData?.logo));
        }
      } catch {
        if (mounted) {
          setOrganizationLogoUrl("");
        }
      }
    };

    loadOrganizationBranding();
    return () => {
      mounted = false;
    };
  }, [id]);

  useEffect(() => {
    if (!id) return;

    const configRef = doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID);
    const unsubscribe = onSnapshot(configRef, (snapshot) => {
      const data = snapshot.data() || {};

      const configuredProjectNames = Array.isArray(data[PROJECT_NAME_VALUES_FIELD])
        ? data[PROJECT_NAME_VALUES_FIELD]
        : [];
      setProjectNameValues(configuredProjectNames);

      const configuredAgileStatuses = Array.isArray(data[E2_STATUS_UPDATE_AGILE_OPTIONS_FIELD])
        ? data[E2_STATUS_UPDATE_AGILE_OPTIONS_FIELD]
        : [];
      setAgileStatusOptions(
        configuredAgileStatuses.length ? configuredAgileStatuses : DEFAULT_E2_STATUS_UPDATE_AGILE_OPTIONS
      );

      const configuredDetailers = Array.isArray(data.e2DetailerOptions) ? data.e2DetailerOptions : [];
      setE2LeadDetailerOptions(configuredDetailers);

      const tagAliases = data[TAG_ALIASES_FIELD] || {};
      const normalized = {};
      Object.entries(tagAliases).forEach(([key, value]) => {
        if (key && value) {
          normalized[key.toLowerCase()] = value;
        }
      });
      setTagAliasByLowerTag(normalized);

      const configuredE2Tags = Array.isArray(data.e2TagValues) ? data.e2TagValues : [];
      setE2TagConfigOptions(configuredE2Tags);

      const configuredVisibleColumns = normalizeVisibleColumns(data[AGILE_DATA_TABLE_VISIBLE_COLUMNS_FIELD]);
      setVisibleColumns(configuredVisibleColumns);
      setColumnPreferencesDraft(configuredVisibleColumns);
    });

    return () => unsubscribe();
  }, [id]);

  useEffect(() => {
    if (!id) return undefined;

    const projectsRef = collection(db, "churches", id, "bimProjects");

    const unsubscribe = onSnapshot(
      projectsRef,
      async (snapshot) => {
        const nextIssues = [];

        for (const projectDoc of snapshot.docs) {
          const projectData = projectDoc.data() || {};
          const fields = Array.isArray(projectData.fields) ? projectData.fields : [];
          const issuesRef = collection(db, "churches", id, "bimProjects", projectDoc.id, "issues");
          const issuesSnap = await getDocs(issuesRef);

          const projectIssues = issuesSnap.docs.map((issueDoc, rowIndex) => {
            const rowData = issueDoc.data() || {};

            const issueIdField = findFieldByAliases(fields, rowData, ISSUE_ID_ALIASES);
            const titleField = findFieldByAliases(fields, rowData, TITLE_ALIASES);
            const projectNameField = findFieldByAliases(fields, rowData, PROJECT_NAME_ALIASES);
            const statusAgileField =
              findFieldByAliases(fields, rowData, E2_STATUS_AGILE_ALIASES) || "E2 Status Update Agile";
            const leadDetailerField = findFieldByAliases(fields, rowData, LEAD_DETAILER_ALIASES);
            const dataStageField = findFieldByAliases(fields, rowData, DATA_STAGE_ALIASES) || "Data Stage";

            const logEntries = Array.isArray(rowData.LogEntries) ? rowData.LogEntries : [];
            const latestLog = getLatestLogEntry(logEntries);

            return {
              key: `${projectDoc.id}-${issueDoc.id}`,
              projectDocId: projectDoc.id,
              issueDocId: issueDoc.id,
              issueId: normalizeValue(issueIdField ? rowData[issueIdField] : "") || String(rowIndex + 1),
              title: normalizeValue(titleField ? rowData[titleField] : "") || "Untitled issue",
              projectName: normalizeValue(projectNameField ? rowData[projectNameField] : ""),
              e2Tags: normalizeValue(rowData["E2 Tags"] || rowData.e2Tags || ""),
              status: normalizeValue(statusAgileField ? rowData[statusAgileField] : ""),
              e2LeadDetailer: normalizeValue(leadDetailerField ? rowData[leadDetailerField] : ""),
              dataStage: normalizeValue(dataStageField ? rowData[dataStageField] : "") || "Testing",
              technicalDirection: normalizeValue(rowData["Technical Direction"] || ""),
              developmentCycleCounter:
                typeof rowData.Development_Cycle_Counter === "number" ? rowData.Development_Cycle_Counter : 0,
              e2DueDate: rowData.e2DueDate || "",
              permanentDeadlineLabel: normalizeValue(rowData.permanentDeadlineLabel || ""),
              permanentDeadlineColor: normalizeValue(rowData.permanentDeadlineColor || ""),
              latestUpdateText: normalizeValue(latestLog?.update || latestLog?.text || ""),
              latestUpdateDate: latestLog?.timestamp || latestLog?.date || latestLog?.createdAt || null,
              percentCompleted:
                typeof latestLog?.percent === "number"
                  ? latestLog.percent
                  : typeof latestLog?.percentCompleted === "number"
                  ? latestLog.percentCompleted
                  : Number.isFinite(Number(rowData.percentCompleted))
                  ? Number(rowData.percentCompleted)
                  : Number.isFinite(Number(rowData["Percent Completed"]))
                  ? Number(rowData["Percent Completed"])
                  : null,
              tags: normalizeValue(rowData.tags || ""),
              zone: normalizeValue(rowData.zone || ""),
              projectNameField: projectNameField || "Project Name",
              statusField: statusAgileField || "E2 Status Update Agile",
              leadDetailerField: leadDetailerField || "E3 Lead Detailer",
              technicalDirectionField: "Technical Direction",
              dueDateField: "e2DueDate",
              logEntries,
            };
          });

          nextIssues.push(...projectIssues);
        }

        setIssues(nextIssues);
        setLoading(false);
      },
      () => {
        setIssues([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [id]);

  const projectNameOptions = useMemo(() => {
    if (projectNameValues.length > 0) {
      return projectNameValues.slice().sort((a, b) => a.localeCompare(b));
    }
    return dedupeValues(issues.map((issue) => getProjectNameDisplay(issue, tagAliasByLowerTag))).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [projectNameValues, issues, tagAliasByLowerTag]);



  const statusOptions = useMemo(() => {
    const derived = dedupeValues(issues.map((issue) => issue.status));
    const fromConfig = dedupeValues(agileStatusOptions);
    const configSet = new Set(fromConfig.map((status) => status.toLowerCase()));
    const extraStatuses = derived
      .filter((status) => !configSet.has(status.toLowerCase()))
      .sort((a, b) => a.localeCompare(b));
    return [...fromConfig, ...extraStatuses];
  }, [agileStatusOptions, issues]);

  const addIssueTagOptions = useMemo(() => {
    const merged = [
      ...e2TagConfigOptions,
      ...issues.flatMap((issue) => parseIssueTagValues(issue.e2Tags)),
    ];
    return dedupeValues(merged).sort((a, b) => a.localeCompare(b));
  }, [e2TagConfigOptions, issues]);

  const visibleIssues = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    const selectedProjectSet = new Set(selectedProjectNames);

    return issues
      .filter((issue) => {
        const issueProjectName = getProjectNameDisplay(issue, tagAliasByLowerTag);
        const projectMatched = selectedProjectSet.size === 0 || selectedProjectSet.has(issueProjectName);
        const detailerMatched =
          selectedE2LeadDetailer === "All" || normalizeValue(issue.e2LeadDetailer) === selectedE2LeadDetailer;
        const statusMatched = selectedE2StatusAgile === "All" || normalizeValue(issue.status) === selectedE2StatusAgile;
        const dataStageMatched = selectedDataStage === "All" || normalizeValue(issue.dataStage) === selectedDataStage;

        const searchMatched =
          !search ||
          normalizeValue(issue.issueId).toLowerCase().includes(search) ||
          normalizeValue(issue.title).toLowerCase().includes(search) ||
          normalizeValue(issueProjectName).toLowerCase().includes(search);

        return projectMatched && detailerMatched && statusMatched && dataStageMatched && searchMatched;
      })
      .sort((a, b) => {
        const projectCompare = getProjectNameDisplay(a, tagAliasByLowerTag).localeCompare(
          getProjectNameDisplay(b, tagAliasByLowerTag)
        );
        if (projectCompare !== 0) return projectCompare;
        return normalizeValue(a.issueId).localeCompare(normalizeValue(b.issueId), undefined, { numeric: true });
      });
  }, [
    issues,
    searchTerm,
    selectedProjectNames,
    selectedE2LeadDetailer,
    selectedE2StatusAgile,
    selectedDataStage,
    tagAliasByLowerTag,
  ]);

  const groupedIssues = useMemo(() => {
    const groups = visibleIssues.reduce((accumulator, issue) => {
      const projectName = getProjectNameDisplay(issue, tagAliasByLowerTag) || "Unassigned";
      if (!accumulator[projectName]) accumulator[projectName] = [];
      accumulator[projectName].push(issue);
      return accumulator;
    }, {});

    return Object.entries(groups)
      .sort(([projectA], [projectB]) => projectA.localeCompare(projectB))
      .map(([projectName, rows]) => ({ projectName, rows }));
  }, [visibleIssues, tagAliasByLowerTag]);

  const groupedIssuesByProjectAndStatus = useMemo(() => {
    const statusOrder = new Map(statusOptions.map((status, index) => [status, index]));

    return groupedIssues.map((projectGroup) => {
      const statusBuckets = projectGroup.rows.reduce((accumulator, issue) => {
        const status = normalizeValue(issue.status) || "Unassigned";
        if (!accumulator[status]) accumulator[status] = [];
        accumulator[status].push(issue);
        return accumulator;
      }, {});

      const statusGroups = Object.entries(statusBuckets)
        .sort(([statusA], [statusB]) => {
          const indexA = statusOrder.has(statusA) ? statusOrder.get(statusA) : Number.MAX_SAFE_INTEGER;
          const indexB = statusOrder.has(statusB) ? statusOrder.get(statusB) : Number.MAX_SAFE_INTEGER;
          if (indexA !== indexB) return indexA - indexB;
          return statusA.localeCompare(statusB);
        })
        .map(([status, rows]) => ({ status, rows }));

      return {
        ...projectGroup,
        statusGroups,
      };
    });
  }, [groupedIssues, statusOptions]);

  const percentOptions = useMemo(() => {
    const values = [];
    for (let value = 0; value <= 100; value += 5) {
      values.push(value);
    }
    return values;
  }, []);

  const getFieldSavingKey = (issueKey, fieldName) => `${issueKey}::${fieldName}`;

  const isFieldSaving = (issueKey, fieldName) => Boolean(savingFields[getFieldSavingKey(issueKey, fieldName)]);

  const setFieldSaving = (issueKey, fieldName, isSaving) => {
    const key = getFieldSavingKey(issueKey, fieldName);
    setSavingFields((previous) => {
      if (isSaving) {
        return { ...previous, [key]: true };
      }
      const next = { ...previous };
      delete next[key];
      return next;
    });
  };

  const patchIssueLocally = (issueKey, patch) => {
    setIssues((previous) => previous.map((item) => (item.key === issueKey ? { ...item, ...patch } : item)));
  };

  const updateIssueField = async ({ issue, fieldName, updates, patch }) => {
    if (!id || !issue || !issue.projectDocId || !issue.issueId) return;
    if (isFieldSaving(issue.key, fieldName)) return;

    const previousIssue = issues.find((item) => item.key === issue.key);
    setFieldSaving(issue.key, fieldName, true);
    if (patch && previousIssue) {
      patchIssueLocally(issue.key, patch);
    }
    try {
      const issueRef = doc(
        db,
        "churches",
        id,
        "bimProjects",
        issue.projectDocId,
        "issues",
        issue.issueDocId || issue.issueId
      );
      await updateDoc(issueRef, updates);
    } catch (error) {
      if (previousIssue) {
        patchIssueLocally(issue.key, previousIssue);
      }
      toast.error("Failed to update row.");
    } finally {
      setFieldSaving(issue.key, fieldName, false);
    }
  };

  const handleProjectNameChange = async (issue, value) => {
    const nextProjectName = normalizeValue(value);
    if (nextProjectName === normalizeValue(issue.projectName)) return;
    await updateIssueField({
      issue,
      fieldName: "projectName",
      updates: { [issue.projectNameField || "Project Name"]: nextProjectName },
      patch: { projectName: nextProjectName },
    });
  };

  const handleCardReviewAssignmentChange = async (issue, value) => {
    const issueId = normalizeValue(issue?.issueId);
    const projectId = normalizeValue(issue?.projectDocId);
    const issueKey = getCardReviewIssueKey(issue);
    if (!id || !issueId || !projectId || !issueKey) return;

    const nextAssignment = normalizeValue(value);
    const previousEntry = cardReviewFieldsByIssue[issueKey] || {};
    const previousAssignment = normalizeValue(previousEntry.assignment);
    if (nextAssignment === previousAssignment) return;

    if (isFieldSaving(issue.key, "cardReviewAssignment")) return;
    setFieldSaving(issue.key, "cardReviewAssignment", true);

    setCardReviewFieldsByIssue((previous) => ({
      ...previous,
      [issueKey]: {
        ...(previous[issueKey] || {}),
        assignment: nextAssignment,
        issueId,
        projectId,
      },
      [issueId]: {
        ...(previous[issueId] || {}),
        assignment: nextAssignment,
        issueId,
        projectId,
      },
    }));

    try {
      const stepId = CARD_REVIEW_STEP_BY_LABEL[nextAssignment] || "";
      const floorProgressRef = doc(db, "churches", id, "timeRotateFloorPlanner", "floorCategoryProgress");
      if (!stepId) {
        await updateDoc(floorProgressRef, {
          [`cardReview.${projectId}.${CARD_REVIEW_UNASSIGNED_STORAGE_KEY}.${issueId}`]: deleteField(),
          updatedAt: serverTimestamp(),
        });
      } else {
        const payload = {
          cardReview: {
            [projectId]: {
              [CARD_REVIEW_UNASSIGNED_STORAGE_KEY]: {
                [issueId]: {
                  step: stepId,
                  updatedAt: Date.now(),
                },
              },
            },
          },
          updatedAt: serverTimestamp(),
        };

        await setDoc(floorProgressRef, payload, { merge: true });
      }

      setCardReviewFieldsByIssue((previous) => ({
        ...previous,
        [issueKey]: {
          ...(previous[issueKey] || {}),
          assignment: nextAssignment,
          issueId,
          projectId,
        },
        [issueId]: {
          ...(previous[issueId] || {}),
          assignment: nextAssignment,
          issueId,
          projectId,
        },
      }));
    } catch {
      setCardReviewFieldsByIssue((previous) => ({
        ...previous,
        [issueKey]: {
          ...(previous[issueKey] || {}),
          assignment: previousAssignment,
          issueId,
          projectId,
        },
        [issueId]: {
          ...(previous[issueId] || {}),
          assignment: previousAssignment,
          issueId,
          projectId,
        },
      }));
      toast.error("Could not save card review assignment.");
    } finally {
      setFieldSaving(issue.key, "cardReviewAssignment", false);
    }
  };

  const handleLeadDetailerChange = async (issue, value) => {
    const nextLeadDetailer = normalizeValue(value);
    if (nextLeadDetailer === normalizeValue(issue.e2LeadDetailer)) return;
    await updateIssueField({
      issue,
      fieldName: "e2LeadDetailer",
      updates: { [issue.leadDetailerField || "E3 Lead Detailer"]: nextLeadDetailer },
      patch: { e2LeadDetailer: nextLeadDetailer },
    });
  };

  const handleTechnicalDirectionChange = async (issue, value) => {
    const nextTechnicalDirection = normalizeValue(value);
    if (nextTechnicalDirection === normalizeValue(issue.technicalDirection)) return;
    await updateIssueField({
      issue,
      fieldName: "technicalDirection",
      updates: { [issue.technicalDirectionField || "Technical Direction"]: nextTechnicalDirection },
      patch: { technicalDirection: nextTechnicalDirection },
    });
  };

  const handleStatusChange = async (issue, value) => {
    const nextStatus = normalizeValue(value);
    if (nextStatus === normalizeValue(issue.status)) return;
    await updateIssueField({
      issue,
      fieldName: "status",
      updates: { [issue.statusField || "E2 Status Update Agile"]: nextStatus },
      patch: { status: nextStatus },
    });
  };

  const handleDueDateChange = async (issue, value) => {
    const nextDueDate = normalizeValue(value);
    if (nextDueDate === toDateInputValue(issue.e2DueDate)) return;
    await updateIssueField({
      issue,
      fieldName: "e2DueDate",
      updates: { [issue.dueDateField || "e2DueDate"]: nextDueDate },
      patch: { e2DueDate: nextDueDate },
    });
  };

  const handlePercentDraftChange = (issueKey, value) => {
    const normalized = Math.max(0, Math.min(Number(value) || 0, 100));
    setPercentDrafts((previous) => ({ ...previous, [issueKey]: normalized }));
  };

  const commitPercentChange = (issue, rawValue) => {
    const draftValue = percentDrafts[issue.key];
    const candidateValue = draftValue !== undefined ? draftValue : rawValue;
    if (candidateValue === undefined || candidateValue === null) return;

    const normalized = Math.max(0, Math.min(Number(candidateValue) || 0, 100));
    const previousValue =
      typeof issue.percentCompleted === "number"
        ? Math.max(0, Math.min(Math.round(issue.percentCompleted), 100))
        : 0;

    if (normalized === previousValue) {
      setPercentDrafts((previous) => {
        const next = { ...previous };
        delete next[issue.key];
        return next;
      });
      return;
    }

    // Follow Agile Board flow: open update modal and only persist after Save.
    if (updateModal.open && updateModal.issue?.key === issue.key) return;
    setUpdateModal({ open: true, issue });
    setModalPercent(normalized);
    setNewUpdate("");
    const logEntries = Array.isArray(issue.logEntries) ? issue.logEntries : [];
    const latest = getLatestLogEntry(logEntries);
    setLatestUpdate({
      text: latest?.update || "",
      percentCompleted: typeof latest?.percent === "number" ? latest.percent : null,
      date: latest?.timestamp || latest?.date || latest?.createdAt || null,
    });
  };

  const closeUpdateModal = () => {
    setPercentDrafts((previous) => {
      const next = { ...previous };
      if (updateModal?.issue?.key) {
        delete next[updateModal.issue.key];
      }
      return next;
    });
    setUpdateModal({ open: false, issue: null });
  };

  const closeAddIssuePopup = () => {
    if (savingNewIssue) return;
    setShowAddIssuePopup(false);
    setAddIssueStep(1);
    setNewIssueFormData({});
  };

  const validateAddIssueStep = (step) => {
    const requiredByStep = {
      1: ["Title", "Project Name"],
      2: ["Requester", "Lead Detailer"],
      3: ["Data Environment", "Send to Agile"],
    };
    const requiredFields = requiredByStep[step] || [];
    const missing = requiredFields.filter((field) => !normalizeValue(newIssueFormData[field]));
    if (missing.length) {
      toast.error(`Missing required: ${missing.join(", ")}`);
      return false;
    }
    return true;
  };

  const goToNextAddIssueStep = () => {
    if (typeof document !== "undefined" && document.activeElement?.blur) {
      document.activeElement.blur();
    }
    if (!validateAddIssueStep(addIssueStep)) return;
    setAddIssueStep((previous) => Math.min(previous + 1, 4));
  };

  const goToPreviousAddIssueStep = () => {
    setAddIssueStep((previous) => Math.max(previous - 1, 1));
  };

  const handleCreateNewIssue = async () => {
    if (!validateAddIssueStep(1) || !validateAddIssueStep(2) || !validateAddIssueStep(3)) {
      return;
    }

    setSavingNewIssue(true);
    try {
      const projectDocId = await resolveTargetProjectDocId(newIssueFormData["Project Name"]);
      if (!projectDocId) {
        toast.error("No target project found to create the issue.");
        return;
      }

      const issueId =
        newIssueFormData.ID ||
        buildNextTDIssueId(issues.map((item) => item.issueId));
      const sendToAgile = true;

      const newIssue = {
        id: issueId,
        ID: issueId,
        Title: normalizeValue(newIssueFormData["Title"]),
        "Project Name": normalizeValue(newIssueFormData["Project Name"]),
        Assignee: normalizeValue(newIssueFormData["Requester"]),
        "E2 Detailer": normalizeValue(newIssueFormData["Lead Detailer"]),
        "E2 Tags": normalizeValue(newIssueFormData["E2 Tags"]),
        "E2 Detailer Support Team": Array.isArray(newIssueFormData["Support Team"])
          ? newIssueFormData["Support Team"]
          : [],
        "Data Stage": "Production",
        status: "Open",
        "Disable Flag": sendToAgile ? "Yes" : "No",
        "E2 Status Update Agile": sendToAgile ? "To Do List" : "",
      };

      await setDoc(doc(db, "churches", id, "bimProjects", projectDocId, "issues", issueId), newIssue);
      setIssues((previous) => {
        const nextIssue = {
          key: `${projectDocId}-${issueId}`,
          projectDocId,
          issueDocId: issueId,
          issueId,
          title: normalizeValue(newIssue.Title) || "Untitled issue",
          projectName: normalizeValue(newIssue["Project Name"]),
          e2Tags: normalizeValue(newIssue["E2 Tags"]),
          status: normalizeValue(newIssue["E2 Status Update Agile"]),
          e2LeadDetailer: normalizeValue(newIssue["E2 Detailer"]),
          dataStage: normalizeValue(newIssue["Data Stage"]),
          technicalDirection: normalizeValue(newIssue["Technical Direction"]),
          developmentCycleCounter: 0,
          e2DueDate: "",
          permanentDeadlineLabel: "",
          permanentDeadlineColor: "",
          latestUpdateText: "",
          latestUpdateDate: null,
          percentCompleted: null,
          tags: "",
          zone: "",
          projectNameField: "Project Name",
          statusField: "E2 Status Update Agile",
          leadDetailerField: "E3 Lead Detailer",
          technicalDirectionField: "Technical Direction",
          dueDateField: "e2DueDate",
          logEntries: [],
        };

        const existingIndex = previous.findIndex((item) => item.key === nextIssue.key);
        if (existingIndex >= 0) {
          const next = previous.slice();
          next[existingIndex] = { ...next[existingIndex], ...nextIssue };
          return next;
        }

        return [...previous, nextIssue];
      });
      closeAddIssuePopup();
      toast.success(`Issue ${issueId} was created.`);
    } catch (err) {
      toast.error("Could not create the new issue.");
    } finally {
      setSavingNewIssue(false);
    }
  };

  const openColumnPreferencesPopup = () => {
    setColumnPreferencesDraft(visibleColumns);
    setShowColumnPreferencesPopup(true);
  };

  const closeColumnPreferencesPopup = () => {
    if (savingColumnPreferences) return;
    setShowColumnPreferencesPopup(false);
  };

  const toggleColumnPreferenceDraft = (columnName) => {
    setColumnPreferencesDraft((previous) => {
      if (previous.includes(columnName)) {
        const next = previous.filter((column) => column !== columnName);
        return next.length ? next : previous;
      }
      return [...previous, columnName];
    });
  };

  const moveColumnPreferenceDraft = (columnName, direction) => {
    setColumnPreferencesDraft((previous) => {
      const currentIndex = previous.indexOf(columnName);
      if (currentIndex === -1) return previous;

      const targetIndex = currentIndex + direction;
      if (targetIndex < 0 || targetIndex >= previous.length) return previous;

      const next = [...previous];
      const [moved] = next.splice(currentIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  };

  const saveColumnPreferencesForOrganization = async () => {
    const normalizedDraft = normalizeVisibleColumns(columnPreferencesDraft);
    if (!id) return;
    setSavingColumnPreferences(true);
    try {
      const configRef = doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID);
      await setDoc(
        configRef,
        {
          [AGILE_DATA_TABLE_VISIBLE_COLUMNS_FIELD]: normalizedDraft,
        },
        { merge: true }
      );
      setVisibleColumns(normalizedDraft);
      setShowColumnPreferencesPopup(false);
      toast.success("Saved default column visibility for this organization.");
    } catch {
      toast.error("Could not save column visibility preferences.");
    } finally {
      setSavingColumnPreferences(false);
    }
  };

  const activeExportFilters = useMemo(
    () => [
      { label: "Search", value: searchTerm.trim() || "All" },
      {
        label: "Project Name",
        value: selectedProjectNames.length === 0 ? "All Projects" : selectedProjectNames.join(", "),
      },
      {
        label: "E2 Lead Detailer",
        value: selectedE2LeadDetailer === "All" ? "All Detailers" : selectedE2LeadDetailer,
      },
      {
        label: "E2 Status Update Agile",
        value: selectedE2StatusAgile === "All" ? "All Statuses" : selectedE2StatusAgile,
      },
      { label: "Data Stage", value: selectedDataStage === "All" ? "All" : selectedDataStage },
    ],
    [searchTerm, selectedProjectNames, selectedE2LeadDetailer, selectedE2StatusAgile, selectedDataStage]
  );

  const exportGroups = useMemo(
    () =>
      groupedIssuesByProjectAndStatus.map((group) => ({
        projectName: group.projectName,
        cardCount: group.rows.length,
        statusGroups: group.statusGroups.map((statusGroup) => ({
          status: statusGroup.status,
          cardCount: statusGroup.rows.length,
          rows: statusGroup.rows.map((issue) => ({
            issueKey: issue.key,
            "Issue ID": issue.issueId || "-",
            "Project Name": getProjectNameDisplay(issue, tagAliasByLowerTag) || "-",
            "Total Hours": (() => {
              const cardIdentity = buildCardIdentity(issue.projectDocId, issue.issueId);
              const hoursByIdentity = totalHoursByCard.byIdentity?.[cardIdentity];
              const hoursByIssueId = totalHoursByCard.byIssueId?.[normalizeValue(issue.issueId)];
              const hours = hoursByIdentity ?? hoursByIssueId ?? 0;
              return hours > 0 ? hours : "-";
            })(),
            Title: issue.title || "-",
            "Card Review Assignment":
              getCardReviewAssignmentForIssue(cardReviewFieldsByIssue, issue) || "-",
            "E2 Status Update Agile": issue.status || "-",
            "E2 Lead Detailer": issue.e2LeadDetailer || "-",
            "Data Stage": issue.dataStage || "-",
            "Technical Direction": issue.technicalDirection || "-",
            "Cycle Count": Number.isFinite(issue.developmentCycleCounter) ? issue.developmentCycleCounter : 0,
            "Percent Completed":
              typeof issue.percentCompleted === "number"
                ? `${Math.max(0, Math.min(Math.round(issue.percentCompleted), 100))}%`
                : "0%",
            "Due Date": toDateInputValue(issue.e2DueDate) || "-",
            Deadline: getDeadlineDisplay(issue).label,
            "Latest Update": issue.latestUpdateText || "-",
            "Last Update Time": formatDateTime(issue.latestUpdateDate),
          })),
        })),
      })),
    [cardReviewFieldsByIssue, groupedIssuesByProjectAndStatus, tagAliasByLowerTag, totalHoursByCard]
  );

  const handleOpenPdf = async () => {
    if (openingPdf) return;

    setOpeningPdf(true);
    try {
      const generatedAt = new Date().toLocaleString();
      const blob = await pdf(
        <AgileDataTablePDF
          organizationName={id}
          exportedAt={generatedAt}
          filters={activeExportFilters}
          groups={exportGroups}
          visibleColumns={visibleColumns}
        />
      ).toBlob();

      const blobUrl = URL.createObjectURL(blob);
      const previewWindow = window.open(blobUrl, "_blank", "noopener,noreferrer");

      if (!previewWindow) {
        URL.revokeObjectURL(blobUrl);
        toast.error("The browser blocked the PDF preview window.");
        return;
      }

      window.setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
      }, 60_000);
    } catch {
      toast.error("Could not generate the PDF export.");
    } finally {
      setOpeningPdf(false);
    }
  };

  const renderIssueTableCell = (issue, columnName) => {
    switch (columnName) {
      case "Issue ID":
        return (
          <td key={`${issue.key}-${columnName}`}>
            <Link
              to={`/organization/${id}/project-issue-dashboard/issue/${issue.projectDocId}/${issue.issueId}`}
              className="agile-data-table-issue-link"
            >
              {issue.issueId || "-"}
            </Link>
          </td>
        );
      case "Project Name":
        return (
          <td key={`${issue.key}-${columnName}`}>
            <select
              className="agile-data-table-cell-input"
              value={normalizeValue(issue.projectName)}
              onChange={(event) => handleProjectNameChange(issue, event.target.value)}
              disabled={isFieldSaving(issue.key, "projectName")}
            >
              <option value="">Select project</option>
              {projectNameOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </td>
        );
      case "Total Hours": {
        const cardIdentity = buildCardIdentity(issue.projectDocId, issue.issueId);
        const hoursByIdentity = totalHoursByCard.byIdentity?.[cardIdentity];
        const hoursByIssueId = totalHoursByCard.byIssueId?.[normalizeValue(issue.issueId)];
        const hours = hoursByIdentity ?? hoursByIssueId ?? 0;
        return <td key={`${issue.key}-${columnName}`}>{hours > 0 ? hours : "-"}</td>;
      }
      case "Title":
        return (
          <td key={`${issue.key}-${columnName}`}>
            {editingTitleKey === issue.key ? (
              <input
                className="agile-data-table-cell-input"
                type="text"
                value={titleDraft}
                autoFocus
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={async () => {
                  await handleTitleChange(issue, titleDraft);
                  setEditingTitleKey(null);
                }}
                onKeyDown={async (event) => {
                  if (event.key === "Enter") {
                    await handleTitleChange(issue, titleDraft);
                    setEditingTitleKey(null);
                  } else if (event.key === "Escape") {
                    setEditingTitleKey(null);
                  }
                }}
                disabled={isFieldSaving(issue.key, "title")}
              />
            ) : (
              <span
                className="agile-data-table-title-text agile-data-table-title-editable"
                tabIndex={0}
                style={{ cursor: "pointer" }}
                onClick={() => {
                  setEditingTitleKey(issue.key);
                  setTitleDraft(issue.title || "");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    setEditingTitleKey(issue.key);
                    setTitleDraft(issue.title || "");
                  }
                }}
              >
                {issue.title || "-"}
                <span
                  className="agile-data-table-title-edit-icon"
                  style={{ marginLeft: 6, color: "#64748b", fontSize: 13 }}
                >
                  ✏️
                </span>
              </span>
            )}
          </td>
        );
      case "Card Review Assignment":
        return (
          <td key={`${issue.key}-${columnName}`}>
            <select
              className="agile-data-table-cell-input"
              value={getCardReviewAssignmentForIssue(cardReviewFieldsByIssue, issue)}
              onChange={(event) => handleCardReviewAssignmentChange(issue, event.target.value)}
              disabled={isFieldSaving(issue.key, "cardReviewAssignment")}
            >
              <option value="">Unassigned</option>
              {CARD_REVIEW_ASSIGNMENT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </td>
        );
      case "E2 Status Update Agile":
        return (
          <td key={`${issue.key}-${columnName}`}>
            <select
              className="agile-data-table-cell-input"
              value={normalizeValue(issue.status)}
              onChange={(event) => handleStatusChange(issue, event.target.value)}
              disabled={isFieldSaving(issue.key, "status")}
            >
              {statusOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </td>
        );
      case "E2 Lead Detailer":
        return (
          <td key={`${issue.key}-${columnName}`}>
            <select
              className="agile-data-table-cell-input"
              value={normalizeValue(issue.e2LeadDetailer)}
              onChange={(event) => handleLeadDetailerChange(issue, event.target.value)}
              disabled={isFieldSaving(issue.key, "e2LeadDetailer")}
            >
              <option value="">Unassigned</option>
              {detailerOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </td>
        );
      case "Data Stage":
        return <td key={`${issue.key}-${columnName}`}>{issue.dataStage || "-"}</td>;
      case "Technical Direction":
        return (
          <td key={`${issue.key}-${columnName}`}>
            <select
              className="agile-data-table-cell-input"
              value={normalizeValue(issue.technicalDirection)}
              onChange={(event) => handleTechnicalDirectionChange(issue, event.target.value)}
              disabled={isFieldSaving(issue.key, "technicalDirection")}
            >
              <option value="">-</option>
              {TECHNICAL_DIRECTION_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </td>
        );
      case "Cycle Count":
        return (
          <td key={`${issue.key}-${columnName}`}>
            {Number.isFinite(issue.developmentCycleCounter) ? issue.developmentCycleCounter : 0}
          </td>
        );
      case "Percent Completed":
        return (
          <td key={`${issue.key}-${columnName}`}>
            <div className="agile-percent-slider-wrap">
              <input
                className="agile-percent-slider"
                type="range"
                min={0}
                max={100}
                step={1}
                value={
                  percentDrafts[issue.key] !== undefined
                    ? percentDrafts[issue.key]
                    : typeof issue.percentCompleted === "number"
                    ? Math.max(0, Math.min(Math.round(issue.percentCompleted), 100))
                    : 0
                }
                onChange={(event) => {
                  handlePercentDraftChange(issue.key, event.target.value);
                }}
                onPointerUp={(event) => commitPercentChange(issue, event.target.value)}
                onKeyUp={(event) => commitPercentChange(issue, event.target.value)}
                disabled={isFieldSaving(issue.key, "percentCompleted")}
              />
              <span className="agile-percent-slider-value">
                {(percentDrafts[issue.key] !== undefined
                  ? percentDrafts[issue.key]
                  : typeof issue.percentCompleted === "number"
                  ? Math.max(0, Math.min(Math.round(issue.percentCompleted), 100))
                  : 0)}
                %
              </span>
            </div>
          </td>
        );
      case "Due Date":
        return (
          <td key={`${issue.key}-${columnName}`}>
            <input
              className="agile-data-table-cell-input"
              type="date"
              value={toDateInputValue(issue.e2DueDate)}
              onChange={(event) => handleDueDateChange(issue, event.target.value)}
              disabled={isFieldSaving(issue.key, "e2DueDate")}
            />
          </td>
        );
      case "Deadline": {
        const deadline = getDeadlineDisplay(issue);
        return (
          <td key={`${issue.key}-${columnName}`}>
            <span style={{ color: deadline.color }}>{deadline.label}</span>
          </td>
        );
      }
      case "Latest Update":
        return <td key={`${issue.key}-${columnName}`}>{issue.latestUpdateText || "-"}</td>;
      case "Last Update Time":
        return <td key={`${issue.key}-${columnName}`}>{formatDateTime(issue.latestUpdateDate)}</td>;
      default:
        return <td key={`${issue.key}-${columnName}`}>-</td>;
    }
  };

  if (loading) {
    return <div className="agile-data-table-loading">Loading Agile Data Table Module...</div>;
  }

  return (
    <div className="agile-data-table-wrapper">
      {organizationLogoUrl ? (
        <div className="agile-data-table-org-logo-wrap">
          <img
            src={organizationLogoUrl}
            alt="Organization logo"
            className="agile-data-table-org-logo"
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
        </div>
      ) : null}

      <div className="agile-data-table-header">
        <Link to={`/organization/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
          Back to Mi Organizacion
        </Link>
        <h1>Agile Data Table Module</h1>
        <p>Same E2 Agile Board data in a tabular format for easier review and management.</p>
        <button
          type="button"
          className="project-issue-add-btn"
          style={{ marginTop: 10, marginBottom: 48 }}
          onClick={() => {
            setNewIssueFormData(buildNewIssueFormData());
            setAddIssueStep(1);
            setShowAddIssuePopup(true);
          }}
        >
          ➕ Add a New Issue/Task
        </button>
        <button
          type="button"
          className="agile-data-table-action-button"
          style={{ width: "fit-content" }}
          onClick={openColumnPreferencesPopup}
        >
          Manage Visible Columns
        </button>
      </div>

      {showColumnPreferencesPopup ? (
        <div
          className="project-issue-popup-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Manage visible columns"
          onClick={closeColumnPreferencesPopup}
        >
          <div className="project-issue-add-window" onClick={(event) => event.stopPropagation()}>
            <div className="project-issue-popup-head">
              <strong className="project-issue-popup-title">Visible Columns (Organization Default)</strong>
              <button type="button" className="project-issue-popup-close" onClick={closeColumnPreferencesPopup}>
                Close
              </button>
            </div>
            <div className="agile-column-picker-grid">
              {AGILE_DATA_TABLE_COLUMNS.map((columnName) => (
                <label key={columnName} className="agile-column-picker-item">
                  <input
                    type="checkbox"
                    checked={columnPreferencesDraft.includes(columnName)}
                    onChange={() => toggleColumnPreferenceDraft(columnName)}
                    disabled={savingColumnPreferences}
                  />
                  <span className="agile-column-picker-label">{columnName}</span>
                  {columnPreferencesDraft.includes(columnName) ? (
                    <span className="agile-column-picker-order">#{columnPreferencesDraft.indexOf(columnName) + 1}</span>
                  ) : null}
                  <span className="agile-column-picker-actions">
                    <button
                      type="button"
                      className="agile-column-order-btn"
                      onClick={() => moveColumnPreferenceDraft(columnName, -1)}
                      disabled={
                        savingColumnPreferences ||
                        !columnPreferencesDraft.includes(columnName) ||
                        columnPreferencesDraft.indexOf(columnName) === 0
                      }
                      aria-label={`Move ${columnName} left`}
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="agile-column-order-btn"
                      onClick={() => moveColumnPreferenceDraft(columnName, 1)}
                      disabled={
                        savingColumnPreferences ||
                        !columnPreferencesDraft.includes(columnName) ||
                        columnPreferencesDraft.indexOf(columnName) === columnPreferencesDraft.length - 1
                      }
                      aria-label={`Move ${columnName} right`}
                      title="Move down"
                    >
                      ↓
                    </button>
                  </span>
                </label>
              ))}
            </div>
            <div className="project-issue-add-actions">
              <button
                type="button"
                className="project-issue-popup-close"
                onClick={closeColumnPreferencesPopup}
                disabled={savingColumnPreferences}
              >
                Cancel
              </button>
              <button
                type="button"
                className="project-issue-add-save-btn"
                onClick={saveColumnPreferencesForOrganization}
                disabled={savingColumnPreferences}
              >
                {savingColumnPreferences ? "Saving..." : "Save for Organization"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Add Issue Popup (dynamic, Firestore-backed, full parity) */}
      {showAddIssuePopup && (
        <div
          className="project-issue-popup-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Add a new issue"
          onClick={closeAddIssuePopup}
        >
          <div className="project-issue-add-window" onClick={e => e.stopPropagation()}>
            <div className="project-issue-popup-head">
              <strong className="project-issue-popup-title">Add New Issue</strong>
              <button type="button" className="project-issue-popup-close" onClick={closeAddIssuePopup}>
                Close
              </button>
            </div>
            <form className="project-issue-add-form" onSubmit={(event) => event.preventDefault()}>
              <div className="agile-add-stepper">
                {["IR / ID + Core", "People", "Environment", "Preview"].map((stepLabel, index) => {
                  const stepNumber = index + 1;
                  const isActive = addIssueStep === stepNumber;
                  const isDone = addIssueStep > stepNumber;
                  return (
                    <div key={stepLabel} className={`agile-add-step ${isActive ? "is-active" : ""} ${isDone ? "is-done" : ""}`}>
                      <span className="agile-add-step-index">{stepNumber}</span>
                      <span className="agile-add-step-text">{stepLabel}</span>
                    </div>
                  );
                })}
              </div>

              {addIssueStep === 1 ? (
                <div className="project-issue-add-grid" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <label className="project-issue-add-field">
                    <span className="project-issue-add-label">IR / ID</span>
                    <input className="project-issue-add-input" value={newIssueFormData.ID || ""} readOnly disabled />
                  </label>
                  <label className="project-issue-add-field">
                    <span className="project-issue-add-label">Title <span className="project-issue-add-required">*</span></span>
                    <input
                      className="project-issue-add-input"
                      value={newIssueFormData.Title || ""}
                      onChange={(event) => setNewIssueFormData((previous) => ({ ...previous, Title: event.target.value }))}
                      placeholder="Issue title"
                    />
                  </label>
                  <label className="project-issue-add-field">
                    <span className="project-issue-add-label">Project Name <span className="project-issue-add-required">*</span></span>
                    <SearchableSelect
                      value={newIssueFormData["Project Name"] || ""}
                      onChange={async (value) => {
                        if (value && typeof value === 'object' && value.addNew) {
                          // Add new project name to Firestore settings
                          const configRef = doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID);
                          const newProjectName = value.value;
                          await updateDoc(configRef, {
                            [PROJECT_NAME_VALUES_FIELD]: Array.from(new Set([...(projectNameValues || []), newProjectName]))
                          });
                          setProjectNameValues(prev => Array.from(new Set([...(prev || []), newProjectName])));
                          setNewIssueFormData((previous) => ({ ...previous, "Project Name": newProjectName }));
                        } else {
                          setNewIssueFormData((previous) => ({ ...previous, "Project Name": value }));
                        }
                      }}
                      options={projectNameOptions}
                      placeholder="Type to search project name"
                    />
                  </label>
                  <label className="project-issue-add-field">
                    <span className="project-issue-add-label">E2 Tags</span>
                    <SearchableSelect
                      value={newIssueFormData["E2 Tags"] || ""}
                      onChange={async (value) => {
                        if (value && typeof value === 'object' && value.addNew) {
                          // Add new tag to Firestore settings
                          const configRef = doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID);
                          const newTag = value.value;
                          await updateDoc(configRef, {
                            e2TagValues: Array.from(new Set([...(e2TagConfigOptions || []), newTag]))
                          });
                          setE2TagConfigOptions(prev => Array.from(new Set([...(prev || []), newTag])));
                          setNewIssueFormData((previous) => ({ ...previous, "E2 Tags": newTag }));
                        } else {
                          setNewIssueFormData((previous) => ({ ...previous, "E2 Tags": value }));
                        }
                      }}
                      options={addIssueTagOptions}
                      placeholder="Type to search E2 tags"
                    />
                  </label>
                </div>
              ) : null}

              {addIssueStep === 2 ? (
                <div className="project-issue-add-grid" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <label className="project-issue-add-field">
                    <span className="project-issue-add-label">Requester <span className="project-issue-add-required">*</span></span>
                    <SearchableSelect
                      value={newIssueFormData.Requester || ""}
                      onChange={async (value) => {
                        if (value && typeof value === 'object' && value.addNew) {
                          // Add new detailer to Firestore settings (Requester shares detailerOptions)
                          const configRef = doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID);
                          const newDetailer = value.value;
                          await updateDoc(configRef, {
                            e2DetailerOptions: Array.from(new Set([...(e2LeadDetailerOptions || []), newDetailer]))
                          });
                          setE2LeadDetailerOptions(prev => Array.from(new Set([...(prev || []), newDetailer])));
                          setNewIssueFormData((previous) => ({ ...previous, Requester: newDetailer }));
                        } else {
                          setNewIssueFormData((previous) => ({ ...previous, Requester: value }));
                        }
                      }}
                      options={detailerOptions}
                      placeholder="Type to search requester"
                    />
                  </label>
                  <label className="project-issue-add-field">
                    <span className="project-issue-add-label">Lead Detailer <span className="project-issue-add-required">*</span></span>
                    <SearchableSelect
                      value={newIssueFormData["Lead Detailer"] || ""}
                      onChange={async (value) => {
                        if (value && typeof value === 'object' && value.addNew) {
                          // Add new detailer to Firestore settings
                          const configRef = doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID);
                          const newDetailer = value.value;
                          await setDoc(configRef, {
                            e2DetailerOptions: Array.from(new Set([...(e2LeadDetailerOptions || []), newDetailer]))
                          }, { merge: true });
                          setE2LeadDetailerOptions(prev => Array.from(new Set([...(prev || []), newDetailer])));
                          setNewIssueFormData((previous) => ({ ...previous, "Lead Detailer": newDetailer }));
                        } else {
                          setNewIssueFormData((previous) => ({ ...previous, "Lead Detailer": value }));
                        }
                      }}
                      options={detailerOptions}
                      placeholder="Type to search lead detailer"
                    />
                  </label>
                  <label className="project-issue-add-field">
                    <span className="project-issue-add-label">Support Team</span>
                    <SearchableMultiSelect
                      values={Array.isArray(newIssueFormData["Support Team"]) ? newIssueFormData["Support Team"] : []}
                      onChange={(values) => setNewIssueFormData((previous) => ({ ...previous, "Support Team": values }))}
                      options={detailerOptions}
                      placeholder="Type to add support team"
                      isOptionDisabled={(option) => normalizeValue(option) === normalizeValue(newIssueFormData["Lead Detailer"])}
                      onAddNew={async (newValue) => {
                        // Add new detailer to Firestore settings
                        const configRef = doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID);
                        await updateDoc(configRef, {
                          e2DetailerOptions: Array.from(new Set([...(e2LeadDetailerOptions || []), newValue]))
                        });
                        setE2LeadDetailerOptions(prev => Array.from(new Set([...(prev || []), newValue])));
                        setNewIssueFormData((previous) => ({
                          ...previous,
                          "Support Team": Array.from(new Set([...(Array.isArray(previous["Support Team"]) ? previous["Support Team"] : []), newValue]))
                        }));
                      }}
                    />
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                      Lead Detailer is excluded from Support Team.
                    </div>
                  </label>
                </div>
              ) : null}

              {addIssueStep === 3 ? (
                <div className="project-issue-add-grid" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <label className="project-issue-add-field">
                    <span className="project-issue-add-label">Data Environment</span>
                    <SearchableSelect
                      value={newIssueFormData["Data Environment"] || "Production"}
                      onChange={() => {}}
                      options={dataEnvironmentOptions}
                      placeholder="Data environment"
                      disabled
                    />
                  </label>
                  <label className="project-issue-add-field">
                    <span className="project-issue-add-label">Send to Agile</span>
                    <SearchableSelect
                      value={newIssueFormData["Send to Agile"] || "Yes"}
                      onChange={() => {}}
                      options={["Yes", "No"]}
                      placeholder="Send to Agile"
                      disabled
                    />
                  </label>
                </div>
              ) : null}

              {addIssueStep === 4 ? (
                <div className="agile-add-preview">
                  <h4>Review Before Submit</h4>
                  <div className="agile-add-preview-grid">
                    <button type="button" className="agile-add-preview-section-btn" style={{ textAlign: "left" }} onClick={() => setAddIssueStep(1)}>
                      <strong>IR / ID:</strong> {newIssueFormData.ID || "-"}
                    </button>
                    <button type="button" className="agile-add-preview-section-btn" style={{ textAlign: "left" }} onClick={() => setAddIssueStep(1)}>
                      <strong>Title:</strong>
                      <input
                        className="project-issue-add-input agile-add-preview-title-input"
                        style={{ marginLeft: 8, minWidth: 180 }}
                        value={newIssueFormData.Title || ""}
                        onChange={e => setNewIssueFormData(prev => ({ ...prev, Title: e.target.value }))}
                        placeholder="Issue title"
                        tabIndex={-1}
                        readOnly
                      />
                      <span style={{ marginLeft: 8, color: "#64748b", fontSize: 12 }}>(Edit in Step 1)</span>
                    </button>
                    <button type="button" className="agile-add-preview-section-btn" style={{ textAlign: "left" }} onClick={() => setAddIssueStep(1)}>
                      <strong>Project Name:</strong> {newIssueFormData["Project Name"] || "-"}
                    </button>
                    <button type="button" className="agile-add-preview-section-btn" style={{ textAlign: "left" }} onClick={() => setAddIssueStep(1)}>
                      <strong>E2 Tags:</strong> {newIssueFormData["E2 Tags"] || "-"}
                    </button>
                    <button type="button" className="agile-add-preview-section-btn" style={{ textAlign: "left" }} onClick={() => setAddIssueStep(2)}>
                      <strong>Requester:</strong> {newIssueFormData.Requester || "-"}
                    </button>
                    <button type="button" className="agile-add-preview-section-btn" style={{ textAlign: "left" }} onClick={() => setAddIssueStep(2)}>
                      <strong>Lead Detailer:</strong> {newIssueFormData["Lead Detailer"] || "-"}
                    </button>
                    <button type="button" className="agile-add-preview-section-btn" style={{ textAlign: "left" }} onClick={() => setAddIssueStep(2)}>
                      <strong>Support Team:</strong> {Array.isArray(newIssueFormData["Support Team"]) && newIssueFormData["Support Team"].length
                        ? newIssueFormData["Support Team"].join(", ")
                        : "-"}
                    </button>
                    <button type="button" className="agile-add-preview-section-btn" style={{ textAlign: "left" }} onClick={() => setAddIssueStep(3)}>
                      <strong>Data Environment:</strong> {newIssueFormData["Data Environment"] || "Production"}
                    </button>
                    <button type="button" className="agile-add-preview-section-btn" style={{ textAlign: "left" }} onClick={() => setAddIssueStep(3)}>
                      <strong>Send to Agile:</strong> {newIssueFormData["Send to Agile"] || "Yes"}
                    </button>
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 8 }}>
                    Click any section to edit that part of the form.
                  </div>
                </div>
              ) : null}

              <div className="project-issue-add-actions">
                <button type="button" className="project-issue-popup-close" onClick={closeAddIssuePopup} disabled={savingNewIssue}>
                  Cancel
                </button>
                {addIssueStep > 1 ? (
                  <button type="button" className="agile-data-table-action-button" onClick={goToPreviousAddIssueStep} disabled={savingNewIssue}>
                    Back
                  </button>
                ) : null}
                {addIssueStep < 4 ? (
                  <button type="button" className="project-issue-add-save-btn" onClick={goToNextAddIssueStep} disabled={savingNewIssue}>
                    Next
                  </button>
                ) : (
                  <button type="button" className="project-issue-add-save-btn" onClick={handleCreateNewIssue} disabled={savingNewIssue}>
                    {savingNewIssue ? "Saving..." : "Submit Issue"}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="agile-data-table-filters">
        <label>
          Search
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Issue ID, title, or project"
          />
        </label>

        <label>
          Project Name
          <SearchableMultiSelect
            values={selectedProjectNames}
            onChange={setSelectedProjectNames}
            options={projectNameOptions}
            placeholder="Search and select projects"
          />
        </label>

        <label>
          E2 Lead Detailer
          <select value={selectedE2LeadDetailer} onChange={(event) => setSelectedE2LeadDetailer(event.target.value)}>
            <option value="All">All Detailers</option>
            {detailerOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label>
          E2 Status Update Agile
          <select value={selectedE2StatusAgile} onChange={(event) => setSelectedE2StatusAgile(event.target.value)}>
            <option value="All">All Statuses</option>
            {statusOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label>
          Data Stage
          <select value={selectedDataStage} onChange={(event) => setSelectedDataStage(event.target.value)}>
            <option value="All">All</option>
            <option value="Testing">Testing</option>
            <option value="Production">Production</option>
          </select>
        </label>
      </div>

      <div className="agile-data-table-summary">
        <span>Showing {visibleIssues.length} of {issues.length} total cards</span>
        <button
          type="button"
          className="agile-data-table-action-button agile-data-table-export-button"
          onClick={handleOpenPdf}
          disabled={openingPdf || visibleIssues.length === 0}
        >
          {openingPdf ? "Generating PDF..." : "Open PDF in Browser"}
        </button>
      </div>

      {groupedIssuesByProjectAndStatus.map((group) => (
        <section key={group.projectName} className="agile-data-table-group">
          <div className="agile-data-table-group-header">
            <h2>
              <span className="agile-section-name-icon" aria-hidden="true">📁</span>
              {String(group.projectName || "-").toUpperCase()}
            </h2>
            <span>{group.rows.length} card(s)</span>
          </div>

          {group.statusGroups.map((statusGroup) => (
            <div key={`${group.projectName}-${statusGroup.status}`} className="agile-data-table-status-group">
              <div className="agile-data-table-status-group-header">
                <h3>
                  <span className="agile-section-name-icon" aria-hidden="true">🧩</span>
                  {String(statusGroup.status || "-").toUpperCase()}
                </h3>
                <span>{statusGroup.rows.length} card(s)</span>
              </div>

              <div className="agile-data-table-scroll">
                <table className="agile-data-table">
                  <thead>
                    <tr>
                      {visibleColumns.map((columnName) => (
                        <th key={columnName}>{columnName}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {statusGroup.rows.map((issue) => {
                      return (
                        <tr key={issue.key}>
                          {visibleColumns.map((columnName) => renderIssueTableCell(issue, columnName))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </section>
      ))}

      {groupedIssuesByProjectAndStatus.length === 0 && (
        <div className="agile-data-table-scroll">
          <table className="agile-data-table">
            <tbody>
              <tr>
                <td colSpan={Math.max(visibleColumns.length, 1)} className="agile-data-table-empty">
                  No agile cards match the selected filters.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {/* Update Modal for percent completed */}
      <AgileUpdateModal
        isOpen={updateModal.open}
        onClose={closeUpdateModal}
        latestUpdate={latestUpdate}
        newUpdate={newUpdate}
        onChange={setNewUpdate}
        percentCompleted={modalPercent}
        onPercentChange={setModalPercent}
        loading={updateLoading}
        churchId={id}
        issue={updateModal.issue}
        onSave={async () => {
          if (!updateModal.issue || !newUpdate.trim()) return;
          setUpdateLoading(true);
          try {
            const { issue } = updateModal;
            const issueRef = doc(
              db,
              "churches",
              id,
              "bimProjects",
              issue.projectDocId,
              "issues",
              issue.issueDocId || issue.issueId
            );
            // Fetch current log entries
            const issueSnap = await (await import("firebase/firestore")).getDoc(issueRef);
            const issueData = issueSnap.exists() ? issueSnap.data() : {};
            const prevLog = Array.isArray(issueData.LogEntries) ? issueData.LogEntries : [];
            const now = new Date().toISOString();
            const logEntry = {
              update: newUpdate.trim(),
              percent: Number(modalPercent) || 0,
              timestamp: now,
            };
            const nextLog = [logEntry, ...prevLog];
            await updateDoc(issueRef, {
              LogEntries: nextLog,
              percentCompleted: Number(modalPercent) || 0,
              "Percent Completed": Number(modalPercent) || 0,
            });
            // Optimistically update local issues state for instant UI feedback
            setIssues((prevIssues) => prevIssues.map((i) => {
              if (
                (i.issueDocId || i.issueId) === (issue.issueDocId || issue.issueId) &&
                i.projectDocId === issue.projectDocId
              ) {
                return { ...i, logEntries: nextLog, percentCompleted: logEntry.percent, latestUpdateText: logEntry.update, latestUpdateDate: logEntry.timestamp };
              }
              return i;
            }));
            setLatestUpdate({ text: logEntry.update, percentCompleted: logEntry.percent, date: logEntry.timestamp });
            setNewUpdate("");
            setModalPercent(0);
            setPercentDrafts((previous) => {
              const next = { ...previous };
              delete next[issue.key];
              return next;
            });
            setUpdateModal({ open: false, issue: null });
          } finally {
            setUpdateLoading(false);
          }
        }}
      />
    </div>
  );
};

export default AgileDataTableModule;