import React from 'react';
import { createRoot } from 'react-dom/client';
import './firebase'; // Import firebase initialization first
import './index.css';
import './styles/responsive.css'; // Global responsive styles
import './styles/banner.responsive.css'; // Banner responsive fixes
import App from './App';
import { auth } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';

const clearDevelopmentServiceWorkers = async () => {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));

    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
    }

    console.log('Cleared development service workers and caches.');
  } catch (error) {
    console.warn('Failed to clear development service workers:', error);
  }
};

// Register Service Worker only in production to avoid dev request interference.
if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('Service Worker registered:', registration);
      })
      .catch((error) => {
        console.log('Service Worker registration failed:', error);
      });
  });
} else if (process.env.NODE_ENV !== 'production') {
  clearDevelopmentServiceWorkers();
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Failed to find the root element');
}
const root = createRoot(container);

// Render immediately without waiting for auth (non-blocking)
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Listen for auth state changes in background (non-blocking)
onAuthStateChanged(auth, (user) => {
  // Auth state will update through AuthContext, no need to re-render
});

// Remove this code from functions/index.js and move it to src/index.js