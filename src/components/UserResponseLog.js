import React, { useState, useEffect, useCallback } from 'react';
import { collection, query, orderBy, getDocs, onSnapshot, where, limit as firestoreLimit } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { FiFilter, FiRefreshCw, FiArrowLeft, FiArrowRight, FiCheck, FiX, FiMessageSquare, FiAlertCircle } from 'react-icons/fi';
import { useParams, useNavigate } from 'react-router-dom';
import './UserResponseLog.css';

/**
 * UserResponseLog component displays a comprehensive log of all users and their message responses
 * at the bottom of the application
 */
const UserResponseLog = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [allResponses, setAllResponses] = useState([]);
  const [filteredResponses, setFilteredResponses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [userTypeFilter, setUserTypeFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [responseFilter, setResponseFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(15);
  const [conversations, setConversations] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [highlightedPhone, setHighlightedPhone] = useState(null);
  const [expandedView, setExpandedView] = useState({});
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [connectionStatus, setConnectionStatus] = useState('connected');
  
  // Force a refresh when user clicks the refresh button
  const refreshLog = useCallback(() => {
    setRefreshing(true);
    setLastUpdate(new Date());
    loadAllMessages().then(() => {
      setRefreshing(false);
      toast.success("Messages refreshed successfully");
    }).catch(err => {
      console.error("Error refreshing messages:", err);
      setRefreshing(false);
      toast.error("Failed to refresh messages");
    });
  }, []);
  
  // Automatically refresh data every 30 seconds
  useEffect(() => {
    const intervalId = setInterval(() => {
      loadAllMessages();
      setLastUpdate(new Date());
      console.log("Auto-refreshed messages at", new Date().toLocaleTimeString());
    }, 30000); // 30 seconds
    
    return () => clearInterval(intervalId);
  }, []);
  
  // Function to load all messages
  const loadAllMessages = useCallback(async () => {
    if (!id) {
      setError('Church ID is required');
      setLoading(false);
      return [];
    }
    
    try {
      setLoading(true);
      setConnectionStatus('connected');
      
      // Get both member and visitor messages
      const memberMessagesRef = collection(db, `churches/${id}/messages`);
      const visitorMessagesRef = collection(db, `churches/${id}/visitorMessages`);
      
      // Create queries for both collections with no limit
      const memberMessagesQuery = query(
        memberMessagesRef,
        orderBy('sentAt', 'desc')
      );
      
      const visitorMessagesQuery = query(
        visitorMessagesRef,
        orderBy('sentAt', 'desc')
      );
      
      // Get snapshots for both collections
      const memberSnapshot = await getDocs(memberMessagesQuery);
      const visitorSnapshot = await getDocs(visitorMessagesQuery);
      
      console.log(`Loaded ${memberSnapshot.docs.length} member messages and ${visitorSnapshot.docs.length} visitor messages`);
      
      // Process member messages
      const memberMessages = memberSnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          message: data.message || data.body || '',
          timestamp: data.sentAt?.toDate() || new Date(),
          sender: data.senderName || 'Unknown',
          senderId: data.senderId || 'unknown',
          recipient: data.memberName || 'Unknown Member',
          recipientId: data.memberId || 'unknown',
          recipientPhone: data.phoneNumber || '',
          status: data.status || 'unknown',
          direction: data.direction || (data.senderId === user?.uid ? 'outbound' : 'inbound'),
          userType: 'member',
          phoneNumber: data.phoneNumber || '',
          hasResponse: data.direction === 'inbound' || false
        };
      });
      
      // Process visitor messages
      const visitorMessages = visitorSnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          message: data.message || data.body || '',
          timestamp: data.sentAt?.toDate() || new Date(),
          sender: data.senderName || 'Unknown',
          senderId: data.senderId || 'unknown',
          recipient: data.visitorName || 'Unknown Visitor',
          recipientId: data.visitorId || 'unknown',
          status: data.status || 'unknown',
          direction: data.direction || (data.senderId === user?.uid ? 'outbound' : 'inbound'),
          userType: 'visitor',
          phoneNumber: data.phoneNumber || '',
          hasResponse: data.direction === 'inbound' || false
        };
      });
      
      // Organize messages by phoneNumber for conversations
      const allMessages = [...memberMessages.map(msg => ({...msg, id: `member_${msg.id}`})),
                         ...visitorMessages.map(msg => ({...msg, id: `visitor_${msg.id}`}))];
                         
      // Sort all messages by timestamp - latest first                         
      allMessages.sort((a, b) => b.timestamp - a.timestamp);
      
      // Process conversations
      const convos = {};
      for (const msg of allMessages) {
        const phoneKey = msg.phoneNumber || 'unknown';
        if (!convos[phoneKey]) {
          convos[phoneKey] = {
            lastMessage: msg.timestamp,
            messages: [],
            recipient: msg.recipient,
            recipientId: msg.recipientId,
            userType: msg.userType,
            hasResponse: false,
            hasInbound: false,
            hasOutbound: false
          };
        }
        
        convos[phoneKey].messages.push(msg);
        
        // Check message direction
        if (msg.direction === 'inbound') {
          convos[phoneKey].hasInbound = true;
          convos[phoneKey].hasResponse = true;
        } else if (msg.direction === 'outbound') {
          convos[phoneKey].hasOutbound = true;
        }
        
        // Update last message timestamp if needed
        if (msg.timestamp > convos[phoneKey].lastMessage) {
          convos[phoneKey].lastMessage = msg.timestamp;
        }
      }
      
      // Sort messages within each conversation
      Object.keys(convos).forEach(phoneKey => {
        convos[phoneKey].messages.sort((a, b) => b.timestamp - a.timestamp);
      });
      
      setConversations(convos);
      setAllResponses(allMessages);
      setLoading(false);
      
      return allMessages;
    } catch (err) {
      console.error('Error loading messages:', err);
      setError('Failed to load message logs');
      setLoading(false);
      setConnectionStatus('disconnected');
      return [];
    }
  }, [id, user?.uid]);
  
  useEffect(() => {
    // Initial load of all messages
    loadAllMessages();
    
    // Set up real-time listeners for messages
    if (!id) return;
    
    const memberMessagesRef = collection(db, `churches/${id}/messages`);
    const visitorMessagesRef = collection(db, `churches/${id}/visitorMessages`);
    
    const unsubscribeMember = onSnapshot(
      query(memberMessagesRef, orderBy('sentAt', 'desc')),
      (snapshot) => {
        let hasChanges = false;
        
        snapshot.docChanges().forEach(change => {
          hasChanges = true;
          const data = change.doc.data();
          
          // Check if this is an incoming response and highlight it
          if (change.type === 'added' && data.direction === 'inbound' && data.phoneNumber) {
            console.log("New incoming member message detected:", data.message);
            setHighlightedPhone(data.phoneNumber);
            
            // Auto-expand this conversation
            setExpandedView(prev => ({ ...prev, [data.phoneNumber]: true }));
            
            // Clear the highlight after 15 seconds
            setTimeout(() => {
              setHighlightedPhone(prev => prev === data.phoneNumber ? null : prev);
            }, 15000);
          }
        });
        
        if (hasChanges) {
          console.log("Member messages changes detected, reloading all messages");
          loadAllMessages();
          setLastUpdate(new Date());
        }
      },
      (error) => {
        console.error("Error setting up member messages listener:", error);
        setConnectionStatus('disconnected');
      }
    );
    
    const unsubscribeVisitor = onSnapshot(
      query(visitorMessagesRef, orderBy('sentAt', 'desc')),
      (snapshot) => {
        let hasChanges = false;
        
        snapshot.docChanges().forEach(change => {
          hasChanges = true;
          const data = change.doc.data();
          
          // Check if this is an incoming response and highlight it
          if (change.type === 'added' && data.direction === 'inbound' && data.phoneNumber) {
            console.log("New incoming visitor message detected:", data.message);
            setHighlightedPhone(data.phoneNumber);
            
            // Auto-expand this conversation
            setExpandedView(prev => ({ ...prev, [data.phoneNumber]: true }));
            
            // Clear the highlight after 15 seconds
            setTimeout(() => {
              setHighlightedPhone(prev => prev === data.phoneNumber ? null : prev);
            }, 15000);
          }
        });
        
        if (hasChanges) {
          console.log("Visitor messages changes detected, reloading all messages");
          loadAllMessages();
          setLastUpdate(new Date());
        }
      },
      (error) => {
        console.error("Error setting up visitor messages listener:", error);
        setConnectionStatus('disconnected');
      }
    );
    
    // Return cleanup function
    return () => {
      unsubscribeMember();
      unsubscribeVisitor();
    };
  }, [id, user?.uid, loadAllMessages]);
  
  // Group conversations by phone number for display
  const getGroupedConversations = useCallback(() => {
    // Get unique phone numbers
    const uniquePhones = [];
    const addedPhones = new Set();
    
    filteredResponses.forEach(response => {
      const phone = response.phoneNumber;
      if (phone && !addedPhones.has(phone)) {
        uniquePhones.push(phone);
        addedPhones.add(phone);
      }
    });
    
    return uniquePhones.map(phone => ({
      phoneNumber: phone,
      conversation: conversations[phone] || { messages: [], hasResponse: false },
      hasResponse: conversations[phone]?.hasResponse || false,
      recipient: conversations[phone]?.recipient || 'Unknown',
      userType: conversations[phone]?.userType || 'unknown'
    }));
  }, [filteredResponses, conversations]);
  
  // Apply filters
  useEffect(() => {
    let filtered = [...allResponses];
    
    // Filter by user type
    if (userTypeFilter !== 'all') {
      filtered = filtered.filter(response => response.userType === userTypeFilter);
    }
    
    // Filter by response status
    if (responseFilter === 'with-responses') {
      const phoneNumbers = Object.keys(conversations).filter(key => 
        conversations[key].hasResponse
      );
      filtered = filtered.filter(response => 
        phoneNumbers.includes(response.phoneNumber)
      );
    } else if (responseFilter === 'without-responses') {
      const phoneNumbers = Object.keys(conversations).filter(key => 
        conversations[key].hasOutbound && !conversations[key].hasInbound
      );
      filtered = filtered.filter(response => 
        phoneNumbers.includes(response.phoneNumber)
      );
    } else if (responseFilter === 'incoming-responses') {
      filtered = filtered.filter(response => response.direction === 'inbound');
    } else if (responseFilter === 'recent-messages') {
      // Messages in the last 24 hours
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      filtered = filtered.filter(response => response.timestamp > oneDayAgo);
    }
    
    // Filter by search term
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(response => 
        response.message?.toLowerCase().includes(term) ||
        response.sender?.toLowerCase().includes(term) ||
        response.recipient?.toLowerCase().includes(term) ||
        response.phoneNumber?.toLowerCase().includes(term)
      );
    }
    
    setFilteredResponses(filtered);
    setCurrentPage(1);
  }, [allResponses, userTypeFilter, searchTerm, responseFilter, conversations]);
  
  // Format the timestamp
  const formatTimestamp = (timestamp) => {
    if (!(timestamp instanceof Date)) {
      return 'Invalid date';
    }
    
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(timestamp);
  };
  
  // Get initial for avatar
  const getInitial = (name) => {
    return name ? name.charAt(0).toUpperCase() : '?';
  };
  
  // Pagination for grouped conversations
  const groupedConversations = getGroupedConversations();
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentGroupedItems = groupedConversations.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(groupedConversations.length / itemsPerPage);
  
  const paginate = (pageNumber) => setCurrentPage(pageNumber);
  
  const renderPagination = () => {
    if (totalPages <= 1) return null;
    
    const pageNumbers = [];
    
    if (totalPages <= 5) {
      for (let i = 1; i <= totalPages; i++) {
        pageNumbers.push(i);
      }
    } else {
      pageNumbers.push(1);
      
      if (currentPage > 3) {
        pageNumbers.push('...');
      }
      
      for (let i = Math.max(2, currentPage - 1); i <= Math.min(currentPage + 1, totalPages - 1); i++) {
        pageNumbers.push(i);
      }
      
      if (currentPage < totalPages - 2) {
        pageNumbers.push('...');
      }
      
      pageNumbers.push(totalPages);
    }
    
    return (
      <div className="user-response-log-pagination">
        <button
          onClick={() => paginate(currentPage - 1)}
          disabled={currentPage === 1}
        >
          <FiArrowLeft />
        </button>
        
        {pageNumbers.map((number, i) => (
          number === '...' ? (
            <span key={`ellipsis-${i}`}>...</span>
          ) : (
            <button
              key={number}
              onClick={() => paginate(number)}
              className={currentPage === number ? 'active' : ''}
            >
              {number}
            </button>
          )
        ))}
        
        <button
          onClick={() => paginate(currentPage + 1)}
          disabled={currentPage === totalPages}
        >
          <FiArrowRight />
        </button>
      </div>
    );
  };

  // Handle viewing complete conversation
  const handleViewConversation = (userType, itemId) => {
    // Store the current URL path in sessionStorage for return navigation
    sessionStorage.setItem('userResponseLogReturnPath', window.location.pathname);
    
    if (userType === 'visitor') {
      navigate(`/church/${id}/visitor/${itemId}/messages`);
    } else {
      navigate(`/church/${id}/member/${itemId}/messages`);
    }
  };
  
  // Format last update time
  const getLastUpdateText = () => {
    const now = new Date();
    const diffMs = now - lastUpdate;
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) {
      return 'just now';
    } else if (diffMins === 1) {
      return '1 minute ago';
    } else if (diffMins < 60) {
      return `${diffMins} minutes ago`;
    } else {
      const hours = Math.floor(diffMins / 60);
      return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    }
  };
  
  // Toast component for in-component notifications
  const toast = {
    success: (message) => {
      const event = new CustomEvent('toast-message', {
        detail: { type: 'success', message }
      });
      window.dispatchEvent(event);
    },
    error: (message) => {
      const event = new CustomEvent('toast-message', {
        detail: { type: 'error', message }
      });
      window.dispatchEvent(event);
    }
  };
  
  if (loading && !allResponses.length) {
    return (
      <>
        <div className="response-log-loading">Loading message logs...</div>
      </>
    );
  }
  
  if (error) {
    return (
      <>
        <div className="response-log-error">{error}</div>
      </>
    );
  }
  
  return (
    <>
      <div className="user-response-log-container">
        <div className="user-response-log-header">
          <h3 className="user-response-log-title">Message Responses Log</h3>
          
          <div className="user-response-log-controls">
            <div className="connection-status">
              <span className={`status-indicator ${connectionStatus}`}></span>
              <span className="last-update">Updated {getLastUpdateText()}</span>
            </div>
            
            <button 
              onClick={refreshLog} 
              disabled={refreshing}
              className="refresh-button"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                backgroundColor: refreshing ? '#d1d5db' : '#4b5563',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                padding: '6px 12px',
                cursor: refreshing ? 'not-allowed' : 'pointer'
              }}
            >
              <FiRefreshCw className={refreshing ? 'spin' : ''} /> 
              {refreshing ? 'Refreshing...' : 'Refresh Log'}
            </button>
            
            <div className="user-response-log-filter">
              <FiFilter style={{ marginRight: '5px' }} />
              <select 
                value={userTypeFilter} 
                onChange={(e) => setUserTypeFilter(e.target.value)}
              >
                <option value="all">All Users</option>
                <option value="member">Members Only</option>
                <option value="visitor">Visitors Only</option>
              </select>
            </div>
            
            <div className="user-response-log-filter">
              <FiFilter style={{ marginRight: '5px' }} />
              <select 
                value={responseFilter} 
                onChange={(e) => setResponseFilter(e.target.value)}
              >
                <option value="all">All Messages</option>
                <option value="with-responses">With Responses</option>
                <option value="without-responses">Without Responses</option>
                <option value="incoming-responses">Incoming Responses Only</option>
                <option value="recent-messages">Last 24 Hours</option>
              </select>
            </div>
            
            <input
              type="text"
              placeholder="Search messages..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="user-response-log-filter"
            />
          </div>
        </div>
        
        <div className="user-response-log-conversations">
          {currentGroupedItems.length === 0 ? (
            <div className="response-log-empty">No matching messages found</div>
          ) : (
            <div className="conversation-list">
              {currentGroupedItems.map(({ phoneNumber, conversation, hasResponse, recipient, userType }) => (
                <div 
                  key={phoneNumber} 
                  className={`conversation-item ${highlightedPhone === phoneNumber ? 'highlighted' : ''}`}
                >
                  <div 
                    className="conversation-header"
                    onClick={() => setExpandedView(prev => ({ 
                      ...prev, 
                      [phoneNumber]: !prev[phoneNumber] 
                    }))}
                  >
                    <div className="conversation-user">
                      <div className="user-response-log-avatar">
                        {getInitial(recipient)}
                      </div>
                      <div>
                        <div className="conversation-recipient">{recipient}</div>
                        <div className="conversation-phone">{phoneNumber}</div>
                      </div>
                    </div>
                    
                    <div className="conversation-meta">
                      <span className={`user-type-badge ${userType}-type`}>
                        {userType === 'member' ? 'Member' : 'Visitor'}
                      </span>
                      
                      {hasResponse ? (
                        <span className="response-badge has-response">
                          <FiCheck size={16} /> Has Response
                        </span>
                      ) : (
                        <span className="response-badge no-response">
                          <FiX size={16} /> No Response
                        </span>
                      )}
                      
                      <button 
                        className="view-conversation-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleViewConversation(
                            userType, 
                            conversation.messages[0]?.recipientId
                          );
                        }}
                      >
                        <FiMessageSquare size={14} /> View Full
                      </button>
                    </div>
                  </div>
                  
                  {expandedView[phoneNumber] && (
                    <div className="conversation-messages">
                      {conversation.messages.map((message) => (
                        <div 
                          key={message.id} 
                          className={`message-item ${message.direction} ${message.direction === 'inbound' && highlightedPhone === phoneNumber ? 'new-response' : ''}`}
                        >
                          <div className="message-content">
                            <div className="message-text">{message.message}</div>
                            <div className="message-meta">
                              <span className={`direction-badge ${message.direction}`}>
                                {message.direction === 'inbound' ? 'Incoming' : 'Outgoing'}
                              </span>
                              <span className={`status-badge status-${message.status}`}>
                                {message.status}
                              </span>
                              <span className="timestamp">
                                {formatTimestamp(message.timestamp)}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        
        <div className="user-response-log-footer">
          <div>
            Showing {currentGroupedItems.length} of {groupedConversations.length} conversations
            {groupedConversations.length > 0 && (
              <span className="total-messages"> ({allResponses.length} total messages)</span>
            )}
          </div>
          {renderPagination()}
        </div>
      </div>
      
      <style jsx="true">{`
        .spin {
          animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        
        .connection-status {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 12px;
          color: #6b7280;
        }
        
        .status-indicator {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        
        .status-indicator.connected {
          background-color: #10B981;
          box-shadow: 0 0 5px #10B981;
        }
        
        .status-indicator.disconnected {
          background-color: #EF4444;
          box-shadow: 0 0 5px #EF4444;
        }
        
        .last-update {
          white-space: nowrap;
        }
        
        .total-messages {
          margin-left: 5px;
          font-size: 12px;
          color: #6b7280;
        }
        
        .user-response-log-container {
          margin-top: 30px;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
        }
        
        .user-response-log-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 15px 20px;
          background-color: #f9fafb;
          border-bottom: 1px solid #e5e7eb;
        }
        
        .user-response-log-title {
          margin: 0;
          font-size: 18px;
          font-weight: 600;
          color: #111827;
        }
        
        .user-response-log-controls {
          display: flex;
          gap: 10px;
          align-items: center;
        }
        
        .user-response-log-filter {
          display: flex;
          align-items: center;
          background-color: white;
          border: 1px solid #d1d5db;
          border-radius: 4px;
          padding: 6px 10px;
          font-size: 14px;
        }
        
        .user-response-log-filter select {
          border: none;
          background: transparent;
          outline: none;
        }
        
        .user-response-log-conversations {
          max-height: 600px;
          overflow-y: auto;
          background-color: white;
        }
        
        .conversation-list {
          display: flex;
          flex-direction: column;
        }
        
        .conversation-item {
          border-bottom: 1px solid #e5e7eb;
          transition: background-color 0.2s;
        }
        
        .conversation-item.highlighted {
          background-color: #fef3c7;
          animation: highlight-pulse 2s infinite;
        }
        
        @keyframes highlight-pulse {
          0% { background-color: #fef3c7; }
          50% { background-color: #fef9e7; }
          100% { background-color: #fef3c7; }
        }
        
        .conversation-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 15px 20px;
          cursor: pointer;
        }
        
        .conversation-header:hover {
          background-color: #f9fafb;
        }
        
        .conversation-user {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        
        .user-response-log-avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background-color: #6366f1;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: 16px;
        }
        
        .conversation-recipient {
          font-weight: 600;
          color: #111827;
        }
        
        .conversation-phone {
          font-size: 12px;
          color: #6b7280;
        }
        
        .conversation-meta {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        
        .user-type-badge {
          padding: 2px 8px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 500;
        }
        
        .member-type {
          background-color: #e0f2fe;
          color: #0369a1;
        }
        
        .visitor-type {
          background-color: #f3e8ff;
          color: #6d28d9;
        }
        
        .response-badge {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 500;
        }
        
        .has-response {
          background-color: #d1fae5;
          color: #065f46;
        }
        
        .no-response {
          background-color: #fee2e2;
          color: #b91c1c;
        }
        
        .view-conversation-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 4px 8px;
          border: none;
          border-radius: 4px;
          background-color: #4b5563;
          color: white;
          font-size: 12px;
          cursor: pointer;
        }
        
        .view-conversation-btn:hover {
          background-color: #374151;
        }
        
        .conversation-messages {
          display: flex;
          flex-direction: column;
          padding: 0 20px 15px 20px;
          background-color: #f9fafb;
          gap: 10px;
        }
        
        .message-item {
          display: flex;
          margin-bottom: 10px;
        }
        
        .message-item.inbound {
          justify-content: flex-start;
        }
        
        .message-item.outbound {
          justify-content: flex-end;
          text-align: right;
        }
        
        .message-content {
          max-width: 80%;
          padding: 10px 15px;
          border-radius: 8px;
          position: relative;
        }
        
        .message-item.inbound .message-content {
          background-color: #e0f2fe;
          border-bottom-left-radius: 0;
        }
        
        .message-item.outbound .message-content {
          background-color: #f3f4f6;
          border-bottom-right-radius: 0;
        }
        
        .message-item.new-response .message-content {
          background-color: #fef3c7;
          animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.8; }
          100% { opacity: 1; }
        }
        
        .message-text {
          margin-bottom: 5px;
          word-break: break-word;
        }
        
        .message-meta {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11px;
          color: #6b7280;
        }
        
        .direction-badge {
          padding: 2px 6px;
          border-radius: 10px;
          font-size: 10px;
          font-weight: 500;
        }
        
        .direction-badge.inbound {
          background-color: #d1fae5;
          color: #065f46;
        }
        
        .direction-badge.outbound {
          background-color: #e0f2fe;
          color: #0369a1;
        }
        
        .status-badge {
          padding: 2px 6px;
          border-radius: 10px;
          font-size: 10px;
        }
        
        .status-sent {
          background-color: #dbeafe;
          color: #1e40af;
        }
        
        .status-delivered {
          background-color: #dbeafe;
          color: #1e40af;
        }
        
        .status-failed {
          background-color: #fee2e2;
          color: #b91c1c;
        }
        
        .status-sending {
          background-color: #f3f4f6;
          color: #4b5563;
        }
        
        .timestamp {
          font-size: 10px;
          color: #6b7280;
        }
        
        .user-response-log-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 15px 20px;
          background-color: #f9fafb;
          border-top: 1px solid #e5e7eb;
          color: #6b7280;
          font-size: 14px;
        }
        
        .user-response-log-pagination {
          display: flex;
          gap: 5px;
          align-items: center;
        }
        
        .user-response-log-pagination button {
          width: 30px;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid #d1d5db;
          border-radius: 4px;
          background-color: white;
          color: #4b5563;
          cursor: pointer;
        }
        
        .user-response-log-pagination button.active {
          background-color: #6366f1;
          color: white;
          border-color: #6366f1;
        }
        
        .user-response-log-pagination button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        .response-log-empty {
          padding: 40px;
          text-align: center;
          color: #6b7280;
        }
        
        .response-log-loading,
        .response-log-error {
          padding: 20px;
          text-align: center;
          color: #6b7280;
        }
        
        .response-log-error {
          color: #b91c1c;
        }
      `}</style>
    </>
  );
};

export default UserResponseLog;