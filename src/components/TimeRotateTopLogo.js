import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { addDoc, collection, doc, onSnapshot, setDoc } from "firebase/firestore";
import commonStyles from "../pages/commonStyles";
import { useAuth } from "../contexts/AuthContext";
import { db } from "../firebase";
import { getChurchData } from "../api/church";

const normalizeValue = (value) => String(value ?? "").trim();
const normalizeKey = (value) => normalizeValue(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
const ISSUE_ID_ALIASES = ["issue id", "id", "task id", "card id", "row id"];
const TITLE_ALIASES = ["title", "issue title", "task title", "name"];

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

const findProjectRowFieldByAliases = (fields = [], rowData = {}, aliases = []) => {
  const normalizedAliases = aliases.map((alias) => normalizeKey(alias));
  const fieldCandidates = Array.isArray(fields) ? fields : [];

  for (const fieldCandidate of fieldCandidates) {
    const candidateName =
      normalizeValue(fieldCandidate?.name) ||
      normalizeValue(fieldCandidate?.field) ||
      normalizeValue(fieldCandidate?.label);

    if (!candidateName) continue;
    if (normalizedAliases.includes(normalizeKey(candidateName)) && Object.prototype.hasOwnProperty.call(rowData, candidateName)) {
      return candidateName;
    }
  }

  return findFieldByAliases(rowData, aliases);
};
const toMilliseconds = (value) => {
  if (value === null || value === undefined) return 0;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && asNumber > 0) return asNumber;

    const asDate = Date.parse(value);
    return Number.isFinite(asDate) ? asDate : 0;
  }

  if (typeof value?.toMillis === "function") {
    const millis = Number(value.toMillis());
    return Number.isFinite(millis) ? millis : 0;
  }

  if (typeof value === "object" && Number.isFinite(Number(value.seconds))) {
    const seconds = Number(value.seconds);
    const nanoseconds = Number(value.nanoseconds) || 0;
    return (seconds * 1000) + Math.floor(nanoseconds / 1000000);
  }

  return 0;
};
const resolveTaskTitle = (timerData = {}) => normalizeValue(timerData.title);
const resolveTimerStartTimestamp = (timerData = {}) => {
  const candidates = [
    timerData?.startedAt,
    timerData?.startTime,
    timerData?.startTimestamp,
    timerData?.createdAt,
  ];

  for (const candidate of candidates) {
    const milliseconds = toMilliseconds(candidate);
    if (milliseconds > 0) {
      return milliseconds;
    }
  }

  return 0;
};
const ONE_MINUTE_MS = 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;

const parseTimerNotes = (notesValue) => {
  if (!Array.isArray(notesValue)) return [];

  return notesValue
    .map((noteEntry) => ({
      text: normalizeValue(noteEntry?.text ?? noteEntry),
      timestamp: toMilliseconds(noteEntry?.timestamp ?? noteEntry?.time ?? noteEntry),
    }))
    .filter((noteEntry) => noteEntry.text || noteEntry.timestamp);
};

const getBrandingCache = (churchId) => {
  if (typeof window === "undefined" || !churchId) {
    return { logo: "", banner: "" };
  }

  try {
    const rawValue = window.localStorage.getItem(`timeRotateBranding-${churchId}`);
    if (!rawValue) {
      return { logo: "", banner: "" };
    }

    const parsedValue = JSON.parse(rawValue);
    return {
      logo: normalizeValue(parsedValue?.logo),
      banner: normalizeValue(parsedValue?.banner),
    };
  } catch (cacheError) {
    console.error("Error reading TimeRotate branding cache:", cacheError);
    return { logo: "", banner: "" };
  }
};

const setBrandingCache = (churchId, branding) => {
  if (typeof window === "undefined" || !churchId) {
    return;
  }

  try {
    window.localStorage.setItem(
      `timeRotateBranding-${churchId}`,
      JSON.stringify({
        logo: normalizeValue(branding?.logo),
        banner: normalizeValue(branding?.banner),
      })
    );
  } catch (cacheError) {
    console.error("Error saving TimeRotate branding cache:", cacheError);
  }
};

