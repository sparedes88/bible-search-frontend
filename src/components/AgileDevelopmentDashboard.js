import React, { useEffect, useMemo, useState } from "react";
import { TAG_ALIASES_FIELD, PROJECT_ISSUE_CONFIG_DOC_ID } from "./projectIssueConstants";
import AgileUpdateModal from "./AgileUpdateModal";

// Ensure normalizeValue is defined before all usages
const normalizeValue = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};
// Helper to get Project Name display value (matches ProjectIssueDashboard.js)
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
import { useParams, Link } from "react-router-dom";
import { collection, doc, onSnapshot, updateDoc } from "firebase/firestore";
import { toast } from "react-toastify";
import { db } from "../firebase";
import {
  DEFAULT_E2_STATUS_UPDATE,
  DEFAULT_E2_STATUS_UPDATE_OPTIONS,
  E2_STATUS_UPDATE_OPTIONS_FIELD,
  DEFAULT_E2_STATUS_UPDATE_AGILE_OPTIONS,
  E2_STATUS_UPDATE_AGILE_OPTIONS_FIELD,
} from "./projectIssueConstants";
import "./AgileDevelopmentDashboard.css";

const getDefaultTechDetailsAvailable = (value) => normalizeValue(value) || "No";

const normalizeFieldKey = (value) => normalizeValue(value).toLowerCase().replace(/[^a-z0-9]+/g, "");

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

const toPhaseId = (value) => {
  const normalized = normalizeValue(value).toLowerCase();
  if (!normalized) return "phase-empty";
  return `phase-${normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "empty"}`;
};

const getColumnsFromStatuses = (statusOptions = []) =>
  statusOptions.map((status, index) => ({
    id: toPhaseId(status),
    name: status,
    order: index,
  }));

const findFieldByAliases = (fields = [], rowData = {}, aliases = []) => {
  const normalizedAliases = aliases.map((alias) => normalizeFieldKey(alias));
  const candidates = dedupeValues([...(Array.isArray(fields) ? fields : []), ...Object.keys(rowData || {})]);

  for (const candidate of candidates) {
    const key = normalizeFieldKey(candidate);
    if (normalizedAliases.includes(key)) {
      return candidate;
    }
  }

  for (const aliasKey of normalizedAliases) {
    const startsWith = candidates.find((candidate) => normalizeFieldKey(candidate).startsWith(aliasKey));
    if (startsWith) return startsWith;

    const includes = candidates.find((candidate) => normalizeFieldKey(candidate).includes(aliasKey));
    if (includes) return includes;
  }

  return null;
};

const ISSUE_ID_ALIASES = ["issue id", "id", "task id", "card id", "row id"];
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

const TECH_DETAILS_ALIASES = [
  "technical details available",
  "technical details",
  "techdetailsavailable",
];

