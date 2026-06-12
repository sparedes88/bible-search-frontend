import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase";
import commonStyles from "../pages/commonStyles";
import TimeRotateTopLogo from "./TimeRotateTopLogo";

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

const formatDateOnly = (value) => {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
};

const formatTimeOnly = (value) => {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
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

const DAY_MS = 24 * 60 * 60 * 1000;

const getStartOfDay = (timestamp) => {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

const getStartOfWeek = (timestamp) => {
  const date = new Date(timestamp);
  const day = date.getDay();
  const mondayOffset = (day + 6) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - mondayOffset).getTime();
};

const getDateRangeBounds = (rangeKey, nowTimestamp = Date.now()) => {
  const now = Number(nowTimestamp) || Date.now();
  const todayStart = getStartOfDay(now);
  const thisWeekStart = getStartOfWeek(now);

  if (rangeKey === "today") {
    return { start: todayStart, end: now };
  }

  if (rangeKey === "yesterday") {
    return { start: todayStart - DAY_MS, end: todayStart };
  }

  if (rangeKey === "this-week") {
    return { start: thisWeekStart, end: now };
  }

  if (rangeKey === "last-week") {
    return { start: thisWeekStart - 7 * DAY_MS, end: thisWeekStart };
  }

  return { start: 0, end: Number.MAX_SAFE_INTEGER };
};

const isTimestampInRange = (timestamp, range) => {
  const value = Number(timestamp) || 0;
  if (value <= 0) return false;
  return value >= Number(range.start) && value < Number(range.end);
};

const parseDateInputToStart = (dateInputValue) => {
  const normalized = normalizeValue(dateInputValue);
  if (!normalized) return null;

  const parsedDate = new Date(`${normalized}T00:00:00`);
  const parsedTimestamp = parsedDate.getTime();
  return Number.isFinite(parsedTimestamp) ? parsedTimestamp : null;
};

const parseDateInputToEndExclusive = (dateInputValue) => {
  const startOfDay = parseDateInputToStart(dateInputValue);
  if (!Number.isFinite(startOfDay)) return null;
  return startOfDay + DAY_MS;
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
  const [selectedProject, setSelectedProject] = useState("");
  const [selectedDateRange, setSelectedDateRange] = useState("today");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");

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

  const dateRangeBounds = useMemo(() => {
    if (selectedDateRange !== "custom") {
      return getDateRangeBounds(selectedDateRange);
    }

    const rawStart = parseDateInputToStart(customStartDate);
    const rawEnd = parseDateInputToEndExclusive(customEndDate);

    const hasStart = Number.isFinite(rawStart);
    const hasEnd = Number.isFinite(rawEnd);

    if (!hasStart && !hasEnd) {
      return { start: 0, end: Number.MAX_SAFE_INTEGER };
    }

    const normalizedStart = hasStart ? rawStart : 0;
    const normalizedEnd = hasEnd ? rawEnd : Number.MAX_SAFE_INTEGER;

    if (normalizedStart <= normalizedEnd) {
      return { start: normalizedStart, end: normalizedEnd };
    }

    // If the user selects an inverted range, swap it instead of returning no data.
    return { start: normalizedEnd - DAY_MS, end: normalizedStart + DAY_MS };
  }, [customEndDate, customStartDate, selectedDateRange]);

  const projectOptions = useMemo(() => {
    const allProjects = [
      ...timeLog.map((entry) => normalizeValue(entry.projectName)),
      ...activeTimers.map((entry) => normalizeValue(entry.projectName)),
    ]
      .filter(Boolean);

    return Array.from(new Set(allProjects)).sort((left, right) => left.localeCompare(right));
  }, [activeTimers, timeLog]);

  useEffect(() => {
    if (!selectedProject) return;
    if (!projectOptions.includes(selectedProject)) {
      setSelectedProject("");
    }
  }, [projectOptions, selectedProject]);

  const filteredTimeLog = useMemo(() => {
    return timeLog.filter((entry) => {
      const referenceTimestamp = Number(entry.endedAt || entry.completionAt || entry.startedAt) || 0;
      if (!isTimestampInRange(referenceTimestamp, dateRangeBounds)) {
        return false;
      }

      if (!selectedProject) {
        return true;
      }

      return normalizeValue(entry.projectName) === selectedProject;
    });
  }, [dateRangeBounds, selectedProject, timeLog]);

  const filteredActiveTimers = useMemo(() => {
    return activeTimers.filter((entry) => {
      if (!isTimestampInRange(entry.startedAt, dateRangeBounds)) {
        return false;
      }

      if (!selectedProject) {
        return true;
      }

      return normalizeValue(entry.projectName) === selectedProject;
    });
  }, [activeTimers, dateRangeBounds, selectedProject]);

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

    filteredTimeLog.forEach((entry) => {
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

    filteredActiveTimers.forEach((entry) => {
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
  }, [filteredActiveTimers, filteredTimeLog, organizationUsers]);

  const userOptions = useMemo(() => {
    return allUsersSummary
      .map((entry) => ({ value: entry.userKey, label: entry.label }))
      .filter((entry) => normalizeValue(entry.value))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [allUsersSummary]);

  const visibleLogs = useMemo(() => {
    if (!selectedUser) return filteredTimeLog;

    return filteredTimeLog.filter((entry) => {
      const matchedUser = getOrganizationUserMatch(entry);
      const userKey = normalizeValue(matchedUser?.userId) || normalizeValue(entry.userId) || normalizeValue(entry.registeredBy);
      return userKey === selectedUser;
    });
  }, [filteredTimeLog, selectedUser]);

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
            <h1 style={{ ...commonStyles.title, marginBottom: "6px" }}>TimeRotate All Users Progress</h1>
            <p style={{ margin: 0, color: "#475569" }}>
              Live organization view of active timers, submitted notes, and progress for all users.
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px", marginBottom: "12px" }}>
          <Link to={`${routePrefix}/${id}/time-tracking`} style={tabStyle(false)}>
            ◴ TimeTracking
          </Link>
          <Link to={`${routePrefix}/${id}/time-rotate`} style={tabStyle(false)}>
            ▤ TimeRotate Board
          </Link>
          <Link to={`${routePrefix}/${id}/time-rotate-tracker`} style={tabStyle(false)}>
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
          <Link to={`${routePrefix}/${id}/e2-agile-board`} style={tabStyle(false)}>
            ▦ Agile Board
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

          <label htmlFor="all-progress-date-filter" style={{ color: "#334155", fontWeight: 600, fontSize: "0.9rem" }}>
            Date range:
          </label>
          <select
            id="all-progress-date-filter"
            value={selectedDateRange}
            onChange={(event) => setSelectedDateRange(event.target.value)}
            style={{
              minWidth: "190px",
              padding: "8px 10px",
              border: "1px solid #CBD5E1",
              borderRadius: "8px",
              backgroundColor: "#FFFFFF",
            }}
          >
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="this-week">This Week</option>
            <option value="last-week">Last Week</option>
            <option value="custom">Custom Range</option>
            <option value="all-time">All Time</option>
          </select>

          <label htmlFor="all-progress-project-filter" style={{ color: "#334155", fontWeight: 600, fontSize: "0.9rem" }}>
            Project:
          </label>
          <select
            id="all-progress-project-filter"
            value={selectedProject}
            onChange={(event) => setSelectedProject(event.target.value)}
            style={{
              minWidth: "220px",
              padding: "8px 10px",
              border: "1px solid #CBD5E1",
              borderRadius: "8px",
              backgroundColor: "#FFFFFF",
            }}
          >
            <option value="">All projects</option>
            {projectOptions.map((projectName) => (
              <option key={projectName} value={projectName}>
                {projectName}
              </option>
            ))}
          </select>

          {selectedDateRange === "custom" ? (
            <>
              <label htmlFor="all-progress-date-start" style={{ color: "#334155", fontWeight: 600, fontSize: "0.9rem" }}>
                Start:
              </label>
              <input
                id="all-progress-date-start"
                type="date"
                value={customStartDate}
                onChange={(event) => setCustomStartDate(event.target.value)}
                style={{
                  minWidth: "160px",
                  padding: "8px 10px",
                  border: "1px solid #CBD5E1",
                  borderRadius: "8px",
                  backgroundColor: "#FFFFFF",
                }}
              />

              <label htmlFor="all-progress-date-end" style={{ color: "#334155", fontWeight: 600, fontSize: "0.9rem" }}>
                End:
              </label>
              <input
                id="all-progress-date-end"
                type="date"
                value={customEndDate}
                onChange={(event) => setCustomEndDate(event.target.value)}
                style={{
                  minWidth: "160px",
                  padding: "8px 10px",
                  border: "1px solid #CBD5E1",
                  borderRadius: "8px",
                  backgroundColor: "#FFFFFF",
                }}
              />
            </>
          ) : null}
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
                  {visibleLogs.slice(0, 120).map((entry) => {
                    const entryNotes = (Array.isArray(entry.notes) ? entry.notes : [])
                      .map((noteEntry, noteIndex) => ({
                        text: normalizeValue(noteEntry?.text),
                        timestamp: Number(noteEntry?.timestamp) || 0,
                        fallbackIndex: noteIndex,
                      }))
                      .filter((noteEntry) => noteEntry.text)
                      .sort((left, right) => {
                        const leftTimestamp = Number(left.timestamp) || 0;
                        const rightTimestamp = Number(right.timestamp) || 0;
                        if (leftTimestamp !== rightTimestamp) return leftTimestamp - rightTimestamp;
                        return left.fallbackIndex - right.fallbackIndex;
                      });

                    return (
                      <React.Fragment key={entry.id}>
                        <tr>
                          <td style={cellStyle}>{entry.registeredBy || "Unknown user"}</td>
                          <td style={cellStyle}>{entry.logType === "completion" ? "Completion" : "Timer"}</td>
                          <td style={cellStyle}>{entry.issueId || "-"}</td>
                          <td style={cellStyle}>{entry.projectName || "-"}</td>
                          <td style={cellStyle}>{formatTimestamp(entry.startedAt || entry.completionAt)}</td>
                          <td style={cellStyle}>{formatTimestamp(entry.endedAt || entry.completionAt)}</td>
                          <td style={cellStyle}>{entry.logType === "completion" ? "-" : formatDuration(entry.durationMs)}</td>
                        </tr>
                        <tr>
                          <td
                            colSpan={7}
                            style={{
                              padding: "8px 12px 12px",
                              borderBottom: "1px solid #E2E8F0",
                              backgroundColor: "#F8FAFC",
                            }}
                          >
                            {entryNotes.length === 0 ? (
                              <div style={{ color: "#64748B", fontSize: "0.82rem" }}>No notes.</div>
                            ) : (
                              <div style={{ display: "grid", gap: "4px" }}>
                                {entryNotes.map((noteEntry, noteIndex) => (
                                  <div
                                    key={`${noteEntry.timestamp || noteIndex}-${noteIndex}`}
                                    style={{
                                      border: "1px solid #E2E8F0",
                                      borderRadius: "8px",
                                      backgroundColor: noteIndex % 2 === 0 ? "#FFFFFF" : "#F8FAFC",
                                      borderLeft: "4px solid #93C5FD",
                                      padding: "6px 8px",
                                    }}
                                  >
                                    <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                                      <div style={{ color: "#1D4ED8", fontSize: "0.75rem", fontWeight: 700 }}>
                                        Note {noteIndex + 1}
                                      </div>
                                      <div style={{ color: "#475569", fontSize: "0.74rem", fontWeight: 600 }}>
                                        {formatDateOnly(noteEntry?.timestamp)} • {formatTimeOnly(noteEntry?.timestamp)}
                                      </div>
                                    </div>
                                    <div style={{ color: "#0F172A", fontSize: "0.84rem", marginTop: "2px" }}>
                                      {normalizeValue(noteEntry?.text) || "-"}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      </React.Fragment>
                    );
                  })}
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
