import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { db } from '../firebase';
import { 
  collection, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  getDocs, 
  query, 
  orderBy, 
  serverTimestamp,
  getDoc
} from 'firebase/firestore';
import { FaPlus, FaEdit, FaTrash, FaFacebook, FaTwitter, FaInstagram, FaYoutube, FaKey, FaCheck, FaArrowLeft, FaWhatsapp, FaLinkedin, FaTiktok } from 'react-icons/fa';
import { toast } from 'react-toastify';
import ChurchHeader from './ChurchHeader';
import './SocialMedia.css';

const SocialMediaAccounts = () => {
  const { id } = useParams();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [currentAccount, setCurrentAccount] = useState(null);
  const [formData, setFormData] = useState({
    platform: '',
    accountName: '',
    accountUrl: '',
    accessStatus: 'missing', // Default status is "missing"
    contactPerson: '',
    contactEmail: '',
    contactPhone: '',
    notes: ''
  });

  // Platform options with icons
  const platformOptions = [
    { value: 'facebook', label: 'Facebook', icon: <FaFacebook /> },
    { value: 'twitter', label: 'Twitter', icon: <FaTwitter /> },
    { value: 'instagram', label: 'Instagram', icon: <FaInstagram /> },
    { value: 'youtube', label: 'YouTube', icon: <FaYoutube /> },
    { value: 'whatsapp', label: 'WhatsApp', icon: <FaWhatsapp /> },
    { value: 'linkedin', label: 'LinkedIn', icon: <FaLinkedin /> },
    { value: 'tiktok', label: 'TikTok', icon: <FaTiktok /> }
  ];

  // Access status options
  const accessStatusOptions = [
    { value: 'missing', label: 'Missing Access', color: '#EF4444' },
    { value: 'pending', label: 'Access Pending', color: '#F59E0B' },
    { value: 'create', label: 'Create', color: '#8B5CF6' },
    { value: 'received', label: 'Access Received', color: '#10B981' }
  ];

  useEffect(() => {
    fetchAccounts();
  }, [id]);

  const fetchAccounts = async () => {
    try {
      setLoading(true);
      const accountsRef = collection(db, `churches/${id}/socialMediaAccounts`);
      const q = query(accountsRef, orderBy('platform', 'asc'));
      const querySnapshot = await getDocs(q);
      
      const accountsData = [];
      querySnapshot.forEach((doc) => {
        accountsData.push({
          id: doc.id,
          ...doc.data()
        });
      });
      
      setAccounts(accountsData);
    } catch (error) {
      console.error('Error fetching social media accounts:', error);
      toast.error('Failed to load social media accounts');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const resetForm = () => {
    setFormData({
      platform: '',
      accountName: '',
      accountUrl: '',
      accessStatus: 'missing',
      contactPerson: '',
      contactEmail: '',
      contactPhone: '',
      notes: ''
    });
    setCurrentAccount(null);
  };

  const openModal = (account = null) => {
    if (account) {
      setCurrentAccount(account);
      setFormData({
        platform: account.platform || '',
        accountName: account.accountName || '',
        accountUrl: account.accountUrl || '',
        accessStatus: account.accessStatus || 'missing',
        contactPerson: account.contactPerson || '',
        contactEmail: account.contactEmail || '',
        contactPhone: account.contactPhone || '',
        notes: account.notes || ''
      });
    } else {
      resetForm();
    }
    setShowModal(true);
  };

  const validateForm = () => {
    if (!formData.platform) {
      toast.error('Platform is required');
      return false;
    }
    if (!formData.accountName.trim()) {
      toast.error('Account name is required');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }
    
    try {
      setLoading(true);
      
      const accountData = {
        platform: formData.platform,
        accountName: formData.accountName.trim(),
        accountUrl: formData.accountUrl.trim(),
        accessStatus: formData.accessStatus,
        contactPerson: formData.contactPerson.trim(),
        contactEmail: formData.contactEmail.trim(),
        contactPhone: formData.contactPhone.trim(),
        notes: formData.notes.trim(),
        updatedAt: serverTimestamp()
      };
      
      if (currentAccount) {
        // Update existing account
        await updateDoc(doc(db, `churches/${id}/socialMediaAccounts`, currentAccount.id), accountData);
        toast.success('Social media account updated successfully');
      } else {
        // Create new account
        accountData.createdAt = serverTimestamp();
        await addDoc(collection(db, `churches/${id}/socialMediaAccounts`), accountData);
        toast.success('Social media account added successfully');
      }
      
      setShowModal(false);
      resetForm();
      fetchAccounts();
    } catch (error) {
      console.error('Error saving social media account:', error);
      toast.error(`Failed to save social media account: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (accountId) => {
    if (window.confirm('Are you sure you want to delete this account?')) {
      try {
        setLoading(true);
        await deleteDoc(doc(db, `churches/${id}/socialMediaAccounts`, accountId));
        toast.success('Social media account deleted successfully');
        fetchAccounts();
      } catch (error) {
        console.error('Error deleting social media account:', error);
        toast.error('Failed to delete social media account');
      } finally {
        setLoading(false);
      }
    }
  };

  const updateAccessStatus = async (account, newStatus) => {
    try {
      setLoading(true);
      await updateDoc(doc(db, `churches/${id}/socialMediaAccounts`, account.id), {
        accessStatus: newStatus,
        updatedAt: serverTimestamp()
      });
      toast.success(`Account status updated to "${accessStatusOptions.find(opt => opt.value === newStatus)?.label}"`);
      fetchAccounts();
    } catch (error) {
      console.error('Error updating access status:', error);
      toast.error('Failed to update access status');
    } finally {
      setLoading(false);
    }
  };

  // Filter accounts by access status
  const missingAccounts = accounts.filter(account => account.accessStatus === 'missing');
  const pendingAccounts = accounts.filter(account => account.accessStatus === 'pending');
  const receivedAccounts = accounts.filter(account => account.accessStatus === 'received');

  return (
    <div className="social-media-container">
      <ChurchHeader id={id} />
      
      <div className="page-header">
        <div className="header-content">
          <h1>Social Media Account Access</h1>
          <p>Track access to your church's social media accounts</p>
        </div>
        
        <div className="header-actions">
          <Link to={`/church/${id}/social-media`} className="secondary-button">
            <FaArrowLeft /> Back to Social Media
          </Link>
          <button className="create-button" onClick={() => openModal()}>
            <FaPlus /> Add Account
          </button>
        </div>
      </div>
      
      {loading && accounts.length === 0 ? (
        <div className="loading">Loading...</div>
      ) : accounts.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🔑</div>
          <h3>No Social Media Accounts Found</h3>
          <p>Add your first social media account by clicking the "Add Account" button above.</p>
        </div>
      ) : (
        <div className="accounts-sections">
          {missingAccounts.length > 0 && (
            <div className="accounts-section missing-section">
              <h2>Missing Access <span className="account-count">{missingAccounts.length}</span></h2>
              <div className="accounts-grid">
                {missingAccounts.map(account => (
                  <div key={account.id} className="account-card missing">
                    <div className="account-header">
                      <div className="account-platform">
                        {platformOptions.find(p => p.value === account.platform)?.icon}
                        <span>{platformOptions.find(p => p.value === account.platform)?.label || account.platform}</span>
                      </div>
                      <div className="account-status">
                        <span className="status-badge status-missing">Missing Access</span>
                      </div>
                    </div>
                    
                    <div className="account-content">
                      <h3>{account.accountName}</h3>
                      {account.accountUrl && (
                        <a href={account.accountUrl} target="_blank" rel="noopener noreferrer" className="account-url">
                          View Account
                        </a>
                      )}
                      
                      {account.contactPerson && (
                        <div className="account-contact">
                          <span className="contact-label">Contact:</span> {account.contactPerson}
                        </div>
                      )}
                      
                      {account.contactEmail && (
                        <div className="account-email">
                          <span className="contact-label">Email:</span> {account.contactEmail}
                        </div>
                      )}
                      
                      {account.contactPhone && (
                        <div className="account-phone">
                          <span className="contact-label">Phone:</span> {account.contactPhone}
                        </div>
                      )}
                      
                      {account.notes && (
                        <div className="account-notes">
                          <span className="notes-label">Notes:</span>
                          <p>{account.notes}</p>
                        </div>
                      )}
                    </div>
                    
                    <div className="account-actions">
                      <div className="status-actions">
                        <button 
                          className="status-action pending-action"
                          onClick={() => updateAccessStatus(account, 'pending')}
                          title="Mark as Pending"
                        >
                          <FaKey /> Mark Pending
                        </button>
                        <button 
                          className="status-action received-action"
                          onClick={() => updateAccessStatus(account, 'received')}
                          title="Mark as Received"
                        >
                          <FaCheck /> Mark Received
                        </button>
                      </div>
                      
                      <div className="edit-actions">
                        <button className="edit-button" onClick={() => openModal(account)}>
                          <FaEdit /> Edit
                        </button>
                        <button className="delete-button" onClick={() => handleDelete(account.id)}>
                          <FaTrash /> Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {pendingAccounts.length > 0 && (
            <div className="accounts-section pending-section">
              <h2>Access Pending <span className="account-count">{pendingAccounts.length}</span></h2>
              <div className="accounts-grid">
                {pendingAccounts.map(account => (
                  <div key={account.id} className="account-card pending">
                    <div className="account-header">
                      <div className="account-platform">
                        {platformOptions.find(p => p.value === account.platform)?.icon}
                        <span>{platformOptions.find(p => p.value === account.platform)?.label || account.platform}</span>
                      </div>
                      <div className="account-status">
                        <span className="status-badge status-pending">Access Pending</span>
                      </div>
                    </div>
                    
                    <div className="account-content">
                      <h3>{account.accountName}</h3>
                      {account.accountUrl && (
                        <a href={account.accountUrl} target="_blank" rel="noopener noreferrer" className="account-url">
                          View Account
                        </a>
                      )}
                      
                      {account.contactPerson && (
                        <div className="account-contact">
                          <span className="contact-label">Contact:</span> {account.contactPerson}
                        </div>
                      )}
                      
                      {account.contactEmail && (
                        <div className="account-email">
                          <span className="contact-label">Email:</span> {account.contactEmail}
                        </div>
                      )}
                      
                      {account.contactPhone && (
                        <div className="account-phone">
                          <span className="contact-label">Phone:</span> {account.contactPhone}
                        </div>
                      )}
                      
                      {account.notes && (
                        <div className="account-notes">
                          <span className="notes-label">Notes:</span>
                          <p>{account.notes}</p>
                        </div>
                      )}
                    </div>
                    
                    <div className="account-actions">
                      <div className="status-actions">
                        <button 
                          className="status-action missing-action"
                          onClick={() => updateAccessStatus(account, 'missing')}
                          title="Mark as Missing"
                        >
                          <FaKey /> Mark Missing
                        </button>
                        <button 
                          className="status-action received-action"
                          onClick={() => updateAccessStatus(account, 'received')}
                          title="Mark as Received"
                        >
                          <FaCheck /> Mark Received
                        </button>
                      </div>
                      
                      <div className="edit-actions">
                        <button className="edit-button" onClick={() => openModal(account)}>
                          <FaEdit /> Edit
                        </button>
                        <button className="delete-button" onClick={() => handleDelete(account.id)}>
                          <FaTrash /> Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {receivedAccounts.length > 0 && (
            <div className="accounts-section received-section">
              <h2>Access Received <span className="account-count">{receivedAccounts.length}</span></h2>
              <div className="accounts-grid">
                {receivedAccounts.map(account => (
                  <div key={account.id} className="account-card received">
                    <div className="account-header">
                      <div className="account-platform">
                        {platformOptions.find(p => p.value === account.platform)?.icon}
                        <span>{platformOptions.find(p => p.value === account.platform)?.label || account.platform}</span>
                      </div>
                      <div className="account-status">
                        <span className="status-badge status-received">Access Received</span>
                      </div>
                    </div>
                    
                    <div className="account-content">
                      <h3>{account.accountName}</h3>
                      {account.accountUrl && (
                        <a href={account.accountUrl} target="_blank" rel="noopener noreferrer" className="account-url">
                          View Account
                        </a>
                      )}
                      
                      {account.contactPerson && (
                        <div className="account-contact">
                          <span className="contact-label">Contact:</span> {account.contactPerson}
                        </div>
                      )}
                      
                      {account.contactEmail && (
                        <div className="account-email">
                          <span className="contact-label">Email:</span> {account.contactEmail}
                        </div>
                      )}
                      
                      {account.contactPhone && (
                        <div className="account-phone">
                          <span className="contact-label">Phone:</span> {account.contactPhone}
                        </div>
                      )}
                      
                      {account.notes && (
                        <div className="account-notes">
                          <span className="notes-label">Notes:</span>
                          <p>{account.notes}</p>
                        </div>
                      )}
                    </div>
                    
                    <div className="account-actions">
                      <div className="status-actions">
                        <button 
                          className="status-action missing-action"
                          onClick={() => updateAccessStatus(account, 'missing')}
                          title="Mark as Missing"
                        >
                          <FaKey /> Mark Missing
                        </button>
                        <button 
                          className="status-action pending-action"
                          onClick={() => updateAccessStatus(account, 'pending')}
                          title="Mark as Pending"
                        >
                          <FaKey /> Mark Pending
                        </button>
                      </div>
                      
                      <div className="edit-actions">
                        <button className="edit-button" onClick={() => openModal(account)}>
                          <FaEdit /> Edit
                        </button>
                        <button className="delete-button" onClick={() => handleDelete(account.id)}>
                          <FaTrash /> Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>{currentAccount ? 'Edit Social Media Account' : 'Add Social Media Account'}</h2>
              <button className="close-button" onClick={() => setShowModal(false)}>×</button>
            </div>
            
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Platform *</label>
                <select
                  name="platform"
                  value={formData.platform}
                  onChange={handleInputChange}
                  required
                >
                  <option value="">Select Platform</option>
                  {platformOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              
              <div className="form-group">
                <label>Account Name *</label>
                <input
                  type="text"
                  name="accountName"
                  value={formData.accountName}
                  onChange={handleInputChange}
                  placeholder="e.g. Church Facebook Page"
                  required
                />
              </div>
              
              <div className="form-group">
                <label>Account URL</label>
                <input
                  type="url"
                  name="accountUrl"
                  value={formData.accountUrl}
                  onChange={handleInputChange}
                  placeholder="https://..."
                />
              </div>
              
              <div className="form-group">
                <label>Access Status</label>
                <select
                  name="accessStatus"
                  value={formData.accessStatus}
                  onChange={handleInputChange}
                >
                  {accessStatusOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              
              <div className="form-group">
                <label>Contact Person</label>
                <input
                  type="text"
                  name="contactPerson"
                  value={formData.contactPerson}
                  onChange={handleInputChange}
                  placeholder="Person who has access"
                />
              </div>
              
              <div className="form-row">
                <div className="form-group">
                  <label>Contact Email</label>
                  <input
                    type="email"
                    name="contactEmail"
                    value={formData.contactEmail}
                    onChange={handleInputChange}
                    placeholder="email@example.com"
                  />
                </div>
                
                <div className="form-group">
                  <label>Contact Phone</label>
                  <input
                    type="text"
                    name="contactPhone"
                    value={formData.contactPhone}
                    onChange={handleInputChange}
                    placeholder="(123) 456-7890"
                  />
                </div>
              </div>
              
              <div className="form-group">
                <label>Notes</label>
                <textarea
                  name="notes"
                  value={formData.notes}
                  onChange={handleInputChange}
                  placeholder="Add any additional notes here..."
                  rows={3}
                />
              </div>
              
              <div className="form-actions">
                <button type="button" onClick={() => setShowModal(false)} className="cancel-button">
                  Cancel
                </button>
                <button type="submit" className="save-button" disabled={loading}>
                  {loading ? 'Saving...' : 'Save Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SocialMediaAccounts;