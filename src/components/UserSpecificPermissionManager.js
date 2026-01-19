import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { 
  collection, 
  getDocs, 
  query, 
  where, 
  doc, 
  updateDoc,
  setDoc,
  getDoc
} from 'firebase/firestore';
import { toast } from 'react-toastify';
import './UserSpecificPermissionManager.css';

/**
 * User-Specific Permission Manager
 * Select a user and configure their access to specific resources
 */
const UserSpecificPermissionManager = ({ churchId, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [userPermissions, setUserPermissions] = useState({});
  const [availableResources, setAvailableResources] = useState({
    forms: [],
    inventory: [],
    categories: [],
    galleries: []
  });
  const [activeTab, setActiveTab] = useState('forms');

  useEffect(() => {
    loadUsers();
    loadAvailableResources();
  }, [churchId]);

  useEffect(() => {
    if (selectedUser) {
      loadUserPermissions();
    }
  }, [selectedUser]);

  const loadUsers = async () => {
    try {
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

      // Pattern 3: If still no users, try church-specific subcollection
      if (usersData.length === 0) {
        try {
          const churchUsersQuery = collection(db, `churches/${churchId}/users`);
          const churchUsersSnapshot = await getDocs(churchUsersQuery);
          usersData = churchUsersSnapshot.docs.map(doc => ({
            id: doc.id,
            uid: doc.id,
            ...doc.data()
          }));
          console.log('Found users in church subcollection:', usersData.length);
        } catch (error) {
          console.log('Church users subcollection query failed:', error);
        }
      }

      // Pattern 4: If still no users, try userassignments collection
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
    }
  };

  const loadAvailableResources = async () => {
    try {
      setLoading(true);

      // Load forms
      const formsQuery = query(collection(db, `churches/${churchId}/forms`));
      const formsSnapshot = await getDocs(formsQuery);
      const forms = formsSnapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().title || doc.data().name || 'Untitled Form',
        type: 'form',
        ...doc.data()
      }));

      // Load inventory items
      const inventoryQuery = query(
        collection(db, 'inventory'),
        where('churchId', '==', churchId)
      );
      const inventorySnapshot = await getDocs(inventoryQuery);
      const inventory = inventorySnapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name || doc.data().item || 'Untitled Item',
        type: 'inventory',
        ...doc.data()
      }));

      // Load course categories
      const categoriesQuery = query(
        collection(db, 'coursecategories'),
        where('churchId', '==', churchId)
      );
      const categoriesSnapshot = await getDocs(categoriesQuery);
      const categories = categoriesSnapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name || doc.data().title || 'Untitled Category',
        type: 'category',
        ...doc.data()
      }));

      // Load galleries
      const galleriesQuery = query(
        collection(db, 'gallery_new'),
        where('idIglesia', '==', churchId)
      );
      const galleriesSnapshot = await getDocs(galleriesQuery);
      const galleries = galleriesSnapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name || doc.data().title || 'Untitled Gallery',
        type: 'gallery',
        ...doc.data()
      }));

      setAvailableResources({
        forms,
        inventory,
        categories,
        galleries
      });
    } catch (error) {
      console.error('Error loading resources:', error);
      toast.error('Error loading available resources');
    } finally {
      setLoading(false);
    }
  };

  const loadUserPermissions = async () => {
    try {
      // Load user's specific permissions
      const userPermDoc = await getDoc(doc(db, 'userSpecificPermissions', `${selectedUser.id}_${churchId}`));
      
      if (userPermDoc.exists()) {
        setUserPermissions(userPermDoc.data().permissions || {});
      } else {
        setUserPermissions({});
      }
    } catch (error) {
      console.error('Error loading user permissions:', error);
      setUserPermissions({});
    }
  };

  const handleUserSelect = (user) => {
    setSelectedUser(user);
    setUserPermissions({});
  };

  const handleResourcePermissionChange = (resourceType, resourceId, action, isAllowed) => {
    setUserPermissions(prev => ({
      ...prev,
      [resourceType]: {
        ...prev[resourceType],
        [resourceId]: {
          ...prev[resourceType]?.[resourceId],
          [action]: isAllowed
        }
      }
    }));
  };

  const handleResourceToggle = (resourceType, resourceId, hasAccess) => {
    setUserPermissions(prev => ({
      ...prev,
      [resourceType]: {
        ...prev[resourceType],
        [resourceId]: hasAccess ? {
          create: true,
          read: true,
          update: true,
          delete: false
        } : undefined
      }
    }));
  };

  const saveUserPermissions = async () => {
    try {
      if (!selectedUser) {
        toast.error('Please select a user first');
        return;
      }

      const userPermRef = doc(db, 'userSpecificPermissions', `${selectedUser.id}_${churchId}`);
      await setDoc(userPermRef, {
        userId: selectedUser.id,
        churchId: churchId,
        userName: selectedUser.displayName || selectedUser.email,
        permissions: userPermissions,
        lastUpdated: new Date()
      }, { merge: true });

      toast.success('User permissions saved successfully');
    } catch (error) {
      console.error('Error saving user permissions:', error);
      toast.error('Error saving permissions');
    }
  };

  const getUserResourcePermission = (resourceType, resourceId, action) => {
    return userPermissions[resourceType]?.[resourceId]?.[action] || false;
  };

  const hasResourceAccess = (resourceType, resourceId) => {
    const resourcePerms = userPermissions[resourceType]?.[resourceId];
    return resourcePerms && Object.values(resourcePerms).some(Boolean);
  };

  const actions = ['create', 'read', 'update', 'delete'];

  if (loading) {
    return (
      <div className="usperm-loading">
        <div className="loading-spinner"></div>
        <p>Loading users and resources...</p>
      </div>
    );
  }

  return (
    <div className="user-specific-permission-manager">
      <div className="usperm-header">
        <h2>User-Specific Permissions</h2>
        <p>Select a user and configure their access to specific resources</p>
        <div className="header-actions">
          <button 
            className="debug-btn"
            onClick={() => {
              console.log('Current users:', users);
              console.log('Church ID:', churchId);
              console.log('Loading state:', loading);
            }}
          >
            🐛 Debug
          </button>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>
      </div>

      <div className="usperm-content">
        
        {/* User Selection Panel */}
        <div className="user-selection-panel">
          <h3>Select User</h3>
          <div className="users-list">
            {users.length > 0 ? (
              users.map(user => (
                <div 
                  key={user.id} 
                  className={`user-item ${selectedUser?.id === user.id ? 'selected' : ''}`}
                  onClick={() => handleUserSelect(user)}
                >
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
              ))
            ) : (
              <div className="no-users-found">
                <h4>No Users Found</h4>
                <p>Church ID: {churchId}</p>
                <p>Loading: {loading ? 'Yes' : 'No'}</p>
                <p>Try checking the debug console for more information.</p>
                <button 
                  onClick={loadUsers}
                  className="retry-btn"
                >
                  🔄 Retry Loading Users
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Permissions Configuration Panel */}
        {selectedUser && (
          <div className="permissions-panel">
            <div className="selected-user-info">
              <h3>Configuring Permissions for:</h3>
              <div className="selected-user-card">
                <div className="user-avatar">
                  {selectedUser.photoURL ? (
                    <img src={selectedUser.photoURL} alt={selectedUser.displayName} />
                  ) : (
                    <div className="avatar-placeholder">
                      {(selectedUser.displayName || selectedUser.email || 'U')[0].toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="user-details">
                  <div className="user-name">{selectedUser.displayName || 'No Name'}</div>
                  <div className="user-email">{selectedUser.email}</div>
                  <div className="user-role">Current Role: {selectedUser.role || 'No Role'}</div>
                </div>
              </div>
            </div>

            {/* Resource Type Tabs */}
            <div className="resource-tabs">
              {Object.entries(availableResources).map(([type, resources]) => (
                <button
                  key={type}
                  className={`tab-btn ${activeTab === type ? 'active' : ''}`}
                  onClick={() => setActiveTab(type)}
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)} ({resources.length})
                </button>
              ))}
            </div>

            {/* Resources List */}
            <div className="resources-permission-list">
              {availableResources[activeTab]?.map(resource => (
                <div key={resource.id} className="resource-permission-item">
                  <div className="resource-header">
                    <div className="resource-info">
                      <div className="resource-name">{resource.name}</div>
                      <div className="resource-id">ID: {resource.id}</div>
                    </div>
                    <div className="resource-toggle">
                      <label className="toggle-switch">
                        <input 
                          type="checkbox"
                          checked={hasResourceAccess(activeTab, resource.id)}
                          onChange={(e) => handleResourceToggle(activeTab, resource.id, e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                      </label>
                      <span className="toggle-label">
                        {hasResourceAccess(activeTab, resource.id) ? 'Access Granted' : 'No Access'}
                      </span>
                    </div>
                  </div>

                  {hasResourceAccess(activeTab, resource.id) && (
                    <div className="permission-details">
                      <div className="permission-actions">
                        {actions.map(action => (
                          <label key={action} className="permission-checkbox">
                            <input 
                              type="checkbox"
                              checked={getUserResourcePermission(activeTab, resource.id, action)}
                              onChange={(e) => handleResourcePermissionChange(
                                activeTab, 
                                resource.id, 
                                action, 
                                e.target.checked
                              )}
                            />
                            <span className="action-label">{action}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {availableResources[activeTab]?.length === 0 && (
                <div className="no-resources">
                  No {activeTab} found for this church.
                </div>
              )}
            </div>

            <div className="save-actions">
              <button className="btn btn-primary" onClick={saveUserPermissions}>
                💾 Save User Permissions
              </button>
            </div>
          </div>
        )}

        {!selectedUser && (
          <div className="no-user-selected">
            <div className="placeholder-content">
              <h3>👈 Select a user to configure permissions</h3>
              <p>Choose a user from the list to start configuring their specific access to forms, inventory, categories, and galleries.</p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default UserSpecificPermissionManager;
