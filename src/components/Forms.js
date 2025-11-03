import React, { useState, useEffect, useRef } from 'react';
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
  getDoc,
  onSnapshot
} from 'firebase/firestore';
import { toast } from 'react-toastify';
import commonStyles from '../pages/commonStyles';
import ChurchHeader from './ChurchHeader';
import FormBuilder from './FormBuilder';
import FormEntries from './FormEntries';
import { hasPermission, canManageModule, hasFormPermission, getUserAccessibleForms } from '../utils/enhancedPermissions';
import './Forms.css';
import { QRCodeCanvas as QRCode } from 'qrcode.react';

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
  const [showShareModal, setShowShareModal] = useState(false);
  const [selectedFormForShare, setSelectedFormForShare] = useState(null);
  const qrRef = useRef(null);
  
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
      setCanView(false);
      return;
    }

    try {
      // Simplified permission checking - allow viewing for authenticated users
      // Only restrict create/edit/delete actions
      setCanView(true); // Allow all authenticated users to view forms

      // Check create permission with timeout
      try {
        const canCreateResult = await Promise.race([
          hasPermission(user, id, 'forms', 'create'),
          new Promise(resolve => setTimeout(() => resolve(false), 3000))
        ]);
        setCanCreate(canCreateResult);
      } catch (error) {
        console.error('Error checking create permission:', error);
        setCanCreate(user.role === 'admin' || user.role === 'global_admin');
      }

      // Check edit permission with timeout
      try {
        const canEditResult = await Promise.race([
          hasPermission(user, id, 'forms', 'update'),
          new Promise(resolve => setTimeout(() => resolve(false), 3000))
        ]);
        setCanEdit(canEditResult);
      } catch (error) {
        console.error('Error checking edit permission:', error);
        setCanEdit(user.role === 'admin' || user.role === 'global_admin');
      }

      // Check delete permission with timeout
      try {
        const canDeleteResult = await Promise.race([
          hasPermission(user, id, 'forms', 'delete'),
          new Promise(resolve => setTimeout(() => resolve(false), 3000))
        ]);
        setCanDelete(canDeleteResult);
      } catch (error) {
        console.error('Error checking delete permission:', error);
        setCanDelete(user.role === 'admin' || user.role === 'global_admin');
      }

    } catch (error) {
      console.error('Error in permission checking:', error);
      // Fallback - allow viewing, restrict actions to admins
      setCanView(true);
      setCanCreate(user.role === 'admin' || user.role === 'global_admin');
      setCanEdit(user.role === 'admin' || user.role === 'global_admin');
      setCanDelete(user.role === 'admin' || user.role === 'global_admin');
    } finally {
      setPermissionsLoading(false);
    }
  };

  const fetchForms = async () => {
    try {
      setLoading(true);

      if (!user) {
        setForms([]);
        return;
      }

      // Simplified - get all forms for the church, filtering will be done client-side
      const formsRef = collection(db, 'churches', id, 'forms');
      const q = query(formsRef, orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);

      const formsData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setForms(formsData);
    } catch (error) {
      console.error('Error fetching forms:', error);
      toast.error('Failed to load forms');
      setForms([]);
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
    
    // Navigate to dedicated entries page using router
    window.location.href = `/organization/${id}/forms/${form.id}/entries`;
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

  const handleShowShare = (form) => {
    setSelectedFormForShare(form);
    setShowShareModal(true);
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

  // FormEntries now has its own route - removed inline render

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
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #F8FAFC 0%, #EEF2FF 100%)',
      padding: '24px'
    }}>
      <div style={{
        maxWidth: '100%',
        margin: '0 auto',
        backgroundColor: 'white',
        padding: '2rem',
        borderRadius: '16px',
        border: '1px solid #E5E7EB',
        boxShadow: '0 12px 24px rgba(15, 23, 42, 0.08)'
      }}>
        <Link to={`/church/${id}/mi-organizacion`} style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
          color: '#4f46e5',
          textDecoration: 'none',
          fontSize: '0.875rem',
          fontWeight: '500',
          marginBottom: '1rem'
        }}>
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
            <h1 style={{ ...commonStyles.title, fontSize: '1.75rem' }}>Forms Management</h1>
          
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
                onShare={() => handleShowShare(form)}
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

      {/* Share Modal */}
      {showShareModal && selectedFormForShare && (
        <div className="modal-overlay" onClick={() => setShowShareModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Share Form: {selectedFormForShare.title}</h3>
            <p style={{ color: '#6b7280', marginBottom: '1rem' }}>
              Share this form using a QR code or direct link.
            </p>

            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ padding: '1rem', border: '1px solid #e5e7eb', borderRadius: '8px', backgroundColor: '#f9fafb' }}>
                <QRCode
                  ref={qrRef}
                  value={`${window.location.origin}/church/${id}/form/${selectedFormForShare.id}`}
                  size={160}
                  level="H"
                  includeMargin
                />
              </div>
              <div style={{ flex: 1, minWidth: 260 }}>
                <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem' }}>Form Link:</label>
                <input
                  readOnly
                  value={`${window.location.origin}/church/${id}/form/${selectedFormForShare.id}`}
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
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                  <button
                    onClick={() => {
                      const link = `${window.location.origin}/church/${id}/form/${selectedFormForShare.id}`;
                      navigator.clipboard.writeText(link).then(() => toast.success('Link copied!')).catch(() => toast.error('Copy failed'));
                    }}
                    style={{ backgroundColor: '#4f46e5', color: 'white', padding: '0.5rem 1rem', borderRadius: '6px', border: 'none', cursor: 'pointer' }}
                  >
                    Copy Link
                  </button>
                  <button
                    onClick={() => {
                      const link = `${window.location.origin}/church/${id}/form/${selectedFormForShare.id}`;
                      window.open(link, '_blank', 'noopener');
                    }}
                    style={{ backgroundColor: '#10b981', color: 'white', padding: '0.5rem 1rem', borderRadius: '6px', border: 'none', cursor: 'pointer' }}
                  >
                    Open Form
                  </button>
                  <button
                    onClick={() => {
                      try {
                        // Download QR as PNG (works for canvas render)
                        const canvas = document.querySelector('.modal-content canvas');
                        if (!canvas) throw new Error('QR not ready');
                        const url = canvas.toDataURL('image/png');
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${selectedFormForShare.title || 'form'}-qr.png`;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                      } catch (e) {
                        toast.error('Failed to download QR');
                      }
                    }}
                    style={{ backgroundColor: '#111827', color: 'white', padding: '0.5rem 1rem', borderRadius: '6px', border: 'none', cursor: 'pointer' }}
                  >
                    Download QR
                  </button>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowShareModal(false)}
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

const FormCard = ({ form, user, canEdit, canDelete, onEdit, onDelete, onViewEntries, onShowEmbed, onShare }) => {
  const [entryCount, setEntryCount] = useState(0);
  const [loadingCount, setLoadingCount] = useState(true);
  const { id: churchId } = useParams();

  // Deterministic gradient selection per form
  const gradients = [
    'linear-gradient(135deg, #6366F1 0%, #14B8A6 100%)',
    'linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%)',
    'linear-gradient(135deg, #06B6D4 0%, #3B82F6 100%)',
    'linear-gradient(135deg, #F59E0B 0%, #EF4444 100%)',
    'linear-gradient(135deg, #10B981 0%, #3B82F6 100%)',
    'linear-gradient(135deg, #F43F5E 0%, #8B5CF6 100%)',
    'linear-gradient(135deg, #22C55E 0%, #14B8A6 100%)',
    'linear-gradient(135deg, #0EA5E9 0%, #6366F1 100%)'
  ];
  const getGradient = () => {
    const key = `${form?.id || ''}${form?.title || ''}`;
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    }
    return gradients[hash % gradients.length];
  };

  useEffect(() => {
    // Live subscription to entries count for this form
    try {
      if (!churchId || !form?.id) return;
      const entriesRef = collection(db, 'churches', churchId, 'forms', form.id, 'entries');
      const unsubscribe = onSnapshot(entriesRef, (snapshot) => {
        setEntryCount(snapshot.size);
        setLoadingCount(false);
      }, (err) => {
        console.error('Error subscribing to entry count:', err);
        setLoadingCount(false);
      });
      return () => unsubscribe && unsubscribe();
    } catch (e) {
      console.error('Entry count setup error:', e);
      setLoadingCount(false);
    }
  }, [churchId, form?.id]);

  return (
    <div className="form-card">
      <div className="form-card-cover" style={{ background: getGradient() }}>
        <div className="form-cover-initial">
          {(form.title || 'F').trim().charAt(0).toUpperCase()}
        </div>
      </div>
      <div className="form-card-header">
        <h3 className="form-title">{form.title}</h3>
        <div className="form-status">
          <span className={`status-badge ${form.isActive ? 'active' : 'inactive'}`}>
            {form.isActive ? 'Active' : 'Inactive'}
          </span>
          {form.badgeEligible && (
            <span className="status-badge" style={{ 
              backgroundColor: '#FEF3C7', 
              color: '#92400E',
              marginLeft: '0.5rem'
            }}>
              ⭐ Badge
            </span>
          )}
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
          onClick={onShare}
          className="action-btn share-btn"
          style={{ backgroundColor: "#10b981", color: "white" }}
        >
          Share
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
