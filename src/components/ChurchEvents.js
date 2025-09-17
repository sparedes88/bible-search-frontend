import React, { useState, useEffect } from 'react';
import { useParams, Link, Route } from 'react-router-dom';
import { db } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import Skeleton from 'react-loading-skeleton';
import ChurchHeader from './ChurchHeader';

const EventCard = ({ event }) => (
  <div className="event-card" style={{
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    padding: '16px',
    margin: '8px 0',
    border: '1px solid #e5e7eb'
  }}>
    <div style={{ display: 'flex', alignItems: 'start', gap: '16px' }}>
      {event.image && (
        <img 
          src={event.image} 
          alt={event.title}
          style={{ 
            width: '120px',
            height: '120px',
            objectFit: 'cover',
            borderRadius: '4px'
          }}
        />
      )}
      <div style={{ flex: 1 }}>
        <h3 style={{ 
          fontSize: '18px',
          fontWeight: '600',
          color: '#374151',
          marginBottom: '8px'
        }}>{event.title}</h3>
        <div style={{ 
          fontSize: '14px',
          color: '#6B7280',
          marginBottom: '4px'
        }}>
          <span>📅 {new Date(event.date).toLocaleDateString()}</span>
          {event.time && <span style={{ marginLeft: '12px' }}>⏰ {event.time}</span>}
        </div>
        <div style={{ 
          fontSize: '14px',
          color: '#6B7280',
          marginBottom: '8px'
        }}>
          <span>📍 {event.location}</span>
        </div>
        <div style={{ 
          display: 'flex',
          gap: '8px',
          marginBottom: '12px'
        }}>
          <span style={{
            backgroundColor: '#EEF2FF',
            color: '#4F46E5',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '12px'
          }}>{event.category}</span>
          {event.subcategory && (
            <span style={{
              backgroundColor: '#F3F4F6',
              color: '#374151',
              padding: '4px 8px',
              borderRadius: '4px',
              fontSize: '12px'
            }}>{event.subcategory}</span>
          )}
        </div>
        <p style={{ 
          fontSize: '14px',
          color: '#4B5563',
          marginBottom: '16px'
        }}>{event.description}</p>
        <button 
          onClick={() => window.open(event.registrationLink, '_blank')}
          style={{
            backgroundColor: '#4F46E5',
            color: 'white',
            padding: '8px 16px',
            borderRadius: '6px',
            border: 'none',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '500'
          }}
        >
          Registrarse
        </button>
      </div>
    </div>
  </div>
);

const ChurchEvents = () => {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        setLoading(true);
        const eventsRef = collection(db, 'churches', id, 'events');
        const q = query(eventsRef, where('active', '==', true));
        const querySnapshot = await getDocs(q);
        
        const eventsData = [];
        querySnapshot.forEach((doc) => {
          eventsData.push({ id: doc.id, ...doc.data() });
        });
        
        // Sort events by date
        eventsData.sort((a, b) => new Date(a.date) - new Date(b.date));
        setEvents(eventsData);
      } catch (err) {
        console.error('Error fetching events:', err);
        setError('Error loading events');
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
  }, [id]);

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f5f5f5',
      padding: '20px'
    }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between',
        marginBottom: '20px'
      }}>
        <Link 
          to={`/church/${id}/mi-perfil`}
          style={{
            padding: '8px 16px',
            borderRadius: '4px',
            border: '1px solid #e5e7eb',
            backgroundColor: 'white',
            textDecoration: 'none',
            color: '#374151'
          }}
        >
          ⬅ Volver
        </Link>
        <Link to={`/church/${id}/events`}>Eventos</Link>
      </div>

      <ChurchHeader id={id} applyShadow={false}/>
      
      <h2 style={{
        fontSize: '24px',
        fontWeight: '600',
        color: '#111827',
        marginBottom: '20px',
        textAlign: 'center'
      }}>Eventos Disponibles</h2>

      {loading ? (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          <Skeleton height={160} count={3} style={{ marginBottom: '16px' }}/>
        </div>
      ) : error ? (
        <div style={{ 
          textAlign: 'center',
          color: '#DC2626',
          padding: '20px'
        }}>{error}</div>
      ) : events.length === 0 ? (
        <div style={{ 
          textAlign: 'center',
          color: '#6B7280',
          padding: '40px'
        }}>No hay eventos disponibles</div>
      ) : (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          {events.map(event => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
};

export default ChurchEvents;

<Route path="/church/:id/events" element={<ChurchEvents />} />