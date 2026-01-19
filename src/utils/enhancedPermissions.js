import { db } from '../firebase';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';

/**
 * Enhanced permission system with granular access control
 * Supports both module-level, role-based, and user-specific permissions
 */

/**
 * Check if a user has permission for a specific module and action
 * Enhanced version with resource-specific and user-specific permissions
 * @param {Object} user - The user object
 * @param {string} churchId - The church ID
 * @param {string} module - The module to check (e.g., 'forms')
 * @param {string} action - The action to check ('create', 'read', 'update', 'delete', 'manage', 'export')
 * @param {string} resourceId - Optional: specific resource ID (e.g., form ID, inventory item ID)
 * @param {string} resourceType - Optional: type of resource ('form', 'inventory', 'category', 'gallery')
 * @returns {Promise<boolean>} - Whether the user has permission
 */
export const hasPermission = async (user, churchId, module, action, resourceId = null, resourceType = null) => {
  if (!user) return false;

  // Global admins have access to everything
  if (user.role === 'global_admin') return true;

  // Check if user is a basic admin (for backward compatibility)
  if (user.role === 'admin') return true;

  try {
    // First check user-specific permissions if checking a specific resource
    if (resourceId && resourceType) {
      const userSpecificPermission = await checkUserSpecificPermission(user, churchId, module, action, resourceId, resourceType);
      if (userSpecificPermission !== null) {
        return userSpecificPermission;
      }
    }

    const userRole = user.customRole || user.role;
    
    // Check if it's a system role
    if (userRole === 'member' || userRole === 'admin' || userRole === 'global_admin') {
      // Use system role logic
      const hasModulePermission = await checkSystemRolePermission(userRole, module, action);
      
      // If user has module permission but we're checking specific resource
      if (hasModulePermission && resourceId && resourceType) {
        return await checkResourceSpecificPermission(user, churchId, module, action, resourceId, resourceType);
      }
      
      return hasModulePermission;
    }

    // Check custom role from database
    const rolesQuery = query(
      collection(db, 'roles'),
      where('churchId', '==', churchId),
      where('name', '==', userRole)
    );
    
    const rolesSnapshot = await getDocs(rolesQuery);
    
    if (rolesSnapshot.empty) {
      console.warn(`Role ${userRole} not found for church ${churchId}`);
      return false;
    }

    const roleDoc = rolesSnapshot.docs[0];
    const roleData = roleDoc.data();
    
    // Check module-level permissions first
    const hasModulePermission = checkModulePermission(roleData, module, action);
    
    // If no module permission, deny immediately
    if (!hasModulePermission) return false;
    
    // If checking specific resource and user has module permission
    if (resourceId && resourceType) {
      return await checkResourceSpecificPermission(user, churchId, module, action, resourceId, resourceType, roleData);
    }
    
    return hasModulePermission;

  } catch (error) {
    console.error('Error checking permissions:', error);
    return false;
  }
};

/**
 * Check user-specific permissions
 * These override role-based permissions for specific resources
 */
const checkUserSpecificPermission = async (user, churchId, module, action, resourceId, resourceType) => {
  try {
    const userPermDoc = await getDoc(doc(db, 'userSpecificPermissions', `${user.uid}_${churchId}`));
    
    if (!userPermDoc.exists()) {
      return null; // No user-specific permissions, fall back to role-based
    }

    const userData = userPermDoc.data();
    const userPermissions = userData.permissions || {};
    
    // Check if user has specific permission for this resource
    const resourcePermissions = userPermissions[resourceType];
    if (!resourcePermissions || !resourcePermissions[resourceId]) {
      return null; // No specific permission for this resource, fall back to role-based
    }

    const specificPermission = resourcePermissions[resourceId][action];
    return specificPermission === true;

  } catch (error) {
    console.error('Error checking user-specific permissions:', error);
    return null; // Fall back to role-based permissions on error
  }
};

/**
 * Check module-level permission from role data
 */
const checkModulePermission = (roleData, module, action) => {
  if (!roleData.permissions || !roleData.permissions[module]) {
    return false;
  }

  const modulePermissions = roleData.permissions[module];
  
  // Check if the action is explicitly denied
  if (modulePermissions[action] === 'deny') {
    return false;
  }

  // Check if the action is allowed
  return modulePermissions[action] === true;
};

/**
 * Check resource-specific permissions
 * This checks if user has access to specific forms, inventory items, etc.
 */
