import { createContext, useContext, useState, useEffect } from 'react';
import { auth, db, storage } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { getDownloadURL, ref } from 'firebase/storage';
import { signOut, getIdTokenResult } from 'firebase/auth';

const AuthContext = createContext();

const isPermissionDeniedError = (error) =>
  error?.code === 'permission-denied' ||
  error?.code === 'firestore/permission-denied';

const isGenericCustomRoleValue = (value) => {
  const normalizedValue = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  return ['custom role', 'custom', 'role'].includes(normalizedValue);
};

const resolveUserRoleKey = (userData = {}) => {
  const roleCandidates = [
    userData?.customRoleId,
    userData?.customRole,
    userData?.assignedRoleId,
    userData?.role,
  ];

  const concreteRole = roleCandidates.find((value) => {
    const trimmedValue = String(value || '').trim();
    return trimmedValue && !isGenericCustomRoleValue(trimmedValue);
  });

  if (concreteRole) {
    return String(concreteRole).trim();
  }

  const fallbackRole = roleCandidates.find((value) => String(value || '').trim());
  return fallbackRole ? String(fallbackRole).trim() : null;
};

const resolveBaseRole = (userData = {}, fallbackRole = null) => {
  const normalizedBaseRole = String(
    userData?.baseRole
    || userData?.basedOn
    || userData?.roleBase
    || userData?.systemRole
    || ''
  ).trim().toLowerCase();

  if (['global_admin', 'admin', 'member'].includes(normalizedBaseRole)) {
    return normalizedBaseRole;
  }

  const normalizedFallbackRole = String(fallbackRole || '').trim().toLowerCase();
  if (['global_admin', 'admin', 'member'].includes(normalizedFallbackRole)) {
    return normalizedFallbackRole;
  }

  return 'member';
};

const buildFallbackUser = async (firebaseUser) => {
  const tokenResult = await getIdTokenResult(firebaseUser).catch(() => null);
  const storedChurchId = localStorage.getItem('userChurchId');
  const fallbackRole = tokenResult?.claims?.role || localStorage.getItem('userRole') || null;

  return {
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    role: fallbackRole,
    baseRole: resolveBaseRole({}, fallbackRole),
    churchId: storedChurchId || null,
  };
};

const loadUserProfile = async (firebaseUser) => {
  const userRef = doc(db, 'users', firebaseUser.uid);

  try {
    return await getDoc(userRef);
  } catch (error) {
    if (!isPermissionDeniedError(error)) {
      throw error;
    }

    await firebaseUser.getIdToken(true);
    return getDoc(userRef);
  }
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (firebaseUser) => {
      setLoading(true);

      if (firebaseUser) {
        try {
          const userDoc = await loadUserProfile(firebaseUser);
          
          if (userDoc.exists()) {
            const userData = userDoc.data();
            const resolvedRole = resolveUserRoleKey(userData);

            setUser({
              ...userData,
              uid: firebaseUser.uid,
              role: resolvedRole,
              baseRole: resolveBaseRole(userData, resolvedRole),
            });

            localStorage.setItem("userId", firebaseUser.uid);
            if (resolvedRole) {
              localStorage.setItem("userRole", resolvedRole);
            }
            if (userData?.churchId) {
              localStorage.setItem("userChurchId", String(userData.churchId));
            }
          } else {
            setUser(await buildFallbackUser(firebaseUser));

            localStorage.setItem("userId", firebaseUser.uid);
          }

          setAuthError(null);
        } catch (error) {
          if (isPermissionDeniedError(error)) {
            console.warn('AuthContext - User profile read denied, using fallback auth state.');
          } else {
            console.error('AuthContext - Error fetching user data:', error);
          }

          // Don't block on error - set user with best-effort role fallback
          setUser(await buildFallbackUser(firebaseUser));
          localStorage.setItem("userId", firebaseUser.uid);
          setAuthError(null);
        }
      } else {
        setUser(null);
        setAuthError(null);
      }
      setLoading(false);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Helper functions for role checks
  const isAdmin = () => user?.role === 'admin' || user?.role === 'global_admin';
  const isGlobalAdmin = () => user?.role === 'global_admin';

  // Logout function
  const logout = async () => {
    try {
      await signOut(auth);
      setUser(null);
      localStorage.removeItem("userId");
      localStorage.removeItem("userRole");
      localStorage.removeItem("userChurchId");
    } catch (error) {
      console.error('Logout error:', error);
      throw error;
    }
  };

  const value = {
    user,
    loading,
    authError,
    isAdmin,
    isGlobalAdmin,
    logout
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