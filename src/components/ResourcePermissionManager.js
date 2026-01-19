import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { 
  collection, 
  getDocs, 
  query, 
  where, 
  doc, 
  updateDoc 
} from 'firebase/firestore';
import { toast } from 'react-toastify';
import './ResourcePermissionManager.css';

/**
 * Enhanced permission manager for specific resources
 * Allows granular control over forms, inventory, categories, galleries
 */
const ResourcePermissionManager = ({ roleId, churchId, onSave, onCancel }) => {
  const [loading, setLoading] = useState(true);
  const [roleData, setRoleData] = useState(null);
  const [availableResources, setAvailableResources] = useState({
    forms: [],
    inventory: [],
    categories: [],
    galleries: []
  });
  const [resourcePermissions, setResourcePermissions] = useState({});

  useEffect(() => {
    if (roleId && churchId) {
      loadRoleData();
      loadAvailableResources();
    }
  }, [roleId, churchId]);

  const loadRoleData = async () => {
    try {
      const roleDoc = await getDocs(query(
        collection(db, 'roles'),
        where('churchId', '==', churchId)
      ));
      
      const role = roleDoc.docs.find(doc => doc.id === roleId);
      if (role) {
        const data = role.data();
        setRoleData(data);
        setResourcePermissions(data.resourcePermissions || {});
      }
    } catch (error) {
      console.error('Error loading role data:', error);
      toast.error('Error loading role data');
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

  const handleAccessTypeChange = (resourceType, accessType) => {
    setResourcePermissions(prev => ({
      ...prev,
      [resourceType]: {
        ...prev[resourceType],
        accessType,
        allowedResources: accessType === 'whitelist' ? [] : undefined,
        deniedResources: accessType === 'blacklist' ? [] : undefined,
        specific: accessType === 'specific' ? {} : undefined
      }
    }));
  };

  const handleResourceToggle = (resourceType, resourceId, isAllowed) => {
    const current = resourcePermissions[resourceType] || {};
    
    if (current.accessType === 'whitelist') {
      const allowedResources = current.allowedResources || [];
      setResourcePermissions(prev => ({
        ...prev,
        [resourceType]: {
          ...current,
          allowedResources: isAllowed 
            ? [...allowedResources, resourceId]
            : allowedResources.filter(id => id !== resourceId)
        }
      }));
    } else if (current.accessType === 'blacklist') {
      const deniedResources = current.deniedResources || [];
      setResourcePermissions(prev => ({
        ...prev,
        [resourceType]: {
          ...current,
          deniedResources: isAllowed 
            ? deniedResources.filter(id => id !== resourceId)
            : [...deniedResources, resourceId]
        }
      }));
    }
  };

  const handleSpecificPermissionChange = (resourceType, resourceId, action, isAllowed) => {
    const current = resourcePermissions[resourceType] || {};
    const specific = current.specific || {};
    const resourcePerms = specific[resourceId] || {};

    setResourcePermissions(prev => ({
      ...prev,
      [resourceType]: {
        ...current,
        specific: {
          ...specific,
          [resourceId]: {
            ...resourcePerms,
            [action]: isAllowed
          }
        }
      }
    }));
  };

  const savePermissions = async () => {
    try {
      const roleRef = doc(db, 'roles', roleId);
      await updateDoc(roleRef, {
        resourcePermissions,
        lastUpdated: new Date()
      });
      
      toast.success('Resource permissions updated successfully');
      onSave();
    } catch (error) {
      console.error('Error saving permissions:', error);
      toast.error('Error saving permissions');
    }
  };

  const isResourceAllowed = (resourceType, resourceId) => {
    const perms = resourcePermissions[resourceType];
    if (!perms) return false;

    if (perms.accessType === 'whitelist') {
      return (perms.allowedResources || []).includes(resourceId);
    } else if (perms.accessType === 'blacklist') {
      return !(perms.deniedResources || []).includes(resourceId);
    }
    return false;
  };

  const getSpecificPermission = (resourceType, resourceId, action) => {
    const perms = resourcePermissions[resourceType];
    if (!perms || perms.accessType !== 'specific') return false;
    
    const specific = perms.specific || {};
    const resourcePerms = specific[resourceId] || {};
    return resourcePerms[action] || false;
  };

  const actions = ['create', 'read', 'update', 'delete'];

  if (loading) {
    return (
      <div className="resource-permission-loading">
        <div className="loading-spinner"></div>
        <p>Loading resources...</p>
      </div>
    );
  }

  return (
    <div className="resource-permission-manager">
      <div className="rpm-header">
        <h3>Resource-Specific Permissions</h3>
        <p>Configure access to specific forms, inventory items, categories, and galleries</p>
      </div>

      {Object.entries(availableResources).map(([resourceType, resources]) => (
        <div key={resourceType} className="resource-section">
          <h4 className="resource-title">
            {resourceType.charAt(0).toUpperCase() + resourceType.slice(1)} 
            <span className="resource-count">({resources.length})</span>
          </h4>

          <div className="access-type-selector">
            <label>Access Type:</label>
            <div className="radio-group">
              <label>
                <input 
                  type="radio" 
                  name={`${resourceType}-access`}
                  value="full"
                  checked={!resourcePermissions[resourceType]?.accessType}
                  onChange={() => handleAccessTypeChange(resourceType, null)}
                />
                Full Module Access
              </label>
              <label>
                <input 
                  type="radio" 
                  name={`${resourceType}-access`}
                  value="whitelist"
                  checked={resourcePermissions[resourceType]?.accessType === 'whitelist'}
                  onChange={() => handleAccessTypeChange(resourceType, 'whitelist')}
                />
                Whitelist (Only Selected)
              </label>
              <label>
                <input 
                  type="radio" 
                  name={`${resourceType}-access`}
                  value="blacklist"
                  checked={resourcePermissions[resourceType]?.accessType === 'blacklist'}
                  onChange={() => handleAccessTypeChange(resourceType, 'blacklist')}
                />
                Blacklist (All Except Selected)
              </label>
              <label>
                <input 
                  type="radio" 
                  name={`${resourceType}-access`}
                  value="specific"
                  checked={resourcePermissions[resourceType]?.accessType === 'specific'}
                  onChange={() => handleAccessTypeChange(resourceType, 'specific')}
                />
                Specific Permissions
              </label>
            </div>
          </div>

          {resourcePermissions[resourceType]?.accessType && (
            <div className="resources-list">
              {resources.map(resource => (
                <div key={resource.id} className="resource-item">
                  <div className="resource-info">
                    <span className="resource-name">{resource.name}</span>
                    <span className="resource-id">ID: {resource.id}</span>
                  </div>

                  {(resourcePermissions[resourceType]?.accessType === 'whitelist' || 
                    resourcePermissions[resourceType]?.accessType === 'blacklist') && (
                    <div className="simple-toggle">
                      <label className="toggle-switch">
                        <input 
                          type="checkbox"
                          checked={isResourceAllowed(resourceType, resource.id)}
                          onChange={(e) => handleResourceToggle(resourceType, resource.id, e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                      </label>
                      <span className="toggle-label">
                        {resourcePermissions[resourceType]?.accessType === 'whitelist' ? 'Allow' : 'Deny'}
                      </span>
                    </div>
                  )}

                  {resourcePermissions[resourceType]?.accessType === 'specific' && (
                    <div className="specific-permissions">
                      {actions.map(action => (
                        <label key={action} className="permission-checkbox">
                          <input 
                            type="checkbox"
                            checked={getSpecificPermission(resourceType, resource.id, action)}
                            onChange={(e) => handleSpecificPermissionChange(
                              resourceType, 
                              resource.id, 
                              action, 
                              e.target.checked
                            )}
                          />
                          {action}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {resources.length === 0 && (
                <div className="no-resources">
                  No {resourceType} found for this church.
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      <div className="rpm-actions">
        <button className="btn btn-primary" onClick={savePermissions}>
          Save Permissions
        </button>
        <button className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
};

export default ResourcePermissionManager;
