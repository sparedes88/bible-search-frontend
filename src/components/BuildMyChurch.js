import React, { useState, useEffect } from 'react';
import { useParams, Link, useLocation, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth, db, storage } from '../firebase';
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
import { safeToast } from '../utils/toastUtils';
import { toast } from 'react-toastify';
import { FaEdit, FaCheck, FaTimes, FaChevronDown, FaChevronUp, FaChevronLeft, FaChevronRight, FaTrash, FaFilePdf, FaChartBar } from 'react-icons/fa';
import { jsPDF } from 'jspdf';
import { QRCodeSVG } from 'qrcode.react';
import { PDFDownloadLink } from '@react-pdf/renderer';
import TaskQRLabel from './TaskQRLabel';
import './BuildMyChurch.css';
import AssigneeManagementItem from './AssigneeManagementItem';

// Utility function to convert URLs in text to clickable links
const convertUrlsToLinks = (text) => {
  if (!text) return text;
  
  // Regex to match URLs (http, https, ftp, etc.)
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  
  return text.split(urlRegex).map((part, index) => {
    if (urlRegex.test(part)) {
      return (
        <a 
          key={index} 
          href={part} 
          target="_blank" 
          rel="noopener noreferrer"
          style={{ color: '#3B82F6', textDecoration: 'underline' }}
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      );
    }
    return part;
  });
};

