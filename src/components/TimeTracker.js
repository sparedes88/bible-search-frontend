import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { 
  collection, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  where, 
  onSnapshot,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  getDocs,
  getDoc
} from 'firebase/firestore';
import { toast } from 'react-toastify';
import { canAccessModule } from '../utils/permissions';
import TaskProgress from './TaskProgress';
import ChurchHeader from './ChurchHeader';
import commonStyles from '../pages/commonStyles';
import './TimeTracker.css';

// Helper function to format time in seconds to HH:MM:SS or MM:SS
const formatTime = (seconds) => {
  if (!seconds || seconds === 0) return '00:00';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  } else {
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
};

// Helper function to get current time in 12-hour format
const getCurrentTime12Hour = () => {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const displayMinutes = minutes.toString().padStart(2, '0');
  return `${displayHours}:${displayMinutes} ${ampm}`;
};

// Helper function to get default start time (current time rounded to nearest 15 minutes)
const getDefaultStartTime = () => {
  const now = new Date();
  const minutes = now.getMinutes();
  const roundedMinutes = Math.floor(minutes / 15) * 15;
  now.setMinutes(roundedMinutes);
  now.setSeconds(0);
  now.setMilliseconds(0);
  
  const hours = now.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const displayMinutes = now.getMinutes().toString().padStart(2, '0');
  return `${displayHours}:${displayMinutes} ${ampm}`;
};

// Helper function to get default end time (start time + 1 hour)
const getDefaultEndTime = (startTime) => {
  if (!startTime) return '';
  
  try {
    // Simple calculation without convertTo24Hour for now
    const now = new Date();
    const hours = now.getHours() + 1; // Add 1 hour to current time
    const minutes = now.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    const displayMinutes = minutes.toString().padStart(2, '0');
    return `${displayHours}:${displayMinutes} ${ampm}`;
  } catch (error) {
    console.error('Error calculating default end time:', error);
    return '';
  }
};

// Helper function to format time input with masking
const formatTimeInput = (value) => {
  if (!value) return '';
  
  // Remove any invalid characters, keep only numbers, colon, space, A, M, P
  let cleaned = value.replace(/[^0-9:AMP\s]/gi, '').toUpperCase();
  
  // Convert 24-hour format to 12-hour format
  if (cleaned.includes(':')) {
    const timeParts = cleaned.split(':');
    if (timeParts.length === 2) {
      const hours24 = parseInt(timeParts[0], 10);
      const minutes = timeParts[1].replace(/[^\d]/g, '');
      
      if (hours24 >= 0 && hours24 <= 23 && minutes.length >= 1 && minutes.length <= 2) {
        let hours12 = hours24;
        let ampm = 'AM';
        
        if (hours24 === 0) {
          hours12 = 12; // 00:00 becomes 12:00 AM
        } else if (hours24 === 12) {
          ampm = 'PM'; // 12:00 stays 12:00 PM
        } else if (hours24 > 12) {
          hours12 = hours24 - 12;
          ampm = 'PM';
        }
        
        // Return immediately to avoid further processing
        return `${hours12}:${minutes} ${ampm}`;
      }
    }
  }
  
  // Handle AM/PM formatting first
  if (cleaned.includes('A') || cleaned.includes('P')) {
    // Extract numbers and AM/PM
    const numbers = cleaned.replace(/[AMP\s]/g, '');
    const hasA = cleaned.includes('A');
    const hasP = cleaned.includes('P');
    
    // Format as HHMM AM/PM
    if (numbers.length >= 1 && numbers.length <= 4) {
      const ampm = hasP ? 'PM' : 'AM';
      if (numbers.length === 4) {
        // Format as HH:MM AM/PM for 4 digits
        cleaned = numbers.slice(0, 2) + ':' + numbers.slice(2) + ' ' + ampm;
      } else if (numbers.length === 3) {
        // Format as H:MM AM/PM for 3 digits
        cleaned = numbers.slice(0, 1) + ':' + numbers.slice(1) + ' ' + ampm;
      } else {
        // For 1-2 digits, just add AM/PM
        cleaned = numbers + ' ' + ampm;
      }
    } else {
      // Invalid number of digits, remove AM/PM
      cleaned = numbers;
    }
  } else {
    // No AM/PM yet, just keep the numbers (up to 4 digits)
    const numbersOnly = cleaned.replace(/[^0-9]/g, '');
    cleaned = numbersOnly.slice(0, 4);
  }
  
  // Limit length to prevent overly long inputs
  if (cleaned.length > 8) {
    cleaned = cleaned.slice(0, 8);
  }
  
  return cleaned;
};

// Helper function to validate time input (more permissive)
const isValidTimeInput = (value) => {
  if (!value || value.trim() === '') return true; // Empty is always valid
  
  const trimmed = value.trim();
  
  // Allow any single digit (1-9) - user might be typing "7:30 AM"
  if (/^\d{1}$/.test(trimmed)) {
    return true; // Allow any single digit
  }
  
  // Allow two digits - be very permissive
  if (/^\d{2}$/.test(trimmed)) {
    const hour = parseInt(trimmed, 10);
    return hour >= 1 && hour <= 24;
  }
  
  // Allow three digits
  if (/^\d{3}$/.test(trimmed)) {
    return true; // Allow any 3 digits
  }
  
  // Allow four digits
  if (/^\d{4}$/.test(trimmed)) {
    return true; // Allow any 4 digits
  }
  
  // Allow 24-hour format times (HH:MM)
  if (/^\d{1,2}:\d{1,2}$/.test(trimmed)) {
    const parts = trimmed.split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
  }
  
  // Allow formats with AM/PM
  if (/^\d{1,4}\s*AM?$/i.test(trimmed)) {
    const numbers = trimmed.replace(/\s*AM?\s*$/i, '');
    return numbers.length >= 1 && numbers.length <= 4;
  }
  
  if (/^\d{1,4}\s*PM?$/i.test(trimmed)) {
    const numbers = trimmed.replace(/\s*PM?\s*$/i, '');
    return numbers.length >= 1 && numbers.length <= 4;
  }
  
  // Allow colon formats
  if (/^\d{1,2}:\d{1,2}\s*(AM?|PM?)?$/i.test(trimmed)) {
    const hour = parseInt(trimmed.split(':')[0], 10);
    return hour >= 1 && hour <= 12;
  }
  
  // Full validation for complete time format
  const pattern = /^(1[0-2]|0?[1-9])(:[0-5][0-9])?\s*(AM|PM|am|pm)?$/i;
  return pattern.test(trimmed);
};

