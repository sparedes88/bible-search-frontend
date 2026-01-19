import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, setDoc, collection, query, orderBy, getDocs, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'react-toastify';
import { FaArrowLeft } from 'react-icons/fa';
import './AdminConnect.css'; // Reuse the same styles

const AddVisitor = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    lastName: "",
    phone: "",
    email: "",
    tags: [],
  });
  const [currentTag, setCurrentTag] = useState("");

  const safeToast = {
    success: (message) => toast.success(message),
    error: (message) => toast.error(message),
    info: (message) => toast.info(message),
  };

  const formatPhoneNumber = (value) => {
    // Remove all non-numeric characters
    const phoneNumber = value.replace(/\D/g, '');

    // Format as (XXX) XXX-XXXX
    if (phoneNumber.length <= 3) {
      return phoneNumber;
    } else if (phoneNumber.length <= 6) {
      return `(${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3)}`;
    } else {
      return `(${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3, 6)}-${phoneNumber.slice(6, 10)}`;
    }
  };

  const formatPhoneDisplay = (value) => {
    if (!value) return '';
    const cleaned = value.replace(/\D/g, '');
    if (cleaned.length === 10) {
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    return value;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (!formData.name || !formData.lastName || !formData.phone) {
        safeToast.error("Name, last name and phone are required");
        return;
      }

      if (!user) {
        safeToast.error("You must be logged in");
        return;
      }

      const visitorData = {
        name: formData.name,
        lastName: formData.lastName || "",
        phone: formatPhoneNumber(formData.phone),
        email: "",
        role: "member",
        churchId: id,
        createdAt: serverTimestamp(),
        createdBy: user.uid,
        status: "active",
        groups: [],
        tags: formData.tags || [],
      };

      const timestamp = Date.now().toString();
      const visitorRef = doc(db, "visitors", id, "visitors", timestamp);

      await setDoc(visitorRef, visitorData);
      console.log("Visitor added successfully");

      safeToast.success("Visitor added successfully!");

      // Navigate back to the admin connect page
      navigate(`/organization/${id}/admin-connect`);

    } catch (error) {
      console.error("Error:", error);
      if (error.code === "permission-denied") {
        safeToast.error("You do not have permission to add visitors");
      } else {
        safeToast.error(error.message || "Failed to add visitor");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;

    switch (name) {
      case "phone":
        const formattedPhone = formatPhoneNumber(value);
        setFormData((prev) => ({
          ...prev,
          [name]: formattedPhone,
        }));
        break;
      default:
        setFormData((prev) => ({
          ...prev,
          [name]: value,
        }));
    }
  };

  const handleAddTag = () => {
    if (currentTag.trim() && !formData.tags.includes(currentTag.trim())) {
      setFormData((prev) => ({
        ...prev,
        tags: [...prev.tags, currentTag.trim()],
      }));
      setCurrentTag("");
    }
  };

  const handleRemoveTag = (tagToRemove) => {
    setFormData((prev) => ({
      ...prev,
      tags: prev.tags.filter((tag) => tag !== tagToRemove),
    }));
  };

  return (
    <div className="admin-connect">
      <div className="header-with-tabs">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => navigate(`/organization/${id}/admin-connect`)}
            className="back-button"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              backgroundColor: '#f3f4f6',
              border: '1px solid #d1d5db',
              borderRadius: '0.375rem',
              fontSize: '0.875rem',
              color: '#4b5563',
              cursor: 'pointer'
            }}
          >
            <FaArrowLeft /> Back to Admin Connect
          </button>
          <h2 style={{ margin: 0 }}>Add New Visitor</h2>
        </div>
      </div>

      <div className="content-box">
        <form onSubmit={handleSubmit}>
          <div>
            <label htmlFor="name">Name *</label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="Enter name"
              pattern="[A-Za-zÀ-ÿ\s]+"
              title="Only letters and spaces allowed"
              required
            />
          </div>

          <div>
            <label htmlFor="lastName">Last Name *</label>
            <input
              type="text"
              id="lastName"
              name="lastName"
              value={formData.lastName}
              onChange={handleChange}
              placeholder="Enter last name"
              pattern="[A-Za-zÀ-ÿ\s]+"
              title="Only letters and spaces allowed"
              required
            />
          </div>

          <div>
            <label htmlFor="phone">Phone Number *</label>
            <input
              type="tel"
              id="phone"
              name="phone"
              value={formatPhoneDisplay(formData.phone)}
              onChange={handleChange}
              placeholder="(123) 456-7890"
              maxLength={14}
              required
            />
          </div>

          <div>
            <label>Tags</label>
            <div className="tags-input-container">
              <input
                type="text"
                value={currentTag}
                onChange={(e) => setCurrentTag(e.target.value)}
                placeholder="Add a tag"
                style={{ flex: 1 }}
              />
              <button type="button" onClick={handleAddTag}>
                Add Tag
              </button>
            </div>

            <div className="tags-container">
              {formData.tags.map((tag, index) => (
                <span key={index} className="tag">
                  {tag}
                  <button type="button" onClick={() => handleRemoveTag(tag)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || !formData.name || !formData.phone}
          >
            {loading ? "Adding..." : "Add Visitor"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default AddVisitor;