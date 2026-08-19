import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { toast } from "react-toastify";
import ChurchHeader from "./ChurchHeader";
import { useAuth } from "../contexts/AuthContext";
import { db } from "../firebase";
import { hasPermission } from "../utils/enhancedPermissions";
import "./PanelSchedules.css";

const MAX_EXCEL_UPLOAD_SIZE_BYTES = 15 * 1024 * 1024;
const DEFAULT_PANEL_CIRCUIT_CAPACITY = 42;
const PANEL_CIRCUIT_CAPACITY_OPTIONS = [18, 24, 30, 42, 84];
const CONDUIT_GROUP_PALETTE = [
  { accent: "#1d4ed8", soft: "#2563eb", text: "#ffffff" },
  { accent: "#c2410c", soft: "#ea580c", text: "#ffffff" },
  { accent: "#166534", soft: "#16a34a", text: "#ffffff" },
  { accent: "#9f1239", soft: "#e11d48", text: "#ffffff" },
  { accent: "#6d28d9", soft: "#8b5cf6", text: "#ffffff" },
  { accent: "#0369a1", soft: "#0ea5e9", text: "#082f49" },
  { accent: "#a16207", soft: "#eab308", text: "#422006" },
  { accent: "#0f766e", soft: "#14b8a6", text: "#052e2b" },
];

const PANEL_DETAIL_KEYS = [
  "itemNumber",
  "circuitPanel",
  "coordinates",
  "voltage",
  "ampacity",
  "voltagePhase",
  "panelCircuitRef",
  "panelSchedule",
  "planSheet",
  "planSheetNote",
  "singleLine",
  "sheet",
  "area",
  "construction",
  "projectPhase",
];

const PANEL_HEADER_DISPLAY_FIELDS = [
  { key: "itemNumber", label: "Item #" },
  { key: "circuitPanel", label: "Circuit Panel" },
  { key: "coordinates", label: "Coordinates" },
  { key: "voltage", label: "Voltage" },
  { key: "ampacity", label: "Ampacity" },
  { key: "voltagePhase", label: "Voltage Phase" },
  { key: "panelSchedule", label: "Panel Schedule" },
  { key: "planSheet", label: "Plan Sheet" },
  { key: "singleLine", label: "Single Line" },
  { key: "sheet", label: "Sheet" },
  { key: "construction", label: "Construction" },
  { key: "projectPhase", label: "Phase" },
];

const EMPTY_MAPPING = {
  panelName: "",
  circuitNumber: "",
  conduitId: "",
  conduitSize: "",
  providedByContractor: "",
  revitStatus: "",
  dataStatus: "",
  feederTo: "",
  sourcePanelLocation: "",
  toPullBox: "",
  feederSupplyFrom: "",
  fromBranchCircuitPanel: "",
  description: "",
  itemNumber: "",
  circuitPanel: "",
  coordinates: "",
  voltage: "",
  ampacity: "",
  voltagePhase: "",
  panelCircuitRef: "",
  panelSchedule: "",
  planSheet: "",
  planSheetNote: "",
  singleLine: "",
  sheet: "",
  area: "",
  construction: "",
  projectPhase: "",
};

const MAPPING_LABELS = {
  panelName: "Panel Name",
  circuitNumber: "Circuit Number",
  conduitId: "Conduit ID",
  conduitSize: "Conduit Size",
  providedByContractor: "Provided by Contractor (Yes/No)",
  revitStatus: "Revit Status",
  dataStatus: "Data Status",
  feederTo: "Feeder To",
  sourcePanelLocation: "Source Panel Location",
  toPullBox: "To Pull Box",
  feederSupplyFrom: "Feeder Supply From",
  fromBranchCircuitPanel: "From Branch Circuit Panel",
  description: "Description",
  itemNumber: "Item #",
  circuitPanel: "Circuit Panel",
  coordinates: "Coordinates",
  voltage: "Voltage",
  ampacity: "Ampacity",
  voltagePhase: "Voltage Phase",
  panelCircuitRef: "Circuit #",
  panelSchedule: "Panel Schedule",
  planSheet: "Plan Sheet",
  planSheetNote: "Plan Sheet Note",
  singleLine: "Single Line",
  sheet: "Sheet",
  area: "Area",
  construction: "Construction",
  projectPhase: "Phase",
};

const MAPPING_FIELD_ORDER = [
  "panelName",
  "circuitNumber",
  "conduitId",
  "conduitSize",
  "providedByContractor",
  "revitStatus",
  "dataStatus",
  "feederTo",
  "sourcePanelLocation",
  "toPullBox",
  "feederSupplyFrom",
  "fromBranchCircuitPanel",
  "description",
  "itemNumber",
  "circuitPanel",
  "coordinates",
  "voltage",
  "ampacity",
  "voltagePhase",
  "panelCircuitRef",
  "panelSchedule",
  "planSheet",
  "planSheetNote",
  "singleLine",
  "sheet",
  "area",
  "construction",
  "projectPhase",
];

const MAPPING_ALIASES = {
  panelName: ["panel name", "panelname", "panel board", "panelboard", "board", "board name", "boardname"],
  circuitNumber: ["circuit#", "circuit #", "circuitnumber", "circuit number", "ckt#", "ckt #", "cktnumber"],
  conduitId: ["conduitid", "conduit", "conduit no", "conduit #"],
  conduitSize: ["conduitsize", "size", "conduit size"],
  providedByContractor: [
    "provided by contractor",
    "providedbycontractor",
    "provided by contractor yes or no",
    "provided by contractor yes/no",
    "contractor provided",
  ],
  revitStatus: ["revit status", "revitstatus", "revit"],
  dataStatus: ["data status", "datastatus"],
  feederTo: ["feederto", "feeder to", "to", "destination"],
  sourcePanelLocation: ["source panel location", "sourcepanellocation", "source panel", "source panel loc"],
  toPullBox: ["topullbox", "to pull box", "pull box", "room id", "roomid", "room"],
  feederSupplyFrom: ["feedersupplyfrom", "feeder supply from", "supply from"],
  fromBranchCircuitPanel: ["frombranchcircuitpanel", "from branch circuit panel", "from panel"],
  description: ["description", "desc", "load", "notes"],
  itemNumber: ["item", "item#", "item #", "itemnumber", "item no"],
  circuitPanel: ["circuit panel", "circuitpanel", "panel name", "panelname"],
  coordinates: ["coordinates", "coordinate"],
  voltage: ["voltage", "volts"],
  ampacity: ["ampacity", "amps", "amperage"],
  voltagePhase: ["voltage phase", "phase voltage", "voltagephase"],
  panelCircuitRef: ["circuit #", "circuit#", "circuit no", "circuit number"],
  panelSchedule: ["panel schedule", "pannel schedule", "schedule"],
  planSheet: ["plan sheet", "plansheet"],
  planSheetNote: ["plan sheet note", "plansheetnote", "plan note"],
  singleLine: ["single line", "singleline"],
  sheet: ["sheet"],
  area: ["area"],
  construction: ["construction"],
  projectPhase: ["phase", "construction phase"],
};

const normalizeText = (value) => String(value || "").trim();

const normalizeHeader = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const normalizePanelIdentity = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const normalizePanelToken = (value) =>
  normalizeText(value)
    .toUpperCase()
    .replace(/\s+/g, "");

const normalizePanelMatchKey = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const normalizePanelKey = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const buildPanelScheduleDocId = (projectId, panelKeyOrName) => {
  const safeProjectId = normalizeText(projectId)
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project";

  const safePanelKey = normalizePanelKey(panelKeyOrName).replace(/\s+/g, "-") || "panel";
  return `project-${safeProjectId}__panel-${safePanelKey}`.slice(0, 240);
};

const fieldContainsPanelToken = (fieldValue, panelIdentity) => {
  const target = normalizePanelMatchKey(panelIdentity);
  if (!target) return false;

  const raw = normalizeText(fieldValue);
  if (!raw || isIgnoredPanelLabel(raw)) return false;

  return normalizePanelMatchKey(raw) === target;
};

const rowMatchesPanelIdentity = (row, panelIdentity) => {
  if (!panelIdentity) return false;

  // A missing row belongs to the panel it is fed FROM, not necessarily the "to" panel.
  const sourceFields = [
    row?.feederSupplyFrom,
    row?.fromBranchCircuitPanel,
  ];

  const hasSourceValues = sourceFields.some((fieldValue) => normalizeText(fieldValue));
  if (hasSourceValues) {
    return sourceFields.some((fieldValue) => fieldContainsPanelToken(fieldValue, panelIdentity));
  }

  // Fallback for legacy rows where source fields were not captured.
  return fieldContainsPanelToken(row?.panelName, panelIdentity);
};

const normalizeCircuitNumber = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const normalizeOptionValue = (value) => {
  if (value === true) return "Yes";
  if (value === false) return "No";

  const normalized = normalizeText(value);
  if (!normalized) return "";

  const upper = normalized.toUpperCase();
  if (upper === "Y" || upper === "YES" || upper === "TRUE" || upper === "1") return "Yes";
  if (upper === "N" || upper === "NO" || upper === "FALSE" || upper === "0") return "No";

  return normalized;
};

const normalizeStatusValue = (value) => {
  const normalized = normalizeText(value);
  return normalized;
};

