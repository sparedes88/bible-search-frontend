import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase";
import commonStyles from "../pages/commonStyles";

const normalizeValue = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
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
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
};

const parseTagsFromValue = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item)).filter(Boolean);
  }

  const normalized = normalizeValue(value);
  if (!normalized) return [];
  return normalized.split(",").map((item) => normalizeValue(item)).filter(Boolean);
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

const TimeRotateProgress = () => {
  const { id } = useParams();
  const [timeLog, setTimeLog] = useState([]);
  const [activeTimers, setActiveTimers] = useState([]);
  const [organizationUsers, setOrganizationUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState("");

  const routePrefix =
    typeof window !== "undefined" && window.location?.pathname?.includes("/church/")
      ? "/church"
      : "/organization";

  useEffect(() => {
    if (!id) return () => {};

    const usersQuery = query(collection(db, "users"), where("churchId", "==", id));
    const unsubscribe = onSnapshot(usersQuery, (snapshot) => {
      const nextUsers = snapshot.docs
        .map((snapshotDoc) => {
          const data = snapshotDoc.data() || {};
          const firstName = normalizeValue(data.firstName || data.name);
          const lastName = normalizeValue(data.lastName);
          const email = normalizeValue(data.email);
          const displayName = normalizeValue(data.displayName);
          const fullName = normalizeValue([firstName, lastName].filter(Boolean).join(" "));
          const label = fullName || displayName || email || `User ${snapshotDoc.id}`;

          return {
            userId: snapshotDoc.id,
            label,
            firstName,
            fullName,
            email,
            aliases: Array.from(
              new Set([
                snapshotDoc.id,
                email,
                fullName,
                displayName,
                normalizeValue(data.name),
              ].filter(Boolean))
            ),
          };
        })
        .sort((left, right) => left.label.localeCompare(right.label));

      setOrganizationUsers(nextUsers);
    });

    return () => unsubscribe();
  }, [id]);

  useEffect(() => {
    if (!id) return () => {};

    const unsubscribe = onSnapshot(collection(db, "churches", id, "timeRotateLogs"), (snapshot) => {
      const nextLogs = snapshot.docs.map((snapshotDoc) => {
        const data = snapshotDoc.data() || {};
        return {
          id: snapshotDoc.id,
          logType: normalizeValue(data.logType) || "timer",
          issueId: normalizeValue(data.issueId),
          projectName: normalizeValue(data.projectName),
          registeredBy: normalizeValue(data.registeredBy),
          userId: normalizeValue(data.userId),
          userEmail: normalizeValue(data.userEmail),
          startedAt: Number(data.startedAt) || 0,
          endedAt: Number(data.endedAt) || 0,
          completionAt: Number(data.completionAt) || 0,
          durationMs: Number(data.durationMs) || 0,
          notes: Array.isArray(data.notes)
            ? data.notes
                .map((note) => ({
                  text: normalizeValue(note?.text),
                  timestamp: Number(note?.timestamp) || 0,
                }))
                .filter((note) => note.text)
            : [],
          taskTags: parseTagsFromValue(data.taskTags ?? data.taskDescription),
        };
      });

      nextLogs.sort((left, right) => {
        const leftTime = Number(left.endedAt || left.completionAt || left.startedAt) || 0;
        const rightTime = Number(right.endedAt || right.completionAt || right.startedAt) || 0;
        return rightTime - leftTime;
      });

      setTimeLog(nextLogs);
    });

    return () => unsubscribe();
  }, [id]);

  useEffect(() => {
    if (!id) return () => {};

    const unsubscribe = onSnapshot(collection(db, "churches", id, "timeRotateActiveTimers"), (snapshot) => {
      const nextActiveTimers = snapshot.docs
        .map((snapshotDoc) => {
          const data = snapshotDoc.data() || {};
          return {
            id: snapshotDoc.id,
            issueId: normalizeValue(data.issueId),
            projectName: normalizeValue(data.projectName),
            registeredBy: normalizeValue(data.registeredBy),
            userId: normalizeValue(data.userId),
            userEmail: normalizeValue(data.userEmail),
            ownerKey: normalizeValue(data.ownerKey),
            startedAt: Number(data.startedAt) || 0,
            notes: Array.isArray(data.notes)
              ? data.notes
                  .map((note) => ({
                    text: normalizeValue(note?.text),
                    timestamp: Number(note?.timestamp) || 0,
                  }))
                  .filter((note) => note.text)
              : [],
          };
        })
        .filter((entry) => entry.startedAt > 0)
        .sort((left, right) => right.startedAt - left.startedAt);

      setActiveTimers(nextActiveTimers);
    });

    return () => unsubscribe();
  }, [id]);

  const getOrganizationUserMatch = (entry) => {
    const entryUserId = normalizeValue(entry?.userId);
    const byUserId = organizationUsers.find((userEntry) => normalizeValue(userEntry.userId) === entryUserId);
    if (byUserId) return byUserId;

    const entryEmail = normalizeValue(entry?.userEmail);
    const byEmail = organizationUsers.find((userEntry) => normalizeValue(userEntry.email) && normalizeValue(userEntry.email) === entryEmail);
    if (byEmail) return byEmail;

    const registeredBy = normalizeValue(entry?.registeredBy);
    if (!registeredBy) return null;

    return (
      organizationUsers.find((userEntry) =>
        Array.isArray(userEntry.aliases)
          ? userEntry.aliases.some((alias) => normalizeValue(alias) === registeredBy)
          : false
      ) || null
    );
  };

  const allUsersSummary = useMemo(() => {
    const summaryMap = {};

    organizationUsers.forEach((userEntry) => {
      summaryMap[userEntry.userId] = {
        userKey: userEntry.userId,
        label: userEntry.label,
        totalEntries: 0,
        timerEntries: 0,
        completionEntries: 0,
        totalDurationMs: 0,
        activeTimers: 0,
      };
    });

    timeLog.forEach((entry) => {
      const matchedUser = getOrganizationUserMatch(entry);
      const userKey = normalizeValue(matchedUser?.userId) || normalizeValue(entry.userId) || normalizeValue(entry.registeredBy) || "unknown-user";
      const label = normalizeValue(matchedUser?.label) || normalizeValue(entry.registeredBy) || `User ${userKey}`;

      if (!summaryMap[userKey]) {
        summaryMap[userKey] = {
          userKey,
          label,
          totalEntries: 0,
          timerEntries: 0,
          completionEntries: 0,
          totalDurationMs: 0,
          activeTimers: 0,
        };
      }

      summaryMap[userKey].totalEntries += 1;
      if (entry.logType === "completion") {
        summaryMap[userKey].completionEntries += 1;
      } else {
        summaryMap[userKey].timerEntries += 1;
        summaryMap[userKey].totalDurationMs += Number(entry.durationMs) || 0;
      }
    });

    activeTimers.forEach((entry) => {
      const matchedUser = getOrganizationUserMatch(entry);
      const userKey = normalizeValue(matchedUser?.userId) || normalizeValue(entry.userId) || normalizeValue(entry.registeredBy) || "unknown-user";
      const label = normalizeValue(matchedUser?.label) || normalizeValue(entry.registeredBy) || `User ${userKey}`;

      if (!summaryMap[userKey]) {
        summaryMap[userKey] = {
          userKey,
          label,
          totalEntries: 0,
          timerEntries: 0,
          completionEntries: 0,
          totalDurationMs: 0,
          activeTimers: 0,
        };
      }

      summaryMap[userKey].activeTimers += 1;
    });

    return Object.values(summaryMap).sort((left, right) => {
      if (right.activeTimers !== left.activeTimers) return right.activeTimers - left.activeTimers;
      if (right.totalEntries !== left.totalEntries) return right.totalEntries - left.totalEntries;
      return right.totalDurationMs - left.totalDurationMs;
    });
  }, [activeTimers, organizationUsers, timeLog]);

  const userOptions = useMemo(() => {
    return allUsersSummary
      .map((entry) => ({ value: entry.userKey, label: entry.label }))
      .filter((entry) => normalizeValue(entry.value))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [allUsersSummary]);

  const visibleLogs = useMemo(() => {
    if (!selectedUser) return timeLog;

    return timeLog.filter((entry) => {
      const matchedUser = getOrganizationUserMatch(entry);
      const userKey = normalizeValue(matchedUser?.userId) || normalizeValue(entry.userId) || normalizeValue(entry.registeredBy);
      return userKey === selectedUser;
    });
  }, [selectedUser, timeLog]);

  return (
    <div style={{ ...commonStyles.fullWidthContainer, paddingTop: "2rem", paddingBottom: "2rem" }}>
      <Link to={`${routePrefix}/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to My Organization
      </Link>

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
            <h1 style={{ ...commonStyles.title, marginBottom: "6px" }}>TimeRotate All Users Progress</h1>
            <p style={{ margin: 0, color: "#475569" }}>
              Live organization view of active timers, submitted notes, and progress for all users.
            </p>
          </div>
          <Link
            to={`${routePrefix}/${id}/e2-agile-board`}
            style={{
              alignSelf: "flex-start",
              textDecoration: "none",
              backgroundColor: "#111827",
              color: "#FFFFFF",
              padding: "10px 14px",
              borderRadius: "10px",
              fontWeight: 600,
            }}
          >
            Open E2 Agile Board
          </Link>
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px", marginBottom: "12px" }}>
          <Link to={`${routePrefix}/${id}/time-rotate`} style={tabStyle(false)}>
            TimeRotate Board
          </Link>
          <Link to={`${routePrefix}/${id}/time-rotate-progress`} style={tabStyle(true)}>
            All Users Progress
          </Link>
          <Link to={`${routePrefix}/${id}/time-rotate-card-hours`} style={tabStyle(false)}>
            Card Hours
          </Link>
          <Link to={`${routePrefix}/${id}/time-rotate-notes`} style={tabStyle(false)}>
            In Progress Notes
          </Link>
        </div>

        <div style={{ marginTop: "10px", display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
          <label htmlFor="all-progress-user-filter" style={{ color: "#334155", fontWeight: 600, fontSize: "0.9rem" }}>
            Filter by user:
          </label>
          <select
            id="all-progress-user-filter"
            value={selectedUser}
            onChange={(event) => setSelectedUser(event.target.value)}
            style={{
              minWidth: "240px",
              padding: "8px 10px",
              border: "1px solid #CBD5E1",
              borderRadius: "8px",
              backgroundColor: "#FFFFFF",
            }}
          >
            <option value="">All users</option>
            {userOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginTop: "14px", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "760px" }}>
            <thead>
              <tr style={{ background: "#F8FAFC" }}>
                <th style={cellHeaderStyle}>User</th>
                <th style={cellHeaderStyle}>Active Timers</th>
                <th style={cellHeaderStyle}>Total Logs</th>
                <th style={cellHeaderStyle}>Timer Logs</th>
                <th style={cellHeaderStyle}>Completion Logs</th>
                <th style={cellHeaderStyle}>Total Time</th>
              </tr>
            </thead>
            <tbody>
              {allUsersSummary
                .filter((entry) => !selectedUser || entry.userKey === selectedUser)
                .map((entry) => (
                  <tr key={entry.userKey}>
                    <td style={cellStyle}>{entry.label}</td>
                    <td style={cellStyle}>{entry.activeTimers}</td>
                    <td style={cellStyle}>{entry.totalEntries}</td>
                    <td style={cellStyle}>{entry.timerEntries}</td>
                    <td style={cellStyle}>{entry.completionEntries}</td>
                    <td style={cellStyle}>{formatDuration(entry.totalDurationMs)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: "18px", borderTop: "1px solid #E2E8F0", paddingTop: "14px" }}>
          <h2 style={{ margin: 0, fontSize: "1.05rem", color: "#0F172A" }}>Recent Logs (All Users)</h2>
          {visibleLogs.length === 0 ? (
            <p style={{ marginTop: "8px", marginBottom: 0, color: "#64748B" }}>No logs found for current filter.</p>
          ) : (
            <div style={{ marginTop: "10px", overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "940px" }}>
                <thead>
                  <tr style={{ background: "#F8FAFC" }}>
                    <th style={cellHeaderStyle}>User</th>
                    <th style={cellHeaderStyle}>Event</th>
                    <th style={cellHeaderStyle}>ID</th>
                    <th style={cellHeaderStyle}>Project Name</th>
                    <th style={cellHeaderStyle}>Started</th>
                    <th style={cellHeaderStyle}>Stopped</th>
                    <th style={cellHeaderStyle}>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLogs.slice(0, 120).map((entry) => (
                    <tr key={entry.id}>
                      <td style={cellStyle}>{entry.registeredBy || "Unknown user"}</td>
                      <td style={cellStyle}>{entry.logType === "completion" ? "Completion" : "Timer"}</td>
                      <td style={cellStyle}>{entry.issueId || "-"}</td>
                      <td style={cellStyle}>{entry.projectName || "-"}</td>
                      <td style={cellStyle}>{formatTimestamp(entry.startedAt || entry.completionAt)}</td>
                      <td style={cellStyle}>{formatTimestamp(entry.endedAt || entry.completionAt)}</td>
                      <td style={cellStyle}>{entry.logType === "completion" ? "-" : formatDuration(entry.durationMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const cellHeaderStyle = {
  textAlign: "left",
  padding: "12px",
  borderBottom: "1px solid #E2E8F0",
  color: "#0F172A",
  fontSize: "0.9rem",
};

const cellStyle = {
  padding: "12px",
  borderBottom: "1px solid #E2E8F0",
  color: "#334155",
  fontSize: "0.92rem",
};

export default TimeRotateProgress;
