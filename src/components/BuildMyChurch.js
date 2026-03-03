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
  getDoc,
  arrayUnion,
  limit
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
import TaskGantt from './TaskGantt';
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

const generateUniqueTicketId = (takenIds) => {
  const normalized = new Set(Array.from(takenIds || []).map(value => String(value)));

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = String(Math.floor(1000 + Math.random() * 1000));
    if (!normalized.has(candidate)) return candidate;
  }

  const fallback = `1${String(Date.now()).slice(-3)}`;
  if (!normalized.has(fallback)) return fallback;

  return `1${Math.floor(Math.random() * 1000)}`;
};

const isValidTicketId = (value) => /^1\d{3}$/.test(String(value));

const formatBrimValue = (val) => {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') {
    if (val.toDate && typeof val.toDate === 'function') {
      try { return val.toDate().toLocaleString(); } catch (e) { return ''; }
    }
    try { return JSON.stringify(val); } catch (e) { return String(val); }
  }
  return String(val);
};

const buildBrimRowLabel = (data, fallbackId, preferredColumn) => {
  if (!data) return `Row ${fallbackId}`;
  if (preferredColumn && data[preferredColumn] !== undefined && data[preferredColumn] !== null) {
    const directValue = String(data[preferredColumn]).trim();
    if (directValue !== '') return directValue;
  }
  const preferredKeys = ['name', 'title', 'brand', 'company', 'organization', 'org', 'church', 'project'];
  const entries = Object.entries(data);
  for (const key of preferredKeys) {
    const hit = entries.find(([k]) => String(k).toLowerCase().replace(/\s+/g, '') === key);
    if (hit && hit[1] !== undefined && hit[1] !== null && String(hit[1]).trim() !== '') {
      return String(hit[1]).trim();
    }
  }
  const firstValue = entries.find(([, v]) => v !== undefined && v !== null && String(v).trim() !== '');
  if (firstValue) return String(firstValue[1]).trim();
  return `Row ${fallbackId}`;
};

const formatBrimCommentDate = (val) => {
  if (!val) return '';
  if (val.toDate && typeof val.toDate === 'function') {
    try { return val.toDate().toLocaleString(); } catch (e) { return ''; }
  }
  if (val.seconds !== undefined) {
    try { return new Date(val.seconds * 1000).toLocaleString(); } catch (e) { return ''; }
  }
  try { return new Date(val).toLocaleString(); } catch (e) { return String(val); }
};

const normalizeAssigneeList = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return [value].filter(Boolean);
};

const formatAssigneeDisplay = (value) => normalizeAssigneeList(value).join(', ');

const removeAssigneeValue = (value, assigneeName) => {
  const next = normalizeAssigneeList(value).filter(name => name !== assigneeName);
  return next.length ? next : null;
};

const replaceAssigneeValue = (value, fromName, toName) => {
  const next = normalizeAssigneeList(value).map(name => (name === fromName ? toName : name));
  const deduped = Array.from(new Set(next.filter(Boolean)));
  return deduped.length ? deduped : null;
};

