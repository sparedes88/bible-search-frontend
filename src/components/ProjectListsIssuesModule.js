import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { toast } from "react-toastify";
import { useAuth } from "../contexts/AuthContext";
import { db } from "../firebase";
import ChurchHeader from "./ChurchHeader";
import commonStyles from "../pages/commonStyles";

const containerStyle = {
  width: "100vw",
  maxWidth: "100vw",
  marginLeft: "calc(50% - 50vw)",
  marginRight: "calc(50% - 50vw)",
  padding: "1rem clamp(12px, 2vw, 24px)",
};

const panelStyle = {
  background: "transparent",
  border: "none",
  borderRadius: "0",
  padding: "0",
};

const inputStyle = {
  width: "100%",
  border: "1px solid #D1D5DB",
  borderRadius: "8px",
  padding: "10px 12px",
  fontSize: "0.95rem",
  boxSizing: "border-box",
};

const textareaStyle = {
  ...inputStyle,
  resize: "vertical",
  minHeight: "72px",
};

const buttonBaseStyle = {
  border: "none",
  borderRadius: "8px",
  padding: "8px 12px",
  color: "#FFFFFF",
  fontWeight: 600,
  cursor: "pointer",
};

const STATUS_OPTIONS = ["Open", "In Progress", "On Hold", "Resolved", "Closed", "Complete"];
const CARD_REVIEW_STEP_OPTIONS = [
  { id: "populate", label: "Populate" },
  { id: "coordinate_internal", label: "Coordinate Internal" },
  { id: "coordinate_other_trades", label: "Coordinate Other Trades" },
  { id: "existing_before", label: "Existing Modeling" },
  { id: "add_hangers", label: "Add Hangers" },
  { id: "add_hangers_with_seismic", label: "Add Hangers With Seismic" },
  { id: "shop_creation", label: "Shop Creation" },
  { id: "change_orders", label: "Change Orders" },
];

const CARD_REVIEW_STEP_LABEL_BY_ID = CARD_REVIEW_STEP_OPTIONS.reduce((accumulator, option) => {
  accumulator[option.id] = option.label;
  return accumulator;
}, {});

const normalizeValue = (value) => String(value || "").trim();

const normalizeCardReviewStep = (value) => {
  const normalizedValue = normalizeValue(value).toLowerCase().replace(/\s+/g, "_");
  return CARD_REVIEW_STEP_LABEL_BY_ID[normalizedValue] ? normalizedValue : "";
};

const normalizeDayCount = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) return 0;
  return Math.round(numericValue * 100) / 100;
};

const MAX_ISSUE_NOTES = 30;

const normalizeIssueNotes = (value) => {
  if (!Array.isArray(value)) return [];

  return value
    .filter((note) => note && typeof note === "object")
    .map((note) => ({
      text: String(note.text || "").trim(),
      createdAtIso: String(note.createdAtIso || "").trim(),
      createdByUid: String(note.createdByUid || "").trim(),
      createdByEmail: String(note.createdByEmail || "").trim(),
      createdByName: String(note.createdByName || "").trim(),
    }))
    .filter((note) => note.text);
};

const formatIssueNoteTimestamp = (value) => {
  const parsedDate = value ? new Date(value) : null;
  if (!parsedDate || Number.isNaN(parsedDate.getTime())) return "Unknown time";
  return parsedDate.toLocaleString();
};

const getIssueNoteAuthorLabel = (note) => {
  const email = String(note?.createdByEmail || "").trim();
  const name = String(note?.createdByName || "").trim();
  const uid = String(note?.createdByUid || "").trim();
  return email || name || uid || "Unknown user";
};

const buildIssueNotesTooltip = (notes) => {
  if (!notes.length) return "No notes yet";

  return notes
    .slice(-10)
    .reverse()
    .map((note) => {
      const author = getIssueNoteAuthorLabel(note);
      const timestamp = formatIssueNoteTimestamp(note.createdAtIso);
      return `${author} at ${timestamp}: ${note.text}`;
    })
    .join("\n");
};

const getCurrentDateKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

