import { useEffect, useState } from "react";
import AgileUpdateModal from "../components/AgileUpdateModal";
import { useParams } from "react-router-dom";
import { collection, onSnapshot, doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { DEFAULT_E2_STATUS_UPDATE_AGILE_OPTIONS, E2_STATUS_UPDATE_AGILE_OPTIONS_FIELD, PROJECT_ISSUE_CONFIG_DOC_ID } from "../components/projectIssueConstants";

// Technical Direction dropdown options (customized per user request)
const DEFAULT_TECHNICAL_DIRECTION_OPTIONS = [
  "Stop and Start",
  "Steer with current task",
  "Add to Queue"
];

const normalizeValue = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const findFieldByAliases = (fields = [], rowData = {}, aliases = []) => {
  const normalizedAliases = aliases.map((alias) => normalizeValue(alias).toLowerCase().replace(/[^a-z0-9]+/g, ""));
  const candidates = [...(Array.isArray(fields) ? fields : []), ...Object.keys(rowData || {})];
  for (const candidate of candidates) {
    const key = normalizeValue(candidate).toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (normalizedAliases.includes(key)) {
      return candidate;
    }
  }
  for (const aliasKey of normalizedAliases) {
    const startsWith = candidates.find((candidate) => normalizeValue(candidate).toLowerCase().replace(/[^a-z0-9]+/g, "").startsWith(aliasKey));
    if (startsWith) return startsWith;
    const includes = candidates.find((candidate) => normalizeValue(candidate).toLowerCase().replace(/[^a-z0-9]+/g, "").includes(aliasKey));
    if (includes) return includes;
  }
  return null;
};

const ISSUE_ID_ALIASES = ["issue id", "id", "task id", "card id", "row id"];
const E2_STATUS_AGILE_ALIASES = ["e2 status update agile", "e2statusupdateagile"];
const LEAD_DETAILER_ALIASES = [
  "e3 lead detailer",
  "e3leaddetailer",
  "e2 lead detailer",
  "e2leaddetailer",
  "e2 detailer",
  "e2detailer",
];
const DISABLE_FLAG_ALIASES = ["disable flag", "disableflag"];
const DISABLE_FLAG_OPTIONS = ["No", "Yes"];

const TECHNICAL_DIRECTION_ALIASES = [
  "technical direction",
  "tech direction",
  "technicaldirection",
  "techdirection"
];

const DATA_STAGE_ALIASES = ["data stage", "datastage"];
const DATA_STAGE_OPTIONS = ["Testing", "Production"];
const DEFAULT_DATA_STAGE = "Testing";

const PROJECT_NAME_VALUES_FIELD = "projectNameValues";

const AgileBoardPage = () => {
  const { id } = useParams();
  const [issues, setIssues] = useState([]);
  const [projectSources, setProjectSources] = useState({});
  const [savingKey, setSavingKey] = useState("");
  const [updateModal, setUpdateModal] = useState({ open: false, issue: null });
  const [newUpdate, setNewUpdate] = useState("");
  const [latestUpdate, setLatestUpdate] = useState("");
  const [updateLoading, setUpdateLoading] = useState(false);
    // Fetch latest update for a given issue
    const fetchLatestUpdate = (issue) => {
      // Assume updates are stored in rowData.updates as an array of {date, text} objects, or as a string field 'update' (fallback)
      const source = projectSources[issue.projectDocId];
      if (!source) return "";
      const row = source.rows[issue.rowIndex];
      if (!row) return "";
      const updates = row.rowData.updates;
      if (Array.isArray(updates) && updates.length > 0) {
        const last = updates[updates.length - 1];
        return last.text || last.comment || JSON.stringify(last);
      }
      // Fallback: single update string
      return row.rowData.update || "";
    };
  const [agileStatusOptions, setAgileStatusOptions] = useState(DEFAULT_E2_STATUS_UPDATE_AGILE_OPTIONS);
  const [technicalDirectionOptions, setTechnicalDirectionOptions] = useState(DEFAULT_TECHNICAL_DIRECTION_OPTIONS);
  const [firestoreProjectNameValues, setFirestoreProjectNameValues] = useState([]);
  useEffect(() => {
    if (!id) return;
    const configRef = doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID);
    const unsubscribe = onSnapshot(configRef, (snapshot) => {
      const data = snapshot.data() || {};
      const values = Array.isArray(data[PROJECT_NAME_VALUES_FIELD]) ? data[PROJECT_NAME_VALUES_FIELD] : [];
      setFirestoreProjectNameValues(values);
    });
    return () => unsubscribe();
  }, [id]);

  // Merge Firestore projectNameValues and unique Project Name values from issues
  const mergedProjectNameOptions = (() => {
    const issueProjectNames = Array.from(new Set(issues.map((issue) => normalizeValue(issue.projectName)).filter(Boolean)));
    const all = [...firestoreProjectNameValues, ...issueProjectNames];
    // Deduplicate and sort
    return Array.from(new Set(all)).sort((a, b) => a.localeCompare(b));
  })();
  // Load E2 Status Update Agile dropdown options from Firestore settings
    // Extract Technical Direction field from each issue
  useEffect(() => {
    if (!id) return;
    const configRef = doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID);
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
    if (!id) return;
    const projectsRef = collection(db, "churches", id, "bimProjects");
    const unsubscribe = onSnapshot(projectsRef, (snapshot) => {
      const nextIssues = [];
      const nextProjectSources = {};
      snapshot.forEach((projectDoc) => {
        const projectData = projectDoc.data() || {};
        const fields = Array.isArray(projectData.fields) ? projectData.fields : [];
        const rows = Array.isArray(projectData.rows) ? projectData.rows : [];
        nextProjectSources[projectDoc.id] = { fields, rows };
        rows.forEach((row, rowIndex) => {
          const rowData = row?.rowData || {};
          const issueIdField = findFieldByAliases(fields, rowData, ISSUE_ID_ALIASES);
          const statusAgileField = findFieldByAliases(fields, rowData, E2_STATUS_AGILE_ALIASES) || "E2 Status Update Agile";
          const leadDetailerField = findFieldByAliases(fields, rowData, LEAD_DETAILER_ALIASES);
          const technicalDirectionField = findFieldByAliases(fields, rowData, TECHNICAL_DIRECTION_ALIASES) || "Technical Direction";
          const disableFlagField = findFieldByAliases(fields, rowData, DISABLE_FLAG_ALIASES) || "Disable Flag";
          const projectNameField = findFieldByAliases(fields, rowData, ["project name", "project", "projectname"]);
          const projectName = normalizeValue(projectNameField ? rowData[projectNameField] : "");
          const issueId = normalizeValue(issueIdField ? rowData[issueIdField] : "") || String(row?.rowNumber || rowIndex + 1);
          const statusAgile = normalizeValue(statusAgileField ? rowData[statusAgileField] : "");
          const leadDetailer = normalizeValue(leadDetailerField ? rowData[leadDetailerField] : "");
          const technicalDirection = normalizeValue(technicalDirectionField ? rowData[technicalDirectionField] : "");
          const disableFlag = normalizeValue(disableFlagField ? rowData[disableFlagField] : "No");
          const dataStageField = findFieldByAliases(fields, rowData, DATA_STAGE_ALIASES) || "Data Stage";
          const dataStage = normalizeValue(dataStageField ? rowData[dataStageField] : "") || DEFAULT_DATA_STAGE;

          // Debug: Log updates array for SRF-3632
          if (issueId === "SRF-3632") {
            // eslint-disable-next-line no-console
            console.log("[DEBUG] Issue SRF-3632 updates:", rowData.updates);
          }

          nextIssues.push({
            key: `${projectDoc.id}-${row?.rowNumber ?? "row"}-${rowIndex}`,
            projectDocId: projectDoc.id,
            rowIndex,
            statusField: statusAgileField,
            technicalDirectionField,
            disableFlagField,
            projectNameField,
            issueId,
            statusAgile,
            leadDetailer,
            technicalDirection,
            disableFlag,
            dataStageField,
            dataStage,
            projectName,
          });
        });
      });
      setProjectSources(nextProjectSources);
      setIssues(nextIssues);
    });
    return () => unsubscribe();
  }, [id]);

  return (
    <div className="agile-board-page">
      <AgileDevelopmentDashboard />
      <div className="agile-board-issue-grid" style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: 12 }}>Issue Records</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 8, boxShadow: "0 2px 8px #0001" }}>
          <thead>
            <tr style={{ background: "#f3f4f6" }}>
              <th style={{ padding: 8, borderBottom: "1px solid #e5e7eb" }}>ID</th>
              <th style={{ padding: 8, borderBottom: "1px solid #e5e7eb" }}>Project Name</th>
              <th style={{ padding: 8, borderBottom: "1px solid #e5e7eb" }}>E2 Status Update Agile</th>
              <th style={{ padding: 8, borderBottom: "1px solid #e5e7eb" }}>E2 Detailer</th>
              <th style={{ padding: 8, borderBottom: "1px solid #e5e7eb" }}>Technical Direction</th>
              <th style={{ padding: 8, borderBottom: "1px solid #e5e7eb" }}>Disable Flag</th>
              <th style={{ padding: 8, borderBottom: "1px solid #e5e7eb" }}>Data Stage</th>
            </tr>
          </thead>
          <tbody>
            {issues.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", padding: 16, color: "#888" }}>No issues found.</td>
              </tr>
            ) : (
              issues.map((issue) => (
                <tr key={issue.key}>
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{issue.issueId}</td>

                  <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                    <select
                      value={issue.projectName || ''}
                      style={{ width: "100%", padding: 4, borderRadius: 4, border: "1px solid #d1d5db", background: savingKey === issue.key ? "#f3f4f6" : undefined }}
                      disabled={savingKey === issue.key}
                      onChange={async (e) => {
                        const newValue = e.target.value;
                        setSavingKey(issue.key);
                        try {
                          const source = projectSources[issue.projectDocId];
                          if (!source) return;
                          const rows = Array.isArray(source.rows) ? source.rows : [];
                          const targetRow = rows[issue.rowIndex];
                          if (!targetRow) return;
                          const updatedRows = rows.map((row, idx) => {
                            if (idx !== issue.rowIndex) return row;
                            return {
                              ...row,
                              rowData: {
                                ...row.rowData,
                                [issue.projectNameField || "Project Name"]: newValue,
                              },
                            };
                          });
                          await updateDoc(doc(db, "churches", id, "bimProjects", issue.projectDocId), { rows: updatedRows });
                        } finally {
                          setSavingKey("");
                        }
                      }}
                    >
                      <option value="">-- Select Project Name --</option>
                      {mergedProjectNameOptions.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                    <select
                      value={issue.statusAgile || ""}
                      style={{ width: "100%", padding: 4, borderRadius: 4, border: "1px solid #d1d5db", background: savingKey === issue.key ? "#f3f4f6" : undefined }}
                      disabled={savingKey === issue.key}
                      onChange={async (e) => {
                        const newValue = e.target.value;
                        setSavingKey(issue.key);
                        try {
                          const source = projectSources[issue.projectDocId];
                          if (!source) return;
                          const rows = Array.isArray(source.rows) ? source.rows : [];
                          const targetRow = rows[issue.rowIndex];
                          if (!targetRow) return;
                          const updatedRows = rows.map((row, idx) => {
                            if (idx !== issue.rowIndex) return row;
                            return {
                              ...row,
                              rowData: {
                                ...row.rowData,
                                [issue.statusField]: newValue,
                              },
                            };
                          });
                          await updateDoc(doc(db, "churches", id, "bimProjects", issue.projectDocId), { rows: updatedRows });
                        } finally {
                          setSavingKey("");
                        }
                      }}
                    >
                      <option value="">-- Select Status --</option>
                      {agileStatusOptions.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{issue.leadDetailer}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{issue.technicalDirection}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                    <select
                      value={issue.disableFlag || "No"}
                      style={{ width: "100%", padding: 4, borderRadius: 4, border: "1px solid #d1d5db", background: savingKey === issue.key ? "#f3f4f6" : undefined }}
                      disabled={savingKey === issue.key}
                      onChange={async (e) => {
                        const newValue = e.target.value;
                        setSavingKey(issue.key);
                        try {
                          const source = projectSources[issue.projectDocId];
                          if (!source) return;
                          const rows = Array.isArray(source.rows) ? source.rows : [];
                          const targetRow = rows[issue.rowIndex];
                          if (!targetRow) return;
                          const updatedRows = rows.map((row, idx) => {
                            if (idx !== issue.rowIndex) return row;
                            return {
                              ...row,
                              rowData: {
                                ...row.rowData,
                                [issue.disableFlagField]: newValue,
                              },
                            };
                          });
                          await updateDoc(doc(db, "churches", id, "bimProjects", issue.projectDocId), { rows: updatedRows });
                        } finally {
                          setSavingKey("");
                        }
                      }}
                    >
                      {DISABLE_FLAG_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                    <select
                      value={issue.dataStage || DEFAULT_DATA_STAGE}
                      style={{ width: "100%", padding: 4, borderRadius: 4, border: "1px solid #d1d5db", background: savingKey === issue.key ? "#f3f4f6" : undefined }}
                      disabled={savingKey === issue.key}
                      onChange={async (e) => {
                        const newValue = e.target.value;
                        setSavingKey(issue.key);
                        try {
                          const source = projectSources[issue.projectDocId];
                          if (!source) return;
                          const rows = Array.isArray(source.rows) ? source.rows : [];
                          const targetRow = rows[issue.rowIndex];
                          if (!targetRow) return;
                          const updatedRows = rows.map((row, idx) => {
                            if (idx !== issue.rowIndex) return row;
                            return {
                              ...row,
                              rowData: {
                                ...row.rowData,
                                [issue.dataStageField]: newValue,
                              },
                            };
                          });
                          await updateDoc(doc(db, "churches", id, "bimProjects", issue.projectDocId), { rows: updatedRows });
                        } finally {
                          setSavingKey("");
                        }
                      }}
                    >
                      {DATA_STAGE_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    <AgileUpdateModal
      isOpen={updateModal.open}
      onClose={() => setUpdateModal({ open: false, issue: null })}
      latestUpdate={latestUpdate}
      newUpdate={newUpdate}
      onChange={setNewUpdate}
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
          // Append to updates array in rowData
          const prevUpdates = Array.isArray(targetRow.rowData.updates) ? targetRow.rowData.updates : [];
          const newEntry = { date: new Date().toISOString(), text: newUpdate.trim() };
          const updatedRow = {
            ...targetRow,
            rowData: {
              ...targetRow.rowData,
              updates: [...prevUpdates, newEntry],
            },
          };
          const updatedRows = rows.map((row, idx) => idx === issue.rowIndex ? updatedRow : row);
          await updateDoc(doc(db, "churches", id, "bimProjects", issue.projectDocId), { rows: updatedRows });
          setLatestUpdate(newEntry.text);
          setNewUpdate("");
          setUpdateModal({ open: false, issue: null });
        } finally {
          setUpdateLoading(false);
        }
      }}
    />
    </div>
  );
};

export default AgileBoardPage;
import AgileDevelopmentDashboard from "../components/AgileDevelopmentDashboard";
