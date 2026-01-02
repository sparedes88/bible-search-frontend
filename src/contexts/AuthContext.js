import { createContext, useContext, useState, useEffect } from 'react';
import { auth, db, storage } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { getDownloadURL, ref } from 'firebase/storage';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    // Set loading to false quickly to show UI
    const timer = setTimeout(() => {
      setLoading(false);
    }, 500); // Max 500ms loading state

    const unsubscribe = auth.onAuthStateChanged(async (firebaseUser) => {
      if (firebaseUser) {
        try {
          // Load user data with timeout
          const userDocPromise = getDoc(doc(db, 'users', firebaseUser.uid));
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), 3000)
          );
          
          const userDoc = await Promise.race([userDocPromise, timeoutPromise]);
          
          if (userDoc.exists()) {
            const userData = userDoc.data();
            setUser({
              ...userData,
              uid: firebaseUser.uid,
            });
            localStorage.setItem("userId", firebaseUser.uid);
          }
          setAuthError(null);
        } catch (error) {
          console.error('AuthContext - Error fetching user data:', error);
          // Don't block on error - set user with minimal data
          setUser({
            uid: firebaseUser.uid,
            email: firebaseUser.email
          });
          setAuthError(null);
        }
      } else {
        setUser(null);
        setAuthError(null);
      }
      clearTimeout(timer);
      setLoading(false);
    });

    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  // Helper functions for role checks
  const isAdmin = () => user?.role === 'admin' || user?.role === 'global_admin';
  const isGlobalAdmin = () => user?.role === 'global_admin';

  const value = {
    user,
    loading,
    authError,
    isAdmin,
    isGlobalAdmin
  };

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh'
      }}>
        Loading authentication...
      </div>
    );
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}