/**
 * Performance Optimizer Utilities
 * Prevents blocking operations and optimizes loading
 */

/**
 * Debounce function to prevent excessive calls
 */
export const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

/**
 * Throttle function to limit function calls
 */
export const throttle = (func, limit) => {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
};

/**
 * Load data with timeout
 */
export const loadWithTimeout = async (promise, timeoutMs = 5000) => {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Operation timeout')), timeoutMs)
  );
  
  return Promise.race([promise, timeoutPromise]);
};

/**
 * Batch operations to prevent blocking
 */
export const batchOperation = async (items, operation, batchSize = 5) => {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(item => operation(item).catch(err => ({ error: err, item })))
    );
    results.push(...batchResults);
    
    // Yield to browser to prevent blocking
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return results;
};

/**
 * Lazy load data - only load when needed
 */
export const lazyLoad = (loader, delay = 0) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      loader().then(resolve).catch(() => resolve(null));
    }, delay);
  });
};




