import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db, storage } from '../firebase';
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  orderBy,
  limit,
  arrayUnion,
  getDocs
} from 'firebase/firestore';
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from 'firebase/storage';
import { toast } from 'react-toastify';
import './TaskManager.css';

const TaskManager = () => {
  const { id: churchId } = useParams();
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [selectedTask, setSelectedTask] = useState(null);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [editingComment, setEditingComment] = useState(null);
  const [editCommentText, setEditCommentText] = useState('');
  const [uploadingFiles, setUploadingFiles] = useState({});
  const [showAddTask, setShowAddTask] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [editTaskData, setEditTaskData] = useState({
    title: '',
    description: '',
    priority: 'medium',
    status: 'todo',
    dueDate: '',
    assignedTo: '',
    forecastedHours: 0
  });
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    priority: 'medium',
    status: 'todo',
    dueDate: '',
    assignedTo: '',
    forecastedHours: 0
  });
  const fileInputRef = useRef(null);
  const [loading, setLoading] = useState(true);

  // Fetch tasks
  useEffect(() => {
    if (!user || !churchId) return;

    const tasksRef = collection(db, `churches/${churchId}/tasks`);
    const taskQuery = query(
      tasksRef,
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(taskQuery, (snapshot) => {
      const taskList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.() || new Date(doc.data().createdAt),
        updatedAt: doc.data().updatedAt?.toDate?.() || new Date(doc.data().updatedAt)
      }));
      setTasks(taskList);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user, churchId]);

  // Fetch comments when task is selected
  useEffect(() => {
    if (!selectedTask || !churchId) {
      setComments([]);
      return;
    }

    const commentsRef = collection(db, `churches/${churchId}/tasks/${selectedTask.id}/comments`);
    const commentQuery = query(
      commentsRef,
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(commentQuery, (snapshot) => {
      const commentList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.() || new Date(doc.data().createdAt)
      }));
      setComments(commentList);
    });

    return () => unsubscribe();
  }, [selectedTask, churchId]);

  // Create new task
  const handleCreateTask = async (e) => {
    e.preventDefault();
    if (!newTask.title.trim()) return;

    try {
      const taskData = {
        ...newTask,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        churchId
      };

      await addDoc(collection(db, `churches/${churchId}/tasks`), taskData);

      setNewTask({
        title: '',
        description: '',
        priority: 'medium',
        status: 'todo',
        dueDate: '',
        assignedTo: '',
        forecastedHours: 0
      });
      setShowAddTask(false);
      toast.success('Task created successfully!');
    } catch (error) {
      console.error('Error creating task:', error);
      toast.error('Failed to create task');
    }
  };

  // Update task
  const handleUpdateTask = async (taskId, updates) => {
    try {
      await updateDoc(doc(db, `churches/${churchId}/tasks/${taskId}`), {
        ...updates,
        updatedAt: serverTimestamp()
      });
      toast.success('Task updated successfully!');
    } catch (error) {
      console.error('Error updating task:', error);
      toast.error('Failed to update task');
    }
  };

  // Open edit modal for task
  const handleEditTask = (task) => {
    setEditingTask(task);
    setEditTaskData({
      title: task.title || '',
      description: task.description || '',
      priority: task.priority || 'medium',
      status: task.status || 'todo',
      dueDate: task.dueDate || '',
      assignedTo: task.assignedTo || '',
      forecastedHours: task.forecastedHours || 0
    });
  };

  // Save edited task
  const handleSaveEditedTask = async (e) => {
    e.preventDefault();
    if (!editingTask) return;

    try {
      await handleUpdateTask(editingTask.id, editTaskData);
      setEditingTask(null);
      setEditTaskData({
        title: '',
        description: '',
        priority: 'medium',
        status: 'todo',
        dueDate: '',
        assignedTo: '',
        forecastedHours: 0
      });
    } catch (error) {
      console.error('Error saving edited task:', error);
    }
  };

  // Delete task
  const handleDeleteTask = async (taskId) => {
    if (!window.confirm('Are you sure you want to delete this task? This will also delete all comments and files.')) return;

    try {
      // Delete all comments and their files first
      const commentsRef = collection(db, `churches/${churchId}/tasks/${taskId}/comments`);
      const commentsSnapshot = await getDocs(commentsRef);

      for (const commentDoc of commentsSnapshot.docs) {
        const commentData = commentDoc.data();
        if (commentData.attachments) {
          for (const attachment of commentData.attachments) {
            try {
              const fileRef = ref(storage, attachment.path);
              await deleteObject(fileRef);
            } catch (error) {
              console.error('Error deleting file:', error);
            }
          }
        }
        await deleteDoc(commentDoc.ref);
      }

      // Delete the task
      await deleteDoc(doc(db, `churches/${churchId}/tasks/${taskId}`));

      if (selectedTask?.id === taskId) {
        setSelectedTask(null);
      }

      toast.success('Task deleted successfully!');
    } catch (error) {
      console.error('Error deleting task:', error);
      toast.error('Failed to delete task');
    }
  };

  // Add comment
  const handleAddComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim() || !selectedTask) return;

    try {
      const commentData = {
        text: newComment,
        authorId: user.uid,
        authorName: user.displayName || user.email,
        createdAt: serverTimestamp(),
        attachments: []
      };

      await addDoc(collection(db, `churches/${churchId}/tasks/${selectedTask.id}/comments`), commentData);
      setNewComment('');
      toast.success('Comment added!');
    } catch (error) {
      console.error('Error adding comment:', error);
      toast.error('Failed to add comment');
    }
  };

  // Update comment
  const handleUpdateComment = async (commentId, newText) => {
    try {
      await updateDoc(doc(db, `churches/${churchId}/tasks/${selectedTask.id}/comments/${commentId}`), {
        text: newText,
        updatedAt: serverTimestamp()
      });
      setEditingComment(null);
      setEditCommentText('');
      toast.success('Comment updated!');
    } catch (error) {
      console.error('Error updating comment:', error);
      toast.error('Failed to update comment');
    }
  };

  // Delete comment
  const handleDeleteComment = async (commentId) => {
    if (!window.confirm('Are you sure you want to delete this comment?')) return;

    try {
      const commentRef = doc(db, `churches/${churchId}/tasks/${selectedTask.id}/comments/${commentId}`);
      const commentDoc = await getDoc(commentRef);
      const commentData = commentDoc.data();

      // Delete attached files
      if (commentData.attachments) {
        for (const attachment of commentData.attachments) {
          try {
            const fileRef = ref(storage, attachment.path);
            await deleteObject(fileRef);
          } catch (error) {
            console.error('Error deleting file:', error);
          }
        }
      }

      await deleteDoc(commentRef);
      toast.success('Comment deleted!');
    } catch (error) {
      console.error('Error deleting comment:', error);
      toast.error('Failed to delete comment');
    }
  };

  // Upload files to comment
  const handleFileUpload = async (files, commentId = null) => {
    if (!selectedTask) return;

    const uploadPromises = Array.from(files).map(async (file) => {
      const fileId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      const filePath = `churches/${churchId}/tasks/${selectedTask.id}/comments/${fileId}_${file.name}`;
      const fileRef = ref(storage, filePath);

      setUploadingFiles(prev => ({ ...prev, [fileId]: true }));

      try {
        const snapshot = await uploadBytes(fileRef, file);
        const downloadURL = await getDownloadURL(snapshot.ref);

        const attachment = {
          id: fileId,
          name: file.name,
          path: filePath,
          url: downloadURL,
          size: file.size,
          type: file.type,
          uploadedAt: serverTimestamp()
        };

        if (commentId) {
          // Add to existing comment
          const commentRef = doc(db, `churches/${churchId}/tasks/${selectedTask.id}/comments/${commentId}`);
          await updateDoc(commentRef, {
            attachments: arrayUnion(attachment)
          });
        } else {
          // Create new comment with attachment
          const commentData = {
            text: `Uploaded file: ${file.name}`,
            authorId: user.uid,
            authorName: user.displayName || user.email,
            createdAt: serverTimestamp(),
            attachments: [attachment]
          };

          await addDoc(collection(db, `churches/${churchId}/tasks/${selectedTask.id}/comments`), commentData);
        }

        toast.success(`${file.name} uploaded successfully!`);
      } catch (error) {
        console.error('Error uploading file:', error);
        toast.error(`Failed to upload ${file.name}`);
      } finally {
        setUploadingFiles(prev => ({ ...prev, [fileId]: false }));
      }
    });

    await Promise.all(uploadPromises);
  };

  // Delete attachment
  const handleDeleteAttachment = async (commentId, attachmentId, filePath) => {
    try {
      // Delete from storage
      const fileRef = ref(storage, filePath);
      await deleteObject(fileRef);

      // Remove from comment
      const commentRef = doc(db, `churches/${churchId}/tasks/${selectedTask.id}/comments/${commentId}`);
      const commentDoc = await getDoc(commentRef);
      const commentData = commentDoc.data();

      const updatedAttachments = commentData.attachments.filter(att => att.id !== attachmentId);

      await updateDoc(commentRef, {
        attachments: updatedAttachments
      });

      toast.success('File deleted successfully!');
    } catch (error) {
      console.error('Error deleting attachment:', error);
      toast.error('Failed to delete file');
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return '#ff4444';
      case 'medium': return '#ffaa00';
      case 'low': return '#44aa44';
      default: return '#666666';
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'todo': return '#666666';
      case 'in-progress': return '#007bff';
      case 'review': return '#ffaa00';
      case 'completed': return '#28a745';
      default: return '#666666';
    }
  };

  if (loading) {
    return <div className="task-manager-loading">Loading tasks...</div>;
  }

  return (
    <div className="task-manager">
      <div className="task-manager-header">
        <div className="header-left">
          <h2>Task Management</h2>
          <div className="status-summary">
            <span className="status-count todo">To Do: {tasks.filter(task => task.status === 'todo').length} ({tasks.filter(task => task.status === 'todo').reduce((total, task) => total + (task.forecastedHours || 0), 0)}h)</span>
            <span className="status-count in-progress">In Progress: {tasks.filter(task => task.status === 'in-progress').length} ({tasks.filter(task => task.status === 'in-progress').reduce((total, task) => total + (task.forecastedHours || 0), 0)}h)</span>
            <span className="status-count review">Review: {tasks.filter(task => task.status === 'review').length} ({tasks.filter(task => task.status === 'review').reduce((total, task) => total + (task.forecastedHours || 0), 0)}h)</span>
            <span className="status-count completed">Completed: {tasks.filter(task => task.status === 'completed').length} ({tasks.filter(task => task.status === 'completed').reduce((total, task) => total + (task.forecastedHours || 0), 0)}h)</span>
          </div>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setShowAddTask(true)}
        >
          Add New Task
        </button>
      </div>

      <div className="task-manager-content">
        <div className="task-list">
          <h3>Tasks ({tasks.length})</h3>
          {tasks.length === 0 ? (
            <p className="no-tasks">No tasks found. Create your first task!</p>
          ) : (
            <div className="task-items">
              {tasks.map(task => (
                <div
                  key={task.id}
                  className={`task-item ${selectedTask?.id === task.id ? 'selected' : ''}`}
                  onClick={() => setSelectedTask(task)}
                >
                  <div className="task-header">
                    <div className="task-title-section">
                      <h4>{task.title}</h4>
                      <div className="task-meta">
                        <span
                          className="priority-badge"
                          style={{ backgroundColor: getPriorityColor(task.priority) }}
                        >
                          {task.priority}
                        </span>
                        <span
                          className="status-badge"
                          style={{ backgroundColor: getStatusColor(task.status) }}
                        >
                          {task.status}
                        </span>
                      </div>
                    </div>
                    <div className="task-actions">
                      <button
                        className="task-action-btn task-edit-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditTask(task);
                        }}
                        title="Edit Task"
                      >
                        ✏️ Edit
                      </button>
                      <button
                        className="task-action-btn task-delete-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteTask(task.id);
                        }}
                        title="Delete Task"
                      >
                        🗑️ Delete
                      </button>
                    </div>
                  </div>
                  <p className="task-description">{task.description}</p>
                  <div className="task-footer">
                    <span className="task-date">
                      Due: {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'No due date'}
                    </span>
                    {task.assignedTo && (
                      <span className="assigned-user">
                        👤 {task.assignedTo}
                      </span>
                    )}
                    <span className="forecast-hours">
                      ⏱️ {task.forecastedHours || 0}h
                    </span>
                    <span className="comment-count">
                      💬 {task.commentCount || 0}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="task-detail">
          {selectedTask ? (
            <>
              <div className="task-detail-header">
                <h3>{selectedTask.title}</h3>
                <div className="task-actions">
                  <select
                    value={selectedTask.status}
                    onChange={(e) => handleUpdateTask(selectedTask.id, { status: e.target.value })}
                  >
                    <option value="todo">To Do</option>
                    <option value="in-progress">In Progress</option>
                    <option value="review">Review</option>
                    <option value="completed">Completed</option>
                  </select>
                  <select
                    value={selectedTask.priority}
                    onChange={(e) => handleUpdateTask(selectedTask.id, { priority: e.target.value })}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => handleDeleteTask(selectedTask.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="task-detail-content">
                <p>{selectedTask.description}</p>
                <div className="task-meta-info">
                  <p><strong>Created:</strong> {selectedTask.createdAt.toLocaleString()}</p>
                  <p><strong>Due Date:</strong> {selectedTask.dueDate ? new Date(selectedTask.dueDate).toLocaleDateString() : 'Not set'}</p>
                  <p><strong>Forecasted Hours:</strong> {selectedTask.forecastedHours || 0}h</p>
                  <p><strong>Assigned to:</strong> {selectedTask.assignedTo || 'Not assigned'}</p>
                </div>
              </div>

              <div className="comments-section">
                <h4>Comments ({comments.length})</h4>

                <form onSubmit={handleAddComment} className="comment-form">
                  <textarea
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Add a comment..."
                    rows="3"
                  />
                  <div className="comment-form-actions">
                    <input
                      type="file"
                      ref={fileInputRef}
                      multiple
                      onChange={(e) => handleFileUpload(e.target.files)}
                      style={{ display: 'none' }}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      📎 Attach Files
                    </button>
                    <button type="submit" className="btn btn-primary btn-sm">
                      Comment
                    </button>
                  </div>
                </form>

                <div className="comments-list">
                  {comments.map(comment => (
                    <div key={comment.id} className="comment-item">
                      <div className="comment-header">
                        <strong>{comment.authorName}</strong>
                        <span className="comment-date">
                          {comment.createdAt.toLocaleString()}
                        </span>
                      </div>

                      {editingComment === comment.id ? (
                        <div className="comment-edit">
                          <textarea
                            value={editCommentText}
                            onChange={(e) => setEditCommentText(e.target.value)}
                            rows="3"
                          />
                          <div className="comment-edit-actions">
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => handleUpdateComment(comment.id, editCommentText)}
                            >
                              Save
                            </button>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => {
                                setEditingComment(null);
                                setEditCommentText('');
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="comment-text">{comment.text}</p>
                      )}

                      {comment.attachments && comment.attachments.length > 0 && (
                        <div className="comment-attachments">
                          {comment.attachments.map(attachment => (
                            <div key={attachment.id} className="attachment-item">
                              <a
                                href={attachment.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="attachment-link"
                              >
                                📎 {attachment.name}
                              </a>
                              <button
                                className="btn btn-danger btn-xs"
                                onClick={() => handleDeleteAttachment(comment.id, attachment.id, attachment.path)}
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {comment.authorId === user.uid && editingComment !== comment.id && (
                        <div className="comment-actions">
                          <button
                            className="btn btn-link btn-sm"
                            onClick={() => {
                              setEditingComment(comment.id);
                              setEditCommentText(comment.text);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            className="btn btn-link btn-sm text-danger"
                            onClick={() => handleDeleteComment(comment.id)}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="no-task-selected">
              <p>Select a task to view details and comments</p>
            </div>
          )}
        </div>
      </div>

      {showAddTask && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Create New Task</h3>
            <form onSubmit={handleCreateTask}>
              <div className="form-group">
                <label>Title *</label>
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
                  <label>Priority</label>
                  <select
                    value={newTask.priority}
                    onChange={(e) => setNewTask({...newTask, priority: e.target.value})}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Status</label>
                  <select
                    value={newTask.status}
                    onChange={(e) => setNewTask({...newTask, status: e.target.value})}
                  >
                    <option value="todo">To Do</option>
                    <option value="in-progress">In Progress</option>
                    <option value="review">Review</option>
                    <option value="completed">Completed</option>
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
                <label>Assigned To</label>
                <input
                  type="text"
                  value={newTask.assignedTo}
                  onChange={(e) => setNewTask({...newTask, assignedTo: e.target.value})}
                  placeholder="User name or email"
                />
              </div>

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddTask(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Create Task
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingTask && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Edit Task</h3>
            <form onSubmit={handleSaveEditedTask}>
              <div className="form-group">
                <label>Title *</label>
                <input
                  type="text"
                  value={editTaskData.title}
                  onChange={(e) => setEditTaskData({...editTaskData, title: e.target.value})}
                  required
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={editTaskData.description}
                  onChange={(e) => setEditTaskData({...editTaskData, description: e.target.value})}
                  rows="3"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Forecasted Hours</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={editTaskData.forecastedHours}
                    onChange={(e) => setEditTaskData({...editTaskData, forecastedHours: parseFloat(e.target.value) || 0})}
                    placeholder="0.0"
                  />
                </div>

                <div className="form-group">
                  <label>Priority</label>
                  <select
                    value={editTaskData.priority}
                    onChange={(e) => setEditTaskData({...editTaskData, priority: e.target.value})}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Status</label>
                  <select
                    value={editTaskData.status}
                    onChange={(e) => setEditTaskData({...editTaskData, status: e.target.value})}
                  >
                    <option value="todo">To Do</option>
                    <option value="in-progress">In Progress</option>
                    <option value="review">Review</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Due Date</label>
                  <input
                    type="date"
                    value={editTaskData.dueDate}
                    onChange={(e) => setEditTaskData({...editTaskData, dueDate: e.target.value})}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Assigned To</label>
                <input
                  type="text"
                  value={editTaskData.assignedTo}
                  onChange={(e) => setEditTaskData({...editTaskData, assignedTo: e.target.value})}
                  placeholder="User name or email"
                />
              </div>

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setEditingTask(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default TaskManager;