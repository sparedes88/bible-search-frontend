import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { doc, getDoc, updateDoc, arrayUnion, serverTimestamp } from 'firebase/firestore'; // Updated this line
import { db, auth } from '../firebase';
import { format } from 'date-fns';
import ChurchHeader from './ChurchHeader';
import Skeleton from 'react-loading-skeleton';
import "react-loading-skeleton/dist/skeleton.css";
import Select from 'react-select';
import { useAuth } from '../contexts/AuthContext';
import FormDisplay from './FormDisplay';
import commonStyles from '../pages/commonStyles';
import './CourseDetail.css';

// Function to get a generic background color based on index
const getGenericBackgroundColor = (index) => {
  const colors = [
    "#3b82f6", // blue
    "#10b981", // green
    "#f59e0b", // amber
    "#8b5cf6", // purple
    "#ec4899", // pink
    "#f43f5e", // rose
    "#06b6d4", // cyan
    "#14b8a6", // teal
    "#a3e635", // lime
  ];
  return colors[index % colors.length];
};

const tableHeaderStyle = {
  padding: '12px 16px',
  fontWeight: '600',
  color: '#4a5568',
  fontSize: '0.875rem'
};

const tableCellStyle = {
  padding: '12px 16px',
  color: '#1a202c',
  fontSize: '0.875rem'
};

const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  try {
    const formattedDate = dateString.split('-').join('/'); // Convert YYYY-MM-DD to YYYY/MM/DD
    const date = new Date(formattedDate);
    if (isNaN(date.getTime())) return 'N/A';
    
    return date.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric'
    });
  } catch (error) {
    console.error('Error formatting date:', error);
    return dateString; // Return original string if parsing fails
  }
};

const formatTime = (timeString) => {
  if (!timeString) return 'N/A';
  try {
    // Handle different time formats
    let time = timeString;
    
    // If time is in 24-hour format (HH:mm)
    if (timeString.match(/^\d{2}:\d{2}$/)) {
      const [hours, minutes] = timeString.split(':');
      const date = new Date();
      date.setHours(parseInt(hours), parseInt(minutes), 0);
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    }
    
    // If time already includes AM/PM
    if (timeString.includes('AM') || timeString.includes('PM')) {
      return timeString;
    }
    
    // If time is a timestamp
    if (typeof timeString === 'object' && timeString.seconds) {
      time = new Date(timeString.seconds * 1000).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    }
    
    return time;
  } catch (error) {
    console.error('Error formatting time:', error);
    return timeString;
  }
};

const formatEventDateTime = (date, time) => {
  if (!date || !time) {
    return { date: 'N/A', time: 'N/A' };
  }

  return {
    date: formatDate(date),
    time: formatTime(time)
  };
};

const generateRecurringInstances = (event) => {
  if (!event.recurring && !event.isRecurring) {
    return [{
      ...event,
      id: event.id || `single-${Date.now()}`,
      parentEventId: event.id,
      startDate: event.startDate,
      endDate: event.endDate || event.startDate,
      startHour: event.startHour || '09:00 AM',
      endHour: event.endHour || '10:00 AM',
      title: event.title,
      status: event.status || 'optional',
      order: event.order || 1,
      isRecurring: false
    }];
  }

  const instances = [];
  const startDate = new Date(event.startDate);
  const endRecurrence = event.recurrenceEndDate ? new Date(event.recurrenceEndDate) : null;
  const maxDate = endRecurrence || new Date(startDate.getTime() + (180 * 24 * 60 * 60 * 1000));
  let currentDate = new Date(startDate);
  let instanceCount = 0;

  while (currentDate <= maxDate) {
    instanceCount++;
    const instanceDate = currentDate.toISOString().split('T')[0];
    
    instances.push({
      ...event,
      id: `${event.id}-${currentDate.getTime()}`,
      parentEventId: event.id,
      startDate: instanceDate,
      endDate: instanceDate,
      startHour: event.startHour || '09:00 AM',
      endHour: event.endHour || '10:00 AM',
      title: event.title,
      status: event.status || 'optional',
      order: instanceCount,
      isRecurring: true,
      recurrencePattern: event.recurrencePattern,
      instanceNumber: instanceCount
    });

    // Move to next occurrence
    switch (event.recurrencePattern) {
      case 'daily':
        currentDate.setDate(currentDate.getDate() + 1);
        break;
      case 'weekly':
        currentDate.setDate(currentDate.getDate() + 7);
        break;
      case 'biweekly':
        currentDate.setDate(currentDate.getDate() + 14);
        break;
      case 'monthly':
        currentDate.setMonth(currentDate.getMonth() + 1);
        break;
      case 'yearly':
        currentDate.setFullYear(currentDate.getFullYear() + 1);
        break;
      default:
        currentDate.setDate(currentDate.getDate() + 7);
    }
  }

  return instances;
};

const calculateEventStats = (eventInstance, allCompletionLogs) => {
  const completions = allCompletionLogs.filter(log => 
    log.eventInstanceId === eventInstance.id && !log.isDeleted
  );
  
  return {
    totalCompletions: completions.length,
    completedBy: completions.map(log => ({
      userLabel: log.userLabel,
      completedAt: log.completedAtFormatted
    }))
  };
};

