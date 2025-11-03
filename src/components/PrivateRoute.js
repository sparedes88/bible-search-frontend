import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const PrivateRoute = ({ children, roles = [] }) => {
  const { user } = useAuth();
  const location = useLocation();
  const pathParts = location.pathname.split('/');
  const routeType = pathParts[1]; // 'organization' or 'church'
  const churchId = pathParts[2];

  if (!user) {
    return <Navigate to={`/${routeType}/${churchId}/login`} state={{ from: location }} replace />;
  }

  if (roles.length > 0 && !roles.includes(user.role)) {
    return <Navigate to={`/${routeType}/${churchId}`} replace />;
  }

  return children;
};

export default PrivateRoute;