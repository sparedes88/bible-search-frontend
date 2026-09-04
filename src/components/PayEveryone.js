import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { jsPDF } from "jspdf";
import "jspdf-autotable";
import { db } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import commonStyles from "../pages/commonStyles";
import "./PayEveryonePayments.css";

const normalizeValue = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const isHttpUrl = (value) => /^https?:\/\//i.test(normalizeValue(value));

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

  if (typeof value === "string") {
    const parsedMs = new Date(value).getTime();
    return Number.isFinite(parsedMs) && parsedMs > 0 ? parsedMs : 0;
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
const formatPaymentDate = (value, fallbackValue = 0) => {
  const storedDate = normalizeValue(value);
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(storedDate);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(Number(year), Number(month) - 1, Number(day)));
  }
  return formatDateOnly(fallbackValue || value);
};

const formatWeekdayOnly = (value) => {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
  }).format(new Date(value));
};

const formatNotesSummary = (notesValue) => {
  if (!Array.isArray(notesValue)) return "";

  return notesValue
    .map((noteEntry) => {
      if (typeof noteEntry === "string") return normalizeValue(noteEntry);
      return normalizeValue(noteEntry?.text);
    })
    .filter(Boolean)
    .join(" | ");
};

const formatNotesList = (notesValue) => {
  if (!Array.isArray(notesValue)) return [];

  return notesValue
    .map((noteEntry) => {
      if (typeof noteEntry === "string") return normalizeValue(noteEntry);
      return normalizeValue(noteEntry?.text);
    })
    .filter(Boolean);
};

const buildTeamsChatUrl = (email) => {
  const normalizedEmail = normalizeValue(email).toLowerCase();
  const requiredParticipants = [
    "sparedes@e2techsupport.com",
    "kgrillet@e2techsupport.com",
    "annie@iglesiatech.com",
  ];

  const allParticipants = [normalizedEmail, ...requiredParticipants]
    .map((entry) => normalizeValue(entry).toLowerCase())
    .filter(Boolean);

  const uniqueParticipants = Array.from(new Set(allParticipants));
  if (uniqueParticipants.length === 0) return "";

  return `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(uniqueParticipants.join(","))}`;
};

const getDuplicateDeletePlan = (rows = []) => {
  const grouped = new Map();

  rows.forEach((row) => {
    const groupKey = [
      normalizeValue(row.userKey).toLowerCase(),
      normalizeValue(row.issueId).toLowerCase(),
      normalizeValue(row.projectName).toLowerCase(),
      Number(row.startedAt) || 0,
    ].join("||");

    if (!grouped.has(groupKey)) grouped.set(groupKey, []);
    grouped.get(groupKey).push(row);
  });

  const duplicateGroups = Array.from(grouped.values()).filter((groupRows) => groupRows.length > 1);
  const idsToDelete = [];

  duplicateGroups.forEach((groupRows) => {
    const sorted = [...groupRows].sort((left, right) => {
      const endedDiff = (Number(right.endedAt) || 0) - (Number(left.endedAt) || 0);
      if (endedDiff !== 0) return endedDiff;

      const durationDiff = (Number(right.durationMs) || 0) - (Number(left.durationMs) || 0);
      if (durationDiff !== 0) return durationDiff;

      return normalizeValue(right.id).localeCompare(normalizeValue(left.id));
    });

    const [, ...duplicates] = sorted;
    duplicates.forEach((entry) => {
      if (entry?.id) idsToDelete.push(entry.id);
    });
  });

  return {
    duplicateGroupCount: duplicateGroups.length,
    duplicateCount: idsToDelete.length,
    idsToDelete,
  };
};

const resolveUserLabel = (entry) => {
  const profile = entry.profile || entry.personalInfo || entry.userData || entry.user || {};
  const firstName = normalizeValue(
    entry.firstName || entry.first_name || entry.userFirstName || entry.user_first_name || entry.nombre || entry.first
    || profile.firstName || profile.first_name || profile.userFirstName || profile.user_first_name || profile.nombre || profile.first
  );
  const lastName = normalizeValue(
    entry.lastName || entry.last_name || entry.userLastName || entry.user_last_name || entry.apellido || entry.surname || entry.last
    || profile.lastName || profile.last_name || profile.userLastName || profile.user_last_name || profile.apellido || profile.surname || profile.last
  );
  const name = normalizeValue(entry.name || profile.name);
  const displayName = normalizeValue(entry.displayName || profile.displayName);
  const existingName = normalizeValue(entry.fullName || entry.full_name || profile.fullName || profile.full_name);
  const distinctNames = [name, displayName].filter((value, index, values) => value && values.indexOf(value) === index).join(" ");
  const nameAlreadyIncludesLastName = lastName && name.toLowerCase().includes(lastName.toLowerCase());
  const firstAndLastName = nameAlreadyIncludesLastName
    ? name
    : [firstName || name, lastName].filter(Boolean).join(" ");
  const existingNameWithLastName = lastName && existingName.toLowerCase().includes(lastName.toLowerCase())
    ? existingName
    : [existingName || distinctNames, lastName].filter(Boolean).join(" ");

  return (
    firstAndLastName
    || existingNameWithLastName
    || distinctNames
    || normalizeValue(entry.registeredBy)
    || normalizeValue(entry.userEmail)
    || normalizeValue(entry.userId)
    || "Unknown user"
  );
};

const normalizeComparable = (value) => normalizeValue(value).toLowerCase();

const normalizeKey = (value) =>
  normalizeValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const findFieldByAliases = (fields = [], rowData = {}, aliases = []) => {
  const normalizedAliases = aliases.map(normalizeKey);
  const candidates = [...(Array.isArray(fields) ? fields : []), ...Object.keys(rowData || {})];

  for (const candidate of candidates) {
    if (normalizedAliases.includes(normalizeKey(candidate))) {
      return candidate;
    }
  }

  for (const aliasKey of normalizedAliases) {
    const startsWith = candidates.find((candidate) => normalizeKey(candidate).startsWith(aliasKey));
    if (startsWith) return startsWith;

    const includes = candidates.find((candidate) => normalizeKey(candidate).includes(aliasKey));
    if (includes) return includes;
  }

  return null;
};

const ISSUE_ID_ALIASES = ["issue id", "id", "task id", "card id", "row id"];
const TITLE_ALIASES = ["title", "issue title", "task title", "name"];
const PROJECT_NAME_ALIASES = ["project name", "project", "projectname"];

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

const OFF_HOURS_THRESHOLD_MS = 12 * 60 * 60 * 1000;
const EDIT_TIME_FILTERS_STORAGE_KEY_PREFIX = "pay-everyone-edit-time-filters";

const readEditTimeFilters = (churchId) => {
  if (typeof window === "undefined") return null;
  const storageKey = `${EDIT_TIME_FILTERS_STORAGE_KEY_PREFIX}-${normalizeValue(churchId) || "unknown"}`;

  try {
    const rawValue = window.sessionStorage.getItem(storageKey);
    if (!rawValue) return null;
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    console.warn("Failed to read Edit Time filters from sessionStorage:", error);
    return null;
  }
};

const writeEditTimeFilters = (churchId, filters) => {
  if (typeof window === "undefined") return;
  const storageKey = `${EDIT_TIME_FILTERS_STORAGE_KEY_PREFIX}-${normalizeValue(churchId) || "unknown"}`;

  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(filters));
  } catch (error) {
    console.warn("Failed to write Edit Time filters to sessionStorage:", error);
  }
};

const WEEKS_PER_MONTH = 52 / 12;
const EXPECTED_SCHEDULE_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEFAULT_EXPECTED_START_TIME = "07:00";
const DEFAULT_SCHEDULE_TIMEZONE = "America/New_York";
const SCHEDULE_TIMEZONE_ALIASES = {
  "central america": "America/Guatemala",
  "central america standard time": "America/Guatemala",
  "america/central": "America/Guatemala",
  cst: "America/Guatemala",
  "cst (central america)": "America/Guatemala",
  bolivia: "America/La_Paz",
  bolivna: "America/La_Paz",
  "la paz": "America/La_Paz",
  ecuador: "America/Guayaquil",
  paraguay: "America/Asuncion",
  uruguay: "America/Montevideo",
  venezuela: "America/Caracas",
  "america/tijuana": "America/Tijuana",
};

const normalizeScheduleTimezone = (value) => {
  const rawTimezone = normalizeValue(value);
  if (!rawTimezone) return DEFAULT_SCHEDULE_TIMEZONE;

  const normalizedKey = rawTimezone.toLowerCase();
  const canonicalTimezone = SCHEDULE_TIMEZONE_ALIASES[normalizedKey] || rawTimezone;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: canonicalTimezone }).format(new Date());
    return canonicalTimezone;
  } catch (error) {
    return DEFAULT_SCHEDULE_TIMEZONE;
  }
};

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

const formatDateForInput = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const parseDateInputValue = (value) => {
  const normalizedValue = normalizeValue(value);
  if (!normalizedValue) return Number.NaN;
  const parsedDate = Date.parse(`${normalizedValue}T00:00:00`);
  return Number.isFinite(parsedDate) ? parsedDate : Number.NaN;
};

const getCustomRangeFromInputs = ({ startDate, endDate }) => {
  const startMs = parseDateInputValue(startDate);
  const endMs = parseDateInputValue(endDate);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return { startMs: Number.NaN, endMs: Number.NaN };
  }

  const startDateObj = new Date(startMs);
  startDateObj.setHours(0, 0, 0, 0);
  const endDateObj = new Date(endMs);
  endDateObj.setHours(23, 59, 59, 999);

  return { startMs: startDateObj.getTime(), endMs: endDateObj.getTime() };
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

