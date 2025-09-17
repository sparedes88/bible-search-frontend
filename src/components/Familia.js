import React, { useState, useEffect } from 'react';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useParams } from 'react-router-dom';
import './Familia.css'; // Import the CSS file for styling
import { useAuth } from '../contexts/AuthContext';
import ChurchHeader from './ChurchHeader';
import commonStyles from '../pages/commonStyles';

const calculateAge = (birthdate) => {
  if (!birthdate) return '';
  const today = new Date();
  const birthDate = new Date(birthdate);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
};

const RELATIONSHIP_OPTIONS = [
  'Mother',
  'Father',
  'Sister',
  'Brother',
  'Grandmother',
  'Grandfather',
  'Aunt',
  'Uncle',
  'Cousin',
  'Niece',
  'Nephew',
  'Guardian',
  'Other'
];

const Familia = () => {
  const { idiglesia } = useParams();
  const { user } = useAuth();
  const [familyMembers, setFamilyMembers] = useState([]);
  const [newMember, setNewMember] = useState({
    name: '',
    relationship: '',
    birthdate: ''
  });
  const [editingId, setEditingId] = useState(null);
  const [editedMember, setEditedMember] = useState(null);

  useEffect(() => {
    const fetchFamilyData = async () => {
      if (!user) return;
      const db = getFirestore();
      const userDocRef = doc(db, 'users', user.uid);
      try {
        const docSnap = await getDoc(userDocRef);
        if (docSnap.exists() && docSnap.data().familyMembers) {
          setFamilyMembers(docSnap.data().familyMembers);
        }
      } catch (error) {
        console.error('Error fetching family data:', error);
      }
    };

    fetchFamilyData();
  }, [user]);

  const handleAddMember = () => {
    if (newMember.name && newMember.relationship && newMember.birthdate) {
      setFamilyMembers([...familyMembers, { ...newMember, id: Date.now() }]);
      setNewMember({ name: '', relationship: '', birthdate: '' });
    }
  };

  const handleRemoveMember = (id) => {
    setFamilyMembers(familyMembers.filter(member => member.id !== id));
  };

  const handleSave = async () => {
    if (!user) return;
    const db = getFirestore();
    const userDocRef = doc(db, 'users', user.uid);
    try {
      await setDoc(userDocRef, { 
        familyMembers,
        email: user.email 
      }, { merge: true });
      console.log('Family data saved successfully');
    } catch (error) {
      console.error('Error saving family data:', error);
    }
  };

  const handleEdit = (member) => {
    setEditingId(member.id);
    setEditedMember({ ...member });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditedMember(null);
  };

  const handleSaveEdit = () => {
    if (editedMember && editingId) {
      setFamilyMembers(familyMembers.map(member => 
        member.id === editingId ? editedMember : member
      ));
      setEditingId(null);
      setEditedMember(null);
    }
  };

  return (
    <div style={commonStyles.container}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <button onClick={() => window.history.back()} style={commonStyles.backButton}>⬅ Volver</button>
      </div>
      <ChurchHeader id={idiglesia} applyShadow={false}/>

      <h1 style={{marginTop:"-30px"}}>Mi Familia</h1>
      
      <div className="add-member-form">
        <div className="form-group">
          <input
            type="text"
            placeholder="Name"
            value={newMember.name}
            onChange={(e) => setNewMember({...newMember, name: e.target.value})}
            className="form-control"
          />
          <select
            value={newMember.relationship}
            onChange={(e) => setNewMember({...newMember, relationship: e.target.value})}
            className="form-control"
          >
            <option value="">Select Relationship</option>
            {RELATIONSHIP_OPTIONS.map(relation => (
              <option key={relation} value={relation}>
                {relation}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={newMember.birthdate}
            onChange={(e) => setNewMember({...newMember, birthdate: e.target.value})}
            className="form-control"
          />
          <button onClick={handleAddMember} className="add-button">Add Family Member</button>
        </div>
      </div>

      <div className="family-members-list">
        {familyMembers.map((member) => (
          <div key={member.id} className="family-member-card">
            {editingId === member.id ? (
              <div className="member-edit-form">
                <input
                  type="text"
                  value={editedMember.name}
                  onChange={(e) => setEditedMember({...editedMember, name: e.target.value})}
                  className="form-control"
                />
                <select
                  value={editedMember.relationship}
                  onChange={(e) => setEditedMember({...editedMember, relationship: e.target.value})}
                  className="form-control"
                >
                  <option value="">Select Relationship</option>
                  {RELATIONSHIP_OPTIONS.map(relation => (
                    <option key={relation} value={relation}>{relation}</option>
                  ))}
                </select>
                <input
                  type="date"
                  value={editedMember.birthdate}
                  onChange={(e) => setEditedMember({...editedMember, birthdate: e.target.value})}
                  className="form-control"
                />
                <div className="edit-buttons">
                  <button onClick={handleSaveEdit} className="save-button">Save</button>
                  <button onClick={handleCancelEdit} className="cancel-button">Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <div className="member-info">
                  <h3>{member.name}</h3>
                  <p>{member.relationship}</p>
                  <p>Age: {calculateAge(member.birthdate)}</p>
                  <p>Birthday: {new Date(member.birthdate).toLocaleDateString()}</p>
                </div>
                <div className="member-actions">
                  <button 
                    onClick={() => handleEdit(member)}
                    className="edit-button"
                  >
                    Edit
                  </button>
                  <button 
                    onClick={() => handleRemoveMember(member.id)}
                    className="remove-button"
                  >
                    Remove
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <button onClick={handleSave} className="save-button">Save Changes</button>
    </div>
  );
};

export default Familia;