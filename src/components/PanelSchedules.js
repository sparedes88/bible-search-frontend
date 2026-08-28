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
import { getDownloadURL, ref as storageRef, uploadBytesResumable } from "firebase/storage";
import { toast } from "react-toastify";
import ChurchHeader from "./ChurchHeader";
import { useAuth } from "../contexts/AuthContext";
import { db, storage } from "../firebase";
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
  "planSheetLink",
  "singleLine",
  "sheet",
  "area",
  "construction",
  "constructionPhase",
  "projectPhase",
  "revitConduitId",
  "shopRevision",
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
  planSheetLink: "",
  singleLine: "",
  sheet: "",
  area: "",
  construction: "",
  constructionPhase: "",
  projectPhase: "",
  revitConduitId: "",
  shopRevision: "",
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
  planSheetLink: "Link",
  singleLine: "Single Line",
  sheet: "Sheet",
  area: "Area",
  construction: "Construction",
  constructionPhase: "Construction Phase",
  projectPhase: "Phase",
  revitConduitId: "Revit Conduit ID",
  shopRevision: "Shop Revision",
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
  "planSheetLink",
  "singleLine",
  "sheet",
  "area",
  "construction",
  "constructionPhase",
  "projectPhase",
  "revitConduitId",
  "shopRevision",
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
  planSheetLink: ["link", "plan sheet link", "plansheetlink", "url"],
  singleLine: ["single line", "singleline"],
  sheet: ["sheet"],
  area: ["area"],
  construction: ["construction"],
  constructionPhase: ["construction phase", "phase", "project phase"],
  projectPhase: ["phase", "construction phase", "project phase"],
  revitConduitId: ["revit conduit id", "revitconduid", "revit conduit", "cond id", "conduit id revit"],
  shopRevision: ["shop revision", "shoprevision", "revision", "shop rev"],
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
  const hasFeederFrom = feederSupplyFrom && !isIgnoredPanelLabel(feederSupplyFrom);
  const hasFeederTo = feederTo && !isIgnoredPanelLabel(feederTo);

  if (hasFeederFrom || hasFeederTo) {
    return "feeder";
  }

  if (hasBranchFrom || hasToPullBox) {
    return "branch";
  }

  return "NA";
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

