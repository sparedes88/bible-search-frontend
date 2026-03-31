import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  updateDoc,
} from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { toast } from "react-toastify";
import { db, storage } from "../firebase";
import commonStyles from "../pages/commonStyles";
import ChurchHeader from "./ChurchHeader";
import "./MySunday.css";

const DEFAULT_SECTIONS = ["Schedule", "Songs", "Timer", "Roles"];

const toInputDate = (rawDate) => {
  if (!rawDate) return "";

  const dateValue = String(rawDate).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    return dateValue;
  }

  if (/^\d{2}-\d{2}-\d{4}$/.test(dateValue)) {
    const [month, day, year] = dateValue.split("-");
    return `${year}-${month}-${day}`;
  }

  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return "";

  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const toInputTime = (rawTime) => {
  if (!rawTime) return "";

  const timeValue = String(rawTime).trim();

  if (/^\d{2}:\d{2}$/.test(timeValue)) {
    return timeValue;
  }

  const amPmMatch = timeValue.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (amPmMatch) {
    let hours = parseInt(amPmMatch[1], 10);
    const minutes = amPmMatch[2];
    const period = amPmMatch[3].toUpperCase();

    if (period === "PM" && hours !== 12) hours += 12;
    if (period === "AM" && hours === 12) hours = 0;

    return `${String(hours).padStart(2, "0")}:${minutes}`;
  }

  return "";
};

const toDateFromServiceAndTime = (serviceDate, timeValue) => {
  if (!serviceDate || !timeValue) return null;

  const parsedDate = new Date(`${serviceDate}T00:00:00`);
  if (Number.isNaN(parsedDate.getTime())) return null;

  const timeText = String(timeValue).trim();
  let hours = 0;
  let minutes = 0;

  if (/^\d{2}:\d{2}$/.test(timeText)) {
    const [h, m] = timeText.split(":").map(Number);
    hours = h;
    minutes = m;
  } else {
    const match = timeText.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
    if (!match) return null;

    hours = parseInt(match[1], 10);
    minutes = parseInt(match[2], 10);
    const period = match[3].toUpperCase();

    if (period === "PM" && hours !== 12) hours += 12;
    if (period === "AM" && hours === 12) hours = 0;
  }

  const result = new Date(parsedDate);
  result.setHours(hours, minutes, 0, 0);
  return result;
};

const formatCountdown = (totalSeconds) => {
  if (totalSeconds <= 0) return "00:00:00";

  let remainingSeconds = totalSeconds;

  const secondsInMonth = 30 * 24 * 60 * 60;
  const secondsInWeek = 7 * 24 * 60 * 60;
  const secondsInDay = 24 * 60 * 60;

  const months = Math.floor(remainingSeconds / secondsInMonth);
  remainingSeconds %= secondsInMonth;

  const weeks = Math.floor(remainingSeconds / secondsInWeek);
  remainingSeconds %= secondsInWeek;

  const days = Math.floor(remainingSeconds / secondsInDay);
  remainingSeconds %= secondsInDay;

  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;

  const timePart = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  if (months > 0) {
    return `${months}mo ${weeks}w ${days}d ${timePart}`;
  }

  if (weeks > 0) {
    return `${weeks}w ${days}d ${timePart}`;
  }

  if (days > 0) {
    return `${days}d ${timePart}`;
  }

  return timePart;
};

const createDefaultSections = (scheduleLink = "") =>
  DEFAULT_SECTIONS.map((title, index) => ({
    id: `section_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`,
    title,
    content: title.toLowerCase() === "schedule" && scheduleLink
      ? `Schedule link: ${scheduleLink}`
      : "",
    type: title.toLowerCase(),
    attachments: [],
  }));

const getEventIdFromSchedulePath = (path = "") => {
  const match = String(path).match(/\/event\/([^/]+)\/coordination/);
  return match ? match[1] : "";
};

const normalizeSongTitle = (title = "") => String(title || "").trim().toLowerCase();

