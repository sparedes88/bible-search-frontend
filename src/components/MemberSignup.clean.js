import React, { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getAuth, createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { db } from '../firebase';
import { doc, setDoc, collection, addDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import ChurchHeader from './ChurchHeader';
import commonStyles from '../pages/commonStyles';
import { toast } from 'react-toastify';

const MemberSignup = () => {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const [form, setForm] = useState(() => ({
    firstName: decodeURIComponent(params.get('firstName') || ''),
    lastName: decodeURIComponent(params.get('lastName') || ''),
    email: decodeURIComponent(params.get('email') || ''),
    phone: decodeURIComponent(params.get('phone') || ''),
    password: ''
  }));
  const [submitting, setSubmitting] = useState(false);

  const eventId = useMemo(() => params.get('eventId') || '', [params]);
  
  // Check if visitor data is prefilled (from event check-in lookup)
  const isVisitorPrefilled = useMemo(() => {
    return !!(form.firstName || form.lastName || form.email || form.phone);
  }, [form.firstName, form.lastName, form.email, form.phone]);

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const cleanPhone = (p) => (p || '').replace(/\D/g, '');

  const onSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      if (!form.email || !form.password || !form.firstName) {
        toast.error('Please provide name, email and password');
        setSubmitting(false);
        return;
      }

      const auth = getAuth();
      const cred = await createUserWithEmailAndPassword(auth, form.email, form.password);
      await updateProfile(cred.user, { displayName: `${form.firstName} ${form.lastName}`.trim() });

      try {
        const userRef = doc(db, 'users', cred.user.uid);
        await setDoc(userRef, {
          name: form.firstName,
          lastName: form.lastName || '',
          email: form.email.toLowerCase(),
          phone: cleanPhone(form.phone),
          role: 'member',
          churchId: id,
          source: 'eventregistration',
          createdAt: serverTimestamp(),
        }, { merge: true });
      } catch (err) {
        console.error('Write user profile failed:', err);
        toast.warn('Account created. Finishing setup...');
      }

      // Register at event if eventId exists
      if (eventId) {
        try {
          const eventDoc = await getDoc(doc(db, 'eventInstances', eventId));
          const eventData = eventDoc.exists() ? eventDoc.data() : {};
          
          await addDoc(collection(db, 'eventRegistrations'), {
            eventId,
            churchId: id,
            userId: cred.user.uid,
            name: form.firstName,
            lastName: form.lastName || '',
            email: form.email.toLowerCase(),
            phone: cleanPhone(form.phone),
            status: 'registered',
            source: 'eventregistration',
            registeredAt: serverTimestamp(),
            eventName: eventData?.title || '',
            eventDate: eventData?.startDate || ''
          });
          toast.success('Account created and registered for event!');
        } catch (err) {
          console.error('Event registration failed:', err);
          toast.success('Account created');
        }
        navigate(`/organization/${id}/event/${eventId}`);
      } else {
        toast.success('Account created');
        navigate(`/organization/${id}`);
      }
    } catch (err) {
      console.error('Signup error:', err);
      toast.error(err.message || 'Failed to create account');
    }
    setSubmitting(false);
  };

  const onContinueAsVisitor = () => {
    if (!eventId) {
      toast.error('Missing event context');
      return;
    }
    navigate(`/organization/${id}/event/${eventId}/register`, {
      state: {
        prefill: {
          name: form.firstName,
          lastName: form.lastName,
          email: form.email,
          phone: form.phone,
        },
        fromMemberSignup: true,
      }
    });
  };

  return (
    <div className="page-container">
      <ChurchHeader id={id} />
      <div className="content-box" style={{ maxWidth: 680, margin: '20px auto' }}>
        <h2 style={{ fontWeight: 800, marginBottom: 16 }}>Welcome! How would you like to continue?</h2>

        <div style={{ display: 'grid', gap: 16, marginBottom: 24 }}>
          {/* Simplified visitor section when data is prefilled */}
          {isVisitorPrefilled ? (
            <div style={{ padding: 24, border: '1px solid #e5e7eb', borderRadius: 8, background: '#f8fafc', textAlign: 'center' }}>
              <h3 style={{ marginTop: 0, fontSize: '1.25rem' }}>Are you a visitor?</h3>
              <p style={{ margin: '12px 0 20px', color: '#374151' }}>
                We found your information. Continue as a visitor without creating an account.
              </p>
              <button 
                type="button" 
                onClick={onContinueAsVisitor} 
                style={{ 
                  ...commonStyles.primaryButton, 
                  backgroundColor: '#DC2626',
                  borderColor: '#DC2626',
                  padding: '12px 32px',
                  fontSize: '1rem',
                  fontWeight: 600
                }}
              >
                Continue as Visitor
              </button>
            </div>
          ) : (
            <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#f8fafc' }}>
              <strong>Just visiting?</strong>
              <p style={{ margin: '8px 0 12px', color: '#374151' }}>
                Not ready to create an account. Use a quick form and continue to the event.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <input name="firstName" value={form.firstName} onChange={onChange} placeholder="First name" />
                <input name="lastName" value={form.lastName} onChange={onChange} placeholder="Last name" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
                <input name="email" type="email" value={form.email} onChange={onChange} placeholder="Email (optional)" />
                <input name="phone" value={form.phone} onChange={onChange} placeholder="Phone (optional)" />
              </div>
              <button type="button" onClick={onContinueAsVisitor} style={{ ...commonStyles.primaryButton, marginTop: 12 }}>
                Continue as Visitor
              </button>
            </div>
          )}

          <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8 }}>
            <h3 style={{ marginTop: 0 }}>Create a Member Account</h3>
            <p style={{ margin: '8px 0 16px', color: '#374151' }}>
              Create an account to save your info and check in faster next time.
            </p>
            <form onSubmit={onSubmit}>
              <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <input name="firstName" value={form.firstName} onChange={onChange} placeholder="First name" required />
                  <input name="lastName" value={form.lastName} onChange={onChange} placeholder="Last name" />
                </div>
                <input name="email" type="email" value={form.email} onChange={onChange} placeholder="Email" required />
                <input name="phone" value={form.phone} onChange={onChange} placeholder="Phone (optional)" />
                <input name="password" type="password" value={form.password} onChange={onChange} placeholder="Password" required />
                <button type="submit" disabled={submitting} style={commonStyles.primaryButton}>{submitting ? 'Creating...' : 'Create Account'}</button>
              </div>
            </form>
          </div>
        </div>

        <button type="button" onClick={() => navigate(-1)} style={commonStyles.backButtonLink}>Cancel</button>
      </div>
    </div>
  );
};

export default MemberSignup;
