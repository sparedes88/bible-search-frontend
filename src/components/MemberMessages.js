import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, query, orderBy, getDocs, addDoc, serverTimestamp, where, writeBatch, doc, updateDoc, onSnapshot, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'react-toastify';
import ChurchHeader from './ChurchHeader';

const MemberMessages = () => {
  const { id, profileId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [loading, setLoading] = useState(true);
  const [memberData, setMemberData] = useState(null);
  const messagesEndRef = useRef(null);

  // Scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Fetch member data and message history
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch messages
        const messagesRef = collection(db, `churches/${id}/messages`);
        const q = query(
          messagesRef,
          where('memberId', '==', profileId),
          orderBy('sentAt', 'asc') // Changed from 'desc' to 'asc' to show oldest messages first
        );
        
        const querySnapshot = await getDocs(q);
        const fetchedMessages = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          sentAt: doc.data().sentAt?.toDate?.() || new Date()
        }));
        
        // Sort messages by date (oldest first)
        const sortedMessages = fetchedMessages.sort((a, b) => 
          (a.sentAt || new Date()) - (b.sentAt || new Date())
        );
        
        setMessages(sortedMessages);

        // Fetch member data
        const usersRef = collection(db, 'users');
        const memberQuery = query(usersRef, where('uid', '==', profileId));
        const memberSnapshot = await getDocs(memberQuery);
        
        if (!memberSnapshot.empty) {
          setMemberData(memberSnapshot.docs[0].data());
        }

        // Mark unread messages as read
        const unreadMessages = querySnapshot.docs.filter(doc => 
          !doc.data().isRead && doc.data().senderId !== user.uid
        );
        
        if (unreadMessages.length > 0) {
          console.log(`Found ${unreadMessages.length} unread messages to mark as read`);
          const batch = writeBatch(db);
          
          unreadMessages.forEach(doc => {
            batch.update(doc.ref, { isRead: true });
          });
          
          await batch.commit();
          
          // Update the unread message counts for this member in adminConnect collection
          try {
            const unreadDocRef = doc(db, `churches/${id}/adminConnect/members`);
            const unreadDoc = await getDoc(unreadDocRef); // Fixed: using getDoc instead of getDocs
            
            if (unreadDoc.exists()) { // Fixed: exists() is a method
              const updateData = {};
              updateData[profileId] = 0; // Set unread count to zero
              await updateDoc(unreadDocRef, updateData);
              console.log(`Marked messages as read for member ${profileId}`);
            } else {
              // Create the document if it doesn't exist
              const initialData = {};
              initialData[profileId] = 0;
              await setDoc(unreadDocRef, initialData);
              console.log(`Created unread counter document for member ${profileId}`);
            }
          } catch (error) {
            console.error('Error updating unread message counts:', error);
          }
        }
      } catch (error) {
        console.error('Error fetching data:', error);
        toast.error('Failed to load messages');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    
    // Set up real-time listener for new messages
    const messagesRef = collection(db, `churches/${id}/messages`);
    const q = query(
      messagesRef,
      where('memberId', '==', profileId),
      orderBy('sentAt', 'asc')
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newMessages = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        sentAt: doc.data().sentAt?.toDate?.() || new Date()
      }));
      
      // Sort messages by date (oldest first)
      const sortedMessages = newMessages.sort((a, b) => 
        (a.sentAt || new Date()) - (b.sentAt || new Date())
      );
      
      setMessages(sortedMessages);
      
      // Mark new messages as read if they're from the member
      const unreadMessages = snapshot.docChanges()
        .filter(change => change.type === 'added' && !change.doc.data().isRead && change.doc.data().senderId !== user.uid);
      
      if (unreadMessages.length > 0) {
        console.log(`Found ${unreadMessages.length} new unread messages to mark as read`);
        const batch = writeBatch(db);
        
        unreadMessages.forEach(change => {
          batch.update(change.doc.ref, { isRead: true });
        });
        
        batch.commit().then(() => {
          // Update the unread counter in the adminConnect/members document
          const unreadDocRef = doc(db, `churches/${id}/adminConnect/members`);
          getDoc(unreadDocRef).then(unreadSnapshot => {
            if (unreadSnapshot.exists()) {
              // Set this member's unread count to zero
              const updateData = {};
              updateData[profileId] = 0;
              updateDoc(unreadDocRef, updateData).catch(err => console.error('Error updating unread counter:', err));
            } else {
              // Create the document if it doesn't exist yet
              const initialData = {};
              initialData[profileId] = 0;
              setDoc(unreadDocRef, initialData)
                .catch(err => console.error('Error creating unread counter doc:', err));
            }
          }).catch(err => console.error('Error getting unread doc:', err));
        }).catch(err => console.error('Error committing batch:', err));
      }
    }, error => {
      console.error('Error in messages real-time listener:', error);
    });
    
    return () => unsubscribe();
  }, [id, profileId, user.uid]);

  const handleSendMessage = async () => {
    if (!messageText.trim() || !memberData?.phone) return;

    try {
      // Format phone number for Twilio
      const phoneNumber = memberData.phone.startsWith('+') ? 
        memberData.phone : 
        `+1${memberData.phone.replace(/\D/g, '')}`;

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
          memberId: profileId,
          memberName: `${memberData.name} ${memberData.lastName || ''}`
        })
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      // Add to messages collection
      await addDoc(collection(db, `churches/${id}/messages`), {
        message: messageText,
        sentAt: serverTimestamp(),
        senderId: user.uid,
        senderName: `${user.name} ${user.lastName || ''}`,
        memberId: profileId,
        memberName: `${memberData.name} ${memberData.lastName || ''}`,
        to: phoneNumber,
        status: 'sent',
        isRead: true, // Our outgoing messages are marked as read by default
        isGroupMessage: false // Mark this as a direct message, not a group message
      });

      setMessageText('');
      toast.success('Message sent successfully!');
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error(error.message || 'Failed to send message');
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
      navigate(`/church/${id}/admin-connect/member/${profileId}`);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4">
      <button
        onClick={handleBack}
        className="mb-4 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center"
      >
        ← Back to Member Profile
      </button>

      <ChurchHeader id={id} />

      <div className="bg-white rounded-lg shadow-lg p-6">
        <h2 className="text-2xl font-semibold mb-6">
          Message History with {memberData?.name} {memberData?.lastName}
        </h2>

        {/* Messages List */}
        <div className="space-y-4 max-h-[60vh] overflow-y-auto mb-6">
          {loading ? (
            <div className="text-gray-500">Loading messages...</div>
          ) : messages.length === 0 ? (
            <div className="text-gray-500">No message history</div>
          ) : (
            messages.map(message => (
              <div 
                key={message.id}
                className={`p-4 rounded-lg ${
                  message.senderId === user.uid 
                    ? 'bg-blue-50 ml-auto' 
                    : 'bg-gray-50'
                } max-w-[80%]`}
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="font-medium text-sm text-gray-600">
                    {message.senderId === user.uid ? 'You' : message.senderName}
                    {message.isGroupMessage && " (Group Message)"}
                  </span>
                  <span className="text-xs text-gray-500">
                    {message.sentAt?.toLocaleString()}
                  </span>
                </div>
                <p className="text-gray-700 whitespace-pre-wrap">{message.message}</p>
                <div className="mt-2 flex justify-end">
                  {message.isGroupMessage && (
                    <span className="text-xs px-2 py-1 mr-2 rounded-full bg-purple-100 text-purple-800">
                      {message.groupName ? `From: ${message.groupName}` : 'Group Message'}
                    </span>
                  )}
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    message.status === 'sent' 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {message.status || 'unknown'}
                  </span>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Message Input */}
        <div className="flex gap-2">
          <textarea
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            placeholder="Type your message here..."
            className="flex-1 p-2 border rounded-lg resize-none"
            rows={3}
          />
          <button
            onClick={handleSendMessage}
            disabled={!messageText.trim()}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed h-min self-end"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
};

export default MemberMessages;