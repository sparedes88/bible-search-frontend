import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db, storage } from '../firebase';
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
import ChurchHeader from './ChurchHeader';
import 'react-toastify/dist/ReactToastify.css';
import { PDFDownloadLink } from '@react-pdf/renderer';
import RegistrationsPDF from './RegistrationsPDF';
import { getDownloadURL, ref } from 'firebase/storage';
import { MdAdd, MdArrowBack, MdCalendarToday, MdCheckCircleOutline, MdDeleteOutline, MdEdit, MdFileDownload, MdLocationOn, MdPeopleOutline, MdSchedule } from 'react-icons/md';
import { formatAnnouncementDate, formatAnnouncementTime } from '../utils/eventAnnouncementLayout';
import './EventRegistration.css';
import './EventRegistrationAdmin.css';

const EventRegistrationAdmin = () => {
  const { id, eventId } = useParams();
  const navigate = useNavigate();
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [eventDetails, setEventDetails] = useState(null);
  const [eventImage, setEventImage] = useState(null);
  const [graphicUnavailable, setGraphicUnavailable] = useState(false);
  const [eventLoading, setEventLoading] = useState(true);
  const [registrations, setRegistrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isExternalBrowser, setIsExternalBrowser] = useState(false);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [selectedRegistration, setSelectedRegistration] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    lastName: '',
    phone: '',
    potluckChoice: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [publicRegistrationSubmitted, setPublicRegistrationSubmitted] = useState(false);
  const canManageRegistrations = Boolean(user && isAdmin());

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
      } finally {
        setEventLoading(false);
      }
    };

    fetchEventDetails();
  }, [eventId, id, navigate]);

  useEffect(() => {
    let active = true;
    setEventImage(null);
    setGraphicUnavailable(false);
    const resolveEventImage = async () => {
      const imageUrl = eventDetails?.imageUrl;
      if (!imageUrl) {
        setEventImage(null);
        return;
      }

      if (typeof imageUrl === 'string' && /^https?:\/\//i.test(imageUrl)) {
        setEventImage(imageUrl);
        return;
      }

      try {
        const storagePath = String(imageUrl).replace(/^\//, '');
        const downloadUrl = await getDownloadURL(ref(storage, storagePath));
        if (active) setEventImage(downloadUrl);
      } catch (error) {
        console.error('Error loading event image:', error);
        if (active) setGraphicUnavailable(true);
      }
    };

    resolveEventImage();
    return () => { active = false; };
  }, [eventDetails?.imageUrl]);

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

    if (authLoading) return undefined;
    if (eventId && canManageRegistrations) {
      fetchRegistrations();
    } else {
      setRegistrations([]);
      setLoading(false);
    }
    return undefined;
  }, [eventId, authLoading, canManageRegistrations]);

  const handleAddNew = () => {
    setSelectedRegistration(null);
    setFormData({
      name: '',
      lastName: '',
      phone: '',
      potluckChoice: ''
    });
    setIsAddingNew(true);
  };

  const handleEdit = (registration) => {
    setSelectedRegistration(registration);
    setFormData({
      name: registration.name || '',
      lastName: registration.lastName || '',
      phone: registration.phone || '',
      potluckChoice: registration.potluckChoice || ''
    });
    setIsAddingNew(true);
  };

  const handlePotluckToggle = async (enabled) => {
    const previousValue = Boolean(eventDetails?.potluckEnabled);
    setEventDetails(previous => ({ ...previous, potluckEnabled: enabled }));
    try {
      await updateDoc(doc(db, 'eventInstances', eventId), {
        potluckEnabled: enabled,
        updatedAt: serverTimestamp(),
      });
      toast.success(enabled ? 'Potluck question enabled' : 'Potluck question disabled');
    } catch (error) {
      setEventDetails(previous => ({ ...previous, potluckEnabled: previousValue }));
      console.error('Error updating potluck setting:', error);
      toast.error('Failed to update potluck setting');
    }
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
        const potluckChoice = eventDetails?.potluckEnabled
          ? String(formData.potluckChoice || '').trim()
          : undefined;
        const registrationPayload = {
          eventId,
          churchId: id,
          userId: user?.uid || null,
          name: formData.name.trim(),
          lastName: formData.lastName.trim(),
          phone: formData.phone || '',
          ...(potluckChoice !== undefined ? { potluckChoice } : {}),
          status: 'registered',
          registeredAt: serverTimestamp(),
          eventName: eventDetails?.title || '',
          eventDate: eventDetails?.startDate || '',
          ...(canManageRegistrations ? { createdBy: user?.email || 'admin' } : {}),
        };
        const docRef = await addDoc(collection(db, 'eventRegistrations'), {
          ...registrationPayload,
        });

        if (!canManageRegistrations) {
          setPublicRegistrationSubmitted(true);
          toast.success('RSVP submitted successfully');
          return;
        }
        
        // Add to local state
        setRegistrations(prev => [{
          id: docRef.id,
          ...registrationPayload,
          registeredAt: new Date(),
        }, ...prev]);
        
        toast.success('Registration created successfully');
      }
      
      // Reset form and state
      setFormData({
        name: '',
        lastName: '',
        phone: '',
        potluckChoice: ''
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

  if (authLoading || eventLoading || (canManageRegistrations && loading)) {
    return (
      <main className="registration-page registration-admin"><div className="registration-loading" role="status"><span className="registration-loading-indicator" />Loading registrations...</div></main>
    );
  }

  const eventTitle = eventDetails?.instanceTitle || eventDetails?.title || 'Event';
  const eventDate = formatAnnouncementDate(eventDetails?.startDate);
  const eventTime = [formatAnnouncementTime(eventDetails?.startHour), formatAnnouncementTime(eventDetails?.endHour)].filter(Boolean).join(' - ');

  return (
    <main className="registration-page registration-admin">
      <nav className="registration-nav" aria-label="Event navigation"><div className="registration-nav-inner">
        <button type="button" className="registration-back" onClick={() => navigate(`/organization/${id}/event/${eventId}`)}><MdArrowBack size={19} aria-hidden="true" /> Back to event</button>
        <span className="registration-nav-label">{canManageRegistrations ? 'Registration management' : 'Event registration'}</span>
      </div></nav>

      {eventDetails?.imageUrl && !graphicUnavailable ? <header className="event-registration-graphic">
        {eventImage ? <img src={eventImage} alt={`${eventTitle} image`} onError={() => { setEventImage(null); setGraphicUnavailable(true); }} /> : <div className="registration-graphic-loading" role="status">Loading event image...</div>}
      </header> : <div className="registration-organization-header"><ChurchHeader id={id} /></div>}

      <div className="registration-admin-shell">
        <section className="registration-admin-summary" aria-labelledby="registrations-event-title">
          <div><span className="registration-eyebrow">The event</span><h1 id="registrations-event-title">{eventTitle}</h1><div className="registration-title-rule" /></div>
          <dl className="registration-facts registration-admin-facts">
            {eventDate && <div><MdCalendarToday aria-hidden="true" /><div><dt>Date</dt><dd>{eventDate}</dd></div></div>}
            {eventTime && <div><MdSchedule aria-hidden="true" /><div><dt>Time</dt><dd>{eventTime}</dd></div></div>}
            {eventDetails?.location && <div><MdLocationOn aria-hidden="true" /><div><dt>Location</dt><dd>{eventDetails.location}</dd></div></div>}
          </dl>
        </section>

        <section className="registration-admin-workspace" aria-labelledby="registration-management-title">
          <header className="registration-admin-toolbar">
            <div><h2 id="registration-management-title">{canManageRegistrations ? 'Manage Event Registrations' : 'RSVP for this Event'}</h2>
              {canManageRegistrations && <span className="registration-admin-count"><MdPeopleOutline aria-hidden="true" />{registrations.length} registered</span>}
            </div>
            {canManageRegistrations && !isAddingNew && <div className="registration-admin-actions">
              <PDFDownloadLink className="registration-admin-button" document={<RegistrationsPDF event={eventDetails} registrations={registrations.map(registration => ({ id: registration.id, name: registration.name, lastName: registration.lastName, email: registration.email, phone: registration.phone, registeredAt: registration.registeredAt?.toLocaleString ? registration.registeredAt.toLocaleString() : String(registration.registeredAt || '') }))} />} fileName={`event-${eventId}-registrations.pdf`}><MdFileDownload size={19} aria-hidden="true" />Export PDF</PDFDownloadLink>
              <button type="button" className="registration-admin-button registration-admin-primary" onClick={handleAddNew}><MdAdd size={20} aria-hidden="true" />Add New Registration</button>
            </div>}
          </header>

          {canManageRegistrations && <div className="registration-admin-settings"><label><input type="checkbox" aria-label="Enable potluck question" checked={Boolean(eventDetails?.potluckEnabled)} onChange={change => handlePotluckToggle(change.target.checked)} /><span>Ask registrants what potluck item they will bring</span></label></div>}

          {!canManageRegistrations && publicRegistrationSubmitted ? <div className="registration-admin-success" role="status"><MdCheckCircleOutline size={30} aria-hidden="true" /><div><h3>You&apos;re registered</h3><p>Your RSVP has been received. Thank you!</p></div></div>
          : (!canManageRegistrations || isAddingNew) ? <div className="registration-admin-form-wrap">
            <h3>{!canManageRegistrations ? 'Your RSVP' : selectedRegistration ? 'Edit Registration' : 'New Registration'}</h3>
            <form className="registration-form" onSubmit={handleSubmit}>
              <div className="registration-field-grid">
                <div className="registration-field"><label htmlFor="admin-registration-first-name">First name <span aria-hidden="true">*</span></label><input id="admin-registration-first-name" type="text" autoComplete="given-name" placeholder="First name" value={formData.name} onChange={change => setFormData(previous => ({ ...previous, name: change.target.value }))} required disabled={submitting} /></div>
                <div className="registration-field"><label htmlFor="admin-registration-last-name">Last name <span aria-hidden="true">*</span></label><input id="admin-registration-last-name" type="text" autoComplete="family-name" placeholder="Last name" value={formData.lastName} onChange={change => setFormData(previous => ({ ...previous, lastName: change.target.value }))} required disabled={submitting} /></div>
                <div className="registration-field registration-admin-phone"><label htmlFor="admin-registration-phone">Phone <small>Optional</small></label><input id="admin-registration-phone" type="tel" autoComplete="tel" placeholder="Phone number" value={formData.phone} onChange={change => setFormData(previous => ({ ...previous, phone: change.target.value }))} disabled={submitting} /></div>
              </div>
              {eventDetails?.potluckEnabled && <div className="registration-potluck"><label htmlFor="admin-registration-potluck-choice">At this event, everyone is bringing a plate, snack, or drink. Can you bring an item to share? If so, please tell us what.</label><input id="admin-registration-potluck-choice" type="text" list="admin-registration-potluck-suggestions" value={formData.potluckChoice} onChange={change => setFormData(previous => ({ ...previous, potluckChoice: change.target.value }))} placeholder="e.g. chicken, soda, chips, or your own idea" disabled={submitting} /><datalist id="admin-registration-potluck-suggestions"><option value="Chicken" /><option value="Soda" /><option value="Chips" /><option value="Salad" /><option value="Dessert" /></datalist></div>}
              <div className="registration-admin-form-actions"><button type="button" className="registration-admin-button" onClick={handleCancel} disabled={submitting}>Cancel</button><button type="submit" className="registration-submit" disabled={submitting} aria-busy={submitting}><MdCheckCircleOutline size={20} aria-hidden="true" />{submitting ? 'Submitting...' : (!canManageRegistrations ? 'Submit RSVP' : selectedRegistration ? 'Update' : 'Create')}</button></div>
            </form>
          </div>
          : registrations.length > 0 ? <div className="registration-admin-table-scroll" role="region" aria-label="Event registration roster" tabIndex={0}>
            <table className="registration-admin-table"><thead><tr><th scope="col">Name</th><th scope="col">Contact</th>{eventDetails?.potluckEnabled && <th scope="col">Potluck item</th>}<th scope="col">Registered</th><th scope="col">Comments</th><th scope="col" className="registration-admin-action-heading">Actions</th></tr></thead>
              <tbody>{registrations.map(registration => <tr key={registration.id}>
                <td><strong>{registration.name} {registration.lastName}</strong></td>
                <td>{registration.email && <span>{registration.email}</span>}{registration.phone && <span>{registration.phone}</span>}</td>
                {eventDetails?.potluckEnabled && <td>{registration.potluckChoice || <span className="registration-admin-muted">Not specified</span>}</td>}
                <td><span>{registration.registeredAt.toLocaleString()}</span>{registration.updatedAt && <small>Updated: {registration.updatedAt.toLocaleString()}</small>}</td>
                <td>{registration.comments || <span className="registration-admin-muted">No comments</span>}</td>
                <td><div className="registration-admin-row-actions"><button type="button" aria-label={`Edit registration for ${registration.name} ${registration.lastName}`} title="Edit registration" onClick={() => handleEdit(registration)}><MdEdit size={19} /></button><button type="button" className="registration-admin-delete" aria-label={`Delete registration for ${registration.name} ${registration.lastName}`} title="Delete registration" onClick={() => handleDelete(registration.id)}><MdDeleteOutline size={20} /></button></div></td>
              </tr>)}</tbody>
            </table>
          </div>
          : <div className="registration-admin-empty"><MdPeopleOutline size={40} aria-hidden="true" /><p>No registrations found for this event.</p><button type="button" className="registration-admin-button" onClick={handleAddNew}><MdAdd size={20} aria-hidden="true" />Create First Registration</button></div>}
        </section>
      </div>
      <footer className="registration-footer">{eventTitle}</footer>
    </main>
  );
};

export default EventRegistrationAdmin;