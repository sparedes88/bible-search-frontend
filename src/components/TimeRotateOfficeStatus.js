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

const parseNotes = (value) => {
  if (!Array.isArray(value)) return [];

  return value
    .map((note) => ({
      text: normalizeValue(note?.text),
      timestamp: Number(note?.timestamp) || 0,
    }))
    .filter((note) => note.text);
};

const formatTimestamp = (value) => {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
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

const indicatorStyle = (inOffice) => ({
  width: "10px",
  height: "10px",
  borderRadius: "999px",
  backgroundColor: inOffice ? "#16A34A" : "#DC2626",
  boxShadow: inOffice ? "0 0 0 3px rgba(22, 163, 74, 0.15)" : "0 0 0 3px rgba(220, 38, 38, 0.15)",
  flexShrink: 0,
});

const buildTeamsChatUrl = (email) => {
  const normalizedEmail = normalizeValue(email);
  if (!normalizedEmail) return "";
  return `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(normalizedEmail)}`;
};

const TimeRotateOfficeStatus = () => {
  const { id } = useParams();
  const [organizationUsers, setOrganizationUsers] = useState([]);
  const [activeTimers, setActiveTimers] = useState([]);
  const [timeLog, setTimeLog] = useState([]);

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
          const fullName = normalizeValue([firstName, lastName].filter(Boolean).join(" "));
          const displayName = normalizeValue(data.displayName);
          const email = normalizeValue(data.email);
          const label = fullName || displayName || email || `User ${snapshotDoc.id}`;

          return {
            userId: snapshotDoc.id,
            label,
            email,
            aliases: Array.from(
              new Set([
                snapshotDoc.id,
                fullName,
                displayName,
                email,
                normalizeValue(data.name),
                normalizeValue(data.firstName),
                normalizeValue(data.lastName),
              ].filter(Boolean).map((value) => normalizeValue(value).toLowerCase()))
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
      const nextTimers = snapshot.docs
        .map((snapshotDoc) => {
          const data = snapshotDoc.data() || {};
          return {
            id: snapshotDoc.id,
            userId: normalizeValue(data.userId),
            userEmail: normalizeValue(data.userEmail),
            registeredBy: normalizeValue(data.registeredBy),
            ownerKey: normalizeValue(data.ownerKey),
            startedAt: Number(data.startedAt) || 0,
            notes: parseNotes(data.notes),
          };
        })
        .filter((entry) => entry.startedAt > 0);

      setActiveTimers(nextTimers);
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
          userId: normalizeValue(data.userId),
          userEmail: normalizeValue(data.userEmail),
          registeredBy: normalizeValue(data.registeredBy),
          ownerKey: normalizeValue(data.ownerKey),
          startedAt: Number(data.startedAt) || 0,
          endedAt: Number(data.endedAt) || 0,
          completionAt: Number(data.completionAt) || 0,
          notes: parseNotes(data.notes),
        };
      });

      setTimeLog(nextLogs);
    });

    return () => unsubscribe();
  }, [id]);

  const latestNoteByUserId = useMemo(() => {
    const latestNoteMap = new Map();
    const noteEntries = [...activeTimers, ...timeLog];

    organizationUsers.forEach((userEntry) => {
      const normalizedUserId = normalizeValue(userEntry.userId);
      const normalizedUserEmail = normalizeValue(userEntry.email).toLowerCase();
      const aliasSet = new Set(Array.isArray(userEntry.aliases) ? userEntry.aliases : []);

      noteEntries.forEach((entry) => {
        const entryUserId = normalizeValue(entry.userId);
        const entryUserEmail = normalizeValue(entry.userEmail).toLowerCase();
        const entryRegisteredBy = normalizeValue(entry.registeredBy).toLowerCase();
        const entryOwnerKey = normalizeValue(entry.ownerKey).toLowerCase();

        const matchesUser =
          (entryUserId && entryUserId === normalizedUserId) ||
          (entryUserEmail && normalizedUserEmail && entryUserEmail === normalizedUserEmail) ||
          (entryRegisteredBy && aliasSet.has(entryRegisteredBy)) ||
          (entryOwnerKey && aliasSet.has(entryOwnerKey));

        if (!matchesUser || !Array.isArray(entry.notes)) return;

        entry.notes.forEach((note) => {
          const current = latestNoteMap.get(normalizedUserId);
          const noteTimestamp = Number(note.timestamp) || 0;
          if (!note.text) return;
          if (!current || noteTimestamp >= current.timestamp) {
            latestNoteMap.set(normalizedUserId, {
              text: note.text,
              timestamp: noteTimestamp,
            });
          }
        });
      });
    });

    return latestNoteMap;
  }, [activeTimers, organizationUsers, timeLog]);

  const presenceRows = useMemo(() => {
    return organizationUsers
      .map((userEntry) => {
        const normalizedUserId = normalizeValue(userEntry.userId);
        const normalizedUserEmail = normalizeValue(userEntry.email).toLowerCase();
        const aliasSet = new Set(Array.isArray(userEntry.aliases) ? userEntry.aliases : []);

        const hasRunningTimer = activeTimers.some((timerEntry) => {
          const timerUserId = normalizeValue(timerEntry.userId);
          const timerUserEmail = normalizeValue(timerEntry.userEmail).toLowerCase();
          const timerRegisteredBy = normalizeValue(timerEntry.registeredBy).toLowerCase();
          const timerOwnerKey = normalizeValue(timerEntry.ownerKey).toLowerCase();

          if (timerUserId && timerUserId === normalizedUserId) return true;
          if (timerUserEmail && normalizedUserEmail && timerUserEmail === normalizedUserEmail) return true;
          if (timerRegisteredBy && aliasSet.has(timerRegisteredBy)) return true;
          if (timerOwnerKey && aliasSet.has(timerOwnerKey)) return true;

          return false;
        });

        return {
          userId: userEntry.userId,
          label: userEntry.label,
          email: userEntry.email,
          inOffice: hasRunningTimer,
          statusLabel: hasRunningTimer ? "In Office" : "Out of Office",
          lastNote: latestNoteByUserId.get(normalizedUserId)?.text || "",
          lastNoteAt: latestNoteByUserId.get(normalizedUserId)?.timestamp || 0,
        };
      })
      .sort((left, right) => {
        if (left.inOffice !== right.inOffice) {
          return left.inOffice ? -1 : 1;
        }
        return left.label.localeCompare(right.label);
      });
  }, [activeTimers, latestNoteByUserId, organizationUsers]);

  const inOfficeCount = useMemo(() => presenceRows.filter((row) => row.inOffice).length, [presenceRows]);
  const outOfOfficeCount = Math.max(0, presenceRows.length - inOfficeCount);

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
            <h1 style={{ ...commonStyles.title, marginBottom: "6px" }}>Office Status</h1>
            <p style={{ margin: 0, color: "#475569" }}>
              Live status by user. Green means time is running (In Office). Red means no active timer (Out of Office).
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
          <Link to={`${routePrefix}/${id}/time-rotate-office-status`} style={tabStyle(true)}>
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

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "10px" }}>
          <div style={{ border: "1px solid #BBF7D0", backgroundColor: "#F0FDF4", color: "#166534", borderRadius: "10px", padding: "8px 12px", fontWeight: 700 }}>
            In Office: {inOfficeCount}
          </div>
          <div style={{ border: "1px solid #FECACA", backgroundColor: "#FEF2F2", color: "#B91C1C", borderRadius: "10px", padding: "8px 12px", fontWeight: 700 }}>
            Out of Office: {outOfOfficeCount}
          </div>
        </div>

        {presenceRows.length === 0 ? (
          <p style={{ marginTop: "14px", color: "#64748B" }}>
            No users found for this organization.
          </p>
        ) : (
          <div style={{ marginTop: "14px", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "520px" }}>
              <thead>
                <tr style={{ background: "#F8FAFC" }}>
                  <th style={{ borderBottom: "1px solid #CBD5E1", padding: "10px", textAlign: "left", fontSize: "0.84rem", color: "#1E293B" }}>Status</th>
                  <th style={{ borderBottom: "1px solid #CBD5E1", padding: "10px", textAlign: "left", fontSize: "0.84rem", color: "#1E293B" }}>Name</th>
                  <th style={{ borderBottom: "1px solid #CBD5E1", padding: "10px", textAlign: "left", fontSize: "0.84rem", color: "#1E293B" }}>Last Note Time</th>
                  <th style={{ borderBottom: "1px solid #CBD5E1", padding: "10px", textAlign: "left", fontSize: "0.84rem", color: "#1E293B" }}>Last Note</th>
                  <th style={{ borderBottom: "1px solid #CBD5E1", padding: "10px", textAlign: "left", fontSize: "0.84rem", color: "#1E293B" }}>Teams</th>
                </tr>
              </thead>
              <tbody>
                {presenceRows.map((row) => (
                  <tr key={row.userId}>
                    <td style={{ borderBottom: "1px solid #E2E8F0", padding: "10px", color: "#334155" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={indicatorStyle(row.inOffice)} />
                        <span style={{ fontWeight: 700, color: row.inOffice ? "#166534" : "#B91C1C" }}>{row.statusLabel}</span>
                      </div>
                    </td>
                    <td style={{ borderBottom: "1px solid #E2E8F0", padding: "10px", color: "#0F172A", fontWeight: 600, textAlign: "left" }}>
                      {row.label}
                    </td>
                    <td style={{ borderBottom: "1px solid #E2E8F0", padding: "10px", color: "#334155", textAlign: "left", whiteSpace: "nowrap" }}>
                      {formatTimestamp(row.lastNoteAt)}
                    </td>
                    <td style={{ borderBottom: "1px solid #E2E8F0", padding: "10px", color: "#334155", textAlign: "left", maxWidth: "420px" }}>
                      <div style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>
                        {row.lastNote || <span style={{ color: "#94A3B8", fontWeight: 600 }}>No notes yet</span>}
                      </div>
                    </td>
                    <td style={{ borderBottom: "1px solid #E2E8F0", padding: "10px", textAlign: "left" }}>
                      {row.email ? (
                        <a
                          href={buildTeamsChatUrl(row.email)}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "6px",
                            textDecoration: "none",
                            border: "1px solid #93C5FD",
                            backgroundColor: "#EFF6FF",
                            color: "#1D4ED8",
                            borderRadius: "8px",
                            padding: "6px 10px",
                            fontSize: "0.83rem",
                            fontWeight: 700,
                          }}
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 28 28"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                            aria-hidden="true"
                            focusable="false"
                          >
                            <circle cx="21.5" cy="8" r="3.2" fill="#7B83EB" />
                            <circle cx="21" cy="20" r="4.1" fill="#6264A7" />
                            <rect x="4" y="6" width="15" height="16" rx="3" fill="#4F52B2" />
                            <path d="M8.6 10.2H14.8V12.1H12.8V18H10.6V12.1H8.6V10.2Z" fill="#FFFFFF" />
                          </svg>
                          Connect via Teams
                        </a>
                      ) : (
                        <span style={{ color: "#94A3B8", fontSize: "0.83rem", fontWeight: 600 }}>
                          No email
                        </span>
                      )}
                    </td>
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

export default TimeRotateOfficeStatus;
