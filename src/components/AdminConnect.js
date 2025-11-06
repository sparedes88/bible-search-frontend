import React, { useState, useEffect, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import ChurchHeader from "./ChurchHeader";
import safeToast from "../utils/toastUtils";
import "./Admin.css";
import { db } from "../firebase";
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  query,
  getDocs,
  orderBy,
  limit,
  updateDoc,
  where,
  addDoc,
  writeBatch,
  onSnapshot,
  getDoc,
  startAfter,
} from "firebase/firestore";
import { FiEdit2, FiSave, FiX, FiTrash2, FiMessageCircle, FiCheck, FiDownload } from "react-icons/fi";
import { IoIosAdd } from "react-icons/io";
import { FaRegEye, FaFilePdf, FaChartPie, FaArrowLeft } from "react-icons/fa6";
import commonStyles from "../pages/commonStyles";
import "./AdminConnect.css";
import "../styles/printStyles.css";
import { getBalance, deductBalance, calculateMessageAllowance } from "../services/balanceService";
import UserResponseLog from './UserResponseLog';
import AdminConnectPDFLink from './AdminConnectPDF';
import planningCenterService from '../services/planningCenterService';
import { FaSync, FaCheckCircle } from 'react-icons/fa';

const formatPhoneNumber = (value) => {
  if (!value) return value;
  const phoneNumber = value.replace(/[^\d]/g, "");
  if (phoneNumber.length > 10) return phoneNumber.slice(0, 10);
  return phoneNumber;
};

const formatPhoneDisplay = (value) => {
  if (!value) return value;
  const phoneNumber = value.replace(/[^\d]/g, "");
  if (phoneNumber.length >= 10) {
    return `(${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3, 6)}-${phoneNumber.slice(6)}`;
  }
  if (phoneNumber.length >= 6) {
    return `(${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3, 6)}-${phoneNumber.slice(6)}`;
  }
  if (phoneNumber.length >= 3) {
    return `(${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3)}`;
  }
  return phoneNumber;
};

const isValidName = (value) => {
  return /^[A-Za-zÀ-ÿ\s]*$/.test(value);
};

