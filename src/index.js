import React from 'react';
import { createRoot } from 'react-dom/client';
import './firebase'; // Import firebase initialization first
import './index.css';
import App from './App';
import { auth } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Failed to find the root element');
}
const root = createRoot(container);

// Listen for auth state changes
onAuthStateChanged(auth, (user) => {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});

// Remove this code from functions/index.js and move it to src/index.js