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
} from "firebase/firestore";
import Skeleton from "react-loading-skeleton";
import ChurchHeader from "./ChurchHeader";
import commonStyles from "../pages/commonStyles";
import "./AllEvents.css";
import { IoMdSearch } from "react-icons/io";
import { MdCheckBox, MdCheckBoxOutlineBlank } from "react-icons/md";

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
    navigate(`/church/${id}`, { 
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
      navigate(`/church/${id}`);
    } else {
      // Default back behavior
      navigate(`/church/${id}/course-admin`);
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
    navigate(`/church/${id}/event/${eventId}`);
  };

  const handleEventCoordination = (id, eventId) => {
    navigate(`/church/${id}/event/${eventId}/coordination`);
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
                              navigate(`/church/${id}/event/${event.id}/registrations`);
                            }}
                            style={{ color: '#10B981' }}
                          >
                            <span>Manage Registration →</span>
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
