import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { addDoc, collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import commonStyles from "../pages/commonStyles";
import { useAuth } from "../contexts/AuthContext";
import TimeRotateTopLogo from "./TimeRotateTopLogo";

const normalizeValue = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const normalizeTagValue = (value) => normalizeValue(value).replace(/\s+/g, " ");

const parseTagsFromValue = (value) => {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => normalizeTagValue(item)).filter(Boolean)));
  }

  const normalized = normalizeValue(value);
  if (!normalized) {
    return [];
  }

  return Array.from(new Set(normalized.split(",").map((item) => normalizeTagValue(item)).filter(Boolean)));
};

const parseTeamMembersFromValue = (value) => {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => normalizeValue(item)).filter(Boolean)));
  }

  const normalized = normalizeValue(value);
  if (!normalized) {
    return [];
  }

  return Array.from(new Set(normalized.split(",").map((item) => normalizeValue(item)).filter(Boolean)));
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

const ISSUE_ID_ALIASES = ["issue id", "id", "task id", "card id", "row id"];
const TITLE_ALIASES = ["title", "issue title", "task title", "name"];
const PROJECT_NAME_ALIASES = ["project name", "project", "projectname"];
const E2_STATUS_ALIASES = ["e2 status update agile", "e2statusupdateagile"];
const LEAD_DETAILER_ALIASES = ["e3 lead detailer", "e3leaddetailer", "e2 lead detailer", "e2leaddetailer", "e2 detailer", "e2detailer"];
const SUPPORT_TEAM_ALIASES = ["e2 detailer support team", "e2detailersupportteam", "support team"];
const TECHNICAL_DIRECTION_ALIASES = ["technical direction", "tech direction", "technicaldirection", "techdirection"];
const DATA_STAGE_ALIASES = ["data stage", "datastage"];
const TASK_DESCRIPTION_ALIASES = ["task description", "description", "task desc", "details", "scope"];
const ACTIVE_TIMER_STORAGE_PREFIX = "timeRotateActiveTimer";
const ACTIVE_TIMER_COLLECTION = "timeRotateActiveTimers";
const LAST_CARD_STORAGE_PREFIX = "timeRotateLastSelectedCard";
const LOGS_PER_PAGE = 3;

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

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #CBD5E1",
  borderRadius: "8px",
  backgroundColor: "#FFFFFF",
  color: "#0F172A",
};

const optionCardStyle = {
  width: "100%",
  border: "1px solid #D6DCE8",
  borderRadius: "12px",
  backgroundColor: "#FFFFFF",
  minHeight: "132px",
  padding: "18px 16px",
  textAlign: "left",
  cursor: "pointer",
  display: "grid",
  alignContent: "center",
  gap: "6px",
  boxShadow: "0 8px 16px rgba(15, 23, 42, 0.08)",
};

const carouselNavButtonStyle = {
  border: "1px solid #CBD5E1",
  backgroundColor: "#FFFFFF",
  color: "#0F172A",
  borderRadius: "999px",
  width: "42px",
  height: "42px",
  cursor: "pointer",
  fontSize: "1.1rem",
  fontWeight: 700,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const punchCardStyle = {
  marginTop: "10px",
  border: "1px solid #D6DCE8",
  background:
    "repeating-linear-gradient(0deg, #F8FAFC 0, #F8FAFC 22px, #EEF2F7 22px, #EEF2F7 23px)",
  borderRadius: "16px",
  padding: "clamp(14px, 2.2vw, 22px)",
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
  alignItems: "start",
  gap: "14px",
  minHeight: "clamp(520px, 68vh, 860px)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9), 0 10px 24px rgba(15, 23, 42, 0.08)",
};

const punchHeaderStyle = {
  gridColumn: "1 / -1",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "8px",
};

const punchBadgeStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "6px 10px",
  borderRadius: "999px",
  border: "1px solid #D6DCE8",
  backgroundColor: "#FFFFFF",
  fontSize: "0.78rem",
  fontWeight: 700,
  color: "#334155",
  letterSpacing: "0.02em",
  textTransform: "uppercase",
};

const selectedCardPanelStyle = {
  border: "2px solid #2563EB",
  borderRadius: "14px",
  background: "linear-gradient(145deg, #DBEAFE 0%, #EFF6FF 45%, #F8FAFC 100%)",
  padding: "12px 14px",
  display: "grid",
  gap: "5px",
  boxShadow: "0 0 0 3px rgba(37, 99, 235, 0.2), 0 10px 22px rgba(37, 99, 235, 0.22)",
};

const selectedBadgeStyle = {
  display: "inline-flex",
  width: "fit-content",
  alignItems: "center",
  gap: "6px",
  padding: "4px 10px",
  borderRadius: "999px",
  backgroundColor: "#1D4ED8",
  color: "#FFFFFF",
  fontSize: "0.75rem",
  fontWeight: 800,
  letterSpacing: "0.03em",
  textTransform: "uppercase",
};

const actionWorkspaceStyle = {
  border: "1px solid #BFDBFE",
  borderRadius: "16px",
  background: "linear-gradient(145deg, #EFF6FF 0%, #F8FAFC 100%)",
  padding: "14px",
  display: "grid",
  gap: "12px",
};

const logWorkspaceStyle = {
  border: "1px solid #D6DCE8",
  borderRadius: "16px",
  background: "linear-gradient(145deg, #FFFFFF 0%, #F8FAFC 100%)",
  padding: "14px",
  display: "grid",
  gap: "10px",
};

const workspaceTitleStyle = {
  color: "#0F172A",
  fontWeight: 800,
  fontSize: "0.95rem",
  letterSpacing: "0.01em",
  textTransform: "uppercase",
};

const startButtonStyle = {
  justifySelf: "center",
  width: "clamp(180px, 24vw, 240px)",
  height: "clamp(180px, 24vw, 240px)",
  display: "inline-flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "6px",
  background: "linear-gradient(135deg, #0F766E 0%, #0EA5A4 100%)",
  color: "#FFFFFF",
  border: "none",
  borderRadius: "50%",
  padding: "18px",
  fontWeight: 800,
  fontSize: "1.05rem",
  textAlign: "center",
  cursor: "pointer",
  letterSpacing: "0.02em",
  boxShadow: "0 12px 24px rgba(15, 118, 110, 0.32)",
};

const runningPanelStyle = {
  display: "grid",
  gap: "10px",
  border: "1px solid #CFE3DB",
  borderRadius: "12px",
  background: "linear-gradient(145deg, #F0FDFA 0%, #F8FAFC 100%)",
  padding: "12px",
};

const stopButtonStyle = {
  justifySelf: "center",
  width: "clamp(180px, 24vw, 240px)",
  height: "clamp(180px, 24vw, 240px)",
  display: "inline-flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "6px",
  background: "linear-gradient(135deg, #B91C1C 0%, #DC2626 100%)",
  color: "#FFFFFF",
  border: "none",
  borderRadius: "50%",
  padding: "18px",
  fontWeight: 800,
  fontSize: "1.05rem",
  textAlign: "center",
  letterSpacing: "0.02em",
  boxShadow: "0 12px 24px rgba(185, 28, 28, 0.3)",
};

const receiptCardStyle = {
  border: "1px solid #D6DCE8",
  borderRadius: "12px",
  backgroundColor: "#FFFFFF",
  padding: "12px 14px",
  display: "grid",
  gap: "4px",
  boxShadow: "0 8px 18px rgba(15, 23, 42, 0.06)",
};

const isTechnicalDetail = (technicalDirection) => /technical\s*detail/i.test(normalizeValue(technicalDirection));

const formatTitleWithTechnicalDetail = (title, technicalDirection) => {
  const normalizedTitle = normalizeValue(title) || "No title";
  if (!isTechnicalDetail(technicalDirection)) {
    return normalizedTitle;
  }

  return `★ Technical Detail • ${normalizedTitle}`;
};

