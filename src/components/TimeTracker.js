import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { FaChevronDown } from 'react-icons/fa';
import { db, auth } from '../firebase';
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
import { signOut } from 'firebase/auth';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase';
import { toast } from 'react-toastify';
import { canAccessModule } from '../utils/permissions';
import TaskProgress from './TaskProgress';
import TaskManager from './TaskManager';
import ChurchHeader from './ChurchHeader';
import commonStyles from '../pages/commonStyles';
import './TimeTracker.css';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

// History Tooltip Component
const HistoryTooltip = ({ history, users }) => {
  if (!history || history.length === 0) {
    return <div className="history-tooltip">No edit history available</div>;
  }

  const formatFieldName = (field) => {
    const fieldNames = {
      startTime: 'Start Time',
      endTime: 'End Time',
      duration: 'Duration',
      note: 'Note',
      date: 'Date',
      project: 'Project',
      areaOfFocus: 'Area of Focus',
      costCode: 'Cost Code',
      userId: 'User',
      taskId: 'Task'
    };
    return fieldNames[field] || field;
  };

  const formatHistoryValue = (field, value) => {
    if (value === 'None' || !value) return 'None';
    
    // Format time fields
    if ((field === 'startTime' || field === 'endTime') && value) {
      try {
        // If it's already a formatted time string, return as-is
        if (typeof value === 'string' && (value.includes('AM') || value.includes('PM'))) {
          return value;
        }
        // If it's an ISO string, format it
        return formatTimeDisplay(value);
      } catch (error) {
        return value;
      }
    }
    
    // Format duration
    if (field === 'duration' && value) {
      const duration = parseFloat(value);
      if (!isNaN(duration)) {
        return `${duration.toFixed(2)}h`;
      }
    }
    
    // Format task
    if (field === 'taskId' && value) {
      const task = tasks.find(t => t.id === value);
      return task ? task.title : 'Unknown Task';
    }
    
    return value;
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString();
  };

  const getUserName = (userId) => {
    const user = users.find(u => u.id === userId);
    return user ? (user.name && user.lastName ? `${user.name} ${user.lastName}` : user.name || user.email) : 'Unknown User';
  };

  return (
    <div className="history-tooltip">
      <div className="history-header">Edit History</div>
      <div className="history-list">
        {history.slice().reverse().map((change, index) => (
          <div key={index} className="history-item">
            <div className="history-field">{formatFieldName(change.field)}</div>
            <div className="history-change">
              <span className="history-old">{formatHistoryValue(change.field, change.oldValue)}</span>
              <span className="history-arrow">→</span>
              <span className="history-new">{formatHistoryValue(change.field, change.newValue)}</span>
            </div>
            <div className="history-meta">
              <span className="history-user">{getUserName(change.changedBy)}</span>
              <span className="history-date">{formatDate(change.changedAt)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Helper function to format time in seconds to HH:MM:SS or MM:SS - Moved to TimerPage
// const formatTime = (seconds) => {
//   if (!seconds || seconds === 0) return '00:00';
//   
//   const hours = Math.floor(seconds / 3600);
//   const minutes = Math.floor((seconds % 3600) / 60);
//   const secs = seconds % 60;
//   
//   if (hours > 0) {
//     return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
//   } else {
//     return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
//   }
// };

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

// Helper function to format time for display in table
const formatTimeDisplay = (dateValue) => {
  if (!dateValue) return '-';
  
  try {
    // Handle ISO date strings directly
    const date = new Date(dateValue);
    if (isNaN(date.getTime())) return '-';
    
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    const displayMinutes = minutes.toString().padStart(2, '0');
    return `${displayHours}:${displayMinutes} ${ampm}`;
  } catch (error) {
    console.error('Error formatting time display:', error);
    return '-';
  }
};

// Helper function to format duration in seconds to HH:MM or MM:SS
const formatDuration = (seconds) => {
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

// Helper function to format time input with masking
const formatTimeInput = (value) => {
  if (!value || value.trim() === '') return '';

  let cleaned = value.trim().toUpperCase();

  // If it already has AM/PM, ensure proper formatting with space
  if (cleaned.includes('AM') || cleaned.includes('PM')) {
    // Extract the time part and AM/PM part
    const ampmMatch = cleaned.match(/(AM|PM)$/i);
    if (ampmMatch) {
      const ampm = ampmMatch[0];
      const timePart = cleaned.replace(/(AM|PM)$/i, '').trim();
      return `${timePart} ${ampm}`;
    }
    return cleaned;
  }

  // Check if user typed AM/PM first (like "pm9" or "am 9")
  if (cleaned.startsWith('AM') || cleaned.startsWith('PM')) {
    const ampm = cleaned.slice(0, 2);
    const rest = cleaned.slice(2).trim();
    if (rest) {
      return `${rest} ${ampm}`;
    }
  }

  // Extract numbers only
  const numbersOnly = cleaned.replace(/[^0-9]/g, '');

  // Handle different number lengths (12-hour format only)
  if (numbersOnly.length === 1) {
    // Single digit - don't format yet, let user continue typing
    return cleaned;
  } else if (numbersOnly.length === 2) {
    // Two digits - could be hour or hour:minute
    const hour = parseInt(numbersOnly, 10);
    if (hour >= 1 && hour <= 12) {
      return `${hour} AM`;
    }
    // If not a valid hour, don't format
    return cleaned;
  } else if (numbersOnly.length === 3) {
    // Three digits: H:MM format
    const hour = parseInt(numbersOnly.slice(0, 1), 10);
    const minutes = numbersOnly.slice(1);
    if (hour >= 1 && hour <= 9 && minutes >= 0 && minutes <= 59) {
      return `${hour}:${minutes} AM`;
    }
  } else if (numbersOnly.length === 4) {
    // Four digits: HH:MM format - only accept 1-12 for hour
    const hour = parseInt(numbersOnly.slice(0, 2), 10);
    const minutes = numbersOnly.slice(2);
    if (hour >= 1 && hour <= 12 && minutes >= 0 && minutes <= 59) {
      return `${hour}:${minutes} AM`;
    }
    // If hour is outside 1-12 range, don't format
    return cleaned;
  }

  // If we can't format it, return the original cleaned value
  return cleaned;
};

// Helper function to create change history for time entries
const createChangeHistory = (originalEntry, updatedData, changedBy) => {
  const changes = [];
  const now = new Date().toISOString();

  // Fields to track changes for
  const trackableFields = [
    'startTime', 'endTime', 'duration', 'note', 'date', 
    'project', 'areaOfFocus', 'costCode', 'userId', 'taskId'
  ];

  trackableFields.forEach(field => {
    const originalValue = originalEntry[field];
    const newValue = updatedData[field];

    // Handle time fields specially - convert to display format for comparison
    let displayOriginal = originalValue;
    let displayNew = newValue;

    if ((field === 'startTime' || field === 'endTime') && originalValue && newValue) {
      try {
        // Convert ISO strings to display format for comparison
        displayOriginal = formatTimeDisplay(originalValue);
        displayNew = formatTimeDisplay(newValue);
      } catch (error) {
        // If formatting fails, use raw values
        displayOriginal = originalValue;
        displayNew = newValue;
      }
    }

    // Check if values are different
    if (displayOriginal !== displayNew) {
      changes.push({
        field,
        oldValue: displayOriginal || 'None',
        newValue: displayNew || 'None',
        changedBy,
        changedAt: now
      });
    }
  });

  return changes;
};

// Helper function to export time entries to PDF
const exportTimeEntriesToPDF = (entries, users, projects, areasOfFocus, costCodes, filters = {}) => {
  const doc = new jsPDF();
  
  // Add title
  doc.setFontSize(20);
  doc.text('Time Entries Report', 14, 22);
  
  // Add date range if filters are applied
  let yPosition = 35;
  if (filters.dateFrom || filters.dateTo) {
    doc.setFontSize(12);
    let dateRangeText = 'Date Range: ';
    if (filters.dateFrom && filters.dateTo) {
      dateRangeText += `${filters.dateFrom} to ${filters.dateTo}`;
    } else if (filters.dateFrom) {
      dateRangeText += `From ${filters.dateFrom}`;
    } else if (filters.dateTo) {
      dateRangeText += `To ${filters.dateTo}`;
    }
    doc.text(dateRangeText, 14, yPosition);
    yPosition += 10;
  }
  
  // Add generation date
  doc.setFontSize(10);
  doc.text(`Generated on: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`, 14, yPosition);
  yPosition += 15;
  
  // Prepare table data
  const tableData = entries.map(entry => {
    const user = users.find(u => u.id === entry.userId);
    const userName = user ? (user.name && user.lastName ? `${user.name} ${user.lastName}` : user.name || user.email) : 'Unknown User';
    
    return [
      new Date(entry.date).toLocaleDateString(),
      userName,
      formatTimeDisplay(entry.startTime),
      formatTimeDisplay(entry.endTime),
      entry.duration ? (entry.duration / 3600).toFixed(2) + 'h' : '-',
      projects.find(p => p.id === entry.project)?.name || 'Unknown Project',
      areasOfFocus.find(a => a.id === entry.areaOfFocus)?.name || 'Unknown Area',
      costCodes.find(c => c.code === entry.costCode)?.code || 'Unknown Code',
      entry.taskId ? tasks.find(t => t.id === entry.taskId)?.title || 'Unknown Task' : '-',
      entry.note || '-'
    ];
  });
  
  // Add table
  doc.autoTable({
    head: [['Date', 'User', 'Start Time', 'End Time', 'Duration', 'Project', 'Area of Focus', 'Cost Code', 'Task', 'Notes']],
    body: tableData,
    startY: yPosition,
    styles: {
      fontSize: 8,
      cellPadding: 3,
    },
    headStyles: {
      fillColor: [102, 126, 234], // Blue header
      textColor: 255,
      fontSize: 9,
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [245, 245, 245], // Light gray alternating rows
    },
    columnStyles: {
      0: { cellWidth: 20 }, // Date
      1: { cellWidth: 25 }, // User
      2: { cellWidth: 20 }, // Start Time
      3: { cellWidth: 20 }, // End Time
      4: { cellWidth: 15 }, // Duration
      5: { cellWidth: 25 }, // Project
      6: { cellWidth: 25 }, // Area of Focus
      7: { cellWidth: 20 }, // Cost Code
      8: { cellWidth: 25 }, // Task
      9: { cellWidth: 'auto' }, // Notes
    },
    margin: { top: 10 },
  });
  
  // Add summary statistics at the bottom
  const finalY = doc.lastAutoTable.finalY + 20;
  doc.setFontSize(12);
  doc.text('Summary Statistics:', 14, finalY);
  
  const totalEntries = entries.length;
  const totalHours = entries.reduce((sum, entry) => sum + (entry.duration || 0), 0) / 3600;
  const avgHoursPerEntry = totalEntries > 0 ? totalHours / totalEntries : 0;
  
  doc.setFontSize(10);
  doc.text(`Total Entries: ${totalEntries}`, 14, finalY + 10);
  doc.text(`Total Hours: ${totalHours.toFixed(2)}h`, 14, finalY + 18);
  doc.text(`Average Hours per Entry: ${avgHoursPerEntry.toFixed(2)}h`, 14, finalY + 26);
  
  // Save the PDF
  const fileName = `time-entries-${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(fileName);
  
  return fileName;
};

// Helper function to format time input with context awareness (considers start time for AM/PM)
const formatTimeInputWithContext = (value, startTime = null) => {
  if (!value || value.trim() === '') return '';

  let cleaned = value.trim();

  // If it already contains AM/PM (even partially), don't mess with it
  // This allows editing of already formatted times and typing AM/PM
  if (/(AM|PM)/i.test(cleaned)) {
    // Ensure proper spacing between time and AM/PM
    if (!/\s+(AM|PM)$/i.test(cleaned)) {
      // If AM/PM exists but not properly spaced, fix the spacing
      const ampmMatch = cleaned.match(/(AM|PM)$/i);
      if (ampmMatch) {
        const ampm = ampmMatch[0];
        const timePart = cleaned.replace(/(AM|PM)$/i, '').trim();
        return `${timePart} ${ampm}`;
      }
    }
    return cleaned;
  }

  // Convert to uppercase for processing
  cleaned = cleaned.toUpperCase();

  // Check if user typed AM/PM first (like "pm9" or "am 9")
  if (cleaned.startsWith('AM') || cleaned.startsWith('PM')) {
    const ampm = cleaned.slice(0, 2);
    const rest = cleaned.slice(2).trim();
    if (rest) {
      return `${rest} ${ampm}`;
    }
  }

  // If it contains a colon, it's already formatted - don't mess with it
  // This allows editing of times like "2:30" without reformatting
  if (cleaned.includes(':')) {
    return cleaned;
  }

  // Extract numbers only
  const numbersOnly = cleaned.replace(/[^0-9]/g, '');

  // Determine default AM/PM based on start time and input time
  let defaultAMPM = 'AM';
  if (startTime && numbersOnly.length >= 2) {
    try {
      const startTime24h = convertTo24Hour(startTime);
      const startHour = new Date(`2000-01-01T${startTime24h}`).getHours();

      // Parse the input hour
      let inputHour;
      if (numbersOnly.length === 2) {
        inputHour = parseInt(numbersOnly, 10);
      } else if (numbersOnly.length === 3) {
        inputHour = parseInt(numbersOnly.slice(0, 1), 10);
      } else if (numbersOnly.length === 4) {
        inputHour = parseInt(numbersOnly.slice(0, 2), 10);
      }

      if (inputHour && inputHour >= 1 && inputHour <= 12) {
        // Smart AM/PM defaulting for end times:
        // If start time is AM, default end time to PM (most work sessions go into afternoon)
        // If start time is PM, keep PM
        // But if input hour is close to start hour, could be same AM period
        const startHour12 = startHour === 0 ? 12 : (startHour > 12 ? startHour - 12 : startHour);

        if (startHour >= 12) {
          // Start is PM, end should be PM
          defaultAMPM = 'PM';
        } else {
          // Start is AM - default to PM for end times (work goes into afternoon)
          // But if input hour is just 1-2 hours ahead, could be same AM period
          if (inputHour >= startHour12 && inputHour <= startHour12 + 2) {
            defaultAMPM = 'AM'; // Same morning
          } else {
            defaultAMPM = 'PM'; // Afternoon/evening
          }
        }
      }
    } catch (error) {
      // Fall back to AM
    }
  } else if (startTime) {
    // Fallback to PM if we can't parse input hour (most end times are PM)
    try {
      const startTime24h = convertTo24Hour(startTime);
      const startHour = new Date(`2000-01-01T${startTime24h}`).getHours();
      defaultAMPM = 'PM'; // Default to PM for end times
    } catch (error) {
      // Fall back to AM
    }
  }

  // Handle different number lengths (12-hour format only)
  if (numbersOnly.length === 1) {
    // Single digit - don't format yet, let user continue typing
    return numbersOnly;
  } else if (numbersOnly.length === 2) {
    // Two digits - could be hour or hour:minute, don't add AM/PM yet
    const hour = parseInt(numbersOnly, 10);
    if (hour >= 1 && hour <= 12) {
      // Don't add AM/PM yet - let user continue typing minutes
      return numbersOnly;
    }
    // If not a valid hour, don't format
    return numbersOnly;
  } else if (numbersOnly.length === 3) {
    // Three digits: H:MM format
    const hour = parseInt(numbersOnly.slice(0, 1), 10);
    const minutes = numbersOnly.slice(1);
    if (hour >= 1 && hour <= 9 && minutes >= 0 && minutes <= 59) {
      return `${hour}:${minutes} ${defaultAMPM}`;
    }
  } else if (numbersOnly.length === 4) {
    // Four digits: HH:MM format - only accept 1-12 for hour
    const hour = parseInt(numbersOnly.slice(0, 2), 10);
    const minutes = numbersOnly.slice(2);
    if (hour >= 1 && hour <= 12 && minutes >= 0 && minutes <= 59) {
      return `${hour}:${minutes} ${defaultAMPM}`;
    }
    // If hour is outside 1-12 range, don't format
    return numbersOnly;
  }

  // If we can't format it, return the original cleaned value
  return cleaned;
};

// Helper function to validate time input (more permissive)
const isValidTimeInput = (value) => {
  if (!value || value.trim() === '') return true; // Empty is always valid

  const trimmed = value.trim();

  // Allow just "am", "pm", "a", "p" (user might be typing AM/PM first)
  if (/^(am?|pm?)$/i.test(trimmed)) {
    return true;
  }

  // Allow AM/PM followed by numbers (like "pm9", "am 9")
  if (/^(am?|pm?)\s*\d{1,4}$/i.test(trimmed)) {
    return true;
  }

  // Allow any single digit (1-9) - user might be typing "7:30 AM"
  if (/^\d{1}$/.test(trimmed)) {
    return true; // Allow any single digit
  }

  // Allow two digits - only 1-12 for 12-hour format
  if (/^\d{2}$/.test(trimmed)) {
    const hour = parseInt(trimmed, 10);
    return hour >= 1 && hour <= 12;
  }

  // Allow three digits
  if (/^\d{3}$/.test(trimmed)) {
    return true; // Allow any 3 digits
  }

  // Allow four digits - only if hour part is 1-12
  if (/^\d{4}$/.test(trimmed)) {
    const hour = parseInt(trimmed.slice(0, 2), 10);
    return hour >= 1 && hour <= 12;
  }

  // Allow 12-hour format times (HH:MM) - only 1-12 for hour
  if (/^\d{1,2}:\d{1,2}$/.test(trimmed)) {
    const parts = trimmed.split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    return hours >= 1 && hours <= 12 && minutes >= 0 && minutes <= 59;
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

// Helper function to calculate end time from start time and duration in hours
const calculateEndTime = (startTime, hours) => {
  if (!startTime || !hours || hours <= 0) return '';
  
  try {
    // Convert start time to 24-hour format for calculation
    const startTime24h = convertTo24Hour(startTime);
    const startDateTime = new Date(`2000-01-01T${startTime24h}`);
    
    // Add the duration in hours
    startDateTime.setHours(startDateTime.getHours() + hours);
    
    // Convert back to 12-hour format for display
    const endHours = startDateTime.getHours();
    const endMinutes = startDateTime.getMinutes();
    const ampm = endHours >= 12 ? 'PM' : 'AM';
    const displayHours = endHours % 12 || 12;
    const displayMinutes = endMinutes.toString().padStart(2, '0');
    
    return `${displayHours}:${displayMinutes} ${ampm}`;
  } catch (error) {
    console.error('Error calculating end time:', error);
    return '';
  }
};

// Helper function to convert 12-hour time format to 24-hour format
const convertTo24Hour = (time12h) => {
  if (!time12h) return '00:00';
  
  const trimmed = time12h.trim();
  const isPM = trimmed.toUpperCase().includes('PM');
  const isAM = trimmed.toUpperCase().includes('AM');
  
  // Remove AM/PM
  let timePart = trimmed.replace(/\s*(AM|PM|am|pm)\s*$/, '');
  
  // Handle HH:MM format
  let hours, minutes;
  if (timePart.includes(':')) {
    const parts = timePart.split(':');
    hours = parseInt(parts[0], 10);
    minutes = parseInt(parts[1], 10) || 0;
  } else {
    // Handle single number (assume hours)
    hours = parseInt(timePart, 10);
    minutes = 0;
  }
  
  // Convert to 24-hour format
  if (isPM && hours !== 12) {
    hours += 12;
  } else if (isAM && hours === 12) {
    hours = 0;
  }
  
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const TimeTracker = () => {
  const { id: churchId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  
  // Organization switcher state
  const [availableOrganizations, setAvailableOrganizations] = useState([]);
  const [currentOrganization, setCurrentOrganization] = useState(null);
  const [organizationSearchQuery, setOrganizationSearchQuery] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  
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
  
  // Time Tracking State - Moved to TimerPage
  // const [isTracking, setIsTracking] = useState(false);
  // const [currentSession, setCurrentSession] = useState(null);
  // const [currentProject, setCurrentProject] = useState('');
  // const [currentAreaOfFocus, setCurrentAreaOfFocus] = useState('');
  // const [currentCostCode, setCurrentCostCode] = useState('');
  const [timeEntries, setTimeEntries] = useState([]);
  // const [elapsedTime, setElapsedTime] = useState(0);
  
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
      durationMode: 'start', // 'start' = start + duration, 'end' = end + duration
      userId: user?.uid || '', // Default to current user
      taskId: '' // Add task association
    };
  });
  
  const [editRowData, setEditRowData] = useState({
    note: '',
    startTime: '',
    endTime: '',
    date: '',
    project: '',
    areaOfFocus: '',
    costCode: '',
    duration: '',
    userId: '',
    taskId: '' // Add task association
  });

  // Validation state for time inputs
  const [timeValidationErrors, setTimeValidationErrors] = useState({
    newStartTime: '',
    newEndTime: '',
    editStartTime: '',
    editEndTime: ''
  });
  
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    priority: 'medium',
    dueDate: '',
    status: 'started',
    forecastedHours: 0
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
  const [projectContracts, setProjectContracts] = useState([]);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [newProject, setNewProject] = useState({
    name: '',
    description: '',
    costCodeAssignments: [],
    assignedUsers: []
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
    areaOfFocusIds: [] // Changed to array for multiple areas
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

  // Expenses State
  const [expenses, setExpenses] = useState([]);
  const [expenseCategories, setExpenseCategories] = useState([]);
  const [expenseSubcategories, setExpenseSubcategories] = useState([]);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [expenseSearchTerm, setExpenseSearchTerm] = useState('');
  const [newExpense, setNewExpense] = useState({
    title: '',
    description: '',
    amount: '',
    date: new Date().toISOString().split('T')[0],
    categoryId: '',
    subcategoryId: '',
    costCodeId: '',
    projectId: '',
    vendor: '',
    receipt: null
  });
  const [showExpenseCategoryModal, setShowExpenseCategoryModal] = useState(false);
  const [editingExpenseCategory, setEditingExpenseCategory] = useState(null);
  const [newExpenseCategory, setNewExpenseCategory] = useState({
    name: '',
    description: '',
    color: '#667eea'
  });

  // Contracts State
  const [contracts, setContracts] = useState([]);
  const [showContractModal, setShowContractModal] = useState(false);
  const [editingContract, setEditingContract] = useState(null);
  const [showCommentsModal, setShowCommentsModal] = useState(false);
  const [selectedContractForComments, setSelectedContractForComments] = useState(null);
  const [newComment, setNewComment] = useState('');
  const [editingComment, setEditingComment] = useState(null);
  const [newContract, setNewContract] = useState({
    name: '',
    description: '',
    clientName: '',
    contractNumber: '',
    status: 'estimating', // estimating, awarded, in-progress
    totalAmount: '',
    startDate: '',
    endDate: '',
    projectId: '',
    notes: '',
    featured: false, // New featured checkbox field
    brand: '', // New brand field
    statusChangeLog: [], // Array to track status changes
    comments: [] // Array to store comments
  });

  // Brands State
  const [brands, setBrands] = useState([]);
  const [showBrandModal, setShowBrandModal] = useState(false);
  const [editingBrand, setEditingBrand] = useState(null);
  const [newBrand, setNewBrand] = useState({
    name: '',
    description: '',
    imageUrl: '',
    imageFile: null
  });
  const [brandImagePreview, setBrandImagePreview] = useState(null);

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

  // Inline editing state for time entries
  const [editingRowId, setEditingRowId] = useState(null);

  // Cost Code Assignment Editing State
  const [editingCostCodeAssignment, setEditingCostCodeAssignment] = useState(null);
  const [editCostCodeAssignmentData, setEditCostCodeAssignmentData] = useState({
    costCodeId: '',
    hours: ''
  });

  // Cost Code Assignment Form State
  const [assigningCostCode, setAssigningCostCode] = useState(null);
  const [assignmentHours, setAssignmentHours] = useState('');

  // Time Entries Table State
  const [searchTerm, setSearchTerm] = useState('');
  const [filterProject, setFilterProject] = useState('');
  const [filterAreaOfFocus, setFilterAreaOfFocus] = useState('');
  const [filterCostCode, setFilterCostCode] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [sortField, setSortField] = useState('startTime');
  const [sortDirection, setSortDirection] = useState('desc');

  // Users State
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [entriesPerPage] = useState(20);

  // Helper function to validate time input and provide feedback
  const validateTimeInput = (timeValue, fieldName) => {
    if (!timeValue || timeValue.trim() === '') {
      return ''; // Empty is valid
    }

    try {
      convertTo24Hour(timeValue);
      return ''; // Valid
    } catch (error) {
      return error.message;
    }
  };

  // Helper function to update validation errors
  const updateTimeValidation = (field, error) => {
    setTimeValidationErrors(prev => ({
      ...prev,
      [field]: error
    }));
  };

  // Helper function to convert 12-hour time format to 24-hour format
  const convertTo24Hour = (time12h) => {

    // Match pattern like "9:00 AM", "9:00AM", "2:30 PM", "2:30PM", "9 AM", "9AM", etc.
    const match = time12h.match(/^(\d{1,2})(?::(\d{1,2}))?\s*(AM|PM)$/);
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

  // Fetch available organizations for the user
  const fetchAvailableOrganizations = async () => {
    try {
      if (user?.role === 'global_admin' || user?.role === 'admin') {
        // Global admins and admins can access all organizations
        const churchesRef = collection(db, 'churches');
        const churchesSnapshot = await getDocs(churchesRef);
        const organizations = churchesSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setAvailableOrganizations(organizations);
        
        // Find current organization
        const currentOrg = organizations.find(org => org.id === churchId);
        setCurrentOrganization(currentOrg);
      } else {
        // Regular users can only access their organization
        const churchesRef = collection(db, 'churches');
        const churchDoc = await getDoc(doc(churchesRef, churchId));
        if (churchDoc.exists()) {
          const organization = { id: churchDoc.id, ...churchDoc.data() };
          setAvailableOrganizations([organization]);
          setCurrentOrganization(organization);
        }
      }
    } catch (error) {
      console.error('Error fetching organizations:', error);
    }
  };

  // Handle organization switch
  const handleOrganizationSwitch = (organizationId) => {
    const currentPath = location.pathname;
    const newPath = currentPath.replace(`/organization/${churchId}`, `/organization/${organizationId}`);
    navigate(newPath);
  };

  // Handle logout
  const handleLogout = async () => {
    try {
      const returnUrl = `${location.pathname}${location.search}${location.hash}`;
      await signOut(auth);
      navigate(`/church/${churchId}/login?returnUrl=${encodeURIComponent(returnUrl)}`);
    } catch (error) {
      console.error('Error logging out:', error);
      toast.error('Failed to logout');
    }
  };

  // Fetch available organizations when user changes
  useEffect(() => {
    if (user) {
      fetchAvailableOrganizations();
    }
  }, [user, churchId]);

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

  // Timer interval - Moved to TimerPage
  // useEffect(() => {
  //   let interval;
  //   if (isTracking && currentSession) {
  //     interval = setInterval(() => {
  //       const now = new Date();
  //       const start = new Date(currentSession.startTime);
  //       setElapsedTime(Math.floor((now - start) / 1000));
  //     }, 1000);
  //   }
  //   return () => {
  //     if (interval) {
  //       clearInterval(interval);
  //     }
  //   };
  // }, [isTracking, currentSession]);

  // Component cleanup effect
  useEffect(() => {
    return () => {
      // Clear any pending tab switch timeouts
      if (tabSwitchTimeout) {
        clearTimeout(tabSwitchTimeout);
      }
    };
  }, [tabSwitchTimeout]);

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

  // Load Expenses
  useEffect(() => {
    if (!churchId || !user) return;

    // Only load expenses for users with finance access
    const checkAndLoadExpenses = async () => {
      const hasFinanceAccess = await canAccessModule(user, churchId, 'finances');
      if (!hasFinanceAccess) {
        return;
      }

      const unsubscribe = onSnapshot(
        collection(db, `churches/${churchId}/expenses`),
        (snapshot) => {
          const expensesData = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
          setExpenses(expensesData);
        },
        (error) => {
          console.error('Error loading expenses:', error);
          toast.error('Failed to load expenses');
        }
      );

      return unsubscribe;
    };

    let unsubscribe;
    checkAndLoadExpenses().then(unsub => {
      unsubscribe = unsub;
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [churchId, user]);

  // Load Expense Categories
  useEffect(() => {
    if (!churchId || !user) return;

    // Only load expense categories for users with finance access
    const checkAndLoadCategories = async () => {
      const hasFinanceAccess = await canAccessModule(user, churchId, 'finances');
      if (!hasFinanceAccess) {
        return;
      }

      const unsubscribe = onSnapshot(
        collection(db, `churches/${churchId}/expenseCategories`),
        (snapshot) => {
          const categoriesData = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
          setExpenseCategories(categoriesData);
        },
        (error) => {
          console.error('Error loading expense categories:', error);
          toast.error('Failed to load expense categories');
        }
      );

      return unsubscribe;
    };

    let unsubscribe;
    checkAndLoadCategories().then(unsub => {
      unsubscribe = unsub;
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [churchId, user]);

  // Load Expense Subcategories
  useEffect(() => {
    if (!churchId || !user) return;

    // Only load expense subcategories for users with finance access
    const checkAndLoadSubcategories = async () => {
      const hasFinanceAccess = await canAccessModule(user, churchId, 'finances');
      if (!hasFinanceAccess) {
        return;
      }

      const unsubscribe = onSnapshot(
        collection(db, `churches/${churchId}/expenseSubcategories`),
        (snapshot) => {
          const subcategoriesData = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
          setExpenseSubcategories(subcategoriesData);
        },
        (error) => {
          console.error('Error loading expense subcategories:', error);
          toast.error('Failed to load expense subcategories');
        }
      );

      return unsubscribe;
    };

    let unsubscribe;
    checkAndLoadSubcategories().then(unsub => {
      unsubscribe = unsub;
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [churchId, user]);

  // Load Contracts
  useEffect(() => {
    if (!churchId || !user) return;

    // Only load contracts for users with finance access
    const checkAndLoadContracts = async () => {
      const hasFinanceAccess = await canAccessModule(user, churchId, 'finances');
      if (!hasFinanceAccess) {
        return;
      }

      const unsubscribe = onSnapshot(
        collection(db, `churches/${churchId}/contracts`),
        (snapshot) => {
          const contractsData = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
          setContracts(contractsData);
        },
        (error) => {
          console.error('Error loading contracts:', error);
          toast.error('Failed to load contracts');
        }
      );

      return unsubscribe;
    };

    let unsubscribe;
    checkAndLoadContracts().then(unsub => {
      unsubscribe = unsub;
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [churchId, user]);

  // Load Brands
  useEffect(() => {
    if (!churchId || !user) return;

    // Only load brands for users with finance access
    const checkAndLoadBrands = async () => {
      const hasFinanceAccess = await canAccessModule(user, churchId, 'finances');
      if (!hasFinanceAccess) {
        return;
      }

      const unsubscribe = onSnapshot(
        collection(db, `churches/${churchId}/brands`),
        (snapshot) => {
          const brandsData = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
          setBrands(brandsData);
        },
        (error) => {
          console.error('Error loading brands:', error);
          toast.error('Failed to load brands');
        }
      );

      return unsubscribe;
    };

    let unsubscribe;
    checkAndLoadBrands().then(unsub => {
      unsubscribe = unsub;
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [churchId, user]);

  // Fetch users for the church
  useEffect(() => {
    if (!churchId) return;

    const fetchUsers = async () => {
      try {
        setLoadingUsers(true);
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('churchId', '==', churchId));
        const querySnapshot = await getDocs(q);
        
        const fetchedUsers = querySnapshot.docs.map(doc => ({
          id: doc.id,
          name: doc.data().name || doc.data().email || 'Unnamed User',
          firstName: doc.data().firstName || '',
          lastName: doc.data().lastName || '',
          email: doc.data().email || '',
          ...doc.data()
        }));
        
        console.log(`Found ${fetchedUsers.length} users for church ${churchId}`);
        setUsers(fetchedUsers);
      } catch (error) {
        console.error('Error fetching users:', error);
      } finally {
        setLoadingUsers(false);
      }
    };

    fetchUsers();
  }, [churchId]);

  // Time Entries Table Functions
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Get available projects for current user (assigned projects for members, all for admins)
  const getAvailableProjects = () => {
    if (user.role === 'global_admin' || user.role === 'admin') {
      return projects;
    }
    return projects.filter(project => 
      project.assignedUsers && project.assignedUsers.includes(user.uid)
    );
  };

  // Helper function to track changes for history
  const createChangeHistory = (oldEntry, newData, changedBy) => {
    const changes = [];
    const changeTime = new Date().toISOString();

    // Compare each field
    Object.keys(newData).forEach(field => {
      if (field === 'history') return; // Skip history field itself
      
      const oldValue = oldEntry[field];
      const newValue = newData[field];
      
      // Handle different field types
      let oldDisplay = oldValue;
      let newDisplay = newValue;
      
      if (field === 'startTime' || field === 'endTime') {
        oldDisplay = oldValue ? formatTimeDisplay(oldValue) : 'None';
        newDisplay = newValue ? formatTimeDisplay(newValue) : 'None';
      } else if (field === 'duration') {
        oldDisplay = oldValue ? `${(oldValue / 3600).toFixed(2)}h` : 'None';
        newDisplay = newValue ? `${(newValue / 3600).toFixed(2)}h` : 'None';
      } else if (field === 'project') {
        const oldProject = projects.find(p => p.id === oldValue);
        const newProject = projects.find(p => p.id === newValue);
        oldDisplay = oldProject ? oldProject.name : 'None';
        newDisplay = newProject ? newProject.name : 'None';
      } else if (field === 'areaOfFocus') {
        const oldArea = areasOfFocus.find(a => a.id === oldValue);
        const newArea = areasOfFocus.find(a => a.id === newValue);
        oldDisplay = oldArea ? oldArea.name : 'None';
        newDisplay = newArea ? newArea.name : 'None';
      } else if (field === 'costCode') {
        const oldCostCode = costCodes.find(c => c.code === oldValue);
        const newCostCode = costCodes.find(c => c.code === newValue);
        oldDisplay = oldCostCode ? oldCostCode.description : 'None';
        newDisplay = newCostCode ? newCostCode.description : 'None';
      } else if (field === 'userId') {
        const oldUser = users.find(u => u.id === oldValue);
        const newUser = users.find(u => u.id === newValue);
        oldDisplay = oldUser ? (oldUser.name && oldUser.lastName ? `${oldUser.name} ${oldUser.lastName}` : oldUser.name || oldUser.email) : 'None';
        newDisplay = newUser ? (newUser.name && newUser.lastName ? `${newUser.name} ${newUser.lastName}` : newUser.name || newUser.email) : 'None';
      }

      if (oldValue !== newValue) {
        changes.push({
          field,
          oldValue: oldDisplay,
          newValue: newDisplay,
          changedBy,
          changedAt: changeTime
        });
      }
    });

    return changes;
  };

  const filteredAndSortedEntries = () => {
    let filtered = timeEntries.filter(entry => {
      // Search filter
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        const projectName = projects.find(p => p.id === entry.project)?.name || '';
        const areaName = areasOfFocus.find(a => a.id === entry.areaOfFocus)?.name || '';
        const costCodeName = costCodes.find(c => c.code === entry.costCode)?.description || '';
        const user = users.find(u => u.id === entry.userId);
        const userName = user ? (user.name && user.lastName ? `${user.name} ${user.lastName}` : user.name || user.email) : '';
        
        if (!projectName.toLowerCase().includes(searchLower) &&
            !areaName.toLowerCase().includes(searchLower) &&
            !costCodeName.toLowerCase().includes(searchLower) &&
            !userName.toLowerCase().includes(searchLower) &&
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
        case 'userId':
          const aUser = users.find(u => u.id === a.userId);
          const bUser = users.find(u => u.id === b.userId);
          aValue = aUser ? (aUser.name && aUser.lastName ? `${aUser.name} ${aUser.lastName}` : aUser.name || aUser.email) : '';
          bValue = bUser ? (bUser.name && bUser.lastName ? `${bUser.name} ${bUser.lastName}` : bUser.name || bUser.email) : '';
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

  // Start time tracking - Moved to TimerPage
  // const startTracking = async () => {
  //   if (!currentProject || !currentAreaOfFocus || !currentCostCode) {
  //     toast.error('Please select a project, area of focus, and cost code before starting the timer');
  //     return;
  //   }

  //   try {
  //     const startTime = new Date();
  //     const session = {
  //       userId: user.uid,
  //       churchId,
  //       startTime: startTime.toISOString(),
  //       date: startTime.toISOString().split('T')[0],
  //       note: '',
  //       project: currentProject,
  //       areaOfFocus: currentAreaOfFocus,
  //       costCode: currentCostCode
  //     };

  //     console.log('Starting tracking with session data:', session);
  //     const docRef = await addDoc(collection(db, `churches/${churchId}/timeEntries`), session);
  //     console.log('Time tracking session saved with ID:', docRef.id);
  //     setCurrentSession({ ...session, id: docRef.id });
  //     setIsTracking(true);
  //     setElapsedTime(0);
  //     toast.success('Time tracking started!');
  //   } catch (error) {
  //     console.error('Error starting time tracking:', error);
  //     console.error('Error details:', error.code, error.message);
  //     toast.error('Failed to start time tracking: ' + error.message);
  //   }
  // };

  // Stop time tracking - Moved to TimerPage
  // const stopTracking = async () => {
  //   if (!currentSession) return;

  //   try {
  //     const endTime = new Date();
  //     const duration = Math.floor((endTime - new Date(currentSession.startTime)) / 1000);

  //     await updateDoc(doc(db, `churches/${churchId}/timeEntries`, currentSession.id), {
  //       endTime: endTime.toISOString(),
  //       duration,
  //       updatedAt: serverTimestamp()
  //     });

  //     setIsTracking(false);
  //     setCurrentSession(null);
  //     setElapsedTime(0);
  //     setCurrentProject('');
  //     setCurrentAreaOfFocus('');
  //     setCurrentCostCode('');
  //     toast.success('Time tracking stopped!');
  //   } catch (error) {
  //     console.error('Error stopping time tracking:', error);
  //     toast.error('Failed to stop time tracking');
  //   }
  // };

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
      durationMode: 'start',
      userId: user?.uid || '' // Preselect current user
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
    if (!newRowData.startTime) {
      toast.error('Please enter a start time');
      return;
    }

    if (!newRowData.project || !newRowData.areaOfFocus || !newRowData.costCode || !newRowData.userId) {
      toast.error('Please select a user, project, area of focus, and cost code');
      return;
    }

    // Check if the selected user is assigned to the selected project (admins can assign anyone)
    if (user.role !== 'global_admin' && user.role !== 'admin') {
      const selectedProject = projects.find(p => p.id === newRowData.project);
      if (selectedProject && selectedProject.assignedUsers && !selectedProject.assignedUsers.includes(newRowData.userId)) {
        toast.error('You can only add time entries for users assigned to this project');
        return;
      }
    }

    // Require either end time OR duration
    if (!newRowData.endTime && (!newRowData.duration || newRowData.duration <= 0)) {
      toast.error('Please enter either an end time or duration');
      return;
    }

    try {
      // Convert 12-hour format to 24-hour format
      let startTime24h, endTime24h;
      try {
        startTime24h = convertTo24Hour(newRowData.startTime);
        endTime24h = newRowData.endTime ? convertTo24Hour(newRowData.endTime) : null;
      } catch (timeError) {
        toast.error(timeError.message);
        return;
      }

      const startDateTime = new Date(`${newRowData.date}T${startTime24h}`);
      
      let endDateTime = null;
      let duration = null;

      // If duration is provided, calculate end time from start time + duration
      if (newRowData.duration && newRowData.duration > 0) {
        duration = newRowData.duration * 3600; // Convert hours to seconds
        endDateTime = new Date(startDateTime.getTime() + duration * 1000);
      } else if (endTime24h) {
        // If no duration provided but end time is provided, calculate duration from start and end times
        endDateTime = new Date(`${newRowData.date}T${endTime24h}`);
        if (endDateTime <= startDateTime) {
          endDateTime = new Date(`${newRowData.date}T${endTime24h}`);
          endDateTime.setDate(endDateTime.getDate() + 1);
        }
        duration = Math.floor((endDateTime - startDateTime) / 1000);
      }

      if (duration <= 0) {
        toast.error('End time must be after start time');
        return;
      }

      const entryData = {
        startTime: startDateTime.toISOString(),
        endTime: endDateTime ? endDateTime.toISOString() : null,
        duration: duration,
        note: newRowData.note,
        date: newRowData.date,
        project: newRowData.project,
        areaOfFocus: newRowData.areaOfFocus,
        costCode: newRowData.costCode,
        userId: newRowData.userId || user.uid, // Use selected user or default to current user
        taskId: newRowData.taskId || null, // Add task association
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
    
    setEditRowData({
      note: entry.note || '',
      startTime: formatTimeDisplay(entry.startTime) !== '-' ? formatTimeDisplay(entry.startTime) : '',
      endTime: formatTimeDisplay(entry.endTime) !== '-' ? formatTimeDisplay(entry.endTime) : '',
      date: entry.date,
      project: entry.project || '',
      areaOfFocus: entry.areaOfFocus || '',
      costCode: entry.costCode || '',
      duration: entry.duration ? (entry.duration / 3600).toFixed(2) : '',
      userId: entry.userId || '',
      taskId: entry.taskId || '' // Add task association
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

    if (!editRowData.project || !editRowData.areaOfFocus || !editRowData.costCode || !editRowData.userId) {
      toast.error('Please select a user, project, area of focus, and cost code');
      return;
    }

    // Check if the selected user is assigned to the selected project (admins can assign anyone)
    if (user.role !== 'global_admin' && user.role !== 'admin') {
      const selectedProject = projects.find(p => p.id === editRowData.project);
      if (selectedProject && selectedProject.assignedUsers && !selectedProject.assignedUsers.includes(editRowData.userId)) {
        toast.error('You can only add time entries for users assigned to this project');
        return;
      }
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
      let duration = null;

      // If duration is provided, calculate end time from start time + duration
      if (editRowData.duration && editRowData.duration > 0) {
        duration = editRowData.duration * 3600; // Convert hours to seconds
        endDateTime = new Date(startDateTime.getTime() + duration * 1000);
      } else if (endTime24h) {
        // If no duration provided but end time is provided, calculate duration from start and end times
        endDateTime = new Date(`${editRowData.date}T${endTime24h}`);
        if (endDateTime <= startDateTime) {
          endDateTime = new Date(`${editRowData.date}T${endTime24h}`);
          endDateTime.setDate(endDateTime.getDate() + 1);
        }
        duration = Math.floor((endDateTime - startDateTime) / 1000);
      }

      const updateData = {
        startTime: startDateTime.toISOString(),
        endTime: endDateTime ? endDateTime.toISOString() : null,
        duration: duration,
        note: editRowData.note,
        date: editRowData.date,
        project: editRowData.project,
        areaOfFocus: editRowData.areaOfFocus,
        costCode: editRowData.costCode,
        userId: editRowData.userId,
        taskId: editRowData.taskId || null // Add task association
      };

      // Track changes for history
      const changes = createChangeHistory(entry, updateData, user.uid);
      if (changes.length > 0) {
        const existingHistory = entry.history || [];
        updateData.history = [...existingHistory, ...changes];
      }

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
      costCode: '',
      duration: '',
      userId: ''
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
        status: 'started',
        forecastedHours: 0
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

  // Add user to project assignment
  const addAssignedUser = (userId) => {
    if (!userId) {
      toast.error('Please select a user');
      return;
    }

    // Check if user is already assigned
    if (newProject.assignedUsers?.includes(userId)) {
      toast.error('This user is already assigned to the project');
      return;
    }

    setNewProject(prev => ({
      ...prev,
      assignedUsers: [...(prev.assignedUsers || []), userId]
    }));
  };

  // Remove user from project assignment
  const removeAssignedUser = (userId) => {
    setNewProject(prev => ({
      ...prev,
      assignedUsers: prev.assignedUsers?.filter(id => id !== userId) || []
    }));
  };

  // Create/Update cost code
  const saveCostCode = async (e) => {
    e.preventDefault();

    console.log('saveCostCode called with:', newCostCode);
    console.log('areasOfFocus length:', areasOfFocus.length);
    console.log('editingCostCode:', editingCostCode);

    // Validate required fields
    if (!newCostCode.areaOfFocusIds || newCostCode.areaOfFocusIds.length === 0) {
      console.error('Validation failed: areaOfFocusIds is missing');
      toast.error('Please select at least one Area of Focus');
      return;
    }

    if (!newCostCode.code.trim()) {
      console.error('Validation failed: code is empty');
      toast.error('Please enter a Cost Code');
      return;
    }

    try {
      if (editingCostCode) {
        // Update existing cost code with the first selected area
        const costCodeData = {
          ...newCostCode,
          areaOfFocusId: newCostCode.areaOfFocusIds[0], // Single area for existing cost code
          userId: user.uid,
          churchId,
          updatedAt: new Date()
        };
        
        delete costCodeData.areaOfFocusIds; // Remove array field
        
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

        // Create additional cost codes for any extra selected areas
        const additionalAreas = newCostCode.areaOfFocusIds.slice(1); // Skip first area (already updated)
        const createdCostCodes = [];
        
        if (additionalAreas.length > 0) {
          for (const areaOfFocusId of additionalAreas) {
            const areaName = areasOfFocus.find(area => area.id === areaOfFocusId)?.name || '';
            
            const newCostCodeData = {
              code: newCostCode.code,
              description: newCostCode.description,
              category: newCostCode.category,
              costPerHour: newCostCode.costPerHour,
              areaOfFocusId: areaOfFocusId,
              userId: user.uid,
              churchId,
              createdAt: new Date()
            };
            
            const docRef = await addDoc(collection(db, `churches/${churchId}/costCodes`), {
              ...newCostCodeData,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            });

            // Add to created list for local state update
            const newCostCodeWithId = {
              id: docRef.id,
              ...newCostCodeData
            };
            createdCostCodes.push(newCostCodeWithId);
            console.log(`Additional cost code created for area "${areaName}":`, newCostCodeWithId);
          }

          // Update local state with all new cost codes
          setCostCodes(prev => [...createdCostCodes, ...prev]);
          
          toast.success(`Cost code updated and ${createdCostCodes.length} additional cost code(s) created!`);
        } else {
          toast.success('Cost code updated successfully!');
        }
      } else {
        // Create individual cost codes for each selected area of focus
        const createdCostCodes = [];
        
        for (const areaOfFocusId of newCostCode.areaOfFocusIds) {
          const areaName = areasOfFocus.find(area => area.id === areaOfFocusId)?.name || '';
          
          const costCodeData = {
            code: newCostCode.code,
            description: newCostCode.description,
            category: newCostCode.category,
            costPerHour: newCostCode.costPerHour,
            areaOfFocusId: areaOfFocusId,
            userId: user.uid,
            churchId,
            createdAt: new Date()
          };
          
          const docRef = await addDoc(collection(db, `churches/${churchId}/costCodes`), {
            ...costCodeData,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });

          // Add to created list for local state update
          const newCostCodeWithId = {
            id: docRef.id,
            ...costCodeData
          };
          createdCostCodes.push(newCostCodeWithId);
          console.log(`Cost code created for area "${areaName}":`, newCostCodeWithId);
        }

        // Update local state with all new cost codes
        setCostCodes(prev => [...createdCostCodes, ...prev]);
        
        const count = createdCostCodes.length;
        toast.success(`${count} cost code${count > 1 ? 's' : ''} created successfully!`);
      }

      setNewCostCode({
        code: '',
        description: '',
        category: '',
        costPerHour: '',
        areaOfFocusIds: []
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

  // Save Expense Category
  const saveExpenseCategory = async () => {
    if (!churchId) return;

    try {
      if (editingExpenseCategory) {
        await updateDoc(doc(db, `churches/${churchId}/expenseCategories`, editingExpenseCategory.id), {
          ...newExpenseCategory,
          updatedAt: serverTimestamp()
        });
        toast.success('Expense category updated successfully');
      } else {
        await addDoc(collection(db, `churches/${churchId}/expenseCategories`), {
          ...newExpenseCategory,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        toast.success('Expense category created successfully');
      }
      setShowExpenseCategoryModal(false);
      setEditingExpenseCategory(null);
      setNewExpenseCategory({
        name: '',
        description: '',
        color: '#10b981'
      });
    } catch (error) {
      console.error('Error saving expense category:', error);
      toast.error('Failed to save expense category');
    }
  };

  // Delete Expense Category
  const deleteExpenseCategory = async (categoryId) => {
    if (!churchId || !window.confirm('Are you sure you want to delete this expense category?')) return;

    try {
      await deleteDoc(doc(db, `churches/${churchId}/expenseCategories`, categoryId));
      toast.success('Expense category deleted successfully');
    } catch (error) {
      console.error('Error deleting expense category:', error);
      toast.error('Failed to delete expense category');
    }
  };

  // Save Expense
  const saveExpense = async () => {
    if (!churchId) return;

    try {
      const expenseData = {
        ...newExpense,
        amount: parseFloat(newExpense.amount),
        date: new Date(newExpense.date)
      };

      if (editingExpense) {
        await updateDoc(doc(db, `churches/${churchId}/expenses`, editingExpense.id), {
          ...expenseData,
          updatedAt: serverTimestamp()
        });
        toast.success('Expense updated successfully');
      } else {
        await addDoc(collection(db, `churches/${churchId}/expenses`), {
          ...expenseData,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        toast.success('Expense created successfully');
      }
      setShowExpenseModal(false);
      setEditingExpense(null);
      setNewExpense({
        title: '',
        description: '',
        amount: '',
        date: new Date().toISOString().split('T')[0],
        categoryId: '',
        subcategoryId: '',
        costCodeId: '',
        projectId: '',
        vendor: '',
        receipt: null
      });
    } catch (error) {
      console.error('Error saving expense:', error);
      toast.error('Failed to save expense');
    }
  };

  // Filtered expenses based on search term
  const filteredExpenses = expenses.filter(expense => {
    if (!expenseSearchTerm) return true;
    
    const searchLower = expenseSearchTerm.toLowerCase();
    return (
      expense.title?.toLowerCase().includes(searchLower) ||
      expense.description?.toLowerCase().includes(searchLower) ||
      expense.vendor?.toLowerCase().includes(searchLower) ||
      expenseCategories.find(cat => cat.id === expense.categoryId)?.name?.toLowerCase().includes(searchLower) ||
      costCodes.find(cc => cc.id === expense.costCodeId)?.code?.toLowerCase().includes(searchLower) ||
      projects.find(p => p.id === expense.projectId)?.name?.toLowerCase().includes(searchLower)
    );
  });

  // Contract Functions
  const saveContract = async () => {
    try {
      const contractData = {
        ...newContract,
        userId: user.uid,
        churchId,
        totalAmount: parseFloat(newContract.totalAmount) || 0,
        updatedAt: new Date()
      };

      if (editingContract) {
        // Check if status changed and log it
        let statusChangeLog = editingContract.statusChangeLog || [];
        if (editingContract.status !== newContract.status) {
          const statusChange = {
            id: Date.now().toString(),
            previousStatus: editingContract.status,
            newStatus: newContract.status,
            changedBy: user.email || user.displayName || 'Unknown User',
            changedAt: new Date(),
            userId: user.uid
          };
          statusChangeLog = [...statusChangeLog, statusChange];
          contractData.statusChangeLog = statusChangeLog;
        }

        // Update existing contract
        await updateDoc(doc(db, `churches/${churchId}/contracts`, editingContract.id), {
          ...contractData,
          updatedAt: serverTimestamp()
        });

        // Update local state
        setContracts(prev => prev.map(contract =>
          contract.id === editingContract.id
            ? { ...contract, ...contractData, id: editingContract.id }
            : contract
        ));

        toast.success('Contract updated successfully!');
      } else {
        // Create new contract
        contractData.createdAt = new Date();
        // Initialize status change log with creation
        contractData.statusChangeLog = [{
          id: Date.now().toString(),
          previousStatus: null,
          newStatus: newContract.status,
          changedBy: user.email || user.displayName || 'Unknown User',
          changedAt: new Date(),
          userId: user.uid
        }];

        const docRef = await addDoc(collection(db, `churches/${churchId}/contracts`), {
          ...contractData,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });

        // Update local state
        const newContractWithId = {
          id: docRef.id,
          ...contractData
        };
        setContracts(prev => [newContractWithId, ...prev]);

        toast.success('Contract created successfully!');
      }

      setNewContract({
        name: '',
        description: '',
        clientName: '',
        contractNumber: '',
        status: 'estimating',
        totalAmount: '',
        startDate: '',
        endDate: '',
        projectId: '',
        notes: '',
        featured: false,
        brand: '',
        statusChangeLog: [],
        comments: []
      });
      setEditingContract(null);
      setShowContractModal(false);
    } catch (error) {
      console.error('Error saving contract:', error);
      toast.error('Failed to save contract');
    }
  };

  const deleteContract = async (contractId) => {
    if (!window.confirm('Are you sure you want to delete this contract?')) return;

    try {
      // Update local state first for immediate feedback
      setContracts(prev => prev.filter(contract => contract.id !== contractId));

      // Delete from Firestore
      await deleteDoc(doc(db, `churches/${churchId}/contracts`, contractId));

      toast.success('Contract deleted successfully!');
    } catch (error) {
      console.error('Error deleting contract:', error);
      toast.error('Failed to delete contract');
    }
  };

  const editContract = (contract) => {
    setEditingContract(contract);
    setNewContract({
      name: contract.name || '',
      description: contract.description || '',
      clientName: contract.clientName || '',
      contractNumber: contract.contractNumber || '',
      status: contract.status || 'estimating',
      totalAmount: contract.totalAmount?.toString() || '',
      startDate: contract.startDate || '',
      endDate: contract.endDate || '',
      projectId: contract.projectId || '',
      notes: contract.notes || ''
    });
    setShowContractModal(true);
  };

  // Comments CRUD Functions
  const openCommentsModal = (contract) => {
    setSelectedContractForComments(contract);
    setShowCommentsModal(true);
  };

  const closeCommentsModal = () => {
    setShowCommentsModal(false);
    setSelectedContractForComments(null);
    setNewComment('');
    setEditingComment(null);
  };

  const addComment = async () => {
    if (!newComment.trim() || !selectedContractForComments) return;

    try {
      const comment = {
        id: Date.now().toString(),
        text: newComment.trim(),
        createdBy: user.email || user.displayName || 'Unknown User',
        userId: user.uid,
        createdAt: new Date()
      };

      const updatedComments = [...(selectedContractForComments.comments || []), comment];

      await updateDoc(doc(db, `churches/${churchId}/contracts`, selectedContractForComments.id), {
        comments: updatedComments,
        updatedAt: serverTimestamp()
      });

      // Update local state
      setContracts(prev => prev.map(contract =>
        contract.id === selectedContractForComments.id
          ? { ...contract, comments: updatedComments }
          : contract
      ));

      setSelectedContractForComments(prev => ({ ...prev, comments: updatedComments }));
      setNewComment('');
      toast.success('Comment added successfully!');
    } catch (error) {
      console.error('Error adding comment:', error);
      toast.error('Failed to add comment');
    }
  };

  const updateComment = async () => {
    if (!editingComment || !selectedContractForComments) return;

    try {
      const updatedComments = selectedContractForComments.comments.map(comment =>
        comment.id === editingComment.id
          ? { ...comment, text: editingComment.text, updatedAt: new Date() }
          : comment
      );

      await updateDoc(doc(db, `churches/${churchId}/contracts`, selectedContractForComments.id), {
        comments: updatedComments,
        updatedAt: serverTimestamp()
      });

      // Update local state
      setContracts(prev => prev.map(contract =>
        contract.id === selectedContractForComments.id
          ? { ...contract, comments: updatedComments }
          : contract
      ));

      setSelectedContractForComments(prev => ({ ...prev, comments: updatedComments }));
      setEditingComment(null);
      toast.success('Comment updated successfully!');
    } catch (error) {
      console.error('Error updating comment:', error);
      toast.error('Failed to update comment');
    }
  };

  const deleteComment = async (commentId) => {
    if (!selectedContractForComments) return;

    try {
      const updatedComments = selectedContractForComments.comments.filter(comment => comment.id !== commentId);

      await updateDoc(doc(db, `churches/${churchId}/contracts`, selectedContractForComments.id), {
        comments: updatedComments,
        updatedAt: serverTimestamp()
      });

      // Update local state
      setContracts(prev => prev.map(contract =>
        contract.id === selectedContractForComments.id
          ? { ...contract, comments: updatedComments }
          : contract
      ));

      setSelectedContractForComments(prev => ({ ...prev, comments: updatedComments }));
      toast.success('Comment deleted successfully!');
    } catch (error) {
      console.error('Error deleting comment:', error);
      toast.error('Failed to delete comment');
    }
  };

  const startEditingComment = (comment) => {
    setEditingComment({ ...comment });
  };

  const cancelEditingComment = () => {
    setEditingComment(null);
  };

  // Load contracts from Firestore
  const loadContracts = async () => {
    try {
      const contractsRef = collection(db, `churches/${churchId}/contracts`);
      const snapshot = await getDocs(contractsRef);
      const contractsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setContracts(contractsData);
    } catch (error) {
      console.error('Error loading contracts:', error);
      toast.error('Failed to load contracts');
    }
  };

  // Brand Management Functions
  const loadBrands = async () => {
    try {
      const brandsRef = collection(db, `churches/${churchId}/brands`);
      const snapshot = await getDocs(brandsRef);
      const brandsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setBrands(brandsData);
    } catch (error) {
      console.error('Error loading brands:', error);
      toast.error('Failed to load brands');
    }
  };

  const saveBrand = async () => {
    try {
      if (!newBrand.name.trim()) {
        toast.error('Brand name is required');
        return;
      }

      let imageUrl = newBrand.imageUrl;

      // Upload image if there's a file
      if (newBrand.imageFile) {
        const storageRef = ref(storage, `churches/${churchId}/brands/${Date.now()}_${newBrand.imageFile.name}`);
        const uploadTask = await uploadBytes(storageRef, newBrand.imageFile);
        imageUrl = await getDownloadURL(uploadTask.ref);
      }

      const brandData = {
        name: newBrand.name.trim(),
        description: newBrand.description.trim(),
        imageUrl: imageUrl,
        userId: user.uid,
        churchId,
        updatedAt: new Date()
      };

      if (editingBrand) {
        // Update existing brand
        await updateDoc(doc(db, `churches/${churchId}/brands`, editingBrand.id), {
          ...brandData,
          updatedAt: serverTimestamp()
        });

        // Update local state
        setBrands(prev => prev.map(brand =>
          brand.id === editingBrand.id
            ? { ...brand, ...brandData, id: editingBrand.id }
            : brand
        ));

        toast.success('Brand updated successfully!');
      } else {
        // Create new brand
        brandData.createdAt = new Date();

        const docRef = await addDoc(collection(db, `churches/${churchId}/brands`), {
          ...brandData,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });

        // Update local state
        const newBrandWithId = {
          id: docRef.id,
          ...brandData
        };
        setBrands(prev => [...prev, newBrandWithId]);

        toast.success('Brand created successfully!');
      }

      // Reset form
      setNewBrand({
        name: '',
        description: '',
        imageUrl: '',
        imageFile: null
      });
      setBrandImagePreview(null);
      setEditingBrand(null);
      setShowBrandModal(false);
    } catch (error) {
      console.error('Error saving brand:', error);
      toast.error('Failed to save brand');
    }
  };

  const deleteBrand = async (brandId) => {
    if (!window.confirm('Are you sure you want to delete this brand?')) return;

    try {
      // Update local state first for immediate feedback
      setBrands(prev => prev.filter(brand => brand.id !== brandId));

      // Delete from Firestore
      await deleteDoc(doc(db, `churches/${churchId}/brands`, brandId));

      toast.success('Brand deleted successfully!');
    } catch (error) {
      console.error('Error deleting brand:', error);
      toast.error('Failed to delete brand');
    }
  };

  const openBrandModal = (brand = null) => {
    if (brand) {
      setEditingBrand(brand);
      setNewBrand({
        name: brand.name || '',
        description: brand.description || '',
        imageUrl: brand.imageUrl || '',
        imageFile: null
      });
      setBrandImagePreview(brand.imageUrl || null);
    } else {
      setEditingBrand(null);
      setNewBrand({
        name: '',
        description: '',
        imageUrl: '',
        imageFile: null
      });
      setBrandImagePreview(null);
    }
    setShowBrandModal(true);
  };

  const closeBrandModal = () => {
    setShowBrandModal(false);
    setEditingBrand(null);
    setNewBrand({
      name: '',
      description: '',
      imageUrl: '',
      imageFile: null
    });
    setBrandImagePreview(null);
  };

  const handleBrandImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setNewBrand(prev => ({ ...prev, imageFile: file }));
      
      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => {
        setBrandImagePreview(e.target.result);
      };
      reader.readAsDataURL(file);
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

      // Get all contracts for this project
      const contractsRef = collection(db, `churches/${churchId}/contracts`);
      const contractsQuery = query(
        contractsRef,
        where('projectId', '==', project.id)
      );

      console.log('Fetching contracts for project:', project.id);
      let contractsSnapshot;
      try {
        contractsSnapshot = await getDocs(contractsQuery);
      } catch (contractsError) {
        console.error('Error fetching contracts:', contractsError);
        contractsSnapshot = { docs: [] };
      }

      const projectContractsData = contractsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      console.log('Found contracts:', projectContractsData.length);
      setProjectContracts(projectContractsData);

      setActiveTab('projectProfile');

      console.log('Project profile loaded successfully');
    } catch (error) {
      console.error('Error loading project profile:', error);
      console.error('Error details:', error.code, error.message);
      toast.error(`Failed to load project profile: ${error.message}`);
    }
  };

  // Assign cost code to project
  const assignCostCodeToProject = async (costCodeId, hours = '0') => {
    if (!selectedProject) return;

    try {
      const newAssignment = { costCodeId, hours: hours.toString() };
      
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
    if (!selectedProject) {
      console.error('No selected project for cost code removal');
      toast.error('No project selected');
      return;
    }

    console.log('Removing cost code:', costCodeId, 'from project:', selectedProject.id);
    console.log('Current cost code assignments:', selectedProject.costCodeAssignments);

    try {
      // Find the assignment to remove
      const assignmentToRemove = selectedProject.costCodeAssignments?.find(
        assignment => assignment.costCodeId === costCodeId
      );

      console.log('Assignment to remove:', assignmentToRemove);

      if (!assignmentToRemove) {
        console.error('Assignment not found for cost code:', costCodeId);
        toast.error('Cost code assignment not found');
        return;
      }

      console.log('Updating Firestore...');
      await updateDoc(doc(db, `churches/${churchId}/projects`, selectedProject.id), {
        costCodeAssignments: arrayRemove(assignmentToRemove),
        updatedAt: serverTimestamp()
      });

      console.log('Updating local state...');
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

      console.log('Cost code removed successfully');
      toast.success('Cost code removed from project!');
    } catch (error) {
      console.error('Error removing cost code:', error);
      console.error('Error details:', error.code, error.message);
      toast.error(`Failed to remove cost code: ${error.message}`);
    }
  };

  // Start editing cost code assignment
  const startEditingCostCodeAssignment = (assignment) => {
    console.log('startEditingCostCodeAssignment called with:', assignment);
    console.log('Setting editingCostCodeAssignment to:', assignment.costCodeId);
    setEditingCostCodeAssignment(assignment.costCodeId);
    setEditCostCodeAssignmentData({
      costCodeId: assignment.costCodeId,
      hours: assignment.hours || ''
    });
    console.log('Edit state set successfully');
  };

  // Cancel editing cost code assignment
  const cancelEditingCostCodeAssignment = () => {
    setEditingCostCodeAssignment(null);
    setEditCostCodeAssignmentData({
      costCodeId: '',
      hours: ''
    });
  };

  // Save edited cost code assignment
  const saveEditedCostCodeAssignment = async () => {
    if (!selectedProject || !editingCostCodeAssignment) return;

    try {
      const updatedHours = parseFloat(editCostCodeAssignmentData.hours || 0);
      
      // Find the assignment to update
      const assignmentIndex = selectedProject.costCodeAssignments?.findIndex(
        assignment => assignment.costCodeId === editingCostCodeAssignment
      );

      if (assignmentIndex === -1) return;

      // Create updated assignment
      const updatedAssignment = {
        ...selectedProject.costCodeAssignments[assignmentIndex],
        hours: updatedHours.toString()
      };

      // Create new array with updated assignment
      const updatedAssignments = [...selectedProject.costCodeAssignments];
      updatedAssignments[assignmentIndex] = updatedAssignment;

      await updateDoc(doc(db, `churches/${churchId}/projects`, selectedProject.id), {
        costCodeAssignments: updatedAssignments,
        updatedAt: serverTimestamp()
      });

      // Update local state
      setSelectedProject(prev => ({
        ...prev,
        costCodeAssignments: updatedAssignments
      }));

      // Also update the projects list
      setProjects(prev => prev.map(p => 
        p.id === selectedProject.id 
          ? { ...p, costCodeAssignments: updatedAssignments }
          : p
      ));

      setEditingCostCodeAssignment(null);
      setEditCostCodeAssignmentData({
        costCodeId: '',
        hours: ''
      });

      toast.success('Cost code assignment updated!');
    } catch (error) {
      console.error('Error updating cost code assignment:', error);
      toast.error('Failed to update cost code assignment');
    }
  };

  // Start assigning cost code with hours input
  const startAssigningCostCode = (costCodeId) => {
    setAssigningCostCode(costCodeId);
    setAssignmentHours('');
  };

  // Cancel cost code assignment
  const cancelAssigningCostCode = () => {
    setAssigningCostCode(null);
    setAssignmentHours('');
  };

  // Confirm cost code assignment with hours
  const confirmAssignCostCode = async () => {
    if (!assigningCostCode || !assignmentHours.trim()) {
      toast.error('Please enter hours for the cost code assignment');
      return;
    }

    const hours = parseFloat(assignmentHours);
    if (isNaN(hours) || hours < 0) {
      toast.error('Please enter a valid positive number for hours');
      return;
    }

    await assignCostCodeToProject(assigningCostCode, hours.toString());
    setAssigningCostCode(null);
    setAssignmentHours('');
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
      status: task.status,
      forecastedHours: task.forecastedHours || 0
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
      width: "100%", 
      margin: "20px auto", 
      display: "flex", 
      flexDirection: "column", 
      fontFamily: "'Nunito', sans-serif",
      backgroundColor: "#ffffff",
      borderRadius: "12px",
      boxShadow: "0 4px 20px rgba(0, 0, 0, 0.08)",
      position: "relative"
    }}>
      {/* Organization Selector in Top Right */}
      {availableOrganizations.length > 1 && (
        <div style={{
          position: "absolute",
          top: "1rem",
          right: "1rem",
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
          backgroundColor: "white",
          padding: "0.75rem 1rem",
          borderRadius: "0.5rem",
          boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
          border: "1px solid #e5e7eb",
          minWidth: "250px"
        }} data-dropdown>
          <label style={{ fontSize: "0.875rem", fontWeight: "500", color: "#374151" }}>Organization:</label>
          
          {/* Custom Dropdown */}
          <div style={{ position: "relative", width: "100%" }}>
            {/* Dropdown Trigger */}
            <div
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              style={{
                padding: "0.5rem",
                border: "1px solid #d1d5db",
                borderRadius: "0.25rem",
                fontSize: "0.875rem",
                backgroundColor: "white",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontWeight: "500",
                gap: "0.5rem"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flex: 1 }}>
                {currentOrganization?.logo && (
                  <img 
                    src={currentOrganization.logo.startsWith('http') ? currentOrganization.logo : `https://firebasestorage.googleapis.com/v0/b/igletechv1.firebasestorage.app/o/${encodeURIComponent(currentOrganization.logo.substring(1))}?alt=media`}
                    alt={currentOrganization.nombre || currentOrganization.name || 'Logo'}
                    style={{
                      width: "24px",
                      height: "24px",
                      borderRadius: "50%",
                      objectFit: "cover"
                    }}
                    onError={(e) => {
                      e.target.style.display = 'none';
                    }}
                  />
                )}
                <span>
                  {currentOrganization ? (currentOrganization.nombre || currentOrganization.name || currentOrganization.churchId || currentOrganization.id) : 'Select organization...'}
                </span>
              </div>
              <FaChevronDown style={{ 
                transform: isDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s',
                flexShrink: 0
              }} />
            </div>
            
            {/* Dropdown Menu */}
            {isDropdownOpen && (
              <div style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                backgroundColor: "white",
                border: "1px solid #d1d5db",
                borderRadius: "0.25rem",
                boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                zIndex: 1001,
                maxHeight: "300px",
                overflowY: "auto",
                scrollbarWidth: "none", /* Firefox */
                msOverflowStyle: "none"  /* IE and Edge */
              }}
              className="hide-scrollbar"
              >
                {/* Search Input in Dropdown */}
                <div style={{ padding: "0.5rem", borderBottom: "1px solid #e5e7eb" }}>
                  <input
                    type="text"
                    placeholder="Search organizations..."
                    value={organizationSearchQuery}
                    onChange={(e) => setOrganizationSearchQuery(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "0.25rem",
                      border: "1px solid #d1d5db",
                      borderRadius: "0.25rem",
                      fontSize: "0.875rem",
                      boxSizing: "border-box"
                    }}
                    autoFocus
                  />
                </div>
                
                {/* Filtered Options */}
                <div>
                  {availableOrganizations
                    .filter((org) => {
                      const orgName = org.nombre || org.name || org.churchId || org.id || '';
                      const searchLower = organizationSearchQuery.toLowerCase();
                      return orgName.toLowerCase().includes(searchLower);
                    })
                    .map((org) => (
                      <div
                        key={org.id}
                        onClick={() => {
                          handleOrganizationSwitch(org.id);
                          setIsDropdownOpen(false);
                          setOrganizationSearchQuery('');
                        }}
                        style={{
                          padding: "0.5rem 0.75rem",
                          cursor: "pointer",
                          backgroundColor: org.id === churchId ? "#f3f4f6" : "white",
                          borderBottom: "1px solid #f3f4f6",
                          fontWeight: org.id === churchId ? "600" : "500",
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem"
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#f9fafb"}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = org.id === churchId ? "#f3f4f6" : "white"}
                      >
                        {org.logo && (
                          <img 
                            src={org.logo.startsWith('http') ? org.logo : `https://firebasestorage.googleapis.com/v0/b/igletechv1.firebasestorage.app/o/${encodeURIComponent(org.logo.substring(1))}?alt=media`}
                            alt={org.nombre || org.name || 'Logo'}
                            style={{
                              width: "24px",
                              height: "24px",
                              borderRadius: "50%",
                              objectFit: "cover"
                            }}
                            onError={(e) => {
                              e.target.style.display = 'none';
                            }}
                          />
                        )}
                        <span>{org.nombre || org.name || org.churchId || org.id}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <Link to={`/organization/${churchId}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to Mi Organización
      </Link>
      <ChurchHeader id={churchId} applyShadow={false} allowEditBannerLogo={true} />
      <div style={{ marginTop: "-30px" }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: '1rem'
        }}>
          <h1 style={commonStyles.title}>Time Tracker</h1>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <div style={{
              backgroundColor: '#F3F4F6',
              padding: '8px 16px',
              borderRadius: '8px',
              border: '1px solid #E5E7EB',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <span style={{ fontSize: '1.2rem' }}>👤</span>
              <div>
                <div style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: '500' }}>Your Role</div>
                <div style={{ fontSize: '0.95rem', fontWeight: '600', color: '#1F2937', textTransform: 'capitalize' }}>
                  {user?.role?.replace('_', ' ') || 'Member'}
                </div>
              </div>
            </div>
            <button
              onClick={handleLogout}
              style={{
                backgroundColor: '#EF4444',
                color: 'white',
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: '500',
                fontSize: '0.95rem',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#DC2626'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#EF4444'}
            >
              🚪 Logout
            </button>
          </div>
        </div>
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
            <button 
              className={`tab-btn ${activeTab === 'expenses' ? 'active' : ''}`}
              onClick={() => handleTabChange('expenses')}
            >
              💸 Expenses
            </button>
            <button 
              className={`tab-btn ${activeTab === 'contracts' ? 'active' : ''}`}
              onClick={() => handleTabChange('contracts')}
            >
              📄 Contracts
            </button>
            <button 
              className={`tab-btn ${activeTab === 'brands' ? 'active' : ''}`}
              onClick={() => handleTabChange('brands')}
            >
              🏷️ Brand Management
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
            
            {/* Timer Navigation */}
            <div className="timer-navigation">
              <button
                className="timer-nav-btn"
                onClick={() => navigate(`/organization/${churchId}/timer-page`)}
              >
                🕒 Go to Timer Page
              </button>
            </div>
          </div>

          <div className="time-tracker-content">
            {/* Time Entries Data Table */}
            <div className="section">
              <div className="table-header">
                <h3>Time Entries ({filteredAndSortedEntries().length})</h3>
                <div className="table-controls">
                  <div className="tt-search-container">
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
                  <button 
                    onClick={() => exportTimeEntriesToPDF(
                      filteredAndSortedEntries(),
                      users,
                      projects,
                      areasOfFocus,
                      costCodes,
                      { dateFrom: filterDateFrom, dateTo: filterDateTo }
                    )} 
                    className="export-pdf-btn"
                    disabled={filteredAndSortedEntries().length === 0}
                  >
                    📄 Export to PDF
                  </button>
                </div>
              </div>

              {/* Data Table */}
              <div className="data-table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th onClick={() => handleSort('userId')} className="sortable">
                        User {sortField === 'userId' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th onClick={() => handleSort('startTime')} className="sortable">
                        Start Time {sortField === 'startTime' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th>End Time</th>
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
                      <th onClick={() => handleSort('taskId')} className="sortable">
                        Task {sortField === 'taskId' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th>Note</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAndSortedEntries().map(entry => (
                      <tr key={entry.id}>
                        {editingRowId === entry.id ? (
                          // Edit mode - show input fields
                          <>
                            <td>
                              <select
                                value={editRowData.userId}
                                onChange={(e) => setEditRowData({...editRowData, userId: e.target.value})}
                                className="inline-edit-select"
                              >
                                <option value="">Select User</option>
                                {users.map(user => (
                                  <option key={user.id} value={user.id}>
                                    {user.name && user.lastName ? `${user.name} ${user.lastName}` : user.name || user.email}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <input
                                type="text"
                                value={editRowData.startTime}
                                onChange={(e) => {
                                  const formatted = formatTimeInputWithContext(e.target.value);
                                  const validationError = validateTimeInput(formatted, 'editStartTime');
                                  updateTimeValidation('editStartTime', validationError);
                                  
                                  setEditRowData(prev => {
                                    const newData = {...prev, startTime: formatted};
                                    // Auto-calculate duration if end time is set
                                    if (prev.endTime && formatted && !validationError) {
                                      try {
                                        const startTime24h = convertTo24Hour(formatted);
                                        const endTime24h = convertTo24Hour(prev.endTime);
                                        const startDateTime = new Date(`2000-01-01T${startTime24h}`);
                                        const endDateTime = new Date(`2000-01-01T${endTime24h}`);
                                        
                                        if (endDateTime > startDateTime) {
                                          const durationSeconds = Math.floor((endDateTime - startDateTime) / 1000);
                                          const durationHours = (durationSeconds / 3600).toFixed(2);
                                          newData.duration = durationHours;
                                        }
                                      } catch (error) {
                                        // If calculation fails, leave duration as-is
                                      }
                                    }
                                    return newData;
                                  });
                                }}
                                onBlur={(e) => {
                                  // Additional validation on blur if needed
                                  const currentValue = editRowData.startTime;
                                  if (editRowData.endTime && currentValue) {
                                    try {
                                      const startTime24h = convertTo24Hour(currentValue);
                                      const endTime24h = convertTo24Hour(editRowData.endTime);
                                      const startDateTime = new Date(`2000-01-01T${startTime24h}`);
                                      const endDateTime = new Date(`2000-01-01T${endTime24h}`);
                                      
                                      // Allow midnight crossing - no error for start time after end time
                                      // The duration calculation already handles this
                                    } catch (error) {
                                      // Validation error, but don't prevent the blur
                                    }
                                  }
                                }}
                                className={`inline-edit-input time-input ${timeValidationErrors.editStartTime ? 'error' : ''}`}
                                placeholder="9:00 AM"
                              />
                              {timeValidationErrors.editStartTime && (
                                <div className="field-error">{timeValidationErrors.editStartTime}</div>
                              )}
                            </td>
                            <td>
                              <input
                                type="text"
                                value={editRowData.endTime}
                                onChange={(e) => {
                                  const formatted = formatTimeInputWithContext(e.target.value, editRowData.startTime);
                                  const validationError = validateTimeInput(formatted, 'editEndTime');
                                  updateTimeValidation('editEndTime', validationError);
                                  
                                  setEditRowData(prev => {
                                    const newData = {...prev, endTime: formatted};
                                    // Auto-calculate duration if start time is set
                                    if (prev.startTime && formatted && !validationError) {
                                      try {
                                        const startTime24h = convertTo24Hour(prev.startTime);
                                        const endTime24h = convertTo24Hour(formatted);
                                        const startDateTime = new Date(`2000-01-01T${startTime24h}`);
                                        let endDateTime = new Date(`2000-01-01T${endTime24h}`);
                                        
                                        // Handle midnight crossing - if end time is before start time, assume next day
                                        if (endDateTime <= startDateTime) {
                                          endDateTime = new Date(endDateTime.getTime() + 24 * 60 * 60 * 1000);
                                        }
                                        
                                        if (endDateTime > startDateTime) {
                                          const durationSeconds = Math.floor((endDateTime - startDateTime) / 1000);
                                          const durationHours = (durationSeconds / 3600).toFixed(2);
                                          newData.duration = durationHours;
                                        }
                                      } catch (error) {
                                        // If calculation fails, leave duration as-is
                                      }
                                    }
                                    return newData;
                                  });
                                }}
                                onBlur={(e) => {
                                  // Additional validation on blur if needed
                                  const currentValue = editRowData.endTime;
                                  if (editRowData.startTime && currentValue) {
                                    try {
                                      const startTime24h = convertTo24Hour(editRowData.startTime);
                                      const endTime24h = convertTo24Hour(currentValue);
                                      const startDateTime = new Date(`2000-01-01T${startTime24h}`);
                                      const endDateTime = new Date(`2000-01-01T${endTime24h}`);
                                      
                                      // Allow midnight crossing - no error for end time before start time
                                      // The duration calculation already handles this
                                    } catch (error) {
                                      // Validation error, but don't prevent the blur
                                    }
                                  }
                                }}
                                className={`inline-edit-input time-input ${timeValidationErrors.editEndTime ? 'error' : ''}`}
                                placeholder="5:00 PM"
                              />
                              {timeValidationErrors.editEndTime && (
                                <div className="field-error">{timeValidationErrors.editEndTime}</div>
                              )}
                            </td>
                            <td>
                              <input
                                type="text"
                                value={editRowData.duration || ''}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setEditRowData(prev => {
                                    const newData = {...prev, duration: value};
                                    // Auto-calculate end time if start time is set
                                    if (prev.startTime && value) {
                                      const hours = parseFloat(value);
                                      if (!isNaN(hours)) {
                                        const endTime = calculateEndTime(prev.startTime, hours);
                                        newData.endTime = endTime;
                                      }
                                    }
                                    return newData;
                                  });
                                }}
                                className="inline-edit-input"
                                placeholder="8.5"
                                style={{width: '60px'}}
                              />
                            </td>
                            <td>
                              <select
                                value={editRowData.project}
                                onChange={(e) => setEditRowData({...editRowData, project: e.target.value})}
                                className="inline-edit-select"
                              >
                                <option value="">Select Project</option>
                                {getAvailableProjects().map(project => (
                                  <option key={project.id} value={project.id}>{project.name}</option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <select
                                value={editRowData.areaOfFocus}
                                onChange={(e) => setEditRowData({...editRowData, areaOfFocus: e.target.value})}
                                className="inline-edit-select"
                              >
                                <option value="">Select Area of Focus</option>
                                {areasOfFocus.map(area => (
                                  <option key={area.id} value={area.id}>{area.name}</option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <select
                                value={editRowData.costCode}
                                onChange={(e) => setEditRowData({...editRowData, costCode: e.target.value})}
                                className="inline-edit-select"
                              >
                                <option value="">Select Cost Code</option>
                                {costCodes.map(code => (
                                  <option key={code.id} value={code.code}>{code.code} - {code.description}</option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <select
                                value={editRowData.taskId}
                                onChange={(e) => setEditRowData({...editRowData, taskId: e.target.value})}
                                className="inline-edit-select"
                              >
                                <option value="">Select Task (Optional)</option>
                                {tasks.map(task => (
                                  <option key={task.id} value={task.id}>{task.title}</option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <input
                                type="text"
                                value={editRowData.note}
                                onChange={(e) => setEditRowData({...editRowData, note: e.target.value})}
                                className="inline-edit-input"
                                placeholder="Note"
                              />
                            </td>
                            <td>
                              <button onClick={() => saveInlineEdit(entry.id)} className="save-btn">Save</button>
                              <button onClick={cancelInlineEdit} className="cancel-btn">Cancel</button>
                            </td>
                          </>
                        ) : (
                          // View mode - show static data
                          <>
                            <td>
                              {(() => {
                                const user = users.find(u => u.id === entry.userId);
                                return user ? (user.name && user.lastName ? `${user.name} ${user.lastName}` : user.name || user.email) : 'Unknown User';
                              })()}
                            </td>
                            <td>{formatTimeDisplay(entry.startTime)}</td>
                            <td>{formatTimeDisplay(entry.endTime)}</td>
                            <td>{entry.duration ? (entry.duration / 3600).toFixed(2) + 'h' : '-'}</td>
                            <td>{projects.find(p => p.id === entry.project)?.name || 'Unknown Project'}</td>
                            <td>{areasOfFocus.find(a => a.id === entry.areaOfFocus)?.name || 'Unknown Area'}</td>
                            <td>{costCodes.find(c => c.code === entry.costCode)?.code || 'Unknown Code'}</td>
                            <td>{entry.taskId ? tasks.find(t => t.id === entry.taskId)?.title || 'Unknown Task' : '-'}</td>
                            <td>{entry.note || '-'}</td>
                            <td>
                              <div className="action-buttons">
                                <button onClick={() => editTimeEntry(entry)} className="edit-btn">Edit</button>
                                <button onClick={() => deleteTimeEntry(entry.id)} className="delete-btn">Delete</button>
                                {entry.history && entry.history.length > 0 && (
                                  <div className="history-tooltip-container">
                                    <button className="history-btn" title="View edit history">📝</button>
                                    <HistoryTooltip history={entry.history} users={users} />
                                  </div>
                                )}
                              </div>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}

                    {/* Add New Row Form */}
                    {showAddRow && (
                      <tr className="add-row">
                        <td>
                          <select
                            value={newRowData.userId}
                            onChange={(e) => setNewRowData({...newRowData, userId: e.target.value})}
                            className="inline-edit-select"
                          >
                            <option value="">Select User</option>
                            {users.map(user => (
                              <option key={user.id} value={user.id}>
                                {user.name && user.lastName ? `${user.name} ${user.lastName}` : user.name || user.email}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="text"
                            value={newRowData.startTime}
                            onChange={(e) => {
                              const formatted = formatTimeInputWithContext(e.target.value);
                              const validationError = validateTimeInput(formatted, 'newStartTime');
                              updateTimeValidation('newStartTime', validationError);
                              
                              setNewRowData(prev => {
                                const newData = {...prev, startTime: formatted};
                                // Auto-calculate duration if end time is set
                                if (prev.endTime && formatted && !validationError) {
                                  try {
                                    const startTime24h = convertTo24Hour(formatted);
                                    const endTime24h = convertTo24Hour(prev.endTime);
                                    const startDateTime = new Date(`2000-01-01T${startTime24h}`);
                                    const endDateTime = new Date(`2000-01-01T${endTime24h}`);
                                    
                                    if (endDateTime > startDateTime) {
                                      const durationSeconds = Math.floor((endDateTime - startDateTime) / 1000);
                                      const durationHours = (durationSeconds / 3600).toFixed(2);
                                      newData.duration = durationHours;
                                    }
                                  } catch (error) {
                                    // If calculation fails, leave duration as-is
                                  }
                                }
                                return newData;
                              });
                            }}
                            className={`inline-edit-input time-input ${timeValidationErrors.newStartTime ? 'error' : ''}`}
                            placeholder="9:00 AM"
                          />
                          {timeValidationErrors.newStartTime && (
                            <div className="field-error">{timeValidationErrors.newStartTime}</div>
                          )}
                        </td>
                        <td>
                          <input
                            type="text"
                            value={newRowData.endTime}
                            onChange={(e) => {
                              const formatted = formatTimeInputWithContext(e.target.value, newRowData.startTime);
                              const validationError = validateTimeInput(formatted, 'newEndTime');
                              updateTimeValidation('newEndTime', validationError);
                              
                              setNewRowData(prev => {
                                const newData = {...prev, endTime: formatted};
                                // Auto-calculate duration if start time is set
                                if (prev.startTime && formatted && !validationError) {
                                  try {
                                    const startTime24h = convertTo24Hour(prev.startTime);
                                    const endTime24h = convertTo24Hour(formatted);
                                    const startDateTime = new Date(`2000-01-01T${startTime24h}`);
                                    let endDateTime = new Date(`2000-01-01T${endTime24h}`);
                                    
                                    // Handle midnight crossing - if end time is before start time, assume next day
                                    if (endDateTime <= startDateTime) {
                                      endDateTime = new Date(endDateTime.getTime() + 24 * 60 * 60 * 1000);
                                    }
                                    
                                    if (endDateTime > startDateTime) {
                                      const durationSeconds = Math.floor((endDateTime - startDateTime) / 1000);
                                      const durationHours = (durationSeconds / 3600).toFixed(2);
                                      newData.duration = durationHours;
                                    }
                                  } catch (error) {
                                    // If calculation fails, leave duration as-is
                                  }
                                }
                                return newData;
                              });
                            }}
                            className={`inline-edit-input time-input ${timeValidationErrors.newEndTime ? 'error' : ''}`}
                            placeholder="5:00 PM"
                          />
                          {timeValidationErrors.newEndTime && (
                            <div className="field-error">{timeValidationErrors.newEndTime}</div>
                          )}
                        </td>
                        <td>
                          <input
                            type="text"
                            value={newRowData.duration || ''}
                            onChange={(e) => {
                              const value = e.target.value;
                              setNewRowData(prev => {
                                const newData = {...prev, duration: value};
                                // Auto-calculate end time if start time is set
                                if (prev.startTime && value) {
                                  const hours = parseFloat(value);
                                  if (!isNaN(hours)) {
                                    const endTime = calculateEndTime(prev.startTime, hours);
                                    newData.endTime = endTime;
                                  }
                                }
                                return newData;
                              });
                            }}
                            className="inline-edit-input"
                            placeholder="8.5"
                            style={{width: '60px'}}
                          />
                        </td>
                        <td>
                          <select
                            value={newRowData.project}
                            onChange={(e) => setNewRowData({...newRowData, project: e.target.value})}
                            className="inline-edit-select"
                          >
                            <option value="">Select Project</option>
                            {getAvailableProjects().map(project => (
                              <option key={project.id} value={project.id}>{project.name}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            value={newRowData.areaOfFocus}
                            onChange={(e) => setNewRowData({...newRowData, areaOfFocus: e.target.value})}
                            className="inline-edit-select"
                          >
                            <option value="">Select Area of Focus</option>
                            {areasOfFocus.map(area => (
                              <option key={area.id} value={area.id}>{area.name}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            value={newRowData.costCode}
                            onChange={(e) => setNewRowData({...newRowData, costCode: e.target.value})}
                            className="inline-edit-select"
                          >
                            <option value="">Select Cost Code</option>
                            {costCodes.map(code => (
                              <option key={code.id} value={code.code}>{code.code} - {code.description}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            value={newRowData.taskId}
                            onChange={(e) => setNewRowData({...newRowData, taskId: e.target.value})}
                            className="inline-edit-select"
                          >
                            <option value="">Select Task (Optional)</option>
                            {tasks.map(task => (
                              <option key={task.id} value={task.id}>{task.title}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="text"
                            value={newRowData.note}
                            onChange={(e) => setNewRowData({...newRowData, note: e.target.value})}
                            className="inline-edit-input"
                            placeholder="Note"
                          />
                        </td>
                        <td>
                          <button onClick={saveAddRow} className="save-btn">Save</button>
                          <button onClick={cancelAddRow} className="cancel-btn">Cancel</button>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}


      {activeTab === 'tasks' && (
        <>
          <TaskManager />
          <div className="tasks-content">
            {/* Task Management */}
            <div className="section">
              <div className="section-header">
                <div className="header-content">
                  <h3>Task Management</h3>
                  <div className="forecast-overview">
                    <div className="forecast-summary">
                      <span className="forecast-label">Total Forecasted Hours:</span>
                      <span className="forecast-value">{tasks.reduce((total, task) => total + (task.forecastedHours || 0), 0)}h</span>
                    </div>
                    <div className="status-summary">
                      <span className="status-count started">Started: {tasks.filter(task => task.status === 'started').length} ({tasks.filter(task => task.status === 'started').reduce((total, task) => total + (task.forecastedHours || 0), 0)}h)</span>
                      <span className="status-count in-progress">In Progress: {tasks.filter(task => task.status === 'in-progress').length} ({tasks.filter(task => task.status === 'in-progress').reduce((total, task) => total + (task.forecastedHours || 0), 0)}h)</span>
                      <span className="status-count completed">Completed: {tasks.filter(task => task.status === 'completed').length} ({tasks.filter(task => task.status === 'completed').reduce((total, task) => total + (task.forecastedHours || 0), 0)}h)</span>
                    </div>
                  </div>
                </div>
                <button
                  className="create-task-btn"
                  onClick={() => setShowTaskModal(true)}
                >
                  Create Task
                </button>
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
                          <option value="started">Started</option>
                          <option value="in-progress">In Progress</option>
                          <option value="completed">Completed</option>
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
                      {task.assignedTo && (
                        <span className="assigned-user">👤 {task.assignedTo}</span>
                      )}
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
        </>
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
                            costCodeAssignments: project.costCodeAssignments || [],
                            assignedUsers: project.assignedUsers || []
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
                          {(costCode.areaOfFocusIds || (costCode.areaOfFocusId ? [costCode.areaOfFocusId] : [])).length > 0 && (
                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                              {(costCode.areaOfFocusIds || [costCode.areaOfFocusId]).filter(Boolean).map(areaId => (
                                <span key={areaId} className="area-badge">
                                  {areasOfFocus.find(area => area.id === areaId)?.name || 'Unknown Area'}
                                </span>
                              ))}
                            </div>
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
                            areaOfFocusIds: costCode.areaOfFocusIds || (costCode.areaOfFocusId ? [costCode.areaOfFocusId] : []) // Support both old and new format
                          });
                          setShowCostCodeModal(true);
                        }}
                        className="edit-btn"
                        title="Edit Cost Code"
                      >
                        ✏️ Edit
                      </button>
                      <button
                        onClick={() => {
                          setEditingCostCode(null); // Not editing, creating new
                          setNewCostCode({
                            code: costCode.code,
                            description: costCode.description,
                            category: costCode.category,
                            costPerHour: costCode.costPerHour || '',
                            areaOfFocusIds: [] // Empty so user can select different areas
                          });
                          setShowCostCodeModal(true);
                        }}
                        className="duplicate-btn"
                        title="Duplicate Cost Code"
                        style={{
                          backgroundColor: '#8b5cf6',
                          color: 'white',
                          border: 'none',
                          padding: '8px 12px',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '0.9rem',
                          fontWeight: '500'
                        }}
                      >
                        📋 Duplicate
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

      {activeTab === 'expenses' && (
        <div className="expenses-tab-content">
          <div className="expenses-header">
            <h1>Expense Management</h1>
            <div className="expenses-header-actions">
              <button className="add-btn" onClick={() => setShowExpenseCategoryModal(true)}>
                + Add Category
              </button>
              <button className="add-btn" onClick={() => setShowExpenseModal(true)}>
                + Add Expense
              </button>
            </div>
          </div>

          {/* Expense Categories */}
          <div className="expense-categories-section">
            <h3>Expense Categories</h3>
            <div className="expense-categories-grid">
              {expenseCategories.length === 0 ? (
                <div className="no-categories-placeholder">
                  <div className="placeholder-icon">📂</div>
                  <h3>No Categories Yet</h3>
                  <p>Create your first expense category to organize your expenses.</p>
                  <button className="add-btn" onClick={() => setShowExpenseCategoryModal(true)}>
                    + Create Your First Category
                  </button>
                </div>
              ) : (
                expenseCategories.map(category => (
                  <div key={category.id} className="expense-category-card">
                    <div className="category-header">
                      <div 
                        className="category-color"
                        style={{ backgroundColor: category.color }}
                      ></div>
                      <div className="category-info">
                        <h4>{category.name}</h4>
                        <p>{category.description}</p>
                      </div>
                    </div>
                    <div className="category-actions">
                      <button 
                        className="edit-btn"
                        onClick={() => {
                          setEditingExpenseCategory(category);
                          setNewExpenseCategory({
                            name: category.name,
                            description: category.description,
                            color: category.color
                          });
                          setShowExpenseCategoryModal(true);
                        }}
                      >
                        Edit
                      </button>
                      <button 
                        className="delete-btn"
                        onClick={() => deleteExpenseCategory(category.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Expenses List */}
          <div className="expenses-list-section">
            <div className="expenses-summary">
              <h3>Expenses</h3>
              <div className="expenses-controls">
                <div className="tt-search-container">
                  <input
                    type="text"
                    placeholder="Search expenses..."
                    value={expenseSearchTerm}
                    onChange={(e) => setExpenseSearchTerm(e.target.value)}
                    className="search-input"
                  />
                  {expenseSearchTerm && (
                    <button 
                      className="clear-search-btn"
                      onClick={() => setExpenseSearchTerm('')}
                      title="Clear search"
                    >
                      ×
                    </button>
                  )}
                </div>
                <div className="expenses-total">
                  <span className="total-label">Total Expenses:</span>
                  <span className="total-amount">
                    ${filteredExpenses.reduce((sum, expense) => sum + (expense.amount || 0), 0).toFixed(2)}
                  </span>
                  <span className="total-count">({filteredExpenses.length} expense{filteredExpenses.length !== 1 ? 's' : ''})</span>
                </div>
              </div>
            </div>
            <div className="expenses-list">
              {filteredExpenses.length === 0 ? (
                <div className="no-expenses-placeholder">
                  <div className="placeholder-icon">💸</div>
                  <h3>{expenseSearchTerm ? 'No Matching Expenses' : 'No Expenses Yet'}</h3>
                  <p>
                    {expenseSearchTerm 
                      ? `No expenses match your search "${expenseSearchTerm}". Try a different search term.`
                      : 'Track your project expenses by adding your first expense.'
                    }
                  </p>
                  {expenseSearchTerm ? (
                    <button className="add-btn" onClick={() => setExpenseSearchTerm('')}>
                      Clear Search
                    </button>
                  ) : (
                    <button className="add-btn" onClick={() => setShowExpenseModal(true)}>
                      + Add Your First Expense
                    </button>
                  )}
                </div>
              ) : (
                filteredExpenses.map(expense => {
                  const category = expenseCategories.find(cat => cat.id === expense.categoryId);
                  const subcategory = expenseSubcategories.find(sub => sub.id === expense.subcategoryId);
                  const costCode = costCodes.find(cc => cc.id === expense.costCodeId);
                  
                  return (
                    <div key={expense.id} className="expense-card">
                      <div className="expense-header">
                        <div className="expense-title-section">
                          <h4>{expense.title}</h4>
                          <div className="expense-meta">
                            <span className="expense-date">{new Date(expense.date.seconds * 1000).toLocaleDateString()}</span>
                            {expense.vendor && <span className="expense-vendor">• {expense.vendor}</span>}
                          </div>
                        </div>
                        <div className="expense-amount">
                          ${expense.amount.toFixed(2)}
                        </div>
                      </div>
                      <div className="expense-details">
                        {expense.description && <p>{expense.description}</p>}
                        <div className="expense-tags">
                          {category && (
                            <span 
                              className="expense-tag category-tag"
                              style={{ backgroundColor: category.color }}
                            >
                              {category.name}
                            </span>
                          )}
                          {subcategory && (
                            <span className="expense-tag subcategory-tag">
                              {subcategory.name}
                            </span>
                          )}
                          {costCode && (
                            <span className="expense-tag cost-code-tag">
                              {costCode.code}
                            </span>
                          )}
                          {expense.projectId && (
                            <span className="expense-tag project-tag">
                              {projects.find(p => p.id === expense.projectId)?.name || 'Unknown Project'}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="expense-actions">
                        <button 
                          className="edit-btn"
                          onClick={() => {
                            setEditingExpense(expense);
                            setNewExpense({
                              title: expense.title,
                              description: expense.description || '',
                              amount: expense.amount.toString(),
                              date: new Date(expense.date.seconds * 1000).toISOString().split('T')[0],
                              categoryId: expense.categoryId || '',
                              subcategoryId: expense.subcategoryId || '',
                              costCodeId: expense.costCodeId || '',
                              projectId: expense.projectId || '',
                              vendor: expense.vendor || '',
                              receipt: null
                            });
                            setShowExpenseModal(true);
                          }}
                        >
                          Edit
                        </button>
                        <button 
                          className="delete-btn"
                          onClick={() => deleteExpense(expense.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'contracts' && (
        <div className="contracts-tab-content">
          <div className="contracts-header">
            <h1>Contract Management</h1>
            <div className="contracts-header-actions">
              <button className="add-btn" onClick={() => setShowContractModal(true)}>
                + Add Contract
              </button>
            </div>
          </div>

          <div className="contracts-content">
            {/* Contracts Summary */}
            <div className="contracts-summary">
              <div className="summary-card">
                <h3>Total Contracts</h3>
                <span className="summary-value">{contracts.length}</span>
              </div>
              <div className="summary-card">
                <h3>Estimating</h3>
                <span className="summary-value">{contracts.filter(c => c.status === 'estimating').length}</span>
              </div>
              <div className="summary-card">
                <h3>Awarded</h3>
                <span className="summary-value">{contracts.filter(c => c.status === 'awarded').length}</span>
              </div>
              <div className="summary-card">
                <h3>In Progress</h3>
                <span className="summary-value">{contracts.filter(c => c.status === 'in-progress').length}</span>
              </div>
              <div className="summary-card total-value">
                <h3>Total Contract Value</h3>
                <span className="summary-value">${contracts.reduce((sum, contract) => sum + (contract.totalAmount || 0), 0).toLocaleString()}</span>
              </div>
            </div>

            {/* Contracts List */}
            <div className="contracts-list">
              {contracts.length === 0 ? (
                <div className="empty-state">
                  <p>No contracts found. Click "Add Contract" to get started.</p>
                </div>
              ) : (
                contracts.map(contract => (
                  <div key={contract.id} className="contract-card">
                    <div className="contract-header">
                      <div className="contract-info">
                        <h3>{contract.name}</h3>
                        <p className="contract-number">Contract #{contract.contractNumber}</p>
                        <p className="client-name">{contract.clientName}</p>
                      </div>
                      <div className="contract-status">
                        <span 
                          className={`status-badge status-${contract.status}`}
                          title={contract.statusChangeLog && contract.statusChangeLog.length > 0 
                            ? contract.statusChangeLog.map(log => 
                                `${new Date(log.changedAt.seconds ? log.changedAt.seconds * 1000 : log.changedAt).toLocaleString()} - ${log.changedBy}: ${log.previousStatus || 'Created'} → ${log.newStatus}`
                              ).join('\n')
                            : 'No status changes recorded'
                          }
                        >
                          {contract.status === 'estimating' ? 'Estimating' :
                           contract.status === 'awarded' ? 'Awarded' :
                           contract.status === 'in-progress' ? 'In Progress' : contract.status}
                        </span>
                      </div>
                    </div>

                    <div className="contract-details">
                      <div className="contract-amount">
                        <span className="amount-label">Contract Value:</span>
                        <span className="amount-value">${(contract.totalAmount || 0).toLocaleString()}</span>
                      </div>

                      {contract.projectId && (
                        <div className="contract-project">
                          <span className="project-label">Project:</span>
                          <span className="project-name">
                            {projects.find(p => p.id === contract.projectId)?.name || 'Unknown Project'}
                          </span>
                        </div>
                      )}

                      {(contract.startDate || contract.endDate) && (
                        <div className="contract-dates">
                          {contract.startDate && <span>Start: {new Date(contract.startDate).toLocaleDateString()}</span>}
                          {contract.endDate && <span>End: {new Date(contract.endDate).toLocaleDateString()}</span>}
                        </div>
                      )}
                    </div>

                    {contract.description && (
                      <div className="contract-description">
                        <p>{contract.description}</p>
                      </div>
                    )}

                    <div className="contract-actions">
                      <button 
                        className="edit-btn"
                        onClick={() => editContract(contract)}
                      >
                        Edit
                      </button>
                      <button 
                        className="comments-btn"
                        onClick={() => openCommentsModal(contract)}
                      >
                        💬 Comments ({contract.comments?.length || 0})
                      </button>
                      <button 
                        className="delete-btn"
                        onClick={() => deleteContract(contract.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'projectProfile' && selectedProject && (
        <div className="project-profile-tab-content">
          <div className="project-profile-header">
            <div className="project-profile-info">
              <h1>{selectedProject.name}</h1>
              <p>{selectedProject.description}</p>
            </div>

            {/* Business Intelligence Dashboard */}
            <div className="bi-dashboard">
              <h2>📊 Business Intelligence Dashboard</h2>

              {(() => {
                // Define shared variables for all BI sections
                const totalRevenue = projectContracts.reduce((sum, contract) => sum + (contract.totalAmount || contract.contractValue || contract.amount || 0), 0);
                const totalExpenses = expenses.filter(expense => expense.projectId === selectedProject.id).reduce((sum, expense) => sum + (expense.amount || 0), 0);
                const totalLaborCost = Object.entries(projectCostCodeStats).reduce((sum, [code, stat]) => {
                  const costCode = costCodes.find(cc => cc.code === code);
                  return sum + (stat.totalHours * (costCode?.costPerHour ? parseFloat(costCode.costPerHour) : 0));
                }, 0);
                const totalActualHours = Object.values(projectCostCodeStats).reduce((sum, stat) => sum + stat.totalHours, 0);
                const totalAssignedHours = selectedProject.costCodeAssignments?.reduce((sum, assignment) => sum + parseFloat(assignment.hours || 0), 0) || 0;
                const totalTimeEntries = projectTimeEntries.length;
                const activeContracts = projectContracts.filter(c => c.status === 'in-progress').length;
                const completedContracts = projectContracts.filter(c => c.status === 'completed').length;
                const totalContracts = projectContracts.length;
                const contractCompletionRate = totalContracts > 0 ? (completedContracts / totalContracts) * 100 : 0;
                const avgEntriesPerDay = (() => {
                  if (totalTimeEntries === 0) return 0;
                  const dates = [...new Set(projectTimeEntries.map(entry => entry.date?.split('T')[0]).filter(Boolean))];
                  const uniqueDays = dates.length;
                  return uniqueDays > 0 ? totalTimeEntries / uniqueDays : 0;
                })();

                return (
                  <>
                    {/* Financial Overview */}
                    <div className="bi-section">
                      <h3>💰 Financial Overview</h3>
                      <div className="bi-cards-grid">
                        {(() => {
                          const totalCost = totalExpenses + totalLaborCost;
                          const netProfit = totalRevenue - totalCost;
                          const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

                          return (
                            <>
                              <div className="bi-card revenue">
                                <div className="bi-card-header">
                                  <span className="bi-icon">💵</span>
                                  <span className="bi-label">Total Revenue</span>
                                </div>
                                <div className="bi-card-value">${totalRevenue.toFixed(2)}</div>
                                <div className="bi-card-subtitle">Contract Value</div>
                              </div>

                              <div className="bi-card costs">
                                <div className="bi-card-header">
                                  <span className="bi-icon">💸</span>
                                  <span className="bi-label">Total Costs</span>
                                </div>
                                <div className="bi-card-value">${totalCost.toFixed(2)}</div>
                                <div className="bi-card-subtitle">Expenses + Labor</div>
                              </div>

                              <div className={`bi-card profit ${netProfit >= 0 ? 'positive' : 'negative'}`}>
                                <div className="bi-card-header">
                                  <span className="bi-icon">{netProfit >= 0 ? '📈' : '📉'}</span>
                                  <span className="bi-label">Net Profit</span>
                                </div>
                                <div className="bi-card-value">${netProfit.toFixed(2)}</div>
                                <div className="bi-card-subtitle">{netProfit >= 0 ? 'Profit' : 'Loss'}</div>
                                <div className="mini-bar-chart">
                                  <div className="mini-bar" style={{height: '60%', background: '#ef4444'}}></div>
                                  <div className="mini-bar" style={{height: '40%', background: '#10b981'}}></div>
                                </div>
                              </div>

                              <div className={`bi-card margin ${profitMargin >= 0 ? 'positive' : 'negative'}`}>
                                <div className="bi-card-header">
                                  <span className="bi-icon">📊</span>
                                  <span className="bi-label">Profit Margin</span>
                                </div>
                                <div className="bi-card-value">{profitMargin.toFixed(1)}%</div>
                                <div className="bi-card-subtitle">Revenue Efficiency</div>
                                <div className="mini-bar-chart">
                                  <div className="mini-bar fill" style={{height: `${Math.max(Math.min(profitMargin + 50, 100), 10)}%`}}>
                                    <span className="mini-bar-label">{profitMargin >= 0 ? 'Profit' : 'Loss'}</span>
                                  </div>
                                </div>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Project Efficiency Metrics */}
                    <div className="bi-section">
                      <h3>⚡ Project Efficiency</h3>
                      <div className="bi-cards-grid">
                        {(() => {
                          const hoursUtilization = totalAssignedHours > 0 ? (totalActualHours / totalAssignedHours) * 100 : 0;

                          const totalAssignedCost = selectedProject.costCodeAssignments?.reduce((sum, assignment) => {
                            const costCode = costCodes.find(cc => cc.id === assignment.costCodeId);
                            return sum + (parseFloat(assignment.hours || 0) * (costCode?.costPerHour ? parseFloat(costCode.costPerHour) : 0));
                          }, 0) || 0;

                          const totalActualCost = Object.entries(projectCostCodeStats).reduce((sum, [code, stat]) => {
                            const costCode = costCodes.find(cc => cc.code === code);
                            return sum + (stat.totalHours * (costCode?.costPerHour ? parseFloat(costCode.costPerHour) : 0));
                          }, 0);

                          const budgetEfficiency = totalAssignedCost > 0 ? ((totalAssignedCost - totalActualCost) / totalAssignedCost) * 100 : 0;

                          const avgCostPerHour = totalActualHours > 0 ? totalActualCost / totalActualHours : 0;
                          const revenuePerHour = totalActualHours > 0 ? totalRevenue / totalActualHours : 0;

                          return (
                            <>
                        <div className={`bi-card utilization ${hoursUtilization <= 100 ? 'good' : 'warning'}`}>
                          <div className="bi-card-header">
                            <span className="bi-icon">⏱️</span>
                            <span className="bi-label">Hours Utilization</span>
                          </div>
                          <div className="bi-card-value">{hoursUtilization.toFixed(1)}%</div>
                          <div className="bi-card-subtitle">{totalActualHours.toFixed(1)}h / {totalAssignedHours.toFixed(1)}h</div>
                          <div className="progress-circle">
                            <svg width="60" height="60" viewBox="0 0 60 60">
                              <circle cx="30" cy="30" r="25" fill="none" stroke="#e5e7eb" strokeWidth="4"/>
                              <circle cx="30" cy="30" r="25" fill="none" stroke="#3b82f6" strokeWidth="4"
                                strokeDasharray={`${2 * Math.PI * 25}`}
                                strokeDashoffset={`${2 * Math.PI * 25 * (1 - Math.min(hoursUtilization / 100, 1))}`}
                                transform="rotate(-90 30 30)"/>
                            </svg>
                          </div>
                        </div>                              <div className={`bi-card budget ${Math.abs(budgetEfficiency) <= 10 ? 'good' : budgetEfficiency > 0 ? 'positive' : 'negative'}`}>
                                <div className="bi-card-header">
                                  <span className="bi-icon">💰</span>
                                  <span className="bi-label">Budget Efficiency</span>
                                </div>
                                <div className="bi-card-value">{budgetEfficiency >= 0 ? '+' : ''}{budgetEfficiency.toFixed(1)}%</div>
                                <div className="bi-card-subtitle">Under/Over Budget</div>
                                <div className="mini-bar-chart">
                                  <div className="mini-bar fill" style={{height: `${Math.max(100 - Math.abs(budgetEfficiency), 10)}%`}}>
                                    <span className="mini-bar-label">{budgetEfficiency >= 0 ? 'Under' : 'Over'}</span>
                                  </div>
                                </div>
                              </div>

                              <div className="bi-card cost-hour">
                                <div className="bi-card-header">
                                  <span className="bi-icon">💵</span>
                                  <span className="bi-label">Avg Cost/Hour</span>
                                </div>
                                <div className="bi-card-value">${avgCostPerHour.toFixed(2)}</div>
                                <div className="bi-card-subtitle">Labor Cost</div>
                              </div>

                              <div className="bi-card revenue-hour">
                                <div className="bi-card-header">
                                  <span className="bi-icon">📈</span>
                                  <span className="bi-label">Revenue/Hour</span>
                                </div>
                                <div className="bi-card-value">${revenuePerHour.toFixed(2)}</div>
                                <div className="bi-card-subtitle">Productivity Rate</div>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Project Status & Progress */}
                    <div className="bi-section">
                      <h3>📋 Project Status</h3>
                      <div className="bi-cards-grid">
                        {(() => {
                          const projectProgress = totalAssignedHours > 0 ? (totalActualHours / totalAssignedHours) * 100 : 0;

                          return (
                            <>
                              <div className="bi-card progress">
                                <div className="bi-card-header">
                                  <span className="bi-icon">📊</span>
                                  <span className="bi-label">Project Progress</span>
                                </div>
                                <div className="bi-card-value">{projectProgress.toFixed(1)}%</div>
                                <div className="bi-card-subtitle">{totalActualHours.toFixed(1)}h / {totalAssignedHours.toFixed(1)}h</div>
                                <div className="progress-bar">
                                  <div className="progress-fill" style={{width: `${Math.min(projectProgress, 100)}%`}}></div>
                                </div>
                              </div>

                              <div className="bi-card contracts">
                                <div className="bi-card-header">
                                  <span className="bi-icon">📄</span>
                                  <span className="bi-label">Contract Status</span>
                                </div>
                                <div className="bi-card-value">{activeContracts} Active</div>
                                <div className="bi-card-subtitle">{completedContracts} Completed</div>
                              </div>

                              <div className="bi-card activity">
                                <div className="bi-card-header">
                                  <span className="bi-icon">⚡</span>
                                  <span className="bi-label">Activity Level</span>
                                </div>
                                <div className="bi-card-value">{avgEntriesPerDay.toFixed(1)}</div>
                                <div className="bi-card-subtitle">Entries/Day</div>
                                <div className="sparkline">
                                  {[0.3, 0.5, 0.8, 0.6, 0.9, 0.7, 1.0].map((height, index) => (
                                    <div
                                      key={index}
                                      className={`sparkline-bar ${avgEntriesPerDay > 3 ? 'positive' : 'negative'}`}
                                      style={{height: `${height * 100}%`}}
                                    ></div>
                                  ))}
                                </div>
                              </div>

                              <div className="bi-card completion">
                                <div className="bi-card-header">
                                  <span className="bi-icon">✅</span>
                                  <span className="bi-label">Completion Rate</span>
                                </div>
                                <div className="bi-card-value">{contractCompletionRate.toFixed(1)}%</div>
                                <div className="bi-card-subtitle">Contracts Done</div>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Key Insights */}
                    <div className="bi-section insights">
                      <h3>🔍 Key Insights</h3>
                      <div className="insights-grid">
                        {(() => {
                          const insights = [];
                          const netProfit = totalRevenue - (totalExpenses + totalLaborCost);
                          const hoursUtilization = totalAssignedHours > 0 ? (totalActualHours / totalAssignedHours) * 100 : 0;

                          if (netProfit > 0) {
                            insights.push({
                              type: 'positive',
                              icon: '💰',
                              title: 'Profitable Project',
                              description: `Generating $${netProfit.toFixed(2)} in profit`
                            });
                          } else if (netProfit < 0) {
                            insights.push({
                              type: 'negative',
                              icon: '⚠️',
                              title: 'Loss-Making Project',
                              description: `Currently at $${Math.abs(netProfit).toFixed(2)} loss`
                            });
                          }

                          if (hoursUtilization > 110) {
                            insights.push({
                              type: 'warning',
                              icon: '⏰',
                              title: 'Over Budget Hours',
                              description: `${(hoursUtilization - 100).toFixed(1)}% over allocated hours`
                            });
                          } else if (hoursUtilization < 80 && totalAssignedHours > 0) {
                            insights.push({
                              type: 'info',
                              icon: '📉',
                              title: 'Underutilized Hours',
                              description: `${(100 - hoursUtilization).toFixed(1)}% of budget remaining`
                            });
                          }

                          if (avgEntriesPerDay > 5) {
                            insights.push({
                              type: 'positive',
                              icon: '⚡',
                              title: 'High Activity',
                              description: `${avgEntriesPerDay.toFixed(1)} entries per day`
                            });
                          }

                          if (contractCompletionRate === 100 && totalContracts > 0) {
                            insights.push({
                              type: 'positive',
                              icon: '🎉',
                              title: 'All Contracts Complete',
                              description: 'Project fully delivered'
                            });
                          }

                          return insights.length > 0 ? insights.map((insight, index) => (
                            <div key={index} className={`insight-card ${insight.type}`}>
                              <div className="insight-icon">{insight.icon}</div>
                              <div className="insight-content">
                                <h4>{insight.title}</h4>
                                <p>{insight.description}</p>
                              </div>
                            </div>
                          )) : (
                            <div className="no-insights">
                              <p>📊 Analyzing project data...</p>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>

            <div className="project-stats">
                <div className="stat-line">
                  <span className="stat-label">Total Time Entries:</span>
                  <span className="stat-value">{projectTimeEntries.length}</span>
                </div>
                <div className="stat-line">
                  <span className="stat-label">Total Hours:</span>
                  <span className="stat-value">{Object.values(projectCostCodeStats).reduce((sum, stat) => sum + stat.totalHours, 0).toFixed(2)}h</span>
                </div>
                <div className="stat-line">
                  <span className="stat-label">Total Expenses:</span>
                  <span className="stat-value">${expenses.filter(expense => expense.projectId === selectedProject.id).reduce((sum, expense) => sum + (expense.amount || 0), 0).toFixed(2)}</span>
                </div>
                <div className="stat-line">
                  <span className="stat-label">Total Contracts:</span>
                  <span className="stat-value">${(() => {
                    const total = projectContracts.reduce((sum, contract) => sum + (contract.totalAmount || contract.contractValue || contract.amount || 0), 0);
                    console.log('Contract total calculation:', { projectContracts: projectContracts.length, total });
                    return total.toFixed(2);
                  })()}</span>
                </div>
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
                      <div className="project-assigned-stats">
                        <span>Assigned Hours: {selectedProject.costCodeAssignments.reduce((sum, assignment) => sum + parseFloat(assignment.hours || 0), 0).toFixed(2)}</span>
                        <span>Assigned Cost: ${selectedProject.costCodeAssignments.reduce((sum, assignment) => {
                          const costCode = costCodes.find(cc => cc.id === assignment.costCodeId);
                          return sum + (parseFloat(assignment.hours || 0) * (costCode?.costPerHour ? parseFloat(costCode.costPerHour) : 0));
                        }, 0).toFixed(2)}</span>
                      </div>
                    ) : (
                      <span>No assigned hours (add cost code assignments to this project)</span>
                    );
                  })()}
              </div>
            <button 
              className="back-btn"
              onClick={() => {
                setSelectedProject(null);
                setProjectTimeEntries([]);
                setProjectCostCodeStats({});
                setProjectContracts([]);
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
                              {editingCostCodeAssignment === assignment.costCodeId ? (
                                <div className="edit-assignment-group">
                                  <input
                                    type="number"
                                    step="0.25"
                                    min="0"
                                    value={editCostCodeAssignmentData.hours}
                                    onChange={(e) => setEditCostCodeAssignmentData(prev => ({
                                      ...prev,
                                      hours: e.target.value
                                    }))}
                                    className="edit-hours-input"
                                    placeholder="0.00"
                                  />
                                  <span className="stat-unit">h</span>
                                  <div className="edit-buttons">
                                    <button 
                                      className="save-edit-btn"
                                      onClick={saveEditedCostCodeAssignment}
                                    >
                                      Save
                                    </button>
                                    <button 
                                      className="cancel-edit-btn"
                                      onClick={cancelEditingCostCodeAssignment}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <span className="stat-value">{assignment.hours || '0'}h</span>
                                  {costCode?.costPerHour && (
                                    <span className="stat-cost">${(parseFloat(assignment.hours || 0) * parseFloat(costCode.costPerHour)).toFixed(2)}</span>
                                  )}
                                </>
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
                        <div className="cost-code-actions">
                          {editingCostCodeAssignment !== assignment.costCodeId && (
                            <button 
                              className="edit-btn"
                              onClick={() => {
                                console.log('Edit button clicked for assignment:', assignment);
                                startEditingCostCodeAssignment(assignment);
                              }}
                            >
                              Edit
                            </button>
                          )}
                          <button 
                            className="remove-btn"
                            onClick={() => {
                              console.log('Remove button clicked for costCodeId:', assignment.costCodeId);
                              removeCostCodeFromProject(assignment.costCodeId);
                            }}
                          >
                            Remove
                          </button>
                        </div>
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
                      <div key={costCode.id} className="cost-code-assignment-item">
                        {assigningCostCode === costCode.id ? (
                          <div className="assignment-form">
                            <div className="assignment-form-header">
                              <span className="cost-code-info">
                                {costCode.code} - {costCode.description}
                                {costCode.costPerHour && ` (${costCode.costPerHour}/hr)`}
                              </span>
                            </div>
                            <div className="assignment-form-body">
                              <div className="hours-input-group">
                                <label>Assigned Hours:</label>
                                <input
                                  type="number"
                                  step="0.25"
                                  min="0"
                                  value={assignmentHours}
                                  onChange={(e) => setAssignmentHours(e.target.value)}
                                  placeholder="0.00"
                                  className="assignment-hours-input"
                                  autoFocus
                                />
                                <span className="hours-unit">h</span>
                              </div>
                              <div className="assignment-form-actions">
                                <button 
                                  className="confirm-assign-btn"
                                  onClick={confirmAssignCostCode}
                                >
                                  Assign
                                </button>
                                <button 
                                  className="cancel-assign-btn"
                                  onClick={cancelAssigningCostCode}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <button
                            className="assign-cost-code-btn"
                            onClick={() => startAssigningCostCode(costCode.id)}
                          >
                            + {costCode.code} - {costCode.description}
                            {costCode.costPerHour && ` (${costCode.costPerHour}/hr)`}
                          </button>
                        )}
                      </div>
                    ))}
                  {costCodes.filter(cc => !selectedProject.costCodeAssignments?.some(assignment => assignment.costCodeId === cc.id)).length === 0 && (
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
                        <span className="entry-duration">{entry.duration ? (entry.duration / 3600).toFixed(2) + 'h' : '0.00h'}</span>
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

            {/* Expense Breakdown Section */}
            <div className="section">
              <h3>Expense Breakdown</h3>
              
              {/* Expense Breakdown by Category */}
              <div className="expense-breakdown">
                <h4>By Category</h4>
                {(() => {
                  const projectExpenses = expenses.filter(expense => expense.projectId === selectedProject.id);
                  const expensesByCategory = {};
                  
                  projectExpenses.forEach(expense => {
                    const categoryName = expenseCategories.find(cat => cat.id === expense.categoryId)?.name || 'Uncategorized';
                    if (!expensesByCategory[categoryName]) {
                      expensesByCategory[categoryName] = { total: 0, count: 0 };
                    }
                    expensesByCategory[categoryName].total += expense.amount || 0;
                    expensesByCategory[categoryName].count += 1;
                  });
                  
                  const sortedCategories = Object.entries(expensesByCategory)
                    .sort(([,a], [,b]) => b.total - a.total);
                  
                  return sortedCategories.length > 0 ? (
                    <div className="breakdown-table">
                      <div className="breakdown-header">
                        <span className="breakdown-label">Category</span>
                        <span className="breakdown-count">Count</span>
                        <span className="breakdown-amount">Total Amount</span>
                      </div>
                      {sortedCategories.map(([category, data]) => (
                        <div key={category} className="breakdown-row">
                          <span className="breakdown-label">{category}</span>
                          <span className="breakdown-count">{data.count}</span>
                          <span className="breakdown-amount">${data.total.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p>No expenses found for this project.</p>
                  );
                })()}
              </div>
              
              {/* Expense Breakdown by Cost Code */}
              <div className="expense-breakdown">
                <h4>By Cost Code</h4>
                {(() => {
                  const projectExpenses = expenses.filter(expense => expense.projectId === selectedProject.id);
                  const expensesByCostCode = {};
                  
                  projectExpenses.forEach(expense => {
                    const costCodeName = costCodes.find(cc => cc.id === expense.costCodeId)?.code || 'No Cost Code';
                    if (!expensesByCostCode[costCodeName]) {
                      expensesByCostCode[costCodeName] = { total: 0, count: 0 };
                    }
                    expensesByCostCode[costCodeName].total += expense.amount || 0;
                    expensesByCostCode[costCodeName].count += 1;
                  });
                  
                  const sortedCostCodes = Object.entries(expensesByCostCode)
                    .sort(([,a], [,b]) => b.total - a.total);
                  
                  return sortedCostCodes.length > 0 ? (
                    <div className="breakdown-table">
                      <div className="breakdown-header">
                        <span className="breakdown-label">Cost Code</span>
                        <span className="breakdown-count">Count</span>
                        <span className="breakdown-amount">Total Amount</span>
                      </div>
                      {sortedCostCodes.map(([costCode, data]) => (
                        <div key={costCode} className="breakdown-row">
                          <span className="breakdown-label">{costCode}</span>
                          <span className="breakdown-count">{data.count}</span>
                          <span className="breakdown-amount">${data.total.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p>No expenses with cost codes found for this project.</p>
                  );
                })()}
              </div>
              
              {/* Total Hours by Cost Code */}
              <div className="expense-breakdown">
                <h4>Total Hours by Cost Code</h4>
                {(() => {
                  const sortedCostCodeStats = Object.entries(projectCostCodeStats)
                    .sort(([,a], [,b]) => b.totalHours - a.totalHours);
                  
                  return sortedCostCodeStats.length > 0 ? (
                    <div className="breakdown-table">
                      <div className="breakdown-header">
                        <span className="breakdown-label">Cost Code</span>
                        <span className="breakdown-hours">Total Hours</span>
                        <span className="breakdown-entries">Entries</span>
                        <span className="breakdown-cost">Cost</span>
                      </div>
                      {sortedCostCodeStats.map(([costCode, stats]) => {
                        const costCodeData = costCodes.find(cc => cc.code === costCode);
                        const cost = costCodeData?.costPerHour ? (stats.totalHours * parseFloat(costCodeData.costPerHour)) : 0;
                        
                        return (
                          <div key={costCode} className="breakdown-row">
                            <span className="breakdown-label">{costCode}</span>
                            <span className="breakdown-hours">{stats.totalHours.toFixed(2)}h</span>
                            <span className="breakdown-entries">{stats.totalEntries}</span>
                            <span className="breakdown-cost">${cost.toFixed(2)}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p>No time entries found for this project.</p>
                  );
                })()}
              </div>
            </div>

            {/* Contracts Section */}
            <div className="section">
              <h3>Project Contracts</h3>
              
              {projectContracts.length > 0 ? (
                <div className="contracts-list">
                  {projectContracts.map(contract => (
                    <div key={contract.id} className="contract-item">
                      <div className="contract-info">
                        <h4>{contract.name || 'Unnamed Contract'}</h4>
                        <div className="contract-details">
                          <span className="contract-status" data-status={contract.status || 'estimating'}>
                            {contract.status || 'estimating'}
                          </span>
                          <span className="contract-value">
                            ${(contract.totalAmount || contract.contractValue || contract.amount || 0).toFixed(2)}
                          </span>
                        </div>
                        {contract.description && (
                          <p className="contract-description">{contract.description}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p>No contracts found for this project.</p>
              )}
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
                    status: 'started',
                    forecastedHours: 0
                  });
                }}
              >
                ×
              </button>
            </div>
            
            <form onSubmit={saveTask} className="task-form">
              <div className="form-group">
                <label>Task Title *</label>
                <input
                  type="text"
                  value={newTask.title}
                  onChange={(e) => setNewTask({...newTask, title: e.target.value})}
                  required
                  placeholder="Enter task title"
                />
              </div>
              
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={newTask.description}
                  onChange={(e) => setNewTask({...newTask, description: e.target.value})}
                  rows="3"
                  placeholder="Enter task description (optional)"
                />
              </div>
              
              <div className="form-row">
                <div className="form-group">
                  <label>Forecasted Hours</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={newTask.forecastedHours}
                    onChange={(e) => setNewTask({...newTask, forecastedHours: parseFloat(e.target.value) || 0})}
                    placeholder="0.0"
                  />
                </div>
                
                <div className="form-group">
                  <label>Status</label>
                  <select
                    value={newTask.status}
                    onChange={(e) => setNewTask({...newTask, status: e.target.value})}
                  >
                    <option value="started">Started</option>
                    <option value="in-progress">In Progress</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
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

              <div className="form-group">
                <label>Assigned Users</label>
                <div className="user-assignment-section">
                  <div className="current-assigned-users">
                    <h5>Assigned Users</h5>
                    {newProject.assignedUsers && newProject.assignedUsers.length > 0 ? (
                      <div className="assigned-users-list">
                        {newProject.assignedUsers.map(userId => {
                          const user = users.find(u => u.id === userId);
                          return (
                            <div key={userId} className="assigned-user-item">
                              <span className="user-name">
                                {user ? (user.name && user.lastName ? `${user.name} ${user.lastName}` : user.name || user.email) : 'Unknown User'}
                              </span>
                              <button
                                type="button"
                                className="remove-user-btn"
                                onClick={() => removeAssignedUser(userId)}
                              >
                                ×
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p>No users assigned yet.</p>
                    )}
                  </div>

                  <div className="add-user-assignment">
                    <h5>Add User</h5>
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) {
                          addAssignedUser(e.target.value);
                          e.target.value = ''; // Reset select
                        }
                      }}
                    >
                      <option value="">Select User to Assign</option>
                      {users
                        .filter(user => !newProject.assignedUsers?.includes(user.id))
                        .map(user => (
                          <option key={user.id} value={user.id}>
                            {user.name && user.lastName ? `${user.name} ${user.lastName}` : user.name || user.email}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
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
                    areaOfFocusIds: []
                  });
                }}
              >
                ×
              </button>
            </div>
            
            <form onSubmit={saveCostCode} className="cost-code-form">
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <label>Area of Focus *</label>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCostCodeModal(false);
                      setShowAreaOfFocusModal(true);
                    }}
                    style={{
                      background: '#667eea',
                      color: 'white',
                      border: 'none',
                      padding: '4px 12px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      fontWeight: '500'
                    }}
                  >
                    + Quick Add
                  </button>
                </div>
                {!editingCostCode && newCostCode.areaOfFocusIds.length > 1 && (
                  <div style={{
                    backgroundColor: '#fef3c7',
                    border: '1px solid #fbbf24',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    marginBottom: '8px',
                    fontSize: '0.85rem',
                    color: '#92400e'
                  }}>
                    ℹ️ Selecting multiple areas will create <strong>{newCostCode.areaOfFocusIds.length} separate cost codes</strong> (one for each area)
                  </div>
                )}
                <div style={{
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  padding: '8px',
                  maxHeight: '200px',
                  overflowY: 'auto',
                  backgroundColor: '#f9fafb'
                }}>
                  {areasOfFocus.length === 0 ? (
                    <div style={{ padding: '12px', textAlign: 'center', color: '#6b7280' }}>
                      No areas of focus available. 
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
                    </div>
                  ) : editingCostCode ? (
                    // When editing, only show areas that don't already have this cost code
                    <div>
                      <select
                        value={newCostCode.areaOfFocusIds[0] || ''}
                        onChange={(e) => {
                          const selectedAreaId = e.target.value;
                          if (!selectedAreaId) {
                            setNewCostCode({
                              ...newCostCode,
                              areaOfFocusIds: []
                            });
                            return;
                          }
                          
                          // Check if another cost code already exists with the same code and this area
                          const existingCostCode = costCodes.find(cc => 
                            cc.code === editingCostCode.code && 
                            cc.id !== editingCostCode.id &&
                            (cc.areaOfFocusId === selectedAreaId || cc.areaOfFocusIds?.includes(selectedAreaId))
                          );
                          
                          if (existingCostCode) {
                            toast.error(`A cost code "${editingCostCode.code}" already exists for this area. Use duplicate instead to create a new one.`);
                            return;
                          }
                          
                          setNewCostCode({
                            ...newCostCode,
                            areaOfFocusIds: [selectedAreaId]
                          });
                        }}
                        style={{
                          width: '100%',
                          padding: '8px',
                          border: '1px solid #d1d5db',
                          borderRadius: '4px',
                          backgroundColor: 'white'
                        }}
                        required
                      >
                        <option value="">Select Area of Focus</option>
                        {areasOfFocus.map(area => {
                          // Check if this area already has this cost code
                          const hasExistingCostCode = costCodes.some(cc => 
                            cc.code === editingCostCode.code && 
                            cc.id !== editingCostCode.id &&
                            (cc.areaOfFocusId === area.id || cc.areaOfFocusIds?.includes(area.id))
                          );
                          
                          return (
                            <option 
                              key={area.id} 
                              value={area.id}
                              disabled={hasExistingCostCode}
                            >
                              {area.name} {hasExistingCostCode ? '(Already exists)' : ''}
                            </option>
                          );
                        })}
                      </select>
                      <small style={{ color: '#6b7280', marginTop: '4px', display: 'block', fontSize: '0.85rem' }}>
                        💡 To add this cost code to areas that already have it, use the "Duplicate" button instead
                      </small>
                    </div>
                  ) : (
                    // When creating new, show as checkboxes (multi-selection)
                    areasOfFocus.map(area => (
                      <label
                        key={area.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          padding: '8px',
                          cursor: 'pointer',
                          borderRadius: '4px',
                          marginBottom: '4px',
                          backgroundColor: newCostCode.areaOfFocusIds.includes(area.id) ? '#e0e7ff' : 'white',
                          border: newCostCode.areaOfFocusIds.includes(area.id) ? '2px solid #667eea' : '1px solid #e5e7eb',
                          transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => {
                          if (!newCostCode.areaOfFocusIds.includes(area.id)) {
                            e.currentTarget.style.backgroundColor = '#f3f4f6';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!newCostCode.areaOfFocusIds.includes(area.id)) {
                            e.currentTarget.style.backgroundColor = 'white';
                          }
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={newCostCode.areaOfFocusIds.includes(area.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setNewCostCode({
                                ...newCostCode,
                                areaOfFocusIds: [...newCostCode.areaOfFocusIds, area.id]
                              });
                            } else {
                              setNewCostCode({
                                ...newCostCode,
                                areaOfFocusIds: newCostCode.areaOfFocusIds.filter(id => id !== area.id)
                              });
                            }
                          }}
                          style={{ marginRight: '8px', cursor: 'pointer' }}
                        />
                        <span style={{ fontWeight: newCostCode.areaOfFocusIds.includes(area.id) ? '600' : '400' }}>
                          {area.name}
                        </span>
                      </label>
                    ))
                  )}
                </div>
                {!editingCostCode && newCostCode.areaOfFocusIds.length > 0 && (
                  <small style={{ color: '#667eea', marginTop: '4px', display: 'block' }}>
                    {newCostCode.areaOfFocusIds.length} area(s) selected → {newCostCode.areaOfFocusIds.length} cost code(s) will be created
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
            
            {/* Separate card for adding to additional areas when editing */}
            {editingCostCode && areasOfFocus.filter(area => area.id !== newCostCode.areaOfFocusIds[0]).length > 0 && (
              <div style={{
                marginTop: '20px',
                padding: '16px',
                backgroundColor: '#f0f9ff',
                border: '2px solid #38bdf8',
                borderRadius: '8px'
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '12px'
                }}>
                  <span style={{ fontSize: '1.2rem' }}>➕</span>
                  <h4 style={{ margin: 0, color: '#0369a1', fontSize: '1rem' }}>
                    Add This Cost Code to Additional Areas
                  </h4>
                </div>
                
                <p style={{ 
                  fontSize: '0.85rem', 
                  color: '#0c4a6e', 
                  marginBottom: '12px',
                  lineHeight: '1.4'
                }}>
                  Select additional areas where you want to use this same cost code. A separate cost code will be created for each area with identical details.
                </p>
                
                <div style={{
                  maxHeight: '180px',
                  overflowY: 'auto',
                  border: '1px solid #bae6fd',
                  borderRadius: '6px',
                  padding: '8px',
                  backgroundColor: 'white'
                }}>
                  {areasOfFocus
                    .filter(area => area.id !== newCostCode.areaOfFocusIds[0])
                    .map(area => (
                      <label
                        key={area.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          padding: '8px',
                          cursor: 'pointer',
                          borderRadius: '4px',
                          marginBottom: '6px',
                          backgroundColor: newCostCode.areaOfFocusIds.includes(area.id) ? '#dbeafe' : 'white',
                          border: newCostCode.areaOfFocusIds.includes(area.id) ? '2px solid #0ea5e9' : '1px solid #e5e7eb',
                          transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => {
                          if (!newCostCode.areaOfFocusIds.includes(area.id)) {
                            e.currentTarget.style.backgroundColor = '#f0f9ff';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!newCostCode.areaOfFocusIds.includes(area.id)) {
                            e.currentTarget.style.backgroundColor = 'white';
                          }
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={newCostCode.areaOfFocusIds.includes(area.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setNewCostCode({
                                ...newCostCode,
                                areaOfFocusIds: [...newCostCode.areaOfFocusIds, area.id]
                              });
                            } else {
                              setNewCostCode({
                                ...newCostCode,
                                areaOfFocusIds: newCostCode.areaOfFocusIds.filter(id => id !== area.id)
                              });
                            }
                          }}
                          style={{ marginRight: '10px', cursor: 'pointer', width: '16px', height: '16px' }}
                        />
                        <span style={{ 
                          fontWeight: newCostCode.areaOfFocusIds.includes(area.id) ? '600' : '400',
                          color: newCostCode.areaOfFocusIds.includes(area.id) ? '#0369a1' : '#374151'
                        }}>
                          {area.name}
                        </span>
                      </label>
                    ))}
                </div>
                
                {newCostCode.areaOfFocusIds.length > 1 && (
                  <div style={{
                    backgroundColor: '#fef3c7',
                    border: '1px solid #fbbf24',
                    borderRadius: '6px',
                    padding: '10px 12px',
                    marginTop: '12px',
                    fontSize: '0.85rem',
                    color: '#92400e',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <span style={{ fontSize: '1.1rem' }}>ℹ️</span>
                    <span>
                      <strong>{newCostCode.areaOfFocusIds.length - 1} new cost code{newCostCode.areaOfFocusIds.length - 1 > 1 ? 's' : ''}</strong> will be created with the same code, description, category, and rate
                    </span>
                  </div>
                )}
              </div>
            )}
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

      {/* Expense Modal */}
      {showExpenseModal && (
        <div className="modal-overlay" onClick={() => setShowExpenseModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingExpense ? 'Edit Expense' : 'Add New Expense'}</h2>
              <button className="close-btn" onClick={() => setShowExpenseModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Title *</label>
                <input
                  type="text"
                  value={newExpense.title}
                  onChange={(e) => setNewExpense(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="Expense title"
                  required
                />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={newExpense.description}
                  onChange={(e) => setNewExpense(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Expense description"
                  rows="3"
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Amount *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={newExpense.amount}
                    onChange={(e) => setNewExpense(prev => ({ ...prev, amount: e.target.value }))}
                    placeholder="0.00"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Date *</label>
                  <input
                    type="date"
                    value={newExpense.date}
                    onChange={(e) => setNewExpense(prev => ({ ...prev, date: e.target.value }))}
                    required
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Category</label>
                  <select
                    value={newExpense.categoryId}
                    onChange={(e) => setNewExpense(prev => ({ ...prev, categoryId: e.target.value }))}
                  >
                    <option value="">Select Category</option>
                    {expenseCategories.map(category => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Project *</label>
                  <select
                    value={newExpense.projectId}
                    onChange={(e) => setNewExpense(prev => ({ ...prev, projectId: e.target.value }))}
                    required
                  >
                    <option value="">Select Project</option>
                    {projects.map(project => (
                      <option key={project.id} value={project.id}>{project.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Cost Code</label>
                  <select
                    value={newExpense.costCodeId}
                    onChange={(e) => setNewExpense(prev => ({ ...prev, costCodeId: e.target.value }))}
                  >
                    <option value="">Select Cost Code</option>
                    {costCodes.map(costCode => (
                      <option key={costCode.id} value={costCode.id}>{costCode.code} - {costCode.description}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Vendor</label>
                <input
                  type="text"
                  value={newExpense.vendor}
                  onChange={(e) => setNewExpense(prev => ({ ...prev, vendor: e.target.value }))}
                  placeholder="Vendor name"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowExpenseModal(false)}>Cancel</button>
              <button 
                className="save-btn" 
                onClick={saveExpense}
                disabled={!newExpense.title || !newExpense.amount || !newExpense.date || !newExpense.projectId}
              >
                {editingExpense ? 'Update' : 'Save'} Expense
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Expense Category Modal */}
      {showExpenseCategoryModal && (
        <div className="modal-overlay" onClick={() => setShowExpenseCategoryModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingExpenseCategory ? 'Edit Category' : 'Add New Category'}</h2>
              <button className="close-btn" onClick={() => setShowExpenseCategoryModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Name *</label>
                <input
                  type="text"
                  value={newExpenseCategory.name}
                  onChange={(e) => setNewExpenseCategory(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Category name"
                  required
                />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={newExpenseCategory.description}
                  onChange={(e) => setNewExpenseCategory(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Category description"
                  rows="2"
                />
              </div>
              <div className="form-group">
                <label>Color</label>
                <input
                  type="color"
                  value={newExpenseCategory.color}
                  onChange={(e) => setNewExpenseCategory(prev => ({ ...prev, color: e.target.value }))}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowExpenseCategoryModal(false)}>Cancel</button>
              <button 
                className="save-btn" 
                onClick={saveExpenseCategory}
                disabled={!newExpenseCategory.name}
              >
                {editingExpenseCategory ? 'Update' : 'Save'} Category
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Contract Modal */}
      {showContractModal && (
        <div className="modal-overlay" onClick={() => setShowContractModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingContract ? 'Edit Contract' : 'Add New Contract'}</h2>
              <button className="close-btn" onClick={() => setShowContractModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Contract Name *</label>
                <input
                  type="text"
                  value={newContract.name}
                  onChange={(e) => setNewContract(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Enter contract name"
                  required
                />
              </div>

              <div className="form-group">
                <label>Contract Number</label>
                <input
                  type="text"
                  value={newContract.contractNumber}
                  onChange={(e) => setNewContract(prev => ({ ...prev, contractNumber: e.target.value }))}
                  placeholder="Enter contract number"
                />
              </div>

              <div className="form-group">
                <label>Client Name *</label>
                <input
                  type="text"
                  value={newContract.clientName}
                  onChange={(e) => setNewContract(prev => ({ ...prev, clientName: e.target.value }))}
                  placeholder="Enter client name"
                  required
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Status *</label>
                  <select
                    value={newContract.status}
                    onChange={(e) => setNewContract(prev => ({ ...prev, status: e.target.value }))}
                    required
                  >
                    <option value="estimating">Estimating</option>
                    <option value="awarded">Awarded</option>
                    <option value="in-progress">In Progress</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Contract Value *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={newContract.totalAmount}
                    onChange={(e) => setNewContract(prev => ({ ...prev, totalAmount: e.target.value }))}
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Start Date</label>
                  <input
                    type="date"
                    value={newContract.startDate}
                    onChange={(e) => setNewContract(prev => ({ ...prev, startDate: e.target.value }))}
                  />
                </div>

                <div className="form-group">
                  <label>End Date</label>
                  <input
                    type="date"
                    value={newContract.endDate}
                    onChange={(e) => setNewContract(prev => ({ ...prev, endDate: e.target.value }))}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Associated Project</label>
                <select
                  value={newContract.projectId}
                  onChange={(e) => setNewContract(prev => ({ ...prev, projectId: e.target.value }))}
                >
                  <option value="">Select Project (Optional)</option>
                  {projects.map(project => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={newContract.description}
                  onChange={(e) => setNewContract(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Enter contract description"
                  rows="3"
                />
              </div>

              <div className="form-group">
                <label>Notes</label>
                <textarea
                  value={newContract.notes}
                  onChange={(e) => setNewContract(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Additional notes"
                  rows="2"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={newContract.featured}
                      onChange={(e) => setNewContract(prev => ({ ...prev, featured: e.target.checked }))}
                    />
                    Featured Contract
                  </label>
                </div>

                <div className="form-group">
                  <label>Brand</label>
                  <select
                    value={newContract.brand}
                    onChange={(e) => setNewContract(prev => ({ ...prev, brand: e.target.value }))}
                  >
                    <option value="">Select Brand (Optional)</option>
                    {brands.map(brand => (
                      <option key={brand.id} value={brand.name}>{brand.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowContractModal(false)}>Cancel</button>
              <button
                className="save-btn"
                onClick={saveContract}
                disabled={!newContract.name || !newContract.clientName || !newContract.totalAmount || !newContract.status}
              >
                {editingContract ? 'Update' : 'Save'} Contract
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Comments Modal */}
      {showCommentsModal && selectedContractForComments && (
        <div className="modal-overlay" onClick={closeCommentsModal}>
          <div className="modal-content comments-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Comments for {selectedContractForComments.name}</h2>
              <button className="close-btn" onClick={closeCommentsModal}>×</button>
            </div>

            <div className="modal-body">
              {/* Add Comment Section */}
              <div className="add-comment-section">
                <h3>Add Comment</h3>
                <textarea
                  value={editingComment ? editingComment.text : newComment}
                  onChange={(e) => editingComment
                    ? setEditingComment({...editingComment, text: e.target.value})
                    : setNewComment(e.target.value)
                  }
                  placeholder="Enter your comment..."
                  rows="3"
                />
                <div className="comment-actions">
                  {editingComment ? (
                    <>
                      <button
                        className="save-btn"
                        onClick={updateComment}
                        disabled={!editingComment.text.trim()}
                      >
                        Update Comment
                      </button>
                      <button
                        className="cancel-btn"
                        onClick={cancelEditingComment}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="save-btn"
                      onClick={addComment}
                      disabled={!newComment.trim()}
                    >
                      Add Comment
                    </button>
                  )}
                </div>
              </div>

              {/* Comments List */}
              <div className="comments-list">
                <h3>Comments ({selectedContractForComments.comments?.length || 0})</h3>
                {selectedContractForComments.comments && selectedContractForComments.comments.length > 0 ? (
                  selectedContractForComments.comments
                    .sort((a, b) => new Date(b.createdAt.seconds ? b.createdAt.seconds * 1000 : b.createdAt) - new Date(a.createdAt.seconds ? a.createdAt.seconds * 1000 : a.createdAt))
                    .map(comment => (
                      <div key={comment.id} className="comment-item">
                        <div className="comment-header">
                          <span className="comment-author">{comment.createdBy}</span>
                          <span className="comment-date">
                            {new Date(comment.createdAt.seconds ? comment.createdAt.seconds * 1000 : comment.createdAt).toLocaleString()}
                          </span>
                          <div className="comment-actions">
                            <button
                              className="edit-comment-btn"
                              onClick={() => startEditingComment(comment)}
                            >
                              ✏️
                            </button>
                            <button
                              className="delete-comment-btn"
                              onClick={() => deleteComment(comment.id)}
                            >
                              🗑️
                            </button>
                          </div>
                        </div>
                        <div className="comment-text">
                          {comment.text}
                        </div>
                      </div>
                    ))
                ) : (
                  <p className="no-comments">No comments yet. Be the first to add one!</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default TimeTracker;
