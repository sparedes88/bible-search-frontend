import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { 
  collection, 
  addDoc, 
  updateDoc, 
  doc, 
  serverTimestamp 
} from 'firebase/firestore';
import { toast } from 'react-toastify';
import commonStyles from '../pages/commonStyles';
import './Forms.css';

const FIELD_TYPES = [
  { value: 'text', label: 'Text Input' },
  { value: 'textarea', label: 'Textarea' },
  { value: 'number', label: 'Number' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'date', label: 'Date' },
  { value: 'time', label: 'Time' },
  { value: 'select', label: 'Dropdown' },
  { value: 'radio', label: 'Radio Buttons' },
  { value: 'checkbox', label: 'Checkboxes' },
  { value: 'file', label: 'File Upload' },
  { value: 'url', label: 'URL' },
  { value: 'boolean', label: 'Yes/No' }
];

const FormBuilder = ({ churchId, form, onSave, onCancel }) => {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    isActive: true,
    badgeEligible: false,
    fields: []
  });
  const [editingField, setEditingField] = useState(null);
  const [newField, setNewField] = useState({
    name: '',
    label: '',
    type: 'text',
    required: false,
    placeholder: '',
    options: [],
    validation: {}
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (form) {
      setFormData({
        title: form.title || '',
        description: form.description || '',
        isActive: form.isActive !== undefined ? form.isActive : true,
        badgeEligible: !!form.badgeEligible,
        fields: form.fields || []
      });
    }
  }, [form]);

  const handleFormDataChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleAddField = () => {
    setNewField({
      name: '',
      label: '',
      type: 'text',
      required: false,
      placeholder: '',
      options: [],
      validation: {}
    });
    setEditingField('new');
  };

  const handleEditField = (index) => {
    setNewField({ ...formData.fields[index] });
    setEditingField(index);
  };

  const handleSaveField = () => {
    if (!newField.name || !newField.label) {
      toast.error('Field name and label are required');
      return;
    }

    // Generate field name from label if not provided
    if (!newField.name) {
      setNewField(prev => ({
        ...prev,
        name: newField.label.toLowerCase().replace(/[^a-z0-9]/g, '_')
      }));
    }

    const fieldData = {
      ...newField,
      id: newField.id || `field_${Date.now()}`
    };

    if (editingField === 'new') {
      setFormData(prev => ({
        ...prev,
        fields: [...prev.fields, fieldData]
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        fields: prev.fields.map((field, index) => 
          index === editingField ? fieldData : field
        )
      }));
    }

    setEditingField(null);
    setNewField({
      name: '',
      label: '',
      type: 'text',
      required: false,
      placeholder: '',
      options: [],
      validation: {}
    });
  };

  const handleDeleteField = (index) => {
    if (!window.confirm('Are you sure you want to delete this field?')) {
      return;
    }

    setFormData(prev => ({
      ...prev,
      fields: prev.fields.filter((_, i) => i !== index)
    }));
  };

  const handleMoveField = (index, direction) => {
    const newFields = [...formData.fields];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    
    if (targetIndex < 0 || targetIndex >= newFields.length) {
      return;
    }

    [newFields[index], newFields[targetIndex]] = [newFields[targetIndex], newFields[index]];
    
    setFormData(prev => ({
      ...prev,
      fields: newFields
    }));
  };

  const handleFieldChange = (property, value) => {
    setNewField(prev => ({
      ...prev,
      [property]: value
    }));
  };

  const handleAddOption = () => {
    setNewField(prev => ({
      ...prev,
      options: [...prev.options, '']
    }));
  };

  const handleOptionChange = (index, value) => {
    setNewField(prev => ({
      ...prev,
      options: prev.options.map((option, i) => i === index ? value : option)
    }));
  };

  const handleRemoveOption = (index) => {
    setNewField(prev => ({
      ...prev,
      options: prev.options.filter((_, i) => i !== index)
    }));
  };

  const handleSaveForm = async () => {
    if (!formData.title) {
      toast.error('Form title is required');
      return;
    }

    if (formData.fields.length === 0) {
      toast.error('At least one field is required');
      return;
    }

    try {
      setSaving(true);
      
      const formPayload = {
        ...formData,
        updatedAt: serverTimestamp()
      };

      if (form && form.id) {
        // Update existing form
        const formRef = doc(db, 'churches', churchId, 'forms', form.id);
        await updateDoc(formRef, formPayload);
        toast.success('Form updated successfully');
      } else {
        // Create new form
        formPayload.createdAt = serverTimestamp();
        const formsRef = collection(db, 'churches', churchId, 'forms');
        await addDoc(formsRef, formPayload);
        toast.success('Form created successfully');
      }

      onSave();
    } catch (error) {
      console.error('Error saving form:', error);
      toast.error('Failed to save form');
    } finally {
      setSaving(false);
    }
  };

  const requiresOptions = ['select', 'radio', 'checkbox'].includes(newField.type);

  return (
    <div style={commonStyles.fullWidthContainer}>
      <div className="form-builder">
        <div className="form-builder-header">
          <h1 style={commonStyles.title}>
            {form ? 'Edit Form' : 'Create New Form'}
          </h1>
        </div>

        {/* Basic Form Information */}
        <div className="form-basic-info">
          <div className="form-group">
            <label className="form-label">Form Title *</label>
            <input
              type="text"
              className="form-input"
              value={formData.title}
              onChange={(e) => handleFormDataChange('title', e.target.value)}
              placeholder="Enter form title"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea
              className="form-textarea"
              value={formData.description}
              onChange={(e) => handleFormDataChange('description', e.target.value)}
              placeholder="Describe what this form is for"
            />
          </div>

          <div style={{ 
            padding: '1.25rem', 
            background: '#F9FAFB', 
            borderRadius: '8px', 
            border: '1px solid #E5E7EB',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem'
          }}>
            <div className="form-checkbox" style={{ 
              padding: '0.75rem', 
              background: 'white', 
              borderRadius: '6px',
              border: '2px solid #E5E7EB',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}>
              <input
                type="checkbox"
                id="isActive"
                checked={formData.isActive}
                onChange={(e) => handleFormDataChange('isActive', e.target.checked)}
                style={{ width: '20px', height: '20px', cursor: 'pointer', marginRight: '12px' }}
              />
              <label htmlFor="isActive" className="form-label" style={{ 
                cursor: 'pointer', 
                fontWeight: '600', 
                fontSize: '1rem',
                margin: 0
              }}>
                ✓ Form is active and accepting submissions
              </label>
            </div>

            <div className="form-checkbox" style={{ 
              padding: '0.75rem', 
              background: 'white', 
              borderRadius: '6px',
              border: '2px solid #E5E7EB',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}>
              <input
                type="checkbox"
                id="badgeEligible"
                checked={formData.badgeEligible}
                onChange={(e) => handleFormDataChange('badgeEligible', e.target.checked)}
                style={{ width: '20px', height: '20px', cursor: 'pointer', marginRight: '12px' }}
              />
              <label htmlFor="badgeEligible" className="form-label" style={{ 
                cursor: 'pointer', 
                fontWeight: '600', 
                fontSize: '1rem',
                margin: 0
              }}>
                ⭐ Counts toward Cool Techy Badge
              </label>
            </div>
          </div>
        </div>

        {/* Fields Section */}
        <div className="fields-section">
          <div className="fields-header">
            <h3>Form Fields</h3>
            <button
              type="button"
              onClick={handleAddField}
              className="add-field-btn"
            >
              <span>+</span>
              Add Field
            </button>
          </div>

          <div className="fields-list">
            {formData.fields.map((field, index) => (
              <div key={field.id || index} className="field-item">
                <div className="field-header">
                  <div className="field-info">
                    <div className="field-name">{field.label}</div>
                    <div className="field-type">{field.type} {field.required && '(Required)'}</div>
                  </div>
                  <div className="field-actions">
                    {index > 0 && (
                      <button
                        type="button"
                        onClick={() => handleMoveField(index, 'up')}
                        className="field-action-btn move-field-btn"
                      >
                        ↑
                      </button>
                    )}
                    {index < formData.fields.length - 1 && (
                      <button
                        type="button"
                        onClick={() => handleMoveField(index, 'down')}
                        className="field-action-btn move-field-btn"
                      >
                        ↓
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleEditField(index)}
                      className="field-action-btn edit-field-btn"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteField(index)}
                      className="field-action-btn delete-field-btn"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Field Editor */}
        {editingField !== null && (
          <div className="field-item editing">
            <h4>Field Configuration</h4>
            <div className="field-editor">
              <div className="field-editor-grid">
                <div className="form-group">
                  <label className="form-label">Field Label *</label>
                  <input
                    type="text"
                    className="form-input"
                    value={newField.label}
                    onChange={(e) => handleFieldChange('label', e.target.value)}
                    placeholder="Enter field label"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Field Name</label>
                  <input
                    type="text"
                    className="form-input"
                    value={newField.name}
                    onChange={(e) => handleFieldChange('name', e.target.value)}
                    placeholder="Auto-generated from label"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Field Type *</label>
                  <select
                    className="form-select"
                    value={newField.type}
                    onChange={(e) => handleFieldChange('type', e.target.value)}
                  >
                    {FIELD_TYPES.map(type => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Placeholder</label>
                  <input
                    type="text"
                    className="form-input"
                    value={newField.placeholder}
                    onChange={(e) => handleFieldChange('placeholder', e.target.value)}
                    placeholder="Placeholder text"
                  />
                </div>
              </div>

              <div className="form-checkbox">
                <input
                  type="checkbox"
                  id="fieldRequired"
                  checked={newField.required}
                  onChange={(e) => handleFieldChange('required', e.target.checked)}
                />
                <label htmlFor="fieldRequired" className="form-label">Required field</label>
              </div>

              {/* Options for select, radio, checkbox fields */}
              {requiresOptions && (
                <div className="options-section">
                  <label className="form-label">Options</label>
                  <div className="options-list">
                    {newField.options.map((option, index) => (
                      <div key={index} className="option-item">
                        <input
                          type="text"
                          className="option-input"
                          value={option}
                          onChange={(e) => handleOptionChange(index, e.target.value)}
                          placeholder={`Option ${index + 1}`}
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveOption(index)}
                          className="remove-option-btn"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={handleAddOption}
                    className="add-option-btn"
                  >
                    Add Option
                  </button>
                </div>
              )}

              <div className="field-editor-actions">
                <button
                  type="button"
                  onClick={handleSaveField}
                  className="save-field-btn"
                >
                  Save Field
                </button>
                <button
                  type="button"
                  onClick={() => setEditingField(null)}
                  className="cancel-field-btn"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Form Actions */}
        <div className="form-builder-actions">
          <button
            type="button"
            onClick={onCancel}
            className="cancel-form-btn"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSaveForm}
            className="save-form-btn"
            disabled={saving}
          >
            {saving ? 'Saving...' : (form ? 'Update Form' : 'Create Form')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FormBuilder;