const getConnectionTypeFromRow = (row) => {
  const fromBranchCircuitPanel = normalizeText(row?.fromBranchCircuitPanel);
  const toPullBox = normalizeText(row?.toPullBox);
  const feederSupplyFrom = normalizeText(row?.feederSupplyFrom);
  const feederTo = normalizeText(row?.feederTo);

  const hasBranchFrom = fromBranchCircuitPanel && !isIgnoredPanelLabel(fromBranchCircuitPanel);
  const hasToPullBox = toPullBox && !isIgnoredPanelLabel(toPullBox);
  if (hasBranchFrom || hasToPullBox) {
    return "branch";
  }

  const hasFeederFrom = feederSupplyFrom && !isIgnoredPanelLabel(feederSupplyFrom);
  const hasFeederTo = feederTo && !isIgnoredPanelLabel(feederTo);
  if (hasFeederFrom || hasFeederTo) {
    return "feeder";
  }

  return "unknown";
};

const getCircuitPhaseLabel = (value) => {
  const circuitNumber = normalizeCircuitNumber(value);
  if (circuitNumber === null) return "-";
  const phaseOrder = ["A", "B", "C"];
  return phaseOrder[Math.floor((circuitNumber - 1) / 2) % 3];
};

const extractCircuitNumbers = (value) => {
  const raw = normalizeText(value);
  if (!raw) return [];

  // Ignore availability/count notes like: (AVAILABLE 1 CKT "C")
  const withoutParentheses = raw.replace(/\([^)]*\)/g, " ");
  const matches = withoutParentheses.match(/\d+/g) || [];

  const seen = new Set();
  return matches
    .map((entry) => normalizeCircuitNumber(entry))
    .filter((number) => {
      if (number === null || seen.has(number)) return false;
      seen.add(number);
      return true;
    });
};

const normalizePanelCircuitCapacity = (value) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  return PANEL_CIRCUIT_CAPACITY_OPTIONS.includes(parsed) ? parsed : DEFAULT_PANEL_CIRCUIT_CAPACITY;
};

const isIgnoredPanelLabel = (value) => {
  const normalized = normalizeText(value).toUpperCase();
  return (
    !normalized ||
    normalized === "NA" ||
    normalized === "N/A" ||
    normalized === "NONE" ||
    normalized === "NULL" ||
    normalized === "-" ||
    normalized === "--"
  );
};

const buildConduitColorMeta = (value) => {
  const normalized = normalizeText(value).toUpperCase();
  if (!normalized) {
    return {
      accent: "#94a3b8",
      soft: "#cbd5e1",
      text: "#0f172a",
    };
  }

  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) % 360;
  }

  const hue = Math.abs(hash % 360);
  return {
    accent: `hsl(${hue} 76% 34%)`,
    soft: `hsl(${hue} 78% 50%)`,
    text: `hsl(${hue} 92% 8%)`,
  };
};

const getPanelSchedulePreferenceStorageKey = (churchId, userId) =>
  `panelSchedules:lastSelection:${normalizeText(churchId)}:${normalizeText(userId) || "anonymous"}`;

const readPanelSchedulePreferences = (churchId, userId) => {
  if (!churchId || typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(getPanelSchedulePreferenceStorageKey(churchId, userId));
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    return {
      projectId: normalizeText(parsed?.projectId),
      scheduleId: normalizeText(parsed?.scheduleId),
    };
  } catch (_error) {
    return null;
  }
};

const writePanelSchedulePreferences = (churchId, userId, nextValue) => {
  if (!churchId || typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      getPanelSchedulePreferenceStorageKey(churchId, userId),
      JSON.stringify({
        projectId: normalizeText(nextValue?.projectId),
        scheduleId: normalizeText(nextValue?.scheduleId),
      })
    );
  } catch (_error) {
    // Ignore storage failures (private mode/full storage).
  }
};

const sortSchedules = (rows) =>
  [...rows].sort((a, b) => {
    const aTime =
      a?.updatedAt?.seconds ||
      a?.createdAt?.seconds ||
      new Date(a?.updatedAt || a?.createdAt || 0).getTime() / 1000 ||
      0;
    const bTime =
      b?.updatedAt?.seconds ||
      b?.createdAt?.seconds ||
      new Date(b?.updatedAt || b?.createdAt || 0).getTime() / 1000 ||
      0;
    return bTime - aTime;
  });

const getScheduleCounts = (schedule) => {
  const importedCount = Number(schedule?.circuitCount || schedule?.circuits?.length || 0);
  const missingCount = Array.isArray(schedule?.missingCircuitRows) ? schedule.missingCircuitRows.length : 0;
  return {
    importedCount,
    missingCount,
    totalRows: importedCount + missingCount,
  };
};

const getScheduleCompletenessScore = (schedule) => {
  const { importedCount, totalRows } = getScheduleCounts(schedule);
  if (!totalRows) return 0;
  return importedCount / totalRows;
};

const formatDateTime = (value) => {
  if (!value) return "";

  try {
    if (typeof value.toDate === "function") {
      return value.toDate().toLocaleString();
    }

    if (value.seconds) {
      return new Date(value.seconds * 1000).toLocaleString();
    }

    return new Date(value).toLocaleString();
  } catch (_error) {
    return "";
  }
};

const buildCircuitSections = (circuits = [], panelHeaders = [], fallbackPanelName = "Imported Panel") => {
  const groupedByPanel = circuits.reduce((accumulator, row) => {
    const panelName = normalizeText(row?.panelName || "Unassigned Panel") || "Unassigned Panel";
    if (!accumulator[panelName]) {
      accumulator[panelName] = [];
    }
    accumulator[panelName].push(row);
    return accumulator;
  }, {});

  const panelCapacityByName = new Map();
  (Array.isArray(panelHeaders) ? panelHeaders : []).forEach((panel) => {
    const panelName = normalizeText(panel?.panelName);
    if (!panelName) return;
    panelCapacityByName.set(panelName, normalizePanelCircuitCapacity(panel?.circuitCapacity));
    if (!groupedByPanel[panelName]) {
      groupedByPanel[panelName] = [];
    }
  });

  if (!Object.keys(groupedByPanel).length) {
    const fallbackName = normalizeText(fallbackPanelName) || "Imported Panel";
    groupedByPanel[fallbackName] = [];
    if (!panelCapacityByName.has(fallbackName)) {
      panelCapacityByName.set(fallbackName, DEFAULT_PANEL_CIRCUIT_CAPACITY);
    }
  }

  return Object.entries(groupedByPanel)
    .sort(([nameA], [nameB]) => nameA.localeCompare(nameB))
    .map(([panelName, rows]) => {
      const rowByNumber = new Map();

      rows.forEach((row) => {
        const circuitNumber = normalizeCircuitNumber(row?.number);
        if (circuitNumber === null) return;

        if (!rowByNumber.has(circuitNumber)) {
          rowByNumber.set(circuitNumber, row);
        }
      });

      const pairBases = new Set();
      rowByNumber.forEach((_row, circuitNumber) => {
        pairBases.add(circuitNumber % 2 === 0 ? circuitNumber - 1 : circuitNumber);
      });

      const panelCapacity = normalizePanelCircuitCapacity(
        panelCapacityByName.get(panelName) || DEFAULT_PANEL_CIRCUIT_CAPACITY
      );
      for (let base = 1; base <= panelCapacity; base += 2) {
        pairBases.add(base);
      }

      const pairRows = Array.from(pairBases)
        .sort((a, b) => a - b)
        .map((baseNumber) => ({
          baseNumber,
          oddCircuit: rowByNumber.get(baseNumber) || null,
          evenCircuit: rowByNumber.get(baseNumber + 1) || null,
        }));

      return { panelName, pairRows };
    });
};

const buildDefaultMapping = (columns = []) => {
  const normalizedColumns = columns.map((column) => ({
    raw: column,
    normalized: normalizeHeader(column),
  }));

  const mapping = { ...EMPTY_MAPPING };

  Object.keys(EMPTY_MAPPING).forEach((field) => {
    const aliases = MAPPING_ALIASES[field] || [];
    const normalizedAliases = aliases.map((alias) => normalizeHeader(alias)).filter(Boolean);

    // Prefer exact alias/header matches first, then startsWith/endsWith, then contains.
    let best = null;
    let bestScore = 0;

    normalizedColumns.forEach((column) => {
      if (
        (field === "panelName" || field === "circuitPanel") &&
        (column.normalized.includes("panelschedule") || column.normalized.includes("pannelschedule"))
      ) {
        return;
      }

      normalizedAliases.forEach((alias) => {
        if (!alias) return;

        let score = 0;
        if (column.normalized === alias) {
          score = 4;
        } else if (column.normalized.startsWith(alias) || column.normalized.endsWith(alias)) {
          score = 3;
        } else if (alias.length >= 4 && column.normalized.includes(alias)) {
          score = 2;
        }

        if (score > bestScore) {
          bestScore = score;
          best = column;
        }
      });
    });

    mapping[field] = best?.raw || "";
  });

  return mapping;
};

const findPrimaryCircuitColumn = (columns = []) => {
  const normalizedColumns = columns.map((column) => ({
    raw: column,
    normalized: normalizeHeader(column),
  }));

  const exactPriority = ["circuit", "circuitnumber", "circuitno", "circuitnum"];
  for (const key of exactPriority) {
    const match = normalizedColumns.find((column) => column.normalized === key);
    if (match) return match.raw;
  }

  const fallback = normalizedColumns.find((column) =>
    MAPPING_ALIASES.circuitNumber.some((alias) => column.normalized === normalizeHeader(alias))
  );
  return fallback?.raw || "";
};

