import React, { useState, useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { db } from "../firebase";
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
} from "firebase/firestore";
import Skeleton from "react-loading-skeleton";
import ChurchHeader from "./ChurchHeader";
import commonStyles from "../pages/commonStyles";
import "./AllEvents.css";
import { IoMdSearch } from "react-icons/io";
import { MdCheckBox, MdCheckBoxOutlineBlank } from "react-icons/md";
import { toast } from 'react-toastify';

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
        month: "long",
        day: "numeric",
        year: "numeric"
      });
    }
    
    // If the date is in a different format, try a more direct approach
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.toLocaleDateString("en-US", {
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

const AllEvents = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [startDateFilter, setStartDateFilter] = useState("");
  const [endDateFilter, setEndDateFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [eventsPerPage] = useState(10);
  const [selectedEvents, setSelectedEvents] = useState([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [newEvent, setNewEvent] = useState({
    title: '',
    startDate: '', // YYYY-MM-DD from input
    startHour: '', // HH:MM
    endHour: '',   // HH:MM
    location: '',
    isRecurring: false,
    recurrenceType: 'weekly', // daily | weekly | monthly
    recurrenceEndDate: '' // YYYY-MM-DD
  });
  
  // Check if we're coming from card edit/creation
  const isFromCardEdit = location.state?.fromCardEdit || false;
  const preselectedEventIds = location.state?.selectedEventIds || [];

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
      navigate(`/organization/${id}/course-admin`);
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

        // Sort events by date
        eventsData.sort((a, b) => {
          // Convert MM-DD-YYYY to YYYY-MM-DD for proper date comparison
          const aDate = a.startDate.split("-").reverse().join("-");
          const bDate = b.startDate.split("-").reverse().join("-");
          return aDate.localeCompare(bDate);
        });

        setEvents(eventsData);
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
    if (!newEvent.title || !newEvent.startDate || !newEvent.startHour) {
      toast.error('Title, date and start time are required');
      return;
    }
    if (newEvent.isRecurring && !newEvent.recurrenceEndDate) {
      toast.error('Please select an end date for the recurring series');
      return;
    }
    setCreating(true);
    try {
      // Helper to format dates to MM-DD-YYYY
      const toMMDDYYYY = (dateObj) => dateObj
        .toLocaleDateString('en-US', { year:'numeric', month:'2-digit', day:'2-digit' })
        .replace(/(\d+)\/(\d+)\/(\d+)/, '$1-$2-$3');

      const start = new Date(newEvent.startDate + 'T00:00:00');
      if (!newEvent.isRecurring) {
        const payload = {
          title: newEvent.title,
          instanceTitle: newEvent.title,
          startDate: toMMDDYYYY(start),
          startHour: newEvent.startHour,
          endHour: newEvent.endHour || '',
          location: newEvent.location || '',
          churchId: id,
          status: 'optional',
          createdAt: serverTimestamp(),
          isRecurring: false
        };
        const ref = await addDoc(collection(db, 'eventInstances'), payload);
        setEvents(prev => [{ id: ref.id, ...payload }, ...prev]);
        toast.success('Event created');
      } else {
        // Build a list of dates from start until recurrenceEndDate inclusive
        const end = new Date(newEvent.recurrenceEndDate + 'T00:00:00');
        const dates = [];
        let cursor = new Date(start);
        const maxCount = 366; // safety cap

        const pushIfInRange = () => {
          if (cursor <= end) dates.push(new Date(cursor));
        };

        let count = 0;
        while (cursor <= end && count < maxCount) {
          pushIfInRange();
          count++;
          if (newEvent.recurrenceType === 'daily') {
            cursor.setDate(cursor.getDate() + 1);
          } else if (newEvent.recurrenceType === 'weekly') {
            cursor.setDate(cursor.getDate() + 7);
          } else if (newEvent.recurrenceType === 'monthly') {
            const day = cursor.getDate();
            const nextMonth = new Date(cursor);
            nextMonth.setMonth(nextMonth.getMonth() + 1);
            // If next month has fewer days, clamp to last day
            const lastDay = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate();
            nextMonth.setDate(Math.min(day, lastDay));
            cursor = nextMonth;
          } else {
            // default weekly
            cursor.setDate(cursor.getDate() + 7);
          }
        }

        // Create all instances in a batch
        const payloads = dates.map(d => ({
          title: newEvent.title,
          instanceTitle: newEvent.title,
          startDate: toMMDDYYYY(d),
          startHour: newEvent.startHour,
          endHour: newEvent.endHour || '',
          location: newEvent.location || '',
          churchId: id,
          status: 'optional',
          createdAt: serverTimestamp(),
          isRecurring: true,
          recurrenceType: newEvent.recurrenceType,
          recurrenceEndDate: toMMDDYYYY(end)
        }));

        // Using sequential adds to preserve createdAt serverTimestamp accuracy
        const created = [];
        for (const p of payloads) {
          const ref = await addDoc(collection(db, 'eventInstances'), p);
          created.push({ id: ref.id, ...p });
        }
        // Prepend newly created to state
        setEvents(prev => [...created, ...prev]);
        toast.success(`Created ${created.length} recurring events`);
      }

      setShowAddForm(false);
      setNewEvent({ title:'', startDate:'', startHour:'', endHour:'', location:'', isRecurring:false, recurrenceType:'weekly', recurrenceEndDate:'' });
    } catch (err) {
      console.error('Create event failed:', err);
      toast.error('Failed to create event');
    } finally {
      setCreating(false);
    }
  };

  const filteredEvents = events.filter((event) => {
    if (event.removed || event.isDeleted) return false;

    const matchesSearch = event.title
      .toLowerCase()
      .includes(searchTerm.toLowerCase());

    if (!startDateFilter && !endDateFilter) {
      return matchesSearch;
    }

    // Convert dates to comparable format
    const convertToDate = (dateStr) => {
      if (!dateStr) return null;
      const [month, day, year] = dateStr.split("-");
      return new Date(`${year}-${month}-${day}`).getTime();
    };

    // Convert filter dates to MM-DD-YYYY format
    const formatDate = (dateStr) => {
      if (!dateStr) return null;
      return new Date(dateStr)
        .toLocaleDateString("en-US", {
          month: "2-digit",
          day: "2-digit",
          year: "numeric",
        })
        .replace(/(\d+)\/(\d+)\/(\d+)/, "$1-$2-$3");
    };

    const formattedStartFilter = formatDate(startDateFilter);
    const formattedEndFilter = formatDate(endDateFilter);

    const eventStartTime = convertToDate(event.startDate);
    const eventEndTime = event.endDate
      ? convertToDate(event.endDate)
      : eventStartTime;
    const filterStartTime = formattedStartFilter
      ? convertToDate(formattedStartFilter)
      : null;
    const filterEndTime = formattedEndFilter
      ? convertToDate(formattedEndFilter)
      : null;

    // Check if event falls within the selected date range
    const isWithinRange =
      (!filterStartTime || eventEndTime >= filterStartTime) &&
      (!filterEndTime || eventStartTime <= filterEndTime);

    return matchesSearch && isWithinRange;
  });

  // Pagination logic
  const indexOfLastEvent = currentPage * eventsPerPage;
  const indexOfFirstEvent = indexOfLastEvent - eventsPerPage;
  const currentEvents = filteredEvents.slice(indexOfFirstEvent, indexOfLastEvent);
  const totalPages = Math.ceil(filteredEvents.length / eventsPerPage);

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
    <div style={commonStyles.container}>
      <button
        onClick={handleBackClick}
        style={{ ...commonStyles.backButtonLink }}
      >
        ← Back to {isFromCardEdit ? "Card Editor" : "Course Admin"}
      </button>

      <ChurchHeader id={id} />

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
                onChange={(e) => setStartDateFilter(e.target.value)}
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
                onChange={(e) => setEndDateFilter(e.target.value)}
                className="search-event"
                placeholder="End date"
              />
            </div>
          </div>
          <IoMdSearch size={20} className="search-icon-event" />
        </div>

        {/* Actions row */}
        <div style={{ display:'flex', gap:12, marginTop:12, flexWrap:'wrap' }}>
          <button
            onClick={() => setShowAddForm(s => !s)}
            style={{ padding:'8px 14px', background:'#4F46E5', color:'#fff', border:'none', borderRadius:6, cursor:'pointer' }}
          >
            {showAddForm ? 'Close' : 'Add New Event'}
          </button>
          <button
            onClick={handleDeleteAllEvents}
            disabled={bulkDeleting || events.length === 0}
            style={{ padding:'8px 14px', background:'#DC2626', color:'#fff', border:'none', borderRadius:6, cursor: bulkDeleting ? 'not-allowed' : 'pointer' }}
          >
            {bulkDeleting ? 'Deleting…' : 'Delete All Events'}
          </button>
        </div>

        {showAddForm && (
          <form onSubmit={handleCreateEvent} style={{ marginTop:12, padding:12, border:'1px solid #e5e7eb', borderRadius:8, background:'#f8fafc', maxWidth:720 }}>
            <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr', gap:12 }}>
              <input
                placeholder="Title"
                value={newEvent.title}
                onChange={(e)=>setNewEvent(prev=>({...prev, title:e.target.value}))}
              />
              <input
                type="date"
                value={newEvent.startDate}
                onChange={(e)=>setNewEvent(prev=>({...prev, startDate:e.target.value}))}
              />
              <input
                type="time"
                value={newEvent.startHour}
                onChange={(e)=>setNewEvent(prev=>({...prev, startHour:e.target.value}))}
              />
              <input
                type="time"
                value={newEvent.endHour}
                onChange={(e)=>setNewEvent(prev=>({...prev, endHour:e.target.value}))}
              />
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:12, marginTop:12 }}>
              <input
                placeholder="Location (optional)"
                value={newEvent.location}
                onChange={(e)=>setNewEvent(prev=>({...prev, location:e.target.value}))}
              />
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, alignItems:'center' }}>
                <label style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <input
                    type="checkbox"
                    checked={newEvent.isRecurring}
                    onChange={(e)=>setNewEvent(prev=>({...prev, isRecurring: e.target.checked }))}
                  />
                  Recurring event
                </label>
                {newEvent.isRecurring && (
                  <select
                    value={newEvent.recurrenceType}
                    onChange={(e)=>setNewEvent(prev=>({...prev, recurrenceType:e.target.value}))}
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                )}
                {newEvent.isRecurring && (
                  <input
                    type="date"
                    value={newEvent.recurrenceEndDate}
                    onChange={(e)=>setNewEvent(prev=>({...prev, recurrenceEndDate:e.target.value}))}
                    placeholder="End date"
                  />
                )}
              </div>
            </div>
            <div style={{ marginTop:12, display:'flex', gap:12 }}>
              <button type="submit" disabled={creating} style={{ padding:'8px 14px', background:'#10B981', color:'#fff', border:'none', borderRadius:6 }}>
                {creating ? 'Creating…' : 'Create Event'}
              </button>
              <button type="button" onClick={()=>setShowAddForm(false)} style={{ ...commonStyles.backButtonLink }}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {loading ? (
        <div>
          <Skeleton count={8} height={160} />
        </div>
      ) : error ? (
        <div>{error}</div>
      ) : (
        <div className="event-card-container">
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
                    
                    <div
                      className="event-img"
                      style={{ background: event.imageUrl ? "none" : bgColor }}
                    >
                      {event.imageUrl ? (
                        <img 
                          src={event.imageUrl.startsWith('http') 
                            ? event.imageUrl 
                            : event.imageUrl.includes('firebase') 
                              ? `https://firebasestorage.googleapis.com/v0/b/mychurch-a8aae.appspot.com/o/${encodeURIComponent(event.imageUrl.replace(/^\//, ''))}?alt=media` 
                              : `https://firebasestorage.googleapis.com/v0/b/mychurch-a8aae.appspot.com/o/${encodeURIComponent(event.imageUrl)}?alt=media`
                          } 
                          alt={event.title || 'Event'} 
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          onError={(e) => {
                            console.error("Image failed to load:", event.imageUrl);
                            e.target.style.display = 'none';
                            e.target.parentElement.style.background = bgColor;
                            e.target.parentElement.innerHTML = `<span>${firstLetter}</span>`;
                          }}
                        />
                      ) : (
                        <span>{firstLetter}</span>
                      )}
                    </div>

                    <div className="event-card-content">
                      <div className="event-header">
                        <h3 style={commonStyles.subTitle}>
                          {event.instanceTitle || event.title}
                        </h3>
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
                        <span>{event.startHour}</span>
                        {event.endHour && (
                          <>
                            <span style={{ fontWeight: "bold" }}> - </span>
                            <span>{event.endHour}</span>
                          </>
                        )}
                      </div>

                      {event.location && (
                        <div>
                          <span>Location:</span>
                          <span>{event.location}</span>
                        </div>
                      )}

                      {event.recurrenceType && (
                        <div>
                          <span>Frequency:</span>
                          <span>{event.recurrenceType}</span>
                        </div>
                      )}

                      {!selectionMode && (
                        <div className="event-actions" style={{
                          display: 'flex',
                          gap: '10px',
                          marginTop: '10px',
                          flexWrap: 'wrap'
                        }}>
                          <div
                            className="view-more-link"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleViewEvent(id, event.id);
                            }}
                          >
                            <span>Ver más →</span>
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
