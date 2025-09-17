import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { storage, db, auth } from '../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, updateDoc, arrayUnion, getDoc, collection, getDocs } from 'firebase/firestore';
import './Admin.css';

// Add custom styles for the gallery upload component
const styles = {
  errorMessage: {
    color: 'red',
    padding: '10px',
    background: '#ffeeee',
    border: '1px solid #ffaaaa',
    borderRadius: '4px',
    margin: '10px 0',
    fontWeight: 'bold',
    fontSize: '14px',
    textAlign: 'center',
    whiteSpace: 'pre-line' // Preserve line breaks in error messages
  },
  successMessage: {
    color: 'green',
    padding: '10px',
    background: '#eeffee',
    border: '1px solid #aaffaa',
    borderRadius: '4px',
    margin: '10px 0',
    fontWeight: 'bold',
    fontSize: '14px',
    textAlign: 'center'
  },
  noGalleryContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '20px',
    background: '#f9f9f9',
    border: '1px solid #ddd',
    borderRadius: '8px',
    margin: '20px 0'
  },
  galleryInfo: {
    marginBottom: '20px',
    background: '#f5f5f5',
    padding: '15px',
    borderRadius: '4px',
    border: '1px solid #e0e0e0'
  },
  galleryName: {
    margin: '0 0 10px 0',
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#333'
  },
  galleryDescription: {
    margin: '0',
    fontSize: '14px',
    color: '#666'
  },
  progressBarContainer: {
    width: '100%',
    height: '20px',
    backgroundColor: '#e0e0e0',
    borderRadius: '10px',
    overflow: 'hidden',
    margin: '15px 0'
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#4a90e2',
    borderRadius: '10px',
    transition: 'width 0.3s ease'
  },
  progressText: {
    textAlign: 'center',
    fontSize: '14px',
    marginTop: '5px'
  },
  galleryDropdown: {
    width: '100%',
    maxWidth: '500px',
    marginBottom: '20px',
    padding: '15px',
    background: '#f0f8ff',
    borderRadius: '8px',
    border: '1px solid #cce5ff'
  },
  dropdownLabel: {
    display: 'block',
    marginBottom: '10px',
    fontWeight: 'bold',
    fontSize: '16px'
  },
  select: {
    width: '100%',
    padding: '10px',
    fontSize: '16px',
    borderRadius: '4px',
    border: '1px solid #ccc',
    marginBottom: '15px'
  }
};

