import React from 'react';
import { createRoot } from 'react-dom/client';
import './firebase'; // Import firebase initialization first
import './index.css';
import './styles/responsive.css'; // Global responsive styles
import './styles/banner.responsive.css'; // Banner responsive fixes
import App from './App';
import { auth } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';

// Register Service Worker for aggressive caching
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('Service Worker registered:', registration);
      })
      .catch((error) => {
        console.log('Service Worker registration failed:', error);
      });
  });
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