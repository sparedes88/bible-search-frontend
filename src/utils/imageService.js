/**
 * Aggressive Image Optimization Service
 * Loads images in 5 seconds or less
 */

// Image cache for instant loading
const imageCache = new Map();
const loadingPromises = new Map();

/**
 * Get optimized image URL with compression
 */
/**
 * Get optimized image URL - works in both dev and production
 */
export const getOptimizedImageUrl = (url, options = {}) => {
  if (!url) {
    // Use absolute path for production
    return process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/img/image-fallback.svg` : '/img/image-fallback.svg';
  }
  
  // If already cached, return immediately
  if (imageCache.has(url)) {
    return imageCache.get(url);
  }

  // If URL is already a full HTTP/HTTPS URL, return as is
  if (url.startsWith('http://') || url.startsWith('https://')) {
    imageCache.set(url, url);
    return url;
  }

  const {
    width = 800,
    quality = 75,
    format = 'webp'
  } = options;

  // Build optimized URL
  let optimizedUrl = url;
  
  // Handle relative paths
  if (url.startsWith('/')) {
    // Check if it's a local asset
    if (url.startsWith('/img/') || url.startsWith('/static/')) {
      // Local asset - use PUBLIC_URL for production
      optimizedUrl = process.env.PUBLIC_URL 
        ? `${process.env.PUBLIC_URL}${url}`
        : url;
    } else {
      // API path - construct full URL
      optimizedUrl = `https://iglesia-tech-api.e2api.com${url}?w=${width}&q=${quality}`;
    }
  } else if (url.includes('iglesia-tech-api.e2api.com')) {
    // API URL - add optimization parameters
    optimizedUrl = `${url}${url.includes('?') ? '&' : '?'}w=${width}&q=${quality}&f=${format}`;
  } else if (!url.startsWith('http')) {
    // Relative path without leading slash
    optimizedUrl = `https://iglesia-tech-api.e2api.com/${url}?w=${width}&q=${quality}`;
  }

  // Cache the optimized URL
  imageCache.set(url, optimizedUrl);
  return optimizedUrl;
};

/**
 * Preload image with aggressive optimization
 */
export const preloadImage = (url, priority = 'low') => {
  // Return cached promise if already loading
  if (loadingPromises.has(url)) {
    return loadingPromises.get(url);
  }

  const optimizedUrl = getOptimizedImageUrl(url, {
    width: priority === 'high' ? 1200 : 400,
    quality: priority === 'high' ? 85 : 60
  });

  const promise = new Promise((resolve, reject) => {
    const img = new Image();
    
    // Set timeout for slow connections (reduced for faster failure)
    const timeout = setTimeout(() => {
      reject(new Error('Image load timeout'));
    }, priority === 'high' ? 3000 : 2000);

    img.onload = () => {
      clearTimeout(timeout);
      imageCache.set(url, optimizedUrl);
      resolve(img);
    };

    img.onerror = () => {
      clearTimeout(timeout);
      // Try fallback with correct path
      const baseUrl = process.env.PUBLIC_URL || '';
      img.src = `${baseUrl}/img/image-fallback.svg`;
      resolve(img);
    };

    // Start loading
    img.src = optimizedUrl;
  });

  loadingPromises.set(url, promise);
  return promise;
};

/**
 * Batch preload images (loads multiple images efficiently)
 */
export const batchPreloadImages = async (urls, maxConcurrent = 10) => {
  const results = [];
  const batches = [];

  // Split into batches
  for (let i = 0; i < urls.length; i += maxConcurrent) {
    batches.push(urls.slice(i, i + maxConcurrent));
  }

  // Load batches sequentially
  for (const batch of batches) {
    const batchPromises = batch.map(url => 
      preloadImage(url, 'low').catch(() => null)
    );
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  return results;
};

/**
 * Get thumbnail URL (smaller, faster loading)
 */
export const getThumbnailUrl = (url) => {
  return getOptimizedImageUrl(url, {
    width: 200,
    quality: 60,
    format: 'webp'
  });
};

/**
 * Progressive image loading (low quality first, then high quality)
 */
export const loadProgressiveImage = async (url) => {
  // Load thumbnail first (fast)
  const thumbnailUrl = getThumbnailUrl(url);
  const thumbnail = await preloadImage(thumbnailUrl, 'high');
  
  // Then load full image in background
  const fullImagePromise = preloadImage(url, 'low');
  
  return {
    thumbnail: thumbnail.src,
    fullImage: fullImagePromise
  };
};

/**
 * Clear cache (useful for memory management)
 */
export const clearImageCache = () => {
  imageCache.clear();
  loadingPromises.clear();
};

