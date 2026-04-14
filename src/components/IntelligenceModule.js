import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { collection, doc, getDoc, onSnapshot, updateDoc } from "firebase/firestore";
import { toast } from "react-toastify";
import ChurchHeader from "./ChurchHeader";
import {
  DEFAULT_E2_STATUS_UPDATE,
  DEFAULT_E2_STATUS_UPDATE_OPTIONS,
  E2_STATUS_UPDATE_OPTIONS_FIELD,
  PROJECT_ISSUE_CONFIG_DOC_ID,
  TAG_ALIASES_FIELD,
} from "./projectIssueConstants";
import commonStyles from "../pages/commonStyles";
import { db } from "../firebase";

const ISSUE_ID_FIELD_ALIASES = ["issue id", "id", "task id", "card id", "row id"];
const TITLE_FIELD_ALIASES = ["title", "task title", "name"];
const PROJECT_NAME_FIELD_ALIASES = ["project name", "projectname"];
const STATUS_FIELD_ALIASES = ["status", "issue status", "task status", "current status"];
const ZONE_FIELD_ALIASES = ["zone", "work zone", "area", "building zone"];
const PHASE_FIELD_ALIASES = ["phase", "project phase", "construction phase"];
const E2_STATUS_UPDATE_FIELD_ALIASES = ["e2 status update", "e2statusupdate"];
const E2_LEAD_DETAILER_FIELD_ALIASES = ["e2 lead detailer", "e2 detailer", "e2leaddetailer"];
const TECH_DETAILS_FIELD_ALIASES = ["technical details available", "technical details", "techdetailsavailable"];
const SNAPSHOT_FIELD_ALIASES = ["snapshot url", "snapshoturl", "snapshot", "picture", "photo", "image"];
const MARKUP_LINK_FIELD_ALIASES = ["link to markup", "markup link"];
const TAGS_FIELD_ALIASES = ["tags", "tag", "labels", "label"];
const INTELLIGENCE_TAGS_FIELD_ALIASES = ["intelligence tags", "intelligence tag", "intelligencetags"];
const INTELLIGENCE_TAGS_FIELD = "Intelligence Tags";
const E2_STATUS_UPDATE_FIELD = "E2 Status Update";
const UNASSIGNED_TAG_LABEL = "Not Assigned";
const ALL_TAGS_FILTER = "__all_tags__";
const GRAPH_COLORS = ["#2563eb", "#0ea5e9", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#14b8a6", "#f97316", "#64748b"];
const DAILY_ISSUES_TARGET_PROJECT_ID = "stanford-ff-rad";
const DAILY_ISSUES_IMPORT_HISTORY_COLLECTION = "importHistory";
const FIREBASE_FUNCTIONS_BASE_URL =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "/firebase-api"
    : "https://us-central1-igletechv1.cloudfunctions.net";

const normalizeValue = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
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

const hasTechnicalDetails = (value) => {
  const normalized = normalizeValue(value).toLowerCase();
  if (!normalized) return false;
  return !["no", "n", "false", "0", "none", "-"].includes(normalized);
};

const parseTags = (value) => {
  const rawTags = Array.isArray(value) ? value : String(value || "").split(",");
  const seen = new Set();

  return rawTags
    .map((tag) => normalizeValue(tag))
    .filter(Boolean)
    .filter((tag) => {
      const key = tag.toLowerCase();
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

const normalizeIssueIdValue = (value, fallbackValue = "") => {
  const raw = normalizeValue(value);
  if (!raw) return normalizeValue(fallbackValue);

  // Excel exports often emit numeric IDs like 11139.0; normalize to 11139.
  const trailingDecimal = raw.match(/^(\d+)\.0+$/);
  if (trailingDecimal) return trailingDecimal[1];

  return raw;
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

const toDateValue = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") {
    const converted = value.toDate();
    return converted instanceof Date && !Number.isNaN(converted.getTime()) ? converted : null;
  }

  const parsed = new Date(value);
  return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
};

const formatDateTime = (value) => {
  const dateValue = toDateValue(value);
  if (!dateValue) return "-";
  return dateValue.toLocaleString();
};

const IntelligenceModule = () => {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const selectedIssueId = normalizeValue(searchParams.get("issueId"));

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [issues, setIssues] = useState([]);
  const [remainderSearch, setRemainderSearch] = useState("");
  const [selectedZone, setSelectedZone] = useState("all");
  const [selectedPhase, setSelectedPhase] = useState("all");
  const [excludedStatuses, setExcludedStatuses] = useState({});
  const [excludedProjects, setExcludedProjects] = useState({});
  const [selectedTagFilter, setSelectedTagFilter] = useState(UNASSIGNED_TAG_LABEL);
  const [graphGroupBy, setGraphGroupBy] = useState("tag");
  const [enabledGraphZones, setEnabledGraphZones] = useState({});
  const [tagInputs, setTagInputs] = useState({});
  const [savingTagByIssueKey, setSavingTagByIssueKey] = useState({});
  const [savingStatusByIssueKey, setSavingStatusByIssueKey] = useState({});
  const [lightboxTicketKey, setLightboxTicketKey] = useState("");
  const [lightboxTagInput, setLightboxTagInput] = useState("");
  const [lightboxZoom, setLightboxZoom] = useState(1);
  const [isLightboxAiLoading, setIsLightboxAiLoading] = useState(false);
  const [lightboxAiError, setLightboxAiError] = useState("");
  const [lightboxAiTags, setLightboxAiTags] = useState([]);
  const [lightboxAiObjects, setLightboxAiObjects] = useState([]);
  const [statusOptions, setStatusOptions] = useState(DEFAULT_E2_STATUS_UPDATE_OPTIONS);
  const [managedTagAliases, setManagedTagAliases] = useState({});
  const [importHistoryLoading, setImportHistoryLoading] = useState(true);
  const [importHistoryError, setImportHistoryError] = useState("");
  const [importHistoryRows, setImportHistoryRows] = useState([]);

  const tagAliasByLowerKey = useMemo(() => {
    return Object.entries(managedTagAliases || {}).reduce((accumulator, [tagValue, aliasValue]) => {
      const normalizedTag = normalizeValue(tagValue).toLowerCase();
      const normalizedAlias = normalizeValue(aliasValue);
      if (!normalizedTag || !normalizedAlias) return accumulator;
      accumulator[normalizedTag] = normalizedAlias;
      return accumulator;
    }, {});
  }, [managedTagAliases]);

  useEffect(() => {
    if (!id) {
      setStatusOptions(DEFAULT_E2_STATUS_UPDATE_OPTIONS);
      return;
    }

    let isMounted = true;

    const loadStatusOptions = async () => {
      try {
        const configRef = doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID);
        const configSnap = await getDoc(configRef);
        if (!isMounted || !configSnap.exists()) {
          setStatusOptions(DEFAULT_E2_STATUS_UPDATE_OPTIONS);
          return;
        }

        const configData = configSnap.data() || {};
        const configured = Array.isArray(configData[E2_STATUS_UPDATE_OPTIONS_FIELD])
          ? configData[E2_STATUS_UPDATE_OPTIONS_FIELD].map((value) => normalizeValue(value)).filter(Boolean)
          : [];

        const configuredTagAliases =
          configData[TAG_ALIASES_FIELD] && typeof configData[TAG_ALIASES_FIELD] === "object"
            ? configData[TAG_ALIASES_FIELD]
            : {};
        const normalizedTagAliases = Object.entries(configuredTagAliases).reduce((accumulator, [tagValue, aliasValue]) => {
          const normalizedTag = normalizeValue(tagValue);
          const normalizedAlias = normalizeValue(aliasValue);
          if (!normalizedTag || !normalizedAlias) return accumulator;
          accumulator[normalizedTag] = normalizedAlias;
          return accumulator;
        }, {});

        const unique = Array.from(new Set([DEFAULT_E2_STATUS_UPDATE, ...configured]));
        setStatusOptions(unique.length ? unique : DEFAULT_E2_STATUS_UPDATE_OPTIONS);
        setManagedTagAliases(normalizedTagAliases);
      } catch (configError) {
        console.error("Failed to load E2 status options:", configError);
        setStatusOptions(DEFAULT_E2_STATUS_UPDATE_OPTIONS);
        setManagedTagAliases({});
      }
    };

    loadStatusOptions();

    return () => {
      isMounted = false;
    };
  }, [id]);

  useEffect(() => {
    if (!id) {
      setImportHistoryRows([]);
      setImportHistoryLoading(false);
      setImportHistoryError("Organization ID is missing.");
      return () => {};
    }

    setImportHistoryLoading(true);
    setImportHistoryError("");

    const historyRef = collection(
      db,
      "churches",
      id,
      "bimProjects",
      DAILY_ISSUES_TARGET_PROJECT_ID,
      DAILY_ISSUES_IMPORT_HISTORY_COLLECTION
    );

    const unsubscribe = onSnapshot(
      historyRef,
      (snapshot) => {
        const nextRows = snapshot.docs
          .map((docSnapshot) => ({
            id: docSnapshot.id,
            ...(docSnapshot.data() || {}),
          }))
          .sort((a, b) => {
            const aTime = toDateValue(a.createdAt)?.getTime() || 0;
            const bTime = toDateValue(b.createdAt)?.getTime() || 0;
            return bTime - aTime;
          });

        setImportHistoryRows(nextRows);
        setImportHistoryLoading(false);
      },
      (snapshotError) => {
        console.error("Failed to load import history:", snapshotError);
        setImportHistoryError("Could not load import changes history.");
        setImportHistoryRows([]);
        setImportHistoryLoading(false);
      }
    );

    return () => unsubscribe();
  }, [id]);

  useEffect(() => {
    if (!id) {
      setError("Organization ID is missing.");
      setLoading(false);
      return () => {};
    }

    setLoading(true);
    setError("");

    const projectsRef = collection(db, "churches", id, "bimProjects");
    const unsubscribe = onSnapshot(
      projectsRef,
      (snapshot) => {
        const nextIssues = [];

        snapshot.docs.forEach((projectDoc) => {
          const projectData = projectDoc.data() || {};
          const rows = Array.isArray(projectData.rows) ? projectData.rows : [];
          const fields = Array.isArray(projectData.fields) ? projectData.fields : [];
          const fallbackProjectName = normalizeValue(projectData.name) || projectDoc.id;

          rows.forEach((row, rowIndex) => {
            const rowData = resolveRowData(row);

            const idField = findFieldByAliases(fields, rowData, ISSUE_ID_FIELD_ALIASES);
            const titleField = findFieldByAliases(fields, rowData, TITLE_FIELD_ALIASES);
            const projectNameField = findFieldByAliases(fields, rowData, PROJECT_NAME_FIELD_ALIASES);
            const zoneField = findFieldByAliases(fields, rowData, ZONE_FIELD_ALIASES);
            const phaseField = findFieldByAliases(fields, rowData, PHASE_FIELD_ALIASES);
            const e2StatusField = findFieldByAliases(fields, rowData, E2_STATUS_UPDATE_FIELD_ALIASES);
            const rawStatusField = findFieldByAliases(fields, rowData, STATUS_FIELD_ALIASES);
            const statusField =
              rawStatusField && normalizeFieldKey(rawStatusField) !== normalizeFieldKey(e2StatusField)
                ? rawStatusField
                : null;
            const e2DetailerField = findFieldByAliases(fields, rowData, E2_LEAD_DETAILER_FIELD_ALIASES);
            const techDetailsField = findFieldByAliases(fields, rowData, TECH_DETAILS_FIELD_ALIASES);
            const snapshotField = findFieldByAliases(fields, rowData, SNAPSHOT_FIELD_ALIASES);
            const markupLinkField = findFieldByAliases(fields, rowData, MARKUP_LINK_FIELD_ALIASES);
            const tagsField = findFieldByAliases(fields, rowData, TAGS_FIELD_ALIASES);
            const intelligenceTagsField =
              findFieldByAliases(fields, rowData, INTELLIGENCE_TAGS_FIELD_ALIASES) || INTELLIGENCE_TAGS_FIELD;

            const issueId = normalizeIssueIdValue(idField ? rowData[idField] : rowData.id);
            const title = normalizeValue(titleField ? rowData[titleField] : rowData.title) || "Untitled";
            const projectName = normalizeValue(projectNameField ? rowData[projectNameField] : "") || fallbackProjectName;
            const zone = normalizeValue(zoneField ? rowData[zoneField] : "") || "Unspecified";
            const tags = normalizeValue(tagsField ? rowData[tagsField] : "") || "-";
            const phase = normalizeValue(phaseField ? rowData[phaseField] : "") || "Unspecified";
            const status = normalizeValue(statusField ? rowData[statusField] : "") || "-";
            const e2StatusUpdate = normalizeValue(e2StatusField ? rowData[e2StatusField] : "") || "Received";
            const e2LeadDetailer = normalizeValue(e2DetailerField ? rowData[e2DetailerField] : "") || "Unassigned";
            const technicalDetailsValue = normalizeValue(techDetailsField ? rowData[techDetailsField] : "");
            const snapshotUrl = normalizeValue(snapshotField ? rowData[snapshotField] : "");
            const markupLink = normalizeValue(markupLinkField ? rowData[markupLinkField] : "");
            const snapshotPreviewUrl = snapshotUrl || markupLink;
            const intelligenceTags = parseTags(rowData[intelligenceTagsField]);

            if (!issueId) {
              return;
            }

            nextIssues.push({
              key: `${projectDoc.id}-${issueId || rowIndex}`,
              issueId,
              title,
              project: fallbackProjectName,
              projectName,
              tags,
              zone,
              phase,
              status,
              e2StatusUpdate,
              e2StatusField: e2StatusField || E2_STATUS_UPDATE_FIELD,
              e2LeadDetailer,
              technicalDetailsValue,
              snapshotUrl,
              markupLink,
              snapshotPreviewUrl,
              intelligenceTags,
              hasTechnicalDetails: hasTechnicalDetails(technicalDetailsValue),
              projectDocId: projectDoc.id,
              rowIndex,
            });
          });
        });

        setIssues(nextIssues);
        setLoading(false);
      },
      (snapshotError) => {
        console.error("Failed to load intelligence data:", snapshotError);
        setError("Unable to load ticket intelligence data.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [id]);

  const technicalDetailsTickets = useMemo(
    () => issues.filter((issue) => issue.hasTechnicalDetails),
    [issues]
  );

  const remainderIssues = useMemo(() => {
    return issues
      .filter((issue) => !issue.hasTechnicalDetails)
      .sort((a, b) => {
        const aNum = Number.parseInt(a.issueId, 10);
        const bNum = Number.parseInt(b.issueId, 10);
        const aValid = Number.isFinite(aNum);
        const bValid = Number.isFinite(bNum);
        if (aValid && bValid) return bNum - aNum;
        return String(b.issueId).localeCompare(String(a.issueId));
      });
  }, [issues]);

  const handleAddRemainderTag = async (ticket, explicitTagValue = "") => {
    const nextTag = normalizeValue(explicitTagValue || tagInputs[ticket.key]);

    if (!nextTag) {
      toast.info("Type a tag first.");
      return;
    }

    const currentTags = parseTags(ticket.intelligenceTags || []);
    if (currentTags.some((tag) => tag.toLowerCase() === nextTag.toLowerCase())) {
      toast.info("Duplicate tag is not allowed for this issue.");
      return;
    }

    const saved = await persistRemainderTags(ticket, [...currentTags, nextTag]);
    if (saved) {
      setTagInputs((prev) => ({ ...prev, [ticket.key]: "" }));
      toast.success("Tag added.");
    }
  };

  const persistRemainderTags = async (ticket, nextTags) => {
    if (savingTagByIssueKey[ticket.key]) {
      return false;
    }

    const sanitizedNextTags = parseTags(nextTags);
    setSavingTagByIssueKey((prev) => ({ ...prev, [ticket.key]: true }));

    try {
      const projectRef = doc(db, "churches", id, "bimProjects", ticket.projectDocId);
      const projectSnap = await getDoc(projectRef);

      if (!projectSnap.exists()) {
        toast.error("Project source not found.");
        return false;
      }

      const projectData = projectSnap.data() || {};
      const previousRows = Array.isArray(projectData.rows) ? projectData.rows : [];
      const previousFields = Array.isArray(projectData.fields) ? projectData.fields : [];

      if (ticket.rowIndex < 0 || ticket.rowIndex >= previousRows.length) {
        toast.error("Could not locate the issue row to save tags.");
        return false;
      }

      const targetRow = previousRows[ticket.rowIndex] || {};
      const rowData = resolveRowData(targetRow);
      const hasNestedRowData = Boolean(targetRow?.rowData && typeof targetRow.rowData === "object");

      const tagField =
        findFieldByAliases(previousFields, rowData, INTELLIGENCE_TAGS_FIELD_ALIASES) || INTELLIGENCE_TAGS_FIELD;

      const updatedRows = [...previousRows];
      const nextTagValue = sanitizedNextTags.join(", ");
      updatedRows[ticket.rowIndex] = hasNestedRowData
        ? {
            ...targetRow,
            rowData: {
              ...rowData,
              [tagField]: nextTagValue,
            },
          }
        : {
            ...targetRow,
            [tagField]: nextTagValue,
          };

      const updatedFields = previousFields.includes(tagField) ? previousFields : [...previousFields, tagField];

      await updateDoc(projectRef, {
        rows: updatedRows,
        fields: updatedFields,
      });

      const verificationSnap = await getDoc(projectRef);
      const verificationRows = Array.isArray(verificationSnap.data()?.rows) ? verificationSnap.data().rows : [];
      const verificationRow = verificationRows[ticket.rowIndex] || {};
      const verificationRowData = resolveRowData(verificationRow);
      const persistedTags = parseTags(verificationRowData[tagField]);
      const persistedKey = persistedTags.map((tag) => tag.toLowerCase()).sort().join("|");
      const expectedKey = sanitizedNextTags.map((tag) => tag.toLowerCase()).sort().join("|");

      if (persistedKey !== expectedKey) {
        toast.error("Tag write did not persist to Firebase. Please check Firestore rules.");
        return false;
      }

      // Keep UI state in sync immediately so consecutive lightbox tag adds do not overwrite prior tags.
      setIssues((prevIssues) =>
        prevIssues.map((issue) =>
          issue.key === ticket.key
            ? {
                ...issue,
                intelligenceTags: sanitizedNextTags,
              }
            : issue
        )
      );

      return true;
    } catch (saveError) {
      console.error("Failed to save issue tags:", saveError);
      toast.error("Could not save tag changes.");
      return false;
    } finally {
      setSavingTagByIssueKey((prev) => ({ ...prev, [ticket.key]: false }));
    }
  };

  const handleRemoveRemainderTag = async (ticket, tagToRemove) => {
    const currentTags = parseTags(ticket.intelligenceTags || []);
    const nextTags = currentTags.filter((tag) => tag.toLowerCase() !== String(tagToRemove || "").toLowerCase());

    if (nextTags.length === currentTags.length) {
      return;
    }

    const saved = await persistRemainderTags(ticket, nextTags);
    if (saved) {
      toast.success("Tag removed.");
    }
  };

  const handleEditRemainderTag = async (ticket, originalTag) => {
    const proposedValue = window.prompt("Edit tag", originalTag);
    if (proposedValue === null) return;

    const nextValue = normalizeValue(proposedValue);
    if (!nextValue) {
      toast.info("Tag cannot be empty.");
      return;
    }

    const currentTags = parseTags(ticket.intelligenceTags || []);
    if (
      currentTags.some(
        (tag) => tag.toLowerCase() === nextValue.toLowerCase() && tag.toLowerCase() !== String(originalTag || "").toLowerCase()
      )
    ) {
      toast.info("Duplicate tag is not allowed for this issue.");
      return;
    }

    const nextTags = currentTags.map((tag) =>
      tag.toLowerCase() === String(originalTag || "").toLowerCase() ? nextValue : tag
    );

    const saved = await persistRemainderTags(ticket, nextTags);
    if (saved) {
      toast.success("Tag updated.");
    }
  };

  const persistRemainderStatus = async (ticket, nextStatusValue) => {
    const nextStatus = normalizeValue(nextStatusValue) || DEFAULT_E2_STATUS_UPDATE;

    if (savingStatusByIssueKey[ticket.key]) {
      return false;
    }

    setSavingStatusByIssueKey((prev) => ({ ...prev, [ticket.key]: true }));

    try {
      const projectRef = doc(db, "churches", id, "bimProjects", ticket.projectDocId);
      const projectSnap = await getDoc(projectRef);

      if (!projectSnap.exists()) {
        toast.error("Project source not found.");
        return false;
      }

      const projectData = projectSnap.data() || {};
      const previousRows = Array.isArray(projectData.rows) ? projectData.rows : [];
      const previousFields = Array.isArray(projectData.fields) ? projectData.fields : [];

      if (ticket.rowIndex < 0 || ticket.rowIndex >= previousRows.length) {
        toast.error("Could not locate the issue row to save E2 Status Update.");
        return false;
      }

      const targetRow = previousRows[ticket.rowIndex] || {};
      const rowData = resolveRowData(targetRow);
      const hasNestedRowData = Boolean(targetRow?.rowData && typeof targetRow.rowData === "object");

      const statusField =
        ticket.e2StatusField || findFieldByAliases(previousFields, rowData, E2_STATUS_UPDATE_FIELD_ALIASES) || E2_STATUS_UPDATE_FIELD;

      const updatedRows = [...previousRows];
      updatedRows[ticket.rowIndex] = hasNestedRowData
        ? {
            ...targetRow,
            rowData: {
              ...rowData,
              [statusField]: nextStatus,
            },
          }
        : {
            ...targetRow,
            [statusField]: nextStatus,
          };

      const updatedFields = previousFields.includes(statusField) ? previousFields : [...previousFields, statusField];

      await updateDoc(projectRef, {
        rows: updatedRows,
        fields: updatedFields,
      });

      return true;
    } catch (saveError) {
      console.error("Failed to save E2 status update:", saveError);
      toast.error("Could not save E2 Status Update.");
      return false;
    } finally {
      setSavingStatusByIssueKey((prev) => ({ ...prev, [ticket.key]: false }));
    }
  };

  const handleSelectRemainderStatus = async (ticket, nextStatus) => {
    if (normalizeValue(ticket.e2StatusUpdate) === normalizeValue(nextStatus)) {
      return;
    }

    const saved = await persistRemainderStatus(ticket, nextStatus);
    if (saved) {
      toast.success("E2 Status Update saved.");
    }
  };

  const remainderTotalsByStatus = useMemo(() => {
    const totals = {};

    issues.forEach((issue) => {
      if (issue.hasTechnicalDetails) return;
      const status = normalizeValue(issue.e2StatusUpdate) || "Received";
      totals[status] = (totals[status] || 0) + 1;
    });

    return Object.entries(totals)
      .map(([status, total]) => ({ status, total }))
      .sort((a, b) => b.total - a.total);
  }, [issues]);

  const highlightedTicketCount = useMemo(() => {
    if (!selectedIssueId) return 0;
    const normalizedSelected = normalizeIssueIdDisplay(selectedIssueId).toLowerCase();
    return issues.filter((issue) => normalizeIssueIdDisplay(issue.issueId).toLowerCase() === normalizedSelected).length;
  }, [issues, selectedIssueId]);

  const getProjectNameDisplay = useCallback(
    (ticket) => {
      const normalizedTag = normalizeValue(ticket?.tags).toLowerCase();
      const normalizedZone = normalizeValue(ticket?.zone).toLowerCase();
      return (
        (normalizedTag && tagAliasByLowerKey[normalizedTag]) ||
        (normalizedZone && tagAliasByLowerKey[normalizedZone]) ||
        normalizeValue(ticket?.projectName) ||
        normalizeValue(ticket?.project) ||
        "-"
      );
    },
    [tagAliasByLowerKey]
  );

  const remainderTicketTotal = useMemo(
    () => remainderTotalsByStatus.reduce((sum, item) => sum + item.total, 0),
    [remainderTotalsByStatus]
  );

  const remainderTagTotals = useMemo(() => {
    const tagCountByKey = new Map();
    const tagLabelByKey = new Map();

    remainderIssues.forEach((ticket) => {
      const parsedTags = parseTags(ticket.intelligenceTags || []);

      if (parsedTags.length === 0) {
        const unassignedKey = "__unassigned__";
        tagLabelByKey.set(unassignedKey, UNASSIGNED_TAG_LABEL);
        tagCountByKey.set(unassignedKey, (tagCountByKey.get(unassignedKey) || 0) + 1);
        return;
      }

      parsedTags.forEach((tag) => {
        const key = tag.toLowerCase();
        tagLabelByKey.set(key, tagLabelByKey.get(key) || tag);
        tagCountByKey.set(key, (tagCountByKey.get(key) || 0) + 1);
      });
    });

    return Array.from(tagCountByKey.entries())
      .map(([key, total]) => ({ tag: tagLabelByKey.get(key) || key, total }))
      .sort((a, b) => b.total - a.total || a.tag.localeCompare(b.tag));
  }, [remainderIssues]);

  const statusFilteredRemainderIssues = useMemo(
    () =>
      remainderIssues.filter((ticket) => {
        const status = normalizeValue(ticket.status) || "-";
        return excludedStatuses[status] !== true;
      }),
    [excludedStatuses, remainderIssues]
  );

  const projectFilteredRemainderIssues = useMemo(
    () =>
      statusFilteredRemainderIssues.filter((ticket) => {
        const projectName = normalizeValue(getProjectNameDisplay(ticket)) || "Unknown Project";
        return excludedProjects[projectName] !== true;
      }),
    [excludedProjects, getProjectNameDisplay, statusFilteredRemainderIssues]
  );

  const tagFilteredRemainderIssues = useMemo(() => {
    if (selectedTagFilter === ALL_TAGS_FILTER) {
      return projectFilteredRemainderIssues;
    }

    return projectFilteredRemainderIssues.filter((ticket) => {
      const tags = parseTags(ticket.intelligenceTags || []);
      if (selectedTagFilter === UNASSIGNED_TAG_LABEL) {
        return tags.length === 0;
      }
      return tags.some((tag) => tag.toLowerCase() === selectedTagFilter.toLowerCase());
    });
  }, [projectFilteredRemainderIssues, selectedTagFilter]);

  const filteredRemainderIssues = useMemo(() => {
    const query = normalizeValue(remainderSearch).toLowerCase();
    const zoneFilter = normalizeValue(selectedZone).toLowerCase();
    const phaseFilter = normalizeValue(selectedPhase).toLowerCase();

    const byFacets = tagFilteredRemainderIssues.filter((ticket) => {
      const zoneValue = normalizeValue(ticket.zone).toLowerCase() || "unspecified";
      const phaseValue = normalizeValue(ticket.phase).toLowerCase() || "unspecified";
      const zoneMatch = zoneFilter === "all" || zoneValue === zoneFilter;
      const phaseMatch = phaseFilter === "all" || phaseValue === phaseFilter;
      return zoneMatch && phaseMatch;
    });

    if (!query) return byFacets;

    return byFacets.filter((ticket) => {
      const issueIdRaw = normalizeValue(ticket.issueId).toLowerCase();
      const issueIdDisplay = normalizeIssueIdDisplay(ticket.issueId).toLowerCase();
      const statusValue = normalizeValue(ticket.status).toLowerCase();
      const status = normalizeValue(ticket.e2StatusUpdate).toLowerCase();
      const project = normalizeValue(getProjectNameDisplay(ticket)).toLowerCase();
      const zone = normalizeValue(ticket.zone).toLowerCase();
      const phase = normalizeValue(ticket.phase).toLowerCase();
      return (
        issueIdRaw.includes(query) ||
        issueIdDisplay.includes(query) ||
        statusValue.includes(query) ||
        status.includes(query) ||
        project.includes(query) ||
        zone.includes(query) ||
        phase.includes(query)
      );
    });
  }, [getProjectNameDisplay, tagFilteredRemainderIssues, remainderSearch, selectedZone, selectedPhase]);

  const availableZones = useMemo(() => {
    const zoneSet = new Set(remainderIssues.map((ticket) => normalizeValue(ticket.zone) || "Unspecified"));
    return Array.from(zoneSet).sort((a, b) => a.localeCompare(b));
  }, [remainderIssues]);

  const availablePhases = useMemo(() => {
    const phaseSet = new Set(remainderIssues.map((ticket) => normalizeValue(ticket.phase) || "Unspecified"));
    return Array.from(phaseSet).sort((a, b) => a.localeCompare(b));
  }, [remainderIssues]);

  const availableStatuses = useMemo(() => {
    const statusSet = new Set(remainderIssues.map((ticket) => normalizeValue(ticket.status) || "-"));
    return Array.from(statusSet).sort((a, b) => a.localeCompare(b));
  }, [remainderIssues]);

  const availableProjects = useMemo(() => {
    const projectSet = new Set(
      remainderIssues.map((ticket) => normalizeValue(getProjectNameDisplay(ticket)) || "Unknown Project")
    );
    return Array.from(projectSet).sort((a, b) => a.localeCompare(b));
  }, [getProjectNameDisplay, remainderIssues]);

  useEffect(() => {
    setExcludedStatuses((prev) => {
      const next = {};
      availableStatuses.forEach((status) => {
        if (prev[status]) {
          next[status] = true;
        }
      });
      return next;
    });
  }, [availableStatuses]);

  useEffect(() => {
    setExcludedProjects((prev) => {
      const next = {};
      availableProjects.forEach((project) => {
        if (prev[project]) {
          next[project] = true;
        }
      });
      return next;
    });
  }, [availableProjects]);

  const graphZones = useMemo(() => {
    const zoneSet = new Set(projectFilteredRemainderIssues.map((ticket) => normalizeValue(ticket.zone) || "Unspecified"));
    return Array.from(zoneSet).sort((a, b) => a.localeCompare(b));
  }, [projectFilteredRemainderIssues]);

  useEffect(() => {
    setEnabledGraphZones((prev) => {
      const next = {};
      graphZones.forEach((zone) => {
        next[zone] = Object.prototype.hasOwnProperty.call(prev, zone) ? prev[zone] : true;
      });
      return next;
    });
  }, [graphZones]);

  const graphVisibleIssues = useMemo(() => {
    if (graphGroupBy !== "zone") {
      return tagFilteredRemainderIssues;
    }

    return tagFilteredRemainderIssues.filter((ticket) => {
      const zone = normalizeValue(ticket.zone) || "Unspecified";
      return enabledGraphZones[zone] !== false;
    });
  }, [enabledGraphZones, tagFilteredRemainderIssues, graphGroupBy]);

  const graphTotals = useMemo(() => {
    const totals = new Map();

    if (graphGroupBy === "zone") {
      graphVisibleIssues.forEach((ticket) => {
        const zone = normalizeValue(ticket.zone) || "Unspecified";
        totals.set(zone, (totals.get(zone) || 0) + 1);
      });
    } else {
      graphVisibleIssues.forEach((ticket) => {
        const tags = parseTags(ticket.intelligenceTags || []);
        if (!tags.length) {
          totals.set(UNASSIGNED_TAG_LABEL, (totals.get(UNASSIGNED_TAG_LABEL) || 0) + 1);
          return;
        }

        tags.forEach((tag) => {
          totals.set(tag, (totals.get(tag) || 0) + 1);
        });
      });
    }

    return Array.from(totals.entries())
      .map(([label, total]) => ({ label, total }))
      .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  }, [graphGroupBy, graphVisibleIssues]);

  const graphMaxTotal = useMemo(
    () => graphTotals.reduce((max, item) => Math.max(max, item.total), 0),
    [graphTotals]
  );

  const graphTotalSum = useMemo(
    () => graphTotals.reduce((sum, item) => sum + item.total, 0),
    [graphTotals]
  );

  const graphPieBackground = useMemo(() => {
    if (!graphTotalSum) {
      return "conic-gradient(#e5e7eb 0% 100%)";
    }

    let cursor = 0;
    const segments = graphTotals.map((item, index) => {
      const percent = (item.total / graphTotalSum) * 100;
      const start = cursor;
      const end = cursor + percent;
      cursor = end;
      return `${GRAPH_COLORS[index % GRAPH_COLORS.length]} ${start}% ${end}%`;
    });

    return `conic-gradient(${segments.join(", ")})`;
  }, [graphTotalSum, graphTotals]);

  const toggleGraphZone = (zone) => {
    setEnabledGraphZones((prev) => ({
      ...prev,
      [zone]: !(prev[zone] !== false),
    }));
  };

  const includedStatusCount = useMemo(
    () => availableStatuses.filter((statusValue) => excludedStatuses[statusValue] !== true).length,
    [availableStatuses, excludedStatuses]
  );

  const includedProjectCount = useMemo(
    () => availableProjects.filter((projectValue) => excludedProjects[projectValue] !== true).length,
    [availableProjects, excludedProjects]
  );

  const toggleExcludedStatus = (statusValue) => {
    setExcludedStatuses((prev) => {
      const isCurrentlyExcluded = prev[statusValue] === true;
      const currentlyIncludedCount = availableStatuses.filter((status) => prev[status] !== true).length;

      if (!isCurrentlyExcluded && currentlyIncludedCount <= 1) {
        toast.info("At least one status must remain included.");
        return prev;
      }

      return {
        ...prev,
        [statusValue]: !isCurrentlyExcluded,
      };
    });
  };

  const toggleExcludedProject = (projectValue) => {
    setExcludedProjects((prev) => {
      const isCurrentlyExcluded = prev[projectValue] === true;
      const currentlyIncludedCount = availableProjects.filter((project) => prev[project] !== true).length;

      if (!isCurrentlyExcluded && currentlyIncludedCount <= 1) {
        toast.info("At least one project must remain included.");
        return prev;
      }

      return {
        ...prev,
        [projectValue]: !isCurrentlyExcluded,
      };
    });
  };

  const visibleRemainderTotalsByStatus = useMemo(() => {
    const totals = {};

    projectFilteredRemainderIssues.forEach((issue) => {
      const status = normalizeValue(issue.e2StatusUpdate) || "Received";
      totals[status] = (totals[status] || 0) + 1;
    });

    return Object.entries(totals)
      .map(([status, total]) => ({ status, total }))
      .sort((a, b) => b.total - a.total);
  }, [projectFilteredRemainderIssues]);

  const visibleRemainderTagTotals = useMemo(() => {
    const tagCountByKey = new Map();
    const tagLabelByKey = new Map();

    projectFilteredRemainderIssues.forEach((ticket) => {
      const parsedTags = parseTags(ticket.intelligenceTags || []);

      if (parsedTags.length === 0) {
        const unassignedKey = "__unassigned__";
        tagLabelByKey.set(unassignedKey, UNASSIGNED_TAG_LABEL);
        tagCountByKey.set(unassignedKey, (tagCountByKey.get(unassignedKey) || 0) + 1);
        return;
      }

      parsedTags.forEach((tag) => {
        const key = tag.toLowerCase();
        tagLabelByKey.set(key, tagLabelByKey.get(key) || tag);
        tagCountByKey.set(key, (tagCountByKey.get(key) || 0) + 1);
      });
    });

    return Array.from(tagCountByKey.entries())
      .map(([key, total]) => ({ tag: tagLabelByKey.get(key) || key, total }))
      .sort((a, b) => b.total - a.total || a.tag.localeCompare(b.tag));
  }, [projectFilteredRemainderIssues]);

  const visibleRemainderTicketTotal = useMemo(
    () => visibleRemainderTotalsByStatus.reduce((sum, item) => sum + item.total, 0),
    [visibleRemainderTotalsByStatus]
  );

  const availableE2StatusOptions = useMemo(() => {
    const combined = [
      ...DEFAULT_E2_STATUS_UPDATE_OPTIONS,
      ...(Array.isArray(statusOptions) ? statusOptions : []),
      ...issues.map((issue) => normalizeValue(issue.e2StatusUpdate)).filter(Boolean),
    ];

    return Array.from(new Set(combined.map((value) => normalizeValue(value)).filter(Boolean)));
  }, [issues, statusOptions]);

  const allKnownTags = useMemo(() => {
    const seen = new Set();
    const tags = [];

    issues.forEach((issue) => {
      parseTags(issue.intelligenceTags || []).forEach((tag) => {
        const key = tag.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        tags.push(tag);
      });
    });

    return tags.sort((a, b) => a.localeCompare(b));
  }, [issues]);

  const geminiTagLearningContext = useMemo(() => {
    const globalTagCounts = new Map();
    const zoneTagCounts = new Map();
    const projectTagCounts = new Map();

    const incrementTagCount = (targetMap, tag) => {
      targetMap.set(tag, (targetMap.get(tag) || 0) + 1);
    };

    issues.forEach((issue) => {
      const issueTags = parseTags(issue.intelligenceTags || []);
      if (!issueTags.length) return;

      const zone = normalizeValue(issue.zone) || "Unspecified";
      const project = normalizeValue(getProjectNameDisplay(issue)) || "Unknown Project";

      if (!zoneTagCounts.has(zone)) zoneTagCounts.set(zone, new Map());
      if (!projectTagCounts.has(project)) projectTagCounts.set(project, new Map());

      issueTags.forEach((tag) => {
        incrementTagCount(globalTagCounts, tag);
        incrementTagCount(zoneTagCounts.get(zone), tag);
        incrementTagCount(projectTagCounts.get(project), tag);
      });
    });

    const sortTagCounts = (tagMap, limit = 12) =>
      Array.from(tagMap.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([tag, count]) => ({ tag, count }));

    const toTopBuckets = (bucketMap, bucketLimit = 8, tagLimit = 6) =>
      Array.from(bucketMap.entries())
        .map(([name, tagMap]) => ({
          name,
          totalTaggedIssues: Array.from(tagMap.values()).reduce((sum, value) => sum + value, 0),
          topTags: sortTagCounts(tagMap, tagLimit),
        }))
        .sort((a, b) => b.totalTaggedIssues - a.totalTaggedIssues || a.name.localeCompare(b.name))
        .slice(0, bucketLimit)
        .map(({ name, topTags }) => ({ name, topTags }));

    return {
      topTagsOverall: sortTagCounts(globalTagCounts, 20),
      topTagsByZone: toTopBuckets(zoneTagCounts),
      topTagsByProject: toTopBuckets(projectTagCounts),
    };
  }, [getProjectNameDisplay, issues]);

  const getTagSuggestionsForTicket = (ticket) => {
    const query = normalizeValue(tagInputs[ticket.key]).toLowerCase();
    if (!query) return [];

    const existing = new Set(parseTags(ticket.intelligenceTags || []).map((tag) => tag.toLowerCase()));

    return allKnownTags
      .filter((tag) => {
        const normalizedTag = tag.toLowerCase();
        return normalizedTag.includes(query) && !existing.has(normalizedTag);
      })
      .slice(0, 8);
  };

  const lightboxTicket = useMemo(
    () => issues.find((ticket) => ticket.key === lightboxTicketKey) || null,
    [issues, lightboxTicketKey]
  );

  const isLightboxTagSaving = Boolean(lightboxTicket && savingTagByIssueKey[lightboxTicket.key]);

  const handleOpenLightbox = (ticket) => {
    // Always open the exact thumbnail the user clicked.
    setLightboxTicketKey(ticket.key);

    setLightboxTagInput("");
    setLightboxZoom(1);
    setLightboxAiError("");
    setLightboxAiTags([]);
    setLightboxAiObjects([]);
  };

  const handleCloseLightbox = () => {
    setLightboxTicketKey("");
    setLightboxTagInput("");
    setLightboxZoom(1);
    setIsLightboxAiLoading(false);
    setLightboxAiError("");
    setLightboxAiTags([]);
    setLightboxAiObjects([]);
  };

  const handleSuggestLightboxTagsWithGemini = async () => {
    if (!lightboxTicket) return;

    const imageUrl = normalizeValue(lightboxTicket.snapshotPreviewUrl);
    if (!imageUrl) {
      toast.info("This issue has no snapshot to analyze.");
      return;
    }

    setIsLightboxAiLoading(true);
    setLightboxAiError("");

    try {
      const response = await fetch(`${FIREBASE_FUNCTIONS_BASE_URL}/suggestIssueTagsVision`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageUrl,
          issueId: lightboxTicket.issueId,
          projectName: getProjectNameDisplay(lightboxTicket),
          existingTags: parseTags(lightboxTicket.intelligenceTags || []),
          tagLearningContext: geminiTagLearningContext,
        }),
      });

      const responseContentType = String(response.headers.get("content-type") || "").toLowerCase();
      const rawBody = await response.text();
      let payload = {};

      if (responseContentType.includes("application/json")) {
        try {
          payload = rawBody ? JSON.parse(rawBody) : {};
        } catch (jsonParseError) {
          throw new Error("Gemini endpoint returned invalid JSON.");
        }
      } else {
        const htmlLikeBody = rawBody.trim().startsWith("<");
        if (htmlLikeBody) {
          throw new Error("Gemini endpoint returned HTML. Deploy the function and verify the endpoint URL.");
        }
        payload = {};
      }

      if (!response.ok) {
        throw new Error(normalizeValue(payload?.error || payload?.message) || "Gemini request failed");
      }

      const existingTagSet = new Set(parseTags(lightboxTicket.intelligenceTags || []).map((tag) => tag.toLowerCase()));
      const suggestedTags = parseTags(payload?.suggestedTags || []).filter((tag) => !existingTagSet.has(tag.toLowerCase()));
      const detectedObjects = parseTags(payload?.objects || []);

      setLightboxAiTags(suggestedTags);
      setLightboxAiObjects(detectedObjects);

      if (!suggestedTags.length && !detectedObjects.length) {
        toast.info("Gemini did not return suggestions for this image.");
      }
    } catch (requestError) {
      console.error("Gemini tag suggestion failed:", requestError);
      const message = normalizeValue(requestError?.message) || "Could not get Gemini suggestions right now.";
      setLightboxAiError(message);
      toast.error(message);
    } finally {
      setIsLightboxAiLoading(false);
    }
  };

  const handleAddLightboxTag = async (explicitTagValue = "") => {
    if (!lightboxTicket) return;

    const nextTag = normalizeValue(explicitTagValue || lightboxTagInput);
    if (!nextTag) {
      toast.info("Type a tag first.");
      return;
    }

    const currentTags = parseTags(lightboxTicket.intelligenceTags || []);
    if (currentTags.some((tag) => tag.toLowerCase() === nextTag.toLowerCase())) {
      toast.info("Duplicate tag is not allowed for this issue.");
      return;
    }

    const saved = await persistRemainderTags(lightboxTicket, [...currentTags, nextTag]);
    if (saved) {
      setLightboxTagInput("");
      toast.success("Tag added.");
    }
  };

  const handleRemoveLightboxTag = async (tagToRemove) => {
    if (!lightboxTicket) return;

    const currentTags = parseTags(lightboxTicket.intelligenceTags || []);
    const nextTags = currentTags.filter((tag) => tag.toLowerCase() !== String(tagToRemove || "").toLowerCase());

    if (nextTags.length === currentTags.length) {
      return;
    }

    const saved = await persistRemainderTags(lightboxTicket, nextTags);
    if (saved) {
      toast.success("Tag removed.");
    }
  };

  const lightboxNavigationTickets = useMemo(
    () => projectFilteredRemainderIssues.filter((ticket) => normalizeValue(ticket.snapshotPreviewUrl)),
    [projectFilteredRemainderIssues]
  );

  const lightboxTicketIndex = useMemo(() => {
    if (!lightboxTicket) return -1;
    return lightboxNavigationTickets.findIndex((ticket) => ticket.key === lightboxTicket.key);
  }, [lightboxNavigationTickets, lightboxTicket]);

  const nextUntaggedLightboxTicket = useMemo(() => {
    if (lightboxTicketIndex < 0) return null;
    return lightboxNavigationTickets
      .slice(lightboxTicketIndex + 1)
      .find((ticket) => parseTags(ticket.intelligenceTags || []).length === 0) || null;
  }, [lightboxNavigationTickets, lightboxTicketIndex]);

  const nextAnyLightboxTicket = useMemo(() => {
    if (lightboxTicketIndex < 0) return null;
    return lightboxNavigationTickets[lightboxTicketIndex + 1] || null;
  }, [lightboxNavigationTickets, lightboxTicketIndex]);

  const previousUntaggedLightboxTicket = useMemo(() => {
    if (lightboxTicketIndex < 0) return null;
    return [...lightboxNavigationTickets]
      .slice(0, lightboxTicketIndex)
      .reverse()
      .find((ticket) => parseTags(ticket.intelligenceTags || []).length === 0) || null;
  }, [lightboxNavigationTickets, lightboxTicketIndex]);

  const previousAnyLightboxTicket = useMemo(() => {
    if (lightboxTicketIndex <= 0) return null;
    return lightboxNavigationTickets[lightboxTicketIndex - 1] || null;
  }, [lightboxNavigationTickets, lightboxTicketIndex]);

  const canGoPrevLightbox = Boolean(previousUntaggedLightboxTicket || previousAnyLightboxTicket);
  const canGoNextLightbox = Boolean(nextUntaggedLightboxTicket || nextAnyLightboxTicket);

  const goPrevLightbox = () => {
    if (!canGoPrevLightbox) return;

    const targetTicket = previousUntaggedLightboxTicket || previousAnyLightboxTicket;

    if (!targetTicket) {
      toast.info("No previous untagged snapshot.");
      return;
    }

    setLightboxTicketKey(targetTicket.key);
    setLightboxTagInput("");
    setLightboxZoom(1);
  };

  const goNextLightbox = () => {
    if (!canGoNextLightbox) return;

    const targetTicket = nextUntaggedLightboxTicket || nextAnyLightboxTicket;

    if (!targetTicket) {
      toast.info("No next untagged snapshot.");
      return;
    }

    setLightboxTicketKey(targetTicket.key);
    setLightboxTagInput("");
    setLightboxZoom(1);
  };

  const increaseLightboxZoom = () => {
    setLightboxZoom((prev) => Math.min(3, Number((prev + 0.25).toFixed(2))));
  };

  const decreaseLightboxZoom = () => {
    setLightboxZoom((prev) => Math.max(1, Number((prev - 0.25).toFixed(2))));
  };

  const resetLightboxZoom = () => {
    setLightboxZoom(1);
  };

  const lightboxTagSuggestions = useMemo(() => {
    if (!lightboxTicket) return [];

    const query = normalizeValue(lightboxTagInput).toLowerCase();
    const existing = new Set(parseTags(lightboxTicket.intelligenceTags || []).map((tag) => tag.toLowerCase()));
    if (!query) return [];

    return allKnownTags
      .filter((tag) => {
        const normalizedTag = tag.toLowerCase();
        return normalizedTag.includes(query) && !existing.has(normalizedTag);
      })
      .slice(0, 8);
  }, [allKnownTags, lightboxTagInput, lightboxTicket]);

  const latestImportRecord = useMemo(() => importHistoryRows[0] || null, [importHistoryRows]);

  const latestImportTransitions = useMemo(() => {
    if (!latestImportRecord) return [];

    return (Array.isArray(latestImportRecord.statusTransitions) ? latestImportRecord.statusTransitions : [])
      .map((transition) => ({
        from: normalizeValue(transition?.from) || "-",
        to: normalizeValue(transition?.to) || "-",
        count: Number(transition?.count) || 0,
      }))
      .filter((transition) => transition.count > 0)
      .sort((a, b) => b.count - a.count || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  }, [latestImportRecord]);

  return (
    <div
      style={{
        ...commonStyles.fullWidthContainer,
        width: "100vw",
        maxWidth: "100vw",
        marginLeft: "calc(50% - 50vw)",
        marginRight: "calc(50% - 50vw)",
        boxSizing: "border-box",
      }}
    >
      <Link to={`/organization/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to My Organization
      </Link>

      <ChurchHeader id={id} applyShadow={false} allowEditBannerLogo={true} />

      <div style={{ marginTop: "-30px", width: "100%" }}>
        <h1 style={commonStyles.title}>Intelligence</h1>
        <p style={{ color: "#4b5563", marginTop: "8px", marginBottom: "18px" }}>
          Tickets grouped by E2 Status Update in real time.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "12px",
            marginBottom: "20px",
          }}
        >
          <div style={{ border: "1px solid #e5e7eb", borderRadius: "10px", padding: "12px", background: "#fff" }}>
            <div style={{ color: "#6b7280", fontSize: "13px" }}>Total Tickets</div>
            <div style={{ fontSize: "28px", fontWeight: 700, color: "#111827" }}>{issues.length}</div>
          </div>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: "10px", padding: "12px", background: "#fff" }}>
            <div style={{ color: "#6b7280", fontSize: "13px" }}>Technical Details Tickets</div>
            <div style={{ fontSize: "28px", fontWeight: 700, color: "#111827" }}>{technicalDetailsTickets.length}</div>
          </div>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: "10px", padding: "12px", background: "#fff" }}>
            <div style={{ color: "#6b7280", fontSize: "13px" }}>Remainder Tickets</div>
            <div style={{ fontSize: "28px", fontWeight: 700, color: "#111827" }}>{remainderTicketTotal}</div>
          </div>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: "10px", padding: "12px", background: "#fff" }}>
            <div style={{ color: "#6b7280", fontSize: "13px" }}>Highlighted Issue</div>
            <div style={{ fontSize: "18px", fontWeight: 700, color: "#111827" }}>
              {selectedIssueId || "None"}
            </div>
            {selectedIssueId ? (
              <div style={{ marginTop: "4px", color: highlightedTicketCount ? "#047857" : "#b91c1c", fontSize: "12px" }}>
                {highlightedTicketCount ? `${highlightedTicketCount} match(es)` : "No matches found"}
              </div>
            ) : null}
          </div>
        </div>

        {!loading && !error && (
          <section
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: "10px",
              background: "#fff",
              padding: "14px",
              marginBottom: "14px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
              <h2 style={{ margin: 0, fontSize: "19px", color: "#111827" }}>Daily Import Changes</h2>
              <Link
                to={`/organization/${id}/project-issue-dashboard`}
                style={{ color: "#1d4ed8", fontSize: "12px", fontWeight: 700, textDecoration: "none" }}
              >
                Open Dashboard Upload
              </Link>
            </div>

            {importHistoryLoading ? <div style={{ color: "#6b7280" }}>Loading import changes...</div> : null}
            {!importHistoryLoading && importHistoryError ? <div style={{ color: "#b91c1c" }}>{importHistoryError}</div> : null}

            {!importHistoryLoading && !importHistoryError && !latestImportRecord ? (
              <div style={{ color: "#6b7280" }}>No import history yet. Upload a Daily Issues file to start tracking changes.</div>
            ) : null}

            {!importHistoryLoading && !importHistoryError && latestImportRecord ? (
              <>
                <div style={{ color: "#6b7280", fontSize: "12px", marginBottom: "8px" }}>
                  Latest import: {formatDateTime(latestImportRecord.createdAt)} · File: {normalizeValue(latestImportRecord.fileName) || "-"}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                    gap: "8px",
                    marginBottom: "10px",
                  }}
                >
                  <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "8px", background: "#f8fafc" }}>
                    <div style={{ color: "#6b7280", fontSize: "11px" }}>New Issues</div>
                    <div style={{ color: "#111827", fontSize: "20px", fontWeight: 700 }}>{Number(latestImportRecord.insertedRowsCount) || 0}</div>
                  </div>
                  <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "8px", background: "#f8fafc" }}>
                    <div style={{ color: "#6b7280", fontSize: "11px" }}>Updated Issues</div>
                    <div style={{ color: "#111827", fontSize: "20px", fontWeight: 700 }}>{Number(latestImportRecord.updatedRowsCount) || 0}</div>
                  </div>
                  <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "8px", background: "#f8fafc" }}>
                    <div style={{ color: "#6b7280", fontSize: "11px" }}>Status Moves</div>
                    <div style={{ color: "#111827", fontSize: "20px", fontWeight: 700 }}>{Number(latestImportRecord.statusMovedTotal) || 0}</div>
                  </div>
                  <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "8px", background: "#f8fafc" }}>
                    <div style={{ color: "#6b7280", fontSize: "11px" }}>Changed Cells</div>
                    <div style={{ color: "#111827", fontSize: "20px", fontWeight: 700 }}>{Number(latestImportRecord.changedCells) || 0}</div>
                  </div>
                </div>

                {latestImportTransitions.length > 0 ? (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", minWidth: "520px", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                          <th style={{ textAlign: "left", padding: "8px", fontSize: "12px", color: "#6b7280" }}>From Status</th>
                          <th style={{ textAlign: "left", padding: "8px", fontSize: "12px", color: "#6b7280" }}>To Status</th>
                          <th style={{ textAlign: "right", padding: "8px", fontSize: "12px", color: "#6b7280" }}>Count</th>
                        </tr>
                      </thead>
                      <tbody>
                        {latestImportTransitions.map((transition, index) => (
                          <tr
                            key={`${transition.from}-${transition.to}-${index}`}
                            style={{ borderBottom: "1px solid #f1f5f9", background: index % 2 === 0 ? "#ffffff" : "#f8fafc" }}
                          >
                            <td style={{ padding: "8px", color: "#111827" }}>{transition.from}</td>
                            <td style={{ padding: "8px", color: "#111827" }}>{transition.to}</td>
                            <td style={{ padding: "8px", color: "#111827", textAlign: "right", fontWeight: 700 }}>{transition.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ color: "#6b7280" }}>No status transitions detected in the latest import.</div>
                )}
              </>
            ) : null}
          </section>
        )}

        {loading && <div style={{ color: "#6b7280" }}>Loading intelligence data...</div>}
        {error && !loading && <div style={{ color: "#b91c1c" }}>{error}</div>}

        {!loading && !error && issues.length === 0 && (
          <div style={{ color: "#6b7280" }}>No tickets were found in BIM projects for this organization.</div>
        )}

        {!loading && !error && (
          <section
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: "10px",
              background: "#fff",
              padding: "14px",
              marginBottom: "14px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "10px",
                marginBottom: "10px",
              }}
            >
              <h2 style={{ margin: 0, fontSize: "19px", color: "#111827" }}>Technical Details Tickets</h2>
              <span
                style={{
                  background: "#ecfeff",
                  color: "#0f766e",
                  borderRadius: "9999px",
                  padding: "2px 10px",
                  fontSize: "12px",
                  fontWeight: 700,
                }}
              >
                {technicalDetailsTickets.length} ticket(s)
              </span>
            </div>

            {technicalDetailsTickets.length === 0 ? (
              <div style={{ color: "#6b7280" }}>No technical-details tickets found.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                      <th style={{ textAlign: "left", padding: "8px", fontSize: "12px", color: "#6b7280" }}>Issue ID</th>
                      <th style={{ textAlign: "left", padding: "8px", fontSize: "12px", color: "#6b7280" }}>Title</th>
                      <th style={{ textAlign: "left", padding: "8px", fontSize: "12px", color: "#6b7280" }}>Project</th>
                      <th style={{ textAlign: "left", padding: "8px", fontSize: "12px", color: "#6b7280" }}>E2 Status Update</th>
                      <th style={{ textAlign: "left", padding: "8px", fontSize: "12px", color: "#6b7280" }}>E2 Lead Detailer</th>
                      <th style={{ textAlign: "left", padding: "8px", fontSize: "12px", color: "#6b7280" }}>Technical Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {technicalDetailsTickets.map((ticket, index) => {
                      const isHighlighted =
                        selectedIssueId &&
                        normalizeIssueIdDisplay(ticket.issueId).toLowerCase() === normalizeIssueIdDisplay(selectedIssueId).toLowerCase();
                      return (
                        <tr
                          key={ticket.key}
                          style={{
                            borderBottom: "1px solid #e5e7eb",
                            background: isHighlighted ? "#fffbeb" : index % 2 === 0 ? "#ffffff" : "#f8fafc",
                          }}
                        >
                          <td style={{ padding: "8px", fontWeight: 600, color: "#111827" }}>{normalizeIssueIdDisplay(ticket.issueId)}</td>
                          <td style={{ padding: "8px", color: "#111827" }}>{ticket.title}</td>
                          <td style={{ padding: "8px", color: "#374151" }}>{getProjectNameDisplay(ticket)}</td>
                          <td style={{ padding: "8px", color: "#374151" }}>{ticket.e2StatusUpdate}</td>
                          <td style={{ padding: "8px", color: "#374151" }}>{ticket.e2LeadDetailer}</td>
                          <td style={{ padding: "8px", color: "#374151" }}>{ticket.technicalDetailsValue}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {!loading && !error && (
          <section
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: "10px",
              background: "#fff",
              padding: "14px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "10px",
                marginBottom: "10px",
              }}
            >
              <h2 style={{ margin: 0, fontSize: "19px", color: "#111827" }}>Remainder Ticket Totals</h2>
              <span
                style={{
                  background: "#eff6ff",
                  color: "#1e40af",
                  borderRadius: "9999px",
                  padding: "2px 10px",
                  fontSize: "12px",
                  fontWeight: 700,
                }}
              >
                  {visibleRemainderTicketTotal} total
              </span>
            </div>

            {visibleRemainderTotalsByStatus.length === 0 ? (
              <div style={{ color: "#6b7280" }}>No remainder tickets found.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                      <th style={{ textAlign: "left", padding: "8px", fontSize: "12px", color: "#6b7280" }}>E2 Status Update</th>
                      <th style={{ textAlign: "left", padding: "8px", fontSize: "12px", color: "#6b7280" }}>Total Tickets</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRemainderTotalsByStatus.map((row, index) => (
                      <tr
                        key={row.status}
                        style={{
                          borderBottom: "1px solid #e5e7eb",
                          background: index % 2 === 0 ? "#ffffff" : "#f8fafc",
                        }}
                      >
                        <td style={{ padding: "8px", color: "#111827", fontWeight: 600 }}>{row.status}</td>
                        <td style={{ padding: "8px", color: "#374151" }}>{row.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {!loading && !error && (
          <section
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: "10px",
              background: "#fff",
              padding: "14px",
              marginTop: "14px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "10px",
                marginBottom: "10px",
              }}
            >
              <h2 style={{ margin: 0, fontSize: "19px", color: "#111827" }}>Remainder Issue IDs</h2>
              <span
                style={{
                  background: "#f8fafc",
                  color: "#334155",
                  borderRadius: "9999px",
                  padding: "2px 10px",
                  fontSize: "12px",
                  fontWeight: 700,
                }}
              >
                {filteredRemainderIssues.length} issue ID(s)
              </span>
            </div>

            {projectFilteredRemainderIssues.length === 0 ? (
              <div style={{ color: "#6b7280" }}>No remainder issue IDs found.</div>
            ) : (
              <>
                <div style={{ marginBottom: "12px", textAlign: "left" }}>
                  <div style={{ marginBottom: "10px", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "10px", background: "#fcfcfd" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginBottom: "8px", flexWrap: "wrap" }}>
                      <div style={{ fontSize: "13px", color: "#374151", fontWeight: 700 }}>Remainder Graph</div>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          type="button"
                          onClick={() => setGraphGroupBy("tag")}
                          style={{
                            border: "1px solid #cbd5e1",
                            background: graphGroupBy === "tag" ? "#dbeafe" : "#fff",
                            color: graphGroupBy === "tag" ? "#1e3a8a" : "#475569",
                            borderRadius: "8px",
                            padding: "5px 10px",
                            fontSize: "12px",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          By Tag
                        </button>
                        <button
                          type="button"
                          onClick={() => setGraphGroupBy("zone")}
                          style={{
                            border: "1px solid #cbd5e1",
                            background: graphGroupBy === "zone" ? "#dbeafe" : "#fff",
                            color: graphGroupBy === "zone" ? "#1e3a8a" : "#475569",
                            borderRadius: "8px",
                            padding: "5px 10px",
                            fontSize: "12px",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          By Zone
                        </button>
                      </div>
                    </div>

                    {graphGroupBy === "zone" && graphZones.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
                        {graphZones.map((zone) => {
                          const enabled = enabledGraphZones[zone] !== false;
                          return (
                            <button
                              key={`graph-zone-toggle-${zone}`}
                              type="button"
                              onClick={() => toggleGraphZone(zone)}
                              style={{
                                border: "1px solid #cbd5e1",
                                background: enabled ? "#eff6ff" : "#f8fafc",
                                color: enabled ? "#1e3a8a" : "#64748b",
                                borderRadius: "9999px",
                                padding: "3px 10px",
                                fontSize: "11px",
                                fontWeight: 700,
                                cursor: "pointer",
                                opacity: enabled ? 1 : 0.65,
                              }}
                            >
                              {zone}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {graphTotals.length === 0 ? (
                      <div style={{ color: "#9ca3af", fontSize: "12px" }}>No data for current graph filters.</div>
                    ) : (
                      <div style={{ display: "grid", gridTemplateColumns: "minmax(200px, 260px) 1fr", gap: "14px", alignItems: "start" }}>
                        <div style={{ display: "flex", justifyContent: "center" }}>
                          <div
                            style={{
                              width: "220px",
                              height: "220px",
                              borderRadius: "50%",
                              background: graphPieBackground,
                              position: "relative",
                              boxShadow: "inset 0 0 0 1px rgba(148,163,184,0.25)",
                            }}
                          >
                            <div
                              style={{
                                position: "absolute",
                                top: "50%",
                                left: "50%",
                                transform: "translate(-50%, -50%)",
                                width: "92px",
                                height: "92px",
                                borderRadius: "50%",
                                background: "#fff",
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "center",
                                border: "1px solid #e2e8f0",
                              }}
                            >
                              <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 600 }}>Total</div>
                              <div style={{ fontSize: "20px", color: "#0f172a", fontWeight: 800 }}>{graphTotalSum}</div>
                            </div>
                          </div>
                        </div>

                        <div style={{ display: "grid", gap: "6px", maxHeight: "240px", overflowY: "auto", paddingRight: "4px" }}>
                          {graphTotals.map((item, index) => {
                            const color = GRAPH_COLORS[index % GRAPH_COLORS.length];
                            const percent = graphTotalSum > 0 ? ((item.total / graphTotalSum) * 100).toFixed(1) : "0.0";
                            const widthPercent = graphMaxTotal > 0 ? Math.max(8, (item.total / graphMaxTotal) * 100) : 0;
                            return (
                              <div
                                key={`graph-item-${graphGroupBy}-${item.label}`}
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "16px minmax(140px, 1fr) 70px",
                                  gap: "8px",
                                  alignItems: "center",
                                }}
                              >
                                <span style={{ width: "12px", height: "12px", borderRadius: "9999px", background: color, display: "inline-block" }} />
                                <div title={item.label} style={{ fontSize: "12px", color: "#334155", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  {item.label}
                                </div>
                                <div style={{ fontSize: "12px", color: "#0f172a", fontWeight: 700, textAlign: "right" }}>
                                  {item.total} ({percent}%)
                                </div>
                                <div style={{ gridColumn: "2 / span 2", background: "#e2e8f0", borderRadius: "9999px", height: "8px", overflow: "hidden" }}>
                                  <div style={{ width: `${widthPercent}%`, height: "100%", background: color, borderRadius: "9999px" }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  <div style={{ fontSize: "13px", color: "#6b7280", marginBottom: "6px" }}>Totals by tag</div>
                  {visibleRemainderTagTotals.length === 0 ? (
                    <div style={{ color: "#9ca3af", fontSize: "12px" }}>No tags assigned yet.</div>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                      <button
                        type="button"
                        onClick={() => setSelectedTagFilter(ALL_TAGS_FILTER)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          borderRadius: "9999px",
                          background: selectedTagFilter === ALL_TAGS_FILTER ? "#1e3a8a" : "#eef2ff",
                          color: selectedTagFilter === ALL_TAGS_FILTER ? "#fff" : "#1e3a8a",
                          border: "1px solid #c7d2fe",
                          padding: "4px 10px",
                          fontSize: "12px",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        <span>All Tags</span>
                      </button>
                      {visibleRemainderTagTotals.map((item) => (
                        <button
                          type="button"
                          onClick={() => setSelectedTagFilter(item.tag)}
                          key={`remainder-tag-total-${item.tag}`}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            borderRadius: "9999px",
                            background: selectedTagFilter === item.tag ? "#1e3a8a" : "#eef2ff",
                            color: selectedTagFilter === item.tag ? "#fff" : "#1e3a8a",
                            border: "1px solid #c7d2fe",
                            padding: "4px 10px",
                            fontSize: "12px",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          <span>{item.tag}</span>
                          <span
                            style={{
                              minWidth: "18px",
                              height: "18px",
                              borderRadius: "9999px",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              background: selectedTagFilter === item.tag ? "#dbeafe" : "#1d4ed8",
                              color: selectedTagFilter === item.tag ? "#1e3a8a" : "#fff",
                              fontSize: "11px",
                              padding: "0 6px",
                            }}
                          >
                            {item.total}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ marginBottom: "10px", display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
                  <input
                    type="text"
                    value={remainderSearch}
                    onChange={(event) => setRemainderSearch(event.target.value)}
                    placeholder="Search Issue ID, status, E2 status, project, zone, or phase"
                    style={{
                      flex: "1 1 320px",
                      minWidth: "220px",
                      border: "1px solid #d1d5db",
                      borderRadius: "8px",
                      padding: "7px 10px",
                      fontSize: "12px",
                    }}
                  />
                  <select
                    value={selectedZone}
                    onChange={(event) => setSelectedZone(event.target.value)}
                    style={{
                      minWidth: "160px",
                      border: "1px solid #d1d5db",
                      borderRadius: "8px",
                      padding: "7px 10px",
                      fontSize: "12px",
                      background: "#fff",
                    }}
                  >
                    <option value="all">All Zones</option>
                    {availableZones.map((zone) => (
                      <option key={`zone-filter-${zone}`} value={zone}>
                        {zone}
                      </option>
                    ))}
                  </select>
                  <select
                    value={selectedPhase}
                    onChange={(event) => setSelectedPhase(event.target.value)}
                    style={{
                      minWidth: "160px",
                      border: "1px solid #d1d5db",
                      borderRadius: "8px",
                      padding: "7px 10px",
                      fontSize: "12px",
                      background: "#fff",
                    }}
                  >
                    <option value="all">All Phases</option>
                    {availablePhases.map((phase) => (
                      <option key={`phase-filter-${phase}`} value={phase}>
                        {phase}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ marginBottom: "10px", textAlign: "left" }}>
                  <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "6px" }}>Exclude Status</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {availableStatuses.map((statusValue) => {
                      const excluded = excludedStatuses[statusValue] === true;
                      const isLastIncluded = !excluded && includedStatusCount <= 1;
                      return (
                        <button
                          key={`exclude-status-${statusValue}`}
                          type="button"
                          onClick={() => toggleExcludedStatus(statusValue)}
                          disabled={isLastIncluded}
                          style={{
                            border: "1px solid #cbd5e1",
                            background: excluded ? "#fee2e2" : "#f8fafc",
                            color: excluded ? "#991b1b" : "#334155",
                            borderRadius: "9999px",
                            padding: "3px 10px",
                            fontSize: "11px",
                            fontWeight: 700,
                            cursor: isLastIncluded ? "not-allowed" : "pointer",
                            opacity: isLastIncluded ? 0.6 : 1,
                          }}
                          title={
                            isLastIncluded
                              ? "At least one status must remain included"
                              : excluded
                                ? "Status excluded"
                                : "Status included"
                          }
                        >
                          {excluded ? "Excluded: " : "Include: "}
                          {statusValue}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={{ marginBottom: "10px", textAlign: "left" }}>
                  <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "6px" }}>Exclude Project</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {availableProjects.map((projectValue) => {
                      const excluded = excludedProjects[projectValue] === true;
                      const isLastIncluded = !excluded && includedProjectCount <= 1;
                      return (
                        <button
                          key={`exclude-project-${projectValue}`}
                          type="button"
                          onClick={() => toggleExcludedProject(projectValue)}
                          disabled={isLastIncluded}
                          style={{
                            border: "1px solid #cbd5e1",
                            background: excluded ? "#fee2e2" : "#f8fafc",
                            color: excluded ? "#991b1b" : "#334155",
                            borderRadius: "9999px",
                            padding: "3px 10px",
                            fontSize: "11px",
                            fontWeight: 700,
                            cursor: isLastIncluded ? "not-allowed" : "pointer",
                            opacity: isLastIncluded ? 0.6 : 1,
                          }}
                          title={
                            isLastIncluded
                              ? "At least one project must remain included"
                              : excluded
                                ? "Project excluded"
                                : "Project included"
                          }
                        >
                          {excluded ? "Excluded: " : "Include: "}
                          {projectValue}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                <table style={{ width: "100%", minWidth: "1120px", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                      <th style={{ textAlign: "left", padding: "8px", fontSize: "12px", color: "#6b7280" }}>Issue ID</th>
                      <th style={{ textAlign: "left", padding: "8px", fontSize: "12px", color: "#6b7280" }}>Status</th>
                      <th style={{ textAlign: "left", padding: "8px", fontSize: "12px", color: "#6b7280" }}>E2 Status Update</th>
                      <th style={{ textAlign: "left", padding: "8px", fontSize: "12px", color: "#6b7280" }}>Project</th>
                      <th style={{ textAlign: "left", padding: "8px", fontSize: "12px", color: "#6b7280" }}>Zone</th>
                      <th style={{ textAlign: "left", padding: "8px", fontSize: "12px", color: "#6b7280" }}>Phase</th>
                      <th style={{ textAlign: "left", padding: "8px", fontSize: "12px", color: "#6b7280" }}>Snapshot</th>
                      <th style={{ textAlign: "left", padding: "8px", fontSize: "12px", color: "#6b7280" }}>Tags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRemainderIssues.map((ticket, index) => {
                      const isHighlighted =
                        selectedIssueId &&
                        normalizeIssueIdDisplay(ticket.issueId).toLowerCase() === normalizeIssueIdDisplay(selectedIssueId).toLowerCase();
                      const isSavingTag = Boolean(savingTagByIssueKey[ticket.key]);
                      const isSavingStatus = Boolean(savingStatusByIssueKey[ticket.key]);
                      const tagSuggestions = getTagSuggestionsForTicket(ticket);
                      const ticketStatusOptions = Array.from(
                        new Set([...availableE2StatusOptions, normalizeValue(ticket.e2StatusUpdate)].filter(Boolean))
                      );
                      return (
                        <tr
                          key={`remainder-${ticket.key}`}
                          style={{
                            borderBottom: "1px solid #e5e7eb",
                            background: isHighlighted ? "#fffbeb" : index % 2 === 0 ? "#ffffff" : "#f8fafc",
                          }}
                        >
                          <td
                            title={normalizeIssueIdDisplay(ticket.issueId)}
                            style={{
                              padding: "8px",
                              color: "#111827",
                              fontWeight: 700,
                              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {normalizeIssueIdDisplay(ticket.issueId)}
                          </td>
                          <td style={{ padding: "8px", color: "#374151", whiteSpace: "nowrap" }}>{ticket.status || "-"}</td>
                          <td style={{ padding: "8px", color: "#374151", minWidth: "190px" }}>
                            <select
                              value={normalizeValue(ticket.e2StatusUpdate) || DEFAULT_E2_STATUS_UPDATE}
                              onChange={(event) => handleSelectRemainderStatus(ticket, event.target.value)}
                              disabled={isSavingStatus}
                              style={{
                                width: "100%",
                                border: "1px solid #d1d5db",
                                borderRadius: "6px",
                                padding: "6px 8px",
                                fontSize: "12px",
                                color: "#111827",
                                background: isSavingStatus ? "#f3f4f6" : "#fff",
                                cursor: isSavingStatus ? "not-allowed" : "pointer",
                              }}
                            >
                              {ticketStatusOptions.map((option) => (
                                <option key={`${ticket.key}-status-${option}`} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding: "8px", color: "#374151" }}>{getProjectNameDisplay(ticket)}</td>
                          <td style={{ padding: "8px", color: "#374151", whiteSpace: "nowrap" }}>{ticket.zone || "Unspecified"}</td>
                          <td style={{ padding: "8px", color: "#374151", whiteSpace: "nowrap" }}>{ticket.phase || "Unspecified"}</td>
                          <td style={{ padding: "8px", color: "#374151", minWidth: "130px" }}>
                            {ticket.snapshotPreviewUrl ? (
                              <button
                                type="button"
                                onClick={() => handleOpenLightbox(ticket)}
                                title="Open snapshot"
                                style={{
                                  border: "none",
                                  background: "transparent",
                                  padding: 0,
                                  cursor: "zoom-in",
                                  display: "inline-flex",
                                  alignItems: "center",
                                }}
                              >
                                <img
                                  src={ticket.snapshotPreviewUrl}
                                  alt="Issue snapshot"
                                  loading="lazy"
                                  style={{ width: "64px", height: "44px", objectFit: "cover", borderRadius: "4px", border: "1px solid #e5e7eb" }}
                                />
                              </button>
                            ) : (
                              <span style={{ color: "#9ca3af", fontSize: "12px" }}>No snapshot</span>
                            )}
                          </td>
                          <td style={{ padding: "8px", color: "#374151", minWidth: "290px" }}>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "6px" }}>
                              {(ticket.intelligenceTags || []).length === 0 ? (
                                <span
                                  style={{
                                    background: "#f8fafc",
                                    color: "#64748b",
                                    borderRadius: "9999px",
                                    padding: "2px 8px",
                                    fontSize: "12px",
                                    fontWeight: 600,
                                    border: "1px dashed #cbd5e1",
                                  }}
                                >
                                  {UNASSIGNED_TAG_LABEL}
                                </span>
                              ) : (
                                ticket.intelligenceTags.map((tag) => (
                                  <span
                                    key={`${ticket.key}-${tag}`}
                                    style={{
                                      background: "#f1f5f9",
                                      color: "#334155",
                                      borderRadius: "9999px",
                                      padding: "2px 6px",
                                      fontSize: "12px",
                                      fontWeight: 600,
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "4px",
                                    }}
                                  >
                                    <span>{tag}</span>
                                    <button
                                      type="button"
                                      onClick={() => handleEditRemainderTag(ticket, tag)}
                                      disabled={isSavingTag}
                                      title="Edit tag"
                                      style={{
                                        border: "none",
                                        background: "transparent",
                                        color: "#475569",
                                        cursor: isSavingTag ? "not-allowed" : "pointer",
                                        fontSize: "11px",
                                        padding: 0,
                                        lineHeight: 1,
                                      }}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveRemainderTag(ticket, tag)}
                                      disabled={isSavingTag}
                                      title="Remove tag"
                                      style={{
                                        border: "none",
                                        background: "transparent",
                                        color: "#b91c1c",
                                        cursor: isSavingTag ? "not-allowed" : "pointer",
                                        fontSize: "11px",
                                        padding: 0,
                                        lineHeight: 1,
                                      }}
                                    >
                                      Remove
                                    </button>
                                  </span>
                                ))
                              )}
                            </div>

                            <div style={{ display: "flex", gap: "6px" }}>
                              <input
                                type="text"
                                value={tagInputs[ticket.key] || ""}
                                onChange={(event) =>
                                  setTagInputs((prev) => ({
                                    ...prev,
                                    [ticket.key]: event.target.value,
                                  }))
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    handleAddRemainderTag(ticket);
                                  }
                                }}
                                placeholder="Add tag"
                                style={{
                                  flex: 1,
                                  minWidth: "120px",
                                  border: "1px solid #d1d5db",
                                  borderRadius: "6px",
                                  padding: "5px 8px",
                                  fontSize: "12px",
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => handleAddRemainderTag(ticket)}
                                disabled={isSavingTag}
                                style={{
                                  border: "none",
                                  borderRadius: "6px",
                                  padding: "5px 10px",
                                  fontSize: "12px",
                                  fontWeight: 700,
                                  background: "#1d4ed8",
                                  color: "#fff",
                                  cursor: isSavingTag ? "not-allowed" : "pointer",
                                  opacity: isSavingTag ? 0.7 : 1,
                                }}
                              >
                                {isSavingTag ? "Saving..." : "Add"}
                              </button>
                            </div>

                            {tagSuggestions.length > 0 && (
                              <div
                                style={{
                                  marginTop: "6px",
                                  display: "flex",
                                  gap: "6px",
                                  flexWrap: "wrap",
                                }}
                              >
                                {tagSuggestions.map((suggestion) => (
                                  <button
                                    key={`${ticket.key}-suggestion-${suggestion}`}
                                    type="button"
                                    disabled={isSavingTag}
                                    onClick={() => handleAddRemainderTag(ticket, suggestion)}
                                    title={`Add suggested tag: ${suggestion}`}
                                    style={{
                                      border: "1px solid #bfdbfe",
                                      background: "#eff6ff",
                                      color: "#1e3a8a",
                                      borderRadius: "9999px",
                                      padding: "2px 8px",
                                      fontSize: "11px",
                                      fontWeight: 600,
                                      cursor: isSavingTag ? "not-allowed" : "pointer",
                                      opacity: isSavingTag ? 0.7 : 1,
                                    }}
                                  >
                                    {suggestion}
                                  </button>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {filteredRemainderIssues.length === 0 && (
                      <tr>
                        <td colSpan={8} style={{ padding: "10px", color: "#6b7280" }}>
                          No remainder issues match your search.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                </div>
              </>
            )}
          </section>
        )}
      </div>
      {lightboxTicket && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Snapshot preview"
          onClick={handleCloseLightbox}
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            background: "rgba(0, 0, 0, 0.78)",
            zIndex: 1200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "min(1100px, 95vw)",
              maxHeight: "90vh",
              overflowY: "auto",
              background: "#fff",
              borderRadius: "12px",
              boxShadow: "0 25px 50px -12px rgba(0,0,0,0.35)",
              padding: "14px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <div style={{ textAlign: "left" }}>
                <div style={{ fontSize: "13px", color: "#6b7280" }}>Issue</div>
                <div style={{ fontSize: "18px", fontWeight: 700, color: "#111827" }}>
                  {normalizeIssueIdDisplay(lightboxTicket.issueId)}
                </div>
                <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>
                  {lightboxTicketIndex + 1} of {lightboxNavigationTickets.length}
                </div>
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button
                  type="button"
                  onClick={decreaseLightboxZoom}
                  disabled={lightboxZoom <= 1}
                  title="Zoom out"
                  style={{
                    border: "none",
                    background: lightboxZoom <= 1 ? "#e5e7eb" : "#e2e8f0",
                    color: "#1f2937",
                    borderRadius: "8px",
                    padding: "8px 10px",
                    fontWeight: 700,
                    cursor: lightboxZoom <= 1 ? "not-allowed" : "pointer",
                  }}
                >
                  -
                </button>
                <button
                  type="button"
                  onClick={resetLightboxZoom}
                  title="Reset zoom"
                  style={{
                    border: "none",
                    background: "#eef2ff",
                    color: "#1e3a8a",
                    borderRadius: "8px",
                    padding: "8px 10px",
                    fontWeight: 700,
                    cursor: "pointer",
                    minWidth: "64px",
                  }}
                >
                  {Math.round(lightboxZoom * 100)}%
                </button>
                <button
                  type="button"
                  onClick={increaseLightboxZoom}
                  disabled={lightboxZoom >= 3}
                  title="Zoom in"
                  style={{
                    border: "none",
                    background: lightboxZoom >= 3 ? "#e5e7eb" : "#e2e8f0",
                    color: "#1f2937",
                    borderRadius: "8px",
                    padding: "8px 10px",
                    fontWeight: 700,
                    cursor: lightboxZoom >= 3 ? "not-allowed" : "pointer",
                  }}
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={goPrevLightbox}
                  disabled={!canGoPrevLightbox}
                  style={{
                    border: "none",
                    background: canGoPrevLightbox ? "#dbeafe" : "#e5e7eb",
                    color: "#1e3a8a",
                    borderRadius: "8px",
                    padding: "8px 12px",
                    fontWeight: 700,
                    cursor: canGoPrevLightbox ? "pointer" : "not-allowed",
                    opacity: canGoPrevLightbox ? 1 : 0.65,
                  }}
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={goNextLightbox}
                  disabled={!canGoNextLightbox}
                  style={{
                    border: "none",
                    background: canGoNextLightbox ? "#1d4ed8" : "#93c5fd",
                    color: "#fff",
                    borderRadius: "8px",
                    padding: "8px 12px",
                    fontWeight: 700,
                    cursor: canGoNextLightbox ? "pointer" : "not-allowed",
                    opacity: canGoNextLightbox ? 1 : 0.7,
                  }}
                >
                  Next
                </button>
                <button
                  type="button"
                  onClick={handleCloseLightbox}
                  style={{
                    border: "none",
                    background: "#e5e7eb",
                    color: "#111827",
                    borderRadius: "8px",
                    padding: "8px 12px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Close
                </button>
              </div>
            </div>

            <div
              style={{
                maxHeight: "60vh",
                overflow: "hidden",
                borderRadius: "8px",
                border: "1px solid #e5e7eb",
                background: "#f8fafc",
                textAlign: "center",
              }}
            >
              <img
                src={lightboxTicket.snapshotPreviewUrl}
                alt="Issue snapshot"
                style={{
                  width: "100%",
                  maxHeight: `${60 * lightboxZoom}vh`,
                  objectFit: "contain",
                  transition: "max-height 120ms ease-out",
                }}
              />
            </div>

            <div style={{ marginTop: "12px", textAlign: "left" }}>
              <div style={{ marginBottom: "8px" }}>
                <div style={{ fontSize: "13px", color: "#6b7280", marginBottom: "6px" }}>Current tags</div>
                {(lightboxTicket.intelligenceTags || []).length === 0 ? (
                  <div style={{ color: "#9ca3af", fontSize: "12px" }}>No tags on this issue yet.</div>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {lightboxTicket.intelligenceTags.map((tag) => (
                      <span
                        key={`${lightboxTicket.key}-lightbox-tag-${tag}`}
                        style={{
                          background: "#f1f5f9",
                          color: "#334155",
                          borderRadius: "9999px",
                          padding: "2px 8px",
                          fontSize: "12px",
                          fontWeight: 600,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                        }}
                      >
                        <span>{tag}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveLightboxTag(tag)}
                          disabled={isLightboxTagSaving}
                          title="Remove tag"
                          style={{
                            border: "none",
                            background: "transparent",
                            color: "#b91c1c",
                            cursor: isLightboxTagSaving ? "not-allowed" : "pointer",
                            fontSize: "11px",
                            fontWeight: 700,
                            padding: 0,
                            lineHeight: 1,
                          }}
                        >
                          Remove
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ fontSize: "13px", color: "#6b7280", marginBottom: "6px" }}>Add tag from lightbox</div>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text"
                  value={lightboxTagInput}
                  onChange={(event) => setLightboxTagInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleAddLightboxTag();
                    }
                  }}
                  placeholder="Type tag"
                  style={{
                    flex: 1,
                    border: "1px solid #d1d5db",
                    borderRadius: "8px",
                    padding: "8px 10px",
                    fontSize: "13px",
                  }}
                />
                <button
                  type="button"
                  onClick={() => handleAddLightboxTag()}
                  disabled={isLightboxTagSaving || isLightboxAiLoading}
                  style={{
                    border: "none",
                    borderRadius: "8px",
                    padding: "8px 12px",
                    fontSize: "13px",
                    fontWeight: 700,
                    background: "#1d4ed8",
                    color: "#fff",
                    cursor: isLightboxTagSaving || isLightboxAiLoading ? "not-allowed" : "pointer",
                    opacity: isLightboxTagSaving || isLightboxAiLoading ? 0.7 : 1,
                  }}
                >
                  {isLightboxTagSaving ? "Saving..." : "Add tag"}
                </button>
                <button
                  type="button"
                  onClick={handleSuggestLightboxTagsWithGemini}
                  disabled={isLightboxAiLoading || isLightboxTagSaving}
                  title="Use Gemini to suggest tags and identify objects"
                  style={{
                    border: "1px solid #c7d2fe",
                    borderRadius: "8px",
                    padding: "8px 12px",
                    fontSize: "13px",
                    fontWeight: 700,
                    background: isLightboxAiLoading ? "#e2e8f0" : "#eef2ff",
                    color: "#312e81",
                    cursor: isLightboxAiLoading || isLightboxTagSaving ? "not-allowed" : "pointer",
                    opacity: isLightboxAiLoading || isLightboxTagSaving ? 0.75 : 1,
                  }}
                >
                  {isLightboxAiLoading ? "Analyzing..." : "Suggest with Gemini"}
                </button>
              </div>

              {lightboxAiError ? (
                <div style={{ marginTop: "8px", fontSize: "12px", color: "#b91c1c" }}>{lightboxAiError}</div>
              ) : null}

              {lightboxAiTags.length > 0 && (
                <div style={{ marginTop: "8px" }}>
                  <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "4px" }}>Gemini suggested tags</div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {lightboxAiTags.map((suggestion) => (
                      <button
                        key={`${lightboxTicket.key}-gemini-tag-${suggestion}`}
                        type="button"
                        disabled={isLightboxTagSaving || isLightboxAiLoading}
                        onClick={() => handleAddLightboxTag(suggestion)}
                        title={`Add Gemini tag: ${suggestion}`}
                        style={{
                          border: "1px solid #93c5fd",
                          background: "#dbeafe",
                          color: "#1e3a8a",
                          borderRadius: "9999px",
                          padding: "2px 8px",
                          fontSize: "11px",
                          fontWeight: 700,
                          cursor: isLightboxTagSaving || isLightboxAiLoading ? "not-allowed" : "pointer",
                          opacity: isLightboxTagSaving || isLightboxAiLoading ? 0.7 : 1,
                        }}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {lightboxAiObjects.length > 0 && (
                <div style={{ marginTop: "8px" }}>
                  <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "4px" }}>Objects detected</div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {lightboxAiObjects.map((objectName) => (
                      <span
                        key={`${lightboxTicket.key}-gemini-object-${objectName}`}
                        style={{
                          border: "1px solid #e5e7eb",
                          background: "#f8fafc",
                          color: "#334155",
                          borderRadius: "9999px",
                          padding: "2px 8px",
                          fontSize: "11px",
                          fontWeight: 600,
                        }}
                      >
                        {objectName}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {lightboxTagSuggestions.length > 0 && (
                <div
                  style={{
                    marginTop: "8px",
                    display: "flex",
                    gap: "6px",
                    flexWrap: "wrap",
                  }}
                >
                  {lightboxTagSuggestions.map((suggestion) => (
                    <button
                      key={`${lightboxTicket.key}-lightbox-suggestion-${suggestion}`}
                      type="button"
                      disabled={isLightboxTagSaving}
                      onClick={() => handleAddLightboxTag(suggestion)}
                      title={`Add suggested tag: ${suggestion}`}
                      style={{
                        border: "1px solid #bfdbfe",
                        background: "#eff6ff",
                        color: "#1e3a8a",
                        borderRadius: "9999px",
                        padding: "2px 8px",
                        fontSize: "11px",
                        fontWeight: 600,
                        cursor: isLightboxTagSaving ? "not-allowed" : "pointer",
                        opacity: isLightboxTagSaving ? 0.7 : 1,
                      }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default IntelligenceModule;
