import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, query, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import ChurchHeader from './ChurchHeader';
import { toast } from 'react-toastify';

const Messages = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMessages = async () => {
      try {
        const messagesRef = collection(db, `churches/${id}/messages`);
        const q = query(
          messagesRef,
          orderBy('sentAt', 'desc')
        );
        
        const querySnapshot = await getDocs(q);
        const fetchedMessages = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          sentAt: doc.data().sentAt?.toDate?.() || new Date()
        }));
        
        // Create a map to track unique messages by their content and recipient
        const uniqueMessages = new Map();
        
        // Process messages and keep only the latest status for each unique message
        fetchedMessages.forEach(message => {
          const messageKey = `${message.to}-${message.message.trim()}`;
          
          if (!uniqueMessages.has(messageKey)) {
            // First time seeing this message, add it to the map
            uniqueMessages.set(messageKey, message);
          } else {
            // We've seen this message before, determine if we should update status
            const existingMessage = uniqueMessages.get(messageKey);
            
            // Priority order: delivered > sent > other statuses
            const statusPriority = {
              'delivered': 3,
              'read': 2,
              'sent': 1
            };
            
            const existingPriority = statusPriority[existingMessage.status] || 0;
            const newPriority = statusPriority[message.status] || 0;
            
            // Update the existing message if:
            // 1. The new message has a higher status priority, or
            // 2. Same status but newer timestamp
            if (newPriority > existingPriority || 
                (newPriority === existingPriority && message.sentAt > existingMessage.sentAt)) {
              uniqueMessages.set(messageKey, message);
            }
          }
        });
        
        // Convert map back to array and sort by date (newest first)
        const dedupedMessages = Array.from(uniqueMessages.values())
          .sort((a, b) => b.sentAt - a.sentAt);
        
        setMessages(dedupedMessages);
      } catch (error) {
        console.error('Error fetching messages:', error);
        toast.error('Failed to load messages');
      } finally {
        setLoading(false);
      }
    };

    fetchMessages();
  }, [id]);

  const formatPhoneNumber = (phone) => {
    if (!phone) return '';
    const cleaned = phone.replace(/\D/g, '');
    const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);
    if (match) {
      return `(${match[1]}) ${match[2]}-${match[3]}`;
    }
    return phone;
  };

  return (
    <div className="page-container">
      <button
        onClick={() => navigate(`/church/${id}/admin-connect`)}
        className="back-button mb-4"
      >
        ← Back to Admin Connect
      </button>
      <ChurchHeader id={id} />
      
      <div className="content-box">
        <h2 className="text-2xl font-semibold mb-6">Message History</h2>
        
        {loading ? (
          <div>Loading messages...</div>
        ) : messages.length === 0 ? (
          <div className="text-gray-500">No messages sent yet</div>
        ) : (
          <div className="space-y-4">
            {messages.map(message => (
              <div 
                key={message.id}
                className="bg-white rounded-lg shadow p-4 border border-gray-200"
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h3 className="font-medium">{message.memberName}</h3>
                    <p className="text-sm text-gray-600">{formatPhoneNumber(message.to)}</p>
                  </div>
                  <span className="text-sm text-gray-500">
                    {message.sentAt ? message.sentAt.toLocaleString() : 'Date unknown'}
                  </span>
                </div>
                <p className="text-gray-700 whitespace-pre-wrap">{message.message}</p>
                <div className="mt-2">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    message.status === 'sent' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {message.status || 'unknown'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Messages;