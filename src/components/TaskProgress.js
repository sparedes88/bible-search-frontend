import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { 
  collection, 
  query, 
  where, 
  onSnapshot,
  updateDoc,
  deleteDoc,
  doc 
} from 'firebase/firestore';
import { toast } from 'react-toastify';
import './TaskProgress.css';

const TaskProgress = () => {
  const { id: churchId } = useParams();
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [progressEntries, setProgressEntries] = useState([]);
  const [selectedTask, setSelectedTask] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(true);

  // Fetch tasks
  useEffect(() => {
    if (!user || !churchId) return;

    const tasksRef = collection(db, `churches/${churchId}/tasks`);
    const taskQuery = query(
      tasksRef,
      where('userId', '==', user.uid)
    );

    const unsubscribe = onSnapshot(taskQuery, (snapshot) => {
      const taskList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })).sort((a, b) => new Date(b.createdAt?.toDate?.() || b.createdAt) - new Date(a.createdAt?.toDate?.() || a.createdAt));
      setTasks(taskList);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user, churchId]);

  // Fetch progress entries
  useEffect(() => {
    if (!user || !churchId) return;

    const progressRef = collection(db, `churches/${churchId}/taskProgress`);
    const progressQuery = query(
      progressRef,
      where('userId', '==', user.uid)
    );

    const unsubscribe = onSnapshot(progressQuery,
      (snapshot) => {
        const progressList = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })).sort((a, b) => new Date(b.date) - new Date(a.date));
        setProgressEntries(progressList);
      },
      (error) => {
        console.error('Error fetching progress entries:', error);
      }
    );

    return () => unsubscribe();
  }, [user, churchId]);

  // Filter progress entries by selected task and date
  const getFilteredProgress = () => {
    let filtered = progressEntries;

    if (selectedTask) {
      filtered = filtered.filter(entry => entry.taskId === selectedTask);
    }

    if (selectedDate) {
      filtered = filtered.filter(entry => entry.date === selectedDate);
    }

    return filtered;
  };

  // Get task by ID
  const getTaskById = (taskId) => {
    return tasks.find(task => task.id === taskId);
  };

  // Delete progress entry
  const deleteProgress = async (progressId) => {
    if (!window.confirm('Are you sure you want to delete this progress entry?')) return;

    try {
      // Immediately update local state for instant feedback
      setProgressEntries(prev => prev.filter(entry => entry.id !== progressId));

      // Delete from Firestore
      await deleteDoc(doc(db, `churches/${churchId}/taskProgress`, progressId));
      
      toast.success('Progress entry deleted successfully!');
    } catch (error) {
      console.error('Error deleting progress:', error);
      toast.error('Failed to delete progress entry');
      
      // Note: In a real app, you might want to revert the optimistic update here
      // For now, the real-time listener will eventually correct any inconsistencies
    }
  };

  // Get progress for a specific task
  const getTaskProgress = (taskId) => {
    return progressEntries.filter(entry => entry.taskId === taskId);
  };

  // Get completion percentage for a task
  const getTaskCompletionRate = (taskId) => {
    const progress = getTaskProgress(taskId);
    if (progress.length === 0) return 0;
    
    // Simple calculation based on number of progress entries
    // You could enhance this with actual completion percentages
    return Math.min(progress.length * 10, 100);
  };

  if (loading) {
    return (
      <div className="task-progress-container">
        <div className="loading">Loading tasks and progress...</div>
      </div>
    );
  }

  return (
    <div className="task-progress-container">
      <div className="task-progress-header">
        <h1>Task Progress Viewer</h1>
        <p>Track and view progress across all your tasks</p>
      </div>

      <div className="filters-section">
        <div className="filter-group">
          <label>Filter by Task:</label>
          <select
            value={selectedTask}
            onChange={(e) => setSelectedTask(e.target.value)}
          >
            <option value="">All Tasks</option>
            {tasks.map(task => (
              <option key={task.id} value={task.id}>{task.title}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label>Filter by Date:</label>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
        </div>

        <button 
          className="clear-filters-btn"
          onClick={() => {
            setSelectedTask('');
            setSelectedDate('');
          }}
        >
          Clear Filters
        </button>
      </div>

      {/* Task Overview Cards */}
      <div className="task-overview-section">
        <h2>Task Overview</h2>
        <div className="task-cards-grid">
          {tasks.map(task => {
            const progressCount = getTaskProgress(task.id).length;
            const completionRate = getTaskCompletionRate(task.id);
            
            return (
              <div key={task.id} className={`task-overview-card ${task.status}`}>
                <div className="task-card-header">
                  <h3>{task.title}</h3>
                  <span className={`status-badge ${task.status}`}>
                    {task.status}
                  </span>
                </div>
                
                <div className="task-card-stats">
                  <div className="stat">
                    <span className="stat-number">{progressCount}</span>
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
                
                <div className="task-meta">
                  <span className={`priority ${task.priority}`}>
                    {task.priority} priority
                  </span>
                  {task.dueDate && (
                    <span className="due-date">Due: {task.dueDate}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Progress Entries */}
      <div className="progress-entries-section">
        <h2>Progress Entries</h2>
        
        {getFilteredProgress().length === 0 ? (
          <div className="no-progress">
            {selectedTask || selectedDate ? (
              <p>No progress entries found for the selected filters.</p>
            ) : (
              <p>No progress entries yet. Start tracking your task progress!</p>
            )}
          </div>
        ) : (
          <div className="progress-entries-list">
            {getFilteredProgress().map(entry => {
              const task = getTaskById(entry.taskId);
              
              return (
                <div key={entry.id} className="progress-entry-card">
                  <div className="entry-header">
                    <div className="entry-info">
                      <h4>{task ? task.title : 'Unknown Task'}</h4>
                      <div className="entry-date">
                        {new Date(entry.date).toLocaleDateString('en-US', {
                          weekday: 'long',
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric'
                        })}
                      </div>
                    </div>
                    
                    <div className="entry-actions">
                      <button 
                        onClick={() => deleteProgress(entry.id)}
                        className="delete-progress-btn"
                      >
                        Delete
                      </button>
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
                      Added: {entry.createdAt?.toDate ? 
                        entry.createdAt.toDate().toLocaleString() : 
                        'Unknown time'
                      }
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Daily Summary */}
      <div className="daily-summary-section">
        <h2>Daily Summary - {new Date(selectedDate || new Date()).toLocaleDateString()}</h2>
        
        {(() => {
          const dateToShow = selectedDate || new Date().toISOString().split('T')[0];
          const dayProgress = progressEntries.filter(entry => entry.date === dateToShow);
          
          if (dayProgress.length === 0) {
            return <p>No progress recorded for this date.</p>;
          }
          
          const uniqueTasks = [...new Set(dayProgress.map(entry => entry.taskId))];
          
          return (
            <div className="daily-summary">
              <div className="summary-stats">
                <div className="summary-stat">
                  <span className="stat-number">{dayProgress.length}</span>
                  <span className="stat-label">Progress Entries</span>
                </div>
                <div className="summary-stat">
                  <span className="stat-number">{uniqueTasks.length}</span>
                  <span className="stat-label">Tasks Worked On</span>
                </div>
              </div>
              
              <div className="task-breakdown">
                <h4>Tasks worked on this day:</h4>
                <ul>
                  {uniqueTasks.map(taskId => {
                    const task = getTaskById(taskId);
                    const taskProgressCount = dayProgress.filter(entry => entry.taskId === taskId).length;
                    
                    return (
                      <li key={taskId}>
                        <strong>{task ? task.title : 'Unknown Task'}</strong> 
                        - {taskProgressCount} progress {taskProgressCount === 1 ? 'entry' : 'entries'}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
};

export default TaskProgress;
