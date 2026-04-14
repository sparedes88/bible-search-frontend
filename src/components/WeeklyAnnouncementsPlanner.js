import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import commonStyles from "../pages/commonStyles";

const toDateInput = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const getWeekStartDate = (inputDate = new Date()) => {
  const date = new Date(inputDate);
  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diffToMonday);
  date.setHours(0, 0, 0, 0);
  return date;
};

const addWeeks = (date, weeks) => {
  const next = new Date(date);
  next.setDate(next.getDate() + weeks * 7);
  return next;
};

const formatHeaderDate = (date) => {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const getWeekRangeLabel = (weekStart) => {
  const start = new Date(`${weekStart}T00:00:00`);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `${formatHeaderDate(start)} - ${formatHeaderDate(end)}`;
};

const getAnnouncementCount = (entries = []) => {
  return entries.reduce((sum, day) => sum + ((day?.announcements || []).length || 0), 0);
};

const getDaysPlanned = (entries = []) => {
  return entries.reduce((sum, day) => sum + (((day?.announcements || []).length || 0) > 0 ? 1 : 0), 0);
};

const hasRecurringItems = (entries = []) => {
  return entries.some((day) =>
    (day?.announcements || []).some((announcement) => {
      const mode = announcement?.recurringMode || "none";
      return mode !== "none";
    })
  );
};

const formatFirestoreDate = (timestamp) => {
  if (!timestamp || typeof timestamp?.toDate !== "function") return "Not saved yet";

  try {
    return timestamp.toDate().toLocaleString();
  } catch {
    return "Not saved yet";
  }
};

const WeeklyAnnouncementsPlanner = () => {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [weekCount, setWeekCount] = useState(8);
  const [windowStart, setWindowStart] = useState(() => toDateInput(getWeekStartDate()));
  const [weekRows, setWeekRows] = useState([]);

  const weekStartDates = useMemo(() => {
    const first = new Date(`${windowStart}T00:00:00`);
    return Array.from({ length: weekCount }, (_, index) => toDateInput(addWeeks(first, index)));
  }, [windowStart, weekCount]);

  useEffect(() => {
    const loadWeeks = async () => {
      if (!id) return;

      setLoading(true);

      try {
        const rows = await Promise.all(
          weekStartDates.map(async (weekStart) => {
            const ref = doc(db, "churches", id, "weeklyAnnouncements", weekStart);
            const snap = await getDoc(ref);

            if (!snap.exists()) {
              return {
                weekStart,
                exists: false,
                rangeLabel: getWeekRangeLabel(weekStart),
                announcements: 0,
                daysPlanned: 0,
                recurring: false,
                updatedAtLabel: "Not saved yet",
              };
            }

            const data = snap.data() || {};
            const entries = Array.isArray(data.entries) ? data.entries : [];

            return {
              weekStart,
              exists: true,
              rangeLabel: getWeekRangeLabel(weekStart),
              announcements: getAnnouncementCount(entries),
              daysPlanned: getDaysPlanned(entries),
              recurring: hasRecurringItems(entries),
              updatedAtLabel: formatFirestoreDate(data.updatedAt),
            };
          })
        );

        setWeekRows(rows);
      } catch (error) {
        console.error("Error loading weekly planning window:", error);
        setWeekRows([]);
      } finally {
        setLoading(false);
      }
    };

    loadWeeks();
  }, [id, weekStartDates]);

  const shiftWindow = (deltaWeeks) => {
    const current = new Date(`${windowStart}T00:00:00`);
    setWindowStart(toDateInput(addWeeks(current, deltaWeeks)));
  };

  const resetToCurrentWeek = () => {
    setWindowStart(toDateInput(getWeekStartDate()));
  };

  return (
    <div style={commonStyles.fullWidthContainer}>
      <Link to={`/organization/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to My Organization
      </Link>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <div>
          <h1 style={commonStyles.title}>Weekly Communication Planner</h1>
          <p style={{ marginTop: "6px", color: "#64748B" }}>
            See multiple weeks at once, then open each week to edit details.
          </p>
        </div>
      </div>

      <div
        style={{
          marginTop: "14px",
          marginBottom: "16px",
          padding: "12px",
          border: "1px solid #E2E8F0",
          borderRadius: "10px",
          backgroundColor: "#FFFFFF",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "10px",
          alignItems: "end",
        }}
      >
        <div>
          <label style={{ display: "block", fontSize: "0.82rem", color: "#475569", marginBottom: "4px" }}>
            Window start week
          </label>
          <input
            type="date"
            value={windowStart}
            onChange={(e) => setWindowStart(e.target.value)}
            style={{ width: "100%", border: "1px solid #CBD5E1", borderRadius: "8px", padding: "10px" }}
          />
        </div>

        <div>
          <label style={{ display: "block", fontSize: "0.82rem", color: "#475569", marginBottom: "4px" }}>
            Number of weeks
          </label>
          <select
            value={weekCount}
            onChange={(e) => setWeekCount(Number(e.target.value))}
            style={{ width: "100%", border: "1px solid #CBD5E1", borderRadius: "8px", padding: "10px" }}
          >
            <option value={4}>4 weeks</option>
            <option value={8}>8 weeks</option>
            <option value={12}>12 weeks</option>
            <option value={16}>16 weeks</option>
          </select>
        </div>

        <button
          type="button"
          onClick={() => shiftWindow(-weekCount)}
          style={{
            backgroundColor: "#F8FAFC",
            color: "#0F172A",
            border: "1px solid #CBD5E1",
            borderRadius: "8px",
            padding: "10px 14px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          ← Previous Window
        </button>

        <button
          type="button"
          onClick={() => shiftWindow(weekCount)}
          style={{
            backgroundColor: "#F8FAFC",
            color: "#0F172A",
            border: "1px solid #CBD5E1",
            borderRadius: "8px",
            padding: "10px 14px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Next Window →
        </button>

        <button
          type="button"
          onClick={resetToCurrentWeek}
          style={{
            backgroundColor: "#EEF2FF",
            color: "#3730A3",
            border: "1px solid #C7D2FE",
            borderRadius: "8px",
            padding: "10px 14px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Current Week
        </button>
      </div>

      {loading ? (
        <div style={{ color: "#64748B" }}>Loading planner weeks...</div>
      ) : (
        <div style={{ display: "grid", gap: "10px" }}>
          {weekRows.map((row) => (
            <div
              key={row.weekStart}
              style={{
                border: "1px solid #E2E8F0",
                borderRadius: "10px",
                padding: "12px",
                backgroundColor: row.exists ? "#FFFFFF" : "#F8FAFC",
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1fr 1fr 2fr auto",
                gap: "8px",
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontWeight: 800, color: "#0F172A" }}>{row.rangeLabel}</div>
                <div style={{ fontSize: "0.8rem", color: "#64748B" }}>Week key: {row.weekStart}</div>
              </div>

              <div style={{ fontSize: "0.88rem", color: "#1E293B" }}>Days Planned: {row.daysPlanned}/7</div>
              <div style={{ fontSize: "0.88rem", color: "#1E293B" }}>Announcements: {row.announcements}</div>
              <div style={{ fontSize: "0.88rem", color: row.recurring ? "#166534" : "#64748B", fontWeight: 700 }}>
                {row.recurring ? "Has Recurring" : "No Recurring"}
              </div>
              <div style={{ fontSize: "0.8rem", color: "#64748B" }}>Updated: {row.updatedAtLabel}</div>

              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", flexWrap: "wrap" }}>
                <Link
                  to={`/organization/${id}/weekly-announcements?weekStart=${row.weekStart}`}
                  style={{
                    backgroundColor: "#2563EB",
                    color: "white",
                    borderRadius: "8px",
                    padding: "8px 10px",
                    fontSize: "0.82rem",
                    fontWeight: 700,
                    textDecoration: "none",
                  }}
                >
                  Open Editor
                </Link>
                <Link
                  to={`/organization/${id}/weekly-announcements/public?weekStart=${row.weekStart}`}
                  style={{
                    backgroundColor: "#E2E8F0",
                    color: "#0F172A",
                    borderRadius: "8px",
                    padding: "8px 10px",
                    fontSize: "0.82rem",
                    fontWeight: 700,
                    textDecoration: "none",
                  }}
                >
                  Public View
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default WeeklyAnnouncementsPlanner;
