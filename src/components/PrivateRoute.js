import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import NotAuthorized from './NotAuthorized';

const PrivateRoute = ({ children, roles = [] }) => {
  const { user } = useAuth();
  const location = useLocation();
  const pathParts = location.pathname.split('/');
  const routeType = pathParts[1]; // 'organization' or 'church'
  const churchId = pathParts[2];

  if (!user) {
    return <NotAuthorized message="Please sign in to access this page." />;
  }

  if (roles.length > 0 && !roles.includes(user.role)) {
    return <NotAuthorized message="You don't have permission to access this page." showLogin={false} />;
  }

  return children;
};

export default PrivateRoute;