const CourseDetail = () => {
  const { id, categoryId, subcategoryId, mode } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  // Image error handler method - Solution 2 implementation
  const handleImageError = (event) => {
    const target = event.target;
    if (target && target.style) {
      console.error('Error loading image:', target.src);
      target.style.display = 'none';
    }
  };

  const [course, setCourse] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [completionNote, setCompletionNote] = useState('');
  const [completionLogs, setCompletionLogs] = useState([]);
  const [editingLogIndex, setEditingLogIndex] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedViewUser, setSelectedViewUser] = useState(null);
  const [filteredLogs, setFilteredLogs] = useState([]);
  const [canEdit, setCanEdit] = useState(false);
  const [userCompletionStatus, setUserCompletionStatus] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [eventsPerPage] = useState(7);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedEventInstance, setSelectedEventInstance] = useState(null);
  const [isAddingCompletion, setIsAddingCompletion] = useState(false);
  const [eventCompletions, setEventCompletions] = useState({});
  const [isEditMode, setIsEditMode] = useState(mode === 'edit');

  // Debug URL parameters
  useEffect(() => {
    console.log('CourseDetail URL Params:', { id, categoryId, subcategoryId, mode });
  }, [id, categoryId, subcategoryId, mode]);
  
  useEffect(() => {
    const fetchCourse = async () => {
      try {
        setLoading(true);
        
        console.log('Fetching course data for categoryId:', categoryId);
        
        if (!categoryId) {
          setError('Category ID is missing');
          setLoading(false);
          return;
        }
        
        const courseRef = doc(db, 'coursecategories', categoryId);
        const courseSnap = await getDoc(courseRef);
        
        if (!courseSnap.exists()) {
          console.error('Course category not found for ID:', categoryId);
          setError('Course category not found');
          setLoading(false);
          return;
        }
        
        const categoryData = courseSnap.data();
        console.log('Category data:', categoryData);
        
        // Check if we need to find a specific subcategory
        if (subcategoryId) {
          const subcategory = categoryData.subcategories?.find(sub => sub.id === subcategoryId);
          
          if (subcategory) {
            console.log('Found subcategory:', subcategory);
            console.log('Subcategory image URL:', subcategory.imageUrl);
            console.log('Subcategory formId:', subcategory.formId);
            
            // Check materials and their URLs for debugging
            if (subcategory.materials && subcategory.materials.length > 0) {
              console.log('Subcategory has materials:', subcategory.materials.length);
              subcategory.materials.forEach((mat, idx) => {
                console.log(`Material ${idx}:`, mat.name, 'URL:', mat.url);
              });
            } else {
              console.log('Subcategory has no materials');
            }
            
            setCourse({ 
              categoryId: categoryId,
              categoryName: categoryData.name,
              ...subcategory
            });
          } else {
            console.error('Subcategory not found for ID:', subcategoryId);
            setError('Subcategory not found');
          }
        } else {
          // If no subcategoryId, just display the category data
          console.log('No subcategoryId, displaying category data');
          setCourse({
            ...categoryData,
            categoryId: categoryId,
            categoryName: categoryData.name,
            name: categoryData.name // Set name to category name for consistent display
          });
        }
      } catch (err) {
        console.error('Error fetching course:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchCourse();
  }, [categoryId, subcategoryId]);

  useEffect(() => {
    const fetchCompletionLogs = async () => {
      if (!auth.currentUser) return;
      
      const userRef = doc(db, 'users', auth.currentUser.uid);
      const userDoc = await getDoc(userRef);
      
      if (userDoc.exists()) {
        const logs = userDoc.data().completionLogs || [];
        const filteredLogs = logs.filter(log => 
          log.subcategoryId === subcategoryId
        );
        setCompletionLogs(filteredLogs);
      }
    };

    fetchCompletionLogs();
  }, [subcategoryId]);

  useEffect(() => {
    const fetchAllUserLogs = async () => {
      if (!course?.assignedUsers) return;
      
      const allLogs = [];
      for (const user of course.assignedUsers) {
        const userRef = doc(db, 'users', user.value || user.id);
        const userDoc = await getDoc(userRef);
        
        if (userDoc.exists()) {
          const logs = userDoc.data().completionLogs || [];
          const userLogs = logs
            .filter(log => log.subcategoryId === subcategoryId)
            .map(log => ({
              ...log,
              userLabel: user.label || user.name
            }));
          allLogs.push(...userLogs);
        }
      }
      setCompletionLogs(allLogs);
    };

    fetchAllUserLogs();
  }, [course, subcategoryId]);

  useEffect(() => {
    const checkPermissions = async () => {
      if (!user) return;
      
      if (user.role==='global_admin') {
        setCanEdit(true);
        return;
      }

      if (user.role==='admin' && user.churchId === id) {
        setCanEdit(true);
        return;
      }

      setCanEdit(false);
    };

    checkPermissions();
  }, [user, id]);

  useEffect(() => {
    const checkUserCompletionStatus = async () => {
      if (!user || !course || !course.assignedUsers) return;
      
      const isAssigned = course.assignedUsers.some(
        assignedUser => assignedUser.value === user.uid || assignedUser.id === user.uid
      );
      
      if (!isAssigned) {
        setUserCompletionStatus(null);
        return;
      }
      
      try {
        const userRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userRef);
        
        if (userDoc.exists()) {
          const logs = userDoc.data().completionLogs || [];
          const subcategoryLogs = logs.filter(log => log.subcategoryId === subcategoryId);

          // Get all required events from this subcategory
          const requiredEvents = course.events?.flatMap(event => {
            const instances = event.instances || [];
            return instances.filter(instance => instance.status === 'required');
          }) || [];

          // Check if all required events are completed
          const completedRequiredEvents = requiredEvents.every(requiredEvent => 
            subcategoryLogs.some(log => 
              log.eventInstanceId === requiredEvent.id && !log.isDeleted
            )
          );

          // If there are completed events but not all required ones
          const hasAnyCompletion = subcategoryLogs.length > 0;

          if (completedRequiredEvents) {
            setUserCompletionStatus('complete');
          } else if (hasAnyCompletion) {
            setUserCompletionStatus('in_progress');
          } else {
            setUserCompletionStatus('incomplete');
          }
        }
      } catch (error) {
        console.error('Error checking user completion status:', error);
      }
    };
    
    checkUserCompletionStatus();
  }, [user, course, subcategoryId]);

  useEffect(() => {
    const fetchEventCompletions = async () => {
      if (!user || !course?.events) return;
      
      const userRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userRef);
      
      if (userDoc.exists()) {
        const logs = userDoc.data().completionLogs || [];
        const completions = {};
        
        course.events.forEach(event => {
          const instances = generateRecurringInstances(event);
          instances.forEach(instance => {
            const completion = logs.find(log => 
              log.eventInstanceId === instance.id && !log.isDeleted
            );
            if (completion) {
              completions[instance.id] = {
                completed: true,
                note: completion.note,
                completedAt: completion.completedAtFormatted
              };
            }
          });
        });
        
        setEventCompletions(completions);
      }
    };

    fetchEventCompletions();
  }, [user, course]);

  const handleCompletion = async () => {
    if (!selectedViewUser && !editingLogIndex) {
      alert('Please select a user first');
      return;
    }

    if (!selectedEventInstance) {
      alert('Please select an event instance first');
      return;
    }

    // Validate user info
    const userId = editingLogIndex ? completionLogs[editingLogIndex].userId : selectedViewUser.value;
    const userEmail = editingLogIndex ? completionLogs[editingLogIndex].userEmail : selectedViewUser.email;
    const userLabel = editingLogIndex ? completionLogs[editingLogIndex].userLabel : selectedViewUser.label;

    if (!userId || !userEmail || !userLabel) {
      alert('Invalid user information');
      return;
    }

    const now = new Date();
    const formattedDate = now.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });

    // Ensure all required event properties exist
    const eventId = selectedEventInstance.parentEventId || selectedEventInstance.id;
    const instanceId = selectedEventInstance.id;
    
    if (!eventId || !instanceId) {
      console.error('Invalid event or instance ID:', selectedEventInstance);
      alert('Invalid event information');
      return;
    }

    const completionLog = {
      id: Date.now().toString(),
      subcategoryId: subcategoryId || '',
      categoryId: categoryId || '',
      categoryName: course?.categoryName || '',
      subcategoryName: course?.name || '',
      eventId: eventId,
      eventInstanceId: instanceId,
      eventTitle: selectedEventInstance.title || 'Untitled Event',
      eventStatus: selectedEventInstance.status || 'optional',
      eventOrder: selectedEventInstance.order || 1,
      eventDate: selectedEventInstance.startDate,
      eventTime: selectedEventInstance.startHour,
      completedAt: {
        seconds: Math.floor(now.getTime() / 1000),
        nanoseconds: 0
      },
      completedAtFormatted: formattedDate,
      note: completionNote || '',
      status: "complete",
      userId,
      userEmail,
      userLabel,
      selectedEvent: {
        date: selectedEventInstance.startDate,
        time: `${selectedEventInstance.startHour} - ${selectedEventInstance.endHour}`,
        status: selectedEventInstance.status || 'optional',
        order: selectedEventInstance.order || 1,
        instanceNumber: selectedEventInstance.instanceNumber || 1,
        isRecurring: selectedEventInstance.isRecurring || false,
        recurrencePattern: selectedEventInstance.recurrencePattern || null
      }
    };

    try {
      const userRef = doc(db, 'users', completionLog.userId);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) {
        throw new Error('User document not found');
      }

      let existingLogs = userDoc.data()?.completionLogs || [];

      if (editingLogIndex !== null) {
        existingLogs = existingLogs.map(log => 
          log.id === completionLogs[editingLogIndex].id
            ? { ...log, note: completionNote || '' }
            : log
        );
      } else {
        existingLogs = [...existingLogs, completionLog];
      }

      await updateDoc(userRef, {
        completionLogs: existingLogs
      });

      // Update local state with new log immediately
      const newLog = {
        ...completionLog,
        event: selectedEventInstance // Add the full event data
      };

      if (editingLogIndex !== null) {
        setCompletionLogs(prevLogs => 
          prevLogs.map((log, index) => 
            index === editingLogIndex 
              ? { ...log, note: completionNote || '' }
              : log
          )
        );
        setFilteredLogs(prevLogs =>
          prevLogs.map((log, index) =>
            index === editingLogIndex
              ? { ...log, note: completionNote || '' }
              : log
          )
        );
      } else {
        setCompletionLogs(prevLogs => [newLog, ...prevLogs]);
        if (selectedViewUser) {
          setFilteredLogs(prevLogs => [newLog, ...prevLogs]);
        }
      }

      // Reset form
      setCompletionNote('');
      setSelectedEvent(null);
      setSelectedEventInstance(null);
      setIsAddingCompletion(false);
      setEditingLogIndex(null);
      setSelectedUser(null);
    } catch (error) {
      console.error('Error logging completion:', error);
      alert(`Error saving completion log: ${error.message}`);
    }
  };

  const markAsIncomplete = async (userId, userName, userEmail) => {
    try {
      const userRef = doc(db, 'users', userId);
      const userDoc = await getDoc(userRef);
      let existingLogs = userDoc.data()?.completionLogs || [];
      
      const existingLog = existingLogs.find(log => 
        log.subcategoryId === subcategoryId
      );
      
      if (!existingLog) {
        const now = new Date();
        const incompleteLog = {
          id: Date.now().toString(),
          subcategoryId,
          categoryId,
          categoryName: course?.categoryName || '',
          subcategoryName: course?.name || '',
          status: "incomplete",
          completedAt: {
            seconds: Math.floor(now.getTime() / 1000),
            nanoseconds: 0
          },
          completedAtFormatted: now.toLocaleString(),
          note: '',
          userId: userId,
          userEmail: userEmail,
          userLabel: userName
        };

        await updateDoc(userRef, {
          completionLogs: [...existingLogs, incompleteLog]
        });
      }
    } catch (error) {
      console.error('Error creating incomplete log:', error);
    }
  };

  const handleEditLog = (index) => {
    setCompletionNote(completionLogs[index].note || '');
    setEditingLogIndex(index);
    setIsAddingCompletion(true);
  };

  const handleUserSelect = (selectedOption) => {
    setSelectedViewUser(selectedOption);
    if (selectedOption) {
      const userLogs = completionLogs.filter(log => 
        log.userId === (selectedOption.value || selectedOption.id)
      );
      setFilteredLogs(userLogs);
    } else {
      setFilteredLogs(completionLogs);
    }
  };

  const handleDeleteLog = async (index, log) => {
    if (!window.confirm('Are you sure you want to delete this completion log?')) {
      return;
    }
  
    try {
      const userRef = doc(db, 'users', log.userId);
      const userDoc = await getDoc(userRef);
      let existingLogs = userDoc.data()?.completionLogs || [];
  
      existingLogs = existingLogs.filter(existingLog => existingLog.id !== log.id);
  
      await updateDoc(userRef, {
        completionLogs: existingLogs
      });
  
      setCompletionLogs(prevLogs => prevLogs.filter((_, i) => i !== index));
      setFilteredLogs(prevLogs => prevLogs.filter((_, i) => i !== index));
  
    } catch (error) {
      console.error('Error deleting completion log:', error);
      alert('Failed to delete completion log');
    }
  };

  const handleBackClick = (id) => {
    navigate(`/church/${id}/course-categories`);
  };

  const handleEditClick = () => {
    // Navigate to edit mode
    if (subcategoryId) {
      navigate(`/church/${id}/course-categories/${categoryId}/${subcategoryId}/edit`);
    } else {
      navigate(`/church/${id}/course-categories/${categoryId}/edit`);
    }
    setIsEditMode(true);
  };

  const handleViewClick = () => {
    // Navigate back to view mode
    if (subcategoryId) {
      navigate(`/church/${id}/course-categories/${categoryId}/${subcategoryId}`);
    } else {
      navigate(`/church/${id}/course-categories/${categoryId}`);
    }
    setIsEditMode(false);
  };
  // Get a deterministic index based on course id or name for consistent color
  const colorIndex = course?.id ? 
    course.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) : 
    (course?.name ? course.name.length : 0);
    
  const headerStyles = {
    backgroundImage: course?.imageUrl ? `url(${course.imageUrl})` : 'none',
    backgroundColor: course?.imageUrl ? 'transparent' : getGenericBackgroundColor(colorIndex),
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    minHeight: '400px',
    position: 'relative',
    display: 'flex',
    alignItems: 'flex-end',
    padding: '20px',
    borderRadius: '10px',
    overflow: 'hidden',
    marginBottom: '20px'
  };

  const Pagination = ({ totalItems, itemsPerPage, currentPage, onPageChange }) => {
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        gap: '10px',
        marginTop: '20px'
      }}>
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          style={{
            padding: '8px 12px',
            border: '1px solid #e2e8f0',
            borderRadius: '4px',
            backgroundColor: currentPage === 1 ? '#f1f5f9' : 'white',
            cursor: currentPage === 1 ? 'not-allowed' : 'pointer'
          }}
        >
          Previous
        </button>
        
        <span style={{
          padding: '8px 12px',
          border: '1px solid #e2e8f0',
          borderRadius: '4px',
          backgroundColor: '#f8fafc'
        }}>
          {currentPage} of {totalPages}
        </span>
        
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          style={{
            padding: '8px 12px',
            border: '1px solid #e2e8f0',
            borderRadius: '4px',
            backgroundColor: currentPage === totalPages ? '#f1f5f9' : 'white',
            cursor: currentPage === totalPages ? 'not-allowed' : 'pointer'
          }}
        >
          Next
        </button>
      </div>
    );
  };

  const renderEvents = (events) => {
    if (!events || events.length === 0) return null;

    // Get all instances including recurring events
    const allInstances = events.flatMap(event => {
      // Get recurring instances directly from event.instances if available
      if (event.isRecurring && event.instances) {
        return event.instances.map(instance => ({
          ...instance,
          id: instance.id || `${event.id}-${instance.instanceNumber}`,
          parentEventId: event.id,
          instanceNumber: instance.instanceNumber,
          isRecurring: true,
          title: instance.instanceTitle || instance.title || event.title,
          instanceTitle: instance.instanceTitle || instance.title || event.title,
          parentTitle: event.title,
          status: instance.status || 'optional',
          order: instance.order || instance.instanceNumber || 1,
          recurrencePattern: event.recurrencePattern || 'weekly'
        }));
      }

      // Handle non-recurring events
      const baseEvent = {
        ...event,
        startDate: event.startDate || new Date().toISOString().split('T')[0],
        endDate: event.endDate || event.startDate || new Date().toISOString().split('T')[0],
        startHour: event.startHour || '09:00 AM',
        endHour: event.endHour || '10:00 AM'
      };

      if (!event.recurring && !event.isRecurring) {
        return [{
          ...baseEvent,
          id: event.id,
          parentEventId: event.id,
          isRecurring: false,
          instanceNumber: 1,
          title: event.instanceTitle || event.title,
          instanceTitle: event.instanceTitle || event.title,
          parentTitle: event.title,
          status: event.status || 'optional',
          order: event.order || 1
        }];
      }

      // Fallback to generating recurring instances if no instances array
      return generateRecurringInstances(baseEvent);
    });

    // Sort by date
    const sortedEvents = allInstances.sort((a, b) => {
      const dateA = new Date(a.startDate.replace(/-/g, '/'));
      const dateB = new Date(b.startDate.replace(/-/g, '/'));
      return dateA - dateB;
    });

    // Group events by parent event
    const groupedEvents = sortedEvents.reduce((groups, event) => {
      const key = event.parentEventId;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(event);
      return groups;
    }, {});

    return (
      <div style={{ marginTop: '20px' }}>
        {Object.entries(groupedEvents).map(([parentId, instances]) => {
          // Ensure we have valid instances
          if (!instances || instances.length === 0) return null;
          
          const firstInstance = instances[0];
          if (!firstInstance) return null;

          return (
            <div key={parentId} className="event-group" style={{
              marginBottom: '30px',
              backgroundColor: 'white',
              borderRadius: '8px',
              overflow: 'hidden',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
            }}>
              <div style={{
                backgroundColor: '#f8fafc',
                padding: '12px 16px',
                borderBottom: '1px solid #e2e8f0'
              }}>
                <h3 style={{ margin: 0, color: '#1a237e' }}>
                  {firstInstance.instanceTitle || firstInstance.title}
                  {firstInstance.isRecurring && (
                    <span style={{
                      marginLeft: '8px',
                      fontSize: '0.875rem',
                      color: '#6b7280',
                      fontWeight: 'normal'
                    }}>
                      ({firstInstance.recurrencePattern || 'weekly'})
                    </span>
                  )}
                </h3>
              </div>
              <div style={{ padding: '12px' }}>
                {instances.map((instance, index) => {
                  const stats = calculateEventStats(instance, completionLogs);
                  
                  return (
                    <div key={instance.id} style={{
                      padding: '12px',
                      borderBottom: index < instances.length - 1 ? '1px solid #e2e8f0' : 'none',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      backgroundColor: selectedEventInstance?.id === instance.id ? '#f0f7ff' : 'transparent',
                      transition: 'background-color 0.2s'
                    }}>
                      <div>
                        <div style={{ fontWeight: '500' }}>
                          {instance.instanceTitle || instance.title}
                          {eventCompletions[instance.id] && (
                            <span style={{
                              marginLeft: '8px',
                              padding: '2px 8px',
                              backgroundColor: '#10b981',
                              color: 'white',
                              borderRadius: '12px',
                              fontSize: '0.75rem'
                            }}>
                              Completed
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.875rem', color: '#4b5563' }}>
                          Instance #{instance.instanceNumber}
                        </div>
                        <div style={{ fontSize: '0.875rem', color: '#4b5563' }}>
                          Date: {formatDate(instance.startDate)}
                        </div>
                        <div style={{ fontSize: '0.875rem', color: '#4b5563' }}>
                          Time: {formatTime(instance.startHour)} - {formatTime(instance.endHour)}
                        </div>
                        <div style={{ 
                          fontSize: '0.875rem', 
                          color: '#4b5563',
                          marginTop: '8px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px'
                        }}>
                          <span style={{
                            padding: '2px 8px',
                            backgroundColor: '#f3f4f6',
                            borderRadius: '12px',
                            fontSize: '0.75rem'
                          }}>
                            {stats.totalCompletions} completion{stats.totalCompletions !== 1 ? 's' : ''}
                          </span>
                          {stats.completedBy.length > 0 && (
                            <div style={{ fontSize: '0.75rem' }}>
                              by: {stats.completedBy.map(c => c.userLabel).join(', ')}
                            </div>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span style={{
                          padding: '4px 8px',
                          borderRadius: '12px',
                          fontSize: '0.75rem',
                          backgroundColor: instance.status === 'required' ? '#fef2f2' : '#f0fdf4',
                          color: instance.status === 'required' ? '#dc2626' : '#16a34a'
                        }}>
                          {instance.status || 'optional'}
                        </span>
                        <button
                          onClick={() => {
                            setSelectedEventInstance(instance);
                            setIsAddingCompletion(true);
                          }}
                          style={{
                            padding: '4px 12px',
                            backgroundColor: selectedEventInstance?.id === instance.id ? '#10b981' : '#1a237e',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.875rem'
                          }}
                        >
                          {selectedEventInstance?.id === instance.id ? 'Selected' : 'Select for Completion'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div style={{...commonStyles.container, textAlign:"start"}}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
        <button
          onClick={() => handleBackClick(id)}
          style={{ ...commonStyles.backButtonLink }}
        >
          ← Back to Categories
        </button>

        {canEdit && (
          <div className="action-buttons">
            {isEditMode ? (
              <button
                onClick={handleViewClick}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.875rem'
                }}
              >
                View Mode
              </button>
            ) : (
              <button
                onClick={handleEditClick}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#10b981',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.875rem'
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '5px', verticalAlign: 'text-bottom' }}>
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
                Settings
              </button>
            )}
          </div>
        )}
      </div>

      <ChurchHeader id={id} />

      <div className="page-header" style={headerStyles}>
        <div className="header-overlay" style={{ 
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.8) 100%)',
          zIndex: 1
        }}></div>
        
        {!course?.imageUrl && course?.name && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -70%)',
            fontSize: '8rem',
            fontWeight: 'bold',
            color: 'rgba(255, 255, 255, 0.3)',
            zIndex: 1
          }}>
            {course.name.charAt(0).toUpperCase()}
          </div>
        )}
        
        {course?.imageUrl && (
          <img 
            src={course.imageUrl} 
            alt={course?.name || 'Course image'}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: 'center',
              zIndex: 0
            }}
            onError={handleImageError}
            onLoad={() => console.log('Image loaded successfully:', course.imageUrl)}
          />
        )}
        
        <div className="header-content" style={{ 
          position: 'relative',
          zIndex: 2,
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end'
        }}>
          <div>
            <h1 style={{ 
              color: 'white',
              margin: '20px 0',
              fontSize: '2.5rem' 
            }}>{course?.name}</h1>
            <div className="course-tags">
              <span className="category-tag">{course?.categoryName}</span>
              {course?.prerequisiteId && (
                <span className="prerequisite-tag">Has Prerequisites</span>
              )}
              <span style={{color:"#fff", textAlign:"center"}}>Order: #{course?.order || 1}</span>
            </div>
          </div>
          
          {isEditMode && canEdit && (
            <div style={{ 
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              padding: '10px',
              borderRadius: '8px',
              backdropFilter: 'blur(5px)'
            }}>
              <button 
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#9333ea',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  marginBottom: '10px',
                  width: '100%',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
                onClick={() => navigate(`/church/${id}/course-admin/${subcategoryId ? 'subcategory' : 'category'}/${subcategoryId || categoryId}/edit`)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
                Edit {subcategoryId ? 'Subcategory' : 'Category'}
              </button>
              
              {subcategoryId && (
                <button 
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#10b981',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    width: '100%',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                  onClick={() => navigate(`/church/${id}/course-admin/events/${subcategoryId}`)}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                  </svg>
                  Manage Events
                </button>
              )}
              
              <button 
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#f59e0b',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  marginTop: '10px',
                  width: '100%',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
                onClick={() => navigate(`/church/${id}/course-admin/assignments/${subcategoryId || categoryId}`)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 00-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 010 7.75"></path>
                </svg>
                Manage Assignments
              </button>
            </div>
          )}
        </div>
        
        {userCompletionStatus && !isEditMode && (
          <div className="user-completion-status" style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
            zIndex: 10,
            backgroundColor: userCompletionStatus === 'complete' ? '#10b981' 
              : userCompletionStatus === 'in_progress' ? '#f59e0b'
              : '#ef4444',
            color: 'white',
            transition: 'all 0.3s ease'
          }}>
            {userCompletionStatus === 'complete' ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            ) : userCompletionStatus === 'in_progress' ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            )}
          </div>
        )}
      </div>

      <div style={{
        backgroundColor: 'white',
        borderRadius: '10px',
        padding: '20px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        marginBottom: '20px'
      }}>
        {loading ? (
          <div className="loading-skeleton">
            <Skeleton height={400} className="banner-skeleton" />
            <div className="content-wrapper">
              <Skeleton height={40} width={300} className="title-skeleton" />
              <Skeleton count={3} className="content-skeleton" />
            </div>
          </div>
        ) : error ? (
          <div className="error-message">{error}</div>
        ) : (
          <>
            <div className="course-content" style={{
              padding: '20px',
              backgroundColor: 'white',
              borderRadius: '8px'
            }}>
              <div className="course-card">
                <div className="course-content">
                  {course?.description && (
                    <p className="course-description">{course.description}</p>
                  )}

                  {course?.events && course.events.length > 0 && (
                    <div className="course-events">
                      <h2>Course Events</h2>
                      {renderEvents(course.events)}
                    </div>
                  )}                  {course?.materials && course.materials.length > 0 && (
                    <div className="course-materials">
                      <h2>Course Materials</h2>
                      <div className="materials-grid" style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                        gap: '24px',
                        padding: '20px 0',
                        width: '100%'
                      }}>
                        {course.materials.map((material, index) => (
                          <MaterialCard key={index} material={material} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Display associated form if subcategory has a formId */}
                  {course?.formId && (
                    <div className="course-form">
                      <h2>Course Form</h2>
                      <FormDisplay 
                        churchId={id}
                        formId={course.formId}
                        onSubmit={(submissionData) => {
                          console.log('Form submitted:', submissionData);
                          // Optionally handle successful form submission
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {userCompletionStatus && (
              <div className="user-completion-status" style={{
                marginTop: '20px',
                padding: '12px 20px',
                borderRadius: '6px',
                textAlign: 'center',
                fontWeight: '500',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                backgroundColor: userCompletionStatus === 'complete' ? '#dcfce7' : '#fff7ed',
                color: userCompletionStatus === 'complete' ? '#166534' : '#9a3412',
                border: `1px solid ${userCompletionStatus === 'complete' ? '#86efac' : '#fed7aa'}`
              }}>
              </div>
            )}

            <div className="completion-section" style={{
              backgroundColor: 'white',
              borderRadius: '8px',
              padding: '20px',
              marginTop: '20px'
            }}>
              <div className="completion-header">
                <div className="user-filter" style={{marginBottom:"20px"}}>
                  <Select
                    value={selectedViewUser}
                    onChange={handleUserSelect}
                    options={course?.assignedUsers?.map(user => ({
                      value: user.value || user.id,
                      label: user.label || user.name,
                      email: user.email
                    })) || []}
                    isClearable
                    isSearchable
                    placeholder="Filter by user..."
                    className="user-select-filter"
                  />
                </div>
                {canEdit && !isAddingCompletion && (
                  <button 
                    style={commonStyles.addButton}
                    onClick={() => {
                      setSelectedUser(null);
                      setCompletionNote('');
                      setIsAddingCompletion(true);
                    }}
                  >
                    Add New Completion
                  </button>
                )}
              </div>

              {isAddingCompletion && (
                <div className="add-completion-section" style={{
                  backgroundColor: '#f8f9fa',
                  padding: '20px',
                  borderRadius: '8px',
                  marginBottom: '20px'
                }}>
                  <h4 style={{ marginBottom: '15px' }}>Add New Completion Log</h4>
                  
                  <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', marginBottom: '10px', fontWeight: 500 }}>
                      Select Event Instance:
                    </label>
                    <div className="events-list" style={{
                      maxHeight: '400px',
                      overflowY: 'auto',
                      border: '1px solid #e5e7eb',
                      borderRadius: '6px'
                    }}>
                      {course?.events?.map((event) => {
                        // Get all instances for this event
                        const allInstances = generateRecurringInstances(event);
                        
                        return (
                          <div key={event.id} className="event-group">
                            <div className="event-group-header" style={{
                              padding: '10px',
                              backgroundColor: '#f8fafc',
                              borderBottom: '1px solid #e5e7eb',
                              fontWeight: '500'
                            }}>
                              {event.title}
                              {event.isRecurring && (
                                <span style={{
                                  marginLeft: '8px',
                                  fontSize: '0.875rem',
                                  color: '#6b7280'
                                }}>
                                  (Recurring)
                                </span>
                              )}
                            </div>
                            {allInstances.map((instance, index) => (
                              <div 
                                key={`${event.id}-${index}`}
                                className="event-instance-item"
                                style={{
                                  padding: '12px',
                                  borderBottom: '1px solid #e5e7eb',
                                  backgroundColor: selectedEventInstance?.id === instance.id ? '#eff6ff' : 'white',
                                  cursor: 'pointer'
                                }}
                                onClick={() => setSelectedEventInstance(instance)}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <div>
                                    <div>{instance.title}</div>
                                    <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                                      {formatDate(instance.startDate)} at {formatTime(instance.startHour)}
                                    </div>
                                  </div>
                                  <span style={{
                                    padding: '4px 8px',
                                    borderRadius: '4px',
                                    backgroundColor: instance.status === 'required' ? '#fef2f2' : '#f0fdf4',
                                    color: instance.status === 'required' ? '#dc2626' : '#16a34a',
                                    fontSize: '0.75rem',
                                    fontWeight: '500'
                                  }}>
                                    {instance.status === 'required' ? 'Required' : 'Optional'}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {selectedEventInstance && (
                    <div style={{ marginBottom: '20px' }}>
                      <label style={{ display: 'block', marginBottom: '10px', fontWeight: 500 }}>
                        Completion Notes (Optional):
                      </label>
                      <textarea
                        value={completionNote}
                        onChange={(e) => setCompletionNote(e.target.value)}
                        placeholder="Enter completion notes..."
                        style={{
                          width: '100%',
                          padding: '8px',
                          borderRadius: '6px',
                          border: '1px solid #e5e7eb',
                          minHeight: '100px'
                        }}
                      />
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button 
                      onClick={handleCompletion}
                      disabled={!selectedViewUser || !selectedEventInstance}
                      style={{
                        ...commonStyles.confirmButton,
                        opacity: (!selectedViewUser || !selectedEventInstance) ? 0.5 : 1
                      }}
                    >
                      Save Completion
                    </button>
                    <button 
                      style={commonStyles.cancelButton}
                      onClick={() => {
                        setIsAddingCompletion(false);
                        setCompletionNote('');
                        setSelectedEvent(null);
                        setSelectedEventInstance(null);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {(selectedViewUser ? filteredLogs : completionLogs)
                .sort((a, b) => {
                  const getTime = (log) => {
                    if (log.completedAt?.seconds) {
                      return log.completedAt.seconds * 1000;
                    }
                    const date = new Date(log.completedAt);
                    return isNaN(date.getTime()) ? 0 : date.getTime();
                  };
                  return getTime(b) - getTime(a);
                })
                .map((log, index) => (
                  <div key={log.id || index} className="log-entry" style={{
                    backgroundColor: '#f8f9fa',
                    borderRadius: '8px',
                    padding: '15px',
                    marginBottom: '10px'
                  }}>
                    <div className="log-header" style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: '8px'
                    }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        <div className="completion-date" style={{ fontWeight: 'bold' }}>
                          {log.completedAtFormatted || formatDate(log.completedAt)}
                        </div>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                          <span className="event-title" style={{ color: '#1a237e' }}>
                            {log.eventTitle}
                          </span>
                          <span className={`status-badge ${log.eventStatus}`}>
                            {log.eventStatus}
                          </span>
                        </div>
                      </div>
                      <div className="log-info" style={{
                        display: 'flex',
                        gap: '10px',
                        alignItems: 'flex-start'
                      }}>
                        <span className="user-label">{log.userLabel || log.userEmail}</span>
                        {canEdit && (
                          <div className="log-actions" style={{ display: 'flex', gap: '5px' }}>
                            <button 
                              className="btn-edit"
                              onClick={() => handleEditLog(index)}
                              style={{
                                padding: '5px 10px',
                                backgroundColor: '#4CAF50',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer'
                              }}
                            >
                              Edit
                            </button>
                            <button 
                              className="btn-delete"
                              onClick={() => handleDeleteLog(index, log)}
                              style={{
                                padding: '5px 10px',
                                backgroundColor: '#dc3545',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer'
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="event-details" style={{
                      backgroundColor: '#fff',
                      padding: '10px',
                      borderRadius: '6px',
                      marginBottom: '10px',
                      border: '1px solid #e2e8f0'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '5px' }}>
                        <span style={{ fontWeight: 'bold' }}>Event:</span>
                        <span>{log.eventTitle}</span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', fontSize: '0.9em', color: '#4a5568' }}>
                        <div>
                          <span>Date:</span> {log.eventDate}
                        </div>
                        <div>
                          <span>Time:</span> {log.eventTime}
                        </div>
                        <div>
                          <span>Status:</span>
                          <span className={`status-badge ${log.eventStatus}`} style={{ marginLeft: '5px' }}>
                            {log.eventStatus}
                          </span>
                        </div>
                        <div>
                          <span>Order:</span> #{log.eventOrder}
                        </div>
                        {log.selectedEvent?.isRecurring && (
                          <div>
                            <span>Recurring:</span> {log.selectedEvent.recurrencePattern}
                          </div>
                        )}
                      </div>
                    </div>
                    {log.note && (
                      <p className="completion-note" style={{ 
                        marginTop: '10px',
                        padding: '10px',
                        backgroundColor: '#fff',
                        borderRadius: '4px',
                        border: '1px solid #e2e8f0'
                      }}>
                        {log.note}
                      </p>
                    )}
                  </div>
                ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const MaterialCard = ({ material }) => {
  const isVideo = material.type?.includes('video') || (material.url && material.url.match(/\.(mp4|webm|ogg|mov|avi)$/i));
  const isImage = material.type?.includes('image') || (material.url && material.url.match(/\.(jpg|jpeg|png|gif|svg|webp)$/i));
  
  const cardStyle = {
    backgroundColor: '#1A237E',
    padding: isImage ? "10px" : "10px 15px",
    color: 'white',
    borderRadius: '8px',
    overflow: 'hidden',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    transition: 'transform 0.3s ease',
    cursor: 'pointer',
    marginBottom: '15px',
    width: '100%',
    maxWidth: '560px',
    margin: '0 auto 15px auto'
  };

  if (isVideo) {
    return (
      <div className="video-material-card" style={cardStyle}>
        <h3 className="material-title" style={{
          padding: '10px',
          margin: 0,
          color: 'white'
        }}>{material.name || "Video"}</h3>
        <div className="video-container">
          <video 
            controls 
            className="video-player"
            style={{
              width: '100%',
              maxHeight: '315px',
              objectFit: 'contain',
              backgroundColor: '#000',
              borderRadius: '4px'
            }}
          >
            <source src={material.url} type={material.type || "video/mp4"} />
            Your browser does not support the video tag.
          </video>
        </div>
      </div>
    );
  }
  
  if (isImage) {
    return (
      <div className="image-material-card" style={cardStyle}>
        <h3 className="material-title" style={{
          padding: '10px',
          margin: 0,
          color: 'white'
        }}>{material.name || "Image"}</h3>
        <div className="image-container" style={{
          backgroundColor: '#000',
          borderRadius: '4px',
          padding: '5px'
        }}>
          <img
            src={material.url}
            alt={material.name || "Material Image"}
            style={{
              width: '100%',
              maxHeight: '315px',
              objectFit: 'contain',
              borderRadius: '4px'
            }}
            onError={(e) => {
              console.error("Failed to load image:", material.url);
              e.target.src = "/img/image-fallback.svg"; // Fallback image
              e.target.style.opacity = 0.7;
              e.target.style.padding = "20px";
            }}
          />
        </div>
      </div>
    );
  }
  
  return (
    <div className="material-card" style={cardStyle}>
      <span>{material.name || "Material"}</span>
      {material.url ? (
        <a 
          href={material.url} 
          target="_blank" 
          rel="noopener noreferrer" 
          className="material-link"
          onClick={(e) => {
            console.log("Accessing material URL:", material.url);
            // If URL access fails, log the error
            const img = new Image();
            img.onerror = () => console.error("Failed to load image:", material.url);
            img.src = material.url;
          }}
        >
          Download
        </a>
      ) : (
        <span style={{color: '#ff9999'}}>URL not available</span>
      )}
    </div>
  );
};

export default CourseDetail;