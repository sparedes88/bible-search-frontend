import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { collection, doc, onSnapshot, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import commonStyles from "../pages/commonStyles";
import ChurchHeader from "./ChurchHeader";
import { db, storage } from "../firebase";
import "./ProjectIssueDashboard.css";

const E2_DETAILER_FIELD = "E2 Detailer";
const E2_DETAILER_OPTIONS = ["Juan", "Josias", "Krismara", "Eliana", "Guely", "Christian", "Ben", "Salomon"];

const E2_STATUS_UPDATE_FIELD = "E2 Status Update";
const E2_STATUS_UPDATE_OPTIONS = ["Stop and Send", "Send to Queue", "Steer with Message", "In Progress", "Completed"];

const E2_STATUS_DATE_FIELD = "E2 Status Date";

const SNAPSHOT_FIELD = "Snapshot URL";

const getTodayMMDDYY = () => {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
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
  const statusField = findFieldByAliases(fields, rowData, ["status", "state", "task status"]);
  const priorityField = findFieldByAliases(fields, rowData, ["priority"]);
  const zoneField = findFieldByAliases(fields, rowData, ["zone", "area", "section", "location zone"]);
  const assigneeField = findFieldByAliases(fields, rowData, ["assignee", "assigned to", "owner", "responsible"]);
  const e2DetailerField = findFieldByAliases(fields, rowData, ["e2 detailer", "e2detailer"]);
  const e2StatusUpdateField = findFieldByAliases(fields, rowData, ["e2 status update", "e2statusupdate"]);
  const e2StatusDateField = findFieldByAliases(fields, rowData, ["e2 status date", "e2statusdate"]);
  const snapshotField = findFieldByAliases(fields, rowData, ["snapshot url", "snapshoturl", "snapshot", "picture", "photo", "image"]);
  const linkField = findFieldByAliases(fields, rowData, ["link", "url", "issue url", "card url", "task url", "issue link", "card link"]);
  const deadlineField = findFieldByAliases(fields, rowData, ["deadline", "due date", "due", "target date"]);
  const idField = findFieldByAliases(fields, rowData, ["id", "task id", "card id", "row id"]);

  return {
    title: normalizeValue(titleField ? rowData?.[titleField] : ""),
    status: normalizeValue(statusField ? rowData?.[statusField] : ""),
    priority: normalizeValue(priorityField ? rowData?.[priorityField] : ""),
    zone: normalizeValue(zoneField ? rowData?.[zoneField] : ""),
    assignee: normalizeValue(assigneeField ? rowData?.[assigneeField] : ""),
    e2Detailer: normalizeValue(e2DetailerField ? rowData?.[e2DetailerField] : ""),
    e2StatusUpdate: normalizeValue(e2StatusUpdateField ? rowData?.[e2StatusUpdateField] : ""),
    e2StatusDate: normalizeValue(e2StatusDateField ? rowData?.[e2StatusDateField] : ""),
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

const ProjectIssueDashboard = () => {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const [activeTab, setActiveTab] = useState(() => searchParams.get("status") || "All");
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProjectName, setSelectedProjectName] = useState(() => searchParams.get("projectName") || "");
  const [selectedE2Detailer, setSelectedE2Detailer] = useState(() => searchParams.get("e2Detailer") || "");
  const [globalSearch, setGlobalSearch] = useState(() => searchParams.get("search") || "");

  // Keep URL in sync with filter state
  useEffect(() => {
    const params = {};
    if (activeTab !== "All") params.status = activeTab;
    if (selectedProjectName) params.projectName = selectedProjectName;
    if (selectedE2Detailer) params.e2Detailer = selectedE2Detailer;
    if (globalSearch) params.search = globalSearch;
    setSearchParams(params, { replace: true });
  }, [activeTab, selectedProjectName, selectedE2Detailer, globalSearch, setSearchParams]);
  const [projectSources, setProjectSources] = useState({});
  const [savingIssueKeys, setSavingIssueKeys] = useState({});
  const [uploadingSnapshotKeys, setUploadingSnapshotKeys] = useState({});
  const [lightboxUrl, setLightboxUrl] = useState("");

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
          };

          rows.forEach((row, rowIndex) => {
            const rowData = row?.rowData || {};
            const preview = getCardPreview(rowData, fields);
            const cardKey = getCardMetaKey(row, preview);
            const internalMeta = internalCardMeta?.[cardKey] || {};

            nextIssues.push({
              key: `${projectDoc.id}-${row?.rowNumber || rowIndex}`,
              id: preview.id || String(row?.rowNumber || rowIndex + 1),
              title: preview.title || "Untitled issue",
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

  const tabs = useMemo(() => {
    const dynamicStatuses = Array.from(new Set(issues.map((issue) => normalizeValue(issue.status)).filter(Boolean)));
    return ["All", ...dynamicStatuses];
  }, [issues]);

  const visibleIssues = useMemo(() => {
    const normalizedSearch = normalizeValue(globalSearch).toLowerCase();

    return issues.filter((issue) => {
      if (activeTab !== "All" && issue.status !== activeTab) {
        return false;
      }

      if (selectedProjectName && issue.zoneCategory !== selectedProjectName) {
        return false;
      }

      if (selectedE2Detailer && issue.e2Detailer !== selectedE2Detailer) {
        return false;
      }

      if (!normalizedSearch) return true;

      const haystack = [
        issue.project,
        issue.id,
        issue.title,
        issue.owner,
        issue.e2Detailer,
        issue.e2StatusUpdate,
        issue.priority,
        issue.zone,
        issue.zoneCategory,
        issue.status,
        issue.dueDate,
      ]
        .map((value) => normalizeValue(value).toLowerCase())
        .join(" ");

      return haystack.includes(normalizedSearch);
    });
  }, [activeTab, globalSearch, issues, selectedE2Detailer, selectedProjectName]);

  const zoneCategoryOptions = useMemo(
    () => Array.from(new Set(issues.map((issue) => issue.zoneCategory))).sort((a, b) => a.localeCompare(b)),
    [issues]
  );
  const e2DetailerOptions = useMemo(
    () => Array.from(new Set(issues.map((issue) => normalizeValue(issue.e2Detailer)).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [issues]
  );

  const summaryProjectName = selectedProjectName || "All Projects";
  const scopedIssueCount = useMemo(() => {
    return issues.filter((issue) => {
      if (selectedProjectName && issue.zoneCategory !== selectedProjectName) return false;
      if (selectedE2Detailer && issue.e2Detailer !== selectedE2Detailer) return false;
      return true;
    }).length;
  }, [issues, selectedProjectName, selectedE2Detailer]);
  const summaryStatusName = activeTab === "All" ? "All Statuses" : activeTab;
  const statusScopedIssueCount = useMemo(() => {
    return issues.filter((issue) => {
      if (selectedProjectName && issue.zoneCategory !== selectedProjectName) {
        return false;
      }

      if (selectedE2Detailer && issue.e2Detailer !== selectedE2Detailer) {
        return false;
      }

      if (activeTab !== "All" && issue.status !== activeTab) {
        return false;
      }

      return true;
    }).length;
  }, [activeTab, issues, selectedProjectName, selectedE2Detailer]);

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
    const today = getTodayMMDDYY();
    setIssues((previous) =>
      previous.map((issue) =>
        issue.key === issueKey ? { ...issue, e2StatusUpdate: value, e2StatusDate: today } : issue
      )
    );
  };

  const handleE2StatusDateChange = (issueKey, value) => {
    setIssues((previous) =>
      previous.map((issue) => (issue.key === issueKey ? { ...issue, e2StatusDate: value } : issue))
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
    const nextValue = normalizeValue(valueOverride ?? issue.e2StatusDate);
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
    const nextValue = normalizeValue(valueOverride ?? issue.e2StatusUpdate);
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

  return (
    <div style={commonStyles.fullWidthContainer}>
      <Link to={`/organization/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to My Organization
      </Link>

      <ChurchHeader id={id} applyShadow={false} allowEditBannerLogo={true} />

      <div className="project-issue-wrap">
        <div className="project-issue-head">
          <div className="project-issue-head-top">
            <div>
              <h1 className="project-issue-title">Project Issue List</h1>
              <p className="project-issue-subtitle">
                Tracking live issues from BIM projects.
              </p>
            </div>
            <a
              className="project-issue-email-btn"
              href={(() => {
                const url = `${window.location.origin}/organization/${id}/project-issue-dashboard?e2Detailer=Ben`;
                const subject = encodeURIComponent("Project Issue List – Ben's View");
                const body = encodeURIComponent(`Here is the Project Issue List filtered for Ben:\n\n${url}`);
                return `mailto:bsolorzano@e2techsupport.com?subject=${subject}&body=${body}`;
              })()}
            >
              ✉ Email Ben's View
            </a>
          </div>
          <div className="project-issue-summary-chart" aria-label="Issue summary chart">
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
                  style={{ width: `${scopedIssueCount ? 100 : 0}%` }}
                />
              </div>
            </div>

            <div className="project-issue-summary-row">
              <div className="project-issue-summary-meta">
                <span>
                  Number of Issues with status as <strong>{summaryStatusName}</strong>
                </span>
                <strong>{statusScopedIssueCount}</strong>
              </div>
              <div className="project-issue-summary-track">
                <div
                  className="project-issue-summary-fill is-filtered"
                  style={{
                    width: `${scopedIssueCount ? Math.max((statusScopedIssueCount / scopedIssueCount) * 100, 2) : 0}%`,
                  }}
                />
              </div>
            </div>
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
              {zoneCategoryOptions.map((option) => (
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
                <th>Project Name</th>
                <th>Title</th>
                <th>Owner</th>
                <th>E2 Detailer</th>
                <th>E2 Status Update</th>
                <th>Status Update Date</th>
                <th>Snapshot</th>
                <th>Priority</th>
                <th>Zone</th>
                <th>Status</th>
                <th>Due Date</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={12} className="project-issue-empty">
                    Loading BIM issues...
                  </td>
                </tr>
              ) : null}
              {visibleIssues.map((issue) => (
                <tr key={issue.key}>
                  <td data-label="Issue ID">
                    {issue.link ? (
                      <a
                        href={issue.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="project-issue-id-link"
                      >
                        {issue.id}
                      </a>
                    ) : (
                      issue.id
                    )}
                  </td>
                  <td data-label="Project Name">{issue.zoneCategory}</td>
                  <td data-label="Title">{issue.title}</td>
                  <td data-label="Owner">{issue.owner}</td>
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
                      {E2_DETAILER_OPTIONS.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td data-label="E2 Status Update">
                    <select
                      className="project-issue-cell-input"
                      value={issue.e2StatusUpdate}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        handleE2StatusUpdateChange(issue.key, nextValue);
                        handleE2StatusUpdateSave({ ...issue, e2StatusUpdate: nextValue }, nextValue);
                      }}
                      disabled={!!savingIssueKeys[`e2status:${issue.key}`]}
                    >
                      <option value="">Select Status Update</option>
                      {E2_STATUS_UPDATE_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td data-label="Status Update Date">
                    <input
                      type="text"
                      className="project-issue-cell-input"
                      placeholder="MM/DD/YY"
                      value={issue.e2StatusDate}
                      onChange={(event) => handleE2StatusDateChange(issue.key, event.target.value)}
                      onBlur={(event) =>
                        handleE2StatusDateSave({ ...issue, e2StatusDate: event.target.value }, event.target.value)
                      }
                      disabled={!!savingIssueKeys[`e2date:${issue.key}`]}
                    />
                  </td>
                  <td data-label="Snapshot" className="project-issue-snapshot-cell">
                    {issue.snapshotUrl ? (
                      <button
                        type="button"
                        className="project-issue-snapshot-thumb-btn"
                        onClick={() => setLightboxUrl(issue.snapshotUrl)}
                        title="View snapshot"
                      >
                        <img
                          src={issue.snapshotUrl}
                          alt="Issue snapshot"
                          className="project-issue-snapshot-thumb"
                        />
                      </button>
                    ) : null}
                    <label className="project-issue-snapshot-upload-btn" title="Upload snapshot">
                      {uploadingSnapshotKeys[issue.key] ? (
                        <span className="project-issue-snapshot-spinner" aria-label="Uploading" />
                      ) : (
                        <span>{issue.snapshotUrl ? "↑" : "+"}</span>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: "none" }}
                        disabled={!!uploadingSnapshotKeys[issue.key]}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) handleSnapshotUpload(issue, file);
                          event.target.value = "";
                        }}
                      />
                    </label>
                  </td>
                  <td data-label="Priority">{issue.priority}</td>
                  <td data-label="Zone">{issue.zone}</td>
                  <td data-label="Status">
                    <span className={`issue-status issue-status-${issue.status.toLowerCase().replace(/\s+/g, "-")}`}>
                      {issue.status}
                    </span>
                  </td>
                  <td data-label="Due Date">{issue.dueDate}</td>
                </tr>
              ))}
              {!loading && !visibleIssues.length ? (
                <tr>
                  <td colSpan={12} className="project-issue-empty">
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
    </div>
  );
};

export default ProjectIssueDashboard;
