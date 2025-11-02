import React, { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { db } from "../firebase";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { toast } from "react-toastify";
import { canAccessModule } from "../utils/permissions";
import "./MiOrganizacion.css";
import ChurchHeader from "./ChurchHeader";
import commonStyles from "../pages/commonStyles";
import Skeleton from "react-loading-skeleton";

const formatPhoneNumber = (value) => {
  if (!value) return value;

  const phoneNumber = value.replace(/[^\d]/g, "");

  if (phoneNumber.length < 4) return phoneNumber;
  if (phoneNumber.length < 7) {
    return `(${phoneNumber.slice(0, 3)})${phoneNumber.slice(3)}`;
  }
  return `(${phoneNumber.slice(0, 3)})${phoneNumber.slice(
    3,
    6
  )}-${phoneNumber.slice(6, 10)}`;
};

const ContactSection = ({ icon, label, value, link }) => {
  if (!value) return null;

  const content = link ? (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 hover:text-blue-800"
    >
      {value}
    </a>
  ) : (
    <span>{value}</span>
  );

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "5px",
        }}
      >
        <div>{icon}</div>
        <p style={{ marginTop: 0, marginBottom: 0 }}>{label} :</p>
      </div>
      <p style={{ marginTop: 0, marginBottom: 0 }}>{content}</p>
    </div>
  );
};

const formGroupStyle = {
  marginBottom: "0px",
  width: "100%",
};

const formLabelStyle = {
  fontSize: "14px",
  fontWeight: "500",
  color: "#374151",
  marginBottom: "4px",
  display: "block",
};

