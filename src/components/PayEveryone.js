import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, deleteDoc, doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import commonStyles from "../pages/commonStyles";

const normalizeValue = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const toTimestampMs = (value) => {
  if (value === null || value === undefined) return 0;

  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && numericValue > 0) {
    return numericValue;
  }

  if (typeof value?.toMillis === "function") {
    const millisValue = Number(value.toMillis());
    return Number.isFinite(millisValue) && millisValue > 0 ? millisValue : 0;
  }

  if (typeof value?.seconds === "number") {
    const nanos = typeof value?.nanoseconds === "number" ? value.nanoseconds : 0;
    const secondsValue = (value.seconds * 1000) + Math.floor(nanos / 1000000);
    return Number.isFinite(secondsValue) && secondsValue > 0 ? secondsValue : 0;
  }

  return 0;
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

const formatDateOnly = (value) => {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
};

const resolveUserLabel = (entry) => {
  return (
    normalizeValue(entry.registeredBy)
    || normalizeValue(entry.userEmail)
    || normalizeValue(entry.userId)
    || "Unknown user"
  );
};

const normalizeComparable = (value) => normalizeValue(value).toLowerCase();

const toCurrency = (value) => {
  const numericValue = Number(value) || 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numericValue);
};

const toHours = (milliseconds) => {
  return Math.max(0, (Number(milliseconds) || 0) / (1000 * 60 * 60));
};

const formatHours = (milliseconds) => {
  return `${toHours(milliseconds).toFixed(2)} hrs`;
};

const WEEKS_PER_MONTH = 52 / 12;
const EXPECTED_SCHEDULE_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEFAULT_EXPECTED_START_TIME = "07:00";

const normalizeUserKey = ({ userId, userEmail, userLabel }) => {
  return normalizeComparable(userId || userEmail || userLabel).replace(/[^a-z0-9]+/g, "_");
};

const parseNumber = (value, fallbackValue = 0) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : fallbackValue;
};

const parseEffectiveDateInput = (rawInput) => {
  const normalizedInput = normalizeValue(rawInput);
  if (!normalizedInput) return Number.NaN;

  const isoCandidate = /^\d{4}-\d{2}-\d{2}$/.test(normalizedInput)
    ? `${normalizedInput}T00:00:00`
    : normalizedInput.replace(" ", "T");

  const parsedTimestamp = Date.parse(isoCandidate);
  return Number.isFinite(parsedTimestamp) ? parsedTimestamp : Number.NaN;
};

const normalizeExpectedSchedule = (value = {}) => {
  return EXPECTED_SCHEDULE_DAYS.reduce((result, day) => {
    const normalizedTime = normalizeValue(value?.[day]);
    result[day] = /^\d{2}:\d{2}$/.test(normalizedTime) ? normalizedTime : DEFAULT_EXPECTED_START_TIME;
    return result;
  }, {});
};

const formatScheduleTimeLabel = (value) => {
  const [hoursRaw, minutesRaw] = normalizeValue(value || DEFAULT_EXPECTED_START_TIME).split(":");
  const hours24 = Number(hoursRaw);
  const minutes = /^\d{2}$/.test(minutesRaw || "") ? minutesRaw : "00";
  if (!Number.isFinite(hours24)) return "7:00 AM";

  const suffix = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${minutes} ${suffix}`;
};

const summarizeExpectedSchedule = (value = {}) => {
  const schedule = normalizeExpectedSchedule(value);
  const uniqueTimes = Array.from(new Set(EXPECTED_SCHEDULE_DAYS.map((day) => schedule[day])));
  return uniqueTimes.length === 1 ? `${formatScheduleTimeLabel(uniqueTimes[0])} every day` : "Custom weekly schedule";
};

const getZonedDateParts = (timestamp, timeZone = "America/New_York") => {
  if (!Number.isFinite(Number(timestamp)) || Number(timestamp) <= 0) {
    return {
      year: 0,
      month: 0,
      day: 0,
      weekday: "Sun",
      hour: 0,
      minute: 0,
      dateKey: "",
    };
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date(timestamp));
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(lookup.year) || 0;
  const month = Number(lookup.month) || 0;
  const day = Number(lookup.day) || 0;
  const hour = Number(lookup.hour) || 0;
  const minute = Number(lookup.minute) || 0;
  const weekday = normalizeValue(lookup.weekday) || "Sun";
  const dateKey = year && month && day
    ? `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : "";

  return { year, month, day, weekday, hour, minute, dateKey };
};

const getMinutesFromTimeString = (value) => {
  const normalized = normalizeValue(value || DEFAULT_EXPECTED_START_TIME);
  const match = normalized.match(/^(\d{2}):(\d{2})$/);
  if (!match) return 7 * 60;
  return (Number(match[1]) * 60) + Number(match[2]);
};

const getWeekStartKeyFromDateKey = (dateKey) => {
  const [yearRaw, monthRaw, dayRaw] = normalizeValue(dateKey).split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!year || !month || !day) return "";

  const utcDate = new Date(Date.UTC(year, month - 1, day));
  utcDate.setUTCDate(utcDate.getUTCDate() - utcDate.getUTCDay());

  return `${utcDate.getUTCFullYear()}-${String(utcDate.getUTCMonth() + 1).padStart(2, "0")}-${String(utcDate.getUTCDate()).padStart(2, "0")}`;
};

const formatMinutesWithDirection = (minutesValue = 0) => {
  const roundedMinutes = Math.round(Number(minutesValue) || 0);
  const absoluteMinutes = Math.abs(roundedMinutes);
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  const durationLabel = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

  if (roundedMinutes === 0) return "On time";
  return roundedMinutes < 0 ? `${durationLabel} early` : `${durationLabel} late`;
};

const getPunctualityGrade = (averageLateMinutes) => {
  const lateMinutes = Math.max(0, Number(averageLateMinutes) || 0);
  if (lateMinutes <= 0) return "A+";
  if (lateMinutes <= 1) return "A";
  if (lateMinutes <= 10) return "B";
  if (lateMinutes <= 15) return "C";
  if (lateMinutes <= 30) return "D";
  return "F";
};

const getPunctualityColors = (grade) => {
  if (["A+", "A", "A-"].includes(grade)) {
    return { color: "#065F46", bg: "#ECFDF5", bar: "#16A34A" };
  }
  if (["B", "C"].includes(grade)) {
    return { color: "#92400E", bg: "#FFFBEB", bar: "#F59E0B" };
  }
  return { color: "#991B1B", bg: "#FEF2F2", bar: "#EF4444" };
};

