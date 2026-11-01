import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { db, storage } from "../firebase";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  addDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import Skeleton from "react-loading-skeleton";
import ChurchHeader from "./ChurchHeader";
import commonStyles from "../pages/commonStyles";
import { useAuth } from "../contexts/AuthContext";
import "./AllEvents.css";
import { IoMdSearch } from "react-icons/io";
import { MdAddCircleOutline, MdAddPhotoAlternate, MdAutoAwesome, MdCalendarMonth, MdCheckBox, MdCheckBoxOutlineBlank, MdDownload, MdEventAvailable, MdEdit, MdGridView, MdViewList, MdWarningAmber } from "react-icons/md";
import { toast } from 'react-toastify';
import { updateEventDesign } from '../utils/eventSeriesDesign';
import { downloadEventImage } from '../utils/downloadEventImage';
import { getAppliedDesignDetails, getEventDesignBaselines, getEventDesignDetails, getEventImageChanges, getSharedDesignDetails } from '../utils/eventDesignDetails';

// Function to format date from MM-DD-YYYY to Month Day, Year
const formatDisplayDate = (dateStr) => {
  if (!dateStr) return "";
  
  try {
    // Check if dateStr follows MM-DD-YYYY format
    if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) {
      const [month, day, year] = dateStr.split("-");
      // Note: Month is 0-indexed in JavaScript Date (January is 0)
      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      
      // Check if date is valid
      if (isNaN(date.getTime())) {
        console.warn("Invalid date from MM-DD-YYYY format:", dateStr);
        return dateStr;
      }
      
      return date.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric"
      });
    }
    
    // If the date is in a different format, try a more direct approach
    const isoDate = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const date = isoDate
      ? new Date(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]))
      : new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric"
      });
    }
    
    console.warn("Unrecognized date format:", dateStr);
    return dateStr;
  } catch (error) {
    console.error("Error formatting date:", error, "for dateStr:", dateStr);
    return dateStr;
  }
};

const formatDisplayTime = (time) => {
  if (typeof time !== 'string') return time || '';
  const match = time.match(/^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/);
  if (!match) return time;
  const hour = Number(match[1]);
  if (hour > 23) return time;
  const period = hour < 12 ? 'AM' : 'PM';
  return `${hour % 12 || 12}:${match[2]} ${period}`;
};

const toDateInputValue = (value) => {
  if (typeof value !== 'string' || !value) return '';
  const monthDayYear = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (monthDayYear) return `${monthDayYear[3]}-${monthDayYear[1]}-${monthDayYear[2]}`;
  const isoDate = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return isoDate ? isoDate[1] : '';
};

