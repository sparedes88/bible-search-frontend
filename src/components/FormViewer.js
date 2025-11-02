import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { 
  doc, 
  getDoc, 
  collection, 
  addDoc, 
  serverTimestamp,
  getDocs
} from 'firebase/firestore';
import { toast } from 'react-toastify';
import commonStyles from '../pages/commonStyles';
import './Forms.css';
import { getChurchData } from '../api/church';
import { FiCheckCircle, FiGrid } from 'react-icons/fi';

const FormViewer = () => {
  const { id, formId } = useParams();
  const { user } = useAuth();
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({});
  const [errors, setErrors] = useState({});
  const [churchLogo, setChurchLogo] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [countdown, setCountdown] = useState(15);
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [formsList, setFormsList] = useState([]);
  const [formsLoading, setFormsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Check authentication
  useEffect(() => {
    if (!user) {
      console.log('No user found, redirecting to login');
      window.location.href = `/church/${id}/login?returnUrl=${encodeURIComponent(window.location.pathname)}`;
    }
  }, [user, id]);

  useEffect(() => {
    if (user) {
      fetchForm();
    }
  }, [id, formId, user]);

  // Load available active forms for quick switching
  useEffect(() => {
    const fetchForms = async () => {
      try {
        if (!id) return;
        setFormsLoading(true);
        const formsRef = collection(db, 'churches', id, 'forms');
        // Query only active forms to comply with security rules and avoid permission errors
        const q = window?.firebase?.firestoreQuery
          ? window.firebase.firestoreQuery(formsRef, window.firebase.firestoreWhere('isActive', '==', true))
          : (await import('firebase/firestore')).query(formsRef, (await import('firebase/firestore')).where('isActive', '==', true));
        const snap = await getDocs(q);
        const items = [];
        snap.forEach(docSnap => {
          const data = docSnap.data();
          items.push({ id: docSnap.id, title: data.title || 'Untitled', description: data.description || '' });
        });
        // Sort by title for nicer UX
        items.sort((a, b) => a.title.localeCompare(b.title));
        setFormsList(items);
      } catch (e) {
        console.warn('Failed to load forms list for switcher', e);
      } finally {
        setFormsLoading(false);
      }
    };
    fetchForms();
  }, [id]);

  useEffect(() => {
    const fetchChurch = async () => {
      try {
        if (!id) return;
        const church = await getChurchData(id);
        if (church?.logo) {
          setChurchLogo(church.logo);
        } else {
          setChurchLogo('/img/logo-fallback.svg');
        }
      } catch (e) {
        console.warn('Failed to load church data for logo:', e);
        setChurchLogo('/img/logo-fallback.svg');
      }
    };
    fetchChurch();
  }, [id]);

  // Handle post-submit countdown and auto-refresh
  useEffect(() => {
    let timer;
    if (submitted) {
      timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            // Refresh the page to allow a new submission flow
            window.location.reload();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [submitted]);

  useEffect(() => {
    if (form) {
      const initialData = {};
      form.fields.forEach(field => {
        if (field.type === 'checkbox') {
          initialData[field.name] = [];
        } else if (field.type === 'boolean') {
          initialData[field.name] = false;
        } else {
          initialData[field.name] = '';
        }
      });
      setFormData(initialData);
    }
  }, [form]);

  const fetchForm = async () => {
    try {
      setLoading(true);
      
      if (!id || !formId) {
        console.error('Missing required parameters:', { id, formId });
        toast.error('Invalid form URL');
        setLoading(false);
        return;
      }

      const formRef = doc(db, 'churches', id, 'forms', formId);
      const formDoc = await getDoc(formRef);
      
      if (formDoc.exists()) {
        const formData = formDoc.data();
        if (!formData.isActive) {
          toast.error('This form is no longer accepting submissions');
          return;
        }
        setForm({ id: formDoc.id, ...formData });
      } else {
        toast.error('Form not found');
      }
    } catch (error) {
      console.error('Error fetching form:', error);
      toast.error(`Failed to load form: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleFieldChange = (fieldName, value) => {
    setFormData(prev => ({
      ...prev,
      [fieldName]: value
    }));
    
    // Clear error when user starts typing
    if (errors[fieldName]) {
      setErrors(prev => ({
        ...prev,
        [fieldName]: null
      }));
    }
  };

  const handleCheckboxChange = (fieldName, option, checked) => {
    setFormData(prev => {
      const currentValues = prev[fieldName] || [];
      if (checked) {
        return {
          ...prev,
          [fieldName]: [...currentValues, option]
        };
      } else {
        return {
          ...prev,
          [fieldName]: currentValues.filter(val => val !== option)
        };
      }
    });
  };

  const validateForm = () => {
    const newErrors = {};
    
    form.fields.forEach(field => {
      if (field.required) {
        const value = formData[field.name];
        if (!value || (Array.isArray(value) && value.length === 0)) {
          newErrors[field.name] = `${field.label} is required`;
        }
      }
      
      // Additional validation based on field type
      if (formData[field.name]) {
        switch (field.type) {
          case 'email':
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(formData[field.name])) {
              newErrors[field.name] = 'Please enter a valid email address';
            }
            break;
          case 'url':
            try {
              new URL(formData[field.name]);
            } catch {
              newErrors[field.name] = 'Please enter a valid URL';
            }
            break;
          case 'phone':
            const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
            if (!phoneRegex.test(formData[field.name].replace(/\s/g, ''))) {
              newErrors[field.name] = 'Please enter a valid phone number';
            }
            break;
        }
      }
    });
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      toast.error('Please fix the errors in the form');
      return;
    }

    try {
      setSubmitting(true);
      
      const submissionData = {
        ...formData,
        formId: form.id,
        submittedBy: user?.email || 'anonymous',
        submittedAt: serverTimestamp(),
        createdAt: serverTimestamp()
      };

      const entriesRef = collection(db, 'churches', id, 'forms', form.id, 'entries');
      await addDoc(entriesRef, submissionData);
      
      // Show thank you screen with countdown and auto-refresh
      setSubmitted(true);
      toast.success('Form submitted successfully!');
      
    } catch (error) {
      console.error('Error submitting form:', error);
      toast.error('Failed to submit form');
    } finally {
      setSubmitting(false);
    }
  };

  const renderFormField = (field) => {
    const value = formData[field.name] || '';
    const error = errors[field.name];
    
    const baseProps = {
      required: field.required,
      style: error ? { borderColor: '#ef4444' } : {}
    };

    switch (field.type) {
      case 'textarea':
        return (
          <textarea
            className="form-textarea"
            value={value}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            placeholder={field.placeholder}
            {...baseProps}
          />
        );
      
      case 'select':
        return (
          <select
            className="form-select"
            value={value}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            {...baseProps}
          >
            <option value="">Select an option</option>
            {field.options.map(option => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        );
      
      case 'radio':
        return (
          <div className="radio-group">
            {field.options.map(option => (
              <label key={option} className="radio-option">
                <input
                  type="radio"
                  name={field.name}
                  value={option}
                  checked={value === option}
                  onChange={(e) => handleFieldChange(field.name, e.target.value)}
                  {...baseProps}
                />
                {option}
              </label>
            ))}
          </div>
        );
      
      case 'checkbox':
        const selectedValues = Array.isArray(value) ? value : [];
        return (
          <div className="checkbox-group">
            {field.options.map(option => (
              <label key={option} className="checkbox-option">
                <input
                  type="checkbox"
                  checked={selectedValues.includes(option)}
                  onChange={(e) => handleCheckboxChange(field.name, option, e.target.checked)}
                />
                {option}
              </label>
            ))}
          </div>
        );
      
      case 'boolean':
        return (
          <div className="boolean-field">
            <label className="checkbox-option">
              <input
                type="checkbox"
                checked={value}
                onChange={(e) => handleFieldChange(field.name, e.target.checked)}
              />
              Yes
            </label>
          </div>
        );
      
      case 'number':
        return (
          <input
            type="number"
            className="form-input"
            value={value}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            placeholder={field.placeholder}
            {...baseProps}
          />
        );
      
      case 'email':
        return (
          <input
            type="email"
            className="form-input"
            value={value}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            placeholder={field.placeholder}
            {...baseProps}
          />
        );
      
      case 'phone':
        return (
          <input
            type="tel"
            className="form-input"
            value={value}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            placeholder={field.placeholder}
            {...baseProps}
          />
        );
      
      case 'date':
        return (
          <input
            type="date"
            className="form-input"
            value={value}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            {...baseProps}
          />
        );
      
      case 'time':
        return (
          <input
            type="time"
            className="form-input"
            value={value}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            {...baseProps}
          />
        );
      
      case 'url':
        return (
          <input
            type="url"
            className="form-input"
            value={value}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            placeholder={field.placeholder}
            {...baseProps}
          />
        );
      
      default:
        return (
          <input
            type="text"
            className="form-input"
            value={value}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            placeholder={field.placeholder}
            {...baseProps}
          />
        );
    }
  };

  if (loading) {
    return (
      <div style={commonStyles.container}>
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <div>Loading form...</div>
        </div>
      </div>
    );
  }

  if (!form) {
    return (
      <div style={commonStyles.container}>
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <h3>Form not found</h3>
          <p>The form you're looking for doesn't exist or is no longer available.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #F8FAFC 0%, #EEF2FF 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px'
    }}>
      <div style={{ 
        width: '100%',
        maxWidth: '720px', 
        margin: '0 auto',
        backgroundColor: 'white',
        padding: '2.25rem',
        borderRadius: '16px',
        border: '1px solid #E5E7EB',
        boxShadow: '0 12px 24px rgba(15, 23, 42, 0.08)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.5rem' }}>
          <button
            type="button"
            onClick={() => setShowSwitcher(true)}
            className="form-input"
            style={{
              backgroundColor: '#111827',
              color: 'white',
              padding: '0.5rem 0.875rem',
              borderRadius: 10,
              border: 'none',
              cursor: 'pointer',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <FiGrid />
            Switch Form
          </button>
        </div>
        <div style={{ marginBottom: '2rem', textAlign: 'center' }}>
          {churchLogo && (
            <div style={{ marginBottom: '1rem' }}>
              <img 
                src={churchLogo}
                alt="Church Logo"
                style={{ height: 64, maxWidth: '100%', objectFit: 'contain', filter: 'none' }}
                onError={(e) => { e.currentTarget.src = '/img/logo-fallback.svg'; }}
              />
            </div>
          )}
          <h1 style={{ ...commonStyles.title, marginBottom: '0.75rem', fontSize: '1.75rem' }}>{form.title}</h1>
          {form.description && (
            <p style={{ color: '#6b7280', fontSize: '1.1rem', lineHeight: '1.6' }}>
              {form.description}
            </p>
          )}
        </div>
        {!submitted ? (
          <form onSubmit={handleSubmit}>
            {form.fields.map(field => (
              <div key={field.name} className="form-group" style={{ marginBottom: '1.5rem' }}>
                <label className="form-label" style={{ 
                  display: 'block', 
                  marginBottom: '0.5rem',
                  fontWeight: '600',
                  color: '#111827'
                }}>
                  {field.label} {field.required && <span style={{ color: '#ef4444' }}>*</span>}
                </label>
                
                {renderFormField(field)}
                
                {errors[field.name] && (
                  <div style={{ 
                    color: '#ef4444', 
                    fontSize: '0.875rem', 
                    marginTop: '0.25rem' 
                  }}>
                    {errors[field.name]}
                  </div>
                )}
              </div>
            ))}

            <div style={{ 
              marginTop: '2rem', 
              paddingTop: '2rem', 
              borderTop: '1px solid #e5e7eb' 
            }}>
              <button
                type="submit"
                disabled={submitting}
                style={{
                  backgroundColor: submitting ? '#9ca3af' : '#4f46e5',
                  color: 'white',
                  padding: '0.9rem 2rem',
                  borderRadius: '10px',
                  border: 'none',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  fontSize: '1rem',
                  fontWeight: '700',
                  width: '100%',
                  boxShadow: '0 8px 16px rgba(79, 70, 229, 0.25)'
                }}
              >
                {submitting ? 'Submitting…' : 'Submit Form'}
              </button>
            </div>
          </form>
        ) : (
          <div style={{ textAlign: 'center', padding: '2rem 1rem 1rem' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: 72, width: 72, borderRadius: '50%', backgroundColor: '#ECFDF5', marginBottom: 16 }}>
              <FiCheckCircle size={40} color="#10B981" />
            </div>
            <h2 style={{ margin: 0, marginBottom: 8, fontSize: '1.5rem', color: '#111827' }}>Thank you!</h2>
            <p style={{ margin: 0, marginBottom: 8, color: '#374151' }}>Your response has been recorded.</p>
            <p style={{ marginTop: 8, color: '#6B7280' }}>Refreshing in <strong>{countdown}s</strong>…</p>
            <div style={{ marginTop: 16 }}>
              <button
                className="form-input"
                onClick={() => window.location.reload()}
                style={{
                  backgroundColor: '#111827',
                  color: 'white',
                  padding: '0.6rem 1.25rem',
                  borderRadius: 10,
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 700
                }}
              >
                Refresh now
              </button>
            </div>
          </div>
        )}
        {/* Switcher Modal */}
        {showSwitcher && (
          <div className="modal-overlay" onClick={() => setShowSwitcher(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h3>Switch Form</h3>
              <div style={{ marginBottom: '0.75rem' }}>
                <input
                  type="text"
                  placeholder="Search forms..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="form-input"
                  style={{ width: '100%' }}
                />
              </div>
              {formsLoading ? (
                <div>Loading forms…</div>
              ) : (
                <div style={{ maxHeight: '50vh', overflowY: 'auto', display: 'grid', gap: '0.5rem' }}>
                  {formsList
                    .filter(f => f.title.toLowerCase().includes(searchTerm.toLowerCase()))
                    .map(f => (
                      <button
                        key={f.id}
                        onClick={() => { setShowSwitcher(false); window.location.href = `/church/${id}/form/${f.id}`; }}
                        style={{
                          textAlign: 'left',
                          padding: '0.75rem 1rem',
                          borderRadius: 8,
                          border: '1px solid #e5e7eb',
                          backgroundColor: f.id === formId ? '#EEF2FF' : '#ffffff',
                          cursor: 'pointer'
                        }}
                      >
                        <div style={{ fontWeight: 700, color: '#111827' }}>{f.title}</div>
                        {f.description && (
                          <div style={{ color: '#6b7280', fontSize: '0.875rem' }}>{f.description}</div>
                        )}
                      </button>
                    ))}
                  {formsList.filter(f => f.title.toLowerCase().includes(searchTerm.toLowerCase())).length === 0 && (
                    <div style={{ color: '#6b7280' }}>No forms found.</div>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                <button
                  onClick={() => setShowSwitcher(false)}
                  style={{ backgroundColor: '#6b7280', color: 'white', padding: '0.5rem 1rem', borderRadius: '6px', border: 'none', cursor: 'pointer' }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FormViewer;
