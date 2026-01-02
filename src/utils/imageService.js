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
export const getOptimizedImageUrl = (url, options = {}) => {
  if (!url) return '/img/image-fallback.svg';
  
  // If already cached, return immediately
  if (imageCache.has(url)) {
    return imageCache.get(url);
  }

  // If URL is already optimized, return as is
  if (url.startsWith('http') && !url.includes('iglesia-tech-api')) {
    return url;
  }

  const {
    width = 800,
    quality = 75,
    format = 'webp'
  } = options;

  // Build optimized URL
  let optimizedUrl = url;
  
  // If it's an API URL, add optimization parameters
  if (url.includes('iglesia-tech-api.e2api.com')) {
    // Use query parameters for optimization if API supports it
    optimizedUrl = `${url}?w=${width}&q=${quality}&f=${format}`;
  } else if (url.startsWith('/')) {
    optimizedUrl = `https://iglesia-tech-api.e2api.com${url}?w=${width}&q=${quality}`;
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
    
    // Set timeout for slow connections
    const timeout = setTimeout(() => {
      reject(new Error('Image load timeout'));
    }, priority === 'high' ? 10000 : 5000);

    img.onload = () => {
      clearTimeout(timeout);
      imageCache.set(url, optimizedUrl);
      resolve(img);
    };

    img.onerror = () => {
      clearTimeout(timeout);
      // Try fallback
      img.src = '/img/image-fallback.svg';
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
export const batchPreloadImages = async (urls, maxConcurrent = 3) => {
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