const BuildMyChurch = () => {
  const { id, taskId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [tasks, setTasks] = useState([]);
  const [topics, setTopics] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [newTopic, setNewTopic] = useState('');
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    priority: 'medium',
    status: 'not-started',
    topic: '',
    assignee: '',
    customTopic: '',
    dueDate: '',
    startDate: '',
    documents: []
  });
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [filterTopic, setFilterTopic] = useState('all');
  const [filterHasComments, setFilterHasComments] = useState('all');
  const [filterHasDocuments, setFilterHasDocuments] = useState('all');
  const [filterHasCheckedComments, setFilterHasCheckedComments] = useState('all');
  const [expandedTaskId, setExpandedTaskId] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [commentsByTask, setCommentsByTask] = useState({});
  const [newCommentText, setNewCommentText] = useState('');
  const [newCommentFiles, setNewCommentFiles] = useState([]);
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const [church, setChurch] = useState(null);
  const [activeTab, setActiveTab] = useState('tasks');
  const [availableOrganizations, setAvailableOrganizations] = useState([]);
  const [currentOrganization, setCurrentOrganization] = useState(null);
  const [organizationSearchQuery, setOrganizationSearchQuery] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [expandedDocuments, setExpandedDocuments] = useState({});
  const [showCommentForm, setShowCommentForm] = useState({});
  const tasksPerPage = 5;

  const handleLogout = async () => {
    try {
      const returnUrl = `${location.pathname}${location.search}${location.hash}`;
      await signOut(auth);
      navigate(`/church/${id}/login?returnUrl=${encodeURIComponent(returnUrl)}`);
    } catch (error) {
      console.error('Error logging out:', error);
      safeToast.error('Failed to logout');
    }
  };

  const STATUS_OPTIONS = [
    { value: 'not-started', label: 'Not Started' },
    { value: 'in-progress', label: 'In Progress' },
    { value: 'on-hold', label: 'On Hold' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' }
  ];

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
        const currentOrg = organizations.find(org => org.id === id);
        setCurrentOrganization(currentOrg);
      } else {
        // Regular users can only access their organization
        const churchesRef = collection(db, 'churches');
        const churchDoc = await getDoc(doc(churchesRef, id));
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
    const newPath = currentPath.replace(`/organization/${id}`, `/organization/${organizationId}`);
    navigate(newPath);
  };

  // Fetch available organizations when user changes
  useEffect(() => {
    if (user) {
      fetchAvailableOrganizations();
    }
  }, [user, id]);

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
        safeToast.error('Failed to load tasks');
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

    const fetchAssignees = async () => {
      try {
        const assigneesQuery = query(collection(db, 'buildAssignees'), where('churchId', '==', id));
        const snapshot = await getDocs(assigneesQuery);
        setAssignees(snapshot.docs.map(doc => ({
          id: doc.id,
          name: doc.data().name
        })));
      } catch (error) {
        console.error('Error fetching assignees:', error);
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
    fetchAssignees();
    fetchChurchData();
  }, [user, id, navigate, location]);

  useEffect(() => {
    // load comments when a task is expanded or selected
    if (expandedTaskId) {
      fetchCommentsForTask(expandedTaskId);
    }
    if (selectedTask && selectedTask.id) {
      fetchCommentsForTask(selectedTask.id);
    }
    // reset comment input when switching tasks
    setNewCommentText('');
    setNewCommentFiles([]);
    setEditingCommentId(null);
    setEditingCommentText('');
  }, [expandedTaskId, selectedTask]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isDropdownOpen && !event.target.closest('[data-dropdown]')) {
        setIsDropdownOpen(false);
        setOrganizationSearchQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isDropdownOpen]);

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
        dueDate: '',
        startDate: '',
        documents: []
      });
      safeToast.success('Task created successfully');
    } catch (error) {
      console.error('Error creating task:', error);
      safeToast.error('Failed to create task');
    }
  };

  const fetchCommentsForTask = async (taskId) => {
    if (!taskId) return;
    try {
      const commentsQuery = query(
        collection(db, 'buildTasks', taskId, 'comments'),
        orderBy('createdAt', 'desc')
      );
      const snapshot = await getDocs(commentsQuery);
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setCommentsByTask(prev => ({ ...prev, [taskId]: list }));
    } catch (error) {
      console.error('Error fetching comments for task', taskId, error);
    }
  };

  const handleAddComment = async (taskId) => {
    if (!taskId) return;
    if (!newCommentText.trim() && newCommentFiles.length === 0) {
      safeToast.error('Please enter a comment or attach a file');
      return;
    }

    try {
      setUploadingFile(true);

      // Upload files first
      const uploadedFiles = await Promise.all(newCommentFiles.map(async (file) => {
        const timestamp = Date.now();
        const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const filePath = `tasks/${id}/${taskId}/comments/${timestamp}_${safeFileName}`;
        const storageRef = ref(storage, filePath);
        const metadata = { contentType: file.type };
        const uploadTask = await uploadBytes(storageRef, file, metadata);
        const url = await getDownloadURL(uploadTask.ref);
        return {
          name: file.name,
          url,
          path: filePath,
          type: file.type,
          size: file.size,
          uploadedAt: new Date().toISOString()
        };
      }));

      const commentData = {
        text: newCommentText.trim(),
        author: {
          uid: user.uid,
          displayName: user.displayName || user.email || 'Unknown'
        },
        files: uploadedFiles,
        createdAt: new Date().toISOString(),
        inGoodStanding: false
      };

      const commentsCol = collection(db, 'buildTasks', taskId, 'comments');
      const commentRef = await addDoc(commentsCol, commentData);

      // update local state
      setCommentsByTask(prev => ({
        ...prev,
        [taskId]: [( { id: commentRef.id, ...commentData } ), ...(prev[taskId] || [])]
      }));

      setNewCommentText('');
      setNewCommentFiles([]);
      safeToast.success('Comment added');
    } catch (error) {
      console.error('Error adding comment:', error);
      safeToast.error('Failed to add comment');
    } finally {
      setUploadingFile(false);
    }
  };

  const handleDeleteComment = async (taskId, commentId) => {
    if (!window.confirm('Delete this comment?')) return;
    try {
      const commentRef = doc(db, 'buildTasks', taskId, 'comments', commentId);
      // get comment to remove files
      const commentSnap = await getDoc(commentRef);
      if (commentSnap.exists()) {
        const data = commentSnap.data();
        if (data.files && data.files.length) {
          await Promise.all(data.files.map(async (f) => {
            try { await deleteObject(ref(storage, f.path)); } catch(e){/* ignore */}
          }));
        }
      }
      await deleteDoc(commentRef);
      setCommentsByTask(prev => ({
        ...prev,
        [taskId]: (prev[taskId] || []).filter(c => c.id !== commentId)
      }));
      safeToast.success('Comment deleted');
    } catch (error) {
      console.error('Error deleting comment:', error);
      safeToast.error('Failed to delete comment');
    }
  };

  const handleUpdateComment = async (taskId, commentId) => {
    if (!editingCommentText.trim()) {
      safeToast.error('Comment cannot be empty');
      return;
    }
    try {
      const commentRef = doc(db, 'buildTasks', taskId, 'comments', commentId);
      await updateDoc(commentRef, {
        text: editingCommentText.trim(),
        updatedAt: new Date()
      });
      setCommentsByTask(prev => ({
        ...prev,
        [taskId]: (prev[taskId] || []).map(c =>
          c.id === commentId
            ? { ...c, text: editingCommentText.trim(), updatedAt: new Date() }
            : c
        )
      }));
      setEditingCommentId(null);
      setEditingCommentText('');
      safeToast.success('Comment updated');
    } catch (error) {
      console.error('Error updating comment:', error);
      safeToast.error('Failed to update comment');
    }
  };

  const handleToggleCommentStatus = async (taskId, commentId, currentStatus) => {
    try {
      const commentRef = doc(db, 'buildTasks', taskId, 'comments', commentId);
      const newStatus = !currentStatus;
      await updateDoc(commentRef, {
        inGoodStanding: newStatus,
        statusUpdatedAt: new Date(),
        statusUpdatedBy: {
          uid: user.uid,
          displayName: user.displayName || user.email
        }
      });
      setCommentsByTask(prev => ({
        ...prev,
        [taskId]: (prev[taskId] || []).map(c =>
          c.id === commentId
            ? { ...c, inGoodStanding: newStatus, statusUpdatedAt: new Date() }
            : c
        )
      }));
      safeToast.success(newStatus ? 'Marked as in good standing' : 'Unmarked');
    } catch (error) {
      console.error('Error updating comment status:', error);
      safeToast.error('Failed to update comment status');
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
      dueDate: task.dueDate || '',
      startDate: task.startDate || '',
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
        dueDate: '',
        startDate: '',
        documents: []
      });
      safeToast.success('Task updated successfully');
    } catch (error) {
      console.error('Error updating task:', error);
      safeToast.error('Failed to update task');
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
      dueDate: '',
      startDate: '',
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
      safeToast.error('Failed to add topic');
    }
  };

  const handleDeleteTask = async (taskId) => {
    if (window.confirm('Are you sure you want to delete this task?')) {
      try {
        await deleteDoc(doc(db, 'buildTasks', taskId));
        setTasks(prev => prev.filter(task => task.id !== taskId));
        safeToast.success('Task deleted successfully');
      } catch (error) {
        console.error('Error deleting task:', error);
        safeToast.error('Failed to delete task');
      }
    }
  };

  const resolveAssigneeName = (assigneeValue) => {
    if (!assigneeValue) return '';
    const match = assignees.find(a => a.id === assigneeValue || a.name === assigneeValue);
    return match ? match.name : assigneeValue;
  };

  const handleRemoveAssignee = async (assigneeId) => {
    try {
      const assigneeName = resolveAssigneeName(assigneeId);
      // Remove assignee from all tasks
      const tasksToUpdate = tasks.filter(task => task.assignee === assigneeName);
      const updatePromises = tasksToUpdate.map(task =>
        updateDoc(doc(db, 'buildTasks', task.id), { assignee: null })
      );
      await Promise.all(updatePromises);

      // Update local state
      setTasks(prev => prev.map(task =>
        task.assignee === assigneeName ? { ...task, assignee: null } : task
      ));

      safeToast.success('Assignee removed successfully');
    } catch (error) {
      console.error('Error removing assignee:', error);
      safeToast.error('Failed to remove assignee');
    }
  };

  const handleReassignTasks = async (fromAssigneeId, toAssigneeId) => {
    try {
      const fromAssigneeName = resolveAssigneeName(fromAssigneeId);
      const toAssigneeName = resolveAssigneeName(toAssigneeId);
      // Reassign all tasks from one assignee to another
      const tasksToUpdate = tasks.filter(task => task.assignee === fromAssigneeName);
      const updatePromises = tasksToUpdate.map(task =>
        updateDoc(doc(db, 'buildTasks', task.id), { assignee: toAssigneeName })
      );
      await Promise.all(updatePromises);

      // Update local state
      setTasks(prev => prev.map(task =>
        task.assignee === fromAssigneeName ? { ...task, assignee: toAssigneeName } : task
      ));

      safeToast.success('Tasks reassigned successfully');
    } catch (error) {
      console.error('Error reassigning tasks:', error);
      safeToast.error('Failed to reassign tasks');
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
          safeToast.error(`Invalid file type: ${file.name}`);
          return null;
        }

        const maxSize = 5 * 1024 * 1024;
        if (file.size > maxSize) {
          safeToast.error(`File too large: ${file.name}`);
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

      safeToast.success('Files uploaded successfully');
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

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 15;
      const contentWidth = pageWidth - (margin * 2);

      const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : 'Not set');
      const statusLabelMap = STATUS_OPTIONS.reduce((acc, option) => {
        acc[option.value] = option.label;
        return acc;
      }, {});

      const filters = [];
      if (filterPriority !== 'all') filters.push(`Priority: ${filterPriority}`);
      if (filterStatus !== 'all') filters.push(`Status: ${filterStatus}`);
      if (filterTopic !== 'all') filters.push(`Topic: ${filterTopic}`);
      if (filterHasComments !== 'all') filters.push(`Comments: ${filterHasComments}`);
      if (filterHasDocuments !== 'all') filters.push(`Documents: ${filterHasDocuments}`);
      if (filterHasCheckedComments !== 'all') filters.push(`Checked: ${filterHasCheckedComments}`);
      if (searchQuery) filters.push(`Search: "${searchQuery}"`);

      const filterText = filters.length ? filters.join(' | ') : 'None';

      const statusGroups = {
        'not-started': filteredTasks.filter(task => task.status === 'not-started'),
        'in-progress': filteredTasks.filter(task => task.status === 'in-progress'),
        'on-hold': filteredTasks.filter(task => task.status === 'on-hold'),
        'completed': filteredTasks.filter(task => task.status === 'completed'),
        'cancelled': filteredTasks.filter(task => task.status === 'cancelled')
      };

      const statusCounts = Object.keys(statusGroups).reduce((acc, key) => {
        acc[key] = statusGroups[key].length;
        return acc;
      }, {});

      const withDocumentsCount = filteredTasks.filter(task => (task.documents || []).length > 0).length;
      const withCommentsCount = filteredTasks.filter(task => (commentsByTask[task.id] || []).length > 0).length;

      const addSectionHeader = (status, count) => {
        const label = statusLabelMap[status] || status;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(31, 41, 55);
        doc.text(`${label} (${count})`, margin, 18);
        doc.setDrawColor(229, 231, 235);
        doc.line(margin, 21, pageWidth - margin, 21);
        return 28;
      };

      // Cover page
      doc.setFillColor(31, 41, 55);
      doc.rect(0, 0, pageWidth, 22, 'F');
      doc.setTextColor(255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text('Build My Organization Tasks Report', margin, 14);

      const orgName = church?.name || 'Organization';
      doc.setTextColor(31, 41, 55);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text(orgName, margin, 34);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(107, 114, 128);
      doc.text(`Generated ${new Date().toLocaleString()}`, margin, 40);
      doc.text(`Total Tasks: ${filteredTasks.length}`, pageWidth - margin, 40, { align: 'right' });

      let yOffset = 46;

      // Filters block
      const filterLines = doc.splitTextToSize(filterText, contentWidth - 10);
      const filterBlockHeight = 10 + (filterLines.length * 5);
      doc.setFillColor(243, 244, 246);
      doc.roundedRect(margin, yOffset, contentWidth, filterBlockHeight, 2, 2, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(55, 65, 81);
      doc.text('Filters', margin + 4, yOffset + 6);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(107, 114, 128);
      doc.text(filterLines, margin + 4, yOffset + 12);

      yOffset += filterBlockHeight + 10;

      // Summary block
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(31, 41, 55);
      doc.text('Summary', margin, yOffset);

      yOffset += 6;
      doc.setDrawColor(229, 231, 235);
      doc.line(margin, yOffset, pageWidth - margin, yOffset);
      yOffset += 6;

      const summaryItems = [
        ['Not Started', statusCounts['not-started']],
        ['In Progress', statusCounts['in-progress']],
        ['On Hold', statusCounts['on-hold']],
        ['Completed', statusCounts['completed']],
        ['Cancelled', statusCounts['cancelled']],
        ['With Documents', withDocumentsCount],
        ['With Comments', withCommentsCount]
      ];

      const columnWidth = contentWidth / 2;
      const rowHeight = 6;
      summaryItems.forEach((item, index) => {
        const col = index % 2;
        const row = Math.floor(index / 2);
        const x = margin + (col * columnWidth);
        const y = yOffset + (row * rowHeight);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(75, 85, 99);
        doc.text(`${item[0]}: ${item[1]}`, x, y);
      });

      yOffset += (Math.ceil(summaryItems.length / 2) * rowHeight) + 10;

      if (filteredTasks.length === 0) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(107, 114, 128);
        doc.text('No tasks match the current filters.', margin, yOffset + 4);
      } else {
        // Start details on a new page
        doc.addPage();

        let processedItems = 0;
        const totalItems = filteredTasks.length || 1;

        for (const [status, tasks] of Object.entries(statusGroups)) {
          if (tasks.length === 0) continue;

          yOffset = addSectionHeader(status, tasks.length);

          for (const task of tasks) {
            processedItems++;
            const progress = Math.round((processedItems / totalItems) * 100);
            toast.update(toastId, {
              render: `Generating PDF... ${progress}%`,
            });

            const titleText = task.title || 'Untitled task';
            const descriptionText = task.description || 'No description provided.';
            const titleLines = doc.splitTextToSize(titleText, contentWidth - 8);
            const descriptionLines = doc.splitTextToSize(descriptionText, contentWidth - 8);

            const titleHeight = titleLines.length * 6;
            const descriptionHeight = descriptionLines.length * 5;

            const detailRows = [
              [`Priority: ${task.priority || 'N/A'}`, `Status: ${statusLabelMap[task.status] || task.status || 'N/A'}`],
              [`Topic: ${task.topic || 'N/A'}`, `Assignee: ${task.assignee || 'Unassigned'}`],
              [`Start: ${formatDate(task.startDate)}`, `Due: ${formatDate(task.dueDate)}`],
              [`Created: ${formatDate(task.createdAt)}`, `Updated: ${formatDate(task.updatedAt)}`],
              [`Documents: ${task.documents?.length || 0}`, `Comments: ${(commentsByTask[task.id] || []).length}`]
            ];

            const detailHeight = (detailRows.length * 5) + 4;
            const cardHeight = 8 + titleHeight + 3 + descriptionHeight + 4 + detailHeight + 6;

            if (yOffset + cardHeight > pageHeight - 20) {
              doc.addPage();
              yOffset = addSectionHeader(status, tasks.length);
            }

            doc.setDrawColor(229, 231, 235);
            doc.setFillColor(249, 250, 251);
            doc.roundedRect(margin, yOffset, contentWidth, cardHeight, 2, 2, 'FD');

            let textY = yOffset + 8;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(11);
            doc.setTextColor(31, 41, 55);
            doc.text(titleLines, margin + 4, textY);
            textY += titleHeight + 2;

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.setTextColor(107, 114, 128);
            doc.text(descriptionLines, margin + 4, textY);
            textY += descriptionHeight + 3;

            doc.setDrawColor(229, 231, 235);
            doc.line(margin + 4, textY, pageWidth - margin - 4, textY);
            textY += 4;

            doc.setFontSize(9);
            doc.setTextColor(75, 85, 99);
            detailRows.forEach((row) => {
              doc.text(row[0], margin + 4, textY);
              doc.text(row[1], margin + (contentWidth / 2), textY);
              textY += 5;
            });

            yOffset += cardHeight + 6;
          }
        }
      }

      // Page numbers
      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(156, 163, 175);
        doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, pageHeight - 8, { align: 'center' });
      }

      toast.update(toastId, {
        render: 'Finalizing PDF...',
      });

      let filename = 'build-my-church-tasks';
      if (filters.length) {
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
    
    const taskComments = commentsByTask[task.id] || [];
    const hasComments = taskComments.length > 0;
    const matchesHasComments = filterHasComments === 'all' || 
      (filterHasComments === 'with' && hasComments) || 
      (filterHasComments === 'without' && !hasComments);
    
    const hasDocuments = (task.documents || []).length > 0;
    const matchesHasDocuments = filterHasDocuments === 'all' || 
      (filterHasDocuments === 'with' && hasDocuments) || 
      (filterHasDocuments === 'without' && !hasDocuments);
    
    const hasCheckedComments = taskComments.some(c => c.inGoodStanding);
    const matchesHasCheckedComments = filterHasCheckedComments === 'all' || 
      (filterHasCheckedComments === 'with' && hasCheckedComments) || 
      (filterHasCheckedComments === 'without' && !hasCheckedComments);

    return matchesSearch && matchesStatus && matchesPriority && matchesTopic && 
           matchesHasComments && matchesHasDocuments && matchesHasCheckedComments;
  });

  const indexOfLastTask = currentPage * tasksPerPage;
  const indexOfFirstTask = indexOfLastTask - tasksPerPage;
  const currentTasks = filteredTasks.slice(indexOfFirstTask, indexOfLastTask);
  const totalPages = Math.ceil(filteredTasks.length / tasksPerPage);

  const handlePageChange = (pageNumber) => {
    setCurrentPage(pageNumber);
  };

  const handleTaskClick = async (task) => {
    if (!task || !task.id) return;
    setSelectedTask(task);
    navigate(`/organization/${id}/build-my-church/task/${task.id}`, {
      state: { from: `${location.pathname}${location.search}${location.hash}` }
    });
  };

  const handleCloseDetailView = () => {
    setSelectedTask(null);
    if (taskId) {
      navigate(`/organization/${id}/build-my-church`, { replace: true });
    }
  };

  const getTaskUrl = (taskId) => {
    return `${window.location.origin}/organization/${id}/build-my-church/task/${taskId}`;
  };

  useEffect(() => {
    if (!taskId || tasks.length === 0) return;

    if (!location.state?.from) {
      setFilterStatus('all');
      setFilterPriority('all');
      setFilterTopic('all');
      setFilterHasComments('all');
      setFilterHasDocuments('all');
      setFilterHasCheckedComments('all');
      setSearchQuery('');
    }

    const matchedTask = tasks.find(task => task.id === taskId);
    if (!matchedTask) return;

    setSelectedTask(matchedTask);
    setExpandedTaskId(taskId);

    const taskIndex = tasks.findIndex(task => task.id === taskId);
    if (taskIndex >= 0) {
      setCurrentPage(Math.floor(taskIndex / tasksPerPage) + 1);
    }

    requestAnimationFrame(() => {
      const taskElement = document.querySelector(`[data-task-id="${taskId}"]`);
      if (taskElement) {
        taskElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }, [taskId, tasks, location.state]);

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
            {(task.startDate || task.dueDate) && (
              <div style={{ display: "flex", gap: "20px", marginTop: "8px", fontSize: "14px" }}>
                {task.startDate && (
                  <div style={{ color: "#2563EB" }}>
                    <strong>📅 Start:</strong> {new Date(task.startDate).toLocaleDateString()}
                  </div>
                )}
                {task.dueDate && (
                  <div style={{ color: "#D97706" }}>
                    <strong>⏰ Due:</strong> {new Date(task.dueDate).toLocaleDateString()}
                  </div>
                )}
              </div>
            )}
          </div>

          {task.documents && task.documents.length > 0 && (
            <div style={{ marginBottom: "20px" }} onClick={(e) => e.stopPropagation()}>
              <h3 
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedDocuments(prev => ({...prev, [task.id]: !prev[task.id]}));
                }}
                style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', userSelect: 'none' }}
              >
                {expandedDocuments[task.id] ? <FaChevronDown /> : <FaChevronRight />}
                Documents ({task.documents.length})
              </h3>
              {expandedDocuments[task.id] && (
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
              )}
            </div>
          )}

          <div style={{ marginBottom: '20px' }}>
            <h3>Comments</h3>
            {!showCommentForm[task.id] ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowCommentForm(prev => ({...prev, [task.id]: true}));
                }}
                style={{ padding: '8px 16px', backgroundColor: '#4F46E5', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', marginBottom: '10px' }}
              >
                + Add Comment
              </button>
            ) : (
              <div style={{ marginBottom: '10px' }}>
                <textarea
                  value={newCommentText}
                  onChange={(e) => setNewCommentText(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  placeholder="Add a comment..."
                  rows={3}
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #E5E7EB' }}
                />
                <input
                  type="file"
                  multiple
                  onChange={(e) => setNewCommentFiles(Array.from(e.target.files))}
                  onClick={(e) => e.stopPropagation()}
                  style={{ marginTop: '8px' }}
                />
                <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
                  <button
                    onClick={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      await handleAddComment(task.id);
                      setShowCommentForm(prev => ({...prev, [task.id]: false}));
                    }}
                    style={{ padding: '8px 12px', backgroundColor: '#10B981', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                  >Submit</button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowCommentForm(prev => ({...prev, [task.id]: false}));
                      setNewCommentText('');
                      setNewCommentFiles([]);
                    }}
                    style={{ padding: '8px 12px', backgroundColor: '#6B7280', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                  >Cancel</button>
                </div>
              </div>
            )}

            <div>
              {(commentsByTask[task.id] || []).length === 0 && (
                <div style={{ color: '#6B7280' }}>No comments yet</div>
              )}
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {(commentsByTask[task.id] || []).map(comment => (
                  <li key={comment.id} style={{ marginBottom: '12px', padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #E5E7EB' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleToggleCommentStatus(task.id, comment.id, comment.inGoodStanding);
                          }}
                          className={`comment-status-checkbox ${comment.inGoodStanding ? 'checked' : ''}`}
                          title={comment.inGoodStanding ? 'In good standing - Click to unmark' : 'Click to mark as in good standing'}
                        >
                          {comment.inGoodStanding && (
                            <FaCheck style={{ color: 'white', fontSize: '14px' }} />
                          )}
                        </button>
                        <div style={{ fontWeight: 600 }}>{comment.author?.displayName || comment.author?.uid}</div>
                      </div>
                      <div style={{ color: '#6B7280', fontSize: '12px' }}>
                        {new Date(comment.createdAt).toLocaleString()}
                        {comment.updatedAt && comment.updatedAt !== comment.createdAt && (
                          <span> (edited)</span>
                        )}
                      </div>
                    </div>
                    {editingCommentId === comment.id ? (
                      <div style={{ marginTop: '6px' }}>
                        <textarea
                          value={editingCommentText}
                          onChange={(e) => setEditingCommentText(e.target.value)}
                          rows={3}
                          style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #E5E7EB' }}
                        />
                        <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleUpdateComment(task.id, comment.id);
                            }}
                            style={{ padding: '4px 8px', backgroundColor: '#10B981', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setEditingCommentId(null);
                              setEditingCommentText('');
                            }}
                            style={{ padding: '4px 8px', backgroundColor: '#6B7280', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ whiteSpace: 'pre-wrap', marginTop: '6px' }}>{convertUrlsToLinks(comment.text)}</div>
                    )}
                    {comment.files && comment.files.length > 0 && (
                      <div style={{ marginTop: '8px' }}>
                        <strong>Attachments:</strong>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '8px' }}>
                          {comment.files.map((f, i) => {
                            const isImage = /\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i.test(f.name);
                            return (
                              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                {isImage ? (
                                  <a href={f.url} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
                                    <img 
                                      src={f.url} 
                                      alt={f.name}
                                      style={{ 
                                        maxWidth: '150px', 
                                        maxHeight: '150px', 
                                        objectFit: 'cover',
                                        borderRadius: '6px',
                                        border: '1px solid #E5E7EB',
                                        cursor: 'pointer'
                                      }}
                                    />
                                  </a>
                                ) : (
                                  <a href={f.url} target="_blank" rel="noreferrer" style={{ color: '#3B82F6' }}>
                                    📄 {f.name}
                                  </a>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <div style={{ marginTop: '8px' }}>
                      {(user && (user.uid === comment.author?.uid || user.role === 'admin' || user.role === 'global_admin')) && editingCommentId !== comment.id && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setEditingCommentId(comment.id);
                              setEditingCommentText(comment.text);
                            }}
                            style={{ background: 'none', border: 'none', color: '#3B82F6', cursor: 'pointer', marginRight: '8px' }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteComment(task.id, comment.id)}
                            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>

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
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleEditTask(task);
              }}
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

  const AssigneeSelect = React.memo(({ value, onChange, placeholder = "Select or add assignee" }) => {
    const [isAddingNew, setIsAddingNew] = useState(false);
    const [newAssigneeName, setNewAssigneeName] = useState('');

    const handleAddAssignee = async () => {
      if (!newAssigneeName.trim()) return;
      
      try {
        const assigneeRef = await addDoc(collection(db, 'buildAssignees'), {
          name: newAssigneeName.trim(),
          churchId: id,
          createdAt: new Date().toISOString()
        });
        setAssignees(prev => [...prev, { id: assigneeRef.id, name: newAssigneeName.trim() }]);
        onChange(newAssigneeName.trim());
        setNewAssigneeName('');
        setIsAddingNew(false);
        toast.success('Assignee added successfully');
      } catch (error) {
        console.error('Error adding assignee:', error);
        toast.error('Failed to add assignee');
      }
    };

    const handleSelectChange = (e) => {
      const selectedValue = e.target.value;
      if (selectedValue === 'add-new') {
        setIsAddingNew(true);
      } else {
        onChange(selectedValue);
      }
    };

    return (
      <div style={{ position: 'relative' }}>
        {!isAddingNew ? (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select
              value={value || ''}
              onChange={handleSelectChange}
              className="form-input"
              style={{ flex: 1 }}
            >
              <option value="">{placeholder}</option>
              {assignees.map(assignee => (
                <option key={assignee.id} value={assignee.name}>
                  {assignee.name}
                </option>
              ))}
              <option value="add-new">+ Add New Assignee</option>
            </select>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="text"
              value={newAssigneeName}
              onChange={(e) => setNewAssigneeName(e.target.value)}
              placeholder="Enter new assignee name"
              className="form-input"
              style={{ flex: 1 }}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleAddAssignee();
                }
              }}
              autoFocus
            />
            <button
              type="button"
              onClick={handleAddAssignee}
              style={{
                padding: '8px 12px',
                backgroundColor: '#10B981',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              ✓
            </button>
            <button
              type="button"
              onClick={() => {
                setIsAddingNew(false);
                setNewAssigneeName('');
              }}
              style={{
                padding: '8px 12px',
                backgroundColor: '#6B7280',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              ✕
            </button>
          </div>
        )}
      </div>
    );
  });

  return (
    <div className="build-my-church-container" style={{ position: "relative" }}>
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
                fontWeight: "500"
              }}
            >
              <span>
                {currentOrganization ? (currentOrganization.nombre || currentOrganization.name || currentOrganization.churchId || currentOrganization.id) : 'Select organization...'}
              </span>
              <FaChevronDown style={{ 
                transform: isDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s'
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
                maxHeight: "200px",
                overflowY: "auto"
              }}>
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
                          backgroundColor: org.id === id ? "#f3f4f6" : "white",
                          borderBottom: "1px solid #f3f4f6",
                          fontWeight: org.id === id ? "600" : "500"
                        }}
                        onMouseEnter={(e) => e.target.style.backgroundColor = "#f9fafb"}
                        onMouseLeave={(e) => e.target.style.backgroundColor = org.id === id ? "#f3f4f6" : "white"}
                      >
                        {org.nombre || org.name || org.churchId || org.id}
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <Link to={`/organization/${id}/mi-organizacion`} className="back-link">
        ← Back to Organization
      </Link>

      <ChurchHeader id={id} applyShadow={false} />
      
      <div className="build-content">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <h1 className="page-title">Build my Organization</h1>
            {currentOrganization && (
              <div style={{ fontSize: "0.875rem", color: "#6b7280", fontWeight: "500" }}>
                {currentOrganization.nombre || currentOrganization.name || currentOrganization.churchId || currentOrganization.id}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
            <button
              onClick={() => navigate(`/organization/${id}/build/bi-dashboard`)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.75rem 1.5rem",
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                color: "white",
                border: "none",
                borderRadius: "0.5rem",
                cursor: "pointer",
                fontSize: "0.875rem",
                fontWeight: "600",
                transition: "transform 0.2s, box-shadow 0.2s"
              }}
              onMouseOver={(e) => {
                e.target.style.transform = "translateY(-1px)";
                e.target.style.boxShadow = "0 4px 12px rgba(102, 126, 234, 0.4)";
              }}
              onMouseOut={(e) => {
                e.target.style.transform = "translateY(0)";
                e.target.style.boxShadow = "none";
              }}
            >
              <FaChartBar /> Business Intelligence
            </button>
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
            <button
              onClick={handleLogout}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.75rem 1.5rem",
                backgroundColor: "#ef4444",
                color: "white",
                border: "none",
                borderRadius: "0.5rem",
                cursor: "pointer",
                fontSize: "0.875rem",
                fontWeight: "600"
              }}
            >
              Logout
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="tabs-container">
          <button
            className={`tab-button ${activeTab === 'tasks' ? 'active' : ''}`}
            onClick={() => setActiveTab('tasks')}
          >
            📋 Tasks
          </button>
          <button
            className={`tab-button ${activeTab === 'assignees' ? 'active' : ''}`}
            onClick={() => setActiveTab('assignees')}
          >
            👥 Manage Assignees
          </button>
          <button
            className={`tab-button ${activeTab === 'progress' ? 'active' : ''}`}
            onClick={() => setActiveTab('progress')}
          >
            📊 Progress Status
          </button>
        </div>

        {activeTab === 'tasks' && (
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
                <AssigneeSelect
                  value={newTask.assignee}
                  onChange={(assignee) => setNewTask({...newTask, assignee})}
                  placeholder="Select or add assignee"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Start Date</label>
                <input
                  type="date"
                  className="form-input"
                  value={newTask.startDate}
                  onChange={(e) => setNewTask({...newTask, startDate: e.target.value})}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Due Date</label>
                <input
                  type="date"
                  className="form-input"
                  value={newTask.dueDate}
                  onChange={(e) => setNewTask({...newTask, dueDate: e.target.value})}
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
                <select
                  value={filterHasComments}
                  onChange={(e) => setFilterHasComments(e.target.value)}
                  className="filter-select"
                >
                  <option value="all">All Comments</option>
                  <option value="with">With Comments</option>
                  <option value="without">Without Comments</option>
                </select>
                <select
                  value={filterHasDocuments}
                  onChange={(e) => setFilterHasDocuments(e.target.value)}
                  className="filter-select"
                >
                  <option value="all">All Documents</option>
                  <option value="with">With Documents</option>
                  <option value="without">Without Documents</option>
                </select>
                <select
                  value={filterHasCheckedComments}
                  onChange={(e) => setFilterHasCheckedComments(e.target.value)}
                  className="filter-select"
                >
                  <option value="all">All Checked</option>
                  <option value="with">With Checked Comments</option>
                  <option value="without">Without Checked Comments</option>
                </select>
              </div>
              
              {(filterStatus !== 'all' || filterPriority !== 'all' || filterTopic !== 'all' || 
                filterHasComments !== 'all' || filterHasDocuments !== 'all' || filterHasCheckedComments !== 'all') && (
                <button
                  onClick={() => {
                    setFilterStatus('all');
                    setFilterPriority('all');
                    setFilterTopic('all');
                    setFilterHasComments('all');
                    setFilterHasDocuments('all');
                    setFilterHasCheckedComments('all');
                    setSearchQuery('');
                  }}
                  className="clear-filters-button"
                  style={{
                    marginTop: '10px',
                    padding: '8px 16px',
                    backgroundColor: '#6366f1',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '500'
                  }}
                >
                  Clear All Filters
                </button>
              )}
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
                      data-task-id={task.id}
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
                            <AssigneeSelect
                              value={newTask.assignee}
                              onChange={(assignee) => setNewTask({...newTask, assignee})}
                              placeholder="Select or add assignee"
                            />
                          </div>

                          <div className="form-group">
                            <label className="form-label">Start Date</label>
                            <input
                              type="date"
                              className="form-input"
                              value={newTask.startDate}
                              onChange={(e) => setNewTask({...newTask, startDate: e.target.value})}
                            />
                          </div>

                          <div className="form-group">
                            <label className="form-label">Due Date</label>
                            <input
                              type="date"
                              className="form-input"
                              value={newTask.dueDate}
                              onChange={(e) => setNewTask({...newTask, dueDate: e.target.value})}
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
                            {task.startDate && (
                              <span className="date-badge start-date">
                                <span className="date-icon">📅</span>
                                Start: {new Date(task.startDate).toLocaleDateString()}
                              </span>
                            )}
                            {task.dueDate && (
                              <span className="date-badge due-date">
                                <span className="date-icon">⏰</span>
                                Due: {new Date(task.dueDate).toLocaleDateString()}
                              </span>
                            )}
                            <span className={`priority-badge ${task.priority}`}>
                              {task.priority.toUpperCase()}
                            </span>
                            <span className={`status-badge ${task.status}`}>
                              {task.status.toUpperCase()}
                            </span>
                            {(() => {
                              const commentCount = (commentsByTask[task.id] || []).length;
                              const checkedCount = (commentsByTask[task.id] || []).filter(c => c.inGoodStanding).length;
                              const docCount = (task.documents || []).length;
                              return (
                                <>
                                  {commentCount > 0 && (
                                    <span className="status-badge" style={{ background: '#6366F1', color: 'white' }} title={`${commentCount} comment(s), ${checkedCount} checked`}>
                                      💬 {commentCount} {checkedCount > 0 && `(✓${checkedCount})`}
                                    </span>
                                  )}
                                  {docCount > 0 && (
                                    <span className="status-badge" style={{ background: '#8B5CF6', color: 'white' }} title={`${docCount} document(s)`}>
                                      📄 {docCount}
                                    </span>
                                  )}
                                </>
                              );
                            })()}
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
                                <div className="documents-section" onClick={(e) => e.stopPropagation()}>
                                  <h4 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedDocuments(prev => ({...prev, [`detail-${task.id}`]: !prev[`detail-${task.id}`]}));
                                    }}
                                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', userSelect: 'none' }}
                                  >
                                    {expandedDocuments[`detail-${task.id}`] ? <FaChevronDown /> : <FaChevronRight />}
                                    Documents ({task.documents.length})
                                  </h4>
                                  {expandedDocuments[`detail-${task.id}`] && (
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
                                  )}
                                </div>
                              )}
                              <div className="comments-section">
                                <h4>Comments</h4>
                                {!showCommentForm[`detail-${task.id}`] ? (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setShowCommentForm(prev => ({...prev, [`detail-${task.id}`]: true}));
                                    }}
                                    style={{ padding: '8px 16px', backgroundColor: '#4F46E5', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', marginBottom: '10px' }}
                                  >
                                    + Add Comment
                                  </button>
                                ) : (
                                  <div style={{ marginBottom: '10px' }}>
                                    <textarea
                                      value={newCommentText}
                                      onChange={(e) => setNewCommentText(e.target.value)}
                                      onClick={(e) => e.stopPropagation()}
                                      placeholder="Add a comment..."
                                      rows={3}
                                      style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #E5E7EB' }}
                                    />
                                    <input
                                      type="file"
                                      multiple
                                      onChange={(e) => setNewCommentFiles(Array.from(e.target.files))}
                                      onClick={(e) => e.stopPropagation()}
                                      style={{ marginTop: '8px' }}
                                    />
                                    <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
                                      <button
                                        type="button"
                                        onClick={async (e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          await handleAddComment(task.id);
                                          setShowCommentForm(prev => ({...prev, [`detail-${task.id}`]: false}));
                                        }}
                                        className="add-comment-button"
                                      >
                                        Submit
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setShowCommentForm(prev => ({...prev, [`detail-${task.id}`]: false}));
                                          setNewCommentText('');
                                          setNewCommentFiles([]);
                                        }}
                                        style={{ padding: '8px 16px', backgroundColor: '#6B7280', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                )}

                                <div>
                                  {(commentsByTask[task.id] || []).length === 0 && (
                                    <div style={{ color: '#6B7280' }}>No comments yet</div>
                                  )}
                                  <ul style={{ listStyle: 'none', padding: 0 }}>
                                    {(commentsByTask[task.id] || []).map(comment => (
                                      <li key={comment.id} style={{ marginBottom: '12px', padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #E5E7EB' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                handleToggleCommentStatus(task.id, comment.id, comment.inGoodStanding);
                                              }}
                                              className={`comment-status-checkbox ${comment.inGoodStanding ? 'checked' : ''}`}
                                              title={comment.inGoodStanding ? 'In good standing - Click to unmark' : 'Click to mark as in good standing'}
                                            >
                                              {comment.inGoodStanding && (
                                                <FaCheck style={{ color: 'white', fontSize: '14px' }} />
                                              )}
                                            </button>
                                            <div style={{ fontWeight: 600 }}>{comment.author?.displayName || comment.author?.uid}</div>
                                          </div>
                                          <div style={{ color: '#6B7280', fontSize: '12px' }}>
                                            {new Date(comment.createdAt).toLocaleString()}
                                            {comment.updatedAt && comment.updatedAt !== comment.createdAt && (
                                              <span> (edited)</span>
                                            )}
                                          </div>
                                        </div>
                                        {editingCommentId === comment.id ? (
                                          <div style={{ marginTop: '6px' }}>
                                            <textarea
                                              value={editingCommentText}
                                              onChange={(e) => setEditingCommentText(e.target.value)}
                                              onClick={(e) => e.stopPropagation()}
                                              rows={3}
                                              style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #E5E7EB' }}
                                            />
                                            <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                                  handleUpdateComment(task.id, comment.id);
                                                }}
                                                style={{ padding: '4px 8px', backgroundColor: '#10B981', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                                              >
                                                Save
                                              </button>
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                                  setEditingCommentId(null);
                                                  setEditingCommentText('');
                                                }}
                                                style={{ padding: '4px 8px', backgroundColor: '#6B7280', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                                              >
                                                Cancel
                                              </button>
                                            </div>
                                          </div>
                                        ) : (
                                          <div style={{ whiteSpace: 'pre-wrap', marginTop: '6px' }}>{convertUrlsToLinks(comment.text)}</div>
                                        )}
                                        {comment.files && comment.files.length > 0 && (
                                          <div style={{ marginTop: '8px' }}>
                                            <strong>Attachments:</strong>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '8px' }}>
                                              {comment.files.map((f, i) => {
                                                const isImage = /\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i.test(f.name);
                                                return (
                                                  <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                                    {isImage ? (
                                                      <a href={f.url} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
                                                        <img 
                                                          src={f.url} 
                                                          alt={f.name}
                                                          style={{ 
                                                            maxWidth: '150px', 
                                                            maxHeight: '150px', 
                                                            objectFit: 'cover',
                                                            borderRadius: '6px',
                                                            border: '1px solid #E5E7EB',
                                                            cursor: 'pointer'
                                                          }}
                                                        />
                                                      </a>
                                                    ) : (
                                                      <a href={f.url} target="_blank" rel="noreferrer" style={{ color: '#3B82F6' }}>
                                                        📄 {f.name}
                                                      </a>
                                                    )}
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          </div>
                                        )}
                                        <div style={{ marginTop: '8px' }}>
                                          {(user && (user.uid === comment.author?.uid || user.role === 'admin' || user.role === 'global_admin')) && editingCommentId !== comment.id && (
                                            <>
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                                  setEditingCommentId(comment.id);
                                                  setEditingCommentText(comment.text);
                                                }}
                                                style={{ background: 'none', border: 'none', color: '#3B82F6', cursor: 'pointer', marginRight: '8px' }}
                                              >
                                                Edit
                                              </button>
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                                  handleDeleteComment(task.id, comment.id);
                                                }}
                                                className="delete-comment-button"
                                                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}
                                              >
                                                Delete
                                              </button>
                                            </>
                                          )}
                                        </div>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              </div>
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
        )}

        {activeTab === 'assignees' && (
          <div className="assignees-content">
            <div className="assignees-header">
              <h2 className="section-title">Manage Assignees</h2>
              <p className="assignees-description">
                Manage team members and reassign their tasks when needed.
              </p>
            </div>
            <div className="assignees-list">
              {assignees.length === 0 ? (
                <div className="no-assignees">
                  <div className="empty-icon">👥</div>
                  <h3>No Assignees Yet</h3>
                  <p>Assignees will appear here when you assign them to tasks.</p>
                </div>
              ) : (
                assignees.map(assignee => (
                  <AssigneeManagementItem
                    key={assignee.id}
                    assignee={assignee}
                    allAssignees={assignees}
                    tasks={tasks}
                    onRemove={handleRemoveAssignee}
                    onReassign={handleReassignTasks}
                  />
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'progress' && (
          <div className="progress-content">
            <div className="progress-header">
              <h2 className="section-title">Task Progress Overview</h2>
              <p className="progress-description">
                View all tasks organized by their current progress status.
              </p>
            </div>
            <div className="progress-grid">
              {STATUS_OPTIONS.map(status => {
                const statusTasks = tasks.filter(task => task.status === status.value);
                return (
                  <div key={status.value} className="status-column">
                    <div className="status-header">
                      <h3 className="status-title">{status.label}</h3>
                      <span className="status-count">{statusTasks.length}</span>
                    </div>
                    <div className="status-tasks">
                      {statusTasks.length === 0 ? (
                        <div className="empty-status">
                          <div className="empty-icon">📝</div>
                          <p>No tasks in this status</p>
                        </div>
                      ) : (
                        statusTasks.map(task => (
                          <div
                            key={task.id}
                            className="progress-task-card"
                            onClick={() => handleTaskClick(task)}
                          >
                            <div className="progress-task-header">
                              <h4 className="progress-task-title">{task.title}</h4>
                              <span className={`progress-priority ${task.priority}`}>
                                {task.priority}
                              </span>
                            </div>
                            <p className="progress-task-description">
                              {task.description.length > 100
                                ? `${task.description.substring(0, 100)}...`
                                : task.description}
                            </p>
                            <div className="progress-task-meta">
                              <span className="progress-assignee">
                                {task.assignee ? `👤 ${task.assignee}` : 'Unassigned'}
                              </span>
                              <span className="progress-due-date">
                                {task.dueDate ? `📅 ${new Date(task.dueDate).toLocaleDateString()}` : ''}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {selectedTask && <DetailView task={selectedTask} />}
    </div>
  );
};

export default BuildMyChurch;
