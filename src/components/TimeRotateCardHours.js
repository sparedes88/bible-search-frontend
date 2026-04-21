import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase";
import commonStyles from "../pages/commonStyles";

const normalizeValue = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const normalizeKey = (value) =>
  normalizeValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const findFieldByAliases = (rowData = {}, aliases = []) => {
  const keys = Object.keys(rowData || {});
  const normalizedAliases = aliases.map((alias) => normalizeKey(alias));

  for (const key of keys) {
    if (normalizedAliases.includes(normalizeKey(key))) {
      return key;
    }
  }

  for (const alias of normalizedAliases) {
    const startsWithMatch = keys.find((key) => normalizeKey(key).startsWith(alias));
    if (startsWithMatch) return startsWithMatch;
  }

  for (const alias of normalizedAliases) {
    const includesMatch = keys.find((key) => normalizeKey(key).includes(alias));
    if (includesMatch) return includesMatch;
  }

  return null;
};

const DATA_STAGE_ALIASES = ["data stage", "datastage"];
const ISSUE_ID_ALIASES = ["issue id", "id", "task id", "card id", "row id"];
const TITLE_ALIASES = ["title", "issue title", "task title", "name"];
const PROJECT_NAME_ALIASES = ["project name", "project", "projectname"];

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
  }).format(new Date(value));
};

const toStartOfDayTimestamp = (dateValue) => {
  const normalizedDate = normalizeValue(dateValue);
  if (!normalizedDate) return Number.NaN;
  return Date.parse(`${normalizedDate}T00:00:00`);
};

const toEndOfDayTimestamp = (dateValue) => {
  const normalizedDate = normalizeValue(dateValue);
  if (!normalizedDate) return Number.NaN;
  return Date.parse(`${normalizedDate}T23:59:59.999`);
};

const hasTechnicalDetailTitle = (title) =>
  normalizeValue(title).toLowerCase().includes("technical detail");

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

