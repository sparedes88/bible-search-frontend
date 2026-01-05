import React, { useState, useRef, useEffect } from 'react';

/**
 * Optimized LazyImage component with:
 * - Native lazy loading
 * - Intersection Observer for better performance
 * - Placeholder while loading
 * - Error handling with fallback
 * - Blur-up effect
 */
const LazyImage = ({
  src,
  alt = '',
  className = '',
  style = {},
  placeholder = '/img/image-placeholder.png',
  fallback = '/img/image-fallback.svg',
  onError,
  onLoad,
  loading = 'lazy',
  ...props
}) => {
  const [imageSrc, setImageSrc] = useState(placeholder);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const imgRef = useRef(null);
  const observerRef = useRef(null);

  useEffect(() => {
    // If loading is 'eager' or image is already in viewport, load immediately
    if (loading === 'eager') {
      setIsInView(true);
      return;
    }

    // Use Intersection Observer for better lazy loading
    if ('IntersectionObserver' in window) {
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
          rootMargin: '50px', // Start loading 50px before image enters viewport
          threshold: 0.01
        }
      );

      if (imgRef.current) {
        observerRef.current.observe(imgRef.current);
      }
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
        setHasError(true);
        setImageSrc(fallback);
        if (onError) onError();
      };
      img.src = src;
    }
  }, [isInView, src, hasError, onLoad, onError, fallback]);

  return (
    <img
      ref={imgRef}
      src={imageSrc}
      alt={alt}
      className={className}
      style={{
        ...style,
        transition: 'opacity 0.3s ease-in-out',
        opacity: isLoaded ? 1 : 0.5,
        filter: isLoaded ? 'none' : 'blur(2px)',
      }}
      loading={loading}
      onError={(e) => {
        if (!hasError) {
          setHasError(true);
          setImageSrc(fallback);
          if (onError) onError(e);
        }
      }}
      {...props}
    />
  );
};

export default LazyImage;



