import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as XLSX from "xlsx";
import ChurchHeader from "./ChurchHeader";
import commonStyles from "../pages/commonStyles";
import { useAuth } from "../contexts/AuthContext";
import { db } from "../firebase";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";

const DEFAULT_STATUS_OPTIONS = [
  "Not Started",
  "In Progress",
  "Blocked",
  "Ready for Review",
  "Completed",
];

const IMPORT_LOG_LIMIT = 25;
const ROW_NOTE_LIMIT = 100;
const MANUAL_ROW_BACKGROUND = "#fff7ed";
const EXCLUDED_COLUMNS_STORAGE_PREFIX = "conduitRunCounterExcludedColumns";
const CONDITION_DEFAULTS_STORAGE_PREFIX = "conduitRunCounterConditionDefaults";
const EXCEL_TAB_DEFAULTS_STORAGE_PREFIX = "conduitRunCounterExcelTabDefaults";
const LAST_PROJECT_STORAGE_PREFIX = "conduitRunCounterLastProject";
const VISIBLE_COLUMNS_STORAGE_PREFIX = "conduitRunCounterVisibleColumns";

const PREVIEW_CONDITION_OPERATORS = [
  { value: "has_value", label: "Has a Value" },
  { value: "not_complete", label: "Not Complete" },
  { value: "equals", label: "Equals" },
  { value: "contains", label: "Contains" },
  { value: "not_equals", label: "Does Not Equal" },
  { value: "starts_with", label: "Starts With" },
  { value: "ends_with", label: "Ends With" },
  { value: "matches_reference_row", label: "Matches Reference Row (Identical)" },
];

const TABLE_FILTER_OPERATORS = [
  { value: "equals", label: "Equals" },
  { value: "contains", label: "Contains" },
  { value: "not_equals", label: "Does Not Equal" },
  { value: "has_value", label: "Has a Value" },
  { value: "not_has_value", label: "Does Not Have Value" },
];

const MAIN_TABS = {
  DATA: "data_table",
  IMPORT: "import",
  STATUS: "manage_status",
  SETTINGS: "settings",
};

const IMPORT_MODES = {
  REPLACE: "replace",
  ADD_UPDATE: "add_update",
};

const MAX_TABLE_FILTER_LEVELS = 4;
const DEFAULT_TABLE_PAGE_SIZE = 25;

const createTableFilter = () => ({
  id: `filter_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  column: "",
  operator: "equals",
  value: "",
});

const STATUS_COLUMN_ALIASES = [
  "status",
  "line status",
  "item status",
  "run status",
  "conduit status",
  "conduit run status",
  "e2 status update",
  "e2 status update agile",
];

const normalizeValue = (value) => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
};

const normalizeKey = (value) =>
  normalizeValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const normalizeStatusKey = (value) => normalizeValue(value).toLowerCase();

const sanitizeStatusOptions = (options = []) => {
  const seen = new Set();
  const nextOptions = [];

  options.forEach((option) => {
    const sanitizedOption = normalizeValue(option);
    if (!sanitizedOption) return;

    const key = normalizeStatusKey(sanitizedOption);
    if (seen.has(key)) return;

    seen.add(key);
    nextOptions.push(sanitizedOption);
  });

  return nextOptions;
};

const dedupeHeaders = (headers) => {
  const counts = new Map();

  return headers.map((header, index) => {
    const baseHeader = normalizeValue(header) || `Column ${index + 1}`;
    const seenCount = counts.get(baseHeader) || 0;
    counts.set(baseHeader, seenCount + 1);
    return seenCount ? `${baseHeader} (${seenCount + 1})` : baseHeader;
  });
};

const getStatusColumnName = (headers) => {
  const matched = headers.find((header) => STATUS_COLUMN_ALIASES.includes(normalizeKey(header)));
  return matched || "Conduit Run Status";
};

const getWorksheetMatrixFromRange = (worksheet) => {
  if (!worksheet || !worksheet["!ref"]) {
    return [];
  }

  const range = XLSX.utils.decode_range(worksheet["!ref"]);
  const matrix = [];

  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    const rowValues = [];
    for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
      const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      const cell = worksheet[cellAddress];
      rowValues.push(normalizeValue(cell?.w ?? cell?.v ?? ""));
    }
    matrix.push(rowValues);
  }

  return matrix;
};

const getNonEmptyRows = (rows, headers) =>
  rows
    .map((values, index) => {
      const row = { __rowId: index + 1 };
      headers.forEach((header, columnIndex) => {
        row[header] = normalizeValue(values[columnIndex]);
      });
      return row;
    })
    .filter((row) => headers.some((header) => normalizeValue(row[header])));

const getStatusCounts = (rows, statusColumnName) => {
  const counts = rows.reduce((accumulator, row) => {
    const status = normalizeValue(row[statusColumnName]) || "Not Set";
    accumulator[status] = (accumulator[status] || 0) + 1;
    return accumulator;
  }, {});

  return Object.entries(counts).sort((left, right) => left[0].localeCompare(right[0]));
};

const rowHasAnyValue = (row, columns = []) =>
  columns.some((column) => Boolean(normalizeValue(row?.[column])));

const validateManualRowUniqueColumn = ({ rowToSave, allRows, uniqueColumn }) => {
  const targetColumn = normalizeValue(uniqueColumn);
  if (!targetColumn) return "";

  const targetValue = normalizeValue(rowToSave?.[targetColumn]);
  if (!targetValue) {
    return `Enter a value in \"${targetColumn}\" before saving this new row.`;
  }

  const duplicateExists = allRows.some((row) => (
    row.__rowId !== rowToSave.__rowId
    && normalizeValue(row[targetColumn])
    && normalizeValue(row[targetColumn]).toLowerCase() === targetValue.toLowerCase()
  ));

  if (duplicateExists) {
    return `\"${targetColumn}\" must be unique. \"${targetValue}\" already exists.`;
  }

  return "";
};

const getUserFriendlySaveErrorMessage = (saveError, fallbackMessage) => {
  const normalizedCode = normalizeValue(saveError?.code).replace(/^firestore\//, "");
  if (normalizedCode === "permission-denied") {
    return "You do not have permission to save this row. Ask an admin to grant edit access.";
  }
  if (normalizedCode === "unavailable") {
    return "Unable to reach the database right now. Check your internet connection and try again.";
  }
  if (normalizedCode === "failed-precondition") {
    return "A required Firestore configuration is missing. Please contact your admin.";
  }

  return normalizeValue(saveError?.message) || fallbackMessage;
};

const doesRowMatchPreviewCondition = ({
  row,
  column,
  operator,
  value,
  referenceRow,
  comparableColumns,
}) => {
  const normalizedLeftValue = normalizeValue(row?.[column]);
  const normalizedRightValue = normalizeValue(value);
  const leftValue = normalizedLeftValue.toLowerCase();
  const rightValue = normalizedRightValue.toLowerCase();

  if (operator === "matches_reference_row") {
    if (!referenceRow) return false;

    const columnsToCompare = (comparableColumns || []).filter(
      (nextColumn) => normalizeValue(nextColumn) && !String(nextColumn).startsWith("__")
    );
    if (!columnsToCompare.length) return false;

    return columnsToCompare.every(
      (nextColumn) => normalizeValue(row?.[nextColumn]) === normalizeValue(referenceRow?.[nextColumn])
    );
  }

  if (!column) return true;

  if (operator === "has_value") return leftValue.length > 0;
  if (operator === "not_complete") return leftValue !== "complete";
  if (!rightValue) return true;

  if (operator === "contains") return leftValue.includes(rightValue);
  if (operator === "not_equals") return leftValue !== rightValue;
  if (operator === "starts_with") return leftValue.startsWith(rightValue);
  if (operator === "ends_with") return leftValue.endsWith(rightValue);

  return leftValue === rightValue;
};

const doesRowMatchTableFilter = ({ row, filter }) => {
  const column = normalizeValue(filter?.column);
  const operator = normalizeValue(filter?.operator) || "equals";
  const value = normalizeValue(filter?.value);
  const leftValue = normalizeValue(row?.[column]).toLowerCase();
  const rightValue = value.toLowerCase();

  if (!column) return true;
  if (operator === "has_value") return leftValue.length > 0;
  if (operator === "not_has_value") return leftValue.length === 0;
  if (!rightValue) return true;
  if (operator === "contains") return leftValue.includes(rightValue);
  if (operator === "not_equals") return leftValue !== rightValue;
  return leftValue === rightValue;
};

const getConduitDocRef = (organizationId, projectId) =>
  doc(db, "churches", String(organizationId), "conduitRunCounterProjects", String(projectId));

const getRowsCollectionRef = (organizationId, projectId) =>
  collection(getConduitDocRef(organizationId, projectId), "rows");

const chunkArray = (items, size = 400) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const toRowValuesMap = (row, columns) =>
  columns.reduce((accumulator, column) => {
    accumulator[column] = normalizeValue(row[column]);
    return accumulator;
  }, {});

const getExcludedColumnsStorageKey = (organizationId, projectId) =>
  [EXCLUDED_COLUMNS_STORAGE_PREFIX, normalizeValue(organizationId), normalizeValue(projectId)]
    .filter(Boolean)
    .join(":");

const readExcludedColumnsDefaults = (organizationId, projectId) => {
  if (typeof window === "undefined") return [];

  try {
    const storageKey = getExcludedColumnsStorageKey(organizationId, projectId);
    if (!storageKey) return [];

    const rawValue = window.localStorage.getItem(storageKey);
    if (!rawValue) return [];

    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((value) => normalizeValue(value)).filter(Boolean);
  } catch (error) {
    return [];
  }
};

const writeExcludedColumnsDefaults = (organizationId, projectId, excludedColumns = []) => {
  if (typeof window === "undefined") return;

  try {
    const storageKey = getExcludedColumnsStorageKey(organizationId, projectId);
    if (!storageKey) return;

    window.localStorage.setItem(storageKey, JSON.stringify(excludedColumns));
  } catch (error) {
    // no-op
  }
};

const getConditionDefaultsStorageKey = (organizationId, projectId) =>
  [CONDITION_DEFAULTS_STORAGE_PREFIX, normalizeValue(organizationId), normalizeValue(projectId)]
    .filter(Boolean)
    .join(":");

const readConditionDefaults = (organizationId, projectId) => {
  if (typeof window === "undefined") {
    return {
      enabled: false,
      column: "",
      operator: "not_complete",
      value: "Complete",
    };
  }

  try {
    const storageKey = getConditionDefaultsStorageKey(organizationId, projectId);
    if (!storageKey) {
      return {
        enabled: false,
        column: "",
        operator: "not_complete",
        value: "Complete",
      };
    }

    const rawValue = window.localStorage.getItem(storageKey);
    if (!rawValue) {
      return {
        enabled: false,
        column: "",
        operator: "not_complete",
        value: "Complete",
      };
    }

    const parsed = JSON.parse(rawValue);
    return {
      enabled: parsed?.enabled === true,
      column: normalizeValue(parsed?.column),
      operator: normalizeValue(parsed?.operator) || "not_complete",
      value: normalizeValue(parsed?.value) || "Complete",
    };
  } catch (error) {
    return {
      enabled: false,
      column: "",
      operator: "not_complete",
      value: "Complete",
    };
  }
};

const writeConditionDefaults = (organizationId, projectId, conditionDefaults = {}) => {
  if (typeof window === "undefined") return;

  try {
    const storageKey = getConditionDefaultsStorageKey(organizationId, projectId);
    if (!storageKey) return;

    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        enabled: conditionDefaults?.enabled === true,
        column: normalizeValue(conditionDefaults?.column),
        operator: normalizeValue(conditionDefaults?.operator) || "not_complete",
        value: normalizeValue(conditionDefaults?.value) || "Complete",
      })
    );
  } catch (error) {
    // no-op
  }
};

const getExcelTabDefaultsStorageKey = (organizationId, projectId) =>
  [EXCEL_TAB_DEFAULTS_STORAGE_PREFIX, normalizeValue(organizationId), normalizeValue(projectId)]
    .filter(Boolean)
    .join(":");

const readExcelTabDefault = (organizationId, projectId) => {
  if (typeof window === "undefined") return "";

  try {
    const storageKey = getExcelTabDefaultsStorageKey(organizationId, projectId);
    if (!storageKey) return "";
    return normalizeValue(window.localStorage.getItem(storageKey));
  } catch (error) {
    return "";
  }
};

const writeExcelTabDefault = (organizationId, projectId, sheetName) => {
  if (typeof window === "undefined") return;

  try {
    const storageKey = getExcelTabDefaultsStorageKey(organizationId, projectId);
    if (!storageKey) return;
    window.localStorage.setItem(storageKey, normalizeValue(sheetName));
  } catch (error) {
    // no-op
  }
};

const getLastProjectStorageKey = (organizationId, userId) =>
  [LAST_PROJECT_STORAGE_PREFIX, normalizeValue(organizationId), normalizeValue(userId)]
    .filter(Boolean)
    .join(":");

const readLastSelectedProject = (organizationId, userId) => {
  if (typeof window === "undefined") return "";

  try {
    const storageKey = getLastProjectStorageKey(organizationId, userId);
    if (!storageKey) return "";
    return normalizeValue(window.localStorage.getItem(storageKey));
  } catch (error) {
    return "";
  }
};

const writeLastSelectedProject = (organizationId, userId, projectId) => {
  if (typeof window === "undefined") return;

  try {
    const storageKey = getLastProjectStorageKey(organizationId, userId);
    if (!storageKey) return;
    window.localStorage.setItem(storageKey, normalizeValue(projectId));
  } catch (error) {
    // no-op
  }
};

const getVisibleColumnsStorageKey = (organizationId, projectId, userId) =>
  [
    VISIBLE_COLUMNS_STORAGE_PREFIX,
    normalizeValue(organizationId),
    normalizeValue(projectId),
    normalizeValue(userId),
  ]
    .filter(Boolean)
    .join(":");

const readVisibleColumnsSelection = (organizationId, projectId, userId) => {
  if (typeof window === "undefined") return [];

  try {
    const storageKey = getVisibleColumnsStorageKey(organizationId, projectId, userId);
    if (!storageKey) return [];

    const rawValue = window.localStorage.getItem(storageKey);
    if (!rawValue) return [];

    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return [];

    return parsed.map((value) => normalizeValue(value)).filter(Boolean);
  } catch (error) {
    return [];
  }
};

const writeVisibleColumnsSelection = (organizationId, projectId, userId, visibleColumns = []) => {
  if (typeof window === "undefined") return;

  try {
    const storageKey = getVisibleColumnsStorageKey(organizationId, projectId, userId);
    if (!storageKey) return;

    window.localStorage.setItem(storageKey, JSON.stringify(visibleColumns));
  } catch (error) {
    // no-op
  }
};

const formatImportLogsForTooltip = (logs = []) => {
  if (!Array.isArray(logs) || logs.length === 0) {
    return "No import history yet.";
  }

  return logs
    .slice()
    .reverse()
    .map((entry, index) => {
      const dateText = normalizeValue(entry?.importedAtIso || entry?.at || "");
      const actionText = normalizeValue(entry?.action || "import");
      const fileText = normalizeValue(entry?.fileName || "Unknown file");
      const sheetText = normalizeValue(entry?.sheetName || "-");
      return `${index + 1}. ${actionText} | ${fileText} | sheet: ${sheetText} | ${dateText}`;
    })
    .join("\n");
};

const buildRowsFromStoredDocs = (rowDocs, columns, statusColumn) => {
  const sortedDocs = [...rowDocs].sort((left, right) => {
    const leftNumber = Number(left.data()?.rowNumber) || Number(left.id) || 0;
    const rightNumber = Number(right.data()?.rowNumber) || Number(right.id) || 0;
    return leftNumber - rightNumber;
  });

  return sortedDocs.map((rowDoc, index) => {
    const rowData = rowDoc.data() || {};
    const rowValues = rowData.values || {};
    const rowNumber = Number(rowData.rowNumber) || Number(rowDoc.id) || index + 1;
    const row = {
      __rowId: rowNumber,
      __importLogs: Array.isArray(rowData.importLogs) ? rowData.importLogs : [],
      __notes: Array.isArray(rowData.notes) ? rowData.notes : [],
      __isManual: Boolean(rowData.isManual),
      __isDraftManual: false,
    };

    columns.forEach((column) => {
      row[column] = normalizeValue(rowValues[column]);
    });

    if (!columns.includes(statusColumn)) {
      row[statusColumn] = normalizeValue(rowValues[statusColumn]);
    }

    return row;
  });
};

