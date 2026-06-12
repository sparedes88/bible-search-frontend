import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, onSnapshot, query } from "firebase/firestore";
import { db } from "../firebase";
import commonStyles from "../pages/commonStyles";
import TimeRotateTopLogo from "./TimeRotateTopLogo";

const normalizeValue = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const parseTagsFromValue = (value) => {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => normalizeValue(item)).filter(Boolean)));
  }

  const normalized = normalizeValue(value);
  if (!normalized) return [];

  return Array.from(new Set(normalized.split(",").map((item) => normalizeValue(item)).filter(Boolean)));
};

const parseNotesFromValue = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item?.text ?? item)).filter(Boolean);
  }

  const normalized = normalizeValue(value);
  if (!normalized) return [];
  return [normalized];
};

const formatDuration = (milliseconds) => {
  const totalSeconds = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const formatTimestamp = (value) => {
  if (!value) return "-";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
};

const tabStyle = (active) => ({
  textDecoration: "none",
  borderRadius: "8px",
  padding: "8px 12px",
  fontWeight: 700,
  fontSize: "0.9rem",
  border: active ? "1px solid #2563EB" : "1px solid #CBD5E1",
  color: active ? "#1D4ED8" : "#334155",
  backgroundColor: active ? "#EFF6FF" : "#FFFFFF",
});

const cellHeaderStyle = {
  borderBottom: "1px solid #CBD5E1",
  padding: "10px",
  textAlign: "left",
  fontSize: "0.84rem",
  color: "#1E293B",
  whiteSpace: "nowrap",
};

const cellStyle = {
  borderBottom: "1px solid #E2E8F0",
  padding: "10px",
  fontSize: "0.86rem",
  color: "#334155",
  verticalAlign: "top",
};

const filterControlStyle = {
  border: "1px solid #CBD5E1",
  borderRadius: "8px",
  padding: "8px 10px",
  fontSize: "0.9rem",
  color: "#0F172A",
  backgroundColor: "#FFFFFF",
};

const TimeRotateTracker = () => {
  const { id } = useParams();
  const [editLogs, setEditLogs] = useState([]);
  const [userFilter, setUserFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [startDateFilter, setStartDateFilter] = useState("");

  const routePrefix =
    typeof window !== "undefined" && window.location?.pathname?.includes("/church/")
      ? "/church"
      : "/organization";

  useEffect(() => {
    if (!id) return () => {};

    const unsubscribe = onSnapshot(
      query(collection(db, "churches", id, "timeRotateEditLogs")),
      (snapshot) => {
        const nextLogs = snapshot.docs
          .map((snapshotDoc) => {
            const data = snapshotDoc.data() || {};
            return {
              id: snapshotDoc.id,
              issueId: normalizeValue(data.issueId),
              projectName: normalizeValue(data.projectName),
              editedAt: Number(data.editedAt) || 0,
              editedBy: normalizeValue(data.editedBy),
              fromRegisteredBy: normalizeValue(data.fromRegisteredBy),
              toRegisteredBy: normalizeValue(data.toRegisteredBy),
              fromStartedAt: Number(data.fromStartedAt) || 0,
              toStartedAt: Number(data.toStartedAt) || 0,
              fromEndedAt: Number(data.fromEndedAt) || 0,
              toEndedAt: Number(data.toEndedAt) || 0,
              fromDurationMs: Number(data.fromDurationMs) || 0,
              toDurationMs: Number(data.toDurationMs) || 0,
              fromTaskTags: parseTagsFromValue(data.fromTaskTags),
              toTaskTags: parseTagsFromValue(data.toTaskTags),
              fromNotes: parseNotesFromValue(data.fromNotes),
              toNotes: parseNotesFromValue(data.toNotes),
              changedFields: Array.isArray(data.changedFields)
                ? data.changedFields.map((field) => normalizeValue(field)).filter(Boolean)
                : [],
            };
          })
          .sort((left, right) => right.editedAt - left.editedAt);

        setEditLogs(nextLogs);
      },
      (snapshotError) => {
        console.error("Error loading TimeRotate tracker logs:", snapshotError);
        setEditLogs([]);
      }
    );

    return () => unsubscribe();
  }, [id]);

  const userOptions = useMemo(
    () =>
      Array.from(new Set(editLogs.map((entry) => entry.editedBy).filter(Boolean))).sort((left, right) =>
        left.localeCompare(right)
      ),
    [editLogs]
  );

  const projectOptions = useMemo(
    () =>
      Array.from(new Set(editLogs.map((entry) => entry.projectName).filter(Boolean))).sort((left, right) =>
        left.localeCompare(right)
      ),
    [editLogs]
  );

  const startDateThreshold = useMemo(() => {
    if (!startDateFilter) return 0;
    const parsedDate = new Date(`${startDateFilter}T00:00:00`);
    const timestamp = parsedDate.getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }, [startDateFilter]);

  const filteredLogs = useMemo(
    () =>
      editLogs.filter((entry) => {
        const matchesUser = userFilter === "all" || entry.editedBy === userFilter;
        const matchesProject = projectFilter === "all" || entry.projectName === projectFilter;
        const entryStartTimestamp = entry.toStartedAt || entry.fromStartedAt || 0;
        const matchesStartDate = !startDateThreshold || entryStartTimestamp >= startDateThreshold;
        return matchesUser && matchesProject && matchesStartDate;
      }),
    [editLogs, userFilter, projectFilter, startDateThreshold]
  );

  const totalChanges = filteredLogs.length;

  return (
    <div style={{ ...commonStyles.fullWidthContainer, paddingTop: "2rem", paddingBottom: "2rem" }}>
      <Link to={`${routePrefix}/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to My Organization
      </Link>

      <TimeRotateTopLogo />

      <div
        style={{
          backgroundColor: "white",
          border: "1px solid #E5E7EB",
          borderRadius: "16px",
          padding: "24px",
          marginTop: "1.5rem",
          boxShadow: "0 10px 20px rgba(15, 23, 42, 0.05)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ ...commonStyles.title, marginBottom: "6px" }}>Time Tracker</h1>
            <p style={{ margin: 0, color: "#475569" }}>
              Full audit trail of every manual time-log edit, including what changed from and to.
            </p>
          </div>
        </div>

        <div style={{ marginTop: "14px", color: "#334155", fontWeight: 600 }}>
          {totalChanges} change{totalChanges === 1 ? "" : "s"}
        </div>

        <p style={{ marginTop: "8px", marginBottom: 0, color: "#475569", fontSize: "0.9rem" }}>
          This page is audit-only. Edit times in <Link to={`${routePrefix}/${id}/time-rotate-card-hours`} style={{ color: "#1D4ED8", fontWeight: 700 }}>Card Hours</Link> or <Link to={`${routePrefix}/${id}/time-rotate`} style={{ color: "#1D4ED8", fontWeight: 700 }}>TimeRotate Board</Link>, and changes will appear here automatically.
        </p>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px", marginBottom: "12px" }}>
          <Link to={`${routePrefix}/${id}/time-tracking`} style={tabStyle(false)}>
            ◴ TimeTracking
          </Link>
          <Link to={`${routePrefix}/${id}/time-rotate`} style={tabStyle(false)}>
            ▤ TimeRotate Board
          </Link>
          <Link to={`${routePrefix}/${id}/time-rotate-tracker`} style={tabStyle(true)}>
            ✦ Time Tracker
          </Link>
          <Link to={`${routePrefix}/${id}/time-rotate-office-status`} style={tabStyle(false)}>
            ⌂ Office Status
          </Link>
          <Link to={`${routePrefix}/${id}/time-rotate-card-hours`} style={tabStyle(false)}>
            ◶ Card Hours
          </Link>
          <Link to={`${routePrefix}/${id}/time-rotate-notes?view=floor-planner`} style={tabStyle(false)}>
            ⌖ Floor Planner
          </Link>
          <Link to={`${routePrefix}/${id}/time-rotate-notes?view=card-review`} style={tabStyle(false)}>
            ☑ Card Review
          </Link>
          <Link to={`${routePrefix}/${id}/e2-agile-board`} style={tabStyle(false)}>
            ▦ Agile Board
          </Link>
        </div>

        <div
          style={{
            display: "grid",
            gap: "10px",
            marginTop: "12px",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            alignItems: "end",
          }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: "6px", color: "#334155", fontWeight: 600 }}>
            User
            <select style={filterControlStyle} value={userFilter} onChange={(event) => setUserFilter(event.target.value)}>
              <option value="all">All users</option>
              {userOptions.map((userOption) => (
                <option key={userOption} value={userOption}>
                  {userOption}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: "6px", color: "#334155", fontWeight: 600 }}>
            Project
            <select
              style={filterControlStyle}
              value={projectFilter}
              onChange={(event) => setProjectFilter(event.target.value)}
            >
              <option value="all">All projects</option>
              {projectOptions.map((projectOption) => (
                <option key={projectOption} value={projectOption}>
                  {projectOption}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: "6px", color: "#334155", fontWeight: 600 }}>
            Start Date
            <input
              type="date"
              style={filterControlStyle}
              value={startDateFilter}
              onChange={(event) => setStartDateFilter(event.target.value)}
            />
          </label>
        </div>

        {filteredLogs.length === 0 ? (
          <p style={{ marginTop: "10px", marginBottom: 0, color: "#64748B" }}>
            {editLogs.length === 0 ? "No time edits logged yet." : "No logs match the selected filters."}
          </p>
        ) : (
          <div style={{ overflowX: "auto", marginTop: "12px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "1120px" }}>
              <thead>
                <tr style={{ background: "#F8FAFC" }}>
                  <th style={cellHeaderStyle}>Edited At</th>
                  <th style={cellHeaderStyle}>Edited By</th>
                  <th style={cellHeaderStyle}>ID</th>
                  <th style={cellHeaderStyle}>Project Name</th>
                  <th style={cellHeaderStyle}>Registered By Change</th>
                  <th style={cellHeaderStyle}>Start Change</th>
                  <th style={cellHeaderStyle}>End Change</th>
                  <th style={cellHeaderStyle}>Duration Change</th>
                  <th style={cellHeaderStyle}>Task Tags Change</th>
                  <th style={cellHeaderStyle}>Notes Change</th>
                  <th style={cellHeaderStyle}>Fields Changed</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((entry) => (
                  <tr key={entry.id}>
                    <td style={cellStyle}>{formatTimestamp(entry.editedAt)}</td>
                    <td style={cellStyle}>{entry.editedBy || "Unknown user"}</td>
                    <td style={cellStyle}>{entry.issueId || "-"}</td>
                    <td style={cellStyle}>{entry.projectName || "-"}</td>
                    <td style={cellStyle}>{`${entry.fromRegisteredBy || "Unknown user"} -> ${entry.toRegisteredBy || "Unknown user"}`}</td>
                    <td style={cellStyle}>{`${formatTimestamp(entry.fromStartedAt)} -> ${formatTimestamp(entry.toStartedAt)}`}</td>
                    <td style={cellStyle}>{`${formatTimestamp(entry.fromEndedAt)} -> ${formatTimestamp(entry.toEndedAt)}`}</td>
                    <td style={cellStyle}>{`${formatDuration(entry.fromDurationMs)} -> ${formatDuration(entry.toDurationMs)}`}</td>
                    <td style={cellStyle}>{`${(entry.fromTaskTags || []).join(", ") || "-"} -> ${(entry.toTaskTags || []).join(", ") || "-"}`}</td>
                    <td style={cellStyle}>{`${(entry.fromNotes || []).join(" | ") || "-"} -> ${(entry.toNotes || []).join(" | ") || "-"}`}</td>
                    <td style={cellStyle}>{Array.isArray(entry.changedFields) && entry.changedFields.length > 0 ? entry.changedFields.join(", ") : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default TimeRotateTracker;
