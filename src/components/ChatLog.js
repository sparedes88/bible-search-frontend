import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { db, auth } from "../firebase";
import {
  collection,
  query,
  onSnapshot,
  addDoc,
  serverTimestamp,
  doc,
  setDoc,
  getDoc,
  orderBy,
  updateDoc,
} from "firebase/firestore";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import chatStyles from "../pages/chatStyles";
import { useAuth } from "../contexts/AuthContext";

const ChatLog = () => {
  const { id, groupId } = useParams();
  const { user } = useAuth(); // Get logged-in user
  const navigate = useNavigate();
  const messagesEndRef = useRef(null);

  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [typingUsers, setTypingUsers] = useState({});
  const [groupData, setGroupData] = useState(null);
  const typingTimeoutRef = useRef(null);

  // Fetch group data
  useEffect(() => {
    const fetchGroupData = async () => {
      if (!groupId) return;

      try {
        const groupRef = doc(db, "groups", groupId);
        const groupSnap = await getDoc(groupRef);

        if (groupSnap.exists()) {
          setGroupData(groupSnap.data());
        }
      } catch (error) {
        console.error("Error fetching group data:", error);
      }
    };

    fetchGroupData();
  }, [groupId]);

  useEffect(() => {
    if (!user) return;

    // Listen for new messages in Firestore
    const messagesRef = collection(db, `groups/${groupId}/messages`);
    const q = query(messagesRef, orderBy("sentAt"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedMessages = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      setMessages(fetchedMessages);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [groupId, user]);

  // Separate useEffect for handling scrolling when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (!user) return;

    // Listen for typing status
    const typingRef = collection(db, `groups/${groupId}/typingStatus`);

    const unsubscribeTyping = onSnapshot(typingRef, (snapshot) => {
      const typingUsersData = {};
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.isTyping) {
          typingUsersData[data.userId] = `${data.displayName}`;
        }
      });

      setTypingUsers(typingUsersData);
    });

    return () => unsubscribeTyping();
  }, [groupId, user]);

  // Scroll to bottom on initial load
  useEffect(() => {
    if (!loading) {
      scrollToBottom();
    }
  }, [loading]);

  const markAsRead = async (groupId, userId) => {
    if (!userId) return;
    const readStatusRef = doc(db, `groups/${groupId}/readStatus/${userId}`);
    try {
      await setDoc(readStatusRef, { lastRead: serverTimestamp() }, { merge: true });
    } catch (error) {
      console.error("Error updating read status:", error);
    }
  };

  useEffect(() => {
    if (!user) return;
    markAsRead(groupId, user.uid);
  }, [groupId, user, messages]);

  // Function to send a message
  const handleSendMessage = async () => {
    if (newMessage.trim() === "") return;

    const messageRef = collection(db, `groups/${groupId}/messages`);

    await addDoc(messageRef, {
      text: newMessage,
      senderId: user.uid,
      senderName: `${user.name} ${user.lastName}`,
      sentAt: serverTimestamp(),
    });

    setNewMessage("");
    stopTyping();
    scrollToBottom();

    // Fetch group document to get members array
    const groupRef = doc(db, "groups", groupId);
    const groupDoc = await getDoc(groupRef);

    if (!groupDoc.exists()) return console.error("Group not found!");

    const groupData = groupDoc.data();
    const members = groupData.members || [];

    // Get user IDs (except the sender)
    const userIds = members
      .filter((member) => member.userId !== user.uid)
      .map((member) => member.userId);

    if (userIds.length === 0) return;

    // Fetch FCM tokens of members from users collection
    const tokens = [];
    const currentUserRef = doc(db, "users", user.uid);
    const currentUserDoc = await getDoc(currentUserRef);
    const currentUserToken = currentUserDoc.exists() ? currentUserDoc.data().fcmToken : null;

    for (const userId of userIds) {
      const userRef = doc(db, "users", userId);
      const userDoc = await getDoc(userRef);
      if (userDoc.exists()) {
        const userData = userDoc.data();
        // Only add token if it exists and is not the sender's token
        if (userData.fcmToken && userData.fcmToken !== currentUserToken) {
          tokens.push(userData.fcmToken);
        }
      }
    }

    // Send notifications via Firebase Cloud Function if we have tokens
    if (tokens.length > 0) {
      try {
        const response = await fetch(
          "https://us-central1-igletechv1.cloudfunctions.net/sendNotification",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              tokens,
              title: `New Message in ${groupData?.groupName}`,
              body: `${user.name} ${user.lastName}: ${newMessage}`,
              data: {
                churchId: id,
                groupId: groupId,
                messageId: messageRef.id,
                type: "chat_message",
                clickAction: `/church/${id}/chat/${groupId}`,
                senderId: user.uid,
              },
            }),
          }
        );
        
        if (!response.ok) {
          console.error("Failed to send notification:", await response.text());
        }
      } catch (error) {
        console.error("Error sending notification:", error);
      }
    }
  };

  // Function to detect when the user is typing
  const handleTyping = (e) => {
    setNewMessage(e.target.value);
    startTyping();
  };

  // Mark the user as typing in Firestore
  const startTyping = async () => {
    if (!user) return;
    const typingRef = doc(db, `groups/${groupId}/typingStatus`, user.uid);

    try {
      await setDoc(
        typingRef,
        {
          userId: user.uid,
          displayName: `${user.name} ${user.lastName || ""}`,
          isTyping: true,
        },
        { merge: true }
      );

      // Reset typing after 3 seconds of inactivity
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        stopTyping();
      }, 3000);
    } catch (error) {
      console.error("Error updating typing status:", error);
    }
  };

  // Mark the user as not typing
  const stopTyping = async () => {
    if (!user) return;
    const typingRef = doc(db, `groups/${groupId}/typingStatus`, user.uid);

    try {
      await updateDoc(typingRef, { isTyping: false });
    } catch (error) {
      console.error("Error stopping typing status:", error);
    }
  };

  // Scroll to the latest message
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div style={chatStyles.container}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button
          onClick={() => navigate(`/church/${id}/chatv2`)}
          style={chatStyles.backButton}
        >
          ⬅ Volver
        </button>
      </div>

      <h2 style={{ display: "flex", alignItems: "center" }}>
        Group Chat - {groupData?.groupName}
      </h2>

      <div style={chatStyles.chatContainer}>
        {loading ? (
          <Skeleton count={5} />
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              style={
                msg.senderId === user?.uid
                  ? chatStyles.myMessage
                  : chatStyles.otherMessage
              }
            >
              <p
                style={{ color: msg.senderId === user?.uid ? "blue" : "green" }}
              >
                <strong>{msg.senderName}</strong>
              </p>
              <p>{msg.text}</p>
              <p style={chatStyles.timestamp}>
                {msg.sentAt?.toDate
                  ? new Date(msg.sentAt.toDate()).toLocaleString()
                  : "Sending..."}
              </p>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Typing Indicator */}
      {Object.keys(typingUsers).length > 0 && (
        <p style={{ color: "gray", fontSize: "0.9rem", marginLeft: "10px" }}>
          {Object.values(typingUsers).join(", ")}{" "}
          {Object.keys(typingUsers).length > 1 ? "are" : "is"} typing...
        </p>
      )}

      <div style={chatStyles.inputContainer}>
        <input
          type="text"
          value={newMessage}
          onChange={handleTyping}
          onBlur={stopTyping}
          placeholder="Type a message"
          style={chatStyles.input}
        />
        <button onClick={handleSendMessage} style={chatStyles.sendButton}>
          Send
        </button>
      </div>
    </div>
  );
};

export default ChatLog;
