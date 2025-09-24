import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { db } from "../firebase";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  serverTimestamp
} from "firebase/firestore";
import { useAuth } from "../contexts/AuthContext";
import ChurchHeader from "./ChurchHeader";
import commonStyles from "../pages/commonStyles";
import { toast } from "react-toastify";
import ResourcePermissionManager from "./ResourcePermissionManager";
import "./RoleManager.css";

const RoleManager = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [roles, setRoles] = useState([]);
  const [systemRoles, setSystemRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRole, setSelectedRole] = useState(null);
  const [editingRole, setEditingRole] = useState(null);
  const [editedRoleName, setEditedRoleName] = useState("");
  const [editedRoleDescription, setEditedRoleDescription] = useState("");
  const [newRole, setNewRole] = useState({
    name: "",
    description: "",
    permissions: {},
    lastUpdated: Date.now()
  });
  const [showResourcePermissions, setShowResourcePermissions] = useState(false);
  const [resourcePermissionRoleId, setResourcePermissionRoleId] = useState(null);

  // Define all available modules - COMPREHENSIVE LIST ORGANIZED BY CATEGORY
  const moduleCategories = [
    {
      id: "admin",
      name: "Administration & Management",
      color: "#dc3545",
      modules: [
        { id: "admin", name: "Admin Panel", description: "User management and administrative functions" },
        { id: "rolemanager", name: "Role Manager", description: "Create and manage user roles and permissions" },
        { id: "userassignment", name: "Role Assignment", description: "Assign roles to users" },
        { id: "miorganizacion", name: "Organization Settings", description: "Church organization configuration" },
        { id: "businessintelligence", name: "Business Intelligence", description: "Analytics and reporting" },
        { id: "userdashboard", name: "User Dashboard", description: "Personal BI dashboard" }
      ]
    },
    {
      id: "events",
      name: "Events & Calendar",
      color: "#28a745",
      modules: [
        { id: "allevents", name: "All Events", description: "View and manage all church events" },
        { id: "eventdetails", name: "Event Details", description: "Detailed event information and editing" },
        { id: "eventcoordination", name: "Event Coordination", description: "Coordinate event details and logistics" },
        { id: "eventregistration", name: "Event Registration", description: "Manage event registrations" },
        { id: "events", name: "Events Page", description: "Public events viewing" }
      ]
    },
    {
      id: "content",
      name: "Content & Education",
      color: "#007bff",
      modules: [
        { id: "courseadmin", name: "Course Administration", description: "Manage educational content and courses" },
        { id: "courses", name: "Courses", description: "Educational content access" },
        { id: "coursedetail", name: "Course Details", description: "Individual course management" },
        { id: "coursecategories", name: "Course Categories", description: "Organize course categories" },
        { id: "courseanalytics", name: "Course Analytics", description: "View course progress and analytics" },
        { id: "subcategorysettings", name: "Subcategory Settings", description: "Configure course subcategories" },
        { id: "usercourseprogresss", name: "User Course Progress", description: "Track individual course progress" }
      ]
    },
    {
      id: "media",
      name: "Media & Gallery",
      color: "#6f42c1",
      modules: [
        { id: "media", name: "Media Library", description: "Church media library" },
        { id: "mediaadmin", name: "Media Administration", description: "Manage multimedia content" },
        { id: "mediadetail", name: "Media Details", description: "Individual media management" },
        { id: "video", name: "Video", description: "Video content management" },
        { id: "audio", name: "Audio", description: "Audio content management" },
        { id: "pdf", name: "PDF", description: "PDF document management" },
        { id: "gallery", name: "Gallery", description: "Photo and media galleries" },
        { id: "galleryadmin", name: "Gallery Administration", description: "Manage photo galleries" },
        { id: "galleryupload", name: "Gallery Upload", description: "Upload photos to galleries" },
        { id: "galleryview", name: "Gallery View", description: "View gallery contents" },
        { id: "galleryimages", name: "Gallery Images", description: "Individual image management" }
      ]
    },
    {
      id: "communication",
      name: "Communication & Social",
      color: "#fd7e14",
      modules: [
        { id: "chat", name: "Chat", description: "Internal communication system" },
        { id: "chatlog", name: "Chat Logs", description: "View and manage chat history" },
        { id: "broadcast", name: "Broadcast", description: "Mass communication and messaging" },
        { id: "broadcastview", name: "Broadcast View", description: "View broadcast messages" },
        { id: "socialmedia", name: "Social Media", description: "Social media management" },
        { id: "socialmediaaccounts", name: "Social Media Accounts", description: "Manage social media accounts" },
        { id: "forms", name: "Forms", description: "Create and manage custom forms" }
      ]
    },
    {
      id: "members",
      name: "Members & Visitors",
      color: "#20c997",
      modules: [
        { id: "members", name: "Members", description: "Church member management" },
        { id: "memberprofile", name: "Member Profiles", description: "Individual member profiles" },
        { id: "memberdashboard", name: "Member Dashboard", description: "Member personal dashboard" },
        { id: "membermessaging", name: "Member Messaging", description: "Messaging individual members" },
        { id: "directory", name: "Directory", description: "Church member directory" },
        { id: "visitors", name: "Visitors", description: "Track and manage church visitors" },
        { id: "visitordetails", name: "Visitor Details", description: "Individual visitor information" },
        { id: "visitormessages", name: "Visitor Messages", description: "Messaging visitors" },
        { id: "adminconnect", name: "Admin Connect", description: "Visitor and connection management" },
        { id: "connectioncenter", name: "Connection Center", description: "Manage visitors and connections" }
      ]
    },
    {
      id: "groups",
      name: "Groups & Teams",
      color: "#e83e8c",
      modules: [
        { id: "groups", name: "Groups", description: "Church group management" },
        { id: "managegroups", name: "Manage Groups", description: "Create and manage church groups" },
        { id: "teams", name: "Teams", description: "Church serving teams" },
        { id: "createteam", name: "Create Team", description: "Create new serving teams" },
        { id: "teamdetail", name: "Team Details", description: "Individual team management" }
      ]
    },
    {
      id: "finances",
      name: "Finances & Operations",
      color: "#ffc107",
      modules: [
        { id: "finances", name: "Finances", description: "Financial management" },
        { id: "balance", name: "Balance Management", description: "Financial tracking and reporting" },
        { id: "invoices", name: "Invoices", description: "Billing and invoice management" },
        { id: "messagebalance", name: "Message Balance", description: "SMS messaging credits" }
      ]
    },
    {
      id: "facilities",
      name: "Facilities & Resources",
      color: "#6c757d",
      modules: [
        { id: "rooms", name: "Rooms", description: "Church room management" },
        { id: "roomreservations", name: "Room Reservations", description: "Room booking system" },
        { id: "inventory", name: "Inventory", description: "Track equipment and supplies" },
        { id: "inventorydetail", name: "Inventory Details", description: "Individual inventory items" },
        { id: "maintenance", name: "Maintenance", description: "Track repairs and improvements" }
      ]
    },
    {
      id: "worship",
      name: "Presentation & Worship",
      color: "#17a2b8",
      modules: [
        { id: "easyprojector", name: "Easy Projector", description: "Presentation management" },
        { id: "songmanager", name: "Song Manager", description: "Music and worship management" }
      ]
    },
    {
      id: "information",
      name: "Information & Resources",
      color: "#495057",
      modules: [
        { id: "info", name: "Church Information", description: "Basic church information" },
        { id: "articles", name: "Articles", description: "Church articles and blog posts" },
        { id: "articledetail", name: "Article Details", description: "Individual article management" },
        { id: "bible", name: "Bible", description: "Bible study tools" },
        { id: "lettergenerator", name: "Letter Generator", description: "Generate church letters and documents" },
        { id: "contact", name: "Contact", description: "Church contact information" },
        { id: "search", name: "Search", description: "Church search functionality" },
        { id: "sobre", name: "About", description: "About page and information" }
      ]
    },
    {
      id: "advanced",
      name: "Advanced Features",
      color: "#343a40",
      modules: [
        { id: "timetracker", name: "Time Tracker", description: "Time tracking and productivity management" },
        { id: "buildmychurch", name: "Build My Church", description: "Church building and improvement projects" },
        { id: "assistentepastoral", name: "AI Pastoral Assistant", description: "AI assistance for pastoral tasks" },
        { id: "leadershipdevelopment", name: "Leadership Development", description: "Leadership training and development" },
        { id: "leadershiprecommendations", name: "AI Leadership Recommendations", description: "AI-powered leadership insights" },
        { id: "leica", name: "Leica Module", description: "File analysis and processing" },
        { id: "process", name: "Process", description: "Business process management" },
        { id: "taskqrlabel", name: "Task QR Labels", description: "QR code generation for tasks" }
      ]
    },
    {
      id: "user",
      name: "User & Profile",
      color: "#28a745",
      modules: [
        { id: "miperfil", name: "My Profile", description: "User profile management" },
        { id: "profile", name: "Profile Page", description: "User profile viewing" },
        { id: "usersdropdown", name: "Users Dropdown", description: "User selection interface" },
        { id: "userresponselog", name: "User Response Log", description: "User activity logging" },
        { id: "family", name: "Family", description: "Family management" }
      ]
    },
    {
      id: "mobile",
      name: "Mobile & Apps",
      color: "#6f42c1",
      modules: [
        { id: "churchapp", name: "Church App", description: "Mobile app customization" }
      ]
    },
    {
      id: "auth",
      name: "Authentication",
      color: "#dc3545",
      modules: [
        { id: "login", name: "Login", description: "User authentication" },
        { id: "register", name: "Registration", description: "User registration" }
      ]
    }
  ];

  // Keep the flat modules array for backward compatibility
  const modules = moduleCategories.flatMap(category => category.modules);

  const actions = ["create", "read", "update", "delete", "manage", "export"];

  useEffect(() => {
    fetchRoles();
    initializeSystemRoles();
  }, [id]);

  const initializeSystemRoles = () => {
    // Define the built-in system roles with their typical permissions
    const systemRolesData = [
      {
        id: "system_global_admin",
        name: "Global Admin",
        description: "Full system access across all churches",
        isSystemRole: true,
        isEditable: false,
        permissions: generateFullPermissions() // All permissions enabled
      },
      {
        id: "system_admin", 
        name: "Church Admin",
        description: "Full access to church management functions",
        isSystemRole: true,
        isEditable: false,
        permissions: generateAdminPermissions() // Most permissions enabled
      },
      {
        id: "system_member",
        name: "Member",
        description: "Basic member access to church content - Customizable",
        isSystemRole: true,
        isEditable: true,
        permissions: generateMemberPermissions() // Limited read permissions
      }
    ];
    setSystemRoles(systemRolesData);
  };

  // Generate full permissions for global admin
  const generateFullPermissions = () => {
    const permissions = {};
    modules.forEach(module => {
      permissions[module.id] = {
        create: true,
        read: true,
        update: true,
        delete: true,
        manage: true,
        export: true
      };
    });
    return permissions;
  };

  // Generate admin permissions (most things enabled)
  const generateAdminPermissions = () => {
    const permissions = {};
    modules.forEach(module => {
      permissions[module.id] = {
        create: true,
        read: true,
        update: true,
        delete: true,
        manage: true,
        export: true
      };
    });
    return permissions;
  };

  // Generate member permissions (limited access)
  const generateMemberPermissions = () => {
    const permissions = {};
    
    // Modules members can READ
    const memberReadOnlyModules = [
      'courses', 'allevents', 'events', 'members', 'chat', 'directory', 
      'info', 'articles', 'bible', 'contact', 'gallery', 'media', 
      'video', 'audio', 'pdf', 'groups', 'miperfil', 'profile', 'search',
      'sobre', 'family', 'churchapp'
    ];
    
    // Modules members can CREATE/UPDATE (limited functionality)
    const memberLimitedModules = [
      'eventregistration', 'membermessaging', 'userresponselog', 
      'usercourseprogresss', 'miperfil', 'profile', 'timetracker'
    ];
    
    // Modules explicitly DENIED to members
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
    
    modules.forEach(module => {
      if (memberReadOnlyModules.includes(module.id)) {
        permissions[module.id] = {
          create: false,
          read: true,
          update: false,
          delete: false,
          manage: false,
          export: false
        };
      } else if (memberLimitedModules.includes(module.id)) {
        permissions[module.id] = {
          create: true,
          read: true,
          update: true,
          delete: false,
          manage: false,
          export: false
        };
      } else if (memberDeniedModules.includes(module.id)) {
        permissions[module.id] = {
          create: 'deny',
          read: 'deny',
          update: 'deny',
          delete: 'deny',
          manage: 'deny',
          export: 'deny'
        };
      } else {
        permissions[module.id] = {
          create: false,
          read: false,
          update: false,
          delete: false,
          manage: false,
          export: false
        };
      }
    });
    return permissions;
  };

  const fetchRoles = async () => {
    try {
      setLoading(true);
      const rolesQuery = query(
        collection(db, "roles"),
        where("churchId", "==", id)
      );
      const rolesSnapshot = await getDocs(rolesQuery);
      const rolesData = rolesSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setRoles(rolesData);

      // Load saved member role permissions
      await loadMemberPermissions();
    } catch (error) {
      console.error("Error fetching roles:", error);
      toast.error("Error loading roles");
    } finally {
      setLoading(false);
    }
  };

  const loadMemberPermissions = async () => {
    try {
      const memberRoleQuery = query(
        collection(db, "memberRoles"),
        where("churchId", "==", id)
      );
      const memberRoleSnapshot = await getDocs(memberRoleQuery);
      
      if (!memberRoleSnapshot.empty) {
        const memberRoleData = memberRoleSnapshot.docs[0].data();
        // Update system roles with saved member permissions
        setSystemRoles(prev => prev.map(role => {
          if (role.id === "system_member") {
            return { ...role, permissions: memberRoleData.permissions };
          }
          return role;
        }));
      }
    } catch (error) {
      console.error("Error loading member permissions:", error);
    }
  };

  const handleCreateRole = async (e) => {
    e.preventDefault();
    try {
      if (!newRole.name.trim()) {
        toast.error("Role name is required");
        return;
      }

      const roleData = {
        name: newRole.name.trim(),
        description: newRole.description.trim(),
        permissions: newRole.permissions,
        churchId: id,
        createdBy: user.uid,
        createdAt: serverTimestamp()
      };

      await addDoc(collection(db, "roles"), roleData);
      toast.success("Role created successfully");
      setShowCreateForm(false);
      setNewRole({ name: "", description: "", permissions: {}, lastUpdated: Date.now() });
      fetchRoles();
    } catch (error) {
      console.error("Error creating role:", error);
      toast.error("Error creating role");
    }
  };

  const handlePermissionChange = (roleId, moduleId, action, value) => {
    console.log('Permission change:', { roleId, moduleId, action, value }); // Debug log
    
    if (roleId === "new") {
      setNewRole(prev => ({
        ...prev,
        permissions: {
          ...prev.permissions,
          [moduleId]: {
            ...prev.permissions[moduleId] || {},
            [action]: value
          }
        },
        lastUpdated: Date.now() // Force re-render
      }));
    } else if (roleId === "system_member") {
      // Handle member role updates with forced re-render
      updateMemberRolePermission(moduleId, action, value);
    } else {
      // Update existing custom role with forced re-render
      updateRolePermission(roleId, moduleId, action, value);
    }
  };

  const updateMemberRolePermission = async (moduleId, action, value) => {
    try {
      console.log('Updating member permission:', { moduleId, action, value }); // Debug log
      
      // Create completely new state objects to force re-render
      const newSystemRoles = systemRoles.map(role => {
        if (role.id === "system_member") {
          const newPermissions = {
            ...role.permissions,
            [moduleId]: {
              ...role.permissions[moduleId] || {},
              [action]: value
            }
          };
          
          const updatedRole = { 
            ...role, 
            permissions: newPermissions,
            // Add a timestamp to force re-render
            lastUpdated: Date.now()
          };
          
          // Also update selectedRole if it matches
          if (selectedRole && selectedRole.id === "system_member") {
            setSelectedRole(updatedRole);
          }
          
          // Save to database asynchronously (don't wait)
          saveMemberPermissions(newPermissions).catch(error => {
            console.error("Error saving member permissions:", error);
            toast.error("Error saving member permissions");
          });
          
          return updatedRole;
        }
        return { ...role }; // Create new reference for all roles
      });
      
      setSystemRoles(newSystemRoles);
      
    } catch (error) {
      console.error("Error updating member permission:", error);
      toast.error("Error updating member permission");
    }
  };

  const saveMemberPermissions = async (permissions) => {
    try {
      // Check if member role document exists
      const memberRoleQuery = query(
        collection(db, "memberRoles"),
        where("churchId", "==", id)
      );
      const memberRoleSnapshot = await getDocs(memberRoleQuery);
      
      if (!memberRoleSnapshot.empty) {
        // Update existing document
        const docRef = doc(db, "memberRoles", memberRoleSnapshot.docs[0].id);
        await updateDoc(docRef, {
          permissions: permissions,
          updatedAt: serverTimestamp()
        });
      } else {
        // Create new document
        await addDoc(collection(db, "memberRoles"), {
          churchId: id,
          permissions: permissions,
          createdAt: serverTimestamp()
        });
      }
    } catch (error) {
      console.error("Error saving member permissions:", error);
      toast.error("Error saving member permissions");
    }
  };

  // Function to block all permissions for a module
  const handleBlockModule = (roleId, moduleId, moduleName) => {
    const actions = ['create', 'read', 'update', 'delete', 'manage', 'export'];
    actions.forEach(action => {
      handlePermissionChange(roleId, moduleId, action, 'deny');
    });
    toast.success(`Blocked all access to ${moduleName} for this role`);
  };

  // Function to allow all permissions for a module
  const handleAllowModule = (roleId, moduleId, moduleName) => {
    const actions = ['create', 'read', 'update', 'delete', 'manage', 'export'];
    actions.forEach(action => {
      handlePermissionChange(roleId, moduleId, action, true);
    });
    toast.success(`Granted full access to ${moduleName} for this role`);
  };

  const updateRolePermission = async (roleId, moduleId, action, value) => {
    try {
      console.log('Updating role permission:', { roleId, moduleId, action, value }); // Debug log
      
      // Create completely new state objects to force re-render
      const newRoles = roles.map(role => {
        if (role.id === roleId) {
          const newPermissions = {
            ...role.permissions,
            [moduleId]: {
              ...role.permissions[moduleId] || {},
              [action]: value
            }
          };
          
          const updatedRole = { 
            ...role, 
            permissions: newPermissions,
            // Add a timestamp to force re-render
            lastUpdated: Date.now()
          };
          
          // Also update selectedRole if it matches
          if (selectedRole && selectedRole.id === roleId) {
            setSelectedRole(updatedRole);
          }
          
          return updatedRole;
        }
        return { ...role }; // Create new reference for all roles
      });
      
      setRoles(newRoles);

      // Save to database asynchronously
      const roleRef = doc(db, "roles", roleId);
      const originalRole = roles.find(r => r.id === roleId);
      const updatedPermissions = {
        ...originalRole.permissions,
        [moduleId]: {
          ...originalRole.permissions[moduleId] || {},
          [action]: value
        }
      };

      await updateDoc(roleRef, {
        permissions: updatedPermissions,
        updatedAt: serverTimestamp()
      });

    } catch (error) {
      console.error("Error updating permission:", error);
      toast.error("Error updating permission");
      // Revert the optimistic update on error
      fetchRoles();
    }
  };

  const handleDeleteRole = async (roleId) => {
    if (window.confirm("Are you sure you want to delete this role?")) {
      try {
        await deleteDoc(doc(db, "roles", roleId));
        toast.success("Role deleted successfully");
        if (selectedRole && selectedRole.id === roleId) {
          setSelectedRole(null);
        }
        fetchRoles();
      } catch (error) {
        console.error("Error deleting role:", error);
        toast.error("Error deleting role");
      }
    }
  };

  const handleEditRole = (role) => {
    setEditingRole(role.id);
    setEditedRoleName(role.name);
    setEditedRoleDescription(role.description);
  };

  const handleSaveRoleEdit = async (roleId) => {
    try {
      if (!editedRoleName.trim()) {
        toast.error("Role name is required");
        return;
      }

      const roleRef = doc(db, "roles", roleId);
      await updateDoc(roleRef, {
        name: editedRoleName.trim(),
        description: editedRoleDescription.trim(),
        updatedAt: serverTimestamp()
      });

      toast.success("Role updated successfully");
      setEditingRole(null);
      setEditedRoleName("");
      setEditedRoleDescription("");
      
      // Update the selected role if it's the one being edited
      if (selectedRole && selectedRole.id === roleId) {
        setSelectedRole(prev => ({
          ...prev,
          name: editedRoleName.trim(),
          description: editedRoleDescription.trim()
        }));
      }
      
      fetchRoles();
    } catch (error) {
      console.error("Error updating role:", error);
      toast.error("Error updating role");
    }
  };

  const handleCancelRoleEdit = () => {
    setEditingRole(null);
    setEditedRoleName("");
    setEditedRoleDescription("");
  };

  const handleOpenResourcePermissions = (roleId) => {
    setResourcePermissionRoleId(roleId);
    setShowResourcePermissions(true);
  };

  const handleCloseResourcePermissions = () => {
    setShowResourcePermissions(false);
    setResourcePermissionRoleId(null);
    // Refresh roles to show any changes
    fetchRoles();
  };

  const getPermissionValue = (role, moduleId, action) => {
    console.log('Getting permission value for:', { roleId: role?.id, moduleId, action });
    
    if (!role || !role.permissions) {
      console.log('No role or permissions, returning false');
      return false;
    }
    
    if (!role.permissions[moduleId]) {
      console.log('No module permissions, returning false');
      return false;
    }
    
    const value = role.permissions[moduleId][action];
    console.log('Permission value found:', value, 'type:', typeof value);
    
    // Return the actual value (could be true, false, 'deny', null, undefined)
    return value !== undefined ? value : false;
  };

  const getPermissionState = (value) => {
    if (value === 'deny') return 'deny';
    if (value === true) return 'allow';
    return 'none';
  };

  const cyclePermissionValue = (currentValue) => {
    console.log('Cycling permission value from:', currentValue, 'type:', typeof currentValue);
    
    // Handle string 'deny' -> false (none)
    if (currentValue === 'deny') {
      console.log('deny -> false');
      return false;
    }
    
    // Handle false/null/undefined (none) -> true (allow)
    if (currentValue === false || currentValue === null || currentValue === undefined) {
      console.log('false/null/undefined -> true');
      return true;
    }
    
    // Handle true (allow) -> 'deny'
    if (currentValue === true) {
      console.log('true -> deny');
      return 'deny';
    }
    
    // Fallback - return false for any unexpected values
    console.log('fallback -> false');
    return false;
  };

  const PermissionControl = ({ role, moduleId, action, isEditable = true }) => {
    const [localState, setLocalState] = useState(null); // Local state for immediate feedback
    const currentValue = getPermissionValue(role, moduleId, action);
    const state = getPermissionState(localState !== null ? localState : currentValue);
    
    // Reset local state when role permissions change from parent
    useEffect(() => {
      setLocalState(null);
    }, [role?.lastUpdated, role?.permissions]);
    
    // Debug log to check if component is getting correct values
    console.log(`[${role?.id}] PermissionControl RENDER - Module: ${moduleId}, Action: ${action}, CurrentValue: ${currentValue} (${typeof currentValue}), LocalState: ${localState} (${typeof localState}), FinalState: ${state}`);
    
    // Get background color with more obvious visual feedback
    const getBackgroundColor = () => {
      if (localState !== null) {
        console.log(`Using local state color for ${localState}`);
        return '#ff6b6b'; // Bright red when local state is active
      }
      const color = getStateColor(state);
      console.log(`Using state color for ${state}: ${color}`);
      return color;
    };
    
    // Define colors for each state
    const getStateColor = (state) => {
      switch (state) {
        case 'allow': return '#28a745';
        case 'deny': return '#dc3545';
        default: return '#6c757d';
      }
    };
    
    if (!isEditable) {
      // Read-only display
      return (
        <div style={{
          width: '24px',
          height: '24px',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: getStateColor(state),
          color: 'white',
          fontSize: '12px',
          fontWeight: 'bold'
        }}>
          {state === 'allow' ? '✓' : state === 'deny' ? '✗' : '○'}
        </div>
      );
    }

    // Interactive control with immediate visual feedback
    return (
      <div 
        style={{
          width: '24px',
          height: '24px',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: getBackgroundColor(),
          color: 'white',
          fontSize: '12px',
          fontWeight: 'bold',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          border: '2px solid transparent'
        }}
        onClick={() => {
          console.log('CLICK DETECTED!'); // Test if click is detected
          const currentVal = localState !== null ? localState : currentValue;
          const newValue = cyclePermissionValue(currentVal);
          console.log(`[${role.id}] Clicking permission - Current: ${currentVal} (${typeof currentVal}), New: ${newValue} (${typeof newValue})`);
          
          // Set local state immediately for visual feedback
          console.log('Setting local state to:', newValue);
          setLocalState(newValue);
          
          // Force a re-render by adding a small delay
          setTimeout(() => {
            console.log('Local state after timeout:', localState);
          }, 100);
          
          // Update parent state
          handlePermissionChange(role.id, moduleId, action, newValue);
        }}
        onMouseEnter={(e) => {
          e.target.style.transform = 'scale(1.1)';
          e.target.style.borderColor = '#007bff';
        }}
        onMouseLeave={(e) => {
          e.target.style.transform = 'scale(1)';
          e.target.style.borderColor = 'transparent';
        }}
        title={`${state} - Click to cycle to ${getPermissionState(cyclePermissionValue(localState !== null ? localState : currentValue))}`}
      >
        {state === 'allow' ? '✓' : state === 'deny' ? '✗' : '○'}
      </div>
    );
  };

  // Filter roles and modules based on search term
  const filteredRoles = [...systemRoles, ...roles].filter(role =>
    role.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    role.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredModuleCategories = moduleCategories.map(category => ({
    ...category,
    modules: category.modules.filter(module =>
      module.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      module.description.toLowerCase().includes(searchTerm.toLowerCase())
    )
  })).filter(category => category.modules.length > 0);

  const filteredModules = modules.filter(module =>
    module.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    module.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div style={{ width: '100%', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div>Loading roles...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="role-manager">
      {/* Header */}
      <div className="role-manager-header">
        <div className="container">
          <button
            onClick={() => navigate(`/organization/${id}/mi-organizacion`)}
            className="back-button"
          >
            ← Back to My Organization
          </button>
          <h1 className="role-manager-title">
            Role & Permission Management
          </h1>
          <p className="role-manager-subtitle">
            Select a role from the left to view and edit its permissions
          </p>
        </div>
      </div>

      {/* Main Content - Two Panel Layout */}
      <div className="role-manager-content">
        {/* LEFT SIDEBAR - Role Selection */}
        <div className="roles-sidebar">
          <div className="sidebar-header">
            <h2 className="sidebar-title">Available Roles</h2>
            <button
              onClick={() => setShowCreateForm(true)}
              className="create-role-btn"
            >
              + Create New Role
            </button>
            <button
              onClick={() => navigate(`/church/${id}/user-role-assignment`)}
              style={{
                marginTop: '10px',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                padding: '10px 15px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
                width: '100%'
              }}
            >
              👤 Assign Roles to Users
            </button>
          </div>

          <div className="sidebar-search">
            <input
              type="text"
              placeholder="Search roles..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>

          <div className="roles-list">
            {/* System Roles */}
            <div style={{ padding: '15px 20px', backgroundColor: '#f8f9fa', borderBottom: '1px solid #e9ecef' }}>
              <strong style={{ color: '#495057', fontSize: '14px' }}>SYSTEM ROLES</strong>
            </div>
            {systemRoles
              .filter(role => 
                role.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                role.description.toLowerCase().includes(searchTerm.toLowerCase())
              )
              .map(role => (
                <div
                  key={role.id}
                  className={`role-item ${selectedRole?.id === role.id ? 'active' : ''}`}
                  onClick={() => setSelectedRole(role)}
                >
                  <h3 className="role-item-name">
                    {role.name}
                    <span className={`role-badge system ${role.isEditable ? 'editable' : ''}`}>
                      {role.isEditable ? 'Editable' : 'System'}
                    </span>
                  </h3>
                  <p className="role-item-description">{role.description}</p>
                </div>
              ))}

            {/* Custom Roles */}
            {roles.length > 0 && (
              <>
                <div style={{ padding: '15px 20px', backgroundColor: '#f8f9fa', borderBottom: '1px solid #e9ecef' }}>
                  <strong style={{ color: '#495057', fontSize: '14px' }}>CUSTOM ROLES</strong>
                </div>
                {roles
                  .filter(role => 
                    role.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    role.description.toLowerCase().includes(searchTerm.toLowerCase())
                  )
                  .map(role => (
                    <div
                      key={role.id}
                      className={`role-item ${selectedRole?.id === role.id ? 'active' : ''}`}
                      onClick={() => setSelectedRole(role)}
                    >
                      <h3 className="role-item-name">
                        {role.name}
                        <span className="role-badge custom">Custom</span>
                      </h3>
                      <p className="role-item-description">{role.description}</p>
                    </div>
                  ))}
              </>
            )}

            {/* Create New Role Option */}
            <div
              className={`role-item ${showCreateForm ? 'active' : ''}`}
              onClick={() => {
                setShowCreateForm(true);
                setSelectedRole(null);
              }}
              style={{ borderTop: '2px solid #e9ecef' }}
            >
              <h3 className="role-item-name" style={{ color: '#007bff' }}>
                + Create New Role
              </h3>
              <p className="role-item-description">Create a custom role with specific permissions</p>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL - Role Details and Editing */}
        <div className="role-details-panel">
          {showCreateForm ? (
            <div>
              <div className="role-details-header">
                <div>
                  <h2 className="role-details-title">Create New Role</h2>
                  <p className="role-details-subtitle">Configure permissions for the new role</p>
                </div>
                <div className="role-actions">
                  <button
                    onClick={() => setShowCreateForm(false)}
                    className="btn btn-secondary"
                  >
                    Cancel
                  </button>
                </div>
              </div>
              <div className="create-form">
                <form onSubmit={handleCreateRole}>
                  <div className="form-group">
                    <label className="form-label">Role Name:</label>
                    <input
                      type="text"
                      value={newRole.name}
                      onChange={(e) => setNewRole(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="Enter role name"
                      className="form-input"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Description:</label>
                    <textarea
                      value={newRole.description}
                      onChange={(e) => setNewRole(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Enter role description"
                      className="form-textarea"
                    />
                  </div>
                  
                  <h3 style={{ marginTop: '30px', marginBottom: '15px' }}>Permissions by Category</h3>
                  {filteredModuleCategories.map(category => (
                    <div key={category.id} style={{ marginBottom: '30px' }}>
                      <div 
                        className="permission-category-header"
                        style={{ '--category-color': category.color }}
                      >
                        {category.name}
                      </div>
                      <table className="permissions-table permission-category-table">
                        <thead>
                          <tr>
                            <th>Module</th>
                            <th>Create</th>
                            <th>Read</th>
                            <th>Update</th>
                            <th>Delete</th>
                            <th>Manage</th>
                            <th>Export</th>
                            <th>Module Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {category.modules.map(module => (
                            <tr key={module.id}>
                              <td>
                                <div className="module-info">
                                  <div className="module-name">{module.name}</div>
                                  <div className="module-description">{module.description}</div>
                                </div>
                              </td>
                              {actions.map(action => (
                                <td key={action}>
                                  <PermissionControl
                                    role={{ id: "new", permissions: newRole.permissions, lastUpdated: newRole.lastUpdated }}
                                    moduleId={module.id}
                                    action={action}
                                    isEditable={true}
                                  />
                                </td>
                              ))}
                              <td>
                                <div className="module-actions">
                                  <button
                                    type="button"
                                    onClick={() => handleBlockModule("new", module.id, module.name)}
                                    className="module-action-btn block"
                                    title={`Block all access to ${module.name}`}
                                  >
                                    🚫 Block
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleAllowModule("new", module.id, module.name)}
                                    className="module-action-btn allow"
                                    title={`Allow full access to ${module.name}`}
                                  >
                                    ✅ Allow
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}

                  <div className="form-actions">
                    <button type="submit" className="btn btn-primary">Create Role</button>
                    <button 
                      type="button" 
                      onClick={() => setShowCreateForm(false)}
                      className="btn btn-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : selectedRole ? (
            <div>
              <div className="role-details-header">
                <div style={{ flex: 1 }}>
                  {editingRole === selectedRole.id ? (
                    <div>
                      <input
                        type="text"
                        value={editedRoleName}
                        onChange={(e) => setEditedRoleName(e.target.value)}
                        className="role-edit-input"
                        placeholder="Role name"
                        autoFocus
                      />
                      <textarea
                        value={editedRoleDescription}
                        onChange={(e) => setEditedRoleDescription(e.target.value)}
                        className="role-edit-textarea"
                        placeholder="Role description"
                      />
                    </div>
                  ) : (
                    <div>
                      <h2 className="role-details-title">
                        {selectedRole.name}
                        {!selectedRole.isSystemRole && (
                          <button
                            onClick={() => handleEditRole(selectedRole)}
                            className="edit-role-btn"
                            title="Edit name and description"
                          >
                            ✏️ Edit
                          </button>
                        )}
                      </h2>
                      <p className="role-details-subtitle">{selectedRole.description}</p>
                    </div>
                  )}
                </div>
                <div className="role-actions">
                  {editingRole === selectedRole.id ? (
                    <div className="role-edit-actions">
                      <button
                        onClick={() => handleSaveRoleEdit(selectedRole.id)}
                        className="btn btn-primary"
                      >
                        💾 Save
                      </button>
                      <button
                        onClick={handleCancelRoleEdit}
                        className="btn btn-secondary"
                      >
                        ✕ Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => handleOpenResourcePermissions(selectedRole.id)}
                        className="btn btn-info"
                        title="Configure access to specific forms, inventory items, categories, and galleries"
                      >
                        🎯 Resource Permissions
                      </button>
                      {!selectedRole.isSystemRole && (
                        <button
                          onClick={() => handleDeleteRole(selectedRole.id)}
                          className="btn btn-danger"
                        >
                          Delete Role
                        </button>
                      )}
                      {selectedRole.isSystemRole && !selectedRole.isEditable && (
                        <span style={{ color: '#6c757d', fontSize: '14px' }}>Read only</span>
                      )}
                    </>
                  )}
                </div>
              </div>
              
              <div className="role-details-content">
                <h3>Role Permissions by Category</h3>
                {filteredModuleCategories.map(category => (
                  <div key={category.id} style={{ marginBottom: '30px' }}>
                    <div 
                      className="permission-category-header"
                      style={{ '--category-color': category.color }}
                    >
                      {category.name}
                    </div>
                    <table className="permissions-table permission-category-table">
                      <thead>
                        <tr>
                          <th>Module</th>
                          <th>Create</th>
                          <th>Read</th>
                          <th>Update</th>
                          <th>Delete</th>
                          <th>Manage</th>
                          <th>Export</th>
                          <th>Module Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {category.modules.map(module => (
                          <tr key={module.id}>
                            <td>
                              <div className="module-info">
                                <div className="module-name">{module.name}</div>
                                <div className="module-description">{module.description}</div>
                              </div>
                            </td>
                            {actions.map(action => (
                              <td key={action}>
                                <PermissionControl
                                  role={selectedRole}
                                  moduleId={module.id}
                                  action={action}
                                  isEditable={selectedRole.isEditable || !selectedRole.isSystemRole}
                                />
                              </td>
                            ))}
                            <td>
                              {(selectedRole.isEditable || !selectedRole.isSystemRole) && (
                                <div className="module-actions">
                                  <button
                                    type="button"
                                    onClick={() => handleBlockModule(selectedRole.id, module.id, module.name)}
                                    className="module-action-btn block"
                                    title={`Block all access to ${module.name}`}
                                  >
                                    🚫 Block
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleAllowModule(selectedRole.id, module.id, module.name)}
                                    className="module-action-btn allow"
                                    title={`Allow full access to ${module.name}`}
                                  >
                                    ✅ Allow
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <h3>Select a role to get started</h3>
              <p>Choose a role from the list on the left to view and edit its permissions, or create a new custom role.</p>
            </div>
          )}
        </div>
      </div>

      {/* Resource Permission Manager Modal */}
      {showResourcePermissions && resourcePermissionRoleId && (
        <div className="modal-overlay">
          <div className="modal-content resource-permission-modal">
            <ResourcePermissionManager
              roleId={resourcePermissionRoleId}
              churchId={id}
              onSave={handleCloseResourcePermissions}
              onCancel={handleCloseResourcePermissions}
            />
          </div>
        </div>
      )}

    </div>
  );
};

export default RoleManager;
