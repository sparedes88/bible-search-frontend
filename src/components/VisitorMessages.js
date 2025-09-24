import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, query, orderBy, getDocs, addDoc, serverTimestamp, where, doc, getDoc, updateDoc, onSnapshot, writeBatch, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { SafeToastContainer } from "../utils/toastUtils";
import safeToast from "../utils/toastUtils";
import 'react-toastify/dist/ReactToastify.css';
import ChurchHeader from './ChurchHeader';
import { 
  getBalance, 
  deductBalance, 
  calculateMessageAllowance 
} from '../services/balanceService';
import '../components/MemberMessaging.css';

// Helper function to create a fingerprint for message deduplication
const getMessageFingerprint = (msg) => {
  const content = msg.message || msg.body || '';
  const timestamp = msg.timestamp instanceof Date ? msg.timestamp.getTime() : Date.now();
  const direction = msg.direction || 'outbound';
  return `${content.trim()}-${timestamp}-${direction}`;
};

const VisitorMessages = () => {
  const { id, visitorId } = useParams();
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [visitorData, setVisitorData] = useState(null);
  const [messageText, setMessageText] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [balanceData, setBalanceData] = useState(null);
  const [showRechargePrompt, setShowRechargePrompt] = useState(false);
  const [loading, setLoading] = useState(true);
  const [processedMessageIds, setProcessedMessageIds] = useState(new Set());
  const messagesEndRef = useRef(null);
  const navigate = useNavigate();

  // Scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Store return path when component mounts
  useEffect(() => {
    // Save current path as return path if not already set
    if (!sessionStorage.getItem('adminConnectReturnPath')) {
      sessionStorage.setItem('adminConnectReturnPath', `/organization/${id}/admin-connect`);
    }
  }, [id]);

  // Fetch visitor data and messages
  useEffect(() => {
    const fetchVisitorData = async () => {
      try {
        if (!id || !visitorId) return;

        const docRef = doc(db, "visitors", id, "visitors", visitorId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          setVisitorData({ id: docSnap.id, ...docSnap.data() });
        } else {
          console.error("No visitor found with ID:", visitorId);
        }
      } catch (error) {
        console.error("Error fetching visitor data:", error);
      }
    };

    fetchVisitorData();
  }, [id, visitorId]);

  // Fetch balance data
  useEffect(() => {
    const fetchBalanceData = async () => {
      try {
        if (!id) return;
        
        const balance = await getBalance(id);
        setBalanceData(balance);
      }catch (error) {
        console.error('Error fetching balance data:', error);
        safeToast.error("Failed to load balance data");
      }
    };

    fetchBalanceData();
  }, [id]);

  // Updated to mark messages as read when loaded
  useEffect(() => {
    const fetchMessages = async () => {
      try {
        if (!id || !visitorId) return;

        const messagesRef = collection(db, `churches/${id}/visitorMessages`);
        const q = query(
          messagesRef,
          where("visitorId", "==", visitorId),
          orderBy("sentAt", "asc")
        );

        // Set up real-time listener
        const unsubscribe = onSnapshot(q, async (snapshot) => {
          console.log("Message snapshot received, docs count:", snapshot.docs.length);
          const messagesData = snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
              id: doc.id,
              ...data,
              sentAt: data.sentAt?.toDate?.() || new Date(),
              message: data.message || data.text || '',
              direction: data.direction || (data.senderId === user.uid ? 'outbound' : 'inbound')
            };
          });
          
          console.log("Processed messages:", messagesData.length);
          setMessages(messagesData);
          setLoading(false); // Set loading to false after messages are loaded
          
          // Mark unread messages as read
          const unreadMessages = snapshot.docs.filter(doc => 
            !doc.data().isRead && doc.data().senderId !== user.uid
          );
          
          if (unreadMessages.length > 0) {
            console.log(`Found ${unreadMessages.length} unread visitor messages to mark as read`);
            const batch = writeBatch(db);
            
            unreadMessages.forEach(doc => {
              batch.update(doc.ref, { isRead: true });
            });
            
            await batch.commit();
            console.log(`Marked ${unreadMessages.length} visitor messages as read`);
            
            // Set a flag to force refresh of AdminConnect when returning
            sessionStorage.setItem('forceRefreshAdminConnect', 'true');
          }
        });

        return unsubscribe;
      } catch (error) {
        console.error("Error fetching messages:", error);
        setLoading(false); // Set loading to false in case of error
      }
    };

    fetchMessages();
  }, [id, visitorId, user.uid]);

  // Auto-refresh Twilio messages every 30 seconds
  useEffect(() => {
    if (!visitorData?.phone || !id || !visitorId) return;
    
    // Perform initial check for SMS responses when component loads
    checkForSMSResponses();
    
    // Set up interval to check for new SMS responses
    const intervalId = setInterval(() => {
      checkForSMSResponses();
    }, 30000); // Check every 30 seconds
    
    return () => {
      clearInterval(intervalId); // Cleanup on unmount
    };
  }, [visitorData, id, visitorId]);

  const handleSendMessage = async () => {
    if (!messageText.trim() || !visitorData?.phone) return;
    
    setSendingMessage(true);
    try {
      // Check if we have enough balance to send a message
      if (!balanceData) {
        // Fetch balance data if it's not available
        const data = await getBalance(id);
        setBalanceData(data);
        
        if (!data || data.balance <= 0) {
          setShowRechargePrompt(true);
          throw new Error('Insufficient balance to send messages. Please recharge your account.');
        }
      } else if (balanceData.balance <= 0) {
        setShowRechargePrompt(true);
        throw new Error('Insufficient balance to send messages. Please recharge your account.');
      }

      // Format phone number for Twilio
      const phoneNumber = visitorData.phone.startsWith('+') ? 
        visitorData.phone : 
        `+1${visitorData.phone.replace(/\D/g, '')}`;

      // Generate a unique ID for this message
      const messageId = `outbound_${Date.now()}`;

      // First add message to Firestore with pending status
      const messageRef = await addDoc(collection(db, `churches/${id}/visitorMessages`), {
        message: messageText,
        sentAt: serverTimestamp(),
        senderId: user.uid,
        senderName: `${user.displayName || user.email}`,
        visitorId: visitorId,
        visitorName: `${visitorData.name} ${visitorData.lastName || ''}`,
        to: phoneNumber,
        status: 'sending',
        direction: 'outbound',
        isRead: true, // Our outgoing messages are marked as read by default
        clientMessageId: messageId // Add client ID to detect duplicates
      });

      console.log("Added outgoing message to Firestore with ID:", messageRef.id);

      // Send SMS via Cloud Function
      const response = await fetch('https://us-central1-igletechv1.cloudfunctions.net/sendSMS', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: phoneNumber,
          message: messageText,
          churchId: id,
          senderId: user.uid,
          visitorId: visitorId,
          messageId: messageRef.id,
          clientMessageId: messageId,
          visitorName: `${visitorData.name} ${visitorData.lastName || ''}`,
          memberName: `${user.displayName || user.email || 'Church Admin'}` // Add memberName field
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          error: 'Failed to send message',
          details: `Server returned ${response.status}`
        }));
        
        // Update status to failed
        await updateDoc(doc(db, `churches/${id}/visitorMessages`, messageRef.id), {
          status: 'failed'
        });
        
        throw new Error(errorData.error || errorData.details || 'Failed to send message');
      }

      // Get the response data to check for Twilio SID
      let responseData;
      try {
        responseData = await response.json();
        console.log("Message sent successfully, response:", responseData);
        
        // If we have a messageId from Twilio, store it for future reference
        if (responseData.messageId) {
          await updateDoc(doc(db, `churches/${id}/visitorMessages`, messageRef.id), {
            status: 'sent',
            twilioMessageId: responseData.messageId
          });
        } else {
          await updateDoc(doc(db, `churches/${id}/visitorMessages`, messageRef.id), {
            status: 'sent'
          });
        }
        
        // Deduct from the balance (1 message)
        const deductResult = await deductBalance(id, 1);
        if (deductResult.success) {
          // Update local balance data
          setBalanceData(prevData => ({
            ...prevData,
            balance: deductResult.remainingBalance,
            messagesSent: prevData.messagesSent + 1,
            totalSpent: prevData.totalSpent + deductResult.deductedAmount
          }));
        }
      } catch (e) {
        console.error("Error parsing response:", e);
        // Still mark as sent if we can't parse the response but the request was successful
        await updateDoc(doc(db, `churches/${id}/visitorMessages`, messageRef.id), {
          status: 'sent'
        });
        
        // Still deduct from balance even if we couldn't parse the response
        try {
          const deductResult = await deductBalance(id, 1);
          if (deductResult.success) {
            setBalanceData(prevData => ({
              ...prevData,
              balance: deductResult.remainingBalance,
              messagesSent: prevData.messagesSent + 1,
              totalSpent: prevData.totalSpent + deductResult.deductedAmount
            }));
          }
        } catch (deductError) {
          console.error("Error deducting balance:", deductError);
        }
      }

      // Clear the message input
      setMessageText('');
      safeToast.success('Message sent successfully!');
      
      // Note: We no longer need to manually add the message to the messages array
      // as it will be automatically picked up by the onSnapshot listener
      
    } catch (error) {
      console.error('Error sending message:', error);
      safeToast.error(error.message || 'Failed to send message');
    } finally {
      setSendingMessage(false);
    }
  };

  const formatPhoneNumber = (phone) => {
    if (!phone) return '';
    const cleaned = phone.replace(/\D/g, '');
    const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);
    if (match) {
      return `(${match[1]}) ${match[2]}-${match[3]}`;
    }
    return phone;
  };

  // Function to check for Twilio message responses
  const checkForSMSResponses = async () => {
    try {
      if (!visitorData?.phone || !id || !visitorId) return;
      
      // Format phone number as needed for the API
      const phoneNumber = visitorData.phone.startsWith('+') 
        ? visitorData.phone 
        : `+1${visitorData.phone.replace(/\D/g, '')}`;
      
      console.log(`Checking for SMS responses from ${phoneNumber}`);
      
      try {
        // Call the API to fetch SMS responses with fixed CORS settings and adding visitorId
        const response = await fetch(`https://us-central1-igletechv1.cloudfunctions.net/getSMSResponses?phone=${encodeURIComponent(phoneNumber)}&churchId=${id}&visitorId=${visitorId}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          mode: 'cors'  // Explicitly request CORS mode but remove credentials setting
        });
        
        if (!response.ok) {
          console.error(`Error fetching SMS responses: ${response.status} ${response.statusText}`);
          if (response.status === 0 || response.status === 403 || response.status === 429) {
            console.log('Possible CORS issue or rate limiting, falling back to Firestore');
            await checkFirestoreForResponses(phoneNumber);
            return;
          }
          
          // Try to get more details about the error
          try {
            const errorData = await response.json();
            console.error('Error details:', errorData);
          } catch (e) {
            console.error('Could not parse error response');
          }
          
          // Fall back to checking Firestore directly
          await checkFirestoreForResponses(phoneNumber);
          return;
        }
        
        const data = await response.json();
        
        if (data && data.success && data.messages && data.messages.length > 0) {
          console.log(`Received ${data.messages.length} messages from API`);
          processNewMessages(data.messages);
        } else {
          console.log('No new SMS responses found');
        }
      } catch (error) {
        console.error('Error in checkForSMSResponses:', error);
        
        // If there's a TypeError about fetch or a CORS error, it's likely a network/CORS issue
        if (error instanceof TypeError || (error.message && (error.message.includes('CORS') || error.message.includes('network')))) {
          console.log('Network or CORS error detected, falling back to Firestore');
        }
        
        // Fall back to checking Firestore directly
        await checkFirestoreForResponses(phoneNumber);
      }
    } catch (error) {
      console.error('Error checking for SMS responses:', error);
      
      // Fall back to fetching messages directly from Firestore
      try {
        await fetchFirestoreMessages();
      } catch (fallbackError) {
        console.error('Fallback error fetching messages:', fallbackError);
      }
    }
  };

  // Helper function to check Firestore directly if the Cloud Function fails
  const checkFirestoreForResponses = async (phoneNumber) => {
    console.log('Falling back to direct Firestore check for SMS responses');
    try {
      // Query the messages collection directly
      const messagesQuery = query(
        collection(db, `churches/${id}/visitorMessages`),
        where('from', '==', phoneNumber),
        where('isRead', '==', false),
        orderBy('sentAt', 'desc'),
        limit(10)
      );
      
      const messagesSnapshot = await getDocs(messagesQuery);
      
      if (!messagesSnapshot.empty) {
        const messages = [];
        messagesSnapshot.forEach(doc => {
          const data = doc.data();
          messages.push({
            id: doc.id,
            sid: data.twilioSid || null,
            body: data.message || data.body || '',
            from: data.from,
            to: data.to,
            direction: data.direction || 'inbound',
            status: data.status || 'received',
            dateSent: data.sentAt ? new Date(data.sentAt.toDate()) : new Date(),
            source: 'firestore'
          });
        });
        
        if (messages.length > 0) {
          processNewMessages(messages);
        }
      } else {
        console.log('No unread messages found in Firestore');
      }
    } catch (error) {
      console.error('Error checking Firestore for messages:', error);
    }
  };

  // Helper function to process new messages
  const processNewMessages = (messages) => {
    console.log(`Processing ${messages.length} new messages`);
    // Process incoming messages and add to Firestore
    const batch = writeBatch(db);
    const messagesRef = collection(db, `churches/${id}/visitorMessages`);
    
    // Create fingerprints for existing messages to avoid duplicates
    const existingMessages = [...messages.filter(msg => msg.direction === 'inbound')];
    const existingFingerprints = existingMessages.map(msg => getMessageFingerprint(msg));
    
    let addedCount = 0;
    
    // Process each message
    for (const twilioMsg of messages) {
      // Skip if not inbound or already processed
      if (twilioMsg.direction !== 'inbound') continue;
      
      // Create a fingerprint for this message
      const fingerprint = getMessageFingerprint(twilioMsg);
      
      // Check if this message is already in our list (avoid duplicates)
      if (existingFingerprints.includes(fingerprint)) {
        console.log('Skipping duplicate message:', twilioMsg.body);
        continue;
      }
      
      // Check if we've already processed this message ID
      if (twilioMsg.sid && processedMessageIds.has(twilioMsg.sid)) {
        console.log('Skipping already processed message:', twilioMsg.sid);
        continue;
      }
      
      // Add this message to Firestore
      const messageData = {
        message: twilioMsg.body,
        sentAt: serverTimestamp(),
        senderId: 'twilio', // Mark as coming from Twilio
        senderName: visitorData.name + ' ' + (visitorData.lastName || ''),
        visitorId: visitorId,
        visitorName: visitorData.name + ' ' + (visitorData.lastName || ''),
        direction: 'inbound',
        status: 'received',
        isRead: false, // Mark as unread so it will be highlighted
        twilioMessageId: twilioMsg.sid,
        from: twilioMsg.from
      };
      
      const newMessageRef = doc(messagesRef);
      batch.set(newMessageRef, messageData);
      
      // Track processed message ID
      setProcessedMessageIds(prev => new Set([...prev, twilioMsg.sid]));
      
      addedCount++;
    }
    
    if (addedCount > 0) {
      batch.commit().then(() => {
        console.log(`Added ${addedCount} new messages from Twilio to Firestore`);
        safeToast.info(`Received ${addedCount} new message${addedCount > 1 ? 's' : ''}`);
        scrollToBottom();
      }).catch(error => {
        console.error('Error committing batch:', error);
      });
    }
  };

  // Alternative method to fetch messages directly from Firestore
  const fetchFirestoreMessages = async () => {
    try {
      if (!id || !visitorId) return;
      
      console.log('Fetching messages directly from Firestore...');
      
      const messagesRef = collection(db, `churches/${id}/visitorMessages`);
      const q = query(
        messagesRef,
        where('visitorId', '==', visitorId),
        orderBy('sentAt', 'desc'),
        // Limit to messages in the last 7 days to avoid getting too many
        where('sentAt', '>=', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
      );
      
      const querySnapshot = await getDocs(q);
      
      const fetchedMessages = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        sentAt: doc.data().sentAt?.toDate?.() || new Date(),
        message: doc.data().message || doc.data().text || ''
      }));
      
      // Only update if we got new messages
      if (fetchedMessages.length > 0) {
        console.log(`Fetched ${fetchedMessages.length} messages from Firestore`);
        
        // Find messages that aren't already in our messages state
        const existingIds = messages.map(m => m.id);
        const newMessages = fetchedMessages.filter(m => !existingIds.includes(m.id));
        
        if (newMessages.length > 0) {
          console.log(`Found ${newMessages.length} new messages to add`);
          setMessages(prev => [...prev, ...newMessages]);
          scrollToBottom();
        }
      }
    } catch (error) {
      console.error('Error fetching messages from Firestore:', error);
    }
  };

  // Handle back button navigation
  const handleBack = () => {
    // Force refresh when returning to AdminConnect
    sessionStorage.setItem('forceRefreshAdminConnect', 'true');
    
    // Check if we have a return path in sessionStorage
    const returnPath = sessionStorage.getItem('adminConnectReturnPath');
    if (returnPath) {
      sessionStorage.removeItem('adminConnectReturnPath');
      navigate(returnPath);
    } else {
      // Default fallback
      navigate(`/organization/${id}/admin-connect`);
    }
  };

  // Sort messages by date (newest at the bottom)
  const sortedMessages = [...messages].sort((a, b) => {
    if (!a.sentAt) return -1;
    if (!b.sentAt) return 1;
    return a.sentAt - b.sentAt;
  });

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  return (
    <div className="max-w-4xl mx-auto p-4">
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
      <button
        onClick={handleBack}
        className="back-button mb-4"
      >
        ← Back
      </button>

      <ChurchHeader id={id} />

      <div className="content-box">
        <h2>Messaging with {visitorData?.name} {visitorData?.lastName}</h2>
        
        {/* Balance Status Display */}
        {balanceData && (
          <div className="balance-status">
            <div className="balance-info">
              <span className="balance-label">Balance:</span>
              <span className={`balance-value ${balanceData.balance < 5 ? 'low-balance' : ''}`}>
                ${balanceData.balance.toFixed(2)}
              </span>
            </div>
            <div className="messages-info">
              <span className="messages-label">Messages Available:</span>
              <span className="messages-value">
                {calculateMessageAllowance(balanceData.balance)}
              </span>
            </div>
            <button 
              className="recharge-btn"
              onClick={() => navigate(`/organization/${id}/balance-manager`)}
            >
              Recharge
            </button>
          </div>
        )}
        
        {/* Insufficient Balance Warning */}
        {showRechargePrompt && (
          <div className="recharge-prompt">
            <div className="recharge-warning">
              <h3>Insufficient Balance</h3>
              <p>Your account balance is too low to send messages. Please recharge your account to continue.</p>
              <div className="recharge-actions">
                <button 
                  className="recharge-now-btn"
                  onClick={() => navigate(`/organization/${id}/balance-manager`)}
                >
                  Recharge Now
                </button>
                <button 
                  className="dismiss-btn"
                  onClick={() => setShowRechargePrompt(false)}
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="visitor-contact-info">
          <div className="contact-item">
            <span className="label">Phone:</span>
            <span className="value">{formatPhoneNumber(visitorData?.phone) || 'No phone provided'}</span>
          </div>
          <div className="contact-item">
            <span className="label">Email:</span>
            <span className="value">{visitorData?.email || 'No email provided'}</span>
          </div>
          <button 
            className="refresh-button"
            onClick={() => {
              safeToast.info('Refreshing messages...');
              // First check for new Twilio messages
              checkForSMSResponses().then(() => {
                // Then fetch all messages from Firestore
                const fetchData = async () => {
                  try {
                    // Fetch messages
                    const messagesRef = collection(db, `churches/${id}/visitorMessages`);
                    const q = query(
                      messagesRef,
                      where('visitorId', '==', visitorId),
                      orderBy('sentAt', 'desc')
                    );
                    
                    const querySnapshot = await getDocs(q);
                    const fetchedMessages = querySnapshot.docs.map(doc => ({
                      id: doc.id,
                      ...doc.data(),
                      sentAt: doc.data().sentAt?.toDate?.() || new Date(),
                      message: doc.data().message || doc.data().text || ''
                    }));
                    
                    setMessages(fetchedMessages);
                    safeToast.success('Messages refreshed');
                  } catch (error) {
                    console.error('Error refreshing messages:', error);
                    safeToast.error('Failed to refresh messages');
                  }
                };
                fetchData();
              });
            }}
            style={{
              padding: '5px 10px',
              marginLeft: '10px',
              background: '#f1f1f1',
              border: '1px solid #ddd',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Refresh Messages
          </button>
          
          {/* View Message Log Button */}
          <button
            onClick={() => navigate(`/organization/${id}/message-log/visitor/${visitorId}`)}
            style={{
              padding: '5px 10px',
              marginLeft: '10px',
              background: '#e0f2fe',
              border: '1px solid #bae6fd',
              borderRadius: '4px',
              cursor: 'pointer',
              color: '#0369a1'
            }}
          >
            View Message Log
          </button>
        </div>

        <div className="messaging-container">
          <div className="message-history">
            {loading ? (
              <div className="loading-messages">Loading messages...</div>
            ) : sortedMessages.length === 0 ? (
              <div className="no-messages">No message history</div>
            ) : (
              sortedMessages.map(message => (
                <div 
                  key={message.id}
                  className={`message-bubble ${
                    message.direction === 'outbound' ? 'outbound' : 'inbound'
                  } ${message.isGroupMessage ? 'group-message' : ''}`}
                >
                  <div className="message-header">
                    <span className="sender-name">
                      {message.direction === 'outbound' ? 'You' : message.senderName}
                    </span>
                    <span className="message-time">
                      {message.sentAt?.toLocaleString()}
                    </span>
                  </div>
                  
                  {message.isGroupMessage && (
                    <div className="group-indicator">
                      <span>From group: {message.groupName}</span>
                    </div>
                  )}
                  
                  <p className="message-content">{message.message}</p>
                  
                  <div className="message-status">
                    {message.isGroupMessage && (
                      <span className="status-tag group-tag">
                        Group Message
                      </span>
                    )}
                    <span className={`status-tag ${message.status === 'sent' ? 'sent' : 'pending'}`}>
                      {message.status || 'unknown'}
                    </span>
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="message-input-container">
            <textarea
              className="message-input"
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder="Type your message here..."
              disabled={sendingMessage}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && messageText.trim()) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
            />
            <button
              className="send-message-button"
              onClick={handleSendMessage}
              disabled={sendingMessage || !messageText.trim()}
            >
              {sendingMessage ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VisitorMessages;