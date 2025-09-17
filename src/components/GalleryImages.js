import React, { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { db, auth } from '../firebase';
import { doc, getDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import Skeleton from 'react-loading-skeleton';
import "react-loading-skeleton/dist/skeleton.css";
import './Admin.css';
import './GalleryStyles.css';
import ChurchHeader from './ChurchHeader';

const GalleryImages = () => {
  const { id, galleryId } = useParams();
  const [gallery, setGallery] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [user, setUser] = useState(null);
  const [images, setImages] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      setUser(user);
    });
    return () => unsubscribe();
  }, []);
  useEffect(() => {
    const fetchGallery = async () => {
      try {
        const galleryRef = doc(db, 'gallery_new', galleryId);
        const gallerySnap = await getDoc(galleryRef);
        
        if (gallerySnap.exists()) {
          const data = gallerySnap.data();
          console.log("Fetched gallery data:", { id: gallerySnap.id, ...data });
          setGallery({ id: gallerySnap.id, ...data });
          
          // Validate the images array
          if (!data.images) {
            console.warn("Gallery has no images array");
            data.images = [];
          } else if (!Array.isArray(data.images)) {
            console.error("Gallery images is not an array:", data.images);
            data.images = [];
          }
        } else {
          console.error("Gallery not found:", galleryId);
          setError('Gallery not found');
        }
      } catch (err) {
        console.error('Error fetching gallery:', err);
        setError(`Error loading gallery: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    fetchGallery();
  }, [galleryId]);
  useEffect(() => {
    const fetchGalleryImages = async () => {
      setLoading(true);
      try {
        // Extract photos related to the specific gallery ID
        if (gallery && Array.isArray(gallery.images)) {
          console.log("Gallery images data:", gallery.images);
          
          // Check if images are just URLs (strings) or objects with a url property
          const processedImages = gallery.images.map((image, index) => {
            // If image is just a URL string
            if (typeof image === 'string') {
              return {
                id: `img-${index}`, // Generate an ID if none exists
                url: image,
                thumbnailUrl: image,
                likes: [],
                loves: []
              };
            } 
            // If image is already an object with url property
            else if (typeof image === 'object' && image !== null) {
              return {
                id: image.id || `img-${index}`,
                url: image.url,
                thumbnailUrl: image.url,
                likes: image.likes || [],
                loves: image.loves || []
              };
            }
            // Skip invalid images
            return null;
          }).filter(img => img !== null); // Filter out any null values
          
          setImages(processedImages);
        } else {
          console.log("No images found in gallery or gallery.images is not an array");
          setImages([]);
        }
      } catch (error) {
        console.error("❌ Error fetching gallery images:", error);
        setImages([]);
      }
      setLoading(false);
    };

    fetchGalleryImages();
  }, [gallery]);  const handleReaction = async (type, imageId) => {
    if (!user) return;

    try {
      const galleryRef = doc(db, 'gallery_new', galleryId);
      
      // Find the image in our local state
      const currentImage = images.find(img => img.id === imageId);
      if (!currentImage) {
        console.error(`Image with ID ${imageId} not found`);
        return;
      }
      
      const reactionKey = `${type}s`; // 'likes' or 'loves'
      const userReactions = currentImage[reactionKey] || [];
      const hasReacted = userReactions.includes(user.uid);
      
      // Create updated image object
      const updatedImage = {
        ...currentImage,
        [reactionKey]: hasReacted
          ? userReactions.filter(uid => uid !== user.uid)
          : [...userReactions, user.uid]
      };
      
      // Debug gallery image structure
      const galleryImagesDebug = gallery.images.map(img => {
        if (typeof img === 'string') return { type: 'string', value: img.substring(0, 30) + '...' };
        if (typeof img === 'object') return { 
          type: 'object', 
          hasId: !!img.id, 
          hasUrl: !!img.url,
          id: img.id || 'missing',
          keys: Object.keys(img)
        };
        return { type: typeof img, value: img };
      });
      console.log("Gallery images structure:", galleryImagesDebug);
      
      // Check if gallery.images contains objects with URLs or just URL strings
      let updatedGalleryImages;
      
      if (gallery.images.some(img => typeof img === 'object' && img !== null && img.url)) {
        // Gallery images are objects with url property
        updatedGalleryImages = gallery.images.map(img => {
          if ((img.id && img.id === imageId) || (!img.id && img.url === currentImage.url)) {
            return updatedImage;
          }
          return img;
        });
      } else {
        // Gallery images are just URL strings, so we need to convert to objects
        updatedGalleryImages = gallery.images.map((imgUrl, index) => {
          if (typeof imgUrl === 'string' && imgUrl === currentImage.url) {
            return updatedImage;
          } else if (typeof imgUrl === 'string') {
            // Create a standard object for other images
            return {
              id: `img-${index}`,
              url: imgUrl,
              likes: [],
              loves: []
            };
          }
          return imgUrl;
        });
      }

      // Update Firestore
      console.log("Updating gallery with new image data:", updatedGalleryImages);
      await updateDoc(galleryRef, { images: updatedGalleryImages });
      
      // Update local state
      setGallery({ ...gallery, images: updatedGalleryImages });
      setImages(images.map(img => img.id === imageId ? updatedImage : img));
    } catch (err) {
      console.error('Error updating reaction:', err);
      setError('Failed to update reaction');
    }
  };

  return (
    <div className="admin-container">
      <Link to={`/church/${id}/gallery-view`} className="back-button">
        ← Back to Galleries
      </Link>

      <ChurchHeader id={id} />

      <div className="content-box">
        <h1 className="gallery-title">{gallery?.name}</h1>
        <p className="gallery-description">{gallery?.description}</p>

        {loading ? (
          <Skeleton count={5} height={40} />
        ) : error ? (
          <div className="error-message">{error}</div>
        ) : (          <div className="gallery-grid">
            {images.length === 0 ? (
              <div className="no-images-message">
                No images found in this gallery. 
                <Link to={`/church/${id}/gallery-upload?gallery=${galleryId}`} className="add-images-link">
                  Upload some images
                </Link>
              </div>
            ) : (
              images.map((image, index) => (
                <div key={image.id || `img-${index}`} className="image-container">
                  <img
                    src={image.url}
                    alt={`Gallery image ${index + 1}`}
                    className="gallery-image"
                    loading="lazy"
                    onError={(e) => {
                      console.error(`Failed to load image: ${image.url}`);
                      e.target.src = '/img/image-placeholder.png'; // Fallback image
                      e.target.classList.add('image-error');
                    }}
                    onClick={() => {
                      setSelectedImage(image);
                      setLightboxOpen(true);
                    }}
                  />
                  {user && (
                    <div className="image-reactions">
                      <button
                        className={`reaction-button ${(image.likes || []).includes(user.uid) ? 'active' : ''}`}
                        onClick={() => handleReaction('like', image.id)}
                      >
                        👍 {(image.likes || []).length || 0}
                      </button>
                      <button
                        className={`reaction-button ${(image.loves || []).includes(user.uid) ? 'active' : ''}`}
                        onClick={() => handleReaction('love', image.id)}
                      >
                        ❤️ {(image.loves || []).length || 0}
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
        
        {/* Lightbox for full-size image view */}
        {lightboxOpen && selectedImage && (
          <div 
            className="lightbox-overlay"
            onClick={() => setLightboxOpen(false)}
          >
            <div className="lightbox-content" onClick={e => e.stopPropagation()}>              <img
                src={selectedImage.url}
                alt="Full size gallery image"
                className="lightbox-image"
                onError={(e) => {
                  console.error(`Failed to load lightbox image: ${selectedImage.url}`);
                  e.target.src = '/img/image-placeholder.png'; // Fallback image
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
    </div>
  );
};

export default GalleryImages;