const CircuitCard = ({
  circuitNumber,
  row,
  side = "left",
  conduitColor = null,
  expanded = false,
  onToggle = () => {},
  planSheetNote = "",
  planSheetLink = "",
}) => {
  const isRightSide = side === "right";
  const planSheetNoteDisplay = normalizeText(planSheetNote);
  const planSheetLinkDisplay = normalizeText(planSheetLink);
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
          {planSheetNoteDisplay ? <p><label>Plan Sheet Note:</label> {planSheetNoteDisplay}</p> : null}
          {planSheetLinkDisplay ? (
            <p>
              <label>Link:</label>{" "}
              <a href={planSheetLinkDisplay} target="_blank" rel="noreferrer">
                {planSheetLinkDisplay}
              </a>
            </p>
          ) : null}
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
  const [pageTab, setPageTab] = useState("schedules");
  const [qualityReportTab, setQualityReportTab] = useState("current");
  const [statusTablePanelFilter, setStatusTablePanelFilter] = useState("all");
  const [statusTableContractorFilter, setStatusTableContractorFilter] = useState("all");
  const [statusTableRevitFilter, setStatusTableRevitFilter] = useState("all");
  const [statusTableDataFilter, setStatusTableDataFilter] = useState("all");
  const [statusTablePhaseFilter, setStatusTablePhaseFilter] = useState("all");
  const [statusTableSearchQuery, setStatusTableSearchQuery] = useState("");
  const [panelHeaderBuildLinkDrafts, setPanelHeaderBuildLinkDrafts] = useState({});
  const [editingBuildLinkPanelKey, setEditingBuildLinkPanelKey] = useState(null);
  const [manualCircuitAssignments, setManualCircuitAssignments] = useState({});
  const [draftMissingCircuitSelections, setDraftMissingCircuitSelections] = useState({});
  const [rfiQuestions, setRfiQuestions] = useState([]);
  const [expandedRfiQuestionId, setExpandedRfiQuestionId] = useState("");
  const [rfiConduitSearch, setRfiConduitSearch] = useState("");
  const [rfiAttachments, setRfiAttachments] = useState([]);
  const [rfiForm, setRfiForm] = useState({
    rfiNumber: "",
    title: "",
    description: "",
    conduitIds: [],
  });
  const [savingRfi, setSavingRfi] = useState(false);
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

        const savedPreferences = readPanelSchedulePreferences(id, user?.uid);
        const lastUsedProjectId = savedPreferences?.projectId;
        const fallbackProjectId = nextProjects[0]?.id || "";

        setProjects(nextProjects);
        setSelectedProjectId((previous) => {
          if (previous && nextProjects.some((project) => project.id === previous)) {
            return previous;
          }

          if (lastUsedProjectId && nextProjects.some((project) => project.id === lastUsedProjectId)) {
            return lastUsedProjectId;
          }

          return fallbackProjectId;
        });
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

  const loadRfiQuestions = useCallback(async () => {
    if (!id || !selectedProjectId) {
      setRfiQuestions([]);
      return;
    }

    try {
      const questionsQuery = query(
        collection(db, "churches", id, "panelScheduleQuestions"),
        where("projectId", "==", selectedProjectId)
      );
      const snapshot = await getDocs(questionsQuery);
      const rows = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      rows.sort((left, right) => {
        const leftTime = left?.updatedAt?.seconds || left?.createdAt?.seconds || 0;
        const rightTime = right?.updatedAt?.seconds || right?.createdAt?.seconds || 0;
        return Number(rightTime) - Number(leftTime);
      });
      setRfiQuestions(rows);
    } catch (error) {
      console.error("Failed to load panel schedule RFIs:", error);
      setRfiQuestions([]);
    }
  }, [id, selectedProjectId]);

  useEffect(() => {
    loadRfiQuestions();
  }, [loadRfiQuestions]);

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

  const projectConduitRows = useMemo(() => {
    const previewRows = Array.isArray(importPreview?.circuits) ? importPreview.circuits : [];
    const savedRows = schedules.flatMap((schedule) => Array.isArray(schedule?.circuits) ? schedule.circuits : []);
    const missingRows = schedules.flatMap((schedule) => Array.isArray(schedule?.missingCircuitRows) ? schedule.missingCircuitRows : []);
    return [...previewRows, ...savedRows, ...missingRows];
  }, [importPreview, schedules]);

  const conduitOptions = useMemo(() => {
    const conduitValues = projectConduitRows
      .map((row) => normalizeText(row?.conduitId))
      .filter((value) => value && !isIgnoredPanelLabel(value));

    return Array.from(new Set(conduitValues)).sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base", numeric: true })
    );
  }, [projectConduitRows]);

  const filteredConduitOptions = useMemo(() => {
    const normalizedSearch = normalizeText(rfiConduitSearch).toLowerCase();
    return conduitOptions.filter((conduitId) => {
      if (!normalizedSearch) return true;
      return conduitId.toLowerCase().includes(normalizedSearch);
    });
  }, [conduitOptions, rfiConduitSearch]);

  const activeConduitDetails = useMemo(() => {
    const selectedConduitIds = Array.isArray(rfiForm.conduitIds) ? rfiForm.conduitIds : [];
    if (!selectedConduitIds.length) return [];

    return projectConduitRows.filter((row) => {
      const conduitId = normalizeText(row?.conduitId);
      return selectedConduitIds.some((selectedId) => normalizeText(selectedId) === conduitId);
    });
  }, [projectConduitRows, rfiForm.conduitIds]);

  const selectedConduitAssociations = useMemo(() => {
    return rfiForm.conduitIds.map((conduitId) => {
      const matchingRows = activeConduitDetails.filter(
        (row) => normalizeText(row?.conduitId) === normalizeText(conduitId)
      );
      const firstValue = (field) => normalizeText(matchingRows.find((row) => normalizeText(row?.[field]))?.[field]) || "-";

      return {
        conduitId,
        panelNames: Array.from(new Set(matchingRows.map((row) => normalizeText(row?.panelName)).filter(Boolean))),
        circuitNumbers: Array.from(new Set(matchingRows.map((row) => normalizeCircuitNumber(row?.number)).filter((value) => value !== null))).sort((left, right) => left - right),
        conduitSize: firstValue("conduitSize"),
        feederSupplyFrom: firstValue("feederSupplyFrom"),
        feederTo: firstValue("feederTo"),
        toPullBox: firstValue("toPullBox"),
      };
    });
  }, [activeConduitDetails, rfiForm.conduitIds]);

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

  const normalizeAssignedCircuitValues = useCallback((value) => {
    const rawValues = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(",")
        : [];

    const normalized = rawValues
      .flatMap((entry) => String(entry).split(","))
      .map((entry) => Number(String(entry).trim()))
      .filter((entry) => Number.isInteger(entry) && entry > 0);

    return Array.from(new Set(normalized)).sort((left, right) => left - right);
  }, []);

  const buildMissingRowAssignmentKey = useCallback((scheduleId, entry, fallbackPanelName = "panel") => {
    const panelName = normalizeText(entry?.panelName || fallbackPanelName);
    const safeScheduleId = scheduleId || "unknown";
    return [
      safeScheduleId,
      normalizePanelIdentity(panelName),
      entry.rowNumber || "unknown",
      normalizeText(entry.conduitId) || "na",
    ].join("::");
  }, []);

  const getAvailableCircuitNumbersForPanel = useCallback((panelName, scheduleId = importPreview?.id || selectedSchedule?.id) => {
    const targetPanelName = normalizeText(panelName);
    if (!targetPanelName) return [];

    const targetIdentity = normalizePanelIdentity(targetPanelName);
    const scheduleForPanel = scheduleId
      ? (schedules.find((schedule) => schedule.id === scheduleId) || null)
      : null;

    const circuitSource = scheduleForPanel?.circuits || activeCircuits || [];
    const panelHeaderSource = scheduleForPanel?.panelHeaders || activePanelHeaders || [];

    const usedNumbers = new Set(
      circuitSource
        .filter((row) => normalizePanelIdentity(row?.panelName) === targetIdentity)
        .map((row) => normalizeCircuitNumber(row?.number))
        .filter((value) => value !== null)
    );

    const targetPanel = panelHeaderSource.find(
      (panel) => normalizePanelIdentity(panel?.panelName) === targetIdentity
    );

    const capacity = normalizePanelCircuitCapacity(targetPanel?.circuitCapacity || DEFAULT_PANEL_CIRCUIT_CAPACITY);
    const assignedValues = new Set(
      Object.entries(manualCircuitAssignments)
        .filter(([key]) => {
          const [keyScheduleId, keyPanelIdentity] = key.split("::");
          return keyScheduleId === (scheduleId || "unknown") && keyPanelIdentity === targetIdentity;
        })
        .flatMap(([, value]) => normalizeAssignedCircuitValues(value))
    );

    const choices = [];
    for (let number = 1; number <= capacity; number += 1) {
      if (!usedNumbers.has(number) && !assignedValues.has(number)) {
        choices.push(number);
      }
    }

    return choices;
  }, [activeCircuits, activePanelHeaders, importPreview?.id, manualCircuitAssignments, normalizeAssignedCircuitValues, schedules, selectedSchedule?.id]);

  const dataQualityReportedKeys = useMemo(() => {
    const keys = new Set();

    const registerMissingRows = (missingRows = []) => {
      missingRows.forEach((entry) => {
        const panelName = normalizeText(entry?.panelName || "");
        const conduitId = normalizeText(entry?.conduitId);
        const normalizedConduitId = isIgnoredPanelLabel(conduitId) ? "blank" : conduitId;
        const rowNumber = normalizeText(entry?.rowNumber || "");

        if (!panelName && !normalizedConduitId && !rowNumber) return;

        keys.add(`${panelName}::${normalizedConduitId}::${rowNumber || "unknown"}`);
      });
    };

    schedules.forEach((schedule) => registerMissingRows(schedule?.missingCircuitRows));
    if (importPreview?.missingCircuitRows) registerMissingRows(importPreview.missingCircuitRows);

    return keys;
  }, [importPreview, schedules]);

  const statusTableRows = useMemo(() => {
    const projectRows = schedules.flatMap((schedule) => {
      const scheduleRows = Array.isArray(schedule?.circuits) ? schedule.circuits : [];
      const missingRows = Array.isArray(schedule?.missingCircuitRows) ? schedule.missingCircuitRows : [];
      const panelHeaderRows = Array.isArray(schedule?.panelHeaders) ? schedule.panelHeaders : [];
      return [...scheduleRows, ...missingRows, ...panelHeaderRows];
    });

    const previewRows = Array.isArray(importPreview?.circuits) ? importPreview.circuits : [];
    const previewMissingRows = Array.isArray(importPreview?.missingCircuitRows) ? importPreview.missingCircuitRows : [];
    const previewHeaderRows = Array.isArray(importPreview?.panelHeaders) ? importPreview.panelHeaders : [];

    const groupedRows = new Map();

    const registerRow = (row) => {
      const panelName = normalizeText(row?.panelName || row?.name || "");
      const conduitId = normalizeText(row?.conduitId);
      const normalizedConduitId = isIgnoredPanelLabel(conduitId) ? "" : conduitId;
      const circuitNumber = normalizeCircuitNumber(row?.number ?? row?.circuitNumber);
      const connectionType = getConnectionTypeFromRow(row);
      if (!panelName && !normalizedConduitId && circuitNumber === null) return;

      const matchingPanelGroup = !normalizedConduitId && panelName
        ? Array.from(groupedRows.entries()).find(([_, existingRow]) => {
            return normalizeText(existingRow?.panelName) === panelName && normalizeText(existingRow?.connectionType || "") === connectionType;
          })
        : null;

      const groupKey = matchingPanelGroup ? matchingPanelGroup[0] : `${panelName || "Unassigned"}::${normalizedConduitId || "Unassigned"}::${connectionType}`;
      const existing = groupedRows.get(groupKey) || {
        panelName,
        conduitId,
        number: "",
        conduitSize: "",
        feederSupplyFrom: "",
        feederTo: "",
        fromBranchCircuitPanel: "",
        toPullBox: "",
        constructionPhase: "",
        revitConduitId: "",
        shopRevision: "",
        providedByContractor: "",
        revitStatus: "",
        dataStatus: "",
        groupedNumbers: [],
        connectionType,
        reportedInDataQuality: false,
      };

      if (circuitNumber !== null) {
        const nextNumbers = existing.groupedNumbers || [];
        if (!nextNumbers.includes(circuitNumber)) {
          nextNumbers.push(circuitNumber);
          nextNumbers.sort((left, right) => left - right);
        }
        existing.groupedNumbers = nextNumbers;
        existing.number = nextNumbers.join(", ");
      }

      if (!existing.panelName && panelName) existing.panelName = panelName;
      if (!existing.conduitId && normalizedConduitId) existing.conduitId = normalizedConduitId;
      existing.connectionType = existing.connectionType || connectionType;

      const rowConduitSize = normalizeText(row?.conduitSize);
      const rowFeederSupplyFrom = normalizeText(row?.feederSupplyFrom);
      const rowFeederTo = normalizeText(row?.feederTo);
      const rowFromBranchCircuitPanel = normalizeText(row?.fromBranchCircuitPanel);
      const rowToPullBox = normalizeText(row?.toPullBox);
      const rowConstructionPhase = normalizeText(row?.constructionPhase || row?.projectPhase);
      const rowRevitConduitId = normalizeText(row?.revitConduitId);
      const rowShopRevision = normalizeText(row?.shopRevision);

      if (!existing.conduitSize && rowConduitSize) existing.conduitSize = rowConduitSize;
      if (!existing.feederSupplyFrom && rowFeederSupplyFrom) existing.feederSupplyFrom = rowFeederSupplyFrom;
      if (!existing.feederTo && rowFeederTo) existing.feederTo = rowFeederTo;
      if (!existing.fromBranchCircuitPanel && rowFromBranchCircuitPanel) existing.fromBranchCircuitPanel = rowFromBranchCircuitPanel;
      if (!existing.toPullBox && rowToPullBox) existing.toPullBox = rowToPullBox;
      if (!existing.constructionPhase && rowConstructionPhase) existing.constructionPhase = rowConstructionPhase;
      if (!existing.revitConduitId && rowRevitConduitId) existing.revitConduitId = rowRevitConduitId;
      if (!existing.shopRevision && rowShopRevision) existing.shopRevision = rowShopRevision;

      const rowKey = `${panelName}::${normalizedConduitId || "blank"}::${normalizeText(row?.rowNumber || "unknown")}`;
      existing.reportedInDataQuality = existing.reportedInDataQuality || dataQualityReportedKeys.has(rowKey) || (
        panelName && Array.from(dataQualityReportedKeys).some((key) => key.startsWith(`${panelName}::`))
      );

      const contractorValue = normalizeOptionValue(row?.providedByContractor);
      const revitValue = normalizeStatusValue(row?.revitStatus);
      const dataValue = normalizeStatusValue(row?.dataStatus);

      if (!existing.providedByContractor && contractorValue) existing.providedByContractor = contractorValue;
      if (!existing.revitStatus && revitValue) existing.revitStatus = revitValue;
      if (!existing.dataStatus && dataValue) existing.dataStatus = dataValue;

      groupedRows.set(groupKey, existing);
    };

    [...projectRows, ...previewRows, ...previewMissingRows, ...previewHeaderRows].forEach(registerRow);

    const groupedValues = Array.from(groupedRows.values());

    return groupedValues.filter((row) => {
      const panelName = normalizeText(row?.panelName);
      const hasIdentity = panelName || normalizeText(row?.conduitId) || normalizeText(row?.number);
      if (!hasIdentity) return false;

      const isPlaceholderRow = !(
        normalizeText(row?.conduitId) ||
        normalizeText(row?.conduitSize) ||
        normalizeText(row?.feederSupplyFrom) ||
        normalizeText(row?.feederTo) ||
        normalizeText(row?.fromBranchCircuitPanel) ||
        normalizeText(row?.toPullBox) ||
        normalizeText(row?.providedByContractor) ||
        normalizeText(row?.revitStatus) ||
        normalizeText(row?.dataStatus) ||
        normalizeText(row?.number)
      );

      if (!isPlaceholderRow) return true;

      if (!panelName) return true;

      return !groupedValues.some((other) => {
        if (other === row) return false;
        if (normalizeText(other?.panelName) !== panelName) return false;
        return Boolean(
          normalizeText(other?.conduitId) ||
          normalizeText(other?.conduitSize) ||
          normalizeText(other?.feederSupplyFrom) ||
          normalizeText(other?.feederTo) ||
          normalizeText(other?.fromBranchCircuitPanel) ||
          normalizeText(other?.toPullBox) ||
          normalizeText(other?.providedByContractor) ||
          normalizeText(other?.revitStatus) ||
          normalizeText(other?.dataStatus) ||
          normalizeText(other?.number)
        );
      });
    });
  }, [dataQualityReportedKeys, importPreview, schedules]);

  const statusTablePanelOptions = useMemo(() => {
    const panelNames = new Set();
    statusTableRows.forEach((row) => {
      const panelName = normalizeText(row?.panelName);
      if (panelName) panelNames.add(panelName);
    });

    return Array.from(panelNames).sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base", numeric: true })
    );
  }, [statusTableRows]);

  const statusTableContractorOptions = useMemo(() => {
    const values = new Set();
    statusTableRows.forEach((row) => {
      const value = normalizeOptionValue(row?.providedByContractor);
      if (value) values.add(value);
    });

    return Array.from(values).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
  }, [statusTableRows]);

  const statusTableRevitOptions = useMemo(() => {
    const values = new Set();
    statusTableRows.forEach((row) => {
      const value = normalizeStatusValue(row?.revitStatus);
      if (value) values.add(value);
    });

    return Array.from(values).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
  }, [statusTableRows]);

  const statusTableDataOptions = useMemo(() => {
    const values = new Set();
    statusTableRows.forEach((row) => {
      const value = normalizeStatusValue(row?.dataStatus);
      if (value) values.add(value);
    });

    return Array.from(values).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
  }, [statusTableRows]);

  const statusTablePhaseOptions = useMemo(() => {
    const values = new Set();
    statusTableRows.forEach((row) => {
      const value = normalizeStatusValue(row?.constructionPhase || row?.projectPhase);
      if (value) values.add(value);
    });

    return Array.from(values).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
  }, [statusTableRows]);

  const filteredStatusTableRows = useMemo(() => {
    const searchTerm = normalizeText(statusTableSearchQuery).toLowerCase();

    const rows = statusTableRows.filter((row) => {
      const panelMatches = statusTablePanelFilter === "all" || normalizeText(row?.panelName) === statusTablePanelFilter;
      const contractorValue = normalizeOptionValue(row?.providedByContractor);
      const contractorMatches = statusTableContractorFilter === "all" || contractorValue === statusTableContractorFilter;
      const revitValue = normalizeStatusValue(row?.revitStatus);
      const revitMatches = statusTableRevitFilter === "all" || revitValue === statusTableRevitFilter;
      const dataValue = normalizeStatusValue(row?.dataStatus);
      const dataMatches = statusTableDataFilter === "all" || dataValue === statusTableDataFilter;
      const phaseValue = normalizeStatusValue(row?.constructionPhase || row?.projectPhase);
      const phaseMatches = statusTablePhaseFilter === "all" || phaseValue === statusTablePhaseFilter;
      const searchableValue = [
        row?.panelName,
        row?.conduitId,
        row?.revitConduitId,
        row?.conduitSize,
        row?.feederSupplyFrom,
        row?.feederTo,
        row?.fromBranchCircuitPanel,
        row?.toPullBox,
        row?.constructionPhase,
        row?.projectPhase,
        row?.shopRevision,
        row?.providedByContractor,
        row?.revitStatus,
        row?.dataStatus,
        Array.isArray(row?.groupedNumbers) ? row.groupedNumbers.join(", ") : row?.number,
        getConnectionTypeFromRow(row),
      ].join(" ").toLowerCase();
      const searchMatches = !searchTerm || searchableValue.includes(searchTerm);

      return panelMatches && contractorMatches && revitMatches && dataMatches && phaseMatches && searchMatches;
    });

    return rows.sort((left, right) => {
      const leftPanel = normalizeText(left?.panelName || "");
      const rightPanel = normalizeText(right?.panelName || "");
      const leftNumbers = Array.isArray(left?.groupedNumbers) ? left.groupedNumbers : [];
      const rightNumbers = Array.isArray(right?.groupedNumbers) ? right.groupedNumbers : [];
      const leftNumber = leftNumbers.length ? leftNumbers[0] : normalizeCircuitNumber(left?.number);
      const rightNumber = rightNumbers.length ? rightNumbers[0] : normalizeCircuitNumber(right?.number);

      return leftPanel.localeCompare(rightPanel, undefined, { sensitivity: "base", numeric: true }) ||
        (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) ? leftNumber - rightNumber : 0);
    });
  }, [statusTableContractorFilter, statusTableDataFilter, statusTablePanelFilter, statusTablePhaseFilter, statusTableRevitFilter, statusTableRows, statusTableSearchQuery]);

  const statusTableSections = useMemo(() => {
    const sections = {
      feeder: [],
      branch: [],
    };

    filteredStatusTableRows.forEach((row) => {
      const type = getConnectionTypeFromRow(row);
      if (type === "feeder") {
        sections.feeder.push(row);
      } else if (type === "branch") {
        sections.branch.push(row);
      }
    });

    return sections;
  }, [filteredStatusTableRows]);

  const renderStatusTableSection = (title, rows, sectionType) => {
    const isFeeder = sectionType === "feeder";
    const isBranch = sectionType === "branch";

    return (
      <div key={title} style={{ display: "grid", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #dfe3e8", paddingBottom: "6px" }}>
          <h3 style={{ margin: 0, fontSize: "18px" }}>{title}</h3>
          <span style={{ fontSize: "12px", color: "#475569", background: "#f1f5f9", padding: "4px 8px", borderRadius: "999px" }}>
            {rows.length} row{rows.length === 1 ? "" : "s"}
          </span>
        </div>

        <div style={{ overflowX: "auto", width: "100%" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #dfe3e8", tableLayout: "fixed" }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                <th style={{ width: "12%", padding: "10px 12px", textAlign: "left", borderBottom: "1px solid #dfe3e8" }}>Panel</th>
                <th style={{ width: "8%", padding: "10px 12px", textAlign: "left", borderBottom: "1px solid #dfe3e8" }}>Circuit #</th>
                <th style={{ width: "12%", padding: "10px 12px", textAlign: "left", borderBottom: "1px solid #dfe3e8" }}>Conduit ID</th>
                <th style={{ width: "10%", padding: "10px 12px", textAlign: "left", borderBottom: "1px solid #dfe3e8" }}>Revit Conduit ID</th>
                <th style={{ width: "10%", padding: "10px 12px", textAlign: "left", borderBottom: "1px solid #dfe3e8" }}>Conduit Size</th>
                {!isBranch ? (
                  <>
                    <th style={{ width: "12%", padding: "10px 12px", textAlign: "left", borderBottom: "1px solid #dfe3e8" }}>Feeder Supply From</th>
                    <th style={{ width: "12%", padding: "10px 12px", textAlign: "left", borderBottom: "1px solid #dfe3e8" }}>Feeder To</th>
                  </>
                ) : null}
                {!isFeeder ? (
                  <>
                    <th style={{ width: "12%", padding: "10px 12px", textAlign: "left", borderBottom: "1px solid #dfe3e8" }}>From Branch Circuit Panel</th>
                    <th style={{ width: "12%", padding: "10px 12px", textAlign: "left", borderBottom: "1px solid #dfe3e8" }}>To Pull Box</th>
                  </>
                ) : null}
                <th style={{ width: "10%", padding: "10px 12px", textAlign: "left", borderBottom: "1px solid #dfe3e8" }}>Construction Phase</th>
                <th style={{ width: "8%", padding: "10px 12px", textAlign: "left", borderBottom: "1px solid #dfe3e8" }}>Type</th>
                <th style={{ width: "12%", padding: "10px 12px", textAlign: "left", borderBottom: "1px solid #dfe3e8" }}>Provided by Contractor</th>
                <th style={{ width: "10%", padding: "10px 12px", textAlign: "left", borderBottom: "1px solid #dfe3e8" }}>Revit Status</th>
                <th style={{ width: "10%", padding: "10px 12px", textAlign: "left", borderBottom: "1px solid #dfe3e8" }}>Data Status</th>
                <th style={{ width: "10%", padding: "10px 12px", textAlign: "left", borderBottom: "1px solid #dfe3e8" }}>Shop Revision</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((row, index) => (
                  <tr key={`${normalizeText(row?.panelName || "panel")}-${normalizeText(row?.number || index)}-${index}`}>
                    <td style={{ width: "12%", padding: "10px 12px", borderBottom: "1px solid #edf2f7" }}>{normalizeText(row?.panelName || "-") || "-"}</td>
                    <td style={{ width: "8%", padding: "10px 12px", borderBottom: "1px solid #edf2f7" }}>
                      {normalizeText(row?.number) || (Array.isArray(row?.groupedNumbers) ? row.groupedNumbers.join(", ") : "-") || "-"}
                    </td>
                    <td style={{ width: "12%", padding: "10px 12px", borderBottom: "1px solid #edf2f7" }}>{normalizeText(row?.conduitId || "-") || "-"}</td>
                    <td style={{ width: "10%", padding: "10px 12px", borderBottom: "1px solid #edf2f7" }}>{normalizeText(row?.revitConduitId || "-") || "-"}</td>
                    <td style={{ width: "10%", padding: "10px 12px", borderBottom: "1px solid #edf2f7" }}>{normalizeText(row?.conduitSize || "-") || "-"}</td>
                    {!isBranch ? (
                      <>
                        <td style={{ width: "12%", padding: "10px 12px", borderBottom: "1px solid #edf2f7" }}>{normalizeText(row?.feederSupplyFrom || "-") || "-"}</td>
                        <td style={{ width: "12%", padding: "10px 12px", borderBottom: "1px solid #edf2f7" }}>{normalizeText(row?.feederTo || "-") || "-"}</td>
                      </>
                    ) : null}
                    {!isFeeder ? (
                      <>
                        <td style={{ width: "12%", padding: "10px 12px", borderBottom: "1px solid #edf2f7" }}>{normalizeText(row?.fromBranchCircuitPanel || "-") || "-"}</td>
                        <td style={{ width: "12%", padding: "10px 12px", borderBottom: "1px solid #edf2f7" }}>{normalizeText(row?.toPullBox || "-") || "-"}</td>
                      </>
                    ) : null}
                    <td style={{ width: "10%", padding: "10px 12px", borderBottom: "1px solid #edf2f7" }}>{normalizeText(row?.constructionPhase || row?.projectPhase || "-") || "-"}</td>
                    <td style={{ width: "8%", padding: "10px 12px", borderBottom: "1px solid #edf2f7" }}>
                      {(() => {
                        const connectionType = getConnectionTypeFromRow(row);
                        return connectionType === "NA" ? "NA" : connectionType.charAt(0).toUpperCase() + connectionType.slice(1);
                      })()}
                    </td>
                    <td style={{ width: "12%", padding: "10px 12px", borderBottom: "1px solid #edf2f7" }}>{normalizeOptionValue(row?.providedByContractor) || "-"}</td>
                    <td style={{ width: "10%", padding: "10px 12px", borderBottom: "1px solid #edf2f7" }}>{normalizeStatusValue(row?.revitStatus) || "-"}</td>
                    <td style={{ width: "10%", padding: "10px 12px", borderBottom: "1px solid #edf2f7" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <span>{normalizeStatusValue(row?.dataStatus) || "-"}</span>
                        {row?.reportedInDataQuality ? (
                          <span style={{ display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: "999px", background: "#fef3c7", color: "#92400e", fontSize: "11px", fontWeight: 700 }}>
                            Reported
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td style={{ width: "10%", padding: "10px 12px", borderBottom: "1px solid #edf2f7" }}>{normalizeText(row?.shopRevision || "-") || "-"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={isFeeder ? 12 : 12} style={{ padding: "14px 12px", textAlign: "center", color: "#64748b" }}>
                    No {title.toLowerCase()} rows match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  useEffect(() => {
    if (statusTablePanelOptions.length && statusTablePanelFilter !== "all" && !statusTablePanelOptions.includes(statusTablePanelFilter)) {
      setStatusTablePanelFilter("all");
    }
  }, [statusTablePanelFilter, statusTablePanelOptions]);

  useEffect(() => {
    setStatusTablePanelFilter("all");
  }, [selectedProjectId]);

  const allDataQualityReports = useMemo(() => {
    if (!selectedProjectId || !schedules.length) return [];

    return schedules
      .map((schedule) => {
        const missingRows = Array.isArray(schedule?.missingCircuitRows) ? schedule.missingCircuitRows : [];
        if (!missingRows.length) return null;

        return {
          scheduleId: schedule.id,
          scheduleName: schedule.name || "Untitled Panel",
          missingRows,
        };
      })
      .filter(Boolean)
      .sort((left, right) => right.missingRows.length - left.missingRows.length || left.scheduleName.localeCompare(right.scheduleName, undefined, { sensitivity: "base", numeric: true }));
  }, [schedules, selectedProjectId]);
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

  const handlePanelBuildLinkSave = async (panelKey, nextBuildLink) => {
    const buildLink = normalizeText(nextBuildLink);

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
              buildLink,
            };
          }),
        };
      });
      setPanelHeaderBuildLinkDrafts((previous) => ({
        ...previous,
        [panelKey]: buildLink,
      }));
      setEditingBuildLinkPanelKey(null);
      return;
    }

    if (!selectedSchedule?.id || !id || !canManage) return;

    const updatedPanelHeaders = (selectedSchedule.panelHeaders || []).map((panel, index) => {
      const key = panel?.panelKey || `${panel?.panelName || "panel"}-${index}`;
      if (key !== panelKey) return panel;
      return {
        ...panel,
        buildLink,
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

      setPanelHeaderBuildLinkDrafts((previous) => ({
        ...previous,
        [panelKey]: buildLink,
      }));
      setEditingBuildLinkPanelKey(null);
      toast.success("Build link saved.");
    } catch (error) {
      console.error("Failed to update panel build link:", error);
      toast.error("Failed to update panel build link.");
    }
  };

  const handleAssignMissingCircuit = useCallback(async (entry, assignedCircuitNumbers, scheduleIdOverride = selectedSchedule?.id || "active") => {
    if (!entry || !assignedCircuitNumbers) return;

    const normalizedAssignedValues = normalizeAssignedCircuitValues(assignedCircuitNumbers);
    if (!normalizedAssignedValues.length) return;

    const scheduleId = scheduleIdOverride || selectedSchedule?.id || "active";
    const rowKey = buildMissingRowAssignmentKey(scheduleId, entry, selectedSchedule?.name || "panel");
    setManualCircuitAssignments((previous) => ({
      ...previous,
      [rowKey]: normalizedAssignedValues,
    }));

    const nextCircuitEntries = normalizedAssignedValues.map((nextCircuitNumber) => ({
      number: nextCircuitNumber,
      side: nextCircuitNumber % 2 === 1 ? "left" : "right",
      conduitId: normalizeText(entry.conduitId) || "",
      conduitSize: normalizeText(entry.conduitSize) || "",
      feederTo: normalizeText(entry.feederTo) || "",
      sourcePanelLocation: normalizeText(entry.panelName) || "",
      toPullBox: normalizeText(entry.toPullBox) || "",
      feederSupplyFrom: normalizeText(entry.feederSupplyFrom) || "",
      fromBranchCircuitPanel: normalizeText(entry.fromBranchCircuitPanel) || "",
      description: "Assigned from Data Quality Report",
      panelName: normalizeText(entry.panelName) || selectedSchedule?.name || "Imported Panel",
      panelKey: normalizePanelKey(normalizeText(entry.panelName) || selectedSchedule?.name || "Imported Panel"),
    }));

    if (importPreview) {
      setImportPreview((previous) => {
        if (!previous) return previous;

        const nextMissingRows = (previous.missingCircuitRows || []).filter((row) => {
          const rowIdentity = buildMissingRowAssignmentKey(scheduleId, row, previous.name || "panel");
          return rowIdentity !== rowKey;
        });

        const nextCircuits = [
          ...(previous.circuits || []),
          ...nextCircuitEntries,
        ];

        return {
          ...previous,
          circuits: nextCircuits,
          circuitCount: nextCircuits.length,
          missingCircuitRows: nextMissingRows,
        };
      });
      return;
    }

    const scheduleToUpdate = schedules.find((schedule) => schedule.id === scheduleId) || selectedSchedule;
    if (!scheduleToUpdate?.id || !id || !canManage) return;

    const nextMissingRows = (scheduleToUpdate.missingCircuitRows || []).filter((row) => {
      const rowIdentity = buildMissingRowAssignmentKey(scheduleToUpdate.id, row, scheduleToUpdate.name || "panel");
      return rowIdentity !== rowKey;
    });

    const nextCircuits = [...(scheduleToUpdate.circuits || []), ...nextCircuitEntries];
    const nextSchedule = {
      ...scheduleToUpdate,
      circuits: nextCircuits,
      missingCircuitRows: nextMissingRows,
      circuitCount: nextCircuits.length,
      updatedBy: user?.uid || "",
      updatedAt: serverTimestamp(),
    };

    try {
      await updateDoc(doc(db, "churches", id, "panelSchedules", scheduleToUpdate.id), {
        circuits: nextCircuits,
        missingCircuitRows: nextMissingRows,
        circuitCount: nextCircuits.length,
        updatedBy: user?.uid || "",
        updatedAt: serverTimestamp(),
      });

      setSchedules((current) =>
        current.map((schedule) =>
          schedule.id === scheduleToUpdate.id
            ? {
                ...schedule,
                ...nextSchedule,
              }
            : schedule
        )
      );
    } catch (error) {
      console.error("Failed to assign circuit numbers to missing row:", error);
      toast.error("Failed to assign the selected circuit numbers.");
    }
  }, [buildMissingRowAssignmentKey, canManage, id, importPreview, normalizeAssignedCircuitValues, schedules, selectedSchedule, user?.uid]);

  const clearExcelDraft = () => {
    setExcelRows([]);
    setExcelColumns([]);
    setExcelSourceFileName("");
    setColumnMapping({ ...EMPTY_MAPPING });
  };

  const buildNextRfiNumber = useCallback((existingQuestions = []) => {
    const numericValues = (existingQuestions || [])
      .map((question) => normalizeText(question?.rfiNumber || ""))
      .map((value) => {
        const match = value.match(/(\d+)/g);
        if (!match) return null;
        const lastToken = match[match.length - 1];
        return Number(lastToken);
      })
      .filter((value) => Number.isFinite(value));

    const nextNumber = numericValues.length ? Math.max(...numericValues) + 1 : 1;
    return `RFI-${String(nextNumber).padStart(3, "0")}`;
  }, []);

  const handledGeneratedRfiNumber = useMemo(
    () => buildNextRfiNumber(rfiQuestions),
    [buildNextRfiNumber, rfiQuestions]
  );

  const handleRfiFormChange = (field, value) => {
    setRfiForm((previous) => ({
      ...previous,
      [field]: value,
    }));
  };

  const handleToggleConduitSelection = (conduitId) => {
    const safeValue = normalizeText(conduitId);
    if (!safeValue) return;

    setRfiForm((previous) => {
      const currentSelection = Array.isArray(previous.conduitIds) ? previous.conduitIds : [];
      const nextSelection = currentSelection.includes(safeValue)
        ? currentSelection.filter((entry) => normalizeText(entry) !== safeValue)
        : [...currentSelection, safeValue];

      return {
        ...previous,
        conduitIds: nextSelection,
      };
    });
  };

  const handleSelectFilteredConduits = () => {
    setRfiForm((previous) => {
      const currentSelection = Array.isArray(previous.conduitIds) ? previous.conduitIds : [];
      const currentByValue = new Set(currentSelection.map((entry) => normalizeText(entry)));
      const nextSelection = [...currentSelection];

      filteredConduitOptions.forEach((conduitId) => {
        if (!currentByValue.has(conduitId)) {
          nextSelection.push(conduitId);
        }
      });

      return { ...previous, conduitIds: nextSelection };
    });
  };

  const handleClearConduitSelection = () => {
    setRfiForm((previous) => ({ ...previous, conduitIds: [] }));
  };

  const handleSaveRfiQuestion = async (event) => {
    event.preventDefault();

    if (!id || !selectedProjectId || !user?.uid) {
      toast.error("Select a project before saving an RFI question.");
      return;
    }

    const rfiNumber = normalizeText(rfiForm.rfiNumber) || handledGeneratedRfiNumber;
    const title = normalizeText(rfiForm.title);
    const description = normalizeText(rfiForm.description);
    const conduitIds = Array.isArray(rfiForm.conduitIds)
      ? rfiForm.conduitIds.map((entry) => normalizeText(entry)).filter(Boolean)
      : [];

    if (!title || !description || !conduitIds.length) {
      toast.error("Enter a title, description, and at least one conduit ID to save the question.");
      return;
    }

    if (rfiAttachments.length && !storage) {
      toast.error("File storage is not available. Please try again later.");
      return;
    }

    const matchingConduitRows = activeConduitDetails;
    const conduitSummary = matchingConduitRows.length
      ? {
          panelNames: Array.from(new Set(matchingConduitRows.map((row) => normalizeText(row?.panelName)).filter(Boolean))).slice(0, 10),
          circuitNumbers: Array.from(new Set(matchingConduitRows.map((row) => normalizeCircuitNumber(row?.number)).filter((value) => value !== null))).sort((left, right) => left - right),
          conduitSize: normalizeText(matchingConduitRows.find((row) => normalizeText(row?.conduitSize))?.conduitSize) || "",
          feederSupplyFrom: normalizeText(matchingConduitRows.find((row) => normalizeText(row?.feederSupplyFrom))?.feederSupplyFrom) || "",
          feederTo: normalizeText(matchingConduitRows.find((row) => normalizeText(row?.feederTo))?.feederTo) || "",
          fromBranchCircuitPanel: normalizeText(matchingConduitRows.find((row) => normalizeText(row?.fromBranchCircuitPanel))?.fromBranchCircuitPanel) || "",
          toPullBox: normalizeText(matchingConduitRows.find((row) => normalizeText(row?.toPullBox))?.toPullBox) || "",
        }
      : {};

    const entryId = doc(collection(db, "churches", id, "panelScheduleQuestions")).id;

    try {
      setSavingRfi(true);
      const attachments = [];
      for (const file of rfiAttachments) {
        const safeFileName = normalizeText(file.name).replace(/[^a-zA-Z0-9._-]/g, "_") || "attachment";
        const attachmentPath = `churches/${id}/panelScheduleQuestions/${entryId}/${Date.now()}-${safeFileName}`;
        const attachmentRef = storageRef(storage, attachmentPath);
        const uploadTask = uploadBytesResumable(attachmentRef, file, {
          contentType: file.type || "application/octet-stream",
        });

        await new Promise((resolve, reject) => uploadTask.on("state_changed", null, reject, resolve));
        attachments.push({
          name: file.name || "Attachment",
          contentType: file.type || "application/octet-stream",
          size: Number(file.size || 0),
          storagePath: attachmentPath,
          url: await getDownloadURL(attachmentRef),
        });
      }

      const payload = {
        projectId: selectedProjectId,
        projectName: selectedProject?.name || "",
        scheduleId: selectedSchedule?.id || importPreview?.id || "",
        scheduleName: selectedSchedule?.name || importPreview?.name || "",
        sourceFileName: selectedSchedule?.sourceFileName || importPreview?.sourceFileName || "",
        rfiNumber,
        title,
        description,
        conduitIds,
        conduitId: conduitIds[0] || "",
        conduitDetails: selectedConduitAssociations,
        conduitSummary,
        attachments,
        createdBy: user.uid,
        updatedBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, "churches", id, "panelScheduleQuestions", entryId), payload);
      toast.success(`Saved RFI ${rfiNumber}.`);
      setRfiForm({ rfiNumber: "", title: "", description: "", conduitIds: [] });
      setRfiConduitSearch("");
      setRfiAttachments([]);
      await loadRfiQuestions();
    } catch (error) {
      console.error("Failed to save panel schedule RFI question:", error);
      toast.error("Failed to save RFI question.");
    } finally {
      setSavingRfi(false);
    }
  };

  const handleDeleteRfiQuestion = async (questionId) => {
    if (!id || !questionId) return;

    const confirmed = window.confirm("Delete this RFI question?");
    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, "churches", id, "panelScheduleQuestions", questionId));
      setRfiQuestions((current) => current.filter((entry) => entry.id !== questionId));
      toast.success("RFI question deleted.");
    } catch (error) {
      console.error("Failed to delete RFI question:", error);
      toast.error("Failed to delete RFI question.");
    }
  };

  const handleDownloadRfiPdf = async (question) => {
    try {
      const [jspdfModule, autoTableModule] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);
      const JsPdfConstructor = jspdfModule.jsPDF || jspdfModule.default?.jsPDF || jspdfModule.default;
      const autoTable = autoTableModule.default || autoTableModule;
      if (typeof JsPdfConstructor !== "function" || typeof autoTable !== "function") {
        throw new Error("PDF generation libraries did not load correctly.");
      }

    const pdf = new JsPdfConstructor({ orientation: "portrait", unit: "pt", format: "letter" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const margin = 48;
    const createdDate = formatDateTime(question.createdAt || question.updatedAt) || new Date().toLocaleString();
    const conduitDetails = Array.isArray(question.conduitDetails) ? question.conduitDetails : [];
    const savedConduitIds = Array.isArray(question.conduitIds)
      ? question.conduitIds
      : question.conduitId
        ? [question.conduitId]
        : [];

    pdf.setFillColor(13, 50, 67);
    pdf.rect(0, 0, pageWidth, 84, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(22);
    pdf.text("REQUEST FOR INFORMATION", margin, 38);
    pdf.setFontSize(10);
    pdf.setFont("helvetica", "normal");
    pdf.text("PANEL SCHEDULE COORDINATION", margin, 57);

    pdf.setTextColor(15, 23, 42);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(15);
    pdf.text(question.rfiNumber || "RFI", margin, 116);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.text(`Date: ${createdDate}`, pageWidth - margin, 116, { align: "right" });

    autoTable(pdf, {
      startY: 132,
      theme: "grid",
      styles: { font: "helvetica", fontSize: 9, cellPadding: 7, textColor: [15, 23, 42] },
      headStyles: { fillColor: [232, 248, 250], textColor: [13, 50, 67], fontStyle: "bold" },
      body: [
        ["Project", question.projectName || selectedProject?.name || "-"],
        ["Panel Schedule", question.scheduleName || "-"],
        ["Status", "Open"],
      ],
      columnStyles: { 0: { cellWidth: 116, fontStyle: "bold" } },
      margin: { left: margin, right: margin },
    });

    let cursorY = (pdf.lastAutoTable?.finalY || 200) + 28;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.text("REQUEST TITLE", margin, cursorY);
    cursorY += 16;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(11);
    const titleLines = pdf.splitTextToSize(question.title || "-", pageWidth - margin * 2);
    pdf.text(titleLines, margin, cursorY);
    cursorY += titleLines.length * 14 + 18;

    pdf.setFont("helvetica", "bold");
    pdf.text("QUESTION / DESCRIPTION", margin, cursorY);
    cursorY += 16;
    pdf.setFont("helvetica", "normal");
    const descriptionLines = pdf.splitTextToSize(question.description || "-", pageWidth - margin * 2);
    pdf.text(descriptionLines, margin, cursorY);
    cursorY += descriptionLines.length * 14 + 20;

    const conduitRows = conduitDetails.length
      ? conduitDetails.map((association) => [
          association.conduitId || "-",
          association.panelNames?.join(", ") || "-",
          association.circuitNumbers?.join(", ") || "-",
          association.conduitSize || "-",
          association.feederSupplyFrom || "-",
          association.feederTo || "-",
          association.toPullBox || "-",
        ])
      : savedConduitIds.map((conduitId) => [conduitId, "-", "-", "-", "-", "-", "-"]);

    if (conduitRows.length) {
      autoTable(pdf, {
        startY: cursorY,
        head: [["Conduit ID", "Panel", "Circuit", "Size", "Feeder From", "Feeder To", "Pull Box"]],
        body: conduitRows,
        theme: "grid",
        styles: { font: "helvetica", fontSize: 7.5, cellPadding: 5, overflow: "linebreak" },
        headStyles: { fillColor: [15, 118, 110], textColor: [255, 255, 255], fontStyle: "bold" },
        margin: { left: margin, right: margin },
      });
    }

    const pageCount = pdf.internal.getNumberOfPages();
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      pdf.setPage(pageNumber);
      pdf.setDrawColor(203, 213, 225);
      pdf.line(margin, 744, pageWidth - margin, 744);
      pdf.setFontSize(8);
      pdf.setTextColor(71, 85, 105);
      pdf.text(`RFI ${question.rfiNumber || ""} | Page ${pageNumber} of ${pageCount}`, margin, 758);
    }

    const safeNumber = normalizeText(question.rfiNumber || "rfi").replace(/[^a-z0-9]+/gi, "-");
    pdf.save(`${safeNumber}-request-for-information.pdf`);
    } catch (error) {
      console.error("Failed to generate RFI PDF:", error);
      toast.error("Failed to generate the RFI PDF.");
    }
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
          planSheetLink: "",
          singleLine: "",
          sheet: "",
          area: "",
          construction: "",
          constructionPhase: "",
          projectPhase: "",
          revitConduitId: "",
          shopRevision: "",
        });
      }

      return panelDetailsByName.get(panelIdentity)?.panelName || panelNameValue;
    };

    excelRows.forEach((row, rowIndex) => {
      const directPanelNameRaw =
        normalizeText(row?.[columnMapping.panelName]) ||
        normalizeText(row?.[columnMapping.circuitPanel]);
      const fromPanelOwnerRaw =
        normalizeText(row?.[columnMapping.feederSupplyFrom]) ||
        normalizeText(row?.[columnMapping.sourcePanelLocation]);
      const branchPanelOwnerRaw = normalizeText(row?.[columnMapping.fromBranchCircuitPanel]);
      const toPanelOwnerRaw = normalizeText(row?.[columnMapping.feederTo]);

      // Create a panel entry from the direct panel name, then branch panel source, then feeder ownership fields.
      const rowPanelOwnerName = ensurePanel(directPanelNameRaw) || ensurePanel(branchPanelOwnerRaw) || ensurePanel(fromPanelOwnerRaw) || ensurePanel(toPanelOwnerRaw);

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
      const constructionPhaseValue = normalizeText(row?.[columnMapping.constructionPhase]) || normalizeText(row?.[columnMapping.projectPhase]);
      const revitConduitIdValue = normalizeText(row?.[columnMapping.revitConduitId]);
      const shopRevisionValue = normalizeText(row?.[columnMapping.shopRevision]);

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
          constructionPhase: constructionPhaseValue,
          projectPhase: constructionPhaseValue,
          revitConduitId: revitConduitIdValue,
          shopRevision: shopRevisionValue,
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
    <>
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

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "18px" }}>
            <button
              type="button"
              onClick={() => setPageTab("schedules")}
              style={{
                padding: "8px 16px",
                borderRadius: "999px",
                border: "1px solid #d0d7de",
                background: pageTab === "schedules" ? "#0f172a" : "#fff",
                color: pageTab === "schedules" ? "#fff" : "#0f172a",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Schedules
            </button>
            <button
              type="button"
              onClick={() => setPageTab("data-quality")}
              style={{
                padding: "8px 16px",
                borderRadius: "999px",
                border: "1px solid #d0d7de",
                background: pageTab === "data-quality" ? "#0f172a" : "#fff",
                color: pageTab === "data-quality" ? "#fff" : "#0f172a",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Data Quality
            </button>
            <button
              type="button"
              onClick={() => setPageTab("status-table")}
              style={{
                padding: "8px 16px",
                borderRadius: "999px",
                border: "1px solid #d0d7de",
                background: pageTab === "status-table" ? "#0f172a" : "#fff",
                color: pageTab === "status-table" ? "#fff" : "#0f172a",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Status Table
            </button>
            <button
              type="button"
              onClick={() => setPageTab("rfi-questions")}
              style={{
                padding: "8px 16px",
                borderRadius: "999px",
                border: "1px solid #d0d7de",
                background: pageTab === "rfi-questions" ? "#0f172a" : "#fff",
                color: pageTab === "rfi-questions" ? "#fff" : "#0f172a",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              RFI Questions
            </button>
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

          {pageTab === "rfi-questions" ? (
            <div style={{ display: "grid", gap: "16px", width: "100%" }}>
              {!selectedProjectId ? (
                <div className="panel-schedules-state">Choose a project to create and track RFIs.</div>
              ) : (
                <>
                  <section className="panel-schedules-section" style={{ width: "100%" }}>
                    <div className="panel-schedules-report-heading" style={{ marginBottom: "12px" }}>
                      <h2>Create RFI Question</h2>
                    </div>

                    <form onSubmit={handleSaveRfiQuestion} style={{ display: "grid", gap: "12px" }}>
                      <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                        <label style={{ display: "grid", gap: "6px", fontWeight: 600 }}>
                          <span>RFI #</span>
                          <div
                            style={{
                              padding: "10px 12px",
                              borderRadius: "8px",
                              border: "1px solid #d0d7de",
                              background: "#f8fafc",
                              minHeight: "42px",
                              display: "flex",
                              alignItems: "center",
                            }}
                          >
                            {normalizeText(rfiForm.rfiNumber) || handledGeneratedRfiNumber}
                          </div>
                        </label>

                        <label style={{ display: "grid", gap: "6px", fontWeight: 600, gridColumn: "1 / -1" }}>
                          <span>Title</span>
                          <input
                            type="text"
                            value={rfiForm.title}
                            onChange={(event) => handleRfiFormChange("title", event.target.value)}
                            placeholder="Conduit routing question"
                            disabled={!canManage}
                            style={{ padding: "10px 12px", borderRadius: "8px", border: "1px solid #d0d7de" }}
                          />
                        </label>

                        <fieldset className="panel-schedules-conduit-picker" disabled={!canManage || !conduitOptions.length}>
                          <legend>Associated conduit IDs</legend>
                          <div className="panel-schedules-conduit-picker-heading">
                            <span className="panel-schedules-conduit-picker-status">
                              {rfiForm.conduitIds.length ? `${rfiForm.conduitIds.length} selected` : "No conduits selected"}
                            </span>
                            <div className="panel-schedules-conduit-picker-actions">
                              <button type="button" onClick={handleSelectFilteredConduits} disabled={!filteredConduitOptions.length}>
                                Select results
                              </button>
                              <button type="button" onClick={handleClearConduitSelection} disabled={!rfiForm.conduitIds.length}>
                                Clear selection
                              </button>
                            </div>
                          </div>
                          <input
                            className="panel-schedules-conduit-search"
                            type="search"
                            value={rfiConduitSearch}
                            onChange={(event) => setRfiConduitSearch(event.target.value)}
                            placeholder="Search imported conduit IDs"
                            aria-label="Search conduit IDs"
                          />
                          {rfiForm.conduitIds.length ? (
                            <div className="panel-schedules-conduit-chips" aria-label="Selected conduit IDs">
                              {rfiForm.conduitIds.map((conduitId) => (
                                <span key={conduitId} className="panel-schedules-conduit-chip">
                                  {conduitId}
                                  <button
                                    type="button"
                                    onClick={() => handleToggleConduitSelection(conduitId)}
                                    aria-label={`Remove ${conduitId}`}
                                    title={`Remove ${conduitId}`}
                                  >
                                    x
                                  </button>
                                </span>
                              ))}
                            </div>
                          ) : null}
                          <div className="panel-schedules-conduit-options" role="group" aria-label="Available conduit IDs">
                            {filteredConduitOptions.length ? (
                              filteredConduitOptions.map((conduitId) => {
                                const isSelected = rfiForm.conduitIds.some((selectedId) => normalizeText(selectedId) === conduitId);
                                return (
                                  <label key={conduitId} className={`panel-schedules-conduit-option${isSelected ? " is-selected" : ""}`}>
                                    <input type="checkbox" checked={isSelected} onChange={() => handleToggleConduitSelection(conduitId)} />
                                    <span>{conduitId}</span>
                                  </label>
                                );
                              })
                            ) : (
                              <span className="panel-schedules-conduit-empty">No imported conduit IDs match your search.</span>
                            )}
                          </div>
                        </fieldset>
                      </div>

                      <label style={{ display: "grid", gap: "6px", fontWeight: 600 }}>
                        <span>Description</span>
                        <textarea
                          value={rfiForm.description}
                          onChange={(event) => handleRfiFormChange("description", event.target.value)}
                          placeholder="Clarify routing, sizing, or confirmation needed for this conduit."
                          disabled={!canManage}
                          rows={5}
                          style={{ padding: "10px 12px", borderRadius: "8px", border: "1px solid #d0d7de", resize: "vertical" }}
                        />
                      </label>

                      <label style={{ display: "grid", gap: "6px", fontWeight: 600 }}>
                        <span>Attachments</span>
                        <input
                          type="file"
                          multiple
                          onChange={(event) => setRfiAttachments(Array.from(event.target.files || []))}
                          disabled={!canManage || savingRfi}
                          style={{ padding: "8px", border: "1px solid #d0d7de", borderRadius: "8px", background: "#fff" }}
                        />
                        <span style={{ color: "#64748b", fontSize: "13px", fontWeight: 400 }}>
                          {rfiAttachments.length ? `${rfiAttachments.length} file(s) ready to attach` : "Attach documents or images to this RFI."}
                        </span>
                      </label>

                      {selectedConduitAssociations.length ? (
                        <div style={{ border: "1px solid #dfe3e8", borderRadius: "12px", background: "#f8fafc", padding: "12px" }}>
                          <strong>Associated conduit details</strong>
                          <div style={{ display: "grid", gap: "10px", marginTop: "8px" }}>
                            {selectedConduitAssociations.map((association) => (
                              <div key={association.conduitId} style={{ display: "grid", gap: "4px", padding: "10px", border: "1px solid #dfe3e8", borderRadius: "8px", background: "#fff" }}>
                                <strong>Conduit ID: {association.conduitId}</strong>
                                <span>Panel(s): {association.panelNames.join(", ") || "-"}</span>
                                <span>Circuit(s): {association.circuitNumbers.join(", ") || "-"}</span>
                                <span>Conduit Size: {association.conduitSize}</span>
                                <span>Feeder Supply From: {association.feederSupplyFrom}</span>
                                <span>Feeder To: {association.feederTo}</span>
                                <span>To Pull Box: {association.toPullBox}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <div style={{ display: "flex", justifyContent: "flex-start" }}>
                        <button
                          type="submit"
                          disabled={!canManage || savingRfi}
                          style={{
                            padding: "10px 16px",
                            borderRadius: "10px",
                            border: "1px solid #0f172a",
                            background: "#0f172a",
                            color: "#fff",
                            cursor: canManage && !savingRfi ? "pointer" : "not-allowed",
                            opacity: canManage ? 1 : 0.5,
                          }}
                        >
                          {savingRfi ? "Saving..." : "Save RFI Question"}
                        </button>
                      </div>
                    </form>
                  </section>

                  <section className="panel-schedules-section" style={{ width: "100%" }}>
                    <div className="panel-schedules-report-heading" style={{ marginBottom: "12px" }}>
                      <h2>RFI Log ({rfiQuestions.length})</h2>
                    </div>

                    {rfiQuestions.length ? (
                      <div style={{ display: "grid", gap: "12px" }}>
                        {rfiQuestions.map((question) => {
                          const isExpanded = expandedRfiQuestionId === question.id;
                          const savedConduitIds = Array.isArray(question.conduitIds)
                            ? question.conduitIds
                            : question.conduitId
                              ? [question.conduitId]
                              : [];

                          return (
                          <article key={question.id} style={{ border: "1px solid #dfe3e8", borderRadius: "12px", padding: "12px", background: "#fff" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "flex-start", flexWrap: "wrap" }}>
                              <button
                                type="button"
                                onClick={() => setExpandedRfiQuestionId((current) => current === question.id ? "" : question.id)}
                                aria-expanded={isExpanded}
                                style={{ display: "grid", flex: "1 1 280px", gap: "4px", minWidth: 0, padding: 0, border: "none", color: "#0f172a", background: "transparent", textAlign: "left", cursor: "pointer" }}
                              >
                                <strong>{question.rfiNumber || "RFI"}</strong>
                                <span style={{ fontWeight: 600 }}>{question.title}</span>
                                <span style={{ color: "#0f766e", fontSize: "13px", fontWeight: 700 }}>{isExpanded ? "Hide associated conduits" : "Show associated conduits"}</span>
                              </button>
                              {canManage ? (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteRfiQuestion(question.id)}
                                  style={{ padding: "6px 10px", borderRadius: "8px", border: "1px solid #dc2626", background: "#fff", color: "#dc2626", cursor: "pointer" }}
                                >
                                  Delete
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => handleDownloadRfiPdf(question)}
                                style={{ padding: "6px 10px", borderRadius: "8px", border: "1px solid #0f766e", background: "#fff", color: "#0f766e", cursor: "pointer" }}
                              >
                                Download PDF
                              </button>
                            </div>

                            <p style={{ margin: "8px 0", color: "#334155" }}>{question.description}</p>
                            {isExpanded ? (
                              <div style={{ display: "grid", gap: "8px", paddingTop: "10px", borderTop: "1px solid #e2e8f0" }}>
                                {Array.isArray(question.attachments) && question.attachments.length ? (
                                  <div style={{ display: "grid", gap: "8px" }}>
                                    <strong style={{ color: "#0f172a" }}>Attachments</strong>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                                      {question.attachments.map((attachment, index) => {
                                        const isImage = normalizeText(attachment.contentType).startsWith("image/");
                                        return (
                                          <a
                                            key={`${attachment.storagePath || attachment.url}-${index}`}
                                            href={attachment.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            style={{ display: "grid", gap: "6px", maxWidth: "220px", padding: "8px", border: "1px solid #dfe3e8", borderRadius: "8px", color: "#0f766e", background: "#fff", textDecoration: "none", fontSize: "13px" }}
                                          >
                                            {isImage ? <img src={attachment.url} alt={attachment.name || "RFI attachment"} style={{ display: "block", width: "100%", maxHeight: "150px", objectFit: "contain", background: "#f8fafc" }} /> : null}
                                            <span style={{ overflowWrap: "anywhere", fontWeight: 700 }}>{attachment.name || "View attachment"}</span>
                                          </a>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ) : null}
                                {Array.isArray(question.conduitDetails) && question.conduitDetails.length ? (
                                  question.conduitDetails.map((association) => (
                                    <div key={association.conduitId} style={{ display: "grid", gap: "3px", padding: "8px", borderLeft: "3px solid #0f766e", background: "#f8fafc", fontSize: "14px", color: "#475569" }}>
                                      <strong style={{ color: "#0f172a" }}>Conduit ID: {association.conduitId}</strong>
                                      <span>Panel(s): {association.panelNames?.join(", ") || "-"}</span>
                                      <span>Circuit(s): {association.circuitNumbers?.join(", ") || "-"}</span>
                                      <span>Conduit Size: {association.conduitSize || "-"}</span>
                                      <span>Feeder Supply From: {association.feederSupplyFrom || "-"}</span>
                                      <span>Feeder To: {association.feederTo || "-"}</span>
                                      <span>To Pull Box: {association.toPullBox || "-"}</span>
                                    </div>
                                  ))
                                ) : (
                                  <div style={{ padding: "8px", color: "#475569", background: "#f8fafc", fontSize: "14px" }}>
                                    <strong style={{ color: "#0f172a" }}>Associated conduit ID(s): </strong>
                                    {savedConduitIds.join(", ") || "No conduit details saved for this RFI."}
                                  </div>
                                )}
                              </div>
                            ) : null}
                          </article>
                          );
                        })}
                      </div>
                    ) : (
                      <p>No RFIs have been created for this project yet.</p>
                    )}
                  </section>
                </>
              )}
            </div>
          ) : null}

          {pageTab === "status-table" ? (
            <div style={{ display: "grid", gap: "16px", width: "100%" }}>
              {selectedProjectId && (importPreview || selectedSchedule) ? (
                <section className="panel-schedules-section" style={{ width: "100%" }}>
                  <div className="panel-schedules-report-heading" style={{ marginBottom: "12px" }}>
                    <h2>Contractor / Revit / Data Status</h2>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px", flexWrap: "wrap" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 600 }}>
                      <span>Search</span>
                      <input
                        type="text"
                        value={statusTableSearchQuery}
                        onChange={(event) => setStatusTableSearchQuery(event.target.value)}
                        placeholder="Search rows..."
                        style={{ minWidth: "220px", padding: "6px 10px", borderRadius: "8px", border: "1px solid #d0d7de" }}
                      />
                    </label>

                    <label style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 600 }}>
                      <span>Panel</span>
                      <select
                        value={statusTablePanelFilter}
                        onChange={(event) => setStatusTablePanelFilter(event.target.value)}
                        style={{ minWidth: "180px", padding: "6px 10px", borderRadius: "8px", border: "1px solid #d0d7de" }}
                      >
                        <option value="all">All Panels</option>
                        {statusTablePanelOptions.map((panelName) => (
                          <option key={panelName} value={panelName}>
                            {panelName}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 600 }}>
                      <span>Contractor</span>
                      <select
                        value={statusTableContractorFilter}
                        onChange={(event) => setStatusTableContractorFilter(event.target.value)}
                        style={{ minWidth: "150px", padding: "6px 10px", borderRadius: "8px", border: "1px solid #d0d7de" }}
                      >
                        <option value="all">All</option>
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                        {statusTableContractorOptions
                          .filter((option) => option !== "Yes" && option !== "No")
                          .map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                      </select>
                    </label>

                    <label style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 600 }}>
                      <span>Revit Status</span>
                      <select
                        value={statusTableRevitFilter}
                        onChange={(event) => setStatusTableRevitFilter(event.target.value)}
                        style={{ minWidth: "170px", padding: "6px 10px", borderRadius: "8px", border: "1px solid #d0d7de" }}
                      >
                        <option value="all">All</option>
                        {statusTableRevitOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 600 }}>
                      <span>Data Status</span>
                      <select
                        value={statusTableDataFilter}
                        onChange={(event) => setStatusTableDataFilter(event.target.value)}
                        style={{ minWidth: "170px", padding: "6px 10px", borderRadius: "8px", border: "1px solid #d0d7de" }}
                      >
                        <option value="all">All</option>
                        {statusTableDataOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 600 }}>
                      <span>Phase</span>
                      <select
                        value={statusTablePhaseFilter}
                        onChange={(event) => setStatusTablePhaseFilter(event.target.value)}
                        style={{ minWidth: "170px", padding: "6px 10px", borderRadius: "8px", border: "1px solid #d0d7de" }}
                      >
                        <option value="all">All</option>
                        {statusTablePhaseOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div style={{ display: "grid", gap: "18px", width: "100%" }}>
                    {renderStatusTableSection("Feeder", statusTableSections.feeder, "feeder")}
                    {renderStatusTableSection("Branch", statusTableSections.branch, "branch")}
                  </div>
                </section>
              ) : (
                <div className="panel-schedules-state">Choose a project to review status data.</div>
              )}
            </div>
          ) : null}

          {pageTab === "data-quality" ? (
            <div style={{ display: "grid", gap: "16px" }}>
              {selectedProjectId && (importPreview || selectedSchedule) ? (
                <>
                  <div className="panel-schedules-report-heading" style={{ marginBottom: "12px", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                    <span>Data Quality Report</span>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="panel-schedules-report-tab"
                        onClick={() => setQualityReportTab("current")}
                        style={{
                          padding: "6px 12px",
                          borderRadius: "999px",
                          border: "1px solid #d0d7de",
                          background: qualityReportTab === "current" ? "#0f172a" : "#fff",
                          color: qualityReportTab === "current" ? "#fff" : "#0f172a",
                          cursor: "pointer",
                        }}
                      >
                        Current Panel
                      </button>
                      <button
                        type="button"
                        className="panel-schedules-report-tab"
                        onClick={() => setQualityReportTab("all")}
                        style={{
                          padding: "6px 12px",
                          borderRadius: "999px",
                          border: "1px solid #d0d7de",
                          background: qualityReportTab === "all" ? "#0f172a" : "#fff",
                          color: qualityReportTab === "all" ? "#fff" : "#0f172a",
                          cursor: "pointer",
                        }}
                      >
                        All Panels
                      </button>
                    </div>
                  </div>

                  {qualityReportTab === "current" ? (
                    <section className="panel-schedules-section panel-schedules-missing-report">
                      <div className="panel-schedules-report-heading">
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
                              const scheduleIdForAssignment = selectedSchedule?.id || "active";
                              const availableCircuitNumbers = getAvailableCircuitNumbersForPanel(
                                entry.panelName || selectedSchedule?.name || "",
                                scheduleIdForAssignment
                              );
                              const rowAssignmentKey = buildMissingRowAssignmentKey(
                                scheduleIdForAssignment,
                                entry,
                                selectedSchedule?.name || "panel"
                              );
                              const savedAssignmentValue = normalizeAssignedCircuitValues(
                                manualCircuitAssignments[rowAssignmentKey]
                              );
                              const draftAssignmentValue = draftMissingCircuitSelections[rowAssignmentKey] ?? savedAssignmentValue;
                              const hasUnsavedSelection = JSON.stringify(draftAssignmentValue) !== JSON.stringify(savedAssignmentValue);

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
                                      <label style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" }}>
                                        <span>Assign available circuit #</span>
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                          {availableCircuitNumbers.length ? (
                                            availableCircuitNumbers.map((circuitNumber) => {
                                              const checked = draftAssignmentValue.includes(circuitNumber);
                                              return (
                                                <label
                                                  key={`${itemKey}-circuit-${circuitNumber}`}
                                                  style={{
                                                    display: "inline-flex",
                                                    alignItems: "center",
                                                    gap: "6px",
                                                    padding: "6px 8px",
                                                    border: "1px solid #d0d7de",
                                                    borderRadius: "8px",
                                                    background: checked ? "#e8f1ff" : "#fff",
                                                    cursor: canManage ? "pointer" : "not-allowed",
                                                  }}
                                                >
                                                  <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    disabled={!canManage}
                                                    onChange={(event) => {
                                                      const nextValues = event.target.checked
                                                        ? Array.from(new Set([...draftAssignmentValue, circuitNumber])).sort((a, b) => a - b)
                                                        : draftAssignmentValue.filter((value) => value !== circuitNumber);
                                                      setDraftMissingCircuitSelections((previous) => ({
                                                        ...previous,
                                                        [rowAssignmentKey]: nextValues,
                                                      }));
                                                    }}
                                                  />
                                                  <span>#{circuitNumber}</span>
                                                </label>
                                              );
                                            })
                                          ) : (
                                            <span style={{ color: "#64748b" }}>No free circuits available</span>
                                          )}
                                        </div>
                                        {hasUnsavedSelection ? (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              handleAssignMissingCircuit(entry, draftAssignmentValue, scheduleIdForAssignment);
                                              setDraftMissingCircuitSelections((previous) => ({
                                                ...previous,
                                                [rowAssignmentKey]: draftAssignmentValue,
                                              }));
                                            }}
                                            style={{
                                              marginTop: "8px",
                                              alignSelf: "flex-start",
                                              padding: "6px 10px",
                                              borderRadius: "8px",
                                              border: "1px solid #0f172a",
                                              background: "#0f172a",
                                              color: "#fff",
                                              cursor: "pointer",
                                            }}
                                          >
                                            Save selected circuits
                                          </button>
                                        ) : null}
                                      </label>
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

                  {qualityReportTab === "all" ? (
                    <section className="panel-schedules-section panel-schedules-missing-report">
                      <div className="panel-schedules-report-heading">
                        <h2>All Panels: Data Quality Reports</h2>
                      </div>
                      {allDataQualityReports.length ? (
                        <div className="panel-schedules-missing-list">
                          {allDataQualityReports.map((report) => (
                            <article key={report.scheduleId} className="panel-schedules-missing-item is-expanded" style={{ marginBottom: "12px" }}>
                              <div className="panel-schedules-missing-toggle" style={{ cursor: "default" }}>
                                <strong>{report.scheduleName}</strong>
                                <div className="panel-schedules-missing-inline">
                                  <span>{report.missingRows.length} missing Circuit # row(s)</span>
                                </div>
                              </div>
                              <div className="panel-schedules-missing-meta">
                                {report.missingRows.map((entry, index) => {
                                  const rowAssignmentKey = buildMissingRowAssignmentKey(report.scheduleId, entry, report.scheduleName);
                                  const availableCircuitNumbers = getAvailableCircuitNumbersForPanel(
                                    entry.panelName || report.scheduleName,
                                    report.scheduleId
                                  );
                                  const savedAssignmentValue = normalizeAssignedCircuitValues(manualCircuitAssignments[rowAssignmentKey]);
                                  const draftAssignmentValue = draftMissingCircuitSelections[rowAssignmentKey] ?? savedAssignmentValue;
                                  const hasUnsavedSelection = JSON.stringify(draftAssignmentValue) !== JSON.stringify(savedAssignmentValue);

                                  return (
                                    <div key={`${report.scheduleId}-row-${entry.rowNumber || index}`} style={{ display: "grid", gap: "8px", padding: "8px 0", borderTop: index > 0 ? "1px solid #e2e8f0" : "none" }}>
                                      <span>Row {entry.rowNumber || index + 1}</span>
                                      <span>Panel: {entry.panelName || "-"}</span>
                                      <span>Conduit ID: {entry.conduitId || "-"}</span>
                                      <span>Conduit Size: {entry.conduitSize || "-"}</span>
                                      <span>Feeder Supply From: {entry.feederSupplyFrom || "-"}</span>
                                      <span>Feeder to: {entry.feederTo || "-"}</span>
                                      <span>From Branch Circuit Panel: {entry.fromBranchCircuitPanel || "-"}</span>
                                      <span>To Pull Box: {entry.toPullBox || "-"}</span>
                                      <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                        <span>Assign available circuit #</span>
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                          {availableCircuitNumbers.length ? (
                                            availableCircuitNumbers.map((circuitNumber) => {
                                              const checked = draftAssignmentValue.includes(circuitNumber);
                                              return (
                                                <label
                                                  key={`${rowAssignmentKey}-circuit-${circuitNumber}`}
                                                  style={{
                                                    display: "inline-flex",
                                                    alignItems: "center",
                                                    gap: "6px",
                                                    padding: "6px 8px",
                                                    border: "1px solid #d0d7de",
                                                    borderRadius: "8px",
                                                    background: checked ? "#e8f1ff" : "#fff",
                                                    cursor: canManage ? "pointer" : "not-allowed",
                                                  }}
                                                >
                                                  <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    disabled={!canManage}
                                                    onChange={(event) => {
                                                      const nextValues = event.target.checked
                                                        ? Array.from(new Set([...draftAssignmentValue, circuitNumber])).sort((a, b) => a - b)
                                                        : draftAssignmentValue.filter((value) => value !== circuitNumber);
                                                      setDraftMissingCircuitSelections((previous) => ({
                                                        ...previous,
                                                        [rowAssignmentKey]: nextValues,
                                                      }));
                                                    }}
                                                  />
                                                  <span>#{circuitNumber}</span>
                                                </label>
                                              );
                                            })
                                          ) : (
                                            <span style={{ color: "#64748b" }}>No free circuits available</span>
                                          )}
                                        </div>
                                        {hasUnsavedSelection ? (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              handleAssignMissingCircuit(entry, draftAssignmentValue, report.scheduleId);
                                              setDraftMissingCircuitSelections((previous) => ({
                                                ...previous,
                                                [rowAssignmentKey]: draftAssignmentValue,
                                              }));
                                            }}
                                            style={{
                                              marginTop: "8px",
                                              alignSelf: "flex-start",
                                              padding: "6px 10px",
                                              borderRadius: "8px",
                                              border: "1px solid #0f172a",
                                              background: "#0f172a",
                                              color: "#fff",
                                              cursor: "pointer",
                                            }}
                                          >
                                            Save selected circuits
                                          </button>
                                        ) : null}
                                      </label>
                                    </div>
                                  );
                                })}
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <p>No data quality issues found across the panel schedules for this project.</p>
                      )}
                    </section>
                  ) : null}
                </>
              ) : (
                <div className="panel-schedules-state">Choose a project to review data quality issues.</div>
              )}
            </div>
          ) : null}

          {pageTab === "schedules" ? (
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
                                <div className="panel-schedules-split-header-tools">
                                  {editingBuildLinkPanelKey === sectionPanelKey ? (
                                    <>
                                      <label>
                                        <span>Build Link</span>
                                        <input
                                          type="url"
                                          value={panelHeaderBuildLinkDrafts[sectionPanelKey] ?? sectionPanel?.buildLink ?? ""}
                                          onChange={(event) =>
                                            setPanelHeaderBuildLinkDrafts((previous) => ({
                                              ...previous,
                                              [sectionPanelKey]: event.target.value,
                                            }))
                                          }
                                          placeholder="https://..."
                                          disabled={!canManage}
                                        />
                                      </label>
                                      <button
                                        type="button"
                                        onClick={() => handlePanelBuildLinkSave(sectionPanelKey, panelHeaderBuildLinkDrafts[sectionPanelKey] ?? sectionPanel?.buildLink ?? "")}
                                        disabled={!canManage}
                                      >
                                        Save
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      className="panel-schedules-build-link-button"
                                      onDoubleClick={() => {
                                        if (!canManage) return;
                                        setPanelHeaderBuildLinkDrafts((previous) => ({
                                          ...previous,
                                          [sectionPanelKey]: sectionPanel?.buildLink ?? "",
                                        }));
                                        setEditingBuildLinkPanelKey(sectionPanelKey);
                                      }}
                                      disabled={!canManage}
                                    >
                                      {sectionPanel?.buildLink ? "Build Link" : "Add Build Link"}
                                    </button>
                                  )}
                                  {sectionPanel?.buildLink ? (
                                    <a
                                      href={sectionPanel.buildLink}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="panel-schedules-build-link-open"
                                    >
                                      Open
                                    </a>
                                  ) : null}
                                </div>
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
                                        planSheetNote={sectionPanel?.planSheetNote}
                                        planSheetLink={sectionPanel?.planSheetLink}
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
                                        planSheetNote={sectionPanel?.planSheetNote}
                                        planSheetLink={sectionPanel?.planSheetLink}
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

                {selectedProjectId && activeMissingCircuitRows.length ? (
                  <section className="panel-schedules-section panel-schedules-missing-report">
                    <div className="panel-schedules-report-heading">
                      <h2>Missing Circuit # Assignments</h2>
                    </div>
                    <p>
                      {activeMissingCircuitRows.length} row(s) still need a circuit number. Pick an available circuit for each row below so the data is no longer missing.
                    </p>
                    <div className="panel-schedules-missing-list">
                      {activeMissingCircuitRows.map((entry, index) => {
                        const itemKey = `schedule-missing-circuit-${entry.rowNumber}-${index}`;
                        const availableCircuitNumbers = getAvailableCircuitNumbersForPanel(entry.panelName || selectedSchedule?.name || "");
                        const rowAssignmentKey = buildMissingRowAssignmentKey(
                          selectedSchedule?.id || "active",
                          entry,
                          selectedSchedule?.name || "panel"
                        );
                        const savedAssignmentValue = normalizeAssignedCircuitValues(
                          manualCircuitAssignments[rowAssignmentKey]
                        );
                        const draftAssignmentValue = draftMissingCircuitSelections[rowAssignmentKey] ?? savedAssignmentValue;
                        const hasUnsavedSelection = JSON.stringify(draftAssignmentValue) !== JSON.stringify(savedAssignmentValue);

                        return (
                          <article key={itemKey} className="panel-schedules-missing-item is-expanded" style={{ marginBottom: "12px" }}>
                            <div className="panel-schedules-missing-toggle" style={{ cursor: "default" }}>
                              <strong>Row {entry.rowNumber || index + 1}</strong>
                              <div className="panel-schedules-missing-inline">
                                <span>Panel: {entry.panelName || "-"}</span>
                                <span>Conduit ID: {entry.conduitId || "-"}</span>
                                <span>Feeder Supply From: {entry.feederSupplyFrom || "-"}</span>
                              </div>
                            </div>
                            <div className="panel-schedules-missing-meta">
                              <label style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" }}>
                                <span>Assign available circuit #</span>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                  {availableCircuitNumbers.length ? (
                                    availableCircuitNumbers.map((circuitNumber) => {
                                      const checked = draftAssignmentValue.includes(circuitNumber);
                                      return (
                                        <label
                                          key={`${itemKey}-circuit-${circuitNumber}`}
                                          style={{
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: "6px",
                                            padding: "6px 8px",
                                            border: "1px solid #d0d7de",
                                            borderRadius: "8px",
                                            background: checked ? "#e8f1ff" : "#fff",
                                            cursor: canManage ? "pointer" : "not-allowed",
                                          }}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            disabled={!canManage}
                                            onChange={(event) => {
                                              const nextValues = event.target.checked
                                                ? Array.from(new Set([...draftAssignmentValue, circuitNumber])).sort((a, b) => a - b)
                                                : draftAssignmentValue.filter((value) => value !== circuitNumber);
                                              setDraftMissingCircuitSelections((previous) => ({
                                                ...previous,
                                                [rowAssignmentKey]: nextValues,
                                              }));
                                            }}
                                          />
                                          <span>#{circuitNumber}</span>
                                        </label>
                                      );
                                    })
                                  ) : (
                                    <span style={{ color: "#64748b" }}>No free circuits available</span>
                                  )}
                                </div>
                                {hasUnsavedSelection ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      handleAssignMissingCircuit(entry, draftAssignmentValue, selectedSchedule?.id || "active");
                                      setDraftMissingCircuitSelections((previous) => ({
                                        ...previous,
                                        [rowAssignmentKey]: draftAssignmentValue,
                                      }));
                                    }}
                                    style={{
                                      marginTop: "8px",
                                      alignSelf: "flex-start",
                                      padding: "6px 10px",
                                      borderRadius: "8px",
                                      border: "1px solid #0f172a",
                                      background: "#0f172a",
                                      color: "#fff",
                                      cursor: "pointer",
                                    }}
                                  >
                                    Save selected circuits
                                  </button>
                                ) : null}
                              </label>
                            </div>
                          </article>
                        );
                      })}
                    </div>
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
              </main>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
};

export default PanelSchedules;
