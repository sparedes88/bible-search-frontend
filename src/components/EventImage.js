import React from 'react';

const EventImage = ({ event, subcategory, className = '', style = {} }) => {
  // Debug the incoming props
  console.log('EventImage props:', {
    eventId: event?.id,
    eventImageUrl: event?.imageUrl,
    useSubcategoryImage: event?.useSubcategoryImage,
    subcategoryId: subcategory?.id,
    subcategoryImageUrl: subcategory?.imageUrl
  });

  // Get the appropriate image URL
  const imageUrl = event?.useSubcategoryImage ? subcategory?.imageUrl : event?.imageUrl;
  
  // Default gradient backgrounds
  const gradients = [
    'bg-gradient-to-r from-blue-500 to-purple-500',
    'bg-gradient-to-r from-green-400 to-blue-500',
    'bg-gradient-to-r from-purple-500 to-pink-500',
    'bg-gradient-to-r from-yellow-400 to-orange-500'
  ];
  
  const defaultGradient = gradients[Math.floor(Math.random() * gradients.length)];

  if (!imageUrl) {
    console.log(`Using default gradient for event ${event?.id} - no image found`);
    return (
      <div 
        className={`flex items-center justify-center ${defaultGradient} ${className}`}
        style={{
          minHeight: '200px',
          ...style
        }}
      >
        <span className="text-white text-4xl font-bold opacity-50">
          {event?.title?.[0]?.toUpperCase() || 'E'}
        </span>
      </div>
    );
  }

  return (
    <div 
      className={`bg-cover bg-center bg-no-repeat ${className}`}
      style={{
        backgroundImage: `url(${imageUrl})`,
        minHeight: '200px',
        ...style
      }}
    />
  );
};

export default EventImage;