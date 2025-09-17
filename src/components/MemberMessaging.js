import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  doc, 
  getDoc, 
  collection, 
  query, 
  where, 
  getDocs, 
  orderBy, 
  addDoc, 
  serverTimestamp,
  onSnapshot,
  updateDoc,
  limit
} from 'firebase/firestore';
import { db } from '../firebase';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useAuth } from '../contexts/AuthContext';
import ChurchHeader from './ChurchHeader';
import './MemberProfile.css';
import './MemberMessaging.css';
import { 
  getBalance, 
  deductBalance, 
  calculateMessageAllowance 
} from '../services/balanceService';

const formatPhoneNumber = (phoneNumber) => {
  if (!phoneNumber) return '';
  const cleaned = phoneNumber.replace(/\D/g, '');
  const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);
  if (match) {
    return `(${match[1]}) ${match[2]}-${match[3]}`;
  }
  return phoneNumber;
};

const cleanPhoneNumber = (phoneNumber) => phoneNumber.replace(/\D/g, '');

// At the top of the file, add a utility function for more reliable message deduplication
// Using a combination of content and timestamp for better duplication detection
const getMessageFingerprint = (message) => {
  const content = message.message || message.Body || message.body || '';
  const direction = message.direction || 'outbound';
  const timestamp = message.timestamp ? 
    (typeof message.timestamp === 'object' ? message.timestamp.getTime() : message.timestamp) : 
    Date.now();
  
  // Create a fingerprint that combines direction, content and approximate time (rounded to minute)
  // This helps catch duplicates even if they have different IDs
  return `${direction}_${content}_${Math.floor(timestamp / 60000)}`;
};

// Helper function for toast notifications to prevent undefined errors
const showToast = (message, type = 'info') => {
  if (toast && typeof toast[type] === 'function') {
    return toast[type](message, {
      position: "top-right",
      autoClose: 3000,
      hideProgressBar: false,
      closeOnClick: true,
      pauseOnHover: true,
      draggable: true,
      progress: undefined,
    });
  } else {
    console.log(`Toast (${type}): ${message}`);
  }
};

