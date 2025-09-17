import React, { useState, useEffect, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import ChurchHeader from "./ChurchHeader";
import { SafeToastContainer } from "../utils/toastUtils";
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
} from "firebase/firestore";
import { FiSearch, FiEdit2, FiSave, FiX, FiFilter, FiTrash2, FiMessageCircle, FiCheck, FiDownload } from "react-icons/fi";
import { IoMdClose, IoIosAdd } from "react-icons/io";
import { FaRegEye, FaFilePdf, FaChartPie, FaArrowLeft } from "react-icons/fa6";
import commonStyles from "../pages/commonStyles";
import "./AdminConnect.css";
import "../styles/printStyles.css";
import { getBalance, deductBalance, calculateMessageAllowance } from "../services/balanceService";
import UserResponseLog from './UserResponseLog';
import AdminConnectPDFLink from './AdminConnectPDF';

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
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    lastName: "",
    phone: "",
    email: "",
    tags: [],
  });
  const [currentTag, setCurrentTag] = useState("");
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
      navigate(`/church/${id}/mi-perfil`);
    }
    // Make sure admin and global_admin users are allowed
    if (user && user.role !== 'admin' && user.role !== 'global_admin') {
      navigate(`/church/${id}/mi-perfil`);
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
    }
    
    // Apply filtering based on search and other criteria
    let filteredData = currentData.filter((item) => {
      const matchesSearch =
        item.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.lastName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.phone?.includes(searchTerm);
  
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
      navigate(`/church/${id}/admin-connect/member/${visitor.migratedToUserId}`);
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

  const handleAddTagFilter = () => {
    if (tagFilter.trim() && !tagFilters.includes(tagFilter.trim())) {
      setTagFilters((prev) => [...prev, tagFilter.trim()]);
      setTagFilter("");
    }
  };

  const handleRemoveTagFilter = (tagToRemove) => {
    setTagFilters((prev) => prev.filter((tag) => tag !== tagToRemove));
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
    navigate(`/church/${id}/mi-organizacion`);
  };

  const handleViewMember = (item) => {
    if (item.isMember) {
      navigate(`/church/${id}/member/${item.id}`);
    } else if (item.hasUserAccount) {
      navigate(`/church/${id}/member/${item.migratedToUserId}`);
    } else {
      navigate(`/church/${id}/admin-connect/${item.id}`);
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
      navigate(`/church/${id}/visitor/${item.id}/messages`);
    } else {
      navigate(`/church/${id}/member/${item.id}/messages`);
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
      navigate(`/church/${id}/visitor-messages/${itemId}`);
    } else {
      navigate(`/church/${id}/member-messages/${itemId}`);
    }
  };

  const handlePrintToPDF = () => {
    window.print();
  };

  return (
    <div className="admin-connect-container">
      <SafeToastContainer
        position="top-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop={true}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss={false}
        draggable={true}
        pauseOnHover={true}
        theme="light"
        limit={3}
      />
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
        
        <h2>Add New Visitor</h2>

        <form onSubmit={handleSubmit}>
          <div>
            <label htmlFor="name">Name *</label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="Enter name"
              pattern="[A-Za-zÀ-ÿ\s]+"
              title="Only letters and spaces allowed"
              required
            />
          </div>

          <div>
            <label htmlFor="lastName">Last Name *</label>
            <input
              type="text"
              id="lastName"
              name="lastName"
              value={formData.lastName}
              onChange={handleChange}
              placeholder="Enter last name"
              pattern="[A-Za-zÀ-ÿ\s]+"
              title="Only letters and spaces allowed"
              required
            />
          </div>

          <div>
            <label htmlFor="phone">Phone Number *</label>
            <input
              type="tel"
              id="phone"
              name="phone"
              value={formatPhoneDisplay(formData.phone)}
              onChange={handleChange}
              placeholder="(123) 456-7890"
              maxLength={14}
              required
            />
          </div>

          <div>
            <label>Tags</label>
            <div className="tags-input-container">
              <input
                type="text"
                value={currentTag}
                onChange={(e) => setCurrentTag(e.target.value)}
                placeholder="Add a tag"
                style={{ flex: 1 }}
              />
              <button type="button" onClick={handleAddTag}>
                Add Tag
              </button>
            </div>

            <div className="tags-container">
              {formData.tags.map((tag, index) => (
                <span key={index} className="tag">
                  {tag}
                  <button type="button" onClick={() => handleRemoveTag(tag)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || !formData.name || !formData.phone}
          >
            {loading ? "Adding..." : "Add Visitor"}
          </button>
        </form>
      </div>
      <div className="content-box">
        {(recentVisitors.length > 0 || users.length > 0) && (
          <div className="recent-visitors" style={{ marginTop: "0px" }}>
            <div className="header-with-tabs">
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <button 
                  onClick={() => navigate(`/church/${id}/mi-organizacion`)}
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
                <h3>Recent Submissions</h3>
                <Link to={`/church/${id}/bi-dashboard`} className="bi-dashboard-button">
                  <FaChartPie /> Business Intelligence
                </Link>
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
            </div>

            <div className="search-box">
              <div className="sf-container">
                <div className="search-container" style={{ width: "100%" }}>
                  <FiSearch size={20} color="#6B7280" className="search-icon" />
                  <input
                    type="text"
                    placeholder="Search by name or phone..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="search-input"
                  />
                  {searchTerm && (
                    <IoMdClose
                      size={20}
                      onClick={() => setSearchTerm("")}
                      className="clear-filter-btn"
                    />
                  )}
                </div>

                <div className="search-container" style={{ width: "100%" }}>
                  <FiFilter size={20} color="#6B7280" className="filter-icon" />
                  <input
                    type="text"
                    placeholder="Filter by tag..."
                    value={tagFilter}
                    onChange={(e) => setTagFilter(e.target.value)}
                    className="search-input"
                  />
                  {tagFilter && (
                    <IoIosAdd
                      size={26}
                      onClick={handleAddTagFilter}
                      className="add-filter-btn"
                      title="Add tag filter"
                    />
                  )}
                </div>

                <div className="search-container" style={{ width: "100%" }}>
                  <FiFilter size={20} color="#6B7280" className="filter-icon" />
                  <select 
                    value={dateFilter}
                    onChange={(e) => {
                      if (e.target.value === 'custom') {
                        setCustomDateFilter(true);
                        setDateFilter('all');
                      } else {
                        setCustomDateFilter(false);
                        setDateFilter(e.target.value);
                      }
                    }}
                    className="search-input"
                    style={{ paddingLeft: '2rem' }}
                  >
                    <option value="all">All Dates</option>
                    <option value="today">Today</option>
                    <option value="week">This Week</option>
                    <option value="month">This Month</option>
                    <option value="year">This Year</option>
                    <option value="custom">Custom Date</option>
                  </select>
                </div>

                {customDateFilter && (
                  <div className="search-container" style={{ width: "100%" }}>
                    <input
                      type="date"
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                      className="search-input"
                    />
                  </div>
                )}

                <div className="search-container" style={{ width: "100%" }}>
                  <FiFilter size={20} color="#6B7280" className="filter-icon" />
                  <select 
                    value={`${sortConfig.field}-${sortConfig.direction}`}
                    onChange={(e) => {
                      const [field, direction] = e.target.value.split('-');
                      setSortConfig({ field, direction });
                    }}
                    className="search-input"
                    style={{ paddingLeft: '2rem' }}
                  >
                    <option value="createdAt-desc">Date (Newest First)</option>
                    <option value="createdAt-asc">Date (Oldest First)</option>
                    <option value="fullName-asc">Name (A-Z)</option>
                    <option value="fullName-desc">Name (Z-A)</option>
                    <option value="phone-asc">Phone (A-Z)</option>
                    <option value="phone-desc">Phone (Z-A)</option>
                  </select>
                </div>
              </div>

              {tagFilters.length > 0 && (
                <div className="active-filters">
                  <p>Applied tag filters : </p>
                  {tagFilters.map((tag, index) => (
                    <span key={index} className="filter-tag">
                      {tag}
                      <button
                        onClick={() => handleRemoveTagFilter(tag)}
                        className="remove-filter-tag"
                      >
                        <IoMdClose size={16} />
                      </button>
                    </span>
                  ))}
                  {tagFilters.length > 0 && (
                    <button
                      onClick={() => setTagFilters([])}
                      className="clear-all-filters"
                    >
                      Clear all
                    </button>
                  )}
                </div>
              )}
            </div>

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
                    onClick={() => navigate(`/church/${id}/bi-dashboard`)}
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
                        {item.name}
                      </td>
                      <td style={{ padding: "0.75rem", whiteSpace: 'nowrap' }}>
                        {item.lastName}
                      </td>
                      <td style={{ padding: "0.75rem", whiteSpace: 'nowrap' }}>
                        {formatPhoneDisplay(item.phone)}
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
                                onClick={() => navigate(`/church/${id}/admin-connect/${item.id}`)}
                                className="btn btn-info btn-sm"
                              >
                                <FaRegEye />
                              </button>
                              <button
                                onClick={() => navigate(`/church/${id}/message-log/visitor/${item.id}`)}
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
                  navigate(`/church/${id}/recharge`);
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
    </div>
  );
};

export default AdminConnect;
