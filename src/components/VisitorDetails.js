import React, { useState, useEffect, useMemo } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useNavigate, useParams, Link } from "react-router-dom";
import {
  doc,
  getDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  writeBatch
} from "firebase/firestore";
import { db } from "../firebase";
import commonStyles from "../pages/commonStyles";
import ChurchHeader from "./ChurchHeader";
import {
  FaPhoneAlt,
  FaUserSlash,
  FaTrash,
  FaEdit,
  FaSave,
  FaTimes,
} from "react-icons/fa";
import { toast, ToastContainer } from "react-toastify";
import 'react-toastify/dist/ReactToastify.css';
import "./VisitorDetails.css";
import Select from "react-select";
import CreatableSelect from 'react-select/creatable';
import ocupaciones from "./ocupaciones";
import nacionalidades from "./nacionalidades";
import idiomas from "./idiomas";
import habilidades from "./habilidades";
import { getAuth, createUserWithEmailAndPassword } from "firebase/auth";
import { states, majorCities, countries, validatePostalCode, formatPostalCode } from './data/locations';

const formatPhoneNumber = (phoneNumber) => {
  if (!phoneNumber) return '';
  const cleaned = phoneNumber.replace(/\D/g, '');
  const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);
  if (match) {
    return `(${match[1]}) ${match[2]}-${match[3]}`;
  }
  return phoneNumber;
};

const cleanPhoneNumber = (phoneNumber) => phoneNumber.replace(/\D/g, '');

const showToast = (message, type = 'info') => {
  if (!toast[type]) {
    console.warn(`Invalid toast type: ${type}`);
    type = 'info';  // fallback to info if invalid type
  }
  toast[type](message, {
    position: "top-right",
    autoClose: 3000,
    hideProgressBar: false,
    closeOnClick: true,
    pauseOnHover: true,
    draggable: true,
    progress: undefined,
  });
};

const calculateAge = (birthDate) => {
  if (!birthDate) return null;
  
  const today = new Date();
  const birth = new Date(birthDate);
  
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }

  return age;
};