const findPrimaryConduitSizeColumn = (columns = []) => {
  const normalizedColumns = columns.map((column) => ({
    raw: column,
    normalized: normalizeHeader(column),
  }));

  const exactPriority = ["conduitsize", "size", "conduitsizein"];
  for (const key of exactPriority) {
    const match = normalizedColumns.find((column) => column.normalized === key);
    if (match) return match.raw;
  }

  const fallback = normalizedColumns.find((column) =>
    MAPPING_ALIASES.conduitSize.some((alias) => column.normalized === normalizeHeader(alias))
  );
  return fallback?.raw || "";
};

const CONDUIT_SIZE_VALUE_PATTERN = /^\s*\d+(?:\s*-\s*\d+\s*\/\s*\d+|\s+\d+\s*\/\s*\d+|\s*\/\s*\d+|(?:\.\d+)?)\s*(?:"|''|”|in|in\.|inch|inches)?\s*$/i;

const getConduitSizeSortValue = (value) => {
  const raw = normalizeText(value).toLowerCase();
  if (!raw || isIgnoredPanelLabel(raw)) return Number.POSITIVE_INFINITY;

  const cleaned = raw.replace(/(inches|inch|in\.|in|"|''|”)/g, " ").trim();
  if (!cleaned) return Number.POSITIVE_INFINITY;

  // Normalize formats like 1-1/2, 1 1/2, 1/2, 2
  const dashMixed = cleaned.match(/^(\d+)\s*-\s*(\d+)\s*\/\s*(\d+)$/);
  if (dashMixed) {
    const whole = Number.parseFloat(dashMixed[1]);
    const numerator = Number.parseFloat(dashMixed[2]);
    const denominator = Number.parseFloat(dashMixed[3]);
    if (Number.isFinite(whole) && Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0) {
      return whole + numerator / denominator;
    }
  }

  const spacedMixed = cleaned.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (spacedMixed) {
    const whole = Number.parseFloat(spacedMixed[1]);
    const numerator = Number.parseFloat(spacedMixed[2]);
    const denominator = Number.parseFloat(spacedMixed[3]);
    if (Number.isFinite(whole) && Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0) {
      return whole + numerator / denominator;
    }
  }

  const fractionOnly = cleaned.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fractionOnly) {
    const numerator = Number.parseFloat(fractionOnly[1]);
    const denominator = Number.parseFloat(fractionOnly[2]);
    if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0) {
      return numerator / denominator;
    }
  }

  const decimalOrWhole = Number.parseFloat(cleaned);
  if (Number.isFinite(decimalOrWhole)) {
    return decimalOrWhole;
  }

  return Number.POSITIVE_INFINITY;
};

const resolveConduitSizeFromRow = (row, mappedColumn, primaryColumn) => {
  const mappedValue = normalizeText(row?.[mappedColumn]);
  if (mappedValue && !isIgnoredPanelLabel(mappedValue)) {
    return mappedValue;
  }

  const primaryValue = normalizeText(row?.[primaryColumn]);
  if (primaryValue && !isIgnoredPanelLabel(primaryValue)) {
    return primaryValue;
  }

  const rowEntries = Object.entries(row || {});
  const sizeHeaderMatch = rowEntries.find(([header, value]) => {
    const normalizedHeader = normalizeHeader(header);
    if (!normalizedHeader.includes("size") || !normalizedHeader.includes("conduit")) {
      return false;
    }

    const nextValue = normalizeText(value);
    return nextValue && !isIgnoredPanelLabel(nextValue);
  });
  if (sizeHeaderMatch) {
    return normalizeText(sizeHeaderMatch[1]);
  }

  const patternMatch = rowEntries.find(([, value]) => {
    const nextValue = normalizeText(value);
    if (!nextValue || isIgnoredPanelLabel(nextValue)) return false;
    return CONDUIT_SIZE_VALUE_PATTERN.test(nextValue);
  });

  return patternMatch ? normalizeText(patternMatch[1]) : "";
};

const CircuitCard = ({ circuitNumber, row, side = "left", conduitColor = null, expanded = false, onToggle = () => {} }) => {
  const isRightSide = side === "right";
  const circuitPhase = getCircuitPhaseLabel(circuitNumber);
  const conduitIdDisplay = normalizeText(row?.conduitId) || "-";
  const resolvedConduitColor =
    conduitColor || buildConduitColorMeta(conduitIdDisplay === "-" ? "" : conduitIdDisplay);
  const feederSupplyFromDisplay = isIgnoredPanelLabel(row?.feederSupplyFrom)
    ? "-"
    : normalizeText(row?.feederSupplyFrom) || "-";
  const fromBranchCircuitPanelDisplay = isIgnoredPanelLabel(row?.fromBranchCircuitPanel)
    ? "-"
    : normalizeText(row?.fromBranchCircuitPanel) || "-";
  const feederToDisplay = isIgnoredPanelLabel(row?.feederTo)
    ? "-"
    : normalizeText(row?.feederTo) || "-";
  const toPullBoxDisplay = isIgnoredPanelLabel(row?.toPullBox)
    ? "-"
    : normalizeText(row?.toPullBox) || "-";
  const providedByContractorDisplay = isIgnoredPanelLabel(row?.providedByContractor)
    ? "-"
    : normalizeOptionValue(row?.providedByContractor) || "-";
  const revitStatusDisplay = normalizeStatusValue(row?.revitStatus) || "-";
  const dataStatusDisplay = normalizeStatusValue(row?.dataStatus) || "-";
  const hasProvidedByContractor = providedByContractorDisplay !== "-";
  const hasRevitStatus = revitStatusDisplay !== "-";
  const hasDataStatus = dataStatusDisplay !== "-";
  const hasFeederSupplyFrom = feederSupplyFromDisplay !== "-";
  const hasFeederTo = feederToDisplay !== "-";
  const hasBranchFrom = fromBranchCircuitPanelDisplay !== "-";
  const hasToPullBox = toPullBoxDisplay !== "-";
  const connectionType = hasBranchFrom && hasToPullBox
    ? "Branch"
    : hasFeederSupplyFrom || hasFeederTo
      ? "Feeder"
      : "";
  const hasContractorAnswer = providedByContractorDisplay === "Yes" || providedByContractorDisplay === "No";
  const contractorStatusClass =
    providedByContractorDisplay === "Yes"
      ? "is-yes"
      : providedByContractorDisplay === "No"
        ? "is-no"
        : "is-unknown";

  return (
    <article
      className={`panel-schedules-circuit-card panel-schedules-circuit-card-${side} ${expanded ? "is-expanded" : ""}`}
      style={{
        "--conduit-accent": resolvedConduitColor.accent,
        "--conduit-soft": resolvedConduitColor.soft,
        "--conduit-text": resolvedConduitColor.text,
      }}
    >
      <button
        type="button"
        className={`panel-schedules-circuit-header panel-schedules-circuit-header-${side}`}
        onClick={onToggle}
        aria-expanded={expanded}
      >
        {hasContractorAnswer ? (
          <span className={`panel-schedules-contractor-flag ${contractorStatusClass}`}>
            Contractor: {providedByContractorDisplay}
          </span>
        ) : null}
        {isRightSide ? (
          <>
            <span className="panel-schedules-conduit-chip">{conduitIdDisplay}</span>
            <span className="panel-schedules-phase-chip">{circuitPhase}</span>
            {connectionType ? <span className={`panel-schedules-type-chip type-${connectionType.toLowerCase()}`}>{connectionType}</span> : null}
            <strong className="panel-schedules-circuit-number">#{circuitNumber || "-"}</strong>
          </>
        ) : (
          <>
            <strong className="panel-schedules-circuit-number">#{circuitNumber || "-"}</strong>
            {connectionType ? <span className={`panel-schedules-type-chip type-${connectionType.toLowerCase()}`}>{connectionType}</span> : null}
            <span className="panel-schedules-phase-chip">{circuitPhase}</span>
            <span className="panel-schedules-conduit-chip">{conduitIdDisplay}</span>
          </>
        )}
      </button>
      {expanded ? (
        <div className="panel-schedules-circuit-meta">
          <p><label>ABC:</label> {circuitPhase}</p>
          <p><label>Conduit Size:</label> {row?.conduitSize || "-"}</p>
          {hasProvidedByContractor ? <p><label>Provided by Contractor:</label> {providedByContractorDisplay}</p> : null}
          {hasRevitStatus ? <p><label>Revit Status:</label> {revitStatusDisplay}</p> : null}
          {hasDataStatus ? <p><label>Data Status:</label> {dataStatusDisplay}</p> : null}
          {hasFeederSupplyFrom ? <p><label>Feeder Supply From:</label> {feederSupplyFromDisplay}</p> : null}
          {hasFeederTo ? <p><label>Feeder to:</label> {feederToDisplay}</p> : null}
          {hasBranchFrom ? <p><label>From Branch Circuit Panel:</label> {fromBranchCircuitPanelDisplay}</p> : null}
          {hasToPullBox ? <p><label>To Pull Box:</label> {toPullBoxDisplay}</p> : null}
        </div>
      ) : null}
    </article>
  );
};

const PanelSchedules = () => {
  const { id } = useParams();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [importingExcel, setImportingExcel] = useState(false);
  const [savingImport, setSavingImport] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [deletingAll, setDeletingAll] = useState(false);
  const [schedules, setSchedules] = useState([]);
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedScheduleId, setSelectedScheduleId] = useState("");
  const [importPreview, setImportPreview] = useState(null);
  const [expandedCircuitKey, setExpandedCircuitKey] = useState("");
  const [expandedMissingRowKey, setExpandedMissingRowKey] = useState("");
  const [panelSearchQuery, setPanelSearchQuery] = useState("");
  const [listSortMode, setListSortMode] = useState("recent");
  const [permissionsLoading, setPermissionsLoading] = useState(true);
  const [canView, setCanView] = useState(false);
  const [canManage, setCanManage] = useState(false);

  const [excelRows, setExcelRows] = useState([]);
  const [excelColumns, setExcelColumns] = useState([]);
  const [excelSourceFileName, setExcelSourceFileName] = useState("");
  const [columnMapping, setColumnMapping] = useState({ ...EMPTY_MAPPING });

  useEffect(() => {
    const saved = readPanelSchedulePreferences(id, user?.uid);
    if (!saved) return;

    if (saved.projectId) {
      setSelectedProjectId(saved.projectId);
    }
    if (saved.scheduleId) {
      setSelectedScheduleId(saved.scheduleId);
    }
  }, [id, user?.uid]);

  useEffect(() => {
    if (!id) return;
    writePanelSchedulePreferences(id, user?.uid, {
      projectId: selectedProjectId,
      scheduleId: selectedScheduleId,
    });
  }, [id, user?.uid, selectedProjectId, selectedScheduleId]);

  useEffect(() => {
    const checkPermissions = async () => {
      if (!user || !id) {
        setCanView(false);
        setCanManage(false);
        setPermissionsLoading(false);
        return;
      }

      setPermissionsLoading(true);
      try {
        const [readAllowed, createAllowed, updateAllowed, deleteAllowed] = await Promise.all([
          Promise.race([
            hasPermission(user, id, "panelschedules", "read"),
            new Promise((resolve) => setTimeout(() => resolve(false), 3000)),
          ]),
          Promise.race([
            hasPermission(user, id, "panelschedules", "create"),
            new Promise((resolve) => setTimeout(() => resolve(false), 3000)),
          ]),
          Promise.race([
            hasPermission(user, id, "panelschedules", "update"),
            new Promise((resolve) => setTimeout(() => resolve(false), 3000)),
          ]),
          Promise.race([
            hasPermission(user, id, "panelschedules", "delete"),
            new Promise((resolve) => setTimeout(() => resolve(false), 3000)),
          ]),
        ]);

        setCanView(Boolean(readAllowed));
        setCanManage(Boolean(createAllowed && updateAllowed && deleteAllowed));
      } catch (error) {
        console.error("PanelSchedules permission check failed:", error);
        const isAdmin = user?.baseRole === "admin" || user?.baseRole === "global_admin" || user?.role === "admin" || user?.role === "global_admin";
        setCanView(isAdmin);
        setCanManage(isAdmin);
      } finally {
        setPermissionsLoading(false);
      }
    };

    checkPermissions();
  }, [id, user]);

  useEffect(() => {
    const loadProjects = async () => {
      if (!id) {
        setProjects([]);
        setSelectedProjectId("");
        setLoadingProjects(false);
        return;
      }

      setLoadingProjects(true);
      try {
        const projectsSnapshot = await getDocs(collection(db, "churches", id, "projectListIssueProjects"));
        const nextProjects = projectsSnapshot.docs
          .map((projectDoc) => {
            const projectData = projectDoc.data() || {};
            return {
              id: projectDoc.id,
              name: normalizeText(projectData.name || projectData.projectName) || "Untitled Project",
            };
          })
          .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true }));

        setProjects(nextProjects);
        setSelectedProjectId((previous) =>
          previous && nextProjects.some((project) => project.id === previous) ? previous : ""
        );
      } catch (error) {
        console.error("Failed to load projects for panel schedules:", error);
        toast.error("Failed to load projects.");
        setProjects([]);
        setSelectedProjectId("");
      } finally {
        setLoadingProjects(false);
      }
    };

    loadProjects();
  }, [id]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  const loadSchedules = useCallback(async () => {
    if (!id || !canView || !selectedProjectId) {
      setSchedules([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const schedulesQuery = query(
        collection(db, "churches", id, "panelSchedules"),
        where("projectId", "==", selectedProjectId)
      );
      const snapshot = await getDocs(schedulesQuery);
      const rows = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      const sorted = sortSchedules(rows);
      setSchedules(sorted);

      setSelectedScheduleId((previous) => {
        if (previous && sorted.some((row) => row.id === previous)) {
          return previous;
        }
        const firstWithCircuits = sorted.find(
          (row) => Number(row?.circuitCount || row?.circuits?.length || 0) > 0
        );
        return firstWithCircuits?.id || sorted[0]?.id || "";
      });
    } catch (error) {
      console.error("Failed to load panel schedules:", error);
      toast.error("Failed to load panel schedules.");
      setSchedules([]);
      setSelectedScheduleId("");
    } finally {
      setLoading(false);
    }
  }, [id, canView, selectedProjectId]);

  useEffect(() => {
    loadSchedules();
  }, [loadSchedules]);

  const selectedSchedule = useMemo(
    () => schedules.find((entry) => entry.id === selectedScheduleId) || null,
    [schedules, selectedScheduleId]
  );

  const filteredSchedules = useMemo(() => {
    const normalizedQuery = normalizeText(panelSearchQuery).toLowerCase();
    const queryFiltered = normalizedQuery
      ? schedules.filter((entry) => {
          const name = normalizeText(entry?.name).toLowerCase();
          const sourceFileName = normalizeText(entry?.sourceFileName).toLowerCase();
          return name.includes(normalizedQuery) || sourceFileName.includes(normalizedQuery);
        })
      : schedules;

    if (listSortMode !== "most-complete") {
      return queryFiltered;
    }

    return [...queryFiltered].sort((left, right) => {
      const scoreDelta = getScheduleCompletenessScore(right) - getScheduleCompletenessScore(left);
      if (Math.abs(scoreDelta) > 0.000001) return scoreDelta;

      const rightCounts = getScheduleCounts(right);
      const leftCounts = getScheduleCounts(left);
      if (rightCounts.importedCount !== leftCounts.importedCount) {
        return rightCounts.importedCount - leftCounts.importedCount;
      }

      const rightTime =
        right?.updatedAt?.seconds ||
        right?.createdAt?.seconds ||
        new Date(right?.updatedAt || right?.createdAt || 0).getTime() / 1000 ||
        0;
      const leftTime =
        left?.updatedAt?.seconds ||
        left?.createdAt?.seconds ||
        new Date(left?.updatedAt || left?.createdAt || 0).getTime() / 1000 ||
        0;
      return rightTime - leftTime;
    });
  }, [listSortMode, panelSearchQuery, schedules]);

  const selectedScheduleIndex = useMemo(() => {
    if (!selectedScheduleId) return -1;
    return filteredSchedules.findIndex((entry) => entry.id === selectedScheduleId);
  }, [filteredSchedules, selectedScheduleId]);

  const canGoToPreviousSchedule = selectedScheduleIndex > 0;
  const canGoToNextSchedule = selectedScheduleIndex >= 0 && selectedScheduleIndex < filteredSchedules.length - 1;

  const goToAdjacentSchedule = (offset) => {
    if (!filteredSchedules.length) return;

    const currentIndex = selectedScheduleIndex >= 0 ? selectedScheduleIndex : 0;
    const nextIndex = Math.max(0, Math.min(filteredSchedules.length - 1, currentIndex + offset));
    const nextSchedule = filteredSchedules[nextIndex];
    if (!nextSchedule?.id || nextSchedule.id === selectedScheduleId) return;

    setImportPreview(null);
    setExpandedCircuitKey("");
    setSelectedScheduleId(nextSchedule.id);
  };

  const activePanelHeaders = useMemo(
    () => importPreview?.panelHeaders || selectedSchedule?.panelHeaders || [],
    [importPreview, selectedSchedule]
  );
  const activeCircuits = useMemo(
    () => importPreview?.circuits || selectedSchedule?.circuits || [],
    [importPreview, selectedSchedule]
  );
  const activeMissingCircuitRows = useMemo(
    () => {
      const sourceRows = importPreview?.missingCircuitRows || selectedSchedule?.missingCircuitRows || [];
      if (!Array.isArray(sourceRows) || !sourceRows.length) return [];

      const activePanelIdentities = new Set(
        (activePanelHeaders || [])
          .map((panel) => normalizePanelIdentity(panel?.panelName))
          .filter(Boolean)
      );

      if (!activePanelIdentities.size && selectedSchedule?.name) {
        activePanelIdentities.add(normalizePanelIdentity(selectedSchedule.name));
      }

      if (!activePanelIdentities.size) return sourceRows;

      return sourceRows.filter((row) => {
        const rowPanelIdentity = normalizePanelIdentity(row?.panelName);
        if (activePanelIdentities.has(rowPanelIdentity)) return true;

        for (const panelIdentity of activePanelIdentities) {
          if (rowMatchesPanelIdentity(row, panelIdentity)) {
            return true;
          }
        }

        return false;
      });
    },
    [activePanelHeaders, importPreview, selectedSchedule]
  );
  const circuitSections = useMemo(
    () => buildCircuitSections(activeCircuits, activePanelHeaders, importPreview?.name || selectedSchedule?.name || "Imported Panel"),
    [activeCircuits, activePanelHeaders, importPreview, selectedSchedule]
  );
  const panelHeaderByIdentity = useMemo(() => {
    const nextMap = new Map();
    (activePanelHeaders || []).forEach((panel, index) => {
      const identity = normalizePanelIdentity(panel?.panelName);
      if (!identity || nextMap.has(identity)) return;
      nextMap.set(identity, { ...panel, __panelIndex: index });
    });
    return nextMap;
  }, [activePanelHeaders]);
  const conduitColorByIdentity = useMemo(() => {
    const uniqueIds = Array.from(
      new Set(
        (activeCircuits || [])
          .map((row) => normalizePanelIdentity(row?.conduitId || ""))
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));

    const nextMap = new Map();
    uniqueIds.forEach((id, index) => {
      nextMap.set(id, CONDUIT_GROUP_PALETTE[index % CONDUIT_GROUP_PALETTE.length]);
    });
    return nextMap;
  }, [activeCircuits]);
  const conduitScheduleRows = useMemo(() => {
    const grouped = new Map();

    (activeCircuits || []).forEach((row) => {
      const conduitId = normalizeText(row?.conduitId);
      if (!conduitId || isIgnoredPanelLabel(conduitId)) return;

      const conduitIdentity = normalizePanelIdentity(conduitId);
      if (!conduitIdentity) return;

      if (!grouped.has(conduitIdentity)) {
        grouped.set(conduitIdentity, {
          conduitId,
          conduitIdentity,
          sizeCounts: new Map(),
          circuitNumbers: new Set(),
          connectionCounts: new Map(),
          feederSupplyFrom: "",
          feederTo: "",
          fromBranchCircuitPanel: "",
          toPullBox: "",
        });
      }

      const entry = grouped.get(conduitIdentity);
      const conduitSize = normalizeText(row?.conduitSize);
      if (conduitSize && !isIgnoredPanelLabel(conduitSize)) {
        entry.sizeCounts.set(conduitSize, (entry.sizeCounts.get(conduitSize) || 0) + 1);
      }

      const circuitNumber = normalizeCircuitNumber(row?.number);
      if (circuitNumber !== null) {
        entry.circuitNumbers.add(circuitNumber);
      }

      const connectionType = getConnectionTypeFromRow(row);
      entry.connectionCounts.set(connectionType, (entry.connectionCounts.get(connectionType) || 0) + 1);

      const feederSupplyFrom = normalizeText(row?.feederSupplyFrom);
      if (!entry.feederSupplyFrom && feederSupplyFrom && !isIgnoredPanelLabel(feederSupplyFrom)) {
        entry.feederSupplyFrom = feederSupplyFrom;
      }

      const feederTo = normalizeText(row?.feederTo);
      if (!entry.feederTo && feederTo && !isIgnoredPanelLabel(feederTo)) {
        entry.feederTo = feederTo;
      }

      const fromBranchCircuitPanel = normalizeText(row?.fromBranchCircuitPanel);
      if (!entry.fromBranchCircuitPanel && fromBranchCircuitPanel && !isIgnoredPanelLabel(fromBranchCircuitPanel)) {
        entry.fromBranchCircuitPanel = fromBranchCircuitPanel;
      }

      const toPullBox = normalizeText(row?.toPullBox);
      if (!entry.toPullBox && toPullBox && !isIgnoredPanelLabel(toPullBox)) {
        entry.toPullBox = toPullBox;
      }
    });

    return Array.from(grouped.values())
      .map((entry) => {
        const sizeOptions = Array.from(entry.sizeCounts.entries())
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([size]) => size);

        const preferredConnectionType =
          (entry.connectionCounts.get("branch") || 0) >= (entry.connectionCounts.get("feeder") || 0)
            ? "branch"
            : "feeder";

        const connectionType =
          preferredConnectionType === "branch" && (entry.connectionCounts.get("branch") || 0) > 0
            ? "branch"
            : (entry.connectionCounts.get("feeder") || 0) > 0
              ? "feeder"
              : "unknown";

        return {
          conduitId: entry.conduitId,
          conduitIdentity: entry.conduitIdentity,
          primarySize: sizeOptions[0] || "-",
          primarySizeSortValue: getConduitSizeSortValue(sizeOptions[0] || ""),
          sizeOptions,
          circuitNumbers: Array.from(entry.circuitNumbers).sort((a, b) => a - b),
          connectionType,
          feederSupplyFrom: entry.feederSupplyFrom || "-",
          feederTo: entry.feederTo || "-",
          fromBranchCircuitPanel: entry.fromBranchCircuitPanel || "-",
          toPullBox: entry.toPullBox || "-",
        };
      })
      .sort((a, b) => {
        if (a.primarySizeSortValue !== b.primarySizeSortValue) {
          return a.primarySizeSortValue - b.primarySizeSortValue;
        }

        return a.conduitId.localeCompare(b.conduitId, undefined, { sensitivity: "base", numeric: true });
      });
  }, [activeCircuits]);

  const handlePanelCircuitCapacityChange = async (panelKey, nextCapacityRaw) => {
    const nextCapacity = normalizePanelCircuitCapacity(nextCapacityRaw);

    if (importPreview) {
      setImportPreview((previous) => {
        if (!previous) return previous;
        return {
          ...previous,
          panelHeaders: (previous.panelHeaders || []).map((panel, index) => {
            const key = panel?.panelKey || `${panel?.panelName || "panel"}-${index}`;
            if (key !== panelKey) return panel;
            return {
              ...panel,
              circuitCapacity: nextCapacity,
            };
          }),
        };
      });
      return;
    }

    if (!selectedSchedule?.id || !id || !canManage) return;

    const updatedPanelHeaders = (selectedSchedule.panelHeaders || []).map((panel, index) => {
      const key = panel?.panelKey || `${panel?.panelName || "panel"}-${index}`;
      if (key !== panelKey) return panel;
      return {
        ...panel,
        circuitCapacity: nextCapacity,
      };
    });

    try {
      await updateDoc(doc(db, "churches", id, "panelSchedules", selectedSchedule.id), {
        panelHeaders: updatedPanelHeaders,
        updatedBy: user?.uid || "",
        updatedAt: serverTimestamp(),
      });

      setSchedules((current) =>
        current.map((schedule) =>
          schedule.id === selectedSchedule.id
            ? {
                ...schedule,
                panelHeaders: updatedPanelHeaders,
              }
            : schedule
        )
      );
    } catch (error) {
      console.error("Failed to update panel circuit capacity:", error);
      toast.error("Failed to update panel circuit capacity.");
    }
  };

  const clearExcelDraft = () => {
    setExcelRows([]);
    setExcelColumns([]);
    setExcelSourceFileName("");
    setColumnMapping({ ...EMPTY_MAPPING });
  };

  const handleProjectChange = (event) => {
    const nextProjectId = normalizeText(event.target.value);
    setSelectedProjectId(nextProjectId);
    setSelectedScheduleId("");
    setExpandedCircuitKey("");
    setImportPreview(null);
    clearExcelDraft();
  };

  const handleExcelImport = async (event) => {
    if (!id || !selectedProjectId) return;

    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!canManage) {
      toast.error("You do not have permission to import panel schedules.");
      return;
    }

    if (!selectedProject) {
      toast.error("Select a project before importing panels.");
      return;
    }

    const isExcelFile = /\.(xlsx|xls|csv)$/i.test(file.name || "");
    if (!isExcelFile) {
      toast.error("Please select an Excel file (.xlsx, .xls, .csv).");
      return;
    }

    if (file.size > MAX_EXCEL_UPLOAD_SIZE_BYTES) {
      toast.error("Excel file is too large. Max size is 15MB.");
      return;
    }

    try {
      setImportingExcel(true);
      setImportPreview(null);

      const fileBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(fileBuffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        throw new Error("Excel file does not contain any sheet.");
      }

      const worksheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(worksheet, { defval: "", raw: false });
      if (!rows.length) {
        throw new Error("Excel sheet is empty.");
      }

      const columns = Object.keys(rows[0] || {}).map((column) => normalizeText(column)).filter(Boolean);
      if (!columns.length) {
        throw new Error("No header columns detected in the Excel sheet.");
      }

      setExcelRows(rows);
      setExcelColumns(columns);
      setExcelSourceFileName(file.name || "Panel Schedule Excel");
      setColumnMapping(buildDefaultMapping(columns));
      toast.success(`Loaded ${rows.length} rows from ${file.name}. Map columns and build preview.`);
    } catch (error) {
      console.error("Panel schedule Excel import failed:", error);
      toast.error(error.message || "Failed to import Excel file.");
      clearExcelDraft();
    } finally {
      setImportingExcel(false);
    }
  };

  const handleMappingChange = (field, value) => {
    setColumnMapping((previous) => ({
      ...previous,
      [field]: value,
    }));
  };

  const buildPreviewFromExcel = ({ saveOnly = false, showSummaryToast = true } = {}) => {
    if (!excelRows.length) {
      toast.error("Import an Excel file first.");
      return null;
    }

    const mappedCircuitColumn = normalizeText(columnMapping.circuitNumber);
    if (!mappedCircuitColumn) {
      toast.error("Map the Circuit Number column before building preview.");
      return null;
    }

    const panelDetailsByName = new Map();
    const circuits = [];
    const missingCircuitRows = [];
    const primaryCircuitColumn = findPrimaryCircuitColumn(excelColumns);
    const primaryConduitSizeColumn = findPrimaryConduitSizeColumn(excelColumns);

    const ensurePanel = (rawPanelName) => {
      const panelNameValue = normalizeText(rawPanelName);
      if (isIgnoredPanelLabel(panelNameValue)) return "";

      const panelIdentity = normalizePanelIdentity(panelNameValue);
      if (!panelIdentity) return "";

      if (!panelDetailsByName.has(panelIdentity)) {
        panelDetailsByName.set(panelIdentity, {
          panelName: panelNameValue,
          panelKey: normalizeText(panelNameValue).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
          circuitCapacity: DEFAULT_PANEL_CIRCUIT_CAPACITY,
          itemNumber: "",
          circuitPanel: "",
          coordinates: "",
          voltage: "",
          ampacity: "",
          voltagePhase: "",
          panelCircuitRef: "",
          panelSchedule: "",
          planSheet: "",
          planSheetNote: "",
          singleLine: "",
          sheet: "",
          area: "",
          construction: "",
          projectPhase: "",
        });
      }

      return panelDetailsByName.get(panelIdentity)?.panelName || panelNameValue;
    };

    excelRows.forEach((row, rowIndex) => {
      const fromPanelOwnerRaw =
        normalizeText(row?.[columnMapping.feederSupplyFrom]) ||
        normalizeText(row?.[columnMapping.fromBranchCircuitPanel]) ||
        normalizeText(row?.[columnMapping.sourcePanelLocation]);
      const toPanelOwnerRaw = normalizeText(row?.[columnMapping.feederTo]);

      // Create a panel entry only for the chosen ownership path.
      const rowPanelOwnerName = ensurePanel(fromPanelOwnerRaw) || ensurePanel(toPanelOwnerRaw);

      if (!rowPanelOwnerName) return;

      const mappedCircuitRaw = row?.[columnMapping.circuitNumber];
      const mappedCircuitNumbers = extractCircuitNumbers(mappedCircuitRaw);
      const primaryCircuitRaw = primaryCircuitColumn ? row?.[primaryCircuitColumn] : "";
      const primaryCircuitNumbers = extractCircuitNumbers(primaryCircuitRaw);
      const resolvedCircuitNumbers = mappedCircuitNumbers.length ? mappedCircuitNumbers : primaryCircuitNumbers;
      const resolvedConduitSize = resolveConduitSizeFromRow(row, columnMapping.conduitSize, primaryConduitSizeColumn);
      const hasMissingPrimaryCircuit = primaryCircuitColumn ? primaryCircuitNumbers.length === 0 : resolvedCircuitNumbers.length === 0;
      const hasMissingMappedCircuit = mappedCircuitNumbers.length === 0;

      if (!resolvedCircuitNumbers.length) {
        missingCircuitRows.push({
          rowNumber: rowIndex + 2,
          panelName: rowPanelOwnerName,
          conduitId: normalizeText(row?.[columnMapping.conduitId]) || "-",
          conduitSize: resolvedConduitSize || "-",
          mappedCircuitColumn: normalizeText(columnMapping.circuitNumber) || "-",
          mappedCircuitValue: normalizeText(mappedCircuitRaw) || "-",
          primaryCircuitColumn: primaryCircuitColumn || "-",
          primaryCircuitValue: normalizeText(primaryCircuitRaw) || "-",
          feederSupplyFrom: normalizeText(row?.[columnMapping.feederSupplyFrom]) || "-",
          feederTo: normalizeText(row?.[columnMapping.feederTo]) || "-",
          fromBranchCircuitPanel: normalizeText(row?.[columnMapping.fromBranchCircuitPanel]) || "-",
          toPullBox: normalizeText(row?.[columnMapping.toPullBox]) || "-",
        });
      }

      const panelDetails = panelDetailsByName.get(normalizePanelIdentity(rowPanelOwnerName));
      if (!panelDetails) return;
      PANEL_DETAIL_KEYS.forEach((key) => {
        const mappedColumn = normalizeText(columnMapping[key]);
        if (!mappedColumn) return;
        const nextValue = normalizeText(row?.[mappedColumn]);
        if (!panelDetails[key] && nextValue) {
          panelDetails[key] = nextValue;
        }
      });

      const circuitNumbers = resolvedCircuitNumbers;
      if (!circuitNumbers.length) return;

      const conduitId = normalizeText(row?.[columnMapping.conduitId]);
      const conduitSize = resolvedConduitSize;
      const providedByContractor = normalizeOptionValue(row?.[columnMapping.providedByContractor]);
      const revitStatus = normalizeStatusValue(row?.[columnMapping.revitStatus]);
      const dataStatus = normalizeStatusValue(row?.[columnMapping.dataStatus]);
      const feederTo = normalizeText(row?.[columnMapping.feederTo]);
      const sourcePanelLocation = normalizeText(row?.[columnMapping.sourcePanelLocation]);
      const toPullBox = normalizeText(row?.[columnMapping.toPullBox]);
      const feederSupplyFrom = normalizeText(row?.[columnMapping.feederSupplyFrom]);
      const fromBranchCircuitPanelValue = normalizeText(row?.[columnMapping.fromBranchCircuitPanel]);
      const description = normalizeText(row?.[columnMapping.description]);

      circuitNumbers.forEach((circuitNumber) => {
        circuits.push({
          number: circuitNumber,
          side: circuitNumber % 2 === 1 ? "left" : "right",
          conduitId,
          conduitSize,
          providedByContractor,
          revitStatus,
          dataStatus,
          feederTo,
          sourcePanelLocation,
          toPullBox,
          feederSupplyFrom,
          fromBranchCircuitPanel: fromBranchCircuitPanelValue,
          description,
          panelName: rowPanelOwnerName,
          panelKey: normalizeText(rowPanelOwnerName).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
        });
      });
    });

    const panelHeaders = Array.from(panelDetailsByName.values());
    const defaultName = normalizeText(excelSourceFileName.replace(/\.[^.]+$/, "")) || "Imported Panel";

    if (!circuits.length && !missingCircuitRows.length) {
      toast.error("No valid circuit rows were found. Check your Circuit Number mapping.");
      return null;
    }

    const previewData = {
      sourceFileName: excelSourceFileName,
      name: defaultName,
      panelHeaders,
      circuits,
      circuitCount: circuits.length,
      missingCircuitRows,
      importedFrom: "excel",
    };

    if (!saveOnly) {
      setImportPreview(previewData);
    }

    if (showSummaryToast && circuits.length > 0) {
      toast.success(
        `Preview ready: ${circuits.length} circuits across ${panelHeaders.length} panel(s). ${missingCircuitRows.length} row(s) skipped for missing Circuit #.`
      );
    } else if (showSummaryToast) {
      toast.warn(`No circuits were imported. ${missingCircuitRows.length} row(s) skipped because Circuit # was empty.`);
    }

    return previewData;
  };

  const saveImportData = async (previewData) => {
    if (!previewData || !id || !user?.uid || !selectedProjectId) {
      return 0;
    }

    const panelHeaders = Array.isArray(previewData.panelHeaders) ? previewData.panelHeaders : [];
    const circuits = Array.isArray(previewData.circuits) ? previewData.circuits : [];

    const panelEntries =
      panelHeaders.length > 0
        ? panelHeaders
        : [
            {
              panelName: previewData.name || "Imported Panel",
              panelKey: normalizeText(previewData.name || "Imported Panel")
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, " ")
                .trim(),
              circuitCapacity: DEFAULT_PANEL_CIRCUIT_CAPACITY,
            },
          ];

    const payloads = panelEntries.map((panel) => {
      const panelName = normalizeText(panel?.panelName) || "Imported Panel";
      const panelKey = normalizePanelKey(panel?.panelKey || panelName);
      const panelIdentity = normalizePanelIdentity(panelName);

      const panelCircuits = circuits.filter((row) => {
        const rowPanelKey = normalizePanelKey(row?.panelKey);
        const rowPanelName = normalizeText(row?.panelName);

        if (panelKey && rowPanelKey) return rowPanelKey === panelKey;
        return rowPanelName === panelName;
      });

      const panelMissingCircuitRows = (previewData.missingCircuitRows || []).filter((row) => {
        return rowMatchesPanelIdentity(row, panelIdentity);
      });

      return {
        name: panelName,
        panelKey,
        sourceFileName: previewData.sourceFileName,
        panelHeaders: [panel],
        circuits: panelCircuits,
        missingCircuitRows: panelMissingCircuitRows,
        circuitCount: Number(panelCircuits.length || 0),
        projectId: selectedProjectId,
        projectName: selectedProject?.name || "",
        createdBy: user.uid,
        updatedBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
    });

    const panelKeysToReplace = new Set(payloads.map((payload) => payload.panelKey).filter(Boolean));
    const schedulesCollectionRef = collection(db, "churches", id, "panelSchedules");
    const existingProjectSnapshot = await getDocs(query(schedulesCollectionRef, where("projectId", "==", selectedProjectId)));

    const matchingDeletes = [];
    existingProjectSnapshot.forEach((entry) => {
      const entryData = entry.data() || {};
      const existingPanelKey = normalizePanelKey(entryData.panelKey || entryData.name);
      if (panelKeysToReplace.has(existingPanelKey)) {
        matchingDeletes.push(deleteDoc(doc(db, "churches", id, "panelSchedules", entry.id)));
      }
    });

    if (matchingDeletes.length) {
      await Promise.all(matchingDeletes);
    }

    await Promise.all(
      payloads.map((payload) => {
        const panelDocId = buildPanelScheduleDocId(selectedProjectId, payload.panelKey || payload.name);
        return setDoc(doc(db, "churches", id, "panelSchedules", panelDocId), payload);
      })
    );

    return payloads.length;
  };

  const handleSaveImport = async () => {
    if (!importPreview || !id || !user?.uid || !selectedProjectId) {
      return;
    }

    if (!canManage) {
      toast.error("You do not have permission to save panel schedules.");
      return;
    }

    try {
      setSavingImport(true);
      const savedCount = await saveImportData(importPreview);
      toast.success(`Saved ${savedCount} panel schedule${savedCount === 1 ? "" : "s"}.`);
      setImportPreview(null);
      setExpandedCircuitKey("");
      clearExcelDraft();
      await loadSchedules();
    } catch (error) {
      console.error("Failed to save panel schedule:", error);
      toast.error("Failed to save panel schedule.");
    } finally {
      setSavingImport(false);
    }
  };

  const handleDirectImport = async () => {
    if (!id || !user?.uid || !selectedProjectId) {
      return;
    }

    if (!canManage) {
      toast.error("You do not have permission to save panel schedules.");
      return;
    }

    const previewData = buildPreviewFromExcel({ saveOnly: true, showSummaryToast: false });
    if (!previewData) return;

    try {
      setSavingImport(true);
      const savedCount = await saveImportData(previewData);
      toast.success(`Imported ${savedCount} panel schedule${savedCount === 1 ? "" : "s"} directly.`);
      setImportPreview(null);
      setExpandedCircuitKey("");
      clearExcelDraft();
      await loadSchedules();
    } catch (error) {
      console.error("Failed to direct import panel schedule:", error);
      toast.error("Failed to import panel schedule directly.");
    } finally {
      setSavingImport(false);
    }
  };

  const handleDiscardImport = () => {
    setImportPreview(null);
    setExpandedCircuitKey("");
  };

  const handleDeleteSchedule = async (scheduleId) => {
    if (!id || !scheduleId) return;

    if (!canManage) {
      toast.error("You do not have permission to delete panel schedules.");
      return;
    }

    const confirmed = window.confirm("Delete this panel schedule?");
    if (!confirmed) return;

    try {
      setDeletingId(scheduleId);
      await deleteDoc(doc(db, "churches", id, "panelSchedules", scheduleId));
      toast.success("Panel schedule deleted.");

      setSchedules((current) => current.filter((entry) => entry.id !== scheduleId));
      setSelectedScheduleId((current) => (current === scheduleId ? "" : current));
    } catch (error) {
      console.error("Failed to delete panel schedule:", error);
      toast.error("Failed to delete panel schedule.");
    } finally {
      setDeletingId("");
    }
  };

  const handleDeleteAllSchedules = async () => {
    if (!id || !selectedProjectId) return;
    if (!schedules.length) {
      toast.info("No panel schedules to delete.");
      return;
    }

    if (!canManage) {
      toast.error("You do not have permission to delete panel schedules.");
      return;
    }

    const confirmed = window.confirm(
      `Delete ALL ${schedules.length} panel schedule(s) in this project? This cannot be undone.`
    );
    if (!confirmed) return;

    try {
      setDeletingAll(true);
      await Promise.all(
        schedules.map((entry) => deleteDoc(doc(db, "churches", id, "panelSchedules", entry.id)))
      );
      setSchedules([]);
      setSelectedScheduleId("");
      setImportPreview(null);
      toast.success("All panel schedules deleted.");
    } catch (error) {
      console.error("Failed to delete all panel schedules:", error);
      toast.error("Failed to delete all panel schedules.");
    } finally {
      setDeletingAll(false);
    }
  };

  if (permissionsLoading) {
    return (
      <div className="panel-schedules-page">
        <ChurchHeader id={id} user={user} />
        <div className="panel-schedules-state">Checking access...</div>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="panel-schedules-page">
        <ChurchHeader id={id} user={user} />
        <div className="panel-schedules-state">You do not have access to Panel Schedules.</div>
      </div>
    );
  }

  return (
    <div className="panel-schedules-page">
      <ChurchHeader id={id} user={user} />

      <div className="panel-schedules-shell">
        <div className="panel-schedules-toolbar">
          <div>
            <h1>Panel Schedules</h1>
            <p>Select an IglesiaTech project, import Excel, map columns, then save panel schedules.</p>
          </div>

          <div className="panel-schedules-toolbar-controls">
            <label className="panel-schedules-project-picker">
              <span>Project</span>
              <select value={selectedProjectId} onChange={handleProjectChange} disabled={loadingProjects}>
                <option value="">Select a project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>

            <label className={`panel-schedules-import-btn ${importingExcel ? "is-loading" : ""}`}>
              {importingExcel ? "Importing Excel..." : "Import Excel"}
              <input
                type="file"
                accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                onChange={handleExcelImport}
                disabled={importingExcel || !canManage || !selectedProjectId}
              />
            </label>
          </div>
        </div>

        {excelRows.length > 0 && !importPreview ? (
          <section className="panel-schedules-mapping">
            <div className="panel-schedules-mapping-header">
              <h2>Map Excel Columns</h2>
              <p>
                File: {excelSourceFileName} | Rows: {excelRows.length}
              </p>
            </div>
            <div className="panel-schedules-mapping-grid">
              {MAPPING_FIELD_ORDER.map((field) => (
                <label key={field} className="panel-schedules-mapping-field">
                  <span>{MAPPING_LABELS[field]}</span>
                  <select value={columnMapping[field] || ""} onChange={(event) => handleMappingChange(field, event.target.value)}>
                    <option value="">Not mapped</option>
                    {excelColumns.map((column) => (
                      <option key={`${field}-${column}`} value={column}>
                        {column}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="panel-schedules-mapping-actions">
              <button type="button" onClick={buildPreviewFromExcel}>Build Preview</button>
              <button type="button" onClick={handleDirectImport} disabled={savingImport}>
                {savingImport ? "Importing..." : "Import Directly"}
              </button>
              <button type="button" onClick={clearExcelDraft}>Clear File</button>
            </div>
          </section>
        ) : null}

        <div className="panel-schedules-grid">
          <aside className="panel-schedules-list">
            <h2>Saved Schedules {selectedProject ? `- ${selectedProject.name}` : ""}</h2>
            <div className="panel-schedules-list-controls">
              <input
                type="text"
                placeholder="Search panels..."
                value={panelSearchQuery}
                onChange={(event) => setPanelSearchQuery(event.target.value)}
                disabled={!selectedProjectId || loading}
              />
              <select
                value={listSortMode}
                onChange={(event) => setListSortMode(event.target.value)}
                disabled={!selectedProjectId || loading}
              >
                <option value="recent">Newest First</option>
                <option value="most-complete">Most Complete</option>
              </select>
              <button
                type="button"
                className="panel-schedules-delete-all"
                onClick={handleDeleteAllSchedules}
                disabled={!selectedProjectId || !schedules.length || deletingAll || loading}
              >
                {deletingAll ? "Deleting..." : "Delete All Panels"}
              </button>
            </div>
            {!selectedProjectId ? (
              <div className="panel-schedules-state">Select a project first to load panel schedules.</div>
            ) : null}
            {loading ? <div className="panel-schedules-state">Loading schedules...</div> : null}
            {!loading && selectedProjectId && schedules.length === 0 ? (
              <div className="panel-schedules-state">No panel schedules saved yet.</div>
            ) : null}
            {!loading && selectedProjectId && schedules.length > 0 && filteredSchedules.length === 0 ? (
              <div className="panel-schedules-state">No panels match your search.</div>
            ) : null}

            {filteredSchedules.map((schedule) => {
              const isSelected = schedule.id === selectedScheduleId && !importPreview;
              return (
                <button
                  key={schedule.id}
                  type="button"
                  className={`panel-schedules-list-item ${isSelected ? "is-active" : ""}`}
                  onClick={() => {
                    setImportPreview(null);
                    setExpandedCircuitKey("");
                    setSelectedScheduleId(schedule.id);
                  }}
                >
                  <div>
                    <strong>{schedule.name || "Untitled Panel"}</strong>
                    <span>{(schedule.circuitCount || schedule?.circuits?.length || 0)} circuits</span>
                    <small>{formatDateTime(schedule.updatedAt || schedule.createdAt)}</small>
                  </div>
                  {canManage ? (
                    <span
                      role="button"
                      tabIndex={0}
                      className={`panel-schedules-delete ${deletingId === schedule.id ? "is-loading" : ""}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!deletingId) {
                          handleDeleteSchedule(schedule.id);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          if (!deletingId) {
                            handleDeleteSchedule(schedule.id);
                          }
                        }
                      }}
                    >
                      {deletingId === schedule.id ? "..." : "Delete"}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </aside>

          <main className="panel-schedules-content">
            {!importPreview && filteredSchedules.length > 0 ? (
              <div className="panel-schedules-dataset-nav" role="group" aria-label="Dataset navigation">
                <button
                  type="button"
                  onClick={() => goToAdjacentSchedule(-1)}
                  disabled={!canGoToPreviousSchedule}
                >
                  &lt;&lt; Previous
                </button>
                <span>
                  Dataset {selectedScheduleIndex >= 0 ? selectedScheduleIndex + 1 : 1} of {filteredSchedules.length}
                </span>
                <button
                  type="button"
                  onClick={() => goToAdjacentSchedule(1)}
                  disabled={!canGoToNextSchedule}
                >
                  Next &gt;&gt;
                </button>
              </div>
            ) : null}

            {importPreview ? (
              <div className="panel-schedules-preview-banner">
                <strong>Unsaved Import:</strong> {importPreview.sourceFileName} | {importPreview.circuitCount} circuits
                <div className="panel-schedules-preview-actions">
                  <button type="button" onClick={handleDiscardImport} disabled={savingImport}>
                    Discard
                  </button>
                  <button type="button" onClick={handleSaveImport} disabled={savingImport}>
                    {savingImport ? "Saving..." : "Save Schedule"}
                  </button>
                </div>
              </div>
            ) : null}

            {!selectedProjectId ? (
              <div className="panel-schedules-state">Choose a project to start importing or viewing panel schedules.</div>
            ) : null}

            {selectedProjectId && !importPreview && !selectedSchedule ? (
              <div className="panel-schedules-state">Import Excel and build preview, or select a saved schedule.</div>
            ) : null}

            {selectedProjectId && (activeCircuits.length > 0 || activePanelHeaders.length > 0 || selectedSchedule) ? (
              <section className="panel-schedules-section">
                <h2>Circuit Layout ({activeCircuits.length || DEFAULT_PANEL_CIRCUIT_CAPACITY})</h2>

                {circuitSections.map((section) => {
                  const sectionPanel = panelHeaderByIdentity.get(normalizePanelIdentity(section.panelName)) || null;
                  const sectionPanelKey =
                    sectionPanel?.panelKey || `${sectionPanel?.panelName || section.panelName || "panel"}-${sectionPanel?.__panelIndex || 0}`;

                  return (
                    <div className="panel-schedules-split-wrap" key={`section-${section.panelName}`}>
                      <div className="panel-schedules-split-header">
                        <h3>{section.panelName}</h3>
                        {sectionPanel ? (
                          <div className="panel-schedules-split-header-meta">
                            {PANEL_HEADER_DISPLAY_FIELDS.map((field) => (
                              <span key={`${sectionPanelKey}-${field.key}`}>
                                {field.label}: {sectionPanel[field.key] || "-"}
                              </span>
                            ))}
                            <span>
                              Circuit Capacity:
                              <select
                                value={normalizePanelCircuitCapacity(sectionPanel?.circuitCapacity)}
                                onChange={(event) =>
                                  handlePanelCircuitCapacityChange(
                                    sectionPanelKey,
                                    event.target.value
                                  )
                                }
                                disabled={!importPreview && !canManage}
                              >
                                {PANEL_CIRCUIT_CAPACITY_OPTIONS.map((size) => (
                                  <option key={`${sectionPanelKey}-capacity-${size}`} value={size}>
                                    {size}
                                  </option>
                                ))}
                              </select>
                            </span>
                          </div>
                        ) : null}
                      </div>

                      <div className="panel-schedules-split-rows">
                        {section.pairRows.map(({ baseNumber, oddCircuit, evenCircuit }) => (
                          <div className="panel-schedules-split-row" key={`${section.panelName}-${baseNumber}`}>
                            {(() => {
                              const oddCardKey = `${section.panelName}-${baseNumber}-left`;
                              const evenCardKey = `${section.panelName}-${baseNumber}-right`;
                              return (
                                <>
                            <CircuitCard
                              circuitNumber={oddCircuit?.number || baseNumber}
                              row={oddCircuit}
                              side="left"
                              expanded={expandedCircuitKey === oddCardKey}
                              onToggle={() =>
                                setExpandedCircuitKey((current) => (current === oddCardKey ? "" : oddCardKey))
                              }
                              conduitColor={
                                conduitColorByIdentity.get(normalizePanelIdentity(oddCircuit?.conduitId || "")) || null
                              }
                            />
                            <CircuitCard
                              circuitNumber={evenCircuit?.number || baseNumber + 1}
                              row={evenCircuit}
                              side="right"
                              expanded={expandedCircuitKey === evenCardKey}
                              onToggle={() =>
                                setExpandedCircuitKey((current) => (current === evenCardKey ? "" : evenCardKey))
                              }
                              conduitColor={
                                conduitColorByIdentity.get(normalizePanelIdentity(evenCircuit?.conduitId || "")) || null
                              }
                            />
                                </>
                              );
                            })()}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </section>
            ) : null}

            {selectedProjectId && (importPreview || selectedSchedule) ? (
              <section className="panel-schedules-section panel-schedules-conduit-report">
                <div className="panel-schedules-report-heading">
                  <span>Conduit Report</span>
                  <h2>Conduit Schedule By Color Group</h2>
                </div>
                {conduitScheduleRows.length ? (
                  <div className="panel-schedules-conduit-list">
                    {conduitScheduleRows.map((entry) => {
                      const colorMeta =
                        conduitColorByIdentity.get(entry.conduitIdentity) ||
                        buildConduitColorMeta(entry.conduitId);

                      return (
                        <article className="panel-schedules-conduit-item" key={`conduit-report-${entry.conduitIdentity}`}>
                          <div className="panel-schedules-conduit-item-title">
                            <span
                              className="panel-schedules-conduit-dot"
                              style={{ background: colorMeta.accent }}
                              aria-hidden="true"
                            />
                            <strong>{entry.conduitId}</strong>
                            {entry.connectionType !== "unknown" ? (
                              <span className={`panel-schedules-conduit-type type-${entry.connectionType}`}>
                                {entry.connectionType === "branch" ? "Branch" : "Feeder"}
                              </span>
                            ) : null}
                            <span>Size: {entry.primarySize}</span>
                          </div>
                          {entry.connectionType === "feeder" ? (
                            <p>
                              Feeder Supply From: {entry.feederSupplyFrom} | Feeder to: {entry.feederTo}
                            </p>
                          ) : null}
                          {entry.connectionType === "branch" ? (
                            <p>
                              From Branch Circuit Panel: {entry.fromBranchCircuitPanel} | To Pull Box: {entry.toPullBox}
                            </p>
                          ) : null}
                          {entry.sizeOptions.length > 1 ? (
                            <p className="panel-schedules-conduit-warning">
                              Multiple sizes found: {entry.sizeOptions.join(", ")}
                            </p>
                          ) : null}
                          <p>
                            Circuits: {entry.circuitNumbers.length ? entry.circuitNumbers.join(", ") : "-"}
                          </p>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <p>No conduit groups found for this panel view.</p>
                )}
              </section>
            ) : null}

            {selectedProjectId && (importPreview || selectedSchedule) ? (
              <section className="panel-schedules-section panel-schedules-missing-report">
                <div className="panel-schedules-report-heading">
                  <span>Data Quality Report</span>
                  <h2>Rows Not Imported: Missing Circuit #</h2>
                </div>
                {activeMissingCircuitRows.length ? (
                  <>
                    <p>
                      {activeMissingCircuitRows.length} row(s) were skipped because Circuit # was blank or invalid.
                    </p>
                    <div className="panel-schedules-missing-list">
                      {activeMissingCircuitRows.map((entry, index) => {
                        const itemKey = `missing-circuit-${entry.rowNumber}-${index}`;
                        const isExpanded = expandedMissingRowKey === itemKey;

                        const summaryItems = [
                          ["Feeder Supply From", entry.feederSupplyFrom],
                          ["Feeder to", entry.feederTo],
                          ["From Branch Circuit Panel", entry.fromBranchCircuitPanel],
                          ["To Pull Box", entry.toPullBox],
                          ["Conduit Size", entry.conduitSize],
                        ].filter(([, value]) => {
                          const nextValue = normalizeText(value);
                          return nextValue && !isIgnoredPanelLabel(nextValue) && nextValue !== "-";
                        });

                        return (
                          <article key={itemKey} className={`panel-schedules-missing-item ${isExpanded ? "is-expanded" : ""}`}>
                            <button
                              type="button"
                              className="panel-schedules-missing-toggle"
                              onClick={() => setExpandedMissingRowKey((current) => (current === itemKey ? "" : itemKey))}
                              aria-expanded={isExpanded}
                            >
                              <strong>Row {entry.rowNumber}</strong>
                              <div className="panel-schedules-missing-inline">
                                {summaryItems.length ? (
                                  summaryItems.map(([label, value]) => (
                                    <span key={`${itemKey}-${label}`}>{label}: {value}</span>
                                  ))
                                ) : (
                                  <span>No non-empty feeder fields on this row.</span>
                                )}
                              </div>
                            </button>

                            {isExpanded ? (
                              <div className="panel-schedules-missing-meta">
                                <span>Panel: {entry.panelName || "-"}</span>
                                <span>Conduit ID: {entry.conduitId || "-"}</span>
                                <span>Conduit Size: {entry.conduitSize || "-"}</span>
                                <span>Mapped Circuit Column: {entry.mappedCircuitColumn || "-"}</span>
                                <span>Mapped Circuit Value: {entry.mappedCircuitValue || "-"}</span>
                                <span>Primary Circuit Column: {entry.primaryCircuitColumn || "-"}</span>
                                <span>Primary Circuit Value: {entry.primaryCircuitValue || "-"}</span>
                              </div>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <p>No rows are currently missing Circuit # for this panel.</p>
                )}
              </section>
            ) : null}
          </main>
        </div>
      </div>
    </div>
  );
};

export default PanelSchedules;
