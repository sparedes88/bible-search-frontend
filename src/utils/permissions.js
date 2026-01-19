import { db } from '../firebase';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';

/**
 * Check if a user has permission for a specific module and action
 * @param {Object} user - The user object
 * @param {string} churchId - The church ID
 * @param {string} module - The module to check (e.g., 'forms')
 * @param {string} action - The action to check ('create', 'read', 'update', 'delete', 'manage', 'export')
 * @returns {Promise<boolean>} - Whether the user has permission
 */
export const hasPermission = async (user, churchId, module, action) => {
  if (!user) return false;

  // Global admins have access to everything
  if (user.role === 'global_admin') return true;

  // Check if user is a basic admin (for backward compatibility)
  if (user.role === 'admin') return true;

  // For custom roles, check the role permissions
  try {
    const userRole = user.customRole || user.role;
    
    // Check if it's a system role
    if (userRole === 'member' || userRole === 'admin' || userRole === 'global_admin') {
      // Use system role logic
      return await checkSystemRolePermission(userRole, module, action);
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

  } catch (error) {
    console.error('Error checking permissions:', error);
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
 * Check if user can access a module (at least read permission)
 * @param {Object} user - The user object
 * @param {string} churchId - The church ID
 * @param {string} module - The module to check
 * @returns {Promise<boolean>} - Whether the user can access the module
 */
export const canAccessModule = async (user, churchId, module) => {
  return await hasPermission(user, churchId, module, 'read');
};

/**
 * Check if user can manage a module (create, update, delete permissions)
 * @param {Object} user - The user object
 * @param {string} churchId - The church ID
 * @param {string} module - The module to check
 * @returns {Promise<boolean>} - Whether the user can manage the module
 */
export const canManageModule = async (user, churchId, module) => {
  const canCreate = await hasPermission(user, churchId, module, 'create');
  const canUpdate = await hasPermission(user, churchId, module, 'update');
  const canDelete = await hasPermission(user, churchId, module, 'delete');
  
  return canCreate && canUpdate && canDelete;
};

/**
 * Get all modules a user has access to
 * @param {Object} user - The user object
 * @param {string} churchId - The church ID
 * @returns {Promise<Array>} - Array of module names the user can access
 */
export const getUserAccessibleModules = async (user, churchId) => {
  const allModules = [
    'admin', 'rolemanager', 'userassignment', 'miorganizacion',
    'forms', 'courses', 'allevents', 'events', 'members', 'chat',
    'directory', 'gallery', 'media', 'groups', 'balance', 'finances',
    'timetracker'
    // Add all your modules here
  ];

  const accessibleModules = [];
  
  for (const module of allModules) {
    if (await canAccessModule(user, churchId, module)) {
      accessibleModules.push(module);
    }
  }

  return accessibleModules;
};