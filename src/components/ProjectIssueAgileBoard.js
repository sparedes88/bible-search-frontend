import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, doc, onSnapshot, updateDoc } from "firebase/firestore";
import { toast } from "react-toastify";
import ChurchHeader from "./ChurchHeader";
import commonStyles from "../pages/commonStyles";
import { db } from "../firebase";
import "./ProjectIssueAgileBoard.css";

const E2_STATUS_UPDATE_FIELD = "E2 Status Update";
const E2_STATUS_DATE_FIELD = "E2 Status Date";
const E2_DETAILER_FIELD = "E2 Lead Detailer";
const E2_DETAILER_SUPPORT_TEAM_FIELD = "E2 Detailer Support Team";
const TECH_DETAILS_FIELD = "Technical Details Available";
const FIXED_BOARD_COLUMNS = ["Received", "Ready to Start", "In Progress", "Completed"];

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

const formatTimestamp = (value) => {
  if (!value) return "";
  const date =
    value instanceof Date
      ? value
      : typeof value?.toDate === "function"
        ? value.toDate()
        : new Date(value);

  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const yy = String(date.getFullYear()).slice(-2);
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${mm}/${dd}/${yy} ${hh}:${min}`;
};

const getNowMMDDYYTime = () => {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${mm}/${dd}/${yy} ${hh}:${min}:${ss}`;
};