const getZonedDateParts = (timestamp, timeZone = DEFAULT_SCHEDULE_TIMEZONE) => {
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

  const safeTimezone = normalizeScheduleTimezone(timeZone);

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimezone,
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

const getNotesGrade = (totalNotes = 0) => {
  const notesCount = Math.max(0, Number(totalNotes) || 0);
  if (notesCount >= 10) return "A+";
  if (notesCount >= 8) return "A";
  if (notesCount >= 4) return "B";
  if (notesCount >= 2) return "C";
  if (notesCount >= 1) return "D";
  return "F";
};

const LESSON_LIMIT_PERIOD_OPTIONS = [
  { value: "week", label: "Per Week" },
  { value: "month", label: "Per Month" },
  { value: "year", label: "Per Year" },
];

const DEFAULT_LESSON_LIMIT_CONFIG = {
  enabled: false,
  period: "month",
  maxCount: 0,
  lessonName: "",
  supervisorPin: "",
};

const AttendanceTrackerTab = ({
  combinedUsers,
  rows,
  activeTimers,
  dateFilterPreset,
  setDateFilterPreset,
  customDateStart,
  customDateEnd,
  setCustomDateStart,
  setCustomDateEnd,
  userCompSettings,
  draftCompSettings,
  DATE_FILTER_OPTIONS,
  selectedUser,
  setSelectedUser,
  userOptions,
  onAddLessonLearned,
  onViewLessonsLearned,
  setReceiptSignatureViewer,
}) => {
  const [attendanceView, setAttendanceView] = useState("day");

  const attendanceEntries = useMemo(() => {
    const currentTimestamp = Date.now();
    const { startMs, endMs } = getRangeForPreset(dateFilterPreset, {
      startDate: customDateStart,
      endDate: customDateEnd,
    });
    const attendanceSourceRows = [
      ...rows,
      ...(dateFilterPreset === "today"
        ? activeTimers.map((timerEntry) => ({
            userKey: timerEntry.userKey,
            userId: timerEntry.userId,
            userEmail: timerEntry.userEmail,
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
    const notesByDay = new Map();
    filteredRows.forEach((row) => {
      const referenceTimestamp = Number(row.startedAt) || Number(row.endedAt) || 0;
      if (!referenceTimestamp) return;

      const compUserKey = resolveCompUserKey({
        userKey: row.userKey,
        userId: row.userId,
        userEmail: row.userEmail,
        userLabel: row.userLabel,
        savedSettingsMap: userCompSettings,
        draftSettingsMap: draftCompSettings,
      });

      const effectiveComp = resolveEffectiveCompEntry({
        userKey: compUserKey,
        referenceTimestamp: currentTimestamp,
        savedSettingsMap: userCompSettings,
        draftSettingsMap: draftCompSettings,
        includeDraftPreview: true,
      });
      const lessonsLearned = normalizeLessonsLearned(userCompSettings?.[compUserKey]?.lessonsLearned);
      const lessonsAcknowledgements = normalizeLessonsAcknowledgements(userCompSettings?.[compUserKey]?.lessonsAcknowledgements);

      const schedule = normalizeExpectedSchedule(effectiveComp.expectedSchedule);
      const scheduleTimezone = normalizeScheduleTimezone(effectiveComp.scheduleTimezone);
      const zonedParts = getZonedDateParts(referenceTimestamp, scheduleTimezone);
      if (!zonedParts.dateKey) return;

      const scheduledTime = schedule[zonedParts.weekday] || DEFAULT_EXPECTED_START_TIME;
      const expectedMinutes = getMinutesFromTimeString(scheduledTime);
      const actualMinutes = (zonedParts.hour * 60) + zonedParts.minute;
      const diffMinutes = actualMinutes - expectedMinutes;
      const entryKey = `${normalizeValue(row.userKey)}::${zonedParts.dateKey}`;
      const currentEntry = firstClockInsByDay.get(entryKey);
      const rowNotesCount = Array.isArray(row.notesList) ? row.notesList.length : 0;
      notesByDay.set(entryKey, (Number(notesByDay.get(entryKey)) || 0) + rowNotesCount);
      const dayReceipts = lessonsAcknowledgements.filter((ack) => normalizeValue(ack.dateKey) === zonedParts.dateKey);
      const latestDayReceipt = dayReceipts[0] || null;

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
          totalNotes: Number(notesByDay.get(entryKey)) || 0,
          lessonsLearned,
          lessonsLearnedCount: lessonsLearned.length,
          lessonReceiptCount: dayReceipts.length,
          latestLessonReceipt: latestDayReceipt,
          scheduleTimezone,
        });
      } else {
        firstClockInsByDay.set(entryKey, {
          ...currentEntry,
          totalNotes: Number(notesByDay.get(entryKey)) || 0,
          lessonsLearned,
          lessonsLearnedCount: lessonsLearned.length,
          lessonReceiptCount: dayReceipts.length,
          latestLessonReceipt: latestDayReceipt,
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

        const compUserKey = resolveCompUserKey({
          userKey,
          userId: userEntry.userId,
          userEmail: userEntry.userEmail,
          userLabel: userEntry.userLabel,
          savedSettingsMap: userCompSettings,
          draftSettingsMap: draftCompSettings,
        });

        const effectiveComp = resolveEffectiveCompEntry({
          userKey: compUserKey,
          referenceTimestamp: currentTimestamp,
          savedSettingsMap: userCompSettings,
          draftSettingsMap: draftCompSettings,
          includeDraftPreview: true,
        });
        const lessonsLearned = normalizeLessonsLearned(userCompSettings?.[compUserKey]?.lessonsLearned);
        const lessonsAcknowledgements = normalizeLessonsAcknowledgements(userCompSettings?.[compUserKey]?.lessonsAcknowledgements);

        const schedule = normalizeExpectedSchedule(effectiveComp.expectedSchedule);
        const scheduleTimezone = normalizeScheduleTimezone(effectiveComp.scheduleTimezone);
        const zonedParts = getZonedDateParts(currentTimestamp, scheduleTimezone);
        if (!zonedParts.dateKey) return;

        const missingEntryKey = `${userKey}::${zonedParts.dateKey}`;
        if (firstClockInsByDay.has(missingEntryKey)) return;

        const scheduledTime = schedule[zonedParts.weekday] || DEFAULT_EXPECTED_START_TIME;
        const expectedMinutes = getMinutesFromTimeString(scheduledTime);
        const dayReceipts = lessonsAcknowledgements.filter((ack) => normalizeValue(ack.dateKey) === zonedParts.dateKey);
        const latestDayReceipt = dayReceipts[0] || null;

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
          totalNotes: 0,
          lessonsLearned,
          lessonsLearnedCount: lessonsLearned.length,
          lessonReceiptCount: dayReceipts.length,
          latestLessonReceipt: latestDayReceipt,
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
          const lateGrade = "F";
          const noteGrade = getNotesGrade(entry.totalNotes);
          return {
            ...entry,
            trackedDays: 1,
            onTimeDays: 0,
            totalLateMinutes: 0,
            totalEarlyMinutes: 0,
            totalNotes: Number(entry.totalNotes) || 0,
            lessonsLearned: Array.isArray(entry.lessonsLearned) ? entry.lessonsLearned : [],
            lessonsLearnedCount: Number(entry.lessonsLearnedCount) || 0,
            lessonReceiptCount: Number(entry.lessonReceiptCount) || 0,
            latestLessonReceipt: entry.latestLessonReceipt || null,
            averageLateMinutes: 0,
            lateGrade,
            noteGrade,
            ...getPunctualityColors(lateGrade),
          };
        }

        const lateMinutes = Math.max(0, entry.diffMinutes);
        let lateGrade = getPunctualityGrade(lateMinutes);
        let attendanceNote = "";

        if (entry.diffMinutes <= -30) {
          lateGrade = "A+";
        } else if (entry.diffMinutes <= -15) {
          lateGrade = "A";
          attendanceNote = "Started 15+ min before schedule";
        } else if (entry.diffMinutes <= -5) {
          lateGrade = "A-";
        }

        const notesCount = Number(entry.totalNotes) || 0;
        const noteGrade = getNotesGrade(notesCount);
        if (lateGrade === "A+" && notesCount < 10) {
          attendanceNote = attendanceNote
            ? `${attendanceNote} | Needs 10 notes for A+ (${notesCount}/10)`
            : `Needs 10 notes for A+ (${notesCount}/10)`;
        }

        return {
          ...entry,
          trackedDays: 1,
          onTimeDays: entry.diffMinutes <= 0 ? 1 : 0,
          totalLateMinutes: lateMinutes,
          totalEarlyMinutes: Math.max(0, -entry.diffMinutes),
          totalNotes: notesCount,
          lessonsLearned: Array.isArray(entry.lessonsLearned) ? entry.lessonsLearned : [],
          lessonsLearnedCount: Number(entry.lessonsLearnedCount) || 0,
          lessonReceiptCount: Number(entry.lessonReceiptCount) || 0,
          latestLessonReceipt: entry.latestLessonReceipt || null,
          averageLateMinutes: lateMinutes,
          attendanceNote,
          lateGrade,
          noteGrade,
          ...getPunctualityColors(lateGrade),
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
        totalNotes: 0,
        lessonsLearned: [],
        lessonsLearnedCount: 0,
        lessonReceiptCount: 0,
        latestLessonReceipt: null,
      };

      current.trackedDays += 1;
      if (entry.diffMinutes <= 0) current.onTimeDays += 1;
      current.totalLateMinutes += Math.max(0, entry.diffMinutes);
      current.totalEarlyMinutes += Math.max(0, -entry.diffMinutes);
      current.totalNotes += Number(entry.totalNotes) || 0;
      current.lessonsLearned = Array.isArray(entry.lessonsLearned) ? entry.lessonsLearned : [];
      current.lessonsLearnedCount = Number(entry.lessonsLearnedCount) || 0;
      current.lessonReceiptCount += Number(entry.lessonReceiptCount) || 0;
      if (
        entry.latestLessonReceipt
        && (
          !current.latestLessonReceipt
          || (Number(entry.latestLessonReceipt.acknowledgedAt) || 0) > (Number(current.latestLessonReceipt.acknowledgedAt) || 0)
        )
      ) {
        current.latestLessonReceipt = entry.latestLessonReceipt;
      }

      weeklyMap.set(aggregateKey, current);
    });

    return Array.from(weeklyMap.values())
      .map((entry) => {
        const averageLateMinutes = entry.trackedDays > 0 ? entry.totalLateMinutes / entry.trackedDays : 0;
        const lateGrade = getPunctualityGrade(averageLateMinutes);
        const noteGrade = getNotesGrade(entry.totalNotes);
        return {
          ...entry,
          lateGrade,
          noteGrade,
          averageLateMinutes,
          ...getPunctualityColors(lateGrade),
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
          {dateFilterPreset === "custom" && (
            <div style={{ marginTop: "10px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div>
                <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
                  Start Date
                </label>
                <input
                  type="date"
                  value={customDateStart}
                  onChange={(event) => setCustomDateStart(event.target.value)}
                  style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
                  End Date
                </label>
                <input
                  type="date"
                  value={customDateEnd}
                  onChange={(event) => setCustomDateEnd(event.target.value)}
                  style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
                />
              </div>
            </div>
          )}
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
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
          <thead>
            <tr style={{ backgroundColor: "#F8FAFC" }}>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>User</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>{attendanceView === "day" ? "Day" : "Week"}</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>Late Grade</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>Note Grade</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>{attendanceView === "day" ? "Expected Start (TZ)" : "Tracked Days"}</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>{attendanceView === "day" ? "First Start" : "On Time"}</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>Total Notes</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>Lessons Learned</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>Total Early</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>Total Late</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>{attendanceView === "day" ? "Variance" : "Avg Late"}</th>
            </tr>
          </thead>
          <tbody>
            {attendanceEntries.length === 0 ? (
              <tr>
                <td colSpan={11} style={{ padding: "14px", color: "#64748B" }}>No attendance data found for the selected filters.</td>
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
                    <div>{entry.lateGrade || "-"}</div>
                    {attendanceView === "day" && entry.attendanceNote ? (
                      <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#475569", marginTop: "2px" }}>
                        {entry.attendanceNote}
                      </div>
                    ) : null}
                  </td>
                  <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#334155", fontWeight: 800 }}>
                    {entry.noteGrade || "-"}
                  </td>
                  <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>
                    {attendanceView === "day"
                      ? `${formatScheduleTimeLabel(entry.expectedStartTime)} (${normalizeScheduleTimezone(entry.scheduleTimezone)})`
                      : entry.trackedDays}
                  </td>
                  <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>
                    {attendanceView === "day"
                      ? (entry.isAbsent
                        ? "Not signed"
                        : `${formatScheduleTimeLabel(`${String(Math.floor(entry.actualStartMinutes / 60)).padStart(2, "0")}:${String(entry.actualStartMinutes % 60).padStart(2, "0")}`)} (${normalizeScheduleTimezone(entry.scheduleTimezone)})`)
                      : `${entry.onTimeDays} / ${entry.trackedDays}`}
                  </td>
                  <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#334155", fontWeight: 700 }}>
                    {Number(entry.totalNotes) || 0}
                  </td>
                  <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => onViewLessonsLearned?.(entry)}
                        title={Array.isArray(entry.lessonsLearned) && entry.lessonsLearned.length > 0
                          ? entry.lessonsLearned
                            .map((lesson, lessonIndex) => `${lessonIndex + 1}. ${normalizeValue(lesson.text)}${normalizeValue(lesson.createdBy) ? ` (${normalizeValue(lesson.createdBy)})` : ""}`)
                            .join("\n")
                          : "No lessons learned submitted yet."}
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: "999px",
                          border: "1px solid #BFDBFE",
                          backgroundColor: "#EFF6FF",
                          color: "#1D4ED8",
                          fontSize: "0.74rem",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        {Number(entry.lessonsLearnedCount) || 0}
                      </button>
                      <button
                        type="button"
                        onClick={() => onAddLessonLearned?.(entry)}
                        style={{
                          border: "1px solid #CBD5E1",
                          backgroundColor: "#FFFFFF",
                          color: "#1E293B",
                          borderRadius: "8px",
                          padding: "4px 8px",
                          fontWeight: 700,
                          cursor: "pointer",
                          fontSize: "0.75rem",
                        }}
                      >
                        Add Lesson
                      </button>
                    </div>
                    {attendanceView === "day" ? (
                      Number(entry.lessonReceiptCount) > 0 && entry.latestLessonReceipt ? (
                        <div
                          onClick={() => setReceiptSignatureViewer(entry.latestLessonReceipt)}
                          style={{ marginTop: "6px", fontSize: "0.72rem", color: "#047857", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}
                        >
                          Receipt: {normalizeValue(entry.latestLessonReceipt.acknowledgedByName) || "Signed"} • {formatTimestamp(entry.latestLessonReceipt.acknowledgedAt)}
                        </div>
                      ) : (
                        <div style={{ marginTop: "6px", fontSize: "0.72rem", color: "#B45309", fontWeight: 700 }}>
                          Receipt pending for this day
                        </div>
                      )
                    ) : (
                      <div style={{ marginTop: "6px", fontSize: "0.72rem", color: "#475569", fontWeight: 700 }}>
                        Receipts this week: {Number(entry.lessonReceiptCount) || 0}
                      </div>
                    )}
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

const LessonsSubmittedTab = ({
  lessonLimitConfig,
  setLessonLimitConfig,
  onSaveLessonLimitConfig,
  savingLessonLimitConfig,
  onDeleteLesson,
  deletingLessonId,
  userCompSettings,
  combinedUsers,
}) => {
  const [lessonUserFilter, setLessonUserFilter] = useState("all");
  const [lessonSearch, setLessonSearch] = useState("");
  const [showSupervisorPin, setShowSupervisorPin] = useState(false);

  const userLabelByKey = useMemo(() => {
    const mapped = new Map();
    combinedUsers.forEach((entry) => {
      const userKey = normalizeValue(entry?.userKey);
      if (!userKey) return;
      mapped.set(userKey, normalizeValue(entry?.userLabel) || userKey);
    });
    return mapped;
  }, [combinedUsers]);

  const submittedLessons = useMemo(() => {
    const entries = [];

    Object.entries(userCompSettings || {}).forEach(([userKey, settings]) => {
      const normalizedUserKey = normalizeValue(userKey);
      const userLabel =
        normalizeValue(settings?.userLabel)
        || userLabelByKey.get(normalizedUserKey)
        || normalizedUserKey
        || "Unknown user";

      normalizeLessonsLearned(settings?.lessonsLearned).forEach((lesson, lessonIndex) => {
        entries.push({
          id: `${normalizedUserKey}-${Number(lesson?.createdAt) || 0}-${lessonIndex}`,
          userKey: normalizedUserKey,
          docId: normalizeValue(settings?.docId),
          userLabel,
          name: normalizeValue(lesson?.name),
          minimumRequired: normalizeValue(lesson?.minimumRequired),
          text: normalizeValue(lesson?.text),
          createdBy: normalizeValue(lesson?.createdBy),
          createdAt: Number(lesson?.createdAt) || 0,
          source: normalizeValue(lesson?.source),
          autoKey: normalizeValue(lesson?.autoKey),
        });
      });
    });

    return entries.sort((left, right) => (Number(right.createdAt) || 0) - (Number(left.createdAt) || 0));
  }, [userCompSettings, userLabelByKey]);

  const lessonUserOptions = useMemo(() => {
    const mapped = new Map();
    submittedLessons.forEach((entry) => {
      if (!entry.userKey) return;
      if (!mapped.has(entry.userKey)) mapped.set(entry.userKey, entry.userLabel);
    });

    return Array.from(mapped.entries())
      .map(([userKey, userLabel]) => ({ userKey, userLabel }))
      .sort((left, right) => normalizeValue(left.userLabel).localeCompare(normalizeValue(right.userLabel)));
  }, [submittedLessons]);

  const filteredLessons = useMemo(() => {
    const normalizedSearch = normalizeValue(lessonSearch).toLowerCase();

    return submittedLessons.filter((entry) => {
      const matchesUser = lessonUserFilter === "all" || entry.userKey === lessonUserFilter;
      if (!matchesUser) return false;
      if (!normalizedSearch) return true;

      const haystack = [
        normalizeValue(entry.userLabel),
        normalizeValue(entry.name),
        normalizeValue(entry.minimumRequired),
        normalizeValue(entry.text),
        normalizeValue(entry.createdBy),
      ].join(" ").toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [lessonSearch, lessonUserFilter, submittedLessons]);

  const lessonNameOptions = useMemo(() => {
    const mapped = new Map();
    submittedLessons.forEach((entry) => {
      const nameValue = normalizeValue(entry.name);
      if (!nameValue) return;
      const optionKey = nameValue.toLowerCase();
      if (!mapped.has(optionKey)) mapped.set(optionKey, nameValue);
    });

    return Array.from(mapped.values()).sort((left, right) => left.localeCompare(right));
  }, [submittedLessons]);

  return (
    <div style={{ marginTop: "12px" }}>
      <div style={{ border: "1px solid #E2E8F0", borderRadius: "12px", backgroundColor: "#F8FAFC", padding: "12px", marginBottom: "12px" }}>
        <div style={{ color: "#0F172A", fontWeight: 800, marginBottom: "8px" }}>Lesson Limit and Supervisor PIN</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", color: "#1E293B", fontWeight: 700 }}>
            <input
              type="checkbox"
              checked={lessonLimitConfig.enabled === true}
              onChange={(event) => setLessonLimitConfig((current) => ({
                ...current,
                enabled: event.target.checked,
              }))}
            />
            Require Supervisor PIN after per-lesson limit
          </label>

          <div>
            <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
              Limit Period
            </label>
            <select
              value={normalizeValue(lessonLimitConfig.period) || "month"}
              onChange={(event) => setLessonLimitConfig((current) => ({
                ...current,
                period: event.target.value,
              }))}
              style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
            >
              {LESSON_LIMIT_PERIOD_OPTIONS.map((option) => (
                <option key={`lesson-limit-period-${option.value}`} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
              Allowed Count Per Lesson
            </label>
            <input
              type="number"
              min="0"
              step="1"
              value={Number(lessonLimitConfig.maxCount) || 0}
              onChange={(event) => setLessonLimitConfig((current) => ({
                ...current,
                maxCount: Math.max(0, Math.floor(Number(event.target.value) || 0)),
              }))}
              style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
              Select Lesson For This Limit
            </label>
            <select
              value={normalizeValue(lessonLimitConfig.lessonName)}
              onChange={(event) => setLessonLimitConfig((current) => ({
                ...current,
                lessonName: normalizeValue(event.target.value),
              }))}
              style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
            >
              <option value="">-- choose lesson --</option>
              {lessonNameOptions.map((lessonOptionName) => (
                <option key={`lesson-limit-name-${lessonOptionName}`} value={lessonOptionName}>{lessonOptionName}</option>
              ))}
            </select>
            <div style={{ color: "#64748B", fontSize: "0.76rem", marginTop: "4px" }}>
              This limit applies only to the selected lesson.
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
              Supervisor PIN (Only managed on this page)
            </label>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type={showSupervisorPin ? "text" : "password"}
                value={normalizeValue(lessonLimitConfig.supervisorPin)}
                onChange={(event) => setLessonLimitConfig((current) => ({
                  ...current,
                  supervisorPin: normalizeValue(event.target.value),
                }))}
                placeholder="Enter supervisor PIN"
                style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
              />
              <button
                type="button"
                onClick={() => setShowSupervisorPin((current) => !current)}
                style={{ border: "1px solid #CBD5E1", backgroundColor: "#FFFFFF", borderRadius: "8px", padding: "8px 10px", color: "#334155", fontWeight: 700, cursor: "pointer" }}
              >
                {showSupervisorPin ? "Hide" : "View"}
              </button>
            </div>
          </div>
        </div>

        <div style={{ marginTop: "10px", display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onSaveLessonLimitConfig}
            disabled={savingLessonLimitConfig}
            style={{ border: "none", backgroundColor: "#1D4ED8", color: "#FFFFFF", borderRadius: "8px", padding: "8px 12px", fontWeight: 700, cursor: savingLessonLimitConfig ? "not-allowed" : "pointer", opacity: savingLessonLimitConfig ? 0.75 : 1 }}
          >
            {savingLessonLimitConfig ? "Saving..." : "Save Limit Settings"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px", marginBottom: "12px" }}>
        <div style={{ backgroundColor: "#EFF6FF", color: "#1D4ED8", borderRadius: "12px", padding: "12px" }}>
          <div style={{ fontSize: "0.78rem", fontWeight: 700, opacity: 0.85 }}>Total Submitted Lessons</div>
          <div style={{ fontSize: "1.7rem", fontWeight: 800 }}>{submittedLessons.length}</div>
        </div>
        <div style={{ backgroundColor: "#ECFDF5", color: "#065F46", borderRadius: "12px", padding: "12px" }}>
          <div style={{ fontSize: "0.78rem", fontWeight: 700, opacity: 0.85 }}>Visible Results</div>
          <div style={{ fontSize: "1.7rem", fontWeight: 800 }}>{filteredLessons.length}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px", marginBottom: "12px" }}>
        <div>
          <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
            Filter User
          </label>
          <select
            value={lessonUserFilter}
            onChange={(event) => setLessonUserFilter(event.target.value)}
            style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
          >
            <option value="all">All Users</option>
            {lessonUserOptions.map((option) => (
              <option key={`lesson-user-${option.userKey}`} value={option.userKey}>{option.userLabel}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
            Search Lessons
          </label>
          <input
            type="text"
            value={lessonSearch}
            onChange={(event) => setLessonSearch(event.target.value)}
            placeholder="Search by lesson name, requirement, or text"
            style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
          />
        </div>
      </div>

      <div style={{ marginLeft: "-16px", marginRight: "-16px", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
          <thead>
            <tr style={{ backgroundColor: "#F8FAFC" }}>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>Submitted</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>User</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>Lesson Name</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>Minimum Required</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>Lesson</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>Created By</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredLessons.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: "14px", color: "#64748B" }}>No submitted lessons match your filter.</td>
              </tr>
            ) : (
              filteredLessons.map((entry) => (
                <tr key={entry.id}>
                  <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#334155", whiteSpace: "nowrap" }}>
                    {entry.createdAt ? formatTimestamp(entry.createdAt) : "-"}
                  </td>
                  <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#0F172A", fontWeight: 700 }}>
                    {entry.userLabel}
                  </td>
                  <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#1E293B", fontWeight: 700 }}>
                    {entry.name || "-"}
                  </td>
                  <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>
                    {entry.minimumRequired || "-"}
                  </td>
                  <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#334155", maxWidth: "520px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {entry.text || "-"}
                  </td>
                  <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#475569" }}>
                    {entry.createdBy || "-"}
                  </td>
                  <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9" }}>
                    <button
                      type="button"
                      onClick={() => onDeleteLesson?.(entry)}
                      disabled={deletingLessonId === entry.id}
                      style={{
                        border: "1px solid #DC2626",
                        backgroundColor: deletingLessonId === entry.id ? "#FEE2E2" : "#FFFFFF",
                        color: "#B91C1C",
                        borderRadius: "8px",
                        padding: "6px 10px",
                        fontWeight: 700,
                        cursor: deletingLessonId === entry.id ? "not-allowed" : "pointer",
                      }}
                    >
                      {deletingLessonId === entry.id ? "Deleting..." : "Delete"}
                    </button>
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
    expectedSchedule: normalizeExpectedSchedule(value.expectedSchedule),
    scheduleTimezone: normalizeScheduleTimezone(value.scheduleTimezone),
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
    && JSON.stringify(leftSnapshot.expectedSchedule) === JSON.stringify(rightSnapshot.expectedSchedule)
    && leftSnapshot.scheduleTimezone === rightSnapshot.scheduleTimezone
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

const normalizeLessonQuestions = (value = []) => {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      const options = Array.isArray(entry?.options) && entry.options.length > 0 
        ? entry.options.map(o => normalizeValue(o)).filter(o => o)
        : ["Yes", "No"];
      return {
        question: normalizeValue(entry?.question),
        answer: normalizeValue(entry?.answer),
        options,
      };
    })
    .filter((entry) => entry.question);
};

const normalizeLessonsLearned = (value = []) => {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      if (typeof entry === "string") {
        const text = normalizeValue(entry);
        if (!text) return null;
        return {
          text,
          name: "",
          minimumRequired: "",
          createdAt: 0,
          createdBy: "",
          source: "",
          autoKey: "",
          questions: [],
        };
      }

      const text = normalizeValue(entry?.text);
      if (!text) return null;
      return {
        text,
        name: normalizeValue(entry?.name),
        minimumRequired: normalizeValue(entry?.minimumRequired),
        createdAt: toTimestampMs(entry?.createdAt),
        createdBy: normalizeValue(entry?.createdBy),
        source: normalizeValue(entry?.source),
        autoKey: normalizeValue(entry?.autoKey),
        questions: normalizeLessonQuestions(entry?.questions),
      };
    })
    .filter(Boolean)
    .sort((left, right) => (Number(right.createdAt) || 0) - (Number(left.createdAt) || 0));
};

const normalizeLessonsAcknowledgements = (value = []) => {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      const lessonKey = normalizeValue(entry?.lessonKey);
      const lessonText = normalizeValue(entry?.lessonText);
      if (!lessonKey && !lessonText) return null;

      return {
        lessonKey,
        lessonText,
        lessonCreatedAt: toTimestampMs(entry?.lessonCreatedAt),
        acknowledgedAt: toTimestampMs(entry?.acknowledgedAt),
        acknowledgedByUserId: normalizeValue(entry?.acknowledgedByUserId),
        acknowledgedByEmail: normalizeValue(entry?.acknowledgedByEmail),
        acknowledgedByName: normalizeValue(entry?.acknowledgedByName),
        signature: normalizeValue(entry?.signature),
        dateKey: normalizeValue(entry?.dateKey),
        scheduleTimezone: normalizeValue(entry?.scheduleTimezone),
      };
    })
    .filter(Boolean)
    .sort((left, right) => (Number(right.acknowledgedAt) || 0) - (Number(left.acknowledgedAt) || 0));
};

const normalizeLessonLimitConfig = (value = {}) => {
  const normalizedPeriod = normalizeValue(value?.period).toLowerCase();
  return {
    enabled: value?.enabled === true,
    period: ["week", "month", "year"].includes(normalizedPeriod) ? normalizedPeriod : "month",
    maxCount: Math.max(0, Math.floor(Number(value?.maxCount) || 0)),
    lessonName: normalizeValue(value?.lessonName),
    supervisorPin: normalizeValue(value?.supervisorPin),
  };
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
      expectedSchedule: normalizeExpectedSchedule(savedSettings.expectedSchedule),
      scheduleTimezone: normalizeScheduleTimezone(savedSettings.scheduleTimezone),
    };
  }

  const safeTimestamp = Number(referenceTimestamp) || 0;
  const matched = nextLog
    .filter((entry) => Number(entry.effectiveFrom || 0) <= safeTimestamp)
    .sort((left, right) => Number(right.effectiveFrom || 0) - Number(left.effectiveFrom || 0))[0];

  const effectiveEntry = matched || nextLog[0];
  return {
    ...effectiveEntry,
    expectedSchedule: normalizeExpectedSchedule(
      effectiveEntry?.expectedSchedule
      || savedSettings.expectedSchedule
    ),
    scheduleTimezone: normalizeScheduleTimezone(
      effectiveEntry?.scheduleTimezone
      || savedSettings.scheduleTimezone
    ),
  };
};

const resolveCompUserKey = ({
  userKey,
  userId,
  userEmail,
  userLabel,
  savedSettingsMap,
  draftSettingsMap,
} = {}) => {
  const candidates = [
    normalizeValue(userKey),
    normalizeUserKey({
      userId: normalizeValue(userId),
      userEmail: normalizeValue(userEmail),
      userLabel: normalizeValue(userLabel),
    }),
    normalizeComparable(userId || "").replace(/[^a-z0-9]+/g, "_"),
    normalizeComparable(userEmail || "").replace(/[^a-z0-9]+/g, "_"),
    normalizeComparable(userLabel || "").replace(/[^a-z0-9]+/g, "_"),
  ].filter(Boolean);

  const uniqueCandidates = Array.from(new Set(candidates));
  const matchedKey = uniqueCandidates.find((candidate) =>
    Boolean(savedSettingsMap?.[candidate]) || Boolean(draftSettingsMap?.[candidate])
  );

  if (matchedKey) return matchedKey;

  const normalizedCandidates = uniqueCandidates
    .map((candidate) => normalizeComparable(candidate).replace(/[^a-z0-9]+/g, "_"))
    .filter(Boolean);

  const findMatchingMapKey = (settingsMap = {}) => {
    const mapEntries = Object.entries(settingsMap || {});
    for (const [mapKey, settings] of mapEntries) {
      const entryCandidates = [
        normalizeValue(mapKey),
        normalizeValue(settings?.userKey),
        normalizeValue(settings?.userId),
        normalizeValue(settings?.userEmail),
        normalizeValue(settings?.userLabel),
      ]
        .map((entry) => normalizeComparable(entry).replace(/[^a-z0-9]+/g, "_"))
        .filter(Boolean);

      if (entryCandidates.some((entryCandidate) => normalizedCandidates.includes(entryCandidate))) {
        return mapKey;
      }
    }
    return "";
  };

  const matchedFromSaved = findMatchingMapKey(savedSettingsMap);
  if (matchedFromSaved) return matchedFromSaved;

  const matchedFromDraft = findMatchingMapKey(draftSettingsMap);
  if (matchedFromDraft) return matchedFromDraft;

  return uniqueCandidates[0] || "";
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
  const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  return addDays(dayStart, -offset);
};

const getFirstWeekStartOfYear = (year) => {
  const firstDay = startOfDay(new Date(year, 0, 1));
  const dayOfWeek = firstDay.getDay();
  const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  return addDays(firstDay, -offset);
};

const getWeekRangeForYearWeek = (year, weekNumber) => {
  const normalizedWeek = Math.max(1, Math.min(53, Number(weekNumber) || 1));
  const firstWeekStart = getFirstWeekStartOfYear(year);
  const weekStart = addDays(firstWeekStart, (normalizedWeek - 1) * 7);
  const weekEnd = addDays(weekStart, 6);

  return {
    weekStart,
    weekEnd,
    startMs: weekStart.getTime(),
    endMs: addDays(weekEnd, 1).getTime() - 1,
  };
};

const getRangeForPreset = (preset, customRange = {}) => {
  const today = startOfDay(new Date());

  switch (preset) {
    case "today":
      return { startMs: today.getTime(), endMs: addDays(today, 1).getTime() - 1 };
    case "yesterday": {
      const yesterday = addDays(today, -1);
      return { startMs: yesterday.getTime(), endMs: today.getTime() - 1 };
    }
    case "thisWeek": {
      const weekStart = startOfWeek(today);
      return { startMs: weekStart.getTime(), endMs: addDays(weekStart, 7).getTime() - 1 };
    }
    case "lastWeek": {
      const thisWeekStart = startOfWeek(today);
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
    case "custom": {
      return getCustomRangeFromInputs(customRange || {});
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
  { value: "custom", label: "Custom Range" },
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
  customDateStart,
  customDateEnd,
  setCustomDateStart,
  setCustomDateEnd,
  userCompSettings,
  draftCompSettings,
  DATE_FILTER_OPTIONS,
}) => {
  const { startMs, endMs } = getRangeForPreset(dateFilterPreset, {
    startDate: customDateStart,
    endDate: customDateEnd,
  });

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
        {dateFilterPreset === "custom" && (
          <div style={{ marginTop: "10px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <div>
              <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
                Start Date
              </label>
              <input
                type="date"
                value={customDateStart}
                onChange={(event) => setCustomDateStart(event.target.value)}
                style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
                End Date
              </label>
              <input
                type="date"
                value={customDateEnd}
                onChange={(event) => setCustomDateEnd(event.target.value)}
                style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
              />
            </div>
          </div>
        )}
      </div>

      <div style={{ marginLeft: "-16px", marginRight: "-16px", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
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

const WeeklyOwedHoursTab = ({
  combinedUsers,
  rows,
  userCompSettings,
  draftCompSettings,
  formatDateOnly,
}) => {
  const currentYear = new Date().getFullYear();
  const [selectedUser, setSelectedUser] = useState("all");
  const [selectedViewMode, setSelectedViewMode] = useState("week");
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedWeek, setSelectedWeek] = useState(1);

  const yearOptions = useMemo(() => {
    const years = new Set([currentYear]);
    rows.forEach((row) => {
      const timestamp = Number(row.endedAt) || Number(row.startedAt) || 0;
      if (timestamp > 0) {
        years.add(new Date(timestamp).getFullYear());
      }
    });
    return Array.from(years).sort((left, right) => right - left);
  }, [currentYear, rows]);

  const monthOptions = useMemo(() => {
    return Array.from({ length: 12 }, (_, index) => ({
      value: index + 1,
      label: new Date(2000, index, 1).toLocaleString("en-US", { month: "long" }),
    }));
  }, []);

  const weekOptions = useMemo(() => {
    const relevantRows =
      selectedUser === "all"
        ? rows
        : rows.filter((row) => normalizeValue(row.userKey) === selectedUser);

    return Array.from({ length: 53 }, (_, index) => {
      const weekNumber = index + 1;
      const weekRange = getWeekRangeForYearWeek(selectedYear, weekNumber);
      const startLabel = formatDateOnly(weekRange.startMs);
      const endLabel = formatDateOnly(weekRange.endMs);
      const hasHours = relevantRows.some((row) => {
        const timestamp = Number(row.endedAt) || Number(row.startedAt) || 0;
        return timestamp >= weekRange.startMs && timestamp <= weekRange.endMs;
      });

      return {
        value: weekNumber,
        label: `Week ${weekNumber} (${startLabel} - ${endLabel})${hasHours ? " •" : ""}`,
        hasHours,
      };
    });
  }, [formatDateOnly, rows, selectedUser, selectedYear]);

  const selectedWeekRange = useMemo(() => {
    return getWeekRangeForYearWeek(selectedYear, selectedWeek);
  }, [selectedYear, selectedWeek]);

  const selectedMonthRange = useMemo(() => {
    const monthStart = new Date(selectedYear, selectedMonth - 1, 1);
    const nextMonthStart = new Date(selectedYear, selectedMonth, 1);
    return {
      startMs: monthStart.getTime(),
      endMs: nextMonthStart.getTime() - 1,
    };
  }, [selectedMonth, selectedYear]);

  const selectedYearRange = useMemo(() => {
    const yearStart = new Date(selectedYear, 0, 1);
    const nextYearStart = new Date(selectedYear + 1, 0, 1);
    return {
      startMs: yearStart.getTime(),
      endMs: nextYearStart.getTime() - 1,
    };
  }, [selectedYear]);

  const selectedPeriodRange = useMemo(() => {
    if (selectedViewMode === "month") return selectedMonthRange;
    if (selectedViewMode === "year") return selectedYearRange;
    return selectedWeekRange;
  }, [selectedMonthRange, selectedViewMode, selectedWeekRange, selectedYearRange]);

  const userOptions = useMemo(() => {
    return [{ userKey: "all", userLabel: "All Users" }].concat(
      combinedUsers.map((entry) => ({
        userKey: entry.userKey,
        userLabel: entry.userLabel || entry.userKey,
      }))
    );
  }, [combinedUsers]);

  const weeklyRows = useMemo(() => {
    const { startMs, endMs } = selectedPeriodRange;

    return combinedUsers
      .filter((entry) => selectedUser === "all" || normalizeValue(entry.userKey) === selectedUser)
      .map((entry) => {
        const effectiveComp = resolveEffectiveCompEntry({
          userKey: entry.userKey,
          referenceTimestamp: Date.now(),
          savedSettingsMap: userCompSettings,
          draftSettingsMap: draftCompSettings,
          includeDraftPreview: false,
        });

        const expectedWeeklyHours = parseNumber(effectiveComp.expectedHours, 40);
        const actualMs = rows
          .filter((row) => {
            const rowUserKey = normalizeValue(row.userKey);
            const rowTimestamp = Number(row.endedAt) || Number(row.startedAt) || 0;
            return rowUserKey === entry.userKey && rowTimestamp >= startMs && rowTimestamp <= endMs;
          })
          .reduce((sum, row) => sum + (Number(row.durationMs) || 0), 0);

        const actualHours = actualMs / (1000 * 60 * 60);
        const varianceHours = actualHours - expectedWeeklyHours;
        const billingType = normalizeValue(effectiveComp.billingType) === "salary" ? "salary" : "hourly";
        const monthlySalary = parseNumber(effectiveComp.monthlySalary);
        const expectedMonthlyHours = expectedWeeklyHours > 0 ? expectedWeeklyHours * WEEKS_PER_MONTH : 0;
        const hourlyRate =
          billingType === "salary" && expectedMonthlyHours > 0
            ? monthlySalary / expectedMonthlyHours
            : parseNumber(effectiveComp.hourlyRate);

        const regularHours = Math.min(actualHours, 60);
        const overtimeHours = Math.max(0, actualHours - 60);
        const regularCost = regularHours * hourlyRate;
        const overtimeCost = overtimeHours * hourlyRate * 2;
        const actualCost = regularCost + overtimeCost;

        return {
          userKey: entry.userKey,
          userLabel: entry.userLabel || entry.userKey,
          expectedWeeklyHours,
          actualHours,
          varianceHours,
          regularHours,
          overtimeHours,
          regularCost,
          overtimeCost,
          actualCost,
          hourlyRate,
        };
      })
      .sort((left, right) => {
        const varianceCompare = right.varianceHours - left.varianceHours;
        if (varianceCompare !== 0) return varianceCompare;
        return normalizeValue(left.userLabel).localeCompare(normalizeValue(right.userLabel));
      });
  }, [combinedUsers, draftCompSettings, rows, selectedPeriodRange, selectedUser, userCompSettings]);

  const subtotalCost = weeklyRows.reduce((sum, row) => sum + row.actualCost, 0);
  const totalCost = subtotalCost;

  const selectedPeriodLabel =
    selectedViewMode === "month"
      ? `${monthOptions.find((option) => option.value === selectedMonth)?.label || "Month"} ${selectedYear}`
      : selectedViewMode === "year"
        ? `Year ${selectedYear}`
        : `Week ${selectedWeek} (${formatDateOnly(selectedWeekRange.startMs)} - ${formatDateOnly(selectedWeekRange.endMs)})`;
  const periodLabel = selectedPeriodLabel;

  return (
    <div style={{ marginTop: "12px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px", marginBottom: "12px" }}>
        <div>
          <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
            Person
          </label>
          <select
            value={selectedUser}
            onChange={(event) => setSelectedUser(event.target.value)}
            style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
          >
            {userOptions.map((option) => (
              <option key={option.userKey} value={option.userKey}>
                {option.userLabel}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
            View By
          </label>
          <select
            value={selectedViewMode}
            onChange={(event) => setSelectedViewMode(event.target.value)}
            style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
          >
            <option value="week">Week</option>
            <option value="month">Month</option>
            <option value="year">Year</option>
          </select>
        </div>
        <div>
          <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
            Year
          </label>
          <select
            value={selectedYear}
            onChange={(event) => setSelectedYear(Number(event.target.value))}
            style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
          >
            {yearOptions.map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
        </div>
        {selectedViewMode === "month" && (
          <div>
            <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
              Month
            </label>
            <select
              value={selectedMonth}
              onChange={(event) => setSelectedMonth(Number(event.target.value))}
              style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
            >
              {monthOptions.map((month) => (
                <option key={month.value} value={month.value}>{month.label}</option>
              ))}
            </select>
          </div>
        )}
        {selectedViewMode === "week" && (
          <div>
            <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
              Week
            </label>
            <select
              value={selectedWeek}
              onChange={(event) => setSelectedWeek(Number(event.target.value))}
              style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
            >
              {weekOptions.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  style={{ fontWeight: option.hasHours ? 700 : 400 }}
                >
                  {option.label}
                </option>
              ))}
            </select>
            <div style={{ marginTop: "6px", fontSize: "0.78rem", color: "#64748B" }}>
              <span style={{ fontWeight: 700 }}>•</span> = week has logged hours
            </div>
          </div>
        )}
      </div>

      <div style={{ marginBottom: "10px", color: "#475569", fontWeight: 700 }}>
        {periodLabel}
      </div>

      <div style={{ marginLeft: "-16px", marginRight: "-16px", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
          <thead>
            <tr style={{ backgroundColor: "#F8FAFC" }}>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>Person</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>Period</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569", backgroundColor: "#EEF2FF" }}>Normal Hrs</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569", backgroundColor: "#EEF2FF" }}>Normal Hourly Rate</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569", backgroundColor: "#EEF2FF" }}>Normal Cost</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569", backgroundColor: "#FEF3C7" }}>Over 60 Hrs</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569", backgroundColor: "#FEF3C7" }}>Over 60 Hourly Rate</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569", backgroundColor: "#FEF3C7" }}>Over 60 Cost</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569", backgroundColor: "#E0F2FE" }}>Total Hrs</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, color: "#475569", backgroundColor: "#E0F2FE" }}>Total Cost</th>
            </tr>
          </thead>
          <tbody>
            {weeklyRows.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ padding: "14px", color: "#64748B" }}>No user data found for this selection.</td>
              </tr>
            ) : (
              weeklyRows.map((row) => {
                return (
                  <tr key={row.userKey}>
                    <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#0F172A", fontWeight: 700 }}>
                      {row.userLabel}
                    </td>
                    <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#334155", fontWeight: 600 }}>
                      {periodLabel}
                    </td>
                    <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", backgroundColor: "#F8FAFF", color: "#334155" }}>
                      {row.regularHours.toFixed(1)} hrs
                    </td>
                    <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", backgroundColor: "#F8FAFF", color: "#334155" }}>
                      {toCurrency(row.hourlyRate)}
                    </td>
                    <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", backgroundColor: "#F8FAFF", color: "#334155" }}>
                      {toCurrency(row.regularCost)}
                    </td>
                    <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", backgroundColor: "#FFFBEA", color: row.overtimeHours > 0 ? "#B45309" : "#334155", fontWeight: 700 }}>
                      {row.overtimeHours.toFixed(1)} hrs
                    </td>
                    <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", backgroundColor: "#FFFBEA", color: row.overtimeHours > 0 ? "#B45309" : "#334155", fontWeight: 700 }}>
                      {toCurrency(row.hourlyRate * 2)}
                    </td>
                    <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", backgroundColor: "#FFFBEA", color: row.overtimeCost > 0 ? "#B45309" : "#334155", fontWeight: 700 }}>
                      {toCurrency(row.overtimeCost)}
                    </td>
                    <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", backgroundColor: "#F0F9FF", color: "#334155" }}>
                      {row.regularHours + row.overtimeHours >= 0 ? `${(row.regularHours + row.overtimeHours).toFixed(1)} hrs` : "0.0 hrs"}
                    </td>
                    <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", backgroundColor: "#F0F9FF", color: "#0F172A", fontWeight: 700 }}>
                      {toCurrency(row.actualCost)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "18px", padding: "10px 6px 0", color: "#0F172A", fontWeight: 700 }}>
        <div>Subtotal: {toCurrency(subtotalCost)}</div>
        <div>Total Cost: {toCurrency(totalCost)}</div>
      </div>
    </div>
  );
};

const PaymentsTab = ({
  id,
  combinedUsers,
  rows,
  userCompSettings,
  draftCompSettings,
  resolveEffectiveCompEntry,
  toCurrency,
  formatDateOnly,
  toHours,
  parseNumber,
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [payments, setPayments] = useState([]);
  const [paymentMethods, setPaymentMethods] = useState({});
  const [paymentsSubTab, setPaymentsSubTab] = useState("summary");
  const [selectedUser, setSelectedUser] = useState("all");
  const [paymentUser, setPaymentUser] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentNote, setPaymentNote] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);
  const [paymentMethodUser, setPaymentMethodUser] = useState("");
  const [paymentMethodType, setPaymentMethodType] = useState("airtm");
  const [paymentMethodOther, setPaymentMethodOther] = useState("");
  const [paymentMethodDetails, setPaymentMethodDetails] = useState("");
  const [paymentMethodNote, setPaymentMethodNote] = useState("");
  const [savingPaymentMethod, setSavingPaymentMethod] = useState(false);
  const [editingPaymentMethodId, setEditingPaymentMethodId] = useState("");
  const [editingPaymentId, setEditingPaymentId] = useState("");
  const [editingPaymentAmount, setEditingPaymentAmount] = useState("");
  const [editingPaymentDate, setEditingPaymentDate] = useState("");
  const [editingPaymentNote, setEditingPaymentNote] = useState("");
  const [savingEditedPayment, setSavingEditedPayment] = useState(false);

  const getPaymentsViewFromUrl = () => {
    const requestedView = new URLSearchParams(location.search).get("view");
    return ["add-payment", "add-method", "summary", "employee"].includes(requestedView)
      ? requestedView
      : "summary";
  };

  useEffect(() => {
    setPaymentsSubTab(getPaymentsViewFromUrl());
  }, [location.search]);

  useEffect(() => {
    if (!id) return () => {};

    const unsubscribe = onSnapshot(
      collection(db, "churches", id, "payEveryonePayments"),
      (snapshot) => {
        const nextPayments = snapshot.docs
          .map((snapshotDoc) => {
            const data = snapshotDoc.data() || {};
            const paymentDateValue = data.paymentDate || data.createdAt || snapshotDoc.createTime?.toMillis?.() || 0;
            const paymentDateMs =
              typeof paymentDateValue === "number"
                ? paymentDateValue
                : toTimestampMs(paymentDateValue);

            return {
              id: snapshotDoc.id,
              userKey: normalizeValue(data.userKey),
              userLabel: normalizeValue(data.userLabel),
              userId: normalizeValue(data.userId),
              userEmail: normalizeValue(data.userEmail),
              amount: parseNumber(data.amount),
              paymentDate: normalizeValue(data.paymentDate),
              note: normalizeValue(data.note),
              paymentDateMs,
            };
          })
          .sort((left, right) => (right.paymentDateMs || 0) - (left.paymentDateMs || 0));

        setPayments(nextPayments);
      }
    );

    return () => unsubscribe();
  }, [id]);

  useEffect(() => {
    if (!id) return () => {};

    const unsubscribe = onSnapshot(
      collection(db, "churches", id, "payEveryonePaymentMethods"),
      (snapshot) => {
        const nextMethods = {};
        snapshot.docs.forEach((snapshotDoc) => {
          const data = snapshotDoc.data() || {};
          const userKey = normalizeValue(data.userKey);
          if (userKey) {
            const method = {
              id: snapshotDoc.id,
              userKey,
              methodType: normalizeValue(data.methodType),
              methodOther: normalizeValue(data.methodOther),
              details: normalizeValue(data.details),
              note: normalizeValue(data.note),
              updatedAt: toTimestampMs(data.updatedAt),
            };
            nextMethods[userKey] = (nextMethods[userKey] || []).concat(method);
          }
        });
        Object.values(nextMethods).forEach((methods) => {
          methods.sort((left, right) => right.updatedAt - left.updatedAt);
        });
        setPaymentMethods(nextMethods);
      }
    );

    return () => unsubscribe();
  }, [id]);

  const userOptions = useMemo(() => {
    return [{ userKey: "all", userLabel: "All Users" }].concat(
      combinedUsers.map((entry) => ({
        userKey: entry.userKey,
        userLabel: entry.userLabel || entry.userKey,
      }))
    );
  }, [combinedUsers]);

  const paymentUserOptions = useMemo(() => {
    return combinedUsers.map((entry) => ({
      userKey: entry.userKey,
      userLabel: entry.userLabel || entry.userKey,
    }));
  }, [combinedUsers]);

  const paymentSummary = useMemo(() => {
    const summary = new Map();

    combinedUsers.forEach((entry) => {
      const userKey = entry.userKey;
      const effectiveComp = resolveEffectiveCompEntry({
        userKey,
        referenceTimestamp: Date.now(),
        savedSettingsMap: userCompSettings,
        draftSettingsMap: draftCompSettings,
        includeDraftPreview: true,
      });
      const billingType = normalizeValue(effectiveComp.billingType) === "salary" ? "salary" : "hourly";
      const userTotalOwed = rows
        .filter((row) => normalizeValue(row.userKey) === userKey)
        .reduce((sum, row) => {
          const totalHours = toHours(row.durationMs);
          if (billingType === "salary") {
            const monthlySalary = parseNumber(effectiveComp.monthlySalary);
            const expectedWeeklyHours = parseNumber(effectiveComp.expectedHours);
            const expectedMonthlyHours = expectedWeeklyHours > 0 ? expectedWeeklyHours * WEEKS_PER_MONTH : 0;
            const effectiveHourlyRate = expectedMonthlyHours > 0 ? monthlySalary / expectedMonthlyHours : 0;
            return sum + totalHours * effectiveHourlyRate;
          }
          return sum + totalHours * parseNumber(effectiveComp.hourlyRate);
        }, 0);

      const userPayments = payments
        .filter((payment) => payment.userKey === userKey)
        .reduce((sum, payment) => sum + payment.amount, 0);

      summary.set(userKey, {
        userKey,
        userLabel: entry.userLabel || userKey,
        totalOwed: userTotalOwed,
        totalPaid: userPayments,
        differenceOwed: userTotalOwed - userPayments,
      });
    });

    return summary;
  }, [combinedUsers, draftCompSettings, payments, resolveEffectiveCompEntry, rows, toHours, userCompSettings]);

  const filteredPaymentRows = useMemo(() => {
    return Array.from(paymentSummary.values()).filter((entry) => {
      if (selectedUser === "all") return true;
      return entry.userKey === selectedUser;
    });
  }, [paymentSummary, selectedUser]);

  const filteredPayments = useMemo(() => {
    return selectedUser === "all"
      ? payments
      : payments.filter((payment) => payment.userKey === selectedUser);
  }, [payments, selectedUser]);

  const employeePaymentTotals = useMemo(() => {
    const entries = selectedUser === "all"
      ? Array.from(paymentSummary.values())
      : Array.from(paymentSummary.values()).filter((entry) => entry.userKey === selectedUser);

    return entries.reduce((totals, entry) => ({
      totalOwed: totals.totalOwed + entry.totalOwed,
      totalPaid: totals.totalPaid + entry.totalPaid,
      differenceOwed: totals.differenceOwed + entry.differenceOwed,
    }), { totalOwed: 0, totalPaid: 0, differenceOwed: 0 });
  }, [paymentSummary, selectedUser]);

  const selectedPaymentBalance = paymentSummary.get(paymentUser);

  useEffect(() => {
    const savedMethod = paymentMethods[paymentMethodUser]?.[0];
    setPaymentMethodType(savedMethod?.methodType || "airtm");
    setPaymentMethodOther(savedMethod?.methodOther || "");
    setPaymentMethodDetails(savedMethod?.details || "");
    setPaymentMethodNote(savedMethod?.note || "");
  }, [paymentMethodUser, paymentMethods]);

  const handleAddPayment = async (event) => {
    event.preventDefault();
    if (!paymentUser || !paymentAmount || !paymentDate) return;

    const selectedEntry = combinedUsers.find((entry) => entry.userKey === paymentUser);
    if (!selectedEntry) return;

    setSavingPayment(true);
    try {
      await addDoc(collection(db, "churches", id, "payEveryonePayments"), {
        userKey: selectedEntry.userKey,
        userId: selectedEntry.userId || "",
        userEmail: selectedEntry.userEmail || "",
        userLabel: selectedEntry.userLabel || selectedEntry.userKey,
        amount: parseNumber(paymentAmount),
        paymentDate: paymentDate,
        note: paymentNote,
        createdAt: Date.now(),
      });
      setPaymentAmount("");
      setPaymentDate(new Date().toISOString().slice(0, 10));
      setPaymentNote("");
      setPaymentUser(selectedEntry.userKey);
    } catch (error) {
      console.error("Error adding payment:", error);
    } finally {
      setSavingPayment(false);
    }
  };

  const handleSavePaymentMethod = async (event) => {
    event.preventDefault();
    if (!paymentMethodUser || !paymentMethodType || !paymentMethodDetails.trim()) return;

    const selectedEntry = combinedUsers.find((entry) => entry.userKey === paymentMethodUser);
    if (!selectedEntry) return;

    setSavingPaymentMethod(true);
    try {
      const paymentMethodData = {
        userKey: selectedEntry.userKey,
        userId: selectedEntry.userId || "",
        userEmail: selectedEntry.userEmail || "",
        userLabel: selectedEntry.userLabel || selectedEntry.userKey,
        methodType: paymentMethodType,
        methodOther: paymentMethodType === "other" ? paymentMethodOther.trim() : "",
        details: paymentMethodDetails.trim(),
        note: paymentMethodNote.trim(),
        updatedAt: Date.now(),
      };
      if (editingPaymentMethodId) {
        await updateDoc(doc(db, "churches", id, "payEveryonePaymentMethods", editingPaymentMethodId), paymentMethodData);
      } else {
        await addDoc(collection(db, "churches", id, "payEveryonePaymentMethods"), paymentMethodData);
      }
      setEditingPaymentMethodId("");
    } catch (error) {
      console.error("Error saving payment method:", error);
    } finally {
      setSavingPaymentMethod(false);
    }
  };

  const startEditingPaymentMethod = (method) => {
    setEditingPaymentMethodId(method.id);
    setPaymentMethodType(method.methodType || "airtm");
    setPaymentMethodOther(method.methodOther || "");
    setPaymentMethodDetails(method.details || "");
    setPaymentMethodNote(method.note || "");
  };

  const cancelEditingPaymentMethod = () => {
    setEditingPaymentMethodId("");
    setPaymentMethodType("airtm");
    setPaymentMethodOther("");
    setPaymentMethodDetails("");
    setPaymentMethodNote("");
  };

  const handleDeletePaymentMethod = async (methodId) => {
    if (!window.confirm("Delete this payment method?")) return;

    try {
      await deleteDoc(doc(db, "churches", id, "payEveryonePaymentMethods", methodId));
      if (editingPaymentMethodId === methodId) cancelEditingPaymentMethod();
    } catch (error) {
      console.error("Error deleting payment method:", error);
    }
  };

  const startEditingPayment = (payment) => {
    setEditingPaymentId(payment.id);
    setEditingPaymentAmount(String(payment.amount));
    setEditingPaymentDate(payment.paymentDate || "");
    setEditingPaymentNote(payment.note || "");
  };

  const cancelEditingPayment = () => {
    setEditingPaymentId("");
    setEditingPaymentAmount("");
    setEditingPaymentDate("");
    setEditingPaymentNote("");
  };

  const handleSaveEditedPayment = async (paymentId) => {
    if (!editingPaymentAmount || !editingPaymentDate) return;

    setSavingEditedPayment(true);
    try {
      await updateDoc(doc(db, "churches", id, "payEveryonePayments", paymentId), {
        amount: parseNumber(editingPaymentAmount),
        paymentDate: editingPaymentDate,
        note: editingPaymentNote.trim(),
        updatedAt: Date.now(),
      });
      cancelEditingPayment();
    } catch (error) {
      console.error("Error updating payment:", error);
    } finally {
      setSavingEditedPayment(false);
    }
  };

  const handleDeletePayment = async (paymentId) => {
    if (!window.confirm("Delete this payment?")) return;

    try {
      await deleteDoc(doc(db, "churches", id, "payEveryonePayments", paymentId));
    } catch (error) {
      console.error("Error deleting payment:", error);
    }
  };

  return (
    <div className="pay-everyone-payments" style={{ marginTop: "12px" }}>
      <div className="payments-subtabs">
        {[
          ["add-payment", "Add Payment"],
          ["add-method", "Add Payment Method"],
          ["summary", "Payment Summary"],
          ["employee", "Per-Employee Payments"],
        ].map(([tabId, label]) => (
          <button
            key={tabId}
            type="button"
            onClick={() => navigate(`${location.pathname}?tab=payments&view=${tabId}`)}
            className={`payments-subtab ${paymentsSubTab === tabId ? "active" : ""}`}
          >
            {label}
          </button>
        ))}
      </div>

      {paymentsSubTab === "add-payment" && <div style={{ marginBottom: "12px", padding: "12px", backgroundColor: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap", marginBottom: "8px" }}>
          <div style={{ fontWeight: 700, color: "#0F172A" }}>Add Payment</div>
          <button
            type="button"
            onClick={() => navigate(`${location.pathname}?tab=payments&view=summary`)}
            style={{ border: "1px solid #CBD5E1", borderRadius: "6px", padding: "7px 10px", backgroundColor: "#FFFFFF", color: "#334155", fontWeight: 700, cursor: "pointer" }}
          >
            Edit Payments
          </button>
        </div>
        {selectedPaymentBalance && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "8px", marginBottom: "14px" }}>
            <div style={{ padding: "10px", border: "1px solid #E2E8F0", borderRadius: "8px", backgroundColor: "#FFFFFF" }}>
              <div style={{ color: "#64748B", fontSize: "0.78rem", fontWeight: 700 }}>Total Owed</div>
              <div style={{ color: "#0F172A", fontSize: "1.05rem", fontWeight: 800 }}>{toCurrency(selectedPaymentBalance.totalOwed)}</div>
            </div>
            <div style={{ padding: "10px", border: "1px solid #E2E8F0", borderRadius: "8px", backgroundColor: "#FFFFFF" }}>
              <div style={{ color: "#64748B", fontSize: "0.78rem", fontWeight: 700 }}>Total Paid</div>
              <div style={{ color: "#0F172A", fontSize: "1.05rem", fontWeight: 800 }}>{toCurrency(selectedPaymentBalance.totalPaid)}</div>
            </div>
            <div style={{ padding: "10px", border: "1px solid #E2E8F0", borderRadius: "8px", backgroundColor: "#FFFFFF" }}>
              <div style={{ color: "#64748B", fontSize: "0.78rem", fontWeight: 700 }}>Balance Remaining</div>
              <div style={{ color: selectedPaymentBalance.differenceOwed > 0 ? "#B45309" : "#065F46", fontSize: "1.05rem", fontWeight: 800 }}>{toCurrency(selectedPaymentBalance.differenceOwed)}</div>
            </div>
          </div>
        )}
        <form onSubmit={handleAddPayment}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px" }}>
            <div>
              <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
                User
              </label>
              <select
                value={paymentUser}
                onChange={(event) => setPaymentUser(event.target.value)}
                style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
              >
                <option value="">Select a user</option>
                {paymentUserOptions.map((option) => (
                  <option key={option.userKey} value={option.userKey}>
                    {option.userLabel}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
                Amount
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={paymentAmount}
                onChange={(event) => setPaymentAmount(event.target.value)}
                style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
                placeholder="0.00"
              />
            </div>
            <div>
              <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
                Payment Date
              </label>
              <input
                type="date"
                value={paymentDate}
                onChange={(event) => setPaymentDate(event.target.value)}
                style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
              />
            </div>
          </div>
          <div style={{ marginTop: "10px" }}>
            <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
              Note
            </label>
            <textarea
              value={paymentNote}
              onChange={(event) => setPaymentNote(event.target.value)}
              rows={3}
              style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px", resize: "vertical" }}
              placeholder="Optional payment note"
            />
          </div>
          <div style={{ marginTop: "10px" }}>
            <button
              type="submit"
              disabled={savingPayment}
              style={{ padding: "9px 14px", borderRadius: "8px", border: "none", backgroundColor: "#0F766E", color: "#FFFFFF", fontWeight: 700, cursor: savingPayment ? "not-allowed" : "pointer" }}
            >
              {savingPayment ? "Saving..." : "Save Payment"}
            </button>
          </div>
        </form>
      </div>}

      {paymentsSubTab === "add-method" && <div className="payment-method-layout">
        <div className="payment-method-panel">
          <div className="payment-method-heading">{editingPaymentMethodId ? "Edit Payment Method" : "Payment Method per User"}</div>
          <p className="payment-method-description">{editingPaymentMethodId ? "Update this saved method, or cancel to keep it unchanged." : "Choose a user and save the account information used to pay them."}</p>
          <form onSubmit={handleSavePaymentMethod}>
          <div className="payment-method-grid">
            <div className="payment-method-field">
              <label>
                User
              </label>
              <select
                value={paymentMethodUser}
                onChange={(event) => setPaymentMethodUser(event.target.value)}
              >
                <option value="">Select a user</option>
                {paymentUserOptions.map((option) => (
                  <option key={option.userKey} value={option.userKey}>
                    {option.userLabel}
                  </option>
                ))}
              </select>
            </div>
            <div className="payment-method-field">
              <label>
                Method
              </label>
              <select
                value={paymentMethodType}
                onChange={(event) => setPaymentMethodType(event.target.value)}
              >
                <option value="airtm">Airtm</option>
                <option value="zelle">Zelle</option>
                <option value="bank-transfer">Bank Transfer</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </select>
            </div>
            {paymentMethodType === "other" && (
              <div className="payment-method-field">
                <label>
                  Other Method
                </label>
                <input
                  value={paymentMethodOther}
                  onChange={(event) => setPaymentMethodOther(event.target.value)}
                  placeholder="Method name"
                />
              </div>
            )}
          </div>
          <div className="payment-method-field full-width">
            <label>
              Account Details
            </label>
            <input
              value={paymentMethodDetails}
              onChange={(event) => setPaymentMethodDetails(event.target.value)}
              placeholder="Email, phone number, username, or account details"
              required
            />
          </div>
          <div className="payment-method-field full-width">
            <label>
              Note
            </label>
            <input
              value={paymentMethodNote}
              onChange={(event) => setPaymentMethodNote(event.target.value)}
              placeholder="Optional payment method note"
            />
          </div>
          <div className="payment-method-actions">
            <button
              type="submit"
              disabled={savingPaymentMethod || !paymentMethodUser}
              className="payment-method-primary"
            >
              {savingPaymentMethod ? "Saving..." : editingPaymentMethodId ? "Update Payment Method" : "Save Payment Method"}
            </button>
            {editingPaymentMethodId && (
              <button
                type="button"
                onClick={cancelEditingPaymentMethod}
                className="payment-method-secondary"
              >
                Cancel Edit
              </button>
            )}
          </div>
        </form>
        </div>
        {paymentMethodUser && (
          <div className="payment-method-list">
            <div className="payment-method-list-heading">
              <strong>Saved Methods</strong>
              <span className="payment-method-count">{(paymentMethods[paymentMethodUser] || []).length} saved</span>
            </div>
            {(paymentMethods[paymentMethodUser] || []).length === 0 ? (
              <div className="payment-method-empty">No payment methods saved for this user.</div>
            ) : (
              <div>
                {paymentMethods[paymentMethodUser].map((method) => (
                  <div key={method.id} className="payment-method-card">
                    <div className="payment-method-card-header">
                      <span className="payment-method-badge">
                      {method.methodType === "other" ? method.methodOther || "Other" : method.methodType}
                      </span>
                    </div>
                    {isHttpUrl(method.details) ? (
                      <a
                        href={method.details}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="payment-method-link"
                      >
                        Open Payment Link
                      </a>
                    ) : (
                      <div className="payment-method-details">{method.details}</div>
                    )}
                    {method.note && <div className="payment-method-note">{method.note}</div>}
                    <div className="payment-method-card-actions">
                      <button type="button" onClick={() => startEditingPaymentMethod(method)} className="payment-method-edit">
                        Edit
                      </button>
                      <button type="button" onClick={() => handleDeletePaymentMethod(method.id)} className="payment-method-delete">
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>}

      {paymentsSubTab === "summary" && <div style={{ marginLeft: "-16px", marginRight: "-16px", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
          <thead>
            <tr style={{ backgroundColor: "#F8FAFC" }}>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0" }}>Entry ID</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0" }}>Person</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0" }}>Total Owed</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0" }}>Total Paid</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0" }}>Difference Owed</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0" }}>Last Payment</th>
            </tr>
          </thead>
          <tbody>
            {filteredPaymentRows.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: "14px", color: "#64748B" }}>
                  No payment information found.
                </td>
              </tr>
            ) : (
              filteredPaymentRows.map((entry) => {
                const paymentHistory = payments.filter((payment) => payment.userKey === entry.userKey);
                const latestPayment = paymentHistory[0];
                return (
                  <tr key={entry.userKey}>
                    <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#666666", fontSize: "0.78rem", fontFamily: "monospace" }}>
                      {latestPayment?.id || "-"}
                    </td>
                    <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#0F172A", fontWeight: 700 }}>
                      {entry.userLabel}
                    </td>
                    <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>
                      {toCurrency(entry.totalOwed)}
                    </td>
                    <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>
                      {toCurrency(entry.totalPaid)}
                    </td>
                    <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: entry.differenceOwed > 0 ? "#B45309" : "#065F46", fontWeight: 700 }}>
                      {toCurrency(entry.differenceOwed)}
                    </td>
                    <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>
                      {latestPayment ? `${formatPaymentDate(latestPayment.paymentDate, latestPayment.paymentDateMs)}${latestPayment.note ? ` • ${latestPayment.note}` : ""}` : "No payments yet"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>}

      {paymentsSubTab === "employee" && <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px", marginBottom: "12px" }}>
          <div>
            <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
              Filter by User
            </label>
            <select
              value={selectedUser}
              onChange={(event) => setSelectedUser(event.target.value)}
              style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
            >
              {userOptions.map((option) => (
                <option key={option.userKey} value={option.userKey}>
                  {option.userLabel}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px", marginBottom: "12px" }}>
          <div style={{ padding: "12px", backgroundColor: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "8px" }}>
            <div style={{ color: "#64748B", fontSize: "0.82rem", fontWeight: 700 }}>Subtotal Owed</div>
            <div style={{ color: "#0F172A", fontSize: "1.1rem", fontWeight: 700 }}>{toCurrency(employeePaymentTotals.totalOwed)}</div>
          </div>
          <div style={{ padding: "12px", backgroundColor: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "8px" }}>
            <div style={{ color: "#64748B", fontSize: "0.82rem", fontWeight: 700 }}>Subtotal Paid</div>
            <div style={{ color: "#0F172A", fontSize: "1.1rem", fontWeight: 700 }}>{toCurrency(employeePaymentTotals.totalPaid)}</div>
          </div>
          <div style={{ padding: "12px", backgroundColor: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "8px" }}>
            <div style={{ color: "#64748B", fontSize: "0.82rem", fontWeight: 700 }}>Difference Owed</div>
            <div style={{ color: employeePaymentTotals.differenceOwed > 0 ? "#B45309" : "#065F46", fontSize: "1.1rem", fontWeight: 700 }}>{toCurrency(employeePaymentTotals.differenceOwed)}</div>
          </div>
        </div>
      <div style={{ marginTop: "16px", marginLeft: "-16px", marginRight: "-16px", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0" }}>
        <div style={{ padding: "12px 14px", backgroundColor: "#F8FAFC", borderBottom: "1px solid #E2E8F0", fontWeight: 700, color: "#0F172A" }}>
          Payment History ({filteredPayments.length})
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
          <thead>
            <tr style={{ backgroundColor: "#F8FAFC" }}>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0" }}>Payment ID</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0" }}>Person</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0" }}>Amount</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0" }}>Payment Date</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0" }}>Note</th>
              <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #E2E8F0" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredPayments.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: "14px", color: "#64748B" }}>
                  No payments found for the selected filter.
                </td>
              </tr>
            ) : (
              filteredPayments.map((payment) => (
                <tr key={payment.id}>
                  <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#666666", fontSize: "0.78rem", fontFamily: "monospace" }}>
                    {payment.id}
                  </td>
                  <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#0F172A", fontWeight: 700 }}>
                    {payment.userLabel || payment.userKey}
                  </td>
                  <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>
                    {editingPaymentId === payment.id ? (
                      <input type="number" min="0" step="0.01" value={editingPaymentAmount} onChange={(event) => setEditingPaymentAmount(event.target.value)} style={{ width: "110px", padding: "6px", border: "1px solid #CBD5E1", borderRadius: "6px" }} />
                    ) : toCurrency(payment.amount)}
                  </td>
                  <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>
                    {editingPaymentId === payment.id ? (
                      <input type="date" value={editingPaymentDate} onChange={(event) => setEditingPaymentDate(event.target.value)} style={{ padding: "6px", border: "1px solid #CBD5E1", borderRadius: "6px" }} />
                    ) : formatPaymentDate(payment.paymentDate, payment.paymentDateMs)}
                  </td>
                  <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>
                    {editingPaymentId === payment.id ? (
                      <input value={editingPaymentNote} onChange={(event) => setEditingPaymentNote(event.target.value)} style={{ width: "100%", minWidth: "140px", padding: "6px", border: "1px solid #CBD5E1", borderRadius: "6px" }} />
                    ) : payment.note || "-"}
                  </td>
                  <td style={{ padding: "11px 14px", borderBottom: "1px solid #F1F5F9", whiteSpace: "nowrap" }}>
                    {editingPaymentId === payment.id ? (
                      <>
                        <button type="button" onClick={() => handleSaveEditedPayment(payment.id)} disabled={savingEditedPayment} style={{ marginRight: "6px", padding: "6px 9px", border: "none", borderRadius: "6px", backgroundColor: "#0F766E", color: "#FFFFFF", fontWeight: 700 }}>
                          {savingEditedPayment ? "Saving..." : "Save"}
                        </button>
                        <button type="button" onClick={cancelEditingPayment} style={{ padding: "6px 9px", border: "1px solid #CBD5E1", borderRadius: "6px", backgroundColor: "#FFFFFF", color: "#334155", fontWeight: 700 }}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" onClick={() => startEditingPayment(payment)} style={{ marginRight: "6px", padding: "6px 9px", border: "1px solid #CBD5E1", borderRadius: "6px", backgroundColor: "#FFFFFF", color: "#334155", fontWeight: 700 }}>
                          Edit
                        </button>
                        <button type="button" onClick={() => handleDeletePayment(payment.id)} style={{ padding: "6px 9px", border: "none", borderRadius: "6px", backgroundColor: "#B91C1C", color: "#FFFFFF", fontWeight: 700 }}>
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      </>}
    </div>
  );
};

const EditableTimeEntriesTab = ({
  id,
  rows,
  userOptions,
  formatDateOnly,
  formatDuration,
  formatTimestamp,
}) => {
  const savedFilters = readEditTimeFilters(id) || {};
  const [filterUser, setFilterUser] = useState("all");
  const [dateFilterPreset, setDateFilterPreset] = useState("all");
  const [customDateStart, setCustomDateStart] = useState("");
  const [customDateEnd, setCustomDateEnd] = useState("");
  const [hoursOffFilter, setHoursOffFilter] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);
  const [editingValues, setEditingValues] = useState({});
  const [savingRowId, setSavingRowId] = useState("");
  const [lastSavedRowId, setLastSavedRowId] = useState("");
  const [creatingNewTimeRowId, setCreatingNewTimeRowId] = useState("");
  const [deletingRowId, setDeletingRowId] = useState("");
  const [historyModalRowId, setHistoryModalRowId] = useState("");
  const [notesModalRowId, setNotesModalRowId] = useState("");
  const [pendingNewTimeRowId, setPendingNewTimeRowId] = useState("");
  const [activeRowId, setActiveRowId] = useState("");
  const [rowConfigOpenId, setRowConfigOpenId] = useState("");
  const [hasHydratedFilters, setHasHydratedFilters] = useState(false);
  const [cardOptions, setCardOptions] = useState([]);
  const [cardOptionsLoading, setCardOptionsLoading] = useState(false);
  const stableRowSortRef = useRef({});
  const { user } = useAuth();

  useEffect(() => {
    if (!id) return undefined;

    let isCancelled = false;

    const loadCardOptions = async () => {
      setCardOptionsLoading(true);
      try {
        const projectsSnap = await getDocs(collection(db, "churches", id, "bimProjects"));
        const nextOptions = [];

        for (const projectDoc of projectsSnap.docs) {
          const projectData = projectDoc.data() || {};
          const fields = Array.isArray(projectData.fields) ? projectData.fields : [];
          const issuesSnap = await getDocs(collection(db, "churches", id, "bimProjects", projectDoc.id, "issues"));

          issuesSnap.docs.forEach((issueDoc, rowIndex) => {
            const rowData = issueDoc.data() || {};
            const issueIdField = findFieldByAliases(fields, rowData, ISSUE_ID_ALIASES);
            const titleField = findFieldByAliases(fields, rowData, TITLE_ALIASES);
            const projectNameField = findFieldByAliases(fields, rowData, PROJECT_NAME_ALIASES);

            const issueId = normalizeValue(issueIdField ? rowData[issueIdField] : "") || String(rowIndex + 1);
            const projectName = normalizeValue(projectNameField ? rowData[projectNameField] : "")
              || normalizeValue(projectData.projectName || projectData.name);

            nextOptions.push({
              key: `${projectDoc.id}-${issueDoc.id}`,
              issueId,
              projectDocId: projectDoc.id,
              projectName,
              issueLabel: normalizeValue(titleField ? rowData[titleField] : ""),
            });
          });
        }

        // A card id can repeat across projects, so keep issue id + project name unique together.
        const uniqueOptions = [];
        const seenKeys = new Set();
        nextOptions.forEach((option) => {
          const uniqueKey = `${normalizeComparable(option.issueId)}||${normalizeComparable(option.projectName)}`;
          if (seenKeys.has(uniqueKey)) return;
          seenKeys.add(uniqueKey);
          uniqueOptions.push({ ...option, value: uniqueKey });
        });

        uniqueOptions.sort((left, right) => (
          String(left.issueId).localeCompare(String(right.issueId), undefined, { numeric: true })
          || String(left.projectName).localeCompare(String(right.projectName))
        ));

        if (!isCancelled) {
          setCardOptions(uniqueOptions);
        }
      } catch (error) {
        console.error("Error loading card options:", error);
        if (!isCancelled) setCardOptions([]);
      } finally {
        if (!isCancelled) setCardOptionsLoading(false);
      }
    };

    loadCardOptions();

    return () => {
      isCancelled = true;
    };
  }, [id]);

  // TD cards blocked in the TD Matcher (Invoices) can't have new time charged to them here.
  const [taskBlockedByIdentity, setTaskBlockedByIdentity] = useState({});
  const [taskBlockedByIssueId, setTaskBlockedByIssueId] = useState({});
  const [taskBlockedByDigits, setTaskBlockedByDigits] = useState({});

  useEffect(() => {
    if (!id) {
      setTaskBlockedByIdentity({});
      setTaskBlockedByIssueId({});
      setTaskBlockedByDigits({});
      return undefined;
    }

    const unsubscribe = onSnapshot(collection(db, "churches", id, "timeRotateTaskDetails"), (snapshot) => {
      const nextBlockedMap = {};
      const nextBlockedByIssueIdMap = {};
      const nextBlockedByDigitsMap = {};
      snapshot.forEach((snapshotDoc) => {
        const data = snapshotDoc.data() || {};
        const taskIdentity = normalizeValue(data.taskIdentity);
        if (!taskIdentity) return;
        const isBlocked = data.timeEntryBlocked === true;
        nextBlockedMap[taskIdentity] = isBlocked;
        // A TD can produce slightly different task identities over time, so also index blocked
        // status by the bare TD/issue id as a fallback match.
        const issueIdSuffix = String(taskIdentity.split("::").pop() || "").trim().toLowerCase();
        if (issueIdSuffix && (isBlocked || !Object.prototype.hasOwnProperty.call(nextBlockedByIssueIdMap, issueIdSuffix))) {
          nextBlockedByIssueIdMap[issueIdSuffix] = isBlocked;
        }
        // The TD number can gain/lose a prefix like "TD-" between historical logs and the
        // current sheet, so also fall back to matching by digits only.
        const issueIdDigits = issueIdSuffix.replace(/[^0-9]/g, "");
        if (issueIdDigits && (isBlocked || !Object.prototype.hasOwnProperty.call(nextBlockedByDigitsMap, issueIdDigits))) {
          nextBlockedByDigitsMap[issueIdDigits] = isBlocked;
        }
      });
      setTaskBlockedByIdentity(nextBlockedMap);
      setTaskBlockedByIssueId(nextBlockedByIssueIdMap);
      setTaskBlockedByDigits(nextBlockedByDigitsMap);
    }, (error) => {
      console.error("Error loading TD blocked status:", error);
      setTaskBlockedByIdentity({});
      setTaskBlockedByIssueId({});
      setTaskBlockedByDigits({});
    });

    return () => unsubscribe();
  }, [id]);

  const buildCardValue = (issueId, projectName) => `${normalizeComparable(issueId)}||${normalizeComparable(projectName)}`;

  const cardOptionByValue = useMemo(() => {
    return cardOptions.reduce((accumulator, option) => {
      accumulator[option.value] = option;
      return accumulator;
    }, {});
  }, [cardOptions]);

  const projectNameOptions = useMemo(() => {
    const uniqueProjectNames = new Map();
    cardOptions.forEach((option) => {
      const projectName = normalizeValue(option.projectName);
      if (!projectName) return;
      const projectKey = normalizeComparable(projectName);
      if (!uniqueProjectNames.has(projectKey)) {
        uniqueProjectNames.set(projectKey, projectName);
      }
    });
    return Array.from(uniqueProjectNames.values()).sort((left, right) => left.localeCompare(right));
  }, [cardOptions]);

  const toDateTimeInputValue = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
  };

  const getRowDurationMs = (row) => {
    const startMs = Number(row.startedAt) || 0;
    const endMs = Number(row.endedAt) || 0;
    return Math.max(0, endMs - startMs);
  };

  const formatHistoryTimestamp = (value) => {
    const numericValue = toTimestampMs(value);
    return numericValue > 0 ? formatTimestamp(numericValue) : "-";
  };

  const historyModalRow = useMemo(() => {
    if (!historyModalRowId) return null;
    return rows.find((entry) => entry.id === historyModalRowId) || null;
  }, [historyModalRowId, rows]);

  const notesModalRow = useMemo(() => {
    if (!notesModalRowId) return null;
    return rows.find((entry) => entry.id === notesModalRowId) || null;
  }, [notesModalRowId, rows]);

  const rowsById = useMemo(() => {
    return rows.reduce((accumulator, row) => {
      accumulator[row.id] = row;
      return accumulator;
    }, {});
  }, [rows]);

  const hasAnyPendingEdits = useMemo(() => {
    return Object.entries(editingValues).some(([rowId, entry]) => {
      const startValue = normalizeValue(entry?.startedAt);
      const endValue = normalizeValue(entry?.endedAt);
      const cardValue = normalizeValue(entry?.cardValue);
      const hasProjectDraft = entry?.projectName !== undefined;
      if (!startValue && !endValue && !cardValue && !hasProjectDraft) return false;

      const sourceRow = rowsById[rowId];
      if (!sourceRow) return true;

      if (cardValue && cardValue !== buildCardValue(sourceRow.issueId, sourceRow.projectName)) {
        return true;
      }

      if (hasProjectDraft && normalizeComparable(entry.projectName) !== normalizeComparable(sourceRow.projectName)) {
        return true;
      }

      // Compare against what the user actually sees in datetime-local inputs
      // (second precision) to avoid false "unsaved" states from millisecond values.
      const sourceStartInput = toDateTimeInputValue(sourceRow.startedAt);
      const sourceEndInput = toDateTimeInputValue(sourceRow.endedAt);

      if (startValue) {
        const startMs = new Date(startValue).getTime();
        if (!Number.isFinite(startMs) || startValue !== sourceStartInput) {
          return true;
        }
      }

      if (endValue) {
        const endMs = new Date(endValue).getTime();
        if (!Number.isFinite(endMs) || endValue !== sourceEndInput) {
          return true;
        }
      }

      return false;
    });
  }, [editingValues, rowsById]);

  const activeRowHasPendingChanges = useMemo(() => {
    if (!activeRowId) return false;
    const rowEdits = editingValues[activeRowId] || {};
    const sourceRow = rowsById[activeRowId];
    if (!sourceRow) return false;

    const startValue = normalizeValue(rowEdits.startedAt);
    const endValue = normalizeValue(rowEdits.endedAt);
    const cardValue = normalizeValue(rowEdits.cardValue);
    const hasProjectDraft = rowEdits.projectName !== undefined;
    if (!startValue && !endValue && !cardValue && !hasProjectDraft) return false;

    const sourceStartInput = toDateTimeInputValue(sourceRow.startedAt);
    const sourceEndInput = toDateTimeInputValue(sourceRow.endedAt);
    return (
      (startValue && startValue !== sourceStartInput)
      || (endValue && endValue !== sourceEndInput)
      || (cardValue && cardValue !== buildCardValue(sourceRow.issueId, sourceRow.projectName))
      || (hasProjectDraft && normalizeComparable(rowEdits.projectName) !== normalizeComparable(sourceRow.projectName))
    );
  }, [activeRowId, editingValues, rowsById]);

  const isActiveRowLocked = Boolean(
    activeRowId
    && (
      activeRowHasPendingChanges
      || pendingNewTimeRowId === activeRowId
      || savingRowId === activeRowId
    )
  );

  useEffect(() => {
    if (!pendingNewTimeRowId) return;
    if (!rowsById[pendingNewTimeRowId]) return;
    setActiveRowId(pendingNewTimeRowId);
  }, [pendingNewTimeRowId, rowsById]);

  useEffect(() => {
    const nextStableSort = { ...stableRowSortRef.current };

    rows.forEach((row) => {
      if (!Object.prototype.hasOwnProperty.call(nextStableSort, row.id)) {
        nextStableSort[row.id] = Number(row.startedAt) || 0;
      }
    });

    // Prune removed rows to prevent unbounded growth.
    Object.keys(nextStableSort).forEach((rowId) => {
      if (!rows.some((row) => row.id === rowId)) {
        delete nextStableSort[rowId];
      }
    });

    stableRowSortRef.current = nextStableSort;
  }, [rows]);

  useEffect(() => {
    const nextFilterUser = normalizeValue(savedFilters.filterUser) || "all";
    const nextDateFilterPreset = normalizeValue(savedFilters.dateFilterPreset) || "all";
    const nextCustomDateStart = normalizeValue(savedFilters.customDateStart);
    const nextCustomDateEnd = normalizeValue(savedFilters.customDateEnd);
    const nextHoursOffFilter = normalizeValue(savedFilters.hoursOffFilter) || "all";
    const nextSearchInput = normalizeValue(savedFilters.searchInput);
    const nextRowsPerPage = Number(savedFilters.rowsPerPage) || 25;
    const nextCurrentPage = Number(savedFilters.currentPage) || 1;

    setFilterUser(nextFilterUser);
    setDateFilterPreset(nextDateFilterPreset);
    setCustomDateStart(nextCustomDateStart);
    setCustomDateEnd(nextCustomDateEnd);
    setHoursOffFilter(nextHoursOffFilter);
    setSearchInput(nextSearchInput);
    setRowsPerPage(nextRowsPerPage);
    setCurrentPage(Math.max(1, nextCurrentPage));
    setHasHydratedFilters(true);
  }, [id]);

  useEffect(() => {
    if (!hasHydratedFilters) return;

    writeEditTimeFilters(id, {
      filterUser,
      dateFilterPreset,
      customDateStart,
      customDateEnd,
      hoursOffFilter,
      searchInput,
      rowsPerPage,
      currentPage,
    });
  }, [
    currentPage,
    customDateEnd,
    customDateStart,
    dateFilterPreset,
    filterUser,
    hasHydratedFilters,
    hoursOffFilter,
    id,
    rowsPerPage,
    searchInput,
  ]);

  const visibleRows = useMemo(() => {
    const normalizedSearch = normalizeComparable(searchInput);
    const getRangeMs = () => {
      if (dateFilterPreset === "custom") {
        const startMs = customDateStart ? new Date(customDateStart + "T00:00:00").getTime() : Number.NaN;
        const endMs = customDateEnd ? new Date(customDateEnd + "T23:59:59").getTime() : Number.NaN;
        return { startMs, endMs };
      }
      return getRangeForPreset(dateFilterPreset);
    };
    const { startMs, endMs } = getRangeMs();

    const filteredRows = rows.filter((row) => {
      // Always show the row that was just saved, bypass all filters
      if (row.id === lastSavedRowId) {
        return true;
      }

      // Always show newly-created row awaiting save confirmation.
      if (row.id === pendingNewTimeRowId) {
        return true;
      }

      const referenceTimestamp = Number(row.startedAt) || 0;
      const isDateFilterActive = Number.isFinite(startMs) && Number.isFinite(endMs);
      const matchesDate =
        !isDateFilterActive ||
        (referenceTimestamp >= startMs && referenceTimestamp <= endMs);
      if (!matchesDate) return false;

      const matchesUser = filterUser === "all" || normalizeValue(row.userKey) === filterUser;
      if (!matchesUser) return false;

      const rowDurationMs = getRowDurationMs(row);
      const isOffHoursEntry = rowDurationMs > OFF_HOURS_THRESHOLD_MS;
      const matchesOffHours =
        hoursOffFilter === "all"
          ? true
          : hoursOffFilter === "off"
            ? isOffHoursEntry
            : !isOffHoursEntry;
      if (!matchesOffHours) return false;

      if (!normalizedSearch) return true;

      const searchHaystack = [
        row.issueId,
        row.projectName,
        row.userLabel,
        formatDateOnly(row.startedAt),
        formatTimestamp(row.startedAt),
        formatTimestamp(row.endedAt),
      ]
        .map((value) => normalizeComparable(value))
        .join(" ");
      return searchHaystack.includes(normalizedSearch);
    });

    return filteredRows
      .slice()
      .sort((left, right) => {
        const leftSortValue = stableRowSortRef.current[left.id] ?? (Number(left.startedAt) || 0);
        const rightSortValue = stableRowSortRef.current[right.id] ?? (Number(right.startedAt) || 0);
        if (leftSortValue !== rightSortValue) {
          return rightSortValue - leftSortValue;
        }
        return String(right.id).localeCompare(String(left.id));
      });
  }, [customDateStart, customDateEnd, dateFilterPreset, filterUser, formatDateOnly, formatTimestamp, hoursOffFilter, lastSavedRowId, pendingNewTimeRowId, rows, searchInput]);

  useEffect(() => {
    setCurrentPage(1);
  }, [customDateStart, customDateEnd, dateFilterPreset, filterUser, hoursOffFilter, searchInput, rowsPerPage]);

  const totalRows = visibleRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / rowsPerPage));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * rowsPerPage;
  const endIndex = Math.min(startIndex + rowsPerPage, totalRows);

  const paginatedRows = useMemo(() => {
    return visibleRows.slice(startIndex, startIndex + rowsPerPage);
  }, [visibleRows, startIndex, rowsPerPage]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  // Clear lastSavedRowId when user changes any filters
  useEffect(() => {
    setLastSavedRowId("");
  }, [customDateStart, customDateEnd, dateFilterPreset, filterUser, hoursOffFilter, searchInput, rowsPerPage]);

  // Clear custom dates when user switches away from custom mode
  useEffect(() => {
    if (dateFilterPreset !== "custom") {
      setCustomDateStart("");
      setCustomDateEnd("");
    }
  }, [dateFilterPreset]);

  useEffect(() => {
    if (!activeRowId) return;
    const stillVisible = visibleRows.some((row) => row.id === activeRowId);
    if (!stillVisible) {
      setActiveRowId("");
      setRowConfigOpenId("");
    }
  }, [activeRowId, visibleRows]);

  const handleValueChange = (rowId, field, value) => {
    setEditingValues((prev) => ({
      ...prev,
      [rowId]: {
        ...(prev[rowId] || {}),
        [field]: value,
      },
    }));
  };

  const handleSave = async (row) => {
    const rowEdits = editingValues[row.id] || {};
    const hasEditedStart = normalizeValue(rowEdits.startedAt).length > 0;
    const hasEditedEnd = normalizeValue(rowEdits.endedAt).length > 0;

    // Keep original millisecond timestamps when the field was not edited,
    // so Save does not shift times due to minute-level input formatting.
    const startMs = hasEditedStart
      ? new Date(rowEdits.startedAt).getTime()
      : (Number(row.startedAt) || 0);
    const endMs = hasEditedEnd
      ? new Date(rowEdits.endedAt).getTime()
      : (Number(row.endedAt) || 0);

    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      console.warn("Invalid time values:", { startMs, endMs, rowEdits });
      return;
    }

    const hasProjectDraft = rowEdits.projectName !== undefined;
    const hasProjectChanged = hasProjectDraft
      && normalizeComparable(rowEdits.projectName) !== normalizeComparable(row.projectName);
    if (hasProjectChanged && !cardOptionByValue[normalizeValue(rowEdits.cardValue)]) {
      console.warn("A card must be selected for the new project before saving.");
      return;
    }

    const selectedCardForBlockCheck = normalizeValue(rowEdits.cardValue)
      ? cardOptionByValue[normalizeValue(rowEdits.cardValue)]
      : null;
    if (selectedCardForBlockCheck) {
      const candidateTaskIdentity = `${selectedCardForBlockCheck.projectDocId || "unknown-project"}::${normalizeValue(selectedCardForBlockCheck.issueId)}`;
      const candidateIssueIdKey = normalizeComparable(selectedCardForBlockCheck.issueId);
      const candidateIssueIdDigits = candidateIssueIdKey.replace(/[^0-9]/g, "");
      const isCandidateBlocked = Boolean(
        taskBlockedByIdentity[candidateTaskIdentity]
        || (candidateIssueIdKey && taskBlockedByIssueId[candidateIssueIdKey])
        || (candidateIssueIdDigits && taskBlockedByDigits[candidateIssueIdDigits])
      );
      if (isCandidateBlocked) {
        window.alert("This TD card is blocked from time entry. Ask a supervisor to unblock it in the TD Matcher.");
        return;
      }
    }

    setSavingRowId(row.id);
    setLastSavedRowId(row.id);
    try {
      const durationMs = Math.max(0, endMs - startMs);
      const previousStartedAt = Number(row.startedAt) || 0;
      const previousEndedAt = Number(row.endedAt) || 0;
      const previousDurationMs = getRowDurationMs(row);
      const hasTimeChanged = startMs !== previousStartedAt || endMs !== previousEndedAt;

      const selectedCardValue = normalizeValue(rowEdits.cardValue);
      const selectedCard = selectedCardValue ? cardOptionByValue[selectedCardValue] : null;
      const previousIssueId = normalizeValue(row.issueId);
      const previousProjectName = normalizeValue(row.projectName);
      const hasCardChanged = Boolean(
        selectedCard
        && (
          normalizeValue(selectedCard.issueId) !== previousIssueId
          || normalizeValue(selectedCard.projectName) !== previousProjectName
        )
      );

      const existingHistory = Array.isArray(row.timeEditHistory) ? row.timeEditHistory : [];
      const changedByUserLabel = normalizeValue(user?.displayName || user?.email || user?.uid || "Unknown user");
      const newHistoryEntry = {
        changedAt: Date.now(),
        changedByUserId: normalizeValue(user?.uid),
        changedByUserEmail: normalizeValue(user?.email),
        changedByUserLabel,
        previousStartedAt,
        previousEndedAt,
        previousDurationMs,
        newStartedAt: startMs,
        newEndedAt: endMs,
        newDurationMs: durationMs,
        previousIssueId,
        previousProjectName,
        newIssueId: hasCardChanged ? normalizeValue(selectedCard.issueId) : previousIssueId,
        newProjectName: hasCardChanged ? normalizeValue(selectedCard.projectName) : previousProjectName,
      };
      console.log("Saving row:", { id: row.id, startMs, endMs, durationMs });

      const updatePayload = {
        startedAt: startMs,
        endedAt: endMs,
        durationMs: durationMs,
        requiresSaveConfirmation: false,
        timeEditHistory: hasTimeChanged || hasCardChanged ? [...existingHistory, newHistoryEntry] : existingHistory,
      };

      if (hasCardChanged) {
        // Project always follows the selected card so both stay in sync.
        updatePayload.issueId = normalizeValue(selectedCard.issueId);
        updatePayload.projectName = normalizeValue(selectedCard.projectName);
        updatePayload.issueLabel = normalizeValue(selectedCard.issueLabel);
        updatePayload.issueTitle = normalizeValue(selectedCard.issueLabel);
      }

      await updateDoc(doc(db, "churches", id, "timeRotateLogs", row.id), updatePayload);
      
      console.log("Save successful for row:", row.id);
      
      // Clear editing values for this row after successful save
      setEditingValues((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      if (row.id === pendingNewTimeRowId) {
        setPendingNewTimeRowId("");
      }
      // Reset hour filter to show all entries including the one just edited
      setHoursOffFilter("all");
    } catch (error) {
      console.error("Error updating time log:", error);
    } finally {
      setSavingRowId("");
    }
  };

  const handleNewTime = async (row) => {
    if (hasAnyPendingEdits || Boolean(pendingNewTimeRowId) || Boolean(savingRowId)) {
      return;
    }

    setCreatingNewTimeRowId(row.id);
    try {
      const sourceDocRef = doc(db, "churches", id, "timeRotateLogs", row.id);
      const sourceDocSnap = await getDoc(sourceDocRef);
      const sourceData = sourceDocSnap.exists() ? (sourceDocSnap.data() || {}) : {};

      // Create sequential entries even when users click New Time multiple times quickly.
      const sourceStartMs = toTimestampMs(sourceData.startedAt) || (Number(row.startedAt) || 0);
      const sourceEndMs = toTimestampMs(sourceData.endedAt) || (Number(row.endedAt) || 0);
      const sourceDurationMs = Math.max(0, sourceEndMs - sourceStartMs);
      const safeDurationMs = sourceDurationMs > 0 ? sourceDurationMs : (60 * 60 * 1000);

      // Deterministic behavior: always create the next entry from the selected row's
      // saved end time with the same duration (no auto-shifting).
      const newStartMs = sourceEndMs;
      const newEndMs = newStartMs + safeDurationMs;

      const newTimeEntry = {
        issueId: normalizeValue(sourceData.issueId) || row.issueId || "",
        issueLabel: normalizeValue(sourceData.issueLabel || sourceData.issueTitle || sourceData.issueName || sourceData.issueSummary) || row.issueLabel || "",
        issueTitle: normalizeValue(sourceData.issueLabel || sourceData.issueTitle || sourceData.issueName || sourceData.issueSummary) || row.issueLabel || "",
        projectName: normalizeValue(sourceData.projectName) || row.projectName || "",
        userId: normalizeValue(sourceData.userId) || row.userId || "",
        userEmail: normalizeValue(sourceData.userEmail) || row.userEmail || "",
        registeredBy: resolveUserLabel(sourceData) || row.userLabel || row.userEmail || "",
        startedAt: newStartMs,
        endedAt: newEndMs,
        durationMs: newEndMs - newStartMs,
        requiresSaveConfirmation: true,
        logType: normalizeValue(sourceData.logType) || row.logType || "timer",
        timeEditHistory: [],
      };

      console.log("Creating new time entry:", newTimeEntry);
      const createdDocRef = await addDoc(collection(db, "churches", id, "timeRotateLogs"), newTimeEntry);
      setPendingNewTimeRowId(createdDocRef.id);
      console.log("New time entry created successfully");
    } catch (error) {
      console.error("Error creating new time entry:", error);
    } finally {
      setCreatingNewTimeRowId("");
    }
  };

  const handleDelete = async (row) => {
    if (hasAnyPendingEdits || Boolean(savingRowId)) {
      return;
    }
    
    setDeletingRowId(row.id);
    try {
      await deleteDoc(doc(db, "churches", id, "timeRotateLogs", row.id));
      if (row.id === pendingNewTimeRowId) {
        setPendingNewTimeRowId("");
      }
      console.log("Time entry deleted successfully");
    } catch (error) {
      console.error("Error deleting time entry:", error);
    } finally {
      setDeletingRowId("");
    }
  };

  const handleExportPdf = () => {
    if (visibleRows.length === 0) return;

    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const exportDate = new Date();
    const dateRangeLabelMap = {
      all: "All Time",
      today: "Today",
      yesterday: "Yesterday",
      thisWeek: "This Week",
      lastWeek: "Last Week",
      lastMonth: "Last Month",
      last3Months: "Last 3 Months",
      thisYear: "This Year",
      lastYear: "Last Year",
    };

    doc.setFontSize(14);
    doc.text("Edit Time Entries Export", 40, 38);
    doc.setFontSize(10);
    doc.text(`Generated: ${formatTimestamp(exportDate.getTime())}`, 40, 56);
    doc.text(`Date Range: ${dateRangeLabelMap[dateFilterPreset] || "All Time"}`, 40, 72);

    const tableRows = visibleRows.map((row) => {
      const startedAt = Number(row.startedAt) || 0;
      const endedAt = Number(row.endedAt) || 0;
      const durationMs = getRowDurationMs(row);

      return [
        row.id || "-",
        formatDateOnly(startedAt),
        formatWeekdayOnly(startedAt),
        row.userLabel || "-",
        row.issueId || "-",
        row.projectName || "-",
        formatTimestamp(startedAt),
        formatTimestamp(endedAt),
        formatDuration(durationMs),
      ];
    });

    doc.autoTable({
      startY: 86,
      head: [["Log ID", "Date", "Day", "User", "Card ID", "Project", "Start Time", "End Time", "Total Hours"]],
      body: tableRows,
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [15, 118, 110] },
    });

    const fileDate = exportDate.toISOString().slice(0, 10);
    doc.save(`edit-time-entries-${fileDate}.pdf`);
  };

  return (
    <div style={{ marginTop: "12px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px", marginBottom: "12px" }}>
        <div>
          <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
            User
          </label>
          <select
            value={filterUser}
            onChange={(event) => setFilterUser(event.target.value)}
            style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
          >
            <option value="all">All Users</option>
            {userOptions.map((option) => (
              <option key={option.userKey} value={option.userKey}>
                {option.userLabel}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
            Date Range
          </label>
          <select
            value={dateFilterPreset}
            onChange={(event) => setDateFilterPreset(event.target.value)}
            style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
          >
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="thisWeek">This Week</option>
            <option value="lastWeek">Last Week</option>
            <option value="lastMonth">Last Month</option>
            <option value="last3Months">Last 3 Months</option>
            <option value="thisYear">This Year</option>
            <option value="lastYear">Last Year</option>
            <option value="custom">Custom Range</option>
          </select>
          {dateFilterPreset === "custom" && (
            <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontWeight: 700, fontSize: "0.75rem", color: "#475569", marginBottom: "2px" }}>
                  From
                </label>
                <input
                  type="date"
                  value={customDateStart}
                  onChange={(event) => {
                    const nextStartDate = event.target.value;
                    setCustomDateStart(nextStartDate);
                    setCustomDateEnd((prevEndDate) => prevEndDate || nextStartDate);
                  }}
                  max={customDateEnd || undefined}
                  style={{ width: "100%", padding: "8px", border: "1px solid #CBD5E1", borderRadius: "8px", fontSize: "0.85rem" }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontWeight: 700, fontSize: "0.75rem", color: "#475569", marginBottom: "2px" }}>
                  To
                </label>
                <input
                  type="date"
                  value={customDateEnd}
                  onChange={(event) => setCustomDateEnd(event.target.value)}
                  min={customDateStart || undefined}
                  style={{ width: "100%", padding: "8px", border: "1px solid #CBD5E1", borderRadius: "8px", fontSize: "0.85rem" }}
                />
              </div>
            </div>
          )}
        </div>
        <div>
          <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
            Search
          </label>
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search card id, project, user..."
            style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
          />
        </div>
        <div>
          <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
            Hour Check
          </label>
          <select
            value={hoursOffFilter}
            onChange={(event) => setHoursOffFilter(event.target.value)}
            style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
          >
            <option value="all">All Entries</option>
            <option value="off">Off Hours Only (&gt; 12 hrs)</option>
            <option value="normal">Normal Entries (≤ 12 hrs)</option>
          </select>
        </div>
        <div>
          <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
            Rows Per Page
          </label>
          <select
            value={rowsPerPage}
            onChange={(event) => setRowsPerPage(Number(event.target.value) || 25)}
            style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={visibleRows.length === 0}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: "8px",
              border: "none",
              backgroundColor: visibleRows.length === 0 ? "#CBD5E1" : "#0F766E",
              color: "#FFFFFF",
              fontWeight: 700,
              cursor: visibleRows.length === 0 ? "not-allowed" : "pointer",
            }}
          >
            Export to PDF
          </button>
        </div>
      </div>

      <div style={{ marginLeft: "-16px", marginRight: "-16px", overflowX: "auto", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "1240px", textAlign: "left" }}>
          <thead>
            <tr style={{ backgroundColor: "#F8FAFC" }}>
              <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Log ID</th>
              <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Date</th>
              <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Day</th>
              <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>User</th>
              <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Card ID</th>
              <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Project</th>
              <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Start Time</th>
              <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>End Time</th>
              <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Total Hours</th>
              <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ padding: "14px", color: "#64748B" }}>
                  No time entries match the current filters.
                </td>
              </tr>
            ) : (
              paginatedRows.map((row) => {
                const rowEdits = editingValues[row.id] || {};
                const startInputValue = rowEdits.startedAt || toDateTimeInputValue(row.startedAt);
                const endInputValue = rowEdits.endedAt || toDateTimeInputValue(row.endedAt);
                const startMs = new Date(startInputValue).getTime();
                const endMs = new Date(endInputValue).getTime();
                const computedDurationMs = Math.max(0, endMs - startMs);
                const isInvalid = !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs;
                const isSavedRow = row.id === lastSavedRowId;
                const historyEntries = Array.isArray(row.timeEditHistory) ? row.timeEditHistory : [];
                const notesEntries = Array.isArray(row.notesList) ? row.notesList : [];

                const sourceStartInput = toDateTimeInputValue(row.startedAt);
                const sourceEndInput = toDateTimeInputValue(row.endedAt);
                const sourceCardValue = buildCardValue(row.issueId, row.projectName);
                const sourceProjectName = normalizeValue(row.projectName);
                const projectInputValue = rowEdits.projectName !== undefined ? rowEdits.projectName : sourceProjectName;
                const cardInputValue = rowEdits.cardValue !== undefined ? rowEdits.cardValue : sourceCardValue;
                const selectedCardOption = cardOptionByValue[cardInputValue] || null;
                const rowCardOptions = projectInputValue
                  ? cardOptions.filter((option) => normalizeComparable(option.projectName) === normalizeComparable(projectInputValue))
                  : cardOptions;
                const hasProjectChange = normalizeComparable(projectInputValue) !== normalizeComparable(sourceProjectName);
                const isCardSelectionIncomplete = hasProjectChange && !selectedCardOption;
                const hasRowChanges =
                  (normalizeValue(rowEdits.startedAt).length > 0 && rowEdits.startedAt !== sourceStartInput)
                  || (normalizeValue(rowEdits.endedAt).length > 0 && rowEdits.endedAt !== sourceEndInput)
                  || (normalizeValue(rowEdits.cardValue).length > 0 && rowEdits.cardValue !== sourceCardValue)
                  || hasProjectChange;
                const requiresConfirmationSave = pendingNewTimeRowId === row.id;
                const canShowSave = hasRowChanges || requiresConfirmationSave;
                const isActiveRow = activeRowId === row.id;
                const isConfigOpen = rowConfigOpenId === row.id;

                return (
                  <tr
                    key={row.id}
                    onClick={() => {
                      if (activeRowId && activeRowId !== row.id && isActiveRowLocked) {
                        return;
                      }
                      setActiveRowId(row.id);
                      if (rowConfigOpenId && rowConfigOpenId !== row.id) {
                        setRowConfigOpenId("");
                      }
                    }}
                    style={{ backgroundColor: isSavedRow ? "#F0FDF4" : isActiveRow ? "#EFF6FF" : "transparent", cursor: "pointer" }}
                  >
                    <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#666666", fontSize: "0.78rem", fontFamily: "monospace" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <span>{row.id}</span>
                        {historyEntries.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => setHistoryModalRowId(row.id)}
                            title="Click to view full edit history"
                            style={{
                              alignSelf: "flex-start",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              padding: "2px 7px",
                              borderRadius: "999px",
                              border: "none",
                              backgroundColor: "#E0F2FE",
                              color: "#075985",
                              fontSize: "0.7rem",
                              fontWeight: 700,
                              cursor: "pointer",
                              maxWidth: "100%",
                            }}
                          >
                            Time edited ({historyEntries.length})
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setNotesModalRowId(row.id);
                          }}
                          title={notesEntries.length > 0 ? "Click to view notes for this entry" : "No notes for this entry"}
                          style={{
                            alignSelf: "flex-start",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            padding: "2px 7px",
                            borderRadius: "999px",
                            border: "none",
                            backgroundColor: notesEntries.length > 0 ? "#FEF3C7" : "#F1F5F9",
                            color: notesEntries.length > 0 ? "#92400E" : "#64748B",
                            fontSize: "0.7rem",
                            fontWeight: 700,
                            cursor: "pointer",
                            maxWidth: "100%",
                          }}
                        >
                          Notes ({notesEntries.length})
                        </button>
                      </div>
                    </td>
                    <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>
                      {formatDateOnly(row.startedAt)}
                    </td>
                    <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>
                      {formatWeekdayOnly(row.startedAt)}
                    </td>
                    <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#0F172A", fontWeight: 700 }}>
                      {row.userLabel}
                    </td>
                    <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>
                      {isActiveRow ? (
                        <>
                          <select
                            value={cardOptionByValue[cardInputValue] ? cardInputValue : ""}
                            onChange={(event) => {
                              const nextCardValue = event.target.value;
                              const nextCard = cardOptionByValue[nextCardValue];
                              setEditingValues((prev) => ({
                                ...prev,
                                [row.id]: {
                                  ...(prev[row.id] || {}),
                                  cardValue: nextCardValue,
                                  projectName: nextCard ? normalizeValue(nextCard.projectName) : projectInputValue,
                                },
                              }));
                            }}
                            onClick={(event) => event.stopPropagation()}
                            disabled={cardOptionsLoading}
                            style={{
                              width: "100%",
                              minWidth: "150px",
                              padding: "8px",
                              border: `1px solid ${isCardSelectionIncomplete ? "#F59E0B" : "#CBD5E1"}`,
                              borderRadius: "8px",
                            }}
                          >
                            <option value="">
                              {cardOptionsLoading
                                ? "Loading cards..."
                                : isCardSelectionIncomplete
                                  ? "Select a card for this project"
                                  : `Keep current (${row.issueId || "-"})`}
                            </option>
                            {rowCardOptions.map((option) => {
                              const optionTaskIdentity = `${option.projectDocId || "unknown-project"}::${normalizeValue(option.issueId)}`;
                              const optionIssueIdKey = normalizeComparable(option.issueId);
                              const optionIssueIdDigits = optionIssueIdKey.replace(/[^0-9]/g, "");
                              const isOptionBlocked = Boolean(
                                taskBlockedByIdentity[optionTaskIdentity]
                                || (optionIssueIdKey && taskBlockedByIssueId[optionIssueIdKey])
                                || (optionIssueIdDigits && taskBlockedByDigits[optionIssueIdDigits])
                              );
                              return (
                                <option key={option.key} value={option.value}>
                                  {option.issueId}{option.issueLabel ? ` - ${option.issueLabel}` : ""}{isOptionBlocked ? " [BLOCKED]" : ""}
                                </option>
                              );
                            })}
                          </select>
                          {isCardSelectionIncomplete ? (
                            <div style={{ marginTop: "4px", color: "#B45309", fontSize: "0.72rem", fontWeight: 700 }}>
                              Card required for the new project
                            </div>
                          ) : null}
                        </>
                      ) : (
                        row.issueId || "-"
                      )}
                    </td>
                    <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>
                      {isActiveRow ? (
                        <select
                          value={projectInputValue}
                          onChange={(event) => {
                            const nextProjectName = event.target.value;
                            setEditingValues((prev) => ({
                              ...prev,
                              [row.id]: {
                                ...(prev[row.id] || {}),
                                projectName: nextProjectName,
                                cardValue: normalizeComparable(nextProjectName) === normalizeComparable(sourceProjectName)
                                  ? sourceCardValue
                                  : "",
                              },
                            }));
                          }}
                          onClick={(event) => event.stopPropagation()}
                          disabled={cardOptionsLoading}
                          title="Changing the project requires selecting a card from that project"
                          style={{ width: "100%", minWidth: "170px", padding: "8px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
                        >
                          {sourceProjectName && !projectNameOptions.some((projectName) => normalizeComparable(projectName) === normalizeComparable(sourceProjectName)) ? (
                            <option value={sourceProjectName}>{sourceProjectName}</option>
                          ) : null}
                          {!sourceProjectName ? <option value="">Select a project</option> : null}
                          {projectNameOptions.map((projectName) => (
                            <option key={projectName} value={projectName}>
                              {projectName}
                            </option>
                          ))}
                        </select>
                      ) : (
                        row.projectName || "-"
                      )}
                    </td>
                    <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9" }}>
                      {isActiveRow ? (
                        <input
                          type="datetime-local"
                          step="1"
                          value={startInputValue}
                          onChange={(event) => handleValueChange(row.id, "startedAt", event.target.value)}
                          onClick={(event) => event.stopPropagation()}
                          style={{ width: "100%", padding: "8px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
                        />
                      ) : (
                        <span style={{ color: "#334155", fontWeight: 600 }}>{formatTimestamp(row.startedAt)}</span>
                      )}
                    </td>
                    <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9" }}>
                      {isActiveRow ? (
                        <input
                          type="datetime-local"
                          step="1"
                          value={endInputValue}
                          onChange={(event) => handleValueChange(row.id, "endedAt", event.target.value)}
                          onClick={(event) => event.stopPropagation()}
                          style={{ width: "100%", padding: "8px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
                        />
                      ) : (
                        <span style={{ color: "#334155", fontWeight: 600 }}>{formatTimestamp(row.endedAt)}</span>
                      )}
                    </td>
                    <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: isInvalid ? "#B91C1C" : "#0F172A", fontWeight: 700 }}>
                      {formatDuration(computedDurationMs)}
                    </td>
                    <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      {isActiveRow ? (
                        <>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setRowConfigOpenId((prev) => (prev === row.id ? "" : row.id));
                            }}
                            style={{ padding: "8px 10px", borderRadius: "8px", border: "1px solid #CBD5E1", backgroundColor: "#FFFFFF", color: "#334155", fontWeight: 700, cursor: "pointer" }}
                            title="Open actions"
                          >
                            Configure
                          </button>

                          {canShowSave ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleSave(row);
                              }}
                              disabled={savingRowId === row.id || isInvalid || isCardSelectionIncomplete}
                              style={{ padding: "8px 10px", borderRadius: "8px", border: "none", backgroundColor: isInvalid || isCardSelectionIncomplete ? "#CBD5E1" : "#0F766E", color: "#FFFFFF", fontWeight: 700, cursor: savingRowId === row.id || isInvalid || isCardSelectionIncomplete ? "not-allowed" : "pointer" }}
                              title={isCardSelectionIncomplete ? "Select a card for the new project first" : undefined}
                            >
                              {savingRowId === row.id ? "Saving..." : "Save"}
                            </button>
                          ) : null}

                          {isConfigOpen ? (
                            <>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleNewTime(row);
                                }}
                                disabled={creatingNewTimeRowId === row.id || Boolean(savingRowId) || hasAnyPendingEdits || Boolean(pendingNewTimeRowId) || isInvalid}
                                style={{ padding: "8px 10px", borderRadius: "8px", border: "none", backgroundColor: "#7C3AED", color: "#FFFFFF", fontWeight: 700, cursor: creatingNewTimeRowId === row.id || Boolean(savingRowId) || hasAnyPendingEdits || Boolean(pendingNewTimeRowId) || isInvalid ? "not-allowed" : "pointer" }}
                                title="Create a new time entry based on this row"
                              >
                                {creatingNewTimeRowId === row.id ? "Creating..." : "New Time"}
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleDelete(row);
                                }}
                                disabled={deletingRowId === row.id || hasAnyPendingEdits || Boolean(savingRowId)}
                                style={{ padding: "8px 10px", borderRadius: "8px", border: "none", backgroundColor: "#DC2626", color: "#FFFFFF", fontWeight: 700, cursor: deletingRowId === row.id || hasAnyPendingEdits || Boolean(savingRowId) ? "not-allowed" : "pointer" }}
                              >
                                {deletingRowId === row.id ? "Deleting..." : "Delete"}
                              </button>
                            </>
                          ) : null}
                        </>
                      ) : (
                        <span style={{ color: "#94A3B8", fontWeight: 600 }}>View mode</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {visibleRows.length > 0 && (
        <div style={{ marginTop: "10px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <div style={{ color: "#64748B", fontSize: "0.84rem" }}>
            Showing {startIndex + 1}-{endIndex} of {totalRows} entries
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              type="button"
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              disabled={safeCurrentPage <= 1}
              style={{
                padding: "7px 10px",
                borderRadius: "8px",
                border: "1px solid #CBD5E1",
                backgroundColor: safeCurrentPage <= 1 ? "#F1F5F9" : "#FFFFFF",
                color: "#334155",
                fontWeight: 700,
                cursor: safeCurrentPage <= 1 ? "not-allowed" : "pointer",
              }}
            >
              Previous
            </button>
            <span style={{ color: "#334155", fontWeight: 700, minWidth: "90px", textAlign: "center" }}>
              Page {safeCurrentPage} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={safeCurrentPage >= totalPages}
              style={{
                padding: "7px 10px",
                borderRadius: "8px",
                border: "1px solid #CBD5E1",
                backgroundColor: safeCurrentPage >= totalPages ? "#F1F5F9" : "#FFFFFF",
                color: "#334155",
                fontWeight: 700,
                cursor: safeCurrentPage >= totalPages ? "not-allowed" : "pointer",
              }}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {historyModalRow ? (
        <div
          onClick={() => setHistoryModalRowId("")}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(15, 23, 42, 0.45)",
            zIndex: 2000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "min(760px, 100%)",
              maxHeight: "80vh",
              overflowY: "auto",
              backgroundColor: "#FFFFFF",
              borderRadius: "12px",
              boxShadow: "0 20px 50px rgba(15, 23, 42, 0.25)",
              border: "1px solid #E2E8F0",
            }}
          >
            <div style={{ padding: "14px 16px", borderBottom: "1px solid #E2E8F0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
              <div>
                <div style={{ fontWeight: 800, color: "#0F172A" }}>Time Edit History</div>
                <div style={{ color: "#475569", fontSize: "0.84rem", marginTop: "2px" }}>
                  Log ID: {historyModalRow.id}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setHistoryModalRowId("")}
                style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid #CBD5E1", backgroundColor: "#FFFFFF", color: "#334155", fontWeight: 700, cursor: "pointer" }}
              >
                Close
              </button>
            </div>

            <div style={{ padding: "14px 16px" }}>
              {(Array.isArray(historyModalRow.timeEditHistory) ? historyModalRow.timeEditHistory : [])
                .slice()
                .reverse()
                .map((entry, entryIndex, entryList) => {
                  const changedBy = normalizeValue(entry.changedByUserLabel) || "Unknown user";
                  const changedAt = formatHistoryTimestamp(entry.changedAt);
                  const previousStart = formatHistoryTimestamp(entry.previousStartedAt);
                  const previousEnd = formatHistoryTimestamp(entry.previousEndedAt);
                  const newStart = formatHistoryTimestamp(entry.newStartedAt);
                  const newEnd = formatHistoryTimestamp(entry.newEndedAt);
                  const previousCard = normalizeValue(entry.previousIssueId);
                  const newCard = normalizeValue(entry.newIssueId);
                  const hasCardChange = Boolean((previousCard || newCard) && previousCard !== newCard);
                  return (
                    <div key={`${historyModalRow.id}-${entryIndex}`} style={{ border: "1px solid #E2E8F0", borderRadius: "10px", padding: "12px", marginBottom: entryIndex === entryList.length - 1 ? 0 : "10px", backgroundColor: "#F8FAFC" }}>
                      <div style={{ fontWeight: 800, color: "#0F172A", marginBottom: "6px" }}>
                        Change {entryList.length - entryIndex}
                      </div>
                      <div style={{ fontSize: "0.9rem", color: "#334155", marginBottom: "4px" }}>
                        Changed by {changedBy} at {changedAt}
                      </div>
                      <div style={{ fontSize: "0.86rem", color: "#334155" }}>Start: {previousStart}{" -> "}{newStart}</div>
                      <div style={{ fontSize: "0.86rem", color: "#334155" }}>End: {previousEnd}{" -> "}{newEnd}</div>
                      <div style={{ fontSize: "0.86rem", color: "#334155" }}>
                        Duration: {formatDuration(entry.previousDurationMs || 0)}{" -> "}{formatDuration(entry.newDurationMs || 0)}
                      </div>
                      {hasCardChange ? (
                        <>
                          <div style={{ fontSize: "0.86rem", color: "#334155" }}>Card ID: {previousCard || "-"}{" -> "}{newCard || "-"}</div>
                          <div style={{ fontSize: "0.86rem", color: "#334155" }}>
                            Project: {normalizeValue(entry.previousProjectName) || "-"}{" -> "}{normalizeValue(entry.newProjectName) || "-"}
                          </div>
                        </>
                      ) : null}
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      ) : null}

      {notesModalRow ? (
        <div
          onClick={() => setNotesModalRowId("")}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(15, 23, 42, 0.45)",
            zIndex: 2000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "min(680px, 100%)",
              maxHeight: "80vh",
              overflowY: "auto",
              backgroundColor: "#FFFFFF",
              borderRadius: "12px",
              boxShadow: "0 20px 50px rgba(15, 23, 42, 0.25)",
              border: "1px solid #E2E8F0",
            }}
          >
            <div style={{ padding: "14px 16px", borderBottom: "1px solid #E2E8F0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
              <div>
                <div style={{ fontWeight: 800, color: "#0F172A" }}>Time Entry Notes</div>
                <div style={{ color: "#475569", fontSize: "0.84rem", marginTop: "2px" }}>
                  {normalizeValue(notesModalRow.userLabel) || "Unknown user"} - Card {notesModalRow.issueId || "-"} - {formatDateOnly(notesModalRow.startedAt)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setNotesModalRowId("")}
                style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid #CBD5E1", backgroundColor: "#FFFFFF", color: "#334155", fontWeight: 700, cursor: "pointer" }}
              >
                Close
              </button>
            </div>

            <div style={{ padding: "14px 16px" }}>
              {(Array.isArray(notesModalRow.notesList) ? notesModalRow.notesList : []).length === 0 ? (
                <div style={{ color: "#64748B" }}>No notes were registered for this time entry.</div>
              ) : (
                notesModalRow.notesList.map((noteText, noteIndex, noteList) => (
                  <div
                    key={`${notesModalRow.id}-note-${noteIndex}`}
                    style={{ border: "1px solid #E2E8F0", borderRadius: "10px", padding: "12px", marginBottom: noteIndex === noteList.length - 1 ? 0 : "10px", backgroundColor: "#F8FAFC", color: "#334155", fontSize: "0.9rem", whiteSpace: "pre-wrap" }}
                  >
                    {noteText}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const PayEveryone = () => {
  const { id } = useParams();
  const location = useLocation();
  const { user } = useAuth();
  const saveTimersRef = React.useRef({});
  const handleSaveRef = React.useRef(null);
  const tabFromUrl = useMemo(() => {
    const searchParams = new URLSearchParams(location.search);
    const requestedTab = searchParams.get("tab");
    return ["time", "edit-time", "comp", "hours", "weekly-hours", "payments", "attendance", "lessons"].includes(requestedTab)
      ? requestedTab
      : "time";
  }, [location.search]);
  const [activeTab, setActiveTab] = useState(tabFromUrl);
  const [rows, setRows] = useState([]);
  const [activeTimers, setActiveTimers] = useState([]);
  const [organizationUsers, setOrganizationUsers] = useState([]);
  const [userProfiles, setUserProfiles] = useState([]);
  const [userCompSettings, setUserCompSettings] = useState({});
  const [draftCompSettings, setDraftCompSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingUserKey, setSavingUserKey] = useState("");
  const [deletingUserKey, setDeletingUserKey] = useState("");
  const [expandedScheduleEditors, setExpandedScheduleEditors] = useState({});
  const [dateFilterPreset, setDateFilterPreset] = useState("today");
  const [customDateStart, setCustomDateStart] = useState(formatDateForInput(addDays(new Date(), -7)));
  const [customDateEnd, setCustomDateEnd] = useState(formatDateForInput(new Date()));
  const [searchInput, setSearchInput] = useState("");
  const [selectedUser, setSelectedUser] = useState("all");
  const [selectedProject, setSelectedProject] = useState("all");
  const [deletingTimeRowId, setDeletingTimeRowId] = useState("");
  const [stoppingActiveTimerId, setStoppingActiveTimerId] = useState("");
  const [deletingDuplicateRows, setDeletingDuplicateRows] = useState(false);
  const [duplicateActionMessage, setDuplicateActionMessage] = useState("");
  const [timeDeleteError, setTimeDeleteError] = useState("");
  const [notesModalEntry, setNotesModalEntry] = useState(null);
  const [lessonModalEntry, setLessonModalEntry] = useState(null);
  const [lessonModalText, setLessonModalText] = useState("");
  const [lessonName, setLessonName] = useState("");
  const [lessonMinimumRequired, setLessonMinimumRequired] = useState("");
  const [lessonQuestions, setLessonQuestions] = useState([]);
  const [lessonSupervisorPinInput, setLessonSupervisorPinInput] = useState("");
  const [lessonSubmitPinError, setLessonSubmitPinError] = useState("");
  const [savingLessonModal, setSavingLessonModal] = useState(false);
  const [lessonViewModalEntry, setLessonViewModalEntry] = useState(null);
  const [receiptSignatureViewer, setReceiptSignatureViewer] = useState(null);
  const [lessonLimitConfig, setLessonLimitConfig] = useState(DEFAULT_LESSON_LIMIT_CONFIG);
  const [savingLessonLimitConfig, setSavingLessonLimitConfig] = useState(false);
  const [deletingLessonId, setDeletingLessonId] = useState("");
  const lessonSuggestions = useMemo(() => {
    if (!lessonModalEntry) return [];

    const suggestions = [];
    const employeeName = normalizeValue(lessonModalEntry.userLabel) || "Team member";
    const lateGrade = normalizeValue(lessonModalEntry.lateGrade).toUpperCase();
    const noteGrade = normalizeValue(lessonModalEntry.noteGrade).toUpperCase();
    const totalLateMinutes = Number(lessonModalEntry.totalLateMinutes) || 0;
    const totalNotes = Number(lessonModalEntry.totalNotes) || 0;
    const strongLatePerformance = totalLateMinutes <= 0 && ["A+", "A", "A-"].includes(lateGrade);
    const strongNotesPerformance = totalNotes >= 8 && ["A+", "A"].includes(noteGrade);

    if (strongLatePerformance) {
      suggestions.push({
        title: "Punctuality Recognition",
        text: `${employeeName}, great job being on time and ready to work. Your punctuality is strong, and your consistency is helping the team.` ,
      });
    }

    if (strongNotesPerformance) {
      suggestions.push({
        title: "Notes Recognition",
        text: `${employeeName}, excellent work on your notes. You met the note standard and documented your work clearly. Keep this level of detail.` ,
      });
    }

    if (strongLatePerformance && strongNotesPerformance) {
      suggestions.push({
        title: "Overall Excellence",
        text: `${employeeName}, excellent performance. You earned strong grades in both punctuality and notes. Keep leading by example.` ,
      });
    }

    if (lessonModalEntry.isAbsent) {
      suggestions.push({
        title: "Attendance Recovery Plan",
        text: `${employeeName}, please let's work on this. You missed your sign-in window. Starting tomorrow, open your tools before shift start and message your lead before your shift if there is any blocker.`,
      });
    }

    if (totalLateMinutes > 0 || ["B", "C", "D", "F"].includes(lateGrade)) {
      suggestions.push({
        title: "Punctual Start Readiness",
        text: `${employeeName}, please let's work on punctuality. You were late, so the expectation is to arrive early and be fully ready to work at your start time. Use a 15-minute pre-shift reminder and have all tools open before clock-in.`,
      });
      suggestions.push({
        title: "Timezone Discipline",
        text: `${employeeName}, please follow your assigned timezone schedule exactly. Your timer should start on time in your timezone every day so your attendance grade improves.`,
      });
    }

    if (["B", "C", "D", "F"].includes(noteGrade) || totalNotes < 8) {
      suggestions.push({
        title: "Note Quality Improvement",
        text: `${employeeName}, please let's work on note quality. Add meaningful progress notes during your shift, not only at the end. Each note should include context, action taken, and next step.`,
      });
      suggestions.push({
        title: "Minimum Notes Requirement",
        text: `${employeeName}, please let's work on this. You got a ${noteGrade || "low"} on notes${totalNotes === 0 ? " because you did not submit any notes" : ""}. Make sure to add notes. Minimum expectation is 8 clear notes per period.`,
      });
    }

    const uniqueByTitle = new Map();
    suggestions.forEach((item) => {
      if (!uniqueByTitle.has(item.title)) uniqueByTitle.set(item.title, item);
    });
    return Array.from(uniqueByTitle.values());
  }, [lessonModalEntry]);

  const reusableLessonOptions = useMemo(() => {
    const uniqueLessons = new Map();

    Object.entries(userCompSettings || {}).forEach(([userKey, settings]) => {
      const normalizedUserKey = normalizeValue(userKey);
      const sourceUserLabel = normalizeValue(settings?.userLabel) || normalizedUserKey;

      normalizeLessonsLearned(settings?.lessonsLearned).forEach((lesson, lessonIndex) => {
        const lessonName = normalizeValue(lesson?.name);
        const minimumRequired = normalizeValue(lesson?.minimumRequired);
        const lessonText = normalizeValue(lesson?.text);
        if (!lessonText) return;

        const uniquenessKey = [lessonName.toLowerCase(), minimumRequired.toLowerCase(), lessonText.toLowerCase()].join("||");
        if (uniqueLessons.has(uniquenessKey)) return;

        uniqueLessons.set(uniquenessKey, {
          id: `${normalizedUserKey}-${Number(lesson?.createdAt) || 0}-${lessonIndex}`,
          name: lessonName,
          minimumRequired,
          text: lessonText,
          questions: normalizeLessonQuestions(lesson?.questions),
          createdAt: Number(lesson?.createdAt) || 0,
          sourceUserLabel,
        });
      });
    });

    return Array.from(uniqueLessons.values())
      .sort((left, right) => (Number(right.createdAt) || 0) - (Number(left.createdAt) || 0))
      .slice(0, 20);
  }, [userCompSettings]);

  const lessonSubmissionLimitStatus = useMemo(() => {
    if (!lessonModalEntry) {
      return {
        shouldRequirePin: false,
        currentCount: 0,
        maxCount: 0,
        period: normalizeValue(lessonLimitConfig.period) || "month",
        configuredLessonName: "",
      };
    }

    const normalizedConfig = normalizeLessonLimitConfig(lessonLimitConfig);
    if (!normalizedConfig.enabled || Number(normalizedConfig.maxCount) <= 0) {
      return {
        shouldRequirePin: false,
        currentCount: 0,
        maxCount: Number(normalizedConfig.maxCount) || 0,
        period: normalizedConfig.period,
        configuredLessonName: normalizeValue(normalizedConfig.lessonName).toLowerCase(),
      };
    }

    const configuredLessonName = normalizeValue(normalizedConfig.lessonName).toLowerCase();
    if (!configuredLessonName) {
      return {
        shouldRequirePin: false,
        currentCount: 0,
        maxCount: Number(normalizedConfig.maxCount) || 0,
        period: normalizedConfig.period,
        configuredLessonName: "",
      };
    }

    const normalizedLessonName = normalizeValue(lessonName).toLowerCase();
    if (!normalizedLessonName) {
      return {
        shouldRequirePin: false,
        currentCount: 0,
        maxCount: Number(normalizedConfig.maxCount) || 0,
        period: normalizedConfig.period,
        configuredLessonName,
      };
    }

    const appliesToCurrentLesson = normalizedLessonName === configuredLessonName;
    if (!appliesToCurrentLesson) {
      return {
        shouldRequirePin: false,
        currentCount: 0,
        maxCount: Number(normalizedConfig.maxCount) || 0,
        period: normalizedConfig.period,
        configuredLessonName,
      };
    }

    const compUserKey = resolveCompUserKey({
      userKey: lessonModalEntry.userKey,
      userId: lessonModalEntry.userId,
      userEmail: lessonModalEntry.userEmail,
      userLabel: lessonModalEntry.userLabel,
      savedSettingsMap: userCompSettings,
      draftSettingsMap: draftCompSettings,
    });

    if (!compUserKey) {
      return {
        shouldRequirePin: false,
        currentCount: 0,
        maxCount: Number(normalizedConfig.maxCount) || 0,
        period: normalizedConfig.period,
        configuredLessonName,
      };
    }

    const savedSettings = userCompSettings?.[compUserKey] || {};
    const existingLessons = normalizeLessonsLearned(savedSettings.lessonsLearned);
    const now = Date.now();
    const boundaryDate = new Date(now);
    boundaryDate.setHours(0, 0, 0, 0);

    if (normalizedConfig.period === "week") {
      const mondayOffset = (boundaryDate.getDay() + 6) % 7;
      boundaryDate.setDate(boundaryDate.getDate() - mondayOffset);
    } else if (normalizedConfig.period === "month") {
      boundaryDate.setDate(1);
    } else if (normalizedConfig.period === "year") {
      boundaryDate.setMonth(0, 1);
    }

    const startBoundaryMs = boundaryDate.getTime();
    const countInPeriod = existingLessons.filter((lesson) => {
      const createdAtMs = Number(lesson?.createdAt) || 0;
      const savedLessonName = normalizeValue(lesson?.name).toLowerCase();
      return createdAtMs >= startBoundaryMs
        && createdAtMs <= now
        && savedLessonName === configuredLessonName;
    }).length;

    return {
      shouldRequirePin: countInPeriod >= normalizedConfig.maxCount,
      currentCount: countInPeriod,
      maxCount: normalizedConfig.maxCount,
      period: normalizedConfig.period,
      configuredLessonName,
    };
  }, [draftCompSettings, lessonLimitConfig, lessonModalEntry, lessonName, userCompSettings]);

  const routePrefix =
    typeof window !== "undefined" && window.location?.pathname?.includes("/church/")
      ? "/church"
      : "/organization";

  const getTabLink = (tabName) => `${location.pathname}?tab=${tabName}`;

  const normalizedRole = String(user?.role || user?.customRole || "").trim().toLowerCase();
  const isGlobalAdminUser = ["global_admin", "system_global_admin"].includes(normalizedRole);

  useEffect(() => {
    setActiveTab(tabFromUrl);
  }, [tabFromUrl]);

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
              issueLabel: normalizeValue(data.issueLabel || data.issueTitle || data.issueName || data.issueSummary),
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
              stoppedByLabel: normalizeValue(data.stoppedByAdminName || data.stoppedByAdminEmail || data.stoppedBy),
              requiresSaveConfirmation: Boolean(data.requiresSaveConfirmation),
              timeEditHistory: Array.isArray(data.timeEditHistory) ? data.timeEditHistory : [],
              notesSummary: formatNotesSummary(data.notes),
              notesList: formatNotesList(data.notes),
              logType: normalizeValue(data.logType) || "timer",
            };
          })
          .filter((entry) => entry.logType !== "completion")
          .filter((entry) => entry.durationMs > 0)
          .sort((left, right) => (Number(right.startedAt) || 0) - (Number(left.startedAt) || 0));

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
              issueId: normalizeValue(data.issueId),
              projectName: normalizeValue(data.projectName),
              startedAt: toTimestampMs(data.startedAt),
              notesList: formatNotesList(data.notes),
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

    const usersRef = collection(db, "users");
    const numericId = Number(id);
    const organizationIds = [id, Number.isFinite(numericId) ? numericId : null].filter(
      (value, index, values) => value !== null && values.indexOf(value) === index
    );
    const userQueries = organizationIds.flatMap((organizationId) => [
      query(usersRef, where("churchId", "==", organizationId)),
      query(usersRef, where("churchID", "==", organizationId)),
      query(usersRef, where("organizationId", "==", organizationId)),
    ]);
    const userQueryDocs = userQueries.map(() => []);

    const buildUsersFromSnapshots = () => {
      const mergedDocs = userQueryDocs.flat();
      const nextUsersById = new Map();

      mergedDocs.forEach((snapshotDoc) => {
        const data = snapshotDoc.data() || {};
        const userId = normalizeValue(snapshotDoc.id);
        const userEmail = normalizeValue(data.email);
        const userLabel = resolveUserLabel({
          ...data,
          userEmail,
          userId,
        })
          || userEmail
          || userId;

        const userKey = normalizeUserKey({ userId, userEmail, userLabel });
        if (!userKey) return;

        nextUsersById.set(userId || userKey, {
          userId,
          userEmail,
          userLabel,
          userKey,
        });
      });

      const nextUsers = Array.from(nextUsersById.values()).sort((left, right) =>
        left.userLabel.localeCompare(right.userLabel)
      );

      setOrganizationUsers(nextUsers);
    };

    const unsubscribers = userQueries.map((userQuery, queryIndex) => onSnapshot(userQuery, (snapshot) => {
      userQueryDocs[queryIndex] = snapshot.docs;
      buildUsersFromSnapshots();
    }));

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [id]);

  useEffect(() => {
    const userIds = Array.from(new Set(
      [...organizationUsers, ...rows, ...activeTimers]
        .map((entry) => normalizeValue(entry.userId))
        .filter(Boolean)
    ));

    if (userIds.length === 0) {
      setUserProfiles([]);
      return () => {};
    }

    let active = true;
    Promise.all(userIds.map(async (userId) => {
      try {
        const profileSnapshot = await getDoc(doc(db, "users", userId));
        if (!profileSnapshot.exists()) return null;
        const data = profileSnapshot.data() || {};
        const userEmail = normalizeValue(data.email);
        return {
          userId,
          userEmail,
          userLabel: resolveUserLabel({ ...data, userId, userEmail }),
          userKey: normalizeUserKey({ userId, userEmail, userLabel: resolveUserLabel({ ...data, userId, userEmail }) }),
        };
      } catch (error) {
        console.error("Error loading user profile:", error);
        return null;
      }
    })).then((profiles) => {
      if (active) setUserProfiles(profiles.filter(Boolean));
    });

    return () => {
      active = false;
    };
  }, [activeTimers, organizationUsers, rows]);

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
          scheduleTimezone: normalizeScheduleTimezone(data.scheduleTimezone),
          changeLog: normalizeChangeLog(data.changeLog),
          lessonsLearned: normalizeLessonsLearned(data.lessonsLearned),
          lessonsAcknowledgements: normalizeLessonsAcknowledgements(data.lessonsAcknowledgements),
        };
      });

      setUserCompSettings(nextSettings);
    });

    return () => unsubscribe();
  }, [id]);

  useEffect(() => {
    if (!id) {
      setLessonLimitConfig(DEFAULT_LESSON_LIMIT_CONFIG);
      return () => {};
    }

    const unsubscribe = onSnapshot(doc(db, "churches", id, "payEveryoneSettings", "lessonLimits"), (snapshotDoc) => {
      if (!snapshotDoc.exists()) {
        setLessonLimitConfig(DEFAULT_LESSON_LIMIT_CONFIG);
        return;
      }

      const data = snapshotDoc.data() || {};
      setLessonLimitConfig(normalizeLessonLimitConfig(data));
    });

    return () => unsubscribe();
  }, [id]);

  const combinedUsers = useMemo(() => {
    const userMap = new Map();
    const profileByIdentity = new Map();
    userProfiles.forEach((profile) => {
      [profile.userId, profile.userEmail].forEach((identity) => {
        const normalizedIdentity = normalizeComparable(identity);
        if (normalizedIdentity) profileByIdentity.set(normalizedIdentity, profile);
      });
    });

    const addUserEntry = (sourceEntry) => {
      const entry = { ...sourceEntry };
      const profile = profileByIdentity.get(normalizeComparable(entry.userId))
        || profileByIdentity.get(normalizeComparable(entry.userEmail));
      if (profile) {
        entry.userKey = profile.userKey;
        entry.userId = profile.userId;
        entry.userEmail = profile.userEmail;
        entry.userLabel = profile.userLabel;
      }
      if (!entry.userKey) return;

      const current = userMap.get(entry.userKey);
      if (!current) {
        userMap.set(entry.userKey, entry);
        return;
      }

      const currentLabel = normalizeValue(current.userLabel);
      const nextLabel = normalizeValue(entry.userLabel);
      const currentScore = currentLabel.split(/\s+/).filter(Boolean).length * 1000 + currentLabel.length;
      const nextScore = nextLabel.split(/\s+/).filter(Boolean).length * 1000 + nextLabel.length;
      if (nextScore > currentScore || entry.userId === current.userId) {
        userMap.set(entry.userKey, { ...current, ...entry, userLabel: nextScore >= currentScore ? nextLabel : currentLabel });
      }
    };

    userProfiles.forEach((entry) => {
      addUserEntry(entry);
    });

    organizationUsers.forEach((entry) => {
      addUserEntry(entry);
    });

    rows.forEach((entry) => {
      addUserEntry({
        userKey: entry.userKey,
        userId: normalizeValue(entry.userId),
        userEmail: normalizeValue(entry.userEmail),
        userLabel: normalizeValue(entry.userLabel),
      });
    });

    activeTimers.forEach((entry) => {
      addUserEntry({
        userKey: entry.userKey,
        userId: normalizeValue(entry.userId),
        userEmail: normalizeValue(entry.userEmail),
        userLabel: normalizeValue(entry.userLabel),
      });
    });

    return Array.from(userMap.values()).sort((left, right) =>
      normalizeValue(left.userLabel).localeCompare(normalizeValue(right.userLabel))
    );
  }, [activeTimers, organizationUsers, rows, userProfiles]);

  const canonicalUserLabel = useMemo(() => {
    const labelsByIdentity = new Map();
    combinedUsers.forEach((entry) => {
      const label = normalizeValue(entry.userLabel) || normalizeValue(entry.userKey);
      [entry.userKey, entry.userId, entry.userEmail].forEach((identity) => {
        const normalizedIdentity = normalizeComparable(identity);
        if (normalizedIdentity && label) labelsByIdentity.set(normalizedIdentity, label);
      });
    });

    return (entry) => {
      for (const identity of [entry.userKey, entry.userId, entry.userEmail]) {
        const label = labelsByIdentity.get(normalizeComparable(identity));
        if (label) return label;
      }
      return normalizeValue(entry.userLabel) || normalizeValue(entry.userKey) || "Unknown user";
    };
  }, [combinedUsers]);

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
        scheduleTimezone: normalizeScheduleTimezone(saved.scheduleTimezone),
        changeLog: normalizeChangeLog(saved.changeLog),
        lessonsLearned: normalizeLessonsLearned(saved.lessonsLearned),
        lessonsAcknowledgements: normalizeLessonsAcknowledgements(saved.lessonsAcknowledgements),
      };
    });
    setDraftCompSettings(nextDraft);
  }, [combinedUsers, userCompSettings]);

  const userOptions = useMemo(() => {
    return [{ userKey: "all", userLabel: "All Users" }].concat(
      combinedUsers.map((entry) => ({
        userKey: entry.userKey,
        userLabel: entry.userLabel || entry.userKey,
      }))
    );
  }, [combinedUsers]);

  const projectOptions = useMemo(() => {
    return Array.from(
      new Set(
        rows
          .map((row) => normalizeValue(row.projectName))
          .concat(activeTimers.map((entry) => normalizeValue(entry.projectName)))
          .filter(Boolean)
      )
    )
      .sort((left, right) => left.localeCompare(right));
  }, [activeTimers, rows]);

  const filteredRows = useMemo(() => {
    const normalizedSearch = normalizeComparable(searchInput);
    const { startMs, endMs } = getRangeForPreset(dateFilterPreset, {
      startDate: customDateStart,
      endDate: customDateEnd,
    });

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
        row.notesSummary,
        formatDuration(row.durationMs),
        formatTimestamp(row.startedAt),
        formatTimestamp(row.endedAt),
      ]
        .map((value) => normalizeComparable(value))
        .join(" ");

      return searchHaystack.includes(normalizedSearch);
    });
  }, [customDateEnd, customDateStart, dateFilterPreset, rows, searchInput, selectedProject, selectedUser]);

  const filteredOpenTimers = useMemo(() => {
    const normalizedSearch = normalizeComparable(searchInput);
    const { startMs, endMs } = getRangeForPreset(dateFilterPreset, {
      startDate: customDateStart,
      endDate: customDateEnd,
    });

    return activeTimers.filter((entry) => {
      const referenceTimestamp = Number(entry.startedAt) || 0;
      const isDateFilterActive = Number.isFinite(startMs) && Number.isFinite(endMs);
      const matchesDate =
        !isDateFilterActive ||
        (referenceTimestamp >= startMs && referenceTimestamp <= endMs);
      if (!matchesDate) return false;

      const matchesUser = selectedUser === "all" || normalizeValue(entry.userKey) === selectedUser;
      if (!matchesUser) return false;

      const matchesProject =
        selectedProject === "all" || normalizeValue(entry.projectName) === selectedProject;
      if (!matchesProject) return false;

      if (!normalizedSearch) return true;

      const searchHaystack = [
        entry.issueId,
        entry.projectName,
        entry.userLabel,
        formatTimestamp(entry.startedAt),
        "open timer",
      ]
        .map((value) => normalizeComparable(value))
        .join(" ");

      return searchHaystack.includes(normalizedSearch);
    });
  }, [activeTimers, customDateEnd, customDateStart, dateFilterPreset, searchInput, selectedProject, selectedUser]);

  const getOpenTimerTotalNotes = (timerEntry) => {
    const timerDayStart = startOfDay(Number(timerEntry.startedAt) || 0).getTime();
    const sameUser = (entry) => (
      (normalizeValue(timerEntry.userId) && normalizeValue(entry.userId) === normalizeValue(timerEntry.userId))
      || (normalizeValue(timerEntry.userEmail) && normalizeComparable(entry.userEmail) === normalizeComparable(timerEntry.userEmail))
      || normalizeValue(entry.userKey) === normalizeValue(timerEntry.userKey)
    );
    const completedNotes = rows
      .filter((row) => sameUser(row))
      .filter((row) => startOfDay(Number(row.startedAt) || Number(row.endedAt) || 0).getTime() === timerDayStart)
      .reduce((total, row) => total + (Array.isArray(row.notesList) ? row.notesList.length : 0), 0);

    return completedNotes + (Array.isArray(timerEntry.notesList) ? timerEntry.notesList.length : 0);
  };

  const usersNotStarted = useMemo(() => {
    const startedUserKeys = new Set([
      ...filteredRows.map((entry) => normalizeValue(entry.userKey)),
      ...filteredOpenTimers.map((entry) => normalizeValue(entry.userKey)),
    ].filter(Boolean));

    return combinedUsers
      .filter((entry) => selectedUser === "all" || normalizeValue(entry.userKey) === selectedUser)
      .filter((entry) => !startedUserKeys.has(normalizeValue(entry.userKey)))
      .sort((left, right) => normalizeValue(left.userLabel).localeCompare(normalizeValue(right.userLabel)));
  }, [combinedUsers, filteredOpenTimers, filteredRows, selectedUser]);

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
        totalNotes: 0,
      };
      currentDay.durationMs += rowDurationMs;
      currentDay.totalCost += rowCost;
      currentDay.lineItems += 1;
      currentDay.totalNotes += Array.isArray(row.notesList) ? row.notesList.length : 0;
      dailyMap.set(dayMapKey, currentDay);

      const currentWeek = weeklyMap.get(weekMapKey) || {
        key: weekMapKey,
        userKey,
        userLabel,
        startMs: weekStartMs,
        durationMs: 0,
        totalCost: 0,
        lineItems: 0,
        totalNotes: 0,
      };
      currentWeek.durationMs += rowDurationMs;
      currentWeek.totalCost += rowCost;
      currentWeek.lineItems += 1;
      currentWeek.totalNotes += Array.isArray(row.notesList) ? row.notesList.length : 0;
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
          totalNotes: 0,
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
          totalNotes: 0,
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
          totalNotes: 0,
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
          totalNotes: 0,
        };

        nextRows.push({
          type: "weekSubtotal",
          ...weekSummary,
        });
      }
    });

    return nextRows;
  }, [filteredRows, draftCompSettings, userCompSettings, selectedUser, selectedProject, dateFilterPreset]);

  const handleDeleteTimeLog = async (row) => {
    if (!id || !row?.id) return;

    const confirmed = window.confirm(
      `Delete this time entry?\n\nUser: ${normalizeValue(row.userLabel) || "Unknown"}\nCard ID: ${normalizeValue(row.issueId) || "-"}\nDuration: ${formatDuration(row.durationMs)}`
    );
    if (!confirmed) return;

    setDeletingTimeRowId(row.id);
    setDuplicateActionMessage("");
    setTimeDeleteError("");

    try {
      await deleteDoc(doc(db, "churches", id, "timeRotateLogs", row.id));
    } catch (deleteError) {
      console.error("Error deleting time log from PayEveryone table:", deleteError);
      setTimeDeleteError("Could not delete this time entry. Please try again.");
    } finally {
      setDeletingTimeRowId("");
    }
  };

  const handleStopActiveTimer = async (entry) => {
    if (!id || !entry?.id) return;

    setStoppingActiveTimerId(entry.id);
    setTimeDeleteError("");
    setDuplicateActionMessage("");

    try {
      const activeTimerRef = doc(db, "churches", id, "timeRotateActiveTimers", entry.id);
      const activeTimerSnap = await getDoc(activeTimerRef);
      const activeData = activeTimerSnap.exists() ? (activeTimerSnap.data() || {}) : {};
      const adminName = normalizeValue(user?.displayName || user?.name || user?.fullName || user?.email || "Admin");
      const adminEmail = normalizeValue(user?.email);
      const adminIdentity = adminEmail ? `${adminName} (${adminEmail})` : adminName;

      const startedAt = toTimestampMs(activeData.startedAt || entry.startedAt);
      const endedAt = Date.now();
      const durationMs = Math.max(0, endedAt - startedAt);
      const existingNotes = Array.isArray(activeData.notes) ? activeData.notes : [];
      const adminStopNoteText = `Stopped by admin for leaving without complying with timesheet. Stopped by: ${adminIdentity}.`;
      const notes = [
        ...existingNotes,
        {
          text: adminStopNoteText,
          createdAt: endedAt,
          createdBy: adminIdentity,
          source: "pay-everyone-admin-stop",
        },
      ];

      await addDoc(collection(db, "churches", id, "timeRotateLogs"), {
        ...activeData,
        churchId: id,
        logType: "timer",
        issueId: normalizeValue(activeData.issueId || entry.issueId),
        projectName: normalizeValue(activeData.projectName || entry.projectName),
        userId: normalizeValue(activeData.userId || entry.userId),
        userEmail: normalizeValue(activeData.userEmail || entry.userEmail),
        registeredBy: normalizeValue(activeData.registeredBy || entry.userLabel),
        startedAt,
        endedAt,
        durationMs,
        notes,
        stoppedBy: adminIdentity,
        stoppedByAdminName: adminName,
        stoppedByAdminEmail: adminEmail,
      });

      await deleteDoc(activeTimerRef);
      setDuplicateActionMessage(`Stopped timer for ${normalizeValue(entry.userLabel) || "user"}.`);
    } catch (stopError) {
      console.error("Error stopping active timer from PayEveryone:", stopError);
      setTimeDeleteError("Could not stop this active timer. Please try again.");
    } finally {
      setStoppingActiveTimerId("");
    }
  };

  const handleDeleteVisibleDuplicates = async () => {
    if (!id) return;

    const plan = getDuplicateDeletePlan(filteredRows);
    if (plan.duplicateCount === 0) {
      setDuplicateActionMessage("No visible duplicates found.");
      setTimeDeleteError("");
      return;
    }

    const confirmed = window.confirm(
      `Delete ${plan.duplicateCount} duplicate entries across ${plan.duplicateGroupCount} duplicate groups in the current filtered view?`
    );
    if (!confirmed) return;

    setDeletingDuplicateRows(true);
    setDuplicateActionMessage("");
    setTimeDeleteError("");

    try {
      for (const entryId of plan.idsToDelete) {
        await deleteDoc(doc(db, "churches", id, "timeRotateLogs", entryId));
      }
      setDuplicateActionMessage(`Deleted ${plan.duplicateCount} duplicate entries.`);
    } catch (deleteError) {
      console.error("Error deleting duplicate time logs from PayEveryone table:", deleteError);
      setTimeDeleteError("Could not delete duplicate entries. Please try again.");
    } finally {
      setDeletingDuplicateRows(false);
    }
  };

  const handleOpenNotesModal = (row) => {
    const notesList = Array.isArray(row?.notesList) ? row.notesList : [];
    if (notesList.length === 0) return;

    setNotesModalEntry({
      id: row.id,
      userLabel: normalizeValue(row.userLabel) || "Unknown user",
      issueId: normalizeValue(row.issueId) || "-",
      notesList,
    });
  };

  const handleCloseNotesModal = () => {
    setNotesModalEntry(null);
  };

  const handleNotifyMissingNotes = async (row) => {
    const recipientEmail = normalizeValue(row?.userEmail);
    if (!recipientEmail) {
      setTimeDeleteError("This entry has no user email, so Teams chat cannot be opened.");
      return;
    }

    const teamsUrl = buildTeamsChatUrl(recipientEmail);
    if (!teamsUrl) {
      setTimeDeleteError("Could not build Teams chat link for this user.");
      return;
    }

    const reminderMessage = [
      `Hi ${normalizeValue(row?.userLabel) || "there"},`,
      "quick reminder to include notes when stopping TimeRotate entries.",
      `Card: ${normalizeValue(row?.issueId) || "-"}`,
      `Project: ${normalizeValue(row?.projectName) || "-"}`,
      "Thank you!",
    ].join("\n");

    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(reminderMessage);
        setDuplicateActionMessage("Opened Teams chat and copied reminder message to clipboard.");
      } else {
        setDuplicateActionMessage("Opened Teams chat. Copy the reminder manually from this table context.");
      }
      setTimeDeleteError("");
    } catch (clipboardError) {
      setDuplicateActionMessage("Opened Teams chat. Clipboard copy was blocked, so paste message manually.");
    }

    window.open(teamsUrl, "_blank", "noopener,noreferrer");
  };

  const handleAddLessonLearned = (entry) => {
    setLessonModalEntry({
      userKey: normalizeValue(entry?.userKey),
      userId: normalizeValue(entry?.userId),
      userEmail: normalizeValue(entry?.userEmail),
      userLabel: normalizeValue(entry?.userLabel) || "Unknown user",
      lateGrade: normalizeValue(entry?.lateGrade),
      noteGrade: normalizeValue(entry?.noteGrade),
      totalLateMinutes: Number(entry?.totalLateMinutes) || 0,
      totalNotes: Number(entry?.totalNotes) || 0,
      isAbsent: entry?.isAbsent === true,
    });
    setLessonModalText("");
    setLessonQuestions([]);
    setLessonSupervisorPinInput("");
    setLessonSubmitPinError("");
  };

  const handleCloseLessonModal = () => {
    if (savingLessonModal) return;
    setLessonModalEntry(null);
    setLessonModalText("");
    setLessonName("");
    setLessonMinimumRequired("");
    setLessonQuestions([]);
    setLessonSupervisorPinInput("");
    setLessonSubmitPinError("");
  };

  const handleSaveLessonLimitConfig = async () => {
    if (!id) return;

    const normalizedConfig = normalizeLessonLimitConfig(lessonLimitConfig);
    setSavingLessonLimitConfig(true);
    try {
      await setDoc(
        doc(db, "churches", id, "payEveryoneSettings", "lessonLimits"),
        {
          ...normalizedConfig,
          updatedAt: Date.now(),
          updatedBy: normalizeValue(user?.displayName || user?.name || user?.fullName || user?.email || "Admin"),
        },
        { merge: true }
      );
    } catch (saveConfigError) {
      console.error("Error saving lesson limit config:", saveConfigError);
      window.alert("Could not save lesson limit settings. Please try again.");
    } finally {
      setSavingLessonLimitConfig(false);
    }
  };

  const handleDeleteSubmittedLesson = async (lessonEntry) => {
    if (!id || !lessonEntry) return;

    const confirmDelete = window.confirm(
      `Delete this lesson for ${normalizeValue(lessonEntry.userLabel) || "this user"}?\n\nLesson: ${normalizeValue(lessonEntry.name) || "(no name)"}\nText: ${normalizeValue(lessonEntry.text) || "-"}`
    );
    if (!confirmDelete) return;

    const compUserKey = resolveCompUserKey({
      userKey: lessonEntry.userKey,
      userId: "",
      userEmail: "",
      userLabel: lessonEntry.userLabel,
      savedSettingsMap: userCompSettings,
      draftSettingsMap: draftCompSettings,
    });

    if (!compUserKey) {
      window.alert("Could not resolve user settings record for this lesson.");
      return;
    }

    const savedSettings = userCompSettings?.[compUserKey] || {};
    const existingLessons = normalizeLessonsLearned(savedSettings.lessonsLearned);

    let removed = false;
    const nextLessons = existingLessons.filter((lesson) => {
      if (removed) return true;

      const sameCreatedAt = (Number(lesson?.createdAt) || 0) === (Number(lessonEntry?.createdAt) || 0);
      const sameName = normalizeValue(lesson?.name) === normalizeValue(lessonEntry?.name);
      const sameMinimumRequired = normalizeValue(lesson?.minimumRequired) === normalizeValue(lessonEntry?.minimumRequired);
      const sameText = normalizeValue(lesson?.text) === normalizeValue(lessonEntry?.text);
      const sameCreatedBy = normalizeValue(lesson?.createdBy) === normalizeValue(lessonEntry?.createdBy);
      const sameAutoKey = normalizeValue(lesson?.autoKey) === normalizeValue(lessonEntry?.autoKey);

      const isMatch = sameCreatedAt && sameName && sameMinimumRequired && sameText && sameCreatedBy && sameAutoKey;
      if (isMatch) {
        removed = true;
        return false;
      }
      return true;
    });

    if (!removed) {
      window.alert("Could not find this lesson to delete.");
      return;
    }

    setDeletingLessonId(normalizeValue(lessonEntry.id));
    try {
      await setDoc(
        doc(db, "churches", id, "payEveryoneUserSettings", normalizeValue(savedSettings.docId) || compUserKey),
        {
          userKey: compUserKey,
          lessonsLearned: nextLessons,
          updatedAt: Date.now(),
        },
        { merge: true }
      );
    } catch (deleteLessonError) {
      console.error("Error deleting lesson submitted entry:", deleteLessonError);
      window.alert("Could not delete this lesson. Please try again.");
    } finally {
      setDeletingLessonId("");
    }
  };

  const handleOpenLessonsViewModal = (entry) => {
    setLessonViewModalEntry({
      userLabel: normalizeValue(entry?.userLabel) || "Unknown user",
      lessonsLearned: normalizeLessonsLearned(entry?.lessonsLearned),
    });
  };

  const handleCloseLessonsViewModal = () => {
    setLessonViewModalEntry(null);
  };

  const handleSubmitLessonLearned = async () => {
    if (!id || !lessonModalEntry) return;
    setLessonSubmitPinError("");

    const normalizedLessonText = normalizeValue(lessonModalText);
    if (!normalizedLessonText) {
      window.alert("Lesson learned note cannot be empty.");
      return;
    }

    const normalizedLessonName = normalizeValue(lessonName);
    const normalizedMinimumRequired = normalizeValue(lessonMinimumRequired);
    if (!normalizedLessonName) {
      window.alert("Lesson name cannot be empty.");
      return;
    }
    if (!normalizedMinimumRequired) {
      window.alert("Minimum required cannot be empty.");
      return;
    }

    const hasIncompleteQuestions = lessonQuestions.some((entry) => {
      const hasQuestion = Boolean(normalizeValue(entry?.question));
      const hasAnswer = Boolean(normalizeValue(entry?.answer));
      return (hasQuestion || hasAnswer) && !(hasQuestion && hasAnswer);
    });
    if (hasIncompleteQuestions) {
      window.alert("Each question must include both a question and a correct answer.");
      return;
    }

    const normalizedQuestions = normalizeLessonQuestions(lessonQuestions);

    if (lessonSubmissionLimitStatus.shouldRequirePin) {
      const normalizedConfig = normalizeLessonLimitConfig(lessonLimitConfig);
      if (!normalizedConfig.supervisorPin) {
        setLessonSubmitPinError("Supervisor PIN is not configured. Configure it in Lessons Submitted tab.");
        return;
      }

      const enteredPin = normalizeValue(lessonSupervisorPinInput);
      if (!enteredPin) {
        setLessonSubmitPinError("Supervisor PIN is required because this user exceeded the lesson limit.");
        return;
      }

      if (enteredPin !== normalizedConfig.supervisorPin) {
        setLessonSubmitPinError("Invalid supervisor PIN.");
        return;
      }
    }

    const compUserKey = resolveCompUserKey({
      userKey: lessonModalEntry.userKey,
      userId: lessonModalEntry.userId,
      userEmail: lessonModalEntry.userEmail,
      userLabel: lessonModalEntry.userLabel,
      savedSettingsMap: userCompSettings,
      draftSettingsMap: draftCompSettings,
    });

    if (!compUserKey) {
      window.alert("Could not resolve user settings record for this lesson.");
      return;
    }

    const savedSettings = userCompSettings?.[compUserKey] || {};
    const existingLessons = normalizeLessonsLearned(savedSettings.lessonsLearned);
    const createdBy = normalizeValue(user?.displayName || user?.name || user?.fullName || user?.email || "Admin");
    const now = Date.now();
    const nextLessons = [
      {
        text: normalizedLessonText,
        name: normalizedLessonName,
        minimumRequired: normalizedMinimumRequired,
        questions: normalizedQuestions,
        createdAt: now,
        createdBy,
      },
      ...existingLessons,
    ];

    const draftSettings = draftCompSettings?.[compUserKey] || {};
    const fallbackUserLabel =
      normalizeValue(lessonModalEntry.userLabel)
      || normalizeValue(draftSettings.userLabel)
      || normalizeValue(savedSettings.userLabel)
      || compUserKey;

    setSavingLessonModal(true);
    try {
      await setDoc(
        doc(db, "churches", id, "payEveryoneUserSettings", normalizeValue(savedSettings.docId) || compUserKey),
        {
          userKey: compUserKey,
          userId: normalizeValue(draftSettings.userId || savedSettings.userId || lessonModalEntry.userId),
          userEmail: normalizeValue(draftSettings.userEmail || savedSettings.userEmail || lessonModalEntry.userEmail),
          userLabel: fallbackUserLabel,
          lessonsLearned: nextLessons,
          updatedAt: now,
        },
        { merge: true }
      );

      setLessonModalEntry(null);
      setLessonModalText("");
      setLessonName("");
      setLessonMinimumRequired("");
      setLessonQuestions([]);
      setLessonSupervisorPinInput("");
      setLessonSubmitPinError("");
    } catch (lessonError) {
      console.error("Error saving lesson learned note:", lessonError);
      window.alert("Could not save lesson learned note. Please try again.");
    } finally {
      setSavingLessonModal(false);
    }
  };

  const handleAutoAddLessonLearned = async (entry) => {
    if (!id) return;

    const autoKey = normalizeValue(entry?.autoKey);
    const lessonText = normalizeValue(entry?.lessonText);
    if (!autoKey || !lessonText) return;

    const compUserKey = resolveCompUserKey({
      userKey: entry?.userKey,
      userId: entry?.userId,
      userEmail: entry?.userEmail,
      userLabel: entry?.userLabel,
      savedSettingsMap: userCompSettings,
      draftSettingsMap: draftCompSettings,
    });

    if (!compUserKey) return;

    const savedSettings = userCompSettings?.[compUserKey] || {};
    const existingLessons = normalizeLessonsLearned(savedSettings.lessonsLearned);
    const alreadyExists = existingLessons.some((lesson) => normalizeValue(lesson.autoKey) === autoKey);
    if (alreadyExists) return;

    const now = Date.now();
    const nextLessons = [
      {
        text: lessonText,
        createdAt: now,
        createdBy: "System",
        source: normalizeValue(entry?.source) || "attendance-auto",
        autoKey,
      },
      ...existingLessons,
    ];

    const draftSettings = draftCompSettings?.[compUserKey] || {};
    const fallbackUserLabel =
      normalizeValue(entry?.userLabel)
      || normalizeValue(draftSettings.userLabel)
      || normalizeValue(savedSettings.userLabel)
      || compUserKey;

    try {
      await setDoc(
        doc(db, "churches", id, "payEveryoneUserSettings", normalizeValue(savedSettings.docId) || compUserKey),
        {
          userKey: compUserKey,
          userId: normalizeValue(draftSettings.userId || savedSettings.userId || entry?.userId),
          userEmail: normalizeValue(draftSettings.userEmail || savedSettings.userEmail || entry?.userEmail),
          userLabel: fallbackUserLabel,
          lessonsLearned: nextLessons,
          updatedAt: now,
        },
        { merge: true }
      );
    } catch (autoLessonError) {
      console.error("Error saving automatic lesson learned note:", autoLessonError);
    }
  };

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
          scheduleTimezone: normalizeScheduleTimezone(draft.scheduleTimezone),
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
          <Link to={getTabLink("time")} style={tabButtonStyle(activeTab === "time")}>
            Time and Cost
          </Link>
          <Link to={getTabLink("edit-time")} style={tabButtonStyle(activeTab === "edit-time")}>
            Edit Time Entries
          </Link>
          <Link to={getTabLink("comp")} style={tabButtonStyle(activeTab === "comp")}>
            User Compensation
          </Link>
          <Link to={getTabLink("hours")} style={tabButtonStyle(activeTab === "hours")}>
            Hours Tracker
          </Link>
          <Link to={getTabLink("weekly-hours")} style={tabButtonStyle(activeTab === "weekly-hours")}>
            Weekly Hours Owed
          </Link>
          <Link to={getTabLink("payments")} style={tabButtonStyle(activeTab === "payments")}>
            Payments
          </Link>
          <Link to={getTabLink("attendance")} style={tabButtonStyle(activeTab === "attendance")}>
            Attendance Tracker
          </Link>
          <Link to={getTabLink("lessons")} style={tabButtonStyle(activeTab === "lessons")}>
            Lessons Submitted
          </Link>
        </div>

        {activeTab === "hours" ? (
          <HoursTrackerTab
            combinedUsers={combinedUsers}
            rows={rows}
            dateFilterPreset={dateFilterPreset}
            setDateFilterPreset={setDateFilterPreset}
            customDateStart={customDateStart}
            customDateEnd={customDateEnd}
            setCustomDateStart={setCustomDateStart}
            setCustomDateEnd={setCustomDateEnd}
            userCompSettings={userCompSettings}
            draftCompSettings={draftCompSettings}
            resolveEffectiveCompEntry={resolveEffectiveCompEntry}
            getRangeForPreset={getRangeForPreset}
            DATE_FILTER_OPTIONS={DATE_FILTER_OPTIONS}
            formatHours={formatHours}
            toHours={toHours}
            parseNumber={parseNumber}
          />
        ) : activeTab === "edit-time" ? (
          <EditableTimeEntriesTab
            id={id}
            rows={rows}
            userOptions={userOptions}
            formatDateOnly={formatDateOnly}
            formatDuration={formatDuration}
            formatTimestamp={formatTimestamp}
          />
        ) : activeTab === "weekly-hours" ? (
          <WeeklyOwedHoursTab
            combinedUsers={combinedUsers}
            rows={rows}
            userCompSettings={userCompSettings}
            draftCompSettings={draftCompSettings}
            formatDateOnly={formatDateOnly}
          />
        ) : activeTab === "payments" ? (
          <PaymentsTab
            id={id}
            combinedUsers={combinedUsers}
            rows={rows}
            userCompSettings={userCompSettings}
            draftCompSettings={draftCompSettings}
            resolveEffectiveCompEntry={resolveEffectiveCompEntry}
            toCurrency={toCurrency}
            formatDateOnly={formatDateOnly}
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
            customDateStart={customDateStart}
            customDateEnd={customDateEnd}
            setCustomDateStart={setCustomDateStart}
            setCustomDateEnd={setCustomDateEnd}
            userCompSettings={userCompSettings}
            draftCompSettings={draftCompSettings}
            DATE_FILTER_OPTIONS={DATE_FILTER_OPTIONS}
            selectedUser={selectedUser}
            setSelectedUser={setSelectedUser}
            userOptions={userOptions}
            onAddLessonLearned={handleAddLessonLearned}
            onViewLessonsLearned={handleOpenLessonsViewModal}
            setReceiptSignatureViewer={setReceiptSignatureViewer}
          />
        ) : activeTab === "lessons" ? (
          <LessonsSubmittedTab
            lessonLimitConfig={lessonLimitConfig}
            setLessonLimitConfig={setLessonLimitConfig}
            onSaveLessonLimitConfig={handleSaveLessonLimitConfig}
            savingLessonLimitConfig={savingLessonLimitConfig}
            onDeleteLesson={handleDeleteSubmittedLesson}
            deletingLessonId={deletingLessonId}
            userCompSettings={userCompSettings}
            combinedUsers={combinedUsers}
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
            {dateFilterPreset === "custom" && (
              <div style={{ marginTop: "10px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <div>
                  <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={customDateStart}
                    onChange={(event) => setCustomDateStart(event.target.value)}
                    style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#334155", marginBottom: "4px" }}>
                    End Date
                  </label>
                  <input
                    type="date"
                    value={customDateEnd}
                    onChange={(event) => setCustomDateEnd(event.target.value)}
                    style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
                  />
                </div>
              </div>
            )}
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
          <div style={{ backgroundColor: filteredOpenTimers.length > 0 ? "#FFF7ED" : "#F8FAFC", border: `1px solid ${filteredOpenTimers.length > 0 ? "#FDBA74" : "#E2E8F0"}`, borderRadius: "10px", padding: "10px 12px" }}>
            <div style={{ color: "#64748B", fontSize: "0.8rem", fontWeight: 700 }}>Open Timers</div>
            <div style={{ color: filteredOpenTimers.length > 0 ? "#9A3412" : "#0F172A", fontWeight: 800, fontSize: "1.1rem" }}>{filteredOpenTimers.length}</div>
          </div>
          <div style={{ backgroundColor: usersNotStarted.length > 0 ? "#FEF2F2" : "#F8FAFC", border: `1px solid ${usersNotStarted.length > 0 ? "#FECACA" : "#E2E8F0"}`, borderRadius: "10px", padding: "10px 12px" }}>
            <div style={{ color: "#64748B", fontSize: "0.8rem", fontWeight: 700 }}>Users Not Started</div>
            <div style={{ color: usersNotStarted.length > 0 ? "#B91C1C" : "#0F172A", fontWeight: 800, fontSize: "1.1rem" }}>{usersNotStarted.length}</div>
          </div>
          <div style={{ display: "flex", alignItems: "stretch" }}>
            <button
              type="button"
              onClick={handleDeleteVisibleDuplicates}
              disabled={deletingDuplicateRows}
              style={{
                backgroundColor: "#7F1D1D",
                color: "#FFFFFF",
                border: "none",
                borderRadius: "10px",
                padding: "10px 12px",
                cursor: deletingDuplicateRows ? "not-allowed" : "pointer",
                fontWeight: 700,
                opacity: deletingDuplicateRows ? 0.7 : 1,
              }}
            >
              {deletingDuplicateRows ? "Deleting Duplicates..." : "Delete Duplicates (Visible)"}
            </button>
          </div>
        </div>

        {usersNotStarted.length > 0 && (
          <div style={{ marginTop: "12px", border: "1px solid #FECACA", backgroundColor: "#FEF2F2", borderRadius: "10px", padding: "10px 12px" }}>
            <div style={{ color: "#991B1B", fontWeight: 800, marginBottom: "6px" }}>Users who have not started</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {usersNotStarted.map((entry) => (
                <span key={entry.userKey} style={{ padding: "5px 9px", borderRadius: "999px", backgroundColor: "#FFFFFF", border: "1px solid #FECACA", color: "#7F1D1D", fontSize: "0.82rem", fontWeight: 700 }}>
                  {canonicalUserLabel(entry)}
                </span>
              ))}
            </div>
          </div>
        )}

        {filteredOpenTimers.length > 0 ? (
          <div style={{ marginTop: "12px", border: "1px solid #FDBA74", backgroundColor: "#FFF7ED", borderRadius: "10px", padding: "10px 12px" }}>
            <div style={{ color: "#9A3412", fontWeight: 800, marginBottom: "8px" }}>
              Open timers detected (not stopped yet)
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "820px", textAlign: "left" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "8px", borderBottom: "1px solid #FDBA74", color: "#7C2D12", fontSize: "0.8rem" }}>User</th>
                    <th style={{ textAlign: "left", padding: "8px", borderBottom: "1px solid #FDBA74", color: "#7C2D12", fontSize: "0.8rem" }}>Total Notes</th>
                    <th style={{ textAlign: "left", padding: "8px", borderBottom: "1px solid #FDBA74", color: "#7C2D12", fontSize: "0.8rem" }}>Card ID</th>
                    <th style={{ textAlign: "left", padding: "8px", borderBottom: "1px solid #FDBA74", color: "#7C2D12", fontSize: "0.8rem" }}>Project</th>
                    <th style={{ textAlign: "left", padding: "8px", borderBottom: "1px solid #FDBA74", color: "#7C2D12", fontSize: "0.8rem" }}>Started</th>
                    <th style={{ textAlign: "left", padding: "8px", borderBottom: "1px solid #FDBA74", color: "#7C2D12", fontSize: "0.8rem" }}>Open For</th>
                    <th style={{ textAlign: "left", padding: "8px", borderBottom: "1px solid #FDBA74", color: "#7C2D12", fontSize: "0.8rem" }}>Status</th>
                    <th style={{ textAlign: "left", padding: "8px", borderBottom: "1px solid #FDBA74", color: "#7C2D12", fontSize: "0.8rem" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOpenTimers.map((entry) => (
                    <tr key={`open-timer-${entry.id}`}>
                      <td style={{ padding: "8px", borderBottom: "1px solid #FED7AA", color: "#7C2D12", fontWeight: 700 }}>{canonicalUserLabel(entry)}</td>
                      <td style={{ padding: "8px", borderBottom: "1px solid #FED7AA", color: "#7C2D12", fontWeight: 700 }}>{getOpenTimerTotalNotes(entry)}</td>
                      <td style={{ padding: "8px", borderBottom: "1px solid #FED7AA", color: "#7C2D12" }}>{entry.issueId || "-"}</td>
                      <td style={{ padding: "8px", borderBottom: "1px solid #FED7AA", color: "#7C2D12" }}>{entry.projectName || "-"}</td>
                      <td style={{ padding: "8px", borderBottom: "1px solid #FED7AA", color: "#7C2D12" }}>{formatTimestamp(entry.startedAt)}</td>
                      <td style={{ padding: "8px", borderBottom: "1px solid #FED7AA", color: "#7C2D12", fontWeight: 700 }}>{formatDuration(Math.max(0, Date.now() - (Number(entry.startedAt) || 0)))}</td>
                      <td style={{ padding: "8px", borderBottom: "1px solid #FED7AA" }}>
                        <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: "999px", backgroundColor: "#DC2626", color: "#FFFFFF", fontSize: "0.74rem", fontWeight: 700 }}>
                          OPEN
                        </span>
                      </td>
                      <td style={{ padding: "8px", borderBottom: "1px solid #FED7AA" }}>
                        <button
                          type="button"
                          onClick={() => handleStopActiveTimer(entry)}
                          disabled={stoppingActiveTimerId === entry.id}
                          style={{
                            backgroundColor: "#0F766E",
                            color: "#FFFFFF",
                            border: "none",
                            borderRadius: "8px",
                            padding: "6px 10px",
                            cursor: stoppingActiveTimerId === entry.id ? "not-allowed" : "pointer",
                            fontWeight: 700,
                            opacity: stoppingActiveTimerId === entry.id ? 0.7 : 1,
                          }}
                        >
                          {stoppingActiveTimerId === entry.id ? "Stopping..." : "Stop Timer"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {duplicateActionMessage ? (
          <div
            style={{
              marginTop: "10px",
              border: "1px solid #86EFAC",
              backgroundColor: "#ECFDF5",
              color: "#166534",
              borderRadius: "10px",
              padding: "10px 12px",
              fontWeight: 600,
            }}
          >
            {duplicateActionMessage}
          </div>
        ) : null}

        {timeDeleteError ? (
          <div
            style={{
              marginTop: "10px",
              border: "1px solid #FCA5A5",
              backgroundColor: "#FEF2F2",
              color: "#B91C1C",
              borderRadius: "10px",
              padding: "10px 12px",
              fontWeight: 600,
            }}
          >
            {timeDeleteError}
          </div>
        ) : null}

        <div style={{ marginLeft: "-16px", marginRight: "-16px", marginTop: "14px", overflowX: "auto", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ backgroundColor: "#F8FAFC" }}>
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Line Item</th>
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Entry ID</th>
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Card ID</th>
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Project Name</th>
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>User</th>
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Total Notes</th>
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Total Time</th>
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Hourly Rate</th>
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Cost</th>
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Start Time</th>
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>End Time</th>
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #E2E8F0" }}>Actions</th>
              </tr>
            </thead>
            <tbody key={`report-body-${selectedUser}-${selectedProject}-${dateFilterPreset}`}>
              {loading ? (
                <tr>
                  <td colSpan={12} style={{ padding: "14px", color: "#64748B" }}>
                    Loading line items...
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={12} style={{ padding: "14px", color: "#64748B" }}>
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
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #C7D2FE", backgroundColor: "#EEF2FF", color: "#3730A3", fontWeight: 700, fontSize: "0.82rem" }}>-</td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #C7D2FE", backgroundColor: "#EEF2FF", color: "#3730A3", fontWeight: 700, fontSize: "0.82rem" }}>
                            {formatDateOnly(entry.startMs)} - {formatDateOnly(addDays(entry.startMs, 6).getTime())}
                          </td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #C7D2FE", backgroundColor: "#EEF2FF" }} />
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #C7D2FE", backgroundColor: "#EEF2FF", color: "#3730A3", fontWeight: 700, fontSize: "0.82rem" }}>{entry.userLabel}</td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #C7D2FE", backgroundColor: "#EEF2FF", color: "#3730A3", fontWeight: 700, fontSize: "0.82rem" }}>{entry.totalNotes}</td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #C7D2FE", backgroundColor: "#EEF2FF", color: "#3730A3", fontWeight: 700, fontSize: "0.82rem" }}>{formatHours(entry.durationMs)}</td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #C7D2FE", backgroundColor: "#EEF2FF", color: "#3730A3", fontWeight: 700, fontSize: "0.82rem" }}>-</td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #C7D2FE", backgroundColor: "#EEF2FF", color: "#3730A3", fontWeight: 700, fontSize: "0.82rem" }}>{toCurrency(entry.totalCost)}</td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #C7D2FE", backgroundColor: "#EEF2FF" }} />
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #C7D2FE", backgroundColor: "#EEF2FF" }} />
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #C7D2FE", backgroundColor: "#EEF2FF" }} />
                        </tr>
                        <tr aria-hidden="true">
                          <td colSpan={12} style={{ height: "38px", padding: "10px 0", backgroundColor: "#F1F5F9", borderTop: "1px solid #E2E8F0", borderBottom: "2px solid #CBD5E1" }}>&nbsp;</td>
                        </tr>
                      </React.Fragment>
                    );
                  }

                  if (entry.type === "weekHeader") {
                    return (
                      <tr key={`week-header-${entry.key}`}>
                        <td style={{ padding: "10px", borderBottom: "1px solid #BFDBFE", borderTop: "2px solid #60A5FA", backgroundColor: "#EFF6FF", color: "#1E3A8A", fontWeight: 800, fontSize: "0.88rem" }}>Week Start</td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #BFDBFE", borderTop: "2px solid #60A5FA", backgroundColor: "#EFF6FF" }} />
                        <td style={{ padding: "10px", borderBottom: "1px solid #BFDBFE", borderTop: "2px solid #60A5FA", backgroundColor: "#EFF6FF" }} />
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
                        <td style={{ padding: "10px", borderBottom: "1px solid #BFDBFE", borderTop: "2px solid #60A5FA", backgroundColor: "#EFF6FF" }} />
                      </tr>
                    );
                  }

                  if (entry.type === "daySubtotal") {
                    return (
                      <React.Fragment key={`day-subtotal-frag-${entry.key}`}>
                        <tr>
                          <td style={{ padding: "12px 12px", borderTop: "2px solid #86EFAC", borderBottom: "2px solid #34D399", backgroundColor: "#ECFDF5", color: "#065F46", fontWeight: 800, fontSize: "0.83rem" }}>Daily Subtotal</td>
                          <td style={{ padding: "12px 12px", borderTop: "2px solid #86EFAC", borderBottom: "2px solid #34D399", backgroundColor: "#ECFDF5", color: "#065F46", fontWeight: 800, fontSize: "0.83rem" }}>-</td>
                          <td style={{ padding: "12px 12px", borderTop: "2px solid #86EFAC", borderBottom: "2px solid #34D399", backgroundColor: "#ECFDF5", color: "#065F46", fontWeight: 800, fontSize: "0.83rem" }}>{formatDateOnly(entry.startMs)}</td>
                          <td style={{ padding: "12px 12px", borderTop: "2px solid #86EFAC", borderBottom: "2px solid #34D399", backgroundColor: "#ECFDF5" }} />
                          <td style={{ padding: "12px 12px", borderTop: "2px solid #86EFAC", borderBottom: "2px solid #34D399", backgroundColor: "#ECFDF5", color: "#065F46", fontWeight: 800, fontSize: "0.83rem" }}>{entry.userLabel}</td>
                          <td style={{ padding: "12px 12px", borderTop: "2px solid #86EFAC", borderBottom: "2px solid #34D399", backgroundColor: "#ECFDF5", color: "#065F46", fontWeight: 800, fontSize: "0.83rem" }}>{entry.totalNotes}</td>
                          <td style={{ padding: "12px 12px", borderTop: "2px solid #86EFAC", borderBottom: "2px solid #34D399", backgroundColor: "#ECFDF5", color: "#065F46", fontWeight: 800, fontSize: "0.83rem" }}>{formatHours(entry.durationMs)}</td>
                          <td style={{ padding: "12px 12px", borderTop: "2px solid #86EFAC", borderBottom: "2px solid #34D399", backgroundColor: "#ECFDF5", color: "#065F46", fontWeight: 800, fontSize: "0.83rem" }}>-</td>
                          <td style={{ padding: "12px 12px", borderTop: "2px solid #86EFAC", borderBottom: "2px solid #34D399", backgroundColor: "#ECFDF5", color: "#065F46", fontWeight: 800, fontSize: "0.83rem" }}>{toCurrency(entry.totalCost)}</td>
                          <td style={{ padding: "12px 12px", borderTop: "2px solid #86EFAC", borderBottom: "2px solid #34D399", backgroundColor: "#ECFDF5" }} />
                          <td style={{ padding: "12px 12px", borderTop: "2px solid #86EFAC", borderBottom: "2px solid #34D399", backgroundColor: "#ECFDF5" }} />
                          <td style={{ padding: "12px 12px", borderTop: "2px solid #86EFAC", borderBottom: "2px solid #34D399", backgroundColor: "#ECFDF5" }} />
                        </tr>
                        <tr aria-hidden="true">
                          <td colSpan={11} style={{ height: "14px", padding: "7px 0", backgroundColor: "#F1F5F9", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0" }}>&nbsp;</td>
                        </tr>
                      </React.Fragment>
                    );
                  }

                  if (entry.type === "dayHeader") {
                    return (
                      <tr key={`day-header-${entry.key}`}>
                        <td style={{ padding: "9px 10px", borderBottom: "1px solid #FDE68A", borderTop: "1px solid #FCD34D", backgroundColor: "#FFFBEB", color: "#92400E", fontWeight: 800, fontSize: "0.84rem" }}>Day Start</td>
                        <td style={{ padding: "9px 10px", borderBottom: "1px solid #FDE68A", borderTop: "1px solid #FCD34D", backgroundColor: "#FFFBEB" }} />
                        <td style={{ padding: "9px 10px", borderBottom: "1px solid #FDE68A", borderTop: "1px solid #FCD34D", backgroundColor: "#FFFBEB", color: "#92400E", fontWeight: 800, fontSize: "0.84rem" }}>{formatDateOnly(entry.startMs)}</td>
                        <td style={{ padding: "9px 10px", borderBottom: "1px solid #FDE68A", borderTop: "1px solid #FCD34D", backgroundColor: "#FFFBEB" }} />
                        <td style={{ padding: "9px 10px", borderBottom: "1px solid #FDE68A", borderTop: "1px solid #FCD34D", backgroundColor: "#FFFBEB", color: "#92400E", fontWeight: 800, fontSize: "0.84rem" }}>{entry.userLabel} • Items: {entry.lineItems}</td>
                        <td style={{ padding: "9px 10px", borderBottom: "1px solid #FDE68A", borderTop: "1px solid #FCD34D", backgroundColor: "#FFFBEB" }} />
                        <td style={{ padding: "9px 10px", borderBottom: "1px solid #FDE68A", borderTop: "1px solid #FCD34D", backgroundColor: "#FFFBEB" }} />
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
                  const hasAdminComplianceStop = Boolean(row.stoppedByLabel)
                    || (Array.isArray(row.notesList)
                      && row.notesList.some((noteText) => normalizeValue(noteText).toLowerCase().includes("stopped by admin for leaving without complying with timesheet")));
                  return (
                    <tr
                      key={row.id}
                      style={hasAdminComplianceStop ? { backgroundColor: "#FEF2F2" } : undefined}
                    >
                      <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>{entry.lineItemIndex}</td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#666666", fontSize: "0.78rem", fontFamily: "monospace" }}>{row.id}</td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#0F172A", fontWeight: 700 }}>
                        {row.issueId || "-"}
                      </td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>{row.projectName || "-"}</td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          <span>{row.userLabel}</span>
                          {row.stoppedByLabel ? (
                            <span style={{ fontSize: "0.72rem", color: "#7C2D12", fontWeight: 700 }}>
                              Stopped by: {row.stoppedByLabel}
                            </span>
                          ) : null}
                          {hasAdminComplianceStop ? (
                            <span
                              style={{
                                alignSelf: "flex-start",
                                padding: "2px 8px",
                                borderRadius: "999px",
                                border: "1px solid #FCA5A5",
                                backgroundColor: "#FEE2E2",
                                color: "#991B1B",
                                fontSize: "0.72rem",
                                fontWeight: 800,
                              }}
                            >
                              Needs Correction
                            </span>
                          ) : null}
                          {Array.isArray(row.notesList) && row.notesList.length > 0 ? (
                            <button
                              type="button"
                              onClick={() => handleOpenNotesModal(row)}
                              style={{
                                alignSelf: "flex-start",
                                padding: "2px 7px",
                                borderRadius: "999px",
                                border: "1px solid #BFDBFE",
                                backgroundColor: "#EFF6FF",
                                color: "#1D4ED8",
                                fontSize: "0.72rem",
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              Notes ({row.notesList.length})
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", color: "#334155", fontWeight: 700 }}>
                        {Array.isArray(row.notesList) ? row.notesList.length : 0}
                      </td>
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
                      <td style={{ padding: "10px", borderBottom: "1px solid #F1F5F9", display: "flex", gap: "6px", flexWrap: "wrap" }}>
                        {!row.notesSummary ? (
                          <button
                            type="button"
                            onClick={() => handleNotifyMissingNotes(row)}
                            style={{
                              backgroundColor: "#1D4ED8",
                              color: "#FFFFFF",
                              border: "none",
                              borderRadius: "8px",
                              padding: "7px 10px",
                              cursor: "pointer",
                              fontWeight: 700,
                            }}
                            title="Open Teams chat and copy a reminder message"
                          >
                            Notify in Teams
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => handleDeleteTimeLog(row)}
                          disabled={deletingTimeRowId === row.id}
                          style={{
                            backgroundColor: "#DC2626",
                            color: "#FFFFFF",
                            border: "none",
                            borderRadius: "8px",
                            padding: "7px 10px",
                            cursor: deletingTimeRowId === row.id ? "not-allowed" : "pointer",
                            fontWeight: 700,
                            opacity: deletingTimeRowId === row.id ? 0.7 : 1,
                          }}
                        >
                          {deletingTimeRowId === row.id ? "Deleting..." : "Delete"}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {notesModalEntry ? (
          <div
            role="dialog"
            aria-modal="true"
            onClick={handleCloseNotesModal}
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(15, 23, 42, 0.45)",
              zIndex: 1000,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "16px",
            }}
          >
            <div
              onClick={(event) => event.stopPropagation()}
              style={{
                width: "min(700px, 100%)",
                maxHeight: "80vh",
                overflowY: "auto",
                backgroundColor: "#FFFFFF",
                borderRadius: "14px",
                border: "1px solid #E2E8F0",
                boxShadow: "0 20px 50px rgba(15, 23, 42, 0.2)",
                padding: "16px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
                <div>
                  <div style={{ color: "#0F172A", fontWeight: 800, fontSize: "1rem" }}>Entry Notes</div>
                  <div style={{ color: "#475569", fontSize: "0.86rem" }}>
                    User: {notesModalEntry.userLabel} | Card: {notesModalEntry.issueId} | Entry ID: {notesModalEntry.id}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCloseNotesModal}
                  style={{
                    border: "1px solid #CBD5E1",
                    backgroundColor: "#FFFFFF",
                    borderRadius: "8px",
                    padding: "7px 10px",
                    color: "#334155",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Close
                </button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {notesModalEntry.notesList.map((noteText, noteIndex) => (
                  <div
                    key={`${notesModalEntry.id}-modal-note-${noteIndex}`}
                    style={{
                      border: "1px solid #E2E8F0",
                      borderRadius: "10px",
                      padding: "10px 12px",
                      backgroundColor: "#F8FAFC",
                      color: "#1E293B",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    <div style={{ color: "#64748B", fontSize: "0.78rem", fontWeight: 700, marginBottom: "4px" }}>Note {noteIndex + 1}</div>
                    <div>{noteText}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
          </>
        ) : (
          <div style={{ marginTop: "12px", overflowX: "auto", border: "1px solid #E2E8F0", borderRadius: "12px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "1200px", textAlign: "left" }}>
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
                    const scheduleTimezone = normalizeScheduleTimezone(draft.scheduleTimezone);
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
                                      "America/Guatemala",
                                      "America/Costa_Rica",
                                      "America/El_Salvador",
                                      "America/Tegucigalpa",
                                      "America/Managua",
                                      "America/Panama",
                                      "America/Belize",
                                      "America/Puerto_Rico",
                                      "America/Bogota",
                                      "America/La_Paz",
                                      "America/Guayaquil",
                                      "America/Lima",
                                      "America/Caracas",
                                      "America/Asuncion",
                                      "America/Montevideo",
                                      "America/Guyana",
                                      "America/Paramaribo",
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
                                      <option key={tz} value={tz}>
                                        {`${tz.replace(/_/g, " ")}${[
                                          "America/Guatemala",
                                          "America/Costa_Rica",
                                          "America/El_Salvador",
                                          "America/Tegucigalpa",
                                          "America/Managua",
                                          "America/Panama",
                                          "America/Belize",
                                        ].includes(tz) ? " (Central America)" : ""}`}
                                      </option>
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

        {lessonModalEntry ? (
          <div
            role="dialog"
            aria-modal="true"
            onClick={handleCloseLessonModal}
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(15, 23, 42, 0.45)",
              zIndex: 1001,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "16px",
            }}
          >
            <div
              onClick={(event) => event.stopPropagation()}
              style={{
                width: "min(560px, 100%)",
                backgroundColor: "#FFFFFF",
                borderRadius: "14px",
                border: "1px solid #E2E8F0",
                boxShadow: "0 20px 50px rgba(15, 23, 42, 0.2)",
                padding: "16px",
              }}
            >
              <div style={{ marginBottom: "12px" }}>
                <div style={{ color: "#0F172A", fontWeight: 800, fontSize: "1rem" }}>Add Lesson Learned</div>
                <div style={{ color: "#475569", fontSize: "0.86rem" }}>
                  User: {lessonModalEntry.userLabel}
                </div>
              </div>

              {/* Lesson Name Block - styled like performance blocks */}
              <div style={{ backgroundColor: "#FEF2F2", borderRadius: "12px", padding: "16px", border: "2px solid #FCA5A5", marginBottom: "12px" }}>
                <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#64748B", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Lesson Name</div>
                <input
                  type="text"
                  value={lessonName}
                  onChange={(event) => setLessonName(event.target.value)}
                  placeholder="e.g., Punctuality, Communication, Focus"
                  style={{
                    width: "100%",
                    borderRadius: "10px",
                    border: "1px solid #F87171",
                    padding: "12px 14px",
                    fontFamily: "inherit",
                    fontSize: "1.05rem",
                    fontWeight: 800,
                    color: "#991B1B",
                    backgroundColor: "#FFFFFF",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              {/* Minimum Required Block - styled like performance blocks */}
              <div style={{ backgroundColor: "#FEF2F2", borderRadius: "12px", padding: "16px", border: "2px solid #FCA5A5", marginBottom: "12px" }}>
                <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#64748B", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Minimum Required</div>
                <input
                  type="text"
                  value={lessonMinimumRequired}
                  onChange={(event) => setLessonMinimumRequired(event.target.value)}
                  placeholder="e.g., Start on time, 8 notes per shift, Be proactive"
                  style={{
                    width: "100%",
                    borderRadius: "10px",
                    border: "1px solid #F87171",
                    padding: "12px 14px",
                    fontFamily: "inherit",
                    fontSize: "1.05rem",
                    fontWeight: 800,
                    color: "#991B1B",
                    backgroundColor: "#FFFFFF",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <textarea
                value={lessonModalText}
                onChange={(event) => setLessonModalText(event.target.value)}
                placeholder="Type the lesson learned note..."
                style={{
                  width: "100%",
                  minHeight: "120px",
                  borderRadius: "10px",
                  border: "1px solid #CBD5E1",
                  padding: "10px 12px",
                  resize: "vertical",
                  fontFamily: "inherit",
                  fontSize: "0.9rem",
                  color: "#0F172A",
                  marginBottom: "10px",
                }}
              />

              <div style={{ marginTop: "10px", border: "1px solid #E2E8F0", borderRadius: "10px", padding: "10px", backgroundColor: "#F8FAFC" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <div style={{ color: "#334155", fontWeight: 800, fontSize: "0.84rem" }}>Lesson Questions (Knowledge Check)</div>
                  <button
                    type="button"
                    onClick={() => {
                      setLessonQuestions((current) => [
                        ...current,
                        { question: "", answer: "", options: ["Yes", "No"] },
                      ]);
                    }}
                    style={{ border: "1px solid #BFDBFE", backgroundColor: "#EFF6FF", color: "#1D4ED8", borderRadius: "8px", padding: "5px 9px", fontWeight: 700, cursor: "pointer", fontSize: "0.75rem" }}
                  >
                    + Add Question
                  </button>
                </div>

                {lessonQuestions.length === 0 ? (
                  <div style={{ color: "#64748B", fontSize: "0.78rem" }}>
                    No questions yet. Add questions if this lesson should require correct answers in TimeRotate.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {lessonQuestions.map((entry, index) => {
                      const options = entry?.options || ["Yes", "No"];
                      return (
                        <div key={`lesson-question-${index}`} style={{ border: "1px solid #E2E8F0", borderRadius: "8px", padding: "10px", backgroundColor: "#FFFFFF" }}>
                          <div style={{ color: "#64748B", fontSize: "0.74rem", fontWeight: 700, marginBottom: "6px" }}>Question {index + 1}</div>
                          <textarea
                            value={entry?.question || ""}
                            onChange={(event) => {
                              const nextValue = event.target.value;
                              setLessonQuestions((current) => current.map((item, itemIndex) => (
                                itemIndex === index ? { ...item, question: nextValue } : item
                              )));
                            }}
                            placeholder="Question (supports spaces and multiple lines)"
                            style={{ width: "100%", padding: "8px 10px", border: "1px solid #CBD5E1", borderRadius: "8px", marginBottom: "8px", minHeight: "60px", fontFamily: "inherit" }}
                          />
                          <div style={{ display: "grid", gap: "8px", marginBottom: "8px", padding: "8px", backgroundColor: "#F8FAFC", borderRadius: "8px", border: "1px solid #E2E8F0" }}>
                            <div style={{ color: "#64748B", fontSize: "0.73rem", fontWeight: 700 }}>Answer Options</div>
                            {options.map((opt, optIndex) => (
                              <div key={`option-${index}-${optIndex}`} style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                                <input
                                  type="text"
                                  value={opt || ""}
                                  onChange={(event) => {
                                    const nextValue = event.target.value;
                                    setLessonQuestions((current) => current.map((item, itemIndex) => {
                                      if (itemIndex === index) {
                                        const newOptions = [...(item.options || ["Yes", "No"])];
                                        newOptions[optIndex] = nextValue;
                                        return { ...item, options: newOptions };
                                      }
                                      return item;
                                    }));
                                  }}
                                  placeholder={`Option ${optIndex + 1}`}
                                  style={{ flex: 1, padding: "6px 8px", border: "1px solid #CBD5E1", borderRadius: "6px", fontSize: "0.85rem" }}
                                />
                                {options.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setLessonQuestions((current) => current.map((item, itemIndex) => {
                                        if (itemIndex === index) {
                                          const newOptions = (item.options || ["Yes", "No"]).filter((_, oi) => oi !== optIndex);
                                          return { ...item, options: newOptions };
                                        }
                                        return item;
                                      }));
                                    }}
                                    style={{ border: "1px solid #FCA5A5", backgroundColor: "#FEF2F2", color: "#991B1B", borderRadius: "6px", padding: "4px 8px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}
                                  >
                                    ✕
                                  </button>
                                )}
                              </div>
                            ))}
                            <button
                              type="button"
                              onClick={() => {
                                setLessonQuestions((current) => current.map((item, itemIndex) => {
                                  if (itemIndex === index) {
                                    return { ...item, options: [...(item.options || ["Yes", "No"]), ""] };
                                  }
                                  return item;
                                }));
                              }}
                              style={{ border: "1px solid #BFDBFE", backgroundColor: "#EFF6FF", color: "#1D4ED8", borderRadius: "6px", padding: "4px 8px", fontWeight: 700, cursor: "pointer", fontSize: "0.75rem" }}
                            >
                              + Add Option
                            </button>
                          </div>
                          <div style={{ display: "flex", gap: "8px" }}>
                            <select
                              value={entry?.answer || ""}
                              onChange={(event) => {
                                const nextValue = event.target.value;
                                setLessonQuestions((current) => current.map((item, itemIndex) => (
                                  itemIndex === index ? { ...item, answer: nextValue } : item
                                )));
                              }}
                              style={{ flex: 1, padding: "8px 10px", border: "1px solid #CBD5E1", borderRadius: "8px" }}
                            >
                              <option value="">-- select correct answer --</option>
                              {options.map((opt, optIndex) => (
                                <option key={`answer-option-${index}-${optIndex}`} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => {
                                setLessonQuestions((current) => current.filter((_, itemIndex) => itemIndex !== index));
                              }}
                              style={{ border: "1px solid #DC2626", backgroundColor: "#FFFFFF", color: "#B91C1C", borderRadius: "8px", padding: "6px 10px", fontWeight: 700, cursor: "pointer" }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {lessonSuggestions.length > 0 ? (
                <div style={{ marginTop: "10px" }}>
                  <div style={{ color: "#475569", fontSize: "0.78rem", fontWeight: 700, marginBottom: "6px" }}>
                    Suggested Lessons
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {lessonSuggestions.map((suggestion, suggestionIndex) => (
                      <button
                        key={`lesson-suggestion-${suggestionIndex}`}
                        type="button"
                        onClick={() => setLessonModalText(`${suggestion.title}: ${suggestion.text}`)}
                        style={{
                          border: "1px solid #BFDBFE",
                          backgroundColor: "#EFF6FF",
                          color: "#1D4ED8",
                          borderRadius: "999px",
                          padding: "4px 10px",
                          fontWeight: 700,
                          cursor: "pointer",
                          fontSize: "0.75rem",
                        }}
                        title={suggestion.text}
                      >
                        {suggestion.title}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {reusableLessonOptions.length > 0 ? (
                <div style={{ marginTop: "10px" }}>
                  <div style={{ color: "#475569", fontSize: "0.78rem", fontWeight: 700, marginBottom: "6px" }}>
                    Reuse Existing Lesson
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "180px", overflowY: "auto", paddingRight: "2px" }}>
                    {reusableLessonOptions.map((reusableLesson) => (
                      <button
                        key={`reusable-lesson-${reusableLesson.id}`}
                        type="button"
                        onClick={() => {
                          setLessonName(normalizeValue(reusableLesson.name));
                          setLessonMinimumRequired(normalizeValue(reusableLesson.minimumRequired));
                          setLessonModalText(normalizeValue(reusableLesson.text));
                          setLessonQuestions(normalizeLessonQuestions(reusableLesson.questions));
                        }}
                        style={{
                          textAlign: "left",
                          border: "1px solid #DBEAFE",
                          backgroundColor: "#EFF6FF",
                          color: "#1E3A8A",
                          borderRadius: "8px",
                          padding: "8px 10px",
                          fontWeight: 700,
                          cursor: "pointer",
                          fontSize: "0.76rem",
                        }}
                        title={reusableLesson.text}
                      >
                        <div style={{ fontWeight: 800, color: "#1D4ED8" }}>
                          {reusableLesson.name || "Lesson"}
                        </div>
                        {reusableLesson.minimumRequired ? (
                          <div style={{ fontWeight: 700, color: "#334155", marginTop: "2px" }}>
                            Minimum: {reusableLesson.minimumRequired}
                          </div>
                        ) : null}
                        <div style={{ color: "#1E293B", marginTop: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {reusableLesson.text}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {lessonSubmissionLimitStatus.shouldRequirePin ? (
                <div style={{ marginTop: "12px", backgroundColor: "#FEF2F2", border: "2px solid #FCA5A5", borderRadius: "12px", padding: "12px" }}>
                  <div style={{ color: "#991B1B", fontWeight: 800, marginBottom: "4px" }}>
                      Lesson Limit Exceeded: Supervisor PIN Required
                  </div>
                  <div style={{ color: "#7F1D1D", fontSize: "0.84rem", marginBottom: "8px" }}>
                    This user already reached {lessonSubmissionLimitStatus.currentCount} submission{lessonSubmissionLimitStatus.currentCount === 1 ? "" : "s"} for lesson "{normalizeValue(lessonName)}" in this {lessonSubmissionLimitStatus.period} (allowed: {lessonSubmissionLimitStatus.maxCount} per lesson).
                    Enter supervisor PIN to continue.
                  </div>
                  <input
                    type="password"
                    value={lessonSupervisorPinInput}
                    onChange={(event) => {
                      setLessonSupervisorPinInput(event.target.value);
                      if (lessonSubmitPinError) setLessonSubmitPinError("");
                    }}
                    placeholder="Supervisor PIN"
                    style={{
                      width: "100%",
                      borderRadius: "10px",
                      border: "1px solid #F87171",
                      padding: "10px 12px",
                      fontFamily: "inherit",
                      fontSize: "0.92rem",
                      color: "#0F172A",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              ) : null}

              {lessonSubmitPinError ? (
                <div style={{ marginTop: "10px", color: "#B91C1C", backgroundColor: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: "8px", padding: "8px 10px", fontWeight: 700, fontSize: "0.82rem" }}>
                  {lessonSubmitPinError}
                </div>
              ) : null}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "12px" }}>
                <button
                  type="button"
                  onClick={handleCloseLessonModal}
                  disabled={savingLessonModal}
                  style={{
                    border: "1px solid #CBD5E1",
                    backgroundColor: "#FFFFFF",
                    borderRadius: "8px",
                    padding: "7px 10px",
                    color: "#334155",
                    fontWeight: 700,
                    cursor: savingLessonModal ? "not-allowed" : "pointer",
                    opacity: savingLessonModal ? 0.7 : 1,
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmitLessonLearned}
                  disabled={savingLessonModal}
                  style={{
                    border: "none",
                    backgroundColor: "#1D4ED8",
                    borderRadius: "8px",
                    padding: "7px 12px",
                    color: "#FFFFFF",
                    fontWeight: 700,
                    cursor: savingLessonModal ? "not-allowed" : "pointer",
                    opacity: savingLessonModal ? 0.7 : 1,
                  }}
                >
                  {savingLessonModal ? "Saving..." : "Save Lesson"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {lessonViewModalEntry ? (
          <div
            role="dialog"
            aria-modal="true"
            onClick={handleCloseLessonsViewModal}
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(15, 23, 42, 0.45)",
              zIndex: 1002,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "16px",
            }}
          >
            <div
              onClick={(event) => event.stopPropagation()}
              style={{
                width: "min(700px, 100%)",
                maxHeight: "80vh",
                overflowY: "auto",
                backgroundColor: "#FFFFFF",
                borderRadius: "14px",
                border: "1px solid #E2E8F0",
                boxShadow: "0 20px 50px rgba(15, 23, 42, 0.2)",
                padding: "16px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
                <div>
                  <div style={{ color: "#0F172A", fontWeight: 800, fontSize: "1rem" }}>Lessons Learned</div>
                  <div style={{ color: "#475569", fontSize: "0.86rem" }}>
                    User: {lessonViewModalEntry.userLabel}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCloseLessonsViewModal}
                  style={{
                    border: "1px solid #CBD5E1",
                    backgroundColor: "#FFFFFF",
                    borderRadius: "8px",
                    padding: "7px 10px",
                    color: "#334155",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Close
                </button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {Array.isArray(lessonViewModalEntry.lessonsLearned) && lessonViewModalEntry.lessonsLearned.length > 0 ? (
                  lessonViewModalEntry.lessonsLearned.map((lesson, lessonIndex) => (
                    <div
                      key={`lesson-view-${lessonIndex}-${normalizeValue(lesson?.createdAt)}`}
                      style={{
                        border: "1px solid #E2E8F0",
                        borderRadius: "10px",
                        padding: "10px 12px",
                        backgroundColor: "#F8FAFC",
                        color: "#1E293B",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      <div style={{ color: "#64748B", fontSize: "0.78rem", fontWeight: 700, marginBottom: "4px" }}>
                        Lesson {lessonIndex + 1}{normalizeValue(lesson?.createdBy) ? ` · ${normalizeValue(lesson.createdBy)}` : ""}
                      </div>
                      <div>{normalizeValue(lesson?.text) || "-"}</div>
                    </div>
                  ))
                ) : (
                  <div style={{ color: "#64748B", fontSize: "0.9rem" }}>No lessons learned submitted yet.</div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {receiptSignatureViewer ? (
          <div
            role="dialog"
            aria-modal="true"
            onClick={() => setReceiptSignatureViewer(null)}
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(15, 23, 42, 0.45)",
              zIndex: 1003,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "16px",
            }}
          >
            <div
              onClick={(event) => event.stopPropagation()}
              style={{
                width: "min(600px, 100%)",
                backgroundColor: "#FFFFFF",
                borderRadius: "14px",
                border: "1px solid #E2E8F0",
                boxShadow: "0 20px 50px rgba(15, 23, 42, 0.2)",
                padding: "20px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
                <div>
                  <div style={{ color: "#0F172A", fontWeight: 800, fontSize: "1rem" }}>Lesson Acknowledgement Receipt</div>
                  <div style={{ color: "#475569", fontSize: "0.86rem", marginTop: "2px" }}>
                    Signed by: {normalizeValue(receiptSignatureViewer.acknowledgedByName) || "Signed"}
                  </div>
                  <div style={{ color: "#64748B", fontSize: "0.78rem", marginTop: "2px" }}>
                    {formatTimestamp(receiptSignatureViewer.acknowledgedAt)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setReceiptSignatureViewer(null)}
                  style={{
                    border: "1px solid #CBD5E1",
                    backgroundColor: "#FFFFFF",
                    borderRadius: "8px",
                    padding: "7px 10px",
                    color: "#334155",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontSize: "0.9rem",
                  }}
                >
                  Close
                </button>
              </div>

              {receiptSignatureViewer.signature ? (
                <div style={{ border: "1px solid #E2E8F0", borderRadius: "10px", padding: "12px", backgroundColor: "#F8FAFC", overflow: "auto", maxHeight: "400px" }}>
                  <img
                    src={receiptSignatureViewer.signature}
                    alt="Drawn signature"
                    style={{
                      maxWidth: "100%",
                      height: "auto",
                      display: "block",
                    }}
                  />
                </div>
              ) : (
                <div style={{ color: "#64748B", fontSize: "0.9rem", padding: "16px", backgroundColor: "#F8FAFC", borderRadius: "10px", textAlign: "center" }}>
                  No signature image available
                </div>
              )}

              {receiptSignatureViewer.lessonText ? (
                <div style={{ marginTop: "14px", padding: "12px", backgroundColor: "#FEF2F2", borderRadius: "10px", border: "1px solid #FCA5A5" }}>
                  <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748B", marginBottom: "6px" }}>Acknowledged Lesson</div>
                  <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "#991B1B", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {normalizeValue(receiptSignatureViewer.lessonText)}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default PayEveryone;
