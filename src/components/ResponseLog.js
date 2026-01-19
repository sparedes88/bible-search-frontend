import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, getDocs, onSnapshot, where, limit as firestoreLimit } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import './ResponseLog.css';

/**
 * ResponseLog component displays a chronological log of messages/responses
 * with timestamps and sender information
 */
const ResponseLog = ({ churchId, visitorId, memberId, limitCount = 100 }) => {
  const [responses, setResponses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { user } = useAuth();

  useEffect(() => {
    if (!churchId) {
      setError('Church ID is required');
      setLoading(false);
      return;
    }

    // Function to load the message log
    const loadMessageLog = async () => {
      try {
        setLoading(true);
        
        // Reference to the messages collection
        let messagesQuery;
        
        if (visitorId) {
          // If we have a visitorId, get visitor messages
          const visitorMessagesRef = collection(db, `churches/${churchId}/visitorMessages`);
          messagesQuery = query(
            visitorMessagesRef,
            where('visitorId', '==', visitorId),
            orderBy('sentAt', 'desc'),
            firestoreLimit(limitCount)
          );
        } else if (memberId) {
          // If we have a memberId, get member messages
          const memberMessagesRef = collection(db, `churches/${churchId}/messages`);
          messagesQuery = query(
            memberMessagesRef,
            where('memberId', '==', memberId),
            orderBy('sentAt', 'desc'),
            firestoreLimit(limitCount)
          );
        } else {
          // Otherwise, get all church messages
          const churchMessagesRef = collection(db, `churches/${churchId}/messages`);
          messagesQuery = query(
            churchMessagesRef,
            orderBy('sentAt', 'desc'),
            firestoreLimit(limitCount)
          );
        }
        
        // Set up real-time listener
        const unsubscribe = onSnapshot(messagesQuery, (snapshot) => {
          const messageList = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
              id: doc.id,
              message: data.message || data.body || '',
              timestamp: data.sentAt?.toDate() || new Date(),
              sender: data.senderName || data.memberName || 'Unknown',
              senderId: data.senderId || data.memberId || 'unknown',
              recipientName: data.visitorName || data.memberName || 'Unknown Recipient',
              recipientId: data.visitorId || data.memberId || 'unknown',
              status: data.status || 'unknown',
              direction: data.direction || (data.senderId === user?.uid ? 'outbound' : 'inbound')
            };
          });
          
          // Sort by timestamp (newest first for the initial load, will be reversed for display)
          messageList.sort((a, b) => b.timestamp - a.timestamp);
          
          setResponses(messageList);
          setLoading(false);
        }, (err) => {
          console.error('Error loading messages:', err);
          setError('Failed to load message log');
          setLoading(false);
        });
        
        // Return the unsubscribe function to clean up
        return unsubscribe;
      } catch (err) {
        console.error('Error setting up message listener:', err);
        setError('Failed to connect to message log');
        setLoading(false);
      }
    };
    
    // Load the message log
    const unsubscribe = loadMessageLog();
    
    // Clean up when unmounting
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [churchId, visitorId, memberId, limitCount, user?.uid]);

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
      second: '2-digit',
    }).format(timestamp);
  };

  // Check if a message is from the current user
  const isCurrentUser = (senderId) => {
    return senderId === user?.uid;
  };

  if (loading) {
    return <div className="response-log-loading">Loading response log...</div>;
  }

  if (error) {
    return <div className="response-log-error">{error}</div>;
  }

  return (
    <div className="response-log-container">
      <h3 className="response-log-title">Message History</h3>
      
      {responses.length === 0 ? (
        <div className="response-log-empty">No messages found</div>
      ) : (
        <div className="response-log-entries">
          {/* Display messages oldest to newest for readability */}
          {[...responses].reverse().map((entry) => (
            <div 
              key={entry.id} 
              className={`response-log-entry ${isCurrentUser(entry.senderId) ? 'outgoing' : 'incoming'}`}
            >
              <div className="response-log-message">{entry.message}</div>
              <div className="response-log-meta">
                <span className="response-log-sender">
                  {isCurrentUser(entry.senderId) ? 'You' : entry.sender}
                </span>
                <span className="response-log-timestamp">
                  {formatTimestamp(entry.timestamp)}
                </span>
                <span className={`response-log-status status-${entry.status}`}>
                  {entry.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      
      <div className="response-log-footer">
        Showing {responses.length} message{responses.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
};

export default ResponseLog;