const ProjectListsIssuesModule = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = searchParams.get("tab") || "projects";
  const selectedProjectId = searchParams.get("project") || "";
  const selectedBucketCardId = searchParams.get("bucketCard") || "all";

  const setActiveTab = (tab) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", tab);
      return next;
    });

  const setSelectedProjectId = (pid) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (pid) next.set("project", pid);
      else next.delete("project");
      next.delete("bucketCard");
      return next;
    });

  const setSelectedBucketCardId = (bucketId) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (bucketId && bucketId !== "all") next.set("bucketCard", bucketId);
      else next.delete("bucketCard");
      return next;
    });

  const routePrefix =
    typeof window !== "undefined" && window.location?.pathname?.includes("/church/")
      ? "/church"
      : "/organization";

  // â”€â”€ Collections â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const projectsRef = useMemo(() => collection(db, "churches", id, "projectListIssueProjects"), [id]);
  const bucketsRef = useMemo(
    () =>
      selectedProjectId
        ? collection(db, "churches", id, "projectListIssueProjects", selectedProjectId, "buckets")
        : null,
    [id, selectedProjectId]
  );
  const issuesRef = useMemo(
    () =>
      selectedProjectId
        ? collection(db, "churches", id, "projectListIssueProjects", selectedProjectId, "issues")
        : null,
    [id, selectedProjectId]
  );
  const dayCountLogsRef = useMemo(
    () =>
      selectedProjectId
        ? collection(db, "churches", id, "projectListIssueProjects", selectedProjectId, "dayCountLogs")
        : null,
    [id, selectedProjectId]
  );

  // â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [projects, setProjects] = useState([]);
  const [issues, setIssues] = useState([]);
  const [buckets, setBuckets] = useState([]);

  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingIssues, setLoadingIssues] = useState(false);
  const [loadingBuckets, setLoadingBuckets] = useState(false);

  // Project form
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [projectDraft, setProjectDraft] = useState({ name: "", description: "" });
  const [editingProjectId, setEditingProjectId] = useState("");
  const [editProjectDraft, setEditProjectDraft] = useState({ name: "", description: "" });
  const [isManagingProjects, setIsManagingProjects] = useState(false);
  const [selectedManageProjectId, setSelectedManageProjectId] = useState("");

  // Issue form
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [issueDraft, setIssueDraft] = useState({ issueNumber: "", status: "Open", bucketId: "" });
  const [lastUsedIssueBucketId, setLastUsedIssueBucketId] = useState("");
  const [editingIssueId, setEditingIssueId] = useState("");
  const [editIssueDraft, setEditIssueDraft] = useState({ issueNumber: "", title: "", description: "", status: "Open", bucketId: "" });
  const [issueSearchQuery, setIssueSearchQuery] = useState("");
  const [bucketTabIssueSearchQuery, setBucketTabIssueSearchQuery] = useState("");
  const [completedDateFrom, setCompletedDateFrom] = useState("");
  const [completedDateTo, setCompletedDateTo] = useState("");
  const [projectDayCountDraft, setProjectDayCountDraft] = useState("");
  const [dayCountLogs, setDayCountLogs] = useState([]);
  const [loadingDayCountLogs, setLoadingDayCountLogs] = useState(false);

  // Bucket form
  const [showBucketForm, setShowBucketForm] = useState(false);
  const [bucketDraft, setBucketDraft] = useState({
    name: "",
    description: "",
    cardReviewProjectId: "",
    cardReviewStep: "",
    cardReviewCardRef: "",
  });
  const [editingBucketId, setEditingBucketId] = useState("");
  const [editBucketDraft, setEditBucketDraft] = useState({
    name: "",
    description: "",
    cardReviewProjectId: "",
    cardReviewStep: "",
    cardReviewCardRef: "",
  });
  const [isManagingBuckets, setIsManagingBuckets] = useState(false);
  const [selectedManageBucketId, setSelectedManageBucketId] = useState("");
  const [draggedBucketId, setDraggedBucketId] = useState("");
  const [isReorderingBuckets, setIsReorderingBuckets] = useState(false);
  const [cardReviewEntries, setCardReviewEntries] = useState([]);
  const [loadingCardReviewEntries, setLoadingCardReviewEntries] = useState(false);
  const [organizationUsers, setOrganizationUsers] = useState([]);
  const [loadingOrganizationUsers, setLoadingOrganizationUsers] = useState(false);
  const [taskAssigneeUserId, setTaskAssigneeUserId] = useState("");
  const [taskBucketIds, setTaskBucketIds] = useState([]);
  const [movingIssueId, setMovingIssueId] = useState("");
  const [movingIssueBucketId, setMovingIssueBucketId] = useState("");
  const [selectedIssueNotesIssueId, setSelectedIssueNotesIssueId] = useState("");
  const [issueNoteDraft, setIssueNoteDraft] = useState("");
  const [showCompletedByBucketId, setShowCompletedByBucketId] = useState({});
  const [bucketVisibilityFilterIds, setBucketVisibilityFilterIds] = useState([]);
  const [bucketFilterSearchQuery, setBucketFilterSearchQuery] = useState("");

  // Import issues
  const [showImportIssuesPanel, setShowImportIssuesPanel] = useState(false);
  const [importIssuesRows, setImportIssuesRows] = useState([]);
  const [importIssuesDefaultBucketId, setImportIssuesDefaultBucketId] = useState("");
  const [importIssuesLoading, setImportIssuesLoading] = useState(false);
  const importIssuesFileRef = useRef(null);

  // Import buckets
  const [showImportBucketsPanel, setShowImportBucketsPanel] = useState(false);
  const [importBucketsRows, setImportBucketsRows] = useState([]);
  const [importBucketsLoading, setImportBucketsLoading] = useState(false);
  const importBucketsFileRef = useRef(null);

  // â”€â”€ Grouped issues by bucket â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const issuesByBucket = useMemo(() => {
    const grouped = new Map();

    buckets.forEach((bucket) => {
      grouped.set(bucket.id, {
        id: bucket.id,
        name: String(bucket.name || "").trim() || "Untitled Bucket",
        issues: [],
      });
    });

    const unassignedKey = "__unassigned__";
    grouped.set(unassignedKey, { id: unassignedKey, name: "No Bucket", issues: [] });

    issues.forEach((issue) => {
      const bid = String(issue.bucketId || "").trim();
      if (bid && grouped.has(bid)) {
        grouped.get(bid).issues.push(issue);
      } else {
        grouped.get(unassignedKey).issues.push(issue);
      }
    });

    return Array.from(grouped.values()).filter((g) => g.issues.length > 0);
  }, [buckets, issues]);

  const filteredIssuesByBucket = useMemo(() => {
    const normalizedQuery = issueSearchQuery.trim().toLowerCase();
    const selectedGroups = selectedBucketCardId === "all"
      ? issuesByBucket
      : issuesByBucket.filter((g) => g.id === selectedBucketCardId);

    if (!normalizedQuery) return selectedGroups;

    return selectedGroups
      .map((group) => ({
        ...group,
        issues: group.issues.filter((issue) => {
          const bucketName = buckets.find((bucket) => bucket.id === issue.bucketId)?.name || issue.bucketName || "";
          return [issue.issueNumber, issue.title, issue.description, issue.status, bucketName]
            .some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
        }),
      }))
      .filter((group) => group.issues.length > 0);
  }, [buckets, issueSearchQuery, issuesByBucket, selectedBucketCardId]);

  const bucketTabDateFilteredIssuesByBucket = useMemo(() => {
    if (!completedDateFrom && !completedDateTo) {
      return filteredIssuesByBucket;
    }

    return filteredIssuesByBucket
      .map((group) => ({
        ...group,
        issues: group.issues.filter((issue) => {
          const completedAtDate = issue.completedAt?.toDate?.();
          if (!completedAtDate) {
            return false;
          }

          const completedDateKey = `${completedAtDate.getFullYear()}-${String(completedAtDate.getMonth() + 1).padStart(2, "0")}-${String(completedAtDate.getDate()).padStart(2, "0")}`;
          if (completedDateFrom && completedDateKey < completedDateFrom) {
            return false;
          }
          if (completedDateTo && completedDateKey > completedDateTo) {
            return false;
          }
          return true;
        }),
      }))
      .filter((group) => group.issues.length > 0);
  }, [completedDateFrom, completedDateTo, filteredIssuesByBucket]);

  const bucketFilterOptions = useMemo(
    () =>
      bucketTabDateFilteredIssuesByBucket.map((group) => ({
        id: group.id,
        name: group.name,
        count: group.issues.length,
      })).sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      })),
    [bucketTabDateFilteredIssuesByBucket]
  );

  const visibleBucketFilterOptions = useMemo(() => {
    const normalizedSearch = String(bucketFilterSearchQuery || "").trim().toLowerCase();
    if (!normalizedSearch) return bucketFilterOptions;

    return bucketFilterOptions.filter((option) =>
      String(option.name || "").toLowerCase().includes(normalizedSearch)
    );
  }, [bucketFilterOptions, bucketFilterSearchQuery]);

  const selectedBucketFilterLabel = useMemo(() => {
    if (bucketVisibilityFilterIds.length === 0) return "All buckets";

    const selectedNames = bucketFilterOptions
      .filter((option) => bucketVisibilityFilterIds.includes(option.id))
      .map((option) => option.name);

    if (selectedNames.length === 0) return "All buckets";
    if (selectedNames.length <= 2) return selectedNames.join(", ");
    return `${selectedNames[0]}, ${selectedNames[1]} +${selectedNames.length - 2}`;
  }, [bucketFilterOptions, bucketVisibilityFilterIds]);

  const bucketTabVisibleIssuesByBucket = useMemo(() => {
    if (!Array.isArray(bucketVisibilityFilterIds) || bucketVisibilityFilterIds.length === 0) {
      return bucketTabDateFilteredIssuesByBucket;
    }

    const selectedIds = new Set(bucketVisibilityFilterIds.map((value) => String(value || "").trim()).filter(Boolean));
    return bucketTabDateFilteredIssuesByBucket.filter((group) => selectedIds.has(String(group.id || "").trim()));
  }, [bucketTabDateFilteredIssuesByBucket, bucketVisibilityFilterIds]);

  const bucketTabSearchedIssuesByBucket = useMemo(() => {
    const normalizedQuery = String(bucketTabIssueSearchQuery || "").trim().toLowerCase();
    if (!normalizedQuery) return bucketTabVisibleIssuesByBucket;
    return bucketTabVisibleIssuesByBucket
      .map((group) => ({
        ...group,
        issues: group.issues.filter((issue) =>
          String(issue.title || "").toLowerCase().includes(normalizedQuery) ||
          String(issue.issueNumber || "").toLowerCase().includes(normalizedQuery) ||
          String(issue.description || "").toLowerCase().includes(normalizedQuery)
        ),
      }))
      .filter((group) => group.issues.length > 0);
  }, [bucketTabVisibleIssuesByBucket, bucketTabIssueSearchQuery]);

  const bucketGrandTotals = useMemo(() => {
    const perBucket = bucketTabDateFilteredIssuesByBucket.map((group) => {
      const completed = group.issues.filter(
        (issue) => String(issue.status || "").toLowerCase() === "complete"
      ).length;
      const total = group.issues.length;
      const remaining = Math.max(total - completed, 0);
      return {
        id: group.id,
        name: group.name,
        total,
        completed,
        remaining,
      };
    });

    const totals = perBucket.reduce(
      (accumulator, item) => ({
        total: accumulator.total + item.total,
        completed: accumulator.completed + item.completed,
        remaining: accumulator.remaining + item.remaining,
      }),
      { total: 0, completed: 0, remaining: 0 }
    );

    const completionPercent = totals.total > 0
      ? Math.round((totals.completed / totals.total) * 100)
      : 0;

    const topBuckets = perBucket
      .slice()
      .sort((left, right) => {
        if (right.remaining !== left.remaining) return right.remaining - left.remaining;
        return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
      })
      .slice(0, 8);

    return {
      ...totals,
      completionPercent,
      topBuckets,
    };
  }, [bucketTabDateFilteredIssuesByBucket]);

  const selectedIssueForNotes = useMemo(() => {
    if (!selectedIssueNotesIssueId) return null;
    return issues.find((issue) => issue.id === selectedIssueNotesIssueId) || null;
  }, [issues, selectedIssueNotesIssueId]);

  const selectedIssueModalNotes = useMemo(
    () => normalizeIssueNotes(selectedIssueForNotes?.notes),
    [selectedIssueForNotes]
  );

  const visibleIssuesCount = useMemo(
    () => filteredIssuesByBucket.reduce((count, group) => count + group.issues.length, 0),
    [filteredIssuesByBucket]
  );

  const issuesTableRows = useMemo(
    () => filteredIssuesByBucket.flatMap((group) =>
      group.issues.map((issue) => ({
        ...issue,
        groupName: group.name,
      }))
    ),
    [filteredIssuesByBucket]
  );

  const shouldAutoShowIssueForm = useMemo(() => {
    if (activeTab !== "issues" || !selectedProjectId) return false;
    const normalizedIssueSearch = String(issueSearchQuery || "").trim();
    return !!normalizedIssueSearch && issuesTableRows.length === 0;
  }, [activeTab, issueSearchQuery, issuesTableRows.length, selectedProjectId]);

  const effectiveShowIssueForm = showIssueForm || shouldAutoShowIssueForm;

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  const selectedProjectTotalDayCount = useMemo(
    () => normalizeDayCount(selectedProject?.dayCount),
    [selectedProject]
  );

  const dailyDayCountSeries = useMemo(() => {
    const dailyMap = new Map();
    dayCountLogs.forEach((entry) => {
      if (!entry.recordedDate) return;
      dailyMap.set(entry.recordedDate, normalizeDayCount(entry.dayCount));
    });

    return Array.from(dailyMap.entries())
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [dayCountLogs]);

  const todayDateKey = useMemo(() => getCurrentDateKey(), []);

  const todayTaskAssignments = useMemo(() => {
    const tasksByDate = selectedProject?.dailyTasks || {};
    const tasksForToday = tasksByDate?.[todayDateKey];
    return Array.isArray(tasksForToday) ? tasksForToday : [];
  }, [selectedProject, todayDateKey]);

  const tasksByUserId = useMemo(() => {
    const map = new Map();
    todayTaskAssignments.forEach((assignment) => {
      const uid = String(assignment?.userId || "").trim();
      if (!uid) return;
      const existing = map.get(uid) || [];
      existing.push(assignment);
      map.set(uid, existing);
    });
    return map;
  }, [todayTaskAssignments]);

  const hasTodayDayCountLog = useMemo(
    () => dayCountLogs.some((entry) => entry.recordedDate === todayDateKey),
    [dayCountLogs, todayDateKey]
  );

  const cardReviewProjects = useMemo(() => {
    const projectMap = cardReviewEntries.reduce((accumulator, entry) => {
      const projectId = normalizeValue(entry.projectId);
      if (!projectId) return accumulator;

      const existing = accumulator[projectId] || {
        id: projectId,
        label: normalizeValue(entry.projectName) || projectId,
      };

      if (!existing.label && normalizeValue(entry.projectName)) {
        existing.label = normalizeValue(entry.projectName);
      }

      accumulator[projectId] = existing;
      return accumulator;
    }, {});

    return Object.values(projectMap).sort((left, right) =>
      String(left.label || left.id).localeCompare(String(right.label || right.id), undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );
  }, [cardReviewEntries]);

  const cardReviewCardsByProjectAndStep = useMemo(() => {
    return cardReviewEntries.reduce((accumulator, entry) => {
      const projectId = normalizeValue(entry.projectId);
      const step = normalizeCardReviewStep(entry.step);
      if (!projectId || !step) return accumulator;

      const projectBucket = accumulator[projectId] || {};
      const existing = projectBucket[step] || [];
      existing.push(entry);
      projectBucket[step] = existing;
      accumulator[projectId] = projectBucket;
      return accumulator;
    }, {});
  }, [cardReviewEntries]);

  const getCardReviewCardsForSelection = (projectId, stepId) => {
    const normalizedProjectId = normalizeValue(projectId);
    const normalizedStep = normalizeCardReviewStep(stepId);
    if (!normalizedProjectId || !normalizedStep) return [];
    return cardReviewCardsByProjectAndStep?.[normalizedProjectId]?.[normalizedStep] || [];
  };

  const getFirstCardForSelection = (projectId, stepId) => {
    const cardsForStep = getCardReviewCardsForSelection(projectId, stepId);
    return cardsForStep.length > 0 ? cardsForStep[0].cardRef : "";
  };

  useEffect(() => {
    setProjectDayCountDraft(String(selectedProject?.dayCount ?? ""));
  }, [selectedProjectId, selectedProject]);

  useEffect(() => {
    if (!dayCountLogsRef) {
      setDayCountLogs([]);
      return;
    }

    setLoadingDayCountLogs(true);
    const unsubscribe = onSnapshot(
      query(dayCountLogsRef, orderBy("recordedAt", "asc")),
      (snapshot) => {
        const logs = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() || {};
          const recordedAtDate = data.recordedAt?.toDate?.();
          const fallbackDate = recordedAtDate
            ? `${recordedAtDate.getFullYear()}-${String(recordedAtDate.getMonth() + 1).padStart(2, "0")}-${String(recordedAtDate.getDate()).padStart(2, "0")}`
            : "";

          return {
            id: docSnap.id,
            dayCount: normalizeDayCount(data.dayCount),
            recordedDate: String(data.recordedDate || fallbackDate || ""),
            recordedBy: String(data.recordedBy || ""),
            recordedAt: recordedAtDate || null,
          };
        });

        setDayCountLogs(logs);
        setLoadingDayCountLogs(false);
      },
      (error) => {
        console.error("Failed to load day count logs:", error);
        setLoadingDayCountLogs(false);
      }
    );

    return unsubscribe;
  }, [dayCountLogsRef]);

  useEffect(() => {
    if (!id) {
      setCardReviewEntries([]);
      return () => {};
    }

    const floorProgressDocRef = doc(db, "churches", id, "timeRotateFloorPlanner", "floorCategoryProgress");
    setLoadingCardReviewEntries(true);

    const unsubscribe = onSnapshot(
      floorProgressDocRef,
      (snapshot) => {
        const data = snapshot.data() || {};
        const rawCardReview = data.cardReview;
        if (!rawCardReview || typeof rawCardReview !== "object" || Array.isArray(rawCardReview)) {
          setCardReviewEntries([]);
          setLoadingCardReviewEntries(false);
          return;
        }

        const dedupedByProjectCardRef = new Map();

        Object.entries(rawCardReview).forEach(([projectIdKey, projectValue]) => {
          const projectId = normalizeValue(projectIdKey);
          if (!projectValue || typeof projectValue !== "object" || Array.isArray(projectValue)) return;

          Object.values(projectValue).forEach((floorValue) => {
            if (!floorValue || typeof floorValue !== "object" || Array.isArray(floorValue)) return;

            Object.entries(floorValue).forEach(([cardRefKey, entryValue]) => {
              const cardRef = normalizeValue(cardRefKey);
              if (!cardRef) return;

              const step = normalizeCardReviewStep(entryValue?.step || "");
              if (!step) return;

              const updatedAt = Number(entryValue?.updatedAt) || 0;
              const dedupeKey = `${projectId}::${cardRef}`;
              const existing = dedupedByProjectCardRef.get(dedupeKey);
              if (!existing || updatedAt >= existing.updatedAt) {
                dedupedByProjectCardRef.set(dedupeKey, {
                  projectId,
                  projectName: projectId,
                  cardRef,
                  step,
                  updatedAt,
                });
              }
            });
          });
        });

        const nextEntries = Array.from(dedupedByProjectCardRef.values()).sort((left, right) => {
          const projectCompare = left.projectId.localeCompare(right.projectId, undefined, {
            numeric: true,
            sensitivity: "base",
          });
          if (projectCompare !== 0) return projectCompare;
          return left.cardRef.localeCompare(right.cardRef, undefined, { numeric: true, sensitivity: "base" });
        }
        );

        setCardReviewEntries(nextEntries);
        setLoadingCardReviewEntries(false);
      },
      (error) => {
        console.error("Failed to load Card Review entries for buckets:", error);
        setCardReviewEntries([]);
        setLoadingCardReviewEntries(false);
      }
    );

    return unsubscribe;
  }, [id]);

  useEffect(() => {
    if (!id) {
      setOrganizationUsers([]);
      return;
    }

    setLoadingOrganizationUsers(true);
    const unsubscribe = onSnapshot(
      query(collection(db, "users"), where("churchId", "==", id)),
      (snapshot) => {
        const users = snapshot.docs
          .map((docSnap) => {
            const data = docSnap.data() || {};
            const fullName = String(
              data.displayName
              || data.name
              || `${String(data.firstName || "").trim()} ${String(data.lastName || "").trim()}`.trim()
              || data.email
              || docSnap.id
            ).trim();

            return {
              id: docSnap.id,
              name: fullName,
              email: String(data.email || "").trim(),
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name));

        setOrganizationUsers(users);
        setLoadingOrganizationUsers(false);
      },
      (error) => {
        console.error("Failed to load organization users:", error);
        toast.error("Failed to load users.");
        setOrganizationUsers([]);
        setLoadingOrganizationUsers(false);
      }
    );

    return unsubscribe;
  }, [id]);

  // â”€â”€ Load projects (realtime) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (!id) return;
    setLoadingProjects(true);
    const unsubscribe = onSnapshot(
      query(projectsRef, orderBy("createdAt", "desc")),
      (snap) => {
        setProjects(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoadingProjects(false);
      },
      (error) => {
        console.error("Failed to load projects:", error);
        toast.error("Failed to load projects.");
        setLoadingProjects(false);
      }
    );
    return unsubscribe;
  }, [id, projectsRef]);

  // â”€â”€ Load issues for selected project (realtime) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (!issuesRef) {
      setIssues([]);
      return;
    }
    setLoadingIssues(true);
    const unsubscribe = onSnapshot(
      query(issuesRef, orderBy("createdAt", "desc")),
      (snap) => {
        setIssues(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoadingIssues(false);
      },
      (error) => {
        console.error("Failed to load issues:", error);
        toast.error("Failed to load issues.");
        setIssues([]);
        setLoadingIssues(false);
      }
    );
    return unsubscribe;
  }, [issuesRef]);

  // â”€â”€ Load buckets (realtime) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (!bucketsRef) {
      setBuckets([]);
      return;
    }
    setLoadingBuckets(true);
    const unsubscribe = onSnapshot(
      query(bucketsRef),
      (snap) => {
        const nextBuckets = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        nextBuckets.sort((left, right) => {
          const leftOrder = Number.isFinite(Number(left.sortOrder)) ? Number(left.sortOrder) : Number.MAX_SAFE_INTEGER;
          const rightOrder = Number.isFinite(Number(right.sortOrder)) ? Number(right.sortOrder) : Number.MAX_SAFE_INTEGER;
          if (leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
          }

          return String(left.name || "").localeCompare(String(right.name || ""), undefined, {
            numeric: true,
            sensitivity: "base",
          });
        });
        setBuckets(nextBuckets);
        setLoadingBuckets(false);
      },
      (error) => {
        console.error("Failed to load buckets:", error);
        toast.error("Failed to load buckets.");
        setLoadingBuckets(false);
      }
    );
    return unsubscribe;
  }, [bucketsRef]);

  // â”€â”€ Project CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleCreateProject = async (event) => {
    event.preventDefault();
    const name = String(projectDraft.name || "").trim() || "Untitled Project";
    try {
      const newDoc = await addDoc(projectsRef, {
        name,
        description: String(projectDraft.description || "").trim(),
        createdBy: user?.uid || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setProjectDraft({ name: "", description: "" });
      setShowProjectForm(false);
      setSelectedProjectId(newDoc.id);
      toast.success("Project created.");
    } catch (error) {
      console.error("Failed to create project:", error);
      toast.error("Could not create project.");
    }
  };

  const handleUpdateProject = async (projectId) => {
    const name = String(editProjectDraft.name || "").trim();
    if (!name) { toast.warning("Project name is required."); return; }
    try {
      await updateDoc(doc(db, "churches", id, "projectListIssueProjects", projectId), {
        name,
        description: String(editProjectDraft.description || "").trim(),
        updatedAt: serverTimestamp(),
      });
      setEditingProjectId("");
      toast.success("Project updated.");
    } catch (error) {
      console.error("Failed to update project:", error);
      toast.error("Could not update project.");
    }
  };

  const handleDeleteProject = async (projectId) => {
    if (!window.confirm("Delete this project? All issues inside it will also be deleted.")) return;
    try {
      const issuesSnap = await getDocs(
        collection(db, "churches", id, "projectListIssueProjects", projectId, "issues")
      );
      for (const issueDoc of issuesSnap.docs) {
        await deleteDoc(doc(db, "churches", id, "projectListIssueProjects", projectId, "issues", issueDoc.id));
      }
      await deleteDoc(doc(db, "churches", id, "projectListIssueProjects", projectId));
      if (selectedProjectId === projectId) setSelectedProjectId("");
      toast.success("Project deleted.");
    } catch (error) {
      console.error("Failed to delete project:", error);
      toast.error("Could not delete project.");
    }
  };

  // â”€â”€ Issue CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleCreateIssue = async (event) => {
    event.preventDefault();
    if (!selectedProjectId) { toast.warning("Select a project first."); return; }
    const issueNumber = String(issueDraft.issueNumber || "").trim();
    const bucketId = String(issueDraft.bucketId || "").trim();
    if (!issueNumber) { toast.warning("Issue number is required."); return; }
    if (!bucketId) { toast.warning("Please assign a bucket card."); return; }
    const duplicateIssue = issues.some(
      (issue) => String(issue.issueNumber || "").trim().toLowerCase() === issueNumber.toLowerCase()
    );
    if (duplicateIssue) { toast.warning("That issue number already exists in this project."); return; }
    const selectedBucket = buckets.find((b) => b.id === bucketId);
    try {
      await addDoc(issuesRef, {
        issueNumber,
        title: "",
        description: "",
        status: issueDraft.status || "Open",
        bucketId,
        bucketName: selectedBucket?.name || "",
        createdBy: user?.uid || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setLastUsedIssueBucketId(bucketId);
      setIssueDraft({ issueNumber: "", status: "Open", bucketId });
      setIssueSearchQuery("");
      toast.success("Issue created.");
    } catch (error) {
      console.error("Failed to create issue:", error);
      toast.error("Could not create issue.");
    }
  };

  const handleUpdateIssue = async (issueId) => {
    const issueNumber = String(editIssueDraft.issueNumber || "").trim();
    if (!issueNumber) { toast.warning("Issue number is required."); return; }
    const duplicateIssue = issues.some(
      (issue) => issue.id !== issueId && String(issue.issueNumber || "").trim().toLowerCase() === issueNumber.toLowerCase()
    );
    if (duplicateIssue) { toast.warning("That issue number already exists in this project."); return; }
    const selectedBucket = buckets.find((b) => b.id === editIssueDraft.bucketId);
    try {
      await updateDoc(
        doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "issues", issueId),
        {
          issueNumber,
          title: String(editIssueDraft.title || "").trim(),
          description: String(editIssueDraft.description || "").trim(),
          status: editIssueDraft.status || "Open",
          bucketId: String(editIssueDraft.bucketId || "").trim(),
          bucketName: selectedBucket?.name || "",
          updatedAt: serverTimestamp(),
        }
      );
      setEditingIssueId("");
      toast.success("Issue updated.");
    } catch (error) {
      console.error("Failed to update issue:", error);
      toast.error("Could not update issue.");
    }
  };

  const handleDeleteIssue = async (issueId) => {
    if (!window.confirm("Delete this issue?")) return;
    try {
      await deleteDoc(
        doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "issues", issueId)
      );
      toast.success("Issue deleted.");
    } catch (error) {
      console.error("Failed to delete issue:", error);
      toast.error("Could not delete issue.");
    }
  };

  const handleSaveProjectDayCount = async () => {
    if (!selectedProjectId) return;

    if (hasTodayDayCountLog) {
      toast.warning("Today's day count is already logged. You can add another entry tomorrow.");
      return;
    }

    const normalizedProjectDayCount = normalizeDayCount(projectDayCountDraft);
    const recordedDate = todayDateKey;

    try {
      await updateDoc(
        doc(db, "churches", id, "projectListIssueProjects", selectedProjectId),
        {
          dayCount: normalizedProjectDayCount,
          updatedAt: serverTimestamp(),
        }
      );

      if (dayCountLogsRef) {
        await addDoc(dayCountLogsRef, {
          dayCount: normalizedProjectDayCount,
          recordedDate,
          recordedAt: serverTimestamp(),
          recordedBy: user?.uid || "",
        });
      }

      toast.success("Project day count updated.");
    } catch (error) {
      console.error("Failed to update project day count:", error);
      toast.error("Could not update project day count.");
    }
  };

  // â”€â”€ Bucket CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleCreateBucket = async (event) => {
    event.preventDefault();
    if (!selectedProjectId) { toast.warning("Select a project first."); return; }
    const name = String(bucketDraft.name || "").trim() || "Untitled Bucket";
    const duplicate = buckets.some((b) => String(b.name || "").trim().toLowerCase() === name.toLowerCase());
    if (duplicate) { toast.warning("That bucket already exists."); return; }
    try {
      await addDoc(bucketsRef, {
        name,
        description: String(bucketDraft.description || "").trim(),
        sortOrder: buckets.length,
        cardReviewProjectId: normalizeValue(bucketDraft.cardReviewProjectId),
        cardReviewStep: normalizeCardReviewStep(bucketDraft.cardReviewStep),
        cardReviewCardRef: normalizeValue(bucketDraft.cardReviewCardRef),
        createdBy: user?.uid || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setBucketDraft({
        name: "",
        description: "",
        cardReviewProjectId: "",
        cardReviewStep: "",
        cardReviewCardRef: "",
      });
      setShowBucketForm(false);
      toast.success("Bucket created.");
    } catch (error) {
      console.error("Failed to create bucket:", error);
      toast.error("Could not create bucket.");
    }
  };

  const handleUpdateBucket = async (bucketId) => {
    const name = String(editBucketDraft.name || "").trim();
    if (!name) { toast.warning("Bucket name is required."); return; }
    const duplicate = buckets.some(
      (b) => b.id !== bucketId && String(b.name || "").trim().toLowerCase() === name.toLowerCase()
    );
    if (duplicate) { toast.warning("That bucket name already exists."); return; }
    try {
      await updateDoc(doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "buckets", bucketId), {
        name,
        description: String(editBucketDraft.description || "").trim(),
        cardReviewProjectId: normalizeValue(editBucketDraft.cardReviewProjectId),
        cardReviewStep: normalizeCardReviewStep(editBucketDraft.cardReviewStep),
        cardReviewCardRef: normalizeValue(editBucketDraft.cardReviewCardRef),
        updatedAt: serverTimestamp(),
      });
      setEditingBucketId("");
      toast.success("Bucket updated.");
    } catch (error) {
      console.error("Failed to update bucket:", error);
      toast.error("Could not update bucket.");
    }
  };

  const handleDeleteBucket = async (bucketId) => {
    if (!window.confirm("Delete this bucket?")) return;
    try {
      await deleteDoc(doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "buckets", bucketId));
      toast.success("Bucket deleted.");
    } catch (error) {
      console.error("Failed to delete bucket:", error);
      toast.error("Could not delete bucket.");
    }
  };

  const handleReorderBuckets = async (sourceBucketId, targetBucketId) => {
    if (!selectedProjectId || !sourceBucketId || !targetBucketId || sourceBucketId === targetBucketId) {
      return;
    }

    const currentBuckets = [...buckets];
    const sourceIndex = currentBuckets.findIndex((bucket) => bucket.id === sourceBucketId);
    const targetIndex = currentBuckets.findIndex((bucket) => bucket.id === targetBucketId);
    if (sourceIndex === -1 || targetIndex === -1) {
      return;
    }

    const reorderedBuckets = [...currentBuckets];
    const [movedBucket] = reorderedBuckets.splice(sourceIndex, 1);
    reorderedBuckets.splice(targetIndex, 0, movedBucket);

    setBuckets(reorderedBuckets);
    setIsReorderingBuckets(true);

    try {
      await Promise.all(
        reorderedBuckets.map((bucket, index) => {
          if (Number(bucket.sortOrder) === index) {
            return Promise.resolve();
          }

          return updateDoc(
            doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "buckets", bucket.id),
            {
              sortOrder: index,
              updatedAt: serverTimestamp(),
            }
          );
        })
      );
      toast.success("Bucket order updated.");
    } catch (error) {
      console.error("Failed to reorder buckets:", error);
      setBuckets(currentBuckets);
      toast.error("Could not reorder buckets.");
    } finally {
      setDraggedBucketId("");
      setIsReorderingBuckets(false);
    }
  };

  // â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    setIssueSearchQuery("");
    setCompletedDateFrom("");
    setCompletedDateTo("");
    setShowCompletedByBucketId({});
    setBucketVisibilityFilterIds([]);
    setBucketFilterSearchQuery("");
    setShowIssueForm(false);
    setIsManagingBuckets(false);
    setSelectedManageBucketId("");
    setEditingBucketId("");
    setDraggedBucketId("");
    setTaskBucketIds([]);
  }, [selectedProjectId]);

  useEffect(() => {
    const validIds = new Set(bucketFilterOptions.map((option) => option.id));
    setBucketVisibilityFilterIds((previous) => previous.filter((idValue) => validIds.has(idValue)));
  }, [bucketFilterOptions]);

  useEffect(() => {
    if (issues.length === 0) return;
    const latestIssueWithBucket = issues.find((issue) => String(issue?.bucketId || "").trim());
    if (!latestIssueWithBucket) return;

    const latestBucketId = String(latestIssueWithBucket.bucketId || "").trim();
    if (!latestBucketId) return;
    setLastUsedIssueBucketId((previous) => (previous || latestBucketId));
  }, [issues]);

  useEffect(() => {
    if (!shouldAutoShowIssueForm) return;
    const normalizedIssueSearch = String(issueSearchQuery || "").trim();

    setIssueDraft((previous) => ({
      ...previous,
      issueNumber: showIssueForm ? (previous.issueNumber || normalizedIssueSearch) : normalizedIssueSearch,
      bucketId: previous.bucketId || lastUsedIssueBucketId || buckets[0]?.id || "",
    }));
  }, [buckets, issueSearchQuery, lastUsedIssueBucketId, shouldAutoShowIssueForm, showIssueForm]);

  useEffect(() => {
    if (!taskAssigneeUserId && organizationUsers.length > 0) {
      setTaskAssigneeUserId(organizationUsers[0].id);
    }
  }, [organizationUsers, taskAssigneeUserId]);

  useEffect(() => {
    setBucketDraft((previous) => {
      const normalizedProjectId = normalizeValue(previous.cardReviewProjectId);
      const normalizedStep = normalizeCardReviewStep(previous.cardReviewStep);
      const cardsForStep = getCardReviewCardsForSelection(normalizedProjectId, normalizedStep);
      const hasSelectedCardInStep = cardsForStep.some(
        (cardEntry) => cardEntry.cardRef === normalizeValue(previous.cardReviewCardRef)
      );

      if (!normalizedProjectId) {
        if (!previous.cardReviewStep && !previous.cardReviewCardRef) return previous;
        return {
          ...previous,
          cardReviewStep: "",
          cardReviewCardRef: "",
        };
      }

      if (!normalizedStep) {
        if (!previous.cardReviewCardRef) return previous;
        return {
          ...previous,
          cardReviewCardRef: "",
        };
      }

      if (hasSelectedCardInStep) return previous;

      return {
        ...previous,
        cardReviewCardRef: getFirstCardForSelection(normalizedProjectId, normalizedStep),
      };
    });
  }, [bucketDraft.cardReviewProjectId, bucketDraft.cardReviewStep, cardReviewCardsByProjectAndStep]);

  useEffect(() => {
    if (!editingBucketId) return;

    setEditBucketDraft((previous) => {
      const normalizedProjectId = normalizeValue(previous.cardReviewProjectId);
      const normalizedStep = normalizeCardReviewStep(previous.cardReviewStep);
      const cardsForStep = getCardReviewCardsForSelection(normalizedProjectId, normalizedStep);
      const hasSelectedCardInStep = cardsForStep.some(
        (cardEntry) => cardEntry.cardRef === normalizeValue(previous.cardReviewCardRef)
      );

      if (!normalizedProjectId) {
        if (!previous.cardReviewStep && !previous.cardReviewCardRef) return previous;
        return {
          ...previous,
          cardReviewStep: "",
          cardReviewCardRef: "",
        };
      }

      if (!normalizedStep) {
        if (!previous.cardReviewCardRef) return previous;
        return {
          ...previous,
          cardReviewCardRef: "",
        };
      }

      if (hasSelectedCardInStep) return previous;

      return {
        ...previous,
        cardReviewCardRef: getFirstCardForSelection(normalizedProjectId, normalizedStep),
      };
    });
  }, [cardReviewCardsByProjectAndStep, editBucketDraft.cardReviewProjectId, editBucketDraft.cardReviewStep, editingBucketId]);

  const statusBadgeColor = (status) => {
    switch (String(status || "").toLowerCase()) {
      case "open": return { bg: "#DBEAFE", text: "#1E40AF" };
      case "in progress": return { bg: "#FEF3C7", text: "#92400E" };
      case "on hold": return { bg: "#F3F4F6", text: "#374151" };
      case "resolved": return { bg: "#D1FAE5", text: "#065F46" };
      case "complete": return { bg: "#DCFCE7", text: "#166534" };
      case "closed": return { bg: "#E5E7EB", text: "#4B5563" };
      default: return { bg: "#EEF2FF", text: "#4338CA" };
    }
  };

  const handleToggleIssueComplete = async (issue, checked) => {
    if (!selectedProjectId || !issue?.id) return;

    try {
      const issueRef = doc(
        db,
        "churches",
        id,
        "projectListIssueProjects",
        selectedProjectId,
        "issues",
        issue.id
      );

      if (checked) {
        await updateDoc(issueRef, {
          status: "Complete",
          completedByUid: String(user?.uid || ""),
          completedByEmail: String(user?.email || ""),
          completedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        toast.success(`Issue #${issue.issueNumber || issue.id} marked complete.`);
        return;
      }

      await updateDoc(issueRef, {
        status: "Open",
        completedByUid: "",
        completedByEmail: "",
        completedAt: null,
        updatedAt: serverTimestamp(),
      });
      toast.success(`Issue #${issue.issueNumber || issue.id} marked open.`);
    } catch (error) {
      console.error("Failed to toggle issue completion:", error);
      toast.error("Could not update issue status.");
    }
  };

  const handleAddIssueNote = async (issue, providedNoteText = null) => {
    if (!selectedProjectId || !issue?.id) return;

    const noteText = typeof providedNoteText === "string"
      ? providedNoteText
      : window.prompt(`Add note for issue #${issue.issueNumber || issue.id}`);
    if (noteText === null) return;

    const normalizedNoteText = String(noteText || "").trim();
    if (!normalizedNoteText) {
      toast.warning("Note cannot be empty.");
      return;
    }

    const issueRef = doc(
      db,
      "churches",
      id,
      "projectListIssueProjects",
      selectedProjectId,
      "issues",
      issue.id
    );

    const existingNotes = normalizeIssueNotes(issue.notes);
    const nextNote = {
      text: normalizedNoteText,
      createdAtIso: new Date().toISOString(),
      createdByUid: String(user?.uid || ""),
      createdByEmail: String(user?.email || ""),
      createdByName: String(user?.displayName || user?.name || ""),
    };

    try {
      await updateDoc(issueRef, {
        notes: [...existingNotes, nextNote].slice(-MAX_ISSUE_NOTES),
        lastNoteAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      toast.success(`Note added to issue #${issue.issueNumber || issue.id}.`);
      return true;
    } catch (error) {
      console.error("Failed to add issue note:", error);
      toast.error("Could not add note.");
      return false;
    }
  };

  const openIssueNotesModal = (issue) => {
    if (!issue?.id) return;
    setSelectedIssueNotesIssueId(issue.id);
    setIssueNoteDraft("");
  };

  const closeIssueNotesModal = () => {
    setSelectedIssueNotesIssueId("");
    setIssueNoteDraft("");
  };

  const handleSaveIssueNoteFromModal = async () => {
    if (!selectedIssueForNotes) return;
    const didSave = await handleAddIssueNote(selectedIssueForNotes, issueNoteDraft);
    if (didSave) {
      setIssueNoteDraft("");
    }
  };

  const handleAssignTaskForDay = async (event) => {
    event.preventDefault();
    if (!selectedProjectId) {
      toast.warning("Select a project first.");
      return;
    }

    const userId = String(taskAssigneeUserId || "").trim();
    if (!userId || taskBucketIds.length === 0) {
      toast.warning("Select a user and at least one bucket.");
      return;
    }

    const selectedUser = organizationUsers.find((item) => item.id === userId);
    if (!selectedUser) {
      toast.warning("Selected user is no longer available.");
      return;
    }

    const selectedBucketsData = taskBucketIds
      .map((bucketId) => buckets.find((item) => item.id === bucketId))
      .filter(Boolean);
    if (selectedBucketsData.length === 0) {
      toast.warning("Selected buckets are no longer available.");
      return;
    }

    const newAssignments = selectedBucketsData
      .filter((selectedBucket) => {
        const isDuplicate = todayTaskAssignments.some(
          (assignment) =>
            String(assignment?.userId || "") === userId
            && String(assignment?.bucketId || "") === selectedBucket.id
        );
        return !isDuplicate;
      })
      .map((selectedBucket) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        dateKey: todayDateKey,
        userId,
        userName: selectedUser.name,
        userEmail: selectedUser.email,
        bucketId: selectedBucket.id,
        bucketName: selectedBucket.name || "Untitled Bucket",
        assignedByUid: String(user?.uid || ""),
        assignedByEmail: String(user?.email || ""),
        assignedAtIso: new Date().toISOString(),
      }));

    if (newAssignments.length === 0) {
      toast.warning("All selected buckets are already assigned to that user for today.");
      return;
    }

    try {
      await updateDoc(
        doc(db, "churches", id, "projectListIssueProjects", selectedProjectId),
        {
          [`dailyTasks.${todayDateKey}`]: [...todayTaskAssignments, ...newAssignments],
          updatedAt: serverTimestamp(),
        }
      );
      toast.success(`${newAssignments.length} bucket(s) assigned to ${selectedUser.name}.`);
      setTaskBucketIds([]);
    } catch (error) {
      console.error("Failed to assign task for day:", error);
      toast.error("Could not assign task.");
    }
  };

  const handleMoveIssueToBucket = async (issue) => {
    if (!selectedProjectId || !issue?.id) return;

    const normalizedBucketId = String(movingIssueBucketId || "").trim();
    const selectedBucket = buckets.find((bucket) => bucket.id === normalizedBucketId);
    const nextBucketName = selectedBucket?.name || "";

    try {
      await updateDoc(
        doc(db, "churches", id, "projectListIssueProjects", selectedProjectId, "issues", issue.id),
        {
          bucketId: normalizedBucketId,
          bucketName: nextBucketName,
          updatedAt: serverTimestamp(),
        }
      );
      toast.success(`Issue #${issue.issueNumber || issue.id} moved.`);
      setMovingIssueId("");
      setMovingIssueBucketId("");
    } catch (error) {
      console.error("Failed to move issue to another bucket:", error);
      toast.error("Could not move issue.");
    }
  };

  const handleScrollToBucketGroup = (bucketGroupId) => {
    if (!bucketGroupId || typeof window === "undefined") return;
    const targetElement = document.getElementById(`bucket-group-${bucketGroupId}`);
    if (!targetElement) return;
    targetElement.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // ── Import helpers ────────────────────────────────────────────────────────────
  const parseFileToRows = (file) =>
    new Promise((resolve, reject) => {
      const ext = file.name.split(".").pop().toLowerCase();
      if (ext === "csv") {
        Papa.parse(file, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => resolve(results.data),
          error: reject,
        });
      } else {
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const workbook = XLSX.read(event.target.result, { type: "array" });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
            resolve(rows);
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
      }
    });

  const normalizeHeader = (key) =>
    String(key || "").trim().toLowerCase().replace(/[\s_-]+/g, "");

  const getColValue = (row, ...candidates) => {
    for (const candidate of candidates) {
      for (const key of Object.keys(row)) {
        if (normalizeHeader(key) === normalizeHeader(candidate)) {
          return String(row[key] || "").trim();
        }
      }
    }
    return "";
  };

  const handleImportIssuesFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const rawRows = await parseFileToRows(file);
      const parsed = rawRows
        .map((row) => ({
          issueNumber: getColValue(row, "issueNumber", "issue number", "issue_number", "issue#", "number", "#"),
          title: getColValue(row, "title"),
          description: getColValue(row, "description", "desc"),
          status: getColValue(row, "status") || "Open",
          bucketName: getColValue(row, "bucketName", "bucket name", "bucket_name", "bucket"),
        }))
        .filter((row) => row.issueNumber);
      setImportIssuesRows(parsed);
    } catch (err) {
      console.error("Failed to parse issues file:", err);
      toast.error("Could not read file. Make sure it is a valid CSV or Excel file.");
    }
    event.target.value = "";
  };

  const handleImportIssuesSubmit = async () => {
    if (!selectedProjectId) { toast.warning("Select a project first."); return; }
    if (importIssuesRows.length === 0) { toast.warning("No rows to import."); return; }
    setImportIssuesLoading(true);
    const existingNumbers = new Set(issues.map((issue) => String(issue.issueNumber || "").trim().toLowerCase()));
    let created = 0;
    let skipped = 0;
    for (const row of importIssuesRows) {
      const issueNumber = row.issueNumber;
      if (existingNumbers.has(issueNumber.toLowerCase())) { skipped++; continue; }

      let bucketId = importIssuesDefaultBucketId;
      let bucketName = buckets.find((b) => b.id === bucketId)?.name || "";
      if (row.bucketName) {
        const matched = buckets.find(
          (b) => String(b.name || "").trim().toLowerCase() === row.bucketName.toLowerCase()
        );
        if (matched) { bucketId = matched.id; bucketName = matched.name; }
      }

      if (!bucketId) { skipped++; continue; }

      try {
        await addDoc(issuesRef, {
          issueNumber,
          title: row.title || "",
          description: row.description || "",
          status: STATUS_OPTIONS.includes(row.status) ? row.status : "Open",
          bucketId,
          bucketName,
          createdBy: user?.uid || "",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        existingNumbers.add(issueNumber.toLowerCase());
        created++;
      } catch (err) {
        console.error("Failed to import issue:", err);
        skipped++;
      }
    }
    setImportIssuesLoading(false);
    toast.success(`Imported ${created} issue(s).${skipped > 0 ? ` ${skipped} skipped (duplicate or missing bucket).` : ""}`);
    setImportIssuesRows([]);
    setShowImportIssuesPanel(false);
  };

  const handleImportBucketsFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const rawRows = await parseFileToRows(file);
      const parsed = rawRows
        .map((row) => ({
          name: getColValue(row, "name", "bucket name", "bucketName", "bucket_name"),
          description: getColValue(row, "description", "desc"),
        }))
        .filter((row) => row.name);
      setImportBucketsRows(parsed);
    } catch (err) {
      console.error("Failed to parse buckets file:", err);
      toast.error("Could not read file. Make sure it is a valid CSV or Excel file.");
    }
    event.target.value = "";
  };

  const handleImportBucketsSubmit = async () => {
    if (!selectedProjectId) { toast.warning("Select a project first."); return; }
    if (!bucketsRef) { toast.warning("Select a project first."); return; }
    if (importBucketsRows.length === 0) { toast.warning("No rows to import."); return; }
    setImportBucketsLoading(true);
    const existingNames = new Set(buckets.map((b) => String(b.name || "").trim().toLowerCase()));
    let created = 0;
    let skipped = 0;
    for (const row of importBucketsRows) {
      const name = String(row.name || "").trim();
      if (!name || existingNames.has(name.toLowerCase())) { skipped++; continue; }
      try {
        await addDoc(bucketsRef, {
          name,
          description: row.description || "",
          sortOrder: buckets.length + created,
          cardReviewProjectId: "",
          cardReviewStep: "",
          cardReviewCardRef: "",
          createdBy: user?.uid || "",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        existingNames.add(name.toLowerCase());
        created++;
      } catch (err) {
        console.error("Failed to import bucket:", err);
        skipped++;
      }
    }
    setImportBucketsLoading(false);
    toast.success(`Imported ${created} bucket(s).${skipped > 0 ? ` ${skipped} skipped (duplicate or empty).` : ""}`);
    setImportBucketsRows([]);
    setShowImportBucketsPanel(false);
  };

  // â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <div
      style={{
        ...commonStyles.fullWidthContainer,
        position: "relative",
        paddingLeft: 0,
        paddingRight: 0,
        width: "100vw",
        maxWidth: "100vw",
        marginLeft: "calc(50% - 50vw)",
        marginRight: "calc(50% - 50vw)",
      }}
    >
      {user && (
        <Link
          to={`${routePrefix}/${id}/mi-organizacion`}
          style={{ ...commonStyles.backButtonLink, marginBottom: "16px" }}
        >
          â† Back to My Organization
        </Link>
      )}

      <ChurchHeader id={id} applyShadow={false} />

      <div style={containerStyle}>
        <h1 style={commonStyles.title}>Project Lists and Issues</h1>
        <p style={{ color: "#6B7280", marginTop: "-8px" }}>
          Manage your own projects, issues, and bucket cards independently.
        </p>

        {/* Project selector + Bucket filter */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "10px", marginBottom: "1rem" }}>
          <div>
            <label style={{ display: "block", fontWeight: 600, fontSize: "0.88rem", marginBottom: "4px", color: "#374151" }}>
              Project
            </label>
            <select style={inputStyle} value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
              <option value="">â€” Select a project â€”</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name || "Untitled Project"}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontWeight: 600, fontSize: "0.88rem", marginBottom: "4px", color: "#374151" }}>
              Filter by Bucket Card
            </label>
            <select style={inputStyle} value={selectedBucketCardId} onChange={(e) => setSelectedBucketCardId(e.target.value)} disabled={!selectedProjectId}>
              <option value="all">All Bucket Cards</option>
              {buckets.map((b) => (
                <option key={b.id} value={b.id}>{b.name || "Untitled Bucket"}</option>
              ))}
              <option value="__unassigned__">No Bucket</option>
            </select>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: "4px", borderBottom: "2px solid #E5E7EB", marginBottom: "1rem", flexWrap: "wrap" }}>
          {[ ["projects", "Projects"], ["issues", "Issues"], ["buckets", "Bucket Cards"], ["tasksForDay", "Tasks For The Day"], ["dayCounts", "Total Day Count"]].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              style={{
                border: "none",
                borderBottom: activeTab === key ? "3px solid #2563EB" : "3px solid transparent",
                background: "transparent",
                padding: "8px 18px",
                fontWeight: activeTab === key ? 700 : 500,
                color: activeTab === key ? "#2563EB" : "#374151",
                cursor: "pointer",
                fontSize: "0.95rem",
                marginBottom: "-2px",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <section style={panelStyle}>

          {/* â”€â”€ PROJECTS TAB â”€â”€ */}
          {activeTab === "projects" && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <h2 style={{ margin: 0 }}>Projects</h2>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    style={{ ...buttonBaseStyle, backgroundColor: isManagingProjects ? "#6B7280" : "#0F766E" }}
                    onClick={() => {
                      setIsManagingProjects((prev) => {
                        const next = !prev;
                        if (!next) {
                          setSelectedManageProjectId("");
                          setEditingProjectId("");
                        }
                        return next;
                      });
                    }}
                  >
                    {isManagingProjects ? "Done Managing" : "Manage Projects"}
                  </button>
                  <button
                    type="button"
                    style={{ ...buttonBaseStyle, backgroundColor: "#2563EB" }}
                    onClick={() => { setShowProjectForm((prev) => !prev); setProjectDraft({ name: "", description: "" }); }}
                  >
                    {showProjectForm ? "Cancel" : "+ New Project"}
                  </button>
                </div>
              </div>

              {isManagingProjects && !editingProjectId && (
                <div style={{ marginBottom: "10px", padding: "8px 10px", borderRadius: "8px", backgroundColor: "#ECFDF5", border: "1px solid #A7F3D0", color: "#065F46", fontWeight: 600, fontSize: "0.9rem" }}>
                  Select a project to enable Edit or Delete.
                </div>
              )}

              {showProjectForm && (
                <form
                  onSubmit={handleCreateProject}
                  style={{ border: "1px solid #BFDBFE", borderRadius: "8px", padding: "14px", marginBottom: "14px", backgroundColor: "#EFF6FF" }}
                >
                  <h3 style={{ marginTop: 0, marginBottom: "12px", color: "#1E40AF" }}>New Project</h3>
                  <div style={{ display: "grid", gap: "10px" }}>
                    <div>
                      <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", marginBottom: "4px" }}>Name (optional)</label>
                      <input style={inputStyle} placeholder="Project name (optional)" value={projectDraft.name} onChange={(e) => setProjectDraft((prev) => ({ ...prev, name: e.target.value }))} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", marginBottom: "4px" }}>Description</label>
                      <textarea style={textareaStyle} placeholder="Optional description" value={projectDraft.description} onChange={(e) => setProjectDraft((prev) => ({ ...prev, description: e.target.value }))} />
                    </div>
                    <button type="submit" style={{ ...buttonBaseStyle, backgroundColor: "#2563EB" }}>Save Project</button>
                  </div>
                </form>
              )}

              {loadingProjects ? <p>Loading projects...</p> : null}

              {projects.length === 0 && !loadingProjects ? (
                <p style={{ color: "#6B7280" }}>No projects yet. Click "+ New Project" to get started.</p>
              ) : (
                <div style={{ display: "grid", gap: "8px" }}>
                  {projects.map((project) => (
                    <div
                      key={project.id}
                      style={{
                        border: selectedProjectId === project.id ? "2px solid #2563EB" : "1px solid #E5E7EB",
                        borderRadius: "8px",
                        padding: "12px",
                        backgroundColor: selectedProjectId === project.id ? "#EFF6FF" : "#FFFFFF",
                      }}
                    >
                      {editingProjectId === project.id ? (
                        <div style={{ display: "grid", gap: "8px" }}>
                          <input style={inputStyle} placeholder="Project name" value={editProjectDraft.name} onChange={(e) => setEditProjectDraft((prev) => ({ ...prev, name: e.target.value }))} />
                          <textarea style={textareaStyle} placeholder="Description" value={editProjectDraft.description} onChange={(e) => setEditProjectDraft((prev) => ({ ...prev, description: e.target.value }))} />
                          <div style={{ display: "flex", gap: "6px" }}>
                            <button type="button" style={{ ...buttonBaseStyle, backgroundColor: "#2563EB" }} onClick={() => handleUpdateProject(project.id)}>Save</button>
                            <button type="button" style={{ ...buttonBaseStyle, backgroundColor: "#6B7280" }} onClick={() => setEditingProjectId("")}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedProjectId(project.id);
                              if (isManagingProjects && !editingProjectId) {
                                setSelectedManageProjectId(project.id);
                              }
                            }}
                            style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, textAlign: "left", flex: 1 }}
                          >
                            <strong style={{ fontSize: "0.97rem" }}>{project.name || "Untitled Project"}</strong>
                            {project.description ? (
                              <p style={{ margin: "2px 0 0", color: "#6B7280", fontSize: "0.85rem" }}>{project.description}</p>
                            ) : null}
                          </button>
                          {isManagingProjects && !editingProjectId && selectedManageProjectId === project.id && (
                            <span style={{ alignSelf: "center", fontSize: "0.76rem", backgroundColor: "#DBEAFE", color: "#1D4ED8", borderRadius: "999px", padding: "3px 8px", fontWeight: 700 }}>
                              Selected
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {isManagingProjects && !editingProjectId && projects.length > 0 && (
                <div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    style={{ ...buttonBaseStyle, backgroundColor: selectedManageProjectId ? "#0F766E" : "#94A3B8" }}
                    disabled={!selectedManageProjectId}
                    onClick={() => {
                      const projectToEdit = projects.find((project) => project.id === selectedManageProjectId);
                      if (!projectToEdit) return;
                      setEditingProjectId(projectToEdit.id);
                      setEditProjectDraft({
                        name: projectToEdit.name || "",
                        description: projectToEdit.description || "",
                      });
                    }}
                  >
                    Edit Selected
                  </button>
                  <button
                    type="button"
                    style={{ ...buttonBaseStyle, backgroundColor: selectedManageProjectId ? "#DC2626" : "#94A3B8" }}
                    disabled={!selectedManageProjectId}
                    onClick={() => {
                      if (!selectedManageProjectId) return;
                      handleDeleteProject(selectedManageProjectId);
                      setSelectedManageProjectId("");
                    }}
                  >
                    Delete Selected
                  </button>
                </div>
              )}
            </>
          )}

          {/* â”€â”€ ISSUES TAB â”€â”€ */}
          {activeTab === "issues" && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <h2 style={{ margin: 0 }}>Issues</h2>
                {selectedProjectId && (
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      type="button"
                      style={{ ...buttonBaseStyle, backgroundColor: showImportIssuesPanel ? "#6B7280" : "#0369A1" }}
                      onClick={() => {
                        setShowImportIssuesPanel((prev) => !prev);
                        setImportIssuesRows([]);
                      }}
                    >
                      {showImportIssuesPanel ? "Cancel Import" : "Import CSV/Excel"}
                    </button>
                    <input
                      ref={importIssuesFileRef}
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      style={{ display: "none" }}
                      onChange={handleImportIssuesFile}
                    />
                    <button
                      type="button"
                      style={{ ...buttonBaseStyle, backgroundColor: "#059669" }}
                      onClick={() => {
                        setShowIssueForm((prev) => !prev);
                        setIssueDraft((previous) => ({
                          issueNumber: previous.issueNumber || String(issueSearchQuery || "").trim(),
                          status: "Open",
                          bucketId: previous.bucketId || lastUsedIssueBucketId || buckets[0]?.id || "",
                        }));
                      }}
                    >
                      {showIssueForm ? "Cancel" : "+ New Issue"}
                    </button>
                  </div>
                )}
              </div>

              {/* Import Issues panel */}
              {showImportIssuesPanel && selectedProjectId && (
                <div style={{ border: "1px solid #BAE6FD", borderRadius: "8px", padding: "14px", marginBottom: "14px", backgroundColor: "#F0F9FF" }}>
                  <h3 style={{ marginTop: 0, marginBottom: "10px", color: "#0369A1" }}>Import Issues from CSV / Excel</h3>
                  <p style={{ margin: "0 0 10px", fontSize: "0.85rem", color: "#475569" }}>
                    Expected columns: <strong>issueNumber</strong> (required), <strong>title</strong>, <strong>description</strong>, <strong>status</strong>, <strong>bucket</strong> (matched by name).
                  </p>
                  <div style={{ display: "grid", gap: "10px" }}>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        style={{ ...buttonBaseStyle, backgroundColor: "#0369A1" }}
                        onClick={() => importIssuesFileRef.current?.click()}
                      >
                        Choose File
                      </button>
                      {importIssuesRows.length > 0 && (
                        <span style={{ fontSize: "0.85rem", color: "#0369A1", fontWeight: 600 }}>
                          {importIssuesRows.length} row(s) ready to import
                        </span>
                      )}
                    </div>
                    <div>
                      <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", marginBottom: "4px" }}>
                        Default Bucket (used when no bucket column or no match)
                      </label>
                      {buckets.length === 0 ? (
                        <p style={{ margin: 0, fontSize: "0.85rem", color: "#B45309" }}>No buckets found. Create buckets first.</p>
                      ) : (
                        <select
                          style={inputStyle}
                          value={importIssuesDefaultBucketId}
                          onChange={(e) => setImportIssuesDefaultBucketId(e.target.value)}
                        >
                          <option value="">— No default bucket —</option>
                          {buckets.map((b) => (
                            <option key={b.id} value={b.id}>{b.name || "Untitled Bucket"}</option>
                          ))}
                        </select>
                      )}
                    </div>
                    {importIssuesRows.length > 0 && (
                      <>
                        <div style={{ maxHeight: "200px", overflowY: "auto", border: "1px solid #BAE6FD", borderRadius: "6px", backgroundColor: "#FFFFFF" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                            <thead>
                              <tr style={{ backgroundColor: "#E0F2FE" }}>
                                <th style={{ textAlign: "left", padding: "6px 8px" }}>Issue #</th>
                                <th style={{ textAlign: "left", padding: "6px 8px" }}>Title</th>
                                <th style={{ textAlign: "left", padding: "6px 8px" }}>Status</th>
                                <th style={{ textAlign: "left", padding: "6px 8px" }}>Bucket (from file)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {importIssuesRows.map((row, idx) => (
                                <tr key={idx} style={{ borderTop: "1px solid #E0F2FE" }}>
                                  <td style={{ padding: "5px 8px", fontWeight: 700 }}>{row.issueNumber}</td>
                                  <td style={{ padding: "5px 8px", color: "#475569" }}>{row.title || "—"}</td>
                                  <td style={{ padding: "5px 8px" }}>{row.status || "Open"}</td>
                                  <td style={{ padding: "5px 8px", color: "#64748B" }}>{row.bucketName || "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <button
                          type="button"
                          style={{ ...buttonBaseStyle, backgroundColor: importIssuesLoading ? "#94A3B8" : "#0369A1" }}
                          disabled={importIssuesLoading}
                          onClick={handleImportIssuesSubmit}
                        >
                          {importIssuesLoading ? "Importing..." : `Import ${importIssuesRows.length} Issue(s)`}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {!selectedProjectId ? (
                <div style={{ backgroundColor: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "8px", padding: "12px 16px", color: "#991B1B", fontWeight: 600 }}>
                  Please select a project first.
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "12px", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span style={{ fontSize: "2.5rem", fontWeight: 800, color: "#1D4ED8", lineHeight: 1 }}>{visibleIssuesCount}</span>
                      <div>
                        <div style={{ fontSize: "0.8rem", color: "#6B7280", fontWeight: 600, textTransform: "uppercase" }}>Total Issues</div>
                        <div style={{ fontSize: "0.85rem", color: "#374151" }}>in <strong>{selectedProject?.name}</strong></div>
                      </div>
                    </div>
                    <input
                      style={{ ...inputStyle, maxWidth: "280px", minWidth: "220px" }}
                      placeholder="Search issues..."
                      value={issueSearchQuery}
                      onChange={(e) => setIssueSearchQuery(e.target.value)}
                    />
                  </div>

                  {effectiveShowIssueForm && (
                    <form
                      onSubmit={handleCreateIssue}
                      style={{ border: "1px solid #A7F3D0", borderRadius: "8px", padding: "14px", marginBottom: "14px", backgroundColor: "#F0FDF4" }}
                    >
                      <h3 style={{ marginTop: 0, marginBottom: "12px", color: "#065F46" }}>New Issue</h3>
                      <div style={{ display: "grid", gap: "10px" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                          <div>
                            <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", marginBottom: "4px" }}>Issue Number *</label>
                            <input style={inputStyle} placeholder="e.g. 1042" value={issueDraft.issueNumber} onChange={(e) => setIssueDraft((prev) => ({ ...prev, issueNumber: e.target.value }))} />
                          </div>
                          <div>
                            <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", marginBottom: "4px" }}>Status</label>
                            <select style={inputStyle} value={issueDraft.status} onChange={(e) => setIssueDraft((prev) => ({ ...prev, status: e.target.value }))}>
                              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </div>
                        </div>
                        <div>
                          <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", marginBottom: "4px" }}>Bucket Card *</label>
                          {buckets.length === 0 ? (
                            <div style={{ fontSize: "0.88rem", color: "#B45309", backgroundColor: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: "6px", padding: "8px 12px" }}>
                              No buckets found. Create buckets in the Bucket Cards tab first.
                            </div>
                          ) : (
                            <select style={inputStyle} value={issueDraft.bucketId} onChange={(e) => setIssueDraft((prev) => ({ ...prev, bucketId: e.target.value }))}>
                              <option value="">â€” Select a bucket â€”</option>
                              {buckets.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                          )}
                        </div>
                        <button type="submit" style={{ ...buttonBaseStyle, backgroundColor: "#059669" }}>Save Issue</button>
                      </div>
                    </form>
                  )}

                  {loadingIssues ? <p>Loading issues...</p> : null}

                  {issuesTableRows.length === 0 && !loadingIssues ? (
                    <p style={{ color: "#6B7280" }}>
                      {issueSearchQuery.trim()
                        ? "No issues match the current filter."
                        : "No issues yet. Click \"+ New Issue\" to create one."}
                    </p>
                  ) : (
                    <div style={{ border: "1px solid #E5E7EB", borderRadius: "8px", backgroundColor: "#FFFFFF", overflow: "hidden" }}>
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "940px" }}>
                          <thead>
                            <tr style={{ backgroundColor: "#F8FAFC", borderBottom: "1px solid #E2E8F0" }}>
                              <th style={{ textAlign: "left", padding: "10px 12px", fontSize: "0.78rem", color: "#475569", textTransform: "uppercase" }}>Issue #</th>
                              <th style={{ textAlign: "left", padding: "10px 12px", fontSize: "0.78rem", color: "#475569", textTransform: "uppercase" }}>Status</th>
                              <th style={{ textAlign: "left", padding: "10px 12px", fontSize: "0.78rem", color: "#475569", textTransform: "uppercase" }}>Bucket</th>
                              <th style={{ textAlign: "left", padding: "10px 12px", fontSize: "0.78rem", color: "#475569", textTransform: "uppercase" }}>Title</th>
                              <th style={{ textAlign: "left", padding: "10px 12px", fontSize: "0.78rem", color: "#475569", textTransform: "uppercase" }}>Description</th>
                              <th style={{ textAlign: "left", padding: "10px 12px", fontSize: "0.78rem", color: "#475569", textTransform: "uppercase" }}>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {issuesTableRows.map((issue) => {
                              const { bg, text } = statusBadgeColor(issue.status);
                              const bucket = buckets.find((b) => b.id === issue.bucketId);
                              const liveIssueNumberQuery = String(issueSearchQuery || "").trim().toLowerCase();
                              const matchesLiveIssueNumber = !!liveIssueNumberQuery
                                && String(issue.issueNumber || "").toLowerCase().includes(liveIssueNumberQuery);

                              if (editingIssueId === issue.id) {
                                return (
                                  <tr key={issue.id} style={{ borderTop: "1px solid #E5E7EB" }}>
                                    <td colSpan={6} style={{ padding: "10px 12px" }}>
                                      <div style={{ display: "grid", gap: "8px" }}>
                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                                          <input style={inputStyle} placeholder="Issue number" value={editIssueDraft.issueNumber} onChange={(e) => setEditIssueDraft((prev) => ({ ...prev, issueNumber: e.target.value }))} />
                                          <select style={inputStyle} value={editIssueDraft.status} onChange={(e) => setEditIssueDraft((prev) => ({ ...prev, status: e.target.value }))}>
                                            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                                          </select>
                                        </div>
                                        <input style={inputStyle} placeholder="Title" value={editIssueDraft.title} onChange={(e) => setEditIssueDraft((prev) => ({ ...prev, title: e.target.value }))} />
                                        <textarea style={textareaStyle} placeholder="Description" value={editIssueDraft.description} onChange={(e) => setEditIssueDraft((prev) => ({ ...prev, description: e.target.value }))} />
                                        <select style={inputStyle} value={editIssueDraft.bucketId} onChange={(e) => setEditIssueDraft((prev) => ({ ...prev, bucketId: e.target.value }))}>
                                          <option value="">â€” No bucket â€”</option>
                                          {buckets.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                                        </select>
                                        <div style={{ display: "flex", gap: "6px" }}>
                                          <button type="button" style={{ ...buttonBaseStyle, backgroundColor: "#2563EB" }} onClick={() => handleUpdateIssue(issue.id)}>Save</button>
                                          <button type="button" style={{ ...buttonBaseStyle, backgroundColor: "#6B7280" }} onClick={() => setEditingIssueId("")}>Cancel</button>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              }

                              return (
                                <tr
                                  key={issue.id}
                                  style={{
                                    borderTop: "1px solid #E5E7EB",
                                    backgroundColor: matchesLiveIssueNumber ? "#FFF7ED" : "transparent",
                                    boxShadow: matchesLiveIssueNumber ? "inset 3px 0 0 #F97316" : "none",
                                  }}
                                >
                                  <td style={{ padding: "10px 12px", fontWeight: 700, color: "#0F172A", whiteSpace: "nowrap" }}>#{issue.issueNumber || "-"}</td>
                                  <td style={{ padding: "10px 12px" }}>
                                    <span style={{ fontSize: "0.78rem", backgroundColor: bg, color: text, borderRadius: "999px", padding: "3px 8px", fontWeight: 700, whiteSpace: "nowrap" }}>
                                      {issue.status || "Open"}
                                    </span>
                                  </td>
                                  <td style={{ padding: "10px 12px", color: "#334155", whiteSpace: "nowrap" }}>
                                    {bucket?.name || issue.bucketName || issue.groupName || "No bucket"}
                                  </td>
                                  <td style={{ padding: "10px 12px", color: "#334155" }}>{issue.title || "-"}</td>
                                  <td style={{ padding: "10px 12px", color: "#64748B" }}>{issue.description || "-"}</td>
                                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                      <button
                                        type="button"
                                        style={{ ...buttonBaseStyle, backgroundColor: "#0F766E", fontSize: "0.75rem", padding: "3px 8px" }}
                                        onClick={() => { setEditingIssueId(issue.id); setEditIssueDraft({ issueNumber: issue.issueNumber || "", title: issue.title || "", description: issue.description || "", status: issue.status || "Open", bucketId: issue.bucketId || "" }); }}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        style={{ ...buttonBaseStyle, backgroundColor: "#DC2626", fontSize: "0.75rem", padding: "3px 8px" }}
                                        onClick={() => handleDeleteIssue(issue.id)}
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* â”€â”€ BUCKET CARDS TAB â”€â”€ */}
          {activeTab === "buckets" && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <h2 style={{ margin: 0 }}>Bucket Cards</h2>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    style={{ ...buttonBaseStyle, backgroundColor: isManagingBuckets ? "#6B7280" : "#0F766E" }}
                    onClick={() => {
                      setIsManagingBuckets((prev) => {
                        const next = !prev;
                        if (!next) {
                          setSelectedManageBucketId("");
                          setEditingBucketId("");
                        }
                        return next;
                      });
                    }}
                    disabled={!selectedProjectId}
                  >
                    {isManagingBuckets ? "Done Managing" : "Manage Buckets"}
                  </button>
                  <button
                    type="button"
                    style={{ ...buttonBaseStyle, backgroundColor: showImportBucketsPanel ? "#6B7280" : "#0369A1" }}
                    onClick={() => {
                      setShowImportBucketsPanel((prev) => !prev);
                      setImportBucketsRows([]);
                    }}
                    disabled={!selectedProjectId}
                  >
                    {showImportBucketsPanel ? "Cancel Import" : "Import CSV/Excel"}
                  </button>
                  <input
                    ref={importBucketsFileRef}
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    style={{ display: "none" }}
                    onChange={handleImportBucketsFile}
                  />
                  <button
                    type="button"
                    style={{ ...buttonBaseStyle, backgroundColor: "#7C3AED" }}
                    onClick={() => {
                      setShowBucketForm((prev) => !prev);
                      setBucketDraft({
                        name: "",
                        description: "",
                        cardReviewProjectId: "",
                        cardReviewStep: "",
                        cardReviewCardRef: "",
                      });
                    }}
                  >
                    {showBucketForm ? "Cancel" : "+ New Bucket"}
                  </button>
                </div>
              </div>

              {selectedProjectId && (
                <div
                  style={{
                    border: "1px solid #BFDBFE",
                    borderRadius: "10px",
                    padding: "14px",
                    marginBottom: "12px",
                    backgroundColor: "#F8FBFF",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px", marginBottom: "10px" }}>
                    <h3 style={{ margin: 0, color: "#1E3A8A" }}>Grand Total Chart</h3>
                    <span style={{ fontSize: "0.8rem", color: "#475569", fontWeight: 600 }}>
                      {selectedProject?.name || "Selected project"}
                    </span>
                  </div>

                  {bucketGrandTotals.total === 0 ? (
                    <p style={{ margin: 0, color: "#64748B" }}>
                      No issues available for the current filters.
                    </p>
                  ) : (
                    <div style={{ display: "grid", gap: "10px" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "8px" }}>
                        <div style={{ backgroundColor: "#FFFFFF", border: "1px solid #DBEAFE", borderRadius: "8px", padding: "10px" }}>
                          <div style={{ fontSize: "0.75rem", color: "#64748B", textTransform: "uppercase", fontWeight: 700 }}>Total</div>
                          <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#1E293B", lineHeight: 1.1 }}>{bucketGrandTotals.total}</div>
                        </div>
                        <div style={{ backgroundColor: "#FFFFFF", border: "1px solid #DCFCE7", borderRadius: "8px", padding: "10px" }}>
                          <div style={{ fontSize: "0.75rem", color: "#166534", textTransform: "uppercase", fontWeight: 700 }}>Completed</div>
                          <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#166534", lineHeight: 1.1 }}>{bucketGrandTotals.completed}</div>
                        </div>
                        <div style={{ backgroundColor: "#FFFFFF", border: "1px solid #DBEAFE", borderRadius: "8px", padding: "10px" }}>
                          <div style={{ fontSize: "0.75rem", color: "#1D4ED8", textTransform: "uppercase", fontWeight: 700 }}>Remaining</div>
                          <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#1D4ED8", lineHeight: 1.1 }}>{bucketGrandTotals.remaining}</div>
                        </div>
                        <div style={{ backgroundColor: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: "8px", padding: "10px" }}>
                          <div style={{ fontSize: "0.75rem", color: "#475569", textTransform: "uppercase", fontWeight: 700 }}>Completion</div>
                          <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0F172A", lineHeight: 1.1 }}>{bucketGrandTotals.completionPercent}%</div>
                        </div>
                      </div>

                      <div style={{ borderRadius: "999px", backgroundColor: "#E2E8F0", overflow: "hidden", height: "12px" }}>
                        <div
                          style={{
                            height: "100%",
                            width: `${bucketGrandTotals.completionPercent}%`,
                            background: "linear-gradient(90deg, #22C55E 0%, #16A34A 100%)",
                            transition: "width 180ms ease",
                          }}
                        />
                      </div>

                      <div style={{ display: "grid", gap: "6px" }}>
                        {bucketGrandTotals.topBuckets.map((bucket) => {
                          const maxRemaining = Math.max(...bucketGrandTotals.topBuckets.map((item) => item.remaining), 1);
                          const barWidth = Math.max((bucket.remaining / maxRemaining) * 100, bucket.remaining > 0 ? 8 : 0);

                          return (
                            <div key={`grand-total-${bucket.id}`}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", fontSize: "0.8rem", marginBottom: "2px" }}>
                                <span style={{ color: "#334155", fontWeight: 700 }}>{bucket.name}</span>
                                <span style={{ color: "#64748B", fontWeight: 600 }}>
                                  {bucket.remaining} left / {bucket.total} total
                                </span>
                              </div>
                              <div style={{ height: "8px", borderRadius: "999px", backgroundColor: "#E2E8F0", overflow: "hidden" }}>
                                <div style={{ height: "100%", width: `${barWidth}%`, backgroundColor: "#3B82F6" }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Import Buckets panel */}
              {showImportBucketsPanel && selectedProjectId && (
                <div style={{ border: "1px solid #BAE6FD", borderRadius: "8px", padding: "14px", marginBottom: "14px", backgroundColor: "#F0F9FF" }}>
                  <h3 style={{ marginTop: 0, marginBottom: "10px", color: "#0369A1" }}>Import Buckets from CSV / Excel</h3>
                  <p style={{ margin: "0 0 10px", fontSize: "0.85rem", color: "#475569" }}>
                    Expected columns: <strong>name</strong> (required), <strong>description</strong> (optional).
                  </p>
                  <div style={{ display: "grid", gap: "10px" }}>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        style={{ ...buttonBaseStyle, backgroundColor: "#0369A1" }}
                        onClick={() => importBucketsFileRef.current?.click()}
                      >
                        Choose File
                      </button>
                      {importBucketsRows.length > 0 && (
                        <span style={{ fontSize: "0.85rem", color: "#0369A1", fontWeight: 600 }}>
                          {importBucketsRows.length} row(s) ready to import
                        </span>
                      )}
                    </div>
                    {importBucketsRows.length > 0 && (
                      <>
                        <div style={{ maxHeight: "200px", overflowY: "auto", border: "1px solid #BAE6FD", borderRadius: "6px", backgroundColor: "#FFFFFF" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                            <thead>
                              <tr style={{ backgroundColor: "#E0F2FE" }}>
                                <th style={{ textAlign: "left", padding: "6px 8px" }}>Name</th>
                                <th style={{ textAlign: "left", padding: "6px 8px" }}>Description</th>
                              </tr>
                            </thead>
                            <tbody>
                              {importBucketsRows.map((row, idx) => (
                                <tr key={idx} style={{ borderTop: "1px solid #E0F2FE" }}>
                                  <td style={{ padding: "5px 8px", fontWeight: 700 }}>{row.name}</td>
                                  <td style={{ padding: "5px 8px", color: "#475569" }}>{row.description || "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <button
                          type="button"
                          style={{ ...buttonBaseStyle, backgroundColor: importBucketsLoading ? "#94A3B8" : "#0369A1" }}
                          disabled={importBucketsLoading}
                          onClick={handleImportBucketsSubmit}
                        >
                          {importBucketsLoading ? "Importing..." : `Import ${importBucketsRows.length} Bucket(s)`}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {isManagingBuckets && !editingBucketId && (
                <div style={{ marginBottom: "10px", padding: "8px 10px", borderRadius: "8px", backgroundColor: "#F5F3FF", border: "1px solid #DDD6FE", color: "#5B21B6", fontWeight: 600, fontSize: "0.9rem" }}>
                  Select a bucket card to enable Edit or Delete.
                </div>
              )}

              {isManagingBuckets && !editingBucketId && (
                <div style={{ marginBottom: "10px", padding: "8px 10px", borderRadius: "8px", backgroundColor: "#EEF2FF", border: "1px solid #C7D2FE", color: "#3730A3", fontWeight: 600, fontSize: "0.85rem" }}>
                  Drag and drop bucket cards to reorder them.
                  {isReorderingBuckets ? " Saving order..." : ""}
                </div>
              )}

              {showBucketForm && (
                <form
                  onSubmit={handleCreateBucket}
                  style={{ border: "1px solid #DDD6FE", borderRadius: "8px", padding: "14px", marginBottom: "14px", backgroundColor: "#F5F3FF" }}
                >
                  <h3 style={{ marginTop: 0, marginBottom: "12px", color: "#5B21B6" }}>New Bucket</h3>
                  <div style={{ display: "grid", gap: "10px" }}>
                    <div>
                      <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", marginBottom: "4px" }}>Name (optional)</label>
                      <input style={inputStyle} placeholder="Bucket name (optional)" value={bucketDraft.name} onChange={(e) => setBucketDraft((prev) => ({ ...prev, name: e.target.value }))} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", marginBottom: "4px" }}>Description</label>
                      <textarea style={textareaStyle} placeholder="Optional description" value={bucketDraft.description} onChange={(e) => setBucketDraft((prev) => ({ ...prev, description: e.target.value }))} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", marginBottom: "4px" }}>Card Review Project</label>
                      <select
                        style={inputStyle}
                        value={bucketDraft.cardReviewProjectId}
                        onChange={(event) => {
                          const nextProjectId = normalizeValue(event.target.value);
                          setBucketDraft((previous) => ({
                            ...previous,
                            cardReviewProjectId: nextProjectId,
                          }));
                        }}
                      >
                        <option value="">Select project...</option>
                        {cardReviewProjects.map((projectOption) => (
                          <option key={`new-bucket-project-${projectOption.id}`} value={projectOption.id}>
                            {projectOption.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", marginBottom: "4px" }}>Card Review Column Step</label>
                      <select
                        style={inputStyle}
                        value={bucketDraft.cardReviewStep}
                        onChange={(event) => {
                          const nextStep = normalizeCardReviewStep(event.target.value);
                          setBucketDraft((previous) => ({
                            ...previous,
                            cardReviewStep: nextStep,
                          }));
                        }}
                        disabled={!bucketDraft.cardReviewProjectId}
                      >
                        <option value="">Select step...</option>
                        {CARD_REVIEW_STEP_OPTIONS.map((stepOption) => (
                          <option key={`new-bucket-step-${stepOption.id}`} value={stepOption.id}>
                            {stepOption.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", marginBottom: "4px" }}>Card Associated To Step</label>
                      <select
                        style={inputStyle}
                        value={bucketDraft.cardReviewCardRef}
                        onChange={(event) => {
                          setBucketDraft((previous) => ({
                            ...previous,
                            cardReviewCardRef: normalizeValue(event.target.value),
                          }));
                        }}
                        disabled={!bucketDraft.cardReviewProjectId || !bucketDraft.cardReviewStep}
                      >
                        <option value="">
                          {bucketDraft.cardReviewProjectId && bucketDraft.cardReviewStep
                            ? "Select card..."
                            : bucketDraft.cardReviewProjectId
                            ? "Select step first..."
                            : "Select project first..."}
                        </option>
                        {getCardReviewCardsForSelection(bucketDraft.cardReviewProjectId, bucketDraft.cardReviewStep).map((cardOption) => (
                          <option key={`new-bucket-card-${cardOption.cardRef}`} value={cardOption.cardRef}>
                            {cardOption.cardRef}
                          </option>
                        ))}
                      </select>
                      {bucketDraft.cardReviewProjectId && bucketDraft.cardReviewStep && getCardReviewCardsForSelection(bucketDraft.cardReviewProjectId, bucketDraft.cardReviewStep).length === 0 ? (
                        <p style={{ margin: "6px 0 0", color: "#64748B", fontSize: "0.8rem" }}>
                          No cards currently found in this Card Review step.
                        </p>
                      ) : null}
                      {loadingCardReviewEntries ? (
                        <p style={{ margin: "6px 0 0", color: "#64748B", fontSize: "0.8rem" }}>Loading Card Review cards...</p>
                      ) : null}
                    </div>
                    <button type="submit" style={{ ...buttonBaseStyle, backgroundColor: "#7C3AED" }}>Save Bucket</button>
                  </div>
                </form>
              )}

              {loadingBuckets ? <p>Loading buckets...</p> : null}

              {buckets.length === 0 && !loadingBuckets ? (
                <p style={{ color: "#6B7280" }}>No bucket cards yet. Click "+ New Bucket" to create one.</p>
              ) : (
                <>
                  {isManagingBuckets && (
                    <>
                      {/* Bucket catalog */}
                      <div style={{ display: "grid", gap: "8px", marginBottom: "24px" }}>
                        {buckets.map((bucket) => (
                          <div
                            key={bucket.id}
                            draggable={isManagingBuckets && !editingBucketId}
                            onDragStart={() => setDraggedBucketId(bucket.id)}
                            onDragEnd={() => setDraggedBucketId("")}
                            onDragOver={(event) => {
                              if (isManagingBuckets && !editingBucketId) {
                                event.preventDefault();
                              }
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              if (!isManagingBuckets || editingBucketId || !draggedBucketId || draggedBucketId === bucket.id) {
                                return;
                              }
                              handleReorderBuckets(draggedBucketId, bucket.id);
                            }}
                            style={{
                              border: draggedBucketId === bucket.id ? "2px solid #7C3AED" : "1px solid #E5E7EB",
                              borderRadius: "8px",
                              padding: "12px",
                              backgroundColor: draggedBucketId === bucket.id ? "#F5F3FF" : "#FFFFFF",
                              cursor: isManagingBuckets && !editingBucketId ? "grab" : "default",
                            }}
                          >
                            {editingBucketId === bucket.id ? (
                              <div style={{ display: "grid", gap: "8px" }}>
                                <input style={inputStyle} placeholder="Bucket name" value={editBucketDraft.name} onChange={(e) => setEditBucketDraft((prev) => ({ ...prev, name: e.target.value }))} />
                                <textarea style={textareaStyle} placeholder="Description" value={editBucketDraft.description} onChange={(e) => setEditBucketDraft((prev) => ({ ...prev, description: e.target.value }))} />
                                <select
                                  style={inputStyle}
                                  value={editBucketDraft.cardReviewProjectId}
                                  onChange={(event) => {
                                    const nextProjectId = normalizeValue(event.target.value);
                                    setEditBucketDraft((previous) => ({
                                      ...previous,
                                      cardReviewProjectId: nextProjectId,
                                    }));
                                  }}
                                >
                                  <option value="">Select project...</option>
                                  {cardReviewProjects.map((projectOption) => (
                                    <option key={`edit-bucket-project-${bucket.id}-${projectOption.id}`} value={projectOption.id}>
                                      {projectOption.label}
                                    </option>
                                  ))}
                                </select>
                                <select
                                  style={inputStyle}
                                  value={editBucketDraft.cardReviewStep}
                                  onChange={(event) => {
                                    const nextStep = normalizeCardReviewStep(event.target.value);
                                    setEditBucketDraft((previous) => ({
                                      ...previous,
                                      cardReviewStep: nextStep,
                                    }));
                                  }}
                                  disabled={!editBucketDraft.cardReviewProjectId}
                                >
                                  <option value="">Select step...</option>
                                  {CARD_REVIEW_STEP_OPTIONS.map((stepOption) => (
                                    <option key={`edit-bucket-step-${bucket.id}-${stepOption.id}`} value={stepOption.id}>
                                      {stepOption.label}
                                    </option>
                                  ))}
                                </select>
                                <select
                                  style={inputStyle}
                                  value={editBucketDraft.cardReviewCardRef}
                                  onChange={(event) => {
                                    setEditBucketDraft((previous) => ({
                                      ...previous,
                                      cardReviewCardRef: normalizeValue(event.target.value),
                                    }));
                                  }}
                                  disabled={!editBucketDraft.cardReviewProjectId || !editBucketDraft.cardReviewStep}
                                >
                                  <option value="">
                                    {editBucketDraft.cardReviewProjectId && editBucketDraft.cardReviewStep
                                      ? "Select card..."
                                      : editBucketDraft.cardReviewProjectId
                                      ? "Select step first..."
                                      : "Select project first..."}
                                  </option>
                                  {getCardReviewCardsForSelection(editBucketDraft.cardReviewProjectId, editBucketDraft.cardReviewStep).map((cardOption) => (
                                    <option key={`edit-bucket-card-${bucket.id}-${cardOption.cardRef}`} value={cardOption.cardRef}>
                                      {cardOption.cardRef}
                                    </option>
                                  ))}
                                </select>
                                <div style={{ display: "flex", gap: "6px" }}>
                                  <button type="button" style={{ ...buttonBaseStyle, backgroundColor: "#7C3AED" }} onClick={() => handleUpdateBucket(bucket.id)}>Save</button>
                                  <button type="button" style={{ ...buttonBaseStyle, backgroundColor: "#6B7280" }} onClick={() => setEditingBucketId("")}>Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (isManagingBuckets && !editingBucketId) {
                                      setSelectedManageBucketId(bucket.id);
                                    }
                                  }}
                                  style={{ border: "none", background: "transparent", padding: 0, textAlign: "left", cursor: isManagingBuckets ? "pointer" : "default", flex: 1 }}
                                >
                                  <strong>{bucket.name}</strong>
                                  {bucket.description ? <p style={{ margin: "2px 0 0", color: "#6B7280", fontSize: "0.83rem" }}>{bucket.description}</p> : null}
                                  {(normalizeValue(bucket.cardReviewProjectId) || normalizeCardReviewStep(bucket.cardReviewStep) || normalizeValue(bucket.cardReviewCardRef)) ? (
                                    <p style={{ margin: "4px 0 0", color: "#334155", fontSize: "0.8rem", fontWeight: 600 }}>
                                      {normalizeValue(bucket.cardReviewProjectId)
                                        ? `Project: ${normalizeValue(bucket.cardReviewProjectId)}`
                                        : "Project: -"}
                                      {" | "}
                                      {normalizeCardReviewStep(bucket.cardReviewStep)
                                        ? `Step: ${CARD_REVIEW_STEP_LABEL_BY_ID[normalizeCardReviewStep(bucket.cardReviewStep)] || bucket.cardReviewStep}`
                                        : "Step: -"}
                                      {normalizeValue(bucket.cardReviewCardRef)
                                        ? ` | Card: ${normalizeValue(bucket.cardReviewCardRef)}`
                                        : " | Card: -"}
                                    </p>
                                  ) : null}
                                </button>
                                {isManagingBuckets && !editingBucketId && selectedManageBucketId === bucket.id && (
                                  <span style={{ alignSelf: "center", fontSize: "0.76rem", backgroundColor: "#EDE9FE", color: "#5B21B6", borderRadius: "999px", padding: "3px 8px", fontWeight: 700 }}>
                                    Selected
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      {!editingBucketId && buckets.length > 0 && (
                        <div style={{ display: "flex", gap: "8px", marginTop: "10px", marginBottom: "16px", flexWrap: "wrap" }}>
                          <button
                            type="button"
                            style={{ ...buttonBaseStyle, backgroundColor: selectedManageBucketId ? "#0F766E" : "#94A3B8" }}
                            disabled={!selectedManageBucketId}
                            onClick={() => {
                              const bucketToEdit = buckets.find((bucket) => bucket.id === selectedManageBucketId);
                              if (!bucketToEdit) return;
                              setEditingBucketId(bucketToEdit.id);
                              setEditBucketDraft({
                                name: bucketToEdit.name || "",
                                description: bucketToEdit.description || "",
                                cardReviewProjectId: normalizeValue(bucketToEdit.cardReviewProjectId),
                                cardReviewStep: normalizeCardReviewStep(bucketToEdit.cardReviewStep),
                                cardReviewCardRef: normalizeValue(bucketToEdit.cardReviewCardRef),
                              });
                            }}
                          >
                            Edit Selected
                          </button>
                          <button
                            type="button"
                            style={{ ...buttonBaseStyle, backgroundColor: selectedManageBucketId ? "#DC2626" : "#94A3B8" }}
                            disabled={!selectedManageBucketId}
                            onClick={() => {
                              if (!selectedManageBucketId) return;
                              handleDeleteBucket(selectedManageBucketId);
                              setSelectedManageBucketId("");
                            }}
                          >
                            Delete Selected
                          </button>
                        </div>
                      )}
                    </>
                  )}

                  {/* Issues grouped by bucket for selected project */}
                  {selectedProjectId && (
                    <>
                      <h3 style={{ margin: "0 0 10px" }}>Issues by Bucket â€” {selectedProject?.name}</h3>

                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "8px", marginBottom: "10px" }}>
                        <div>
                          <label style={{ display: "block", fontWeight: 600, fontSize: "0.78rem", marginBottom: "4px", color: "#475569", textTransform: "uppercase" }}>
                            Completed From
                          </label>
                          <input
                            type="date"
                            style={inputStyle}
                            value={completedDateFrom}
                            onChange={(event) => setCompletedDateFrom(event.target.value)}
                          />
                        </div>
                        <div>
                          <label style={{ display: "block", fontWeight: 600, fontSize: "0.78rem", marginBottom: "4px", color: "#475569", textTransform: "uppercase" }}>
                            Completed To
                          </label>
                          <input
                            type="date"
                            style={inputStyle}
                            value={completedDateTo}
                            onChange={(event) => setCompletedDateTo(event.target.value)}
                          />
                        </div>
                        <div style={{ display: "flex", alignItems: "flex-end" }}>
                          <button
                            type="button"
                            style={{ ...buttonBaseStyle, backgroundColor: "#475569", width: "100%" }}
                            onClick={() => {
                              setCompletedDateFrom("");
                              setCompletedDateTo("");
                            }}
                            disabled={!completedDateFrom && !completedDateTo}
                          >
                            Clear Date Filter
                          </button>
                        </div>
                        <div>
                          <label style={{ display: "block", fontWeight: 600, fontSize: "0.78rem", marginBottom: "4px", color: "#475569", textTransform: "uppercase" }}>
                            Buckets To Show
                          </label>
                          <details style={{ position: "relative" }}>
                            <summary
                              style={{
                                ...inputStyle,
                                listStyle: "none",
                                cursor: "pointer",
                                userSelect: "none",
                                display: "flex",
                                alignItems: "center",
                                minHeight: "40px",
                                justifyContent: "space-between",
                              }}
                            >
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: "8px" }}>
                                {selectedBucketFilterLabel}
                              </span>
                              <span style={{ fontSize: "0.72rem", color: "#475569", fontWeight: 700 }}>
                                {bucketVisibilityFilterIds.length === 0 ? "ALL" : bucketVisibilityFilterIds.length}
                              </span>
                            </summary>
                            <div
                              style={{
                                position: "absolute",
                                top: "calc(100% + 4px)",
                                left: 0,
                                right: 0,
                                zIndex: 20,
                                backgroundColor: "#FFFFFF",
                                border: "1px solid #CBD5E1",
                                borderRadius: "8px",
                                boxShadow: "0 8px 20px rgba(15, 23, 42, 0.12)",
                                padding: "8px",
                                maxHeight: "220px",
                                overflowY: "auto",
                                display: "grid",
                                gap: "6px",
                              }}
                            >
                              <input
                                style={{ ...inputStyle, fontSize: "0.8rem", padding: "6px 8px" }}
                                placeholder="Search buckets..."
                                value={bucketFilterSearchQuery}
                                onChange={(event) => setBucketFilterSearchQuery(event.target.value)}
                              />
                              <div style={{ display: "flex", gap: "6px" }}>
                                <button
                                  type="button"
                                  style={{ ...buttonBaseStyle, backgroundColor: "#334155", fontSize: "0.7rem", padding: "4px 8px" }}
                                  onClick={() => setBucketVisibilityFilterIds(bucketFilterOptions.map((option) => option.id))}
                                  disabled={bucketFilterOptions.length === 0}
                                >
                                  Select All
                                </button>
                                <button
                                  type="button"
                                  style={{ ...buttonBaseStyle, backgroundColor: "#64748B", fontSize: "0.7rem", padding: "4px 8px" }}
                                  onClick={() => setBucketVisibilityFilterIds([])}
                                  disabled={bucketVisibilityFilterIds.length === 0}
                                >
                                  Clear
                                </button>
                              </div>
                              {visibleBucketFilterOptions.length === 0 ? (
                                <span style={{ color: "#64748B", fontSize: "0.82rem" }}>No buckets available for current filters.</span>
                              ) : (
                                <>
                                  {visibleBucketFilterOptions.map((option) => {
                                    const isChecked = bucketVisibilityFilterIds.includes(option.id);
                                    return (
                                      <label
                                        key={`bucket-visibility-${option.id}`}
                                        style={{
                                          display: "grid",
                                          gridTemplateColumns: "16px minmax(0, 1fr) auto",
                                          alignItems: "center",
                                          gap: "8px",
                                          fontSize: "0.84rem",
                                          color: "#334155",
                                          cursor: "pointer",
                                        }}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          style={{ margin: 0 }}
                                          onChange={(event) => {
                                            if (event.target.checked) {
                                              setBucketVisibilityFilterIds((previous) => previous.includes(option.id) ? previous : [...previous, option.id]);
                                            } else {
                                              setBucketVisibilityFilterIds((previous) => previous.filter((value) => value !== option.id));
                                            }
                                          }}
                                        />
                                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{option.name}</span>
                                        <span style={{ fontSize: "0.75rem", color: "#64748B", fontVariantNumeric: "tabular-nums" }}>{option.count}</span>
                                      </label>
                                    );
                                  })}
                                  {visibleBucketFilterOptions.length > 5 ? (
                                    <div
                                      style={{
                                        position: "sticky",
                                        bottom: 0,
                                        marginTop: "2px",
                                        padding: "6px 8px",
                                        borderRadius: "6px",
                                        background: "linear-gradient(180deg, rgba(255,255,255,0.86) 0%, #FFFFFF 55%)",
                                        color: "#1D4ED8",
                                        fontSize: "0.74rem",
                                        fontWeight: 700,
                                        textAlign: "center",
                                        borderTop: "1px solid #DBEAFE",
                                      }}
                                    >
                                      Scroll to see more buckets ↓
                                    </div>
                                  ) : null}
                                </>
                              )}
                            </div>
                          </details>
                        </div>
                      </div>

                      <div style={{ marginBottom: "10px" }}>
                        <input
                          type="text"
                          style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
                          placeholder="Search issues by title, number, or description..."
                          value={bucketTabIssueSearchQuery}
                          onChange={(e) => setBucketTabIssueSearchQuery(e.target.value)}
                        />
                      </div>

                      {bucketTabSearchedIssuesByBucket.length === 0 ? (
                        <p style={{ color: "#6B7280" }}>
                          {bucketTabIssueSearchQuery.trim()
                            ? "No issues match your search."
                            : "No issues assigned to buckets for this project yet."}
                        </p>
                      ) : (
                        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) minmax(0, 2fr)", gap: "10px", alignItems: "start" }}>
                          <aside
                            style={{
                              border: "1px solid #D1D5DB",
                              borderRadius: "10px",
                              backgroundColor: "#FFFFFF",
                              padding: "10px",
                              position: "sticky",
                              top: "10px",
                              maxHeight: "76vh",
                              overflowY: "auto",
                            }}
                          >
                            <div style={{ fontSize: "0.78rem", fontWeight: 800, color: "#334155", textTransform: "uppercase", marginBottom: "8px", letterSpacing: "0.02em" }}>
                              Buckets ({bucketTabSearchedIssuesByBucket.length})
                            </div>
                            <div style={{ display: "grid", gap: "6px" }}>
                              {bucketTabSearchedIssuesByBucket.map((group) => {
                                const completedCount = group.issues.filter(
                                  (issue) => String(issue.status || "").toLowerCase() === "complete"
                                ).length;
                                const remainingCount = group.issues.length - completedCount;

                                return (
                                  <button
                                    key={`bucket-nav-${group.id}`}
                                    type="button"
                                    onClick={() => handleScrollToBucketGroup(group.id)}
                                    style={{
                                      width: "100%",
                                      textAlign: "left",
                                      border: "1px solid #E2E8F0",
                                      borderRadius: "8px",
                                      backgroundColor: "#F8FAFC",
                                      padding: "8px 10px",
                                      cursor: "pointer",
                                      display: "grid",
                                      gap: "3px",
                                    }}
                                  >
                                    <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "#0F172A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                      {group.name}
                                    </span>
                                    <span style={{ fontSize: "0.74rem", color: "#64748B" }}>
                                      Total: {group.issues.length} • Remaining: {remainingCount} • Completed: {completedCount}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </aside>

                          <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "minmax(0, 1fr)" }}>
                            {bucketTabSearchedIssuesByBucket.map((group) => {
                              const completedCount = group.issues.filter(
                                (issue) => String(issue.status || "").toLowerCase() === "complete"
                              ).length;
                              const remainingCount = group.issues.length - completedCount;
                              const showCompletedIssues = !!showCompletedByBucketId[group.id];
                              const visibleIssues = showCompletedIssues
                                ? group.issues
                                : group.issues.filter((issue) => String(issue.status || "").toLowerCase() !== "complete");

                              return (
                              <div id={`bucket-group-${group.id}`} key={group.id} style={{ border: "1px solid #D1D5DB", borderRadius: "10px", padding: "12px", backgroundColor: "#F8FAFC", scrollMarginTop: "14px" }}>
                              <div style={{ textAlign: "center", marginBottom: "8px" }}>
                                <span style={{ fontSize: "2.5rem", fontWeight: 800, color: "#1D4ED8", lineHeight: 1 }}>
                                  {remainingCount}
                                </span>
                                <div style={{ fontSize: "0.75rem", color: "#6B7280", marginTop: "2px", fontWeight: 600, textTransform: "uppercase" }}>Remaining (Unchecked)</div>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                                <strong>{group.name}</strong>
                                <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setShowCompletedByBucketId((previous) => ({
                                        ...previous,
                                        [group.id]: !previous[group.id],
                                      }))
                                    }
                                    title={showCompletedIssues ? "Hide completed" : "Show completed"}
                                    style={{
                                      border: "1px solid #CBD5E1",
                                      borderRadius: "999px",
                                      backgroundColor: showCompletedIssues ? "#DCFCE7" : "#FFFFFF",
                                      color: showCompletedIssues ? "#166534" : "#64748B",
                                      fontSize: "0.72rem",
                                      fontWeight: 700,
                                      padding: "3px 8px",
                                      cursor: "pointer",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "4px",
                                    }}
                                  >
                                    <span style={{ fontSize: "0.8rem", lineHeight: 1 }}>✓</span>
                                    {showCompletedIssues ? "Completed: ON" : "Completed: OFF"}
                                  </button>
                                  <span style={{ fontSize: "0.78rem", backgroundColor: "#E2E8F0", color: "#1E293B", borderRadius: "999px", padding: "2px 8px", fontWeight: 700 }}>
                                    {remainingCount} left
                                  </span>
                                </div>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginBottom: "8px", fontSize: "0.75rem", color: "#64748B", fontWeight: 600 }}>
                                <span>Total: {group.issues.length}</span>
                                <span>Completed: {completedCount}</span>
                              </div>
                              {visibleIssues.length === 0 ? (
                                <div style={{ border: "1px dashed #CBD5E1", borderRadius: "8px", backgroundColor: "#FFFFFF", padding: "10px", color: "#64748B", fontSize: "0.82rem" }}>
                                  {completedCount > 0 && !showCompletedIssues
                                    ? "Completed issues are hidden. Use the check toggle to show them."
                                    : "No issues to display in this bucket."}
                                </div>
                              ) : null}
                              <div style={{ display: "grid", gap: "5px" }}>
                                {visibleIssues.map((issue) => {
                                  const { bg, text } = statusBadgeColor(issue.status);
                                  const isCompleted = String(issue.status || "").toLowerCase() === "complete";
                                  const isMovingIssue = movingIssueId === issue.id;
                                  const issueNotes = normalizeIssueNotes(issue.notes);
                                  const hasIssueNotes = issueNotes.length > 0;
                                  const notesTooltip = buildIssueNotesTooltip(issueNotes);
                                  const latestIssueNote = issueNotes.length > 0 ? issueNotes[issueNotes.length - 1] : null;
                                  const completedAtDate = issue.completedAt?.toDate?.();
                                  const completedAtLabel = completedAtDate
                                    ? completedAtDate.toLocaleString()
                                    : "";
                                  const completedByEmail = String(issue.completedByEmail || "").trim();
                                  const completedByUid = String(issue.completedByUid || "").trim();
                                  const completedByLabel = completedByEmail || completedByUid || "Unknown user";
                                  const completionTooltip = isCompleted
                                    ? [
                                        completedByEmail ? `Completed by: ${completedByEmail}` : completedByUid ? `Completed by UID: ${completedByUid}` : "Completed by: Unknown user",
                                        completedAtLabel ? `Completed at: ${completedAtLabel}` : "Completed at: Pending timestamp",
                                      ].join("\n")
                                    : "Mark as complete";
                                  return (
                                    <div
                                      key={issue.id}
                                      style={{ border: "1px solid #E2E8F0", borderRadius: "6px", padding: "6px 8px", backgroundColor: "#FFFFFF" }}
                                      title={isCompleted ? completionTooltip : undefined}
                                      onDoubleClick={(event) => {
                                        const interactiveAncestor = event.target?.closest?.("button, input, select, textarea, label");
                                        if (interactiveAncestor) return;
                                        setMovingIssueId(issue.id);
                                        setMovingIssueBucketId(String(issue.bucketId || ""));
                                      }}
                                    >
                                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "4px" }}>
                                        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                          <input
                                            type="checkbox"
                                            checked={isCompleted}
                                            onChange={(event) => handleToggleIssueComplete(issue, event.target.checked)}
                                            onDoubleClick={(event) => event.stopPropagation()}
                                            title={completionTooltip}
                                          />
                                          <span style={{ fontWeight: 700, fontSize: "0.88rem" }}>#{issue.issueNumber || "-"}</span>
                                        </span>
                                        <span style={{ fontSize: "0.75rem", backgroundColor: bg, color: text, borderRadius: "999px", padding: "2px 6px", fontWeight: 700 }}>
                                          {issue.status || "Open"}
                                        </span>
                                      </div>
                                      {issue.title ? <div style={{ fontSize: "0.8rem", color: "#475569", marginTop: "2px" }}>{issue.title}</div> : null}
                                      <div style={{ marginTop: "4px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                                        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                          <button
                                            type="button"
                                            onClick={() => handleAddIssueNote(issue)}
                                            title="Add note"
                                            style={{
                                              border: "1px solid #CBD5E1",
                                              borderRadius: "999px",
                                              padding: "0",
                                              width: "20px",
                                              height: "20px",
                                              minWidth: "20px",
                                              fontSize: "0.9rem",
                                              fontWeight: 700,
                                              color: "#334155",
                                              backgroundColor: "#F8FAFC",
                                              cursor: "pointer",
                                              lineHeight: 1,
                                            }}
                                          >
                                            +
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => openIssueNotesModal(issue)}
                                            title={hasIssueNotes ? notesTooltip : "No notes yet. Click to view and add."}
                                            style={{
                                              border: "1px solid #CBD5E1",
                                              borderRadius: "999px",
                                              padding: "2px 8px",
                                              fontSize: "0.72rem",
                                              fontWeight: 700,
                                              color: hasIssueNotes ? "#1E3A8A" : "#475569",
                                              backgroundColor: hasIssueNotes ? "#EFF6FF" : "#F8FAFC",
                                              cursor: "pointer",
                                              lineHeight: 1.2,
                                            }}
                                          >
                                            {`Notes (${issueNotes.length})`}
                                          </button>
                                        </div>
                                        {latestIssueNote ? (
                                          <span
                                            title={notesTooltip}
                                            style={{ fontSize: "0.72rem", color: "#475569", lineHeight: 1.35, textAlign: "right" }}
                                          >
                                            Last note by {getIssueNoteAuthorLabel(latestIssueNote)}
                                          </span>
                                        ) : (
                                          <span style={{ fontSize: "0.72rem", color: "#94A3B8" }}>No notes yet</span>
                                        )}
                                      </div>
                                      {isMovingIssue ? (
                                        <div style={{ marginTop: "6px", border: "1px solid #BFDBFE", borderRadius: "8px", backgroundColor: "#EFF6FF", padding: "8px" }}>
                                          <div style={{ fontSize: "0.72rem", color: "#1D4ED8", fontWeight: 700, marginBottom: "6px" }}>
                                            Move issue to another bucket
                                          </div>
                                          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                                            <select
                                              style={{ ...inputStyle, fontSize: "0.78rem", padding: "6px 8px" }}
                                              value={movingIssueBucketId}
                                              onChange={(event) => setMovingIssueBucketId(event.target.value)}
                                            >
                                              <option value="">— No Bucket —</option>
                                              {buckets.map((bucketOption) => (
                                                <option key={`move-issue-${issue.id}-${bucketOption.id}`} value={bucketOption.id}>
                                                  {bucketOption.name || "Untitled Bucket"}
                                                </option>
                                              ))}
                                            </select>
                                            <button
                                              type="button"
                                              style={{ ...buttonBaseStyle, backgroundColor: "#2563EB", fontSize: "0.72rem", padding: "4px 8px" }}
                                              onClick={() => handleMoveIssueToBucket(issue)}
                                            >
                                              Save
                                            </button>
                                            <button
                                              type="button"
                                              style={{ ...buttonBaseStyle, backgroundColor: "#64748B", fontSize: "0.72rem", padding: "4px 8px" }}
                                              onClick={() => {
                                                setMovingIssueId("");
                                                setMovingIssueBucketId("");
                                              }}
                                            >
                                              Cancel
                                            </button>
                                          </div>
                                        </div>
                                      ) : null}
                                      {isCompleted ? (
                                        <div style={{ marginTop: "4px", fontSize: "0.74rem", color: "#166534", lineHeight: 1.35 }}>
                                          Completed by: {completedByLabel}
                                          <br />
                                          Completed at: {completedAtLabel || "Pending timestamp"}
                                        </div>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                              </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </>
          )}

          {/* â”€â”€ TASKS FOR THE DAY TAB â”€â”€ */}
          {activeTab === "tasksForDay" && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "10px" }}>
                <h2 style={{ margin: 0 }}>Tasks For The Day</h2>
                <span style={{ fontSize: "0.84rem", backgroundColor: "#E0E7FF", color: "#3730A3", borderRadius: "999px", padding: "5px 10px", fontWeight: 700 }}>
                  {todayDateKey}
                </span>
              </div>

              {!selectedProjectId ? (
                <div style={{ backgroundColor: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "8px", padding: "12px 16px", color: "#991B1B", fontWeight: 600 }}>
                  Please select a project first.
                </div>
              ) : (
                <>
                  <form
                    onSubmit={handleAssignTaskForDay}
                    style={{ border: "1px solid #C7D2FE", borderRadius: "10px", padding: "14px", marginBottom: "14px", backgroundColor: "#EEF2FF" }}
                  >
                    <h3 style={{ marginTop: 0, marginBottom: "12px", color: "#3730A3" }}>Assign Bucket Task</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px" }}>
                      <div>
                        <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", marginBottom: "4px" }}>User *</label>
                        <select
                          style={inputStyle}
                          value={taskAssigneeUserId}
                          onChange={(event) => setTaskAssigneeUserId(event.target.value)}
                          disabled={loadingOrganizationUsers}
                        >
                          <option value="">â€” Select user â€”</option>
                          {organizationUsers.map((person) => (
                            <option key={person.id} value={person.id}>
                              {person.name}{person.email ? ` (${person.email})` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", marginBottom: "8px" }}>Buckets (select multiple)</label>
                        {buckets.length === 0 ? (
                          <p style={{ margin: 0, color: "#6B7280", fontSize: "0.85rem" }}>No buckets available.</p>
                        ) : (
                          <div style={{ display: "grid", gap: "6px", maxHeight: "200px", overflowY: "auto", padding: "6px", border: "1px solid #D1D5DB", borderRadius: "6px", backgroundColor: "#FAFAFA" }}>
                            {buckets.map((bucket) => {
                              const isChecked = taskBucketIds.includes(bucket.id);
                              return (
                                <label key={bucket.id} style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", margin: 0, fontSize: "0.9rem" }}>
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(event) => {
                                      if (event.target.checked) {
                                        setTaskBucketIds([...taskBucketIds, bucket.id]);
                                      } else {
                                        setTaskBucketIds(taskBucketIds.filter((id) => id !== bucket.id));
                                      }
                                    }}
                                    style={{ cursor: "pointer" }}
                                  />
                                  <span>{bucket.name || "Untitled Bucket"}</span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ marginTop: "10px" }}>
                      <button type="submit" style={{ ...buttonBaseStyle, backgroundColor: "#4F46E5" }}>
                        Assign Task
                      </button>
                    </div>
                  </form>

                  <div style={{ border: "1px solid #E5E7EB", borderRadius: "10px", backgroundColor: "#FFFFFF", overflow: "hidden" }}>
                    <div style={{ padding: "12px", borderBottom: "1px solid #E5E7EB", backgroundColor: "#F8FAFC" }}>
                      <strong>All Users</strong>
                    </div>
                    {loadingOrganizationUsers ? (
                      <p style={{ margin: 0, padding: "12px", color: "#64748B" }}>Loading users...</p>
                    ) : organizationUsers.length === 0 ? (
                      <p style={{ margin: 0, padding: "12px", color: "#64748B" }}>No users found for this organization.</p>
                    ) : (
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "640px" }}>
                          <thead>
                            <tr style={{ borderBottom: "1px solid #E2E8F0", backgroundColor: "#F8FAFC" }}>
                              <th style={{ textAlign: "left", padding: "10px 12px", fontSize: "0.78rem", color: "#475569", textTransform: "uppercase" }}>User</th>
                              <th style={{ textAlign: "left", padding: "10px 12px", fontSize: "0.78rem", color: "#475569", textTransform: "uppercase" }}>Email</th>
                              <th style={{ textAlign: "left", padding: "10px 12px", fontSize: "0.78rem", color: "#475569", textTransform: "uppercase" }}>Assigned Buckets Today</th>
                              <th style={{ textAlign: "left", padding: "10px 12px", fontSize: "0.78rem", color: "#475569", textTransform: "uppercase" }}>Issues in Assigned Buckets</th>
                            </tr>
                          </thead>
                          <tbody>
                            {organizationUsers.map((person) => {
                              const assignments = tasksByUserId.get(person.id) || [];
                              const assignedBucketsLabel = assignments.length
                                ? assignments.map((assignment) => assignment.bucketName || "Untitled Bucket").join(", ")
                                : "No tasks assigned";

                              const assignedBucketIds = assignments.map((assignment) => String(assignment?.bucketId || "").trim()).filter(Boolean);
                              const issuesInBuckets = issues.filter((issue) => assignedBucketIds.includes(String(issue?.bucketId || "").trim()));
                              const issuesLabel = issuesInBuckets.length
                                ? issuesInBuckets.map((issue) => issue.issueNumber || `#${issue.id}`).join(", ")
                                : "No issues";

                              return (
                                <tr key={person.id} style={{ borderTop: "1px solid #E5E7EB" }}>
                                  <td style={{ padding: "10px 12px", color: "#0F172A", fontWeight: 600 }}>{person.name || person.id}</td>
                                  <td style={{ padding: "10px 12px", color: "#475569" }}>{person.email || "-"}</td>
                                  <td style={{ padding: "10px 12px", color: assignments.length ? "#0F766E" : "#64748B", fontWeight: assignments.length ? 700 : 500 }}>
                                    {assignedBucketsLabel}
                                  </td>
                                  <td style={{ padding: "10px 12px", color: issuesInBuckets.length ? "#1E40AF" : "#64748B", fontWeight: issuesInBuckets.length ? 600 : 400, fontSize: "0.9rem" }}>
                                    {issuesLabel}
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
            </>
          )}

          {/* â”€â”€ TOTAL DAY COUNT TAB â”€â”€ */}
          {activeTab === "dayCounts" && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "10px" }}>
                <h2 style={{ margin: 0 }}>Total Day Count</h2>
                {selectedProjectId && (
                  <div style={{ backgroundColor: "#DBEAFE", color: "#1D4ED8", borderRadius: "999px", padding: "6px 12px", fontWeight: 700 }}>
                    Total Days: {selectedProjectTotalDayCount}
                  </div>
                )}
              </div>

              {!selectedProjectId ? (
                <div style={{ backgroundColor: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "8px", padding: "12px 16px", color: "#991B1B", fontWeight: 600 }}>
                  Please select a project first.
                </div>
              ) : (
                <div style={{ display: "grid", gap: "12px", width: "100%" }}>
                  <div style={{ border: "1px solid #DBEAFE", borderRadius: "10px", padding: "14px", backgroundColor: "#F8FBFF", width: "100%" }}>
                    <p style={{ marginTop: 0, marginBottom: "10px", color: "#334155", fontWeight: 600 }}>
                      Daily Change Chart
                    </p>

                    {dailyDayCountSeries.length === 0 ? (
                      <p style={{ margin: 0, color: "#64748B" }}>No history yet. Save a day count to start tracking.</p>
                    ) : (
                      (() => {
                        const chartWidth = 640;
                        const chartHeight = 220;
                        const leftPad = 48;
                        const rightPad = 20;
                        const topPad = 16;
                        const bottomPad = 34;

                        const values = dailyDayCountSeries.map((item) => item.value);
                        const minValue = Math.min(...values);
                        const maxValue = Math.max(...values);
                        const valueRange = maxValue - minValue || 1;
                        const usableWidth = chartWidth - leftPad - rightPad;
                        const usableHeight = chartHeight - topPad - bottomPad;
                        const stepX = dailyDayCountSeries.length > 1 ? usableWidth / (dailyDayCountSeries.length - 1) : 0;

                        const points = dailyDayCountSeries.map((point, index) => {
                          const x = leftPad + (stepX * index);
                          const y = topPad + ((maxValue - point.value) / valueRange) * usableHeight;
                          return { ...point, x, y };
                        });

                        const polylinePoints = points.map((point) => `${point.x},${point.y}`).join(" ");

                        return (
                          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} style={{ width: "100%", height: "auto", display: "block" }}>
                            <line x1={leftPad} y1={topPad + usableHeight} x2={chartWidth - rightPad} y2={topPad + usableHeight} stroke="#CBD5E1" strokeWidth="1" />
                            <line x1={leftPad} y1={topPad} x2={leftPad} y2={topPad + usableHeight} stroke="#CBD5E1" strokeWidth="1" />

                            <polyline fill="none" stroke="#2563EB" strokeWidth="2.5" points={polylinePoints} />

                            {points.map((point) => (
                              <g key={point.date}>
                                <circle cx={point.x} cy={point.y} r="3.5" fill="#1D4ED8" />
                                <text x={point.x} y={chartHeight - 10} textAnchor="middle" fontSize="10" fill="#64748B">
                                  {point.date.slice(5)}
                                </text>
                              </g>
                            ))}

                            <text x="8" y={topPad + 8} fontSize="10" fill="#64748B">{maxValue}</text>
                            <text x="8" y={topPad + usableHeight} fontSize="10" fill="#64748B">{minValue}</text>
                          </svg>
                        );
                      })()
                    )}
                  </div>

                  <div style={{ border: "1px solid #E5E7EB", borderRadius: "8px", padding: "16px", backgroundColor: "#FFFFFF", width: "100%" }}>
                    <p style={{ marginTop: 0, color: "#475569" }}>
                      Set one total day count for this project. Saving automatically records today in the history log.
                    </p>
                    {hasTodayDayCountLog && (
                      <p style={{ marginTop: 0, color: "#B45309", fontWeight: 600 }}>
                        Today's value is already logged. Next entry allowed tomorrow.
                      </p>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <input
                        type="number"
                        min="0"
                        step="0.25"
                        style={{ ...inputStyle, width: "180px" }}
                        value={projectDayCountDraft}
                        onChange={(e) => setProjectDayCountDraft(e.target.value)}
                        placeholder="Project total days"
                        disabled={hasTodayDayCountLog}
                      />
                      <button
                        type="button"
                        style={{ ...buttonBaseStyle, backgroundColor: "#2563EB" }}
                        onClick={handleSaveProjectDayCount}
                        disabled={hasTodayDayCountLog}
                      >
                        Save
                      </button>
                    </div>
                  </div>

                  <div style={{ border: "1px solid #E5E7EB", borderRadius: "8px", padding: "16px", backgroundColor: "#FFFFFF", width: "100%" }}>
                    <h3 style={{ marginTop: 0, marginBottom: "10px", fontSize: "1rem" }}>Day Count Log</h3>
                    {loadingDayCountLogs ? (
                      <p style={{ margin: 0, color: "#64748B" }}>Loading log...</p>
                    ) : dayCountLogs.length === 0 ? (
                      <p style={{ margin: 0, color: "#64748B" }}>No entries yet.</p>
                    ) : (
                      <div style={{ display: "grid", gap: "6px" }}>
                        {dayCountLogs.slice().reverse().map((entry, index) => {
                          const previous = dayCountLogs[dayCountLogs.length - index - 2];
                          const delta = previous ? normalizeDayCount(entry.dayCount - previous.dayCount) : 0;
                          const deltaColor = delta > 0 ? "#047857" : delta < 0 ? "#B91C1C" : "#475569";

                          return (
                            <div key={entry.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #F1F5F9", paddingBottom: "6px" }}>
                              <span style={{ color: "#334155", fontWeight: 600 }}>{entry.recordedDate || "Unknown date"}</span>
                              <span style={{ color: "#1E293B" }}>{entry.dayCount}</span>
                              <span style={{ color: deltaColor, fontWeight: 600 }}>
                                {delta > 0 ? `+${delta}` : `${delta}`}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {selectedIssueForNotes && (
            <div
              role="dialog"
              aria-modal="true"
              onClick={closeIssueNotesModal}
              style={{
                position: "fixed",
                inset: 0,
                backgroundColor: "rgba(15, 23, 42, 0.45)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "16px",
                zIndex: 80,
              }}
            >
              <div
                onClick={(event) => event.stopPropagation()}
                style={{
                  width: "min(680px, 100%)",
                  maxHeight: "90vh",
                  overflow: "hidden",
                  backgroundColor: "#FFFFFF",
                  borderRadius: "12px",
                  border: "1px solid #E2E8F0",
                  boxShadow: "0 24px 50px rgba(15, 23, 42, 0.28)",
                  display: "grid",
                  gridTemplateRows: "auto 1fr auto",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", padding: "12px 14px", borderBottom: "1px solid #E2E8F0" }}>
                  <div>
                    <div style={{ fontSize: "0.76rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase" }}>
                      Issue #{selectedIssueForNotes.issueNumber || selectedIssueForNotes.id}
                    </div>
                    <div style={{ fontSize: "0.98rem", color: "#0F172A", fontWeight: 700 }}>
                      Notes
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={closeIssueNotesModal}
                    style={{
                      border: "1px solid #CBD5E1",
                      borderRadius: "8px",
                      backgroundColor: "#FFFFFF",
                      color: "#334155",
                      width: "32px",
                      height: "32px",
                      cursor: "pointer",
                      fontSize: "1.05rem",
                      lineHeight: 1,
                    }}
                    aria-label="Close notes"
                  >
                    ×
                  </button>
                </div>

                <div style={{ padding: "12px 14px", overflowY: "auto", display: "grid", gap: "8px", backgroundColor: "#F8FAFC" }}>
                  {selectedIssueModalNotes.length === 0 ? (
                    <div style={{ border: "1px dashed #CBD5E1", borderRadius: "8px", backgroundColor: "#FFFFFF", padding: "12px", color: "#64748B" }}>
                      No notes yet. Use the box below to add the first note.
                    </div>
                  ) : (
                    selectedIssueModalNotes.slice().reverse().map((note, index) => (
                      <div
                        key={`${note.createdAtIso || "note"}-${index}`}
                        style={{ border: "1px solid #E2E8F0", borderRadius: "8px", backgroundColor: "#FFFFFF", padding: "10px" }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginBottom: "6px", flexWrap: "wrap" }}>
                          <span style={{ fontSize: "0.78rem", color: "#1E3A8A", fontWeight: 700 }}>{getIssueNoteAuthorLabel(note)}</span>
                          <span style={{ fontSize: "0.74rem", color: "#64748B" }}>{formatIssueNoteTimestamp(note.createdAtIso)}</span>
                        </div>
                        <div style={{ fontSize: "0.86rem", color: "#0F172A", whiteSpace: "pre-wrap", lineHeight: 1.4 }}>
                          {note.text}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div style={{ padding: "12px 14px", borderTop: "1px solid #E2E8F0", backgroundColor: "#FFFFFF" }}>
                  <div style={{ display: "grid", gap: "8px" }}>
                    <textarea
                      style={{ ...textareaStyle, minHeight: "84px" }}
                      value={issueNoteDraft}
                      onChange={(event) => setIssueNoteDraft(event.target.value)}
                      placeholder="Write a note..."
                    />
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                      <button
                        type="button"
                        style={{ ...buttonBaseStyle, backgroundColor: "#64748B" }}
                        onClick={closeIssueNotesModal}
                      >
                        Close
                      </button>
                      <button
                        type="button"
                        style={{ ...buttonBaseStyle, backgroundColor: "#1D4ED8" }}
                        onClick={handleSaveIssueNoteFromModal}
                      >
                        Add Note
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

        </section>
      </div>
    </div>
  );
};

export default ProjectListsIssuesModule;
