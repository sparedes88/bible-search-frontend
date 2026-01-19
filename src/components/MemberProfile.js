import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, collection, query, where, getDocs, orderBy, updateDoc, arrayUnion, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useAuth } from '../contexts/AuthContext';
import ChurchHeader from './ChurchHeader';
import './AdminConnect.css';
import QRCode from 'react-qr-code';
import { PDFDownloadLink } from "@react-pdf/renderer";
import QRCodeLabel from './QRCodeLabel';
import './MemberProfile.css';
import { FaEdit, FaTrash, FaCheckCircle, FaExclamationCircle, FaChartLine, FaUserCheck, FaCalendarCheck, FaTasks, FaBookOpen, FaChartPie } from 'react-icons/fa';
import Select from 'react-select';
import CreatableSelect from 'react-select/creatable';
import ocupaciones from './ocupaciones';
import nacionalidades from './nacionalidades';
import idiomas from './idiomas';
import habilidades from './habilidades';
import { states, majorCities, countries, validatePostalCode, formatPostalCode } from './data/locations';
import { findDuplicateLocation, createLocationOption } from '../utils/locationHelpers';
import { getAuth, updatePassword } from "firebase/auth";

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

const showToast = (message, type = 'info') => {
  if (!toast[type]) {
    console.warn(`Invalid toast type: ${type}`);
    type = 'info';
  }
  
  try {
    toast[type](message, {
      position: "top-right",
      autoClose: 3000,
      hideProgressBar: false,
      closeOnClick: true,
      pauseOnHover: true,
      draggable: true,
      progress: undefined,
    });
  } catch (error) {
    console.error("Toast error:", error);
    console.log(`${type.toUpperCase()}: ${message}`);
  }
};

