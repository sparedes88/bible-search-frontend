import { db } from '../firebase';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';

const LEGACY_MODULE_ID_ALIASES = {
  'conduit-run-counter': 'conduitruncounter',
  'time-tracker': 'timetracker',
};

const normalizePermissionModuleId = (module) => {
  const normalizedModule = String(module || '').trim();
  return LEGACY_MODULE_ID_ALIASES[normalizedModule] || normalizedModule;
};

const normalizeSystemRole = (role) => {
  switch (role) {
    case 'system_global_admin':
      return 'global_admin';
    case 'system_admin':
      return 'admin';
    case 'system_member':
      return 'member';
    default:
      return role;
  }
};

const getEffectiveBaseRole = (userData = {}) => {
  const baseRoleCandidate = String(
    userData?.baseRole
    || userData?.basedOn
    || userData?.roleBase
    || userData?.systemRole
    || userData?.role
    || 'member'
  ).trim();

  const normalizedBaseRole = normalizeSystemRole(baseRoleCandidate);
  return ['global_admin', 'admin', 'member'].includes(normalizedBaseRole)
    ? normalizedBaseRole
    : 'member';
};

const getRoleCandidates = (userData = {}) => {
  const values = [
    userData?.customRoleId,
    userData?.customRole,
    userData?.assignedRoleId,
    userData?.role,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  return Array.from(new Set(values));
};

const normalizeRoleLookupValue = (value) => String(value || '').trim().toLowerCase();

const roleBelongsToChurch = (roleData = {}, churchId) => {
  const targetChurchId = String(churchId || '').trim();
  if (!targetChurchId) return true;

  const scopedChurchId = String(
    roleData?.churchId
    || roleData?.churchID
    || roleData?.organizationId
    || roleData?.idIglesia
    || ''
  ).trim();

  if (!scopedChurchId) return true;
  return scopedChurchId === targetChurchId;
};

const resolveBaseRoleFromRoleData = (roleData = {}) => {
  const normalizedRole = getEffectiveBaseRole(roleData);
  return ['global_admin', 'admin', 'member'].includes(normalizedRole)
    ? normalizedRole
    : null;
};

const resolveEffectiveBaseRole = async (userData = {}, churchId = '') => {
  const directBaseRole = getEffectiveBaseRole(userData);
  if (directBaseRole !== 'member') {
    return directBaseRole;
  }

  const roleCandidates = getRoleCandidates(userData);
  if (roleCandidates.length === 0) {
    return directBaseRole;
  }

  // First try direct role document IDs.
  for (const candidate of roleCandidates) {
    try {
      const roleDoc = await getDoc(doc(db, 'roles', candidate));
      if (!roleDoc.exists()) continue;

      const roleData = roleDoc.data() || {};
      if (!roleBelongsToChurch(roleData, churchId)) continue;

      const resolvedBaseRole = resolveBaseRoleFromRoleData(roleData);
      if (resolvedBaseRole) {
        return resolvedBaseRole;
      }
    } catch (error) {
      console.warn('Error reading role document for permission resolution:', error);
    }
  }

  // Fallback: scan role docs scoped to this church and match by id/name aliases.
  try {
    const [byChurchIdSnapshot, byChurchIDSnapshot, byOrganizationIdSnapshot] = await Promise.all([
      getDocs(query(collection(db, 'roles'), where('churchId', '==', churchId))),
      getDocs(query(collection(db, 'roles'), where('churchID', '==', churchId))),
      getDocs(query(collection(db, 'roles'), where('organizationId', '==', churchId))),
    ]);

    const roleMap = new Map();
    [...byChurchIdSnapshot.docs, ...byChurchIDSnapshot.docs, ...byOrganizationIdSnapshot.docs].forEach((roleDoc) => {
      if (!roleMap.has(roleDoc.id)) {
        roleMap.set(roleDoc.id, roleDoc);
      }
    });

    const normalizedCandidates = new Set(roleCandidates.map((value) => normalizeRoleLookupValue(value)));

    for (const roleDoc of roleMap.values()) {
      const roleData = roleDoc.data() || {};

      const lookupValues = [
        roleDoc.id,
        roleData.name,
        roleData.roleName,
        roleData.title,
        roleData.displayName,
      ]
        .map((value) => normalizeRoleLookupValue(value))
        .filter(Boolean);

      const matchesCandidate = lookupValues.some((value) => normalizedCandidates.has(value));
      if (!matchesCandidate) continue;

      const resolvedBaseRole = resolveBaseRoleFromRoleData(roleData);
      if (resolvedBaseRole) {
        return resolvedBaseRole;
      }
    }
  } catch (error) {
    console.warn('Error resolving role base permissions from scoped role documents:', error);
  }

  return directBaseRole;
};

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

  const normalizedModule = normalizePermissionModuleId(module);

  const effectiveBaseRole = await resolveEffectiveBaseRole(user, churchId);

  // Global admins have access to everything
  if (effectiveBaseRole === 'global_admin') return true;

  // Check if user is a basic admin (for backward compatibility)
  if (effectiveBaseRole === 'admin') return true;

  try {
    // First check user-specific permissions if checking a specific resource
    if (resourceId && resourceType) {
      const userSpecificPermission = await checkUserSpecificPermission(user, churchId, normalizedModule, action, resourceId, resourceType);
      if (userSpecificPermission !== null) {
        return userSpecificPermission;
      }
    }

    const normalizedRole = effectiveBaseRole;
    
    // Check if it's a system role
    if (normalizedRole === 'member' || normalizedRole === 'admin' || normalizedRole === 'global_admin') {
      // Use system role logic
      const hasModulePermission = await checkSystemRolePermission(normalizedRole, normalizedModule, action);
      
      // If user has module permission but we're checking specific resource
      if (hasModulePermission && resourceId && resourceType) {
        return await checkResourceSpecificPermission(user, churchId, normalizedModule, action, resourceId, resourceType);
      }
      
      return hasModulePermission;
    }

    return false;

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
      const normalizedRole = await resolveEffectiveBaseRole(user, churchId);
      if (normalizedRole === 'member' || normalizedRole === 'admin' || normalizedRole === 'global_admin') {
        return true;
      }
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
      'usercourseprogresss', 'miperfil', 'profile', 'timetracker', 'conduitruncounter'
    ];
    
    const memberDeniedModules = [
      'admin', 'rolemanager', 'userassignment', 'miorganizacion',
      'courseadmin', 'mediaadmin', 'galleryadmin', 'galleryupload',
      'balance', 'budget', 'finances', 'invoices', 'messagebalance',
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
  const hasExplicitManage = await hasPermission(user, churchId, module, 'manage');
  if (hasExplicitManage) {
    return true;
  }

  const canCreate = await hasPermission(user, churchId, module, 'create');
  const canUpdate = await hasPermission(user, churchId, module, 'update');
  const canDelete = await hasPermission(user, churchId, module, 'delete');
  
  return canCreate && canUpdate && canDelete;
};

export const getUserAccessibleModules = async (user, churchId) => {
  const allModules = [
    'admin', 'rolemanager', 'userassignment', 'miorganizacion',
    'forms', 'courses', 'allevents', 'events', 'members', 'chat',
    'directory', 'gallery', 'media', 'groups', 'balance', 'budget', 'finances',
    'inventory', 'coursecategories', 'timetracker', 'conduitruncounter'
  ];

  const accessibleModules = [];
  
  for (const module of allModules) {
    if (await canAccessModule(user, churchId, module)) {
      accessibleModules.push(module);
    }
  }

  return accessibleModules;
};
