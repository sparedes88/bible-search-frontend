import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, addDoc, serverTimestamp, getDoc, doc } from 'firebase/firestore';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import commonStyles from '../pages/commonStyles';
import ChurchHeader from './ChurchHeader';
import 'react-toastify/dist/ReactToastify.css';

const EventRegistration = () => {
  const { id, eventId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [eventDetails, setEventDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isExternalBrowser, setIsExternalBrowser] = useState(false);
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
    
    // For Facebook browsers, we need to ensure authentication state is properly initialized
    if (isFacebookBrowser) {
      console.log("Detected Facebook browser, ensuring auth state...");
    }
  }, []);

  // Automatically populate user data when available
  useEffect(() => {
    if (user) {
      setFormData(prev => ({
        ...prev,
        name: user.name || prev.name,
        lastName: user.lastName || prev.lastName,
        email: user.email || prev.email,
        phone: user.phone || prev.phone
      }));
    }
  }, [user]);

  useEffect(() => {
    const fetchEventDetails = async () => {
      try {
        const eventDoc = await getDoc(doc(db, "eventInstances", eventId));
        if (eventDoc.exists()) {
          setEventDetails(eventDoc.data());
        } else {
          toast.error("Event not found");
          navigate(`/church/${id}/event/${eventId}`);
        }
      } catch (error) {
        console.error('Error fetching event:', error);
        toast.error('Failed to load event details');
      } finally {
        setLoading(false);
      }
    };

    fetchEventDetails();
  }, [eventId, id, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;

    // Basic validation
    if (!formData.name) {
      toast.error('Name is required');
      return;
    }

    setSubmitting(true);
    try {
      await addDoc(collection(db, 'eventRegistrations'), {
        eventId,
        churchId: id,
        userId: user?.uid || null,
        ...formData,
        status: 'registered',
        registeredAt: serverTimestamp(),
        eventName: eventDetails?.title || '',
        eventDate: eventDetails?.startDate || ''
      });

      toast.success('Registration successful!');
      navigate(`/church/${id}/event/${eventId}`);
    } catch (error) {
      console.error('Registration error:', error);
      toast.error('Failed to register for event');
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <ChurchHeader id={id} />
        <div className="content-box">
          <div className="loading">Loading...</div>
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
      
      <div className="content-box">
        <h2 style={{ 
          fontSize: '1.5rem', 
          fontWeight: 'bold',
          marginBottom: '1.5rem',
          color: '#1f2937'
        }}>
          Event Registration
        </h2>
        
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
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ maxWidth: '32rem', margin: '0 auto' }}>
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

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: '100%',
              backgroundColor: submitting ? '#9CA3AF' : '#4F46E5',
              color: 'white',
              padding: '0.75rem',
              borderRadius: '0.375rem',
              fontWeight: '500',
              cursor: submitting ? 'not-allowed' : 'pointer',
              transition: 'background-color 0.2s'
            }}
          >
            {submitting ? 'Registering...' : 'Register for Event'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default EventRegistration;