const AgileDevelopmentDashboard = () => {
  const { id } = useParams();
  // Columns will be generated dynamically from unique E2 Status Update Agile values
  const [columns, setColumns] = useState([]);
  const [issues, setIssues] = useState([]);
  const [projectSources, setProjectSources] = useState({});
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [loadingIssues, setLoadingIssues] = useState(true);
  const [draggedIssueKey, setDraggedIssueKey] = useState("");
  const [savingIssueKey, setSavingIssueKey] = useState("");
  const [selectedProjectName, setSelectedProjectName] = useState("All");
  const [selectedE2LeadDetailer, setSelectedE2LeadDetailer] = useState("All");
  const [selectedE2StatusAgile, setSelectedE2StatusAgile] = useState("All");
  const [selectedDataStage, setSelectedDataStage] = useState("All");
  const [tagAliasByLowerTag, setTagAliasByLowerTag] = useState({});
  const DATA_STAGE_OPTIONS = ["Testing", "Production"];
  // Load tag aliases from Firestore (same as ProjectIssueDashboard)
  useEffect(() => {
    if (!id) return;
    const configRef = doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID);
    const unsubscribe = onSnapshot(configRef, (snapshot) => {
      const data = snapshot.data() || {};
      const tagAliases = data[TAG_ALIASES_FIELD] || {};
      // Normalize keys to lower case
      const normalized = {};
      Object.entries(tagAliases).forEach(([k, v]) => {
        if (k && v) normalized[k.toLowerCase()] = v;
      });
      setTagAliasByLowerTag(normalized);
    });
    return () => unsubscribe();
  }, [id]);

  // Always use E2 Status Update Agile options from Firestore for columns, in dropdown order
  const [agileStatusOptions, setAgileStatusOptions] = useState(DEFAULT_E2_STATUS_UPDATE_AGILE_OPTIONS);
  useEffect(() => {
    if (!id) return;
    const configRef = doc(db, "churches", id, "settings", E2_STATUS_UPDATE_AGILE_OPTIONS_FIELD ? PROJECT_ISSUE_CONFIG_DOC_ID : "");
    const unsubscribe = onSnapshot(configRef, (snapshot) => {
      const data = snapshot.data() || {};
      const configuredAgileStatus = Array.isArray(data[E2_STATUS_UPDATE_AGILE_OPTIONS_FIELD])
        ? data[E2_STATUS_UPDATE_AGILE_OPTIONS_FIELD]
        : [];
      setAgileStatusOptions(configuredAgileStatus.length ? configuredAgileStatus : DEFAULT_E2_STATUS_UPDATE_AGILE_OPTIONS);
    });
    return () => unsubscribe();
  }, [id]);

  useEffect(() => {
    setColumns(getColumnsFromStatuses(agileStatusOptions));
    setLoadingConfig(false);
  }, [agileStatusOptions]);

  useEffect(() => {
    if (!id) return undefined;

    const projectsRef = collection(db, "churches", id, "bimProjects");
    const unsubscribe = onSnapshot(
      projectsRef,
      (snapshot) => {
        const nextProjectSources = {};
        const nextIssues = [];

        snapshot.forEach((projectDoc) => {
          const projectData = projectDoc.data() || {};
          const fields = Array.isArray(projectData.fields) ? projectData.fields : [];
          const rows = Array.isArray(projectData.rows) ? projectData.rows : [];
          const defaultProjectName = normalizeValue(projectData.name) || projectDoc.id;

          nextProjectSources[projectDoc.id] = { fields, rows };

          rows.forEach((row, rowIndex) => {
            const rowData = row?.rowData || {};
            const issueIdField = findFieldByAliases(fields, rowData, ISSUE_ID_ALIASES);
            const titleField = findFieldByAliases(fields, rowData, TITLE_ALIASES);
            const projectNameField = findFieldByAliases(fields, rowData, PROJECT_NAME_ALIASES);
            const statusAgileField = findFieldByAliases(fields, rowData, E2_STATUS_AGILE_ALIASES) || "E2 Status Update Agile";
            const techDetailsField = findFieldByAliases(fields, rowData, TECH_DETAILS_ALIASES);
            const leadDetailerField = findFieldByAliases(fields, rowData, LEAD_DETAILER_ALIASES);
            const dataStageField = findFieldByAliases(fields, rowData, ["data stage", "datastage"]);
            const dataStage = normalizeValue(dataStageField ? rowData[dataStageField] : "") || "Testing";

            const issueId = normalizeValue(issueIdField ? rowData[issueIdField] : "") || String(row?.rowNumber || rowIndex + 1);
            const title = normalizeValue(titleField ? rowData[titleField] : "") || "Untitled issue";
            // ENFORCE: Only use actual Project Name field from the issue record, never fallback to projectData.name
            const projectName = normalizeValue(projectNameField ? rowData[projectNameField] : "");
            const techDetailsAvailable = getDefaultTechDetailsAvailable(techDetailsField ? rowData[techDetailsField] : "");
            const e3LeadDetailer = normalizeValue(leadDetailerField ? rowData[leadDetailerField] : "");
            let status = "";
            if (statusAgileField && rowData[statusAgileField] !== undefined && rowData[statusAgileField] !== null) {
              status = normalizeValue(rowData[statusAgileField]);
            }
            const technicalDirectionField = "Technical Direction";
            const technicalDirection = normalizeValue(rowData[technicalDirectionField] || "");

            nextIssues.push({
              key: `${projectDoc.id}-${row?.rowNumber ?? "row"}-${rowIndex}`,
              projectDocId: projectDoc.id,
              rowIndex,
              statusField: statusAgileField,
              issueId,
              title,
              projectName,
              dataStage,
              techDetailsAvailable,
              e3LeadDetailer,
              e2LeadDetailer: e3LeadDetailer,
              status,
              technicalDirection,
            });
          });
        });

        setProjectSources(nextProjectSources);
        setIssues(nextIssues);
        setLoadingIssues(false);
      },
      () => {
        setProjectSources({});
        setIssues([]);
        setLoadingIssues(false);
      }
    );

    return () => unsubscribe();
  }, [id]);

  const loading = loadingConfig || loadingIssues;

  // Use getProjectNameDisplay with tagAliasByLowerTag for filter options
  const projectNameOptions = useMemo(
    () => dedupeValues(issues.map((issue) => getProjectNameDisplay(issue, tagAliasByLowerTag))).sort((a, b) => a.localeCompare(b)),
    [issues, tagAliasByLowerTag]
  );

    // DEBUG: Log the exact Project Name filter options to the browser console
    if (!loading) {
      // Only log once per load
      console.log('[AgileBoard] Project Name filter options:', projectNameOptions);
    }

  const e2LeadDetailerOptions = useMemo(
    () => dedupeValues(issues.map((issue) => normalizeValue(issue.e2LeadDetailer))),
    [issues]
  );

  const visibleIssues = useMemo(() => {
    return issues.filter((issue) => {
      const projectMatched =
        selectedProjectName === "All" || normalizeValue(issue.projectName) === selectedProjectName;
      const detailerMatched =
        selectedE2LeadDetailer === "All" || normalizeValue(issue.e2LeadDetailer) === selectedE2LeadDetailer;
      const e2StatusAgileMatched =
        selectedE2StatusAgile === "All" || normalizeValue(issue.status) === selectedE2StatusAgile;
      const dataStageMatched =
        selectedDataStage === "All" || normalizeValue(issue.dataStage) === selectedDataStage;
      return projectMatched && detailerMatched && e2StatusAgileMatched && dataStageMatched;
    });
  }, [issues, selectedProjectName, selectedE2LeadDetailer, selectedE2StatusAgile, selectedDataStage]);

  const e2StatusAgileOptions = useMemo(
    () => dedupeValues(issues.map((issue) => normalizeValue(issue.status))).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    [issues]
  );

  const sortedColumns = useMemo(() => [...columns].sort((a, b) => a.order - b.order), [columns]);

  const handleDragStart = (issueKey) => {
    setDraggedIssueKey(issueKey);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
  };

  const handleDrop = async (column) => {
    if (!draggedIssueKey) return;

    const issue = issues.find((item) => item.key === draggedIssueKey);
    if (!issue) {
      setDraggedIssueKey("");
      return;
    }

    if (toPhaseId(issue.status) === column.id) {
      setDraggedIssueKey("");
      return;
    }

    const source = projectSources[issue.projectDocId];
    if (!source) {
      toast.error("Could not find source project for this issue.");
      setDraggedIssueKey("");
      return;
    }

    const rows = Array.isArray(source.rows) ? source.rows : [];
    const targetRow = rows[issue.rowIndex];
    if (!targetRow) {
      toast.error("Could not find source row for this issue.");
      setDraggedIssueKey("");
      return;
    }

    const nextStatus = column.name;
    const updatedRows = rows.map((row, index) => {
      if (index !== issue.rowIndex) return row;
      const rowData = row?.rowData || {};
      // Prepare new update for status change
      const prevUpdates = Array.isArray(rowData.updates) ? rowData.updates : [];
      const statusChangeUpdate = {
        text: `Status changed to ${nextStatus}`,
        percentCompleted: 0,
        date: new Date().toISOString(),
      };
      return {
        ...row,
        rowData: {
          ...rowData,
          [issue.statusField || "E2 Status Update"]: nextStatus,
          updates: [...prevUpdates, statusChangeUpdate],
        },
      };
    });

    setSavingIssueKey(issue.key);

    setProjectSources((previous) => ({
      ...previous,
      [issue.projectDocId]: {
        ...previous[issue.projectDocId],
        rows: updatedRows,
      },
    }));
    setIssues((previous) =>
      previous.map((item) => (item.key === issue.key ? { ...item, status: nextStatus } : item))
    );

    try {
      const projectRef = doc(db, "churches", id, "bimProjects", issue.projectDocId);
      await updateDoc(projectRef, { rows: updatedRows });
      toast.success(`Moved to ${nextStatus}.`);
    } catch (error) {
      toast.error("Could not move the issue. Please try again.");
      console.error("Error moving issue in Agile Dashboard:", error);
    } finally {
      setSavingIssueKey("");
      setDraggedIssueKey("");
    }
  };

  const [updateModal, setUpdateModal] = useState({ open: false, issue: null });
  const [newUpdate, setNewUpdate] = useState("");
  const [percentCompleted, setPercentCompleted] = useState("");
  const [latestUpdate, setLatestUpdate] = useState("");
  const [updateLoading, setUpdateLoading] = useState(false);

  // Fetch latest update and percent completed for a given issue
  const fetchLatestUpdate = (issue) => {
    const source = projectSources[issue.projectDocId];
    if (!source) return { text: "", percentCompleted: null, date: null };
    const row = source.rows[issue.rowIndex];
    if (!row) return { text: "", percentCompleted: null, date: null };
    const updates = row.rowData.updates;
    if (Array.isArray(updates) && updates.length > 0) {
      const last = updates[updates.length - 1];
      return {
        text: last.text || last.comment || JSON.stringify(last),
        percentCompleted: typeof last.percentCompleted === "number" ? last.percentCompleted : null,
        date: last.date || null
      };
    }
    return { text: row.rowData.update || "", percentCompleted: null, date: null };
  };

  if (loading) {
    return <div className="agile-dashboard-loading">Loading Agile Dashboard...</div>;
  }

  return (
    <div className="agile-dashboard-wrapper">
      <div className="agile-dashboard-header">
        <div className="agile-dashboard-header-top">
          <Link to={`/organization/${id}/project-issue-dashboard`} className="agile-dashboard-back-button">
            ← Back to Live Issues Tracker
          </Link>
          <h1>Agile Development Dashboard</h1>
        </div>
        <div style={{ marginTop: 16, marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Link
            to={`/organization/${id}/project-name-manager`}
            style={{
              display: 'inline-block',
              background: '#f59e0b',
              color: '#fff',
              padding: '10px 18px',
              borderRadius: 6,
              fontWeight: 600,
              textDecoration: 'none',
              width: 'fit-content',
            }}
          >
            Manage Project Name Values
          </Link>
        </div>
        <div className="agile-dashboard-filters">
          {/* Removed E2 Status Update Agile filter dropdown as requested */}
          <label className="agile-dashboard-filter-item" htmlFor="agile-project-filter">
            <span>Project Name</span>
            <select
              id="agile-project-filter"
              className="agile-dashboard-filter-select"
              value={selectedProjectName}
              onChange={(event) => setSelectedProjectName(event.target.value)}
            >
              <option value="All">All Projects</option>
              {projectNameOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="agile-dashboard-filter-item" htmlFor="agile-detailer-filter">
            <span>E2 Lead Detailer</span>
            <select
              id="agile-detailer-filter"
              className="agile-dashboard-filter-select"
              value={selectedE2LeadDetailer}
              onChange={(event) => setSelectedE2LeadDetailer(event.target.value)}
            >
              <option value="All">All E2 Lead Detailers</option>
              {e2LeadDetailerOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="agile-dashboard-filter-item" htmlFor="agile-data-stage-filter">
            <span>Data Stage</span>
            <select
              id="agile-data-stage-filter"
              className="agile-dashboard-filter-select"
              value={selectedDataStage}
              onChange={e => setSelectedDataStage(e.target.value)}
              style={{ minWidth: 120 }}
            >
              <option value="All">All</option>
              {DATA_STAGE_OPTIONS.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="agile-dashboard-board">
        {sortedColumns.map((column) => {
          let columnIssues = visibleIssues.filter((issue) => toPhaseId(issue.status) === column.id);
          // For To Do List column, only show issues where status is exactly 'To Do List'
          if (column.name === "To Do List") {
            columnIssues = columnIssues.filter((issue) => normalizeValue(issue.status) === "To Do List");
          }
          console.log(`[AgileDashboard] Rendering column: ${column.name} (id: ${column.id}), issues:`, columnIssues);
          return (
            <div key={column.id} className="agile-column">
              <div className="agile-column-header">
                <h2 className="agile-column-title">{column.name}</h2>
              </div>

              <div
                className="agile-column-content"
                onDragOver={handleDragOver}
                onDrop={() => handleDrop(column)}
              >
                {columnIssues.map((issue) => {
                  // Find latest percentCompleted from updates
                  let percentCompleted = null;
                  const source = projectSources[issue.projectDocId];
                  if (source) {
                    const row = source.rows[issue.rowIndex];
                    if (row && Array.isArray(row.rowData.updates) && row.rowData.updates.length > 0) {
                      const last = row.rowData.updates[row.rowData.updates.length - 1];
                      if (typeof last.percentCompleted === 'number') {
                        percentCompleted = last.percentCompleted;
                      }
                    }
                  }
                  return (
                    <div
                      key={issue.key}
                      className={`agile-card${savingIssueKey === issue.key ? " is-saving" : ""}`}
                      draggable={savingIssueKey !== issue.key}
                      onDragStart={() => handleDragStart(issue.key)}
                    >
                      <div className="agile-card-header">
                        <div className="agile-card-field-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Link
                            className="agile-card-issue-id"
                            to={`/organization/${id}/project-issue-dashboard/issue/${issue.projectDocId}/${issue.issueId}`}
                            style={{ color: '#2563eb', textDecoration: 'underline', cursor: 'pointer' }}
                          >
                            {normalizeValue(issue.issueId) || "-"}
                          </Link>
                          <a
                            href="#"
                            style={{ color: '#6366f1', textDecoration: 'underline', cursor: 'pointer', fontSize: 13, marginLeft: 8 }}
                            onClick={e => {
                              e.preventDefault();
                              setUpdateModal({ open: true, issue });
                              setNewUpdate("");
                              const latest = fetchLatestUpdate(issue);
                              setPercentCompleted("");
                              setLatestUpdate(latest);
                            }}
                          >Add Update</a>
                        </div>
                        <div className="agile-card-field-row">
                          <span className="agile-card-label">Project Name:</span>
                          <span className="agile-card-project-name" style={{ marginLeft: 4 }}>{normalizeValue(issue.projectName) || "-"}</span>
                        </div>
                        <div className="agile-card-field-row">
                          <span className="agile-card-label">Title:</span>
                          <span className="agile-card-title" style={{ marginLeft: 4 }}>{normalizeValue(issue.title) || "-"}</span>
                        </div>
                        <div className="agile-card-field-row">
                          <span className="agile-card-label">Lead Detailer:</span>
                          <span className="agile-card-detailer" style={{ marginLeft: 4 }}>{normalizeValue(issue.e3LeadDetailer) || "-"}</span>
                        </div>
                        <div className="agile-card-field-row">
                          <span className="agile-card-label">Data Stage:</span>
                          <span className="agile-card-data-stage" style={{ marginLeft: 4 }}>{normalizeValue(issue.dataStage) || "-"}</span>
                        </div>
                        <div className="agile-card-field-row">
                          <span className="agile-card-label">Technical Direction:</span>
                          <span className="agile-card-technical-direction" style={{ marginLeft: 4, fontWeight: 500, color: '#7c3aed', fontSize: '0.95em' }}>
                            {issue.technicalDirection || "-"}
                          </span>
                        </div>
                      </div>

                      {/* Percent Completed Bar */}
                      <div style={{ margin: '12px 0 0 0', padding: 0 }}>
                        <div style={{
                          width: '100%',
                          height: '18px',
                          background: '#e5e7eb',
                          borderRadius: '8px',
                          overflow: 'hidden',
                          position: 'relative',
                          boxShadow: '0 1px 2px #0001',
                        }}>
                          <div style={{
                            width: percentCompleted !== null ? `${Math.max(0, Math.min(percentCompleted, 100))}%` : '0%',
                            height: '100%',
                            background: 'linear-gradient(90deg, #22c55e 60%, #16a34a 100%)',
                            transition: 'width 0.5s cubic-bezier(.4,2,.6,1)',
                          }} />
                          <span style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            width: '100%',
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 600,
                            color: percentCompleted !== null && percentCompleted > 50 ? '#fff' : '#166534',
                            fontSize: '0.92em',
                            letterSpacing: '0.01em',
                            textShadow: percentCompleted !== null && percentCompleted > 50 ? '0 1px 2px #0006' : 'none',
                          }}>
                            {percentCompleted !== null ? `${percentCompleted}% Completed` : '0% Completed'}
                          </span>
                        </div>
                      </div>

                      {/* Removed Add Update link from bottom, now at top right */}
                    </div>
                  );
                })}
              </div>

              <div className="agile-column-footer">
                <span className="agile-column-card-count">{columnIssues.length} cards</span>
              </div>
            </div>
          );
        })}
      </div>
      <AgileUpdateModal
        isOpen={updateModal.open}
        onClose={() => setUpdateModal({ open: false, issue: null })}
        latestUpdate={latestUpdate}
        newUpdate={newUpdate}
        onChange={setNewUpdate}
        percentCompleted={percentCompleted}
        onPercentChange={setPercentCompleted}
        loading={updateLoading}
        onSave={async () => {
          if (!updateModal.issue || !newUpdate.trim()) return;
          setUpdateLoading(true);
          try {
            const { issue } = updateModal;
            const source = projectSources[issue.projectDocId];
            if (!source) return;
            const rows = Array.isArray(source.rows) ? source.rows : [];
            const targetRow = rows[issue.rowIndex];
            if (!targetRow) return;
            const prevUpdates = Array.isArray(targetRow.rowData.updates) ? targetRow.rowData.updates : [];
            const newEntry = {
              date: new Date().toISOString(),
              text: newUpdate.trim(),
              percentCompleted: percentCompleted === "" ? null : Number(percentCompleted)
            };
            const updatedRow = {
              ...targetRow,
              rowData: {
                ...targetRow.rowData,
                updates: [...prevUpdates, newEntry],
              },
            };
            const updatedRows = rows.map((row, idx) => idx === issue.rowIndex ? updatedRow : row);
            await updateDoc(doc(db, "churches", id, "bimProjects", issue.projectDocId), { rows: updatedRows });
            setLatestUpdate({ text: newEntry.text, percentCompleted: newEntry.percentCompleted, date: newEntry.date });
            setNewUpdate("");
            setPercentCompleted("");
            setUpdateModal({ open: false, issue: null });
          } finally {
            setUpdateLoading(false);
          }
        }}
      />
    </div>
  );
};

export default AgileDevelopmentDashboard;
