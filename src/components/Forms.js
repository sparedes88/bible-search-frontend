import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { 
  collection, 
  getDocs, 
  doc, 
  deleteDoc, 
  query, 
  orderBy, 
  where,
  addDoc,
  updateDoc,
  getDoc
} from 'firebase/firestore';
import { toast } from 'react-toastify';
import commonStyles from '../pages/commonStyles';
import ChurchHeader from './ChurchHeader';
import FormBuilder from './FormBuilder';
import FormEntries from './FormEntries';
import { hasPermission, canManageModule, hasFormPermission, getUserAccessibleForms } from '../utils/enhancedPermissions';
import './Forms.css';

const Forms = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showFormBuilder, setShowFormBuilder] = useState(false);
  const [selectedForm, setSelectedForm] = useState(null);
  const [showEntries, setShowEntries] = useState(false);
  const [editingForm, setEditingForm] = useState(null);
  const [showEmbedModal, setShowEmbedModal] = useState(false);
  const [selectedFormForEmbed, setSelectedFormForEmbed] = useState(null);
  
  // Permission states
  const [canCreate, setCanCreate] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [canView, setCanView] = useState(false);
  const [permissionsLoading, setPermissionsLoading] = useState(true);

  useEffect(() => {
    fetchForms();
    checkPermissions();
  }, [id, user]);

  const checkPermissions = async () => {
    if (!user) {
      setPermissionsLoading(false);
      return;
    }

    try {
      const [canCreateForms, canEditForms, canDeleteForms, canViewForms] = await Promise.all([
        hasPermission(user, id, 'forms', 'create'),
        hasPermission(user, id, 'forms', 'update'),
        hasPermission(user, id, 'forms', 'delete'),
        hasPermission(user, id, 'forms', 'read')
      ]);

      setCanCreate(canCreateForms);
      setCanEdit(canEditForms);
      setCanDelete(canDeleteForms);
      setCanView(canViewForms);
    } catch (error) {
      console.error('Error checking permissions:', error);
      // Fallback to basic role checking for backward compatibility
      const isAdmin = user.role === 'admin' || user.role === 'global_admin';
      setCanCreate(isAdmin);
      setCanEdit(isAdmin);
      setCanDelete(isAdmin);
      setCanView(true); // Allow viewing for all authenticated users
    } finally {
      setPermissionsLoading(false);
    }
  };

  const fetchForms = async () => {
    try {
      setLoading(true);
      
      // Check if user has module-level access
      if (!await hasPermission(user, id, 'forms', 'read')) {
        setForms([]);
        return;
      }

      // Get forms user has specific access to
      const accessibleForms = await getUserAccessibleForms(user, id);
      
      setForms(accessibleForms);
    } catch (error) {
      console.error('Error fetching forms:', error);
      toast.error('Failed to load forms');
    } finally {
      setLoading(false);
    }
  };

  // Check if user can perform action on specific form
  const canPerformFormAction = async (formId, action) => {
    if (!user) return false;
    
    try {
      return await hasFormPermission(user, id, formId, action);
    } catch (error) {
      console.error('Error checking form permission:', error);
      return false;
    }
  };

  const handleCreateForm = () => {
    setEditingForm(null);
    setShowFormBuilder(true);
  };

  const handleEditForm = async (form) => {
    // Check if user can edit this specific form
    if (!await canPerformFormAction(form.id, 'update')) {
      toast.error('You do not have permission to edit this form');
      return;
    }
    
    setEditingForm(form);
    setShowFormBuilder(true);
  };

  const handleDeleteForm = async (formId) => {
    // Check if user can delete this specific form
    if (!await canPerformFormAction(formId, 'delete')) {
      toast.error('You do not have permission to delete this form');
      return;
    }

    if (!window.confirm('Are you sure you want to delete this form? This action cannot be undone.')) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'churches', id, 'forms', formId));
      toast.success('Form deleted successfully');
      fetchForms();
    } catch (error) {
      console.error('Error deleting form:', error);
      toast.error('Failed to delete form');
    }
  };

  const handleViewEntries = async (form) => {
    // Check if user can read this specific form entries
    if (!await canPerformFormAction(form.id, 'read')) {
      toast.error('You do not have permission to view entries for this form');
      return;
    }
    
    setSelectedForm(form);
    setShowEntries(true);
  };

  const handleCopyFormLink = (formId) => {
    const formLink = `${window.location.origin}/church/${id}/form/${formId}`;
    navigator.clipboard.writeText(formLink).then(() => {
      toast.success('Form link copied to clipboard!');
    }).catch(() => {
      toast.error('Failed to copy link');
    });
  };

  const handleFormSaved = () => {
    setShowFormBuilder(false);
    setEditingForm(null);
    fetchForms();
  };

  const handleShowEmbedCode = (form) => {
    setSelectedFormForEmbed(form);
    setShowEmbedModal(true);
  };

  const getEmbedCode = (form) => {
    return `<iframe src="${window.location.origin}/church/${id}/embed/${form.id}" width="100%" height="600" frameborder="0" style="border: 1px solid #e5e7eb; border-radius: 8px;"></iframe>`;
  };

  const getEntryCount = async (formId) => {
    try {
      const entriesRef = collection(db, 'churches', id, 'forms', formId, 'entries');
      const snapshot = await getDocs(entriesRef);
      return snapshot.size;
    } catch (error) {
      console.error('Error getting entry count:', error);
      return 0;
    }
  };

  if (showFormBuilder) {
    return (
      <FormBuilder
        churchId={id}
        form={editingForm}
        onSave={handleFormSaved}
        onCancel={() => {
          setShowFormBuilder(false);
          setEditingForm(null);
        }}
      />
    );
  }

  if (showEntries && selectedForm) {
    return (
      <FormEntries
        churchId={id}
        form={selectedForm}
        onBack={() => {
          setShowEntries(false);
          setSelectedForm(null);
        }}
      />
    );
  }

  if (loading || permissionsLoading) {
    return (
      <div style={commonStyles.container}>
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <div>Loading forms...</div>
        </div>
      </div>
    );
  }

  // Check if user has permission to view forms
  if (!canView) {
    return (
      <div style={commonStyles.container}>
        <Link to={`/organization/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
          ← Back to Mi Organización
        </Link>
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <h2>Access Denied</h2>
          <p>You don't have permission to view forms.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={commonStyles.container}>
      <Link to={`/church/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to Mi Organización
      </Link>
      
      <ChurchHeader id={id} applyShadow={false} allowEditBannerLogo={true} />
      
      <div style={{ marginTop: "-30px" }}>
        <div style={{ 
          display: "flex", 
          justifyContent: "space-between", 
          alignItems: "center", 
          marginBottom: "2rem" 
        }}>
          <h1 style={commonStyles.title}>Forms Management</h1>
          
          {canCreate && (
            <button
              onClick={handleCreateForm}
              className="create-form-btn"
              style={{
                backgroundColor: "#4F46E5",
                color: "white",
                padding: "12px 24px",
                borderRadius: "8px",
                border: "none",
                cursor: "pointer",
                fontSize: "16px",
                fontWeight: "500",
                display: "flex",
                alignItems: "center",
                gap: "8px"
              }}
            >
              <span>+</span>
              Create New Form
            </button>
          )}
        </div>

        {forms.length === 0 ? (
          <div className="empty-state">
            <div style={{
              textAlign: "center",
              padding: "4rem 2rem",
              backgroundColor: "white",
              borderRadius: "12px",
              border: "2px dashed #e5e7eb"
            }}>
              <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>📝</div>
              <h3 style={{ marginBottom: "1rem", color: "#374151" }}>No Forms Created Yet</h3>
              <p style={{ color: "#6b7280", marginBottom: "2rem" }}>
                Create your first form to start collecting information from your congregation.
              </p>
              {canCreate && (
                <button
                  onClick={handleCreateForm}
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
                  Create Your First Form
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="forms-grid">
            {forms.map((form) => (
              <FormCard
                key={form.id}
                form={form}
                user={user}
                canEdit={canEdit}
                canDelete={canDelete}
                onEdit={() => handleEditForm(form)}
                onDelete={() => handleDeleteForm(form.id)}
                onViewEntries={() => handleViewEntries(form)}
                onShowEmbed={() => handleShowEmbedCode(form)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Embed Code Modal */}
      {showEmbedModal && selectedFormForEmbed && (
        <div className="modal-overlay" onClick={() => setShowEmbedModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Embed Form: {selectedFormForEmbed.title}</h3>
            <p style={{ color: '#6b7280', marginBottom: '1rem' }}>
              Copy and paste this code into your website to embed this form:
            </p>
            
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem' }}>
                Embed Code:
              </label>
              <textarea
                readOnly
                value={getEmbedCode(selectedFormForEmbed)}
                style={{
                  width: '100%',
                  height: '120px',
                  padding: '0.75rem',
                  border: '2px solid #e5e7eb',
                  borderRadius: '6px',
                  fontFamily: 'monospace',
                  fontSize: '0.875rem',
                  backgroundColor: '#f9fafb',
                  resize: 'none'
                }}
                onClick={(e) => e.target.select()}
              />
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem' }}>
                Direct Embed URL:
              </label>
              <input
                readOnly
                value={`${window.location.origin}/church/${id}/embed/${selectedFormForEmbed.id}`}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '2px solid #e5e7eb',
                  borderRadius: '6px',
                  fontFamily: 'monospace',
                  fontSize: '0.875rem',
                  backgroundColor: '#f9fafb'
                }}
                onClick={(e) => e.target.select()}
              />
            </div>

            <div style={{ 
              backgroundColor: '#f3f4f6', 
              padding: '1rem', 
              borderRadius: '6px', 
              marginBottom: '1.5rem',
              fontSize: '0.875rem'
            }}>
              <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem' }}>Usage Instructions:</h4>
              <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
                <li>The iframe will be responsive and adjust to your website's width</li>
                <li>Default height is 600px, you can adjust it in the code</li>
                <li>The form will work on any website that allows iframes</li>
                <li>Submissions will be tracked in your Forms dashboard</li>
              </ul>
            </div>

            <div style={{ display: "flex", gap: "1rem" }}>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(getEmbedCode(selectedFormForEmbed)).then(() => {
                    toast.success('Embed code copied to clipboard!');
                  }).catch(() => {
                    toast.error('Failed to copy embed code');
                  });
                }}
                style={{
                  backgroundColor: "#4f46e5",
                  color: "white",
                  padding: "0.75rem 1.5rem",
                  borderRadius: "6px",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  fontWeight: "500"
                }}
              >
                Copy Embed Code
              </button>
              <button
                onClick={() => {
                  const embedUrl = `${window.location.origin}/church/${id}/embed/${selectedFormForEmbed.id}`;
                  navigator.clipboard.writeText(embedUrl).then(() => {
                    toast.success('Embed URL copied to clipboard!');
                  }).catch(() => {
                    toast.error('Failed to copy URL');
                  });
                }}
                style={{
                  backgroundColor: "#10b981",
                  color: "white",
                  padding: "0.75rem 1.5rem",
                  borderRadius: "6px",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  fontWeight: "500"
                }}
              >
                Copy URL
              </button>
              <button
                onClick={() => setShowEmbedModal(false)}
                style={{
                  backgroundColor: "#6b7280",
                  color: "white",
                  padding: "0.75rem 1.5rem",
                  borderRadius: "6px",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  fontWeight: "500"
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const FormCard = ({ form, user, canEdit, canDelete, onEdit, onDelete, onViewEntries, onShowEmbed }) => {
  const [entryCount, setEntryCount] = useState(0);
  const [loadingCount, setLoadingCount] = useState(true);

  useEffect(() => {
    const fetchEntryCount = async () => {
      try {
        const entriesRef = collection(db, 'churches', form.churchId, 'forms', form.id, 'entries');
        const snapshot = await getDocs(entriesRef);
        setEntryCount(snapshot.size);
      } catch (error) {
        console.error('Error fetching entry count:', error);
      } finally {
        setLoadingCount(false);
      }
    };

    fetchEntryCount();
  }, [form.id, form.churchId]);

  return (
    <div className="form-card">
      <div className="form-card-header">
        <h3 className="form-title">{form.title}</h3>
        <div className="form-status">
          <span className={`status-badge ${form.isActive ? 'active' : 'inactive'}`}>
            {form.isActive ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>
      
      <p className="form-description">{form.description}</p>
      
      <div className="form-meta">
        <div className="meta-item">
          <span className="meta-label">Fields:</span>
          <span className="meta-value">{form.fields?.length || 0}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Entries:</span>
          <span className="meta-value">
            {loadingCount ? '...' : entryCount}
          </span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Created:</span>
          <span className="meta-value">
            {form.createdAt ? new Date(form.createdAt.toDate()).toLocaleDateString() : 'Unknown'}
          </span>
        </div>
      </div>

      <div className="form-actions">
        <button
          onClick={onViewEntries}
          className="action-btn view-btn"
        >
          View Entries
        </button>
        
        <button
          onClick={() => {
            const formLink = `${window.location.origin}/church/${form.churchId || window.location.pathname.split('/')[2]}/form/${form.id}`;
            navigator.clipboard.writeText(formLink).then(() => {
              toast.success('Form link copied to clipboard!');
            }).catch(() => {
              toast.error('Failed to copy link');
            });
          }}
          className="action-btn share-btn"
          style={{ backgroundColor: "#10b981", color: "white" }}
        >
          Share Link
        </button>
        
        <button
          onClick={onShowEmbed}
          className="action-btn embed-btn"
          style={{ backgroundColor: "#8b5cf6", color: "white" }}
        >
          Embed Code
        </button>
        
        {canEdit && (
          <button
            onClick={onEdit}
            className="action-btn edit-btn"
          >
            Edit
          </button>
        )}
        {canDelete && (
          <button
            onClick={onDelete}
            className="action-btn delete-btn"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
};

export default Forms;
