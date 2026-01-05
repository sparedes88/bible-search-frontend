import React, { useState, useEffect, useRef } from 'react';

/**
 * Optimized Image Component
 * - Lazy loading with Intersection Observer
 * - Error handling with fallbacks
 * - Placeholder support
 * - Performance optimized
 */
const OptimizedImage = ({
  src,
  alt = '',
  className = '',
  style = {},
  placeholder = '/img/image-placeholder.png',
  fallback = '/img/image-fallback.svg',
  loading = 'lazy',
  onError,
  onLoad,
  ...props
}) => {
  const [imageSrc, setImageSrc] = useState(placeholder);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isInView, setIsInView] = useState(loading === 'eager');
  const imgRef = useRef(null);
  const observerRef = useRef(null);

  useEffect(() => {
    // If loading is 'eager', load immediately
    if (loading === 'eager') {
      setIsInView(true);
      return;
    }

    // Use Intersection Observer for lazy loading
    if ('IntersectionObserver' in window && imgRef.current) {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              setIsInView(true);
              if (observerRef.current && imgRef.current) {
                observerRef.current.unobserve(imgRef.current);
              }
            }
          });
        },
        {
          rootMargin: '50px',
          threshold: 0.01
        }
      );

      observerRef.current.observe(imgRef.current);
    } else {
      // Fallback for browsers without Intersection Observer
      setIsInView(true);
    }

    return () => {
      if (observerRef.current && imgRef.current) {
        observerRef.current.unobserve(imgRef.current);
      }
    };
  }, [loading]);

  useEffect(() => {
    if (isInView && src && !hasError) {
      const img = new Image();
      img.onload = () => {
        setImageSrc(src);
        setIsLoaded(true);
        if (onLoad) onLoad();
      };
      img.onerror = () => {
        if (imageSrc !== fallback) {
          setHasError(true);
          setImageSrc(fallback);
          if (onError) onError();
        }
      };
      img.src = src;
    }
  }, [isInView, src, hasError, fallback, onLoad, onError, imageSrc]);

  const handleError = (e) => {
    if (e.target.src !== fallback && e.target.src !== placeholder) {
      setHasError(true);
      setImageSrc(fallback);
      if (onError) onError(e);
    }
  };

  return (
    <img
      ref={imgRef}
      src={imageSrc}
      alt={alt}
      className={className}
      style={{
        ...style,
        transition: 'opacity 0.3s ease-in-out',
        opacity: isLoaded ? 1 : 0.7,
      }}
      loading={loading}
      onError={handleError}
      {...props}
    />
  );
};

export default OptimizedImage;



