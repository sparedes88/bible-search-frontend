import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase";
import commonStyles from "../pages/commonStyles";

const ONE_HOUR_MS = 60 * 60 * 1000;

const normalizeValue = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const formatTimestamp = (value) => {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
};

const formatRelativeDuration = (milliseconds) => {
  const totalMinutes = Math.max(0, Math.floor((Number(milliseconds) || 0) / 60000));
  if (totalMinutes < 60) {
    return `${totalMinutes}m ago`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) {
    return `${hours}h ago`;
  }

  return `${hours}h ${minutes}m ago`;
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

const TimeRotateInProgressNotes = () => {
  const { id } = useParams();
  const [organizationUsers, setOrganizationUsers] = useState([]);
  const [activeTimers, setActiveTimers] = useState([]);
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
            email,
            aliases: Array.from(
              new Set([
                snapshotDoc.id,
                email,
                fullName,
                displayName,
                normalizeValue(data.name),
                normalizeValue(data.firstName),
                normalizeValue(data.lastName),
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

  const userOptions = useMemo(() => {
    return organizationUsers.map((entry) => ({ value: entry.userId, label: entry.label }));
  }, [organizationUsers]);

  const visibleActiveTimers = useMemo(() => {
    if (!selectedUser) return activeTimers;

    return activeTimers.filter((entry) => {
      const matchedUser = getOrganizationUserMatch(entry);
      const userKey = normalizeValue(matchedUser?.userId) || normalizeValue(entry.userId) || normalizeValue(entry.registeredBy);
      return userKey === selectedUser;
    });
  }, [activeTimers, selectedUser, organizationUsers]);

  const inProgressMessages = useMemo(() => {
    const messages = [];

    visibleActiveTimers.forEach((timerEntry) => {
      const matchedUser = getOrganizationUserMatch(timerEntry);
      const sender = normalizeValue(matchedUser?.label) || normalizeValue(timerEntry.registeredBy) || "Unknown user";

      (Array.isArray(timerEntry.notes) ? timerEntry.notes : []).forEach((note, noteIndex) => {
        messages.push({
          id: `${timerEntry.id}-${note.timestamp}-${noteIndex}`,
          sender,
          issueId: timerEntry.issueId,
          projectName: timerEntry.projectName,
          text: note.text,
          timestamp: Number(note.timestamp) || 0,
        });
      });
    });

    return messages.sort((left, right) => {
      if (left.timestamp !== right.timestamp) {
        return right.timestamp - left.timestamp;
      }
      return left.id.localeCompare(right.id);
    });
  }, [visibleActiveTimers, organizationUsers]);

  const attentionRows = useMemo(() => {
    const now = Date.now();

    const rows = organizationUsers.map((organizationUser) => {
      const userTimers = activeTimers.filter((timerEntry) => {
        const matchedUser = getOrganizationUserMatch(timerEntry);
        const userKey = normalizeValue(matchedUser?.userId) || normalizeValue(timerEntry.userId) || normalizeValue(timerEntry.registeredBy);
        return userKey === normalizeValue(organizationUser.userId);
      });

      const latestStart = userTimers.reduce((maxValue, timerEntry) => {
        const startedAt = Number(timerEntry.startedAt) || 0;
        return startedAt > maxValue ? startedAt : maxValue;
      }, 0);

      const latestNoteAt = userTimers.reduce((maxValue, timerEntry) => {
        const notes = Array.isArray(timerEntry.notes) ? timerEntry.notes : [];
        const timerLatest = notes.reduce((timerMax, note) => {
          const noteTimestamp = Number(note.timestamp) || 0;
          return noteTimestamp > timerMax ? noteTimestamp : timerMax;
        }, 0);
        return timerLatest > maxValue ? timerLatest : maxValue;
      }, 0);

      const hasActiveTimer = userTimers.length > 0;
      const noteIsStale = latestNoteAt > 0 ? now - latestNoteAt > ONE_HOUR_MS : true;
      const needsAttention = !hasActiveTimer || noteIsStale;

      let reason = "On track";
      if (!hasActiveTimer) {
        reason = "No active timer started";
      } else if (!latestNoteAt) {
        reason = "Active timer but no note yet";
      } else if (noteIsStale) {
        reason = `No note in last hour (${formatRelativeDuration(now - latestNoteAt)})`;
      }

      return {
        userId: organizationUser.userId,
        label: organizationUser.label,
        hasActiveTimer,
        latestStart,
        latestNoteAt,
        reason,
        needsAttention,
      };
    });

    return rows
      .filter((row) => row.needsAttention)
      .filter((row) => !selectedUser || row.userId === selectedUser)
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [activeTimers, organizationUsers, selectedUser]);

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
            <h1 style={{ ...commonStyles.title, marginBottom: "6px" }}>TimeRotate In Progress Notes</h1>
            <p style={{ margin: 0, color: "#475569" }}>
              Dedicated live view for notes plus users who need follow-up.
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
          <Link to={`${routePrefix}/${id}/time-rotate-progress`} style={tabStyle(false)}>
            All Users Progress
          </Link>
          <Link to={`${routePrefix}/${id}/time-rotate-card-hours`} style={tabStyle(false)}>
            Card Hours
          </Link>
          <Link to={`${routePrefix}/${id}/time-rotate-notes`} style={tabStyle(true)}>
            In Progress Notes
          </Link>
        </div>

        <div style={{ marginTop: "10px", display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
          <label htmlFor="notes-user-filter" style={{ color: "#334155", fontWeight: 600, fontSize: "0.9rem" }}>
            Filter by user:
          </label>
          <select
            id="notes-user-filter"
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

        <div style={{ marginTop: "16px", borderTop: "1px solid #E2E8F0", paddingTop: "14px" }}>
          <h2 style={{ margin: 0, fontSize: "1.05rem", color: "#0F172A" }}>Needs Attention</h2>
          <p style={{ margin: "6px 0 0", color: "#64748B", fontSize: "0.9rem" }}>
            Users shown here either have no active timer or have not added a note in the last hour.
          </p>

          {attentionRows.length === 0 ? (
            <p style={{ marginTop: "8px", marginBottom: 0, color: "#16A34A", fontWeight: 600 }}>
              All visible users are active and have recent notes.
            </p>
          ) : (
            <div style={{ marginTop: "10px", overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "720px" }}>
                <thead>
                  <tr style={{ background: "#F8FAFC" }}>
                    <th style={cellHeaderStyle}>User</th>
                    <th style={cellHeaderStyle}>Active Timer</th>
                    <th style={cellHeaderStyle}>Latest Timer Start</th>
                    <th style={cellHeaderStyle}>Latest Note</th>
                    <th style={cellHeaderStyle}>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {attentionRows.map((row) => (
                    <tr key={row.userId}>
                      <td style={cellStyle}>{row.label}</td>
                      <td style={cellStyle}>{row.hasActiveTimer ? "Yes" : "No"}</td>
                      <td style={cellStyle}>{formatTimestamp(row.latestStart)}</td>
                      <td style={cellStyle}>{formatTimestamp(row.latestNoteAt)}</td>
                      <td style={{ ...cellStyle, color: "#B45309", fontWeight: 700 }}>{row.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ marginTop: "18px", borderTop: "1px solid #E2E8F0", paddingTop: "14px" }}>
          <h2 style={{ margin: 0, fontSize: "1.05rem", color: "#0F172A" }}>In Progress Notes (All Users)</h2>
          {inProgressMessages.length === 0 ? (
            <p style={{ marginTop: "8px", marginBottom: 0, color: "#64748B" }}>
              No active notes found for current filter.
            </p>
          ) : (
            <div style={{ marginTop: "10px", overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "880px" }}>
                <thead>
                  <tr style={{ background: "#F8FAFC" }}>
                    <th style={cellHeaderStyle}>User</th>
                    <th style={cellHeaderStyle}>ID</th>
                    <th style={cellHeaderStyle}>Project Name</th>
                    <th style={cellHeaderStyle}>Note</th>
                    <th style={cellHeaderStyle}>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {inProgressMessages.map((message) => (
                    <tr key={message.id}>
                      <td style={cellStyle}>{message.sender}</td>
                      <td style={cellStyle}>{message.issueId || "-"}</td>
                      <td style={cellStyle}>{message.projectName || "-"}</td>
                      <td style={cellStyle}>{message.text}</td>
                      <td style={cellStyle}>{formatTimestamp(message.timestamp)}</td>
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

export default TimeRotateInProgressNotes;