const MemberProfile = ({ type = 'member' }) => {
  const { id, profileId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [memberData, setMemberData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checkInHistory, setCheckInHistory] = useState([]);
  const [childCareDetails, setChildCareDetails] = useState([]);
  const [church, setChurch] = useState(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 480);
  const [categoriesHistory, setCategoriesHistory] = useState([]);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editedMemberData, setEditedMemberData] = useState(null);
  const [allSubcategories, setAllSubcategories] = useState([]);
  const [assigningStates, setAssigningStates] = useState({});
  const [assigningCategory, setAssigningCategory] = useState({});
  const [cityOptions, setCityOptions] = useState([]);
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    newPassword: '',
    confirmPassword: ''
  });
  const [passwordError, setPasswordError] = useState('');
  const [upcomingEvents, setUpcomingEvents] = useState([]);
  const [registrationLoading, setRegistrationLoading] = useState(false);
  const [courseData, setCourseData] = useState([]);
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [eventsMap, setEventsMap] = useState({});

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 480);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const fetchChurchData = async () => {
      try {
        const churchDoc = await getDoc(doc(db, 'churches', id));
        if (churchDoc.exists()) {
          setChurch(churchDoc.data());
        }
      } catch (error) {
        console.error('Error fetching church:', error);
      }
    };

    fetchChurchData();
  }, [id]);

  const fetchAllMemberData = async () => {
    if (!profileId) return;
    
    try {
      setLoading(true);
      
      const userDoc = await getDoc(doc(db, 'users', profileId));
      if (!userDoc.exists()) {
        toast.error('Member not found');
        navigate(`/church/${id}/admin-connect`);
        return;
      }

      const userData = userDoc.data();
      
      let allNotes = [];
      
      console.log('User data loaded:', userData);
      
      if (userData.notes && Array.isArray(userData.notes)) {
        console.log('Regular notes found:', userData.notes.length);
        allNotes = [...userData.notes];
      } else {
        console.log('No regular notes found or notes is not an array');
        userData.notes = [];
      }

      if (userData.migrationDetails?.notes && Array.isArray(userData.migrationDetails.notes)) {
        console.log('Migrated notes found:', userData.migrationDetails.notes.length);
        const migratedNotes = userData.migrationDetails.notes.map(note => ({
          ...note,
          isMigratedNote: true,
          timestamp: note.timestamp || userData.migrationDetails.migrationDate,
          tasks: note.tasks || []
        }));
        allNotes = [...allNotes, ...migratedNotes];
      }

      allNotes = allNotes.map(note => ({
        id: note.id || `note-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        text: note.text || '',
        timestamp: note.timestamp || new Date().toISOString(),
        addedBy: note.addedBy || 'Unknown',
        tasks: Array.isArray(note.tasks) ? note.tasks : [],
        isMigratedNote: note.isMigratedNote || false
      }));

      console.log('Total notes after processing:', allNotes.length);

      allNotes.sort((a, b) => {
        const dateA = new Date(a.timestamp);
        const dateB = new Date(b.timestamp);
        return dateB - dateA;
      });

      const completionMap = {};
      userData?.completionLogs?.forEach(log => {
        completionMap[log.subcategoryId] = {
          completed: true,
          completedAt: log.completedAt,
          completedAtFormatted: log.completedAtFormatted || new Date(log.completedAt).toLocaleString(),
          note: log.note
        };
      });

      const courseCategoriesRef = collection(db, 'coursecategories');
      const courseCategoriesQuery = query(courseCategoriesRef, where('churchId', '==', id));
      const courseCategoriesSnap = await getDocs(courseCategoriesQuery);
      const allCategories = courseCategoriesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      const assignedCategories = [];

      allCategories.forEach(category => {
        const assignedSubs = [];

        (category.subcategories || []).forEach(sub => {
          const isAssigned = sub.assignedUsers?.some(u => u.value === profileId);
          const isCompleted = completionMap[sub.id];

          if (isAssigned) {
            assignedSubs.push({
              ...sub,
              isAssigned: true,
              isCompleted: !!isCompleted,
              completedAt: isCompleted?.completedAt,
              completedAtFormatted: isCompleted?.completedAtFormatted,
              completionNote: isCompleted?.note
            });
          }
        });

        if (assignedSubs.length > 0) {
          assignedCategories.push({
            ...category,
            subcategories: assignedSubs
          });
        }
      });

      setCategoriesHistory(assignedCategories);
      setMemberData({
        ...userData,
        id: userDoc.id,
        allNotes: allNotes,
        createdAt: userData.createdAt?.toDate?.()?.toLocaleString() || 'N/A'
      });

      setLoading(false);
    } catch (error) {
      console.error('Error fetching member data:', error);
      toast.error('Failed to load member data');
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllMemberData();
  }, [profileId, id, navigate]);

  useEffect(() => {
    if (memberData) {
      setEditedMemberData({
        ...memberData,
        dateOfBirth: memberData.dateOfBirth || '',
        gender: memberData.gender || '',
        maritalStatus: memberData.maritalStatus || '',
        address: memberData.address || {
          street: '',
          city: '',
          state: '',
          zipCode: '',
          country: ''
        }
      });
    }
  }, [memberData]);

  useEffect(() => {
    if (id && profileId) {
      fetchCourseDataWithEvents();
      fetchUpcomingEvents();
    }
  }, [id, profileId]);

  const fetchCourseDataWithEvents = async () => {
    try {
      setLoadingCourses(true);
      
      const categoriesRef = collection(db, 'coursecategories');
      const categoriesQuery = query(categoriesRef, where('churchId', '==', id));
      const categoriesSnapshot = await getDocs(categoriesQuery);
      const categoriesData = categoriesSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      const eventsRef = collection(db, 'eventInstances');
      const eventsQuery = query(eventsRef, where('churchId', '==', id));
      const eventsSnapshot = await getDocs(eventsQuery);
      const eventsData = eventsSnapshot.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data(),
          title: doc.data().instanceTitle || doc.data().title
        }))
        .filter(event => !event.removed && !event.isDeleted);
      
      const eventsBySubcategory = {};
      eventsData.forEach(event => {
        if (event.subcategoryId) {
          if (!eventsBySubcategory[event.subcategoryId]) {
            eventsBySubcategory[event.subcategoryId] = [];
          }
          eventsBySubcategory[event.subcategoryId].push(event);
        }
      });
      
      setEventsMap(eventsBySubcategory);
      
      const userRef = doc(db, 'users', profileId);
      const userDoc = await getDoc(userRef);
      const userData = userDoc.data();
      
      const completionMap = {};
      userData?.completionLogs?.forEach(log => {
        completionMap[log.subcategoryId] = {
          completed: true,
          completedAt: log.completedAt,
          completedAtFormatted: log.completedAtFormatted || new Date(log.completedAt).toLocaleString(),
          note: log.note
        };
      });
      
      const eventProgressMap = {};
      if (userData?.courseCompletions) {
        userData.courseCompletions.forEach(completion => {
          if (completion.eventId) {
            eventProgressMap[completion.eventId] = {
              status: completion.status || 'in-progress',
              completedAt: completion.completedAt,
              startedAt: completion.startedAt,
              instructorName: completion.instructorName
            };
          }
        });
      }
      
      const processedData = categoriesData.map(category => {
        const subcategories = (category.subcategories || []).map(sub => {
          const isAssigned = sub.assignedUsers?.some(u => u.value === profileId);
          const isCompleted = completionMap[sub.id] || false;
          const relatedEvents = eventsBySubcategory[sub.id] || [];
          
          const eventsWithProgress = relatedEvents.map(event => ({
            ...event,
            progressStatus: eventProgressMap[event.id] || null
          }));

          const uniqueEvents = eventsWithProgress.filter((event, index, self) =>
            index === self.findIndex(e => e.order === event.order)
          );

          const completionPercentage = uniqueEvents.length > 0
            ? Math.round((uniqueEvents.filter(event => event.progressStatus?.status === 'completed').length / uniqueEvents.length) * 100)
            : 0;
          
          return {
            ...sub,
            isAssigned,
            isCompleted,
            completedAt: isCompleted.completedAt,
            completedAtFormatted: isCompleted.completedAtFormatted,
            completionNote: isCompleted.note,
            relatedEvents: uniqueEvents,
            required: sub.required === true,
            completionPercentage
          };
        });
        
        return {
          ...category,
          subcategories
        };
      });
      
      setCourseData(processedData);
      setLoadingCourses(false);
    } catch (error) {
      console.error('Error fetching course data:', error);
      toast.error('Failed to load course data');
      setLoadingCourses(false);
    }
  };

  const fetchUpcomingEvents = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      const eventsRef = collection(db, 'eventInstances');
      const eventsQuery = query(
        eventsRef, 
        where('churchId', '==', id),
        where('startDate', '>=', today)
      );
      const eventsSnapshot = await getDocs(eventsQuery);
      
      const registrationsRef = collection(db, 'eventRegistrations');
      const registrationsQuery = query(
        registrationsRef,
        where('memberId', '==', profileId)
      );
      const registrationsSnapshot = await getDocs(registrationsQuery);
      
      const registeredEvents = {};
      registrationsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        let registeredAt = 'N/A';
        try {
          if (data.registeredAt) {
            registeredAt = data.registeredAt.toDate ? 
              data.registeredAt.toDate().toLocaleString() : 
              new Date(data.registeredAt).toLocaleString();
          }
        } catch (err) {
          console.warn("Could not format timestamp", err);
        }
        
        registeredEvents[data.eventId] = {
          id: doc.id,
          ...data,
          registeredAt
        };
      });
      
      const events = eventsSnapshot.docs
        .map(doc => {
          const eventData = doc.data();
          return {
            id: doc.id,
            name: eventData.title || eventData.instanceTitle,
            date: eventData.startDate,
            location: eventData.location || 'TBD',
            isRegistered: !!registeredEvents[doc.id],
            registrationDetails: registeredEvents[doc.id] || null
          };
        })
        .filter(event => !event.removed && !event.isDeleted)
        .sort((a, b) => {
          return a.date.localeCompare(b.date);
        });
        
      setUpcomingEvents(events);
    } catch (error) {
      console.error('Error fetching upcoming events:', error);
      console.error('Failed to load upcoming events');
    }
  };

  const handleAddTask = async (noteIndex, taskText) => {
    try {
      const updatedNotes = [...memberData.allNotes];
      const note = updatedNotes[noteIndex];
      
      const newTask = {
        id: Date.now().toString(),
        text: taskText,
        completed: false,
        createdAt: new Date().toISOString(),
        createdBy: user.email
      };

      if (!note.tasks) {
        note.tasks = [];
      }
      
      note.tasks.push(newTask);

      const userRef = doc(db, 'users', profileId);
      await updateDoc(userRef, { notes: updatedNotes });
      
      setMemberData(prev => ({ ...prev, allNotes: updatedNotes }));
      showToast("Task added successfully!", "success");
    } catch (error) {
      console.error("Error adding task:", error);
      showToast("Failed to add task", "error");
    }
  };

  const handleToggleTask = async (noteIndex, taskId) => {
    try {
      const updatedNotes = [...memberData.allNotes];
      const note = updatedNotes[noteIndex];
      const taskIndex = note.tasks?.findIndex(task => task.id === taskId);
      
      if (taskIndex !== -1) {
        note.tasks[taskIndex].completed = !note.tasks[taskIndex].completed;
        note.tasks[taskIndex].completedAt = note.tasks[taskIndex].completed ? new Date().toISOString() : null;
        note.tasks[taskIndex].completedBy = note.tasks[taskIndex].completed ? user.email : null;
      }

      const userRef = doc(db, 'users', profileId);
      await updateDoc(userRef, { notes: updatedNotes });
      
      setMemberData(prev => ({ ...prev, allNotes: updatedNotes }));
    } catch (error) {
      console.error("Error toggling task:", error);
      showToast("Failed to update task", "error");
    }
  };

  const handleEditTask = async (noteIndex, taskId) => {
    try {
      const updatedNotes = [...memberData.allNotes];
      const note = updatedNotes[noteIndex];
      const taskIndex = note.tasks?.findIndex(task => task.id === taskId);
      
      if (taskIndex !== -1) {
        const newText = prompt('Edit task:', note.tasks[taskIndex].text);
        if (newText && newText.trim()) {
          note.tasks[taskIndex] = {
            ...note.tasks[taskIndex],
            text: newText.trim(),
            editedAt: new Date().toISOString(),
            editedBy: user.email
          };

          const userRef = doc(db, 'users', profileId);
          await updateDoc(userRef, { notes: updatedNotes });
          
          setMemberData(prev => ({ ...prev, allNotes: updatedNotes }));
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
      const updatedNotes = [...memberData.allNotes];
      const note = updatedNotes[noteIndex];
      note.tasks = note.tasks.filter(task => task.id !== taskId);

      const userRef = doc(db, 'users', profileId);
      await updateDoc(userRef, { notes: updatedNotes });
      
      setMemberData(prev => ({ ...prev, allNotes: updatedNotes }));
      showToast("Task deleted successfully!", "success");
    } catch (error) {
      console.error("Error deleting task:", error);
      showToast("Failed to delete task", "error");
    }
  };

  const handleAddNote = async (text) => {
    try {
      const newNote = {
        id: `note-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        text,
        timestamp: new Date().toISOString(),
        addedBy: user.email,
        tasks: []
      };

      // First get the current notes array from the user document
      const userRef = doc(db, 'users', profileId);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) {
        toast.error("User document not found");
        return;
      }
      
      const userData = userDoc.data();
      
      // Create the array of all notes to update in Firestore
      let updatedNotes = [];
      
      if (userData.notes && Array.isArray(userData.notes)) {
        // Add the new note to the beginning of the existing notes array
        updatedNotes = [newNote, ...userData.notes];
      } else {
        // If notes doesn't exist or isn't an array, create a new array with just the new note
        updatedNotes = [newNote];
      }
      
      // Update the document with the new notes array
      await updateDoc(userRef, { notes: updatedNotes });
      
      // Fetch all member data again to refresh the UI with the updated notes
      await fetchAllMemberData();

      toast.success("Note added successfully!");
    } catch (error) {
      console.error("Error adding note:", error);
      toast.error("Failed to add note");
    }
  };

  const handleEditProfile = () => {
    setEditedMemberData({...memberData});
    setIsEditingProfile(true);
  };

  const handlePersonalInfoChange = (field, value) => {
    if (field === 'dateOfBirth' && value) {
      value = new Date(value).toISOString().split('T')[0];
    }
    
    setEditedMemberData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSaveProfile = async () => {
    try {
      const dataToUpdate = {
        ...editedMemberData,
        dateOfBirth: editedMemberData.dateOfBirth ? 
          new Date(editedMemberData.dateOfBirth).toISOString().split('T')[0] : null,
        gender: editedMemberData.gender || '',
        maritalStatus: editedMemberData.maritalStatus || '',
        address: editedMemberData.address || {
          street: '',
          city: '',
          state: '',
          zipCode: '',
          country: ''
        }
      };

      const userRef = doc(db, 'users', profileId);
      await updateDoc(userRef, dataToUpdate);
      setMemberData(dataToUpdate);
      setIsEditingProfile(false);
      toast.success("Profile updated successfully!");
    } catch (error) {
      console.error("Error updating profile:", error);
      toast.error("Failed to update profile");
    }
  };

  const handlePhoneChange = async (e) => {
    const value = e.target.value;
    const cleaned = cleanPhoneNumber(value);
    if (cleaned.length > 10) return;

    setEditedMemberData(prev => ({
      ...prev,
      phone: cleaned
    }));
  };

  const updateUserAssignments = async (userId, categoryId, subcategoryId, isAssigned) => {
    try {
      const userRef = doc(db, 'users', userId);
      const userDoc = await getDoc(userRef);
      const userData = userDoc.data();
      
      let updatedAssignments = userData.courseAssignments || [];

      if (isAssigned) {
        updatedAssignments = updatedAssignments.filter(
          assignment => !(assignment.categoryId === categoryId && assignment.subcategoryId === subcategoryId)
        );
      } else {
        updatedAssignments.push({
          categoryId,
          subcategoryId,
          assignedAt: new Date().toISOString(),
          assignedBy: user.email,
          status: 'assigned',
        });
      }

      await updateDoc(userRef, {
        courseAssignments: updatedAssignments
      });
    } catch (error) {
      console.error('Error updating user assignments:', error);
      throw error;
    }
  };

  const handleAssignmentToggle = async (categoryId, subcategoryId, isAssigned) => {
    try {
      setAssigningStates(prev => ({ ...prev, [subcategoryId]: true }));
      
      const categoryRef = doc(db, 'coursecategories', categoryId);
      const categoryDoc = await getDoc(categoryRef);
      
      if (!categoryDoc.exists()) {
        throw new Error('Category not found');
      }

      const category = categoryDoc.data();
      const updatedSubcategories = category.subcategories.map(sub => {
        if (sub.id === subcategoryId) {
          const updatedAssignedUsers = isAssigned
            ? (sub.assignedUsers || []).filter(u => u.value !== profileId)
            : [...(sub.assignedUsers || []), { 
                value: profileId, 
                label: `${memberData.name} ${memberData.lastName}` 
              }];
          
          return { ...sub, assignedUsers: updatedAssignedUsers };
        }
        return sub;
      });

      await Promise.all([
        updateDoc(categoryRef, { subcategories: updatedSubcategories }),
        updateUserAssignments(profileId, categoryId, subcategoryId, isAssigned)
      ]);

      await fetchAllMemberData();
      toast.success(isAssigned ? 'Unassigned successfully' : 'Assigned successfully');
    } catch (error) {
      console.error('Error toggling assignment:', error);
      toast.error('Failed to update assignment');
    } finally {
      setAssigningStates(prev => ({ ...prev, [subcategoryId]: false }));
    }
  };

  const handleAssignCategory = async (categoryId, subcategories) => {
    try {
      setAssigningCategory(prev => ({ ...prev, [categoryId]: true }));
      
      const categoryRef = doc(db, 'coursecategories', categoryId);
      const categoryDoc = await getDoc(categoryRef);
      
      if (!categoryDoc.exists()) {
        throw new Error('Category not found');
      }

      const category = categoryDoc.data();
      const updatedSubcategories = category.subcategories.map(sub => ({
        ...sub,
        assignedUsers: [...(sub.assignedUsers || []), { 
          value: profileId, 
          label: `${memberData.name} ${memberData.lastName}` 
        }]
      }));

      const userRef = doc(db, 'users', profileId);
      const newAssignments = subcategories.map(sub => ({
        categoryId,
        subcategoryId: sub.id,
        assignedAt: new Date().toISOString(),
        assignedBy: user.email,
        status: 'assigned',
      }));

      await Promise.all([
        updateDoc(categoryRef, { subcategories: updatedSubcategories }),
        updateDoc(userRef, {
          courseAssignments: arrayUnion(...newAssignments)
        })
      ]);

      await fetchAllMemberData();
      toast.success('Category assigned successfully');
    } catch (error) {
      console.error('Error assigning category:', error);
      toast.error('Failed to assign category');
    } finally {
      setAssigningCategory(prev => ({ ...prev, [categoryId]: false }));
    }
  };

  const handleCreateOption = async (field, inputValue) => {
    try {
      const updatedData = {
        ...editedMemberData,
        [field]: [...(editedMemberData[field] || []), inputValue]
      };
      setEditedMemberData(updatedData);
      
      const userRef = doc(db, 'users', profileId);
      await updateDoc(userRef, { [field]: updatedData[field] });
      
      showToast(`Added new ${field}: ${inputValue}`, "success");
      return inputValue;
    } catch (error) {
      console.error(`Error adding new ${field}:`, error);
      showToast(`Failed to add new ${field}`, "error");
      return null;
    }
  };

  const handleStateChange = (selectedOption) => {
    const stateValue = selectedOption.value;
    
    setEditedMemberData({
      ...editedMemberData,
      address: { 
        ...editedMemberData.address,
        state: stateValue,
        city: '' 
      }
    });
    
    const cities = majorCities[stateValue] || [];
    setCityOptions(cities.map(city => ({ value: city, label: city })));
  };

  const handleStateCreate = (inputValue) => {
    const duplicate = findDuplicateLocation(inputValue, states);
    if (duplicate) {
      toast.info(`Using existing state: ${duplicate.label}`);
      handleStateChange(duplicate);
      return;
    }

    const newState = createLocationOption(inputValue);
    
    const stateOption = { value: newState.value, label: newState.label };
    handleStateChange(stateOption);
  };

  const handleCityCreate = (inputValue) => {
    const duplicate = findDuplicateLocation(inputValue, cityOptions);
    if (duplicate) {
      toast.info(`Using existing city: ${duplicate.label}`);
      handleCityChange(duplicate);
      return;
    }

    const newCity = createLocationOption(inputValue);
    const cityOption = { value: newCity.value, label: newCity.label };
    
    setEditedMemberData({
      ...editedMemberData,
      address: { 
        ...editedMemberData.address, 
        city: cityOption.value 
      }
    });
  };

  const handlePostalCodeChange = (value) => {
    const country = editedMemberData.address?.country || 'US';
    const formatted = formatPostalCode(value, country);
    
    setEditedMemberData({
      ...editedMemberData,
      address: { 
        ...editedMemberData.address, 
        zipCode: formatted 
      }
    });
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setPasswordError('');

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    if (passwordForm.newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters');
      return;
    }

    try {
      const auth = getAuth();
      const currentUser = auth.currentUser;
      
      await updatePassword(currentUser, passwordForm.newPassword);
      
      setPasswordForm({ newPassword: '', confirmPassword: '' });
      setShowPasswordChange(false);
      toast.success('Password updated successfully');
    } catch (error) {
      console.error('Error updating password:', error);
      setPasswordError('Failed to update password');
    }
  };

  const renderDateInfo = () => {
    if (memberData.migrationDetails) {
      const originalDate = memberData.migrationDetails.originalCreationDate
        ? new Date(memberData.migrationDetails.originalCreationDate)
        : null;
      const migrationDate = memberData.migrationDetails.migrationDate
        ? new Date(memberData.migrationDetails.migrationDate)
        : null;
      
      return (
        <div className="member-since-info">
          {originalDate && (
            <div className="detail-row">
              <label>Original Join Date:</label>
              <span>{originalDate.toLocaleString()}</span>
            </div>
          )}
          {migrationDate && (
            <div className="detail-row">
              <label>Migrated to Member:</label>
              <span>{migrationDate.toLocaleString()}</span>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="detail-row">
        <label>Member Since:</label>
        <span>{memberData.createdAt}</span>
      </div>
    );
  };

  const renderTags = () => {
    const currentTags = memberData.tags || [];
    const migratedTags = memberData.migrationDetails?.originalTags || [];
    
    const uniqueMigratedTags = migratedTags.filter(tag => !currentTags.includes(tag));
    
    if (currentTags.length === 0 && uniqueMigratedTags.length === 0) return null;
    
    return (
      <div className="detail-row">
        <label>Tags:</label>
        <div className="tags-container">
          {currentTags.map((tag, index) => (
            <span key={`current-${index}`} className="tag">
              {tag}
            </span>
          ))}
          {uniqueMigratedTags.map((tag, index) => (
            <span key={`migrated-${index}`} className="tag migrated">
              {tag}
              <span className="migrated-badge" title="Migrated from visitor">•</span>
            </span>
          ))}
        </div>
      </div>
    );
  };

  const renderHistorySections = () => (
    <div className="member-history">
      <div className="history-section">
        <h3>Event Check-ins</h3>
        <div className="history-list">
          {checkInHistory.length > 0 ? (
            checkInHistory.map(record => (
              <div key={record.id} className="history-item">
                <div className="history-header">
                  <span className="event-name">{record.eventName}</span>
                  <span className="timestamp">{record.timestamp}</span>
                </div>
                <div className="history-details">
                  {record.roomName && <p>Room: {record.roomName}</p>}
                  {record.notes && <p>Notes: {record.notes}</p>}
                </div>
              </div>
            ))
          ) : (
            <p className="no-data">No check-in history available</p>
          )}
        </div>
      </div>
      <div className="history-section">
        <h3>Child Care Records</h3>
        <div className="history-list">
          {childCareDetails.length > 0 ? (
            childCareDetails.map(record => (
              <div key={record.id} className="history-item">
                <div className="history-header">
                  <span className="child-name">{record.childName}</span>
                  <span className={`status ${record.status.toLowerCase()}`}>
                    {record.status}
                  </span>
                </div>
                <div className="history-details">
                  <p>{record.roomName} • {record.checkInTime}</p>
                  {record.checkOutTime && <p>Out: {record.checkOutTime}</p>}
                </div>
              </div>
            ))
          ) : (
            <p className="no-data">No child care records available</p>
          )}
        </div>
      </div>
    </div>
  );

  const renderUpcomingEvents = () => {
    // Calculate events completion percentage for the events section
    const registeredEvents = upcomingEvents.filter(event => event.isRegistered).length;
    const completionPercentage = upcomingEvents.length > 0 
      ? Math.round((registeredEvents / upcomingEvents.length) * 100) 
      : 0;
      
    return (
      <div className="upcoming-events-section">
        <h3>Upcoming Events</h3>
        <div className="events-completion-bar">
          <div className="completion-percentage">
            <span>{completionPercentage}% Complete</span>
            <div className="progress-bar">
              <div 
                className="progress-bar-fill" 
                style={{ width: `${completionPercentage}%` }}
              ></div>
            </div>
          </div>
        </div>
        <div className="events-list">
          {upcomingEvents.length > 0 ? (
            <>
              <div className="events-list-container">
                {upcomingEvents.map(event => {
                  // Check if there are any completed events with the same event order
                  const hasSameOrderEvent = upcomingEvents.some(e => 
                    e.order === event.order && 
                    e.isRegistered && 
                    e.registrationDetails?.status === 'completed'
                  );
                  
                  // Skip this event if there's already a completed event with the same order
                  if (event.order && hasSameOrderEvent && (!event.isRegistered || event.registrationDetails?.status !== 'completed')) {
                    return null;
                  }
                  
                  return (
                    <div key={event.id} className="event-item">
                      <div className="event-details">
                        <h4>{event.name}</h4>
                        <p>{event.date}</p>
                        <p>{event.location}</p>
                        {event.order && (
                          <span className="event-order-badge">
                            #{event.order}
                          </span>
                        )}
                        {event.isRegistered && event.registrationDetails && (
                          <div className="registration-details">
                            <span className={`registration-badge ${event.registrationDetails.status || 'registered'}`}>
                              {event.registrationDetails.status === 'completed' ? 'Completed' : 
                               event.registrationDetails.status === 'in-progress' ? 'In Progress' : 
                               'Registered'}
                            </span>
                            <span className="registration-date">
                              on {event.registrationDetails.registeredAt}
                            </span>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => !event.isRegistered && handleEventRegistration(event.id)}
                        disabled={registrationLoading || event.isRegistered}
                        className={`register-button ${event.isRegistered ? 
                          `already-${event.registrationDetails?.status || 'registered'}` : ''}`}
                      >
                        {registrationLoading ? 'Registering...' : 
                         event.isRegistered ? 
                           event.registrationDetails?.status === 'completed' ? 'Completed' :
                           event.registrationDetails?.status === 'in-progress' ? 'In Progress' :
                           'Registered' 
                         : 'Register'}
                      </button>
                    </div>
                  );
                })}
              </div>
              
              <div className="registrations-section">
                <h4>Your Registrations</h4>
                {upcomingEvents.filter(event => event.isRegistered).length > 0 ? (
                  <div className="registrations-list">
                    {upcomingEvents
                      .filter(event => event.isRegistered)
                      .map(event => (
                        <div key={event.id} className={`registration-item ${event.registrationDetails?.status || ''}`}>
                          <div className="registration-event-name">{event.name}</div>
                          {event.order && (
                            <span className="registration-event-order">#{event.order}</span>
                          )}
                          <div className="registration-date-container">
                            <div className="registration-event-date">Event date: {event.date}</div>
                            <div className="registration-timestamp">
                              Registered: {event.registrationDetails?.registeredAt}
                            </div>
                            {event.registrationDetails?.status && (
                              <div className={`registration-status ${event.registrationDetails.status}`}>
                                Status: {event.registrationDetails.status === 'completed' ? 'Completed' : 
                                        event.registrationDetails.status === 'in-progress' ? 'In Progress' : 
                                        event.registrationDetails.status}
                              </div>
                            )}
                          </div>
                        </div>
                      ))
                    }
                  </div>
                ) : (
                  <p className="no-registrations">No registrations yet</p>
                )}
              </div>
            </>
          ) : (
            <p>No upcoming events available</p>
          )}
        </div>
      </div>
    );
  };

  const handleEventRegistration = async (eventId) => {
    try {
      setRegistrationLoading(true);
      
      const event = upcomingEvents.find(e => e.id === eventId);
      if (event?.isRegistered) {
        console.log('Already registered for this event');
        setRegistrationLoading(false);
        return;
      }

      await addDoc(collection(db, "eventRegistrations"), {
        eventId,
        memberId: profileId,
        churchId: id,
        registeredAt: serverTimestamp(),
        status: "confirmed",
        memberName: `${memberData.name} ${memberData.lastName}`,
        memberEmail: memberData.email,
        memberPhone: memberData.phone
      });

      await fetchUpcomingEvents();
      
      toast.success('Successfully registered for the event!');
    } catch (error) {
      console.error('Error registering for event:', error);
      console.error('Failed to register for the event');
    } finally {
      setRegistrationLoading(false);
    }
  };

  const renderCourseTrackingTable = () => {
    const handleEventRegisterFromTable = async (event) => {
      if (event.progressStatus || event.isRegistered) {
        return;
      }
      
      try {
        await addDoc(collection(db, "eventRegistrations"), {
          eventId: event.id,
          memberId: profileId,
          churchId: id,
          registeredAt: serverTimestamp(),
          status: "confirmed",
          memberName: `${memberData.name} ${memberData.lastName}`,
          memberEmail: memberData.email,
          memberPhone: memberData.phone
        });

        console.log(`Successfully registered for ${event.title}`);
        
        event.isRegistered = true;
        
        try {
          await fetchCourseDataWithEvents();
          await fetchUpcomingEvents();
        } catch (refreshError) {
          console.error("Error refreshing data after registration:", refreshError);
        }

        toast.success(`Registration successful`);
      } catch (error) {
        console.error('Error registering for event:', error);
      }
    };

    return (
      <div className="course-tracking-section">
        <h3>Course & Event Tracking</h3>
        {loadingCourses ? (
          <p>Loading course data...</p>
        ) : (
          <div className="course-table-container">
            <table className="course-tracking-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Subcategory</th>
                  <th>Related Events</th>
                  <th>Status</th>
                  <th>Completion</th>
                  <th>Actions</th>
                  <th>Register</th>
                </tr>
              </thead>
              <tbody>
                {courseData.length > 0 ? (
                  courseData.flatMap(category => 
                    category.subcategories.map((subcategory, subIndex) => {
                      const hasInProgressEvents = subcategory.relatedEvents.some(
                        event => event.progressStatus && event.progressStatus.status === 'in-progress'
                      );
                      
                      let statusDisplay = null;
                      if (subcategory.isCompleted) {
                        statusDisplay = (
                          <span className="status-badge completed" title={subcategory.completionNote || ''}>
                            Completed {subcategory.completedAtFormatted && `on ${subcategory.completedAtFormatted}`}
                          </span>
                        );
                      } else if (subcategory.isAssigned) {
                        if (subcategory.required && !hasInProgressEvents) {
                          statusDisplay = (
                            <span className="status-badge incomplete">
                              Incomplete
                            </span>
                          );
                        } else {
                          statusDisplay = (
                            <span className="status-badge assigned">
                              Assigned
                            </span>
                          );
                        }
                      } else {
                        statusDisplay = (
                          <span className="status-badge not-assigned">
                            Not Assigned
                          </span>
                        );
                      }
                      
                      return (
                        <tr key={`${category.id}-${subcategory.id}`} className={subcategory.isCompleted ? 'completed-row' : (subcategory.required && !hasInProgressEvents && subcategory.isAssigned ? 'incomplete-row' : '')}>
                          {subIndex === 0 ? (
                            <td rowSpan={category.subcategories.length} className="category-cell">
                              {category.name}
                            </td>
                          ) : null}
                          <td>
                            <div className="subcategory-name">
                              {subcategory.name}
                            </div>
                          </td>
                          <td>
                            {subcategory.relatedEvents.length > 0 ? (
                              <ul className="events-list">
                                {subcategory.relatedEvents
                                  .sort((a, b) => (a.order || 0) - (b.order || 0))
                                  .map(event => (
                                    <li key={event.id} className="event-item-row">
                                      <span className="event-order">#{event.order || 1}</span>
                                      <span className="event-title">{event.title}</span>
                                      <span className="event-date">{event.startDate}</span>
                                      <div className="event-status-container">
                                        <span className={`event-status ${event.status || 'optional'}`}>
                                          {event.status || 'optional'}
                                        </span>
                                        {event.progressStatus && (
                                          <span className={`event-progress-status ${event.progressStatus.status}`}>
                                            {event.progressStatus.status === 'completed' ? 'Completed' : 'In Progress'}
                                          </span>
                                        )}
                                        {event.isRegistered && (
                                          <span className="event-registered-status">
                                            Registered
                                          </span>
                                        )}
                                      </div>
                                    </li>
                                ))}
                              </ul>
                            ) : (
                              <span className="no-events">No events</span>
                            )}
                          </td>
                          <td>
                            {statusDisplay}
                          </td>
                          <td>
                            <span className="completion-percentage">
                              {subcategory.completionPercentage}%
                            </span>
                          </td>
                          <td>
                            {assigningStates[subcategory.id] ? (
                              <span className="loading-spinner">Loading...</span>
                            ) : (
                              <div className="action-buttons">
                                {subcategory.isAssigned ? (
                                  <button 
                                    onClick={() => handleAssignmentToggle(category.id, subcategory.id, true)}
                                    className="unassign-btn"
                                    type="button"
                                  >
                                    Unassign
                                  </button>
                                ) : (
                                  <button 
                                    onClick={() => handleAssignmentToggle(category.id, subcategory.id, false)}
                                    className="assign-btn"
                                    type="button"
                                  >
                                    Assign
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                          <td>
                            <div className="register-buttons">
                              {subcategory.relatedEvents.map(event => {
                                if (!event.progressStatus) {
                                  return (
                                    <button
                                      key={event.id}
                                      onClick={() => !event.isRegistered && handleEventRegisterFromTable(event)}
                                      className={`register-event-btn ${event.isRegistered ? 'registered' : ''}`}
                                      title={event.isRegistered ? 'Already registered' : `Register for ${event.title}`}
                                      disabled={event.isRegistered}
                                    >
                                      {event.isRegistered ? 'Registered' : `Register for #${event.order}`}
                                    </button>
                                  );
                                }
                                return null;
                              })}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )
                ) : (
                  <tr>
                    <td colSpan="7" className="no-data">No course data available</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="page-container">
      <ToastContainer
        position="top-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop={true}
        closeOnClick={true}
        rtl={false}
        pauseOnFocusLoss={false}
        draggable={true}
        pauseOnHover={true}
        theme="light"
        limit={3}
      />
      <button
        onClick={() => navigate(`/church/${id}/admin-connect`)}
        className="back-button"
        style={{ marginBottom: '1rem' }}
      >
        ← Back to Admin Connect
      </button>
      <ChurchHeader id={id} />
      <div className="content-box">
        <h2>Member Profile</h2>
        {memberData && (
          <>
            <div className="member-details">
              {isEditingProfile ? (
                <>
                  <div className="detail-row">
                    <label>Name:</label>
                    <input
                      type="text"
                      value={editedMemberData.name || ''}
                      onChange={(e) => setEditedMemberData({...editedMemberData, name: e.target.value})}
                    />
                  </div>
                  <div className="detail-row">
                    <label>Last Name:</label>
                    <input
                      type="text"
                      value={editedMemberData.lastName || ''}
                      onChange={(e) => setEditedMemberData({...editedMemberData, lastName: e.target.value})}
                    />
                  </div>
                  <div className="detail-row">
                    <label>Phone:</label>
                    <input
                      type="tel"
                      value={formatPhoneNumber(editedMemberData.phone || '')}
                      onChange={handlePhoneChange}
                      placeholder="(123) 456-7890"
                      className="form-input"
                    />
                  </div>
                  <div className="detail-row">
                    <label>Email:</label>
                    <input
                      type="email"
                      value={editedMemberData.email || ''}
                      onChange={(e) => setEditedMemberData({...editedMemberData, email: e.target.value})}
                    />
                  </div>
                  <div className="detail-row">
                    <label>Profession:</label>
                    <CreatableSelect
                      isMulti
                      isSearchable
                      name="Profession"
                      value={
                        Array.isArray(editedMemberData.Profession)
                          ? editedMemberData.Profession.map(profession => ({
                              value: profession,
                              label: profession,
                            }))
                          : []
                      }
                      options={ocupaciones.map(profession => ({
                        value: profession,
                        label: profession,
                      }))}
                      onChange={(selected) => 
                        setEditedMemberData({
                          ...editedMemberData, 
                          Profession: selected ? selected.map(option => option.value) : []
                        })
                      }
                      onCreateOption={(inputValue) => handleCreateOption('Profession', inputValue)}
                      formatCreateLabel={(inputValue) => `Add new profession: "${inputValue}"`}
                    />
                  </div>
                  <div className="detail-row">
                    <label>Language:</label>
                    <CreatableSelect
                      isMulti
                      isSearchable
                      name="language"
                      value={
                        Array.isArray(editedMemberData.language)
                          ? editedMemberData.language.map(language => ({
                              value: language,
                              label: language,
                            }))
                          : []
                      }
                      options={idiomas.map(language => ({
                        value: language,
                        label: language,
                      }))}
                      onChange={(selected) => 
                        setEditedMemberData({
                          ...editedMemberData, 
                          language: selected ? selected.map(option => option.value) : []
                        })
                      }
                      onCreateOption={(inputValue) => handleCreateOption('language', inputValue)}
                      formatCreateLabel={(inputValue) => `Add new language: "${inputValue}"`}
                    />
                  </div>
                  <div className="detail-row">
                    <label>Nationality:</label>
                    <CreatableSelect
                      isMulti
                      isSearchable
                      name="Nationality"
                      value={
                        Array.isArray(editedMemberData.Nationality)
                          ? editedMemberData.Nationality.map(nationality => ({
                              value: nationality,
                              label: nationality,
                            }))
                          : []
                      }
                      options={nacionalidades.map(nationality => ({
                        value: nationality,
                        label: nationality,
                      }))}
                      onChange={(selected) => 
                        setEditedMemberData({
                          ...editedMemberData, 
                          Nationality: selected ? selected.map(option => option.value) : []
                        })
                      }
                      onCreateOption={(inputValue) => handleCreateOption('Nationality', inputValue)}
                      formatCreateLabel={(inputValue) => `Add new nationality: "${inputValue}"`}
                    />
                  </div>
                  <div className="detail-row">
                    <label>Skills:</label>
                    <CreatableSelect
                      isMulti
                      isSearchable
                      name="skill"
                      value={
                        Array.isArray(editedMemberData.skill)
                          ? editedMemberData.skill.map(skill => ({
                              value: skill,
                              label: skill,
                            }))
                          : []
                      }
                      options={Object.values(habilidades)
                        .flat()
                        .map(skill => ({ value: skill, label: skill }))}
                      onChange={(selected) => 
                        setEditedMemberData({
                          ...editedMemberData, 
                          skill: selected ? selected.map(option => option.value) : []
                        })
                      }
                      onCreateOption={(inputValue) => handleCreateOption('skill', inputValue)}
                      formatCreateLabel={(inputValue) => `Add new skill: "${inputValue}"`}
                    />
                  </div>
                  <div className="personal-info-section">
                    <h3>Personal Information</h3>
                    <div className="form-grid">
                      <div className="form-group">
                        <label>Date of Birth:</label>
                        <input
                          type="date"
                          value={editedMemberData?.dateOfBirth || ''}
                          onChange={(e) => handlePersonalInfoChange('dateOfBirth', e.target.value)}
                          className="form-input"
                        />
                        {editedMemberData.dateOfBirth && (
                          <span className="age-display">
                            Age: {calculateAge(editedMemberData.dateOfBirth)} years
                            {new Date(editedMemberData.dateOfBirth).toDateString() === new Date().toDateString() && (
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
                          value={editedMemberData?.gender || ''}
                          onChange={(e) => handlePersonalInfoChange('gender', e.target.value)}
                          className="form-input"
                        >
                          <option value="">Select gender</option>
                          <option value="male">Male</option>
                          <option value="female">Female</option>
                        </select>
                      </div>

                      <div className="form-group">
                        <label>Marital Status:</label>
                        <select
                          value={editedMemberData?.maritalStatus || ''}
                          onChange={(e) => handlePersonalInfoChange('maritalStatus', e.target.value)}
                          className="form-input"
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
                          value={editedMemberData.address?.street || ''}
                          onChange={(e) => setEditedMemberData({
                            ...editedMemberData,
                            address: { ...editedMemberData.address || {}, street: e.target.value }
                          })}
                          className="form-input"
                        />
                      </div>
                      <div className="form-group">
                        <label>State/Province:</label>
                        <CreatableSelect
                          value={editedMemberData.address?.state ? 
                            { value: editedMemberData.address.state, label: states.find(s => s.value === editedMemberData.address.state)?.label || editedMemberData.address.state } : null}
                          options={states}
                          onChange={handleStateChange}
                          onCreateOption={handleStateCreate}
                          className="form-input"
                          placeholder="Select or type state/province"
                          isDisabled={!isEditingProfile}
                          formatCreateLabel={(inputValue) => `Add new state: "${inputValue}"`}
                        />
                      </div>
                      <div className="form-group">
                        <label>City:</label>
                        <CreatableSelect
                          value={editedMemberData.address?.city ? 
                            { value: editedMemberData.address.city, label: editedMemberData.address.city } : null}
                          options={cityOptions}
                          onChange={(selected) => setEditedMemberData({
                            ...editedMemberData,
                            address: { ...editedMemberData.address, city: selected.value }
                          })}
                          onCreateOption={handleCityCreate}
                          className="form-input"
                          placeholder="Select or type city"
                          isDisabled={!isEditingProfile || !editedMemberData.address?.state}
                          formatCreateLabel={(inputValue) => `Add new city: "${inputValue}"`}
                        />
                      </div>
                      <div className="form-group">
                        <label>Country:</label>
                        <CreatableSelect
                          value={editedMemberData.address?.country ? 
                            { value: editedMemberData.address.country, label: countries.find(c => c.value === editedMemberData.address.country)?.label || editedMemberData.address.country } : null}
                          options={countries}
                          onChange={(selected) => setEditedMemberData({
                            ...editedMemberData,
                            address: { 
                              ...editedMemberData.address, 
                              country: selected.value,
                              zipCode: '' 
                            }
                          })}
                          className="form-input"
                          placeholder="Select or type country"
                          formatCreateLabel={(inputValue) => `Use "${inputValue}"`}
                        />
                      </div>
                      <div className="form-group">
                        <label>Postal/ZIP Code:</label>
                        <input
                          type="text"
                          value={editedMemberData.address?.zipCode || ''}
                          onChange={(e) => handlePostalCodeChange(e.target.value)}
                          className={`form-input ${
                            editedMemberData.address?.zipCode && 
                            !validatePostalCode(editedMemberData.address.zipCode, editedMemberData.address.country) 
                              ? 'invalid-input' 
                              : ''
                          }`}
                          placeholder={editedMemberData.address?.country === 'CA' ? 'A1A 1A1' : '12345'}
                        />
                        {editedMemberData.address?.zipCode && 
                         !validatePostalCode(editedMemberData.address.zipCode, editedMemberData.address.country) && (
                          <span className="error-text">Invalid postal code format</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="password-change-section">
                    <h3>Password Management</h3>
                    {!showPasswordChange ? (
                      <button 
                        onClick={() => setShowPasswordChange(true)}
                        className="change-password-button"
                        style={{
                          backgroundColor: '#4F46E5',
                          color: 'white',
                          padding: '8px 16px',
                          borderRadius: '4px',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: '14px'
                        }}
                      >
                        Change Password
                      </button>
                    ) : (
                      <form onSubmit={handlePasswordChange} className="password-form">
                        <div className="form-group">
                          <label>New Password:</label>
                          <input
                            type="password"
                            value={passwordForm.newPassword}
                            onChange={(e) => setPasswordForm({
                              ...passwordForm,
                              newPassword: e.target.value
                            })}
                            required
                            className="form-input"
                          />
                        </div>
                        <div className="form-group">
                          <label>Confirm New Password:</label>
                          <input
                            type="password"
                            value={passwordForm.confirmPassword}
                            onChange={(e) => setPasswordForm({
                              ...passwordForm,
                              confirmPassword: e.target.value
                            })}
                            required
                            className="form-input"
                          />
                        </div>
                        {passwordError && (
                          <div className="error-message" style={{ color: '#DC2626', marginBottom: '10px' }}>
                            {passwordError}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button 
                            type="submit"
                            style={{
                              backgroundColor: '#10B981',
                              color: 'white',
                              padding: '8px 16px',
                              borderRadius: '4px',
                              border: 'none',
                              cursor: 'pointer',
                              fontSize: '14px'
                            }}
                          >
                            Update Password
                          </button>
                          <button 
                            type="button"
                            onClick={() => {
                              setShowPasswordChange(false);
                              setPasswordForm({ newPassword: '', confirmPassword: '' });
                              setPasswordError('');
                            }}
                            style={{
                              backgroundColor: '#EF4444',
                              color: 'white',
                              padding: '8px 16px',
                              borderRadius: '4px',
                              border: 'none',
                              cursor: 'pointer',
                              fontSize: '14px'
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                  <div className="edit-actions">
                    <button onClick={handleSaveProfile} className="save-button">Save Changes</button>
                    <button onClick={() => setIsEditingProfile(false)} className="cancel-button">Cancel</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="detail-row">
                    <label>Name:</label>
                    <span>{memberData.name}</span>
                  </div>
                  <div className="detail-row">
                    <label>Last Name:</label>
                    <span>{memberData.lastName}</span>
                  </div>
                  <div className="detail-row">
                    <label>Phone:</label>
                    <span>{formatPhoneNumber(memberData.phone) || 'No phone provided'}</span>
                  </div>
                  <div className="detail-row">
                    <label>Email:</label>
                    <span>{memberData.email}</span>
                  </div>
                  {renderDateInfo()}
                  <div className="detail-row">
                    <label>Profession:</label>
                    <div className="tags-container">
                      {Array.isArray(memberData.Profession) && memberData.Profession.length > 0 ? (
                        memberData.Profession.map((prof, index) => (
                          <span key={index} className="tag">{prof}</span>
                        ))
                      ) : (
                        <span className="text-gray-500">Not specified</span>
                      )}
                    </div>
                  </div>
                  <div className="detail-row">
                    <label>Language:</label>
                    <div className="tags-container">
                      {Array.isArray(memberData.language) && memberData.language.length > 0 ? (
                        memberData.language.map((lang, index) => (
                          <span key={index} className="tag">{lang}</span>
                        ))
                      ) : (
                        <span className="text-gray-500">Not specified</span>
                      )}
                    </div>
                  </div>
                  <div className="detail-row">
                    <label>Nationality:</label>
                    <div className="tags-container">
                      {Array.isArray(memberData.Nationality) && memberData.Nationality.length > 0 ? (
                        memberData.Nationality.map((nat, index) => (
                          <span key={index} className="tag">{nat}</span>
                        ))
                      ) : (
                        <span className="text-gray-500">Not specified</span>
                      )}
                    </div>
                  </div>
                  <div className="detail-row">
                    <label>Skills:</label>
                    <div className="tags-container">
                      {Array.isArray(memberData.skill) && memberData.skill.length > 0 ? (
                        memberData.skill.map((skill, index) => (
                          <span key={index} className="tag">{skill}</span>
                        ))
                      ) : (
                        <span className="text-gray-500">Not specified</span>
                      )}
                    </div>
                  </div>
                  {renderTags()}
                  <div className="personal-info-section">
                    <h3>Personal Information</h3>
                    <div className="detail-row">
                      <label>Date of Birth:</label>
                      <span>
                        {memberData.dateOfBirth ? (
                          <>
                            {new Date(memberData.dateOfBirth).toLocaleDateString()}
                            <span className="age-display"> (Age: {calculateAge(memberData.dateOfBirth)} years)</span>
                            {new Date(memberData.dateOfBirth).toDateString() === new Date().toDateString() && (
                              <div className="birthday-message">
                                🎉 Happy Birthday! 🎂
                              </div>
                            )}
                          </>
                        ) : (
                          'Not specified'
                        )}
                      </span>
                    </div>
                    <div className="address-section">
                      <h3>Address Information</h3>
                      <div className="detail-row">
                        <label>Street:</label>
                        <span>{memberData.address?.street || 'Not specified'}</span>
                      </div>
                      <div className="detail-row">
                        <label>City:</label>
                        <span>{memberData.address?.city || 'Not specified'}</span>
                      </div>
                      <div className="detail-row">
                        <label>State:</label>
                        <span>{memberData.address?.state || 'Not specified'}</span>
                      </div>
                      <div className="detail-row">
                        <label>Country:</label>
                        <span>{memberData.address?.country || 'Not specified'}</span>
                      </div>
                      <div className="detail-row">
                        <label>Postal/ZIP Code:</label>
                        <span>{memberData.address?.zipCode || 'Not specified'}</span>
                      </div>
                    </div>
                  </div>
                  <button onClick={handleEditProfile} className="edit-button">Edit Profile</button>
                  
                  <div className="profile-action-buttons">
                    <button 
                      onClick={() => navigate(`/church/${id}/member/${profileId}/messages`)} 
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
                    
                    <button 
                      onClick={() => navigate(`/church/${id}/member/${profileId}/dashboard`)} 
                      className="dashboard-button"
                      style={{
                        backgroundColor: '#10B981',
                        color: 'white',
                        padding: '12px 24px',
                        borderRadius: '4px',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '14px',
                        marginTop: '12px',
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px'
                      }}
                    >
                      <FaChartPie size={16} /> Member Dashboard
                    </button>
                  </div>
                </>
              )}
            </div>
            <div className="notes-section">
              <div className="add-note-form">
                <textarea
                  placeholder="Add a new note..."
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && e.target.value.trim()) {
                      e.preventDefault();
                      handleAddNote(e.target.value.trim());
                      e.target.value = '';
                    }
                  }}
                />
                <small>Press Enter to add note (Shift + Enter for new line)</small>
              </div>
              {memberData.migrationDetails && (
                <div className="migration-info">
                  <p>Some notes were migrated from visitor profile on {new Date(memberData.migrationDetails.migrationDate).toLocaleDateString()}</p>
                </div>
              )}
              <div className="notes-list">
                {memberData.allNotes?.length > 0 ? (
                  memberData.allNotes.map((note, index) => (
                    <div key={note.id || index} className={`note-item ${note.isMigratedNote ? 'migrated-note' : ''}`}>
                      <div className="note-content">
                        <p>{note.text}</p>
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
                                  {task.completedBy && ` by ${task.completedBy}`}
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
                        {note.tags && note.tags.length > 0 && (
                          <div className="note-tags">
                            {note.tags.map((tag, tagIndex) => (
                              <span key={tagIndex} className="tag">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="note-meta">
                        <span>Added by {note.addedBy}</span>
                        <span>{new Date(note.timestamp).toLocaleString()}</span>
                        {note.isMigratedNote && (
                          <span className="migrated-badge">Migrated from visitor profile</span>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="no-notes">No notes available</p>
                )}
              </div>
            </div>
            {renderHistorySections()}
            
            {renderCourseTrackingTable()}

            {renderUpcomingEvents()}
            <div style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              margin: "10px 0 40px 0",
              padding: "clamp(10px, 3vw, 20px)",
              backgroundColor: "white",
              borderRadius: "8px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
              width: "100%",
              maxWidth: "6in",
            }}>
              <h3 style={{ marginBottom: "15px", color: "#374151" }}>Member ID Card</h3>
              <div style={{
                display: 'flex',
                flexDirection: isMobile ? 'column' : 'row',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                padding: '16px',
                marginBottom: '20px',
                backgroundColor: 'white',
                width: '100%',
                maxWidth: '432px',
                minHeight: isMobile ? 'auto' : '144px',
                alignItems: 'center',
                gap: '16px'
              }}>
                <div style={{
                  width: isMobile ? '100%' : '40%',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  position: "relative"
                }}>
                  <QRCode
                    value={memberData.id}
                    size={isMobile ? 120 : 144}
                    level="H"
                    includeMargin={true}
                  />
                  <img 
                    src={church?.logo} 
                    alt="Church Logo" 
                    style={{
                      position: 'absolute',
                      width: '30px',
                      height: '30px',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)'
                    }}
                  />
                </div>
                <div style={{
                  width: isMobile ? '100%' : '60%',
                  paddingLeft: isMobile ? '0' : '10px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: isMobile ? 'center' : 'flex-start'
                }}>
                  <p style={{ 
                    fontSize: '12px', 
                    marginBottom: '5px',
                    textAlign: isMobile ? 'center' : 'left',
                    width: '100%'
                  }}>{church?.nombre || 'Church Name'}</p>
                  <p style={{ 
                    fontSize: '12px', 
                    marginBottom: '5px',
                    textAlign: isMobile ? 'center' : 'left',
                    width: '100%'
                  }}>{memberData.name} {memberData.lastName}</p>
                  <p style={{ 
                    fontSize: '12px', 
                    marginBottom: '5px',
                    textAlign: isMobile ? 'center' : 'left',
                    width: '100%'
                  }}>ID: {memberData.id}</p>
                </div>
              </div>
              <PDFDownloadLink
                document={
                  <QRCodeLabel
                    qrValue={memberData.id}
                    userName={`${memberData.name} ${memberData.lastName}`}
                    church={church}
                  />
                }
                fileName={`${memberData.name}-${memberData.lastName}-IDCard.pdf`}
                style={{
                  display: 'inline-block',
                  padding: '8px 16px',
                  backgroundColor: '#4F46E5',
                  color: 'white',
                  borderRadius: '6px',
                  textDecoration: 'none',
                  fontSize: '14px',
                  width: isMobile ? '100%' : 'auto',
                  textAlign: 'center'
                }}
              >
                <span>📄</span> Download ID Card PDF
              </PDFDownloadLink>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default MemberProfile;