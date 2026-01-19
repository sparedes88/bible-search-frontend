import React, { useState, useEffect } from 'react';
import EventInstance from './EventInstance';

interface Event {
  id: number;
  name: string;
  date: string;
  location: string;
}

const EventManagement: React.FC = () => {
  const [events, setEvents] = useState<Event[]>([]);

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const response = await fetch('/api/events');
        const data = await response.json();
        setEvents(data);
      } catch (error) {
        console.error('Error fetching events:', error);
      }
    };

    fetchEvents();
  }, []);

  const handleEventUpdate = async (updatedEvent: Event) => {
    try {
      const response = await fetch(`/api/events/${updatedEvent.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updatedEvent),
      });

      if (response.ok) {
        // Update the events list
        setEvents(events.map(event => 
          event.id === updatedEvent.id ? updatedEvent : event
        ));
      }
    } catch (error) {
      console.error('Error updating event:', error);
    }
  };

  return (
    <div className="event-management">
      {events.map(event => (
        <EventInstance 
          key={event.id} 
          event={event} 
          onUpdate={handleEventUpdate}
        />
      ))}
    </div>
  );
};

export default EventManagement;