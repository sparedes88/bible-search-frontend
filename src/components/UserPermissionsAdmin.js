import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { 
  collection, 
  getDocs, 
  query, 
  where,
  doc,
  updateDoc,
  getDoc
} from 'firebase/firestore';
import { toast } from 'react-toastify';
import ChurchHeader from './ChurchHeader';
import UserSpecificPermissionManager from './UserSpecificPermissionManager';
import { hasPermission } from '../utils/enhancedPermissions';
import './UserPermissionsAdmin.css';

/**
 * Admin interface for managing user permissions
 * Integrates user selection with permission management
 */
const UserPermissionsAdmin = () => {
  const { id: churchId } = useParams();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [userPermissions, setUserPermissions] = useState([]);
  const [showPermissionManager, setShowPermissionManager] = useState(false);
  const [canManagePermissions, setCanManagePermissions] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    checkAdminPermissions();
    loadUsers();
    loadUserPermissions();
  }, [churchId, user]);

  const checkAdminPermissions = async () => {
    if (!user) return;
    
    const canManage = await hasPermission(user, churchId, 'userassignment', 'manage') ||
                     user.role === 'admin' || 
                     user.role === 'global_admin';
    
    setCanManagePermissions(canManage);
  };

  const loadUsers = async () => {
    try {
      setLoading(true);
      console.log('Loading users for church:', churchId);
      let usersData = [];

      // Try multiple user collection patterns
      try {
        // Pattern 1: users collection with churchId field
        const usersQuery = query(
          collection(db, 'users'),
          where('churchId', '==', churchId)
        );
        const usersSnapshot = await getDocs(usersQuery);
        usersData = usersSnapshot.docs.map(doc => ({
          id: doc.id,
          uid: doc.id, // Ensure uid is set
          ...doc.data()
        }));
        console.log('Found users in users collection:', usersData.length);
      } catch (error) {
        console.log('Users collection query failed:', error);
      }

      // Pattern 2: If no users found, try members collection
      if (usersData.length === 0) {
        try {
          const membersQuery = query(
            collection(db, 'members'),
            where('churchId', '==', churchId)
          );
          const membersSnapshot = await getDocs(membersQuery);
          usersData = membersSnapshot.docs.map(doc => ({
            id: doc.id,
            uid: doc.id,
            displayName: doc.data().name || doc.data().displayName,
            email: doc.data().email,
            role: doc.data().role,
            ...doc.data()
          }));
          console.log('Found users in members collection:', usersData.length);
        } catch (error) {
          console.log('Members collection query failed:', error);
        }
      }

      // Pattern 3: If still no users, try userassignments collection
      if (usersData.length === 0) {
        try {
          const assignmentsQuery = query(
            collection(db, 'userassignments'),
            where('churchId', '==', churchId)
          );
          const assignmentsSnapshot = await getDocs(assignmentsQuery);
          
          // Get unique user IDs from assignments
          const userIds = [...new Set(assignmentsSnapshot.docs.map(doc => doc.data().userId))];
          console.log('Found user assignments for users:', userIds.length);
          
          // Fetch user details for each assigned user
          for (const userId of userIds) {
            try {
              const userDoc = await getDoc(doc(db, 'users', userId));
              if (userDoc.exists()) {
                usersData.push({
                  id: userId,
                  uid: userId,
                  ...userDoc.data()
                });
              }
            } catch (err) {
              console.log('Error fetching user details for:', userId, err);
            }
          }
          console.log('Loaded user details from assignments:', usersData.length);
        } catch (error) {
          console.log('User assignments query failed:', error);
        }
      }

      // Filter out any invalid users and ensure required fields
      const validUsers = usersData.filter(user => 
        user.id && (user.email || user.displayName)
      ).map(user => ({
        ...user,
        displayName: user.displayName || user.name || 'Unknown User',
        email: user.email || 'No email',
        role: user.role || user.customRole || 'member'
      }));

      console.log('Final valid users:', validUsers.length);
      setUsers(validUsers);
    } catch (error) {
      console.error('Error loading users:', error);
      toast.error('Error loading users');
    } finally {
      setLoading(false);
    }
  };

  const loadUserPermissions = async () => {
    try {
      // Load user-specific permissions
      const permissionsQuery = query(
        collection(db, 'userSpecificPermissions'),
        where('churchId', '==', churchId)
      );
      const permissionsSnapshot = await getDocs(permissionsQuery);
      
      const permissionsData = permissionsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setUserPermissions(permissionsData);
    } catch (error) {
      console.error('Error loading user permissions:', error);
    }
  };

  const handleOpenPermissionManager = () => {
    if (!canManagePermissions) {
      toast.error('You do not have permission to manage user permissions');
      return;
    }
    setShowPermissionManager(true);
  };

  const handleClosePermissionManager = () => {
    setShowPermissionManager(false);
    loadUserPermissions(); // Refresh the permissions list
  };

  const getUserPermissionSummary = (userId) => {
    const userPerm = userPermissions.find(p => p.userId === userId);
    if (!userPerm || !userPerm.permissions) return null;

    let summary = [];
    Object.entries(userPerm.permissions).forEach(([resourceType, resources]) => {
      const count = Object.keys(resources).length;
      if (count > 0) {
        summary.push(`${count} ${resourceType}`);
      }
    });

    return summary.length > 0 ? summary.join(', ') : 'No specific permissions';
  };

  const filteredUsers = users.filter(user => 
    user.displayName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!canManagePermissions) {
    return (
      <div className="user-permissions-admin">
        <ChurchHeader />
        <div className="permission-denied">
          <h2>Access Denied</h2>
          <p>You do not have permission to manage user permissions.</p>
          <Link 
            to={`/organization/${churchId}/mi-organizacion`}
            style={{
              color: '#4f46e5',
              textDecoration: 'none',
              fontWeight: '500',
              display: 'inline-block',
              marginTop: '1rem'
            }}
          >
            ← Go Back to Mi Organización
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="user-permissions-admin">
        <ChurchHeader />
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading users...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="user-permissions-admin">
      <ChurchHeader />
      
      <div className="upa-content">
        <div className="upa-header">
          <div className="header-content">
            <h1>User Permissions Management</h1>
            <p>Configure specific access permissions for individual users</p>
          </div>
          <div className="header-actions">
            <button 
              className="btn btn-primary"
              onClick={handleOpenPermissionManager}
            >
              🎯 Configure User Permissions
            </button>
          </div>
        </div>

        <div className="upa-main">
          <div className="users-overview">
            <div className="overview-header">
              <h2>Users Overview</h2>
              <div className="search-box">
                <input
                  type="text"
                  placeholder="Search users..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                />
              </div>
            </div>

            <div className="users-grid">
              {filteredUsers.map(user => {
                const permissionSummary = getUserPermissionSummary(user.id);
                return (
                  <div key={user.id} className="user-overview-card">
                    <div className="user-card-header">
                      <div className="user-avatar">
                        {user.photoURL ? (
                          <img src={user.photoURL} alt={user.displayName} />
                        ) : (
                          <div className="avatar-placeholder">
                            {(user.displayName || user.email || 'U')[0].toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div className="user-info">
                        <div className="user-name">{user.displayName || 'No Name'}</div>
                        <div className="user-email">{user.email}</div>
                        <div className="user-role">{user.role || 'No Role'}</div>
                      </div>
                    </div>
                    
                    <div className="permission-summary">
                      <div className="summary-label">Specific Permissions:</div>
                      <div className="summary-content">
                        {permissionSummary || 'Using role-based permissions only'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {filteredUsers.length === 0 && (
              <div className="no-users">
                <h3>No users found</h3>
                <p>Try adjusting your search criteria.</p>
              </div>
            )}
          </div>

          <div className="permissions-summary">
            <h3>Permission Statistics</h3>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-number">{users.length}</div>
                <div className="stat-label">Total Users</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">{userPermissions.length}</div>
                <div className="stat-label">Users with Specific Permissions</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">
                  {userPermissions.reduce((total, perm) => 
                    total + Object.keys(perm.permissions || {}).length, 0
                  )}
                </div>
                <div className="stat-label">Total Resource Types Configured</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* User Permission Manager Modal */}
      {showPermissionManager && (
        <div className="modal-overlay">
          <div className="modal-content user-permission-modal">
            <UserSpecificPermissionManager
              churchId={churchId}
              onClose={handleClosePermissionManager}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default UserPermissionsAdmin;
