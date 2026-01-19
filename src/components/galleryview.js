import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { db, auth } from '../firebase';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { getStorage, ref, getDownloadURL } from 'firebase/storage';
import Skeleton from 'react-loading-skeleton';
import "react-loading-skeleton/dist/skeleton.css";
import './Admin.css';  // Updated import path
import './GalleryStyles.css';  // Import the new gallery styles
import axios from 'axios';
import ChurchHeader from './ChurchHeader';
import commonStyles from '../pages/commonStyles';
const API_BASE_URL = "https://iglesia-tech-api.e2api.com";

const GalleryView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [galleries, setGalleries] = useState([]);
  const [church, setChurch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    status: ''
  });
  const [images, setImages] = useState([]);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  useEffect(() => {
    fetchGalleries();
  }, [id]);

  // Add debugging for gallery data
  useEffect(() => {
    if (galleries.length > 0) {
      console.log("Current galleries data:", galleries);
      console.log("Current images data:", images);
      
      // Debug image formats
      const imageFormats = galleries.map(gallery => {
        if (!gallery.images) return { galleryId: gallery.id, format: 'no-images' };
        
        const firstImage = gallery.images[0];
        const format = typeof firstImage === 'string' 
          ? 'string-url' 
          : (typeof firstImage === 'object' ? 'object-with-url' : 'unknown');
          
        return { 
          galleryId: gallery.id, 
          format, 
          imageCount: gallery.images.length,
          sampleImage: firstImage
        };
      });
      
      console.log("Gallery image formats:", imageFormats);
    }
  }, [galleries, images]);

  useEffect(() => {
    const fetchChurchData = async () => {
      // ...same as above...
    };

    fetchChurchData();
  }, [id]);
  const fetchGalleries = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, 'gallery_new'));
      const allGalleryData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Filter galleries to only show those belonging to the current church
      const churchGalleries = allGalleryData.filter(gallery => {
        // Convert church ID to both string and number for comparison
        const churchIdStr = String(id);
        const churchIdNum = parseInt(id);
        
        // Check if gallery belongs to this church using idIglesia or churchId fields
        const belongsToChurch = (
          gallery.idIglesia === churchIdNum ||
          gallery.idIglesia === churchIdStr ||
          gallery.churchId === churchIdNum ||
          gallery.churchId === churchIdStr
        );
        
        return belongsToChurch;
      });

      console.log(`Church ${id}: Found ${churchGalleries.length} galleries out of ${allGalleryData.length} total galleries`);
      setGalleries(churchGalleries);

      // Process images for each gallery (only for church-specific galleries)
      const processedImages = [];
      
      for (const gallery of churchGalleries) {
        // Skip if gallery has no images
        if (!gallery.images || !Array.isArray(gallery.images) || gallery.images.length === 0) {
          continue;
        }

        for (const image of gallery.images) {          try {
            if (typeof image === 'string') {
              // Handle string URLs (legacy format)
              processedImages.push({
                galleryId: gallery.id,
                url: image,
                id: `img-${processedImages.length}-${Date.now()}`,
                likes: [],
                loves: []
              });
            } else if (typeof image === 'object' && image !== null && image.url) {
              // Handle object-based image data (new format)
              processedImages.push({
                galleryId: gallery.id,
                ...image,
                id: image.id || `img-${processedImages.length}-${Date.now()}`,
                likes: image.likes || [],
                loves: image.loves || []
              });
            }
          } catch (error) {
            console.error("Error processing image:", error, image);
          }
        }
      }
      
      setImages(processedImages);
      console.log("Processed gallery images:", processedImages);
    } catch (error) {
      console.error('Error fetching galleries:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (gallery) => {
    setEditingId(gallery.id);
    setEditForm({
      name: gallery.name,
      description: gallery.description,
      status: gallery.status
    });
  };

  const handleUpdate = async (galleryId) => {
    try {
      const galleryRef = doc(db, 'gallery_new', galleryId);
      await updateDoc(galleryRef, {
        ...editForm,
        updatedAt: new Date()
      });
      setEditingId(null);
      fetchGalleries();
    } catch (error) {
      console.error('Error updating gallery:', error);
    }
  };

  const handleBack = (id) => {
    navigate(`/church/${id}/gallery-admin`);
  };

  return (
    <div className="admin-container">
      <button
        onClick={() => handleBack(id)}
        style={{ ...commonStyles.backButtonLink }}
      >
        ← Back to Gallery Admin
      </button>
      
      <ChurchHeader id={id} />
      
      <div className="content-box">
        <h1>Gallery Management</h1>

        {loading ? (
          <Skeleton count={5} height={40} />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="gallery-table">
              <thead>
                <tr>
                  <th className="gallery-th">Name</th>
                  <th className="gallery-th">Description</th>
                  <th className="gallery-th">Status</th>
                  <th className="gallery-th">Images</th>
                  <th className="gallery-th">Created By</th>
                  <th className="gallery-th">Created At</th>
                  <th className="gallery-th">Actions</th>
                </tr>
              </thead>
              <tbody>
                {galleries.map(gallery => (
                  <tr key={gallery.id}>
                    <td className="gallery-td">
                      {editingId === gallery.id ? (
                        <input
                          className="gallery-input"
                          type="text"
                          value={editForm.name}
                          onChange={(e) => setEditForm({...editForm, name: e.target.value})}
                        />
                      ) : (
                        gallery.name
                      )}
                    </td>
                    <td className="gallery-td">
                      {editingId === gallery.id ? (
                        <input
                          className="gallery-input"
                          type="text"
                          value={editForm.description}
                          onChange={(e) => setEditForm({...editForm, description: e.target.value})}
                        />
                      ) : (
                        gallery.description
                      )}
                    </td>
                    <td className="gallery-td">
                      {editingId === gallery.id ? (
                        <select
                          className="gallery-input"
                          value={editForm.status}
                          onChange={(e) => setEditForm({...editForm, status: e.target.value})}
                        >
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                      ) : (
                        gallery.status
                      )}
                    </td>                    <td className="gallery-td">
                      <div className="gallery-grid">
                        {images
                          .filter(image => image.galleryId === gallery.id)
                          .slice(0, 4) // Only show first 4 images as thumbnails
                          .map((image, index) => (
                            <div key={index} className="image-container">
                              <img
                                src={image.url}
                                alt={`Gallery image ${index + 1}`}
                                className="gallery-image"
                                loading="lazy"
                                onError={(e) => {
                                  console.error(`Failed to load gallery thumbnail: ${image.url}`);
                                  e.target.src = '/img/image-placeholder.png';
                                  e.target.classList.add('image-error');
                                }}
                                onClick={() => {
                                  setSelectedImage(image);
                                  setLightboxOpen(true);
                                }}
                              />
                            </div>
                          ))}
                        {images.filter(image => image.galleryId === gallery.id).length === 0 && !gallery.images?.length && (
                          <div className="no-images-message">No images in this gallery</div>
                        )}
                      </div>                      {(!gallery.images || gallery.images.length === 0) && (
                        <button
                          onClick={() => {
                            if (auth.currentUser) {
                              navigate(`/church/${id}/gallery-upload?gallery=${gallery.id}`);
                            } else {
                              alert("You must be logged in to upload images");
                            }
                          }}
                          className="add-images-button"
                        >
                          Add Images
                        </button>
                      )}
                    </td>
                    <td className="gallery-td">{gallery.createdBy?.email || 'N/A'}</td>
                    <td className="gallery-td">
                      {gallery.createdAt?.toDate().toLocaleDateString() || 'N/A'}
                    </td>                    <td className="gallery-td">                      {gallery.images && gallery.images.length > 0 ? (
                        <Link
                          to={`/church/${id}/gallery-images/${gallery.id}`}
                          className="view-button"
                        >
                          View Images
                        </Link>
                      ) : (
                        <button
                          onClick={() => {
                            if (auth.currentUser) {
                              navigate(`/church/${id}/gallery-upload?gallery=${gallery.id}`);
                            } else {
                              alert("You must be logged in to upload images");
                            }
                          }}
                          className="upload-button"
                        >
                          Upload Images
                        </button>
                      )}
                      {/* Always show upload button */}                      <button
                        onClick={() => {
                          if (auth.currentUser) {
                            // Explicitly log the gallery ID to verify it's being passed correctly
                            console.log("Navigating to upload with gallery ID:", gallery.id);
                            navigate(`/church/${id}/gallery-upload?gallery=${gallery.id}`);
                          } else {
                            alert("You must be logged in to upload images");
                          }
                        }}
                        className="upload-button"
                        style={{ marginLeft: '8px' }}
                      >
                        Add Images
                      </button>
                      {editingId === gallery.id ? (
                        <button
                          className="update-button"
                          onClick={() => handleUpdate(gallery.id)}
                        >
                          Update
                        </button>
                      ) : (
                        <button
                          className="edit-button"
                          onClick={() => handleEdit(gallery)}
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Lightbox for full-size image view */}
      {lightboxOpen && selectedImage && (
        <div 
          className="lightbox-overlay"
          onClick={() => setLightboxOpen(false)}
        >          <div className="lightbox-content" onClick={e => e.stopPropagation()}>
            <img
              src={selectedImage.url}
              alt="Full size gallery image"
              className="lightbox-image"
              onError={(e) => {
                console.error(`Failed to load lightbox image: ${selectedImage.url}`);
                e.target.src = '/img/image-placeholder.png';
                e.target.classList.add('image-error');
              }}
            />
            <button 
              className="lightbox-close"
              onClick={() => setLightboxOpen(false)}
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default GalleryView;