const VisitorDetails = () => {
  const { id, visitorId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [visitorData, setVisitorData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [newNote, setNewNote] = useState("");
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [newNoteTag, setNewNoteTag] = useState("");
  const [selectedNoteTags, setSelectedNoteTags] = useState([]);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editedNote, setEditedNote] = useState("");
  const [editedNoteText, setEditedNoteText] = useState("");
  const [availableTags, setAvailableTags] = useState([
    "Follow-up needed",
    "Prayer request",
    "Interested in membership",
    "Needs counseling",
    "First time visitor",
    "Regular attendee"
  ]);
  const [isEditing, setIsEditing] = useState(false);
  const [noteTagFilter, setNoteTagFilter] = useState("");
  const [activeNoteTags, setActiveNoteTags] = useState([]);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [localData, setLocalData] = useState({});
  const [showMigrationModal, setShowMigrationModal] = useState(false);
  const [personalInfo, setPersonalInfo] = useState({
    dateOfBirth: '',
    gender: '',
    maritalStatus: '',
    address: {
      street: '',
      city: '',
      state: '',
      zipCode: '',
      country: ''
    }
  });
  const [cityOptions, setCityOptions] = useState([]);

  const filteredNotes = useMemo(() => {
    if (!visitorData?.notes) return [];
    return visitorData.notes.filter(note => {
      if (activeNoteTags.length === 0 && !noteTagFilter) return true;
      
      // Filter by active tags
      const matchesActiveTags = activeNoteTags.length === 0 || 
        note.tags?.some(tag => activeNoteTags.includes(tag));
      
      // Filter by current input
      const matchesFilter = !noteTagFilter || 
        note.tags?.some(tag => 
          tag.toLowerCase().includes(noteTagFilter.toLowerCase())
        );

      return matchesActiveTags && matchesFilter;
    });
  }, [visitorData?.notes, activeNoteTags, noteTagFilter]);

  useEffect(() => {
    const fetchVisitorDetails = async () => {
      if (!id || !visitorId) {
        showToast("Missing required parameters", "error");
        return;
      }

      try {
        const visitorDocRef = doc(db, "visitors", id, "visitors", visitorId);
        const visitorSnapshot = await getDoc(visitorDocRef);
        console.log("Visitor >>", visitorSnapshot.data());
        if (visitorSnapshot.exists()) {
          setVisitorData(visitorSnapshot.data());
        } else {
          console.log("No such visitor!");
        }
      } catch (error) {
        console.error("Error fetching visitor details:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchVisitorDetails();
  }, [id, visitorId]);

  useEffect(() => {
    if (visitorData) {
      setPersonalInfo({
        dateOfBirth: visitorData.dateOfBirth || '',
        gender: visitorData.gender || '',
        maritalStatus: visitorData.maritalStatus || '',
        address: visitorData.address || {
          street: '',
          city: '',
          state: '',
          zipCode: '',
          country: ''
        }
      });
    }
  }, [visitorData]);

  const handleBackClick = (id) => {
    navigate(`/church/${id}/admin-connect`);
  };

  const handleAddNote = async () => {
    if (visitorData.hasUserAccount) {
      showToast('This visitor has been migrated to a member account. Please add notes there.', 'info');
      navigate(`/church/${id}/member/${visitorData.migratedToUserId}`);
      return;
    }

    if (!newNote.trim()) {
      showToast("Please enter a note", "error");
      return;
    }

    try {
      const visitorRef = doc(db, "visitors", id, "visitors", visitorId);
      const noteObject = {
        text: newNote,
        timestamp: new Date().toISOString(),
        addedBy: user.email,
        tags: selectedNoteTags,
        tasks: [] // Add tasks array to note object
      };

      // Update the Firestore document
      await updateDoc(visitorRef, {
        notes: arrayUnion(noteObject)
      });

      // Update local state
      setVisitorData(prev => ({
        ...prev,
        notes: [...(prev.notes || []), noteObject]
      }));

      // Reset form
      setNewNote("");
      setSelectedNoteTags([]);
      setShowNoteInput(false);
      showToast("Note added successfully!", "success");
    } catch (error) {
      console.error("Error adding note:", error);
      showToast("Failed to add note", "error");
    }
  };

  const handleAddTask = async (noteIndex, taskText) => {
    try {
      const updatedNotes = [...visitorData.notes];
      const note = updatedNotes[noteIndex];
      
      const newTask = {
        id: Date.now().toString(),
        text: taskText,
        completed: false,
        createdAt: new Date().toISOString()
      };

      if (!note.tasks) {
        note.tasks = [];
      }
      
      note.tasks.push(newTask);
      
      const visitorRef = doc(db, "visitors", id, "visitors", visitorId);
      await updateDoc(visitorRef, { notes: updatedNotes });
      
      setVisitorData(prev => ({ ...prev, notes: updatedNotes }));
      showToast("Task added successfully!", "success");
    } catch (error) {
      console.error("Error adding task:", error);
      showToast("Failed to add task", "error");
    }
  };

  const handleToggleTask = async (noteIndex, taskId) => {
    try {
      const updatedNotes = [...visitorData.notes];
      const note = updatedNotes[noteIndex];
      const taskIndex = note.tasks.findIndex(task => task.id === taskId);
      
      if (taskIndex !== -1) {
        note.tasks[taskIndex].completed = !note.tasks[taskIndex].completed;
        note.tasks[taskIndex].completedAt = note.tasks[taskIndex].completed ? new Date().toISOString() : null;
      }

      const visitorRef = doc(db, "visitors", id, "visitors", visitorId);
      await updateDoc(visitorRef, { notes: updatedNotes });
      
      setVisitorData(prev => ({ ...prev, notes: updatedNotes }));
    } catch (error) {
      console.error("Error toggling task:", error);
      showToast("Failed to update task", "error");
    }
  };

  const handleEditTask = async (noteIndex, taskId) => {
    try {
      const updatedNotes = [...visitorData.notes];
      const note = updatedNotes[noteIndex];
      const taskIndex = note.tasks.findIndex(task => task.id === taskId);
      
      if (taskIndex !== -1) {
        const newText = prompt('Edit task:', note.tasks[taskIndex].text);
        if (newText && newText.trim()) {
          note.tasks[taskIndex] = {
            ...note.tasks[taskIndex],
            text: newText.trim(),
            editedAt: new Date().toISOString(),
            editedBy: user.email
          };

          const visitorRef = doc(db, "visitors", id, "visitors", visitorId);
          await updateDoc(visitorRef, { notes: updatedNotes });
          
          setVisitorData(prev => ({ ...prev, notes: updatedNotes }));
          showToast("Task updated successfully!", "success");
        }
      }
    } catch (error) {
      console.error("Error editing task:", error);
      showToast("Failed to edit task", "error");
    }
  };

  const handleDeleteTask = async (noteIndex, taskId) => {
    try {
      const updatedNotes = [...visitorData.notes];
      const note = updatedNotes[noteIndex];
      note.tasks = note.tasks.filter(task => task.id !== taskId);

      const visitorRef = doc(db, "visitors", id, "visitors", visitorId);
      await updateDoc(visitorRef, { notes: updatedNotes });
      
      setVisitorData(prev => ({ ...prev, notes: updatedNotes }));
      showToast("Task deleted successfully!", "success");
    } catch (error) {
      console.error("Error deleting task:", error);
      showToast("Failed to delete task", "error");
    }
  };

  const handleRemoveNote = async (noteToRemove) => {
    try {
      const visitorDocRef = doc(db, "visitors", id, "visitors", visitorId);
      await updateDoc(visitorDocRef, {
        notes: arrayRemove(noteToRemove),
      });

      setVisitorData((prev) => ({
        ...prev,
        notes: prev.notes.filter(
          (note) => note.timestamp !== noteToRemove.timestamp
        ),
      }));

      showToast("Note removed successfully!", "success");
    } catch (error) {
      console.error("Error removing note:", error);
      showToast("Failed to remove note", "error");
    }
  };

  const handleEditNote = (index) => {
    const note = visitorData.notes[index];
    setEditingNoteId(index);
    setEditedNote(note.text); // Now this will work
    setSelectedNoteTags(note.tags || []);
  };

  const handleCancelEdit = () => {
    setEditingNoteId(null);
    setEditedNoteText("");
  };

  const handleUpdateNote = async (noteToUpdate) => {
    if (!editedNoteText.trim()) {
      showToast("Note cannot be empty", "error");
      return;
    }

    try {
      const visitorDocRef = doc(db, "visitors", id, "visitors", visitorId);
      const updatedNotes = visitorData.notes.map((note) =>
        note.timestamp === noteToUpdate.timestamp
          ? {
              ...note,
              text: editedNoteText,
              editedAt: new Date().toISOString(),
              editedBy: user.email,
            }
          : note
      );

      await updateDoc(visitorDocRef, {
        notes: updatedNotes,
      });

      setVisitorData((prev) => ({
        ...prev,
        notes: updatedNotes,
      }));

      setEditingNoteId(null);
      setEditedNoteText("");
      showToast("Note updated successfully!", "success");
    } catch (error) {
      console.error("Error updating note:", error);
      showToast("Failed to update note", "error");
    }
  };

  const handleAddNoteTag = () => {
    if (newNoteTag.trim() && !selectedNoteTags.includes(newNoteTag.trim())) {
      setSelectedNoteTags([...selectedNoteTags, newNoteTag.trim()]);
      setNewNoteTag("");
    }
  };

  const handleRemoveNoteTag = (tagToRemove) => {
    setSelectedNoteTags(selectedNoteTags.filter(tag => tag !== tagToRemove));
  };

  const handleSelectExistingTag = (tag) => {
    if (!selectedNoteTags.includes(tag)) {
      setSelectedNoteTags([...selectedNoteTags, tag]);
    }
  };

  const handleSaveNote = async (index) => {
    try {
      const updatedNotes = [...visitorData.notes];
      updatedNotes[index] = {
        ...updatedNotes[index],
        text: editedNote,
        tags: selectedNoteTags,
        lastEdited: new Date().toISOString(),
        editedBy: user.email
      };

      const visitorRef = doc(db, "visitors", id, "visitors", visitorId);
      await updateDoc(visitorRef, { notes: updatedNotes });

      setVisitorData(prev => ({ ...prev, notes: updatedNotes }));
      setEditingNoteId(null);
      setEditedNote("");
      setSelectedNoteTags([]);
      showToast("Note updated successfully!", "success");
    } catch (error) {
      console.error("Error updating note:", error);
      showToast("Failed to update note", "error");
    }
  };

  const handleUpdateVisitor = async (field, value) => {
    try {
      const visitorRef = doc(db, "visitors", id, "visitors", visitorId);
      const updateData = {
        [field]: value,
        lastUpdated: new Date().toISOString(),
        updatedBy: user.email
      };

      await updateDoc(visitorRef, updateData);
      
      setVisitorData(prev => ({
        ...prev,
        [field]: value
      }));
      
      // Only show toast for form submissions, not individual field changes
      if (!['dateOfBirth', 'gender', 'maritalStatus', 'address'].includes(field)) {
        toast.success("Updated successfully!");
      }
    } catch (error) {
      console.error("Error updating:", error);
      toast.error("Failed to update");
    }
  };

  const handlePersonalInfoChange = (field, value) => {
    if (field === 'dateOfBirth' && value) {
      // Ensure consistent date format
      value = new Date(value).toISOString().split('T')[0];
    }
    
    setPersonalInfo(prev => ({
      ...prev,
      [field]: value
    }));
    
    // Update Firestore immediately for date of birth
    if (field === 'dateOfBirth') {
      handleUpdateVisitor(field, value);
    }
    // Only update address through debounce
    if (field === 'address') {
      handleUpdateVisitor(field, value);
    }
  };

  const handleRemoveNoteTagFilter = (tagToRemove) => {
    setActiveNoteTags(activeNoteTags.filter(tag => tag !== tagToRemove));
  };

  const handleInputBlur = async (field, value) => {
    if (!id || !visitorId) return;
  
    try {
      const visitorRef = doc(db, "visitors", id, "visitors", visitorId);
      await updateDoc(visitorRef, {
        [field]: value,
        lastUpdated: new Date().toISOString(),
        updatedBy: user?.email || 'unknown'
      });
    } catch (error) {
      console.error(`Error updating ${field}:`, error);
      toast.error(`Failed to update ${field}`);
    }
  };

  const handlePhoneChange = async (value) => {
    const cleaned = cleanPhoneNumber(value);
    if (cleaned.length > 10) return;

    try {
      const visitorRef = doc(db, "visitors", id, "visitors", visitorId);
      await updateDoc(visitorRef, {
        phone: cleaned
      });
      setVisitorData(prev => ({
        ...prev,
        phone: cleaned
      }));
    } catch (error) {
      console.error("Error updating phone:", error);
      showToast("Failed to update phone number", "error");
    }
  };

  const handleCreateUserAccount = async () => {
    if (!visitorData.email || !visitorData.lastName || !visitorData.phone) {
      showToast("Email, last name and phone number are required to create an account", "error");
      return;
    }

    if (visitorData.phone.length < 4) {
      showToast("Phone number must be at least 4 digits", "error");
      return;
    }
  
    setIsCreatingUser(true);
    const last4Phone = visitorData.phone.slice(-4);
    const password = `${visitorData.lastName}${last4Phone}`;
    let newUserId;
  
    try {
      const auth = getAuth();
      const currentUser = auth.currentUser;

      const userCredential = await createUserWithEmailAndPassword(
        auth,
        visitorData.email,
        password
      );
  
      newUserId = userCredential.user.uid;
      
      showToast(`Account created successfully! Password is: ${visitorData.lastName}${last4Phone}`, "success");

      if (currentUser) {
        await auth.updateCurrentUser(currentUser);
      }

      // Migrate message history if it exists
      try {
        const messagesRef = collection(db, `churches/${id}/visitorMessages`);
        const q = query(messagesRef, where('visitorId', '==', visitorId));
        const messagesSnapshot = await getDocs(q);
        
        if (!messagesSnapshot.empty) {
          const batch = writeBatch(db);
          
          // Copy each visitor message to the member messages collection
          messagesSnapshot.forEach(doc => {
            const messageData = doc.data();
            const memberMessageRef = doc(collection(db, `churches/${id}/messages`));
            
            batch.set(memberMessageRef, {
              ...messageData,
              memberId: newUserId,
              visitorId: messageData.visitorId,
              migratedFromVisitor: true,
              migrationDate: new Date().toISOString()
            });
          });
          
          await batch.commit();
        }
      } catch (error) {
        console.error("Error migrating messages:", error);
        // Continue with user creation even if message migration fails
      }

      // Format all the visitor data for transfer
      const visitorDataToTransfer = {
        // Basic info
        email: visitorData.email,
        name: visitorData.name,
        lastName: visitorData.lastName,
        phone: visitorData.phone,
        
        // Personal info - ensure proper date format
        dateOfBirth: visitorData.dateOfBirth ? new Date(visitorData.dateOfBirth).toISOString().split('T')[0] : '',
        gender: visitorData.gender || '',
        maritalStatus: visitorData.maritalStatus || '',
        
        // Address info (preserving all fields)
        address: {
          street: visitorData.address?.street || '',
          city: visitorData.address?.city || '',
          state: visitorData.address?.state || '',
          zipCode: visitorData.address?.zipCode || '',
          country: visitorData.address?.country || ''
        },
        
        // Additional info (preserving arrays)
        Nationality: Array.isArray(visitorData.Nationality) ? [...visitorData.Nationality] : [],
        Profession: Array.isArray(visitorData.Profession) ? [...visitorData.Profession] : [],
        language: Array.isArray(visitorData.language) ? [...visitorData.language] : [],
        skill: Array.isArray(visitorData.skill) ? [...visitorData.skill] : [],
        notes: Array.isArray(visitorData.notes) ? visitorData.notes.map(note => ({
          ...note,
          tasks: Array.isArray(note.tasks) ? [...note.tasks] : []
        })) : [],
        tags: Array.isArray(visitorData.tags) ? [...visitorData.tags] : [],
        
        // Timestamps and metadata
        createdAt: visitorData.createdAt,
        role: 'member',
        churchId: id,
        
        // Migration details
        migrationDetails: {
          migratedFrom: 'visitor',
          migrationDate: new Date().toISOString(),
          migratedBy: user.email,
          originalVisitorId: visitorId,
          originalCreationDate: visitorData.createdAt,
          originalTags: visitorData.tags || [],
          originalNotes: visitorData.notes || [],
          hasMessageHistory: true,
          originalCustomFields: Object.entries(visitorData)
            .filter(([key, value]) => 
              !['email', 'name', 'lastName', 'phone', 'address', 'notes', 'tags', 'createdAt'].includes(key) &&
              value !== null &&
              value !== undefined
            )
            .reduce((obj, [key, value]) => ({ ...obj, [key]: value }), {})
        }
      };

      // Add user to users collection with ALL visitor's data
      const userRef = doc(db, "users", newUserId);
      await setDoc(userRef, visitorDataToTransfer);
  
      // Update visitor record with migration status
      const visitorRef = doc(db, "visitors", id, "visitors", visitorId);
      await updateDoc(visitorRef, {
        hasUserAccount: true,
        userAccountCreatedAt: new Date().toISOString(),
        migratedToUserId: newUserId,
        status: 'migrated',
        migrationDetails: {
          migratedToUserId: newUserId,
          migratedBy: user.email,
          migrationDate: new Date().toISOString(),
          preservedData: true
        }
      });
  
      // Update local state
      setVisitorData(prev => ({
        ...prev,
        hasUserAccount: true,
        userAccountCreatedAt: new Date().toISOString(),
        migratedToUserId: newUserId,
        status: 'migrated'
      }));
  
      // Navigate to the new member profile
      navigate(`/church/${id}/member/${newUserId}`);
  
    } catch (error) {
      console.error("Error creating user:", error);
      showToast(error.message, "error");
    } finally {
      setIsCreatingUser(false);
    }
  };

  const handleConfirmMigration = () => {
    handleCreateUserAccount();
    setShowMigrationModal(false);
  };

  const handleInputChange = (field, value) => {
    setVisitorData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleCreateOption = async (field, inputValue) => {
    try {
      // Update local state first
      const updatedData = {
        ...visitorData,
        [field]: [...(visitorData[field] || []), inputValue]
      };
      setVisitorData(updatedData);
      
      // Update in database
      const visitorRef = doc(db, "visitors", id, "visitors", visitorId);
      await updateDoc(visitorRef, { [field]: updatedData[field] });
      
      showToast(`Added new ${field}: ${inputValue}`, "success");
      return inputValue;
    } catch (error) {
      console.error(`Error adding new ${field}:`, error);
      showToast(`Failed to add new ${field}`, "error");
      return null;
    }
  };

  const handleStateChange = (selectedState) => {
    const newAddress = {
      ...personalInfo.address,
      state: selectedState.value,
      city: '' // Reset city when state changes
    };
    
    setPersonalInfo(prev => ({
      ...prev,
      address: newAddress
    }));
    
    handleUpdateVisitor('address', newAddress);
    
    // Update city options based on selected state
    const cities = majorCities[selectedState.value] || [];
    setCityOptions(cities.map(city => ({ value: city, label: city })));
  };

  const handlePostalCodeChange = (value) => {
    const country = personalInfo.address?.country || 'US';
    const formatted = formatPostalCode(value, country);
    
    const newAddress = {
      ...personalInfo.address,
      zipCode: formatted
    };
    
    setPersonalInfo(prev => ({
      ...prev,
      address: newAddress
    }));
    
    handleUpdateVisitor('address', newAddress);
  };

  const renderNotes = () => {
    return filteredNotes.map((note, index) => (
      <div key={index} className="note-item">
        <div className="note-header">
          <span className="note-serial">#{visitorData.notes.length - index}</span>
          <div className="note-actions">
            {editingNoteId === index ? (
              <>
                <button className="action-btn save" onClick={() => handleSaveNote(index)}>
                  <FaSave />
                </button>
                <button className="action-btn cancel" onClick={() => setEditingNoteId(null)}>
                  <FaTimes />
                </button>
              </>
            ) : (
              <>
                <button className="action-btn edit" onClick={() => handleEditNote(index)}>
                  <FaEdit />
                </button>
                <button className="action-btn delete" onClick={() => handleRemoveNote(note)}>
                  <FaTrash />
                </button>
              </>
            )}
          </div>
        </div>
        <div className="note-content">
          {editingNoteId === index ? (
            <>
              <textarea
                value={editedNote}
                onChange={(e) => setEditedNote(e.target.value)}
                className="edit-note-input"
              />
              <div className="note-tags-section">
                <div className="tag-input-container">
                  <input
                    type="text"
                    value={newNoteTag}
                    onChange={(e) => setNewNoteTag(e.target.value)}
                    placeholder="Add a tag"
                    className="tag-input"
                  />
                  <button onClick={handleAddNoteTag} className="add-tag-btn">
                    Add Tag
                  </button>
                </div>
                <div className="available-tags">
                  {availableTags.map((tag) => (
                    <span
                      key={tag}
                      onClick={() => handleSelectExistingTag(tag)}
                      className={`suggested-tag ${selectedNoteTags.includes(tag) ? 'selected' : ''}`}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                {selectedNoteTags.length > 0 && (
                  <div className="selected-tags">
                    {selectedNoteTags.map((tag) => (
                      <span key={tag} className="selected-tag">
                        {tag}
                        <button onClick={() => handleRemoveNoteTag(tag)} className="remove-tag-btn">
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <p>{note.text}</p>
              {/* Add tasks section */}
              <div className="note-tasks">
                <h5>Tasks</h5>
                {note.tasks && note.tasks.map(task => (
                  <div key={task.id} className="task-item">
                    <input
                      type="checkbox"
                      checked={task.completed}
                      onChange={() => handleToggleTask(index, task.id)}
                    />
                    <span className={task.completed ? 'completed' : ''}>
                      {task.text}
                    </span>
                    {task.completed && (
                      <span className="completed-at">
                        ✓ {new Date(task.completedAt).toLocaleDateString()}
                      </span>
                    )}
                    <div className="task-actions">
                      <button 
                        className="task-action-btn edit"
                        onClick={() => handleEditTask(index, task.id)}
                      >
                        <FaEdit size={12} />
                      </button>
                      <button 
                        className="task-action-btn delete"
                        onClick={() => handleDeleteTask(index, task.id)}
                      >
                        <FaTrash size={12} />
                      </button>
                    </div>
                  </div>
                ))}
                <div className="add-task">
                  <input
                    type="text"
                    placeholder="Add a new task..."
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && e.target.value.trim()) {
                        handleAddTask(index, e.target.value.trim());
                        e.target.value = '';
                      }
                    }}
                  />
                </div>
              </div>
              {/* Existing tags section */}
              {note.tags && note.tags.length > 0 && (
                <div className="note-tags">
                  {note.tags.map((tag, tagIndex) => (
                    <span key={tagIndex} className="tag">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div className="note-meta">
          <span>Added by {note.addedBy}</span>
          <span>{new Date(note.timestamp).toLocaleString()}</span>
        </div>
      </div>
    ));
  };

  const renderVisitorStatus = () => {
    if (visitorData.hasUserAccount) {
      return (
        <div className="transfer-status">
          <span className="status-badge transferred">
            ✓ Transferred to Member Account
          </span>
          <div className="transfer-details">
            <p>Transferred on: {new Date(visitorData.userAccountCreatedAt).toLocaleDateString()}</p>
            <button
              onClick={() => navigate(`/church/${id}/member/${visitorData.migratedToUserId}`)}
              className="view-member-btn"
            >
              View Member Profile
            </button>
          </div>
        </div>
      );
    }
    return null;
  };

  const renderNotesSection = () => {
    if (visitorData.hasUserAccount) {
      return (
        <div className="visitor-notes-section">
          <div className="notes-migration-message">
            <p>This visitor has been migrated to a member account.</p>
            <p>All notes have been transferred to the member profile.</p>
            <button
              onClick={() => navigate(`/church/${id}/member/${visitorData.migratedToUserId}`)}
              className="view-member-notes-btn"
            >
              View Notes in Member Profile
            </button>
          </div>
          <div className="notes-list readonly">
            {renderNotes()}
          </div>
        </div>
      );
    }

    return (
      <div className="visitor-notes-section">
        <div className="notes-header">
          <h4>Notes</h4>
          <div className="notes-actions">
            <div className="note-filter-container">
              <input
                type="text"
                value={noteTagFilter}
                onChange={(e) => setNoteTagFilter(e.target.value)}
                placeholder="Search notes by tag..."
                className="note-filter-input"
              />
              {noteTagFilter && (
                <button
                  onClick={() => setNoteTagFilter("")}
                  className="clear-filter-btn"
                >
                  ×
                </button>
              )}
            </div>
            <button
              className="add-note-btn"
              onClick={() => setShowNoteInput(!showNoteInput)}
            >
              {showNoteInput ? "Cancel" : "Add Note"}
            </button>
          </div>
        </div>

        {activeNoteTags.length > 0 && (
          <div className="active-note-filters">
            <span>Filtering by: </span>
            {activeNoteTags.map((tag) => (
              <span key={tag} className="active-filter-tag">
                {tag}
                <button
                  onClick={() => handleRemoveNoteTagFilter(tag)}
                  className="remove-filter-tag"
                >
                  ×
                </button>
              </span>
            ))}
            <button
              onClick={() => setActiveNoteTags([])}
              className="clear-filters-btn"
            >
              Clear all filters
            </button>
          </div>
        )}

        {showNoteInput && (
          <div className="note-input-container">
            <textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Enter your note here..."
              className="note-input"
            />
            <div className="note-tags-section">
              <div className="tag-input-container">
                <input
                  type="text"
                  value={newNoteTag}
                  onChange={(e) => setNewNoteTag(e.target.value)}
                  placeholder="Add a tag"
                  className="tag-input"
                />
                <button onClick={handleAddNoteTag} className="add-tag-btn">
                  Add Tag
                </button>
              </div>
              {selectedNoteTags.length > 0 && (
                <div className="selected-tags">
                  {selectedNoteTags.map((tag) => (
                    <span key={tag} className="selected-tag">
                      {tag}
                      <button onClick={() => handleRemoveNoteTag(tag)} className="remove-tag-btn">
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button className="submit-note-btn" onClick={handleAddNote}>
              Add Note
            </button>
          </div>
        )}

        <div className="notes-list">
          {filteredNotes.length > 0 ? (
            renderNotes()
          ) : (
            <p className="no-notes">
              {visitorData?.notes?.length > 0 
                ? "No notes match the selected filters" 
                : "No notes available"}
            </p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="page-container">
      <button
        onClick={() => handleBackClick(id)}
        style={{ ...commonStyles.backButtonLink }}
      >
        ← Back to admin
      </button>
      <ChurchHeader id={id} />
      <div className="content-box">
        <h2 className="bottom-border">Visitor Details</h2>
        <div>
          {loading ? (
            <div className="loading-spinner">Loading...</div>
          ) : visitorData ? (
            <div className="visitor-details-container">
              <div className="cards-container">
                <div className="visitor-card">
                  <div className="visitor-profile">
                    <div className="visitor-avatar">
                      {visitorData.name && visitorData.lastName
                        ? `${visitorData.name[0]}${visitorData.lastName[0]}`
                        : "V"}
                    </div>
                    <div className="visitor-main-info">
                      {isEditing ? (
                        <div className="edit-fields">
                          <div className="edit-field">
                            <label>Name:</label>
                            <input
                              type="text"
                              value={visitorData.name || ''}
                              onChange={(e) => handleInputChange('name', e.target.value)}
                              onBlur={(e) => handleInputBlur('name', e.target.value)}
                              className="text-input"
                              placeholder="Enter name"
                            />
                          </div>
                          <div className="edit-field">
                            <label>Last Name:</label>
                            <input
                              type="text"
                              value={visitorData.lastName || ''}
                              onChange={(e) => handleInputChange('lastName', e.target.value)}
                              onBlur={(e) => handleInputBlur('lastName', e.target.value)}
                              className="text-input"
                              placeholder="Enter last name"
                            />
                          </div>
                          <div className="edit-field">
                            <label>Email:</label>
                            <input
                              type="email"
                              value={visitorData.email || ''}
                              onChange={(e) => handleInputChange('email', e.target.value)}
                              onBlur={(e) => handleInputBlur('email', e.target.value)}
                              className="text-input"
                              placeholder="Enter email"
                            />
                          </div>
                        </div>
                      ) : (
                        <>
                          <h3>{visitorData.name} {visitorData.lastName}</h3>
                          {visitorData.email && (
                            <div className="info-item">
                              <i className="fas fa-envelope"></i>
                              <span>{visitorData.email}</span>
                            </div>
                          )}
                        </>
                      )}
                      <div className="contact-info">
                        <div className="info-item">
                          <FaPhoneAlt />
                          {isEditing ? (
                            <input
                              type="tel"
                              value={formatPhoneNumber(visitorData.phone)}
                              onChange={(e) => handlePhoneChange(e.target.value)}
                              placeholder="(123) 456-7890"
                              className="phone-input"
                              maxLength={14}
                            />
                          ) : (
                            <span>{formatPhoneNumber(visitorData.phone) || "No phone provided"}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  {renderVisitorStatus()}
                </div>

                {visitorData.tags && visitorData.tags.length > 0 && (
                  <div className="visitor-card">
                    <div className="visitor-tags">
                      <h4>Tags :</h4>
                      <div className="tags-container">
                        {visitorData.tags.map((item, i) => (
                          <span key={i} className="tag">
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Add Messaging Button */}
                {visitorData.phone && !visitorData.hasUserAccount && (
                  <button 
                    onClick={() => navigate(`/church/${id}/visitor/${visitorId}/messages`)} 
                    className="message-button"
                    style={{
                      backgroundColor: '#4F46E5',
                      color: 'white',
                      padding: '12px 24px',
                      borderRadius: '4px',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '14px',
                      marginTop: '16px',
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px'
                    }}
                  >
                    📱 Messaging Center
                  </button>
                )}
              </div>

              <div className="visitor-details-section">
                <div className="sobre-select">
                  <label>Nationality:</label>
                  <CreatableSelect
                    isMulti
                    isSearchable
                    name="Nationality"
                    value={
                      Array.isArray(visitorData.Nationality)
                        ? visitorData.Nationality.map((nationality) => ({
                            value: nationality,
                            label: nationality,
                          }))
                        : []
                    }
                    options={nacionalidades.map((nationality) => ({
                      value: nationality,
                      label: nationality,
                    }))}
                    onChange={(selected) => 
                      handleUpdateVisitor('Nationality', 
                        selected ? selected.map(option => option.value) : []
                      )
                    }
                    onCreateOption={(inputValue) => handleCreateOption('Nationality', inputValue)}
                    formatCreateLabel={(inputValue) => `Add new nationality: "${inputValue}"`}
                    isDisabled={!isEditing}
                  />
                </div>

                <div className="sobre-select">
                  <label>Profession:</label>
                  <CreatableSelect
                    isMulti
                    isSearchable
                    name="Profession"
                    value={
                      Array.isArray(visitorData.Profession)
                        ? visitorData.Profession.map((profession) => ({
                            value: profession,
                            label: profession,
                          }))
                        : []
                    }
                    options={ocupaciones.map((profession) => ({
                      value: profession,
                      label: profession,
                    }))}
                    onChange={(selected) => 
                      handleUpdateVisitor('Profession', 
                        selected ? selected.map(option => option.value) : []
                      )
                    }
                    onCreateOption={(inputValue) => handleCreateOption('Profession', inputValue)}
                    formatCreateLabel={(inputValue) => `Add new profession: "${inputValue}"`}
                    isDisabled={!isEditing}
                  />
                </div>

                <div className="sobre-select">
                  <label>Language:</label>
                  <CreatableSelect
                    isMulti
                    isSearchable
                    name="language"
                    value={
                      Array.isArray(visitorData.language)
                        ? visitorData.language.map((language) => ({
                            value: language,
                            label: language,
                          }))
                        : []
                    }
                    options={idiomas.map((language) => ({
                      value: language,
                      label: language,
                    }))}
                    onChange={(selected) => 
                      handleUpdateVisitor('language', 
                        selected ? selected.map(option => option.value) : []
                      )
                    }
                    onCreateOption={(inputValue) => handleCreateOption('language', inputValue)}
                    formatCreateLabel={(inputValue) => `Add new language: "${inputValue}"`}
                    isDisabled={!isEditing}
                  />
                </div>

                <div className="sobre-select">
                  <label>Skills:</label>
                  <CreatableSelect
                    isMulti
                    isSearchable
                    name="skill"
                    value={
                      Array.isArray(visitorData.skill)
                        ? visitorData.skill.map((skill) => ({
                            value: skill,
                            label: skill,
                          }))
                        : []
                    }
                    options={Object.values(habilidades)
                      .flat()
                      .map((skill) => ({ value: skill, label: skill }))}
                    onChange={(selected) => 
                      handleUpdateVisitor('skill', 
                        selected ? selected.map(option => option.value) : []
                      )
                    }
                    onCreateOption={(inputValue) => handleCreateOption('skill', inputValue)}
                    formatCreateLabel={(inputValue) => `Add new skill: "${inputValue}"`}
                    isDisabled={!isEditing}
                  />
                </div>

                <div className="personal-info-section">
                  <h3>Personal Information</h3>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Date of Birth:</label>
                      <input
                        type="date"
                        value={personalInfo.dateOfBirth}
                        onChange={(e) => handlePersonalInfoChange('dateOfBirth', e.target.value)}
                        className="form-input"
                        disabled={!isEditing}
                      />
                      {personalInfo.dateOfBirth && (
                        <span className="age-display">
                          Age: {calculateAge(personalInfo.dateOfBirth)} years
                          {new Date(personalInfo.dateOfBirth).toDateString() === new Date().toDateString() && (
                            <div className="birthday-message">
                              🎉 Happy Birthday! 🎂
                            </div>
                          )}
                        </span>
                      )}
                    </div>
                    
                    <div className="form-group">
                      <label>Gender:</label>
                      <select
                        value={personalInfo.gender}
                        onChange={(e) => handlePersonalInfoChange('gender', e.target.value)}
                        className="form-input"
                        disabled={!isEditing}
                      >
                        <option value="">Select gender</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                      </select>
                    </div>

                    <div className="form-group">
                      <label>Marital Status:</label>
                      <select
                        value={personalInfo.maritalStatus}
                        onChange={(e) => handlePersonalInfoChange('maritalStatus', e.target.value)}
                        className="form-input"
                        disabled={!isEditing}
                      >
                        <option value="">Select status</option>
                        <option value="single">Single</option>
                        <option value="married">Married</option>
                        <option value="divorced">Divorced</option>
                        <option value="widowed">Widowed</option>
                      </select>
                    </div>
                  </div>

                  <h3>Address Information</h3>
                  <div className="form-grid">
                    <div className="form-group full-width">
                      <label>Street Address:</label>
                      <input
                        type="text"
                        value={personalInfo.address.street}
                        onChange={(e) => handleUpdateVisitor('address', {
                          ...personalInfo.address,
                          street: e.target.value
                        })}
                        className="form-input"
                        disabled={!isEditing}
                      />
                    </div>
                    
                    <div className="form-group">
                      <label>City:</label>
                      <CreatableSelect
                        value={personalInfo.address.city ? 
                          { value: personalInfo.address.city, label: personalInfo.address.city } : null}
                        options={cityOptions}
                        onChange={(selected) => {
                          const newAddress = {
                            ...personalInfo.address,
                            city: selected.value
                          };
                          setPersonalInfo(prev => ({
                            ...prev,
                            address: newAddress
                          }));
                          handleUpdateVisitor('address', newAddress);
                        }}
                        className="form-input"
                        placeholder="Select or type city"
                        isDisabled={!isEditing || !personalInfo.address.state}
                        formatCreateLabel={(inputValue) => `Use "${inputValue}"`}
                      />
                    </div>

                    <div className="form-group">
                      <label>State/Province:</label>
                      <CreatableSelect
                        value={personalInfo.address.state ? 
                          { value: personalInfo.address.state, label: states.find(s => s.value === personalInfo.address.state)?.label || personalInfo.address.state } : null}
                        options={states}
                        onChange={handleStateChange}
                        className="form-input"
                        placeholder="Select or type state/province"
                        isDisabled={!isEditing}
                        formatCreateLabel={(inputValue) => `Use "${inputValue}"`}
                      />
                    </div>

                    <div className="form-group">
                      <label>Country:</label>
                      <CreatableSelect
                        value={personalInfo.address.country ? 
                          { value: personalInfo.address.country, label: countries.find(c => c.value === personalInfo.address.country)?.label || personalInfo.address.country } : null}
                        options={countries}
                        onChange={(selected) => {
                          const newAddress = {
                            ...personalInfo.address,
                            country: selected.value,
                            zipCode: '' // Reset postal code when country changes
                          };
                          setPersonalInfo(prev => ({
                            ...prev,
                            address: newAddress
                          }));
                          handleUpdateVisitor('address', newAddress);
                        }}
                        className="form-input"
                        placeholder="Select or type country"
                        isDisabled={!isEditing}
                        formatCreateLabel={(inputValue) => `Use "${inputValue}"`}
                      />
                    </div>

                    <div className="form-group">
                      <label>Postal/ZIP Code:</label>
                      <input
                        type="text"
                        value={personalInfo.address.zipCode}
                        onChange={(e) => handlePostalCodeChange(e.target.value)}
                        className={`form-input ${
                          personalInfo.address.zipCode && 
                          !validatePostalCode(personalInfo.address.zipCode, personalInfo.address.country) 
                            ? 'invalid-input' 
                            : ''
                        }`}
                        placeholder={personalInfo.address.country === 'CA' ? 'A1A 1A1' : '12345'}
                        disabled={!isEditing}
                      />
                      {personalInfo.address.zipCode && 
                      !validatePostalCode(personalInfo.address.zipCode, personalInfo.address.country) && (
                        <span className="error-text">Invalid postal code format</span>
                      )}
                    </div>
                  </div>
                </div>

                <button 
                  className="edit-button"
                  onClick={() => setIsEditing(!isEditing)}
                >
                  {isEditing ? 'Done' : 'Edit Details'}
                </button>
              </div>

              <div className="user-account-section">
  {!visitorData.hasUserAccount && (
    <button 
      className="create-user-btn primary"
      onClick={handleCreateUserAccount}
      disabled={isCreatingUser}
    >
      Migrate to Member Account
    </button>
  )}
  {visitorData.hasUserAccount && (
    <div className="user-account-info">
      <span className="user-account-badge">✓ Migrated to Member Account</span>
      <span className="user-account-date">
        Migrated on: {new Date(visitorData.userAccountCreatedAt).toLocaleDateString()}
      </span>
      <a href={`/church/${id}/member/${visitorData.migratedToUserId}`}>View Member Profile</a>
    </div>
  )}

  {showMigrationModal && (
    <div className="migration-modal">
      <div className="modal-content">
        <h3>Confirm Member Account Creation</h3>
        <div className="migration-details">
          <h4>Visitor Information</h4>
          <p>Name: {visitorData.name} {visitorData.lastName}</p>
          <p>Email: {visitorData.email}</p>
          <p>Phone: {formatPhoneNumber(visitorData.phone)}</p>
          
          <h4>Additional Information</h4>
          <ul>
            {visitorData.Nationality && <li>Nationality: {visitorData.Nationality.join(', ')}</li>}
            {visitorData.Profession && <li>Profession: {visitorData.Profession.join(', ')}</li>}
            {visitorData.language && <li>Languages: {visitorData.language.join(', ')}</li>}
            {visitorData.skill && <li>Skills: {visitorData.skill.join(', ')}</li>}
          </ul>
          <p className="note">All notes and information will be transferred to the member profile.</p>
        </div>
        <div className="modal-actions">
          <button 
            onClick={handleConfirmMigration} 
            disabled={isCreatingUser}
            className="confirm-btn"
          >
            {isCreatingUser ? 'Creating...' : 'Confirm Migration'}
          </button>
          <button
            onClick={() => setShowMigrationModal(false)}
            className="cancel-btn"
            disabled={isCreatingUser}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )}
</div>

              {renderNotesSection()}
            </div>
          ) : (
            <div className="not-found">
              <FaUserSlash />
              <p>Visitor not found</p>
            </div>
          )}
        </div>
      </div>
      <ToastContainer
        position="top-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="light"
      />
    </div>
  );
};

export default VisitorDetails;
