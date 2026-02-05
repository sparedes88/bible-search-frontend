import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db, storage, auth } from '../firebase';
import {
  collection,
  addDoc,
  updateDoc,
  doc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  arrayUnion
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { signOut } from 'firebase/auth';
import { toast } from 'react-toastify';
import { canAccessModule } from '../utils/permissions';
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

const formatTimeDisplay = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (isNaN(date.getTime())) return '-';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatDateMDY = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric'
  });
};

const isImageAttachment = (attachment) => {
  const type = attachment?.contentType || '';
  return type.startsWith('image/');
};

const getTodayDateString = () => {
  const now = new Date();
  return now.toISOString().slice(0, 10);
};

const TimerPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const churchId = id;

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

  // Time Tracking State
  const [isTracking, setIsTracking] = useState(false);
  const [currentSession, setCurrentSession] = useState(null);
  const [currentProject, setCurrentProject] = useState('');
  const [currentAreaOfFocus, setCurrentAreaOfFocus] = useState('');
  const [currentCostCode, setCurrentCostCode] = useState('');
  const [elapsedTime, setElapsedTime] = useState(0);
  const [currentNote, setCurrentNote] = useState('');
  const [newNote, setNewNote] = useState('');
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  // Data State
  const [projects, setProjects] = useState([]);
  const [areasOfFocus, setAreasOfFocus] = useState([]);
  const [costCodes, setCostCodes] = useState([]);
  const [todayEntries, setTodayEntries] = useState([]);

  // Permissions State
  const [hasTimeTrackerAccess, setHasTimeTrackerAccess] = useState(false);
  const [loadingPermissions, setLoadingPermissions] = useState(true);

  // Tab switch detection
  const [tabSwitchTimeout, setTabSwitchTimeout] = useState(null);

  // Load permissions
  useEffect(() => {
    const checkPermissions = async () => {
      if (user && churchId) {
        try {
          const hasAccess = await canAccessModule(user, churchId, 'timetracker');
          setHasTimeTrackerAccess(hasAccess);
        } catch (error) {
          console.error('Error checking permissions:', error);
        }
      }
      setLoadingPermissions(false);
    };

    checkPermissions();
  }, [user, churchId]);

  // Load projects, areas of focus, and cost codes
  useEffect(() => {
    if (!churchId || !hasTimeTrackerAccess) return;

    const loadData = async () => {
      try {
        // Load projects
        const projectsQuery = query(collection(db, `churches/${churchId}/projects`));
        const projectsUnsubscribe = onSnapshot(projectsQuery, (snapshot) => {
          const projectsData = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
          setProjects(projectsData);
        });

        // Load areas of focus
        const areasQuery = query(collection(db, `churches/${churchId}/areasOfFocus`));
        const areasUnsubscribe = onSnapshot(areasQuery, (snapshot) => {
          const areasData = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
          setAreasOfFocus(areasData);
        });

        // Load cost codes
        const costCodesQuery = query(collection(db, `churches/${churchId}/costCodes`));
        const costCodesUnsubscribe = onSnapshot(costCodesQuery, (snapshot) => {
          const costCodesData = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
          setCostCodes(costCodesData);
        });

        return () => {
          projectsUnsubscribe();
          areasUnsubscribe();
          costCodesUnsubscribe();
        };
      } catch (error) {
        console.error('Error loading data:', error);
        toast.error('Failed to load data');
      }
    };

    loadData();
  }, [churchId, hasTimeTrackerAccess]);

  // Load today's time entries for current user
  useEffect(() => {
    if (!churchId || !hasTimeTrackerAccess || !user?.uid) return;

    const today = getTodayDateString();
    const entriesQuery = query(
      collection(db, `churches/${churchId}/timeEntries`),
      where('userId', '==', user.uid),
      where('date', '==', today)
    );

    const unsubscribe = onSnapshot(
      entriesQuery,
      (snapshot) => {
        const entries = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));

        entries.sort((a, b) => {
          const aTime = a.startTime ? new Date(a.startTime).getTime() : 0;
          const bTime = b.startTime ? new Date(b.startTime).getTime() : 0;
          return bTime - aTime;
        });

        setTodayEntries(entries);
      },
      (error) => {
        console.error('Error loading today entries:', error);
      }
    );

    return () => unsubscribe();
  }, [churchId, hasTimeTrackerAccess, user?.uid]);

  // Timer update effect
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
      if (interval) clearInterval(interval);
    };
  }, [isTracking, currentSession]);

  // Tab switch detection
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && isTracking) {
        // Tab is hidden, start timeout to stop tracking
        const timeout = setTimeout(() => {
          if (document.hidden) {
            stopTracking();
            toast.warning('Time tracking stopped due to tab switch');
          }
        }, 30000); // 30 seconds
        setTabSwitchTimeout(timeout);
      } else {
        // Tab is visible again, clear timeout
        if (tabSwitchTimeout) {
          clearTimeout(tabSwitchTimeout);
          setTabSwitchTimeout(null);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (tabSwitchTimeout) {
        clearTimeout(tabSwitchTimeout);
      }
    };
  }, [isTracking, tabSwitchTimeout]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Stop any running timers on component unmount
      if (isTracking) {
        setIsTracking(false);
        setCurrentSession(null);
        setElapsedTime(0);
      }
    };
  }, [isTracking]);

  // Start time tracking
  const startTracking = async () => {
    if (!currentProject || !currentAreaOfFocus || !currentCostCode) {
      toast.error('Please select a project, area of focus, and cost code before starting the timer');
      return;
    }

    try {
      // Reset note state for a new session
      setCurrentNote('');
      setNewNote('');

      const startTime = new Date();
      const session = {
        userId: user.uid,
        churchId,
        startTime: startTime.toISOString(),
        date: startTime.toISOString().split('T')[0],
        note: currentNote || '',
        attachments: [],
        project: currentProject,
        areaOfFocus: currentAreaOfFocus,
        costCode: currentCostCode
      };

      console.log('Starting tracking with session data:', session);
      const docRef = await addDoc(collection(db, `churches/${churchId}/timeEntries`), session);
      console.log('Time tracking session saved with ID:', docRef.id);
      setCurrentSession({ ...session, id: docRef.id });
      setCurrentNote(session.note || '');
      setNewNote('');
      setIsTracking(true);
      setElapsedTime(0);
      toast.success('Time tracking started!');
    } catch (error) {
      console.error('Error starting time tracking:', error);
      console.error('Error details:', error.code, error.message);
      toast.error('Failed to start time tracking: ' + error.message);
    }
  };

  const saveCurrentNote = async () => {
    if (!currentSession?.id) return;
    if (!newNote.trim()) {
      toast.error('Please enter a note');
      return;
    }
    try {
      const timestamp = new Date().toLocaleString();
      const appendedNote = currentNote
        ? `${currentNote}\n\n[${timestamp}] ${newNote.trim()}`
        : `[${timestamp}] ${newNote.trim()}`;

      await updateDoc(doc(db, `churches/${churchId}/timeEntries`, currentSession.id), {
        note: appendedNote
      });

      setCurrentNote(appendedNote);
      setNewNote('');
      toast.success('Note saved');
    } catch (error) {
      console.error('Error saving note:', error);
      toast.error('Failed to save note');
    }
  };

  const handleAttachmentUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !currentSession?.id || !storage) return;

    try {
      setUploadingAttachment(true);
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = `churches/${churchId}/timeEntries/${currentSession.id}/${Date.now()}-${safeName}`;
      const fileRef = ref(storage, filePath);
      await uploadBytes(fileRef, file);
      const downloadURL = await getDownloadURL(fileRef);

      const attachment = {
        name: file.name,
        url: downloadURL,
        contentType: file.type || 'application/octet-stream',
        uploadedAt: new Date().toISOString()
      };

      await updateDoc(doc(db, `churches/${churchId}/timeEntries`, currentSession.id), {
        attachments: arrayUnion(attachment)
      });

      setCurrentSession(prev => prev ? {
        ...prev,
        attachments: [...(prev.attachments || []), attachment]
      } : prev);

      toast.success('Attachment added');
      event.target.value = '';
    } catch (error) {
      console.error('Error uploading attachment:', error);
      toast.error('Failed to upload attachment');
    } finally {
      setUploadingAttachment(false);
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
      setCurrentNote('');
      setNewNote('');
      toast.success('Time tracking stopped!');
    } catch (error) {
      console.error('Error stopping time tracking:', error);
      toast.error('Failed to stop time tracking');
    }
  };

  if (loadingPermissions) {
    return (
      <div style={commonStyles.container}>
        <ChurchHeader id={churchId} />
        <div style={commonStyles.content}>
          <div className="loading">Loading permissions...</div>
        </div>
      </div>
    );
  }

  if (!hasTimeTrackerAccess) {
    return (
      <div style={commonStyles.container}>
        <ChurchHeader id={churchId} />
        <div style={commonStyles.content}>
          <div className="error-message">
            You don't have permission to access the time tracker.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={commonStyles.container}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
        <button
          onClick={() => navigate(`/organization/${id}/time-tracker`)}
          className="nav-btn"
        >
          ← Back to Time Entries
        </button>
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
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#DC2626'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#EF4444'}
        >
          🚪 Logout
        </button>
      </div>
      <ChurchHeader id={churchId} />
      <div style={commonStyles.content}>
        <div className="time-tracker-container">
          <div className="time-tracker-header">
            <h1>Time Tracker - Timer</h1>
          </div>

          {/* Project/Area/Cost Code Selection */}
          <div className="selection-section">
            <div className="selection-row">
              <div className="selection-group">
                <label>Project:</label>
                <select
                  value={currentProject}
                  onChange={(e) => setCurrentProject(e.target.value)}
                  className="selection-select"
                >
                  <option value="">Select Project</option>
                  {projects.map(project => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="selection-group">
                <label>Area of Focus:</label>
                <select
                  value={currentAreaOfFocus}
                  onChange={(e) => setCurrentAreaOfFocus(e.target.value)}
                  className="selection-select"
                >
                  <option value="">Select Area</option>
                  {areasOfFocus.map(area => (
                    <option key={area.id} value={area.id}>
                      {area.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="selection-group">
                <label>Cost Code:</label>
                <select
                  value={currentCostCode}
                  onChange={(e) => setCurrentCostCode(e.target.value)}
                  className="selection-select"
                >
                  <option value="">Select Cost Code</option>
                  {costCodes.map(costCode => (
                    <option key={costCode.id} value={costCode.code}>
                      {costCode.code} - {costCode.description}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

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
                <div className="session-details" style={{ marginTop: '12px' }}>
                  <div className="session-detail" style={{ width: '100%' }}>
                    <strong>Add Note:</strong>
                    <textarea
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      rows={3}
                      placeholder="Type a note and save it..."
                      style={{ width: '100%', marginTop: '6px' }}
                    />
                    {currentNote && (
                      <div style={{ marginTop: '10px', whiteSpace: 'pre-wrap', background: '#f9fafb', padding: '10px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                        {currentNote}
                      </div>
                    )}
                    {currentSession.attachments && currentSession.attachments.length > 0 && (
                      <div style={{ marginTop: '10px' }}>
                        <strong>Attachments:</strong>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '8px' }}>
                          {currentSession.attachments.map((file, index) => (
                            <a
                              key={`${file.url}-${index}`}
                              href={file.url}
                              target="_blank"
                              rel="noreferrer"
                              style={{ textDecoration: 'none' }}
                            >
                              {isImageAttachment(file) ? (
                                <img
                                  src={file.url}
                                  alt={file.name}
                                  style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '8px', border: '1px solid #e5e7eb' }}
                                />
                              ) : (
                                <div style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid #e5e7eb', background: '#fff' }}>
                                  {file.name}
                                </div>
                              )}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                    <div style={{ marginTop: '8px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <button className="nav-btn" onClick={saveCurrentNote}>
                        Save Note
                      </button>
                      <label className="nav-btn" style={{ cursor: uploadingAttachment ? 'not-allowed' : 'pointer' }}>
                        {uploadingAttachment ? 'Uploading...' : 'Add File'}
                        <input
                          type="file"
                          style={{ display: 'none' }}
                          onChange={handleAttachmentUpload}
                          disabled={uploadingAttachment}
                          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
                        />
                      </label>
                    </div>
                  </div>
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

          {/* Today's Entries */}
          <div className="section">
            <h3>Today&apos;s Time Entries</h3>
            <div className="time-entries-list">
              {todayEntries.length === 0 ? (
                <p>No time entries logged for today.</p>
              ) : (
                todayEntries.map(entry => (
                  <div key={entry.id} className="time-entry-item">
                    <div className="entry-details">
                      <span className="entry-date">{formatDateMDY(entry.date)}</span>
                      <span className="entry-duration">{entry.duration ? formatTime(entry.duration) : '00:00'}</span>
                      <span className="entry-project">Project: {projects.find(p => p.id === entry.project)?.name || entry.project || 'Unknown'}</span>
                      <span className="entry-cost-code">Cost Code: {costCodes.find(c => c.code === entry.costCode)?.code || entry.costCode || 'None'}</span>
                    </div>
                    <div className="entry-details">
                      <span className="entry-detail">Start: {formatTimeDisplay(entry.startTime)}</span>
                      <span className="entry-detail">End: {formatTimeDisplay(entry.endTime)}</span>
                      <span className="entry-detail">Area: {areasOfFocus.find(a => a.id === entry.areaOfFocus)?.name || entry.areaOfFocus || 'None'}</span>
                    </div>
                    <div className="entry-note">
                      {entry.note && <p>{entry.note}</p>}
                    </div>
                    {entry.attachments && entry.attachments.length > 0 && (
                      <div className="entry-note" style={{ marginTop: '8px' }}>
                        <strong>Attachments:</strong>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '8px' }}>
                          {entry.attachments.map((file, index) => (
                            <a
                              key={`${entry.id}-${file.url}-${index}`}
                              href={file.url}
                              target="_blank"
                              rel="noreferrer"
                              style={{ textDecoration: 'none' }}
                            >
                              {isImageAttachment(file) ? (
                                <img
                                  src={file.url}
                                  alt={file.name}
                                  style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '8px', border: '1px solid #e5e7eb' }}
                                />
                              ) : (
                                <div style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid #e5e7eb', background: '#fff' }}>
                                  {file.name}
                                </div>
                              )}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TimerPage;