const formatDuration = (milliseconds) => {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const logoStyle = {
  ...commonStyles.logo,
  width: "180px",
  height: "180px",
  objectFit: "contain",
  objectPosition: "center",
  display: "block",
  backgroundColor: "#FFFFFF",
  padding: "8px",
  boxSizing: "border-box",
};

const bannerContainerStyle = {
  width: "100%",
  maxWidth: "1100px",
  minHeight: "190px",
  borderRadius: "16px",
  overflow: "hidden",
  position: "relative",
  border: "1px solid #D6DCE8",
  boxShadow: "0 10px 22px rgba(15, 23, 42, 0.12)",
  background: "linear-gradient(135deg, #F1F5F9 0%, #E2E8F0 100%)",
};

const bannerImageStyle = {
  width: "100%",
  height: "220px",
  objectFit: "cover",
  display: "block",
};

const bannerOverlayStyle = {
  position: "absolute",
  inset: 0,
  background: "linear-gradient(180deg, rgba(15, 23, 42, 0.2) 0%, rgba(15, 23, 42, 0.42) 100%)",
};

const logoOverlayStyle = {
  position: "absolute",
  inset: 0,
  display: "grid",
  placeItems: "center",
};

const loadingLogoStyle = {
  ...logoStyle,
  width: "150px",
  height: "150px",
  animation: "timeRotateLogoPulse 1.35s ease-in-out infinite",
  boxShadow: "0 10px 20px rgba(15, 23, 42, 0.18)",
};

const statusBarBaseStyle = {
  width: "100%",
  maxWidth: "1100px",
  borderRadius: "12px",
  padding: "10px 14px",
  display: "grid",
  gap: "4px",
  marginBottom: "10px",
};

const statusBarStyles = {
  red: {
    border: "1px solid #FCA5A5",
    background: "linear-gradient(135deg, #B91C1C 0%, #EF4444 100%)",
    color: "#FEF2F2",
    boxShadow: "0 8px 18px rgba(185, 28, 28, 0.32)",
  },
  orange: {
    border: "1px solid #FDBA74",
    background: "linear-gradient(135deg, #C2410C 0%, #F97316 100%)",
    color: "#FFF7ED",
    boxShadow: "0 8px 18px rgba(194, 65, 12, 0.28)",
  },
  yellow: {
    border: "1px solid #FDE68A",
    background: "linear-gradient(135deg, #A16207 0%, #FACC15 100%)",
    color: "#422006",
    boxShadow: "0 8px 18px rgba(161, 98, 7, 0.28)",
  },
};

const pageLoaderOverlayStyle = {
  position: "fixed",
  inset: 0,
  display: "grid",
  placeItems: "center",
  backgroundColor: "rgba(15, 23, 42, 0.34)",
  backdropFilter: "blur(2px)",
  zIndex: 2000,
  pointerEvents: "none",
};

const pageLoaderCardStyle = {
  display: "grid",
  justifyItems: "center",
  gap: "12px",
  padding: 0,
  backgroundColor: "transparent",
  border: "none",
  boxShadow: "none",
};

const pageLoaderLogoWrapStyle = {
  width: "184px",
  height: "184px",
  borderRadius: "50%",
  display: "grid",
  placeItems: "center",
  background: "radial-gradient(circle, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.06) 62%, rgba(255,255,255,0) 100%)",
};

const quickNoteBarStyle = {
  position: "fixed",
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 1400,
  background: "linear-gradient(135deg, #1D4ED8 0%, #2563EB 100%)",
  borderTop: "1px solid rgba(147, 197, 253, 0.65)",
  boxShadow: "0 -10px 22px rgba(15, 23, 42, 0.22)",
  padding: "10px 12px",
};

const TimeRotateTopLogo = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const initialBranding = getBrandingCache(id);
  const [churchLogo, setChurchLogo] = useState(initialBranding.logo);
  const [churchBanner, setChurchBanner] = useState(initialBranding.banner);
  const [activeTimer, setActiveTimer] = useState(null);
  const [activeTimerDetectedAt, setActiveTimerDetectedAt] = useState(0);
  const [noTimerReminderCycleStart, setNoTimerReminderCycleStart] = useState(Date.now());
  const [titleByIssueId, setTitleByIssueId] = useState({});
  const [currentTick, setCurrentTick] = useState(Date.now());
  const [quickNoteInput, setQuickNoteInput] = useState("");
  const [quickNoteStatus, setQuickNoteStatus] = useState("");

  const resolvedUserId = normalizeValue(user?.uid);
  const resolvedUserEmail = normalizeValue(user?.email);
  const resolvedUserDisplay = normalizeValue(user?.name || user?.displayName || user?.email);
  const activeTimerOwnerKey = normalizeValue(resolvedUserId || resolvedUserEmail || resolvedUserDisplay);
  const activeTimerDocKey = normalizeKey(activeTimerOwnerKey);

  useEffect(() => {
    let isMounted = true;

    const loadChurchBranding = async () => {
      if (!id) {
        if (!isMounted) return;
        setLoading(false);
        return;
      }

      const cachedBranding = getBrandingCache(id);
      if (isMounted) {
        if (cachedBranding.logo) setChurchLogo(cachedBranding.logo);
        if (cachedBranding.banner) setChurchBanner(cachedBranding.banner);
      }

      try {
        const churchData = await getChurchData(id);
        if (!isMounted) return;
        const nextLogo = String(churchData?.logo || "").trim();
        const nextBanner = String(churchData?.banner || "").trim();
        if (nextLogo) setChurchLogo(nextLogo);
        if (nextBanner) setChurchBanner(nextBanner);
        setBrandingCache(id, { logo: nextLogo || cachedBranding.logo, banner: nextBanner || cachedBranding.banner });
      } catch (brandingError) {
        console.error("Error loading church logo:", brandingError);
      } finally {
        if (!isMounted) return;
        setLoading(false);
      }
    };

    setLoading(true);
    loadChurchBranding();

    return () => {
      isMounted = false;
    };
  }, [id]);

  useEffect(() => {
    if (!id) {
      setTitleByIssueId({});
      return undefined;
    }

    const unsubscribe = onSnapshot(
      collection(db, "churches", id, "bimProjects"),
      (snapshot) => {
        const nextTitleByIssueId = {};

        snapshot.docs.forEach((projectDoc) => {
          const projectData = projectDoc.data() || {};
          const fields = Array.isArray(projectData.fields) ? projectData.fields : [];
          const rows = Array.isArray(projectData.rows) ? projectData.rows : [];

          rows.forEach((row, rowIndex) => {
            const rowData = row?.rowData || {};

            const issueIdField = findProjectRowFieldByAliases(fields, rowData, ISSUE_ID_ALIASES);
            const titleField = findProjectRowFieldByAliases(fields, rowData, TITLE_ALIASES);

            const issueId =
              normalizeValue(issueIdField ? rowData[issueIdField] : "") ||
              String(row?.rowNumber || rowIndex + 1);
            const title = normalizeValue(titleField ? rowData[titleField] : "");

            if (!issueId || !title) return;
            const normalizedIssueIdKey = normalizeKey(issueId);
            if (!normalizedIssueIdKey) return;
            nextTitleByIssueId[normalizedIssueIdKey] = title;
          });
        });

        setTitleByIssueId(nextTitleByIssueId);
      },
      (snapshotError) => {
        console.error("Error loading production card titles for top bar:", snapshotError);
        setTitleByIssueId({});
      }
    );

    return () => unsubscribe();
  }, [id]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setCurrentTick(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!activeTimer) {
      setNoTimerReminderCycleStart((previousValue) => previousValue || Date.now());
      setActiveTimerDetectedAt(0);
      return;
    }

    setNoTimerReminderCycleStart(0);

    const resolvedStart = resolveTimerStartTimestamp(activeTimer);
    if (resolvedStart > 0) {
      setActiveTimerDetectedAt(0);
      return;
    }

    setActiveTimerDetectedAt((previousDetectedAt) => previousDetectedAt || Date.now());
  }, [activeTimer]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const previousBodyPaddingBottom = document.body.style.paddingBottom;

    if (activeTimer) {
      document.body.style.paddingBottom = "140px";
    } else {
      document.body.style.paddingBottom = "";
    }

    return () => {
      document.body.style.paddingBottom = previousBodyPaddingBottom;
    };
  }, [activeTimer]);

  useEffect(() => {
    if (!id) {
      setActiveTimer(null);
      return undefined;
    }

    const currentUserId = normalizeValue(resolvedUserId);
    const currentUserEmail = normalizeValue(resolvedUserEmail);
    const currentOwnerKey = normalizeValue(activeTimerOwnerKey);
    const currentRegisteredBy = normalizeValue(user?.name || user?.displayName || user?.email);

    if (!currentUserId && !currentUserEmail && !currentOwnerKey && !currentRegisteredBy) {
      setActiveTimer(null);
      return undefined;
    }

    const unsubscribe = onSnapshot(
      collection(db, "churches", id, "timeRotateActiveTimers"),
      (snapshot) => {
        const entries = snapshot.docs
          .map((docEntry) => {
            const data = docEntry.data() || {};
            return {
              docId: normalizeValue(docEntry.id),
              issueId: normalizeValue(data.issueId),
              projectName: normalizeValue(data.projectName),
              title: resolveTaskTitle(data),
              notes: parseTimerNotes(data.notes),
              startedAt: resolveTimerStartTimestamp(data),
              updatedAt: toMilliseconds(data.updatedAt),
              userId: normalizeValue(data.userId),
              userEmail: normalizeValue(data.userEmail),
              ownerKey: normalizeValue(data.ownerKey),
              registeredBy: normalizeValue(data.registeredBy),
            };
          })
          .filter((entry) => Number(entry.startedAt) > 0);

        const matchedTimer = entries
          .filter((entry) => {
            if (activeTimerDocKey && normalizeKey(entry.docId) === activeTimerDocKey) return true;
            if (currentUserId && entry.userId === currentUserId) return true;
            if (currentUserEmail && normalizeValue(entry.userEmail).toLowerCase() === currentUserEmail.toLowerCase()) return true;
            if (currentOwnerKey && entry.ownerKey === currentOwnerKey) return true;
            if (currentRegisteredBy && entry.registeredBy === currentRegisteredBy) return true;
            return false;
          })
          .sort((left, right) => {
            const rightStartedAt = resolveTimerStartTimestamp(right);
            const leftStartedAt = resolveTimerStartTimestamp(left);
            if (rightStartedAt !== leftStartedAt) {
              return rightStartedAt - leftStartedAt;
            }
            return Number(right.updatedAt || 0) - Number(left.updatedAt || 0);
          })[0];

        if (matchedTimer) {
          setActiveTimer(matchedTimer);
          return;
        }

        setActiveTimer(null);
      },
      (snapshotError) => {
        console.error("Error loading active timer status bar:", snapshotError);
        setActiveTimer(null);
      }
    );

    return () => unsubscribe();
  }, [activeTimerDocKey, activeTimerOwnerKey, id, resolvedUserEmail, resolvedUserId, user?.displayName, user?.email, user?.name]);

  const activeStartedAt = resolveTimerStartTimestamp(activeTimer);
  const effectiveStartedAt = activeStartedAt || activeTimerDetectedAt;
  const activeDuration = activeTimer ? Math.max(0, currentTick - (effectiveStartedAt || currentTick)) : 0;
  const hasAnyTimerNotes = Array.isArray(activeTimer?.notes) && activeTimer.notes.some((noteEntry) => {
    const noteText = normalizeValue(noteEntry?.text);
    const noteTimestamp = toMilliseconds(noteEntry?.timestamp);
    return Boolean(noteText || noteTimestamp);
  });
  const lastNoteTimestamp = Array.isArray(activeTimer?.notes)
    ? activeTimer.notes.reduce((latest, noteEntry) => Math.max(latest, toMilliseconds(noteEntry?.timestamp)), 0)
    : 0;
  const noteReferenceTimestamp = lastNoteTimestamp || effectiveStartedAt;
  const needsInitialNotePrompt = Boolean(
    activeTimer &&
      !hasAnyTimerNotes &&
      activeDuration >= ONE_MINUTE_MS &&
      activeDuration < THIRTY_MINUTES_MS
  );
  const initialNotePromptSecondInMinute = Math.floor((activeDuration % 60000) / 1000);
  const shouldAnimateInitialNotePrompt = needsInitialNotePrompt && initialNotePromptSecondInMinute < 15;
  const needsNoteReminder = Boolean(activeTimer && noteReferenceTimestamp && currentTick - noteReferenceTimestamp >= THIRTY_MINUTES_MS);
  const activeIssueIdKey = normalizeKey(activeTimer?.issueId);
  const resolvedActiveTitle = normalizeValue(titleByIssueId[activeIssueIdKey]) || normalizeValue(activeTimer?.title);
  const barVariant = !activeTimer ? "orange" : needsNoteReminder ? "yellow" : "red";
  const statusBarStyle = { ...statusBarBaseStyle, ...statusBarStyles[barVariant] };
  const reminderCycleElapsed = Math.max(0, currentTick - (noTimerReminderCycleStart || currentTick));
  const reminderMinuteIndex = Math.floor(reminderCycleElapsed / 60000);
  const reminderSecondInMinute = Math.floor((reminderCycleElapsed % 60000) / 1000);
  const shouldAnimateNoTimerReminder = !activeTimer && reminderMinuteIndex % 2 === 0 && reminderSecondInMinute < 10;
  const noTimerBlinkSecondsRemaining = shouldAnimateNoTimerReminder ? Math.max(0, 10 - reminderSecondInMinute) : 0;

  const handleAddQuickNote = () => {
    const noteText = normalizeValue(quickNoteInput);
    if (!activeTimer || !noteText) return;

    const noteTimestamp = Date.now();
    const nextNotes = [
      ...(Array.isArray(activeTimer.notes) ? activeTimer.notes : []),
      { text: noteText, timestamp: noteTimestamp },
    ];

    setQuickNoteStatus("");

    // Local-first update for instant UX; existing activeTimer sync effect pushes to Firestore.
    setActiveTimer((previous) => (previous ? { ...previous, notes: nextNotes, updatedAt: noteTimestamp } : previous));
    setQuickNoteInput("");

    if (typeof window !== "undefined") {
      try {
        const localStorageKey = `timeRotateActiveTimer-${id}-${activeTimerOwnerKey || "anonymous"}`;
        window.localStorage.setItem(
          localStorageKey,
          JSON.stringify({
            ...activeTimer,
            notes: nextNotes,
            updatedAt: noteTimestamp,
          })
        );
      } catch (persistError) {
        console.error("Error persisting quick note locally:", persistError);
      }

      // Broadcast so active timer UIs on this page can reflect the note immediately.
      window.dispatchEvent(
        new CustomEvent("timeRotateQuickNoteAdded", {
          detail: {
            issueId: normalizeValue(activeTimer.issueId),
            startedAt: Number(activeTimer.startedAt) || 0,
            note: {
              text: noteText,
              timestamp: noteTimestamp,
            },
          },
        })
      );
    }

    // Persist to the same active timer doc used by the main TimeRotate flow.
    const remoteDocId = normalizeValue(activeTimer?.docId) || normalizeValue(activeTimerDocKey) || normalizeValue(activeTimerOwnerKey);
    if (id && remoteDocId) {
      void setDoc(
        doc(db, "churches", id, "timeRotateActiveTimers", remoteDocId),
        {
          notes: nextNotes,
          updatedAt: noteTimestamp,
        },
        { merge: true }
      ).catch((noteError) => {
        console.error("Error syncing quick note from bottom bar:", noteError);
        setQuickNoteStatus("Saved locally. Syncing in background...");
      });

      // Mirror note updates into the Time Tracker audit stream.
      const previousNoteText = normalizeValue((Array.isArray(activeTimer.notes) ? activeTimer.notes : []).slice(-1)[0]?.text);
      const latestNoteText = normalizeValue(nextNotes.slice(-1)[0]?.text);

      void addDoc(collection(db, "churches", id, "timeRotateEditLogs"), {
        issueId: normalizeValue(activeTimer.issueId),
        projectName: normalizeValue(activeTimer.projectName),
        editedAt: noteTimestamp,
        editedBy: normalizeValue(user?.name || user?.displayName || user?.email || activeTimer.registeredBy || "Unknown user"),
        fromRegisteredBy: normalizeValue(activeTimer.registeredBy),
        toRegisteredBy: normalizeValue(activeTimer.registeredBy),
        fromStartedAt: Number(activeTimer.startedAt) || 0,
        toStartedAt: Number(activeTimer.startedAt) || 0,
        fromEndedAt: 0,
        toEndedAt: 0,
        fromDurationMs: 0,
        toDurationMs: 0,
        fromTaskTags: [],
        toTaskTags: [],
        fromNotes: previousNoteText ? [previousNoteText] : [],
        toNotes: latestNoteText ? [latestNoteText] : [],
        changedFields: ["notes"],
        source: "top-bar-quick-note",
      }).catch((logError) => {
        console.error("Error writing quick note audit log:", logError);
      });
    }

    setQuickNoteStatus("Note added");
  };

  return (
    <div
      style={{
        ...commonStyles.logoContainer,
        cursor: "default",
        marginTop: 0,
        marginBottom: "10px",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        gap: "10px",
      }}
    >
      <style>
        {`@keyframes timeRotateLogoPulse {
          0% { transform: scale(0.82); opacity: 0.78; filter: drop-shadow(0 0 0 rgba(59, 130, 246, 0)); }
          50% { transform: scale(1.08); opacity: 1; filter: drop-shadow(0 0 18px rgba(59, 130, 246, 0.35)); }
          100% { transform: scale(0.82); opacity: 0.78; filter: drop-shadow(0 0 0 rgba(59, 130, 246, 0)); }
        }

        @keyframes timeRotateReminderBlink {
          0% { opacity: 1; transform: translateY(0); }
          50% { opacity: 0.52; transform: translateY(-1px); }
          100% { opacity: 1; transform: translateY(0); }
        }`}
      </style>

      {loading ? (
        <div style={pageLoaderOverlayStyle}>
          <div style={pageLoaderCardStyle}>
            <div style={pageLoaderLogoWrapStyle}>
              <img
                src={churchLogo || "/img/logo-fallback.svg"}
                alt="Church Logo Loading"
                style={loadingLogoStyle}
                onError={(event) => {
                  event.currentTarget.src = "/img/logo-fallback.svg";
                }}
              />
            </div>
            <div style={{ color: "#0F172A", fontSize: "0.9rem", fontWeight: 800, letterSpacing: "0.02em" }}>
              Loading page...
            </div>
          </div>
        </div>
      ) : null}

      <div style={statusBarStyle}>
        {!activeTimer ? (
          <>
            <div
              style={{
                fontWeight: 900,
                fontSize: "0.9rem",
                letterSpacing: "0.02em",
                textTransform: "uppercase",
                animation: shouldAnimateNoTimerReminder ? "timeRotateReminderBlink 1.05s ease-in-out infinite" : "none",
              }}
            >
              Reminder
            </div>
            <div
              style={{
                fontWeight: 800,
                fontSize: "0.95rem",
                animation: shouldAnimateNoTimerReminder ? "timeRotateReminderBlink 1.05s ease-in-out infinite" : "none",
              }}
            >
              Hey dont forget to start your time today! That is important to better track our project.
            </div>
            {shouldAnimateNoTimerReminder ? (
              <div style={{ fontWeight: 900, fontSize: "0.92rem", letterSpacing: "0.01em" }}>
                Attention ends in {String(noTimerBlinkSecondsRemaining).padStart(2, "0")}s
              </div>
            ) : null}
          </>
        ) : needsInitialNotePrompt ? (
          <>
            <div style={{ fontWeight: 900, fontSize: "0.9rem", letterSpacing: "0.02em", textTransform: "uppercase" }}>
              Timer Running
            </div>
            <div style={{ fontWeight: 700, color: "#FFE4E6" }}>
              {activeTimer.issueId || "No ID"} • {activeTimer.projectName || "No project"} • {resolvedActiveTitle || "No title"}
            </div>
            <div
              style={{
                fontWeight: 800,
                fontSize: "0.95rem",
                animation: shouldAnimateInitialNotePrompt ? "timeRotateReminderBlink 1.05s ease-in-out infinite" : "none",
              }}
            >
              Add a Note please.
            </div>
            <div style={{ fontWeight: 900, fontSize: "2.1rem", lineHeight: 1.05 }}>Elapsed {formatDuration(activeDuration)}</div>
          </>
        ) : needsNoteReminder ? (
          <>
            <div style={{ fontWeight: 900, fontSize: "0.9rem", letterSpacing: "0.02em", textTransform: "uppercase" }}>
              Note Reminder
            </div>
            <div style={{ fontWeight: 700 }}>
              {activeTimer.issueId || "No ID"} • {activeTimer.projectName || "No project"} • {resolvedActiveTitle || "No title"}
            </div>
            <div style={{ fontWeight: 800, fontSize: "0.95rem" }}>
              Add a Note please.
            </div>
            <div style={{ fontWeight: 900, fontSize: "2.1rem", lineHeight: 1.05 }}>Elapsed {formatDuration(activeDuration)}</div>
          </>
        ) : (
          <>
            <div style={{ fontWeight: 900, fontSize: "0.9rem", letterSpacing: "0.02em", textTransform: "uppercase" }}>
              Timer Running
            </div>
            <div style={{ fontWeight: 700, color: "#FFE4E6" }}>
              {activeTimer.issueId || "No ID"} • {activeTimer.projectName || "No project"} • {resolvedActiveTitle || "No title"}
            </div>
            <div style={{ fontWeight: 900, fontSize: "2.1rem", lineHeight: 1.05 }}>Elapsed {formatDuration(activeDuration)}</div>
          </>
        )}
      </div>

      <div style={bannerContainerStyle}>
        <img
          src={churchBanner || "/img/banner-fallback.svg"}
          alt="Church Banner"
          style={bannerImageStyle}
          onError={(event) => {
            event.currentTarget.src = "/img/banner-fallback.svg";
          }}
        />
        <div style={bannerOverlayStyle} />
        <div style={logoOverlayStyle}>
          <img
            src={churchLogo || "/img/logo-fallback.svg"}
            alt="Church Logo"
            style={logoStyle}
            onError={(event) => {
              event.currentTarget.src = "/img/logo-fallback.svg";
            }}
          />
        </div>
      </div>

      {activeTimer ? (
        <div style={quickNoteBarStyle}>
          <div
            style={{
              width: "100%",
              maxWidth: "1100px",
              margin: "0 auto",
              display: "grid",
              gap: "8px",
            }}
          >
            <div style={{ color: "#DBEAFE", fontWeight: 800, fontSize: "0.88rem" }}>
              Time is running. Add a quick note:
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "8px" }}>
              <input
                value={quickNoteInput}
                onChange={(event) => setQuickNoteInput(event.target.value)}
                placeholder="Type note and click Add Note"
                style={{
                  width: "100%",
                  padding: "9px 10px",
                  borderRadius: "8px",
                  border: "1px solid #93C5FD",
                  backgroundColor: "#FFFFFF",
                  color: "#0F172A",
                  fontWeight: 600,
                }}
              />
              <button
                type="button"
                onClick={handleAddQuickNote}
                disabled={!normalizeValue(quickNoteInput)}
                style={{
                  padding: "9px 12px",
                  borderRadius: "8px",
                  border: "1px solid #1E40AF",
                  backgroundColor: "#0F172A",
                  color: "#FFFFFF",
                  fontWeight: 800,
                  cursor: !normalizeValue(quickNoteInput) ? "not-allowed" : "pointer",
                  opacity: !normalizeValue(quickNoteInput) ? 0.65 : 1,
                }}
              >
                Add Note
              </button>
            </div>
            {quickNoteStatus ? (
              <div style={{ color: quickNoteStatus === "Note added" ? "#DCFCE7" : "#FECACA", fontWeight: 700, fontSize: "0.8rem" }}>
                {quickNoteStatus}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default TimeRotateTopLogo;
