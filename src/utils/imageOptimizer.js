/**
 * Image optimization utilities
 * Ensures all images load fast with lazy loading and error handling
 */

/**
 * Creates an optimized image element with lazy loading
 */
export const createOptimizedImage = (src, alt = '', options = {}) => {
  const {
    className = '',
    style = {},
    loading = 'lazy',
    onError,
    placeholder = '/img/image-placeholder.png',
    fallback = '/img/image-fallback.svg',
    ...props
  } = options;

  const handleError = (e) => {
    if (e.target.src !== fallback && e.target.src !== placeholder) {
      e.target.src = fallback;
      if (onError) onError(e);
    }
  };

  return {
    src,
    alt,
    className,
    style,
    loading,
    onError: handleError,
    ...props
  };
};

/**
 * Preloads critical images (above the fold)
 */
export const preloadImage = (src) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
};

/**
 * Gets optimized image URL with error handling
 */
export const getOptimizedImageUrl = (url, fallback = '/img/image-fallback.svg') => {
  if (!url) return fallback;
  if (url.startsWith('http')) return url;
  if (url.startsWith('/')) return `https://iglesia-tech-api.e2api.com${url}`;
  return url;
};