const parseCalendarDate = (value) => {
  if (typeof value?.toDate === 'function') value = value.toDate();
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (typeof value !== 'string' || !value) return null;

  const monthDayYear = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (monthDayYear) {
    const [, month, day, year] = monthDayYear;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const yearMonthDay = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const date = yearMonthDay
    ? new Date(Number(yearMonthDay[1]), Number(yearMonthDay[2]) - 1, Number(yearMonthDay[3]))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

const dateToInputValue = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const getQuickDateRange = (preset, now = new Date()) => {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start = new Date(today);
  let end = new Date(today);
  switch (preset) {
    case 'today':
      break;
    case 'tomorrow':
      start.setDate(start.getDate() + 1);
      end = new Date(start);
      break;
    case 'this-week':
      start.setDate(start.getDate() - start.getDay());
      end = new Date(start);
      end.setDate(end.getDate() + 6);
      break;
    case 'this-weekend':
      start.setDate(start.getDate() + (today.getDay() === 0 ? -1 : (6 - today.getDay())));
      end = new Date(start);
      end.setDate(end.getDate() + 1);
      break;
    case 'next-3-days':
      end.setDate(end.getDate() + 2);
      break;
    case 'this-month':
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      break;
    case 'next-month':
      start = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      end = new Date(today.getFullYear(), today.getMonth() + 2, 0);
      break;
    default:
      return { startDate: '', endDate: '' };
  }
  return { startDate: dateToInputValue(start), endDate: dateToInputValue(end) };
};

const getEventDateValue = (event) => {
  return parseCalendarDate(event.startDate || event.date)?.getTime() ?? null;
};

const sortEventsByDate = (events) => [...events].sort((first, second) => {
  const firstDate = getEventDateValue(first);
  const secondDate = getEventDateValue(second);
  if (firstDate === null && secondDate !== null) return 1;
  if (firstDate !== null && secondDate === null) return -1;
  if (firstDate !== secondDate) return firstDate - secondDate;
  return String(first.startHour || '').localeCompare(String(second.startHour || ''));
});

const markLegacyRecurrenceMasters = (events) => {
  const sortedEvents = sortEventsByDate(events);
  const legacySeries = new Map();
  sortedEvents.forEach(event => {
    if (!event.recurrenceType || event.recurrenceSeriesId || event.isRecurrenceMaster) return;
    const seriesKey = JSON.stringify([
      event.churchId || '',
      event.title || event.instanceTitle || '',
      event.recurrenceType,
      event.recurrenceEndDate || '',
      event.startHour || '',
      event.endHour || '',
      event.location || '',
      event.campusId || '',
      event.roomId || '',
      (event.venueGroups || []).map(group => group.id || group.name).sort(),
    ]);
    if (!legacySeries.has(seriesKey)) legacySeries.set(seriesKey, []);
    legacySeries.get(seriesKey).push(event);
  });

  const legacyMasterById = new Map();
  legacySeries.forEach(seriesEvents => {
    if (seriesEvents.length < 2) return;
    const eventIds = seriesEvents.map(event => event.id);
    legacyMasterById.set(seriesEvents[0].id, eventIds);
  });

  return sortedEvents.map(event => legacyMasterById.has(event.id)
    ? { ...event, isRecurrenceMaster: true, legacySeriesEventIds: legacyMasterById.get(event.id) }
    : event);
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const getWeekdayFromDateInput = (dateValue) => (
  dateValue ? String(new Date(`${dateValue}T00:00:00`).getDay()) : ''
);
const toMMDDYYYY = (date) => date
  .toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' })
  .replace(/(\d+)\/(\d+)\/(\d+)/, '$1-$2-$3');

const buildRecurrenceDates = (start, end, recurrenceType, recurrenceDayOfWeek) => {
  const dates = [];
  let cursor = new Date(start);
  const anchorDay = start.getDate();
  if (recurrenceType === 'weekly') {
    const targetWeekday = Number(recurrenceDayOfWeek);
    cursor.setDate(cursor.getDate() + ((targetWeekday - cursor.getDay() + 7) % 7));
  }

  let count = 0;
  while (cursor <= end && count < 366) {
    dates.push(new Date(cursor));
    count++;
    if (recurrenceType === 'daily') {
      cursor.setDate(cursor.getDate() + 1);
    } else if (recurrenceType === 'weekly') {
      cursor.setDate(cursor.getDate() + 7);
    } else if (recurrenceType === 'monthly') {
      const nextMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      const lastDay = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate();
      nextMonth.setDate(Math.min(anchorDay, lastDay));
      cursor = nextMonth;
    } else {
      cursor.setDate(cursor.getDate() + 7);
    }
  }

  return dates;
};

const EventEditorForm = ({ event, newEvent, setNewEvent, campuses, groups, availableRooms, creating, onSubmit, onCancel }) => {
  const isEditing = Boolean(event);
  const isSeriesMaster = Boolean(event?.isRecurrenceMaster);
  const selectedGroups = groups.filter(group => newEvent.venueGroupIds.includes(group.id));
  const suffix = isEditing ? event.id : 'new';

  return (
    <form onSubmit={onSubmit} className={`event-create-form${isEditing ? ' event-inline-edit-form' : ''}`}>
      <header className="event-create-header">
        <div>
          <p className="event-create-eyebrow">{isSeriesMaster ? 'EDIT RECURRING SERIES' : isEditing ? 'EDIT EVENT' : 'NEW EVENT'}</p>
          <h2>{isSeriesMaster ? 'Edit recurrence details' : isEditing ? 'Edit event details' : 'Create an event'}</h2>
          <p>Set the schedule, venue, and recurrence.</p>
        </div>
        <MdEventAvailable aria-hidden="true" className="event-create-header-icon" />
      </header>

      <section className="event-create-section" aria-labelledby={`event-details-${suffix}`}>
        <h3 id={`event-details-${suffix}`}><span>01</span> Event details</h3>
        <div className="event-create-grid event-create-grid-details">
          <label className="event-create-field event-create-field-title">
            <span>Event name <b>*</b></span>
            <input type="text" placeholder="e.g. Sunday gathering" value={newEvent.title} onChange={e => setNewEvent(prev => ({ ...prev, title: e.target.value }))} required />
          </label>
          <label className="event-create-field">
            <span>Date <b>*</b></span>
            <input type="date" value={newEvent.startDate} onChange={e => setNewEvent(prev => ({
              ...prev,
              startDate: e.target.value,
              recurrenceDayOfWeek: prev.recurrenceDayOfWeek || getWeekdayFromDateInput(e.target.value),
            }))} required />
          </label>
          <label className="event-create-field">
            <span>Starts <b>*</b></span>
            <input type="time" value={newEvent.startHour} onChange={e => setNewEvent(prev => ({ ...prev, startHour: e.target.value }))} required />
          </label>
          <label className="event-create-field">
            <span>Ends <small>Optional</small></span>
            <input type="time" value={newEvent.endHour} onChange={e => setNewEvent(prev => ({ ...prev, endHour: e.target.value }))} />
          </label>
        </div>
      </section>

      <section className="event-create-section" aria-labelledby={`event-venue-${suffix}`}>
        <h3 id={`event-venue-${suffix}`}><span>02</span> Venue</h3>
        <div className="event-create-grid event-create-grid-venue">
          <label className="event-create-field">
            <span>Campus <small>Optional</small></span>
            <select aria-label="Event campus" value={newEvent.campusId} onChange={e => setNewEvent(prev => ({ ...prev, campusId: e.target.value, roomId: '' }))}>
              <option value="">Select a campus</option>
              {campuses.map(campus => <option key={campus.id} value={campus.id}>{campus.name}</option>)}
            </select>
          </label>
          <label className="event-create-field">
            <span>Room <small>Optional</small></span>
            <select aria-label="Event room" value={newEvent.roomId} onChange={e => setNewEvent(prev => ({ ...prev, roomId: e.target.value }))} disabled={!newEvent.campusId || availableRooms.length === 0}>
              <option value="">{!newEvent.campusId ? 'Choose a campus first' : availableRooms.length ? 'Select a room' : 'No rooms for this campus'}</option>
              {availableRooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}
            </select>
          </label>
          <label className="event-create-field event-create-field-location">
            <span>Additional location details <small>Optional</small></span>
            <input type="text" placeholder="Building, entrance, or directions" value={newEvent.location} onChange={e => setNewEvent(prev => ({ ...prev, location: e.target.value }))} />
          </label>
        </div>
        <fieldset className="event-venue-groups">
          <div className="event-venue-groups-header">
            <legend>Groups at this venue <small>Optional</small></legend>
            <div className="event-venue-group-actions">
              <button type="button" onClick={() => setNewEvent(prev => ({ ...prev, venueGroupIds: groups.map(group => group.id) }))} disabled={groups.length === 0 || selectedGroups.length === groups.length}>Select all</button>
              <button type="button" onClick={() => setNewEvent(prev => ({ ...prev, venueGroupIds: [] }))} disabled={selectedGroups.length === 0}>Clear all</button>
            </div>
          </div>
          {groups.length === 0 ? (
            <p className="event-venue-groups-empty">No groups found for this organization.</p>
          ) : (
            <div className="event-venue-group-list">
              {groups.map(group => (
                <label key={group.id} className="event-venue-group-option">
                  <input type="checkbox" checked={newEvent.venueGroupIds.includes(group.id)} onChange={e => setNewEvent(prev => ({
                    ...prev,
                    venueGroupIds: e.target.checked ? [...prev.venueGroupIds, group.id] : prev.venueGroupIds.filter(groupId => groupId !== group.id),
                  }))} />
                  <span>{group.groupName || 'Unnamed group'}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
      </section>

      <section className="event-create-section event-create-repeat" aria-labelledby={`event-repeat-${suffix}`}>
        <div className="event-create-repeat-heading">
          <h3 id={`event-repeat-${suffix}`}><span>03</span> Repeat</h3>
          <label className="event-create-toggle">
            <input type="checkbox" checked={newEvent.isRecurring} onChange={e => setNewEvent(prev => ({ ...prev, isRecurring: e.target.checked }))} />
            <span>Make this a recurring event</span>
          </label>
        </div>
        {newEvent.isRecurring && (
          <div className="event-create-grid event-create-grid-repeat">
            <label className="event-create-field">
              <span>Repeat frequency</span>
              <select value={newEvent.recurrenceType} onChange={e => setNewEvent(prev => ({ ...prev, recurrenceType: e.target.value }))}>
                <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
              </select>
            </label>
            {newEvent.recurrenceType === 'weekly' && (
              <label className="event-create-field">
                <span>Repeat on</span>
                <select aria-label="Repeat on weekday" value={newEvent.recurrenceDayOfWeek} onChange={e => setNewEvent(prev => ({ ...prev, recurrenceDayOfWeek: e.target.value }))} required>
                  <option value="">Choose a day</option>
                  {WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}
                </select>
              </label>
            )}
            <label className="event-create-field">
              <span>Repeat through <b>*</b></span>
              <input type="date" value={newEvent.recurrenceEndDate} onChange={e => setNewEvent(prev => ({ ...prev, recurrenceEndDate: e.target.value }))} required />
            </label>
          </div>
        )}
      </section>

      {isSeriesMaster && (
        <section className="event-create-section" aria-labelledby={`event-design-${suffix}`}>
          <h3 id={`event-design-${suffix}`}><span>04</span> Design</h3>
          <label className="event-create-toggle">
            <input type="checkbox" aria-label="Use master design for all events" checked={Boolean(newEvent.useMasterDesignForSeries)} onChange={change => setNewEvent(previous => ({ ...previous, useMasterDesignForSeries: change.target.checked }))} />
            <span>Use master design for all events</span>
          </label>
        </section>
      )}

      <footer className="event-create-actions">
        <button type="button" className="event-create-cancel" onClick={onCancel}>Cancel</button>
        <button type="submit" className="event-create-submit" disabled={creating}>
          <MdAddCircleOutline aria-hidden="true" />
          {creating ? (isEditing ? 'Saving changes...' : 'Creating event...') : (isSeriesMaster ? 'Save series' : isEditing ? 'Save changes' : 'Create event')}
        </button>
      </footer>
    </form>
  );
};

const EventCardImage = ({ imageUrl, title, backgroundColor, firstLetter, onUpload, calendar = false }) => {
  const ImageContainer = calendar ? 'span' : 'div';
  const fileInput = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState(
    typeof imageUrl === 'string' && /^https?:\/\//i.test(imageUrl) ? imageUrl : null
  );

  useEffect(() => {
    let active = true;
    if (!imageUrl || /^https?:\/\//i.test(imageUrl)) return;

    const resolveImage = async () => {
      try {
        const url = await getDownloadURL(ref(storage, String(imageUrl).replace(/^\//, '')));
        if (active) setResolvedUrl(url);
      } catch (error) {
        if (active) setResolvedUrl(null);
      }
    };

    resolveImage();
    return () => { active = false; };
  }, [imageUrl]);

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image size should be less than 5MB');
      return;
    }

    setUploading(true);
    try {
      await onUpload(file);
      toast.success('Event image updated successfully');
    } catch (error) {
      toast.error('Failed to upload image');
    } finally {
      setUploading(false);
    }
  };

  return (
    <ImageContainer className={calendar ? 'event-calendar-image' : 'event-img'} style={{ background: resolvedUrl ? 'none' : backgroundColor }}>
      {resolvedUrl ? (
        <img
          src={resolvedUrl}
          alt={title || 'Event'}
          loading="lazy"
          onError={() => setResolvedUrl(null)}
        />
      ) : <span>{firstLetter}</span>}
      {!calendar && <button
        type="button"
        className="event-image-download"
        aria-label={`Download image for ${title || 'Event'}`}
        title={downloading ? 'Downloading image...' : 'Download image'}
        disabled={!resolvedUrl || downloading || uploading}
        aria-busy={downloading}
        onClick={async event => {
          event.stopPropagation();
          if (!resolvedUrl || downloading) return;
          setDownloading(true);
          try {
            await downloadEventImage(resolvedUrl, title || 'Event');
          } catch (error) {
            toast.error(error.message || 'Could not download image');
          } finally {
            setDownloading(false);
          }
        }}
      ><MdDownload size={22} /></button>}
      {onUpload && !calendar && (
        <>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            hidden
            aria-label={`Event image for ${title || 'Event'}`}
            disabled={uploading}
            onClick={event => event.stopPropagation()}
            onChange={handleFileChange}
          />
          <button
            type="button"
            className="event-image-upload"
            aria-label={`Upload image for ${title || 'Event'}`}
            title={uploading ? 'Uploading image...' : imageUrl ? 'Change event image' : 'Upload event image'}
            disabled={uploading}
            aria-busy={uploading}
            onClick={event => {
              event.stopPropagation();
              fileInput.current.click();
            }}
          >
            <MdAddPhotoAlternate size={22} />
          </button>
        </>
      )}
    </ImageContainer>
  );
};

const AllEvents = () => {
  const { id } = useParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [events, setEvents] = useState([]);
  const [campuses, setCampuses] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [seriesFilter, setSeriesFilter] = useState('all');
  const [viewMode, setViewMode] = useState('list');
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [startDateFilter, setStartDateFilter] = useState("");
  const [endDateFilter, setEndDateFilter] = useState("");
  const [quickDateFilter, setQuickDateFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [eventsPerPage] = useState(10);
  const [selectedEvents, setSelectedEvents] = useState([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [creating, setCreating] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [newEvent, setNewEvent] = useState({
    title: '',
    startDate: '', // YYYY-MM-DD from input
    startHour: '', // HH:MM
    endHour: '',   // HH:MM
    location: '',
    campusId: '',
    roomId: '',
    venueGroupIds: [],
    isRecurring: false,
    recurrenceType: 'weekly', // daily | weekly | monthly
    recurrenceDayOfWeek: '',
    useMasterDesignForSeries: false,
    recurrenceEndDate: '' // YYYY-MM-DD
  });
  const normalizedRole = String(user?.role || '').toLowerCase();
  const normalizedBaseRole = String(user?.baseRole || user?.basedOn || '').toLowerCase();
  const isGlobalAdmin = normalizedRole === 'global_admin' || normalizedBaseRole === 'global_admin';
  const isOrganizationAdmin = normalizedRole === 'admin' || normalizedBaseRole === 'admin';
  const userOrganizationId = String(user?.churchId || user?.churchID || user?.organizationId || '');
  const canManageEvents = Boolean(user && (isGlobalAdmin || (isOrganizationAdmin && userOrganizationId === String(id))));
  const canReadOrganizationVenues = Boolean(user && (isGlobalAdmin || userOrganizationId === String(id)));
  
  // Check if we're coming from card edit/creation
  const isFromCardEdit = location.state?.fromCardEdit || false;
  const preselectedEventIds = location.state?.selectedEventIds || [];
  const selectedCampus = campuses.find(campus => campus.id === newEvent.campusId);
  const selectedRoom = rooms.find(room => room.id === newEvent.roomId && room.campusId === newEvent.campusId);
  const selectedGroups = groups.filter(group => newEvent.venueGroupIds.includes(group.id));
  const availableRooms = newEvent.campusId
    ? rooms.filter(room => room.campusId === newEvent.campusId)
    : [];

  const handleEventImageUpload = async (event, file) => {
    if (!canManageEvents) return;
    const imagePath = `events/${id}/${event.id}/${Date.now()}_${file.name}`;
    await uploadBytes(ref(storage, imagePath), file);
    const updatedIds = await updateEventDesign(id, event, imagePath);
    const updatedImageDetails = item => item.id === event.id ? getEventDesignDetails(event) : getSharedDesignDetails(item, getEventDesignDetails(event));
    const isOccurrenceOverride = item => item.id === event.id && Boolean(event.recurrenceSeriesId && !event.isRecurrenceMaster);
    setEvents(previous => previous.map(item => updatedIds.has(item.id) ? { ...item, imageUrl: imagePath, imageEventDetails: updatedImageDetails(item), imageIsSeriesOverride: isOccurrenceOverride(item) } : item));
    setEditingEvent(previous => previous && updatedIds.has(previous.id) ? { ...previous, imageUrl: imagePath, imageEventDetails: updatedImageDetails(previous), imageIsSeriesOverride: isOccurrenceOverride(previous) } : previous);
  };

  useEffect(() => {
    const fetchCampusesAndRooms = async () => {
      const loadCollection = async (label, reference, sortBy, setter) => {
        try {
          const snapshot = await getDocs(reference);
          setter(snapshot.docs
            .map(document => ({ id: document.id, ...document.data() }))
            .sort((first, second) => (first[sortBy] || "").localeCompare(second[sortBy] || "")));
        } catch (err) {
          console.error(`Error loading event ${label}:`, err);
          toast.error(`Failed to load ${label}`);
        }
      };

      await Promise.all([
        loadCollection('campuses', collection(db, "churches", id, "campuses"), 'name', setCampuses),
        loadCollection('rooms', collection(db, "churches", id, "rooms"), 'name', setRooms),
        loadCollection('groups', query(collection(db, "groups"), where("churchId", "==", id)), 'groupName', setGroups),
      ]);
    };

    if (authLoading) return;
    if (!canReadOrganizationVenues) {
      setCampuses([]);
      setRooms([]);
      setGroups([]);
      return;
    }
    if (id) fetchCampusesAndRooms();
  }, [id, canReadOrganizationVenues, authLoading]);

  useEffect(() => {
    // If coming from card edit, enable selection mode
    if (isFromCardEdit) {
      setSelectionMode(true);
    }
  }, [isFromCardEdit]);

  // Initialize selected events from preselected IDs
  useEffect(() => {
    if (events.length > 0 && preselectedEventIds.length > 0) {
      const preselected = events.filter(event => 
        preselectedEventIds.includes(event.id)
      );
      setSelectedEvents(preselected);
    }
  }, [events, preselectedEventIds]);

  // Function to handle event selection
  const toggleEventSelection = (event) => {
    setSelectedEvents(prev => {
      const eventId = event.id;
      if (prev.some(e => e.id === eventId)) {
        return prev.filter(e => e.id !== eventId);
      } else {
        return [...prev, event];
      }
    });
  };

  // Function to select/deselect all visible events
  const toggleSelectAll = () => {
    if (selectedEvents.length === currentEvents.length) {
      setSelectedEvents([]);
    } else {
      setSelectedEvents([...currentEvents]);
    }
  };

  // Function to apply selection and return to card edit
  const applySelection = () => {
    navigate(`/organization/${id}`, { 
      state: { 
        selectedEventIds: selectedEvents.map(event => event.id),
        eventTitles: selectedEvents.map(event => event.title || event.instanceTitle),
        fromAllEvents: true 
      } 
    });
  };

  // Handle back navigation
  const handleBackClick = () => {
    if (isFromCardEdit) {
      // Return to ChurchApp.js when coming from card edit/creation
      navigate(`/organization/${id}`);
    } else {
      // Default back behavior
      navigate(`/organization/${id}/mi-organizacion`);
    }
  };

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        setLoading(true);
        // Get today's date in MM-DD-YYYY format
        const today = new Date();
        const formattedToday = today.toLocaleDateString("en-US", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          })
          .replace(/(\d+)\/(\d+)\/(\d+)/, "$1-$2-$3");

        // Only use churchId and startDate in the query
        const eventsQuery = query(
          collection(db, "eventInstances"),
          where("churchId", "==", id),
          where("startDate", ">=", formattedToday)
        );

        const snapshot = await getDocs(eventsQuery);
        const eventsData = snapshot.docs
          .map((doc) => ({
            id: doc.id,
            ...doc.data(),
          }))
          // Filter removed/deleted events in memory
          .filter(event => !event.removed && !event.isDeleted);

        setEvents(markLegacyRecurrenceMasters(eventsData));
      } catch (err) {
        console.error("Error fetching events:", err);
        setError("Error loading events");
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
  }, [id]);

  const handleViewEvent = (id, eventId) => {
    navigate(`/organization/${id}/event/${eventId}`);
  };

  const handleEventCoordination = (id, eventId) => {
    navigate(`/organization/${id}/event/${eventId}/coordination`);
  };

  const handleDeleteEvent = async (eventId) => {
    if (!canManageEvents) {
      toast.error('An organization admin must sign in to manage events');
      return;
    }
    if (!window.confirm('Delete this event permanently? This cannot be undone.')) return;
    try {
      await deleteDoc(doc(db, 'eventInstances', eventId));
      setEvents(prev => prev.filter(e => e.id !== eventId));
      toast.success('Event deleted');
    } catch (err) {
      console.error('Delete event failed:', err);
      toast.error('Failed to delete event');
    }
  };

  const handleDeleteAllEvents = async () => {
    if (!canManageEvents) {
      toast.error('An organization admin must sign in to manage events');
      return;
    }
    if (!window.confirm('Delete ALL upcoming events for this organization?')) return;
    setBulkDeleting(true);
    try {
      const qAll = query(collection(db, 'eventInstances'), where('churchId', '==', id));
      const snap = await getDocs(qAll);
      const batch = writeBatch(db);
      snap.docs.forEach(d => batch.delete(doc(db, 'eventInstances', d.id)));
      await batch.commit();
      setEvents([]);
      toast.success('All events deleted');
    } catch (err) {
      console.error('Bulk delete failed:', err);
      toast.error('Failed to delete all events');
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleCreateEvent = async (e) => {
    e.preventDefault();
    if (creating) return;
    if (!canManageEvents) {
      toast.error('Sign in as an organization admin to create or edit events');
      return;
    }
    if (!newEvent.title || !newEvent.startDate || !newEvent.startHour) {
      toast.error('Title, date and start time are required');
      return;
    }
    if (newEvent.isRecurring && !newEvent.recurrenceEndDate) {
      toast.error('Please select an end date for the recurring series');
      return;
    }
    if (newEvent.isRecurring && newEvent.recurrenceType === 'weekly' && newEvent.recurrenceDayOfWeek === '') {
      toast.error('Please select a day of the week for the recurring series');
      return;
    }
    setCreating(true);
    try {
      const locationAssignment = {
        campusId: selectedCampus?.id || "",
        campusName: selectedCampus?.name || "",
        roomId: selectedRoom?.id || "",
        roomName: selectedRoom?.name || "",
        venueGroups: selectedGroups.map(group => ({ id: group.id, name: group.groupName || "Unnamed group" })),
      };
      const eventLocation = newEvent.location || [selectedCampus?.name, selectedRoom?.name].filter(Boolean).join(" - ");
      const start = new Date(newEvent.startDate + 'T00:00:00');
      if (editingEvent?.isRecurrenceMaster && (editingEvent.recurrenceSeriesId || editingEvent.legacySeriesEventIds?.length)) {
        const recurrenceSeriesId = editingEvent.recurrenceSeriesId || `${id}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const recurrenceEnd = newEvent.recurrenceEndDate
          ? new Date(newEvent.recurrenceEndDate + 'T00:00:00')
          : null;
        const dates = newEvent.isRecurring
          ? buildRecurrenceDates(start, recurrenceEnd, newEvent.recurrenceType, newEvent.recurrenceDayOfWeek)
          : [start];
        if (dates.length === 0) {
          toast.error('The selected recurrence settings produce no event dates');
          return;
        }

        const legacyEventIds = editingEvent.legacySeriesEventIds || [];
        let existingInstances;
        if (legacyEventIds.length) {
          existingInstances = sortEventsByDate(events.filter(seriesEvent => legacyEventIds.includes(seriesEvent.id)));
        } else {
          const seriesSnapshot = await getDocs(query(
            collection(db, 'eventInstances'),
            where('recurrenceSeriesId', '==', recurrenceSeriesId)
          ));
          existingInstances = sortEventsByDate(seriesSnapshot.docs.map(eventDoc => ({
            id: eventDoc.id,
            ...eventDoc.data(),
          })).filter(seriesEvent => seriesEvent.recurrenceSeriesId === recurrenceSeriesId && String(seriesEvent.churchId) === String(id)));
        }
        if (!existingInstances.some(seriesEvent => seriesEvent.id === editingEvent.id)) {
          existingInstances.push(editingEvent);
          existingInstances.splice(0, existingInstances.length, ...sortEventsByDate(existingInstances));
        }

        const updatedInstances = [];
        for (let index = 0; index < dates.length; index++) {
          const isRecurring = newEvent.isRecurring;
          const existingInstance = existingInstances[index];
          const eventPayload = {
            title: newEvent.title,
            instanceTitle: newEvent.title,
            startDate: toMMDDYYYY(dates[index]),
            startHour: newEvent.startHour,
            endHour: newEvent.endHour || '',
            location: eventLocation,
            ...locationAssignment,
            churchId: id,
            isRecurring,
            recurrenceType: isRecurring ? newEvent.recurrenceType : '',
            recurrenceDayOfWeek: isRecurring && newEvent.recurrenceType === 'weekly' ? Number(newEvent.recurrenceDayOfWeek) : null,
            recurrenceEndDate: isRecurring && recurrenceEnd ? toMMDDYYYY(recurrenceEnd) : '',
            recurrenceSeriesId: isRecurring ? recurrenceSeriesId : '',
            isRecurrenceMaster: isRecurring && index === 0,
            useMasterDesignForSeries: isRecurring && index === 0 && Boolean(newEvent.useMasterDesignForSeries),
            ...(newEvent.useMasterDesignForSeries && editingEvent.imageUrl && !existingInstance?.imageIsSeriesOverride ? { imageUrl: editingEvent.imageUrl } : {}),
            removed: false,
            ...getEventDesignBaselines(existingInstance),
          };
          if (newEvent.useMasterDesignForSeries && editingEvent.imageUrl && !existingInstance?.imageIsSeriesOverride) {
            const masterDetails = getAppliedDesignDetails(editingEvent) || getEventDesignDetails(editingEvent);
            eventPayload.imageEventDetails = index === 0 ? masterDetails : getSharedDesignDetails(existingInstance || eventPayload, masterDetails);
          }
          if (existingInstance) {
            await updateDoc(doc(db, 'eventInstances', existingInstance.id), eventPayload);
            updatedInstances.push({ ...existingInstance, ...eventPayload });
          } else {
            const createPayload = { ...eventPayload, status: 'optional', createdAt: serverTimestamp() };
            const newInstance = await addDoc(collection(db, 'eventInstances'), createPayload);
            updatedInstances.push({ id: newInstance.id, ...createPayload });
          }
        }

        for (const removedInstance of existingInstances.slice(dates.length)) {
          await updateDoc(doc(db, 'eventInstances', removedInstance.id), {
            removed: true,
            isRecurrenceMaster: false,
          });
        }

        const existingInstanceIds = new Set(existingInstances.map(seriesEvent => seriesEvent.id));
        setEvents(prev => sortEventsByDate([
          ...prev.filter(event => event.recurrenceSeriesId !== recurrenceSeriesId && !existingInstanceIds.has(event.id)),
          ...updatedInstances,
        ]));
        toast.success(newEvent.isRecurring ? 'Recurring series updated' : 'Recurring series ended');
      } else if (editingEvent) {
        const recurrenceEnd = newEvent.recurrenceEndDate
          ? new Date(newEvent.recurrenceEndDate + 'T00:00:00')
          : null;
        const payload = {
          title: newEvent.title,
          instanceTitle: newEvent.title,
          startDate: toMMDDYYYY(start),
          startHour: newEvent.startHour,
          endHour: newEvent.endHour || '',
          location: eventLocation,
          ...locationAssignment,
          churchId: id,
          isRecurring: newEvent.isRecurring,
          recurrenceType: newEvent.isRecurring ? newEvent.recurrenceType : '',
          recurrenceDayOfWeek: newEvent.isRecurring && newEvent.recurrenceType === 'weekly' ? Number(newEvent.recurrenceDayOfWeek) : null,
          recurrenceEndDate: newEvent.isRecurring && recurrenceEnd ? toMMDDYYYY(recurrenceEnd) : '',
          ...getEventDesignBaselines(editingEvent),
        };
        await updateDoc(doc(db, 'eventInstances', editingEvent.id), payload);
        setEvents(prev => sortEventsByDate(prev.map(event => (
          event.id === editingEvent.id ? { ...event, ...payload } : event
        ))));
        toast.success('Event updated');
      } else if (!newEvent.isRecurring) {
        const payload = {
          title: newEvent.title,
          instanceTitle: newEvent.title,
          startDate: toMMDDYYYY(start),
          startHour: newEvent.startHour,
          endHour: newEvent.endHour || '',
          location: eventLocation,
          ...locationAssignment,
          churchId: id,
          status: 'optional',
          createdAt: serverTimestamp(),
          isRecurring: false,
          recurrenceDayOfWeek: null,
          recurrenceSeriesId: '',
          isRecurrenceMaster: false,
        };
        const ref = await addDoc(collection(db, 'eventInstances'), payload);
        setEvents(prev => sortEventsByDate([...prev, { id: ref.id, ...payload }]));
        toast.success('Event created');
      } else {
        // Build a list of dates from start until recurrenceEndDate inclusive
        const end = new Date(newEvent.recurrenceEndDate + 'T00:00:00');
        const dates = buildRecurrenceDates(start, end, newEvent.recurrenceType, newEvent.recurrenceDayOfWeek);

        if (dates.length === 0) {
          toast.error('The selected recurrence settings produce no event dates');
          return;
        }

        const recurrenceSeriesId = `${id}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        // Create all instances in a batch
        const payloads = dates.map((d, index) => ({
          title: newEvent.title,
          instanceTitle: newEvent.title,
          startDate: toMMDDYYYY(d),
          startHour: newEvent.startHour,
          endHour: newEvent.endHour || '',
          location: eventLocation,
          ...locationAssignment,
          churchId: id,
          status: 'optional',
          createdAt: serverTimestamp(),
          isRecurring: true,
          recurrenceType: newEvent.recurrenceType,
          recurrenceDayOfWeek: newEvent.recurrenceType === 'weekly' ? Number(newEvent.recurrenceDayOfWeek) : null,
          recurrenceSeriesId,
          isRecurrenceMaster: index === 0,
          recurrenceEndDate: toMMDDYYYY(end)
        }));

        // Using sequential adds to preserve createdAt serverTimestamp accuracy
        const created = [];
        for (const p of payloads) {
          const ref = await addDoc(collection(db, 'eventInstances'), p);
          created.push({ id: ref.id, ...p });
        }
        // Prepend newly created to state
        setEvents(prev => sortEventsByDate([...prev, ...created]));
        toast.success(`Created ${created.length} recurring events`);
      }

      setShowAddForm(false);
      setEditingEvent(null);
      setNewEvent({ title:'', startDate:'', startHour:'', endHour:'', location:'', campusId:'', roomId:'', venueGroupIds:[], isRecurring:false, recurrenceType:'weekly', recurrenceDayOfWeek:'', recurrenceEndDate:'', useMasterDesignForSeries:false });
    } catch (err) {
      console.error('Create event failed:', err);
      toast.error('Failed to create event');
    } finally {
      setCreating(false);
    }
  };

  const handleEditEvent = (event) => {
    setEditingEvent(event);
    setNewEvent({
      title: event.title || event.instanceTitle || '',
      startDate: toDateInputValue(event.startDate || event.date),
      startHour: event.startHour || '',
      endHour: event.endHour || '',
      location: event.location || '',
      campusId: event.campusId || '',
      roomId: event.roomId || '',
      venueGroupIds: (event.venueGroups || []).map(group => group.id),
      isRecurring: Boolean(event.isRecurring),
      recurrenceType: event.recurrenceType || 'weekly',
      recurrenceDayOfWeek: event.recurrenceDayOfWeek !== undefined && event.recurrenceDayOfWeek !== null
        ? String(event.recurrenceDayOfWeek)
        : getWeekdayFromDateInput(toDateInputValue(event.startDate || event.date)),
      recurrenceSeriesId: event.recurrenceSeriesId || '',
      isRecurrenceMaster: Boolean(event.isRecurrenceMaster),
      useMasterDesignForSeries: Boolean(event.useMasterDesignForSeries),
      recurrenceEndDate: toDateInputValue(event.recurrenceEndDate),
    });
    setShowAddForm(false);
  };

  const filteredEvents = events.filter((event) => {
    if (event.removed || event.isDeleted) return false;

    const matchesSearch = event.title
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
    const isUniqueEvent = !event.recurrenceSeriesId && !event.isRecurring && !event.recurrenceType;
    const matchesSeries = seriesFilter === 'all' || event.isRecurrenceMaster || (seriesFilter === 'masters-unique' && isUniqueEvent);

    if (!startDateFilter && !endDateFilter) {
      return matchesSearch && matchesSeries;
    }

    const eventStartDate = parseCalendarDate(event.startDate || event.date);
    const eventEndDate = parseCalendarDate(event.endDate) || eventStartDate;
    const filterStartDate = parseCalendarDate(startDateFilter);
    const filterEndDate = parseCalendarDate(endDateFilter);
    const isWithinRange = Boolean(eventStartDate && eventEndDate)
      && (!filterStartDate || eventEndDate >= filterStartDate)
      && (!filterEndDate || eventStartDate <= filterEndDate);

    return matchesSearch && matchesSeries && isWithinRange;
  });

  const handleQuickDateFilter = (event) => {
    const preset = event.target.value;
    setQuickDateFilter(preset);
    if (preset === 'all' || preset === 'custom') return;
    const range = getQuickDateRange(preset);
    setStartDateFilter(range.startDate);
    setEndDateFilter(range.endDate);
  };

  const handleManualDateFilter = (field, value) => {
    if (field === 'start') {
      setStartDateFilter(value);
      setQuickDateFilter(value || endDateFilter ? 'custom' : 'all');
    } else {
      setEndDateFilter(value);
      setQuickDateFilter(startDateFilter || value ? 'custom' : 'all');
    }
  };

  // Pagination logic
  const indexOfLastEvent = currentPage * eventsPerPage;
  const indexOfFirstEvent = indexOfLastEvent - eventsPerPage;
  const currentEvents = filteredEvents.slice(indexOfFirstEvent, indexOfLastEvent);
  const totalPages = Math.ceil(filteredEvents.length / eventsPerPage);
  const calendarDays = Array.from({ length: 42 }, (_, index) => {
    const firstDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1 - calendarMonth.getDay());
    firstDay.setDate(firstDay.getDate() + index);
    return firstDay;
  });
  const calendarEventsByDate = filteredEvents.reduce((eventsByDate, event) => {
    const eventDate = parseCalendarDate(event.startDate || event.date);
    if (!eventDate) return eventsByDate;
    const dateKey = dateToInputValue(eventDate);
    eventsByDate.set(dateKey, [...(eventsByDate.get(dateKey) || []), event]);
    return eventsByDate;
  }, new Map());

  const paginate = (pageNumber) => setCurrentPage(pageNumber);
  
  // Previous and next page functions
  const goToPreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };
  
  const goToNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  return (
    <div style={{ ...commonStyles.fullWidthContainer, minHeight: '100vh', textAlign: 'left' }}>
      <button
        onClick={handleBackClick}
        style={{ ...commonStyles.backButtonLink }}
      >
        ← Back to {isFromCardEdit ? "Card Editor" : "Mi Organización"}
      </button>

      <ChurchHeader id={id} />

      {!authLoading && !user && (
        <div className="events-access-notice" role="status">
          <div>
            <strong>Sign in to manage venues and create events.</strong>
            <span>Existing events remain viewable.</span>
          </div>
          <button type="button" onClick={() => navigate(`/organization/${id}/login`)}>Sign in</button>
        </div>
      )}
      {!authLoading && user && !canManageEvents && (
        <div className="events-access-notice" role="status">
          <div>
            <strong>Organization admin access required to manage events.</strong>
            <span>You can still view the event list.</span>
          </div>
        </div>
      )}

      <div>
        <h1 style={commonStyles.title}>
          {selectionMode ? "Select Events" : "All Upcoming Events"}
        </h1>
        
        {selectionMode && (
          <div className="selection-controls" style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: '15px',
            padding: '10px',
            backgroundColor: '#f0f4f8',
            borderRadius: '8px'
          }}>
            <div>
              <button 
                onClick={toggleSelectAll}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#4F46E5',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  marginRight: '10px'
                }}
              >
                {selectedEvents.length === currentEvents.length ? 'Deselect All' : 'Select All'}
              </button>
              <span style={{
                marginLeft: '10px',
                fontWeight: '500'
              }}>
                {selectedEvents.length} events selected
              </span>
            </div>
            <button
              onClick={applySelection}
              style={{
                padding: '8px 16px',
                backgroundColor: '#10B981',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
              disabled={selectedEvents.length === 0}
            >
              Apply Selection
            </button>
          </div>
        )}
        
        <div className="search-event-container">
          <input
            type="text"
            placeholder="Search events..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-event"
          />
          <div className="date-range-container">
            <div className="datepicker-wrapper">
              <label>Start Date</label>
              <input
                type="date"
                value={startDateFilter}
                onChange={(e) => handleManualDateFilter('start', e.target.value)}
                className="search-event"
                placeholder="Start date"
              />
            </div>
            <span>to</span>
            <div className="datepicker-wrapper">
              <label>End Date</label>
              <input
                type="date"
                value={endDateFilter}
                onChange={(e) => handleManualDateFilter('end', e.target.value)}
                className="search-event"
                placeholder="End date"
              />
            </div>
          </div>
          <label className="date-preset-filter">
            <span>Quick date range</span>
            <select aria-label="Quick date range" value={quickDateFilter} onChange={handleQuickDateFilter}>
              <option value="all">All dates</option>
              <option value="today">Today</option>
              <option value="tomorrow">Tomorrow</option>
              <option value="this-week">This week</option>
              <option value="this-weekend">This weekend</option>
              <option value="next-3-days">Next 3 days</option>
              <option value="this-month">This month</option>
              <option value="next-month">Next month</option>
              {quickDateFilter === 'custom' && <option value="custom">Custom range</option>}
            </select>
          </label>
          <label className="series-filter-field">
            <span>Show</span>
            <select aria-label="Filter events by series" value={seriesFilter} onChange={event => setSeriesFilter(event.target.value)}>
              <option value="all">All events</option>
              <option value="masters">Series masters only</option>
              <option value="masters-unique">Series Masters + Unique Events</option>
            </select>
          </label>
          <IoMdSearch size={20} className="search-icon-event" />
        </div>

        {/* Actions row */}
        <div style={{ display:'flex', gap:12, marginTop:12, flexWrap:'wrap' }}>
          <button
            type="button"
            onClick={() => navigate(`/organization/${id}/all-events/counter-analytics`)}
            style={{ padding:'8px 14px', background:'#0F766E', color:'#fff', border:'none', borderRadius:6, cursor:'pointer' }}
          >
            Counter Analytics
          </button>
          {canManageEvents && <button
            onClick={() => {
              if (!showAddForm) {
                setEditingEvent(null);
                setNewEvent({ title:'', startDate:'', startHour:'', endHour:'', location:'', campusId:'', roomId:'', venueGroupIds:[], isRecurring:false, recurrenceType:'weekly', recurrenceDayOfWeek:'', recurrenceEndDate:'' });
              }
              setShowAddForm(s => !s);
            }}
            style={{ padding:'8px 14px', background:'#4F46E5', color:'#fff', border:'none', borderRadius:6, cursor:'pointer' }}
          >
            {showAddForm ? 'Close' : 'Add New Event'}
          </button>}
          {canManageEvents && <button
            onClick={handleDeleteAllEvents}
            disabled={bulkDeleting || events.length === 0}
            style={{ padding:'8px 14px', background:'#DC2626', color:'#fff', border:'none', borderRadius:6, cursor: bulkDeleting ? 'not-allowed' : 'pointer' }}
          >
            {bulkDeleting ? 'Deleting…' : 'Delete All Events'}
          </button>}
        </div>

        <div className="events-view-toolbar">
          <span>View</span>
          <div className="events-view-switcher" role="group" aria-label="Event views">
            {[
              { mode: 'list', label: 'List', Icon: MdViewList },
              { mode: 'grid', label: 'Grid', Icon: MdGridView },
              { mode: 'calendar', label: 'Calendar', Icon: MdCalendarMonth },
            ].map(({ mode, label, Icon }) => (
              <button
                key={mode}
                type="button"
                aria-label={`${label} view`}
                aria-pressed={viewMode === mode}
                className={viewMode === mode ? 'active' : ''}
                onClick={() => setViewMode(mode)}
              >
                <Icon aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        {canManageEvents && showAddForm && !editingEvent && (
          <form onSubmit={handleCreateEvent} className="event-create-form">
            <header className="event-create-header">
              <div>
                <p className="event-create-eyebrow">{editingEvent ? 'EDIT EVENT' : 'NEW EVENT'}</p>
                <h2>{editingEvent ? 'Edit event details' : 'Create an event'}</h2>
                <p>Set the schedule, venue, and recurrence.</p>
              </div>
              <MdEventAvailable aria-hidden="true" className="event-create-header-icon" />
            </header>

            <section className="event-create-section" aria-labelledby="event-details-heading">
              <h3 id="event-details-heading"><span>01</span> Event details</h3>
              <div className="event-create-grid event-create-grid-details">
                <label className="event-create-field event-create-field-title">
                  <span>Event name <b>*</b></span>
                  <input
                    type="text"
                    placeholder="e.g. Sunday gathering"
                    value={newEvent.title}
                    onChange={(e)=>setNewEvent(prev=>({...prev, title:e.target.value}))}
                    required
                  />
                </label>
                <label className="event-create-field">
                  <span>Date <b>*</b></span>
                  <input
                    type="date"
                    value={newEvent.startDate}
                    onChange={(e)=>setNewEvent(prev=>({
                      ...prev,
                      startDate: e.target.value,
                      recurrenceDayOfWeek: prev.recurrenceDayOfWeek || getWeekdayFromDateInput(e.target.value),
                    }))}
                    required
                  />
                </label>
                <label className="event-create-field">
                  <span>Starts <b>*</b></span>
                  <input
                    type="time"
                    value={newEvent.startHour}
                    onChange={(e)=>setNewEvent(prev=>({...prev, startHour:e.target.value}))}
                    required
                  />
                </label>
                <label className="event-create-field">
                  <span>Ends <small>Optional</small></span>
                  <input
                    type="time"
                    value={newEvent.endHour}
                    onChange={(e)=>setNewEvent(prev=>({...prev, endHour:e.target.value}))}
                  />
                </label>
              </div>
            </section>

            <section className="event-create-section" aria-labelledby="event-venue-heading">
              <h3 id="event-venue-heading"><span>02</span> Venue</h3>
              <div className="event-create-grid event-create-grid-venue">
                <label className="event-create-field">
                  <span>Campus <small>Optional</small></span>
                  <select
                    aria-label="Event campus"
                    value={newEvent.campusId}
                    onChange={event => setNewEvent(prev => ({ ...prev, campusId: event.target.value, roomId: '' }))}
                  >
                    <option value="">Select a campus</option>
                    {campuses.map(campus => <option key={campus.id} value={campus.id}>{campus.name}</option>)}
                  </select>
                </label>
                <label className="event-create-field">
                  <span>Room <small>Optional</small></span>
                  <select
                    aria-label="Event room"
                    value={newEvent.roomId}
                    onChange={event => setNewEvent(prev => ({ ...prev, roomId: event.target.value }))}
                    disabled={!newEvent.campusId || availableRooms.length === 0}
                  >
                    <option value="">{!newEvent.campusId ? 'Choose a campus first' : availableRooms.length ? 'Select a room' : 'No rooms for this campus'}</option>
                    {availableRooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}
                  </select>
                </label>
                <label className="event-create-field event-create-field-location">
                  <span>Additional location details <small>Optional</small></span>
                  <input
                    type="text"
                    placeholder="Building, entrance, or directions"
                    value={newEvent.location}
                    onChange={(e)=>setNewEvent(prev=>({...prev, location:e.target.value}))}
                  />
                </label>
              </div>
              <fieldset className="event-venue-groups">
                <div className="event-venue-groups-header">
                  <legend>Groups at this venue <small>Optional</small></legend>
                  <div className="event-venue-group-actions">
                    <button
                      type="button"
                      onClick={() => setNewEvent(prev => ({ ...prev, venueGroupIds: groups.map(group => group.id) }))}
                      disabled={groups.length === 0 || selectedGroups.length === groups.length}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewEvent(prev => ({ ...prev, venueGroupIds: [] }))}
                      disabled={selectedGroups.length === 0}
                    >
                      Clear all
                    </button>
                  </div>
                </div>
                {groups.length === 0 ? (
                  <p className="event-venue-groups-empty">No groups found for this organization.</p>
                ) : (
                  <div className="event-venue-group-list">
                    {groups.map(group => (
                      <label key={group.id} className="event-venue-group-option">
                        <input
                          type="checkbox"
                          checked={newEvent.venueGroupIds.includes(group.id)}
                          onChange={event => setNewEvent(prev => ({
                            ...prev,
                            venueGroupIds: event.target.checked
                              ? [...prev.venueGroupIds, group.id]
                              : prev.venueGroupIds.filter(groupId => groupId !== group.id),
                          }))}
                        />
                        <span>{group.groupName || 'Unnamed group'}</span>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
            </section>

            <section className="event-create-section event-create-repeat" aria-labelledby="event-repeat-heading">
              <div className="event-create-repeat-heading">
                <h3 id="event-repeat-heading"><span>03</span> Repeat</h3>
                <label className="event-create-toggle">
                  <input
                    type="checkbox"
                    checked={newEvent.isRecurring}
                    onChange={(e)=>setNewEvent(prev=>({...prev, isRecurring: e.target.checked }))}
                  />
                  <span>Make this a recurring event</span>
                </label>
              </div>
              {newEvent.isRecurring && (
                <div className="event-create-grid event-create-grid-repeat">
                  <label className="event-create-field">
                    <span>Repeat frequency</span>
                    <select
                      value={newEvent.recurrenceType}
                      onChange={(e)=>setNewEvent(prev=>({...prev, recurrenceType:e.target.value}))}
                    >
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </label>
                  {newEvent.recurrenceType === 'weekly' && (
                    <label className="event-create-field">
                      <span>Repeat on</span>
                      <select aria-label="Repeat on weekday" value={newEvent.recurrenceDayOfWeek} onChange={(e) => setNewEvent(prev => ({ ...prev, recurrenceDayOfWeek: e.target.value }))} required>
                        <option value="">Choose a day</option>
                        {WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}
                      </select>
                    </label>
                  )}
                  <label className="event-create-field">
                    <span>Repeat through <b>*</b></span>
                    <input
                      type="date"
                      value={newEvent.recurrenceEndDate}
                      onChange={(e)=>setNewEvent(prev=>({...prev, recurrenceEndDate:e.target.value}))}
                      required
                    />
                  </label>
                </div>
              )}
            </section>

            <footer className="event-create-actions">
              <button type="button" className="event-create-cancel" onClick={()=>setShowAddForm(false)}>
                Cancel
              </button>
              <button type="submit" className="event-create-submit" disabled={creating}>
                <MdAddCircleOutline aria-hidden="true" />
                {creating ? (editingEvent ? 'Saving changes...' : 'Creating event...') : (editingEvent ? 'Save changes' : 'Create event')}
              </button>
            </footer>
          </form>
        )}
      </div>

      {loading ? (
        <div>
          <Skeleton count={8} height={160} />
        </div>
      ) : error ? (
        <div>{error}</div>
      ) : viewMode === 'calendar' ? (
        <section className="event-calendar" aria-label="Event calendar">
          <header className="event-calendar-header">
            <button type="button" aria-label="Previous month" onClick={() => setCalendarMonth(month => new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button>
            <h2 aria-live="polite">{calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h2>
            <button type="button" aria-label="Next month" onClick={() => setCalendarMonth(month => new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button>
          </header>
          <div className="event-calendar-grid" role="grid" aria-label="Events by date">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="event-calendar-weekday" role="columnheader">{day}</div>
            ))}
            {calendarDays.map(day => {
              const dateKey = dateToInputValue(day);
              const dayEvents = calendarEventsByDate.get(dateKey) || [];
              const inCurrentMonth = day.getMonth() === calendarMonth.getMonth();
              return (
                <div key={dateKey} className={`event-calendar-day${inCurrentMonth ? '' : ' outside-month'}`} role="gridcell" aria-label={`${day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}, ${dayEvents.length} events`}>
                  <span className="event-calendar-day-number">{day.getDate()}</span>
                  <div className="event-calendar-day-events">
                    {dayEvents.map(event => (
                      <button
                        key={event.id}
                        type="button"
                        className="event-calendar-item"
                        title={`${formatDisplayTime(event.startHour)} ${event.title || event.instanceTitle || 'Event'}`}
                        onClick={() => selectionMode ? toggleEventSelection(event) : handleViewEvent(id, event.id)}
                      >
                        {event.imageUrl && <EventCardImage
                          key={event.imageUrl}
                          imageUrl={event.imageUrl}
                          title={event.instanceTitle || event.title || 'Event'}
                          backgroundColor="#E8F5F2"
                          firstLetter={(event.instanceTitle || event.title || 'E').charAt(0).toUpperCase()}
                          calendar
                        />}
                        {event.startHour && <time>{formatDisplayTime(event.startHour)}</time>}
                        <span>{event.instanceTitle || event.title || 'Untitled event'}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <div className={`event-card-container${viewMode === 'grid' ? ' event-card-grid' : ''}`}>
          {currentEvents.length > 0 ? (
            <>
              {currentEvents.map((event, index) => {
                const firstLetter = event.title
                  ? event.title.charAt(0).toUpperCase()
                  : "E";
                const backgroundColors = [
                  "#FF5733",
                  "#33A1FF",
                  "#FF33EC",
                  "#33FF57",
                  "#FFC733",
                ];
                const bgColor =
                  backgroundColors[index % backgroundColors.length];
                  
                const isSelected = selectedEvents.some(e => e.id === event.id);
                const imageChanges = getEventImageChanges(event);

                return (
                  <div 
                    key={event.id} 
                    className={`event-card ${isSelected ? 'selected-event' : ''}`}
                    onClick={() => selectionMode ? toggleEventSelection(event) : null}
                    style={selectionMode ? { cursor: 'pointer' } : {}}
                  >
                    {selectionMode && (
                      <div className="event-selection-checkbox" style={{
                        position: 'absolute',
                        top: '10px',
                        right: '10px',
                        zIndex: 5
                      }}>
                        {isSelected ? (
                          <MdCheckBox size={24} color="#4F46E5" />
                        ) : (
                          <MdCheckBoxOutlineBlank size={24} color="#4F46E5" />
                        )}
                      </div>
                    )}
                    
                    <EventCardImage
                      key={event.imageUrl || 'no-image'}
                      imageUrl={event.imageUrl}
                      title={event.title}
                      backgroundColor={bgColor}
                      firstLetter={firstLetter}
                      onUpload={canManageEvents && !selectionMode ? file => handleEventImageUpload(event, file) : undefined}
                    />

                    <div className="event-card-content">
                      {imageChanges.length > 0 && (
                        <div className="event-image-outdated" role="status">
                          <MdWarningAmber aria-hidden="true" />
                          <div><strong>Image needs updating</strong><small>Changed: {imageChanges.join(', ')}</small></div>
                        </div>
                      )}
                      <div className="event-header">
                        <h3 style={commonStyles.subTitle}>
                          {event.instanceTitle || event.title}
                        </h3>
                        {event.isRecurrenceMaster && <span className="event-series-master">Series master</span>}
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <span className={`event-status ${event.status || 'optional'}`}>
                            {event.status || 'optional'}
                          </span>
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: '12px',
                            fontSize: '0.8em',
                            backgroundColor: '#e2e8f0',
                            color: '#4a5568'
                          }}>
                            Order: {event.order || 1}
                          </span>
                        </div>
                      </div>
                      
                      <div>
                        <span>Date:</span>
                        <span>{formatDisplayDate(event.startDate)}</span>
                        {event.endDate && event.endDate !== event.startDate && (
                          <>
                            <span style={{ fontWeight: "bold" }}> - </span>
                            <span>{formatDisplayDate(event.endDate)}</span>{" "}
                          </>
                        )}
                      </div>

                      <div>
                        <span>Time:</span>
                        <span>{formatDisplayTime(event.startHour)}</span>
                        {event.endHour && (
                          <>
                            <span style={{ fontWeight: "bold" }}> - </span>
                            <span>{formatDisplayTime(event.endHour)}</span>
                          </>
                        )}
                      </div>

                      {event.location && (
                        <div>
                          <span>Location:</span>
                          <span>{event.location}</span>
                        </div>
                      )}

                      {event.venueGroups?.length > 0 && (
                        <div>
                          <span>Groups:</span>
                          <span>{event.venueGroups.map(group => group.name).join(', ')}</span>
                        </div>
                      )}

                      {event.recurrenceType && (
                        <div>
                          <span>Frequency:</span>
                          <span>{event.recurrenceType}</span>
                        </div>
                      )}

                      {editingEvent?.id === event.id && (
                        <div className="event-card-inline-editor">
                          <EventEditorForm
                            event={editingEvent}
                            newEvent={newEvent}
                            setNewEvent={setNewEvent}
                            campuses={campuses}
                            groups={groups}
                            availableRooms={availableRooms}
                            creating={creating}
                            onSubmit={handleCreateEvent}
                            onCancel={() => setEditingEvent(null)}
                          />
                        </div>
                      )}

                      {!selectionMode && editingEvent?.id !== event.id && (
                        <div className="event-actions" style={{
                          display: 'flex',
                          gap: '10px',
                          marginTop: '10px',
                          flexWrap: 'wrap'
                        }}>
                          {canManageEvents && (
                            <button
                              type="button"
                              className="event-design-button"
                              onClick={() => navigate(`/organization/${id}/event/${encodeURIComponent(event.id)}/design`)}
                            >
                              <MdAutoAwesome aria-hidden="true" /> Design with AI
                            </button>
                          )}
                          {canManageEvents && (
                            <button
                              type="button"
                              className="event-edit-button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEditEvent(event);
                              }}
                            >
                              <MdEdit aria-hidden="true" /> {event.isRecurrenceMaster ? 'Edit series' : 'Edit event'}
                            </button>
                          )}
                          <div
                            className="view-more-link"
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleViewEvent(id, event.id);
                            }}
                          >
                            <span>View event →</span>
                          </div>
                          <div
                            className="view-more-link"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEventCoordination(id, event.id);
                            }}
                            style={{ color: '#4F46E5' }}
                          >
                            <span>Coordinate →</span>
                          </div>
                          <div
                            className="view-more-link"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/organization/${id}/event/${event.id}/registrations`);
                            }}
                            style={{ color: '#10B981' }}
                          >
                            <span>Manage Registration →</span>
                          </div>
                          {canManageEvents && (
                            <div
                            className="view-more-link"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteEvent(event.id);
                            }}
                            style={{ color: '#DC2626' }}
                          >
                            <span>Delete Event</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          ) : (
            <p>No event found</p>
          )}
        </div>
      )}

      {/* Pagination controls */}
      <div className="pagination-controls" style={{ marginTop: "20px", textAlign: "center" }}>
        <button onClick={goToPreviousPage} disabled={currentPage === 1}>
          Previous
        </button>
        {[...Array(totalPages)].map((_, index) => (
          <button
            key={index}
            onClick={() => paginate(index + 1)}
            className={currentPage === index + 1 ? "active-page" : ""}
          >
            {index + 1}
          </button>
        ))}
        <button onClick={goToNextPage} disabled={currentPage === totalPages}>
          Next
        </button>
      </div>
    </div>
  );
};

// Add these additional styles for selection mode
const additionalStyles = `
.event-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.event-status {
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.8em;
  text-transform: capitalize;
}

.event-status.required {
  background-color: #dc3545;
  color: white;
}

.event-status.optional {
  background-color: #6c757d;
  color: white;
}

.pagination-controls button {
  margin: 0 5px;
  padding: 5px 10px;
  border: none;
  background-color: #007bff;
  color: white;
  cursor: pointer;
  border-radius: 5px;
}

.pagination-controls button:disabled {
  background-color: #6c757d;
  cursor: not-allowed;
}

.pagination-controls .active-page {
  background-color: #0056b3;
}

.selected-event {
  border: 2px solid #4F46E5 !important;
  box-shadow: 0 0 8px rgba(79, 70, 229, 0.4) !important;
}

.event-selection-checkbox {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 5;
}
`;

const styleSheet = document.createElement("style");
styleSheet.innerText = additionalStyles;
document.head.appendChild(styleSheet);

export default AllEvents;
