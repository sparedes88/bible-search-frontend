import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { db } from "../firebase";
import {
  collection,
  getDocs,
  updateDoc,
  doc,
  query,
  where,
  serverTimestamp,
  onSnapshot
} from "firebase/firestore";
import { useAuth } from "../contexts/AuthContext";
import ChurchHeader from "./ChurchHeader";
import commonStyles from "../pages/commonStyles";
import { toast } from "react-toastify";

const UserRoleAssignment = () => {
  const { id } = useParams(); // Church ID
  const navigate = useNavigate();
  const { user } = useAuth();
  const [members, setMembers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [systemRoles, setSystemRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRole, setSelectedRole] = useState("");
  const [showAllUsers, setShowAllUsers] = useState(false); // New state to toggle between all users vs church users only

  // Define system roles
  const defaultSystemRoles = [
    {
      id: "system_global_admin",
      name: "Global Admin",
      description: "Full system access across all churches"
    },
    {
      id: "system_admin", 
      name: "Church Admin",
      description: "Full access to church management functions"
    },
    {
      id: "system_member",
      name: "Member",
      description: "Basic member access to church content"
    }
  ];

  useEffect(() => {
    fetchMembers();
    fetchRoles();
  }, [id]);

  // Refetch members when showAllUsers changes
  useEffect(() => {
    fetchMembers();
  }, [showAllUsers]);

  const fetchMembers = async () => {
    try {
      setLoading(true);
      
      let usersQuery;
      if (showAllUsers) {
        // Fetch all users in the system
        usersQuery = collection(db, "users");
        console.log("Fetching all users from the system");
      } else {
        // Fetch only users associated with this church
        usersQuery = query(
          collection(db, "users"),
          where("churchId", "==", id)
        );
        console.log("Fetching users for church ID:", id);
      }
      
      const unsubscribe = onSnapshot(usersQuery, (querySnapshot) => {
        const membersData = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        console.log(`Fetched ${membersData.length} members:`, membersData);
        console.log("Sample user data:", membersData[0]); // Debug first user structure
        setMembers(membersData);
        setLoading(false);
      });

      return () => unsubscribe();
    } catch (error) {
      console.error("Error fetching members:", error);
      toast.error("Error loading members");
      setLoading(false);
    }
  };

  const fetchRoles = async () => {
    try {
      // Fetch custom roles
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
      setSystemRoles(defaultSystemRoles);
    } catch (error) {
      console.error("Error fetching roles:", error);
      toast.error("Error loading roles");
    }
  };

  const handleRoleAssignment = async (memberId, newRoleId) => {
    try {
      const memberRef = doc(db, "users", memberId);
      await updateDoc(memberRef, {
        role: newRoleId,
        updatedAt: serverTimestamp()
      });

      toast.success("Role assigned successfully!");
    } catch (error) {
      console.error("Error assigning role:", error);
      toast.error("Error assigning role");
    }
  };

  const getAllRoles = () => {
    return [...systemRoles, ...roles];
  };

  const getRoleName = (roleId) => {
    const allRoles = getAllRoles();
    const role = allRoles.find(r => r.id === roleId);
    return role ? role.name : roleId || "No Role";
  };

  const getRoleDescription = (roleId) => {
    const allRoles = getAllRoles();
    const role = allRoles.find(r => r.id === roleId);
    return role ? role.description : "";
  };

  const filteredMembers = members.filter(member => {
    const matchesSearch = member.firstName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         member.lastName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         member.email?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesRole = selectedRole === "" || member.role === selectedRole;
    
    return matchesSearch && matchesRole;
  });

  if (loading) {
    return (
      <div style={{ width: '100%', minHeight: '100vh', backgroundColor: '#f8f9fa' }}>
        <ChurchHeader />
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <div>Loading users...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', minHeight: '100vh', backgroundColor: '#f8f9fa' }}>
      <ChurchHeader />
      
      {/* Header */}
      <div style={{
        backgroundColor: 'white',
        padding: '20px',
        borderBottom: '2px solid #e9ecef',
        boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <button
            onClick={() => navigate(`/church/${id}/mi-organizacion`)}
            style={{
              ...commonStyles.button,
              marginBottom: '15px',
              backgroundColor: '#6c757d'
            }}
          >
            ← Back to Organization
          </button>
          
          <h1 style={{ margin: '0 0 10px 0', color: '#2c3e50', fontSize: '28px' }}>
            User Role Assignment
          </h1>
          <p style={{ margin: 0, color: '#6c757d', fontSize: '16px' }}>
            Assign roles to church members to control their access and permissions
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ maxWidth: '1400px', margin: '20px auto', padding: '0 20px' }}>
        
        {/* Filters */}
        <div style={{
          backgroundColor: 'white',
          padding: '20px',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          marginBottom: '20px'
        }}>
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
            <div style={{ flex: '1', minWidth: '250px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                Search Members:
              </label>
              <input
                type="text"
                placeholder="Search by name or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '14px'
                }}
              />
            </div>
            
            <div style={{ minWidth: '200px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                Filter by Role:
              </label>
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '14px'
                }}
              >
                <option value="">All Roles</option>
                {systemRoles.map(role => (
                  <option key={role.id} value={role.id}>
                    {role.name} (System)
                  </option>
                ))}
                {roles.map(role => (
                  <option key={role.id} value={role.id}>
                    {role.name} (Custom)
                  </option>
                ))}
              </select>
            </div>
            
            <div style={{ minWidth: '200px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                User Scope:
              </label>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '10px',
                padding: '10px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                backgroundColor: '#f8f9fa'
              }}>
                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={showAllUsers}
                    onChange={(e) => setShowAllUsers(e.target.checked)}
                    style={{ marginRight: '8px' }}
                  />
                  Show all users
                </label>
              </div>
              <small style={{ color: '#6c757d', fontSize: '12px' }}>
                {showAllUsers ? 'Showing all users in system' : 'Showing only church members'}
              </small>
            </div>
          </div>
          
          {/* Summary */}
          <div style={{ 
            marginTop: '15px', 
            padding: '10px', 
            backgroundColor: '#e9ecef', 
            borderRadius: '4px',
            fontSize: '14px',
            color: '#495057'
          }}>
            Found {filteredMembers.length} user{filteredMembers.length !== 1 ? 's' : ''} 
            {selectedRole && ` with role: ${getRoleName(selectedRole)}`}
            {searchTerm && ` matching "${searchTerm}"`}
          </div>
        </div>

        {/* Members List */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          overflow: 'hidden'
        }}>
          <div style={{
            padding: '20px',
            borderBottom: '1px solid #e9ecef',
            backgroundColor: '#f8f9fa'
          }}>
            <h2 style={{ margin: 0, fontSize: '20px' }}>
              Church Members ({filteredMembers.length})
            </h2>
          </div>

          {filteredMembers.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#6c757d' }}>
              {members.length === 0 ? 'No members found.' : 'No members match the current filters.'}
            </div>
          ) : (
            <div style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8f9fa' }}>
                    <th style={{ padding: '15px', textAlign: 'left', borderBottom: '1px solid #dee2e6' }}>
                      First Name
                    </th>
                    <th style={{ padding: '15px', textAlign: 'left', borderBottom: '1px solid #dee2e6' }}>
                      Last Name
                    </th>
                    <th style={{ padding: '15px', textAlign: 'left', borderBottom: '1px solid #dee2e6' }}>
                      Email
                    </th>
                    {showAllUsers && (
                      <th style={{ padding: '15px', textAlign: 'left', borderBottom: '1px solid #dee2e6' }}>
                        Church ID
                      </th>
                    )}
                    <th style={{ padding: '15px', textAlign: 'left', borderBottom: '1px solid #dee2e6' }}>
                      Current Role
                    </th>
                    <th style={{ padding: '15px', textAlign: 'left', borderBottom: '1px solid #dee2e6' }}>
                      Assign New Role
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMembers.map(member => (
                    <tr key={member.id} style={{ borderBottom: '1px solid #dee2e6' }}>
                      <td style={{ padding: '15px' }}>
                        <strong>{member.firstName || 'N/A'}</strong>
                      </td>
                      <td style={{ padding: '15px' }}>
                        <strong>{member.lastName || 'N/A'}</strong>
                      </td>
                      <td style={{ padding: '15px', color: '#6c757d' }}>
                        {member.email || 'No email'}
                      </td>
                      {showAllUsers && (
                        <td style={{ padding: '15px', color: '#6c757d' }}>
                          <div>
                            <strong>{member.churchId || 'No Church'}</strong>
                            {member.churchId === id && (
                              <div style={{ fontSize: '12px', color: '#28a745', fontWeight: 'bold' }}>
                                (Current Church)
                              </div>
                            )}
                          </div>
                        </td>
                      )}
                      <td style={{ padding: '15px' }}>
                        <div>
                          <strong>{getRoleName(member.role)}</strong>
                          <div style={{ fontSize: '12px', color: '#6c757d' }}>
                            {getRoleDescription(member.role)}
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '15px' }}>
                        <select
                          value={member.role || ""}
                          onChange={(e) => handleRoleAssignment(member.id, e.target.value)}
                          style={{
                            padding: '8px',
                            border: '1px solid #ddd',
                            borderRadius: '4px',
                            fontSize: '14px',
                            minWidth: '200px'
                          }}
                        >
                          <option value="">No Role</option>
                          <optgroup label="System Roles">
                            {systemRoles.map(role => (
                              <option key={role.id} value={role.id}>
                                {role.name}
                              </option>
                            ))}
                          </optgroup>
                          {roles.length > 0 && (
                            <optgroup label="Custom Roles">
                              {roles.map(role => (
                                <option key={role.id} value={role.id}>
                                  {role.name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div style={{
          backgroundColor: 'white',
          padding: '20px',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          marginTop: '20px'
        }}>
          <h3 style={{ margin: '0 0 15px 0' }}>Quick Actions</h3>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button
              onClick={() => navigate(`/church/${id}/role-manager`)}
              style={{
                ...commonStyles.button,
                backgroundColor: '#007bff'
              }}
            >
              Manage Roles
            </button>
            <button
              onClick={() => {
                setSearchTerm("");
                setSelectedRole("");
              }}
              style={{
                ...commonStyles.button,
                backgroundColor: '#6c757d'
              }}
            >
              Clear Filters
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserRoleAssignment;
