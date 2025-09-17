import React from 'react';
import { Link, useParams } from 'react-router-dom';
import commonStyles from '../commonStyles';

const InventoryPage = () => {
  const { id } = useParams();

  return (
    <div style={commonStyles.container}>
      <Link to={`/church/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to Organization
      </Link>
      <h1 style={commonStyles.title}>Inventory Management</h1>
      <div className="mt-4">
        <p>Inventory management functionality will be implemented here.</p>
      </div>
    </div>
  );
};

export default InventoryPage;
