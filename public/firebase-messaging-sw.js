// Import Firebase scripts
importScripts("https://www.gstatic.com/firebasejs/10.1.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.1.0/firebase-messaging-compat.js");

// Initialize the Firebase app in the service worker
firebase.initializeApp({
  apiKey: "AIzaSyAD1g2ppeIBUgGI-JUaJ2dwH0qIoAM5At8",
  authDomain: "iglesiatech-3a5d9.firebaseapp.com",
  projectId: "iglesiatech-3a5d9",
  storageBucket: "iglesiatech-3a5d9.appspot.com",
  messagingSenderId: "144483333621",
  appId: "1:144483333621:web:75c8bbe0ef945e14141deb"
});

// Retrieve an instance of Firebase Messaging
const messaging = firebase.messaging();

// Keep track of processed message IDs
const processedMessages = new Set();

// Handle background push notifications
messaging.onBackgroundMessage((payload) => {
  const messageId = payload.data?.messageId;
  
  // Skip if we've already processed this message
  if (messageId && processedMessages.has(messageId)) {
    console.log("Skipping duplicate message:", messageId);
    return;
  }

  console.log("Background Message received:", payload);

  // Skip notification if current user is the sender
  const currentUserId = self.localStorage?.getItem("userId");
  if (currentUserId && currentUserId === payload.data?.senderId) {
    console.log("Skipping notification for sender");
    return;
  }

  // Add message ID to processed set
  if (messageId) {
    processedMessages.add(messageId);
    // Clean up old messages (keep only last 100)
    if (processedMessages.size > 100) {
      const iterator = processedMessages.values();
      processedMessages.delete(iterator.next().value);
    }
  }

  const clickAction = payload.data?.clickAction || "/";
  const groupId = payload.data?.groupId;

  // Create a unique tag for the chat group
  const tag = groupId || "chat-notification";

  self.registration.showNotification(payload.notification.title, {
    body: payload.notification.body,
    icon: "/logo.png",
    badge: "/logo.png",
    tag: tag, // Use group ID as tag to group notifications
    renotify: false, // Don't notify again for same tag
    silent: true, // Prevent sound for duplicate notifications
    data: {
      ...payload.data,
      timestamp: Date.now(),
    },
    actions: [
      {
        action: "view",
        title: "View Message",
      },
    ],
  });
});

// Add click event listener for the notifications
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  
  // Get the click action URL from notification data
  const clickAction = event.notification.data?.clickAction || "/";
  
  // Open or focus the target URL
  event.waitUntil(
    clients.matchAll({type: "window"}).then((windowClients) => {
      // Check if there is already a window/tab open with the target URL
      for (let client of windowClients) {
        if (client.url === clickAction && "focus" in client) {
          return client.focus();
        }
      }
      // If no window/tab is open, open a new one
      if (clients.openWindow) {
        return clients.openWindow(clickAction);
      }
    })
  );
});