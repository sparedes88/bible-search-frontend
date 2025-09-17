import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { db } from '../firebase';
import { 
  doc, 
  getDoc, 
  collection, 
  addDoc, 
  serverTimestamp 
} from 'firebase/firestore';
import { toast } from 'react-toastify';
import './Forms.css';

const FormEmbed = () => {
  const { id, formId } = useParams();
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({});
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    fetchForm();
  }, [id, formId]);

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
      toast.error('Failed to load form');
    } finally {
      setLoading(false);
    }
  };

  const handleFieldChange = (fieldName, value) => {
    setFormData(prev => ({
      ...prev,
      [fieldName]: value
    }));
    
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
        submittedBy: 'embedded_form',
        submittedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        source: 'embedded'
      };

      const entriesRef = collection(db, 'churches', id, 'forms', form.id, 'entries');
      await addDoc(entriesRef, submissionData);
      
      setSubmitted(true);
      
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
      <div className="embed-container">
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <div>Loading form...</div>
        </div>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="embed-container">
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <h3>Form not found</h3>
          <p>The form you're looking for doesn't exist or is no longer available.</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="embed-container">
        <div style={{ 
          textAlign: 'center', 
          padding: '2rem',
          backgroundColor: '#d1fae5',
          borderRadius: '8px',
          border: '1px solid #a7f3d0'
        }}>
          <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>✅</div>
          <h3 style={{ color: '#065f46', marginBottom: '0.5rem' }}>Thank you!</h3>
          <p style={{ color: '#047857', margin: 0 }}>Your form has been submitted successfully.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="embed-container">
      <div className="embed-form">
        <div style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
          <h2 style={{ 
            fontSize: '1.5rem', 
            fontWeight: '600', 
            color: '#1f2937', 
            marginBottom: '0.5rem' 
          }}>
            {form.title}
          </h2>
          {form.description && (
            <p style={{ 
              color: '#6b7280', 
              fontSize: '1rem', 
              lineHeight: '1.5',
              margin: 0 
            }}>
              {form.description}
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit}>
          {form.fields.map(field => (
            <div key={field.name} className="form-group" style={{ marginBottom: '1.25rem' }}>
              <label className="form-label" style={{ 
                display: 'block', 
                marginBottom: '0.5rem',
                fontWeight: '600',
                color: '#374151',
                fontSize: '0.875rem'
              }}>
                {field.label} {field.required && <span style={{ color: '#ef4444' }}>*</span>}
              </label>
              
              {renderFormField(field)}
              
              {errors[field.name] && (
                <div style={{ 
                  color: '#ef4444', 
                  fontSize: '0.75rem', 
                  marginTop: '0.25rem' 
                }}>
                  {errors[field.name]}
                </div>
              )}
            </div>
          ))}

          <div style={{ marginTop: '1.5rem' }}>
            <button
              type="submit"
              disabled={submitting}
              style={{
                backgroundColor: submitting ? '#9ca3af' : '#4f46e5',
                color: 'white',
                padding: '0.75rem 1.5rem',
                borderRadius: '6px',
                border: 'none',
                cursor: submitting ? 'not-allowed' : 'pointer',
                fontSize: '0.875rem',
                fontWeight: '600',
                width: '100%'
              }}
            >
              {submitting ? 'Submitting...' : 'Submit Form'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default FormEmbed;
