import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import * as XLSX from "xlsx";
import { FiActivity } from "react-icons/fi";
import { toast } from "react-toastify";
import { db } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import commonStyles from "../pages/commonStyles";

const cardStyle = {
  background: "#FFFFFF",
  border: "1px solid #E2E8F0",
  borderRadius: "8px",
  padding: "16px",
  textAlign: "left",
};

const labelStyle = {
  display: "block",
  fontSize: "0.78rem",
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "#64748B",
  marginBottom: "4px",
};

const inputStyle = {
  padding: "9px 10px",
  borderRadius: "6px",
  border: "1px solid #CBD5E1",
  fontSize: "0.95rem",
  minWidth: "220px",
};

const headerCellStyle = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "1px solid #E2E8F0",
  background: "#F8FAFC",
  color: "#475569",
  fontSize: "0.76rem",
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

const bodyCellStyle = {
  padding: "10px 12px",
  borderBottom: "1px solid #F1F5F9",
  fontSize: "0.92rem",
  color: "#0F172A",
  verticalAlign: "top",
};

// Firestore serverTimestamp is null until the write is acknowledged, so fall back to the local value.
const toDateFromTimestamp = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value === "number") return new Date(value);
  return null;
};

const formatTimeStamp = (value) => {
  const date = toDateFromTimestamp(value);
  if (!date || Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(date);
};

const formatDate = (value) => {
  const date = toDateFromTimestamp(value);
  if (!date || Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

const formatDateTime = (value) => {
  const date = toDateFromTimestamp(value);
  if (!date || Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(date);
};

const normalizeHeaderKey = (value) =>
  String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");

const ISSUE_NUMBER_ALIASES = [
  "issuenumber",
  "issue",
  "item",
  "itemnumber",
  "issueno",
  "issueid",
  "number",
  "buildissue",
  "buildissueno",
  "buildissuenumber",
  "buildissue#",
  "revizto",
  "reviztonumber",
  "revizto#",
  "issue#",
  "issueidnumber",
];
const PROJECT_ALIASES = [
  "project",
  "projectname",
  "team reporting",
  "teamreporting",
  "teamreportingname",
  "reporting",
];
const DATE_ALIASES = ["date", "date solution", "datesolution", "datesolucion", "solutiondate"];
const TIME_ALIASES = ["timestamp", "time", "timeposted", "createdtime"];
const USER_ALIASES = [
  "user",
  "assignedto",
  "assignee",
  "selectedby",
  "owner",
  "apm \\assignee",
  "apm assignee",
  "apmassignee",
  "apmassignee",
  "drafter assignee",
  "drafterassignee",
  "teamreportingassignee",
];
const IMPORT_COLUMNS = [
  "Direct Link",
  "TEAM REPORTING",
  "Build Issue #",
  "Revizto #",
  "APM \\Assignee",
  "Drafter Assignee",
  "Status",
  "QC Status",
  "Comentario",
];
const DEFAULT_STATUS_OPTIONS = ["Solved", "In Progress", "Unresolved", "Open", "Completed"];
const DEFAULT_QC_STATUS_OPTIONS = ["Pending QC", "Passed QC", "Failed QC"];
const getLastProjectStorageKey = (organizationId) => `issuesMainList:lastProject:${organizationId}`;

const getUniqueStatusOptions = (values) => {
  const uniqueOptions = new Map();
  (Array.isArray(values) ? values : []).forEach((value) => {
    const label = String(value || "").trim();
    const key = label.toLocaleLowerCase();
    if (label && !uniqueOptions.has(key)) uniqueOptions.set(key, label);
  });
  return Array.from(uniqueOptions.values());
};

const getStatusSelectValue = (value) => {
  const status = String(value || "").trim();
  return status.toLocaleLowerCase() === "unassigned" ? "" : status;
};

const isUnresolvedStatus = (value) =>
  getStatusSelectValue(value).toLocaleLowerCase() === "unresolved";

const getStatusOptionsForEntry = (currentValue, configuredOptions) => {
  const currentStatus = getStatusSelectValue(currentValue);
  const isConfigured = configuredOptions.some(
    (option) => option.toLocaleLowerCase() === currentStatus.toLocaleLowerCase()
  );
  return currentStatus && !isConfigured ? [...configuredOptions, currentStatus] : configuredOptions;
};

const getQcStatusValues = (value) => getUniqueStatusOptions(
  Array.isArray(value) ? value : value ? [value] : []
);

const getQcStatusOptionsForEntry = (currentValues, configuredOptions) => {
  const configuredKeys = new Set(configuredOptions.map((option) => option.toLocaleLowerCase()));
  return [...configuredOptions, ...currentValues.filter((value) => !configuredKeys.has(value.toLocaleLowerCase()))];
};

const hasCompletedQcStatuses = (value, requiredOptions) => {
  const selectedKeys = new Set(getQcStatusValues(value).map((status) => status.toLocaleLowerCase()));
  return requiredOptions.every((status) => selectedKeys.has(status.toLocaleLowerCase()));
};

const getSortedStatusHistory = (entry) =>
  [...(entry?.statusChangeLog || [])].sort((left, right) => {
    const leftTime = toDateFromTimestamp(left.changedAt)?.getTime() || 0;
    const rightTime = toDateFromTimestamp(right.changedAt)?.getTime() || 0;
    return leftTime - rightTime;
  });

const getSortedQcStatusHistory = (entry) =>
  [...(entry?.qcStatusChangeLog || [])].sort((left, right) => {
    const leftTime = toDateFromTimestamp(left.changedAt)?.getTime() || 0;
    const rightTime = toDateFromTimestamp(right.changedAt)?.getTime() || 0;
    return leftTime - rightTime;
  });

const getQcLogStatusValues = (value) =>
  getUniqueStatusOptions(Array.isArray(value) ? value : String(value || "").split(","));

const formatElapsedHours = (start, end) => {
  const startTime = toDateFromTimestamp(start)?.getTime();
  const endTime = toDateFromTimestamp(end)?.getTime();
  if (!startTime || !endTime || endTime < startTime) return "Time not recorded";
  const hours = (endTime - startTime) / (1000 * 60 * 60);
  return `${hours.toFixed(hours >= 10 ? 0 : 1)} hour${Math.round(hours) === 1 ? "" : "s"}`;
};

// Some user docs only have "name" (first name) plus "lastName", with no separate "firstName".
const resolveMemberDisplayName = (data = {}) => {
  const firstName = String(data.firstName || data.name || "").trim();
  const lastName = String(data.lastName || "").trim();
  const alreadyIncludesLastName =
    lastName && firstName.toLowerCase().includes(lastName.toLowerCase());
  const fullName = alreadyIncludesLastName ? firstName : [firstName, lastName].filter(Boolean).join(" ");
  return String(fullName || data.displayName || data.email || "").trim();
};

const getRowValue = (row, aliases) => {
  const aliasKeys = new Set(aliases.map(normalizeHeaderKey));
  const matchedKeys = Object.keys(row || {}).filter((key) => aliasKeys.has(normalizeHeaderKey(key)));
  const matchedKey = matchedKeys.find((key) => String(row[key] ?? "").trim() !== "") || matchedKeys[0];
  if (!matchedKey) return "";
  const value = row[matchedKey];
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value;
  return String(value).trim();
};

const getImportedColumnValue = (entry, column) => {
  const aliasesByColumn = {
    Item: ["item"],
    "Direct Link": ["direct link", "link", "url"],
    "TEAM REPORTING": ["team reporting", "project", "project name"],
    "Build Issue #": ["build issue #", "build issue", "issue number", "issue #"],
    "Revizto #": ["revizto #", "revizto", "revizto number"],
    "APM \\Assignee": ["apm \\assignee", "apm assignee", "assignee"],
    "Drafter Assignee": ["drafter assignee", "drafter"],
    "Name Issues": ["name issues", "issue name", "title", "name"],
    Status: ["status", "state"],
    "DATE SOLUTION": ["date solution", "solution date", "date"],
    "CHECK STATUS": ["check status", "checked status"],
    Comentario: ["comentario", "comment", "comments"],
    Column1: ["column1", "column 1"],
  };
  const importedValue = getRowValue(entry.importedData || {}, aliasesByColumn[column] || [column]);
  if (importedValue) return importedValue;
  if (column === "Issue #" || column === "Build Issue #") return entry.issueNumber || "";
  if (column === "TEAM REPORTING") return entry.projectName || "";
  if (column === "APM \\Assignee") return entry.assignedUserName || "";
  if (column === "Time Stamp") return formatTimeStamp(entry.createdAt);
  if (column === "Date") return formatDate(entry.createdAt);
  return "";
};

const isCheckedValue = (value) => ["true", "1", "yes", "checked", "x"].includes(String(value || "").trim().toLowerCase());

// Excel cells arrive as Date objects, serial-derived dates, or plain strings depending on formatting.
const combineDateAndTime = (dateValue, timeValue) => {
  if (!dateValue && !timeValue) return null;

  let base = null;
  if (dateValue instanceof Date && !Number.isNaN(dateValue.getTime())) {
    base = new Date(dateValue.getTime());
  } else if (dateValue) {
    const parsed = new Date(String(dateValue));
    if (!Number.isNaN(parsed.getTime())) base = parsed;
  }

  if (!base && timeValue instanceof Date && !Number.isNaN(timeValue.getTime())) {
    return new Date(timeValue.getTime());
  }
  if (!base) return null;

  if (timeValue instanceof Date && !Number.isNaN(timeValue.getTime())) {
    base.setHours(timeValue.getHours(), timeValue.getMinutes(), timeValue.getSeconds(), 0);
    return base;
  }

  const timeText = String(timeValue || "").trim();
  if (timeText) {
    const parsedTime = new Date(`1970-01-01 ${timeText}`);
    if (!Number.isNaN(parsedTime.getTime())) {
      base.setHours(parsedTime.getHours(), parsedTime.getMinutes(), parsedTime.getSeconds(), 0);
    }
  }

  return base;
};

const IssuesMainList = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedProjectId = searchParams.get("project") || "";
  const [projects, setProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [entries, setEntries] = useState([]);
  const [loadingEntries, setLoadingEntries] = useState(true);
  const [issueNumberDraft, setIssueNumberDraft] = useState("");
  const [assignedUserDraft, setAssignedUserDraft] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [members, setMembers] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [statusLogEntry, setStatusLogEntry] = useState(null);
  const [qcStatusLogEntry, setQcStatusLogEntry] = useState(null);
  const [activeTab, setActiveTab] = useState("issues");
  const [statusOptions, setStatusOptions] = useState(DEFAULT_STATUS_OPTIONS);
  const [statusOptionsDraft, setStatusOptionsDraft] = useState(DEFAULT_STATUS_OPTIONS);
  const [statusDescriptions, setStatusDescriptions] = useState({});
  const [statusDescriptionsDraft, setStatusDescriptionsDraft] = useState({});
  const [statusRenamesDraft, setStatusRenamesDraft] = useState({});
  const [newStatusDraft, setNewStatusDraft] = useState("");
  const [isSavingStatusOptions, setIsSavingStatusOptions] = useState(false);
  const [qcStatusOptions, setQcStatusOptions] = useState(DEFAULT_QC_STATUS_OPTIONS);
  const [qcStatusOptionsDraft, setQcStatusOptionsDraft] = useState(DEFAULT_QC_STATUS_OPTIONS);
  const [qcStatusDescriptions, setQcStatusDescriptions] = useState({});
  const [qcStatusDescriptionsDraft, setQcStatusDescriptionsDraft] = useState({});
  const [qcStatusRenamesDraft, setQcStatusRenamesDraft] = useState({});
  const [approvedQcUserIds, setApprovedQcUserIds] = useState([]);
  const [approvedQcUserIdsDraft, setApprovedQcUserIdsDraft] = useState([]);
  const [newQcStatusDraft, setNewQcStatusDraft] = useState("");
  const [isSavingQcStatusOptions, setIsSavingQcStatusOptions] = useState(false);
  const fileInputRef = useRef(null);
  const issueNumberInputRef = useRef(null);

  const setSelectedProjectId = (projectId) =>
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (projectId) next.set("project", projectId);
      else next.delete("project");
      return next;
    });

  useEffect(() => {
    if (!id) return;

    const storageKey = getLastProjectStorageKey(id);
    if (selectedProjectId) {
      window.localStorage.setItem(storageKey, selectedProjectId);
      return;
    }

    const lastProjectId = window.localStorage.getItem(storageKey);
    if (!lastProjectId) return;

    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("project", lastProjectId);
      return next;
    });
  }, [id, selectedProjectId, setSearchParams]);

  const projectsRef = useMemo(
    () => (id ? collection(db, "churches", id, "projectListIssueProjects") : null),
    [id]
  );
  const entriesRef = useMemo(
    () => (id ? collection(db, "churches", id, "issuesMainList") : null),
    [id]
  );
  const statusSettingsRef = useMemo(
    () => (id ? doc(db, "churches", id, "issuesMainListSettings", "statusConfig") : null),
    [id]
  );
  const qcStatusSettingsRef = useMemo(
    () => (id ? doc(db, "churches", id, "issuesMainListSettings", "qcStatusConfig") : null),
    [id]
  );

  useEffect(() => {
    if (!projectsRef) return undefined;

    setLoadingProjects(true);
    const unsubscribe = onSnapshot(
      projectsRef,
      (snapshot) => {
        const loaded = snapshot.docs
          .map((projectDoc) => ({ id: projectDoc.id, ...projectDoc.data() }))
          .sort((left, right) =>
            String(left.name || "").localeCompare(String(right.name || ""), undefined, {
              numeric: true,
              sensitivity: "base",
            })
          );
        setProjects(loaded);
        setLoadingProjects(false);
      },
      (error) => {
        console.error("Failed to load projects:", error);
        toast.error("Could not load projects.");
        setLoadingProjects(false);
      }
    );

    return unsubscribe;
  }, [projectsRef]);

  useEffect(() => {
    if (!entriesRef) return undefined;

    setLoadingEntries(true);
    const unsubscribe = onSnapshot(
      query(entriesRef, orderBy("createdAt", "desc")),
      (snapshot) => {
        setEntries(snapshot.docs.map((entryDoc) => ({ id: entryDoc.id, ...entryDoc.data() })));
        setLoadingEntries(false);
      },
      (error) => {
        console.error("Failed to load issues main list:", error);
        toast.error("Could not load the issues list.");
        setLoadingEntries(false);
      }
    );

    return unsubscribe;
  }, [entriesRef]);

  useEffect(() => {
    if (!statusSettingsRef) return undefined;

    return onSnapshot(
      statusSettingsRef,
      (snapshot) => {
        const savedOptions = getUniqueStatusOptions(snapshot.data()?.options);
        const savedDescriptions = snapshot.data()?.descriptions;
        setStatusOptions(savedOptions.length ? savedOptions : DEFAULT_STATUS_OPTIONS);
        setStatusDescriptions(
          savedDescriptions && typeof savedDescriptions === "object" && !Array.isArray(savedDescriptions)
            ? savedDescriptions
            : {}
        );
      },
      (error) => {
        console.error("Failed to load status settings:", error);
        toast.error("Could not load status settings.");
      }
    );
  }, [statusSettingsRef]);

  useEffect(() => {
    setStatusOptionsDraft(statusOptions);
    setStatusDescriptionsDraft(statusDescriptions);
    setStatusRenamesDraft({});
  }, [statusDescriptions, statusOptions]);

  useEffect(() => {
    if (!qcStatusSettingsRef) return undefined;

    return onSnapshot(
      qcStatusSettingsRef,
      (snapshot) => {
        const savedOptions = getUniqueStatusOptions(snapshot.data()?.options);
        const savedDescriptions = snapshot.data()?.descriptions;
        const savedApprovedUserIds = snapshot.data()?.approvedUserIds;
        setQcStatusOptions(savedOptions.length ? savedOptions : DEFAULT_QC_STATUS_OPTIONS);
        setApprovedQcUserIds(Array.isArray(savedApprovedUserIds) ? savedApprovedUserIds : []);
        setQcStatusDescriptions(
          savedDescriptions && typeof savedDescriptions === "object" && !Array.isArray(savedDescriptions)
            ? savedDescriptions
            : {}
        );
      },
      (error) => {
        console.error("Failed to load QC status settings:", error);
        toast.error("Could not load QC status settings.");
      }
    );
  }, [qcStatusSettingsRef]);

  useEffect(() => {
    setQcStatusOptionsDraft(qcStatusOptions);
    setQcStatusDescriptionsDraft(qcStatusDescriptions);
    setApprovedQcUserIdsDraft(approvedQcUserIds);
    setQcStatusRenamesDraft({});
  }, [approvedQcUserIds, qcStatusDescriptions, qcStatusOptions]);

  useEffect(() => {
    if (!id) return undefined;

    const usersRef = collection(db, "users");
    const numericId = Number(id);
    const organizationIds = [id, Number.isFinite(numericId) ? numericId : null].filter(
      (value, index, values) => value !== null && values.indexOf(value) === index
    );
    const memberQueries = organizationIds.flatMap((organizationId) => [
      query(usersRef, where("churchId", "==", organizationId)),
      query(usersRef, where("churchID", "==", organizationId)),
      query(usersRef, where("organizationId", "==", organizationId)),
    ]);
    const docsByQuery = memberQueries.map(() => []);

    const rebuildMembers = () => {
      const membersById = new Map();
      docsByQuery.flat().forEach((memberDoc) => {
        const data = memberDoc.data() || {};
        const label = resolveMemberDisplayName(data) || memberDoc.id;
        if (!label) return;
        membersById.set(memberDoc.id, { id: memberDoc.id, label });
      });
      setMembers(
        Array.from(membersById.values()).sort((left, right) => left.label.localeCompare(right.label))
      );
    };

    const unsubscribers = memberQueries.map((memberQuery, queryIndex) =>
      onSnapshot(
        memberQuery,
        (snapshot) => {
          docsByQuery[queryIndex] = snapshot.docs;
          rebuildMembers();
        },
        (error) => console.error("Failed to load organization members:", error)
      )
    );

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [id]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  const visibleEntries = useMemo(() => {
    const scopedEntries = selectedProjectId
      ? entries.filter((entry) => entry.projectId === selectedProjectId)
      : entries;

    const searchText = searchTerm.trim().toLowerCase();
    if (!searchText) return scopedEntries;

    return scopedEntries.filter((entry) =>
      [
        entry.issueNumber,
        entry.projectName,
        entry.assignedUserName,
        formatDate(entry.createdAt),
        formatTimeStamp(entry.createdAt),
      ]
        .map((value) => String(value || "").toLowerCase())
        .some((value) => value.includes(searchText))
    );
  }, [entries, selectedProjectId, searchTerm]);

  const userOptions = useMemo(() => {
    const uniqueMembersByName = new Map();
    members.forEach((member) => {
      const label = String(member.label || "").trim();
      const key = label.toLocaleLowerCase();
      if (label && !uniqueMembersByName.has(key)) uniqueMembersByName.set(key, label);
    });
    return Array.from(uniqueMembersByName.values());
  }, [members]);

  const selectedStatusHistory = useMemo(
    () => getSortedStatusHistory(statusLogEntry),
    [statusLogEntry]
  );

  const selectedIssueActivityHistory = useMemo(
    () => [
      ...selectedStatusHistory.map((change) => ({ ...change, activityType: "Status" })),
      ...getSortedQcStatusHistory(statusLogEntry).map((change) => ({ ...change, activityType: "QC Status" })),
    ].sort((left, right) => {
      const leftTime = toDateFromTimestamp(left.changedAt)?.getTime() || 0;
      const rightTime = toDateFromTimestamp(right.changedAt)?.getTime() || 0;
      return leftTime - rightTime;
    }),
    [selectedStatusHistory, statusLogEntry]
  );

  const selectedQcStatusHistory = useMemo(
    () => getSortedQcStatusHistory(qcStatusLogEntry),
    [qcStatusLogEntry]
  );

  const selectedQcStatusValues = useMemo(
    () => getQcStatusValues(statusLogEntry?.importedData?.["QC Status"]),
    [statusLogEntry]
  );

  const selectedQcStatusTimestampByKey = useMemo(() => {
    const timestamps = new Map();
    getSortedQcStatusHistory(statusLogEntry).forEach((change) => {
      getQcLogStatusValues(change.nextStatus).forEach((status) => {
        timestamps.set(status.toLocaleLowerCase(), change.changedAt);
      });
    });
    return timestamps;
  }, [statusLogEntry]);

  const statusReachedAtByKey = useMemo(() => {
    const reachedAt = new Map();
    selectedStatusHistory.forEach((change) => {
      const status = String(change.nextStatus || "").trim();
      if (status) reachedAt.set(status.toLocaleLowerCase(), change.changedAt);
    });
    return reachedAt;
  }, [selectedStatusHistory]);

  const handleAddIssueNumber = async (event) => {
    event.preventDefault();

    if (!selectedProjectId) {
      toast.warning("Select a project first.");
      return;
    }

    const issueNumber = issueNumberDraft.trim();
    if (!issueNumber) {
      toast.warning("Enter an issue number.");
      return;
    }

    setIsSaving(true);
    try {
      const assignedMember = members.find((member) => member.id === assignedUserDraft) || null;
      await addDoc(entriesRef, {
        projectId: selectedProjectId,
        projectName: String(selectedProject?.name || "").trim(),
        issueNumber,
        assignedUserId: assignedMember?.id || "",
        assignedUserName: assignedMember?.label || "",
        createdAt: serverTimestamp(),
        createdByUid: user?.uid || "",
        createdByEmail: user?.email || "",
      });
      setIssueNumberDraft("");
      toast.success("Issue number added.");
    } catch (error) {
      console.error("Failed to add issue number:", error);
      toast.error("Could not add the issue number.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleUploadExcel = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsImporting(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error("The uploaded file has no readable sheet.");

      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      if (!rows.length) throw new Error("The first sheet is empty.");

      const projectByName = new Map(
        projects.map((project) => [normalizeHeaderKey(project.name), project])
      );
      const existingByKey = new Map(
        entries.map((entry) => [
          `${entry.projectId}::${String(entry.issueNumber || "").trim().toLowerCase()}`,
          entry,
        ])
      );

      let batch = writeBatch(db);
      let operationsInBatch = 0;
      let createdCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;

      for (const row of rows) {
        const importedData = Object.fromEntries(
          Object.entries(row).map(([field, value]) => [String(field).trim(), value == null ? "" : String(value).trim()])
        );
        const issueNumber = String(getRowValue(row, ISSUE_NUMBER_ALIASES) || "").trim();
        if (!issueNumber) {
          skippedCount += 1;
          continue;
        }

        const rowProjectName = String(getRowValue(row, PROJECT_ALIASES) || "").trim();
        const matchedProject = rowProjectName
          ? projectByName.get(normalizeHeaderKey(rowProjectName)) || selectedProject
          : selectedProject;

        if (!matchedProject) {
          skippedCount += 1;
          continue;
        }

        const stampedAt = combineDateAndTime(
          getRowValue(row, DATE_ALIASES),
          getRowValue(row, TIME_ALIASES)
        );
        const rowUserName = String(getRowValue(row, USER_ALIASES) || "").trim();
        const matchedMember = rowUserName
          ? members.find((member) => member.label.toLowerCase() === rowUserName.toLowerCase())
          : null;
        const existing = existingByKey.get(`${matchedProject.id}::${issueNumber.toLowerCase()}`);

        if (existing) {
          const updates = {
            projectName: String(matchedProject.name || "").trim(),
            importedData,
            updatedAt: serverTimestamp(),
          };
          if (stampedAt) updates.createdAt = stampedAt;
          if (rowUserName) {
            updates.assignedUserId = matchedMember?.id || "";
            updates.assignedUserName = matchedMember?.label || rowUserName;
          }
          batch.update(doc(db, "churches", id, "issuesMainList", existing.id), updates);
          updatedCount += 1;
        } else {
          batch.set(doc(entriesRef), {
            projectId: matchedProject.id,
            projectName: String(matchedProject.name || "").trim(),
            issueNumber,
            assignedUserId: matchedMember?.id || "",
            assignedUserName: matchedMember?.label || rowUserName,
            importedData,
            createdAt: stampedAt || serverTimestamp(),
            createdByUid: user?.uid || "",
            createdByEmail: user?.email || "",
          });
          createdCount += 1;
        }

        operationsInBatch += 1;
        if (operationsInBatch >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          operationsInBatch = 0;
        }
      }

      if (operationsInBatch > 0) await batch.commit();

      if (createdCount === 0 && updatedCount === 0) {
        toast.warning("No rows could be imported. Check the Issue # and Project columns.");
      } else {
        toast.success(`Imported ${createdCount} new and updated ${updatedCount} existing entries.`);
      }
      if (skippedCount > 0) {
        toast.info(`Skipped ${skippedCount} row(s) without a valid issue number or project.`);
      }
    } catch (error) {
      console.error("Failed to import Excel file:", error);
      toast.error(error.message || "Could not import the Excel file.");
    } finally {
      setIsImporting(false);
    }
  };

  const handleChangeAssignedUser = async (entryId, memberId) => {
    const member = members.find((candidate) => candidate.id === memberId) || null;
    try {
      await updateDoc(doc(db, "churches", id, "issuesMainList", entryId), {
        assignedUserId: member?.id || "",
        assignedUserName: member?.label || "",
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("Failed to update assigned user:", error);
      toast.error("Could not update the user.");
    }
  };

  const handleDeleteEntry = async (entryId) => {
    if (!window.confirm("Remove this issue number from the list?")) return;

    try {
      await deleteDoc(doc(db, "churches", id, "issuesMainList", entryId));
      toast.success("Entry removed.");
    } catch (error) {
      console.error("Failed to delete entry:", error);
      toast.error("Could not remove the entry.");
    }
  };

  const handleDeleteAllEntries = async () => {
    if (!selectedProjectId) {
      toast.warning("Select a project before deleting its issues.");
      return;
    }

    const projectEntries = entries.filter((entry) => entry.projectId === selectedProjectId);
    if (!projectEntries.length) {
      toast.info("There are no issues to delete for this project.");
      return;
    }

    const projectName = selectedProject?.name || "this project";
    if (!window.confirm(`Delete all ${projectEntries.length} issue(s) for ${projectName}? This cannot be undone.`)) return;

    setIsDeletingAll(true);
    try {
      for (let start = 0; start < projectEntries.length; start += 400) {
        const batch = writeBatch(db);
        projectEntries.slice(start, start + 400).forEach((entry) => {
          batch.delete(doc(db, "churches", id, "issuesMainList", entry.id));
        });
        await batch.commit();
      }
      toast.success(`Deleted ${projectEntries.length} issue(s) from ${projectName}.`);
    } catch (error) {
      console.error("Failed to delete project issues:", error);
      toast.error("Could not delete all project issues.");
    } finally {
      setIsDeletingAll(false);
    }
  };

  const handleChangeImportedValue = async (entry, column, value) => {
    const importedData = { ...(entry.importedData || {}) };
    importedData[column] = value;

    try {
      const updates = {
        importedData,
        updatedAt: serverTimestamp(),
      };

      if (column === "Status") {
        const previousStatus = getImportedColumnValue(entry, "Status");
        if (previousStatus === value) return;
        const normalizedNextStatus = String(value || "").trim().toLocaleLowerCase();

        if (
          ["solved", "unresolved"].includes(normalizedNextStatus) &&
          !approvedQcUserIds.includes(user?.uid)
        ) {
          toast.warning("Only approved QC users can set an issue to Unresolved or Solved.");
          return;
        }

        if (
          normalizedNextStatus === "solved" &&
          isUnresolvedStatus(previousStatus) &&
          !hasCompletedQcStatuses(entry.importedData?.["QC Status"], qcStatusOptions)
        ) {
          toast.warning("Select every QC status before moving an unresolved issue to Solved.");
          return;
        }

        updates.statusUpdatedAt = serverTimestamp();
        updates.statusChangeLog = arrayUnion({
          previousStatus,
          nextStatus: value,
          changedAt: Timestamp.now(),
          changedByUid: user?.uid || "",
          changedByEmail: user?.email || "",
        });
      }

      if (column === "QC Status") {
        const previousStatus = getImportedColumnValue(entry, "QC Status");
        if (previousStatus === value) return;

        updates.qcStatusUpdatedAt = serverTimestamp();
        updates.qcStatusChangeLog = arrayUnion({
          previousStatus,
          nextStatus: value,
          changedAt: Timestamp.now(),
          changedByUid: user?.uid || "",
          changedByEmail: user?.email || "",
        });
      }

      await updateDoc(doc(db, "churches", id, "issuesMainList", entry.id), updates);
    } catch (error) {
      console.error("Failed to update imported row:", error);
      toast.error("Could not save the row change.");
    }
  };

  const handleChangeQcStatuses = async (entry, status, isSelected) => {
    if (!isUnresolvedStatus(getImportedColumnValue(entry, "Status"))) return;

    const previousStatuses = getQcStatusValues(entry.importedData?.["QC Status"]);
    const nextStatuses = isSelected
      ? getUniqueStatusOptions([...previousStatuses, status])
      : previousStatuses.filter((value) => value.toLocaleLowerCase() !== status.toLocaleLowerCase());
    if (previousStatuses.length === nextStatuses.length && previousStatuses.every((value, index) => value === nextStatuses[index])) return;

    try {
      await updateDoc(doc(db, "churches", id, "issuesMainList", entry.id), {
        importedData: { ...(entry.importedData || {}), "QC Status": nextStatuses },
        updatedAt: serverTimestamp(),
        qcStatusUpdatedAt: serverTimestamp(),
        qcStatusChangeLog: arrayUnion({
          previousStatus: previousStatuses.join(", "),
          nextStatus: nextStatuses.join(", "),
          changedAt: Timestamp.now(),
          changedByUid: user?.uid || "",
          changedByEmail: user?.email || "",
        }),
      });
    } catch (error) {
      console.error("Failed to update QC statuses:", error);
      toast.error("Could not save the QC statuses.");
    }
  };

  const handleAddStatusOption = (event) => {
    event.preventDefault();
    const statusName = newStatusDraft.trim();
    if (!statusName) return;

    if (statusOptionsDraft.some((option) => option.toLocaleLowerCase() === statusName.toLocaleLowerCase())) {
      toast.warning("That status already exists.");
      return;
    }

    setStatusOptionsDraft((previous) => [...previous, statusName]);
    setNewStatusDraft("");
  };

  const handleMoveStatusOption = (index, direction) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= statusOptionsDraft.length) return;

    setStatusOptionsDraft((previous) => {
      const next = [...previous];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const handleRenameStatusOption = (index, value) => {
    const previousName = statusOptionsDraft[index];
    if (previousName === value) return;

    const originalName = Object.entries(statusRenamesDraft).find(([, currentName]) => currentName === previousName)?.[0]
      || statusOptions.find((status) => status.toLocaleLowerCase() === previousName.toLocaleLowerCase());

    setStatusOptionsDraft((previous) => previous.map((status, statusIndex) => statusIndex === index ? value : status));
    setStatusDescriptionsDraft((previous) => {
      const next = { ...previous, [value]: previous[previousName] || "" };
      delete next[previousName];
      return next;
    });
    if (originalName) {
      setStatusRenamesDraft((previous) => ({ ...previous, [originalName]: value }));
    }
  };

  const handleDeleteStatusOption = (index) => {
    const status = statusOptionsDraft[index];
    if (!window.confirm(`Remove ${status || "this status"} from the status list? Existing issues will keep their current value.`)) return;

    setStatusOptionsDraft((previous) => previous.filter((_, statusIndex) => statusIndex !== index));
    setStatusDescriptionsDraft((previous) => {
      const next = { ...previous };
      delete next[status];
      return next;
    });
  };

  const handleSaveStatusOptions = async () => {
    const enteredOptions = statusOptionsDraft.map((status) => String(status || "").trim());
    const nextOptions = getUniqueStatusOptions(enteredOptions);
    if (!nextOptions.length || nextOptions.length !== enteredOptions.length) {
      toast.warning("Each status needs a unique name.");
      return;
    }

    setIsSavingStatusOptions(true);
    try {
      const descriptions = Object.fromEntries(
        nextOptions.map((status) => [status, String(statusDescriptionsDraft[status] || "").trim()])
      );
      const renamedStatuses = Object.entries(statusRenamesDraft).filter(([previousName, nextName]) =>
        nextOptions.includes(nextName) && previousName.toLocaleLowerCase() !== nextName.toLocaleLowerCase()
      );
      const renamedStatusByKey = new Map(
        renamedStatuses.map(([previousName, nextName]) => [previousName.toLocaleLowerCase(), nextName])
      );

      for (let start = 0; start < entries.length; start += 400) {
        const batch = writeBatch(db);
        let hasChanges = false;
        entries.slice(start, start + 400).forEach((entry) => {
          const currentStatus = getStatusSelectValue(getImportedColumnValue(entry, "Status"));
          const nextStatus = renamedStatusByKey.get(currentStatus.toLocaleLowerCase());
          if (!nextStatus) return;

          const importedData = { ...(entry.importedData || {}) };
          importedData.Status = nextStatus;
          batch.update(doc(db, "churches", id, "issuesMainList", entry.id), {
            importedData,
            updatedAt: serverTimestamp(),
            statusUpdatedAt: serverTimestamp(),
            statusChangeLog: arrayUnion({
              previousStatus: currentStatus,
              nextStatus,
              changedAt: Timestamp.now(),
              changedByUid: user?.uid || "",
              changedByEmail: user?.email || "",
            }),
          });
          hasChanges = true;
        });
        if (hasChanges) await batch.commit();
      }
      await setDoc(statusSettingsRef, {
        options: nextOptions,
        descriptions,
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || "",
        updatedByEmail: user?.email || "",
      }, { merge: true });
      setStatusOptions(nextOptions);
      setStatusDescriptions(descriptions);
      setStatusOptionsDraft(nextOptions);
      setStatusRenamesDraft({});
      toast.success("Status settings saved.");
    } catch (error) {
      console.error("Failed to save status settings:", error);
      toast.error("Could not save status settings.");
    } finally {
      setIsSavingStatusOptions(false);
    }
  };

  const handleAddQcStatusOption = (event) => {
    event.preventDefault();
    const statusName = newQcStatusDraft.trim();
    if (!statusName) return;
    if (qcStatusOptionsDraft.some((option) => option.toLocaleLowerCase() === statusName.toLocaleLowerCase())) {
      toast.warning("That QC status already exists.");
      return;
    }
    setQcStatusOptionsDraft((previous) => [...previous, statusName]);
    setNewQcStatusDraft("");
  };

  const handleMoveQcStatusOption = (index, direction) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= qcStatusOptionsDraft.length) return;
    setQcStatusOptionsDraft((previous) => {
      const next = [...previous];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const handleRenameQcStatusOption = (index, value) => {
    const previousName = qcStatusOptionsDraft[index];
    if (previousName === value) return;
    const originalName = Object.entries(qcStatusRenamesDraft).find(([, currentName]) => currentName === previousName)?.[0]
      || qcStatusOptions.find((status) => status.toLocaleLowerCase() === previousName.toLocaleLowerCase());
    setQcStatusOptionsDraft((previous) => previous.map((status, statusIndex) => statusIndex === index ? value : status));
    setQcStatusDescriptionsDraft((previous) => {
      const next = { ...previous, [value]: previous[previousName] || "" };
      delete next[previousName];
      return next;
    });
    if (originalName) setQcStatusRenamesDraft((previous) => ({ ...previous, [originalName]: value }));
  };

  const handleDeleteQcStatusOption = (index) => {
    const status = qcStatusOptionsDraft[index];
    if (!window.confirm(`Remove ${status || "this QC status"} from the QC status list? Existing issues will keep their current value.`)) return;
    setQcStatusOptionsDraft((previous) => previous.filter((_, statusIndex) => statusIndex !== index));
    setQcStatusDescriptionsDraft((previous) => {
      const next = { ...previous };
      delete next[status];
      return next;
    });
  };

  const handleSaveQcStatusOptions = async () => {
    const enteredOptions = qcStatusOptionsDraft.map((status) => String(status || "").trim());
    const nextOptions = getUniqueStatusOptions(enteredOptions);
    if (!nextOptions.length || nextOptions.length !== enteredOptions.length) {
      toast.warning("Each QC status needs a unique name.");
      return;
    }

    setIsSavingQcStatusOptions(true);
    try {
      const descriptions = Object.fromEntries(
        nextOptions.map((status) => [status, String(qcStatusDescriptionsDraft[status] || "").trim()])
      );
      const renamedStatusByKey = new Map(
        Object.entries(qcStatusRenamesDraft)
          .filter(([previousName, nextName]) => nextOptions.includes(nextName) && previousName.toLocaleLowerCase() !== nextName.toLocaleLowerCase())
          .map(([previousName, nextName]) => [previousName.toLocaleLowerCase(), nextName])
      );

      for (let start = 0; start < entries.length; start += 400) {
        const batch = writeBatch(db);
        let hasChanges = false;
        entries.slice(start, start + 400).forEach((entry) => {
          const currentStatuses = getQcStatusValues(entry.importedData?.["QC Status"]);
          const nextStatuses = currentStatuses.map((status) => renamedStatusByKey.get(status.toLocaleLowerCase()) || status);
          if (currentStatuses.every((status, index) => status === nextStatuses[index])) return;
          const importedData = { ...(entry.importedData || {}), "QC Status": nextStatuses };
          batch.update(doc(db, "churches", id, "issuesMainList", entry.id), {
            importedData,
            updatedAt: serverTimestamp(),
            qcStatusUpdatedAt: serverTimestamp(),
            qcStatusChangeLog: arrayUnion({ previousStatus: currentStatuses.join(", "), nextStatus: nextStatuses.join(", "), changedAt: Timestamp.now(), changedByUid: user?.uid || "", changedByEmail: user?.email || "" }),
          });
          hasChanges = true;
        });
        if (hasChanges) await batch.commit();
      }

      await setDoc(qcStatusSettingsRef, { options: nextOptions, descriptions, approvedUserIds: approvedQcUserIdsDraft, updatedAt: serverTimestamp(), updatedByUid: user?.uid || "", updatedByEmail: user?.email || "" }, { merge: true });
      setQcStatusOptions(nextOptions);
      setQcStatusDescriptions(descriptions);
      setApprovedQcUserIds(approvedQcUserIdsDraft);
      setQcStatusOptionsDraft(nextOptions);
      setQcStatusRenamesDraft({});
      toast.success("QC status settings saved.");
    } catch (error) {
      console.error("Failed to save QC status settings:", error);
      toast.error("Could not save QC status settings.");
    } finally {
      setIsSavingQcStatusOptions(false);
    }
  };

  const isManagingQcStatuses = activeTab === "qc-statuses";
  const managedStatusOptionsDraft = isManagingQcStatuses ? qcStatusOptionsDraft : statusOptionsDraft;
  const managedStatusDescriptionsDraft = isManagingQcStatuses ? qcStatusDescriptionsDraft : statusDescriptionsDraft;
  const managedNewStatusDraft = isManagingQcStatuses ? newQcStatusDraft : newStatusDraft;
  const isSavingManagedStatuses = isManagingQcStatuses ? isSavingQcStatusOptions : isSavingStatusOptions;
  const handleAddManagedStatus = isManagingQcStatuses ? handleAddQcStatusOption : handleAddStatusOption;
  const handleMoveManagedStatus = isManagingQcStatuses ? handleMoveQcStatusOption : handleMoveStatusOption;
  const handleRenameManagedStatus = isManagingQcStatuses ? handleRenameQcStatusOption : handleRenameStatusOption;
  const handleDeleteManagedStatus = isManagingQcStatuses ? handleDeleteQcStatusOption : handleDeleteStatusOption;
  const handleSaveManagedStatuses = isManagingQcStatuses ? handleSaveQcStatusOptions : handleSaveStatusOptions;
  const handleDiscardManagedStatuses = () => {
    if (isManagingQcStatuses) {
      setQcStatusOptionsDraft(qcStatusOptions);
      setQcStatusDescriptionsDraft(qcStatusDescriptions);
      setApprovedQcUserIdsDraft(approvedQcUserIds);
      setQcStatusRenamesDraft({});
      return;
    }
    setStatusOptionsDraft(statusOptions);
    setStatusDescriptionsDraft(statusDescriptions);
    setStatusRenamesDraft({});
  };

  return (
    <div style={{ ...commonStyles.fullWidthContainer, textAlign: "left" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ ...commonStyles.title, textAlign: "left", marginBottom: "4px" }}>Issues Main List</h1>
          <div style={{ color: "#64748B", fontSize: "0.9rem" }}>
            Upload the Excel issue list to preserve every imported column in the table.
          </div>
        </div>
        <Link
          to={`/organization/${id}/mi-organizacion`}
          style={{ borderRadius: "8px", padding: "10px 14px", background: "#E2E8F0", color: "#0F172A", fontWeight: 700, textDecoration: "none" }}
        >
          Back to Modules
        </Link>
      </div>

      <div role="tablist" aria-label="Issues main list sections" style={{ display: "flex", gap: "8px", marginTop: "16px", borderBottom: "1px solid #CBD5E1" }}>
        <button type="button" role="tab" aria-selected={activeTab === "issues"} onClick={() => setActiveTab("issues")} style={{ border: "none", borderBottom: activeTab === "issues" ? "3px solid #0F766E" : "3px solid transparent", background: "transparent", color: activeTab === "issues" ? "#0F766E" : "#475569", padding: "10px 12px", fontWeight: 700, cursor: "pointer" }}>Issues</button>
        <button type="button" role="tab" aria-selected={activeTab === "statuses"} onClick={() => setActiveTab("statuses")} style={{ border: "none", borderBottom: activeTab === "statuses" ? "3px solid #0F766E" : "3px solid transparent", background: "transparent", color: activeTab === "statuses" ? "#0F766E" : "#475569", padding: "10px 12px", fontWeight: 700, cursor: "pointer" }}>Manage Statuses</button>
        <button type="button" role="tab" aria-selected={activeTab === "qc-statuses"} onClick={() => setActiveTab("qc-statuses")} style={{ border: "none", borderBottom: activeTab === "qc-statuses" ? "3px solid #0F766E" : "3px solid transparent", background: "transparent", color: activeTab === "qc-statuses" ? "#0F766E" : "#475569", padding: "10px 12px", fontWeight: 700, cursor: "pointer" }}>Manage QC Statuses</button>
      </div>

      {activeTab === "issues" ? (
        <>
      <form onSubmit={handleAddIssueNumber} style={{ ...cardStyle, marginTop: "12px", display: "flex", gap: "12px", alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <label htmlFor="issues-main-list-project" style={labelStyle}>Project</label>
          <select
            id="issues-main-list-project"
            value={selectedProjectId}
            onChange={(event) => setSelectedProjectId(event.target.value)}
            disabled={loadingProjects}
            style={inputStyle}
          >
            <option value="">{loadingProjects ? "Loading projects..." : "Select a project"}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name || "Untitled Project"}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="issues-main-list-issue-number" style={labelStyle}>Issue Number</label>
          <input
            ref={issueNumberInputRef}
            id="issues-main-list-issue-number"
            type="text"
            value={issueNumberDraft}
            onChange={(event) => setIssueNumberDraft(event.target.value)}
            placeholder="e.g. 1042"
            style={inputStyle}
          />
        </div>

        <div>
          <label htmlFor="issues-main-list-user" style={labelStyle}>User</label>
          <select
            id="issues-main-list-user"
            value={assignedUserDraft}
            onChange={(event) => setAssignedUserDraft(event.target.value)}
            style={inputStyle}
          >
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>{member.label}</option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={isSaving}
          style={{
            border: "none",
            borderRadius: "8px",
            padding: "10px 16px",
            background: isSaving ? "#94A3B8" : "#0F766E",
            color: "#FFFFFF",
            fontWeight: 700,
            cursor: isSaving ? "not-allowed" : "pointer",
          }}
        >
          {isSaving ? "Adding..." : "Add New Issue"}
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleUploadExcel}
          style={{ display: "none" }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isImporting}
          title="Upload the Excel issue list with all 13 columns"
          style={{
            border: "none",
            borderRadius: "8px",
            padding: "10px 16px",
            background: isImporting ? "#94A3B8" : "#1D4ED8",
            color: "#FFFFFF",
            fontWeight: 700,
            cursor: isImporting ? "not-allowed" : "pointer",
          }}
        >
          {isImporting ? "Importing..." : "Upload Excel"}
        </button>
      </form>

      <div style={{ ...cardStyle, marginTop: "12px", color: "#475569", fontSize: "0.85rem" }}>
        <strong style={{ color: "#0F172A" }}>Excel columns:</strong>{" "}
        {IMPORT_COLUMNS.map((column) => <code key={column}>{column}</code>).reduce((content, column, index) =>
          index === 0 ? [column] : [...content, ", ", column], [])}. Rows are preserved using the original Excel column names.
      </div>

      <div style={{ ...cardStyle, marginTop: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", marginBottom: "10px" }}>
          <strong style={{ color: "#0F172A" }}>
            {selectedProject ? `${selectedProject.name || "Untitled Project"} Issues` : "All Issues"}
          </strong>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search issue #, project, user, date..."
              aria-label="Search issues"
              style={{ ...inputStyle, minWidth: "260px" }}
            />
            {searchTerm ? (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                style={{ border: "1px solid #CBD5E1", borderRadius: "6px", padding: "7px 12px", background: "#FFFFFF", color: "#334155", fontWeight: 700, cursor: "pointer" }}
              >
                Clear
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => issueNumberInputRef.current?.focus()}
              style={{ border: "none", borderRadius: "6px", padding: "7px 12px", background: "#0F766E", color: "#FFFFFF", fontWeight: 700, cursor: "pointer" }}
            >
              Add New Issue
            </button>
            <button
              type="button"
              onClick={handleDeleteAllEntries}
              disabled={!selectedProjectId || isDeletingAll}
              title={selectedProjectId ? "Delete every issue in the selected project" : "Select a project to delete its issues"}
              style={{ border: "none", borderRadius: "6px", padding: "7px 12px", background: !selectedProjectId || isDeletingAll ? "#CBD5E1" : "#B91C1C", color: "#FFFFFF", fontWeight: 700, cursor: !selectedProjectId || isDeletingAll ? "not-allowed" : "pointer" }}
            >
              {isDeletingAll ? "Deleting..." : "Delete All Issues"}
            </button>
            <span style={{ color: "#64748B", fontSize: "0.85rem" }}>
              {visibleEntries.length} {visibleEntries.length === 1 ? "entry" : "entries"}
            </span>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {IMPORT_COLUMNS.map((column) => <th key={column} style={headerCellStyle}>{column}</th>)}
                <th style={{ ...headerCellStyle, textAlign: "center" }}>Progress</th>
              </tr>
            </thead>
            <tbody>
              {loadingEntries ? (
                <tr>
                  <td style={bodyCellStyle} colSpan={IMPORT_COLUMNS.length + 1}>Loading entries...</td>
                </tr>
              ) : visibleEntries.length === 0 ? (
                <tr>
                  <td style={bodyCellStyle} colSpan={IMPORT_COLUMNS.length + 1}>
                    {searchTerm.trim()
                      ? "No entries match your search."
                      : selectedProjectId
                        ? "No issue numbers added for this project yet."
                        : "No issue numbers added yet."}
                  </td>
                </tr>
              ) : (
                visibleEntries.map((entry) => (
                  <tr key={entry.id}>
                    {IMPORT_COLUMNS.map((column) => (
                      <td key={column} style={{ ...bodyCellStyle, fontWeight: column === "Item" ? 700 : undefined }}>
                        {column === "CHECK STATUS" ? (
                          <input
                            type="checkbox"
                            checked={isCheckedValue(getImportedColumnValue(entry, column))}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => handleChangeImportedValue(entry, column, event.target.checked ? "TRUE" : "FALSE")}
                            aria-label={`Check status for ${getImportedColumnValue(entry, "Revizto #") || entry.id}`}
                          />
                        ) : column === "QC Status" ? (
                          <div style={{ display: "grid", gap: "6px" }}>
                          <details onClick={(event) => event.stopPropagation()} style={{ position: "relative" }}>
                            <summary
                              aria-label="Choose QC statuses"
                              style={{ ...inputStyle, minWidth: "150px", padding: "6px 8px", fontSize: "0.88rem", listStyle: "none", background: isUnresolvedStatus(getImportedColumnValue(entry, "Status")) ? "#FFFFFF" : "#F1F5F9", color: isUnresolvedStatus(getImportedColumnValue(entry, "Status")) ? "#0F172A" : "#64748B", cursor: isUnresolvedStatus(getImportedColumnValue(entry, "Status")) ? "pointer" : "not-allowed" }}
                            >
                              {isUnresolvedStatus(getImportedColumnValue(entry, "Status")) ? (
                                getQcStatusValues(entry.importedData?.["QC Status"]).length ? (
                                  <span style={{ display: "flex", gap: "4px", flexWrap: "wrap", alignItems: "center" }}>
                                    {getQcStatusValues(entry.importedData?.["QC Status"]).map((status) => (
                                      <span key={status} style={{ borderRadius: "4px", padding: "2px 5px", background: "#DBEAFE", color: "#1D4ED8", fontSize: "0.76rem", fontWeight: 700 }}>{status}</span>
                                    ))}
                                  </span>
                                ) : "Choose QC statuses"
                              ) : "Set Status to Unresolved"}
                            </summary>
                            {isUnresolvedStatus(getImportedColumnValue(entry, "Status")) ? (
                              <div style={{ position: "absolute", zIndex: 20, top: "calc(100% + 4px)", left: 0, minWidth: "210px", maxWidth: "280px", display: "grid", gap: "6px", padding: "10px", border: "1px solid #CBD5E1", borderRadius: "6px", background: "#FFFFFF", boxShadow: "0 12px 24px rgba(15, 23, 42, 0.18)" }}>
                                {getQcStatusOptionsForEntry(getQcStatusValues(entry.importedData?.["QC Status"]), qcStatusOptions).map((option) => {
                                  const isSelected = getQcStatusValues(entry.importedData?.["QC Status"]).some((value) => value.toLocaleLowerCase() === option.toLocaleLowerCase());
                                  return (
                                    <label key={option} style={{ display: "grid", gridTemplateColumns: "16px minmax(0, 1fr)", alignItems: "center", columnGap: "8px", color: "#0F172A", fontSize: "0.86rem", cursor: "pointer" }}>
                                      <input type="checkbox" checked={isSelected} onChange={(event) => handleChangeQcStatuses(entry, option, event.target.checked)} style={{ width: "16px", height: "16px", margin: 0 }} />
                                      <span>{option}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            ) : null}
                          </details>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setQcStatusLogEntry(entry);
                            }}
                            style={{ border: "none", background: "transparent", color: "#1D4ED8", padding: 0, textAlign: "left", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer" }}
                          >
                            QC log ({entry.qcStatusChangeLog?.length || 0})
                          </button>
                          </div>
                        ) : column === "APM \\Assignee" || column === "Drafter Assignee" || column === "Status" ? (
                          <div style={{ display: "grid", gap: "6px" }}>
                            <select
                              value={column === "Status" ? getStatusSelectValue(getImportedColumnValue(entry, column)) : getImportedColumnValue(entry, column)}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => handleChangeImportedValue(entry, column, event.target.value)}
                              aria-label={`${column} value`}
                              style={{ ...inputStyle, minWidth: "120px", width: "100%", padding: "6px 8px", fontSize: "0.88rem", color: column === "Status" && !getStatusSelectValue(getImportedColumnValue(entry, column)) ? "#B91C1C" : "#0F172A" }}
                            >
                              <option value="">{column === "Status" ? "No status selected" : "Unassigned"}</option>
                              {(column === "Status" ? getStatusOptionsForEntry(getImportedColumnValue(entry, column), statusOptions) : userOptions).map((option) => (
                                <option
                                  key={option}
                                  value={option}
                                  disabled={
                                    column === "Status" &&
                                    (
                                      (["solved", "unresolved"].includes(option.toLocaleLowerCase()) && !approvedQcUserIds.includes(user?.uid)) ||
                                      (option.toLocaleLowerCase() === "solved" &&
                                        isUnresolvedStatus(getImportedColumnValue(entry, "Status")) &&
                                        !hasCompletedQcStatuses(entry.importedData?.["QC Status"], qcStatusOptions))
                                    )
                                  }
                                >
                                  {option}
                                </option>
                              ))}
                            </select>
                            {column === "Status" ? (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setStatusLogEntry(entry);
                                }}
                                style={{ border: "none", background: "transparent", color: "#1D4ED8", padding: 0, textAlign: "left", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer" }}
                              >
                                Status log ({entry.statusChangeLog?.length || 0})
                              </button>
                            ) : null}
                          </div>
                        ) : (
                          <input
                            type="text"
                            defaultValue={getImportedColumnValue(entry, column)}
                            onClick={(event) => event.stopPropagation()}
                            onBlur={(event) => {
                              const nextValue = event.target.value.trim();
                              if (nextValue !== getImportedColumnValue(entry, column)) {
                                handleChangeImportedValue(entry, column, nextValue);
                              }
                            }}
                            aria-label={`${column} value`}
                            style={{ ...inputStyle, minWidth: "120px", width: "100%", padding: "6px 8px", fontSize: "0.88rem" }}
                          />
                        )}
                      </td>
                    ))}
                    <td style={{ ...bodyCellStyle, textAlign: "center" }}>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setStatusLogEntry(entry);
                        }}
                        aria-label={`Open progress for issue ${getImportedColumnValue(entry, "Build Issue #") || entry.issueNumber || entry.id}`}
                        title="Open issue progress"
                        style={{ width: "32px", height: "32px", display: "inline-grid", placeItems: "center", border: "1px solid #93C5FD", borderRadius: "6px", background: "#EFF6FF", color: "#1D4ED8", cursor: "pointer" }}
                      >
                        <FiActivity aria-hidden="true" size={17} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
        </>
      ) : (
        <div style={{ ...cardStyle, marginTop: "12px", maxWidth: "680px" }}>
          <h2 style={{ margin: 0, color: "#0F172A", fontSize: "1.15rem" }}>{isManagingQcStatuses ? "Manage QC Statuses" : "Manage Statuses"}</h2>
          <div style={{ marginTop: "4px", color: "#64748B", fontSize: "0.9rem" }}>{isManagingQcStatuses ? "The saved order is used for unresolved issues in the QC Status dropdown." : "The saved order is used in every Status dropdown for this organization."}</div>

          {isManagingQcStatuses ? (
            <div style={{ marginTop: "18px", borderTop: "1px solid #E2E8F0", paddingTop: "16px" }}>
              <div style={{ ...labelStyle, marginBottom: "8px" }}>Approved QC Users</div>
              <div style={{ display: "grid", gap: "6px" }}>
                {members.length ? members.map((member) => {
                  const isApproved = approvedQcUserIdsDraft.includes(member.id);
                  return (
                    <label key={member.id} style={{ display: "flex", alignItems: "center", gap: "8px", color: "#0F172A", fontSize: "0.88rem", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={isApproved}
                        onChange={(event) => setApprovedQcUserIdsDraft((previous) => event.target.checked ? [...previous, member.id] : previous.filter((userId) => userId !== member.id))}
                      />
                      {member.label}
                    </label>
                  );
                }) : <div style={{ color: "#64748B", fontSize: "0.86rem" }}>No organization users are available.</div>}
              </div>
            </div>
          ) : null}

          <form onSubmit={handleAddManagedStatus} style={{ display: "flex", gap: "8px", marginTop: "18px", flexWrap: "wrap" }}>
            <input
              type="text"
              value={managedNewStatusDraft}
              onChange={(event) => isManagingQcStatuses ? setNewQcStatusDraft(event.target.value) : setNewStatusDraft(event.target.value)}
              placeholder={isManagingQcStatuses ? "New QC status" : "New status"}
              aria-label={isManagingQcStatuses ? "New QC status" : "New status"}
              style={{ ...inputStyle, flex: "1 1 220px" }}
            />
            <button type="submit" style={{ border: "none", borderRadius: "6px", padding: "9px 14px", background: "#0F766E", color: "#FFFFFF", fontWeight: 700, cursor: "pointer" }}>{isManagingQcStatuses ? "Add QC Status" : "Add Status"}</button>
          </form>

          <div style={{ display: "grid", gap: "8px", marginTop: "16px" }}>
            {managedStatusOptionsDraft.map((status, index) => (
              <div key={index} style={{ border: "1px solid #E2E8F0", padding: "10px", background: "#F8FAFC" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <input
                    type="text"
                    value={status}
                    onChange={(event) => handleRenameManagedStatus(index, event.target.value)}
                    aria-label={`${isManagingQcStatuses ? "QC status" : "Status"} name ${index + 1}`}
                    style={{ ...inputStyle, flex: "1 1 160px", minWidth: "160px", fontWeight: 700 }}
                  />
                  <button type="button" onClick={() => handleMoveManagedStatus(index, -1)} disabled={index === 0} aria-label={`Move ${status} up`} style={{ border: "1px solid #CBD5E1", borderRadius: "4px", padding: "5px 8px", background: "#FFFFFF", color: "#334155", cursor: index === 0 ? "not-allowed" : "pointer" }}>Up</button>
                  <button type="button" onClick={() => handleMoveManagedStatus(index, 1)} disabled={index === managedStatusOptionsDraft.length - 1} aria-label={`Move ${status} down`} style={{ border: "1px solid #CBD5E1", borderRadius: "4px", padding: "5px 8px", background: "#FFFFFF", color: "#334155", cursor: index === managedStatusOptionsDraft.length - 1 ? "not-allowed" : "pointer" }}>Down</button>
                  <button type="button" onClick={() => handleDeleteManagedStatus(index)} aria-label={`Delete ${status}`} style={{ border: "none", borderRadius: "4px", padding: "5px 8px", background: "#B91C1C", color: "#FFFFFF", fontWeight: 700, cursor: "pointer" }}>Delete</button>
                </div>
                <label style={{ ...labelStyle, marginTop: "10px" }}>
                  Description
                  <input
                    type="text"
                    value={managedStatusDescriptionsDraft[status] || ""}
                    onChange={(event) => isManagingQcStatuses ? setQcStatusDescriptionsDraft((previous) => ({ ...previous, [status]: event.target.value })) : setStatusDescriptionsDraft((previous) => ({ ...previous, [status]: event.target.value }))}
                    placeholder={`Describe when to use ${status}`}
                    style={{ ...inputStyle, display: "block", width: "100%", marginTop: "4px" }}
                  />
                </label>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "18px" }}>
            <button type="button" onClick={handleDiscardManagedStatuses} disabled={isSavingManagedStatuses} style={{ border: "1px solid #CBD5E1", borderRadius: "6px", padding: "9px 14px", background: "#FFFFFF", color: "#334155", fontWeight: 700, cursor: isSavingManagedStatuses ? "not-allowed" : "pointer" }}>Discard Changes</button>
            <button type="button" onClick={handleSaveManagedStatuses} disabled={isSavingManagedStatuses} style={{ border: "none", borderRadius: "6px", padding: "9px 14px", background: isSavingManagedStatuses ? "#94A3B8" : "#1D4ED8", color: "#FFFFFF", fontWeight: 700, cursor: isSavingManagedStatuses ? "not-allowed" : "pointer" }}>{isSavingManagedStatuses ? "Saving..." : isManagingQcStatuses ? "Save QC Statuses" : "Save Statuses"}</button>
          </div>
        </div>
      )}

      {statusLogEntry ? (
        <div
          role="presentation"
          onMouseDown={() => setStatusLogEntry(null)}
          style={{ position: "fixed", inset: 0, zIndex: 1050, display: "grid", placeItems: "center", padding: "20px", background: "rgba(15, 23, 42, 0.5)" }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="status-log-title"
            onMouseDown={(event) => event.stopPropagation()}
            style={{ width: "min(940px, 100%)", maxHeight: "80vh", overflowY: "auto", background: "#FFFFFF", borderRadius: "8px", padding: "20px", boxShadow: "0 20px 48px rgba(15, 23, 42, 0.28)" }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px" }}>
              <div>
                <h2 id="status-log-title" style={{ margin: 0, color: "#0F172A", fontSize: "1.15rem" }}>Issue Progress</h2>
                <div style={{ marginTop: "4px", color: "#64748B", fontSize: "0.9rem" }}>
                  Issue {getImportedColumnValue(statusLogEntry, "Build Issue #") || statusLogEntry.issueNumber || statusLogEntry.id}
                </div>
              </div>
              <button type="button" onClick={() => setStatusLogEntry(null)} aria-label="Close status log" style={{ border: "none", background: "transparent", color: "#475569", fontSize: "1.4rem", cursor: "pointer", lineHeight: 1 }}>x</button>
            </div>

            <div style={{ marginTop: "20px", overflowX: "auto", paddingBottom: "6px" }}>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(statusOptions.length, 1)}, minmax(150px, 1fr))`, minWidth: `${Math.max(statusOptions.length * 150, 150)}px` }}>
                {statusOptions.map((status, index) => {
                  const currentStatus = getStatusSelectValue(getImportedColumnValue(statusLogEntry, "Status"));
                  const currentIndex = statusOptions.findIndex((option) => option.toLocaleLowerCase() === currentStatus.toLocaleLowerCase());
                  const reachedAt = statusReachedAtByKey.get(status.toLocaleLowerCase());
                  const isReached = Boolean(reachedAt) || (currentIndex >= index && currentIndex !== -1);
                  return (
                    <div key={status} style={{ position: "relative", padding: "0 8px 0 0" }}>
                      {index > 0 ? <div style={{ position: "absolute", top: "10px", right: "calc(100% - 10px)", width: "calc(100% - 20px)", height: "4px", background: isReached ? "#0F766E" : "#CBD5E1" }} /> : null}
                      <div style={{ position: "relative", width: "24px", height: "24px", borderRadius: "50%", display: "grid", placeItems: "center", background: isReached ? "#0F766E" : "#CBD5E1", color: "#FFFFFF", fontSize: "0.75rem", fontWeight: 700 }}>{index + 1}</div>
                      <div style={{ marginTop: "8px", color: "#0F172A", fontWeight: 700, fontSize: "0.88rem" }}>{status}</div>
                      {statusDescriptions[status] ? <div style={{ marginTop: "3px", color: "#64748B", fontSize: "0.78rem" }}>{statusDescriptions[status]}</div> : null}
                      <div style={{ marginTop: "4px", color: reachedAt ? "#0F766E" : "#94A3B8", fontSize: "0.76rem" }}>{reachedAt ? formatDateTime(reachedAt) : "Not reached"}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ marginTop: "20px", borderTop: "1px solid #E2E8F0", paddingTop: "16px" }}>
              <div style={{ color: "#0F172A", fontSize: "0.95rem", fontWeight: 700 }}>QC Status</div>
              <div style={{ marginTop: "10px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {getQcStatusOptionsForEntry(selectedQcStatusValues, qcStatusOptions).map((status) => {
                  const isSelected = selectedQcStatusValues.some((value) => value.toLocaleLowerCase() === status.toLocaleLowerCase());
                  const selectedAt = selectedQcStatusTimestampByKey.get(status.toLocaleLowerCase());
                  return (
                    <div key={status} style={{ display: "flex", alignItems: "center", gap: "6px", border: `1px solid ${isSelected ? "#93C5FD" : "#CBD5E1"}`, borderRadius: "6px", padding: "6px 8px", background: isSelected ? "#EFF6FF" : "#F8FAFC", color: isSelected ? "#1D4ED8" : "#64748B", fontSize: "0.82rem", fontWeight: 700 }}>
                      <span aria-hidden="true" style={{ width: "16px", height: "16px", display: "grid", placeItems: "center", borderRadius: "50%", background: isSelected ? "#1D4ED8" : "#CBD5E1", color: "#FFFFFF", fontSize: "0.7rem" }}>{isSelected ? "✓" : ""}</span>
                      <span>
                        <span style={{ display: "block" }}>{status}</span>
                        {isSelected ? <span style={{ display: "block", marginTop: "2px", color: "#475569", fontSize: "0.72rem", fontWeight: 400 }}>{selectedAt ? formatDateTime(selectedAt) : "Time not recorded"}</span> : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ marginTop: "18px", display: "grid", gap: "10px" }}>
              {selectedIssueActivityHistory.length ? (
                [...selectedIssueActivityHistory].reverse().map((change, reverseIndex) => {
                  const historyIndex = selectedIssueActivityHistory.length - reverseIndex - 1;
                  const previousChange = selectedIssueActivityHistory[historyIndex - 1];
                  return (
                  <div key={`${change.activityType}-${change.changedAt?.seconds || "local"}-${reverseIndex}`} style={{ borderLeft: `3px solid ${change.activityType === "QC Status" ? "#1D4ED8" : "#0F766E"}`, padding: "8px 10px", background: "#F8FAFC" }}>
                    <div style={{ color: "#0F172A", fontWeight: 700 }}>
                      {change.activityType}: {change.previousStatus || "No status"} to {change.nextStatus || "No status"}
                    </div>
                    <div style={{ marginTop: "3px", color: "#64748B", fontSize: "0.82rem" }}>
                      {formatDateTime(change.changedAt)}{change.changedByEmail ? ` by ${change.changedByEmail}` : ""}
                    </div>
                    <div style={{ marginTop: "3px", color: "#0F766E", fontSize: "0.82rem", fontWeight: 700 }}>
                      {previousChange ? `${formatElapsedHours(previousChange.changedAt, change.changedAt)} since the previous update` : "First recorded issue update"}
                    </div>
                  </div>
                  );
                })
              ) : (
                <div style={{ color: "#64748B" }}>No status or QC updates recorded yet. Timing begins after the first recorded update.</div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {qcStatusLogEntry ? (
        <div
          role="presentation"
          onMouseDown={() => setQcStatusLogEntry(null)}
          style={{ position: "fixed", inset: 0, zIndex: 1050, display: "grid", placeItems: "center", padding: "20px", background: "rgba(15, 23, 42, 0.5)" }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="qc-status-log-title"
            onMouseDown={(event) => event.stopPropagation()}
            style={{ width: "min(620px, 100%)", maxHeight: "80vh", overflowY: "auto", background: "#FFFFFF", borderRadius: "8px", padding: "20px", boxShadow: "0 20px 48px rgba(15, 23, 42, 0.28)" }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px" }}>
              <div>
                <h2 id="qc-status-log-title" style={{ margin: 0, color: "#0F172A", fontSize: "1.15rem" }}>QC Status Log</h2>
                <div style={{ marginTop: "4px", color: "#64748B", fontSize: "0.9rem" }}>
                  Issue {getImportedColumnValue(qcStatusLogEntry, "Build Issue #") || qcStatusLogEntry.issueNumber || qcStatusLogEntry.id}
                </div>
              </div>
              <button type="button" onClick={() => setQcStatusLogEntry(null)} aria-label="Close QC status log" style={{ border: "none", background: "transparent", color: "#475569", fontSize: "1.4rem", cursor: "pointer", lineHeight: 1 }}>x</button>
            </div>

            <div style={{ marginTop: "18px", display: "grid", gap: "10px" }}>
              {selectedQcStatusHistory.length ? (
                [...selectedQcStatusHistory].reverse().map((change, reverseIndex) => {
                  const historyIndex = selectedQcStatusHistory.length - reverseIndex - 1;
                  const previousChange = selectedQcStatusHistory[historyIndex - 1];
                  return (
                    <div key={`${change.changedAt?.seconds || "local"}-${reverseIndex}`} style={{ borderLeft: "3px solid #1D4ED8", padding: "8px 10px", background: "#F8FAFC" }}>
                      <div style={{ color: "#0F172A", fontWeight: 700 }}>{change.previousStatus || "No QC status"} to {change.nextStatus || "No QC status"}</div>
                      <div style={{ marginTop: "3px", color: "#64748B", fontSize: "0.82rem" }}>{formatDateTime(change.changedAt)}{change.changedByEmail ? ` by ${change.changedByEmail}` : ""}</div>
                      <div style={{ marginTop: "3px", color: "#1D4ED8", fontSize: "0.82rem", fontWeight: 700 }}>{previousChange ? `${formatElapsedHours(previousChange.changedAt, change.changedAt)} since the previous QC update` : "First recorded QC status change"}</div>
                    </div>
                  );
                })
              ) : (
                <div style={{ color: "#64748B" }}>No QC status changes recorded yet.</div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default IssuesMainList;
