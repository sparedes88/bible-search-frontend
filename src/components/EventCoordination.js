import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
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
import { FaArrowUp, FaArrowDown, FaEdit, FaTrash, FaPlus, FaPen, FaStickyNote, FaPrint, FaChevronDown, FaTimes } from 'react-icons/fa';
import EventCoordinationPDF from './EventCoordinationPDF';
import './EventCoordination.css';

// Multi-Select Component
const MultiSelect = ({ label, items, selectedIds, selectedNames, onToggle, searchable = true }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const filteredItems = searchable 
    ? items.filter(item => item.name.toLowerCase().includes(searchTerm.toLowerCase()))
    : items;

  const handleItemToggle = (id, name) => {
    onToggle(id, name);
  };

  const handleRemoveChip = (id, name) => {
    if (selectedIds.includes(id)) {
      handleItemToggle(id, name);
    }
  };

  return (
    <div className="multi-select-wrapper">
      {label && <label className="multi-select-label">{label}</label>}
      <div
        className={`multi-select-input ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="multi-select-input-field">
          {selectedIds.length > 0 ? (
            selectedNames.map((name, index) => (
              <span key={index} className="multi-select-chip">
                {name}
                <span
                  className="multi-select-chip-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveChip(selectedIds[index], name);
                  }}
                >
                  <FaTimes size={10} />
                </span>
              </span>
            ))
          ) : (
            <span className="multi-select-placeholder">Select...</span>
          )}
        </div>
        <div className="multi-select-arrow">
          <FaChevronDown />
        </div>
      </div>

      {isOpen && (
        <div className="multi-select-dropdown">
          {searchable && (
            <div className="multi-select-dropdown-search">
              <input
                type="text"
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
          <div className="multi-select-options">
            {filteredItems.length === 0 ? (
              <div className="multi-select-empty">
                {searchTerm ? 'No matches found' : 'No items available'}
              </div>
            ) : (
              filteredItems.map((item) => (
                <div key={item.id} className="multi-select-option">
                  <input
                    type="checkbox"
                    id={`${item.id}-checkbox`}
                    checked={selectedIds.includes(item.id)}
                    onChange={() => handleItemToggle(item.id, item.name)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <label htmlFor={`${item.id}-checkbox`}>{item.name}</label>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

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
    songId: '',
    songTitle: '',
    tags: [], // Add tags to task
    teamIds: [],
    teamNames: [],
    teamMemberIds: [],
    teamMemberNames: []
  });
  const [songs, setSongs] = useState([]);
  const [teams, setTeams] = useState([]);
  const [selectedTeamMembers, setSelectedTeamMembers] = useState([]);
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

  // Campus states
  const [campuses, setCampuses] = useState([]);
  const [selectedCampus, setSelectedCampus] = useState('');
  const [editingCampus, setEditingCampus] = useState(false);

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
    const fetchSongs = async () => {
      try {
        const songsRef = collection(db, `churches/${id}/songs`);
        const songsSnap = await getDocs(songsRef);
        const songsData = songsSnap.docs
          .map((songDoc) => ({ id: songDoc.id, ...songDoc.data() }))
          .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        setSongs(songsData);
      } catch (error) {
        console.error('Error fetching songs:', error);
      }
    };

    const fetchTeams = async () => {
      try {
        const teamsRef = collection(db, `churches/${id}/teams`);
        const teamsSnap = await getDocs(teamsRef);
        const teamsData = teamsSnap.docs
          .map((teamDoc) => ({ id: teamDoc.id, ...teamDoc.data() }))
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setTeams(teamsData);
      } catch (error) {
        console.error('Error fetching teams:', error);
      }
    };

    const fetchCampuses = async () => {
      try {
        const campusesRef = collection(db, `churches/${id}/campuses`);
        const campusesSnap = await getDocs(campusesRef);
        const campusesData = campusesSnap.docs
          .map((campusDoc) => ({ id: campusDoc.id, ...campusDoc.data() }))
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setCampuses(campusesData);
      } catch (error) {
        console.error('Error fetching campuses:', error);
      }
    };

    if (id) {
      fetchSongs();
      fetchTeams();
      fetchCampuses();
    }
  }, [id]);

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
      // Set selected campus if event has one
      if (event.campusId) {
        setSelectedCampus(event.campusId);
      }
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

  const handleTeamToggle = (teamId, teamName) => {
    const isCurrentlySelected = newTask.teamIds.includes(teamId);
    let updatedTeamIds, updatedTeamNames;
    
    if (isCurrentlySelected) {
      // Remove team
      updatedTeamIds = newTask.teamIds.filter(id => id !== teamId);
      updatedTeamNames = newTask.teamNames.filter(name => name !== teamName);
    } else {
      // Add team
      updatedTeamIds = [...newTask.teamIds, teamId];
      updatedTeamNames = [...newTask.teamNames, teamName];
    }
    
    // Collect all members from all selected teams
    const allMembers = [];
    const memberMap = new Map(); // To avoid duplicates
    
    updatedTeamIds.forEach(id => {
      const team = teams.find(t => t.id === id);
      if (team && team.members) {
        team.members.forEach(member => {
          if (!memberMap.has(member.userId)) {
            memberMap.set(member.userId, member);
            allMembers.push(member);
          }
        });
      }
    });
    
    // Remove any selected members that are no longer in the available pool
    const availableMemberIds = allMembers.map(m => m.userId);
    const filteredMemberIds = newTask.teamMemberIds.filter(id => availableMemberIds.includes(id));
    const filteredMemberNames = newTask.teamMemberNames.filter((_, index) => 
      availableMemberIds.includes(newTask.teamMemberIds[index])
    );
    
    setNewTask({
      ...newTask,
      teamIds: updatedTeamIds,
      teamNames: updatedTeamNames,
      teamMemberIds: filteredMemberIds,
      teamMemberNames: filteredMemberNames
    });
    setSelectedTeamMembers(allMembers);
  };

  const handleTeamMemberToggle = (memberId, memberName) => {
    const isCurrentlySelected = newTask.teamMemberIds.includes(memberId);
    let updatedMemberIds, updatedMemberNames;
    
    if (isCurrentlySelected) {
      // Remove member
      updatedMemberIds = newTask.teamMemberIds.filter(id => id !== memberId);
      updatedMemberNames = newTask.teamMemberNames.filter(name => name !== memberName);
    } else {
      // Add member
      updatedMemberIds = [...newTask.teamMemberIds, memberId];
      updatedMemberNames = [...newTask.teamMemberNames, memberName];
    }
    
    setNewTask({
      ...newTask,
      teamMemberIds: updatedMemberIds,
      teamMemberNames: updatedMemberNames
    });
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
        songId: newTask.songId || null,
        songTitle: newTask.songTitle || '',
        tags: newTask.tags,
        teamIds: newTask.teamIds || [],
        teamNames: newTask.teamNames || [],
        teamMemberIds: newTask.teamMemberIds || [],
        teamMemberNames: newTask.teamMemberNames || [],
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
        songId: '',
        songTitle: '',
        tags: [],
        teamIds: [],
        teamNames: [],
        teamMemberIds: [],
        teamMemberNames: []
      });
      setSelectedTeamMembers([]);
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
      songId: task.songId || '',
      songTitle: task.songTitle || '',
      tags: task.tags || [],
      teamIds: task.teamIds || [],
      teamNames: task.teamNames || [],
      teamMemberIds: task.teamMemberIds || [],
      teamMemberNames: task.teamMemberNames || []
    });
    
    // If task has teams, populate all members from those teams
    if (task.teamIds && task.teamIds.length > 0) {
      const allMembers = [];
      const memberMap = new Map();
      
      task.teamIds.forEach(teamId => {
        const selectedTeam = teams.find(team => team.id === teamId);
        if (selectedTeam && selectedTeam.members) {
          selectedTeam.members.forEach(member => {
            if (!memberMap.has(member.userId)) {
              memberMap.set(member.userId, member);
              allMembers.push(member);
            }
          });
        }
      });
      
      setSelectedTeamMembers(allMembers);
    } else {
      setSelectedTeamMembers([]);
    }
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
        songId: newTask.songId || null,
        songTitle: newTask.songTitle || '',
        tags: newTask.tags,
        teamIds: newTask.teamIds || [],
        teamNames: newTask.teamNames || [],
        teamMemberIds: newTask.teamMemberIds || [],
        teamMemberNames: newTask.teamMemberNames || [],
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
        songId: '',
        songTitle: '',
        tags: [],
        teamIds: [],
        teamNames: [],
        teamMemberIds: [],
        teamMemberNames: []
      });
      setSelectedTeamMembers([]);

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

  const handleSaveCampus = async () => {
    try {
      // Try to update in eventInstances first
      const eventInstanceDoc = await getDoc(doc(db, 'eventInstances', eventId));
      
      if (eventInstanceDoc.exists()) {
        await updateDoc(doc(db, 'eventInstances', eventId), {
          campusId: selectedCampus,
          campusName: campuses.find(c => c.id === selectedCampus)?.name || ''
        });
      } else {
        // If not in eventInstances, update in events collection
        await updateDoc(doc(db, 'events', eventId), {
          campusId: selectedCampus,
          campusName: campuses.find(c => c.id === selectedCampus)?.name || ''
        });
      }

      setEvent(prev => ({
        ...prev,
        campusId: selectedCampus,
        campusName: campuses.find(c => c.id === selectedCampus)?.name || ''
      }));
      setEditingCampus(false);
      toast.success('Campus updated successfully');
    } catch (error) {
      console.error('Error updating campus:', error);
      toast.error('Failed to update campus');
    }
  };

  return (
    <div className="coordination-container">
      <button onClick={() => navigate(`/organization/${id}/mi-organizacion`)}>
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
              
              {/* Campus Selection */}
              <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                {!editingCampus ? (
                  <>
                    <span style={{ fontSize: '14px', color: '#6B7280' }}>
                      <strong>Campus:</strong> {event?.campusName || 'Not set'}
                    </span>
                    <button
                      onClick={() => setEditingCampus(true)}
                      style={{
                        padding: '4px 12px',
                        fontSize: '13px',
                        backgroundColor: '#EEF2FF',
                        color: '#4F46E5',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: '500'
                      }}
                    >
                      <FaPen style={{ marginRight: '4px' }} />
                      {event?.campusId ? 'Change' : 'Set Campus'}
                    </button>
                  </>
                ) : (
                  <>
                    <select
                      value={selectedCampus}
                      onChange={(e) => setSelectedCampus(e.target.value)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: '1px solid #D1D5DB',
                        fontSize: '14px',
                        minWidth: '200px'
                      }}
                    >
                      <option value="">Select Campus...</option>
                      {campuses.map(campus => (
                        <option key={campus.id} value={campus.id}>
                          {campus.name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={handleSaveCampus}
                      disabled={!selectedCampus}
                      style={{
                        padding: '6px 12px',
                        fontSize: '13px',
                        backgroundColor: '#10B981',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: selectedCampus ? 'pointer' : 'not-allowed',
                        fontWeight: '500',
                        opacity: selectedCampus ? 1 : 0.5
                      }}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setEditingCampus(false);
                        setSelectedCampus(event?.campusId || '');
                      }}
                      style={{
                        padding: '6px 12px',
                        fontSize: '13px',
                        backgroundColor: '#6B7280',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: '500'
                      }}
                    >
                      Cancel
                    </button>
                    {campuses.length === 0 && (
                      <Link
                        to={`/organization/${id}/campuses`}
                        style={{
                          padding: '6px 12px',
                          fontSize: '13px',
                          backgroundColor: '#4F46E5',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          textDecoration: 'none',
                          fontWeight: '500',
                          display: 'inline-block'
                        }}
                      >
                        <FaPlus style={{ marginRight: '4px' }} />
                        Add Campus
                      </Link>
                    )}
                  </>
                )}
              </div>
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

                      <MultiSelect
                        label="Teams (optional)"
                        items={teams}
                        selectedIds={newTask.teamIds}
                        selectedNames={newTask.teamNames}
                        onToggle={handleTeamToggle}
                      />

                      {newTask.teamIds.length > 0 && selectedTeamMembers.length > 0 && (
                        <MultiSelect
                          label="Team Members (optional)"
                          items={selectedTeamMembers.map(m => ({ id: m.userId, name: m.name }))}
                          selectedIds={newTask.teamMemberIds}
                          selectedNames={newTask.teamMemberNames}
                          onToggle={handleTeamMemberToggle}
                        />
                      )}

                      <div>
                        <label>Linked Song (optional):</label>
                        <select
                          value={newTask.songId}
                          onChange={(e) => {
                            const selectedSong = songs.find(song => song.id === e.target.value);
                            setNewTask({
                              ...newTask,
                              songId: e.target.value,
                              songTitle: selectedSong?.title || ''
                            });
                          }}
                        >
                          <option value="">No song linked</option>
                          {songs.map((song) => (
                            <option key={song.id} value={song.id}>{song.title}</option>
                          ))}
                        </select>
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

                          <MultiSelect
                            label="Teams (optional)"
                            items={teams}
                            selectedIds={newTask.teamIds}
                            selectedNames={newTask.teamNames}
                            onToggle={handleTeamToggle}
                          />

                          {newTask.teamIds.length > 0 && selectedTeamMembers.length > 0 && (
                            <MultiSelect
                              label="Team Members (optional)"
                              items={selectedTeamMembers.map(m => ({ id: m.userId, name: m.name }))}
                              selectedIds={newTask.teamMemberIds}
                              selectedNames={newTask.teamMemberNames}
                              onToggle={handleTeamMemberToggle}
                            />
                          )}

                          <div>
                            <label>Linked Song (optional):</label>
                            <select
                              value={newTask.songId}
                              onChange={(e) => {
                                const selectedSong = songs.find(song => song.id === e.target.value);
                                setNewTask({
                                  ...newTask,
                                  songId: e.target.value,
                                  songTitle: selectedSong?.title || ''
                                });
                              }}
                            >
                              <option value="">No song linked</option>
                              {songs.map((song) => (
                                <option key={song.id} value={song.id}>{song.title}</option>
                              ))}
                            </select>
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
                                  songId: '',
                                  songTitle: '',
                                  tags: [],
                                  teamIds: [],
                                  teamNames: [],
                                  teamMemberIds: [],
                                  teamMemberNames: []
                                });
                                setSelectedTeamMembers([]);
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
                              {task.songTitle && (
                                <div className="task-responsible">
                                  🎵 <Link to={`/organization/${id}/song-manager`}>{task.songTitle}</Link>
                                </div>
                              )}
                              {task.teamNames?.length > 0 && (
                                <div className="task-responsible">
                                  👥 {task.teamNames.join(', ')}
                                  {task.teamMemberNames?.length > 0 && ` - ${task.teamMemberNames.join(', ')}`}
                                </div>
                              )}
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

                      <MultiSelect
                        label="Teams (optional)"
                        items={teams}
                        selectedIds={newTask.teamIds}
                        selectedNames={newTask.teamNames}
                        onToggle={handleTeamToggle}
                      />

                      {newTask.teamIds.length > 0 && selectedTeamMembers.length > 0 && (
                        <MultiSelect
                          label="Team Members (optional)"
                          items={selectedTeamMembers.map(m => ({ id: m.userId, name: m.name }))}
                          selectedIds={newTask.teamMemberIds}
                          selectedNames={newTask.teamMemberNames}
                          onToggle={handleTeamMemberToggle}
                        />
                      )}

                      <div>
                        <label>Linked Song (optional):</label>
                        <select
                          value={newTask.songId}
                          onChange={(e) => {
                            const selectedSong = songs.find(song => song.id === e.target.value);
                            setNewTask({
                              ...newTask,
                              songId: e.target.value,
                              songTitle: selectedSong?.title || ''
                            });
                          }}
                        >
                          <option value="">No song linked</option>
                          {songs.map((song) => (
                            <option key={song.id} value={song.id}>{song.title}</option>
                          ))}
                        </select>
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