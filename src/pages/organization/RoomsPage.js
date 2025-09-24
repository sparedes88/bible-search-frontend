import React from 'react';
import { Link, useParams } from 'react-router-dom';
import commonStyles from '../commonStyles';

const RoomsPage = () => {
  const { id } = useParams();

  return (
    <div style={commonStyles.container}>
      <Link to={`/organization/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to Organization
      </Link>
      <h1 style={commonStyles.title}>Rooms Management</h1>
      <div className="mt-4">
        <p>Room management functionality will be implemented here.</p>
      </div>
    </div>
  );
};

export default RoomsPage;