const formatCardSummary = (card) => {
  if (!card) return "";
  const projectName = normalizeValue(card.projectName) || "No project";
  const title = formatTitleWithTechnicalDetail(card.title, card.technicalDirection);
  return `${normalizeValue(card.issueId)} • ${projectName} • ${title}`;
};

const matchesActiveTimerOwner = ({ entry, userId, userEmail, ownerKey, registeredBy }) => {
  const entryUserId = normalizeValue(entry?.userId);
  const entryUserEmail = normalizeValue(entry?.userEmail);
  const entryOwnerKey = normalizeValue(entry?.ownerKey);
  const entryRegisteredBy = normalizeValue(entry?.registeredBy);

  if (userId && entryUserId === userId) return true;
  if (userEmail && entryUserEmail === userEmail) return true;
  if (ownerKey && entryOwnerKey === ownerKey) return true;
  if (registeredBy && entryRegisteredBy === registeredBy) return true;

  return false;
};

const TimeTracking = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const [viewportWidth, setViewportWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1280
  );
  const [productionCards, setProductionCards] = useState([]);
  const [issueIdInput, setIssueIdInput] = useState("");
  const [cardSearchInput, setCardSearchInput] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [teamMemberFilter, setTeamMemberFilter] = useState("all");
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [activeSession, setActiveSession] = useState(null);
  const [currentTick, setCurrentTick] = useState(Date.now());
  const [noteInput, setNoteInput] = useState("");
  const [actionError, setActionError] = useState("");
  const [isStopping, setIsStopping] = useState(false);
  const [allActiveTimers, setAllActiveTimers] = useState([]);
  const [hasLoadedActiveTimers, setHasLoadedActiveTimers] = useState(false);
  const [suppressTimerAutoRestore, setSuppressTimerAutoRestore] = useState(false);
  const [didRestoreLastCard, setDidRestoreLastCard] = useState(false);
  const [recentReceipts, setRecentReceipts] = useState([]);
  const [latestStopReceipt, setLatestStopReceipt] = useState(null);
  const [logPage, setLogPage] = useState(1);
  const [expandedReceiptNotes, setExpandedReceiptNotes] = useState({});
  const touchStartXRef = useRef(0);
  const touchEndXRef = useRef(0);
  const stopInFlightRef = useRef("");
  const stopFailsafeTimeoutRef = useRef(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return () => {};
    }

    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const routePrefix =
    typeof window !== "undefined" && window.location?.pathname?.includes("/church/")
      ? "/church"
      : "/organization";

  const resolvedUserId = useMemo(() => normalizeValue(user?.uid || user?.id || user?.userId), [user?.id, user?.uid, user?.userId]);
  const resolvedUserEmail = useMemo(() => normalizeValue(user?.email), [user?.email]);
  const resolvedUserDisplay = useMemo(() => normalizeValue(user?.name || user?.displayName || user?.email), [user?.displayName, user?.email, user?.name]);

  const activeTimerOwnerKey = useMemo(() => normalizeValue(resolvedUserId || resolvedUserEmail || resolvedUserDisplay), [resolvedUserDisplay, resolvedUserEmail, resolvedUserId]);

  const activeTimerStorageKey = useMemo(() => {
    const userKey = activeTimerOwnerKey || "anonymous";
    return `${ACTIVE_TIMER_STORAGE_PREFIX}:${id || "unknown"}:${userKey}`;
  }, [activeTimerOwnerKey, id]);

  const lastCardStorageKey = useMemo(() => {
    const userKey = activeTimerOwnerKey || "anonymous";
    return `${LAST_CARD_STORAGE_PREFIX}:${id || "unknown"}:${userKey}`;
  }, [activeTimerOwnerKey, id]);

  const productionCardMapByIssueId = useMemo(() => {
    const map = {};
    productionCards.forEach((card) => {
      const key = normalizeValue(card.issueId);
      if (!key) return;
      map[key] = card;
    });
    return map;
  }, [productionCards]);

  const projectOptions = useMemo(() => {
    return Array.from(
      new Set(
        productionCards
          .map((card) => normalizeValue(card.projectName))
          .filter(Boolean)
      )
    ).sort((left, right) => left.localeCompare(right));
  }, [productionCards]);

  const memberOptions = useMemo(() => {
    const normalizedProjectFilter = normalizeValue(projectFilter).toLowerCase();
    const projectFilteredCards = productionCards.filter((card) => {
      const cardProjectName = normalizeValue(card.projectName).toLowerCase();
      return normalizedProjectFilter === "all" || cardProjectName === normalizedProjectFilter;
    });

    const detailers = Array.from(
      new Set(projectFilteredCards.map((card) => normalizeValue(card.leadDetailer)).filter(Boolean))
    ).sort((left, right) => left.localeCompare(right));

    const support = Array.from(
      new Set(
        projectFilteredCards
          .flatMap((card) => (Array.isArray(card.supportTeamMembers) ? card.supportTeamMembers : []))
          .map((member) => normalizeValue(member))
          .filter(Boolean)
      )
    ).sort((left, right) => left.localeCompare(right));

    const allMembers = Array.from(new Set([...detailers, ...support])).sort((left, right) => left.localeCompare(right));

    return { all: allMembers };
  }, [productionCards, projectFilter]);

  useEffect(() => {
    if (teamMemberFilter === "all") {
      return;
    }

    const currentOptions = memberOptions.all;

    if (!currentOptions.includes(teamMemberFilter)) {
      setTeamMemberFilter("all");
    }
  }, [memberOptions.all, teamMemberFilter]);

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
          const statusAgileField = findFieldByAliases(rowData, E2_STATUS_ALIASES);
          const leadDetailerField = findFieldByAliases(rowData, LEAD_DETAILER_ALIASES);
          const supportTeamField = findFieldByAliases(rowData, SUPPORT_TEAM_ALIASES);
          const technicalDirectionField = findFieldByAliases(rowData, TECHNICAL_DIRECTION_ALIASES);
          const taskDescriptionField = findFieldByAliases(rowData, TASK_DESCRIPTION_ALIASES);

          const issueId =
            normalizeValue(issueIdField ? rowData[issueIdField] : "") ||
            String(row?.rowNumber || rowIndex + 1);

          nextCards.push({
            key: `${projectDoc.id}-${row?.rowNumber ?? "row"}-${rowIndex}`,
            issueId,
            title: normalizeValue(titleField ? rowData[titleField] : ""),
            projectName: normalizeValue(projectNameField ? rowData[projectNameField] : ""),
            statusAgile: normalizeValue(statusAgileField ? rowData[statusAgileField] : ""),
            leadDetailer: normalizeValue(leadDetailerField ? rowData[leadDetailerField] : ""),
            supportTeamMembers: parseTeamMembersFromValue(supportTeamField ? rowData[supportTeamField] : ""),
            technicalDirection: normalizeValue(technicalDirectionField ? rowData[technicalDirectionField] : ""),
            taskTags: parseTagsFromValue(taskDescriptionField ? rowData[taskDescriptionField] : ""),
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

  useEffect(() => {
    if (!id) {
      return () => {};
    }

    const unsubscribe = onSnapshot(
      query(collection(db, "churches", id, "timeRotateLogs"), orderBy("endedAt", "desc"), limit(120)),
      (snapshot) => {
        const currentUserId = normalizeValue(resolvedUserId);
        const currentUserEmail = normalizeValue(resolvedUserEmail);
        const currentRegisteredBy = normalizeValue(user?.name || user?.displayName || user?.email);

        const nextReceipts = snapshot.docs
          .map((snapshotDoc) => {
            const data = snapshotDoc.data() || {};
            const mappedNotes = Array.isArray(data.notes)
              ? data.notes
                  .map((note) => ({
                    text: normalizeValue(note?.text ?? note),
                    timestamp: Number(note?.timestamp) || 0,
                  }))
                  .filter((note) => note.text)
              : [];

            return {
              id: snapshotDoc.id,
              logType: normalizeValue(data.logType) || "timer",
              issueId: normalizeValue(data.issueId),
              title: normalizeValue(data.title),
              projectName: normalizeValue(data.projectName),
              startedAt: Number(data.startedAt) || 0,
              endedAt: Number(data.endedAt) || 0,
              durationMs: Number(data.durationMs) || 0,
              notesCount: mappedNotes.length,
              notes: mappedNotes,
              userId: normalizeValue(data.userId),
              userEmail: normalizeValue(data.userEmail),
              registeredBy: normalizeValue(data.registeredBy),
            };
          })
          .filter((entry) => entry.logType !== "completion")
          .filter((entry) => Number(entry.durationMs) > 0)
          .filter((entry) => {
            if (currentUserId && normalizeValue(entry.userId) === currentUserId) return true;
            if (currentUserEmail && normalizeValue(entry.userEmail) === currentUserEmail) return true;
            if (currentRegisteredBy && normalizeValue(entry.registeredBy) === currentRegisteredBy) return true;
            return false;
          })
          .sort((left, right) => (Number(right.endedAt) || 0) - (Number(left.endedAt) || 0));

        setRecentReceipts(nextReceipts);
      },
      (snapshotError) => {
        console.error("Error loading TimeTracking receipts:", snapshotError);
      }
    );

    return () => unsubscribe();
  }, [id, resolvedUserEmail, resolvedUserId, user?.displayName, user?.email, user?.name]);

  useEffect(() => {
    if (!id) {
      return () => {};
    }

    const unsubscribe = onSnapshot(
      collection(db, "churches", id, ACTIVE_TIMER_COLLECTION),
      (snapshot) => {
        const nextActiveTimers = snapshot.docs
          .map((snapshotDoc) => {
            const data = snapshotDoc.data() || {};
            return {
              docId: snapshotDoc.id,
              cardKey: normalizeValue(data.cardKey),
              startedAt: Number(data.startedAt) || 0,
              issueId: normalizeValue(data.issueId),
              projectName: normalizeValue(data.projectName),
              statusAgile: normalizeValue(data.statusAgile),
              technicalDirection: normalizeValue(data.technicalDirection),
              ownerKey: normalizeValue(data.ownerKey),
              registeredBy: normalizeValue(data.registeredBy),
              userId: normalizeValue(data.userId),
              userEmail: normalizeValue(data.userEmail),
              updatedAt: Number(data.updatedAt) || 0,
              taskTags: parseTagsFromValue(data.taskTags ?? data.taskDescription),
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
          .filter((entry) => Number.isFinite(entry.startedAt) && entry.startedAt > 0)
          .sort((left, right) => right.startedAt - left.startedAt);

        setAllActiveTimers(nextActiveTimers);
        setHasLoadedActiveTimers(true);
      },
      (snapshotError) => {
        console.error("Error loading active TimeTracking timers:", snapshotError);
        setHasLoadedActiveTimers(true);
      }
    );

    return () => unsubscribe();
  }, [id]);

  useEffect(() => {
    if (!id || typeof window === "undefined") {
      return;
    }

    try {
      const rawValue = window.localStorage.getItem(activeTimerStorageKey);
      if (!rawValue) {
        return;
      }

      const parsedValue = JSON.parse(rawValue);
      const startedAt = Number(parsedValue?.startedAt);

      if (!parsedValue || !Number.isFinite(startedAt) || startedAt <= 0) {
        window.localStorage.removeItem(activeTimerStorageKey);
        return;
      }

      setActiveSession({
        cardKey: normalizeValue(parsedValue.cardKey),
        startedAt,
        issueId: normalizeValue(parsedValue.issueId),
        title: normalizeValue(parsedValue.title),
        projectName: normalizeValue(parsedValue.projectName),
        statusAgile: normalizeValue(parsedValue.statusAgile),
        technicalDirection: normalizeValue(parsedValue.technicalDirection),
        taskTags: parseTagsFromValue(parsedValue.taskTags ?? parsedValue.taskDescription),
        notes: Array.isArray(parsedValue.notes)
          ? parsedValue.notes
              .map((note) => ({
                text: normalizeValue(note?.text),
                timestamp: Number(note?.timestamp) || Date.now(),
              }))
              .filter((note) => note.text)
          : [],
        updatedAt: Number(parsedValue.updatedAt) || startedAt,
        source: normalizeValue(parsedValue.source) || "local",
      });
      setCurrentTick(Date.now());
    } catch (restoreError) {
      console.error("Error restoring active TimeTracking timer:", restoreError);
      window.localStorage.removeItem(activeTimerStorageKey);
    }
  }, [activeTimerStorageKey, id]);

  useEffect(() => {
    setDidRestoreLastCard(false);
  }, [lastCardStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined" || !id) {
      return;
    }

    if (didRestoreLastCard) {
      return;
    }

    if (activeSession || issueIdInput || normalizeValue(cardSearchInput)) {
      setDidRestoreLastCard(true);
      return;
    }

    try {
      const rawValue = window.localStorage.getItem(lastCardStorageKey);
      if (!rawValue) {
        setDidRestoreLastCard(true);
        return;
      }

      const parsedValue = JSON.parse(rawValue);
      const storedIssueId = normalizeValue(parsedValue?.issueId);
      if (!storedIssueId) {
        setDidRestoreLastCard(true);
        return;
      }

      const storedCard = productionCardMapByIssueId[storedIssueId];
      if (!storedCard) {
        setDidRestoreLastCard(true);
        return;
      }

      setIssueIdInput(storedIssueId);
      setCardSearchInput(formatCardSummary(storedCard));
      setDidRestoreLastCard(true);
    } catch (restoreError) {
      console.error("Error restoring last selected TimeTracking card:", restoreError);
      setDidRestoreLastCard(true);
    }
  }, [activeSession, cardSearchInput, didRestoreLastCard, id, issueIdInput, lastCardStorageKey, productionCardMapByIssueId]);

  useEffect(() => {
    const currentUserId = normalizeValue(resolvedUserId);
    const currentUserEmail = normalizeValue(resolvedUserEmail);
    const currentOwnerKey = normalizeValue(activeTimerOwnerKey);
    const currentRegisteredBy = normalizeValue(user?.name || user?.displayName || user?.email);

    const matchedTimer = allActiveTimers
      .filter((entry) => {
        const entryUserId = normalizeValue(entry?.userId);
        const entryUserEmail = normalizeValue(entry?.userEmail);
        const entryOwnerKey = normalizeValue(entry?.ownerKey);
        const entryRegisteredBy = normalizeValue(entry?.registeredBy);

        if (currentUserId && entryUserId === currentUserId) return true;
        if (currentUserEmail && entryUserEmail === currentUserEmail) return true;
        if (currentOwnerKey && entryOwnerKey === currentOwnerKey) return true;
        if (currentRegisteredBy && entryRegisteredBy === currentRegisteredBy) return true;

        return false;
      })
      .sort((left, right) => {
        const rightStartedAt = Number(right.startedAt) || 0;
        const leftStartedAt = Number(left.startedAt) || 0;
        if (rightStartedAt !== leftStartedAt) {
          return rightStartedAt - leftStartedAt;
        }
        return (Number(right.updatedAt) || 0) - (Number(left.updatedAt) || 0);
      })[0];

    if (!matchedTimer) {
      if (activeSession?.source === "remote") {
        setActiveSession(null);
        setCurrentTick(Date.now());
      }

      if (suppressTimerAutoRestore) {
        setSuppressTimerAutoRestore(false);
      }

      return;
    }

    if (suppressTimerAutoRestore) {
      return;
    }

    const mappedRemoteSession = {
      cardKey: normalizeValue(matchedTimer.cardKey),
      startedAt: Number(matchedTimer.startedAt) || Date.now(),
      issueId: normalizeValue(matchedTimer.issueId),
      title: normalizeValue(productionCardMapByIssueId[normalizeValue(matchedTimer.issueId)]?.title),
      projectName: normalizeValue(matchedTimer.projectName),
      statusAgile: normalizeValue(matchedTimer.statusAgile),
      technicalDirection: normalizeValue(matchedTimer.technicalDirection),
      taskTags: parseTagsFromValue(matchedTimer.taskTags),
      notes: Array.isArray(matchedTimer.notes)
        ? matchedTimer.notes
            .map((note) => ({
              text: normalizeValue(note?.text),
              timestamp: Number(note?.timestamp) || Date.now(),
            }))
            .filter((note) => note.text)
        : [],
      updatedAt: Number(matchedTimer.updatedAt) || Date.now(),
      source: "remote",
    };

    const hasSameRemoteSnapshot =
      activeSession &&
      activeSession.source === "remote" &&
      Number(activeSession.updatedAt || 0) === Number(mappedRemoteSession.updatedAt || 0) &&
      normalizeValue(activeSession.issueId) === normalizeValue(mappedRemoteSession.issueId) &&
      Number(activeSession.startedAt || 0) === Number(mappedRemoteSession.startedAt || 0) &&
      (Array.isArray(activeSession.notes) ? activeSession.notes.length : 0) ===
        (Array.isArray(mappedRemoteSession.notes) ? mappedRemoteSession.notes.length : 0);

    const shouldReplaceLocal =
      !activeSession ||
      activeSession.source === "remote" ||
      Number(mappedRemoteSession.updatedAt) >= Number(activeSession.updatedAt || 0);

    if (shouldReplaceLocal && !hasSameRemoteSnapshot) {
      setActiveSession(mappedRemoteSession);
      setCurrentTick(Date.now());
    }
  }, [activeSession, activeTimerOwnerKey, allActiveTimers, productionCardMapByIssueId, resolvedUserEmail, resolvedUserId, suppressTimerAutoRestore, user?.displayName, user?.email, user?.name]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!activeSession) {
      window.localStorage.removeItem(activeTimerStorageKey);
      return;
    }

    try {
      window.localStorage.setItem(activeTimerStorageKey, JSON.stringify(activeSession));
    } catch (persistError) {
      console.error("Error persisting TimeTracking active timer:", persistError);
    }
  }, [activeSession, activeTimerStorageKey]);

  useEffect(() => {
    if (!id || !activeTimerOwnerKey) {
      return;
    }

    const activeTimerDocRef = doc(db, "churches", id, ACTIVE_TIMER_COLLECTION, normalizeKey(activeTimerOwnerKey) || activeTimerOwnerKey);
    const currentUserId = normalizeValue(resolvedUserId);
    const currentUserEmail = normalizeValue(resolvedUserEmail);
    const currentOwnerKey = normalizeValue(activeTimerOwnerKey);
    const currentRegisteredBy = normalizeValue(user?.name || user?.displayName || user?.email);

    if (!activeSession) {
      if (!hasLoadedActiveTimers) {
        return;
      }

      // Only clear remote timers after an explicit stop action.
      if (!suppressTimerAutoRestore) {
        return;
      }

      const matchingRemoteTimerDocIds = Array.from(
        new Set(
          allActiveTimers
            .filter((entry) =>
              matchesActiveTimerOwner({
                entry,
                userId: currentUserId,
                userEmail: currentUserEmail,
                ownerKey: currentOwnerKey,
                registeredBy: currentRegisteredBy,
              })
            )
            .map((entry) => normalizeValue(entry.docId))
            .filter(Boolean)
        )
      );

      if (matchingRemoteTimerDocIds.length > 0) {
        Promise.allSettled(
          matchingRemoteTimerDocIds.map((docId) =>
            deleteDoc(doc(db, "churches", id, ACTIVE_TIMER_COLLECTION, docId))
          )
        ).then((results) => {
          if (results.some((result) => result.status === "rejected")) {
            console.error("Error clearing matched TimeTracking timers:", results);
          }
        });
        return;
      }

      deleteDoc(activeTimerDocRef).catch((deleteError) => {
        console.error("Error clearing active TimeTracking timer:", deleteError);
      });
      return;
    }

    // Avoid feedback loops: remote snapshot restores should not immediately write back.
    if (normalizeValue(activeSession.source) === "remote") {
      return;
    }

    setDoc(
      activeTimerDocRef,
      {
        churchId: id,
        userId: resolvedUserId,
        userEmail: resolvedUserEmail,
        ownerKey: activeTimerOwnerKey,
        registeredBy: user?.name || user?.displayName || user?.email || "Unknown user",
        cardKey: normalizeValue(activeSession.cardKey),
        startedAt: Number(activeSession.startedAt) || Date.now(),
        issueId: normalizeValue(activeSession.issueId),
        projectName: normalizeValue(activeSession.projectName),
        statusAgile: normalizeValue(activeSession.statusAgile),
        technicalDirection: normalizeValue(activeSession.technicalDirection),
        taskTags: parseTagsFromValue(activeSession.taskTags),
        taskDescription: parseTagsFromValue(activeSession.taskTags).join(", "),
        notes: Array.isArray(activeSession.notes) ? activeSession.notes : [],
        updatedAt: Number(activeSession.updatedAt) || Date.now(),
      },
      { merge: true }
    ).catch((saveError) => {
      console.error("Error syncing active TimeTracking timer:", saveError);
      setActionError("Could not sync active timer notes. Please refresh and try again.");
    });
  }, [activeSession, activeTimerOwnerKey, allActiveTimers, hasLoadedActiveTimers, id, resolvedUserEmail, resolvedUserId, suppressTimerAutoRestore, user?.displayName, user?.email, user?.name]);

  useEffect(() => {
    if (!activeSession) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setCurrentTick(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [activeSession]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const handleQuickNoteAdded = (event) => {
      const detail = event?.detail || {};
      const incomingIssueId = normalizeValue(detail.issueId);
      const incomingStartedAt = Number(detail.startedAt) || 0;
      const incomingNoteText = normalizeValue(detail?.note?.text);
      const incomingNoteTimestamp = Number(detail?.note?.timestamp) || 0;

      if (!incomingNoteText || !incomingNoteTimestamp) return;

      setActiveSession((current) => {
        if (!current) return current;

        const currentIssueId = normalizeValue(current.issueId);
        const currentStartedAt = Number(current.startedAt) || 0;

        if (incomingIssueId && currentIssueId && incomingIssueId !== currentIssueId) {
          return current;
        }

        if (incomingStartedAt && currentStartedAt && incomingStartedAt !== currentStartedAt) {
          return current;
        }

        const existingNotes = Array.isArray(current.notes) ? current.notes : [];
        const alreadyExists = existingNotes.some(
          (noteEntry) =>
            normalizeValue(noteEntry?.text) === incomingNoteText &&
            Number(noteEntry?.timestamp) === incomingNoteTimestamp
        );

        if (alreadyExists) return current;

        return {
          ...current,
          notes: [
            ...existingNotes,
            {
              text: incomingNoteText,
              timestamp: incomingNoteTimestamp,
            },
          ],
          updatedAt: Math.max(Number(current.updatedAt) || 0, incomingNoteTimestamp),
          source: "local",
        };
      });
    };

    window.addEventListener("timeRotateQuickNoteAdded", handleQuickNoteAdded);
    return () => {
      window.removeEventListener("timeRotateQuickNoteAdded", handleQuickNoteAdded);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (stopFailsafeTimeoutRef.current) {
        window.clearTimeout(stopFailsafeTimeoutRef.current);
        stopFailsafeTimeoutRef.current = null;
      }
    };
  }, []);

  const selectedIssueId = normalizeValue(activeSession?.issueId || issueIdInput);
  const matchedCard = productionCardMapByIssueId[selectedIssueId] || null;
  const activeDuration = activeSession ? currentTick - Number(activeSession.startedAt || currentTick) : 0;
  const canStartTimer = Boolean(!activeSession && matchedCard && normalizeValue(issueIdInput));
  const selectedSummary = matchedCard ? formatCardSummary(matchedCard) : "";
  const normalizedSearchInput = normalizeValue(cardSearchInput);
  const isManualSearch = Boolean(normalizedSearchInput && normalizedSearchInput !== selectedSummary);
  const selectedRoleMemberOptions = memberOptions.all;

  const filteredCardOptions = useMemo(() => {
    const normalizedSearch =
      isManualSearch
        ? normalizedSearchInput.toLowerCase()
        : "";

    const normalizedProjectFilter = normalizeValue(projectFilter).toLowerCase();

    const roleAndProjectFilteredCards = productionCards.filter((card) => {
      const cardProjectName = normalizeValue(card.projectName).toLowerCase();
      const matchesProject = normalizedProjectFilter === "all" || cardProjectName === normalizedProjectFilter;
      const selectedMember = normalizeValue(teamMemberFilter);
      const leadDetailer = normalizeValue(card.leadDetailer);
      const supportTeamMembers = (Array.isArray(card.supportTeamMembers) ? card.supportTeamMembers : []).map((member) => normalizeValue(member));
      const matchesMember =
        selectedMember === "all" ||
        leadDetailer === selectedMember ||
        supportTeamMembers.some((member) => member === selectedMember);

      return matchesProject && matchesMember;
    });

    if (!normalizedSearch) {
      return roleAndProjectFilteredCards.slice(0, 100);
    }

    return roleAndProjectFilteredCards
      .filter((card) =>
        [
          card.issueId,
          card.projectName,
          card.title,
          card.technicalDirection,
          card.leadDetailer,
          (Array.isArray(card.supportTeamMembers) ? card.supportTeamMembers : []).join(", "),
        ]
          .map((value) => normalizeValue(value).toLowerCase())
          .some((value) => value.includes(normalizedSearch))
      )
      .slice(0, 100);
  }, [isManualSearch, normalizedSearchInput, productionCards, projectFilter, teamMemberFilter]);

  useEffect(() => {
    if (filteredCardOptions.length === 0) {
      setCarouselIndex(0);
      return;
    }

    if (carouselIndex > filteredCardOptions.length - 1) {
      setCarouselIndex(filteredCardOptions.length - 1);
    }
  }, [carouselIndex, filteredCardOptions]);

  const currentCarouselCard = filteredCardOptions[carouselIndex] || null;
  const isCarouselCardSelected =
    normalizeValue(currentCarouselCard?.issueId) && normalizeValue(currentCarouselCard?.issueId) === selectedIssueId;

  const totalLogPages = Math.max(1, Math.ceil(recentReceipts.length / LOGS_PER_PAGE));
  const paginatedRecentReceipts = useMemo(() => {
    const startIndex = (logPage - 1) * LOGS_PER_PAGE;
    return recentReceipts.slice(startIndex, startIndex + LOGS_PER_PAGE);
  }, [logPage, recentReceipts]);

  useEffect(() => {
    setLogPage(1);
  }, [recentReceipts.length]);

  useEffect(() => {
    if (logPage > totalLogPages) {
      setLogPage(totalLogPages);
    }
  }, [logPage, totalLogPages]);

  const handleCarouselMove = (direction) => {
    if (filteredCardOptions.length === 0) {
      return;
    }

    const nextIndex =
      direction === "next"
        ? (carouselIndex + 1) % filteredCardOptions.length
        : (carouselIndex - 1 + filteredCardOptions.length) % filteredCardOptions.length;

    setCarouselIndex(nextIndex);
  };

  const handleCardTouchStart = (event) => {
    touchStartXRef.current = event.changedTouches[0]?.clientX || 0;
  };

  const handleCardTouchEnd = (event) => {
    touchEndXRef.current = event.changedTouches[0]?.clientX || 0;
    const deltaX = touchEndXRef.current - touchStartXRef.current;
    const swipeThreshold = 32;

    if (Math.abs(deltaX) < swipeThreshold) {
      return;
    }

    if (deltaX < 0) {
      handleCarouselMove("next");
    } else {
      handleCarouselMove("prev");
    }
  };

  const handleSelectCard = (card) => {
    const issueId = normalizeValue(card?.issueId);
    if (!issueId) return;

    setIssueIdInput(issueId);
    setCardSearchInput(formatCardSummary(card));
    const selectedIndex = filteredCardOptions.findIndex((entry) => normalizeValue(entry.issueId) === issueId);
    if (selectedIndex >= 0) {
      setCarouselIndex(selectedIndex);
    }
    setActionError("");
  };

  const handleCardInputFocus = () => {
    if (activeSession) {
      return;
    }

    const isShowingSelectedSummary =
      Boolean(issueIdInput) &&
      Boolean(matchedCard) &&
      normalizeValue(cardSearchInput) === formatCardSummary(matchedCard);

    if (isShowingSelectedSummary) {
      // Enter selection mode immediately so users can pick a different task without editing summary text.
      setIssueIdInput("");
      setCardSearchInput("");
    }
  };

  const handleStart = () => {
    if (activeSession) return;

    setIsStopping(false);

    const issueId = normalizeValue(issueIdInput);
    if (!issueId) {
      setActionError("Select a card first.");
      return;
    }

    const now = Date.now();
    const card = productionCardMapByIssueId[issueId] || null;
    if (!card) {
      setActionError("Select a valid card from the dropdown.");
      return;
    }

    setActionError("");
    setSuppressTimerAutoRestore(false);
    setCurrentTick(now);

    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(
          lastCardStorageKey,
          JSON.stringify({
            issueId,
            updatedAt: now,
            source: "start",
          })
        );
      } catch (persistError) {
        console.error("Error saving last started TimeTracking card:", persistError);
      }
    }

    setActiveSession({
      cardKey: normalizeValue(card?.key),
      issueId,
      startedAt: now,
      title: normalizeValue(card?.title),
      projectName: normalizeValue(card?.projectName),
      statusAgile: normalizeValue(card?.statusAgile),
      technicalDirection: normalizeValue(card?.technicalDirection),
      taskTags: Array.isArray(card?.taskTags) ? card.taskTags : [],
      notes: [],
      updatedAt: now,
      source: "local",
    });
    setNoteInput("");
  };

  const handleAddNote = () => {
    const trimmed = normalizeValue(noteInput);
    if (!trimmed || !activeSession) return;

    setActiveSession((current) => {
      if (!current) return current;
      return {
        ...current,
        notes: [
          ...(Array.isArray(current.notes) ? current.notes : []),
          {
            text: trimmed,
            timestamp: Date.now(),
          },
        ],
        updatedAt: Date.now(),
        source: "local",
      };
    });
    setNoteInput("");
  };

  const handleStop = () => {
    if (!activeSession) return;

    const stopSessionKey = `${normalizeValue(activeSession.issueId)}-${Number(activeSession.startedAt) || 0}`;
    if (stopInFlightRef.current === stopSessionKey) return;

    const sessionToStop = activeSession;
    stopInFlightRef.current = stopSessionKey;
    setIsStopping(true);
    setSuppressTimerAutoRestore(true);

    if (stopFailsafeTimeoutRef.current) {
      window.clearTimeout(stopFailsafeTimeoutRef.current);
    }

    // Failsafe: never let clock-out remain blocked by a hanging network request.
    stopFailsafeTimeoutRef.current = window.setTimeout(() => {
      if (stopInFlightRef.current === stopSessionKey) {
        stopInFlightRef.current = "";
      }
      setIsStopping(false);
    }, 8000);

    const endedAt = Date.now();
    const startedAt = Number(sessionToStop.startedAt) || endedAt;
    const durationMs = Math.max(0, endedAt - startedAt);

    setLatestStopReceipt({
      status: "syncing",
      issueId: normalizeValue(sessionToStop.issueId),
      projectName: normalizeValue(sessionToStop.projectName),
      title: normalizeValue(sessionToStop.title),
      technicalDirection: normalizeValue(sessionToStop.technicalDirection),
      startedAt,
      endedAt,
      durationMs,
      notesCount: Array.isArray(sessionToStop.notes) ? sessionToStop.notes.length : 0,
      message: "Clocked out successfully. Saving your receipt automatically.",
    });

    setRecentReceipts((current) => {
      const optimisticReceipt = {
        id: `local-${endedAt}`,
        logType: "timer",
        issueId: normalizeValue(sessionToStop.issueId),
        title: normalizeValue(sessionToStop.title),
        projectName: normalizeValue(sessionToStop.projectName),
        startedAt,
        endedAt,
        durationMs,
        notesCount: Array.isArray(sessionToStop.notes) ? sessionToStop.notes.length : 0,
        notes: Array.isArray(sessionToStop.notes)
          ? sessionToStop.notes
              .map((note) => ({
                text: normalizeValue(note?.text ?? note),
                timestamp: Number(note?.timestamp) || 0,
              }))
              .filter((note) => note.text)
          : [],
        userId: normalizeValue(user?.uid),
        userEmail: normalizeValue(user?.email),
        registeredBy: normalizeValue(user?.name || user?.displayName || user?.email),
      };

      const withoutSameEndedAt = (Array.isArray(current) ? current : []).filter(
        (entry) => Number(entry.endedAt || 0) !== endedAt
      );

      return [optimisticReceipt, ...withoutSameEndedAt]
        .sort((left, right) => (Number(right.endedAt) || 0) - (Number(left.endedAt) || 0));
    });

    // Stop immediately in UI and shared active-timer sync, then persist the final log.
    setActiveSession(null);
    setIssueIdInput(normalizeValue(sessionToStop.issueId));
    setCardSearchInput(
      formatCardSummary(
        productionCardMapByIssueId[normalizeValue(sessionToStop.issueId)] || {
          issueId: normalizeValue(sessionToStop.issueId),
          projectName: normalizeValue(sessionToStop.projectName),
          title: normalizeValue(sessionToStop.title),
        }
      )
    );
    setNoteInput("");
    setCurrentTick(Date.now());
    setIsStopping(false);

    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(
          lastCardStorageKey,
          JSON.stringify({
            issueId: normalizeValue(sessionToStop.issueId),
            updatedAt: endedAt,
            source: "stop",
          })
        );
      } catch (persistError) {
        console.error("Error saving last stopped TimeTracking card:", persistError);
      }
    }

    const hasChurchContext = Boolean(normalizeValue(id));
    const saveLogPromise = hasChurchContext
      ? addDoc(collection(db, "churches", id, "timeRotateLogs"), {
          churchId: id,
          logType: "timer",
          issueId: normalizeValue(sessionToStop.issueId),
          projectName: normalizeValue(sessionToStop.projectName),
          statusAgile: normalizeValue(sessionToStop.statusAgile),
          technicalDirection: normalizeValue(sessionToStop.technicalDirection),
          taskTags: parseTagsFromValue(sessionToStop.taskTags),
          taskDescription: parseTagsFromValue(sessionToStop.taskTags).join(", "),
          startedAt,
          endedAt,
          durationMs,
          registeredBy: user?.name || user?.displayName || user?.email || "Unknown user",
          userId: user?.uid || "",
          userEmail: user?.email || "",
          notes: Array.isArray(sessionToStop.notes) ? sessionToStop.notes : [],
        })
      : Promise.resolve(null);

    setActionError("");
    saveLogPromise
      .then(() => {
        setLatestStopReceipt({
          status: hasChurchContext ? "saved" : "error",
          issueId: normalizeValue(sessionToStop.issueId),
          projectName: normalizeValue(sessionToStop.projectName),
          title: normalizeValue(sessionToStop.title),
          technicalDirection: normalizeValue(sessionToStop.technicalDirection),
          startedAt,
          endedAt,
          durationMs,
          notesCount: Array.isArray(sessionToStop.notes) ? sessionToStop.notes.length : 0,
          message: hasChurchContext ? "Saved successfully." : "Clocked out locally. Missing church context for cloud save.",
        });
        setActionError(hasChurchContext ? "" : "Timer stopped locally, but cloud sync is unavailable right now.");
      })
      .catch((saveError) => {
        console.warn("TimeTracking stop log save failed:", saveError);
        setActionError("Timer stopped, but log sync failed. Please refresh and confirm in Recent Punch Log.");
        setLatestStopReceipt({
          status: "error",
          issueId: normalizeValue(sessionToStop.issueId),
          projectName: normalizeValue(sessionToStop.projectName),
          title: normalizeValue(sessionToStop.title),
          technicalDirection: normalizeValue(sessionToStop.technicalDirection),
          startedAt,
          endedAt,
          durationMs,
          notesCount: Array.isArray(sessionToStop.notes) ? sessionToStop.notes.length : 0,
          message: "Save failed.",
        });
      })
      .finally(() => {
        if (stopFailsafeTimeoutRef.current) {
          window.clearTimeout(stopFailsafeTimeoutRef.current);
          stopFailsafeTimeoutRef.current = null;
        }
        if (stopInFlightRef.current === stopSessionKey) {
          stopInFlightRef.current = "";
        }
      });
  };

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
            <h1 style={{ ...commonStyles.title, marginBottom: "6px" }}>TimeTracking</h1>
            <p style={{ margin: 0, color: "#475569" }}>
              Quick timer to log hours by ID using the same TimeRotate fields and storage.
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px", marginBottom: "12px" }}>
          <Link to={`${routePrefix}/${id}/time-tracking`} style={tabStyle(true)}>
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
          <Link to={`${routePrefix}/${id}/time-rotate-notes?view=card-review`} style={tabStyle(false)}>
            ☑ Card Review
          </Link>
          <Link to={`${routePrefix}/${id}/e2-agile-board`} style={tabStyle(false)}>
            ▦ Agile Board
          </Link>
        </div>

        <div
          style={{
            ...punchCardStyle,
            gridTemplateColumns:
              viewportWidth >= 1024 ? "minmax(0, 1fr) minmax(0, 1fr)" : "minmax(0, 1fr)",
          }}
        >
          <div style={punchHeaderStyle}>
            <div style={{ color: "#0F172A", fontWeight: 800, fontSize: "1rem" }}>Punch Card</div>
            <span style={punchBadgeStyle}>{activeSession ? "Clocked In" : "Ready to Clock In"}</span>
          </div>

          <div style={actionWorkspaceStyle}>
            <div style={workspaceTitleStyle}>Action Workspace</div>

            <div style={{ display: "grid", gap: "8px" }}>
              <div style={{ display: "grid", gap: "6px" }}>
                <label style={{ color: "#334155", fontWeight: 600 }}>Card (ID + Project + Title)</label>
                <input
                  value={cardSearchInput}
                  onChange={(event) => {
                    setCardSearchInput(event.target.value);
                    setIssueIdInput("");
                    setCarouselIndex(0);
                  }}
                  onFocus={handleCardInputFocus}
                  style={inputStyle}
                  placeholder="Search by ID, project, or title"
                  disabled={Boolean(activeSession)}
                />

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "8px" }}>
                  <select
                    value={projectFilter}
                    onChange={(event) => {
                      setProjectFilter(event.target.value);
                      setCarouselIndex(0);
                    }}
                    style={inputStyle}
                    disabled={Boolean(activeSession)}
                  >
                    <option value="all">All Projects</option>
                    {projectOptions.map((projectName) => (
                      <option key={projectName} value={projectName}>
                        {projectName}
                      </option>
                    ))}
                  </select>

                  <select
                    value={teamMemberFilter}
                    onChange={(event) => {
                      setTeamMemberFilter(event.target.value);
                      setCarouselIndex(0);
                    }}
                    style={inputStyle}
                    disabled={Boolean(activeSession)}
                  >
                    <option value="all">All Detailers and Support Team</option>
                    {selectedRoleMemberOptions.map((memberName) => (
                      <option key={memberName} value={memberName}>
                        {memberName}
                      </option>
                    ))}
                  </select>
                </div>

                {!activeSession ? (
                  filteredCardOptions.length === 0 ? (
                    <div style={{ color: "#64748B", fontSize: "0.9rem", padding: "8px 0" }}>
                      No cards match your search.
                    </div>
                  ) : isManualSearch && filteredCardOptions.length > 1 ? (
                    <div style={{ display: "grid", gap: "8px" }}>
                      <div style={{ color: "#475569", fontSize: "0.83rem", fontWeight: 700 }}>
                        {filteredCardOptions.length} cards match your search.
                      </div>
                      <div style={{ display: "grid", gap: "8px", maxHeight: "320px", overflowY: "auto", paddingRight: "4px" }}>
                        {filteredCardOptions.map((card) => {
                          const isSelected = normalizeValue(card.issueId) === selectedIssueId;
                          return (
                            <button
                              key={card.key || normalizeValue(card.issueId)}
                              type="button"
                              style={{
                                ...optionCardStyle,
                                minHeight: "unset",
                                padding: "12px 14px",
                                borderColor: isSelected ? "#2563EB" : "#D6DCE8",
                                backgroundColor: isSelected ? "#EFF6FF" : "#FFFFFF",
                                borderWidth: isSelected ? "2px" : "1px",
                                boxShadow: isSelected
                                  ? "0 0 0 3px rgba(37, 99, 235, 0.22), 0 8px 18px rgba(37, 99, 235, 0.25)"
                                  : optionCardStyle.boxShadow,
                              }}
                              onClick={() => handleSelectCard(card)}
                            >
                              {isSelected ? <span style={selectedBadgeStyle}>Selected</span> : null}
                              <div style={{ fontWeight: 800, color: "#0F172A", fontSize: "0.98rem" }}>
                                {normalizeValue(card.issueId) || "No ID"}
                              </div>
                              <div style={{ color: "#334155", fontSize: "0.9rem" }}>
                                {normalizeValue(card.projectName) || "No project"}
                              </div>
                              <div style={{ color: "#64748B", fontSize: "0.86rem" }}>
                                {formatTitleWithTechnicalDetail(card.title, card.technicalDirection)}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: "8px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ color: "#475569", fontSize: "0.83rem", fontWeight: 700 }}>
                          Swipe left/right or use arrows to browse
                        </span>
                        <span style={{ color: "#64748B", fontSize: "0.8rem" }}>
                          {carouselIndex + 1} of {filteredCardOptions.length}
                        </span>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: "8px", alignItems: "stretch" }}>
                        <button type="button" onClick={() => handleCarouselMove("prev")} style={carouselNavButtonStyle}>
                          {"<"}
                        </button>

                        <button
                          type="button"
                          style={{
                            ...optionCardStyle,
                            borderColor: isCarouselCardSelected ? "#2563EB" : optionCardStyle.border,
                            borderWidth: isCarouselCardSelected ? "2px" : "1px",
                            backgroundColor: isCarouselCardSelected ? "#EFF6FF" : "#FFFFFF",
                            boxShadow: isCarouselCardSelected
                              ? "0 0 0 3px rgba(37, 99, 235, 0.22), 0 8px 18px rgba(37, 99, 235, 0.25)"
                              : optionCardStyle.boxShadow,
                          }}
                          onClick={() => handleSelectCard(currentCarouselCard)}
                          onTouchStart={handleCardTouchStart}
                          onTouchEnd={handleCardTouchEnd}
                        >
                          {isCarouselCardSelected ? <span style={selectedBadgeStyle}>Selected</span> : null}
                          <div style={{ fontWeight: 800, color: "#0F172A", fontSize: "1rem" }}>
                            {normalizeValue(currentCarouselCard?.issueId) || "No ID"}
                          </div>
                          <div style={{ color: "#334155", fontSize: "0.9rem" }}>
                            {normalizeValue(currentCarouselCard?.projectName) || "No project"}
                          </div>
                          <div style={{ color: "#64748B", fontSize: "0.86rem" }}>
                            {formatTitleWithTechnicalDetail(currentCarouselCard?.title, currentCarouselCard?.technicalDirection)}
                          </div>
                        </button>

                        <button type="button" onClick={() => handleCarouselMove("next")} style={carouselNavButtonStyle}>
                          {">"}
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleSelectCard(currentCarouselCard)}
                        style={{
                          ...inputStyle,
                          width: "fit-content",
                          padding: "8px 14px",
                          borderRadius: "999px",
                          backgroundColor: "#0F172A",
                          color: "#FFFFFF",
                          border: "none",
                          cursor: "pointer",
                          fontWeight: 700,
                        }}
                      >
                        Use This Card
                      </button>
                    </div>
                  )
                ) : null}
              </div>

              {matchedCard ? (
                <div style={selectedCardPanelStyle}>
                  <span style={selectedBadgeStyle}>Selected Card</span>
                  <div style={{ color: "#0F172A", fontWeight: 700 }}>ID: {normalizeValue(matchedCard.issueId)}</div>
                  <div style={{ color: "#334155", fontSize: "0.9rem" }}>
                    Project: {normalizeValue(matchedCard.projectName) || "No project"}
                  </div>
                  <div style={{ color: "#334155", fontSize: "0.9rem" }}>
                    Title: {formatTitleWithTechnicalDetail(matchedCard.title, matchedCard.technicalDirection)}
                  </div>
                </div>
              ) : (
                <div style={{ color: "#64748B", fontSize: "0.9rem" }}>
                  Select a card to see ID, project, and title details.
                </div>
              )}
            </div>

            {!activeSession ? (
              <div style={{ display: "grid", gap: "8px", justifyItems: "center" }}>
                <button
                  type="button"
                  onClick={handleStart}
                  disabled={!canStartTimer}
                  style={{
                    ...startButtonStyle,
                    cursor: canStartTimer ? "pointer" : "not-allowed",
                    opacity: canStartTimer ? 1 : 0.55,
                    boxShadow: canStartTimer ? startButtonStyle.boxShadow : "none",
                  }}
                >
                  <span style={{ fontSize: "0.95rem", opacity: 0.88 }}>Timer</span>
                  <span style={{ fontSize: "1.25rem", fontWeight: 900 }}>Clock In</span>
                </button>
                {isStopping ? (
                  <div style={{ color: "#475569", fontSize: "0.84rem", fontWeight: 600 }}>
                    Previous clock-out is already saved on this screen. Cloud save will finish automatically.
                  </div>
                ) : null}
              </div>
            ) : (
              <div style={runningPanelStyle}>
                <div style={{ color: "#0F172A", fontWeight: 800 }}>
                  Running: {activeSession.issueId} • {normalizeValue(activeSession.projectName) || "No project"} • {formatTitleWithTechnicalDetail(activeSession.title, activeSession.technicalDirection)}
                </div>
                <div
                  style={{
                    color: "#0F172A",
                    fontWeight: 900,
                    fontSize: "clamp(2rem, 5vw, 3.2rem)",
                    lineHeight: 1,
                    letterSpacing: "0.02em",
                    textAlign: "center",
                  }}
                >
                  {formatDuration(activeDuration)}
                </div>
                <div style={{ color: "#475569", fontSize: "0.9rem" }}>
                  Started at {formatTimestamp(activeSession.startedAt)}
                </div>

                <div style={{ display: "grid", gap: "8px", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                  <input
                    value={noteInput}
                    onChange={(event) => setNoteInput(event.target.value)}
                    style={inputStyle}
                    placeholder="Add a note"
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleAddNote();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleAddNote}
                    style={{
                      width: "100%",
                      background: "linear-gradient(135deg, #1D4ED8 0%, #2563EB 100%)",
                      color: "#FFFFFF",
                      border: "none",
                      borderRadius: "10px",
                      padding: "10px 14px",
                      fontWeight: 700,
                      cursor: "pointer",
                      boxShadow: "0 8px 14px rgba(29, 78, 216, 0.22)",
                    }}
                  >
                    Add Note
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleStop}
                  style={{
                    ...stopButtonStyle,
                    cursor: "pointer",
                    opacity: 1,
                  }}
                >
                  <span style={{ fontSize: "0.95rem", opacity: 0.88 }}>Timer</span>
                  <span style={{ fontSize: "1.25rem", fontWeight: 900 }}>
                    {isStopping ? "Stopping..." : "Clock Out"}
                  </span>
                </button>

                {Array.isArray(activeSession.notes) && activeSession.notes.length > 0 ? (
                  <div style={{ display: "grid", gap: "6px" }}>
                    {activeSession.notes.map((noteEntry, noteIndex) => (
                      <div
                        key={`${noteEntry.timestamp || noteIndex}-${noteIndex}`}
                        style={{
                          border: "1px solid #CBD5E1",
                          borderRadius: "8px",
                          padding: "8px 10px",
                          backgroundColor: "#FFFFFF",
                        }}
                      >
                        <div style={{ color: "#0F172A", fontSize: "0.9rem" }}>{normalizeValue(noteEntry?.text) || "-"}</div>
                        <div style={{ color: "#64748B", fontSize: "0.78rem", marginTop: "2px" }}>
                          {formatTimestamp(noteEntry?.timestamp)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: "#64748B", fontSize: "0.9rem" }}>No notes added yet.</div>
                )}
              </div>
            )}

            {actionError ? <div style={{ color: "#B91C1C", fontWeight: 600 }}>{actionError}</div> : null}

            {latestStopReceipt ? (
              <div
                style={{
                  ...receiptCardStyle,
                  borderColor:
                    latestStopReceipt.status === "saved" || latestStopReceipt.status === "syncing"
                      ? "#86EFAC"
                      : latestStopReceipt.status === "error"
                        ? "#FCA5A5"
                        : "#BFDBFE",
                  backgroundColor:
                    latestStopReceipt.status === "saved" || latestStopReceipt.status === "syncing"
                      ? "#F0FDF4"
                      : latestStopReceipt.status === "error"
                        ? "#FEF2F2"
                        : "#EFF6FF",
                }}
              >
                <div style={{ fontWeight: 800, color: "#0F172A" }}>
                  {latestStopReceipt.status === "saved"
                    ? "Clock-Out Receipt"
                    : latestStopReceipt.status === "syncing"
                      ? "Clock-Out Receipt"
                      : latestStopReceipt.status === "error"
                        ? "Clock-Out Receipt (Needs Check)"
                        : "Clock-Out Receipt (Saving...)"}
                </div>
                <div style={{ color: "#334155", fontSize: "0.9rem" }}>
                  {latestStopReceipt.issueId} • {latestStopReceipt.projectName || "No project"} • {formatTitleWithTechnicalDetail(latestStopReceipt.title, latestStopReceipt.technicalDirection)}
                </div>
                <div style={{ color: "#475569", fontSize: "0.85rem" }}>
                  {formatTimestamp(latestStopReceipt.startedAt)} {"->"} {formatTimestamp(latestStopReceipt.endedAt)}
                </div>
                <div style={{ color: "#0F172A", fontWeight: 700, fontSize: "0.9rem" }}>
                  Duration {formatDuration(latestStopReceipt.durationMs)} • Notes {latestStopReceipt.notesCount}
                </div>
                <div style={{ color: "#334155", fontSize: "0.84rem", fontWeight: 600 }}>{latestStopReceipt.message}</div>
              </div>
            ) : null}
          </div>

          <div style={logWorkspaceStyle}>
            <div style={workspaceTitleStyle}>Recent Punch Log</div>
            {recentReceipts.length === 0 ? (
              <div style={{ color: "#64748B", fontSize: "0.9rem" }}>No saved entries yet.</div>
            ) : (
              <div style={{ display: "grid", gap: "8px" }}>
                {paginatedRecentReceipts.map((receipt) => {
                  const receiptNotes = Array.isArray(receipt.notes) ? receipt.notes : [];
                  const isExpanded = Boolean(expandedReceiptNotes[receipt.id]);
                  const notesToRender =
                    receiptNotes.length > 2 && !isExpanded ? receiptNotes.slice(0, 2) : receiptNotes;

                  return (
                    <div key={receipt.id} style={receiptCardStyle}>
                      <div style={{ color: "#0F172A", fontWeight: 800 }}>
                        {receipt.issueId || "No ID"} • {receipt.projectName || "No project"}
                      </div>
                      <div style={{ color: "#475569", fontSize: "0.86rem" }}>
                        {formatTimestamp(receipt.startedAt)} {"->"} {formatTimestamp(receipt.endedAt)}
                      </div>
                      <div style={{ color: "#334155", fontWeight: 700, fontSize: "0.88rem" }}>
                        {formatDuration(receipt.durationMs)} • Notes {receipt.notesCount}
                      </div>
                      {receiptNotes.length > 0 ? (
                        <div style={{ display: "grid", gap: "4px", marginTop: "4px" }}>
                          {notesToRender.map((noteEntry, noteIndex) => (
                            <div
                              key={`${noteEntry.timestamp || noteIndex}-${noteIndex}`}
                              style={{
                                border: "1px solid #E2E8F0",
                                borderRadius: "8px",
                                backgroundColor: "#F8FAFC",
                                padding: "6px 8px",
                              }}
                            >
                              <div style={{ color: "#0F172A", fontSize: "0.84rem" }}>
                                {normalizeValue(noteEntry?.text) || "-"}
                              </div>
                              <div style={{ color: "#64748B", fontSize: "0.75rem", marginTop: "2px" }}>
                                {formatTimestamp(noteEntry?.timestamp)}
                              </div>
                            </div>
                          ))}
                          {receiptNotes.length > 2 ? (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedReceiptNotes((current) => ({
                                  ...current,
                                  [receipt.id]: !current[receipt.id],
                                }))
                              }
                              style={{
                                justifySelf: "start",
                                border: "1px solid #BFDBFE",
                                backgroundColor: "#EFF6FF",
                                color: "#1D4ED8",
                                borderRadius: "999px",
                                padding: "4px 10px",
                                fontSize: "0.78rem",
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              {isExpanded
                                ? "Collapse notes"
                                : `Show ${receiptNotes.length - 2} more note${receiptNotes.length - 2 === 1 ? "" : "s"}`}
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        <div style={{ color: "#64748B", fontSize: "0.8rem", marginTop: "4px" }}>No notes.</div>
                      )}
                    </div>
                  );
                })}

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={() => setLogPage((current) => Math.max(1, current - 1))}
                    disabled={logPage <= 1}
                    style={{
                      border: "1px solid #CBD5E1",
                      backgroundColor: "#FFFFFF",
                      color: "#0F172A",
                      borderRadius: "999px",
                      padding: "6px 12px",
                      fontWeight: 700,
                      cursor: logPage <= 1 ? "not-allowed" : "pointer",
                      opacity: logPage <= 1 ? 0.5 : 1,
                    }}
                  >
                    Previous
                  </button>
                  <div style={{ color: "#475569", fontSize: "0.82rem", fontWeight: 700 }}>
                    Page {logPage} of {totalLogPages}
                  </div>
                  <button
                    type="button"
                    onClick={() => setLogPage((current) => Math.min(totalLogPages, current + 1))}
                    disabled={logPage >= totalLogPages}
                    style={{
                      border: "1px solid #CBD5E1",
                      backgroundColor: "#FFFFFF",
                      color: "#0F172A",
                      borderRadius: "999px",
                      padding: "6px 12px",
                      fontWeight: 700,
                      cursor: logPage >= totalLogPages ? "not-allowed" : "pointer",
                      opacity: logPage >= totalLogPages ? 0.5 : 1,
                    }}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TimeTracking;
