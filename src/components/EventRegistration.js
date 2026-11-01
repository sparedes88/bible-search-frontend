import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db, storage } from '../firebase';
import { getDownloadURL, ref } from 'firebase/storage';
import { collection, addDoc, serverTimestamp, getDoc, doc, setDoc, query, where, getDocs } from 'firebase/firestore';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { toast } from 'react-toastify';
import ChurchHeader from './ChurchHeader';
import { MdArrowBack, MdCalendarToday, MdCheckCircleOutline, MdLocationOn, MdSchedule } from 'react-icons/md';
import { formatAnnouncementDate, formatAnnouncementTime } from '../utils/eventAnnouncementLayout';
import './EventRegistration.css';
import 'react-toastify/dist/ReactToastify.css';

const EventRegistration = () => {
  const { id, eventId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [eventDetails, setEventDetails] = useState(null);
  const [eventGraphicUrl, setEventGraphicUrl] = useState('');
  const [graphicUnavailable, setGraphicUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isExternalBrowser, setIsExternalBrowser] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    lastName: '',
    email: '',
    phone: '',
    comments: '',
    potluckChoice: ''
  });
  // Prefill from MemberSignup "Continue as Visitor"
  useEffect(() => {
    const prefill = location.state && location.state.prefill;
    if (prefill) {
      setFormData(prev => ({
        ...prev,
        name: prefill.name || prev.name,
        lastName: prefill.lastName || prev.lastName,
        email: prefill.email || prev.email,
        phone: prefill.phone || prev.phone,
      }));
    }
  }, [location.state]);
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
       navigate(`/organization/${id}/event/${eventId}`);
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

  useEffect(() => {
    let active = true;
    setEventGraphicUrl('');
    setGraphicUnavailable(false);
    const source = String(eventDetails?.imageUrl || '').trim();
    if (!source) return;
    const resolveGraphic = async () => {
      try {
        const url = /^https?:\/\//i.test(source) ? source : await getDownloadURL(ref(storage, source.replace(/^\//, '')));
        if (active) setEventGraphicUrl(url);
      } catch (error) {
        if (active) setGraphicUnavailable(true);
      }
    };
    resolveGraphic();
    return () => { active = false; };
  }, [eventDetails?.imageUrl]);

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
      // If this is a visitor (no authenticated user), upsert a visitor record in Admin Connect
      if (!user?.uid) {
        const visitorsRef = collection(db, 'visitors', id, 'visitors');
        const lowerEmail = (formData.email || '').trim().toLowerCase();
        const cleanPhone = (formData.phone || '').replace(/\D/g, '');

        let existingVisitorId = null;
        // Prefer matching by email when available
        if (lowerEmail) {
          const emailQ = query(visitorsRef, where('email', '==', lowerEmail));
          const emailSnap = await getDocs(emailQ);
          if (!emailSnap.empty) existingVisitorId = emailSnap.docs[0].id;
        }
        // Fallback to phone match
        if (!existingVisitorId && cleanPhone) {
          const phoneQ = query(visitorsRef, where('phone', '==', cleanPhone));
          const phoneSnap = await getDocs(phoneQ);
          if (!phoneSnap.empty) existingVisitorId = phoneSnap.docs[0].id;
        }

        const visitorPayload = {
          name: formData.name || '',
          lastName: formData.lastName || '',
          email: lowerEmail || '',
          phone: cleanPhone || '',
          source: 'eventregistration',
          lastEventId: eventId,
          lastEventName: eventDetails?.title || '',
          lastEventDate: eventDetails?.startDate || '',
          lastVisitedAt: serverTimestamp(),
        };

        if (existingVisitorId) {
          await setDoc(doc(db, 'visitors', id, 'visitors', existingVisitorId), visitorPayload, { merge: true });
        } else {
          await addDoc(visitorsRef, {
            ...visitorPayload,
            createdAt: serverTimestamp(),
            status: 'active',
          });
        }
      }

      await addDoc(collection(db, 'eventRegistrations'), {
        eventId,
        churchId: id,
        userId: user?.uid || null,
        ...formData,
        status: 'registered',
        source: 'eventregistration',
        registeredAt: serverTimestamp(),
        eventName: eventDetails?.title || '',
        eventDate: eventDetails?.startDate || ''
      });

      toast.success('Registration successful!');
  navigate(`/organization/${id}/event/${eventId}`);
    } catch (error) {
      console.error('Registration error:', error);
      toast.error('Failed to register for event');
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="registration-page"><div className="registration-loading" role="status"><span className="registration-loading-indicator" />Loading event...</div></main>
    );
  }

  const eventTitle = eventDetails?.instanceTitle || eventDetails?.title || 'Event registration';
  const eventDate = formatAnnouncementDate(eventDetails?.startDate);
  const endDate = eventDetails?.endDate && eventDetails.endDate !== eventDetails.startDate ? formatAnnouncementDate(eventDetails.endDate) : '';
  const eventTime = [formatAnnouncementTime(eventDetails?.startHour), formatAnnouncementTime(eventDetails?.endHour)].filter(Boolean).join(' - ');

  return (
    <main className="registration-page">
      <nav className="registration-nav" aria-label="Event navigation">
        <div className="registration-nav-inner">
          <button type="button" className="registration-back" onClick={() => navigate(`/organization/${id}/event/${eventId}`)}><MdArrowBack size={19} aria-hidden="true" /> Back to event</button>
          <span className="registration-nav-label">Event registration</span>
        </div>
      </nav>

      {eventDetails?.imageUrl && !graphicUnavailable ? (
        <header className="event-registration-graphic">
          {eventGraphicUrl ? <img src={eventGraphicUrl} alt={`${eventTitle} event graphic`} onError={() => setGraphicUnavailable(true)} /> : <div className="registration-graphic-loading" role="status">Loading event image...</div>}
        </header>
      ) : <div className="registration-organization-header"><ChurchHeader id={id} /></div>}

      <div className="registration-layout">
        <aside className="registration-event-details" aria-labelledby="registration-event-title">
          <span className="registration-eyebrow">The event</span>
          <h1 id="registration-event-title">{eventTitle}</h1>
          <div className="registration-title-rule" />
          <dl className="registration-facts">
            {eventDate && <div><MdCalendarToday aria-hidden="true" /><div><dt>Date</dt><dd>{eventDate}{endDate && ` - ${endDate}`}</dd></div></div>}
            {eventTime && <div><MdSchedule aria-hidden="true" /><div><dt>Time</dt><dd>{eventTime}</dd></div></div>}
            {eventDetails?.location && <div><MdLocationOn aria-hidden="true" /><div><dt>Location</dt><dd>{eventDetails.location}</dd></div></div>}
          </dl>
          {eventDetails?.description && <p className="registration-description">{eventDetails.description}</p>}
        </aside>

        <section className="registration-form-section" aria-labelledby="registration-form-title">
          <header className="registration-form-heading"><span className="registration-form-mark"><MdCheckCircleOutline size={25} aria-hidden="true" /></span><div><span className="registration-eyebrow">Registration</span><h2 id="registration-form-title">Your details</h2></div></header>
          <form onSubmit={handleSubmit} className="registration-form">
            <div className="registration-field-grid">
              <div className="registration-field">
                <label htmlFor="registration-first-name">First name <span aria-hidden="true">*</span></label>
                <input id="registration-first-name" name="givenName" type="text" autoComplete="given-name" placeholder="First name" value={formData.name} onChange={change => setFormData(previous => ({ ...previous, name: change.target.value }))} required disabled={submitting} />
              </div>
              <div className="registration-field">
                <label htmlFor="registration-last-name">Last name <span aria-hidden="true">*</span></label>
                <input id="registration-last-name" name="familyName" type="text" autoComplete="family-name" placeholder="Last name" value={formData.lastName} onChange={change => setFormData(previous => ({ ...previous, lastName: change.target.value }))} required disabled={submitting} />
              </div>
              <div className="registration-field">
                <label htmlFor="registration-email">Email <small>Optional</small></label>
                <input id="registration-email" name="email" type="email" autoComplete="email" placeholder="you@example.com" value={formData.email} onChange={change => setFormData(previous => ({ ...previous, email: change.target.value }))} disabled={submitting} />
              </div>
              <div className="registration-field">
                <label htmlFor="registration-phone">Phone <small>Optional</small></label>
                <input id="registration-phone" name="phone" type="tel" autoComplete="tel" placeholder="Phone number" value={formData.phone} onChange={change => setFormData(previous => ({ ...previous, phone: change.target.value }))} disabled={submitting} />
              </div>
            </div>

            {eventDetails?.potluckEnabled && <div className="registration-potluck">
              <label htmlFor="registration-potluck-choice">At this event, everyone is bringing a plate, snack, or drink. Can you bring an item to share? If so, please tell us what.</label>
              <input id="registration-potluck-choice" type="text" list="registration-potluck-suggestions" value={formData.potluckChoice} onChange={change => setFormData(previous => ({ ...previous, potluckChoice: change.target.value }))} placeholder="e.g. chicken, soda, chips, or your own idea" disabled={submitting} />
              <datalist id="registration-potluck-suggestions"><option value="Chicken" /><option value="Soda" /><option value="Chips" /><option value="Salad" /><option value="Dessert" /></datalist>
            </div>}

            <div className="registration-field registration-comments">
              <label htmlFor="registration-comments">Comments <small>Optional</small></label>
              <textarea id="registration-comments" name="comments" rows={3} placeholder="Anything you would like us to know?" value={formData.comments} onChange={change => setFormData(previous => ({ ...previous, comments: change.target.value }))} disabled={submitting} />
            </div>
            <button type="submit" className="registration-submit" disabled={submitting} aria-busy={submitting}><MdCheckCircleOutline size={21} aria-hidden="true" />{submitting ? 'Registering...' : 'Register for Event'}</button>
          </form>
        </section>
      </div>
      <footer className="registration-footer">{eventTitle}</footer>
    </main>
  );
};

export default EventRegistration;
