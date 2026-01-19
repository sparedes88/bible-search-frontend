import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import {
  collection,
  addDoc,
  updateDoc,
  doc,
  query,
  where,
  onSnapshot,
  serverTimestamp
} from 'firebase/firestore';
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

const TimerPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const churchId = id;

  // Time Tracking State
  const [isTracking, setIsTracking] = useState(false);
  const [currentSession, setCurrentSession] = useState(null);
  const [currentProject, setCurrentProject] = useState('');
  const [currentAreaOfFocus, setCurrentAreaOfFocus] = useState('');
  const [currentCostCode, setCurrentCostCode] = useState('');
  const [elapsedTime, setElapsedTime] = useState(0);

  // Data State
  const [projects, setProjects] = useState([]);
  const [areasOfFocus, setAreasOfFocus] = useState([]);
  const [costCodes, setCostCodes] = useState([]);

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

  if (loadingPermissions) {
    return (
      <div style={commonStyles.container}>
        <ChurchHeader />
        <div style={commonStyles.content}>
          <div className="loading">Loading permissions...</div>
        </div>
      </div>
    );
  }

  if (!hasTimeTrackerAccess) {
    return (
      <div style={commonStyles.container}>
        <ChurchHeader />
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
      <ChurchHeader />
      <div style={commonStyles.content}>
        <div className="time-tracker-container">
          <div className="time-tracker-header">
            <h1>Time Tracker - Timer</h1>
            <button
              onClick={() => navigate(`/organization/${id}/time-tracker`)}
              className="nav-btn"
            >
              ← Back to Time Entries
            </button>
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
      </div>
    </div>
  );
};

export default TimerPage;