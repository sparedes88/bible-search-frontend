import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { db } from '../../firebase';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, orderBy } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from 'react-toastify';
import commonStyles from '../../pages/commonStyles';
import { FiEdit2, FiTrash2, FiPlus, FiSave, FiX, FiMapPin } from 'react-icons/fi';
import './CampusesPage.css';

const CampusesPage = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const [campuses, setCampuses] = useState([]);
  const [isAdding, setIsAdding] = useState(false);
  const [editingCampus, setEditingCampus] = useState(null);
  const [campusForm, setCampusForm] = useState({
    name: '',
    address: '',
    description: ''
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCampuses();
  }, [id]);

  const fetchCampuses = async () => {
    try {
      setLoading(true);
      const campusesRef = collection(db, 'churches', id, 'campuses');
      const q = query(campusesRef, orderBy('name'));
      const snapshot = await getDocs(q);
      const campusesData = snapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() 
      }));
      setCampuses(campusesData);
    } catch (err) {
      console.error('Error fetching campuses:', err);
      toast.error('Failed to load campuses');
    } finally {
      setLoading(false);
    }
  };

  const handleAddCampus = async (e) => {
    e.preventDefault();
    if (!campusForm.name || !campusForm.address) {
      toast.error('Campus name and address are required');
      return;
    }

    try {
      const campusesRef = collection(db, 'churches', id, 'campuses');
      await addDoc(campusesRef, {
        ...campusForm,
        createdAt: new Date().toISOString(),
        createdBy: user?.email || 'unknown'
      });

      toast.success('Campus added successfully!');
      setCampusForm({ name: '', address: '', description: '' });
      setIsAdding(false);
      fetchCampuses();
    } catch (err) {
      console.error('Error adding campus:', err);
      toast.error('Failed to add campus');
    }
  };

  const handleEditCampus = async (e) => {
    e.preventDefault();
    if (!campusForm.name || !campusForm.address) {
      toast.error('Campus name and address are required');
      return;
    }

    try {
      const campusRef = doc(db, 'churches', id, 'campuses', editingCampus.id);
      await updateDoc(campusRef, {
        ...campusForm,
        updatedAt: new Date().toISOString(),
        updatedBy: user?.email || 'unknown'
      });

      toast.success('Campus updated successfully!');
      setCampusForm({ name: '', address: '', description: '' });
      setEditingCampus(null);
      fetchCampuses();
    } catch (err) {
      console.error('Error updating campus:', err);
      toast.error('Failed to update campus');
    }
  };

  const handleDeleteCampus = async (campusId, campusName) => {
    if (!window.confirm(`Are you sure you want to delete the campus "${campusName}"?`)) {
      return;
    }

    try {
      const campusRef = doc(db, 'churches', id, 'campuses', campusId);
      await deleteDoc(campusRef);
      toast.success('Campus deleted successfully!');
      fetchCampuses();
    } catch (err) {
      console.error('Error deleting campus:', err);
      toast.error('Failed to delete campus');
    }
  };

  const startEditing = (campus) => {
    setEditingCampus(campus);
    setCampusForm({
      name: campus.name,
      address: campus.address,
      description: campus.description || ''
    });
    setIsAdding(false);
  };

  const cancelForm = () => {
    setIsAdding(false);
    setEditingCampus(null);
    setCampusForm({ name: '', address: '', description: '' });
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setCampusForm(prev => ({
      ...prev,
      [name]: value
    }));
  };

  if (loading) {
    return (
      <div style={commonStyles.container}>
        <h1 style={commonStyles.title}>Loading Campuses...</h1>
      </div>
    );
  }

  return (
    <div style={{...commonStyles.fullWidthContainer, padding: '40px 20px'}}>
      <Link to={`/organization/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to Organization
      </Link>
      
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '30px'
        }}>
          <h1 style={{...commonStyles.title, margin: 0}}>
            <FiMapPin style={{ marginRight: '10px', verticalAlign: 'middle' }} />
            Campus Locations
          </h1>
          
          {!isAdding && !editingCampus && (
            <button
              onClick={() => setIsAdding(true)}
              style={{
                backgroundColor: '#4F46E5',
                color: 'white',
                border: 'none',
                padding: '12px 24px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '16px',
                fontWeight: '500',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.2s'
              }}
              onMouseOver={e => e.target.style.backgroundColor = '#4338CA'}
              onMouseOut={e => e.target.style.backgroundColor = '#4F46E5'}
            >
              <FiPlus /> Add Campus
            </button>
          )}
        </div>

        {/* Add/Edit Form */}
        {(isAdding || editingCampus) && (
          <div style={{
            backgroundColor: '#F9FAFB',
            borderRadius: '12px',
            padding: '30px',
            marginBottom: '30px',
            border: '2px solid #E5E7EB'
          }}>
            <h3 style={{
              fontSize: '20px',
              fontWeight: '600',
              marginBottom: '20px',
              color: '#1F2937'
            }}>
              {editingCampus ? 'Edit Campus' : 'Add New Campus'}
            </h3>
            
            <form onSubmit={editingCampus ? handleEditCampus : handleAddCampus}>
              <div style={{ marginBottom: '20px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#374151',
                  marginBottom: '8px'
                }}>
                  Campus Name *
                </label>
                <input
                  type="text"
                  name="name"
                  value={campusForm.name}
                  onChange={handleInputChange}
                  placeholder="e.g., Main Campus, North Campus"
                  required
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: '1px solid #D1D5DB',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontFamily: "'Nunito', sans-serif"
                  }}
                />
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#374151',
                  marginBottom: '8px'
                }}>
                  Address *
                </label>
                <input
                  type="text"
                  name="address"
                  value={campusForm.address}
                  onChange={handleInputChange}
                  placeholder="e.g., 123 Main St, City, State ZIP"
                  required
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: '1px solid #D1D5DB',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontFamily: "'Nunito', sans-serif"
                  }}
                />
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#374151',
                  marginBottom: '8px'
                }}>
                  Description (Optional)
                </label>
                <textarea
                  name="description"
                  value={campusForm.description}
                  onChange={handleInputChange}
                  placeholder="Additional information about this campus..."
                  rows="3"
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: '1px solid #D1D5DB',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontFamily: "'Nunito', sans-serif",
                    resize: 'vertical'
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  type="submit"
                  style={{
                    backgroundColor: '#10B981',
                    color: 'white',
                    border: 'none',
                    padding: '12px 24px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '500',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <FiSave /> {editingCampus ? 'Update' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={cancelForm}
                  style={{
                    backgroundColor: '#6B7280',
                    color: 'white',
                    border: 'none',
                    padding: '12px 24px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '500',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <FiX /> Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Campuses List */}
        {campuses.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '60px 20px',
            backgroundColor: '#F9FAFB',
            borderRadius: '12px',
            border: '2px dashed #D1D5DB'
          }}>
            <FiMapPin style={{ fontSize: '48px', color: '#9CA3AF', marginBottom: '16px' }} />
            <h3 style={{ fontSize: '18px', color: '#6B7280', marginBottom: '8px' }}>
              No campuses yet
            </h3>
            <p style={{ color: '#9CA3AF', fontSize: '14px' }}>
              Add your first campus location to get started
            </p>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
            gap: '24px'
          }}>
            {campuses.map(campus => (
              <div
                key={campus.id}
                style={{
                  backgroundColor: 'white',
                  borderRadius: '12px',
                  padding: '24px',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
                  border: '1px solid #E5E7EB',
                  transition: 'all 0.2s'
                }}
                onMouseOver={e => {
                  e.currentTarget.style.boxShadow = '0 8px 16px rgba(0, 0, 0, 0.15)';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseOut={e => {
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <div style={{ marginBottom: '16px' }}>
                  <h3 style={{
                    fontSize: '20px',
                    fontWeight: '600',
                    color: '#1F2937',
                    marginBottom: '8px'
                  }}>
                    {campus.name}
                  </h3>
                  <div style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    color: '#6B7280',
                    fontSize: '14px',
                    lineHeight: '1.5'
                  }}>
                    <FiMapPin style={{ 
                      marginRight: '8px', 
                      marginTop: '2px',
                      flexShrink: 0,
                      color: '#4F46E5'
                    }} />
                    <span>{campus.address}</span>
                  </div>
                </div>

                {campus.description && (
                  <p style={{
                    color: '#6B7280',
                    fontSize: '14px',
                    lineHeight: '1.6',
                    marginBottom: '16px',
                    paddingTop: '12px',
                    borderTop: '1px solid #E5E7EB'
                  }}>
                    {campus.description}
                  </p>
                )}

                <div style={{
                  display: 'flex',
                  gap: '8px',
                  marginTop: '16px',
                  paddingTop: '16px',
                  borderTop: '1px solid #E5E7EB'
                }}>
                  <button
                    onClick={() => startEditing(campus)}
                    style={{
                      flex: 1,
                      backgroundColor: '#EEF2FF',
                      color: '#4F46E5',
                      border: 'none',
                      padding: '8px 16px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: '500',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      transition: 'all 0.2s'
                    }}
                    onMouseOver={e => e.target.style.backgroundColor = '#E0E7FF'}
                    onMouseOut={e => e.target.style.backgroundColor = '#EEF2FF'}
                  >
                    <FiEdit2 /> Edit
                  </button>
                  <button
                    onClick={() => handleDeleteCampus(campus.id, campus.name)}
                    style={{
                      flex: 1,
                      backgroundColor: '#FEE2E2',
                      color: '#DC2626',
                      border: 'none',
                      padding: '8px 16px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: '500',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      transition: 'all 0.2s'
                    }}
                    onMouseOver={e => e.target.style.backgroundColor = '#FECACA'}
                    onMouseOut={e => e.target.style.backgroundColor = '#FEE2E2'}
                  >
                    <FiTrash2 /> Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CampusesPage;
