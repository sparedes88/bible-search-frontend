import React, { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { collection, doc, onSnapshot, updateDoc } from "firebase/firestore";
import { toast } from "react-toastify";
import { db } from "../firebase";
import {
  DEFAULT_E2_STATUS_UPDATE,
  DEFAULT_E2_STATUS_UPDATE_OPTIONS,
  E2_STATUS_UPDATE_OPTIONS_FIELD,
  PROJECT_ISSUE_CONFIG_DOC_ID,
  DEFAULT_E2_STATUS_UPDATE_AGILE_OPTIONS,
  E2_STATUS_UPDATE_AGILE_OPTIONS_FIELD,
} from "./projectIssueConstants";
import "./AgileDevelopmentDashboard.css";

const normalizeValue = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

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
  const DATA_STAGE_OPTIONS = ["Testing", "Production"];

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
            const projectName = normalizeValue(projectNameField ? rowData[projectNameField] : "") || defaultProjectName;
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

  const projectNameOptions = useMemo(
    () => dedupeValues(issues.map((issue) => normalizeValue(issue.projectName))),
    [issues]
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
      return {
        ...row,
        rowData: {
          ...rowData,
          [issue.statusField || "E2 Status Update"]: nextStatus,
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
                  console.log(`[AgileDashboard] Card in column ${column.name}:`, issue);
                  return (
                    <div
                      key={issue.key}
                      className={`agile-card${savingIssueKey === issue.key ? " is-saving" : ""}`}
                      draggable={savingIssueKey !== issue.key}
                      onDragStart={() => handleDragStart(issue.key)}
                    >
                      <div className="agile-card-header">
                        <div className="agile-card-field-row">
                          <Link
                            className="agile-card-issue-id"
                            to={`/organization/${id}/project-issue-dashboard/issue/${issue.projectDocId}/${issue.issueId}`}
                            style={{ color: '#2563eb', textDecoration: 'underline', cursor: 'pointer' }}
                          >
                            {normalizeValue(issue.issueId) || "-"}
                          </Link>
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
    </div>
  );
};

export default AgileDevelopmentDashboard;
