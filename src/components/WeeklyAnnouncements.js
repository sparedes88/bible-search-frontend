import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useLocation, useNavigate } from "react-router-dom";
import { collection, doc, getDoc, getDocs, orderBy, query, serverTimestamp, setDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import { db, storage } from "../firebase";
import { getChurchData } from "../api/church";
import { toast } from "react-toastify";
import commonStyles from "../pages/commonStyles";
import { useAuth } from "../contexts/AuthContext";
import "./WeeklyAnnouncements.css";

const DAY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const DAY_LABELS = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

const MAX_RECURRING_WEEKS = 52;

const toDateInput = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const toDisplayDate = (value) => {
  if (!value || typeof value !== "string") return value || "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${month}-${day}-${year}`;
};

const createCardId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createAgendaItemId = () => `agenda-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createAgendaItem = () => ({
  taskId: createAgendaItemId(),
  task: "",
  responsible: "",
  minutes: "",
  notes: "",
  recurringConstant: false,
  recurrenceTaskSourceKey: "",
});

const getWeekStartDate = (inputDate = new Date()) => {
  const date = new Date(inputDate);
  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diffToMonday);
  date.setHours(0, 0, 0, 0);
  return date;
};

const buildWeekEntries = (weekStartDate) => {
  return DAY_KEYS.map((dayKey, index) => {
    const date = new Date(weekStartDate);
    date.setDate(weekStartDate.getDate() + index);

    return {
      dayKey,
      date: toDateInput(date),
      announcements: [],
    };
  });
};

const buildSafeWeekEntries = (rawEntries, weekStartDate) => {
  const baseEntries = buildWeekEntries(weekStartDate);

  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    return baseEntries;
  }

  return baseEntries.map((baseEntry, index) => {
    const byDayKey = rawEntries.find((entry) => entry?.dayKey === baseEntry.dayKey);
    const byIndex = rawEntries[index];
    const source = byDayKey || byIndex || {};

    return {
      ...baseEntry,
      ...source,
      dayKey: baseEntry.dayKey,
      date: baseEntry.date,
      announcements: Array.isArray(source.announcements) ? source.announcements : [],
    };
  });
};

const formatAddressValue = (address) => {
  if (typeof address === "string") {
    return address;
  }

  if (address && typeof address === "object") {
    const orderedParts = [
      address.street,
      address.city,
      address.state,
      address.country,
      address.zip,
    ];

    return orderedParts
      .map((part) => String(part || "").trim())
      .filter(Boolean)
      .join(", ");
  }

  return "";
};

const toDisplayText = (value) => {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object") {
    return Object.values(value)
      .filter((part) => part !== undefined && part !== null && String(part).trim() !== "")
      .map((part) => String(part).trim())
      .join(", ");
  }

  if (value === undefined || value === null) {
    return "";
  }

  return String(value);
};

const normalizeHttpUrl = (value) => {
  if (!value) return "";
  const trimmed = String(value).trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^www\./i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return "";
};

const getLocationLinks = (announcement) => {
  const rawLocation = String(announcement?.location || "").trim();
  const explicitLink = String(announcement?.locationLink || "").trim();
  const linkCandidate = explicitLink || rawLocation;
  const directUrl = normalizeHttpUrl(linkCandidate);

  if (directUrl) {
    return {
      label: rawLocation || directUrl,
      primaryHref: directUrl,
    };
  }

  const addressCandidate =
    String(announcement?.locationAddress || "").trim() ||
    String(announcement?.campusAddress || "").trim() ||
    rawLocation;

  if (!addressCandidate) {
    return {
      label: "",
      primaryHref: "",
    };
  }

  const encodedAddress = encodeURIComponent(addressCandidate);
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent);
  const isAndroid = /Android/i.test(userAgent);

  const preferredMapHref = isIOS
    ? `https://maps.apple.com/?q=${encodedAddress}`
    : isAndroid
    ? `geo:0,0?q=${encodedAddress}`
    : `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;

  return {
    label: rawLocation || addressCandidate,
    primaryHref: preferredMapHref,
  };
};

const getDefaultRecurringWeeks = (mode) => {
  if (mode === "weekly") return 26;
  if (mode === "monthly") return 4;
  if (mode === "three_months") return 12;
  return 0;
};

const getAnnouncementRecurringWeeks = (announcement) => {
  const mode = announcement?.recurringMode || "none";
  if (mode === "none") return 0;

  const parsed = Number(announcement?.recurringWeeks);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(MAX_RECURRING_WEEKS, Math.floor(parsed));
  }

  return getDefaultRecurringWeeks(mode);
};

const isMasterRecurringAnnouncement = (announcement) => {
  return Boolean(
    announcement &&
      announcement.recurringMode &&
      announcement.recurringMode !== "none" &&
      !announcement.recurrenceSourceKey
  );
};

const isRecurringCopyAnnouncement = (announcement) => {
  return Boolean(announcement?.recurrenceSourceKey);
};

const normalizeEntriesForUi = (rawEntries = [], defaultEditing = false) => {
  return rawEntries.map((dayEntry) => ({
    ...dayEntry,
    announcements: (dayEntry.announcements || []).map((announcement) => ({
      ...announcement,
      cardId: announcement.cardId || createCardId(),
      title: announcement.title || "",
      startTime: announcement.startTime || announcement.time || "",
      endTime: announcement.endTime || "",
      recurringMode: announcement.recurringMode || "none",
      recurringWeeks: getAnnouncementRecurringWeeks(announcement),
      locationType:
        announcement.locationType ||
        (announcement.locationLink ? "link" : announcement.campusId ? "campus" : "address"),
      locationAddress: announcement.locationAddress || "",
      locationLink: announcement.locationLink || "",
      imageUrl: announcement.imageUrl || "",
      imageName: announcement.imageName || "",
      imagePath: announcement.imagePath || "",
      agendaItems: Array.isArray(announcement.agendaItems)
        ? announcement.agendaItems.map((item) => ({
            taskId: item?.taskId || createAgendaItemId(),
            task: item?.task || "",
            responsible: item?.responsible || "",
            minutes: item?.minutes ?? "",
            notes: item?.notes || "",
            recurringConstant: Boolean(item?.recurringConstant),
            recurrenceTaskSourceKey: item?.recurrenceTaskSourceKey || "",
          }))
        : [],
      isEditing:
        typeof announcement.isEditing === "boolean" ? announcement.isEditing : defaultEditing,
    })),
  }));
};

const serializeEntriesForSave = (uiEntries = []) => {
  return uiEntries.map((dayEntry) => ({
    ...dayEntry,
    announcements: (dayEntry.announcements || []).map(({ isEditing, ...announcement }) => announcement),
  }));
};

const getAnnouncementCount = (entriesList = []) => {
  return (entriesList || []).reduce((total, dayEntry) => {
    return total + ((dayEntry?.announcements || []).length || 0);
  }, 0);
};

const WeeklyAnnouncements = ({ publicView: publicViewProp = false }) => {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEditWeeklyAnnouncements =
    user?.role === "admin" || user?.role === "global_admin";
  const publicView = publicViewProp || !canEditWeeklyAnnouncements;

  const getInitialWeekStart = () => {
    const fallback = toDateInput(getWeekStartDate());
    try {
      const params = new URLSearchParams(window.location.search);
      const weekFromUrl = params.get("weekStart");
      if (weekFromUrl && /^\d{4}-\d{2}-\d{2}$/.test(weekFromUrl)) {
        return weekFromUrl;
      }
      if (!id) return fallback;
      const stored = localStorage.getItem(`weeklyAnnouncementsWeekStart:${id}`);
      return stored || fallback;
    } catch {
      return fallback;
    }
  };

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [weekStart, setWeekStart] = useState(getInitialWeekStart);
  const [entries, setEntries] = useState([]);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoName, setVideoName] = useState("");
  const [videoPath, setVideoPath] = useState("");
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [campuses, setCampuses] = useState([]);
  const [uploadingImages, setUploadingImages] = useState({});
  const [imageUploadProgress, setImageUploadProgress] = useState({});
  const [organizationLogo, setOrganizationLogo] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const entriesRef = useRef([]);
  const [lastSavedAt, setLastSavedAt] = useState("");
  const [autosaveStatus, setAutosaveStatus] = useState("");
  const autosaveTimerRef = useRef(null);
  const skipAutosaveRef = useRef(true);

  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const selectedDayKey = searchParams.get("dayKey") || "";
  const selectedCardId = searchParams.get("cardId") || "";
  const isCardDetailOpen = Boolean(selectedDayKey && selectedCardId);

  const selectedDayIndex = useMemo(() => {
    if (!selectedDayKey) return -1;
    return entries.findIndex((entry) => entry?.dayKey === selectedDayKey);
  }, [entries, selectedDayKey]);

  const selectedAnnouncementIndex = useMemo(() => {
    if (selectedDayIndex < 0 || !selectedCardId) return -1;
    const announcements = entries[selectedDayIndex]?.announcements || [];
    return announcements.findIndex((announcement) => announcement?.cardId === selectedCardId);
  }, [entries, selectedDayIndex, selectedCardId]);

  const selectedAnnouncement =
    selectedDayIndex >= 0 && selectedAnnouncementIndex >= 0
      ? entries[selectedDayIndex]?.announcements?.[selectedAnnouncementIndex] || null
      : null;

  const openCardDetails = (dayKey, cardId) => {
    if (!dayKey || !cardId) return;
    const nextParams = new URLSearchParams(location.search);
    nextParams.set("weekStart", weekStart);
    nextParams.set("dayKey", dayKey);
    nextParams.set("cardId", cardId);
    navigate({ pathname: location.pathname, search: `?${nextParams.toString()}` });
  };

  const closeCardDetails = () => {
    const nextParams = new URLSearchParams(location.search);
    nextParams.delete("dayKey");
    nextParams.delete("cardId");
    navigate({ pathname: location.pathname, search: `?${nextParams.toString()}` });
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const weekFromUrl = params.get("weekStart");
    if (weekFromUrl && /^\d{4}-\d{2}-\d{2}$/.test(weekFromUrl)) {
      setWeekStart((previous) => (previous === weekFromUrl ? previous : weekFromUrl));
    }
  }, [location.search]);

  const weekStartDate = useMemo(() => new Date(`${weekStart}T00:00:00`), [weekStart]);

  useEffect(() => {
    const loadWeeklyAnnouncements = async () => {
      if (!id) return;

      setLoading(true);

      try {
        const docRef = doc(db, "churches", id, "weeklyAnnouncements", weekStart);
        const snap = await getDoc(docRef);

        if (snap.exists()) {
          const data = snap.data();
          const safeEntries = buildSafeWeekEntries(data.entries, weekStartDate);
          setEntries(normalizeEntriesForUi(safeEntries, false));
          setVideoUrl(data.videoUrl || "");
          setVideoName(data.videoName || "");
          setVideoPath(data.videoPath || "");
        } else {
          setEntries(buildWeekEntries(weekStartDate));
          setVideoUrl("");
          setVideoName("");
          setVideoPath("");
        }
      } catch (error) {
        console.error("Error loading weekly announcements:", error);
        toast.error("Could not load weekly communication");
      } finally {
        setLoading(false);
      }
    };

    loadWeeklyAnnouncements();
  }, [id, weekStart, weekStartDate]);

  useEffect(() => {
    if (publicView) return;

    const fetchCampuses = async () => {
      if (!id) return;

      try {
        const campusesRef = collection(db, "churches", id, "campuses");
        const q = query(campusesRef, orderBy("name"));
        const snapshot = await getDocs(q);
        const campusesData = snapshot.docs.map((campusDoc) => {
          const data = campusDoc.data();
          const name = toDisplayText(data?.name);
          const address = formatAddressValue(data?.address);

          return {
            id: campusDoc.id,
            name,
            address,
            label: address ? `${name} - ${address}` : name,
          };
        });

        setCampuses(campusesData);
      } catch (error) {
        console.error("Error loading campuses:", error);
      }
    };

    fetchCampuses();
  }, [id, publicView]);

  useEffect(() => {
    try {
      if (!weekStart) return;

      if (!publicView && id) {
        localStorage.setItem(`weeklyAnnouncementsWeekStart:${id}`, weekStart);
      }

      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("weekStart", weekStart);
        window.history.replaceState({}, "", url.toString());
      }
    } catch {
      // Ignore storage errors in private mode/restricted environments
    }
  }, [id, weekStart, publicView]);

  useEffect(() => {
    const fetchOrganizationBrand = async () => {
      if (!id) return;

      try {
        const churchData = await getChurchData(id);
        if (!churchData) return;

        setOrganizationLogo(churchData.logo || "");
        setOrganizationName(churchData.nombre || churchData.name || "");
      } catch (error) {
        console.error("Error loading organization brand:", error);
      }
    };

    fetchOrganizationBrand();
  }, [id]);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    if (publicView) return;
    skipAutosaveRef.current = true;
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }, [weekStart, id, publicView]);

  useEffect(() => {
    if (publicView || !id || loading) return;

    if (skipAutosaveRef.current) {
      skipAutosaveRef.current = false;
      return;
    }

    setAutosaveStatus("Autosaving...");

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = setTimeout(async () => {
      try {
        await persistWeeklyData(entriesRef.current || [], { propagateRecurring: false });
        setAutosaveStatus("All changes saved");
      } catch (error) {
        console.error("Autosave failed:", error);
        setAutosaveStatus("Autosave failed");
        toast.error(`Autosave failed: ${error?.message || "unknown error"}`);
      }
    }, 900);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [entries, videoUrl, videoName, videoPath, id, weekStart, loading, publicView]);

  const updateAnnouncementField = (dayIndex, announcementIndex, field, value) => {
    setEntries((prev) => {
      const next = [...prev];
      const dayEntry = { ...next[dayIndex] };
      const announcements = [...(dayEntry.announcements || [])];
      const current = { ...(announcements[announcementIndex] || { text: "", time: "", location: "" }) };
      current[field] = value;
      announcements[announcementIndex] = current;
      dayEntry.announcements = announcements;
      next[dayIndex] = dayEntry;
      return next;
    });
  };

  const addAnnouncement = (dayIndex) => {
    setEntries((prev) => {
      const next = [...prev];
      const dayEntry = { ...next[dayIndex] };
      dayEntry.announcements = [
        ...(dayEntry.announcements || []),
        {
          cardId: createCardId(),
          title: "",
          text: "",
          startTime: "",
          endTime: "",
          time: "",
          recurringMode: "none",
          recurringWeeks: 0,
          location: "",
          locationType: "campus",
          campusId: "",
          campusName: "",
          locationAddress: "",
          locationLink: "",
          imageUrl: "",
          imageName: "",
          imagePath: "",
          agendaItems: [],
          isEditing: true,
        },
      ];
      next[dayIndex] = dayEntry;
      return next;
    });
  };

  const setAnnouncementLocationType = (dayIndex, announcementIndex, locationType) => {
    setEntries((prev) => {
      const next = [...prev];
      const dayEntry = { ...next[dayIndex] };
      const announcements = [...(dayEntry.announcements || [])];
      const current = {
        ...(announcements[announcementIndex] || { text: "", time: "", location: "" }),
      };

      current.locationType = locationType;

      if (locationType === "campus") {
        current.locationLink = "";
        current.locationAddress = "";
        current.location = "";
      }

      if (locationType === "address") {
        current.campusId = "";
        current.campusName = "";
        current.locationLink = "";
        current.location = current.locationAddress || "";
      }

      if (locationType === "link") {
        current.campusId = "";
        current.campusName = "";
        current.locationAddress = "";
        current.location = current.locationLink || "";
      }

      announcements[announcementIndex] = current;
      dayEntry.announcements = announcements;
      next[dayIndex] = dayEntry;
      return next;
    });
  };

  const setAnnouncementCampus = (dayIndex, announcementIndex, selectedCampusId) => {
    setEntries((prev) => {
      const next = [...prev];
      const dayEntry = { ...next[dayIndex] };
      const announcements = [...(dayEntry.announcements || [])];
      const current = {
        ...(announcements[announcementIndex] || { text: "", time: "", location: "" }),
      };
      const selectedCampus = campuses.find((campus) => campus.id === selectedCampusId);

      current.locationType = "campus";
      current.campusId = selectedCampusId || "";
      current.campusName = selectedCampus?.name || "";
      current.campusAddress = selectedCampus?.address || "";
      current.location = selectedCampus?.label || "";
      current.locationAddress = "";
      current.locationLink = "";

      announcements[announcementIndex] = current;
      dayEntry.announcements = announcements;
      next[dayIndex] = dayEntry;
      return next;
    });
  };

  const setAnnouncementEditing = (dayIndex, announcementIndex, isEditing) => {
    setEntries((prev) => {
      const next = [...prev];
      const dayEntry = { ...next[dayIndex] };
      const announcements = [...(dayEntry.announcements || [])];
      const current = {
        ...(announcements[announcementIndex] || { text: "", time: "", location: "" }),
      };

      current.isEditing = isEditing;
      announcements[announcementIndex] = current;
      dayEntry.announcements = announcements;
      next[dayIndex] = dayEntry;
      return next;
    });
  };

  const setAnnouncementRecurringMode = (dayIndex, announcementIndex, recurringMode) => {
    setEntries((prev) => {
      const next = [...prev];
      const dayEntry = { ...next[dayIndex] };
      const announcements = [...(dayEntry.announcements || [])];
      const current = {
        ...(announcements[announcementIndex] || { text: "", location: "" }),
      };

      current.recurringMode = recurringMode;
      current.recurringWeeks =
        recurringMode === "none" ? 0 : getDefaultRecurringWeeks(recurringMode) || current.recurringWeeks || 1;
      announcements[announcementIndex] = current;
      dayEntry.announcements = announcements;
      next[dayIndex] = dayEntry;
      return next;
    });
  };

  const setAnnouncementRecurringWeeks = (dayIndex, announcementIndex, recurringWeeks) => {
    setEntries((prev) => {
      const next = [...prev];
      const dayEntry = { ...next[dayIndex] };
      const announcements = [...(dayEntry.announcements || [])];
      const current = {
        ...(announcements[announcementIndex] || { text: "", location: "" }),
      };

      const parsed = Number(recurringWeeks);
      const bounded = Number.isFinite(parsed)
        ? Math.max(1, Math.min(MAX_RECURRING_WEEKS, Math.floor(parsed)))
        : 1;

      current.recurringWeeks = bounded;
      announcements[announcementIndex] = current;
      dayEntry.announcements = announcements;
      next[dayIndex] = dayEntry;
      return next;
    });
  };

  const addAgendaItemToAnnouncement = (dayIndex, announcementIndex) => {
    setEntries((prev) => {
      const next = [...prev];
      const dayEntry = { ...next[dayIndex] };
      const announcements = [...(dayEntry.announcements || [])];
      const current = {
        ...(announcements[announcementIndex] || { text: "", location: "" }),
      };

      let shouldCopyToRecurring = false;
      if (isMasterRecurringAnnouncement(current) && typeof window !== "undefined") {
        shouldCopyToRecurring = window.confirm(
          "Should this task be applied to all recurring copies of this master card?"
        );
      }

      current.agendaItems = [
        ...(current.agendaItems || []),
        {
          ...createAgendaItem(),
          recurringConstant: shouldCopyToRecurring,
        },
      ];
      announcements[announcementIndex] = current;
      dayEntry.announcements = announcements;
      next[dayIndex] = dayEntry;
      return next;
    });
  };

  const handleAgendaTaskSyncChoice = (dayIndex, announcementIndex, agendaIndex) => {
    setEntries((prev) => {
      const next = [...prev];
      const dayEntry = { ...next[dayIndex] };
      const announcements = [...(dayEntry.announcements || [])];
      const current = {
        ...(announcements[announcementIndex] || { text: "", location: "" }),
      };

      if (!isMasterRecurringAnnouncement(current)) {
        return prev;
      }

      const agendaItems = [...(current.agendaItems || [])];
      const agendaItem = {
        ...(agendaItems[agendaIndex] || createAgendaItem()),
      };

      if (typeof window === "undefined") {
        return prev;
      }

      const shouldCopyToRecurring = window.confirm(
        "Should this task update across all recurring copies as well?"
      );

      agendaItem.recurringConstant = shouldCopyToRecurring;
      agendaItems[agendaIndex] = agendaItem;
      current.agendaItems = agendaItems;
      announcements[announcementIndex] = current;
      dayEntry.announcements = announcements;
      next[dayIndex] = dayEntry;
      return next;
    });
  };

  const updateAgendaItemField = (dayIndex, announcementIndex, agendaIndex, field, value) => {
    setEntries((prev) => {
      const next = [...prev];
      const dayEntry = { ...next[dayIndex] };
      const announcements = [...(dayEntry.announcements || [])];
      const current = {
        ...(announcements[announcementIndex] || { text: "", location: "" }),
      };
      const agendaItems = [...(current.agendaItems || [])];
      const agendaItem = {
        ...(agendaItems[agendaIndex] || createAgendaItem()),
      };

      agendaItem[field] = value;
      agendaItems[agendaIndex] = agendaItem;
      current.agendaItems = agendaItems;
      announcements[announcementIndex] = current;
      dayEntry.announcements = announcements;
      next[dayIndex] = dayEntry;
      return next;
    });
  };

  const removeAgendaItem = (dayIndex, announcementIndex, agendaIndex) => {
    setEntries((prev) => {
      const next = [...prev];
      const dayEntry = { ...next[dayIndex] };
      const announcements = [...(dayEntry.announcements || [])];
      const current = {
        ...(announcements[announcementIndex] || { text: "", location: "" }),
      };
      current.agendaItems = (current.agendaItems || []).filter((_, idx) => idx !== agendaIndex);
      announcements[announcementIndex] = current;
      dayEntry.announcements = announcements;
      next[dayIndex] = dayEntry;
      return next;
    });
  };

  const getAgendaTotalMinutes = (announcement) => {
    return (announcement?.agendaItems || []).reduce((total, item) => {
      const minutes = Number(item?.minutes);
      return total + (Number.isFinite(minutes) ? minutes : 0);
    }, 0);
  };

  const buildConstantRecurringAgendaTemplates = (announcement, recurrenceSourceKey) => {
    const agendaItems = Array.isArray(announcement?.agendaItems) ? announcement.agendaItems : [];

    return agendaItems
      .filter((item) => item?.recurringConstant)
      .map((item) => {
        const sourceTaskId = item.taskId || createAgendaItemId();
        return {
          ...item,
          taskId: createAgendaItemId(),
          recurringConstant: true,
          recurrenceTaskSourceKey: `${recurrenceSourceKey}:${sourceTaskId}`,
          // Keep the task template label, but clear execution-specific values for each duplicate.
          responsible: "",
          minutes: "",
          notes: "",
        };
      });
  };

  const mergeMissingConstantRecurringAgendaTemplates = (existingAnnouncement, sourceAnnouncement, recurrenceSourceKey) => {
    const existingAgendaItems = Array.isArray(existingAnnouncement?.agendaItems)
      ? [...existingAnnouncement.agendaItems]
      : [];

    const templateByKey = new Map(
      templateCandidates.map((template) => [template.recurrenceTaskSourceKey, template])
    );

    const syncedExistingAgendaItems = existingAgendaItems.map((item) => {
      const template = templateByKey.get(item?.recurrenceTaskSourceKey || "");
      if (!template) {
        return item;
      }

      return {
        ...item,
        // Sync template task label while keeping execution-specific values on each recurring copy.
        task: template.task,
        recurringConstant: true,
      };
    });

    const existingTemplateKeys = new Set(
      syncedExistingAgendaItems
        .map((item) => item?.recurrenceTaskSourceKey)
        .filter((value) => typeof value === "string" && value)
    );

    const templatesToAdd = templateCandidates.filter(
      (template) => !existingTemplateKeys.has(template.recurrenceTaskSourceKey)
    );

    return [...syncedExistingAgendaItems, ...templatesToAdd];
  };

  const mergeRecurringIntoTargetEntries = (targetEntries, sourceEntries, sourceWeekStart) => {
    const mergedEntries = normalizeEntriesForUi(targetEntries || [], true);

    sourceEntries.forEach((sourceDay) => {
      const targetDay = mergedEntries.find((entry) => entry.dayKey === sourceDay.dayKey);
      if (!targetDay) return;

      (sourceDay.announcements || []).forEach((announcement) => {
        const mode = announcement.recurringMode || "none";
        if (mode === "none") return;
        if (isRecurringCopyAnnouncement(announcement)) return;

        const recurrenceSourceKey = `${sourceWeekStart}:${announcement.cardId}`;
        const existing = (targetDay.announcements || []).find(
          (item) => item.recurrenceSourceKey === recurrenceSourceKey
        );
        if (existing) {
          existing.agendaItems = mergeMissingConstantRecurringAgendaTemplates(
            existing,
            announcement,
            recurrenceSourceKey
          );
          return;
        }

        targetDay.announcements = [
          ...(targetDay.announcements || []),
          {
            ...announcement,
            cardId: createCardId(),
            agendaItems: buildConstantRecurringAgendaTemplates(announcement, recurrenceSourceKey),
            recurrenceSourceKey,
            recurrenceOriginWeekStart: sourceWeekStart,
            isEditing: true,
          },
        ];
      });
    });

    return mergedEntries;
  };

  const propagateRecurringDrafts = async (sourceEntries) => {
    const recurringExists = sourceEntries.some((dayEntry) =>
      (dayEntry.announcements || []).some(
        (announcement) =>
          isMasterRecurringAnnouncement(announcement) &&
          announcement.recurringMode &&
          announcement.recurringMode !== "none"
      )
    );

    if (!recurringExists) return;

    const sourceDate = new Date(`${weekStart}T00:00:00`);

    const maxRecurringWeeks = sourceEntries.reduce((maxWeeks, dayEntry) => {
      const dayMax = (dayEntry.announcements || []).reduce((announcementMax, announcement) => {
        if (!isMasterRecurringAnnouncement(announcement)) return announcementMax;
        const weeks = getAnnouncementRecurringWeeks(announcement);
        return Math.max(announcementMax, weeks);
      }, 0);
      return Math.max(maxWeeks, dayMax);
    }, 0);

    if (maxRecurringWeeks <= 0) return;

    for (let weekOffset = 1; weekOffset <= maxRecurringWeeks; weekOffset += 1) {
      const targetDate = new Date(sourceDate);
      targetDate.setDate(sourceDate.getDate() + weekOffset * 7);
      const targetWeekStart = toDateInput(targetDate);

      const shouldCreateForThisWeek = sourceEntries.some((dayEntry) =>
        (dayEntry.announcements || []).some((announcement) => {
          if (!isMasterRecurringAnnouncement(announcement)) return false;
          const weeks = getAnnouncementRecurringWeeks(announcement);
          return weeks >= weekOffset;
        })
      );

      if (!shouldCreateForThisWeek) continue;

      const targetDocRef = doc(db, "churches", id, "weeklyAnnouncements", targetWeekStart);
      const targetSnap = await getDoc(targetDocRef);
      const existingEntries = targetSnap.exists()
        ? buildSafeWeekEntries(targetSnap.data()?.entries, new Date(`${targetWeekStart}T00:00:00`))
        : buildWeekEntries(new Date(`${targetWeekStart}T00:00:00`));

      const mergedEntries = mergeRecurringIntoTargetEntries(existingEntries, sourceEntries, weekStart);

      await setDoc(
        targetDocRef,
        {
          entries: serializeEntriesForSave(mergedEntries),
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          generatedFromRecurring: true,
        },
        { merge: true }
      );
    }
  };

  const persistWeeklyData = async (entriesToPersist, options = {}) => {
    const { propagateRecurring = false, allowEmptyOverwrite = false } = options;
    const docRef = doc(db, "churches", id, "weeklyAnnouncements", weekStart);
    const serializedEntries = serializeEntriesForSave(entriesToPersist);

    if (!allowEmptyOverwrite) {
      const existingSnap = await getDoc(docRef);
      if (existingSnap.exists()) {
        const existingEntries = buildSafeWeekEntries(existingSnap.data()?.entries, weekStartDate);
        const existingCount = getAnnouncementCount(existingEntries);
        const incomingCount = getAnnouncementCount(entriesToPersist);

        if (existingCount > 0 && incomingCount === 0) {
          throw new Error(
            "Safety check blocked saving an empty week over existing announcements. If you intended to clear all announcements, confirm and save again."
          );
        }
      }
    }

    await setDoc(
      docRef,
      {
        entries: serializedEntries,
        videoUrl,
        videoName,
        videoPath,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );

    const verifySnap = await getDoc(docRef);
    if (!verifySnap.exists()) {
      throw new Error("Save verification failed: weekly document not found after write.");
    }

    const persistedEntries = verifySnap.data()?.entries;
    if (!Array.isArray(persistedEntries)) {
      throw new Error("Save verification failed: entries were not persisted as an array.");
    }

    if (propagateRecurring) {
      await propagateRecurringDrafts(entriesToPersist);
    }

    setLastSavedAt(new Date().toLocaleTimeString());
    setAutosaveStatus("All changes saved");
  };

  const saveAnnouncementCard = async (dayIndex, announcementIndex) => {
    if (!id) return;

    const sourceEntries = entriesRef.current || [];
    const nextEntries = [...sourceEntries];
    const dayEntry = { ...(nextEntries[dayIndex] || { announcements: [] }) };
    const announcements = [...(dayEntry.announcements || [])];
    const current = {
      ...(announcements[announcementIndex] || { text: "", location: "" }),
    };

    current.isEditing = false;
    announcements[announcementIndex] = current;
    dayEntry.announcements = announcements;
    nextEntries[dayIndex] = dayEntry;

    setEntries(nextEntries);

    try {
      await persistWeeklyData(nextEntries, { propagateRecurring: true });

      toast.success("Announcement saved");
      setAutosaveStatus("All changes saved");
    } catch (error) {
      console.error("Error saving announcement card:", error);
      toast.error(`Failed to save announcement: ${error?.message || "unknown error"}`);
      setAutosaveStatus("Save failed");
      setAnnouncementEditing(dayIndex, announcementIndex, true);
    }
  };

  const removeAnnouncement = (dayIndex, announcementIndex) => {
    setEntries((prev) => {
      const next = [...prev];
      const dayEntry = { ...next[dayIndex] };
      dayEntry.announcements = (dayEntry.announcements || []).filter((_, idx) => idx !== announcementIndex);
      next[dayIndex] = dayEntry;
      return next;
    });

    const removedKey = getAnnouncementKey(dayIndex, announcementIndex);
    setUploadingImages((prev) => {
      const next = { ...prev };
      delete next[removedKey];
      return next;
    });
    setImageUploadProgress((prev) => {
      const next = { ...prev };
      delete next[removedKey];
      return next;
    });
  };

  const saveWeeklyAnnouncements = async () => {
    if (!id) return;

    setSaving(true);

    try {
      const entriesToSave = entriesRef.current || [];
      const incomingCount = getAnnouncementCount(entriesToSave);

      if (incomingCount === 0) {
        const confirmed = window.confirm(
          "This will save an empty week and may remove existing announcements for this week. Continue?"
        );
        if (!confirmed) {
          setSaving(false);
          return;
        }
      }

      await persistWeeklyData(entriesToSave, {
        propagateRecurring: true,
        allowEmptyOverwrite: incomingCount === 0,
      });

      setEntries((prev) =>
        prev.map((dayEntry) => ({
          ...dayEntry,
          announcements: (dayEntry.announcements || []).map((announcement) => ({
            ...announcement,
            isEditing: false,
          })),
        }))
      );

      toast.success("Weekly communication saved as cards");
      setAutosaveStatus("All changes saved");
    } catch (error) {
      console.error("Error saving weekly announcements:", error);
      toast.error(`Failed to save weekly communication: ${error?.message || "unknown error"}`);
      setAutosaveStatus("Save failed");
    } finally {
      setSaving(false);
    }
  };

  const goToCurrentWeek = () => {
    setWeekStart(toDateInput(getWeekStartDate()));
  };

  const goToPreviousWeek = () => {
    const date = new Date(`${weekStart}T00:00:00`);
    date.setDate(date.getDate() - 7);
    setWeekStart(toDateInput(date));
  };

  const goToNextWeek = () => {
    const date = new Date(`${weekStart}T00:00:00`);
    date.setDate(date.getDate() + 7);
    setWeekStart(toDateInput(date));
  };

  const getAnnouncementKey = (dayIndex, announcementIndex) => `${dayIndex}-${announcementIndex}`;

  const handleAnnouncementImageUpload = async (dayIndex, announcementIndex, event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!storage) {
      toast.error("Image upload is not available because Firebase Storage is not configured.");
      return;
    }

    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file.");
      return;
    }

    const maxImageSize = 1024 * 1024 * 10;
    if (file.size > maxImageSize) {
      toast.error("Image is too large. Please upload a file under 10MB.");
      return;
    }

    const uploadKey = getAnnouncementKey(dayIndex, announcementIndex);

    try {
      setUploadingImages((prev) => ({ ...prev, [uploadKey]: true }));
      setImageUploadProgress((prev) => ({ ...prev, [uploadKey]: 0 }));

      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `churches/${id}/weekly-announcements/${weekStart}/images/${Date.now()}_${safeName}`;
      const imageRef = ref(storage, storagePath);
      const uploadTask = uploadBytesResumable(imageRef, file);

      await new Promise((resolve, reject) => {
        uploadTask.on(
          "state_changed",
          (snapshot) => {
            const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
            setImageUploadProgress((prev) => ({ ...prev, [uploadKey]: progress }));
          },
          (error) => reject(error),
          () => resolve()
        );
      });

      const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);

      let nextEntries = [];
      setEntries((prev) => {
        const next = [...prev];
        const dayEntry = { ...next[dayIndex] };
        const announcements = [...(dayEntry.announcements || [])];
        const current = {
          ...(announcements[announcementIndex] || { text: "", time: "", location: "" }),
        };

        current.imageUrl = downloadUrl;
        current.imageName = file.name;
        current.imagePath = storagePath;

        announcements[announcementIndex] = current;
        dayEntry.announcements = announcements;
        next[dayIndex] = dayEntry;
        nextEntries = next;
        return next;
      });

      const docRef = doc(db, "churches", id, "weeklyAnnouncements", weekStart);
      await setDoc(
        docRef,
        {
          entries: serializeEntriesForSave(nextEntries),
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );

      toast.success("Announcement image uploaded");
    } catch (error) {
      console.error("Error uploading announcement image:", error);
      toast.error("Failed to upload announcement image");
    } finally {
      setUploadingImages((prev) => ({ ...prev, [uploadKey]: false }));
      event.target.value = "";
    }
  };

  const handleVideoFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!storage) {
      toast.error("Video upload is not available because Firebase Storage is not configured.");
      return;
    }

    const maxSizeBytes = 1024 * 1024 * 300;
    if (file.size > maxSizeBytes) {
      toast.error("Video is too large. Please upload a file under 300MB.");
      return;
    }

    if (!file.type.startsWith("video/")) {
      toast.error("Please select a valid video file.");
      return;
    }

    try {
      setUploadingVideo(true);
      setUploadProgress(0);

      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `churches/${id}/weekly-announcements/${weekStart}/${Date.now()}_${safeName}`;
      const videoRef = ref(storage, storagePath);
      const uploadTask = uploadBytesResumable(videoRef, file);

      await new Promise((resolve, reject) => {
        uploadTask.on(
          "state_changed",
          (snapshot) => {
            const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
            setUploadProgress(progress);
          },
          (error) => reject(error),
          () => resolve()
        );
      });

      const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
      setVideoUrl(downloadUrl);
      setVideoName(file.name);
      setVideoPath(storagePath);

      const docRef = doc(db, "churches", id, "weeklyAnnouncements", weekStart);
      await setDoc(
        docRef,
        {
          videoUrl: downloadUrl,
          videoName: file.name,
          videoPath: storagePath,
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );

      toast.success("Weekly video uploaded");
    } catch (error) {
      console.error("Error uploading weekly video:", error);
      toast.error("Failed to upload weekly video");
    } finally {
      setUploadingVideo(false);
      event.target.value = "";
    }
  };

  const buildWeeklyShareText = () => {
    const visitLink =
      typeof window !== "undefined"
        ? `${window.location.origin}/organization/${id}/weekly-announcements/public?weekStart=${weekStart}`
        : `/organization/${id}/weekly-announcements/public?weekStart=${weekStart}`;

    return visitLink;
  };

  const shareWeeklyToWhatsApp = () => {
    const message = buildWeeklyShareText();
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
  };

  const shareWeeklyToSms = () => {
    const message = buildWeeklyShareText();
    const smsUrl = `sms:?&body=${encodeURIComponent(message)}`;
    window.open(smsUrl, "_self");
  };

  return (
    <div style={commonStyles.fullWidthContainer} className="weekly-page">
      <div className="weekly-org-brand">
        <div className="weekly-org-logo-wrap">
          <img
            src={organizationLogo || "/img/logo-fallback.svg"}
            alt="Organization Logo"
            className="weekly-org-logo"
          />
        </div>
        <div className="weekly-org-text">
          <div className="weekly-org-label">Organization</div>
          <div className="weekly-org-name">{organizationName || "My Organization"}</div>
        </div>
      </div>

      {!publicView ? (
        <Link to={`/organization/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
          ← Back to My Organization
        </Link>
      ) : null}
      {!publicView ? (
        <Link to={`/organization/${id}/weekly-announcements-planner`} style={commonStyles.backButtonLink}>
          View Multi-Week Planner
        </Link>
      ) : null}

      <div className="weekly-hero" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={commonStyles.title}>Weekly Communication</h1>
          {lastSavedAt ? (
            <div style={{ fontSize: "0.8rem", color: "#E0F2FE", fontWeight: 700 }}>
              Saved to Firebase at {lastSavedAt}
            </div>
          ) : null}
          {autosaveStatus ? (
            <div style={{ fontSize: "0.78rem", color: "#DBEAFE", fontWeight: 700, marginTop: "2px" }}>
              {autosaveStatus}
            </div>
          ) : null}
        </div>
        {!publicView ? (
          <button
            type="button"
            onClick={saveWeeklyAnnouncements}
            disabled={saving || loading}
            className="weekly-save-button"
            style={{
              backgroundColor: saving ? "#9CA3AF" : "#2563EB",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              padding: "10px 16px",
              fontWeight: 600,
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        ) : null}
      </div>

      <div
        className="weekly-controls"
        style={{
          marginBottom: "16px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "12px",
          alignItems: "end",
        }}
      >
        <div>
          <label style={{ display: "block", fontSize: "0.85rem", color: "#374151", marginBottom: "4px" }}>Week starting (Monday)</label>
          <input
            type="date"
            value={weekStart}
            onChange={(e) => setWeekStart(e.target.value)}
            style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: "8px", padding: "10px" }}
          />
        </div>
        {!publicView ? (
          <button
            type="button"
            onClick={goToCurrentWeek}
            style={{
              backgroundColor: "#F3F4F6",
              color: "#111827",
              border: "1px solid #D1D5DB",
              borderRadius: "8px",
              padding: "10px 16px",
              fontWeight: 600,
              cursor: "pointer",
              maxWidth: "220px",
            }}
          >
            Go to Current Week
          </button>
        ) : null}
        <button
          type="button"
          onClick={goToPreviousWeek}
          style={{
            backgroundColor: "#F8FAFC",
            color: "#0F172A",
            border: "1px solid #CBD5E1",
            borderRadius: "8px",
            padding: "10px 16px",
            fontWeight: 600,
            cursor: "pointer",
            maxWidth: "220px",
          }}
        >
          ← Previous Week
        </button>
        <button
          type="button"
          onClick={goToNextWeek}
          style={{
            backgroundColor: "#F8FAFC",
            color: "#0F172A",
            border: "1px solid #CBD5E1",
            borderRadius: "8px",
            padding: "10px 16px",
            fontWeight: 600,
            cursor: "pointer",
            maxWidth: "220px",
          }}
        >
          Next Week →
        </button>
      </div>

      <div className="weekly-video-card" style={{ marginBottom: "16px", backgroundColor: "#fff", border: "1px solid #E5E7EB", borderRadius: "10px", padding: "12px" }}>
        <h3 style={{ marginTop: 0 }}>Optional Weekly Video</h3>
        {!publicView ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "10px" }}>
            <input
              type="text"
              placeholder="Video name"
              value={videoName}
              onChange={(e) => setVideoName(e.target.value)}
              style={{ border: "1px solid #D1D5DB", borderRadius: "8px", padding: "10px" }}
            />
            <input
              type="url"
              placeholder="Video URL"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              style={{ border: "1px solid #D1D5DB", borderRadius: "8px", padding: "10px" }}
            />
            <label
              htmlFor="weekly-video-upload"
              style={{
                border: "1px dashed #93C5FD",
                borderRadius: "8px",
                padding: "10px",
                backgroundColor: "#EFF6FF",
                color: uploadingVideo ? "#6B7280" : "#1D4ED8",
                cursor: uploadingVideo ? "not-allowed" : "pointer",
                fontWeight: 600,
                textAlign: "center",
              }}
            >
              {uploadingVideo ? `Uploading... ${uploadProgress}%` : "Upload Video File"}
            </label>
            <input
              id="weekly-video-upload"
              type="file"
              accept="video/*"
              onChange={handleVideoFileUpload}
              disabled={uploadingVideo}
              style={{ display: "none" }}
            />
          </div>
        ) : null}
        {videoUrl ? (
          <div style={{ marginTop: "10px" }}>
            <a href={videoUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#2563EB", fontWeight: 600 }}>
              Open uploaded video
            </a>
          </div>
        ) : null}
      </div>

      {loading ? (
        <div style={{ color: "#6B7280" }}>Loading weekly communication...</div>
      ) : isCardDetailOpen ? (
        <div className="weekly-card-detail" style={{ backgroundColor: "#fff", border: "1px solid #E5E7EB", borderRadius: "10px", padding: "14px" }}>
          <button
            type="button"
            onClick={closeCardDetails}
            style={{
              backgroundColor: "#F8FAFC",
              color: "#0F172A",
              border: "1px solid #CBD5E1",
              borderRadius: "8px",
              padding: "8px 12px",
              fontWeight: 700,
              cursor: "pointer",
              marginBottom: "12px",
            }}
          >
            ← Back to Week View
          </button>

          {!selectedAnnouncement ? (
            <div style={{ color: "#6B7280" }}>
              This card was not found for the selected week.
            </div>
          ) : (
            <div className="weekly-announcement-card" style={{ border: "1px solid #E5E7EB", borderRadius: "8px", padding: "12px", backgroundColor: "#FAFAFA" }}>
              {selectedAnnouncement.imageUrl ? (
                <div style={{ marginBottom: "10px" }}>
                  <img
                    src={selectedAnnouncement.imageUrl}
                    alt={selectedAnnouncement.imageName || "Announcement"}
                    style={{ width: "100%", height: "320px", objectFit: "contain", borderRadius: "8px", border: "1px solid #E5E7EB", backgroundColor: "#F9FAFB" }}
                  />
                </div>
              ) : null}
              <div style={{ fontSize: "0.82rem", color: "#6B7280", marginBottom: "6px" }}>
                {selectedAnnouncement.startTime || selectedAnnouncement.endTime
                  ? `Time: ${selectedAnnouncement.startTime || "--"} - ${selectedAnnouncement.endTime || "--"}`
                  : selectedAnnouncement.time
                  ? `Time: ${selectedAnnouncement.time}`
                  : "Time not set"}
              </div>
              <h3 style={{ marginTop: 0, marginBottom: "6px", color: "#0F172A", fontWeight: 800, display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <span>{selectedAnnouncement.title || "Untitled announcement"}</span>
                {selectedAnnouncement.recurringMode && selectedAnnouncement.recurringMode !== "none" && !selectedAnnouncement.recurrenceSourceKey ? (
                  <span style={{ fontSize: "0.72rem", color: "#B45309", backgroundColor: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: "999px", padding: "2px 8px", fontWeight: 700 }}>
                    ★ Master Template
                  </span>
                ) : null}
              </h3>
              <p style={{ marginTop: 0, marginBottom: "10px", color: "#111827", whiteSpace: "pre-wrap" }}>
                {selectedAnnouncement.text || "No announcement text"}
              </p>
              <div style={{ fontSize: "0.82rem", color: "#6B7280", marginBottom: "8px" }}>
                {(() => {
                  const locationLinks = getLocationLinks(selectedAnnouncement);
                  if (!locationLinks.label) {
                    return "Location not set";
                  }

                  return (
                    <span>
                      Location: {" "}
                      <a
                        href={locationLinks.primaryHref}
                        target="_self"
                        rel="noopener noreferrer"
                        style={{ color: "#0F766E", fontWeight: 700, textDecoration: "underline" }}
                      >
                        {locationLinks.label}
                      </a>
                    </span>
                  );
                })()}
              </div>
              <div style={{ fontSize: "0.82rem", color: "#6B7280", marginBottom: "8px" }}>
                Recurring: {selectedAnnouncement.recurringMode === "none" ? "No" : `${getAnnouncementRecurringWeeks(selectedAnnouncement)} weeks`}
              </div>

              <div style={{ marginBottom: "10px", borderTop: "1px dashed #CBD5E1", paddingTop: "8px" }}>
                <div style={{ fontSize: "0.84rem", fontWeight: 800, color: "#0F172A", marginBottom: "6px" }}>
                  Task Details ({getAgendaTotalMinutes(selectedAnnouncement)} min)
                </div>
                {(selectedAnnouncement.agendaItems || []).length > 0 ? (
                  <div style={{ display: "grid", gap: "6px" }}>
                    {(selectedAnnouncement.agendaItems || []).map((item, itemIndex) => (
                      <div key={`${selectedAnnouncement.cardId || selectedAnnouncementIndex}-agenda-detail-${itemIndex}`} style={{ fontSize: "0.82rem", color: "#334155" }}>
                        {item.task || "Task"} - {item.responsible || "Unassigned"} ({item.minutes || 0} min)
                        {item.recurringConstant ? (
                          <span style={{ marginLeft: "6px", fontSize: "0.72rem", color: "#1D4ED8", fontWeight: 700 }}>
                            [Constant Recurring]
                          </span>
                        ) : null}
                        {item.notes ? (
                          <div style={{ marginTop: "2px", color: "#64748B" }}>Notes: {item.notes}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: "#6B7280", fontSize: "0.84rem" }}>No task details added yet.</div>
                )}
              </div>

              {!publicView ? (
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedDayIndex < 0 || selectedAnnouncementIndex < 0) return;
                      setAnnouncementEditing(selectedDayIndex, selectedAnnouncementIndex, true);
                      closeCardDetails();
                    }}
                    style={{
                      backgroundColor: "#F3F4F6",
                      color: "#111827",
                      border: "1px solid #D1D5DB",
                      borderRadius: "8px",
                      padding: "6px 10px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Edit Card
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : (
        <div className="weekly-days-grid" style={{ display: "grid", gap: "14px" }}>
          {entries.map((dayEntry, dayIndex) => (
            <div className="weekly-day-card" key={dayEntry.dayKey} style={{ backgroundColor: "#fff", border: "1px solid #E5E7EB", borderRadius: "10px", padding: "12px" }}>
              <div className="weekly-day-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <h3 style={{ margin: 0 }}>{DAY_LABELS[dayEntry.dayKey]} - {toDisplayDate(dayEntry.date)}</h3>
                {!publicView ? (
                  <button
                    type="button"
                    onClick={() => addAnnouncement(dayIndex)}
                    className="weekly-add-announcement-button"
                    style={{
                      backgroundColor: "#ECFDF5",
                      color: "#065F46",
                      border: "1px solid #A7F3D0",
                      borderRadius: "8px",
                      padding: "8px 12px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    + Add Announcement
                  </button>
                ) : null}
              </div>

              {(dayEntry.announcements || []).length === 0 ? (
                <p style={{ color: "#6B7280", marginBottom: 0 }}>No announcements for this day yet.</p>
              ) : (
                <div style={{ display: "grid", gap: "10px", marginTop: "10px" }}>
                  {(dayEntry.announcements || []).map((announcement, announcementIndex) => (
                    <div
                      className="weekly-announcement-card"
                      key={`${dayEntry.dayKey}-${announcementIndex}`}
                      onClick={publicView || announcement.isEditing === false ? () => openCardDetails(dayEntry.dayKey, announcement.cardId) : undefined}
                      style={{
                        border: "1px solid #E5E7EB",
                        borderRadius: "8px",
                        padding: "10px",
                        backgroundColor: "#FAFAFA",
                        cursor: publicView || announcement.isEditing === false ? "pointer" : "default",
                      }}
                    >
                      {publicView || announcement.isEditing === false ? (
                        <>
                          {announcement.imageUrl ? (
                            <div style={{ marginBottom: "10px" }}>
                              <img
                                src={announcement.imageUrl}
                                alt={announcement.imageName || "Announcement"}
                                style={{ width: "100%", height: "320px", objectFit: "contain", borderRadius: "8px", border: "1px solid #E5E7EB", backgroundColor: "#F9FAFB" }}
                              />
                            </div>
                          ) : null}
                          <div style={{ fontSize: "0.82rem", color: "#6B7280", marginBottom: "6px" }}>
                            {announcement.startTime || announcement.endTime
                              ? `Time: ${announcement.startTime || "--"} - ${announcement.endTime || "--"}`
                              : announcement.time
                              ? `Time: ${announcement.time}`
                              : "Time not set"}
                          </div>
                          <h4 style={{ marginTop: 0, marginBottom: "6px", color: "#0F172A", fontWeight: 800, display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                            <span>{announcement.title || "Untitled announcement"}</span>
                            {announcement.recurringMode && announcement.recurringMode !== "none" && !announcement.recurrenceSourceKey ? (
                              <span style={{ fontSize: "0.72rem", color: "#B45309", backgroundColor: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: "999px", padding: "2px 8px", fontWeight: 700 }}>
                                ★ Master Template
                              </span>
                            ) : null}
                          </h4>
                          <p style={{ marginTop: 0, marginBottom: "10px", color: "#111827", whiteSpace: "pre-wrap" }}>
                            {announcement.text || "No announcement text"}
                          </p>
                          <div style={{ fontSize: "0.82rem", color: "#6B7280", marginBottom: "8px" }}>
                            {(() => {
                              const locationLinks = getLocationLinks(announcement);
                              if (!locationLinks.label) {
                                return "Location not set";
                              }

                              return (
                                <span>
                                  Location: {" "}
                                  <a
                                    href={locationLinks.primaryHref}
                                    target="_self"
                                    rel="noopener noreferrer"
                                    style={{ color: "#0F766E", fontWeight: 700, textDecoration: "underline" }}
                                  >
                                    {locationLinks.label}
                                  </a>
                                </span>
                              );
                            })()}
                          </div>
                          <div style={{ fontSize: "0.82rem", color: "#6B7280", marginBottom: "8px" }}>
                            Recurring: {announcement.recurringMode === "none" ? "No" : `${getAnnouncementRecurringWeeks(announcement)} weeks`}
                          </div>
                          <div style={{ marginBottom: "10px", borderTop: "1px dashed #CBD5E1", paddingTop: "8px", fontSize: "0.82rem", color: "#64748B", fontWeight: 600 }}>
                            Click card to view task details
                          </div>
                          {!publicView ? (
                            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setAnnouncementEditing(dayIndex, announcementIndex, true);
                                }}
                                style={{
                                  backgroundColor: "#F3F4F6",
                                  color: "#111827",
                                  border: "1px solid #D1D5DB",
                                  borderRadius: "8px",
                                  padding: "6px 10px",
                                  fontWeight: 600,
                                  cursor: "pointer",
                                }}
                              >
                                Edit Card
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  removeAnnouncement(dayIndex, announcementIndex);
                                }}
                                style={{
                                  backgroundColor: "#FEF2F2",
                                  color: "#991B1B",
                                  border: "1px solid #FCA5A5",
                                  borderRadius: "8px",
                                  padding: "6px 10px",
                                  fontWeight: 600,
                                  cursor: "pointer",
                                }}
                              >
                                Remove
                              </button>
                            </div>
                          ) : null}
                        </>
                      ) : (
                      <>
                      {(() => {
                        const locationType = announcement.locationType || "address";
                        const selectedCampusId = announcement.campusId || "";
                        const locationAddress = announcement.locationAddress || announcement.location || "";
                        const locationLink = announcement.locationLink || announcement.location || "";
                        const uploadKey = getAnnouncementKey(dayIndex, announcementIndex);
                        const isUploadingImage = Boolean(uploadingImages[uploadKey]);
                        const currentImageUploadProgress = imageUploadProgress[uploadKey] || 0;
                        const imageInputId = `announcement-image-${dayIndex}-${announcementIndex}`;

                        return (
                          <>
                            <div style={{ marginBottom: "8px" }}>
                              <label style={{ display: "block", fontSize: "0.82rem", color: "#374151", marginBottom: "4px" }}>
                                Location Source
                              </label>
                              <select
                                value={locationType}
                                onChange={(e) => setAnnouncementLocationType(dayIndex, announcementIndex, e.target.value)}
                                style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: "8px", padding: "10px" }}
                              >
                                <option value="campus">Campus</option>
                                <option value="address">Address</option>
                                <option value="link">Link</option>
                              </select>
                            </div>

                            {locationType === "campus" ? (
                              <div style={{ marginBottom: "8px" }}>
                                <label style={{ display: "block", fontSize: "0.82rem", color: "#374151", marginBottom: "4px" }}>
                                  Campus
                                </label>
                                <select
                                  value={selectedCampusId}
                                  onChange={(e) => setAnnouncementCampus(dayIndex, announcementIndex, e.target.value)}
                                  style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: "8px", padding: "10px" }}
                                >
                                  <option value="">Select a campus</option>
                                  {campuses.map((campus) => (
                                    <option key={campus.id} value={campus.id}>
                                      {campus.label || campus.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            ) : null}

                            {locationType === "address" ? (
                              <div style={{ marginBottom: "8px" }}>
                                <label style={{ display: "block", fontSize: "0.82rem", color: "#374151", marginBottom: "4px" }}>
                                  Address
                                </label>
                                <input
                                  type="text"
                                  value={locationAddress}
                                  placeholder="Type an address"
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    updateAnnouncementField(dayIndex, announcementIndex, "locationAddress", value);
                                    updateAnnouncementField(dayIndex, announcementIndex, "location", value);
                                  }}
                                  style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: "8px", padding: "10px" }}
                                />
                              </div>
                            ) : null}

                            {locationType === "link" ? (
                              <div style={{ marginBottom: "8px" }}>
                                <label style={{ display: "block", fontSize: "0.82rem", color: "#374151", marginBottom: "4px" }}>
                                  Location Link
                                </label>
                                <input
                                  type="url"
                                  value={locationLink}
                                  placeholder="https://maps.google.com/..."
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    updateAnnouncementField(dayIndex, announcementIndex, "locationLink", value);
                                    updateAnnouncementField(dayIndex, announcementIndex, "location", value);
                                  }}
                                  style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: "8px", padding: "10px" }}
                                />
                              </div>
                            ) : null}

                            <div style={{ marginBottom: "8px" }}>
                              <label style={{ display: "block", fontSize: "0.82rem", color: "#374151", marginBottom: "4px" }}>
                                Announcement Image
                              </label>
                              <label
                                htmlFor={imageInputId}
                                style={{
                                  display: "inline-block",
                                  border: "1px dashed #93C5FD",
                                  borderRadius: "8px",
                                  padding: "8px 12px",
                                  backgroundColor: "#EFF6FF",
                                  color: isUploadingImage ? "#6B7280" : "#1D4ED8",
                                  cursor: isUploadingImage ? "not-allowed" : "pointer",
                                  fontWeight: 600,
                                }}
                              >
                                {isUploadingImage ? `Uploading... ${currentImageUploadProgress}%` : "Upload Image"}
                              </label>
                              <input
                                id={imageInputId}
                                type="file"
                                accept="image/*"
                                onChange={(e) => handleAnnouncementImageUpload(dayIndex, announcementIndex, e)}
                                disabled={isUploadingImage}
                                style={{ display: "none" }}
                              />
                            </div>

                            {announcement.imageUrl ? (
                              <div style={{ marginBottom: "8px" }}>
                                <img
                                  src={announcement.imageUrl}
                                  alt={announcement.imageName || "Announcement"}
                                  style={{ width: "100%", height: "320px", objectFit: "contain", borderRadius: "8px", border: "1px solid #E5E7EB", backgroundColor: "#F9FAFB" }}
                                />
                              </div>
                            ) : null}
                          </>
                        );
                      })()}

                      <textarea
                        value={announcement.text || ""}
                        placeholder="Announcement text"
                        onChange={(e) => updateAnnouncementField(dayIndex, announcementIndex, "text", e.target.value)}
                        rows={3}
                        style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: "8px", padding: "10px", resize: "vertical", marginBottom: "8px" }}
                      />
                      <input
                        type="text"
                        value={announcement.title || ""}
                        placeholder="Title"
                        onChange={(e) => updateAnnouncementField(dayIndex, announcementIndex, "title", e.target.value)}
                        style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: "8px", padding: "10px", marginBottom: "8px" }}
                      />
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "8px" }}>
                        <input
                          type="time"
                          value={announcement.startTime || ""}
                          placeholder="Start time"
                          onChange={(e) => updateAnnouncementField(dayIndex, announcementIndex, "startTime", e.target.value)}
                          style={{ border: "1px solid #D1D5DB", borderRadius: "8px", padding: "10px" }}
                        />
                        <input
                          type="time"
                          value={announcement.endTime || ""}
                          placeholder="End time"
                          onChange={(e) => updateAnnouncementField(dayIndex, announcementIndex, "endTime", e.target.value)}
                          style={{ border: "1px solid #D1D5DB", borderRadius: "8px", padding: "10px" }}
                        />
                        <input
                          type="text"
                          value={announcement.location || ""}
                          readOnly
                          placeholder="Location preview"
                          style={{ border: "1px solid #D1D5DB", borderRadius: "8px", padding: "10px", backgroundColor: "#F9FAFB", color: "#4B5563" }}
                        />
                      </div>
                      {announcement.location ? (
                        <div style={{ marginTop: "6px", marginBottom: "4px", fontSize: "0.82rem" }}>
                          {(() => {
                            const locationLinks = getLocationLinks(announcement);
                            return (
                              <a
                                href={locationLinks.primaryHref}
                                target="_self"
                                rel="noopener noreferrer"
                                style={{ color: "#0F766E", fontWeight: 700, textDecoration: "underline" }}
                              >
                                {locationLinks.label || "Open location"}
                              </a>
                            );
                          })()}
                        </div>
                      ) : null}
                      <div style={{ marginTop: "8px", marginBottom: "8px" }}>
                        {isRecurringCopyAnnouncement(announcement) ? (
                          <div style={{ fontSize: "0.82rem", color: "#6B7280" }}>
                            Recurring copy: recurrence settings are managed by the master template.
                          </div>
                        ) : (
                          <>
                            <label style={{ display: "block", fontSize: "0.82rem", color: "#374151", marginBottom: "4px" }}>
                              Recurring
                            </label>
                            <select
                              value={announcement.recurringMode || "none"}
                              onChange={(e) => setAnnouncementRecurringMode(dayIndex, announcementIndex, e.target.value)}
                              style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: "8px", padding: "10px" }}
                            >
                              <option value="none">No recurrence</option>
                              <option value="weekly">Create drafts for next 6 months (weekly)</option>
                              <option value="monthly">Create drafts for next month (4 weeks)</option>
                              <option value="three_months">Create drafts for next 3 months (12 weeks)</option>
                            </select>
                          </>
                        )}
                      </div>
                      <div style={{ marginTop: "8px", marginBottom: "8px", borderTop: "1px dashed #CBD5E1", paddingTop: "10px" }}>
                        <div style={{ fontSize: "0.84rem", fontWeight: 800, color: "#0F172A", marginBottom: "6px" }}>
                          Quick Agenda ({getAgendaTotalMinutes(announcement)} min)
                        </div>
                        <div style={{ display: "grid", gap: "8px" }}>
                          {(announcement.agendaItems || []).map((item, agendaIndex) => (
                            <div key={`${announcement.cardId || announcementIndex}-agenda-edit-${agendaIndex}`} style={{ display: "grid", gap: "6px", border: "1px solid #E2E8F0", borderRadius: "8px", padding: "8px" }}>
                              <input
                                type="text"
                                value={item.task || ""}
                                placeholder="Task"
                                onChange={(e) => updateAgendaItemField(dayIndex, announcementIndex, agendaIndex, "task", e.target.value)}
                                onBlur={() => handleAgendaTaskSyncChoice(dayIndex, announcementIndex, agendaIndex)}
                                style={{ border: "1px solid #D1D5DB", borderRadius: "8px", padding: "10px" }}
                              />
                              <input
                                type="text"
                                value={item.responsible || ""}
                                placeholder="Responsible person"
                                onChange={(e) => updateAgendaItemField(dayIndex, announcementIndex, agendaIndex, "responsible", e.target.value)}
                                style={{ border: "1px solid #D1D5DB", borderRadius: "8px", padding: "10px" }}
                              />
                              <input
                                type="number"
                                min="0"
                                value={item.minutes || ""}
                                placeholder="Minutes"
                                onChange={(e) => updateAgendaItemField(dayIndex, announcementIndex, agendaIndex, "minutes", e.target.value)}
                                style={{ border: "1px solid #D1D5DB", borderRadius: "8px", padding: "10px" }}
                              />
                              <textarea
                                value={item.notes || ""}
                                placeholder="Notes for this task"
                                onChange={(e) => updateAgendaItemField(dayIndex, announcementIndex, agendaIndex, "notes", e.target.value)}
                                rows={2}
                                style={{ border: "1px solid #D1D5DB", borderRadius: "8px", padding: "10px", resize: "vertical" }}
                              />
                              <div style={{ fontSize: "0.8rem", color: "#334155" }}>
                                Task syncing is prompted automatically for master recurring cards.
                              </div>
                              <button
                                type="button"
                                onClick={() => removeAgendaItem(dayIndex, announcementIndex, agendaIndex)}
                                style={{
                                  backgroundColor: "#FEF2F2",
                                  color: "#991B1B",
                                  border: "1px solid #FCA5A5",
                                  borderRadius: "8px",
                                  padding: "6px 10px",
                                  fontWeight: 700,
                                  cursor: "pointer",
                                }}
                              >
                                Remove Task
                              </button>
                            </div>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => addAgendaItemToAnnouncement(dayIndex, announcementIndex)}
                          style={{
                            marginTop: "8px",
                            backgroundColor: "#EEF2FF",
                            color: "#3730A3",
                            border: "1px solid #C7D2FE",
                            borderRadius: "8px",
                            padding: "8px 12px",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          + Add Agenda Task
                        </button>
                      </div>
                      <div style={{ marginTop: "8px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => saveAnnouncementCard(dayIndex, announcementIndex)}
                          style={{
                            backgroundColor: "#F3F4F6",
                            color: "#111827",
                            border: "1px solid #D1D5DB",
                            borderRadius: "8px",
                            padding: "6px 10px",
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          Save Card
                        </button>
                        <button
                          type="button"
                          onClick={() => removeAnnouncement(dayIndex, announcementIndex)}
                          style={{
                            backgroundColor: "#FEF2F2",
                            color: "#991B1B",
                            border: "1px solid #FCA5A5",
                            borderRadius: "8px",
                            padding: "6px 10px",
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          Remove
                        </button>
                      </div>
                      </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {!publicView ? (
            <div
              className="weekly-share-bar"
              style={{
                marginTop: "8px",
                backgroundColor: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: "10px",
                padding: "12px",
                display: "flex",
                gap: "10px",
                flexWrap: "wrap",
                justifyContent: "flex-end",
              }}
            >
              <button
                type="button"
                onClick={shareWeeklyToWhatsApp}
                className="weekly-share-button weekly-share-whatsapp"
                style={{
                  backgroundColor: "#DCFCE7",
                  color: "#166534",
                  border: "1px solid #86EFAC",
                  borderRadius: "8px",
                  padding: "8px 12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Share Weekly to WhatsApp
              </button>
              <button
                type="button"
                onClick={shareWeeklyToSms}
                className="weekly-share-button weekly-share-sms"
                style={{
                  backgroundColor: "#EFF6FF",
                  color: "#1E40AF",
                  border: "1px solid #93C5FD",
                  borderRadius: "8px",
                  padding: "8px 12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Share Weekly to SMS
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default WeeklyAnnouncements;
