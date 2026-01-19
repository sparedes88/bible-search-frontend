import React, { useEffect, useState } from "react";
import { getChurchEvents } from "../api";

const Events = ({ churchID }) => {
  const [events, setEvents] = useState([]);
  const [visibleEvents, setVisibleEvents] = useState(7);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchEvents = async () => {
      if (churchID) {
        const eventsData = await getChurchEvents(churchID);
        setEvents(eventsData);
        setLoading(false);
      }
    };
    fetchEvents();
  }, [churchID]);

  const loadMore = () => {
    setVisibleEvents((prev) => prev + 7);
  };

  return (
    <div>
      <h2>📅 Upcoming Events</h2>
      {loading ? <p>Loading...</p> : (
        <div style={styles.grid}>
          {events.length > 0 ? events.slice(0, visibleEvents).map((event) => (
            <div key={event.idGroupEvent} style={styles.eventCard}>
              <img src={`https://iglesia-tech-api.e2api.com${event.picture}`} alt={event.name} style={styles.eventImage} />
              <h3>{event.name}</h3>
              <p>{event.description}</p>
              <p><strong>Start:</strong> {new Date(event.start_date).toLocaleString()}</p>
              <p><strong>End:</strong> {event.end_date ? new Date(event.end_date).toLocaleString() : "N/A"}</p>
              <p><strong>Ticket Cost:</strong> {event.ticket_cost ? `$${event.ticket_cost}` : "Free"}</p>
              <p><strong>Status:</strong> {event.publish_status}</p>
              <p><strong>Timezone:</strong> {event.timezone}</p>
            </div>
          )) : <p>No events available.</p>}
        </div>
      )}

      {visibleEvents < events.length && (
        <button onClick={loadMore} style={styles.loadMoreButton}>Load More</button>
      )}
    </div>
  );
};

const styles = {
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
    gap: "20px",
    marginTop: "10px"
  },
  eventCard: {
    padding: "20px",
    borderRadius: "8px",
    backgroundColor: "#f8f9fa",
    textAlign: "center",
    boxShadow: "0px 4px 6px rgba(0,0,0,0.1)",
    height: "125%" // ✅ Increased card height by 25%
  },
  eventImage: {
    width: "100%",
    height: "180px",
    objectFit: "cover",
    borderRadius: "8px"
  },
  loadMoreButton: {
    marginTop: "15px",
    padding: "10px 15px",
    fontSize: "16px",
    cursor: "pointer",
    backgroundColor: "#007bff",
    color: "white",
    border: "none",
    borderRadius: "8px",
    display: "block",
    marginLeft: "auto",
    marginRight: "auto"
  }
};

export default Events;
