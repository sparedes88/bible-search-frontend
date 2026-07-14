import { db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import {
  MODULE_SETTINGS_SUBCOLLECTION,
  MODULE_VISIBILITY_DOC_ID,
  MODULE_VISIBILITY_FIELD,
  isModuleVisibleForRole,
} from './organizationModules';

const isPermissionDeniedError = (error) =>
  error?.code === 'permission-denied' ||
  error?.code === 'firestore/permission-denied';

const LEGACY_MODULE_ID_ALIASES = {
  'conduit-run-counter': 'conduitruncounter',
  'time-tracker': 'timetracker',
};

const normalizePermissionModuleId = (module) => {
  const normalizedModule = String(module || '').trim();
  return LEGACY_MODULE_ID_ALIASES[normalizedModule] || normalizedModule;
};

const isGenericCustomRoleValue = (value) => {
  const normalizedValue = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  return ['custom role', 'custom', 'role'].includes(normalizedValue);
};

const getPreferredUserRoleKey = (userData = {}) => {
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
  return fallbackRole ? String(fallbackRole).trim() : '';
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

const canAccessViaModuleVisibilityFallback = async (user, churchId, module, action) => {
  if (!churchId || !module) {
    return false;
  }

  // Module visibility controls read-level access only.
  if (action !== 'read') {
    return false;
  }

  try {
    const [visibilitySnap, churchSnap] = await Promise.all([
      getDoc(doc(db, 'churches', churchId, MODULE_SETTINGS_SUBCOLLECTION, MODULE_VISIBILITY_DOC_ID)),
      getDoc(doc(db, 'churches', churchId)),
    ]);

    const storedVisibilitySettings = visibilitySnap.exists()
      ? visibilitySnap.data()?.settings
      : churchSnap.data()?.[MODULE_VISIBILITY_FIELD] || {};

    const roleKey = getPreferredUserRoleKey(user);
    return isModuleVisibleForRole(module, roleKey, storedVisibilitySettings || {});
  } catch (fallbackError) {
    console.warn('Module visibility fallback check failed:', fallbackError);
    return false;
  }
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

  const normalizedModule = normalizePermissionModuleId(module);

  const effectiveBaseRole = getEffectiveBaseRole(user);

  // Global admins have access to everything
  if (effectiveBaseRole === 'global_admin') return true;

  // Check if user is a basic admin (for backward compatibility)
  if (effectiveBaseRole === 'admin') return true;

  // For member-level access, use built-in base role permissions.
  try {
    return await checkSystemRolePermission(effectiveBaseRole, normalizedModule, action);

  } catch (error) {
    if (isPermissionDeniedError(error)) {
      return await canAccessViaModuleVisibilityFallback(user, churchId, normalizedModule, action);
    }

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
  const hasExplicitManage = await hasPermission(user, churchId, module, 'manage');
  if (hasExplicitManage) {
    return true;
  }

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
    'directory', 'gallery', 'media', 'groups', 'balance', 'budget', 'finances',
    'timetracker', 'conduitruncounter'
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