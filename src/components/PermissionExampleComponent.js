import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { 
  hasFormPermission, 
  hasInventoryPermission, 
  hasCategoryPermission,
  hasGalleryPermission,
  getUserAccessibleForms,
  getUserAccessibleInventory
} from '../utils/enhancedPermissions';
import { toast } from 'react-toastify';

/**
 * Example component demonstrating granular permission usage
 * This shows how to implement resource-specific permissions
 */
const PermissionExampleComponent = () => {
  const { id: churchId } = useParams();
  const { user } = useAuth();
  const [accessibleForms, setAccessibleForms] = useState([]);
  const [accessibleInventory, setAccessibleInventory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user && churchId) {
      loadUserAccessibleResources();
    }
  }, [user, churchId]);

  const loadUserAccessibleResources = async () => {
    try {
      setLoading(true);

      // Get all forms user has access to
      const forms = await getUserAccessibleForms(user, churchId);
      setAccessibleForms(forms);

      // Get all inventory items user has access to
      const inventory = await getUserAccessibleInventory(user, churchId);
      setAccessibleInventory(inventory);

    } catch (error) {
      console.error('Error loading accessible resources:', error);
      toast.error('Error loading resources');
    } finally {
      setLoading(false);
    }
  };

  // Example: Check if user can edit a specific form
  const handleEditForm = async (formId) => {
    const canEdit = await hasFormPermission(user, churchId, formId, 'update');
    
    if (!canEdit) {
      toast.error('You do not have permission to edit this form');
      return;
    }
    
    // Proceed with editing
    console.log('User can edit form:', formId);
    toast.success('Opening form editor...');
  };

  // Example: Check if user can delete a specific inventory item
  const handleDeleteInventoryItem = async (inventoryId) => {
    const canDelete = await hasInventoryPermission(user, churchId, inventoryId, 'delete');
    
    if (!canDelete) {
      toast.error('You do not have permission to delete this inventory item');
      return;
    }
    
    // Proceed with deletion
    console.log('User can delete inventory item:', inventoryId);
    toast.success('Inventory item deleted successfully');
  };

  // Example: Check if user can view a specific category
  const handleViewCategory = async (categoryId) => {
    const canView = await hasCategoryPermission(user, churchId, categoryId, 'read');
    
    if (!canView) {
      toast.error('You do not have permission to view this category');
      return;
    }
    
    // Proceed with viewing
    console.log('User can view category:', categoryId);
    toast.success('Opening category...');
  };

  // Example: Check if user can manage a specific gallery
  const handleManageGallery = async (galleryId) => {
    const canManage = await hasGalleryPermission(user, churchId, galleryId, 'manage');
    
    if (!canManage) {
      toast.error('You do not have permission to manage this gallery');
      return;
    }
    
    // Proceed with management
    console.log('User can manage gallery:', galleryId);
    toast.success('Opening gallery manager...');
  };

  if (loading) {
    return (
      <div className="permission-example-loading">
        <p>Loading accessible resources...</p>
      </div>
    );
  }

  return (
    <div className="permission-example-component">
      <h2>Resource Access Example</h2>
      <p>This component demonstrates how to use granular permissions for specific resources.</p>

      <div className="permission-sections">
        
        {/* Forms Section */}
        <div className="permission-section">
          <h3>Accessible Forms ({accessibleForms.length})</h3>
          {accessibleForms.length > 0 ? (
            <div className="resource-list">
              {accessibleForms.map(form => (
                <div key={form.id} className="resource-item">
                  <div className="resource-info">
                    <h4>{form.title || 'Untitled Form'}</h4>
                    <p>ID: {form.id}</p>
                  </div>
                  <div className="resource-actions">
                    <button 
                      onClick={() => handleEditForm(form.id)}
                      className="btn btn-primary btn-sm"
                    >
                      Edit Form
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="no-access">No forms accessible to your role.</p>
          )}
        </div>

        {/* Inventory Section */}
        <div className="permission-section">
          <h3>Accessible Inventory ({accessibleInventory.length})</h3>
          {accessibleInventory.length > 0 ? (
            <div className="resource-list">
              {accessibleInventory.map(item => (
                <div key={item.id} className="resource-item">
                  <div className="resource-info">
                    <h4>{item.name || 'Untitled Item'}</h4>
                    <p>ID: {item.id}</p>
                  </div>
                  <div className="resource-actions">
                    <button 
                      onClick={() => handleDeleteInventoryItem(item.id)}
                      className="btn btn-danger btn-sm"
                    >
                      Delete Item
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="no-access">No inventory items accessible to your role.</p>
          )}
        </div>

        {/* Example actions for categories and galleries */}
        <div className="permission-section">
          <h3>Permission Test Actions</h3>
          <div className="test-actions">
            <button 
              onClick={() => handleViewCategory('example-category-id')}
              className="btn btn-info"
            >
              Test Category Access
            </button>
            <button 
              onClick={() => handleManageGallery('example-gallery-id')}
              className="btn btn-warning"
            >
              Test Gallery Management
            </button>
          </div>
        </div>

      </div>

      <div className="permission-info">
        <h3>How to Use Enhanced Permissions</h3>
        <div className="code-examples">
          <h4>Basic Usage Examples:</h4>
          <pre><code>{`
// Check form permission
const canEdit = await hasFormPermission(user, churchId, formId, 'update');

// Check inventory permission  
const canDelete = await hasInventoryPermission(user, churchId, itemId, 'delete');

// Check category permission
const canView = await hasCategoryPermission(user, churchId, categoryId, 'read');

// Check gallery permission
const canManage = await hasGalleryPermission(user, churchId, galleryId, 'manage');

// Get all accessible forms
const forms = await getUserAccessibleForms(user, churchId);

// Get all accessible inventory
const inventory = await getUserAccessibleInventory(user, churchId);
          `}</code></pre>
        </div>
      </div>

      <style jsx>{`
        .permission-example-component {
          padding: 20px;
          max-width: 1200px;
          margin: 0 auto;
        }

        .permission-sections {
          display: grid;
          gap: 20px;
          margin: 20px 0;
        }

        .permission-section {
          background: white;
          border-radius: 8px;
          padding: 20px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        .permission-section h3 {
          margin: 0 0 16px 0;
          color: #333;
          border-bottom: 2px solid #eee;
          padding-bottom: 8px;
        }

        .resource-list {
          display: grid;
          gap: 12px;
        }

        .resource-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px;
          border: 1px solid #ddd;
          border-radius: 6px;
          background: #f8f9fa;
        }

        .resource-info h4 {
          margin: 0 0 4px 0;
          color: #495057;
        }

        .resource-info p {
          margin: 0;
          color: #6c757d;
          font-size: 0.9rem;
        }

        .resource-actions {
          display: flex;
          gap: 8px;
        }

        .test-actions {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
        }

        .btn {
          padding: 6px 12px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.9rem;
          text-decoration: none;
          display: inline-block;
        }

        .btn-primary { background: #007bff; color: white; }
        .btn-danger { background: #dc3545; color: white; }
        .btn-info { background: #17a2b8; color: white; }
        .btn-warning { background: #ffc107; color: #212529; }
        .btn-sm { padding: 4px 8px; font-size: 0.8rem; }

        .btn:hover {
          opacity: 0.9;
          transform: translateY(-1px);
        }

        .no-access {
          color: #6c757d;
          font-style: italic;
          text-align: center;
          padding: 20px;
        }

        .permission-info {
          margin-top: 40px;
          background: #f8f9fa;
          padding: 20px;
          border-radius: 8px;
        }

        .code-examples pre {
          background: #2d3748;
          color: #e2e8f0;
          padding: 16px;
          border-radius: 6px;
          overflow-x: auto;
          font-size: 0.9rem;
        }

        .permission-example-loading {
          text-align: center;
          padding: 40px;
          color: #6c757d;
        }
      `}</style>
    </div>
  );
};

export default PermissionExampleComponent;