const checkResourceSpecificPermission = async (user, churchId, module, action, resourceId, resourceType, roleData = null) => {
  try {
    // If no role data provided, fetch it
    if (!roleData) {
      const userRole = user.customRole || user.role;
      const rolesQuery = query(
        collection(db, 'roles'),
        where('churchId', '==', churchId),
        where('name', '==', userRole)
      );
      
      const rolesSnapshot = await getDocs(rolesQuery);
      if (rolesSnapshot.empty) return false;
      
      roleData = rolesSnapshot.docs[0].data();
    }

    // Check if role has resource-specific permissions defined
    const resourcePermissions = roleData.resourcePermissions;
    if (!resourcePermissions) {
      // If no specific resource permissions, default to module permission
      return true;
    }

    // Check specific resource type permissions
    const resourceTypePermissions = resourcePermissions[resourceType];
    if (!resourceTypePermissions) {
      // If no permissions for this resource type, default to module permission
      return true;
    }

    // Check if it's a whitelist or blacklist approach
    if (resourceTypePermissions.accessType === 'whitelist') {
      // Only allow access to specifically listed resources
      const allowedResources = resourceTypePermissions.allowedResources || [];
      return allowedResources.includes(resourceId);
    } else if (resourceTypePermissions.accessType === 'blacklist') {
      // Allow access to all except specifically denied resources
      const deniedResources = resourceTypePermissions.deniedResources || [];
      return !deniedResources.includes(resourceId);
    } else if (resourceTypePermissions.accessType === 'specific') {
      // Check specific resource permissions
      const specificPermissions = resourceTypePermissions.specific || {};
      const resourcePermission = specificPermissions[resourceId];
      
      if (!resourcePermission) {
        // If resource not specifically mentioned, deny access
        return false;
      }
      
      // Check if action is allowed for this specific resource
      return resourcePermission[action] === true;
    }

    // Default to allowing if no specific restrictions
    return true;

  } catch (error) {
    console.error('Error checking resource-specific permissions:', error);
    return false;
  }
};

/**
 * Check system role permissions (built-in roles)
 */
const checkSystemRolePermission = async (role, module, action) => {
  // Global admin has everything
  if (role === 'global_admin') return true;
  
  // Admin has most things
  if (role === 'admin') {
    // Admins can do everything except for global admin specific modules
    const globalOnlyModules = ['userassignment']; // Add modules that only global admins should access
    if (globalOnlyModules.includes(module)) return false;
    return true;
  }

  // Member role permissions
  if (role === 'member') {
    const memberReadOnlyModules = [
      'courses', 'allevents', 'events', 'members', 'chat', 'directory', 
      'info', 'articles', 'bible', 'contact', 'gallery', 'media', 
      'video', 'audio', 'pdf', 'groups', 'miperfil', 'profile', 'search',
      'sobre', 'family', 'churchapp'
    ];
    
    const memberLimitedModules = [
      'eventregistration', 'membermessaging', 'userresponselog', 
      'usercourseprogresss', 'miperfil', 'profile', 'timetracker'
    ];
    
    const memberDeniedModules = [
      'admin', 'rolemanager', 'userassignment', 'miorganizacion',
      'courseadmin', 'mediaadmin', 'galleryadmin', 'galleryupload',
      'balance', 'finances', 'invoices', 'messagebalance',
      'businessintelligence', 'userdashboard', 'assistentepastoral',
      'leadershipdevelopment', 'leadershiprecommendations',
      'adminconnect', 'connectioncenter', 'visitormessages', 'visitordetails',
      'managegroups', 'createteam', 'teamdetail', 'maintenance',
      'inventory', 'inventorydetail', 'rooms', 'roomreservations',
      'broadcast', 'broadcastview', 'socialmedia', 'socialmediaaccounts',
      'buildmychurch', 'leica', 'process', 'forms'
    ];

    // Check denied modules
    if (memberDeniedModules.includes(module)) return false;

    // Check read-only modules
    if (memberReadOnlyModules.includes(module)) {
      return action === 'read';
    }

    // Check limited modules
    if (memberLimitedModules.includes(module)) {
      return ['create', 'read', 'update'].includes(action);
    }

    // Default deny for members
    return false;
  }

  return false;
};

/**
 * Check if user has access to a specific form
 * @param {Object} user - The user object
 * @param {string} churchId - The church ID
 * @param {string} formId - The form ID to check
 * @param {string} action - The action to check
 * @returns {Promise<boolean>} - Whether the user has access to the form
 */
