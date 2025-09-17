import React, { useState } from 'react';
import { Event } from '../types/Event';
import { TextField, Select, MenuItem, FormControl, InputLabel } from '@mui/material';

interface EventInstanceProps {
  event: Event;
  onUpdate: (updatedEvent: Event) => void;
}

export const EventInstance: React.FC<EventInstanceProps> = ({ event, onUpdate }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedEvent, setEditedEvent] = useState<Event>(event);

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleSave = () => {
    onUpdate(editedEvent);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="event-instance">
        <TextField
          label="Title"
          value={editedEvent.title}
          onChange={(e) => setEditedEvent({ ...editedEvent, title: e.target.value })}
        />
        <TextField
          type="datetime-local"
          value={editedEvent.dateTime}
          onChange={(e) => setEditedEvent({ ...editedEvent, dateTime: e.target.value })}
        />
        <FormControl>
          <InputLabel>Status</InputLabel>
          <Select
            value={editedEvent.status}
            onChange={(e) => setEditedEvent({ ...editedEvent, status: e.target.value as 'required' | 'optional' })}
          >
            <MenuItem value="required">Required</MenuItem>
            <MenuItem value="optional">Optional</MenuItem>
          </Select>
        </FormControl>
        <button onClick={handleSave}>Save</button>
        <button onClick={() => setIsEditing(false)}>Cancel</button>
      </div>
    );
  }

  return (
    <div className="event-instance">
      <h3>{event.title}</h3>
      <p>Date/Time: {new Date(event.dateTime).toLocaleString()}</p>
      <p>Status: {event.status}</p>
      <button onClick={handleEdit}>Edit</button>
    </div>
  );
};