const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const AdminConnect = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [recentVisitors, setRecentVisitors] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editedData, setEditedData] = useState({});
  const [editingTag, setEditingTag] = useState("");
  const [editingTags, setEditingTags] = useState([]);
  const [tagFilter, setTagFilter] = useState("");
  const [tagFilters, setTagFilters] = useState([]);
  const [activeTab, setActiveTab] = useState('visitors');
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tagInputs, setTagInputs] = useState({});
  const [dateSort, setDateSort] = useState('desc');
  const [dateFilter, setDateFilter] = useState('all');
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [sortOrder, setSortOrder] = useState('desc');
  const [selectedDate, setSelectedDate] = useState('');
  const [customDateFilter, setCustomDateFilter] = useState(false);
  const [sortConfig, setSortConfig] = useState({
    field: 'createdAt',
    direction: 'desc'
  });
  const [showTagInput, setShowTagInput] = useState({});

  // Additional state for multi-select functionality
  const [selectedItems, setSelectedItems] = useState([]);
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [groupMessage, setGroupMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const messageInputRef = useRef(null);

  // Balance state
  const [balanceData, setBalanceData] = useState(null);
  const [showRechargePrompt, setShowRechargePrompt] = useState(false);
  
  // State for tracking unread messages
  const [unreadMessageCounts, setUnreadMessageCounts] = useState({
    visitors: {},
    members: {}
  });

  // Planning Center sync states
  const [pcConnected, setPcConnected] = useState(false);
  const [pcSyncing, setPcSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState({});
  const [showPcConfigModal, setShowPcConfigModal] = useState(false);
  const [pcAppId, setPcAppId] = useState('');
  const [pcSecret, setPcSecret] = useState('');
  const [pcTesting, setPcTesting] = useState(false);
  const [pcLastSync, setPcLastSync] = useState(null);
  const [pcLastSyncResults, setPcLastSyncResults] = useState(null);
  const [showPcOnly, setShowPcOnly] = useState(false);
  const [showLastSyncOnly, setShowLastSyncOnly] = useState(false);
  // Sync preview modal
  const [showPcPreviewModal, setShowPcPreviewModal] = useState(false);
  const [pcPreviewLoading, setPcPreviewLoading] = useState(false);
  const [pcPreviewCounts, setPcPreviewCounts] = useState(null);
  const [pcPreviewPeople, setPcPreviewPeople] = useState([]);
  const [pcPreviewPeopleLoading, setPcPreviewPeopleLoading] = useState(false);
  // Preferred locations (no fallback chains)
  const [locationPrefs, setLocationPrefs] = useState({
    email: 'home',
    phone: 'mobile',
    address: 'home'
  });

  // No fallback options needed; we use fixed location preferences
  // Sync logs state
  const [pcLogs, setPcLogs] = useState([]);
  const [pcLogsPageSize, setPcLogsPageSize] = useState(3); // Changed to 3 per page
  const [pcLogsCursors, setPcLogsCursors] = useState([]); // stack of cursors for pagination
  const [pcLogsHasMore, setPcLogsHasMore] = useState(true);
  const [pcLogsLoading, setPcLogsLoading] = useState(false);
  const [showSyncHistory, setShowSyncHistory] = useState(false); // Toggle for showing history
  const [showPcLogEntriesModal, setShowPcLogEntriesModal] = useState(false);
  const [pcLogEntries, setPcLogEntries] = useState([]);
  const [pcLogEntriesHasMore, setPcLogEntriesHasMore] = useState(true);
  const [pcLogEntriesLoading, setPcLogEntriesLoading] = useState(false);
  const [pcLogEntriesCursor, setPcLogEntriesCursor] = useState(null);
  const [logEntriesSearchTerm, setLogEntriesSearchTerm] = useState("");
  const [filteredLogEntries, setFilteredLogEntries] = useState([]);
  const [selectedLog, setSelectedLog] = useState(null);
  // Field mapping modal
  const [showFieldMappingModal, setShowFieldMappingModal] = useState(false);
  // Sync issues state
  const [showSyncIssuesModal, setShowSyncIssuesModal] = useState(false);
  const [syncIssues, setSyncIssues] = useState([]);
  const [fieldMappings, setFieldMappings] = useState({
    firstName: 'first_name',         // maps to visitorData.name
    lastName: 'last_name',
    email: 'primary_contact_email',
    phone: 'primary_contact_phone',
    birthdate: 'birthdate',          // maps to visitorData.dateOfBirth
    gender: 'sex',                   // Planning Center uses 'sex', maps to visitorData.gender
    maritalStatus: 'marital_status', // maps to visitorData.maritalStatus
    avatar: 'avatar',
    street: 'street',                // maps to visitorData.address.street
    city: 'city',                    // maps to visitorData.address.city
    state: 'state',                  // maps to visitorData.address.state
    zip: 'zip',                      // maps to visitorData.address.zipCode
    country: 'country'               // maps to visitorData.address.country
  });

  const dateFilterOptions = [
    { value: 'all', label: 'All Dates' },
    { value: 'today', label: 'Today' },
    { value: 'week', label: 'This Week' },
    { value: 'month', label: 'This Month' },
    { value: 'year', label: 'This Year' }
  ];

  useEffect(() => {
    // Redirect members to their profile page
    if (user?.role === "member") {
      navigate(`/organization/${id}/mi-perfil`);
    }
    // Make sure admin and global_admin users are allowed
    if (user && user.role !== 'admin' && user.role !== 'global_admin') {
      navigate(`/organization/${id}/mi-perfil`);
      safeToast.error("You need admin privileges to access this page");
    }
  }, [id, user, navigate]);

  useEffect(() => {
    const fetchRecentVisitors = async () => {
      if (!id || !user) return;

      try {
        console.log("Fetching visitors for church:", id);
        const visitorsRef = collection(db, "visitors", id, "visitors");
        const q = query(visitorsRef, orderBy("createdAt", "desc"));
        const querySnapshot = await getDocs(q);
        console.log("Found visitors:", querySnapshot.size);

        const visitors = querySnapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            createdAt: data.createdAt?.toDate().toLocaleString() || "N/A",
            // Add this flag to track migrated status directly in the visitor list
            hasUserAccount: !!data.migratedToUserId,
            migratedToUserId: data.migratedToUserId || null
          };
        });

        console.log("Processed visitors:", visitors);
        setRecentVisitors(visitors);
      } catch (error) {
        console.error("Error fetching visitors:", error);
        safeToast.error("Failed to load visitors: " + error.message);
      }
    };

    fetchRecentVisitors();
  }, [id, user]);

  // Check Planning Center connection
  useEffect(() => {
    const checkPlanningCenterConnection = async () => {
      if (!id) return;
      
      try {
        const credentials = await planningCenterService.getCredentials(id);
        setPcConnected(!!credentials?.connected);
        if (credentials?.appId) {
          setPcAppId(credentials.appId);
        }
        if (credentials?.secret) {
          setPcSecret(credentials.secret);
        }
        // Load last sync metadata if available
        if (credentials?.lastSync) {
          setPcLastSync(credentials.lastSync);
        }
        if (credentials?.lastSyncResults) {
          setPcLastSyncResults(credentials.lastSyncResults);
        }
        // Don't auto-load logs - wait for user to click "Sync History"
      } catch (error) {
        console.error('Error checking Planning Center connection:', error);
      }
    };
    
    checkPlanningCenterConnection();
  }, [id]);

  const loadPcLogs = async (mode = 'next') => {
    try {
      if (!id || pcLogsLoading) return;
      setPcLogsLoading(true);
      const logsCol = collection(db, 'churches', id, 'pcSyncLogs');
      let qRef = query(logsCol, orderBy('startAt', 'desc'), limit(pcLogsPageSize));
      if (mode === 'next' && pcLogsCursors.length > 0) {
        qRef = query(logsCol, orderBy('startAt', 'desc'), startAfter(pcLogsCursors[pcLogsCursors.length - 1]), limit(pcLogsPageSize));
      }
      if (mode === 'reset') {
        setPcLogs([]);
        setPcLogsCursors([]);
        setPcLogsHasMore(true);
      }
      const snap = await getDocs(qRef);
      const items = snap.docs.map(d => ({ id: d.id, ...d.data(), _doc: d }));
      if (mode === 'reset') {
        setPcLogs(items);
      } else {
        setPcLogs(prev => [...prev, ...items]);
      }
      if (snap.docs.length < pcLogsPageSize) {
        setPcLogsHasMore(false);
      } else {
        setPcLogsCursors(prev => [...prev, snap.docs[snap.docs.length - 1]]);
      }
    } catch (err) {
      console.error('Error loading sync logs:', err);
    } finally {
      setPcLogsLoading(false);
    }
  };

  const openLogEntries = async (log) => {
    try {
      setSelectedLog(log);
      setShowPcLogEntriesModal(true);
      setPcLogEntries([]);
      setPcLogEntriesCursor(null);
      setPcLogEntriesHasMore(true);
      await loadLogEntries(log, 'reset');
    } catch (e) {
      console.error('Error opening log entries:', e);
    }
  };

  const closeLogEntriesModal = () => {
    setShowPcLogEntriesModal(false);
    setLogEntriesSearchTerm("");
    setFilteredLogEntries([]);
  };

  const loadSyncIssues = async () => {
    try {
      if (!id) return;
      // Get the most recent sync log
      const logsCol = collection(db, 'churches', id, 'pcSyncLogs');
      const logsQuery = query(logsCol, orderBy('startAt', 'desc'), limit(1));
      const logsSnap = await getDocs(logsQuery);
      
      if (logsSnap.empty) {
        safeToast.info('No sync logs found');
        return;
      }

      const latestLog = { id: logsSnap.docs[0].id, ...logsSnap.docs[0].data() };
      
      // Get all entries with missing fields or warnings
      const entriesCol = collection(db, 'churches', id, 'pcSyncLogs', latestLog.id, 'entries');
      const entriesSnap = await getDocs(entriesCol);
      
      const issues = [];
      entriesSnap.docs.forEach(doc => {
        const entry = doc.data();
        if (entry.syncReport) {
          const hasMissingFields = entry.syncReport.fieldsMissing && entry.syncReport.fieldsMissing.length > 0;
          const hasWarnings = entry.syncReport.warnings && entry.syncReport.warnings.length > 0;
          
          if (hasMissingFields || hasWarnings) {
            issues.push({
              id: doc.id,
              name: entry.name,
              email: entry.email,
              phone: entry.phone,
              isVisitor: entry.isVisitor,
              fieldsMissing: entry.syncReport.fieldsMissing || [],
              warnings: entry.syncReport.warnings || [],
              fieldsSynced: entry.syncReport.fieldsSynced || []
            });
          }
        }
      });

      setSyncIssues(issues);
      setShowSyncIssuesModal(true);
      
      if (issues.length === 0) {
        safeToast.success('No sync issues found! All fields migrated successfully.');
      }
    } catch (e) {
      console.error('Error loading sync issues:', e);
      safeToast.error('Failed to load sync issues');
    }
  };

  const loadLogEntries = async (log, mode = 'next') => {
    try {
      if (!id || !log || pcLogEntriesLoading) return;
      setPcLogEntriesLoading(true);
      const entriesCol = collection(db, 'churches', id, 'pcSyncLogs', log.id, 'entries');
      let qRef = query(entriesCol, orderBy('at', 'desc'), limit(20));
      if (mode === 'next' && pcLogEntriesCursor) {
        qRef = query(entriesCol, orderBy('at', 'desc'), startAfter(pcLogEntriesCursor), limit(20));
      }
      if (mode === 'reset') {
        setPcLogEntries([]);
      }
      const snap = await getDocs(qRef);
      const items = snap.docs.map(d => ({ id: d.id, ...d.data(), _doc: d }));
      if (mode === 'reset') {
        setPcLogEntries(items);
      } else {
        setPcLogEntries(prev => [...prev, ...items]);
      }
      if (snap.docs.length < 20) {
        setPcLogEntriesHasMore(false);
      } else {
        setPcLogEntriesCursor(snap.docs[snap.docs.length - 1]);
      }
    } catch (err) {
      console.error('Error loading log entries:', err);
    } finally {
      setPcLogEntriesLoading(false);
    }
  };

  // Filter log entries based on search term
  useEffect(() => {
    if (!logEntriesSearchTerm.trim()) {
      setFilteredLogEntries(pcLogEntries);
    } else {
      const filtered = pcLogEntries.filter(entry => {
        const searchLower = logEntriesSearchTerm.toLowerCase();
        return (
          (entry.name && entry.name.toLowerCase().includes(searchLower)) ||
          (entry.email && entry.email.toLowerCase().includes(searchLower)) ||
          (entry.phone && entry.phone.includes(searchLower)) ||
          (entry.personId && entry.personId.toLowerCase().includes(searchLower))
        );
      });
      setFilteredLogEntries(filtered);
    }
  }, [pcLogEntries, logEntriesSearchTerm]);

  // Load sync statuses for visible items
  useEffect(() => {
    const loadSyncStatuses = async () => {
      if (!pcConnected) return;
      
      const items = activeTab === 'visitors' ? recentVisitors : users;
      const statuses = {};
      
      for (const item of items) {
        try {
          const status = await planningCenterService.checkSyncStatus(
            id,
            item.id,
            activeTab === 'visitors'
          );
          statuses[item.id] = status;
        } catch (error) {
          console.error('Error loading sync status:', item.id, error);
        }
      }
      
      setSyncStatus(statuses);
    };
    
    loadSyncStatuses();
  }, [pcConnected, activeTab, recentVisitors, users, id]);

  useEffect(() => {
    const fetchUsers = async () => {
      if (!id || !user) return;

      try {
        const usersRef = collection(db, "users");
        const visitorsRef = collection(db, "visitors", id, "visitors");
        
        // First get all visitors
        const visitorsSnapshot = await getDocs(visitorsRef);
        const visitorsMap = {};
        visitorsSnapshot.docs.forEach(doc => {
          const visitorData = doc.data();
          if (visitorData.migratedToUserId) {
            visitorsMap[visitorData.migratedToUserId] = {
              visitorTags: visitorData.tags || [],
              visitorCreatedAt: visitorData.createdAt?.toDate?.()?.toLocaleString() || "N/A",
              visitorId: doc.id
            };
          }
        });

        // Then get users and merge with visitor data
        const q = query(usersRef, where("churchId", "==", id));
        const querySnapshot = await getDocs(q);
        
        const usersData = querySnapshot.docs.map((doc) => {
          const data = doc.data();
          const migrationDetails = data.migrationDetails || {};
          const visitorData = visitorsMap[doc.id] || {};
          const originalDate = migrationDetails.originalCreationDate 
            ? new Date(migrationDetails.originalCreationDate) 
            : null;
          
          return {
            id: doc.id,
            ...data,
            createdAt: visitorData.visitorCreatedAt || 
                      originalDate?.toLocaleString() || 
                      data.createdAt?.toDate?.()?.toLocaleString() || 
                      "N/A",
            isMember: true,
            tags: data.tags || [],
            visitorTags: visitorData.visitorTags || [],
            originalTags: migrationDetails.originalTags || [],
            isMigrated: !!migrationDetails.migratedFrom || !!visitorData.visitorId,
            migrationDate: migrationDetails.migrationDate 
              ? new Date(migrationDetails.migrationDate).toLocaleString() 
              : null,
            visitorId: visitorData.visitorId
          };
        });

        setUsers(usersData);
      } catch (error) {
        console.error("Error fetching users:", error);
        safeToast.error("Failed to load users");
      }
    };

    fetchUsers();
  }, [id, user]);

  // Fetch unread message counts when the component loads
  useEffect(() => {
    const fetchUnreadMessages = async () => {
      if (!id || !user) return;
      
      try {
        // Create a reference to the special document that tracks unread counts
        const unreadDocRef = doc(db, `churches/${id}/adminConnect/members`);
        const unreadDoc = await getDoc(unreadDocRef);
        
        // If the document exists, use its data
        if (unreadDoc.exists()) {
          const memberCounts = unreadDoc.data() || {};
          
          // Set the member counts
          setUnreadMessageCounts(prev => ({
            ...prev,
            members: memberCounts
          }));
          
          console.log("Loaded unread message counts from adminConnect/members document:", memberCounts);
        } else {
          console.log("No existing adminConnect/members document, creating one");
          // Initialize the document if it doesn't exist
          await setDoc(unreadDocRef, {});
        }
        
        // Fetch unread visitor messages
        const visitorMessagesRef = collection(db, `churches/${id}/visitorMessages`);
        const visitorQuery = query(
          visitorMessagesRef,
          where('isRead', '==', false),
          where('senderId', '!=', user.uid)
        );
        
        const visitorSnapshot = await getDocs(visitorQuery);
        const visitorMessageCounts = {};
        
        visitorSnapshot.forEach(doc => {
          const data = doc.data();
          if (data.visitorId) {
            visitorMessageCounts[data.visitorId] = (visitorMessageCounts[data.visitorId] || 0) + 1;
          }
        });
        
        setUnreadMessageCounts(prev => ({
          ...prev,
          visitors: visitorMessageCounts
        }));
        
        console.log("Loaded unread visitor messages:", visitorMessageCounts);
      } catch (error) {
        console.error("Error fetching unread messages:", error);
      }
    };
    
    fetchUnreadMessages();
    
    // Set up real-time listener for adminConnect/members document
    const unreadDocRef = doc(db, `churches/${id}/adminConnect/members`);
    const unsubscribeMemberCounts = onSnapshot(unreadDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const memberCounts = docSnap.data();
        setUnreadMessageCounts(prev => ({
          ...prev,
          members: memberCounts
        }));
        console.log("Real-time update of unread member counts:", memberCounts);
      }
    }, error => {
      console.error("Error in real-time listener for member counts:", error);
    });
    
    // Set up real-time listener for visitor messages
    const visitorMessagesRef = collection(db, `churches/${id}/visitorMessages`);
    const visitorQuery = query(
      visitorMessagesRef, 
      where('isRead', '==', false),
      where('senderId', '!=', user.uid)
    );
    
    const unsubscribeVisitor = onSnapshot(visitorQuery, (snapshot) => {
      const visitorMessageCounts = {};
      
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.visitorId) {
          visitorMessageCounts[data.visitorId] = (visitorMessageCounts[data.visitorId] || 0) + 1;
        }
      });
      
      setUnreadMessageCounts(prev => ({
        ...prev,
        visitors: visitorMessageCounts
      }));
      
      console.log("Real-time update of unread visitor counts:", visitorMessageCounts);
    }, error => {
      console.error("Error in real-time listener for visitor messages:", error);
    });
    
    // Return cleanup function
    return () => {
      unsubscribeMemberCounts();
      unsubscribeVisitor();
    };
  }, [id, user]);

  // Check for refresh flag when component mounts or when URL changes
  useEffect(() => {
    // Check if we need to force refresh the unread counts
    const shouldRefresh = sessionStorage.getItem('forceRefreshAdminConnect') === 'true';
    if (shouldRefresh) {
      console.log('Forcing refresh of unread message counts due to sessionStorage flag');
      // Remove the flag
      sessionStorage.removeItem('forceRefreshAdminConnect');
      
      // Re-fetch unread message counts
      const refreshUnreadCounts = async () => {
        try {
          // Refresh member counts
          const unreadDocRef = doc(db, `churches/${id}/adminConnect/members`);
          const unreadDoc = await getDoc(unreadDocRef);
          
          if (unreadDoc.exists()) {
            const memberCounts = unreadDoc.data() || {};
            setUnreadMessageCounts(prev => ({
              ...prev,
              members: memberCounts
            }));
          }
          
          // Refresh visitor message counts
          const visitorMessagesRef = collection(db, `churches/${id}/visitorMessages`);
          const visitorQuery = query(
            visitorMessagesRef,
            where('isRead', '==', false),
            where('senderId', '!=', user.uid)
          );
          
          const visitorSnapshot = await getDocs(visitorQuery);
          const visitorMessageCounts = {};
          
          visitorSnapshot.forEach(doc => {
            const data = doc.data();
            if (data.visitorId) {
              visitorMessageCounts[data.visitorId] = (visitorMessageCounts[data.visitorId] || 0) + 1;
            }
          });
          
          setUnreadMessageCounts(prev => ({
            ...prev,
            visitors: visitorMessageCounts
          }));
          
          console.log('Successfully refreshed unread message counts');
        } catch (error) {
          console.error('Error refreshing unread counts:', error);
        }
      };
      
      refreshUnreadCounts();
    }
  }, [id, user, db]);

  // Fetch balance data when component loads
  useEffect(() => {
    const fetchBalanceData = async () => {
      try {
        if (id) {
          const data = await getBalance(id);
          setBalanceData(data);
        }
      } catch (error) {
        console.error('Error fetching balance:', error);
      }
    };

    fetchBalanceData();
  }, [id]);

  // Helper function to get non-migrated visitor count
  const getNonMigratedVisitorCount = () => {
    return recentVisitors.filter(visitor => !visitor.hasUserAccount).length;
  };

  const getFilteredData = () => {
    // Start with the appropriate data source based on active tab
    let currentData = activeTab === 'visitors' ? recentVisitors : users;
    
    // For the visitors tab, filter out migrated visitors
    if (activeTab === 'visitors') {
      currentData = currentData.filter(visitor => !visitor.hasUserAccount);

      // Planning Center quick filters
      if (showPcOnly) {
        currentData = currentData.filter(v => (v.tags || []).some(t => String(t).toLowerCase() === 'planning_center'));
      }
      if (showLastSyncOnly && pcLastSync) {
        const lastSyncTime = new Date(pcLastSync).getTime();
        currentData = currentData.filter(v => v.syncedAt && new Date(v.syncedAt).getTime() >= lastSyncTime);
      }
    }
    
    // Apply filtering based on search and other criteria
    let filteredData = currentData.filter((item) => {
      const matchesSearch =
        item.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.lastName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.phone?.includes(searchTerm) ||
        item.email?.toLowerCase().includes(searchTerm.toLowerCase());
  
      const matchesTags =
        tagFilters.length === 0 ||
        tagFilters.every((filterTag) =>
          item.tags?.some((tag) =>
            tag.toLowerCase().includes(filterTag.toLowerCase())
          )
        );

      // Convert item date string to Date object and remove time component
      const itemDate = new Date(item.createdAt);
      const itemDateString = `${itemDate.getFullYear()}-${String(itemDate.getMonth() + 1).padStart(2, '0')}-${String(itemDate.getDate()).padStart(2, '0')}`;
      
      const today = new Date();
      let matchesDateFilter = true;

      if (customDateFilter && selectedDate) {
        // Compare dates without time component
        matchesDateFilter = itemDateString === selectedDate;
      } else {
        switch (dateFilter) {
          case 'today':
            const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            matchesDateFilter = itemDateString === todayString;
            break;
          case 'week':
            const weekAgo = new Date(today);
            weekAgo.setDate(today.getDate() - 7);
            matchesDateFilter = itemDate >= weekAgo;
            break;
          case 'month':
            matchesDateFilter = (
              itemDate.getMonth() === today.getMonth() &&
              itemDate.getFullYear() === today.getFullYear()
            );
            break;
          case 'year':
            matchesDateFilter = itemDate.getFullYear() === today.getFullYear();
            break;
          default:
            matchesDateFilter = true;
        }
      }

      return matchesSearch && matchesTags && matchesDateFilter;
    });

    // Apply sorting based on sortConfig
    filteredData.sort((a, b) => {
      let compareA = a[sortConfig.field];
      let compareB = b[sortConfig.field];

      // Handle special cases for name + lastName combined sort
      if (sortConfig.field === 'fullName') {
        compareA = `${a.name} ${a.lastName}`.toLowerCase();
        compareB = `${b.name} ${b.lastName}`.toLowerCase();
      }

      // Handle date sorting
      if (sortConfig.field === 'createdAt') {
        compareA = new Date(a.createdAt);
        compareB = new Date(b.createdAt);
      }

      if (compareA < compareB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (compareA > compareB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return filteredData;
  };

  const handleDateSort = () => {
    setDateSort(current => {
      if (current === 'desc') return 'asc';
      if (current === 'asc') return null;
      return 'desc';
    });
  };

  const handleSortChange = (e) => {
    setSortOrder(e.target.value);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (!formData.name || !formData.lastName || !formData.phone) {
        safeToast.error("Name, last name and phone are required");
        return;
      }

      if (!user) {
        safeToast.error("You must be logged in");
        return;
      }

      const visitorData = {
        name: formData.name,
        lastName: formData.lastName || "",
        phone: formatPhoneNumber(formData.phone),
        email: "",
        role: "member",
        churchId: id,
        createdAt: serverTimestamp(),
        createdBy: user.uid,
        status: "active",
        groups: [],
        tags: formData.tags || [],
      };

      const timestamp = Date.now().toString();
      const visitorRef = doc(db, "visitors", id, "visitors", timestamp);

      await setDoc(visitorRef, visitorData);
      console.log("Visitor added successfully");

      const visitorsRef = collection(db, "visitors", id, "visitors");
      const q = query(visitorsRef, orderBy("createdAt", "desc"));
      const querySnapshot = await getDocs(q);
      const visitors = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate().toLocaleString() || "N/A",
      }));
      setRecentVisitors(visitors);

      safeToast.success("Visitor added successfully!");

      setFormData({
        name: "",
        lastName: "",
        phone: "",
        email: "",
        tags: [],
      });
    } catch (error) {
      console.error("Error:", error);
      if (error.code === "permission-denied") {
        safeToast.error("You do not have permission to add visitors");
      } else {
        safeToast.error(error.message || "Failed to add visitor");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;

    switch (name) {
      case "phone":
        const formattedPhone = formatPhoneNumber(value);
        setFormData((prev) => ({
          ...prev,
          [name]: formattedPhone,
        }));
        break;

      case "name":
      case "lastName":
        if (isValidName(value)) {
          setFormData((prev) => ({
            ...prev,
            [name]: value,
          }));
        }
        break;

      default:
        setFormData((prev) => ({
          ...prev,
          [name]: value,
        }));
    }
  };

  const handleEdit = (visitor) => {
    if (visitor.hasUserAccount) {
      navigate(`/organization/${id}/admin-connect/member/${visitor.migratedToUserId}`);
      return;
    }
    
    setEditingId(visitor.id);
    setEditedData({
      ...visitor,
    });
    setEditingTags(visitor.tags || []);
    setEditingTag("");
  };

  const handleSave = async (visitorId) => {
    try {
      const visitorRef = doc(db, "visitors", id, "visitors", visitorId);
      const updateData = {
        name: editedData.name,
        lastName: editedData.lastName,
        phone: formatPhoneNumber(editedData.phone),
        tags: editingTags,
      };

      await updateDoc(visitorRef, updateData);
      safeToast.success("Visitor updated successfully!");
      setEditingId(null);
      setEditingTag("");
      setEditingTags([]);

      const visitorsRef = collection(db, "visitors", id, "visitors");
      const q = query(visitorsRef, orderBy("createdAt", "desc"));
      const querySnapshot = await getDocs(q);
      const visitors = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate().toLocaleString() || "N/A",
      }));
      setRecentVisitors(visitors);
    } catch (error) {
      console.error("Error updating visitor:", error);
      safeToast.error("Failed to update visitor");
    }
  };

  const handleAddTag = () => {
    if (currentTag.trim()) {
      setFormData((prev) => ({
        ...prev,
        tags: [...prev.tags, currentTag.trim()],
      }));
      setCurrentTag("");
    }
  };

  const handleRemoveTag = (tagToRemove) => {
    setFormData((prev) => ({
      ...prev,
      tags: prev.tags.filter((tag) => tag !== tagToRemove),
    }));
  };

  const handleAddEditingTag = () => {
    if (editingTag.trim()) {
      setEditingTags((prev) => [...prev, editingTag.trim()]);
      setEditingTag("");
    }
  };

  const handleRemoveEditingTag = (tagToRemove) => {
    setEditingTags((prev) => prev.filter((tag) => tag !== tagToRemove));
  };

  

  const handleDelete = async (visitorId) => {
    if (window.confirm('Are you sure you want to delete this visitor?')) {
      try {
        const visitorRef = doc(db, "visitors", id, "visitors", visitorId);
        await deleteDoc(visitorRef);
        safeToast.success("Visitor deleted successfully!");

        setRecentVisitors(prev => prev.filter(visitor => visitor.id !== visitorId));
      } catch (error) {
        console.error("Error deleting visitor:", error);
        safeToast.error("Failed to delete visitor");
      }
    }
  };

  const handleDeleteMember = async (memberId) => {
    if (!window.confirm('Are you sure you want to delete this member? This action cannot be undone.')) {
      return;
    }
    
    try {
      // Show a second confirmation for extra safety
      if (!window.confirm('WARNING: This will permanently delete all member data including their messages and activity. Continue?')) {
        return;
      }

      setLoading(true);
      
      // 1. Delete messages associated with the member
      const messagesRef = collection(db, 'messages');
      const messageQuery = query(messagesRef, where('memberId', '==', memberId));
      const messageSnapshot = await getDocs(messageQuery);
      
      // Batch delete messages
      const messageBatchPromises = [];
      let messageBatch = [];
      messageSnapshot.docs.forEach(doc => {
        messageBatch.push(deleteDoc(doc.ref));
        
        // Process in batches of 20 to avoid overloading Firestore
        if (messageBatch.length >= 20) {
          messageBatchPromises.push(Promise.all(messageBatch));
          messageBatch = [];
        }
      });
      
      if (messageBatch.length > 0) {
        messageBatchPromises.push(Promise.all(messageBatch));
      }
      
      await Promise.all(messageBatchPromises);
      
      // 2. Delete notes associated with the member
      const notesRef = collection(db, 'users', memberId, 'notes');
      const notesSnapshot = await getDocs(notesRef);
      
      const notesDeletePromises = notesSnapshot.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(notesDeletePromises);
      
      // 3. Delete the user document
      await deleteDoc(doc(db, 'users', memberId));
      
      // 4. Update local state to remove the deleted member
      setUsers(prev => prev.filter(user => user.id !== memberId));
      
      safeToast.success('Member deleted successfully');
    } catch (error) {
      console.error('Error deleting member:', error);
      safeToast.error('Failed to delete member: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleBackClick = (id) => {
    navigate(`/organization/${id}/mi-organizacion`);
  };

  const handleViewMember = (item) => {
    if (item.isMember) {
      navigate(`/organization/${id}/member/${item.id}`);
    } else if (item.hasUserAccount) {
      navigate(`/organization/${id}/member/${item.migratedToUserId}`);
    } else {
      navigate(`/organization/${id}/admin-connect/${item.id}`);
    }
  };

  const handlePlanningCenterSync = async () => {
    if (!pcConnected) {
      safeToast.info('Please connect Planning Center first in organization settings');
      return;
    }

    setPcSyncing(true);
    try {
      const credentials = await planningCenterService.getCredentials(id);
      if (!credentials?.appId || !credentials?.secret) {
        safeToast.error('Planning Center credentials not found');
        return;
      }

      safeToast.info('Starting Planning Center sync...');
      
      const results = await planningCenterService.syncAllPeople(
        id,
        credentials.appId,
        credentials.secret,
        (progress) => {
          console.log('Sync progress:', progress);
        }
      );

      safeToast.success(
        `Sync complete! New Visitors: ${results.createdVisitors || 0}, Updated Visitors: ${results.updatedVisitors || 0}, Errors: ${results.errors}`
      );

      // Reload data
      window.location.reload();
    } catch (error) {
      console.error('Planning Center sync error:', error);
      safeToast.error('Failed to sync with Planning Center');
    } finally {
      setPcSyncing(false);
    }
  };

  const handleOpenPreview = async () => {
    if (!pcConnected) {
      safeToast.info('Please connect Planning Center first');
      return;
    }
    try {
      setPcPreviewLoading(true);
      setShowPcPreviewModal(true);
      const credentials = await planningCenterService.getCredentials(id);
      if (!credentials?.appId || !credentials?.secret) {
        safeToast.error('Planning Center credentials not found');
        return;
      }
      const counts = await planningCenterService.previewSync(id, credentials.appId, credentials.secret);
      setPcPreviewCounts(counts);
      // Load saved mappings/preferences if present
      const saved = await planningCenterService.getMappings(id);
      if (saved.fieldMappings && Object.keys(saved.fieldMappings).length) {
        setFieldMappings(prev => ({ ...prev, ...saved.fieldMappings }));
      }
      if (saved.locationPrefs) {
        setLocationPrefs(prev => ({ ...prev, ...saved.locationPrefs }));
      }
      // Optionally preload a small sample immediately
      // await loadPcPreviewPeople(credentials.appId, credentials.secret);
    } catch (e) {
      console.error('Preview error:', e);
      safeToast.error('Failed to load preview');
    } finally {
      setPcPreviewLoading(false);
    }
  };

  const buildPcFlatObject = (person, details) => {
    // Flatten attributes and enrich with derived values similar to sync
    const attrs = person.attributes || {};
    // Address
    let street = '', city = '', state = '', zipCode = '', country = 'US';
    if (Array.isArray(details?.addresses) && details.addresses.length > 0) {
      const primaryAddr = details.addresses.find(a => a.attributes?.primary) || details.addresses[0];
      const a = primaryAddr?.attributes || {};
      street = a.street || a.line1 || a.line_1 || '';
      city = a.city || '';
      state = a.state || '';
      zipCode = a.zip || a.postal_code || '';
      country = a.country || 'US';
    }
    // Email
    let primaryEmail = '';
    if (Array.isArray(details?.emails) && details.emails.length > 0) {
      const e = details.emails.find(e => e.attributes?.primary) || details.emails[0];
      primaryEmail = e?.attributes?.address || '';
    }
    // Phone
    let primaryPhone = '';
    if (Array.isArray(details?.phones) && details.phones.length > 0) {
      const mobile = details.phones.find(p => (p.attributes?.location || '').toLowerCase() === 'mobile');
      const p = details.phones.find(p => p.attributes?.primary) || mobile || details.phones[0];
      primaryPhone = p?.attributes?.number || '';
    }

    const gender = (attrs.gender || attrs.sex || '').toLowerCase();

    const flat = {
      ...attrs,
      gender,
      street, city, state, zipCode, country,
      primaryEmail,
      primaryPhone
    };

    // Expand per-location keys so preview can pick strictly by location
    if (Array.isArray(details?.emails)) {
      details.emails.forEach((e, idx) => {
        const addr = e?.attributes?.address || '';
        const loc = (e?.attributes?.location || '').toLowerCase();
        flat[`email_${idx}`] = addr;
        if (loc) flat[`email_${loc}`] = flat[`email_${loc}`] || addr;
      });
    }
    if (Array.isArray(details?.phones)) {
      details.phones.forEach((p, idx) => {
        const num = p?.attributes?.number || '';
        const loc = (p?.attributes?.location || '').toLowerCase();
        flat[`phone_${idx}`] = num;
        if (loc) flat[`phone_${loc}`] = flat[`phone_${loc}`] || num;
      });
    }
    if (Array.isArray(details?.addresses)) {
      details.addresses.forEach((a) => {
        const at = a?.attributes || {};
        const loc = (at.location || '').toLowerCase();
        if (!loc) return;
        if (!flat[`street_${loc}`]) flat[`street_${loc}`] = at.street || at.line1 || at.line_1 || '';
        if (!flat[`city_${loc}`]) flat[`city_${loc}`] = at.city || '';
        if (!flat[`state_${loc}`]) flat[`state_${loc}`] = at.state || '';
        if (!flat[`zip_${loc}`]) flat[`zip_${loc}`] = at.zip || at.postal_code || '';
        if (!flat[`country_${loc}`]) flat[`country_${loc}`] = at.country || '';
      });
    }

    return flat;
  };

  const applyFieldMappings = (pcFlat, mappings) => {
    const get = (key) => pcFlat?.[key] ?? '';
    const emailLoc = (locationPrefs.email || '').toLowerCase();
    const phoneLoc = (locationPrefs.phone || '').toLowerCase();
    const addrLoc = (locationPrefs.address || '').toLowerCase();
    return {
      name: get(mappings.firstName || 'first_name'),
      lastName: get(mappings.lastName || 'last_name'),
      email: get(`email_${emailLoc}`),
      phone: get(`phone_${phoneLoc}`),
      dateOfBirth: get(mappings.birthdate || 'birthdate'),
      gender: (get(mappings.gender || 'sex') || '').toLowerCase(),
      maritalStatus: get(mappings.maritalStatus || 'marital_status') || '',
      address: {
        street: get(`street_${addrLoc}`) || get(mappings.street || 'street'),
        city: get(`city_${addrLoc}`) || get(mappings.city || 'city'),
        state: get(`state_${addrLoc}`) || get(mappings.state || 'state'),
        zipCode: get(`zip_${addrLoc}`) || get(mappings.zip || 'zip'),
        country: get(`country_${addrLoc}`) || get(mappings.country || 'country') || 'US',
      }
    };
  };

  const findExistingRecordForPreview = (pcPerson) => {
    // Try by planningCenterId in recent visitors or users
    const pcId = pcPerson.id;
    const inVisitors = recentVisitors.find(v => v.planningCenterId === pcId);
    if (inVisitors) return { type: 'visitor', record: inVisitors };
    const inUsers = users.find(u => u.planningCenterId === pcId && (u.churchId === id || !u.churchId));
    if (inUsers) return { type: 'member', record: inUsers };
    // Fallback: match by name and email
    const attrs = pcPerson.attributes || {};
    const fullNameMatch = (r) => r.name === attrs.first_name && r.lastName === attrs.last_name;
    const email = attrs.primary_contact_email;
    const byVisitor = recentVisitors.find(r => fullNameMatch(r) && (!email || r.email === email));
    if (byVisitor) return { type: 'visitor', record: byVisitor };
    const byUser = users.find(r => (r.churchId === id || !r.churchId) && fullNameMatch(r) && (!email || r.email === email));
    if (byUser) return { type: 'member', record: byUser };
    return null;
  };

  const loadPcPreviewPeople = async (appId, secret) => {
    try {
      setPcPreviewPeopleLoading(true);
      const peopleData = await planningCenterService.fetchPeople(appId, secret, { perPage: 5, offset: 0 });
      const people = peopleData?.data || [];
      const enriched = [];
      for (const p of people) {
        const details = await planningCenterService.fetchPersonDetails(appId, secret, p.id, p);
        const pcFlat = buildPcFlatObject(p, details);
        const preview = applyFieldMappings(pcFlat, fieldMappings);
        const existing = findExistingRecordForPreview(p);
        enriched.push({ id: p.id, name: `${p.attributes?.first_name || ''} ${p.attributes?.last_name || ''}`.trim(), pcFlat, preview, existing });
      }
      setPcPreviewPeople(enriched);
    } catch (err) {
      console.error('Failed to load PC preview people:', err);
      safeToast.error('Failed to load sample Planning Center people');
    } finally {
      setPcPreviewPeopleLoading(false);
    }
  };

  const handleTestPcConnection = async () => {
    if (!pcAppId || !pcSecret) {
      safeToast.error('Please enter both App ID and Secret');
      return;
    }

    setPcTesting(true);
    try {
      const isValid = await planningCenterService.testConnection(pcAppId, pcSecret);
      if (isValid) {
        safeToast.success('Connection successful!');
      } else {
        safeToast.error('Connection failed. Please check your credentials.');
      }
    } catch (error) {
      console.error('Planning Center test error:', error);
      safeToast.error('Connection test failed');
    } finally {
      setPcTesting(false);
    }
  };

  const handleSavePcConfig = async () => {
    if (!pcAppId || !pcSecret) {
      safeToast.error('Please enter both App ID and Secret');
      return;
    }

    try {
      await planningCenterService.saveCredentials(id, pcAppId, pcSecret);
      setPcConnected(true);
      setShowPcConfigModal(false);
      safeToast.success('Planning Center configured successfully!');
    } catch (error) {
      console.error('Error saving Planning Center config:', error);
      safeToast.error('Failed to save configuration');
    }
  };

  const handleQuickTagRemove = async (itemId, tagToRemove) => {
    try {
      const item = activeTab === 'visitors' 
        ? recentVisitors.find(v => v.id === itemId)
        : users.find(u => u.id === itemId);
      
      if (!item) return;

      const updatedTags = (item.tags || []).filter(tag => tag !== tagToRemove);
      
      if (activeTab === 'visitors') {
        const visitorRef = doc(db, "visitors", id, "visitors", itemId);
        await updateDoc(visitorRef, { tags: updatedTags });
        
        setRecentVisitors(prev => prev.map(visitor => 
          visitor.id === itemId ? { ...visitor, tags: updatedTags } : visitor
        ));
      } else {
        const userRef = doc(db, "users", itemId);
        await updateDoc(userRef, { tags: updatedTags });
        
        setUsers(prev => prev.map(user => 
          user.id === itemId ? { ...user, tags: updatedTags } : user
        ));
      }
      
      safeToast.success("Tag removed successfully!");
    } catch (error) {
      console.error("Error removing tag:", error);
      safeToast.error("Failed to remove tag");
    }
  };

  const handleNewTagSubmit = async (itemId, event) => {
    event.preventDefault();
    const newTag = tagInputs[itemId]?.trim();
    if (!newTag) return;

    try {
      const item = activeTab === 'visitors' 
        ? recentVisitors.find(v => v.id === itemId)
        : users.find(u => u.id === itemId);
      
      if (!item) return;

      const currentTags = item.tags || [];
      if (currentTags.includes(newTag)) return;

      const updatedTags = [...currentTags, newTag];
      
      if (activeTab === 'visitors') {
        const visitorRef = doc(db, "visitors", id, "visitors", itemId);
        await updateDoc(visitorRef, { tags: updatedTags });
        setRecentVisitors(prev => prev.map(visitor => 
          visitor.id === itemId ? { ...visitor, tags: updatedTags } : visitor
        ));
      } else {
        const userRef = doc(db, "users", itemId);
        await updateDoc(userRef, { tags: updatedTags });
        setUsers(prev => prev.map(user => 
          user.id === itemId ? { ...user, tags: updatedTags } : user
        ));
      }

      setTagInputs(prev => ({ ...prev, [itemId]: '' }));
      safeToast.success("Tag added successfully!");
    } catch (error) {
      console.error("Error adding tag:", error);
      safeToast.error("Failed to add tag");
    }
  };

  const handleToggleSelect = (item) => {
    setSelectedItems(prev => {
      // Check if the item is already selected
      const isSelected = prev.some(selected => selected.id === item.id);
      
      if (isSelected) {
        // Remove from selection
        return prev.filter(selected => selected.id !== item.id);
      } else {
        // Add to selection
        return [...prev, item];
      }
    });
  };

  const handleSelectAll = () => {
    const filteredData = getFilteredData();
    if (selectedItems.length === filteredData.length) {
      // If all are selected, deselect all
      setSelectedItems([]);
    } else {
      // Otherwise, select all filtered items
      setSelectedItems(filteredData);
    }
  };

  // Function to calculate estimated cost
  const calculateEstimatedCost = (recipientCount) => {
    // Standard rate per message (this should match the rate in balanceService.js)
    const ratePerMessage = 0.05; // $0.05 per message
    return (ratePerMessage * recipientCount).toFixed(2);
  };

  // Function to check if balance is sufficient for group messaging
  const checkBalanceForGroupMessage = () => {
    if (!balanceData) return false;
    
    // Calculate how many messages we can send with current balance
    const messagesAvailable = calculateMessageAllowance(balanceData.balance);
    
    // Check if we have enough for all selected recipients
    return messagesAvailable >= selectedItems.length;
  };

  const handleOpenMessageModal = async () => {
    if (selectedItems.length === 0) {
      safeToast.warning("Please select at least one member to message");
      return;
    }

    // Make sure balance data is loaded
    if (!balanceData) {
      try {
        const data = await getBalance(id);
        setBalanceData(data);
        
        // Check if balance is too low
        if (data.balance < 5) {
          setShowRechargePrompt(true);
          return;
        }
      } catch (error) {
        console.error('Error fetching balance:', error);
        safeToast.error('Could not verify account balance. Please try again.');
        return;
      }
    } else if (balanceData.balance < 5) {
      // Balance is already loaded and is too low
      setShowRechargePrompt(true);
      return;
    }

    // Explicitly set message modal to open
    setShowMessageModal(true);
    
    // Focus on the message input when modal opens
    setTimeout(() => {
      if (messageInputRef.current) {
        messageInputRef.current.focus();
      }
    }, 100);
  };

  const handleSendGroupMessage = async () => {
    if (!groupMessage.trim()) {
      safeToast.warning("Please enter a message");
      return;
    }

    if (selectedItems.length === 0) {
      safeToast.warning("Please select at least one recipient");
      return;
    }

    // Check if balance is sufficient before proceeding
    if (!balanceData) {
      try {
        // Refresh balance data if it's not loaded
        const data = await getBalance(id);
        setBalanceData(data);
        
        // Check if balance is too low or insufficient
        if (data.balance < 5) {
          setShowRechargePrompt(true);
          return;
        } else if (calculateMessageAllowance(data.balance) < selectedItems.length) {
          safeToast.error(`Insufficient balance for ${selectedItems.length} messages. Please recharge your account.`);
          setShowRechargePrompt(true);
          return;
        }
      } catch (error) {
        console.error('Error fetching balance:', error);
        safeToast.error('Could not verify account balance. Please try again.');
        return;
      }
    } else {
      // We have balance data, check if it's sufficient
      if (balanceData.balance < 5) {
        setShowRechargePrompt(true);
        return;
      } else if (calculateMessageAllowance(balanceData.balance) < selectedItems.length) {
        safeToast.error(`Insufficient balance for ${selectedItems.length} messages. Please recharge your account.`);
        setShowRechargePrompt(true);
        return;
      }
    }

    setSendingMessage(true);

    try {
      // Create a batch for efficient writing to Firestore
      const batch = writeBatch(db);
      const timestamp = serverTimestamp();
      const messagesToAdd = [];
      const messagesForSMS = []; // Track messages that need SMS delivery

      // Process each selected recipient
      for (const recipient of selectedItems) {
        // Skip visitors without phone numbers
        if (!recipient.phone) continue;

        // Format phone number for Twilio
        const phoneNumber = recipient.phone.startsWith('+') ? 
          recipient.phone : 
          `+1${recipient.phone.replace(/\D/g, '')}`;

        // Generate a unique message ID
        const messageId = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Prepare message data
        const messageData = {
          message: groupMessage,
          to: phoneNumber,
          memberName: `${recipient.name} ${recipient.lastName}`.trim(),
          memberId: recipient.id,
          status: "sending", // Set initial status as sending
          sentAt: timestamp,
          sentBy: user.uid,
          senderName: user.displayName || "Admin",
          isGroupMessage: true,
          groupSize: selectedItems.length,
          churchId: id,
          clientMessageId: messageId // Add client ID to track message
        };

        // Add message to church messages collection
        const churchMessagesRef = collection(db, `churches/${id}/messages`);
        const newMessageRef = doc(churchMessagesRef);
        batch.set(newMessageRef, messageData);

        // Also add to the messages collection for reporting
        const globalMessagesRef = collection(db, "messages");
        const newGlobalMessageRef = doc(globalMessagesRef);
        batch.set(newGlobalMessageRef, messageData);

        // If the item is a visitor and not a member, add to the visitorMessages collection
        if (activeTab === 'visitors' && !recipient.isMember && !recipient.hasUserAccount) {
          const visitorMessagesRef = collection(db, `churches/${id}/visitorMessages`);
          const newVisitorMessageRef = doc(visitorMessagesRef);
          const visitorMessageData = {
            ...messageData,
            visitorId: recipient.id,
            visitorName: `${recipient.name} ${recipient.lastName}`.trim()
          };
          batch.set(newVisitorMessageRef, visitorMessageData);

          // Add to SMS delivery queue
          messagesForSMS.push({
            to: phoneNumber,
            messageText: groupMessage,
            messageId: newVisitorMessageRef.id,
            recipientType: 'visitor',
            recipientId: recipient.id,
            recipientName: `${recipient.name} ${recipient.lastName}`.trim()
          });
        }
        // If the item is a member (has user account), add to their profile
        else if (recipient.isMember || recipient.hasUserAccount) {
          // Determine the correct user ID
          const userId = recipient.migratedToUserId || recipient.id;
          const userMessagesRef = collection(db, `users/${userId}/messages`);
          const newUserMessageRef = doc(userMessagesRef);
          batch.set(newUserMessageRef, messageData);

          // Add to SMS delivery queue
          messagesForSMS.push({
            to: phoneNumber,
            messageText: groupMessage,
            messageId: newMessageRef.id,
            recipientType: 'member',
            recipientId: userId,
            recipientName: `${recipient.name} ${recipient.lastName}`.trim()
          });
        }

        messagesToAdd.push({
          id: newMessageRef.id,
          ...messageData,
          sentAt: new Date()
        });
      }

      // Commit the batch write
      await batch.commit();
      
      // Now send actual SMS messages via Cloud Function
      for (const msg of messagesForSMS) {
        try {
          // Send SMS via Cloud Function
          const response = await fetch('https://us-central1-igletechv1.cloudfunctions.net/sendSMS', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              to: msg.to,
              message: msg.messageText,
              churchId: id,
              senderId: user.uid,
              memberId: msg.recipientType === 'member' ? msg.recipientId : undefined,
              visitorId: msg.recipientType === 'visitor' ? msg.recipientId : undefined,
              messageId: msg.messageId,
              memberName: msg.recipientName,
              visitorName: msg.recipientType === 'visitor' ? msg.recipientName : undefined,
              isGroupMessage: true,
              groupSize: selectedItems.length
            }),
          });

          if (response.ok) {
            console.log(`Successfully sent SMS to ${msg.recipientType} ${msg.recipientId}`);
            
            // Update message status based on recipient type
            if (msg.recipientType === 'visitor') {
              await updateDoc(doc(db, `churches/${id}/visitorMessages`, msg.messageId), {
                status: 'sent'
              });
            } else {
              await updateDoc(doc(db, `churches/${id}/messages`, msg.messageId), {
                status: 'sent'
              });
            }
          } else {
            console.error(`Failed to send SMS to ${msg.recipientType} ${msg.recipientId}`);
            
            // Update message status based on recipient type
            if (msg.recipientType === 'visitor') {
              await updateDoc(doc(db, `churches/${id}/visitorMessages`, msg.messageId), {
                status: 'failed'
              });
            } else {
              await updateDoc(doc(db, `churches/${id}/messages`, msg.messageId), {
                status: 'failed'
              });
            }
          }
        } catch (error) {
          console.error(`Error sending SMS to ${msg.recipientType} ${msg.recipientId}:`, error);
        }
      }

      // Deduct from balance - one message per recipient
      const deductResult = await deductBalance(id, selectedItems.length);
      if (deductResult.success) {
        // Update local balance data
        setBalanceData(prevData => ({
          ...prevData,
          balance: prevData.balance - (0.05 * selectedItems.length) // Assuming $0.05 per message
        }));
      } else {
        console.error("Failed to deduct balance:", deductResult.error);
        // Still show success for the message since it was sent, but warn about balance
        safeToast.warning("Messages sent, but failed to update balance");
      }

      // Update UI with success message
      safeToast.success(`Message sent to ${selectedItems.length} recipients`);
      setGroupMessage("");
      setShowMessageModal(false);
      setSelectedItems([]);

    } catch (error) {
      console.error("Error sending group message:", error);
      safeToast.error("Failed to send message: " + error.message);
    } finally {
      setSendingMessage(false);
    }
  };

  // Navigate to messaging center
  const navigateToMessaging = (item) => {
    // Store the current URL path in sessionStorage for return navigation
    sessionStorage.setItem('adminConnectReturnPath', window.location.pathname);
    
    if (activeTab === 'visitors') {
      navigate(`/organization/${id}/visitor/${item.id}/messages`);
    } else {
      navigate(`/organization/${id}/member/${item.id}/messages`);
    }
  };

  // Function to check for unread messages and return badge UI
  const renderMessageBadge = (item) => {
    const id = item.id;
    const count = activeTab === 'visitors' 
      ? unreadMessageCounts.visitors[id] 
      : unreadMessageCounts.members[id];
    
    if (!count) return null;
    
    return (
      <span 
        className="unread-badge" 
        style={{
          background: '#ff3f3f', 
          color: 'white',
          borderRadius: '50%',
          minWidth: '18px',
          height: '18px',
          display: 'inline-flex',
          justifyContent: 'center',
          alignItems: 'center',
          fontSize: '12px',
          padding: '0 4px',
          marginLeft: '5px'
        }}
      >
        {count}
      </span>
    );
  };

  const renderTabs = () => {
    return (
      <div className="tabs-container">
        <button
          className={`tab-button ${activeTab === 'visitors' ? 'active' : ''}`}
          onClick={() => setActiveTab('visitors')}
        >
          Visitors
          {Object.keys(unreadMessageCounts.visitors).length > 0 && (
            <span className="unread-badge">{Object.keys(unreadMessageCounts.visitors).length}</span>
          )}
        </button>
        <button
          className={`tab-button ${activeTab === 'members' ? 'active' : ''}`}
          onClick={() => setActiveTab('members')}
        >
          Members
          {Object.keys(unreadMessageCounts.members).length > 0 && (
            <span className="unread-badge">{Object.keys(unreadMessageCounts.members).length}</span>
          )}
        </button>
      </div>
    );
  };

  const handleMessageClick = (itemId) => {
    // Save the current page as a return path
    sessionStorage.setItem('adminConnectReturnPath', window.location.pathname);
    
    if (activeTab === 'visitors') {
      navigate(`/organization/${id}/visitor-messages/${itemId}`);
    } else {
      navigate(`/organization/${id}/member-messages/${itemId}`);
    }
  };

  const handlePrintToPDF = () => {
    window.print();
  };

  return (
    <div className="admin-connect-container">
      <ChurchHeader id={id} />

      <div className="content-box">
        <div className="header-with-actions">
          <h2>Admin Connect</h2>
          <button
            onClick={() => handleBackClick(id)}
            className="back-button"
          >
            Back to Organization
          </button>
        </div>

        {renderTabs()}

        <div style={{ marginBottom: '2rem' }}>
          <button
            onClick={() => navigate(`/organization/${id}/add-visitor`)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.75rem 1.5rem',
              backgroundColor: '#10B981',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '1rem',
              fontWeight: '500'
            }}
          >
            + Add New Visitor
          </button>
        </div>
      </div>
      <div className="content-box">
        {(recentVisitors.length > 0 || users.length > 0) && (
          <div className="recent-visitors" style={{ marginTop: "0px" }}>
            <div className="header-with-tabs">
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <button 
                  onClick={() => navigate(`/organization/${id}/mi-organizacion`)}
                  className="back-button" 
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.5rem 1rem',
                    backgroundColor: '#f3f4f6',
                    border: '1px solid #d1d5db',
                    borderRadius: '0.375rem',
                    fontSize: '0.875rem',
                    color: '#4b5563',
                    cursor: 'pointer'
                  }}
                >
                  <FaArrowLeft /> Back to Organization
                </button>
                <h3 style={{ margin: 0 }}>Recent Submissions</h3>
                <Link to={`/organization/${id}/bi-dashboard`} className="bi-dashboard-button">
                  <FaChartPie /> Business Intelligence
                </Link>
                {pcConnected && (
                  <div className="pc-status-badge">
                    <FaCheckCircle style={{ color: '#10B981' }} />
                    <span>Planning Center Connected</span>
                  </div>
                )}
              </div>
              <div className="tabs">
                <button
                  className={`tab ${activeTab === 'visitors' ? 'active' : ''}`}
                  onClick={() => setActiveTab('visitors')}
                >
                  Visitors ({getNonMigratedVisitorCount()})
                </button>
                <button
                  className={`tab ${activeTab === 'members' ? 'active' : ''}`}
                  onClick={() => setActiveTab('members')}
                >
                  Members ({users.length})
                </button>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                {!pcConnected && (
                  <button
                    onClick={() => setShowPcConfigModal(true)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.5rem 1rem',
                      backgroundColor: '#3B82F6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: '500'
                    }}
                    title="Configure Planning Center"
                  >
                    <FiEdit2 />
                    Configure Planning Center
                  </button>
                )}
                {pcConnected && (
                  <>
                    <button
                      onClick={() => setShowPcConfigModal(true)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '0.5rem 1rem',
                        backgroundColor: '#6B7280',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: '500'
                      }}
                      title="Edit Planning Center Configuration"
                    >
                      <FiEdit2 />
                    </button>
                    <button
                      onClick={() => setShowFieldMappingModal(true)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '0.5rem 1rem',
                        backgroundColor: '#8B5CF6',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: '500'
                      }}
                      title="Configure Field Mappings"
                    >
                      Field Mapping
                    </button>
                    <button
                      onClick={handleOpenPreview}
                      disabled={pcSyncing}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '0.5rem 1rem',
                        backgroundColor: '#6B7280',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: pcSyncing ? 'not-allowed' : 'pointer',
                        fontSize: '14px',
                        fontWeight: '500'
                      }}
                      title="Preview sync before starting"
                    >
                      Preview Sync
                    </button>
                    <button
                      onClick={handlePlanningCenterSync}
                      disabled={pcSyncing}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '0.5rem 1rem',
                        backgroundColor: pcSyncing ? '#9CA3AF' : '#10B981',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: pcSyncing ? 'not-allowed' : 'pointer',
                        fontSize: '14px',
                        fontWeight: '500'
                      }}
                      title="Start sync with Planning Center"
                    >
                      <FaSync className={pcSyncing ? 'spinning' : ''} />
                      {pcSyncing ? 'Syncing...' : 'Sync Planning Center'}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Planning Center Sync Summary */}
            {pcConnected && (
              <div style={{ marginBottom: '1rem' }}>
                <div className="pc-sync-summary">
                  <div className="pc-sync-stat">
                    <div className="pc-sync-stat-label">Synced Visitors</div>
                    <div className="pc-sync-stat-value">
                      {recentVisitors.filter(v => v.isSynced).length} / {recentVisitors.length}
                    </div>
                  </div>
                  <div className="pc-sync-stat">
                    <div className="pc-sync-stat-label">Synced Members</div>
                    <div className="pc-sync-stat-value">
                      {users.filter(u => u.isSynced).length} / {users.length}
                    </div>
                  </div>
                  <div className="pc-sync-stat">
                    <div className="pc-sync-stat-label">Total Synced</div>
                    <div className="pc-sync-stat-value" style={{ color: '#ECFDF5', fontWeight: '700' }}>
                      {recentVisitors.filter(v => v.isSynced).length + users.filter(u => u.isSynced).length} / {recentVisitors.length + users.length}
                    </div>
                  </div>
                </div>
                <div className="pc-sync-legend">
                  <FaCheckCircle style={{ color: '#10B981', fontSize: '14px' }} />
                  <span>Green checkmark indicates the person has been synced with Planning Center</span>
                </div>
                {pcLastSyncResults && (
                  <div className="pc-last-sync">
                    <div><strong>Last Sync:</strong> {pcLastSync ? new Date(pcLastSync).toLocaleString() : 'N/A'}</div>
                    <div><strong>New Visitors:</strong> {pcLastSyncResults.createdVisitors || 0}</div>
                    <div><strong>Updated Visitors:</strong> {pcLastSyncResults.updatedVisitors || 0}</div>
                    <div><strong>Updated Members:</strong> {pcLastSyncResults.updatedMembers || 0}</div>
                    <div><strong>Errors:</strong> {pcLastSyncResults.errors || 0}</div>
                  </div>
                )}
              </div>
            )}

            {pcConnected && (
              <div className="pc-sync-history">
                <div className="pc-sync-history-header">
                  <h4 style={{ margin: 0 }}>Sync History</h4>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={loadSyncIssues}
                      className="pc-button"
                      style={{ backgroundColor: '#F59E0B', color: 'white' }}
                      title="View fields that failed to migrate"
                    >
                      ⚠️ Sync Issues
                    </button>
                    <button
                      onClick={() => {
                        setShowSyncHistory(!showSyncHistory);
                        if (!showSyncHistory && pcLogs.length === 0) {
                          loadPcLogs('reset');
                        }
                      }}
                      className="pc-button pc-button-test"
                    >
                      {showSyncHistory ? '🔼 Hide History' : '🔽 View History'}
                    </button>
                  </div>
                </div>
                {showSyncHistory && (
                  <>
                <div style={{ marginTop: '12px' }}>
                  <button
                    onClick={() => loadPcLogs(pcLogs.length ? 'next' : 'reset')}
                    disabled={!pcLogsHasMore || pcLogsLoading}
                    className="pc-button pc-button-test"
                    style={{ width: '100%' }}
                  >
                    {pcLogsLoading ? 'Loading...' : (pcLogsHasMore ? 'Load More (Page ' + (Math.floor(pcLogs.length / pcLogsPageSize) + 1) + ')' : 'No More Logs')}
                  </button>
                </div>
                <div className="pc-sync-history-list">
                  {pcLogs.length === 0 && <div className="pc-sync-empty">No syncs yet.</div>}
                  {pcLogs.map(log => (
                    <div key={log.id} className="pc-sync-history-item">
                      <div style={{ flex: 1 }}>
                        <div className="pc-sync-history-title">
                          {log.status === 'completed' ? '✅ Completed' : '🔄 Running'} · {log.startAt?.toDate ? log.startAt.toDate().toLocaleString() : (log.startAt || 'Unknown')}
                        </div>
                        <div className="pc-sync-history-sub" style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '8px' }}>
                          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                            <span style={{ color: '#10B981', fontWeight: '600' }}>
                              ➕ New Visitors: {log.results?.createdVisitors || 0}
                            </span>
                            <span style={{ color: '#3B82F6', fontWeight: '600' }}>
                              🔄 Updated Visitors: {log.results?.updatedVisitors || 0}
                            </span>
                            <span style={{ color: '#8B5CF6', fontWeight: '600' }}>
                              👥 Updated Members: {log.results?.updatedMembers || 0}
                            </span>
                            {(log.results?.errors || 0) > 0 && (
                              <span style={{ color: '#EF4444', fontWeight: '600' }}>
                                ⚠️ Errors: {log.results?.errors}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '4px' }}>
                            Total processed: {(log.results?.createdVisitors || 0) + (log.results?.updatedVisitors || 0) + (log.results?.updatedMembers || 0)} people
                          </div>
                        </div>
                      </div>
                      <div>
                        <button
                          className="pc-button pc-button-cancel"
                          onClick={() => openLogEntries(log)}
                          style={{ whiteSpace: 'nowrap' }}
                        >
                          View Details
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                  </>
                )}
              </div>
            )}

            

            <div className="visitor-log" style={{ overflowX: "auto" }}>
              {/* Group Messaging Action Bar */}
              <div className="action-bar" style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "15px",
                padding: "10px",
                backgroundColor: "#f9fafb",
                borderRadius: "5px",
                border: "1px solid #e5e7eb"
              }}>
                <div style={{ display: "flex", alignItems: "center" }}>
                  <div style={{ marginRight: "15px" }}>
                    <input
                      type="text"
                      placeholder="Search by name, phone, or email..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      style={{
                        padding: "6px 12px",
                        border: "1px solid #d1d5db",
                        borderRadius: "4px",
                        fontSize: "0.875rem",
                        width: "250px"
                      }}
                    />
                  </div>
                  <label style={{ display: "flex", alignItems: "center", cursor: "pointer", marginRight: "10px" }}>
                    <input 
                      type="checkbox" 
                      checked={selectedItems.length > 0 && selectedItems.length === getFilteredData().length}
                      onChange={handleSelectAll}
                      style={{ marginRight: "5px" }}
                    />
                    Select All ({getFilteredData().length})
                  </label>
                  {selectedItems.length > 0 && (
                    <span style={{ marginLeft: "15px", fontSize: "0.875rem", color: "#4b5563" }}>
                      {selectedItems.length} item{selectedItems.length !== 1 ? 's' : ''} selected
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: "10px" }}>
                  <button
                    onClick={() => navigate(`/organization/${id}/bi-dashboard`)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "5px",
                      backgroundColor: "#4F46E5", // More vibrant indigo color
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      padding: "8px 14px",
                      cursor: "pointer",
                      fontSize: "0.875rem",
                      fontWeight: "600"
                    }}
                  >
                    <FaChartPie size={16} />
                    Business Intelligence Dashboard
                  </button>
                  <AdminConnectPDFLink 
                    data={getFilteredData()}
                    activeTab={activeTab}
                    filters={{
                      searchTerm,
                      tagFilters,
                      dateFilter,
                      customDateFilter,
                      selectedDate,
                      sortConfig,
                      dateFilterOptions
                    }}
                    filename={`${activeTab === 'visitors' ? 'visitors' : 'members'}-list-${new Date().toISOString().split('T')[0]}.pdf`}
                  />
                  {selectedItems.length > 0 && (
                    <button
                      onClick={handleOpenMessageModal}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "5px",
                        backgroundColor: "#3B82F6",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        padding: "6px 12px",
                        cursor: "pointer",
                        fontSize: "0.875rem"
                      }}
                    >
                      <FiMessageCircle />
                      Message Selected ({selectedItems.length})
                    </button>
                  )}
                </div>
              </div>

              <table>
                <thead>
                  <tr>
                    <th style={{ width: "30px" }}></th>
                    <th style={{ whiteSpace: 'nowrap' }}>
                      Name {sortConfig.field === 'fullName' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                    </th>
                    <th style={{ whiteSpace: 'nowrap' }}>Last Name</th>
                    <th style={{ whiteSpace: 'nowrap' }}>
                      Phone {sortConfig.field === 'phone' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                    </th>
                    <th style={{ whiteSpace: 'nowrap' }}>Email</th>
                    <th style={{ whiteSpace: 'nowrap' }}>Status</th>
                    <th style={{ whiteSpace: 'nowrap' }}>Tags</th>
                    <th style={{ whiteSpace: 'nowrap' }}>
                      Date Added {sortConfig.field === 'createdAt' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                    </th>
                    <th style={{ whiteSpace: 'nowrap' }}>Messages</th>
                    <th style={{ width: "120px", whiteSpace: 'nowrap' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {getFilteredData().map((item) => (
                    <tr
                      key={item.id}
                      style={{
                        borderBottom: "1px solid #e5e7eb",
                        fontSize: "0.875rem",
                        backgroundColor: selectedItems.some(selected => selected.id === item.id) 
                          ? "#EFF6FF" // Light blue for selected rows
                          : item.hasUserAccount ? "#f3f4f6" : "inherit"
                      }}
                    >
                      <td style={{ padding: "0.75rem", textAlign: "center" }}>
                        <input 
                          type="checkbox" 
                          checked={selectedItems.some(selected => selected.id === item.id)}
                          onChange={() => handleToggleSelect(item)}
                          style={{ cursor: "pointer" }}
                        />
                      </td>
                      <td style={{ padding: "0.75rem", whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {item.name}
                          {pcConnected && syncStatus[item.id]?.isSynced && (
                            <FaCheckCircle 
                              style={{ color: '#10B981', fontSize: '14px' }}
                              title={`Synced with Planning Center on ${new Date(syncStatus[item.id].syncedAt).toLocaleDateString()}`}
                            />
                          )}
                        </div>
                      </td>
                      <td style={{ padding: "0.75rem", whiteSpace: 'nowrap' }}>
                        {item.lastName}
                      </td>
                      <td style={{ padding: "0.75rem", whiteSpace: 'nowrap' }}>
                        {formatPhoneDisplay(item.phone)}
                      </td>
                      <td style={{ padding: "0.75rem", whiteSpace: 'nowrap' }}>
                        {item.email || '-'}
                      </td>
                      <td style={{ padding: "0.75rem", whiteSpace: 'nowrap' }}>
                        {item.isMember && (
                          item.isMigrated ? (
                            <span className="status-badge" style={{
                              padding: '2px 6px',
                              backgroundColor: '#10B981', // green
                              color: 'white',
                              borderRadius: '4px',
                              fontSize: '0.75rem'
                            }}>
                              Migrated Member
                            </span>
                          ) : (
                            <span className="status-badge" style={{
                              padding: '2px 6px',
                              backgroundColor: '#3B82F6', // blue
                              color: 'white',
                              borderRadius: '4px',
                              fontSize: '0.75rem'
                            }}>
                              Direct Member
                            </span>
                          )
                        )}
                        {!item.isMember && (
                          <span className="status-badge" style={{
                            padding: '2px 6px',
                            backgroundColor: '#6366F1', // purple
                            color: 'white',
                            borderRadius: '4px',
                            fontSize: '0.75rem'
                          }}>
                            Visitor
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "0.75rem", whiteSpace: 'nowrap' }} className="quick-tag-cell">
                        <div className="tags-container">
                          {item.tags?.map((tag, index) => (
                            <span key={`current-${index}`} className="tag">
                              {tag}
                              <button 
                                onClick={() => handleQuickTagRemove(item.id, tag)}
                                className="remove-tag"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                          {item.visitorTags?.map((tag, index) => (
                            <span key={`visitor-${index}`} className="tag visitor">
                              {tag}
                              <span className="visitor-badge" title="From visitor record">◆</span>
                            </span>
                          ))}
                          {item.isMigrated && item.originalTags?.map((tag, index) => (
                            <span key={`original-${index}`} className="tag migrated">
                              {tag}
                              <span className="migrated-badge" title="Migrated from visitor">•</span>
                            </span>
                          ))}
                          {showTagInput[item.id] ? (
                            <form 
                              onSubmit={(e) => {
                                handleNewTagSubmit(item.id, e);
                                setShowTagInput(prev => ({ ...prev, [item.id]: false }));
                              }}
                              className="inline-tag-form"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                            >
                              <input
                                type="text"
                                value={tagInputs[item.id] || ''}
                                onChange={(e) => setTagInputs(prev => ({ 
                                  ...prev, 
                                  [item.id]: e.target.value 
                                }))}
                                placeholder="Add tag..."
                                className="inline-tag-input"
                                autoFocus
                              />
                              <button 
                                type="button" 
                                onClick={() => setShowTagInput(prev => ({ ...prev, [item.id]: false }))}
                                style={{ 
                                  border: 'none', 
                                  background: 'none', 
                                  padding: '2px', 
                                  cursor: 'pointer',
                                  color: '#666'
                                }}
                              >
                                ×
                              </button>
                            </form>
                          ) : (
                            <button
                              onClick={() => setShowTagInput(prev => ({ ...prev, [item.id]: true }))}
                              style={{
                                border: '1px dashed #ccc',
                                background: 'none',
                                borderRadius: '4px',
                                padding: '2px 8px',
                                cursor: 'pointer',
                                color: '#666',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                            >
                              <IoIosAdd size={16} /> Add Tag
                            </button>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: "0.75rem", whiteSpace: 'nowrap' }}>
                        {item.createdAt}
                      </td>
                      <td style={{ padding: "0.75rem", textAlign: "center" }}>
                        {renderMessageBadge(item)}
                      </td>
                      <td style={{ padding: "0.75rem", whiteSpace: 'nowrap' }}>
                        <div style={{ display: "flex", gap: "0.5rem" }}>
                          {item.isMember || item.hasUserAccount ? (
                            <>
                              <button
                                onClick={() => handleViewMember(item)}
                                className="btn btn-info btn-sm"
                                title="View member profile"
                              >
                                <FaRegEye /> View
                              </button>
                              {item.isMember && (
                                <button
                                  onClick={() => handleDeleteMember(item.id)}
                                  className="btn btn-danger btn-sm"
                                  title="Delete member"
                                >
                                  <FiTrash2 />
                                </button>
                              )}
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => handleEdit(item)}
                                className="btn btn-warning btn-sm"
                              >
                                <FiEdit2 />
                              </button>
                              <button
                                onClick={() => navigate(`/organization/${id}/admin-connect/${item.id}`)}
                                className="btn btn-info btn-sm"
                              >
                                <FaRegEye />
                              </button>
                              <button
                                onClick={() => navigate(`/organization/${id}/message-log/visitor/${item.id}`)}
                                className="btn btn-primary btn-sm"
                                title="View message log"
                                style={{ background: '#0ea5e9' }}
                              >
                                <FiMessageCircle /> Log
                              </button>
                              <button
                                onClick={() => handleDelete(item.id)}
                                className="btn btn-danger btn-sm"
                                title="Delete visitor"
                              >
                                <FiTrash2 />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Message Modal */}
      {showMessageModal && (
        <div className="message-modal-overlay">
          <div className="message-modal">
            <div className="modal-header">
              <h3>Send Group Message</h3>
              <button 
                onClick={() => setShowMessageModal(false)} 
                className="close-modal-btn"
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="recipient-details" style={{
                marginBottom: "15px",
                padding: "10px",
                backgroundColor: "#f9fafb",
                borderRadius: "4px",
                border: "1px solid #e5e7eb",
                maxHeight: "150px",
                overflowY: "auto"
              }}>
                <h4 style={{ margin: "0 0 8px 0", fontSize: "0.95rem" }}>Recipients ({selectedItems.length})</h4>
                <ul style={{ margin: 0, padding: 0, listStyleType: "none" }}>
                  {selectedItems.map((item, index) => (
                    <li key={item.id} style={{ 
                      padding: "4px 0",
                      borderBottom: index < selectedItems.length - 1 ? "1px solid #eee" : "none",
                      display: "flex",
                      justifyContent: "space-between"
                    }}>
                      <span>{item.name} {item.lastName}</span>

                {/* Planning Center quick toggles */}
                {activeTab === 'visitors' && (
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => setShowPcOnly(v => !v)}
                      className="pc-button"
                      style={{
                        flex: '0 0 auto',
                        backgroundColor: showPcOnly ? '#3B82F6' : '#E5E7EB',
                        color: showPcOnly ? '#FFFFFF' : '#374151'
                      }}
                      title="Show only Planning Center visitors"
                    >
                      {showPcOnly ? 'Showing Planning Center' : 'Show Planning Center Only'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowLastSyncOnly(v => !v)}
                      className="pc-button"
                      style={{
                        flex: '0 0 auto',
                        backgroundColor: showLastSyncOnly ? '#10B981' : '#E5E7EB',
                        color: showLastSyncOnly ? '#FFFFFF' : '#374151'
                      }}
                      title="Show only records changed in last sync"
                    >
                      {showLastSyncOnly ? 'Showing Last Sync Changes' : 'Show Last Sync Changes'}
                    </button>
                  </div>
                )}
                      <span style={{ color: "#6B7280" }}>{formatPhoneDisplay(item.phone)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              
              <textarea
                ref={messageInputRef}
                value={groupMessage}
                onChange={(e) => setGroupMessage(e.target.value)}
                placeholder="Type your message here..."
                rows={5}
                style={{
                  width: "100%",
                  padding: "10px",
                  borderRadius: "4px",
                  border: "1px solid #ccc",
                  fontSize: "1rem"
                }}
              />
              
              <div className="cost-summary" style={{
                marginTop: "15px",
                padding: "10px",
                backgroundColor: "#f0f9ff",
                borderRadius: "4px",
                border: "1px solid #bfdbfe"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Message cost:</span>
                  <span>${(0.05 * selectedItems.length).toFixed(2)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold" }}>
                  <span>Current balance:</span>
                  <span>${balanceData?.balance.toFixed(2) || '0.00'}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "5px" }}>
                  <span>Message allowance:</span>
                  <span>{calculateMessageAllowance(balanceData?.balance || 0)} messages</span>
                </div>
              </div>
              
              {balanceData && balanceData.balance < 5 && (
                <div style={{ 
                  marginTop: "10px", 
                  padding: "10px", 
                  backgroundColor: "#FEF2F2", 
                  borderRadius: "4px",
                  border: "1px solid #FECACA",
                  color: "#B91C1C" 
                }}>
                  <p style={{ margin: 0, fontWeight: "bold" }}>
                    Minimum $5.00 balance required to send messages
                  </p>
                  <p style={{ margin: "5px 0 0 0", fontSize: "0.875rem" }}>
                    Please recharge your account to continue.
                  </p>
                </div>
              )}
            </div>
            <div className="modal-footer" style={{ display: "flex", justifyContent: "space-between" }}>
              <button 
                onClick={() => {
                  setShowMessageModal(false);
                  setShowRechargePrompt(true);
                }}
                className="recharge-btn"
                style={{
                  backgroundColor: "#10B981",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  padding: "10px 20px",
                  cursor: "pointer",
                  fontSize: "0.95rem"
                }}
              >
                Recharge Account
              </button>
              <button 
                onClick={handleSendGroupMessage} 
                disabled={sendingMessage || !checkBalanceForGroupMessage() || balanceData?.balance < 5}
                className="send-message-btn"
                style={{
                  backgroundColor: (sendingMessage || !checkBalanceForGroupMessage() || balanceData?.balance < 5) 
                    ? "#9CA3AF" 
                    : "#3B82F6",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  padding: "10px 20px",
                  cursor: (sendingMessage || !checkBalanceForGroupMessage() || balanceData?.balance < 5) 
                    ? "not-allowed" 
                    : "pointer",
                  fontSize: "0.95rem"
                }}
              >
                {sendingMessage ? "Sending..." : "Send Message"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recharge Prompt Modal */}
      {showRechargePrompt && (
        <div className="message-modal-overlay">
          <div className="message-modal" style={{ maxWidth: "450px" }}>
            <div className="modal-header">
              <h3>Account Balance Too Low</h3>
              <button 
                onClick={() => setShowRechargePrompt(false)} 
                className="close-modal-btn"
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <div style={{ 
                padding: "15px", 
                backgroundColor: "#FEF2F2", 
                borderRadius: "4px",
                border: "1px solid #FECACA",
                marginBottom: "15px" 
              }}>
                <p style={{ margin: "0 0 10px 0", fontWeight: "bold", color: "#B91C1C" }}>
                  Your account balance is too low.
                </p>
                <p style={{ margin: 0, fontSize: "0.95rem" }}>
                  Sending messages requires a minimum balance of $5.00.
                </p>
                <p style={{ margin: "10px 0 0 0", fontSize: "0.95rem" }}>
                  Current balance: <strong>${balanceData?.balance.toFixed(2) || '0.00'}</strong>
                </p>
              </div>
              <p style={{ fontSize: "0.95rem" }}>
                Would you like to recharge your account now? You'll be redirected back to continue sending your message.
              </p>
            </div>
            <div className="modal-footer" style={{ display: "flex", justifyContent: "space-between" }}>
              <button 
                onClick={() => setShowRechargePrompt(false)}
                style={{
                  backgroundColor: "#F3F4F6",
                  color: "#374151",
                  border: "1px solid #D1D5DB",
                  borderRadius: "4px",
                  padding: "10px 20px",
                  cursor: "pointer",
                  fontSize: "0.95rem"
                }}
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  // Store current state in session storage
                  sessionStorage.setItem('messageState', JSON.stringify({
                    selectedItems: selectedItems.map(item => item.id),
                    messageText: groupMessage,
                    returnRoute: window.location.pathname
                  }));
                  navigate(`/organization/${id}/recharge`);
                }}
                style={{
                  backgroundColor: "#10B981",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  padding: "10px 20px",
                  cursor: "pointer",
                  fontSize: "0.95rem"
                }}
              >
                Recharge Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User Response Log */}
      <UserResponseLog />
      
      {/* Print Section - Only visible when printing */}
      <div className="print-section" style={{ display: 'none' }}>
        <div className="print-header">
          <h1>Church Admin - {activeTab === 'visitors' ? 'Visitors' : 'Members'} List</h1>
          <p>Generated on {new Date().toLocaleDateString()} at {new Date().toLocaleTimeString()}</p>
        </div>
        
        <div className="print-filters">
          <h3>Applied Filters</h3>
          {searchTerm && <p><strong>Search:</strong> {searchTerm}</p>}
          {tagFilters.length > 0 && <p><strong>Tags:</strong> {tagFilters.join(', ')}</p>}
          
          <p>
            <strong>Date Filter:</strong> {
              customDateFilter && selectedDate 
                ? `Custom Date: ${selectedDate}`
                : dateFilterOptions.find(option => option.value === dateFilter)?.label || 'All Dates'
            }
          </p>
          
          <p>
            <strong>Sort:</strong> {
              sortConfig.field === 'createdAt' 
                ? `Date (${sortConfig.direction === 'asc' ? 'Oldest First' : 'Newest First'})`
                : sortConfig.field === 'fullName'
                  ? `Name (${sortConfig.direction === 'asc' ? 'A-Z' : 'Z-A'})`
                  : `Phone (${sortConfig.direction === 'asc' ? 'A-Z' : 'Z-A'})`
            }
          </p>
          
          <p><strong>Total Items:</strong> {getFilteredData().length}</p>
        </div>
        
        <table className="print-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Last Name</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Status</th>
              <th>Tags</th>
              <th>Date Added</th>
            </tr>
          </thead>
          <tbody>
            {getFilteredData().map((item) => (
              <tr key={`print-${item.id}`}>
                <td>{item.name}</td>
                <td>{item.lastName}</td>
                <td>{formatPhoneDisplay(item.phone)}</td>
                <td>{item.email || '-'}</td>
                <td>
                  {item.isMember && (
                    item.isMigrated ? "Migrated Member" : "Direct Member"
                  )}
                  {!item.isMember && "Visitor"}
                </td>
                <td>{item.tags?.join(', ') || ''}</td>
                <td>{item.createdAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Planning Center Configuration Modal */}
      {showPcConfigModal && (
        <div className="pc-modal-overlay" onClick={() => setShowPcConfigModal(false)}>
          <div className="pc-modal-container" onClick={(e) => e.stopPropagation()}>
            <h2 className="pc-modal-title">Configure Planning Center</h2>
            <p className="pc-modal-subtitle">
              Enter your Planning Center API credentials to enable syncing.
            </p>
            
            <div className="pc-form-group">
              <label htmlFor="pcAppId" className="pc-label">
                Application ID
              </label>
              <input
                id="pcAppId"
                type="text"
                value={pcAppId}
                onChange={(e) => setPcAppId(e.target.value)}
                placeholder="Enter your Planning Center App ID"
                className="pc-input"
                disabled={pcTesting}
              />
            </div>

            <div className="pc-form-group">
              <label htmlFor="pcSecret" className="pc-label">
                Secret
              </label>
              <input
                id="pcSecret"
                type="password"
                value={pcSecret}
                onChange={(e) => setPcSecret(e.target.value)}
                placeholder="Enter your Planning Center Secret"
                className="pc-input"
                disabled={pcTesting}
              />
            </div>

            <div className="pc-modal-actions">
              <button
                onClick={handleTestPcConnection}
                disabled={pcTesting || !pcAppId || !pcSecret}
                className="pc-button pc-button-test"
              >
                {pcTesting ? 'Testing...' : 'Test Connection'}
              </button>
              <button
                onClick={handleSavePcConfig}
                disabled={!pcAppId || !pcSecret}
                className="pc-button pc-button-save"
              >
                Save Configuration
              </button>
              <button
                onClick={() => {
                  setShowPcConfigModal(false);
                  setShowFieldMappingModal(true);
                }}
                className="pc-button"
                style={{ backgroundColor: '#8B5CF6' }}
              >
                Field Mapping
              </button>
              <button
                onClick={() => setShowPcConfigModal(false)}
                className="pc-button pc-button-cancel"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Planning Center Sync Preview Modal */}
      {showPcPreviewModal && (
        <div className="pc-modal-overlay" onClick={() => setShowPcPreviewModal(false)}>
          <div className="pc-modal-container" onClick={(e) => e.stopPropagation()}>
            <h2 className="pc-modal-title">Planning Center Sync Preview</h2>
            <p className="pc-modal-subtitle">Review what will be imported and adjust mappings here before starting.</p>

            {pcPreviewLoading && <div>Loading preview...</div>}
            {pcPreviewCounts && !pcPreviewLoading && (
              <div className="pc-last-sync" style={{ marginTop: 0 }}>
                <div><strong>Total Contacts in Planning Center:</strong> {pcPreviewCounts.total}</div>
                <div><strong>New Visitors to Add:</strong> {pcPreviewCounts.toCreate}</div>
                <div><strong>Existing Visitors to Update:</strong> {pcPreviewCounts.toUpdate}</div>
                <div><em>Note: All contacts are imported as Visitors and tagged with "planning_center".</em></div>
              </div>
            )}

            {/* Live Field Mapping Controls for Preview */}
            <div style={{ margin: '12px 0', background: '#EFF6FF', padding: '12px', borderRadius: '8px', border: '1px solid #93C5FD' }}>
              <div style={{ fontWeight: 700, marginBottom: 8, color: '#1E3A8A' }}>Field Mapping</div>
              <div style={{ display: 'grid', gridTemplateColumns: '220px 28px 1fr', gap: '8px', alignItems: 'center' }}>
                {Object.entries({
                  'name': 'firstName',
                  'lastName': 'lastName',
                  'email': 'email',
                  'phone': 'phone',
                  'dateOfBirth': 'birthdate',
                  'gender': 'gender',
                  'maritalStatus': 'maritalStatus',
                  'address.street': 'street',
                  'address.city': 'city',
                  'address.state': 'state',
                  'address.zipCode': 'zip',
                  'address.country': 'country',
                }).map(([label, key]) => (
                  <React.Fragment key={key}>
                    <div style={{ fontWeight: 500 }}>{label}</div>
                    <div style={{ textAlign: 'center', color: '#6B7280' }}>→</div>
                    <select
                      value={fieldMappings[key] || ''}
                      onChange={(e) => {
                        const updated = { ...fieldMappings, [key]: e.target.value };
                        setFieldMappings(updated);
                        // Recompute preview values for any loaded sample rows
                        setPcPreviewPeople(prev => prev.map(row => ({ ...row, preview: applyFieldMappings(row.pcFlat, updated) })));
                      }}
                      className="pc-input"
                      style={{ margin: 0, fontSize: '14px', fontFamily: 'monospace', cursor: 'pointer' }}
                    >
                      <option value="">-- Select Field --</option>
                      <optgroup label="Common">
                        <option value="first_name">first_name</option>
                        <option value="last_name">last_name</option>
                        <option value="primary_contact_email">primary_contact_email</option>
                        <option value="primary_contact_phone">primary_contact_phone</option>
                        <option value="birthdate">birthdate</option>
                        <option value="sex">sex</option>
                        <option value="gender">gender</option>
                      </optgroup>
                      <optgroup label="Address">
                        <option value="street">street</option>
                        <option value="city">city</option>
                        <option value="state">state</option>
                        <option value="zip">zip</option>
                        <option value="postal_code">postal_code</option>
                        <option value="country">country</option>
                      </optgroup>
                      <optgroup label="Extras">
                        <option value="nickname">nickname</option>
                        <option value="middle_name">middle_name</option>
                        <option value="anniversary">anniversary</option>
                        <option value="marital_status">marital_status</option>
                        <option value="marital_status">marital_status</option>
                        <option value="avatar">avatar</option>
                        <option value="status">status</option>
                      </optgroup>
                    </select>
                  </React.Fragment>
                ))}
              </div>
            </div>

            {/* Preferred Locations (no fallbacks) */}
            <div style={{ margin: '12px 0', background: '#FFF7ED', padding: '12px', borderRadius: '8px', border: '1px solid #FDBA74' }}>
              <div style={{ fontWeight: 700, marginBottom: 8, color: '#9A3412' }}>Preferred Locations</div>
              <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 220px 1fr', gap: 8, alignItems: 'center' }}>
                <div style={{ fontWeight: 500 }}>Email</div>
                <select
                  className="pc-input"
                  value={locationPrefs.email}
                  onChange={(e) => {
                    const next = { ...locationPrefs, email: e.target.value };
                    setLocationPrefs(next);
                    setPcPreviewPeople(prev => prev.map(row => ({ ...row, preview: applyFieldMappings(row.pcFlat, fieldMappings) })));
                  }}
                >
                  <option value="home">home</option>
                  <option value="work">work</option>
                  <option value="other">other</option>
                </select>
                <div style={{ fontWeight: 500 }}>Phone</div>
                <select
                  className="pc-input"
                  value={locationPrefs.phone}
                  onChange={(e) => {
                    const next = { ...locationPrefs, phone: e.target.value };
                    setLocationPrefs(next);
                    setPcPreviewPeople(prev => prev.map(row => ({ ...row, preview: applyFieldMappings(row.pcFlat, fieldMappings) })));
                  }}
                >
                  <option value="mobile">mobile</option>
                  <option value="home">home</option>
                  <option value="work">work</option>
                  <option value="other">other</option>
                </select>
                <div style={{ fontWeight: 500 }}>Address</div>
                <select
                  className="pc-input"
                  value={locationPrefs.address}
                  onChange={(e) => {
                    const next = { ...locationPrefs, address: e.target.value };
                    setLocationPrefs(next);
                    setPcPreviewPeople(prev => prev.map(row => ({ ...row, preview: applyFieldMappings(row.pcFlat, fieldMappings) })));
                  }}
                >
                  <option value="home">home</option>
                  <option value="work">work</option>
                  <option value="other">other</option>
                </select>
              </div>
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <button
                  className="pc-button pc-button-test"
                  onClick={() => {
                    const defaults = { email: 'home', phone: 'mobile', address: 'home' };
                    setLocationPrefs(defaults);
                    setPcPreviewPeople(prev => prev.map(row => ({ ...row, preview: applyFieldMappings(row.pcFlat, fieldMappings) })));
                  }}
                >Use Defaults</button>
                <button
                  className="pc-button pc-button-save"
                  onClick={async () => {
                    try {
                      await planningCenterService.saveMappings(id, fieldMappings, locationPrefs);
                      safeToast.success('Preferences saved');
                    } catch (e) {
                      console.error('Save preferences failed', e);
                      safeToast.error('Failed to save preferences');
                    }
                  }}
                >Save Preferences</button>
              </div>
            </div>

            {/* Sample People Preview */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontWeight: 600 }}>Sample People</div>
              <button
                className="pc-button pc-button-test"
                onClick={async () => {
                  try {
                    setPcPreviewPeople([]);
                    setPcPreviewPeopleLoading(true);
                    const credentials = await planningCenterService.getCredentials(id);
                    await loadPcPreviewPeople(credentials.appId, credentials.secret);
                  } finally {
                    setPcPreviewPeopleLoading(false);
                  }
                }}
              >
                {pcPreviewPeopleLoading ? 'Loading…' : 'Reload Sample'}
              </button>
            </div>

            {pcPreviewPeopleLoading && <div>Loading sample people…</div>}
            {!pcPreviewPeopleLoading && pcPreviewPeople.length === 0 && (
              <div style={{ color: '#6B7280', marginBottom: 12 }}>No sample loaded yet.</div>
            )}
            {pcPreviewPeople.length > 0 && (
              <div style={{ maxHeight: '45vh', overflowY: 'auto', border: '1px solid #E5E7EB', borderRadius: 8, padding: 8, marginBottom: 12 }}>
                {pcPreviewPeople.map((row) => (
                  <div key={row.id} style={{ padding: 12, marginBottom: 8, background: '#FFFFFF', borderRadius: 8, border: '1px solid #E5E7EB' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontWeight: 700 }}>{row.name}</div>
                      {row.existing && (
                        <div style={{ fontSize: 12, color: '#059669' }}>
                          Matches existing {row.existing.type === 'visitor' ? 'Visitor' : 'Member'}: {row.existing.record.email || ''}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
                      <div style={{ background: '#F9FAFB', borderRadius: 6, padding: 10 }}>
                        <div style={{ fontWeight: 600, marginBottom: 6 }}>Planning Center</div>
                        <div style={{ fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6 }}>
                          <div>first_name: {row.pcFlat.first_name || '-'}</div>
                          <div>last_name: {row.pcFlat.last_name || '-'}</div>
                          <div>primaryEmail: {row.pcFlat.primaryEmail || '-'}</div>
                          <div>primaryPhone: {row.pcFlat.primaryPhone || '-'}</div>
                          <div>birthdate: {row.pcFlat.birthdate || '-'}</div>
                          <div>gender/sex: {row.pcFlat.gender || '-'}</div>
                          <div>marital_status: {row.pcFlat.marital_status || '-'}</div>
                          <div>street: {row.pcFlat.street || '-'}</div>
                          <div>city: {row.pcFlat.city || '-'}</div>
                          <div>state: {row.pcFlat.state || '-'}</div>
                          <div>zipCode: {row.pcFlat.zipCode || '-'}</div>
                          <div>country: {row.pcFlat.country || '-'}</div>
                        </div>
                      </div>
                      <div style={{ background: '#ECFDF5', borderRadius: 6, padding: 10 }}>
                        <div style={{ fontWeight: 600, marginBottom: 6 }}>Will import as</div>
                        <div style={{ fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6 }}>
                          <div>name: {row.preview.name || '-'}</div>
                          <div>lastName: {row.preview.lastName || '-'}</div>
                          <div>email: {row.preview.email || '-'}</div>
                          <div>phone: {row.preview.phone || '-'}</div>
                          <div>dateOfBirth: {row.preview.dateOfBirth || '-'}</div>
                          <div>gender: {row.preview.gender || '-'}</div>
                          <div>maritalStatus: {row.preview.maritalStatus || '-'}</div>
                          <div>address.street: {row.preview.address.street || '-'}</div>
                          <div>address.city: {row.preview.address.city || '-'}</div>
                          <div>address.state: {row.preview.address.state || '-'}</div>
                          <div>address.zipCode: {row.preview.address.zipCode || '-'}</div>
                          <div>address.country: {row.preview.address.country || '-'}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="pc-modal-actions">
              <button
                onClick={() => { setShowPcPreviewModal(false); handlePlanningCenterSync(); }}
                disabled={pcPreviewLoading}
                className="pc-button pc-button-save"
              >
                Start Sync
              </button>
              <button
                onClick={() => setShowPcPreviewModal(false)}
                className="pc-button pc-button-cancel"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Planning Center Sync Log Entries Modal */}
      {showPcLogEntriesModal && selectedLog && (
        <div className="pc-modal-overlay" onClick={() => closeLogEntriesModal()}>
          <div className="pc-modal-container" onClick={(e) => e.stopPropagation()}>
            <h2 className="pc-modal-title">Sync Entries</h2>
            <p className="pc-modal-subtitle">
              {selectedLog.startAt?.toDate ? selectedLog.startAt.toDate().toLocaleString() : 'Sync'} · Status: {selectedLog.status}
            </p>

            {/* Search Input */}
            <div className="pc-search-container" style={{ marginBottom: '16px' }}>
              <input
                type="text"
                placeholder="Search by name, email, phone, or person ID..."
                value={logEntriesSearchTerm}
                onChange={(e) => setLogEntriesSearchTerm(e.target.value)}
                className="pc-search-input"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '14px'
                }}
              />
              {logEntriesSearchTerm && (
                <span style={{ fontSize: '12px', color: '#666', marginTop: '4px', display: 'block' }}>
                  Showing {filteredLogEntries.length} of {pcLogEntries.length} entries
                </span>
              )}
            </div>

            <div className="pc-log-entries">
              {filteredLogEntries.length === 0 && !pcLogEntriesLoading && (
                <div className="pc-sync-empty">
                  {logEntriesSearchTerm ? 'No entries match your search.' : 'No entries.'}
                </div>
              )}
              {filteredLogEntries.map(entry => (
                <div key={entry.id} className="pc-log-entry-row">
                  <div className="pc-log-entry-main">
                    <div className={`pc-log-entry-badge ${entry.action}`}>{entry.action}</div>
                    <div className="pc-log-entry-text">
                      <div className="pc-log-entry-title">
                        {entry.name || entry.personId}
                        {entry.isVisitor === true && <span className="pc-log-type-badge visitor">Visitor</span>}
                        {entry.isVisitor === false && <span className="pc-log-type-badge member">Member</span>}
                      </div>
                      <div className="pc-log-entry-sub">{entry.email || ''} {entry.phone ? `· ${entry.phone}` : ''}</div>
                      
                      {/* Sync Report Details */}
                      {entry.syncReport && (
                        <div className="pc-sync-report">
                          {entry.syncReport.fieldsSynced && entry.syncReport.fieldsSynced.length > 0 && (
                            <div className="pc-sync-report-section">
                              <strong>✓ Synced:</strong> {entry.syncReport.fieldsSynced.join(', ')}
                            </div>
                          )}
                          {entry.syncReport.fieldsMissing && entry.syncReport.fieldsMissing.length > 0 && (
                            <div className="pc-sync-report-section warning">
                              <strong>⚠ Missing:</strong> {entry.syncReport.fieldsMissing.join(', ')}
                            </div>
                          )}
                          {entry.syncReport.warnings && entry.syncReport.warnings.length > 0 && (
                            <div className="pc-sync-report-section error">
                              <strong>⚠ Warnings:</strong>
                              <ul>
                                {entry.syncReport.warnings.map((w, i) => <li key={i}>{w}</li>)}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                      
                      {entry.error && (
                        <div className="pc-sync-report-section error">
                          <strong>Error:</strong> {entry.error}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="pc-log-entry-time">
                    {entry.at?.toDate ? entry.at.toDate().toLocaleString() : ''}
                  </div>
                </div>
              ))}
            </div>

            <div className="pc-modal-actions">
              <button
                onClick={() => loadLogEntries(selectedLog, 'next')}
                disabled={!pcLogEntriesHasMore || pcLogEntriesLoading}
                className="pc-button pc-button-test"
              >
                {pcLogEntriesLoading ? 'Loading...' : (pcLogEntriesHasMore ? 'Load More' : 'No More')}
              </button>
              <button
                onClick={() => closeLogEntriesModal()}
                className="pc-button pc-button-cancel"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Field Mapping Configuration Modal */}
      {showFieldMappingModal && (
        <div className="pc-modal-overlay" onClick={() => setShowFieldMappingModal(false)}>
          <div className="pc-modal-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '700px' }}>
            <h2 className="pc-modal-title">Field Mapping Configuration</h2>
            <p className="pc-modal-subtitle">
              Map Planning Center fields to your Firebase fields. Default mappings are shown below.
            </p>
            
            <div style={{ 
              maxHeight: '60vh', 
              overflowY: 'auto', 
              padding: '20px',
              backgroundColor: '#f9fafb',
              borderRadius: '8px',
              marginBottom: '20px'
            }}>
              <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 8px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#e5e7eb' }}>
                    <th style={{ padding: '12px', textAlign: 'left', borderRadius: '8px 0 0 8px', fontWeight: '600' }}>Firebase Field</th>
                    <th style={{ padding: '12px', textAlign: 'center', width: '50px' }}>→</th>
                    <th style={{ padding: '12px', textAlign: 'left', borderRadius: '0 8px 8px 0', fontWeight: '600' }}>Planning Center Field</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries({
                    'name': 'firstName',
                    'lastName': 'lastName',
                    'email': 'email',
                    'phone': 'phone',
                    'dateOfBirth': 'birthdate',
                    'gender': 'gender',
                    'maritalStatus': 'maritalStatus',
                    'avatar': 'avatar',
                    'address.street': 'street',
                    'address.city': 'city',
                    'address.state': 'state',
                    'address.zipCode': 'zip',
                    'address.country': 'country'
                  }).map(([label, key]) => (
                    <tr key={key} style={{ backgroundColor: 'white' }}>
                      <td style={{ padding: '12px', fontWeight: '500', borderRadius: '8px 0 0 8px' }}>{label}</td>
                      <td style={{ padding: '12px', textAlign: 'center', color: '#6B7280' }}>→</td>
                      <td style={{ padding: '12px', borderRadius: '0 8px 8px 0' }}>
                        <select
                          value={fieldMappings[key] || ''}
                          onChange={(e) => setFieldMappings({ ...fieldMappings, [key]: e.target.value })}
                          className="pc-input"
                          style={{ margin: 0, fontSize: '14px', fontFamily: 'monospace', cursor: 'pointer' }}
                        >
                          <option value="">-- Select Field --</option>
                          <optgroup label="Personal Info">
                            <option value="first_name">first_name</option>
                            <option value="last_name">last_name</option>
                            <option value="nickname">nickname</option>
                            <option value="middle_name">middle_name</option>
                            <option value="sex">sex (Male/Female)</option>
                            <option value="gender">gender</option>
                            <option value="birthdate">birthdate</option>
                            <option value="anniversary">anniversary</option>
                            <option value="marital_status">marital_status</option>
                            <option value="grade">grade</option>
                            <option value="child">child (boolean)</option>
                          </optgroup>
                          <optgroup label="Contact Info">
                            <option value="primary_contact_email">primary_contact_email</option>
                            <option value="primary_contact_phone">primary_contact_phone</option>
                            <option value="avatar">avatar</option>
                          </optgroup>
                          <optgroup label="Address Fields">
                            <option value="street">street</option>
                            <option value="city">city</option>
                            <option value="state">state</option>
                            <option value="zip">zip</option>
                            <option value="country">country</option>
                            <option value="location">location (full address)</option>
                          </optgroup>
                          <optgroup label="Status & Metadata">
                            <option value="status">status</option>
                            <option value="membership">membership</option>
                            <option value="created_at">created_at</option>
                            <option value="updated_at">updated_at</option>
                            <option value="medical_notes">medical_notes</option>
                            <option value="school_type">school_type</option>
                          </optgroup>
                          <optgroup label="Other">
                            <option value="accounting_administrator">accounting_administrator</option>
                            <option value="given_name">given_name</option>
                            <option value="name">name (full)</option>
                          </optgroup>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ 
                marginTop: '20px', 
                padding: '15px', 
                backgroundColor: '#FEF3C7', 
                borderRadius: '8px',
                border: '1px solid #F59E0B'
              }}>
                <p style={{ margin: 0, fontSize: '14px', color: '#92400E', lineHeight: '1.6' }}>
                  <strong>Planning Center API Field Names:</strong>
                  <br />• Personal: <code>first_name</code>, <code>last_name</code>, <code>sex</code> (not gender), <code>birthdate</code>, <code>marital_status</code>
                  <br />• Contact: <code>primary_contact_email</code>, <code>primary_contact_phone</code>, <code>avatar</code>
                  <br />• Address: <code>street</code>, <code>city</code>, <code>state</code>, <code>zip</code>, <code>country</code>
                  <br /><br />
                  <strong>Your Firebase structure:</strong> Visitor profiles use <code>name</code>, <code>lastName</code>, <code>email</code>, <code>phone</code>, <code>dateOfBirth</code>, <code>gender</code>, <code>maritalStatus</code>, and <code>address.street/city/state/zipCode/country</code>
                </p>
              </div>
            </div>

            <div className="pc-modal-actions">
              <button
                onClick={() => {
                  safeToast.success('Field mappings saved!');
                  setShowFieldMappingModal(false);
                }}
                className="pc-button pc-button-save"
              >
                Save Mappings
              </button>
              <button
                onClick={() => {
                  // Reset to defaults
                  setFieldMappings({
                    firstName: 'first_name',
                    lastName: 'last_name',
                    email: 'primary_contact_email',
                    phone: 'primary_contact_phone',
                    birthdate: 'birthdate',
                    gender: 'sex',
                    maritalStatus: 'marital_status',
                    avatar: 'avatar',
                    street: 'street',
                    city: 'city',
                    state: 'state',
                    zip: 'zip',
                    country: 'country'
                  });
                  safeToast.info('Reset to default mappings');
                }}
                className="pc-button"
                style={{ backgroundColor: '#6B7280' }}
              >
                Reset to Defaults
              </button>
              <button
                onClick={() => setShowFieldMappingModal(false)}
                className="pc-button pc-button-cancel"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sync Issues Modal */}
      {showSyncIssuesModal && (
        <div className="pc-modal-overlay" onClick={() => setShowSyncIssuesModal(false)}>
          <div className="pc-modal-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '900px' }}>
            <h2 className="pc-modal-title">⚠️ Sync Issues & Missing Fields</h2>
            <p className="pc-modal-subtitle">
              {syncIssues.length} {syncIssues.length === 1 ? 'person has' : 'people have'} fields that failed to migrate. Review and fix field mappings below.
            </p>
            
            <div style={{ 
              maxHeight: '60vh', 
              overflowY: 'auto', 
              marginBottom: '20px'
            }}>
              {syncIssues.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#6B7280' }}>
                  <div style={{ fontSize: '48px', marginBottom: '16px' }}>✅</div>
                  <h3 style={{ margin: '0 0 8px 0', color: '#059669' }}>No Issues Found!</h3>
                  <p>All fields migrated successfully from Planning Center.</p>
                </div>
              ) : (
                syncIssues.map((issue, idx) => (
                  <div 
                    key={issue.id} 
                    style={{ 
                      padding: '20px', 
                      marginBottom: '16px', 
                      background: '#FEF3C7', 
                      border: '2px solid #F59E0B', 
                      borderRadius: '12px' 
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                      <div>
                        <div style={{ fontWeight: '700', fontSize: '16px', color: '#92400E', marginBottom: '4px' }}>
                          {issue.name}
                          <span style={{ 
                            marginLeft: '8px', 
                            padding: '4px 8px', 
                            background: issue.isVisitor ? '#DBEAFE' : '#E0E7FF', 
                            color: issue.isVisitor ? '#1E40AF' : '#5B21B6', 
                            borderRadius: '12px', 
                            fontSize: '12px', 
                            fontWeight: '600' 
                          }}>
                            {issue.isVisitor ? 'Visitor' : 'Member'}
                          </span>
                        </div>
                        <div style={{ fontSize: '14px', color: '#78350F' }}>
                          {issue.email && <span>📧 {issue.email}</span>}
                          {issue.phone && <span style={{ marginLeft: '12px' }}>📱 {issue.phone}</span>}
                        </div>
                      </div>
                    </div>

                    {issue.fieldsMissing.length > 0 && (
                      <div style={{ marginTop: '12px', padding: '12px', background: 'white', borderRadius: '8px' }}>
                        <div style={{ fontWeight: '600', fontSize: '14px', color: '#DC2626', marginBottom: '8px' }}>
                          ❌ Missing Fields ({issue.fieldsMissing.length}):
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                          {issue.fieldsMissing.map(field => (
                            <span 
                              key={field} 
                              style={{ 
                                padding: '6px 12px', 
                                background: '#FEE2E2', 
                                color: '#991B1B', 
                                borderRadius: '6px', 
                                fontSize: '13px', 
                                fontFamily: 'monospace',
                                fontWeight: '600'
                              }}
                            >
                              {field}
                            </span>
                          ))}
                        </div>
                        <div style={{ marginTop: '8px', fontSize: '12px', color: '#78350F' }}>
                          💡 These fields had no data in Planning Center. Check if they use different field names or if data needs to be added.
                        </div>
                      </div>
                    )}

                    {issue.warnings.length > 0 && (
                      <div style={{ marginTop: '12px', padding: '12px', background: 'white', borderRadius: '8px' }}>
                        <div style={{ fontWeight: '600', fontSize: '14px', color: '#D97706', marginBottom: '8px' }}>
                          ⚠️ Warnings ({issue.warnings.length}):
                        </div>
                        {issue.warnings.map((warning, wIdx) => (
                          <div key={wIdx} style={{ fontSize: '13px', color: '#92400E', marginBottom: '4px' }}>
                            • {warning}
                          </div>
                        ))}
                      </div>
                    )}

                    {issue.fieldsSynced.length > 0 && (
                      <div style={{ marginTop: '12px', padding: '12px', background: 'white', borderRadius: '8px' }}>
                        <div style={{ fontWeight: '600', fontSize: '14px', color: '#059669', marginBottom: '8px' }}>
                          ✅ Successfully Synced ({issue.fieldsSynced.length}):
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {issue.fieldsSynced.map(field => (
                            <span 
                              key={field} 
                              style={{ 
                                padding: '4px 8px', 
                                background: '#D1FAE5', 
                                color: '#065F46', 
                                borderRadius: '4px', 
                                fontSize: '12px', 
                                fontFamily: 'monospace'
                              }}
                            >
                              {field}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="pc-modal-actions">
              <button
                onClick={() => {
                  setShowSyncIssuesModal(false);
                  setShowFieldMappingModal(true);
                }}
                className="pc-button"
                style={{ backgroundColor: '#8B5CF6', color: 'white' }}
              >
                Fix Field Mapping
              </button>
              <button
                onClick={() => setShowSyncIssuesModal(false)}
                className="pc-button pc-button-cancel"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminConnect;
