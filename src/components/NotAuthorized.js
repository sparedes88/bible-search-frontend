import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import commonStyles from '../pages/commonStyles';

const NotAuthorized = ({ message = "You don't have permission to access this resource.", showLogin = true }) => {
  const location = useLocation();
  const pathParts = location.pathname.split('/');
  const routeType = pathParts[1]; // 'organization' or 'church'
  const churchId = pathParts[2];

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #F8FAFC 0%, #EEF2FF 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px'
    }}>
      <div style={{
        maxWidth: '500px',
        margin: '0 auto',
        backgroundColor: 'white',
        padding: '3rem',
        borderRadius: '16px',
        border: '1px solid #E5E7EB',
        boxShadow: '0 12px 24px rgba(15, 23, 42, 0.08)',
        textAlign: 'center'
      }}>
        <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🚫</div>
        <h1 style={{ ...commonStyles.title, marginBottom: '1rem', color: '#ef4444' }}>
          Access Denied
        </h1>
        <p style={{ color: '#6b7280', marginBottom: '2rem', fontSize: '1.1rem' }}>
          {message}
        </p>

        {showLogin && (
          <div style={{ marginBottom: '2rem' }}>
            <Link
              to={`/${routeType}/${churchId}/login?returnUrl=${encodeURIComponent(location.pathname)}`}
              style={{
                backgroundColor: '#4F46E5',
                color: 'white',
                padding: '12px 24px',
                borderRadius: '8px',
                textDecoration: 'none',
                display: 'inline-block',
                fontWeight: '500'
              }}
            >
              Sign In
            </Link>
          </div>
        )}

        <div>
          <Link
            to={`/${routeType}/${churchId}/mi-organizacion`}
            style={{
              color: '#4f46e5',
              textDecoration: 'none',
              fontWeight: '500'
            }}
          >
            ← Go Back
          </Link>
        </div>

        {/* Debug Information */}
        <details style={{ marginTop: '2rem', textAlign: 'left' }}>
          <summary style={{ cursor: 'pointer', color: '#6b7280', fontSize: '0.9rem' }}>
            Debug Information
          </summary>
          <div style={{
            marginTop: '1rem',
            padding: '1rem',
            backgroundColor: '#f9fafb',
            borderRadius: '8px',
            fontSize: '0.85rem',
            fontFamily: 'monospace'
          }}>
            <div><strong>Current Path:</strong> {location.pathname}</div>
            <div><strong>Route Type:</strong> {routeType}</div>
            <div><strong>Church ID:</strong> {churchId}</div>
            <div><strong>Timestamp:</strong> {new Date().toISOString()}</div>
          </div>
        </details>
      </div>
    </div>
  );
};

export default NotAuthorized;