const ConduitRunCounter = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const userIdentity = normalizeValue(user?.uid || user?.email || "anonymous");
  const routePrefix =
    typeof window !== "undefined" && window.location?.pathname?.includes("/church/")
      ? "/church"
      : "/organization";
  const [fileName, setFileName] = useState("");
  const [columns, setColumns] = useState([]);
  const [rows, setRows] = useState([]);
  const [statusColumnName, setStatusColumnName] = useState("Conduit Run Status");
  const [previewFileName, setPreviewFileName] = useState("");
  const [previewColumns, setPreviewColumns] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);
  const [previewStatusColumnName, setPreviewStatusColumnName] = useState("Conduit Run Status");
  const [previewSourceColumns, setPreviewSourceColumns] = useState([]);
  const [previewSourceRows, setPreviewSourceRows] = useState([]);
  const [previewSourceStatusColumnName, setPreviewSourceStatusColumnName] = useState("Conduit Run Status");
  const [previewSheetNames, setPreviewSheetNames] = useState([]);
  const [previewSelectedSheetName, setPreviewSelectedSheetName] = useState("");
  const [previewWorkbook, setPreviewWorkbook] = useState(null);
  const [previewConditionEnabled, setPreviewConditionEnabled] = useState(false);
  const [previewConditionColumn, setPreviewConditionColumn] = useState("");
  const [previewConditionOperator, setPreviewConditionOperator] = useState("not_complete");
  const [previewConditionValue, setPreviewConditionValue] = useState("Complete");
  const [referenceConditionWorkbook, setReferenceConditionWorkbook] = useState(null);
  const [referenceConditionFileName, setReferenceConditionFileName] = useState("");
  const [referenceConditionColumns, setReferenceConditionColumns] = useState([]);
  const [referenceConditionRows, setReferenceConditionRows] = useState([]);
  const [referenceConditionSheetNames, setReferenceConditionSheetNames] = useState([]);
  const [referenceConditionSelectedSheetName, setReferenceConditionSelectedSheetName] = useState("");
  const [referenceConditionSelectedRowId, setReferenceConditionSelectedRowId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [tableFilters, setTableFilters] = useState([]);
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(DEFAULT_TABLE_PAGE_SIZE);
  const [error, setError] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isHydrating, setIsHydrating] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [loadedProjectIdForColumns, setLoadedProjectIdForColumns] = useState("");
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [excludedColumns, setExcludedColumns] = useState([]);
  const [logModalRow, setLogModalRow] = useState(null);
  const [statusOptions, setStatusOptions] = useState(DEFAULT_STATUS_OPTIONS);
  const [newStatusInput, setNewStatusInput] = useState("");
  const [activeMainTab, setActiveMainTab] = useState(MAIN_TABS.DATA);
  const [importMode, setImportMode] = useState(IMPORT_MODES.REPLACE);
  const [importMatchColumn, setImportMatchColumn] = useState("");
  const [importExistingMatchColumn, setImportExistingMatchColumn] = useState("");
  const [lastImportSummary, setLastImportSummary] = useState(null);
  const [visibleColumns, setVisibleColumns] = useState([]);
  const [draggingVisibleColumn, setDraggingVisibleColumn] = useState("");
  const [visibleColumnDropTarget, setVisibleColumnDropTarget] = useState("");
  const [isVisibleColumnsDropdownOpen, setIsVisibleColumnsDropdownOpen] = useState(false);
  const [columnToRename, setColumnToRename] = useState("");
  const [columnRenameValue, setColumnRenameValue] = useState("");
  const [newColumnName, setNewColumnName] = useState("");
  const [columnToDelete, setColumnToDelete] = useState("");
  const [manualRowUniqueColumn, setManualRowUniqueColumn] = useState("");
  const [manualRowDropdownColumns, setManualRowDropdownColumns] = useState([]);
  const [activeManualDropdownCell, setActiveManualDropdownCell] = useState("");
  const [editingStatusOriginal, setEditingStatusOriginal] = useState("");
  const [editingStatusDraft, setEditingStatusDraft] = useState("");
  const [pendingDeleteStatus, setPendingDeleteStatus] = useState("");
  const [deleteReplacementStatus, setDeleteReplacementStatus] = useState("");
  const [manualRowValidationErrors, setManualRowValidationErrors] = useState({});
  const [manualRowSaveFeedback, setManualRowSaveFeedback] = useState({
    type: "",
    message: "",
    rowId: null,
  });
  const [rowMovePickerRowId, setRowMovePickerRowId] = useState(null);
  const [rowMoveTargetProjectId, setRowMoveTargetProjectId] = useState("");
  const [isMovingRowId, setIsMovingRowId] = useState(null);
  const [logNoteDraft, setLogNoteDraft] = useState("");
  const [isSavingLogNote, setIsSavingLogNote] = useState(false);
  const visibleColumnsDropdownRef = useRef(null);

  const showManualRowSaveFeedback = useCallback((type, message, rowId = null) => {
    setManualRowSaveFeedback({
      type,
      message: normalizeValue(message),
      rowId,
    });
  }, []);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  const availableMoveProjects = useMemo(
    () => projects.filter((project) => String(project.id) !== String(selectedProjectId)),
    [projects, selectedProjectId]
  );

  const hasPreview = previewRows.length > 0 && previewColumns.length > 0;

  const referenceConditionSelectedRow = useMemo(
    () =>
      referenceConditionRows.find(
        (referenceRow) => String(referenceRow.__rowId) === String(referenceConditionSelectedRowId)
      ) || null,
    [referenceConditionRows, referenceConditionSelectedRowId]
  );

  const previewRowsAfterCondition = useMemo(() => {
    if (!previewConditionEnabled) {
      return previewRows;
    }

    return previewRows.filter((row) =>
      doesRowMatchPreviewCondition({
        row,
        column: previewConditionColumn,
        operator: previewConditionOperator,
        value: previewConditionValue,
        referenceRow: referenceConditionSelectedRow,
        comparableColumns: previewColumns,
      })
    );
  }, [
    previewColumns,
    previewConditionColumn,
    previewConditionEnabled,
    previewConditionOperator,
    previewConditionValue,
    previewRows,
    referenceConditionSelectedRow,
  ]);

  const canConfirmPreviewImport = hasPreview && previewRowsAfterCondition.length > 0;

  const filteredRows = useMemo(() => {
    const query = normalizeValue(searchTerm).toLowerCase();
    const activeFilters = tableFilters.filter((filter) => {
      const column = normalizeValue(filter.column);
      const operator = normalizeValue(filter.operator) || "equals";
      const value = normalizeValue(filter.value);
      if (!column) return false;
      if (["has_value", "not_has_value"].includes(operator)) return true;
      return Boolean(value);
    });

    const matchedRows = rows.filter((row) => {
      if (row.__isDraftManual) {
        return true;
      }

      const matchesSearch = !query
        || columns.some((column) => normalizeValue(row[column]).toLowerCase().includes(query));

      if (!matchesSearch) return false;
      if (!activeFilters.length) return true;

      return activeFilters.every((filter) => doesRowMatchTableFilter({ row, filter }));
    });

    return matchedRows.sort((left, right) => {
      const leftManual = Boolean(left.__isManual);
      const rightManual = Boolean(right.__isManual);

      if (leftManual && !rightManual) return -1;
      if (!leftManual && rightManual) return 1;
      if (leftManual && rightManual) return Number(right.__rowId) - Number(left.__rowId);
      return Number(left.__rowId) - Number(right.__rowId);
    });
  }, [columns, rows, searchTerm, tableFilters]);

  const statusCounts = useMemo(
    () => getStatusCounts(filteredRows, statusColumnName),
    [filteredRows, statusColumnName]
  );

  const needToAddRows = useMemo(
    () => filteredRows.filter((row) => normalizeValue(row?.[statusColumnName]).toLowerCase() === "need to add"),
    [filteredRows, statusColumnName]
  );

  const totalTablePages = useMemo(() => {
    const safePageSize = Math.max(1, Number(tablePageSize) || DEFAULT_TABLE_PAGE_SIZE);
    return Math.max(1, Math.ceil(filteredRows.length / safePageSize));
  }, [filteredRows.length, tablePageSize]);

  const paginatedRows = useMemo(() => {
    const safePageSize = Math.max(1, Number(tablePageSize) || DEFAULT_TABLE_PAGE_SIZE);
    const startIndex = (Math.max(1, tablePage) - 1) * safePageSize;
    return filteredRows.slice(startIndex, startIndex + safePageSize);
  }, [filteredRows, tablePage, tablePageSize]);

  const displayedColumns = useMemo(() => {
    const normalizedColumns = columns.map((column) => normalizeValue(column)).filter(Boolean);
    const validVisibleColumns = visibleColumns.filter((column) => normalizedColumns.includes(column));
    return validVisibleColumns.length ? validVisibleColumns : normalizedColumns;
  }, [columns, visibleColumns]);

  const equalTableColumnWidth = useMemo(
    () => `${100 / Math.max(1, displayedColumns.length + 2)}%`,
    [displayedColumns.length]
  );

  const hiddenColumns = useMemo(
    () => columns.filter((column) => !displayedColumns.includes(column)),
    [columns, displayedColumns]
  );

  const manualRowDropdownOptionsByColumn = useMemo(() => {
    const nextOptions = {};

    manualRowDropdownColumns.forEach((columnName) => {
      const values = Array.from(
        new Set(
          rows
            .map((row) => normalizeValue(row?.[columnName]))
            .filter(Boolean)
        )
      ).sort((left, right) => left.localeCompare(right));

      nextOptions[columnName] = values;
    });

    return nextOptions;
  }, [manualRowDropdownColumns, rows]);

  const settingsColumnOrder = useMemo(() => {
    const hidden = columns.filter((column) => !displayedColumns.includes(column));
    return [...displayedColumns, ...hidden];
  }, [columns, displayedColumns]);

  const activeLogRow = useMemo(() => {
    if (!logModalRow) return null;
    return rows.find((row) => row.__rowId === logModalRow.__rowId) || logModalRow;
  }, [logModalRow, rows]);

  useEffect(() => {
    if (!logModalRow) {
      setLogNoteDraft("");
      return;
    }
    setLogNoteDraft("");
  }, [logModalRow]);

  useEffect(() => {
    setRowMovePickerRowId(null);
    setRowMoveTargetProjectId("");
  }, [selectedProjectId]);

  useEffect(() => {
    if (!rowMovePickerRowId) return;

    const rowStillVisible = rows.some((row) => String(row.__rowId) === String(rowMovePickerRowId));
    if (!rowStillVisible) {
      setRowMovePickerRowId(null);
    }
  }, [rowMovePickerRowId, rows]);

  useEffect(() => {
    if (!manualRowSaveFeedback.message) return undefined;

    const timeoutId = window.setTimeout(() => {
      setManualRowSaveFeedback({
        type: "",
        message: "",
        rowId: null,
      });
    }, 4500);

    return () => window.clearTimeout(timeoutId);
  }, [manualRowSaveFeedback]);

  useEffect(() => {
    if (!isVisibleColumnsDropdownOpen) return undefined;

    const handleOutsideClick = (event) => {
      if (visibleColumnsDropdownRef.current?.contains(event.target)) return;
      setIsVisibleColumnsDropdownOpen(false);
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [isVisibleColumnsDropdownOpen]);

  useEffect(() => {
    setTablePage(1);
  }, [searchTerm, tableFilters, selectedProjectId]);

  useEffect(() => {
    setTablePage((previousPage) => Math.min(previousPage, totalTablePages));
  }, [totalTablePages]);

  useEffect(() => {
    if (!manualRowUniqueColumn) return;
    if (columns.includes(manualRowUniqueColumn)) return;
    setManualRowUniqueColumn("");
  }, [columns, manualRowUniqueColumn]);

  useEffect(() => {
    if (!manualRowDropdownColumns.length) return;

    setManualRowDropdownColumns((previousColumns) =>
      previousColumns.filter((columnName) => columns.includes(columnName))
    );
  }, [columns, manualRowDropdownColumns.length]);

  const persistStatusOptions = useCallback(
    async (nextStatusOptions) => {
      if (!id || !selectedProjectId) return;

      await setDoc(
        getConduitDocRef(id, selectedProjectId),
        {
          statusOptions: sanitizeStatusOptions(nextStatusOptions),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    },
    [id, selectedProjectId]
  );

  const getRowStatusOptions = useCallback(
    (currentStatus) => sanitizeStatusOptions([...statusOptions, currentStatus]),
    [statusOptions]
  );

  const getStatusUsageCount = useCallback(
    (statusValue) => {
      const targetKey = normalizeStatusKey(statusValue);
      return rows.reduce((count, row) => {
        const rowStatus = normalizeValue(row[statusColumnName]);
        return normalizeStatusKey(rowStatus) === targetKey ? count + 1 : count;
      }, 0);
    },
    [rows, statusColumnName]
  );

  const applyColumnExclusionsToPreview = useCallback(
    ({ sourceColumns, sourceRows, sourceStatusColumnName }) => {
      const sanitizedSourceColumns = (sourceColumns || []).map((column) => normalizeValue(column)).filter(Boolean);
      const sanitizedStatusColumn = normalizeValue(sourceStatusColumnName) || "Conduit Run Status";
      const exclusionSet = new Set(
        (excludedColumns || [])
          .map((column) => normalizeValue(column))
          .filter((column) => column && column !== sanitizedStatusColumn)
      );

      const nextColumns = sanitizedSourceColumns.filter((column) => !exclusionSet.has(column));
      const finalColumns = nextColumns.includes(sanitizedStatusColumn)
        ? nextColumns
        : [...nextColumns, sanitizedStatusColumn].filter(Boolean);

      const nextRows = (sourceRows || []).map((row) => {
        const nextRow = {
          __rowId: row.__rowId,
          __importLogs: Array.isArray(row.__importLogs) ? row.__importLogs : [],
        };

        finalColumns.forEach((column) => {
          nextRow[column] = normalizeValue(row[column]);
        });

        return nextRow;
      });

      setPreviewColumns(finalColumns);
      setPreviewRows(nextRows);
      setPreviewStatusColumnName(sanitizedStatusColumn);
      setPreviewConditionColumn((previousColumn) => {
        if (previousColumn && finalColumns.includes(previousColumn)) {
          return previousColumn;
        }
        if (finalColumns.includes(sanitizedStatusColumn)) {
          return sanitizedStatusColumn;
        }
        return finalColumns[0] || "";
      });
    },
    [excludedColumns]
  );

  useEffect(() => {
    if (!id || !selectedProjectId) {
      setExcludedColumns([]);
      setPreviewConditionEnabled(false);
      setPreviewConditionColumn("");
      setPreviewConditionOperator("not_complete");
      setPreviewConditionValue("Complete");
      return;
    }

    const defaults = readExcludedColumnsDefaults(id, selectedProjectId);
    const conditionDefaults = readConditionDefaults(id, selectedProjectId);

    setExcludedColumns(defaults);
    setPreviewConditionEnabled(conditionDefaults.enabled);
    setPreviewConditionColumn(conditionDefaults.column);
    setPreviewConditionOperator(conditionDefaults.operator);
    setPreviewConditionValue(conditionDefaults.value);
  }, [id, selectedProjectId]);

  useEffect(() => {
    if (!id || !selectedProjectId) return;
    writeExcludedColumnsDefaults(id, selectedProjectId, excludedColumns);
  }, [excludedColumns, id, selectedProjectId]);

  useEffect(() => {
    if (!id || !selectedProjectId) return;

    writeConditionDefaults(id, selectedProjectId, {
      enabled: previewConditionEnabled,
      column: previewConditionColumn,
      operator: previewConditionOperator,
      value: previewConditionValue,
    });
  }, [
    id,
    previewConditionColumn,
    previewConditionEnabled,
    previewConditionOperator,
    previewConditionValue,
    selectedProjectId,
  ]);

  useEffect(() => {
    if (!previewSourceColumns.length) return;
    applyColumnExclusionsToPreview({
      sourceColumns: previewSourceColumns,
      sourceRows: previewSourceRows,
      sourceStatusColumnName: previewSourceStatusColumnName,
    });
  }, [
    applyColumnExclusionsToPreview,
    excludedColumns,
    previewSourceColumns,
    previewSourceRows,
    previewSourceStatusColumnName,
  ]);

  useEffect(() => {
    if (!previewColumns.length) {
      setImportMatchColumn("");
      return;
    }

    setImportMatchColumn((previousColumn) => (
      previousColumn && previewColumns.includes(previousColumn)
        ? previousColumn
        : previewColumns[0]
    ));
  }, [previewColumns]);

  useEffect(() => {
    if (!columns.length) {
      setImportExistingMatchColumn("");
      return;
    }

    setImportExistingMatchColumn((previousColumn) => {
      if (previousColumn && columns.includes(previousColumn)) {
        return previousColumn;
      }

      const inferredColumn = columns.find(
        (column) => normalizeKey(column) === normalizeKey(importMatchColumn)
      );
      return inferredColumn || columns[0];
    });
  }, [columns, importMatchColumn]);

  useEffect(() => {
    if (!columns.length) {
      setColumnToRename("");
      setColumnRenameValue("");
      setColumnToDelete("");
      return;
    }

    setColumnToRename((previousColumn) => {
      const nextColumn = previousColumn && columns.includes(previousColumn)
        ? previousColumn
        : columns[0];

      setColumnRenameValue((previousValue) => (
        previousColumn === nextColumn && previousValue
          ? previousValue
          : nextColumn
      ));

      return nextColumn;
    });

    setColumnToDelete((previousColumn) => (
      previousColumn && columns.includes(previousColumn)
        ? previousColumn
        : columns.find((column) => column !== statusColumnName) || ""
    ));
  }, [columns, statusColumnName]);

  useEffect(() => {
    if (normalizeValue(selectedProjectId) !== normalizeValue(loadedProjectIdForColumns)) {
      return;
    }

    if (!id || !selectedProjectId || !userIdentity) {
      setVisibleColumns(columns.map((column) => normalizeValue(column)).filter(Boolean));
      return;
    }

    const normalizedColumns = columns.map((column) => normalizeValue(column)).filter(Boolean);
    if (!normalizedColumns.length) {
      setVisibleColumns([]);
      return;
    }

    const storedSelection = readVisibleColumnsSelection(id, selectedProjectId, userIdentity);
    const validStoredSelection = storedSelection.filter((column) => normalizedColumns.includes(column));
    setVisibleColumns(validStoredSelection.length ? validStoredSelection : normalizedColumns);
  }, [columns, id, loadedProjectIdForColumns, selectedProjectId, userIdentity]);

  useEffect(() => {
    if (normalizeValue(selectedProjectId) !== normalizeValue(loadedProjectIdForColumns)) return;
    if (!id || !selectedProjectId || !userIdentity) return;
    if (!visibleColumns.length) return;
    writeVisibleColumnsSelection(id, selectedProjectId, userIdentity, visibleColumns);
  }, [id, loadedProjectIdForColumns, selectedProjectId, userIdentity, visibleColumns]);

  useEffect(() => {
    const loadProjects = async () => {
      if (!id) {
        setIsLoadingProjects(false);
        return;
      }

      setIsLoadingProjects(true);
      setError("");

      try {
        const projectsRef = collection(db, "churches", id, "projectListIssueProjects");
        const snapshot = await getDocs(query(projectsRef));
        const nextProjects = snapshot.docs
          .map((projectDoc) => {
            const projectData = projectDoc.data() || {};
            return {
              id: projectDoc.id,
              name: normalizeValue(projectData.name) || "Untitled Project",
            };
          })
          .sort((left, right) => left.name.localeCompare(right.name));

        setProjects(nextProjects);
        setSelectedProjectId((previousProjectId) => {
          if (previousProjectId && nextProjects.some((project) => project.id === previousProjectId)) {
            return previousProjectId;
          }

          const rememberedProjectId = readLastSelectedProject(id, userIdentity);
          if (rememberedProjectId && nextProjects.some((project) => project.id === rememberedProjectId)) {
            return rememberedProjectId;
          }

          return nextProjects[0]?.id || "";
        });
      } catch (loadError) {
        setError(loadError?.message || "Failed to load projects.");
      } finally {
        setIsLoadingProjects(false);
      }
    };

    loadProjects();
  }, [id, userIdentity]);

  useEffect(() => {
    if (!id || !selectedProjectId || !userIdentity) return;
    writeLastSelectedProject(id, userIdentity, selectedProjectId);
  }, [id, selectedProjectId, userIdentity]);

  const persistFullDataset = useCallback(
    async ({
      nextFileName,
      nextColumns,
      nextRows,
      nextStatusColumnName,
      nextSheetName,
      replaceExistingRows = true,
    }) => {
      if (!id || !selectedProjectId) return;

      const conduitDocRef = getConduitDocRef(id, selectedProjectId);
      const rowsCollectionRef = getRowsCollectionRef(id, selectedProjectId);

      setIsSaving(true);
      try {
        const existingRowsSnapshot = await getDocs(rowsCollectionRef);
        const existingByRowId = new Map(
          existingRowsSnapshot.docs.map((rowDoc) => [String(rowDoc.id), rowDoc.data() || {}])
        );

        const rowWritePayload = nextRows.map((row) => ({
          rowId: String(row.__rowId),
          rowNumber: Number(row.__rowId),
          values: toRowValuesMap(row, nextColumns),
          importLogs: Array.isArray(row.__importLogs) ? row.__importLogs : [],
          notes: Array.isArray(row.__notes) ? row.__notes : [],
          isManual: Boolean(row.__isManual),
        }));

        const importedAtIso = new Date().toISOString();
        const writeChunks = chunkArray(rowWritePayload, 400);
        for (const chunk of writeChunks) {
          const writeBatchRef = writeBatch(db);
          chunk.forEach((entry) => {
            const existingRow = existingByRowId.get(entry.rowId) || {};
            const existingLogs = Array.isArray(existingRow.importLogs) ? existingRow.importLogs : [];
            const existingNotes = Array.isArray(existingRow.notes) ? existingRow.notes : [];
            const nextLogEntry = {
              action: existingByRowId.has(entry.rowId)
                ? (replaceExistingRows ? "overwritten" : "updated")
                : "imported",
              fileName: normalizeValue(nextFileName),
              sheetName: normalizeValue(nextSheetName),
              importedAtIso,
            };
            const nextLogs = [...existingLogs, nextLogEntry].slice(-IMPORT_LOG_LIMIT);
            const nextNotes = Array.isArray(entry.notes) && entry.notes.length
              ? entry.notes
              : existingNotes;

            writeBatchRef.set(doc(rowsCollectionRef, entry.rowId), {
              rowNumber: entry.rowNumber,
              values: entry.values,
              importLogs: nextLogs,
              notes: nextNotes,
              isManual: Boolean(entry.isManual),
              updatedAt: serverTimestamp(),
            });
          });
          await writeBatchRef.commit();
        }

        if (replaceExistingRows) {
          const incomingRowIdSet = new Set(rowWritePayload.map((entry) => entry.rowId));
          const rowsToDelete = existingRowsSnapshot.docs.filter((rowDoc) => !incomingRowIdSet.has(String(rowDoc.id)));
          const deleteChunks = chunkArray(rowsToDelete, 400);
          for (const chunk of deleteChunks) {
            const deleteBatch = writeBatch(db);
            chunk.forEach((rowDoc) => {
              deleteBatch.delete(rowDoc.ref);
            });
            await deleteBatch.commit();
          }
        }

        await setDoc(
          conduitDocRef,
          {
            organizationId: String(id),
            projectId: String(selectedProjectId),
            projectName: normalizeValue(selectedProject?.name),
            fileName: nextFileName || "",
            sheetName: nextSheetName || "",
            columns: nextColumns,
            statusColumnName: nextStatusColumnName,
            statusOptions: sanitizeStatusOptions(statusOptions),
            manualRowUniqueColumn,
            manualRowDropdownColumns,
            rowCount: nextRows.length,
            updatedAt: serverTimestamp(),
            lastImportedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } finally {
        setIsSaving(false);
      }
    },
    [id, manualRowDropdownColumns, manualRowUniqueColumn, selectedProject?.name, selectedProjectId, statusOptions]
  );

  const persistSingleRowStatus = useCallback(
    async (rowId, nextStatus) => {
      if (!id || !selectedProjectId || !rowId || !columns.length) return;

      const rowToSave = rows.find((row) => row.__rowId === rowId);
      if (!rowToSave) return;

      const nextRowValues = {
        ...toRowValuesMap(rowToSave, columns),
        [statusColumnName]: normalizeValue(nextStatus),
      };

      const rowDocRef = doc(getRowsCollectionRef(id, selectedProjectId), String(rowId));
      await setDoc(
        rowDocRef,
        {
          rowNumber: Number(rowId),
          values: nextRowValues,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      await setDoc(
        getConduitDocRef(id, selectedProjectId),
        {
          updatedAt: serverTimestamp(),
          rowCount: rows.length,
        },
        { merge: true }
      );
    },
    [columns, id, rows, selectedProjectId, statusColumnName]
  );

  const persistSingleRowValues = useCallback(
    async (rowId, rowOverride, rowCountOverride) => {
      if (!id || !selectedProjectId || !rowId || !columns.length) return;

      const rowToSave = rowOverride || rows.find((row) => row.__rowId === rowId);
      if (!rowToSave) return;
      const effectiveRowCount = Number.isFinite(rowCountOverride) ? rowCountOverride : rows.length;

      const rowDocRef = doc(getRowsCollectionRef(id, selectedProjectId), String(rowId));
      await setDoc(
        rowDocRef,
        {
          rowNumber: Number(rowId),
          values: toRowValuesMap(rowToSave, columns),
          importLogs: Array.isArray(rowToSave.__importLogs) ? rowToSave.__importLogs : [],
          notes: Array.isArray(rowToSave.__notes) ? rowToSave.__notes : [],
          isManual: Boolean(rowToSave.__isManual),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      await setDoc(
        getConduitDocRef(id, selectedProjectId),
        {
          updatedAt: serverTimestamp(),
          rowCount: effectiveRowCount,
        },
        { merge: true }
      );
    },
    [columns, id, rows, selectedProjectId]
  );

  useEffect(() => {
    const hydrateFromFirestore = async () => {
      if (!id) {
        setLoadedProjectIdForColumns("");
        setIsHydrating(false);
        return;
      }

      if (!selectedProjectId) {
        setLoadedProjectIdForColumns("");
        setFileName("");
        setColumns([]);
        setRows([]);
        setStatusColumnName("Conduit Run Status");
        setStatusOptions(DEFAULT_STATUS_OPTIONS);
        setManualRowUniqueColumn("");
        setManualRowDropdownColumns([]);
        setIsHydrating(false);
        return;
      }

      setIsHydrating(true);
  setLoadedProjectIdForColumns("");
      setError("");

      try {
        const conduitDocRef = getConduitDocRef(id, selectedProjectId);
        const [metaSnapshot, rowsSnapshot] = await Promise.all([
          getDoc(conduitDocRef),
          getDocs(getRowsCollectionRef(id, selectedProjectId)),
        ]);

        if (!metaSnapshot.exists()) {
          setFileName("");
          setColumns([]);
          setRows([]);
          setStatusColumnName("Conduit Run Status");
          setStatusOptions(DEFAULT_STATUS_OPTIONS);
          setManualRowUniqueColumn("");
          setManualRowDropdownColumns([]);
          setLoadedProjectIdForColumns(selectedProjectId);
          setIsHydrating(false);
          return;
        }

        const data = metaSnapshot.data() || {};
        const storedColumns = Array.isArray(data.columns) ? data.columns.map((column) => normalizeValue(column)) : [];
        const storedStatusColumn = normalizeValue(data.statusColumnName) || "Conduit Run Status";
        const storedStatusOptions = Array.isArray(data.statusOptions)
          ? sanitizeStatusOptions(data.statusOptions)
          : [];
        const storedManualUniqueColumn = normalizeValue(data.manualRowUniqueColumn);
        const storedManualRowDropdownColumns = Array.isArray(data.manualRowDropdownColumns)
          ? data.manualRowDropdownColumns.map((column) => normalizeValue(column)).filter(Boolean)
          : [];
        const columnsWithStatus = storedColumns.includes(storedStatusColumn)
          ? storedColumns
          : [...storedColumns, storedStatusColumn].filter(Boolean);

        const hydratedRows = buildRowsFromStoredDocs(rowsSnapshot.docs, columnsWithStatus, storedStatusColumn);

        setFileName(normalizeValue(data.fileName));
        setColumns(columnsWithStatus);
        setRows(hydratedRows);
        setStatusColumnName(storedStatusColumn);
        setStatusOptions(storedStatusOptions.length ? storedStatusOptions : DEFAULT_STATUS_OPTIONS);
        setManualRowUniqueColumn(
          storedManualUniqueColumn && columnsWithStatus.includes(storedManualUniqueColumn)
            ? storedManualUniqueColumn
            : ""
        );
        setManualRowDropdownColumns(
          storedManualRowDropdownColumns.filter((column) => columnsWithStatus.includes(column))
        );
        setLoadedProjectIdForColumns(selectedProjectId);
      } catch (loadError) {
        setError(loadError?.message || "Failed to load saved Conduit Run Counter data.");
      } finally {
        setIsHydrating(false);
      }
    };

    hydrateFromFirestore();
  }, [id, selectedProjectId]);

  const handleFileUpload = async (event) => {
    const file = event?.target?.files?.[0];
    if (!file) return;
    if (!selectedProjectId) {
      setError("Please select a project first.");
      return;
    }

    setError("");
    setIsUploading(true);

    try {
      const fileBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(fileBuffer, { type: "array", cellDates: true });
      const workbookSheetNames = Array.isArray(workbook.SheetNames)
        ? workbook.SheetNames.map((sheetName) => normalizeValue(sheetName)).filter(Boolean)
        : [];
      const preferredSheetName = readExcelTabDefault(id, selectedProjectId);
      const firstSheetName = workbookSheetNames.includes(preferredSheetName)
        ? preferredSheetName
        : workbookSheetNames[0];

      if (!firstSheetName) {
        throw new Error("No sheets were found in the uploaded file.");
      }

      const worksheet = workbook.Sheets[firstSheetName];
      const matrix = getWorksheetMatrixFromRange(worksheet);

      if (!matrix.length) {
        throw new Error("The first sheet is empty.");
      }

      const parsedHeaders = dedupeHeaders(matrix[0]);
      const resolvedStatusColumn = getStatusColumnName(parsedHeaders);
      const nextColumns = parsedHeaders.includes(resolvedStatusColumn)
        ? parsedHeaders
        : [...parsedHeaders, resolvedStatusColumn];

      const parsedRows = getNonEmptyRows(matrix.slice(1), parsedHeaders).map((row) => ({
        ...row,
        [resolvedStatusColumn]: normalizeValue(row[resolvedStatusColumn]),
      }));

      setPreviewFileName(file.name);
      setPreviewSourceColumns(nextColumns);
      setPreviewSourceRows(parsedRows);
      setPreviewSourceStatusColumnName(resolvedStatusColumn);
      setPreviewSheetNames(workbookSheetNames);
      setPreviewSelectedSheetName(firstSheetName);
      setPreviewWorkbook(workbook);
      writeExcelTabDefault(id, selectedProjectId, firstSheetName);
      applyColumnExclusionsToPreview({
        sourceColumns: nextColumns,
        sourceRows: parsedRows,
        sourceStatusColumnName: resolvedStatusColumn,
      });
    } catch (uploadError) {
      setPreviewFileName("");
      setPreviewSourceColumns([]);
      setPreviewSourceRows([]);
      setPreviewSourceStatusColumnName("Conduit Run Status");
      setPreviewColumns([]);
      setPreviewRows([]);
      setPreviewStatusColumnName("Conduit Run Status");
      setError(uploadError?.message || "Failed to read the uploaded file.");
    } finally {
      setIsUploading(false);
      if (event?.target) {
        event.target.value = "";
      }
    }
  };

  const clearPreview = () => {
    setPreviewFileName("");
    setPreviewSourceColumns([]);
    setPreviewSourceRows([]);
    setPreviewSourceStatusColumnName("Conduit Run Status");
    setPreviewColumns([]);
    setPreviewRows([]);
    setPreviewStatusColumnName("Conduit Run Status");
    setPreviewSheetNames([]);
    setPreviewSelectedSheetName("");
    setPreviewWorkbook(null);
  };

  const applyPreviewFromSheet = (sheetName) => {
    if (!previewWorkbook) return;

    const normalizedSheetName = normalizeValue(sheetName);
    if (!normalizedSheetName) return;

    const worksheet = previewWorkbook.Sheets?.[normalizedSheetName];
    if (!worksheet) {
      setError("Selected sheet was not found in the workbook.");
      return;
    }

    const matrix = getWorksheetMatrixFromRange(worksheet);
    if (!matrix.length) {
      setPreviewSelectedSheetName(normalizedSheetName);
      setPreviewColumns([]);
      setPreviewRows([]);
      setPreviewStatusColumnName("Conduit Run Status");
      setPreviewConditionColumn("");
      return;
    }

    const parsedHeaders = dedupeHeaders(matrix[0]);
    const resolvedStatusColumn = getStatusColumnName(parsedHeaders);
    const nextColumns = parsedHeaders.includes(resolvedStatusColumn)
      ? parsedHeaders
      : [...parsedHeaders, resolvedStatusColumn];

    const parsedRows = getNonEmptyRows(matrix.slice(1), parsedHeaders).map((row) => ({
      ...row,
      [resolvedStatusColumn]: normalizeValue(row[resolvedStatusColumn]),
    }));

    setPreviewSelectedSheetName(normalizedSheetName);
    setPreviewSourceColumns(nextColumns);
    setPreviewSourceRows(parsedRows);
    setPreviewSourceStatusColumnName(resolvedStatusColumn);
    writeExcelTabDefault(id, selectedProjectId, normalizedSheetName);
    applyColumnExclusionsToPreview({
      sourceColumns: nextColumns,
      sourceRows: parsedRows,
      sourceStatusColumnName: resolvedStatusColumn,
    });
  };

  const applyReferenceConditionFromSheet = (sheetName, workbookOverride) => {
    const activeWorkbook = workbookOverride || referenceConditionWorkbook;
    if (!activeWorkbook) return;

    const normalizedSheetName = normalizeValue(sheetName);
    if (!normalizedSheetName) return;

    const worksheet = activeWorkbook.Sheets?.[normalizedSheetName];
    if (!worksheet) {
      setError("Reference condition sheet was not found in the workbook.");
      return;
    }

    const matrix = getWorksheetMatrixFromRange(worksheet);
    if (!matrix.length) {
      setReferenceConditionSelectedSheetName(normalizedSheetName);
      setReferenceConditionColumns([]);
      setReferenceConditionRows([]);
      setReferenceConditionSelectedRowId("");
      return;
    }

    const parsedHeaders = dedupeHeaders(matrix[0]);
    const parsedRows = getNonEmptyRows(matrix.slice(1), parsedHeaders);

    setReferenceConditionSelectedSheetName(normalizedSheetName);
    setReferenceConditionColumns(parsedHeaders);
    setReferenceConditionRows(parsedRows);
    setReferenceConditionSelectedRowId((previousRowId) => {
      if (previousRowId && parsedRows.some((row) => String(row.__rowId) === String(previousRowId))) {
        return String(previousRowId);
      }
      return parsedRows[0] ? String(parsedRows[0].__rowId) : "";
    });
  };

  const handleReferenceConditionFileUpload = async (event) => {
    const file = event?.target?.files?.[0];
    if (!file) return;

    setError("");

    try {
      const fileBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(fileBuffer, { type: "array", cellDates: true });
      const workbookSheetNames = Array.isArray(workbook.SheetNames)
        ? workbook.SheetNames.map((sheetName) => normalizeValue(sheetName)).filter(Boolean)
        : [];

      const firstSheetName = workbookSheetNames[0];
      if (!firstSheetName) {
        throw new Error("No sheets were found in the reference file.");
      }

      setReferenceConditionWorkbook(workbook);
      setReferenceConditionFileName(file.name);
      setReferenceConditionSheetNames(workbookSheetNames);
      applyReferenceConditionFromSheet(firstSheetName, workbook);
    } catch (uploadError) {
      setReferenceConditionWorkbook(null);
      setReferenceConditionFileName("");
      setReferenceConditionColumns([]);
      setReferenceConditionRows([]);
      setReferenceConditionSheetNames([]);
      setReferenceConditionSelectedSheetName("");
      setReferenceConditionSelectedRowId("");
      setError(uploadError?.message || "Failed to read the reference condition file.");
    } finally {
      if (event?.target) {
        event.target.value = "";
      }
    }
  };

  const confirmImportPreview = async () => {
    if (!selectedProjectId) {
      setError("Please select a project first.");
      return;
    }

    if (!hasPreview) {
      setError("No preview data available to import.");
      return;
    }

    const isReplacing = importMode === IMPORT_MODES.REPLACE;
    const normalizedMatchColumn = normalizeValue(importMatchColumn);
    const normalizedExistingMatchColumn = normalizeValue(importExistingMatchColumn);

    if (!isReplacing && !normalizedMatchColumn) {
      setError("Select a Match Column for Add/Update mode.");
      return;
    }

    if (!isReplacing && !normalizedExistingMatchColumn) {
      setError("Select an Existing Match Column for Add/Update mode.");
      return;
    }

    if (rows.length > 0) {
      const confirmationMessage = isReplacing
        ? "Replace existing imported data with this import? Rows not in this file will be removed."
        : `Add/Update mode selected: incoming \"${normalizedMatchColumn}\" will match existing \"${normalizedExistingMatchColumn}\". Matched rows update all other imported columns and non-matching rows are skipped. Continue?`;
      const shouldContinue = window.confirm(confirmationMessage);
      if (!shouldContinue) return;
    }

    const nextStatusColumnForImport = rows.length
      ? (statusColumnName || previewStatusColumnName)
      : previewStatusColumnName;

    const incomingColumns = previewColumns;
    const incomingRows = previewRowsAfterCondition;

    const mergedColumns = isReplacing
      ? incomingColumns
      : (() => {
          const nextColumns = (columns.length
            ? columns
            : incomingColumns)
            .map((column) => normalizeValue(column))
            .filter(Boolean);

          const statusExists = nextColumns.some(
            (existingColumn) => normalizeKey(existingColumn) === normalizeKey(nextStatusColumnForImport)
          );
          if (!statusExists) {
            nextColumns.push(nextStatusColumnForImport);
          }

          return nextColumns;
        })();

    const incomingToTargetColumn = new Map(
      incomingColumns.map((incomingColumn) => {
        const normalizedIncomingKey = normalizeKey(incomingColumn);
        const targetColumn = mergedColumns.find(
          (existingColumn) => normalizeKey(existingColumn) === normalizedIncomingKey
        ) || "";
        return [incomingColumn, targetColumn];
      })
    );

    const targetMatchColumn =
      mergedColumns.find(
        (existingColumn) => normalizeKey(existingColumn) === normalizeKey(normalizedExistingMatchColumn)
      ) || normalizedExistingMatchColumn;

    const mergedRows = isReplacing
      ? incomingRows.map((incomingRow) => {
          const nextRow = {
            __rowId: incomingRow.__rowId,
            __importLogs: Array.isArray(incomingRow.__importLogs) ? incomingRow.__importLogs : [],
            __notes: Array.isArray(incomingRow.__notes) ? incomingRow.__notes : [],
            __isManual: false,
          };

          mergedColumns.forEach((column) => {
            nextRow[column] = normalizeValue(incomingRow[column]);
          });

          return nextRow;
        })
      : (() => {
          let matchedAndUpdatedCount = 0;
          let skippedNoMatchCount = 0;
          let skippedAmbiguousMatchCount = 0;

          const nextRows = rows.map((existingRow) => {
            const normalizedExistingRow = {
              __rowId: existingRow.__rowId,
              __importLogs: Array.isArray(existingRow.__importLogs) ? existingRow.__importLogs : [],
              __notes: Array.isArray(existingRow.__notes) ? existingRow.__notes : [],
              __isManual: Boolean(existingRow.__isManual),
            };
            mergedColumns.forEach((column) => {
              normalizedExistingRow[column] = normalizeValue(existingRow[column]);
            });
            return normalizedExistingRow;
          });

          const existingMatchIndexMap = new Map();
          nextRows.forEach((existingRow, index) => {
            const matchValue = normalizeValue(existingRow[targetMatchColumn]);
            if (!matchValue) return;
            const indexes = existingMatchIndexMap.get(matchValue) || [];
            indexes.push(index);
            existingMatchIndexMap.set(matchValue, indexes);
          });

          incomingRows.forEach((incomingRow) => {
            const incomingMatchValue = normalizeValue(incomingRow[normalizedMatchColumn]);
            if (!incomingMatchValue) {
              skippedNoMatchCount += 1;
              return;
            }

            const matchedIndexes = existingMatchIndexMap.get(incomingMatchValue) || [];
            if (matchedIndexes.length === 0) {
              skippedNoMatchCount += 1;
              return;
            }

            if (matchedIndexes.length > 1) {
              skippedAmbiguousMatchCount += 1;
              return;
            }

            const [matchIndex] = matchedIndexes;

            const existingRow = nextRows[matchIndex];
            const updatedRow = {
              ...existingRow,
            };

            incomingColumns.forEach((incomingColumn) => {
              const targetColumn = incomingToTargetColumn.get(incomingColumn);
              if (!targetColumn) return;
              if (normalizeKey(incomingColumn) === normalizeKey(normalizedMatchColumn)) return;
              if (normalizeKey(targetColumn) === normalizeKey(targetMatchColumn)) return;

              const incomingCellValue = normalizeValue(incomingRow[incomingColumn]);
              if (!incomingCellValue) return;
              updatedRow[targetColumn] = incomingCellValue;
            });

            nextRows[matchIndex] = updatedRow;
            nextRows[matchIndex].__isManual = false;
            matchedAndUpdatedCount += 1;
          });

          setLastImportSummary({
            mode: IMPORT_MODES.ADD_UPDATE,
            matchedAndUpdatedCount,
            skippedNoMatchCount,
            skippedAmbiguousMatchCount,
            matchColumn: `${normalizedMatchColumn} -> ${targetMatchColumn}`,
          });

          return nextRows.sort((left, right) => Number(left.__rowId) - Number(right.__rowId));
        })();

    if (isReplacing) {
      setLastImportSummary({
        mode: IMPORT_MODES.REPLACE,
        replacedRowCount: incomingRows.length,
      });
    }

    setError("");
    try {
      await persistFullDataset({
        nextFileName: previewFileName,
        nextColumns: mergedColumns,
        nextRows: mergedRows,
        nextStatusColumnName: nextStatusColumnForImport,
        nextSheetName: previewSelectedSheetName,
        replaceExistingRows: isReplacing,
      });

      setFileName(previewFileName);
      setColumns(mergedColumns);
      setRows(mergedRows);
      setStatusColumnName(nextStatusColumnForImport);
      clearPreview();
    } catch (saveError) {
      setError(saveError?.message || "Failed to import preview data.");
    }
  };

  const setRowStatus = async (rowId, nextStatus) => {
    const nextRows = rows.map((row) => (
      row.__rowId === rowId
        ? {
            ...row,
            [statusColumnName]: nextStatus,
          }
        : row
    ));
    setRows(nextRows);
    const nextRow = nextRows.find((row) => row.__rowId === rowId);

    try {
      if (nextRow?.__isManual) {
        if (!rowHasAnyValue(nextRow, columns)) return;
        const uniqueValidationError = validateManualRowUniqueColumn({
          rowToSave: nextRow,
          allRows: nextRows,
          uniqueColumn: manualRowUniqueColumn,
        });
        if (uniqueValidationError) {
          setError("");
          showManualRowSaveFeedback(
            "error",
            `${uniqueValidationError} Update the row and click Save Row again.`,
            rowId
          );
          setManualRowValidationErrors((previousErrors) => ({
            ...previousErrors,
            [rowId]: `${uniqueValidationError} Update the row and click Save Row again.`,
          }));
          setRows((currentRows) =>
            currentRows.map((row) => (
              row.__rowId === rowId
                ? { ...row, __isDraftManual: true }
                : row
            ))
          );
          return;
        }
        await persistSingleRowValues(rowId, { ...nextRow, __isDraftManual: false }, nextRows.length);
        setRows((currentRows) =>
          currentRows.map((row) => (
            row.__rowId === rowId
              ? { ...row, __isDraftManual: false }
              : row
          ))
        );
        setManualRowValidationErrors((previousErrors) => {
          if (!previousErrors[rowId]) return previousErrors;
          const nextErrors = { ...previousErrors };
          delete nextErrors[rowId];
          return nextErrors;
        });
        setError("");
        showManualRowSaveFeedback("success", `Row ${rowId} saved successfully.`, rowId);
      } else {
        await persistSingleRowStatus(rowId, nextStatus);
      }
    } catch (saveError) {
      const message = getUserFriendlySaveErrorMessage(saveError, "Failed to save row status.");
      setError(message);
      showManualRowSaveFeedback("error", message, rowId);
    }
  };

  const setManualRowCellValue = (rowId, columnName, nextValue) => {
    setRows((currentRows) =>
      currentRows.map((row) => (
        row.__rowId === rowId
          ? {
              ...row,
              [columnName]: nextValue,
            }
          : row
      ))
    );
    setManualRowValidationErrors((previousErrors) => {
      if (!previousErrors[rowId]) return previousErrors;
      const nextErrors = { ...previousErrors };
      delete nextErrors[rowId];
      return nextErrors;
    });
  };

  const saveManualRowCellValue = async (rowId) => {
    const targetRow = rows.find((row) => row.__rowId === rowId);
    if (!targetRow) return;
    if (!rowHasAnyValue(targetRow, columns)) {
      setError("");
      showManualRowSaveFeedback("error", "Fill at least one field before saving the new row.", rowId);
      setManualRowValidationErrors((previousErrors) => ({
        ...previousErrors,
        [rowId]: "Fill at least one field before saving the new row.",
      }));
      setRows((currentRows) =>
        currentRows.map((row) => (
          row.__rowId === rowId
            ? { ...row, __isDraftManual: true }
            : row
        ))
      );
      return;
    }

    const uniqueValidationError = validateManualRowUniqueColumn({
      rowToSave: targetRow,
      allRows: rows,
      uniqueColumn: manualRowUniqueColumn,
    });
    if (uniqueValidationError) {
      setError("");
      showManualRowSaveFeedback(
        "error",
        `${uniqueValidationError} Update the row and click Save Row again.`,
        rowId
      );
      setManualRowValidationErrors((previousErrors) => ({
        ...previousErrors,
        [rowId]: `${uniqueValidationError} Update the row and click Save Row again.`,
      }));
      setRows((currentRows) =>
        currentRows.map((row) => (
          row.__rowId === rowId
            ? { ...row, __isDraftManual: true }
            : row
        ))
      );
      return;
    }

    try {
      await persistSingleRowValues(rowId, { ...targetRow, __isDraftManual: false }, rows.length);
      setRows((currentRows) =>
        currentRows.map((row) => (
          row.__rowId === rowId
            ? { ...row, __isDraftManual: false }
            : row
        ))
      );
      setManualRowValidationErrors((previousErrors) => {
        if (!previousErrors[rowId]) return previousErrors;
        const nextErrors = { ...previousErrors };
        delete nextErrors[rowId];
        return nextErrors;
      });
      setError("");
      showManualRowSaveFeedback("success", `Row ${rowId} saved successfully.`, rowId);
    } catch (saveError) {
      const message = getUserFriendlySaveErrorMessage(saveError, "Failed to save row value.");
      setError(message);
      showManualRowSaveFeedback("error", message, rowId);
    }
  };

  const updateManualRowUniqueColumn = async (nextColumn) => {
    const normalizedNextColumn = normalizeValue(nextColumn);
    setManualRowUniqueColumn(normalizedNextColumn);

    if (!id || !selectedProjectId) return;

    try {
      await setDoc(
        getConduitDocRef(id, selectedProjectId),
        {
          manualRowUniqueColumn: normalizedNextColumn,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setError("");
    } catch (saveError) {
      setError(saveError?.message || "Failed to save unique column setting.");
    }
  };

  const updateManualRowDropdownColumn = async (columnName, isEnabled) => {
    const normalizedColumnName = normalizeValue(columnName);
    if (!normalizedColumnName) return;

    const nextColumns = isEnabled
      ? Array.from(new Set([...manualRowDropdownColumns, normalizedColumnName]))
      : manualRowDropdownColumns.filter((column) => column !== normalizedColumnName);

    setManualRowDropdownColumns(nextColumns);

    if (!id || !selectedProjectId) return;

    try {
      await setDoc(
        getConduitDocRef(id, selectedProjectId),
        {
          manualRowDropdownColumns: nextColumns,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setError("");
    } catch (saveError) {
      setError(saveError?.message || "Failed to save dropdown field settings.");
    }
  };

  const deleteRow = async (rowId) => {
    if (!id || !selectedProjectId || !rowId) return;

    const nextRows = rows.filter((row) => row.__rowId !== rowId);
    setRows(nextRows);
    setManualRowValidationErrors((previousErrors) => {
      if (!previousErrors[rowId]) return previousErrors;
      const nextErrors = { ...previousErrors };
      delete nextErrors[rowId];
      return nextErrors;
    });

    try {
      await deleteDoc(doc(getRowsCollectionRef(id, selectedProjectId), String(rowId)));
      await setDoc(
        getConduitDocRef(id, selectedProjectId),
        {
          updatedAt: serverTimestamp(),
          rowCount: nextRows.length,
        },
        { merge: true }
      );
    } catch (deleteError) {
      setError(deleteError?.message || "Failed to delete row.");
    }
  };

  const openMoveRowPicker = (rowId) => {
    const fallbackTargetProjectId = availableMoveProjects[0]?.id || "";
    const hasCurrentSelection = availableMoveProjects.some(
      (project) => String(project.id) === String(rowMoveTargetProjectId)
    );

    setRowMovePickerRowId(rowId);
    setRowMoveTargetProjectId(hasCurrentSelection ? rowMoveTargetProjectId : fallbackTargetProjectId);
  };

  const moveRowToAnotherProject = async (rowId, requestedTargetProjectId) => {
    if (!id || !selectedProjectId || !rowId) return;

    const targetProjectId = normalizeValue(requestedTargetProjectId);
    if (!targetProjectId) {
      setError("Select a target project before moving this row.");
      return;
    }
    if (String(targetProjectId) === String(selectedProjectId)) {
      setError("Choose a different target project.");
      return;
    }

    const rowToMove = rows.find((row) => String(row.__rowId) === String(rowId));
    if (!rowToMove) {
      setError("Row not found.");
      return;
    }
    if (rowToMove.__isManual && rowToMove.__isDraftManual) {
      const message = "Save this manual row first, then move it to another project.";
      setError(message);
      showManualRowSaveFeedback("error", message, rowId);
      return;
    }

    setIsMovingRowId(rowId);
    setError("");

    try {
      const targetProject = projects.find((project) => String(project.id) === String(targetProjectId)) || null;
      const targetMetaRef = getConduitDocRef(id, targetProjectId);
      const targetRowsRef = getRowsCollectionRef(id, targetProjectId);

      const [targetMetaSnapshot, targetRowsSnapshot] = await Promise.all([
        getDoc(targetMetaRef),
        getDocs(targetRowsRef),
      ]);

      const targetMeta = targetMetaSnapshot.exists() ? (targetMetaSnapshot.data() || {}) : {};
      const targetStatusColumnName = normalizeValue(targetMeta.statusColumnName)
        || normalizeValue(statusColumnName)
        || "Conduit Run Status";
      const targetExistingColumns = Array.isArray(targetMeta.columns)
        ? targetMeta.columns.map((column) => normalizeValue(column)).filter(Boolean)
        : [];
      const mergedTargetColumns = Array.from(
        new Set([
          ...targetExistingColumns,
          ...columns.map((column) => normalizeValue(column)).filter(Boolean),
          targetStatusColumnName,
        ])
      );

      const movedRowValues = mergedTargetColumns.reduce((accumulator, column) => {
        accumulator[column] = normalizeValue(rowToMove?.[column]);
        return accumulator;
      }, {});

      const sourceStatusValue = normalizeValue(rowToMove?.[statusColumnName]);
      if (sourceStatusValue && !normalizeValue(movedRowValues[targetStatusColumnName])) {
        movedRowValues[targetStatusColumnName] = sourceStatusValue;
      }

      const nextTargetRowId = targetRowsSnapshot.docs.reduce((maxRowId, rowDoc) => {
        const rowData = rowDoc.data() || {};
        const candidateId = Number(rowData.rowNumber) || Number(rowDoc.id) || 0;
        return Math.max(maxRowId, candidateId);
      }, 0) + 1;

      const moveLogEntry = {
        action: "moved_in",
        movedFromProjectId: String(selectedProjectId),
        movedFromProjectName: normalizeValue(selectedProject?.name),
        movedAtIso: new Date().toISOString(),
      };
      const movedRowLogs = [
        ...(Array.isArray(rowToMove.__importLogs) ? rowToMove.__importLogs : []),
        moveLogEntry,
      ].slice(-IMPORT_LOG_LIMIT);

      const sourceRowsAfterMove = rows.filter((row) => String(row.__rowId) !== String(rowId));
      const sourceMetaRef = getConduitDocRef(id, selectedProjectId);
      const targetStatusOptions = Array.isArray(targetMeta.statusOptions) ? targetMeta.statusOptions : [];
      const mergedStatusOptions = sanitizeStatusOptions([...targetStatusOptions, ...statusOptions]);
      const targetManualRowUniqueColumn = normalizeValue(targetMeta.manualRowUniqueColumn);
      const targetManualDropdownColumns = Array.isArray(targetMeta.manualRowDropdownColumns)
        ? targetMeta.manualRowDropdownColumns.map((column) => normalizeValue(column)).filter(Boolean)
        : [];

      const moveBatch = writeBatch(db);
      moveBatch.set(
        doc(targetRowsRef, String(nextTargetRowId)),
        {
          rowNumber: nextTargetRowId,
          values: movedRowValues,
          importLogs: movedRowLogs,
          notes: Array.isArray(rowToMove.__notes) ? rowToMove.__notes : [],
          isManual: Boolean(rowToMove.__isManual),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      moveBatch.set(
        targetMetaRef,
        {
          organizationId: String(id),
          projectId: String(targetProjectId),
          projectName: normalizeValue(targetMeta.projectName) || normalizeValue(targetProject?.name),
          columns: mergedTargetColumns,
          statusColumnName: targetStatusColumnName,
          statusOptions: mergedStatusOptions,
          manualRowUniqueColumn: targetManualRowUniqueColumn,
          manualRowDropdownColumns: targetManualDropdownColumns,
          rowCount: targetRowsSnapshot.size + 1,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      moveBatch.delete(doc(getRowsCollectionRef(id, selectedProjectId), String(rowId)));
      moveBatch.set(
        sourceMetaRef,
        {
          updatedAt: serverTimestamp(),
          rowCount: sourceRowsAfterMove.length,
        },
        { merge: true }
      );

      await moveBatch.commit();

      setRows(sourceRowsAfterMove);
      setManualRowValidationErrors((previousErrors) => {
        if (!previousErrors[rowId]) return previousErrors;
        const nextErrors = { ...previousErrors };
        delete nextErrors[rowId];
        return nextErrors;
      });
      if (logModalRow?.__rowId === rowId) {
        setLogModalRow(null);
      }
      setRowMovePickerRowId(null);
      setRowMoveTargetProjectId("");
      showManualRowSaveFeedback(
        "success",
        `Row ${rowId} moved to ${normalizeValue(targetProject?.name) || "the selected project"}.`,
        rowId
      );
    } catch (moveError) {
      const message = getUserFriendlySaveErrorMessage(moveError, "Failed to move row to another project.");
      setError(message);
      showManualRowSaveFeedback("error", message, rowId);
    } finally {
      setIsMovingRowId(null);
    }
  };

  const addManualRow = async () => {
    if (!id || !selectedProjectId) {
      setError("Please select a project first.");
      return;
    }

    if (!columns.length) {
      setError("Import data first so columns exist before adding a row.");
      return;
    }

    const nextRowId = rows.length
      ? Math.max(...rows.map((row) => Number(row.__rowId) || 0)) + 1
      : 1;

    const nextRow = {
      __rowId: nextRowId,
      __importLogs: [],
      __notes: [],
      __isManual: true,
      __isDraftManual: true,
    };
    columns.forEach((column) => {
      nextRow[column] = "";
    });

    const nextRows = [...rows, nextRow].sort((left, right) => Number(left.__rowId) - Number(right.__rowId));
    setRows(nextRows);
    setError("");
    showManualRowSaveFeedback(
      "info",
      `Row ${nextRowId} added. Fill the fields, then click Save Row to persist it.`,
      nextRowId
    );
  };

  const deleteAllImportedRows = async () => {
    if (!id || !selectedProjectId) return;
    if (!rows.length) {
      setError("There are no imported rows to delete.");
      return;
    }

    const shouldDelete = window.confirm(
      `Delete all ${rows.length} imported rows for this project? This cannot be undone.`
    );
    if (!shouldDelete) return;

    setIsSaving(true);
    setError("");

    try {
      const rowsCollectionRef = getRowsCollectionRef(id, selectedProjectId);
      const existingRowsSnapshot = await getDocs(rowsCollectionRef);
      const deleteChunks = chunkArray(existingRowsSnapshot.docs, 400);

      for (const chunk of deleteChunks) {
        const deleteBatch = writeBatch(db);
        chunk.forEach((rowDoc) => {
          deleteBatch.delete(rowDoc.ref);
        });
        await deleteBatch.commit();
      }

      await setDoc(
        getConduitDocRef(id, selectedProjectId),
        {
          fileName: "",
          sheetName: "",
          columns: [],
          rowCount: 0,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setFileName("");
      setColumns([]);
      setRows([]);
      setStatusColumnName("Conduit Run Status");
    } catch (deleteError) {
      setError(deleteError?.message || "Failed to delete all imported rows.");
    } finally {
      setIsSaving(false);
    }
  };

  const renameWholeColumn = async (sourceColumnInput = columnToRename, targetColumnInput = columnRenameValue) => {
    const sourceColumn = normalizeValue(sourceColumnInput);
    const targetColumn = normalizeValue(targetColumnInput);

    if (!id || !selectedProjectId || !sourceColumn) {
      setError("Select a column to rename.");
      return;
    }

    if (!targetColumn) {
      setError("Enter the new column name.");
      return;
    }

    if (!columns.includes(sourceColumn)) {
      setError("Selected column was not found.");
      return;
    }

    if (sourceColumn === targetColumn) {
      setError("New column name must be different.");
      return;
    }

    const duplicateColumn = columns.some(
      (column) => normalizeKey(column) === normalizeKey(targetColumn) && column !== sourceColumn
    );
    if (duplicateColumn) {
      setError("A column with that name already exists.");
      return;
    }

    const shouldRename = window.confirm(
      `Rename column \"${sourceColumn}\" to \"${targetColumn}\" across all rows?`
    );
    if (!shouldRename) return;

    const nextColumns = columns.map((column) => (
      column === sourceColumn ? targetColumn : column
    ));

    const nextRows = rows.map((row) => {
      const nextRow = {
        __rowId: row.__rowId,
        __importLogs: Array.isArray(row.__importLogs) ? row.__importLogs : [],
        __notes: Array.isArray(row.__notes) ? row.__notes : [],
        __isManual: Boolean(row.__isManual),
      };

      nextColumns.forEach((column) => {
        if (column === targetColumn) {
          nextRow[column] = normalizeValue(row[sourceColumn]);
          return;
        }

        nextRow[column] = normalizeValue(row[column]);
      });

      return nextRow;
    });

    const nextStatusColumnName = sourceColumn === statusColumnName ? targetColumn : statusColumnName;

    setError("");
    setTableFilters((previousFilters) =>
      previousFilters.map((filter) => (
        normalizeValue(filter.column) === sourceColumn
          ? { ...filter, column: targetColumn }
          : filter
      ))
    );
    setImportMatchColumn((previous) => (previous === sourceColumn ? targetColumn : previous));
    setImportExistingMatchColumn((previous) => (previous === sourceColumn ? targetColumn : previous));
    setManualRowUniqueColumn((previous) => (previous === sourceColumn ? targetColumn : previous));
    setManualRowDropdownColumns((previousColumns) => previousColumns.map((column) => (
      column === sourceColumn ? targetColumn : column
    )));
    setVisibleColumns((previousColumns) => previousColumns.map((column) => (
      column === sourceColumn ? targetColumn : column
    )));

    try {
      await persistFullDataset({
        nextFileName: fileName,
        nextColumns,
        nextRows,
        nextStatusColumnName: nextStatusColumnName,
        nextSheetName: "",
        replaceExistingRows: true,
      });

      setColumns(nextColumns);
      setRows(nextRows);
      setStatusColumnName(nextStatusColumnName);
      setColumnToRename(targetColumn);
      setColumnRenameValue(targetColumn);
      setColumnToDelete((previousColumn) => (previousColumn === sourceColumn ? targetColumn : previousColumn));
    } catch (renameError) {
      setError(renameError?.message || "Failed to rename column.");
    }
  };

  const promptRenameColumn = async (sourceColumn) => {
    const targetColumn = window.prompt("Rename column:", sourceColumn);
    if (targetColumn === null) return;

    setColumnToRename(sourceColumn);
    setColumnRenameValue(targetColumn);
    await renameWholeColumn(sourceColumn, targetColumn);
  };

  const addWholeColumn = async () => {
    const targetColumn = normalizeValue(newColumnName);

    if (!id || !selectedProjectId) {
      setError("Please select a project first.");
      return;
    }

    if (!targetColumn) {
      setError("Enter a column name to add.");
      return;
    }

    const duplicateColumn = columns.some(
      (column) => normalizeKey(column) === normalizeKey(targetColumn)
    );
    if (duplicateColumn) {
      setError("A column with that name already exists.");
      return;
    }

    const nextColumns = [...columns, targetColumn];
    const nextRows = rows.map((row) => {
      const nextRow = {
        __rowId: row.__rowId,
        __importLogs: Array.isArray(row.__importLogs) ? row.__importLogs : [],
        __notes: Array.isArray(row.__notes) ? row.__notes : [],
        __isManual: Boolean(row.__isManual),
      };

      nextColumns.forEach((column) => {
        nextRow[column] = column === targetColumn ? "" : normalizeValue(row[column]);
      });

      return nextRow;
    });

    setError("");

    try {
      await persistFullDataset({
        nextFileName: fileName,
        nextColumns,
        nextRows,
        nextStatusColumnName: statusColumnName,
        nextSheetName: "",
        replaceExistingRows: true,
      });

      setColumns(nextColumns);
      setRows(nextRows);
      setVisibleColumns((previousColumns) => {
        const baseColumns = previousColumns.length ? previousColumns : columns;
        return [...baseColumns, targetColumn];
      });
      setColumnToRename(targetColumn);
      setColumnRenameValue(targetColumn);
      setNewColumnName("");
    } catch (addError) {
      setError(addError?.message || "Failed to add column.");
    }
  };

  const deleteWholeColumn = async () => {
    const targetColumn = normalizeValue(columnToDelete);
    if (!id || !selectedProjectId || !targetColumn) {
      setError("Select a column to delete.");
      return;
    }

    if (normalizeKey(targetColumn) === normalizeKey(statusColumnName)) {
      setError("Conduit Run Status column cannot be deleted.");
      return;
    }

    if (!columns.includes(targetColumn)) {
      setError("Selected column was not found.");
      return;
    }

    const shouldDelete = window.confirm(
      `Delete the entire column \"${targetColumn}\" from all rows? This cannot be undone.`
    );
    if (!shouldDelete) return;

    const nextColumns = columns.filter((column) => column !== targetColumn);
    const nextRows = rows.map((row) => {
      const nextRow = {
        __rowId: row.__rowId,
        __importLogs: Array.isArray(row.__importLogs) ? row.__importLogs : [],
        __notes: Array.isArray(row.__notes) ? row.__notes : [],
        __isManual: Boolean(row.__isManual),
      };

      nextColumns.forEach((column) => {
        nextRow[column] = normalizeValue(row[column]);
      });

      return nextRow;
    });

    setError("");
    setTableFilters((previousFilters) =>
      previousFilters.map((filter) => (
        normalizeValue(filter.column) === targetColumn
          ? { ...filter, column: "", value: "" }
          : filter
      ))
    );
    setVisibleColumns((previousColumns) => {
      const nextColumns = previousColumns.filter((column) => column !== targetColumn);
      return nextColumns.length ? nextColumns : columns.filter((column) => column !== targetColumn);
    });
    setManualRowUniqueColumn((previous) => (previous === targetColumn ? "" : previous));
    setManualRowDropdownColumns((previousColumns) => previousColumns.filter((column) => column !== targetColumn));

    try {
      await persistFullDataset({
        nextFileName: fileName,
        nextColumns,
        nextRows,
        nextStatusColumnName: statusColumnName,
        nextSheetName: "",
        replaceExistingRows: true,
      });

      setColumns(nextColumns);
      setRows(nextRows);
      setColumnToDelete(nextColumns.find((column) => column !== statusColumnName) || "");
    } catch (deleteError) {
      setError(deleteError?.message || "Failed to delete column.");
    }
  };

  const exportUpdatedWorkbook = () => {
    if (!rows.length || !columns.length) return;

    const exportRows = rows.map((row) =>
      columns.reduce((accumulator, column) => {
        accumulator[column] = normalizeValue(row[column]);
        return accumulator;
      }, {})
    );

    const exportSheet = XLSX.utils.json_to_sheet(exportRows, {
      header: columns,
      skipHeader: false,
    });

    const exportBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(exportBook, exportSheet, "Conduit Run Counter");

    const safeBaseName = (fileName || "conduit-run-counter").replace(/\.[^.]+$/, "");
    XLSX.writeFile(exportBook, `${safeBaseName}-updated.xlsx`);
  };

  const closeLogModal = () => {
    setLogModalRow(null);
    setLogNoteDraft("");
    setIsSavingLogNote(false);
  };

  const addNoteToLogRow = async () => {
    const noteText = normalizeValue(logNoteDraft);
    if (!activeLogRow?.__rowId) return;
    if (!noteText) {
      setError("Type a note before saving.");
      return;
    }

    const nextNote = {
      text: noteText,
      createdAtIso: new Date().toISOString(),
      createdBy: userIdentity,
    };

    const existingNotes = Array.isArray(activeLogRow.__notes) ? activeLogRow.__notes : [];
    const nextNotes = [...existingNotes, nextNote].slice(-ROW_NOTE_LIMIT);

    setIsSavingLogNote(true);
    setError("");

    setRows((currentRows) =>
      currentRows.map((row) => (
        row.__rowId === activeLogRow.__rowId
          ? { ...row, __notes: nextNotes }
          : row
      ))
    );
    setLogModalRow((previousRow) => (
      previousRow && previousRow.__rowId === activeLogRow.__rowId
        ? { ...previousRow, __notes: nextNotes }
        : previousRow
    ));

    try {
      await setDoc(
        doc(getRowsCollectionRef(id, selectedProjectId), String(activeLogRow.__rowId)),
        {
          rowNumber: Number(activeLogRow.__rowId),
          notes: nextNotes,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      await setDoc(
        getConduitDocRef(id, selectedProjectId),
        {
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setLogNoteDraft("");
    } catch (noteError) {
      setError(noteError?.message || "Failed to save note.");
    } finally {
      setIsSavingLogNote(false);
    }
  };

  const getFilterValueOptions = (column) => {
    if (!column) return [];
    return Array.from(new Set(rows.map((row) => normalizeValue(row[column])).filter(Boolean))).sort((left, right) => left.localeCompare(right));
  };

  const updateTableFilter = (filterId, updates) => {
    setTableFilters((previousFilters) => previousFilters.map((filter) => {
      if (filter.id !== filterId) return filter;
      return {
        ...filter,
        ...updates,
      };
    }));
  };

  const clearTableFilter = (filterId) => {
    setTableFilters((previousFilters) => previousFilters.map((filter) => {
      if (filter.id !== filterId) return filter;
      return {
        ...filter,
        column: "",
        operator: "equals",
        value: "",
      };
    }));
  };

  const addTableFilterGroup = () => {
    setTableFilters((previousFilters) => {
      if (previousFilters.length >= MAX_TABLE_FILTER_LEVELS) {
        return previousFilters;
      }
      return [...previousFilters, createTableFilter()];
    });
  };

  const removeTableFilter = (filterId) => {
    setTableFilters((previousFilters) => previousFilters.filter((filter) => filter.id !== filterId));
  };

  const clearAllTableFilters = () => {
    setTableFilters([]);
  };

  const moveVisibleColumn = (columnName, direction) => {
    setVisibleColumns((previousColumns) => {
      const normalizedColumns = columns.map((column) => normalizeValue(column)).filter(Boolean);
      const validPreviousColumns = previousColumns.filter((column) => normalizedColumns.includes(column));
      const currentOrder = validPreviousColumns.length ? validPreviousColumns : normalizedColumns;
      const currentIndex = currentOrder.indexOf(columnName);

      if (currentIndex < 0) return currentOrder;

      const targetIndex = currentIndex + direction;
      if (targetIndex < 0 || targetIndex >= currentOrder.length) return currentOrder;

      const nextOrder = [...currentOrder];
      [nextOrder[currentIndex], nextOrder[targetIndex]] = [nextOrder[targetIndex], nextOrder[currentIndex]];
      return nextOrder;
    });
  };

  const resetVisibleColumnOrder = () => {
    setVisibleColumns(columns.map((column) => normalizeValue(column)).filter(Boolean));
  };

  const isColumnVisible = (columnName) => displayedColumns.includes(columnName);

  const toggleColumnVisibility = (columnName) => {
    setVisibleColumns((previousColumns) => {
      const normalizedColumns = columns.map((column) => normalizeValue(column)).filter(Boolean);
      const validPreviousColumns = previousColumns.filter((column) => normalizedColumns.includes(column));
      const currentOrder = validPreviousColumns.length ? validPreviousColumns : normalizedColumns;
      const currentlyVisible = currentOrder.includes(columnName);

      if (currentlyVisible) {
        if (currentOrder.length <= 1) {
          setError("At least one column must remain visible.");
          return currentOrder;
        }
        return currentOrder.filter((column) => column !== columnName);
      }

      const insertIndex = normalizedColumns.indexOf(columnName);
      if (insertIndex < 0) return currentOrder;

      const nextOrder = [...currentOrder];
      const priorVisibleColumn = [...normalizedColumns]
        .slice(0, insertIndex)
        .reverse()
        .find((column) => nextOrder.includes(column));

      if (!priorVisibleColumn) {
        return [columnName, ...nextOrder];
      }

      const priorVisibleIndex = nextOrder.indexOf(priorVisibleColumn);
      nextOrder.splice(priorVisibleIndex + 1, 0, columnName);
      return nextOrder;
    });
  };

  const moveVisibleColumnBefore = (sourceColumn, targetColumn) => {
    if (!sourceColumn || !targetColumn || sourceColumn === targetColumn) return;

    setVisibleColumns((previousColumns) => {
      const normalizedColumns = columns.map((column) => normalizeValue(column)).filter(Boolean);
      const validPreviousColumns = previousColumns.filter((column) => normalizedColumns.includes(column));
      const currentOrder = validPreviousColumns.length ? validPreviousColumns : normalizedColumns;
      const sourceIndex = currentOrder.indexOf(sourceColumn);
      const targetIndex = currentOrder.indexOf(targetColumn);

      if (sourceIndex < 0 || targetIndex < 0) return currentOrder;

      const nextOrder = [...currentOrder];
      const [movedColumn] = nextOrder.splice(sourceIndex, 1);
      const adjustedTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
      nextOrder.splice(adjustedTargetIndex, 0, movedColumn);
      return nextOrder;
    });
  };

  const renderVisibleColumnOrderControl = (contextKey) => (
    <div
      style={{
        border: "1px solid #d1d5db",
        borderRadius: "10px",
        background: "#f9fafb",
        padding: "8px",
        minWidth: "280px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "8px",
          marginBottom: "8px",
        }}
      >
        <strong style={{ fontSize: "12px", color: "#111827" }}>Visible Column Order</strong>
        <button
          type="button"
          onClick={resetVisibleColumnOrder}
          style={{
            border: "1px solid #d1d5db",
            borderRadius: "6px",
            padding: "4px 8px",
            background: "#ffffff",
            color: "#111827",
            cursor: "pointer",
            fontSize: "12px",
            fontWeight: 700,
          }}
        >
          Reset Order
        </button>
      </div>

      <div style={{ fontSize: "12px", color: "#4b5563", marginBottom: "8px" }}>
        Reorder columns visually in the horizontal header preview below.
      </div>

      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: "10px",
          background: "#ffffff",
          padding: "8px",
          marginBottom: "10px",
        }}
      >
        <div style={{ fontSize: "12px", fontWeight: 700, color: "#111827", marginBottom: "8px" }}>
          Header Preview (left to right)
        </div>

        <div
          style={{
            display: "flex",
            gap: "6px",
            overflowX: "auto",
            paddingBottom: "4px",
          }}
        >
          {displayedColumns.map((column, index) => {
            const visible = isColumnVisible(column);
            const isFirst = index === 0;
            const isLast = index === displayedColumns.length - 1;
            const isDraggingThis = draggingVisibleColumn === column;
            const isDropTarget = visibleColumnDropTarget === column && draggingVisibleColumn !== column;

            return (
              <div
                key={`${contextKey}-header-preview-${column}`}
                draggable
                onDragStart={() => {
                  setDraggingVisibleColumn(column);
                  setVisibleColumnDropTarget("");
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (draggingVisibleColumn && draggingVisibleColumn !== column) {
                    setVisibleColumnDropTarget(column);
                  }
                }}
                onDragLeave={() => {
                  if (visibleColumnDropTarget === column) {
                    setVisibleColumnDropTarget("");
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  moveVisibleColumnBefore(draggingVisibleColumn, column);
                  setDraggingVisibleColumn("");
                  setVisibleColumnDropTarget("");
                }}
                onDragEnd={() => {
                  setDraggingVisibleColumn("");
                  setVisibleColumnDropTarget("");
                }}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto auto",
                  alignItems: "center",
                  gap: "4px",
                  border: `1px solid ${isDropTarget ? "#93c5fd" : "#d1d5db"}`,
                  borderRadius: "8px",
                  padding: "6px 8px",
                  background: isDropTarget ? "#eff6ff" : (visible ? "#f9fafb" : "#f3f4f6"),
                  fontSize: "12px",
                  whiteSpace: "nowrap",
                  opacity: isDraggingThis ? 0.55 : 1,
                  cursor: "grab",
                  minWidth: "170px",
                }}
              >
                <span style={{ maxWidth: "140px", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {column}
                </span>
                <button
                  type="button"
                  onClick={() => toggleColumnVisibility(column)}
                  title={visible ? "Hide column" : "Show column"}
                  style={{
                    border: "1px solid #d1d5db",
                    borderRadius: "6px",
                    padding: "2px 6px",
                    background: "#ffffff",
                    color: visible ? "#111827" : "#9ca3af",
                    cursor: "pointer",
                    fontWeight: 700,
                  }}
                >
                  {visible ? "O" : "X"}
                </button>
                <button
                  type="button"
                  disabled={isFirst}
                  onClick={() => moveVisibleColumn(column, -1)}
                  style={{
                    border: "1px solid #d1d5db",
                    borderRadius: "6px",
                    padding: "2px 6px",
                    background: isFirst ? "#f3f4f6" : "#ffffff",
                    color: isFirst ? "#9ca3af" : "#111827",
                    cursor: isFirst ? "not-allowed" : "pointer",
                    fontWeight: 700,
                  }}
                >
                  ←
                </button>
                <button
                  type="button"
                  disabled={isLast}
                  onClick={() => moveVisibleColumn(column, 1)}
                  style={{
                    border: "1px solid #d1d5db",
                    borderRadius: "6px",
                    padding: "2px 6px",
                    background: isLast ? "#f3f4f6" : "#ffffff",
                    color: isLast ? "#9ca3af" : "#111827",
                    cursor: isLast ? "not-allowed" : "pointer",
                    fontWeight: 700,
                  }}
                >
                  →
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "220px", overflowY: "auto" }}>
        {settingsColumnOrder.map((column, index) => {
          const visible = isColumnVisible(column);
          const isFirst = index === 0;
          const isLast = index === settingsColumnOrder.length - 1;
          const isDraggingThis = draggingVisibleColumn === column;
          const isDropTarget = visibleColumnDropTarget === column && draggingVisibleColumn !== column;

          return (
            <div
              key={`${contextKey}-visible-order-${column}`}
              draggable
              onDragStart={() => {
                setDraggingVisibleColumn(column);
                setVisibleColumnDropTarget("");
              }}
              onDragOver={(event) => {
                event.preventDefault();
                if (draggingVisibleColumn && draggingVisibleColumn !== column) {
                  setVisibleColumnDropTarget(column);
                }
              }}
              onDragLeave={() => {
                if (visibleColumnDropTarget === column) {
                  setVisibleColumnDropTarget("");
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                moveVisibleColumnBefore(draggingVisibleColumn, column);
                setDraggingVisibleColumn("");
                setVisibleColumnDropTarget("");
              }}
              onDragEnd={() => {
                setDraggingVisibleColumn("");
                setVisibleColumnDropTarget("");
              }}
              style={{
                display: "grid",
                gridTemplateColumns: "24px 1fr auto auto auto",
                alignItems: "center",
                gap: "6px",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                padding: "6px 8px",
                background: isDropTarget ? "#eff6ff" : (visible ? "#ffffff" : "#f3f4f6"),
                fontSize: "13px",
                color: "#111827",
                opacity: isDraggingThis ? 0.55 : 1,
                cursor: "grab",
              }}
            >
              <span style={{ color: "#9ca3af", fontWeight: 700, textAlign: "center" }}>
                ::
              </span>
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {column}
              </span>
              <button
                type="button"
                onClick={() => toggleColumnVisibility(column)}
                title={visible ? "Hide column" : "Show column"}
                style={{
                  border: "1px solid #d1d5db",
                  borderRadius: "6px",
                  padding: "2px 8px",
                  background: "#ffffff",
                  color: visible ? "#111827" : "#9ca3af",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                  {visible ? "O" : "X"}
              </button>
              <button
                type="button"
                disabled={isFirst}
                onClick={() => moveVisibleColumn(column, -1)}
                style={{
                  border: "1px solid #d1d5db",
                  borderRadius: "6px",
                  padding: "2px 8px",
                  background: isFirst ? "#f3f4f6" : "#ffffff",
                  color: isFirst ? "#9ca3af" : "#111827",
                  cursor: isFirst ? "not-allowed" : "pointer",
                  fontWeight: 700,
                }}
              >
                Up
              </button>
              <button
                type="button"
                disabled={isLast}
                onClick={() => moveVisibleColumn(column, 1)}
                style={{
                  border: "1px solid #d1d5db",
                  borderRadius: "6px",
                  padding: "2px 8px",
                  background: isLast ? "#f3f4f6" : "#ffffff",
                  color: isLast ? "#9ca3af" : "#111827",
                  cursor: isLast ? "not-allowed" : "pointer",
                  fontWeight: 700,
                }}
              >
                Down
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );

  const addStatusOption = async () => {
    const sanitizedNewStatus = normalizeValue(newStatusInput);
    if (!sanitizedNewStatus) {
      setError("Status name cannot be empty.");
      return;
    }

    const alreadyExists = statusOptions.some(
      (status) => normalizeStatusKey(status) === normalizeStatusKey(sanitizedNewStatus)
    );
    if (alreadyExists) {
      setError("That status already exists.");
      return;
    }

    const nextStatusOptions = sanitizeStatusOptions([...statusOptions, sanitizedNewStatus]);
    setStatusOptions(nextStatusOptions);
    setNewStatusInput("");
    setError("");

    try {
      await persistStatusOptions(nextStatusOptions);
    } catch (saveError) {
      setError(saveError?.message || "Failed to save status options.");
    }
  };

  const startInlineStatusEdit = (statusValue) => {
    setEditingStatusOriginal(statusValue);
    setEditingStatusDraft(statusValue);
    setPendingDeleteStatus("");
    setDeleteReplacementStatus("");
    setError("");
  };

  const cancelInlineStatusEdit = () => {
    setEditingStatusOriginal("");
    setEditingStatusDraft("");
  };

  const saveInlineStatusEdit = async () => {
    const previousStatus = normalizeValue(editingStatusOriginal);
    const nextStatusName = normalizeValue(editingStatusDraft);

    if (!previousStatus) {
      cancelInlineStatusEdit();
      return;
    }

    if (!nextStatusName) {
      setError("Status name cannot be empty.");
      return;
    }

    if (normalizeStatusKey(nextStatusName) === normalizeStatusKey(previousStatus)) {
      return;
    }

    const duplicate = statusOptions.some(
      (status) => normalizeStatusKey(status) === normalizeStatusKey(nextStatusName)
    );
    if (duplicate) {
      setError("That status already exists.");
      return;
    }

    const nextStatusOptions = sanitizeStatusOptions(
      statusOptions.map((status) =>
        normalizeStatusKey(status) === normalizeStatusKey(previousStatus)
          ? nextStatusName
          : status
      )
    );

    const nextRows = rows.map((row) => {
      const currentStatus = normalizeValue(row[statusColumnName]);
      if (normalizeStatusKey(currentStatus) !== normalizeStatusKey(previousStatus)) {
        return row;
      }

      return {
        ...row,
        [statusColumnName]: nextStatusName,
      };
    });

    setRows(nextRows);
    setStatusOptions(nextStatusOptions);
    setError("");
    cancelInlineStatusEdit();

    try {
      await persistFullDataset({
        nextFileName: fileName,
        nextColumns: columns,
        nextRows,
        nextStatusColumnName: statusColumnName,
        nextSheetName: "",
      });
      await persistStatusOptions(nextStatusOptions);
    } catch (saveError) {
      setError(saveError?.message || "Failed to rename status.");
    }
  };

  const requestStatusDelete = (statusToRemove) => {
    const usageCount = getStatusUsageCount(statusToRemove);
    setEditingStatusOriginal("");
    setEditingStatusDraft("");

    if (usageCount > 0) {
      setPendingDeleteStatus(statusToRemove);
      setDeleteReplacementStatus("");
      setError("");
      return;
    }

    removeStatusOption(statusToRemove, "");
  };

  const cancelStatusDelete = () => {
    setPendingDeleteStatus("");
    setDeleteReplacementStatus("");
  };

  const removeStatusOption = async (statusToRemove, replacementStatus = "") => {
    if (statusOptions.length <= 1) {
      setError("At least one status option is required.");
      return;
    }

    const usageCount = getStatusUsageCount(statusToRemove);
    const replacementStatusName = normalizeValue(replacementStatus);
    const isReplacementRequired = usageCount > 0;

    if (isReplacementRequired && !replacementStatusName) {
      setError("Please choose a replacement status for rows using this value.");
      return;
    }

    if (
      replacementStatusName
      && normalizeStatusKey(replacementStatusName) === normalizeStatusKey(statusToRemove)
    ) {
      setError("Replacement status must be different from the deleted status.");
      return;
    }

    const nextStatusOptions = statusOptions.filter(
      (status) => normalizeStatusKey(status) !== normalizeStatusKey(statusToRemove)
    );
    if (!nextStatusOptions.length) {
      setError("At least one status option is required.");
      return;
    }

    const nextRows = isReplacementRequired
      ? rows.map((row) => {
          const currentStatus = normalizeValue(row[statusColumnName]);
          if (normalizeStatusKey(currentStatus) !== normalizeStatusKey(statusToRemove)) {
            return row;
          }
          return {
            ...row,
            [statusColumnName]: replacementStatusName,
          };
        })
      : rows;

    setRows(nextRows);
    setStatusOptions(nextStatusOptions);
    cancelStatusDelete();
    setError("");

    try {
      if (isReplacementRequired) {
        await persistFullDataset({
          nextFileName: fileName,
          nextColumns: columns,
          nextRows,
          nextStatusColumnName: statusColumnName,
          nextSheetName: "",
        });
      }
      await persistStatusOptions(nextStatusOptions);
    } catch (saveError) {
      setError(saveError?.message || "Failed to remove status.");
    }
  };

  return (
    <div style={{ minHeight: "100vh", ...commonStyles.mainGradient }}>
      <ChurchHeader id={id} applyShadow={false} showOrganizationName={false} />

      <div
        style={{
          width: "100vw",
          maxWidth: "100vw",
          marginLeft: "calc(50% - 50vw)",
          marginRight: "calc(50% - 50vw)",
          padding: "24px clamp(12px, 2vw, 24px)",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: "28px", fontWeight: 700 }}>Conduit Run Counter</h1>
            <p style={{ margin: "8px 0 0", color: "#4b5563" }}>
              Select a project, import Excel, view every column, and update status per line item.
            </p>
          </div>
          <Link
            to={`${routePrefix}/${id}/mi-organizacion`}
            style={{
              textDecoration: "none",
              background: "#111827",
              color: "#ffffff",
              borderRadius: "10px",
              padding: "10px 14px",
              fontWeight: 600,
            }}
          >
            Back to Mi Organizacion
          </Link>
        </div>

        <div
          style={{
            background: "#ffffff",
            borderRadius: "14px",
            border: "1px solid #e5e7eb",
            padding: "16px",
            marginBottom: "16px",
          }}
        >
          <div style={{ marginBottom: "8px", fontSize: "13px", fontWeight: 700, color: "#374151" }}>
            Step 1: Select a project before importing or updating conduit run statuses.
          </div>

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <label style={{ fontSize: "12px", fontWeight: 700, color: "#374151" }}>
                Project
              </label>
              <select
                value={selectedProjectId}
                onChange={(event) => setSelectedProjectId(event.target.value)}
                disabled={isLoadingProjects || isUploading || isSaving}
                style={{
                  minWidth: "260px",
                  border: "1px solid #d1d5db",
                  borderRadius: "10px",
                  padding: "10px 12px",
                }}
              >
                <option value="">
                  {isLoadingProjects ? "Loading projects..." : "Select Project"}
                </option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>

            <div
              style={{
                display: "inline-flex",
                border: "1px solid #d1d5db",
                borderRadius: "10px",
                overflow: "hidden",
                marginLeft: "auto",
              }}
            >
              <button
                type="button"
                onClick={() => setActiveMainTab(MAIN_TABS.DATA)}
                style={{
                  border: "none",
                  borderRight: "1px solid #d1d5db",
                  padding: "10px 12px",
                  background: activeMainTab === MAIN_TABS.DATA ? "#111827" : "#ffffff",
                  color: activeMainTab === MAIN_TABS.DATA ? "#ffffff" : "#111827",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Data Table
              </button>
              <button
                type="button"
                onClick={() => setActiveMainTab(MAIN_TABS.IMPORT)}
                style={{
                  border: "none",
                  borderRight: "1px solid #d1d5db",
                  padding: "10px 12px",
                  background: activeMainTab === MAIN_TABS.IMPORT ? "#111827" : "#ffffff",
                  color: activeMainTab === MAIN_TABS.IMPORT ? "#ffffff" : "#111827",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Import
              </button>
              <button
                type="button"
                onClick={() => setActiveMainTab(MAIN_TABS.STATUS)}
                style={{
                  border: "none",
                  borderRight: "1px solid #d1d5db",
                  padding: "10px 12px",
                  background: activeMainTab === MAIN_TABS.STATUS ? "#111827" : "#ffffff",
                  color: activeMainTab === MAIN_TABS.STATUS ? "#ffffff" : "#111827",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Manage Status
              </button>
              <button
                type="button"
                onClick={() => setActiveMainTab(MAIN_TABS.SETTINGS)}
                style={{
                  border: "none",
                  borderRight: "1px solid #d1d5db",
                  padding: "10px 12px",
                  background: activeMainTab === MAIN_TABS.SETTINGS ? "#111827" : "#ffffff",
                  color: activeMainTab === MAIN_TABS.SETTINGS ? "#ffffff" : "#111827",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Settings
              </button>
              <button
                type="button"
                onClick={exportUpdatedWorkbook}
                disabled={!rows.length || !selectedProjectId}
                style={{
                  border: "none",
                  borderRight: "1px solid #d1d5db",
                  padding: "10px 12px",
                  background: "#ffffff",
                  color: !rows.length || !selectedProjectId ? "#9ca3af" : "#111827",
                  fontWeight: 700,
                  cursor: !rows.length || !selectedProjectId ? "not-allowed" : "pointer",
                }}
              >
                Export Updated File
              </button>
              <button
                type="button"
                onClick={addManualRow}
                disabled={!selectedProjectId || !columns.length || isSaving}
                style={{
                  border: "none",
                  borderRight: "1px solid #d1d5db",
                  padding: "10px 12px",
                  background: "#ffffff",
                  color: !selectedProjectId || !columns.length || isSaving ? "#9ca3af" : "#0f766e",
                  fontWeight: 700,
                  cursor: !selectedProjectId || !columns.length || isSaving ? "not-allowed" : "pointer",
                }}
                title={!columns.length ? "Import columns first, then add a row." : "Add a manual row"}
              >
                Add Row
              </button>
              <Link
                to={`${routePrefix}/${id}/project-lists-issues`}
                style={{
                  textDecoration: "none",
                  border: "none",
                  padding: "10px 12px",
                  background: "#ffffff",
                  color: "#111827",
                  fontWeight: 700,
                  display: "inline-flex",
                  alignItems: "center",
                }}
              >
                Open Project Lists & Issues
              </Link>
            </div>

            {activeMainTab === MAIN_TABS.IMPORT ? (
              <>

                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: "#374151" }}>
                    Import File
                  </label>
                  <label
                    htmlFor="conduit-run-file"
                    style={{
                      background: isSaving ? "#6b7280" : "#0f766e",
                      color: "#ffffff",
                      borderRadius: "10px",
                      padding: "10px 14px",
                      cursor: isSaving || !selectedProjectId ? "not-allowed" : "pointer",
                      fontWeight: 600,
                    }}
                  >
                    {isUploading ? "Uploading..." : isSaving ? "Saving..." : "Import Excel File"}
                  </label>
                  <input
                    id="conduit-run-file"
                    type="file"
                    onChange={handleFileUpload}
                    style={{ display: "none" }}
                    disabled={isUploading || isSaving || !selectedProjectId}
                  />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: "#374151" }}>
                    Confirm
                  </label>
                  <button
                    type="button"
                    onClick={confirmImportPreview}
                    disabled={!canConfirmPreviewImport || isSaving}
                    style={{
                      border: "none",
                      borderRadius: "10px",
                      padding: "10px 14px",
                      background: canConfirmPreviewImport && !isSaving ? "#065f46" : "#9ca3af",
                      color: "#ffffff",
                      cursor: canConfirmPreviewImport && !isSaving ? "pointer" : "not-allowed",
                      fontWeight: 600,
                    }}
                  >
                    Confirm Import
                  </button>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: "#374151" }}>
                    Preview
                  </label>
                  <button
                    type="button"
                    onClick={clearPreview}
                    disabled={!hasPreview || isSaving}
                    style={{
                      border: "1px solid #d1d5db",
                      borderRadius: "10px",
                      padding: "10px 14px",
                      background: "#ffffff",
                      color: hasPreview && !isSaving ? "#111827" : "#9ca3af",
                      cursor: hasPreview && !isSaving ? "pointer" : "not-allowed",
                      fontWeight: 600,
                    }}
                  >
                    Cancel Preview
                  </button>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: "#374151" }}>
                    Import Mode
                  </label>
                  <select
                    value={importMode}
                    onChange={(event) => setImportMode(event.target.value)}
                    disabled={isSaving || isUploading}
                    style={{
                      border: "1px solid #d1d5db",
                      borderRadius: "10px",
                      padding: "10px 12px",
                      minWidth: "260px",
                    }}
                  >
                    <option value={IMPORT_MODES.REPLACE}>Replace Existing Rows</option>
                    <option value={IMPORT_MODES.ADD_UPDATE}>Add/Update Rows + Columns</option>
                  </select>
                </div>

                {importMode === IMPORT_MODES.ADD_UPDATE ? (
                  <>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <label style={{ fontSize: "12px", fontWeight: 700, color: "#374151" }}>
                        Incoming Match Column
                      </label>
                      <select
                        value={importMatchColumn}
                        onChange={(event) => setImportMatchColumn(event.target.value)}
                        style={{
                          border: "1px solid #d1d5db",
                          borderRadius: "10px",
                          padding: "10px 12px",
                          minWidth: "260px",
                        }}
                      >
                        <option value="">Select incoming column</option>
                        {previewColumns.map((column) => (
                          <option key={`match-column-${column}`} value={column}>
                            {column}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <label style={{ fontSize: "12px", fontWeight: 700, color: "#374151" }}>
                        Existing Match Column
                      </label>
                      <select
                        value={importExistingMatchColumn}
                        onChange={(event) => setImportExistingMatchColumn(event.target.value)}
                        style={{
                          border: "1px solid #d1d5db",
                          borderRadius: "10px",
                          padding: "10px 12px",
                          minWidth: "260px",
                        }}
                      >
                        <option value="">Select existing column</option>
                        {columns.map((column) => (
                          <option key={`existing-match-column-${column}`} value={column}>
                            {column}
                          </option>
                        ))}
                      </select>
                    </div>

                    <span style={{ fontSize: "12px", color: "#4b5563", fontWeight: 600 }}>
                      Matched rows update all other imported columns; non-matching rows are not added.
                    </span>
                  </>
                ) : null}
              </>
            ) : null}


          </div>

          {activeMainTab === MAIN_TABS.STATUS ? (
            <div
              style={{
                marginTop: "12px",
                display: "flex",
                gap: "10px",
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <strong style={{ color: "#111827" }}>Manage Conduit Run Status:</strong>
              <input
                type="text"
                value={newStatusInput}
                onChange={(event) => setNewStatusInput(event.target.value)}
                placeholder="Add new status"
                style={{
                  border: "1px solid #d1d5db",
                  borderRadius: "10px",
                  padding: "8px 10px",
                  minWidth: "220px",
                }}
              />
              <button
                type="button"
                onClick={addStatusOption}
                disabled={!selectedProjectId || isSaving}
                style={{
                  border: "none",
                  borderRadius: "10px",
                  padding: "8px 12px",
                  background: !selectedProjectId || isSaving ? "#9ca3af" : "#0f766e",
                  color: "#ffffff",
                  cursor: !selectedProjectId || isSaving ? "not-allowed" : "pointer",
                  fontWeight: 700,
                }}
              >
                Add Status
              </button>

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {statusOptions.map((status) => (
                  <div
                    key={status}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      border: "1px solid #d1d5db",
                      borderRadius: "999px",
                      padding: "6px 10px",
                      background: "#ffffff",
                    }}
                  >
                    {normalizeStatusKey(editingStatusOriginal) === normalizeStatusKey(status) ? (
                      <>
                        <input
                          type="text"
                          value={editingStatusDraft}
                          onChange={(event) => setEditingStatusDraft(event.target.value)}
                          style={{
                            border: "1px solid #d1d5db",
                            borderRadius: "8px",
                            padding: "4px 8px",
                            minWidth: "140px",
                            fontSize: "13px",
                            fontWeight: 600,
                          }}
                        />
                        <button
                          type="button"
                          onClick={saveInlineStatusEdit}
                          style={{
                            border: "none",
                            borderRadius: "6px",
                            padding: "4px 6px",
                            background: "#dcfce7",
                            color: "#166534",
                            cursor: "pointer",
                            fontSize: "12px",
                            fontWeight: 700,
                          }}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={cancelInlineStatusEdit}
                          style={{
                            border: "none",
                            borderRadius: "6px",
                            padding: "4px 6px",
                            background: "#e5e7eb",
                            color: "#111827",
                            cursor: "pointer",
                            fontSize: "12px",
                            fontWeight: 700,
                          }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <span style={{ fontSize: "13px", fontWeight: 600 }}>{status}</span>
                        <button
                          type="button"
                          onClick={() => startInlineStatusEdit(status)}
                          style={{
                            border: "none",
                            borderRadius: "6px",
                            padding: "4px 6px",
                            background: "#dbeafe",
                            color: "#1d4ed8",
                            cursor: "pointer",
                            fontSize: "12px",
                            fontWeight: 700,
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => requestStatusDelete(status)}
                          style={{
                            border: "none",
                            borderRadius: "6px",
                            padding: "4px 6px",
                            background: "#fee2e2",
                            color: "#b91c1c",
                            cursor: "pointer",
                            fontSize: "12px",
                            fontWeight: 700,
                          }}
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>

              {pendingDeleteStatus ? (
                <div
                  style={{
                    width: "100%",
                    border: "1px solid #fde68a",
                    background: "#fffbeb",
                    borderRadius: "10px",
                    padding: "10px 12px",
                    display: "flex",
                    gap: "10px",
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#92400e" }}>
                    "{pendingDeleteStatus}" is used in {getStatusUsageCount(pendingDeleteStatus)} row(s). Choose a replacement before deleting.
                  </span>
                  <select
                    value={deleteReplacementStatus}
                    onChange={(event) => setDeleteReplacementStatus(event.target.value)}
                    style={{
                      minWidth: "220px",
                      border: "1px solid #d1d5db",
                      borderRadius: "8px",
                      padding: "8px 10px",
                    }}
                  >
                    <option value="">Select replacement status</option>
                    {statusOptions
                      .filter(
                        (status) => normalizeStatusKey(status) !== normalizeStatusKey(pendingDeleteStatus)
                      )
                      .map((status) => (
                        <option key={`replace-${status}`} value={status}>
                          {status}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeStatusOption(pendingDeleteStatus, deleteReplacementStatus)}
                    style={{
                      border: "none",
                      borderRadius: "8px",
                      padding: "8px 10px",
                      background: "#b91c1c",
                      color: "#ffffff",
                      cursor: "pointer",
                      fontWeight: 700,
                    }}
                  >
                    Confirm Delete
                  </button>
                  <button
                    type="button"
                    onClick={cancelStatusDelete}
                    style={{
                      border: "1px solid #d1d5db",
                      borderRadius: "8px",
                      padding: "8px 10px",
                      background: "#ffffff",
                      color: "#111827",
                      cursor: "pointer",
                      fontWeight: 700,
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {activeMainTab === MAIN_TABS.SETTINGS ? (
            <div
              style={{
                marginTop: "12px",
                background: "#ffffff",
                border: "1px solid #e5e7eb",
                borderRadius: "12px",
                padding: "12px",
                display: "flex",
                gap: "10px",
                flexWrap: "wrap",
                alignItems: "end",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "12px", fontWeight: 700, color: "#374151" }}>
                  New Row Unique Column
                </label>
                <select
                  value={manualRowUniqueColumn}
                  onChange={(event) => updateManualRowUniqueColumn(event.target.value)}
                  disabled={!selectedProjectId || !columns.length || isSaving}
                  style={{
                    minWidth: "280px",
                    border: "1px solid #d1d5db",
                    borderRadius: "8px",
                    padding: "8px 10px",
                  }}
                >
                  <option value="">No unique column requirement</option>
                  {columns.map((column) => (
                    <option key={`manual-row-unique-${column}`} value={column}>
                      {column}
                    </option>
                  ))}
                </select>
                <span style={{ fontSize: "12px", color: "#6b7280", fontWeight: 600 }}>
                  Applies to every new row. A manual row saves only when this column value is unique. A * marks the required unique field in the table.
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: "320px" }}>
                <label style={{ fontSize: "12px", fontWeight: 700, color: "#374151" }}>
                  Manual Row Searchable Dropdown Fields
                </label>
                <div
                  style={{
                    border: "1px solid #d1d5db",
                    borderRadius: "8px",
                    padding: "8px 10px",
                    maxHeight: "140px",
                    overflowY: "auto",
                    background: "#ffffff",
                  }}
                >
                  {columns.filter((column) => column !== statusColumnName).length ? (
                    columns
                      .filter((column) => column !== statusColumnName)
                      .map((column) => {
                        const isChecked = manualRowDropdownColumns.includes(column);

                        return (
                          <label
                            key={`manual-dropdown-column-${column}`}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              fontSize: "13px",
                              color: "#111827",
                              marginBottom: "6px",
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              disabled={!selectedProjectId || isSaving}
                              onChange={(event) => updateManualRowDropdownColumn(column, event.target.checked)}
                            />
                            <span>{column}</span>
                          </label>
                        );
                      })
                  ) : (
                    <span style={{ fontSize: "12px", color: "#6b7280", fontWeight: 600 }}>
                      Import data first so fields are available.
                    </span>
                  )}
                </div>
                <span style={{ fontSize: "12px", color: "#6b7280", fontWeight: 600 }}>
                  Checked fields use a searchable dropdown of existing values when adding manual rows.
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "12px", fontWeight: 700, color: "#374151" }}>
                  Add New Column
                </label>
                <input
                  type="text"
                  value={newColumnName}
                  onChange={(event) => setNewColumnName(event.target.value)}
                  placeholder="Enter new column name"
                  style={{
                    minWidth: "280px",
                    border: "1px solid #d1d5db",
                    borderRadius: "8px",
                    padding: "8px 10px",
                  }}
                />
              </div>

              <button
                type="button"
                onClick={addWholeColumn}
                disabled={!selectedProjectId || !normalizeValue(newColumnName) || isSaving}
                style={{
                  border: "none",
                  borderRadius: "8px",
                  padding: "9px 12px",
                  background: !selectedProjectId || !normalizeValue(newColumnName) || isSaving ? "#9ca3af" : "#0f766e",
                  color: "#ffffff",
                  cursor: !selectedProjectId || !normalizeValue(newColumnName) || isSaving ? "not-allowed" : "pointer",
                  fontWeight: 700,
                }}
              >
                Add Column
              </button>

              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "12px", fontWeight: 700, color: "#374151" }}>
                  Rename Column
                </label>
                <select
                  value={columnToRename}
                  onChange={(event) => {
                    setColumnToRename(event.target.value);
                    setColumnRenameValue(event.target.value);
                  }}
                  style={{
                    minWidth: "280px",
                    border: "1px solid #d1d5db",
                    borderRadius: "8px",
                    padding: "8px 10px",
                  }}
                >
                  <option value="">Select column</option>
                  {columns.map((column) => (
                    <option key={`rename-column-${column}`} value={column}>
                      {column}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "12px", fontWeight: 700, color: "#374151" }}>
                  New Column Name
                </label>
                <input
                  type="text"
                  value={columnRenameValue}
                  onChange={(event) => setColumnRenameValue(event.target.value)}
                  placeholder="Enter new name"
                  style={{
                    minWidth: "280px",
                    border: "1px solid #d1d5db",
                    borderRadius: "8px",
                    padding: "8px 10px",
                  }}
                />
              </div>

              <button
                type="button"
                onClick={renameWholeColumn}
                disabled={!columnToRename || !columnRenameValue || isSaving}
                style={{
                  border: "none",
                  borderRadius: "8px",
                  padding: "9px 12px",
                  background: !columnToRename || !columnRenameValue || isSaving ? "#9ca3af" : "#1d4ed8",
                  color: "#ffffff",
                  cursor: !columnToRename || !columnRenameValue || isSaving ? "not-allowed" : "pointer",
                  fontWeight: 700,
                }}
              >
                Rename Column
              </button>

              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "12px", fontWeight: 700, color: "#374151" }}>
                  Delete Column
                </label>
                <select
                  value={columnToDelete}
                  onChange={(event) => setColumnToDelete(event.target.value)}
                  style={{
                    minWidth: "280px",
                    border: "1px solid #d1d5db",
                    borderRadius: "8px",
                    padding: "8px 10px",
                  }}
                >
                  <option value="">Select column</option>
                  {columns
                    .filter((column) => normalizeKey(column) !== normalizeKey(statusColumnName))
                    .map((column) => (
                      <option key={`delete-column-${column}`} value={column}>
                        {column}
                      </option>
                    ))}
                </select>
              </div>

              <button
                type="button"
                onClick={deleteWholeColumn}
                disabled={!columnToDelete || isSaving}
                style={{
                  border: "none",
                  borderRadius: "8px",
                  padding: "9px 12px",
                  background: !columnToDelete || isSaving ? "#9ca3af" : "#b91c1c",
                  color: "#ffffff",
                  cursor: !columnToDelete || isSaving ? "not-allowed" : "pointer",
                  fontWeight: 700,
                }}
              >
                Delete Selected Column
              </button>

              <button
                type="button"
                onClick={deleteAllImportedRows}
                disabled={!rows.length || !selectedProjectId || isSaving}
                style={{
                  border: "none",
                  borderRadius: "8px",
                  padding: "9px 12px",
                  background: !rows.length || !selectedProjectId || isSaving ? "#9ca3af" : "#b91c1c",
                  color: "#ffffff",
                  cursor: !rows.length || !selectedProjectId || isSaving ? "not-allowed" : "pointer",
                  fontWeight: 700,
                }}
              >
                Delete All Imported Rows
              </button>

              <div style={{ width: "100%" }}>
                {renderVisibleColumnOrderControl("settings")}
              </div>
            </div>
          ) : null}

          <div style={{ marginTop: "12px", color: "#374151", fontSize: "14px" }}>
            <strong>Project:</strong> {selectedProject?.name || "No project selected"}
            {" | "}
            <strong>File:</strong> {fileName || "No file imported yet"}
            {rows.length > 0 ? ` | Rows: ${rows.length} | Columns: ${columns.length}` : ""}
            {rows.some((row) => Boolean(row.__isManual)) ? " | Manual rows are highlighted" : ""}
            {isHydrating ? " | Loading saved data..." : ""}
            {isSaving ? " | Saving changes..." : ""}
          </div>

          {activeMainTab === MAIN_TABS.IMPORT && hasPreview ? (
            <div
              style={{
                marginTop: "12px",
                border: "1px solid #bbf7d0",
                background: "#f0fdf4",
                color: "#14532d",
                borderRadius: "10px",
                padding: "10px 12px",
                fontSize: "14px",
                fontWeight: 600,
              }}
            >
              Preview ready: {previewFileName} | Sheet: {previewSelectedSheetName || "-"} | Total rows: {previewRows.length} | Matching rows: {previewRowsAfterCondition.length} | Columns: {previewColumns.length}. Click Confirm Import to save matching rows.
            </div>
          ) : null}

          {activeMainTab === MAIN_TABS.IMPORT && lastImportSummary ? (
            <div
              style={{
                marginTop: "12px",
                border: "1px solid #e5e7eb",
                background: "#f8fafc",
                borderRadius: "10px",
                padding: "10px 12px",
                color: "#0f172a",
                fontSize: "13px",
                fontWeight: 600,
              }}
            >
              {lastImportSummary.mode === IMPORT_MODES.REPLACE
                ? `Import summary: replaced dataset with ${lastImportSummary.replacedRowCount || 0} row(s).`
                : `Import summary: updated ${lastImportSummary.matchedAndUpdatedCount || 0} matched row(s), skipped ${lastImportSummary.skippedNoMatchCount || 0} with no match, skipped ${lastImportSummary.skippedAmbiguousMatchCount || 0} ambiguous match(es) on "${lastImportSummary.matchColumn || ""}".`}
            </div>
          ) : null}

          {activeMainTab === MAIN_TABS.IMPORT && previewSheetNames.length > 0 ? (
            <div
              style={{
                marginTop: "12px",
                border: "1px solid #e5e7eb",
                borderRadius: "10px",
                padding: "10px 12px",
                background: "#ffffff",
                display: "flex",
                gap: "10px",
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <div style={{ fontSize: "13px", fontWeight: 700, color: "#111827" }}>
                Excel Tab
              </div>
              <select
                value={previewSelectedSheetName}
                onChange={(event) => applyPreviewFromSheet(event.target.value)}
                disabled={isSaving || isUploading}
                style={{
                  minWidth: "220px",
                  border: "1px solid #d1d5db",
                  borderRadius: "8px",
                  padding: "8px 10px",
                }}
              >
                {previewSheetNames.map((sheetName) => (
                  <option key={`sheet-${sheetName}`} value={sheetName}>
                    {sheetName}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {activeMainTab === MAIN_TABS.IMPORT && previewSourceColumns.length > 0 ? (
            <div
              style={{
                marginTop: "12px",
                border: "1px solid #e5e7eb",
                borderRadius: "10px",
                padding: "10px 12px",
                background: "#ffffff",
              }}
            >
              <div style={{ fontSize: "13px", fontWeight: 700, color: "#111827", marginBottom: "8px" }}>
                Columns To Skip Importing (saved as default for this project)
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {previewSourceColumns.map((column) => {
                  const isStatusColumn = column === previewSourceStatusColumnName;
                  const isChecked = excludedColumns.includes(column);

                  return (
                    <label
                      key={`exclude-column-${column}`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "6px 8px",
                        borderRadius: "8px",
                        border: "1px solid #d1d5db",
                        background: isChecked ? "#fef2f2" : "#f8fafc",
                        color: "#111827",
                        fontSize: "12px",
                        fontWeight: 600,
                        opacity: isStatusColumn ? 0.65 : 1,
                        cursor: isStatusColumn ? "not-allowed" : "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={isStatusColumn}
                        onChange={(event) => {
                          const shouldExclude = event.target.checked;
                          setExcludedColumns((previous) => {
                            const next = new Set(previous);
                            if (shouldExclude) {
                              next.add(column);
                            } else {
                              next.delete(column);
                            }
                            return Array.from(next);
                          });
                        }}
                      />
                      {column}
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}

          {activeMainTab === MAIN_TABS.IMPORT && hasPreview ? (
            <div
              style={{
                marginTop: "12px",
                border: "1px solid #e5e7eb",
                borderRadius: "10px",
                padding: "10px 12px",
                background: "#f9fafb",
              }}
            >
              <div style={{ fontSize: "13px", fontWeight: 700, color: "#111827", marginBottom: "8px" }}>
                Preview Condition (optional)
              </div>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 600, color: "#374151" }}>
                  <input
                    type="checkbox"
                    checked={previewConditionEnabled}
                    onChange={(event) => setPreviewConditionEnabled(event.target.checked)}
                  />
                  Apply condition
                </label>

                <select
                  value={previewConditionColumn}
                  onChange={(event) => setPreviewConditionColumn(event.target.value)}
                  disabled={!previewConditionEnabled || previewConditionOperator === "matches_reference_row"}
                  style={{
                    minWidth: "220px",
                    border: "1px solid #d1d5db",
                    borderRadius: "8px",
                    padding: "8px 10px",
                  }}
                >
                  <option value="">Select Column</option>
                  {previewColumns.map((column) => (
                    <option key={`condition-${column}`} value={column}>
                      {column}
                    </option>
                  ))}
                </select>

                <select
                  value={previewConditionOperator}
                  onChange={(event) => setPreviewConditionOperator(event.target.value)}
                  disabled={!previewConditionEnabled}
                  style={{
                    minWidth: "170px",
                    border: "1px solid #d1d5db",
                    borderRadius: "8px",
                    padding: "8px 10px",
                  }}
                >
                  {PREVIEW_CONDITION_OPERATORS.map((operator) => (
                    <option key={operator.value} value={operator.value}>
                      {operator.label}
                    </option>
                  ))}
                </select>

                <input
                  type="text"
                  value={previewConditionValue}
                  onChange={(event) => setPreviewConditionValue(event.target.value)}
                  disabled={
                    !previewConditionEnabled
                    || previewConditionOperator === "has_value"
                    || previewConditionOperator === "not_complete"
                    || previewConditionOperator === "matches_reference_row"
                  }
                  placeholder={
                    previewConditionOperator === "has_value"
                      ? "No value needed"
                      : previewConditionOperator === "not_complete"
                      ? "No value needed"
                      : previewConditionOperator === "matches_reference_row"
                      ? "Use reference file + row below"
                      : "Value (example: Complete)"
                  }
                  style={{
                    minWidth: "220px",
                    border: "1px solid #d1d5db",
                    borderRadius: "8px",
                    padding: "8px 10px",
                  }}
                />
              </div>

              {previewConditionEnabled && previewConditionOperator === "matches_reference_row" ? (
                <div
                  style={{
                    marginTop: "10px",
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    padding: "10px",
                    background: "#ffffff",
                    display: "flex",
                    gap: "10px",
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  <label
                    htmlFor="conduit-reference-condition-file"
                    style={{
                      border: "none",
                      borderRadius: "8px",
                      padding: "8px 12px",
                      background: "#0f766e",
                      color: "#ffffff",
                      cursor: "pointer",
                      fontWeight: 700,
                    }}
                  >
                    Upload Reference Excel
                  </label>
                  <input
                    id="conduit-reference-condition-file"
                    type="file"
                    onChange={handleReferenceConditionFileUpload}
                    style={{ display: "none" }}
                  />

                  <span style={{ fontSize: "13px", color: "#374151", fontWeight: 600 }}>
                    Reference file: {referenceConditionFileName || "None selected"}
                  </span>

                  {referenceConditionSheetNames.length > 0 ? (
                    <select
                      value={referenceConditionSelectedSheetName}
                      onChange={(event) => applyReferenceConditionFromSheet(event.target.value)}
                      style={{
                        minWidth: "220px",
                        border: "1px solid #d1d5db",
                        borderRadius: "8px",
                        padding: "8px 10px",
                      }}
                    >
                      {referenceConditionSheetNames.map((sheetName) => (
                        <option key={`reference-sheet-${sheetName}`} value={sheetName}>
                          {sheetName}
                        </option>
                      ))}
                    </select>
                  ) : null}

                  <select
                    value={referenceConditionSelectedRowId}
                    onChange={(event) => setReferenceConditionSelectedRowId(event.target.value)}
                    disabled={!referenceConditionRows.length}
                    style={{
                      minWidth: "320px",
                      border: "1px solid #d1d5db",
                      borderRadius: "8px",
                      padding: "8px 10px",
                    }}
                  >
                    <option value="">
                      {referenceConditionRows.length ? "Select reference row" : "No reference rows loaded"}
                    </option>
                    {referenceConditionRows.map((referenceRow) => (
                      <option key={`reference-row-${referenceRow.__rowId}`} value={String(referenceRow.__rowId)}>
                        Row {referenceRow.__rowId}: {referenceConditionColumns
                          .slice(0, 3)
                          .map((column) => `${column}=${normalizeValue(referenceRow[column]) || "-"}`)
                          .join(" | ")}
                      </option>
                    ))}
                  </select>

                  <span style={{ fontSize: "12px", color: "#6b7280", width: "100%" }}>
                    This condition imports rows only when all visible columns match the selected reference row identically.
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}

          {!isLoadingProjects && projects.length === 0 ? (
            <div style={{ marginTop: "10px", color: "#92400e", fontWeight: 600 }}>
              No projects found. Create one in Project Lists & Issues first.
            </div>
          ) : null}

          {error ? (
            <div style={{ marginTop: "10px", color: "#b91c1c", fontWeight: 600 }}>{error}</div>
          ) : null}

          {manualRowSaveFeedback.message ? (
            <div
              style={{
                marginTop: "10px",
                borderRadius: "8px",
                padding: "10px 12px",
                border:
                  manualRowSaveFeedback.type === "success"
                    ? "1px solid #86efac"
                    : manualRowSaveFeedback.type === "error"
                      ? "1px solid #fecaca"
                      : "1px solid #bfdbfe",
                background:
                  manualRowSaveFeedback.type === "success"
                    ? "#f0fdf4"
                    : manualRowSaveFeedback.type === "error"
                      ? "#fef2f2"
                      : "#eff6ff",
                color:
                  manualRowSaveFeedback.type === "success"
                    ? "#166534"
                    : manualRowSaveFeedback.type === "error"
                      ? "#b91c1c"
                      : "#1d4ed8",
                fontWeight: 700,
              }}
            >
              {manualRowSaveFeedback.message}
            </div>
          ) : null}
        </div>

        {activeMainTab === MAIN_TABS.DATA ? (
          <div
            style={{
              width: "100vw",
              maxWidth: "100vw",
              marginLeft: "calc(50% - 50vw)",
              marginRight: "calc(50% - 50vw)",
              padding: "0 clamp(12px, 2vw, 24px)",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                width: "100%",
                background: "#ffffff",
                border: "1px solid #e5e7eb",
                borderRadius: "12px",
                padding: "12px",
                marginBottom: "12px",
                display: "flex",
                gap: "10px",
                flexWrap: "wrap",
                alignItems: "center",
                overflow: "visible",
                position: "relative",
                zIndex: 20,
              }}
            >
              <input
                type="text"
                placeholder="Search across all columns"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                style={{
                  minWidth: "260px",
                  flex: "0 0 320px",
                  border: "1px solid #d1d5db",
                  borderRadius: "8px",
                  padding: "8px 10px",
                }}
              />

              <div ref={visibleColumnsDropdownRef} style={{ position: "relative", minWidth: "260px", flex: "0 0 auto" }}>
                <button
                  type="button"
                  onClick={() => setIsVisibleColumnsDropdownOpen((previousState) => !previousState)}
                  style={{
                    width: "100%",
                    border: "1px solid #d1d5db",
                    borderRadius: "8px",
                    background: "#ffffff",
                    padding: "8px 10px",
                    textAlign: "left",
                    color: "#111827",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Visible Columns ({displayedColumns.length}/{columns.length})
                </button>

                {isVisibleColumnsDropdownOpen ? (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 6px)",
                      left: 0,
                      width: "320px",
                      maxWidth: "80vw",
                      border: "1px solid #d1d5db",
                      borderRadius: "8px",
                      background: "#ffffff",
                      boxShadow: "0 8px 20px rgba(0,0,0,0.12)",
                      zIndex: 2000,
                      padding: "10px",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setVisibleColumns(columns.map((column) => normalizeValue(column)).filter(Boolean));
                      }}
                      style={{
                        border: "1px solid #d1d5db",
                        borderRadius: "6px",
                        padding: "6px 8px",
                        background: "#ffffff",
                        color: "#111827",
                        cursor: "pointer",
                        fontWeight: 600,
                        marginBottom: "8px",
                      }}
                    >
                      Show All
                    </button>

                    <div style={{ maxHeight: "240px", overflowY: "auto", paddingRight: "4px" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        {displayedColumns.map((column) => {
                          const isChecked = displayedColumns.includes(column);
                          return (
                            <label
                              key={`visible-column-${column}`}
                              style={{
                                display: "grid",
                                gridTemplateColumns: "16px 1fr",
                                alignItems: "start",
                                columnGap: "8px",
                                width: "100%",
                                fontSize: "13px",
                                lineHeight: 1.3,
                                color: "#111827",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                style={{ marginTop: "2px" }}
                                onChange={() => {
                                  setVisibleColumns((previousColumns) => {
                                    if (previousColumns.includes(column)) {
                                      const nextColumns = previousColumns.filter((value) => value !== column);
                                      return nextColumns.length ? nextColumns : previousColumns;
                                    }
                                    return [...previousColumns, column];
                                  });
                                }}
                              />
                              {column}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                onClick={addTableFilterGroup}
                disabled={tableFilters.length >= MAX_TABLE_FILTER_LEVELS}
                style={{
                  border: "none",
                  borderRadius: "8px",
                  padding: "8px 12px",
                  background: tableFilters.length >= MAX_TABLE_FILTER_LEVELS ? "#9ca3af" : "#0f766e",
                  color: "#ffffff",
                  cursor: tableFilters.length >= MAX_TABLE_FILTER_LEVELS ? "not-allowed" : "pointer",
                  fontWeight: 700,
                }}
              >
                Add Filter
              </button>

              {tableFilters.map((filter, index) => {
                const valueOptions = getFilterValueOptions(filter.column);
                const isNoValueOperator = ["has_value", "not_has_value"].includes(filter.operator);

                return (
                  <div
                    key={filter.id}
                    style={{
                      display: "inline-flex",
                      gap: "8px",
                      alignItems: "center",
                      border: "1px solid #e5e7eb",
                      borderRadius: "8px",
                      padding: "6px",
                      background: "#f9fafb",
                    }}
                  >
                    <span style={{ fontSize: "12px", fontWeight: 700, color: "#4b5563" }}>F{index + 1}</span>
                    <select
                      value={filter.column}
                      onChange={(event) => updateTableFilter(filter.id, { column: event.target.value, value: "" })}
                      style={{
                        minWidth: "160px",
                        border: "1px solid #d1d5db",
                        borderRadius: "8px",
                        padding: "8px 10px",
                      }}
                    >
                      <option value="">Column</option>
                      {columns.map((column) => (
                        <option key={`${filter.id}-column-${column}`} value={column}>
                          {column}
                        </option>
                      ))}
                    </select>
                    <select
                      value={filter.operator}
                      onChange={(event) => updateTableFilter(filter.id, { operator: event.target.value, value: "" })}
                      style={{
                        minWidth: "160px",
                        border: "1px solid #d1d5db",
                        borderRadius: "8px",
                        padding: "8px 10px",
                      }}
                    >
                      {TABLE_FILTER_OPERATORS.map((operator) => (
                        <option key={`${filter.id}-op-${operator.value}`} value={operator.value}>
                          {operator.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={filter.value}
                      onChange={(event) => updateTableFilter(filter.id, { value: event.target.value })}
                      disabled={isNoValueOperator || !filter.column}
                      style={{
                        minWidth: "170px",
                        border: "1px solid #d1d5db",
                        borderRadius: "8px",
                        padding: "8px 10px",
                      }}
                    >
                      <option value="">{isNoValueOperator ? "No value needed" : "Value"}</option>
                      {valueOptions.map((valueOption) => (
                        <option key={`${filter.id}-value-${valueOption}`} value={valueOption}>
                          {valueOption}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => clearTableFilter(filter.id)}
                      style={{
                        border: "1px solid #d1d5db",
                        borderRadius: "8px",
                        padding: "8px 10px",
                        background: "#ffffff",
                        color: "#111827",
                        cursor: "pointer",
                        fontWeight: 700,
                      }}
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      onClick={() => removeTableFilter(filter.id)}
                      style={{
                        border: "none",
                        borderRadius: "8px",
                        padding: "8px 10px",
                        background: "#ef4444",
                        color: "#ffffff",
                        cursor: "pointer",
                        fontWeight: 700,
                      }}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={clearAllTableFilters}
                style={{
                  border: "1px solid #d1d5db",
                  borderRadius: "8px",
                  padding: "8px 12px",
                  background: "#ffffff",
                  color: "#111827",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                Clear Filters
              </button>
            </div>

            {statusCounts.length ? (
              <div
                style={{
                  width: "100%",
                  border: needToAddRows.length ? "1px solid #f59e0b" : "1px solid #d1d5db",
                  background: needToAddRows.length ? "#fffbeb" : "#f8fafc",
                  borderRadius: "12px",
                  padding: "10px 12px",
                  marginBottom: "12px",
                }}
              >
                <div style={{ fontSize: "12px", color: "#92400e", fontWeight: 700 }}>
                  Need to Add
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 800, fontSize: "22px", color: needToAddRows.length ? "#92400e" : "#374151" }}>
                    {needToAddRows.length}
                  </div>
                  <div style={{ fontSize: "13px", color: "#6b7280", fontWeight: 600 }}>
                    {needToAddRows.length === 1 ? "row marked as Need to Add" : "rows marked as Need to Add"}
                  </div>
                </div>
                {needToAddRows.length ? (
                  <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div style={{ fontSize: "12px", color: "#78350f" }}>
                      Rows: {needToAddRows.slice(0, 12).map((row) => row.__rowId).join(", ")}
                      {needToAddRows.length > 12 ? ` +${needToAddRows.length - 12} more` : ""}
                    </div>
                    <div style={{ display: "grid", gap: "8px" }}>
                      {needToAddRows.slice(0, 3).map((row) => {
                        const detailParts = columns
                          .filter((column) => column && !String(column).startsWith("__"))
                          .map((column) => ({ column, value: normalizeValue(row?.[column]) }))
                          .filter((entry) => entry.value)
                          .slice(0, 6)
                          .map((entry) => `${entry.column}: ${entry.value}`);

                        const extraCount = columns.filter((column) => column && !String(column).startsWith("__") && normalizeValue(row?.[column])).length - detailParts.length;

                        return (
                          <div
                            key={`need-to-add-row-${row.__rowId}`}
                            style={{
                              border: "1px solid #fde68a",
                              borderRadius: "10px",
                              background: "#fffdf2",
                              padding: "8px 10px",
                              color: "#78350f",
                              fontSize: "12px",
                              lineHeight: 1.45,
                            }}
                          >
                            <strong>Row {row.__rowId}</strong>
                            {detailParts.length ? (
                              <div style={{ marginTop: "3px" }}>
                                {detailParts.join(" • ")}
                                {extraCount > 0 ? ` • +${extraCount} more` : ""}
                              </div>
                            ) : (
                              <div style={{ marginTop: "3px" }}>No additional details available.</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {statusCounts.length ? (
              <div
                style={{
                  width: "100%",
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                  gap: "10px",
                  marginBottom: "16px",
                }}
              >
                {statusCounts.map(([status, count]) => (
                  <div
                    key={status}
                    style={{
                      background: "#ffffff",
                      border: "1px solid #e5e7eb",
                      borderRadius: "10px",
                      padding: "10px 12px",
                    }}
                  >
                    <div style={{ fontSize: "12px", color: "#6b7280" }}>{status}</div>
                    <div style={{ fontWeight: 700, fontSize: "20px" }}>{count}</div>
                  </div>
                ))}
              </div>
            ) : null}

            <div
              style={{
                width: "100%",
                background: "#ffffff",
                border: "1px solid #e5e7eb",
                borderRadius: "14px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "10px",
                  padding: "10px 12px",
                  borderBottom: "1px solid #e5e7eb",
                  background: "#f8fafc",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ fontSize: "13px", color: "#374151", fontWeight: 700 }}>
                  Showing {filteredRows.length ? ((tablePage - 1) * tablePageSize) + 1 : 0}
                  -{Math.min(tablePage * tablePageSize, filteredRows.length)} of {filteredRows.length}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: "#4b5563" }}>
                    Rows per page
                  </label>
                  <select
                    value={tablePageSize}
                    onChange={(event) => {
                      setTablePageSize(Number(event.target.value) || DEFAULT_TABLE_PAGE_SIZE);
                      setTablePage(1);
                    }}
                    style={{
                      border: "1px solid #d1d5db",
                      borderRadius: "8px",
                      padding: "6px 8px",
                    }}
                  >
                    {[10, 25, 50, 100].map((size) => (
                      <option key={`page-size-${size}`} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => setTablePage((previousPage) => Math.max(1, previousPage - 1))}
                    disabled={tablePage <= 1}
                    style={{
                      border: "1px solid #d1d5db",
                      borderRadius: "8px",
                      padding: "6px 10px",
                      background: "#ffffff",
                      color: tablePage <= 1 ? "#9ca3af" : "#111827",
                      cursor: tablePage <= 1 ? "not-allowed" : "pointer",
                      fontWeight: 700,
                    }}
                  >
                    Prev
                  </button>

                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#111827" }}>
                    Page {tablePage} / {totalTablePages}
                  </span>

                  <button
                    type="button"
                    onClick={() => setTablePage((previousPage) => Math.min(totalTablePages, previousPage + 1))}
                    disabled={tablePage >= totalTablePages}
                    style={{
                      border: "1px solid #d1d5db",
                      borderRadius: "8px",
                      padding: "6px 10px",
                      background: "#ffffff",
                      color: tablePage >= totalTablePages ? "#9ca3af" : "#111827",
                      cursor: tablePage >= totalTablePages ? "not-allowed" : "pointer",
                      fontWeight: 700,
                    }}
                  >
                    Next
                  </button>
                </div>
              </div>

              <div style={{ overflowX: "auto", width: "100%" }}>
                <table style={{ width: "100%", minWidth: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                  <thead style={{ position: "sticky", top: 0, background: "#f3f4f6" }}>
                    <tr>
                      <th
                        style={{
                          textAlign: "left",
                          padding: "10px",
                          borderBottom: "1px solid #e5e7eb",
                          width: equalTableColumnWidth,
                          minWidth: equalTableColumnWidth,
                          maxWidth: equalTableColumnWidth,
                          whiteSpace: "nowrap",
                        }}
                      >
                        #
                      </th>
                      {displayedColumns.map((column) => (
                        <th
                          key={column}
                          style={{
                            textAlign: "left",
                            padding: "10px",
                            borderBottom: "1px solid #e5e7eb",
                            width: equalTableColumnWidth,
                            minWidth: equalTableColumnWidth,
                            maxWidth: equalTableColumnWidth,
                            whiteSpace: "normal",
                            wordBreak: "break-word",
                          }}
                        >
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                            <span>{column}</span>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                promptRenameColumn(column);
                              }}
                              style={{
                                border: "1px solid #d1d5db",
                                borderRadius: "999px",
                                padding: "2px 8px",
                                background: "#ffffff",
                                color: "#1d4ed8",
                                cursor: isSaving ? "not-allowed" : "pointer",
                                fontSize: "11px",
                                fontWeight: 700,
                              }}
                              disabled={isSaving}
                              aria-label={`Rename ${column}`}
                              title={`Rename ${column}`}
                            >
                              Rename
                            </button>
                          </span>
                          {column === manualRowUniqueColumn ? (
                            <span title="Unique field required for new manual rows" style={{ color: "#b91c1c", marginLeft: "4px", fontWeight: 800 }}>
                              *
                            </span>
                          ) : null}
                        </th>
                      ))}
                      <th
                        style={{
                          textAlign: "left",
                          padding: "10px",
                          borderBottom: "1px solid #e5e7eb",
                          width: equalTableColumnWidth,
                          minWidth: equalTableColumnWidth,
                          maxWidth: equalTableColumnWidth,
                          whiteSpace: "normal",
                          wordBreak: "break-word",
                        }}
                      >
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedRows.map((row) => (
                      <React.Fragment key={row.__rowId}>
                      <tr style={row.__isManual ? { background: MANUAL_ROW_BACKGROUND } : undefined}>
                        <td
                          style={{
                            padding: "8px 10px",
                            borderBottom: "1px solid #f3f4f6",
                            color: "#6b7280",
                            width: equalTableColumnWidth,
                            minWidth: equalTableColumnWidth,
                            maxWidth: equalTableColumnWidth,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {row.__rowId}
                        </td>
                        {displayedColumns.map((column) => {
                          const isStatusColumn = column === statusColumnName;

                          return (
                            <td
                              key={`${row.__rowId}-${column}`}
                              style={{
                                padding: "8px 10px",
                                borderBottom: "1px solid #f3f4f6",
                                width: equalTableColumnWidth,
                                minWidth: equalTableColumnWidth,
                                maxWidth: equalTableColumnWidth,
                                whiteSpace: "normal",
                                wordBreak: "break-word",
                              }}
                            >
                              {isStatusColumn ? (
                                <select
                                  value={normalizeValue(row[column])}
                                  onChange={(event) => setRowStatus(row.__rowId, event.target.value)}
                                  style={{
                                    width: "100%",
                                    border: "1px solid #d1d5db",
                                    borderRadius: "8px",
                                    padding: "6px 8px",
                                  }}
                                >
                                  <option value="">Select status</option>
                                  {getRowStatusOptions(row[column]).map((status) => (
                                    <option key={status} value={status}>
                                      {status}
                                    </option>
                                  ))}
                                </select>
                              ) : row.__isManual ? (
                                manualRowDropdownColumns.includes(column) ? (
                                  (() => {
                                    const cellKey = `${row.__rowId}::${column}`;
                                    const cellValue = normalizeValue(row[column]);
                                    const isOpen = activeManualDropdownCell === cellKey;
                                    const filteredOptions = (manualRowDropdownOptionsByColumn[column] || [])
                                      .filter((optionValue) => {
                                        if (!cellValue) return true;
                                        return optionValue.toLowerCase().includes(cellValue.toLowerCase());
                                      })
                                      .slice(0, 50);

                                    return (
                                      <div style={{ position: "relative" }}>
                                        <input
                                          type="text"
                                          value={cellValue}
                                          onFocus={() => setActiveManualDropdownCell(cellKey)}
                                          onClick={() => setActiveManualDropdownCell(cellKey)}
                                          onChange={(event) => {
                                            setManualRowCellValue(row.__rowId, column, event.target.value);
                                            setActiveManualDropdownCell(cellKey);
                                          }}
                                          onBlur={() => {
                                            window.setTimeout(() => {
                                              setActiveManualDropdownCell((previousCell) => (
                                                previousCell === cellKey ? "" : previousCell
                                              ));
                                            }, 120);
                                          }}
                                          placeholder="Type to search"
                                          style={{
                                            width: "100%",
                                            border: "1px solid #d1d5db",
                                            borderRadius: "8px",
                                            padding: "6px 30px 6px 8px",
                                            backgroundColor: "#ffffff",
                                          }}
                                        />
                                        <span
                                          style={{
                                            position: "absolute",
                                            right: "8px",
                                            top: "50%",
                                            transform: "translateY(-50%)",
                                            color: "#6b7280",
                                            fontSize: "11px",
                                            pointerEvents: "none",
                                          }}
                                        >
                                          v
                                        </span>
                                        {isOpen ? (
                                          <div
                                            style={{
                                              position: "absolute",
                                              top: "calc(100% + 4px)",
                                              left: 0,
                                              right: 0,
                                              maxHeight: "180px",
                                              overflowY: "auto",
                                              border: "1px solid #d1d5db",
                                              borderRadius: "8px",
                                              background: "#ffffff",
                                              zIndex: 20,
                                              boxShadow: "0 8px 24px rgba(0, 0, 0, 0.12)",
                                            }}
                                          >
                                            {filteredOptions.length ? (
                                              filteredOptions.map((optionValue) => (
                                                <button
                                                  key={`${column}-manual-option-${optionValue}`}
                                                  type="button"
                                                  onMouseDown={(event) => {
                                                    event.preventDefault();
                                                    setManualRowCellValue(row.__rowId, column, optionValue);
                                                    setActiveManualDropdownCell("");
                                                  }}
                                                  style={{
                                                    width: "100%",
                                                    textAlign: "left",
                                                    padding: "8px 10px",
                                                    border: "none",
                                                    borderBottom: "1px solid #f3f4f6",
                                                    background: "#ffffff",
                                                    color: "#111827",
                                                    cursor: "pointer",
                                                  }}
                                                >
                                                  {optionValue}
                                                </button>
                                              ))
                                            ) : (
                                              <div
                                                style={{
                                                  padding: "8px 10px",
                                                  color: "#6b7280",
                                                  fontSize: "12px",
                                                }}
                                              >
                                                No matching options
                                              </div>
                                            )}
                                          </div>
                                        ) : null}
                                      </div>
                                    );
                                  })()
                                ) : (
                                  <input
                                    type="text"
                                    value={normalizeValue(row[column])}
                                    onChange={(event) => setManualRowCellValue(row.__rowId, column, event.target.value)}
                                    style={{
                                      width: "100%",
                                      border: "1px solid #fdba74",
                                      borderRadius: "8px",
                                      padding: "6px 8px",
                                      background: "#fffaf0",
                                    }}
                                  />
                                )
                              ) : (
                                <span>{normalizeValue(row[column]) || "-"}</span>
                              )}
                            </td>
                          );
                        })}
                        <td
                          style={{
                            padding: "8px 10px",
                            borderBottom: "1px solid #f3f4f6",
                            width: equalTableColumnWidth,
                            minWidth: equalTableColumnWidth,
                            maxWidth: equalTableColumnWidth,
                            whiteSpace: "normal",
                            wordBreak: "break-word",
                          }}
                        >
                          {row.__isManual ? (
                            <button
                              type="button"
                              onClick={() => saveManualRowCellValue(row.__rowId)}
                              style={{
                                border: "none",
                                borderRadius: "8px",
                                padding: "6px 10px",
                                background: row.__isDraftManual ? "#1d4ed8" : "#0f766e",
                                color: "#ffffff",
                                cursor: "pointer",
                                fontWeight: 700,
                                marginRight: "8px",
                              }}
                            >
                              {row.__isDraftManual ? "Save Row" : "Save"}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setLogModalRow(row)}
                            disabled={isMovingRowId === row.__rowId}
                            style={{
                              border: "1px solid #d1d5db",
                              borderRadius: "8px",
                              padding: "6px 10px",
                              background: "#ffffff",
                              color: isMovingRowId === row.__rowId ? "#9ca3af" : "#111827",
                              cursor: isMovingRowId === row.__rowId ? "not-allowed" : "pointer",
                              fontWeight: 700,
                              marginRight: "8px",
                            }}
                          >
                            Log
                          </button>
                          <button
                            type="button"
                            onClick={() => openMoveRowPicker(row.__rowId)}
                            disabled={!availableMoveProjects.length || isSaving || isMovingRowId === row.__rowId}
                            style={{
                              border: "1px solid #d1d5db",
                              borderRadius: "8px",
                              padding: "6px 10px",
                              background: "#ffffff",
                              color: !availableMoveProjects.length || isSaving || isMovingRowId === row.__rowId
                                ? "#9ca3af"
                                : "#1d4ed8",
                              cursor: !availableMoveProjects.length || isSaving || isMovingRowId === row.__rowId
                                ? "not-allowed"
                                : "pointer",
                              fontWeight: 700,
                              marginRight: "8px",
                            }}
                            title={
                              !availableMoveProjects.length
                                ? "Create another project to move rows."
                                : "Move this row to another project"
                            }
                          >
                            Move
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteRow(row.__rowId)}
                            disabled={isMovingRowId === row.__rowId}
                            style={{
                              border: "none",
                              borderRadius: "8px",
                              padding: "6px 10px",
                              background: "#b91c1c",
                              color: "#ffffff",
                              cursor: isMovingRowId === row.__rowId ? "not-allowed" : "pointer",
                              opacity: isMovingRowId === row.__rowId ? 0.65 : 1,
                              fontWeight: 600,
                            }}
                          >
                            Delete
                          </button>
                          {rowMovePickerRowId === row.__rowId ? (
                            <div
                              style={{
                                marginTop: "8px",
                                display: "flex",
                                flexDirection: "column",
                                gap: "6px",
                              }}
                            >
                              <select
                                value={rowMoveTargetProjectId}
                                onChange={(event) => setRowMoveTargetProjectId(event.target.value)}
                                disabled={isMovingRowId === row.__rowId}
                                style={{
                                  width: "100%",
                                  border: "1px solid #d1d5db",
                                  borderRadius: "8px",
                                  padding: "6px 8px",
                                }}
                              >
                                <option value="">Select target project</option>
                                {availableMoveProjects.map((project) => (
                                  <option key={`move-project-${row.__rowId}-${project.id}`} value={project.id}>
                                    {project.name}
                                  </option>
                                ))}
                              </select>
                              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                <button
                                  type="button"
                                  onClick={() => moveRowToAnotherProject(row.__rowId, rowMoveTargetProjectId)}
                                  disabled={!rowMoveTargetProjectId || isMovingRowId === row.__rowId}
                                  style={{
                                    border: "none",
                                    borderRadius: "8px",
                                    padding: "6px 10px",
                                    background: !rowMoveTargetProjectId || isMovingRowId === row.__rowId
                                      ? "#9ca3af"
                                      : "#1d4ed8",
                                    color: "#ffffff",
                                    cursor: !rowMoveTargetProjectId || isMovingRowId === row.__rowId
                                      ? "not-allowed"
                                      : "pointer",
                                    fontWeight: 700,
                                  }}
                                >
                                  {isMovingRowId === row.__rowId ? "Moving..." : "Confirm Move"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRowMovePickerRowId(null);
                                    setRowMoveTargetProjectId("");
                                  }}
                                  disabled={isMovingRowId === row.__rowId}
                                  style={{
                                    border: "1px solid #d1d5db",
                                    borderRadius: "8px",
                                    padding: "6px 10px",
                                    background: "#ffffff",
                                    color: "#111827",
                                    cursor: isMovingRowId === row.__rowId ? "not-allowed" : "pointer",
                                    fontWeight: 700,
                                  }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                      {manualRowValidationErrors[row.__rowId] ? (
                        <tr style={row.__isManual ? { background: MANUAL_ROW_BACKGROUND } : undefined}>
                          <td
                            colSpan={Math.max(2, displayedColumns.length + 2)}
                            style={{
                              padding: "0 10px 10px",
                              borderBottom: "1px solid #f3f4f6",
                            }}
                          >
                            <div
                              style={{
                                border: "1px solid #fecaca",
                                background: "#fef2f2",
                                color: "#b91c1c",
                                borderRadius: "8px",
                                padding: "8px 10px",
                                fontSize: "13px",
                                fontWeight: 700,
                              }}
                            >
                              {manualRowValidationErrors[row.__rowId]}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                      {manualRowSaveFeedback.type === "success"
                      && manualRowSaveFeedback.rowId === row.__rowId ? (
                        <tr style={row.__isManual ? { background: MANUAL_ROW_BACKGROUND } : undefined}>
                          <td
                            colSpan={Math.max(2, displayedColumns.length + 2)}
                            style={{
                              padding: "0 10px 10px",
                              borderBottom: "1px solid #f3f4f6",
                            }}
                          >
                            <div
                              style={{
                                border: "1px solid #86efac",
                                background: "#f0fdf4",
                                color: "#166534",
                                borderRadius: "8px",
                                padding: "8px 10px",
                                fontSize: "13px",
                                fontWeight: 700,
                              }}
                            >
                              {manualRowSaveFeedback.message}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                      </React.Fragment>
                    ))}
                    {paginatedRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={Math.max(2, displayedColumns.length + 2)}
                          style={{
                            padding: "18px 12px",
                            borderBottom: "1px solid #f3f4f6",
                            color: "#6b7280",
                            fontWeight: 600,
                          }}
                        >
                          No rows to display yet. Use Add Row or import data.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "10px",
                  padding: "10px 12px",
                  borderTop: "1px solid #e5e7eb",
                  background: "#f8fafc",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ fontSize: "13px", color: "#374151", fontWeight: 700 }}>
                  Showing {filteredRows.length ? ((tablePage - 1) * tablePageSize) + 1 : 0}
                  -{Math.min(tablePage * tablePageSize, filteredRows.length)} of {filteredRows.length}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: "#4b5563" }}>
                    Rows per page
                  </label>
                  <select
                    value={tablePageSize}
                    onChange={(event) => {
                      setTablePageSize(Number(event.target.value) || DEFAULT_TABLE_PAGE_SIZE);
                      setTablePage(1);
                    }}
                    style={{
                      border: "1px solid #d1d5db",
                      borderRadius: "8px",
                      padding: "6px 8px",
                    }}
                  >
                    {[10, 25, 50, 100].map((size) => (
                      <option key={`page-size-bottom-${size}`} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => setTablePage((previousPage) => Math.max(1, previousPage - 1))}
                    disabled={tablePage <= 1}
                    style={{
                      border: "1px solid #d1d5db",
                      borderRadius: "8px",
                      padding: "6px 10px",
                      background: "#ffffff",
                      color: tablePage <= 1 ? "#9ca3af" : "#111827",
                      cursor: tablePage <= 1 ? "not-allowed" : "pointer",
                      fontWeight: 700,
                    }}
                  >
                    Prev
                  </button>

                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#111827" }}>
                    Page {tablePage} / {totalTablePages}
                  </span>

                  <button
                    type="button"
                    onClick={() => setTablePage((previousPage) => Math.min(totalTablePages, previousPage + 1))}
                    disabled={tablePage >= totalTablePages}
                    style={{
                      border: "1px solid #d1d5db",
                      borderRadius: "8px",
                      padding: "6px 10px",
                      background: "#ffffff",
                      color: tablePage >= totalTablePages ? "#9ca3af" : "#111827",
                      cursor: tablePage >= totalTablePages ? "not-allowed" : "pointer",
                      fontWeight: 700,
                    }}
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {activeMainTab === MAIN_TABS.IMPORT && hasPreview ? (
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e5e7eb",
              borderRadius: "14px",
              overflow: "hidden",
              marginBottom: "16px",
            }}
          >
            <div
              style={{
                padding: "12px 14px",
                borderBottom: "1px solid #e5e7eb",
                fontWeight: 700,
                color: "#111827",
              }}
            >
              Import Preview (first 25 matching rows)
            </div>
            <div style={{ overflowX: "auto", width: "100%", maxHeight: "45vh", overflowY: "auto" }}>
              <table style={{ width: "100%", minWidth: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                <thead style={{ position: "sticky", top: 0, background: "#f3f4f6" }}>
                  <tr>
                    <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #e5e7eb" }}>#</th>
                    {previewColumns.map((column) => (
                      <th
                        key={`preview-${column}`}
                        style={{
                          textAlign: "left",
                          padding: "10px",
                          borderBottom: "1px solid #e5e7eb",
                          whiteSpace: "normal",
                          wordBreak: "break-word",
                        }}
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRowsAfterCondition.slice(0, 25).map((row) => (
                    <tr key={`preview-row-${row.__rowId}`}>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid #f3f4f6", color: "#6b7280" }}>
                        {row.__rowId}
                      </td>
                      {previewColumns.map((column) => (
                        <td
                          key={`preview-${row.__rowId}-${column}`}
                          style={{
                            padding: "8px 10px",
                            borderBottom: "1px solid #f3f4f6",
                            whiteSpace: "normal",
                            wordBreak: "break-word",
                          }}
                        >
                          <span>{normalizeValue(row[column]) || "-"}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                  {previewRowsAfterCondition.length === 0 ? (
                    <tr>
                      <td
                        colSpan={previewColumns.length + 1}
                        style={{
                          padding: "14px 10px",
                          borderBottom: "1px solid #f3f4f6",
                          color: "#6b7280",
                          fontWeight: 600,
                        }}
                      >
                        No rows match the current preview condition.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {activeLogRow ? (
          <div
            onClick={closeLogModal}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(17, 24, 39, 0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999,
              padding: "16px",
            }}
          >
            <div
              onClick={(event) => event.stopPropagation()}
              style={{
                width: "min(1500px, 98vw)",
                maxHeight: "86vh",
                overflowY: "auto",
                background: "#ffffff",
                borderRadius: "12px",
                border: "1px solid #e5e7eb",
                boxShadow: "0 20px 40px rgba(0,0,0,0.15)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "12px 14px",
                  borderBottom: "1px solid #e5e7eb",
                }}
              >
                <div style={{ fontWeight: 700, color: "#111827" }}>
                  Row {activeLogRow.__rowId} Log & Notes
                </div>
                <button
                  type="button"
                  onClick={closeLogModal}
                  style={{
                    border: "1px solid #d1d5db",
                    borderRadius: "8px",
                    padding: "6px 10px",
                    background: "#ffffff",
                    color: "#111827",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Close
                </button>
              </div>
              <div style={{ padding: "12px 14px", overflowX: "auto" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(320px, 1fr))",
                    gap: "10px",
                    alignItems: "start",
                    minWidth: "1020px",
                  }}
                >
                <div
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: "10px",
                    background: "#f9fafb",
                    padding: "10px",
                    minHeight: "62vh",
                    overflowY: "auto",
                  }}
                >
                  <div style={{ fontWeight: 700, color: "#111827", marginBottom: "8px" }}>
                    Import Logs
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      whiteSpace: "pre-wrap",
                      lineHeight: 1.5,
                      color: "#1f2937",
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace",
                      fontSize: "12px",
                    }}
                  >
                    {formatImportLogsForTooltip(activeLogRow.__importLogs)}
                  </pre>
                </div>

                <div
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: "10px",
                    background: "#f9fafb",
                    padding: "10px",
                    minHeight: "62vh",
                    overflowY: "auto",
                  }}
                >
                  <div style={{ fontWeight: 700, color: "#111827", marginBottom: "8px" }}>
                    Notes
                  </div>

                  <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
                    <input
                      type="text"
                      value={logNoteDraft}
                      onChange={(event) => setLogNoteDraft(event.target.value)}
                      placeholder="Add a note for this row"
                      style={{
                        flex: 1,
                        border: "1px solid #d1d5db",
                        borderRadius: "8px",
                        padding: "8px 10px",
                      }}
                    />
                    <button
                      type="button"
                      onClick={addNoteToLogRow}
                      disabled={isSavingLogNote}
                      style={{
                        border: "none",
                        borderRadius: "8px",
                        padding: "8px 10px",
                        background: isSavingLogNote ? "#9ca3af" : "#1d4ed8",
                        color: "#ffffff",
                        cursor: isSavingLogNote ? "not-allowed" : "pointer",
                        fontWeight: 700,
                      }}
                    >
                      Add Note
                    </button>
                  </div>

                  {(Array.isArray(activeLogRow.__notes) ? activeLogRow.__notes : []).length ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {[...(Array.isArray(activeLogRow.__notes) ? activeLogRow.__notes : [])]
                        .reverse()
                        .map((noteEntry, index) => (
                          <div
                            key={`row-note-${activeLogRow.__rowId}-${index}-${normalizeValue(noteEntry?.createdAtIso)}`}
                            style={{
                              border: "1px solid #e5e7eb",
                              borderRadius: "8px",
                              background: "#ffffff",
                              padding: "8px 10px",
                            }}
                          >
                            <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "4px" }}>
                              {normalizeValue(noteEntry?.createdAtIso) || "-"}
                              {normalizeValue(noteEntry?.createdBy)
                                ? ` | ${normalizeValue(noteEntry?.createdBy)}`
                                : ""}
                            </div>
                            <div style={{ fontSize: "13px", color: "#111827", whiteSpace: "pre-wrap" }}>
                              {normalizeValue(noteEntry?.text) || "-"}
                            </div>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: "13px", color: "#6b7280", fontWeight: 600 }}>
                      No notes yet for this row.
                    </div>
                  )}
                </div>

                <div
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: "10px",
                    background: "#f9fafb",
                    padding: "10px",
                    minHeight: "62vh",
                    overflowY: "auto",
                  }}
                >
                  <div style={{ fontWeight: 700, color: "#111827", marginBottom: "8px" }}>
                    Hidden Columns (currently off)
                  </div>

                  {hiddenColumns.length ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {hiddenColumns.map((column) => (
                        <div
                          key={`hidden-column-${activeLogRow.__rowId}-${column}`}
                          style={{
                            border: "1px solid #e5e7eb",
                            borderRadius: "8px",
                            background: "#ffffff",
                            padding: "8px 10px",
                          }}
                        >
                          <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "4px" }}>
                            {column}
                          </div>
                          <div style={{ fontSize: "13px", color: "#111827", whiteSpace: "pre-wrap" }}>
                            {normalizeValue(activeLogRow[column]) || "-"}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: "13px", color: "#6b7280", fontWeight: 600 }}>
                      No hidden columns right now.
                    </div>
                  )}
                </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default ConduitRunCounter;
