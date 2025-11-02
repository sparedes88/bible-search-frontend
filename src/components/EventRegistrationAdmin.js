import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { 
  collection, 
  addDoc, 
  serverTimestamp, 
  getDoc, 
  getDocs, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  where, 
  orderBy 
} from 'firebase/firestore';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import commonStyles from '../pages/commonStyles';
import ChurchHeader from './ChurchHeader';
import 'react-toastify/dist/ReactToastify.css';
import Skeleton from 'react-loading-skeleton';
import { PDFDownloadLink } from '@react-pdf/renderer';
import RegistrationsPDF from './RegistrationsPDF';

const EventRegistrationAdmin = () => {
  const { id, eventId } = useParams();
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const [eventDetails, setEventDetails] = useState(null);
  const [registrations, setRegistrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isExternalBrowser, setIsExternalBrowser] = useState(false);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [selectedRegistration, setSelectedRegistration] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    lastName: '',
    email: '',
    phone: '',
    comments: ''
  });
  const [submitting, setSubmitting] = useState(false);

  // Detect if coming from external source like Facebook
  useEffect(() => {
    // Check if this is likely opened from Facebook in-app browser
    const userAgent = navigator.userAgent || '';
    const isFacebookBrowser = userAgent.includes('FBAN') || userAgent.includes('FBAV') || document.referrer.includes('facebook');
    setIsExternalBrowser(isFacebookBrowser);
    
    // Enhanced error handling for external browsers
    if (isFacebookBrowser) {
      console.log("External browser detected, ensuring proper initialization...");
      // Additional initialization logic for Facebook browser if needed
    }
  }, []);

  // Redirect non-admin users
  useEffect(() => {
    if (user && !isAdmin()) {
      navigate(`/church/${id}/event/${eventId}`);
      toast.error('Only admins can access this page');
    }
  }, [user, isAdmin, id, eventId, navigate]);

  // Fetch event details
  useEffect(() => {
    const fetchEventDetails = async () => {
      try {
        const eventDoc = await getDoc(doc(db, "eventInstances", eventId));
        if (eventDoc.exists()) {
          setEventDetails(eventDoc.data());
        } else {
          toast.error("Event not found");
          navigate(`/church/${id}/events`);
        }
      } catch (error) {
        console.error('Error fetching event:', error);
        toast.error('Failed to load event details');
      }
    };

    fetchEventDetails();
  }, [eventId, id, navigate]);

  // Fetch all registrations for this event
  useEffect(() => {
    const fetchRegistrations = async () => {
      try {
        const q = query(
          collection(db, "eventRegistrations"),
          where("eventId", "==", eventId),
          orderBy("registeredAt", "desc")
        );
        
        const querySnapshot = await getDocs(q);
        const registrationsData = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          registeredAt: doc.data().registeredAt?.toDate?.() || new Date(),
          updatedAt: doc.data().updatedAt?.toDate?.() || null
        }));
        
        setRegistrations(registrationsData);
      } catch (error) {
        console.error('Error fetching registrations:', error);
        toast.error('Failed to load registrations');
      } finally {
        setLoading(false);
      }
    };

    if (eventId) {
      fetchRegistrations();
    }
  }, [eventId]);

  const handleAddNew = () => {
    setSelectedRegistration(null);
    setFormData({
      name: '',
      lastName: '',
      email: '',
      phone: '',
      comments: ''
    });
    setIsAddingNew(true);
  };

  const handleEdit = (registration) => {
    setSelectedRegistration(registration);
    setFormData({
      name: registration.name || '',
      lastName: registration.lastName || '',
      email: registration.email || '',
      phone: registration.phone || '',
      comments: registration.comments || ''
    });
    setIsAddingNew(true);
  };

  const handleDelete = async (registrationId) => {
    if (!window.confirm('Are you sure you want to delete this registration?')) {
      return;
    }
    
    try {
      await deleteDoc(doc(db, "eventRegistrations", registrationId));
      setRegistrations(prev => prev.filter(r => r.id !== registrationId));
      toast.success('Registration deleted successfully');
    } catch (error) {
      console.error('Error deleting registration:', error);
      toast.error('Failed to delete registration');
    }
  };

  const handleCancel = () => {
    setIsAddingNew(false);
    setSelectedRegistration(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;

    // Basic validation
    if (!formData.name || !formData.lastName) {
      toast.error('Name and last name are required');
      return;
    }

    setSubmitting(true);
    try {
      if (selectedRegistration) {
        // Update existing registration
        await updateDoc(doc(db, "eventRegistrations", selectedRegistration.id), {
          ...formData,
          updatedAt: serverTimestamp(),
          updatedBy: user?.email || 'admin'
        });
        
        // Update local state
        setRegistrations(prev => prev.map(r => {
          if (r.id === selectedRegistration.id) {
            return {
              ...r,
              ...formData,
              updatedAt: new Date()
            };
          }
          return r;
        }));
        
        toast.success('Registration updated successfully');
      } else {
        // Create new registration
        const docRef = await addDoc(collection(db, 'eventRegistrations'), {
          eventId,
          churchId: id,
          userId: null, // Admin-created registration has no user
          ...formData,
          status: 'registered',
          registeredAt: serverTimestamp(),
          eventName: eventDetails?.title || '',
          eventDate: eventDetails?.startDate || '',
          createdBy: user?.email || 'admin'
        });
        
        // Add to local state
        setRegistrations(prev => [{
          id: docRef.id,
          ...formData,
          eventId,
          churchId: id,
          status: 'registered',
          registeredAt: new Date(),
          eventName: eventDetails?.title || '',
          eventDate: eventDetails?.startDate || '',
          createdBy: user?.email || 'admin'
        }, ...prev]);
        
        toast.success('Registration created successfully');
      }
      
      // Reset form and state
      setFormData({
        name: '',
        lastName: '',
        email: '',
        phone: '',
        comments: ''
      });
      setIsAddingNew(false);
      setSelectedRegistration(null);
    } catch (error) {
      console.error('Registration error:', error);
      toast.error('Failed to save registration');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <button
          onClick={() => navigate(`/church/${id}/event/${eventId}`)}
          style={commonStyles.backButtonLink}
        >
          ← Back to Event
        </button>
        <ChurchHeader id={id} />
        <div className="content-box" style={{ padding: '2rem' }}>
          <Skeleton height={50} style={{ marginBottom: '1rem' }} />
          <Skeleton height={100} style={{ marginBottom: '2rem' }} />
          <Skeleton height={40} count={5} style={{ marginBottom: '1rem' }} />
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <button
        onClick={() => navigate(`/church/${id}/event/${eventId}`)}
        style={commonStyles.backButtonLink}
      >
        ← Back to Event
      </button>
      <ChurchHeader id={id} />
      
      <div className="content-box" style={{ padding: '2rem' }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: '1.5rem'
        }}>
          <h2 style={{ 
            fontSize: '1.5rem', 
            fontWeight: 'bold',
            color: '#1f2937'
          }}>
            Manage Event Registrations
          </h2>
          
          {!isAddingNew && (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <PDFDownloadLink
                document={(
                  <RegistrationsPDF
                    event={eventDetails}
                    registrations={(registrations || []).map(r => ({
                      id: r.id,
                      name: r.name,
                      lastName: r.lastName,
                      email: r.email,
                      phone: r.phone,
                      registeredAt: r.registeredAt?.toLocaleString ? r.registeredAt.toLocaleString() : String(r.registeredAt || '')
                    }))}
                  />
                )}
                fileName={`event-${eventId}-registrations.pdf`}
                style={{
                  backgroundColor: '#10B981',
                  color: 'white',
                  padding: '0.5rem 1rem',
                  borderRadius: '0.375rem',
                  fontWeight: '500',
                  textDecoration: 'none'
                }}
              >
                Export PDF
              </PDFDownloadLink>
              <button
                onClick={handleAddNew}
                style={{
                  backgroundColor: '#4F46E5',
                  color: 'white',
                  padding: '0.5rem 1rem',
                  borderRadius: '0.375rem',
                  fontWeight: '500',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                Add New Registration
              </button>
            </div>
          )}
        </div>
        
        {eventDetails && (
          <div style={{
            marginBottom: '2rem',
            padding: '1rem',
            backgroundColor: '#f3f4f6',
            borderRadius: '0.5rem'
          }}>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>
              {eventDetails.title}
            </h3>
            <p>Date: {eventDetails.startDate}</p>
            <p>Time: {eventDetails.startHour} - {eventDetails.endHour}</p>
            <p>Total Registrations: {registrations.length}</p>
          </div>
        )}

        {isAddingNew ? (
          <div style={{ 
            maxWidth: '32rem', 
            margin: '0 auto',
            padding: '1.5rem',
            backgroundColor: '#f9fafb',
            borderRadius: '0.5rem',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
          }}>
            <h3 style={{ marginBottom: '1rem', fontSize: '1.25rem' }}>
              {selectedRegistration ? 'Edit Registration' : 'New Registration'}
            </h3>
            
            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: '1rem' }}>
                <label className="block text-sm font-medium text-gray-700">Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({...prev, name: e.target.value}))}
                  required
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid #d1d5db',
                    borderRadius: '0.375rem',
                    marginTop: '0.25rem'
                  }}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label className="block text-sm font-medium text-gray-700">Last Name *</label>
                <input
                  type="text"
                  value={formData.lastName}
                  onChange={(e) => setFormData(prev => ({...prev, lastName: e.target.value}))}
                  required
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid #d1d5db',
                    borderRadius: '0.375rem',
                    marginTop: '0.25rem'
                  }}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label className="block text-sm font-medium text-gray-700">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData(prev => ({...prev, email: e.target.value}))}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid #d1d5db',
                    borderRadius: '0.375rem',
                    marginTop: '0.25rem'
                  }}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label className="block text-sm font-medium text-gray-700">Phone</label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData(prev => ({...prev, phone: e.target.value}))}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid #d1d5db',
                    borderRadius: '0.375rem',
                    marginTop: '0.25rem'
                  }}
                />
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <label className="block text-sm font-medium text-gray-700">Comments</label>
                <textarea
                  value={formData.comments}
                  onChange={(e) => setFormData(prev => ({...prev, comments: e.target.value}))}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid #d1d5db',
                    borderRadius: '0.375rem',
                    marginTop: '0.25rem',
                    minHeight: '6rem'
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '1rem' }}>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    flex: 1,
                    backgroundColor: submitting ? '#9CA3AF' : '#4F46E5',
                    color: 'white',
                    padding: '0.75rem',
                    borderRadius: '0.375rem',
                    fontWeight: '500',
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    border: 'none',
                    transition: 'background-color 0.2s'
                  }}
                >
                  {submitting ? 'Saving...' : (selectedRegistration ? 'Update' : 'Create')}
                </button>
                
                <button
                  type="button"
                  onClick={handleCancel}
                  style={{
                    flex: 1,
                    backgroundColor: '#6B7280',
                    color: 'white',
                    padding: '0.75rem',
                    borderRadius: '0.375rem',
                    fontWeight: '500',
                    cursor: 'pointer',
                    border: 'none'
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        ) : (
          <>
            {registrations.length > 0 ? (
              <div className="registrations-list" style={{ marginTop: '1.5rem' }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr 1fr auto',
                  gap: '1rem',
                  padding: '0.75rem',
                  borderBottom: '1px solid #e5e7eb',
                  fontWeight: 'bold',
                  backgroundColor: '#f3f4f6'
                }}>
                  <div>Name</div>
                  <div>Contact</div>
                  <div>Registered</div>
                  <div>Comments</div>
                  <div>Actions</div>
                </div>
                
                {registrations.map(registration => (
                  <div 
                    key={registration.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr 1fr 1fr auto',
                      gap: '1rem',
                      padding: '1rem 0.75rem',
                      borderBottom: '1px solid #e5e7eb',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: '500' }}>
                        {registration.name} {registration.lastName}
                      </div>
                    </div>
                    
                    <div>
                      {registration.email && (
                        <div style={{ fontSize: '0.875rem' }}>{registration.email}</div>
                      )}
                      {registration.phone && (
                        <div style={{ fontSize: '0.875rem' }}>{registration.phone}</div>
                      )}
                    </div>
                    
                    <div>
                      <div style={{ fontSize: '0.875rem' }}>
                        {registration.registeredAt.toLocaleString()}
                      </div>
                      {registration.updatedAt && (
                        <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                          Updated: {registration.updatedAt.toLocaleString()}
                        </div>
                      )}
                    </div>
                    
                    <div style={{ fontSize: '0.875rem' }}>
                      {registration.comments || <em style={{ color: '#9ca3af' }}>No comments</em>}
                    </div>
                    
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        onClick={() => handleEdit(registration)}
                        style={{
                          backgroundColor: '#4F46E5',
                          color: 'white',
                          padding: '0.375rem 0.75rem',
                          borderRadius: '0.25rem',
                          fontSize: '0.875rem',
                          border: 'none',
                          cursor: 'pointer'
                        }}
                      >
                        Edit
                      </button>
                      
                      <button
                        onClick={() => handleDelete(registration.id)}
                        style={{
                          backgroundColor: '#EF4444',
                          color: 'white',
                          padding: '0.375rem 0.75rem',
                          borderRadius: '0.25rem',
                          fontSize: '0.875rem',
                          border: 'none',
                          cursor: 'pointer'
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ 
                textAlign: 'center', 
                padding: '3rem 0',
                color: '#6b7280'
              }}>
                <p style={{ marginBottom: '1rem' }}>No registrations found for this event.</p>
                <button
                  onClick={handleAddNew}
                  style={{
                    backgroundColor: '#4F46E5',
                    color: 'white',
                    padding: '0.5rem 1rem',
                    borderRadius: '0.375rem',
                    fontWeight: '500',
                    border: 'none',
                    cursor: 'pointer'
                  }}
                >
                  Create First Registration
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default EventRegistrationAdmin;