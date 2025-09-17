import React, { useState, useEffect } from 'react';
import { doc, getDoc, collection, addDoc } from 'firebase/firestore';
import { db } from '../firebase';

const FormDisplay = ({ churchId, formId, onSubmit }) => {
  const [form, setForm] = useState(null);
  const [formData, setFormData] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchForm = async () => {
      try {
        setLoading(true);
        console.log('Fetching form:', formId, 'for church:', churchId);
        
        const formRef = doc(db, 'churches', churchId, 'forms', formId);
        const formDoc = await getDoc(formRef);
        
        if (formDoc.exists()) {
          const formData = formDoc.data();
          console.log('Form data loaded:', formData);
          setForm(formData);
          
          // Initialize form data with empty values
          const initialData = {};
          if (formData.fields) {
            formData.fields.forEach(field => {
              initialData[field.id] = field.type === 'checkbox' ? false : '';
            });
          }
          setFormData(initialData);
        } else {
          setError('Form not found');
          console.error('Form not found');
        }
      } catch (err) {
        console.error('Error fetching form:', err);
        setError('Error loading form: ' + err.message);
      } finally {
        setLoading(false);
      }
    };

    if (churchId && formId) {
      fetchForm();
    }
  }, [churchId, formId]);

  const handleInputChange = (fieldId, value) => {
    setFormData(prev => ({
      ...prev,
      [fieldId]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const submissionData = {
        formId: formId,
        churchId: churchId,
        submittedAt: new Date(),
        responses: formData
      };

      // Add to form entries subcollection
      const entriesRef = collection(db, 'churches', churchId, 'forms', formId, 'entries');
      await addDoc(entriesRef, submissionData);

      setSubmitted(true);
      if (onSubmit) {
        onSubmit(submissionData);
      }
    } catch (err) {
      console.error('Error submitting form:', err);
      setError('Error submitting form: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const renderField = (field) => {
    const commonProps = {
      id: field.id,
      required: field.required,
      disabled: submitting || submitted
    };

    switch (field.type) {
      case 'text':
      case 'email':
      case 'tel':
        return (
          <input
            {...commonProps}
            type={field.type}
            value={formData[field.id] || ''}
            onChange={(e) => handleInputChange(field.id, e.target.value)}
            placeholder={field.placeholder}
            style={{
              width: '100%',
              padding: '10px',
              border: '1px solid #e5e7eb',
              borderRadius: '4px',
              fontSize: '14px'
            }}
          />
        );

      case 'textarea':
        return (
          <textarea
            {...commonProps}
            value={formData[field.id] || ''}
            onChange={(e) => handleInputChange(field.id, e.target.value)}
            placeholder={field.placeholder}
            rows={field.rows || 4}
            style={{
              width: '100%',
              padding: '10px',
              border: '1px solid #e5e7eb',
              borderRadius: '4px',
              fontSize: '14px',
              resize: 'vertical'
            }}
          />
        );

      case 'select':
        return (
          <select
            {...commonProps}
            value={formData[field.id] || ''}
            onChange={(e) => handleInputChange(field.id, e.target.value)}
            style={{
              width: '100%',
              padding: '10px',
              border: '1px solid #e5e7eb',
              borderRadius: '4px',
              fontSize: '14px'
            }}
          >
            <option value="">Select an option</option>
            {field.options?.map((option, index) => (
              <option key={index} value={option}>
                {option}
              </option>
            ))}
          </select>
        );

      case 'radio':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {field.options?.map((option, index) => (
              <label key={index} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name={field.id}
                  value={option}
                  checked={formData[field.id] === option}
                  onChange={(e) => handleInputChange(field.id, e.target.value)}
                  disabled={submitting || submitted}
                />
                {option}
              </label>
            ))}
          </div>
        );

      case 'checkbox':
        if (field.options && field.options.length > 0) {
          // Multiple checkboxes
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {field.options.map((option, index) => (
                <label key={index} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={Array.isArray(formData[field.id]) ? formData[field.id].includes(option) : false}
                    onChange={(e) => {
                      const currentValues = Array.isArray(formData[field.id]) ? formData[field.id] : [];
                      if (e.target.checked) {
                        handleInputChange(field.id, [...currentValues, option]);
                      } else {
                        handleInputChange(field.id, currentValues.filter(v => v !== option));
                      }
                    }}
                    disabled={submitting || submitted}
                  />
                  {option}
                </label>
              ))}
            </div>
          );
        } else {
          // Single checkbox
          return (
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={formData[field.id] || false}
                onChange={(e) => handleInputChange(field.id, e.target.checked)}
                disabled={submitting || submitted}
              />
              {field.label}
            </label>
          );
        }

      case 'date':
        return (
          <input
            {...commonProps}
            type="date"
            value={formData[field.id] || ''}
            onChange={(e) => handleInputChange(field.id, e.target.value)}
            style={{
              width: '100%',
              padding: '10px',
              border: '1px solid #e5e7eb',
              borderRadius: '4px',
              fontSize: '14px'
            }}
          />
        );

      case 'number':
        return (
          <input
            {...commonProps}
            type="number"
            value={formData[field.id] || ''}
            onChange={(e) => handleInputChange(field.id, e.target.value)}
            placeholder={field.placeholder}
            min={field.min}
            max={field.max}
            step={field.step}
            style={{
              width: '100%',
              padding: '10px',
              border: '1px solid #e5e7eb',
              borderRadius: '4px',
              fontSize: '14px'
            }}
          />
        );

      default:
        return (
          <div style={{ color: '#ef4444', fontSize: '14px' }}>
            Unsupported field type: {field.type}
          </div>
        );
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <div>Loading form...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ 
        padding: '20px', 
        backgroundColor: '#fef2f2', 
        border: '1px solid #fecaca', 
        borderRadius: '8px',
        color: '#dc2626'
      }}>
        {error}
      </div>
    );
  }

  if (!form) {
    return (
      <div style={{ 
        padding: '20px', 
        backgroundColor: '#fef3c7', 
        border: '1px solid #fcd34d', 
        borderRadius: '8px',
        color: '#92400e'
      }}>
        Form not found
      </div>
    );
  }

  if (submitted) {
    return (
      <div style={{ 
        padding: '20px', 
        backgroundColor: '#dcfce7', 
        border: '1px solid #86efac', 
        borderRadius: '8px',
        color: '#166534',
        textAlign: 'center'
      }}>
        <h3 style={{ margin: '0 0 10px 0' }}>Thank you!</h3>
        <p style={{ margin: 0 }}>Your form has been submitted successfully.</p>
      </div>
    );
  }

  return (
    <div style={{
      backgroundColor: 'white',
      borderRadius: '8px',
      border: '1px solid #e5e7eb',
      padding: '24px',
      maxWidth: '600px',
      margin: '0 auto'
    }}>
      <h3 style={{ marginTop: 0, marginBottom: '20px', color: '#374151' }}>
        {form.title || 'Form'}
      </h3>
      
      {form.description && (
        <p style={{ marginBottom: '24px', color: '#6b7280' }}>
          {form.description}
        </p>
      )}

      <form onSubmit={handleSubmit}>
        {form.fields?.map((field, index) => (
          <div key={field.id || index} style={{ marginBottom: '20px' }}>
            <label style={{
              display: 'block',
              marginBottom: '6px',
              fontWeight: '500',
              color: '#374151',
              fontSize: '14px'
            }}>
              {field.label}
              {field.required && <span style={{ color: '#ef4444' }}>*</span>}
            </label>
            
            {renderField(field)}
            
            {field.helpText && (
              <div style={{
                marginTop: '4px',
                fontSize: '12px',
                color: '#6b7280'
              }}>
                {field.helpText}
              </div>
            )}
          </div>
        ))}

        <div style={{ marginTop: '32px', textAlign: 'center' }}>
          <button
            type="submit"
            disabled={submitting}
            style={{
              padding: '12px 32px',
              backgroundColor: submitting ? '#9ca3af' : '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '16px',
              fontWeight: '500',
              cursor: submitting ? 'not-allowed' : 'pointer',
              transition: 'background-color 0.2s'
            }}
          >
            {submitting ? 'Submitting...' : 'Submit Form'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default FormDisplay;