const TimeRotateCardHours = () => {
  const { id } = useParams();
  const [productionCards, setProductionCards] = useState([]);
  const [timeLog, setTimeLog] = useState([]);
  const [organizationUsers, setOrganizationUsers] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [selectedCard, setSelectedCard] = useState("");
  const [selectedUser, setSelectedUser] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

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
        };
      });

      setTimeLog(nextLogs);
    });

    return () => unsubscribe();
  }, [id]);

  useEffect(() => {
    if (!id) return () => {};

    const unsubscribe = onSnapshot(collection(db, "churches", id, "bimProjects"), (snapshot) => {
      const nextCards = [];

      snapshot.forEach((projectDoc) => {
        const projectData = projectDoc.data() || {};
        const rows = Array.isArray(projectData.rows) ? projectData.rows : [];

        rows.forEach((row, rowIndex) => {
          const rowData = row?.rowData || {};
          const dataStageField = findFieldByAliases(rowData, DATA_STAGE_ALIASES) || "Data Stage";
          const dataStage = normalizeValue(rowData[dataStageField]);
          if (normalizeValue(dataStage).toLowerCase() !== "production") {
            return;
          }

          const issueIdField = findFieldByAliases(rowData, ISSUE_ID_ALIASES);
          const titleField = findFieldByAliases(rowData, TITLE_ALIASES);
          const projectNameField = findFieldByAliases(rowData, PROJECT_NAME_ALIASES);

          const issueId =
            normalizeValue(issueIdField ? rowData[issueIdField] : "") ||
            String(row?.rowNumber || rowIndex + 1);
          const title = normalizeValue(titleField ? rowData[titleField] : "");
          const projectName = normalizeValue(projectNameField ? rowData[projectNameField] : "");

          nextCards.push({
            issueId,
            title,
            projectName,
          });
        });
      });

      const dedupedByIssueId = [];
      const seen = new Set();
      nextCards.forEach((card) => {
        const issueKey = normalizeValue(card.issueId);
        if (!issueKey || seen.has(issueKey)) return;
        seen.add(issueKey);
        dedupedByIssueId.push(card);
      });

      setProductionCards(dedupedByIssueId.sort((left, right) => left.issueId.localeCompare(right.issueId)));
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

  const productionCardMapByIssueId = useMemo(() => {
    const map = {};
    productionCards.forEach((card) => {
      const key = normalizeValue(card.issueId);
      if (!key) return;
      map[key] = card;
    });
    return map;
  }, [productionCards]);

  const userOptions = useMemo(() => {
    return organizationUsers.map((entry) => ({ value: entry.userId, label: entry.label }));
  }, [organizationUsers]);

  const cardOptions = useMemo(() => {
    return productionCards.map((card) => ({
      value: card.issueId,
      label: `${card.issueId} - ${card.title || "No title"}`,
    }));
  }, [productionCards]);

  const filteredTimerLogs = useMemo(() => {
    const normalizedSearch = normalizeValue(searchText).toLowerCase();
    const startTimestamp = toStartOfDayTimestamp(startDate);
    const endTimestamp = toEndOfDayTimestamp(endDate);

    return timeLog
      .filter((entry) => entry.logType !== "completion")
      .filter((entry) => Number(entry.durationMs) > 0)
      .filter((entry) => {
        const issueId = normalizeValue(entry.issueId);
        if (!issueId) return false;
        return Boolean(productionCardMapByIssueId[issueId]);
      })
      .filter((entry) => {
        const eventTimestamp = Number(entry.endedAt || entry.startedAt || entry.completionAt) || 0;
        if (!eventTimestamp) return false;
        if (!Number.isNaN(startTimestamp) && eventTimestamp < startTimestamp) return false;
        if (!Number.isNaN(endTimestamp) && eventTimestamp > endTimestamp) return false;
        return true;
      })
      .filter((entry) => {
        if (!selectedUser) return true;
        const matchedUser = getOrganizationUserMatch(entry);
        const userKey = normalizeValue(matchedUser?.userId) || normalizeValue(entry.userId) || normalizeValue(entry.registeredBy);
        return userKey === selectedUser;
      })
      .filter((entry) => {
        if (!selectedCard) return true;
        return normalizeValue(entry.issueId) === selectedCard;
      })
      .filter((entry) => {
        if (!normalizedSearch) return true;
        const card = productionCardMapByIssueId[normalizeValue(entry.issueId)] || {};
        const matchedUser = getOrganizationUserMatch(entry);
        const haystack = [
          entry.issueId,
          card.title,
          card.projectName,
          entry.projectName,
          matchedUser?.label,
          entry.registeredBy,
        ]
          .map((value) => normalizeValue(value).toLowerCase())
          .join(" ");

        return haystack.includes(normalizedSearch);
      });
  }, [endDate, productionCardMapByIssueId, searchText, selectedCard, selectedUser, startDate, timeLog, organizationUsers]);

  const cardUserRollup = useMemo(() => {
    const rollupMap = {};

    filteredTimerLogs.forEach((entry) => {
      const issueId = normalizeValue(entry.issueId);
      const card = productionCardMapByIssueId[issueId] || {};
      const matchedUser = getOrganizationUserMatch(entry);
      const userKey = normalizeValue(matchedUser?.userId) || normalizeValue(entry.userId) || normalizeValue(entry.registeredBy) || "unknown-user";
      const userLabel = normalizeValue(matchedUser?.label) || normalizeValue(entry.registeredBy) || "Unknown user";
      const rollupKey = `${issueId}::${userKey}`;
      const eventTimestamp = Number(entry.endedAt || entry.startedAt || entry.completionAt) || 0;

      if (!rollupMap[rollupKey]) {
        rollupMap[rollupKey] = {
          rollupKey,
          issueId,
          title: normalizeValue(card.title),
          projectName: normalizeValue(card.projectName || entry.projectName),
          userKey,
          userLabel,
          totalDurationMs: 0,
          totalEntries: 0,
          firstAt: eventTimestamp,
          lastAt: eventTimestamp,
        };
      }

      rollupMap[rollupKey].totalDurationMs += Number(entry.durationMs) || 0;
      rollupMap[rollupKey].totalEntries += 1;
      if (eventTimestamp && (rollupMap[rollupKey].firstAt === 0 || eventTimestamp < rollupMap[rollupKey].firstAt)) {
        rollupMap[rollupKey].firstAt = eventTimestamp;
      }
      if (eventTimestamp > rollupMap[rollupKey].lastAt) {
        rollupMap[rollupKey].lastAt = eventTimestamp;
      }
    });

    return Object.values(rollupMap).sort((left, right) => {
      if (right.totalDurationMs !== left.totalDurationMs) {
        return right.totalDurationMs - left.totalDurationMs;
      }
      if (left.issueId !== right.issueId) {
        return left.issueId.localeCompare(right.issueId);
      }
      return left.userLabel.localeCompare(right.userLabel);
    });
  }, [filteredTimerLogs, productionCardMapByIssueId, organizationUsers]);

  const totalDurationAllRows = useMemo(() => {
    return cardUserRollup.reduce((sum, row) => sum + (Number(row.totalDurationMs) || 0), 0);
  }, [cardUserRollup]);

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
            <h1 style={{ ...commonStyles.title, marginBottom: "6px" }}>TimeRotate Card Hours</h1>
            <p style={{ margin: 0, color: "#475569" }}>
              Total production hours per card, broken down by user.
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
          <Link to={`${routePrefix}/${id}/time-rotate-card-hours`} style={tabStyle(true)}>
            Card Hours
          </Link>
          <Link to={`${routePrefix}/${id}/time-rotate-notes`} style={tabStyle(false)}>
            In Progress Notes
          </Link>
        </div>

        <div
          style={{
            marginTop: "10px",
            border: "1px solid #E2E8F0",
            backgroundColor: "#F8FAFC",
            borderRadius: "12px",
            padding: "12px",
            display: "grid",
            gap: "10px",
          }}
        >
          <div style={{ display: "grid", gap: "8px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <input
              type="text"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search by card, title, project, or user"
              style={{
                width: "100%",
                padding: "8px 10px",
                border: "1px solid #CBD5E1",
                borderRadius: "8px",
                backgroundColor: "#FFFFFF",
              }}
            />
            <select
              value={selectedUser}
              onChange={(event) => setSelectedUser(event.target.value)}
              style={filterControlStyle}
            >
              <option value="">All users</option>
              {userOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              value={selectedCard}
              onChange={(event) => setSelectedCard(event.target.value)}
              style={filterControlStyle}
            >
              <option value="">All production cards</option>
              {cardOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              max={endDate || undefined}
              style={filterControlStyle}
            />
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              min={startDate || undefined}
              style={filterControlStyle}
            />
          </div>

          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => {
                setSearchText("");
                setSelectedUser("");
                setSelectedCard("");
                setStartDate("");
                setEndDate("");
              }}
              style={{
                backgroundColor: "#334155",
                color: "#FFFFFF",
                border: "none",
                borderRadius: "8px",
                padding: "8px 12px",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Clear Filters
            </button>
            <div style={{ color: "#334155", fontWeight: 600, fontSize: "0.9rem" }}>
              {cardUserRollup.length} rows • Total {formatDuration(totalDurationAllRows)}
            </div>
          </div>
        </div>

        {cardUserRollup.length === 0 ? (
          <p style={{ marginTop: "12px", color: "#64748B" }}>
            No production card hours found for the current filters.
          </p>
        ) : (
          <div style={{ marginTop: "12px", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "980px" }}>
              <thead>
                <tr style={{ background: "#F8FAFC" }}>
                  <th style={cellHeaderStyle}>Card ID</th>
                  <th style={cellHeaderStyle}>Title</th>
                  <th style={cellHeaderStyle}>Project Name</th>
                  <th style={cellHeaderStyle}>User</th>
                  <th style={cellHeaderStyle}>Log Entries</th>
                  <th style={cellHeaderStyle}>Total Time</th>
                  <th style={cellHeaderStyle}>First Log</th>
                  <th style={cellHeaderStyle}>Last Log</th>
                </tr>
              </thead>
              <tbody>
                {cardUserRollup.map((row) => (
                  <tr key={row.rollupKey}>
                    <td style={cellStyle}>{row.issueId || "-"}</td>
                    <td style={cellStyle}>
                      {hasTechnicalDetailTitle(row.title)
                        ? `⭐ ${row.title || "-"}`
                        : (row.title || "-")}
                    </td>
                    <td style={cellStyle}>{row.projectName || "-"}</td>
                    <td style={cellStyle}>{row.userLabel || "Unknown user"}</td>
                    <td style={cellStyle}>{row.totalEntries}</td>
                    <td style={cellStyle}>{formatDuration(row.totalDurationMs)}</td>
                    <td style={cellStyle}>{formatTimestamp(row.firstAt)}</td>
                    <td style={cellStyle}>{formatTimestamp(row.lastAt)}</td>
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

const filterControlStyle = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #CBD5E1",
  borderRadius: "8px",
  backgroundColor: "#FFFFFF",
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

export default TimeRotateCardHours;
