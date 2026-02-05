import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { getAuth, updateEmail, updatePassword } from 'firebase/auth';
import { toast } from 'react-toastify';
import './MyProfile.css';

const MyProfile = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [userData, setUserData] = useState(null);
  const [editData, setEditData] = useState(null);
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [savingChanges, setSavingChanges] = useState(false);

  // Fetch user profile data
  useEffect(() => {
    const fetchUserData = async () => {
      if (!user?.uid) return;
      
      try {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
          const data = userSnap.data();
          setUserData(data);
          setEditData({
            name: data.name || '',
            lastName: data.lastName || '',
            email: data.email || '',
            phone: data.phone || '',
            title: data.title || '',
            salaryPerHour: data.salaryPerHour || '',
            address: data.address || {
              street: '',
              city: '',
              state: '',
              zipCode: '',
              country: ''
            },
            dateOfBirth: data.dateOfBirth || '',
            gender: data.gender || '',
            maritalStatus: data.maritalStatus || ''
          });
        } else {
          // Fallback to auth user info if profile doc is missing
          const fallbackData = {
            name: user?.name || '',
            lastName: user?.lastName || '',
            email: user?.email || '',
            phone: user?.phone || '',
            title: user?.title || '',
            salaryPerHour: user?.salaryPerHour || '',
            address: user?.address || {
              street: '',
              city: '',
              state: '',
              zipCode: '',
              country: ''
            },
            dateOfBirth: user?.dateOfBirth || '',
            gender: user?.gender || '',
            maritalStatus: user?.maritalStatus || ''
          };
          setUserData(fallbackData);
          setEditData(fallbackData);
        }
      } catch (error) {
        console.error('Error fetching user data:', error);
        toast.error('Failed to load profile information');
      } finally {
        setLoading(false);
      }
    };

    fetchUserData();
  }, [user?.uid]);

  const handleEditChange = (field, value) => {
    if (field.startsWith('address.')) {
      const addressField = field.replace('address.', '');
      setEditData(prev => ({
        ...prev,
        address: {
          ...prev.address,
          [addressField]: value
        }
      }));
    } else {
      setEditData(prev => ({
        ...prev,
        [field]: value
      }));
    }
  };

  const handleSaveChanges = async () => {
    if (!user?.uid || !editData) return;

    // Validate required fields
    if (!editData.name || !editData.lastName || !editData.email) {
      toast.error('Please fill in all required fields (Name, Last Name, Email)');
      return;
    }

    setSavingChanges(true);
    try {
      const auth = getAuth();
      const currentUser = auth.currentUser;

      // Update email if changed
      if (currentUser.email !== editData.email) {
        try {
          await updateEmail(currentUser, editData.email);
        } catch (error) {
          if (error.code === 'auth/requires-recent-login') {
            toast.error('For security, please sign in again before changing your email');
            setEditing(false);
            setSavingChanges(false);
            return;
          }
          throw error;
        }
      }

      // Update Firestore document
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        name: editData.name,
        lastName: editData.lastName,
        email: editData.email,
        phone: editData.phone,
        title: editData.title,
        address: editData.address,
        dateOfBirth: editData.dateOfBirth,
        gender: editData.gender,
        maritalStatus: editData.maritalStatus,
        updatedAt: serverTimestamp()
      });

      setUserData(editData);
      setEditing(false);
      toast.success('Profile updated successfully!');
    } catch (error) {
      console.error('Error updating profile:', error);
      toast.error('Failed to update profile: ' + error.message);
    } finally {
      setSavingChanges(false);
    }
  };

  const handlePasswordChange = async () => {
    if (!passwordData.newPassword || !passwordData.confirmPassword) {
      toast.error('Please fill in all password fields');
      return;
    }

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    if (passwordData.newPassword.length < 6) {
      toast.error('Password must be at least 6 characters long');
      return;
    }

    setSavingChanges(true);
    try {
      const auth = getAuth();
      const currentUser = auth.currentUser;

      // Update password
      await updatePassword(currentUser, passwordData.newPassword);

      setPasswordData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      });
      setShowPasswordForm(false);
      toast.success('Password updated successfully!');
    } catch (error) {
      console.error('Error updating password:', error);
      
      if (error.code === 'auth/requires-recent-login') {
        toast.error('For security, please sign in again before changing your password');
      } else if (error.code === 'auth/weak-password') {
        toast.error('Password is too weak');
      } else {
        toast.error('Failed to update password: ' + error.message);
      }
    } finally {
      setSavingChanges(false);
    }
  };

  if (loading) {
    return (
      <div className="my-profile-container">
        <div className="loading">Loading your profile...</div>
      </div>
    );
  }

  return (
    <div className="my-profile-container">
      <div className="profile-header">
        <h2>My Profile</h2>
        {!editing && (
          <button
            className="btn btn-primary"
            onClick={() => setEditing(true)}
          >
            ✏️ Edit Profile
          </button>
        )}
      </div>

      <div className="profile-content">
        {editing ? (
          <div className="profile-edit-form">
            <div className="form-section">
              <h3>Personal Information</h3>
              <div className="form-group">
                <label>First Name *</label>
                <input
                  type="text"
                  value={editData.name}
                  onChange={(e) => handleEditChange('name', e.target.value)}
                  className="form-control"
                  placeholder="First Name"
                />
              </div>

              <div className="form-group">
                <label>Last Name *</label>
                <input
                  type="text"
                  value={editData.lastName}
                  onChange={(e) => handleEditChange('lastName', e.target.value)}
                  className="form-control"
                  placeholder="Last Name"
                />
              </div>

              <div className="form-group">
                <label>Email *</label>
                <input
                  type="email"
                  value={editData.email}
                  onChange={(e) => handleEditChange('email', e.target.value)}
                  className="form-control"
                  placeholder="Email"
                />
              </div>

              <div className="form-group">
                <label>Phone</label>
                <input
                  type="tel"
                  value={editData.phone}
                  onChange={(e) => handleEditChange('phone', e.target.value)}
                  className="form-control"
                  placeholder="Phone Number"
                />
              </div>

              <div className="form-group">
                <label>Job Title</label>
                <input
                  type="text"
                  value={editData.title}
                  onChange={(e) => handleEditChange('title', e.target.value)}
                  className="form-control"
                  placeholder="Job Title or Position"
                />
              </div>

              <div className="form-group">
                <label>Salary Per Hour</label>
                <input
                  type="number"
                  step="0.01"
                  value={editData.salaryPerHour}
                  onChange={(e) => handleEditChange('salaryPerHour', e.target.value)}
                  className="form-control"
                  placeholder="Hourly Rate"
                />
              </div>

              <div className="form-group">
                <label>Date of Birth</label>
                <input
                  type="date"
                  value={editData.dateOfBirth}
                  onChange={(e) => handleEditChange('dateOfBirth', e.target.value)}
                  className="form-control"
                />
              </div>

              <div className="form-group">
                <label>Gender</label>
                <select
                  value={editData.gender}
                  onChange={(e) => handleEditChange('gender', e.target.value)}
                  className="form-control"
                >
                  <option value="">Select Gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div className="form-group">
                <label>Marital Status</label>
                <select
                  value={editData.maritalStatus}
                  onChange={(e) => handleEditChange('maritalStatus', e.target.value)}
                  className="form-control"
                >
                  <option value="">Select Status</option>
                  <option value="Single">Single</option>
                  <option value="Married">Married</option>
                  <option value="Divorced">Divorced</option>
                  <option value="Widowed">Widowed</option>
                </select>
              </div>
            </div>

            <div className="form-section">
              <h3>Address</h3>
              <div className="form-group">
                <label>Street</label>
                <input
                  type="text"
                  value={editData.address.street}
                  onChange={(e) => handleEditChange('address.street', e.target.value)}
                  className="form-control"
                  placeholder="Street Address"
                />
              </div>

              <div className="form-group">
                <label>City</label>
                <input
                  type="text"
                  value={editData.address.city}
                  onChange={(e) => handleEditChange('address.city', e.target.value)}
                  className="form-control"
                  placeholder="City"
                />
              </div>

              <div className="form-group">
                <label>State/Province</label>
                <input
                  type="text"
                  value={editData.address.state}
                  onChange={(e) => handleEditChange('address.state', e.target.value)}
                  className="form-control"
                  placeholder="State or Province"
                />
              </div>

              <div className="form-group">
                <label>Zip/Postal Code</label>
                <input
                  type="text"
                  value={editData.address.zipCode}
                  onChange={(e) => handleEditChange('address.zipCode', e.target.value)}
                  className="form-control"
                  placeholder="Zip or Postal Code"
                />
              </div>

              <div className="form-group">
                <label>Country</label>
                <input
                  type="text"
                  value={editData.address.country}
                  onChange={(e) => handleEditChange('address.country', e.target.value)}
                  className="form-control"
                  placeholder="Country"
                />
              </div>
            </div>

            <div className="form-actions">
              <button
                className="btn btn-success"
                onClick={handleSaveChanges}
                disabled={savingChanges}
              >
                {savingChanges ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setEditing(false);
                  setEditData(userData);
                }}
                disabled={savingChanges}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="profile-view">
            <div className="profile-section">
              <h3>Personal Information</h3>
              <div className="info-row">
                <label>Name:</label>
                <span>{userData?.name || 'Not provided'}</span>
              </div>
              <div className="info-row">
                <label>Last Name:</label>
                <span>{userData?.lastName || 'Not provided'}</span>
              </div>
              <div className="info-row">
                <label>Email:</label>
                <span>{userData?.email || 'Not provided'}</span>
              </div>
              <div className="info-row">
                <label>Phone:</label>
                <span>{userData?.phone || 'Not provided'}</span>
              </div>
              <div className="info-row">
                <label>Job Title:</label>
                <span>{userData?.title || 'Not provided'}</span>
              </div>
              <div className="info-row">
                <label>Salary Per Hour:</label>
                <span>${userData?.salaryPerHour ? parseFloat(userData.salaryPerHour).toFixed(2) : 'Not provided'}</span>
              </div>
              <div className="info-row">
                <label>Date of Birth:</label>
                <span>{userData?.dateOfBirth || 'Not provided'}</span>
              </div>
              <div className="info-row">
                <label>Gender:</label>
                <span>{userData?.gender || 'Not provided'}</span>
              </div>
              <div className="info-row">
                <label>Marital Status:</label>
                <span>{userData?.maritalStatus || 'Not provided'}</span>
              </div>
            </div>

            {userData?.address && Object.values(userData.address).some(v => v) && (
              <div className="profile-section">
                <h3>Address</h3>
                <div className="info-row">
                  <label>Street:</label>
                  <span>{userData.address.street || 'Not provided'}</span>
                </div>
                <div className="info-row">
                  <label>City:</label>
                  <span>{userData.address.city || 'Not provided'}</span>
                </div>
                <div className="info-row">
                  <label>State/Province:</label>
                  <span>{userData.address.state || 'Not provided'}</span>
                </div>
                <div className="info-row">
                  <label>Zip/Postal Code:</label>
                  <span>{userData.address.zipCode || 'Not provided'}</span>
                </div>
                <div className="info-row">
                  <label>Country:</label>
                  <span>{userData.address.country || 'Not provided'}</span>
                </div>
              </div>
            )}

            <div className="profile-actions">
              <button
                className="btn btn-warning"
                onClick={() => setShowPasswordForm(!showPasswordForm)}
              >
                🔐 Change Password
              </button>
            </div>

            {showPasswordForm && (
              <div className="password-form-container">
                <h3>Change Password</h3>
                <div className="form-group">
                  <label>New Password</label>
                  <input
                    type="password"
                    value={passwordData.newPassword}
                    onChange={(e) => setPasswordData({...passwordData, newPassword: e.target.value})}
                    className="form-control"
                    placeholder="Enter new password (min 6 characters)"
                  />
                </div>
                <div className="form-group">
                  <label>Confirm Password</label>
                  <input
                    type="password"
                    value={passwordData.confirmPassword}
                    onChange={(e) => setPasswordData({...passwordData, confirmPassword: e.target.value})}
                    className="form-control"
                    placeholder="Confirm new password"
                  />
                </div>
                <div className="form-actions">
                  <button
                    className="btn btn-success"
                    onClick={handlePasswordChange}
                    disabled={savingChanges}
                  >
                    {savingChanges ? 'Updating...' : 'Update Password'}
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      setShowPasswordForm(false);
                      setPasswordData({currentPassword: '', newPassword: '', confirmPassword: ''});
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default MyProfile;