const AttendanceTrackerTab = ({
  combinedUsers,
  rows,
  activeTimers,
  dateFilterPreset,
  setDateFilterPreset,
  userCompSettings,
  draftCompSettings,
  DATE_FILTER_OPTIONS,
  selectedUser,
  setSelectedUser,
  userOptions,
}) => {
  const [attendanceView, setAttendanceView] = useState("day");

  const attendanceEntries = useMemo(() => {
    const currentTimestamp = Date.now();
    const { startMs, endMs } = getRangeForPreset(dateFilterPreset);
    const attendanceSourceRows = [
      ...rows,
      ...(dateFilterPreset === "today"
        ? activeTimers.map((timerEntry) => ({
            userKey: timerEntry.userKey,
            userLabel: timerEntry.userLabel,
            startedAt: timerEntry.startedAt,
            endedAt: 0,
          }))
        : []),
    ];

    const filteredRows = attendanceSourceRows.filter((row) => {
      const referenceTimestamp = Number(row.startedAt) || Number(row.endedAt) || 0;
      const matchesUser = selectedUser === "all" || normalizeValue(row.userKey) === selectedUser;
      const matchesDate = Number.isFinite(startMs) && Number.isFinite(endMs)
        ? referenceTimestamp >= startMs && referenceTimestamp <= endMs
        : true;
      return matchesUser && matchesDate;
    });

    const firstClockInsByDay = new Map();
    filteredRows.forEach((row) => {
      const referenceTimestamp = Number(row.startedAt) || Number(row.endedAt) || 0;
      if (!referenceTimestamp) return;

      const effectiveComp = resolveEffectiveCompEntry({
        userKey: row.userKey,
        referenceTimestamp,
        savedSettingsMap: userCompSettings,
        draftSettingsMap: draftCompSettings,
        includeDraftPreview: false,
      });

      const schedule = normalizeExpectedSchedule(effectiveComp.expectedSchedule);
      const scheduleTimezone = normalizeValue(effectiveComp.scheduleTimezone) || "America/New_York";
      const zonedParts = getZonedDateParts(referenceTimestamp, scheduleTimezone);
      if (!zonedParts.dateKey) return;

      const scheduledTime = schedule[zonedParts.weekday] || DEFAULT_EXPECTED_START_TIME;
      const expectedMinutes = getMinutesFromTimeString(scheduledTime);
      const actualMinutes = (zonedParts.hour * 60) + zonedParts.minute;
      const diffMinutes = actualMinutes - expectedMinutes;
      const entryKey = `${normalizeValue(row.userKey)}::${zonedParts.dateKey}`;
      const currentEntry = firstClockInsByDay.get(entryKey);

      if (!currentEntry || referenceTimestamp < currentEntry.firstStartTimestamp) {
        firstClockInsByDay.set(entryKey, {
          userKey: normalizeValue(row.userKey),
          userLabel: normalizeValue(row.userLabel) || normalizeValue(row.userKey) || "Unknown user",
          dateKey: zonedParts.dateKey,
          weekday: zonedParts.weekday,
          weekKey: getWeekStartKeyFromDateKey(zonedParts.dateKey),
          firstStartTimestamp: referenceTimestamp,
          expectedStartTime: scheduledTime,
          actualStartMinutes: actualMinutes,
          expectedStartMinutes: expectedMinutes,
          diffMinutes,
          scheduleTimezone,
        });
      }
    });

    const dayEntries = Array.from(firstClockInsByDay.values())
      .sort((left, right) => {
        const userCompare = normalizeValue(left.userLabel).localeCompare(normalizeValue(right.userLabel));
        if (userCompare !== 0) return userCompare;
        return normalizeValue(right.dateKey).localeCompare(normalizeValue(left.dateKey));
      });

    if (attendanceView === "day" && dateFilterPreset === "today") {
      combinedUsers.forEach((userEntry) => {
        const userKey = normalizeValue(userEntry.userKey);
        if (!userKey) return;
        if (selectedUser !== "all" && userKey !== selectedUser) return;

        const effectiveComp = resolveEffectiveCompEntry({
          userKey,
          referenceTimestamp: currentTimestamp,
          savedSettingsMap: userCompSettings,
          draftSettingsMap: draftCompSettings,
          includeDraftPreview: false,
        });

        const schedule = normalizeExpectedSchedule(effectiveComp.expectedSchedule);
        const scheduleTimezone = normalizeValue(effectiveComp.scheduleTimezone) || "America/New_York";
        const zonedParts = getZonedDateParts(currentTimestamp, scheduleTimezone);
        if (!zonedParts.dateKey) return;

        const missingEntryKey = `${userKey}::${zonedParts.dateKey}`;
        if (firstClockInsByDay.has(missingEntryKey)) return;

        const scheduledTime = schedule[zonedParts.weekday] || DEFAULT_EXPECTED_START_TIME;
        const expectedMinutes = getMinutesFromTimeString(scheduledTime);

        firstClockInsByDay.set(missingEntryKey, {
          userKey,
          userLabel: normalizeValue(userEntry.userLabel) || userKey,
          dateKey: zonedParts.dateKey,
          weekday: zonedParts.weekday,
          weekKey: getWeekStartKeyFromDateKey(zonedParts.dateKey),
          firstStartTimestamp: 0,
          expectedStartTime: scheduledTime,
          actualStartMinutes: 0,
          expectedStartMinutes: expectedMinutes,
          diffMinutes: 0,
          scheduleTimezone,
          isAbsent: true,
        });
      });
    }

    const dayEntriesWithAbsences = Array.from(firstClockInsByDay.values())
      .sort((left, right) => {
        const userCompare = normalizeValue(left.userLabel).localeCompare(normalizeValue(right.userLabel));
        if (userCompare !== 0) return userCompare;
        return normalizeValue(right.dateKey).localeCompare(normalizeValue(left.dateKey));
      });

    if (attendanceView === "day") {
      return dayEntriesWithAbsences.map((entry) => {
        if (entry.isAbsent) {
          const grade = "F";
          return {
            ...entry,
            trackedDays: 1,
            onTimeDays: 0,
            totalLateMinutes: 0,
            totalEarlyMinutes: 0,
            averageLateMinutes: 0,
            grade,
            ...getPunctualityColors(grade),
          };
        }

        const lateMinutes = Math.max(0, entry.diffMinutes);
        let grade = getPunctualityGrade(lateMinutes);
        let attendanceNote = "";

        if (entry.diffMinutes <= -30) {
          grade = "A+";
        } else if (entry.diffMinutes <= -15) {
          grade = "A";
          attendanceNote = "Started 15+ min before schedule";
        } else if (entry.diffMinutes <= -5) {
          grade = "A-";
        }

        return {
          ...entry,
          trackedDays: 1,
          onTimeDays: entry.diffMinutes <= 0 ? 1 : 0,
          totalLateMinutes: lateMinutes,
          totalEarlyMinutes: Math.max(0, -entry.diffMinutes),
          averageLateMinutes: lateMinutes,
          attendanceNote,
          grade,
          ...getPunctualityColors(grade),
        };
      });
    }

    const weeklyMap = new Map();
    dayEntriesWithAbsences.forEach((entry) => {
      const aggregateKey = `${entry.userKey}::${entry.weekKey}`;
      const current = weeklyMap.get(aggregateKey) || {
        userKey: entry.userKey,
        userLabel: entry.userLabel,
        periodKey: entry.weekKey,
        trackedDays: 0,
        onTimeDays: 0,
        totalLateMinutes: 0,
        totalEarlyMinutes: 0,
      };

      current.trackedDays += 1;
      if (entry.diffMinutes <= 0) current.onTimeDays += 1;
      current.totalLateMinutes += Math.max(0, entry.diffMinutes);
      current.totalEarlyMinutes += Math.max(0, -entry.diffMinutes);

      weeklyMap.set(aggregateKey, current);
    });

    return Array.from(weeklyMap.values())
      .map((entry) => {
        const averageLateMinutes = entry.trackedDays > 0 ? entry.totalLateMinutes / entry.trackedDays : 0;
        const grade = getPunctualityGrade(averageLateMinutes);
        return {
          ...entry,
          grade,
          averageLateMinutes,
          ...getPunctualityColors(grade),
        };
      })
      .sort((left, right) => {
        const userCompare = normalizeValue(left.userLabel).localeCompare(normalizeValue(right.userLabel));
        if (userCompare !== 0) return userCompare;
        return normalizeValue(right.periodKey).localeCompare(normalizeValue(left.periodKey));
      });
  }, [activeTimers, attendanceView, combinedUsers, dateFilterPreset, draftCompSettings, rows, selectedUser, userCompSettings]);

  const attendanceSummary = useMemo(() => {
    return attendanceEntries.reduce((summary, entry) => {
      summary.trackedPeriods += 1;
      summary.trackedDays += Number(entry.trackedDays) || 0;
      summary.onTimeDays += Number(entry.onTimeDays) || 0;
      summary.totalLateMinutes += Number(entry.totalLateMinutes) || 0;
      summary.totalEarlyMinutes += Number(entry.totalEarlyMinutes) || 0;
      return summary;
    }, {
      trackedPeriods: 0,
      trackedDays: 0,
      onTimeDays: 0,
      totalLateMinutes: 0,
      totalEarlyMinutes: 0,
    });
  }, [attendanceEntries]);

  const summaryAverageLateMinutes = attendanceSummary.trackedDays > 0
    ? attendanceSummary.totalLateMinutes / attendanceSummary.trackedDays
    : 0;
  const summaryGrade = getPunctualityGrade(summaryAverageLateMinutes);
  const summaryColors = getPunctualityColors(summaryGrade);
  const onTimePct = attendanceSummary.trackedDays > 0
    ? (attendanceSummary.onTimeDays / attendanceSummary.trackedDays) * 100
    : 0;

  return (
    <div style={{ marginTop: "12px" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "10px",
          marginBottom: "14px",
        }}
      >
        <div>
          <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
            Date Range
          </label>
          <select
            value={dateFilterPreset}
            onChange={(event) => setDateFilterPreset(event.target.value)}
            style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
          >
            {DATE_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
            User
          </label>
          <select
            value={selectedUser}
            onChange={(event) => setSelectedUser(event.target.value)}
            style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
          >
            <option value="all">All Users</option>
            {userOptions.map((userOption) => (
              <option key={userOption.userKey} value={userOption.userKey}>{userOption.userLabel}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
            View By
          </label>
          <select
            value={attendanceView}
            onChange={(event) => setAttendanceView(event.target.value)}
            style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
          >
            <option value="day">Day</option>
            <option value="week">Week</option>
          </select>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "10px",
          marginBottom: "14px",
        }}
      >
        <div style={{ backgroundColor: summaryColors.bg, color: summaryColors.color, borderRadius: "12px", padding: "14px" }}>
          <div style={{ fontSize: "0.78rem", fontWeight: 700, opacity: 0.85 }}>Overall Grade</div>
          <div style={{ fontSize: "1.8rem", fontWeight: 800 }}>{summaryGrade}</div>
          <div style={{ fontSize: "0.82rem" }}>Avg late: {formatMinutesWithDirection(summaryAverageLateMinutes)}</div>
        </div>
        <div style={{ backgroundColor: "#EFF6FF", color: "#1D4ED8", borderRadius: "12px", padding: "14px" }}>
          <div style={{ fontSize: "0.78rem", fontWeight: 700, opacity: 0.85 }}>On-Time Rate</div>
          <div style={{ fontSize: "1.8rem", fontWeight: 800 }}>{onTimePct.toFixed(0)}%</div>
          <div style={{ fontSize: "0.82rem" }}>{attendanceSummary.onTimeDays} of {attendanceSummary.trackedDays} days</div>
        </div>
        <div style={{ backgroundColor: "#ECFDF5", color: "#065F46", borderRadius: "12px", padding: "14px" }}>
          <div style={{ fontSize: "0.78rem", fontWeight: 700, opacity: 0.85 }}>Total Early</div>
          <div style={{ fontSize: "1.8rem", fontWeight: 800 }}>{formatMinutesWithDirection(-attendanceSummary.totalEarlyMinutes)}</div>
          <div style={{ fontSize: "0.82rem" }}>{attendanceSummary.trackedPeriods} tracked {attendanceView === "day" ? "days" : "weeks"}</div>
        </div>
        <div style={{ backgroundColor: "#FEF2F2", color: "#991B1B", borderRadius: "12px", padding: "14px" }}>
          <div style={{ fontSize: "0.78rem", fontWeight: 700, opacity: 0.85 }}>Total Late</div>
          <div style={{ fontSize: "1.8rem", fontWeight: 800 }}>{formatMinutesWithDirection(attendanceSummary.totalLateMinutes)}</div>
          <div style={{ fontSize: "0.82rem" }}>Across all tracked start times</div>
        </div>
      </div>

      <div style={{ marginLeft: "-16px", marginRight: "-16px", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ backgroundColor: "#F8FAFC" }}>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>User</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>{attendanceView === "day" ? "Day" : "Week"}</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>Grade</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>{attendanceView === "day" ? "Expected" : "Tracked Days"}</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>{attendanceView === "day" ? "First Start" : "On Time"}</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>Total Early</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>Total Late</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>{attendanceView === "day" ? "Variance" : "Avg Late"}</th>
            </tr>
          </thead>
          <tbody>
            {attendanceEntries.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: "14px", color: "#64748B" }}>No attendance data found for the selected filters.</td>
              </tr>
            ) : (
              attendanceEntries.map((entry) => (
                <tr key={`${entry.userKey}-${entry.dateKey || entry.periodKey}`} style={{ backgroundColor: entry.bg }}>
                  <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#0F172A", fontWeight: 700 }}>
                    {entry.userLabel}
                  </td>
                  <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>
                    {attendanceView === "day" ? `${entry.weekday} ${entry.dateKey}` : `Week of ${entry.periodKey}`}
                  </td>
                  <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: entry.color, fontWeight: 800 }}>
                    <div>{entry.grade}</div>
                    {attendanceView === "day" && entry.attendanceNote ? (
                      <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#475569", marginTop: "2px" }}>
                        {entry.attendanceNote}
                      </div>
                    ) : null}
                  </td>
                  <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>
                    {attendanceView === "day" ? formatScheduleTimeLabel(entry.expectedStartTime) : entry.trackedDays}
                  </td>
                  <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>
                    {attendanceView === "day"
                      ? (entry.isAbsent
                        ? "Not signed"
                        : `${formatScheduleTimeLabel(`${String(Math.floor(entry.actualStartMinutes / 60)).padStart(2, "0")}:${String(entry.actualStartMinutes % 60).padStart(2, "0")}`)} (${entry.scheduleTimezone})`)
                      : `${entry.onTimeDays} / ${entry.trackedDays}`}
                  </td>
                  <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#065F46", fontWeight: 700 }}>
                    {entry.totalEarlyMinutes > 0 ? formatMinutesWithDirection(-entry.totalEarlyMinutes) : "-"}
                  </td>
                  <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#991B1B", fontWeight: 700 }}>
                    {entry.isAbsent
                      ? "Not signed"
                      : (entry.totalLateMinutes > 0 ? formatMinutesWithDirection(entry.totalLateMinutes) : "-")}
                  </td>
                  <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: entry.diffMinutes <= 0 || entry.averageLateMinutes <= 0 ? "#065F46" : "#991B1B", fontWeight: 700 }}>
                    {attendanceView === "day"
                      ? (entry.isAbsent ? "Absent" : formatMinutesWithDirection(entry.diffMinutes))
                      : formatMinutesWithDirection(entry.averageLateMinutes)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const normalizeCompSnapshot = (value = {}) => {
  return {
    billingType: normalizeValue(value.billingType) === "salary" ? "salary" : "hourly",
    hourlyRate: parseNumber(value.hourlyRate),
    monthlySalary: parseNumber(value.monthlySalary),
    // Expected hours are stored as weekly expected hours.
    expectedHours: parseNumber(value.expectedHours, 40),
    overtimeApproved: value.overtimeApproved === true,
  };
};

const areCompSnapshotsEqual = (leftValue = {}, rightValue = {}) => {
  const leftSnapshot = normalizeCompSnapshot(leftValue);
  const rightSnapshot = normalizeCompSnapshot(rightValue);
  return (
    leftSnapshot.billingType === rightSnapshot.billingType
    && Number(leftSnapshot.hourlyRate) === Number(rightSnapshot.hourlyRate)
    && Number(leftSnapshot.monthlySalary) === Number(rightSnapshot.monthlySalary)
    && Number(leftSnapshot.expectedHours) === Number(rightSnapshot.expectedHours)
    && leftSnapshot.overtimeApproved === rightSnapshot.overtimeApproved
  );
};

const normalizeChangeLog = (changeLogValue = []) => {
  if (!Array.isArray(changeLogValue)) return [];

  return changeLogValue
    .map((entry) => ({
      effectiveFrom: toTimestampMs(entry?.effectiveFrom),
      changedAt: toTimestampMs(entry?.changedAt),
      ...normalizeCompSnapshot(entry),
    }))
    .filter((entry) => Number.isFinite(entry.effectiveFrom))
    .sort((left, right) => Number(left.effectiveFrom || 0) - Number(right.effectiveFrom || 0));
};

const getFallbackLogFromLegacyFields = (settingsValue = {}) => {
  const hasLegacyFields =
    settingsValue
    && (
      settingsValue.billingType !== undefined
      || settingsValue.hourlyRate !== undefined
      || settingsValue.monthlySalary !== undefined
      || settingsValue.expectedHours !== undefined
    );

  if (!hasLegacyFields) return [];

  return [
    {
      effectiveFrom: 0,
      changedAt: toTimestampMs(settingsValue.updatedAt) || Date.now(),
      ...normalizeCompSnapshot(settingsValue),
    },
  ];
};

const resolveEffectiveCompEntry = ({
  userKey,
  referenceTimestamp,
  savedSettingsMap,
  draftSettingsMap,
  includeDraftPreview = true,
} = {}) => {
  const savedSettings = savedSettingsMap?.[userKey] || {};
  const draftSettings = draftSettingsMap?.[userKey] || {};
  const savedChangeLog = normalizeChangeLog(savedSettings.changeLog);
  const baseLog = savedChangeLog.length > 0 ? savedChangeLog : getFallbackLogFromLegacyFields(savedSettings);
  const nextLog = [...baseLog];

  if (includeDraftPreview && draftSettings && Object.keys(draftSettings).length > 0) {
    const draftSnapshot = normalizeCompSnapshot(draftSettings);
    const latestSnapshot = nextLog.length > 0 ? nextLog[nextLog.length - 1] : null;

    if (!latestSnapshot || !areCompSnapshotsEqual(latestSnapshot, draftSnapshot)) {
      nextLog.push({
        effectiveFrom: nextLog.length === 0 ? 0 : Date.now(),
        changedAt: Date.now(),
        ...draftSnapshot,
      });
    }
  }

  if (nextLog.length === 0) {
    return {
      effectiveFrom: 0,
      changedAt: 0,
      billingType: "hourly",
      hourlyRate: 0,
      monthlySalary: 0,
      expectedHours: 160,
    };
  }

  const safeTimestamp = Number(referenceTimestamp) || 0;
  const matched = nextLog
    .filter((entry) => Number(entry.effectiveFrom || 0) <= safeTimestamp)
    .sort((left, right) => Number(right.effectiveFrom || 0) - Number(left.effectiveFrom || 0))[0];

  return matched || nextLog[0];
};

const startOfDay = (value = new Date()) => {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

const addDays = (value, days) => {
  const date = startOfDay(value);
  date.setDate(date.getDate() + days);
  return date;
};

const startOfWeek = (value = new Date()) => {
  const dayStart = startOfDay(value);
  const dayOfWeek = dayStart.getDay();
  return addDays(dayStart, -dayOfWeek);
};

const getRangeForPreset = (preset) => {
  const today = startOfDay(new Date());

  switch (preset) {
    case "today":
      return { startMs: today.getTime(), endMs: addDays(today, 1).getTime() - 1 };
    case "yesterday": {
      const yesterday = addDays(today, -1);
      return { startMs: yesterday.getTime(), endMs: today.getTime() - 1 };
    }
    case "thisWeek": {
      const dayOfWeek = today.getDay();
      const weekStart = addDays(today, -dayOfWeek);
      return { startMs: weekStart.getTime(), endMs: addDays(weekStart, 7).getTime() - 1 };
    }
    case "lastWeek": {
      const dayOfWeek = today.getDay();
      const thisWeekStart = addDays(today, -dayOfWeek);
      const lastWeekStart = addDays(thisWeekStart, -7);
      return { startMs: lastWeekStart.getTime(), endMs: thisWeekStart.getTime() - 1 };
    }
    case "thisMonth": {
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const nextMonthStart = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      return { startMs: monthStart.getTime(), endMs: nextMonthStart.getTime() - 1 };
    }
    case "lastMonth": {
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const previousMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      return { startMs: previousMonthStart.getTime(), endMs: monthStart.getTime() - 1 };
    }
    case "last3Months": {
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const threeMonthsAgoStart = new Date(today.getFullYear(), today.getMonth() - 2, 1);
      const nextMonthStart = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      return { startMs: threeMonthsAgoStart.getTime(), endMs: nextMonthStart.getTime() - 1 };
    }
    case "thisYear": {
      const yearStart = new Date(today.getFullYear(), 0, 1);
      const nextYearStart = new Date(today.getFullYear() + 1, 0, 1);
      return { startMs: yearStart.getTime(), endMs: nextYearStart.getTime() - 1 };
    }
    case "lastYear": {
      const thisYearStart = new Date(today.getFullYear(), 0, 1);
      const lastYearStart = new Date(today.getFullYear() - 1, 0, 1);
      return { startMs: lastYearStart.getTime(), endMs: thisYearStart.getTime() - 1 };
    }
    case "all":
    default:
      return { startMs: Number.NaN, endMs: Number.NaN };
  }
};

const DATE_FILTER_OPTIONS = [
  { value: "all", label: "All Time" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "thisWeek", label: "This Week" },
  { value: "lastWeek", label: "Last Week" },
  { value: "thisMonth", label: "This Month" },
  { value: "lastMonth", label: "Last Month" },
  { value: "last3Months", label: "Last 3 Months" },
  { value: "thisYear", label: "This Year" },
  { value: "lastYear", label: "Last Year" },
];

const cardStyle = {
  backgroundColor: "#FFFFFF",
  border: "1px solid #E2E8F0",
  borderRadius: "14px",
  padding: "16px",
  boxShadow: "0 8px 24px rgba(15, 23, 42, 0.06)",
};

const HoursTrackerTab = ({
  combinedUsers,
  rows,
  dateFilterPreset,
  setDateFilterPreset,
  userCompSettings,
  draftCompSettings,
  DATE_FILTER_OPTIONS,
}) => {
  const { startMs, endMs } = getRangeForPreset(dateFilterPreset);

  // Compute period length in weeks (defaults to 1 week when no range is active)
  const periodMs = (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs)
    ? endMs - startMs
    : 7 * 24 * 60 * 60 * 1000;
  const periodWeeks = periodMs / (7 * 24 * 60 * 60 * 1000);

  const trackerRows = combinedUsers.map((entry) => {
    const effectiveComp = resolveEffectiveCompEntry({
      userKey: entry.userKey,
      referenceTimestamp: Date.now(),
      savedSettingsMap: userCompSettings,
      draftSettingsMap: draftCompSettings,
      includeDraftPreview: false,
    });

    const expectedWeeklyHours = parseNumber(effectiveComp.expectedHours, 40);
    const expectedPeriodHours = expectedWeeklyHours * periodWeeks;

    const actualMs = rows
      .filter((row) => {
        const ts = Number(row.endedAt) || Number(row.startedAt) || 0;
        const matchesUser = normalizeValue(row.userKey) === entry.userKey;
        const matchesDate = Number.isFinite(startMs) && Number.isFinite(endMs)
          ? ts >= startMs && ts <= endMs
          : true;
        return matchesUser && matchesDate;
      })
      .reduce((sum, row) => sum + (Number(row.durationMs) || 0), 0);

    const actualHours = actualMs / (1000 * 60 * 60);
    const diffHours = actualHours - expectedPeriodHours;
    const pct = expectedPeriodHours > 0 ? (actualHours / expectedPeriodHours) * 100 : 100;

    let statusColor, statusBg, statusLabel;
    if (pct >= 100) {
      statusColor = "#065F46"; statusBg = "#ECFDF5"; statusLabel = "On Track";
    } else if (pct >= 80) {
      statusColor = "#92400E"; statusBg = "#FFFBEB"; statusLabel = "Almost";
    } else {
      statusColor = "#991B1B"; statusBg = "#FEF2F2"; statusLabel = "Behind";
    }

    return { entry, expectedPeriodHours, actualHours, diffHours, pct, statusColor, statusBg, statusLabel };
  });

  return (
    <div style={{ marginTop: "12px" }}>
      <div style={{ marginBottom: "12px", maxWidth: "260px" }}>
        <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
          Date Range
        </label>
        <select
          value={dateFilterPreset}
          onChange={(event) => setDateFilterPreset(event.target.value)}
          style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
        >
          {DATE_FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      <div style={{ marginLeft: "-16px", marginRight: "-16px", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ backgroundColor: "#F8FAFC" }}>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>User</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>Expected Hrs</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>Actual Hrs</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>Difference</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>% of Goal</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {trackerRows.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: "14px", color: "#64748B" }}>No users found.</td>
              </tr>
            ) : (
              trackerRows.map(({ entry, expectedPeriodHours, actualHours, diffHours, pct, statusColor, statusBg, statusLabel }) => {
                const isAhead = diffHours >= 0;
                const absDiff = Math.abs(diffHours);
                return (
                  <tr key={entry.userKey} style={{ backgroundColor: statusBg }}>
                    <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#0F172A", fontWeight: 700 }}>
                      {entry.userLabel || entry.userKey}
                    </td>
                    <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>
                      {expectedPeriodHours.toFixed(1)} hrs
                    </td>
                    <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#0F172A", fontWeight: 700 }}>
                      {actualHours.toFixed(1)} hrs
                    </td>
                    <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: isAhead ? "#065F46" : "#991B1B", fontWeight: 700 }}>
                      {isAhead ? "+" : "-"}{absDiff.toFixed(1)} hrs
                    </td>
                    <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{ flex: 1, backgroundColor: "#E2E8F0", borderRadius: "999px", height: "8px", overflow: "hidden" }}>
                          <div style={{
                            width: `${Math.min(pct, 100).toFixed(1)}%`,
                            height: "100%",
                            borderRadius: "999px",
                            backgroundColor: pct >= 100 ? "#22C55E" : pct >= 80 ? "#F59E0B" : "#EF4444",
                          }} />
                        </div>
                        <span style={{ color: statusColor, fontWeight: 700, fontSize: "0.82rem", minWidth: "40px" }}>
                          {pct.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9" }}>
                      <span style={{
                        backgroundColor: statusBg,
                        color: statusColor,
                        border: `1px solid ${statusColor}`,
                        borderRadius: "999px",
                        padding: "3px 10px",
                        fontWeight: 700,
                        fontSize: "0.78rem",
                      }}>
                        {statusLabel}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const PayEveryone = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const saveTimersRef = React.useRef({});
  const handleSaveRef = React.useRef(null);
  const [activeTab, setActiveTab] = useState("time");
  const [rows, setRows] = useState([]);
  const [activeTimers, setActiveTimers] = useState([]);
  const [organizationUsers, setOrganizationUsers] = useState([]);
  const [userCompSettings, setUserCompSettings] = useState({});
  const [draftCompSettings, setDraftCompSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingUserKey, setSavingUserKey] = useState("");
  const [deletingUserKey, setDeletingUserKey] = useState("");
  const [expandedScheduleEditors, setExpandedScheduleEditors] = useState({});
  const [dateFilterPreset, setDateFilterPreset] = useState("today");
  const [searchInput, setSearchInput] = useState("");
  const [selectedUser, setSelectedUser] = useState("all");
  const [selectedProject, setSelectedProject] = useState("all");

  const routePrefix =
    typeof window !== "undefined" && window.location?.pathname?.includes("/church/")
      ? "/church"
      : "/organization";

  const normalizedRole = String(user?.role || user?.customRole || "").trim().toLowerCase();
  const isGlobalAdminUser = ["global_admin", "system_global_admin"].includes(normalizedRole);

  useEffect(() => {
    if (!id) {
      setRows([]);
      setLoading(false);
      return () => {};
    }

    const unsubscribe = onSnapshot(
      collection(db, "churches", id, "timeRotateLogs"),
      (snapshot) => {
        const nextRows = snapshot.docs
          .map((snapshotDoc) => {
            const data = snapshotDoc.data() || {};
            const startedAt = toTimestampMs(data.startedAt);
            const endedAt = toTimestampMs(data.endedAt);
            const durationMs = Number(data.durationMs) || 0;

            return {
              id: snapshotDoc.id,
              issueId: normalizeValue(data.issueId),
              projectName: normalizeValue(data.projectName),
              userId: normalizeValue(data.userId),
              userEmail: normalizeValue(data.userEmail),
              userLabel: resolveUserLabel(data),
              userKey: normalizeUserKey({
                userId: normalizeValue(data.userId),
                userEmail: normalizeValue(data.userEmail),
                userLabel: resolveUserLabel(data),
              }),
              durationMs,
              startedAt,
              endedAt,
              logType: normalizeValue(data.logType) || "timer",
            };
          })
          .filter((entry) => entry.logType !== "completion")
          .filter((entry) => entry.durationMs > 0)
          .sort((left, right) => (Number(right.endedAt) || 0) - (Number(left.endedAt) || 0));

        setRows(nextRows);
        setLoading(false);
      },
      () => {
        setRows([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [id]);

  useEffect(() => {
    if (!id) {
      setActiveTimers([]);
      return () => {};
    }

    const unsubscribe = onSnapshot(
      collection(db, "churches", id, "timeRotateActiveTimers"),
      (snapshot) => {
        const nextActiveTimers = snapshot.docs
          .map((snapshotDoc) => {
            const data = snapshotDoc.data() || {};
            const userId = normalizeValue(data.userId);
            const userEmail = normalizeValue(data.userEmail);
            const userLabel = resolveUserLabel(data);

            return {
              id: snapshotDoc.id,
              userId,
              userEmail,
              userLabel,
              userKey: normalizeUserKey({ userId, userEmail, userLabel }),
              startedAt: toTimestampMs(data.startedAt),
            };
          })
          .filter((entry) => Number.isFinite(entry.startedAt) && entry.startedAt > 0)
          .sort((left, right) => (Number(right.startedAt) || 0) - (Number(left.startedAt) || 0));

        setActiveTimers(nextActiveTimers);
      },
      () => {
        setActiveTimers([]);
      }
    );

    return () => unsubscribe();
  }, [id]);

  useEffect(() => {
    if (!id) {
      setOrganizationUsers([]);
      return () => {};
    }

    const unsubscribe = onSnapshot(collection(db, "users"), (snapshot) => {
      const nextUsers = snapshot.docs
        .map((snapshotDoc) => {
          const data = snapshotDoc.data() || {};
          const scopedOrganizationId = normalizeValue(
            data.churchId || data.churchID || data.organizationId || data.idIglesia
          );

          if (String(scopedOrganizationId) !== String(id)) {
            return null;
          }

          const userId = normalizeValue(snapshotDoc.id);
          const userEmail = normalizeValue(data.email);
          const userLabel =
            normalizeValue(data.fullName)
            || normalizeValue(data.name)
            || normalizeValue(data.displayName)
            || userEmail
            || userId;

          return {
            userId,
            userEmail,
            userLabel,
            userKey: normalizeUserKey({ userId, userEmail, userLabel }),
          };
        })
        .filter(Boolean)
        .sort((left, right) => left.userLabel.localeCompare(right.userLabel));

      setOrganizationUsers(nextUsers);
    });

    return () => unsubscribe();
  }, [id]);

  useEffect(() => {
    if (!id) {
      setUserCompSettings({});
      return () => {};
    }

    const unsubscribe = onSnapshot(collection(db, "churches", id, "payEveryoneUserSettings"), (snapshot) => {
      const nextSettings = {};
      snapshot.docs.forEach((snapshotDoc) => {
        const data = snapshotDoc.data() || {};
        const userKey = normalizeValue(data.userKey || snapshotDoc.id);
        if (!userKey) return;

        nextSettings[userKey] = {
          docId: snapshotDoc.id,
          userKey,
          userId: normalizeValue(data.userId),
          userEmail: normalizeValue(data.userEmail),
          userLabel: normalizeValue(data.userLabel),
          billingType: normalizeValue(data.billingType) === "salary" ? "salary" : "hourly",
          hourlyRate: parseNumber(data.hourlyRate),
          monthlySalary: parseNumber(data.monthlySalary),
          expectedHours: parseNumber(data.expectedHours),
          overtimeApproved: data.overtimeApproved === true,
          expectedSchedule: normalizeExpectedSchedule(data.expectedSchedule),
          scheduleTimezone: normalizeValue(data.scheduleTimezone) || "",
          changeLog: normalizeChangeLog(data.changeLog),
        };
      });

      setUserCompSettings(nextSettings);
    });

    return () => unsubscribe();
  }, [id]);

  const combinedUsers = useMemo(() => {
    const userMap = new Map();

    organizationUsers.forEach((entry) => {
      if (!entry.userKey) return;
      userMap.set(entry.userKey, entry);
    });

    rows.forEach((entry) => {
      if (!entry.userKey || userMap.has(entry.userKey)) return;
      userMap.set(entry.userKey, {
        userKey: entry.userKey,
        userId: normalizeValue(entry.userId),
        userEmail: normalizeValue(entry.userEmail),
        userLabel: normalizeValue(entry.userLabel),
      });
    });

    activeTimers.forEach((entry) => {
      if (!entry.userKey || userMap.has(entry.userKey)) return;
      userMap.set(entry.userKey, {
        userKey: entry.userKey,
        userId: normalizeValue(entry.userId),
        userEmail: normalizeValue(entry.userEmail),
        userLabel: normalizeValue(entry.userLabel),
      });
    });

    return Array.from(userMap.values()).sort((left, right) =>
      normalizeValue(left.userLabel).localeCompare(normalizeValue(right.userLabel))
    );
  }, [activeTimers, organizationUsers, rows]);

  useEffect(() => {
    const nextDraft = {};
    combinedUsers.forEach((entry) => {
      const saved = userCompSettings[entry.userKey] || {};
      nextDraft[entry.userKey] = {
        docId: normalizeValue(saved.docId),
        userKey: entry.userKey,
        userId: normalizeValue(entry.userId || saved.userId),
        userEmail: normalizeValue(entry.userEmail || saved.userEmail),
        userLabel: normalizeValue(entry.userLabel || saved.userLabel),
        billingType: normalizeValue(saved.billingType) === "salary" ? "salary" : "hourly",
        hourlyRate: parseNumber(saved.hourlyRate),
        monthlySalary: parseNumber(saved.monthlySalary),
        expectedHours: parseNumber(saved.expectedHours, 40),
        overtimeApproved: saved.overtimeApproved === true,
        expectedSchedule: normalizeExpectedSchedule(saved.expectedSchedule),
        scheduleTimezone: normalizeValue(saved.scheduleTimezone) || "",
        changeLog: normalizeChangeLog(saved.changeLog),
      };
    });
    setDraftCompSettings(nextDraft);
  }, [combinedUsers, userCompSettings]);

  const userOptions = useMemo(() => {
    const seen = new Map();
    rows.forEach((row) => {
      const userKey = normalizeValue(row.userKey);
      if (userKey && !seen.has(userKey)) {
        seen.set(userKey, normalizeValue(row.userLabel) || userKey);
      }
    });
    activeTimers.forEach((timerEntry) => {
      const userKey = normalizeValue(timerEntry.userKey);
      if (userKey && !seen.has(userKey)) {
        seen.set(userKey, normalizeValue(timerEntry.userLabel) || userKey);
      }
    });
    return Array.from(seen.entries())
      .map(([userKey, userLabel]) => ({ userKey, userLabel }))
      .sort((left, right) => left.userLabel.localeCompare(right.userLabel));
  }, [activeTimers, rows]);

  const projectOptions = useMemo(() => {
    return Array.from(new Set(rows.map((row) => normalizeValue(row.projectName)).filter(Boolean)))
      .sort((left, right) => left.localeCompare(right));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const normalizedSearch = normalizeComparable(searchInput);
    const { startMs, endMs } = getRangeForPreset(dateFilterPreset);

    return rows.filter((row) => {
      const referenceTimestamp = Number(row.endedAt) || Number(row.startedAt) || 0;
      const isDateFilterActive = Number.isFinite(startMs) && Number.isFinite(endMs);
      const matchesDate =
        !isDateFilterActive ||
        (referenceTimestamp >= startMs && referenceTimestamp <= endMs);

      if (!matchesDate) return false;

      const matchesUser = selectedUser === "all" || normalizeValue(row.userKey) === selectedUser;
      if (!matchesUser) return false;

      const matchesProject =
        selectedProject === "all" || normalizeValue(row.projectName) === selectedProject;
      if (!matchesProject) return false;

      if (!normalizedSearch) return true;

      const searchHaystack = [
        row.issueId,
        row.projectName,
        row.userLabel,
        formatDuration(row.durationMs),
        formatTimestamp(row.startedAt),
        formatTimestamp(row.endedAt),
      ]
        .map((value) => normalizeComparable(value))
        .join(" ");

      return searchHaystack.includes(normalizedSearch);
    });
  }, [dateFilterPreset, rows, searchInput, selectedProject, selectedUser]);

  const getRateAndCostForRow = (rowEntry, { overtimeExceeded = false } = {}) => {
    // Time and Cost tab should reflect the latest compensation values for all filtered rows.
    const referenceTimestamp = Date.now();
    const effectiveComp = resolveEffectiveCompEntry({
      userKey: rowEntry.userKey,
      referenceTimestamp,
      savedSettingsMap: userCompSettings,
      draftSettingsMap: draftCompSettings,
      includeDraftPreview: true,
    });

    // If overtime is NOT approved and this row is in the overtime portion, mark as N/A.
    const overtimeApproved = effectiveComp.overtimeApproved === true;
    if (!overtimeApproved && overtimeExceeded) {
      return { billingType: "hourly", hourlyRate: 0, totalCost: 0, notApplicable: true };
    }

    const billingType = normalizeValue(effectiveComp.billingType) === "salary" ? "salary" : "hourly";
    const totalHours = toHours(rowEntry.durationMs);

    if (billingType === "salary") {
      const monthlySalary = parseNumber(effectiveComp.monthlySalary);
      const expectedWeeklyHours = parseNumber(effectiveComp.expectedHours);
      const expectedMonthlyHours = expectedWeeklyHours > 0 ? expectedWeeklyHours * WEEKS_PER_MONTH : 0;
      const effectiveHourlyRate = expectedMonthlyHours > 0 ? monthlySalary / expectedMonthlyHours : 0;
      return {
        billingType,
        hourlyRate: effectiveHourlyRate,
        totalCost: totalHours * effectiveHourlyRate,
      };
    }

    const hourlyRate = parseNumber(effectiveComp.hourlyRate);
    return {
      billingType,
      hourlyRate,
      totalCost: totalHours * hourlyRate,
    };
  };

  const calculateRateAndCost = (rowEntry) => getRateAndCostForRow(rowEntry);

  // Build a map of rowId -> isOvertimeExceeded based on per-user cumulative hours vs expected hours within each week.
  const overtimeExceededByRowId = useMemo(() => {
    // Group filteredRows by userKey and week start so the overtime cap resets every week.
    const byUserAndWeek = {};
    filteredRows.forEach((row) => {
      const userKey = normalizeValue(row.userKey);
      const referenceTimestamp = Number(row.startedAt) || Number(row.endedAt) || 0;
      const weekStartMs = startOfWeek(referenceTimestamp).getTime();
      const bucketKey = `${userKey}::${weekStartMs}`;
      if (!byUserAndWeek[bucketKey]) {
        byUserAndWeek[bucketKey] = { userKey, rows: [] };
      }
      byUserAndWeek[bucketKey].rows.push(row);
    });

    const result = {};
    Object.values(byUserAndWeek).forEach(({ userKey, rows: userRows }) => {
      const effectiveComp = resolveEffectiveCompEntry({
        userKey,
        referenceTimestamp: Date.now(),
        savedSettingsMap: userCompSettings,
        draftSettingsMap: draftCompSettings,
        includeDraftPreview: true,
      });
      const overtimeApproved = effectiveComp.overtimeApproved === true;
      if (overtimeApproved) return; // no cap needed

      const expectedWeeklyHours = parseNumber(effectiveComp.expectedHours, 40);
      const expectedWeeklyMs = expectedWeeklyHours * 3600000;

      // Sort oldest first so we exhaust expected hours in chronological order.
      const sorted = [...userRows].sort((a, b) => {
        const ta = Number(a.startedAt) || 0;
        const tb = Number(b.startedAt) || 0;
        return ta - tb;
      });

      let accumulated = 0;
      sorted.forEach((row) => {
        const rowMs = Number(row.durationMs) || 0;
        if (accumulated >= expectedWeeklyMs) {
          result[row.id] = true; // fully in overtime
        } else if (accumulated + rowMs > expectedWeeklyMs) {
          result[row.id] = true; // partially crosses cap — mark as overtime
        }
        accumulated += rowMs;
      });
    });

    return result;
  }, [filteredRows, dateFilterPreset, userCompSettings, draftCompSettings]);

  const totalDurationMs = useMemo(
    () => filteredRows.reduce((sum, row) => sum + (Number(row.durationMs) || 0), 0),
    [filteredRows]
  );

  const totalCost = useMemo(() => {
    return filteredRows.reduce((sum, row) => sum + getRateAndCostForRow(row).totalCost, 0);
  }, [filteredRows, draftCompSettings, userCompSettings]);

  const groupedReportRows = useMemo(() => {
    const dailyMap = new Map();
    const weeklyMap = new Map();
    const resolveUserGroup = (row) => {
      const userKey = normalizeValue(row.userKey) || normalizeComparable(row.userLabel);
      const userLabel = normalizeValue(row.userLabel) || "Unknown user";
      return { userKey, userLabel };
    };

    const rowsSorted = [...filteredRows].sort((left, right) => {
      // Group by user first so same-user rows are always contiguous, then by time descending.
      const leftUserKey = normalizeValue(left.userKey) || normalizeComparable(left.userLabel);
      const rightUserKey = normalizeValue(right.userKey) || normalizeComparable(right.userLabel);
      const userCompare = leftUserKey.localeCompare(rightUserKey);
      if (userCompare !== 0) return userCompare;
      const rightTimestamp = Number(right.endedAt) || Number(right.startedAt) || 0;
      const leftTimestamp = Number(left.endedAt) || Number(left.startedAt) || 0;
      return rightTimestamp - leftTimestamp;
    });

    rowsSorted.forEach((row) => {
      const referenceTimestamp = Number(row.endedAt) || Number(row.startedAt) || 0;
      if (!referenceTimestamp) return;

      const dayStartMs = startOfDay(referenceTimestamp).getTime();
      const weekStartMs = startOfWeek(referenceTimestamp).getTime();
      const rowDurationMs = Number(row.durationMs) || 0;
      const rowCost = getRateAndCostForRow(row).totalCost;
      const { userKey, userLabel } = resolveUserGroup(row);
      const dayMapKey = `${userKey}::${dayStartMs}`;
      const weekMapKey = `${userKey}::${weekStartMs}`;

      const currentDay = dailyMap.get(dayMapKey) || {
        key: dayMapKey,
        userKey,
        userLabel,
        startMs: dayStartMs,
        durationMs: 0,
        totalCost: 0,
        lineItems: 0,
      };
      currentDay.durationMs += rowDurationMs;
      currentDay.totalCost += rowCost;
      currentDay.lineItems += 1;
      dailyMap.set(dayMapKey, currentDay);

      const currentWeek = weeklyMap.get(weekMapKey) || {
        key: weekMapKey,
        userKey,
        userLabel,
        startMs: weekStartMs,
        durationMs: 0,
        totalCost: 0,
        lineItems: 0,
      };
      currentWeek.durationMs += rowDurationMs;
      currentWeek.totalCost += rowCost;
      currentWeek.lineItems += 1;
      weeklyMap.set(weekMapKey, currentWeek);
    });

    const nextRows = [];
    let lineItemIndex = 0;

    rowsSorted.forEach((row, index) => {
      const referenceTimestamp = Number(row.endedAt) || Number(row.startedAt) || 0;
      if (!referenceTimestamp) return;

      const dayStartMs = startOfDay(referenceTimestamp).getTime();
      const weekStartMs = startOfWeek(referenceTimestamp).getTime();
      const { userKey, userLabel } = resolveUserGroup(row);
      const dayMapKey = `${userKey}::${dayStartMs}`;
      const weekMapKey = `${userKey}::${weekStartMs}`;

      const previousRow = index > 0 ? rowsSorted[index - 1] : null;
      const previousReferenceTimestamp = Number(previousRow?.endedAt) || Number(previousRow?.startedAt) || 0;
      const previousDayStartMs = previousReferenceTimestamp ? startOfDay(previousReferenceTimestamp).getTime() : null;
      const previousWeekStartMs = previousReferenceTimestamp ? startOfWeek(previousReferenceTimestamp).getTime() : null;
      const previousUserKey = previousRow ? (normalizeValue(previousRow.userKey) || normalizeComparable(previousRow.userLabel)) : null;
      const previousDayMapKey = previousUserKey && previousDayStartMs !== null ? `${previousUserKey}::${previousDayStartMs}` : null;
      const previousWeekMapKey = previousUserKey && previousWeekStartMs !== null ? `${previousUserKey}::${previousWeekStartMs}` : null;

      if (previousWeekMapKey !== weekMapKey) {
        const weekSummary = weeklyMap.get(weekMapKey) || {
          key: weekMapKey,
          userKey,
          userLabel,
          startMs: weekStartMs,
          durationMs: 0,
          totalCost: 0,
          lineItems: 0,
        };

        nextRows.push({
          type: "weekHeader",
          ...weekSummary,
        });
      }

      if (previousDayMapKey !== dayMapKey) {
        const daySummary = dailyMap.get(dayMapKey) || {
          key: dayMapKey,
          userKey,
          userLabel,
          startMs: dayStartMs,
          durationMs: 0,
          totalCost: 0,
          lineItems: 0,
        };

        nextRows.push({
          type: "dayHeader",
          ...daySummary,
        });
      }

      lineItemIndex += 1;
      nextRows.push({
        type: "item",
        lineItemIndex,
        row,
      });

      const nextRow = rowsSorted[index + 1] || null;
      const nextReferenceTimestamp = Number(nextRow?.endedAt) || Number(nextRow?.startedAt) || 0;
      const nextDayStartMs = nextReferenceTimestamp ? startOfDay(nextReferenceTimestamp).getTime() : null;
      const nextWeekStartMs = nextReferenceTimestamp ? startOfWeek(nextReferenceTimestamp).getTime() : null;
      const nextUserKey = nextRow ? (normalizeValue(nextRow.userKey) || normalizeComparable(nextRow.userLabel)) : null;
      const nextDayMapKey = nextUserKey && nextDayStartMs !== null ? `${nextUserKey}::${nextDayStartMs}` : null;
      const nextWeekMapKey = nextUserKey && nextWeekStartMs !== null ? `${nextUserKey}::${nextWeekStartMs}` : null;

      if (nextDayMapKey !== dayMapKey) {
        const daySummary = dailyMap.get(dayMapKey) || {
          key: dayMapKey,
          userKey,
          userLabel,
          startMs: dayStartMs,
          durationMs: 0,
          totalCost: 0,
          lineItems: 0,
        };

        nextRows.push({
          type: "daySubtotal",
          ...daySummary,
        });
      }

      if (nextWeekMapKey !== weekMapKey) {
        const weekSummary = weeklyMap.get(weekMapKey) || {
          key: weekMapKey,
          userKey,
          userLabel,
          startMs: weekStartMs,
          durationMs: 0,
          totalCost: 0,
          lineItems: 0,
        };

        nextRows.push({
          type: "weekSubtotal",
          ...weekSummary,
        });
      }
    });

    return nextRows;
  }, [filteredRows, draftCompSettings, userCompSettings, selectedUser, selectedProject, dateFilterPreset]);

  const handleDraftChange = (userKey, field, rawValue) => {
    setDraftCompSettings((current) => {
      const currentEntry = current[userKey] || {};
      return {
        ...current,
        [userKey]: {
          ...currentEntry,
          [field]: field === "billingType" ? rawValue : rawValue,
        },
      };
    });

    // Debounced auto-save: fires 800ms after the last change for this user
    if (saveTimersRef.current[userKey]) clearTimeout(saveTimersRef.current[userKey]);
    saveTimersRef.current[userKey] = setTimeout(() => {
      if (handleSaveRef.current) handleSaveRef.current(userKey, { interactive: false });
      delete saveTimersRef.current[userKey];
    }, 800);
  };

  const handleSaveUserSettings = async (userKey, { interactive = false } = {}) => {
    if (!id || !userKey) return;
    const draft = draftCompSettings[userKey];
    if (!draft) return;

    setSavingUserKey(userKey);
    const docId = normalizeValue(draft.docId || draft.userKey);

    try {
      const savedSettings = userCompSettings[userKey] || {};
      const savedLog = normalizeChangeLog(savedSettings.changeLog);
      const baseLog = savedLog.length > 0 ? savedLog : getFallbackLogFromLegacyFields(savedSettings);
      const nextSnapshot = normalizeCompSnapshot(draft);
      const latestSnapshot = baseLog.length > 0 ? baseLog[baseLog.length - 1] : null;
      const nextLog = [...baseLog];

      if (!latestSnapshot || !areCompSnapshotsEqual(latestSnapshot, nextSnapshot)) {
        let effectiveFrom = nextLog.length === 0 ? 0 : Date.now();

        // After first setup, require explicit user confirmation to choose from-now vs backdate.
        if (nextLog.length > 0) {
          if (!interactive) {
            return;
          }

          const wantsBackdate = window.confirm(
            "Apply this compensation change to a specific past date?\n\nClick OK to backdate.\nClick Cancel to apply from now on."
          );

          if (wantsBackdate) {
            const dateInput = window.prompt(
              "Enter effective date (YYYY-MM-DD or YYYY-MM-DD HH:mm)",
              ""
            );

            if (dateInput === null) {
              return;
            }

            const parsedEffectiveFrom = parseEffectiveDateInput(dateInput);
            if (!Number.isFinite(parsedEffectiveFrom) || parsedEffectiveFrom <= 0) {
              window.alert("Invalid date. Please use YYYY-MM-DD or YYYY-MM-DD HH:mm");
              return;
            }

            effectiveFrom = parsedEffectiveFrom;
          }
        }

        nextLog.push({
          effectiveFrom,
          changedAt: Date.now(),
          ...nextSnapshot,
        });
      }

      const latestPersisted = nextLog[nextLog.length - 1] || {
        billingType: "hourly",
        hourlyRate: 0,
        monthlySalary: 0,
        expectedHours: 160,
      };

      await setDoc(
        doc(db, "churches", id, "payEveryoneUserSettings", docId),
        {
          userKey: normalizeValue(draft.userKey),
          userId: normalizeValue(draft.userId),
          userEmail: normalizeValue(draft.userEmail),
          userLabel: normalizeValue(draft.userLabel),
          billingType: normalizeValue(latestPersisted.billingType) === "salary" ? "salary" : "hourly",
          hourlyRate: parseNumber(latestPersisted.hourlyRate),
          monthlySalary: parseNumber(latestPersisted.monthlySalary),
          expectedHours: parseNumber(latestPersisted.expectedHours, 40),
          overtimeApproved: latestPersisted.overtimeApproved === true,
          expectedSchedule: normalizeExpectedSchedule(draft.expectedSchedule),
          scheduleTimezone: normalizeValue(draft.scheduleTimezone) || "",
          changeLog: nextLog,
          updatedAt: Date.now(),
        },
        { merge: true }
      );
    } catch (saveError) {
      console.error("Error saving PayEveryone user settings:", saveError);
    } finally {
      setSavingUserKey("");
    }
  };

  // Keep debounced autosave pointed at the latest save function instance.
  useEffect(() => {
    handleSaveRef.current = handleSaveUserSettings;
  }, [handleSaveUserSettings]);

  const handleDeleteUserSettings = async (userKey) => {
    if (!id || !userKey) return;
    const currentSettings = userCompSettings[userKey];
    const docId = normalizeValue(currentSettings?.docId || userKey);
    if (!docId) return;

    setDeletingUserKey(userKey);
    try {
      await deleteDoc(doc(db, "churches", id, "payEveryoneUserSettings", docId));
    } catch (deleteError) {
      console.error("Error deleting PayEveryone user settings:", deleteError);
    } finally {
      setDeletingUserKey("");
    }
  };

  const tabButtonStyle = (isActive) => ({
    padding: "8px 12px",
    borderRadius: "999px",
    border: isActive ? "1px solid #1D4ED8" : "1px solid #CBD5E1",
    backgroundColor: isActive ? "#EFF6FF" : "#FFFFFF",
    color: isActive ? "#1D4ED8" : "#334155",
    fontWeight: 700,
    cursor: "pointer",
  });

  const inputStyle = {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid #CBD5E1",
    borderRadius: "8px",
    backgroundColor: "#FFFFFF",
  };

  if (!isGlobalAdminUser) {
    return (
      <div style={{ ...commonStyles.fullWidthContainer, paddingTop: "2rem", paddingBottom: "2rem" }}>
        <Link to={`${routePrefix}/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
          ← Back to My Organization
        </Link>

        <div style={{ ...cardStyle, marginTop: "1rem" }}>
          <h1 style={{ ...commonStyles.title, marginBottom: "0.5rem" }}>Pay Everyone</h1>
          <p style={{ margin: 0, color: "#B91C1C", fontWeight: 600 }}>
            Access denied. This page is available to Global Admin only.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...commonStyles.fullWidthContainer, paddingTop: "2rem", paddingBottom: "2rem" }}>
      <Link to={`${routePrefix}/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to My Organization
      </Link>

      <div style={{ ...cardStyle, marginTop: "1rem" }}>
        <h1 style={{ ...commonStyles.title, marginBottom: "0.5rem" }}>Pay Everyone</h1>
        <p style={{ marginTop: 0, color: "#475569" }}>
          Line-item time logs from TimeRotate Card Hours with Card ID, Project Name, User, Total Time, Start Time, and End Time.
        </p>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "10px", marginBottom: "8px" }}>
          <button type="button" onClick={() => setActiveTab("time")} style={tabButtonStyle(activeTab === "time")}>
            Time and Cost
          </button>
          <button type="button" onClick={() => setActiveTab("comp")} style={tabButtonStyle(activeTab === "comp")}>
            User Compensation
          </button>
          <button type="button" onClick={() => setActiveTab("hours")} style={tabButtonStyle(activeTab === "hours")}>
            Hours Tracker
          </button>
          <button type="button" onClick={() => setActiveTab("attendance")} style={tabButtonStyle(activeTab === "attendance")}>
            Attendance Tracker
          </button>
        </div>

        {activeTab === "hours" ? (
          <HoursTrackerTab
            combinedUsers={combinedUsers}
            rows={rows}
            dateFilterPreset={dateFilterPreset}
            setDateFilterPreset={setDateFilterPreset}
            userCompSettings={userCompSettings}
            draftCompSettings={draftCompSettings}
            resolveEffectiveCompEntry={resolveEffectiveCompEntry}
            getRangeForPreset={getRangeForPreset}
            DATE_FILTER_OPTIONS={DATE_FILTER_OPTIONS}
            formatHours={formatHours}
            toHours={toHours}
            parseNumber={parseNumber}
          />
        ) : activeTab === "attendance" ? (
          <AttendanceTrackerTab
            combinedUsers={combinedUsers}
            rows={rows}
            activeTimers={activeTimers}
            dateFilterPreset={dateFilterPreset}
            setDateFilterPreset={setDateFilterPreset}
            userCompSettings={userCompSettings}
            draftCompSettings={draftCompSettings}
            DATE_FILTER_OPTIONS={DATE_FILTER_OPTIONS}
            selectedUser={selectedUser}
            setSelectedUser={setSelectedUser}
            userOptions={userOptions}
          />
        ) : activeTab === "time" ? (
          <>

        <div
          style={{
            marginTop: "12px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "10px",
          }}
        >
          <div>
            <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
              Date Range
            </label>
            <select
              value={dateFilterPreset}
              onChange={(event) => setDateFilterPreset(event.target.value)}
              style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
            >
              {DATE_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
              User
            </label>
            <select
              value={selectedUser}
              onChange={(event) => setSelectedUser(event.target.value)}
              style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
            >
              <option value="all">All Users</option>
              {userOptions.map((userOption) => (
                <option key={userOption.userKey} value={userOption.userKey}>
                  {userOption.userLabel}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
              Project Name
            </label>
            <select
              value={selectedProject}
              onChange={(event) => setSelectedProject(event.target.value)}
              style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
            >
              <option value="all">All Projects</option>
              {projectOptions.map((projectOption) => (
                <option key={projectOption} value={projectOption}>
                  {projectOption}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
              Search
            </label>
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search card, project, user, time..."
              style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginTop: "12px" }}>
          <div style={{ backgroundColor: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "10px", padding: "10px 12px" }}>
            <div style={{ color: "#64748B", fontSize: "0.8rem", fontWeight: 700 }}>Line Items</div>
            <div style={{ color: "#0F172A", fontWeight: 800, fontSize: "1.1rem" }}>{filteredRows.length}</div>
          </div>
          <div style={{ backgroundColor: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "10px", padding: "10px 12px" }}>
            <div style={{ color: "#64748B", fontSize: "0.8rem", fontWeight: 700 }}>Total Time</div>
            <div style={{ color: "#0F172A", fontWeight: 800, fontSize: "1.1rem" }}>{formatDuration(totalDurationMs)}</div>
          </div>
          <div style={{ backgroundColor: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "10px", padding: "10px 12px" }}>
            <div style={{ color: "#64748B", fontSize: "0.8rem", fontWeight: 700 }}>Total Cost</div>
            <div style={{ color: "#0F172A", fontWeight: 800, fontSize: "1.1rem" }}>{toCurrency(totalCost)}</div>
          </div>
        </div>

        <div style={{ marginLeft: "-16px", marginRight: "-16px", marginTop: "14px", overflowX: "auto", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ backgroundColor: "#F8FAFC" }}>
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Line Item</th>
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Card ID</th>
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Project Name</th>
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>User</th>
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Total Time</th>
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Hourly Rate</th>
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Cost</th>
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Start Time</th>
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>End Time</th>
              </tr>
            </thead>
            <tbody key={`report-body-${selectedUser}-${selectedProject}-${dateFilterPreset}`}>
              {loading ? (
                <tr>
                  <td colSpan={9} style={{ padding: "14px", color: "#64748B" }}>
                    Loading line items...
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: "14px", color: "#64748B" }}>
                    No time logs match the current filters.
                  </td>
                </tr>
              ) : (
                groupedReportRows.map((entry) => {
                  if (entry.type === "weekSubtotal") {
                    return (
                      <React.Fragment key={`week-subtotal-frag-${entry.key}`}>
                        <tr>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #C7D2FE", backgroundColor: "#EEF2FF", color: "#3730A3", fontWeight: 700, fontSize: "0.82rem" }}>Weekly Subtotal</td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #C7D2FE", backgroundColor: "#EEF2FF", color: "#3730A3", fontWeight: 700, fontSize: "0.82rem" }}>
                            {formatDateOnly(entry.startMs)} - {formatDateOnly(addDays(entry.startMs, 6).getTime())}
                          </td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #C7D2FE", backgroundColor: "#EEF2FF" }} />
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #C7D2FE", backgroundColor: "#EEF2FF", color: "#3730A3", fontWeight: 700, fontSize: "0.82rem" }}>{entry.userLabel}</td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #C7D2FE", backgroundColor: "#EEF2FF", color: "#3730A3", fontWeight: 700, fontSize: "0.82rem" }}>{formatHours(entry.durationMs)}</td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #C7D2FE", backgroundColor: "#EEF2FF", color: "#3730A3", fontWeight: 700, fontSize: "0.82rem" }}>-</td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #C7D2FE", backgroundColor: "#EEF2FF", color: "#3730A3", fontWeight: 700, fontSize: "0.82rem" }}>{toCurrency(entry.totalCost)}</td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #C7D2FE", backgroundColor: "#EEF2FF" }} />
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #C7D2FE", backgroundColor: "#EEF2FF" }} />
                        </tr>
                        <tr aria-hidden="true">
                          <td colSpan={9} style={{ height: "38px", padding: "10px 0", backgroundColor: "#F1F5F9", borderTop: "1px solid #E2E8F0", borderBottom: "2px solid #CBD5E1" }}>&nbsp;</td>
                        </tr>
                      </React.Fragment>
                    );
                  }

                  if (entry.type === "weekHeader") {
                    return (
                      <tr key={`week-header-${entry.key}`}>
                        <td style={{ padding: "10px", borderBottom: "1px solid #BFDBFE", borderTop: "2px solid #60A5FA", backgroundColor: "#EFF6FF", color: "#1E3A8A", fontWeight: 800, fontSize: "0.88rem" }}>Week Start</td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #BFDBFE", borderTop: "2px solid #60A5FA", backgroundColor: "#EFF6FF", color: "#1E3A8A", fontWeight: 800, fontSize: "0.88rem" }}>
                          {formatDateOnly(entry.startMs)} - {formatDateOnly(addDays(entry.startMs, 6).getTime())}
                        </td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #BFDBFE", borderTop: "2px solid #60A5FA", backgroundColor: "#EFF6FF" }} />
                        <td style={{ padding: "10px", borderBottom: "1px solid #BFDBFE", borderTop: "2px solid #60A5FA", backgroundColor: "#EFF6FF", color: "#1E3A8A", fontWeight: 800, fontSize: "0.88rem" }}>{entry.userLabel} • Items: {entry.lineItems}</td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #BFDBFE", borderTop: "2px solid #60A5FA", backgroundColor: "#EFF6FF" }} />
                        <td style={{ padding: "10px", borderBottom: "1px solid #BFDBFE", borderTop: "2px solid #60A5FA", backgroundColor: "#EFF6FF" }} />
                        <td style={{ padding: "10px", borderBottom: "1px solid #BFDBFE", borderTop: "2px solid #60A5FA", backgroundColor: "#EFF6FF" }} />
                        <td style={{ padding: "10px", borderBottom: "1px solid #BFDBFE", borderTop: "2px solid #60A5FA", backgroundColor: "#EFF6FF" }} />
                        <td style={{ padding: "10px", borderBottom: "1px solid #BFDBFE", borderTop: "2px solid #60A5FA", backgroundColor: "#EFF6FF" }} />
                      </tr>
                    );
                  }

                  if (entry.type === "daySubtotal") {
                    return (
                      <React.Fragment key={`day-subtotal-frag-${entry.key}`}>
                        <tr>
                          <td style={{ padding: "12px 12px", borderTop: "2px solid #86EFAC", borderBottom: "2px solid #34D399", backgroundColor: "#ECFDF5", color: "#065F46", fontWeight: 800, fontSize: "0.83rem" }}>Daily Subtotal</td>
                          <td style={{ padding: "12px 12px", borderTop: "2px solid #86EFAC", borderBottom: "2px solid #34D399", backgroundColor: "#ECFDF5", color: "#065F46", fontWeight: 800, fontSize: "0.83rem" }}>{formatDateOnly(entry.startMs)}</td>
                          <td style={{ padding: "12px 12px", borderTop: "2px solid #86EFAC", borderBottom: "2px solid #34D399", backgroundColor: "#ECFDF5" }} />
                          <td style={{ padding: "12px 12px", borderTop: "2px solid #86EFAC", borderBottom: "2px solid #34D399", backgroundColor: "#ECFDF5", color: "#065F46", fontWeight: 800, fontSize: "0.83rem" }}>{entry.userLabel}</td>
                          <td style={{ padding: "12px 12px", borderTop: "2px solid #86EFAC", borderBottom: "2px solid #34D399", backgroundColor: "#ECFDF5", color: "#065F46", fontWeight: 800, fontSize: "0.83rem" }}>{formatHours(entry.durationMs)}</td>
                          <td style={{ padding: "12px 12px", borderTop: "2px solid #86EFAC", borderBottom: "2px solid #34D399", backgroundColor: "#ECFDF5", color: "#065F46", fontWeight: 800, fontSize: "0.83rem" }}>-</td>
                          <td style={{ padding: "12px 12px", borderTop: "2px solid #86EFAC", borderBottom: "2px solid #34D399", backgroundColor: "#ECFDF5", color: "#065F46", fontWeight: 800, fontSize: "0.83rem" }}>{toCurrency(entry.totalCost)}</td>
                          <td style={{ padding: "12px 12px", borderTop: "2px solid #86EFAC", borderBottom: "2px solid #34D399", backgroundColor: "#ECFDF5" }} />
                          <td style={{ padding: "12px 12px", borderTop: "2px solid #86EFAC", borderBottom: "2px solid #34D399", backgroundColor: "#ECFDF5" }} />
                        </tr>
                        <tr aria-hidden="true">
                          <td colSpan={9} style={{ height: "14px", padding: "7px 0", backgroundColor: "#F1F5F9", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0" }}>&nbsp;</td>
                        </tr>
                      </React.Fragment>
                    );
                  }

                  if (entry.type === "dayHeader") {
                    return (
                      <tr key={`day-header-${entry.key}`}>
                        <td style={{ padding: "9px 10px", borderBottom: "1px solid #FDE68A", borderTop: "1px solid #FCD34D", backgroundColor: "#FFFBEB", color: "#92400E", fontWeight: 800, fontSize: "0.84rem" }}>Day Start</td>
                        <td style={{ padding: "9px 10px", borderBottom: "1px solid #FDE68A", borderTop: "1px solid #FCD34D", backgroundColor: "#FFFBEB", color: "#92400E", fontWeight: 800, fontSize: "0.84rem" }}>{formatDateOnly(entry.startMs)}</td>
                        <td style={{ padding: "9px 10px", borderBottom: "1px solid #FDE68A", borderTop: "1px solid #FCD34D", backgroundColor: "#FFFBEB" }} />
                        <td style={{ padding: "9px 10px", borderBottom: "1px solid #FDE68A", borderTop: "1px solid #FCD34D", backgroundColor: "#FFFBEB", color: "#92400E", fontWeight: 800, fontSize: "0.84rem" }}>{entry.userLabel} • Items: {entry.lineItems}</td>
                        <td style={{ padding: "9px 10px", borderBottom: "1px solid #FDE68A", borderTop: "1px solid #FCD34D", backgroundColor: "#FFFBEB" }} />
                        <td style={{ padding: "9px 10px", borderBottom: "1px solid #FDE68A", borderTop: "1px solid #FCD34D", backgroundColor: "#FFFBEB" }} />
                        <td style={{ padding: "9px 10px", borderBottom: "1px solid #FDE68A", borderTop: "1px solid #FCD34D", backgroundColor: "#FFFBEB" }} />
                        <td style={{ padding: "9px 10px", borderBottom: "1px solid #FDE68A", borderTop: "1px solid #FCD34D", backgroundColor: "#FFFBEB" }} />
                        <td style={{ padding: "9px 10px", borderBottom: "1px solid #FDE68A", borderTop: "1px solid #FCD34D", backgroundColor: "#FFFBEB" }} />
                      </tr>
                    );
                  }

                  const row = entry.row;
                  const isOvertime = overtimeExceededByRowId[row.id] === true;
                  const rateAndCost = getRateAndCostForRow(row, { overtimeExceeded: isOvertime });
                  return (
                    <tr key={row.id}>
                      <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>{entry.lineItemIndex}</td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#0F172A", fontWeight: 700 }}>
                        {row.issueId || "-"}
                      </td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>{row.projectName || "-"}</td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>{row.userLabel}</td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#0F172A", fontWeight: 700 }}>
                        {formatDuration(row.durationMs)}
                      </td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>
                        {rateAndCost.notApplicable ? <span style={{ color: "#94A3B8", fontStyle: "italic" }}>N/A</span> : toCurrency(rateAndCost.hourlyRate)}
                      </td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#0F172A", fontWeight: 700 }}>
                        {rateAndCost.notApplicable ? <span style={{ color: "#94A3B8", fontStyle: "italic" }}>N/A</span> : toCurrency(rateAndCost.totalCost)}
                      </td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>
                        {formatTimestamp(row.startedAt)}
                      </td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>
                        {formatTimestamp(row.endedAt)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
          </>
        ) : (
          <div style={{ marginTop: "12px", overflowX: "auto", border: "1px solid #E2E8F0", borderRadius: "12px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "1200px" }}>
              <thead>
                <tr style={{ backgroundColor: "#F8FAFC" }}>
                  <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>User</th>
                  <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Billing Type</th>
                  <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Hourly Rate</th>
                  <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Monthly Salary</th>
                  <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Expected Hours/Week</th>
                  <th style={{ textAlign: "center", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Overtime Approved</th>
                  <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Expected Schedule</th>
                  <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Effective Hourly</th>
                  <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>
                    Change Log
                    <span
                      title="Rate history is saved with effective dates. Any time log uses the rate active at that time. The first hourly/salary entry applies to all existing hours for that user. Expected hours are weekly, and monthly salary is converted to hourly using expected weekly hours multiplied by 52/12."
                      style={{ marginLeft: "6px", color: "#1D4ED8", cursor: "help", fontWeight: 800 }}
                    >
                      ⓘ
                    </span>
                  </th>
                  <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {combinedUsers.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ padding: "14px", color: "#64748B" }}>
                      No users found for this organization yet.
                    </td>
                  </tr>
                ) : (
                  combinedUsers.map((entry) => {
                    const draft = draftCompSettings[entry.userKey] || {
                      billingType: "hourly",
                      hourlyRate: 0,
                      monthlySalary: 0,
                      expectedHours: 40,
                      overtimeApproved: false,
                      expectedSchedule: normalizeExpectedSchedule(),
                      scheduleTimezone: "",
                    };

                    const billingType = normalizeValue(draft.billingType) === "salary" ? "salary" : "hourly";
                    const hourlyRate = parseNumber(draft.hourlyRate);
                    const monthlySalary = parseNumber(draft.monthlySalary);
                    const expectedHours = parseNumber(draft.expectedHours, 40);
                    const overtimeApproved = draft.overtimeApproved === true;
                    const schedule = normalizeExpectedSchedule(draft.expectedSchedule);
                    const scheduleTimezone = normalizeValue(draft.scheduleTimezone) || "America/New_York";
                    const scheduleSummary = summarizeExpectedSchedule(schedule);
                    const isScheduleEditorOpen = expandedScheduleEditors[entry.userKey] === true;
                    const expectedMonthlyHours = expectedHours > 0 ? expectedHours * WEEKS_PER_MONTH : 0;
                    const effectiveHourly =
                      billingType === "salary" ? (expectedMonthlyHours > 0 ? monthlySalary / expectedMonthlyHours : 0) : hourlyRate;

                    const savedSettings = userCompSettings[entry.userKey] || {};
                    const savedLog = normalizeChangeLog(savedSettings.changeLog);
                    const historyToRender = savedLog.length > 0 ? savedLog : getFallbackLogFromLegacyFields(savedSettings);

                    return (
                      <tr key={entry.userKey}>
                        <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#0F172A", fontWeight: 700 }}>
                          {entry.userLabel || "Unknown user"}
                        </td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9" }}>
                          <select
                            value={billingType}
                            onChange={(event) => handleDraftChange(entry.userKey, "billingType", event.target.value)}
                            style={inputStyle}
                          >
                            <option value="hourly">Hourly</option>
                            <option value="salary">Monthly Salary</option>
                          </select>
                        </td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9" }}>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={hourlyRate}
                            onChange={(event) => handleDraftChange(entry.userKey, "hourlyRate", event.target.value)}
                            style={billingType === "salary" ? { ...inputStyle, backgroundColor: "#F1F5F9", color: "#94A3B8", cursor: "not-allowed" } : inputStyle}
                            disabled={billingType === "salary"}
                          />
                        </td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9" }}>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={monthlySalary}
                            onChange={(event) => handleDraftChange(entry.userKey, "monthlySalary", event.target.value)}
                            style={billingType !== "salary" ? { ...inputStyle, backgroundColor: "#F1F5F9", color: "#94A3B8", cursor: "not-allowed" } : inputStyle}
                            disabled={billingType !== "salary"}
                          />
                        </td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9" }}>
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            value={expectedHours}
                            onChange={(event) => handleDraftChange(entry.userKey, "expectedHours", event.target.value)}
                            style={inputStyle}
                          />
                        </td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", textAlign: "center" }}>
                          <input
                            type="checkbox"
                            checked={overtimeApproved}
                            onChange={(event) => handleDraftChange(entry.userKey, "overtimeApproved", event.target.checked)}
                            style={{ width: "18px", height: "18px", cursor: "pointer", accentColor: "#1D4ED8" }}
                          />
                        </td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", minWidth: "260px" }}>
                          <div style={{ display: "grid", gap: "8px" }}>
                            <div>
                              <div style={{ fontWeight: 700, color: "#0F172A", fontSize: "0.86rem" }}>{scheduleSummary}</div>
                              <div style={{ color: "#64748B", fontSize: "0.78rem" }}>{scheduleTimezone}</div>
                            </div>
                            <div>
                              <button
                                type="button"
                                onClick={() => {
                                  setExpandedScheduleEditors((current) => ({
                                    ...current,
                                    [entry.userKey]: !current[entry.userKey],
                                  }));
                                }}
                                style={{
                                  border: "1px solid #CBD5E1",
                                  backgroundColor: "#FFFFFF",
                                  color: "#1E293B",
                                  borderRadius: "8px",
                                  padding: "6px 10px",
                                  fontWeight: 700,
                                  cursor: "pointer",
                                  fontSize: "0.8rem",
                                }}
                              >
                                {isScheduleEditorOpen ? "Hide Schedule" : "Edit Schedule"}
                              </button>
                            </div>
                            {isScheduleEditorOpen ? (
                              <div style={{ display: "grid", gap: "4px", paddingTop: "2px" }}>
                                {EXPECTED_SCHEDULE_DAYS.map((day) => (
                                  <div key={day} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                    <span style={{ width: "32px", fontWeight: 700, fontSize: "0.78rem", color: "#475569" }}>{day}</span>
                                    <input
                                      type="time"
                                      value={schedule[day] || DEFAULT_EXPECTED_START_TIME}
                                      onChange={(event) => {
                                        const nextSchedule = { ...schedule, [day]: event.target.value || DEFAULT_EXPECTED_START_TIME };
                                        handleDraftChange(entry.userKey, "expectedSchedule", nextSchedule);
                                      }}
                                      style={{ padding: "3px 6px", border: "1px solid #CBD5E1", borderRadius: "6px", fontSize: "0.82rem", width: "110px" }}
                                    />
                                  </div>
                                ))}
                                <div style={{ marginTop: "4px" }}>
                                  <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: "2px" }}>Timezone</label>
                                  <select
                                    value={scheduleTimezone}
                                    onChange={(event) => handleDraftChange(entry.userKey, "scheduleTimezone", event.target.value)}
                                    style={{ padding: "3px 6px", border: "1px solid #CBD5E1", borderRadius: "6px", fontSize: "0.78rem", width: "100%" }}
                                  >
                                    <option value="">-- select --</option>
                                    {[
                                      "America/New_York",
                                      "America/Chicago",
                                      "America/Denver",
                                      "America/Los_Angeles",
                                      "America/Anchorage",
                                      "America/Honolulu",
                                      "America/Puerto_Rico",
                                      "America/Bogota",
                                      "America/Lima",
                                      "America/Santiago",
                                      "America/Sao_Paulo",
                                      "America/Argentina/Buenos_Aires",
                                      "Europe/London",
                                      "Europe/Madrid",
                                      "Europe/Berlin",
                                      "Europe/Moscow",
                                      "Asia/Dubai",
                                      "Asia/Kolkata",
                                      "Asia/Bangkok",
                                      "Asia/Shanghai",
                                      "Asia/Tokyo",
                                      "Asia/Seoul",
                                      "Australia/Sydney",
                                      "Pacific/Auckland",
                                    ].map((tz) => (
                                      <option key={tz} value={tz}>{tz.replace("_", " ")}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#0F172A", fontWeight: 700 }}>
                          {toCurrency(effectiveHourly)}
                        </td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155", fontSize: "0.82rem" }}>
                          {historyToRender.length === 0 ? (
                            <span style={{ color: "#94A3B8" }}>No saved changes yet.</span>
                          ) : (
                            <div style={{ display: "grid", gap: "4px" }}>
                              {historyToRender.slice(-4).reverse().map((historyEntry, historyIndex) => {
                                const isSalary = normalizeValue(historyEntry.billingType) === "salary";
                                const effectiveLabel = Number(historyEntry.effectiveFrom || 0) <= 0
                                  ? "All existing hours"
                                  : `From ${formatTimestamp(historyEntry.effectiveFrom)}`;
                                const rateLabel = isSalary
                                  ? `${toCurrency(historyEntry.monthlySalary)} / ${parseNumber(historyEntry.expectedHours, 40)} hrs/wk`
                                  : `${toCurrency(historyEntry.hourlyRate)} / hr`;
                                const overtimeLabel = historyEntry.overtimeApproved === true ? " · OT ✓" : " · OT ✗";

                                return (
                                  <div key={`${historyEntry.effectiveFrom || 0}-${historyIndex}`}>
                                    <div style={{ fontWeight: 700, color: "#0F172A" }}>{effectiveLabel}</div>
                                    <div>{isSalary ? "Salary" : "Hourly"} · {rateLabel}{overtimeLabel}</div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9" }}>
                          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                            <button
                              type="button"
                              onClick={() => handleSaveUserSettings(entry.userKey, { interactive: true })}
                              style={{
                                border: "1px solid #1D4ED8",
                                backgroundColor: "#1D4ED8",
                                color: "#FFFFFF",
                                borderRadius: "8px",
                                padding: "6px 10px",
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                              disabled={savingUserKey === entry.userKey}
                            >
                              {savingUserKey === entry.userKey ? "Saving..." : "Save"}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteUserSettings(entry.userKey)}
                              style={{
                                border: "1px solid #DC2626",
                                backgroundColor: "#FFFFFF",
                                color: "#B91C1C",
                                borderRadius: "8px",
                                padding: "6px 10px",
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                              disabled={deletingUserKey === entry.userKey}
                            >
                              {deletingUserKey === entry.userKey ? "Deleting..." : "Delete"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default PayEveryone;
