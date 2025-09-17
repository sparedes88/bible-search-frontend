import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import Select from 'react-select';

const UsersDropdown = ({ selectedUsers, onChange, isMulti = true, idIglesia }) => {
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchUsers = async () => {
      if (!idIglesia) {
        console.error('No church ID provided to UsersDropdown:', idIglesia);
        return;
      }

      try {
        setIsLoading(true);
        console.log('Fetching users for church:', idIglesia);
        
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('churchId', '==', idIglesia));
        const querySnapshot = await getDocs(q);
        
        const fetchedUsers = querySnapshot.docs.map(doc => ({
          value: doc.id,
          label: doc.data().name || doc.data().email || 'Unnamed User',
          ...doc.data()
        }));
        
        console.log(`Found ${fetchedUsers.length} users for church ${idIglesia}`);
        setUsers(fetchedUsers);
      } catch (err) {
        console.error('Error fetching users:', err);
        setError('Failed to load users');
      } finally {
        setIsLoading(false);
      }
    };

    fetchUsers();
  }, [idIglesia]);

  const customStyles = {
    control: (base) => ({
      ...base,
      minHeight: '40px',
      background: '#fff',
      borderColor: '#e2e8f0',
      '&:hover': {
        borderColor: '#cbd5e0'
      }
    }),
    option: (base, state) => ({
      ...base,
      backgroundColor: state.isSelected ? '#4299e1' : state.isFocused ? '#ebf8ff' : null,
      ':active': {
        backgroundColor: '#4299e1'
      }
    }),
    multiValue: (base) => ({
      ...base,
      backgroundColor: '#edf2f7'
    }),
    multiValueLabel: (base) => ({
      ...base,
      color: '#2d3748'
    }),
    multiValueRemove: (base) => ({
      ...base,
      ':hover': {
        backgroundColor: '#fc8181',
        color: 'white'
      }
    })
  };

  if (error) {
    return <div className="error-message">{error}</div>;
  }

  return (
    <div className="users-dropdown-container">
      <Select
        isMulti={isMulti}
        options={users}
        onChange={onChange}
        value={selectedUsers}
        isLoading={isLoading}
        styles={customStyles}
        placeholder="Search users..."
        noOptionsMessage={() => "No users found"}
        className="users-dropdown"
        classNamePrefix="select"
        filterOption={(option, input) => {
          if (!input) return true;
          return option.label.toLowerCase().includes(input.toLowerCase());
        }}
      />
    </div>
  );
};

export default UsersDropdown;