const GalleryUpload = () => {    const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
    // Extract gallery ID from URL query parameters
  const galleryId = new URLSearchParams(location.search).get('gallery');
  const [galleryData, setGalleryData] = useState(null);
  const [galleryExists, setGalleryExists] = useState(false);
  const [galleryLoading, setGalleryLoading] = useState(true);
  
  // New state variables for gallery dropdown
  const [allGalleries, setAllGalleries] = useState([]);
  const [selectedGalleryId, setSelectedGalleryId] = useState('');
  const [loadingGalleries, setLoadingGalleries] = useState(false);
  
  // Debug the URL and search parameters
  console.log("Current location:", location);
  console.log("Search params:", location.search);
  console.log("Gallery ID from URL:", galleryId);
  
  if (!galleryId) {
    console.error("No gallery ID found in URL. The correct URL format should be /church/:id/gallery-upload?gallery=GALLERY_ID");
  }

  // Add auth state listener
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) {
        console.log("User is signed in:", user.uid);
        setAuthenticated(true);
        setError(""); // Clear any auth-related errors
      } else {
        console.log("User is not signed in");
        setAuthenticated(false);
        setError("You must be logged in to upload images. Please log in and try again.");
      }
    });
    
    // Cleanup subscription
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    // Clean up previews on unmount
    return () => previews.forEach(preview => URL.revokeObjectURL(preview.url));
  }, [previews]);
  const validateFile = (file) => {
    // Check if it's an image
    if (!file.type.match('image.*')) {
      return { valid: false, reason: `File "${file.name}" is not an image.` };
    }
    
    // Check file size (5MB max as per storage rules)
    const maxSize = 5 * 1024 * 1024; // 5MB in bytes
    if (file.size > maxSize) {
      return { 
        valid: false, 
        reason: `File "${file.name}" exceeds the 5MB size limit (${(file.size / (1024 * 1024)).toFixed(2)}MB).` 
      };
    }
    
    return { valid: true };
  };

  const handleFileChange = (e) => {
    e.preventDefault(); // Prevent page refresh
    setError(""); // Clear previous errors
    
    const selectedFiles = Array.from(e.target.files);
    const validFiles = [];
    const invalidFiles = [];
    
    // Validate each file
    selectedFiles.forEach(file => {
      const validation = validateFile(file);
      if (validation.valid) {
        validFiles.push(file);
      } else {
        invalidFiles.push(validation.reason);
      }
    });
    
    // Show errors for invalid files
    if (invalidFiles.length > 0) {
      setError(`Some files could not be added:\n${invalidFiles.join('\n')}`);
    }
    
    // Only set valid files
    setFiles(validFiles);

    // Create and set previews for valid files only
    const newPreviews = validFiles.map(file => ({
      file,
      url: URL.createObjectURL(file)
    }));
    setPreviews(newPreviews);
  };  const handleUpload = async () => {
    if (files.length === 0) {
      setError("Please select images to upload first");
      return;
    }
    
    // Use either the URL galleryId or the selected gallery from dropdown
    const targetGalleryId = galleryId || selectedGalleryId;
    
    if (!targetGalleryId) {
      setError("No gallery selected. Please select a gallery first.");
      return;
    }
    
    if (!galleryExists && galleryId) {
      setError("Gallery does not exist or you don't have permission to access it.");
      return;
    }
    
    // Check if user is authenticated
    if (!auth.currentUser) {
      setError("You must be logged in to upload images.");
      return;
    }
    
    // Check if Firebase Storage is initialized properly
    if (!storage) {
      console.error("Firebase Storage is not initialized");
      setError("Storage service is not available. Please try again later.");
      return;
    }
    
    setUploading(true);
    setError("");
    setSuccess("");
    const uploadedUrls = [];
    const failedUploads = [];

    try {      
      // Create upload status array to track progress of each file
      const totalFiles = files.length;
      let completedFiles = 0;
      
      // Process files in batches of 3 for better performance
      const batchSize = 3;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
          // Upload batch in parallel
        const batchResults = await Promise.allSettled(batch.map(async (file) => {          try {
            const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
            console.log(`Creating storage reference: galleries/${targetGalleryId}/${fileName}`);
            const storageRef = ref(storage, `galleries/${targetGalleryId}/${fileName}`);
            
            // Upload with metadata
            const metadata = {
              contentType: file.type,
              customMetadata: {
                uploadedBy: auth.currentUser.uid,
                uploadedAt: new Date().toISOString()
              }
            };
            
            console.log(`Starting upload for file: ${file.name}`);
            const uploadResult = await uploadBytes(storageRef, file, metadata);
            console.log(`Upload completed for file: ${file.name}`, uploadResult);
            
            const downloadUrl = await getDownloadURL(storageRef);
            console.log(`Got download URL for file: ${file.name}`, downloadUrl);            
            return {
              success: true,
              id: `img-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
              url: downloadUrl,
              name: file.name,
              size: file.size,
              type: file.type,
              uploadedAt: new Date().toISOString(),
              likes: [],
              loves: []
            };} catch (err) {
            console.error(`Error uploading file ${file.name}:`, err);
            
            // Provide more specific error messaging based on Firebase error codes
            let errorMessage;
            if (err.code === 'storage/unauthorized') {
              errorMessage = 'Permission denied';
            } else if (err.code === 'storage/canceled') {
              errorMessage = 'Upload was canceled';
            } else if (err.code === 'storage/unknown') {
              errorMessage = 'Unknown error occurred';
            } else if (err.code === 'storage/quota-exceeded') {
              errorMessage = 'Storage quota exceeded';
            } else if (err.code === 'storage/invalid-checksum') {
              errorMessage = 'File corrupt or connection interrupted';
            } else if (err.code === 'storage/server-file-wrong-size') {
              errorMessage = 'Upload incomplete, file size mismatch';
            } else {
              errorMessage = err.message || 'Unknown error';
            }
            
            return {
              success: false,
              name: file.name,
              error: errorMessage
            };
          }
        }));
          // Process batch results
        batchResults.forEach(result => {
          completedFiles++;
          
          if (result.status === 'fulfilled' && result.value.success) {
            console.log(`Successfully uploaded: ${result.value.name}`);
            uploadedUrls.push(result.value);
          } else {
            let failedFile;
            if (result.status === 'rejected') {
              console.error(`Promise rejected during upload:`, result.reason);
              failedFile = { 
                name: 'Unknown file', 
                error: result.reason?.message || 'Upload promise rejected' 
              };
            } else {
              failedFile = result.value || { name: 'Unknown file', error: 'Upload failed' };
              console.error(`Upload failed for ${failedFile.name}:`, failedFile.error);
            }
            failedUploads.push(`${failedFile.name}: ${failedFile.error}`);
          }
          
          // Update progress
          setProgress((completedFiles / totalFiles) * 100);
        });
      }      // If we have successful uploads, update the gallery document
      if (uploadedUrls.length > 0) {
        const galleryRef = doc(db, 'gallery_new', targetGalleryId);
        
        try {          console.log(`Updating gallery document ${targetGalleryId} with ${uploadedUrls.length} new images`);
          
          // Use the complete image objects for arrayUnion instead of just URLs
          console.log("Image data to be stored:", uploadedUrls);
          
          // Check if the gallery already has images array
          const gallerySnapshot = await getDoc(galleryRef);
          const galleryData = gallerySnapshot.data();
          
          if (galleryData && Array.isArray(galleryData.images)) {
            // If we have existing images that are just URLs, convert them to objects
            const existingImages = galleryData.images.map((image, index) => {
              if (typeof image === 'string') {
                return {
                  id: `existing-${index}`,
                  url: image,
                  uploadedAt: new Date().toISOString(),
                  likes: [],
                  loves: []
                };
              }
              return image;
            });
            
            // Add new images to the existing ones
            await updateDoc(galleryRef, {
              images: [...existingImages, ...uploadedUrls],
              updatedAt: new Date()
            });
          } else {
            // No existing images, just set the new ones
            await updateDoc(galleryRef, {
              images: uploadedUrls,
              updatedAt: new Date()
            });          }
          
          console.log(`Gallery document ${targetGalleryId} updated successfully`);
          
          // Show success message with info about failed uploads
          let successMessage = `Successfully uploaded ${uploadedUrls.length} images`;
          
          if (failedUploads.length > 0) {
            successMessage += `, but ${failedUploads.length} uploads failed.`;
            setSuccess(successMessage);
            setError(`Failed uploads:\n${failedUploads.join('\n')}`);
          } else {
            // All uploads succeeded
            setSuccess(`${successMessage}! Redirecting to gallery view...`);
            // Navigate back to gallery view after a short delay
            setTimeout(() => navigate(`/church/${id}/gallery-view`), 2000);
          }
        } catch (updateError) {
          console.error('Error updating gallery document:', updateError);
          
          // Firebase storage uploads succeeded but Firestore update failed
          let updateErrorMessage;
          if (updateError.code === 'permission-denied') {
            updateErrorMessage = 'You do not have permission to update this gallery.';
          } else {
            updateErrorMessage = updateError.message || 'Failed to update gallery information.';
          }
          
          setError(`Images were uploaded but couldn't be added to the gallery: ${updateErrorMessage}`);
          setSuccess(`${uploadedUrls.length} images were uploaded to storage, but not added to the gallery due to an error.`);
        }
      } else if (failedUploads.length > 0) {
        setError(`All uploads failed:\n${failedUploads.join('\n')}`);
      }
    } catch (error) {
      console.error('Error uploading images:', error);
      
      // More specific error message to help with troubleshooting
      let errorMessage;
      
      if (error.code === 'storage/unauthorized') {
        errorMessage = 'Error: You do not have permission to upload to this gallery. Please check your login and permissions.';
      } else if (error.code === 'storage/canceled') {
        errorMessage = 'Error: Upload was cancelled.';
      } else if (error.code === 'storage/unknown') {
        errorMessage = 'Error: An unknown error occurred during upload. Please try again.';
      } else if (error.code === 'permission-denied') {
        errorMessage = 'Error: You do not have permission to update this gallery.';
      } else {
        errorMessage = error.code
          ? `Error (${error.code}): ${error.message}`
          : 'Error uploading images. Please try again.';
      }
      
      setError(errorMessage);
      alert('Upload failed: ' + errorMessage);
    } finally {
      setUploading(false);
      
      // Keep progress at 100% if there were any successful uploads
      if (uploadedUrls.length > 0) {
        setProgress(100);
      } else {
        setProgress(0);
      }
    }
  };  // Fetch gallery data to verify it exists
  useEffect(() => {    const fetchGallery = async () => {
      // Use either the URL gallery ID or the selected gallery from dropdown
      const targetGalleryId = galleryId || selectedGalleryId;
      
      if (!targetGalleryId) {
        console.warn('No gallery ID found in URL parameters or selected from dropdown');
        // Don't show error here, we'll show the dropdown instead
        setGalleryLoading(false);
        return;
      }
      
      try {
        console.log(`Fetching gallery data for ID: ${targetGalleryId}`);
        const galleryRef = doc(db, 'gallery_new', targetGalleryId);
        const gallerySnap = await getDoc(galleryRef);
        
        if (gallerySnap.exists()) {
          console.log("Gallery found:", gallerySnap.data());
          setGalleryData(gallerySnap.data());
          setGalleryExists(true);
          setError(""); // Clear any errors if gallery exists
        } else {
          console.error("Gallery not found!");
          setError(`Gallery with ID ${targetGalleryId} not found. Please check the URL or select another gallery.`);
          setGalleryExists(false);
        }
      } catch (err) {
        console.error("Error fetching gallery:", err);
        setError(`Error loading gallery: ${err.message}`);
        setGalleryExists(false);
      } finally {
        setGalleryLoading(false);
      }
    };
    
    // Check if user is authenticated
    const checkAuth = async () => {
      if (!auth.currentUser) {
        console.warn('User not authenticated');
        setError("You must be logged in to upload images. Please log in and try again.");
        setGalleryLoading(false);
        return false;
      }
      return true;
    };
      const initialize = async () => {
      const isAuthenticated = await checkAuth();
      // Fetch gallery if we have either a URL gallery ID or one selected from dropdown
      const targetGalleryId = galleryId || selectedGalleryId;
      if (isAuthenticated && targetGalleryId) {
        fetchGallery();
      } else {
        setGalleryLoading(false);
      }
    };
    
    initialize();
  }, [galleryId, selectedGalleryId]);

  // Fetch all galleries for the dropdown
  useEffect(() => {
    const fetchAllGalleries = async () => {
      if (!authenticated) return;
      
      setLoadingGalleries(true);
      try {
        console.log("Fetching all galleries for dropdown");
        const querySnapshot = await getDocs(collection(db, 'gallery_new'));
        const galleryList = querySnapshot.docs.map(doc => ({
          id: doc.id,
          name: doc.data().name,
          description: doc.data().description || '',
          status: doc.data().status
        })).filter(gallery => gallery.status !== 'inactive');
        
        console.log("Available galleries:", galleryList);
        setAllGalleries(galleryList);
        
        // If no gallery is selected but we have galleries, select the first one
        if (!selectedGalleryId && !galleryId && galleryList.length > 0) {
          setSelectedGalleryId(galleryList[0].id);
        }
      } catch (err) {
        console.error("Error fetching galleries:", err);
        setError(`Error loading galleries: ${err.message}`);
      } finally {
        setLoadingGalleries(false);
      }
    };
    
    fetchAllGalleries();
  }, [authenticated, galleryId, selectedGalleryId]);

  // Show loading state
  if (galleryLoading) {
    return (
      <div className="upload-container">
        <h2>Loading Gallery...</h2>
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          padding: '40px',
          fontSize: '18px'
        }}>
          <div className="loading-spinner"></div>
        </div>
      </div>
    );
  }
  
  // If user is not authenticated
  if (!authenticated) {
    return (
      <div className="upload-container">
        <h2>Authentication Required</h2>
        
        <div style={styles.noGalleryContainer}>
          <div style={styles.errorMessage}>
            {error || "You must be logged in to upload images."}
          </div>
          
          <p style={{marginTop: '20px'}}>
            Please log in to your account and try again.
          </p>
          
          <button 
            onClick={() => navigate(`/church/${id}/gallery-view`)}
            style={{
              marginTop: '20px',
              padding: '10px 20px', 
              backgroundColor: '#4a90e2',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Go to Gallery View
          </button>
        </div>
      </div>
    );
  }
  // If no gallery ID is present, show dropdown to select a gallery
  if (!galleryId) {
    return (
      <div className="upload-container">
        <h2>Upload Images to Gallery</h2>
        
        <div style={styles.noGalleryContainer}>
          {loadingGalleries ? (
            <div style={{textAlign: 'center', padding: '20px'}}>
              <div className="loading-spinner"></div>
              <p>Loading galleries...</p>
            </div>
          ) : allGalleries.length > 0 ? (
            <>
              <h3 style={{marginBottom: '15px'}}>Select a Gallery to Upload Images</h3>
              
              <div style={styles.galleryDropdown}>
                <label htmlFor="gallery-select" style={styles.dropdownLabel}>
                  Choose Gallery:
                </label>
                <select 
                  id="gallery-select"
                  value={selectedGalleryId}
                  onChange={(e) => setSelectedGalleryId(e.target.value)}
                  style={styles.select}
                >
                  <option value="">-- Select a Gallery --</option>
                  {allGalleries.map(gallery => (
                    <option key={gallery.id} value={gallery.id}>
                      {gallery.name} {gallery.description ? `- ${gallery.description}` : ''}
                    </option>
                  ))}
                </select>
                
                <div style={{marginTop: '15px', display: 'flex', justifyContent: 'center'}}>
                  <button 
                    onClick={() => {
                      if (selectedGalleryId) {
                        navigate(`/church/${id}/gallery-upload?gallery=${selectedGalleryId}`);
                      } else {
                        setError("Please select a gallery first");
                      }
                    }}
                    style={{
                      padding: '10px 20px', 
                      backgroundColor: selectedGalleryId ? '#4a90e2' : '#cccccc',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: selectedGalleryId ? 'pointer' : 'not-allowed',
                      fontSize: '16px'
                    }}
                    disabled={!selectedGalleryId}
                  >
                    {selectedGalleryId ? 'Continue to Upload' : 'Select a Gallery First'}
                  </button>
                </div>
              </div>
              
              {error && <div style={styles.errorMessage}>{error}</div>}
              
              <div style={{marginTop: '10px', display: 'flex', justifyContent: 'center'}}>
                <button 
                  onClick={() => navigate(`/church/${id}/gallery-view`)}
                  style={{
                    padding: '8px 15px', 
                    backgroundColor: '#f0f0f0',
                    color: '#444',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '14px'
                  }}
                >
                  Back to Gallery View
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={styles.errorMessage}>
                No galleries found. You need to create a gallery before uploading images.
              </div>
              
              <div style={{marginTop: '20px', display: 'flex', justifyContent: 'center'}}>
                <button 
                  onClick={() => navigate(`/church/${id}/gallery-view`)}
                  style={{
                    padding: '10px 20px', 
                    backgroundColor: '#4a90e2',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '16px'
                  }}
                >
                  Go to Gallery View
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }
  
  // If gallery doesn't exist
  if (!galleryExists) {
    return (
      <div className="upload-container">
        <h2>Gallery Not Found</h2>
        
        <div style={styles.noGalleryContainer}>
          <div style={styles.errorMessage}>
            {error || `Gallery with ID ${galleryId} was not found.`}
          </div>
          
          <p style={{marginTop: '20px'}}>
            The gallery you're trying to upload to doesn't exist or you may not have permission to access it.
          </p>
          
          <button 
            onClick={() => navigate(`/church/${id}/gallery-view`)}
            style={{
              marginTop: '20px',
              padding: '10px 20px', 
              backgroundColor: '#4a90e2',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Go to Gallery View
          </button>
        </div>
      </div>
    );
  }
    // Main UI when gallery ID is present and gallery exists
  return (
    <div className="upload-container">
      <h2>Upload Images to Gallery</h2>
      
      {galleryData && (
        <div style={styles.galleryInfo}>
          <h3 style={styles.galleryName}>{galleryData.name}</h3>
          {galleryData.description && (
            <p style={styles.galleryDescription}>{galleryData.description}</p>
          )}
        </div>
      )}
      
      {error && <div style={styles.errorMessage}>{error}</div>}
      {success && <div style={styles.successMessage}>{success}</div>}
      
      <div className="upload-area">
        <label htmlFor="file-upload" className="custom-file-upload">
          <div className="file-input-container">
            <div className="file-input-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M19 13V19H5V13H3V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V13H19Z" fill="currentColor"/>
                <path d="M11 12.586L7.707 9.293L6.293 10.707L12 16.414L17.707 10.707L16.293 9.293L13 12.586V3H11V12.586Z" fill="currentColor"/>
              </svg>
            </div>
            <div className="file-input-text">
              {!files.length ? 'Choose files or drag and drop' : `${files.length} file${files.length !== 1 ? 's' : ''} selected`}
            </div>
          </div>
        </label>
        <input
          id="file-upload"
          type="file"
          multiple
          accept="image/*"
          onChange={handleFileChange}
          disabled={uploading}
          className="file-input"
          style={{ display: 'none' }}
        />
        
        {previews.length > 0 && (
          <div className="preview-grid">
            {previews.map((preview, index) => (
              <div key={index} className="preview-container">
                <img
                  src={preview.url}
                  alt={`Preview ${index + 1}`}
                  className="preview-image"
                />
                <div className="image-size-info">
                  {(preview.file.size / 1024 / 1024).toFixed(2)} MB
                </div>
              </div>
            ))}
          </div>
        )}          {(uploading || progress === 100) && (
          <>
            <div style={styles.progressBarContainer}>
              <div 
                style={{
                  ...styles.progressBarFill,
                  width: `${progress}%`,
                  backgroundColor: progress === 100 && !uploading ? '#4caf50' : '#4a90e2'
                }}
              ></div>
            </div>
            <div style={styles.progressText}>
              {progress === 100 && !uploading 
                ? 'Upload Complete!' 
                : `Uploading... ${Math.round(progress)}%`
              }
            </div>
          </>
        )}
        
        <div className="button-container">          <button
            onClick={handleUpload}
            disabled={files.length === 0 || uploading || (!galleryId && !selectedGalleryId)}
            className="upload-button"
            style={{ 
              opacity: files.length === 0 || (!galleryId && !selectedGalleryId) ? 0.6 : 1,
              backgroundColor: files.length > 0 && !uploading ? '#4a90e2' : '#cccccc',
              cursor: files.length === 0 || uploading || (!galleryId && !selectedGalleryId) ? 'not-allowed' : 'pointer' 
            }}
          >
            {!galleryId && !selectedGalleryId
              ? "Missing Gallery ID"
              : uploading 
                ? `Uploading... ${Math.round(progress)}%` 
                : files.length > 0 
                  ? `Upload ${files.length} Image${files.length > 1 ? 's' : ''}` 
                  : 'Select Images to Upload'
            }
          </button>
            
          <button
            onClick={() => navigate(`/church/${id}/gallery-view`)}
            className="cancel-button"
            disabled={uploading}
            style={{
              opacity: uploading ? 0.6 : 1,
              cursor: uploading ? 'not-allowed' : 'pointer'
            }}
          >
            {uploading ? 'Uploading...' : 'Back to Gallery'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default GalleryUpload;