export const hasFormPermission = async (user, churchId, formId, action = 'read') => {
  return await hasPermission(user, churchId, 'forms', action, formId, 'form');
};

/**
 * Check if user has access to a specific inventory item
 * @param {Object} user - The user object
 * @param {string} churchId - The church ID
 * @param {string} inventoryId - The inventory item ID to check
 * @param {string} action - The action to check
 * @returns {Promise<boolean>} - Whether the user has access to the inventory item
 */
export const hasInventoryPermission = async (user, churchId, inventoryId, action = 'read') => {
  return await hasPermission(user, churchId, 'inventory', action, inventoryId, 'inventory');
};

/**
 * Check if user has access to a specific course category
 * @param {Object} user - The user object
 * @param {string} churchId - The church ID
 * @param {string} categoryId - The category ID to check
 * @param {string} action - The action to check
 * @returns {Promise<boolean>} - Whether the user has access to the category
 */
export const hasCategoryPermission = async (user, churchId, categoryId, action = 'read') => {
  return await hasPermission(user, churchId, 'coursecategories', action, categoryId, 'category');
};

/**
 * Check if user has access to a specific gallery
 * @param {Object} user - The user object
 * @param {string} churchId - The church ID
 * @param {string} galleryId - The gallery ID to check
 * @param {string} action - The action to check
 * @returns {Promise<boolean>} - Whether the user has access to the gallery
 */
export const hasGalleryPermission = async (user, churchId, galleryId, action = 'read') => {
  return await hasPermission(user, churchId, 'gallery', action, galleryId, 'gallery');
};

/**
 * Get all forms user has access to
 * @param {Object} user - The user object
 * @param {string} churchId - The church ID
 * @returns {Promise<Array>} - Array of form IDs the user can access
 */
export const getUserAccessibleForms = async (user, churchId) => {
  try {
    // Get all forms for the church
    const formsQuery = query(
      collection(db, `churches/${churchId}/forms`)
    );
    const formsSnapshot = await getDocs(formsQuery);
    
    const accessibleForms = [];
    
    for (const formDoc of formsSnapshot.docs) {
      const formId = formDoc.id;
      if (await hasFormPermission(user, churchId, formId, 'read')) {
        accessibleForms.push({
          id: formId,
          ...formDoc.data()
        });
      }
    }
    
    return accessibleForms;
  } catch (error) {
    console.error('Error getting accessible forms:', error);
    return [];
  }
};

/**
 * Get all inventory items user has access to
 * @param {Object} user - The user object
 * @param {string} churchId - The church ID
 * @returns {Promise<Array>} - Array of inventory items the user can access
 */
export const getUserAccessibleInventory = async (user, churchId) => {
  try {
    // Get all inventory items for the church
    const inventoryQuery = query(
      collection(db, 'inventory'),
      where('churchId', '==', churchId)
    );
    const inventorySnapshot = await getDocs(inventoryQuery);
    
    const accessibleInventory = [];
    
    for (const inventoryDoc of inventorySnapshot.docs) {
      const inventoryId = inventoryDoc.id;
      if (await hasInventoryPermission(user, churchId, inventoryId, 'read')) {
        accessibleInventory.push({
          id: inventoryId,
          ...inventoryDoc.data()
        });
      }
    }
    
    return accessibleInventory;
  } catch (error) {
    console.error('Error getting accessible inventory:', error);
    return [];
  }
};

/**
 * Legacy compatibility - keep existing functions
 */
export const canAccessModule = async (user, churchId, module) => {
  return await hasPermission(user, churchId, module, 'read');
};

export const canManageModule = async (user, churchId, module) => {
  const canCreate = await hasPermission(user, churchId, module, 'create');
  const canUpdate = await hasPermission(user, churchId, module, 'update');
  const canDelete = await hasPermission(user, churchId, module, 'delete');
  
  return canCreate && canUpdate && canDelete;
};

export const getUserAccessibleModules = async (user, churchId) => {
  const allModules = [
    'admin', 'rolemanager', 'userassignment', 'miorganizacion',
    'forms', 'courses', 'allevents', 'events', 'members', 'chat',
    'directory', 'gallery', 'media', 'groups', 'balance', 'finances',
    'inventory', 'coursecategories', 'timetracker'
  ];

  const accessibleModules = [];
  
  for (const module of allModules) {
    if (await canAccessModule(user, churchId, module)) {
      accessibleModules.push(module);
    }
  }

  return accessibleModules;
};
