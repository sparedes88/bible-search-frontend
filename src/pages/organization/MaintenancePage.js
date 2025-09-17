import React from 'react';
import { Link, useParams } from 'react-router-dom';
import commonStyles from '../commonStyles';

const MaintenancePage = () => {
  const { id } = useParams();

  return (
    <div style={commonStyles.container}>
      <Link to={`/church/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to Organization
      </Link>
      <h1 style={commonStyles.title}>Maintenance Management</h1>
      <div className="mt-4">
        <p>Maintenance management functionality will be implemented here.</p>
      </div>
    </div>
  );
};

export default MaintenancePage;
