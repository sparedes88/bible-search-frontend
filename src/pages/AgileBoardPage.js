
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, onSnapshot, doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { DEFAULT_E2_STATUS_UPDATE_AGILE_OPTIONS, E2_STATUS_UPDATE_AGILE_OPTIONS_FIELD, PROJECT_ISSUE_CONFIG_DOC_ID } from "../components/projectIssueConstants";

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


const AgileBoardPage = () => {
  const { id } = useParams();
  const [issues, setIssues] = useState([]);
  const [projectSources, setProjectSources] = useState({});
  const [savingKey, setSavingKey] = useState("");
  const [agileStatusOptions, setAgileStatusOptions] = useState(DEFAULT_E2_STATUS_UPDATE_AGILE_OPTIONS);
  // Load E2 Status Update Agile dropdown options from Firestore settings
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
          const issueId = normalizeValue(issueIdField ? rowData[issueIdField] : "") || String(row?.rowNumber || rowIndex + 1);
          const statusAgile = normalizeValue(statusAgileField ? rowData[statusAgileField] : "");
          const leadDetailer = normalizeValue(leadDetailerField ? rowData[leadDetailerField] : "");
          nextIssues.push({
            key: `${projectDoc.id}-${row?.rowNumber ?? "row"}-${rowIndex}`,
            projectDocId: projectDoc.id,
            rowIndex,
            statusField: statusAgileField,
            issueId,
            statusAgile,
            leadDetailer,
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
              <th style={{ padding: 8, borderBottom: "1px solid #e5e7eb" }}>E2 Status Update Agile</th>
              <th style={{ padding: 8, borderBottom: "1px solid #e5e7eb" }}>E2 Detailer</th>
            </tr>
          </thead>
          <tbody>
            {issues.length === 0 ? (
              <tr>
                <td colSpan={3} style={{ textAlign: "center", padding: 16, color: "#888" }}>No issues found.</td>
              </tr>
            ) : (
              issues.map((issue) => (
                <tr key={issue.key}>
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{issue.issueId}</td>
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
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AgileBoardPage;
import AgileDevelopmentDashboard from "../components/AgileDevelopmentDashboard";