const MiOrganizacion = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [organizationData, setOrganizationData] = useState(null);
  const [error, setError] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    address: "",
    website: "",
    email: "",
    phone: "",
  });
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});
  const [userPermissions, setUserPermissions] = useState({});

  // Organized navigation cards by section
  const navigationSections = [
    {
      title: "Tools",
      cards: [
        {
          title: "Personal BI Dashboard",
          description: "Track your progress and get AI-powered growth insights",
          icon: "📊",
          path: `/organization/${id}/user-dashboard`
        },
        {
          title: "Events",
          description: "Manage and coordinate organization events",
          icon: "📅",
          path: `/organization/${id}/all-events`
        },
        {
          title: "Rooms",
          description: "Manage organization rooms and spaces",
          icon: "🏠",
          path: `/organization/${id}/rooms`
        },
        {
          title: "Inventory",
          description: "Track equipment and supplies",
          icon: "📦",
          path: `/organization/${id}/inventory`
        },
        {
          title: "Finances",
          description: "Manage income and expenses",
          icon: "💰",
          path: `/organization/${id}/finances`
        },
        {
          title: "Teams",
          description: "Organize serving teams",
          icon: "👥",
          path: `/organization/${id}/teams`
        },
        {
          title: "Maintenance",
          description: "Track repairs and improvements",
          icon: "🔧",
          path: `/organization/${id}/maintenance`
        },
        {
          title: "Build my Organization",
          description: "Post and track building tasks and improvements",
          icon: "🏗️",
          path: `/organization/${id}/build-my-church`
        },
        {
          title: "Connection Center",
          description: "Manage visitors and connections",
          icon: "🔗",
          path: `/organization/${id}/admin-connect`
        },
        {
          title: "EasyProjector",
          description: "Create and manage presentations",
          icon: "🎥",
          path: `/organization/${id}/easy-projector`
        },
        {
          title: "AI Assistant",
          description: "Use AI to help with pastoral tasks",
          icon: "🤖",
          path: `/organization/${id}/asistente-pastoral`
        },
        {
          title: "Course Analytics",
          description: "View congregation progress statistics and insights",
          icon: "📊",
          path: `/organization/${id}/course-analytics`
        },
        {
          title: "Leica",
          description: "Upload and analyze CSV or text files",
          icon: "📁",
          path: `/organization/${id}/leica`
        },
        {
          title: "Time Tracker",
          description: "Track time and manage tasks with daily progress",
          icon: "⏱️",
          path: `/organization/${id}/time-tracker`
        }
      ]
    },
    {
      title: "Manage your Plan",
      cards: [
        {
          title: "Message Balance",
          description: "Manage SMS messaging credits",
          icon: "💬",
          path: `/organization/${id}/balance`
        }
      ]
    },
    {
      title: "Manage",
      cards: [
        {
          title: "User Management",
          description: "Manage organization users and roles",
          icon: "👤",
          path: `/admin/${id}`
        },
        {
          title: "Role Manager",
          description: "Create and manage custom roles with permissions",
          icon: "🔐",
          path: `/organization/${id}/role-manager`
        },
        {
          title: "User Role Assignment",
          description: "Assign roles to organization members",
          icon: "👥",
          path: `/organization/${id}/user-role-assignment`
        },
        {
          title: "Content Admin",
          description: "Manage organization content and courses",
          icon: "📝",
          path: `/organization/${id}/course-admin`
        },
        {
          title: "Gallery Management",
          description: "Create and manage photo galleries",
          icon: "🖼️",
          path: `/organization/${id}/gallery-admin`
        },
        {
          title: "Song Manager",
          description: "Create and edit songs for presentations",
          icon: "🎵",
          path: `/organization/${id}/song-manager`
        },
        {
          title: "Organization App",
          description: "Customize organization mobile app",
          icon: "📱",
          path: `/organization/${id}/church-app`
        },
        {
          title: "Forms",
          description: "Create and manage custom forms with unlimited fields",
          icon: "📋",
          path: `/organization/${id}/forms`,
          requiresPermission: 'forms'
        },
        {
          title: "Manage Groups",
          description: "Create and manage organization groups",
          icon: "👪",
          path: `/organization/${id}/manage-groups`
        },
        {
          title: "Invoices",
          description: "Create and manage invoices",
          icon: "📝",
          path: `/organization/${id}/invoices`
        },
        {
          title: "Social Media",
          description: "Schedule and track social media posts",
          icon: "📱",
          path: `/organization/${id}/social-media`
        },
        {
          title: "Global",
          description: "Manage all organizations globally",
          icon: "🌎",
          path: "/global-organization-manager"
        }
      ]
    }
  ];

  useEffect(() => {
    const fetchOrganizationData = async () => {
      if (!id) return;

      try {
        setLoading(true);
        const organizationRef = doc(db, "churches", id);
        const organizationSnap = await getDoc(organizationRef);
        
        if (organizationSnap.exists()) {
          const data = organizationSnap.data();
          setOrganizationData(data);
          setFormData({
            address: data.address || "",
            website: data.website || "",
            email: data.email || "",
            phone: data.phone || "",
          });
        } else {
          setError("Organization not found");
        }
      } catch (err) {
        console.error("Error fetching data:", err);
        setError("Error loading data");
      } finally {
        setLoading(false);
      }
    };

    fetchOrganizationData();
  }, [id]);

  useEffect(() => {
    const checkPermissions = async () => {
      if (!user || !id) return;

      try {
        // Check permissions for modules that need special access control
        const formsAccess = await canAccessModule(user, id, 'forms');
        
        setUserPermissions({
          forms: formsAccess,
          // Add other modules as needed
        });
      } catch (error) {
        console.error('Error checking permissions:', error);
        // Fallback to basic role checking
        const isAdmin = user.role === 'admin' || user.role === 'global_admin';
        setUserPermissions({
          forms: isAdmin,
        });
      }
    };

    checkPermissions();
  }, [user, id]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;

    if (name === "phone") {
      const cleaned = value.replace(/[^\d\s()-]/g, "");
      setFormData((prev) => ({
        ...prev,
        [name]: formatPhoneNumber(cleaned),
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        [name]: value,
      }));
    }
  };

  const validateForm = () => {
    const errors = {};

    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = "Invalid email";
    }

    if (formData.phone) {
      const phoneDigits = formData.phone.replace(/[^\d]/g, "");
      if (phoneDigits.length !== 10) {
        errors.phone = "Phone number must have 10 digits";
      } else if (!/^\(\d{3}\)\d{3}-\d{4}$/.test(formData.phone)) {
        errors.phone = "Format must be (123)456-7890";
      }
    }

    if (
      formData.website &&
      !/^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/.test(
        formData.website
      )
    ) {
      errors.website = "Invalid URL";
    }

    if (isEditing && !formData.address.trim()) {
      errors.address = "Address is required";
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      setLoading(true);
      const organizationRef = doc(db, "churches", id);
      await updateDoc(organizationRef, {
        address: formData.address,
        website: formData.website,
        email: formData.email,
        phone: formData.phone,
      });
      
      setOrganizationData((prev) => ({
        ...prev,
        ...formData,
      }));
      setIsEditing(false);
      setSaveSuccess(true);
      toast.success("Organization information updated successfully!");
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error("Error updating organization data:", err);
      setError("Failed to update organization information");
      toast.error("Failed to update organization information");
    } finally {
      setLoading(false);
    }
  };

  // Filter navigation cards based on user permissions
  const getFilteredNavigationSections = () => {
    return navigationSections.map(section => ({
      ...section,
      cards: section.cards.filter(card => {
        // If card doesn't require special permission, show it
        if (!card.requiresPermission) return true;
        
        // Check if user has the required permission
        return userPermissions[card.requiresPermission] === true;
      })
    })).filter(section => section.cards.length > 0); // Remove empty sections
  };

  if (error) {
    return (
      <div className="p-4 text-red-600">
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="" style={commonStyles.fullWidthContainer}>
      <Link to={`/organization/${id}/mi-perfil`} style={commonStyles.backButtonLink}>
        ← Back to Profile
      </Link>
      <ChurchHeader id={id} applyShadow={false} allowEditBannerLogo={true} />
      <div style={{ marginTop: "-30px" }}>
        <h1 style={commonStyles.title}>My Organization</h1>
        {(user.role === "global_admin" ||
          (user.role === "admin" && user.churchId == id)) && (
          <div
            style={{
              display: "flex",
              gap: "10px",
            }}
          >
            <button
              onClick={() => (isEditing ? handleSave() : setIsEditing(true))}
              className="form-field"
              style={{
                backgroundColor: isEditing ? "#56b868" : "#4F46E5",
                color: "white",
                padding: "10px 20px",
                borderRadius: "8px",
                border: "none",
                cursor: "pointer",
                width: "100%",
              }}
              disabled={loading}
            >
              {loading
                ? "Saving..."
                : isEditing
                ? "Save Changes"
                : "Edit Information"}
            </button>
            {isEditing && (
              <button
                onClick={() => setIsEditing(false)}
                className="form-field"
                style={{
                  backgroundColor: "#d69824",
                  color: "white",
                  padding: "10px 20px",
                  borderRadius: "8px",
                  border: "none",
                  cursor: "pointer",
                  width: "100%",
                }}
                disabled={loading}
              >
                Cancel
              </button>
            )}
          </div>
        )}
        {loading ? (
          <div className="p-4">
            <Skeleton count={5} className="mb-2" />
          </div>
        ) : (
          <>
            {organizationData && (
              <div className="grid gap-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="form-group" style={formGroupStyle}>
                    {isEditing ? (
                      <>
                        <label
                          className="block text-sm font-medium text-gray-700"
                          style={formLabelStyle}
                        >
                          Address
                        </label>
                        <input
                          type="text"
                          name="address"
                          value={formData.address}
                          onChange={handleInputChange}
                          className="form-field"
                          style={{
                            width: "100%",
                            padding: "10px",
                            borderRadius: "8px",
                            border: validationErrors.address
                              ? "1px solid #EF4444"
                              : "1px solid #E5E7EB",
                            marginTop: "8px",
                            fontSize: "14px",
                          }}
                        />
                        {validationErrors.address && (
                          <p className="text-red-600 text-sm">
                            {validationErrors.address}
                          </p>
                        )}
                      </>
                    ) : (
                      <ContactSection
                        icon="📍"
                        label="Address"
                        value={organizationData.address}
                      />
                    )}
                  </div>
                  <div className="form-group" style={formGroupStyle}>
                    {isEditing ? (
                      <>
                        <label
                          className="block text-sm font-medium text-gray-700"
                          style={formLabelStyle}
                        >
                          Website
                        </label>
                        <input
                          type="url"
                          name="website"
                          value={formData.website}
                          onChange={handleInputChange}
                          className="form-field"
                          style={{
                            width: "100%",
                            padding: "10px",
                            borderRadius: "8px",
                            border: validationErrors.website
                              ? "1px solid #EF4444"
                              : "1px solid #E5E7EB",
                            marginTop: "8px",
                            fontSize: "14px",
                          }}
                        />
                        {validationErrors.website && (
                          <p className="text-red-600 text-sm">
                            {validationErrors.website}
                          </p>
                        )}
                      </>
                    ) : (
                      <ContactSection
                        icon="🌐"
                        label="Website"
                        value={organizationData.website}
                        link={
                          organizationData.website?.startsWith("http")
                            ? organizationData.website
                            : `https://${organizationData.website}`
                        }
                      />
                    )}
                  </div>
                  <div className="form-group" style={formGroupStyle}>
                    {isEditing ? (
                      <>
                        <label
                          className="block text-sm font-medium text-gray-700"
                          style={formLabelStyle}
                        >
                          Email
                        </label>
                        <input
                          type="email"
                          name="email"
                          value={formData.email}
                          onChange={handleInputChange}
                          className="form-field"
                          style={{
                            width: "100%",
                            padding: "10px",
                            borderRadius: "8px",
                            border: validationErrors.email
                              ? "1px solid #EF4444"
                              : "1px solid #E5E7EB",
                            marginTop: "8px",
                            fontSize: "14px",
                          }}
                        />
                        {validationErrors.email && (
                          <p className="text-red-600 text-sm">
                            {validationErrors.email}
                          </p>
                        )}
                      </>
                    ) : (
                      <ContactSection
                        icon="📧"
                        label="Email"
                        value={organizationData.email}
                        link={`mailto:${organizationData.email}`}
                      />
                    )}
                  </div>
                  <div className="form-group" style={formGroupStyle}>
                    {isEditing ? (
                      <>
                        <label
                          className="block text-sm font-medium text-gray-700"
                          style={formLabelStyle}
                        >
                          Phone
                        </label>
                        <input
                          type="tel"
                          name="phone"
                          value={formData.phone}
                          onChange={handleInputChange}
                          placeholder="(123)456-7890"
                          maxLength="13"
                          className="form-field"
                          style={{
                            width: "100%",
                            padding: "10px",
                            borderRadius: "8px",
                            border: validationErrors.phone
                              ? "1px solid #EF4444"
                              : "1px solid #E5E7EB",
                            marginTop: "8px",
                            fontSize: "14px",
                          }}
                        />
                        {validationErrors.phone && (
                          <p className="text-red-600 text-sm">
                            {validationErrors.phone}
                          </p>
                        )}
                      </>
                    ) : (
                      <ContactSection
                        icon="📞"
                        label="Phone"
                        value={formatPhoneNumber(organizationData.phone)}
                        link={`tel:${organizationData.phone}`}
                      />
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Navigation Cards */}
      <div style={{ marginTop: "2rem" }}>
        {getFilteredNavigationSections().map((section, sectionIndex) => (
          <div key={sectionIndex} style={{ marginBottom: "2rem" }}>
            <h2 style={{ marginBottom: "1rem", fontSize: "1.5rem", fontWeight: "bold" }}>{section.title}</h2>
            <div style={{ 
              display: "grid", 
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", 
              gap: "1rem" 
            }}>
              {section.cards.map((card, cardIndex) => (
                <Link 
                  key={cardIndex} 
                  to={card.path}
                  style={{
                    textDecoration: "none",
                    color: "inherit"
                  }}  
                >
                  <div style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    padding: "1.5rem",
                    transition: "transform 0.2s, box-shadow 0.2s",
                    cursor: "pointer",
                    backgroundColor: "white"
                  }}>
                    <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>{card.icon}</div>
                    <h3 style={{ margin: "0 0 0.5rem 0" }}>{card.title}</h3>
                    <p style={{ margin: 0, color: "#6b7280" }}>{card.description}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Success message */}
      {saveSuccess && (
        <div style={{
          position: "fixed",
          bottom: "20px",
          right: "20px",
          backgroundColor: "#10B981",
          color: "white",
          padding: "1rem",
          borderRadius: "0.5rem",
          boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
          zIndex: 50
        }}>
          Organization information updated successfully!
        </div>
      )}
    </div>
  );
};

export default MiOrganizacion;
