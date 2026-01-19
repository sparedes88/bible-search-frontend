import React from 'react';

const CourseProgressCard = ({ title, count, color, icon, events = [], showLegend = false }) => {
  return (
    <div 
      style={{
        backgroundColor: 'white',
        borderRadius: '8px',
        padding: '1rem',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        border: `1px solid ${color}`,
        minWidth: '200px'
      }}
    >
      {/* Section 1: Title and Icon */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '1rem',
        marginBottom: '0.75rem',
        paddingBottom: '0.75rem',
        borderBottom: '1px solid #f0f0f0'
      }}>
        <span style={{ fontSize: '24px' }}>{icon}</span>
        <h3 style={{ color: color, margin: 0 }}>{title}</h3>
      </div>
      
      {/* Section 2: Count/Statistics */}
      <div style={{ 
        padding: '0.5rem 0.25rem',
        display: 'flex',
        justifyContent: 'center',
        marginBottom: events.length > 0 ? '0.75rem' : 0,
        paddingBottom: events.length > 0 ? '0.75rem' : 0,
        borderBottom: events.length > 0 ? '1px solid #f0f0f0' : 'none'
      }}>
        <p style={{ 
          fontSize: '1.5rem', 
          fontWeight: 'bold', 
          margin: 0,
          color: '#333'
        }}>{count}</p>
      </div>
      
      {/* Section 3: Events (if provided) */}
      {events.length > 0 && (
        <div style={{ padding: '0.5rem 0' }}>
          <h4 style={{ fontSize: '0.9rem', margin: '0 0 0.5rem 0', color: '#666' }}>Events:</h4>
          <ul style={{ margin: 0, padding: '0 0 0 1.2rem', fontSize: '0.85rem' }}>
            {events.map((event, index) => (
              <li key={index} style={{ marginBottom: '0.4rem' }}>
                {event.title} 
                {event.status && (
                  <span style={{ 
                    marginLeft: '0.5rem',
                    padding: '0.1rem 0.4rem',
                    borderRadius: '12px',
                    fontSize: '0.7rem',
                    backgroundColor: event.status === 'required' ? '#fef2f2' : '#f0fdf4',
                    color: event.status === 'required' ? '#dc2626' : '#16a34a'
                  }}>
                    {event.status}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      
      {/* Section 4: Legend (if enabled) */}
      {showLegend && (
        <div style={{ 
          marginTop: '0.75rem', 
          paddingTop: '0.75rem',
          borderTop: events.length === 0 ? '1px solid #f0f0f0' : 'none',
          fontSize: '0.8rem'
        }}>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ 
                width: '10px', 
                height: '10px', 
                borderRadius: '50%', 
                backgroundColor: '#4CAF50',
                display: 'inline-block'
              }}></span>
              <span>Completed</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ 
                width: '10px', 
                height: '10px', 
                borderRadius: '50%', 
                backgroundColor: '#2196f3',
                display: 'inline-block'
              }}></span>
              <span>In Progress</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ 
                width: '10px', 
                height: '10px', 
                borderRadius: '50%', 
                backgroundColor: '#ff9999',
                display: 'inline-block'
              }}></span>
              <span>Assigned</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CourseProgressCard;
