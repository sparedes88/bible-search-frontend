// Removed feature flag: always use new Firestore subcollection for issues
import AgileDevelopmentDashboard from "../components/AgileDevelopmentDashboard";
import { useEffect, useState } from "react";
import AgileUpdateModal from "../components/AgileUpdateModal";
import { useParams } from "react-router-dom";
import { collection, onSnapshot, doc, updateDoc, getDocs } from "firebase/firestore";
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
  const [percentCompleted, setPercentCompleted] = useState(0);
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
    let unsubscribers = [];
    const unsubscribeProjects = onSnapshot(projectsRef, (snapshot) => {
      // Remove previous listeners
      unsubscribers.forEach((unsub) => unsub());
      unsubscribers = [];
      const nextIssues = [];
      const nextProjectSources = {};
      snapshot.docs.forEach((projectDoc) => {
        const projectData = projectDoc.data() || {};
        const fields = Array.isArray(projectData.fields) ? projectData.fields : [];
        const issuesRef = collection(db, "churches", id, "bimProjects", projectDoc.id, "issues");
        // Listen to issues in real-time
        const unsubIssues = onSnapshot(issuesRef, (issuesSnap) => {
          const issues = issuesSnap.docs.map((issueDoc) => {
            const rowData = issueDoc.data() || {};
            const issueIdField = findFieldByAliases(fields, rowData, ISSUE_ID_ALIASES);
            const statusAgileField = findFieldByAliases(fields, rowData, E2_STATUS_AGILE_ALIASES) || "E2 Status Update Agile";
            const leadDetailerField = findFieldByAliases(fields, rowData, LEAD_DETAILER_ALIASES);
            const technicalDirectionField = findFieldByAliases(fields, rowData, TECHNICAL_DIRECTION_ALIASES) || "Technical Direction";
            const disableFlagField = findFieldByAliases(fields, rowData, DISABLE_FLAG_ALIASES) || "Disable Flag";
            const projectNameField = findFieldByAliases(fields, rowData, ["project name", "project", "projectname"]);
            const projectName = normalizeValue(projectNameField ? rowData[projectNameField] : "");
            const issueId = issueDoc.id; // Use Firestore document ID
            const statusAgile = normalizeValue(statusAgileField ? rowData[statusAgileField] : "");
            const leadDetailer = normalizeValue(leadDetailerField ? rowData[leadDetailerField] : "");
            const technicalDirection = normalizeValue(technicalDirectionField ? rowData[technicalDirectionField] : "");
            const disableFlag = normalizeValue(disableFlagField ? rowData[disableFlagField] : "No");
            const dataStageField = findFieldByAliases(fields, rowData, DATA_STAGE_ALIASES) || "Data Stage";
            const dataStage = normalizeValue(dataStageField ? rowData[dataStageField] : "") || DEFAULT_DATA_STAGE;
            return {
              key: `${projectDoc.id}-${issueDoc.id}`,
              projectDocId: projectDoc.id,
              statusField: statusAgileField,
              technicalDirectionField,
              disableFlagField,
              projectNameField,
              issueId, // Firestore doc ID
              statusAgile,
              leadDetailer,
              technicalDirection,
              disableFlag,
              dataStageField,
              dataStage,
              projectName,
            };
          });
          nextProjectSources[projectDoc.id] = { fields, rows: issues };
          nextIssues.push(...issues);
          setProjectSources({ ...nextProjectSources });
          setIssues([...nextIssues]);
        });
        unsubscribers.push(unsubIssues);
      });
    });
    return () => {
      unsubscribeProjects();
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [id]);

  return (
    <div className="agile-board-page">
      <AgileDevelopmentDashboard />
    <AgileUpdateModal
      isOpen={updateModal.open}
      onClose={() => {
        setUpdateModal({ open: false, issue: null });
        setNewUpdate("");
        setPercentCompleted(0);
      }}
      latestUpdate={latestUpdate}
      newUpdate={newUpdate}
      onChange={setNewUpdate}
      percentCompleted={percentCompleted}
      onPercentChange={setPercentCompleted}
      loading={updateLoading}
      onSave={async (pc) => {
        console.log("[AgileBoardPage] onSave called", { issue: updateModal.issue, newUpdate, percentCompleted: pc });
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
          const now = new Date().toISOString();
          const newEntry = { date: now, text: newUpdate.trim(), percentCompleted: pc };
          const updatedRow = {
            ...targetRow,
            rowData: {
              ...targetRow.rowData,
              updates: [...prevUpdates, newEntry],
            },
          };
          const updatedRows = rows.map((row, idx) => idx === issue.rowIndex ? updatedRow : row);
          await updateDoc(doc(db, "churches", id, "bimProjects", issue.projectDocId), { rows: updatedRows });

          // --- Also update the log structure in internalCardMeta for ProjectIssueDetail ---
          // Compute cardKey as in ProjectIssueDetail (shared logic)
          const normalizeCardKey = (id, rowNumber) => {
            const norm = String(id || "").trim().toUpperCase();
            return norm ? `id:${norm}` : `row:${rowNumber}`;
          };
          const cardKey = normalizeCardKey(issue.issueId, issue.rowIndex);
          const projectDocRef = doc(db, "churches", id, "bimProjects", issue.projectDocId);
          const projectDocSnap = await (await import("firebase/firestore")).getDoc(projectDocRef);
          const projectDocData = projectDocSnap.data ? projectDocSnap.data() : {};
          const internalCardMeta = projectDocData.internalCardMeta || {};
          internalCardMeta[cardKey] = internalCardMeta[cardKey] || {};
          const prevLog = Array.isArray(internalCardMeta[cardKey].logEntries) ? internalCardMeta[cardKey].logEntries : [];
          const logEntry = {
            update: newUpdate.trim(),
            percent: Number(pc) || 0,
            timestamp: now,
          };
          const nextLog = [logEntry, ...prevLog];
          internalCardMeta[cardKey].logEntries = nextLog;
          console.log("[AgileBoardPage] Writing log entry", { cardKey, logEntry, nextLog });
          try {
            await updateDoc(projectDocRef, { internalCardMeta });
          } catch (err) {
            console.error("[AgileBoardPage] Error updating log in Firestore", err);
          }

          setLatestUpdate(newEntry.text);
          setNewUpdate("");
          setPercentCompleted(0);
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
