import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { 
  collection, 
  getDocs, 
  doc, 
  deleteDoc, 
  query, 
  orderBy,
  addDoc,
  updateDoc,
  serverTimestamp 
} from 'firebase/firestore';
import { toast } from 'react-toastify';
import commonStyles from '../pages/commonStyles';
import './Forms.css';

const FormEntries = ({ churchId, form, onBack }) => {
  const { user } = useAuth();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const [showAddEntry, setShowAddEntry] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [newEntry, setNewEntry] = useState({});

  useEffect(() => {
    fetchEntries();
  }, [churchId, form.id]);

  useEffect(() => {
    // Initialize new entry with default values
    const initialEntry = {};
    form.fields.forEach(field => {
      if (field.type === 'checkbox') {
        initialEntry[field.name] = [];
      } else if (field.type === 'boolean') {
        initialEntry[field.name] = false;
      } else {
        initialEntry[field.name] = '';
      }
    });
    setNewEntry(initialEntry);
  }, [form.fields]);

  const fetchEntries = async () => {
    try {
      setLoading(true);
      const entriesRef = collection(db, 'churches', churchId, 'forms', form.id, 'entries');
      const q = query(entriesRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      
      const entriesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      setEntries(entriesData);
    } catch (error) {
      console.error('Error fetching entries:', error);
      toast.error('Failed to load entries');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteEntry = async (entryId) => {
    if (!window.confirm('Are you sure you want to delete this entry? This action cannot be undone.')) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'churches', churchId, 'forms', form.id, 'entries', entryId));
      toast.success('Entry deleted successfully');
      fetchEntries();
    } catch (error) {
      console.error('Error deleting entry:', error);
      toast.error('Failed to delete entry');
    }
  };

  const handleAddEntry = () => {
    setEditingEntry(null);
    setShowAddEntry(true);
  };

  const handleEditEntry = (entry) => {
    setEditingEntry(entry);
    setNewEntry({ ...entry });
    setShowAddEntry(true);
  };

  const handleSaveEntry = async () => {
    try {
      // Validate required fields
      for (const field of form.fields) {
        if (field.required) {
          const value = newEntry[field.name];
          if (!value || (Array.isArray(value) && value.length === 0)) {
            toast.error(`${field.label} is required`);
            return;
          }
        }
      }

      const entryData = {
        ...newEntry,
        formId: form.id,
        submittedBy: user?.email || 'anonymous',
        updatedAt: serverTimestamp()
      };

      if (editingEntry) {
        // Update existing entry
        const entryRef = doc(db, 'churches', churchId, 'forms', form.id, 'entries', editingEntry.id);
        await updateDoc(entryRef, entryData);
        toast.success('Entry updated successfully');
      } else {
        // Create new entry
        entryData.createdAt = serverTimestamp();
        const entriesRef = collection(db, 'churches', churchId, 'forms', form.id, 'entries');
        await addDoc(entriesRef, entryData);
        toast.success('Entry created successfully');
      }

      setShowAddEntry(false);
      setEditingEntry(null);
      fetchEntries();
    } catch (error) {
      console.error('Error saving entry:', error);
      toast.error('Failed to save entry');
    }
  };

  const handleFieldChange = (fieldName, value) => {
    setNewEntry(prev => ({
      ...prev,
      [fieldName]: value
    }));
  };

  const handleCheckboxChange = (fieldName, option, checked) => {
    setNewEntry(prev => {
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

  const exportToCSV = () => {
    if (entries.length === 0) {
      toast.error('No entries to export');
      return;
    }

    const headers = ['Submission Date', 'Submitted By', ...form.fields.map(field => field.label)];
    const csvData = [
      headers,
      ...entries.map(entry => [
        entry.createdAt ? new Date(entry.createdAt.toDate()).toLocaleString() : 'Unknown',
        entry.submittedBy || 'Anonymous',
        ...form.fields.map(field => {
          const value = entry[field.name];
          if (Array.isArray(value)) {
            return value.join(', ');
          }
          return value || '';
        })
      ])
    ];

    const csvContent = csvData.map(row => 
      row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${form.title}_entries.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const renderFieldValue = (field, value) => {
    if (value === null || value === undefined) return '-';
    
    switch (field.type) {
      case 'checkbox':
        return Array.isArray(value) ? value.join(', ') : value;
      case 'boolean':
        return value ? 'Yes' : 'No';
      case 'date':
        return value ? new Date(value).toLocaleDateString() : '-';
      case 'time':
        return value || '-';
      case 'file':
        return value ? (
          <a href={value} target="_blank" rel="noopener noreferrer" className="file-link">
            View File
          </a>
        ) : '-';
      case 'url':
        return value ? (
          <a href={value} target="_blank" rel="noopener noreferrer" className="url-link">
            {value}
          </a>
        ) : '-';
      default:
        return String(value);
    }
  };

  const renderFormField = (field) => {
    const value = newEntry[field.name] || '';
    
    switch (field.type) {
      case 'textarea':
        return (
          <textarea
            className="form-textarea"
            value={value}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            placeholder={field.placeholder}
            required={field.required}
          />
        );
      
      case 'select':
        return (
          <select
            className="form-select"
            value={value}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            required={field.required}
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
                  required={field.required}
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
            required={field.required}
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
            required={field.required}
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
            required={field.required}
          />
        );
      
      case 'date':
        return (
          <input
            type="date"
            className="form-input"
            value={value}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            required={field.required}
          />
        );
      
      case 'time':
        return (
          <input
            type="time"
            className="form-input"
            value={value}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            required={field.required}
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
            required={field.required}
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
            required={field.required}
          />
        );
    }
  };

  const filteredEntries = entries.filter(entry => {
    if (!searchTerm) return true;
    
    return form.fields.some(field => {
      const value = entry[field.name];
      if (typeof value === 'string') {
        return value.toLowerCase().includes(searchTerm.toLowerCase());
      }
      if (Array.isArray(value)) {
        return value.some(v => v.toLowerCase().includes(searchTerm.toLowerCase()));
      }
      return false;
    });
  });

  if (loading) {
    return (
      <div style={commonStyles.container}>
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <div>Loading entries...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={commonStyles.container}>
      <button 
        onClick={onBack}
        style={commonStyles.backButtonLink}
        className="back-button"
      >
        ← Back to Forms
      </button>
      
      <div style={{ marginTop: "1rem" }}>
        <div style={{ 
          display: "flex", 
          justifyContent: "space-between", 
          alignItems: "center", 
          marginBottom: "2rem" 
        }}>
          <div>
            <h1 style={commonStyles.title}>{form.title} - Entries</h1>
            <p style={{ color: "#6b7280", margin: "0.5rem 0" }}>{form.description}</p>
            <p style={{ color: "#6b7280", fontSize: "0.875rem" }}>
              Total entries: {filteredEntries.length}
            </p>
          </div>
          
          <div style={{ display: "flex", gap: "1rem" }}>
            {entries.length > 0 && (
              <button
                onClick={exportToCSV}
                style={{
                  backgroundColor: "#10b981",
                  color: "white",
                  padding: "12px 24px",
                  borderRadius: "8px",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "16px",
                  fontWeight: "500"
                }}
              >
                Export CSV
              </button>
            )}
            
            {user && (user.role === "admin" || user.role === "global_admin") && (
              <button
                onClick={handleAddEntry}
                style={{
                  backgroundColor: "#4F46E5",
                  color: "white",
                  padding: "12px 24px",
                  borderRadius: "8px",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "16px",
                  fontWeight: "500"
                }}
              >
                Add Entry
              </button>
            )}
          </div>
        </div>

        {/* Search and Filters */}
        <div style={{ 
          display: "flex", 
          gap: "1rem", 
          marginBottom: "2rem",
          padding: "1rem",
          backgroundColor: "white",
          borderRadius: "8px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)"
        }}>
          <input
            type="text"
            placeholder="Search entries..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              flex: 1,
              padding: "0.75rem",
              border: "2px solid #e5e7eb",
              borderRadius: "6px"
            }}
          />
        </div>

        {/* Entry Form Modal */}
        {showAddEntry && (
          <div className="modal-overlay" onClick={() => setShowAddEntry(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h3>{editingEntry ? 'Edit Entry' : 'Add New Entry'}</h3>
              <form onSubmit={(e) => { e.preventDefault(); handleSaveEntry(); }}>
                {form.fields.map(field => (
                  <div key={field.name} className="form-group">
                    <label className="form-label">
                      {field.label} {field.required && '*'}
                    </label>
                    {renderFormField(field)}
                  </div>
                ))}
                <div style={{ display: "flex", gap: "1rem", marginTop: "2rem" }}>
                  <button
                    type="submit"
                    className="save-form-btn"
                  >
                    {editingEntry ? 'Update Entry' : 'Save Entry'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddEntry(false)}
                    className="cancel-form-btn"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Entries List */}
        {filteredEntries.length === 0 ? (
          <div style={{
            textAlign: "center",
            padding: "4rem 2rem",
            backgroundColor: "white",
            borderRadius: "12px",
            border: "2px dashed #e5e7eb"
          }}>
            <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>📄</div>
            <h3 style={{ marginBottom: "1rem", color: "#374151" }}>No Entries Yet</h3>
            <p style={{ color: "#6b7280", marginBottom: "2rem" }}>
              {searchTerm ? 'No entries match your search criteria.' : 'No one has submitted this form yet.'}
            </p>
          </div>
        ) : (
          <div className="entries-table-container" style={{
            backgroundColor: "white",
            borderRadius: "12px",
            overflow: "hidden",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)"
          }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead style={{ backgroundColor: "#f9fafb" }}>
                  <tr>
                    <th style={{ padding: "1rem", textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                      Submission Date
                    </th>
                    <th style={{ padding: "1rem", textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                      Submitted By
                    </th>
                    {form.fields.map(field => (
                      <th key={field.name} style={{ 
                        padding: "1rem", 
                        textAlign: "left", 
                        borderBottom: "1px solid #e5e7eb",
                        minWidth: "150px"
                      }}>
                        {field.label}
                      </th>
                    ))}
                    {user && (user.role === "admin" || user.role === "global_admin") && (
                      <th style={{ padding: "1rem", textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                        Actions
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((entry, index) => (
                    <tr key={entry.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "1rem" }}>
                        {entry.createdAt ? new Date(entry.createdAt.toDate()).toLocaleString() : 'Unknown'}
                      </td>
                      <td style={{ padding: "1rem" }}>
                        {entry.submittedBy || 'Anonymous'}
                      </td>
                      {form.fields.map(field => (
                        <td key={field.name} style={{ padding: "1rem" }}>
                          {renderFieldValue(field, entry[field.name])}
                        </td>
                      ))}
                      {user && (user.role === "admin" || user.role === "global_admin") && (
                        <td style={{ padding: "1rem" }}>
                          <div style={{ display: "flex", gap: "0.5rem" }}>
                            <button
                              onClick={() => handleEditEntry(entry)}
                              className="action-btn edit-btn"
                              style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteEntry(entry.id)}
                              className="action-btn delete-btn"
                              style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FormEntries;
