import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import './TaskProgress.css';

const TaskProgressDetail = () => {
  const { id: churchId, taskId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [task, setTask] = useState(null);
  const [progressEntries, setProgressEntries] = useState([]);
  const [loadingTask, setLoadingTask] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(true);

  useEffect(() => {
    if (!user || !churchId || !taskId) return undefined;

    const taskRef = doc(db, `churches/${churchId}/tasks`, taskId);
    const unsubscribe = onSnapshot(
      taskRef,
      (snapshot) => {
        if (snapshot.exists()) {
          setTask({ id: snapshot.id, ...snapshot.data() });
        } else {
          setTask(null);
        }
        setLoadingTask(false);
      },
      (error) => {
        console.error('Error fetching task:', error);
        setLoadingTask(false);
      }
    );

    return () => unsubscribe();
  }, [churchId, taskId, user]);

  useEffect(() => {
    if (!user || !churchId || !taskId) return undefined;

    const progressRef = collection(db, `churches/${churchId}/taskProgress`);
    const progressQuery = query(
      progressRef,
      where('userId', '==', user.uid),
      where('taskId', '==', taskId)
    );

    const unsubscribe = onSnapshot(
      progressQuery,
      (snapshot) => {
        const progressList = snapshot.docs
          .map((progressDoc) => ({
            id: progressDoc.id,
            ...progressDoc.data()
          }))
          .sort((a, b) => new Date(b.date) - new Date(a.date));
        setProgressEntries(progressList);
        setLoadingProgress(false);
      },
      (error) => {
        console.error('Error fetching progress entries:', error);
        setLoadingProgress(false);
      }
    );

    return () => unsubscribe();
  }, [churchId, taskId, user]);

  const completionRate = useMemo(() => {
    if (progressEntries.length === 0) return 0;
    return Math.min(progressEntries.length * 10, 100);
  }, [progressEntries.length]);

  const handleBack = () => {
    const fallback = `/organization/${churchId}/time-tracker?tab=progress`;
    navigate(location.state?.from || fallback);
  };

  if (loadingTask) {
    return (
      <div className="task-progress-container">
        <div className="loading">Loading task details...</div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="task-progress-container">
        <div className="task-detail-header">
          <button className="task-detail-back" onClick={handleBack}>
            Back to Task Progress
          </button>
        </div>
        <div className="no-progress">
          <p>Task not found or you do not have access.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="task-progress-container">
      <div className="task-detail-header">
        <div>
          <h1>{task.title}</h1>
          <p>Task Progress Detail</p>
        </div>
        <button className="task-detail-back" onClick={handleBack}>
          Back to Task Progress
        </button>
      </div>

      <div className="task-detail-card">
        <div className="task-card-header">
          <h3>Overview</h3>
          <span className={`status-badge ${task.status || 'pending'}`}>
            {task.status || 'pending'}
          </span>
        </div>

        {task.description && (
          <p className="task-detail-description">{task.description}</p>
        )}

        <div className="task-detail-meta">
          <span className={`priority ${task.priority || 'medium'}`}>
            {task.priority || 'medium'} priority
          </span>
          {task.dueDate && (
            <span className="due-date">Due: {task.dueDate}</span>
          )}
        </div>

        <div className="task-card-stats">
          <div className="stat">
            <span className="stat-number">{progressEntries.length}</span>
            <span className="stat-label">Progress Entries</span>
          </div>
          <div className="stat">
            <span className="stat-number">{completionRate}%</span>
            <span className="stat-label">Estimated Progress</span>
          </div>
        </div>

        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: `${completionRate}%` }}
          ></div>
        </div>
      </div>

      <div className="progress-entries-section">
        <h2>Progress Entries</h2>
        {loadingProgress ? (
          <div className="loading">Loading progress entries...</div>
        ) : progressEntries.length === 0 ? (
          <div className="no-progress">
            <p>No progress entries recorded for this task yet.</p>
          </div>
        ) : (
          <div className="progress-entries-list">
            {progressEntries.map((entry) => (
              <div key={entry.id} className="progress-entry-card">
                <div className="entry-header">
                  <div className="entry-info">
                    <h4>{task.title}</h4>
                    <div className="entry-date">
                      {new Date(entry.date).toLocaleDateString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      })}
                    </div>
                  </div>
                </div>

                <div className="entry-content">
                  <div className="progress-text">
                    <h5>Progress Made:</h5>
                    <p>{entry.progress}</p>
                  </div>

                  {entry.notes && (
                    <div className="notes-text">
                      <h5>Additional Notes:</h5>
                      <p>{entry.notes}</p>
                    </div>
                  )}
                </div>

                <div className="entry-footer">
                  <span className="created-at">
                    Added:{' '}
                    {entry.createdAt?.toDate
                      ? entry.createdAt.toDate().toLocaleString()
                      : 'Unknown time'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default TaskProgressDetail;