const MySunday = () => {
  const { id } = useParams();
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingService, setSavingService] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState(null);
  const [availableEvents, setAvailableEvents] = useState([]);
  const [linkedScheduleTasks, setLinkedScheduleTasks] = useState([]);
  const [loadingLinkedSchedule, setLoadingLinkedSchedule] = useState(false);
  const [songsLibrary, setSongsLibrary] = useState([]);
  const [loadingSongsLibrary, setLoadingSongsLibrary] = useState(false);
  const [selectedSongId, setSelectedSongId] = useState("");
  const [nowTick, setNowTick] = useState(Date.now());
  const [linkedEventDetails, setLinkedEventDetails] = useState(null);

  const [newService, setNewService] = useState({
    name: "",
    startTime: "",
    date: "",
    linkedEventId: "",
  });

  const [editingSectionId, setEditingSectionId] = useState(null);
  const [editedTitle, setEditedTitle] = useState("");
  const [openSections, setOpenSections] = useState({});

  useEffect(() => {
    if (!id) return;

    const servicesRef = collection(db, "churches", id, "mySundayServices");
    const servicesQuery = query(servicesRef);

    const unsubscribe = onSnapshot(
      servicesQuery,
      (snapshot) => {
        const data = snapshot.docs.map((serviceDoc) => ({
          id: serviceDoc.id,
          ...serviceDoc.data(),
        })).sort((a, b) => {
          const dateCompare = String(a.date || "").localeCompare(String(b.date || ""));
          if (dateCompare !== 0) return dateCompare;
          return String(a.startTime || "").localeCompare(String(b.startTime || ""));
        });

        setServices(data);
        setLoading(false);

        if (data.length && !selectedServiceId) {
          setSelectedServiceId(data[0].id);
        }

        if (!data.find((service) => service.id === selectedServiceId)) {
          setSelectedServiceId(data[0]?.id || null);
        }
      },
      (error) => {
        console.error("Error loading My Sunday services:", error);
        toast.error("Failed to load services");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [id, selectedServiceId]);

  useEffect(() => {
    const loadEvents = async () => {
      if (!id) return;

      try {
        const eventsQuery = query(collection(db, "eventInstances"), where("churchId", "==", id));
        const snapshot = await getDocs(eventsQuery);

        const events = snapshot.docs
          .map((eventDoc) => ({ id: eventDoc.id, ...eventDoc.data() }))
          .filter((event) => !event.removed && !event.isDeleted)
          .sort((a, b) => String(a.startDate || "").localeCompare(String(b.startDate || "")));

        setAvailableEvents(events);
      } catch (error) {
        console.error("Error loading events for My Sunday:", error);
      }
    };

    loadEvents();
  }, [id]);

  useEffect(() => {
    const intervalId = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const loadSongs = async () => {
      if (!id) return;

      try {
        setLoadingSongsLibrary(true);
        const songsRef = collection(db, `churches/${id}/songs`);
        const songsSnap = await getDocs(songsRef);
        const songsData = songsSnap.docs
          .map((songDoc) => ({ id: songDoc.id, ...songDoc.data() }))
          .sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));

        setSongsLibrary(songsData);
      } catch (error) {
        console.error("Error loading songs for My Sunday:", error);
        setSongsLibrary([]);
      } finally {
        setLoadingSongsLibrary(false);
      }
    };

    loadSongs();
  }, [id]);

  const prioritizedSongs = useMemo(() => {
    const songsById = new Map(songsLibrary.map((song) => [song.id, song]));
    const songsByTitle = new Map(
      songsLibrary.map((song) => [normalizeSongTitle(song.title), song])
    );

    const prioritized = [];
    const usedSongIds = new Set();
    const usedTaskOnlyTitles = new Set();

    linkedScheduleTasks.forEach((task) => {
      const taskSongTitle = String(task.songTitle || "").trim();
      const normalizedTaskSongTitle = normalizeSongTitle(taskSongTitle);

      let matchedSong = null;
      if (task.songId && songsById.has(task.songId)) {
        matchedSong = songsById.get(task.songId);
      } else if (normalizedTaskSongTitle && songsByTitle.has(normalizedTaskSongTitle)) {
        matchedSong = songsByTitle.get(normalizedTaskSongTitle);
      }

      if (matchedSong) {
        if (!usedSongIds.has(matchedSong.id)) {
          prioritized.push({ ...matchedSong, fromTask: true });
          usedSongIds.add(matchedSong.id);
        }
        return;
      }

      if (taskSongTitle && !usedTaskOnlyTitles.has(normalizedTaskSongTitle)) {
        prioritized.push({
          id: `task-only-${task.id}`,
          title: taskSongTitle,
          lyrics: [],
          fromTask: true,
          taskOnly: true,
        });
        usedTaskOnlyTitles.add(normalizedTaskSongTitle);
      }
    });

    const remainingSongs = songsLibrary
      .filter((song) => !usedSongIds.has(song.id))
      .map((song) => ({ ...song, fromTask: false }));

    return [...prioritized, ...remainingSongs];
  }, [songsLibrary, linkedScheduleTasks]);

  useEffect(() => {
    if (!prioritizedSongs.length) {
      setSelectedSongId("");
      return;
    }

    if (!selectedSongId || !prioritizedSongs.some((song) => song.id === selectedSongId)) {
      setSelectedSongId(prioritizedSongs[0].id);
    }
  }, [prioritizedSongs, selectedSongId]);

  const selectedService = useMemo(
    () => services.find((service) => service.id === selectedServiceId) || null,
    [services, selectedServiceId]
  );

  const linkedEventIdForSchedule = useMemo(() => {
    if (!selectedService) return "";
    return selectedService.linkedEventId || getEventIdFromSchedulePath(selectedService.linkedEventSchedulePath);
  }, [selectedService]);

  const selectedSong = useMemo(
    () => prioritizedSongs.find((song) => song.id === selectedSongId) || null,
    [prioritizedSongs, selectedSongId]
  );

  const serviceCountdownData = useMemo(() => {
    if (!selectedService?.date || !selectedService?.startTime) {
      return { label: "Service countdown", value: "--:--:--", isLive: false };
    }

    const serviceStart = toDateFromServiceAndTime(selectedService.date, selectedService.startTime);
    if (!serviceStart) {
      return { label: "Service countdown", value: "--:--:--", isLive: false };
    }

    const diffSeconds = Math.floor((serviceStart.getTime() - nowTick) / 1000);
    if (diffSeconds <= 0) {
      return { label: "Service countdown", value: "Service started", isLive: false };
    }

    return { label: "Service countdown", value: formatCountdown(diffSeconds), isLive: true };
  }, [selectedService, nowTick]);

  const nextTaskCountdownData = useMemo(() => {
    if (!selectedService?.date || !linkedScheduleTasks.length) {
      return { label: "Next task", value: "No upcoming tasks", taskName: "" };
    }

    const upcomingTasks = linkedScheduleTasks
      .map((task) => ({
        ...task,
        startAt: toDateFromServiceAndTime(selectedService.date, task.startTime),
      }))
      .filter((task) => task.startAt && task.startAt.getTime() > nowTick)
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

    if (!upcomingTasks.length) {
      return { label: "Next task", value: "No upcoming tasks", taskName: "" };
    }

    const nextTask = upcomingTasks[0];
    const diffSeconds = Math.floor((nextTask.startAt.getTime() - nowTick) / 1000);
    return {
      label: "Next task",
      value: formatCountdown(diffSeconds),
      taskName: nextTask.description || nextTask.title || "Untitled task",
    };
  }, [selectedService, linkedScheduleTasks, nowTick]);

  // Extract unique teams and members from linked event tasks
  const linkedTeamsAndMembers = useMemo(() => {
    if (!linkedScheduleTasks.length) {
      return { teams: [], allMembers: [] };
    }

    const teamsMap = new Map();
    const allMembersSet = new Set();

    linkedScheduleTasks.forEach(task => {
      // Process teams
      if (task.teamIds && task.teamNames) {
        task.teamIds.forEach((teamId, index) => {
          const teamName = task.teamNames[index];
          if (!teamsMap.has(teamId)) {
            teamsMap.set(teamId, {
              id: teamId,
              name: teamName,
              members: new Set()
            });
          }
          
          // Add team members for this team
          if (task.teamMemberIds && task.teamMemberNames) {
            task.teamMemberIds.forEach((memberId, memberIndex) => {
              const memberName = task.teamMemberNames[memberIndex];
              teamsMap.get(teamId).members.add(JSON.stringify({ id: memberId, name: memberName }));
              allMembersSet.add(JSON.stringify({ id: memberId, name: memberName }));
            });
          }
        });
      }

      // Process team members not associated with specific teams
      if (task.teamMemberIds && task.teamMemberNames && (!task.teamIds || task.teamIds.length === 0)) {
        task.teamMemberIds.forEach((memberId, index) => {
          const memberName = task.teamMemberNames[index];
          allMembersSet.add(JSON.stringify({ id: memberId, name: memberName }));
        });
      }
    });

    const teams = Array.from(teamsMap.values()).map(team => ({
      ...team,
      members: Array.from(team.members).map(m => JSON.parse(m))
    })).sort((a, b) => a.name.localeCompare(b.name));

    const allMembers = Array.from(allMembersSet)
      .map(m => JSON.parse(m))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { teams, allMembers };
  }, [linkedScheduleTasks]);

  useEffect(() => {
    const loadLinkedSchedule = async () => {
      if (!linkedEventIdForSchedule) {
        setLinkedScheduleTasks([]);
        setLinkedEventDetails(null);
        return;
      }

      try {
        setLoadingLinkedSchedule(true);
        
        // Fetch event details including campus
        let eventData = null;
        const eventInstanceRef = doc(db, "eventInstances", linkedEventIdForSchedule);
        const eventInstanceDoc = await getDoc(eventInstanceRef);
        
        if (eventInstanceDoc.exists()) {
          eventData = eventInstanceDoc.data();
        } else {
          // Try events collection
          const eventRef = doc(db, "events", linkedEventIdForSchedule);
          const eventDoc = await getDoc(eventRef);
          if (eventDoc.exists()) {
            eventData = eventDoc.data();
          }
        }
        
        setLinkedEventDetails(eventData);
        
        const tasksQuery = query(
          collection(db, "eventTasks"),
          where("eventId", "==", linkedEventIdForSchedule),
          orderBy("startTime")
        );

        const snapshot = await getDocs(tasksQuery);
        const tasks = snapshot.docs.map((taskDoc) => ({ id: taskDoc.id, ...taskDoc.data() }));
        setLinkedScheduleTasks(tasks);
      } catch (error) {
        console.error("Error loading linked schedule tasks:", error);
        setLinkedScheduleTasks([]);
        setLinkedEventDetails(null);
      } finally {
        setLoadingLinkedSchedule(false);
      }
    };

    loadLinkedSchedule();
  }, [linkedEventIdForSchedule]);

  const updateService = async (serviceId, updates) => {
    const serviceRef = doc(db, "churches", id, "mySundayServices", serviceId);
    await updateDoc(serviceRef, {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  };

  const handleCreateService = async (event) => {
    event.preventDefault();

    if (!newService.name.trim() || !newService.startTime || !newService.date) {
      toast.warning("Please complete service name, time, and date");
      return;
    }

    try {
      setSavingService(true);

      const linkedEvent = availableEvents.find((event) => event.id === newService.linkedEventId);
      const scheduleLink = linkedEvent
        ? `/organization/${id}/event/${linkedEvent.id}/coordination`
        : "";

      const servicePayload = {
        name: newService.name.trim(),
        startTime: newService.startTime,
        date: newService.date,
        linkedEventId: linkedEvent?.id || "",
        linkedEventTitle: linkedEvent?.title || linkedEvent?.instanceTitle || "",
        linkedEventSchedulePath: scheduleLink,
        sections: createDefaultSections(scheduleLink),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const serviceRef = await addDoc(collection(db, "churches", id, "mySundayServices"), servicePayload);
      setSelectedServiceId(serviceRef.id);
      setNewService({ name: "", startTime: "", date: "", linkedEventId: "" });
      toast.success("Service created");
    } catch (error) {
      console.error("Error creating service:", error);
      toast.error("Failed to create service");
    } finally {
      setSavingService(false);
    }
  };

  const handleLinkedEventChange = (eventId) => {
    const linkedEvent = availableEvents.find((event) => event.id === eventId);

    if (!linkedEvent) {
      setNewService((prev) => ({ ...prev, linkedEventId: "" }));
      return;
    }

    const capturedDate = toInputDate(linkedEvent.startDate || linkedEvent.date || "");
    const capturedTime = toInputTime(linkedEvent.startHour || linkedEvent.startTime || linkedEvent.time || "");

    setNewService((prev) => ({
      ...prev,
      linkedEventId: eventId,
      date: capturedDate || prev.date,
      startTime: capturedTime || prev.startTime,
    }));
  };

  const handleDeleteService = async (serviceId) => {
    const shouldDelete = window.confirm("Delete this service and all its sections?");
    if (!shouldDelete) return;

    try {
      await deleteDoc(doc(db, "churches", id, "mySundayServices", serviceId));
      toast.success("Service deleted");
    } catch (error) {
      console.error("Error deleting service:", error);
      toast.error("Failed to delete service");
    }
  };

  const handleToggleSection = (sectionId) => {
    setOpenSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  const handleSaveSectionTitle = async (sectionId) => {
    if (!selectedService) return;

    const cleanTitle = editedTitle.trim();
    if (!cleanTitle) {
      toast.warning("Section title cannot be empty");
      return;
    }

    try {
      const sections = (selectedService.sections || []).map((section) =>
        section.id === sectionId ? { ...section, title: cleanTitle } : section
      );

      await updateService(selectedService.id, { sections });
      setEditingSectionId(null);
      setEditedTitle("");
      toast.success("Section title updated");
    } catch (error) {
      console.error("Error updating section title:", error);
      toast.error("Failed to update section title");
    }
  };

  const handleSectionContentChange = async (sectionId, content) => {
    if (!selectedService) return;

    try {
      const sections = (selectedService.sections || []).map((section) =>
        section.id === sectionId ? { ...section, content } : section
      );

      await updateService(selectedService.id, { sections });
    } catch (error) {
      console.error("Error updating section content:", error);
      toast.error("Failed to save section content");
    }
  };

  const handleDeleteSection = async (sectionId) => {
    if (!selectedService) return;
    const shouldDelete = window.confirm("Delete this section?");
    if (!shouldDelete) return;

    try {
      const sectionToDelete = (selectedService.sections || []).find((section) => section.id === sectionId);
      if (sectionToDelete?.attachments?.length && storage) {
        await Promise.all(
          sectionToDelete.attachments
            .filter((attachment) => attachment.path)
            .map((attachment) => deleteObject(ref(storage, attachment.path)).catch(() => null))
        );
      }

      const sections = (selectedService.sections || []).filter((section) => section.id !== sectionId);
      await updateService(selectedService.id, { sections });
      toast.success("Section deleted");
    } catch (error) {
      console.error("Error deleting section:", error);
      toast.error("Failed to delete section");
    }
  };

  const handleUploadToSection = async (sectionId, fileList) => {
    if (!selectedService || !fileList?.length) return;

    if (!storage) {
      toast.error("Storage is not available. File uploads are disabled.");
      return;
    }

    try {
      const uploadedAttachments = await Promise.all(
        Array.from(fileList).map(async (file) => {
          const safeName = file.name.replace(/\s+/g, "_");
          const path = `churches/${id}/mySunday/${selectedService.id}/${sectionId}/${Date.now()}_${safeName}`;
          const storageRef = ref(storage, path);

          await uploadBytes(storageRef, file);
          const url = await getDownloadURL(storageRef);

          return {
            id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: file.name,
            type: file.type,
            url,
            path,
            uploadedAt: new Date().toISOString(),
          };
        })
      );

      const sections = (selectedService.sections || []).map((section) =>
        section.id === sectionId
          ? { ...section, attachments: [...(section.attachments || []), ...uploadedAttachments] }
          : section
      );

      await updateService(selectedService.id, { sections });
      toast.success("Files uploaded");
    } catch (error) {
      console.error("Error uploading files:", error);
      toast.error("Failed to upload files");
    }
  };

  const handleDeleteAttachment = async (sectionId, attachmentId) => {
    if (!selectedService) return;

    try {
      const targetSection = (selectedService.sections || []).find((section) => section.id === sectionId);
      const targetAttachment = (targetSection?.attachments || []).find(
        (attachment) => attachment.id === attachmentId
      );

      if (targetAttachment?.path && storage) {
        await deleteObject(ref(storage, targetAttachment.path)).catch(() => null);
      }

      const sections = (selectedService.sections || []).map((section) => {
        if (section.id !== sectionId) return section;

        return {
          ...section,
          attachments: (section.attachments || []).filter((attachment) => attachment.id !== attachmentId),
        };
      });

      await updateService(selectedService.id, { sections });
      toast.success("Attachment removed");
    } catch (error) {
      console.error("Error deleting attachment:", error);
      toast.error("Failed to delete attachment");
    }
  };

  const restoreDefaultSections = async () => {
    if (!selectedService) return;

    try {
      const currentTitles = (selectedService.sections || []).map((section) => section.title.toLowerCase());
      const missing = DEFAULT_SECTIONS.filter((title) => !currentTitles.includes(title.toLowerCase()));

      if (!missing.length) {
        toast.info("All default sections are already present");
        return;
      }

      const newDefaults = missing.map((title, index) => ({
        id: `section_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`,
        title,
        content: "",
        type: title.toLowerCase(),
        attachments: [],
      }));

      await updateService(selectedService.id, {
        sections: [...(selectedService.sections || []), ...newDefaults],
      });

      toast.success("Missing default sections restored");
    } catch (error) {
      console.error("Error restoring sections:", error);
      toast.error("Failed to restore default sections");
    }
  };

  return (
    <div style={commonStyles.fullWidthContainer}>
      <Link to={`/organization/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to My Organization
      </Link>

      <ChurchHeader id={id} applyShadow={false} allowEditBannerLogo={false} />

      <div className="my-sunday-page">
        <div className="my-sunday-header">
          <h1>My Sunday</h1>
          <p>Create services and organize sections for each one.</p>
        </div>

        <form className="my-sunday-service-form" onSubmit={handleCreateService}>
          <input
            type="text"
            placeholder="Service name"
            value={newService.name}
            onChange={(event) => setNewService((prev) => ({ ...prev, name: event.target.value }))}
          />
          <input
            type="time"
            value={newService.startTime}
            onChange={(event) => setNewService((prev) => ({ ...prev, startTime: event.target.value }))}
          />
          <input
            type="date"
            value={newService.date}
            onChange={(event) => setNewService((prev) => ({ ...prev, date: event.target.value }))}
          />
          <select
            value={newService.linkedEventId}
            onChange={(event) => handleLinkedEventChange(event.target.value)}
          >
            <option value="">No linked event</option>
            {availableEvents.map((event) => (
              <option key={event.id} value={event.id}>
                {(event.title || event.instanceTitle || "Untitled Event")} · {event.startDate || "No date"}
              </option>
            ))}
          </select>
          <button type="submit" disabled={savingService}>
            {savingService ? "Adding..." : "Add Service"}
          </button>
        </form>
        <div className="my-sunday-events-hint">
          Need to create or edit events? <Link to={`/organization/${id}/all-events`}>Open All Events</Link>
        </div>

        <div className="my-sunday-layout">
          <div className="my-sunday-services-list">
            <h2>Services</h2>
            {loading ? (
              <p className="my-sunday-muted">Loading services...</p>
            ) : services.length === 0 ? (
              <p className="my-sunday-muted">No services yet. Add your first service above.</p>
            ) : (
              services.map((service) => (
                <div
                  key={service.id}
                  className={`my-sunday-service-item ${
                    selectedServiceId === service.id ? "active" : ""
                  }`}
                  onClick={() => setSelectedServiceId(service.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedServiceId(service.id);
                    }
                  }}
                >
                  <div>
                    <div className="my-sunday-service-name">{service.name}</div>
                    <div className="my-sunday-service-meta">
                      {service.date} • {service.startTime}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="my-sunday-delete-service"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleDeleteService(service.id);
                    }}
                  >
                    Delete
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="my-sunday-sections-panel">
            <div className="my-sunday-panel-head">
              <h2>{selectedService ? `${selectedService.name} Sections` : "Select a service"}</h2>
              {linkedEventDetails?.campusName && (
                <div style={{
                  fontSize: '14px',
                  color: '#6B7280',
                  marginTop: '8px',
                  padding: '8px 12px',
                  backgroundColor: '#F3F4F6',
                  borderRadius: '6px',
                  display: 'inline-block'
                }}>
                  <strong>Campus:</strong> {linkedEventDetails.campusName}
                </div>
              )}
              <div className="my-sunday-panel-head-actions">
                {selectedService?.linkedEventSchedulePath && (
                  <Link to={selectedService.linkedEventSchedulePath} className="my-sunday-open-schedule-link">
                    Open Schedule Link
                  </Link>
                )}
                {selectedService && (
                  <button
                    type="button"
                    className="danger"
                    onClick={() => handleDeleteService(selectedService.id)}
                  >
                    Delete Service
                  </button>
                )}
                {selectedService && (
                  <button type="button" onClick={restoreDefaultSections} className="secondary">
                    Restore Default Sections
                  </button>
                )}
              </div>
            </div>

            {!selectedService ? (
              <p className="my-sunday-muted">Choose a service to manage sections.</p>
            ) : (
              (selectedService.sections || []).map((section) => (
                <div key={section.id} className="my-sunday-section-card">
                  <div className="my-sunday-section-header">
                    <button
                      type="button"
                      className="my-sunday-toggle"
                      onClick={() => handleToggleSection(section.id)}
                    >
                      <span>{openSections[section.id] ? "▾" : "▸"}</span>
                      {editingSectionId === section.id ? (
                        <input
                          type="text"
                          value={editedTitle}
                          onChange={(event) => setEditedTitle(event.target.value)}
                          className="my-sunday-section-title-input"
                        />
                      ) : (
                        <strong>{section.title}</strong>
                      )}
                    </button>

                    <div className="my-sunday-section-actions">
                      {editingSectionId === section.id ? (
                        <>
                          <button type="button" onClick={() => handleSaveSectionTitle(section.id)}>
                            Save
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => {
                              setEditingSectionId(null);
                              setEditedTitle("");
                            }}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingSectionId(section.id);
                            setEditedTitle(section.title || "");
                          }}
                        >
                          Edit Title
                        </button>
                      )}
                      <button
                        type="button"
                        className="danger"
                        onClick={() => handleDeleteSection(section.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {openSections[section.id] && (
                    <div className="my-sunday-section-body">
                      {((section.type || "").toLowerCase() === "schedule" ||
                        (section.title || "").toLowerCase().includes("schedule")) && (
                        <div className="my-sunday-linked-schedule-box">
                          <div className="my-sunday-linked-schedule-head">
                            <strong>Linked Event Schedule</strong>
                            {selectedService?.linkedEventSchedulePath && (
                              <Link to={selectedService.linkedEventSchedulePath}>Open Coordination Page</Link>
                            )}
                          </div>

                          {!linkedEventIdForSchedule ? (
                            <p className="my-sunday-muted">No linked event for this service.</p>
                          ) : loadingLinkedSchedule ? (
                            <p className="my-sunday-muted">Loading schedule...</p>
                          ) : linkedScheduleTasks.length === 0 ? (
                            <p className="my-sunday-muted">No schedule tasks found for this linked event.</p>
                          ) : (
                            <div className="my-sunday-linked-schedule-list">
                              {linkedScheduleTasks.map((task) => (
                                <div key={task.id} className="my-sunday-linked-schedule-item">
                                  <div className="my-sunday-linked-time">{task.startTime || "--:--"}</div>
                                  <div className="my-sunday-linked-details">
                                    <div className="my-sunday-linked-title">
                                      {task.description || task.title || "Untitled task"}
                                    </div>
                                    <div className="my-sunday-linked-meta">
                                      {task.duration ? `${task.duration} min` : "No duration"}
                                      {task.responsible ? ` • ${task.responsible}` : ""}
                                    </div>
                                    {task.songTitle && (
                                      <div className="my-sunday-linked-song">🎵 {task.songTitle}</div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {((section.type || "").toLowerCase() === "timer" ||
                        (section.title || "").toLowerCase().includes("timer")) && (
                        <div className="my-sunday-timer-box">
                          <div className="my-sunday-timer-card">
                            <div className="my-sunday-timer-label">{serviceCountdownData.label}</div>
                            <div className="my-sunday-timer-value">{serviceCountdownData.value}</div>
                          </div>
                          <div className="my-sunday-timer-card">
                            <div className="my-sunday-timer-label">{nextTaskCountdownData.label}</div>
                            <div className="my-sunday-timer-value">{nextTaskCountdownData.value}</div>
                            {nextTaskCountdownData.taskName && (
                              <div className="my-sunday-timer-task-name">{nextTaskCountdownData.taskName}</div>
                            )}
                          </div>
                        </div>
                      )}

                      {((section.type || "").toLowerCase() === "songs" ||
                        (section.title || "").toLowerCase().includes("song")) && (
                        <div className="my-sunday-songs-box">
                          <div className="my-sunday-linked-schedule-head">
                            <strong>Song Library</strong>
                            <Link to={`/organization/${id}/song-manager`}>Open Song Manager</Link>
                          </div>

                          {loadingSongsLibrary ? (
                            <p className="my-sunday-muted">Loading songs...</p>
                          ) : prioritizedSongs.length === 0 ? (
                            <p className="my-sunday-muted">No songs found in Song Manager.</p>
                          ) : (
                            <div className="my-sunday-songs-layout">
                              <div className="my-sunday-songs-list" role="listbox" aria-label="Song list">
                                {prioritizedSongs.map((song) => (
                                  <button
                                    type="button"
                                    key={song.id}
                                    className={`my-sunday-song-item ${selectedSongId === song.id ? "active" : ""}`}
                                    onClick={() => setSelectedSongId(song.id)}
                                  >
                                    <span>{typeof song.title === 'string' ? song.title : "Untitled song"}</span>
                                    {song.fromTask && <span className="my-sunday-song-badge">From task</span>}
                                  </button>
                                ))}
                              </div>

                              <div className="my-sunday-song-detail">
                                {!selectedSong ? (
                                  <p className="my-sunday-muted">Select a song to view details.</p>
                                ) : (
                                  <>
                                    <h4>{typeof selectedSong.title === 'string' ? selectedSong.title : "Untitled song"}</h4>
                                    <div className="my-sunday-song-meta">
                                      {selectedSong.fromTask ? "Linked in this service schedule • " : ""}
                                      Total sections: {Array.isArray(selectedSong.lyrics) ? selectedSong.lyrics.length : (selectedSong.lyrics ? 1 : 0)}
                                    </div>
                                    <div className="my-sunday-song-lyrics">
                                      {Array.isArray(selectedSong.lyrics) && selectedSong.lyrics.length > 0 ? (
                                        selectedSong.lyrics.map((lyric, idx) => {
                                          const displayText = typeof lyric === 'string' 
                                            ? lyric.replace(/\\n/g, '\n') 
                                            : typeof lyric === 'object' 
                                              ? JSON.stringify(lyric, null, 2) 
                                              : String(lyric || "");
                                          return (
                                            <div key={`${selectedSong.id}-${idx}`} className="my-sunday-song-verse">
                                              <div className="my-sunday-song-verse-title">Part {idx + 1}</div>
                                              <pre>{displayText}</pre>
                                            </div>
                                          );
                                        })
                                      ) : typeof selectedSong.lyrics === 'string' && selectedSong.lyrics ? (
                                        <div className="my-sunday-song-verse">
                                          <div className="my-sunday-song-verse-title">Lyrics</div>
                                          <pre>{selectedSong.lyrics.replace(/\\n/g, '\n')}</pre>
                                        </div>
                                      ) : (
                                        <p className="my-sunday-muted">No lyrics/content for this song.</p>
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {((section.type || "").toLowerCase() === "roles" ||
                        (section.title || "").toLowerCase().includes("role")) && (
                        <div className="my-sunday-roles-box">
                          <div className="my-sunday-linked-schedule-head">
                            <strong>Teams & Members from Linked Event</strong>
                            {selectedService?.linkedEventSchedulePath && (
                              <Link to={selectedService.linkedEventSchedulePath}>Open Coordination Page</Link>
                            )}
                          </div>

                          {!linkedEventIdForSchedule ? (
                            <p className="my-sunday-muted">No linked event for this service.</p>
                          ) : loadingLinkedSchedule ? (
                            <p className="my-sunday-muted">Loading teams...</p>
                          ) : linkedTeamsAndMembers.teams.length === 0 && linkedTeamsAndMembers.allMembers.length === 0 ? (
                            <p className="my-sunday-muted">No teams or members assigned in the event coordination.</p>
                          ) : (
                            <div className="my-sunday-roles-content">
                              {linkedTeamsAndMembers.teams.length > 0 && (
                                <div className="my-sunday-teams-section">
                                  <h4 style={{ fontSize: '16px', marginBottom: '12px', color: '#374151' }}>Teams</h4>
                                  {linkedTeamsAndMembers.teams.map(team => (
                                    <div key={team.id} className="my-sunday-team-card" style={{
                                      backgroundColor: '#F9FAFB',
                                      padding: '16px',
                                      borderRadius: '8px',
                                      marginBottom: '12px',
                                      border: '1px solid #E5E7EB'
                                    }}>
                                      <div style={{
                                        fontSize: '15px',
                                        fontWeight: '600',
                                        color: '#1F2937',
                                        marginBottom: '8px'
                                      }}>
                                        👥 {team.name}
                                      </div>
                                      {team.members.length > 0 && (
                                        <div style={{ paddingLeft: '20px' }}>
                                          {team.members.map(member => (
                                            <div key={member.id} style={{
                                              fontSize: '14px',
                                              color: '#6B7280',
                                              padding: '4px 0',
                                              display: 'flex',
                                              alignItems: 'center',
                                              gap: '6px'
                                            }}>
                                              <span style={{ color: '#9CA3AF' }}>•</span>
                                              {member.name}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}

                              {linkedTeamsAndMembers.allMembers.length > 0 && (
                                <div className="my-sunday-all-members-section" style={{ marginTop: '20px' }}>
                                  <h4 style={{ fontSize: '16px', marginBottom: '12px', color: '#374151' }}>All Assigned Members</h4>
                                  <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                                    gap: '8px'
                                  }}>
                                    {linkedTeamsAndMembers.allMembers.map(member => (
                                      <div key={member.id} style={{
                                        backgroundColor: '#EEF2FF',
                                        padding: '8px 12px',
                                        borderRadius: '6px',
                                        fontSize: '14px',
                                        color: '#4F46E5',
                                        fontWeight: '500',
                                        border: '1px solid #E0E7FF'
                                      }}>
                                        {member.name}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      <label>Section Notes</label>
                      <textarea
                        value={section.content || ""}
                        placeholder="Add details for this section..."
                        onChange={(event) => handleSectionContentChange(section.id, event.target.value)}
                      />

                      <label>Upload Documents or Images</label>
                      <input
                        type="file"
                        multiple
                        onChange={(event) => {
                          handleUploadToSection(section.id, event.target.files);
                          event.target.value = "";
                        }}
                      />

                      <div className="my-sunday-attachments">
                        {(section.attachments || []).map((attachment) => (
                          <div key={attachment.id} className="my-sunday-attachment-item">
                            {attachment.type?.startsWith("image/") ? (
                              <img src={attachment.url} alt={attachment.name} />
                            ) : (
                              <div className="my-sunday-file-icon">📄</div>
                            )}
                            <a href={attachment.url} target="_blank" rel="noreferrer">
                              {attachment.name}
                            </a>
                            <button
                              type="button"
                              className="danger"
                              onClick={() => handleDeleteAttachment(section.id, attachment.id)}
                            >
                              Delete
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MySunday;