const MemberMessaging = () => {
  const { id, profileId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [memberData, setMemberData] = useState(null);
  const [church, setChurch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [messageText, setMessageText] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [messageHistory, setMessageHistory] = useState([]);
  const [processedMessageIds, setProcessedMessageIds] = useState(new Set());
  const [balanceData, setBalanceData] = useState(null);
  const [showRechargePrompt, setShowRechargePrompt] = useState(false);
  const messagesEndRef = useRef(null);

  // Fetch balance data
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

  useEffect(() => {
    const fetchChurchData = async () => {
      try {
        const churchDoc = await getDoc(doc(db, 'churches', id));
        if (churchDoc.exists()) {
          setChurch(churchDoc.data());
        }
      } catch (error) {
        console.error('Error fetching church:', error);
      }
    };

    fetchChurchData();
  }, [id]);

  // Mark messages as read when component mounts
  useEffect(() => {
    const markMessagesAsRead = async () => {
      if (!id || !profileId) return;
      
      try {
        // Update the unreadMessages field in the adminConnect collection
        const unreadDocRef = doc(db, `churches/${id}/adminConnect/members`);
        const unreadDoc = await getDoc(unreadDocRef);
        
        if (unreadDoc.exists()) {
          const unreadData = unreadDoc.data();
          // If this member has unread messages, update to mark as read
          if (unreadData && unreadData[profileId]) {
            const updatedData = { ...unreadData };
            delete updatedData[profileId]; // Remove this member's unread count
            
            await updateDoc(unreadDocRef, updatedData);
            console.log(`Marked messages as read for member ${profileId}`);
          }
        }
      } catch (error) {
        console.error('Error marking messages as read:', error);
      }
    };

    markMessagesAsRead();
  }, [id, profileId]);

  useEffect(() => {
    const fetchMemberData = async () => {
      if (!profileId) return;
      
      try {
        setLoading(true);
        
        const userDoc = await getDoc(doc(db, 'users', profileId));
        if (!userDoc.exists()) {
          showToast('Member not found', 'error');
          navigate(`/church/${id}/admin-connect`);
          return;
        }

        const userData = userDoc.data();
        setMemberData({
          ...userData,
          id: userDoc.id,
        });

        setLoading(false);
      } catch (error) {
        console.error('Error fetching member data:', error);
        showToast('Failed to load member data', 'error');
        setLoading(false);
      }
    };

    fetchMemberData();
  }, [profileId, id, navigate]);

  useEffect(() => {
    // Scroll to bottom whenever message history changes
    scrollToBottom();
  }, [messageHistory]);

  // Replace all separate listeners with a single consolidated listener
  useEffect(() => {
    if (!memberData?.phone || !id || !profileId) return;
    
    console.log("Setting up consolidated message listener");
    
    try {
      // Get references to both main message collections
      const messagesRef = collection(db, 'messages');
      const churchMessagesRef = collection(db, `churches/${id}/messages`);
      
      // Create a single comprehensive query for the main messages collection
      // This query is deliberately broad to catch all message formats
      const mainQuery = query(
        messagesRef,
        where('churchId', '==', id),
        orderBy('timestamp', 'desc'),
        limit(50) // Limit to reasonable number for performance
      );
      
      // Clean phone number formats for comparison
      const cleanedPhone = cleanPhoneNumber(memberData.phone);
      const phoneWithCountryCode = `+1${cleanedPhone}`;
      
      // Track message IDs to prevent duplicates
      const messageIdSet = new Set();
      
      // First listener: main messages collection
      const unsubscribeMain = onSnapshot(mainQuery, 
        (snapshot) => {
          console.log(`Main query returned ${snapshot.size} messages`);
          
          const messages = [];
          snapshot.forEach((doc) => {
            const data = doc.data();
            const docId = doc.id;
            
            // Skip if we've already processed this message
            if (messageIdSet.has(docId)) {
              return;
            }
            
            // Debug log
            if (data.from === memberData.phone || data.From === memberData.phone || 
               data.to === memberData.phone || data.To === memberData.phone ||
               data.memberId === profileId) {
              console.log("Potential message match:", {
                id: docId,
                memberId: data.memberId,
                profileId,
                from: data.from || data.From,
                to: data.to || data.To
              });
            }
            
            // Create a comprehensive set of matching conditions
            const memberMatches = [
              // Member ID match
              data.memberId === profileId,
              
              // Phone matches in various formats (from fields)
              data.from === memberData.phone,
              data.From === memberData.phone,
              data.from === phoneWithCountryCode,
              data.From === phoneWithCountryCode,
              
              // Phone matches in various formats (to fields)
              data.to === memberData.phone,
              data.To === memberData.phone,
              data.to === phoneWithCountryCode,
              data.To === phoneWithCountryCode
            ];
            
            // Extra check for Twilio format where +1 might be in the phone
            if (data.From && data.From.replace(/\+1/, '') === cleanedPhone) {
              memberMatches.push(true);
            }
            if (data.To && data.To.replace(/\+1/, '') === cleanedPhone) {
              memberMatches.push(true);
            }
            
            // If any match condition is met, include this message
            if (memberMatches.some(match => match)) {
              console.log("Found matching message:", {
                id: docId,
                messageContent: data.message || data.Body || data.body || "No content"
              });
              
              // Mark this message as processed to avoid duplicates
              messageIdSet.add(docId);
              
              // Safely handle timestamp
              let timestamp;
              try {
                if (data.timestamp) {
                  timestamp = data.timestamp.toDate ? data.timestamp.toDate() : new Date(data.timestamp);
                } else if (data.sentAt) {
                  timestamp = data.sentAt.toDate ? data.sentAt.toDate() : new Date(data.sentAt);
                } else if (data.dateSent) {
                  timestamp = new Date(data.dateSent);
                } else {
                  timestamp = new Date();
                }
              } catch (e) {
                console.warn('Error converting timestamp', e);
                timestamp = new Date();
              }
              
              // Determine message direction
              let direction;
              if (data.direction) {
                // Use explicit direction if available
                direction = data.direction;
              } else if (data.from === memberData.phone || 
                        data.From === memberData.phone ||
                        data.from === phoneWithCountryCode || 
                        data.From === phoneWithCountryCode ||
                        (data.From && data.From.replace(/\+1/, '') === cleanedPhone)) {
                // If sender is member, it's inbound
                direction = 'inbound';
              } else {
                // Otherwise outbound
                direction = 'outbound';
              }
              
              // Get message content from various possible fields
              const messageContent = 
                data.message || 
                data.Body || 
                data.body || 
                (data.content && typeof data.content === 'string' ? data.content : null) ||
                "No message content";
              
              // Add the message to our processed list
              messages.push({
                id: docId,
                ...data,
                message: messageContent,
                direction,
                timestamp
              });
            }
          });
          
          if (messages.length > 0) {
            // Create fingerprints for new messages
            const messageFingerprints = messages.map(msg => getMessageFingerprint(msg));
            
            // Update message history using fingerprints for deduplication
            setMessageHistory(prev => {
              // Create fingerprints for existing messages
              const existingFingerprints = prev.map(msg => getMessageFingerprint(msg));
              
              // Start with existing messages
              const allMessages = [...prev];
              let addedCount = 0;
              
              // Add only truly new messages (not duplicates by content)
              messages.forEach((newMsg, index) => {
                const fingerprint = messageFingerprints[index];
                
                // Only add if neither ID nor fingerprint matches any existing message
                if (!allMessages.some(msg => msg.id === newMsg.id) && 
                    !existingFingerprints.includes(fingerprint)) {
                  
                  // Debug duplicate detection
                  console.log(`Adding new message with fingerprint: ${fingerprint}`);
                  
                  allMessages.push(newMsg);
                  addedCount++;
                } else {
                  console.log(`Skipping duplicate message: ${newMsg.message}`);
                }
              });
              
              if (addedCount > 0) {
                console.log(`Added ${addedCount} new messages to history`);
                
                // Sort messages by timestamp
                allMessages.sort((a, b) => {
                  // Handle missing timestamps
                  if (!a.timestamp) return -1;
                  if (!b.timestamp) return 1;
                  return a.timestamp - b.timestamp;
                });
                
                return allMessages;
              }
              
              return prev;
            });
          }
        },
        (error) => {
          console.error("Error in main message listener:", error);
        }
      );
      
      // Second listener: church-specific subcollection
      const unsubscribeChurch = onSnapshot(churchMessagesRef, 
        (snapshot) => {
          console.log(`Church subcollection query returned ${snapshot.size} messages`);
          
          const messages = [];
          snapshot.forEach((doc) => {
            const data = doc.data();
            const docId = `church_${doc.id}`; // Prefix to avoid collision with main collection
            
            // Skip if we've already processed this message
            if (messageIdSet.has(docId)) {
              return;
            }
            
            // Standardize phone numbers for comparison
            const memberPhone = cleanPhoneNumber(memberData.phone);
            const dataToPhone = data.to ? cleanPhoneNumber(data.to) : '';
            
            // Check for phone number match or member name match
            if (dataToPhone.includes(memberPhone) || 
                (data.memberName && data.memberName.includes(memberData.name)) ||
                data.memberId === profileId) {
              console.log("Found matching church subcollection message:", {
                id: docId,
                messageContent: data.message || data.body || "No content"
              });
              
              // Mark as processed
              messageIdSet.add(docId);
              
              // Convert timestamp
              let timestamp;
              try {
                if (data.sentAt) {
                  timestamp = data.sentAt.toDate ? data.sentAt.toDate() : new Date(data.sentAt);
                } else if (data.timestamp) {
                  timestamp = data.timestamp.toDate ? data.timestamp.toDate() : new Date(data.timestamp);
                } else {
                  timestamp = new Date();
                }
              } catch (e) {
                timestamp = new Date();
              }
              
              // Add to messages list - for church subcollection, we need to ensure direction is correctly set
              // If the message is from the Member's phone, it's inbound
              let direction = 'outbound'; // Default for church messages
              
              // Check if this is actually an inbound message (from member to church)
              if ((data.from && data.from.includes(memberPhone)) || 
                  (data.From && data.From.includes(memberPhone))) {
                direction = 'inbound';
              }
              
              messages.push({
                id: docId,
                ...data,
                message: data.message || data.body || data.Body || "No message content",
                direction,
                timestamp
              });
            }
          });
          
          if (messages.length > 0) {
            // Create fingerprints for new messages
            const messageFingerprints = messages.map(msg => getMessageFingerprint(msg));
            
            // Update message history using fingerprints for deduplication
            setMessageHistory(prev => {
              // Create fingerprints for existing messages
              const existingFingerprints = prev.map(msg => getMessageFingerprint(msg));
              
              // Start with existing messages
              const allMessages = [...prev];
              let addedCount = 0;
              
              // Add only truly new messages (not duplicates by content)
              messages.forEach((newMsg, index) => {
                const fingerprint = messageFingerprints[index];
                
                // Only add if neither ID nor fingerprint matches any existing message
                if (!allMessages.some(msg => msg.id === newMsg.id) && 
                    !existingFingerprints.includes(fingerprint)) {
                  
                  // Debug duplicate detection
                  console.log(`Adding new church message with fingerprint: ${fingerprint}`);
                  
                  allMessages.push(newMsg);
                  addedCount++;
                } else {
                  console.log(`Skipping duplicate church message: ${newMsg.message}`);
                }
              });
              
              if (addedCount > 0) {
                console.log(`Added ${addedCount} new church messages to history`);
                
                // Sort messages by timestamp
                allMessages.sort((a, b) => {
                  // Handle missing timestamps
                  if (!a.timestamp) return -1;
                  if (!b.timestamp) return 1;
                  return a.timestamp - b.timestamp;
                });
                
                return allMessages;
              }
              
              return prev;
            });
          }
        },
        (error) => {
          console.error("Error in church message listener:", error);
        }
      );
      
      // Clean up both listeners on unmount
      return () => {
        console.log("Cleaning up message listeners");
        unsubscribeMain();
        unsubscribeChurch();
      };
    } catch (error) {
      console.error('Error setting up message listeners:', error);
    }
  }, [memberData, id, profileId]);

  // Add a dedicated function to manually check for SMS responses
  const checkForSMSResponses = async () => {
    if (!memberData?.phone || !id) return;
    
    try {
      console.log("Manually checking for SMS responses...");
      
      // Format the phone number for query
      const cleanedPhone = cleanPhoneNumber(memberData.phone);
      const phoneWithCountryCode = `+1${cleanedPhone}`;
      
      // All possible phone formats to search for - ensure these are non-empty and valid
      const phoneFormats = [
        memberData.phone,
        phoneWithCountryCode,
        cleanedPhone
      ].filter(phone => phone && phone.trim().length > 0); // Filter out any empty values
      
      // Only proceed if we have valid phone formats to search
      if (phoneFormats.length === 0) {
        console.log("No valid phone formats to search for");
        return;
      }
      
      console.log("Checking for Twilio messages with phone formats:", phoneFormats);
      
      // Get the Twilio messages directly via API
      const response = await fetch('https://us-central1-igletechv1.cloudfunctions.net/checkTwilioMessages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phoneNumber: memberData.phone,
          phoneFormats: phoneFormats, // Send all formats to the API
          churchId: id,
          memberId: profileId
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("Failed to check for Twilio messages:", errorText);
        return;
      }
      
      // Safely parse the response and handle potential structure issues
      const responseData = await response.json();
      
      // Check if the response has the expected structure
      if (!responseData) {
        console.error("Empty response from Twilio API");
        return;
      }
      
      // Safely access the messages array with fallbacks
      const messages = responseData.success && responseData.messages ? responseData.messages : 
                        (responseData.data && responseData.data.messages ? responseData.data.messages : []);
      
      if (messages && messages.length > 0) {
        console.log(`Found ${messages.length} SMS responses from Twilio API`);
        
        // Add these messages to the message history
        setMessageHistory(prev => {
          // Start with existing messages
          const allMessages = [...prev];
          // Create fingerprints for existing messages
          const existingFingerprints = prev.map(msg => getMessageFingerprint(msg));
          let addedCount = 0;
          
          // Process each message from the Twilio API
          messages.forEach(twilioMsg => {
            // Skip if the message doesn't have required fields
            if (!twilioMsg || !twilioMsg.body) {
              console.log("Skipping invalid Twilio message:", twilioMsg);
              return;
            }
            
            // Create a message object in our standard format
            const msgObj = {
              id: `twilio_${twilioMsg.sid || Date.now()}`,
              message: twilioMsg.body,
              direction: twilioMsg.direction === 'inbound' ? 'inbound' : 'outbound',
              timestamp: twilioMsg.dateSent ? new Date(twilioMsg.dateSent) : new Date(),
              from: twilioMsg.from,
              to: twilioMsg.to,
              status: 'received',
              twilioSid: twilioMsg.sid
            };
            
            // Check for duplicates using fingerprint
            const fingerprint = getMessageFingerprint(msgObj);
            
            if (!existingFingerprints.includes(fingerprint)) {
              console.log(`Adding new Twilio message: ${msgObj.message}`);
              allMessages.push(msgObj);
              addedCount++;
            }
          });
          
          if (addedCount > 0) {
            console.log(`Added ${addedCount} new messages from Twilio API`);
            
            // Sort messages by timestamp
            allMessages.sort((a, b) => {
              if (!a.timestamp) return -1;
              if (!b.timestamp) return 1;
              return a.timestamp - b.timestamp;
            });
            
            return allMessages;
          }
          
          return prev;
        });
      } else {
        console.log("No new messages found from Twilio API");
      }
    } catch (error) {
      console.error("Error checking for SMS responses:", error);
    }
  };

  // Add a manual refresh button to UI and call this function periodically
  useEffect(() => {
    // Initial check
    checkForSMSResponses();
    
    // Set up interval to check periodically (every 30 seconds)
    const intervalId = setInterval(() => {
      checkForSMSResponses();
    }, 30000);
    
    return () => clearInterval(intervalId);
  }, [memberData, id, profileId]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSendMessage = async () => {
    if (!messageText.trim() || !memberData?.phone) return;
    
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
      
      // Format phone number for Twilio (add +1 for US numbers)
      const phoneNumber = memberData.phone.startsWith('+') ? 
        memberData.phone : 
        `+1${cleanPhoneNumber(memberData.phone)}`;
      
      // Generate a unique ID for this message
      const messageId = `outbound_${Date.now()}`;
      
      // First add message to Firestore with pending status
      const messageRef = await addDoc(collection(db, 'messages'), {
        memberId: profileId,
        churchId: id,
        message: messageText,
        to: phoneNumber,
        direction: 'outbound',
        status: 'sending',
        timestamp: serverTimestamp(),
        sender: {
          id: user.uid,
          name: user.displayName || user.email
        },
        clientMessageId: messageId // Client-side ID to detect duplicates
      });
      
      console.log(`Sending SMS to ${phoneNumber}, message ID: ${messageRef.id}`);
      
      // Call Firebase Cloud Function endpoint
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
          memberId: profileId,
          messageId: messageRef.id,
          clientMessageId: messageId,
          memberName: `${memberData.name} ${memberData.lastName || ''}`
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          error: 'Failed to send message',
          details: `Server returned ${response.status}`
        }));
        
        // Update status to failed
        await updateDoc(doc(db, 'messages', messageRef.id), {
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
          await updateDoc(doc(db, 'messages', messageRef.id), {
            status: 'sent',
            twilioMessageId: responseData.messageId
          });
        } else {
          await updateDoc(doc(db, 'messages', messageRef.id), {
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
        await updateDoc(doc(db, 'messages', messageRef.id), {
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

      showToast('Message sent successfully!', 'success');
      setMessageText('');
      // No need to manually refresh as we have a real-time listener
    } catch (error) {
      console.error('Error sending message:', error);
      showToast(error.message || 'Failed to send message', 'error');
    } finally {
      setSendingMessage(false);
    }
  };

  // Handle back button navigation
  const handleBack = () => {
    // Check if we have a return path in sessionStorage
    const returnPath = sessionStorage.getItem('adminConnectReturnPath');
    if (returnPath) {
      sessionStorage.removeItem('adminConnectReturnPath');
      navigate(returnPath);
    } else {
      // Default fallback
      navigate(`/church/${id}/admin-connect`);
    }
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="page-container">
      <ToastContainer 
        position="top-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop={true}
        closeOnClick={true}
        rtl={false}
        pauseOnFocusLoss={false}
        draggable={true}
        pauseOnHover={true}
        theme="light"
        limit={3}
      />
      <button
        onClick={handleBack}
        className="back-button"
        style={{ marginBottom: '1rem' }}
      >
        ← Back
      </button>
      <ChurchHeader id={id} />
      <div className="content-box">
        <h2>Messaging with {memberData?.name} {memberData?.lastName}</h2>
        
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
              onClick={() => navigate(`/church/${id}/balance-manager`)}
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
                  onClick={() => navigate(`/church/${id}/balance-manager`)}
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

        <div className="member-contact-info">
          <div className="contact-item">
            <span className="label">Phone:</span>
            <span className="value">{formatPhoneNumber(memberData?.phone) || 'No phone provided'}</span>
          </div>
          <div className="contact-item">
            <span className="label">Email:</span>
            <span className="value">{memberData?.email || 'No email provided'}</span>
          </div>
          <button 
            className="refresh-button"
            onClick={() => {
              checkForSMSResponses();
              showToast('Checking for new responses...', 'info');
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
        </div>

        <div className="messaging-container">
          <div className="message-history">
            {messageHistory.length > 0 ? (
              messageHistory.map((message) => (
                <div 
                  key={message.id} 
                  className={`message-bubble ${message.direction === 'outbound' ? 'sent' : 'received'}`}
                >
                  <div className="message-content">
                    {message.message || message.Body || message.body || "No message content"}
                  </div>
                  <div className="message-metadata">
                    <span className="message-time">
                      {message.timestamp.toLocaleString()}
                    </span>
                    {message.direction === 'outbound' && (
                      <span className="message-status">{message.status || 'sent'}</span>
                    )}
                    {message.direction === 'inbound' && (
                      <span className="message-from">Response</span>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="no-messages">
                <p>No message history yet. Send a message to start a conversation.</p>
              </div>
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

export default MemberMessaging;
