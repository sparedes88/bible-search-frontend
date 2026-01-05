import React, { useState, useEffect, useRef } from 'react';
import { getOptimizedImageUrl, getThumbnailUrl, preloadImage } from '../utils/imageService';
import { getImagePath } from '../utils/productionHelpers';

/**
 * Ultra-fast image component
 * - Loads in < 5 seconds
 * - Progressive loading (thumbnail first)
 * - Aggressive caching
 * - Error handling
 */
const FastImage = ({
  src,
  alt = '',
  className = '',
  style = {},
  placeholder = getImagePath('/img/image-placeholder.png'),
  fallback = getImagePath('/img/image-fallback.svg'),
  priority = 'low',
  showThumbnail = true,
  ...props
}) => {
  const [imageSrc, setImageSrc] = useState(showThumbnail && src ? getThumbnailUrl(src) : placeholder);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isInView, setIsInView] = useState(priority === 'high');
  const imgRef = useRef(null);
  const observerRef = useRef(null);
  const timeoutRef = useRef(null);

  useEffect(() => {
    // High priority images load immediately
    if (priority === 'high') {
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
          rootMargin: '100px', // Start loading 100px before visible
          threshold: 0.01
        }
      );

      observerRef.current.observe(imgRef.current);
    } else {
      setIsInView(true);
    }

    return () => {
      if (observerRef.current && imgRef.current) {
        observerRef.current.unobserve(imgRef.current);
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [priority]);

  useEffect(() => {
    if (isInView && src && !hasError) {
      // Set timeout for slow connections (2 seconds max for faster feedback)
      timeoutRef.current = setTimeout(() => {
        if (!isLoaded) {
          setHasError(true);
          setImageSrc(fallback);
        }
      }, 2000);

      // Load thumbnail first if enabled
      if (showThumbnail) {
        const thumbnailUrl = getThumbnailUrl(src);
        const thumbnailImg = new Image();
        thumbnailImg.onload = () => {
          setImageSrc(thumbnailUrl);
          setIsLoaded(true);
        };
        thumbnailImg.onerror = () => {
          setImageSrc(placeholder);
        };
        thumbnailImg.src = thumbnailUrl;
      }

      // Then load full image
      preloadImage(src, priority)
        .then((img) => {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          setImageSrc(img.src);
          setIsLoaded(true);
        })
        .catch(() => {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          setHasError(true);
          setImageSrc(fallback);
        });
    }
  }, [isInView, src, hasError, priority, showThumbnail, fallback, placeholder, isLoaded]);

  const handleError = (e) => {
    if (e.target.src !== fallback && e.target.src !== placeholder) {
      setHasError(true);
      setImageSrc(fallback);
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
        transition: 'opacity 0.2s ease-in-out',
        opacity: isLoaded ? 1 : 0.6,
      }}
      loading={priority === 'high' ? 'eager' : 'lazy'}
      onError={handleError}
      {...props}
    />
  );
};

export default FastImage;

