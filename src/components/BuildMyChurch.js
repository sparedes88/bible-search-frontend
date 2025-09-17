import React, { useState, useEffect } from 'react';
import { useParams, Link, useLocation, useNavigate } from 'react-router-dom';
import { db, storage } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  doc,
  updateDoc,
  deleteDoc,
  getDoc
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import ChurchHeader from './ChurchHeader';
import { toast } from 'react-toastify';
import { FaEdit, FaCheck, FaTimes, FaChevronDown, FaChevronUp, FaChevronLeft, FaChevronRight, FaTrash, FaFilePdf } from 'react-icons/fa';
import { jsPDF } from 'jspdf';
import { QRCodeSVG } from 'qrcode.react';
import { PDFDownloadLink } from '@react-pdf/renderer';
import TaskQRLabel from './TaskQRLabel';
import './BuildMyChurch.css';

const BuildMyChurch = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [tasks, setTasks] = useState([]);
  const [topics, setTopics] = useState([]);
  const [newTopic, setNewTopic] = useState('');
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    priority: 'medium',
    status: 'not-started',
    topic: '',
    assignee: '',
    customTopic: '',
    documents: []
  });
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [filterTopic, setFilterTopic] = useState('all');
  const [expandedTaskId, setExpandedTaskId] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [church, setChurch] = useState(null);
  const tasksPerPage = 5;

  const STATUS_OPTIONS = [
    { value: 'not-started', label: 'Not Started' },
    { value: 'in-progress', label: 'In Progress' },
    { value: 'on-hold', label: 'On Hold' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' }
  ];

  useEffect(() => {
    if (!user) {
      const returnUrl = `${location.pathname}${location.search}${location.hash}`;
      navigate(`/church/${id}/login?returnUrl=${encodeURIComponent(returnUrl)}`);
      return;
    }

    const fetchTasks = async () => {
      try {
        const tasksQuery = query(
          collection(db, 'buildTasks'),
          where('churchId', '==', id),
          orderBy('createdAt', 'desc')
        );
        const snapshot = await getDocs(tasksQuery);
        const tasksList = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setTasks(tasksList);
      } catch (error) {
        console.error('Error fetching tasks:', error);
        toast.error('Failed to load tasks');
      }
    };

    const fetchTopics = async () => {
      try {
        const topicsQuery = query(collection(db, 'buildTopics'), where('churchId', '==', id));
        const snapshot = await getDocs(topicsQuery);
        setTopics(snapshot.docs.map(doc => ({
          id: doc.id,
          name: doc.data().name
        })));
      } catch (error) {
        console.error('Error fetching topics:', error);
      }
    };

    const fetchChurchData = async () => {
      try {
        const churchRef = doc(db, 'churches', id);
        const churchSnap = await getDoc(churchRef);
        if (churchSnap.exists()) {
          setChurch(churchSnap.data());
        }
      } catch (error) {
        console.error('Error fetching church:', error);
      }
    };

    fetchTasks();
    fetchTopics();
    fetchChurchData();
  }, [user, id, navigate, location]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const taskData = {
        ...newTask,
        topic: newTask.topic === 'new' ? newTask.customTopic : newTask.topic,
        churchId: id,
        createdAt: new Date().toISOString(),
        comments: []
      };

      let topicToUse = newTask.topic;
      if (newTask.topic === 'new' && newTask.customTopic.trim()) {
        const topicRef = await addDoc(collection(db, 'buildTopics'), {
          name: newTask.customTopic,
          churchId: id,
          createdAt: new Date().toISOString()
        });
        topicToUse = newTask.customTopic;
        setTopics(prev => [...prev, { id: topicRef.id, name: newTask.customTopic }]);
      }

      const docRef = await addDoc(collection(db, 'buildTasks'), taskData);
      setTasks(prev => [{id: docRef.id, ...taskData}, ...prev]);
      setNewTask({
        title: '',
        description: '',
        priority: 'medium',
        status: 'not-started',
        topic: '',
        assignee: '',
        customTopic: '',
        documents: []
      });
      toast.success('Task created successfully');
    } catch (error) {
      console.error('Error creating task:', error);
      toast.error('Failed to create task');
    }
  };

  const handleEditTask = (task) => {
    setEditingTaskId(task.id);
    setNewTask({
      title: task.title,
      description: task.description,
      priority: task.priority,
      status: task.status,
      topic: task.topic || '',
      assignee: task.assignee || '',
      customTopic: '',
      documents: task.documents || []
    });
  };

  const handleUpdateTask = async (e) => {
    e.preventDefault();
    try {
      const updatedData = {
        ...newTask,
        topic: newTask.topic === 'new' ? newTask.customTopic : newTask.topic,
        updatedAt: new Date().toISOString()
      };

      const taskRef = doc(db, 'buildTasks', editingTaskId);
      await updateDoc(taskRef, updatedData);

      setTasks(prev => prev.map(task => 
        task.id === editingTaskId ? { ...task, ...updatedData } : task
      ));

      setEditingTaskId(null);
      setNewTask({
        title: '',
        description: '',
        priority: 'medium',
        status: 'not-started',
        topic: '',
        assignee: '',
        customTopic: '',
        documents: []
      });
      toast.success('Task updated successfully');
    } catch (error) {
      console.error('Error updating task:', error);
      toast.error('Failed to update task');
    }
  };

  const handleCancelEdit = () => {
    setEditingTaskId(null);
    setNewTask({
      title: '',
      description: '',
      priority: 'medium',
      status: 'not-started',
      topic: '',
      assignee: '',
      customTopic: '',
      documents: []
    });
  };

  const handleAddTopic = async () => {
    if (!newTopic.trim()) return;
    try {
      const topicRef = await addDoc(collection(db, 'buildTopics'), {
        name: newTopic,
        churchId: id,
        createdAt: new Date().toISOString()
      });
      setTopics(prev => [...prev, { id: topicRef.id, name: newTopic }]);
      setNewTopic('');
    } catch (error) {
      console.error('Error adding topic:', error);
      toast.error('Failed to add topic');
    }
  };

  const handleDeleteTask = async (taskId) => {
    if (window.confirm('Are you sure you want to delete this task?')) {
      try {
        await deleteDoc(doc(db, 'buildTasks', taskId));
        setTasks(prev => prev.filter(task => task.id !== taskId));
        toast.success('Task deleted successfully');
      } catch (error) {
        console.error('Error deleting task:', error);
        toast.error('Failed to delete task');
      }
    }
  };

  const toggleTaskExpand = (taskId) => {
    setExpandedTaskId(expandedTaskId === taskId ? null : taskId);
  };

  const handleFileUpload = async (event, taskId = null) => {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    setUploadingFile(true);
    try {
      const uploadPromises = files.map(async (file) => {
        const validTypes = [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-powerpoint',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'text/plain',
          'image/jpeg',
          'image/png',
          'image/jpg'
        ];

        if (!validTypes.includes(file.type)) {
          toast.error(`Invalid file type: ${file.name}`);
          return null;
        }

        const maxSize = 5 * 1024 * 1024;
        if (file.size > maxSize) {
          toast.error(`File too large: ${file.name}`);
          return null;
        }

        const timestamp = Date.now();
        const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const filePath = `tasks/${id}/${taskId || 'new'}/${timestamp}_${safeFileName}`;
        const storageRef = ref(storage, filePath);

        const metadata = {
          contentType: file.type,
          customMetadata: {
            originalName: file.name,
            uploadedAt: new Date().toISOString()
          }
        };

        const uploadTask = await uploadBytes(storageRef, file, metadata);
        const downloadURL = await getDownloadURL(uploadTask.ref);

        return {
          name: file.name,
          url: downloadURL,
          path: filePath,
          type: file.type,
          size: file.size,
          uploadedAt: new Date().toISOString()
        };
      });

      const uploadedFiles = (await Promise.all(uploadPromises)).filter(f => f !== null);

      if (taskId) {
        const taskRef = doc(db, 'buildTasks', taskId);
        const taskDoc = await getDoc(taskRef);
        if (taskDoc.exists()) {
          const existingDocs = taskDoc.data().documents || [];
          await updateDoc(taskRef, {
            documents: [...existingDocs, ...uploadedFiles]
          });

          setTasks(prev => prev.map(task => 
            task.id === taskId 
              ? { ...task, documents: [...(task.documents || []), ...uploadedFiles] }
              : task
          ));
        }
      } else {
        setNewTask(prev => ({
          ...prev,
          documents: [...(prev.documents || []), ...uploadedFiles]
        }));
      }

      toast.success('Files uploaded successfully');
    } catch (error) {
      console.error('Error uploading files:', error);
      toast.error('Failed to upload files');
    } finally {
      setUploadingFile(false);
    }
  };

  const handleDeleteFile = async (taskId, fileIndex) => {
    try {
      const task = tasks.find(t => t.id === taskId);
      if (!task || !task.documents) return;

      const fileToDelete = task.documents[fileIndex];
      if (!fileToDelete) return;

      const fileRef = ref(storage, fileToDelete.path);
      await deleteObject(fileRef);

      const updatedDocs = task.documents.filter((_, idx) => idx !== fileIndex);
      await updateDoc(doc(db, 'buildTasks', taskId), {
        documents: updatedDocs
      });

      setTasks(prev => prev.map(t =>
        t.id === taskId
          ? { ...t, documents: updatedDocs }
          : t
      ));

      toast.success('File deleted successfully');
    } catch (error) {
      console.error('Error deleting file:', error);
      toast.error('Failed to delete file');
    }
  };

  const exportToPDF = async () => {
    try {
      const toastId = toast.loading('Preparing PDF...', { autoClose: false });
      const doc = new jsPDF();
      
      // Add title and header with branded color
      doc.setFillColor(79, 70, 229); // #4F46E5 - matching web primary color
      doc.rect(0, 0, doc.internal.pageSize.width, 40, 'F');
      doc.setTextColor(255);
      doc.setFontSize(24);
      doc.text('Build My Church Tasks Report', 15, 25);
      
      // Header info
      doc.setFontSize(11);
      doc.setTextColor(200, 200, 200);
      doc.text(`Generated: ${new Date().toLocaleDateString()}`, 15, 35);
      doc.text(`Total Tasks: ${filteredTasks.length}`, doc.internal.pageSize.width - 60, 35);
      
      let yOffset = 50;

      // Add filter information
      if (filterStatus !== 'all' || filterPriority !== 'all' || filterTopic !== 'all' || searchQuery) {
        doc.setFillColor(243, 244, 246); // #F3F4F6
        doc.rect(15, yOffset, doc.internal.pageSize.width - 30, 25, 'F');
        doc.setTextColor(75, 85, 99); // #4B5563
        doc.setFontSize(10);
        doc.text('Applied Filters:', 20, yOffset + 7);
        
        let filterText = [];
        if (filterPriority !== 'all') filterText.push(`Priority: ${filterPriority}`);
        if (filterStatus !== 'all') filterText.push(`Status: ${filterStatus}`);
        if (filterTopic !== 'all') filterText.push(`Topic: ${filterTopic}`);
        if (searchQuery) filterText.push(`Search: "${searchQuery}"`);
        
        doc.text(filterText.join(' | '), 20, yOffset + 17);
        yOffset += 35;
      }
      
      // Group tasks by status
      const statusGroups = {
        'not-started': filteredTasks.filter(task => task.status === 'not-started'),
        'in-progress': filteredTasks.filter(task => task.status === 'in-progress'),
        'on-hold': filteredTasks.filter(task => task.status === 'on-hold'),
        'completed': filteredTasks.filter(task => task.status === 'completed'),
        'cancelled': filteredTasks.filter(task => task.status === 'cancelled')
      };

      // Status colors matching web interface
      const statusColors = {
        'not-started': { bg: [239, 68, 68], text: [255, 255, 255] },    // Red
        'in-progress': { bg: [245, 158, 11], text: [255, 255, 255] },   // Orange
        'on-hold': { bg: [107, 114, 128], text: [255, 255, 255] },      // Gray
        'completed': { bg: [16, 185, 129], text: [255, 255, 255] },     // Green
        'cancelled': { bg: [156, 163, 175], text: [255, 255, 255] }     // Gray
      };

      let processedItems = 0;
      const totalItems = filteredTasks.length;

      // Process each status group
      for (const [status, tasks] of Object.entries(statusGroups)) {
        if (tasks.length === 0) continue;

        // Always start a new page for each status section
        doc.addPage();
        yOffset = 20;

        // Add status section header
        const statusColor = statusColors[status] || { bg: [79, 70, 229], text: [255, 255, 255] };
        doc.setFillColor(...statusColor.bg);
        doc.rect(15, yOffset, doc.internal.pageSize.width - 30, 10, 'F');
        doc.setTextColor(...statusColor.text);
        doc.setFontSize(14);
        doc.text(STATUS_OPTIONS.find(opt => opt.value === status)?.label || status.toUpperCase(), 20, yOffset + 7);
        yOffset += 15;

        // Process tasks in this status group
        for (const task of tasks) {
          processedItems++;
          const progress = Math.round((processedItems / totalItems) * 100);
          toast.update(toastId, { 
            render: `Generating PDF... ${progress}%`,
          });

          // Calculate space needed for this task
          const descriptionLines = doc.splitTextToSize(task.description || '', doc.internal.pageSize.width - 45);  // Increased margin
          const descriptionHeight = descriptionLines.length * 6;  // Increased line spacing
          const estimatedTaskHeight = 90 + descriptionHeight;

          // Check if we need a new page for this task
          if (yOffset + estimatedTaskHeight > doc.internal.pageSize.height - 30) {
            doc.addPage();
            yOffset = 20;
          }

          // Task title
          doc.setFontSize(12);
          doc.setTextColor(31, 41, 55);
          const titleLines = doc.splitTextToSize(task.title, doc.internal.pageSize.width - 45);
          doc.text(titleLines, 20, yOffset + 10);
          yOffset += 15 + (titleLines.length * 7);  // Adjust offset based on title length

          // Task description with proper wrapping
          if (task.description) {
            doc.setFontSize(10);
            doc.setTextColor(107, 114, 128);
            doc.text(descriptionLines, 20, yOffset);
            yOffset += descriptionHeight + 15;
          }

          // Task details grid with proper spacing
          doc.setFillColor(243, 244, 246);
          doc.roundedRect(20, yOffset, doc.internal.pageSize.width - 40, 30, 2, 2, 'F');

          // Details content with proper column spacing
          doc.setFontSize(9);
          doc.setTextColor(75, 85, 99);
          
          const details = [
            [`Priority: ${task.priority || 'N/A'}`, `Topic: ${task.topic || 'N/A'}`, `Assigned To: ${task.assignee || 'Unassigned'}`],
            [`Created: ${new Date(task.createdAt).toLocaleDateString()}`, 
             `Last Updated: ${task.updatedAt ? new Date(task.updatedAt).toLocaleDateString() : 'N/A'}`,
             `Documents: ${task.documents?.length || 0}`]
          ];

          details.forEach((row, rowIndex) => {
            row.forEach((cell, colIndex) => {
              const xPos = 25 + (colIndex * Math.floor((doc.internal.pageSize.width - 50) / 3));
              doc.text(cell, xPos, yOffset + 10 + (rowIndex * 10));
            });
          });

          yOffset += 40;
        }

        yOffset += 10;
      }

      // Add page numbers
      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(10);
        doc.setTextColor(156, 163, 175);
        doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.width / 2, doc.internal.pageSize.height - 10, { align: 'center' });
      }

      // Save the PDF
      toast.update(toastId, { 
        render: 'Finalizing PDF...',
      });
      
      // Add current filters to filename if any are active
      let filename = 'build-my-church-tasks';
      if (filterStatus !== 'all' || filterPriority !== 'all' || filterTopic !== 'all') {
        filename += '-filtered';
      }
      filename += '.pdf';
      
      doc.save(filename);
      
      toast.update(toastId, {
        render: 'PDF generated successfully!',
        type: 'success',
        isLoading: false,
        autoClose: 3000,
      });
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast.error('Failed to generate PDF. Please try again.');
    }
  };

  const filteredTasks = tasks.filter(task => {
    const matchesSearch = task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         task.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = filterStatus === 'all' || task.status === filterStatus;
    const matchesPriority = filterPriority === 'all' || task.priority === filterPriority;
    const matchesTopic = filterTopic === 'all' || task.topic === filterTopic;

    return matchesSearch && matchesStatus && matchesPriority && matchesTopic;
  });

  const indexOfLastTask = currentPage * tasksPerPage;
  const indexOfFirstTask = indexOfLastTask - tasksPerPage;
  const currentTasks = filteredTasks.slice(indexOfFirstTask, indexOfLastTask);
  const totalPages = Math.ceil(filteredTasks.length / tasksPerPage);

  const handlePageChange = (pageNumber) => {
    setCurrentPage(pageNumber);
  };

  const handleTaskClick = async (task) => {
    toggleTaskExpand(task.id);
  };

  const handleCloseDetailView = () => {
    setSelectedTask(null);
  };

  const getTaskUrl = (taskId) => {
    return `${window.location.origin}/church/${id}/build-my-church?task=${taskId}`;
  };

  const DetailView = ({ task }) => {
    if (!task) return null;

    const qrValue = getTaskUrl(task.id);

    return (
      <div style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000
      }}>
        <div style={{
          backgroundColor: "white",
          borderRadius: "8px",
          padding: "24px",
          width: "90%",
          maxWidth: "800px",
          maxHeight: "90vh",
          overflow: "auto"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
            <h2 style={{ margin: 0 }}>{task.title}</h2>
            <button onClick={handleCloseDetailView} style={{ background: "none", border: "none", cursor: "pointer" }}>
              <FaTimes />
            </button>
          </div>

          <div style={{ marginBottom: "20px" }}>
            <span className={`status-badge ${task.status}`} style={{ marginRight: "10px" }}>
              {task.status.toUpperCase()}
            </span>
            <span className={`priority-badge ${task.priority}`}>
              {task.priority.toUpperCase()}
            </span>
          </div>

          <div style={{ marginBottom: "20px" }}>
            <p style={{ whiteSpace: "pre-wrap" }}>{task.description}</p>
          </div>

          {task.assignee && (
            <div style={{ marginBottom: "20px" }}>
              <strong>Assigned to:</strong> {task.assignee}
            </div>
          )}

          <div style={{ marginBottom: "20px" }}>
            <div style={{ display: "flex", gap: "10px", fontSize: "14px", color: "#666" }}>
              <div>Created: {new Date(task.createdAt).toLocaleDateString()}</div>
              {task.updatedAt && (
                <div>Last Updated: {new Date(task.updatedAt).toLocaleDateString()}</div>
              )}
            </div>
          </div>

          {task.documents && task.documents.length > 0 && (
            <div style={{ marginBottom: "20px" }}>
              <h3>Documents</h3>
              <ul style={{ listStyle: "none", padding: 0 }}>
                {task.documents.map((doc, index) => (
                  <li key={index} style={{ marginBottom: "8px" }}>
                    <a href={doc.url} target="_blank" rel="noopener noreferrer" 
                       style={{ color: "#4F46E5", textDecoration: "none" }}>
                      {doc.name}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ 
            padding: "20px",
            backgroundColor: "#F9FAFB",
            borderRadius: "8px",
            marginBottom: "20px"
          }}>
            <h3 style={{ marginBottom: "16px" }}>Task QR Code</h3>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "32px"
            }}>
              <div style={{
                backgroundColor: "white",
                padding: "16px",
                borderRadius: "8px",
                border: "1px solid #E5E7EB"
              }}>
                <QRCodeSVG value={qrValue} size={256} />
              </div>
              
              <div>
                <p style={{ marginBottom: "8px" }}>Scan this QR code to quickly access this task's details.</p>
                <PDFDownloadLink
                  document={<TaskQRLabel task={task} qrUrl={getTaskUrl(task.id)} church={church} />}
                  fileName={`${task.title.replace(/\s+/g, '-').toLowerCase()}-qr-label.pdf`}
                  style={{
                    display: 'inline-block',
                    padding: '8px 16px',
                    backgroundColor: '#4F46E5',
                    color: 'white',
                    borderRadius: '6px',
                    textDecoration: 'none',
                    fontSize: '14px'
                  }}
                >
                  {({ blob, url, loading, error }) =>
                    loading ? 'Preparing PDF...' : '📄 Download QR Label PDF'
                  }
                </PDFDownloadLink>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
            <button 
              onClick={() => handleEditTask(task)}
              style={{ 
                padding: "8px 16px",
                backgroundColor: "#4F46E5",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer"
              }}
            >
              Edit Task
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="build-my-church-container">
      <Link to={`/church/${id}/mi-organizacion`} className="back-link">
        ← Back to Organization
      </Link>

      <ChurchHeader id={id} applyShadow={false} />
      
      <div className="build-content">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
          <h1 className="page-title">Build my Church</h1>
          <button
            onClick={exportToPDF}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.75rem 1.5rem",
              backgroundColor: "#2563eb",
              color: "white",
              border: "none",
              borderRadius: "0.5rem",
              cursor: "pointer",
              fontSize: "0.875rem",
              fontWeight: "600"
            }}
          >
            <FaFilePdf /> Export to PDF
          </button>
        </div>

        <div className="task-grid">
          <div className="task-form-container">
            <h2 className="section-title">Create New Task</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Title</label>
                <input
                  type="text"
                  className="form-input"
                  value={newTask.title}
                  onChange={(e) => setNewTask({...newTask, title: e.target.value})}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea
                  className="form-textarea"
                  value={newTask.description}
                  onChange={(e) => setNewTask({...newTask, description: e.target.value})}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Priority</label>
                <select
                  className="form-select"
                  value={newTask.priority}
                  onChange={(e) => setNewTask({...newTask, priority: e.target.value})}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Status</label>
                <select
                  className="form-select"
                  value={newTask.status}
                  onChange={(e) => setNewTask({...newTask, status: e.target.value})}
                >
                  {STATUS_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Topic</label>
                <div className="topic-input-group">
                  <select
                    className="form-select"
                    value={newTask.topic}
                    onChange={(e) => setNewTask({...newTask, topic: e.target.value})}
                  >
                    <option value="">Select Topic</option>
                    {topics.map(topic => (
                      <option key={topic.id} value={topic.name}>{topic.name}</option>
                    ))}
                    <option value="new">+ Add New Topic</option>
                  </select>
                  
                  {newTask.topic === 'new' && (
                    <div className="new-topic-input">
                      <input
                        type="text"
                        className="form-input"
                        value={newTask.customTopic}
                        onChange={(e) => setNewTask({...newTask, customTopic: e.target.value})}
                        placeholder="Enter new topic"
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Assigned To</label>
                <input
                  type="text"
                  className="form-input"
                  value={newTask.assignee}
                  onChange={(e) => setNewTask({...newTask, assignee: e.target.value})}
                  placeholder="Enter name of person assigned"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Upload Documents</label>
                <input
                  type="file"
                  multiple
                  onChange={(e) => handleFileUpload(e)}
                  className="form-input"
                />
              </div>

              <button type="submit" className="submit-button">
                Create Task
              </button>
            </form>
          </div>

          <div className="tasks-container">
            <div className="filters-section">
              <div className="search-bar">
                <input
                  type="text"
                  placeholder="Search tasks..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="search-input"
                />
              </div>
              
              <div className="filters-row">
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="filter-select"
                >
                  <option value="all">All Status</option>
                  {STATUS_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>

                <select
                  value={filterPriority}
                  onChange={(e) => setFilterPriority(e.target.value)}
                  className="filter-select"
                >
                  <option value="all">All Priority</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>

                <select
                  value={filterTopic}
                  onChange={(e) => setFilterTopic(e.target.value)}
                  className="filter-select"
                >
                  <option value="all">All Topics</option>
                  {topics.map(topic => (
                    <option key={topic.id} value={topic.name}>{topic.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <h2 className="section-title">
              Current Tasks 
              {filteredTasks.length !== tasks.length && 
                `(Showing ${filteredTasks.length} of ${tasks.length})`
              }
            </h2>

            {filteredTasks.length === 0 ? (
              <div className="empty-state">
                {tasks.length === 0 ? 
                  'No tasks created yet. Start by creating a new task.' :
                  'No tasks match your filters.'
                }
              </div>
            ) : (
              <>
                <div className="tasks-grid">
                  {currentTasks.map(task => (
                    <div 
                      key={task.id} 
                      className={`task-card priority-${task.priority}`}
                      onClick={() => handleTaskClick(task)}
                      style={{ cursor: 'pointer' }}
                    >
                      {editingTaskId === task.id ? (
                        <form onSubmit={handleUpdateTask} className="edit-task-form">
                          <div className="form-group">
                            <input
                              type="text"
                              className="form-input"
                              value={newTask.title}
                              onChange={(e) => setNewTask({...newTask, title: e.target.value})}
                              required
                            />
                          </div>

                          <div className="form-group">
                            <textarea
                              className="form-textarea"
                              value={newTask.description}
                              onChange={(e) => setNewTask({...newTask, description: e.target.value})}
                              required
                            />
                          </div>

                          <div className="form-row">
                            <div className="form-group">
                              <select
                                className="form-select"
                                value={newTask.priority}
                                onChange={(e) => setNewTask({...newTask, priority: e.target.value})}
                              >
                                <option value="low">Low</option>
                                <option value="medium">Medium</option>
                                <option value="high">High</option>
                              </select>
                            </div>

                            <div className="form-group">
                              <select
                                className="form-select"
                                value={newTask.status}
                                onChange={(e) => setNewTask({...newTask, status: e.target.value})}
                              >
                                {STATUS_OPTIONS.map(option => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div className="form-group">
                            <label className="form-label">Topic</label>
                            <div className="topic-input-group">
                              <select
                                className="form-select"
                                value={newTask.topic}
                                onChange={(e) => setNewTask({...newTask, topic: e.target.value})}
                              >
                                <option value="">Select Topic</option>
                                {topics.map(topic => (
                                  <option key={topic.id} value={topic.name}>{topic.name}</option>
                                ))}
                                <option value="new">+ Add New Topic</option>
                              </select>
                              
                              {newTask.topic === 'new' && (
                                <div className="new-topic-input">
                                  <input
                                    type="text"
                                    className="form-input"
                                    value={newTask.customTopic}
                                    onChange={(e) => setNewTask({...newTask, customTopic: e.target.value})}
                                    placeholder="Enter new topic"
                                  />
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="form-group">
                            <label className="form-label">Assigned To</label>
                            <input
                              type="text"
                              className="form-input"
                              value={newTask.assignee}
                              onChange={(e) => setNewTask({...newTask, assignee: e.target.value})}
                              placeholder="Enter name of person assigned"
                            />
                          </div>

                          <div className="form-group">
                            <label className="form-label">Upload Documents</label>
                            <input
                              type="file"
                              multiple
                              onChange={(e) => handleFileUpload(e, task.id)}
                              className="form-input"
                            />
                          </div>

                          <div className="edit-actions">
                            <button type="submit" className="edit-button save">
                              <FaCheck /> Save
                            </button>
                            <button type="button" onClick={handleCancelEdit} className="edit-button cancel">
                              <FaTimes /> Cancel
                            </button>
                            <button type="button" onClick={() => handleDeleteTask(task.id)} className="edit-button delete">
                              <FaTrash /> Delete
                            </button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <div className="task-header">
                            <h3 className="task-title">{task.title}</h3>
                            <div className="task-actions" onClick={e => e.stopPropagation()}>
                              <button 
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleEditTask(task);
                                }} 
                                className="edit-button"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '8px 12px',
                                  backgroundColor: '#4F46E5',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  fontSize: '0.875rem',
                                  fontWeight: '500',
                                  zIndex: 20,
                                  position: 'relative'
                                }}
                              >
                                <FaEdit /> Edit
                              </button>
                              <button 
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleDeleteTask(task.id);
                                }} 
                                className="delete-button"
                              >
                                <FaTrash /> Delete
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  toggleTaskExpand(task.id);
                                }}
                                className="expand-button"
                              >
                                {expandedTaskId === task.id ? <FaChevronUp /> : <FaChevronDown />}
                              </button>
                            </div>
                          </div>
                          <p className={`task-description ${expandedTaskId === task.id ? 'expanded' : ''}`}>
                            {task.description}
                          </p>
                          <div className="task-metadata">
                            {task.assignee && (
                              <span className="assignee-badge">
                                <span className="assignee-icon">👤</span>
                                {task.assignee}
                              </span>
                            )}
                            {task.topic && <span className="topic-badge">{task.topic}</span>}
                            <span className={`priority-badge ${task.priority}`}>
                              {task.priority.toUpperCase()}
                            </span>
                            <span className={`status-badge ${task.status}`}>
                              {task.status.toUpperCase()}
                            </span>
                          </div>
                          {expandedTaskId === task.id && (
                            <div className="task-details">
                              <div className="detail-row">
                                <span className="detail-label">Created:</span>
                                <span>{new Date(task.createdAt).toLocaleDateString()}</span>
                              </div>
                              {task.updatedAt && (
                                <div className="detail-row">
                                  <span className="detail-label">Last Updated:</span>
                                  <span>{new Date(task.updatedAt).toLocaleDateString()}</span>
                                </div>
                              )}
                              {task.documents && task.documents.length > 0 && (
                                <div className="documents-section">
                                  <h4>Documents:</h4>
                                  <ul>
                                    {task.documents.map((doc, index) => (
                                      <li key={index}>
                                        <a href={doc.url} target="_blank" rel="noopener noreferrer">
                                          {doc.name}
                                        </a>
                                        <button
                                          type="button"
                                          onClick={() => handleDeleteFile(task.id, index)}
                                          className="delete-file-button"
                                        >
                                          <FaTrash /> Delete
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              <div style={{ marginTop: '15px' }}>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setSelectedTask(task);
                                  }}
                                  className="qr-button"
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '8px 12px',
                                    backgroundColor: '#10B981',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontSize: '0.875rem',
                                    fontWeight: '500'
                                  }}
                                >
                                  <span style={{ fontSize: '16px' }}>📱</span> View QR Code
                                </button>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
                
                {totalPages > 1 && (
                  <div className="pagination">
                    <button 
                      className="pagination-button"
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage === 1}
                    >
                      <FaChevronLeft />
                    </button>
                    
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(number => (
                      <button
                        key={number}
                        className={`pagination-button ${currentPage === number ? 'active' : ''}`}
                        onClick={() => handlePageChange(number)}
                      >
                        {number}
                      </button>
                    ))}
                    
                    <button
                      className="pagination-button"
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage === totalPages}
                    >
                      <FaChevronRight />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {selectedTask && <DetailView task={selectedTask} />}
    </div>
  );
};

export default BuildMyChurch;
