/**
 * Production Build Helpers
 * Fixes image paths and URLs for production deployment
 */

/**
 * Get correct image path for production
 */
export const getImagePath = (path) => {
  if (!path) return getFallbackImage();
  
  // If already a full URL, return as is
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  
  // Handle relative paths
  if (path.startsWith('/')) {
    // For production, use PUBLIC_URL if set
    const publicUrl = process.env.PUBLIC_URL || '';
    return `${publicUrl}${path}`;
  }
  
  // Relative path without leading slash
  const publicUrl = process.env.PUBLIC_URL || '';
  return `${publicUrl}/${path}`;
};

/**
 * Get fallback image path
 */
export const getFallbackImage = () => {
  const publicUrl = process.env.PUBLIC_URL || '';
  return `${publicUrl}/img/image-fallback.svg`;
};

/**
 * Get image path with PUBLIC_URL (use this for all image paths)
 */
export const getImagePath = (path) => {
  if (!path) return getFallbackImage();
  const publicUrl = process.env.PUBLIC_URL || '';
  // If path already starts with http, return as is
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  // Add PUBLIC_URL prefix
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${publicUrl}${cleanPath}`;
};

/**
 * Get Firebase Storage URL (works in production)
 */
export const getFirebaseStorageUrl = (path, bucket = null) => {
  if (!path) return getFallbackImage();
  
  // If already a full URL, return as is
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  
  const storageBucket = bucket || 
    process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || 
    'igletechv1.firebasestorage.app';
  
  // Remove leading slash if present
  const cleanPath = path.startsWith('/') ? path.substring(1) : path;
  
  return `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodeURIComponent(cleanPath)}?alt=media`;
};

/**
 * Get API image URL (works in production)
 */
export const getApiImageUrl = (path) => {
  if (!path) return getFallbackImage();
  
  // If already a full URL, return as is
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  
  // Handle API paths
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `https://iglesia-tech-api.e2api.com${cleanPath}`;
};

/**
 * Check if running in production
 */
export const isProduction = () => {
  return process.env.NODE_ENV === 'production';
};

/**
 * Get base URL for assets
 */
export const getBaseUrl = () => {
  if (isProduction() && process.env.PUBLIC_URL) {
    return process.env.PUBLIC_URL;
  }
  return '';
};

