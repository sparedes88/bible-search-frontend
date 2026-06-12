import React, { useState, useEffect, useMemo } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { 
  doc, 
  getDoc, 
  collection, 
  addDoc, 
  serverTimestamp
} from 'firebase/firestore';
import { toast } from 'react-toastify';
import Skeleton from 'react-loading-skeleton';
import 'react-loading-skeleton/dist/skeleton.css';
import commonStyles from '../pages/commonStyles';
import './Forms.css';
import { getChurchData } from '../api/church';
import { FiCheckCircle } from 'react-icons/fi';
import NotAuthorized from './NotAuthorized';
import DebugPanel from './DebugPanel';

const FormViewer = () => {
  const { id, formId } = useParams();
  const location = useLocation();
  const { user } = useAuth();
  
  console.log('🚀 FormViewer: Component initialized', { 
    id, 
    formId, 
    user: !!user,
    url: window.location.href,
    pathname: window.location.pathname
  });
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({});
  const [errors, setErrors] = useState({});
  const [churchLogo, setChurchLogo] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [countdown, setCountdown] = useState(15);

  const postSubmitRedirectPath = useMemo(() => {
    if (typeof window === 'undefined') {
      return '';
    }

    const rawReturnTo = String(new URLSearchParams(location.search).get('returnTo') || '').trim();
    if (!rawReturnTo) {
      return '';
    }

    try {
      const parsedUrl = new URL(rawReturnTo, window.location.origin);
      if (parsedUrl.origin !== window.location.origin) {
        return '';
      }

      // Only allow redirecting to an internal quick-links route.
      const isQuickLinksPath = /^\/(organization|church)\/[^/]+\/quick-links\/?$/i.test(parsedUrl.pathname);
      if (!isQuickLinksPath) {
        return '';
      }

      return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
    } catch (error) {
      return '';
    }
  }, [location.search]);

  // Check authentication - only required for certain features, not for viewing forms
  useEffect(() => {
    // Allow public access to forms - authentication is optional
    // Don't block loading for unauthenticated users
    console.log('🔐 FormViewer: Auth check - user present:', !!user);
  }, [user, id]);

  useEffect(() => {
    // Clear previous form state immediately to avoid stale-content flashes.
    setForm(null);
    setFormData({});
    setErrors({});
    setError(null);
    setSubmitted(false);
    setCountdown(15);
    setLoading(true);

    // Allow fetching form for both authenticated and unauthenticated users.
    fetchForm();
  }, [id, formId]);

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

  // Handle post-submit countdown and either redirect or refresh.
  useEffect(() => {
    let timer;
    if (submitted) {
      timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            if (postSubmitRedirectPath) {
              window.location.assign(postSubmitRedirectPath);
            } else {
              window.location.reload();
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [postSubmitRedirectPath, submitted]);

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
      setError(null);

      console.log('🔍 FormViewer: Starting fetchForm', { id, formId, user: user?.email });

      if (!id || !formId) {
        console.error('❌ FormViewer: Missing required parameters:', { id, formId });
        setError({ type: 'params', message: 'Invalid form URL - missing parameters' });
        toast.error('Invalid form URL');
        return;
      }

      console.log('📡 FormViewer: Fetching form from Firestore:', { 
        id, 
        formId,
        collectionPath: `churches/${id}/forms/${formId}`
      });

      const formRef = doc(db, 'churches', id, 'forms', formId);
      const formDoc = await getDoc(formRef);

      console.log('📄 FormViewer: Firestore response:', {
        exists: formDoc.exists(),
        id: formDoc.id,
        data: formDoc.exists() ? formDoc.data() : null
      });

      if (formDoc.exists()) {
        const formData = formDoc.data();
        console.log('✅ FormViewer: Form data loaded successfully:', formData);

        if (!formData.isActive) {
          console.log('⚠️ FormViewer: Form is not active');
          setError({ type: 'inactive', message: 'This form is no longer accepting submissions' });
          toast.error('This form is no longer accepting submissions');
          return;
        }

        setForm({ id: formDoc.id, ...formData });
        console.log('🎉 FormViewer: Form set successfully');
      } else {
        console.error('❌ FormViewer: Form not found:', formId);
        setError({ type: 'not_found', message: 'Form not found' });
        toast.error('Form not found');
      }
    } catch (error) {
      console.error('💥 FormViewer: Error fetching form:', error);
      setError({
        type: 'fetch_error',
        message: `Failed to load form: ${error.message}`,
        details: error
      });
      toast.error(`Failed to load form: ${error.message}`);
    } finally {
      setLoading(false);
      console.log('🏁 FormViewer: fetchForm completed');
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
      
      // Show thank you screen with countdown and auto-navigation.
      setCountdown(postSubmitRedirectPath ? 3 : 15);
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

  if (error) {
    if (error.type === 'auth') {
      return <NotAuthorized message="Please sign in to view this form." />;
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
          maxWidth: '500px',
          margin: '0 auto',
          backgroundColor: 'white',
          padding: '3rem',
          borderRadius: '16px',
          border: '1px solid #E5E7EB',
          boxShadow: '0 12px 24px rgba(15, 23, 42, 0.08)',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>⚠️</div>
          <h1 style={{ ...commonStyles.title, marginBottom: '1rem', color: '#ef4444' }}>
            Error Loading Form
          </h1>
          <p style={{ color: '#6b7280', marginBottom: '2rem', fontSize: '1.1rem' }}>
            {error.message}
          </p>

          <div style={{ marginBottom: '2rem' }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                backgroundColor: '#4F46E5',
                color: 'white',
                padding: '12px 24px',
                borderRadius: '8px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: '500',
                marginRight: '1rem'
              }}
            >
              Try Again
            </button>
            <button
              onClick={() => window.history.back()}
              style={{
                backgroundColor: '#6b7280',
                color: 'white',
                padding: '12px 24px',
                borderRadius: '8px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: '500'
              }}
            >
              Go Back
            </button>
          </div>

          <DebugPanel
            data={{
              errorType: error.type,
              churchId: id,
              formId: formId,
              userEmail: user?.email,
              userRole: user?.role,
              timestamp: new Date().toISOString(),
              errorDetails: error.details
            }}
            title="Debug Information"
          />
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #F8FAFC 0%, #EEF2FF 100%)',
        padding: '24px'
      }}>
        <div style={{
          width: '100%',
          maxWidth: '720px',
          margin: '0 auto',
          padding: '2.25rem',
          backgroundColor: 'white',
          borderRadius: '16px',
          border: '1px solid #E5E7EB',
          boxShadow: '0 12px 24px rgba(15, 23, 42, 0.08)'
        }}>
          <div style={{ display: 'grid', justifyItems: 'center', gap: '14px', marginBottom: '2rem' }}>
            <Skeleton circle width={64} height={64} />
            <Skeleton width={260} height={30} />
            <Skeleton width="72%" height={16} />
          </div>

          <div style={{ display: 'grid', gap: '1.3rem' }}>
            {[1, 2, 3].map((fieldIndex) => (
              <div key={`form-skeleton-field-${fieldIndex}`} style={{ display: 'grid', gap: '0.55rem' }}>
                <Skeleton width={150} height={14} />
                <Skeleton height={44} borderRadius={10} />
              </div>
            ))}
          </div>

          <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid #E5E7EB' }}>
            <Skeleton height={46} borderRadius={10} />
          </div>
        </div>
      </div>
    );
  }

  if (!form) {
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
          maxWidth: '500px',
          margin: '0 auto',
          backgroundColor: 'white',
          padding: '3rem',
          borderRadius: '16px',
          border: '1px solid #E5E7EB',
          boxShadow: '0 12px 24px rgba(15, 23, 42, 0.08)',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🔍</div>
          <h1 style={{ ...commonStyles.title, marginBottom: '1rem' }}>
            Form Not Found
          </h1>
          <p style={{ color: '#6b7280', marginBottom: '2rem', fontSize: '1.1rem' }}>
            The form you're looking for doesn't exist or is no longer available.
          </p>

          <div style={{ marginBottom: '2rem' }}>
            <button
              onClick={() => window.history.back()}
              style={{
                backgroundColor: '#4F46E5',
                color: 'white',
                padding: '12px 24px',
                borderRadius: '8px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: '500'
              }}
            >
              Go Back
            </button>
          </div>

          <DebugPanel
            data={{
              churchId: id,
              formId: formId,
              userEmail: user?.email,
              userRole: user?.role,
              timestamp: new Date().toISOString()
            }}
            title="Form Not Found Debug Info"
          />
        </div>
      </div>
    );
  }

  console.log('🎨 FormViewer: Rendering component', { 
    loading, 
    error: error?.type, 
    form: !!form, 
    submitted,
    user: !!user 
  });

  // Emergency fallback - if nothing else renders, show this
  if (typeof loading === 'undefined' || typeof error === 'undefined') {
    console.error('🚨 FormViewer: State variables undefined!');
    return (
      <div style={{ padding: '20px', backgroundColor: '#ffcccc', border: '2px solid red' }}>
        <h2>FormViewer State Error</h2>
        <p>Component state is corrupted. Please refresh the page.</p>
        <button onClick={() => window.location.reload()}>Refresh Page</button>
      </div>
    );
  }

  try {
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
            <p style={{ marginTop: 8, color: '#6B7280' }}>
              {postSubmitRedirectPath
                ? <>Returning to Quick Links in <strong>{countdown}s</strong>…</>
                : <>Refreshing in <strong>{countdown}s</strong>…</>}
            </p>
            <div style={{ marginTop: 16 }}>
              <button
                className="form-input"
                onClick={() => {
                  if (postSubmitRedirectPath) {
                    window.location.assign(postSubmitRedirectPath);
                    return;
                  }
                  window.location.reload();
                }}
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
                {postSubmitRedirectPath ? 'Return to Quick Links now' : 'Refresh now'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
  } catch (renderError) {
    console.error('💥 FormViewer: Render error caught:', renderError);
    return (
      <div style={{ padding: '20px', backgroundColor: '#ffcccc', border: '2px solid red', margin: '20px' }}>
        <h2>FormViewer Render Error</h2>
        <p>An error occurred while rendering the form: {renderError.message}</p>
        <details>
          <summary>Error Details</summary>
          <pre>{renderError.stack}</pre>
        </details>
        <button onClick={() => window.location.reload()} style={{ marginTop: '10px', padding: '10px' }}>
          Refresh Page
        </button>
      </div>
    );
  }
};

export default FormViewer;