const isBrimImageAttachment = (attachment) => {
  if (!attachment) return false;
  if (attachment.contentType && attachment.contentType.startsWith('image/')) return true;
  const name = (attachment.name || '').toLowerCase();
  return name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.gif') || name.endsWith('.webp');
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
    ticketId: '',
    priority: 'medium',
    status: 'ready',
    topic: '',
    assignee: [],
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
  const [commentsByTask, setCommentsByTask] = useState({});
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const [church, setChurch] = useState(null);
  const [activeTab, setActiveTab] = useState('tasks');
  const [agileTasks, setAgileTasks] = useState([]);
  const [agileMigrating, setAgileMigrating] = useState(false);
  const [agileAutoMigrated, setAgileAutoMigrated] = useState(false);
  const [draggingAgileId, setDraggingAgileId] = useState(null);
  const [agileDragOverStatus, setAgileDragOverStatus] = useState(null);
  const [agileDetailTaskId, setAgileDetailTaskId] = useState(null);
  const [agileDetailTask, setAgileDetailTask] = useState(null);
  const [agileDetailLoading, setAgileDetailLoading] = useState(false);
  const [agileLoaded, setAgileLoaded] = useState(false);
  const [agileActivity, setAgileActivity] = useState([]);
  const [agileComments, setAgileComments] = useState([]);
  const [agileCommentDraft, setAgileCommentDraft] = useState('');
  const [agileCommentFiles, setAgileCommentFiles] = useState([]);
  const [agileCommentUploading, setAgileCommentUploading] = useState(false);
  const [agileBrimSearch, setAgileBrimSearch] = useState('');
  const [agileSelectedBrimRowId, setAgileSelectedBrimRowId] = useState('');
  const [agileEdit, setAgileEdit] = useState({
    title: '',
    description: '',
    assignee: '',
    project: '',
    status: 'ready',
    priority: 'medium'
  });
  const [ticketBackfilled, setTicketBackfilled] = useState(false);
  const [availableOrganizations, setAvailableOrganizations] = useState([]);
  const [currentOrganization, setCurrentOrganization] = useState(null);
  const [organizationSearchQuery, setOrganizationSearchQuery] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [expandedDocuments, setExpandedDocuments] = useState({});
  const [showCommentForm, setShowCommentForm] = useState({});
  const [brimRows, setBrimRows] = useState([]);
  const [brimRowsLoading, setBrimRowsLoading] = useState(false);
  const [brimRowsError, setBrimRowsError] = useState(null);
  const [brimLabelColumn, setBrimLabelColumn] = useState('');
  const [savingBrimLinks, setSavingBrimLinks] = useState(false);
  const [brimRowDetailId, setBrimRowDetailId] = useState(null);
  const [brimRowDetail, setBrimRowDetail] = useState(null);
  const [brimRowDetailLoading, setBrimRowDetailLoading] = useState(false);
  const [brimRowComments, setBrimRowComments] = useState([]);
  const [brimRowCommentsLoading, setBrimRowCommentsLoading] = useState(false);
  const [brimRowCommentsError, setBrimRowCommentsError] = useState(null);
  const tasksPerPage = 5;

  const handleLogout = async () => {
    try {
      const returnUrl = `${location.pathname}${location.search}${location.hash}`;
      await signOut(auth);
      navigate(`/organization/${id}/login?returnUrl=${encodeURIComponent(returnUrl)}`);
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

  const AGILE_STATUSES = [
    { value: 'ready', label: 'Ready to be assigned' },
    { value: 'assigned', label: 'Assigned' },
    { value: 'in-progress', label: 'In Progress' },
    { value: 'uat-internal', label: 'UAT Internal' },
    { value: 'uat-customer', label: 'UAT Customer' },
    { value: 'completed', label: 'Completed' },
    { value: 'show-stoppers', label: 'Show Stoppers' }
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

  const getProjectColor = (projectName) => {
    if (!projectName) return '#64748b';
    let hash = 0;
    for (let i = 0; i < projectName.length; i += 1) {
      hash = projectName.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 65%, 45%)`;
  };

  const getAgileStatusLabel = (value) => {
    const match = AGILE_STATUSES.find(status => status.value === value);
    return match ? match.label : value;
  };

  const dedupeAgileTasks = (list) => {
    const sorted = [...list].sort((a, b) => {
      const aTime = new Date(a.createdAt || 0).getTime();
      const bTime = new Date(b.createdAt || 0).getTime();
      return bTime - aTime;
    });

    const seen = new Set();
    const output = [];

    sorted.forEach((task) => {
      const key = task.sourceTaskId
        ? `source:${task.sourceTaskId}`
        : (task.ticketId ? `ticket:${task.ticketId}` : `id:${task.id}`);

      if (seen.has(key)) return;
      seen.add(key);
      output.push(task);
    });

    return output;
  };

  const updateAgileTaskState = (taskId, patch) => {
    setAgileTasks(prev => prev.map(task =>
      task.id === taskId ? { ...task, ...patch } : task
    ));
    setAgileDetailTask(prev => (prev && prev.id === taskId ? { ...prev, ...patch } : prev));
  };

  const logAgileActivity = async (taskId, entry) => {
    const activityEntry = {
      ...entry,
      user: {
        uid: user?.uid || 'unknown',
        displayName: user?.displayName || user?.email || 'Unknown'
      },
      createdAt: new Date().toISOString()
    };

    await addDoc(collection(db, 'agileTasks', taskId, 'activity'), activityEntry);
    setAgileActivity(prev => [activityEntry, ...prev]);
  };

  const fetchAgileDetail = async (taskId) => {
    if (!taskId) return;
    setAgileDetailLoading(true);
    try {
      const activityBase = collection(db, 'agileTasks', taskId, 'activity');
      const commentsBase = collection(db, 'agileTasks', taskId, 'comments');

      const activityQuery = query(activityBase, orderBy('createdAt', 'desc'));
      const commentsQuery = query(commentsBase, orderBy('createdAt', 'desc'));

      let activitySnapshot;
      let commentsSnapshot;

      try {
        activitySnapshot = await getDocs(activityQuery);
      } catch (innerError) {
        if (innerError?.code === 'failed-precondition') {
          activitySnapshot = await getDocs(activityBase);
        } else {
          throw innerError;
        }
      }

      try {
        commentsSnapshot = await getDocs(commentsQuery);
      } catch (innerError) {
        if (innerError?.code === 'failed-precondition') {
          commentsSnapshot = await getDocs(commentsBase);
        } else {
          throw innerError;
        }
      }

      const activityList = activitySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const commentsList = commentsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      setAgileActivity(activityList);
      setAgileComments(commentsList);
    } catch (error) {
      console.error('Error fetching agile detail:', error);
      safeToast.error('Failed to load task details');
    } finally {
      setAgileDetailLoading(false);
    }
  };

  const openAgileDetail = (task) => {
    setAgileDetailTaskId(task.id);
    setAgileDetailTask(task);
    setAgileEdit({
      title: task.title || '',
      description: task.description || '',
      assignee: task.assignee || '',
      project: task.project || '',
      status: task.status || 'ready',
      priority: task.priority || 'medium'
    });
    setAgileCommentDraft('');
    setAgileCommentFiles([]);
    setAgileBrimSearch('');
    setAgileSelectedBrimRowId('');
    fetchAgileDetail(task.id);
  };

  const closeAgileDetail = () => {
    setAgileDetailTaskId(null);
    setAgileDetailTask(null);
    setAgileActivity([]);
    setAgileComments([]);
    setAgileCommentDraft('');
    setAgileCommentFiles([]);
    setAgileBrimSearch('');
    setAgileSelectedBrimRowId('');
  };

  const mapBuildStatusToAgile = (status) => {
    switch (status) {
      case 'not-started':
        return 'ready';
      case 'in-progress':
        return 'in-progress';
      case 'on-hold':
        return 'show-stoppers';
      case 'completed':
        return 'completed';
      case 'cancelled':
        return 'show-stoppers';
      default:
        return 'ready';
    }
  };

  // Fetch available organizations when user changes
  useEffect(() => {
    if (user) {
      fetchAvailableOrganizations();
    }
  }, [user, id]);

  useEffect(() => {
    if (!id) return;
    const loadBrimRows = async () => {
      setBrimRowsLoading(true);
      setBrimRowsError(null);
      try {
        const metaRef = doc(db, 'churches', String(id), 'collectionMetadata', 'brands');
        const metaSnap = await getDoc(metaRef);
        const defaultLabel = metaSnap.exists() ? (metaSnap.data()?.defaultLabelColumn || '') : '';
        setBrimLabelColumn(defaultLabel);

        const rowsQuery = query(collection(db, `churches/${id}/brands`), limit(300));
        const rowsSnap = await getDocs(rowsQuery);
        const rows = rowsSnap.docs.map(docSnap => {
          const data = docSnap.data() || {};
          return {
            id: docSnap.id,
            label: buildBrimRowLabel(data, docSnap.id, defaultLabel)
          };
        });
        rows.sort((a, b) => a.label.localeCompare(b.label));
        setBrimRows(rows);
      } catch (error) {
        console.error('Error loading Brim tracker rows:', error);
        setBrimRowsError('Failed to load Brim tracker rows');
        setBrimRows([]);
      } finally {
        setBrimRowsLoading(false);
      }
    };

    loadBrimRows();
  }, [id]);

  useEffect(() => {
    if (!user) {
      const returnUrl = `${location.pathname}${location.search}${location.hash}`;
      navigate(`/organization/${id}/login?returnUrl=${encodeURIComponent(returnUrl)}`);
      return;
    }

    const fetchTasks = async () => {
      try {
        const baseQuery = query(
          collection(db, 'buildTasks'),
          where('churchId', '==', id)
        );
        const tasksQuery = query(baseQuery, orderBy('createdAt', 'desc'));
        let snapshot;

        try {
          snapshot = await getDocs(tasksQuery);
        } catch (innerError) {
          if (innerError?.code === 'failed-precondition') {
            snapshot = await getDocs(baseQuery);
          } else {
            throw innerError;
          }
        }
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
    if (!user) return;

    const fetchAgileTasks = async () => {
      setAgileLoaded(false);
      try {
        const baseQuery = query(
          collection(db, 'agileTasks'),
          where('churchId', '==', id)
        );
        const agileQuery = query(baseQuery, orderBy('createdAt', 'desc'));
        let snapshot;

        try {
          snapshot = await getDocs(agileQuery);
        } catch (innerError) {
          if (innerError?.code === 'failed-precondition') {
            snapshot = await getDocs(baseQuery);
          } else {
            throw innerError;
          }
        }
        const list = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setAgileTasks(dedupeAgileTasks(list));
      } catch (error) {
        console.error('Error fetching agile tasks:', error);
        safeToast.error('Failed to load agile tasks');
      } finally {
        setAgileLoaded(true);
      }
    };

    fetchAgileTasks();
  }, [user, id]);

  useEffect(() => {
    if (!user || agileAutoMigrated || !agileLoaded) return;
    if (tasks.length === 0) return;
    if (agileTasks.length > 0) {
      setAgileAutoMigrated(true);
      return;
    }

    handleAgileMigrateFromBuildTasks({ silent: true, auto: true });
  }, [user, tasks.length, agileTasks.length, agileAutoMigrated, agileLoaded]);

  useEffect(() => {
    if (!user || ticketBackfilled) return;
    if (tasks.length === 0 && agileTasks.length === 0) return;

    const backfillMissingTicketIds = async () => {
      const takenIds = new Set(
        [...tasks, ...agileTasks]
          .map(task => task.ticketId)
          .filter(Boolean)
          .map(value => String(value))
      );

      const updates = [];
      const assignId = () => {
        const nextId = generateUniqueTicketId(takenIds);
        takenIds.add(nextId);
        return nextId;
      };

      tasks.forEach(task => {
        if (!task.ticketId || !isValidTicketId(task.ticketId)) {
          updates.push({ collection: 'buildTasks', id: task.id, ticketId: assignId() });
        }
      });

      agileTasks.forEach(task => {
        if (!task.ticketId || !isValidTicketId(task.ticketId)) {
          updates.push({ collection: 'agileTasks', id: task.id, ticketId: assignId() });
        }
      });

      if (updates.length === 0) {
        setTicketBackfilled(true);
        return;
      }

      try {
        const results = await Promise.allSettled(
          updates.map(update => updateDoc(doc(db, update.collection, update.id), { ticketId: update.ticketId }))
        );

        const applied = updates.filter((update, index) => results[index].status === 'fulfilled');
        if (applied.length) {
          const buildMap = new Map(
            applied
              .filter(update => update.collection === 'buildTasks')
              .map(update => [update.id, update.ticketId])
          );
          const agileMap = new Map(
            applied
              .filter(update => update.collection === 'agileTasks')
              .map(update => [update.id, update.ticketId])
          );

          if (buildMap.size) {
            setTasks(prev => prev.map(task => (buildMap.has(task.id)
              ? { ...task, ticketId: buildMap.get(task.id) }
              : task
            )));
          }

          if (agileMap.size) {
            setAgileTasks(prev => prev.map(task => (agileMap.has(task.id)
              ? { ...task, ticketId: agileMap.get(task.id) }
              : task
            )));
          }
        }

        if (results.some(result => result.status === 'rejected')) {
          console.error('Some ticketId updates failed during backfill');
          safeToast.error('Some tasks could not be backfilled with IDs');
        }
      } catch (error) {
        console.error('Error backfilling task ticket IDs:', error);
        safeToast.error('Failed to backfill task IDs');
      } finally {
        setTicketBackfilled(true);
      }
    };

    backfillMissingTicketIds();
  }, [user, tasks, agileTasks, ticketBackfilled]);

  useEffect(() => {
    // load comments when a task is expanded or in detail view
    if (expandedTaskId) {
      fetchCommentsForTask(expandedTaskId);
    }
    if (taskId) {
      fetchCommentsForTask(taskId);
    }
    // reset comment input when switching tasks
    setEditingCommentId(null);
    setEditingCommentText('');
  }, [expandedTaskId, taskId]);

  useEffect(() => {
    if (taskId || !location.state?.editTaskId || tasks.length === 0) return;

    const taskToEdit = tasks.find(task => task.id === location.state.editTaskId);
    if (!taskToEdit) return;

    setActiveTab('tasks');
    handleEditTask(taskToEdit);

    const taskIndex = tasks.findIndex(task => task.id === location.state.editTaskId);
    if (taskIndex >= 0) {
      setCurrentPage(Math.floor(taskIndex / tasksPerPage) + 1);
    }
  }, [location.state, taskId, tasks]);

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
      const existingTicketIds = new Set(
        [...tasks, ...agileTasks]
          .map(task => task.ticketId)
          .filter(Boolean)
      );
      const normalizedTicketId = (newTask.ticketId || '').trim();
      const generatedTicketId = normalizedTicketId || generateUniqueTicketId(existingTicketIds);

      const assigneeList = normalizeAssigneeList(newTask.assignee);
      const taskData = {
        ...newTask,
        assignee: assigneeList.length ? assigneeList : null,
        ticketId: generatedTicketId,
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
      const finalTicketId = taskData.ticketId || docRef.id;

      if (finalTicketId !== taskData.ticketId) {
        await updateDoc(doc(db, 'buildTasks', docRef.id), {
          ticketId: finalTicketId
        });
      }

      setTasks(prev => [{ id: docRef.id, ...taskData, ticketId: finalTicketId }, ...prev]);
      setNewTask({
        title: '',
        description: '',
        ticketId: '',
        priority: 'medium',
        status: 'ready',
        topic: '',
        assignee: [],
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

  const handleAgileStatusChange = async (taskId, nextStatus) => {
    const currentTask = agileTasks.find(task => task.id === taskId);
    if (!currentTask || currentTask.status === nextStatus) return;

    try {
      const statusEntry = {
        previousStatus: currentTask.status || null,
        newStatus: nextStatus,
        changedAt: new Date().toISOString(),
        changedBy: user?.uid || 'unknown'
      };
      const taskRef = doc(db, 'agileTasks', taskId);
      await updateDoc(taskRef, {
        status: nextStatus,
        updatedAt: new Date().toISOString(),
        statusChangeLog: arrayUnion(statusEntry)
      });
      updateAgileTaskState(taskId, {
        status: nextStatus,
        updatedAt: new Date().toISOString(),
        statusChangeLog: [
          ...(currentTask.statusChangeLog || []),
          statusEntry
        ]
      });

      await logAgileActivity(taskId, {
        type: 'status',
        message: `${user?.displayName || user?.email || 'Someone'} changed status from ${getAgileStatusLabel(currentTask.status)} to ${getAgileStatusLabel(nextStatus)}`,
        from: currentTask.status,
        to: nextStatus
      });
    } catch (error) {
      console.error('Error updating agile status:', error);
      safeToast.error('Failed to update status');
    }
  };

  const handleAgileSaveEdits = async () => {
    if (!agileDetailTaskId || !agileDetailTask) return;

    const updates = {};
    const changes = [];
    let statusEntry = null;

    if ((agileEdit.title || '').trim() !== (agileDetailTask.title || '')) {
      updates.title = (agileEdit.title || '').trim();
      changes.push({
        field: 'title',
        from: agileDetailTask.title || '',
        to: updates.title,
        message: `${user?.displayName || user?.email || 'Someone'} changed title from "${agileDetailTask.title || ''}" to "${updates.title}"`
      });
    }

    if ((agileEdit.description || '').trim() !== (agileDetailTask.description || '')) {
      updates.description = (agileEdit.description || '').trim();
      changes.push({
        field: 'description',
        from: agileDetailTask.description || '',
        to: updates.description,
        message: `${user?.displayName || user?.email || 'Someone'} updated description`
      });
    }

    if ((agileEdit.assignee || '').trim() !== (agileDetailTask.assignee || '')) {
      updates.assignee = (agileEdit.assignee || '').trim();
      changes.push({
        field: 'assignee',
        from: agileDetailTask.assignee || '',
        to: updates.assignee,
        message: `${user?.displayName || user?.email || 'Someone'} changed assignee from "${agileDetailTask.assignee || 'Unassigned'}" to "${updates.assignee || 'Unassigned'}"`
      });
    }

    if ((agileEdit.project || '').trim() !== (agileDetailTask.project || '')) {
      updates.project = (agileEdit.project || '').trim();
      changes.push({
        field: 'project',
        from: agileDetailTask.project || '',
        to: updates.project,
        message: `${user?.displayName || user?.email || 'Someone'} changed project from "${agileDetailTask.project || 'Unassigned'}" to "${updates.project || 'Unassigned'}"`
      });
    }

    if ((agileEdit.status || '') !== (agileDetailTask.status || '')) {
      updates.status = agileEdit.status || 'ready';
      statusEntry = {
        previousStatus: agileDetailTask.status || null,
        newStatus: updates.status,
        changedAt: new Date().toISOString(),
        changedBy: user?.uid || 'unknown'
      };
      changes.push({
        field: 'status',
        from: agileDetailTask.status || 'ready',
        to: updates.status,
        message: `${user?.displayName || user?.email || 'Someone'} changed status from ${getAgileStatusLabel(agileDetailTask.status || 'ready')} to ${getAgileStatusLabel(updates.status)}`
      });
    }

    if ((agileEdit.priority || '') !== (agileDetailTask.priority || 'medium')) {
      updates.priority = agileEdit.priority || 'medium';
      changes.push({
        field: 'priority',
        from: agileDetailTask.priority || 'medium',
        to: updates.priority,
        message: `${user?.displayName || user?.email || 'Someone'} changed priority from "${agileDetailTask.priority || 'medium'}" to "${updates.priority}"`
      });
    }

    if (!Object.keys(updates).length) return;

    try {
      const taskRef = doc(db, 'agileTasks', agileDetailTaskId);
      await updateDoc(taskRef, {
        ...updates,
        updatedAt: new Date().toISOString(),
        ...(statusEntry ? { statusChangeLog: arrayUnion(statusEntry) } : {})
      });

      updateAgileTaskState(agileDetailTaskId, {
        ...updates,
        updatedAt: new Date().toISOString(),
        ...(statusEntry ? {
          statusChangeLog: [
            ...(agileDetailTask.statusChangeLog || []),
            statusEntry
          ]
        } : {})
      });

      for (const change of changes) {
        await logAgileActivity(agileDetailTaskId, {
          type: 'edit',
          field: change.field,
          from: change.from,
          to: change.to,
          message: change.message
        });
      }
    } catch (error) {
      console.error('Error saving agile edits:', error);
      safeToast.error('Failed to save changes');
    }
  };

  const handleAgileAddComment = async () => {
    if (!agileDetailTaskId) return;
    const text = (agileCommentDraft || '').trim();
    const files = Array.isArray(agileCommentFiles) ? agileCommentFiles : [];
    if (!text && files.length === 0) {
      safeToast.error('Please enter a comment or attach a file');
      return;
    }

    try {
      setAgileCommentUploading(true);
      let uploadedFiles = [];
      if (files.length > 0) {
        const timestamp = Date.now();
        uploadedFiles = await Promise.all(files.map(async (file) => {
          const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
          const filePath = `agileTasks/${id}/${agileDetailTaskId}/comments/${timestamp}_${safeFileName}`;
          const storageRef = ref(storage, filePath);
          const metadata = { contentType: file.type };
          const uploadTask = await uploadBytes(storageRef, file, metadata);
          const downloadUrl = await getDownloadURL(uploadTask.ref);
          return {
            name: file.name,
            url: downloadUrl,
            path: filePath,
            type: file.type,
            size: file.size
          };
        }));
      }

      const commentData = {
        text,
        author: {
          uid: user?.uid || 'unknown',
          displayName: user?.displayName || user?.email || 'Unknown'
        },
        createdAt: new Date().toISOString(),
        files: uploadedFiles
      };

      const commentRef = await addDoc(collection(db, 'agileTasks', agileDetailTaskId, 'comments'), commentData);
      setAgileComments(prev => [{ id: commentRef.id, ...commentData }, ...prev]);
      setAgileCommentDraft('');
      setAgileCommentFiles([]);

      await logAgileActivity(agileDetailTaskId, {
        type: 'comment',
        message: `${user?.displayName || user?.email || 'Someone'} added a comment`
      });
    } catch (error) {
      console.error('Error adding agile comment:', error);
      safeToast.error('Failed to add comment');
    } finally {
      setAgileCommentUploading(false);
    }
  };

  const handleAgileDragStart = (taskId, event) => {
    setDraggingAgileId(taskId);
    if (event?.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', taskId);
    }
  };

  const handleAgileDragEnd = () => {
    setDraggingAgileId(null);
  };

  const handleAgileDrop = (statusValue, event) => {
    event.preventDefault();
    const droppedId = event.dataTransfer?.getData('text/plain');
    const taskId = droppedId || draggingAgileId;
    if (!taskId) return;
    handleAgileStatusChange(taskId, statusValue);
    setDraggingAgileId(null);
    setAgileDragOverStatus(null);
  };

  const handleAgileMigrateFromBuildTasks = async (options = {}) => {
    const { silent = false, auto = false } = options;

    if (!tasks.length) {
      if (!silent) {
        safeToast.error('No build tasks available to migrate');
      }
      if (auto) {
        setAgileAutoMigrated(true);
      }
      return;
    }

    try {
      setAgileMigrating(true);
      const existingSourceIds = new Set(
        dedupeAgileTasks(agileTasks).map(task => task.sourceTaskId).filter(Boolean)
      );
      const toMigrate = tasks.filter(task => !existingSourceIds.has(task.id));

      if (!toMigrate.length) {
        if (!silent) {
          safeToast.info('All build tasks are already migrated');
        }
        return;
      }

      const created = await Promise.all(toMigrate.map(async (task) => {
        const initialStatus = mapBuildStatusToAgile(task.status);
        const taskData = {
          churchId: id,
          title: task.title || 'Untitled task',
          description: task.description || '',
          ticketId: task.ticketId || task.id,
          assignee: formatAssigneeDisplay(task.assignee) || 'Unassigned',
          project: task.topic || task.project || 'General',
          status: initialStatus,
          startDate: task.startDate || '',
          dueDate: task.dueDate || '',
          createdAt: task.createdAt || new Date().toISOString(),
          sourceTaskId: task.id,
          statusChangeLog: [{
            previousStatus: null,
            newStatus: initialStatus,
            changedAt: new Date().toISOString(),
            changedBy: user?.uid || 'unknown'
          }]
        };
        const docRef = await addDoc(collection(db, 'agileTasks'), taskData);
        return { id: docRef.id, ...taskData };
      }));

      setAgileTasks(prev => dedupeAgileTasks([...created, ...prev]));
      if (!silent) {
        safeToast.success(`Migrated ${created.length} task(s) to Agile`);
      }
    } catch (error) {
      console.error('Error migrating tasks to agile:', error);
      if (!silent) {
        safeToast.error('Failed to migrate tasks');
      }
    } finally {
      setAgileMigrating(false);
      if (auto) {
        setAgileAutoMigrated(true);
      }
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

  const handleAddComment = async (taskId, text, files = []) => {
    if (!taskId) return;
    const trimmedText = (text || '').trim();
    if (!trimmedText && files.length === 0) {
      safeToast.error('Please enter a comment or attach a file');
      return;
    }

    try {
      setUploadingFile(true);

      // Upload files first
      const uploadedFiles = await Promise.all(files.map(async (file) => {
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
        text: trimmedText,
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
      ticketId: task.ticketId || '',
      priority: task.priority,
      status: task.status,
      topic: task.topic || '',
      assignee: normalizeAssigneeList(task.assignee),
      customTopic: '',
      dueDate: task.dueDate || '',
      startDate: task.startDate || '',
      documents: task.documents || []
    });
  };

  const handleUpdateTask = async (e, options = {}) => {
    e.preventDefault();
    const { keepEditing = false } = options;
    try {
      const assigneeList = normalizeAssigneeList(newTask.assignee);
      const updatedData = {
        ...newTask,
        assignee: assigneeList.length ? assigneeList : null,
        ticketId: (newTask.ticketId || '').trim(),
        topic: newTask.topic === 'new' ? newTask.customTopic : newTask.topic,
        updatedAt: new Date().toISOString()
      };

      const taskRef = doc(db, 'buildTasks', editingTaskId);
      await updateDoc(taskRef, updatedData);

      setTasks(prev => prev.map(task => 
        task.id === editingTaskId ? { ...task, ...updatedData } : task
      ));

      if (keepEditing) {
        setEditingTaskId(editingTaskId);
        setNewTask({
          ...updatedData,
          topic: updatedData.topic || '',
          customTopic: ''
        });
      } else {
        setEditingTaskId(null);
        setNewTask({
          title: '',
          description: '',
          ticketId: '',
          priority: 'medium',
          status: 'ready',
          topic: '',
          assignee: [],
          customTopic: '',
          dueDate: '',
          startDate: '',
          documents: []
        });
      }
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
      ticketId: '',
      priority: 'medium',
      status: 'ready',
      topic: '',
      assignee: [],
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
      const tasksToUpdate = tasks.filter(task => normalizeAssigneeList(task.assignee).includes(assigneeName));
      const updatePromises = tasksToUpdate.map(task =>
        updateDoc(doc(db, 'buildTasks', task.id), { assignee: removeAssigneeValue(task.assignee, assigneeName) })
      );
      await Promise.all(updatePromises);

      // Update local state
      setTasks(prev => prev.map(task =>
        normalizeAssigneeList(task.assignee).includes(assigneeName)
          ? { ...task, assignee: removeAssigneeValue(task.assignee, assigneeName) }
          : task
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
      const tasksToUpdate = tasks.filter(task => normalizeAssigneeList(task.assignee).includes(fromAssigneeName));
      const updatePromises = tasksToUpdate.map(task =>
        updateDoc(doc(db, 'buildTasks', task.id), { assignee: replaceAssigneeValue(task.assignee, fromAssigneeName, toAssigneeName) })
      );
      await Promise.all(updatePromises);

      // Update local state
      setTasks(prev => prev.map(task =>
        normalizeAssigneeList(task.assignee).includes(fromAssigneeName)
          ? { ...task, assignee: replaceAssigneeValue(task.assignee, fromAssigneeName, toAssigneeName) }
          : task
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
      const statusLabelMap = [...STATUS_OPTIONS, ...AGILE_STATUSES].reduce((acc, option) => {
        acc[option.value] = option.label;
        return acc;
      }, {});

      const filters = [];
      if (filterPriority !== 'all') filters.push(`Priority: ${filterPriority}`);
      if (filterStatus !== 'all') filters.push(`Status: ${filterStatus}`);
      if (filterTopic !== 'all') filters.push(`Project: ${filterTopic}`);
      if (filterHasComments !== 'all') filters.push(`Comments: ${filterHasComments}`);
      if (filterHasDocuments !== 'all') filters.push(`Documents: ${filterHasDocuments}`);
      if (filterHasCheckedComments !== 'all') filters.push(`Checked: ${filterHasCheckedComments}`);
      if (searchQuery) filters.push(`Search: "${searchQuery}"`);

      const filterText = filters.length ? filters.join(' | ') : 'None';

      const statusGroupKeys = Array.from(new Set([
        ...AGILE_STATUSES.map(option => option.value),
        ...STATUS_OPTIONS.map(option => option.value)
      ]));

      const statusGroups = statusGroupKeys.reduce((acc, key) => {
        acc[key] = filteredTasks.filter(task => task.status === key);
        return acc;
      }, {});

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
        ...statusGroupKeys.map(key => [statusLabelMap[key] || key, statusCounts[key] || 0]),
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
              [`ID #: ${task.ticketId || task.id || 'N/A'}`, `Status: ${statusLabelMap[task.status] || task.status || 'N/A'}`],
              [`Priority: ${task.priority || 'N/A'}`, `Project: ${task.topic || 'N/A'}`],
              [`Assignee: ${formatAssigneeDisplay(task.assignee) || 'Unassigned'}`, `Start: ${formatDate(task.startDate)}`],
              [`Due: ${formatDate(task.dueDate)}`, `Created: ${formatDate(task.createdAt)}`],
              [`Updated: ${formatDate(task.updatedAt)}`, `Documents: ${task.documents?.length || 0}`],
              [`Comments: ${(commentsByTask[task.id] || []).length}`, '']
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
  const currentTask = taskId ? tasks.find(task => task.id === taskId) : null;

  const handlePageChange = (pageNumber) => {
    setCurrentPage(pageNumber);
  };

  const handleTaskClick = async (event, task) => {
    if (!task || !task.id) return;
    if (event) {
      const interactiveTarget = event.target.closest('button, a, input, textarea, select, label');
      if (interactiveTarget) return;
    }
    navigate(`/organization/${id}/build-my-church/task/${task.id}`, {
      state: { from: `${location.pathname}${location.search}${location.hash}` }
    });
  };

  const handleCloseDetailView = () => {
    if (taskId) {
      navigate(`/organization/${id}/build-my-church`, { replace: true });
    }
  };

  const updateTaskBrimRows = async (taskId, nextRowIds) => {
    const taskRef = doc(db, 'buildTasks', taskId);
    const nextUpdatedAt = new Date().toISOString();
    await updateDoc(taskRef, {
      brimRowIds: nextRowIds,
      updatedAt: nextUpdatedAt
    });
    setTasks(prev => prev.map(task => (
      task.id === taskId ? { ...task, brimRowIds: nextRowIds, updatedAt: nextUpdatedAt } : task
    )));
  };

  const handleAddBrimRow = async (taskId, rowId) => {
    if (!taskId || !rowId) return;
    const task = tasks.find(t => t.id === taskId);
    const current = Array.isArray(task?.brimRowIds) ? task.brimRowIds : [];
    if (current.includes(rowId)) return;
    setSavingBrimLinks(true);
    try {
      await updateTaskBrimRows(taskId, [...current, rowId]);
      safeToast.success('BIM tracker row linked');
    } catch (error) {
      console.error('Error linking Brim tracker row:', error);
      safeToast.error('Failed to link BIM tracker row');
    } finally {
      setSavingBrimLinks(false);
    }
  };

  const handleRemoveBrimRow = async (taskId, rowId) => {
    if (!taskId || !rowId) return;
    const task = tasks.find(t => t.id === taskId);
    const current = Array.isArray(task?.brimRowIds) ? task.brimRowIds : [];
    if (!current.includes(rowId)) return;
    setSavingBrimLinks(true);
    try {
      await updateTaskBrimRows(taskId, current.filter(idValue => idValue !== rowId));
      safeToast.success('BIM tracker row removed');
    } catch (error) {
      console.error('Error removing Brim tracker row:', error);
      safeToast.error('Failed to remove BIM tracker row');
    } finally {
      setSavingBrimLinks(false);
    }
  };

  const updateAgileTaskBrimRows = async (taskId, nextRowIds) => {
    const taskRef = doc(db, 'agileTasks', taskId);
    const nextUpdatedAt = new Date().toISOString();
    await updateDoc(taskRef, {
      brimRowIds: nextRowIds,
      updatedAt: nextUpdatedAt
    });
    updateAgileTaskState(taskId, { brimRowIds: nextRowIds, updatedAt: nextUpdatedAt });
  };

  const handleAddAgileBrimRow = async (taskId, rowId) => {
    if (!taskId || !rowId) return;
    const task = agileTasks.find(t => t.id === taskId) || agileDetailTask;
    const current = Array.isArray(task?.brimRowIds) ? task.brimRowIds : [];
    if (current.includes(rowId)) return;
    setSavingBrimLinks(true);
    try {
      await updateAgileTaskBrimRows(taskId, [...current, rowId]);
      await logAgileActivity(taskId, {
        type: 'bim',
        message: `${user?.displayName || user?.email || 'Someone'} linked a BIM tracker row`
      });
      safeToast.success('BIM tracker row linked');
    } catch (error) {
      console.error('Error linking Brim tracker row:', error);
      safeToast.error('Failed to link BIM tracker row');
    } finally {
      setSavingBrimLinks(false);
    }
  };

  const handleRemoveAgileBrimRow = async (taskId, rowId) => {
    if (!taskId || !rowId) return;
    const task = agileTasks.find(t => t.id === taskId) || agileDetailTask;
    const current = Array.isArray(task?.brimRowIds) ? task.brimRowIds : [];
    if (!current.includes(rowId)) return;
    setSavingBrimLinks(true);
    try {
      await updateAgileTaskBrimRows(taskId, current.filter(idValue => idValue !== rowId));
      await logAgileActivity(taskId, {
        type: 'bim',
        message: `${user?.displayName || user?.email || 'Someone'} removed a BIM tracker row link`
      });
      safeToast.success('BIM tracker row removed');
    } catch (error) {
      console.error('Error removing Brim tracker row:', error);
      safeToast.error('Failed to remove BIM tracker row');
    } finally {
      setSavingBrimLinks(false);
    }
  };

  const openBrimRowDetail = async (rowId) => {
    if (!rowId || !id) return;
    setBrimRowDetailId(rowId);
    setBrimRowDetail(null);
    setBrimRowDetailLoading(true);
    setBrimRowComments([]);
    setBrimRowCommentsLoading(true);
    setBrimRowCommentsError(null);
    try {
      const rowRef = doc(db, `churches/${id}/brands`, rowId);
      const rowSnap = await getDoc(rowRef);
      if (rowSnap.exists()) {
        setBrimRowDetail({ id: rowId, ...(rowSnap.data() || {}) });
      } else {
        setBrimRowDetail({ id: rowId });
      }
      const commentsRef = collection(db, `churches/${id}/brands/${rowId}/comments`);
      let commentsSnap;
      try {
        commentsSnap = await getDocs(query(commentsRef, orderBy('createdAt', 'desc')));
      } catch (innerError) {
        if (innerError?.code === 'failed-precondition') {
          commentsSnap = await getDocs(commentsRef);
        } else {
          throw innerError;
        }
      }
      const list = (commentsSnap.docs || []).map(d => ({ id: d.id, ...(d.data() || {}) }));
      setBrimRowComments(list);
    } catch (error) {
      console.error('Error loading Brim row detail:', error);
      setBrimRowDetail({ id: rowId });
      setBrimRowCommentsError('Failed to load comments.');
    } finally {
      setBrimRowDetailLoading(false);
      setBrimRowCommentsLoading(false);
    }
  };

  const closeBrimRowDetail = () => {
    setBrimRowDetailId(null);
    setBrimRowDetail(null);
    setBrimRowDetailLoading(false);
    setBrimRowComments([]);
    setBrimRowCommentsLoading(false);
    setBrimRowCommentsError(null);
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

  const DetailView = ({ task, isPage = false }) => {
    const [commentDraftText, setCommentDraftText] = useState('');
    const [commentDraftFiles, setCommentDraftFiles] = useState([]);
    const [brimSearch, setBrimSearch] = useState('');
    const [selectedBrimRowId, setSelectedBrimRowId] = useState('');
    const [pageDates, setPageDates] = useState({ startDate: '', dueDate: '' });
    const [savingDates, setSavingDates] = useState(false);

    useEffect(() => {
      if (!task?.id) return;
      setCommentDraftText('');
      setCommentDraftFiles([]);
      setBrimSearch('');
      setSelectedBrimRowId('');
      setPageDates({
        startDate: task.startDate || '',
        dueDate: task.dueDate || ''
      });
    }, [task?.id]);

    useEffect(() => {
      if (!task?.id || isPage) return;
      if (editingTaskId !== task.id) {
        handleEditTask(task);
      }
    }, [task?.id, editingTaskId, isPage]);

    if (!task) return null;

    const handleSaveDates = async () => {
      if (!task?.id) return;
      if (savingDates) return;
      const nextStart = pageDates.startDate || '';
      const nextDue = pageDates.dueDate || '';
      if (task.startDate === nextStart && task.dueDate === nextDue) {
        return;
      }
      if (nextStart && nextDue && new Date(nextDue) < new Date(nextStart)) {
        safeToast.error('Due date cannot be before start date');
        return;
      }

      try {
        setSavingDates(true);
        const updatedAt = new Date().toISOString();
        await updateDoc(doc(db, 'buildTasks', task.id), {
          startDate: nextStart,
          dueDate: nextDue,
          updatedAt
        });
        setTasks(prev => prev.map(item => (
          item.id === task.id
            ? { ...item, startDate: nextStart, dueDate: nextDue, updatedAt }
            : item
        )));
        safeToast.success('Task dates updated');
      } catch (error) {
        console.error('Error updating task dates:', error);
        safeToast.error('Failed to update task dates');
      } finally {
        setSavingDates(false);
      }
    };

    const qrValue = getTaskUrl(task.id);
    const linkedBrimRowIds = Array.isArray(task.brimRowIds) ? task.brimRowIds : [];
    const filteredBrimRows = brimRows.filter(row =>
      row.label.toLowerCase().includes(brimSearch.toLowerCase())
    );

    const overlayStyle = isPage ? { padding: "0" } : {
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
    };

    const contentStyle = isPage ? {
      backgroundColor: "white",
      borderRadius: "8px",
      padding: "24px",
      width: "100%",
      maxWidth: "100%",
      boxShadow: "0 1px 3px rgba(0,0,0,0.1)"
    } : {
      backgroundColor: "white",
      borderRadius: "8px",
      padding: "24px",
      width: "90%",
      maxWidth: "800px",
      maxHeight: "90vh",
      overflow: "auto"
    };

    return (
      <div style={overlayStyle}>
        <div style={contentStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <button
                type="button"
                onClick={handleCloseDetailView}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 10px",
                  backgroundColor: "#E5E7EB",
                  color: "#111827",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  fontWeight: "600"
                }}
              >
                <FaChevronLeft /> Back
              </button>
              <h2 style={{ margin: 0 }}>{task.title}</h2>
            </div>
            <button onClick={handleCloseDetailView} style={{ background: "none", border: "none", cursor: "pointer" }}>
              <FaTimes />
            </button>
          </div>

          {isPage ? (
            <div style={{ marginBottom: "20px" }}>
              <h3 style={{ marginBottom: "12px" }}>Task Details</h3>
              <div style={{ display: "grid", gap: "10px" }}>
                <div>
                  <strong>Description:</strong>{' '}
                  {task.description ? task.description : 'No description'}
                </div>
                <div>
                  <strong>Ticket ID:</strong>{' '}
                  {task.ticketId ? task.ticketId : '—'}
                </div>
                <div>
                  <strong>Priority:</strong>{' '}
                  {task.priority ? task.priority : '—'}
                </div>
                <div>
                  <strong>Status:</strong>{' '}
                  {task.status ? task.status : '—'}
                </div>
                <div>
                  <strong>Project:</strong>{' '}
                  {task.topic ? task.topic : '—'}
                </div>
                <div>
                  <strong>Assigned To:</strong>{' '}
                  {formatAssigneeDisplay(task.assignee) || 'Unassigned'}
                </div>
                <div>
                  <strong>Start Date:</strong>{' '}
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '6px' }}>
                    <input
                      type="date"
                      className="form-input"
                      value={pageDates.startDate}
                      onChange={(e) => setPageDates(prev => ({ ...prev, startDate: e.target.value }))}
                    />
                    <span style={{ color: '#6B7280', fontSize: '0.875rem' }}>
                      {task.startDate ? new Date(task.startDate).toLocaleDateString() : '—'}
                    </span>
                  </div>
                </div>
                <div>
                  <strong>Due Date:</strong>{' '}
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '6px' }}>
                    <input
                      type="date"
                      className="form-input"
                      value={pageDates.dueDate}
                      onChange={(e) => setPageDates(prev => ({ ...prev, dueDate: e.target.value }))}
                    />
                    <span style={{ color: '#6B7280', fontSize: '0.875rem' }}>
                      {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : '—'}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="edit-button save"
                    onClick={handleSaveDates}
                    disabled={savingDates}
                  >
                    <FaCheck /> {savingDates ? 'Saving...' : 'Save Dates'}
                  </button>
                  <button
                    type="button"
                    className="edit-button delete"
                    onClick={() => handleDeleteTask(task.id)}
                  >
                    <FaTrash /> Delete Task
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={(e) => handleUpdateTask(e, { keepEditing: true })} className="edit-task-form" style={{ marginBottom: "20px" }}>
              <div className="form-group">
                <label className="form-label">Title</label>
                <input
                  type="text"
                  className="form-input"
                  value={newTask.title}
                  onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea
                  className="form-textarea"
                  value={newTask.description}
                  onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Ticket ID</label>
                <input
                  type="text"
                  className="form-input"
                  value={newTask.ticketId}
                  onChange={(e) => setNewTask({ ...newTask, ticketId: e.target.value })}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Priority</label>
                  <select
                    className="form-select"
                    value={newTask.priority}
                    onChange={(e) => setNewTask({ ...newTask, priority: e.target.value })}
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
                    onChange={(e) => setNewTask({ ...newTask, status: e.target.value })}
                  >
                    <option value="ready">Ready</option>
                    <option value="in-progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="on-hold">On Hold</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Project</label>
                <div className="topic-input-group">
                  <select
                    className="form-select"
                    value={newTask.topic}
                    onChange={(e) => setNewTask({ ...newTask, topic: e.target.value })}
                  >
                    <option value="">Select Project</option>
                    {topics.map(topic => (
                      <option key={topic.id} value={topic.name}>{topic.name}</option>
                    ))}
                    <option value="new">+ Add New Project</option>
                  </select>

                  {newTask.topic === 'new' && (
                    <div className="new-topic-input">
                      <input
                        type="text"
                        className="form-input"
                        value={newTask.customTopic}
                        onChange={(e) => setNewTask({ ...newTask, customTopic: e.target.value })}
                        placeholder="Enter new project"
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Assigned To</label>
                <AssigneeSelect
                  value={newTask.assignee}
                  onChange={(assignee) => setNewTask({ ...newTask, assignee })}
                  placeholder="Select or add assignee"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Start Date</label>
                  <input
                    type="date"
                    className="form-input"
                    value={newTask.startDate}
                    onChange={(e) => setNewTask({ ...newTask, startDate: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Due Date</label>
                  <input
                    type="date"
                    className="form-input"
                    value={newTask.dueDate}
                    onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })}
                  />
                </div>
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
                <button
                  type="button"
                  onClick={() => handleEditTask(task)}
                  className="edit-button cancel"
                >
                  <FaTimes /> Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteTask(task.id)}
                  className="edit-button delete"
                >
                  <FaTrash /> Delete
                </button>
              </div>
            </form>
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

          <div style={{ marginBottom: "20px" }} onClick={(e) => e.stopPropagation()}>
            <h3>BIM Tracker Rows</h3>
            <p style={{ color: '#6B7280', marginTop: '4px' }}>
              Link one or more BIM tracker rows to this task and open their details.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginTop: '10px' }}>
              <input
                type="text"
                value={brimSearch}
                onChange={(e) => setBrimSearch(e.target.value)}
                placeholder="Search rows..."
                style={{ padding: '8px', borderRadius: '6px', border: '1px solid #E5E7EB', minWidth: '220px' }}
              />
              <select
                value={selectedBrimRowId}
                onChange={(e) => setSelectedBrimRowId(e.target.value)}
                style={{ padding: '8px', borderRadius: '6px', border: '1px solid #E5E7EB', minWidth: '240px' }}
              >
                <option value="">Select a row</option>
                {filteredBrimRows.map(row => (
                  <option key={row.id} value={row.id} disabled={linkedBrimRowIds.includes(row.id)}>
                    {row.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!selectedBrimRowId || savingBrimLinks}
                onClick={async () => {
                  await handleAddBrimRow(task.id, selectedBrimRowId);
                  setSelectedBrimRowId('');
                }}
                style={{
                  padding: '8px 12px',
                  backgroundColor: '#4F46E5',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: selectedBrimRowId ? 'pointer' : 'not-allowed'
                }}
              >
                {savingBrimLinks ? 'Saving...' : 'Add Row'}
              </button>
            </div>
            {brimRowsLoading && (
              <div style={{ color: '#6B7280', marginTop: '8px' }}>Loading BIM tracker rows...</div>
            )}
            {brimRowsError && (
              <div style={{ color: '#ef4444', marginTop: '8px' }}>{brimRowsError}</div>
            )}
            {linkedBrimRowIds.length === 0 ? (
              <div style={{ color: '#6B7280', marginTop: '8px' }}>No linked BIM tracker rows yet.</div>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, marginTop: '12px' }}>
                {linkedBrimRowIds.map(rowId => {
                  const rowLabel = brimRows.find(row => row.id === rowId)?.label || `Row ${rowId}`;
                  return (
                    <li key={rowId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '8px', border: '1px solid #E5E7EB', borderRadius: '6px', marginBottom: '8px' }}>
                      <button
                        type="button"
                        onClick={() => openBrimRowDetail(rowId)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#2563eb',
                          textDecoration: 'underline',
                          cursor: 'pointer',
                          textAlign: 'left',
                          padding: 0
                        }}
                      >
                        {rowLabel}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveBrimRow(task.id, rowId)}
                        disabled={savingBrimLinks}
                        style={{
                          padding: '6px 10px',
                          backgroundColor: '#ef4444',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          cursor: 'pointer'
                        }}
                      >
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div style={{ marginBottom: '20px' }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
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
                  value={commentDraftText}
                  onChange={(e) => setCommentDraftText(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  placeholder="Add a comment..."
                  rows={3}
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #E5E7EB' }}
                />
                <input
                  type="file"
                  multiple
                  onChange={(e) => setCommentDraftFiles(Array.from(e.target.files))}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{ marginTop: '8px' }}
                />
                <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
                  <button
                    onClick={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      await handleAddComment(task.id, commentDraftText, commentDraftFiles);
                      setCommentDraftText('');
                      setCommentDraftFiles([]);
                      setShowCommentForm(prev => ({...prev, [task.id]: false}));
                    }}
                    style={{ padding: '8px 12px', backgroundColor: '#10B981', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                  >Submit</button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowCommentForm(prev => ({...prev, [task.id]: false}));
                      setCommentDraftText('');
                      setCommentDraftFiles([]);
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
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
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
                <QRCodeSVG value={qrValue} size={160} />
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

        </div>
      </div>
    );
  };

  const AssigneeSelect = React.memo(({ value, onChange, placeholder = "Select or add assignee" }) => {
    const [newAssigneeName, setNewAssigneeName] = useState('');
    const selectedAssignees = normalizeAssigneeList(value);

    const handleAddAssignee = async () => {
      const nextName = newAssigneeName.trim();
      if (!nextName) return;

      const existing = assignees.find(assignee => assignee.name.toLowerCase() === nextName.toLowerCase());
      if (existing) {
        handleToggleAssignee(existing.name);
        setNewAssigneeName('');
        return;
      }
      
      try {
        const assigneeRef = await addDoc(collection(db, 'buildAssignees'), {
          name: nextName,
          churchId: id,
          createdAt: new Date().toISOString()
        });
        setAssignees(prev => [...prev, { id: assigneeRef.id, name: nextName }]);
        const nextAssignees = Array.from(new Set([...selectedAssignees, nextName]));
        onChange(nextAssignees);
        setNewAssigneeName('');
        toast.success('Assignee added successfully');
      } catch (error) {
        console.error('Error adding assignee:', error);
        toast.error('Failed to add assignee');
      }
    };

    const handleToggleAssignee = (assigneeName) => {
      const next = selectedAssignees.includes(assigneeName)
        ? selectedAssignees.filter(name => name !== assigneeName)
        : [...selectedAssignees, assigneeName];
      onChange(next);
    };

    return (
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {selectedAssignees.length === 0 ? (
            <span style={{ color: '#9CA3AF', fontSize: '0.875rem' }}>{placeholder}</span>
          ) : (
            selectedAssignees.map(name => (
              <span
                key={name}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 8px',
                  borderRadius: '999px',
                  backgroundColor: '#EEF2FF',
                  color: '#1F2937',
                  fontSize: '0.875rem'
                }}
              >
                {name}
                <button
                  type="button"
                  onClick={() => handleToggleAssignee(name)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    color: '#6B7280',
                    fontSize: '0.875rem'
                  }}
                >
                  ×
                </button>
              </span>
            ))
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="text"
            value={newAssigneeName}
            onChange={(e) => setNewAssigneeName(e.target.value)}
            placeholder="Type name and press Enter"
            className="form-input"
            style={{ flex: 1 }}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleAddAssignee();
              }
            }}
          />
          <button
            type="button"
            onClick={handleAddAssignee}
            style={{
              padding: '8px 12px',
              backgroundColor: '#4F46E5',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Add
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {assignees.map(assignee => {
            const isSelected = selectedAssignees.includes(assignee.name);
            return (
              <button
                key={assignee.id}
                type="button"
                onClick={() => handleToggleAssignee(assignee.name)}
                style={{
                  padding: '6px 10px',
                  borderRadius: '999px',
                  border: `1px solid ${isSelected ? '#4F46E5' : '#D1D5DB'}`,
                  backgroundColor: isSelected ? '#EEF2FF' : 'white',
                  color: '#1F2937',
                  cursor: 'pointer',
                  fontSize: '0.875rem'
                }}
              >
                {assignee.name}
              </button>
            );
          })}
        </div>
      </div>
    );
  });

  const agileProjectOptions = Array.from(new Set([
    ...agileTasks.map(task => task.project).filter(Boolean),
    (agileEdit.project || '').trim()
  ].filter(Boolean))).sort((a, b) => a.localeCompare(b));

  const agileAssigneeOptions = Array.from(new Set([
    ...agileTasks.map(task => task.assignee).filter(Boolean),
    (agileEdit.assignee || '').trim()
  ].filter(Boolean))).sort((a, b) => a.localeCompare(b));

  const agileLinkedBrimRowIds = Array.isArray(agileDetailTask?.brimRowIds)
    ? agileDetailTask.brimRowIds
    : [];
  const agileFilteredBrimRows = brimRows.filter(row =>
    row.label.toLowerCase().includes(agileBrimSearch.toLowerCase())
  );

  const buildTaskById = new Map(tasks.map(task => [task.id, task]));
  const ganttTasks = agileTasks.map(task => {
    const sourceTask = task.sourceTaskId ? buildTaskById.get(task.sourceTaskId) : null;
    const fallbackAssignee = sourceTask ? formatAssigneeDisplay(sourceTask.assignee) : '';
    return {
      ...task,
      assignedTo: task.assignee || fallbackAssignee || 'Unassigned',
      startDate: task.startDate || sourceTask?.startDate || '',
      dueDate: task.dueDate || sourceTask?.dueDate || '',
      statusChangeLog: Array.isArray(task.statusChangeLog) ? task.statusChangeLog : []
    };
  });
  const ganttStatusOptions = AGILE_STATUSES.map(status => status.value);
  const ganttActualStartStatuses = ganttStatusOptions.filter(status => status !== 'ready');

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

        {taskId ? (
          currentTask ? (
            <DetailView task={currentTask} isPage />
          ) : (
            <div className="empty-state">Task not found.</div>
          )
        ) : (
          <>
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
              <button
                className={`tab-button ${activeTab === 'gantt' ? 'active' : ''}`}
                onClick={() => setActiveTab('gantt')}
              >
                📅 Gantt Schedule
              </button>
              <button
                className={`tab-button ${activeTab === 'agile' ? 'active' : ''}`}
                onClick={() => setActiveTab('agile')}
              >
                🧩 Agile
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
                  {AGILE_STATUSES.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Project</label>
                <div className="topic-input-group">
                  <select
                    className="form-select"
                    value={newTask.topic}
                    onChange={(e) => setNewTask({...newTask, topic: e.target.value})}
                  >
                    <option value="">Select Project</option>
                    {topics.map(topic => (
                      <option key={topic.id} value={topic.name}>{topic.name}</option>
                    ))}
                    <option value="new">+ Add New Project</option>
                  </select>
                  
                  {newTask.topic === 'new' && (
                    <div className="new-topic-input">
                      <input
                        type="text"
                        className="form-input"
                        value={newTask.customTopic}
                        onChange={(e) => setNewTask({...newTask, customTopic: e.target.value})}
                        placeholder="Enter new project"
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
                  {AGILE_STATUSES.map(option => (
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
                  <option value="all">All Projects</option>
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
                      onClick={(e) => handleTaskClick(e, task)}
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
                                {AGILE_STATUSES.map(option => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div className="form-group">
                            <label className="form-label">Project</label>
                            <div className="topic-input-group">
                              <select
                                className="form-select"
                                value={newTask.topic}
                                onChange={(e) => setNewTask({...newTask, topic: e.target.value})}
                              >
                                <option value="">Select Project</option>
                                {topics.map(topic => (
                                  <option key={topic.id} value={topic.name}>{topic.name}</option>
                                ))}
                                <option value="new">+ Add New Project</option>
                              </select>
                              
                              {newTask.topic === 'new' && (
                                <div className="new-topic-input">
                                  <input
                                    type="text"
                                    className="form-input"
                                    value={newTask.customTopic}
                                    onChange={(e) => setNewTask({...newTask, customTopic: e.target.value})}
                                    placeholder="Enter new project"
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
                          </div>
                          <p className="task-description">
                            {task.description.length > 150 ? `${task.description.substring(0, 150)}...` : task.description}
                          </p>
                          <div className="task-metadata">
                            {formatAssigneeDisplay(task.assignee) && (
                              <span className="assignee-badge">
                                <span className="assignee-icon">👤</span>
                                {formatAssigneeDisplay(task.assignee)}
                              </span>
                            )}
                            {task.ticketId && <span className="ticket-badge">ID #{task.ticketId}</span>}
                            {task.topic && <span className="topic-badge">Project: {task.topic}</span>}
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

        {activeTab === 'gantt' && (
          <div className="gantt-content">
            <TaskGantt
              tasks={ganttTasks}
              statusOptions={ganttStatusOptions}
              actualStartStatuses={ganttActualStartStatuses}
              completedStatuses={['completed']}
              personLabelResolver={(task) => task.assignedTo}
            />
          </div>
        )}

        {activeTab === 'agile' && (
          <div className="agile-container">
            <div className="agile-legend">
              <span className="agile-legend-title">Projects</span>
              <div className="agile-legend-items">
                {Array.from(new Set(agileTasks.map(task => task.project).filter(Boolean)))
                  .sort((a, b) => a.localeCompare(b))
                  .map(project => (
                    <div key={project} className="agile-legend-item">
                      <span
                        className="agile-legend-dot"
                        style={{ backgroundColor: getProjectColor(project) }}
                      />
                      <span>{project}</span>
                    </div>
                  ))}
                {agileTasks.filter(task => !task.project).length > 0 && (
                  <div className="agile-legend-item">
                    <span
                      className="agile-legend-dot"
                      style={{ backgroundColor: getProjectColor('Unassigned') }}
                    />
                    <span>Unassigned</span>
                  </div>
                )}
              </div>
            </div>
            <div className="agile-board">
              {AGILE_STATUSES.map(status => {
                const columnTasks = agileTasks.filter(task => task.status === status.value);
                return (
                  <div
                    key={status.value}
                    className={`agile-column ${agileDragOverStatus === status.value ? 'drag-over' : ''}`}
                    onDragOver={(event) => event.preventDefault()}
                    onDragEnter={() => setAgileDragOverStatus(status.value)}
                    onDragLeave={() => {
                      setAgileDragOverStatus(prev => (prev === status.value ? null : prev));
                    }}
                    onDrop={(event) => handleAgileDrop(status.value, event)}
                  >
                    <div className="agile-column-header">
                      <span>{status.label}</span>
                      <span className="agile-count">{columnTasks.length}</span>
                    </div>
                    <div className="agile-column-body">
                      {columnTasks.length === 0 ? (
                        <div className="agile-empty">No tasks</div>
                      ) : (
                        columnTasks.map(task => (
                          <div
                            key={task.id}
                            className="agile-card"
                            style={{ borderLeftColor: getProjectColor(task.project) }}
                            draggable
                            onDragStart={(event) => handleAgileDragStart(task.id, event)}
                            onDragEnd={handleAgileDragEnd}
                            onClick={() => openAgileDetail(task)}
                          >
                            <div className="agile-card-header">
                              <div className="agile-title">{task.title}</div>
                            </div>
                            <div className="agile-assignee">Assigned: {task.assignee || 'Unassigned'}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {agileDetailTask && (
              <div className="agile-modal-overlay" onClick={closeAgileDetail}>
                <div className="agile-modal" onClick={(event) => event.stopPropagation()}>
                  <div className="agile-modal-header">
                    <div>
                      <h3>{agileDetailTask.title || 'Task Detail'}</h3>
                      <p className="agile-modal-subtitle">Assigned: {agileDetailTask.assignee || 'Unassigned'}</p>
                    </div>
                    <button type="button" className="agile-modal-close" onClick={closeAgileDetail}>×</button>
                  </div>

                  {agileDetailLoading ? (
                    <div className="agile-modal-loading">Loading details...</div>
                  ) : (
                    <div className="agile-modal-content">
                      <div className="agile-modal-section">
                        <h4>Edit Task</h4>
                        <div className="agile-modal-grid">
                          <div>
                            <label>Title</label>
                            <input
                              type="text"
                              value={agileEdit.title}
                              onChange={(event) => setAgileEdit(prev => ({ ...prev, title: event.target.value }))}
                            />
                          </div>
                          <div>
                            <label>Assignee</label>
                            <select
                              value={agileEdit.assignee}
                              onChange={(event) => setAgileEdit(prev => ({ ...prev, assignee: event.target.value }))}
                            >
                              <option value="">Unassigned</option>
                              {agileAssigneeOptions.map(assignee => (
                                <option key={assignee} value={assignee}>
                                  {assignee}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label>Project</label>
                            <select
                              value={agileEdit.project}
                              onChange={(event) => setAgileEdit(prev => ({ ...prev, project: event.target.value }))}
                            >
                              <option value="">Unassigned</option>
                              {agileProjectOptions.map(project => (
                                <option key={project} value={project}>
                                  {project}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label>Status</label>
                            <select
                              value={agileEdit.status}
                              onChange={(event) => setAgileEdit(prev => ({ ...prev, status: event.target.value }))}
                            >
                              {AGILE_STATUSES.map(option => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label>Priority</label>
                            <select
                              value={agileEdit.priority}
                              onChange={(event) => setAgileEdit(prev => ({ ...prev, priority: event.target.value }))}
                            >
                              <option value="low">Low</option>
                              <option value="medium">Medium</option>
                              <option value="high">High</option>
                            </select>
                          </div>
                        </div>
                        <div className="agile-modal-field">
                          <label>Description</label>
                          <textarea
                            rows={3}
                            value={agileEdit.description}
                            onChange={(event) => setAgileEdit(prev => ({ ...prev, description: event.target.value }))}
                          />
                        </div>
                        <button type="button" className="agile-modal-save" onClick={handleAgileSaveEdits}>
                          Save Changes
                        </button>
                      </div>

                      <div className="agile-modal-section">
                        <h4>BIM Tracker Rows</h4>
                        <p style={{ color: '#6B7280', marginTop: '4px' }}>
                          Link one or more BIM tracker rows to this task and open their details.
                        </p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginTop: '10px' }}>
                          <input
                            type="text"
                            value={agileBrimSearch}
                            onChange={(e) => setAgileBrimSearch(e.target.value)}
                            placeholder="Search rows..."
                            style={{ padding: '8px', borderRadius: '6px', border: '1px solid #E5E7EB', minWidth: '220px' }}
                          />
                          <select
                            value={agileSelectedBrimRowId}
                            onChange={(e) => setAgileSelectedBrimRowId(e.target.value)}
                            style={{ padding: '8px', borderRadius: '6px', border: '1px solid #E5E7EB', minWidth: '240px' }}
                          >
                            <option value="">Select a row</option>
                            {agileFilteredBrimRows.map(row => (
                              <option key={row.id} value={row.id} disabled={agileLinkedBrimRowIds.includes(row.id)}>
                                {row.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={!agileSelectedBrimRowId || savingBrimLinks}
                            onClick={async () => {
                              await handleAddAgileBrimRow(agileDetailTask.id, agileSelectedBrimRowId);
                              setAgileSelectedBrimRowId('');
                            }}
                            style={{
                              padding: '8px 12px',
                              backgroundColor: '#4F46E5',
                              color: 'white',
                              border: 'none',
                              borderRadius: '6px',
                              cursor: agileSelectedBrimRowId ? 'pointer' : 'not-allowed'
                            }}
                          >
                            {savingBrimLinks ? 'Saving...' : 'Add Row'}
                          </button>
                        </div>
                        {brimRowsLoading && (
                          <div style={{ color: '#6B7280', marginTop: '8px' }}>Loading BIM tracker rows...</div>
                        )}
                        {brimRowsError && (
                          <div style={{ color: '#ef4444', marginTop: '8px' }}>{brimRowsError}</div>
                        )}
                        {agileLinkedBrimRowIds.length === 0 ? (
                          <div style={{ color: '#6B7280', marginTop: '8px' }}>No linked BIM tracker rows yet.</div>
                        ) : (
                          <ul style={{ listStyle: 'none', padding: 0, marginTop: '12px' }}>
                            {agileLinkedBrimRowIds.map(rowId => {
                              const rowLabel = brimRows.find(row => row.id === rowId)?.label || `Row ${rowId}`;
                              return (
                                <li key={rowId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '8px', border: '1px solid #E5E7EB', borderRadius: '6px', marginBottom: '8px' }}>
                                  <button
                                    type="button"
                                    onClick={() => openBrimRowDetail(rowId)}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      color: '#2563eb',
                                      textDecoration: 'underline',
                                      cursor: 'pointer',
                                      textAlign: 'left',
                                      padding: 0
                                    }}
                                  >
                                    {rowLabel}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveAgileBrimRow(agileDetailTask.id, rowId)}
                                    disabled={savingBrimLinks}
                                    style={{
                                      padding: '6px 10px',
                                      backgroundColor: '#ef4444',
                                      color: 'white',
                                      border: 'none',
                                      borderRadius: '6px',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    Remove
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>

                      <div className="agile-modal-section">
                        <h4>Comments</h4>
                        <div className="agile-modal-comment">
                          <textarea
                            rows={3}
                            placeholder="Add a comment..."
                            value={agileCommentDraft}
                            onChange={(event) => setAgileCommentDraft(event.target.value)}
                            style={{
                              width: '100%',
                              padding: '10px',
                              borderRadius: '8px',
                              border: '1px solid #E5E7EB',
                              fontSize: '14px',
                              resize: 'vertical',
                              marginBottom: '10px'
                            }}
                          />
                          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                            <input
                              type="file"
                              multiple
                              onChange={(event) => setAgileCommentFiles(Array.from(event.target.files || []))}
                              style={{ flex: 1 }}
                            />
                            <button type="button" onClick={handleAgileAddComment} disabled={agileCommentUploading}>
                              {agileCommentUploading ? 'Uploading...' : 'Add Comment'}
                            </button>
                          </div>
                        </div>
                        <div className="agile-modal-list">
                          {agileComments.length === 0 ? (
                            <p className="agile-modal-empty">No comments yet.</p>
                          ) : (
                            agileComments.map(comment => (
                              <div key={comment.id} className="agile-modal-item">
                                <div className="agile-modal-item-header">
                                  <span>{comment.author?.displayName || 'Unknown'}</span>
                                  <span>{comment.createdAt ? new Date(comment.createdAt).toLocaleString() : ''}</span>
                                </div>
                                <p>{comment.text}</p>
                                {comment.files && comment.files.length > 0 && (
                                  <div style={{ marginTop: '8px' }}>
                                    <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '6px' }}>Attachments</div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                                      {comment.files.map((file, index) => {
                                        const isImage = /\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i.test(file.name || '');
                                        return (
                                          <div key={`${comment.id}-file-${index}`} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                            {isImage ? (
                                              <a href={file.url} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
                                                <img
                                                  src={file.url}
                                                  alt={file.name || 'attachment'}
                                                  style={{ width: '140px', height: '120px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #E5E7EB' }}
                                                />
                                              </a>
                                            ) : (
                                              <a href={file.url} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>
                                                {file.name || 'Attachment'}
                                              </a>
                                            )}
                                            {file.name && !isImage && (
                                              <div style={{ fontSize: '12px', color: '#6B7280' }}>{file.name}</div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      <div className="agile-modal-section">
                        <h4>Activity Log</h4>
                        <div className="agile-modal-list">
                          {agileActivity.length === 0 ? (
                            <p className="agile-modal-empty">No activity yet.</p>
                          ) : (
                            agileActivity.map(entry => (
                              <div key={entry.id || entry.createdAt} className="agile-modal-item">
                                <div className="agile-modal-item-header">
                                  <span>{entry.user?.displayName || 'Unknown'}</span>
                                  <span>{entry.createdAt ? new Date(entry.createdAt).toLocaleString() : ''}</span>
                                </div>
                                <p>{entry.message}</p>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
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
              {AGILE_STATUSES.map(status => {
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
                            onClick={(e) => handleTaskClick(e, task)}
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
                                {formatAssigneeDisplay(task.assignee)
                                  ? `👤 ${formatAssigneeDisplay(task.assignee)}`
                                  : 'Unassigned'}
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
          </>
        )}
      </div>

      {brimRowDetailId && (
        <div
          onClick={closeBrimRowDetail}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1200
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              backgroundColor: 'white',
              borderRadius: '10px',
              padding: '24px',
              width: '90%',
              maxWidth: '900px',
              maxHeight: '85vh',
              overflow: 'auto'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <button
                type="button"
                onClick={closeBrimRowDetail}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 10px',
                  backgroundColor: '#E5E7EB',
                  color: '#111827',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: '600'
                }}
              >
                <FaChevronLeft /> Back
              </button>
              <Link
                to={`/organization/${id}/time-tracker/brands/${brimRowDetailId}`}
                style={{ color: '#2563eb', textDecoration: 'underline', fontWeight: 600 }}
              >
                Open full detail
              </Link>
            </div>

            {brimRowDetailLoading ? (
              <div style={{ color: '#6B7280' }}>Loading BIM tracker details...</div>
            ) : (
              <div>
                <h3 style={{ marginTop: 0 }}>BIM Tracker Row</h3>
                {brimRowDetail && Object.keys(brimRowDetail).length > 1 ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                    {Object.entries(brimRowDetail)
                      .filter(([key]) => key !== 'id')
                      .map(([key, value]) => (
                        <div key={key} style={{ border: '1px solid #E5E7EB', borderRadius: '8px', padding: '10px' }}>
                          <div style={{ fontSize: '12px', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                            {key}
                          </div>
                          <div style={{ marginTop: '6px', color: '#111827', wordBreak: 'break-word' }}>
                            {formatBrimValue(value)}
                          </div>
                        </div>
                      ))}
                  </div>
                ) : (
                  <div style={{ color: '#6B7280' }}>No detail data available.</div>
                )}

                <div style={{ marginTop: '20px' }}>
                  <h4 style={{ marginBottom: '10px' }}>Comments</h4>
                  {brimRowCommentsLoading && (
                    <div style={{ color: '#6B7280' }}>Loading comments...</div>
                  )}
                  {brimRowCommentsError && (
                    <div style={{ color: '#ef4444' }}>{brimRowCommentsError}</div>
                  )}
                  {!brimRowCommentsLoading && !brimRowCommentsError && brimRowComments.length === 0 && (
                    <div style={{ color: '#6B7280' }}>No comments yet.</div>
                  )}
                  {!brimRowCommentsLoading && !brimRowCommentsError && brimRowComments.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {brimRowComments.map(comment => (
                        <div key={comment.id} style={{ border: '1px solid #E5E7EB', borderRadius: '8px', padding: '12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                            <div style={{ fontWeight: 600 }}>
                              {comment.createdBy || comment.author?.displayName || 'Unknown'}
                            </div>
                            <div style={{ fontSize: '12px', color: '#6B7280' }}>
                              {formatBrimCommentDate(comment.createdAt)}
                            </div>
                          </div>
                          {comment.text && (
                            <div style={{ marginTop: '8px', whiteSpace: 'pre-wrap' }}>
                              {comment.text}
                            </div>
                          )}
                          {comment.attachments && comment.attachments.length > 0 && (
                            <div style={{ marginTop: '10px' }}>
                              <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '6px' }}>Attachments</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                                {comment.attachments.map((file, index) => (
                                  <div key={`${comment.id}-file-${index}`} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    {isBrimImageAttachment(file) ? (
                                      <a href={file.url} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
                                        <img
                                          src={file.url}
                                          alt={file.name || 'attachment'}
                                          style={{ width: '140px', height: '120px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #E5E7EB' }}
                                        />
                                      </a>
                                    ) : (
                                      <a href={file.url} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>
                                        {file.name || 'Attachment'}
                                      </a>
                                    )}
                                    {file.name && !isBrimImageAttachment(file) && (
                                      <div style={{ fontSize: '12px', color: '#6B7280' }}>{file.name}</div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default BuildMyChurch;
