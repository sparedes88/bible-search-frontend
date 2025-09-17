import React, { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import axios from "axios";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import "./Admin.css";
import ChurchHeader from "./ChurchHeader";
import { auth, db } from "../firebase";
import { collection, addDoc } from "firebase/firestore";
import { useAuth } from "../contexts/AuthContext";
import commonStyles from "../pages/commonStyles";

const API_BASE_URL = "https://iglesia-tech-api.e2api.com";

const GalleryAdmin = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [galleryName, setGalleryName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [church, setChurch] = useState(null);
  const [churchLoading, setChurchLoading] = useState(true);
  const [success, setSuccess] = useState(false);
  console.log(user);

  useEffect(() => {
    const fetchChurchData = async () => {
      try {
        if (
          user.role !== "global_admin" &&
          user.role !== "leader" &&
          (user.role !== "admin" || user.churchId !== id)
        ) {
          navigate(`/church/${id}/mi-perfil`);
        }

        const response = await axios.get(
          `${API_BASE_URL}/api/iglesiaTechApp/iglesias/getIglesiaProfileDetail`,
          {
            params: { idIglesia: id },
          }
        );

        if (response.data && response.data.iglesia) {
          const iglesia = response.data.iglesia;
          setChurch({
            id: id,
            name: iglesia.Nombre || "Nombre no disponible",
            banner: iglesia.portadaArticulos
              ? `${API_BASE_URL}${iglesia.portadaArticulos}`
              : "/images/default-banner.jpg",
            logo: iglesia.Logo
              ? `${API_BASE_URL}${iglesia.Logo}`
              : "/images/default-logo.png",
          });
        }
      } catch (error) {
        console.error("Error fetching church:", error);
      }
      setChurchLoading(false);
    };

    fetchChurchData();
  }, [id]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);

    try {
      if (!user) {
        throw new Error("User must be logged in to create a gallery");
      }

      await addDoc(collection(db, "gallery_new"), {
        name: galleryName,
        description: description,
        idIglesia: id,
        createdAt: new Date(),
        updatedAt: new Date(),
        status: "active",
        images: [],
        createdBy: {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName || "Anonymous",
        },
      });

      setSuccess(true);
      // Clear form data
      setGalleryName("");
      setDescription("");
      
      // Hide success message after 2 seconds
      setTimeout(() => {
        setSuccess(false);
      }, 2000);
    } catch (error) {
      console.error("Error creating gallery:", error);
      alert("Error creating gallery. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleBack = (id) => {
    navigate(`/church/${id}/mi-organizacion`);
  };

  return (
    <div style={commonStyles.container}>
      <button
        onClick={() => handleBack(id)}
        style={{ ...commonStyles.backButtonLink }}
      >
        ← Back to Organization
      </button>

      <ChurchHeader id={id} />

      <div className="gallery-form" style={{textAlign:"left"}}>
        <h2 className="gallery-title">Create New Gallery</h2>
        {success && (
          <div className="gallery-success">Gallery Created Successfully!</div>
        )}
        <form onSubmit={handleSubmit}>
          <div className="gallery-input-group">
            <label className="gallery-label">Gallery Name:</label>
            <input
              type="text"
              value={galleryName}
              onChange={(e) => setGalleryName(e.target.value)}
              required
              className="gallery-input"
              placeholder="Enter gallery name"
            />
          </div>

          <div className="gallery-input-group">
            <label className="gallery-label">Description:</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              className="gallery-input"
              style={{ minHeight: "100px" }}
              placeholder="Enter gallery description"
            />
          </div>

          <button type="submit" disabled={loading} className="gallery-submit">
            {loading ? "Creating Gallery..." : "Create Gallery"}
          </button>
        </form>
      </div>

      <div className="gallery-buttons">
        <Link to={`/church/${id}/gallery-upload`} className="gallery-card">
          <h3 className="gallery-card-title">Gallery Upload</h3>
          <p>Upload images to your galleries</p>
        </Link>
        <Link to={`/church/${id}/gallery-view`} className="gallery-card">
          <h3 className="gallery-card-title">Gallery View</h3>
          <p>View and manage your galleries</p>
        </Link>
        <Link to={`/church/${id}/gallery-admin`} className="gallery-card">
          <h3 className="gallery-card-title">Gallery Admin</h3>
          <p>Manage your gallery settings</p>
        </Link>
      </div>
    </div>
  );
};

export default GalleryAdmin;
