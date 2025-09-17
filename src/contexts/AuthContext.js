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
    const unsubscribe = auth.onAuthStateChanged(async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            // const fileRef = ref(storage, userData?.profileImg);
            // const downloadURL = await getDownloadURL(fileRef);
            setUser({
              ...userData,
              // profileImg: downloadURL,
              uid: firebaseUser.uid,
            });
            localStorage.setItem("userId", firebaseUser.uid);
          }
          setAuthError(null);
        } catch (error) {
          console.error('AuthContext - Error fetching user data:', error);
          setAuthError(error.message);
        }
      } else {
        setUser(null);
        setAuthError(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
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