const TimeTracker = () => {
  const { id: churchId } = useParams();
  const { user } = useAuth();
  
  // Tab State
  const [activeTab, setActiveTab] = useState('timer');
  const [tabSwitchTimeout, setTabSwitchTimeout] = useState(null);

  // Debounced tab switching to prevent Firestore listener issues
  const handleTabChange = (newTab) => {
    // Prevent members from accessing restricted tabs
    if (user?.role === 'member' && newTab !== 'timer') {
      return;
    }
    
    if (tabSwitchTimeout) {
      clearTimeout(tabSwitchTimeout);
    }
    
    const timeout = setTimeout(() => {
      setActiveTab(newTab);
    }, 100); // Small delay to prevent rapid switching
    
    setTabSwitchTimeout(timeout);
  };
  
  // Time Tracking State
  const [isTracking, setIsTracking] = useState(false);
  const [currentSession, setCurrentSession] = useState(null);
  const [currentProject, setCurrentProject] = useState('');
  const [currentAreaOfFocus, setCurrentAreaOfFocus] = useState('');
  const [currentCostCode, setCurrentCostCode] = useState('');
  const [timeEntries, setTimeEntries] = useState([]);
  const [elapsedTime, setElapsedTime] = useState(0);
  
  // Permissions State
  const [hasTimeTrackerAccess, setHasTimeTrackerAccess] = useState(false);
  const [loadingPermissions, setLoadingPermissions] = useState(true);
  
  // Task Management State
  const [tasks, setTasks] = useState([]);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  
  // Submissions Management State
  const [submissions, setSubmissions] = useState([]);
  const [showSubmissionModal, setShowSubmissionModal] = useState(false);
  const [editingSubmission, setEditingSubmission] = useState(null);
  
  // Forms State
  // Manual entry form removed - now using inline table functionality
  
  // Inline add row state
  const [showAddRow, setShowAddRow] = useState(false);
  const [newRowData, setNewRowData] = useState(() => {
    const defaultStartTime = getDefaultStartTime();
    return {
      note: '',
      startTime: defaultStartTime,
      endTime: getDefaultEndTime(defaultStartTime),
      date: new Date().toISOString().split('T')[0],
      project: '',
      areaOfFocus: '',
      costCode: '',
      duration: '',
      durationMode: 'start' // 'start' = start + duration, 'end' = end + duration
    };
  });
  
  // Inline edit state
  const [editingRowId, setEditingRowId] = useState(null);
  const [editRowData, setEditRowData] = useState({
    note: '',
    startTime: '',
    endTime: '',
    date: '',
    project: '',
    areaOfFocus: '',
    costCode: ''
  });
  
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    priority: 'medium',
    dueDate: '',
    status: 'pending'
  });
  
  const [newSubmission, setNewSubmission] = useState({
    title: '',
    description: '',
    type: 'report',
    relatedTaskId: '',
    content: '',
    status: 'draft',
    dueDate: ''
  });
  
  const [taskProgress, setTaskProgress] = useState({
    taskId: '',
    date: new Date().toISOString().split('T')[0],
    progress: '',
    notes: ''
  });

  // Projects State
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [projectTimeEntries, setProjectTimeEntries] = useState([]);
  const [projectCostCodeStats, setProjectCostCodeStats] = useState({});
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [newProject, setNewProject] = useState({
    name: '',
    description: '',
    costCodeAssignments: []
  });

  // Cost Codes State
  const [costCodes, setCostCodes] = useState([]);
  const [newCostCodeAssignment, setNewCostCodeAssignment] = useState({
    costCodeId: '',
    hours: ''
  });
  const [showCostCodeModal, setShowCostCodeModal] = useState(false);
  const [editingCostCode, setEditingCostCode] = useState(null);
  const [newCostCode, setNewCostCode] = useState({
    code: '',
    description: '',
    category: '',
    costPerHour: '',
    areaOfFocusId: ''
  });

  // Areas of Focus State
  const [areasOfFocus, setAreasOfFocus] = useState([]);
  const [showAreaOfFocusModal, setShowAreaOfFocusModal] = useState(false);
  const [editingAreaOfFocus, setEditingAreaOfFocus] = useState(null);
  const [newAreaOfFocus, setNewAreaOfFocus] = useState({
    name: '',
    description: '',
    color: '#667eea'
  });

  // Inline creation state
  const [showInlineProjectForm, setShowInlineProjectForm] = useState(false);
  const [showInlineAreaForm, setShowInlineAreaForm] = useState(false);
  const [showInlineCostCodeForm, setShowInlineCostCodeForm] = useState(false);
  const [inlineProjectName, setInlineProjectName] = useState('');
  const [inlineAreaName, setInlineAreaName] = useState('');
  const [inlineAreaDescription, setInlineAreaDescription] = useState('');
  const [inlineAreaColor, setInlineAreaColor] = useState('#667eea');
  const [inlineCostCode, setInlineCostCode] = useState('');
  const [inlineCostDescription, setInlineCostDescription] = useState('');

  // Time Entries Table State
  const [searchTerm, setSearchTerm] = useState('');
  const [filterProject, setFilterProject] = useState('');
  const [filterAreaOfFocus, setFilterAreaOfFocus] = useState('');
  const [filterCostCode, setFilterCostCode] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [sortField, setSortField] = useState('startTime');
  const [sortDirection, setSortDirection] = useState('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [entriesPerPage] = useState(20);

  // Helper function to convert 12-hour time format to 24-hour format
  const convertTo24Hour = (time12h) => {
    if (!time12h) return '';

    // Remove any extra spaces and convert to uppercase
    const timeStr = time12h.trim().toUpperCase();

    // Match pattern like "9:00 AM", "9:00AM", "2:30 PM", "2:30PM", "9 AM", "9AM", etc.
    const match = timeStr.match(/^(\d{1,2})(?::(\d{1,2}))?\s*(AM|PM)$/);
    if (!match) {
      throw new Error('Invalid time format. Please use format like "9:00 AM", "9 AM", or "2:30 PM"');
    }

    let [_, hours, minutes, period] = match;
    hours = parseInt(hours, 10);
    minutes = minutes ? parseInt(minutes, 10) : 0; // Default to 0 if no minutes specified

    // Validate hours (1-12)
    if (hours < 1 || hours > 12) {
      throw new Error('Hours must be between 1 and 12');
    }

    if (period === 'PM' && hours !== 12) {
      hours += 12;
    } else if (period === 'AM' && hours === 12) {
      hours = 0;
    }

    // Return in 24-hour format
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  };

  // Helper function to calculate end time from start time + duration
  const calculateEndTime = (startTime, durationHours) => {
    if (!startTime || !durationHours) return '';

    try {
      // Try to convert to 24-hour format, but handle incomplete formats
      let startTime24h;
      try {
        startTime24h = convertTo24Hour(startTime);
      } catch (error) {
        // If conversion fails, try to add AM as default for incomplete times
        if (!startTime.includes('AM') && !startTime.includes('PM')) {
          // For incomplete times without AM/PM, try different defaults
          if (startTime.includes(':')) {
            // Has colon, probably HH:MM format - assume PM for afternoon hours
            const hour = parseInt(startTime.split(':')[0]);
            if (hour >= 12 && hour <= 23) {
              startTime24h = convertTo24Hour(startTime + ' PM');
            } else {
              startTime24h = convertTo24Hour(startTime + ' AM');
            }
          } else {
            // No colon, just numbers - assume AM
            startTime24h = convertTo24Hour(startTime + ' AM');
          }
        } else {
          // Has AM/PM but still failed conversion - might be invalid format
          console.debug('Time conversion failed for:', startTime);
          return '';
        }
      }

      const startDateTime = new Date(`2000-01-01T${startTime24h}`);
      const endDateTime = new Date(startDateTime.getTime() + (durationHours * 60 * 60 * 1000));

      const endHours = endDateTime.getHours();
      const endMinutes = endDateTime.getMinutes();
      const period = endHours >= 12 ? 'PM' : 'AM';
      const displayHours = endHours === 0 ? 12 : endHours > 12 ? endHours - 12 : endHours;

      return `${displayHours}:${endMinutes.toString().padStart(2, '0')} ${period}`;
    } catch (error) {
      console.debug('End time calculation error:', error);
      return '';
    }
  };

  // Helper function to calculate start time from end time + duration
  const calculateStartTime = (endTime, durationHours) => {
    if (!endTime || !durationHours) return '';

    try {
      // Try to convert to 24-hour format, but handle incomplete formats
      let endTime24h;
      try {
        endTime24h = convertTo24Hour(endTime);
      } catch (error) {
        // If conversion fails, try to add PM as default for incomplete times
        if (!endTime.includes('AM') && !endTime.includes('PM')) {
          // For incomplete times without AM/PM, try different defaults
          if (endTime.includes(':')) {
            // Has colon, probably HH:MM format - assume PM for afternoon hours
            const hour = parseInt(endTime.split(':')[0]);
            if (hour >= 12 && hour <= 23) {
              endTime24h = convertTo24Hour(endTime + ' PM');
            } else {
              endTime24h = convertTo24Hour(endTime + ' AM');
            }
          } else {
            // No colon, just numbers - assume PM for end times
            endTime24h = convertTo24Hour(endTime + ' PM');
          }
        } else {
          // Has AM/PM but still failed conversion - might be invalid format
          console.debug('Time conversion failed for:', endTime);
          return '';
        }
      }

      const endDateTime = new Date(`2000-01-01T${endTime24h}`);
      const startDateTime = new Date(endDateTime.getTime() - (durationHours * 60 * 60 * 1000));

      const startHours = startDateTime.getHours();
      const startMinutes = startDateTime.getMinutes();
      const period = startHours >= 12 ? 'PM' : 'AM';
      const displayHours = startHours === 0 ? 12 : startHours > 12 ? startHours - 12 : startHours;

      return `${displayHours}:${startMinutes.toString().padStart(2, '0')} ${period}`;
    } catch (error) {
      console.debug('Start time calculation error:', error);
      return '';
    }
  };

  // Check TimeTracker permissions
  useEffect(() => {
    const checkPermissions = async () => {
      if (!user || !churchId) {
        setLoadingPermissions(false);
        return;
      }

      try {
        const hasAccess = await canAccessModule(user, churchId, 'timetracker');
        setHasTimeTrackerAccess(hasAccess);
      } catch (error) {
        console.error('Error checking TimeTracker permissions:', error);
        setHasTimeTrackerAccess(false);
      } finally {
        setLoadingPermissions(false);
      }
    };

    checkPermissions();
  }, [user, churchId]);

  // Role-based tab restriction for members
  useEffect(() => {
    if (user?.role === 'member' && activeTab !== 'timer') {
      setActiveTab('timer');
    }
  }, [user?.role, activeTab]);

  // Timer interval
  useEffect(() => {
    let interval;
    if (isTracking && currentSession) {
      interval = setInterval(() => {
        const now = new Date();
        const start = new Date(currentSession.startTime);
        setElapsedTime(Math.floor((now - start) / 1000));
      }, 1000);
    }
    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [isTracking, currentSession]);

  // Component cleanup effect
  useEffect(() => {
    return () => {
      // Stop any running timers on component unmount
      if (isTracking) {
        setIsTracking(false);
        setCurrentSession(null);
        setElapsedTime(0);
      }
      // Clear any pending tab switch timeouts
      if (tabSwitchTimeout) {
        clearTimeout(tabSwitchTimeout);
      }
    };
  }, [isTracking, tabSwitchTimeout]);

  // Fetch time entries
  useEffect(() => {
    if (!user || !churchId) return;

    let isMounted = true;

    const timeEntriesRef = collection(db, `churches/${churchId}/timeEntries`);
    
    // Role-based query: members only see their own entries, admins see all
    let timeQuery;
    if (user.role === 'member') {
      timeQuery = query(
        timeEntriesRef,
        where('userId', '==', user.uid)
      );
    } else {
      // Admins and global admins can see all time entries
      timeQuery = query(timeEntriesRef);
    }

    const unsubscribe = onSnapshot(timeQuery, 
      (snapshot) => {
        if (!isMounted) return;
        
        try {
          const entries = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          })).sort((a, b) => {
            const aDate = parseDate(b.startTime);
            const bDate = parseDate(a.startTime);
            return (aDate ? aDate.getTime() : 0) - (bDate ? bDate.getTime() : 0);
          });
          console.log('Loaded time entries:', entries.length, 'entries');
          console.log('First entry sample:', entries[0]);
          setTimeEntries(entries);
        } catch (error) {
          console.error('Error processing time entries:', error);
        }
      },
      (error) => {
        console.error('Error fetching time entries:', error);
      }
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [user?.uid, churchId]);

  // Fetch tasks
  useEffect(() => {
    if (!user || !churchId) return;

    let isMounted = true;

    const tasksRef = collection(db, `churches/${churchId}/tasks`);
    const taskQuery = query(
      tasksRef,
      where('userId', '==', user.uid)
    );

    const unsubscribe = onSnapshot(taskQuery,
      (snapshot) => {
        if (!isMounted) return;
        
        try {
          const taskList = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          })).sort((a, b) => new Date(b.createdAt?.toDate?.() || b.createdAt) - new Date(a.createdAt?.toDate?.() || a.createdAt));
          setTasks(taskList);
        } catch (error) {
          console.error('Error processing tasks:', error);
        }
      },
      (error) => {
        console.error('Error fetching tasks:', error);
      }
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [user?.uid, churchId]);

  // Fetch submissions
  useEffect(() => {
    if (!user || !churchId) return;

    let isMounted = true;

    const submissionsRef = collection(db, `churches/${churchId}/submissions`);
    const submissionQuery = query(
      submissionsRef,
      where('userId', '==', user.uid)
    );

    const unsubscribe = onSnapshot(submissionQuery,
      (snapshot) => {
        if (!isMounted) return;
        
        try {
          const submissionList = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          })).sort((a, b) => new Date(b.createdAt?.toDate?.() || b.createdAt) - new Date(a.createdAt?.toDate?.() || a.createdAt));
          setSubmissions(submissionList);
        } catch (error) {
          console.error('Error processing submissions:', error);
        }
      },
      (error) => {
        console.error('Error fetching submissions:', error);
      }
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [user?.uid, churchId]);

  // Fetch projects
  useEffect(() => {
    if (!user || !churchId) return;

    let isMounted = true;
    let unsubscribe = null;

    try {
      const projectsRef = collection(db, `churches/${churchId}/projects`);
      const projectQuery = query(
        projectsRef,
        where('userId', '==', user.uid)
      );

      unsubscribe = onSnapshot(projectQuery,
        (snapshot) => {
          if (!isMounted) return;
          
          try {
            const projectList = snapshot.docs.map(doc => ({
              id: doc.id,
              ...doc.data()
            })).sort((a, b) => {
              const aDate = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
              const bDate = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
              return bDate - aDate;
            });
            setProjects(projectList);
          } catch (error) {
            console.error('Error processing projects:', error);
          }
        },
        (error) => {
          console.error('Error fetching projects:', error);
          // Don't re-throw to prevent crashes
        }
      );
    } catch (error) {
      console.error('Error setting up projects listener:', error);
    }

    return () => {
      isMounted = false;
      if (unsubscribe) {
        try {
          unsubscribe();
        } catch (error) {
          console.error('Error unsubscribing from projects:', error);
        }
      }
    };
  }, [user?.uid, churchId]);

  // Fetch areas of focus
  useEffect(() => {
    if (!user || !churchId) return;

    let isMounted = true;
    let unsubscribe = null;

    try {
      const areasRef = collection(db, `churches/${churchId}/areasOfFocus`);
      const areasQuery = query(
        areasRef,
        where('userId', '==', user.uid)
      );

      unsubscribe = onSnapshot(areasQuery,
        (snapshot) => {
          if (!isMounted) return;

          try {
            const areasList = snapshot.docs.map(doc => ({
              id: doc.id,
              ...doc.data()
            })).sort((a, b) => {
              const aDate = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
              const bDate = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
              return bDate - aDate;
            });
            setAreasOfFocus(areasList);
            console.log('Areas of focus loaded:', areasList.length, 'items');
          } catch (error) {
            console.error('Error processing areas of focus:', error);
          }
        },
        (error) => {
          console.error('Error fetching areas of focus:', error);
          // Don't re-throw to prevent crashes
        }
      );
    } catch (error) {
      console.error('Error setting up areas of focus listener:', error);
    }

    return () => {
      isMounted = false;
      if (unsubscribe) {
        try {
          unsubscribe();
        } catch (error) {
          console.error('Error unsubscribing from areas of focus:', error);
        }
      }
    };
  }, [user?.uid, churchId]);

  // Fetch cost codes
  useEffect(() => {
    if (!user || !churchId) return;

    let isMounted = true;
    let unsubscribe;

    try {
      const costCodesRef = collection(db, `churches/${churchId}/costCodes`);
      const costCodeQuery = query(
        costCodesRef,
        where('userId', '==', user.uid)
      );

      unsubscribe = onSnapshot(costCodeQuery,
        (snapshot) => {
          if (!isMounted) return;
          
          try {
            const costCodeList = snapshot.docs.map(doc => ({
              id: doc.id,
              ...doc.data()
            })).sort((a, b) => {
              const aDate = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
              const bDate = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
              return bDate - aDate;
            });
            setCostCodes(costCodeList);
            console.log('Cost codes loaded:', costCodeList.length, 'items');
          } catch (error) {
            console.error('Error processing cost codes:', error);
          }
        },
        (error) => {
          console.error('Error fetching cost codes:', error);
          // Don't re-throw to prevent crashes
        }
      );
    } catch (error) {
      console.error('Error setting up cost codes listener:', error);
    }

    return () => {
      isMounted = false;
      if (unsubscribe) {
        try {
          unsubscribe();
        } catch (error) {
          console.error('Error unsubscribing from cost codes:', error);
        }
      }
    };
  }, [user?.uid, churchId]);

  // Time Entries Table Functions
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const filteredAndSortedEntries = () => {
    let filtered = timeEntries.filter(entry => {
      // Search filter
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        const projectName = projects.find(p => p.id === entry.project)?.name || '';
        const areaName = areasOfFocus.find(a => a.id === entry.areaOfFocus)?.name || '';
        const costCodeName = costCodes.find(c => c.code === entry.costCode)?.description || '';
        
        if (!projectName.toLowerCase().includes(searchLower) &&
            !areaName.toLowerCase().includes(searchLower) &&
            !costCodeName.toLowerCase().includes(searchLower) &&
            !entry.note?.toLowerCase().includes(searchLower)) {
          return false;
        }
      }

      // Project filter
      if (filterProject && entry.project !== filterProject) {
        return false;
      }

      // Area of Focus filter
      if (filterAreaOfFocus && entry.areaOfFocus !== filterAreaOfFocus) {
        return false;
      }

      // Cost Code filter
      if (filterCostCode && entry.costCode !== filterCostCode) {
        return false;
      }

      // Date range filter
      if (filterDateFrom || filterDateTo) {
        const entryDate = parseDate(entry.startTime);
        if (!entryDate) return false;
        
        const entryDateStr = entryDate.toISOString().split('T')[0];
        
        if (filterDateFrom && entryDateStr < filterDateFrom) return false;
        if (filterDateTo && entryDateStr > filterDateTo) return false;
      }

      return true;
    });

    // Sort
    filtered.sort((a, b) => {
      let aValue, bValue;

      switch (sortField) {
        case 'startTime':
          aValue = parseDate(a.startTime)?.getTime() || 0;
          bValue = parseDate(b.startTime)?.getTime() || 0;
          break;
        case 'duration':
          aValue = a.duration || 0;
          bValue = b.duration || 0;
          break;
        case 'project':
          aValue = projects.find(p => p.id === a.project)?.name || '';
          bValue = projects.find(p => p.id === b.project)?.name || '';
          break;
        case 'areaOfFocus':
          aValue = areasOfFocus.find(area => area.id === a.areaOfFocus)?.name || '';
          bValue = areasOfFocus.find(area => area.id === b.areaOfFocus)?.name || '';
          break;
        case 'costCode':
          aValue = costCodes.find(c => c.code === a.costCode)?.code || '';
          bValue = costCodes.find(c => c.code === b.costCode)?.code || '';
          break;
        default:
          aValue = a[sortField] || '';
          bValue = b[sortField] || '';
      }

      if (typeof aValue === 'string') {
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
      }

      if (sortDirection === 'asc') {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });

    return filtered;
  };

  const clearFilters = () => {
    setSearchTerm('');
    setFilterProject('');
    setFilterAreaOfFocus('');
    setFilterCostCode('');
    setFilterDateFrom('');
    setFilterDateTo('');
    setCurrentPage(1);
  };

  // Safe date parsing function to handle both Firestore Timestamps and ISO strings
  const parseDate = (dateValue) => {
    if (!dateValue) return null;
    
    try {
      // Handle Firestore Timestamp objects
      if (dateValue.toDate && typeof dateValue.toDate === 'function') {
        return dateValue.toDate();
      }
      
      // Handle ISO strings and other date formats
      const date = new Date(dateValue);
      if (isNaN(date.getTime())) {
        console.warn('Invalid date value:', dateValue);
        return null;
      }
      
      return date;
    } catch (error) {
      console.error('Error parsing date:', dateValue, error);
      return null;
    }
  };

  // Start time tracking
  const startTracking = async () => {
    if (!currentProject || !currentAreaOfFocus || !currentCostCode) {
      toast.error('Please select a project, area of focus, and cost code before starting the timer');
      return;
    }

    try {
      const startTime = new Date();
      const session = {
        userId: user.uid,
        churchId,
        startTime: startTime.toISOString(),
        date: startTime.toISOString().split('T')[0],
        note: '',
        project: currentProject,
        areaOfFocus: currentAreaOfFocus,
        costCode: currentCostCode
      };

      console.log('Starting tracking with session data:', session);
      const docRef = await addDoc(collection(db, `churches/${churchId}/timeEntries`), session);
      console.log('Time tracking session saved with ID:', docRef.id);
      setCurrentSession({ ...session, id: docRef.id });
      setIsTracking(true);
      setElapsedTime(0);
      toast.success('Time tracking started!');
    } catch (error) {
      console.error('Error starting time tracking:', error);
      console.error('Error details:', error.code, error.message);
      toast.error('Failed to start time tracking: ' + error.message);
    }
  };

  // Stop time tracking
  const stopTracking = async () => {
    if (!currentSession) return;

    try {
      const endTime = new Date();
      const duration = Math.floor((endTime - new Date(currentSession.startTime)) / 1000);

      await updateDoc(doc(db, `churches/${churchId}/timeEntries`, currentSession.id), {
        endTime: endTime.toISOString(),
        duration,
        updatedAt: serverTimestamp()
      });

      setIsTracking(false);
      setCurrentSession(null);
      setElapsedTime(0);
      setCurrentProject('');
      setCurrentAreaOfFocus('');
      setCurrentCostCode('');
      toast.success('Time tracking stopped!');
    } catch (error) {
      console.error('Error stopping time tracking:', error);
      toast.error('Failed to stop time tracking');
    }
  };

  // Inline add row functions
  const startAddRow = () => {
    setShowAddRow(true);
    setNewRowData({
      note: '',
      startTime: '',
      endTime: '',
      date: new Date().toISOString().split('T')[0],
      project: '',
      areaOfFocus: '',
      costCode: '',
      duration: '',
      durationMode: 'start'
    });
  };

  const cancelAddRow = () => {
    setShowAddRow(false);
    setNewRowData({
      note: '',
      startTime: '',
      endTime: '',
      date: new Date().toISOString().split('T')[0],
      project: '',
      areaOfFocus: '',
      costCode: '',
      duration: '',
      durationMode: 'start'
    });
  };

  const saveAddRow = async () => {
    if (!newRowData.startTime || !newRowData.endTime) {
      toast.error('Please enter both start and end times');
      return;
    }

    if (!newRowData.project || !newRowData.areaOfFocus || !newRowData.costCode) {
      toast.error('Please select a project, area of focus, and cost code');
      return;
    }

    try {
      // Convert 12-hour format to 24-hour format
      let startTime24h, endTime24h;
      try {
        startTime24h = convertTo24Hour(newRowData.startTime);
        endTime24h = convertTo24Hour(newRowData.endTime);
      } catch (timeError) {
        toast.error(timeError.message);
        return;
      }

      const startDateTime = new Date(`${newRowData.date}T${startTime24h}`);
      let endDateTime = new Date(`${newRowData.date}T${endTime24h}`);

      // Handle overnight entries
      if (endDateTime < startDateTime) {
        endDateTime = new Date(`${newRowData.date}T${endTime24h}`);
        endDateTime.setDate(endDateTime.getDate() + 1);
      }

      const duration = Math.floor((endDateTime - startDateTime) / 1000);

      if (duration <= 0) {
        toast.error('End time must be after start time');
        return;
      }

      const entryData = {
        startTime: startDateTime.toISOString(),
        endTime: endDateTime.toISOString(),
        duration: duration,
        note: newRowData.note,
        date: newRowData.date,
        project: newRowData.project,
        areaOfFocus: newRowData.areaOfFocus,
        costCode: newRowData.costCode,
        userId: user.uid,
        createdAt: serverTimestamp()
      };

      const docRef = await addDoc(collection(db, `churches/${churchId}/timeEntries`), entryData);

      const newEntry = {
        id: docRef.id,
        ...entryData,
        createdAt: new Date()
      };

      setTimeEntries(prev => [newEntry, ...prev]);
      setShowAddRow(false);
      setNewRowData({
        note: '',
        startTime: '',
        endTime: '',
        date: new Date().toISOString().split('T')[0],
        project: '',
        areaOfFocus: '',
        costCode: '',
        duration: '',
        durationMode: 'start'
      });

      toast.success('Time entry added successfully!');
    } catch (error) {
      console.error('Error adding time entry:', error);
      toast.error('Failed to add time entry: ' + error.message);
    }
  };

  // Delete time entry
  const deleteTimeEntry = async (entryId) => {
    // Find the entry to check ownership
    const entry = timeEntries.find(e => e.id === entryId);
    if (!entry) {
      toast.error('Time entry not found');
      return;
    }

    // Check permissions: members can only delete their own entries, admins can delete any
    if (user.role === 'member' && entry.userId !== user.uid) {
      toast.error('You can only delete your own time entries');
      return;
    }

    if (!window.confirm('Are you sure you want to delete this time entry?')) return;

    try {
      // Immediately update local state for instant feedback
      setTimeEntries(prev => prev.filter(entry => entry.id !== entryId));

      // Delete from Firestore
      await deleteDoc(doc(db, `churches/${churchId}/timeEntries`, entryId));
      
      toast.success('Time entry deleted successfully!');
    } catch (error) {
      console.error('Error deleting time entry:', error);
      toast.error('Failed to delete time entry');
      
      // Note: In a real app, you might want to revert the optimistic update here
      // For now, the real-time listener will eventually correct any inconsistencies
    }
  };

  // Edit time entry (inline)
  const editTimeEntry = (entry) => {
    setEditingRowId(entry.id);
    
    const startDate = parseDate(entry.startTime);
    const endDate = parseDate(entry.endTime);
    
    // For entries that cross midnight, we need to determine the correct date to show
    let displayDate = entry.date;
    if (!displayDate && startDate) {
      displayDate = startDate.toISOString().split('T')[0];
    }
    
    setEditRowData({
      note: entry.note || '',
      startTime: startDate ? startDate.toTimeString().slice(0, 5) : '',
      endTime: endDate ? endDate.toTimeString().slice(0, 5) : '',
      date: displayDate,
      project: entry.project || '',
      areaOfFocus: entry.areaOfFocus || '',
      costCode: entry.costCode || ''
    });
  };

  // Save inline edit
  const saveInlineEdit = async (entryId) => {
    // Find the entry to check ownership
    const entry = timeEntries.find(e => e.id === entryId);
    if (!entry) {
      toast.error('Time entry not found');
      return;
    }

    // Check permissions: members can only edit their own entries, admins can edit any
    if (user.role === 'member' && entry.userId !== user.uid) {
      toast.error('You can only edit your own time entries');
      return;
    }

    if (!editRowData.project || !editRowData.areaOfFocus || !editRowData.costCode) {
      toast.error('Please select a project, area of focus, and cost code');
      return;
    }

    try {
      // Convert 12-hour format to 24-hour format
      let startTime24h, endTime24h;
      try {
        startTime24h = convertTo24Hour(editRowData.startTime);
        endTime24h = editRowData.endTime ? convertTo24Hour(editRowData.endTime) : null;
      } catch (timeError) {
        toast.error(timeError.message);
        return;
      }

      const startDateTime = new Date(`${editRowData.date}T${startTime24h}`);
      
      let endDateTime = null;
      if (endTime24h) {
        endDateTime = new Date(`${editRowData.date}T${endTime24h}`);
        if (endDateTime <= startDateTime) {
          endDateTime = new Date(`${editRowData.date}T${endTime24h}`);
          endDateTime.setDate(endDateTime.getDate() + 1);
        }
      }

      const duration = endDateTime ? Math.floor((endDateTime - startDateTime) / 1000) : null;

      const updateData = {
        startTime: startDateTime.toISOString(),
        endTime: endDateTime ? endDateTime.toISOString() : null,
        duration: duration,
        note: editRowData.note,
        date: editRowData.date,
        project: editRowData.project,
        areaOfFocus: editRowData.areaOfFocus,
        costCode: editRowData.costCode
      };

      await updateDoc(doc(db, `churches/${churchId}/timeEntries`, entryId), updateData);

      // Update local state
      setTimeEntries(prev => prev.map(entry => 
        entry.id === entryId ? { ...entry, ...updateData } : entry
      ));

      setEditingRowId(null);
      toast.success('Time entry updated successfully!');
    } catch (error) {
      console.error('Error updating time entry:', error);
      toast.error('Failed to update time entry: ' + error.message);
    }
  };

  // Cancel inline edit
  const cancelInlineEdit = () => {
    setEditingRowId(null);
    setEditRowData({
      note: '',
      startTime: '',
      endTime: '',
      date: '',
      project: '',
      areaOfFocus: '',
      costCode: ''
    });
  };

  // Create/Update task
  const saveTask = async (e) => {
    e.preventDefault();

    try {
      const taskData = {
        ...newTask,
        userId: user.uid,
        churchId,
        updatedAt: new Date()
      };

      if (editingTask) {
        // Update existing task
        await updateDoc(doc(db, `churches/${churchId}/tasks`, editingTask.id), {
          ...taskData,
          updatedAt: serverTimestamp()
        });

        // Immediately update local state
        setTasks(prev => prev.map(task => 
          task.id === editingTask.id 
            ? { ...task, ...taskData, id: editingTask.id }
            : task
        ));

        toast.success('Task updated successfully!');
      } else {
        // Create new task
        taskData.createdAt = new Date();
        
        const docRef = await addDoc(collection(db, `churches/${churchId}/tasks`), {
          ...taskData,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });

        // Immediately update local state
        const newTaskWithId = {
          id: docRef.id,
          ...taskData
        };
        setTasks(prev => [newTaskWithId, ...prev]);

        toast.success('Task created successfully!');
      }

      setNewTask({
        title: '',
        description: '',
        priority: 'medium',
        dueDate: '',
        status: 'pending'
      });
      setEditingTask(null);
      setShowTaskModal(false);
    } catch (error) {
      console.error('Error saving task:', error);
      toast.error('Failed to save task');
    }
  };

  // Delete task
  const deleteTask = async (taskId) => {
    if (!window.confirm('Are you sure you want to delete this task?')) return;

    try {
      // Immediately update local state for instant feedback
      setTasks(prev => prev.filter(task => task.id !== taskId));

      // Delete from Firestore
      await deleteDoc(doc(db, `churches/${churchId}/tasks`, taskId));
      
      toast.success('Task deleted successfully!');
    } catch (error) {
      console.error('Error deleting task:', error);
      toast.error('Failed to delete task');
      
      // Note: In a real app, you might want to revert the optimistic update here
      // For now, the real-time listener will eventually correct any inconsistencies
    }
  };

  // Create/Update project
  const saveProject = async (e) => {
    e.preventDefault();

    try {
      const projectData = {
        ...newProject,
        userId: user.uid,
        churchId,
        updatedAt: new Date()
      };

      if (editingProject) {
        // Update existing project
        await updateDoc(doc(db, `churches/${churchId}/projects`, editingProject.id), {
          ...projectData,
          updatedAt: serverTimestamp()
        });

        // Immediately update local state
        setProjects(prev => prev.map(project => 
          project.id === editingProject.id 
            ? { ...project, ...projectData, id: editingProject.id }
            : project
        ));

        toast.success('Project updated successfully!');
      } else {
        // Create new project
        projectData.createdAt = new Date();
        
        const docRef = await addDoc(collection(db, `churches/${churchId}/projects`), {
          ...projectData,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });

        // Immediately update local state
        const newProjectWithId = {
          id: docRef.id,
          ...projectData
        };
        setProjects(prev => [newProjectWithId, ...prev]);

        toast.success('Project created successfully!');
      }

      setNewProject({
        name: '',
        description: '',
        costCodeAssignments: []
      });
      setEditingProject(null);
      setShowProjectModal(false);
    } catch (error) {
      console.error('Error saving project:', error);
      toast.error('Failed to save project');
    }
  };

  // Delete project
  const deleteProject = async (projectId) => {
    if (!window.confirm('Are you sure you want to delete this project?')) return;

    try {
      // Immediately update local state for instant feedback
      setProjects(prev => prev.filter(project => project.id !== projectId));

      // Delete from Firestore
      await deleteDoc(doc(db, `churches/${churchId}/projects`, projectId));
      
      toast.success('Project deleted successfully!');
    } catch (error) {
      console.error('Error deleting project:', error);
      toast.error('Failed to delete project');
    }
  };

  // Add cost code assignment to project
  const addCostCodeAssignment = () => {
    if (!newCostCodeAssignment.costCodeId || !newCostCodeAssignment.hours) {
      toast.error('Please select a cost code and enter hours');
      return;
    }

    // Check if cost code is already assigned
    const existingAssignment = newProject.costCodeAssignments.find(
      assignment => assignment.costCodeId === newCostCodeAssignment.costCodeId
    );

    if (existingAssignment) {
      toast.error('This cost code is already assigned to the project');
      return;
    }

    setNewProject(prev => ({
      ...prev,
      costCodeAssignments: [...prev.costCodeAssignments, { ...newCostCodeAssignment }]
    }));

    setNewCostCodeAssignment({
      costCodeId: '',
      hours: ''
    });
  };

  // Remove cost code assignment from project
  const removeCostCodeAssignment = (costCodeId) => {
    setNewProject(prev => ({
      ...prev,
      costCodeAssignments: prev.costCodeAssignments.filter(
        assignment => assignment.costCodeId !== costCodeId
      )
    }));
  };

  // Update cost code assignment hours
  const updateCostCodeAssignmentHours = (costCodeId, hours) => {
    setNewProject(prev => ({
      ...prev,
      costCodeAssignments: prev.costCodeAssignments.map(assignment =>
        assignment.costCodeId === costCodeId
          ? { ...assignment, hours: hours }
          : assignment
      )
    }));
  };

  // Create/Update cost code
  const saveCostCode = async (e) => {
    e.preventDefault();

    console.log('saveCostCode called with:', newCostCode);
    console.log('areasOfFocus length:', areasOfFocus.length);
    console.log('editingCostCode:', editingCostCode);

    // Validate required fields
    if (!newCostCode.areaOfFocusId) {
      console.error('Validation failed: areaOfFocusId is missing');
      toast.error('Please select an Area of Focus');
      return;
    }

    if (!newCostCode.code.trim()) {
      console.error('Validation failed: code is empty');
      toast.error('Please enter a Cost Code');
      return;
    }

    try {
      const costCodeData = {
        ...newCostCode,
        userId: user.uid,
        churchId,
        updatedAt: new Date()
      };

      if (editingCostCode) {
        // Update existing cost code
        await updateDoc(doc(db, `churches/${churchId}/costCodes`, editingCostCode.id), {
          ...costCodeData,
          updatedAt: serverTimestamp()
        });

        // Immediately update local state
        setCostCodes(prev => prev.map(costCode => 
          costCode.id === editingCostCode.id 
            ? { ...costCode, ...costCodeData, id: editingCostCode.id }
            : costCode
        ));

        toast.success('Cost code updated successfully!');
      } else {
        // Create new cost code
        costCodeData.createdAt = new Date();
        
        const docRef = await addDoc(collection(db, `churches/${churchId}/costCodes`), {
          ...costCodeData,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });

        // Immediately update local state
        const newCostCodeWithId = {
          id: docRef.id,
          ...costCodeData
        };
        setCostCodes(prev => [newCostCodeWithId, ...prev]);
        console.log('Cost code created successfully:', newCostCodeWithId);

        toast.success('Cost code created successfully!');
      }

      setNewCostCode({
        code: '',
        description: '',
        category: '',
        costPerHour: '',
        areaOfFocusId: ''
      });
      setEditingCostCode(null);
      setShowCostCodeModal(false);
    } catch (error) {
      console.error('Error saving cost code:', error);
      toast.error('Failed to save cost code: ' + error.message);
    }
  };

  // Delete cost code
  const deleteCostCode = async (costCodeId) => {
    if (!window.confirm('Are you sure you want to delete this cost code?')) return;

    try {
      // Immediately update local state for instant feedback
      setCostCodes(prev => prev.filter(costCode => costCode.id !== costCodeId));

      // Delete from Firestore
      await deleteDoc(doc(db, `churches/${churchId}/costCodes`, costCodeId));
      
      toast.success('Cost code deleted successfully!');
    } catch (error) {
      console.error('Error deleting cost code:', error);
      toast.error('Failed to delete cost code');
    }
  };

  // View project profile
  const viewProjectProfile = async (project) => {
    try {
      console.log('=== PROJECT PROFILE DEBUG ===');
      console.log('Attempting to load project:', project.id);

      // Fetch the latest project data from Firestore to ensure we have current cost code assignments
      let projectDoc;
      try {
        projectDoc = await getDoc(doc(db, `churches/${churchId}/projects`, project.id));
      } catch (fetchError) {
        console.error('Error fetching project document:', fetchError);
        console.error('Error code:', fetchError.code);
        console.error('Error message:', fetchError.message);

        let errorMessage = 'Failed to load project data';
        if (fetchError.code === 'permission-denied') {
          errorMessage = 'You do not have permission to view this project';
        } else if (fetchError.code === 'not-found') {
          errorMessage = 'Project not found';
        } else if (fetchError.code === 'unavailable') {
          errorMessage = 'Service temporarily unavailable. Please try again.';
        }

        toast.error(`${errorMessage}: ${fetchError.message}`);
        return;
      }

      if (!projectDoc.exists()) {
        console.error('Project document does not exist:', project.id);
        toast.error('Project not found');
        return;
      }

      const latestProjectData = {
        id: projectDoc.id,
        ...projectDoc.data()
      };

      console.log('Original project data:', project);
      console.log('Latest project data from Firestore:', latestProjectData);
      console.log('Cost code assignments:', latestProjectData.costCodeAssignments);

      setSelectedProject(latestProjectData);

      // Get all time entries for this project
      const timeEntriesRef = collection(db, `churches/${churchId}/timeEntries`);
      
      // Role-based query: members only see their own entries, admins see all
      let projectQuery;
      if (user.role === 'member') {
        projectQuery = query(
          timeEntriesRef,
          where('userId', '==', user.uid),
          where('project', '==', project.id)
        );
      } else {
        // Admins and global admins can see all time entries for the project
        projectQuery = query(
          timeEntriesRef,
          where('project', '==', project.id)
        );
      }

      console.log('Fetching time entries for project:', project.id);
      let snapshot;
      try {
        snapshot = await getDocs(projectQuery);
      } catch (queryError) {
        console.error('Error fetching time entries:', queryError);
        console.error('Error code:', queryError.code);
        console.error('Error message:', queryError.message);

        let errorMessage = 'Failed to load time entries';
        if (queryError.code === 'permission-denied') {
          errorMessage = 'You do not have permission to view time entries for this project';
        } else if (queryError.code === 'failed-precondition') {
          errorMessage = 'Query requires an index. Please contact support.';
        } else if (queryError.code === 'unavailable') {
          errorMessage = 'Service temporarily unavailable. Please try again.';
        }

        toast.error(`${errorMessage}: ${queryError.message}`);
        // Continue with empty entries array
        snapshot = { docs: [] };
      }

      const entries = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      console.log('Found time entries:', entries.length);
      setProjectTimeEntries(entries);

      // Calculate cost code statistics
      const stats = {};
      try {
        entries.forEach(entry => {
          if (entry.costCode) {
            if (!stats[entry.costCode]) {
              stats[entry.costCode] = {
                totalHours: 0,
                totalEntries: 0,
                costCode: entry.costCode
              };
            }
            stats[entry.costCode].totalHours += entry.duration ? entry.duration / 3600 : 0;
            stats[entry.costCode].totalEntries += 1;
          }
        });
      } catch (error) {
        console.error('Error calculating cost code statistics:', error);
      }

      console.log('Calculated stats:', stats);
      setProjectCostCodeStats(stats);
      setActiveTab('projectProfile');

      console.log('Project profile loaded successfully');
    } catch (error) {
      console.error('Error loading project profile:', error);
      console.error('Error details:', error.code, error.message);
      toast.error(`Failed to load project profile: ${error.message}`);
    }
  };

  // Assign cost code to project
  const assignCostCodeToProject = async (costCodeId) => {
    if (!selectedProject) return;

    try {
      const newAssignment = { costCodeId, hours: '0' };
      
      // Update project with assigned cost code
      await updateDoc(doc(db, `churches/${churchId}/projects`, selectedProject.id), {
        costCodeAssignments: arrayUnion(newAssignment),
        updatedAt: serverTimestamp()
      });

      // Update local state
      setSelectedProject(prev => ({
        ...prev,
        costCodeAssignments: [...(prev.costCodeAssignments || []), newAssignment]
      }));

      // Also update the projects list
      setProjects(prev => prev.map(p => 
        p.id === selectedProject.id 
          ? { ...p, costCodeAssignments: [...(p.costCodeAssignments || []), newAssignment] }
          : p
      ));

      toast.success('Cost code assigned to project!');
    } catch (error) {
      console.error('Error assigning cost code:', error);
      toast.error('Failed to assign cost code');
    }
  };

  // Remove cost code from project
  const removeCostCodeFromProject = async (costCodeId) => {
    if (!selectedProject) return;

    try {
      // Find the assignment to remove
      const assignmentToRemove = selectedProject.costCodeAssignments?.find(
        assignment => assignment.costCodeId === costCodeId
      );

      if (!assignmentToRemove) return;

      await updateDoc(doc(db, `churches/${churchId}/projects`, selectedProject.id), {
        costCodeAssignments: arrayRemove(assignmentToRemove),
        updatedAt: serverTimestamp()
      });

      // Update local state
      setSelectedProject(prev => ({
        ...prev,
        costCodeAssignments: (prev.costCodeAssignments || []).filter(
          assignment => assignment.costCodeId !== costCodeId
        )
      }));

      // Also update the projects list
      setProjects(prev => prev.map(p => 
        p.id === selectedProject.id 
          ? { ...p, costCodeAssignments: (p.costCodeAssignments || []).filter(
              assignment => assignment.costCodeId !== costCodeId
            ) }
          : p
      ));

      toast.success('Cost code removed from project!');
    } catch (error) {
      console.error('Error removing cost code:', error);
      toast.error('Failed to remove cost code');
    }
  };

  // Create/Update area of focus
  const saveAreaOfFocus = async (e) => {
    e.preventDefault();

    try {
      const areaData = {
        ...newAreaOfFocus,
        userId: user.uid,
        churchId,
        updatedAt: new Date()
      };

      if (editingAreaOfFocus) {
        // Update existing area of focus
        await updateDoc(doc(db, `churches/${churchId}/areasOfFocus`, editingAreaOfFocus.id), {
          ...areaData,
          updatedAt: serverTimestamp()
        });

        // Immediately update local state
        setAreasOfFocus(prev => prev.map(area =>
          area.id === editingAreaOfFocus.id
            ? { ...area, ...areaData, id: editingAreaOfFocus.id }
            : area
        ));

        toast.success('Area of focus updated successfully!');
      } else {
        // Create new area of focus
        areaData.createdAt = new Date();

        const docRef = await addDoc(collection(db, `churches/${churchId}/areasOfFocus`), {
          ...areaData,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });

        // Immediately update local state
        const newAreaWithId = {
          id: docRef.id,
          ...areaData
        };
        setAreasOfFocus(prev => [newAreaWithId, ...prev]);

        toast.success('Area of focus created successfully!');
      }

      setNewAreaOfFocus({
        name: '',
        description: '',
        color: '#667eea'
      });
      setEditingAreaOfFocus(null);
      setShowAreaOfFocusModal(false);
    } catch (error) {
      console.error('Error saving area of focus:', error);
      toast.error('Failed to save area of focus');
    }
  };

  // Delete area of focus
  const deleteAreaOfFocus = async (areaId) => {
    if (!window.confirm('Are you sure you want to delete this area of focus? This will also remove it from all associated cost codes.')) return;

    try {
      // Immediately update local state for instant feedback
      setAreasOfFocus(prev => prev.filter(area => area.id !== areaId));

      // Delete from Firestore
      await deleteDoc(doc(db, `churches/${churchId}/areasOfFocus`, areaId));

      toast.success('Area of focus deleted successfully!');
    } catch (error) {
      console.error('Error deleting area of focus:', error);
      toast.error('Failed to delete area of focus');
    }
  };

  // Edit area of focus
  const editAreaOfFocus = (area) => {
    setEditingAreaOfFocus(area);
    setNewAreaOfFocus({
      name: area.name || '',
      description: area.description || '',
      color: area.color || '#667eea'
    });
    setShowAreaOfFocusModal(true);
  };

  // Inline creation functions
  const createInlineProject = async () => {
    if (!inlineProjectName.trim()) {
      toast.error('Please enter a project name');
      return;
    }

    try {
      const projectData = {
        name: inlineProjectName.trim(),
        description: '',
        costCodeAssignments: [],
        userId: user.uid,
        churchId,
        updatedAt: new Date()
      };

      const docRef = await addDoc(collection(db, `churches/${churchId}/projects`), {
        ...projectData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      const newProject = {
        id: docRef.id,
        ...projectData
      };

      setProjects(prev => [newProject, ...prev]);
      setCurrentProject(newProject.id);
      setInlineProjectName('');
      setShowInlineProjectForm(false);
      toast.success('Project created successfully!');
    } catch (error) {
      console.error('Error creating inline project:', error);
      toast.error('Failed to create project');
    }
  };

  const createInlineAreaOfFocus = async () => {
    if (!inlineAreaName.trim()) {
      toast.error('Please enter an area of focus name');
      return;
    }

    try {
      const areaData = {
        name: inlineAreaName.trim(),
        description: inlineAreaDescription.trim(),
        color: inlineAreaColor,
        userId: user.uid,
        churchId,
        updatedAt: new Date()
      };

      const docRef = await addDoc(collection(db, `churches/${churchId}/areasOfFocus`), {
        ...areaData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      const newArea = {
        id: docRef.id,
        ...areaData
      };

      setAreasOfFocus(prev => [newArea, ...prev]);
      setCurrentAreaOfFocus(newArea.id);
      setInlineAreaName('');
      setInlineAreaDescription('');
      setInlineAreaColor('#667eea');
      setShowInlineAreaForm(false);
      toast.success('Area of focus created successfully!');
    } catch (error) {
      console.error('Error creating inline area of focus:', error);
      toast.error('Failed to create area of focus');
    }
  };

  const createInlineCostCode = async () => {
    if (!inlineCostCode.trim()) {
      toast.error('Please enter a cost code');
      return;
    }

    if (!currentAreaOfFocus) {
      toast.error('Please select an area of focus first');
      return;
    }

    try {
      const costCodeData = {
        code: inlineCostCode.trim(),
        description: inlineCostDescription.trim(),
        category: '',
        costPerHour: '',
        areaOfFocusId: currentAreaOfFocus,
        userId: user.uid,
        churchId,
        updatedAt: new Date()
      };

      const docRef = await addDoc(collection(db, `churches/${churchId}/costCodes`), {
        ...costCodeData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      const newCostCode = {
        id: docRef.id,
        ...costCodeData
      };

      setCostCodes(prev => [newCostCode, ...prev]);
      setCurrentCostCode(newCostCode.code);
      setInlineCostCode('');
      setInlineCostDescription('');
      setShowInlineCostCodeForm(false);
      toast.success('Cost code created successfully!');
    } catch (error) {
      console.error('Error creating inline cost code:', error);
      toast.error('Failed to create cost code');
    }
  };

  // Add task progress
  const addTaskProgress = async (e) => {
    e.preventDefault();

    if (!taskProgress.taskId || !taskProgress.progress) {
      toast.error('Please select a task and add progress notes');
      return;
    }

    try {
      const progressData = {
        ...taskProgress,
        userId: user.uid,
        churchId,
        createdAt: new Date()
      };

      const docRef = await addDoc(collection(db, `churches/${churchId}/taskProgress`), {
        ...progressData,
        createdAt: serverTimestamp()
      });

      // No need to update local state here since TaskProgress component 
      // handles its own state and will get updated via its listener

      setTaskProgress({
        taskId: '',
        date: new Date().toISOString().split('T')[0],
        progress: '',
        notes: ''
      });

      toast.success('Progress added successfully!');
    } catch (error) {
      console.error('Error adding progress:', error);
      toast.error('Failed to add progress');
    }
  };

  // Edit task
  const editTask = (task) => {
    setNewTask({
      title: task.title,
      description: task.description,
      priority: task.priority,
      dueDate: task.dueDate,
      status: task.status
    });
    setEditingTask(task);
    setShowTaskModal(true);
  };

  // Update task status
  const updateTaskStatus = async (taskId, newStatus) => {
    try {
      // Immediately update local state for instant feedback
      setTasks(prev => prev.map(task => 
        task.id === taskId 
          ? { ...task, status: newStatus, updatedAt: new Date() }
          : task
      ));

      // Update in Firestore
      await updateDoc(doc(db, `churches/${churchId}/tasks`, taskId), {
        status: newStatus,
        updatedAt: serverTimestamp()
      });
      
      toast.success('Task status updated!');
    } catch (error) {
      console.error('Error updating task status:', error);
      toast.error('Failed to update task status');
      
      // Revert the optimistic update on error
      setTasks(prev => prev.map(task => 
        task.id === taskId 
          ? { ...task, status: tasks.find(t => t.id === taskId)?.status || 'pending' }
          : task
      ));
    }
  };

  // Create/Update submission
  const saveSubmission = async (e) => {
    e.preventDefault();

    try {
      const submissionData = {
        ...newSubmission,
        userId: user.uid,
        churchId,
        updatedAt: new Date()
      };

      if (editingSubmission) {
        // Update existing submission
        await updateDoc(doc(db, `churches/${churchId}/submissions`, editingSubmission.id), {
          ...submissionData,
          updatedAt: serverTimestamp()
        });

        // Immediately update local state
        setSubmissions(prev => prev.map(submission => 
          submission.id === editingSubmission.id 
            ? { ...submission, ...submissionData, id: editingSubmission.id }
            : submission
        ));

        toast.success('Submission updated successfully!');
      } else {
        // Create new submission
        submissionData.createdAt = new Date();
        
        const docRef = await addDoc(collection(db, `churches/${churchId}/submissions`), {
          ...submissionData,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });

        // Immediately update local state
        const newSubmissionWithId = {
          id: docRef.id,
          ...submissionData
        };
        setSubmissions(prev => [newSubmissionWithId, ...prev]);

        toast.success('Submission created successfully!');
      }

      setNewSubmission({
        title: '',
        description: '',
        type: 'report',
        relatedTaskId: '',
        content: '',
        status: 'draft',
        dueDate: ''
      });
      setEditingSubmission(null);
      setShowSubmissionModal(false);
    } catch (error) {
      console.error('Error saving submission:', error);
      toast.error('Failed to save submission');
    }
  };

  // Delete submission
  const deleteSubmission = async (submissionId) => {
    if (!window.confirm('Are you sure you want to delete this submission?')) return;

    try {
      // Immediately update local state for instant feedback
      setSubmissions(prev => prev.filter(submission => submission.id !== submissionId));

      // Delete from Firestore
      await deleteDoc(doc(db, `churches/${churchId}/submissions`, submissionId));
      
      toast.success('Submission deleted successfully!');
    } catch (error) {
      console.error('Error deleting submission:', error);
      toast.error('Failed to delete submission');
    }
  };

  // Edit submission
  const editSubmission = (submission) => {
    setNewSubmission({
      title: submission.title,
      description: submission.description,
      type: submission.type,
      relatedTaskId: submission.relatedTaskId || '',
      content: submission.content,
      status: submission.status,
      dueDate: submission.dueDate || ''
    });
    setEditingSubmission(submission);
    setShowSubmissionModal(true);
  };

  // Update submission status
  const updateSubmissionStatus = async (submissionId, newStatus) => {
    try {
      // Immediately update local state for instant feedback
      setSubmissions(prev => prev.map(submission => 
        submission.id === submissionId 
          ? { ...submission, status: newStatus, updatedAt: new Date() }
          : submission
      ));

      // Update in Firestore
      await updateDoc(doc(db, `churches/${churchId}/submissions`, submissionId), {
        status: newStatus,
        updatedAt: serverTimestamp()
      });
      
      toast.success('Submission status updated!');
    } catch (error) {
      console.error('Error updating submission status:', error);
      toast.error('Failed to update submission status');
      
      // Revert the optimistic update on error
      setSubmissions(prev => prev.map(submission => 
        submission.id === submissionId 
          ? { ...submission, status: submissions.find(s => s.id === submissionId)?.status || 'draft' }
          : submission
      ));
    }
  };

  return (
    <div style={{ 
      padding: "20px", 
      maxWidth: "1200px", 
      margin: "20px auto", 
      display: "flex", 
      flexDirection: "column", 
      fontFamily: "'Nunito', sans-serif",
      backgroundColor: "#ffffff",
      borderRadius: "12px",
      boxShadow: "0 4px 20px rgba(0, 0, 0, 0.08)"
    }}>
      <Link to={`/church/${churchId}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to Mi Organización
      </Link>
      <ChurchHeader id={churchId} applyShadow={false} allowEditBannerLogo={true} />
      <div style={{ marginTop: "-30px" }}>
        <div className="time-tracker-container">
          {/* Tab Navigation */}
          <div className="tab-navigation">
        <button 
          className={`tab-btn ${activeTab === 'timer' ? 'active' : ''}`}
          onClick={() => handleTabChange('timer')}
        >
          ⏱️ Time Tracker
        </button>
        {/* Only show other tabs if user is not a member */}
        {user?.role !== 'member' && (
          <>
            <button 
              className={`tab-btn ${activeTab === 'tasks' ? 'active' : ''}`}
              onClick={() => handleTabChange('tasks')}
            >
              📋 Tasks & Submissions
            </button>
            <button 
              className={`tab-btn ${activeTab === 'progress' ? 'active' : ''}`}
              onClick={() => handleTabChange('progress')}
            >
              📊 Task Progress
            </button>
            <button 
              className={`tab-btn ${activeTab === 'projects' ? 'active' : ''}`}
              onClick={() => handleTabChange('projects')}
            >
              📁 Projects
            </button>
            <button 
              className={`tab-btn ${activeTab === 'areasOfFocus' ? 'active' : ''}`}
              onClick={() => handleTabChange('areasOfFocus')}
            >
              🎯 Areas of Focus
            </button>
            <button 
              className={`tab-btn ${activeTab === 'costCodes' ? 'active' : ''}`}
              onClick={() => handleTabChange('costCodes')}
            >
              💰 Cost Codes
            </button>
            {selectedProject && (
              <button 
                className={`tab-btn ${activeTab === 'projectProfile' ? 'active' : ''}`}
                onClick={() => handleTabChange('projectProfile')}
              >
                📊 {selectedProject.name}
              </button>
            )}
          </>
        )}
      </div>

      {activeTab === 'timer' && (
        <div className="timer-tab-content">
          <div className="time-tracker-header">
            <h1>Time Tracker</h1>
            
            {/* Project Selection */}
            {!isTracking && (
              <div className="project-selection">
                <div className="form-row">
                  <div className="form-group">
                    <label>Select Project</label>
                    <select
                      value={currentProject}
                      onChange={(e) => {
                        if (e.target.value === 'add-new-project') {
                          setShowInlineProjectForm(true);
                          return;
                        }
                        setCurrentProject(e.target.value);
                        setCurrentAreaOfFocus(''); // Clear area of focus when project changes
                        setCurrentCostCode(''); // Clear cost code when project changes
                      }}
                    >
                      <option value="">Select Project</option>
                      {projects.map(project => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                      <option value="add-new-project" style={{ fontStyle: 'italic', color: '#2563eb' }}>
                        ➕ Add New Project...
                      </option>
                    </select>
                    {showInlineProjectForm && (
                      <div className="inline-creation-form">
                        <input
                          type="text"
                          placeholder="Enter project name"
                          value={inlineProjectName}
                          onChange={(e) => setInlineProjectName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              createInlineProject();
                            } else if (e.key === 'Escape') {
                              setShowInlineProjectForm(false);
                              setInlineProjectName('');
                            }
                          }}
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={createInlineProject}
                          className="inline-create-btn"
                        >
                          Create
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowInlineProjectForm(false);
                            setInlineProjectName('');
                          }}
                          className="inline-cancel-btn"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="form-group">
                    <label>Area of Focus</label>
                    <select
                      value={currentAreaOfFocus}
                      onChange={(e) => {
                        if (e.target.value === 'add-new-area') {
                          setShowInlineAreaForm(true);
                          return;
                        }
                        setCurrentAreaOfFocus(e.target.value);
                        setCurrentCostCode(''); // Clear cost code when area of focus changes
                      }}
                      disabled={!currentProject}
                    >
                      <option value="">
                        {currentProject ? 'Select Area of Focus' : 'Select a project first'}
                      </option>
                      {currentProject && (() => {
                        // Get areas of focus that have cost codes assigned to the selected project
                        const selectedProject = projects.find(p => p.id === currentProject);
                        console.log('Timer - Selected project:', selectedProject);
                        console.log('Timer - Project cost code assignments:', selectedProject?.costCodeAssignments);
                        
                        if (!selectedProject?.costCodeAssignments || selectedProject.costCodeAssignments.length === 0) {
                          console.log('Timer - No cost code assignments found for project - showing all areas as fallback');
                          // Fallback: show all areas of focus if no cost codes are assigned
                          return areasOfFocus.length > 0 ? (
                            areasOfFocus.map(area => (
                              <option key={area.id} value={area.id}>
                                {area.name} (no cost codes assigned)
                              </option>
                            ))
                          ) : (
                            <option value="" disabled>No areas available - assign cost codes to this project first</option>
                          );
                        }
                        
                        const assignedAreaIds = selectedProject.costCodeAssignments
                          .map(assignment => {
                            console.log('Timer - Processing assignment:', assignment);
                            const costCode = costCodes.find(cc => cc.id === assignment.costCodeId);
                            console.log('Timer - Found cost code:', costCode);
                            return costCode?.areaOfFocusId;
                          })
                          .filter((areaId, index, arr) => {
                            const isValid = areaId && arr.indexOf(areaId) === index;
                            console.log('Timer - Area ID:', areaId, 'isValid:', isValid);
                            return isValid;
                          });
                        
                        console.log('Timer - Assigned area IDs:', assignedAreaIds);
                        console.log('Timer - Available areas of focus:', areasOfFocus);
                        
                        const filteredAreas = areasOfFocus.filter(area => {
                          const isIncluded = assignedAreaIds.includes(area.id);
                          console.log('Timer - Area:', area.name, 'ID:', area.id, 'included:', isIncluded);
                          return isIncluded;
                        });
                        
                        console.log('Timer - Filtered areas:', filteredAreas);
                        
                        if (filteredAreas.length === 0) {
                          return <option value="" disabled>No areas available for this project</option>;
                        }
                        
                        return filteredAreas.map(area => (
                          <option key={area.id} value={area.id}>
                            {area.name}
                          </option>
                        ));
                      })()}
                      {currentProject && (
                        <option value="add-new-area" style={{ fontStyle: 'italic', color: '#2563eb' }}>
                          ➕ Add New Area of Focus...
                        </option>
                      )}
                    </select>
                    {showInlineAreaForm && (
                      <div className="inline-creation-form">
                        <input
                          type="text"
                          placeholder="Enter area name"
                          value={inlineAreaName}
                          onChange={(e) => setInlineAreaName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              createInlineAreaOfFocus();
                            } else if (e.key === 'Escape') {
                              setShowInlineAreaForm(false);
                              setInlineAreaName('');
                              setInlineAreaDescription('');
                              setInlineAreaColor('#667eea');
                            }
                          }}
                          autoFocus
                        />
                        <input
                          type="text"
                          placeholder="Description (optional)"
                          value={inlineAreaDescription}
                          onChange={(e) => setInlineAreaDescription(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              createInlineAreaOfFocus();
                            } else if (e.key === 'Escape') {
                              setShowInlineAreaForm(false);
                              setInlineAreaName('');
                              setInlineAreaDescription('');
                              setInlineAreaColor('#667eea');
                            }
                          }}
                        />
                        <button
                          type="button"
                          onClick={createInlineAreaOfFocus}
                          className="inline-create-btn"
                        >
                          Create
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowInlineAreaForm(false);
                            setInlineAreaName('');
                            setInlineAreaDescription('');
                            setInlineAreaColor('#667eea');
                          }}
                          className="inline-cancel-btn"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="form-group">
                    <label>Cost Code</label>
                    <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>
                      Debug: {costCodes.length} cost codes, {areasOfFocus.length} areas, Current area: {currentAreaOfFocus}
                    </div>
                    <select
                      value={currentCostCode}
                      onChange={(e) => {
                        if (e.target.value === 'add-new-costcode') {
                          setShowInlineCostCodeForm(true);
                          return;
                        }
                        setCurrentCostCode(e.target.value);
                      }}
                      disabled={!currentAreaOfFocus}
                    >
                      <option value="">
                        {currentAreaOfFocus ? 'Select Cost Code' : 'Select an area of focus first'}
                      </option>
                      {currentAreaOfFocus && (() => {
                        // Get cost codes assigned to the selected project and area of focus
                        const selectedProject = projects.find(p => p.id === currentProject);
                        console.log('Timer - Selected project for cost codes:', selectedProject);
                        console.log('Timer - Project cost code assignments for cost codes:', selectedProject?.costCodeAssignments);
                        
                        if (!selectedProject?.costCodeAssignments || selectedProject.costCodeAssignments.length === 0) {
                          console.log('Timer - No cost code assignments found for project');
                          return <option value="" disabled>No cost codes available - assign cost codes to this project first</option>;
                        }
                        
                        const availableCostCodes = selectedProject.costCodeAssignments
                          .map(assignment => {
                            console.log('Timer - Processing assignment for cost code:', assignment);
                            const costCode = costCodes.find(cc => cc.id === assignment.costCodeId);
                            console.log('Timer - Found cost code:', costCode);
                            return costCode;
                          })
                          .filter(costCode => {
                            const matches = costCode && costCode.areaOfFocusId === currentAreaOfFocus;
                            console.log('Timer - Cost code:', costCode?.code, 'areaOfFocusId:', costCode?.areaOfFocusId, 'selected area:', currentAreaOfFocus, 'matches:', matches);
                            return matches;
                          });
                        
                        console.log('Timer - Available cost codes for area:', availableCostCodes);
                        
                        if (availableCostCodes.length === 0) {
                          return <option value="" disabled>No cost codes available for this area</option>;
                        }
                        
                        return availableCostCodes.map(costCode => (
                          <option key={costCode.id} value={costCode.code}>
                            {costCode.code} - {costCode.description}
                            {costCode.costPerHour && ` (${costCode.costPerHour}/hr)`}
                          </option>
                        ));
                      })()}
                      {currentAreaOfFocus && (() => {
                        // Get cost codes assigned to the selected project and area of focus
                        const selectedProject = projects.find(p => p.id === currentProject);
                        if (!selectedProject?.costCodeAssignments) return null;
                        
                        const availableCostCodes = selectedProject.costCodeAssignments
                          .map(assignment => costCodes.find(cc => cc.id === assignment.costCodeId))
                          .filter(costCode => costCode && costCode.areaOfFocusId === currentAreaOfFocus);
                        
                        return availableCostCodes.length === 0 ? (
                          <option value="" disabled>
                            No cost codes available for this area of focus
                          </option>
                        ) : (
                          <option value="add-new-costcode" style={{ fontStyle: 'italic', color: '#2563eb' }}>
                            ➕ Add New Cost Code...
                          </option>
                        );
                      })()}
                    </select>
                    {showInlineCostCodeForm && (
                      <div className="inline-creation-form">
                        <input
                          type="text"
                          placeholder="Enter cost code"
                          value={inlineCostCode}
                          onChange={(e) => setInlineCostCode(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              createInlineCostCode();
                            } else if (e.key === 'Escape') {
                              setShowInlineCostCodeForm(false);
                              setInlineCostCode('');
                              setInlineCostDescription('');
                            }
                          }}
                          autoFocus
                        />
                        <input
                          type="text"
                          placeholder="Description (optional)"
                          value={inlineCostDescription}
                          onChange={(e) => setInlineCostDescription(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              createInlineCostCode();
                            } else if (e.key === 'Escape') {
                              setShowInlineCostCodeForm(false);
                              setInlineCostCode('');
                              setInlineCostDescription('');
                            }
                          }}
                        />
                        <button
                          type="button"
                          onClick={createInlineCostCode}
                          className="inline-create-btn"
                        >
                          Create
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowInlineCostCodeForm(false);
                            setInlineCostCode('');
                            setInlineCostDescription('');
                          }}
                          className="inline-cancel-btn"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            
            {/* Timer Controls */}
            <div className="timer-section">
              <div className="timer-display">
                <h2>{formatTime(elapsedTime)}</h2>
                {isTracking && <span className="tracking-indicator">● Recording</span>}
              </div>
              
              {isTracking && currentSession && (
                <div className="current-session-details">
                  <h4>Currently Tracking:</h4>
                  <div className="session-details">
                    {currentSession.project && (
                      <div className="session-detail">
                        <strong>Project:</strong> {projects.find(p => p.id === currentSession.project)?.name || currentSession.project}
                      </div>
                    )}
                    {currentSession.areaOfFocus && (
                      <div className="session-detail">
                        <strong>Area:</strong> {areasOfFocus.find(a => a.id === currentSession.areaOfFocus)?.name || currentSession.areaOfFocus}
                      </div>
                    )}
                    {currentSession.costCode && (
                      <div className="session-detail">
                        <strong>Cost Code:</strong> {costCodes.find(c => c.code === currentSession.costCode)?.code || currentSession.costCode}
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              <div className="timer-controls">
                {!isTracking ? (
                  <button className="start-btn" onClick={startTracking}>
                    Start Timer
                  </button>
                ) : (
                  <button className="stop-btn" onClick={stopTracking}>
                    Stop Timer
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="time-tracker-content">
            {/* Time Entries Data Table */}
            <div className="section">
              <div className="table-header">
                <h3>Time Entries ({filteredAndSortedEntries().length})</h3>
                <div className="table-controls">
                  <div className="search-container">
                    <input
                      type="text"
                      placeholder="Search entries..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="search-input"
                    />
                  </div>
                  <button onClick={clearFilters} className="clear-filters-btn">
                    Clear Filters
                  </button>
                  <button 
                    onClick={startAddRow} 
                    className="add-new-btn"
                    disabled={showAddRow || editingRowId !== null}
                  >
                    + Add New Entry
                  </button>
                </div>
              </div>

              {/* Filters */}
              <div className="filters-container">
                <div className="filter-row">
                  <div className="filter-group">
                    <label>Project:</label>
                    <select
                      value={filterProject}
                      onChange={(e) => setFilterProject(e.target.value)}
                      className="filter-select"
                    >
                      <option value="">All Projects</option>
                      {projects.map(project => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="filter-group">
                    <label>Area of Focus:</label>
                    <select
                      value={filterAreaOfFocus}
                      onChange={(e) => setFilterAreaOfFocus(e.target.value)}
                      className="filter-select"
                    >
                      <option value="">All Areas</option>
                      {areasOfFocus.map(area => (
                        <option key={area.id} value={area.id}>
                          {area.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="filter-group">
                    <label>Cost Code:</label>
                    <select
                      value={filterCostCode}
                      onChange={(e) => setFilterCostCode(e.target.value)}
                      className="filter-select"
                    >
                      <option value="">All Cost Codes</option>
                      {costCodes.map(costCode => (
                        <option key={costCode.id} value={costCode.code}>
                          {costCode.code} - {costCode.description}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="filter-row">
                  <div className="filter-group">
                    <label>From Date:</label>
                    <input
                      type="date"
                      value={filterDateFrom}
                      onChange={(e) => setFilterDateFrom(e.target.value)}
                      className="filter-input"
                    />
                  </div>

                  <div className="filter-group">
                    <label>To Date:</label>
                    <input
                      type="date"
                      value={filterDateTo}
                      onChange={(e) => setFilterDateTo(e.target.value)}
                      className="filter-input"
                    />
                  </div>
                </div>
              </div>

              {/* Data Table */}
              <div className="data-table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th onClick={() => handleSort('startTime')} className="sortable">
                        Date/Time {sortField === 'startTime' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th onClick={() => handleSort('duration')} className="sortable">
                        Duration {sortField === 'duration' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th onClick={() => handleSort('project')} className="sortable">
                        Project {sortField === 'project' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th onClick={() => handleSort('areaOfFocus')} className="sortable">
                        Area of Focus {sortField === 'areaOfFocus' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th onClick={() => handleSort('costCode')} className="sortable">
                        Cost Code {sortField === 'costCode' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th>Note</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAndSortedEntries()
                      .slice((currentPage - 1) * entriesPerPage, currentPage * entriesPerPage)
                      .map(entry => {
                        const startDate = parseDate(entry.startTime);
                        const endDate = parseDate(entry.endTime);

                        const isEditing = editingRowId === entry.id;

                        return (
                          <tr key={entry.id} className={isEditing ? 'editing-row' : ''}>
                            <td>
                              {isEditing ? (
                                <div className="date-time-cell">
                                  <input
                                    type="date"
                                    value={editRowData.date}
                                    onChange={(e) => setEditRowData({...editRowData, date: e.target.value})}
                                    className="inline-input"
                                    required
                                  />
                                  <div style={{display: 'flex', gap: '5px', marginTop: '5px'}}>
                                    <input
                                      type="text"
                                      placeholder="9:00 AM"
                                      value={editRowData.startTime}
                                      onChange={(e) => setEditRowData({...editRowData, startTime: e.target.value})}
                                      className="inline-input time-input"
                                      pattern="(1[0-2]|0?[1-9])(:[0-5][0-9])?\s*(AM|PM|am|pm)"
                                      title="Examples: 9:00 AM, 9 AM, 2:30 PM, 2:30PM"
                                      required
                                    />
                                    <span>to</span>
                                    <input
                                      type="text"
                                      placeholder="5:00 PM"
                                      value={editRowData.endTime}
                                      onChange={(e) => setEditRowData({...editRowData, endTime: e.target.value})}
                                      className="inline-input time-input"
                                      pattern="(1[0-2]|0?[1-9])(:[0-5][0-9])?\s*(AM|PM|am|pm)"
                                      title="Examples: 9:00 AM, 9 AM, 2:30 PM, 2:30PM"
                                      required
                                    />
                                  </div>
                                </div>
                              ) : (
                                <div className="date-time-cell">
                                  <div className="date">
                                    {startDate ? startDate.toLocaleDateString() : 'Invalid Date'}
                                  </div>
                                  <div className="time">
                                    {startDate ? startDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Invalid Time'}
                                    {endDate && ` - ${endDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`}
                                  </div>
                                </div>
                              )}
                            </td>
                            <td>
                              <span className="duration-cell">
                                {isEditing ? (
                                  editRowData.startTime && editRowData.endTime ? 
                                    (() => {
                                      const start = new Date(`${editRowData.date}T${editRowData.startTime}`);
                                      let end = new Date(`${editRowData.date}T${editRowData.endTime}`);
                                      
                                      // Handle overnight entries
                                      if (end < start) {
                                        end = new Date(end);
                                        end.setDate(end.getDate() + 1);
                                      }
                                      
                                      const duration = Math.floor((end - start) / 1000);
                                      return duration > 0 ? formatTime(duration) : '--:--';
                                    })() : 
                                    '--:--'
                                ) : (
                                  entry.duration ? formatTime(entry.duration) : 'In Progress'
                                )}
                              </span>
                            </td>
                            <td>
                              {isEditing ? (
                                <select
                                  value={editRowData.project}
                                  onChange={(e) => {
                                    const selectedProject = e.target.value;
                                    setEditRowData({
                                      ...editRowData, 
                                      project: selectedProject,
                                      areaOfFocus: '', // Clear area of focus when project changes
                                      costCode: '' // Clear cost code when project changes
                                    });
                                  }}
                                  className="inline-select"
                                >
                                  <option value="">Select Project</option>
                                  {projects.map(project => (
                                    <option key={project.id} value={project.id}>
                                      {project.name}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                projects.find(p => p.id === entry.project)?.name || entry.project || '-'
                              )}
                            </td>
                            <td>
                              {isEditing ? (
                                <select
                                  value={editRowData.areaOfFocus}
                                  onChange={(e) => {
                                    const selectedArea = e.target.value;
                                    setEditRowData({
                                      ...editRowData, 
                                      areaOfFocus: selectedArea,
                                      costCode: '' // Clear cost code when area of focus changes
                                    });
                                  }}
                                  className="inline-select"
                                  disabled={!editRowData.project}
                                >
                                  <option value="">
                                    {editRowData.project ? 'Select Area of Focus' : 'Select project first'}
                                  </option>
                                  {editRowData.project && (() => {
                                    // Get areas of focus that have cost codes assigned to the selected project
                                    const selectedProject = projects.find(p => p.id === editRowData.project);
                                    console.log('Edit - Selected project:', selectedProject);
                                    console.log('Edit - Project cost code assignments:', selectedProject?.costCodeAssignments);
                                    
                                    if (!selectedProject?.costCodeAssignments || selectedProject.costCodeAssignments.length === 0) {
                                      console.log('Edit - No cost code assignments found for project - showing all areas as fallback');
                                      // Fallback: show all areas of focus if no cost codes are assigned
                                      return areasOfFocus.length > 0 ? (
                                        areasOfFocus.map(area => (
                                          <option key={area.id} value={area.id}>
                                            {area.name} (no cost codes assigned)
                                          </option>
                                        ))
                                      ) : (
                                        <option value="" disabled>No areas available - assign cost codes to this project first</option>
                                      );
                                    }
                                    
                                    const assignedAreaIds = selectedProject.costCodeAssignments
                                      .map(assignment => {
                                        console.log('Edit - Processing assignment:', assignment);
                                        const costCode = costCodes.find(cc => cc.id === assignment.costCodeId);
                                        console.log('Edit - Found cost code:', costCode);
                                        return costCode?.areaOfFocusId;
                                      })
                                      .filter((areaId, index, arr) => {
                                        const isValid = areaId && arr.indexOf(areaId) === index;
                                        console.log('Edit - Area ID:', areaId, 'isValid:', isValid);
                                        return isValid;
                                      });
                                    
                                    console.log('Edit - Assigned area IDs:', assignedAreaIds);
                                    console.log('Edit - Available areas of focus:', areasOfFocus);
                                    
                                    const filteredAreas = areasOfFocus.filter(area => {
                                      const isIncluded = assignedAreaIds.includes(area.id);
                                      console.log('Edit - Area:', area.name, 'ID:', area.id, 'included:', isIncluded);
                                      return isIncluded;
                                    });
                                    
                                    console.log('Edit - Filtered areas:', filteredAreas);
                                    
                                    if (filteredAreas.length === 0) {
                                      return <option value="" disabled>No areas available for this project</option>;
                                    }
                                    
                                    return filteredAreas.map(area => (
                                      <option key={area.id} value={area.id}>
                                        {area.name}
                                      </option>
                                    ));
                                  })()}
                                </select>
                              ) : (
                                areasOfFocus.find(a => a.id === entry.areaOfFocus)?.name || entry.areaOfFocus || '-'
                              )}
                            </td>
                            <td>
                              {isEditing ? (
                                <select
                                  value={editRowData.costCode}
                                  onChange={(e) => setEditRowData({...editRowData, costCode: e.target.value})}
                                  className="inline-select"
                                  disabled={!editRowData.areaOfFocus}
                                >
                                  <option value="">
                                    {editRowData.areaOfFocus ? 'Select Cost Code' : 'Select area of focus first'}
                                  </option>
                                  {editRowData.areaOfFocus && (() => {
                                    // Get cost codes assigned to the selected project and area of focus
                                    const selectedProject = projects.find(p => p.id === editRowData.project);
                                    console.log('Edit - Selected project for cost codes:', selectedProject);
                                    console.log('Edit - Project cost code assignments for cost codes:', selectedProject?.costCodeAssignments);
                                    
                                    if (!selectedProject?.costCodeAssignments || selectedProject.costCodeAssignments.length === 0) {
                                      console.log('Edit - No cost code assignments found for project');
                                      return <option value="" disabled>No cost codes available - assign cost codes to this project first</option>;
                                    }
                                    
                                    const availableCostCodes = selectedProject.costCodeAssignments
                                      .map(assignment => {
                                        console.log('Edit - Processing assignment for cost code:', assignment);
                                        const costCode = costCodes.find(cc => cc.id === assignment.costCodeId);
                                        console.log('Edit - Found cost code:', costCode);
                                        return costCode;
                                      })
                                      .filter(costCode => {
                                        const matches = costCode && costCode.areaOfFocusId === editRowData.areaOfFocus;
                                        console.log('Edit - Cost code:', costCode?.code, 'areaOfFocusId:', costCode?.areaOfFocusId, 'selected area:', editRowData.areaOfFocus, 'matches:', matches);
                                        return matches;
                                      });
                                    
                                    console.log('Edit - Available cost codes for area:', availableCostCodes);
                                    
                                    if (availableCostCodes.length === 0) {
                                      return <option value="" disabled>No cost codes available for this area</option>;
                                    }
                                    
                                    return availableCostCodes.map(costCode => (
                                      <option key={costCode.id} value={costCode.code}>
                                        {costCode.code} - {costCode.description}
                                        {costCode.costPerHour && ` (${costCode.costPerHour}/hr)`}
                                      </option>
                                    ));
                                  })()}
                                </select>
                              ) : (
                                costCodes.find(c => c.code === entry.costCode)?.code || entry.costCode || '-'
                              )}
                            </td>
                            <td>
                              {isEditing ? (
                                <input
                                  type="text"
                                  value={editRowData.note}
                                  onChange={(e) => setEditRowData({...editRowData, note: e.target.value})}
                                  className="inline-input"
                                  placeholder="Add a note..."
                                />
                              ) : (
                                <div className="note-cell">
                                  {entry.note || '-'}
                                </div>
                              )}
                            </td>
                            <td>
                              <div className="action-buttons">
                                {isEditing ? (
                                  <>
                                    <button
                                      onClick={() => saveInlineEdit(entry.id)}
                                      className="save-btn-small"
                                      title="Save Changes"
                                    >
                                      💾
                                    </button>
                                    <button
                                      onClick={cancelInlineEdit}
                                      className="cancel-btn-small"
                                      title="Cancel"
                                    >
                                      ❌
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    {/* Show edit button only if user can edit this entry */}
                                    {(user.role !== 'member' || entry.userId === user.uid) && (
                                      <button
                                        onClick={() => editTimeEntry(entry)}
                                        className="edit-btn-small"
                                        disabled={!startDate}
                                        title="Edit Entry"
                                      >
                                        ✏️
                                      </button>
                                    )}
                                    {/* Show delete button only if user can delete this entry */}
                                    {(user.role !== 'member' || entry.userId === user.uid) && (
                                      <button
                                        onClick={() => deleteTimeEntry(entry.id)}
                                        className="delete-btn-small"
                                        title="Delete Entry"
                                      >
                                        🗑️
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}

                    {/* Add New Entry Row (shown when not in inline add mode) */}
                    {!showAddRow && editingRowId === null && (
                      <tr className="add-new-row">
                        <td colSpan="7" className="add-new-cell">
                          <button 
                            onClick={startAddRow} 
                            className="add-new-row-btn"
                          >
                            + Add New Entry
                          </button>
                        </td>
                      </tr>
                    )}

                    {/* Inline Add Row */}
                    {showAddRow && editingRowId === null && (
                      <tr className="add-row">
                        <td>
                          <div className="date-time-cell">
                            <input
                              type="date"
                              value={newRowData.date}
                              onChange={(e) => setNewRowData({...newRowData, date: e.target.value})}
                              className="inline-input"
                              min={new Date().toISOString().split('T')[0]}
                              required
                            />
                            <div style={{display: 'flex', gap: '5px', marginTop: '5px'}}>
                              <input
                                type="text"
                                placeholder="HH:MM AM"
                                value={newRowData.startTime}
                                onChange={(e) => {
                                  const rawValue = e.target.value;
                                  const formattedValue = formatTimeInput(rawValue);
                                  
                                  // Always update the input value to allow natural typing
                                  setNewRowData({...newRowData, startTime: formattedValue});
                                  
                                  // Only attempt duration calculation if we have a reasonably complete time
                                  if (formattedValue && formattedValue.length >= 3 && newRowData.durationMode === 'start' && newRowData.duration) {
                                    try {
                                      const calculatedEndTime = calculateEndTime(formattedValue, parseFloat(newRowData.duration));
                                      if (calculatedEndTime) {
                                        setNewRowData(prev => ({...prev, endTime: calculatedEndTime}));
                                      }
                                    } catch (error) {
                                      // Silently ignore calculation errors during typing
                                      console.debug('Duration calculation skipped during typing');
                                    }
                                  }
                                }}
                                onKeyDown={(e) => {
                                  // Auto-insert colon when user types a number after 2 digits
                                  const currentValue = e.target.value;
                                  if (e.key >= '0' && e.key <= '9' && currentValue.length === 2 && !currentValue.includes(':')) {
                                    e.preventDefault();
                                    const newValue = currentValue + ':' + e.key;
                                    setNewRowData({...newRowData, startTime: newValue});
                                  }
                                }}
                                className="inline-input time-input"
                                pattern="(1[0-2]|0?[1-9])(:[0-5][0-9])?\s*(AM|PM|am|pm)"
                                title="Format: HH:MM AM/PM (e.g., 9:00 AM, 2:30 PM)"
                                maxLength="8"
                                required
                              />
                              <span>to</span>
                              <input
                                type="text"
                                placeholder="HH:MM PM"
                                value={newRowData.endTime}
                                onChange={(e) => {
                                  const rawValue = e.target.value;
                                  const formattedValue = formatTimeInput(rawValue);
                                  
                                  // Always update the input value to allow natural typing
                                  setNewRowData({...newRowData, endTime: formattedValue});
                                  
                                  // Only attempt duration calculation if we have a reasonably complete time
                                  if (formattedValue && formattedValue.length >= 3 && newRowData.durationMode === 'end' && newRowData.duration) {
                                    try {
                                      const calculatedStartTime = calculateStartTime(formattedValue, parseFloat(newRowData.duration));
                                      if (calculatedStartTime) {
                                        setNewRowData(prev => ({...prev, startTime: calculatedStartTime}));
                                      }
                                    } catch (error) {
                                      // Silently ignore calculation errors during typing
                                      console.debug('Duration calculation skipped during typing');
                                    }
                                  }
                                }}
                                onKeyDown={(e) => {
                                  // Auto-insert colon when user types a number after 2 digits
                                  const currentValue = e.target.value;
                                  if (e.key >= '0' && e.key <= '9' && currentValue.length === 2 && !currentValue.includes(':')) {
                                    e.preventDefault();
                                    const newValue = currentValue + ':' + e.key;
                                    setNewRowData({...newRowData, endTime: newValue});
                                  }
                                }}
                                className="inline-input time-input"
                                pattern="(1[0-2]|0?[1-9])(:[0-5][0-9])?\s*(AM|PM|am|pm)"
                                title="Format: HH:MM AM/PM (e.g., 9:00 AM, 2:30 PM)"
                                maxLength="8"
                                required
                              />
                            </div>
                            {/* Duration Calculator */}
                            <div className="duration-calculator">
                              <select
                                value={newRowData.durationMode}
                                onChange={(e) => setNewRowData({...newRowData, durationMode: e.target.value})}
                                className="inline-select"
                              >
                                <option value="start">Start + Duration</option>
                                <option value="end">End + Duration</option>
                              </select>
                              <input
                                type="number"
                                placeholder="Hours"
                                value={newRowData.duration}
                                onChange={(e) => {
                                  const duration = e.target.value;
                                  setNewRowData({...newRowData, duration});
                                  
                                  // Auto-calculate the other time based on mode
                                  if (newRowData.durationMode === 'start' && newRowData.startTime && duration) {
                                    const calculatedEndTime = calculateEndTime(newRowData.startTime, parseFloat(duration));
                                    if (calculatedEndTime) {
                                      setNewRowData(prev => ({...prev, endTime: calculatedEndTime}));
                                    }
                                  } else if (newRowData.durationMode === 'end' && newRowData.endTime && duration) {
                                    const calculatedStartTime = calculateStartTime(newRowData.endTime, parseFloat(duration));
                                    if (calculatedStartTime) {
                                      setNewRowData(prev => ({...prev, startTime: calculatedStartTime}));
                                    }
                                  }
                                }}
                                className="inline-input"
                                min="0"
                                step="0.25"
                                title="Enter duration in hours (e.g., 2.5 for 2.5 hours)"
                              />
                              <span className="duration-label">hrs</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="duration-cell">
                            {newRowData.startTime && newRowData.endTime ? 
                              (() => {
                                try {
                                  const startTime24h = convertTo24Hour(newRowData.startTime);
                                  const endTime24h = convertTo24Hour(newRowData.endTime);
                                  
                                  const start = new Date(`${newRowData.date}T${startTime24h}`);
                                  let end = new Date(`${newRowData.date}T${endTime24h}`);
                                  
                                  // Handle overnight entries
                                  if (end < start) {
                                    end = new Date(end);
                                    end.setDate(end.getDate() + 1);
                                  }
                                  
                                  const duration = Math.floor((end - start) / 1000);
                                  return duration > 0 ? formatTime(duration) : '--:--';
                                } catch (error) {
                                  return '--:--';
                                }
                              })() : 
                              '--:--'
                            }
                          </span>
                        </td>
                        <td>
                          <select
                            value={newRowData.project}
                            onChange={(e) => {
                              const selectedProject = e.target.value;
                              setNewRowData({
                                ...newRowData, 
                                project: selectedProject,
                                areaOfFocus: '', // Clear area of focus when project changes
                                costCode: '' // Clear cost code when project changes
                              });
                            }}
                            className="inline-select"
                          >
                            <option value="">Select Project</option>
                            {projects.map(project => (
                              <option key={project.id} value={project.id}>
                                {project.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            value={newRowData.areaOfFocus}
                            onChange={(e) => {
                              const selectedArea = e.target.value;
                              console.log('=== AREA OF FOCUS SELECTION DEBUG ===');
                              console.log('Selected area ID:', selectedArea);
                              console.log('Previous newRowData:', newRowData);
                              
                              setNewRowData({
                                ...newRowData, 
                                areaOfFocus: selectedArea,
                                costCode: '' // Clear cost code when area of focus changes
                              });
                              
                              console.log('Updated newRowData:', {...newRowData, areaOfFocus: selectedArea, costCode: ''});
                            }}
                            className="inline-select"
                            disabled={!newRowData.project}
                          >
                            <option value="">
                              {newRowData.project ? 'Select Area of Focus' : 'Select project first'}
                            </option>
                            {newRowData.project && (() => {
                              // Get areas of focus that have cost codes assigned to the selected project
                              const selectedProject = projects.find(p => p.id === newRowData.project);
                              console.log('Selected project:', selectedProject);
                              console.log('Project cost code assignments:', selectedProject?.costCodeAssignments);
                              
                              if (!selectedProject?.costCodeAssignments || selectedProject.costCodeAssignments.length === 0) {
                                console.log('No cost code assignments found for project - showing all areas as fallback');
                                // Fallback: show all areas of focus if no cost codes are assigned
                                return areasOfFocus.length > 0 ? (
                                  areasOfFocus.map(area => (
                                    <option key={area.id} value={area.id}>
                                      {area.name} (no cost codes assigned)
                                    </option>
                                  ))
                                ) : (
                                  <option value="" disabled>No areas available - assign cost codes to this project first</option>
                                );
                              }
                              
                              const assignedAreaIds = selectedProject.costCodeAssignments
                                .map(assignment => {
                                  console.log('Processing assignment:', assignment);
                                  const costCode = costCodes.find(cc => cc.id === assignment.costCodeId);
                                  console.log('Found cost code:', costCode);
                                  return costCode?.areaOfFocusId;
                                })
                                .filter((areaId, index, arr) => {
                                  const isValid = areaId && arr.indexOf(areaId) === index;
                                  console.log('Area ID:', areaId, 'isValid:', isValid);
                                  return isValid;
                                });
                              
                              console.log('Assigned area IDs:', assignedAreaIds);
                              console.log('Available areas of focus:', areasOfFocus);
                              
                              const filteredAreas = areasOfFocus.filter(area => {
                                const isIncluded = assignedAreaIds.includes(area.id);
                                console.log('Area:', area.name, 'ID:', area.id, 'included:', isIncluded);
                                return isIncluded;
                              });
                              
                              console.log('Filtered areas:', filteredAreas);
                              
                              if (filteredAreas.length === 0) {
                                return <option value="" disabled>No areas available for this project</option>;
                              }
                              
                              return filteredAreas.map(area => (
                                <option key={area.id} value={area.id}>
                                  {area.name}
                                </option>
                              ));
                            })()}
                          </select>
                        </td>
                        <td>
                          <select
                            value={newRowData.costCode}
                            onChange={(e) => setNewRowData({...newRowData, costCode: e.target.value})}
                            className="inline-select"
                            disabled={!newRowData.areaOfFocus}
                          >
                            <option value="">
                              {newRowData.areaOfFocus ? 'Select Cost Code' : 'Select area of focus first'}
                            </option>
                            {newRowData.areaOfFocus && (() => {
                              console.log('=== COST CODE DEBUGGING ===');
                              console.log('newRowData.areaOfFocus:', newRowData.areaOfFocus);
                              console.log('newRowData.project:', newRowData.project);
                              console.log('Data loading status - projects:', projects.length, 'costCodes:', costCodes.length);
                              
                              // Check if data is still loading
                              if (projects.length === 0 || costCodes.length === 0) {
                                console.log('Data still loading...');
                                return <option value="" disabled>Loading cost codes...</option>;
                              }
                              const selectedProject = projects.find(p => p.id === newRowData.project);
                              console.log('Selected project for cost codes:', selectedProject);
                              console.log('Project cost code assignments:', selectedProject?.costCodeAssignments);
                              console.log('All cost codes:', costCodes);
                              
                              if (!selectedProject?.costCodeAssignments || selectedProject.costCodeAssignments.length === 0) {
                                console.log('No cost code assignments found for project - showing all cost codes for area as fallback');
                                // Fallback: show all cost codes for the selected area if no assignments exist
                                const fallbackCostCodes = costCodes.filter(cc => cc.areaOfFocusId === newRowData.areaOfFocus);
                                console.log('Fallback cost codes for area:', fallbackCostCodes);
                                
                                if (fallbackCostCodes.length === 0) {
                                  return <option value="" disabled>No cost codes available - assign cost codes to this project first</option>;
                                }
                                
                                return fallbackCostCodes.map(costCode => (
                                  <option key={costCode.id} value={costCode.code}>
                                    {costCode.code} - {costCode.description} (not assigned to project)
                                    {costCode.costPerHour && ` (${costCode.costPerHour}/hr)`}
                                  </option>
                                ));
                              }
                              
                              const availableCostCodes = selectedProject.costCodeAssignments
                                .map(assignment => {
                                  console.log('Processing assignment for cost code:', assignment);
                                  const costCode = costCodes.find(cc => cc.id === assignment.costCodeId);
                                  console.log('Found cost code:', costCode);
                                  return costCode;
                                })
                                .filter(costCode => {
                                  const matches = costCode && costCode.areaOfFocusId === newRowData.areaOfFocus;
                                  console.log('Cost code:', costCode?.code, 'areaOfFocusId:', costCode?.areaOfFocusId, 'selected area:', newRowData.areaOfFocus, 'matches:', matches);
                                  return matches;
                                });
                              
                              console.log('Available cost codes for area:', availableCostCodes);
                              
                              if (availableCostCodes.length === 0) {
                                console.log('No cost codes match the criteria');
                                return <option value="" disabled>No cost codes available for this area</option>;
                              }
                              
                              return availableCostCodes.map(costCode => (
                                <option key={costCode.id} value={costCode.code}>
                                  {costCode.code} - {costCode.description}
                                  {costCode.costPerHour && ` (${costCode.costPerHour}/hr)`}
                                </option>
                              ));
                            })()}
                          </select>
                        </td>
                        <td>
                          <input
                            type="text"
                            value={newRowData.note}
                            onChange={(e) => setNewRowData({...newRowData, note: e.target.value})}
                            className="inline-input"
                            placeholder="Add a note..."
                          />
                        </td>
                        <td>
                          <div className="action-buttons">
                            <button
                              onClick={saveAddRow}
                              className="save-btn-small"
                              title="Save Entry"
                            >
                              💾
                            </button>
                            <button
                              onClick={cancelAddRow}
                              className="cancel-btn-small"
                              title="Cancel"
                            >
                              ❌
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>

                {filteredAndSortedEntries().length === 0 && !showAddRow && (
                  <div className="no-data">
                    <p>No time entries found matching your criteria.</p>
                  </div>
                )}
              </div>

              {/* Pagination */}
              {filteredAndSortedEntries().length > entriesPerPage && (
                <div className="pagination">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="pagination-btn"
                  >
                    Previous
                  </button>

                  <span className="pagination-info">
                    Page {currentPage} of {Math.ceil(filteredAndSortedEntries().length / entriesPerPage)}
                    ({filteredAndSortedEntries().length} total entries)
                  </span>

                  <button
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, Math.ceil(filteredAndSortedEntries().length / entriesPerPage)))}
                    disabled={currentPage === Math.ceil(filteredAndSortedEntries().length / entriesPerPage)}
                    className="pagination-btn"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'tasks' && (
        <div className="tasks-tab-content">
          <div className="tasks-header">
            <h1>Task & Submission Management</h1>
          </div>

          <div className="tasks-content">
            {/* Task Management */}
            <div className="section">
              <div className="section-header">
                <h3>Task Management</h3>
                <button
                  className="create-task-btn"
                  onClick={() => setShowTaskModal(true)}
                >
                  Create Task
                </button>
              </div>

              {/* Task Progress for Today */}
              <div className="task-progress-section">
                <h4>Add Progress for Today</h4>
                <form onSubmit={addTaskProgress} className="progress-form">
                  <div className="form-row">
                    <select
                      value={taskProgress.taskId}
                      onChange={(e) => setTaskProgress({...taskProgress, taskId: e.target.value})}
                      required
                    >
                      <option value="">Select Task</option>
                      {tasks.filter(task => task.status !== 'completed').map(task => (
                        <option key={task.id} value={task.id}>{task.title}</option>
                      ))}
                    </select>
                    <input
                      type="date"
                      value={taskProgress.date}
                      onChange={(e) => setTaskProgress({...taskProgress, date: e.target.value})}
                      required
                    />
                  </div>
                  <div className="form-row">
                    <textarea
                      placeholder="Progress made today..."
                      value={taskProgress.progress}
                      onChange={(e) => setTaskProgress({...taskProgress, progress: e.target.value})}
                      rows="2"
                      required
                    />
                    <textarea
                      placeholder="Additional notes (optional)"
                      value={taskProgress.notes}
                      onChange={(e) => setTaskProgress({...taskProgress, notes: e.target.value})}
                      rows="2"
                    />
                  </div>
                  <button type="submit" className="add-progress-btn">Add Progress</button>
                </form>
              </div>

              {/* Task List */}
              <div className="tasks-list">
                {tasks.map(task => (
                  <div key={task.id} className={`task-card ${task.status}`}>
                    <div className="task-header">
                      <h4>{task.title}</h4>
                      <div className="task-actions">
                        <select
                          value={task.status}
                          onChange={(e) => updateTaskStatus(task.id, e.target.value)}
                          className="status-select"
                        >
                          <option value="pending">Pending</option>
                          <option value="in-progress">In Progress</option>
                          <option value="completed">Completed</option>
                          <option value="on-hold">On Hold</option>
                        </select>
                        <button onClick={() => editTask(task)} className="edit-btn">Edit</button>
                        <button onClick={() => deleteTask(task.id)} className="delete-btn">Delete</button>
                      </div>
                    </div>
                    <p className="task-description">{task.description}</p>
                    <div className="task-meta">
                      <span className={`priority ${task.priority}`}>
                        {task.priority} priority
                      </span>
                      {task.dueDate && (
                        <span className="due-date">Due: {task.dueDate}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Submissions Management */}
            <div className="section">
              <div className="section-header">
                <h3>Submissions Management</h3>
                <button
                  className="create-submission-btn"
                  onClick={() => setShowSubmissionModal(true)}
                >
                  Create Submission
                </button>
              </div>

              {/* Submissions List */}
              <div className="submissions-list">
                {submissions.length === 0 ? (
                  <div className="no-submissions">
                    <p>No submissions yet. Create your first submission to get started!</p>
                  </div>
                ) : (
                  submissions.map(submission => (
                    <div key={submission.id} className={`submission-card ${submission.status}`}>
                      <div className="submission-header">
                        <div className="submission-info">
                          <h4>{submission.title}</h4>
                          <span className={`submission-type ${submission.type}`}>
                            {submission.type}
                          </span>
                        </div>
                        <div className="submission-actions">
                          <select
                            value={submission.status}
                            onChange={(e) => updateSubmissionStatus(submission.id, e.target.value)}
                            className="status-select"
                          >
                            <option value="draft">Draft</option>
                            <option value="pending">Pending Review</option>
                            <option value="approved">Approved</option>
                            <option value="rejected">Rejected</option>
                            <option value="submitted">Submitted</option>
                          </select>
                          <button onClick={() => editSubmission(submission)} className="edit-btn">Edit</button>
                          <button onClick={() => deleteSubmission(submission.id)} className="delete-btn">Delete</button>
                        </div>
                      </div>

                      <p className="submission-description">{submission.description}</p>

                      {submission.relatedTaskId && (
                        <div className="related-task">
                          <strong>Related Task:</strong> {
                            tasks.find(task => task.id === submission.relatedTaskId)?.title || 'Unknown Task'
                          }
                        </div>
                      )}

                      {submission.content && (
                        <div className="submission-content">
                          <strong>Content:</strong>
                          <div className="content-preview">
                            {submission.content.substring(0, 200)}
                            {submission.content.length > 200 && '...'}
                          </div>
                        </div>
                      )}

                      <div className="submission-meta">
                        {submission.dueDate && (
                          <span className="due-date">Due: {submission.dueDate}</span>
                        )}
                        <span className="created-date">
                          Created: {submission.createdAt?.toDate ?
                            submission.createdAt.toDate().toLocaleDateString() :
                            'Unknown'
                          }
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'areasOfFocus' && (
        <div className="areas-of-focus-tab-content">
          <div className="areas-of-focus-header">
            <h1>Areas of Focus Management</h1>
            <button className="add-btn" onClick={() => setShowAreaOfFocusModal(true)}>
              + Add Area of Focus
            </button>
          </div>

          <div className="areas-of-focus-list">
            {areasOfFocus.length === 0 ? (
              <div className="no-areas-placeholder">
                <div className="placeholder-icon">🎯</div>
                <h3>No Areas of Focus Yet</h3>
                <p>Create your first area of focus to organize your projects and track time more effectively.</p>
                <button className="add-btn" onClick={() => setShowAreaOfFocusModal(true)}>
                  + Create Your First Area of Focus
                </button>
              </div>
            ) : (
              areasOfFocus.map(area => (
                <div key={area.id} className="area-of-focus-card">
                  <div className="area-header">
                    <div className="area-info">
                      <div
                        className="area-color-indicator"
                        style={{ backgroundColor: area.color }}
                        title={`Color: ${area.color}`}
                      ></div>
                      <div className="area-title-section">
                        <h3>{area.name}</h3>
                        <div className="area-meta">
                          <span className="area-id">ID: {area.id.slice(-6)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="area-actions">
                      <button
                        onClick={() => editAreaOfFocus(area)}
                        className="edit-btn"
                        title="Edit Area of Focus"
                      >
                        ✏️ Edit
                      </button>
                      <button
                        onClick={() => deleteAreaOfFocus(area.id)}
                        className="delete-btn"
                        title="Delete Area of Focus"
                      >
                        🗑️ Delete
                      </button>
                    </div>
                  </div>

                  <div className="area-content">
                    <p className="area-description">
                      {area.description || 'No description provided'}
                    </p>

                    <div className="area-stats-grid">
                      <div className="stat-item">
                        <div className="stat-icon">💰</div>
                        <div className="stat-content">
                          <div className="stat-number">
                            {costCodes.filter(cc => cc.areaOfFocusId === area.id).length}
                          </div>
                          <div className="stat-label">Cost Codes</div>
                        </div>
                      </div>

                      <div className="stat-item">
                        <div className="stat-icon">⏱️</div>
                        <div className="stat-content">
                          <div className="stat-number">
                            {timeEntries.filter(entry =>
                              entry.areaOfFocus === area.id &&
                              entry.project &&
                              projects.find(p => p.id === entry.project)?.costCodeAssignments?.some(
                                assignment => costCodes.find(cc => cc.id === assignment.costCodeId)?.areaOfFocusId === area.id
                              )
                            ).length}
                          </div>
                          <div className="stat-label">Time Entries</div>
                        </div>
                      </div>

                      <div className="stat-item">
                        <div className="stat-icon">📊</div>
                        <div className="stat-content">
                          <div className="stat-number">
                            {Object.values(
                              timeEntries
                                .filter(entry =>
                                  entry.areaOfFocus === area.id &&
                                  entry.project &&
                                  projects.find(p => p.id === entry.project)?.costCodeAssignments?.some(
                                    assignment => costCodes.find(cc => cc.id === assignment.costCodeId)?.areaOfFocusId === area.id
                                  )
                                )
                                .reduce((acc, entry) => {
                                  const key = `${entry.date}-${entry.project}-${entry.areaOfFocus}-${entry.costCode}`;
                                  if (!acc[key]) {
                                    acc[key] = { hours: entry.duration ? entry.duration / 3600 : 0 };
                                  }
                                  return acc;
                                }, {})
                            ).reduce((sum, entry) => sum + entry.hours, 0).toFixed(1)}h
                          </div>
                          <div className="stat-label">Total Hours</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'projects' && (
        <div className="projects-tab-content">
          <div className="projects-header">
            <h1>Project Management</h1>
            <button className="add-btn" onClick={() => setShowProjectModal(true)}>
              + Add Project
            </button>
          </div>

          <div className="projects-list">
            {projects.length === 0 ? (
              <div className="no-projects-placeholder">
                <div className="placeholder-icon">📁</div>
                <h3>No Projects Yet</h3>
                <p>Create your first project to start organizing your work and tracking time effectively.</p>
                <button className="add-btn" onClick={() => setShowProjectModal(true)}>
                  + Create Your First Project
                </button>
              </div>
            ) : (
              projects.map(project => (
                <div key={project.id} className="project-card">
                  <div className="project-header">
                    <div className="project-info">
                      <div className="project-icon">📁</div>
                      <div className="project-title-section">
                        <h3>{project.name}</h3>
                        <div className="project-meta">
                          <span className="project-id">ID: {project.id.slice(-6)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="project-actions">
                      <button
                        onClick={() => viewProjectProfile(project)}
                        className="view-btn"
                        title="View Project Profile"
                      >
                        👁️ View
                      </button>
                      <button
                        onClick={() => {
                          setEditingProject(project);
                          setNewProject({
                            name: project.name,
                            description: project.description,
                            costCodeAssignments: project.costCodeAssignments || []
                          });
                          setShowProjectModal(true);
                        }}
                        className="edit-btn"
                        title="Edit Project"
                      >
                        ✏️ Edit
                      </button>
                      <button
                        onClick={() => deleteProject(project.id)}
                        className="delete-btn"
                        title="Delete Project"
                      >
                        🗑️ Delete
                      </button>
                    </div>
                  </div>

                  <div className="project-content">
                    <p className="project-description">
                      {project.description || 'No description provided'}
                    </p>

                    <div className="project-stats-grid">
                      <div className="stat-item">
                        <div className="stat-icon">💰</div>
                        <div className="stat-content">
                          <div className="stat-number">
                            {project.costCodeAssignments?.length || 0}
                          </div>
                          <div className="stat-label">Cost Codes</div>
                        </div>
                      </div>

                      <div className="stat-item">
                        <div className="stat-icon">⏱️</div>
                        <div className="stat-content">
                          <div className="stat-number">
                            {timeEntries.filter(entry =>
                              entry.project === project.id &&
                              entry.areaOfFocus &&
                              project.costCodeAssignments?.some(
                                assignment => costCodes.find(cc => cc.id === assignment.costCodeId)?.areaOfFocusId === entry.areaOfFocus
                              )
                            ).length}
                          </div>
                          <div className="stat-label">Time Entries</div>
                        </div>
                      </div>

                      <div className="stat-item">
                        <div className="stat-icon">📊</div>
                        <div className="stat-content">
                          <div className="stat-number">
                            {Object.values(
                              timeEntries
                                .filter(entry =>
                                  entry.project === project.id &&
                                  entry.areaOfFocus &&
                                  project.costCodeAssignments?.some(
                                    assignment => costCodes.find(cc => cc.id === assignment.costCodeId)?.areaOfFocusId === entry.areaOfFocus
                                  )
                                )
                                .reduce((acc, entry) => {
                                  const key = `${entry.date}-${entry.areaOfFocus}-${entry.costCode}`;
                                  if (!acc[key]) {
                                    acc[key] = { hours: entry.duration ? entry.duration / 3600 : 0 };
                                  }
                                  return acc;
                                }, {})
                            ).reduce((sum, entry) => sum + entry.hours, 0).toFixed(1)}h
                          </div>
                          <div className="stat-label">Total Hours</div>
                        </div>
                      </div>
                    </div>

                    {project.costCodeAssignments && project.costCodeAssignments.length > 0 && (
                      <div className="project-cost-codes-preview">
                        <div className="cost-codes-label">Recent Cost Codes:</div>
                        <div className="cost-codes-badges">
                          {project.costCodeAssignments.slice(0, 3).map(assignment => {
                            const costCode = costCodes.find(cc => cc.id === assignment.costCodeId);
                            return (
                              <span key={assignment.costCodeId} className="cost-code-badge">
                                {costCode?.code || 'Unknown'}
                              </span>
                            );
                          })}
                          {project.costCodeAssignments.length > 3 && (
                            <span className="cost-code-badge more">
                              +{project.costCodeAssignments.length - 3} more
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'costCodes' && (
        <div className="cost-codes-tab-content">
          <div className="cost-codes-header">
            <h1>Cost Code Management</h1>
            <button className="add-btn" onClick={() => setShowCostCodeModal(true)}>
              + Add Cost Code
            </button>
          </div>

          <div className="cost-codes-list">
            {costCodes.length === 0 ? (
              <div className="no-cost-codes-placeholder">
                <div className="placeholder-icon">💰</div>
                <h3>No Cost Codes Yet</h3>
                <p>Create your first cost code to start tracking expenses and organizing your billing structure.</p>
                <button className="add-btn" onClick={() => setShowCostCodeModal(true)}>
                  + Create Your First Cost Code
                </button>
              </div>
            ) : (
              costCodes.map(costCode => (
                <div key={costCode.id} className="cost-code-card">
                  <div className="cost-code-header">
                    <div className="cost-code-info">
                      <div className="cost-code-icon">💰</div>
                      <div className="cost-code-title-section">
                        <h3>{costCode.code}</h3>
                        <div className="cost-code-meta">
                          <span className="cost-code-id">ID: {costCode.id.slice(-6)}</span>
                          {costCode.areaOfFocusId && (
                            <span className="area-badge">
                              {areasOfFocus.find(area => area.id === costCode.areaOfFocusId)?.name || 'Unknown Area'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="cost-code-actions">
                      <button
                        onClick={() => {
                          setEditingCostCode(costCode);
                          setNewCostCode({
                            code: costCode.code,
                            description: costCode.description,
                            category: costCode.category,
                            costPerHour: costCode.costPerHour || '',
                            areaOfFocusId: costCode.areaOfFocusId || ''
                          });
                          setShowCostCodeModal(true);
                        }}
                        className="edit-btn"
                        title="Edit Cost Code"
                      >
                        ✏️ Edit
                      </button>
                      <button
                        onClick={() => deleteCostCode(costCode.id)}
                        className="delete-btn"
                        title="Delete Cost Code"
                      >
                        🗑️ Delete
                      </button>
                    </div>
                  </div>

                  <div className="cost-code-content">
                    <p className="cost-code-description">
                      {costCode.description || 'No description provided'}
                    </p>

                    <div className="cost-code-stats-grid">
                      <div className="stat-item">
                        <div className="stat-icon">📂</div>
                        <div className="stat-content">
                          <div className="stat-number">
                            {costCode.category || 'General'}
                          </div>
                          <div className="stat-label">Category</div>
                        </div>
                      </div>

                      <div className="stat-item">
                        <div className="stat-icon">💵</div>
                        <div className="stat-content">
                          <div className="stat-number">
                            {costCode.costPerHour ? `$${costCode.costPerHour}` : 'Not set'}
                          </div>
                          <div className="stat-label">Rate/Hour</div>
                        </div>
                      </div>

                      <div className="stat-item">
                        <div className="stat-icon">📊</div>
                        <div className="stat-content">
                          <div className="stat-number">
                            {projects.filter(project =>
                              project.costCodeAssignments?.some(assignment => assignment.costCodeId === costCode.id)
                            ).length}
                          </div>
                          <div className="stat-label">Projects</div>
                        </div>
                      </div>
                    </div>

                    <div className="cost-code-usage">
                      <div className="usage-label">Usage:</div>
                      <div className="usage-stats">
                        <span className="usage-stat">
                          {timeEntries.filter(entry => entry.costCode === costCode.code).length} entries
                        </span>
                        <span className="usage-stat">
                          {Object.values(
                            timeEntries
                              .filter(entry => entry.costCode === costCode.code)
                              .reduce((acc, entry) => {
                                const key = `${entry.date}-${entry.project}-${entry.areaOfFocus}`;
                                if (!acc[key]) {
                                  acc[key] = { hours: entry.duration ? entry.duration / 3600 : 0 };
                                }
                                return acc;
                              }, {})
                          ).reduce((sum, entry) => sum + entry.hours, 0).toFixed(1)}h tracked
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'projectProfile' && selectedProject && (
        <div className="project-profile-tab-content">
          <div className="project-profile-header">
            <div className="project-profile-info">
              <h1>{selectedProject.name}</h1>
              <p>{selectedProject.description}</p>
              <div className="project-stats">
                <span>Total Time Entries: {projectTimeEntries.length}</span>
                <span>Actual Hours: {Object.values(projectCostCodeStats).reduce((sum, stat) => sum + stat.totalHours, 0).toFixed(2)}</span>
                <span>Actual Cost: ${Object.entries(projectCostCodeStats).reduce((sum, [code, stat]) => {
                  const costCode = costCodes.find(cc => cc.code === code);
                  return sum + (stat.totalHours * (costCode?.costPerHour ? parseFloat(costCode.costPerHour) : 0));
                }, 0).toFixed(2)}</span>
                {(() => {
                  console.log('=== PROJECT STATS DEBUG ===');
                  console.log('selectedProject:', selectedProject);
                  console.log('costCodeAssignments:', selectedProject?.costCodeAssignments);
                  console.log('costCodeAssignments length:', selectedProject?.costCodeAssignments?.length);
                  
                  const hasAssignments = selectedProject?.costCodeAssignments && selectedProject.costCodeAssignments.length > 0;
                  console.log('hasAssignments:', hasAssignments);
                  
                  if (hasAssignments) {
                    const totalAssigned = selectedProject.costCodeAssignments.reduce((sum, assignment) => sum + parseFloat(assignment.hours || 0), 0);
                    console.log('totalAssigned:', totalAssigned);
                  }
                  
                  return hasAssignments ? (
                    <>
                      <span>Assigned Hours: {selectedProject.costCodeAssignments.reduce((sum, assignment) => sum + parseFloat(assignment.hours || 0), 0).toFixed(2)}</span>
                      <span>Assigned Cost: ${selectedProject.costCodeAssignments.reduce((sum, assignment) => {
                        const costCode = costCodes.find(cc => cc.id === assignment.costCodeId);
                        return sum + (parseFloat(assignment.hours || 0) * (costCode?.costPerHour ? parseFloat(costCode.costPerHour) : 0));
                      }, 0).toFixed(2)}</span>
                    </>
                  ) : (
                    <span>No assigned hours (add cost code assignments to this project)</span>
                  );
                })()}
              </div>
            </div>
            <button 
              className="back-btn"
              onClick={() => {
                setSelectedProject(null);
                setProjectTimeEntries([]);
                setProjectCostCodeStats({});
                handleTabChange('projects');
              }}
            >
              ← Back to Projects
            </button>
          </div>

          <div className="project-profile-content">
            {/* Cost Code Assignment Section */}
            <div className="section">
              <h3>Cost Code Assignments & Progress</h3>
              
              {/* Summary Stats */}
              {selectedProject.costCodeAssignments && Array.isArray(selectedProject.costCodeAssignments) && selectedProject.costCodeAssignments.length > 0 && (
                <div className="assignment-summary">
                  <div className="summary-stats">
                    <div className="summary-item">
                      <span className="summary-label">Total Assigned:</span>
                      <span className="summary-value">
                        {(() => {
                          try {
                            return selectedProject.costCodeAssignments.reduce((sum, assignment) => sum + parseFloat(assignment.hours || 0), 0).toFixed(2);
                          } catch (error) {
                            console.error('Error calculating total assigned hours:', error);
                            return '0.00';
                          }
                        })()}h
                      </span>
                    </div>
                    <div className="summary-item">
                      <span className="summary-label">Total Actual:</span>
                      <span className="summary-value">
                        {(() => {
                          try {
                            return Object.values(projectCostCodeStats).reduce((sum, stat) => sum + (stat?.totalHours || 0), 0).toFixed(2);
                          } catch (error) {
                            console.error('Error calculating total actual hours:', error);
                            return '0.00';
                          }
                        })()}h
                      </span>
                    </div>
                    <div className="summary-item">
                      <span className="summary-label">Overall Progress:</span>
                      <div className="progress-container">
                        <div 
                          className="progress-bar"
                          style={{
                            width: `${(() => {
                              try {
                                const totalAssigned = selectedProject.costCodeAssignments.reduce((sum, assignment) => sum + parseFloat(assignment.hours || 0), 0);
                                const totalActual = Object.values(projectCostCodeStats).reduce((sum, stat) => sum + stat.totalHours, 0);
                                const progress = totalAssigned > 0 ? (totalActual / totalAssigned) * 100 : 0;
                                return Math.min(Math.max(progress, 0), 100); // Ensure between 0-100
                              } catch (error) {
                                console.error('Error calculating overall progress:', error);
                                return 0;
                              }
                            })()}%`
                          }}
                        ></div>
                        <span className="progress-text">
                          {(() => {
                            try {
                              const totalAssigned = selectedProject.costCodeAssignments.reduce((sum, assignment) => sum + parseFloat(assignment.hours || 0), 0);
                              const totalActual = Object.values(projectCostCodeStats).reduce((sum, stat) => sum + stat.totalHours, 0);
                              const progress = totalAssigned > 0 ? (totalActual / totalAssigned) * 100 : 0;
                              return `${Math.max(progress, 0).toFixed(1)}%`;
                            } catch (error) {
                              console.error('Error calculating overall progress percentage:', error);
                              return '0.0%';
                            }
                          })()}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Show summary even when no assignments */}
              {(!selectedProject.costCodeAssignments || selectedProject.costCodeAssignments.length === 0) && (
                <div className="assignment-summary">
                  <div className="summary-stats">
                    <div className="summary-item">
                      <span className="summary-label">Status:</span>
                      <span className="summary-value">No cost code assignments</span>
                    </div>
                    <div className="summary-item">
                      <span className="summary-label">Total Actual:</span>
                      <span className="summary-value">
                        {Object.values(projectCostCodeStats).reduce((sum, stat) => sum + stat.totalHours, 0).toFixed(2)}h
                      </span>
                    </div>
                  </div>
                </div>
              )}
              
              <div className="assigned-cost-codes">
                {selectedProject.costCodeAssignments && Array.isArray(selectedProject.costCodeAssignments) && selectedProject.costCodeAssignments.length > 0 ? (
                  selectedProject.costCodeAssignments
                    .filter(assignment => assignment && assignment.costCodeId) // Filter out invalid assignments
                    .map(assignment => {
                    const costCode = costCodes.find(cc => cc.id === assignment.costCodeId);
                    const stats = projectCostCodeStats[costCode?.code] || { totalHours: 0, totalEntries: 0 };
                    
                    return (
                      <div key={assignment.costCodeId} className="assigned-cost-code-item">
                        <div className="cost-code-details">
                          <h4>{costCode?.code || 'Unknown'}</h4>
                          <p>{costCode?.description || 'No description'}</p>
                          <div className="cost-code-stats">
                            <div className="stats-group">
                              <span className="stat-label">Assigned:</span>
                              <span className="stat-value">{assignment.hours || '0'}h</span>
                              {costCode?.costPerHour && (
                                <span className="stat-cost">${(parseFloat(assignment.hours || 0) * parseFloat(costCode.costPerHour)).toFixed(2)}</span>
                              )}
                            </div>
                            <div className="stats-group">
                              <span className="stat-label">Actual:</span>
                              <span className="stat-value">{(stats?.totalHours || 0).toFixed(2)}h</span>
                              <span className="stat-entries">({stats?.totalEntries || 0} entries)</span>
                              {costCode?.costPerHour && (
                                <span className="stat-cost">${((stats?.totalHours || 0) * parseFloat(costCode.costPerHour)).toFixed(2)}</span>
                              )}
                            </div>
                            <div className="stats-group">
                              <span className="stat-label">Progress:</span>
                              <div className="mini-progress-container">
                                <div 
                                  className="mini-progress-bar"
                                  style={{
                                    width: `${(() => {
                                      try {
                                        const assignedHours = parseFloat(assignment.hours || 0);
                                        const progressPercent = assignedHours > 0 ? (stats.totalHours / assignedHours) * 100 : 0;
                                        return Math.min(Math.max(progressPercent, 0), 100);
                                      } catch (error) {
                                        console.error('Error calculating cost code progress:', error);
                                        return 0;
                                      }
                                    })()}%`
                                  }}
                                ></div>
                              </div>
                              <span className="progress-percent">
                                {(() => {
                                  try {
                                    const assignedHours = parseFloat(assignment.hours || 0);
                                    const progressPercent = assignedHours > 0 ? (stats.totalHours / assignedHours) * 100 : 0;
                                    return `${Math.max(progressPercent, 0).toFixed(1)}%`;
                                  } catch (error) {
                                    console.error('Error calculating cost code progress percentage:', error);
                                    return '0.0%';
                                  }
                                })()}
                              </span>
                            </div>
                          </div>
                        </div>
                        <button 
                          className="remove-btn"
                          onClick={() => removeCostCodeFromProject(assignment.costCodeId)}
                        >
                          Remove
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <p>No cost codes assigned to this project.</p>
                )}
              </div>

              <div className="assign-cost-code-section">
                <h4>Assign New Cost Code</h4>
                <div className="cost-code-selector">
                  {costCodes
                    .filter(cc => !selectedProject.costCodeAssignments?.some(assignment => assignment.costCodeId === cc.id))
                    .map(costCode => (
                      <button
                        key={costCode.id}
                        className="assign-cost-code-btn"
                        onClick={() => assignCostCodeToProject(costCode.id)}
                      >
                        + {costCode.code} - {costCode.description}
                        {costCode.costPerHour && ` (${costCode.costPerHour}/hr)`}
                      </button>
                    ))}
                  {costCodes.filter(cc => !selectedProject.assignedCostCodes?.includes(cc.id)).length === 0 && (
                    <p>All available cost codes are already assigned.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Time Entries Section */}
            <div className="section">
              <h3>Recent Time Entries</h3>
              <div className="time-entries-list">
                {projectTimeEntries.length === 0 ? (
                  <p>No time entries found for this project.</p>
                ) : (
                  projectTimeEntries.slice(0, 10).map(entry => (
                    <div key={entry.id} className="time-entry-item">
                      <div className="entry-details">
                        <span className="entry-date">{new Date(entry.date).toLocaleDateString()}</span>
                        <span className="entry-duration">{formatTime(entry.duration || 0)}</span>
                        <span className="entry-cost-code">Cost Code: {entry.costCode || 'None'}</span>
                      </div>
                      <div className="entry-note">
                        {entry.note && <p>{entry.note}</p>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'progress' && <TaskProgress />}

      </div>
      </div>

      {/* Modals */}
      {/* Task Modal */}
      {showTaskModal && (
        <div className="modal-overlay" onClick={() => setShowTaskModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingTask ? 'Edit Task' : 'Create New Task'}</h3>
              <button 
                className="modal-close"
                onClick={() => {
                  setShowTaskModal(false);
                  setEditingTask(null);
                  setNewTask({
                    title: '',
                    description: '',
                    priority: 'medium',
                    dueDate: '',
                    status: 'pending'
                  });
                }}
              >
                ×
              </button>
            </div>
            
            <form onSubmit={saveTask} className="task-form">
              <div className="form-group">
                <label>Task Title</label>
                <input
                  type="text"
                  value={newTask.title}
                  onChange={(e) => setNewTask({...newTask, title: e.target.value})}
                  required
                />
              </div>
              
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={newTask.description}
                  onChange={(e) => setNewTask({...newTask, description: e.target.value})}
                  rows="3"
                />
              </div>
              
              <div className="form-row">
                <div className="form-group">
                  <label>Priority</label>
                  <select
                    value={newTask.priority}
                    onChange={(e) => setNewTask({...newTask, priority: e.target.value})}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                
                <div className="form-group">
                  <label>Due Date</label>
                  <input
                    type="date"
                    value={newTask.dueDate}
                    onChange={(e) => setNewTask({...newTask, dueDate: e.target.value})}
                  />
                </div>
              </div>
              
              <div className="form-group">
                <label>Status</label>
                <select
                  value={newTask.status}
                  onChange={(e) => setNewTask({...newTask, status: e.target.value})}
                >
                  <option value="pending">Pending</option>
                  <option value="in-progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="on-hold">On Hold</option>
                </select>
              </div>
              
              <div className="modal-actions">
                <button type="submit" className="save-btn">
                  {editingTask ? 'Update Task' : 'Create Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Project Modal */}
      {showProjectModal && (
        <div className="modal-overlay" onClick={() => setShowProjectModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingProject ? 'Edit Project' : 'Create New Project'}</h3>
              <button 
                className="modal-close"
                onClick={() => {
                  setShowProjectModal(false);
                  setEditingProject(null);
                  setNewProject({
                    name: '',
                    description: '',
                    costCodeAssignments: []
                  });
                }}
              >
                ×
              </button>
            </div>
            
            <form onSubmit={saveProject} className="project-form">
              <div className="form-group">
                <label>Project Name</label>
                <input
                  type="text"
                  value={newProject.name}
                  onChange={(e) => setNewProject({...newProject, name: e.target.value})}
                  required
                />
              </div>
              
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={newProject.description}
                  onChange={(e) => setNewProject({...newProject, description: e.target.value})}
                  rows="3"
                />
              </div>
              
              {editingProject && (
                <div className="cost-code-assignments-section">
                  <h4>Cost Code Assignments</h4>
                  
                  {/* Current Assignments */}
                  <div className="current-assignments">
                    <h5>Current Assignments</h5>
                    {newProject.costCodeAssignments && newProject.costCodeAssignments.length > 0 ? (
                      newProject.costCodeAssignments.map(assignment => {
                        const costCode = costCodes.find(cc => cc.id === assignment.costCodeId);
                        return (
                          <div key={assignment.costCodeId} className="assignment-item">
                            <div className="assignment-info">
                              <span className="cost-code-name">{costCode?.code || 'Unknown'}</span>
                              <span className="cost-code-desc">{costCode?.description || ''}</span>
                              {costCode?.costPerHour && (
                                <span className="cost-rate">${costCode.costPerHour}/hr</span>
                              )}
                            </div>
                            <div className="assignment-controls">
                              <input
                                type="number"
                                step="0.25"
                                min="0"
                                max="999"
                                value={assignment.hours}
                                onChange={(e) => updateCostCodeAssignmentHours(assignment.costCodeId, e.target.value)}
                                placeholder="Hours"
                                className="hours-input"
                              />
                              <button
                                type="button"
                                className="remove-assignment-btn"
                                onClick={() => removeCostCodeAssignment(assignment.costCodeId)}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <p>No cost codes assigned yet.</p>
                    )}
                  </div>

                  {/* Add New Assignment */}
                  <div className="add-assignment">
                    <h5>Add Cost Code Assignment</h5>
                    <div className="assignment-form">
                      <select
                        value={newCostCodeAssignment.costCodeId}
                        onChange={(e) => setNewCostCodeAssignment(prev => ({
                          ...prev,
                          costCodeId: e.target.value
                        }))}
                      >
                        <option value="">Select Cost Code</option>
                        {costCodes
                          .filter(cc => !newProject.costCodeAssignments?.some(assignment => assignment.costCodeId === cc.id))
                          .map(costCode => (
                            <option key={costCode.id} value={costCode.id}>
                              {costCode.code} - {costCode.description}
                              {costCode.costPerHour && ` (${costCode.costPerHour}/hr)`}
                            </option>
                          ))}
                      </select>
                      <input
                        type="number"
                        step="0.25"
                        min="0"
                        max="999"
                        value={newCostCodeAssignment.hours}
                        onChange={(e) => setNewCostCodeAssignment(prev => ({
                          ...prev,
                          hours: e.target.value
                        }))}
                        placeholder="Hours (e.g., 2.5)"
                      />
                      <button
                        type="button"
                        className="add-assignment-btn"
                        onClick={addCostCodeAssignment}
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </div>
              )}
              
              <div className="modal-actions">
                <button type="submit" className="save-btn">
                  {editingProject ? 'Update Project' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cost Code Modal */}
      {showCostCodeModal && (
        <div className="modal-overlay" onClick={() => setShowCostCodeModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingCostCode ? 'Edit Cost Code' : 'Create New Cost Code'}</h3>
              <button 
                className="modal-close"
                onClick={() => {
                  setShowCostCodeModal(false);
                  setEditingCostCode(null);
                  setNewCostCode({
                    code: '',
                    description: '',
                    category: '',
                    costPerHour: '',
                    areaOfFocusId: ''
                  });
                }}
              >
                ×
              </button>
            </div>
            
            <form onSubmit={saveCostCode} className="cost-code-form">
              <div className="form-group">
                <label>Area of Focus *</label>
                <select
                  value={newCostCode.areaOfFocusId}
                  onChange={(e) => setNewCostCode({...newCostCode, areaOfFocusId: e.target.value})}
                  required
                >
                  <option value="">Select Area of Focus</option>
                  {areasOfFocus.length === 0 ? (
                    <option value="" disabled>No areas of focus available. Please create one first.</option>
                  ) : (
                    areasOfFocus.map(area => (
                      <option key={area.id} value={area.id}>
                        {area.name}
                      </option>
                    ))
                  )}
                </select>
                {areasOfFocus.length === 0 && (
                  <small style={{color: '#ef4444', marginTop: '4px', display: 'block'}}>
                    You need to create an Area of Focus before adding cost codes. 
                    <button 
                      type="button"
                      onClick={() => {
                        setShowCostCodeModal(false);
                        setShowAreaOfFocusModal(true);
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#667eea',
                        textDecoration: 'underline',
                        cursor: 'pointer',
                        marginLeft: '4px'
                      }}
                    >
                      Create one now
                    </button>
                  </small>
                )}
              </div>
              
              <div className="form-group">
                <label>Cost Code *</label>
                <input
                  type="text"
                  value={newCostCode.code}
                  onChange={(e) => setNewCostCode({...newCostCode, code: e.target.value})}
                  required
                  placeholder="Enter cost code (e.g., CC001)"
                />
              </div>
              
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={newCostCode.description}
                  onChange={(e) => setNewCostCode({...newCostCode, description: e.target.value})}
                  rows="3"
                />
              </div>
              
              <div className="form-group">
                <label>Category</label>
                <select
                  value={newCostCode.category}
                  onChange={(e) => setNewCostCode({...newCostCode, category: e.target.value})}
                >
                  <option value="">Select Category</option>
                  <option value="labor">Labor</option>
                  <option value="materials">Materials</option>
                  <option value="equipment">Equipment</option>
                  <option value="overhead">Overhead</option>
                  <option value="other">Other</option>
                </select>
              </div>
              
              <div className="form-group">
                <label>Cost Per Hour ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={newCostCode.costPerHour}
                  onChange={(e) => setNewCostCode({...newCostCode, costPerHour: e.target.value})}
                  placeholder="0.00"
                />
              </div>
              
              <div className="modal-actions">
                <button 
                  type="submit" 
                  className="save-btn"
                  disabled={areasOfFocus.length === 0}
                >
                  {editingCostCode ? 'Update Cost Code' : 'Create Cost Code'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Submission Modal */}
      {showSubmissionModal && (
        <div className="modal-overlay" onClick={() => setShowSubmissionModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingSubmission ? 'Edit Submission' : 'Create New Submission'}</h3>
              <button 
                className="modal-close"
                onClick={() => {
                  setShowSubmissionModal(false);
                  setEditingSubmission(null);
                  setNewSubmission({
                    title: '',
                    description: '',
                    type: 'report',
                    relatedTaskId: '',
                    content: '',
                    status: 'draft',
                    dueDate: ''
                  });
                }}
              >
                ×
              </button>
            </div>
            
            <form onSubmit={saveSubmission} className="submission-form">
              <div className="form-group">
                <label>Submission Title</label>
                <input
                  type="text"
                  value={newSubmission.title}
                  onChange={(e) => setNewSubmission({...newSubmission, title: e.target.value})}
                  required
                />
              </div>
              
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={newSubmission.description}
                  onChange={(e) => setNewSubmission({...newSubmission, description: e.target.value})}
                  rows="2"
                  placeholder="Brief description of this submission..."
                />
              </div>
              
              <div className="form-row">
                <div className="form-group">
                  <label>Type</label>
                  <select
                    value={newSubmission.type}
                    onChange={(e) => setNewSubmission({...newSubmission, type: e.target.value})}
                  >
                    <option value="report">Report</option>
                    <option value="proposal">Proposal</option>
                    <option value="document">Document</option>
                    <option value="presentation">Presentation</option>
                    <option value="form">Form</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                
                <div className="form-group">
                  <label>Related Task (Optional)</label>
                  <select
                    value={newSubmission.relatedTaskId}
                    onChange={(e) => setNewSubmission({...newSubmission, relatedTaskId: e.target.value})}
                  >
                    <option value="">No related task</option>
                    {tasks.map(task => (
                      <option key={task.id} value={task.id}>{task.title}</option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div className="form-group">
                <label>Content</label>
                <textarea
                  value={newSubmission.content}
                  onChange={(e) => setNewSubmission({...newSubmission, content: e.target.value})}
                  rows="6"
                  placeholder="Enter the main content of your submission..."
                  required
                />
              </div>
              
              <div className="form-row">
                <div className="form-group">
                  <label>Status</label>
                  <select
                    value={newSubmission.status}
                    onChange={(e) => setNewSubmission({...newSubmission, status: e.target.value})}
                  >
                    <option value="draft">Draft</option>
                    <option value="pending">Pending Review</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                    <option value="submitted">Submitted</option>
                  </select>
                </div>
                
                <div className="form-group">
                  <label>Due Date (Optional)</label>
                  <input
                    type="date"
                    value={newSubmission.dueDate}
                    onChange={(e) => setNewSubmission({...newSubmission, dueDate: e.target.value})}
                  />
                </div>
              </div>
              
              <div className="modal-actions">
                <button type="submit" className="save-btn">
                  {editingSubmission ? 'Update Submission' : 'Create Submission'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Area of Focus Modal */}
      {showAreaOfFocusModal && (
        <div className="modal-overlay" onClick={() => setShowAreaOfFocusModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingAreaOfFocus ? 'Edit Area of Focus' : 'Create New Area of Focus'}</h3>
              <button
                className="modal-close"
                onClick={() => {
                  setShowAreaOfFocusModal(false);
                  setEditingAreaOfFocus(null);
                  setNewAreaOfFocus({
                    name: '',
                    description: '',
                    color: '#667eea'
                  });
                }}
              >
                ×
              </button>
            </div>

            <form onSubmit={saveAreaOfFocus} className="area-of-focus-form">
              <div className="form-group">
                <label>Name</label>
                <input
                  type="text"
                  value={newAreaOfFocus.name}
                  onChange={(e) => setNewAreaOfFocus({...newAreaOfFocus, name: e.target.value})}
                  required
                  placeholder="e.g., Ministry Development, Community Outreach"
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={newAreaOfFocus.description}
                  onChange={(e) => setNewAreaOfFocus({...newAreaOfFocus, description: e.target.value})}
                  rows="3"
                  placeholder="Describe what this area of focus encompasses..."
                />
              </div>

              <div className="form-group">
                <label>Color</label>
                <div className="color-picker">
                  <input
                    type="color"
                    value={newAreaOfFocus.color}
                    onChange={(e) => setNewAreaOfFocus({...newAreaOfFocus, color: e.target.value})}
                  />
                  <span>Choose a color to visually identify this area of focus</span>
                </div>
              </div>

              <div className="modal-actions">
                <button type="submit" className="save-btn">
                  {editingAreaOfFocus ? 'Update Area of Focus' : 'Create Area of Focus'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default TimeTracker;
