import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import NotAuthorized from './NotAuthorized';

const PrivateRoute = ({ children, roles = [] }) => {
  const { user, loading } = useAuth();
  const location = useLocation();
  const pathParts = location.pathname.split('/');
  const routeType = pathParts[1]; // 'organization' or 'church'
  const churchId = pathParts[2];
  const resolvedRole = String(user?.role || user?.customRole || '').trim().toLowerCase();
  const allowedRoles = roles.map((role) => String(role).trim().toLowerCase());

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        background: 'linear-gradient(180deg, #F8FAFC 0%, #EEF2FF 100%)'
      }}>
        <div style={{
          textAlign: 'center',
          padding: '2rem'
        }}>
          <div style={{
            width: '50px',
            height: '50px',
            border: '4px solid #E5E7EB',
            borderTop: '4px solid #4F46E5',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 1rem'
          }} />
          <p style={{ color: '#6b7280', fontSize: '1.1rem' }}>Loading...</p>
        </div>
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  if (!user) {
    const returnUrl = `${location.pathname}${location.search}`;
    const loginBasePath = routeType === 'church'
      ? `/church/${churchId}/login`
      : `/organization/${churchId}/login`;
    return <Navigate to={`${loginBasePath}?returnUrl=${encodeURIComponent(returnUrl)}`} replace />;
  }

  if (roles.length > 0 && !allowedRoles.includes(resolvedRole)) {
    return <NotAuthorized message="You don't have permission to access this page." showLogin={false} />;
  }

  return children;
};

export default PrivateRoute;