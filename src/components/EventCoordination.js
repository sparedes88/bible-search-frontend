import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import {
  collection,
  doc,
  getDoc,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  updateDoc,
  deleteDoc
} from 'firebase/firestore';
import ChurchHeader from './ChurchHeader';
import { toast } from 'react-toastify';
import { FaArrowUp, FaArrowDown, FaEdit, FaTrash, FaPlus, FaPen, FaStickyNote, FaPrint } from 'react-icons/fa';
import EventCoordinationPDF from './EventCoordinationPDF';
import './EventCoordination.css';

// Add this helper function at the top of your component
const convertDurationToMinutes = (duration, unit) => {
  const value = parseInt(duration);
  if (isNaN(value)) return 0;
  return unit === 'hours' ? value * 60 : value;
};

const EventCoordination = () => {
  const { id, eventId } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [newTask, setNewTask] = useState({
    description: '',
    minutes: '',
    responsible: '',
    tags: [] // Add tags to task
  });
  const [editingTask, setEditingTask] = useState(null);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showNotes, setShowNotes] = useState({});
  const [newNote, setNewNote] = useState({
    content: '',
    assignedTo: '',
    status: 'pending', // possible values: pending, in-progress, completed
    tags: [] // Add tags to note
  });
  const [editingNote, setEditingNote] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // Add state for general notes
  const [generalNotes, setGeneralNotes] = useState([]);
  const [newGeneralNote, setNewGeneralNote] = useState({
    content: '',
    assignedTo: '',
    status: 'pending',
    tags: []
  });
  const [editingGeneralNote, setEditingGeneralNote] = useState(null);

  // Add this state for the PDF modal
  const [showPdfModal, setShowPdfModal] = useState(false);

  // Add this function to handle tags
  const handleTagChange = (tags, type, id = null) => {
    const tagsArray = tags.split(',').map(tag => tag.trim()).filter(Boolean);
    
    if (type === 'task') {
      if (id) {
        // Editing existing task
        const updatedTasks = tasks.map(task => 
          task.id === id ? { ...task, tags: tagsArray } : task
        );
        setTasks(updatedTasks);
      } else {
        // New task
        setNewTask(prev => ({ ...prev, tags: tagsArray }));
      }
    } else if (type === 'note') {
      if (id) {
        // Editing existing note
        setEditingNote(prev => ({ ...prev, tags: tagsArray }));
      } else {
        // New note
        setNewNote(prev => ({ ...prev, tags: tagsArray }));
      }
    } else if (type === 'general-note') {
      if (id) {
        // Editing existing general note
        setEditingGeneralNote(prev => ({ ...prev, tags: tagsArray }));
      } else {
        // New general note
        setNewGeneralNote(prev => ({ ...prev, tags: tagsArray }));
      }
    }
  };

  useEffect(() => {
    const fetchEventAndTasks = async () => {
      setIsLoading(true);
      try {
        // Try to fetch from eventInstances first
        const eventInstanceDoc = await getDoc(doc(db, 'eventInstances', eventId));
        let eventData;
        
        if (eventInstanceDoc.exists()) {
          eventData = eventInstanceDoc.data();
        } else {
          // If not found in eventInstances, try events collection
          const eventDoc = await getDoc(doc(db, 'events', eventId));
          if (!eventDoc.exists()) {
            toast.error('Event not found');
            return;
          }
          eventData = eventDoc.data();
        }

        if (!eventData.startHour) {
          toast.error('Event is missing start time');
          return;
        }
        
        setEvent({ id: eventId, ...eventData });

        const tasksQuery = query(
          collection(db, 'eventTasks'),
          where('eventId', '==', eventId),
          orderBy('startTime')
        );
        const tasksDocs = await getDocs(tasksQuery);
        
        // Fetch notes for each task
        const tasksWithNotes = await Promise.all(tasksDocs.docs.map(async taskDoc => {
          const taskData = { id: taskDoc.id, ...taskDoc.data() };
          
          // Fetch notes for this task
          const notesQuery = query(
            collection(db, 'taskNotes'),
            where('taskId', '==', taskDoc.id),
            orderBy('createdAt')
          );
          const notesDocs = await getDocs(notesQuery);
          const notes = notesDocs.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          
          return {
            ...taskData,
            notes
          };
        }));
        
        setTasks(tasksWithNotes);
      } catch (error) {
        console.error('Error fetching event:', error);
        toast.error('Error loading event data');
      } finally {
        setIsLoading(false);
      }
    };

    fetchEventAndTasks();
  }, [eventId]);

  useEffect(() => {
    const fetchGeneralNotes = async () => {
      try {
        const notesRef = collection(db, 'churches', id, 'events', eventId, 'notes');
        const notesQuery = query(notesRef, orderBy('createdAt', 'desc'));
        const notesDocs = await getDocs(notesQuery);
        const notes = notesDocs.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setGeneralNotes(notes);
      } catch (error) {
        console.error('Error fetching general notes:', error);
        toast.error('Failed to load general notes');
      }
    };

    if (eventId && id) {
      fetchGeneralNotes();
    }
  }, [eventId, id]);

  useEffect(() => {
    if (event) {
      console.log('Event data:', event);
      console.log('Start hour:', event.startHour);
    }
  }, [event]);

  useEffect(() => {
    if (tasks.length > 0) {
      // Keep notes expanded for tasks that have notes
      const initialShowNotes = tasks.reduce((acc, task) => ({
        ...acc,
        [task.id]: task.notes?.length > 0 || showNotes[task.id] || false
      }), {});
      setShowNotes(initialShowNotes);
    }
  }, [tasks]);

  const calculateTaskStartTime = (previousTasks, eventStartTime) => {
    if (previousTasks.length === 0) return eventStartTime;
    
    const lastTask = previousTasks[previousTasks.length - 1];
    
    const convertTo24Hour = (timeStr) => {
      const [time, period] = timeStr.split(' ');
      let [hours, minutes] = time.split(':').map(Number);
      
      if (period === 'PM' && hours !== 12) {
        hours += 12;
      } else if (period === 'AM' && hours === 12) {
        hours = 0;
      }
      
      return { hours, minutes };
    };

    const convertToAMPM = (hours, minutes) => {
      let period = 'AM';
      if (hours >= 12) {
        period = 'PM';
        if (hours > 12) hours -= 12;
      } else if (hours === 0) {
        hours = 12;
      }
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${period}`;
    };

    const lastTime = convertTo24Hour(lastTask.startTime);
    const duration = parseInt(lastTask.duration) || 0;

    if (isNaN(lastTime.hours) || isNaN(lastTime.minutes) || isNaN(duration)) {
      console.error('Invalid time or duration:', { lastTime, duration });
      return eventStartTime;
    }

    const totalMinutes = lastTime.hours * 60 + lastTime.minutes + duration;
    const newHours = Math.floor(totalMinutes / 60);
    const newMinutes = totalMinutes % 60;

    return convertToAMPM(newHours, newMinutes);
  };

  const handleAddTask = async (e) => {
    e.preventDefault();
    
    try {
      const durationInMinutes = parseInt(newTask.minutes) || 0;
      
      if (durationInMinutes <= 0) {
        toast.error('Please enter a valid duration');
        return;
      }

      const taskData = {
        description: newTask.description,
        duration: durationInMinutes,
        responsible: newTask.responsible,
        tags: newTask.tags,
        startTime: tasks.length === 0 ? event.startHour : calculateTaskStartTime(tasks, event.startHour),
        eventId,
        createdAt: new Date().toISOString(),
        originalDuration: {
          minutes: newTask.minutes || '0'
        }
      };

      const taskRef = await addDoc(collection(db, 'eventTasks'), taskData);
      const newTaskWithId = { id: taskRef.id, ...taskData };
      
      setTasks([...tasks, newTaskWithId]);
      setNewTask({
        description: '',
        minutes: '',
        responsible: '',
        tags: []
      });
      setShowAddForm(false);

      toast.success('Task added successfully');
    } catch (error) {
      console.error('Error adding task:', error);
      toast.error('Error adding task');
    }
  };

  const handleMoveTask = async (taskId, direction) => {
    const taskIndex = tasks.findIndex(t => t.id === taskId);
    
    if ((direction === 'up' && taskIndex === 0) || 
        (direction === 'down' && taskIndex === tasks.length - 1)) {
      return;
    }

    const newIndex = direction === 'up' ? taskIndex - 1 : taskIndex + 1;
    const newTasks = [...tasks];
    const task = newTasks[taskIndex];
    newTasks.splice(taskIndex, 1);
    newTasks.splice(newIndex, 0, task);

    if (!event?.startHour) {
      toast.error('Event start time not available');
      return;
    }

    const updatedTasks = newTasks.map((task, index) => {
      if (index === 0) {
        return { ...task, startTime: event.startHour };
      }
      
      const previousTask = newTasks[index - 1];
      const startTime = calculateTaskStartTime([previousTask], previousTask.startTime);
      return { ...task, startTime };
    });

    try {
      await Promise.all(updatedTasks.map(task => 
        updateDoc(doc(db, 'eventTasks', task.id), { startTime: task.startTime })
      ));
      setTasks(updatedTasks);
      toast.success('Task order updated');
    } catch (error) {
      console.error('Error updating task order:', error);
      toast.error('Failed to update task order');
    }
  };

  const handleEditTask = (task) => {
    const minutes = task.originalDuration?.minutes || '0';
    setEditingTask(task);
    setEditingTaskId(task.id);
    setNewTask({
      description: task.description,
      minutes: minutes,
      responsible: task.responsible,
      tags: task.tags || []
    });
  };

  const handleUpdateTask = async (e) => {
    e.preventDefault();
    try {
      const durationInMinutes = parseInt(newTask.minutes) || 0;
      
      if (durationInMinutes <= 0) {
        toast.error('Please enter a valid duration');
        return;
      }

      const taskRef = doc(db, 'eventTasks', editingTask.id);
      const updatedTask = {
        description: newTask.description,
        duration: durationInMinutes,
        responsible: newTask.responsible,
        tags: newTask.tags,
        originalDuration: {
          minutes: newTask.minutes || '0'
        }
      };

      // Find the index of the edited task
      const taskIndex = tasks.findIndex(t => t.id === editingTask.id);
      
      // Create new array with the updated task
      const updatedTasks = [...tasks];
      updatedTasks[taskIndex] = { ...updatedTasks[taskIndex], ...updatedTask };

      // Recalculate times for all tasks after the edited task
      for (let i = taskIndex; i < updatedTasks.length; i++) {
        if (i === 0) {
          updatedTasks[i].startTime = event.startHour;
        } else {
          const previousTask = updatedTasks[i - 1];
          updatedTasks[i].startTime = calculateTaskStartTime([previousTask], previousTask.startTime);
        }
      }

      // Update all affected tasks in Firestore
      await Promise.all(updatedTasks.map((task, index) => {
        if (index >= taskIndex) {
          return updateDoc(doc(db, 'eventTasks', task.id), {
            ...index === taskIndex ? updatedTask : {},
            startTime: task.startTime
          });
        }
        return Promise.resolve();
      }));

      setTasks(updatedTasks);
      setEditingTaskId(null);
      setEditingTask(null);
      setNewTask({
        description: '',
        minutes: '',
        responsible: '',
        tags: []
      });

      toast.success('Task updated successfully');
    } catch (error) {
      console.error('Error updating task:', error);
      toast.error('Failed to update task');
    }
  };

  const handleDeleteTask = async (taskId) => {
    if (!window.confirm('Are you sure you want to delete this task?')) return;

    try {
      await deleteDoc(doc(db, 'eventTasks', taskId));
      const remainingTasks = tasks.filter(task => task.id !== taskId);
      setTasks(remainingTasks);
      toast.success('Task deleted successfully');
    } catch (error) {
      console.error('Error deleting task:', error);
      toast.error('Failed to delete task');
    }
  };

  const handleAddNote = async (taskId) => {
    if (!newNote.content.trim()) {
      toast.error('Note content cannot be empty');
      return;
    }
  
    try {
      const noteData = {
        content: newNote.content,
        assignedTo: newNote.assignedTo,
        status: newNote.status,
        tags: newNote.tags,
        createdAt: new Date().toISOString(),
        taskId,
        eventId // Add eventId to help with querying
      };
  
      // Save the note to Firebase
      const noteRef = await addDoc(collection(db, 'taskNotes'), noteData);
      
      // Update the local state
      const updatedTasks = tasks.map(task => {
        if (task.id === taskId) {
          const updatedNotes = [...(task.notes || []), { id: noteRef.id, ...noteData }];
          return { ...task, notes: updatedNotes };
        }
        return task;
      });
  
      setTasks(updatedTasks);
      setNewNote({
        content: '',
        assignedTo: '',
        status: 'pending',
        tags: []
      });
      toast.success('Note added successfully');
    } catch (error) {
      console.error('Error adding note:', error);
      toast.error('Failed to add note');
    }
  };
  
  const handleEditNote = async (taskId, noteId, updatedNote) => {
    try {
      // Keep existing note data that wasn't changed
      const existingNote = tasks
        .find(t => t.id === taskId)
        ?.notes?.find(n => n.id === noteId);
      
      const noteData = {
        ...existingNote,
        ...updatedNote,
        updatedAt: new Date().toISOString()
      };

      await updateDoc(doc(db, 'taskNotes', noteId), noteData);
  
      const updatedTasks = tasks.map(task => {
        if (task.id === taskId) {
          const updatedNotes = (task.notes || []).map(note => 
            note.id === noteId ? { ...note, ...noteData } : note
          );
          return { ...task, notes: updatedNotes };
        }
        return task;
      });
  
      setTasks(updatedTasks);
      setEditingNote(null);
      toast.success('Note updated successfully');
    } catch (error) {
      console.error('Error updating note:', error);
      toast.error('Failed to update note');
    }
  };
  
  const handleDeleteNote = async (taskId, noteId) => {
    if (!window.confirm('Are you sure you want to delete this note?')) return;
  
    try {
      await deleteDoc(doc(db, 'taskNotes', noteId));
      
      const updatedTasks = tasks.map(task => {
        if (task.id === taskId) {
          return {
            ...task,
            notes: (task.notes || []).filter(note => note.id !== noteId)
          };
        }
        return task;
      });
  
      setTasks(updatedTasks);
      toast.success('Note deleted successfully');
    } catch (error) {
      console.error('Error deleting note:', error);
      toast.error('Failed to delete note');
    }
  };

  const handleAddGeneralNote = async () => {
    if (!newGeneralNote.content.trim()) {
      toast.error('Note content cannot be empty');
      return;
    }

    try {
      const noteData = {
        content: newGeneralNote.content,
        assignedTo: newGeneralNote.assignedTo,
        status: newGeneralNote.status,
        tags: newGeneralNote.tags,
        createdAt: new Date().toISOString()
      };

      const notesRef = collection(db, 'churches', id, 'events', eventId, 'notes');
      const noteRef = await addDoc(notesRef, noteData);
      setGeneralNotes(prev => [{ id: noteRef.id, ...noteData }, ...prev]);
      setNewGeneralNote({
        content: '',
        assignedTo: '',
        status: 'pending',
        tags: []
      });
      toast.success('Note added successfully');
    } catch (error) {
      console.error('Error adding general note:', error);
      toast.error('Failed to add note');
    }
  };

  const handleEditGeneralNote = async (noteId) => {
    try {
      const noteRef = doc(db, 'churches', id, 'events', eventId, 'notes', noteId);
      await updateDoc(noteRef, {
        content: editingGeneralNote.content,
        assignedTo: editingGeneralNote.assignedTo,
        status: editingGeneralNote.status,
        tags: editingGeneralNote.tags,
        updatedAt: new Date().toISOString()
      });

      setGeneralNotes(prev => prev.map(note =>
        note.id === noteId ? { ...note, ...editingGeneralNote } : note
      ));
      setEditingGeneralNote(null);
      toast.success('Note updated successfully');
    } catch (error) {
      console.error('Error updating general note:', error);
      toast.error('Failed to update note');
    }
  };

  const handleDeleteGeneralNote = async (noteId) => {
    if (!window.confirm('Are you sure you want to delete this note?')) return;

    try {
      const noteRef = doc(db, 'churches', id, 'events', eventId, 'notes', noteId);
      await deleteDoc(noteRef);
      setGeneralNotes(prev => prev.filter(note => note.id !== noteId));
      toast.success('Note deleted successfully');
    } catch (error) {
      console.error('Error deleting general note:', error);
      toast.error('Failed to delete note');
    }
  };

  return (
    <div className="coordination-container">
      <button onClick={() => navigate(`/church/${id}/mi-organizacion`)}>
        ← Back
      </button>

      <ChurchHeader id={id} applyShadow={false} />

      {isLoading ? (
        <div className="loading">Loading event details...</div>
      ) : !event ? (
        <div className="error">
          <p>Could not load event details</p>
          <small>Please ensure the event exists and has a start time</small>
        </div>
      ) : !event.startHour ? (
        <div className="error">
          <p>Event start time not set</p>
          <small>Please set a start time for this event first</small>
        </div>
      ) : (
        <>
          <div className="event-header">
            <div>
              <h2>Event Coordination</h2>
              <h3>{event?.title}</h3>
              <p>Event Start Time: {event?.startHour}</p>
            </div>
            <button 
              onClick={() => setShowPdfModal(true)}
              className="print-button"
            >
              <FaPrint /> Generate PDF
            </button>
          </div>

          <div className="tasks-list">
            <h4>Schedule</h4>
            {tasks.length === 0 ? (
              <div className="empty-schedule">
                {!showAddForm ? (
                  <button 
                    onClick={() => setShowAddForm(true)}
                    className="add-first-task-button"
                  >
                    <FaPlus /> Add First Task
                  </button>
                ) : (
                  <div className="task-form inline">
                    <form onSubmit={handleAddTask}>
                      <div>
                        <label>Description:</label>
                        <input
                          type="text"
                          value={newTask.description}
                          onChange={(e) => setNewTask({...newTask, description: e.target.value})}
                          required
                        />
                      </div>

                      <div>
                        <label>Duration (minutes):</label>
                        <div className="duration-input-group">
                          <div className="time-input-wrapper">
                            <input
                              type="number"
                              value={newTask.minutes}
                              onChange={(e) => setNewTask({...newTask, minutes: e.target.value})}
                              min="0"
                              placeholder="0"
                              className="duration-input"
                            />
                            <span>min</span>
                          </div>
                        </div>
                      </div>

                      <div>
                        <label>Responsible Person:</label>
                        <input
                          type="text"
                          value={newTask.responsible}
                          onChange={(e) => setNewTask({...newTask, responsible: e.target.value})}
                          required
                        />
                      </div>

                      <div>
                        <label>Tags:</label>
                        <input
                          type="text"
                          value={newTask.tags.join(', ')}
                          onChange={(e) => handleTagChange(e.target.value, 'task')}
                          placeholder="Comma-separated tags"
                        />
                      </div>

                      <div className="form-buttons">
                        <button type="submit">Add Task</button>
                        <button 
                          type="button" 
                          onClick={() => setShowAddForm(false)}
                          className="cancel-button"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            ) : (
              <div className="tasks-timeline">
                {tasks.map((task, index) => (
                  <div key={task.id} className="task-item">
                    {editingTaskId === task.id ? (
                      <div className="task-form inline">
                        <form onSubmit={handleUpdateTask}>
                          <div>
                            <label>Description:</label>
                            <input
                              type="text"
                              value={newTask.description}
                              onChange={(e) => setNewTask({...newTask, description: e.target.value})}
                              required
                            />
                          </div>

                          <div>
                            <label>Duration (minutes):</label>
                            <div className="duration-input-group">
                              <div className="time-input-wrapper">
                                <input
                                  type="number"
                                  value={newTask.minutes}
                                  onChange={(e) => setNewTask({...newTask, minutes: e.target.value})}
                                  min="0"
                                  placeholder="0"
                                  className="duration-input"
                                />
                                <span>min</span>
                              </div>
                            </div>
                          </div>

                          <div>
                            <label>Responsible Person:</label>
                            <input
                              type="text"
                              value={newTask.responsible}
                              onChange={(e) => setNewTask({...newTask, responsible: e.target.value})}
                              required
                            />
                          </div>

                          <div>
                            <label>Tags:</label>
                            <input
                              type="text"
                              value={newTask.tags.join(', ')}
                              onChange={(e) => handleTagChange(e.target.value, 'task')}
                              placeholder="Comma-separated tags"
                            />
                          </div>

                          <div className="form-buttons">
                            <button type="submit">Update Task</button>
                            <button 
                              type="button" 
                              onClick={() => {
                                setEditingTaskId(null);
                                setEditingTask(null);
                                setNewTask({
                                  description: '',
                                  minutes: '',
                                  responsible: '',
                                  tags: []
                                });
                              }}
                              className="cancel-button"
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      </div>
                    ) : (
                      <>
                        <div className="task-header">
                          <div className="task-main-info">
                            <div className="task-time-info">
                              <div className="task-time">{task.startTime}</div>
                              <div className="task-duration">{task.duration} minutes</div>
                            </div>
                            <div className="task-details">
                              <div className="task-description">{task.description}</div>
                              <div className="task-responsible">👤 {task.responsible}</div>
                              {task.tags?.length > 0 && (
                                <div className="task-tags">
                                  {task.tags.map((tag, i) => (
                                    <span key={i} className="tag">{tag}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="task-actions">
                            <button
                              onClick={() => handleMoveTask(task.id, 'up')}
                              disabled={index === 0}
                              className="action-button"
                            >
                              <FaArrowUp />
                            </button>
                            <button
                              onClick={() => handleMoveTask(task.id, 'down')}
                              disabled={index === tasks.length - 1}
                              className="action-button"
                            >
                              <FaArrowDown />
                            </button>
                            <button
                              onClick={() => handleEditTask(task)}
                              className="action-button edit"
                            >
                              <FaEdit />
                            </button>
                            <button
                              onClick={() => handleDeleteTask(task.id)}
                              className="action-button delete"
                            >
                              <FaTrash />
                            </button>
                            <button
                              onClick={() => setShowNotes(prev => ({ ...prev, [task.id]: !prev[task.id] }))}
                              className="action-button note"
                            >
                              <FaStickyNote />
                            </button>
                          </div>
                        </div>
                        {showNotes[task.id] && (
                          <div className="task-notes">
                            <div className="notes-header">
                              <h4 className="notes-title">Notes & Comments</h4>
                            </div>
                            
                            <div className="notes-list">
                              {!task.notes?.length ? (
                                <div className="notes-empty">No notes yet</div>
                              ) : (
                                task.notes.map(note => (
                                  <div key={note.id} className="note-item">
                                    {editingNote?.id === note.id ? (
                                      <div className="note-edit-form">
                                        <input
                                          type="text"
                                          value={editingNote.content}
                                          onChange={(e) => setEditingNote({...editingNote, content: e.target.value})}
                                          className="note-edit-input"
                                          autoFocus
                                        />
                                        <input
                                          type="text"
                                          value={editingNote.assignedTo}
                                          onChange={(e) => setEditingNote({...editingNote, assignedTo: e.target.value})}
                                          placeholder="Assigned to..."
                                          className="note-edit-input"
                                        />
                                        <select
                                          value={editingNote.status}
                                          onChange={(e) => setEditingNote({...editingNote, status: e.target.value})}
                                          className="note-status-select"
                                        >
                                          <option value="pending">Pending</option>
                                          <option value="in-progress">In Progress</option>
                                          <option value="completed">Completed</option>
                                        </select>
                                        <input
                                          type="text"
                                          value={editingNote.tags?.join(', ')}
                                          onChange={(e) => handleTagChange(e.target.value, 'note', note.id)}
                                          placeholder="Comma-separated tags"
                                          className="note-edit-input"
                                        />
                                        <div className="note-edit-actions">
                                          <button onClick={() => handleEditNote(task.id, note.id, editingNote)}>Save</button>
                                          <button onClick={() => setEditingNote(null)}>Cancel</button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="note-content">
                                        <div className="note-header">
                                          <span className={`note-status ${note.status}`}>{note.status}</span>
                                          {note.assignedTo && (
                                            <span className="note-assignee">
                                              <span className="assigned-user">@{note.assignedTo}</span>
                                            </span>
                                          )}
                                          {note.tags?.length > 0 && (
                                            <div className="note-tags">
                                              {note.tags.map((tag, i) => (
                                                <span key={i} className="tag">{tag}</span>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                        <div className="note-text">{note.content}</div>
                                        <div className="note-actions">
                                          <button onClick={() => setEditingNote(note)} className="note-button edit">
                                            <FaPen size={12} />
                                          </button>
                                          <button onClick={() => handleDeleteNote(task.id, note.id)} className="note-button delete">
                                            <FaTrash size={12} />
                                          </button>
                                        </div>
                                        <div className="note-timestamp">
                                          {new Date(note.createdAt).toLocaleString()}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ))
                              )}
                            </div>
                            
                            <div className="add-note">
                              <input
                                type="text"
                                value={newNote.content}
                                onChange={(e) => setNewNote({...newNote, content: e.target.value})}
                                placeholder="Add a note..."
                                className="note-input"
                              />
                              <input
                                type="text"
                                value={newNote.assignedTo}
                                onChange={(e) => setNewNote({...newNote, assignedTo: e.target.value})}
                                placeholder="Assign to..."
                                className="note-input"
                              />
                              <select
                                value={newNote.status}
                                onChange={(e) => setNewNote({...newNote, status: e.target.value})}
                                className="note-status-select"
                              >
                                <option value="pending">Pending</option>
                                <option value="in-progress">In Progress</option>
                                <option value="completed">Completed</option>
                              </select>
                              <input
                                type="text"
                                value={newNote.tags.join(', ')}
                                onChange={(e) => handleTagChange(e.target.value, 'note')}
                                placeholder="Comma-separated tags"
                                className="note-input"
                              />
                              <button onClick={() => handleAddNote(task.id)} className="note-add-button">
                                <FaPlus size={12} />
                                <span>Add Note</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                    {index < tasks.length - 1 && <div className="task-connector"></div>}
                  </div>
                ))}
                {!showAddForm ? (
                  <button 
                    onClick={() => setShowAddForm(true)}
                    className="add-task-button"
                  >
                    <FaPlus /> Add New Task
                  </button>
                ) : (
                  <div className="task-form inline">
                    <form onSubmit={handleAddTask}>
                      <div>
                        <label>Description:</label>
                        <input
                          type="text"
                          value={newTask.description}
                          onChange={(e) => setNewTask({...newTask, description: e.target.value})}
                          required
                        />
                      </div>

                      <div>
                        <label>Duration (minutes):</label>
                        <div className="duration-input-group">
                          <div className="time-input-wrapper">
                            <input
                              type="number"
                              value={newTask.minutes}
                              onChange={(e) => setNewTask({...newTask, minutes: e.target.value})}
                              min="0"
                              placeholder="0"
                              className="duration-input"
                            />
                            <span>min</span>
                          </div>
                        </div>
                      </div>

                      <div>
                        <label>Responsible Person:</label>
                        <input
                          type="text"
                          value={newTask.responsible}
                          onChange={(e) => setNewTask({...newTask, responsible: e.target.value})}
                          required
                        />
                      </div>

                      <div>
                        <label>Tags:</label>
                        <input
                          type="text"
                          value={newTask.tags.join(', ')}
                          onChange={(e) => handleTagChange(e.target.value, 'task')}
                          placeholder="Comma-separated tags"
                        />
                      </div>

                      <div className="form-buttons">
                        <button type="submit">Add Task</button>
                        <button 
                          type="button" 
                          onClick={() => setShowAddForm(false)}
                          className="cancel-button"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="general-notes-section">
            <h3>General Notes</h3>
            <div className="general-notes-list">
              {generalNotes.map(note => (
                <div key={note.id} className="general-note-item">
                  {editingGeneralNote?.id === note.id ? (
                    <div className="note-edit-form">
                      <input
                        type="text"
                        value={editingGeneralNote.content}
                        onChange={(e) => setEditingGeneralNote({...editingGeneralNote, content: e.target.value})}
                        className="note-edit-input"
                        autoFocus
                      />
                      <input
                        type="text"
                        value={editingGeneralNote.assignedTo}
                        onChange={(e) => setEditingGeneralNote({...editingGeneralNote, assignedTo: e.target.value})}
                        placeholder="Assigned to..."
                        className="note-edit-input"
                      />
                      <select
                        value={editingGeneralNote.status}
                        onChange={(e) => setEditingGeneralNote({...editingGeneralNote, status: e.target.value})}
                        className="note-status-select"
                      >
                        <option value="pending">Pending</option>
                        <option value="in-progress">In Progress</option>
                        <option value="completed">Completed</option>
                      </select>
                      <input
                        type="text"
                        value={editingGeneralNote.tags?.join(', ')}
                        onChange={(e) => handleTagChange(e.target.value, 'general-note', note.id)}
                        placeholder="Comma-separated tags"
                        className="note-edit-input"
                      />
                      <div className="note-edit-actions">
                        <button onClick={() => handleEditGeneralNote(note.id)} className="note-button save">Save</button>
                        <button onClick={() => setEditingGeneralNote(null)} className="note-button cancel">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="note-content">
                      <div className="note-header">
                        <span className={`note-status ${note.status}`}>{note.status}</span>
                        {note.assignedTo && (
                          <span className="note-assignee">
                            <span className="assigned-user">@{note.assignedTo}</span>
                          </span>
                        )}
                        {note.tags?.length > 0 && (
                          <div className="note-tags">
                            {note.tags.map((tag, i) => (
                              <span key={i} className="tag">{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="note-text">{note.content}</div>
                      <div className="note-actions">
                        <button 
                          onClick={() => setEditingGeneralNote({...note})} 
                          className="note-button edit"
                        >
                          <FaPen size={12} />
                        </button>
                        <button 
                          onClick={() => handleDeleteGeneralNote(note.id)} 
                          className="note-button delete"
                        >
                          <FaTrash size={12} />
                        </button>
                      </div>
                      <div className="note-timestamp">
                        {new Date(note.createdAt).toLocaleString()}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="add-general-note-form">
              <h4>Add New Note</h4>
              <div className="note-form-content">
                <input
                  type="text"
                  value={newGeneralNote.content}
                  onChange={(e) => setNewGeneralNote({...newGeneralNote, content: e.target.value})}
                  placeholder="Add a general note..."
                  className="note-input"
                />
                <input
                  type="text"
                  value={newGeneralNote.assignedTo}
                  onChange={(e) => setNewGeneralNote({...newGeneralNote, assignedTo: e.target.value})}
                  placeholder="Assign to..."
                  className="note-input"
                />
                <select
                  value={newGeneralNote.status}
                  onChange={(e) => setNewGeneralNote({...newGeneralNote, status: e.target.value})}
                  className="note-status-select"
                >
                  <option value="pending">Pending</option>
                  <option value="in-progress">In Progress</option>
                  <option value="completed">Completed</option>
                </select>
                <input
                  type="text"
                  value={newGeneralNote.tags.join(', ')}
                  onChange={(e) => handleTagChange(e.target.value, 'general-note')}
                  placeholder="Comma-separated tags"
                  className="note-input"
                />
                <button onClick={handleAddGeneralNote} className="note-add-button">
                  <FaPlus size={12} />
                  <span>Add Note</span>
                </button>
              </div>
            </div>
          </div>

          {/* Add the PDF modal */}
          {showPdfModal && (
            <div className="pdf-modal">
              <div className="pdf-modal-content">
                <button 
                  className="close-modal-button"
                  onClick={() => setShowPdfModal(false)}
                >
                  ×
                </button>
                <EventCoordinationPDF 
                  event={event}
                  tasks={tasks}
                  generalNotes={generalNotes}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default EventCoordination;