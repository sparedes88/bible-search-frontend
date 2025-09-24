import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { searchChurchById } from "../api";
import commonStyles from "./commonStyles";

const EventsPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [church, setChurch] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(7); // Load first 7 events

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const churchData = await searchChurchById(id);
        setChurch(churchData);

        // Fetch events using the correct API
        const response = await fetch(
          `https://iglesia-tech-api.e2api.com/api/iglesiaTechApp/groups/getEventsByView?idIglesia=${id}`
        );
        const data = await response.json();

        console.log("Fetched Events Data:", data); // ✅ Debugging API Response

        if (data && typeof data.events === "object") {
          // Merge all event types into a single array
          const allEvents = [
            ...(data.events.standalone || []),
            ...(data.events.periodic || []),
            ...(data.events.custom || [])
          ];

          // Filter to show only events happening in the next 7 days and have publish_status "publish"
          const upcomingEvents = allEvents.filter(event => {
            if (!event.start_date || !event.publish_status) return false;

            const eventDate = new Date(event.start_date);
            const today = new Date();
            const sevenDaysLater = new Date();
            sevenDaysLater.setDate(today.getDate() + 7);

            return eventDate >= today && eventDate <= sevenDaysLater && event.publish_status === "publish";
          });

          setEvents(upcomingEvents);
        } else {
          setEvents([]);
        }
      } catch (error) {
        console.error("❌ Error fetching events:", error);
        setEvents([]);
      }
      setLoading(false);
    };

    fetchData();
  }, [id]);

  const loadMoreEvents = () => {
    setLimit(prevLimit => prevLimit + 7);
  };

  return (
    <div style={commonStyles.container}>
      {/* Banner */}
      <div style={commonStyles.banner}>
        {loading ? <Skeleton height={300} /> : church?.portadaArticulos ? (
          <img src={`https://iglesia-tech-api.e2api.com${church.portadaArticulos}`} alt="Church Banner" style={commonStyles.bannerImage} />
        ) : <Skeleton height={300} />}
      </div>

      {/* Logo */}
      <div style={commonStyles.logoContainer}>
        {loading ? <Skeleton circle height={90} width={90} /> : church?.Logo ? (
          <img src={`https://iglesia-tech-api.e2api.com${church.Logo}`} alt="Church Logo" style={commonStyles.logo} />
        ) : <Skeleton circle height={90} width={90} />}
      </div>

      {/* Back Button */}
      <button onClick={() => navigate(-1)} style={commonStyles.backButton}>⬅ Volver</button>

      <h2 style={commonStyles.title}>📅 Church Events</h2>

      {/* Events List */}
      <div style={commonStyles.sectionContainer}>
        {loading ? (
          <Skeleton count={4} />
        ) : events.length > 0 ? (
          <>
            <div style={styles.grid}>
              {events.slice(0, limit).map(event => (
                <div key={event.idGroupEvent} style={styles.eventCard}>
                  {/* Event Image */}
                  {event.picture ? (
                    <img src={`https://iglesia-tech-api.e2api.com${event.picture}`} alt={event.name} style={styles.eventImage} />
                  ) : (
                    <Skeleton height={150} />
                  )}

                  {/* Event Title */}
                  <h3>{event.name}</h3>

                  {/* Event Description */}
                  <p>{event.description || "Sin descripción disponible"}</p>

                  {/* Start & End Date */}
                  <p style={styles.eventDate}>
                    📅 {event.start_date ? new Date(event.start_date).toLocaleDateString() : "N/A"} - 
                    {event.end_date ? new Date(event.end_date).toLocaleDateString() : "N/A"}
                  </p>

                  {/* Register Button */}
                  {event.link && (
                    <a href={event.link} target="_blank" rel="noopener noreferrer" style={styles.registerButton}>
                      Regístrate
                    </a>
                  )}
                </div>
              ))}
            </div>

            {/* Load More Button */}
            {events.length > limit && (
              <button onClick={loadMoreEvents} style={styles.loadMoreButton}>
                Cargar más eventos
              </button>
            )}
          </>
        ) : (
          <p>No hay eventos disponibles.</p>
        )}
      </div>
    </div>
  );
};

// ✅ Ensuring styles object exists
const styles = {
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
    gap: "15px",
    marginTop: "10px",
  },
  eventCard: {
    padding: "15px",
    borderRadius: "8px",
    backgroundColor: "#fff",
    textAlign: "center",
    boxShadow: "0px 4px 6px rgba(0,0,0,0.1)",
  },
  eventImage: {
    width: "100%",
    height: "150px",
    objectFit: "cover",
    borderRadius: "8px",
  },
  eventDate: {
    fontSize: "14px",
    color: "#555",
    marginTop: "8px",
  },
  registerButton: {
    display: "inline-block",
    marginTop: "10px",
    padding: "10px 15px",
    borderRadius: "6px",
    backgroundColor: "#007bff",
    color: "#fff",
    fontSize: "16px",
    cursor: "pointer",
    textDecoration: "none",
    border: "none",
  },
  loadMoreButton: {
    marginTop: "15px",
    padding: "10px 15px",
    borderRadius: "6px",
    backgroundColor: "#007bff",
    color: "#fff",
    fontSize: "16px",
    cursor: "pointer",
    border: "none",
  },
};

export default EventsPage;