const parseSupportTeamValues = (value) => {
  const rawValues = Array.isArray(value) ? value : String(value || "").split(/[,;|]/);
  const seen = new Set();

  return rawValues
    .map((item) => normalizeValue(item))
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const isTechDetailsYes = (value) => {
  const normalized = normalizeValue(value).toLowerCase();
  return ["yes", "y", "true", "1"].includes(normalized);
};

const hasReadyToStartRequirements = (issue) => {
  const hasDetailer = Boolean(normalizeValue(issue?.e2Detailer));
  const hasSupportTeam = parseSupportTeamValues(issue?.e2DetailerSupportTeam).length > 0;
  const hasTechDetails = isTechDetailsYes(issue?.techDetailsAvailable);
  return hasDetailer && hasSupportTeam && hasTechDetails;
};

const deriveBoardStatus = (issue) => {
  const rawStatus = normalizeValue(issue?.e2StatusUpdate).toLowerCase();

  if (rawStatus === "completed") return "Completed";
  if (rawStatus === "in progress") return "In Progress";
  if (hasReadyToStartRequirements(issue)) return "Ready to Start";
  return "Received";
};

const getIssuePreview = (rowData = {}, fields = []) => {
  const titleField = findFieldByAliases(fields, rowData, ["title", "task title", "name"]);
  const issueIdField = findFieldByAliases(fields, rowData, ["issue id", "id", "task id", "card id", "row id"]);
  const projectNameField = findFieldByAliases(fields, rowData, ["project name", "projectname"]);
  const ownerField = findFieldByAliases(fields, rowData, ["assignee", "assigned to", "owner", "responsible"]);
  const priorityField = findFieldByAliases(fields, rowData, ["priority"]);
  const statusField = findFieldByAliases(fields, rowData, ["status", "state", "task status"]);
  const e2StatusField = findFieldByAliases(fields, rowData, ["e2 status update", "e2statusupdate"]);
  const e2DateField = findFieldByAliases(fields, rowData, ["e2 status date", "e2statusdate", "status update date"]);
  const e2DetailerField = findFieldByAliases(fields, rowData, ["e2 lead detailer", "e2leaddetailer", "e2 detailer"]);
  const e2DetailerSupportTeamField = findFieldByAliases(
    fields,
    rowData,
    ["e2 detailer support team", "e2 detailer support", "e2 support team", "support team"]
  );
  const techDetailsField = findFieldByAliases(fields, rowData, ["technical details available", "technical details", "techdetailsavailable"]);
  const snapshotField = findFieldByAliases(fields, rowData, ["snapshot url", "snapshoturl", "snapshot", "picture", "photo", "image"]);
  const markupLinkField = findFieldByAliases(fields, rowData, ["link to markup", "markup link", "markup", "image link", "url"]);

  return {
    issueId: normalizeValue(issueIdField ? rowData[issueIdField] : ""),
    title: normalizeValue(titleField ? rowData[titleField] : "") || "Untitled issue",
    projectName: normalizeValue(projectNameField ? rowData[projectNameField] : ""),
    owner: normalizeValue(ownerField ? rowData[ownerField] : "") || "Unassigned",
    priority: normalizeValue(priorityField ? rowData[priorityField] : "") || "-",
    status: normalizeValue(statusField ? rowData[statusField] : "") || "Open",
    e2StatusUpdate: normalizeValue(e2StatusField ? rowData[e2StatusField] : "") || "Received",
    e2StatusDate: normalizeValue(e2DateField ? rowData[e2DateField] : ""),
    e2Detailer: normalizeValue(e2DetailerField ? rowData[e2DetailerField] : ""),
    e2DetailerSupportTeam: normalizeValue(e2DetailerSupportTeamField ? rowData[e2DetailerSupportTeamField] : ""),
    techDetailsAvailable: normalizeValue(techDetailsField ? rowData[techDetailsField] : "No") || "No",
    snapshotUrl: normalizeValue(snapshotField ? rowData[snapshotField] : ""),
    markupLink: normalizeValue(markupLinkField ? rowData[markupLinkField] : ""),
  };
};

const ProjectIssueAgileBoard = () => {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [issues, setIssues] = useState([]);
  const [projectSources, setProjectSources] = useState({});
  const [searchText, setSearchText] = useState("");
  const [savingIssueKeys, setSavingIssueKeys] = useState({});
  const [draggingIssueKey, setDraggingIssueKey] = useState("");

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
          const fields = Array.isArray(projectData.fields) ? projectData.fields : [];
          const rows = Array.isArray(projectData.rows) ? projectData.rows : [];
          const projectName = normalizeValue(projectData.name) || projectDoc.id;

          nextProjectSources[projectDoc.id] = { fields, rows };

          rows.forEach((row, rowIndex) => {
            const rowData = row?.rowData || {};
            const preview = getIssuePreview(rowData, fields);
            nextIssues.push({
              key: `${projectDoc.id}-${row?.rowNumber ?? "row"}-${rowIndex}`,
              projectDocId: projectDoc.id,
              rowIndex,
              issueId: preview.issueId || String(row?.rowNumber || rowIndex + 1),
              title: preview.title,
              projectName: preview.projectName || projectName,
              owner: preview.owner,
              priority: preview.priority,
              status: preview.status,
              e2StatusUpdate: preview.e2StatusUpdate,
              e2StatusDate: preview.e2StatusDate,
              e2Detailer: preview.e2Detailer,
              e2DetailerSupportTeam: preview.e2DetailerSupportTeam,
              techDetailsAvailable: preview.techDetailsAvailable,
              snapshotUrl: preview.snapshotUrl,
              cardImageUrl: preview.snapshotUrl || preview.markupLink || "",
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

  const filteredIssues = useMemo(() => {
    const query = normalizeValue(searchText).toLowerCase();
    if (!query) return issues;

    return issues.filter((issue) => {
      const haystack = [
        issue.issueId,
        issue.title,
        issue.projectName,
        issue.owner,
        issue.priority,
        issue.status,
        issue.e2StatusUpdate,
        issue.e2Detailer,
        issue.e2DetailerSupportTeam,
        issue.techDetailsAvailable,
        issue.snapshotUrl,
        issue.cardImageUrl,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [issues, searchText]);

  const boardColumns = useMemo(() => {
    return FIXED_BOARD_COLUMNS.map((statusValue) => ({
      statusValue,
      items: filteredIssues
        .filter((issue) => deriveBoardStatus(issue) === statusValue)
        .sort((a, b) => a.title.localeCompare(b.title)),
    }));
  }, [filteredIssues]);

  const applyE2StatusUpdate = async (issue, nextStatus) => {
    if (!id || !issue?.projectDocId || !nextStatus) return;

    const normalizedNextStatus = normalizeValue(nextStatus);
    if (!FIXED_BOARD_COLUMNS.includes(normalizedNextStatus)) return;

    if (normalizedNextStatus !== "Received" && !hasReadyToStartRequirements(issue)) {
      toast.warn("To move out of Received, issue needs E2 Lead Detailer, E2 Detailer Support Team, and Technical Details = Yes.");
      return;
    }

    const projectSource = projectSources[issue.projectDocId];
    if (!projectSource) return;

    const previousRows = Array.isArray(projectSource.rows) ? projectSource.rows : [];
    const previousFields = Array.isArray(projectSource.fields) ? projectSource.fields : [];
    const targetRow = previousRows[issue.rowIndex];
    if (!targetRow) return;

    const previousRowData = targetRow?.rowData || {};
    const detectedStatusField =
      findFieldByAliases(previousFields, previousRowData, ["e2 status update", "e2statusupdate"]) ||
      E2_STATUS_UPDATE_FIELD;
    const detectedDateField =
      findFieldByAliases(previousFields, previousRowData, ["e2 status date", "e2statusdate", "status update date"]) ||
      E2_STATUS_DATE_FIELD;

    const previousValue = normalizeValue(previousRowData[detectedStatusField]);
    if (previousValue.toLowerCase() === normalizedNextStatus.toLowerCase()) return;

    const updatedRowData = {
      ...previousRowData,
      [detectedStatusField]: normalizedNextStatus,
      [detectedDateField]: getNowMMDDYYTime(),
    };
    const updatedRows = previousRows.map((row, index) =>
      index === issue.rowIndex ? { ...row, rowData: updatedRowData } : row
    );
    const updatedFields = previousFields
      .concat([detectedStatusField, detectedDateField])
      .filter((field, index, array) => array.indexOf(field) === index);

    const previousSource = projectSource;
    const previousStatus = issue.e2StatusUpdate;

    setProjectSources((prev) => ({
      ...prev,
      [issue.projectDocId]: {
        fields: updatedFields,
        rows: updatedRows,
      },
    }));
    setIssues((prev) =>
      prev.map((item) =>
        item.key === issue.key
          ? {
              ...item,
              e2StatusUpdate: normalizedNextStatus,
              e2StatusDate: getNowMMDDYYTime(),
            }
          : item
      )
    );
    setSavingIssueKeys((prev) => ({ ...prev, [issue.key]: true }));

    try {
      await updateDoc(doc(db, "churches", id, "bimProjects", issue.projectDocId), {
        fields: updatedFields,
        rows: updatedRows,
        updatedAt: new Date(),
      });
    } catch (error) {
      console.error("Error updating E2 status:", error);
      toast.error("Could not update E2 status. Please try again.");
      setProjectSources((prev) => ({
        ...prev,
        [issue.projectDocId]: previousSource,
      }));
      setIssues((prev) =>
        prev.map((item) => (item.key === issue.key ? { ...item, e2StatusUpdate: previousStatus } : item))
      );
    } finally {
      setSavingIssueKeys((prev) => {
        const next = { ...prev };
        delete next[issue.key];
        return next;
      });
    }
  };

  const onDropToColumn = async (targetStatusValue) => {
    const issue = issues.find((item) => item.key === draggingIssueKey);
    setDraggingIssueKey("");
    if (!issue || !targetStatusValue) return;
    await applyE2StatusUpdate(issue, targetStatusValue);
  };

  const totalVisible = filteredIssues.length;

  return (
    <div style={commonStyles.fullWidthContainer}>
      <Link to={`/organization/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to Mi Organización
      </Link>
      <ChurchHeader id={id} applyShadow={false} allowEditBannerLogo={false} />

      <div className="issue-board-shell">
        <div className="issue-board-hero">
          <div>
            <h1 className="issue-board-title">Agile Issue Board</h1>
            <p className="issue-board-subtitle">
              Kanban view grouped by E2 Status Update. Drag cards between columns to update status.
            </p>
          </div>
          <div className="issue-board-meta">
            <span>{totalVisible} issues</span>
          </div>
        </div>

        <div className="issue-board-toolbar">
          <input
            type="text"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search issue, title, project, owner..."
            className="issue-board-search"
          />
        </div>

        {loading ? (
          <div className="issue-board-loading">Loading issues...</div>
        ) : (
          <div className="issue-board-columns">
            {boardColumns.map((column) => (
              <section
                key={column.statusValue}
                className="issue-board-column"
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => onDropToColumn(column.statusValue)}
              >
                <header className="issue-board-column-header">
                  <h2>{column.statusValue}</h2>
                  <span>{column.items.length}</span>
                </header>

                <div className="issue-board-column-body">
                  {column.items.map((issue) => (
                    <article
                      key={issue.key}
                      className={`issue-card ${draggingIssueKey === issue.key ? "is-dragging" : ""}`}
                      draggable
                      onDragStart={() => setDraggingIssueKey(issue.key)}
                      onDragEnd={() => setDraggingIssueKey("")}
                    >
                      <div className="issue-card-top">
                        <span className="issue-card-id">#{issue.issueId}</span>
                        <span className="issue-card-priority">{issue.priority}</span>
                      </div>
                      {issue.cardImageUrl ? (
                        <img
                          src={issue.cardImageUrl}
                          alt={`Snapshot for issue ${issue.issueId}`}
                          onError={(event) => {
                            event.currentTarget.style.display = "none";
                          }}
                          style={{
                            width: "100%",
                            height: "150px",
                            objectFit: "cover",
                            borderRadius: "8px",
                            border: "1px solid #d9cbbd",
                            marginBottom: "8px",
                          }}
                        />
                      ) : null}
                      <h3>{issue.title}</h3>
                      <p className="issue-card-project">{issue.projectName}</p>

                      <div className="issue-card-details">
                        <span>Status: {issue.status}</span>
                        <span>E2 Lead Detailer: {normalizeValue(issue.e2Detailer) || "-"}</span>
                        <span>E2 Support Team: {normalizeValue(issue.e2DetailerSupportTeam) || "-"}</span>
                        <span>Technical Details: {normalizeValue(issue.techDetailsAvailable) || "No"}</span>
                        <span>Updated: {formatTimestamp(issue.e2StatusDate) || "-"}</span>
                      </div>

                      <select
                        value={deriveBoardStatus(issue)}
                        onChange={(event) => applyE2StatusUpdate(issue, event.target.value)}
                        disabled={Boolean(savingIssueKeys[issue.key])}
                        className="issue-card-status-select"
                      >
                        {FIXED_BOARD_COLUMNS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </article>
                  ))}

                  {!column.items.length && <div className="issue-board-empty-column">No issues in this status</div>}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectIssueAgileBoard;